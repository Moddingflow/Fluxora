#include "FluxoraInstaller/FluxoraInstallerApi.hpp"

#include <spdlog/logger.h>
#include <spdlog/sinks/basic_file_sink.h>
#ifdef _WIN32
#include <spdlog/sinks/msvc_sink.h>
#endif

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <cwchar>
#include <cwctype>
#include <ctime>
#include <exception>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iomanip>
#include <limits>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_set>
#include <utility>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <bcrypt.h>
#include <shlobj.h>
#include <shobjidl.h>
#endif

namespace
{
    constexpr std::array<unsigned char, 8> PackageMagic{ 'F', 'L', 'X', 'P', 'K', 'G', '1', '\0' };
    constexpr std::array<unsigned char, 8> TransactionMagic{ 'F', 'L', 'X', 'T', 'X', 'N', '1', '\0' };
    constexpr std::uint32_t MinimumPackageVersion = 1;
    constexpr std::uint32_t CurrentPackageVersion = 2;
    constexpr std::uint32_t PackageVersionWithFileHashes = 2;
    constexpr std::uint32_t TransactionVersion = 1;
    constexpr std::size_t TransactionIdSize = 16;
    constexpr std::uintmax_t MaximumTransactionMarkerBytes = 64 * 1024;
    constexpr std::size_t Sha256HashSize = 32;
    constexpr std::size_t CopyBufferSize = 1024 * 256;
    constexpr std::chrono::milliseconds ProgressCallbackMinimumInterval{100};
    constexpr double ProgressCallbackMinimumPercentDelta = 0.5;

    thread_local std::wstring lastError;
    thread_local std::string currentOperationId;
    std::mutex logMutex;
    std::shared_ptr<spdlog::logger> installerLogger;

    struct PackageHeader
    {
        std::uint32_t version{0};
        std::uint64_t entryCount{0};
        std::uint64_t totalBytes{0};
    };

    struct InstallResult
    {
        std::filesystem::path installDirectory;
        std::filesystem::path applicationPath;
        std::filesystem::path desktopShortcutPath;
        bool createdDesktopShortcut{false};
    };

    struct InstallerProgressState
    {
        std::chrono::steady_clock::time_point lastReport{};
        std::wstring lastPhase;
        double lastPercent{0.0};
        bool hasReport{false};
    };

    using TransactionId = std::array<unsigned char, TransactionIdSize>;

    struct InstallerTransactionPaths
    {
        TransactionId id{};
        std::filesystem::path stagingDirectory;
        std::filesystem::path backupDirectory;
        std::filesystem::path markerPath;
    };

    struct InstallerTransactionMarker
    {
        InstallerTransactionPaths paths;
        bool hadExistingInstall{false};
    };

    bool isBlank(const wchar_t* value)
    {
        return value == nullptr || value[0] == L'\0';
    }

