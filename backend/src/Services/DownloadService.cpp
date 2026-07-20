#include "FluxoraCore/Services/DownloadService.hpp"

#include "FluxoraCore/GameSupport/GameSupportRegistry.hpp"
#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/ContentLayoutService.hpp"
#include "FluxoraCore/Services/InstallProjectGate.hpp"
#include "FluxoraCore/Services/InstallTransactionJournal.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModIdentityResolver.hpp"
#include "FluxoraCore/Services/ModUpdateService.hpp"
#include "FluxoraCore/Services/NexusModsAuthService.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "FluxoraCore/Support/FilesystemPath.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include "NexusUpdateCache.hpp"

#include <zlib.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstring>
#include <ctime>
#include <cwctype>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iterator>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#include <winhttp.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view pendingNxmExtension = L".nxm";
        constexpr std::wstring_view metadataExtension = L".fluxora.json";
        constexpr std::wstring_view progressSidecarExtension = L".fluxora.progress.json";
        constexpr std::wstring_view cancelMarkerExtension = L".cancel";
        constexpr std::wstring_view transientFileExtension = L".tmp";
        constexpr std::wstring_view partialDownloadExtension = L".part";
        constexpr std::chrono::milliseconds progressSidecarWriteInterval{250};
        constexpr std::chrono::seconds durableProgressCheckpointInterval{30};
        constexpr std::uintmax_t durableProgressCheckpointBytes = 64ULL * 1024ULL * 1024ULL;
#ifdef _WIN32
        constexpr std::chrono::milliseconds externalProcessPollInterval{250};
        constexpr std::chrono::hours externalProcessTimeout{2};
        constexpr std::chrono::seconds externalProcessTerminationWait{5};
#endif
        constexpr std::wstring_view protocolKeyPath = L"Software\\Classes\\nxm";
        constexpr std::wstring_view commandKeyPath = L"Software\\Classes\\nxm\\shell\\open\\command";
        constexpr std::wstring_view backupKeyPath = L"Software\\Fluxora\\NxmProtocol";
        constexpr std::wstring_view previousCommandValueName = L"PreviousCommand";
        constexpr std::array<std::wstring_view, 9> compoundArchiveExtensions{
            L".tar.gz",
            L".tar.bz2",
            L".tar.xz",
            L".tar.zst",
            L".tgz",
            L".tbz",
            L".tbz2",
            L".txz",
            L".7z.001"
        };
        constexpr std::array<std::wstring_view, 25> supportedArchiveExtensions{
            L".zip",
            L".7z",
            L".7z.001",
            L".rar",
            L".fomod",
            L".omod",
            L".tar",
            L".tar.gz",
            L".tgz",
            L".tar.bz2",
            L".tbz",
            L".tbz2",
            L".tar.xz",
            L".txz",
            L".tar.zst",
            L".gz",
            L".bz2",
            L".xz",
            L".zst",
            L".cab",
            L".iso",
            L".wim",
            L".arj",
            L".lzh",
            L".lha"
        };
        constexpr std::array<std::wstring_view, 1> rawModArchiveExtensions{
            L".ba2"
        };

        struct DownloadFileCatalogEntry
        {
            std::filesystem::path path;
            std::filesystem::file_time_type lastWriteTime{};
        };

        std::mutex activeDownloadsMutex;
        std::map<std::wstring, std::size_t> activeDownloads;
        std::mutex downloadOutputPathReservationsMutex;
        std::set<std::wstring> reservedDownloadOutputPaths;
        std::mutex completedArchiveMetadataMutex;
        std::mutex duplicateDecisionIdMutex;
        std::uint64_t duplicateDecisionSequence{0};
        std::mutex duplicateDecisionResolutionMutex;
        std::mutex duplicateLineageMutexMapMutex;
        std::map<std::wstring, std::weak_ptr<std::mutex>> duplicateLineageMutexes;
#ifndef _WIN32
        std::mutex archiveUseFallbackMutexMapMutex;
        std::map<std::wstring, std::weak_ptr<std::mutex>> archiveUseFallbackMutexes;
#endif
        std::mutex installStagingCacheMutex;
        std::map<std::wstring, std::weak_ptr<std::mutex>> installStagingCacheKeyMutexes;
        std::map<std::filesystem::path, std::size_t> installStagingCacheActiveEntries;
        constexpr std::wstring_view installStagingCacheDirectoryName = L".install-staging-cache";
        constexpr std::wstring_view installStagingCachePayloadDirectoryName = L"payload";
        constexpr std::wstring_view installStagingCacheReadyFileName = L"ready.txt";
        constexpr int installStagingCacheMaxEntries = 8;

        struct NxmDownloadRequest
        {
            std::wstring originalUrl;
            std::wstring gameDomain;
            std::wstring modId;
            std::wstring fileId;
            std::wstring key;
            std::wstring expires;
        };

        struct DownloadMetadata
        {
            std::wstring source;
            std::wstring status;
            std::wstring gameDomain;
            std::wstring modId;
            std::wstring fileId;
            std::wstring nexusModName;
            std::wstring version;
            std::wstring latestVersion;
            std::wstring installedModName;
            std::wstring installedAtUtc;
            std::wstring destinationFileName;
            std::filesystem::path partialPath;
            std::uintmax_t bytesReceived{0};
            std::uintmax_t totalBytes{0};
            std::uintmax_t downloadStartedUnix{0};
            bool isDownloading{false};
            std::optional<DownloadDuplicateDecision> duplicateDecision;
        };

        struct NexusDownloadedFile
        {
            std::filesystem::path path;
            std::wstring nexusModName;
            std::wstring version;
            std::wstring latestVersion;
            std::wstring filePayloadJson;
            bool awaitingDecision{false};
            bool reusedExisting{false};
        };

        struct NexusFileInfo
        {
            std::wstring displayName;
            std::wstring fileName;
            std::wstring version;
            std::wstring payloadJson;
        };

        struct NexusMd5Identity
        {
            std::wstring gameDomain;
            std::wstring modId;
            std::wstring fileId;
            std::wstring modName;
        };

        class DownloadCanceledException final : public std::runtime_error
        {
        public:
            DownloadCanceledException()
                : std::runtime_error("Download canceled.")
            {
            }
        };

        class ArchiveExtractionCanceledException final : public std::runtime_error
        {
        public:
            ArchiveExtractionCanceledException()
                : std::runtime_error("Archive extraction was canceled.")
            {
            }
        };

        std::wstring archiveFileName(
            const NxmDownloadRequest& request,
            std::wstring_view preferredName);

        std::wstring toLower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

#ifdef _WIN32
        std::wstring readEnvironmentVariable(const wchar_t* name)
        {
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
        }
#endif

        std::filesystem::path resolveFluxoraDataDirectory()
        {
#ifdef _WIN32
            if (const std::wstring appData = readEnvironmentVariable(L"APPDATA"); !appData.empty())
            {
                return std::filesystem::path(appData) / L"Fluxora";
            }
#endif

            return std::filesystem::temp_directory_path() / L"Fluxora";
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
                throw std::invalid_argument("Text is not valid UTF-8.");
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

        class ScopedLoggerOperationContext final
        {
        public:
            explicit ScopedLoggerOperationContext(std::string_view operationId)
            {
                Logger::clearOperationId();
                if (!operationId.empty())
                {
                    Logger::setOperationId(fromUtf8(std::string(operationId)));
                }
            }

            ScopedLoggerOperationContext(const ScopedLoggerOperationContext&) = delete;
            ScopedLoggerOperationContext& operator=(const ScopedLoggerOperationContext&) = delete;

            ~ScopedLoggerOperationContext()
            {
                Logger::clearOperationId();
            }
        };

        std::string readTextFile(const std::filesystem::path& path)
        {
            std::ifstream file(path, std::ios::in | std::ios::binary);
            if (!file)
            {
                return {};
            }

            return std::string(
                std::istreambuf_iterator<char>(file),
                std::istreambuf_iterator<char>());
        }

        void writeTextFile(const std::filesystem::path& path, const std::string& content)
        {
            AtomicFileWriteOptions options{
                L"generated download metadata",
                ProjectStateValidation::Utf8Text
            };
            options.keepBackup = false;
            AtomicFileStore().writeTextFile(
                path,
                content,
                options);
        }

        bool tryWriteVolatileTextFile(const std::filesystem::path& path, const std::string& content)
        {
            if (path.empty())
            {
                return false;
            }

            std::error_code directoryError;
            const std::filesystem::path parent = path.parent_path();
            if (!parent.empty())
            {
                std::filesystem::create_directories(parent, directoryError);
                if (directoryError)
                {
                    return false;
                }
            }

            std::ofstream file(path, std::ios::out | std::ios::trunc | std::ios::binary);
            if (!file)
            {
                return false;
            }

            file.write(content.data(), static_cast<std::streamsize>(content.size()));
            return static_cast<bool>(file);
        }

        std::uintmax_t parseUnsigned(std::wstring_view value)
        {
            std::uintmax_t number = 0;
            bool hasDigit = false;
            for (wchar_t character : value)
            {
                if (!hasDigit && (character == L' ' || character == L'\t' || character == L'\r' || character == L'\n'))
                {
                    continue;
                }

                if (character < L'0' || character > L'9')
                {
                    break;
                }

                hasDigit = true;
                number = (number * 10) + static_cast<std::uintmax_t>(character - L'0');
            }

            return hasDigit ? number : 0;
        }

        std::optional<std::uintmax_t> parseStrictUnsigned(std::wstring_view value)
        {
            while (!value.empty() && std::iswspace(value.front()))
            {
                value.remove_prefix(1);
            }
            while (!value.empty() && std::iswspace(value.back()))
            {
                value.remove_suffix(1);
            }
            if (value.empty())
            {
                return std::nullopt;
            }

            std::uintmax_t result = 0;
            for (const wchar_t character : value)
            {
                if (character < L'0' || character > L'9')
                {
                    return std::nullopt;
                }

                const std::uintmax_t digit = static_cast<std::uintmax_t>(character - L'0');
                if (result > ((std::numeric_limits<std::uintmax_t>::max)() - digit) / 10)
                {
                    return std::nullopt;
                }
                result = (result * 10) + digit;
            }

            return result;
        }

        struct HttpContentRange
        {
            std::uintmax_t start{0};
            std::uintmax_t end{0};
            std::optional<std::uintmax_t> total;
        };

        std::optional<HttpContentRange> parseHttpContentRange(std::wstring_view value)
        {
            while (!value.empty() && std::iswspace(value.front()))
            {
                value.remove_prefix(1);
            }
            while (!value.empty() && std::iswspace(value.back()))
            {
                value.remove_suffix(1);
            }

            constexpr std::wstring_view unit = L"bytes ";
            if (value.size() <= unit.size() || toLower(std::wstring(value.substr(0, unit.size()))) != unit)
            {
                return std::nullopt;
            }

            value.remove_prefix(unit.size());
            const std::size_t dash = value.find(L'-');
            const std::size_t slash = value.find(L'/');
            if (dash == std::wstring_view::npos ||
                slash == std::wstring_view::npos ||
                dash == 0 ||
                dash + 1 >= slash ||
                slash + 1 >= value.size())
            {
                return std::nullopt;
            }

            const std::optional<std::uintmax_t> start = parseStrictUnsigned(value.substr(0, dash));
            const std::optional<std::uintmax_t> end = parseStrictUnsigned(value.substr(dash + 1, slash - dash - 1));
            if (!start.has_value() || !end.has_value() || *end < *start)
            {
                return std::nullopt;
            }

            std::optional<std::uintmax_t> total;
            const std::wstring_view totalText = value.substr(slash + 1);
            if (totalText != L"*")
            {
                total = parseStrictUnsigned(totalText);
                if (!total.has_value() || *total == 0 || *end >= *total)
                {
                    return std::nullopt;
                }
            }

            return HttpContentRange{*start, *end, total};
        }

        struct HttpDownloadResponsePlan
        {
            bool appendToPartial{false};
            std::uintmax_t initialFileBytes{0};
            std::optional<std::uintmax_t> expectedResponseBytes;
            std::optional<std::uintmax_t> expectedTotalBytes;
        };

        HttpDownloadResponsePlan planHttpDownloadResponse(
            std::uint32_t statusCode,
            std::uintmax_t requestedOffset,
            std::wstring_view contentLengthText,
            std::wstring_view contentRangeText)
        {
            std::optional<std::uintmax_t> contentLength;
            if (!contentLengthText.empty())
            {
                contentLength = parseStrictUnsigned(contentLengthText);
                if (!contentLength.has_value())
                {
                    throw std::runtime_error("Download response has an invalid Content-Length header.");
                }
            }

            if (statusCode != 206)
            {
                return HttpDownloadResponsePlan{
                    false,
                    0,
                    contentLength,
                    contentLength};
            }

            const std::optional<HttpContentRange> contentRange = parseHttpContentRange(contentRangeText);
            if (!contentRange.has_value())
            {
                throw std::runtime_error("Partial download response is missing a valid Content-Range header.");
            }
            if (contentRange->start != requestedOffset)
            {
                throw std::runtime_error(
                    "Partial download response starts at byte " + std::to_string(contentRange->start) +
                    " instead of requested byte " + std::to_string(requestedOffset) + ".");
            }

            if (contentRange->start == 0 &&
                contentRange->end == (std::numeric_limits<std::uintmax_t>::max)())
            {
                throw std::runtime_error("Partial download Content-Range is too large.");
            }
            const std::uintmax_t rangeBytes = contentRange->end - contentRange->start + 1;
            if (contentLength.has_value() && *contentLength != rangeBytes)
            {
                throw std::runtime_error(
                    "Partial download Content-Length does not match Content-Range.");
            }

            return HttpDownloadResponsePlan{
                requestedOffset > 0,
                requestedOffset,
                contentLength.has_value()
                    ? contentLength
                    : std::optional<std::uintmax_t>(rangeBytes),
                contentRange->total};
        }

        void validateCompletedHttpDownload(
            const HttpDownloadResponsePlan& plan,
            std::uintmax_t responseBytesReceived,
            std::uintmax_t completedFileBytes)
        {
            if (plan.expectedResponseBytes.has_value() &&
                responseBytesReceived != *plan.expectedResponseBytes)
            {
                throw std::runtime_error(
                    "Download response was truncated: expected " +
                    std::to_string(*plan.expectedResponseBytes) + " response bytes but received " +
                    std::to_string(responseBytesReceived) + ".");
            }
            if (plan.expectedTotalBytes.has_value() && completedFileBytes != *plan.expectedTotalBytes)
            {
                throw std::runtime_error(
                    "Download response is incomplete: expected final size " +
                    std::to_string(*plan.expectedTotalBytes) + " bytes but received " +
                    std::to_string(completedFileBytes) + ".");
            }
        }

        void promoteCompletedHttpDownload(
            const std::filesystem::path& partialPath,
            const std::filesystem::path& destinationPath,
            const HttpDownloadResponsePlan& plan,
            std::uintmax_t responseBytesReceived,
            std::uintmax_t completedFileBytes)
        {
            validateCompletedHttpDownload(plan, responseBytesReceived, completedFileBytes);

            std::error_code renameError;
            std::filesystem::rename(partialPath, destinationPath, renameError);
            if (renameError)
            {
                throw std::runtime_error("Failed to finalize downloaded file.");
            }
        }

        std::wstring trim(std::wstring value)
        {
            const auto first = value.find_first_not_of(L" \t\r\n.");
            if (first == std::wstring::npos)
            {
                return {};
            }

            const auto last = value.find_last_not_of(L" \t\r\n.");
            return value.substr(first, last - first + 1);
        }

        std::wstring trimWhitespace(std::wstring value)
        {
            const auto first = value.find_first_not_of(L" \t\r\n");
            if (first == std::wstring::npos)
            {
                return {};
            }

            const auto last = value.find_last_not_of(L" \t\r\n");
            return value.substr(first, last - first + 1);
        }

        std::wstring nexusRequestHeaders(NexusModsAuthService* nexusAuth)
        {
            if (nexusAuth == nullptr)
            {
                throw std::runtime_error("NexusMods authentication service is unavailable.");
            }

            const NexusModsApiAuthHeader authHeader = nexusAuth->apiAuthHeader();
            if (!authHeader.isAvailable || authHeader.headerName.empty() || authHeader.headerValue.empty())
            {
                const std::string message = toUtf8(authHeader.message);
                throw std::runtime_error(
                    message.empty()
                        ? "NexusMods authentication token is unavailable."
                        : message);
            }

            return authHeader.headerName + L": " + authHeader.headerValue + L"\r\n";
        }

        std::wstring sanitizeFileName(std::wstring_view value)
        {
            constexpr std::wstring_view invalidCharacters = L"<>:\"/\\|?*";

            std::wstring sanitized;
            sanitized.reserve(value.size());
            for (wchar_t character : value)
            {
                sanitized.push_back(character < 32 || invalidCharacters.find(character) != std::wstring_view::npos
                    ? L'_'
                    : character);
            }

            return trim(std::move(sanitized));
        }

        std::wstring preferredFomodInstallName(
            std::wstring_view archiveName,
            std::wstring_view moduleName)
        {
            const std::wstring cleanArchiveName = trim(std::wstring(archiveName));
            const std::wstring cleanModuleName = trim(std::wstring(moduleName));
            if (cleanModuleName.empty())
            {
                return cleanArchiveName;
            }

            const std::wstring lowerArchiveName = toLower(cleanArchiveName);
            const std::wstring lowerModuleName = toLower(cleanModuleName);
            for (const std::wstring_view separator : {L" - ", L" – ", L" — "})
            {
                const std::wstring prefix = lowerModuleName + std::wstring(separator);
                if (lowerArchiveName.size() <= prefix.size() ||
                    !lowerArchiveName.starts_with(prefix))
                {
                    continue;
                }

                const std::wstring_view suffix(
                    cleanArchiveName.data() + prefix.size(),
                    cleanArchiveName.size() - prefix.size());
                if (!ModIdentityResolver::meaningfulTokens(suffix).empty())
                {
                    return cleanArchiveName;
                }
            }

            return cleanModuleName;
        }

        std::filesystem::path uniquePath(const std::filesystem::path& directory, std::wstring_view fileName)
        {
            std::wstring safeName = sanitizeFileName(fileName);
            if (safeName.empty())
            {
                safeName = L"download";
            }

            std::filesystem::path candidate = directory / std::filesystem::path(safeName);
            if (!std::filesystem::exists(candidate))
            {
                return candidate;
            }

            const std::filesystem::path stem = candidate.stem();
            const std::filesystem::path extension = candidate.extension();
            for (int index = 2;; ++index)
            {
                candidate = directory / std::filesystem::path(
                    stem.wstring() + L" (" + std::to_wstring(index) + L")" + extension.wstring());
                if (!std::filesystem::exists(candidate))
                {
                    return candidate;
                }
            }
        }

        [[nodiscard]] std::uint64_t fnv1a(std::wstring_view value)
        {
            std::uint64_t hash = 14695981039346656037ull;
            for (wchar_t character : value)
            {
                const auto code = static_cast<std::uint32_t>(character);
                hash ^= code & 0xFFu;
                hash *= 1099511628211ull;
                hash ^= (code >> 8) & 0xFFu;
                hash *= 1099511628211ull;
                hash ^= (code >> 16) & 0xFFu;
                hash *= 1099511628211ull;
                hash ^= (code >> 24) & 0xFFu;
                hash *= 1099511628211ull;
            }

            return hash;
        }

        [[nodiscard]] std::wstring hashText(std::wstring_view value)
        {
            std::wostringstream stream;
            stream << std::hex << fnv1a(value);
            return stream.str();
        }

        enum class ContentHashAlgorithm
        {
            Sha256,
            Md5
        };

        class StrongContentHasher final
        {
        public:
            explicit StrongContentHasher(
                ContentHashAlgorithm algorithm = ContentHashAlgorithm::Sha256)
                : algorithmLabel_(algorithm == ContentHashAlgorithm::Sha256 ? "SHA-256" : "MD5")
            {
#ifdef _WIN32
                const wchar_t* algorithmIdentifier = algorithm == ContentHashAlgorithm::Sha256
                    ? BCRYPT_SHA256_ALGORITHM
                    : BCRYPT_MD5_ALGORITHM;
                if (BCryptOpenAlgorithmProvider(
                        &algorithm_,
                        algorithmIdentifier,
                        nullptr,
                        0) < 0)
                {
                    throw std::runtime_error(
                        std::string("Failed to initialize ") + algorithmLabel_ + " hashing.");
                }

                DWORD bytesWritten = 0;
                DWORD objectLength = 0;
                if (BCryptGetProperty(
                        algorithm_,
                        BCRYPT_OBJECT_LENGTH,
                        reinterpret_cast<PUCHAR>(&objectLength),
                        sizeof(objectLength),
                        &bytesWritten,
                        0) < 0 ||
                    objectLength == 0)
                {
                    BCryptCloseAlgorithmProvider(algorithm_, 0);
                    algorithm_ = nullptr;
                    throw std::runtime_error(
                        std::string("Failed to configure ") + algorithmLabel_ + " hashing.");
                }

                if (BCryptGetProperty(
                        algorithm_,
                        BCRYPT_HASH_LENGTH,
                        reinterpret_cast<PUCHAR>(&hashLength_),
                        sizeof(hashLength_),
                        &bytesWritten,
                        0) < 0 ||
                    hashLength_ == 0)
                {
                    BCryptCloseAlgorithmProvider(algorithm_, 0);
                    algorithm_ = nullptr;
                    throw std::runtime_error(
                        std::string("Failed to query ") + algorithmLabel_ + " hash length.");
                }

                hashObject_.resize(objectLength);
                if (BCryptCreateHash(
                        algorithm_,
                        &hash_,
                        hashObject_.data(),
                        static_cast<ULONG>(hashObject_.size()),
                        nullptr,
                        0,
                        0) < 0)
                {
                    BCryptCloseAlgorithmProvider(algorithm_, 0);
                    algorithm_ = nullptr;
                    throw std::runtime_error(
                        std::string("Failed to create ") + algorithmLabel_ + " hash state.");
                }
#endif
            }

            StrongContentHasher(const StrongContentHasher&) = delete;
            StrongContentHasher& operator=(const StrongContentHasher&) = delete;

            ~StrongContentHasher()
            {
#ifdef _WIN32
                if (hash_ != nullptr)
                {
                    BCryptDestroyHash(hash_);
                }
                if (algorithm_ != nullptr)
                {
                    BCryptCloseAlgorithmProvider(algorithm_, 0);
                }
#endif
            }

            void update(const void* data, std::size_t size)
            {
                if (finished_ || data == nullptr || size == 0)
                {
                    return;
                }

#ifdef _WIN32
                const auto* bytes = static_cast<const unsigned char*>(data);
                while (size > 0)
                {
                    const ULONG chunk = static_cast<ULONG>((std::min)(
                        size,
                        static_cast<std::size_t>((std::numeric_limits<ULONG>::max)())));
                    if (BCryptHashData(
                            hash_,
                            const_cast<PUCHAR>(bytes),
                            chunk,
                            0) < 0)
                    {
                        throw std::runtime_error(
                            std::string("Failed to update ") + algorithmLabel_ + " hash.");
                    }
                    bytes += chunk;
                    size -= chunk;
                }
#else
                const auto* bytes = static_cast<const unsigned char*>(data);
                for (std::size_t index = 0; index < size; ++index)
                {
                    first_ ^= bytes[index];
                    first_ *= 1099511628211ull;
                    second_ += bytes[index] + 0x9e3779b97f4a7c15ull;
                    second_ ^= second_ >> 29;
                    second_ *= 0xbf58476d1ce4e5b9ull;
                }
#endif
            }

            void update(std::string_view value)
            {
                update(value.data(), value.size());
            }

            [[nodiscard]] std::string finish()
            {
                if (finished_)
                {
                    throw std::logic_error("Content hash was already finalized.");
                }
                finished_ = true;

                std::vector<unsigned char> digest;
#ifdef _WIN32
                digest.resize(hashLength_);
                if (BCryptFinishHash(
                        hash_,
                        digest.data(),
                        static_cast<ULONG>(digest.size()),
                        0) < 0)
                {
                    throw std::runtime_error(
                        std::string("Failed to finalize ") + algorithmLabel_ + " hash.");
                }
#else
                digest.resize(16);
                for (std::size_t index = 0; index < 8; ++index)
                {
                    digest[index] = static_cast<unsigned char>((first_ >> (index * 8)) & 0xffu);
                    digest[8 + index] = static_cast<unsigned char>((second_ >> (index * 8)) & 0xffu);
                }
#endif

                std::ostringstream stream;
                stream << std::hex << std::setfill('0');
                for (const unsigned char byte : digest)
                {
                    stream << std::setw(2) << static_cast<unsigned int>(byte);
                }
                return stream.str();
            }

        private:
            bool finished_{false};
            const char* algorithmLabel_;
#ifdef _WIN32
            BCRYPT_ALG_HANDLE algorithm_{nullptr};
            BCRYPT_HASH_HANDLE hash_{nullptr};
            std::vector<unsigned char> hashObject_;
            DWORD hashLength_{0};
#else
            std::uint64_t first_{14695981039346656037ull};
            std::uint64_t second_{1099511628211ull};
#endif
        };

        struct FileContentDigests
        {
            std::string sha256;
            std::string md5;
        };

        [[nodiscard]] std::string regularFileIdentityToken(const std::filesystem::path& path)
        {
#ifdef _WIN32
            const std::filesystem::path ioPath = pathForFilesystemIo(path);
            const HANDLE handle = CreateFileW(
                ioPath.c_str(),
                FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                nullptr,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                nullptr);
            if (handle == INVALID_HANDLE_VALUE)
            {
                throw std::runtime_error("Failed to inspect file identity.");
            }

            BY_HANDLE_FILE_INFORMATION information{};
            FILE_BASIC_INFO basicInformation{};
            const BOOL informationRead = GetFileInformationByHandle(handle, &information);
            const BOOL basicInformationRead = GetFileInformationByHandleEx(
                handle,
                FileBasicInfo,
                &basicInformation,
                sizeof(basicInformation));
            CloseHandle(handle);
            if (informationRead == FALSE || basicInformationRead == FALSE)
            {
                throw std::runtime_error("Failed to read file identity.");
            }

            std::ostringstream token;
            token << information.dwVolumeSerialNumber << ':'
                  << information.nFileIndexHigh << ':'
                  << information.nFileIndexLow << ':'
                  << information.nFileSizeHigh << ':'
                  << information.nFileSizeLow << ':'
                  << information.ftLastWriteTime.dwHighDateTime << ':'
                  << information.ftLastWriteTime.dwLowDateTime << ':'
                  << basicInformation.ChangeTime.QuadPart;
            return token.str();
#else
            std::error_code sizeError;
            const std::uintmax_t size = std::filesystem::file_size(path, sizeError);
            std::error_code timeError;
            const auto modified = std::filesystem::last_write_time(path, timeError);
            if (sizeError || timeError)
            {
                throw std::runtime_error("Failed to inspect file identity.");
            }
            return std::to_string(size) + ":" +
                std::to_string(modified.time_since_epoch().count());
#endif
        }

        void hashRegularFileContents(
            const std::filesystem::path& path,
            StrongContentHasher& sha256Hasher,
            StrongContentHasher* md5Hasher)
        {
            std::ifstream file(pathForFilesystemIo(path), std::ios::in | std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Failed to open file for integrity hashing.");
            }

            std::vector<char> buffer(1024 * 1024);
            while (file)
            {
                file.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
                const std::streamsize read = file.gcount();
                if (read > 0)
                {
                    const std::size_t byteCount = static_cast<std::size_t>(read);
                    sha256Hasher.update(buffer.data(), byteCount);
                    if (md5Hasher != nullptr)
                    {
                        md5Hasher->update(buffer.data(), byteCount);
                    }
                }
            }
            if (!file.eof())
            {
                throw std::runtime_error("Failed while hashing file contents.");
            }
        }

        [[nodiscard]] FileContentDigests regularFileContentDigests(
            const std::filesystem::path& path)
        {
            StrongContentHasher sha256Hasher;
            std::unique_ptr<StrongContentHasher> md5Hasher;
            try
            {
                md5Hasher = std::make_unique<StrongContentHasher>(ContentHashAlgorithm::Md5);
            }
            catch (const std::exception&)
            {
            }
            hashRegularFileContents(path, sha256Hasher, md5Hasher.get());
            return FileContentDigests{
                sha256Hasher.finish(),
                md5Hasher == nullptr ? std::string{} : md5Hasher->finish()
            };
        }

        [[nodiscard]] FileContentDigests cachedRegularFileContentDigests(
            const std::filesystem::path& path)
        {
            struct CachedHash
            {
                std::string identity;
                FileContentDigests digests;
                std::uint64_t lastUse{0};
            };

#ifdef _WIN32
            static std::mutex cacheMutex;
            static std::map<std::wstring, CachedHash> cache;
            static std::uint64_t useCounter = 0;
            constexpr std::size_t maxCachedHashes = 32;
            const std::wstring cacheKey = toLower(path.lexically_normal().wstring());
#endif

            for (int attempt = 0; attempt < 2; ++attempt)
            {
                const std::string identityBefore = regularFileIdentityToken(path);
#ifdef _WIN32
                {
                    std::lock_guard lock(cacheMutex);
                    const auto found = cache.find(cacheKey);
                    if (found != cache.end() && found->second.identity == identityBefore)
                    {
                        found->second.lastUse = ++useCounter;
                        return found->second.digests;
                    }
                }
#endif

                const FileContentDigests digests = regularFileContentDigests(path);
                const std::string identityAfter = regularFileIdentityToken(path);
                if (identityBefore != identityAfter)
                {
                    continue;
                }

#ifdef _WIN32
                {
                    std::lock_guard lock(cacheMutex);
                    cache[cacheKey] = CachedHash{identityAfter, digests, ++useCounter};
                    if (cache.size() > maxCachedHashes)
                    {
                        const auto oldest = std::min_element(
                            cache.begin(),
                            cache.end(),
                            [](const auto& left, const auto& right)
                            {
                                return left.second.lastUse < right.second.lastUse;
                            });
                        if (oldest != cache.end())
                        {
                            cache.erase(oldest);
                        }
                    }
                }
#endif
                return digests;
            }

            throw std::runtime_error("File changed while its cache identity was being calculated.");
        }

        [[nodiscard]] std::string cachedRegularFileContentHash(
            const std::filesystem::path& path)
        {
            return cachedRegularFileContentDigests(path).sha256;
        }

        [[nodiscard]] std::wstring fileCacheFingerprint(const std::filesystem::path& path)
        {
            if (path.empty())
            {
                return {};
            }

            const std::string digest = cachedRegularFileContentHash(path);
            return L"v=2|path=" + hashText(toLower(path.lexically_normal().wstring())) +
                L"|content=" + std::wstring(digest.begin(), digest.end());
        }

        [[nodiscard]] std::wstring fomodContextArchiveFingerprint(
            const std::filesystem::path& path)
        {
            if (path.empty())
            {
                return {};
            }

            const std::string digest = cachedRegularFileContentHash(path);
            return L"v=1|content=" + std::wstring(digest.begin(), digest.end());
        }

        [[nodiscard]] std::wstring fastFileCacheFingerprint(const std::filesystem::path& path)
        {
            if (path.empty())
            {
                return {};
            }

            const std::string identity = regularFileIdentityToken(path);
            return L"v=1|path=" + hashText(toLower(path.lexically_normal().wstring())) +
                L"|identity=" + std::wstring(identity.begin(), identity.end());
        }

        [[nodiscard]] std::wstring fomodOutputCacheFingerprint(
            const std::filesystem::path& path,
            const std::vector<std::wstring>& selectedOptionIds)
        {
            std::wstring selectionKey;
            for (const std::wstring& optionId : selectedOptionIds)
            {
                selectionKey.append(optionId);
                selectionKey.push_back(L'\x1f');
            }

            return fileCacheFingerprint(path) + L"|fomodSelection=" + hashText(selectionKey);
        }

        [[nodiscard]] std::filesystem::path fomodPreviewCacheDirectory(
            const std::filesystem::path& downloadsDirectory,
            const std::filesystem::path& downloadPath,
            std::wstring_view fallbackName)
        {
            const std::wstring key = fastFileCacheFingerprint(downloadPath);

            std::wstring safeName = sanitizeFileName(fallbackName);
            if (safeName.size() > 80)
            {
                safeName = safeName.substr(0, 80);
            }
            if (safeName.empty())
            {
                safeName = L"fomod";
            }

            return downloadsDirectory /
                std::filesystem::path(L".fomod-previews") /
                std::filesystem::path(safeName + L"-" + hashText(key));
        }

        [[nodiscard]] std::optional<std::filesystem::path> trySafeFomodPreviewRelativePath(std::wstring_view value)
        {
            std::wstring text = trim(std::wstring(value));
            std::replace(text.begin(), text.end(), L'/', std::filesystem::path::preferred_separator);
            const std::filesystem::path path(text);
            if (path.empty() || path.is_absolute())
            {
                return std::nullopt;
            }

            const std::filesystem::path normalized = path.lexically_normal();
            for (const auto& part : normalized)
            {
                if (part == L"..")
                {
                    return std::nullopt;
                }
            }

            if (normalized == L".")
            {
                return std::nullopt;
            }

            return normalized;
        }

        [[nodiscard]] std::filesystem::path resolveFomodPreviewSource(
            const std::filesystem::path& packageRoot,
            const std::filesystem::path& relativePath)
        {
            const std::array candidates{
                packageRoot / relativePath,
                packageRoot / L"fomod" / relativePath,
                packageRoot / L"FOMOD" / relativePath,
                packageRoot / L"Fomod" / relativePath
            };

            for (const std::filesystem::path& candidate : candidates)
            {
                std::error_code error;
                if (std::filesystem::is_regular_file(candidate, error))
                {
                    return candidate;
                }

                std::filesystem::path current = candidate.root_path();
                std::filesystem::path remaining = candidate.relative_path();
                if (current.empty())
                {
                    current = packageRoot.root_path();
                }
                bool resolved = true;
                for (const auto& component : remaining)
                {
                    if (component == L".")
                    {
                        continue;
                    }

                    std::error_code iteratorError;
                    std::filesystem::path matched;
                    for (const auto& entry : std::filesystem::directory_iterator(current, iteratorError))
                    {
                        if (toLower(entry.path().filename().wstring()) ==
                            toLower(component.wstring()))
                        {
                            matched = entry.path();
                            break;
                        }
                    }
                    if (iteratorError || matched.empty())
                    {
                        resolved = false;
                        break;
                    }
                    current = matched;
                }
                if (resolved && std::filesystem::is_regular_file(current, error))
                {
                    return current;
                }
            }

            return {};
        }

        [[nodiscard]] bool hasFomodModuleConfig(const std::filesystem::path& root)
        {
            for (std::wstring_view folderName : {L"fomod", L"FOMOD", L"Fomod"})
            {
                const std::filesystem::path fomodDirectory = root / std::filesystem::path(folderName);
                for (std::wstring_view configName : {L"ModuleConfig.xml", L"moduleconfig.xml", L"ModuleConfig.XML"})
                {
                    std::error_code error;
                    if (std::filesystem::is_regular_file(
                            fomodDirectory / std::filesystem::path(configName),
                            error))
                    {
                        return true;
                    }
                }
            }

            return false;
        }

        [[nodiscard]] std::filesystem::path fomodPreviewPackageRoot(const std::filesystem::path& packageDirectory)
        {
            if (hasFomodModuleConfig(packageDirectory))
            {
                return packageDirectory;
            }

            std::error_code iteratorError;
            for (const auto& entry : std::filesystem::directory_iterator(packageDirectory, iteratorError))
            {
                if (!entry.is_directory())
                {
                    continue;
                }

                if (hasFomodModuleConfig(entry.path()))
                {
                    return entry.path();
                }
            }

            return packageDirectory;
        }

        [[nodiscard]] std::wstring materializeFomodPreviewImage(
            const std::filesystem::path& packageRoot,
            const std::filesystem::path& previewDirectory,
            std::wstring_view imagePath,
            std::size_t index)
        {
            std::optional<std::filesystem::path> relativePath = trySafeFomodPreviewRelativePath(imagePath);
            if (!relativePath.has_value())
            {
                return {};
            }

            const std::filesystem::path source = resolveFomodPreviewSource(packageRoot, relativePath.value());
            if (source.empty())
            {
                return {};
            }

            try
            {
                std::filesystem::create_directories(previewDirectory);
                std::wstring fileName = sanitizeFileName(source.filename().wstring());
                if (fileName.empty())
                {
                    fileName = L"preview";
                }

                const std::filesystem::path target = previewDirectory /
                    std::filesystem::path(std::to_wstring(index) + L"-" + fileName);
                std::filesystem::copy_file(source, target, std::filesystem::copy_options::overwrite_existing);
                return std::filesystem::absolute(target).wstring();
            }
            catch (const std::exception&)
            {
                return {};
            }
        }

        [[nodiscard]] std::size_t materializeFomodPreviewImages(
            FomodInstallerDescriptor& descriptor,
            const std::filesystem::path& packageRoot,
            const std::filesystem::path& previewDirectory)
        {
            std::size_t copied = 0;
            std::size_t index = 0;
            std::map<std::wstring, std::wstring> materializedBySource;

            const auto materialize = [&](std::wstring_view imagePath) -> std::wstring
            {
                const std::optional<std::filesystem::path> relativePath =
                    trySafeFomodPreviewRelativePath(imagePath);
                if (!relativePath.has_value())
                {
                    return {};
                }

                const std::filesystem::path source =
                    resolveFomodPreviewSource(packageRoot, relativePath.value());
                if (source.empty())
                {
                    return {};
                }

                const std::wstring sourceKey = toLower(
                    std::filesystem::absolute(source).lexically_normal().wstring());
                if (const auto found = materializedBySource.find(sourceKey);
                    found != materializedBySource.end())
                {
                    return found->second;
                }

                const std::wstring materialized = materializeFomodPreviewImage(
                    packageRoot,
                    previewDirectory,
                    imagePath,
                    ++index);
                if (!materialized.empty())
                {
                    materializedBySource.emplace(sourceKey, materialized);
                    copied++;
                }
                return materialized;
            };

            if (!descriptor.moduleImagePath.empty())
            {
                descriptor.moduleImagePath = materialize(descriptor.moduleImagePath);
            }

            for (FomodStep& step : descriptor.steps)
            {
                for (FomodGroup& group : step.groups)
                {
                    for (FomodOption& option : group.options)
                    {
                        if (option.imagePath.empty())
                        {
                            continue;
                        }

                        option.imagePath = materialize(option.imagePath);
                    }
                }
            }

            return copied;
        }

        std::filesystem::path nativeDeletePath(const std::filesystem::path& path)
        {
#ifdef _WIN32
            std::wstring text = std::filesystem::absolute(path).lexically_normal().wstring();
            if (text.rfind(LR"(\\?\)", 0) == 0)
            {
                return std::filesystem::path(text);
            }

            if (text.rfind(LR"(\\)", 0) == 0)
            {
                return std::filesystem::path(LR"(\\?\UNC\)" + text.substr(2));
            }

            return std::filesystem::path(LR"(\\?\)" + text);
#else
            return path;
#endif
        }

        void clearReadonlyAttribute(const std::filesystem::path& path)
        {
#ifdef _WIN32
            const std::filesystem::path nativePath = nativeDeletePath(path);
            const DWORD attributes = GetFileAttributesW(nativePath.c_str());
            if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_READONLY) == 0)
            {
                return;
            }

            SetFileAttributesW(nativePath.c_str(), attributes & ~FILE_ATTRIBUTE_READONLY);
#else
            (void)path;
#endif
        }

        void removePathWithRetry(const std::filesystem::path& path)
        {
            constexpr int maxAttempts = 3;

            for (int attempt = 0; attempt < maxAttempts; ++attempt)
            {
                clearReadonlyAttribute(path);
                const std::filesystem::path nativePath = nativeDeletePath(path);
                std::error_code removeError;
                const bool removed = std::filesystem::remove(nativePath, removeError);
                std::error_code existsError;
                if (!removeError &&
                    (removed || !std::filesystem::exists(nativePath, existsError)))
                {
                    return;
                }

                if (attempt + 1 < maxAttempts)
                {
                    std::this_thread::sleep_for(std::chrono::milliseconds(80));
                    continue;
                }

                const std::string reason = removeError
                    ? removeError.message()
                    : "path still exists";
                throw std::runtime_error(
                    "Failed to delete \"" + toUtf8(path.wstring()) + "\": " + reason);
            }
        }

        std::size_t pathDepth(const std::filesystem::path& path)
        {
            return static_cast<std::size_t>(
                std::distance(path.begin(), path.end()));
        }

        void sortDirectoriesDeepestFirst(std::vector<std::filesystem::path>& directories)
        {
            std::sort(directories.begin(), directories.end(), [](const auto& left, const auto& right)
            {
                const std::size_t leftDepth = pathDepth(left);
                const std::size_t rightDepth = pathDepth(right);
                if (leftDepth != rightDepth)
                {
                    return leftDepth > rightDepth;
                }

                return left.wstring().size() > right.wstring().size();
            });
        }

        void removeDirectoryTreeWithRetry(const std::filesystem::path& directory)
        {
            const std::filesystem::path nativeRoot = nativeDeletePath(directory);
            std::error_code statusError;
            const std::filesystem::file_status rootStatus = std::filesystem::symlink_status(nativeRoot, statusError);
            if (statusError || !std::filesystem::exists(rootStatus))
            {
                return;
            }

            const bool isRootDirectory = std::filesystem::is_directory(rootStatus) &&
                !std::filesystem::is_symlink(rootStatus);
            if (!isRootDirectory)
            {
                removePathWithRetry(nativeRoot);
                return;
            }

            clearReadonlyAttribute(nativeRoot);

            std::vector<std::filesystem::path> files;
            std::vector<std::filesystem::path> directories;
            std::error_code iterateError;
            std::filesystem::recursive_directory_iterator iterator(
                nativeRoot,
                std::filesystem::directory_options::skip_permission_denied,
                iterateError);
            if (iterateError)
            {
                throw std::runtime_error("Failed to scan temporary directory: " + iterateError.message());
            }

            const std::filesystem::recursive_directory_iterator end;
            for (; iterator != end; iterator.increment(iterateError))
            {
                if (iterateError)
                {
                    throw std::runtime_error("Failed to scan temporary directory: " + iterateError.message());
                }

                const std::filesystem::path current = iterator->path();
                std::error_code entryError;
                const std::filesystem::file_status status = iterator->symlink_status(entryError);
                if (entryError)
                {
                    throw std::runtime_error("Failed to inspect temporary item: " + entryError.message());
                }

                if (std::filesystem::is_directory(status) && !std::filesystem::is_symlink(status))
                {
                    directories.push_back(current);
                }
                else
                {
                    files.push_back(current);
                }
            }

            for (const std::filesystem::path& file : files)
            {
                removePathWithRetry(file);
            }

            sortDirectoriesDeepestFirst(directories);
            for (const std::filesystem::path& childDirectory : directories)
            {
                removePathWithRetry(childDirectory);
            }

            removePathWithRetry(nativeRoot);
        }

        void cleanupTemporaryDirectory(
            const std::filesystem::path& directory,
            const Logger& logger,
            const char* category)
        {
            if (directory.empty())
            {
                return;
            }

            std::error_code lastError;
            std::string lastException;
            for (int attempt = 1; attempt <= 5; ++attempt)
            {
                lastError.clear();
                lastException.clear();
                try
                {
                    removeDirectoryTreeWithRetry(directory);
                }
                catch (const std::exception& exception)
                {
                    lastException = exception.what();
                }

                std::error_code existsError;
                if (!std::filesystem::exists(nativeDeletePath(directory), existsError))
                {
                    return;
                }

                if (attempt < 5)
                {
                    std::this_thread::sleep_for(std::chrono::milliseconds(60 * attempt));
                }
            }

            std::string message = "Failed to remove temporary directory. path=\"" +
                toUtf8(directory.wstring()) + "\"";
            if (lastError)
            {
                message += ", error=\"" + lastError.message() + "\"";
            }
            if (!lastException.empty())
            {
                message += ", error=\"" + lastException + "\"";
            }
            logger.write(LogLevel::Warning, category, message);
        }

        std::wstring formatFileTime(const std::filesystem::file_time_type& fileTime)
        {
            const auto systemTime = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                fileTime - std::filesystem::file_time_type::clock::now() + std::chrono::system_clock::now());
            const std::time_t time = std::chrono::system_clock::to_time_t(systemTime);

            std::tm localTime{};
#ifdef _WIN32
            localtime_s(&localTime, &time);
#else
            localtime_r(&time, &localTime);
#endif

            std::wstringstream stream;
            stream << std::put_time(&localTime, L"%d.%m.%Y %H:%M");
            return stream.str();
        }

        std::wstring formatSize(std::uintmax_t size)
        {
            constexpr const wchar_t* units[] = {L"B", L"KB", L"MB", L"GB"};
            double value = static_cast<double>(size);
            int unitIndex = 0;
            while (value >= 1024.0 && unitIndex < 3)
            {
                value /= 1024.0;
                ++unitIndex;
            }

            std::wstringstream stream;
            stream << std::fixed << std::setprecision(value < 10.0 && unitIndex > 0 ? 1 : 0) << value << L' ' << units[unitIndex];
            return stream.str();
        }

        std::uintmax_t currentUnixSeconds()
        {
            return static_cast<std::uintmax_t>(std::time(nullptr));
        }

        int downloadProgressPercent(const DownloadMetadata& metadata)
        {
            if (metadata.totalBytes == 0)
            {
                return 0;
            }

            const std::uintmax_t clampedBytes = metadata.bytesReceived < metadata.totalBytes
                ? metadata.bytesReceived
                : metadata.totalBytes;
            return static_cast<int>((clampedBytes * 100) / metadata.totalBytes);
        }

        std::wstring formatDuration(std::uintmax_t seconds)
        {
            if (seconds < 60)
            {
                return std::to_wstring(seconds == 0 ? 1 : seconds) + L" сек";
            }

            const std::uintmax_t minutes = seconds / 60;
            if (minutes < 60)
            {
                return std::to_wstring(minutes) + L" мин";
            }

            const std::uintmax_t hours = minutes / 60;
            const std::uintmax_t remainder = minutes % 60;
            return std::to_wstring(hours) + L" ч " + std::to_wstring(remainder) + L" мин";
        }

        std::uintmax_t elapsedDownloadSeconds(const DownloadMetadata& metadata)
        {
            if (metadata.downloadStartedUnix == 0)
            {
                return 0;
            }

            const std::uintmax_t now = currentUnixSeconds();
            return now > metadata.downloadStartedUnix
                ? now - metadata.downloadStartedUnix
                : 0;
        }

        std::wstring formatTransferRate(double bytesPerSecond)
        {
            constexpr const wchar_t* units[] = {L"B/s", L"KB/s", L"MB/s", L"GB/s"};
            double value = bytesPerSecond;
            int unitIndex = 0;
            while (value >= 1024.0 && unitIndex < 3)
            {
                value /= 1024.0;
                ++unitIndex;
            }

            std::wstringstream stream;
            stream << std::fixed
                << std::setprecision(value < 10.0 && unitIndex > 0 ? 1 : 0)
                << value
                << L' '
                << units[unitIndex];
            return stream.str();
        }

        std::wstring formatDownloadSpeed(const DownloadMetadata& metadata)
        {
            if (!metadata.isDownloading)
            {
                return {};
            }

            const std::uintmax_t elapsed = elapsedDownloadSeconds(metadata);
            if (elapsed == 0 || metadata.bytesReceived == 0)
            {
                return formatTransferRate(0.0);
            }

            const double bytesPerSecond = static_cast<double>(metadata.bytesReceived) / static_cast<double>(elapsed);
            return formatTransferRate(bytesPerSecond);
        }

        std::wstring formatEta(const DownloadMetadata& metadata)
        {
            if (!metadata.isDownloading ||
                metadata.totalBytes == 0 ||
                metadata.bytesReceived == 0 ||
                metadata.bytesReceived >= metadata.totalBytes ||
                metadata.downloadStartedUnix == 0)
            {
                return {};
            }

            const std::uintmax_t elapsed = elapsedDownloadSeconds(metadata);
            if (elapsed == 0)
            {
                return {};
            }

            const double bytesPerSecond = static_cast<double>(metadata.bytesReceived) / static_cast<double>(elapsed);
            if (bytesPerSecond <= 0.0)
            {
                return {};
            }

            const auto remainingSeconds = static_cast<std::uintmax_t>(
                static_cast<double>(metadata.totalBytes - metadata.bytesReceived) / bytesPerSecond);
            return formatDuration(remainingSeconds);
        }

        std::wstring formatProgressText(const DownloadMetadata& metadata)
        {
            if (!metadata.isDownloading && metadata.bytesReceived == 0)
            {
                return {};
            }

            if (metadata.totalBytes > 0)
            {
                return formatSize(metadata.bytesReceived) +
                    L" из " +
                    formatSize(metadata.totalBytes);
            }

            if (metadata.bytesReceived > 0)
            {
                return L"Получено " + formatSize(metadata.bytesReceived);
            }

            return L"Подготовка загрузки";
        }

        std::wstring metadataPath(const std::filesystem::path& path)
        {
            return path.wstring() + std::wstring(metadataExtension);
        }

        std::wstring progressSidecarPath(const std::filesystem::path& path)
        {
            return path.wstring() + std::wstring(progressSidecarExtension);
        }

        bool isHex8(std::wstring_view value)
        {
            if (value.size() != 8)
            {
                return false;
            }

            return std::all_of(value.begin(), value.end(), [](wchar_t character)
            {
                return (character >= L'0' && character <= L'9') ||
                    (character >= L'a' && character <= L'f') ||
                    (character >= L'A' && character <= L'F');
            });
        }

        bool isAtomicBackupFile(const std::filesystem::path& path)
        {
            const std::wstring name = path.filename().wstring();
            return name.size() == 11 &&
                name.rfind(L".fb", 0) == 0 &&
                isHex8(std::wstring_view(name).substr(3));
        }

        std::size_t removeDownloadStateBackupFiles(const std::filesystem::path& directory)
        {
            std::size_t removed = 0;
            std::error_code iterateError;
            for (const auto& entry : std::filesystem::directory_iterator(
                     directory,
                     std::filesystem::directory_options::skip_permission_denied,
                     iterateError))
            {
                if (iterateError)
                {
                    break;
                }

                std::error_code statusError;
                if (!entry.is_regular_file(statusError) || !isAtomicBackupFile(entry.path()))
                {
                    continue;
                }

                std::error_code removeError;
                if (std::filesystem::remove(entry.path(), removeError))
                {
                    ++removed;
                }
            }
            return removed;
        }

        std::wstring cancelMarkerPath(const std::filesystem::path& path)
        {
            return path.wstring() + std::wstring(cancelMarkerExtension);
        }

        bool isDownloadCancellationRequested(const std::filesystem::path& path)
        {
            return !path.empty() && std::filesystem::exists(cancelMarkerPath(path));
        }

        void requestDownloadCancellation(const std::filesystem::path& path)
        {
            if (!path.empty())
            {
                writeTextFile(cancelMarkerPath(path), "cancel");
            }
        }

        void writeDuplicateFile(
            JsonWriter& writer,
            const DownloadDuplicateFile& file,
            bool includeSnapshotHash)
        {
            writer.beginObject();
            writer.field(L"id", file.id);
            writer.field(L"fileId", file.fileId);
            writer.field(L"fileName", file.fileName);
            writer.field(L"version", file.version);
            if (includeSnapshotHash)
            {
                writer.field(L"sha256", file.sha256);
            }
            writer.endObject();
        }

        DownloadDuplicateFile parseDuplicateFile(const JsonValue* value)
        {
            DownloadDuplicateFile file;
            if (value == nullptr || !value->isObject())
            {
                return file;
            }
            const auto read = [value](std::wstring_view key)
            {
                const JsonValue* field = value->find(key);
                return field != nullptr && field->isString()
                    ? field->asString()
                    : std::wstring();
            };
            file.id = read(L"id");
            file.fileId = read(L"fileId");
            file.fileName = read(L"fileName");
            file.version = read(L"version");
            file.sha256 = read(L"sha256");
            return file;
        }

        void writeDuplicateDecision(
            JsonWriter& writer,
            const DownloadDuplicateDecision& decision,
            bool includeSnapshotFields)
        {
            writer.beginObject();
            writer.field(L"decisionId", decision.decisionId);
            writer.field(L"direction", decision.direction);
            writer.key(L"incomingFile");
            writeDuplicateFile(writer, decision.incomingFile, false);
            writer.key(L"existingFiles").beginArray();
            for (const DownloadDuplicateFile& file : decision.existingFiles)
            {
                writeDuplicateFile(writer, file, includeSnapshotFields);
            }
            writer.endArray();
            if (includeSnapshotFields)
            {
                writer.field(L"lineageKey", decision.lineageKey);
            }
            writer.endObject();
        }

        std::optional<DownloadDuplicateDecision> parseDuplicateDecision(const JsonValue* value)
        {
            if (value == nullptr || !value->isObject())
            {
                return std::nullopt;
            }

            DownloadDuplicateDecision decision;
            if (const JsonValue* field = value->find(L"decisionId");
                field != nullptr && field->isString())
            {
                decision.decisionId = field->asString();
            }
            if (const JsonValue* field = value->find(L"direction");
                field != nullptr && field->isString())
            {
                decision.direction = field->asString();
            }
            decision.incomingFile = parseDuplicateFile(value->find(L"incomingFile"));
            if (const JsonValue* files = value->find(L"existingFiles");
                files != nullptr && files->isArray())
            {
                for (const JsonValue& file : files->asArray())
                {
                    DownloadDuplicateFile parsed = parseDuplicateFile(&file);
                    if (!parsed.id.empty() && !parsed.fileId.empty())
                    {
                        decision.existingFiles.push_back(std::move(parsed));
                    }
                }
            }
            if (const JsonValue* field = value->find(L"lineageKey");
                field != nullptr && field->isString())
            {
                decision.lineageKey = field->asString();
            }
            if (decision.decisionId.empty() ||
                decision.incomingFile.fileId.empty() ||
                decision.existingFiles.empty())
            {
                return std::nullopt;
            }
            return decision;
        }

        std::string serializeMetadata(const DownloadMetadata& metadata)
        {
            JsonWriter writer;
            writer.beginObject();
            writer.field(L"source", metadata.source);
            writer.field(L"status", metadata.status);
            writer.field(L"gameDomain", metadata.gameDomain);
            writer.field(L"modId", metadata.modId);
            writer.field(L"fileId", metadata.fileId);
            writer.field(L"nexusModName", metadata.nexusModName);
            writer.field(L"version", metadata.version);
            writer.field(L"latestVersion", metadata.latestVersion);
            writer.field(L"destinationFileName", metadata.destinationFileName);
            writer.field(L"partialPath", metadata.partialPath.wstring());
            writer.field(L"bytesReceived", metadata.bytesReceived);
            writer.field(L"totalBytes", metadata.totalBytes);
            writer.field(L"downloadStartedUnix", metadata.downloadStartedUnix);
            writer.field(L"isDownloading", metadata.isDownloading);
            if (metadata.duplicateDecision.has_value())
            {
                writer.key(L"duplicateDecision");
                writeDuplicateDecision(writer, *metadata.duplicateDecision, true);
            }
            writer.endObject();

            return toUtf8(writer.str());
        }

        DownloadMetadata parseMetadata(std::string_view content)
        {
            if (content.empty())
            {
                return {};
            }

            try
            {
                const std::string ownedContent(content);
                const JsonValue root = JsonReader::parse(fromUtf8(ownedContent));
                if (!root.isObject())
                {
                    return {};
                }

                DownloadMetadata metadata;
                if (const JsonValue* value = root.find(L"source"); value != nullptr && value->isString())
                {
                    metadata.source = value->asString();
                }
                if (const JsonValue* value = root.find(L"status"); value != nullptr && value->isString())
                {
                    metadata.status = value->asString();
                }
                if (const JsonValue* value = root.find(L"gameDomain"); value != nullptr && value->isString())
                {
                    metadata.gameDomain = value->asString();
                }
                if (const JsonValue* value = root.find(L"modId"); value != nullptr && value->isString())
                {
                    metadata.modId = value->asString();
                }
                if (const JsonValue* value = root.find(L"fileId"); value != nullptr && value->isString())
                {
                    metadata.fileId = value->asString();
                }
                if (const JsonValue* value = root.find(L"nexusModName"); value != nullptr && value->isString())
                {
                    metadata.nexusModName = value->asString();
                }
                else if (const JsonValue* legacyValue = root.find(L"modName"); legacyValue != nullptr && legacyValue->isString())
                {
                    metadata.nexusModName = legacyValue->asString();
                }
                if (const JsonValue* value = root.find(L"version"); value != nullptr && value->isString())
                {
                    metadata.version = value->asString();
                }
                if (const JsonValue* value = root.find(L"latestVersion"); value != nullptr && value->isString())
                {
                    metadata.latestVersion = value->asString();
                }
                if (const JsonValue* value = root.find(L"installedModName"); value != nullptr && value->isString())
                {
                    metadata.installedModName = value->asString();
                }
                if (const JsonValue* value = root.find(L"installedAtUtc"); value != nullptr && value->isString())
                {
                    metadata.installedAtUtc = value->asString();
                }
                if (const JsonValue* value = root.find(L"destinationFileName"); value != nullptr && value->isString())
                {
                    metadata.destinationFileName = value->asString();
                }
                if (const JsonValue* value = root.find(L"partialPath"); value != nullptr && value->isString())
                {
                    metadata.partialPath = std::filesystem::path(value->asString());
                }
                if (const JsonValue* value = root.find(L"bytesReceived"); value != nullptr)
                {
                    if (value->isNumber())
                    {
                        metadata.bytesReceived = parseUnsigned(value->asNumber());
                    }
                    else if (value->isString())
                    {
                        metadata.bytesReceived = parseUnsigned(value->asString());
                    }
                }
                if (const JsonValue* value = root.find(L"totalBytes"); value != nullptr)
                {
                    if (value->isNumber())
                    {
                        metadata.totalBytes = parseUnsigned(value->asNumber());
                    }
                    else if (value->isString())
                    {
                        metadata.totalBytes = parseUnsigned(value->asString());
                    }
                }
                if (const JsonValue* value = root.find(L"downloadStartedUnix"); value != nullptr)
                {
                    if (value->isNumber())
                    {
                        metadata.downloadStartedUnix = parseUnsigned(value->asNumber());
                    }
                    else if (value->isString())
                    {
                        metadata.downloadStartedUnix = parseUnsigned(value->asString());
                    }
                }
                if (const JsonValue* value = root.find(L"isDownloading"); value != nullptr && value->type() == JsonValue::Type::Boolean)
                {
                    metadata.isDownloading = value->asBoolean();
                }
                metadata.duplicateDecision = parseDuplicateDecision(root.find(L"duplicateDecision"));

                return metadata;
            }
            catch (const std::exception&)
            {
                return {};
            }
        }

        DownloadMetadata readMetadata(const std::filesystem::path& path, bool includeVolatileProgress = false)
        {
            DownloadMetadata metadata = parseMetadata(readTextFile(metadataPath(path)));
            if (!includeVolatileProgress ||
                !metadata.isDownloading ||
                metadata.status == L"Отмена загрузки")
            {
                return metadata;
            }

            const DownloadMetadata progress = parseMetadata(readTextFile(progressSidecarPath(path)));
            if (!progress.isDownloading ||
                progress.bytesReceived < metadata.bytesReceived ||
                (metadata.downloadStartedUnix != 0 &&
                    progress.downloadStartedUnix != 0 &&
                    progress.downloadStartedUnix != metadata.downloadStartedUnix))
            {
                return metadata;
            }

            metadata.status = progress.status.empty() ? metadata.status : progress.status;
            metadata.destinationFileName = progress.destinationFileName.empty()
                ? metadata.destinationFileName
                : progress.destinationFileName;
            metadata.partialPath = progress.partialPath.empty()
                ? metadata.partialPath
                : progress.partialPath;
            metadata.bytesReceived = progress.bytesReceived;
            metadata.totalBytes = progress.totalBytes;
            metadata.downloadStartedUnix = progress.downloadStartedUnix == 0
                ? metadata.downloadStartedUnix
                : progress.downloadStartedUnix;
            metadata.isDownloading = true;
            return metadata;
        }

        void writeMetadata(const std::filesystem::path& path, const DownloadMetadata& metadata)
        {
            writeTextFile(metadataPath(path), serializeMetadata(metadata));
        }

        void writeDownloadProgressSidecar(const std::filesystem::path& path, const DownloadMetadata& metadata)
        {
            (void)tryWriteVolatileTextFile(progressSidecarPath(path), serializeMetadata(metadata));
        }

        void removeDownloadProgressSidecar(const std::filesystem::path& path)
        {
            std::error_code error;
            std::filesystem::remove(progressSidecarPath(path), error);
        }

        DownloadMetadata metadataForRequest(
            std::wstring_view source,
            std::wstring_view status,
            const NxmDownloadRequest& request,
            std::wstring_view nexusModName = {})
        {
            DownloadMetadata metadata;
            metadata.source = std::wstring(source);
            metadata.status = std::wstring(status);
            metadata.gameDomain = request.gameDomain;
            metadata.modId = request.modId;
            metadata.fileId = request.fileId;
            metadata.nexusModName = std::wstring(nexusModName);
            return metadata;
        }

        void persistCompletedArchiveMetadata(
            const std::filesystem::path& downloadedPath,
            const std::filesystem::path& retainedPath,
            const DownloadMetadata& completedMetadata)
        {
            DownloadMetadata retained = readMetadata(retainedPath);
            if (!completedMetadata.source.empty())
            {
                retained.source = completedMetadata.source;
            }
            if (!completedMetadata.gameDomain.empty())
            {
                retained.gameDomain = completedMetadata.gameDomain;
            }
            if (!completedMetadata.modId.empty())
            {
                retained.modId = completedMetadata.modId;
            }
            if (!completedMetadata.fileId.empty())
            {
                retained.fileId = completedMetadata.fileId;
            }
            if (!completedMetadata.nexusModName.empty())
            {
                retained.nexusModName = completedMetadata.nexusModName;
            }
            if (!completedMetadata.version.empty())
            {
                retained.version = completedMetadata.version;
            }
            if (!completedMetadata.latestVersion.empty())
            {
                retained.latestVersion = completedMetadata.latestVersion;
            }
            retained.status.clear();
            retained.destinationFileName.clear();
            retained.partialPath.clear();
            retained.bytesReceived = 0;
            retained.totalBytes = 0;
            retained.downloadStartedUnix = 0;
            retained.isDownloading = false;
            retained.duplicateDecision.reset();
            writeMetadata(retainedPath, retained);

            if (downloadedPath == retainedPath)
            {
                return;
            }
            std::error_code cleanupError;
            std::filesystem::remove(metadataPath(downloadedPath), cleanupError);
            removeDownloadProgressSidecar(downloadedPath);
            std::filesystem::remove(cancelMarkerPath(downloadedPath), cleanupError);
            std::filesystem::remove(
                AtomicFileStore::backupPathFor(metadataPath(downloadedPath)),
                cleanupError);
        }

        std::vector<std::wstring> split(std::wstring_view value, wchar_t separator)
        {
            std::vector<std::wstring> parts;
            std::size_t start = 0;
            while (start <= value.size())
            {
                const std::size_t end = value.find(separator, start);
                std::wstring part(value.substr(start, end == std::wstring_view::npos ? value.size() - start : end - start));
                if (!part.empty())
                {
                    parts.push_back(std::move(part));
                }

                if (end == std::wstring_view::npos)
                {
                    break;
                }

                start = end + 1;
            }

            return parts;
        }

        int hexValue(wchar_t character)
        {
            if (character >= L'0' && character <= L'9')
            {
                return character - L'0';
            }
            if (character >= L'a' && character <= L'f')
            {
                return character - L'a' + 10;
            }
            if (character >= L'A' && character <= L'F')
            {
                return character - L'A' + 10;
            }
            return -1;
        }

        std::wstring urlDecode(std::wstring_view value)
        {
            std::wstring decoded;
            decoded.reserve(value.size());
            for (std::size_t index = 0; index < value.size(); ++index)
            {
                if (value[index] == L'+' )
                {
                    decoded.push_back(L' ');
                    continue;
                }

                if (value[index] == L'%' && index + 2 < value.size())
                {
                    const int high = hexValue(value[index + 1]);
                    const int low = hexValue(value[index + 2]);
                    if (high >= 0 && low >= 0)
                    {
                        decoded.push_back(static_cast<wchar_t>((high << 4) | low));
                        index += 2;
                        continue;
                    }
                }

                decoded.push_back(value[index]);
            }

            return decoded;
        }

        std::map<std::wstring, std::wstring> parseQuery(std::wstring_view query)
        {
            std::map<std::wstring, std::wstring> values;
            if (!query.empty() && query.front() == L'?')
            {
                query.remove_prefix(1);
            }

            for (const std::wstring& pair : split(query, L'&'))
            {
                const std::size_t equals = pair.find(L'=');
                std::wstring key = urlDecode(equals == std::wstring::npos ? pair : pair.substr(0, equals));
                std::wstring value = equals == std::wstring::npos ? L"" : urlDecode(pair.substr(equals + 1));
                key = toLower(std::move(key));
                values[std::move(key)] = std::move(value);
            }

            return values;
        }

        std::wstring archiveExtensionFromFileName(std::wstring_view fileName)
        {
            const std::wstring lowerFileName = toLower(std::wstring(fileName));
            for (std::wstring_view extension : compoundArchiveExtensions)
            {
                if (lowerFileName.ends_with(extension))
                {
                    return std::wstring(extension);
                }
            }

            return toLower(std::filesystem::path(lowerFileName).extension().wstring());
        }

        bool isSupportedArchiveExtension(std::wstring_view extension)
        {
            return std::find(
                supportedArchiveExtensions.begin(),
                supportedArchiveExtensions.end(),
                extension) != supportedArchiveExtensions.end();
        }

        bool isKnownGameArchiveExtension(std::wstring_view extension)
        {
            const GameSupportRegistry& registry = GameSupportRegistry::embedded();

            const std::wstring normalizedExtension = toLower(std::wstring(extension));
            for (const GameDefinition& definition : registry.definitions())
            {
                const auto match = std::find_if(
                    definition.archiveExtensions.begin(),
                    definition.archiveExtensions.end(),
                    [&normalizedExtension](const NormalizedExtension& candidate)
                    {
                        return candidate.value() == normalizedExtension;
                    });
                if (match != definition.archiveExtensions.end())
                {
                    return true;
                }
            }

            return false;
        }

        bool hasSupportedArchiveExtension(std::wstring_view fileName)
        {
            return isSupportedArchiveExtension(archiveExtensionFromFileName(fileName));
        }

        bool hasSupportedDownloadFileExtension(std::wstring_view fileName)
        {
            const std::wstring extension = archiveExtensionFromFileName(fileName);
            if (isSupportedArchiveExtension(extension))
            {
                return true;
            }

            return std::find(
                rawModArchiveExtensions.begin(),
                rawModArchiveExtensions.end(),
                extension) != rawModArchiveExtensions.end() ||
                isKnownGameArchiveExtension(extension);
        }

        std::wstring percentDecodeUtf8(std::wstring_view value)
        {
            std::string bytes;
            bytes.reserve(value.size());
            for (std::size_t index = 0; index < value.size(); ++index)
            {
                if (value[index] == L'%' && index + 2 < value.size())
                {
                    const int high = hexValue(value[index + 1]);
                    const int low = hexValue(value[index + 2]);
                    if (high >= 0 && low >= 0)
                    {
                        bytes.push_back(static_cast<char>((high << 4) | low));
                        index += 2;
                        continue;
                    }
                }

                if (value[index] <= 0x7F)
                {
                    bytes.push_back(static_cast<char>(value[index]));
                }
                else
                {
                    bytes += toUtf8(std::wstring(1, value[index]));
                }
            }

            try
            {
                return fromUtf8(bytes);
            }
            catch (const std::exception&)
            {
                return urlDecode(value);
            }
        }

        std::vector<std::wstring> splitHeaderParameters(std::wstring_view header)
        {
            std::vector<std::wstring> parts;
            std::wstring current;
            bool isQuoted = false;
            bool isEscaped = false;

            for (wchar_t character : header)
            {
                if (isEscaped)
                {
                    current.push_back(character);
                    isEscaped = false;
                    continue;
                }

                if (character == L'\\' && isQuoted)
                {
                    isEscaped = true;
                    current.push_back(character);
                    continue;
                }

                if (character == L'"')
                {
                    isQuoted = !isQuoted;
                    current.push_back(character);
                    continue;
                }

                if (character == L';' && !isQuoted)
                {
                    parts.push_back(std::move(current));
                    current.clear();
                    continue;
                }

                current.push_back(character);
            }

            parts.push_back(std::move(current));
            return parts;
        }

        std::wstring unquoteHeaderValue(std::wstring value)
        {
            value = trimWhitespace(std::move(value));
            if (value.size() < 2 || value.front() != L'"' || value.back() != L'"')
            {
                return value;
            }

            std::wstring unquoted;
            unquoted.reserve(value.size() - 2);
            bool isEscaped = false;
            for (std::size_t index = 1; index + 1 < value.size(); ++index)
            {
                const wchar_t character = value[index];
                if (isEscaped)
                {
                    unquoted.push_back(character);
                    isEscaped = false;
                    continue;
                }

                if (character == L'\\')
                {
                    isEscaped = true;
                    continue;
                }

                unquoted.push_back(character);
            }

            return trimWhitespace(std::move(unquoted));
        }

        std::wstring decodeExtendedHeaderFileName(std::wstring value)
        {
            value = unquoteHeaderValue(std::move(value));
            const std::size_t charsetEnd = value.find(L'\'');
            if (charsetEnd == std::wstring::npos)
            {
                return percentDecodeUtf8(value);
            }

            const std::size_t languageEnd = value.find(L'\'', charsetEnd + 1);
            if (languageEnd == std::wstring::npos)
            {
                return percentDecodeUtf8(value);
            }

            const std::wstring charset = toLower(value.substr(0, charsetEnd));
            const std::wstring encoded = value.substr(languageEnd + 1);
            if (charset == L"utf-8" || charset == L"utf8")
            {
                return percentDecodeUtf8(encoded);
            }

            return urlDecode(encoded);
        }

        std::wstring fileNameFromContentDisposition(std::wstring_view header)
        {
            std::wstring fileName;
            std::wstring extendedFileName;

            for (const std::wstring& parameter : splitHeaderParameters(header))
            {
                const std::size_t equals = parameter.find(L'=');
                if (equals == std::wstring::npos)
                {
                    continue;
                }

                const std::wstring key = toLower(trimWhitespace(parameter.substr(0, equals)));
                const std::wstring value = parameter.substr(equals + 1);
                if (key == L"filename*")
                {
                    extendedFileName = decodeExtendedHeaderFileName(value);
                }
                else if (key == L"filename")
                {
                    fileName = unquoteHeaderValue(value);
                }
            }

            return trim(extendedFileName.empty() ? fileName : extendedFileName);
        }

        std::wstring fileNameFromUriPath(std::wstring_view uri)
        {
            const std::size_t query = uri.find_first_of(L"?#");
            const std::wstring uriPath = query == std::wstring::npos
                ? std::wstring(uri)
                : std::wstring(uri.substr(0, query));
            const std::size_t slash = uriPath.find_last_of(L'/');
            if (slash == std::wstring::npos || slash + 1 >= uriPath.size())
            {
                return {};
            }

            return trim(urlDecode(uriPath.substr(slash + 1)));
        }

        std::wstring archiveFileNameOrFallback(
            std::wstring_view suggestedName,
            const NxmDownloadRequest& request,
            std::wstring_view nexusModName)
        {
            const std::wstring fileName = trim(std::wstring(suggestedName));
            if (!fileName.empty() && hasSupportedArchiveExtension(fileName))
            {
                return sanitizeFileName(fileName);
            }

            return archiveFileName(request, nexusModName);
        }

        std::wstring chooseDownloadFileName(
            std::wstring_view headerFileName,
            std::wstring_view fallbackFileName)
        {
            const std::wstring headerName = trim(std::wstring(headerFileName));
            if (!headerName.empty() && hasSupportedArchiveExtension(headerName))
            {
                return sanitizeFileName(headerName);
            }

            const std::wstring fallbackName = trim(std::wstring(fallbackFileName));
            if (!fallbackName.empty())
            {
                return sanitizeFileName(fallbackName);
            }

            return L"download.zip";
        }

        std::wstring resolvedHttpDownloadFileName(
            std::wstring_view persistedFileName,
            std::wstring_view contentDisposition,
            std::wstring_view fallbackFileName)
        {
            const std::wstring persistedName = trim(std::wstring(persistedFileName));
            if (!persistedName.empty())
            {
                return sanitizeFileName(persistedName);
            }

            return chooseDownloadFileName(
                fileNameFromContentDisposition(contentDisposition),
                fallbackFileName);
        }

        std::wstring readSegmentAfter(const std::vector<std::wstring>& segments, std::wstring_view marker)
        {
            for (std::size_t index = 0; index + 1 < segments.size(); ++index)
            {
                if (toLower(segments[index]) == marker)
                {
                    return segments[index + 1];
                }
            }

            return {};
        }

        NxmDownloadRequest parseNxmLink(const std::wstring& link)
        {
            NxmDownloadRequest request;
            request.originalUrl = link;

            constexpr std::wstring_view scheme = L"nxm://";
            if (link.size() <= scheme.size() ||
                toLower(link.substr(0, scheme.size())) != scheme)
            {
                return request;
            }

            std::wstring rest = link.substr(scheme.size());
            std::wstring query;
            if (const std::size_t queryIndex = rest.find(L'?'); queryIndex != std::wstring::npos)
            {
                query = rest.substr(queryIndex + 1);
                rest = rest.substr(0, queryIndex);
            }

            std::wstring host = rest;
            std::wstring path;
            if (const std::size_t slashIndex = rest.find(L'/'); slashIndex != std::wstring::npos)
            {
                host = rest.substr(0, slashIndex);
                path = rest.substr(slashIndex + 1);
            }

            std::vector<std::wstring> segments = split(path, L'/');
            request.gameDomain = host;
            if (toLower(host) == L"nexusmods.com" && !segments.empty())
            {
                request.gameDomain = segments.front();
                segments.erase(segments.begin());
            }

            request.modId = readSegmentAfter(segments, L"mods");
            request.fileId = readSegmentAfter(segments, L"files");

            const auto queryValues = parseQuery(query);
            if (const auto match = queryValues.find(L"key"); match != queryValues.end())
            {
                request.key = match->second;
            }
            if (const auto match = queryValues.find(L"expires"); match != queryValues.end())
            {
                request.expires = match->second;
            }

            return request;
        }

        std::wstring pendingFileName(const NxmDownloadRequest& request)
        {
            std::wstring name = request.gameDomain.empty()
                ? L"nexus-download"
                : request.gameDomain + L"-" + request.modId + L"-" + request.fileId;
            name = trim(std::move(name));
            if (name.empty())
            {
                name = L"nexus-download";
            }

            return sanitizeFileName(name) + std::wstring(pendingNxmExtension);
        }

        std::wstring archiveFileName(const NxmDownloadRequest& request, std::wstring_view preferredName = {})
        {
            std::wstring name = trim(std::wstring(preferredName));
            if (name.empty())
            {
                name = request.gameDomain.empty()
                    ? L"nexus-download"
                    : request.gameDomain + L"-" + request.modId + L"-" + request.fileId;
            }
            name = trim(std::move(name));
            if (name.empty())
            {
                name = L"nexus-download";
            }

            return sanitizeFileName(name) + L".zip";
        }

        std::wstring percentEncode(std::wstring_view value)
        {
            const std::string utf8 = toUtf8(std::wstring(value));
            std::wstringstream stream;
            stream << std::uppercase << std::hex;
            for (unsigned char character : utf8)
            {
                if ((character >= 'A' && character <= 'Z') ||
                    (character >= 'a' && character <= 'z') ||
                    (character >= '0' && character <= '9') ||
                    character == '-' || character == '_' || character == '.' || character == '~')
                {
                    stream << static_cast<wchar_t>(character);
                }
                else
                {
                    stream << L'%' << std::setw(2) << std::setfill(L'0') << static_cast<int>(character);
                }
            }

            return stream.str();
        }

        std::wstring normalizedPathText(const std::filesystem::path& path)
        {
            return toLower(std::filesystem::weakly_canonical(path).wstring());
        }

        bool isDownloadOutputPathReserved(const std::filesystem::path& path)
        {
            std::lock_guard lock(downloadOutputPathReservationsMutex);
            return reservedDownloadOutputPaths.contains(normalizedPathText(path));
        }

        std::filesystem::path uniqueUnreservedDownloadOutputPath(
            const std::filesystem::path& directory,
            std::wstring_view fileName)
        {
            std::wstring safeName = sanitizeFileName(fileName);
            if (safeName.empty())
            {
                safeName = L"download";
            }

            const auto isUnavailable = [](const std::filesystem::path& candidate)
            {
                return std::filesystem::exists(candidate) ||
                    reservedDownloadOutputPaths.contains(normalizedPathText(candidate));
            };

            std::filesystem::path candidate = directory / std::filesystem::path(safeName);
            if (!isUnavailable(candidate))
            {
                return candidate;
            }

            const std::filesystem::path stem = candidate.stem();
            const std::filesystem::path extension = candidate.extension();
            for (int index = 2;; ++index)
            {
                candidate = directory / std::filesystem::path(
                    stem.wstring() + L" (" + std::to_wstring(index) + L")" + extension.wstring());
                if (!isUnavailable(candidate))
                {
                    return candidate;
                }
            }
        }

        class SingleDownloadOutputPathReservation final
        {
        public:
            explicit SingleDownloadOutputPathReservation(std::wstring key) noexcept
                : key_(std::move(key))
            {
            }

            SingleDownloadOutputPathReservation(const SingleDownloadOutputPathReservation&) = delete;
            SingleDownloadOutputPathReservation& operator=(const SingleDownloadOutputPathReservation&) = delete;

            SingleDownloadOutputPathReservation(SingleDownloadOutputPathReservation&& other) noexcept
                : key_(std::exchange(other.key_, {}))
            {
            }

            SingleDownloadOutputPathReservation& operator=(SingleDownloadOutputPathReservation&&) = delete;

            ~SingleDownloadOutputPathReservation()
            {
                try
                {
                    std::lock_guard lock(downloadOutputPathReservationsMutex);
                    if (!key_.empty())
                    {
                        reservedDownloadOutputPaths.erase(key_);
                    }
                }
                catch (...)
                {
                }
            }

            [[nodiscard]] bool owns(const std::filesystem::path& path) const
            {
                return !key_.empty() && key_ == normalizedPathText(path);
            }

        private:
            std::wstring key_;
        };

        SingleDownloadOutputPathReservation reserveExistingDownloadOutputPath(
            const std::filesystem::path& path)
        {
            std::lock_guard lock(downloadOutputPathReservationsMutex);
            std::wstring key = normalizedPathText(path);
            const bool inserted = reservedDownloadOutputPaths.insert(key).second;
            if (!inserted)
            {
                throw std::runtime_error("Download output path is already active.");
            }

            return SingleDownloadOutputPathReservation(std::move(key));
        }

        class DownloadOutputPathReservation final
        {
        public:
            DownloadOutputPathReservation(
                std::filesystem::path destinationPath,
                std::filesystem::path partialPath,
                std::wstring destinationKey,
                std::wstring partialKey) noexcept
                : destinationPath_(std::move(destinationPath)),
                  partialPath_(std::move(partialPath)),
                  destinationKey_(std::move(destinationKey)),
                  partialKey_(std::move(partialKey))
            {
            }

            DownloadOutputPathReservation(const DownloadOutputPathReservation&) = delete;
            DownloadOutputPathReservation& operator=(const DownloadOutputPathReservation&) = delete;

            DownloadOutputPathReservation(DownloadOutputPathReservation&& other) noexcept
                : destinationPath_(std::move(other.destinationPath_)),
                  partialPath_(std::move(other.partialPath_)),
                  destinationKey_(std::exchange(other.destinationKey_, {})),
                  partialKey_(std::exchange(other.partialKey_, {}))
            {
            }

            DownloadOutputPathReservation& operator=(DownloadOutputPathReservation&&) = delete;

            ~DownloadOutputPathReservation()
            {
                try
                {
                    std::lock_guard lock(downloadOutputPathReservationsMutex);
                    if (!destinationKey_.empty())
                    {
                        reservedDownloadOutputPaths.erase(destinationKey_);
                    }
                    if (!partialKey_.empty())
                    {
                        reservedDownloadOutputPaths.erase(partialKey_);
                    }
                }
                catch (...)
                {
                }
            }

            [[nodiscard]] const std::filesystem::path& destinationPath() const noexcept
            {
                return destinationPath_;
            }

            [[nodiscard]] const std::filesystem::path& partialPath() const noexcept
            {
                return partialPath_;
            }

        private:
            std::filesystem::path destinationPath_;
            std::filesystem::path partialPath_;
            std::wstring destinationKey_;
            std::wstring partialKey_;
        };

        DownloadOutputPathReservation reserveDownloadOutputPaths(
            const std::filesystem::path& directory,
            std::wstring_view destinationFileName,
            const std::filesystem::path& existingPartialPath,
            const SingleDownloadOutputPathReservation* existingPartialReservation = nullptr)
        {
            std::lock_guard lock(downloadOutputPathReservationsMutex);
            std::filesystem::path destinationPath = uniqueUnreservedDownloadOutputPath(
                directory,
                destinationFileName);
            std::filesystem::path partialPath = existingPartialPath.empty()
                ? uniqueUnreservedDownloadOutputPath(
                    directory,
                    std::wstring(destinationFileName) + std::wstring(partialDownloadExtension))
                : existingPartialPath;
            std::wstring destinationKey = normalizedPathText(destinationPath);
            std::wstring partialKey = normalizedPathText(partialPath);
            const bool partialAlreadyOwned = existingPartialReservation != nullptr &&
                existingPartialReservation->owns(partialPath);
            if (destinationKey == partialKey ||
                (!partialAlreadyOwned && reservedDownloadOutputPaths.contains(partialKey)) ||
                (partialAlreadyOwned && !reservedDownloadOutputPaths.contains(partialKey)))
            {
                throw std::runtime_error("Download output path is already active.");
            }

            const auto [destinationEntry, destinationInserted] =
                reservedDownloadOutputPaths.insert(destinationKey);
            if (!destinationInserted)
            {
                throw std::runtime_error("Download destination path is already active.");
            }
            try
            {
                if (!partialAlreadyOwned)
                {
                    const auto [partialEntry, partialInserted] = reservedDownloadOutputPaths.insert(partialKey);
                    if (!partialInserted)
                    {
                        throw std::runtime_error("Download partial path is already active.");
                    }
                }
            }
            catch (...)
            {
                reservedDownloadOutputPaths.erase(destinationEntry);
                throw;
            }

            return DownloadOutputPathReservation(
                std::move(destinationPath),
                std::move(partialPath),
                std::move(destinationKey),
                partialAlreadyOwned ? std::wstring() : std::move(partialKey));
        }

        bool isPathInsideDirectory(
            const std::filesystem::path& candidate,
            const std::filesystem::path& directory)
        {
            std::wstring candidateText = normalizedPathText(candidate);
            std::wstring directoryText = normalizedPathText(directory);
            if (candidateText == directoryText)
            {
                return false;
            }

            if (!directoryText.empty() &&
                directoryText.back() != L'\\' &&
                directoryText.back() != L'/')
            {
                directoryText.push_back(std::filesystem::path::preferred_separator);
            }

            return candidateText.starts_with(directoryText);
        }

        bool isActiveDownload(const std::filesystem::path& path)
        {
            std::lock_guard lock(activeDownloadsMutex);
            const auto match = activeDownloads.find(normalizedPathText(path));
            return match != activeDownloads.end() && match->second > 0;
        }

        bool tryMarkActiveDownload(const std::filesystem::path& path)
        {
            std::lock_guard lock(activeDownloadsMutex);
            const std::wstring key = normalizedPathText(path);
            if (const auto match = activeDownloads.find(key);
                match != activeDownloads.end() && match->second > 0)
            {
                return false;
            }

            activeDownloads[key] = 1;
            return true;
        }

        void markActiveDownload(const std::filesystem::path& path)
        {
            std::lock_guard lock(activeDownloadsMutex);
            ++activeDownloads[normalizedPathText(path)];
        }

        void unmarkActiveDownload(const std::filesystem::path& path)
        {
            std::lock_guard lock(activeDownloadsMutex);
            const auto match = activeDownloads.find(normalizedPathText(path));
            if (match == activeDownloads.end())
            {
                return;
            }

            if (match->second <= 1)
            {
                activeDownloads.erase(match);
                return;
            }

            --match->second;
        }

        class ActiveDownloadRegistration final
        {
        public:
            explicit ActiveDownloadRegistration(const std::filesystem::path& path)
                : key_(normalizedPathText(path))
            {
                markActiveDownload(path);
            }

            ~ActiveDownloadRegistration()
            {
                std::lock_guard lock(activeDownloadsMutex);
                const auto match = activeDownloads.find(key_);
                if (match == activeDownloads.end())
                {
                    return;
                }

                if (match->second <= 1)
                {
                    activeDownloads.erase(match);
                    return;
                }

                --match->second;
            }

            ActiveDownloadRegistration(const ActiveDownloadRegistration&) = delete;
            ActiveDownloadRegistration& operator=(const ActiveDownloadRegistration&) = delete;

        private:
            std::wstring key_;
        };

        class ActiveDownloadClaim final
        {
        public:
            explicit ActiveDownloadClaim(std::filesystem::path path) noexcept
                : path_(std::move(path))
            {
            }

            ActiveDownloadClaim(const ActiveDownloadClaim&) = delete;
            ActiveDownloadClaim& operator=(const ActiveDownloadClaim&) = delete;

            ~ActiveDownloadClaim()
            {
                if (!transferred_)
                {
                    try
                    {
                        unmarkActiveDownload(path_);
                    }
                    catch (...)
                    {
                    }
                }
            }

            void transferToQueue() noexcept
            {
                transferred_ = true;
            }

        private:
            std::filesystem::path path_;
            bool transferred_ = false;
        };

        std::uintmax_t regularFileSizeOrZero(const std::filesystem::path& path)
        {
            std::error_code error;
            if (path.empty() ||
                !std::filesystem::exists(path, error) ||
                !std::filesystem::is_regular_file(path, error))
            {
                return 0;
            }

            const std::uintmax_t size = std::filesystem::file_size(path, error);
            return error ? 0 : size;
        }

        std::filesystem::path resumablePartialPath(
            const std::filesystem::path& directory,
            const DownloadMetadata& metadata)
        {
            if (metadata.partialPath.empty())
            {
                return {};
            }

            std::error_code error;
            if (!std::filesystem::exists(metadata.partialPath, error) ||
                !std::filesystem::is_regular_file(metadata.partialPath, error) ||
                !isPathInsideDirectory(metadata.partialPath, directory))
            {
                return {};
            }

            return metadata.partialPath;
        }

        void updateBytesFromPartial(
            const std::filesystem::path& directory,
            DownloadMetadata& metadata)
        {
            const std::filesystem::path partialPath = resumablePartialPath(directory, metadata);
            if (!partialPath.empty())
            {
                metadata.bytesReceived = regularFileSizeOrZero(partialPath);
            }
        }

        bool isSameModFolderName(std::wstring_view actualName, std::wstring_view expectedName)
        {
            return toLower(sanitizeFileName(actualName)) == toLower(std::wstring(expectedName));
        }

        std::filesystem::path redundantRootDirectory(
            const std::filesystem::path& stagingDirectory,
            std::wstring_view modFolderName)
        {
            std::filesystem::path rootDirectory;
            bool foundRoot = false;
            for (const auto& entry : std::filesystem::directory_iterator(stagingDirectory))
            {
                if (foundRoot || !entry.is_directory())
                {
                    return {};
                }

                rootDirectory = entry.path();
                foundRoot = true;
            }

            if (!foundRoot ||
                !isSameModFolderName(rootDirectory.filename().wstring(), modFolderName))
            {
                return {};
            }

            return rootDirectory;
        }

        void moveDirectoryContents(
            const std::filesystem::path& sourceDirectory,
            const std::filesystem::path& destinationDirectory)
        {
            std::vector<std::filesystem::path> children;
            for (const auto& entry : std::filesystem::directory_iterator(sourceDirectory))
            {
                children.push_back(entry.path());
            }

            for (const std::filesystem::path& child : children)
            {
                std::filesystem::rename(child, destinationDirectory / child.filename());
            }
        }

        void copyDirectoryContentsOverwriting(
            const std::filesystem::path& sourceDirectory,
            const std::filesystem::path& destinationDirectory)
        {
            const PathSafetyService safety;
            safety.validateDirectoryWriteRoot(destinationDirectory)
                .throwIfUnsafe("Mod merge destination is unsafe");
            std::filesystem::create_directories(destinationDirectory);

            for (const auto& entry : std::filesystem::recursive_directory_iterator(sourceDirectory))
            {
                safety.validateContainedPath(sourceDirectory, entry.path())
                    .throwIfUnsafe("Mod merge source path is unsafe");
                const std::filesystem::path relativePath = std::filesystem::relative(entry.path(), sourceDirectory);
                const std::filesystem::path destinationPath = destinationDirectory / relativePath;

                if (entry.is_directory())
                {
                    safety.validateWritePath(destinationDirectory, destinationPath)
                        .throwIfUnsafe("Mod merge directory target is unsafe");
                    if (std::filesystem::exists(destinationPath) &&
                        !std::filesystem::is_directory(destinationPath))
                    {
                        std::filesystem::remove(destinationPath);
                    }
                    std::filesystem::create_directories(destinationPath);
                    continue;
                }

                if (!entry.is_regular_file())
                {
                    continue;
                }

                std::filesystem::create_directories(destinationPath.parent_path());
                if (std::filesystem::is_directory(destinationPath))
                {
                    std::filesystem::remove_all(destinationPath);
                }

                std::error_code sizeError;
                const std::uintmax_t bytes = entry.file_size(sizeError);
                safety.validateWritePath(
                    destinationDirectory,
                    destinationPath,
                    PathSafetyWriteOptions{sizeError ? 0 : bytes, false})
                    .throwIfUnsafe("Mod merge file target is unsafe");
                std::filesystem::copy_file(
                    entry.path(),
                    destinationPath,
                    std::filesystem::copy_options::overwrite_existing);
            }
        }

        class InstalledDirectoryCommit final
        {
        public:
            InstalledDirectoryCommit() = default;
            InstalledDirectoryCommit(const InstalledDirectoryCommit&) = delete;
            InstalledDirectoryCommit& operator=(const InstalledDirectoryCommit&) = delete;

            ~InstalledDirectoryCommit()
            {
                rollback();
            }

            void attachJournal(
                Logger& logger,
                const std::filesystem::path& projectDirectory,
                std::wstring_view operationId)
            {
                logger_ = &logger;
                projectDirectory_ = projectDirectory;
                operationId_ = operationId;
            }

            void promote(
                const std::filesystem::path& stagingDirectory,
                const std::filesystem::path& targetDirectory,
                const std::filesystem::path& modsDirectory,
                std::wstring_view safeName)
            {
                if (active_)
                {
                    throw std::logic_error("An installed directory commit is already active.");
                }
                targetDirectory_ = targetDirectory;
                targetExisted_ = std::filesystem::exists(targetDirectory);
                if (targetExisted_)
                {
                    backupDirectory_ = uniquePath(
                        modsDirectory,
                        L"." + std::wstring(safeName) + L".replacing");
                }
                writeJournal(L"prepared", stagingDirectory);
                if (targetExisted_)
                {
                    std::filesystem::rename(targetDirectory, backupDirectory_);
                    writeJournal(L"targetBackedUp", stagingDirectory);
                }

                try
                {
                    std::filesystem::rename(stagingDirectory, targetDirectory);
                    active_ = true;
                    writeJournal(L"promoted", stagingDirectory);
                }
                catch (const std::exception&)
                {
                    if (!backupDirectory_.empty() && !std::filesystem::exists(targetDirectory))
                    {
                        std::error_code restoreError;
                        std::filesystem::rename(backupDirectory_, targetDirectory, restoreError);
                    }
                    throw;
                }
            }

            void commit() noexcept
            {
                if (!active_)
                {
                    return;
                }
                if (!backupDirectory_.empty())
                {
                    std::error_code cleanupError;
                    std::filesystem::remove_all(backupDirectory_, cleanupError);
                }
                try
                {
                    writeJournal(L"committed", {});
                }
                catch (...)
                {
                }
                InstallTransactionJournal::remove(projectDirectory_, operationId_);
                active_ = false;
            }

        private:
            void writeJournal(
                std::wstring stage,
                const std::filesystem::path& stagingDirectory)
            {
                if (projectDirectory_.empty() || operationId_.empty())
                {
                    return;
                }
                InstallTransactionJournal::write(
                    projectDirectory_,
                    InstallTransactionRecord{
                        operationId_,
                        stage,
                        stagingDirectory,
                        targetDirectory_,
                        backupDirectory_,
                        targetExisted_
                    });
                if (logger_ != nullptr)
                {
                    logger_->writeOperation(
                        LogLevel::Info,
                        "InstallTransaction",
                        "journalStage=" + toUtf8(std::wstring(stage)) +
                            " operationId=" + toUtf8(operationId_) + ".");
                }
            }

            void rollback() noexcept
            {
                if (!active_)
                {
                    InstallTransactionJournal::remove(projectDirectory_, operationId_);
                    return;
                }
                try
                {
                    writeJournal(L"rollingBack", {});
                }
                catch (...)
                {
                }
                std::error_code cleanupError;
                std::filesystem::remove_all(targetDirectory_, cleanupError);
                if (targetExisted_ && !backupDirectory_.empty())
                {
                    std::error_code restoreError;
                    std::filesystem::rename(
                        backupDirectory_,
                        targetDirectory_,
                        restoreError);
                }
                InstallTransactionJournal::remove(projectDirectory_, operationId_);
                active_ = false;
            }

            std::filesystem::path projectDirectory_;
            Logger* logger_{nullptr};
            std::wstring operationId_;
            std::filesystem::path targetDirectory_;
            std::filesystem::path backupDirectory_;
            bool targetExisted_{false};
            bool active_{false};
        };

        void replaceDirectoryWithStaging(
            const std::filesystem::path& stagingDirectory,
            const std::filesystem::path& targetDirectory,
            const std::filesystem::path& modsDirectory,
            std::wstring_view safeName)
        {
            InstalledDirectoryCommit commit;
            commit.promote(stagingDirectory, targetDirectory, modsDirectory, safeName);
            commit.commit();
        }

        std::filesystem::path prepareFullMergeStaging(
            const std::filesystem::path& incomingStaging,
            const std::filesystem::path& targetDirectory,
            const std::filesystem::path& modsDirectory,
            std::wstring_view safeName)
        {
            const std::filesystem::path mergedStaging = uniquePath(
                modsDirectory,
                L"." + std::wstring(safeName) + L".merging");
            std::filesystem::create_directories(mergedStaging);
            try
            {
                copyDirectoryContentsOverwriting(targetDirectory, mergedStaging);
                copyDirectoryContentsOverwriting(incomingStaging, mergedStaging);
                std::filesystem::remove_all(incomingStaging);
                return mergedStaging;
            }
            catch (const std::exception&)
            {
                std::error_code cleanupError;
                std::filesystem::remove_all(mergedStaging, cleanupError);
                throw;
            }
        }

        std::vector<InstallConflictFile> exactInstallFileInventory(
            const std::filesystem::path& stagingDirectory)
        {
            std::vector<InstallConflictFile> files;
            const std::filesystem::path ioStagingDirectory =
                pathForFilesystemIo(stagingDirectory);
            std::error_code iterateError;
            std::filesystem::recursive_directory_iterator iterator(
                ioStagingDirectory,
                std::filesystem::directory_options::skip_permission_denied,
                iterateError);
            if (iterateError)
            {
                throw std::runtime_error(
                    "Failed to enumerate exact install inventory: " +
                    iterateError.message());
            }
            const std::filesystem::recursive_directory_iterator end;
            for (; iterator != end; iterator.increment(iterateError))
            {
                if (iterateError)
                {
                    throw std::runtime_error(
                        "Failed to enumerate exact install inventory: " +
                        iterateError.message());
                }
                const std::filesystem::directory_entry entry = *iterator;
                if (entry.is_directory() &&
                    toLower(entry.path().filename().wstring()) == L".flow")
                {
                    iterator.disable_recursion_pending();
                    continue;
                }
                if (!entry.is_regular_file())
                {
                    continue;
                }
                const std::filesystem::path relative =
                    entry.path().lexically_relative(ioStagingDirectory);
                InstallConflictFile file;
                file.relativePath = relative.generic_wstring();
                file.size = entry.file_size();
                file.modifiedAt = std::to_wstring(
                    entry.last_write_time().time_since_epoch().count());
                files.push_back(std::move(file));
            }
            if (iterateError)
            {
                throw std::runtime_error(
                    "Failed to enumerate exact install inventory: " +
                    iterateError.message());
            }
            std::sort(
                files.begin(),
                files.end(),
                [](const InstallConflictFile& left, const InstallConflictFile& right)
                {
                    return InstallConflictPreviewService::normalizedPathKey(left.relativePath) <
                        InstallConflictPreviewService::normalizedPathKey(right.relativePath);
                });
            return files;
        }

        void flattenRedundantModRootDirectory(
            const std::filesystem::path& stagingDirectory,
            std::wstring_view modFolderName)
        {
            const std::filesystem::path rootDirectory = redundantRootDirectory(stagingDirectory, modFolderName);
            if (rootDirectory.empty())
            {
                return;
            }

            const std::filesystem::path temporaryRootDirectory = uniquePath(
                stagingDirectory.parent_path(),
                L"." + std::wstring(modFolderName) + L".root");
            std::filesystem::rename(rootDirectory, temporaryRootDirectory);

            try
            {
                moveDirectoryContents(temporaryRootDirectory, stagingDirectory);
                std::filesystem::remove(temporaryRootDirectory);
            }
            catch (const std::exception&)
            {
                std::filesystem::remove_all(temporaryRootDirectory);
                throw;
            }
        }

        std::wstring readXmlElementText(std::wstring_view text, std::wstring_view elementName)
        {
            const std::wstring lowerText = toLower(std::wstring(text));
            const std::wstring lowerName = toLower(std::wstring(elementName));
            const std::wstring openNeedle = L"<" + lowerName;
            const std::wstring closeNeedle = L"</" + lowerName + L">";

            const std::size_t open = lowerText.find(openNeedle);
            if (open == std::wstring::npos)
            {
                return {};
            }

            const std::size_t openEnd = lowerText.find(L'>', open);
            if (openEnd == std::wstring::npos)
            {
                return {};
            }

            const std::size_t close = lowerText.find(closeNeedle, openEnd + 1);
            if (close == std::wstring::npos || close <= openEnd)
            {
                return {};
            }

            return trim(std::wstring(text.substr(openEnd + 1, close - openEnd - 1)));
        }

        std::wstring versionFromJsonManifest(const std::filesystem::path& path)
        {
            try
            {
                const std::string content = readTextFile(path);
                if (content.empty())
                {
                    return {};
                }

                const JsonValue root = JsonReader::parse(fromUtf8(content));
                if (!root.isObject())
                {
                    return {};
                }

                for (const wchar_t* key : {L"version", L"Version", L"modVersion", L"mod_version"})
                {
                    if (const JsonValue* value = root.find(key); value != nullptr && value->isString())
                    {
                        const std::wstring version = trim(value->asString());
                        if (!version.empty())
                        {
                            return version;
                        }
                    }
                }
            }
            catch (const std::exception&)
            {
            }

            return {};
        }

        std::wstring versionFromFomodInfo(const std::filesystem::path& stagingDirectory)
        {
            const std::array<std::filesystem::path, 3> candidates{
                stagingDirectory / L"fomod" / L"info.xml",
                stagingDirectory / L"FOMOD" / L"info.xml",
                stagingDirectory / L"fomod" / L"Info.xml"
            };

            for (const std::filesystem::path& candidate : candidates)
            {
                if (!std::filesystem::exists(candidate) || !std::filesystem::is_regular_file(candidate))
                {
                    continue;
                }

                try
                {
                    const std::wstring text = fromUtf8(readTextFile(candidate));
                    const std::wstring version = readXmlElementText(text, L"Version");
                    if (!version.empty())
                    {
                        return version;
                    }
                }
                catch (const std::exception&)
                {
                }
            }

            return {};
        }

        std::wstring versionFromArchiveFileName(
            const std::filesystem::path& archivePath,
            std::wstring_view installName)
        {
            std::wstring name = archivePath.filename().wstring();
            const std::wstring extension = archiveExtensionFromFileName(name);
            if (!extension.empty() && toLower(name).ends_with(extension))
            {
                name.resize(name.size() - extension.size());
            }

            std::wstring comparableName = toLower(name);
            const std::wstring comparableInstallName = toLower(std::wstring(installName));
            if (!comparableInstallName.empty())
            {
                const std::size_t index = comparableName.find(comparableInstallName);
                if (index != std::wstring::npos)
                {
                    name.erase(index, comparableInstallName.size());
                }
            }

            static const std::wregex versionPattern(
                LR"((?:^|[\s_\-\[\]\(\)])v?(\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z][0-9A-Za-z._-]*)?)(?:$|[\s_\-\[\]\(\)]))",
                std::regex_constants::icase);
            std::wsmatch match;
            if (std::regex_search(name, match, versionPattern) && match.size() > 1)
            {
                return trim(match[1].str());
            }

            return {};
        }

        std::wstring detectInstalledModVersion(
            const std::filesystem::path& stagingDirectory,
            const std::filesystem::path& archivePath,
            const DownloadMetadata& metadata,
            std::wstring_view installName)
        {
            if (!trim(metadata.version).empty())
            {
                return trim(metadata.version);
            }

            if (std::wstring version = versionFromFomodInfo(stagingDirectory); !version.empty())
            {
                return version;
            }

            for (const std::filesystem::path& candidate : {
                     stagingDirectory / L"manifest.json",
                     stagingDirectory / L"meta.json",
                     stagingDirectory / L".flow" / L"manifest.json"})
            {
                if (std::filesystem::exists(candidate) && std::filesystem::is_regular_file(candidate))
                {
                    if (std::wstring version = versionFromJsonManifest(candidate); !version.empty())
                    {
                        return version;
                    }
                }
            }

            return versionFromArchiveFileName(archivePath, installName);
        }

        DownloadEntry buildEntry(const std::filesystem::path& path)
        {
            DownloadMetadata metadata = readMetadata(path, true);
            const bool isPending = path.extension().wstring() == pendingNxmExtension;
            const std::filesystem::path directory = path.parent_path();
            if (metadata.isDownloading && !isActiveDownload(path))
            {
                updateBytesFromPartial(directory, metadata);
                metadata.status = L"Отменено";
                metadata.downloadStartedUnix = 0;
                metadata.isDownloading = false;
                writeMetadata(path, metadata);
                removeDownloadProgressSidecar(path);
                std::filesystem::remove(cancelMarkerPath(path));
            }

            std::wstring fileName = path.filename().wstring();
            bool hasResolvedFileName = !isPending;
            if (isPending)
            {
                const std::wstring destinationFileName =
                    sanitizeFileName(trim(metadata.destinationFileName));
                if (!destinationFileName.empty())
                {
                    fileName = destinationFileName;
                    hasResolvedFileName = true;
                }
            }
            const std::wstring stem = path.stem().wstring();

            std::wstring name = std::filesystem::path(fileName).stem().wstring();
            if (name.empty())
            {
                name = stem;
                if (!metadata.modId.empty() && !metadata.fileId.empty())
                {
                    name = metadata.gameDomain + L" #" + metadata.modId + L"/" + metadata.fileId;
                }
            }

            std::wstring status = metadata.status;
            if (status.empty())
            {
                status = isPending
                    ? L"Ожидает загрузки"
                    : L"Готово";
            }
            std::wstring sizeText;
            if (isPending)
            {
                if (metadata.totalBytes > 0)
                {
                    sizeText = formatSize(metadata.totalBytes);
                }
                else
                {
                    sizeText = metadata.isDownloading ? L"-" : L"NXM";
                }
            }
            else
            {
                sizeText = formatSize(std::filesystem::file_size(path));
            }

            const bool awaitingDecision = isPending && metadata.duplicateDecision.has_value();
            const bool canResume = isPending &&
                !metadata.isDownloading &&
                !awaitingDecision &&
                !trim(metadata.source).empty();
            const bool shouldShowProgress = metadata.isDownloading || canResume;
            const bool hasKnownProgress = shouldShowProgress && metadata.totalBytes > 0;
            const int progressPercent = shouldShowProgress ? downloadProgressPercent(metadata) : 0;

            std::wstring transferState = L"idle";
            if (isPending)
            {
                const std::wstring normalizedStatus = toLower(status);
                if (awaitingDecision)
                {
                    transferState = L"awaiting-decision";
                }
                else if (metadata.isDownloading)
                {
                    transferState = L"downloading";
                }
                else if (normalizedStatus.find(L"отмен") != std::wstring::npos ||
                    normalizedStatus.find(L"cancel") != std::wstring::npos)
                {
                    transferState = L"canceled";
                }
                else if (normalizedStatus.find(L"ошиб") != std::wstring::npos ||
                    normalizedStatus.find(L"failed") != std::wstring::npos ||
                    normalizedStatus.find(L"expired") != std::wstring::npos)
                {
                    transferState = L"failed";
                }
                else if (canResume)
                {
                    transferState = L"paused";
                }
                else
                {
                    transferState = L"queued";
                }
            }

            DownloadEntry entry;
            entry.id = path.wstring();
            entry.name = std::move(name);
            entry.fileName = std::move(fileName);
            entry.localPath = path;
            entry.source = metadata.source.empty() ? L"Локальный файл" : metadata.source;
            entry.status = status;
            entry.transferState = std::move(transferState);
            entry.transferMessage = metadata.status;
            entry.sizeText = std::move(sizeText);
            std::error_code lastWriteError;
            const std::filesystem::file_time_type lastWriteTime =
                std::filesystem::last_write_time(path, lastWriteError);
            entry.createdAtText = lastWriteError ? std::wstring() : formatFileTime(lastWriteTime);
            entry.progressPercent = progressPercent;
            entry.progressText = shouldShowProgress ? formatProgressText(metadata) : std::wstring();
            entry.etaText = shouldShowProgress ? formatEta(metadata) : std::wstring();
            entry.downloadSpeedText = shouldShowProgress ? formatDownloadSpeed(metadata) : std::wstring();
            entry.isDownloading = metadata.isDownloading;
            entry.hasKnownProgress = hasKnownProgress;
            entry.hasResolvedFileName = hasResolvedFileName;
            entry.canResume = canResume;
            entry.canInstall = !isPending && !metadata.isDownloading;
            entry.canDelete = !metadata.isDownloading && !awaitingDecision;
            entry.duplicateDecision = metadata.duplicateDecision;
            return entry;
        }

        std::wstring nowUtcText()
        {
            const std::time_t now = std::time(nullptr);
            std::tm utc{};
#ifdef _WIN32
            gmtime_s(&utc, &now);
#else
            gmtime_r(&now, &utc);
#endif
            std::wstringstream stream;
            stream << std::put_time(&utc, L"%Y-%m-%dT%H:%M:%SZ");
            return stream.str();
        }

#ifdef _WIN32
        std::wstring quoteCommandArgument(std::wstring_view value)
        {
            return L"\"" + std::wstring(value) + L"\"";
        }

        std::filesystem::path executableDirectory()
        {
            std::wstring buffer(MAX_PATH, L'\0');
            DWORD length = 0;
            while (true)
            {
                length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
                if (length == 0)
                {
                    return {};
                }
                if (length < buffer.size() - 1)
                {
                    break;
                }

                buffer.resize(buffer.size() * 2);
            }

            buffer.resize(length);
            return std::filesystem::path(buffer).parent_path();
        }

        void addExistingExecutableCandidate(
            std::vector<std::filesystem::path>& candidates,
            const std::filesystem::path& path)
        {
            if (!path.empty() && std::filesystem::exists(path) && std::filesystem::is_regular_file(path))
            {
                candidates.push_back(path);
            }
        }

        std::filesystem::path searchPathExecutable(std::wstring_view executableName)
        {
            const std::wstring name(executableName);
            const DWORD requiredLength = SearchPathW(nullptr, name.c_str(), nullptr, 0, nullptr, nullptr);
            if (requiredLength == 0)
            {
                return {};
            }

            std::wstring buffer(requiredLength, L'\0');
            const DWORD actualLength = SearchPathW(
                nullptr,
                name.c_str(),
                nullptr,
                static_cast<DWORD>(buffer.size()),
                buffer.data(),
                nullptr);
            if (actualLength == 0 || actualLength >= buffer.size())
            {
                return {};
            }

            buffer.resize(actualLength);
            return std::filesystem::path(buffer);
        }

        std::filesystem::path findExtractorExecutable(std::wstring_view executableName)
        {
            std::vector<std::filesystem::path> candidates;

            const std::filesystem::path appDirectory = executableDirectory();
            addExistingExecutableCandidate(candidates, appDirectory / std::filesystem::path(executableName));
            addExistingExecutableCandidate(candidates, appDirectory / L"tools" / std::filesystem::path(executableName));
            addExistingExecutableCandidate(candidates, appDirectory / L"tools" / L"7zip" / std::filesystem::path(executableName));

            for (const wchar_t* variable : {L"ProgramW6432", L"ProgramFiles", L"ProgramFiles(x86)"})
            {
                const std::wstring root = readEnvironmentVariable(variable);
                if (root.empty())
                {
                    continue;
                }

                addExistingExecutableCandidate(candidates, std::filesystem::path(root) / L"7-Zip" / std::filesystem::path(executableName));
                addExistingExecutableCandidate(candidates, std::filesystem::path(root) / L"WinRAR" / std::filesystem::path(executableName));
            }

            if (std::filesystem::path pathMatch = searchPathExecutable(executableName); !pathMatch.empty())
            {
                addExistingExecutableCandidate(candidates, pathMatch);
            }

            return candidates.empty() ? std::filesystem::path() : candidates.front();
        }

        std::wstring readRegistryString(HKEY root, std::wstring_view subKey, const wchar_t* valueName)
        {
            HKEY key{};
            if (RegOpenKeyExW(root, std::wstring(subKey).c_str(), 0, KEY_READ, &key) != ERROR_SUCCESS)
            {
                return {};
            }

            DWORD type{};
            DWORD size{};
            const LONG queryResult = RegQueryValueExW(key, valueName, nullptr, &type, nullptr, &size);
            if (queryResult != ERROR_SUCCESS || (type != REG_SZ && type != REG_EXPAND_SZ) || size == 0)
            {
                RegCloseKey(key);
                return {};
            }

            std::wstring value(size / sizeof(wchar_t), L'\0');
            if (RegQueryValueExW(key, valueName, nullptr, &type, reinterpret_cast<LPBYTE>(value.data()), &size) != ERROR_SUCCESS)
            {
                RegCloseKey(key);
                return {};
            }

            RegCloseKey(key);
            while (!value.empty() && value.back() == L'\0')
            {
                value.pop_back();
            }
            return value;
        }

        void writeRegistryString(HKEY root, std::wstring_view subKey, const wchar_t* valueName, std::wstring_view value)
        {
            HKEY key{};
            if (RegCreateKeyExW(
                    root,
                    std::wstring(subKey).c_str(),
                    0,
                    nullptr,
                    REG_OPTION_NON_VOLATILE,
                    KEY_WRITE,
                    nullptr,
                    &key,
                    nullptr) != ERROR_SUCCESS)
            {
                throw std::runtime_error("Failed to write registry key.");
            }

            const std::wstring text(value);
            RegSetValueExW(
                key,
                valueName,
                0,
                REG_SZ,
                reinterpret_cast<const BYTE*>(text.c_str()),
                static_cast<DWORD>((text.size() + 1) * sizeof(wchar_t)));
            RegCloseKey(key);
        }

        std::wstring buildProtocolCommand(const std::filesystem::path& executablePath)
        {
            return L"\"" + executablePath.wstring() + L"\" \"%1\"";
        }

        std::wstring queryCustomHeader(HINTERNET request, const wchar_t* headerName)
        {
            DWORD size = 0;
            if (WinHttpQueryHeaders(
                    request,
                    WINHTTP_QUERY_CUSTOM,
                    headerName,
                    WINHTTP_NO_OUTPUT_BUFFER,
                    &size,
                    WINHTTP_NO_HEADER_INDEX) ||
                GetLastError() != ERROR_INSUFFICIENT_BUFFER)
            {
                return {};
            }

            std::wstring value(size / sizeof(wchar_t), L'\0');
            if (!WinHttpQueryHeaders(
                    request,
                    WINHTTP_QUERY_CUSTOM,
                    headerName,
                    value.data(),
                    &size,
                    WINHTTP_NO_HEADER_INDEX))
            {
                return {};
            }

            value.resize(size / sizeof(wchar_t));
            while (!value.empty() && value.back() == L'\0')
            {
                value.pop_back();
            }

            return trimWhitespace(std::move(value));
        }

        std::string nexusHttpErrorMessage(DWORD statusCode)
        {
            if (statusCode == 401)
            {
                return "Nexus request returned HTTP 401. Reconnect NexusMods in settings and try again.";
            }

            return "Nexus request returned HTTP " + std::to_string(statusCode) + ".";
        }

        std::string winHttpGet(
            const std::wstring& url,
            std::wstring_view extraHeaders = {},
            DWORD timeoutMilliseconds = 30'000)
        {
            URL_COMPONENTS components{};
            components.dwStructSize = sizeof(components);
            components.dwSchemeLength = static_cast<DWORD>(-1);
            components.dwHostNameLength = static_cast<DWORD>(-1);
            components.dwUrlPathLength = static_cast<DWORD>(-1);
            components.dwExtraInfoLength = static_cast<DWORD>(-1);

            if (!WinHttpCrackUrl(url.c_str(), static_cast<DWORD>(url.size()), 0, &components))
            {
                throw std::runtime_error("Invalid Nexus download URL.");
            }

            std::wstring host(components.lpszHostName, components.dwHostNameLength);
            std::wstring path(components.lpszUrlPath, components.dwUrlPathLength);
            path.append(components.lpszExtraInfo, components.dwExtraInfoLength);

            HINTERNET session = WinHttpOpen(
                L"FluxoraModManager/1.0",
                WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                WINHTTP_NO_PROXY_NAME,
                WINHTTP_NO_PROXY_BYPASS,
                0);
            if (session == nullptr)
            {
                throw std::runtime_error("Failed to initialize Nexus HTTP session.");
            }
            if (!WinHttpSetTimeouts(
                    session,
                    timeoutMilliseconds,
                    timeoutMilliseconds,
                    timeoutMilliseconds,
                    timeoutMilliseconds))
            {
                WinHttpCloseHandle(session);
                throw std::runtime_error("Failed to configure Nexus HTTP timeouts.");
            }

            HINTERNET connection = WinHttpConnect(session, host.c_str(), components.nPort, 0);
            if (connection == nullptr)
            {
                WinHttpCloseHandle(session);
                throw std::runtime_error("Failed to connect to Nexus.");
            }

            const DWORD flags = components.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
            HINTERNET request = WinHttpOpenRequest(
                connection,
                L"GET",
                path.c_str(),
                nullptr,
                WINHTTP_NO_REFERER,
                WINHTTP_DEFAULT_ACCEPT_TYPES,
                flags);
            if (request == nullptr)
            {
                WinHttpCloseHandle(connection);
                WinHttpCloseHandle(session);
                throw std::runtime_error("Failed to open Nexus request.");
            }

            std::wstring headers =
                L"Accept: application/json\r\n"
                L"Application-Name: Fluxora\r\n"
                L"Application-Version: 1.0\r\n";
            headers += extraHeaders;

            if (!WinHttpSendRequest(
                    request,
                    headers.c_str(),
                    static_cast<DWORD>(headers.size()),
                    WINHTTP_NO_REQUEST_DATA,
                    0,
                    0,
                    0) ||
                !WinHttpReceiveResponse(request, nullptr))
            {
                WinHttpCloseHandle(request);
                WinHttpCloseHandle(connection);
                WinHttpCloseHandle(session);
                throw std::runtime_error("Nexus request failed.");
            }

            DWORD statusCode{};
            DWORD statusCodeSize = sizeof(statusCode);
            WinHttpQueryHeaders(
                request,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                WINHTTP_HEADER_NAME_BY_INDEX,
                &statusCode,
                &statusCodeSize,
                WINHTTP_NO_HEADER_INDEX);
            if (statusCode < 200 || statusCode >= 300)
            {
                WinHttpCloseHandle(request);
                WinHttpCloseHandle(connection);
                WinHttpCloseHandle(session);
                throw std::runtime_error(nexusHttpErrorMessage(statusCode));
            }

            std::string body;
            std::vector<char> buffer;
            while (true)
            {
                DWORD available{};
                if (!WinHttpQueryDataAvailable(request, &available))
                {
                    break;
                }
                if (available == 0)
                {
                    break;
                }

                if (buffer.size() < available)
                {
                    buffer.resize(available);
                }
                DWORD read{};
                if (!WinHttpReadData(request, buffer.data(), available, &read))
                {
                    break;
                }
                body.append(buffer.data(), read);
            }

            WinHttpCloseHandle(request);
            WinHttpCloseHandle(connection);
            WinHttpCloseHandle(session);
            return body;
        }

        enum class DownloadProgressWriteMode
        {
            VolatileOnly,
            DurableCheckpoint
        };

        DownloadMetadata progressMetadataSnapshot(
            DownloadMetadata metadata,
            std::uintmax_t bytesReceived,
            std::uintmax_t totalBytes,
            std::uintmax_t startedUnix)
        {
            metadata.status = L"Скачивается";
            metadata.bytesReceived = bytesReceived;
            metadata.totalBytes = totalBytes;
            metadata.downloadStartedUnix = startedUnix;
            metadata.isDownloading = true;
            return metadata;
        }

        void updateDownloadProgress(
            const std::filesystem::path& progressPath,
            DownloadMetadata metadata,
            std::uintmax_t bytesReceived,
            std::uintmax_t totalBytes,
            std::uintmax_t startedUnix,
            DownloadProgressWriteMode mode)
        {
            if (progressPath.empty())
            {
                return;
            }

            metadata = progressMetadataSnapshot(std::move(metadata), bytesReceived, totalBytes, startedUnix);
            writeDownloadProgressSidecar(progressPath, metadata);
            if (mode == DownloadProgressWriteMode::DurableCheckpoint)
            {
                writeMetadata(progressPath, metadata);
            }
        }

        class WinHttpDownloadHandles final
        {
        public:
            WinHttpDownloadHandles(
                HINTERNET session,
                HINTERNET connection,
                HINTERNET request) noexcept
                : session_(session),
                  connection_(connection),
                  request_(request)
            {
            }

            WinHttpDownloadHandles(const WinHttpDownloadHandles&) = delete;
            WinHttpDownloadHandles& operator=(const WinHttpDownloadHandles&) = delete;

            ~WinHttpDownloadHandles()
            {
                close();
            }

            void close() noexcept
            {
                if (request_ != nullptr)
                {
                    WinHttpCloseHandle(request_);
                    request_ = nullptr;
                }
                if (connection_ != nullptr)
                {
                    WinHttpCloseHandle(connection_);
                    connection_ = nullptr;
                }
                if (session_ != nullptr)
                {
                    WinHttpCloseHandle(session_);
                    session_ = nullptr;
                }
            }

        private:
            HINTERNET session_{};
            HINTERNET connection_{};
            HINTERNET request_{};
        };

        std::filesystem::path winHttpDownloadToFile(
            const std::wstring& url,
            const std::filesystem::path& directory,
            std::wstring_view fallbackFileName,
            const std::filesystem::path& progressPath,
            DownloadMetadata progressMetadata)
        {
            URL_COMPONENTS components{};
            components.dwStructSize = sizeof(components);
            components.dwSchemeLength = static_cast<DWORD>(-1);
            components.dwHostNameLength = static_cast<DWORD>(-1);
            components.dwUrlPathLength = static_cast<DWORD>(-1);
            components.dwExtraInfoLength = static_cast<DWORD>(-1);

            if (!WinHttpCrackUrl(url.c_str(), static_cast<DWORD>(url.size()), 0, &components))
            {
                throw std::runtime_error("Invalid download URL.");
            }

            std::wstring host(components.lpszHostName, components.dwHostNameLength);
            std::wstring path(components.lpszUrlPath, components.dwUrlPathLength);
            path.append(components.lpszExtraInfo, components.dwExtraInfoLength);

            HINTERNET session = WinHttpOpen(
                L"FluxoraModManager/1.0",
                WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                WINHTTP_NO_PROXY_NAME,
                WINHTTP_NO_PROXY_BYPASS,
                0);
            HINTERNET connection = session == nullptr ? nullptr : WinHttpConnect(session, host.c_str(), components.nPort, 0);
            const DWORD flags = components.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
            HINTERNET request = connection == nullptr
                ? nullptr
                : WinHttpOpenRequest(
                    connection,
                    L"GET",
                    path.c_str(),
                    nullptr,
                    WINHTTP_NO_REFERER,
                    WINHTTP_DEFAULT_ACCEPT_TYPES,
                    flags);
            WinHttpDownloadHandles handles(session, connection, request);
            const auto closeHandles = [&]()
            {
                handles.close();
            };

            std::filesystem::create_directories(directory);
            std::filesystem::path existingPartialPath = resumablePartialPath(directory, progressMetadata);
            std::optional<SingleDownloadOutputPathReservation> existingPartialReservation;
            if (!existingPartialPath.empty())
            {
                existingPartialReservation.emplace(
                    reserveExistingDownloadOutputPath(existingPartialPath));
            }
            std::uintmax_t requestedOffset = regularFileSizeOrZero(existingPartialPath);
            std::wstring rangeHeader;
            if (requestedOffset > 0)
            {
                rangeHeader = L"Range: bytes=" + std::to_wstring(requestedOffset) + L"-\r\n";
            }

            LPCWSTR headers = rangeHeader.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : rangeHeader.c_str();
            const DWORD headersLength = rangeHeader.empty() ? 0 : static_cast<DWORD>(-1);
            if (request == nullptr ||
                !WinHttpSendRequest(request, headers, headersLength, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
                !WinHttpReceiveResponse(request, nullptr))
            {
                closeHandles();
                throw std::runtime_error("Download request failed.");
            }

            DWORD statusCode{};
            DWORD statusCodeSize = sizeof(statusCode);
            WinHttpQueryHeaders(
                request,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                WINHTTP_HEADER_NAME_BY_INDEX,
                &statusCode,
                &statusCodeSize,
                WINHTTP_NO_HEADER_INDEX);
            if (statusCode == 416 && requestedOffset > 0)
            {
                closeHandles();
                std::filesystem::remove(existingPartialPath);
                progressMetadata.partialPath.clear();
                progressMetadata.bytesReceived = 0;
                progressMetadata.totalBytes = 0;
                return winHttpDownloadToFile(url, directory, fallbackFileName, progressPath, progressMetadata);
            }

            if (statusCode < 200 || statusCode >= 300)
            {
                closeHandles();
                throw std::runtime_error("Download returned HTTP " + std::to_string(statusCode) + ".");
            }

            const std::wstring contentDisposition = queryCustomHeader(request, L"Content-Disposition");
            const HttpDownloadResponsePlan responsePlan = planHttpDownloadResponse(
                statusCode,
                requestedOffset,
                queryCustomHeader(request, L"Content-Length"),
                queryCustomHeader(request, L"Content-Range"));
            const bool appendToPartial = responsePlan.appendToPartial;
            requestedOffset = responsePlan.initialFileBytes;
            const std::uintmax_t totalBytes = responsePlan.expectedTotalBytes.value_or(
                responsePlan.expectedResponseBytes.has_value()
                    ? requestedOffset + *responsePlan.expectedResponseBytes
                    : progressMetadata.totalBytes);

            std::wstring destinationFileName = resolvedHttpDownloadFileName(
                progressMetadata.destinationFileName,
                contentDisposition,
                fallbackFileName);
            if (destinationFileName.empty())
            {
                destinationFileName = chooseDownloadFileName({}, fallbackFileName);
            }

            // Reserve the actual selected final and partial paths atomically. The
            // reservation remains live through promotion, but its global mutex is
            // held only during selection so unrelated transfers stay concurrent.
            DownloadOutputPathReservation outputPaths = reserveDownloadOutputPaths(
                directory,
                destinationFileName,
                existingPartialPath,
                existingPartialReservation.has_value() ? &*existingPartialReservation : nullptr);
            const std::filesystem::path& destinationPath = outputPaths.destinationPath();
            const std::filesystem::path& partialPath = outputPaths.partialPath();
            progressMetadata.destinationFileName = destinationPath.filename().wstring();
            progressMetadata.partialPath = partialPath;

            const std::ios::openmode openMode = std::ios::out | std::ios::binary | (appendToPartial ? std::ios::app : std::ios::trunc);
            std::ofstream file(partialPath, openMode);
            if (!file)
            {
                closeHandles();
                throw std::runtime_error("Failed to create downloaded file.");
            }

            std::uintmax_t bytesReceived = requestedOffset;
            std::uintmax_t responseBytesReceived = 0;
            const std::uintmax_t startedUnix = currentUnixSeconds();
            auto lastProgressWrite = std::chrono::steady_clock::now() - progressSidecarWriteInterval;
            auto lastDurableProgressCheckpoint = std::chrono::steady_clock::now();
            std::uintmax_t lastDurableProgressBytes = bytesReceived;
            const auto noteDurableProgressCheckpoint = [&](std::chrono::steady_clock::time_point now)
            {
                lastDurableProgressCheckpoint = now;
                lastDurableProgressBytes = bytesReceived;
            };
            const auto shouldWriteDurableProgressCheckpoint = [&](std::chrono::steady_clock::time_point now)
            {
                const bool enoughTimePassed =
                    now - lastDurableProgressCheckpoint >= durableProgressCheckpointInterval;
                const bool enoughBytesPassed =
                    bytesReceived >= lastDurableProgressBytes &&
                    bytesReceived - lastDurableProgressBytes >= durableProgressCheckpointBytes;
                const bool complete =
                    totalBytes > 0 && bytesReceived >= totalBytes;
                return enoughTimePassed || enoughBytesPassed || complete;
            };
            const auto writeProgressUpdate = [&](DownloadProgressWriteMode mode)
            {
                updateDownloadProgress(progressPath, progressMetadata, bytesReceived, totalBytes, startedUnix, mode);
                if (mode == DownloadProgressWriteMode::DurableCheckpoint)
                {
                    noteDurableProgressCheckpoint(std::chrono::steady_clock::now());
                }
            };
            writeProgressUpdate(DownloadProgressWriteMode::DurableCheckpoint);
            lastProgressWrite = std::chrono::steady_clock::now();
            const auto writePausedMetadata = [&]()
            {
                DownloadMetadata pausedMetadata = progressMetadata;
                pausedMetadata.status = L"Отменено";
                pausedMetadata.bytesReceived = bytesReceived;
                pausedMetadata.totalBytes = totalBytes;
                pausedMetadata.downloadStartedUnix = 0;
                pausedMetadata.isDownloading = false;
                writeMetadata(progressPath, pausedMetadata);
                removeDownloadProgressSidecar(progressPath);
            };
            // The cancel marker lives on disk, so each check costs a filesystem
            // stat; throttle the polls instead of paying one per received chunk.
            auto lastCancellationCheck = std::chrono::steady_clock::now();
            const auto throwIfCanceled = [&](bool force = false)
            {
                constexpr auto cancellationPollInterval = std::chrono::milliseconds(200);
                const auto now = std::chrono::steady_clock::now();
                if (!force && now - lastCancellationCheck < cancellationPollInterval)
                {
                    return;
                }
                lastCancellationCheck = now;
                if (isDownloadCancellationRequested(progressPath))
                {
                    file.close();
                    closeHandles();
                    writePausedMetadata();
                    std::filesystem::remove(cancelMarkerPath(progressPath));
                    throw DownloadCanceledException();
                }
            };

            std::vector<char> buffer;
            while (true)
            {
                throwIfCanceled();

                DWORD available{};
                if (!WinHttpQueryDataAvailable(request, &available))
                {
                    writeProgressUpdate(DownloadProgressWriteMode::DurableCheckpoint);
                    file.close();
                    closeHandles();
                    throw std::runtime_error("Failed to read download response.");
                }

                if (available == 0)
                {
                    break;
                }

                if (buffer.size() < available)
                {
                    buffer.resize(available);
                }
                DWORD read{};
                if (!WinHttpReadData(request, buffer.data(), available, &read))
                {
                    writeProgressUpdate(DownloadProgressWriteMode::DurableCheckpoint);
                    file.close();
                    closeHandles();
                    throw std::runtime_error("Failed to read download data.");
                }

                if (read == 0)
                {
                    break;
                }

                file.write(buffer.data(), static_cast<std::streamsize>(read));
                if (!file)
                {
                    writeProgressUpdate(DownloadProgressWriteMode::DurableCheckpoint);
                    file.close();
                    closeHandles();
                    throw std::runtime_error("Failed to write downloaded file.");
                }

                bytesReceived += read;
                responseBytesReceived += read;
                const auto now = std::chrono::steady_clock::now();
                if (now - lastProgressWrite >= progressSidecarWriteInterval ||
                    (totalBytes > 0 && bytesReceived >= totalBytes))
                {
                    const DownloadProgressWriteMode mode = shouldWriteDurableProgressCheckpoint(now)
                        ? DownloadProgressWriteMode::DurableCheckpoint
                        : DownloadProgressWriteMode::VolatileOnly;
                    writeProgressUpdate(mode);
                    lastProgressWrite = now;
                }
            }

            throwIfCanceled(/*force=*/true);
            file.close();
            if (!file)
            {
                writeProgressUpdate(DownloadProgressWriteMode::DurableCheckpoint);
                closeHandles();
                throw std::runtime_error("Failed to finalize downloaded file.");
            }

            writeProgressUpdate(DownloadProgressWriteMode::DurableCheckpoint);
            closeHandles();
            promoteCompletedHttpDownload(
                partialPath,
                destinationPath,
                responsePlan,
                responseBytesReceived,
                bytesReceived);
            std::filesystem::remove(cancelMarkerPath(progressPath));
            return destinationPath;
        }

        class OwnedWinHandle final
        {
        public:
            explicit OwnedWinHandle(HANDLE handle = nullptr) noexcept
                : handle_(handle)
            {
            }

            OwnedWinHandle(const OwnedWinHandle&) = delete;
            OwnedWinHandle& operator=(const OwnedWinHandle&) = delete;

            ~OwnedWinHandle()
            {
                if (handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE)
                {
                    CloseHandle(handle_);
                }
            }

            [[nodiscard]] HANDLE get() const noexcept
            {
                return handle_;
            }

        private:
            HANDLE handle_{nullptr};
        };

        enum class ExternalProcessWaitOutcome
        {
            Exited,
            Canceled,
            TimedOut,
            WaitFailed
        };

        struct ExternalProcessWaitResult
        {
            ExternalProcessWaitOutcome outcome{ExternalProcessWaitOutcome::WaitFailed};
            DWORD exitCode{ERROR_GEN_FAILURE};
            bool terminationAttempted{false};
            bool terminationSucceeded{false};
            bool exitConfirmedAfterTermination{false};
        };

        struct ExternalProcessWaitCallbacks
        {
            std::function<DWORD(DWORD)> waitForExit;
            std::function<bool()> cancellationRequested;
            std::function<bool()> timeoutReached;
            std::function<bool()> terminateOwnedProcess;
            std::function<bool(DWORD&)> queryExitCode;
        };

        ExternalProcessWaitResult terminateAndFinishExternalProcessWait(
            ExternalProcessWaitOutcome outcome,
            const ExternalProcessWaitCallbacks& callbacks,
            DWORD terminationWaitMilliseconds)
        {
            ExternalProcessWaitResult result;
            result.outcome = outcome;
            result.terminationAttempted = true;
            result.terminationSucceeded = callbacks.terminateOwnedProcess();
            result.exitConfirmedAfterTermination =
                callbacks.waitForExit(terminationWaitMilliseconds) == WAIT_OBJECT_0;
            return result;
        }

        ExternalProcessWaitResult waitForOwnedExternalProcess(
            const ExternalProcessWaitCallbacks& callbacks,
            DWORD pollMilliseconds,
            DWORD terminationWaitMilliseconds)
        {
            for (;;)
            {
                if (callbacks.cancellationRequested())
                {
                    return terminateAndFinishExternalProcessWait(
                        ExternalProcessWaitOutcome::Canceled,
                        callbacks,
                        terminationWaitMilliseconds);
                }
                if (callbacks.timeoutReached())
                {
                    return terminateAndFinishExternalProcessWait(
                        ExternalProcessWaitOutcome::TimedOut,
                        callbacks,
                        terminationWaitMilliseconds);
                }

                const DWORD waitResult = callbacks.waitForExit(pollMilliseconds);
                if (waitResult == WAIT_OBJECT_0)
                {
                    ExternalProcessWaitResult result;
                    result.outcome = ExternalProcessWaitOutcome::Exited;
                    if (!callbacks.queryExitCode(result.exitCode))
                    {
                        result.outcome = ExternalProcessWaitOutcome::WaitFailed;
                    }
                    return result;
                }
                if (waitResult != WAIT_TIMEOUT)
                {
                    return terminateAndFinishExternalProcessWait(
                        ExternalProcessWaitOutcome::WaitFailed,
                        callbacks,
                        terminationWaitMilliseconds);
                }
            }
        }

        std::filesystem::path operationCancellationDirectoryForDownloadService()
        {
            if (const std::wstring configured = readEnvironmentVariable(L"FLUXORA_OPERATION_CANCEL_DIR");
                !configured.empty())
            {
                return std::filesystem::path(configured);
            }
            if (const std::wstring logs = readEnvironmentVariable(L"FLUXORA_LOG_DIR"); !logs.empty())
            {
                return std::filesystem::path(logs) / L"operation-cancel";
            }
            return {};
        }

        std::filesystem::path operationCancellationMarkerPathForDownloadService(
            std::string_view operationId)
        {
            const std::filesystem::path directory = operationCancellationDirectoryForDownloadService();
            if (directory.empty() || operationId.empty())
            {
                return {};
            }

            std::string safeOperationId;
            safeOperationId.reserve(operationId.size() + 7);
            for (const char character : operationId)
            {
                const unsigned char value = static_cast<unsigned char>(character);
                safeOperationId.push_back(
                    std::isalnum(value) != 0 || character == '_' || character == '-' || character == '.'
                        ? character
                        : '_');
            }
            if (safeOperationId.empty())
            {
                return {};
            }

            safeOperationId += ".cancel";
            return directory / std::filesystem::path(safeOperationId);
        }

        bool operationCancellationMarkerExists(const std::filesystem::path& markerPath)
        {
            if (markerPath.empty())
            {
                return false;
            }

            std::error_code error;
            return std::filesystem::exists(markerPath, error);
        }

        bool runHiddenAndWait(
            std::wstring commandLine,
            const std::filesystem::path& archivePath,
            std::wstring_view extractorName,
            const std::filesystem::path& cancellationMarker,
            const Logger& logger)
        {
            if (operationCancellationMarkerExists(cancellationMarker))
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "ArchiveExtraction",
                    "Archive extraction canceled before external extractor launch. extractor=\"" +
                        toUtf8(std::wstring(extractorName)) +
                        "\", archive=\"" + toUtf8(archivePath.wstring()) + "\".");
                throw ArchiveExtractionCanceledException();
            }

            STARTUPINFOW startupInfo{};
            startupInfo.cb = sizeof(startupInfo);
            startupInfo.dwFlags = STARTF_USESHOWWINDOW;
            startupInfo.wShowWindow = SW_HIDE;

            PROCESS_INFORMATION processInfo{};
            std::vector<wchar_t> buffer(commandLine.begin(), commandLine.end());
            buffer.push_back(L'\0');

            if (!CreateProcessW(
                    nullptr,
                    buffer.data(),
                    nullptr,
                    nullptr,
                    FALSE,
                    CREATE_NO_WINDOW,
                    nullptr,
                    nullptr,
                    &startupInfo,
                    &processInfo))
            {
                const DWORD error = GetLastError();
                logger.writeOperation(
                    LogLevel::Warning,
                    "ArchiveExtraction",
                    "External archive extractor failed to launch. extractor=\"" +
                        toUtf8(std::wstring(extractorName)) +
                        "\", win32Error=" + std::to_string(error) +
                        ", archive=\"" + toUtf8(archivePath.wstring()) + "\".");
                return false;
            }

            const OwnedWinHandle threadHandle(processInfo.hThread);
            const OwnedWinHandle processHandle(processInfo.hProcess);
            const auto deadline = std::chrono::steady_clock::now() + externalProcessTimeout;
            DWORD waitError = ERROR_SUCCESS;
            DWORD exitCodeError = ERROR_SUCCESS;
            const ExternalProcessWaitCallbacks callbacks{
                [&](DWORD milliseconds)
                {
                    const DWORD result = WaitForSingleObject(processHandle.get(), milliseconds);
                    if (result == WAIT_FAILED)
                    {
                        waitError = GetLastError();
                    }
                    return result;
                },
                [&]()
                {
                    return operationCancellationMarkerExists(cancellationMarker);
                },
                [&]()
                {
                    return std::chrono::steady_clock::now() >= deadline;
                },
                [&]()
                {
                    return TerminateProcess(processHandle.get(), ERROR_CANCELLED) != FALSE;
                },
                [&](DWORD& exitCode)
                {
                    if (GetExitCodeProcess(processHandle.get(), &exitCode) != FALSE)
                    {
                        return true;
                    }
                    exitCodeError = GetLastError();
                    return false;
                }};

            const ExternalProcessWaitResult result = waitForOwnedExternalProcess(
                callbacks,
                static_cast<DWORD>(externalProcessPollInterval.count()),
                static_cast<DWORD>(std::chrono::duration_cast<std::chrono::milliseconds>(
                    externalProcessTerminationWait).count()));
            const std::string processDetails =
                " extractor=\"" + toUtf8(std::wstring(extractorName)) +
                "\", pid=" + std::to_string(processInfo.dwProcessId) +
                ", archive=\"" + toUtf8(archivePath.wstring()) + "\"";

            if (result.outcome == ExternalProcessWaitOutcome::Canceled)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "ArchiveExtraction",
                    "External archive extraction canceled; owned child termination attempted." +
                        processDetails +
                        ", terminationSucceeded=" + std::to_string(result.terminationSucceeded ? 1 : 0) +
                        ", exitConfirmed=" +
                        std::to_string(result.exitConfirmedAfterTermination ? 1 : 0) + ".");
                throw ArchiveExtractionCanceledException();
            }
            if (result.outcome == ExternalProcessWaitOutcome::TimedOut)
            {
                logger.writeOperation(
                    LogLevel::Error,
                    "ArchiveExtraction",
                    "External archive extraction timed out; owned child termination attempted." +
                        processDetails +
                        ", timeoutSeconds=" +
                        std::to_string(std::chrono::duration_cast<std::chrono::seconds>(
                            externalProcessTimeout).count()) +
                        ", terminationSucceeded=" + std::to_string(result.terminationSucceeded ? 1 : 0) +
                        ", exitConfirmed=" +
                        std::to_string(result.exitConfirmedAfterTermination ? 1 : 0) + ".");
                throw std::runtime_error("Archive extraction timed out after two hours.");
            }
            if (result.outcome == ExternalProcessWaitOutcome::WaitFailed)
            {
                logger.writeOperation(
                    LogLevel::Error,
                    "ArchiveExtraction",
                    "External archive extractor wait failed; owned child cleanup state recorded." +
                        processDetails +
                        ", waitError=" + std::to_string(waitError) +
                        ", exitCodeError=" + std::to_string(exitCodeError) +
                        ", terminationAttempted=" + std::to_string(result.terminationAttempted ? 1 : 0) +
                        ", terminationSucceeded=" + std::to_string(result.terminationSucceeded ? 1 : 0) +
                        ", exitConfirmed=" +
                        std::to_string(result.exitConfirmedAfterTermination ? 1 : 0) + ".");
                throw std::runtime_error("Failed while waiting for archive extraction to finish.");
            }

            if (result.exitCode != ERROR_SUCCESS)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "ArchiveExtraction",
                    "External archive extractor returned a failure exit code." +
                        processDetails + ", exitCode=" + std::to_string(result.exitCode) + ".");
                return false;
            }
            return true;
        }
#endif

        std::wstring archiveExtensionFromSignature(const std::filesystem::path& path)
        {
            std::ifstream file(path, std::ios::in | std::ios::binary);
            if (!file)
            {
                return {};
            }

            std::array<unsigned char, 265> header{};
            file.read(reinterpret_cast<char*>(header.data()), static_cast<std::streamsize>(header.size()));
            const std::streamsize read = file.gcount();

            if (read >= 4 &&
                header[0] == 0x50 &&
                header[1] == 0x4B &&
                ((header[2] == 0x03 && header[3] == 0x04) ||
                 (header[2] == 0x05 && header[3] == 0x06) ||
                 (header[2] == 0x07 && header[3] == 0x08)))
            {
                return L".zip";
            }

            if (read >= 6 &&
                header[0] == 0x37 &&
                header[1] == 0x7A &&
                header[2] == 0xBC &&
                header[3] == 0xAF &&
                header[4] == 0x27 &&
                header[5] == 0x1C)
            {
                return L".7z";
            }

            if (read >= 7 &&
                header[0] == 0x52 &&
                header[1] == 0x61 &&
                header[2] == 0x72 &&
                header[3] == 0x21 &&
                header[4] == 0x1A &&
                header[5] == 0x07 &&
                (header[6] == 0x00 || header[6] == 0x01))
            {
                return L".rar";
            }

            if (read >= 2 && header[0] == 0x1F && header[1] == 0x8B)
            {
                return L".gz";
            }

            if (read >= 3 && header[0] == 0x42 && header[1] == 0x5A && header[2] == 0x68)
            {
                return L".bz2";
            }

            if (read >= 6 &&
                header[0] == 0xFD &&
                header[1] == 0x37 &&
                header[2] == 0x7A &&
                header[3] == 0x58 &&
                header[4] == 0x5A &&
                header[5] == 0x00)
            {
                return L".xz";
            }

            if (read >= 4 &&
                header[0] == 0x28 &&
                header[1] == 0xB5 &&
                header[2] == 0x2F &&
                header[3] == 0xFD)
            {
                return L".zst";
            }

            if (read >= 265 &&
                header[257] == 0x75 &&
                header[258] == 0x73 &&
                header[259] == 0x74 &&
                header[260] == 0x61 &&
                header[261] == 0x72)
            {
                return L".tar";
            }

            return {};
        }

        std::wstring archiveExtension(const std::filesystem::path& path)
        {
            const std::wstring signatureExtension = archiveExtensionFromSignature(path);
            if (!signatureExtension.empty())
            {
                return signatureExtension;
            }

            return archiveExtensionFromFileName(path.filename().wstring());
        }

        bool isExtractableArchive(const std::filesystem::path& path)
        {
            return isSupportedArchiveExtension(archiveExtension(path));
        }

        std::uint16_t readLittleEndian16(const std::vector<unsigned char>& bytes, std::size_t offset)
        {
            if (offset + 2 > bytes.size())
            {
                throw std::runtime_error("Archive metadata is truncated.");
            }

            return static_cast<std::uint16_t>(
                static_cast<std::uint16_t>(bytes[offset]) |
                (static_cast<std::uint16_t>(bytes[offset + 1]) << 8));
        }

        std::uint32_t readLittleEndian32(const std::vector<unsigned char>& bytes, std::size_t offset)
        {
            if (offset + 4 > bytes.size())
            {
                throw std::runtime_error("Archive metadata is truncated.");
            }

            return static_cast<std::uint32_t>(
                static_cast<std::uint32_t>(bytes[offset]) |
                (static_cast<std::uint32_t>(bytes[offset + 1]) << 8) |
                (static_cast<std::uint32_t>(bytes[offset + 2]) << 16) |
                (static_cast<std::uint32_t>(bytes[offset + 3]) << 24));
        }

        std::uint64_t readLittleEndian64(const std::vector<unsigned char>& bytes, std::size_t offset)
        {
            if (offset + 8 > bytes.size())
            {
                throw std::runtime_error("Archive metadata is truncated.");
            }

            return static_cast<std::uint64_t>(readLittleEndian32(bytes, offset)) |
                (static_cast<std::uint64_t>(readLittleEndian32(bytes, offset + 4)) << 32);
        }

        std::uint64_t binaryFileSize(const std::filesystem::path& path)
        {
            std::error_code error;
            const std::uintmax_t size = std::filesystem::file_size(path, error);
            if (error)
            {
                throw std::runtime_error("Failed to read archive size.");
            }

            return static_cast<std::uint64_t>(size);
        }

        std::vector<unsigned char> readBinaryFileRange(
            const std::filesystem::path& path,
            std::uint64_t offset,
            std::uint64_t size)
        {
            std::ifstream file(path, std::ios::in | std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Failed to open archive.");
            }

            if (offset > static_cast<std::uint64_t>((std::numeric_limits<std::streamoff>::max)()) ||
                size > static_cast<std::uint64_t>((std::numeric_limits<std::streamsize>::max)()))
            {
                throw std::runtime_error("Archive metadata is too large.");
            }

            file.seekg(static_cast<std::streamoff>(offset), std::ios::beg);
            if (!file)
            {
                throw std::runtime_error("Failed to seek archive metadata.");
            }

            std::vector<unsigned char> bytes(static_cast<std::size_t>(size));
            if (!bytes.empty())
            {
                file.read(
                    reinterpret_cast<char*>(bytes.data()),
                    static_cast<std::streamsize>(bytes.size()));
                if (file.gcount() != static_cast<std::streamsize>(bytes.size()))
                {
                    throw std::runtime_error("Archive metadata is truncated.");
                }
            }

            return bytes;
        }

        std::wstring zipEntryNameFromBytes(
            const std::vector<unsigned char>& bytes,
            std::size_t offset,
            std::uint16_t length,
            bool isUtf8)
        {
            if (offset + length > bytes.size())
            {
                throw std::runtime_error("Archive entry metadata is truncated.");
            }

            std::string name(
                reinterpret_cast<const char*>(bytes.data() + offset),
                reinterpret_cast<const char*>(bytes.data() + offset + length));

            if (isUtf8)
            {
                try
                {
                    return fromUtf8(name);
                }
                catch (const std::exception&)
                {
                    throw std::runtime_error("Archive contains a file name that is not valid UTF-8.");
                }
            }

            return std::wstring(name.begin(), name.end());
        }

        bool isDirectoryArchiveEntry(std::wstring_view path)
        {
            return !path.empty() && (path.back() == L'/' || path.back() == L'\\');
        }

        std::filesystem::path validateSafeArchiveEntryPath(
            std::wstring entryPath,
            bool isDirectory,
            std::set<std::wstring>& seenEntryKeys)
        {
            std::replace(entryPath.begin(), entryPath.end(), L'\\', L'/');
            if (isDirectory)
            {
                while (!entryPath.empty() && entryPath.back() == L'/')
                {
                    entryPath.pop_back();
                }
            }

            const std::filesystem::path path(entryPath);
            const PathSafetyService safety;
            const PathSafetyResult validation = safety.validateArchiveEntryPath(path, isDirectory);
            if (!validation.safe())
            {
                throw std::runtime_error("Archive contains an unsafe file path.");
            }

            const std::wstring key = safety.archiveEntryComparisonKey(validation.normalizedRelativePath);

            if (!isDirectory && !seenEntryKeys.insert(key).second)
            {
                throw std::runtime_error("Archive contains duplicate file paths that differ only by case.");
            }

            return validation.normalizedRelativePath;
        }

        std::size_t findZipEndOfCentralDirectory(const std::vector<unsigned char>& bytes)
        {
            if (bytes.size() < 22)
            {
                throw std::runtime_error("ZIP archive metadata is truncated.");
            }

            const std::size_t searchStart = bytes.size() > 65557 ? bytes.size() - 65557 : 0;
            for (std::size_t offset = bytes.size() - 22;; --offset)
            {
                if (readLittleEndian32(bytes, offset) == 0x06054B50)
                {
                    return offset;
                }

                if (offset == searchStart)
                {
                    break;
                }
            }

            throw std::runtime_error("ZIP archive metadata was not found.");
        }

        struct ZipCentralDirectoryLocation
        {
            std::uint64_t offset{0};
            std::uint64_t size{0};
            std::uint64_t entryCount{0};
        };

        ZipCentralDirectoryLocation zipCentralDirectoryLocation(
            const std::filesystem::path& archivePath,
            const std::vector<unsigned char>& eocdBytes,
            std::size_t eocd,
            std::uint64_t absoluteEocd)
        {
            ZipCentralDirectoryLocation location{
                readLittleEndian32(eocdBytes, eocd + 16),
                readLittleEndian32(eocdBytes, eocd + 12),
                readLittleEndian16(eocdBytes, eocd + 10)
            };

            const bool needsZip64 =
                location.entryCount == 0xFFFF ||
                location.size == 0xFFFFFFFF ||
                location.offset == 0xFFFFFFFF;
            if (!needsZip64)
            {
                return location;
            }

            if (absoluteEocd < 20)
            {
                throw std::runtime_error("ZIP64 archive locator was not found.");
            }

            const std::vector<unsigned char> locator =
                readBinaryFileRange(archivePath, absoluteEocd - 20, 20);
            if (readLittleEndian32(locator, 0) != 0x07064B50)
            {
                throw std::runtime_error("ZIP64 archive locator was not found.");
            }

            const std::uint64_t zip64EocdOffset = readLittleEndian64(locator, 8);
            const std::vector<unsigned char> zip64Eocd =
                readBinaryFileRange(archivePath, zip64EocdOffset, 56);
            if (zip64Eocd.size() < 56)
            {
                throw std::runtime_error("ZIP64 archive metadata is invalid.");
            }

            if (readLittleEndian32(zip64Eocd, 0) != 0x06064B50)
            {
                throw std::runtime_error("ZIP64 archive metadata is invalid.");
            }

            location.entryCount = readLittleEndian64(zip64Eocd, 32);
            location.size = readLittleEndian64(zip64Eocd, 40);
            location.offset = readLittleEndian64(zip64Eocd, 48);
            return location;
        }

        struct ZipArchiveEntry
        {
            std::wstring name;
            std::filesystem::path relativePath;
            std::wstring comparisonKey;
            std::uint16_t flags{0};
            std::uint16_t compressionMethod{0};
            std::uint32_t crc{0};
            std::uint64_t compressedSize{0};
            std::uint64_t uncompressedSize{0};
            std::uint64_t localHeaderOffset{0};
            bool isDirectory{false};
        };

        void readZip64CentralDirectoryValues(
            const std::vector<unsigned char>& centralDirectory,
            std::size_t extraOffset,
            std::uint16_t extraLength,
            std::uint64_t& uncompressedSize,
            std::uint64_t& compressedSize,
            std::uint64_t& localHeaderOffset)
        {
            const std::size_t extraEnd = extraOffset + extraLength;
            if (extraEnd > centralDirectory.size())
            {
                throw std::runtime_error("ZIP archive central directory is invalid.");
            }

            std::size_t cursor = extraOffset;
            while (cursor + 4 <= extraEnd)
            {
                const std::uint16_t fieldId = readLittleEndian16(centralDirectory, cursor);
                const std::uint16_t fieldSize = readLittleEndian16(centralDirectory, cursor + 2);
                cursor += 4;
                if (cursor + fieldSize > extraEnd)
                {
                    throw std::runtime_error("ZIP archive central directory is invalid.");
                }

                if (fieldId == 0x0001)
                {
                    std::size_t valueOffset = cursor;
                    const std::size_t valueEnd = cursor + fieldSize;
                    const auto readRequiredValue = [&]()
                    {
                        if (valueOffset + 8 > valueEnd)
                        {
                            throw std::runtime_error("ZIP64 archive entry metadata is invalid.");
                        }
                        const std::uint64_t value =
                            readLittleEndian64(centralDirectory, valueOffset);
                        valueOffset += 8;
                        return value;
                    };

                    if (uncompressedSize == 0xFFFFFFFFULL)
                    {
                        uncompressedSize = readRequiredValue();
                    }
                    if (compressedSize == 0xFFFFFFFFULL)
                    {
                        compressedSize = readRequiredValue();
                    }
                    if (localHeaderOffset == 0xFFFFFFFFULL)
                    {
                        localHeaderOffset = readRequiredValue();
                    }
                    return;
                }

                cursor += fieldSize;
            }

            if (uncompressedSize == 0xFFFFFFFFULL ||
                compressedSize == 0xFFFFFFFFULL ||
                localHeaderOffset == 0xFFFFFFFFULL)
            {
                throw std::runtime_error("ZIP64 archive entry metadata was not found.");
            }
        }

        std::vector<ZipArchiveEntry> indexZipArchive(
            const std::filesystem::path& archivePath)
        {
            constexpr std::uint64_t maxEocdSearchBytes = 65557;
            const std::uint64_t archiveSize = binaryFileSize(archivePath);
            const std::uint64_t tailSize = (std::min)(archiveSize, maxEocdSearchBytes);
            const std::uint64_t tailOffset = archiveSize - tailSize;
            const std::vector<unsigned char> tail =
                readBinaryFileRange(archivePath, tailOffset, tailSize);
            const std::size_t eocd = findZipEndOfCentralDirectory(tail);
            const std::uint64_t absoluteEocd = tailOffset + static_cast<std::uint64_t>(eocd);
            const ZipCentralDirectoryLocation location =
                zipCentralDirectoryLocation(archivePath, tail, eocd, absoluteEocd);

            if (location.offset > archiveSize || location.size > archiveSize - location.offset)
            {
                throw std::runtime_error("ZIP archive central directory is invalid.");
            }

            if (location.size > static_cast<std::uint64_t>((std::numeric_limits<std::size_t>::max)()))
            {
                throw std::runtime_error("ZIP archive central directory is invalid.");
            }

            const std::vector<unsigned char> centralDirectory =
                readBinaryFileRange(archivePath, location.offset, location.size);
            const std::size_t centralEnd = centralDirectory.size();

            std::set<std::wstring> seenEntryKeys;
            const PathSafetyService safety;
            std::vector<ZipArchiveEntry> entries;
            if (location.entryCount <=
                static_cast<std::uint64_t>((std::numeric_limits<std::size_t>::max)()))
            {
                entries.reserve(static_cast<std::size_t>(location.entryCount));
            }
            std::size_t offset = 0;
            for (std::uint64_t index = 0; index < location.entryCount; ++index)
            {
                if (offset + 46 > centralEnd || readLittleEndian32(centralDirectory, offset) != 0x02014B50)
                {
                    throw std::runtime_error("ZIP archive central directory is invalid.");
                }

                const std::uint16_t flags = readLittleEndian16(centralDirectory, offset + 8);
                const std::uint16_t compressionMethod =
                    readLittleEndian16(centralDirectory, offset + 10);
                const std::uint32_t crc = readLittleEndian32(centralDirectory, offset + 16);
                std::uint64_t compressedSize =
                    readLittleEndian32(centralDirectory, offset + 20);
                std::uint64_t uncompressedSize =
                    readLittleEndian32(centralDirectory, offset + 24);
                const std::uint16_t nameLength = readLittleEndian16(centralDirectory, offset + 28);
                const std::uint16_t extraLength = readLittleEndian16(centralDirectory, offset + 30);
                const std::uint16_t commentLength = readLittleEndian16(centralDirectory, offset + 32);
                std::uint64_t localHeaderOffset =
                    readLittleEndian32(centralDirectory, offset + 42);
                const std::size_t nameOffset = offset + 46;
                const std::size_t nextOffset = nameOffset + nameLength + extraLength + commentLength;
                if (nextOffset > centralEnd)
                {
                    throw std::runtime_error("ZIP archive central directory is invalid.");
                }

                const std::wstring entryName = zipEntryNameFromBytes(
                    centralDirectory,
                    nameOffset,
                    nameLength,
                    (flags & 0x0800) != 0);
                const bool isDirectory = isDirectoryArchiveEntry(entryName);
                const std::filesystem::path relativePath = validateSafeArchiveEntryPath(
                    entryName,
                    isDirectory,
                    seenEntryKeys);
                readZip64CentralDirectoryValues(
                    centralDirectory,
                    nameOffset + nameLength,
                    extraLength,
                    uncompressedSize,
                    compressedSize,
                    localHeaderOffset);
                if (localHeaderOffset > archiveSize || compressedSize > archiveSize)
                {
                    throw std::runtime_error("ZIP archive entry metadata is invalid.");
                }

                entries.push_back(ZipArchiveEntry{
                    entryName,
                    relativePath,
                    safety.archiveEntryComparisonKey(relativePath),
                    flags,
                    compressionMethod,
                    crc,
                    compressedSize,
                    uncompressedSize,
                    localHeaderOffset,
                    isDirectory
                });

                offset = nextOffset;
            }

            return entries;
        }

        void validateZipArchiveEntryPaths(const std::filesystem::path& archivePath)
        {
            (void)indexZipArchive(archivePath);
        }

        void validateArchiveEntryPaths(const std::filesystem::path& archivePath)
        {
            if (archiveExtension(archivePath) == L".zip")
            {
                validateZipArchiveEntryPaths(archivePath);
            }
        }

        [[nodiscard]] std::wstring normalizedZipPathText(
            const std::filesystem::path& path)
        {
            std::wstring text = path.generic_wstring();
            std::replace(text.begin(), text.end(), L'\\', L'/');
            while (text.rfind(L"./", 0) == 0)
            {
                text.erase(0, 2);
            }
            return text;
        }

        [[nodiscard]] std::wstring zipPathKey(const std::filesystem::path& path)
        {
            return toLower(normalizedZipPathText(path));
        }

        struct IndexedFomodZip
        {
            std::size_t configIndex{0};
            std::optional<std::size_t> infoIndex;
            std::wstring wrapperPrefix;
            std::wstring wrapperPrefixKey;
            std::map<std::wstring, std::size_t> entryIndexByKey;
        };

        [[nodiscard]] std::optional<IndexedFomodZip> findIndexedFomodZip(
            const std::vector<ZipArchiveEntry>& entries)
        {
            constexpr std::wstring_view configSuffix = L"fomod/moduleconfig.xml";
            std::optional<std::size_t> configIndex;
            std::wstring selectedPath;
            std::map<std::wstring, std::size_t> entryIndexByKey;
            for (std::size_t index = 0; index < entries.size(); ++index)
            {
                const ZipArchiveEntry& entry = entries[index];
                if (entry.isDirectory)
                {
                    continue;
                }

                const std::wstring key = zipPathKey(entry.relativePath);
                entryIndexByKey.emplace(key, index);
                if (key.size() < configSuffix.size() ||
                    key.compare(key.size() - configSuffix.size(), configSuffix.size(), configSuffix) != 0)
                {
                    continue;
                }
                if (key.size() > configSuffix.size() &&
                    key[key.size() - configSuffix.size() - 1] != L'/')
                {
                    continue;
                }

                const std::wstring path = normalizedZipPathText(entry.relativePath);
                if (!configIndex.has_value() || path.size() < selectedPath.size())
                {
                    configIndex = index;
                    selectedPath = path;
                }
            }

            if (!configIndex.has_value())
            {
                return std::nullopt;
            }

            const std::wstring selectedKey = zipPathKey(entries[configIndex.value()].relativePath);
            const std::size_t suffixOffset = selectedKey.size() - configSuffix.size();
            const std::wstring wrapperPrefix = selectedPath.substr(0, suffixOffset);
            const std::wstring wrapperPrefixKey = selectedKey.substr(0, suffixOffset);
            const std::wstring infoKey = wrapperPrefixKey + L"fomod/info.xml";
            std::optional<std::size_t> infoIndex;
            if (const auto found = entryIndexByKey.find(infoKey); found != entryIndexByKey.end())
            {
                infoIndex = found->second;
            }

            return IndexedFomodZip{
                configIndex.value(),
                infoIndex,
                wrapperPrefix,
                wrapperPrefixKey,
                std::move(entryIndexByKey)
            };
        }

        [[nodiscard]] bool zipEntrySupportsSelectiveExtraction(
            const ZipArchiveEntry& entry,
            std::uint64_t maximumUncompressedBytes)
        {
            return !entry.isDirectory &&
                (entry.flags & 0x0001) == 0 &&
                (entry.compressionMethod == 0 || entry.compressionMethod == 8) &&
                entry.uncompressedSize <= maximumUncompressedBytes &&
                entry.compressedSize <=
                    static_cast<std::uint64_t>((std::numeric_limits<std::size_t>::max)()) &&
                entry.uncompressedSize <=
                    static_cast<std::uint64_t>((std::numeric_limits<std::size_t>::max)()) &&
                entry.compressedSize <=
                    static_cast<std::uint64_t>((std::numeric_limits<uInt>::max)()) &&
                entry.uncompressedSize <=
                    static_cast<std::uint64_t>((std::numeric_limits<uInt>::max)());
        }

        [[nodiscard]] std::uint32_t crc32Bytes(const std::vector<unsigned char>& bytes)
        {
            uLong checksum = ::crc32(0L, Z_NULL, 0);
            std::size_t offset = 0;
            while (offset < bytes.size())
            {
                const std::size_t remaining = bytes.size() - offset;
                const uInt chunkSize = static_cast<uInt>((std::min)(
                    remaining,
                    static_cast<std::size_t>((std::numeric_limits<uInt>::max)())));
                checksum = ::crc32(checksum, bytes.data() + offset, chunkSize);
                offset += chunkSize;
            }
            return static_cast<std::uint32_t>(checksum);
        }

        void extractZipEntrySelectively(
            const std::filesystem::path& archivePath,
            const ZipArchiveEntry& entry,
            const std::filesystem::path& destinationRoot,
            const std::filesystem::path& destinationRelativePath)
        {
            const std::vector<unsigned char> localHeader =
                readBinaryFileRange(archivePath, entry.localHeaderOffset, 30);
            if (readLittleEndian32(localHeader, 0) != 0x04034B50)
            {
                throw std::runtime_error("ZIP archive local entry header is invalid.");
            }

            const std::uint16_t localFlags = readLittleEndian16(localHeader, 6);
            const std::uint16_t localCompressionMethod = readLittleEndian16(localHeader, 8);
            if ((localFlags & 0x0001) != 0 || localCompressionMethod != entry.compressionMethod)
            {
                throw std::runtime_error("ZIP archive local entry metadata is inconsistent.");
            }

            const std::uint16_t localNameLength = readLittleEndian16(localHeader, 26);
            const std::uint16_t localExtraLength = readLittleEndian16(localHeader, 28);
            const std::uint64_t dataOffset = entry.localHeaderOffset + 30ULL +
                static_cast<std::uint64_t>(localNameLength) +
                static_cast<std::uint64_t>(localExtraLength);
            const std::uint64_t archiveSize = binaryFileSize(archivePath);
            if (dataOffset > archiveSize || entry.compressedSize > archiveSize - dataOffset)
            {
                throw std::runtime_error("ZIP archive entry data is truncated.");
            }

            const std::vector<unsigned char> compressed =
                readBinaryFileRange(archivePath, dataOffset, entry.compressedSize);
            std::vector<unsigned char> uncompressed;
            if (entry.compressionMethod == 0)
            {
                if (entry.compressedSize != entry.uncompressedSize)
                {
                    throw std::runtime_error("Stored ZIP archive entry has inconsistent sizes.");
                }
                uncompressed = compressed;
            }
            else
            {
                const std::size_t expectedSize =
                    static_cast<std::size_t>(entry.uncompressedSize);
                uncompressed.resize((std::max)(expectedSize, std::size_t{1}));
                z_stream stream{};
                stream.next_in = const_cast<Bytef*>(compressed.data());
                stream.avail_in = static_cast<uInt>(compressed.size());
                stream.next_out = uncompressed.data();
                stream.avail_out = static_cast<uInt>(uncompressed.size());
                if (inflateInit2(&stream, -MAX_WBITS) != Z_OK)
                {
                    throw std::runtime_error("Failed to initialize ZIP decompression.");
                }
                const int result = inflate(&stream, Z_FINISH);
                const std::uint64_t produced = stream.total_out;
                inflateEnd(&stream);
                if (result != Z_STREAM_END || produced != entry.uncompressedSize)
                {
                    throw std::runtime_error("ZIP archive entry decompression failed.");
                }
                uncompressed.resize(expectedSize);
            }

            if (crc32Bytes(uncompressed) != entry.crc)
            {
                throw std::runtime_error("ZIP archive entry checksum is invalid.");
            }

            const PathSafetyService safety;
            const PathSafetyResult relativeValidation =
                safety.validateArchiveEntryPath(destinationRelativePath, false);
            relativeValidation.throwIfUnsafe("FOMOD metadata path is unsafe");
            const std::filesystem::path target =
                destinationRoot / relativeValidation.normalizedRelativePath;
            std::filesystem::create_directories(target.parent_path());
            safety.validateWritePath(
                destinationRoot,
                target,
                PathSafetyWriteOptions{entry.uncompressedSize, false})
                .throwIfUnsafe("FOMOD metadata destination is unsafe");
            std::ofstream file(target, std::ios::out | std::ios::binary | std::ios::trunc);
            if (!file)
            {
                throw std::runtime_error("Failed to create extracted FOMOD metadata file.");
            }
            if (!uncompressed.empty())
            {
                file.write(
                    reinterpret_cast<const char*>(uncompressed.data()),
                    static_cast<std::streamsize>(uncompressed.size()));
            }
            if (!file)
            {
                throw std::runtime_error("Failed to write extracted FOMOD metadata file.");
            }
        }

        [[nodiscard]] std::optional<std::size_t> indexedFomodImageEntry(
            const IndexedFomodZip& fomod,
            std::wstring_view imagePath)
        {
            const std::optional<std::filesystem::path> safePath =
                trySafeFomodPreviewRelativePath(imagePath);
            if (!safePath.has_value())
            {
                return std::nullopt;
            }

            const std::wstring referenceKey = zipPathKey(safePath.value());
            const std::array candidates{
                fomod.wrapperPrefixKey + referenceKey,
                fomod.wrapperPrefixKey + L"fomod/" + referenceKey
            };
            for (const std::wstring& candidate : candidates)
            {
                if (const auto found = fomod.entryIndexByKey.find(candidate);
                    found != fomod.entryIndexByKey.end())
                {
                    return found->second;
                }
            }
            return std::nullopt;
        }

        void clearDirectoryContents(const std::filesystem::path& directory)
        {
            std::error_code iteratorError;
            for (const auto& entry : std::filesystem::directory_iterator(directory, iteratorError))
            {
                std::error_code removeError;
                std::filesystem::remove_all(entry.path(), removeError);
                if (removeError)
                {
                    throw std::runtime_error("Failed to clear FOMOD metadata staging directory.");
                }
            }
            if (iteratorError)
            {
                throw std::runtime_error("Failed to inspect FOMOD metadata staging directory.");
            }
        }

        [[nodiscard]] bool materializeIndexedFomodMetadata(
            const std::filesystem::path& archivePath,
            const std::vector<ZipArchiveEntry>& entries,
            const IndexedFomodZip& fomod,
            const std::filesystem::path& destinationDirectory,
            const std::function<FomodInstallerDescriptor(const std::filesystem::path&)>& analyzeDescriptor,
            std::size_t& uniquePreviewCount,
            std::optional<FomodInstallerDescriptor>& parsedDescriptor,
            std::chrono::milliseconds& xmlDuration)
        {
            constexpr std::uint64_t maximumXmlBytes = 16ULL * 1024ULL * 1024ULL;
            constexpr std::uint64_t maximumPreviewBytes = 128ULL * 1024ULL * 1024ULL;
            constexpr std::uint64_t maximumTotalPreviewBytes = 512ULL * 1024ULL * 1024ULL;
            const ZipArchiveEntry& config = entries[fomod.configIndex];
            if (!zipEntrySupportsSelectiveExtraction(config, maximumXmlBytes) ||
                (fomod.infoIndex.has_value() &&
                 !zipEntrySupportsSelectiveExtraction(entries[fomod.infoIndex.value()], maximumXmlBytes)))
            {
                return false;
            }

            extractZipEntrySelectively(
                archivePath,
                config,
                destinationDirectory,
                std::filesystem::path(L"fomod") / L"ModuleConfig.xml");
            if (fomod.infoIndex.has_value())
            {
                extractZipEntrySelectively(
                    archivePath,
                    entries[fomod.infoIndex.value()],
                    destinationDirectory,
                    std::filesystem::path(L"fomod") / L"info.xml");
            }

            const auto xmlStartedAt = std::chrono::steady_clock::now();
            FomodInstallerDescriptor descriptor = analyzeDescriptor(destinationDirectory);
            xmlDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - xmlStartedAt);
            if (!descriptor.isFomod)
            {
                throw std::runtime_error("Indexed FOMOD metadata could not be parsed.");
            }

            // Materialize only plugin files explicitly referenced by FOMOD
            // options. The C++ analyzer reads their TES4 headers and never
            // scans unrelated archive contents.
            std::map<std::size_t, std::filesystem::path> pluginEntries;
            const auto isPlugin = [](const std::filesystem::path& path)
            {
                const std::wstring extension = toLower(path.extension().wstring());
                return extension == L".esm" || extension == L".esp" || extension == L".esl";
            };
            const auto rememberPluginEntry = [&](std::size_t index)
            {
                if (index >= entries.size() || entries[index].isDirectory ||
                    !isPlugin(entries[index].relativePath))
                {
                    return;
                }
                const std::wstring archivePathText = normalizedZipPathText(entries[index].relativePath);
                if (archivePathText.size() < fomod.wrapperPrefix.size())
                {
                    return;
                }
                pluginEntries.try_emplace(
                    index,
                    std::filesystem::path(archivePathText.substr(fomod.wrapperPrefix.size())));
            };
            for (const FomodStep& step : descriptor.steps)
            {
                for (const FomodGroup& group : step.groups)
                {
                    for (const FomodOption& option : group.options)
                    {
                        for (const FomodFileEntry& file : option.files)
                        {
                            const std::optional<std::filesystem::path> source =
                                trySafeFomodPreviewRelativePath(file.source);
                            if (!source.has_value())
                            {
                                continue;
                            }
                            const std::wstring sourceKey = fomod.wrapperPrefixKey + zipPathKey(source.value());
                            if (!file.isFolder)
                            {
                                if (const auto exact = fomod.entryIndexByKey.find(sourceKey);
                                    exact != fomod.entryIndexByKey.end())
                                {
                                    rememberPluginEntry(exact->second);
                                }
                                continue;
                            }
                            const std::wstring folderPrefix = sourceKey.ends_with(L'/')
                                ? sourceKey
                                : sourceKey + L'/';
                            for (std::size_t index = 0; index < entries.size(); ++index)
                            {
                                if (entries[index].comparisonKey.starts_with(folderPrefix))
                                {
                                    rememberPluginEntry(index);
                                }
                            }
                        }
                    }
                }
            }

            constexpr std::size_t maximumPluginCandidates = 256;
            constexpr std::uint64_t maximumPluginHeaderBytes = 8ULL * 1024ULL * 1024ULL + 24ULL;
            constexpr std::uint64_t maximumTotalPluginBytes = 64ULL * 1024ULL * 1024ULL;
            std::uint64_t totalPluginBytes = 0;
            std::size_t pluginCandidate = 0;
            const auto materializeReviewPlaceholder = [&](const std::filesystem::path& relativePath)
            {
                const std::filesystem::path target = destinationDirectory / relativePath;
                PathSafetyService().validateWritePath(destinationDirectory, target)
                    .throwIfUnsafe("FOMOD TES4 review placeholder is unsafe");
                std::filesystem::create_directories(target.parent_path());
                std::ofstream output(target, std::ios::binary | std::ios::trunc);
                output.write("REVIEW", 6);
            };
            for (const auto& [index, destinationRelative] : pluginEntries)
            {
                ++pluginCandidate;
                if (pluginCandidate > maximumPluginCandidates + 1)
                {
                    break;
                }
                const ZipArchiveEntry& plugin = entries[index];
                const bool withinCandidateLimit = pluginCandidate <= maximumPluginCandidates;
                const bool withinTotalBudget = plugin.uncompressedSize <=
                    maximumTotalPluginBytes - (std::min)(totalPluginBytes, maximumTotalPluginBytes);
                if (!withinCandidateLimit || !withinTotalBudget ||
                    !zipEntrySupportsSelectiveExtraction(plugin, maximumPluginHeaderBytes))
                {
                    materializeReviewPlaceholder(destinationRelative);
                    continue;
                }
                totalPluginBytes += plugin.uncompressedSize;
                extractZipEntrySelectively(
                    archivePath,
                    plugin,
                    destinationDirectory,
                    destinationRelative);
            }
            const auto headerXmlStartedAt = std::chrono::steady_clock::now();
            descriptor = analyzeDescriptor(destinationDirectory);
            xmlDuration += std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - headerXmlStartedAt);

            std::set<std::size_t> previewEntryIndexes;
            const auto rememberPreview = [&](std::wstring_view imagePath)
            {
                if (const std::optional<std::size_t> imageIndex =
                        indexedFomodImageEntry(fomod, imagePath);
                    imageIndex.has_value())
                {
                    previewEntryIndexes.insert(imageIndex.value());
                }
            };
            rememberPreview(descriptor.moduleImagePath);
            for (const FomodStep& step : descriptor.steps)
            {
                for (const FomodGroup& group : step.groups)
                {
                    for (const FomodOption& option : group.options)
                    {
                        rememberPreview(option.imagePath);
                    }
                }
            }

            std::uint64_t totalPreviewBytes = 0;
            std::vector<std::size_t> extractablePreviewIndexes;
            extractablePreviewIndexes.reserve(previewEntryIndexes.size());
            for (const std::size_t imageIndex : previewEntryIndexes)
            {
                const ZipArchiveEntry& image = entries[imageIndex];
                if (!zipEntrySupportsSelectiveExtraction(image, maximumPreviewBytes) ||
                    image.uncompressedSize > maximumTotalPreviewBytes - totalPreviewBytes)
                {
                    continue;
                }
                totalPreviewBytes += image.uncompressedSize;
                extractablePreviewIndexes.push_back(imageIndex);
            }

            for (const std::size_t imageIndex : extractablePreviewIndexes)
            {
                const ZipArchiveEntry& image = entries[imageIndex];
                const std::wstring archivePathText = normalizedZipPathText(image.relativePath);
                if (archivePathText.size() < fomod.wrapperPrefix.size())
                {
                    throw std::runtime_error("Indexed FOMOD wrapper metadata is invalid.");
                }
                const std::filesystem::path destinationRelative =
                    std::filesystem::path(archivePathText.substr(fomod.wrapperPrefix.size()));
                extractZipEntrySelectively(
                    archivePath,
                    image,
                    destinationDirectory,
                    destinationRelative);
            }
            uniquePreviewCount = extractablePreviewIndexes.size();
            parsedDescriptor = std::move(descriptor);
            return true;
        }

        void validateExtractedDirectoryTree(const std::filesystem::path& destinationDirectory)
        {
            const PathSafetyService safety;
            safety.validateDirectoryWriteRoot(destinationDirectory)
                .throwIfUnsafe("Archive extraction destination is unsafe");

            const std::filesystem::path ioDestinationDirectory =
                pathForFilesystemIo(destinationDirectory);
            std::error_code iterateError;
            std::filesystem::recursive_directory_iterator iterator(
                ioDestinationDirectory,
                std::filesystem::directory_options::skip_permission_denied,
                iterateError);
            const std::filesystem::recursive_directory_iterator end;
            for (; iterator != end; iterator.increment(iterateError))
            {
                if (iterateError)
                {
                    throw std::runtime_error("Failed to validate extracted archive paths: " + iterateError.message());
                }

                const std::filesystem::path relative =
                    iterator->path().lexically_relative(ioDestinationDirectory);
                safety.validateContainedPath(destinationDirectory, destinationDirectory / relative)
                    .throwIfUnsafe("Archive extraction produced an unsafe path");
            }
            if (iterateError)
            {
                throw std::runtime_error("Failed to validate extracted archive paths: " + iterateError.message());
            }
        }

        std::wstring directoryWithTrailingSlash(const std::filesystem::path& directory)
        {
            std::wstring value = directory.wstring();
            if (!value.empty() && value.back() != L'\\' && value.back() != L'/')
            {
                value.push_back(L'\\');
            }

            return value;
        }

        bool tryExtractWith7Zip(
            const std::filesystem::path& archivePath,
            const std::filesystem::path& destinationDirectory,
            const std::filesystem::path& cancellationMarker,
            const Logger& logger)
        {
#ifndef _WIN32
            (void)archivePath;
            (void)destinationDirectory;
            (void)cancellationMarker;
            (void)logger;
            return false;
#else
            for (std::wstring_view executableName : {L"7z.exe", L"7za.exe", L"7zz.exe"})
            {
                const std::filesystem::path executable = findExtractorExecutable(executableName);
                if (executable.empty())
                {
                    continue;
                }

                const std::wstring command =
                    quoteCommandArgument(executable.wstring()) +
                    L" x -y -bd -o" +
                    quoteCommandArgument(destinationDirectory.wstring()) +
                    L" " +
                    quoteCommandArgument(archivePath.wstring());
                if (runHiddenAndWait(command, archivePath, executableName, cancellationMarker, logger))
                {
                    return true;
                }
            }

            return false;
#endif
        }

        bool tryExtractWithWinRar(
            const std::filesystem::path& archivePath,
            const std::filesystem::path& destinationDirectory,
            const std::filesystem::path& cancellationMarker,
            const Logger& logger)
        {
#ifndef _WIN32
            (void)archivePath;
            (void)destinationDirectory;
            (void)cancellationMarker;
            (void)logger;
            return false;
#else
            const std::wstring destination = directoryWithTrailingSlash(destinationDirectory);

            if (const std::filesystem::path unrar = findExtractorExecutable(L"UnRAR.exe"); !unrar.empty())
            {
                const std::wstring command =
                    quoteCommandArgument(unrar.wstring()) +
                    L" x -y -idq " +
                    quoteCommandArgument(archivePath.wstring()) +
                    L" " +
                    quoteCommandArgument(destination);
                if (runHiddenAndWait(command, archivePath, L"UnRAR.exe", cancellationMarker, logger))
                {
                    return true;
                }
            }

            if (const std::filesystem::path winrar = findExtractorExecutable(L"WinRAR.exe"); !winrar.empty())
            {
                const std::wstring command =
                    quoteCommandArgument(winrar.wstring()) +
                    L" x -ibck -y " +
                    quoteCommandArgument(archivePath.wstring()) +
                    L" " +
                    quoteCommandArgument(destination);
                if (runHiddenAndWait(command, archivePath, L"WinRAR.exe", cancellationMarker, logger))
                {
                    return true;
                }
            }

            return false;
#endif
        }

        bool tryExtractWithTar(
            const std::filesystem::path& archivePath,
            const std::filesystem::path& destinationDirectory,
            const std::filesystem::path& cancellationMarker,
            const Logger& logger)
        {
#ifndef _WIN32
            (void)archivePath;
            (void)destinationDirectory;
            (void)cancellationMarker;
            (void)logger;
            return false;
#else
            const std::filesystem::path tar = findExtractorExecutable(L"tar.exe");
            if (tar.empty())
            {
                return false;
            }

            const std::wstring command =
                quoteCommandArgument(tar.wstring()) +
                L" -xf " +
                quoteCommandArgument(archivePath.wstring()) +
                L" -C " +
                quoteCommandArgument(destinationDirectory.wstring());
            return runHiddenAndWait(command, archivePath, L"tar.exe", cancellationMarker, logger);
#endif
        }

        bool extractArchiveToDirectory(
            const std::filesystem::path& archivePath,
            const std::filesystem::path& destinationDirectory,
            const Logger& logger)
        {
            if (!isExtractableArchive(archivePath))
            {
                return false;
            }

            validateArchiveEntryPaths(archivePath);

#ifdef _WIN32
            const std::filesystem::path cancellationMarker =
                operationCancellationMarkerPathForDownloadService(Logger::operationId());
#else
            const std::filesystem::path cancellationMarker;
#endif

            if (tryExtractWith7Zip(archivePath, destinationDirectory, cancellationMarker, logger))
            {
                validateExtractedDirectoryTree(destinationDirectory);
                return true;
            }

            if (archiveExtension(archivePath) == L".rar" &&
                tryExtractWithWinRar(archivePath, destinationDirectory, cancellationMarker, logger))
            {
                validateExtractedDirectoryTree(destinationDirectory);
                return true;
            }

            if (tryExtractWithTar(archivePath, destinationDirectory, cancellationMarker, logger))
            {
                validateExtractedDirectoryTree(destinationDirectory);
                return true;
            }

            throw std::runtime_error("Failed to extract archive. Install 7-Zip or WinRAR, or place 7z.exe next to Fluxora.exe.");
        }

        [[nodiscard]] std::filesystem::path installStagingCacheRoot(
            const std::filesystem::path& downloadsDirectory)
        {
            return downloadsDirectory / std::filesystem::path(installStagingCacheDirectoryName);
        }

        [[nodiscard]] std::filesystem::path installStagingCachePayloadDirectory(
            const std::filesystem::path& entryDirectory)
        {
            return entryDirectory / std::filesystem::path(installStagingCachePayloadDirectoryName);
        }

        [[nodiscard]] std::filesystem::path installStagingCacheReadyPath(
            const std::filesystem::path& entryDirectory)
        {
            return entryDirectory / std::filesystem::path(installStagingCacheReadyFileName);
        }

        constexpr std::string_view installStagingCacheManifestPrefix =
            "fluxora-staging-cache-v3\nsha256=";

        struct InstallStagingCachePayloadIntegrity
        {
            std::string metadataDigest;
            std::string contentDigest;
        };

        struct InstallStagingCacheManifest
        {
            std::string contentDigest;
            std::string metadataDigest;
        };

#ifdef _WIN32
        struct InstallStagingCacheVerifiedIntegrity
        {
            std::string contentDigest;
            std::string metadataDigest;
            std::uint64_t lastUse{0};
        };

        std::mutex installStagingCacheIntegrityMemoMutex;
        std::map<std::wstring, InstallStagingCacheVerifiedIntegrity> installStagingCacheIntegrityMemo;
        std::uint64_t installStagingCacheIntegrityMemoUseCounter{0};
        constexpr std::size_t installStagingCacheIntegrityMemoMaxEntries = 64;
#endif

        [[nodiscard]] std::wstring installStagingCacheIntegrityMemoKey(
            const std::filesystem::path& entryDirectory)
        {
            return toLower(std::filesystem::absolute(entryDirectory).lexically_normal().wstring());
        }

        [[nodiscard]] bool matchesVerifiedInstallStagingCacheIntegrity(
            const std::filesystem::path& entryDirectory,
            const InstallStagingCachePayloadIntegrity& integrity)
        {
#ifdef _WIN32
            std::lock_guard lock(installStagingCacheIntegrityMemoMutex);
            const auto found = installStagingCacheIntegrityMemo.find(
                installStagingCacheIntegrityMemoKey(entryDirectory));
            if (found == installStagingCacheIntegrityMemo.end() ||
                found->second.contentDigest != integrity.contentDigest ||
                found->second.metadataDigest != integrity.metadataDigest)
            {
                return false;
            }

            found->second.lastUse = ++installStagingCacheIntegrityMemoUseCounter;
            return true;
#else
            (void)entryDirectory;
            (void)integrity;
            return false;
#endif
        }

        void rememberVerifiedInstallStagingCacheIntegrity(
            const std::filesystem::path& entryDirectory,
            const InstallStagingCachePayloadIntegrity& integrity)
        {
#ifdef _WIN32
            std::lock_guard lock(installStagingCacheIntegrityMemoMutex);
            installStagingCacheIntegrityMemo[installStagingCacheIntegrityMemoKey(entryDirectory)] =
                InstallStagingCacheVerifiedIntegrity{
                    integrity.contentDigest,
                    integrity.metadataDigest,
                    ++installStagingCacheIntegrityMemoUseCounter};
            if (installStagingCacheIntegrityMemo.size() > installStagingCacheIntegrityMemoMaxEntries)
            {
                const auto oldest = std::min_element(
                    installStagingCacheIntegrityMemo.begin(),
                    installStagingCacheIntegrityMemo.end(),
                    [](const auto& left, const auto& right)
                    {
                        return left.second.lastUse < right.second.lastUse;
                    });
                if (oldest != installStagingCacheIntegrityMemo.end())
                {
                    installStagingCacheIntegrityMemo.erase(oldest);
                }
            }
#else
            (void)entryDirectory;
            (void)integrity;
#endif
        }

        [[nodiscard]] bool isHexDigest(std::string_view digest)
        {
            return !digest.empty() &&
                std::all_of(digest.begin(), digest.end(), [](const char character)
                {
                    return std::isxdigit(static_cast<unsigned char>(character)) != 0;
                });
        }

        [[nodiscard]] std::optional<InstallStagingCacheManifest> readInstallStagingCacheManifest(
            const std::filesystem::path& entryDirectory)
        {
            const std::string manifest = readTextFile(installStagingCacheReadyPath(entryDirectory));
            if (!manifest.starts_with(installStagingCacheManifestPrefix))
            {
                return std::nullopt;
            }

            const std::size_t digestStart = installStagingCacheManifestPrefix.size();
            const std::size_t digestEnd = manifest.find('\n', digestStart);
            if (digestEnd == std::string::npos)
            {
                return std::nullopt;
            }
            const std::string contentDigest = manifest.substr(
                digestStart,
                digestEnd - digestStart);
            constexpr std::string_view metadataPrefix = "metadata-sha256=";
            const std::size_t metadataStart = digestEnd + 1;
            if (manifest.substr(metadataStart, metadataPrefix.size()) != metadataPrefix)
            {
                return std::nullopt;
            }
            const std::size_t metadataDigestStart = metadataStart + metadataPrefix.size();
            const std::size_t metadataDigestEnd = manifest.find('\n', metadataDigestStart);
            const std::string metadataDigest = manifest.substr(
                metadataDigestStart,
                metadataDigestEnd == std::string::npos
                    ? std::string::npos
                    : metadataDigestEnd - metadataDigestStart);
            if (!isHexDigest(contentDigest) || !isHexDigest(metadataDigest))
            {
                return std::nullopt;
            }
            return InstallStagingCacheManifest{contentDigest, metadataDigest};
        }

        [[nodiscard]] std::string serializeInstallStagingCacheManifest(
            std::string_view contentDigest,
            std::string_view metadataDigest)
        {
            return std::string(installStagingCacheManifestPrefix) +
                std::string(contentDigest) +
                "\nmetadata-sha256=" + std::string(metadataDigest) + "\n";
        }

        [[nodiscard]] InstallStagingCachePayloadIntegrity inspectInstallStagingCachePayload(
            const std::filesystem::path& payloadDirectory,
            bool includeContents)
        {
            struct PayloadEntry
            {
                std::filesystem::path path;
                std::string relativePath;
                bool directory{false};
            };

            std::vector<PayloadEntry> entries;
            const std::filesystem::path ioPayloadDirectory = pathForFilesystemIo(payloadDirectory);
            std::error_code iterateError;
            std::filesystem::recursive_directory_iterator iterator(
                ioPayloadDirectory,
                std::filesystem::directory_options::skip_permission_denied,
                iterateError);
            const std::filesystem::recursive_directory_iterator end;
            for (; iterator != end; iterator.increment(iterateError))
            {
                if (iterateError)
                {
                    throw std::runtime_error(
                        "Failed to enumerate install staging cache payload: " +
                        iterateError.message());
                }

                std::error_code statusError;
                const std::filesystem::file_status status = iterator->symlink_status(statusError);
                if (statusError || std::filesystem::is_symlink(status))
                {
                    throw std::runtime_error("Install staging cache payload contains an unsafe entry.");
                }

                const bool directory = std::filesystem::is_directory(status);
                if (!directory && !std::filesystem::is_regular_file(status))
                {
                    throw std::runtime_error("Install staging cache payload contains an unsupported entry.");
                }

                const std::filesystem::path relative =
                    iterator->path().lexically_relative(ioPayloadDirectory);
                entries.push_back(PayloadEntry{
                    payloadDirectory / relative,
                    toUtf8(relative.generic_wstring()),
                    directory});
            }
            if (iterateError)
            {
                throw std::runtime_error(
                    "Failed to enumerate install staging cache payload: " +
                    iterateError.message());
            }

            std::sort(entries.begin(), entries.end(), [](const auto& left, const auto& right)
            {
                return left.relativePath < right.relativePath;
            });

            StrongContentHasher metadataHasher;
            std::optional<StrongContentHasher> contentHasher;
            if (includeContents)
            {
                contentHasher.emplace();
            }

            for (const PayloadEntry& entry : entries)
            {
                const std::string entryPrefix =
                    std::string(entry.directory ? "D\0" : "F\0", 2) +
                    entry.relativePath + '\0';
                metadataHasher.update(entryPrefix);
                if (contentHasher.has_value())
                {
                    contentHasher->update(entryPrefix);
                }

                if (entry.directory)
                {
                    continue;
                }

                const std::string identity = regularFileIdentityToken(entry.path);
                metadataHasher.update(identity);
                metadataHasher.update("\0", 1);

                std::error_code sizeError;
                const std::uintmax_t size =
                    std::filesystem::file_size(pathForFilesystemIo(entry.path), sizeError);
                if (sizeError)
                {
                    throw std::runtime_error("Failed to inspect install staging cache payload size.");
                }
                if (contentHasher.has_value())
                {
                    const std::string sizeText = std::to_string(size);
                    contentHasher->update(sizeText);
                    contentHasher->update("\0", 1);
                    contentHasher->update(cachedRegularFileContentHash(entry.path));
                    contentHasher->update("\0", 1);
                }
            }

            InstallStagingCachePayloadIntegrity result;
            result.metadataDigest = metadataHasher.finish();
            if (contentHasher.has_value())
            {
                result.contentDigest = contentHasher->finish();
            }
            return result;
        }

        [[nodiscard]] bool hasInstallStagingCacheEntryStructure(
            const std::filesystem::path& entryDirectory)
        {
            std::error_code payloadError;
            std::error_code readyError;
            return std::filesystem::is_directory(
                       installStagingCachePayloadDirectory(entryDirectory),
                       payloadError) &&
                std::filesystem::is_regular_file(
                    installStagingCacheReadyPath(entryDirectory),
                    readyError) &&
                readInstallStagingCacheManifest(entryDirectory).has_value();
        }

        [[nodiscard]] bool isUsableInstallStagingCacheEntry(
            const std::filesystem::path& entryDirectory)
        {
            const std::filesystem::path payloadDirectory =
                installStagingCachePayloadDirectory(entryDirectory);
            if (!hasInstallStagingCacheEntryStructure(entryDirectory))
            {
                return false;
            }

            const std::optional<InstallStagingCacheManifest> manifest =
                readInstallStagingCacheManifest(entryDirectory);
            if (!manifest.has_value())
            {
                return false;
            }

            try
            {
                const InstallStagingCachePayloadIntegrity metadataOnly =
                    inspectInstallStagingCachePayload(payloadDirectory, false);
                if (metadataOnly.metadataDigest != manifest->metadataDigest)
                {
                    return false;
                }

                const InstallStagingCachePayloadIntegrity expectedIntegrity{
                    manifest->metadataDigest,
                    manifest->contentDigest};
                if (matchesVerifiedInstallStagingCacheIntegrity(entryDirectory, expectedIntegrity))
                {
                    return true;
                }

                const InstallStagingCachePayloadIntegrity contentVerified =
                    inspectInstallStagingCachePayload(payloadDirectory, true);
                const InstallStagingCachePayloadIntegrity metadataAfterHash =
                    inspectInstallStagingCachePayload(payloadDirectory, false);
                if (contentVerified.metadataDigest != metadataAfterHash.metadataDigest ||
                    contentVerified.metadataDigest != manifest->metadataDigest ||
                    contentVerified.contentDigest != manifest->contentDigest)
                {
                    return false;
                }

                rememberVerifiedInstallStagingCacheIntegrity(entryDirectory, contentVerified);
                return true;
            }
            catch (const std::exception&)
            {
                return false;
            }
        }

        [[nodiscard]] std::filesystem::file_time_type installStagingCacheEntryTime(
            const std::filesystem::path& entryDirectory,
            std::error_code& error)
        {
            error.clear();
            const std::filesystem::path readyPath = installStagingCacheReadyPath(entryDirectory);
            std::filesystem::file_time_type modified =
                std::filesystem::last_write_time(readyPath, error);
            if (!error)
            {
                return modified;
            }

            error.clear();
            modified = std::filesystem::last_write_time(entryDirectory, error);
            return modified;
        }

        [[nodiscard]] bool isInstallStagingCacheEntryStale(
            const std::filesystem::path& entryDirectory)
        {
            std::error_code error;
            const std::filesystem::file_time_type modified =
                installStagingCacheEntryTime(entryDirectory, error);
            if (error)
            {
                return true;
            }

            const std::filesystem::file_time_type cutoff =
                std::filesystem::file_time_type::clock::now() - std::chrono::hours(24);
            return modified < cutoff;
        }

        [[nodiscard]] bool isInstallStagingCacheBuildingEntry(
            const std::filesystem::path& entryDirectory)
        {
            return entryDirectory.filename().wstring().starts_with(L".building-");
        }

        void retainInstallStagingCacheEntryLocked(const std::filesystem::path& entryDirectory)
        {
            ++installStagingCacheActiveEntries[entryDirectory];
        }

        void releaseInstallStagingCacheEntry(const std::filesystem::path& entryDirectory)
        {
            if (entryDirectory.empty())
            {
                return;
            }

            std::lock_guard<std::mutex> cacheLock(installStagingCacheMutex);
            const auto found = installStagingCacheActiveEntries.find(entryDirectory);
            if (found == installStagingCacheActiveEntries.end())
            {
                return;
            }

            if (found->second <= 1)
            {
                installStagingCacheActiveEntries.erase(found);
                return;
            }

            --found->second;
        }

        [[nodiscard]] bool isInstallStagingCacheEntryActiveLocked(
            const std::filesystem::path& entryDirectory)
        {
            const auto found = installStagingCacheActiveEntries.find(entryDirectory);
            return found != installStagingCacheActiveEntries.end() && found->second > 0;
        }

        void touchInstallStagingCacheEntry(const std::filesystem::path& entryDirectory)
        {
            const std::filesystem::file_time_type now =
                std::filesystem::file_time_type::clock::now();
            std::error_code error;
            std::filesystem::last_write_time(installStagingCacheReadyPath(entryDirectory), now, error);
            error.clear();
            std::filesystem::last_write_time(entryDirectory, now, error);
        }

        void cleanupInstallStagingCacheLocked(
            const std::filesystem::path& cacheRoot,
            const Logger& logger,
            const std::filesystem::path& protectedEntry = {})
        {
            std::error_code existsError;
            if (!std::filesystem::exists(cacheRoot, existsError))
            {
                return;
            }

            std::vector<std::pair<std::filesystem::path, std::filesystem::file_time_type>> retainedEntries;
            std::error_code iterateError;
            for (const auto& entry : std::filesystem::directory_iterator(cacheRoot, iterateError))
            {
                if (iterateError)
                {
                    logger.write(
                        LogLevel::Warning,
                        "InstallStagingCache",
                        "Failed to scan install staging cache: " + iterateError.message());
                    break;
                }

                std::error_code typeError;
                if (!entry.is_directory(typeError))
                {
                    continue;
                }

                const std::filesystem::path entryPath = entry.path();
                if (!protectedEntry.empty() && entryPath == protectedEntry)
                {
                    std::error_code timeError;
                    const std::filesystem::file_time_type modified =
                        installStagingCacheEntryTime(entryPath, timeError);
                    retainedEntries.push_back({
                        entryPath,
                        timeError ? (std::filesystem::file_time_type::min)() : modified
                    });
                    continue;
                }

                if (isInstallStagingCacheEntryActiveLocked(entryPath))
                {
                    std::error_code timeError;
                    const std::filesystem::file_time_type modified =
                        installStagingCacheEntryTime(entryPath, timeError);
                    retainedEntries.push_back({
                        entryPath,
                        timeError ? (std::filesystem::file_time_type::max)() : modified
                    });
                    continue;
                }

                if (isInstallStagingCacheBuildingEntry(entryPath))
                {
                    if (isInstallStagingCacheEntryStale(entryPath))
                    {
                        cleanupTemporaryDirectory(entryPath, logger, "InstallStagingCache");
                    }
                    continue;
                }

                if (!hasInstallStagingCacheEntryStructure(entryPath) ||
                    isInstallStagingCacheEntryStale(entryPath))
                {
                    cleanupTemporaryDirectory(entryPath, logger, "InstallStagingCache");
                    continue;
                }

                std::error_code timeError;
                const std::filesystem::file_time_type modified =
                    installStagingCacheEntryTime(entryPath, timeError);
                retainedEntries.push_back({
                    entryPath,
                    timeError ? (std::filesystem::file_time_type::min)() : modified
                });
            }

            std::sort(
                retainedEntries.begin(),
                retainedEntries.end(),
                [](const auto& left, const auto& right)
                {
                    return left.second > right.second;
                });

            for (std::size_t index = installStagingCacheMaxEntries;
                 index < retainedEntries.size();
                 ++index)
            {
                if (!protectedEntry.empty() && retainedEntries[index].first == protectedEntry)
                {
                    continue;
                }
                if (isInstallStagingCacheEntryActiveLocked(retainedEntries[index].first))
                {
                    continue;
                }

                cleanupTemporaryDirectory(retainedEntries[index].first, logger, "InstallStagingCache");
            }
        }

        [[nodiscard]] std::wstring installStagingCacheEntryName(
            std::wstring_view kind,
            std::wstring_view key)
        {
            return std::wstring(kind) + L"-" + hashText(key);
        }

        [[nodiscard]] std::wstring installStagingCacheLockKey(
            std::wstring_view kind,
            std::wstring_view key)
        {
            return std::wstring(kind) + L"\n" + std::wstring(key);
        }

        [[nodiscard]] std::shared_ptr<std::mutex> installStagingCacheKeyMutex(
            std::wstring_view kind,
            std::wstring_view key)
        {
            std::lock_guard<std::mutex> cacheLock(installStagingCacheMutex);
            const std::wstring lockKey = installStagingCacheLockKey(kind, key);
            for (auto iterator = installStagingCacheKeyMutexes.begin();
                 iterator != installStagingCacheKeyMutexes.end();)
            {
                if (iterator->first != lockKey && iterator->second.expired())
                {
                    iterator = installStagingCacheKeyMutexes.erase(iterator);
                    continue;
                }

                ++iterator;
            }

            std::weak_ptr<std::mutex>& cached = installStagingCacheKeyMutexes[lockKey];
            if (std::shared_ptr<std::mutex> existing = cached.lock())
            {
                return existing;
            }

            std::shared_ptr<std::mutex> created = std::make_shared<std::mutex>();
            cached = created;
            return created;
        }

        [[nodiscard]] std::filesystem::path prepareInstallStagingCacheRootLocked(
            const std::filesystem::path& downloadsDirectory,
            const Logger& logger)
        {
            const std::filesystem::path cacheRoot = installStagingCacheRoot(downloadsDirectory);
            std::filesystem::create_directories(downloadsDirectory);
            PathSafetyService().validateDirectoryWriteRoot(downloadsDirectory)
                .throwIfUnsafe("Downloads directory is unsafe");
            PathSafetyService().validateWritePath(downloadsDirectory, cacheRoot)
                .throwIfUnsafe("Install staging cache root is unsafe");
            std::filesystem::create_directories(cacheRoot);
            cleanupInstallStagingCacheLocked(cacheRoot, logger);
            return cacheRoot;
        }

        class InstallStagingCachePayloadLease
        {
        public:
            InstallStagingCachePayloadLease() = default;

            InstallStagingCachePayloadLease(
                std::filesystem::path entryDirectory,
                std::filesystem::path payloadDirectory,
                std::shared_ptr<std::mutex> keyMutex,
                std::unique_lock<std::mutex> keyLock)
                : entryDirectory_(std::move(entryDirectory)),
                  payloadDirectory_(std::move(payloadDirectory)),
                  keyMutex_(std::move(keyMutex)),
                  keyLock_(std::move(keyLock))
            {
            }

            InstallStagingCachePayloadLease(const InstallStagingCachePayloadLease&) = delete;
            InstallStagingCachePayloadLease& operator=(const InstallStagingCachePayloadLease&) = delete;

            InstallStagingCachePayloadLease(InstallStagingCachePayloadLease&& other) noexcept
                : entryDirectory_(std::move(other.entryDirectory_)),
                  payloadDirectory_(std::move(other.payloadDirectory_)),
                  keyMutex_(std::move(other.keyMutex_)),
                  keyLock_(std::move(other.keyLock_))
            {
                other.entryDirectory_.clear();
            }

            InstallStagingCachePayloadLease& operator=(InstallStagingCachePayloadLease&& other) noexcept
            {
                if (this != &other)
                {
                    releaseActiveEntry();
                    entryDirectory_ = std::move(other.entryDirectory_);
                    payloadDirectory_ = std::move(other.payloadDirectory_);
                    keyMutex_ = std::move(other.keyMutex_);
                    keyLock_ = std::move(other.keyLock_);
                    other.entryDirectory_.clear();
                }

                return *this;
            }

            ~InstallStagingCachePayloadLease()
            {
                releaseActiveEntry();
            }

            [[nodiscard]] const std::filesystem::path& entryDirectory() const noexcept
            {
                return entryDirectory_;
            }

            [[nodiscard]] const std::filesystem::path& payloadDirectory() const noexcept
            {
                return payloadDirectory_;
            }

        private:
            void releaseActiveEntry()
            {
                if (entryDirectory_.empty())
                {
                    return;
                }

                releaseInstallStagingCacheEntry(entryDirectory_);
                entryDirectory_.clear();
            }

            std::filesystem::path entryDirectory_;
            std::filesystem::path payloadDirectory_;
            std::shared_ptr<std::mutex> keyMutex_;
            std::unique_lock<std::mutex> keyLock_;
        };

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        using InstallStagingCacheProducerHook = std::function<void(
            std::wstring_view,
            std::wstring_view,
            const std::filesystem::path&)>;

        std::mutex installStagingCacheProducerHookMutex;
        InstallStagingCacheProducerHook installStagingCacheProducerHook;

        void runInstallStagingCacheProducerHook(
            std::wstring_view kind,
            std::wstring_view key,
            const std::filesystem::path& payloadDirectory)
        {
            InstallStagingCacheProducerHook hook;
            {
                std::lock_guard<std::mutex> hookLock(installStagingCacheProducerHookMutex);
                hook = installStagingCacheProducerHook;
            }

            if (hook)
            {
                hook(kind, key, payloadDirectory);
            }
        }
#endif

        template <typename Producer>
        [[nodiscard]] InstallStagingCachePayloadLease ensureInstallStagingCachePayload(
            const std::filesystem::path& downloadsDirectory,
            std::wstring_view kind,
            std::wstring_view key,
            const Logger& logger,
            Producer producer)
        {
            std::shared_ptr<std::mutex> keyMutex = installStagingCacheKeyMutex(kind, key);
            std::unique_lock<std::mutex> keyLock(*keyMutex);

            std::filesystem::path cacheRoot;
            std::filesystem::path entryDirectory;
            std::filesystem::path payloadDirectory;
            std::filesystem::path temporaryEntryDirectory;
            std::filesystem::path temporaryPayloadDirectory;

            {
                std::lock_guard<std::mutex> cacheLock(installStagingCacheMutex);
                cacheRoot = prepareInstallStagingCacheRootLocked(downloadsDirectory, logger);
                entryDirectory = cacheRoot / std::filesystem::path(installStagingCacheEntryName(kind, key));
                payloadDirectory = installStagingCachePayloadDirectory(entryDirectory);
                if (isUsableInstallStagingCacheEntry(entryDirectory))
                {
                    touchInstallStagingCacheEntry(entryDirectory);
                    retainInstallStagingCacheEntryLocked(entryDirectory);
                    logger.write(
                        LogLevel::Info,
                        "InstallStagingCache",
                        "Install staging cache hit. kind=\"" + toUtf8(std::wstring(kind)) +
                            "\", path=\"" + toUtf8(payloadDirectory.wstring()) + "\"");
                    return InstallStagingCachePayloadLease{
                        entryDirectory,
                        payloadDirectory,
                        std::move(keyMutex),
                        std::move(keyLock)};
                }

                cleanupTemporaryDirectory(entryDirectory, logger, "InstallStagingCache");
                temporaryEntryDirectory = uniquePath(
                    cacheRoot,
                    L".building-" + installStagingCacheEntryName(kind, key));
                temporaryPayloadDirectory = installStagingCachePayloadDirectory(temporaryEntryDirectory);
                std::filesystem::create_directories(temporaryPayloadDirectory);
            }

            try
            {
#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
                runInstallStagingCacheProducerHook(kind, key, temporaryPayloadDirectory);
#endif
                producer(temporaryPayloadDirectory);
                validateExtractedDirectoryTree(temporaryPayloadDirectory);
                const InstallStagingCachePayloadIntegrity producedIntegrity =
                    inspectInstallStagingCachePayload(temporaryPayloadDirectory, true);
                const InstallStagingCachePayloadIntegrity metadataAfterHash =
                    inspectInstallStagingCachePayload(temporaryPayloadDirectory, false);
                if (producedIntegrity.metadataDigest != metadataAfterHash.metadataDigest)
                {
                    throw std::runtime_error(
                        "Install staging cache payload changed while its integrity manifest was being created.");
                }
                writeTextFile(
                    installStagingCacheReadyPath(temporaryEntryDirectory),
                    serializeInstallStagingCacheManifest(
                        producedIntegrity.contentDigest,
                        metadataAfterHash.metadataDigest));

                {
                    std::lock_guard<std::mutex> cacheLock(installStagingCacheMutex);
                    if (isUsableInstallStagingCacheEntry(entryDirectory))
                    {
                        cleanupTemporaryDirectory(temporaryEntryDirectory, logger, "InstallStagingCache");
                        touchInstallStagingCacheEntry(entryDirectory);
                        retainInstallStagingCacheEntryLocked(entryDirectory);
                        logger.write(
                            LogLevel::Info,
                            "InstallStagingCache",
                            "Install staging cache hit. kind=\"" + toUtf8(std::wstring(kind)) +
                                "\", path=\"" + toUtf8(payloadDirectory.wstring()) + "\"");
                        return InstallStagingCachePayloadLease{
                            entryDirectory,
                            payloadDirectory,
                            std::move(keyMutex),
                            std::move(keyLock)};
                    }

                    cleanupTemporaryDirectory(entryDirectory, logger, "InstallStagingCache");
                    std::filesystem::rename(temporaryEntryDirectory, entryDirectory);
                    rememberVerifiedInstallStagingCacheIntegrity(
                        entryDirectory,
                        InstallStagingCachePayloadIntegrity{
                            metadataAfterHash.metadataDigest,
                            producedIntegrity.contentDigest});
                    touchInstallStagingCacheEntry(entryDirectory);
                    retainInstallStagingCacheEntryLocked(entryDirectory);
                    logger.write(
                        LogLevel::Info,
                        "InstallStagingCache",
                        "Install staging cache populated. kind=\"" + toUtf8(std::wstring(kind)) +
                            "\", path=\"" + toUtf8(payloadDirectory.wstring()) + "\"");
                    cleanupInstallStagingCacheLocked(cacheRoot, logger, entryDirectory);
                }
            }
            catch (const std::exception&)
            {
                cleanupTemporaryDirectory(temporaryEntryDirectory, logger, "InstallStagingCache");
                throw;
            }

            return InstallStagingCachePayloadLease{
                entryDirectory,
                payloadDirectory,
                std::move(keyMutex),
                std::move(keyLock)};
        }

        [[nodiscard]] std::optional<std::filesystem::path> tryInstallStagingCachePayloadLocked(
            const std::filesystem::path& downloadsDirectory,
            std::wstring_view kind,
            std::wstring_view key,
            const Logger& logger)
        {
            const std::filesystem::path cacheRoot = installStagingCacheRoot(downloadsDirectory);
            std::error_code existsError;
            if (!std::filesystem::is_directory(cacheRoot, existsError))
            {
                return std::nullopt;
            }

            cleanupInstallStagingCacheLocked(cacheRoot, logger);
            const std::filesystem::path entryDirectory =
                cacheRoot / std::filesystem::path(installStagingCacheEntryName(kind, key));
            if (!isUsableInstallStagingCacheEntry(entryDirectory))
            {
                return std::nullopt;
            }

            const std::filesystem::path payloadDirectory =
                installStagingCachePayloadDirectory(entryDirectory);
            touchInstallStagingCacheEntry(entryDirectory);
            logger.write(
                LogLevel::Info,
                "InstallStagingCache",
                "Install staging cache hit. kind=\"" + toUtf8(std::wstring(kind)) +
                    "\", path=\"" + toUtf8(payloadDirectory.wstring()) + "\"");
            return payloadDirectory;
        }

        [[nodiscard]] std::optional<InstallStagingCachePayloadLease> tryInstallStagingCachePayload(
            const std::filesystem::path& downloadsDirectory,
            std::wstring_view kind,
            std::wstring_view key,
            const Logger& logger)
        {
            std::shared_ptr<std::mutex> keyMutex = installStagingCacheKeyMutex(kind, key);
            std::unique_lock<std::mutex> keyLock(*keyMutex);
            std::filesystem::path entryDirectory;
            std::optional<std::filesystem::path> payloadDirectory;
            {
                std::lock_guard<std::mutex> cacheLock(installStagingCacheMutex);
                const std::filesystem::path cacheRoot = installStagingCacheRoot(downloadsDirectory);
                entryDirectory = cacheRoot / std::filesystem::path(installStagingCacheEntryName(kind, key));
                payloadDirectory = tryInstallStagingCachePayloadLocked(downloadsDirectory, kind, key, logger);
                if (!payloadDirectory.has_value())
                {
                    return std::nullopt;
                }

                retainInstallStagingCacheEntryLocked(entryDirectory);
            }

            return InstallStagingCachePayloadLease{
                entryDirectory,
                payloadDirectory.value(),
                std::move(keyMutex),
                std::move(keyLock)};
        }

        void discardInstallStagingCachePayloadLocked(
            const std::filesystem::path& payloadDirectory,
            const Logger& logger)
        {
            if (payloadDirectory.empty() ||
                payloadDirectory.filename() != std::filesystem::path(installStagingCachePayloadDirectoryName))
            {
                return;
            }

            cleanupTemporaryDirectory(payloadDirectory.parent_path(), logger, "InstallStagingCache");
        }

        void discardInstallStagingCachePayload(
            const InstallStagingCachePayloadLease& payload,
            const Logger& logger)
        {
            std::lock_guard<std::mutex> cacheLock(installStagingCacheMutex);
            discardInstallStagingCachePayloadLocked(payload.payloadDirectory(), logger);
        }

        void materializeArchiveInstallCachePayload(
            const std::filesystem::path& archivePath,
            const std::filesystem::path& destinationDirectory,
            std::wstring_view safeName,
            const Logger& logger)
        {
            const bool extracted = extractArchiveToDirectory(archivePath, destinationDirectory, logger);
            if (!extracted)
            {
                std::filesystem::copy_file(archivePath, destinationDirectory / archivePath.filename());
                return;
            }

            flattenRedundantModRootDirectory(destinationDirectory, safeName);
        }

        [[nodiscard]] std::wstring archiveInstallStagingCacheKey(
            const std::filesystem::path& archivePath,
            ExistingModInstallMode existingModMode,
            std::wstring_view safeName)
        {
            return L"v=1|kind=archive-staging|archive=" + fileCacheFingerprint(archivePath) +
                L"|layoutMode=" + std::to_wstring(static_cast<int>(existingModMode)) +
                L"|safeName=" + hashText(toLower(std::wstring(safeName)));
        }

        [[nodiscard]] std::wstring fomodPackageStagingCacheKey(
            const std::filesystem::path& archivePath)
        {
            return L"v=1|kind=fomod-package|archive=" + fileCacheFingerprint(archivePath);
        }

        [[nodiscard]] std::wstring fomodMetadataStagingCacheKey(
            const std::filesystem::path& archivePath)
        {
            return L"v=1|kind=fomod-metadata|archive=" + fastFileCacheFingerprint(archivePath);
        }

        [[nodiscard]] ContentLayoutInstallMode contentLayoutInstallMode(ExistingModInstallMode mode)
        {
            switch (mode)
            {
            case ExistingModInstallMode::Replace:
                return ContentLayoutInstallMode::Replace;
            case ExistingModInstallMode::Merge:
                return ContentLayoutInstallMode::Merge;
            case ExistingModInstallMode::FailIfExists:
            default:
                return ContentLayoutInstallMode::Standard;
            }
        }

        [[nodiscard]] std::string installModeName(ExistingModInstallMode mode)
        {
            switch (mode)
            {
            case ExistingModInstallMode::Replace:
                return "replace";
            case ExistingModInstallMode::Merge:
                return "merge";
            case ExistingModInstallMode::FailIfExists:
            default:
                return "standard";
            }
        }

        [[nodiscard]] std::string contentLayoutBlockerMessage(const PlacementPlan& plan)
        {
            for (const ValidationFinding& finding : plan.validationFindings)
            {
                if (finding.blocksInstall)
                {
                    return toUtf8(finding.message);
                }
            }

            return plan.userExplanation.summary.empty()
                ? "Content layout could not be applied."
                : toUtf8(plan.userExplanation.summary);
        }

        void logContentLayoutPlan(Logger& logger, const PlacementPlan& plan)
        {
            logger.write(
                plan.canInstall() ? LogLevel::Info : LogLevel::Warning,
                "Content layout analyzed. game=\"" + toUtf8(plan.gameId.value()) +
                    "\", entries=" + std::to_string(plan.summary.totalEntries) +
                    ", planned=" + std::to_string(plan.summary.plannedEntries) +
                    ", plugins=" + std::to_string(plan.summary.pluginEntries) +
                    ", archives=" + std::to_string(plan.summary.archiveEntries) +
                    ", scriptExtender=" + std::to_string(plan.summary.scriptExtenderEntries) +
                    ", unknown=" + std::to_string(plan.summary.unknownEntries) +
                    ", unsafe=" + std::to_string(plan.summary.unsafeEntries) +
                    ", blockers=" + std::to_string(plan.summary.hasBlockers ? 1 : 0) + ".");

            for (const ValidationFinding& finding : plan.validationFindings)
            {
                std::string message = "Content layout finding: " + toUtf8(finding.message);
                if (finding.path.has_value())
                {
                    message += " path=\"" + toUtf8(finding.path->path().generic_wstring()) + "\"";
                }

                logger.write(finding.blocksInstall ? LogLevel::Warning : LogLevel::Info, message);
            }
        }

        [[nodiscard]] std::vector<std::wstring> fomodGameDataFoldersForProject(
            const std::filesystem::path& projectDirectory)
        {
            const std::wstring gameId = InstanceMetadataStore::gameId(projectDirectory);
            if (gameId.empty())
            {
                return {};
            }

            const GameSupportRegistry& registry = GameSupportRegistry::embedded();
            const GameSupportLookupResult lookup = registry.lookupById(gameId);
            if (!lookup.supported || lookup.support == nullptr)
            {
                return {};
            }

            const GameSupportComponents& components = lookup.support->components();
            if (components.contentLayoutRulesProvider == nullptr)
            {
                return {};
            }

            const ContentLayoutSupportRules& rules =
                components.contentLayoutRulesProvider->contentLayoutRules();
            return rules.dataFolder.empty()
                ? std::vector<std::wstring>{}
                : std::vector<std::wstring>{rules.dataFolder};
        }

        [[nodiscard]] FomodInstallerDescriptor analyzeFomodForProfile(
            Logger& logger,
            const std::filesystem::path& projectDirectory,
            const BuildPathSettings& paths,
            const std::filesystem::path& packageDirectory,
            const FomodPackageIdentity& identity,
            std::wstring_view archiveFingerprint,
            std::wstring_view profileName,
            const std::vector<FomodManualDecision>& manualDecisions)
        {
            const auto startedAt = std::chrono::steady_clock::now();
            const std::vector<std::wstring> gameDataFolders =
                fomodGameDataFoldersForProject(projectDirectory);
            FomodInstallerDescriptor descriptor = FomodInstallerService::analyze(
                projectDirectory,
                paths.gameDirectory,
                paths.modsDirectory,
                packageDirectory,
                identity,
                gameDataFolders,
                profileName,
                {});
            if (!descriptor.isFomod)
            {
                return descriptor;
            }

            const auto profileStartedAt = std::chrono::steady_clock::now();
            FomodProfileContext context = FomodProfileContextService::build(
                FomodProfileContextRequest{
                    projectDirectory,
                    paths.gameDirectory,
                    paths.modsDirectory,
                    paths.profilesDirectory,
                    std::wstring(profileName),
                    gameDataFolders,
                    FomodInstallerService::referencedProfileFiles(descriptor)
                });
            context = FomodAutoSelectionService::bindContext(
                projectDirectory,
                archiveFingerprint,
                std::move(context));
            const auto profileFinishedAt = std::chrono::steady_clock::now();

            // Reload only the lightweight descriptor so exact contextual memory
            // can use the immutable profile fingerprint just calculated.
            descriptor = FomodInstallerService::analyze(
                projectDirectory,
                paths.gameDirectory,
                paths.modsDirectory,
                packageDirectory,
                identity,
                gameDataFolders,
                context.profileName,
                context.fingerprint);
            descriptor.fileDependencyStates.clear();
            descriptor.fileDependencyStates.reserve(context.fileStates.size());
            for (const FomodProfileFileState& state : context.fileStates)
            {
                descriptor.fileDependencyStates.push_back(FomodFileDependencyState{
                    state.file,
                    FomodProfileContextService::stateName(state.state),
                    state.sourceKind,
                    state.sourceName,
                    state.exists
                });
            }
            FomodAutoSelection selection = FomodAutoSelectionService::analyze(
                descriptor,
                context,
                manualDecisions);

            std::map<std::wstring, std::size_t> reasonCounts;
            for (const FomodOptionDecision& decision : selection.decisions)
            {
                for (const std::wstring& reason : decision.reasonCodes)
                {
                    ++reasonCounts[reason];
                }
            }
            std::ostringstream reasons;
            bool firstReason = true;
            for (const auto& [reason, count] : reasonCounts)
            {
                if (!firstReason)
                {
                    reasons << ',';
                }
                firstReason = false;
                reasons << toUtf8(reason) << ':' << count;
            }
            const auto finishedAt = std::chrono::steady_clock::now();
            logger.writeOperation(
                LogLevel::Info,
                "FomodAutoSelect",
                "FOMOD smart selection completed profile=\"" + toUtf8(context.profileName) +
                    "\", dependencies=" + std::to_string(context.fileStates.size()) +
                    ", selected=" + std::to_string(selection.initialSelectedOptionIds.size()) +
                    ", unresolved=" + std::to_string(selection.unresolvedGroups.size()) +
                    ", profileMs=" + std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(
                        profileFinishedAt - profileStartedAt).count()) +
                    ", totalMs=" + std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(
                        finishedAt - startedAt).count()) +
                    ", reasons=\"" + reasons.str() + "\".");

            descriptor.profileContext = std::make_shared<FomodProfileContext>(std::move(context));
            descriptor.autoSelection = std::make_shared<FomodAutoSelection>(std::move(selection));
            return descriptor;
        }

        [[nodiscard]] PlacementPlan analyzeContentLayoutForStaging(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& stagingDirectory,
            ExistingModInstallMode existingModMode,
            bool hasFomodOutput,
            std::wstring archiveContentHash,
            const std::vector<PlacementOverride>& placementOverrides,
            Logger& logger)
        {
            const std::wstring gameId = InstanceMetadataStore::gameId(projectDirectory);
            if (gameId.empty())
            {
                throw std::invalid_argument("Project does not have a selected game for content layout rules.");
            }

            const GameSupportRegistry& registry = GameSupportRegistry::embedded();
            const GameSupportLookupResult lookup = registry.lookupById(gameId);
            if (!lookup.supported || lookup.support == nullptr || lookup.definition == nullptr)
            {
                throw std::invalid_argument("Selected game is not supported by Fluxora content layout rules.");
            }

            const GameSupportComponents& components = lookup.support->components();
            if (components.contentLayoutRulesProvider == nullptr ||
                !lookup.support->capabilities().has(GameCapability::ContentLayoutRules))
            {
                throw std::invalid_argument("Selected game does not support content layout rules.");
            }

            ContentLayoutService layout;
            ContentLayoutAnalysisRequest request;
            request.selectedGameId = lookup.support->identity().id;
            request.selectedGameDisplayName = lookup.support->identity().displayName;
            request.selectedGameCapabilities = lookup.support->capabilities();
            request.rulesProvider = components.contentLayoutRulesProvider;
            request.installMode = contentLayoutInstallMode(existingModMode);
            request.hasFomodOutput = hasFomodOutput;
            request.archiveContentHash = std::move(archiveContentHash);
            request.gameDefinitionVersion = lookup.definition->definitionVersion;
            request.manualOverrides = placementOverrides;
            request.logger = &logger;

            const PlacementPlan plan = layout.analyzeDirectory(stagingDirectory, request);
            logContentLayoutPlan(logger, plan);
            return plan;
        }

        void applyContentLayoutToStaging(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& stagingDirectory,
            ExistingModInstallMode existingModMode,
            bool hasFomodOutput,
            std::wstring archiveContentHash,
            const std::vector<PlacementOverride>& placementOverrides,
            Logger& logger)
        {
            ContentLayoutService layout;
            const PlacementPlan plan = analyzeContentLayoutForStaging(
                projectDirectory,
                stagingDirectory,
                existingModMode,
                hasFomodOutput,
                std::move(archiveContentHash),
                placementOverrides,
                logger);
            if (!plan.canInstall())
            {
                throw std::invalid_argument(contentLayoutBlockerMessage(plan));
            }

            layout.applyPlanToDirectory(stagingDirectory, plan);
        }

        InstalledMod installedModFromRecord(
            const InstalledModRecord& record,
            std::wstring_view orderId = {},
            const ModFileSummary* summary = nullptr)
        {
            InstalledMod installed{
                record.path,
                record.displayName,
                record.version.empty() ? L"Unknown" : record.version,
                record.state == L"installed",
                record.source.latestVersion,
                record.sourceIsNexus,
                record.sourceIsModdingFlow,
                record.source.provider,
                record.source.gameDomain,
                record.source.remoteModId,
                record.source.remoteFileId,
                record.source.url,
                record.isLocal,
                record.isTranslation,
                record.isPatch,
                record.source.latestFileId,
                record.source.updateCheckState
            };
            installed.modUuid = record.uuid;
            installed.orderId = std::wstring(orderId);
            if (summary != nullptr)
            {
                installed.fileCount = summary->fileCount;
                installed.conflictingFileCount = summary->conflictingFileCount;
                installed.overwrittenFileCount = summary->overwrittenFileCount;
                installed.overwritingFileCount = summary->overwritingFileCount;
                installed.overwritesModIds = summary->overwritesModIds;
                installed.overwrittenByModIds = summary->overwrittenByModIds;
            }
            return installed;
        }

        class ArchiveUseGuard final
        {
        public:
            ArchiveUseGuard(std::wstring_view archiveSha256, bool wait)
            {
                if (archiveSha256.empty())
                {
                    throw std::invalid_argument("Archive SHA-256 identity is required.");
                }

#ifdef _WIN32
                const std::wstring mutexName =
                    L"Local\\Fluxora.ArchiveUse." + hashText(toLower(std::wstring(archiveSha256)));
                namedMutex_ = CreateMutexW(nullptr, FALSE, mutexName.c_str());
                if (namedMutex_ == nullptr)
                {
                    throw std::runtime_error("Failed to create the cross-process archive use lock.");
                }

                const DWORD waitResult = WaitForSingleObject(namedMutex_, wait ? INFINITE : 0);
                if (waitResult != WAIT_OBJECT_0 && waitResult != WAIT_ABANDONED)
                {
                    CloseHandle(namedMutex_);
                    namedMutex_ = nullptr;
                    if (!wait && waitResult == WAIT_TIMEOUT)
                    {
                        throw std::invalid_argument(
                            "Archive is currently downloading or installing in another build.");
                    }
                    throw std::runtime_error("Failed to acquire the cross-process archive use lock.");
                }
                acquired_ = true;
#else
                const std::wstring key = toLower(std::wstring(archiveSha256));
                {
                    const std::lock_guard lock(archiveUseFallbackMutexMapMutex);
                    localMutex_ = archiveUseFallbackMutexes[key].lock();
                    if (!localMutex_)
                    {
                        localMutex_ = std::make_shared<std::mutex>();
                        archiveUseFallbackMutexes[key] = localMutex_;
                    }
                }
                localLock_ = std::unique_lock<std::mutex>(*localMutex_, std::defer_lock);
                if (wait)
                {
                    localLock_.lock();
                }
                else if (!localLock_.try_lock())
                {
                    throw std::invalid_argument(
                        "Archive is currently downloading or installing in another build.");
                }
#endif
            }

            ArchiveUseGuard(const ArchiveUseGuard&) = delete;
            ArchiveUseGuard& operator=(const ArchiveUseGuard&) = delete;

            ~ArchiveUseGuard()
            {
#ifdef _WIN32
                if (namedMutex_ != nullptr)
                {
                    if (acquired_)
                    {
                        ReleaseMutex(namedMutex_);
                    }
                    CloseHandle(namedMutex_);
                }
#endif
            }

        private:
#ifdef _WIN32
            HANDLE namedMutex_{nullptr};
            bool acquired_{false};
#else
            std::shared_ptr<std::mutex> localMutex_;
            std::unique_lock<std::mutex> localLock_;
#endif
        };

        std::shared_ptr<std::mutex> duplicateLineageMutex(std::wstring_view lineageKey)
        {
            const std::wstring key = trim(std::wstring(lineageKey));
            if (key.empty())
            {
                throw std::invalid_argument("Nexus duplicate lineage key is missing.");
            }
            const std::lock_guard lock(duplicateLineageMutexMapMutex);
            std::shared_ptr<std::mutex> mutex = duplicateLineageMutexes[key].lock();
            if (!mutex)
            {
                mutex = std::make_shared<std::mutex>();
                duplicateLineageMutexes[key] = mutex;
            }
            return mutex;
        }

        class DuplicateLineageGuard final
        {
        public:
            explicit DuplicateLineageGuard(std::wstring_view lineageKey)
                : mutex_(duplicateLineageMutex(lineageKey)), lock_(*mutex_)
            {
            }

            DuplicateLineageGuard(const DuplicateLineageGuard&) = delete;
            DuplicateLineageGuard& operator=(const DuplicateLineageGuard&) = delete;

        private:
            std::shared_ptr<std::mutex> mutex_;
            std::unique_lock<std::mutex> lock_;
        };

        struct ValidatedDuplicateArchive
        {
            std::filesystem::path path;
            std::wstring sha256;
        };

        std::vector<ValidatedDuplicateArchive> validateDuplicateSnapshot(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& directory,
            const DownloadMetadata& pendingMetadata,
            const DownloadDuplicateDecision& decision,
            const ArchiveCatalogService& archiveCatalog)
        {
            if (decision.decisionId.empty() ||
                decision.lineageKey.empty() ||
                decision.existingFiles.empty() ||
                trim(decision.incomingFile.fileId) != trim(pendingMetadata.fileId))
            {
                throw std::invalid_argument("Duplicate decision snapshot is stale or incomplete.");
            }

            std::vector<ValidatedDuplicateArchive> archives;
            std::set<std::wstring> uniquePaths;
            for (const DownloadDuplicateFile& snapshot : decision.existingFiles)
            {
                const std::filesystem::path path(snapshot.id);
                if (path.empty() ||
                    !std::filesystem::exists(path) ||
                    !std::filesystem::is_regular_file(path) ||
                    !isPathInsideDirectory(path, directory) ||
                    !ArchiveCatalogService::isSupportedArchiveFile(path) ||
                    !uniquePaths.insert(normalizedPathText(path)).second)
                {
                    throw std::invalid_argument("Duplicate decision snapshot is stale.");
                }

                const DownloadMetadata current = readMetadata(path);
                if (toLower(trim(current.gameDomain)) != toLower(trim(pendingMetadata.gameDomain)) ||
                    trim(current.modId) != trim(pendingMetadata.modId) ||
                    trim(current.fileId) != trim(snapshot.fileId) ||
                    path.filename().wstring() != snapshot.fileName ||
                    trim(current.version) != trim(snapshot.version))
                {
                    throw std::invalid_argument("Duplicate decision snapshot is stale.");
                }

                const ArchiveCatalogEntry archive = archiveCatalog.identifyArchive(
                    projectDirectory,
                    path);
                if (snapshot.sha256.empty() ||
                    toLower(archive.sha256) != toLower(snapshot.sha256))
                {
                    throw std::invalid_argument("Duplicate decision snapshot is stale.");
                }
                archives.push_back({path, archive.sha256});
            }
            return archives;
        }

        std::vector<std::unique_ptr<ArchiveUseGuard>> lockDuplicateArchives(
            std::vector<ValidatedDuplicateArchive> archives)
        {
            std::sort(archives.begin(), archives.end(), [](const auto& left, const auto& right)
            {
                const std::wstring leftSha = toLower(left.sha256);
                const std::wstring rightSha = toLower(right.sha256);
                return leftSha == rightSha
                    ? normalizedPathText(left.path) < normalizedPathText(right.path)
                    : leftSha < rightSha;
            });

            std::vector<std::unique_ptr<ArchiveUseGuard>> guards;
            std::wstring previousSha;
            for (const ValidatedDuplicateArchive& archive : archives)
            {
                const std::wstring sha = toLower(archive.sha256);
                if (sha == previousSha)
                {
                    continue;
                }
                guards.push_back(std::make_unique<ArchiveUseGuard>(archive.sha256, true));
                previousSha = sha;
            }
            return guards;
        }

        void removeReplacedArchive(
            const std::filesystem::path& path,
            const ArchiveCatalogService& archiveCatalog)
        {
            std::error_code error;
            const bool removed = std::filesystem::remove(path, error);
            if (error || !removed)
            {
                throw std::runtime_error("An older Nexus archive could not be removed after replacement.");
            }
            std::filesystem::remove(metadataPath(path), error);
            removeDownloadProgressSidecar(path);
            std::filesystem::remove(cancelMarkerPath(path), error);
            std::filesystem::remove(AtomicFileStore::backupPathFor(path), error);
            std::filesystem::remove(AtomicFileStore::backupPathFor(metadataPath(path)), error);
            std::filesystem::remove(AtomicFileStore::backupPathFor(cancelMarkerPath(path)), error);
            archiveCatalog.removeArchiveSidecar(path);
        }

        class ArchiveInstallAttemptGuard final
        {
        public:
            ArchiveInstallAttemptGuard(
                std::filesystem::path projectDirectory,
                std::wstring_view archiveSha256,
                std::wstring_view targetFolderName)
                : archiveUse_(archiveSha256, true),
                  projectDirectory_(std::move(projectDirectory)),
                  archiveSha256_(archiveSha256)
            {
                const std::string propagatedOperationId = Logger::operationId();
                operationId_ = propagatedOperationId.empty()
                    ? L"archive-install-" + std::to_wstring(
                        std::chrono::steady_clock::now().time_since_epoch().count())
                    : fromUtf8(propagatedOperationId);
                InstanceMetadataStore::beginArchiveInstallAttempt(
                    projectDirectory_,
                    archiveSha256_,
                    operationId_,
                    targetFolderName);
                active_ = true;
            }

            ArchiveInstallAttemptGuard(const ArchiveInstallAttemptGuard&) = delete;
            ArchiveInstallAttemptGuard& operator=(const ArchiveInstallAttemptGuard&) = delete;

            ~ArchiveInstallAttemptGuard()
            {
                if (!active_)
                {
                    return;
                }
                try
                {
                    InstanceMetadataStore::failArchiveInstallAttempt(
                        projectDirectory_,
                        operationId_);
                }
                catch (...)
                {
                }
            }

            void commit() noexcept
            {
                active_ = false;
            }

            [[nodiscard]] const std::wstring& operationId() const noexcept
            {
                return operationId_;
            }

        private:
            ArchiveUseGuard archiveUse_;
            std::filesystem::path projectDirectory_;
            std::wstring archiveSha256_;
            std::wstring operationId_;
            bool active_{false};
        };

        InstallConflictPreviewMode conflictPreviewMode(ExistingModInstallMode mode)
        {
            switch (mode)
            {
            case ExistingModInstallMode::Replace:
                return InstallConflictPreviewMode::Replace;
            case ExistingModInstallMode::Merge:
                return InstallConflictPreviewMode::Merge;
            case ExistingModInstallMode::FailIfExists:
            default:
                return InstallConflictPreviewMode::Install;
            }
        }

        class PendingInstallConflictSessionGuard final
        {
        public:
            PendingInstallConflictSessionGuard(
                Logger& logger,
                std::filesystem::path projectDirectory,
                std::wstring operationId,
                std::wstring_view profileName,
                ExistingModInstallMode mode,
                std::wstring targetModUuid,
                int targetIndex,
                InstallConflictSnapshotCallback callback)
                : logger_(logger),
                  projectDirectory_(std::move(projectDirectory)),
                  operationId_(std::move(operationId)),
                  pendingOrderId_(L"pending-install:" + operationId_),
                  callback_(std::move(callback))
            {
                InstallConflictSessionStartRequest request;
                request.projectDirectory = projectDirectory_;
                request.operationId = operationId_;
                request.profileName = std::wstring(profileName);
                request.mode = conflictPreviewMode(mode);
                request.pendingOrderId = pendingOrderId_;
                request.targetModUuid = std::move(targetModUuid);
                request.targetIndex = targetIndex;
                InstallConflictPreviewService::beginSession(request);
                active_ = true;
                logger_.writeOperation(
                    LogLevel::Info,
                    "InstallConflictPreview",
                    "stage=preparing revision=0 targetIndex=" +
                        std::to_string(targetIndex) + ".");
            }

            PendingInstallConflictSessionGuard(const PendingInstallConflictSessionGuard&) = delete;
            PendingInstallConflictSessionGuard& operator=(const PendingInstallConflictSessionGuard&) = delete;

            ~PendingInstallConflictSessionGuard()
            {
                if (!active_)
                {
                    return;
                }
                try
                {
                    const FluxoraInstallConflictSnapshot failed =
                        InstallConflictPreviewService::failSession(
                            projectDirectory_,
                            operationId_);
                    if (callback_)
                    {
                        callback_(failed);
                    }
                }
                catch (...)
                {
                }
            }

            FluxoraInstallConflictSnapshot publish(
                const std::filesystem::path& finalStagingDirectory)
            {
                const auto startedAt = std::chrono::steady_clock::now();
                const std::vector<InstallConflictFile> inventory =
                    exactInstallFileInventory(finalStagingDirectory);
                FluxoraInstallConflictSnapshot snapshot =
                    InstallConflictPreviewService::publishExactInventory(
                        projectDirectory_,
                        operationId_,
                        inventory);
                int conflicts = 0;
                for (const InstallConflictRowPatch& row : snapshot.rows)
                {
                    conflicts += row.conflictingFileCount;
                }
                const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now() - startedAt);
                logger_.writeOperation(
                    LogLevel::Info,
                    "InstallConflictPreview",
                    "stage=ready revision=" + std::to_string(snapshot.revision) +
                        " durationMs=" + std::to_string(duration.count()) +
                        " files=" + std::to_string(inventory.size()) +
                        " conflicts=" + std::to_string(conflicts) + ".");
                if (callback_)
                {
                    callback_(snapshot);
                }
                return snapshot;
            }

            void completed(const FinalizedPendingInstallRecord& finalized)
            {
                const PendingInstallSessionRecord session =
                    InstanceMetadataStore::pendingInstallSession(
                        projectDirectory_,
                        operationId_);
                FluxoraInstallConflictSnapshot snapshot;
                snapshot.operationId = operationId_;
                snapshot.revision = session.revision;
                snapshot.state = InstallConflictSnapshotState::Completed;
                snapshot.pendingOrderId = pendingOrderId_;
                snapshot.orderId = finalized.orderId;
                snapshot.targetIndex = session.targetPosition;
                if (callback_)
                {
                    callback_(snapshot);
                }
                active_ = false;
                logger_.writeOperation(
                    LogLevel::Info,
                    "InstallConflictPreview",
                    "stage=completed revision=" + std::to_string(snapshot.revision) +
                        " files=" + std::to_string(finalized.summary.fileCount) +
                        " conflicts=" +
                        std::to_string(finalized.summary.conflictingFileCount) + ".");
            }

            [[nodiscard]] const std::wstring& operationId() const noexcept
            {
                return operationId_;
            }

        private:
            Logger& logger_;
            std::filesystem::path projectDirectory_;
            std::wstring operationId_;
            std::wstring pendingOrderId_;
            InstallConflictSnapshotCallback callback_;
            bool active_{false};
        };

        bool sameInstallName(std::wstring_view left, std::wstring_view right)
        {
            return toLower(trim(std::wstring(left))) == toLower(trim(std::wstring(right)));
        }

        bool copyFamilyMember(std::wstring_view candidate, std::wstring_view base)
        {
            if (sameInstallName(candidate, base))
            {
                return true;
            }
            const std::wstring value = trim(std::wstring(candidate));
            const std::wstring prefix = trim(std::wstring(base)) + L" (";
            if (value.size() <= prefix.size() + 1 ||
                toLower(value.substr(0, prefix.size())) != toLower(prefix) ||
                value.back() != L')')
            {
                return false;
            }
            return std::all_of(
                value.begin() + static_cast<std::ptrdiff_t>(prefix.size()),
                value.end() - 1,
                [](wchar_t character)
                {
                    return std::iswdigit(character) != 0;
                });
        }

        std::wstring copyFamilyBase(
            std::wstring_view requestedName,
            const std::vector<InstalledModRecord>& installed,
            const std::vector<std::wstring>& diskFolderNames)
        {
            const std::wstring requested = trim(std::wstring(requestedName));
            static const std::wregex suffix(LR"(^(.+) \((\d+)\)$)");
            std::wsmatch match;
            if (!std::regex_match(requested, match, suffix))
            {
                return requested;
            }

            const std::wstring possibleBase = trim(match[1].str());
            const bool hasInstalledSibling = std::any_of(
                installed.begin(),
                installed.end(),
                [&](const InstalledModRecord& record)
                {
                    return !sameInstallName(record.displayName, requested) &&
                        (copyFamilyMember(record.displayName, possibleBase) ||
                            copyFamilyMember(record.folderName, sanitizeFileName(possibleBase)));
                });
            const std::wstring requestedFolder = sanitizeFileName(requested);
            const std::wstring possibleBaseFolder = sanitizeFileName(possibleBase);
            const bool hasDiskSibling = std::any_of(
                diskFolderNames.begin(),
                diskFolderNames.end(),
                [&](const std::wstring& folderName)
                {
                    return !sameInstallName(folderName, requestedFolder) &&
                        copyFamilyMember(folderName, possibleBaseFolder);
                });
            return hasInstalledSibling || hasDiskSibling ? possibleBase : requested;
        }

        struct AllocatedInstallName
        {
            std::wstring displayName;
            std::wstring folderName;
        };

        AllocatedInstallName allocateFirstFreeInstallName(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory,
            std::wstring_view requestedName)
        {
            const std::vector<InstalledModRecord> installed =
                InstanceMetadataStore::listInstalledMods(projectDirectory, modsDirectory);
            std::vector<std::wstring> diskFolderNames;
            std::error_code iteratorError;
            if (std::filesystem::is_directory(modsDirectory, iteratorError) && !iteratorError)
            {
                for (std::filesystem::directory_iterator iterator(modsDirectory, iteratorError), end;
                     iterator != end;
                     iterator.increment(iteratorError))
                {
                    if (iteratorError)
                    {
                        iteratorError.clear();
                        continue;
                    }
                    diskFolderNames.push_back(iterator->path().filename().wstring());
                }
            }

            const std::wstring base = copyFamilyBase(requestedName, installed, diskFolderNames);
            if (base.empty())
            {
                throw std::invalid_argument("Mod name is required.");
            }

            std::set<std::wstring> occupiedDisplayNames;
            std::set<std::wstring> occupiedFolderNames;
            for (const InstalledModRecord& record : installed)
            {
                occupiedDisplayNames.insert(toLower(trim(record.displayName)));
                occupiedFolderNames.insert(toLower(trim(record.folderName)));
            }
            for (const std::wstring& folderName : diskFolderNames)
            {
                occupiedFolderNames.insert(toLower(trim(folderName)));
            }

            for (int index = 1;; ++index)
            {
                const std::wstring displayName = index == 1
                    ? base
                    : base + L" (" + std::to_wstring(index) + L")";
                const std::wstring folderName = sanitizeFileName(displayName);
                if (folderName.empty())
                {
                    continue;
                }
                if (!occupiedDisplayNames.contains(toLower(displayName)) &&
                    !occupiedFolderNames.contains(toLower(folderName)))
                {
                    return {displayName, folderName};
                }
            }
        }

        std::wstring installTargetModUuid(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory,
            std::wstring_view folderName,
            ExistingModInstallMode mode,
            const std::optional<ValidatedModIdentityInstall>& identity)
        {
            if (mode == ExistingModInstallMode::FailIfExists)
            {
                return {};
            }
            if (identity.has_value() && identity->matchedTarget.has_value())
            {
                return identity->matchedTarget->modUuid;
            }
            const std::wstring key = toLower(trim(std::wstring(folderName)));
            for (const InstalledModRecord& record :
                 InstanceMetadataStore::listInstalledMods(projectDirectory, modsDirectory))
            {
                if (toLower(trim(record.folderName)) == key)
                {
                    return record.uuid;
                }
            }
            return {};
        }

        ModIdentityPersistenceUpdate installIdentityUpdate(
            const ValidatedModIdentityInstall& identity,
            std::wstring_view displayName)
        {
            ModIdentityPersistenceUpdate update;
            update.fomodModuleId = identity.fomodModuleId;
            update.sourceProvider = identity.incomingSource.provider;
            update.sourceGameDomain = identity.incomingSource.game;
            update.sourceRemoteModId = identity.incomingSource.remoteModId;
            update.sourceRemoteFileId = identity.incomingSource.remoteFileId;
            if (identity.decision == InstallIdentityDecision::UseMatch &&
                !trim(identity.incomingName).empty() &&
                !sameInstallName(identity.incomingName, displayName))
            {
                update.confirmedAliases.push_back(identity.incomingName);
            }
            if (identity.rejectedTarget.has_value())
            {
                update.exclusionProvider = identity.incomingSource.provider;
                update.exclusionGameDomain = identity.incomingSource.game;
                update.exclusionRemoteModId = identity.incomingSource.remoteModId;
                update.exclusionIncomingName = identity.incomingName;
                update.rejectedModUuids.push_back(identity.rejectedTarget->modUuid);
            }
            return update;
        }

        InstalledMod installArchiveCore(
            Logger& logger,
            const BuildPathSettingsService& pathSettings,
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& archivePath,
            std::wstring_view archiveSha256,
            std::wstring_view modName,
            ExistingModInstallMode existingModMode,
            DownloadMetadata metadata,
            bool persistMetadata,
            const char* logKind,
            const std::vector<PlacementOverride>& placementOverrides,
            const ModIdentityInstallSelection* identitySelection,
            std::wstring_view profileName,
            int modOrderTargetIndex,
            const InstallConflictSnapshotCallback& conflictProgress)
        {
            const std::wstring archiveFingerprint = fileCacheFingerprint(archivePath);
            const std::wstring requestedName = trim(std::wstring(modName));
            std::wstring installName = requestedName.empty()
                ? metadata.nexusModName
                : requestedName;
            const std::wstring targetReservationKey =
                identitySelection != nullptr && !trim(identitySelection->targetModUuid).empty()
                    ? identitySelection->targetModUuid
                    : (!installName.empty() ? installName : archivePath.wstring());
            InstallTargetLock targetLock(projectDirectory, targetReservationKey);
            const BuildPathSettings paths = pathSettings.loadForProjectDirectory(projectDirectory);
            const std::filesystem::path modsDirectory = paths.modsDirectory;
            ExistingModInstallMode effectiveInstallMode = existingModMode;
            std::wstring safeName;
            {
                InstallProjectGate identityGate(projectDirectory);
                std::optional<ValidatedModIdentityInstall> validatedIdentity;
                if (identitySelection != nullptr)
                {
                    validatedIdentity = ModIdentityResolver::validateInstallPlan(
                        projectDirectory,
                        archiveFingerprint,
                        *identitySelection);
                }
                if (validatedIdentity.has_value() &&
                    validatedIdentity->decision == InstallIdentityDecision::UseMatch)
                {
                    if (!validatedIdentity->matchedTarget.has_value() ||
                        effectiveInstallMode == ExistingModInstallMode::FailIfExists)
                    {
                        throw std::invalid_argument("A matched mod requires replace or merge mode.");
                    }
                    installName = validatedIdentity->matchedTarget->displayName;
                    safeName = validatedIdentity->matchedTarget->folderName;
                }
                else if (validatedIdentity.has_value())
                {
                    effectiveInstallMode = ExistingModInstallMode::FailIfExists;
                    const AllocatedInstallName allocated = allocateFirstFreeInstallName(
                        projectDirectory,
                        modsDirectory,
                        installName);
                    installName = allocated.displayName;
                    safeName = allocated.folderName;
                }
                else
                {
                    safeName = sanitizeFileName(installName);
                }
            }
            if (safeName.empty())
            {
                throw std::invalid_argument("Mod name is required.");
            }

            std::optional<ValidatedModIdentityInstall> identity;
            if (identitySelection != nullptr)
            {
                identity = ModIdentityResolver::validateInstallPlan(
                    projectDirectory,
                    archiveFingerprint,
                    *identitySelection);
            }

            ArchiveInstallAttemptGuard archiveAttempt(
                projectDirectory,
                archiveSha256,
                safeName);

            const std::wstring selectedGameId = InstanceMetadataStore::gameId(projectDirectory);
            logger.writeOperation(
                LogLevel::Info,
                "ModInstall",
                std::string("installMod requested kind=\"") + logKind +
                    "\", selectedGameId=\"" + toUtf8(selectedGameId) +
                    "\", installMode=\"" + installModeName(effectiveInstallMode) +
                    "\", archivePath=\"" + toUtf8(archivePath.wstring()) +
                    "\", requestedName=\"" + toUtf8(requestedName) +
                    "\", allocatedDisplayName=\"" + toUtf8(installName) +
                    "\", safeName=\"" + toUtf8(safeName) +
                    "\", identityDecision=\"" +
                    (identity.has_value()
                        ? (identity->decision == InstallIdentityDecision::UseMatch ? "use-match" : "install-new")
                        : "legacy") +
                    "\", identityTargetUuid=\"" +
                    (identitySelection == nullptr ? std::string{} : toUtf8(identitySelection->targetModUuid)) +
                    "\", placementOverrideCount=" + std::to_string(placementOverrides.size()) +
                    ", source=\"" + toUtf8(metadata.source) +
                    "\", gameDomain=\"" + toUtf8(metadata.gameDomain) +
                    "\", modId=\"" + toUtf8(metadata.modId) +
                    "\", fileId=\"" + toUtf8(metadata.fileId) +
                    "\", versionResult=\"" +
                    (metadata.version.empty() ? std::string("metadata-unavailable") : toUtf8(metadata.version)) + "\".");

            const std::filesystem::path targetDirectory = modsDirectory / std::filesystem::path(safeName);
            const bool targetExists = std::filesystem::exists(targetDirectory);
            if (targetExists && effectiveInstallMode == ExistingModInstallMode::FailIfExists)
            {
                throw std::invalid_argument("Mod is already installed.");
            }
            if (targetExists &&
                effectiveInstallMode == ExistingModInstallMode::Merge &&
                !std::filesystem::is_directory(targetDirectory))
            {
                throw std::invalid_argument("Existing mod path is not a directory.");
            }

            const ExistingModInstallMode previewMode = targetExists
                ? effectiveInstallMode
                : ExistingModInstallMode::FailIfExists;
            PendingInstallConflictSessionGuard conflictSession(
                logger,
                projectDirectory,
                archiveAttempt.operationId(),
                profileName,
                previewMode,
                installTargetModUuid(
                    projectDirectory,
                    modsDirectory,
                    safeName,
                    previewMode,
                    identity),
                modOrderTargetIndex,
                conflictProgress);

            const PathSafetyService safety;
            safety.validateDirectoryWriteRoot(modsDirectory)
                .throwIfUnsafe("Mods directory is unsafe");
            safety.validateWritePath(modsDirectory, targetDirectory)
                .throwIfUnsafe("Installed mod target path is unsafe");
            std::filesystem::create_directories(modsDirectory);
            const std::filesystem::path stagingDirectory = uniquePath(modsDirectory, L"." + safeName + L".installing");
            safety.validateWritePath(modsDirectory, stagingDirectory)
                .throwIfUnsafe("Installed mod staging path is unsafe");
            std::filesystem::create_directories(stagingDirectory);

            std::wstring detectedVersion;
            std::filesystem::path finalStagingDirectory = stagingDirectory;
            InstalledDirectoryCommit directoryCommit;
            directoryCommit.attachJournal(logger, projectDirectory, archiveAttempt.operationId());
            std::unique_ptr<InstallProjectGate> commitGate;
            try
            {
                bool copiedFromCachedPayload = false;
                {
                    std::optional<InstallStagingCachePayloadLease> cachedPayload =
                        tryInstallStagingCachePayload(
                            paths.downloadsDirectory,
                            L"archive-staging",
                            archiveInstallStagingCacheKey(archivePath, effectiveInstallMode, safeName),
                            logger);
                    if (cachedPayload.has_value())
                    {
                        copyDirectoryContentsOverwriting(cachedPayload->payloadDirectory(), stagingDirectory);
                        copiedFromCachedPayload = true;
                    }
                }
                if (!copiedFromCachedPayload)
                {
                    materializeArchiveInstallCachePayload(archivePath, stagingDirectory, safeName, logger);
                }

                applyContentLayoutToStaging(
                    projectDirectory,
                    stagingDirectory,
                    effectiveInstallMode,
                    false,
                    archiveFingerprint,
                    placementOverrides,
                    logger);
                detectedVersion = detectInstalledModVersion(stagingDirectory, archivePath, metadata, safeName);
                if (identitySelection != nullptr)
                {
                    identity = ModIdentityResolver::validateInstallPlan(
                        projectDirectory,
                        archiveFingerprint,
                        *identitySelection);
                }
                if (effectiveInstallMode == ExistingModInstallMode::Merge && targetExists)
                {
                    finalStagingDirectory = prepareFullMergeStaging(
                        stagingDirectory,
                        targetDirectory,
                        modsDirectory,
                        safeName);
                }
                commitGate = std::make_unique<InstallProjectGate>(projectDirectory);
                if (fileCacheFingerprint(archivePath) != archiveFingerprint)
                {
                    throw std::runtime_error(
                        "The archive changed while the install was being prepared.");
                }
                if (identitySelection != nullptr)
                {
                    identity = ModIdentityResolver::validateInstallPlan(
                        projectDirectory,
                        archiveFingerprint,
                        *identitySelection);
                }
                if (std::filesystem::exists(targetDirectory) != targetExists)
                {
                    throw std::runtime_error(
                        "The install target changed while files were being prepared.");
                }
                static_cast<void>(conflictSession.publish(finalStagingDirectory));
                directoryCommit.promote(
                    finalStagingDirectory,
                    targetDirectory,
                    modsDirectory,
                    safeName);
                switch (effectiveInstallMode)
                {
                case ExistingModInstallMode::Replace:
                    logger.write(LogLevel::Info, "Installed archive by replacing existing mod: " + toUtf8(safeName));
                    break;
                case ExistingModInstallMode::Merge:
                    if (targetExists)
                    {
                        logger.write(LogLevel::Info, "Installed archive by merging into existing mod: " + toUtf8(safeName));
                    }
                    else
                    {
                        logger.write(LogLevel::Info, "Installed archive with merge mode into new mod: " + toUtf8(safeName));
                    }
                    break;
                case ExistingModInstallMode::FailIfExists:
                default:
                    logger.write(LogLevel::Info, "Installed archive as new mod: " + toUtf8(safeName));
                    break;
                }
            }
            catch (const std::exception& exception)
            {
                logger.writeOperation(
                    LogLevel::Error,
                    "ModInstall",
                    std::string("installMod failed kind=\"") + logKind +
                    "\", selectedGameId=\"" + toUtf8(selectedGameId) +
                    "\", safeName=\"" + toUtf8(safeName) +
                    "\", placementOverrideCount=" + std::to_string(placementOverrides.size()) +
                    ", stagingDirectory=\"" + toUtf8(stagingDirectory.wstring()) +
                        "\", reason=\"" + exception.what() + "\".");
                std::filesystem::remove_all(stagingDirectory);
                if (finalStagingDirectory != stagingDirectory)
                {
                    std::filesystem::remove_all(finalStagingDirectory);
                }
                throw;
            }

            metadata.version = detectedVersion;
            if (metadata.latestVersion.empty())
            {
                metadata.latestVersion = detectedVersion;
            }
            if (persistMetadata)
            {
                writeMetadata(archivePath, metadata);
            }

            const ModSourceRecord source{
                !metadata.gameDomain.empty() ? L"nexus" : (metadata.source.empty() ? L"local" : L"manual"),
                metadata.gameDomain,
                metadata.modId,
                metadata.fileId,
                metadata.source.empty() ? archivePath.wstring() : metadata.source,
                {},
                metadata.latestVersion
            };
            PendingInstallFinalizationMetadata finalizationMetadata;
            finalizationMetadata.archiveSha256 = std::wstring(archiveSha256);
            finalizationMetadata.mergeArchiveLink =
                effectiveInstallMode == ExistingModInstallMode::Merge && targetExists;
            if (identity.has_value())
            {
                finalizationMetadata.identity = installIdentityUpdate(*identity, installName);
            }
            const auto finalizationStartedAt = std::chrono::steady_clock::now();
            FinalizedPendingInstallRecord finalized =
                InstanceMetadataStore::finalizePendingInstalledMod(
                projectDirectory,
                conflictSession.operationId(),
                targetDirectory,
                installName,
                detectedVersion,
                source,
                finalizationMetadata);
            const auto finalizationDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - finalizationStartedAt);
            logger.writeOperation(
                LogLevel::Info,
                "InstallFinalization",
                std::string("durationMs=") + std::to_string(finalizationDuration.count()) +
                    ", fileCount=" + std::to_string(finalized.summary.fileCount) +
                    ", conflictCount=" +
                    std::to_string(finalized.summary.conflictingFileCount) + ".");
            InstalledModRecord record = finalized.mod;
            archiveAttempt.commit();
            conflictSession.completed(finalized);
            directoryCommit.commit();
            const std::chrono::milliseconds commitWait = commitGate == nullptr
                ? std::chrono::milliseconds{0}
                : commitGate->waitDuration();
            commitGate.reset();

            logger.writeOperation(
                LogLevel::Info,
                "ModInstall",
                std::string("installMod completed kind=\"") + logKind +
                    "\", selectedGameId=\"" + toUtf8(selectedGameId) +
                    "\", displayName=\"" + toUtf8(installName) +
                    "\", safeName=\"" + toUtf8(safeName) +
                    "\", targetDirectory=\"" + toUtf8(targetDirectory.wstring()) +
                    "\", modUuid=\"" + toUtf8(record.uuid) +
                    "\", installMode=\"" + installModeName(effectiveInstallMode) +
                    "\", targetWaitMs=" + std::to_string(targetLock.waitDuration().count()) +
                    ", commitWaitMs=" + std::to_string(commitWait.count()) +
                    ", placementOverrideCount=" + std::to_string(placementOverrides.size()) +
                    ", versionResult=\"" +
                    (detectedVersion.empty() ? std::string("unknown") : toUtf8(detectedVersion)) + "\".");

            return installedModFromRecord(record, finalized.orderId, &finalized.summary);
        }

        InstalledMod installFomodArchiveCore(
            Logger& logger,
            const BuildPathSettingsService& pathSettings,
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& archivePath,
            std::wstring_view archiveSha256,
            std::wstring_view modName,
            ExistingModInstallMode existingModMode,
            const std::vector<std::wstring>& selectedOptionIds,
            DownloadMetadata metadata,
            bool persistMetadata,
            const char* logKind,
            const std::vector<PlacementOverride>& placementOverrides,
            const ModIdentityInstallSelection* identitySelection,
            std::wstring_view profileName,
            std::wstring_view fomodContextId,
            const std::vector<FomodManualDecision>& manualDecisions,
            int modOrderTargetIndex,
            const InstallConflictSnapshotCallback& conflictProgress)
        {
            const std::wstring archiveFingerprint = fileCacheFingerprint(archivePath);
            const std::wstring fomodContextFingerprint = fomodContextArchiveFingerprint(archivePath);
            const BuildPathSettings paths = pathSettings.loadForProjectDirectory(projectDirectory);
            const auto validateFomodContext = [&]()
            {
                if (trim(std::wstring(fomodContextId)).empty())
                {
                    return;
                }
                const FomodProfileContext currentContext = FomodProfileContextService::build(
                    FomodProfileContextRequest{
                        projectDirectory,
                        paths.gameDirectory,
                        paths.modsDirectory,
                        paths.profilesDirectory,
                        std::wstring(profileName),
                        fomodGameDataFoldersForProject(projectDirectory),
                        {}
                    });
                FomodAutoSelectionService::validateContext(
                    projectDirectory,
                    fomodContextFingerprint,
                    fomodContextId,
                    currentContext);
            };
            validateFomodContext();
            const std::wstring requestedName = trim(std::wstring(modName));
            std::wstring installName = requestedName.empty()
                ? metadata.nexusModName
                : requestedName;
            const std::wstring targetReservationKey =
                identitySelection != nullptr && !trim(identitySelection->targetModUuid).empty()
                    ? identitySelection->targetModUuid
                    : (!installName.empty() ? installName : archivePath.wstring());
            InstallTargetLock targetLock(projectDirectory, targetReservationKey);
            const std::filesystem::path modsDirectory = paths.modsDirectory;
            ExistingModInstallMode effectiveInstallMode = existingModMode;
            std::wstring safeName;
            {
                InstallProjectGate identityGate(projectDirectory);
                std::optional<ValidatedModIdentityInstall> validatedIdentity;
                if (identitySelection != nullptr)
                {
                    validatedIdentity = ModIdentityResolver::validateInstallPlan(
                        projectDirectory,
                        archiveFingerprint,
                        *identitySelection);
                }
                if (validatedIdentity.has_value() &&
                    validatedIdentity->decision == InstallIdentityDecision::UseMatch)
                {
                    if (!validatedIdentity->matchedTarget.has_value() ||
                        effectiveInstallMode == ExistingModInstallMode::FailIfExists)
                    {
                        throw std::invalid_argument("A matched mod requires replace or merge mode.");
                    }
                    installName = validatedIdentity->matchedTarget->displayName;
                    safeName = validatedIdentity->matchedTarget->folderName;
                }
                else if (validatedIdentity.has_value())
                {
                    effectiveInstallMode = ExistingModInstallMode::FailIfExists;
                    const AllocatedInstallName allocated = allocateFirstFreeInstallName(
                        projectDirectory,
                        modsDirectory,
                        installName);
                    installName = allocated.displayName;
                    safeName = allocated.folderName;
                }
                else
                {
                    safeName = sanitizeFileName(installName);
                }
            }
            if (safeName.empty())
            {
                throw std::invalid_argument("Mod name is required.");
            }

            std::optional<ValidatedModIdentityInstall> identity;
            if (identitySelection != nullptr)
            {
                identity = ModIdentityResolver::validateInstallPlan(
                    projectDirectory,
                    archiveFingerprint,
                    *identitySelection);
            }

            ArchiveInstallAttemptGuard archiveAttempt(
                projectDirectory,
                archiveSha256,
                safeName);

            const std::wstring selectedGameId = InstanceMetadataStore::gameId(projectDirectory);
            logger.writeOperation(
                LogLevel::Info,
                "ModInstall",
                std::string("installMod requested kind=\"") + logKind +
                    "\", selectedGameId=\"" + toUtf8(selectedGameId) +
                    "\", installMode=\"" + installModeName(effectiveInstallMode) +
                    "\", archivePath=\"" + toUtf8(archivePath.wstring()) +
                    "\", requestedName=\"" + toUtf8(requestedName) +
                    "\", allocatedDisplayName=\"" + toUtf8(installName) +
                    "\", safeName=\"" + toUtf8(safeName) +
                    "\", identityDecision=\"" +
                    (identity.has_value()
                        ? (identity->decision == InstallIdentityDecision::UseMatch ? "use-match" : "install-new")
                        : "legacy") +
                    "\", identityTargetUuid=\"" +
                    (identitySelection == nullptr ? std::string{} : toUtf8(identitySelection->targetModUuid)) +
                    "\", source=\"" + toUtf8(metadata.source) +
                    "\", gameDomain=\"" + toUtf8(metadata.gameDomain) +
                    "\", modId=\"" + toUtf8(metadata.modId) +
                    "\", fileId=\"" + toUtf8(metadata.fileId) +
                    "\", selectedOptionCount=" + std::to_string(selectedOptionIds.size()) +
                    ", placementOverrideCount=" + std::to_string(placementOverrides.size()) +
                    ", versionResult=\"" +
                    (metadata.version.empty() ? std::string("metadata-unavailable") : toUtf8(metadata.version)) + "\".");

            const std::filesystem::path targetDirectory = modsDirectory / std::filesystem::path(safeName);
            const bool targetExists = std::filesystem::exists(targetDirectory);
            if (targetExists && effectiveInstallMode == ExistingModInstallMode::FailIfExists)
            {
                throw std::invalid_argument("Mod is already installed.");
            }
            if (targetExists &&
                effectiveInstallMode == ExistingModInstallMode::Merge &&
                !std::filesystem::is_directory(targetDirectory))
            {
                throw std::invalid_argument("Existing mod path is not a directory.");
            }

            const PathSafetyService safety;
            safety.validateDirectoryWriteRoot(modsDirectory)
                .throwIfUnsafe("Mods directory is unsafe");
            safety.validateWritePath(modsDirectory, targetDirectory)
                .throwIfUnsafe("Installed FOMOD target path is unsafe");
            const ExistingModInstallMode previewMode = targetExists
                ? effectiveInstallMode
                : ExistingModInstallMode::FailIfExists;
            PendingInstallConflictSessionGuard conflictSession(
                logger,
                projectDirectory,
                archiveAttempt.operationId(),
                profileName,
                previewMode,
                installTargetModUuid(
                    projectDirectory,
                    modsDirectory,
                    safeName,
                    previewMode,
                    identity),
                modOrderTargetIndex,
                conflictProgress);
            std::filesystem::create_directories(modsDirectory);
            const std::filesystem::path stagingDirectory = uniquePath(modsDirectory, L"." + safeName + L".installing");
            safety.validateWritePath(modsDirectory, stagingDirectory)
                .throwIfUnsafe("Installed FOMOD staging path is unsafe");
            std::filesystem::create_directories(stagingDirectory);

            std::wstring detectedVersion;
            std::filesystem::path packageDirectory;
            FomodInstallerDescriptor descriptor;
            std::vector<std::wstring> appliedOptionIds;
            std::filesystem::path finalStagingDirectory = stagingDirectory;
            InstalledDirectoryCommit directoryCommit;
            directoryCommit.attachJournal(logger, projectDirectory, archiveAttempt.operationId());
            std::unique_ptr<InstallProjectGate> commitGate;
            try
            {
                const FomodPackageIdentity packageIdentity{
                    !metadata.gameDomain.empty() ? L"nexus" : (metadata.source.empty() ? L"local" : L"manual"),
                    metadata.gameDomain,
                    metadata.modId,
                    metadata.fileId,
                    metadata.source.empty() ? archivePath.wstring() : metadata.source,
                    safeName
                };

                {
                    InstallStagingCachePayloadLease packagePayload = ensureInstallStagingCachePayload(
                        paths.downloadsDirectory,
                        L"fomod-package",
                        fomodPackageStagingCacheKey(archivePath),
                        logger,
                        [&](const std::filesystem::path& payloadDirectory)
                        {
                            if (!extractArchiveToDirectory(archivePath, payloadDirectory, logger))
                            {
                                throw std::invalid_argument("Download does not contain an XML FOMOD installer.");
                            }
                        });
                    packageDirectory = packagePayload.payloadDirectory();

                    descriptor = analyzeFomodForProfile(
                        logger,
                        projectDirectory,
                        paths,
                        packageDirectory,
                        packageIdentity,
                        fomodContextFingerprint,
                        profileName,
                        manualDecisions);
                    if (!descriptor.isFomod)
                    {
                        discardInstallStagingCachePayload(packagePayload, logger);
                        throw std::invalid_argument("Download does not contain an XML FOMOD installer.");
                    }
                    if (descriptor.autoSelection != nullptr && descriptor.autoSelection->installBlocked)
                    {
                        throw std::invalid_argument("FOMOD module dependencies are not satisfied.");
                    }

                    appliedOptionIds = FomodInstallerService::install(FomodInstallContext{
                        projectDirectory,
                        paths.gameDirectory,
                        paths.modsDirectory,
                        packageDirectory,
                        stagingDirectory,
                        packageIdentity,
                        selectedOptionIds,
                        fomodGameDataFoldersForProject(projectDirectory),
                        descriptor.profileContext.get()
                    });

                    detectedVersion = trim(descriptor.moduleVersion);
                    if (detectedVersion.empty())
                    {
                        detectedVersion = detectInstalledModVersion(packageDirectory, archivePath, metadata, safeName);
                    }
                }

                applyContentLayoutToStaging(
                    projectDirectory,
                    stagingDirectory,
                    effectiveInstallMode,
                    true,
                    fomodOutputCacheFingerprint(archivePath, selectedOptionIds),
                    placementOverrides,
                    logger);

                if (identitySelection != nullptr)
                {
                    identity = ModIdentityResolver::validateInstallPlan(
                        projectDirectory,
                        archiveFingerprint,
                        *identitySelection);
                }
                validateFomodContext();
                if (effectiveInstallMode == ExistingModInstallMode::Merge && targetExists)
                {
                    finalStagingDirectory = prepareFullMergeStaging(
                        stagingDirectory,
                        targetDirectory,
                        modsDirectory,
                        safeName);
                }
                commitGate = std::make_unique<InstallProjectGate>(projectDirectory);
                if (fileCacheFingerprint(archivePath) != archiveFingerprint)
                {
                    throw std::runtime_error(
                        "The archive changed while the FOMOD install was being prepared.");
                }
                if (identitySelection != nullptr)
                {
                    identity = ModIdentityResolver::validateInstallPlan(
                        projectDirectory,
                        archiveFingerprint,
                        *identitySelection);
                }
                validateFomodContext();
                if (std::filesystem::exists(targetDirectory) != targetExists)
                {
                    throw std::runtime_error(
                        "The FOMOD install target changed while files were being prepared.");
                }
                static_cast<void>(conflictSession.publish(finalStagingDirectory));
                directoryCommit.promote(
                    finalStagingDirectory,
                    targetDirectory,
                    modsDirectory,
                    safeName);
                switch (effectiveInstallMode)
                {
                case ExistingModInstallMode::Replace:
                    logger.write(LogLevel::Info, "Installed FOMOD by replacing existing mod: " + toUtf8(safeName));
                    break;
                case ExistingModInstallMode::Merge:
                    if (targetExists)
                    {
                        logger.write(LogLevel::Info, "Installed FOMOD by merging into existing mod: " + toUtf8(safeName));
                    }
                    else
                    {
                        logger.write(LogLevel::Info, "Installed FOMOD with merge mode into new mod: " + toUtf8(safeName));
                    }
                    break;
                case ExistingModInstallMode::FailIfExists:
                default:
                    logger.write(LogLevel::Info, "Installed FOMOD as new mod: " + toUtf8(safeName));
                    break;
                }

            }
            catch (const std::exception& exception)
            {
                logger.writeOperation(
                    LogLevel::Error,
                    "ModInstall",
                    std::string("installMod failed kind=\"") + logKind +
                        "\", selectedGameId=\"" + toUtf8(selectedGameId) +
                        "\", safeName=\"" + toUtf8(safeName) +
                        "\", packageDirectory=\"" + toUtf8(packageDirectory.wstring()) +
                        "\", stagingDirectory=\"" + toUtf8(stagingDirectory.wstring()) +
                        "\", appliedPluginRules=\"fomod options=" + std::to_string(appliedOptionIds.size()) +
                        "\", placementOverrideCount=" + std::to_string(placementOverrides.size()) +
                        ", reason=\"" + exception.what() + "\".");
                cleanupTemporaryDirectory(stagingDirectory, logger, "FOMOD");
                if (finalStagingDirectory != stagingDirectory)
                {
                    cleanupTemporaryDirectory(finalStagingDirectory, logger, "FOMOD merge");
                }
                throw;
            }

            metadata.version = detectedVersion;
            if (metadata.latestVersion.empty())
            {
                metadata.latestVersion = detectedVersion;
            }
            if (persistMetadata)
            {
                writeMetadata(archivePath, metadata);
            }

            const ModSourceRecord source{
                !metadata.gameDomain.empty() ? L"nexus" : (metadata.source.empty() ? L"local" : L"manual"),
                metadata.gameDomain,
                metadata.modId,
                metadata.fileId,
                metadata.source.empty() ? archivePath.wstring() : metadata.source,
                {},
                metadata.latestVersion
            };
            PendingInstallFinalizationMetadata finalizationMetadata;
            finalizationMetadata.archiveSha256 = std::wstring(archiveSha256);
            finalizationMetadata.mergeArchiveLink =
                effectiveInstallMode == ExistingModInstallMode::Merge && targetExists;
            if (identity.has_value())
            {
                finalizationMetadata.identity = installIdentityUpdate(*identity, installName);
            }
            const auto finalizationStartedAt = std::chrono::steady_clock::now();
            FinalizedPendingInstallRecord finalized =
                InstanceMetadataStore::finalizePendingInstalledMod(
                projectDirectory,
                conflictSession.operationId(),
                targetDirectory,
                installName,
                detectedVersion,
                source,
                finalizationMetadata);
            const auto finalizationDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - finalizationStartedAt);
            logger.writeOperation(
                LogLevel::Info,
                "InstallFinalization",
                std::string("durationMs=") + std::to_string(finalizationDuration.count()) +
                    ", fileCount=" + std::to_string(finalized.summary.fileCount) +
                    ", conflictCount=" +
                    std::to_string(finalized.summary.conflictingFileCount) + ".");
            InstalledModRecord record = finalized.mod;
            archiveAttempt.commit();
            conflictSession.completed(finalized);
            directoryCommit.commit();
            const std::chrono::milliseconds commitWait = commitGate == nullptr
                ? std::chrono::milliseconds{0}
                : commitGate->waitDuration();
            commitGate.reset();

            try
            {
                std::vector<FomodRememberedManualDecision> rememberedManualDecisions;
                rememberedManualDecisions.reserve(manualDecisions.size());
                for (const FomodManualDecision& decision : manualDecisions)
                {
                    rememberedManualDecisions.push_back(FomodRememberedManualDecision{
                        decision.optionId,
                        decision.selected
                    });
                }
                if (trim(std::wstring(profileName)).empty() &&
                    trim(std::wstring(fomodContextId)).empty() && manualDecisions.empty())
                {
                    FomodInstallerService::rememberSelection(
                        projectDirectory,
                        descriptor,
                        appliedOptionIds);
                }
                else
                {
                    FomodInstallerService::rememberSelection(
                        projectDirectory,
                        descriptor,
                        appliedOptionIds,
                        descriptor.profileContext == nullptr
                            ? std::wstring_view(profileName)
                            : std::wstring_view(descriptor.profileContext->profileName),
                        descriptor.profileContext == nullptr
                            ? std::wstring_view{}
                            : std::wstring_view(descriptor.profileContext->fingerprint),
                        rememberedManualDecisions);
                }
            }
            catch (const std::exception& exception)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "FomodMemory",
                    std::string("Installed FOMOD, but selection memory was not updated: ") +
                        exception.what());
            }

            logger.writeOperation(
                LogLevel::Info,
                "ModInstall",
                std::string("installMod completed kind=\"") + logKind +
                    "\", selectedGameId=\"" + toUtf8(selectedGameId) +
                    "\", displayName=\"" + toUtf8(installName) +
                    "\", safeName=\"" + toUtf8(safeName) +
                    "\", targetDirectory=\"" + toUtf8(targetDirectory.wstring()) +
                    "\", modUuid=\"" + toUtf8(record.uuid) +
                    "\", installMode=\"" + installModeName(effectiveInstallMode) +
                    "\", targetWaitMs=" + std::to_string(targetLock.waitDuration().count()) +
                    ", commitWaitMs=" + std::to_string(commitWait.count()) +
                    ", appliedPluginRules=\"fomod options=" + std::to_string(appliedOptionIds.size()) +
                    "\", versionResult=\"" +
                    (detectedVersion.empty() ? std::string("unknown") : toUtf8(detectedVersion)) + "\".");

            return installedModFromRecord(record, finalized.orderId, &finalized.summary);
        }

        [[nodiscard]] std::wstring jsonIdentifier(const JsonValue* value)
        {
            if (value == nullptr)
            {
                return {};
            }
            if (value->isString())
            {
                return trim(value->asString());
            }
            if (value->isNumber())
            {
                return trim(value->asNumber());
            }
            return {};
        }

        [[nodiscard]] bool isPositiveDecimalIdentifier(std::wstring_view value)
        {
            bool hasNonZeroDigit = false;
            if (value.empty())
            {
                return false;
            }
            for (const wchar_t character : value)
            {
                if (character < L'0' || character > L'9')
                {
                    return false;
                }
                hasNonZeroDigit = hasNonZeroDigit || character != L'0';
            }
            return hasNonZeroDigit;
        }

        [[nodiscard]] bool nexusFileSizeMatches(
            const JsonValue& fileDetails,
            std::uintmax_t expectedArchiveSizeBytes)
        {
            const JsonValue* sizeValue = fileDetails.find(L"size");
            if (sizeValue == nullptr)
            {
                sizeValue = fileDetails.find(L"size_kb");
            }

            const std::wstring serializedSize = jsonIdentifier(sizeValue);
            if (serializedSize.empty())
            {
                return false;
            }

            try
            {
                std::size_t parsedCharacters = 0;
                const long double reportedKilobytes = std::stold(serializedSize, &parsedCharacters);
                if (parsedCharacters != serializedSize.size() ||
                    !std::isfinite(reportedKilobytes) || reportedKilobytes < 0.0L)
                {
                    return false;
                }

                const long double expectedKilobytes =
                    static_cast<long double>(expectedArchiveSizeBytes) / 1024.0L;
                // Nexus exposes this value in kilobytes and deployments have
                // historically rounded it. Keep the comparison within one KB.
                return std::fabs(reportedKilobytes - expectedKilobytes) <= 1.0L;
            }
            catch (const std::exception&)
            {
                return false;
            }
        }

        [[nodiscard]] std::optional<NexusMd5Identity> parseUniqueNexusMd5Identity(
            std::wstring_view payloadJson,
            std::wstring_view expectedGameDomain,
            std::uintmax_t expectedArchiveSizeBytes)
        {
            const std::wstring normalizedExpectedDomain =
                toLower(trim(std::wstring(expectedGameDomain)));
            if (normalizedExpectedDomain.empty())
            {
                return std::nullopt;
            }

            const JsonValue root = JsonReader::parse(payloadJson);
            if (!root.isArray())
            {
                return std::nullopt;
            }

            std::optional<NexusMd5Identity> result;
            for (const JsonValue& item : root.asArray())
            {
                if (!item.isObject())
                {
                    continue;
                }
                const JsonValue* mod = item.find(L"mod");
                const JsonValue* fileDetails = item.find(L"file_details");
                if (mod == nullptr || !mod->isObject() ||
                    fileDetails == nullptr || !fileDetails->isObject())
                {
                    continue;
                }

                NexusMd5Identity candidate;
                candidate.gameDomain = toLower(jsonIdentifier(mod->find(L"domain_name")));
                candidate.modId = jsonIdentifier(mod->find(L"mod_id"));
                candidate.fileId = jsonIdentifier(fileDetails->find(L"file_id"));
                if (const JsonValue* name = mod->find(L"name");
                    name != nullptr && name->isString())
                {
                    candidate.modName = trim(name->asString());
                }

                if (candidate.gameDomain != normalizedExpectedDomain ||
                    !isPositiveDecimalIdentifier(candidate.modId) ||
                    !isPositiveDecimalIdentifier(candidate.fileId) ||
                    !nexusFileSizeMatches(*fileDetails, expectedArchiveSizeBytes))
                {
                    continue;
                }
                if (result.has_value())
                {
                    return std::nullopt;
                }
                result = std::move(candidate);
            }
            return result;
        }

        [[nodiscard]] std::wstring nexusGameDomainForProject(
            const std::filesystem::path& projectDirectory,
            std::wstring_view preferredDomain)
        {
            if (const std::wstring preferred = toLower(trim(std::wstring(preferredDomain)));
                !preferred.empty())
            {
                return preferred;
            }

            try
            {
                const std::wstring gameId = InstanceMetadataStore::gameId(projectDirectory);
                const GameSupportLookupResult lookup =
                    GameSupportRegistry::embedded().lookupById(gameId);
                if (lookup.supported && lookup.support != nullptr &&
                    !lookup.support->identity().domains.empty())
                {
                    return toLower(trim(lookup.support->identity().domains.front()));
                }
            }
            catch (const std::exception&)
            {
            }
            return {};
        }

        [[nodiscard]] std::optional<NexusMd5Identity> tryResolveNexusMd5Identity(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& archivePath,
            std::wstring_view preferredGameDomain,
            NexusModsAuthService* nexusAuth,
            Logger& logger)
        {
#ifndef _WIN32
            (void)projectDirectory;
            (void)archivePath;
            (void)preferredGameDomain;
            (void)nexusAuth;
            (void)logger;
            return std::nullopt;
#else
            if (nexusAuth == nullptr)
            {
                return std::nullopt;
            }

            const auto lookupStartedAt = std::chrono::steady_clock::now();

            try
            {
                const std::wstring gameDomain =
                    nexusGameDomainForProject(projectDirectory, preferredGameDomain);
                const NexusModsApiAuthHeader auth = nexusAuth->apiAuthHeader();
                if (gameDomain.empty() || !auth.isAvailable ||
                    auth.headerName.empty() || auth.headerValue.empty())
                {
                    return std::nullopt;
                }

                const FileContentDigests digests =
                    cachedRegularFileContentDigests(archivePath);
                if (digests.md5.empty())
                {
                    return std::nullopt;
                }
                const std::wstring md5(digests.md5.begin(), digests.md5.end());
                const std::wstring sha256(digests.sha256.begin(), digests.sha256.end());
                const std::wstring endpoint =
                    L"https://api.nexusmods.com/v1/games/" + percentEncode(gameDomain) +
                    L"/mods/md5_search/" + percentEncode(md5);
                const std::wstring authHeader =
                    auth.headerName + L": " + auth.headerValue + L"\r\n";
                std::error_code sizeError;
                const std::uintmax_t archiveSize =
                    std::filesystem::file_size(archivePath, sizeError);
                if (sizeError)
                {
                    return std::nullopt;
                }
                const std::wstring archiveFingerprint = fileCacheFingerprint(archivePath);
                try
                {
                    if (const std::optional<ModIdentityOnlineCacheRecord> cached =
                            InstanceMetadataStore::modIdentityOnlineCache(
                                projectDirectory,
                                archiveFingerprint,
                                L"nexus",
                                gameDomain,
                                md5,
                                sha256,
                                archiveSize);
                        cached.has_value())
                    {
                        logger.write(
                            LogLevel::Info,
                            std::string("Mod identity Nexus MD5 lookup completed. game=\"") +
                                toUtf8(gameDomain) + "\", result=\"cache-hit\", durationMs=" +
                                std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(
                                    std::chrono::steady_clock::now() - lookupStartedAt).count()) + ".");
                        return NexusMd5Identity{
                            cached->gameDomain,
                            cached->remoteModId,
                            cached->remoteFileId,
                            cached->modName
                        };
                    }
                }
                catch (const std::exception&)
                {
                    logger.write(
                        LogLevel::Info,
                        "Mod identity online cache was unavailable; Nexus lookup continues.");
                }
                const std::optional<NexusMd5Identity> identity =
                    parseUniqueNexusMd5Identity(
                        fromUtf8(winHttpGet(endpoint, authHeader, 5'000)),
                        gameDomain,
                        archiveSize);
                if (identity.has_value())
                {
                    try
                    {
                        InstanceMetadataStore::recordModIdentityOnlineCache(
                            projectDirectory,
                            archiveFingerprint,
                            ModIdentityOnlineCacheRecord{
                                L"nexus",
                                identity->gameDomain,
                                identity->modId,
                                identity->fileId,
                                identity->modName,
                                md5,
                                sha256,
                                archiveSize,
                                nowUtcText()
                            });
                    }
                    catch (const std::exception&)
                    {
                        logger.write(
                            LogLevel::Info,
                            "Mod identity online cache write was unavailable; install planning continues.");
                    }
                }
                logger.write(
                    LogLevel::Info,
                    std::string("Mod identity Nexus MD5 lookup completed. game=\"") +
                        toUtf8(gameDomain) + "\", result=\"" +
                        (identity.has_value() ? "unique" : "none-or-ambiguous") +
                        "\", durationMs=" +
                        std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::steady_clock::now() - lookupStartedAt).count()) + ".");
                return identity;
            }
            catch (const std::exception&)
            {
                logger.write(
                    LogLevel::Info,
                    "Mod identity Nexus MD5 lookup was unavailable; local identity resolution continues. "
                    "durationMs=" +
                        std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::steady_clock::now() - lookupStartedAt).count()) + ".");
                return std::nullopt;
            }
#endif
        }

        std::wstring fetchNexusModName(
            const NxmDownloadRequest& request,
            std::wstring_view authHeader)
        {
            if (request.gameDomain.empty() || request.modId.empty())
            {
                return {};
            }

#ifndef _WIN32
            (void)authHeader;
            return {};
#else
            try
            {
                if (authHeader.empty())
                {
                    return {};
                }

                const std::wstring endpoint =
                    L"https://api.nexusmods.com/v1/games/" + percentEncode(request.gameDomain) +
                    L"/mods/" + percentEncode(request.modId) +
                    L".json";
                const JsonValue root = JsonReader::parse(fromUtf8(winHttpGet(endpoint, authHeader)));
                if (!root.isObject())
                {
                    return {};
                }

                for (const wchar_t* key : {L"name", L"Name", L"modName", L"mod_name"})
                {
                    if (const JsonValue* value = root.find(key); value != nullptr && value->isString())
                    {
                        return trim(value->asString());
                    }
                }
            }
            catch (const std::exception&)
            {
                return {};
            }

            return {};
#endif
        }

        NexusFileInfo parseNexusFileInfoPayload(std::wstring_view payloadJson)
        {
            NexusFileInfo info;
            info.payloadJson = std::wstring(payloadJson);
            const JsonValue root = JsonReader::parse(info.payloadJson);
            if (!root.isObject())
            {
                return {};
            }

            for (const wchar_t* key : {L"version", L"Version", L"mod_version", L"file_version", L"fileVersion"})
            {
                if (const JsonValue* value = root.find(key); value != nullptr && value->isString())
                {
                    info.version = trim(value->asString());
                    if (!info.version.empty())
                    {
                        break;
                    }
                }
            }

            for (const wchar_t* key : {L"name", L"Name"})
            {
                if (const JsonValue* value = root.find(key); value != nullptr && value->isString())
                {
                    info.displayName = trim(value->asString());
                    if (!info.displayName.empty())
                    {
                        break;
                    }
                }
            }

            for (const wchar_t* key : {L"file_name", L"fileName", L"filename", L"file"})
            {
                if (const JsonValue* value = root.find(key); value != nullptr && value->isString())
                {
                    info.fileName = trim(value->asString());
                    if (!info.fileName.empty())
                    {
                        break;
                    }
                }
            }

            return info;
        }

        std::wstring nexusDisplayArchiveFileName(
            std::wstring_view displayName,
            std::wstring_view downloadedFileName)
        {
            const std::wstring cleanDisplayName = trim(std::wstring(displayName));
            if (cleanDisplayName.empty())
            {
                return {};
            }
            if (hasSupportedDownloadFileExtension(cleanDisplayName))
            {
                return sanitizeFileName(cleanDisplayName);
            }

            const std::wstring archiveExtension = archiveExtensionFromFileName(downloadedFileName);
            if (archiveExtension.empty() || !hasSupportedDownloadFileExtension(
                    L"download" + archiveExtension))
            {
                return {};
            }

            return sanitizeFileName(cleanDisplayName + archiveExtension);
        }

        NexusFileInfo fetchNexusFileInfo(
            const NxmDownloadRequest& request,
            std::wstring_view authHeader)
        {
            if (request.gameDomain.empty() || request.modId.empty() || request.fileId.empty())
            {
                return {};
            }

#ifndef _WIN32
            (void)authHeader;
            return {};
#else
            try
            {
                if (authHeader.empty())
                {
                    return {};
                }

                const std::wstring endpoint =
                    L"https://api.nexusmods.com/v1/games/" + percentEncode(request.gameDomain) +
                    L"/mods/" + percentEncode(request.modId) +
                    L"/files/" + percentEncode(request.fileId) +
                    L".json";
                return parseNexusFileInfoPayload(fromUtf8(winHttpGet(endpoint, authHeader)));
            }
            catch (const std::exception&)
            {
                return {};
            }
#endif
        }

        std::wstring resolveNexusDownloadUri(
            const NxmDownloadRequest& request,
            std::wstring_view authHeader)
        {
            if (request.gameDomain.empty() ||
                request.modId.empty() ||
                request.fileId.empty())
            {
                return {};
            }

#ifndef _WIN32
            throw std::runtime_error("Nexus downloads are currently implemented for Windows builds.");
#else
            std::wstring endpoint =
                L"https://api.nexusmods.com/v1/games/" + percentEncode(request.gameDomain) +
                L"/mods/" + percentEncode(request.modId) +
                L"/files/" + percentEncode(request.fileId) +
                L"/download_link.json";
            if (!request.key.empty() && !request.expires.empty())
            {
                endpoint += L"?key=" + percentEncode(request.key) +
                    L"&expires=" + percentEncode(request.expires);
            }

            if (authHeader.empty())
            {
                throw std::runtime_error("NexusMods authentication token is unavailable.");
            }

            const std::string body = winHttpGet(endpoint, authHeader);
            const JsonValue root = JsonReader::parse(fromUtf8(body));

            auto readUri = [](const JsonValue& value) -> std::wstring
            {
                if (!value.isObject())
                {
                    return {};
                }

                for (const std::wstring& key : {L"URI", L"uri", L"Url", L"url"})
                {
                    if (const JsonValue* uriValue = value.find(key); uriValue != nullptr && uriValue->isString())
                    {
                        return uriValue->asString();
                    }
                }

                return {};
            };

            if (root.isArray())
            {
                for (const JsonValue& item : root.asArray())
                {
                    if (std::wstring uri = readUri(item); !uri.empty())
                    {
                        return uri;
                    }
                }
            }

            return root.isObject() ? readUri(root) : std::wstring();
#endif
        }

        std::filesystem::path savePendingNxm(
            const std::filesystem::path& directory,
            const NxmDownloadRequest& request,
            std::wstring_view link)
        {
            const std::filesystem::path path = uniquePath(directory, pendingFileName(request));
            std::filesystem::remove(cancelMarkerPath(path));
            writeTextFile(path, toUtf8(std::wstring(link)));
            return path;
        }

        void removePendingNxmFile(const std::filesystem::path& path)
        {
            std::filesystem::remove(path);
            std::filesystem::remove(metadataPath(path));
            removeDownloadProgressSidecar(path);
            std::filesystem::remove(cancelMarkerPath(path));
            std::filesystem::remove(AtomicFileStore::backupPathFor(path));
            std::filesystem::remove(AtomicFileStore::backupPathFor(metadataPath(path)));
            std::filesystem::remove(AtomicFileStore::backupPathFor(cancelMarkerPath(path)));
        }

        void removePendingNxmForLink(const std::filesystem::path& directory, std::wstring_view link)
        {
            if (!std::filesystem::exists(directory))
            {
                return;
            }

            const std::wstring linkText(link);
            for (const auto& entry : std::filesystem::directory_iterator(directory))
            {
                if (!entry.is_regular_file() || entry.path().extension().wstring() != pendingNxmExtension)
                {
                    continue;
                }

                if (fromUtf8(readTextFile(entry.path())) != linkText)
                {
                    continue;
                }

                if (!isActiveDownload(entry.path()))
                {
                    removePendingNxmFile(entry.path());
                }
            }
        }

        enum class NexusDuplicatePreflightKind
        {
            Continue,
            ReuseExisting,
            AwaitDecision
        };

        struct NexusDuplicatePreflightResult
        {
            NexusDuplicatePreflightKind kind{NexusDuplicatePreflightKind::Continue};
            std::filesystem::path existingPath;
            std::optional<DownloadDuplicateDecision> decision;
        };

        std::wstring newDuplicateDecisionId(const std::filesystem::path& pendingPath)
        {
            std::uint64_t sequence = 0;
            {
                const std::lock_guard lock(duplicateDecisionIdMutex);
                sequence = ++duplicateDecisionSequence;
            }
            std::wostringstream seed;
            seed << pendingPath.lexically_normal().wstring() << L'|'
                 << std::chrono::steady_clock::now().time_since_epoch().count() << L'|'
                 << std::this_thread::get_id() << L'|' << sequence;
            return L"duplicate-" + hashText(seed.str());
        }

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        using NexusDuplicateLineageHook = std::function<std::optional<NexusModFilesResponse>(
            std::wstring_view,
            std::wstring_view)>;
        std::mutex nexusDuplicateLineageHookMutex;
        NexusDuplicateLineageHook nexusDuplicateLineageHook;
#endif

        std::optional<NexusModFilesResponse> nexusFilesForDuplicatePreflight(
            Logger& logger,
            NexusModsAuthService* nexusAuth,
            const NxmDownloadRequest& request)
        {
#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
            {
                const std::lock_guard hookLock(nexusDuplicateLineageHookMutex);
                if (nexusDuplicateLineageHook)
                {
                    return nexusDuplicateLineageHook(request.gameDomain, request.modId);
                }
            }
#endif
            const std::wstring usedAt = nowUtcText();
            NexusUpdateCache cache;
            try
            {
                if (std::optional<NexusModFilesResponse> cached = cache.loadModFiles(
                        request.gameDomain,
                        request.modId,
                        L"",
                        usedAt);
                    cached.has_value())
                {
                    return cached;
                }
            }
            catch (const std::exception& exception)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "NxmDuplicate",
                    std::string("Nexus lineage cache read failed: ") + exception.what());
            }

            if (nexusAuth == nullptr)
            {
                return std::nullopt;
            }
            try
            {
                std::unique_ptr<NexusUpdateApi> api = createNexusUpdateApi(
                    logger,
                    *nexusAuth,
                    std::chrono::seconds(5));
                NexusModFilesResponse response = api->fetchModFiles(
                    request.gameDomain,
                    request.modId);
                try
                {
                    cache.storeModFiles(request.gameDomain, request.modId, response, usedAt);
                }
                catch (const std::exception& exception)
                {
                    logger.writeOperation(
                        LogLevel::Warning,
                        "NxmDuplicate",
                        std::string("Nexus lineage cache write failed: ") + exception.what());
                }
                return response;
            }
            catch (const std::exception& exception)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "NxmDuplicate",
                    std::string("Nexus lineage lookup unavailable; treating files as different: ") +
                        exception.what());
                return std::nullopt;
            }
        }

        std::vector<NexusDownloadFileVersion> completedNexusFiles(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& directory,
            const NxmDownloadRequest& request,
            const ArchiveCatalogService& archiveCatalog)
        {
            std::vector<NexusDownloadFileVersion> files;
            if (!std::filesystem::exists(directory))
            {
                return files;
            }

            for (const auto& entry : std::filesystem::directory_iterator(directory))
            {
                std::error_code statusError;
                if (!entry.is_regular_file(statusError) ||
                    !ArchiveCatalogService::isSupportedArchiveFile(entry.path()))
                {
                    continue;
                }

                const DownloadMetadata metadata = readMetadata(entry.path());
                if (toLower(trim(metadata.gameDomain)) != toLower(trim(request.gameDomain)) ||
                    trim(metadata.modId) != trim(request.modId) ||
                    trim(metadata.fileId).empty())
                {
                    continue;
                }

                ArchiveCatalogEntry archive;
                try
                {
                    archive = archiveCatalog.identifyArchive(projectDirectory, entry.path());
                }
                catch (const std::exception&)
                {
                    std::error_code existsError;
                    if (!std::filesystem::exists(entry.path(), existsError))
                    {
                        continue;
                    }
                    throw;
                }
                files.push_back(NexusDownloadFileVersion{
                    entry.path().wstring(),
                    metadata.gameDomain,
                    metadata.modId,
                    metadata.fileId,
                    entry.path().filename().wstring(),
                    metadata.version,
                    archive.sha256});
            }
            return files;
        }

        std::wstring duplicateDirection(NexusDownloadDuplicateKind kind)
        {
            switch (kind)
            {
            case NexusDownloadDuplicateKind::Upgrade:
                return L"upgrade";
            case NexusDownloadDuplicateKind::Downgrade:
                return L"downgrade";
            case NexusDownloadDuplicateKind::Mixed:
                return L"mixed";
            case NexusDownloadDuplicateKind::None:
            case NexusDownloadDuplicateKind::SameFile:
            default:
                return {};
            }
        }

        NexusDuplicatePreflightResult classifyNexusDuplicatePreflight(
            Logger& logger,
            NexusModsAuthService* nexusAuth,
            const ArchiveCatalogService& archiveCatalog,
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& directory,
            const std::filesystem::path& pendingPath,
            const NxmDownloadRequest& request,
            const DownloadMetadata& metadata)
        {
            std::vector<NexusDownloadFileVersion> existing = completedNexusFiles(
                projectDirectory,
                directory,
                request,
                archiveCatalog);
            if (existing.empty())
            {
                return {};
            }

            NexusDownloadFileVersion incoming{
                pendingPath.wstring(),
                request.gameDomain,
                request.modId,
                request.fileId,
                metadata.destinationFileName,
                metadata.version,
                {}};
            const NexusDownloadDuplicateResolver resolver;
            NexusDownloadDuplicateResolution resolution = resolver.resolve(incoming, existing, {});
            if (resolution.kind == NexusDownloadDuplicateKind::SameFile &&
                resolution.sameFile.has_value())
            {
                logger.writeOperation(
                    LogLevel::Info,
                    "NxmDuplicate",
                    "classification=same-file; reused existing completed archive.");
                return {
                    NexusDuplicatePreflightKind::ReuseExisting,
                    std::filesystem::path(resolution.sameFile->id),
                    std::nullopt};
            }

            const std::optional<NexusModFilesResponse> nexusFiles =
                nexusFilesForDuplicatePreflight(logger, nexusAuth, request);
            if (!nexusFiles.has_value())
            {
                logger.writeOperation(
                    LogLevel::Info,
                    "NxmDuplicate",
                    "classification=unproven; no cached or fresh Nexus lineage was available.");
                return {};
            }

            resolution = resolver.resolve(incoming, existing, nexusFiles->fileUpdates);
            const std::wstring direction = duplicateDirection(resolution.kind);
            if (direction.empty())
            {
                logger.writeOperation(
                    LogLevel::Info,
                    "NxmDuplicate",
                    "classification=unproven-or-different-branch; continuing as a separate file.");
                return {};
            }

            DownloadDuplicateDecision decision;
            decision.decisionId = newDuplicateDecisionId(pendingPath);
            decision.direction = direction;
            decision.incomingFile = DownloadDuplicateFile{
                pendingPath.wstring(),
                incoming.fileId,
                incoming.fileName,
                incoming.version,
                {}};
            for (const NexusDownloadFileVersion& file : resolution.existingFiles)
            {
                decision.existingFiles.push_back(DownloadDuplicateFile{
                    file.id,
                    file.fileId,
                    file.fileName,
                    file.version,
                    file.sha256});
            }
            std::wstring lineageSeed = toLower(trim(request.gameDomain)) + L"|" +
                trim(request.modId);
            for (const std::wstring& fileId : resolution.lineageFileIds)
            {
                lineageSeed += L"|" + fileId;
            }
            decision.lineageKey = hashText(lineageSeed);
            logger.writeOperation(
                LogLevel::Info,
                "NxmDuplicate",
                "classification=" + toUtf8(direction) +
                    "; existingCount=" + std::to_string(decision.existingFiles.size()) +
                    "; awaiting user decision.");
            return {
                NexusDuplicatePreflightKind::AwaitDecision,
                {},
                std::move(decision)};
        }

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        using NexusDownloadBeforeAcquireHook = std::function<void(std::wstring_view)>;
        using NexusArchiveTransferHook = std::function<std::filesystem::path(
            const std::filesystem::path&,
            const std::filesystem::path&,
            std::wstring_view)>;
        std::mutex nexusArchiveTransferHookMutex;
        NexusDownloadBeforeAcquireHook nexusDownloadBeforeAcquireHook;
        NexusArchiveTransferHook nexusArchiveTransferHook;
        std::function<void()> resumeBeforeClaimHook;
#endif

        DownloadTransferLimiter::Permit acquireDownloadTransferPermit(
            DownloadTransferLimiter& transferLimiter,
            const std::filesystem::path& progressPath)
        {
            while (true)
            {
                if (isDownloadCancellationRequested(progressPath))
                {
                    throw DownloadCanceledException();
                }

                std::optional<DownloadTransferLimiter::Permit> permit =
                    transferLimiter.tryAcquireFor(std::chrono::milliseconds(50));
                if (!permit.has_value())
                {
                    continue;
                }

                if (isDownloadCancellationRequested(progressPath))
                {
                    throw DownloadCanceledException();
                }

                return std::move(*permit);
            }
        }

        using NexusDuplicatePreflightCallback =
            std::function<NexusDuplicatePreflightResult(const DownloadMetadata&)>;

        NexusDownloadedFile downloadNxm(
            Logger& logger,
            const std::filesystem::path& directory,
            const NxmDownloadRequest& request,
            NexusModsAuthService* nexusAuth,
            const std::filesystem::path& progressPath,
            DownloadMetadata progressMetadata,
            DownloadTransferLimiter& transferLimiter,
            const NexusDuplicatePreflightCallback& duplicatePreflight = {})
        {
            ActiveDownloadRegistration activeDownload(progressPath);
            NexusDownloadedFile result;
            const auto preflightStartedAt = std::chrono::steady_clock::now();

            const auto throwIfCancellationRequested = [&]()
            {
                if (isDownloadCancellationRequested(progressPath))
                {
                    throw DownloadCanceledException();
                }
            };

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
            NexusDownloadBeforeAcquireHook beforeAcquireHook;
            NexusArchiveTransferHook transferHook;
            {
                std::lock_guard hookLock(nexusArchiveTransferHookMutex);
                beforeAcquireHook = nexusDownloadBeforeAcquireHook;
                transferHook = nexusArchiveTransferHook;
            }

            if (transferHook)
            {
                result.nexusModName = L"Nexus transfer fixture";
                result.version = L"1.0.0";
                result.latestVersion = result.version;
                progressMetadata.nexusModName = result.nexusModName;
                progressMetadata.version = result.version;
                progressMetadata.latestVersion = result.latestVersion;
                progressMetadata.destinationFileName =
                    L"nexus-fixture-" + request.fileId + L".zip";
            }
#endif
            std::wstring authHeader;
            NexusFileInfo fileInfo;
#ifndef _WIN32
#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
            if (!transferHook)
#endif
            {
                throw std::runtime_error("Nexus downloads are currently implemented for Windows builds.");
            }
#else
#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
            if (nexusAuth != nullptr)
            {
                authHeader = nexusRequestHeaders(nexusAuth);
            }
#endif
#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
            if (!transferHook)
#endif
            {
                if (authHeader.empty())
                {
                    authHeader = nexusRequestHeaders(nexusAuth);
                }
                result.nexusModName = fetchNexusModName(request, authHeader);
                throwIfCancellationRequested();
                progressMetadata.nexusModName = result.nexusModName;

                fileInfo = fetchNexusFileInfo(request, authHeader);
                throwIfCancellationRequested();
                result.version = fileInfo.version;
                result.latestVersion = fileInfo.version;
                result.filePayloadJson = fileInfo.payloadJson;
                progressMetadata.version = fileInfo.version;
                progressMetadata.latestVersion = fileInfo.version;

                if (!fileInfo.fileName.empty() || !fileInfo.displayName.empty())
                {
                    const std::wstring preflightFileName = archiveFileNameOrFallback(
                        fileInfo.fileName,
                        request,
                        result.nexusModName);
                    progressMetadata.destinationFileName = nexusDisplayArchiveFileName(
                        fileInfo.displayName,
                        preflightFileName);
                }
            }
#endif

            if (duplicatePreflight)
            {
                const NexusDuplicatePreflightResult duplicate = duplicatePreflight(progressMetadata);
                if (duplicate.kind == NexusDuplicatePreflightKind::ReuseExisting)
                {
                    result.path = duplicate.existingPath;
                    result.reusedExisting = true;
                    return result;
                }
                if (duplicate.kind == NexusDuplicatePreflightKind::AwaitDecision &&
                    duplicate.decision.has_value())
                {
                    progressMetadata.status = L"Нужно решение";
                    progressMetadata.isDownloading = false;
                    progressMetadata.duplicateDecision = duplicate.decision;
                    writeMetadata(progressPath, progressMetadata);
                    removeDownloadProgressSidecar(progressPath);
                    result.awaitingDecision = true;
                    return result;
                }
            }

            progressMetadata.status = L"Ожидает свободный слот";
            progressMetadata.isDownloading = true;
            writeMetadata(progressPath, progressMetadata);
            const auto preflightDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - preflightStartedAt);
            logger.writeOperation(
                LogLevel::Info,
                "NxmPreflight",
                "durationMs=" + std::to_string(preflightDuration.count()) +
                    ", resolvedFileName=" +
                    std::to_string(!progressMetadata.destinationFileName.empty()) +
                    ", resolvedVersion=" + std::to_string(!progressMetadata.version.empty()) + ".");
#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
            if (beforeAcquireHook)
            {
                beforeAcquireHook(request.fileId);
            }
#endif
            auto transferPermit = acquireDownloadTransferPermit(transferLimiter, progressPath);

            progressMetadata.status = L"Подготовка загрузки";
            writeMetadata(progressPath, progressMetadata);
            throwIfCancellationRequested();
#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
            if (transferHook)
            {
                progressMetadata.status = L"Скачивается";
                writeMetadata(progressPath, progressMetadata);
                result.path = transferHook(directory, progressPath, request.fileId);
                return result;
            }
#endif
#ifndef _WIN32
            throw std::runtime_error("Nexus downloads are currently implemented for Windows builds.");
#else
            const std::wstring downloadUri = resolveNexusDownloadUri(request, authHeader);
            throwIfCancellationRequested();
            if (downloadUri.empty())
            {
                return result;
            }

            const std::wstring fallbackFileName = archiveFileNameOrFallback(
                fileInfo.fileName.empty() ? fileNameFromUriPath(downloadUri) : fileInfo.fileName,
                request,
                result.nexusModName);
            const std::wstring nexusFileName = nexusDisplayArchiveFileName(
                fileInfo.displayName,
                fallbackFileName);
            progressMetadata.destinationFileName = nexusFileName.empty()
                ? fallbackFileName
                : nexusFileName;
            progressMetadata.status = L"Скачивается";
            writeMetadata(progressPath, progressMetadata);
            result.path = winHttpDownloadToFile(
                downloadUri,
                directory,
                fallbackFileName,
                progressPath,
                progressMetadata);
            return result;
#endif
        }
    }

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
    namespace test_hooks
    {
        std::pair<std::wstring, std::wstring> allocateFirstFreeInstallNameForTest(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory,
            std::wstring_view requestedName)
        {
            const AllocatedInstallName allocated = allocateFirstFreeInstallName(
                projectDirectory,
                modsDirectory,
                requestedName);
            return {allocated.displayName, allocated.folderName};
        }

        std::pair<std::wstring, std::wstring> reserveFirstFreeInstallNameForTest(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory,
            std::wstring_view requestedName)
        {
            InstallProjectGate guard(projectDirectory);
            const AllocatedInstallName allocated = allocateFirstFreeInstallName(
                projectDirectory,
                modsDirectory,
                requestedName);
            std::filesystem::create_directories(modsDirectory / allocated.folderName);
            return {allocated.displayName, allocated.folderName};
        }

        void replaceDirectoryWithStagingForTest(
            const std::filesystem::path& stagingDirectory,
            const std::filesystem::path& targetDirectory,
            const std::filesystem::path& modsDirectory,
            std::wstring_view safeName)
        {
            replaceDirectoryWithStaging(
                stagingDirectory,
                targetDirectory,
                modsDirectory,
                safeName);
        }

        void withInstalledDirectoryCommitForTest(
            const std::filesystem::path& stagingDirectory,
            const std::filesystem::path& targetDirectory,
            const std::filesystem::path& modsDirectory,
            std::wstring_view safeName,
            const std::function<void()>& beforeCommit)
        {
            InstalledDirectoryCommit commit;
            commit.promote(stagingDirectory, targetDirectory, modsDirectory, safeName);
            beforeCommit();
            commit.commit();
        }

        std::wstring nexusArchiveFileNameForTest(
            std::wstring_view suggestedName,
            std::wstring_view nexusModName)
        {
            NxmDownloadRequest request;
            request.gameDomain = L"skyrimspecialedition";
            request.modId = L"3863";
            request.fileId = L"123";
            return archiveFileNameOrFallback(suggestedName, request, nexusModName);
        }

        std::wstring resolvedHttpDownloadFileNameForTest(
            std::wstring_view persistedFileName,
            std::wstring_view contentDisposition,
            std::wstring_view fallbackFileName)
        {
            return resolvedHttpDownloadFileName(
                persistedFileName,
                contentDisposition,
                fallbackFileName);
        }

        std::wstring nexusDownloadFileNameFromApiPayloadForTest(std::wstring_view payloadJson)
        {
            const NexusFileInfo info = parseNexusFileInfoPayload(payloadJson);
            const std::wstring fallbackFileName = archiveFileNameOrFallback(
                info.fileName,
                {},
                {});
            const std::wstring displayFileName = nexusDisplayArchiveFileName(
                info.displayName,
                fallbackFileName);
            return displayFileName.empty() ? fallbackFileName : displayFileName;
        }

        std::pair<std::string, std::string> fileContentDigestsForTest(
            const std::filesystem::path& path)
        {
            const FileContentDigests digests = cachedRegularFileContentDigests(path);
            return {digests.sha256, digests.md5};
        }

        std::vector<std::wstring> uniqueNexusMd5IdentityFromPayloadForTest(
            std::wstring_view payloadJson,
            std::wstring_view expectedGameDomain,
            std::uintmax_t expectedArchiveSizeBytes)
        {
            const std::optional<NexusMd5Identity> identity =
                parseUniqueNexusMd5Identity(
                    payloadJson,
                    expectedGameDomain,
                    expectedArchiveSizeBytes);
            if (!identity.has_value())
            {
                return {};
            }
            return {
                identity->gameDomain,
                identity->modId,
                identity->fileId,
                identity->modName
            };
        }

        void withExistingDownloadOutputPathReservationForTest(
            const std::filesystem::path& path,
            const std::function<void()>& action)
        {
            const SingleDownloadOutputPathReservation reservation =
                reserveExistingDownloadOutputPath(path);
            action();
        }

        void withDownloadOutputPathsForTest(
            const std::filesystem::path& directory,
            std::wstring_view destinationFileName,
            const std::function<void(
                const std::filesystem::path&,
                const std::filesystem::path&)>& action)
        {
            const DownloadOutputPathReservation outputPaths = reserveDownloadOutputPaths(
                directory,
                destinationFileName,
                {});
            action(outputPaths.destinationPath(), outputPaths.partialPath());
        }

        void setNexusArchiveTransferHooks(
            std::function<void(std::wstring_view)> beforeAcquire,
            std::function<std::filesystem::path(
                const std::filesystem::path&,
                const std::filesystem::path&,
                std::wstring_view)> transfer)
        {
            std::lock_guard hookLock(nexusArchiveTransferHookMutex);
            nexusDownloadBeforeAcquireHook = std::move(beforeAcquire);
            nexusArchiveTransferHook = std::move(transfer);
        }

        void setNexusDuplicateLineageHook(NexusDuplicateLineageHook hook)
        {
            const std::lock_guard hookLock(nexusDuplicateLineageHookMutex);
            nexusDuplicateLineageHook = std::move(hook);
        }

        void setResumeBeforeClaimHook(std::function<void()> hook)
        {
            std::lock_guard hookLock(nexusArchiveTransferHookMutex);
            resumeBeforeClaimHook = std::move(hook);
        }

        void setInstallStagingCacheProducerHook(
            std::function<void(std::wstring_view, std::wstring_view, const std::filesystem::path&)> hook)
        {
            std::lock_guard<std::mutex> hookLock(installStagingCacheProducerHookMutex);
            installStagingCacheProducerHook = std::move(hook);
        }

        void alignInstallStagingCacheMetadataDigestForTest(
            const std::filesystem::path& entryDirectory)
        {
            const std::optional<InstallStagingCacheManifest> manifest =
                readInstallStagingCacheManifest(entryDirectory);
            if (!manifest.has_value())
            {
                throw std::runtime_error("Install staging cache test manifest is missing.");
            }

            const InstallStagingCachePayloadIntegrity currentMetadata =
                inspectInstallStagingCachePayload(
                    installStagingCachePayloadDirectory(entryDirectory),
                    false);
            writeTextFile(
                installStagingCacheReadyPath(entryDirectory),
                serializeInstallStagingCacheManifest(
                    manifest->contentDigest,
                    currentMetadata.metadataDigest));
        }

        void setActiveDownloadForTest(const std::filesystem::path& path, bool active)
        {
            std::lock_guard lock(activeDownloadsMutex);
            if (active)
            {
                activeDownloads[normalizedPathText(path)] = 1;
            }
            else
            {
                activeDownloads.erase(normalizedPathText(path));
            }
        }

        void withArchiveUseLockForTest(
            std::wstring_view archiveSha256,
            const std::function<void()>& action)
        {
            ArchiveUseGuard guard(archiveSha256, true);
            action();
        }

        std::filesystem::path downloadProgressSidecarPathForTest(const std::filesystem::path& path)
        {
            return progressSidecarPath(path);
        }

        void writeDownloadProgressCheckpointForTest(
            const std::filesystem::path& path,
            std::uintmax_t bytesReceived,
            std::uintmax_t totalBytes,
            std::uintmax_t startedUnix)
        {
            updateDownloadProgress(
                path,
                readMetadata(path),
                bytesReceived,
                totalBytes,
                startedUnix,
                DownloadProgressWriteMode::DurableCheckpoint);
        }

        void writeDownloadProgressSidecarForTest(
            const std::filesystem::path& path,
            std::uintmax_t bytesReceived,
            std::uintmax_t totalBytes,
            std::uintmax_t startedUnix)
        {
            updateDownloadProgress(
                path,
                readMetadata(path),
                bytesReceived,
                totalBytes,
                startedUnix,
                DownloadProgressWriteMode::VolatileOnly);
        }

        void finalizeHttpDownloadResponseForTest(
            const std::filesystem::path& partialPath,
            const std::filesystem::path& destinationPath,
            std::uint32_t statusCode,
            std::uintmax_t requestedOffset,
            std::wstring_view contentLength,
            std::wstring_view contentRange,
            std::uintmax_t responseBytesReceived)
        {
            const HttpDownloadResponsePlan plan = planHttpDownloadResponse(
                statusCode,
                requestedOffset,
                contentLength,
                contentRange);
            promoteCompletedHttpDownload(
                partialPath,
                destinationPath,
                plan,
                responseBytesReceived,
                regularFileSizeOrZero(partialPath));
        }

#ifdef _WIN32
        std::string externalProcessWaitOutcomeForTest(
            const std::vector<std::string>& events,
            std::size_t& terminationCalls,
            std::size_t& postTerminationWaits)
        {
            terminationCalls = 0;
            postTerminationWaits = 0;
            std::size_t eventIndex = 0;
            bool terminationRequested = false;
            const auto currentEvent = [&]() -> std::string_view
            {
                return eventIndex < events.size()
                    ? std::string_view(events[eventIndex])
                    : std::string_view{};
            };

            const ExternalProcessWaitCallbacks callbacks{
                [&](DWORD)
                {
                    if (terminationRequested)
                    {
                        ++postTerminationWaits;
                        return static_cast<DWORD>(WAIT_OBJECT_0);
                    }
                    if (eventIndex >= events.size())
                    {
                        return static_cast<DWORD>(WAIT_FAILED);
                    }

                    const std::string_view event = events[eventIndex++];
                    return event == "exit"
                        ? static_cast<DWORD>(WAIT_OBJECT_0)
                        : static_cast<DWORD>(WAIT_TIMEOUT);
                },
                [&]()
                {
                    return currentEvent() == "cancel";
                },
                [&]()
                {
                    return currentEvent() == "timeout";
                },
                [&]()
                {
                    ++terminationCalls;
                    terminationRequested = true;
                    return true;
                },
                [](DWORD& exitCode)
                {
                    exitCode = ERROR_SUCCESS;
                    return true;
                }};

            const ExternalProcessWaitResult result = waitForOwnedExternalProcess(
                callbacks,
                0,
                0);
            switch (result.outcome)
            {
            case ExternalProcessWaitOutcome::Exited:
                return "exited";
            case ExternalProcessWaitOutcome::Canceled:
                return "canceled";
            case ExternalProcessWaitOutcome::TimedOut:
                return "timed-out";
            case ExternalProcessWaitOutcome::WaitFailed:
            default:
                return "wait-failed";
            }
        }
#endif

        void writeNxmWorkerOperationContextLogForTest(
            Logger& logger,
            std::string operationId,
            std::string inScopeMarker,
            std::string afterScopeMarker)
        {
            std::thread worker(
                [&logger,
                 operationId = std::move(operationId),
                 inScopeMarker = std::move(inScopeMarker),
                 afterScopeMarker = std::move(afterScopeMarker)]()
                {
                    {
                        const ScopedLoggerOperationContext operationContext(operationId);
                        logger.write(LogLevel::Info, "Downloads", inScopeMarker);
                    }
                    logger.write(LogLevel::Info, "Downloads", afterScopeMarker);
                });
            worker.join();
        }
    }
#endif

    DownloadService::DownloadService(
        Logger& logger,
        AppSettingsService& settings,
        const BuildPathSettingsService& pathSettings,
        DownloadTransferLimiter& transferLimiter) noexcept
        : logger_(logger),
          settings_(settings),
          pathSettings_(pathSettings),
          archiveCatalog_(logger, pathSettings, isDownloadOutputPathReserved),
          transferLimiter_(transferLimiter)
    {
    }

    DownloadService::DownloadService(
        Logger& logger,
        AppSettingsService& settings,
        const BuildPathSettingsService& pathSettings,
        DownloadTransferLimiter& transferLimiter,
        NexusModsAuthService& nexusAuth) noexcept
        : logger_(logger),
          settings_(settings),
          pathSettings_(pathSettings),
          archiveCatalog_(logger, pathSettings, isDownloadOutputPathReserved),
          nexusAuth_(&nexusAuth),
          transferLimiter_(transferLimiter)
    {
    }

    DownloadService::~DownloadService()
    {
        (void)stopNxmDownloadWorker();
    }

    DownloadEntry DownloadService::buildCatalogEntry(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& path) const
    {
        DownloadEntry entry = buildEntry(path);
        if (path.extension().wstring() == pendingNxmExtension || entry.isDownloading)
        {
            entry.archiveId.clear();
            entry.buildStatus.clear();
            return entry;
        }

        const ArchiveCatalogLookup lookup = archiveCatalog_.lookupArchive(projectDirectory, path);
        if (lookup.state == ArchiveCatalogLookupState::Indexing)
        {
            entry.archiveId.clear();
            entry.buildStatus.clear();
            entry.transferState = L"indexing";
            entry.transferMessage = L"Indexing archive";
            entry.canInstall = false;
            entry.canDelete = false;
            return entry;
        }
        if (lookup.state == ArchiveCatalogLookupState::Failed)
        {
            entry.archiveId.clear();
            entry.buildStatus.clear();
            entry.transferState = L"failed";
            entry.transferMessage = lookup.message;
            entry.canInstall = false;
            return entry;
        }

        const ArchiveCatalogEntry& archive = lookup.entry;
        entry.archiveId = archive.archiveId;
        switch (InstanceMetadataStore::archiveBuildStatus(projectDirectory, archive.sha256))
        {
        case ArchiveBuildStatus::Installing:
            entry.buildStatus = L"Installing";
            break;
        case ArchiveBuildStatus::Installed:
            entry.buildStatus = L"Installed";
            break;
        case ArchiveBuildStatus::Deleted:
            entry.buildStatus = L"Deleted";
            break;
        case ArchiveBuildStatus::Ready:
        default:
            entry.buildStatus = L"Ready";
            break;
        }
        return entry;
    }

    bool DownloadService::canAutomaticallyDownloadNexus() const
    {
        const NexusModsStoredAuth auth = settings_.loadNexusModsAuth();
        return auth.linked &&
            auth.isPremium &&
            (!auth.protectedAccessToken.empty() || !auth.protectedApiKey.empty());
    }

    void DownloadService::processQueuedNxmDownload(const NxmDownloadJob& job) const
    {
        try
        {
            if (job.pendingPath.empty() ||
                !std::filesystem::exists(job.pendingPath) ||
                !std::filesystem::is_regular_file(job.pendingPath))
            {
                return;
            }

            std::wstring link = trim(job.link);
            if (link.empty())
            {
                link = trim(fromUtf8(readTextFile(job.pendingPath)));
            }
            if (link.empty())
            {
                throw std::invalid_argument("Download source is missing.");
            }

            const NxmDownloadRequest request = parseNxmLink(link);
            DownloadMetadata progressMetadata = readMetadata(job.pendingPath);
            progressMetadata.source = link;
            progressMetadata.status = L"Ожидает загрузки";
            progressMetadata.gameDomain = request.gameDomain;
            progressMetadata.modId = request.modId;
            progressMetadata.fileId = request.fileId;
            if (!job.nexusModName.empty())
            {
                progressMetadata.nexusModName = job.nexusModName;
            }
            progressMetadata.isDownloading = true;
            writeMetadata(job.pendingPath, progressMetadata);

            std::unique_ptr<DuplicateLineageGuard> lineageGuard;
            std::vector<std::unique_ptr<ArchiveUseGuard>> archiveGuards;
            if (job.duplicateChoice == DownloadDuplicateChoice::Replace)
            {
                if (!job.duplicateDecision.has_value())
                {
                    throw std::invalid_argument("Replacement decision snapshot is missing.");
                }
                lineageGuard = std::make_unique<DuplicateLineageGuard>(
                    job.duplicateDecision->lineageKey);
                std::vector<ValidatedDuplicateArchive> validated = validateDuplicateSnapshot(
                    job.projectDirectory,
                    job.directory,
                    progressMetadata,
                    *job.duplicateDecision,
                    archiveCatalog_);
                archiveGuards = lockDuplicateArchives(validated);
                static_cast<void>(validateDuplicateSnapshot(
                    job.projectDirectory,
                    job.directory,
                    progressMetadata,
                    *job.duplicateDecision,
                    archiveCatalog_));
            }

            NexusDuplicatePreflightCallback duplicatePreflight;
            if (!job.duplicateChoice.has_value())
            {
                duplicatePreflight = [this, &job, &request](const DownloadMetadata& metadata)
                {
                    return classifyNexusDuplicatePreflight(
                        logger_,
                        nexusAuth_,
                        archiveCatalog_,
                        job.projectDirectory,
                        job.directory,
                        job.pendingPath,
                        request,
                        metadata);
                };
            }

            NexusDownloadedFile downloadedFile = downloadNxm(
                logger_,
                job.directory,
                request,
                nexusAuth_,
                job.pendingPath,
                progressMetadata,
                transferLimiter_,
                duplicatePreflight);
            if (downloadedFile.awaitingDecision)
            {
                return;
            }
            if (!downloadedFile.path.empty())
            {
                DownloadMetadata completedMetadata = metadataForRequest(link, L"", request, downloadedFile.nexusModName);
                completedMetadata.version = downloadedFile.version;
                completedMetadata.latestVersion = downloadedFile.latestVersion;
                ArchiveCatalogEntry retained;
                {
                    const std::lock_guard completionLock(completedArchiveMetadataMutex);
                    retained = archiveCatalog_.consolidateArchive(
                        job.projectDirectory,
                        downloadedFile.path);
                    persistCompletedArchiveMetadata(
                        downloadedFile.path,
                        retained.path,
                        completedMetadata);
                    if (job.duplicateChoice == DownloadDuplicateChoice::Replace &&
                        job.duplicateDecision.has_value())
                    {
                        const std::wstring retainedKey = normalizedPathText(retained.path);
                        for (const DownloadDuplicateFile& existing :
                             job.duplicateDecision->existingFiles)
                        {
                            const std::filesystem::path existingPath(existing.id);
                            if (normalizedPathText(existingPath) != retainedKey &&
                                std::filesystem::exists(existingPath))
                            {
                                removeReplacedArchive(existingPath, archiveCatalog_);
                            }
                        }
                    }
                }
                removePendingNxmFile(job.pendingPath);
                logger_.writeOperation(
                    LogLevel::Info,
                    "NxmDuplicate",
                    job.duplicateChoice == DownloadDuplicateChoice::Replace
                        ? "choice=replace; finalization=completed."
                        : job.duplicateChoice == DownloadDuplicateChoice::KeepBoth
                            ? "choice=keep-both; finalization=completed."
                            : downloadedFile.reusedExisting
                                ? "classification=same-file; finalization=reused."
                                : "finalization=downloaded.");
                return;
            }
        }
        catch (const DownloadCanceledException&)
        {
            DownloadMetadata canceledMetadata = readMetadata(job.pendingPath);
            updateBytesFromPartial(job.directory, canceledMetadata);
            canceledMetadata.status = L"Отменено";
            canceledMetadata.isDownloading = false;
            writeMetadata(job.pendingPath, canceledMetadata);
            removeDownloadProgressSidecar(job.pendingPath);
            std::filesystem::remove(cancelMarkerPath(job.pendingPath));
            logger_.write(LogLevel::Info, "Downloads", "Canceled queued Nexus download: " + toUtf8(job.pendingPath.filename().wstring()));
            return;
        }
        catch (const std::exception& exception)
        {
            DownloadMetadata failedMetadata = readMetadata(job.pendingPath);
            updateBytesFromPartial(job.directory, failedMetadata);
            failedMetadata.status = L"Ожидает загрузки: " +
                std::wstring(exception.what(), exception.what() + std::strlen(exception.what()));
            failedMetadata.isDownloading = false;
            writeMetadata(job.pendingPath, failedMetadata);
            removeDownloadProgressSidecar(job.pendingPath);
            logger_.write(LogLevel::Warning, "Downloads", "Queued Nexus download failed: " + std::string(exception.what()));
            return;
        }

        DownloadMetadata pendingMetadata = readMetadata(job.pendingPath);
        updateBytesFromPartial(job.directory, pendingMetadata);
        pendingMetadata.status = L"Ожидает загрузки";
        pendingMetadata.isDownloading = false;
        writeMetadata(job.pendingPath, pendingMetadata);
        removeDownloadProgressSidecar(job.pendingPath);
    }

    void DownloadService::enqueueNxmDownloadJob(NxmDownloadJob job) const
    {
        std::unique_lock lock(nxmQueueMutex_);
        if (!nxmAcceptingJobs_ || nxmWorkerStopping_)
        {
            throw std::runtime_error("Download service is not accepting queued jobs.");
        }

        if (!nxmWorkerStarted_)
        {
            std::vector<std::thread> workers;
            workers.reserve(static_cast<std::size_t>(DownloadTransferLimiter::MaximumActiveTransfers));
            try
            {
                for (std::ptrdiff_t index = 0;
                     index < DownloadTransferLimiter::MaximumActiveTransfers;
                     ++index)
                {
                    workers.emplace_back([this]() noexcept
                    {
                        runNxmDownloadWorker();
                    });
                }
            }
            catch (...)
            {
                nxmWorkerStopping_ = true;
                lock.unlock();
                nxmQueueCv_.notify_all();
                for (std::thread& worker : workers)
                {
                    if (worker.joinable())
                    {
                        worker.join();
                    }
                }
                lock.lock();
                nxmWorkerStopping_ = false;
                throw;
            }

            nxmWorkers_ = std::move(workers);
            nxmWorkerStarted_ = true;
        }

        nxmQueue_.push_back(std::move(job));
        lock.unlock();
        nxmQueueCv_.notify_one();
    }

    void DownloadService::runNxmDownloadWorker() const noexcept
    {
        const auto logWorkerFailure = [this](
            std::string_view operationId,
            std::string_view message) noexcept
        {
            try
            {
                const ScopedLoggerOperationContext operationContext(operationId);
                logger_.write(LogLevel::Error, "Downloads", std::string(message));
            }
            catch (...)
            {
            }
        };

        while (true)
        {
            NxmDownloadJob job;
            bool shouldStop = false;
            try
            {
                {
                    std::unique_lock lock(nxmQueueMutex_);
                    nxmQueueCv_.wait(lock, [this]()
                    {
                        return nxmWorkerStopping_ || !nxmQueue_.empty();
                    });

                    if (nxmWorkerStopping_ && nxmQueue_.empty())
                    {
                        shouldStop = true;
                    }
                    else
                    {
                        job = std::move(nxmQueue_.front());
                        nxmQueue_.pop_front();
                        currentNxmDownloadPaths_.push_back(job.pendingPath);
                    }
                }

                if (!shouldStop)
                {
                    const ScopedLoggerOperationContext operationContext(job.operationId);
#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
                    if (job.transferProbe)
                    {
                        auto transferPermit = acquireDownloadTransferPermit(transferLimiter_, {});
                        job.transferProbe();
                    }
                    else
#endif
                    {
                        processQueuedNxmDownload(job);
                    }
                }
            }
            catch (const std::exception& exception)
            {
                logWorkerFailure(job.operationId, exception.what());
            }
            catch (...)
            {
                logWorkerFailure(job.operationId, "Queued Nexus worker failed with an unknown error.");
            }

            if (shouldStop)
            {
                break;
            }

            if (!job.pendingPath.empty())
            {
                try
                {
                    unmarkActiveDownload(job.pendingPath);
                }
                catch (...)
                {
                }

                try
                {
                    std::lock_guard lock(nxmQueueMutex_);
                    const auto current = std::find(
                        currentNxmDownloadPaths_.begin(),
                        currentNxmDownloadPaths_.end(),
                        job.pendingPath);
                    if (current != currentNxmDownloadPaths_.end())
                    {
                        currentNxmDownloadPaths_.erase(current);
                    }
                }
                catch (...)
                {
                }
            }
        }
    }

    bool DownloadService::stopNxmDownloadWorker() noexcept
    {
        bool wasInitialized = false;
        try
        {
            std::lock_guard shutdownLock(nxmShutdownMutex_);
            std::deque<NxmDownloadJob> abandonedJobs;
            std::vector<std::filesystem::path> currentDownloadPaths;
            {
                std::lock_guard lock(nxmQueueMutex_);
                const std::thread::id currentThreadId = std::this_thread::get_id();
                const bool calledFromWorker = std::any_of(
                    nxmWorkers_.begin(),
                    nxmWorkers_.end(),
                    [&](const std::thread& worker)
                    {
                        return worker.joinable() && worker.get_id() == currentThreadId;
                    });
                if (calledFromWorker)
                {
                    return false;
                }

                wasInitialized = initialized_;
                initialized_ = false;
                nxmAcceptingJobs_ = false;
                if (!nxmWorkerStarted_ && nxmWorkers_.empty())
                {
                    return wasInitialized;
                }

                nxmWorkerStopping_ = true;
                abandonedJobs.swap(nxmQueue_);
                currentDownloadPaths.swap(currentNxmDownloadPaths_);
            }

            for (const NxmDownloadJob& job : abandonedJobs)
            {
                try
                {
                    DownloadMetadata metadata = readMetadata(job.pendingPath);
                    updateBytesFromPartial(job.directory, metadata);
                    metadata.status = L"Отменено";
                    metadata.isDownloading = false;
                    writeMetadata(job.pendingPath, metadata);
                    removeDownloadProgressSidecar(job.pendingPath);
                    std::filesystem::remove(cancelMarkerPath(job.pendingPath));
                }
                catch (...)
                {
                }
                try
                {
                    unmarkActiveDownload(job.pendingPath);
                }
                catch (...)
                {
                }
            }

            for (const std::filesystem::path& currentDownloadPath : currentDownloadPaths)
            {
                try
                {
                    requestDownloadCancellation(currentDownloadPath);
                }
                catch (...)
                {
                }
            }

            nxmQueueCv_.notify_all();
            for (std::thread& worker : nxmWorkers_)
            {
                if (!worker.joinable())
                {
                    continue;
                }

                try
                {
                    worker.join();
                }
                catch (...)
                {
                    try
                    {
                        if (worker.joinable())
                        {
                            worker.detach();
                        }
                    }
                    catch (...)
                    {
                    }
                }
            }

            for (const std::filesystem::path& currentDownloadPath : currentDownloadPaths)
            {
                try
                {
                    std::filesystem::remove(cancelMarkerPath(currentDownloadPath));
                }
                catch (...)
                {
                }
            }

            {
                std::lock_guard lock(nxmQueueMutex_);
                nxmWorkerStopping_ = false;
                nxmWorkerStarted_ = false;
                nxmWorkers_.clear();
                currentNxmDownloadPaths_.clear();
            }
            return wasInitialized;
        }
        catch (...)
        {
            return wasInitialized;
        }
    }

    void DownloadService::initialize()
    {
        std::lock_guard shutdownLock(nxmShutdownMutex_);
        if (initialized_)
        {
            return;
        }

        std::filesystem::create_directories(inboundDirectory());
        {
            std::lock_guard lock(nxmQueueMutex_);
            nxmAcceptingJobs_ = true;
        }
        initialized_ = true;
        logger_.write(
            LogLevel::Info,
            "Download service initialized with a maximum of " +
                std::to_string(DownloadTransferLimiter::MaximumActiveTransfers) +
                " active transfers.");
    }

    void DownloadService::shutdown()
    {
        if (stopNxmDownloadWorker())
        {
            logger_.write(LogLevel::Info, "Download service shut down.");
        }
    }

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
    void DownloadService::queueTransferProbeForTest(std::function<void()> transfer) const
    {
        if (!transfer)
        {
            throw std::invalid_argument("Transfer probe is required.");
        }

        NxmDownloadJob job;
        job.operationId = Logger::operationId();
        job.transferProbe = std::move(transfer);
        enqueueNxmDownloadJob(std::move(job));
    }

    void DownloadService::runSynchronousTransferProbeForTest(
        std::function<void()> beforeAcquire,
        std::function<void()> transfer) const
    {
        if (!beforeAcquire || !transfer)
        {
            throw std::invalid_argument("Transfer probe callbacks are required.");
        }

        beforeAcquire();
        auto transferPermit = acquireDownloadTransferPermit(transferLimiter_, {});
        transfer();
    }
#endif

    void DownloadService::registerNxmProtocol(const std::filesystem::path& executablePath) const
    {
#ifndef _WIN32
        (void)executablePath;
        throw std::runtime_error("NXM protocol registration is currently implemented for Windows builds.");
#else
        if (executablePath.empty())
        {
            throw std::invalid_argument("Executable path is required.");
        }

        const std::wstring command = buildProtocolCommand(executablePath);
        const std::wstring previousCommand = readRegistryString(HKEY_CURRENT_USER, commandKeyPath, nullptr);
        if (!previousCommand.empty() && _wcsicmp(previousCommand.c_str(), command.c_str()) != 0)
        {
            writeRegistryString(HKEY_CURRENT_USER, backupKeyPath, std::wstring(previousCommandValueName).c_str(), previousCommand);
        }

        writeRegistryString(HKEY_CURRENT_USER, protocolKeyPath, nullptr, L"URL:nxm Protocol");
        writeRegistryString(HKEY_CURRENT_USER, protocolKeyPath, L"URL Protocol", L"");
        writeRegistryString(HKEY_CURRENT_USER, std::wstring(protocolKeyPath) + L"\\DefaultIcon", nullptr, executablePath.wstring());
        writeRegistryString(HKEY_CURRENT_USER, commandKeyPath, nullptr, command);
#endif
    }

    bool DownloadService::isNxmProtocolRegistered(const std::filesystem::path& executablePath) const
    {
#ifndef _WIN32
        (void)executablePath;
        return false;
#else
        const std::wstring currentCommand = readRegistryString(HKEY_CURRENT_USER, commandKeyPath, nullptr);
        return !currentCommand.empty() &&
            _wcsicmp(currentCommand.c_str(), buildProtocolCommand(executablePath).c_str()) == 0;
#endif
    }

    std::vector<DownloadEntry> DownloadService::listDownloads(
        const std::filesystem::path& projectDirectory) const
    {
        const std::filesystem::path directory = pathSettings_.downloadsDirectory(projectDirectory);
        std::filesystem::create_directories(directory);
        const std::size_t removedBackupCount = removeDownloadStateBackupFiles(directory);
        if (removedBackupCount > 0)
        {
            logger_.write(
                LogLevel::Info,
                "Downloads",
                "Removed stale download state backups: " + std::to_string(removedBackupCount));
        }

        std::vector<DownloadFileCatalogEntry> files;
        for (const auto& entry : std::filesystem::directory_iterator(directory))
        {
            std::error_code statusError;
            if (!entry.is_regular_file(statusError))
            {
                continue;
            }

            const std::wstring pathText = entry.path().wstring();
            if (pathText.ends_with(metadataExtension) ||
                pathText.ends_with(progressSidecarExtension) ||
                pathText.ends_with(transientFileExtension) ||
                pathText.ends_with(partialDownloadExtension) ||
                isAtomicBackupFile(entry.path()))
            {
                continue;
            }

            if (entry.path().extension().wstring() != pendingNxmExtension &&
                !hasSupportedDownloadFileExtension(entry.path().filename().wstring()))
            {
                continue;
            }

            std::error_code timeError;
            const std::filesystem::file_time_type lastWriteTime = entry.last_write_time(timeError);
            files.push_back(DownloadFileCatalogEntry{
                entry.path(),
                timeError ? (std::filesystem::file_time_type::min)() : lastWriteTime
            });
        }

        std::sort(files.begin(), files.end(), [](const auto& left, const auto& right)
        {
            if (left.lastWriteTime != right.lastWriteTime)
            {
                return left.lastWriteTime > right.lastWriteTime;
            }

            return left.path.wstring() < right.path.wstring();
        });

        std::vector<DownloadEntry> entries;
        entries.reserve(files.size());
        for (const auto& file : files)
        {
            try
            {
                entries.push_back(buildCatalogEntry(projectDirectory, file.path));
            }
            catch (const std::exception&)
            {
                std::error_code existsError;
                if (!std::filesystem::exists(file.path, existsError))
                {
                    continue;
                }
                throw;
            }
        }

        return entries;
    }

    std::vector<DownloadEntry> DownloadService::captureNxmLinks(
        const std::filesystem::path& projectDirectory,
        const std::vector<std::wstring>& nxmLinks) const
    {
        const auto intakeStartedAt = std::chrono::steady_clock::now();
        const std::filesystem::path directory = pathSettings_.downloadsDirectory(projectDirectory);
        std::filesystem::create_directories(directory);

        std::vector<DownloadEntry> entries;
        for (const std::wstring& link : nxmLinks)
        {
            if (link.empty())
            {
                continue;
            }

            const NxmDownloadRequest request = parseNxmLink(link);
            removePendingNxmForLink(directory, link);
            const std::filesystem::path pendingPath = savePendingNxm(directory, request, link);
            DownloadMetadata progressMetadata = metadataForRequest(link, L"Ожидает загрузки", request);
            progressMetadata.isDownloading = true;
            writeMetadata(pendingPath, progressMetadata);

            try
            {
                markActiveDownload(pendingPath);
                DownloadEntry queuedEntry = buildEntry(pendingPath);
                enqueueNxmDownloadJob(NxmDownloadJob{
                    projectDirectory,
                    directory,
                    pendingPath,
                    link,
                    {},
                    Logger::operationId()
                });
                entries.push_back(std::move(queuedEntry));
                continue;
            }
            catch (const std::exception& exception)
            {
                unmarkActiveDownload(pendingPath);
                DownloadMetadata failedMetadata = readMetadata(pendingPath);
                updateBytesFromPartial(directory, failedMetadata);
                failedMetadata.status = L"Ожидает загрузки: " +
                    std::wstring(exception.what(), exception.what() + std::strlen(exception.what()));
                failedMetadata.isDownloading = false;
                writeMetadata(pendingPath, failedMetadata);
                removeDownloadProgressSidecar(pendingPath);
                entries.push_back(buildEntry(pendingPath));
                continue;
            }
        }

        const auto intakeDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - intakeStartedAt);
        logger_.writeOperation(
            LogLevel::Info,
            "NxmIntake",
            "durationMs=" + std::to_string(intakeDuration.count()) +
                ", inputCount=" + std::to_string(nxmLinks.size()) +
                ", acceptedCount=" + std::to_string(entries.size()) + ".");
        return entries;
    }

    std::vector<DownloadEntry> DownloadService::queueInboundNxmLinks(
        const std::vector<std::wstring>& nxmLinks) const
    {
        const std::filesystem::path directory = inboundDirectory();
        std::filesystem::create_directories(directory);

        std::vector<DownloadEntry> entries;
        for (const std::wstring& link : nxmLinks)
        {
            if (link.empty())
            {
                continue;
            }

            const NxmDownloadRequest request = parseNxmLink(link);
            const std::filesystem::path pendingPath = savePendingNxm(directory, request, link);
            writeMetadata(pendingPath, metadataForRequest(link, L"Ожидает выбора сборки", request));
            entries.push_back(buildEntry(pendingPath));
        }

        return entries;
    }

    std::vector<DownloadEntry> DownloadService::importInboundNxmLinks(
        const std::filesystem::path& projectDirectory) const
    {
        const std::filesystem::path directory = inboundDirectory();
        if (!std::filesystem::exists(directory))
        {
            return {};
        }

        std::vector<std::wstring> links;
        for (const auto& entry : std::filesystem::directory_iterator(directory))
        {
            if (!entry.is_regular_file() || entry.path().extension().wstring() != pendingNxmExtension)
            {
                continue;
            }

            const std::string content = readTextFile(entry.path());
            if (!content.empty())
            {
                links.push_back(fromUtf8(content));
            }

            removePendingNxmFile(entry.path());
        }

        return captureNxmLinks(projectDirectory, links);
    }

    DownloadEntry DownloadService::downloadNxmForFluxPack(
        const std::filesystem::path& projectDirectory,
        std::wstring_view nxmLink) const
    {
        if (!canAutomaticallyDownloadNexus())
        {
            throw std::invalid_argument(
                "Automatic Nexus downloads require a linked Premium account. Download this file manually.");
        }
        if (projectDirectory.empty() || trim(std::wstring(nxmLink)).empty())
        {
            throw std::invalid_argument("Project directory and NXM link are required.");
        }

        const std::wstring link = trim(std::wstring(nxmLink));
        const NxmDownloadRequest request = parseNxmLink(link);
        const std::filesystem::path directory = pathSettings_.downloadsDirectory(projectDirectory);
        PathSafetyService().validateDirectoryWriteRoot(directory)
            .throwIfUnsafe("Downloads directory is unsafe");
        std::filesystem::create_directories(directory);
        removePendingNxmForLink(directory, link);

        const std::filesystem::path pendingPath = savePendingNxm(directory, request, link);
        DownloadMetadata progressMetadata = metadataForRequest(link, L"Скачивается", request);
        progressMetadata.isDownloading = true;
        writeMetadata(pendingPath, progressMetadata);

        try
        {
            const NexusDownloadedFile downloadedFile = downloadNxm(
                logger_,
                directory,
                request,
                nexusAuth_,
                pendingPath,
                progressMetadata,
                transferLimiter_);
            if (downloadedFile.path.empty())
            {
                throw std::runtime_error("Nexus did not return a download URL for this file.");
            }

            removePendingNxmFile(pendingPath);
            DownloadMetadata completedMetadata =
                metadataForRequest(link, L"", request, downloadedFile.nexusModName);
            completedMetadata.version = downloadedFile.version;
            completedMetadata.latestVersion = downloadedFile.latestVersion;
            ArchiveCatalogEntry retained;
            {
                const std::lock_guard completionLock(completedArchiveMetadataMutex);
                retained = archiveCatalog_.consolidateArchive(
                    projectDirectory,
                    downloadedFile.path);
                persistCompletedArchiveMetadata(
                    downloadedFile.path,
                    retained.path,
                    completedMetadata);
            }
            logger_.writeOperation(
                LogLevel::Info,
                "Downloads",
                "Completed synchronous Premium Nexus download for FluxPack: " +
                    toUtf8(downloadedFile.path.filename().wstring()));
            return buildCatalogEntry(projectDirectory, retained.path);
        }
        catch (...)
        {
            removePendingNxmFile(pendingPath);
            throw;
        }
    }

    DownloadEntry DownloadService::importLocalFile(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& sourcePath) const
    {
        if (sourcePath.empty() || !std::filesystem::exists(sourcePath) || !std::filesystem::is_regular_file(sourcePath))
        {
            throw std::invalid_argument("Download file does not exist.");
        }

        if (!hasSupportedDownloadFileExtension(sourcePath.filename().wstring()))
        {
            throw std::invalid_argument("Download file type is not supported.");
        }

        const std::filesystem::path directory = pathSettings_.downloadsDirectory(projectDirectory);
        PathSafetyService().validateDirectoryWriteRoot(directory)
            .throwIfUnsafe("Downloads directory is unsafe");
        std::filesystem::create_directories(directory);

        const ArchiveCatalogEntry imported = archiveCatalog_.importArchive(
            projectDirectory,
            sourcePath);
        if (imported.createdNewFile)
        {
            DownloadMetadata metadata;
            metadata.version = versionFromArchiveFileName(
                imported.path,
                imported.path.stem().wstring());
            writeMetadata(imported.path, metadata);
        }
        return buildCatalogEntry(projectDirectory, imported.path);
    }

    void DownloadService::deleteDownload(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& downloadPath) const
    {
        if (projectDirectory.empty() || downloadPath.empty())
        {
            throw std::invalid_argument("Project directory and download path are required.");
        }

        const std::filesystem::path directory = pathSettings_.downloadsDirectory(projectDirectory);
        if (!std::filesystem::exists(downloadPath) || !std::filesystem::is_regular_file(downloadPath))
        {
            throw std::invalid_argument("Download file does not exist.");
        }

        if (!std::filesystem::exists(directory) || !isPathInsideDirectory(downloadPath, directory))
        {
            throw std::invalid_argument("Download path is outside the project downloads directory.");
        }

        const DownloadMetadata metadata = readMetadata(downloadPath);
        if (metadata.isDownloading)
        {
            throw std::invalid_argument("Download is still in progress.");
        }

        const ArchiveCatalogEntry archive = archiveCatalog_.identifyArchive(
            projectDirectory,
            downloadPath);
        ArchiveUseGuard archiveUse(archive.sha256, false);

        if (const std::filesystem::path partialPath = resumablePartialPath(directory, metadata); !partialPath.empty())
        {
            std::filesystem::remove(partialPath);
        }
        std::filesystem::remove(downloadPath);
        std::filesystem::remove(metadataPath(downloadPath));
        removeDownloadProgressSidecar(downloadPath);
        std::filesystem::remove(cancelMarkerPath(downloadPath));
        std::filesystem::remove(AtomicFileStore::backupPathFor(downloadPath));
        std::filesystem::remove(AtomicFileStore::backupPathFor(metadataPath(downloadPath)));
        std::filesystem::remove(AtomicFileStore::backupPathFor(cancelMarkerPath(downloadPath)));
        archiveCatalog_.removeArchiveSidecar(downloadPath);
    }

    void DownloadService::cancelDownload(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& downloadPath) const
    {
        if (projectDirectory.empty() || downloadPath.empty())
        {
            throw std::invalid_argument("Project directory and download path are required.");
        }

        const std::filesystem::path directory = pathSettings_.downloadsDirectory(projectDirectory);
        if (!std::filesystem::exists(downloadPath) || !std::filesystem::is_regular_file(downloadPath))
        {
            throw std::invalid_argument("Download file does not exist.");
        }

        if (!std::filesystem::exists(directory) || !isPathInsideDirectory(downloadPath, directory))
        {
            throw std::invalid_argument("Download path is outside the project downloads directory.");
        }

        DownloadMetadata metadata = readMetadata(downloadPath);
        if (!metadata.isDownloading)
        {
            throw std::invalid_argument("Download is not in progress.");
        }

        requestDownloadCancellation(downloadPath);
        metadata.status = L"Отмена загрузки";
        writeMetadata(downloadPath, metadata);
        removeDownloadProgressSidecar(downloadPath);
    }

    DownloadEntry DownloadService::resumeDownload(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& downloadPath) const
    {
        if (projectDirectory.empty() || downloadPath.empty())
        {
            throw std::invalid_argument("Project directory and download path are required.");
        }

        const std::filesystem::path directory = pathSettings_.downloadsDirectory(projectDirectory);
        if (!std::filesystem::exists(downloadPath) || !std::filesystem::is_regular_file(downloadPath))
        {
            throw std::invalid_argument("Download file does not exist.");
        }

        if (!std::filesystem::exists(directory) || !isPathInsideDirectory(downloadPath, directory))
        {
            throw std::invalid_argument("Download path is outside the project downloads directory.");
        }

        if (downloadPath.extension().wstring() != pendingNxmExtension)
        {
            throw std::invalid_argument("Only pending Nexus downloads can be resumed.");
        }

        DownloadMetadata metadata = readMetadata(downloadPath);
        updateBytesFromPartial(directory, metadata);
        std::wstring link = trim(metadata.source);
        if (link.empty())
        {
            link = trim(fromUtf8(readTextFile(downloadPath)));
        }
        if (link.empty())
        {
            throw std::invalid_argument("Download source is missing.");
        }

        const NxmDownloadRequest request = parseNxmLink(link);
#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        std::function<void()> beforeClaimHook;
        {
            std::lock_guard hookLock(nexusArchiveTransferHookMutex);
            beforeClaimHook = resumeBeforeClaimHook;
        }
        if (beforeClaimHook)
        {
            beforeClaimHook();
        }
#endif
        std::filesystem::path activeClaimPath = downloadPath;
        if (!tryMarkActiveDownload(downloadPath))
        {
            throw std::invalid_argument("Download is already in progress.");
        }
        ActiveDownloadClaim activeClaim(std::move(activeClaimPath));

        try
        {
            std::filesystem::remove(cancelMarkerPath(downloadPath));
            DownloadMetadata progressMetadata = metadataForRequest(
                link,
                L"Ожидает загрузки",
                request,
                metadata.nexusModName);
            progressMetadata.destinationFileName = metadata.destinationFileName;
            progressMetadata.partialPath = metadata.partialPath;
            progressMetadata.bytesReceived = metadata.bytesReceived;
            progressMetadata.totalBytes = metadata.totalBytes;
            progressMetadata.isDownloading = true;
            writeMetadata(downloadPath, progressMetadata);
            DownloadEntry queuedEntry = buildEntry(downloadPath);
            enqueueNxmDownloadJob(NxmDownloadJob{
                projectDirectory,
                directory,
                downloadPath,
                link,
                metadata.nexusModName,
                Logger::operationId()
            });
            activeClaim.transferToQueue();
            return queuedEntry;
        }
        catch (const std::exception& exception)
        {
            DownloadMetadata failedMetadata = readMetadata(downloadPath);
            updateBytesFromPartial(directory, failedMetadata);
            failedMetadata.status = L"Ожидает загрузки: " +
                std::wstring(exception.what(), exception.what() + std::strlen(exception.what()));
            failedMetadata.isDownloading = false;
            writeMetadata(downloadPath, failedMetadata);
            removeDownloadProgressSidecar(downloadPath);
            return buildEntry(downloadPath);
        }
        catch (...)
        {
            throw;
        }
    }

    std::optional<DownloadEntry> DownloadService::resolveDuplicateDecision(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& downloadPath,
        std::wstring_view decisionId,
        DownloadDuplicateChoice choice) const
    {
        if (projectDirectory.empty() || downloadPath.empty() || trim(std::wstring(decisionId)).empty())
        {
            throw std::invalid_argument(
                "Project directory, pending download path and decision id are required.");
        }
        if (choice != DownloadDuplicateChoice::Replace &&
            choice != DownloadDuplicateChoice::KeepBoth &&
            choice != DownloadDuplicateChoice::Cancel)
        {
            throw std::invalid_argument("Duplicate download choice is invalid.");
        }

        const std::lock_guard resolutionLock(duplicateDecisionResolutionMutex);
        const std::filesystem::path directory = pathSettings_.downloadsDirectory(projectDirectory);
        if (!std::filesystem::exists(downloadPath) ||
            !std::filesystem::is_regular_file(downloadPath) ||
            downloadPath.extension().wstring() != pendingNxmExtension ||
            !std::filesystem::exists(directory) ||
            !isPathInsideDirectory(downloadPath, directory))
        {
            throw std::invalid_argument("Pending duplicate download path is invalid.");
        }

        DownloadMetadata metadata = readMetadata(downloadPath);
        if (!metadata.duplicateDecision.has_value() ||
            metadata.duplicateDecision->decisionId != trim(std::wstring(decisionId)))
        {
            throw std::invalid_argument("Duplicate decision id is stale.");
        }
        const DownloadDuplicateDecision decision = *metadata.duplicateDecision;

        if (choice == DownloadDuplicateChoice::Cancel)
        {
            logger_.writeOperation(
                LogLevel::Info,
                "NxmDuplicate",
                "choice=cancel; removed pending request only.");
            removePendingNxmFile(downloadPath);
            return std::nullopt;
        }

        if (choice == DownloadDuplicateChoice::Replace)
        {
            static_cast<void>(validateDuplicateSnapshot(
                projectDirectory,
                directory,
                metadata,
                decision,
                archiveCatalog_));
        }

        std::wstring link = trim(metadata.source);
        if (link.empty())
        {
            link = trim(fromUtf8(readTextFile(downloadPath)));
        }
        if (link.empty())
        {
            throw std::invalid_argument("Download source is missing.");
        }
        static_cast<void>(parseNxmLink(link));

        metadata.status = L"Ожидает загрузки";
        metadata.isDownloading = true;
        metadata.duplicateDecision.reset();
        std::filesystem::remove(cancelMarkerPath(downloadPath));
        writeMetadata(downloadPath, metadata);
        markActiveDownload(downloadPath);
        try
        {
            enqueueNxmDownloadJob(NxmDownloadJob{
                projectDirectory,
                directory,
                downloadPath,
                link,
                metadata.nexusModName,
                Logger::operationId(),
                decision,
                choice
            });
        }
        catch (...)
        {
            unmarkActiveDownload(downloadPath);
            metadata.status = L"Нужно решение";
            metadata.isDownloading = false;
            metadata.duplicateDecision = decision;
            writeMetadata(downloadPath, metadata);
            throw;
        }

        logger_.writeOperation(
            LogLevel::Info,
            "NxmDuplicate",
            choice == DownloadDuplicateChoice::Replace
                ? "choice=replace; queued replacement transfer."
                : "choice=keep-both; queued independent transfer.");
        return buildEntry(downloadPath);
    }

    FluxoraInstallPlan DownloadService::planDownloadInstall(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& downloadPath,
        std::wstring_view profileName,
        std::wstring_view requestedModName) const
    {
        if (downloadPath.empty() ||
            !std::filesystem::exists(downloadPath) ||
            !std::filesystem::is_regular_file(downloadPath))
        {
            throw std::invalid_argument("Download file does not exist.");
        }
        if (downloadPath.extension().wstring() == pendingNxmExtension)
        {
            throw std::invalid_argument("Download is not ready to install.");
        }

        const DownloadMetadata metadata = readMetadata(downloadPath);
        if (metadata.isDownloading)
        {
            throw std::invalid_argument("Download is still in progress.");
        }

        FomodInstallerDescriptor fomodInstaller = analyzeFomodDownload(
            projectDirectory,
            downloadPath,
            profileName);
        const BuildPathSettings paths = pathSettings_.loadForProjectDirectory(projectDirectory);
        const std::wstring finalRequestedName = trim(std::wstring(requestedModName));
        const auto buildPlan = [&](const NexusMd5Identity* onlineIdentity)
        {
            const std::wstring archiveName = trim(downloadPath.stem().wstring());
            std::wstring sourceName = fomodInstaller.isFomod
                ? preferredFomodInstallName(archiveName, fomodInstaller.moduleName)
                : archiveName;
            if (sourceName.empty())
            {
                sourceName = onlineIdentity != nullptr && !onlineIdentity->modName.empty()
                    ? onlineIdentity->modName
                    : trim(metadata.nexusModName);
            }

            ModIdentityPlanRequest request;
            request.projectDirectory = projectDirectory;
            request.archivePath = downloadPath;
            request.archiveFingerprint = fileCacheFingerprint(downloadPath);
            request.requestedInstallName = finalRequestedName;
            request.input.displayName = ModIdentityResolver::canonicalSuggestedName(sourceName);
            request.input.folderName = sanitizeFileName(request.input.displayName);
            request.input.fomodModuleId = fomodInstaller.moduleId;
            request.input.source = onlineIdentity != nullptr
                ? ModIdentitySource{
                    L"nexus",
                    onlineIdentity->gameDomain,
                    onlineIdentity->modId,
                    onlineIdentity->fileId}
                : ModIdentitySource{
                    !metadata.gameDomain.empty()
                        ? L"nexus"
                        : (metadata.source.empty() ? L"local" : L"manual"),
                    metadata.gameDomain,
                    metadata.modId,
                    metadata.fileId};
            request.fomodInstaller = fomodInstaller;
            if (request.input.source.provider == L"nexus")
            {
                const auto networkAttempted = std::make_shared<bool>(false);
                request.loadNexusFiles = [this, networkAttempted](
                    std::wstring_view gameDomain,
                    std::wstring_view modId,
                    bool allowNetwork)
                {
                    const auto startedAt = std::chrono::steady_clock::now();
                    const auto finish = [&](NexusFileMetadataLookup lookup)
                    {
                        lookup.durationMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::steady_clock::now() - startedAt).count();
                        return lookup;
                    };
                    const std::wstring usedAt = nowUtcText();
                    NexusUpdateCache cache;
                    if (!allowNetwork)
                    {
                        try
                        {
                            if (std::optional<NexusModFilesResponse> cached = cache.loadModFiles(
                                    gameDomain,
                                    modId,
                                    L"",
                                    usedAt);
                                cached.has_value())
                            {
                                return finish(NexusFileMetadataLookup{
                                    NexusFileMetadataSource::Cache,
                                    std::move(cached),
                                    0
                                });
                            }
                        }
                        catch (const std::exception& exception)
                        {
                            logger_.writeOperation(
                                LogLevel::Warning,
                                "ModIdentity",
                                std::string("Shared Nexus lineage cache read failed: ") +
                                    exception.what());
                        }
                        return finish({});
                    }

                    if (*networkAttempted || nexusAuth_ == nullptr)
                    {
                        return finish({});
                    }
                    *networkAttempted = true;
                    try
                    {
                        std::unique_ptr<NexusUpdateApi> api = createNexusUpdateApi(
                            logger_,
                            *nexusAuth_,
                            std::chrono::seconds(5));
                        NexusModFilesResponse response = api->fetchModFiles(gameDomain, modId);
                        try
                        {
                            cache.storeModFiles(gameDomain, modId, response, usedAt);
                        }
                        catch (const std::exception& exception)
                        {
                            logger_.writeOperation(
                                LogLevel::Warning,
                                "ModIdentity",
                                std::string("Shared Nexus lineage cache write failed: ") +
                                    exception.what());
                        }
                        return finish(NexusFileMetadataLookup{
                            NexusFileMetadataSource::Network,
                            std::move(response),
                            0
                        });
                    }
                    catch (const std::exception& exception)
                    {
                        logger_.writeOperation(
                            LogLevel::Warning,
                            "ModIdentity",
                            std::string("Nexus lineage metadata unavailable: ") +
                                exception.what());
                        return finish({});
                    }
                };
            }
            request.loadIncomingContent = [&, sourceName, fomodInstaller]()
            {
                if (fomodInstaller.isFomod)
                {
                    const auto preparationStartedAt = std::chrono::steady_clock::now();
                    const std::wstring cacheKey = fomodPackageStagingCacheKey(downloadPath);
                    std::optional<InstallStagingCachePayloadLease> payload =
                        tryInstallStagingCachePayload(
                            paths.downloadsDirectory,
                            L"fomod-package",
                            cacheKey,
                            logger_);
                    const bool cacheHit = payload.has_value();
                    if (!payload.has_value())
                    {
                        payload.emplace(ensureInstallStagingCachePayload(
                            paths.downloadsDirectory,
                            L"fomod-package",
                            cacheKey,
                            logger_,
                            [&](const std::filesystem::path& payloadDirectory)
                            {
                                if (!extractArchiveToDirectory(downloadPath, payloadDirectory, logger_))
                                {
                                    throw std::invalid_argument("Download archive could not be inspected.");
                                }
                            }));
                    }
                    auto anchors =
                        ModIdentityResolver::collectContentAnchors(payload->payloadDirectory());
                    const auto preparationDuration =
                        std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::steady_clock::now() - preparationStartedAt);
                    logger_.write(
                        LogLevel::Info,
                        "FomodPerformance",
                        "FOMOD background full preparation completed. cacheHit=" +
                            std::string(cacheHit ? "true" : "false") +
                            ", durationMs=" + std::to_string(preparationDuration.count()) +
                            ", archive=\"" + toUtf8(downloadPath.wstring()) + "\"");
                    return anchors;
                }

                const std::wstring safeName = sanitizeFileName(sourceName).empty()
                    ? L"download"
                    : sanitizeFileName(sourceName);
                InstallStagingCachePayloadLease payload = ensureInstallStagingCachePayload(
                    paths.downloadsDirectory,
                    L"archive-staging",
                    archiveInstallStagingCacheKey(
                        downloadPath,
                        ExistingModInstallMode::FailIfExists,
                        safeName),
                    logger_,
                    [&](const std::filesystem::path& payloadDirectory)
                    {
                        materializeArchiveInstallCachePayload(
                            downloadPath,
                            payloadDirectory,
                            safeName,
                            logger_);
                    });
                return ModIdentityResolver::collectContentAnchors(payload.payloadDirectory());
            };
            return ModIdentityResolver::createInstallPlan(std::move(request), &logger_);
        };

        FluxoraInstallPlan localPlan = buildPlan(nullptr);
        if (localPlan.matchedTarget.has_value() || !trim(metadata.modId).empty())
        {
            return localPlan;
        }

        const std::optional<NexusMd5Identity> nexusMd5Identity =
            tryResolveNexusMd5Identity(
                projectDirectory,
                downloadPath,
                metadata.gameDomain,
                nexusAuth_,
                logger_);
        if (!nexusMd5Identity.has_value())
        {
            return localPlan;
        }

        FluxoraInstallPlan onlinePlan = buildPlan(&*nexusMd5Identity);
        onlinePlan.evidenceCodes.push_back(L"source.nexusMd5");
        return onlinePlan;
    }

    FluxoraInstallPlan DownloadService::planArchiveInstall(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& archivePath,
        std::wstring_view profileName,
        std::wstring_view requestedModName) const
    {
        const DownloadEntry imported = importLocalFile(projectDirectory, archivePath);
        return planDownloadInstall(
            projectDirectory,
            imported.localPath,
            profileName,
            requestedModName);
    }

    std::wstring DownloadService::archiveFingerprint(
        const std::filesystem::path& archivePath) const
    {
        if (archivePath.empty() || !std::filesystem::is_regular_file(archivePath))
        {
            throw std::invalid_argument("Install source archive does not exist.");
        }
        return fileCacheFingerprint(archivePath);
    }

    std::optional<InstalledMod> DownloadService::completedInstallResult(
        const std::filesystem::path& projectDirectory,
        std::wstring_view operationId) const
    {
        const PendingInstallSessionRecord session =
            InstanceMetadataStore::pendingInstallSession(projectDirectory, operationId);
        if (session.state != L"completed" || session.finalOrderId.empty())
        {
            return std::nullopt;
        }

        const BuildPathSettings paths = pathSettings_.loadForProjectDirectory(projectDirectory);
        const std::vector<ProfileOrderItemRecord> order =
            InstanceMetadataStore::listCachedProfileOrderItems(
                projectDirectory,
                session.profileName,
                paths.modsDirectory);
        const auto row = std::find_if(order.begin(), order.end(), [&](const auto& item)
        {
            return item.id == session.finalOrderId && item.hasMod;
        });
        if (row == order.end())
        {
            return std::nullopt;
        }

        const std::vector<ModFileSummaryRecord> summaries =
            InstanceMetadataStore::summarizePersistedInstalledModFiles(
                projectDirectory,
                paths.modsDirectory);
        const auto summary = std::find_if(summaries.begin(), summaries.end(), [&](const auto& item)
        {
            return item.folderName == row->mod.folderName;
        });
        return installedModFromRecord(
            row->mod,
            row->id,
            summary == summaries.end() ? nullptr : &summary->summary);
    }

    InstalledMod DownloadService::installDownload(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& downloadPath,
        std::wstring_view modName,
        ExistingModInstallMode existingModMode,
        const std::vector<PlacementOverride>& placementOverrides,
        const ModIdentityInstallSelection* identitySelection,
        std::wstring_view profileName,
        int modOrderTargetIndex,
        const InstallConflictSnapshotCallback& conflictProgress) const
    {
        if (downloadPath.empty() || !std::filesystem::exists(downloadPath) || !std::filesystem::is_regular_file(downloadPath))
        {
            throw std::invalid_argument("Download file does not exist.");
        }

        if (downloadPath.extension().wstring() == pendingNxmExtension)
        {
            throw std::invalid_argument("Download is not ready to install.");
        }

        DownloadMetadata metadata = readMetadata(downloadPath);
        if (metadata.isDownloading)
        {
            throw std::invalid_argument("Download is still in progress.");
        }

        const ArchiveCatalogEntry archive = archiveCatalog_.identifyArchive(
            projectDirectory,
            downloadPath);

        return installArchiveCore(
            logger_,
            pathSettings_,
            projectDirectory,
            downloadPath,
            archive.sha256,
            modName,
            existingModMode,
            std::move(metadata),
            true,
            "archive",
            placementOverrides,
            identitySelection,
            profileName,
            modOrderTargetIndex,
            conflictProgress);
    }

    InstalledMod DownloadService::installArchive(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& archivePath,
        std::wstring_view modName,
        ExistingModInstallMode existingModMode,
        const std::vector<PlacementOverride>& placementOverrides,
        const ModIdentityInstallSelection* identitySelection,
        std::wstring_view profileName,
        int modOrderTargetIndex,
        const InstallConflictSnapshotCallback& conflictProgress) const
    {
        const DownloadEntry imported = importLocalFile(projectDirectory, archivePath);
        return installDownload(
            projectDirectory,
            imported.localPath,
            modName,
            existingModMode,
            placementOverrides,
            identitySelection,
            profileName,
            modOrderTargetIndex,
            conflictProgress);
    }

    PlacementPlan DownloadService::analyzeDownloadContentLayout(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& downloadPath,
        ExistingModInstallMode existingModMode) const
    {
        if (downloadPath.empty() || !std::filesystem::exists(downloadPath) || !std::filesystem::is_regular_file(downloadPath))
        {
            throw std::invalid_argument("Download file does not exist.");
        }

        if (downloadPath.extension().wstring() == pendingNxmExtension)
        {
            throw std::invalid_argument("Download is not ready to analyze.");
        }

        const DownloadMetadata metadata = readMetadata(downloadPath);
        if (metadata.isDownloading)
        {
            throw std::invalid_argument("Download is still in progress.");
        }

        const BuildPathSettings paths = pathSettings_.loadForProjectDirectory(projectDirectory);
        const std::wstring fallbackName = trim(metadata.nexusModName).empty()
            ? downloadPath.stem().wstring()
            : trim(metadata.nexusModName);
        const std::wstring safeName = sanitizeFileName(fallbackName).empty()
            ? L"download"
            : sanitizeFileName(fallbackName);
        InstallStagingCachePayloadLease cachedPayload = ensureInstallStagingCachePayload(
            paths.downloadsDirectory,
            L"archive-staging",
            archiveInstallStagingCacheKey(downloadPath, existingModMode, safeName),
            logger_,
            [&](const std::filesystem::path& payloadDirectory)
            {
                materializeArchiveInstallCachePayload(downloadPath, payloadDirectory, safeName, logger_);
            });

        return analyzeContentLayoutForStaging(
            projectDirectory,
            cachedPayload.payloadDirectory(),
            existingModMode,
            false,
            fileCacheFingerprint(downloadPath),
            {},
            logger_);
    }

    FomodInstallerDescriptor DownloadService::analyzeFomodDownload(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& downloadPath,
        std::wstring_view profileName,
        const std::vector<FomodManualDecision>& manualDecisions) const
    {
        const auto analysisStartedAt = std::chrono::steady_clock::now();
        if (downloadPath.empty() || !std::filesystem::exists(downloadPath) || !std::filesystem::is_regular_file(downloadPath))
        {
            throw std::invalid_argument("Download file does not exist.");
        }

        if (downloadPath.extension().wstring() == pendingNxmExtension)
        {
            return {};
        }

        const DownloadMetadata metadata = readMetadata(downloadPath);
        if (metadata.isDownloading)
        {
            return {};
        }

        if (!isExtractableArchive(downloadPath))
        {
            return {};
        }

        const BuildPathSettings paths = pathSettings_.loadForProjectDirectory(projectDirectory);
        const std::wstring fallbackName = trim(metadata.nexusModName).empty()
            ? downloadPath.stem().wstring()
            : trim(metadata.nexusModName);

        const FomodPackageIdentity identity{
            !metadata.gameDomain.empty() ? L"nexus" : (metadata.source.empty() ? L"local" : L"manual"),
            metadata.gameDomain,
            metadata.modId,
            metadata.fileId,
            metadata.source.empty() ? downloadPath.wstring() : metadata.source,
            fallbackName
        };
        const std::wstring archiveFingerprint = fomodContextArchiveFingerprint(downloadPath);
        const std::vector<std::wstring> gameDataFolders =
            fomodGameDataFoldersForProject(projectDirectory);
        const auto analyzeDescriptor = [&](const std::filesystem::path& packageDirectory)
        {
            return FomodInstallerService::analyze(
                projectDirectory,
                paths.gameDirectory,
                paths.modsDirectory,
                packageDirectory,
                identity,
                gameDataFolders);
        };

        const std::wstring metadataCacheKey = fomodMetadataStagingCacheKey(downloadPath);
        bool metadataCacheHit = false;
        bool selectiveExtractionUsed = false;
        std::size_t indexedEntryCount = 0;
        std::size_t indexedPreviewCount = 0;
        std::chrono::milliseconds indexDuration{0};
        std::chrono::milliseconds xmlDuration{0};
        std::optional<FomodInstallerDescriptor> selectivelyParsedDescriptor;
        std::optional<InstallStagingCachePayloadLease> packagePayload;
        if (std::optional<InstallStagingCachePayloadLease> cached =
                tryInstallStagingCachePayload(
                    paths.downloadsDirectory,
                    L"fomod-metadata",
                    metadataCacheKey,
                    logger_);
            cached.has_value())
        {
            metadataCacheHit = true;
            packagePayload.emplace(std::move(cached.value()));
        }
        else
        {
            std::optional<std::vector<ZipArchiveEntry>> zipEntries;
            std::optional<IndexedFomodZip> indexedFomod;
            if (archiveExtension(downloadPath) == L".zip")
            {
                const auto indexStartedAt = std::chrono::steady_clock::now();
                zipEntries = indexZipArchive(downloadPath);
                indexDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now() - indexStartedAt);
                indexedEntryCount = zipEntries->size();
                indexedFomod = findIndexedFomodZip(zipEntries.value());
                if (!indexedFomod.has_value())
                {
                    const auto totalDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::steady_clock::now() - analysisStartedAt);
                    logger_.write(
                        LogLevel::Info,
                        "FomodPerformance",
                        "FOMOD archive index found no installer. cacheHit=false, entries=" +
                            std::to_string(indexedEntryCount) +
                            ", indexMs=" + std::to_string(indexDuration.count()) +
                            ", totalMs=" + std::to_string(totalDuration.count()) +
                            ", archive=\"" + toUtf8(downloadPath.wstring()) + "\"");
                    return {};
                }
            }

            packagePayload.emplace(ensureInstallStagingCachePayload(
                paths.downloadsDirectory,
                L"fomod-metadata",
                metadataCacheKey,
                logger_,
                [&](const std::filesystem::path& payloadDirectory)
                {
                    if (zipEntries.has_value() && indexedFomod.has_value())
                    {
                        selectiveExtractionUsed = materializeIndexedFomodMetadata(
                            downloadPath,
                            zipEntries.value(),
                            indexedFomod.value(),
                            payloadDirectory,
                            analyzeDescriptor,
                            indexedPreviewCount,
                            selectivelyParsedDescriptor,
                            xmlDuration);
                        if (selectiveExtractionUsed)
                        {
                            return;
                        }
                        clearDirectoryContents(payloadDirectory);
                    }

                    if (!extractArchiveToDirectory(downloadPath, payloadDirectory, logger_))
                    {
                        throw std::invalid_argument("Download does not contain an XML FOMOD installer.");
                    }
                }));
        }
        const std::filesystem::path& packageDirectory = packagePayload->payloadDirectory();

        FomodInstallerDescriptor descriptor;
        if (selectivelyParsedDescriptor.has_value())
        {
            descriptor = std::move(selectivelyParsedDescriptor.value());
        }
        else
        {
            const auto xmlStartedAt = std::chrono::steady_clock::now();
            descriptor = analyzeDescriptor(packageDirectory);
            xmlDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - xmlStartedAt);
        }
        if (!descriptor.isFomod)
        {
            discardInstallStagingCachePayload(packagePayload.value(), logger_);
            return {};
        }
        descriptor = analyzeFomodForProfile(
            logger_,
            projectDirectory,
            paths,
            packageDirectory,
            identity,
            archiveFingerprint,
            profileName,
            manualDecisions);

        const std::filesystem::path previewDirectory = fomodPreviewCacheDirectory(
            paths.downloadsDirectory,
            downloadPath,
            fallbackName);
        const auto previewStartedAt = std::chrono::steady_clock::now();
        const std::size_t previewCount = materializeFomodPreviewImages(
            descriptor,
            fomodPreviewPackageRoot(packageDirectory),
            previewDirectory);
        const auto previewDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - previewStartedAt);
        if (previewCount > 0)
        {
            logger_.write(
                LogLevel::Info,
                "Cached FOMOD preview images. count=" + std::to_string(previewCount) +
                    ", path=\"" + toUtf8(previewDirectory.wstring()) + "\"");
        }
        const auto totalDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - analysisStartedAt);
        logger_.write(
            LogLevel::Info,
            "FomodPerformance",
            "FOMOD fast analysis completed. cacheHit=" +
                std::string(metadataCacheHit ? "true" : "false") +
                ", selective=" + std::string(selectiveExtractionUsed ? "true" : "false") +
                ", entries=" + std::to_string(indexedEntryCount) +
                ", indexedPreviews=" + std::to_string(indexedPreviewCount) +
                ", materializedPreviews=" + std::to_string(previewCount) +
                ", indexMs=" + std::to_string(indexDuration.count()) +
                ", xmlMs=" + std::to_string(xmlDuration.count()) +
                ", previewMs=" + std::to_string(previewDuration.count()) +
                ", totalMs=" + std::to_string(totalDuration.count()) +
                ", archive=\"" + toUtf8(downloadPath.wstring()) + "\"");
        return descriptor;
    }

    PlacementPlan DownloadService::analyzeFomodDownloadContentLayout(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& downloadPath,
        ExistingModInstallMode existingModMode,
        const std::vector<std::wstring>& selectedOptionIds,
        std::wstring_view profileName,
        std::wstring_view fomodContextId,
        const std::vector<FomodManualDecision>& manualDecisions) const
    {
        if (downloadPath.empty() || !std::filesystem::exists(downloadPath) || !std::filesystem::is_regular_file(downloadPath))
        {
            throw std::invalid_argument("Download file does not exist.");
        }

        if (downloadPath.extension().wstring() == pendingNxmExtension)
        {
            throw std::invalid_argument("Download is not ready to analyze.");
        }

        const DownloadMetadata metadata = readMetadata(downloadPath);
        if (metadata.isDownloading)
        {
            throw std::invalid_argument("Download is still in progress.");
        }

        const BuildPathSettings paths = pathSettings_.loadForProjectDirectory(projectDirectory);
        const std::wstring archiveFingerprint = fomodContextArchiveFingerprint(downloadPath);
        if (!trim(std::wstring(fomodContextId)).empty())
        {
            const FomodProfileContext currentContext = FomodProfileContextService::build(
                FomodProfileContextRequest{
                    projectDirectory,
                    paths.gameDirectory,
                    paths.modsDirectory,
                    paths.profilesDirectory,
                    std::wstring(profileName),
                    fomodGameDataFoldersForProject(projectDirectory),
                    {}
                });
            FomodAutoSelectionService::validateContext(
                projectDirectory,
                archiveFingerprint,
                fomodContextId,
                currentContext);
        }
        const std::wstring fallbackName = trim(metadata.nexusModName).empty()
            ? downloadPath.stem().wstring()
            : trim(metadata.nexusModName);
        const std::wstring safeName = sanitizeFileName(fallbackName).empty()
            ? L"fomod"
            : sanitizeFileName(fallbackName);
        const std::filesystem::path stagingDirectory = uniquePath(
            paths.downloadsDirectory,
            L".fomod-layout-output-" + safeName);

        const PathSafetyService safety;
        safety.validateWritePath(paths.downloadsDirectory, stagingDirectory)
            .throwIfUnsafe("FOMOD output analysis path is unsafe");
        std::filesystem::create_directories(stagingDirectory);

        try
        {
            const FomodPackageIdentity identity{
                !metadata.gameDomain.empty() ? L"nexus" : (metadata.source.empty() ? L"local" : L"manual"),
                metadata.gameDomain,
                metadata.modId,
                metadata.fileId,
                metadata.source.empty() ? downloadPath.wstring() : metadata.source,
                safeName
            };

            {
                InstallStagingCachePayloadLease packagePayload = ensureInstallStagingCachePayload(
                    paths.downloadsDirectory,
                    L"fomod-package",
                    fomodPackageStagingCacheKey(downloadPath),
                    logger_,
                    [&](const std::filesystem::path& payloadDirectory)
                    {
                        if (!extractArchiveToDirectory(downloadPath, payloadDirectory, logger_))
                        {
                            throw std::invalid_argument("Download does not contain an XML FOMOD installer.");
                        }
                    });
                const std::filesystem::path& packageDirectory = packagePayload.payloadDirectory();

                const FomodInstallerDescriptor descriptor = analyzeFomodForProfile(
                    logger_,
                    projectDirectory,
                    paths,
                    packageDirectory,
                    identity,
                    archiveFingerprint,
                    profileName,
                    manualDecisions);
                if (!descriptor.isFomod)
                {
                    discardInstallStagingCachePayload(packagePayload, logger_);
                    throw std::invalid_argument("Download does not contain an XML FOMOD installer.");
                }
                if (descriptor.autoSelection != nullptr && descriptor.autoSelection->installBlocked)
                {
                    throw std::invalid_argument("FOMOD module dependencies are not satisfied.");
                }

                (void)FomodInstallerService::install(FomodInstallContext{
                    projectDirectory,
                    paths.gameDirectory,
                    paths.modsDirectory,
                    packageDirectory,
                    stagingDirectory,
                    identity,
                    selectedOptionIds,
                    fomodGameDataFoldersForProject(projectDirectory),
                    descriptor.profileContext.get()
                });
            }

            PlacementPlan plan = analyzeContentLayoutForStaging(
                projectDirectory,
                stagingDirectory,
                existingModMode,
                true,
                fomodOutputCacheFingerprint(downloadPath, selectedOptionIds),
                {},
                logger_);
            cleanupTemporaryDirectory(stagingDirectory, logger_, "FOMOD");
            return plan;
        }
        catch (const std::exception&)
        {
            cleanupTemporaryDirectory(stagingDirectory, logger_, "FOMOD");
            throw;
        }
    }

    InstalledMod DownloadService::installFomodDownload(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& downloadPath,
        std::wstring_view modName,
        ExistingModInstallMode existingModMode,
        const std::vector<std::wstring>& selectedOptionIds,
        const std::vector<PlacementOverride>& placementOverrides,
        const ModIdentityInstallSelection* identitySelection,
        std::wstring_view profileName,
        std::wstring_view fomodContextId,
        const std::vector<FomodManualDecision>& manualDecisions,
        int modOrderTargetIndex,
        const InstallConflictSnapshotCallback& conflictProgress) const
    {
        if (downloadPath.empty() || !std::filesystem::exists(downloadPath) || !std::filesystem::is_regular_file(downloadPath))
        {
            throw std::invalid_argument("Download file does not exist.");
        }

        if (downloadPath.extension().wstring() == pendingNxmExtension)
        {
            throw std::invalid_argument("Download is not ready to install.");
        }

        DownloadMetadata metadata = readMetadata(downloadPath);
        if (metadata.isDownloading)
        {
            throw std::invalid_argument("Download is still in progress.");
        }

        const ArchiveCatalogEntry archive = archiveCatalog_.identifyArchive(
            projectDirectory,
            downloadPath);

        return installFomodArchiveCore(
            logger_,
            pathSettings_,
            projectDirectory,
            downloadPath,
            archive.sha256,
            modName,
            existingModMode,
            selectedOptionIds,
            std::move(metadata),
            true,
            "fomod",
            placementOverrides,
            identitySelection,
            profileName,
            fomodContextId,
            manualDecisions,
            modOrderTargetIndex,
            conflictProgress);
    }

    InstalledMod DownloadService::installFomodArchive(
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& archivePath,
        std::wstring_view modName,
        ExistingModInstallMode existingModMode,
        const std::vector<std::wstring>& selectedOptionIds,
        const std::vector<PlacementOverride>& placementOverrides,
        const ModIdentityInstallSelection* identitySelection,
        std::wstring_view profileName,
        std::wstring_view fomodContextId,
        const std::vector<FomodManualDecision>& manualDecisions,
        int modOrderTargetIndex,
        const InstallConflictSnapshotCallback& conflictProgress) const
    {
        if (!trim(std::wstring(fomodContextId)).empty())
        {
            const BuildPathSettings paths = pathSettings_.loadForProjectDirectory(projectDirectory);
            const FomodProfileContext currentContext = FomodProfileContextService::build(
                FomodProfileContextRequest{
                    projectDirectory,
                    paths.gameDirectory,
                    paths.modsDirectory,
                    paths.profilesDirectory,
                    std::wstring(profileName),
                    fomodGameDataFoldersForProject(projectDirectory),
                    {}
                });
            FomodAutoSelectionService::validateContext(
                projectDirectory,
                fomodContextArchiveFingerprint(archivePath),
                fomodContextId,
                currentContext);
        }
        const DownloadEntry imported = importLocalFile(projectDirectory, archivePath);
        return installFomodDownload(
            projectDirectory,
            imported.localPath,
            modName,
            existingModMode,
            selectedOptionIds,
            placementOverrides,
            identitySelection,
            profileName,
            fomodContextId,
            manualDecisions,
            modOrderTargetIndex,
            conflictProgress);
    }

    bool DownloadService::isInitialized() const noexcept
    {
        return initialized_;
    }

    std::filesystem::path DownloadService::inboundDirectory() const
    {
        return resolveFluxoraDataDirectory() / L"Builds" / L"InboundDownloads";
    }
}
