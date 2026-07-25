#include "FluxoraCore/Services/FluxPackService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/FluxPackPackage.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "FluxoraCore/Support/FilesystemPath.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <cstdint>
#include <ctime>
#include <cwctype>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iterator>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <unordered_map>
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
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view packageFormat = L"FluxPack";
        constexpr int packageFormatVersion = fluxPackCurrentFormatVersion;
        constexpr std::wstring_view metadataExtension = L".fluxora.json";
        constexpr std::wstring_view defaultLocalGameDirectoryName = L"stock game";
        constexpr std::uintmax_t maxLegacyManifestBytes = 256ULL * 1024ULL * 1024ULL;

        struct DownloadMetadata
        {
            std::wstring source;
            std::wstring gameDomain;
            std::wstring modId;
            std::wstring fileId;
            std::wstring nexusModName;
            std::wstring version;
            std::wstring latestVersion;
            std::wstring destinationFileName;
        };

        struct DownloadSourceFile
        {
            std::filesystem::path path;
            DownloadMetadata metadata;
            std::wstring sha256;
            std::uintmax_t size{0};
        };

        struct FileManifestEntry
        {
            std::filesystem::path path;
            std::wstring relativePath;
            std::wstring sha256;
            std::uintmax_t size{0};
            std::optional<FluxPackPayloadReference> payload;
        };

        enum class FluxPackSourceInstallMode
        {
            Replace,
            Merge
        };

        struct PackModReference
        {
            InstalledModRecord mod;
            std::optional<DownloadSourceFile> sourceArchive;
            std::vector<FileManifestEntry> files;
            std::wstring archiveSha256;
            std::wstring archiveFileName;
            FluxPackSourceInstallMode installMode{FluxPackSourceInstallMode::Replace};
        };

        struct FluxPackSourceReference
        {
            std::wstring folderName;
            std::wstring displayName;
            std::wstring version;
            std::wstring archiveFileName;
            std::wstring archiveSha256;
            std::uintmax_t archiveSize{0};
            bool enabled{true};
            bool requiresDownload{true};
            ModSourceRecord source;
            FluxPackSourceInstallMode installMode{FluxPackSourceInstallMode::Replace};
        };

        struct FluxPackConfigReference
        {
            std::wstring relativePath;
            std::wstring sha256;
            std::uintmax_t size{0};
            std::wstring text;
            std::optional<FluxPackPayloadReference> payload;
            bool embedsText{false};
        };

        struct FluxPackEmbeddedFileReference
        {
            std::wstring relativePath;
            std::wstring sha256;
            std::uintmax_t size{0};
            std::wstring contentBase64;
            std::optional<FluxPackPayloadReference> payload;
            bool embedsContent{false};
        };

        struct FluxPackEmbeddedModReference
        {
            std::wstring folderName;
            std::wstring displayName;
            std::wstring version;
            bool enabled{true};
            ModSourceRecord source;
            std::vector<FluxPackEmbeddedFileReference> files;
        };

        struct FluxPackProfileOrderReference
        {
            std::wstring kind;
            std::wstring folderName;
            std::wstring separatorTitle;
        };

        struct FluxPackManifest
        {
            FluxPackSummary summary;
            std::wstring buildName;
            std::wstring templateId;
            std::filesystem::path gamePath;
            std::filesystem::path projectDirectoryHint;
            std::wstring defaultProfile;
            std::vector<FluxPackSourceReference> sourceArchives;
            std::vector<FluxPackEmbeddedModReference> bundledMods;
            std::vector<FluxPackEmbeddedModReference> generatedAssets;
            std::vector<FluxPackEmbeddedModReference> customPatches;
            std::vector<FluxPackConfigReference> customConfigs;
            std::vector<FluxPackProfileOrderReference> profileOrder;
            std::vector<FluxPackStoredChunk> contentChunks;
        };

        struct ResolvedFluxPackGameDirectory
        {
            std::filesystem::path path;
            bool validateExistingGame{true};
        };

        struct ProviderInstallState
        {
            std::wstring id;
            std::wstring displayName;
            std::uintmax_t total{0};
            std::uintmax_t completed{0};
            std::uintmax_t pending{0};
            std::uintmax_t failed{0};
            std::wstring currentItem;
            std::wstring statusText;
        };

        struct FluxPackDeltaApplyStatistics
        {
            std::uintmax_t reusedFileCount{0};
            std::uintmax_t materializedFileCount{0};
        };

        class FluxPackExportProgressReporter final
        {
        public:
            explicit FluxPackExportProgressReporter(
                std::function<void(const FluxPackExportProgress&)> callback)
                : callback_(std::move(callback))
            {
            }

            void publish(
                std::wstring phase,
                std::wstring currentStep,
                std::wstring currentItem,
                std::wstring statusMessage,
                int overallPercent,
                std::uintmax_t processedFileCount = 0,
                std::uintmax_t totalFileCount = 0,
                std::uintmax_t processedBytes = 0,
                std::uintmax_t totalBytes = 0,
                bool force = false)
            {
                if (!callback_)
                {
                    return;
                }

                overallPercent = std::clamp(overallPercent, 0, 100);
                if (!force && phase == lastPhase_ && overallPercent == lastPercent_)
                {
                    return;
                }

                lastPhase_ = phase;
                lastPercent_ = overallPercent;
                callback_(FluxPackExportProgress{
                    std::move(phase),
                    std::move(currentStep),
                    std::move(currentItem),
                    std::move(statusMessage),
                    overallPercent,
                    processedFileCount,
                    totalFileCount,
                    processedBytes,
                    totalBytes
                });
            }

        private:
            std::function<void(const FluxPackExportProgress&)> callback_;
            std::wstring lastPhase_;
            int lastPercent_{-1};
        };

        class FluxPackInstallCleanup final
        {
        public:
            FluxPackInstallCleanup(
                ProjectService& projects,
                Logger& logger,
                std::filesystem::path configPath)
                : projects_(projects),
                  logger_(logger),
                  configPath_(std::move(configPath))
            {
            }

            ~FluxPackInstallCleanup() noexcept
            {
                if (!active_)
                {
                    return;
                }

                try
                {
                    projects_.deleteProject(configPath_);
                    logger_.writeOperation(
                        LogLevel::Warning,
                        "FluxPack",
                        "Removed a partially installed FluxPack project after an error.");
                }
                catch (const std::exception& exception)
                {
                    try
                    {
                        logger_.writeOperation(
                            LogLevel::Error,
                            "FluxPack",
                            std::string("Failed to remove a partially installed FluxPack project: ") +
                                exception.what());
                    }
                    catch (...)
                    {
                    }
                }
            }

            void dismiss() noexcept
            {
                active_ = false;
            }

        private:
            ProjectService& projects_;
            Logger& logger_;
            std::filesystem::path configPath_;
            bool active_{true};
        };

        int progressPercent(
            int start,
            int end,
            std::uintmax_t current,
            std::uintmax_t total)
        {
            if (total == 0)
            {
                return end;
            }

            const long double ratio = std::min<long double>(
                1.0L,
                static_cast<long double>(current) / static_cast<long double>(total));
            return start + static_cast<int>(ratio * static_cast<long double>(end - start));
        }

        void addChecked(std::uintmax_t& total, std::uintmax_t value, std::string_view context)
        {
            if (value > std::numeric_limits<std::uintmax_t>::max() - total)
            {
                throw std::overflow_error("FluxPack size overflow while counting " + std::string(context) + ".");
            }
            total += value;
        }

        std::string toUtf8(const std::wstring& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }

            const int size = WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0,
                nullptr,
                nullptr);
            if (size <= 0)
            {
                throw std::runtime_error("Failed to encode FluxPack text as UTF-8.");
            }

            std::string out(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                out.data(),
                size,
                nullptr,
                nullptr);
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
                throw std::invalid_argument("FluxPack text is not valid UTF-8.");
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

        std::string pathForLog(const std::filesystem::path& path)
        {
            return toUtf8(path.wstring());
        }

        std::string readTextFile(const std::filesystem::path& path)
        {
            std::ifstream file(path, std::ios::in | std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("FluxPack file could not be opened.");
            }

            return std::string(
                std::istreambuf_iterator<char>(file),
                std::istreambuf_iterator<char>());
        }

        std::string tryReadTextFile(const std::filesystem::path& path)
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

        int base64Value(wchar_t ch)
        {
            if (ch >= L'A' && ch <= L'Z')
            {
                return static_cast<int>(ch - L'A');
            }
            if (ch >= L'a' && ch <= L'z')
            {
                return 26 + static_cast<int>(ch - L'a');
            }
            if (ch >= L'0' && ch <= L'9')
            {
                return 52 + static_cast<int>(ch - L'0');
            }
            if (ch == L'+')
            {
                return 62;
            }
            if (ch == L'/')
            {
                return 63;
            }
            return -1;
        }

        std::string base64Decode(std::wstring_view value)
        {
            std::string output;
            std::uint32_t buffer = 0;
            int bits = 0;

            for (wchar_t ch : value)
            {
                if (std::iswspace(ch))
                {
                    continue;
                }
                if (ch == L'=')
                {
                    break;
                }

                const int decoded = base64Value(ch);
                if (decoded < 0)
                {
                    throw std::invalid_argument("Embedded FluxPack file payload is not valid base64.");
                }

                buffer = (buffer << 6) | static_cast<std::uint32_t>(decoded);
                bits += 6;
                if (bits >= 8)
                {
                    bits -= 8;
                    output.push_back(static_cast<char>((buffer >> bits) & 0xff));
                }
            }

            return output;
        }

        void writeBinaryFile(const std::filesystem::path& path, std::string_view content)
        {
            std::ofstream file(path, std::ios::out | std::ios::trunc | std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Embedded FluxPack file could not be created.");
            }
            file.write(content.data(), static_cast<std::streamsize>(content.size()));
            if (!file)
            {
                throw std::runtime_error("Embedded FluxPack file could not be written.");
            }
        }

        std::wstring nowUtcText()
        {
            const auto now = std::chrono::system_clock::now();
            const std::time_t time = std::chrono::system_clock::to_time_t(now);

            std::tm utc{};
#ifdef _WIN32
            gmtime_s(&utc, &time);
#else
            gmtime_r(&time, &utc);
#endif

            std::wostringstream stream;
            stream << std::put_time(&utc, L"%Y-%m-%dT%H:%M:%SZ");
            return stream.str();
        }

        std::wstring toLower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        bool equalsIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
            return toLower(std::wstring(left)) == toLower(std::wstring(right));
        }

        bool pathExists(const std::filesystem::path& path)
        {
            std::error_code error;
            return std::filesystem::exists(path, error);
        }

        std::wstring normalizePathForComparison(const std::filesystem::path& path)
        {
            std::wstring text = std::filesystem::absolute(path).lexically_normal().wstring();
            while (text.size() > 1 && (text.back() == L'\\' || text.back() == L'/'))
            {
                text.pop_back();
            }

#ifdef _WIN32
            text = toLower(std::move(text));
#endif
            return text;
        }

        bool isSameOrInsidePath(
            const std::filesystem::path& candidate,
            const std::filesystem::path& root)
        {
            if (candidate.empty() || root.empty())
            {
                return false;
            }

            const std::wstring candidateText = normalizePathForComparison(candidate);
            const std::wstring rootText = normalizePathForComparison(root);
            if (candidateText == rootText)
            {
                return true;
            }
            if (candidateText.size() <= rootText.size())
            {
                return false;
            }

            const wchar_t separator = candidateText[rootText.size()];
            return (separator == L'\\' || separator == L'/') &&
                candidateText.compare(0, rootText.size(), rootText) == 0;
        }

        std::optional<std::filesystem::path> relativePathInsideRoot(
            const std::filesystem::path& candidate,
            const std::filesystem::path& root)
        {
            if (!isSameOrInsidePath(candidate, root))
            {
                return std::nullopt;
            }

            const std::filesystem::path relative =
                std::filesystem::absolute(candidate)
                    .lexically_normal()
                    .lexically_relative(std::filesystem::absolute(root).lexically_normal());
            if (relative.empty() || relative == L".")
            {
                return std::nullopt;
            }

            return relative.lexically_normal();
        }

        bool containsAny(std::wstring value, const std::vector<std::wstring_view>& needles)
        {
            value = toLower(std::move(value));
            for (std::wstring_view needle : needles)
            {
                if (value.find(needle) != std::wstring::npos)
                {
                    return true;
                }
            }

            return false;
        }

        bool isMetadataSidecar(const std::filesystem::path& path)
        {
            return path.filename().wstring().ends_with(metadataExtension);
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

        bool isTransientDownloadFile(const std::filesystem::path& path)
        {
            const std::wstring fileName = toLower(path.filename().wstring());
            return fileName.ends_with(L".part") ||
                fileName.ends_with(L".tmp") ||
                fileName.ends_with(L".meta") ||
                fileName.ends_with(L".cancel") ||
                fileName.ends_with(metadataExtension) ||
                isAtomicBackupFile(path);
        }

        std::filesystem::path metadataPath(const std::filesystem::path& path)
        {
            return std::filesystem::path(path.wstring() + std::wstring(metadataExtension));
        }

        std::wstring readStringOrDefault(
            const JsonValue& object,
            std::wstring_view field,
            std::wstring_view fallback = L"")
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr || !value->isString())
            {
                return std::wstring(fallback);
            }

            return value->asString();
        }

        bool readBoolOrDefault(
            const JsonValue& object,
            std::wstring_view field,
            bool fallback = false)
        {
            const JsonValue* value = object.find(field);
            return value != nullptr && value->type() == JsonValue::Type::Boolean
                ? value->asBoolean()
                : fallback;
        }

        std::uintmax_t readUnsignedOrDefault(
            const JsonValue& object,
            std::wstring_view field,
            std::uintmax_t fallback = 0)
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr)
            {
                return fallback;
            }

            try
            {
                if (value->isNumber())
                {
                    return static_cast<std::uintmax_t>(std::stoull(value->asNumber()));
                }
                if (value->isString())
                {
                    return static_cast<std::uintmax_t>(std::stoull(value->asString()));
                }
            }
            catch (const std::exception&)
            {
            }

            return fallback;
        }

        std::uintmax_t arraySize(const JsonValue& object, std::wstring_view field)
        {
            const JsonValue* value = object.find(field);
            return value != nullptr && value->isArray()
                ? static_cast<std::uintmax_t>(value->asArray().size())
                : 0;
        }

        std::wstring readHashValueOrDefault(const JsonValue& object, std::wstring_view field)
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr)
            {
                return {};
            }
            if (value->isObject())
            {
                return readStringOrDefault(*value, L"value");
            }
            if (value->isString())
            {
                return value->asString();
            }

            return {};
        }

        std::wstring sourceUrlForPack(const ModSourceRecord& source)
        {
            const std::wstring provider = toLower(source.provider);
            if ((provider == L"nexus" || provider.empty()) &&
                !source.gameDomain.empty() &&
                !source.remoteModId.empty())
            {
                if (!source.remoteFileId.empty())
                {
                    return L"nxm://" + source.gameDomain + L"/mods/" + source.remoteModId + L"/files/" + source.remoteFileId;
                }

                if (source.url.empty())
                {
                    return L"https://www.nexusmods.com/" + source.gameDomain + L"/mods/" + source.remoteModId;
                }
            }

            if (!source.url.empty())
            {
                return source.url;
            }

            return {};
        }

        DownloadMetadata readDownloadMetadata(const std::filesystem::path& archivePath)
        {
            const std::string content = tryReadTextFile(metadataPath(archivePath));
            if (content.empty())
            {
                return {};
            }

            try
            {
                const JsonValue root = JsonReader::parse(fromUtf8(content));
                if (!root.isObject())
                {
                    return {};
                }

                return DownloadMetadata{
                    readStringOrDefault(root, L"source"),
                    readStringOrDefault(root, L"gameDomain"),
                    readStringOrDefault(root, L"modId"),
                    readStringOrDefault(root, L"fileId"),
                    readStringOrDefault(root, L"nexusModName", readStringOrDefault(root, L"modName")),
                    readStringOrDefault(root, L"version"),
                    readStringOrDefault(root, L"latestVersion"),
                    readStringOrDefault(root, L"destinationFileName")
                };
            }
            catch (const std::exception&)
            {
                return {};
            }
        }

        std::wstring sha256File(const std::filesystem::path& path)
        {
            return computeFluxPackFileSha256(path);
        }

        void materializeFluxPackFileAtomically(
            const std::filesystem::path& target,
            std::uintmax_t expectedSize,
            const std::wstring& expectedSha256,
            std::wstring stateName,
            const std::function<void(const std::filesystem::path&)>& writer)
        {
            AtomicFileWriteOptions options;
            options.stateName = std::move(stateName);
            options.validation = ProjectStateValidation::None;
            options.keepBackup = false;
            options.validator = [expectedSize, expectedSha256](const std::filesystem::path& temporaryPath)
            {
                std::error_code sizeError;
                const std::uintmax_t actualSize =
                    std::filesystem::file_size(pathForFilesystemIo(temporaryPath), sizeError);
                if (sizeError || actualSize != expectedSize)
                {
                    throw std::runtime_error("FluxPack materialized file size does not match the manifest.");
                }
                if (!expectedSha256.empty() &&
                    !equalsIgnoreCase(sha256File(temporaryPath), expectedSha256))
                {
                    throw std::runtime_error("FluxPack materialized file hash does not match the manifest.");
                }
            };

            AtomicFileStore().writeFileAtomically(pathForFilesystemIo(target), writer, options);
        }

        bool canReuseMaterializedFile(
            const std::filesystem::path& path,
            std::uintmax_t expectedSize,
            std::wstring_view expectedSha256,
            Logger& logger)
        {
            if (expectedSha256.empty())
            {
                return false;
            }

            std::error_code statusError;
            const std::filesystem::path ioPath = pathForFilesystemIo(path);
            if (!std::filesystem::is_regular_file(ioPath, statusError) ||
                std::filesystem::is_symlink(ioPath, statusError))
            {
                return false;
            }

            const std::uintmax_t actualSize = std::filesystem::file_size(ioPath, statusError);
            if (statusError || actualSize != expectedSize)
            {
                return false;
            }

            try
            {
                return equalsIgnoreCase(sha256File(path), expectedSha256);
            }
            catch (const std::exception& exception)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "FluxPack",
                    "FluxPack delta could not hash an existing file; it will be materialized again. path=\"" +
                        pathForLog(path) + "\", reason=\"" + exception.what() + "\"");
                return false;
            }
        }

        bool sourceHasRemoteIdentity(const ModSourceRecord& source)
        {
            const std::wstring provider = toLower(source.provider);
            const std::wstring url = toLower(source.url);
            const bool hasNexusFileIdentity =
                !source.gameDomain.empty() &&
                !source.remoteModId.empty() &&
                !source.remoteFileId.empty();
            const bool hasNxmUrl = url.rfind(L"nxm://", 0) == 0;
            const bool isNexusLike =
                provider == L"nexus" ||
                hasNxmUrl ||
                url.find(L"nexusmods.com") != std::wstring::npos;
            if (isNexusLike)
            {
                return hasNxmUrl ||
                    hasNexusFileIdentity ||
                    url.find(L"/files/") != std::wstring::npos;
            }

            const bool hasRemoteUrl =
                url.rfind(L"https://", 0) == 0 ||
                url.rfind(L"http://", 0) == 0;

            return hasRemoteUrl ||
                (!source.remoteModId.empty() && !source.remoteFileId.empty());
        }

        bool sourceMatches(const DownloadMetadata& metadata, const ModSourceRecord& source)
        {
            if (!source.gameDomain.empty() &&
                !metadata.gameDomain.empty() &&
                !equalsIgnoreCase(source.gameDomain, metadata.gameDomain))
            {
                return false;
            }

            if (!source.remoteModId.empty() &&
                !metadata.modId.empty() &&
                !equalsIgnoreCase(source.remoteModId, metadata.modId))
            {
                return false;
            }

            if (!source.remoteFileId.empty() &&
                !metadata.fileId.empty() &&
                !equalsIgnoreCase(source.remoteFileId, metadata.fileId))
            {
                return false;
            }

            if (!source.remoteModId.empty() || !source.remoteFileId.empty())
            {
                if (!source.remoteModId.empty() && metadata.modId.empty())
                {
                    return false;
                }
                if (!source.remoteFileId.empty() && metadata.fileId.empty())
                {
                    return false;
                }

                return true;
            }

            if (!metadata.modId.empty() || !metadata.fileId.empty())
            {
                return false;
            }

            if (!source.url.empty() && !metadata.source.empty())
            {
                return equalsIgnoreCase(source.url, metadata.source);
            }

            return false;
        }

        std::vector<DownloadSourceFile> buildDownloadIndex(const std::filesystem::path& downloadsDirectory)
        {
            std::vector<DownloadSourceFile> files;
            std::error_code error;
            if (downloadsDirectory.empty() ||
                !std::filesystem::exists(downloadsDirectory, error) ||
                !std::filesystem::is_directory(downloadsDirectory, error))
            {
                return files;
            }

            for (const auto& entry : std::filesystem::directory_iterator(
                     downloadsDirectory,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    break;
                }

                std::error_code statusError;
                if (!entry.is_regular_file(statusError) ||
                    isMetadataSidecar(entry.path()) ||
                    isTransientDownloadFile(entry.path()))
                {
                    continue;
                }

                std::error_code sizeError;
                const std::uintmax_t size = entry.file_size(sizeError);
                files.push_back(DownloadSourceFile{
                    entry.path(),
                    readDownloadMetadata(entry.path()),
                    {},
                    sizeError ? 0 : size
                });
            }

            return files;
        }

        std::optional<DownloadSourceFile> matchSourceArchive(
            const InstalledModRecord& mod,
            std::vector<DownloadSourceFile>& downloads)
        {
            const auto match = std::find_if(
                downloads.begin(),
                downloads.end(),
                [&mod](const DownloadSourceFile& file)
                {
                    return sourceMatches(file.metadata, mod.source);
                });
            if (match == downloads.end())
            {
                return std::nullopt;
            }

            return *match;
        }

        std::optional<DownloadSourceFile> matchSourceArchiveBySha256(
            std::wstring_view archiveSha256,
            std::wstring_view archiveFileName,
            std::vector<DownloadSourceFile>& downloads)
        {
            if (archiveSha256.empty())
            {
                return std::nullopt;
            }

            if (!archiveFileName.empty())
            {
                const auto named = std::find_if(
                    downloads.begin(),
                    downloads.end(),
                    [archiveFileName](const DownloadSourceFile& file)
                    {
                        return equalsIgnoreCase(
                            file.path.filename().wstring(),
                            archiveFileName);
                    });
                if (named != downloads.end())
                {
                    if (named->sha256.empty())
                    {
                        named->sha256 = sha256File(named->path);
                    }
                    if (equalsIgnoreCase(named->sha256, archiveSha256))
                    {
                        return *named;
                    }
                }
            }

            for (DownloadSourceFile& file : downloads)
            {
                if (file.sha256.empty())
                {
                    file.sha256 = sha256File(file.path);
                }
                if (equalsIgnoreCase(file.sha256, archiveSha256))
                {
                    return file;
                }
            }
            return std::nullopt;
        }

        ModSourceRecord sourceRecordFromDownload(
            const DownloadMetadata& metadata,
            const ModSourceRecord& fallback = {})
        {
            ModSourceRecord source = fallback;
            if (!metadata.gameDomain.empty())
            {
                source.provider = L"nexus";
                source.gameDomain = metadata.gameDomain;
            }
            if (!metadata.modId.empty())
            {
                source.remoteModId = metadata.modId;
            }
            if (!metadata.fileId.empty())
            {
                source.remoteFileId = metadata.fileId;
            }
            if (!metadata.source.empty())
            {
                source.url = metadata.source;
            }
            if (!metadata.latestVersion.empty())
            {
                source.latestVersion = metadata.latestVersion;
            }
            else if (!metadata.version.empty())
            {
                source.latestVersion = metadata.version;
            }
            return source;
        }

        std::wstring_view sourceInstallModeId(FluxPackSourceInstallMode mode) noexcept
        {
            return mode == FluxPackSourceInstallMode::Merge ? L"merge" : L"replace";
        }

        bool isGeneratedAssetMod(const InstalledModRecord& mod)
        {
            if (toLower(mod.source.provider) == L"generated-bodyslide")
            {
                return true;
            }
            const std::wstring name = mod.folderName + L" " + mod.displayName;
            return containsAny(
                name,
                {
                    L"netlod",
                    L"netloda",
                    L"lodgen",
                    L"lod gen",
                    L"xlodgen",
                    L"dyndolod",
                    L"texgen",
                    L"loadgen",
                    L"load gen",
                    L"synthesis",
                    L"nemesis",
                    L"bodyslide",
                    L"body slide",
                    L"buddyslide",
                    L"pandora"
                });
        }

        bool isConfigFile(const std::filesystem::path& path)
        {
            const std::wstring extension = toLower(path.extension().wstring());
            const std::wstring fileName = toLower(path.filename().wstring());
            return extension == L".ini" ||
                extension == L".cfg" ||
                extension == L".toml" ||
                extension == L".json" ||
                extension == L".yaml" ||
                extension == L".yml" ||
                extension == L".xml" ||
                fileName == L"plugins.txt" ||
                fileName == L"loadorder.txt" ||
                fileName == L"modlist.txt";
        }

        std::wstring relativeToProject(
            const std::filesystem::path& path,
            const std::filesystem::path& projectDirectory)
        {
            std::error_code error;
            std::filesystem::path relative = std::filesystem::relative(path, projectDirectory, error);
            if (error || relative.empty())
            {
                relative = path.lexically_normal();
            }

            return relative.generic_wstring();
        }

        std::filesystem::path normalizePathForFluxPack(
            const std::filesystem::path& path,
            const std::filesystem::path& relativeRoot = {})
        {
            if (path.empty())
            {
                return {};
            }

            std::filesystem::path resolved = path;
            if (resolved.is_relative() && !relativeRoot.empty())
            {
                resolved = relativeRoot / resolved;
            }

            return std::filesystem::absolute(resolved).lexically_normal();
        }

        bool isExcludedPayloadPath(
            const std::filesystem::path& path,
            const std::vector<std::filesystem::path>& exclusions)
        {
            const std::wstring candidate = normalizePathForComparison(path);
            return std::any_of(exclusions.begin(), exclusions.end(), [&candidate](const std::filesystem::path& excluded)
            {
                return candidate == normalizePathForComparison(excluded);
            });
        }

        FileManifestEntry describePayloadFile(
            const std::filesystem::path& path,
            std::wstring relativePath)
        {
            std::error_code sizeError;
            const std::uintmax_t size = std::filesystem::file_size(pathForFilesystemIo(path), sizeError);
            if (sizeError)
            {
                throw std::filesystem::filesystem_error(
                    "FluxPack payload file size could not be read.",
                    path,
                    sizeError);
            }

            FileManifestEntry entry;
            entry.path = path;
            entry.relativePath = std::move(relativePath);
            entry.size = size;
            return entry;
        }

        std::vector<FileManifestEntry> scanPayloadFiles(
            const std::filesystem::path& root,
            const std::filesystem::path& logicalRoot,
            const std::filesystem::path& projectDirectory,
            bool configOnly)
        {
            std::vector<FileManifestEntry> files;
            if (root.empty())
            {
                return files;
            }
            const std::filesystem::path absoluteRoot =
                std::filesystem::absolute(root).lexically_normal();
            const std::filesystem::path absoluteProjectDirectory =
                std::filesystem::absolute(projectDirectory).lexically_normal();
            const std::filesystem::path absoluteLogicalRoot =
                std::filesystem::absolute(logicalRoot).lexically_normal();
            const std::filesystem::path logicalRelativeRoot =
                absoluteLogicalRoot.lexically_relative(absoluteProjectDirectory);
            if (logicalRelativeRoot.empty() || logicalRelativeRoot.is_absolute())
            {
                throw std::invalid_argument("FluxPack logical payload root is outside the project layout.");
            }
            PathSafetyService().validateRelativePath(logicalRelativeRoot)
                .throwIfUnsafe("FluxPack logical payload root is unsafe");

            const std::filesystem::path filesystemRoot = pathForFilesystemIo(absoluteRoot);
            std::error_code error;
            if (!std::filesystem::exists(filesystemRoot, error) ||
                !std::filesystem::is_directory(filesystemRoot, error))
            {
                return files;
            }

            for (const auto& entry : std::filesystem::recursive_directory_iterator(
                     filesystemRoot,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    throw std::filesystem::filesystem_error(
                        "FluxPack payload directory could not be scanned.",
                        absoluteRoot,
                        error);
                }

                const std::filesystem::path relative =
                    entry.path().lexically_relative(filesystemRoot);
                if (relative.empty() || relative.is_absolute())
                {
                    throw std::invalid_argument(
                        "FluxPack payload path could not be made relative to its source root.");
                }
                const std::filesystem::path sourcePath =
                    (absoluteRoot / relative).lexically_normal();

                std::error_code statusError;
                if (entry.is_symlink(statusError))
                {
                    continue;
                }
                if (statusError)
                {
                    throw std::filesystem::filesystem_error(
                        "FluxPack payload file type could not be inspected.",
                        sourcePath,
                        statusError);
                }
                const bool isRegularFile = entry.is_regular_file(statusError);
                if (statusError)
                {
                    throw std::filesystem::filesystem_error(
                        "FluxPack payload file type could not be inspected.",
                        sourcePath,
                        statusError);
                }
                if (!isRegularFile)
                {
                    continue;
                }
                if (configOnly && !isConfigFile(sourcePath))
                {
                    continue;
                }

                const std::filesystem::path logicalRelativePath =
                    (logicalRelativeRoot / relative).lexically_normal();
                PathSafetyService().validateRelativePath(logicalRelativePath)
                    .throwIfUnsafe("FluxPack logical payload path is unsafe");
                files.push_back(describePayloadFile(
                    sourcePath,
                    logicalRelativePath.generic_wstring()));
            }

            std::sort(files.begin(), files.end(), [](const FileManifestEntry& left, const FileManifestEntry& right)
            {
                return left.relativePath < right.relativePath;
            });
            return files;
        }

        void writeHash(
            JsonWriter& writer,
            std::wstring_view value,
            std::wstring_view status)
        {
            writer.beginObject();
            writer.field(L"algorithm", L"sha256");
            writer.field(L"value", value);
            writer.field(L"status", status);
            writer.endObject();
        }

        void writeSource(JsonWriter& writer, const ModSourceRecord& source)
        {
            writer.beginObject();
            writer.field(L"provider", source.provider);
            writer.field(L"gameDomain", source.gameDomain);
            writer.field(L"remoteModId", source.remoteModId);
            writer.field(L"remoteFileId", source.remoteFileId);
            writer.field(L"url", sourceUrlForPack(source));
            writer.field(L"latestVersion", source.latestVersion);
            writer.field(L"lastCheckedAt", source.lastCheckedAt);
            writer.endObject();
        }

        void writeFileEntry(JsonWriter& writer, const FileManifestEntry& file)
        {
            writer.beginObject();
            writer.field(L"relativePath", file.relativePath);
            writer.field(L"size", file.size);
            writer.key(L"hash");
            writeHash(writer, file.sha256, file.sha256.empty() ? L"unavailable" : L"matched");
            writer.field(L"embedsText", false);
            writer.field(L"embedsContent", file.payload.has_value());
            if (file.payload.has_value())
            {
                writer.key(L"payload").beginObject();
                writer.field(L"size", file.payload->size);
                writer.key(L"chunks").beginArray();
                for (const FluxPackPayloadChunkReference& chunk : file.payload->chunks)
                {
                    writer.beginObject();
                    writer.field(L"hash", chunk.sha256);
                    writer.field(L"offset", chunk.offset);
                    writer.field(L"size", chunk.size);
                    writer.endObject();
                }
                writer.endArray();
                writer.endObject();
            }
            writer.endObject();
        }

        void writeFileEntries(JsonWriter& writer, const std::vector<FileManifestEntry>& files)
        {
            writer.beginArray();
            for (const FileManifestEntry& file : files)
            {
                writeFileEntry(writer, file);
            }
            writer.endArray();
        }

        void writeModReference(
            JsonWriter& writer,
            const PackModReference& reference,
            bool includeFileManifest,
            bool requiresDownload)
        {
            const InstalledModRecord& mod = reference.mod;
            writer.beginObject();
            writer.field(L"id", mod.uuid.empty() ? mod.folderName : mod.uuid);
            writer.field(L"folderName", mod.folderName);
            writer.field(L"displayName", mod.displayName.empty() ? mod.folderName : mod.displayName);
            writer.field(L"version", mod.version);
            writer.field(L"enabled", !equalsIgnoreCase(mod.state, L"disabled"));
            if (requiresDownload)
            {
                writer.field(L"installMode", sourceInstallModeId(reference.installMode));
            }
            writer.field(L"contentFingerprint", mod.contentFingerprint);
            writer.field(L"installedAt", mod.installedAt);
            writer.field(L"updatedAt", mod.updatedAt);
            writer.key(L"source");
            writeSource(writer, mod.source);
            writer.key(L"archiveHash");
            if (reference.sourceArchive.has_value())
            {
                writeHash(writer, reference.sourceArchive->sha256, L"matched-local-download");
            }
            else if (!reference.archiveSha256.empty())
            {
                writeHash(writer, reference.archiveSha256, L"known-install-source");
            }
            else
            {
                writeHash(writer, L"", L"source-archive-not-included");
            }
            if (reference.sourceArchive.has_value())
            {
                writer.field(L"archiveFileName", reference.sourceArchive->path.filename().wstring());
                writer.field(L"archiveSize", reference.sourceArchive->size);
            }
            else
            {
                writer.field(L"archiveFileName", reference.archiveFileName);
                writer.field(L"archiveSize", static_cast<std::uintmax_t>(0));
            }
            writer.field(L"requiresDownload", requiresDownload);

            if (includeFileManifest)
            {
                writer.key(L"files");
                writeFileEntries(writer, reference.files);
            }
            writer.endObject();
        }

        void writeModReferences(
            JsonWriter& writer,
            const std::vector<PackModReference>& references,
            bool includeFileManifest,
            bool requiresDownload)
        {
            writer.beginArray();
            for (const PackModReference& reference : references)
            {
                writeModReference(
                    writer,
                    reference,
                    includeFileManifest,
                    requiresDownload);
            }
            writer.endArray();
        }

        void writeProfileOrder(
            JsonWriter& writer,
            const std::vector<ProfileOrderItemRecord>& order)
        {
            writer.beginArray();
            for (const ProfileOrderItemRecord& item : order)
            {
                writer.beginObject();
                writer.field(L"kind", item.kind);
                writer.field(L"position", item.position);
                if (item.hasMod)
                {
                    writer.field(L"folderName", item.mod.folderName);
                    writer.field(L"enabled", !equalsIgnoreCase(item.mod.state, L"disabled"));
                }
                else
                {
                    writer.field(L"separatorTitle", item.separatorTitle);
                }
                writer.endObject();
            }
            writer.endArray();
        }

        void writeInstallPlan(
            JsonWriter& writer,
            const ProjectOpenResult& project,
            const std::vector<ProfileOrderItemRecord>& profileOrder,
            bool includeGeneratedAssets,
            FluxPackPackageType packageType)
        {
            const std::wstring defaultProfile = project.resolvedTemplate.defaultProfileName.empty()
                ? L"Default"
                : project.resolvedTemplate.defaultProfileName;

            writer.beginObject();
            writer.field(L"version", 1);
            writer.field(L"defaultProfile", defaultProfile);
            writer.key(L"stages").beginArray();

            writer.beginObject();
            const bool fullPackage = packageType == FluxPackPackageType::Full;
            writer.field(L"id", fullPackage ? L"bundled-mods" : L"source-archives");
            writer.field(
                L"title",
                fullPackage ? L"Restore bundled mods" : L"Download and verify source archives");
            writer.field(L"policy", fullPackage ? L"package-payload" : L"reference-only");
            writer.stringArray(L"requires", {});
            writer.endObject();

            writer.beginObject();
            writer.field(L"id", L"generated-assets");
            writer.field(L"title", L"Restore approved generated assets");
            writer.field(L"policy", includeGeneratedAssets ? L"approved-manifest" : L"user-confirmation-required");
            writer.stringArray(L"requires", {fullPackage ? L"bundled-mods" : L"source-archives"});
            writer.endObject();

            writer.beginObject();
            writer.field(L"id", L"custom-patches");
            writer.field(L"title", L"Restore custom patches");
            writer.field(L"policy", L"project-local-manifest");
            writer.stringArray(L"requires", {fullPackage ? L"bundled-mods" : L"source-archives"});
            writer.endObject();

            writer.beginObject();
            writer.field(L"id", L"custom-configs");
            writer.field(L"title", L"Apply profiles and configuration presets");
            writer.field(L"policy", L"package-payload");
            writer.stringArray(L"requires", {L"generated-assets", L"custom-patches"});
            writer.endObject();

            writer.endArray();
            writer.key(L"profileOrder");
            writeProfileOrder(writer, profileOrder);
            writer.key(L"targetPaths").beginObject();
            writer.field(L"modsDirectory", L"mods");
            writer.field(L"profilesDirectory", L"profiles");
            writer.field(L"overwriteDirectory", L"overwrite");
            writer.endObject();
            writer.endObject();
        }

        void writeContentStore(
            JsonWriter& writer,
            const std::vector<FluxPackStoredChunk>& chunks,
            const FluxPackContentStoreStatistics& statistics)
        {
            writer.beginObject();
            writer.field(L"version", 1);
            writer.field(L"hashAlgorithm", L"sha256");
            writer.field(L"compressionMode", fluxPackCompressionModeId(statistics.compressionMode));
            writer.field(L"logicalBytes", statistics.logicalBytes);
            writer.field(L"uniqueBytes", statistics.uniqueBytes);
            writer.field(L"storedBytes", statistics.storedBytes);
            writer.field(L"deduplicatedBytes", statistics.deduplicatedBytes);
            writer.field(L"uniqueChunkCount", statistics.uniqueChunkCount);
            writer.field(L"dictionaryCount", statistics.dictionaryCount);
            writer.key(L"chunking").beginObject();
            writer.field(L"algorithm", L"fastcdc");
            writer.field(L"minimumBytes", static_cast<std::uintmax_t>(64 * 1024));
            writer.field(L"averageBytes", static_cast<std::uintmax_t>(256 * 1024));
            writer.field(L"maximumBytes", static_cast<std::uintmax_t>(1024 * 1024));
            writer.endObject();
            writer.key(L"chunks").beginArray();
            for (const FluxPackStoredChunk& chunk : chunks)
            {
                writer.beginObject();
                writer.field(L"hash", chunk.sha256);
                writer.field(L"offset", chunk.offset);
                writer.field(L"storedSize", chunk.storedSize);
                writer.field(L"originalSize", chunk.originalSize);
                writer.field(
                    L"compression",
                    chunk.compression == FluxPackChunkCompression::Zstandard ? L"zstd" : L"none");
                writer.field(L"compressionLevel", chunk.compressionLevel);
                writer.field(L"dictionaryHash", chunk.dictionarySha256);
                writer.field(L"kind", chunk.isDictionary ? L"dictionary" : L"content");
                writer.endObject();
            }
            writer.endArray();
            writer.endObject();
        }

        std::wstring serializeFluxPack(
            const ProjectOpenResult& project,
            const BuildPathSettings& paths,
            const std::vector<PackModReference>& sourceArchives,
            const std::vector<PackModReference>& bundledMods,
            const std::vector<PackModReference>& generatedAssets,
            const std::vector<PackModReference>& customPatches,
            const std::vector<FileManifestEntry>& customConfigs,
            const std::vector<ProfileOrderItemRecord>& profileOrder,
            const std::vector<FluxPackStoredChunk>& contentChunks,
            const FluxPackContentStoreStatistics& contentStoreStatistics,
            bool includeGeneratedAssets,
            FluxPackPackageType packageType)
        {
            JsonWriter writer;
            writer.beginObject();
            writer.field(L"format", packageFormat);
            writer.field(L"formatVersion", packageFormatVersion);
            writer.field(L"createdAtUtc", nowUtcText());
            writer.field(L"packageType", fluxPackPackageTypeId(packageType));
            writer.key(L"build").beginObject();
            writer.field(L"name", project.project.name);
            writer.field(L"templateId", project.project.templateId);
            writer.field(L"gameName", project.project.gameName);
            writer.field(
                L"gamePath",
                (paths.gameDirectory.empty() ? project.project.gamePath : paths.gameDirectory).wstring());
            writer.field(L"projectDirectoryHint", project.project.projectDirectory.wstring());
            writer.field(L"defaultProfile", project.resolvedTemplate.defaultProfileName);
            writer.endObject();

            writer.key(L"policies").beginObject();
            writer.field(
                L"sourceArchives",
                packageType == FluxPackPackageType::Full ? L"not-required" : L"reference-only");
            writer.field(
                L"bundledMods",
                packageType == FluxPackPackageType::Full ? L"package-payload" : L"not-included");
            writer.field(L"generatedAssets", includeGeneratedAssets ? L"approved-manifest" : L"confirm-before-including");
            writer.field(L"customPatches", L"project-local-manifest");
            writer.field(L"customConfigs", L"package-payload");
            writer.endObject();

            writer.key(L"contentStore");
            writeContentStore(writer, contentChunks, contentStoreStatistics);

            writer.key(L"sourceArchives");
            writeModReferences(writer, sourceArchives, false, true);
            writer.key(L"bundledMods");
            writeModReferences(writer, bundledMods, true, false);
            writer.key(L"generatedAssets");
            writeModReferences(
                writer,
                generatedAssets,
                includeGeneratedAssets,
                false);
            writer.key(L"customPatches");
            writeModReferences(writer, customPatches, true, false);
            writer.key(L"customConfigs");
            writeFileEntries(writer, customConfigs);
            writer.key(L"installPlan");
            writeInstallPlan(writer, project, profileOrder, includeGeneratedAssets, packageType);
            writer.endObject();
            return writer.str();
        }

        FluxPackSummary summaryFromJson(
            const JsonValue& root,
            const std::filesystem::path& path,
            std::uintmax_t manifestBytes)
        {
            if (!root.isObject())
            {
                throw std::invalid_argument("FluxPack manifest must be a JSON object.");
            }

            if (readStringOrDefault(root, L"format") != packageFormat)
            {
                throw std::invalid_argument("Selected file is not a FluxPack manifest.");
            }

            const std::uintmax_t formatVersion = readUnsignedOrDefault(root, L"formatVersion", 1);
            if (formatVersion == 0 || formatVersion > static_cast<std::uintmax_t>(packageFormatVersion))
            {
                throw std::invalid_argument("FluxPack format version is not supported by this Fluxora build.");
            }

            FluxPackSummary summary;
            summary.outputPath = path;
            summary.formatVersion = static_cast<int>(formatVersion);
            summary.manifestBytes = manifestBytes;
            summary.sourceArchiveCount = arraySize(root, L"sourceArchives");
            summary.bundledModCount = arraySize(root, L"bundledMods");
            summary.generatedAssetCount = arraySize(root, L"generatedAssets");
            summary.customPatchCount = arraySize(root, L"customPatches");
            summary.customConfigCount = arraySize(root, L"customConfigs");
            summary.installStepCount = 0;
            summary.packageType = readStringOrDefault(root, L"packageType", L"recipe");
            if (summary.packageType != L"full" && summary.packageType != L"recipe")
            {
                throw std::invalid_argument("FluxPack package type is not supported.");
            }
            if (const JsonValue* installPlan = root.find(L"installPlan");
                installPlan != nullptr && installPlan->isObject())
            {
                summary.installPlanAvailable = true;
                summary.installStepCount = arraySize(*installPlan, L"stages");
            }

            if (const JsonValue* build = root.find(L"build");
                build != nullptr && build->isObject())
            {
                summary.buildName = readStringOrDefault(*build, L"name");
            }

            if (const JsonValue* policies = root.find(L"policies");
                policies != nullptr && policies->isObject())
            {
                summary.generatedAssetsIncluded =
                    readStringOrDefault(*policies, L"generatedAssets") == L"approved-manifest";
            }

            if (const JsonValue* contentStore = root.find(L"contentStore");
                contentStore != nullptr && contentStore->isObject())
            {
                summary.compressionMode = readStringOrDefault(
                    *contentStore,
                    L"compressionMode",
                    L"optimal");
                summary.logicalPayloadBytes = readUnsignedOrDefault(*contentStore, L"logicalBytes");
                summary.uniquePayloadBytes = readUnsignedOrDefault(*contentStore, L"uniqueBytes");
                summary.storedPayloadBytes = readUnsignedOrDefault(*contentStore, L"storedBytes");
                summary.deduplicatedPayloadBytes =
                    readUnsignedOrDefault(*contentStore, L"deduplicatedBytes");
                summary.uniqueChunkCount =
                    readUnsignedOrDefault(*contentStore, L"uniqueChunkCount");
                summary.dictionaryCount =
                    readUnsignedOrDefault(*contentStore, L"dictionaryCount");
            }

            return summary;
        }

        bool startsWithIgnoreCase(std::wstring_view value, std::wstring_view prefix)
        {
            if (value.size() < prefix.size())
            {
                return false;
            }

            return toLower(std::wstring(value.substr(0, prefix.size()))) == toLower(std::wstring(prefix));
        }

        bool containsIgnoreCase(std::wstring_view value, std::wstring_view needle)
        {
            return toLower(std::wstring(value)).find(toLower(std::wstring(needle))) != std::wstring::npos;
        }

        ModSourceRecord readModSourceRecord(const JsonValue& value)
        {
            if (!value.isObject())
            {
                return {};
            }

            return ModSourceRecord{
                readStringOrDefault(value, L"provider"),
                readStringOrDefault(value, L"gameDomain"),
                readStringOrDefault(value, L"remoteModId"),
                readStringOrDefault(value, L"remoteFileId"),
                readStringOrDefault(value, L"url"),
                readStringOrDefault(value, L"lastCheckedAt"),
                readStringOrDefault(value, L"latestVersion")
            };
        }

        std::wstring providerIdForSource(const FluxPackSourceReference& reference)
        {
            const std::wstring provider = toLower(reference.source.provider);
            const std::wstring url = toLower(reference.source.url);
            if (provider == L"nexus" ||
                startsWithIgnoreCase(reference.source.url, L"nxm://") ||
                url.find(L"nexusmods.com") != std::wstring::npos ||
                (!reference.source.gameDomain.empty() &&
                 (!reference.source.remoteModId.empty() || !reference.source.remoteFileId.empty())))
            {
                return L"nexus";
            }
            if (provider == L"github" || url.find(L"github.com") != std::wstring::npos)
            {
                return L"github";
            }
            if (provider == L"mega" || url.find(L"mega.nz") != std::wstring::npos)
            {
                return L"mega";
            }
            if (provider == L"moddingflow" ||
                provider == L"modding-flow" ||
                provider == L"modernflow" ||
                provider == L"modern-flow")
            {
                return L"moddingflow";
            }
            if (!provider.empty())
            {
                return provider;
            }
            return reference.source.url.empty() ? L"unknown" : L"direct";
        }

        std::wstring providerDisplayName(std::wstring_view providerId)
        {
            const std::wstring id = toLower(std::wstring(providerId));
            if (id == L"nexus")
            {
                return L"Nexus Mods";
            }
            if (id == L"github")
            {
                return L"GitHub";
            }
            if (id == L"mega")
            {
                return L"MEGA";
            }
            if (id == L"moddingflow" || id == L"modding-flow" || id == L"modernflow")
            {
                return L"ModdingFlow";
            }
            if (id == L"direct")
            {
                return L"Прямая ссылка";
            }
            return id.empty() || id == L"unknown" ? L"Другие источники" : std::wstring(providerId);
        }

        std::wstring sourceInstallName(const FluxPackSourceReference& reference)
        {
            if (!reference.displayName.empty())
            {
                return reference.displayName;
            }
            if (!reference.folderName.empty())
            {
                return reference.folderName;
            }
            if (!reference.source.remoteModId.empty())
            {
                return L"Mod " + reference.source.remoteModId;
            }
            return L"Мод";
        }

        std::wstring sourceInstallTargetName(const FluxPackSourceReference& reference)
        {
            return reference.folderName.empty()
                ? sourceInstallName(reference)
                : reference.folderName;
        }

        std::wstring sourceInstallId(
            const FluxPackSourceReference& reference,
            std::size_t index)
        {
            return L"source-" + std::to_wstring(index) + L":" +
                providerIdForSource(reference) + L":" +
                reference.source.gameDomain + L":" +
                reference.source.remoteModId + L":" +
                reference.source.remoteFileId;
        }

        std::wstring manualDownloadUrlForSource(const FluxPackSourceReference& reference)
        {
            if (providerIdForSource(reference) == L"nexus" &&
                !reference.source.gameDomain.empty() &&
                !reference.source.remoteModId.empty())
            {
                std::wstring url = L"https://www.nexusmods.com/" + reference.source.gameDomain +
                    L"/mods/" + reference.source.remoteModId;
                if (!reference.source.remoteFileId.empty())
                {
                    url += L"?tab=files&file_id=" + reference.source.remoteFileId;
                }
                return url;
            }

            return startsWithIgnoreCase(reference.source.url, L"https://") ||
                    startsWithIgnoreCase(reference.source.url, L"http://")
                ? reference.source.url
                : std::wstring{};
        }

        bool installedSourceMatches(
            const InstalledModRecord& installed,
            const FluxPackSourceReference& requested)
        {
            std::error_code directoryError;
            if (installed.path.empty() ||
                !std::filesystem::is_directory(pathForFilesystemIo(installed.path), directoryError))
            {
                return false;
            }

            if (!requested.folderName.empty() &&
                !equalsIgnoreCase(installed.folderName, requested.folderName))
            {
                return false;
            }

            const ModSourceRecord& current = installed.source;
            const ModSourceRecord& target = requested.source;
            if (!target.remoteFileId.empty())
            {
                if (!equalsIgnoreCase(current.remoteFileId, target.remoteFileId) ||
                    (!target.remoteModId.empty() &&
                     !equalsIgnoreCase(current.remoteModId, target.remoteModId)) ||
                    (!target.gameDomain.empty() &&
                     !equalsIgnoreCase(current.gameDomain, target.gameDomain)))
                {
                    return false;
                }

                return true;
            }

            if (target.url.empty() || !equalsIgnoreCase(current.url, target.url))
            {
                return false;
            }

            return requested.version.empty() ||
                (!installed.version.empty() && equalsIgnoreCase(installed.version, requested.version));
        }

        const InstalledModRecord* findReusableInstalledSource(
            const std::vector<InstalledModRecord>& installedMods,
            const FluxPackSourceReference& requested)
        {
            const auto match = std::find_if(
                installedMods.begin(),
                installedMods.end(),
                [&requested](const InstalledModRecord& installed)
                {
                    return installedSourceMatches(installed, requested);
                });
            return match == installedMods.end() ? nullptr : &*match;
        }

        std::vector<bool> reusableInstalledSourceFlags(
            const std::vector<InstalledModRecord>& installedMods,
            const std::vector<InstalledModArchiveSourceRecord>& installedArchiveSources,
            const std::vector<FluxPackSourceReference>& requestedSources)
        {
            std::vector<bool> reusable(requestedSources.size(), false);
            std::unordered_map<std::wstring, std::vector<std::size_t>> requestedByTarget;
            for (std::size_t index = 0; index < requestedSources.size(); ++index)
            {
                requestedByTarget[toLower(sourceInstallTargetName(requestedSources[index]))]
                    .push_back(index);
            }

            std::unordered_map<std::wstring, std::vector<std::wstring>> hashesByModUuid;
            for (const InstalledModArchiveSourceRecord& source : installedArchiveSources)
            {
                hashesByModUuid[source.modUuid].push_back(source.archiveSha256);
            }

            for (const auto& [targetKey, sourceIndices] : requestedByTarget)
            {
                const bool isComposition =
                    sourceIndices.size() > 1 ||
                    std::any_of(
                        sourceIndices.begin(),
                        sourceIndices.end(),
                        [&requestedSources](std::size_t index)
                        {
                            return requestedSources[index].installMode ==
                                FluxPackSourceInstallMode::Merge;
                        });
                if (!isComposition)
                {
                    const std::size_t index = sourceIndices.front();
                    reusable[index] =
                        findReusableInstalledSource(
                            installedMods,
                            requestedSources[index]) != nullptr;
                    continue;
                }

                const auto installed = std::find_if(
                    installedMods.begin(),
                    installedMods.end(),
                    [&targetKey](const InstalledModRecord& mod)
                    {
                        return toLower(mod.folderName) == targetKey;
                    });
                if (installed == installedMods.end())
                {
                    continue;
                }

                const auto installedHashes = hashesByModUuid.find(installed->uuid);
                if (installedHashes == hashesByModUuid.end())
                {
                    continue;
                }
                const bool compositionMatches = std::all_of(
                    sourceIndices.begin(),
                    sourceIndices.end(),
                    [&](std::size_t index)
                    {
                        const std::wstring& requestedHash =
                            requestedSources[index].archiveSha256;
                        return !requestedHash.empty() &&
                            std::any_of(
                                installedHashes->second.begin(),
                                installedHashes->second.end(),
                                [&requestedHash](const std::wstring& installedHash)
                                {
                                    return equalsIgnoreCase(installedHash, requestedHash);
                                });
                    });
                if (compositionMatches)
                {
                    for (const std::size_t index : sourceIndices)
                    {
                        reusable[index] = true;
                    }
                }
            }
            return reusable;
        }

        std::wstring nxmLinkForSource(const FluxPackSourceReference& reference)
        {
            if (startsWithIgnoreCase(reference.source.url, L"nxm://"))
            {
                return reference.source.url;
            }

            if (!reference.source.gameDomain.empty() &&
                !reference.source.remoteModId.empty() &&
                !reference.source.remoteFileId.empty())
            {
                return L"nxm://" + reference.source.gameDomain +
                    L"/mods/" + reference.source.remoteModId +
                    L"/files/" + reference.source.remoteFileId;
            }

            return {};
        }

        FluxPackSourceInstallMode readSourceInstallMode(const JsonValue& item)
        {
            const std::wstring mode = toLower(readStringOrDefault(item, L"installMode", L"replace"));
            if (mode == L"replace")
            {
                return FluxPackSourceInstallMode::Replace;
            }
            if (mode == L"merge")
            {
                return FluxPackSourceInstallMode::Merge;
            }
            throw std::invalid_argument("FluxPack source install mode must be replace or merge.");
        }

        std::vector<FluxPackSourceReference> readSourceReferences(const JsonValue& root)
        {
            const JsonValue* value = root.find(L"sourceArchives");
            if (value == nullptr || !value->isArray())
            {
                return {};
            }

            std::vector<FluxPackSourceReference> references;
            for (const JsonValue& item : value->asArray())
            {
                if (!item.isObject())
                {
                    continue;
                }

                FluxPackSourceReference reference;
                reference.folderName = readStringOrDefault(item, L"folderName");
                reference.displayName = readStringOrDefault(item, L"displayName", reference.folderName);
                reference.version = readStringOrDefault(item, L"version");
                reference.archiveFileName = readStringOrDefault(item, L"archiveFileName");
                reference.archiveSha256 = readHashValueOrDefault(item, L"archiveHash");
                reference.archiveSize = readUnsignedOrDefault(item, L"archiveSize");
                reference.enabled = readBoolOrDefault(item, L"enabled", true);
                reference.requiresDownload = readBoolOrDefault(item, L"requiresDownload", true);
                reference.installMode = readSourceInstallMode(item);
                if (const JsonValue* source = item.find(L"source"); source != nullptr)
                {
                    reference.source = readModSourceRecord(*source);
                }

                references.push_back(std::move(reference));
            }

            return references;
        }

        std::optional<FluxPackPayloadReference> readPayloadReference(
            const JsonValue& item,
            std::wstring_view fileSha256,
            std::uintmax_t fileSize)
        {
            const JsonValue* payload = item.find(L"payload");
            if (payload == nullptr || !payload->isObject())
            {
                return std::nullopt;
            }

            FluxPackPayloadReference reference;
            reference.offset = readUnsignedOrDefault(*payload, L"offset");
            reference.size = readUnsignedOrDefault(*payload, L"size", fileSize);
            reference.sha256 = std::wstring(fileSha256);
            if (const JsonValue* chunks = payload->find(L"chunks");
                chunks != nullptr && chunks->isArray())
            {
                for (const JsonValue& value : chunks->asArray())
                {
                    if (!value.isObject())
                    {
                        throw std::invalid_argument("FluxPack payload chunk reference must be an object.");
                    }
                    reference.chunks.push_back(FluxPackPayloadChunkReference{
                        readStringOrDefault(value, L"hash"),
                        readUnsignedOrDefault(value, L"offset"),
                        readUnsignedOrDefault(value, L"size")});
                }
            }
            return reference;
        }

        std::vector<FluxPackStoredChunk> readContentStore(const JsonValue& root)
        {
            const JsonValue* contentStore = root.find(L"contentStore");
            if (contentStore == nullptr)
            {
                return {};
            }
            if (!contentStore->isObject() ||
                readUnsignedOrDefault(*contentStore, L"version") != 1 ||
                !equalsIgnoreCase(readStringOrDefault(*contentStore, L"hashAlgorithm"), L"sha256"))
            {
                throw std::invalid_argument("FluxPack content store metadata is not supported.");
            }

            const JsonValue* chunks = contentStore->find(L"chunks");
            if (chunks == nullptr || !chunks->isArray())
            {
                throw std::invalid_argument("FluxPack content store chunk catalog is missing.");
            }

            std::vector<FluxPackStoredChunk> result;
            result.reserve(chunks->asArray().size());
            for (const JsonValue& value : chunks->asArray())
            {
                if (!value.isObject())
                {
                    throw std::invalid_argument("FluxPack content store chunk must be an object.");
                }
                const std::wstring compressionId = readStringOrDefault(value, L"compression", L"none");
                FluxPackChunkCompression compression = FluxPackChunkCompression::None;
                if (equalsIgnoreCase(compressionId, L"zstd"))
                {
                    compression = FluxPackChunkCompression::Zstandard;
                }
                else if (!equalsIgnoreCase(compressionId, L"none"))
                {
                    throw std::invalid_argument("FluxPack content chunk compression is not supported.");
                }
                const std::uintmax_t level = readUnsignedOrDefault(value, L"compressionLevel");
                if (level > static_cast<std::uintmax_t>(std::numeric_limits<int>::max()))
                {
                    throw std::invalid_argument("FluxPack content chunk compression level is invalid.");
                }
                result.push_back(FluxPackStoredChunk{
                    readStringOrDefault(value, L"hash"),
                    readUnsignedOrDefault(value, L"offset"),
                    readUnsignedOrDefault(value, L"storedSize"),
                    readUnsignedOrDefault(value, L"originalSize"),
                    compression,
                    static_cast<int>(level),
                    readStringOrDefault(value, L"dictionaryHash"),
                    equalsIgnoreCase(readStringOrDefault(value, L"kind"), L"dictionary")});
            }
            return result;
        }

        std::vector<FluxPackEmbeddedFileReference> readEmbeddedFileReferences(const JsonValue& value)
        {
            if (!value.isArray())
            {
                return {};
            }

            std::vector<FluxPackEmbeddedFileReference> files;
            for (const JsonValue& item : value.asArray())
            {
                if (!item.isObject())
                {
                    continue;
                }

                FluxPackEmbeddedFileReference file;
                file.relativePath = readStringOrDefault(item, L"relativePath");
                file.sha256 = readHashValueOrDefault(item, L"hash");
                file.size = readUnsignedOrDefault(item, L"size");
                file.contentBase64 = readStringOrDefault(item, L"contentBase64");
                file.embedsContent = readBoolOrDefault(item, L"embedsContent", false);
                file.payload = readPayloadReference(item, file.sha256, file.size);
                files.push_back(std::move(file));
            }

            return files;
        }

        std::vector<FluxPackEmbeddedModReference> readEmbeddedModReferences(
            const JsonValue& root,
            std::wstring_view field)
        {
            const JsonValue* value = root.find(field);
            if (value == nullptr || !value->isArray())
            {
                return {};
            }

            std::vector<FluxPackEmbeddedModReference> references;
            for (const JsonValue& item : value->asArray())
            {
                if (!item.isObject())
                {
                    continue;
                }

                FluxPackEmbeddedModReference reference;
                reference.folderName = readStringOrDefault(item, L"folderName");
                reference.displayName = readStringOrDefault(item, L"displayName", reference.folderName);
                reference.version = readStringOrDefault(item, L"version");
                reference.enabled = readBoolOrDefault(item, L"enabled", true);
                if (const JsonValue* source = item.find(L"source"); source != nullptr)
                {
                    reference.source = readModSourceRecord(*source);
                }
                if (const JsonValue* files = item.find(L"files"); files != nullptr)
                {
                    reference.files = readEmbeddedFileReferences(*files);
                }

                references.push_back(std::move(reference));
            }

            return references;
        }

        std::vector<FluxPackConfigReference> readCustomConfigReferences(const JsonValue& root)
        {
            const JsonValue* value = root.find(L"customConfigs");
            if (value == nullptr || !value->isArray())
            {
                return {};
            }

            std::vector<FluxPackConfigReference> references;
            for (const JsonValue& item : value->asArray())
            {
                if (!item.isObject())
                {
                    continue;
                }

                FluxPackConfigReference reference;
                reference.relativePath = readStringOrDefault(item, L"relativePath");
                reference.sha256 = readHashValueOrDefault(item, L"hash");
                reference.size = readUnsignedOrDefault(item, L"size");
                reference.text = readStringOrDefault(item, L"text");
                reference.embedsText = readBoolOrDefault(item, L"embedsText", false);
                reference.payload = readPayloadReference(item, reference.sha256, reference.size);
                references.push_back(std::move(reference));
            }

            return references;
        }

        std::vector<FluxPackProfileOrderReference> readProfileOrderReferences(const JsonValue& root)
        {
            const JsonValue* installPlan = root.find(L"installPlan");
            if (installPlan == nullptr || !installPlan->isObject())
            {
                return {};
            }

            const JsonValue* value = installPlan->find(L"profileOrder");
            if (value == nullptr || !value->isArray())
            {
                return {};
            }

            std::vector<FluxPackProfileOrderReference> references;
            for (const JsonValue& item : value->asArray())
            {
                if (!item.isObject())
                {
                    continue;
                }

                references.push_back(FluxPackProfileOrderReference{
                    readStringOrDefault(item, L"kind"),
                    readStringOrDefault(item, L"folderName"),
                    readStringOrDefault(item, L"separatorTitle")
                });
            }

            return references;
        }

        FluxPackManifest parseFluxPackManifest(
            const std::filesystem::path& absolutePath,
            const JsonValue& root,
            std::uintmax_t manifestBytes)
        {
            FluxPackManifest manifest;
            manifest.summary = summaryFromJson(root, absolutePath, manifestBytes);
            if (const JsonValue* build = root.find(L"build");
                build != nullptr && build->isObject())
            {
                manifest.buildName = readStringOrDefault(*build, L"name", manifest.summary.buildName);
                manifest.templateId = readStringOrDefault(*build, L"templateId");
                manifest.gamePath = std::filesystem::path(readStringOrDefault(*build, L"gamePath"));
                manifest.projectDirectoryHint =
                    std::filesystem::path(readStringOrDefault(*build, L"projectDirectoryHint"));
                manifest.defaultProfile = readStringOrDefault(*build, L"defaultProfile");
            }

            if (manifest.buildName.empty())
            {
                manifest.buildName = absolutePath.stem().wstring();
            }

            if (manifest.defaultProfile.empty())
            {
                if (const JsonValue* installPlan = root.find(L"installPlan");
                    installPlan != nullptr && installPlan->isObject())
                {
                    manifest.defaultProfile = readStringOrDefault(*installPlan, L"defaultProfile");
                }
            }
            if (manifest.defaultProfile.empty())
            {
                manifest.defaultProfile = L"Default";
            }

            manifest.sourceArchives = readSourceReferences(root);
            manifest.bundledMods = readEmbeddedModReferences(root, L"bundledMods");
            if (manifest.summary.packageType == L"full" && !manifest.sourceArchives.empty())
            {
                throw std::invalid_argument(
                    "Full FluxPack must not require remote source archives.");
            }
            manifest.generatedAssets = readEmbeddedModReferences(root, L"generatedAssets");
            manifest.customPatches = readEmbeddedModReferences(root, L"customPatches");
            manifest.customConfigs = readCustomConfigReferences(root);
            manifest.profileOrder = readProfileOrderReferences(root);
            manifest.contentChunks = readContentStore(root);
            return manifest;
        }

        std::optional<std::filesystem::path> safeRelativePath(std::wstring_view value)
        {
            std::wstring text(value);
            std::replace(text.begin(), text.end(), L'/', std::filesystem::path::preferred_separator);
            const std::filesystem::path path(text);
            if (path.empty() || path.is_absolute())
            {
                return std::nullopt;
            }

            const std::filesystem::path normalized = path.lexically_normal();
            if (normalized.empty() || normalized == L".")
            {
                return std::nullopt;
            }

            for (const std::filesystem::path& part : normalized)
            {
                if (part == L"..")
                {
                    return std::nullopt;
                }
            }

            return normalized;
        }

        std::filesystem::path gameDirectoryFromCandidate(std::filesystem::path path)
        {
            if (equalsIgnoreCase(path.extension().wstring(), L".exe"))
            {
                path = path.parent_path();
            }

            return std::filesystem::absolute(path).lexically_normal();
        }

        std::filesystem::path localGameDirectoryFromRelative(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& relativePath)
        {
            if (relativePath.empty())
            {
                return gameDirectoryFromCandidate(
                    projectDirectory / std::filesystem::path(std::wstring(defaultLocalGameDirectoryName)));
            }

            return gameDirectoryFromCandidate(projectDirectory / relativePath);
        }

        ResolvedFluxPackGameDirectory resolveInstallGameDirectory(
            const FluxPackManifest& manifest,
            const BuildPathSettingsService& pathSettings,
            Logger& logger,
            const std::filesystem::path& projectDirectory)
        {
            const std::filesystem::path projectDirectoryHint =
                normalizePathForFluxPack(manifest.projectDirectoryHint);
            const std::filesystem::path fallbackLocalGameDirectory =
                localGameDirectoryFromRelative(projectDirectory, {});

            if (!manifest.gamePath.empty())
            {
                if (manifest.gamePath.is_relative())
                {
                    return ResolvedFluxPackGameDirectory{
                        localGameDirectoryFromRelative(projectDirectory, manifest.gamePath),
                        false
                    };
                }

                const std::filesystem::path sourceGameDirectory =
                    gameDirectoryFromCandidate(normalizePathForFluxPack(manifest.gamePath, projectDirectoryHint));
                if (!projectDirectoryHint.empty())
                {
                    if (const std::optional<std::filesystem::path> relative =
                            relativePathInsideRoot(sourceGameDirectory, projectDirectoryHint))
                    {
                        return ResolvedFluxPackGameDirectory{
                            localGameDirectoryFromRelative(projectDirectory, relative.value()),
                            false
                        };
                    }
                }

                if (pathExists(sourceGameDirectory))
                {
                    return ResolvedFluxPackGameDirectory{
                        sourceGameDirectory,
                        true
                    };
                }

                const std::filesystem::path leaf = sourceGameDirectory.filename();
                if (!leaf.empty() && leaf != L"." && leaf != L"..")
                {
                    return ResolvedFluxPackGameDirectory{
                        localGameDirectoryFromRelative(projectDirectory, leaf),
                        false
                    };
                }
            }

            if (projectDirectoryHint.empty())
            {
                return ResolvedFluxPackGameDirectory{
                    fallbackLocalGameDirectory,
                    false
                };
            }

            std::error_code statusError;
            if (!std::filesystem::exists(projectDirectoryHint, statusError) ||
                !std::filesystem::is_directory(projectDirectoryHint, statusError))
            {
                return ResolvedFluxPackGameDirectory{
                    fallbackLocalGameDirectory,
                    false
                };
            }

            try
            {
                std::filesystem::path gameDirectory =
                    pathSettings.loadForProjectDirectory(projectDirectoryHint).gameDirectory;
                if (!gameDirectory.empty())
                {
                    gameDirectory = gameDirectoryFromCandidate(gameDirectory);
                    logger.writeOperation(
                        LogLevel::Warning,
                        "FluxPack",
                        "FluxPack legacy manifest did not include gamePath; recovered it from projectDirectoryHint.");
                    if (const std::optional<std::filesystem::path> relative =
                            relativePathInsideRoot(gameDirectory, projectDirectoryHint))
                    {
                        return ResolvedFluxPackGameDirectory{
                            localGameDirectoryFromRelative(projectDirectory, relative.value()),
                            false
                        };
                    }
                    if (pathExists(gameDirectory))
                    {
                        return ResolvedFluxPackGameDirectory{
                            gameDirectory,
                            true
                        };
                    }
                }
            }
            catch (const std::exception& exception)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "FluxPack",
                    std::string("FluxPack legacy gamePath recovery failed: ") + exception.what());
            }

            return ResolvedFluxPackGameDirectory{
                fallbackLocalGameDirectory,
                false
            };
        }

        ProviderInstallState& providerStateFor(
            std::vector<ProviderInstallState>& providers,
            std::wstring providerId)
        {
            providerId = toLower(std::move(providerId));
            auto match = std::find_if(
                providers.begin(),
                providers.end(),
                [&providerId](const ProviderInstallState& provider)
                {
                    return provider.id == providerId;
                });
            if (match != providers.end())
            {
                return *match;
            }

            providers.push_back(ProviderInstallState{
                providerId,
                providerDisplayName(providerId)
            });
            return providers.back();
        }

        std::vector<ProviderInstallState> buildProviderStates(
            const std::vector<FluxPackSourceReference>& sourceArchives)
        {
            std::vector<ProviderInstallState> providers;
            for (const FluxPackSourceReference& source : sourceArchives)
            {
                ProviderInstallState& provider = providerStateFor(providers, providerIdForSource(source));
                ++provider.total;
            }

            return providers;
        }

        std::vector<FluxPackProviderProgress> providerProgressFromState(
            const std::vector<ProviderInstallState>& providers)
        {
            std::vector<FluxPackProviderProgress> progress;
            progress.reserve(providers.size());
            for (const ProviderInstallState& provider : providers)
            {
                const std::uintmax_t processed = provider.completed + provider.pending + provider.failed;
                const int percent = provider.total == 0
                    ? 0
                    : static_cast<int>((processed * 100) / provider.total);
                progress.push_back(FluxPackProviderProgress{
                    provider.id,
                    provider.displayName,
                    provider.total,
                    provider.completed,
                    provider.pending,
                    provider.failed,
                    provider.currentItem,
                    provider.statusText,
                    std::clamp(percent, 0, 100)
                });
            }

            return progress;
        }

        std::uintmax_t processedProviderSources(const std::vector<ProviderInstallState>& providers)
        {
            std::uintmax_t processed = 0;
            for (const ProviderInstallState& provider : providers)
            {
                processed += provider.completed + provider.pending + provider.failed;
            }
            return processed;
        }

        void publishInstallProgress(
            const std::function<void(const FluxPackInstallProgress&)>& callback,
            const std::vector<ProviderInstallState>& providers,
            std::wstring phase,
            std::wstring currentStep,
            std::wstring currentItem,
            std::wstring statusMessage,
            int overallPercent)
        {
            if (!callback)
            {
                return;
            }

            FluxPackInstallProgress progress;
            progress.phase = std::move(phase);
            progress.currentStep = std::move(currentStep);
            progress.currentItem = std::move(currentItem);
            progress.statusMessage = std::move(statusMessage);
            progress.overallPercent = std::clamp(overallPercent, 0, 100);
            progress.providers = providerProgressFromState(providers);
            for (const ProviderInstallState& provider : providers)
            {
                progress.totalSourceCount += provider.total;
                progress.installedSourceCount += provider.completed;
                progress.pendingSourceCount += provider.pending;
                progress.failedSourceCount += provider.failed;
            }

            callback(progress);
        }

        int sourceInstallOverallPercent(
            const std::vector<ProviderInstallState>& providers)
        {
            std::uintmax_t total = 0;
            for (const ProviderInstallState& provider : providers)
            {
                total += provider.total;
            }
            if (total == 0)
            {
                return 68;
            }

            const std::uintmax_t processed = processedProviderSources(providers);
            return 24 + static_cast<int>((processed * 52) / total);
        }

        std::wstring uniqueProjectName(
            const ProjectService& projects,
            const std::filesystem::path& installRoot,
            const std::wstring& requestedName)
        {
            std::wstring baseName = requestedName.empty() ? L"FluxPack Build" : requestedName;
            std::wstring candidate = baseName;
            for (int index = 2; std::filesystem::exists(projects.buildProjectDirectory(installRoot, candidate)); ++index)
            {
                candidate = baseName + L" " + std::to_wstring(index);
            }

            return candidate;
        }

        std::optional<std::filesystem::path> safeArchiveFileName(std::wstring_view fileName)
        {
            if (fileName.empty())
            {
                return std::nullopt;
            }

            std::filesystem::path path{std::wstring(fileName)};
            if (path.empty() ||
                path.has_root_name() ||
                path.has_root_directory() ||
                path.has_parent_path() ||
                path.filename() != path ||
                isTransientDownloadFile(path))
            {
                return std::nullopt;
            }

            const PathSafetyResult validation = PathSafetyService().validateRelativePath(path);
            return validation.safe() ? std::optional<std::filesystem::path>(path) : std::nullopt;
        }

        void addUniquePath(std::vector<std::filesystem::path>& paths, const std::filesystem::path& path)
        {
            if (path.empty())
            {
                return;
            }

            const std::filesystem::path normalized = std::filesystem::absolute(path).lexically_normal();
            const auto duplicate = std::find_if(
                paths.begin(),
                paths.end(),
                [&normalized](const std::filesystem::path& existing)
                {
                    return equalsIgnoreCase(existing.wstring(), normalized.wstring());
                });
            if (duplicate == paths.end())
            {
                paths.push_back(normalized);
            }
        }

        bool sourceArchiveMatchesManifest(
            const std::filesystem::path& candidate,
            const FluxPackSourceReference& source,
            Logger& logger)
        {
            std::error_code sizeError;
            const std::uintmax_t size = std::filesystem::file_size(candidate, sizeError);
            if (sizeError)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "FluxPack",
                    "FluxPack local source archive size could not be read. path=\"" +
                        pathForLog(candidate) + "\", reason=\"" + sizeError.message() + "\"");
                return false;
            }

            if (source.archiveSize > 0 && size != source.archiveSize)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "FluxPack",
                    "FluxPack local source archive size mismatch. path=\"" +
                        pathForLog(candidate) + "\", expected=" + std::to_string(source.archiveSize) +
                        ", actual=" + std::to_string(size));
                return false;
            }

            if (!source.archiveSha256.empty())
            {
                const std::wstring actualHash = sha256File(candidate);
                if (!equalsIgnoreCase(source.archiveSha256, actualHash))
                {
                    logger.writeOperation(
                        LogLevel::Warning,
                        "FluxPack",
                        "FluxPack local source archive hash mismatch. path=\"" +
                            pathForLog(candidate) + "\"");
                    return false;
                }
            }

            return true;
        }

        std::optional<std::filesystem::path> currentDownloadArchivePath(
            const std::filesystem::path& downloadsDirectory,
            const FluxPackSourceReference& source,
            Logger& logger)
        {
            const std::optional<std::filesystem::path> archiveFileName =
                safeArchiveFileName(source.archiveFileName);
            if (!archiveFileName.has_value() ||
                downloadsDirectory.empty() ||
                source.archiveSha256.empty())
            {
                return std::nullopt;
            }

            const std::filesystem::path root =
                std::filesystem::absolute(downloadsDirectory).lexically_normal();
            const std::filesystem::path candidate =
                std::filesystem::absolute(root / archiveFileName.value()).lexically_normal();
            std::error_code statusError;
            if (!isSameOrInsidePath(candidate, root) ||
                !std::filesystem::is_regular_file(pathForFilesystemIo(candidate), statusError))
            {
                return std::nullopt;
            }

            return sourceArchiveMatchesManifest(candidate, source, logger)
                ? std::optional<std::filesystem::path>(candidate)
                : std::nullopt;
        }

        std::optional<std::filesystem::path> localSourceArchivePath(
            const FluxPackManifest& manifest,
            const FluxPackSourceReference& source,
            const BuildPathSettingsService& pathSettings,
            Logger& logger)
        {
            const std::optional<std::filesystem::path> archiveFileName =
                safeArchiveFileName(source.archiveFileName);
            if (!archiveFileName.has_value())
            {
                return std::nullopt;
            }

            const std::filesystem::path projectDirectoryHint =
                normalizePathForFluxPack(manifest.projectDirectoryHint);
            if (projectDirectoryHint.empty())
            {
                return std::nullopt;
            }

            std::error_code statusError;
            if (!std::filesystem::exists(projectDirectoryHint, statusError) ||
                !std::filesystem::is_directory(projectDirectoryHint, statusError))
            {
                return std::nullopt;
            }

            std::vector<std::filesystem::path> downloadRoots;
            try
            {
                addUniquePath(
                    downloadRoots,
                    pathSettings.loadForProjectDirectory(projectDirectoryHint).downloadsDirectory);
            }
            catch (const std::exception& exception)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "FluxPack",
                    std::string("FluxPack could not read source build path settings for local archives: ") +
                        exception.what());
            }
            for (const std::filesystem::path& root : downloadRoots)
            {
                const std::filesystem::path candidate =
                    std::filesystem::absolute(root / archiveFileName.value()).lexically_normal();
                if (!isSameOrInsidePath(candidate, root) ||
                    !std::filesystem::exists(candidate, statusError) ||
                    !std::filesystem::is_regular_file(candidate, statusError))
                {
                    continue;
                }

                if (sourceArchiveMatchesManifest(candidate, source, logger))
                {
                    return candidate;
                }
            }

            return std::nullopt;
        }

        std::filesystem::path validateManualSourceArchivePath(
            const FluxPackManualSourceArchive& archive,
            const FluxPackSourceReference& source,
            Logger& logger)
        {
            if (archive.path.empty())
            {
                throw std::invalid_argument("Selected manual source archive path is empty.");
            }
            const std::filesystem::path absolutePath =
                std::filesystem::absolute(archive.path).lexically_normal();
            std::error_code statusError;
            if (!std::filesystem::is_regular_file(pathForFilesystemIo(absolutePath), statusError))
            {
                throw std::invalid_argument("Selected manual source archive does not exist.");
            }
            if (!sourceArchiveMatchesManifest(absolutePath, source, logger))
            {
                throw std::invalid_argument(
                    "Selected manual source archive does not match the FluxPack file size or SHA-256 hash.");
            }

            logger.writeOperation(
                LogLevel::Info,
                "FluxPack",
                "FluxPack accepted a user-selected source archive. sourceId=\"" +
                    toUtf8(archive.sourceId) + "\", path=\"" + pathForLog(absolutePath) + "\"");
            return absolutePath;
        }

        std::unordered_map<std::wstring, std::filesystem::path> validateManualSourceArchives(
            const std::vector<FluxPackManualSourceArchive>& archives,
            const std::vector<FluxPackSourceReference>& sources,
            Logger& logger)
        {
            std::unordered_map<std::wstring, std::filesystem::path> validated;
            if (archives.empty())
            {
                return validated;
            }

            std::unordered_map<std::wstring, const FluxPackSourceReference*> sourcesById;
            sourcesById.reserve(sources.size());
            for (std::size_t index = 0; index < sources.size(); ++index)
            {
                sourcesById.emplace(sourceInstallId(sources[index], index), &sources[index]);
            }

            validated.reserve(archives.size());
            for (const FluxPackManualSourceArchive& archive : archives)
            {
                const auto source = sourcesById.find(archive.sourceId);
                if (archive.sourceId.empty() || source == sourcesById.end())
                {
                    throw std::invalid_argument(
                        "Selected manual source archive does not belong to this FluxPack install plan.");
                }
                if (validated.contains(archive.sourceId))
                {
                    throw std::invalid_argument(
                        "Selected manual source archive was provided more than once.");
                }

                validated.emplace(
                    archive.sourceId,
                    validateManualSourceArchivePath(archive, *source->second, logger));
            }
            return validated;
        }

        void writeFluxPackDownloadMetadata(
            const std::filesystem::path& archivePath,
            const FluxPackSourceReference& source)
        {
            const DownloadMetadata current = readDownloadMetadata(archivePath);
            const auto authoritative = [](const std::wstring& existing, std::wstring fallback)
            {
                return existing.empty() ? std::move(fallback) : existing;
            };

            JsonWriter writer;
            writer.beginObject();
            writer.field(L"source", authoritative(current.source, sourceUrlForPack(source.source)));
            writer.field(L"status", L"");
            writer.field(L"gameDomain", authoritative(current.gameDomain, source.source.gameDomain));
            writer.field(L"modId", authoritative(current.modId, source.source.remoteModId));
            writer.field(L"fileId", authoritative(current.fileId, source.source.remoteFileId));
            writer.field(
                L"nexusModName",
                authoritative(
                    current.nexusModName,
                    source.displayName.empty() ? source.folderName : source.displayName));
            writer.field(L"version", authoritative(current.version, source.version));
            writer.field(
                L"latestVersion",
                authoritative(current.latestVersion, source.source.latestVersion));
            writer.field(
                L"destinationFileName",
                authoritative(current.destinationFileName, archivePath.filename().wstring()));
            writer.field(L"partialPath", L"");
            writer.field(L"bytesReceived", static_cast<std::uintmax_t>(0));
            writer.field(L"totalBytes", static_cast<std::uintmax_t>(0));
            writer.field(L"downloadStartedUnix", static_cast<std::uintmax_t>(0));
            writer.field(L"isDownloading", false);
            writer.endObject();

            AtomicFileStore().writeTextFile(
                metadataPath(archivePath),
                toUtf8(writer.str()),
                AtomicFileWriteOptions{
                    L"FluxPack imported source metadata",
                    ProjectStateValidation::JsonObject
                });
        }

        std::uintmax_t applyEmbeddedConfigs(
            const std::filesystem::path& projectDirectory,
            const std::vector<FluxPackConfigReference>& configs,
            const FluxPackPackageReader* packageReader,
            Logger& logger,
            FluxPackDeltaApplyStatistics& deltaStatistics)
        {
            std::uintmax_t applied = 0;
            const PathSafetyService safety;
            for (const FluxPackConfigReference& config : configs)
            {
                if (!config.embedsText && !config.payload.has_value())
                {
                    continue;
                }

                const std::optional<std::filesystem::path> relative = safeRelativePath(config.relativePath);
                if (!relative.has_value())
                {
                    logger.writeOperation(
                        LogLevel::Warning,
                        "FluxPack",
                        "Skipped unsafe embedded config path: " + toUtf8(config.relativePath));
                    continue;
                }

                const std::filesystem::path target = projectDirectory / relative.value();
                safety.validateWritePath(projectDirectory, target)
                    .throwIfUnsafe("Embedded FluxPack config path is unsafe");
                if (canReuseMaterializedFile(target, config.size, config.sha256, logger))
                {
                    ++deltaStatistics.reusedFileCount;
                    ++applied;
                    continue;
                }

                std::filesystem::create_directories(pathForFilesystemIo(target.parent_path()));
                if (config.payload.has_value())
                {
                    if (packageReader == nullptr)
                    {
                        throw std::invalid_argument("FluxPack config payload requires a package container.");
                    }
                    if (config.payload->size != config.size)
                    {
                        throw std::invalid_argument("FluxPack config payload size does not match the manifest.");
                    }
                    materializeFluxPackFileAtomically(
                        target,
                        config.size,
                        config.sha256,
                        L"FluxPack embedded config payload",
                        [packageReader, &config](const std::filesystem::path& temporaryPath)
                        {
                            packageReader->extractPayload(config.payload.value(), temporaryPath);
                        });
                }
                else
                {
                    AtomicFileStore().writeTextFile(
                        target,
                        toUtf8(config.text),
                        AtomicFileWriteOptions{
                            L"FluxPack embedded config",
                            ProjectStateValidation::Utf8Text
                        });
                }
                ++deltaStatistics.materializedFileCount;
                ++applied;
            }

            return applied;
        }

        std::uintmax_t applyEmbeddedMods(
            const std::filesystem::path& projectDirectory,
            const std::vector<FluxPackEmbeddedModReference>& mods,
            const FluxPackPackageReader* packageReader,
            Logger& logger,
            bool markAsPatch,
            FluxPackDeltaApplyStatistics& deltaStatistics)
        {
            const PathSafetyService safety;
            std::vector<InstalledModImportRecord> imports;
            imports.reserve(mods.size());

            for (const FluxPackEmbeddedModReference& mod : mods)
            {
                const std::optional<std::filesystem::path> folderName = safeArchiveFileName(mod.folderName);
                if (!folderName.has_value())
                {
                    logger.writeOperation(
                        LogLevel::Warning,
                        "FluxPack",
                        "Skipped embedded mod with unsafe folder name: " + toUtf8(mod.folderName));
                    continue;
                }

                const std::filesystem::path modDirectory =
                    projectDirectory / L"mods" / folderName.value();
                bool restoredAnyFile = false;
                for (const FluxPackEmbeddedFileReference& file : mod.files)
                {
                    if (!file.embedsContent ||
                        (!file.payload.has_value() && file.contentBase64.empty()))
                    {
                        continue;
                    }

                    const std::optional<std::filesystem::path> relative = safeRelativePath(file.relativePath);
                    if (!relative.has_value())
                    {
                        logger.writeOperation(
                            LogLevel::Warning,
                            "FluxPack",
                            "Skipped unsafe embedded mod file path: " + toUtf8(file.relativePath));
                        continue;
                    }

                    const std::filesystem::path target = projectDirectory / relative.value();
                    if (!isSameOrInsidePath(target, modDirectory))
                    {
                        logger.writeOperation(
                            LogLevel::Warning,
                            "FluxPack",
                            "Skipped embedded mod file outside its mod folder: " + toUtf8(file.relativePath));
                        continue;
                    }

                    safety.validateWritePath(projectDirectory, target)
                        .throwIfUnsafe("Embedded FluxPack mod file path is unsafe");
                    if (canReuseMaterializedFile(target, file.size, file.sha256, logger))
                    {
                        ++deltaStatistics.reusedFileCount;
                        restoredAnyFile = true;
                        continue;
                    }

                    std::filesystem::create_directories(pathForFilesystemIo(target.parent_path()));

                    if (file.payload.has_value())
                    {
                        if (packageReader == nullptr)
                        {
                            throw std::invalid_argument("FluxPack mod payload requires a package container.");
                        }
                        if (file.payload->size != file.size)
                        {
                            throw std::invalid_argument("FluxPack mod payload size does not match the manifest.");
                        }
                        materializeFluxPackFileAtomically(
                            target,
                            file.size,
                            file.sha256,
                            L"FluxPack embedded mod payload",
                            [packageReader, &file](const std::filesystem::path& temporaryPath)
                            {
                                packageReader->extractPayload(file.payload.value(), temporaryPath);
                            });
                    }
                    else
                    {
                        const std::string content = base64Decode(file.contentBase64);
                        if (file.size > 0 && content.size() != file.size)
                        {
                            throw std::runtime_error("Embedded FluxPack mod file size does not match the manifest.");
                        }

                        materializeFluxPackFileAtomically(
                            target,
                            file.size,
                            file.sha256,
                            L"FluxPack embedded mod file",
                            [&content](const std::filesystem::path& temporaryPath)
                            {
                                writeBinaryFile(temporaryPath, content);
                            });
                    }
                    ++deltaStatistics.materializedFileCount;
                    restoredAnyFile = true;
                }

                if (!restoredAnyFile)
                {
                    continue;
                }

                InstalledModImportRecord import;
                import.modDirectory = modDirectory;
                import.displayName = mod.displayName.empty() ? mod.folderName : mod.displayName;
                import.version = mod.version;
                import.isEnabled = mod.enabled;
                import.source = mod.source;
                import.isLocal = !sourceHasRemoteIdentity(mod.source);
                import.isPatch = markAsPatch;
                imports.push_back(std::move(import));
            }

            if (!imports.empty())
            {
                InstanceMetadataStore::registerInstalledMods(projectDirectory, imports);
                logger.writeOperation(
                    LogLevel::Info,
                    "FluxPack",
                    "FluxPack restored embedded local mods. count=" + std::to_string(imports.size()));
            }

            return imports.size();
        }

        std::uintmax_t applyProfileOrder(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::vector<FluxPackProfileOrderReference>& order)
        {
            if (order.empty())
            {
                return 0;
            }

            std::vector<ProfileOrderImportItemRecord> items;
            items.reserve(order.size());
            for (const FluxPackProfileOrderReference& item : order)
            {
                items.push_back(ProfileOrderImportItemRecord{
                    item.kind,
                    item.folderName,
                    item.separatorTitle
                });
            }

            InstanceMetadataStore::replaceProfileOrderItems(projectDirectory, profileName, items);
            return items.size();
        }

        std::vector<InstalledModRecord> listInstalledModsForPack(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory,
            Logger& logger)
        {
            try
            {
                return InstanceMetadataStore::listInstalledMods(projectDirectory, modsDirectory);
            }
            catch (const std::exception& exception)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "FluxPack",
                    std::string("Installed mod metadata unavailable during FluxPack export: ") + exception.what());
                return {};
            }
        }

        std::vector<InstalledModRecord> listInstalledModsForDelta(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory,
            Logger& logger)
        {
            try
            {
                return InstanceMetadataStore::listInstalledMods(projectDirectory, modsDirectory);
            }
            catch (const std::exception& exception)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "FluxPack",
                    std::string("Installed mod metadata unavailable during FluxPack delta planning: ") +
                        exception.what());
                return {};
            }
        }

        std::vector<ProfileOrderItemRecord> listProfileOrderForPack(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory,
            std::wstring_view profileName,
            Logger& logger)
        {
            try
            {
                return InstanceMetadataStore::listProfileOrderItems(projectDirectory, profileName, modsDirectory);
            }
            catch (const std::exception& exception)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "FluxPack",
                    std::string("Profile order metadata unavailable during FluxPack export: ") + exception.what());
                return {};
            }
        }
    }

    std::wstring_view fluxPackPackageTypeId(FluxPackPackageType type) noexcept
    {
        return type == FluxPackPackageType::Full ? L"full" : L"recipe";
    }

    FluxPackService::FluxPackService(
        Logger& logger,
        ProjectService& projects,
        DownloadService& downloads,
        const BuildPathSettingsService& pathSettings) noexcept
        : logger_(logger),
          projects_(projects),
          downloads_(downloads),
          pathSettings_(pathSettings)
    {
    }

    void FluxPackService::initialize()
    {
        if (initialized_)
        {
            return;
        }

        initialized_ = true;
        logger_.write(LogLevel::Info, "FluxPack service initialized.");
    }

    void FluxPackService::shutdown()
    {
        if (!initialized_)
        {
            return;
        }

        logger_.write(LogLevel::Info, "FluxPack service shut down.");
        initialized_ = false;
    }

    FluxPackSummary FluxPackService::exportProject(const FluxPackExportRequest& request) const
    {
        if (request.configPath.empty())
        {
            throw std::invalid_argument("Build config path is required.");
        }

        if (request.outputPath.empty())
        {
            throw std::invalid_argument("FluxPack output path is required.");
        }

        const bool fullPackage = request.packageType == FluxPackPackageType::Full;
        const bool includeGeneratedAssets = fullPackage || request.includeGeneratedAssets;
        FluxPackExportProgressReporter progress(request.progress);
        progress.publish(
            L"analyzing",
            L"Изучаем сборку",
            request.configPath.filename().wstring(),
            L"Читаем настройки и состав сборки",
            0,
            0,
            0,
            0,
            0,
            true);

        const std::filesystem::path absoluteOutput =
            std::filesystem::absolute(request.outputPath).lexically_normal();

        logger_.writeOperation(
            LogLevel::Info,
            "FluxPack",
            "FluxPack export requested. configPath=\"" + pathForLog(request.configPath) +
                "\", outputPath=\"" + pathForLog(request.outputPath) +
                "\", packageType=" + toUtf8(std::wstring(fluxPackPackageTypeId(request.packageType))) +
                ", includeGeneratedAssets=" + (includeGeneratedAssets ? "true" : "false"));

        const ProjectOpenResult project = projects_.readProjectConfigSummary(request.configPath);
        BuildPathSettings paths{
            project.project.gamePath,
            project.project.projectDirectory / L"mods",
            project.project.projectDirectory / L"profiles",
            project.project.projectDirectory / L"downloads",
            project.project.projectDirectory / L"overwrite"
        };
        try
        {
            paths = pathSettings_.loadForConfig(project.project.configPath);
        }
        catch (const std::exception& exception)
        {
            logger_.writeOperation(
                LogLevel::Warning,
                "FluxPack",
                std::string("Build path settings unavailable during FluxPack export: ") + exception.what());
        }

        const bool overwritesProjectState =
            normalizePathForComparison(absoluteOutput) == normalizePathForComparison(project.project.configPath);
        const bool isInsideManagedContent =
            isSameOrInsidePath(absoluteOutput, paths.modsDirectory) ||
            isSameOrInsidePath(absoluteOutput, paths.profilesDirectory) ||
            isSameOrInsidePath(absoluteOutput, paths.downloadsDirectory) ||
            isSameOrInsidePath(absoluteOutput, paths.overwriteDirectory);
        if (overwritesProjectState || isInsideManagedContent)
        {
            throw std::invalid_argument(
                "FluxPack output must be outside the build's mods, profiles, downloads and overwrite directories.");
        }

        progress.publish(
            L"sources",
            L"Проверяем исходные архивы",
            paths.downloadsDirectory.filename().wstring(),
            L"Сопоставляем установленные моды с их источниками",
            4);
        std::vector<DownloadSourceFile> downloads = buildDownloadIndex(paths.downloadsDirectory);
        std::vector<PackModReference> sourceArchives;
        std::vector<PackModReference> bundledMods;
        std::vector<PackModReference> generatedAssets;
        std::vector<PackModReference> customPatches;
        const std::vector<std::filesystem::path> payloadExclusions{
            absoluteOutput,
            AtomicFileStore::backupPathFor(absoluteOutput)
        };
        const std::vector<InstalledModRecord> installedMods = listInstalledModsForPack(
            project.project.projectDirectory,
            paths.modsDirectory,
            logger_);
        std::unordered_map<std::wstring, std::vector<InstalledModArchiveSourceRecord>>
            archiveSourcesByMod;
        if (!fullPackage)
        {
            for (InstalledModArchiveSourceRecord& source :
                 InstanceMetadataStore::listInstalledModArchiveSources(
                     project.project.projectDirectory))
            {
                archiveSourcesByMod[source.modUuid].push_back(std::move(source));
            }
        }

        for (std::size_t index = 0; index < installedMods.size(); ++index)
        {
            const InstalledModRecord& mod = installedMods[index];
            progress.publish(
                L"inventory",
                L"Изучаем моды",
                mod.displayName.empty() ? mod.folderName : mod.displayName,
                L"Определяем, какие файлы нужно добавить в пакет",
                progressPercent(5, 14, index, installedMods.size()),
                index,
                installedMods.size());

            const auto composedSources = archiveSourcesByMod.find(mod.uuid);
            if (!fullPackage &&
                composedSources != archiveSourcesByMod.end() &&
                composedSources->second.size() > 1)
            {
                std::vector<PackModReference> mergedReferences;
                mergedReferences.reserve(composedSources->second.size());
                bool canReplayComposition = true;
                for (const InstalledModArchiveSourceRecord& archived :
                     composedSources->second)
                {
                    std::optional<DownloadSourceFile> sourceArchive =
                        matchSourceArchiveBySha256(
                            archived.archiveSha256,
                            archived.archiveFileName,
                            downloads);
                    ModSourceRecord source = archived.source;
                    if (sourceArchive.has_value())
                    {
                        source = sourceRecordFromDownload(
                            sourceArchive->metadata,
                            source);
                    }
                    if (!sourceHasRemoteIdentity(source))
                    {
                        canReplayComposition = false;
                        break;
                    }

                    InstalledModRecord sourceMod = mod;
                    sourceMod.source = std::move(source);
                    if (!archived.version.empty())
                    {
                        sourceMod.version = archived.version;
                    }
                    else if (sourceArchive.has_value() &&
                             !sourceArchive->metadata.version.empty())
                    {
                        sourceMod.version = sourceArchive->metadata.version;
                    }
                    if (sourceArchive.has_value() &&
                        !sourceArchive->metadata.nexusModName.empty())
                    {
                        sourceMod.displayName = sourceArchive->metadata.nexusModName;
                    }

                    PackModReference sourceReference{
                        std::move(sourceMod),
                        std::move(sourceArchive)
                    };
                    sourceReference.archiveSha256 = archived.archiveSha256;
                    sourceReference.archiveFileName = archived.archiveFileName;
                    sourceReference.installMode =
                        archived.linkMode == ArchiveModLinkMode::Merge
                        ? FluxPackSourceInstallMode::Merge
                        : FluxPackSourceInstallMode::Replace;
                    mergedReferences.push_back(std::move(sourceReference));
                }

                if (canReplayComposition)
                {
                    for (PackModReference& mergedReference : mergedReferences)
                    {
                        sourceArchives.push_back(std::move(mergedReference));
                    }
                    continue;
                }

                logger_.writeOperation(
                    LogLevel::Warning,
                    "FluxPack",
                    "FluxPack could not replay every merged archive source; embedding the final merged mod instead. mod=\"" +
                        toUtf8(mod.displayName.empty() ? mod.folderName : mod.displayName) + "\"");
                PackModReference embeddedReference{mod, std::nullopt};
                const std::optional<std::filesystem::path> logicalFolder =
                    safeArchiveFileName(mod.folderName);
                if (!logicalFolder.has_value())
                {
                    throw std::invalid_argument("FluxPack mod folder name is unsafe.");
                }
                embeddedReference.files = scanPayloadFiles(
                    mod.path,
                    project.project.projectDirectory / L"mods" / logicalFolder.value(),
                    project.project.projectDirectory,
                    false);
                customPatches.push_back(std::move(embeddedReference));
                continue;
            }

            PackModReference reference{
                mod,
                sourceHasRemoteIdentity(mod.source)
                    ? matchSourceArchive(mod, downloads)
                    : std::optional<DownloadSourceFile>{}
            };

            if (isGeneratedAssetMod(mod))
            {
                if (includeGeneratedAssets)
                {
                    const std::optional<std::filesystem::path> logicalFolder =
                        safeArchiveFileName(mod.folderName);
                    if (!logicalFolder.has_value())
                    {
                        throw std::invalid_argument("FluxPack mod folder name is unsafe.");
                    }
                    reference.files = scanPayloadFiles(
                        mod.path,
                        project.project.projectDirectory / L"mods" / logicalFolder.value(),
                        project.project.projectDirectory,
                        false);
                }
                generatedAssets.push_back(std::move(reference));
            }
            else if (sourceHasRemoteIdentity(mod.source))
            {
                if (fullPackage)
                {
                    const std::optional<std::filesystem::path> logicalFolder =
                        safeArchiveFileName(mod.folderName);
                    if (!logicalFolder.has_value())
                    {
                        throw std::invalid_argument("FluxPack mod folder name is unsafe.");
                    }
                    reference.files = scanPayloadFiles(
                        mod.path,
                        project.project.projectDirectory / L"mods" / logicalFolder.value(),
                        project.project.projectDirectory,
                        false);
                    bundledMods.push_back(std::move(reference));
                }
                else
                {
                    sourceArchives.push_back(std::move(reference));
                }
            }
            else
            {
                const std::optional<std::filesystem::path> logicalFolder =
                    safeArchiveFileName(mod.folderName);
                if (!logicalFolder.has_value())
                {
                    throw std::invalid_argument("FluxPack mod folder name is unsafe.");
                }
                reference.files = scanPayloadFiles(
                    mod.path,
                    project.project.projectDirectory / L"mods" / logicalFolder.value(),
                    project.project.projectDirectory,
                    false);
                customPatches.push_back(std::move(reference));
            }

            progress.publish(
                L"inventory",
                L"Изучаем моды",
                mod.displayName.empty() ? mod.folderName : mod.displayName,
                L"Определяем, какие файлы нужно добавить в пакет",
                progressPercent(5, 14, index + 1, installedMods.size()),
                index + 1,
                installedMods.size());
        }

        struct SourceArchiveHashState
        {
            std::wstring hash;
            std::uintmax_t expectedBytes{0};
            bool complete{false};
        };
        std::unordered_map<std::wstring, SourceArchiveHashState> sourceArchiveHashes;
        std::uintmax_t totalSourceArchiveBytes = 0;
        for (const PackModReference& reference : sourceArchives)
        {
            if (!reference.sourceArchive.has_value())
            {
                continue;
            }
            const std::wstring key = normalizePathForComparison(reference.sourceArchive->path);
            const auto [iterator, inserted] = sourceArchiveHashes.try_emplace(
                key,
                SourceArchiveHashState{{}, reference.sourceArchive->size, false});
            static_cast<void>(iterator);
            if (inserted)
            {
                addChecked(totalSourceArchiveBytes, reference.sourceArchive->size, "source archives");
            }
        }

        std::uintmax_t hashedSourceArchiveBytes = 0;
        std::uintmax_t hashedSourceArchiveCount = 0;
        for (PackModReference& reference : sourceArchives)
        {
            if (!reference.sourceArchive.has_value())
            {
                continue;
            }

            const std::wstring key = normalizePathForComparison(reference.sourceArchive->path);
            SourceArchiveHashState& state = sourceArchiveHashes.at(key);
            if (!state.complete)
            {
                const std::uintmax_t bytesBeforeArchive = hashedSourceArchiveBytes;
                std::uintmax_t fileBytes = 0;
                state.hash = computeFluxPackFileSha256(
                    reference.sourceArchive->path,
                    [&](std::uintmax_t processedBytes)
                    {
                        fileBytes = processedBytes;
                        progress.publish(
                            L"sources",
                            L"Проверяем исходные архивы",
                            reference.sourceArchive->path.filename().wstring(),
                            L"Сверяем целостность локальных архивов",
                            progressPercent(
                                15,
                                19,
                                bytesBeforeArchive + fileBytes,
                                totalSourceArchiveBytes),
                            hashedSourceArchiveCount,
                            sourceArchiveHashes.size(),
                            bytesBeforeArchive + fileBytes,
                            totalSourceArchiveBytes);
                    });
                hashedSourceArchiveBytes = bytesBeforeArchive +
                    (fileBytes > 0 ? fileBytes : state.expectedBytes);
                ++hashedSourceArchiveCount;
                state.complete = true;
            }
            reference.sourceArchive->sha256 = state.hash;
        }

        std::vector<FileManifestEntry> customConfigs;
        std::vector<FileManifestEntry> profileConfigs =
            scanPayloadFiles(
                paths.profilesDirectory,
                project.project.projectDirectory / L"profiles",
                project.project.projectDirectory,
                true);
        customConfigs.insert(
            customConfigs.end(),
            std::make_move_iterator(profileConfigs.begin()),
            std::make_move_iterator(profileConfigs.end()));
        std::vector<FileManifestEntry> overwriteConfigs =
            scanPayloadFiles(
                paths.overwriteDirectory,
                project.project.projectDirectory / L"overwrite",
                project.project.projectDirectory,
                true);
        customConfigs.insert(
            customConfigs.end(),
            std::make_move_iterator(overwriteConfigs.begin()),
            std::make_move_iterator(overwriteConfigs.end()));

        const std::filesystem::path rootModOrganizerIni =
            project.project.projectDirectory / L"ModOrganizer.ini";
        std::error_code rootIniError;
        if (std::filesystem::is_regular_file(rootModOrganizerIni, rootIniError) &&
            !std::filesystem::is_symlink(rootModOrganizerIni, rootIniError) &&
            !isExcludedPayloadPath(rootModOrganizerIni, payloadExclusions))
        {
            customConfigs.push_back(describePayloadFile(
                rootModOrganizerIni,
                L"ModOrganizer.ini"));
        }

        std::sort(customConfigs.begin(), customConfigs.end(), [](const FileManifestEntry& left, const FileManifestEntry& right)
        {
            return left.relativePath < right.relativePath;
        });

        const std::wstring defaultProfile = project.resolvedTemplate.defaultProfileName.empty()
            ? L"Default"
            : project.resolvedTemplate.defaultProfileName;
        const std::vector<ProfileOrderItemRecord> profileOrder =
            listProfileOrderForPack(
                project.project.projectDirectory,
                paths.modsDirectory,
                defaultProfile,
                logger_);

        std::uintmax_t totalFileCount = customConfigs.size();
        std::uintmax_t totalPayloadBytes = 0;
        const auto countPayloadFiles = [&totalFileCount, &totalPayloadBytes](
                                           const std::vector<FileManifestEntry>& files)
        {
            if (files.size() > std::numeric_limits<std::uintmax_t>::max() - totalFileCount)
            {
                throw std::overflow_error("FluxPack file count exceeds the supported range.");
            }
            totalFileCount += files.size();
            for (const FileManifestEntry& file : files)
            {
                addChecked(totalPayloadBytes, file.size, "payload files");
            }
        };

        for (const PackModReference& reference : generatedAssets)
        {
            countPayloadFiles(reference.files);
        }
        for (const PackModReference& reference : bundledMods)
        {
            countPayloadFiles(reference.files);
        }
        for (const PackModReference& reference : customPatches)
        {
            countPayloadFiles(reference.files);
        }
        for (const FileManifestEntry& file : customConfigs)
        {
            addChecked(totalPayloadBytes, file.size, "configuration files");
        }

        const std::filesystem::path outputDirectory = absoluteOutput.parent_path();
        std::error_code spaceError;
        const std::filesystem::space_info outputSpace = std::filesystem::space(outputDirectory, spaceError);
        if (!spaceError)
        {
            std::uintmax_t estimatedManifestBytes = 1024ULL * 1024ULL;
            const std::uintmax_t perFileManifestBytes = 768;
            if (totalFileCount <=
                (std::numeric_limits<std::uintmax_t>::max() - estimatedManifestBytes) / perFileManifestBytes)
            {
                estimatedManifestBytes += totalFileCount * perFileManifestBytes;
            }
            else
            {
                estimatedManifestBytes = std::numeric_limits<std::uintmax_t>::max();
            }

            std::uintmax_t requiredBytes = totalPayloadBytes;
            addChecked(requiredBytes, estimatedManifestBytes, "the output package");
            if (outputSpace.available < requiredBytes)
            {
                throw std::runtime_error(
                    "Not enough free disk space to package this build. Free space on the destination drive and retry.");
            }
        }

        progress.publish(
            L"packing",
            L"Добавляем файлы в пакет",
            project.project.name,
            L"Копируем файлы без загрузки всей сборки в память",
            20,
            0,
            totalFileCount,
            0,
            totalPayloadBytes,
            true);

        std::uintmax_t processedFiles = 0;
        std::uintmax_t processedBytes = 0;
        std::uintmax_t manifestBytes = 0;
        FluxPackContentStoreStatistics contentStoreStatistics;
        AtomicFileWriteOptions writeOptions;
        writeOptions.stateName = L"FluxPack package";
        writeOptions.validation = ProjectStateValidation::None;
        writeOptions.keepBackup = false;
        writeOptions.validator = [](const std::filesystem::path& packagePath)
        {
            FluxPackPackageReader reader(packagePath);
            const std::string manifest = reader.readManifest();
            const JsonValue root = JsonReader::parse(fromUtf8(manifest));
            const FluxPackManifest parsed = parseFluxPackManifest(packagePath, root, manifest.size());
            if (parsed.summary.formatVersion >= 3)
            {
                reader.setContentStore(parsed.contentChunks);
            }
        };

        AtomicFileStore().writeFileAtomically(
            absoluteOutput,
            [&](const std::filesystem::path& temporaryPath)
            {
                FluxPackPackageWriter package(temporaryPath, FluxPackCompressionMode::Smallest);
                const auto packagingPercent = [&]()
                {
                    return totalPayloadBytes > 0
                        ? progressPercent(20, 90, processedBytes, totalPayloadBytes)
                        : progressPercent(20, 90, processedFiles, totalFileCount);
                };

                std::vector<FileManifestEntry*> filesToPack;
                filesToPack.reserve(static_cast<std::size_t>(totalFileCount));
                const auto collectFiles = [&](std::vector<FileManifestEntry>& files)
                {
                    for (FileManifestEntry& file : files)
                    {
                        filesToPack.push_back(&file);
                    }
                };

                for (PackModReference& reference : generatedAssets)
                {
                    collectFiles(reference.files);
                }
                for (PackModReference& reference : bundledMods)
                {
                    collectFiles(reference.files);
                }
                for (PackModReference& reference : customPatches)
                {
                    collectFiles(reference.files);
                }
                collectFiles(customConfigs);

                std::vector<std::filesystem::path> sourcePaths;
                sourcePaths.reserve(filesToPack.size());
                for (const FileManifestEntry* file : filesToPack)
                {
                    sourcePaths.push_back(file->path);
                }

                if (!filesToPack.empty())
                {
                    progress.publish(
                        L"packing",
                        L"Добавляем файлы в пакет",
                        filesToPack.front()->relativePath,
                        L"Разбиваем, сжимаем и проверяем содержимое",
                        packagingPercent(),
                        processedFiles,
                        totalFileCount,
                        processedBytes,
                        totalPayloadBytes,
                        true);
                }

                std::vector<std::uintmax_t> fileProgress(filesToPack.size(), 0);
                std::vector<bool> fileCompleted(filesToPack.size(), false);
                std::vector<FluxPackPayloadReference> payloads = package.appendFiles(
                    sourcePaths,
                    [&](std::size_t index, std::uintmax_t fileBytes)
                    {
                        if (index >= filesToPack.size())
                        {
                            throw std::logic_error("FluxPack package progress index is invalid.");
                        }
                        if (fileBytes > fileProgress[index])
                        {
                            addChecked(
                                processedBytes,
                                fileBytes - fileProgress[index],
                                "packed payload progress");
                            fileProgress[index] = fileBytes;
                        }
                        if (!fileCompleted[index] && fileBytes >= filesToPack[index]->size)
                        {
                            fileCompleted[index] = true;
                            ++processedFiles;
                        }
                        progress.publish(
                            L"packing",
                            L"Добавляем файлы в пакет",
                            filesToPack[index]->relativePath,
                            L"Разбиваем, сжимаем и проверяем содержимое",
                            packagingPercent(),
                            processedFiles,
                            totalFileCount,
                            processedBytes,
                            totalPayloadBytes);
                    });
                if (payloads.size() != filesToPack.size())
                {
                    throw std::logic_error("FluxPack package returned an incomplete payload map.");
                }
                for (std::size_t index = 0; index < filesToPack.size(); ++index)
                {
                    if (payloads[index].size > fileProgress[index])
                    {
                        addChecked(
                            processedBytes,
                            payloads[index].size - fileProgress[index],
                            "packed payload completion");
                    }
                    if (!fileCompleted[index])
                    {
                        ++processedFiles;
                    }
                    filesToPack[index]->size = payloads[index].size;
                    filesToPack[index]->sha256 = payloads[index].sha256;
                    filesToPack[index]->payload = std::move(payloads[index]);
                }
                contentStoreStatistics = package.contentStoreStatistics();

                progress.publish(
                    L"manifest",
                    L"Сохраняем описание сборки",
                    project.project.name,
                    L"Записываем список модов, настроек и порядок загрузки",
                    94,
                    processedFiles,
                    totalFileCount,
                    processedBytes,
                    totalPayloadBytes,
                    true);
                const std::wstring manifest = serializeFluxPack(
                    project,
                    paths,
                    sourceArchives,
                    bundledMods,
                    generatedAssets,
                    customPatches,
                    customConfigs,
                    profileOrder,
                    package.contentChunks(),
                    contentStoreStatistics,
                    includeGeneratedAssets,
                    request.packageType);
                const std::string manifestUtf8 = toUtf8(manifest);
                manifestBytes = manifestUtf8.size();
                package.finish(manifestUtf8);
                progress.publish(
                    L"finalizing",
                    L"Завершаем упаковку",
                    absoluteOutput.filename().wstring(),
                    L"Проверяем пакет и безопасно заменяем предыдущий файл",
                    98,
                    processedFiles,
                    totalFileCount,
                    processedBytes,
                    totalPayloadBytes,
                    true);
            },
            writeOptions);

        FluxPackSummary summary;
        summary.outputPath = absoluteOutput;
        summary.buildName = project.project.name;
        summary.formatVersion = packageFormatVersion;
        summary.manifestBytes = manifestBytes;
        summary.sourceArchiveCount = sourceArchives.size();
        summary.bundledModCount = bundledMods.size();
        summary.generatedAssetCount = generatedAssets.size();
        summary.customPatchCount = customPatches.size();
        summary.customConfigCount = customConfigs.size();
        summary.installStepCount = 4;
        summary.generatedAssetsIncluded = includeGeneratedAssets;
        summary.installPlanAvailable = true;
        summary.packageType = std::wstring(fluxPackPackageTypeId(request.packageType));
        summary.compressionMode = std::wstring(fluxPackCompressionModeId(FluxPackCompressionMode::Smallest));
        summary.logicalPayloadBytes = contentStoreStatistics.logicalBytes;
        summary.uniquePayloadBytes = contentStoreStatistics.uniqueBytes;
        summary.storedPayloadBytes = contentStoreStatistics.storedBytes;
        summary.deduplicatedPayloadBytes = contentStoreStatistics.deduplicatedBytes;
        summary.uniqueChunkCount = contentStoreStatistics.uniqueChunkCount;
        summary.dictionaryCount = contentStoreStatistics.dictionaryCount;

        progress.publish(
            L"complete",
            L"Сборка упакована",
            absoluteOutput.filename().wstring(),
            L"FluxPack готов",
            100,
            processedFiles,
            totalFileCount,
            processedBytes,
            totalPayloadBytes,
            true);

        logger_.writeOperation(
            LogLevel::Info,
            "FluxPack",
            "FluxPack export completed. sourceArchives=" + std::to_string(sourceArchives.size()) +
                ", bundledMods=" + std::to_string(bundledMods.size()) +
                ", generatedAssets=" + std::to_string(generatedAssets.size()) +
                ", customPatches=" + std::to_string(customPatches.size()) +
                ", customConfigs=" + std::to_string(customConfigs.size()) +
                ", payloadFiles=" + std::to_string(processedFiles) +
                ", payloadBytes=" + std::to_string(processedBytes) +
                ", uniqueChunks=" + std::to_string(contentStoreStatistics.uniqueChunkCount) +
                ", storedBytes=" + std::to_string(contentStoreStatistics.storedBytes) +
                ", deduplicatedBytes=" + std::to_string(contentStoreStatistics.deduplicatedBytes) +
                ", compressionMode=" + toUtf8(summary.compressionMode) +
                ", packageType=" + toUtf8(summary.packageType) +
                ", manifestBytes=" + std::to_string(manifestBytes) +
                ", formatVersion=" + std::to_string(packageFormatVersion));

        return summary;
    }

    FluxPackSummary FluxPackService::inspectFluxPack(const std::filesystem::path& fluxPackPath) const
    {
        if (fluxPackPath.empty())
        {
            throw std::invalid_argument("FluxPack path is required.");
        }

        const std::filesystem::path absolutePath =
            std::filesystem::absolute(fluxPackPath).lexically_normal();
        std::error_code sizeError;
        const std::uintmax_t packageBytes = std::filesystem::file_size(absolutePath, sizeError);
        if (sizeError)
        {
            throw std::invalid_argument("FluxPack file could not be inspected.");
        }
        std::string manifestContent;
        if (FluxPackPackageReader::isPackage(absolutePath))
        {
            manifestContent = FluxPackPackageReader(absolutePath).readManifest();
        }
        else
        {
            if (packageBytes > maxLegacyManifestBytes)
            {
                throw std::invalid_argument(
                    "Legacy FluxPack manifest is too large to open safely. Re-export it with the current Fluxora version.");
            }
            manifestContent = readTextFile(absolutePath);
        }
        const std::uintmax_t manifestBytes = manifestContent.size();
        const JsonValue root = JsonReader::parse(fromUtf8(manifestContent));
        FluxPackSummary summary = summaryFromJson(root, absolutePath, sizeError ? 0 : manifestBytes);

        logger_.writeOperation(
            LogLevel::Info,
            "FluxPack",
            "FluxPack inspected. path=\"" + pathForLog(absolutePath) +
                "\", sourceArchives=" + std::to_string(summary.sourceArchiveCount) +
                ", installSteps=" + std::to_string(summary.installStepCount));
        return summary;
    }

    FluxPackInstallPlan FluxPackService::planInstall(const FluxPackInstallPlanRequest& request) const
    {
        if (request.fluxPackPath.empty())
        {
            throw std::invalid_argument("FluxPack path is required.");
        }

        const std::filesystem::path absolutePath =
            std::filesystem::absolute(request.fluxPackPath).lexically_normal();
        std::error_code sizeError;
        const std::uintmax_t packageBytes = std::filesystem::file_size(absolutePath, sizeError);
        if (sizeError)
        {
            throw std::invalid_argument("FluxPack file could not be inspected.");
        }

        std::string manifestContent;
        if (FluxPackPackageReader::isPackage(absolutePath))
        {
            manifestContent = FluxPackPackageReader(absolutePath).readManifest();
        }
        else
        {
            if (packageBytes > maxLegacyManifestBytes)
            {
                throw std::invalid_argument(
                    "Legacy FluxPack manifest is too large to plan safely. Re-export it with the current Fluxora version.");
            }
            manifestContent = readTextFile(absolutePath);
        }

        const JsonValue root = JsonReader::parse(fromUtf8(manifestContent));
        const FluxPackManifest manifest = parseFluxPackManifest(
            absolutePath,
            root,
            manifestContent.size());
        if (manifest.templateId.empty())
        {
            throw std::invalid_argument("FluxPack build template is missing.");
        }
        if (!manifest.summary.installPlanAvailable)
        {
            throw std::invalid_argument("FluxPack install plan is missing.");
        }

        FluxPackInstallPlan plan;
        plan.summary = manifest.summary;
        plan.updatesExistingProject = !request.existingConfigPath.empty();

        std::optional<BuildPathSettings> existingPaths;
        std::vector<InstalledModRecord> installedMods;
        std::vector<InstalledModArchiveSourceRecord> installedArchiveSources;
        if (plan.updatesExistingProject)
        {
            const ProjectOpenResult existing = projects_.openProjectConfig(
                std::filesystem::absolute(request.existingConfigPath).lexically_normal());
            if (!equalsIgnoreCase(existing.resolvedTemplate.id, manifest.templateId))
            {
                throw std::invalid_argument(
                    "FluxPack cannot update this build because its game template is different.");
            }
            existingPaths = pathSettings_.loadForConfig(existing.project.configPath);
            installedMods = listInstalledModsForDelta(
                existing.project.projectDirectory,
                existingPaths->modsDirectory,
                logger_);
            installedArchiveSources =
                InstanceMetadataStore::listInstalledModArchiveSources(
                    existing.project.projectDirectory);
        }

        const std::vector<bool> reusableInstalledSources =
            reusableInstalledSourceFlags(
                installedMods,
                installedArchiveSources,
                manifest.sourceArchives);
        plan.sources.reserve(manifest.sourceArchives.size());
        for (std::size_t index = 0; index < manifest.sourceArchives.size(); ++index)
        {
            const FluxPackSourceReference& source = manifest.sourceArchives[index];
            FluxPackSourceInstallPlan sourcePlan;
            sourcePlan.sourceId = sourceInstallId(source, index);
            sourcePlan.providerId = providerIdForSource(source);
            sourcePlan.providerDisplayName = providerDisplayName(sourcePlan.providerId);
            sourcePlan.displayName = sourceInstallName(source);
            sourcePlan.version = source.version;
            sourcePlan.archiveFileName = source.archiveFileName;
            sourcePlan.manualDownloadUrl = manualDownloadUrlForSource(source);

            if (reusableInstalledSources[index])
            {
                sourcePlan.acquisitionMode = L"installed";
                ++plan.reusableSourceCount;
            }
            else if (existingPaths.has_value() &&
                currentDownloadArchivePath(existingPaths->downloadsDirectory, source, logger_).has_value())
            {
                sourcePlan.acquisitionMode = L"cached-download";
                ++plan.reusableDownloadCount;
            }
            else if (localSourceArchivePath(manifest, source, pathSettings_, logger_).has_value())
            {
                sourcePlan.acquisitionMode = L"source-build";
                ++plan.reusableDownloadCount;
            }
            else
            {
                sourcePlan.canAutomaticallyDownload =
                    sourcePlan.providerId == L"nexus" &&
                    !nxmLinkForSource(source).empty() &&
                    downloads_.canAutomaticallyDownloadNexus();
                if (sourcePlan.canAutomaticallyDownload)
                {
                    sourcePlan.acquisitionMode = L"automatic";
                    ++plan.automaticDownloadCount;
                }
                else if (!sourcePlan.manualDownloadUrl.empty())
                {
                    sourcePlan.acquisitionMode = L"manual";
                    sourcePlan.requiresManualDownload = true;
                    ++plan.manualDownloadCount;
                }
                else
                {
                    sourcePlan.acquisitionMode = L"unavailable";
                }
            }

            plan.sources.push_back(std::move(sourcePlan));
        }

        logger_.writeOperation(
            LogLevel::Info,
            "FluxPack",
            "FluxPack install planned. path=\"" + pathForLog(absolutePath) +
                "\", deltaUpdate=" + (plan.updatesExistingProject ? std::string("true") : std::string("false")) +
                ", reusableSources=" + std::to_string(plan.reusableSourceCount) +
                ", reusableDownloads=" + std::to_string(plan.reusableDownloadCount) +
                ", automaticDownloads=" + std::to_string(plan.automaticDownloadCount) +
                ", manualDownloads=" + std::to_string(plan.manualDownloadCount));
        return plan;
    }

    FluxPackInstallResult FluxPackService::installFluxPack(const FluxPackInstallRequest& request) const
    {
        if (request.fluxPackPath.empty())
        {
            throw std::invalid_argument("FluxPack path is required.");
        }
        if (request.installRootDirectory.empty())
        {
            throw std::invalid_argument("Install root directory is required.");
        }

        const std::filesystem::path absolutePath =
            std::filesystem::absolute(request.fluxPackPath).lexically_normal();
        const std::filesystem::path installRoot =
            std::filesystem::absolute(request.installRootDirectory).lexically_normal();

        std::error_code rootExistsError;
        const bool rootExists = std::filesystem::exists(installRoot, rootExistsError);
        if (rootExistsError)
        {
            logger_.writeOperation(
                LogLevel::Error,
                "FluxPack",
                "FluxPack install root could not be inspected. installRoot=\"" +
                    pathForLog(installRoot) + "\", error=\"" + rootExistsError.message() + "\".");
            throw std::invalid_argument(
                std::string("Install root directory could not be inspected: ") +
                rootExistsError.message());
        }
        if (rootExists)
        {
            std::error_code rootDirectoryError;
            const bool rootIsDirectory = std::filesystem::is_directory(installRoot, rootDirectoryError);
            if (rootDirectoryError)
            {
                logger_.writeOperation(
                    LogLevel::Error,
                    "FluxPack",
                    "FluxPack install root directory check failed. installRoot=\"" +
                        pathForLog(installRoot) + "\", error=\"" + rootDirectoryError.message() + "\".");
                throw std::invalid_argument(
                    std::string("Install root directory could not be inspected: ") +
                    rootDirectoryError.message());
            }
            if (!rootIsDirectory)
            {
                logger_.writeOperation(
                    LogLevel::Error,
                    "FluxPack",
                    "FluxPack install root is not a directory. installRoot=\"" +
                        pathForLog(installRoot) + "\".");
                throw std::invalid_argument("Install root directory is not a directory.");
            }
        }
        PathSafetyService().validateDirectoryWriteRoot(installRoot)
            .throwIfUnsafe("Install root directory is unsafe");
        if (!rootExists)
        {
            logger_.writeOperation(
                LogLevel::Info,
                "FluxPack",
                "FluxPack install will create missing install root. installRoot=\"" +
                    pathForLog(installRoot) + "\".");
        }

        std::error_code sizeError;
        const std::uintmax_t packageBytes = std::filesystem::file_size(absolutePath, sizeError);
        if (sizeError)
        {
            throw std::invalid_argument("FluxPack file could not be inspected.");
        }
        std::optional<FluxPackPackageReader> packageReader;
        std::string manifestContent;
        if (FluxPackPackageReader::isPackage(absolutePath))
        {
            packageReader.emplace(absolutePath);
            manifestContent = packageReader->readManifest();
        }
        else
        {
            if (packageBytes > maxLegacyManifestBytes)
            {
                throw std::invalid_argument(
                    "Legacy FluxPack manifest is too large to install safely. Re-export it with the current Fluxora version.");
            }
            manifestContent = readTextFile(absolutePath);
        }
        const std::uintmax_t manifestBytes = manifestContent.size();
        const JsonValue root = JsonReader::parse(fromUtf8(manifestContent));
        FluxPackManifest manifest = parseFluxPackManifest(absolutePath, root, sizeError ? 0 : manifestBytes);
        if (packageReader.has_value() && manifest.summary.formatVersion >= 3)
        {
            packageReader->setContentStore(manifest.contentChunks);
        }
        if (manifest.templateId.empty())
        {
            throw std::invalid_argument("FluxPack build template is missing.");
        }
        if (!manifest.summary.installPlanAvailable)
        {
            throw std::invalid_argument("FluxPack install plan is missing.");
        }
        const std::unordered_map<std::wstring, std::filesystem::path> manualSourceArchives =
            validateManualSourceArchives(
                request.manualSourceArchives,
                manifest.sourceArchives,
                logger_);

        const bool updateExistingProject = !request.existingConfigPath.empty();
        std::optional<ProjectOpenResult> existingProject;
        std::optional<BuildPathSettings> existingInstallPaths;
        std::wstring projectName;
        std::filesystem::path projectDirectory;
        ResolvedFluxPackGameDirectory installGameDirectory;
        if (updateExistingProject)
        {
            const std::filesystem::path existingConfigPath =
                std::filesystem::absolute(request.existingConfigPath).lexically_normal();
            existingProject = projects_.openProjectConfig(existingConfigPath);
            if (!equalsIgnoreCase(existingProject->resolvedTemplate.id, manifest.templateId))
            {
                throw std::invalid_argument(
                    "FluxPack cannot update this build because its game template is different.");
            }

            existingInstallPaths = pathSettings_.loadForConfig(existingProject->project.configPath);
            projectName = existingProject->project.name;
            projectDirectory = existingProject->project.projectDirectory;
            installGameDirectory = ResolvedFluxPackGameDirectory{
                existingInstallPaths->gameDirectory,
                true
            };
        }
        else
        {
            projectName = uniqueProjectName(projects_, installRoot, manifest.buildName);
            projectDirectory = projects_.buildProjectDirectory(installRoot, projectName);
            installGameDirectory =
                resolveInstallGameDirectory(manifest, pathSettings_, logger_, projectDirectory);
        }
        if (installGameDirectory.path.empty())
        {
            throw std::invalid_argument("FluxPack game directory could not be resolved.");
        }

        if (!installGameDirectory.validateExistingGame)
        {
            PathSafetyService().validateWritePath(projectDirectory, installGameDirectory.path)
                .throwIfUnsafe("FluxPack game directory is unsafe");
        }

        std::vector<ProviderInstallState> providers = buildProviderStates(manifest.sourceArchives);
        publishInstallProgress(
            request.progress,
            providers,
            L"inspect",
            L"FluxPack прочитан",
            absolutePath.filename().wstring(),
            L"Проверяем рецепт и install plan",
            8);

        logger_.writeOperation(
            LogLevel::Info,
            "FluxPack",
            "FluxPack install requested. path=\"" + pathForLog(absolutePath) +
                "\", installRoot=\"" + pathForLog(installRoot) +
                "\", buildName=\"" + toUtf8(projectName) +
                "\", deltaUpdate=" + (updateExistingProject ? std::string("true") : std::string("false")) +
                "\", gameDirectory=\"" + pathForLog(installGameDirectory.path) +
                "\", sourceArchives=" + std::to_string(manifest.sourceArchives.size()));

        publishInstallProgress(
            request.progress,
            providers,
            L"project",
            updateExistingProject ? L"Обновляем сборку" : L"Создаём сборку",
            projectName,
            updateExistingProject
                ? L"Сопоставляем FluxPack с текущей сборкой"
                : L"Готовим структуру проекта Fluxora",
            16);

        ProjectDescriptor project;
        if (updateExistingProject)
        {
            project = existingProject->project;
        }
        else
        {
            project = projects_.createProject(ProjectCreateRequest{
                projectName,
                manifest.templateId,
                installGameDirectory.path,
                installRoot,
                installGameDirectory.validateExistingGame
            });
        }
        FluxPackInstallCleanup installCleanup(projects_, logger_, project.configPath);
        if (updateExistingProject)
        {
            installCleanup.dismiss();
        }

        if (!updateExistingProject && !installGameDirectory.validateExistingGame)
        {
            PathSafetyService().validateWritePath(project.projectDirectory, project.gamePath)
                .throwIfUnsafe("FluxPack game directory is unsafe");
            std::filesystem::create_directories(project.gamePath);
            logger_.writeOperation(
                LogLevel::Info,
                "FluxPack",
                "FluxPack install using local game directory. gameDirectory=\"" +
                    pathForLog(project.gamePath) + "\"");
        }

        const BuildPathSettings savedInstallPaths = updateExistingProject
            ? existingInstallPaths.value()
            : pathSettings_.saveForConfig(
                  project.configPath,
                  BuildPathSettings{
                      project.gamePath,
                      project.projectDirectory / L"mods",
                      project.projectDirectory / L"profiles",
                      project.projectDirectory / L"downloads",
                      project.projectDirectory / L"overwrite"
                  });
        static_cast<void>(savedInstallPaths);

        FluxPackInstallResult result;
        result.summary = manifest.summary;
        result.configPath = project.configPath;
        result.projectDirectory = project.projectDirectory;
        result.buildName = project.name;
        result.totalSourceCount = manifest.sourceArchives.size();
        result.updatedExistingProject = updateExistingProject;
        const std::vector<InstalledModRecord> installedMods = updateExistingProject
            ? listInstalledModsForDelta(
                  project.projectDirectory,
                  savedInstallPaths.modsDirectory,
                  logger_)
            : std::vector<InstalledModRecord>{};
        const std::vector<InstalledModArchiveSourceRecord> installedArchiveSources =
            updateExistingProject
            ? InstanceMetadataStore::listInstalledModArchiveSources(
                  project.projectDirectory)
            : std::vector<InstalledModArchiveSourceRecord>{};
        const std::vector<bool> reusableInstalledSources =
            reusableInstalledSourceFlags(
                installedMods,
                installedArchiveSources,
                manifest.sourceArchives);

        publishInstallProgress(
            request.progress,
            providers,
            L"sources",
            L"Скачиваем источники",
            {},
            L"Подключаем источники из FluxPack",
            manifest.sourceArchives.empty() ? 68 : 24);

        std::unordered_set<std::wstring> failedSourceTargets;
        for (std::size_t sourceIndex = 0; sourceIndex < manifest.sourceArchives.size(); ++sourceIndex)
        {
            const FluxPackSourceReference& source = manifest.sourceArchives[sourceIndex];
            ProviderInstallState& provider = providerStateFor(providers, providerIdForSource(source));
            const std::wstring installName = sourceInstallTargetName(source);
            const std::wstring sourceDisplayName = sourceInstallName(source);
            const std::wstring sourceId = sourceInstallId(source, sourceIndex);
            const std::wstring targetKey = toLower(installName);
            provider.currentItem = sourceDisplayName;
            provider.statusText = updateExistingProject ? L"Проверяем Delta" : L"Скачиваем";
            if (source.installMode == FluxPackSourceInstallMode::Merge &&
                failedSourceTargets.contains(targetKey))
            {
                ++provider.failed;
                ++result.failedSourceCount;
                provider.statusText = L"Основной источник не установлен";
                logger_.writeOperation(
                    LogLevel::Warning,
                    "FluxPack",
                    "FluxPack skipped a merged source because an earlier source for the same target failed. mod=\"" +
                        toUtf8(installName) + "\", source=\"" +
                        toUtf8(sourceDisplayName) + "\"");
                publishInstallProgress(
                    request.progress,
                    providers,
                    L"sources",
                    L"Источник пропущен",
                    sourceDisplayName,
                    provider.statusText,
                    sourceInstallOverallPercent(providers));
                continue;
            }
            publishInstallProgress(
                request.progress,
                providers,
                L"sources",
                updateExistingProject ? L"Сопоставляем источники" : L"Скачиваем источники",
                installName,
                L"Источник: " + provider.displayName,
                sourceInstallOverallPercent(providers));

            if (reusableInstalledSources[sourceIndex])
            {
                const auto reusable = std::find_if(
                    installedMods.begin(),
                    installedMods.end(),
                    [&source](const InstalledModRecord& mod)
                    {
                        return equalsIgnoreCase(
                            mod.folderName,
                            sourceInstallTargetName(source));
                    });
                const InstalledModRecord* reusableRecord =
                    reusable == installedMods.end()
                    ? findReusableInstalledSource(installedMods, source)
                    : &*reusable;
                if (reusableRecord == nullptr)
                {
                    throw std::runtime_error(
                        "FluxPack reusable source target disappeared during install.");
                }
                const bool currentlyEnabled =
                    !equalsIgnoreCase(reusableRecord->state, L"disabled");
                if (currentlyEnabled != source.enabled)
                {
                    InstanceMetadataStore::setInstalledModEnabled(
                        project.projectDirectory,
                        reusableRecord->path,
                        source.enabled);
                }

                ++provider.completed;
                ++result.reusedSourceCount;
                provider.statusText = L"Уже установлен";
                logger_.writeOperation(
                    LogLevel::Info,
                    "FluxPack",
                    "FluxPack delta reused installed source mod. provider=\"" +
                        toUtf8(provider.id) +
                        "\", mod=\"" + toUtf8(installName) +
                        "\", folder=\"" + toUtf8(reusableRecord->folderName) + "\"");
                publishInstallProgress(
                    request.progress,
                    providers,
                    L"sources",
                    L"Переиспользуем мод",
                    installName,
                    L"Мод уже соответствует FluxPack",
                    sourceInstallOverallPercent(providers));
                continue;
            }

            try
            {
                std::optional<DownloadEntry> localEntry;
                bool reusedLocalArchive = false;
                if (updateExistingProject)
                {
                    if (const std::optional<std::filesystem::path> cachedArchive =
                            currentDownloadArchivePath(
                                savedInstallPaths.downloadsDirectory,
                                source,
                                logger_);
                        cachedArchive.has_value())
                    {
                        provider.statusText = L"Используем загруженный архив";
                        publishInstallProgress(
                            request.progress,
                            providers,
                            L"sources",
                            L"Переиспользуем загрузку",
                            installName,
                            cachedArchive->filename().wstring(),
                            sourceInstallOverallPercent(providers));

                        writeFluxPackDownloadMetadata(cachedArchive.value(), source);
                        DownloadEntry cachedEntry;
                        cachedEntry.fileName = cachedArchive->filename().wstring();
                        cachedEntry.localPath = cachedArchive.value();
                        localEntry = std::move(cachedEntry);
                        reusedLocalArchive = true;
                        logger_.writeOperation(
                            LogLevel::Info,
                            "FluxPack",
                            "FluxPack delta reused an archive from the current downloads directory. provider=\"" +
                                toUtf8(provider.id) +
                                "\", mod=\"" + toUtf8(installName) +
                                "\", archive=\"" + pathForLog(cachedArchive.value()) + "\"");
                    }
                }

                if (!localEntry.has_value())
                {
                    if (const std::optional<std::filesystem::path> localArchive =
                            localSourceArchivePath(manifest, source, pathSettings_, logger_);
                        localArchive.has_value())
                    {
                        provider.statusText = L"Копируем локальный архив";
                        publishInstallProgress(
                            request.progress,
                            providers,
                            L"sources",
                            L"Копируем источник",
                            installName,
                            L"Используем архив из перенесённой сборки",
                            sourceInstallOverallPercent(providers));

                        try
                        {
                            DownloadEntry imported =
                                downloads_.importLocalFile(project.projectDirectory, localArchive.value());
                            writeFluxPackDownloadMetadata(imported.localPath, source);
                            logger_.writeOperation(
                                LogLevel::Info,
                                "FluxPack",
                                "FluxPack source archive restored from source build downloads. provider=\"" +
                                    toUtf8(provider.id) +
                                    "\", mod=\"" + toUtf8(installName) +
                                    "\", archive=\"" + pathForLog(localArchive.value()) + "\"");
                            localEntry = std::move(imported);
                            reusedLocalArchive = true;
                        }
                        catch (const std::exception& exception)
                        {
                            logger_.writeOperation(
                                LogLevel::Warning,
                                "FluxPack",
                                "FluxPack local source archive could not be imported; falling back to remote download. provider=\"" +
                                    toUtf8(provider.id) +
                                    "\", mod=\"" + toUtf8(installName) +
                                    "\", archive=\"" + pathForLog(localArchive.value()) +
                                    "\", reason=\"" + exception.what() + "\"");
                        }
                    }
                }

                if (!localEntry.has_value())
                {
                    if (const auto manualArchive = manualSourceArchives.find(sourceId);
                        manualArchive != manualSourceArchives.end())
                    {
                        provider.statusText = L"Используем выбранный архив";
                        publishInstallProgress(
                            request.progress,
                            providers,
                            L"sources",
                            L"Проверяем ручную загрузку",
                            installName,
                            manualArchive->second.filename().wstring(),
                            sourceInstallOverallPercent(providers));
                        DownloadEntry imported =
                            downloads_.importLocalFile(project.projectDirectory, manualArchive->second);
                        writeFluxPackDownloadMetadata(imported.localPath, source);
                        localEntry = std::move(imported);
                    }
                }

                DownloadEntry entry;
                if (localEntry.has_value())
                {
                    entry = std::move(localEntry.value());
                }
                else
                {
                    const std::wstring nxmLink = nxmLinkForSource(source);
                    if (provider.id == L"nexus" &&
                        !nxmLink.empty() &&
                        downloads_.canAutomaticallyDownloadNexus())
                    {
                        provider.statusText = L"Скачиваем автоматически";
                        publishInstallProgress(
                            request.progress,
                            providers,
                            L"sources",
                            L"Скачиваем с Nexus Mods",
                            installName,
                            L"Premium: автоматическая загрузка",
                            sourceInstallOverallPercent(providers));
                        entry = downloads_.downloadNxmForFluxPack(project.projectDirectory, nxmLink);
                    }
                    else if (provider.id == L"nexus" && !nxmLink.empty())
                    {
                        ++provider.failed;
                        ++result.failedSourceCount;
                        failedSourceTargets.insert(targetKey);
                        provider.statusText = L"Скачайте вручную и выберите архив";
                        logger_.writeOperation(
                            LogLevel::Info,
                            "FluxPack",
                            "FluxPack Nexus source requires a user-selected archive. provider=\"nexus\", mod=\"" +
                                toUtf8(installName) + "\"");
                        publishInstallProgress(
                            request.progress,
                            providers,
                            L"sources",
                            L"Требуется ручная загрузка",
                            installName,
                            provider.statusText,
                            sourceInstallOverallPercent(providers));
                        continue;
                    }
                    else
                    {
                        ++provider.failed;
                        ++result.failedSourceCount;
                        failedSourceTargets.insert(targetKey);
                        provider.statusText = L"Автозагрузка недоступна";
                        logger_.writeOperation(
                            LogLevel::Warning,
                            "FluxPack",
                            "FluxPack source cannot be downloaded automatically. provider=\"" + toUtf8(provider.id) +
                                "\", mod=\"" + toUtf8(installName) + "\"");
                        publishInstallProgress(
                            request.progress,
                            providers,
                            L"sources",
                            L"Источник не установлен",
                            installName,
                            L"Для этого источника нет автоматической загрузки",
                            sourceInstallOverallPercent(providers));
                        continue;
                    }
                }
                provider.statusText = L"Устанавливаем";
                publishInstallProgress(
                    request.progress,
                    providers,
                    L"sources",
                    L"Устанавливаем мод",
                    installName,
                    entry.fileName,
                    sourceInstallOverallPercent(providers));

                InstalledMod installed;
                const ExistingModInstallMode existingModMode =
                    source.installMode == FluxPackSourceInstallMode::Merge
                    ? ExistingModInstallMode::Merge
                    : (updateExistingProject
                        ? ExistingModInstallMode::Replace
                        : ExistingModInstallMode::FailIfExists);
                const FomodInstallerDescriptor fomod = downloads_.analyzeFomodDownload(
                    project.projectDirectory,
                    entry.localPath);
                if (fomod.isFomod)
                {
                    installed = downloads_.installFomodDownload(
                        project.projectDirectory,
                        entry.localPath,
                        installName,
                        existingModMode,
                        {});
                }
                else
                {
                    installed = downloads_.installDownload(
                        project.projectDirectory,
                        entry.localPath,
                        installName,
                        existingModMode);
                }

                if (!source.enabled)
                {
                    InstanceMetadataStore::setInstalledModEnabled(project.projectDirectory, installed.id, false);
                }

                ++provider.completed;
                ++result.installedSourceCount;
                if (reusedLocalArchive)
                {
                    ++result.reusedDownloadCount;
                }
                provider.statusText = L"Установлено";
                publishInstallProgress(
                    request.progress,
                    providers,
                    L"sources",
                    L"Мод установлен",
                    installName,
                    provider.displayName,
                    sourceInstallOverallPercent(providers));
            }
            catch (const std::exception& exception)
            {
                ++provider.failed;
                ++result.failedSourceCount;
                failedSourceTargets.insert(targetKey);
                provider.statusText = L"Ошибка";
                logger_.writeOperation(
                    LogLevel::Error,
                    "FluxPack",
                    "FluxPack source install failed. provider=\"" + toUtf8(provider.id) +
                        "\", mod=\"" + toUtf8(installName) +
                        "\", reason=\"" + exception.what() + "\"");
                publishInstallProgress(
                    request.progress,
                    providers,
                    L"sources",
                    L"Источник не установлен",
                    installName,
                    std::wstring(exception.what(), exception.what() + std::strlen(exception.what())),
                    sourceInstallOverallPercent(providers));
            }
        }

        publishInstallProgress(
            request.progress,
            providers,
            L"embedded",
            L"Восстанавливаем локальные файлы",
            project.name,
            L"Пишем embedded mods из FluxPack",
            76);

        const FluxPackPackageReader* packageReaderPointer =
            packageReader.has_value() ? &packageReader.value() : nullptr;
        FluxPackDeltaApplyStatistics deltaStatistics;
        applyEmbeddedMods(
            project.projectDirectory,
            manifest.bundledMods,
            packageReaderPointer,
            logger_,
            false,
            deltaStatistics);
        applyEmbeddedMods(
            project.projectDirectory,
            manifest.customPatches,
            packageReaderPointer,
            logger_,
            true,
            deltaStatistics);
        applyEmbeddedMods(
            project.projectDirectory,
            manifest.generatedAssets,
            packageReaderPointer,
            logger_,
            false,
            deltaStatistics);

        publishInstallProgress(
            request.progress,
            providers,
            L"configs",
            L"Применяем настройки",
            manifest.defaultProfile,
            L"Пишем embedded config и порядок профиля",
            84);

        result.appliedConfigCount = applyEmbeddedConfigs(
            project.projectDirectory,
            manifest.customConfigs,
            packageReaderPointer,
            logger_,
            deltaStatistics);
        result.appliedProfileOrderItemCount = applyProfileOrder(
            project.projectDirectory,
            manifest.defaultProfile,
            manifest.profileOrder);
        result.reusedFileCount = deltaStatistics.reusedFileCount;
        result.materializedFileCount = deltaStatistics.materializedFileCount;
        result.hasWarnings = result.pendingSourceCount > 0 || result.failedSourceCount > 0;

        publishInstallProgress(
            request.progress,
            providers,
            L"complete",
            result.hasWarnings ? L"Установка завершена с предупреждениями" : L"Сборка установлена",
            project.name,
            result.hasWarnings
                ? L"Часть источников не была установлена"
                : L"FluxPack install plan выполнен",
            100);

        logger_.writeOperation(
            LogLevel::Info,
            "FluxPack",
            "FluxPack install completed. configPath=\"" + pathForLog(project.configPath) +
                "\", installedSources=" + std::to_string(result.installedSourceCount) +
                ", reusedSources=" + std::to_string(result.reusedSourceCount) +
                ", reusedDownloads=" + std::to_string(result.reusedDownloadCount) +
                ", pendingSources=" + std::to_string(result.pendingSourceCount) +
                ", failedSources=" + std::to_string(result.failedSourceCount) +
                ", appliedConfigs=" + std::to_string(result.appliedConfigCount) +
                ", reusedFiles=" + std::to_string(result.reusedFileCount) +
                ", materializedFiles=" + std::to_string(result.materializedFileCount) +
                ", profileOrderItems=" + std::to_string(result.appliedProfileOrderItemCount));
        installCleanup.dismiss();
        return result;
    }

    bool FluxPackService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