    std::string toUtf8(const std::wstring& value)
    {
#ifdef _WIN32
        if (value.empty())
        {
            return {};
        }

        const int size = WideCharToMultiByte(
            CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
        if (size <= 0)
        {
            return {};
        }

        std::string out(static_cast<std::size_t>(size), '\0');
        WideCharToMultiByte(
            CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
        return out;
#else
        return std::string(value.begin(), value.end());
#endif
    }

    std::wstring fromUtf8(const std::string& value)
    {
#ifdef _WIN32
        if (value.empty())
        {
            return {};
        }

        const int size = MultiByteToWideChar(
            CP_UTF8,
            MB_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0);
        if (size <= 0)
        {
            throw std::runtime_error("Package path entry is not valid UTF-8.");
        }

        std::wstring out(static_cast<std::size_t>(size), L'\0');
        MultiByteToWideChar(
            CP_UTF8,
            MB_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            out.data(),
            size);
        return out;
#else
        return std::wstring(value.begin(), value.end());
#endif
    }

    std::wstring readEnvironmentVariable(const wchar_t* name)
    {
#ifdef _WIN32
        const DWORD requiredLength = GetEnvironmentVariableW(name, nullptr, 0);
        if (requiredLength == 0)
        {
            return {};
        }

        std::wstring value(requiredLength, L'\0');
        const DWORD actualLength = GetEnvironmentVariableW(name, value.data(), requiredLength);
        if (actualLength == 0 || actualLength >= requiredLength)
        {
            return {};
        }

        value.resize(actualLength);
        return value;
#else
        (void)name;
        return {};
#endif
    }

    std::tm localTimeNow()
    {
        const std::time_t now = std::time(nullptr);
        std::tm local{};
#ifdef _WIN32
        localtime_s(&local, &now);
#else
        localtime_r(&now, &local);
#endif
        return local;
    }

    std::wstring logDateStamp()
    {
        const std::tm local = localTimeNow();
        std::wostringstream stream;
        stream << std::put_time(&local, L"%Y%m%d");
        return stream.str();
    }

    std::filesystem::path resolveLogPath()
    {
        if (const std::wstring appData = readEnvironmentVariable(L"APPDATA"); !appData.empty())
        {
            return std::filesystem::path(appData) /
                L"Fluxora" /
                L"logs" /
                (std::wstring(L"fluxora-installer-core-") + logDateStamp() + L".log");
        }

        return std::filesystem::temp_directory_path() /
            L"Fluxora" /
            L"logs" /
            (std::wstring(L"fluxora-installer-core-") + logDateStamp() + L".log");
    }

    void writeLog(std::string_view level, std::string_view message)
    {
        try
        {
            const auto now = std::chrono::system_clock::now();
            const auto milliseconds = std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch()) % 1000;
            const std::tm local = localTimeNow();

            std::ostringstream line;
            line << "[" << std::put_time(&local, "%Y-%m-%d %H:%M:%S")
                 << "." << std::setfill('0') << std::setw(3) << milliseconds.count() << "] "
                 << "[" << level << "] "
                 << "[InstallerCore] "
                 << "[tid=" << std::this_thread::get_id() << "]";
            if (!currentOperationId.empty())
            {
                line << " [op=" << currentOperationId << "]";
            }
            line << " " << message;

            std::lock_guard lock(logMutex);
            if (!installerLogger)
            {
                const std::filesystem::path logPath = resolveLogPath();
                std::filesystem::create_directories(logPath.parent_path());
                std::vector<spdlog::sink_ptr> sinks;
                auto fileSink = std::make_shared<spdlog::sinks::basic_file_sink_mt>(toUtf8(logPath.wstring()), true);
                fileSink->set_level(spdlog::level::trace);
                sinks.push_back(fileSink);
#ifdef _WIN32
                auto debugSink = std::make_shared<spdlog::sinks::msvc_sink_mt>();
                debugSink->set_level(spdlog::level::info);
                sinks.push_back(debugSink);
#endif
                installerLogger = std::make_shared<spdlog::logger>(
                    "fluxora-installer-core",
                    sinks.begin(),
                    sinks.end());
                installerLogger->set_pattern("%v");
                installerLogger->set_level(spdlog::level::info);
                installerLogger->flush_on(spdlog::level::warn);
            }

            if (level == "ERROR")
            {
                installerLogger->error("{}", line.str());
                installerLogger->flush();
            }
            else if (level == "WARNING")
            {
                installerLogger->warn("{}", line.str());
                installerLogger->flush();
            }
            else
            {
                installerLogger->info("{}", line.str());
            }
#ifdef _WIN32
            OutputDebugStringA((line.str() + "\n").c_str());
#endif
        }
        catch (...)
        {
        }
    }

    bool detailedProgressLoggingEnabled()
    {
        static const bool enabled = []
        {
            const std::wstring value = readEnvironmentVariable(L"FLUXORA_INSTALLER_DEBUG_PROGRESS");
            return value == L"1" ||
                value == L"true" ||
                value == L"TRUE" ||
                value == L"on" ||
                value == L"ON";
        }();
        return enabled;
    }

    bool isTerminalProgressPhase(std::wstring_view phase)
    {
        return phase == L"completed" ||
            phase == L"complete" ||
            phase == L"error" ||
            phase == L"failed" ||
            phase == L"failure";
    }

    void writeProgressDebugLog(
        std::wstring_view phase,
        std::wstring_view currentItem,
        std::uint64_t copiedBytes,
        std::uint64_t totalBytes,
        bool emitted)
    {
        if (!detailedProgressLoggingEnabled())
        {
            return;
        }

        std::ostringstream stream;
        stream << "progress-callback "
               << (emitted ? "emitted" : "coalesced")
               << ". phase=\"" << toUtf8(std::wstring(phase)) << "\""
               << ", currentItem=\"" << toUtf8(std::wstring(currentItem)) << "\""
               << ", copiedBytes=" << copiedBytes
               << ", totalBytes=" << totalBytes;
        writeLog("DEBUG", stream.str());
    }

    std::wstring makeAbsoluteString(const std::filesystem::path& path)
    {
        std::error_code error;
        const std::filesystem::path absolute = std::filesystem::absolute(path, error);
        return (error ? path : absolute).wstring();
    }

    std::wstring jsonEscape(const std::wstring& value)
    {
        std::wstring escaped;
        escaped.reserve(value.size() + 8);
        for (wchar_t ch : value)
        {
            switch (ch)
            {
            case L'\\':
                escaped += L"\\\\";
                break;
            case L'"':
                escaped += L"\\\"";
                break;
            case L'\r':
                escaped += L"\\r";
                break;
            case L'\n':
                escaped += L"\\n";
                break;
            case L'\t':
                escaped += L"\\t";
                break;
            default:
                if (ch < 0x20)
                {
                    std::wostringstream stream;
                    stream << L"\\u" << std::hex << std::setw(4) << std::setfill(L'0')
                           << static_cast<int>(ch);
                    escaped += stream.str();
                }
                else
                {
                    escaped.push_back(ch);
                }
                break;
            }
        }

        return escaped;
    }

    int writeToBuffer(const std::wstring& value, wchar_t* buffer, int bufferLength)
    {
        if (buffer == nullptr || bufferLength <= 0)
        {
            lastError = L"Output buffer is required.";
            return FluxoraInstallerResultInvalidArgument;
        }

        if (static_cast<int>(value.size()) + 1 > bufferLength)
        {
            return FluxoraInstallerResultBufferTooSmall;
        }

#ifdef _WIN32
        wcscpy_s(buffer, static_cast<std::size_t>(bufferLength), value.c_str());
#else
        std::wcsncpy(buffer, value.c_str(), static_cast<std::size_t>(bufferLength));
        buffer[bufferLength - 1] = L'\0';
#endif
        return FluxoraInstallerResultOk;
    }

    class PackageReader
    {
    public:
        virtual ~PackageReader() = default;

        virtual std::size_t readSome(char* buffer, std::size_t byteCount) = 0;
        [[nodiscard]] virtual std::string sourceDescription() const = 0;

        void readExact(char* buffer, std::size_t byteCount, std::string_view label)
        {
            std::size_t offset = 0;
            while (offset < byteCount)
            {
                const std::size_t read = readSome(buffer + offset, byteCount - offset);
                if (read == 0)
                {
                    throw std::runtime_error(std::string("Invalid package: failed to read ") + std::string(label) + ".");
                }

                if (read > byteCount - offset)
                {
                    throw std::runtime_error("Invalid package: stream reader returned too many bytes.");
                }

                offset += read;
            }
        }
    };

    class FilePackageReader final : public PackageReader
    {
    public:
        explicit FilePackageReader(std::filesystem::path packagePath)
            : packagePath_(std::move(packagePath)),
              stream_(packagePath_, std::ios::in | std::ios::binary)
        {
            if (!stream_)
            {
                throw std::runtime_error("Installer package could not be opened.");
            }
        }

        std::size_t readSome(char* buffer, std::size_t byteCount) override
        {
            if (byteCount == 0)
            {
                return 0;
            }

            const auto request = static_cast<std::streamsize>(
                std::min<std::size_t>(byteCount, static_cast<std::size_t>(std::numeric_limits<std::streamsize>::max())));
            stream_.read(buffer, request);
            const std::streamsize read = stream_.gcount();
            if (read < 0 || (read == 0 && stream_.bad()))
            {
                throw std::runtime_error("Installer package could not be read.");
            }

            return static_cast<std::size_t>(read);
        }

        [[nodiscard]] std::string sourceDescription() const override
        {
            return toUtf8(packagePath_.wstring());
        }

    private:
        std::filesystem::path packagePath_;
        std::ifstream stream_;
    };

    class CallbackPackageReader final : public PackageReader
    {
    public:
        CallbackPackageReader(FluxoraInstallerReadCallback readCallback, void* readUserData)
            : readCallback_(readCallback),
              readUserData_(readUserData)
        {
            if (readCallback_ == nullptr)
            {
                throw std::invalid_argument("Installer package stream callback is required.");
            }
        }

        std::size_t readSome(char* buffer, std::size_t byteCount) override
        {
            if (byteCount == 0)
            {
                return 0;
            }

            const std::int64_t read = readCallback_(
                buffer,
                static_cast<std::uint64_t>(byteCount),
                readUserData_);
            if (read < 0)
            {
                throw std::runtime_error("Installer package stream could not be read.");
            }

            const auto unsignedRead = static_cast<std::uint64_t>(read);
            if (unsignedRead > byteCount)
            {
                throw std::runtime_error("Installer package stream returned too many bytes.");
            }

            return static_cast<std::size_t>(unsignedRead);
        }

        [[nodiscard]] std::string sourceDescription() const override
        {
            return "embedded stream";
        }

    private:
        FluxoraInstallerReadCallback readCallback_{nullptr};
        void* readUserData_{nullptr};
    };

#ifdef _WIN32
    void requireBCrypt(NTSTATUS status, std::string_view operation)
    {
        if (status < 0)
        {
            std::ostringstream stream;
            stream << "SHA-256 integrity check failed during " << operation
                   << ". status=0x" << std::hex << static_cast<unsigned long>(status);
            throw std::runtime_error(stream.str());
        }
    }

    class Sha256Hasher final
    {
    public:
        Sha256Hasher()
        {
            try
            {
                requireBCrypt(
                    BCryptOpenAlgorithmProvider(&algorithm_, BCRYPT_SHA256_ALGORITHM, nullptr, 0),
                    "algorithm open");

                DWORD objectLength = 0;
                DWORD propertyLength = 0;
                requireBCrypt(
                    BCryptGetProperty(
                        algorithm_,
                        BCRYPT_OBJECT_LENGTH,
                        reinterpret_cast<PUCHAR>(&objectLength),
                        sizeof(objectLength),
                        &propertyLength,
                        0),
                    "object length lookup");

                hashObject_.resize(objectLength);
                requireBCrypt(
                    BCryptCreateHash(
                        algorithm_,
                        &hash_,
                        hashObject_.data(),
                        static_cast<ULONG>(hashObject_.size()),
                        nullptr,
                        0,
                        0),
                    "hash creation");
            }
            catch (...)
            {
                if (hash_ != nullptr)
                {
                    BCryptDestroyHash(hash_);
                    hash_ = nullptr;
                }

                if (algorithm_ != nullptr)
                {
                    BCryptCloseAlgorithmProvider(algorithm_, 0);
                    algorithm_ = nullptr;
                }

                throw;
            }
        }

        Sha256Hasher(const Sha256Hasher&) = delete;
        Sha256Hasher& operator=(const Sha256Hasher&) = delete;

        ~Sha256Hasher()
        {
            if (hash_ != nullptr)
            {
                BCryptDestroyHash(hash_);
            }

            if (algorithm_ != nullptr)
            {
                BCryptCloseAlgorithmProvider(algorithm_, 0);
            }
        }

        void append(const char* buffer, std::size_t byteCount)
        {
            std::size_t offset = 0;
            while (offset < byteCount)
            {
                const ULONG chunkSize = static_cast<ULONG>(
                    std::min<std::size_t>(
                        byteCount - offset,
                        static_cast<std::size_t>(std::numeric_limits<ULONG>::max())));
                requireBCrypt(
                    BCryptHashData(
                        hash_,
                        reinterpret_cast<PUCHAR>(const_cast<char*>(buffer + offset)),
                        chunkSize,
                        0),
                    "hash update");
                offset += chunkSize;
            }
        }

        [[nodiscard]] std::array<unsigned char, Sha256HashSize> finish()
        {
            std::array<unsigned char, Sha256HashSize> digest{};
            requireBCrypt(
                BCryptFinishHash(hash_, digest.data(), static_cast<ULONG>(digest.size()), 0),
                "hash finish");
            return digest;
        }

    private:
        BCRYPT_ALG_HANDLE algorithm_{nullptr};
        BCRYPT_HASH_HANDLE hash_{nullptr};
        std::vector<unsigned char> hashObject_;
    };
#endif

    std::wstring serializeResult(const InstallResult& result)
    {
        std::wstring json;
        json += L"{";
        json += L"\"installDirectory\":\"" + jsonEscape(makeAbsoluteString(result.installDirectory)) + L"\",";
        json += L"\"applicationPath\":\"" + jsonEscape(makeAbsoluteString(result.applicationPath)) + L"\",";
        json += L"\"desktopShortcutPath\":\"" + jsonEscape(makeAbsoluteString(result.desktopShortcutPath)) + L"\",";
        json += L"\"createdDesktopShortcut\":";
        json += result.createdDesktopShortcut ? L"true" : L"false";
        json += L"}";
        return json;
    }

    template <typename T>
    T readPod(PackageReader& reader, std::string_view label)
    {
        T value{};
        reader.readExact(reinterpret_cast<char*>(&value), sizeof(T), label);
        return value;
    }

    PackageHeader readHeader(PackageReader& reader)
    {
        std::array<unsigned char, PackageMagic.size()> magic{};
        reader.readExact(reinterpret_cast<char*>(magic.data()), magic.size(), "package magic");
        if (magic != PackageMagic)
        {
            throw std::runtime_error("Invalid Fluxora installer package.");
        }

        PackageHeader header;
        header.version = readPod<std::uint32_t>(reader, "package version");
        header.entryCount = readPod<std::uint64_t>(reader, "entry count");
        header.totalBytes = readPod<std::uint64_t>(reader, "total bytes");
        if (header.version < MinimumPackageVersion || header.version > CurrentPackageVersion)
        {
            throw std::runtime_error("Unsupported Fluxora installer package version.");
        }

        return header;
    }

    std::wstring readRelativePath(PackageReader& reader)
    {
        const std::uint32_t byteLength = readPod<std::uint32_t>(reader, "path length");
        if (byteLength == 0 || byteLength > 32768)
        {
            throw std::runtime_error("Invalid package path length.");
        }

        std::string utf8(byteLength, '\0');
        reader.readExact(utf8.data(), byteLength, "path");
        return fromUtf8(utf8);
    }

    std::array<unsigned char, Sha256HashSize> readSha256(PackageReader& reader)
    {
        std::array<unsigned char, Sha256HashSize> digest{};
        reader.readExact(reinterpret_cast<char*>(digest.data()), digest.size(), "SHA-256 digest");
        return digest;
    }

    bool isRootDirectory(const std::filesystem::path& path)
    {
        std::error_code error;
        const std::filesystem::path absolute = std::filesystem::weakly_canonical(path, error);
        const std::filesystem::path candidate = error ? std::filesystem::absolute(path, error) : absolute;
        if (candidate.empty())
        {
            return false;
        }

        return candidate == candidate.root_path();
    }

    bool pathStartsWith(const std::filesystem::path& path, const std::filesystem::path& root)
    {
        const std::filesystem::path normalPath = path.lexically_normal();
        const std::filesystem::path normalRoot = root.lexically_normal();

        auto pathIt = normalPath.begin();
        auto rootIt = normalRoot.begin();
        for (; rootIt != normalRoot.end(); ++rootIt, ++pathIt)
        {
            if (pathIt == normalPath.end())
            {
                return false;
            }

#ifdef _WIN32
            std::wstring left = pathIt->wstring();
            std::wstring right = rootIt->wstring();
            std::transform(left.begin(), left.end(), left.begin(), [](wchar_t value) {
                return static_cast<wchar_t>(std::towlower(value));
            });
            std::transform(right.begin(), right.end(), right.begin(), [](wchar_t value) {
                return static_cast<wchar_t>(std::towlower(value));
            });
            if (left != right)
            {
                return false;
            }
#else
            if (*pathIt != *rootIt)
            {
                return false;
            }
#endif
        }

        return true;
    }

    void rejectReparseInstallDirectory(const std::filesystem::path& installDirectory)
    {
#ifdef _WIN32
        const DWORD attributes = GetFileAttributesW(installDirectory.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES)
        {
            const DWORD error = GetLastError();
            if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND)
            {
                return;
            }

            throw std::invalid_argument(
                "Install directory could not be inspected for Windows reparse points.");
        }

        if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        {
            throw std::invalid_argument(
                "Install directory cannot be a symbolic link, junction or reparse point.");
        }
#else
        std::error_code error;
        const std::filesystem::file_status status = std::filesystem::symlink_status(installDirectory, error);
        if (error == std::errc::no_such_file_or_directory)
        {
            return;
        }
        if (error)
        {
            throw std::invalid_argument("Install directory could not be inspected for symbolic links.");
        }
        if (std::filesystem::is_symlink(status))
        {
            throw std::invalid_argument(
                "Install directory cannot be a symbolic link, junction or reparse point.");
        }
#endif
    }

