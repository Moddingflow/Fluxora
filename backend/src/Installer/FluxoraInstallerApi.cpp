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
#include <iomanip>
#include <limits>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
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
    constexpr std::uint32_t MinimumPackageVersion = 1;
    constexpr std::uint32_t CurrentPackageVersion = 2;
    constexpr std::uint32_t PackageVersionWithFileHashes = 2;
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

        if (std::filesystem::exists(absolute, error) && !std::filesystem::is_directory(absolute, error))
        {
            throw std::invalid_argument("Install path points to a file. Choose a folder.");
        }

        return absolute.lexically_normal();
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
        }

        const std::filesystem::path destination = (installRoot / relative).lexically_normal();
        if (!pathStartsWith(destination, installRoot))
        {
            throw std::runtime_error("Package path escapes the selected install directory.");
        }

        return destination;
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

    std::filesystem::path createDesktopShortcut(const std::filesystem::path& applicationPath)
    {
#ifdef _WIN32
        HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
        const bool shouldUninitialize = SUCCEEDED(initialized);
        if (initialized == RPC_E_CHANGED_MODE)
        {
            initialized = S_OK;
        }

        if (FAILED(initialized))
        {
            throw std::runtime_error("Failed to initialize Windows shortcut services.");
        }

        IShellLinkW* shellLink = nullptr;
        HRESULT hr = CoCreateInstance(
            CLSID_ShellLink,
            nullptr,
            CLSCTX_INPROC_SERVER,
            IID_IShellLinkW,
            reinterpret_cast<void**>(&shellLink));
        if (FAILED(hr) || shellLink == nullptr)
        {
            if (shouldUninitialize)
            {
                CoUninitialize();
            }
            throw std::runtime_error("Failed to create a Windows shortcut.");
        }

        const std::wstring target = applicationPath.wstring();
        const std::wstring workingDirectory = applicationPath.parent_path().wstring();
        shellLink->SetPath(target.c_str());
        shellLink->SetWorkingDirectory(workingDirectory.c_str());
        shellLink->SetDescription(L"Fluxora Mod Manager");
        shellLink->SetIconLocation(target.c_str(), 0);

        IPersistFile* persistFile = nullptr;
        hr = shellLink->QueryInterface(IID_IPersistFile, reinterpret_cast<void**>(&persistFile));
        if (FAILED(hr) || persistFile == nullptr)
        {
            shellLink->Release();
            if (shouldUninitialize)
            {
                CoUninitialize();
            }
            throw std::runtime_error("Failed to save a Windows shortcut.");
        }

        const std::filesystem::path shortcut = desktopShortcutPath();
        std::filesystem::create_directories(shortcut.parent_path());
        hr = persistFile->Save(shortcut.wstring().c_str(), TRUE);

        persistFile->Release();
        shellLink->Release();
        if (shouldUninitialize)
        {
            CoUninitialize();
        }

        if (FAILED(hr))
        {
            throw std::runtime_error("Failed to write the desktop shortcut.");
        }

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
        std::filesystem::create_directories(validatedInstallDirectory);
        {
            std::ostringstream stream;
            stream << "Installer package validated. source=\""
                   << package.sourceDescription()
                   << "\", installDirectory=\""
                   << toUtf8(validatedInstallDirectory.wstring())
                   << "\", version=" << header.version
                   << ", entries=" << header.entryCount
                   << ", totalBytes=" << header.totalBytes
                   << ", createDesktopShortcut=" << (shouldCreateDesktopShortcut ? "true" : "false");
            writeLog("INFO", stream.str());
        }
        emitProgress(callback, userData, progressState, L"preparing", L"", 0, header.totalBytes, true);

        std::uint64_t copiedBytes = 0;
        for (std::uint64_t index = 0; index < header.entryCount; ++index)
        {
            const std::uint8_t entryType = readPod<std::uint8_t>(package, "entry type");
            const std::wstring relativePath = readRelativePath(package);
            const std::uint64_t byteCount = readPod<std::uint64_t>(package, "entry size");
            const std::filesystem::path destination = resolvePackageEntryPath(
                validatedInstallDirectory,
                relativePath);

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

        const std::filesystem::path applicationPath = validatedInstallDirectory / L"FluxoraModding.exe";
        if (!std::filesystem::exists(applicationPath))
        {
            throw std::runtime_error("Installed package is missing FluxoraModding.exe.");
        }

        InstallResult result;
        result.installDirectory = validatedInstallDirectory;
        result.applicationPath = applicationPath;
        emitProgress(callback, userData, progressState, L"finalizing", L"FluxoraModding.exe", header.totalBytes, header.totalBytes, true);

        if (shouldCreateDesktopShortcut)
        {
            result.desktopShortcutPath = createDesktopShortcut(applicationPath);
            result.createdDesktopShortcut = true;
            writeLog(
                "INFO",
                std::string("Desktop shortcut created. path=\"") +
                    toUtf8(result.desktopShortcutPath.wstring()) + "\"");
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
