#include "FluxoraCore/Services/ProjectService.hpp"

#include "FluxoraCore/GameSupport/GameDetectionService.hpp"
#include "FluxoraCore/GameSupport/GameHealthCheckService.hpp"
#include "FluxoraCore/GameSupport/GameSupportRegistry.hpp"
#include "FluxoraCore/GameSupport/ProjectFingerprint.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Services/TemplateService.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "FluxoraCore/Storage/ProjectStateTransaction.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cwctype>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <system_error>
#include <thread>
#include <utility>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view fallbackProjectFolderName = L"New Build";
        constexpr std::wstring_view fallbackProfileName = L"Default";
        constexpr std::wstring_view buildManifestsFolderName = L"Builds";
        constexpr std::wstring_view manifestFileExtension = L".json";
        constexpr std::wstring_view invalidFolderCharacters = L"<>:\"/\\|?*";

        struct ProjectConfigFileStamp
        {
            std::filesystem::file_time_type lastWriteTime{};
            std::uintmax_t fileSize{0};
        };

        struct ProjectConfigCatalogEntry
        {
            std::filesystem::path path;
            std::filesystem::file_time_type lastWriteTime{};
        };

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

        std::wstring trimFolderName(std::wstring value)
        {
            const auto first = value.find_first_not_of(L" .");
            if (first == std::wstring::npos)
            {
                return {};
            }

            const auto last = value.find_last_not_of(L" .");
            return value.substr(first, last - first + 1);
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

        bool isDirectory(const std::filesystem::path& path)
        {
            std::error_code error;
            return std::filesystem::exists(path, error) && std::filesystem::is_directory(path, error);
        }

        bool isRegularFile(const std::filesystem::path& path)
        {
            std::error_code error;
            return std::filesystem::exists(path, error) && std::filesystem::is_regular_file(path, error);
        }

        bool hasExecutableExtension(const std::filesystem::path& path)
        {
            return equalsIgnoreCase(path.extension().wstring(), L".exe");
        }

        std::wstring fileNameWithoutExtension(const std::filesystem::path& path)
        {
            const std::wstring stem = path.stem().wstring();
            return stem.empty() ? path.filename().wstring() : stem;
        }

        std::wstring sanitizeFolderName(std::wstring_view name)
        {
            std::wstring sanitized;
            sanitized.reserve(name.size());

            for (wchar_t character : name)
            {
                if (character < 32 || invalidFolderCharacters.find(character) != std::wstring_view::npos)
                {
                    sanitized.push_back(L'-');
                    continue;
                }

                sanitized.push_back(character);
            }

            sanitized = trimFolderName(std::move(sanitized));
            if (sanitized.empty())
            {
                return std::wstring(fallbackProjectFolderName);
            }

            return sanitized;
        }

        std::filesystem::path normalizeRootDirectory(const std::filesystem::path& root)
        {
            std::wstring rootText = root.wstring();
            if (rootText.size() == 2 && rootText[1] == L':')
            {
                rootText.push_back(L'\\');
            }

            return std::filesystem::absolute(std::filesystem::path(rootText));
        }

        std::filesystem::path resolveFluxoraDataDirectory()
        {
#ifdef _WIN32
            if (const std::wstring appData = readEnvironmentVariable(L"APPDATA"); !appData.empty())
            {
                return std::filesystem::path(appData) / L"Fluxora";
            }

            if (const std::wstring userProfile = readEnvironmentVariable(L"USERPROFILE"); !userProfile.empty())
            {
                return std::filesystem::path(userProfile) / L"AppData" / L"Roaming" / L"Fluxora";
            }
#else
            if (const char* xdgDataHome = std::getenv("XDG_DATA_HOME");
                xdgDataHome != nullptr && xdgDataHome[0] != '\0')
            {
                return std::filesystem::path(xdgDataHome) / "Fluxora";
            }

            if (const char* home = std::getenv("HOME"); home != nullptr && home[0] != '\0')
            {
                return std::filesystem::path(home) / ".local" / "share" / "Fluxora";
            }
#endif

            return std::filesystem::temp_directory_path() / L"Fluxora";
        }

        std::filesystem::path resolveBuildManifestDirectory()
        {
            return resolveFluxoraDataDirectory() / std::filesystem::path(buildManifestsFolderName);
        }

        std::filesystem::path buildManifestPath(std::wstring_view projectName)
        {
            const std::filesystem::path directory = resolveBuildManifestDirectory();
            const std::wstring fileStem = sanitizeFolderName(projectName);
            std::filesystem::path candidate =
                directory / std::filesystem::path(fileStem + std::wstring(manifestFileExtension));

            for (int index = 2; std::filesystem::exists(candidate); ++index)
            {
                candidate = directory / std::filesystem::path(
                    fileStem + L"-" + std::to_wstring(index) + std::wstring(manifestFileExtension));
            }

            return std::filesystem::absolute(candidate);
        }

        std::wstring normalizePathForComparison(const std::filesystem::path& path)
        {
            std::wstring text = std::filesystem::absolute(path).lexically_normal().wstring();
            while (text.size() > 1 && (text.back() == L'\\' || text.back() == L'/'))
            {
                text.pop_back();
            }

#ifdef _WIN32
            std::transform(text.begin(), text.end(), text.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
#endif

            return text;
        }

        bool isSamePath(
            const std::filesystem::path& left,
            const std::filesystem::path& right)
        {
            if (left.empty() || right.empty())
            {
                return false;
            }

            return normalizePathForComparison(left) == normalizePathForComparison(right);
        }

        std::filesystem::path buildManifestPath(
            std::wstring_view projectName,
            const std::filesystem::path& currentManifestPath)
        {
            const std::filesystem::path directory = resolveBuildManifestDirectory();
            const std::wstring fileStem = sanitizeFolderName(projectName);
            const std::filesystem::path current = std::filesystem::absolute(currentManifestPath);
            std::filesystem::path candidate =
                directory / std::filesystem::path(fileStem + std::wstring(manifestFileExtension));

            for (int index = 2;
                 std::filesystem::exists(candidate) && !isSamePath(candidate, current);
                 ++index)
            {
                candidate = directory / std::filesystem::path(
                    fileStem + L"-" + std::to_wstring(index) + std::wstring(manifestFileExtension));
            }

            return std::filesystem::absolute(candidate);
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
                throw std::invalid_argument("Build config is not valid UTF-8.");
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

        std::string readTextFile(const std::filesystem::path& path)
        {
            std::ifstream file(path, std::ios::in | std::ios::binary);
            if (!file)
            {
                throw std::invalid_argument("Build config could not be opened.");
            }

            return std::string(
                std::istreambuf_iterator<char>(file),
                std::istreambuf_iterator<char>());
        }

        void writeStateFile(
            const std::filesystem::path& path,
            const std::string& content,
            std::wstring stateName,
            ProjectStateValidation validation = ProjectStateValidation::Utf8Text)
        {
            AtomicFileStore().writeTextFile(
                path,
                content,
                AtomicFileWriteOptions{
                    std::move(stateName),
                    validation
                });
        }

        void recoverStateFile(
            const std::filesystem::path& path,
            std::wstring stateName,
            ProjectStateValidation validation,
            Logger& logger)
        {
            if (path.empty())
            {
                return;
            }

            static_cast<void>(AtomicFileStore().recoverFile(
                path,
                AtomicFileWriteOptions{
                    std::move(stateName),
                    validation
                },
                &logger));
        }

        bool hasExtensionIgnoreCase(const std::filesystem::path& path, std::wstring_view extension)
        {
            return equalsIgnoreCase(path.extension().wstring(), extension);
        }

        JsonValue parseJsonConfig(const std::string& content)
        {
            try
            {
                return JsonReader::parse(fromUtf8(content));
            }
            catch (const std::exception& exception)
            {
                throw std::invalid_argument(std::string("Build config is invalid: ") + exception.what());
            }
        }

        void writeJsonValue(JsonWriter& writer, const JsonValue& value)
        {
            switch (value.type())
            {
            case JsonValue::Type::Null:
                writer.nullValue();
                break;
            case JsonValue::Type::String:
                writer.value(value.asString());
                break;
            case JsonValue::Type::Number:
                writer.numberValue(value.asNumber());
                break;
            case JsonValue::Type::Boolean:
                writer.value(value.asBoolean());
                break;
            case JsonValue::Type::Object:
                writer.beginObject();
                for (const auto& [key, item] : value.asObject())
                {
                    writer.key(key);
                    writeJsonValue(writer, item);
                }
                writer.endObject();
                break;
            case JsonValue::Type::Array:
                writer.beginArray();
                for (const JsonValue& item : value.asArray())
                {
                    writeJsonValue(writer, item);
                }
                writer.endArray();
                break;
            }
        }

        std::string serializeJson(const JsonValue& value)
        {
            JsonWriter writer;
            writeJsonValue(writer, value);
            return toUtf8(writer.str());
        }

        const JsonValue& requireObject(const JsonValue& value)
        {
            if (!value.isObject())
            {
                throw std::invalid_argument("Build config root must be a JSON object.");
            }

            return value;
        }

        std::wstring readStringOrDefault(
            const JsonValue& object,
            std::wstring_view field,
            std::wstring_view fallback = L"")
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr || value->isNull())
            {
                return std::wstring(fallback);
            }

            if (!value->isString())
            {
                throw std::invalid_argument("Build config has a field with the wrong type.");
            }

            return value->asString();
        }

        std::wstring readRequiredString(const JsonValue& object, std::wstring_view field)
        {
            std::wstring value = readStringOrDefault(object, field);
            if (value.empty())
            {
                throw std::invalid_argument("Build config is missing a required field.");
            }

            return value;
        }

        std::wstring readStringOrDefaultLenient(
            const JsonValue& object,
            std::wstring_view field,
            std::wstring_view fallback = L"")
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr || value->isNull() || !value->isString())
            {
                return std::wstring(fallback);
            }

            return value->asString();
        }

        std::optional<std::vector<std::wstring>> readStringArrayField(
            const JsonValue& object,
            std::wstring_view field)
        {
            const JsonValue* value = object.find(field);
            if (value == nullptr || value->isNull())
            {
                return std::nullopt;
            }

            if (!value->isArray())
            {
                throw std::invalid_argument("Build config has an array field with the wrong type.");
            }

            std::vector<std::wstring> strings;
            for (const JsonValue& item : value->asArray())
            {
                if (!item.isString())
                {
                    throw std::invalid_argument("Build config array must contain strings.");
                }

                strings.push_back(item.asString());
            }

            return strings;
        }

        std::optional<std::vector<TemplateCapability>> readCapabilitiesField(const JsonValue& object)
        {
            const JsonValue* value = object.find(L"capabilities");
            if (value == nullptr || value->isNull())
            {
                return std::nullopt;
            }

            if (!value->isArray())
            {
                throw std::invalid_argument("Build config capabilities must be an array.");
            }

            std::vector<TemplateCapability> capabilities;
            for (const JsonValue& item : value->asArray())
            {
                if (!item.isObject())
                {
                    throw std::invalid_argument("Build config capability must be an object.");
                }

                capabilities.push_back(TemplateCapability{
                    readRequiredString(item, L"id"),
                    readRequiredString(item, L"displayName"),
                    readStringOrDefault(item, L"description")
                });
            }

            return capabilities;
        }

        std::optional<ScriptExtender> readScriptExtenderField(const JsonValue& object)
        {
            const JsonValue* value = object.find(L"scriptExtender");
            if (value == nullptr)
            {
                return std::nullopt;
            }

            if (value->isNull())
            {
                return ScriptExtender{};
            }

            if (!value->isObject())
            {
                throw std::invalid_argument("Build config script extender must be an object or null.");
            }

            return ScriptExtender{
                readRequiredString(*value, L"name"),
                readRequiredString(*value, L"loaderExecutable"),
                readStringOrDefault(*value, L"website")
            };
        }

        std::optional<ProjectFingerprint> readProjectFingerprintField(const JsonValue& object)
        {
            const JsonValue* value = object.find(L"projectFingerprint");
            if (value == nullptr || value->isNull())
            {
                return std::nullopt;
            }

            if (!value->isObject())
            {
                throw std::invalid_argument("Build config project fingerprint must be an object or null.");
            }

            ProjectFingerprint fingerprint;
            fingerprint.gameId = readStringOrDefault(*value, L"gameId");
            fingerprint.gameDisplayName = readStringOrDefault(*value, L"gameDisplayName");
            fingerprint.gameDefinitionVersion = readStringOrDefault(*value, L"gameDefinitionVersion");
            fingerprint.definitionBundleVersion = readStringOrDefault(*value, L"definitionBundleVersion");
            fingerprint.supportModuleVersion = readStringOrDefault(*value, L"supportModuleVersion");
            fingerprint.selectedInstallPath =
                std::filesystem::path(readStringOrDefault(*value, L"selectedInstallPath"));
            fingerprint.canonicalInstallPath =
                std::filesystem::path(readStringOrDefault(*value, L"canonicalInstallPath"));
            fingerprint.selectedExecutable =
                std::filesystem::path(readStringOrDefault(*value, L"selectedExecutable"));
            fingerprint.detectedStoreSource = readStringOrDefault(*value, L"detectedStoreSource");
            fingerprint.detectionSource = readStringOrDefault(*value, L"detectionSource");
            fingerprint.detectionConfidence = readStringOrDefault(*value, L"detectionConfidence");
            fingerprint.healthStatusAtCreation = readStringOrDefault(*value, L"healthStatusAtCreation");
            fingerprint.gameVersion = readStringOrDefault(*value, L"gameVersion");
            fingerprint.timestamp = readStringOrDefault(*value, L"timestamp");
            return fingerprint;
        }

        std::optional<ProjectFingerprint> readProjectFingerprintCompatibilityFields(
            const JsonValue& manifest)
        {
            const std::wstring gameId = readStringOrDefault(manifest, L"gameId");
            const std::wstring gameDisplayName = readStringOrDefault(manifest, L"gameDisplayName");
            if (gameId.empty() && gameDisplayName.empty())
            {
                return std::nullopt;
            }

            ProjectFingerprint fingerprint;
            fingerprint.gameId = gameId;
            fingerprint.gameDisplayName = gameDisplayName;
            fingerprint.selectedInstallPath =
                std::filesystem::path(readStringOrDefault(manifest, L"gamePath"));
            fingerprint.healthStatusAtCreation = L"unknown";
            return fingerprint;
        }

        std::filesystem::path resolveManifestPath(
            const std::wstring& text,
            const std::filesystem::path& relativeRoot)
        {
            if (text.empty())
            {
                return {};
            }

            std::filesystem::path path(text);
            if (path.is_relative())
            {
                path = relativeRoot / path;
            }

            return std::filesystem::absolute(path);
        }

        std::filesystem::path resolveInstallRootForProject(const ProjectDescriptor& project)
        {
            if (!project.installRootDirectory.empty())
            {
                return normalizeRootDirectory(project.installRootDirectory);
            }

            const std::filesystem::path parent = project.projectDirectory.parent_path();
            if (parent.empty())
            {
                throw std::invalid_argument("Project install root could not be resolved.");
            }

            return normalizeRootDirectory(parent);
        }

        bool isRootDirectory(const std::filesystem::path& directory)
        {
            const std::filesystem::path absoluteDirectory =
                std::filesystem::absolute(directory).lexically_normal();
            const std::filesystem::path root = absoluteDirectory.root_path();
            return !root.empty() && isSamePath(absoluteDirectory, root);
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

        void ensureSafeDeleteTarget(const ProjectDescriptor& project)
        {
            if (project.projectDirectory.empty())
            {
                throw std::invalid_argument("Project directory is required.");
            }

            const std::filesystem::path projectDirectory =
                std::filesystem::absolute(project.projectDirectory).lexically_normal();
            if (!std::filesystem::exists(projectDirectory) || !std::filesystem::is_directory(projectDirectory))
            {
                throw std::invalid_argument("Build project directory does not exist.");
            }

            if (isRootDirectory(projectDirectory))
            {
                throw std::invalid_argument("Refusing to delete a root directory.");
            }

            if (isSamePath(projectDirectory, resolveFluxoraDataDirectory()) ||
                isSamePath(projectDirectory, resolveBuildManifestDirectory()))
            {
                throw std::invalid_argument("Refusing to delete a Fluxora system directory.");
            }

            if (!project.installRootDirectory.empty() &&
                isSamePath(projectDirectory, project.installRootDirectory))
            {
                throw std::invalid_argument("Refusing to delete the install root directory.");
            }
        }

        struct DeletePlan
        {
            std::uintmax_t totalBytes{0};
            std::uintmax_t totalEntries{1};
            std::uintmax_t fileCount{0};
        };

        struct DeleteProgressState
        {
            std::atomic<std::uintmax_t> deletedBytes{0};
            std::atomic<std::uintmax_t> deletedEntries{0};
            std::mutex mutex;
            std::mutex callbackMutex;
            std::chrono::steady_clock::time_point lastReport{};
            std::uintmax_t lastReportedBytes{0};
            std::uintmax_t lastReportedEntries{0};
            int lastReportedPercent{0};
        };

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

        std::wstring relativeDisplayPath(
            const std::filesystem::path& root,
            const std::filesystem::path& path)
        {
            std::error_code error;
            const std::filesystem::path relative = std::filesystem::relative(path, root, error);
            if (!error && !relative.empty())
            {
                return relative.wstring();
            }

            return path.filename().empty() ? path.wstring() : path.filename().wstring();
        }

        int calculateDeletePercent(
            std::uintmax_t deletedBytes,
            std::uintmax_t totalBytes,
            std::uintmax_t deletedEntries,
            std::uintmax_t totalEntries)
        {
            if (totalBytes > 0)
            {
                return static_cast<int>(
                    std::min<std::uintmax_t>(99, (deletedBytes * 100) / totalBytes));
            }

            if (totalEntries > 0)
            {
                return static_cast<int>(
                    std::min<std::uintmax_t>(99, (deletedEntries * 100) / totalEntries));
            }

            return 0;
        }

        void publishDeleteProgress(
            const std::function<void(const ProjectDeleteProgress&)>& progress,
            std::wstring phase,
            std::wstring currentStep,
            std::wstring currentItem,
            int overallPercent,
            std::uintmax_t deletedBytes,
            std::uintmax_t totalBytes,
            std::uintmax_t deletedEntries,
            std::uintmax_t totalEntries)
        {
            if (!progress)
            {
                return;
            }

            progress(ProjectDeleteProgress{
                std::move(phase),
                std::move(currentStep),
                std::move(currentItem),
                std::clamp(overallPercent, 0, 100),
                deletedBytes,
                totalBytes,
                deletedEntries,
                totalEntries
            });
        }

        void logDeleteProgressCallbackFailure(
            Logger& logger,
            std::string_view reason) noexcept
        {
            try
            {
                const std::string message =
                    std::string("Project delete progress callback failed and was disabled. reason=\"") +
                    std::string(reason) +
                    "\"";
                logger.write(LogLevel::Warning, "ProjectDeletion", message);
                logger.writeOperation(LogLevel::Warning, "ProjectDeletion", message);
            }
            catch (...)
            {
            }
        }

        std::function<void(const ProjectDeleteProgress&)> makeSafeDeleteProgressCallback(
            const std::function<void(const ProjectDeleteProgress&)>& progress,
            Logger& logger)
        {
            if (!progress)
            {
                return {};
            }

            auto disabled = std::make_shared<std::atomic_bool>(false);
            return [&logger, progress, disabled](const ProjectDeleteProgress& update)
            {
                if (disabled->load(std::memory_order_relaxed))
                {
                    return;
                }

                try
                {
                    progress(update);
                }
                catch (const std::exception& exception)
                {
                    if (!disabled->exchange(true, std::memory_order_relaxed))
                    {
                        logDeleteProgressCallbackFailure(logger, exception.what());
                    }
                }
                catch (...)
                {
                    if (!disabled->exchange(true, std::memory_order_relaxed))
                    {
                        logDeleteProgressCallbackFailure(logger, "unknown exception");
                    }
                }
            };
        }

        std::uintmax_t regularFileSize(
            const std::filesystem::path& path,
            const std::filesystem::file_status& status)
        {
            if (!std::filesystem::is_regular_file(status))
            {
                return 0;
            }

            std::error_code error;
            const std::uintmax_t size = std::filesystem::file_size(path, error);
            return error ? 0 : size;
        }

        void clearReadOnlyAttribute(const std::filesystem::path& path);

        void publishScanProgress(
            const std::function<void(const ProjectDeleteProgress&)>& progress,
            const std::filesystem::path& root,
            const std::filesystem::path& path,
            std::uintmax_t scannedEntries,
            std::chrono::steady_clock::time_point& lastReport,
            bool force)
        {
            if (!progress)
            {
                return;
            }

            const auto now = std::chrono::steady_clock::now();
            if (!force && now - lastReport < std::chrono::milliseconds(250))
            {
                return;
            }

            lastReport = now;
            publishDeleteProgress(
                progress,
                L"scan",
                L"Считаю файлы сборки",
                relativeDisplayPath(root, path),
                0,
                0,
                0,
                scannedEntries,
                0);
        }

        DeletePlan collectDeletePlan(
            const std::filesystem::path& root,
            const std::function<void(const ProjectDeleteProgress&)>& progress)
        {
            publishDeleteProgress(
                progress,
                L"scan",
                L"Считаю файлы сборки",
                root.filename().wstring(),
                0,
                0,
                0,
                0,
                0);

            clearReadOnlyAttribute(root);

            DeletePlan plan;
            std::uintmax_t scannedEntries = 0;
            auto lastScanReport = std::chrono::steady_clock::now();
            std::error_code error;
            const std::filesystem::path nativeRoot = nativeDeletePath(root);
            std::filesystem::recursive_directory_iterator iterator(
                nativeRoot,
                std::filesystem::directory_options::skip_permission_denied,
                error);
            if (error)
            {
                throw std::runtime_error(
                    "Failed to scan build folder: " + error.message());
            }

            const std::filesystem::recursive_directory_iterator end;
            for (; iterator != end; iterator.increment(error))
            {
                if (error)
                {
                    throw std::runtime_error(
                        "Failed to scan build folder: " + error.message());
                }

                const std::filesystem::path nativePath = iterator->path();
                const std::filesystem::file_status status = iterator->symlink_status(error);
                if (error)
                {
                    throw std::runtime_error(
                        "Failed to inspect build item: " + error.message());
                }

                const bool isDirectory = std::filesystem::is_directory(status) &&
                    !std::filesystem::is_symlink(status);
                const std::uintmax_t bytes = regularFileSize(nativePath, status);
                ++plan.totalEntries;
                ++scannedEntries;

                const std::filesystem::path relative = std::filesystem::relative(nativePath, nativeRoot, error);
                if (error)
                {
                    throw std::runtime_error(
                        "Failed to resolve build item: " + error.message());
                }

                const std::filesystem::path path = root / relative;
                if (!isDirectory)
                {
                    plan.totalBytes += bytes;
                    ++plan.fileCount;
                }

                publishScanProgress(
                    progress,
                    root,
                    path,
                    scannedEntries,
                    lastScanReport,
                    false);
            }

            publishScanProgress(
                progress,
                root,
                root,
                scannedEntries,
                lastScanReport,
                true);
            return plan;
        }

        void clearReadOnlyAttribute(const std::filesystem::path& path)
        {
#ifdef _WIN32
            const std::filesystem::path nativePath = nativeDeletePath(path);
            const DWORD attributes = GetFileAttributesW(nativePath.c_str());
            if (attributes == INVALID_FILE_ATTRIBUTES ||
                (attributes & FILE_ATTRIBUTE_READONLY) == 0)
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
                clearReadOnlyAttribute(path);
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

        void publishDeleteStateProgress(
            DeleteProgressState& state,
            const std::function<void(const ProjectDeleteProgress&)>& progress,
            const std::filesystem::path& root,
            const std::filesystem::path& currentItem,
            std::uintmax_t totalBytes,
            std::uintmax_t totalEntries,
            std::wstring_view currentStep,
            bool force)
        {
            if (!progress)
            {
                return;
            }

            const auto now = std::chrono::steady_clock::now();
            constexpr std::uintmax_t minByteInterval = 32ull * 1024ull * 1024ull;
            constexpr std::uintmax_t minEntryInterval = 128;

            ProjectDeleteProgress update;
            std::unique_lock<std::mutex> callbackLock;
            {
                std::lock_guard lock(state.mutex);
                const std::uintmax_t deletedBytes = state.deletedBytes.load(std::memory_order_relaxed);
                const std::uintmax_t deletedEntries = state.deletedEntries.load(std::memory_order_relaxed);
                const std::uintmax_t byteDelta = deletedBytes >= state.lastReportedBytes
                    ? deletedBytes - state.lastReportedBytes
                    : 0;
                const std::uintmax_t entryDelta = deletedEntries >= state.lastReportedEntries
                    ? deletedEntries - state.lastReportedEntries
                    : 0;
                const bool enoughBytes = byteDelta >= minByteInterval;
                const bool enoughEntries = entryDelta >= minEntryInterval;
                if (!force &&
                    !enoughBytes &&
                    !enoughEntries &&
                    now - state.lastReport < std::chrono::milliseconds(150))
                {
                    return;
                }

                const int calculatedPercent =
                    calculateDeletePercent(deletedBytes, totalBytes, deletedEntries, totalEntries);
                const int progressPercent = (std::max)(
                    state.lastReportedPercent,
                    (std::max)(1, calculatedPercent));
                state.lastReportedBytes = deletedBytes;
                state.lastReportedEntries = deletedEntries;
                state.lastReportedPercent = progressPercent;
                state.lastReport = now;
                callbackLock = std::unique_lock<std::mutex>(state.callbackMutex);
                update = ProjectDeleteProgress{
                    L"delete",
                    std::wstring(currentStep),
                    relativeDisplayPath(root, currentItem),
                    progressPercent,
                    deletedBytes,
                    totalBytes,
                    deletedEntries,
                    totalEntries
                };
            }

            progress(update);
        }

        void recordDeletedEntry(
            DeleteProgressState& state,
            const std::function<void(const ProjectDeleteProgress&)>& progress,
            const std::filesystem::path& root,
            const std::filesystem::path& currentItem,
            std::uintmax_t bytes,
            std::uintmax_t totalBytes,
            std::uintmax_t totalEntries,
            std::wstring_view currentStep,
            bool force = false)
        {
            if (bytes > 0)
            {
                state.deletedBytes.fetch_add(bytes, std::memory_order_relaxed);
            }
            state.deletedEntries.fetch_add(1, std::memory_order_relaxed);
            publishDeleteStateProgress(
                state,
                progress,
                root,
                currentItem,
                totalBytes,
                totalEntries,
                currentStep,
                force);
        }

        void deleteFilesFromPlan(
            const DeletePlan& plan,
            DeleteProgressState& state,
            const std::function<void(const ProjectDeleteProgress&)>& progress,
            const std::filesystem::path& root,
            std::uintmax_t totalBytes,
            std::uintmax_t totalEntries)
        {
            if (plan.fileCount == 0)
            {
                return;
            }

            std::error_code error;
            const std::filesystem::path nativeRoot = nativeDeletePath(root);
            std::filesystem::recursive_directory_iterator iterator(
                nativeRoot,
                std::filesystem::directory_options::skip_permission_denied,
                error);
            if (error)
            {
                throw std::runtime_error(
                    "Failed to scan build folder for deletion: " + error.message());
            }

            const std::filesystem::recursive_directory_iterator end;
            for (; iterator != end; iterator.increment(error))
            {
                if (error)
                {
                    throw std::runtime_error(
                        "Failed to scan build folder for deletion: " + error.message());
                }

                const std::filesystem::path nativePath = iterator->path();
                const std::filesystem::file_status status = iterator->symlink_status(error);
                if (error)
                {
                    throw std::runtime_error(
                        "Failed to inspect build item for deletion: " + error.message());
                }

                const bool isDirectory = std::filesystem::is_directory(status) &&
                    !std::filesystem::is_symlink(status);
                if (isDirectory)
                {
                    continue;
                }

                const std::uintmax_t bytes = regularFileSize(nativePath, status);
                const std::filesystem::path relative = std::filesystem::relative(nativePath, nativeRoot, error);
                if (error)
                {
                    throw std::runtime_error(
                        "Failed to resolve build item for deletion: " + error.message());
                }

                const std::filesystem::path path = root / relative;
                removePathWithRetry(path);
                recordDeletedEntry(
                    state,
                    progress,
                    root,
                    path,
                    bytes,
                    totalBytes,
                    totalEntries,
                    L"Удаляю файлы сборки");
            }
        }

        void recordDeletedEntries(
            DeleteProgressState& state,
            const std::function<void(const ProjectDeleteProgress&)>& progress,
            const std::filesystem::path& root,
            const std::filesystem::path& currentItem,
            std::uintmax_t count,
            std::uintmax_t totalBytes,
            std::uintmax_t totalEntries,
            std::wstring_view currentStep)
        {
            if (count > 0)
            {
                state.deletedEntries.fetch_add(count, std::memory_order_relaxed);
            }

            publishDeleteStateProgress(
                state,
                progress,
                root,
                currentItem,
                totalBytes,
                totalEntries,
                currentStep,
                true);
        }

        void removeRemainingDirectoryTree(
            DeleteProgressState& state,
            const std::function<void(const ProjectDeleteProgress&)>& progress,
            const std::filesystem::path& root,
            std::uintmax_t totalBytes,
            std::uintmax_t totalEntries)
        {
            publishDeleteStateProgress(
                state,
                progress,
                root,
                root,
                totalBytes,
                totalEntries,
                L"Удаляю папки сборки",
                true);

            clearReadOnlyAttribute(root);
            std::error_code error;
            const std::uintmax_t removedEntries =
                std::filesystem::remove_all(nativeDeletePath(root), error);
            if (error)
            {
                throw std::runtime_error(
                    "Failed to delete build folder tree \"" +
                    toUtf8(root.wstring()) +
                    "\": " +
                    error.message());
            }

            recordDeletedEntries(
                state,
                progress,
                root,
                root,
                removedEntries,
                totalBytes,
                totalEntries,
                L"Завершаю удаление");
        }

        ProjectDescriptor readProjectDeleteDescriptor(
            const std::filesystem::path& configPath,
            Logger& logger)
        {
            const auto absoluteConfigPath = std::filesystem::absolute(configPath);
            if (!std::filesystem::exists(absoluteConfigPath) ||
                !std::filesystem::is_regular_file(absoluteConfigPath))
            {
                throw std::invalid_argument("Build config file does not exist.");
            }

            recoverStateFile(
                absoluteConfigPath,
                L"project manifest",
                ProjectStateValidation::JsonObject,
                logger);
            const JsonValue manifest = parseJsonConfig(readTextFile(absoluteConfigPath));
            requireObject(manifest);

            const std::filesystem::path manifestDirectory = absoluteConfigPath.parent_path();
            const std::wstring explicitProjectDirectory =
                readStringOrDefaultLenient(manifest, L"projectDirectory");
            std::filesystem::path projectDirectory;
            if (!explicitProjectDirectory.empty())
            {
                projectDirectory = resolveManifestPath(explicitProjectDirectory, manifestDirectory);
            }
            else if (!isSameOrInsidePath(absoluteConfigPath, resolveBuildManifestDirectory()))
            {
                projectDirectory = manifestDirectory;
            }

            const std::wstring installRootText = readStringOrDefaultLenient(
                manifest,
                L"installRoot",
                readStringOrDefaultLenient(manifest, L"installRootDirectory"));
            std::filesystem::path installRoot;
            if (!installRootText.empty())
            {
                installRoot = resolveManifestPath(
                    installRootText,
                    projectDirectory.empty() ? manifestDirectory : projectDirectory);
            }
            else if (!projectDirectory.empty())
            {
                installRoot = projectDirectory.parent_path();
            }

            const std::filesystem::path relativeRoot =
                projectDirectory.empty() ? manifestDirectory : projectDirectory;
            std::wstring name = readStringOrDefaultLenient(manifest, L"name");
            if (name.empty())
            {
                name = fileNameWithoutExtension(absoluteConfigPath);
            }

            return ProjectDescriptor{
                std::move(name),
                readStringOrDefaultLenient(
                    manifest,
                    L"templateId",
                    readStringOrDefaultLenient(manifest, L"gameId")),
                readStringOrDefaultLenient(
                    manifest,
                    L"gameName",
                    readStringOrDefaultLenient(manifest, L"gameDisplayName")),
                resolveManifestPath(readStringOrDefaultLenient(manifest, L"gamePath"), relativeRoot),
                installRoot,
                projectDirectory,
                resolveManifestPath(
                    readStringOrDefaultLenient(manifest, L"configPath", absoluteConfigPath.wstring()),
                    manifestDirectory),
                std::nullopt
            };
        }

        bool shouldDeleteProjectDirectory(const ProjectDescriptor& project, Logger& logger)
        {
            if (project.projectDirectory.empty())
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "ProjectDeletion",
                    "Project delete manifest has no projectDirectory. Removing catalog metadata only.");
                return false;
            }

            const std::filesystem::path projectDirectory =
                std::filesystem::absolute(project.projectDirectory).lexically_normal();
            std::error_code statusError;
            if (!std::filesystem::exists(projectDirectory, statusError))
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "ProjectDeletion",
                    std::string("Project delete target is already missing. Removing catalog metadata only. projectDirectory=\"") +
                        toUtf8(projectDirectory.wstring()) + "\"");
                return false;
            }

            if (!std::filesystem::is_directory(projectDirectory, statusError))
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "ProjectDeletion",
                    std::string("Project delete target is not a directory. Removing catalog metadata only. projectDirectory=\"") +
                        toUtf8(projectDirectory.wstring()) + "\"");
                return false;
            }

            ensureSafeDeleteTarget(project);
            return true;
        }

        std::vector<std::filesystem::path> collectConfigTargetsForDelete(
            const std::filesystem::path& requestedConfigPath,
            const ProjectDescriptor& project,
            bool deletingProjectDirectory)
        {
            std::vector<std::filesystem::path> targets;
            const auto addTarget = [&targets, &project, deletingProjectDirectory](const std::filesystem::path& path)
            {
                if (path.empty() ||
                    !std::filesystem::exists(path) ||
                    !std::filesystem::is_regular_file(path))
                {
                    return;
                }

                const std::filesystem::path absolutePath = std::filesystem::absolute(path);
                if (deletingProjectDirectory &&
                    isSameOrInsidePath(absolutePath, project.projectDirectory))
                {
                    return;
                }

                const auto duplicate = std::find_if(
                    targets.begin(),
                    targets.end(),
                    [&absolutePath](const std::filesystem::path& candidate)
                    {
                        return isSamePath(candidate, absolutePath);
                    });
                if (duplicate == targets.end())
                {
                    targets.push_back(absolutePath);
                }
            };

            addTarget(project.configPath);
            addTarget(requestedConfigPath);
            return targets;
        }

        std::string buildUpdatedManifest(
            const JsonValue& manifest,
            const ProjectDescriptor& project)
        {
            JsonValue::Object object = manifest.asObject();
            object.insert_or_assign(L"name", JsonValue::string(project.name));
            object.insert_or_assign(L"installRoot", JsonValue::string(project.installRootDirectory.wstring()));
            object.insert_or_assign(L"installRootDirectory", JsonValue::string(project.installRootDirectory.wstring()));
            object.insert_or_assign(L"projectDirectory", JsonValue::string(project.projectDirectory.wstring()));
            object.insert_or_assign(L"configPath", JsonValue::string(project.configPath.wstring()));
            return serializeJson(JsonValue::object(std::move(object)));
        }

        void applyStringField(
            const JsonValue& object,
            std::wstring_view field,
            std::wstring& target)
        {
            const JsonValue* value = object.find(field);
            if (value != nullptr && !value->isNull())
            {
                target = readStringOrDefault(object, field);
            }
        }

        void applyStringArrayField(
            const JsonValue& object,
            std::wstring_view field,
            std::vector<std::wstring>& target)
        {
            if (std::optional<std::vector<std::wstring>> value = readStringArrayField(object, field))
            {
                target = std::move(value.value());
            }
        }

        BuildTemplate buildTemplateFromManifest(
            const JsonValue& manifest,
            const TemplateService& templates,
            std::wstring templateId)
        {
            if (templateId.empty())
            {
                throw std::invalid_argument("Build config does not declare a supported game id.");
            }

            BuildTemplate resolved{};
            try
            {
                resolved = templates.resolve(templateId);
            }
            catch (const std::invalid_argument&)
            {
                resolved.id = templateId;
                resolved.displayName = templateId;
                resolved.defaultProfileName = std::wstring(fallbackProfileName);
            }

            resolved.id = templateId;
            applyStringField(manifest, L"baseTemplateId", resolved.baseTemplateId);
            applyStringField(manifest, L"gameName", resolved.gameName);
            applyStringField(manifest, L"dataDirectory", resolved.dataDirectory);
            applyStringField(manifest, L"nexusDomain", resolved.nexusDomain);
            applyStringField(manifest, L"defaultProfile", resolved.defaultProfileName);
            applyStringArrayField(manifest, L"folders", resolved.folders);
            applyStringArrayField(manifest, L"profileFiles", resolved.profileFiles);
            applyStringArrayField(manifest, L"basePlugins", resolved.basePlugins);
            applyStringArrayField(manifest, L"pluginExtensions", resolved.pluginExtensions);
            applyStringArrayField(manifest, L"executables", resolved.executables);

            if (std::optional<std::vector<TemplateCapability>> capabilities = readCapabilitiesField(manifest))
            {
                resolved.capabilities = std::move(capabilities.value());
            }

            if (std::optional<ScriptExtender> scriptExtender = readScriptExtenderField(manifest))
            {
                const ScriptExtender& value = scriptExtender.value();
                if (value.name.empty() && value.loaderExecutable.empty())
                {
                    resolved.scriptExtender = std::nullopt;
                }
                else
                {
                    resolved.scriptExtender = value;
                }
            }

            if (resolved.gameName.empty())
            {
                resolved.gameName = resolved.displayName;
            }
            if (resolved.displayName.empty() || resolved.displayName == templateId)
            {
                resolved.displayName = resolved.gameName.empty() ? templateId : resolved.gameName;
            }

            return resolved;
        }

        BuildTemplate lightBuildTemplateFromManifest(
            const JsonValue& manifest,
            std::wstring templateId)
        {
            if (templateId.empty())
            {
                throw std::invalid_argument("Build config does not declare a supported game id.");
            }

            BuildTemplate resolved{};
            resolved.id = std::move(templateId);
            resolved.displayName = resolved.id;
            resolved.defaultProfileName = std::wstring(fallbackProfileName);

            applyStringField(manifest, L"baseTemplateId", resolved.baseTemplateId);
            applyStringField(manifest, L"gameName", resolved.gameName);
            applyStringField(manifest, L"dataDirectory", resolved.dataDirectory);
            applyStringField(manifest, L"nexusDomain", resolved.nexusDomain);
            applyStringField(manifest, L"defaultProfile", resolved.defaultProfileName);
            applyStringArrayField(manifest, L"folders", resolved.folders);
            applyStringArrayField(manifest, L"profileFiles", resolved.profileFiles);
            applyStringArrayField(manifest, L"basePlugins", resolved.basePlugins);
            applyStringArrayField(manifest, L"pluginExtensions", resolved.pluginExtensions);
            applyStringArrayField(manifest, L"executables", resolved.executables);

            if (std::optional<std::vector<TemplateCapability>> capabilities = readCapabilitiesField(manifest))
            {
                resolved.capabilities = std::move(capabilities.value());
            }

            if (std::optional<ScriptExtender> scriptExtender = readScriptExtenderField(manifest))
            {
                const ScriptExtender& value = scriptExtender.value();
                if (value.name.empty() && value.loaderExecutable.empty())
                {
                    resolved.scriptExtender = std::nullopt;
                }
                else
                {
                    resolved.scriptExtender = value;
                }
            }

            const std::wstring gameDisplayName = readStringOrDefault(manifest, L"gameDisplayName");
            if (resolved.gameName.empty())
            {
                resolved.gameName = gameDisplayName.empty() ? resolved.displayName : gameDisplayName;
            }
            if (resolved.displayName.empty() || resolved.displayName == resolved.id)
            {
                resolved.displayName = resolved.gameName.empty() ? resolved.id : resolved.gameName;
            }

            return resolved;
        }

        std::wstring resolveTemplateIdForCatalogSummary(
            const JsonValue& manifest,
            const TemplateService& templates,
            const std::optional<ProjectFingerprint>& fingerprint)
        {
            if (std::wstring templateId = readStringOrDefault(manifest, L"templateId"); !templateId.empty())
            {
                return templateId;
            }
            if (std::wstring gameId = readStringOrDefault(manifest, L"gameId"); !gameId.empty())
            {
                return gameId;
            }
            if (fingerprint.has_value() && !fingerprint->gameId.empty())
            {
                return fingerprint->gameId;
            }

            const std::wstring gameName = readStringOrDefault(
                manifest,
                L"gameName",
                readStringOrDefault(manifest, L"gameDisplayName"));
            if (!gameName.empty())
            {
                for (const BuildTemplate& candidate : templates.gameTemplates())
                {
                    if (equalsIgnoreCase(candidate.gameName, gameName) ||
                        equalsIgnoreCase(candidate.displayName, gameName))
                    {
                        return candidate.id;
                    }
                }
            }

            throw std::invalid_argument("Build config does not declare a supported game id.");
        }

        std::optional<ProjectConfigFileStamp> readProjectConfigFileStamp(
            const std::filesystem::path& configPath)
        {
            std::error_code error;
            if (!std::filesystem::is_regular_file(configPath, error) || error)
            {
                return std::nullopt;
            }

            const auto lastWriteTime = std::filesystem::last_write_time(configPath, error);
            if (error)
            {
                return std::nullopt;
            }

            const std::uintmax_t fileSize = std::filesystem::file_size(configPath, error);
            if (error)
            {
                return std::nullopt;
            }

            return ProjectConfigFileStamp{
                lastWriteTime,
                fileSize
            };
        }

        bool projectDirectoryExists(const ProjectOpenResult& summary)
        {
            return !summary.project.projectDirectory.empty() &&
                isDirectory(summary.project.projectDirectory);
        }

        void removeCatalogManifestFile(
            const std::filesystem::path& configPath,
            Logger& logger,
            std::string_view reason) noexcept
        {
            try
            {
                if (configPath.empty())
                {
                    return;
                }

                std::error_code statusError;
                if (!std::filesystem::is_regular_file(configPath, statusError) || statusError)
                {
                    return;
                }

                std::error_code removeError;
                const bool removed = std::filesystem::remove(configPath, removeError);
                if (removeError)
                {
                    logger.writeOperation(
                        LogLevel::Warning,
                        "ProjectDiagnostics",
                        std::string("projectCatalog could not remove stale manifest reason=\"") +
                            std::string(reason) +
                            "\", configPath=\"" +
                            toUtf8(configPath.wstring()) +
                            "\", error=\"" +
                            removeError.message() +
                            "\".");
                    return;
                }

                if (removed)
                {
                    logger.writeOperation(
                        LogLevel::Info,
                        "ProjectDiagnostics",
                        std::string("projectCatalog removed stale manifest reason=\"") +
                            std::string(reason) +
                            "\", configPath=\"" +
                            toUtf8(configPath.wstring()) +
                            "\".");
                }
            }
            catch (...)
            {
            }
        }

        std::optional<std::filesystem::path> defaultGameExecutablePath(
            const BuildTemplate& resolved,
            const std::filesystem::path& gameDirectory)
        {
            std::vector<std::wstring> seen;
            for (const std::wstring& candidateName : resolved.executables)
            {
                const std::wstring key = toLower(candidateName);
                if (std::find(seen.begin(), seen.end(), key) != seen.end())
                {
                    continue;
                }
                seen.push_back(key);

                const std::filesystem::path candidate = gameDirectory / std::filesystem::path(candidateName);
                if (isRegularFile(candidate))
                {
                    return std::filesystem::path(candidateName);
                }
            }

            return std::nullopt;
        }

        void writeDefaultLaunchExecutable(
            JsonWriter& writer,
            const BuildTemplate& resolved,
            const std::filesystem::path& gameDirectory)
        {
            const std::optional<std::filesystem::path> executablePath =
                defaultGameExecutablePath(resolved, gameDirectory);
            if (!executablePath.has_value())
            {
                return;
            }

            std::wstring displayName = fileNameWithoutExtension(executablePath.value());
            if (!resolved.gameName.empty())
            {
                displayName = resolved.gameName;
            }
            else if (!resolved.displayName.empty())
            {
                displayName = resolved.displayName;
            }

            writer.key(L"launchExecutables").beginArray();
            writer.beginObject();
            writer.field(L"id", L"game");
            writer.field(L"displayName", displayName);
            writer.field(L"executablePath", executablePath->wstring());
            writer.field(L"arguments", L"");
            writer.field(L"workingDirectory", L"");
            writer.endObject();
            writer.endArray();
        }

        std::string healthFailureMessage(const GameHealthCheckResult& health)
        {
            std::wstring message = health.summary.empty()
                ? L"Game health check failed."
                : health.summary;
            for (const GameHealthFinding& finding : health.findings)
            {
                if (finding.severity == HealthSeverity::Blocker || finding.critical)
                {
                    message += L" ";
                    message += finding.message;
                    break;
                }
            }

            return toUtf8(message);
        }

        [[nodiscard]] std::string joinForLog(const std::vector<std::wstring>& values)
        {
            std::string joined;
            for (const std::wstring& value : values)
            {
                if (!joined.empty())
                {
                    joined += "|";
                }
                joined += toUtf8(value);
            }

            return joined.empty() ? std::string("<none>") : joined;
        }

        void logDetectionDiagnostics(
            Logger& logger,
            std::string_view operation,
            const GameDetectionResult& detection)
        {
            logger.writeOperation(
                detection.detected ? LogLevel::Info : LogLevel::Warning,
                "GameDetection",
                std::string(operation) +
                    " selectedGameId=\"" + toUtf8(detection.gameId.value()) + "\"" +
                    ", definitionVersion=\"" +
                    toUtf8(detection.definition == nullptr ? std::wstring() : detection.definition->definitionVersion) + "\"" +
                    ", detectionSource=\"" + toUtf8(GameDetectionService::detectionSourceName(detection.source)) + "\"" +
                    ", detectionConfidence=\"" +
                    toUtf8(GameDetectionService::detectionConfidenceName(detection.confidence)) + "\"" +
                    ", matchedHints=\"" + joinForLog(detection.matchedFiles) + "\"" +
                    ", missingFiles=\"" + joinForLog(detection.missingFiles) + "\"" +
                    ", warnings=\"" + joinForLog(detection.warnings) + "\"" +
                    ", ambiguousCandidates=" + std::to_string(detection.ambiguousCandidates.size()) + ".");
        }

        void logHealthDiagnostics(
            Logger& logger,
            std::string_view operation,
            const GameHealthCheckResult& health)
        {
            std::string findings;
            for (const GameHealthFinding& finding : health.findings)
            {
                if (!findings.empty())
                {
                    findings += "|";
                }
                findings += toUtf8(finding.code) + ":" +
                    toUtf8(GameHealthCheckService::healthSeverityName(finding.severity));
            }
            if (findings.empty())
            {
                findings = "<none>";
            }

            logger.writeOperation(
                health.allowsAutomation() ? LogLevel::Info : LogLevel::Warning,
                "GameHealth",
                std::string(operation) +
                    " selectedGameId=\"" + toUtf8(health.gameId.value()) + "\"" +
                    ", healthResult=\"" + toUtf8(GameHealthCheckService::healthStatusName(health.status)) + "\"" +
                    ", missingFiles=\"" + joinForLog(health.missingFiles) + "\"" +
                    ", matchedFiles=\"" + joinForLog(health.matchedFiles) + "\"" +
                    ", versionResult=\"unavailable\"" +
                    ", findings=\"" + findings + "\"" +
                    ", summary=\"" + toUtf8(health.summary) + "\".");
        }

        void logProjectFingerprintDiagnostics(
            Logger& logger,
            std::string_view operation,
            const ProjectFingerprint& fingerprint)
        {
            logger.writeOperation(
                LogLevel::Info,
                "ProjectDiagnostics",
                std::string(operation) +
                    " projectFingerprint gameId=\"" + toUtf8(fingerprint.gameId) + "\"" +
                    ", definitionVersion=\"" + toUtf8(fingerprint.gameDefinitionVersion) + "\"" +
                    ", detectionSource=\"" + toUtf8(fingerprint.detectionSource) + "\"" +
                    ", detectionConfidence=\"" + toUtf8(fingerprint.detectionConfidence) + "\"" +
                    ", healthResult=\"" + toUtf8(fingerprint.healthStatusAtCreation) + "\"" +
                    ", versionResult=\"" +
                    (fingerprint.gameVersion.empty() ? std::string("unavailable") : toUtf8(fingerprint.gameVersion)) + "\"" +
                    ", canonicalInstallPath=\"" + toUtf8(fingerprint.canonicalInstallPath.wstring()) + "\"" +
                    ", selectedExecutable=\"" + toUtf8(fingerprint.selectedExecutable.wstring()) + "\".");
        }

        void logOptionalProjectFingerprintDiagnostics(
            Logger& logger,
            std::string_view operation,
            const std::optional<ProjectFingerprint>& fingerprint)
        {
            if (fingerprint.has_value())
            {
                logProjectFingerprintDiagnostics(logger, operation, fingerprint.value());
            }
            else
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "ProjectDiagnostics",
                    std::string(operation) + " projectFingerprint=<missing>.");
            }
        }

        [[nodiscard]] bool confidenceAllowsLegacyTemplateMigration(DetectionConfidence confidence) noexcept
        {
            return confidence == DetectionConfidence::High ||
                confidence == DetectionConfidence::Explicit;
        }

        [[nodiscard]] GameDetectionRequest buildManifestDetectionRequest(
            const JsonValue& manifest,
            const std::filesystem::path& projectDirectory)
        {
            GameDetectionRequest request;
            std::filesystem::path gamePath =
                resolveManifestPath(readStringOrDefault(manifest, L"gamePath"), projectDirectory);
            if (isRegularFile(gamePath) && hasExecutableExtension(gamePath))
            {
                request.executablePaths.push_back(gamePath);
                gamePath = gamePath.parent_path();
            }
            request.installPath = gamePath;

            if (const std::wstring gameName = readStringOrDefault(manifest, L"gameName"); !gameName.empty())
            {
                request.nameHints.push_back(gameName);
            }
            if (const std::wstring name = readStringOrDefault(manifest, L"name"); !name.empty())
            {
                request.nameHints.push_back(name);
            }
            if (const std::wstring domain = readStringOrDefault(manifest, L"nexusDomain"); !domain.empty())
            {
                request.domainHints.push_back(domain);
            }

            return request;
        }

        [[nodiscard]] std::wstring resolveTemplateIdFromManifest(
            const JsonValue& manifest,
            const std::filesystem::path& manifestDirectory,
            Logger& logger)
        {
            if (const std::wstring templateId = readStringOrDefault(manifest, L"templateId"); !templateId.empty())
            {
                return templateId;
            }
            if (const std::wstring gameId = readStringOrDefault(manifest, L"gameId"); !gameId.empty())
            {
                return gameId;
            }

            std::filesystem::path projectDirectory = resolveManifestPath(
                readStringOrDefault(manifest, L"projectDirectory", manifestDirectory.wstring()),
                manifestDirectory);
            if (projectDirectory.empty())
            {
                projectDirectory = manifestDirectory;
            }

            GameDetectionRequest request = buildManifestDetectionRequest(manifest, projectDirectory);
            if (request.installPath.empty() && request.executablePaths.empty())
            {
                throw std::invalid_argument("Build config does not declare a supported game id.");
            }

            const GameSupportRegistry& registry = GameSupportRegistry::embedded();
            const GameDetectionResult detection = GameDetectionService(registry).detect(request);
            logDetectionDiagnostics(logger, "manifestMigration templateDetection", detection);
            if (!detection.detected ||
                !confidenceAllowsLegacyTemplateMigration(detection.confidence))
            {
                if (detection.source == DetectionSource::Ambiguous)
                {
                    throw std::invalid_argument(
                        "Build config game detection is ambiguous; choose a supported game before opening this project.");
                }

                throw std::invalid_argument("Build config does not declare a supported game id.");
            }

            return detection.gameId.value();
        }

        [[nodiscard]] std::string buildMigratedManifest(
            const JsonValue& manifest,
            std::wstring_view resolvedTemplateId,
            const ProjectFingerprint& fingerprint)
        {
            JsonWriter writer;
            writer.beginObject();
            for (const auto& [key, value] : manifest.asObject())
            {
                if (key == L"templateId" ||
                    key == L"gameId" ||
                    key == L"gameDisplayName" ||
                    key == L"projectFingerprint")
                {
                    continue;
                }

                writer.key(key);
                writeJsonValue(writer, value);
            }

            writer.field(L"templateId", resolvedTemplateId);
            writer.field(L"gameId", fingerprint.gameId);
            writer.field(L"gameDisplayName", fingerprint.gameDisplayName);
            writer.key(L"projectFingerprint");
            writeProjectFingerprint(writer, fingerprint);
            writer.endObject();
            return toUtf8(writer.str());
        }

        [[nodiscard]] std::optional<ProjectFingerprint> migrateManifestFingerprintIfSupported(
            const JsonValue& manifest,
            std::wstring_view resolvedTemplateId,
            const std::filesystem::path& absoluteConfigPath,
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& gamePath,
            Logger& logger)
        {
            const GameSupportRegistry& registry = GameSupportRegistry::embedded();
            const GameSupportLookupResult lookup = registry.lookupById(resolvedTemplateId);
            if (!lookup.supported || lookup.support == nullptr)
            {
                return std::nullopt;
            }

            const GameSupportComponents& components = lookup.support->components();
            if (components.manifestMigrationProvider == nullptr ||
                !components.manifestMigrationProvider->manifestMigrationRules().supportsAutomaticMigration)
            {
                return std::nullopt;
            }

            if (gamePath.empty())
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "ProjectDiagnostics",
                    "manifestMigration skipped selectedGameId=\"" + toUtf8(lookup.support->identity().id.value()) +
                        "\", reason=\"missing game path\".");
                return std::nullopt;
            }

            GameDetectionRequest detectionRequest = buildManifestDetectionRequest(manifest, projectDirectory);
            detectionRequest.manualGameId = lookup.support->identity().id;
            const GameDetectionResult detection = GameDetectionService(registry).detect(detectionRequest);
            logDetectionDiagnostics(logger, "manifestMigration detection", detection);
            if (!detection.detected)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "ProjectDiagnostics",
                    "manifestMigration skipped selectedGameId=\"" + toUtf8(lookup.support->identity().id.value()) +
                        "\", reason=\"game detection did not produce a supported result\".");
                return std::nullopt;
            }

            const GameHealthCheckResult health = GameHealthCheckService().check(detection);
            logHealthDiagnostics(logger, "manifestMigration healthCheck", health);
            std::optional<std::filesystem::path> selectedExecutable;
            if (!detection.selectedExecutable.empty())
            {
                selectedExecutable = detection.selectedExecutable;
            }

            ProjectFingerprint fingerprint = createProjectFingerprint(
                detection,
                health,
                detection.selectedInstallPath.empty() ? gamePath : detection.selectedInstallPath,
                selectedExecutable);
            logProjectFingerprintDiagnostics(logger, "manifestMigration", fingerprint);

            writeStateFile(
                absoluteConfigPath,
                buildMigratedManifest(manifest, resolvedTemplateId, fingerprint),
                L"project manifest",
                ProjectStateValidation::JsonObject);
            logger.writeOperation(
                LogLevel::Info,
                "ProjectDiagnostics",
                "manifestMigration completed selectedGameId=\"" + toUtf8(fingerprint.gameId) +
                    "\", definitionVersion=\"" + toUtf8(fingerprint.gameDefinitionVersion) +
                    "\", healthResult=\"" + toUtf8(fingerprint.healthStatusAtCreation) +
                    "\", configPath=\"" + toUtf8(absoluteConfigPath.wstring()) + "\".");
            return fingerprint;
        }

        void recoverProjectDirectoryState(
            const std::filesystem::path& projectDirectory,
            const BuildTemplate& resolved,
            Logger& logger)
        {
            if (projectDirectory.empty())
            {
                return;
            }

            AtomicFileStore store;
            static_cast<void>(ProjectStateTransaction::recoverDirectory(projectDirectory, store, &logger));

            const std::filesystem::path localSettingsDirectory = projectDirectory / L".fluxora";
            static_cast<void>(ProjectStateTransaction::recoverDirectory(localSettingsDirectory, store, &logger));
            recoverStateFile(
                localSettingsDirectory / L"paths.json",
                L"profile path settings",
                ProjectStateValidation::JsonObject,
                logger);

            const std::filesystem::path profilesRoot = projectDirectory / L"profiles";
            std::error_code error;
            if (std::filesystem::exists(profilesRoot, error) &&
                std::filesystem::is_directory(profilesRoot, error))
            {
                for (const auto& entry : std::filesystem::directory_iterator(
                         profilesRoot,
                         std::filesystem::directory_options::skip_permission_denied,
                         error))
                {
                    if (error)
                    {
                        break;
                    }
                    std::error_code statusError;
                    if (!entry.is_directory(statusError))
                    {
                        continue;
                    }

                    static_cast<void>(ProjectStateTransaction::recoverDirectory(entry.path(), store, &logger));
                    for (const std::wstring& profileFile : resolved.profileFiles)
                    {
                        recoverStateFile(
                            entry.path() / std::filesystem::path(profileFile),
                            L"profile state file",
                            ProjectStateValidation::Utf8Text,
                            logger);
                    }
                }
            }

            const std::filesystem::path modsRoot = projectDirectory / L"mods";
            if (std::filesystem::exists(modsRoot, error) &&
                std::filesystem::is_directory(modsRoot, error))
            {
                for (const auto& entry : std::filesystem::directory_iterator(
                         modsRoot,
                         std::filesystem::directory_options::skip_permission_denied,
                         error))
                {
                    if (error)
                    {
                        break;
                    }
                    std::error_code statusError;
                    if (!entry.is_directory(statusError))
                    {
                        continue;
                    }

                    recoverStateFile(
                        entry.path() / L".flow" / L"manifest.json",
                        L"generated mod metadata",
                        ProjectStateValidation::JsonObject,
                        logger);
                }
            }
        }

        void recoverBuildCatalogState(Logger& logger)
        {
            const std::filesystem::path catalogDirectory = resolveBuildManifestDirectory();
            AtomicFileStore store;
            static_cast<void>(ProjectStateTransaction::recoverDirectory(catalogDirectory, store, &logger));

            std::error_code error;
            if (!std::filesystem::exists(catalogDirectory, error) ||
                !std::filesystem::is_directory(catalogDirectory, error))
            {
                return;
            }

            for (const auto& entry : std::filesystem::directory_iterator(
                     catalogDirectory,
                     std::filesystem::directory_options::skip_permission_denied,
                     error))
            {
                if (error)
                {
                    break;
                }
                std::error_code statusError;
                if (!entry.is_regular_file(statusError) ||
                    !hasExtensionIgnoreCase(entry.path(), manifestFileExtension))
                {
                    continue;
                }

                try
                {
                    recoverStateFile(
                        entry.path(),
                        L"project manifest",
                        ProjectStateValidation::JsonObject,
                        logger);
                }
                catch (const std::exception& exception)
                {
                    logger.write(
                        LogLevel::Warning,
                        "ProjectStateRecovery",
                        std::string("Skipped project catalog manifest recovery for \"") +
                            toUtf8(entry.path().wstring()) + "\": " + exception.what());
                }
            }
        }

        void removeCreateRollbackPath(
            Logger& logger,
            const std::filesystem::path& path,
            std::string_view label,
            bool recursive)
        {
            if (path.empty())
            {
                return;
            }

            std::error_code existsError;
            if (!std::filesystem::exists(path, existsError))
            {
                return;
            }

            std::error_code removeError;
            if (recursive)
            {
                static_cast<void>(std::filesystem::remove_all(path, removeError));
            }
            else
            {
                static_cast<void>(std::filesystem::remove(path, removeError));
            }

            if (removeError)
            {
                logger.writeOperation(
                    LogLevel::Warning,
                    "ProjectDiagnostics",
                    std::string("createProject rollback could not remove ") +
                        std::string(label) +
                        " path=\"" +
                        toUtf8(path.wstring()) +
                        "\", reason=\"" +
                        removeError.message() +
                        "\".");
            }
        }
    }

    ProjectService::ProjectService(Logger& logger, const TemplateService& templates) noexcept
        : logger_(logger),
          templates_(templates)
    {
    }

    void ProjectService::initialize()
    {
        if (initialized_)
        {
            return;
        }

        recoverBuildCatalogState(logger_);
        initialized_ = true;
        logger_.write(LogLevel::Info, "Project service initialized.");
    }

    void ProjectService::shutdown()
    {
        if (!initialized_)
        {
            return;
        }

        projects_.clear();
        logger_.write(LogLevel::Info, "Project service shut down.");
        initialized_ = false;
    }

    std::filesystem::path ProjectService::buildProjectDirectory(
        const std::filesystem::path& installRootDirectory,
        std::wstring_view projectName) const
    {
        return normalizeRootDirectory(installRootDirectory) / sanitizeFolderName(projectName);
    }

    ProjectDescriptor ProjectService::createProject(const ProjectCreateRequest& request)
    {
        logger_.writeOperation(
            LogLevel::Info,
            "ProjectDiagnostics",
            "createProject requested projectName=\"" + toUtf8(request.name) +
                "\", templateId=\"" + toUtf8(request.templateId) +
                "\", selectedGamePath=\"" + toUtf8(request.gamePath.wstring()) +
                "\", installRoot=\"" + toUtf8(request.installRootDirectory.wstring()) + "\".");

        std::optional<std::filesystem::path> rollbackProjectDirectory;
        std::optional<std::filesystem::path> rollbackConfigPath;
        std::optional<std::filesystem::path> rollbackInstallRoot;

        try
        {
            if (request.name.empty())
            {
                throw std::invalid_argument("Project name is required.");
            }

            if (request.templateId.empty())
            {
                throw std::invalid_argument("Game template is required.");
            }

            // Resolve the build template (base + game overlay) up front; an unknown
            // template id throws std::invalid_argument and surfaces to the UI.
            const BuildTemplate resolved = templates_.resolve(request.templateId);

            if (request.gamePath.empty())
            {
                throw std::invalid_argument("Game directory is required.");
            }

            std::filesystem::path gameDirectory = std::filesystem::absolute(request.gamePath).lexically_normal();
            if (isRegularFile(gameDirectory) ||
                (!request.validateGameDirectory && hasExecutableExtension(gameDirectory)))
            {
                if (!hasExecutableExtension(gameDirectory))
                {
                    throw std::invalid_argument("Game executable path must point to an .exe file.");
                }

                gameDirectory = gameDirectory.parent_path();
            }

            std::optional<ProjectFingerprint> fingerprint;
            if (request.validateGameDirectory)
            {
                if (!isDirectory(gameDirectory))
                {
                    throw std::invalid_argument("Game directory does not exist.");
                }

                const GameSupportRegistry& registry = GameSupportRegistry::embedded();
                GameDetectionService detectionService(registry);
                GameDetectionRequest detectionRequest;
                detectionRequest.manualGameId = GameId::parseOrThrow(resolved.id);
                detectionRequest.installPath = gameDirectory;
                const GameDetectionResult detection = detectionService.detect(detectionRequest);
                logDetectionDiagnostics(logger_, "createProject detection", detection);
                if (!detection.detected)
                {
                    throw std::invalid_argument("Game could not be detected from the selected path.");
                }

                GameHealthCheckService healthService;
                const GameHealthCheckResult health = healthService.check(detection);
                logHealthDiagnostics(logger_, "createProject healthCheck", health);
                if (!health.allowsAutomation())
                {
                    throw std::invalid_argument(healthFailureMessage(health));
                }

                std::optional<std::filesystem::path> selectedExecutable;
                if (!detection.selectedExecutable.empty())
                {
                    selectedExecutable = detection.selectedExecutable;
                }
                fingerprint = createProjectFingerprint(
                    detection,
                    health,
                    gameDirectory,
                    selectedExecutable);
                logProjectFingerprintDiagnostics(logger_, "createProject", fingerprint.value());
            }
            else
            {
                logger_.writeOperation(
                    LogLevel::Info,
                    "ProjectDiagnostics",
                    "createProject deferred game directory validation selectedGamePath=\"" +
                        toUtf8(gameDirectory.wstring()) + "\".");
            }

            const auto normalizedRoot = normalizeRootDirectory(request.installRootDirectory);
            std::error_code rootExistsError;
            const bool rootExists = std::filesystem::exists(normalizedRoot, rootExistsError);
            if (rootExistsError)
            {
                throw std::invalid_argument(
                    std::string("Install root directory could not be inspected: ") +
                    rootExistsError.message());
            }

            if (rootExists)
            {
                std::error_code rootDirectoryError;
                if (!std::filesystem::is_directory(normalizedRoot, rootDirectoryError))
                {
                    throw std::invalid_argument("Install root directory is not a directory.");
                }
            }

            PathSafetyService().validateDirectoryWriteRoot(normalizedRoot)
                .throwIfUnsafe("Install root directory is unsafe");

            if (!rootExists)
            {
                std::error_code createRootError;
                const bool createdRoot = std::filesystem::create_directories(normalizedRoot, createRootError);
                if (createRootError)
                {
                    throw std::invalid_argument(
                        std::string("Install root directory could not be created: ") +
                        createRootError.message());
                }

                if (createdRoot)
                {
                    rollbackInstallRoot = normalizedRoot;
                    logger_.writeOperation(
                        LogLevel::Info,
                        "ProjectDiagnostics",
                        "createProject created missing install root path=\"" +
                            toUtf8(normalizedRoot.wstring()) + "\".");
                }
            }

            const auto projectDirectory = buildProjectDirectory(normalizedRoot, request.name);
            PathSafetyService().validateWritePath(normalizedRoot, projectDirectory)
                .throwIfUnsafe("Project directory is unsafe");
            const auto manifestPath = buildManifestPath(request.name);
            rollbackProjectDirectory = projectDirectory;
            rollbackConfigPath = manifestPath;

            std::error_code projectExistsError;
            const bool projectDirectoryExists = std::filesystem::exists(projectDirectory, projectExistsError);
            if (projectExistsError)
            {
                throw std::invalid_argument(
                    std::string("Project directory could not be inspected: ") +
                    projectExistsError.message());
            }
            if (projectDirectoryExists)
            {
                std::error_code projectDirectoryError;
                if (!std::filesystem::is_directory(projectDirectory, projectDirectoryError))
                {
                    throw std::invalid_argument("Project directory is not a directory.");
                }

                std::error_code cleanError;
                static_cast<void>(std::filesystem::remove_all(projectDirectory, cleanError));
                if (cleanError)
                {
                    throw std::invalid_argument(
                        std::string("Project directory could not be cleaned: ") +
                        cleanError.message());
                }
                logger_.writeOperation(
                    LogLevel::Info,
                    "ProjectDiagnostics",
                    "createProject cleaned existing project directory path=\"" +
                        toUtf8(projectDirectory.wstring()) + "\".");
            }

            materializeTemplate(projectDirectory, resolved);

            ProjectDescriptor project{
                request.name,
                resolved.id,
                resolved.gameName,
                gameDirectory,
                normalizedRoot,
                projectDirectory,
                manifestPath,
                std::move(fingerprint)
            };

            writeBuildManifest(project, resolved);
            InstanceMetadataStore::ensureInstance(project.projectDirectory, resolved.id);

            if (project.fingerprint.has_value())
            {
                logger_.writeOperation(
                    LogLevel::Info,
                    "ProjectDiagnostics",
                    "createProject completed selectedGameId=\"" + toUtf8(project.fingerprint->gameId) +
                        "\", definitionVersion=\"" + toUtf8(project.fingerprint->gameDefinitionVersion) +
                        "\", healthResult=\"" + toUtf8(project.fingerprint->healthStatusAtCreation) +
                        "\", projectDirectory=\"" + toUtf8(projectDirectory.wstring()) + "\".");
            }
            else
            {
                logger_.writeOperation(
                    LogLevel::Info,
                    "ProjectDiagnostics",
                    "createProject completed with deferred game validation projectDirectory=\"" +
                        toUtf8(projectDirectory.wstring()) + "\".");
            }
            logger_.write(LogLevel::Info, "Project structure created from template.");
            projects_.erase(
                std::remove_if(
                    projects_.begin(),
                    projects_.end(),
                    [&project](const ProjectDescriptor& candidate)
                    {
                        return isSamePath(candidate.configPath, project.configPath) ||
                            isSamePath(candidate.projectDirectory, project.projectDirectory);
                    }),
                projects_.end());
            projects_.push_back(project);
            return project;
        }
        catch (const std::exception& exception)
        {
            if (rollbackProjectDirectory.has_value())
            {
                removeCreateRollbackPath(
                    logger_,
                    rollbackProjectDirectory.value(),
                    "project directory",
                    true);
            }
            if (rollbackConfigPath.has_value())
            {
                removeCreateRollbackPath(
                    logger_,
                    rollbackConfigPath.value(),
                    "project manifest",
                    false);
            }
            if (rollbackInstallRoot.has_value())
            {
                removeCreateRollbackPath(
                    logger_,
                    rollbackInstallRoot.value(),
                    "auto-created install root",
                    true);
            }
            logger_.writeOperation(
                LogLevel::Error,
                "ProjectDiagnostics",
                "createProject blocked selectedGamePath=\"" + toUtf8(request.gamePath.wstring()) +
                    "\", templateId=\"" + toUtf8(request.templateId) +
                    "\", reason=\"" + exception.what() + "\".");
            throw;
        }
    }

    ProjectOpenResult ProjectService::readProjectConfigSummary(const std::filesystem::path& configPath) const
    {
        if (configPath.empty())
        {
            throw std::invalid_argument("Build config path is required.");
        }

        const auto absoluteConfigPath = std::filesystem::absolute(configPath);
        if (!std::filesystem::exists(absoluteConfigPath) || !std::filesystem::is_regular_file(absoluteConfigPath))
        {
            throw std::invalid_argument("Build config file does not exist.");
        }

        recoverStateFile(
            absoluteConfigPath,
            L"project manifest",
            ProjectStateValidation::JsonObject,
            logger_);
        const JsonValue manifest = parseJsonConfig(readTextFile(absoluteConfigPath));
        requireObject(manifest);
        const auto manifestDirectory = absoluteConfigPath.parent_path();
        std::filesystem::path projectDirectory = resolveManifestPath(
            readStringOrDefault(manifest, L"projectDirectory", manifestDirectory.wstring()),
            manifestDirectory);
        if (projectDirectory.empty())
        {
            projectDirectory = manifestDirectory;
        }

        if (!std::filesystem::exists(projectDirectory) || !std::filesystem::is_directory(projectDirectory))
        {
            throw std::invalid_argument("Build project directory does not exist.");
        }

        const std::wstring resolvedTemplateId =
            resolveTemplateIdFromManifest(manifest, manifestDirectory, logger_);
        BuildTemplate resolved = buildTemplateFromManifest(manifest, templates_, resolvedTemplateId);

        const std::wstring installRootText = readStringOrDefault(
            manifest,
            L"installRoot",
            readStringOrDefault(manifest, L"installRootDirectory"));
        const std::filesystem::path gamePath =
            resolveManifestPath(readStringOrDefault(manifest, L"gamePath"), projectDirectory);
        std::optional<ProjectFingerprint> fingerprint = readProjectFingerprintField(manifest);
        const bool manifestHadProjectFingerprint = fingerprint.has_value();
        if (!fingerprint.has_value())
        {
            fingerprint = readProjectFingerprintCompatibilityFields(manifest);
            if (fingerprint.has_value())
            {
                logger_.writeOperation(
                    LogLevel::Info,
                    "ProjectDiagnostics",
                    "manifestMigration compatibilityFingerprint hydrated configPath=\"" +
                        toUtf8(absoluteConfigPath.wstring()) +
                        "\", selectedGameId=\"" + toUtf8(fingerprint->gameId) +
                        "\", definitionVersion=\"" + toUtf8(fingerprint->gameDefinitionVersion) +
                        "\", detectionSource=\"" + toUtf8(fingerprint->detectionSource) +
                        "\", detectionConfidence=\"" + toUtf8(fingerprint->detectionConfidence) + "\".");
            }
        }
        if (!manifestHadProjectFingerprint)
        {
            if (std::optional<ProjectFingerprint> migrated = migrateManifestFingerprintIfSupported(
                    manifest,
                    resolvedTemplateId,
                    absoluteConfigPath,
                    projectDirectory,
                    gamePath,
                    logger_))
            {
                fingerprint = std::move(migrated);
            }
        }

        ProjectDescriptor project{
            readRequiredString(manifest, L"name"),
            resolved.id,
            resolved.gameName,
            gamePath,
            resolveManifestPath(installRootText, projectDirectory),
            projectDirectory,
            absoluteConfigPath,
            std::move(fingerprint)
        };

        return ProjectOpenResult{
            project,
            resolved
        };
    }

    ProjectOpenResult ProjectService::readProjectConfigSummaryLight(const std::filesystem::path& configPath) const
    {
        if (configPath.empty())
        {
            throw std::invalid_argument("Build config path is required.");
        }

        const auto absoluteConfigPath = std::filesystem::absolute(configPath);
        if (!std::filesystem::exists(absoluteConfigPath) || !std::filesystem::is_regular_file(absoluteConfigPath))
        {
            throw std::invalid_argument("Build config file does not exist.");
        }

        const JsonValue manifest = parseJsonConfig(readTextFile(absoluteConfigPath));
        requireObject(manifest);

        const auto manifestDirectory = absoluteConfigPath.parent_path();
        std::filesystem::path projectDirectory = resolveManifestPath(
            readStringOrDefault(manifest, L"projectDirectory", manifestDirectory.wstring()),
            manifestDirectory);
        if (projectDirectory.empty())
        {
            projectDirectory = manifestDirectory;
        }

        if (!std::filesystem::exists(projectDirectory) || !std::filesystem::is_directory(projectDirectory))
        {
            throw std::invalid_argument("Build project directory does not exist.");
        }

        std::optional<ProjectFingerprint> fingerprint = readProjectFingerprintField(manifest);
        if (!fingerprint.has_value())
        {
            fingerprint = readProjectFingerprintCompatibilityFields(manifest);
        }

        const std::wstring resolvedTemplateId =
            resolveTemplateIdForCatalogSummary(manifest, templates_, fingerprint);
        BuildTemplate resolved = lightBuildTemplateFromManifest(manifest, resolvedTemplateId);

        const std::wstring installRootText = readStringOrDefault(
            manifest,
            L"installRoot",
            readStringOrDefault(manifest, L"installRootDirectory"));

        ProjectDescriptor project{
            readRequiredString(manifest, L"name"),
            resolved.id,
            resolved.gameName,
            resolveManifestPath(readStringOrDefault(manifest, L"gamePath"), projectDirectory),
            resolveManifestPath(installRootText, projectDirectory),
            projectDirectory,
            absoluteConfigPath,
            std::move(fingerprint)
        };

        return ProjectOpenResult{
            project,
            resolved
        };
    }

    ProjectOpenResult ProjectService::readCachedProjectConfigSummary(const std::filesystem::path& configPath) const
    {
        const auto absoluteConfigPath = std::filesystem::absolute(configPath);
        const std::optional<ProjectConfigFileStamp> stamp = readProjectConfigFileStamp(absoluteConfigPath);
        if (!stamp.has_value())
        {
            throw std::invalid_argument("Build config file does not exist.");
        }

        const std::wstring cacheKey = normalizePathForComparison(absoluteConfigPath);
        {
            std::lock_guard lock(projectSummaryCacheMutex_);
            const auto cached = projectSummaryCache_.find(cacheKey);
            if (cached != projectSummaryCache_.end() &&
                cached->second.lastWriteTime == stamp->lastWriteTime &&
                cached->second.fileSize == stamp->fileSize)
            {
                if (!projectDirectoryExists(cached->second.summary))
                {
                    throw std::invalid_argument("Build project directory does not exist.");
                }

                return cached->second.summary;
            }
        }

        ProjectOpenResult summary = readProjectConfigSummaryLight(absoluteConfigPath);
        {
            std::lock_guard lock(projectSummaryCacheMutex_);
            projectSummaryCache_.insert_or_assign(
                cacheKey,
                ProjectSummaryCacheEntry{
                    stamp->lastWriteTime,
                    stamp->fileSize,
                    summary
                });
        }

        return summary;
    }

    void ProjectService::invalidateProjectSummaryCache(const std::filesystem::path& configPath) const
    {
        if (configPath.empty())
        {
            return;
        }

        const std::wstring cacheKey = normalizePathForComparison(configPath);
        std::lock_guard lock(projectSummaryCacheMutex_);
        projectSummaryCache_.erase(cacheKey);
    }

    std::vector<ProjectOpenResult> ProjectService::listProjectConfigSummaries(
        const std::filesystem::path& buildConfigsDirectory) const
    {
        std::vector<ProjectOpenResult> summaries;
        if (buildConfigsDirectory.empty())
        {
            return summaries;
        }

        std::error_code error;
        if (!std::filesystem::exists(buildConfigsDirectory, error) ||
            !std::filesystem::is_directory(buildConfigsDirectory, error))
        {
            return summaries;
        }

        const bool canPruneCatalogManifests =
            isSamePath(buildConfigsDirectory, resolveBuildManifestDirectory());
        std::vector<ProjectConfigCatalogEntry> entries;
        for (const auto& entry : std::filesystem::directory_iterator(
                 buildConfigsDirectory,
                 std::filesystem::directory_options::skip_permission_denied,
                 error))
        {
            if (error)
            {
                break;
            }

            std::error_code statusError;
            if (!entry.is_regular_file(statusError) ||
                entry.path().extension().wstring() != manifestFileExtension)
            {
                continue;
            }

            std::error_code timeError;
            const std::filesystem::file_time_type lastWriteTime = entry.last_write_time(timeError);
            entries.push_back(ProjectConfigCatalogEntry{
                entry.path(),
                timeError ? (std::filesystem::file_time_type::min)() : lastWriteTime
            });
        }

        std::sort(entries.begin(), entries.end(), [](const auto& left, const auto& right)
        {
            if (left.lastWriteTime != right.lastWriteTime)
            {
                return left.lastWriteTime > right.lastWriteTime;
            }

            return left.path.wstring() < right.path.wstring();
        });

        summaries.reserve(entries.size());
        std::vector<std::wstring> seenProjectDirectories;
        for (const auto& entry : entries)
        {
            try
            {
                ProjectOpenResult summary = readCachedProjectConfigSummary(entry.path);
                const std::wstring projectDirectoryKey =
                    normalizePathForComparison(summary.project.projectDirectory);
                if (canPruneCatalogManifests &&
                    std::find(
                        seenProjectDirectories.begin(),
                        seenProjectDirectories.end(),
                        projectDirectoryKey) != seenProjectDirectories.end())
                {
                    logger_.writeOperation(
                        LogLevel::Warning,
                        "ProjectDiagnostics",
                        "projectCatalog skipped duplicate manifest projectDirectory=\"" +
                            toUtf8(summary.project.projectDirectory.wstring()) +
                            "\", configPath=\"" +
                            toUtf8(summary.project.configPath.wstring()) +
                            "\".");
                    removeCatalogManifestFile(entry.path, logger_, "duplicate project directory");
                    invalidateProjectSummaryCache(entry.path);
                    continue;
                }

                seenProjectDirectories.push_back(projectDirectoryKey);
                summaries.push_back(std::move(summary));
            }
            catch (const std::exception& exception)
            {
                if (canPruneCatalogManifests &&
                    std::string(exception.what()).find("Build project directory does not exist.") !=
                        std::string::npos)
                {
                    removeCatalogManifestFile(entry.path, logger_, "missing project directory");
                    invalidateProjectSummaryCache(entry.path);
                }
                // Ignore stale or unrelated JSON files in the build catalog.
            }
        }

        return summaries;
    }

    ProjectOpenResult ProjectService::openProjectConfig(const std::filesystem::path& configPath)
    {
        ProjectOpenResult result = readProjectConfigSummary(configPath);
        const ProjectDescriptor& project = result.project;
        recoverProjectDirectoryState(project.projectDirectory, result.resolvedTemplate, logger_);
        InstanceMetadataStore::ensureInstance(project.projectDirectory, result.resolvedTemplate.id);

        logger_.writeOperation(
            LogLevel::Info,
            "ProjectDiagnostics",
            "openProject selectedGameId=\"" + toUtf8(result.resolvedTemplate.id) +
                "\", definitionVersion=\"" +
                (project.fingerprint.has_value()
                    ? toUtf8(project.fingerprint->gameDefinitionVersion)
                    : std::string("<missing>")) +
                "\", configPath=\"" + toUtf8(project.configPath.wstring()) +
                "\", projectDirectory=\"" + toUtf8(project.projectDirectory.wstring()) + "\".");
        logOptionalProjectFingerprintDiagnostics(logger_, "openProject", project.fingerprint);
        logger_.write(LogLevel::Info, "Project opened from build config.");
        projects_.erase(
            std::remove_if(
                projects_.begin(),
                projects_.end(),
                [&project](const ProjectDescriptor& candidate)
                {
                    return isSamePath(candidate.configPath, project.configPath) ||
                        isSamePath(candidate.projectDirectory, project.projectDirectory);
                }),
            projects_.end());
        projects_.push_back(project);

        return result;
    }

    ProjectOpenResult ProjectService::renameProject(
        const std::filesystem::path& configPath,
        std::wstring_view newName)
    {
        std::wstring normalizedName = trimFolderName(std::wstring(newName));
        if (normalizedName.empty())
        {
            throw std::invalid_argument("Project name is required.");
        }

        const auto absoluteConfigPath = std::filesystem::absolute(configPath);
        if (!std::filesystem::exists(absoluteConfigPath) || !std::filesystem::is_regular_file(absoluteConfigPath))
        {
            throw std::invalid_argument("Build config file does not exist.");
        }

        const JsonValue manifest = parseJsonConfig(readTextFile(absoluteConfigPath));
        requireObject(manifest);

        ProjectOpenResult current = openProjectConfig(absoluteConfigPath);
        ProjectDescriptor renamed = current.project;
        const ProjectDescriptor previous = current.project;

        renamed.name = std::move(normalizedName);
        renamed.installRootDirectory = resolveInstallRootForProject(previous);
        renamed.projectDirectory = buildProjectDirectory(renamed.installRootDirectory, renamed.name);
        renamed.configPath = buildManifestPath(renamed.name, previous.configPath);

        const bool movesProjectDirectory = !isSamePath(previous.projectDirectory, renamed.projectDirectory);
        const bool movesConfig = !isSamePath(previous.configPath, renamed.configPath);

        if (movesProjectDirectory && std::filesystem::exists(renamed.projectDirectory))
        {
            throw std::invalid_argument("A build folder with this name already exists.");
        }

        std::filesystem::create_directories(renamed.configPath.parent_path());
        AtomicFileStore fileStore;
        ProjectStateTransaction transaction(
            fileStore,
            renamed.configPath.parent_path(),
            L"project rename",
            &logger_);
        transaction.trackFile(
            renamed.configPath,
            L"project manifest",
            ProjectStateValidation::JsonObject);

        try
        {
            if (movesProjectDirectory)
            {
                std::filesystem::create_directories(renamed.projectDirectory.parent_path());
                std::filesystem::rename(previous.projectDirectory, renamed.projectDirectory);
            }

            fileStore.writeTextFile(
                renamed.configPath,
                buildUpdatedManifest(manifest, renamed),
                AtomicFileWriteOptions{
                    L"project manifest",
                    ProjectStateValidation::JsonObject
                });

            if (movesConfig && std::filesystem::exists(previous.configPath))
            {
                std::filesystem::remove(previous.configPath);
            }

            transaction.commit();
        }
        catch (...)
        {
            throw;
        }

        projects_.erase(
            std::remove_if(
                projects_.begin(),
                projects_.end(),
                [&previous, &renamed](const ProjectDescriptor& candidate)
                {
                    return isSamePath(candidate.configPath, previous.configPath) ||
                        isSamePath(candidate.projectDirectory, previous.projectDirectory) ||
                        isSamePath(candidate.configPath, renamed.configPath) ||
                        isSamePath(candidate.projectDirectory, renamed.projectDirectory);
                }),
            projects_.end());
        projects_.push_back(renamed);
        invalidateProjectSummaryCache(previous.configPath);
        invalidateProjectSummaryCache(renamed.configPath);

        logger_.write(LogLevel::Info, "Project renamed.");
        return ProjectOpenResult{
            renamed,
            current.resolvedTemplate
        };
    }

    void ProjectService::deleteProject(const std::filesystem::path& configPath)
    {
        ProjectDeleteRequest request;
        request.configPath = configPath;
        deleteProject(request);
    }

    void ProjectService::deleteProject(const ProjectDeleteRequest& request)
    {
        if (request.configPath.empty())
        {
            throw std::invalid_argument("Build config path is required.");
        }

        const std::string requestedConfigText = toUtf8(request.configPath.wstring());
        logger_.writeOperation(
            LogLevel::Info,
            "ProjectDeletion",
            std::string("Project delete started. configPath=\"") + requestedConfigText + "\"");

        try
        {
            const std::function<void(const ProjectDeleteProgress&)> deleteProgress =
                makeSafeDeleteProgressCallback(request.progress, logger_);
            const auto requestedConfigPath = std::filesystem::absolute(request.configPath);
            ProjectDescriptor currentProject = readProjectDeleteDescriptor(requestedConfigPath, logger_);
            const bool deleteProjectDirectory = shouldDeleteProjectDirectory(currentProject, logger_);

            const std::filesystem::path projectDirectory =
                currentProject.projectDirectory.empty()
                    ? requestedConfigPath.parent_path()
                    : std::filesystem::absolute(currentProject.projectDirectory).lexically_normal();
            logger_.writeOperation(
                LogLevel::Info,
                "ProjectDeletion",
                std::string("Project delete target resolved. projectDirectory=\"") +
                    toUtf8(projectDirectory.wstring()) + "\"");

            DeletePlan deletePlan;
            if (deleteProjectDirectory)
            {
                deletePlan = collectDeletePlan(projectDirectory, deleteProgress);
            }
            else
            {
                deletePlan.totalEntries = 0;
            }
            const std::string planMessage =
                std::string("Project delete plan collected. projectDirectory=\"") +
                toUtf8(projectDirectory.wstring()) +
                "\", files=" + std::to_string(deletePlan.fileCount) +
                ", totalBytes=" + std::to_string(deletePlan.totalBytes) +
                ", totalEntries=" + std::to_string(deletePlan.totalEntries);
            logger_.write(LogLevel::Info, "ProjectDeletion", planMessage);
            logger_.writeOperation(LogLevel::Info, "ProjectDeletion", planMessage);

            std::vector<std::filesystem::path> configTargets =
                collectConfigTargetsForDelete(requestedConfigPath, currentProject, deleteProjectDirectory);

            std::uintmax_t totalBytes = deletePlan.totalBytes;
            std::uintmax_t totalEntries = deletePlan.totalEntries + configTargets.size();

            for (const std::filesystem::path& configTarget : configTargets)
            {
                std::error_code error;
                const std::uintmax_t configBytes = std::filesystem::file_size(configTarget, error);
                if (!error)
                {
                    totalBytes += configBytes;
                }
            }

            publishDeleteProgress(
                deleteProgress,
                L"delete",
                deleteProjectDirectory ? L"Удаляю файлы сборки" : L"Удаляю конфиг сборки",
                projectDirectory.filename().wstring(),
                1,
                0,
                totalBytes,
                0,
                totalEntries);

            DeleteProgressState deleteState;
            if (deleteProjectDirectory)
            {
                deleteFilesFromPlan(
                    deletePlan,
                    deleteState,
                    deleteProgress,
                    projectDirectory,
                    totalBytes,
                    totalEntries);
                removeRemainingDirectoryTree(
                    deleteState,
                    deleteProgress,
                    projectDirectory,
                    totalBytes,
                    totalEntries);
            }

            for (const std::filesystem::path& configTarget : configTargets)
            {
                std::error_code error;
                const std::uintmax_t configBytes = std::filesystem::file_size(configTarget, error);
                removePathWithRetry(configTarget);
                recordDeletedEntry(
                    deleteState,
                    deleteProgress,
                    projectDirectory,
                    configTarget,
                    error ? 0 : configBytes,
                    totalBytes,
                    totalEntries,
                    L"Удаляю конфиг сборки",
                    true);
            }

            projects_.erase(
                std::remove_if(
                    projects_.begin(),
                    projects_.end(),
                    [&currentProject](const ProjectDescriptor& candidate)
                    {
                        return isSamePath(candidate.configPath, currentProject.configPath) ||
                            isSamePath(candidate.projectDirectory, currentProject.projectDirectory);
                    }),
                projects_.end());
            invalidateProjectSummaryCache(currentProject.configPath);
            for (const std::filesystem::path& configTarget : configTargets)
            {
                invalidateProjectSummaryCache(configTarget);
            }

            publishDeleteProgress(
                deleteProgress,
                L"complete",
                L"Удаление завершено",
                currentProject.name,
                100,
                totalBytes,
                totalBytes,
                totalEntries,
                totalEntries);

            logger_.writeOperation(
                LogLevel::Info,
                "ProjectDeletion",
                std::string("Project delete completed. projectDirectory=\"") +
                    toUtf8(projectDirectory.wstring()) + "\"");
            logger_.write(LogLevel::Info, "Project deleted.");
        }
        catch (const std::exception& exception)
        {
            const std::string message =
                std::string("Project delete failed. configPath=\"") +
                requestedConfigText +
                "\", error=\"" +
                exception.what() +
                "\"";
            logger_.write(LogLevel::Error, "ProjectDeletion", message);
            logger_.writeOperation(LogLevel::Error, "ProjectDeletion", message);
            throw;
        }
        catch (...)
        {
            const std::string message =
                std::string("Project delete failed with an unknown native exception. configPath=\"") +
                requestedConfigText +
                "\"";
            logger_.write(LogLevel::Error, "ProjectDeletion", message);
            logger_.writeOperation(LogLevel::Error, "ProjectDeletion", message);
            throw;
        }
    }

    void ProjectService::materializeTemplate(
        const std::filesystem::path& projectDirectory,
        const BuildTemplate& resolved) const
    {
        std::filesystem::create_directories(projectDirectory);

        for (const auto& folder : resolved.folders)
        {
            std::filesystem::create_directories(projectDirectory / std::filesystem::path(folder));
        }

        const std::wstring profileName = resolved.defaultProfileName.empty()
            ? std::wstring(fallbackProfileName)
            : resolved.defaultProfileName;
        const auto profileDirectory = projectDirectory / L"profiles" / std::filesystem::path(profileName);
        std::filesystem::create_directories(profileDirectory);

        AtomicFileStore fileStore;
        ProjectStateTransaction transaction(
            fileStore,
            profileDirectory,
            L"profile seed",
            &logger_);

        const GameSupportLookupResult lookup = GameSupportRegistry::embedded().lookupById(resolved.id);
        const PluginSupportRules* pluginRules =
            lookup.supported &&
            lookup.support != nullptr &&
            lookup.support->components().pluginRulesProvider != nullptr
                ? &lookup.support->components().pluginRulesProvider->pluginRules()
                : nullptr;
        const std::wstring activePluginsFileName =
            pluginRules != nullptr && !pluginRules->activePluginsFileName.empty()
                ? pluginRules->activePluginsFileName
                : std::wstring(L"plugins.txt");
        const std::wstring loadOrderFileName =
            pluginRules != nullptr && !pluginRules->loadOrderFileName.empty()
                ? pluginRules->loadOrderFileName
                : std::wstring(L"loadorder.txt");

        for (const auto& profileFile : resolved.profileFiles)
        {
            std::string content;

            // The selected game template seeds its own base plugins so a new
            // profile starts with the rules supplied by that game module.
            const std::wstring profileFileName = std::filesystem::path(profileFile).filename().wstring();

            if (equalsIgnoreCase(profileFileName, std::filesystem::path(activePluginsFileName).filename().wstring()))
            {
                for (const auto& plugin : resolved.basePlugins)
                {
                    content += "*" + toUtf8(plugin) + "\n";
                }
            }
            else if (equalsIgnoreCase(profileFileName, std::filesystem::path(loadOrderFileName).filename().wstring()))
            {
                for (const auto& plugin : resolved.basePlugins)
                {
                    content += toUtf8(plugin) + "\n";
                }
            }

            const std::filesystem::path profileFilePath =
                profileDirectory / std::filesystem::path(profileFile);
            transaction.trackFile(
                profileFilePath,
                L"profile state file",
                ProjectStateValidation::Utf8Text);
            fileStore.writeTextFile(
                profileFilePath,
                content,
                AtomicFileWriteOptions{
                    L"profile state file",
                    ProjectStateValidation::Utf8Text
                });
        }

        transaction.commit();
    }

    void ProjectService::writeBuildManifest(
        const ProjectDescriptor& project,
        const BuildTemplate& resolved) const
    {
        JsonWriter writer;
        writer.beginObject();
        writer.field(L"schemaVersion", L"1");
        writer.field(L"name", project.name);
        writer.field(L"templateId", resolved.id);
        writer.field(L"baseTemplateId", resolved.baseTemplateId);
        writer.field(L"gameName", resolved.gameName);
        if (project.fingerprint.has_value())
        {
            writer.field(L"gameId", project.fingerprint->gameId);
            writer.field(L"gameDisplayName", project.fingerprint->gameDisplayName);
        }
        writer.field(L"gamePath", project.gamePath.wstring());
        writer.field(L"installRoot", project.installRootDirectory.wstring());
        writer.field(L"projectDirectory", project.projectDirectory.wstring());
        writer.field(L"configPath", project.configPath.wstring());
        writer.field(L"dataDirectory", resolved.dataDirectory);
        writer.field(L"nexusDomain", resolved.nexusDomain);
        writer.field(L"defaultProfile", resolved.defaultProfileName);
        writer.stringArray(L"folders", resolved.folders);
        writer.stringArray(L"profileFiles", resolved.profileFiles);
        writer.stringArray(L"basePlugins", resolved.basePlugins);
        writer.stringArray(L"pluginExtensions", resolved.pluginExtensions);
        writer.stringArray(L"executables", resolved.executables);
        writeDefaultLaunchExecutable(writer, resolved, project.gamePath);

        writer.key(L"capabilities").beginArray();
        for (const auto& capability : resolved.capabilities)
        {
            writer.beginObject();
            writer.field(L"id", capability.id);
            writer.field(L"displayName", capability.displayName);
            writer.field(L"description", capability.description);
            writer.endObject();
        }
        writer.endArray();

        if (resolved.scriptExtender.has_value())
        {
            const ScriptExtender& extender = resolved.scriptExtender.value();
            writer.key(L"scriptExtender").beginObject();
            writer.field(L"name", extender.name);
            writer.field(L"loaderExecutable", extender.loaderExecutable);
            writer.field(L"website", extender.website);
            writer.endObject();
        }
        else
        {
            writer.key(L"scriptExtender").nullValue();
        }

        if (project.fingerprint.has_value())
        {
            writer.key(L"projectFingerprint");
            writeProjectFingerprint(writer, project.fingerprint.value());
        }

        writer.endObject();

        writeStateFile(
            project.configPath,
            toUtf8(writer.str()),
            L"project manifest",
            ProjectStateValidation::JsonObject);
        invalidateProjectSummaryCache(project.configPath);
    }

    const std::vector<ProjectDescriptor>& ProjectService::projects() const noexcept
    {
        return projects_;
    }

    bool ProjectService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