    void recoverInstallTransaction(const std::filesystem::path& installDirectory);

    std::filesystem::path validateInstallDirectory(const std::filesystem::path& installDirectory)
    {
        if (installDirectory.empty())
        {
            throw std::invalid_argument("Install directory is required.");
        }

        std::error_code error;
        const std::filesystem::path absolute = std::filesystem::absolute(installDirectory, error);
        if (error || absolute.empty())
        {
            throw std::invalid_argument("Install directory is not a valid path.");
        }

        if (isRootDirectory(absolute))
        {
            throw std::invalid_argument("Choose a folder inside a drive, not the drive root.");
        }

        rejectReparseInstallDirectory(absolute);
        recoverInstallTransaction(absolute.lexically_normal());
        rejectReparseInstallDirectory(absolute);

        if (std::filesystem::exists(absolute, error) && !std::filesystem::is_directory(absolute, error))
        {
            throw std::invalid_argument("Install path points to a file. Choose a folder.");
        }

        return absolute.lexically_normal();
    }

    std::filesystem::path transactionSiblingPath(
        const std::filesystem::path& installDirectory,
        std::wstring_view role,
        std::uint64_t attempt)
    {
        const std::wstring installName = installDirectory.filename().empty()
            ? L"Fluxora"
            : installDirectory.filename().wstring();
        const auto nonce = static_cast<std::uint64_t>(
            std::chrono::steady_clock::now().time_since_epoch().count());
        return installDirectory.parent_path() /
            (L"." + installName + L".fluxora-" + std::wstring(role) + L"-" +
             std::to_wstring(nonce) + L"-" + std::to_wstring(attempt));
    }

    std::string transactionIdHex(const TransactionId& transactionId)
    {
        constexpr char Digits[] = "0123456789abcdef";
        std::string value;
        value.reserve(transactionId.size() * 2);
        for (const unsigned char byte : transactionId)
        {
            value.push_back(Digits[byte >> 4]);
            value.push_back(Digits[byte & 0x0F]);
        }
        return value;
    }

    std::filesystem::path ownedTransactionSibling(
        const std::filesystem::path& installDirectory,
        std::wstring_view role,
        const TransactionId& transactionId)
    {
        return installDirectory.parent_path() /
            (L"." + installDirectory.filename().wstring() + L".fluxora-" + std::wstring(role) + L"-" +
             fromUtf8(transactionIdHex(transactionId)));
    }

    std::filesystem::path installTransactionMarkerPath(const std::filesystem::path& installDirectory)
    {
        return installDirectory.parent_path() /
            (L"." + installDirectory.filename().wstring() + L".fluxora-transaction");
    }

    std::filesystem::path installTransactionSentinelPath(
        const std::filesystem::path& directory,
        const TransactionId& transactionId)
    {
        return directory /
            (L".fluxora-commit-" + fromUtf8(transactionIdHex(transactionId)) + L".pending");
    }

    TransactionId generateTransactionId(std::uint64_t attempt)
    {
        TransactionId transactionId{};
#ifdef _WIN32
        (void)attempt;
        const NTSTATUS status = BCryptGenRandom(
            nullptr,
            transactionId.data(),
            static_cast<ULONG>(transactionId.size()),
            BCRYPT_USE_SYSTEM_PREFERRED_RNG);
        if (status < 0)
        {
            throw std::runtime_error("Failed to generate an installer transaction identifier.");
        }
#else
        std::uint64_t state = static_cast<std::uint64_t>(
            std::chrono::steady_clock::now().time_since_epoch().count()) ^
            static_cast<std::uint64_t>(std::hash<std::thread::id>{}(std::this_thread::get_id())) ^
            attempt;
        for (unsigned char& byte : transactionId)
        {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            byte = static_cast<unsigned char>(state & 0xFF);
        }
#endif
        return transactionId;
    }

    InstallerTransactionPaths createStagingTransaction(const std::filesystem::path& installDirectory)
    {
        std::error_code error;
        std::filesystem::create_directories(installDirectory.parent_path(), error);
        if (error)
        {
            throw std::runtime_error(
                "Failed to create installer staging parent: " +
                toUtf8(installDirectory.parent_path().wstring()) + ". " + error.message());
        }

        for (std::uint64_t attempt = 0; attempt < 128; ++attempt)
        {
            InstallerTransactionPaths transaction;
            transaction.id = generateTransactionId(attempt);
            transaction.stagingDirectory = ownedTransactionSibling(
                installDirectory,
                L"staging",
                transaction.id);
            transaction.backupDirectory = ownedTransactionSibling(
                installDirectory,
                L"backup",
                transaction.id);
            transaction.markerPath = installTransactionMarkerPath(installDirectory);

            error.clear();
            const bool backupExists = std::filesystem::exists(transaction.backupDirectory, error);
            if (error)
            {
                throw std::runtime_error(
                    "Failed to inspect installer backup path: " +
                    toUtf8(transaction.backupDirectory.wstring()) + ". " + error.message());
            }
            if (backupExists)
            {
                continue;
            }

            error.clear();
            if (std::filesystem::create_directory(transaction.stagingDirectory, error))
            {
                return transaction;
            }
            if (error)
            {
                throw std::runtime_error(
                    "Failed to create installer staging directory: " +
                    toUtf8(transaction.stagingDirectory.wstring()) + ". " + error.message());
            }
        }

        throw std::runtime_error("Failed to allocate a unique installer transaction directory.");
    }

    void removeTransactionDirectory(const std::filesystem::path& path, std::string_view role) noexcept
    {
        if (path.empty())
        {
            return;
        }

        std::error_code error;
        const std::uintmax_t removed = std::filesystem::remove_all(path, error);
        if (error)
        {
            writeLog(
                "WARNING",
                std::string("Failed to clean installer ") + std::string(role) +
                    ". path=\"" + toUtf8(path.wstring()) + "\", error=\"" + error.message() + "\"");
            return;
        }

        if (removed > 0)
        {
            writeLog(
                "INFO",
                std::string("Installer ") + std::string(role) +
                    " cleaned. path=\"" + toUtf8(path.wstring()) + "\"");
        }
    }

    class TransactionDirectoryCleanup final
    {
    public:
        TransactionDirectoryCleanup(std::filesystem::path path, std::string role)
            : path_(std::move(path)),
              role_(std::move(role))
        {
        }

        TransactionDirectoryCleanup(const TransactionDirectoryCleanup&) = delete;
        TransactionDirectoryCleanup& operator=(const TransactionDirectoryCleanup&) = delete;

        ~TransactionDirectoryCleanup()
        {
            if (active_)
            {
                removeTransactionDirectory(path_, role_);
            }
        }

        void dismiss() noexcept
        {
            active_ = false;
        }

    private:
        std::filesystem::path path_;
        std::string role_;
        bool active_{true};
    };

    void renameDirectory(
        const std::filesystem::path& source,
        const std::filesystem::path& destination,
        std::string_view operation)
    {
        std::error_code error;
        std::filesystem::rename(source, destination, error);
        if (error)
        {
            throw std::runtime_error(
                std::string(operation) + " failed. source=\"" + toUtf8(source.wstring()) +
                "\", destination=\"" + toUtf8(destination.wstring()) +
                "\", error=\"" + error.message() + "\"");
        }
    }

    bool transactionPathExistsWithoutReparse(
        const std::filesystem::path& path,
        std::string_view role)
    {
#ifdef _WIN32
        const DWORD attributes = GetFileAttributesW(path.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES)
        {
            const DWORD error = GetLastError();
            if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND)
            {
                return false;
            }
            throw std::runtime_error(
                "Failed to inspect installer transaction " + std::string(role) + ".");
        }
        if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        {
            throw std::runtime_error(
                "Installer transaction " + std::string(role) + " cannot be a reparse point.");
        }
        return true;
#else
        std::error_code error;
        const std::filesystem::file_status status = std::filesystem::symlink_status(path, error);
        if (error == std::errc::no_such_file_or_directory)
        {
            return false;
        }
        if (error)
        {
            throw std::runtime_error(
                "Failed to inspect installer transaction " + std::string(role) + ".");
        }
        if (std::filesystem::is_symlink(status))
        {
            throw std::runtime_error(
                "Installer transaction " + std::string(role) + " cannot be a symbolic link.");
        }
        return std::filesystem::exists(status);
#endif
    }

    void removeOwnedTransactionDirectory(
        const std::filesystem::path& path,
        std::string_view role)
    {
        if (!transactionPathExistsWithoutReparse(path, role))
        {
            return;
        }

        std::error_code error;
        if (!std::filesystem::is_directory(path, error) || error)
        {
            throw std::runtime_error(
                "Installer transaction " + std::string(role) + " is not a directory.");
        }

        std::filesystem::remove_all(path, error);
        if (error)
        {
            throw std::runtime_error(
                "Failed to clean installer transaction " + std::string(role) + ": " + error.message());
        }
    }

    template <typename T>
    void appendTransactionPod(std::vector<unsigned char>& output, const T& value)
    {
        const auto* first = reinterpret_cast<const unsigned char*>(&value);
        output.insert(output.end(), first, first + sizeof(T));
    }

    void appendTransactionBytes(
        std::vector<unsigned char>& output,
        const void* data,
        std::size_t byteCount)
    {
        const auto* first = static_cast<const unsigned char*>(data);
        output.insert(output.end(), first, first + byteCount);
    }

    std::vector<unsigned char> serializeTransactionMarker(
        const InstallerTransactionPaths& transaction,
        bool hadExistingInstall)
    {
        const std::string stagingName = toUtf8(transaction.stagingDirectory.filename().wstring());
        const std::string backupName = toUtf8(transaction.backupDirectory.filename().wstring());
        if (stagingName.empty() || backupName.empty() ||
            stagingName.size() > std::numeric_limits<std::uint32_t>::max() ||
            backupName.size() > std::numeric_limits<std::uint32_t>::max())
        {
            throw std::runtime_error("Installer transaction path names cannot be serialized safely.");
        }

        std::vector<unsigned char> marker;
        marker.reserve(
            TransactionMagic.size() + sizeof(TransactionVersion) + sizeof(std::uint8_t) +
            transaction.id.size() + (sizeof(std::uint32_t) * 2) +
            stagingName.size() + backupName.size());
        appendTransactionBytes(marker, TransactionMagic.data(), TransactionMagic.size());
        appendTransactionPod(marker, TransactionVersion);
        appendTransactionPod(marker, static_cast<std::uint8_t>(hadExistingInstall ? 1 : 0));
        appendTransactionBytes(marker, transaction.id.data(), transaction.id.size());
        appendTransactionPod(marker, static_cast<std::uint32_t>(stagingName.size()));
        appendTransactionBytes(marker, stagingName.data(), stagingName.size());
        appendTransactionPod(marker, static_cast<std::uint32_t>(backupName.size()));
        appendTransactionBytes(marker, backupName.data(), backupName.size());
        return marker;
    }

    class TransactionMarkerReader final
    {
    public:
        explicit TransactionMarkerReader(const std::vector<unsigned char>& bytes)
            : bytes_(bytes)
        {
        }

        template <typename T>
        T readPod(std::string_view label)
        {
            T value{};
            readExact(&value, sizeof(value), label);
            return value;
        }

        void readExact(void* destination, std::size_t byteCount, std::string_view label)
        {
            if (byteCount > bytes_.size() - offset_)
            {
                throw std::runtime_error(
                    "Installer transaction marker is truncated at " + std::string(label) + ".");
            }
            std::memcpy(destination, bytes_.data() + offset_, byteCount);
            offset_ += byteCount;
        }

        std::string readString(std::string_view label)
        {
            const std::uint32_t length = readPod<std::uint32_t>(label);
            if (length == 0 || length > 32768 || length > bytes_.size() - offset_)
            {
                throw std::runtime_error(
                    "Installer transaction marker contains an invalid " + std::string(label) + ".");
            }
            std::string value(length, '\0');
            readExact(value.data(), value.size(), label);
            return value;
        }

        [[nodiscard]] bool atEnd() const noexcept
        {
            return offset_ == bytes_.size();
        }

    private:
        const std::vector<unsigned char>& bytes_;
        std::size_t offset_{0};
    };

    std::vector<unsigned char> readTransactionFile(
        const std::filesystem::path& path,
        std::uintmax_t maximumBytes,
        std::string_view role)
    {
        std::error_code error;
        const std::uintmax_t byteCount = std::filesystem::file_size(path, error);
        if (error || byteCount == 0 || byteCount > maximumBytes ||
            byteCount > static_cast<std::uintmax_t>(std::numeric_limits<std::size_t>::max()))
        {
            throw std::runtime_error(
                "Installer transaction " + std::string(role) + " has an invalid size.");
        }

        std::vector<unsigned char> bytes(static_cast<std::size_t>(byteCount));
        std::ifstream input(path, std::ios::in | std::ios::binary);
        if (!input ||
            !input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size())))
        {
            throw std::runtime_error(
                "Failed to read installer transaction " + std::string(role) + ".");
        }
        return bytes;
    }

    void validateRecordedTransactionName(
        const std::wstring& recordedName,
        const std::filesystem::path& expectedPath,
        std::string_view role)
    {
        const std::filesystem::path recordedPath(recordedName);
        if (recordedPath.empty() ||
            recordedPath.has_root_path() ||
            recordedPath.has_parent_path() ||
            recordedPath.filename() != recordedPath ||
            recordedPath != expectedPath.filename())
        {
            throw std::runtime_error(
                "Installer transaction marker contains an untrusted " + std::string(role) + " path.");
        }
    }

    InstallerTransactionMarker readTransactionMarker(
        const std::filesystem::path& installDirectory,
        const std::filesystem::path& markerPath)
    {
        const std::vector<unsigned char> bytes = readTransactionFile(
            markerPath,
            MaximumTransactionMarkerBytes,
            "marker");
        TransactionMarkerReader reader(bytes);

        std::array<unsigned char, TransactionMagic.size()> magic{};
        reader.readExact(magic.data(), magic.size(), "magic");
        if (magic != TransactionMagic || reader.readPod<std::uint32_t>("version") != TransactionVersion)
        {
            throw std::runtime_error("Installer transaction marker has an unsupported format.");
        }

        const std::uint8_t hadExistingInstall = reader.readPod<std::uint8_t>("existing-install flag");
        if (hadExistingInstall > 1)
        {
            throw std::runtime_error("Installer transaction marker has an invalid existing-install flag.");
        }

        InstallerTransactionMarker marker;
        marker.paths.markerPath = markerPath;
        marker.hadExistingInstall = hadExistingInstall != 0;
        reader.readExact(marker.paths.id.data(), marker.paths.id.size(), "transaction id");
        const std::wstring stagingName = fromUtf8(reader.readString("staging path"));
        const std::wstring backupName = fromUtf8(reader.readString("backup path"));
        if (!reader.atEnd())
        {
            throw std::runtime_error("Installer transaction marker contains trailing data.");
        }

        const std::filesystem::path expectedStaging = ownedTransactionSibling(
            installDirectory,
            L"staging",
            marker.paths.id);
        const std::filesystem::path expectedBackup = ownedTransactionSibling(
            installDirectory,
            L"backup",
            marker.paths.id);
        validateRecordedTransactionName(stagingName, expectedStaging, "staging");
        validateRecordedTransactionName(backupName, expectedBackup, "backup");
        marker.paths.stagingDirectory = installDirectory.parent_path() / stagingName;
        marker.paths.backupDirectory = installDirectory.parent_path() / backupName;
        return marker;
    }

    void writeDurableNewFile(
        const std::filesystem::path& path,
        const std::vector<unsigned char>& bytes,
        std::string_view role)
    {
#ifdef _WIN32
        const HANDLE handle = CreateFileW(
            path.c_str(),
            GENERIC_WRITE,
            0,
            nullptr,
            CREATE_NEW,
            FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_WRITE_THROUGH,
            nullptr);
        if (handle == INVALID_HANDLE_VALUE)
        {
            throw std::runtime_error(
                "Failed to create installer transaction " + std::string(role) + ".");
        }

        DWORD failure = ERROR_SUCCESS;
        std::size_t offset = 0;
        while (offset < bytes.size())
        {
            const DWORD chunk = static_cast<DWORD>(std::min<std::size_t>(
                bytes.size() - offset,
                static_cast<std::size_t>(std::numeric_limits<DWORD>::max())));
            DWORD written = 0;
            if (!WriteFile(handle, bytes.data() + offset, chunk, &written, nullptr) || written != chunk)
            {
                failure = GetLastError();
                break;
            }
            offset += written;
        }
        if (failure == ERROR_SUCCESS && !FlushFileBuffers(handle))
        {
            failure = GetLastError();
        }
        CloseHandle(handle);

        if (failure != ERROR_SUCCESS)
        {
            DeleteFileW(path.c_str());
            throw std::runtime_error(
                "Failed to persist installer transaction " + std::string(role) + ".");
        }
#else
        std::ofstream output(path, std::ios::out | std::ios::binary | std::ios::trunc);
        output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        output.flush();
        if (!output)
        {
            throw std::runtime_error(
                "Failed to persist installer transaction " + std::string(role) + ".");
        }
#endif
    }

    void persistTransactionMarker(
        const InstallerTransactionPaths& transaction,
        bool hadExistingInstall)
    {
        const std::vector<unsigned char> marker = serializeTransactionMarker(
            transaction,
            hadExistingInstall);
        std::filesystem::path temporaryMarker = transaction.markerPath;
        temporaryMarker += L".tmp-" + fromUtf8(transactionIdHex(transaction.id));

        writeDurableNewFile(temporaryMarker, marker, "marker temporary file");
#ifdef _WIN32
        if (!MoveFileExW(
                temporaryMarker.c_str(),
                transaction.markerPath.c_str(),
                MOVEFILE_WRITE_THROUGH))
        {
            DeleteFileW(temporaryMarker.c_str());
            throw std::runtime_error(
                "Failed to publish the installer transaction marker; another installation may be active.");
        }
#else
        std::error_code error;
        if (std::filesystem::exists(transaction.markerPath, error) || error)
        {
            std::filesystem::remove(temporaryMarker);
            throw std::runtime_error(
                "Failed to publish the installer transaction marker; another installation may be active.");
        }
        std::filesystem::rename(temporaryMarker, transaction.markerPath, error);
        if (error)
        {
            std::filesystem::remove(temporaryMarker);
            throw std::runtime_error("Failed to publish the installer transaction marker.");
        }
#endif
    }

    void persistTransactionSentinel(const InstallerTransactionPaths& transaction)
    {
        const std::string value = transactionIdHex(transaction.id);
        const std::vector<unsigned char> bytes(value.begin(), value.end());
        writeDurableNewFile(
            installTransactionSentinelPath(transaction.stagingDirectory, transaction.id),
            bytes,
            "commit sentinel");
    }

    void removeDurableTransactionFile(
        const std::filesystem::path& path,
        std::string_view role)
    {
        if (!transactionPathExistsWithoutReparse(path, role))
        {
            return;
        }
#ifdef _WIN32
        const HANDLE handle = CreateFileW(
            path.c_str(),
            GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            nullptr,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            nullptr);
        if (handle == INVALID_HANDLE_VALUE)
        {
            throw std::runtime_error(
                "Failed to open installer transaction " + std::string(role) + " for final flush.");
        }
        const BOOL flushed = FlushFileBuffers(handle);
        const DWORD flushError = flushed ? ERROR_SUCCESS : GetLastError();
        CloseHandle(handle);
        if (!flushed)
        {
            throw std::runtime_error(
                "Failed to flush installer transaction " + std::string(role) +
                " before removal. error=" + std::to_string(flushError));
        }
        if (!DeleteFileW(path.c_str()))
        {
            throw std::runtime_error(
                "Failed to remove installer transaction " + std::string(role) + ".");
        }
#else
        std::error_code error;
        if (!std::filesystem::remove(path, error) || error)
        {
            throw std::runtime_error(
                "Failed to remove installer transaction " + std::string(role) + ".");
        }
#endif
    }

    bool directoryHasTransactionSentinel(
        const std::filesystem::path& directory,
        const TransactionId& transactionId)
    {
        const std::filesystem::path sentinel = installTransactionSentinelPath(directory, transactionId);
        if (!transactionPathExistsWithoutReparse(sentinel, "commit sentinel"))
        {
            return false;
        }
        const std::vector<unsigned char> contents = readTransactionFile(
            sentinel,
            256,
            "commit sentinel");
        const std::string expected = transactionIdHex(transactionId);
        return contents.size() == expected.size() &&
            std::equal(contents.begin(), contents.end(), expected.begin());
    }

    bool isVerifiedInstalledDirectory(const std::filesystem::path& installDirectory)
    {
        if (!transactionPathExistsWithoutReparse(installDirectory, "live directory"))
        {
            return false;
        }

        std::error_code error;
        if (!std::filesystem::is_directory(installDirectory, error) || error)
        {
            return false;
        }

        const std::filesystem::path applicationPath = installDirectory / L"Fluxora.exe";
        if (!transactionPathExistsWithoutReparse(applicationPath, "live executable"))
        {
            return false;
        }
        return std::filesystem::is_regular_file(applicationPath, error) && !error;
    }

    void recoverInstallTransaction(const std::filesystem::path& installDirectory)
    {
        const std::filesystem::path markerPath = installTransactionMarkerPath(installDirectory);
        if (!transactionPathExistsWithoutReparse(markerPath, "marker"))
        {
            return;
        }

        const InstallerTransactionMarker marker = readTransactionMarker(installDirectory, markerPath);
        const bool liveExists = transactionPathExistsWithoutReparse(
            installDirectory,
            "live directory");
        const bool stagingExists = transactionPathExistsWithoutReparse(
            marker.paths.stagingDirectory,
            "staging directory");
        const bool backupExists = transactionPathExistsWithoutReparse(
            marker.paths.backupDirectory,
            "backup directory");
        const bool liveHasSentinel = liveExists && directoryHasTransactionSentinel(
            installDirectory,
            marker.paths.id);
        const bool stagingHasSentinel = stagingExists && directoryHasTransactionSentinel(
            marker.paths.stagingDirectory,
            marker.paths.id);

        if (liveHasSentinel)
        {
            if (stagingExists || !isVerifiedInstalledDirectory(installDirectory))
            {
                throw std::runtime_error(
                    "Installer transaction recovery found an ambiguous committed installation state.");
            }
            if (backupExists)
            {
                removeOwnedTransactionDirectory(marker.paths.backupDirectory, "backup directory");
            }
            removeDurableTransactionFile(
                installTransactionSentinelPath(installDirectory, marker.paths.id),
                "commit sentinel");
            removeDurableTransactionFile(marker.paths.markerPath, "marker");
            writeLog("INFO", "Recovered and finalized a committed installer directory transaction.");
            return;
        }

        if (!liveExists && marker.hadExistingInstall && backupExists)
        {
            renameDirectory(
                marker.paths.backupDirectory,
                installDirectory,
                "Restoring the interrupted Fluxora installation");
            if (stagingExists)
            {
                if (!stagingHasSentinel)
                {
                    throw std::runtime_error(
                        "Installer transaction recovery refused an unverified staging directory.");
                }
                removeOwnedTransactionDirectory(marker.paths.stagingDirectory, "staging directory");
            }
            removeDurableTransactionFile(marker.paths.markerPath, "marker");
            writeLog("INFO", "Recovered the previous installation after an interrupted directory swap.");
            return;
        }

        if (!liveExists && !marker.hadExistingInstall && !backupExists && stagingHasSentinel)
        {
            removeOwnedTransactionDirectory(marker.paths.stagingDirectory, "staging directory");
            removeDurableTransactionFile(marker.paths.markerPath, "marker");
            writeLog("INFO", "Cleaned an abandoned staging directory from an interrupted new installation.");
            return;
        }

        if (liveExists && marker.hadExistingInstall && stagingHasSentinel && !backupExists)
        {
            removeOwnedTransactionDirectory(marker.paths.stagingDirectory, "staging directory");
            removeDurableTransactionFile(marker.paths.markerPath, "marker");
            writeLog("INFO", "Cleaned an abandoned staging directory before the live-directory swap.");
            return;
        }

        if (liveExists && !stagingExists && !backupExists &&
            (marker.hadExistingInstall || isVerifiedInstalledDirectory(installDirectory)))
        {
            removeDurableTransactionFile(marker.paths.markerPath, "marker");
            writeLog("INFO", "Finalized installer transaction metadata after directory commit cleanup.");
            return;
        }

        throw std::runtime_error(
            "Installer transaction marker describes an unsafe or ambiguous recovery state; no paths were changed.");
    }

    bool isWindowsReservedPathComponent(std::wstring_view component)
    {
        const std::size_t extensionSeparator = component.find(L'.');
        std::wstring deviceName(component.substr(0, extensionSeparator));
        std::transform(deviceName.begin(), deviceName.end(), deviceName.begin(), [](wchar_t value) {
            return static_cast<wchar_t>(std::towupper(value));
        });

        if (deviceName == L"CON" ||
            deviceName == L"PRN" ||
            deviceName == L"AUX" ||
            deviceName == L"NUL" ||
            deviceName == L"CLOCK$" ||
            deviceName == L"CONIN$" ||
            deviceName == L"CONOUT$")
        {
            return true;
        }

        if (deviceName.size() != 4 ||
            (deviceName.substr(0, 3) != L"COM" && deviceName.substr(0, 3) != L"LPT"))
        {
            return false;
        }

        const wchar_t suffix = deviceName.back();
        return (suffix >= L'1' && suffix <= L'9') ||
            suffix == L'\u00B9' ||
            suffix == L'\u00B2' ||
            suffix == L'\u00B3';
    }

    std::wstring windowsNormalizedOutputPathKey(const std::filesystem::path& relativePath)
    {
        std::wstring normalized = relativePath.lexically_normal().generic_wstring();
#ifdef _WIN32
        if (normalized.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))
        {
            throw std::runtime_error("Package output path is too long to normalize.");
        }

        const int sourceLength = static_cast<int>(normalized.size());
        const int requiredLength = LCMapStringEx(
            LOCALE_NAME_INVARIANT,
            LCMAP_LOWERCASE,
            normalized.data(),
            sourceLength,
            nullptr,
            0,
            nullptr,
            nullptr,
            0);
        if (requiredLength <= 0)
        {
            throw std::runtime_error("Failed to normalize a package output path for Windows.");
        }

        std::wstring folded(static_cast<std::size_t>(requiredLength), L'\0');
        if (LCMapStringEx(
                LOCALE_NAME_INVARIANT,
                LCMAP_LOWERCASE,
                normalized.data(),
                sourceLength,
                folded.data(),
                requiredLength,
                nullptr,
                nullptr,
                0) != requiredLength)
        {
            throw std::runtime_error("Failed to normalize a package output path for Windows.");
        }
        return folded;
#else
        std::transform(normalized.begin(), normalized.end(), normalized.begin(), [](wchar_t value) {
            return static_cast<wchar_t>(std::towlower(value));
        });
        return normalized;
#endif
    }

    bool isProtectedDownloadsOutputPath(const std::wstring& normalizedOutputPath)
    {
        constexpr std::wstring_view protectedDirectory = L"downloads";
        return normalizedOutputPath == protectedDirectory ||
            (normalizedOutputPath.size() > protectedDirectory.size() &&
             normalizedOutputPath.compare(0, protectedDirectory.size(), protectedDirectory) == 0 &&
             normalizedOutputPath[protectedDirectory.size()] == L'/');
    }

    std::filesystem::path resolvePackageEntryPath(
        const std::filesystem::path& installRoot,
        const std::wstring& relativePathText)
    {
        if (relativePathText.empty())
        {
            throw std::runtime_error("Package contains an empty path.");
        }

        std::filesystem::path relative(relativePathText);
        if (relative.is_absolute())
        {
            throw std::runtime_error("Package contains an absolute path.");
        }

        for (const std::filesystem::path& part : relative)
        {
            const std::wstring text = part.wstring();
            if (text == L"." || text == L".." || text.find(L':') != std::wstring::npos)
            {
                throw std::runtime_error("Package contains an unsafe path.");
            }
            if (!text.empty() && (text.back() == L'.' || text.back() == L' '))
            {
                throw std::runtime_error(
                    "Package path component has a trailing dot or space that aliases another Windows path.");
            }
            if (isWindowsReservedPathComponent(text))
            {
                throw std::runtime_error("Package contains a Windows-reserved path component.");
            }
        }

        const std::filesystem::path destination = (installRoot / relative).lexically_normal();
        if (!pathStartsWith(destination, installRoot))
        {
            throw std::runtime_error("Package path escapes the selected install directory.");
        }

        return destination;
    }

    enum class ProtectedDownloadsPathKind
    {
        Missing,
        Directory,
        RegularFile,
        Other
    };

    struct ProtectedDownloadsCopyStats
    {
        std::uint64_t fileCount{0};
        std::uint64_t byteCount{0};
    };

    ProtectedDownloadsPathKind inspectProtectedDownloadsPath(
        const std::filesystem::path& path)
    {
#ifdef _WIN32
        const DWORD attributes = GetFileAttributesW(path.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES)
        {
            const DWORD error = GetLastError();
            if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND)
            {
                return ProtectedDownloadsPathKind::Missing;
            }

            throw std::runtime_error(
                "Failed to inspect the protected Downloads path: " +
                toUtf8(path.wstring()) + ". Windows error " + std::to_string(error) + ".");
        }

        if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        {
            throw std::runtime_error(
                "The protected Downloads directory cannot contain a symbolic link, junction or reparse point: " +
                toUtf8(path.wstring()));
        }
        if ((attributes & FILE_ATTRIBUTE_DIRECTORY) != 0)
        {
            return ProtectedDownloadsPathKind::Directory;
        }
        if ((attributes & FILE_ATTRIBUTE_DEVICE) == 0)
        {
            return ProtectedDownloadsPathKind::RegularFile;
        }
        return ProtectedDownloadsPathKind::Other;
#else
        std::error_code error;
        const std::filesystem::file_status status = std::filesystem::symlink_status(path, error);
        if (error == std::errc::no_such_file_or_directory ||
            status.type() == std::filesystem::file_type::not_found)
        {
            return ProtectedDownloadsPathKind::Missing;
        }
        if (error)
        {
            throw std::runtime_error(
                "Failed to inspect the protected Downloads path: " +
                toUtf8(path.wstring()) + ". " + error.message());
        }
        if (std::filesystem::is_symlink(status))
        {
            throw std::runtime_error(
                "The protected Downloads directory cannot contain a symbolic link, junction or reparse point: " +
                toUtf8(path.wstring()));
        }
        if (std::filesystem::is_directory(status))
        {
            return ProtectedDownloadsPathKind::Directory;
        }
        if (std::filesystem::is_regular_file(status))
        {
            return ProtectedDownloadsPathKind::RegularFile;
        }
        return ProtectedDownloadsPathKind::Other;
#endif
    }

    void createProtectedDownloadsDirectory(const std::filesystem::path& path)
    {
        std::error_code error;
        if (!std::filesystem::create_directory(path, error) || error)
        {
            throw std::runtime_error(
                "Failed to create the staged Downloads directory: " +
                toUtf8(path.wstring()) + ". " + error.message());
        }
    }

    void copyProtectedDownloadsDirectory(
        const std::filesystem::path& source,
        const std::filesystem::path& destination,
        ProtectedDownloadsCopyStats& stats)
    {
        if (inspectProtectedDownloadsPath(source) != ProtectedDownloadsPathKind::Directory)
        {
            throw std::runtime_error(
                "The protected Downloads path changed or is not a directory: " +
                toUtf8(source.wstring()));
        }

        createProtectedDownloadsDirectory(destination);

        std::error_code iteratorError;
        std::filesystem::directory_iterator iterator(
            source,
            std::filesystem::directory_options::none,
            iteratorError);
        if (iteratorError)
        {
            throw std::runtime_error(
                "Failed to enumerate the protected Downloads directory: " +
                toUtf8(source.wstring()) + ". " + iteratorError.message());
        }

        const std::filesystem::directory_iterator end;
        while (iterator != end)
        {
            const std::filesystem::path sourceEntry = iterator->path();
            const std::filesystem::path destinationEntry = destination / sourceEntry.filename();
            const ProtectedDownloadsPathKind kind = inspectProtectedDownloadsPath(sourceEntry);
            if (kind == ProtectedDownloadsPathKind::Directory)
            {
                copyProtectedDownloadsDirectory(sourceEntry, destinationEntry, stats);
            }
            else if (kind == ProtectedDownloadsPathKind::RegularFile)
            {
                std::error_code copyError;
                std::filesystem::copy_file(
                    sourceEntry,
                    destinationEntry,
                    std::filesystem::copy_options::none,
                    copyError);
                if (copyError)
                {
                    throw std::runtime_error(
                        "Failed to stage a protected Downloads file: " +
                        toUtf8(sourceEntry.wstring()) + ". " + copyError.message());
                }

                std::error_code sizeError;
                const std::uintmax_t fileBytes = std::filesystem::file_size(sourceEntry, sizeError);
                if (sizeError || fileBytes > std::numeric_limits<std::uint64_t>::max() - stats.byteCount)
                {
                    throw std::runtime_error(
                        "Failed to measure a staged Downloads file: " +
                        toUtf8(sourceEntry.wstring()));
                }
                ++stats.fileCount;
                stats.byteCount += static_cast<std::uint64_t>(fileBytes);
            }
            else
            {
                throw std::runtime_error(
                    "The protected Downloads directory contains an unsupported filesystem entry: " +
                    toUtf8(sourceEntry.wstring()));
            }

            iterator.increment(iteratorError);
            if (iteratorError)
            {
                throw std::runtime_error(
                    "Failed while enumerating the protected Downloads directory: " +
                    toUtf8(source.wstring()) + ". " + iteratorError.message());
            }
        }
    }

    void stageProtectedDownloadsDirectory(
        const std::filesystem::path& liveInstallDirectory,
        const std::filesystem::path& stagingDirectory,
        bool replacingExisting)
    {
        const std::filesystem::path stagedDownloads = stagingDirectory / L"Downloads";
        if (!replacingExisting)
        {
            createProtectedDownloadsDirectory(stagedDownloads);
            writeLog("INFO", "Created an empty protected Downloads directory for the first installation.");
            return;
        }

        const std::filesystem::path liveDownloads = liveInstallDirectory / L"Downloads";
        const ProtectedDownloadsPathKind liveKind = inspectProtectedDownloadsPath(liveDownloads);
        if (liveKind == ProtectedDownloadsPathKind::Missing)
        {
            createProtectedDownloadsDirectory(stagedDownloads);
            writeLog("INFO", "The existing installation has no Downloads directory; staged an empty one.");
            return;
        }
        if (liveKind != ProtectedDownloadsPathKind::Directory)
        {
            throw std::runtime_error(
                "The protected Downloads path in the existing installation is not a directory: " +
                toUtf8(liveDownloads.wstring()));
        }

        ProtectedDownloadsCopyStats stats;
        copyProtectedDownloadsDirectory(liveDownloads, stagedDownloads, stats);
        std::ostringstream stream;
        stream << "Protected Downloads directory staged for the atomic update. source=\""
               << toUtf8(liveDownloads.wstring())
               << "\", files=" << stats.fileCount
               << ", bytes=" << stats.byteCount;
        writeLog("INFO", stream.str());
    }

    void emitProgress(
        FluxoraInstallerProgressCallback callback,
        void* userData,
        InstallerProgressState& state,
        std::wstring phase,
        std::wstring currentItem,
        std::uint64_t copiedBytes,
        std::uint64_t totalBytes,
        bool force = false)
    {
        if (callback == nullptr)
        {
            return;
        }

        const auto now = std::chrono::steady_clock::now();
        const double percent = totalBytes == 0
            ? 0.0
            : std::min(100.0, (static_cast<double>(copiedBytes) / static_cast<double>(totalBytes)) * 100.0);
        const bool phaseChanged = !state.hasReport || state.lastPhase != phase;
        const bool terminal = isTerminalProgressPhase(phase);
        const bool copyCompleted = totalBytes > 0 && copiedBytes >= totalBytes;
        const double percentDelta = percent >= state.lastPercent
            ? percent - state.lastPercent
            : state.lastPercent - percent;
        const bool percentAdvanced = percentDelta >= ProgressCallbackMinimumPercentDelta ||
            (percent >= 100.0 && state.lastPercent < 100.0);
        if (!force &&
            !phaseChanged &&
            !terminal &&
            !copyCompleted &&
            state.hasReport &&
            (now - state.lastReport < ProgressCallbackMinimumInterval || !percentAdvanced))
        {
            writeProgressDebugLog(phase, currentItem, copiedBytes, totalBytes, false);
            return;
        }

        state.hasReport = true;
        state.lastReport = now;
        state.lastPhase = phase;
        state.lastPercent = percent;

        std::wostringstream json;
        json << L"{"
             << L"\"phase\":\"" << jsonEscape(phase) << L"\","
             << L"\"currentItem\":\"" << jsonEscape(currentItem) << L"\","
             << L"\"percent\":" << std::fixed << std::setprecision(1) << percent << L","
             << L"\"copiedBytes\":" << copiedBytes << L","
             << L"\"totalBytes\":" << totalBytes
             << L"}";

        callback(json.str().c_str(), userData);
        writeProgressDebugLog(phase, currentItem, copiedBytes, totalBytes, true);
    }

    void skipBytes(PackageReader& reader, std::uint64_t byteCount)
    {
        std::array<char, CopyBufferSize> buffer{};
        std::uint64_t remaining = byteCount;
        while (remaining > 0)
        {
            const std::size_t chunkSize = static_cast<std::size_t>(
                std::min<std::uint64_t>(remaining, buffer.size()));
            reader.readExact(buffer.data(), chunkSize, "entry payload");
            remaining -= chunkSize;
        }
    }

    void copyFileFromPackage(
        PackageReader& package,
        const std::filesystem::path& destination,
        std::uint64_t fileSize,
        const std::array<unsigned char, Sha256HashSize>* expectedHash,
        std::uint64_t& copiedBytes,
        std::uint64_t totalBytes,
        const std::wstring& currentItem,
        FluxoraInstallerProgressCallback callback,
        void* userData,
        InstallerProgressState& progressState)
    {
        std::filesystem::create_directories(destination.parent_path());

        std::ofstream output(destination, std::ios::out | std::ios::trunc | std::ios::binary);
        if (!output)
        {
            throw std::runtime_error("Failed to write installed file: " + toUtf8(destination.wstring()));
        }

        std::array<char, CopyBufferSize> buffer{};
        std::uint64_t remaining = fileSize;
#ifdef _WIN32
        std::unique_ptr<Sha256Hasher> hasher;
        if (expectedHash != nullptr)
        {
            hasher = std::make_unique<Sha256Hasher>();
        }
#endif
        while (remaining > 0)
        {
            const std::size_t chunkSize = static_cast<std::size_t>(
                std::min<std::uint64_t>(remaining, buffer.size()));
            package.readExact(buffer.data(), chunkSize, "entry payload");

            output.write(buffer.data(), static_cast<std::streamsize>(chunkSize));
            if (!output)
            {
                throw std::runtime_error("Failed to write installed file.");
            }

#ifdef _WIN32
            if (hasher)
            {
                hasher->append(buffer.data(), chunkSize);
            }
#endif
            remaining -= chunkSize;
            copiedBytes += chunkSize;
            emitProgress(callback, userData, progressState, L"copying", currentItem, copiedBytes, totalBytes);
        }

        output.flush();
        if (!output)
        {
            throw std::runtime_error("Failed to flush installed file: " + toUtf8(destination.wstring()));
        }

#ifdef _WIN32
        if (expectedHash != nullptr && hasher)
        {
            const std::array<unsigned char, Sha256HashSize> actualHash = hasher->finish();
            if (actualHash != *expectedHash)
            {
                throw std::runtime_error("Payload integrity check failed for: " + toUtf8(currentItem));
            }
        }
#else
        (void)expectedHash;
#endif
    }

    std::filesystem::path desktopShortcutPath()
    {
#ifdef _WIN32
        PWSTR desktopPath = nullptr;
        if (FAILED(SHGetKnownFolderPath(FOLDERID_Desktop, 0, nullptr, &desktopPath)) || desktopPath == nullptr)
        {
            throw std::runtime_error("Failed to locate the desktop folder.");
        }

        std::filesystem::path path(desktopPath);
        CoTaskMemFree(desktopPath);
        return path / L"Fluxora.lnk";
#else
        throw std::runtime_error("Desktop shortcuts are currently supported on Windows only.");
#endif
    }

    std::filesystem::path resolveInstalledApplicationPath(const std::filesystem::path& installDirectory)
    {
        const std::filesystem::path candidate = installDirectory / L"Fluxora.exe";
        if (std::filesystem::exists(candidate))
        {
            return candidate;
        }

        throw std::runtime_error("Installed package is missing Fluxora.exe.");
    }

#ifdef _WIN32
    class ScopedComApartment final
    {
    public:
        ScopedComApartment()
        {
            const HRESULT result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
            if (result == RPC_E_CHANGED_MODE)
            {
                return;
            }
            if (FAILED(result))
            {
                throw std::runtime_error("Failed to initialize Windows shortcut services.");
            }
            shouldUninitialize_ = true;
        }

        ScopedComApartment(const ScopedComApartment&) = delete;
        ScopedComApartment& operator=(const ScopedComApartment&) = delete;

        ~ScopedComApartment()
        {
            if (shouldUninitialize_)
            {
                CoUninitialize();
            }
        }

    private:
        bool shouldUninitialize_{false};
    };

    struct ComInterfaceReleaser
    {
        template <typename Interface>
        void operator()(Interface* value) const noexcept
        {
            if (value != nullptr)
            {
                value->Release();
            }
        }
    };

    template <typename Interface>
    using ComInterfacePtr = std::unique_ptr<Interface, ComInterfaceReleaser>;

    void requireShortcutResult(HRESULT result, std::string_view operation)
    {
        if (SUCCEEDED(result))
        {
            return;
        }

        std::ostringstream stream;
        stream << "Failed to " << operation << " while creating the desktop shortcut. HRESULT=0x"
               << std::hex << std::uppercase << static_cast<unsigned long>(result) << '.';
        throw std::runtime_error(stream.str());
    }

    std::filesystem::path allocateShortcutTemporaryPath(const std::filesystem::path& shortcut)
    {
        for (std::uint64_t attempt = 0; attempt < 128; ++attempt)
        {
            std::filesystem::path candidate = transactionSiblingPath(shortcut, L"shortcut", attempt);
            candidate += L".tmp";

            std::error_code error;
            const bool exists = std::filesystem::exists(candidate, error);
            if (error)
            {
                throw std::runtime_error(
                    "Failed to inspect a temporary desktop shortcut path: " + error.message());
            }
            if (!exists)
            {
                return candidate;
            }
        }

        throw std::runtime_error("Failed to allocate a temporary desktop shortcut path.");
    }

    class TemporaryShortcutCleanup final
    {
    public:
        explicit TemporaryShortcutCleanup(std::filesystem::path path)
            : path_(std::move(path))
        {
        }

        TemporaryShortcutCleanup(const TemporaryShortcutCleanup&) = delete;
        TemporaryShortcutCleanup& operator=(const TemporaryShortcutCleanup&) = delete;

        ~TemporaryShortcutCleanup()
        {
            if (!active_)
            {
                return;
            }

            std::error_code error;
            std::filesystem::remove(path_, error);
            if (error)
            {
                writeLog(
                    "WARNING",
                    std::string("Failed to clean temporary desktop shortcut. path=\"") +
                        toUtf8(path_.wstring()) + "\", error=\"" + error.message() + "\"");
            }
        }

        void dismiss() noexcept
        {
            active_ = false;
        }

    private:
        std::filesystem::path path_;
        bool active_{true};
    };

    void commitDesktopShortcut(
        const std::filesystem::path& temporaryShortcut,
        const std::filesystem::path& shortcut)
    {
        std::error_code error;
        const bool replacingExisting = std::filesystem::exists(shortcut, error);
        if (error)
        {
            throw std::runtime_error("Failed to inspect the existing desktop shortcut: " + error.message());
        }

        BOOL committed = FALSE;
        if (replacingExisting)
        {
            committed = ReplaceFileW(
                shortcut.c_str(),
                temporaryShortcut.c_str(),
                nullptr,
                REPLACEFILE_WRITE_THROUGH,
                nullptr,
                nullptr);
        }
        else
        {
            committed = MoveFileExW(
                temporaryShortcut.c_str(),
                shortcut.c_str(),
                MOVEFILE_WRITE_THROUGH);
        }

        if (!committed)
        {
            const std::error_code windowsError(
                static_cast<int>(GetLastError()),
                std::system_category());
            throw std::runtime_error(
                "Failed to atomically publish the desktop shortcut: " + windowsError.message());
        }
    }
#endif

    std::filesystem::path createDesktopShortcut(const std::filesystem::path& applicationPath)
    {
#ifdef _WIN32
        const ScopedComApartment apartment;

        IShellLinkW* rawShellLink = nullptr;
        requireShortcutResult(CoCreateInstance(
            CLSID_ShellLink,
            nullptr,
            CLSCTX_INPROC_SERVER,
            IID_IShellLinkW,
            reinterpret_cast<void**>(&rawShellLink)),
            "create the Windows shell-link object");
        if (rawShellLink == nullptr)
        {
            throw std::runtime_error("Failed to create a Windows shortcut.");
        }
        ComInterfacePtr<IShellLinkW> shellLink(rawShellLink);

        const std::wstring target = applicationPath.wstring();
        const std::wstring workingDirectory = applicationPath.parent_path().wstring();
        requireShortcutResult(shellLink->SetPath(target.c_str()), "set the shortcut target");
        requireShortcutResult(
            shellLink->SetWorkingDirectory(workingDirectory.c_str()),
            "set the shortcut working directory");
        requireShortcutResult(
            shellLink->SetDescription(L"Fluxora Mod Manager"),
            "set the shortcut description");
        requireShortcutResult(
            shellLink->SetIconLocation(target.c_str(), 0),
            "set the shortcut icon");

        IPersistFile* rawPersistFile = nullptr;
        requireShortcutResult(
            shellLink->QueryInterface(IID_IPersistFile, reinterpret_cast<void**>(&rawPersistFile)),
            "open the shortcut persistence interface");
        if (rawPersistFile == nullptr)
        {
            throw std::runtime_error("Failed to save a Windows shortcut.");
        }
        ComInterfacePtr<IPersistFile> persistFile(rawPersistFile);

        const std::filesystem::path shortcut = desktopShortcutPath();
        std::error_code directoryError;
        std::filesystem::create_directories(shortcut.parent_path(), directoryError);
        if (directoryError)
        {
            throw std::runtime_error(
                "Failed to prepare the desktop shortcut directory: " + directoryError.message());
        }

        const std::filesystem::path temporaryShortcut = allocateShortcutTemporaryPath(shortcut);
        TemporaryShortcutCleanup temporaryCleanup(temporaryShortcut);
        requireShortcutResult(
            persistFile->Save(temporaryShortcut.c_str(), TRUE),
            "write the temporary desktop shortcut");
        commitDesktopShortcut(temporaryShortcut, shortcut);
        temporaryCleanup.dismiss();

        return shortcut;
#else
        (void)applicationPath;
        throw std::runtime_error("Desktop shortcuts are currently supported on Windows only.");
#endif
    }

    InstallResult installPackageFromReader(
        PackageReader& package,
        const std::filesystem::path& installDirectory,
        bool shouldCreateDesktopShortcut,
        FluxoraInstallerProgressCallback callback,
        void* userData,
        InstallerProgressState& progressState)
    {
        const std::filesystem::path validatedInstallDirectory = validateInstallDirectory(installDirectory);
        const PackageHeader header = readHeader(package);
        const InstallerTransactionPaths transaction = createStagingTransaction(validatedInstallDirectory);
        const std::filesystem::path& stagingDirectory = transaction.stagingDirectory;
        TransactionDirectoryCleanup stagingCleanup(stagingDirectory, "staging directory");
        {
            std::ostringstream stream;
            stream << "Installer package validated. source=\""
                   << package.sourceDescription()
                   << "\", installDirectory=\""
                   << toUtf8(validatedInstallDirectory.wstring())
                   << "\", stagingDirectory=\""
                   << toUtf8(stagingDirectory.wstring())
                   << "\", version=" << header.version
                   << ", entries=" << header.entryCount
                   << ", totalBytes=" << header.totalBytes
                   << ", createDesktopShortcut=" << (shouldCreateDesktopShortcut ? "true" : "false");
            writeLog("INFO", stream.str());
        }
        emitProgress(callback, userData, progressState, L"preparing", L"", 0, header.totalBytes, true);

        std::uint64_t copiedBytes = 0;
        std::unordered_set<std::wstring> outputTargets;
        for (std::uint64_t index = 0; index < header.entryCount; ++index)
        {
            const std::uint8_t entryType = readPod<std::uint8_t>(package, "entry type");
            const std::wstring relativePath = readRelativePath(package);
            const std::uint64_t byteCount = readPod<std::uint64_t>(package, "entry size");
            const std::filesystem::path destination = resolvePackageEntryPath(
                stagingDirectory,
                relativePath);
            const std::wstring normalizedOutputPath = windowsNormalizedOutputPathKey(relativePath);
            if (isProtectedDownloadsOutputPath(normalizedOutputPath))
            {
                throw std::runtime_error(
                    "Installer payload cannot contain the protected Downloads directory.");
            }
            if (!outputTargets.insert(normalizedOutputPath).second)
            {
                throw std::runtime_error(
                    "Package contains a duplicate output path after Windows normalization.");
            }

            if (entryType == 0)
            {
                std::filesystem::create_directories(destination);
                if (byteCount != 0)
                {
                    skipBytes(package, byteCount);
                }
                continue;
            }

            if (entryType != 1)
            {
                throw std::runtime_error("Package contains an unknown entry type.");
            }

            std::array<unsigned char, Sha256HashSize> expectedHash{};
            const std::array<unsigned char, Sha256HashSize>* expectedHashPtr = nullptr;
            if (header.version >= PackageVersionWithFileHashes)
            {
                expectedHash = readSha256(package);
                expectedHashPtr = &expectedHash;
            }

            copyFileFromPackage(
                package,
                destination,
                byteCount,
                expectedHashPtr,
                copiedBytes,
                header.totalBytes,
                relativePath,
                callback,
                userData,
                progressState);
        }

        if (copiedBytes != header.totalBytes)
        {
            throw std::runtime_error("Payload manifest byte count does not match copied bytes.");
        }

        const std::filesystem::path stagedApplicationPath = resolveInstalledApplicationPath(stagingDirectory);
        const std::wstring applicationFileName = stagedApplicationPath.filename().wstring();

        writeLog(
            "INFO",
            std::string("Installer staging verified. path=\"") +
                toUtf8(stagingDirectory.wstring()) + "\"");
        emitProgress(callback, userData, progressState, L"finalizing", applicationFileName, header.totalBytes, header.totalBytes, true);

        rejectReparseInstallDirectory(validatedInstallDirectory);
        std::error_code existsError;
        const bool replacingExisting = std::filesystem::exists(validatedInstallDirectory, existsError);
        if (existsError)
        {
            throw std::runtime_error(
                "Failed to inspect existing installation: " + existsError.message());
        }

        stageProtectedDownloadsDirectory(
            validatedInstallDirectory,
            stagingDirectory,
            replacingExisting);

        persistTransactionSentinel(transaction);
        persistTransactionMarker(transaction, replacingExisting);

        std::filesystem::path backupDirectory = transaction.backupDirectory;
        std::filesystem::path applicationPath;
        bool existingMovedToBackup = false;
        bool stagingMovedToInstall = false;
        try
        {
            if (replacingExisting)
            {
                renameDirectory(
                    validatedInstallDirectory,
                    backupDirectory,
                    "Backing up the existing Fluxora installation");
                existingMovedToBackup = true;
                writeLog(
                    "INFO",
                    std::string("Existing installation backed up. path=\"") +
                        toUtf8(backupDirectory.wstring()) + "\"");
            }

            renameDirectory(
                stagingDirectory,
                validatedInstallDirectory,
                "Committing the staged Fluxora installation");
            stagingMovedToInstall = true;
            applicationPath = resolveInstalledApplicationPath(validatedInstallDirectory);
        }
        catch (...)
        {
            const std::exception_ptr originalFailure = std::current_exception();
            writeLog("WARNING", "Installer commit failed. Rolling back the installation directory swap.");

            try
            {
                if (stagingMovedToInstall)
                {
                    renameDirectory(
                        validatedInstallDirectory,
                        stagingDirectory,
                        "Moving the failed staged installation out of the live path");
                    stagingMovedToInstall = false;
                }

                if (existingMovedToBackup)
                {
                    renameDirectory(
                        backupDirectory,
                        validatedInstallDirectory,
                        "Restoring the previous Fluxora installation");
                    existingMovedToBackup = false;
                }

                writeLog("INFO", "Installer rollback completed.");
                try
                {
                    removeOwnedTransactionDirectory(stagingDirectory, "staging directory");
                    stagingCleanup.dismiss();
                    removeDurableTransactionFile(transaction.markerPath, "marker");
                }
                catch (const std::exception& cleanupError)
                {
                    writeLog(
                        "WARNING",
                        std::string("Rollback completed, but durable transaction cleanup was deferred. ") +
                            cleanupError.what());
                }
            }
            catch (const std::exception& rollbackError)
            {
                writeLog("ERROR", std::string("Installer rollback failed. ") + rollbackError.what());
                throw std::runtime_error(
                    std::string("Fluxora installation failed and rollback could not restore the previous installation. ") +
                    rollbackError.what());
            }

            std::rethrow_exception(originalFailure);
        }

        stagingCleanup.dismiss();
        try
        {
            if (existingMovedToBackup)
            {
                removeOwnedTransactionDirectory(backupDirectory, "backup directory");
                existingMovedToBackup = false;
            }
            removeDurableTransactionFile(
                installTransactionSentinelPath(validatedInstallDirectory, transaction.id),
                "commit sentinel");
            removeDurableTransactionFile(transaction.markerPath, "marker");
        }
        catch (const std::exception& cleanupError)
        {
            writeLog(
                "WARNING",
                std::string("Installation committed; durable transaction cleanup was deferred. ") +
                    cleanupError.what());
        }

        writeLog(
            "INFO",
            std::string("Staged installation committed. installDirectory=\"") +
                toUtf8(validatedInstallDirectory.wstring()) + "\"");

        InstallResult result;
        result.installDirectory = validatedInstallDirectory;
        result.applicationPath = applicationPath;

        if (shouldCreateDesktopShortcut)
        {
            try
            {
                result.desktopShortcutPath = createDesktopShortcut(applicationPath);
                result.createdDesktopShortcut = true;
                writeLog(
                    "INFO",
                    std::string("Desktop shortcut created after installer commit. path=\"") +
                        toUtf8(result.desktopShortcutPath.wstring()) + "\"");
            }
            catch (const std::exception& shortcutError)
            {
                result.desktopShortcutPath.clear();
                result.createdDesktopShortcut = false;
                writeLog(
                    "WARNING",
                    std::string("Installation committed, but the desktop shortcut was not changed. ") +
                        shortcutError.what());
            }
            catch (...)
            {
                result.desktopShortcutPath.clear();
                result.createdDesktopShortcut = false;
                writeLog(
                    "WARNING",
                    "Installation committed, but the desktop shortcut was not changed due to an unknown error.");
            }
        }

        emitProgress(callback, userData, progressState, L"completed", L"", header.totalBytes, header.totalBytes, true);
        return result;
    }

    InstallResult installPackage(
        const std::filesystem::path& packagePath,
        const std::filesystem::path& installDirectory,
        bool shouldCreateDesktopShortcut,
        FluxoraInstallerProgressCallback callback,
        void* userData,
        InstallerProgressState& progressState)
    {
        if (packagePath.empty())
        {
            throw std::invalid_argument("Installer package path is required.");
        }

        FilePackageReader package(packagePath);
        return installPackageFromReader(
            package,
            installDirectory,
            shouldCreateDesktopShortcut,
            callback,
            userData,
            progressState);
    }

    InstallResult installPackageStream(
        FluxoraInstallerReadCallback readCallback,
        void* readUserData,
        const std::filesystem::path& installDirectory,
        bool shouldCreateDesktopShortcut,
        FluxoraInstallerProgressCallback callback,
        void* userData,
        InstallerProgressState& progressState)
    {
        CallbackPackageReader package(readCallback, readUserData);
        return installPackageFromReader(
            package,
            installDirectory,
            shouldCreateDesktopShortcut,
            callback,
            userData,
            progressState);
    }

    int mapException(const std::exception& exception, int resultCode)
    {
        lastError = fromUtf8(exception.what());
        writeLog("ERROR", exception.what());
        return resultCode;
    }
}

extern "C"
{
    int fluxora_installer_is_available()
    {
        return 1;
    }

    int fluxora_installer_set_operation_context(const wchar_t* operationId)
    {
        if (isBlank(operationId))
        {
            currentOperationId.clear();
        }
        else
        {
            currentOperationId = toUtf8(operationId);
        }

        return FluxoraInstallerResultOk;
    }

    int fluxora_installer_validate_install_directory(
        const wchar_t* installDirectory,
        wchar_t* messageBuffer,
        int messageBufferLength)
    {
        try
        {
            if (isBlank(installDirectory))
            {
                lastError = L"Install directory is required.";
                return FluxoraInstallerResultInvalidArgument;
            }

            (void)validateInstallDirectory(std::filesystem::path(installDirectory));
            return writeToBuffer(L"OK", messageBuffer, messageBufferLength);
        }
        catch (const std::invalid_argument& exception)
        {
            return mapException(exception, FluxoraInstallerResultInvalidArgument);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception, FluxoraInstallerResultInstallError);
        }
    }

    int fluxora_installer_install_package(
        const wchar_t* packagePath,
        const wchar_t* installDirectory,
        int createDesktopShortcut,
        FluxoraInstallerProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        InstallerProgressState progressState;
        try
        {
            if (isBlank(packagePath) || isBlank(installDirectory))
            {
                lastError = L"Package path and install directory are required.";
                emitProgress(
                    progressCallback,
                    progressUserData,
                    progressState,
                    L"error",
                    lastError,
                    0,
                    0,
                    true);
                return FluxoraInstallerResultInvalidArgument;
            }

            writeLog("INFO", "Starting Fluxora installation.");
            const InstallResult result = installPackage(
                std::filesystem::path(packagePath),
                std::filesystem::path(installDirectory),
                createDesktopShortcut != 0,
                progressCallback,
                progressUserData,
                progressState);
            writeLog("INFO", "Fluxora installation completed.");
            return writeToBuffer(serializeResult(result), jsonBuffer, jsonBufferLength);
        }
        catch (const std::invalid_argument& exception)
        {
            emitProgress(
                progressCallback,
                progressUserData,
                progressState,
                L"error",
                fromUtf8(exception.what()),
                0,
                0,
                true);
            return mapException(exception, FluxoraInstallerResultInvalidArgument);
        }
        catch (const std::runtime_error& exception)
        {
            emitProgress(
                progressCallback,
                progressUserData,
                progressState,
                L"error",
                fromUtf8(exception.what()),
                0,
                0,
                true);
            return mapException(exception, FluxoraInstallerResultInstallError);
        }
        catch (const std::exception& exception)
        {
            emitProgress(
                progressCallback,
                progressUserData,
                progressState,
                L"error",
                fromUtf8(exception.what()),
                0,
                0,
                true);
            return mapException(exception, FluxoraInstallerResultInstallError);
        }
    }

    int fluxora_installer_install_package_stream(
        FluxoraInstallerReadCallback readCallback,
        void* readUserData,
        const wchar_t* installDirectory,
        int createDesktopShortcut,
        FluxoraInstallerProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        InstallerProgressState progressState;
        try
        {
            if (readCallback == nullptr || isBlank(installDirectory))
            {
                lastError = L"Package stream and install directory are required.";
                emitProgress(
                    progressCallback,
                    progressUserData,
                    progressState,
                    L"error",
                    lastError,
                    0,
                    0,
                    true);
                return FluxoraInstallerResultInvalidArgument;
            }

            writeLog("INFO", "Starting Fluxora installation from embedded package stream.");
            const InstallResult result = installPackageStream(
                readCallback,
                readUserData,
                std::filesystem::path(installDirectory),
                createDesktopShortcut != 0,
                progressCallback,
                progressUserData,
                progressState);
            writeLog("INFO", "Fluxora installation completed.");
            return writeToBuffer(serializeResult(result), jsonBuffer, jsonBufferLength);
        }
        catch (const std::invalid_argument& exception)
        {
            emitProgress(
                progressCallback,
                progressUserData,
                progressState,
                L"error",
                fromUtf8(exception.what()),
                0,
                0,
                true);
            return mapException(exception, FluxoraInstallerResultInvalidArgument);
        }
        catch (const std::runtime_error& exception)
        {
            emitProgress(
                progressCallback,
                progressUserData,
                progressState,
                L"error",
                fromUtf8(exception.what()),
                0,
                0,
                true);
            return mapException(exception, FluxoraInstallerResultInstallError);
        }
        catch (const std::exception& exception)
        {
            emitProgress(
                progressCallback,
                progressUserData,
                progressState,
                L"error",
                fromUtf8(exception.what()),
                0,
                0,
                true);
            return mapException(exception, FluxoraInstallerResultInstallError);
        }
    }

    int fluxora_installer_get_last_error(wchar_t* messageBuffer, int messageBufferLength)
    {
        return writeToBuffer(lastError, messageBuffer, messageBufferLength);
    }
}
