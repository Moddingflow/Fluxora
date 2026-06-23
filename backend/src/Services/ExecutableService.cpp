#include "FluxoraCore/Services/ExecutableService.hpp"

#include "FluxoraCore/GameSupport/GameSupportRegistry.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/ExecutableIconService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cwctype>
#include <fstream>
#include <iterator>
#include <map>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view launchExecutablesField = L"launchExecutables";
        constexpr int rootBuilderLaunchCacheManifestSchemaVersion = 1;
        constexpr std::wstring_view rootBuilderLaunchCacheManifestFileName =
            L".fluxora-root-launch-cache.json";

        struct ProjectExecutableContext
        {
            JsonValue manifest;
            std::filesystem::path configPath;
            std::filesystem::path manifestDirectory;
            std::filesystem::path gamePath;
            std::filesystem::path projectDirectory;
            std::filesystem::path modsDirectory;
            std::filesystem::path overwriteDirectory;
            GameId gameId;
            std::wstring gameDisplayName;
            std::wstring gameDefinitionVersion;
            CapabilitySet gameCapabilities;
            std::wstring templateId;
            std::wstring dataDirectory;
            std::wstring defaultProfile;
            std::optional<ExecutableSupportRules> executableRules;
            std::optional<LaunchSupportRules> launchRules;
            std::optional<VfsSupportRules> vfsRules;
            std::optional<ContentLayoutSupportRules> contentLayoutRules;
        };

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

#ifdef _WIN32
        std::string win32Message(DWORD value)
        {
            if (value == ERROR_SUCCESS)
            {
                return {};
            }

            LPWSTR raw = nullptr;
            const DWORD length = FormatMessageW(
                FORMAT_MESSAGE_ALLOCATE_BUFFER |
                    FORMAT_MESSAGE_FROM_SYSTEM |
                    FORMAT_MESSAGE_IGNORE_INSERTS,
                nullptr,
                value,
                0,
                reinterpret_cast<LPWSTR>(&raw),
                0,
                nullptr);
            if (length == 0 || raw == nullptr)
            {
                return {};
            }

            std::wstring message(raw, raw + length);
            LocalFree(raw);
            while (!message.empty() &&
                (message.back() == L'\r' || message.back() == L'\n' || message.back() == L' '))
            {
                message.pop_back();
            }

            return toUtf8(message);
        }

        std::string describeWin32Error(DWORD value)
        {
            std::string description = std::to_string(value);
            if (const std::string message = win32Message(value); !message.empty())
            {
                description += " (" + message + ")";
            }

            return description;
        }
#endif

        std::string filesystemErrorForLog(const std::error_code& error)
        {
            if (!error)
            {
                return "none";
            }

            std::ostringstream stream;
            stream << "value=" << error.value()
                   << ", category=" << error.category().name()
                   << ", message=" << error.message();
            return stream.str();
        }

        std::string pathSafetyErrorForLog(const PathSafetyResult& result)
        {
            const std::wstring message = result.message();
            return message.empty() ? std::string("unsafe path") : toUtf8(message);
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

        void recoverProjectManifest(const std::filesystem::path& path, Logger* logger)
        {
            static_cast<void>(AtomicFileStore().recoverFile(
                path,
                AtomicFileWriteOptions{
                    L"project manifest",
                    ProjectStateValidation::JsonObject
                },
                logger));
        }

        void writeProjectManifest(const std::filesystem::path& path, const std::string& content)
        {
            AtomicFileStore().writeTextFile(
                path,
                content,
                AtomicFileWriteOptions{
                    L"project manifest",
                    ProjectStateValidation::JsonObject
                });
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

        void applySupportRules(ProjectExecutableContext& context)
        {
            if (context.templateId.empty())
            {
                return;
            }

            const GameSupportRegistry& registry = GameSupportRegistry::embedded();
            const GameSupportLookupResult lookup = registry.lookupById(context.templateId);
            if (!lookup.supported || lookup.support == nullptr)
            {
                return;
            }

            context.gameId = lookup.support->identity().id;
            context.gameDisplayName = lookup.support->identity().displayName;
            if (lookup.definition != nullptr)
            {
                context.gameDefinitionVersion = lookup.definition->definitionVersion;
            }
            context.gameCapabilities = lookup.support->capabilities();
            const GameSupportComponents& components = lookup.support->components();
            if (components.executableRulesProvider != nullptr)
            {
                context.executableRules = components.executableRulesProvider->executableRules();
            }
            if (components.launchRulesProvider != nullptr)
            {
                context.launchRules = components.launchRulesProvider->launchRules();
            }
            if (components.vfsRulesProvider != nullptr)
            {
                context.vfsRules = components.vfsRulesProvider->vfsRules();
            }
            if (components.contentLayoutRulesProvider != nullptr)
            {
                context.contentLayoutRules = components.contentLayoutRulesProvider->contentLayoutRules();
            }
            if (context.contentLayoutRules.has_value() &&
                !context.contentLayoutRules->dataFolder.empty())
            {
                context.dataDirectory = context.contentLayoutRules->dataFolder;
            }
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

        ProjectExecutableContext readProjectExecutableContext(
            const std::filesystem::path& configPath,
            Logger* logger)
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

            recoverProjectManifest(absoluteConfigPath, logger);
            JsonValue manifest = parseJsonConfig(readTextFile(absoluteConfigPath));
            if (!manifest.isObject())
            {
                throw std::invalid_argument("Build config root must be a JSON object.");
            }

            const std::filesystem::path manifestDirectory = absoluteConfigPath.parent_path();
            std::filesystem::path projectDirectory = resolveManifestPath(
                readStringOrDefault(manifest, L"projectDirectory", manifestDirectory.wstring()),
                manifestDirectory);
            if (projectDirectory.empty())
            {
                projectDirectory = manifestDirectory;
            }

            const std::filesystem::path gamePath =
                resolveManifestPath(readStringOrDefault(manifest, L"gamePath"), projectDirectory);
            std::wstring templateId = readStringOrDefault(manifest, L"templateId");
            std::wstring dataDirectory = readStringOrDefault(manifest, L"dataDirectory");
            std::wstring defaultProfile = readStringOrDefault(manifest, L"defaultProfile", L"Default");

            ProjectExecutableContext context{
                std::move(manifest),
                absoluteConfigPath,
                manifestDirectory,
                gamePath,
                projectDirectory,
                {},
                {},
                {},
                {},
                {},
                {},
                std::move(templateId),
                std::move(dataDirectory),
                std::move(defaultProfile),
                std::nullopt,
                std::nullopt,
                std::nullopt,
                std::nullopt
            };
            applySupportRules(context);
            return context;
        }

        std::wstring trim(std::wstring value)
        {
            const auto first = value.find_first_not_of(L" \t\r\n");
            if (first == std::wstring::npos)
            {
                return {};
            }

            const auto last = value.find_last_not_of(L" \t\r\n");
            return value.substr(first, last - first + 1);
        }

        std::wstring fileNameWithoutExtension(const std::wstring& pathText)
        {
            std::filesystem::path path(pathText);
            std::wstring stem = path.stem().wstring();
            return stem.empty() ? path.filename().wstring() : stem;
        }

        std::wstring toLower(std::wstring value)
        {
            std::transform(
                value.begin(),
                value.end(),
                value.begin(),
                [](wchar_t character) { return static_cast<wchar_t>(std::towlower(character)); });
            return value;
        }

        bool hasExecutableExtension(const std::wstring& pathText)
        {
            return toLower(std::filesystem::path(pathText).extension().wstring()) == L".exe";
        }

        bool equalsIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
            return toLower(std::wstring(left)) == toLower(std::wstring(right));
        }

        bool isRegularFile(const std::filesystem::path& path)
        {
            std::error_code error;
            return std::filesystem::exists(path, error) && std::filesystem::is_regular_file(path, error);
        }

        bool hasExecutableImageSignature(const std::filesystem::path& path)
        {
            std::ifstream file(path, std::ios::in | std::ios::binary);
            if (!file)
            {
                return false;
            }

            std::array<unsigned char, 2> signature{};
            file.read(reinterpret_cast<char*>(signature.data()), static_cast<std::streamsize>(signature.size()));
            return file.gcount() == static_cast<std::streamsize>(signature.size()) &&
                signature[0] == 'M' &&
                signature[1] == 'Z';
        }

        bool isReadableExecutableFile(const std::filesystem::path& path)
        {
            return isRegularFile(path) && hasExecutableImageSignature(path);
        }

        bool isDirectory(const std::filesystem::path& path)
        {
            std::error_code error;
            return std::filesystem::exists(path, error) && std::filesystem::is_directory(path, error);
        }

        bool supportsRootBuilder(const ProjectExecutableContext& context)
        {
            return context.vfsRules.has_value() &&
                context.vfsRules->rules.supportsRootBuilder &&
                !context.vfsRules->rules.rootBuilderDirectoryName.empty();
        }

        std::wstring rootBuilderDirectoryName(const ProjectExecutableContext& context)
        {
            if (!supportsRootBuilder(context))
            {
                return {};
            }

            return context.vfsRules->rules.rootBuilderDirectoryName;
        }

        std::filesystem::path rootBuilderDirectory(
            const ProjectExecutableContext& context,
            const std::filesystem::path& root)
        {
            const std::wstring directoryName = rootBuilderDirectoryName(context);
            return directoryName.empty() ? std::filesystem::path{} : root / std::filesystem::path(directoryName);
        }

        std::wstring comparablePathText(const std::filesystem::path& path)
        {
            std::wstring text = std::filesystem::absolute(path).lexically_normal().wstring();
            std::replace(text.begin(), text.end(), L'/', L'\\');
            while (text.size() > 1 && (text.back() == L'\\' || text.back() == L'/'))
            {
                text.pop_back();
            }
            return toLower(std::move(text));
        }

        std::optional<std::filesystem::path> relativePathIfInsideLexical(
            const std::filesystem::path& child,
            const std::filesystem::path& root)
        {
            if (child.empty() || root.empty())
            {
                return std::nullopt;
            }

            const std::filesystem::path normalizedChild =
                std::filesystem::absolute(child).lexically_normal();
            const std::filesystem::path normalizedRoot =
                std::filesystem::absolute(root).lexically_normal();
            const std::wstring childText = comparablePathText(normalizedChild);
            const std::wstring rootText = comparablePathText(normalizedRoot);

            if (childText == rootText)
            {
                return std::filesystem::path{};
            }

            if (childText.size() <= rootText.size() ||
                childText.compare(0, rootText.size(), rootText) != 0 ||
                (childText[rootText.size()] != L'\\' && childText[rootText.size()] != L'/'))
            {
                return std::nullopt;
            }

            std::wstring childNative = normalizedChild.wstring();
            std::replace(childNative.begin(), childNative.end(), L'/', L'\\');
            return std::filesystem::path(childNative.substr(rootText.size() + 1));
        }

        bool isUsableRelativePath(const std::filesystem::path& path)
        {
            if (path.empty() || path.is_absolute())
            {
                return false;
            }

            for (const std::filesystem::path& part : path)
            {
                if (part == L"..")
                {
                    return false;
                }
            }

            return true;
        }

        bool firstPathComponentEquals(
            const std::filesystem::path& path,
            std::wstring_view expected)
        {
            for (const std::filesystem::path& part : path)
            {
                const std::wstring text = part.wstring();
                if (text.empty() || text == L"." || text == L"\\")
                {
                    continue;
                }

                return equalsIgnoreCase(text, expected);
            }

            return false;
        }

        std::filesystem::path dataDirectoryPath(const ProjectExecutableContext& context)
        {
            return std::filesystem::path(context.dataDirectory);
        }

        std::optional<std::filesystem::path> childDirectoryByName(
            const std::filesystem::path& directory,
            std::wstring_view childName)
        {
            if (!isDirectory(directory))
            {
                return std::nullopt;
            }

            std::error_code error;
            for (const std::filesystem::directory_entry& entry :
                std::filesystem::directory_iterator(directory, error))
            {
                if (error)
                {
                    break;
                }

                if (entry.is_directory(error) &&
                    equalsIgnoreCase(entry.path().filename().wstring(), childName))
                {
                    return entry.path();
                }
            }

            return std::nullopt;
        }

        std::optional<std::filesystem::path> rootBuilderRelativeFromImportedModsPath(
            const ProjectExecutableContext& context,
            const std::filesystem::path& path)
        {
            const std::wstring rootDirectoryName = rootBuilderDirectoryName(context);
            if (rootDirectoryName.empty())
            {
                return std::nullopt;
            }

            std::vector<std::filesystem::path> parts;
            for (const std::filesystem::path& part : path.lexically_normal())
            {
                const std::wstring text = part.wstring();
                if (text.empty() || text == L"." || text == L"\\")
                {
                    continue;
                }

                parts.push_back(part);
            }

            if (parts.size() < 4 ||
                !equalsIgnoreCase(parts[0].wstring(), L"mods") ||
                !equalsIgnoreCase(parts[2].wstring(), rootDirectoryName))
            {
                return std::nullopt;
            }

            std::filesystem::path relative;
            for (std::size_t index = 3; index < parts.size(); ++index)
            {
                relative /= parts[index];
            }

            return isUsableRelativePath(relative)
                ? std::optional<std::filesystem::path>(relative)
                : std::nullopt;
        }

        std::wstring safeDirectoryName(std::wstring value)
        {
            for (wchar_t& character : value)
            {
                const bool keep =
                    (character >= L'a' && character <= L'z') ||
                    (character >= L'A' && character <= L'Z') ||
                    (character >= L'0' && character <= L'9') ||
                    character == L'-' ||
                    character == L'_';
                if (!keep)
                {
                    character = L'_';
                }
            }

            return value.empty() ? std::wstring(L"root") : value;
        }

        std::vector<std::filesystem::path> activeProfileModPaths(const ProjectExecutableContext& context)
        {
            if (context.projectDirectory.empty() || context.modsDirectory.empty())
            {
                return {};
            }

            try
            {
                const std::wstring profile = context.defaultProfile.empty() ? L"Default" : context.defaultProfile;
                std::vector<std::filesystem::path> mods;
                for (const ProfileOrderItemRecord& item : InstanceMetadataStore::listProfileOrderItems(
                         context.projectDirectory,
                         profile,
                         context.modsDirectory))
                {
                    if (item.kind == L"mod" &&
                        item.hasMod &&
                        item.mod.state != L"disabled" &&
                        !item.mod.path.empty())
                    {
                        mods.push_back(item.mod.path);
                    }
                }

                return mods;
            }
            catch (...)
            {
                return {};
            }
        }

        bool isScriptExtenderLoaderName(
            const ProjectExecutableContext& context,
            const std::filesystem::path& path)
        {
            const std::wstring fileName = path.filename().wstring();
            if (fileName.empty())
            {
                return false;
            }

            std::vector<std::wstring> candidateNames;
            if (context.launchRules.has_value() && context.launchRules->rules.scriptExtender.has_value())
            {
                candidateNames.push_back(
                    context.launchRules->rules.scriptExtender->loaderExecutable.displayName());
            }
            if (context.executableRules.has_value() && context.executableRules->roles.scriptExtender.has_value())
            {
                candidateNames.push_back(context.executableRules->roles.scriptExtender->displayName());
            }
            if (context.executableRules.has_value())
            {
                for (const GameExecutableDefinition& executable : context.executableRules->executables)
                {
                    if (executable.role == GameExecutableRole::ScriptExtender)
                    {
                        candidateNames.push_back(executable.name.displayName());
                    }
                }
            }

            for (const std::wstring& candidateName : candidateNames)
            {
                if (equalsIgnoreCase(fileName, candidateName))
                {
                    return true;
                }
            }

            return false;
        }

        std::optional<std::filesystem::path> gameRootScriptExtenderLoader(
            const ProjectExecutableContext& context,
            const std::filesystem::path& executablePath)
        {
            if (context.gamePath.empty() || !isScriptExtenderLoaderName(context, executablePath))
            {
                return std::nullopt;
            }

            const std::filesystem::path candidate = context.gamePath / executablePath.filename();
            if (isReadableExecutableFile(candidate))
            {
                return std::filesystem::absolute(candidate);
            }

            return std::nullopt;
        }

        std::optional<std::filesystem::path> rootBuilderVirtualRelativePath(
            const ProjectExecutableContext& context,
            const std::filesystem::path& executablePath)
        {
            if (!supportsRootBuilder(context) || executablePath.empty())
            {
                return std::nullopt;
            }

            std::filesystem::path relative;
            if (executablePath.is_absolute())
            {
                for (const std::filesystem::path& mod : activeProfileModPaths(context))
                {
                    const std::optional<std::filesystem::path> underModRoot =
                        relativePathIfInsideLexical(executablePath, rootBuilderDirectory(context, mod));
                    if (underModRoot.has_value() && isUsableRelativePath(underModRoot.value()))
                    {
                        relative = underModRoot.value();
                        break;
                    }
                }

                if (relative.empty() && !context.overwriteDirectory.empty())
                {
                    const std::optional<std::filesystem::path> underOverwriteRoot =
                        relativePathIfInsideLexical(
                            executablePath,
                            rootBuilderDirectory(context, context.overwriteDirectory));
                    if (underOverwriteRoot.has_value() && isUsableRelativePath(underOverwriteRoot.value()))
                    {
                        relative = underOverwriteRoot.value();
                    }
                }

                const std::optional<std::filesystem::path> underGame =
                    relativePathIfInsideLexical(executablePath, context.gamePath);
                if (relative.empty() && underGame.has_value())
                {
                    relative = underGame.value();
                }
                else if (relative.empty() && isScriptExtenderLoaderName(context, executablePath))
                {
                    relative = executablePath.filename();
                }
                else if (relative.empty())
                {
                    return std::nullopt;
                }
            }
            else
            {
                if (const std::optional<std::filesystem::path> importedModsPath =
                        rootBuilderRelativeFromImportedModsPath(context, executablePath);
                    importedModsPath.has_value())
                {
                    relative = importedModsPath.value();
                }
                else
                {
                    relative = executablePath.lexically_normal();
                }
            }

            return isUsableRelativePath(relative)
                ? std::optional<std::filesystem::path>(relative)
                : std::nullopt;
        }

        std::optional<std::filesystem::path> rootBuilderBackingFile(
            const ProjectExecutableContext& context,
            const std::filesystem::path& executablePath)
        {
            const std::optional<std::filesystem::path> relative =
                rootBuilderVirtualRelativePath(context, executablePath);
            if (!relative.has_value())
            {
                return std::nullopt;
            }

            std::optional<std::filesystem::path> winner;
            for (const std::filesystem::path& mod : activeProfileModPaths(context))
            {
                const std::filesystem::path candidate =
                    rootBuilderDirectory(context, mod) / relative.value();
                if (isReadableExecutableFile(candidate))
                {
                    winner = std::filesystem::absolute(candidate);
                }
            }

            if (!context.overwriteDirectory.empty())
            {
                const std::filesystem::path candidate =
                    rootBuilderDirectory(context, context.overwriteDirectory) / relative.value();
                if (isReadableExecutableFile(candidate))
                {
                    winner = std::filesystem::absolute(candidate);
                }
            }

            return winner;
        }

        std::optional<std::filesystem::path> rootBuilderVirtualPathForBackingFile(
            const ProjectExecutableContext& context,
            const std::filesystem::path& backingPath)
        {
            if (!supportsRootBuilder(context) || context.gamePath.empty())
            {
                return std::nullopt;
            }

            for (const std::filesystem::path& mod : activeProfileModPaths(context))
            {
                const std::optional<std::filesystem::path> relative =
                    relativePathIfInsideLexical(backingPath, rootBuilderDirectory(context, mod));
                if (relative.has_value() && isUsableRelativePath(relative.value()))
                {
                    return context.gamePath / relative.value();
                }
            }

            if (!context.overwriteDirectory.empty())
            {
                const std::optional<std::filesystem::path> relative =
                    relativePathIfInsideLexical(
                        backingPath,
                        rootBuilderDirectory(context, context.overwriteDirectory));
                if (relative.has_value() && isUsableRelativePath(relative.value()))
                {
                    return context.gamePath / relative.value();
                }
            }

            return std::nullopt;
        }

        void appendUniqueDirectory(
            std::vector<std::filesystem::path>& directories,
            const std::filesystem::path& directory)
        {
            if (!isDirectory(directory))
            {
                return;
            }

            const std::wstring comparable = comparablePathText(directory);
            const auto duplicate = std::find_if(
                directories.begin(),
                directories.end(),
                [&comparable](const std::filesystem::path& existing)
                {
                    return comparablePathText(existing) == comparable;
                });
            if (duplicate == directories.end())
            {
                directories.push_back(directory);
            }
        }

        std::vector<std::filesystem::path> dataOverlayRoots(
            const ProjectExecutableContext& context,
            const std::vector<std::filesystem::path>& activeMods)
        {
            const std::filesystem::path dataDirectory = dataDirectoryPath(context);
            std::vector<std::filesystem::path> roots;

            if (!context.gamePath.empty())
            {
                appendUniqueDirectory(roots, context.gamePath / dataDirectory);
            }

            for (const std::filesystem::path& mod : activeMods)
            {
                appendUniqueDirectory(roots, mod);
                appendUniqueDirectory(roots, mod / dataDirectory);
                appendUniqueDirectory(roots, rootBuilderDirectory(context, mod) / dataDirectory);
            }

            if (!context.overwriteDirectory.empty())
            {
                appendUniqueDirectory(roots, context.overwriteDirectory);
            }

            return roots;
        }

        struct RootBuilderBackingLocation
        {
            std::filesystem::path modDirectory;
            std::filesystem::path rootDirectory;
            std::filesystem::path relativePath;
        };

        struct RootBuilderLaunchCache
        {
            std::filesystem::path executablePath;
            std::filesystem::path rootDirectory;
        };

        struct RootBuilderLaunchCacheFileStamp
        {
            std::uintmax_t size{0};
            std::int64_t modifiedTicks{0};
        };

        struct RootBuilderLaunchCacheDesiredFile
        {
            std::filesystem::path relativePath;
            std::filesystem::path sourcePath;
            RootBuilderLaunchCacheFileStamp stamp;
        };

        struct RootBuilderLaunchCacheManifestFile
        {
            std::filesystem::path relativePath;
            std::filesystem::path sourcePath;
            RootBuilderLaunchCacheFileStamp stamp;
        };

        struct RootBuilderLaunchCacheManifest
        {
            std::wstring revision;
            std::map<std::wstring, RootBuilderLaunchCacheManifestFile> files;
        };

        enum class RootBuilderLaunchCacheManifestStatus
        {
            Missing,
            Loaded,
            Corrupt
        };

        struct RootBuilderLaunchCacheManifestReadResult
        {
            RootBuilderLaunchCacheManifestStatus status{RootBuilderLaunchCacheManifestStatus::Missing};
            std::optional<RootBuilderLaunchCacheManifest> manifest;
            std::string reason;
        };

        struct RootBuilderLaunchCacheDesiredState
        {
            std::wstring revision;
            std::map<std::wstring, RootBuilderLaunchCacheDesiredFile> files;
            std::map<std::wstring, std::filesystem::path> directories;
            std::size_t materializedEarlyDataRoots{0};
        };

        struct RootBuilderLaunchCacheApplyStats
        {
            std::size_t copiedFiles{0};
            std::size_t reusedFiles{0};
            std::size_t deletedFiles{0};
            std::size_t deletedDirectories{0};
            bool rebuilt{false};
            bool revisionChanged{false};
        };

        std::wstring rootBuilderLaunchCacheRelativeKey(const std::filesystem::path& relativePath)
        {
            std::wstring key = relativePath.lexically_normal().generic_wstring();
            while (!key.empty() && key.back() == L'/')
            {
                key.pop_back();
            }

#ifdef _WIN32
            key = toLower(std::move(key));
#endif
            return key;
        }

        std::filesystem::path rootBuilderLaunchCacheManifestPath(
            const std::filesystem::path& cacheRoot)
        {
            return cacheRoot / std::filesystem::path(rootBuilderLaunchCacheManifestFileName);
        }

        void mixRootBuilderLaunchCacheHash(std::uint64_t& hash, std::uint64_t value)
        {
            hash ^= value;
            hash *= 1099511628211ULL;
        }

        void mixRootBuilderLaunchCacheHash(std::uint64_t& hash, std::wstring_view value)
        {
            for (const wchar_t character : value)
            {
                mixRootBuilderLaunchCacheHash(hash, static_cast<std::uint64_t>(character));
            }
            mixRootBuilderLaunchCacheHash(hash, 0xffULL);
        }

        void mixRootBuilderLaunchCacheHash(std::uint64_t& hash, const std::wstring& value)
        {
            mixRootBuilderLaunchCacheHash(hash, std::wstring_view(value));
        }

        void mixRootBuilderLaunchCacheHash(std::uint64_t& hash, const wchar_t* value)
        {
            mixRootBuilderLaunchCacheHash(hash, std::wstring_view(value == nullptr ? L"" : value));
        }

        void mixRootBuilderLaunchCacheHash(
            std::uint64_t& hash,
            const std::filesystem::path& path)
        {
            mixRootBuilderLaunchCacheHash(hash, comparablePathText(path));
        }

        std::wstring rootBuilderLaunchCacheRevision(
            const ProjectExecutableContext& context,
            const RootBuilderBackingLocation& location,
            const std::vector<std::filesystem::path>& activeMods,
            bool executableIsUnderData)
        {
            std::uint64_t hash = 1469598103934665603ULL;
            mixRootBuilderLaunchCacheHash(hash, L"root-builder-launch-cache-v2");
            mixRootBuilderLaunchCacheHash(hash, context.projectDirectory);
            mixRootBuilderLaunchCacheHash(hash, context.gamePath);
            mixRootBuilderLaunchCacheHash(hash, context.gameId.value());
            mixRootBuilderLaunchCacheHash(hash, context.gameDefinitionVersion);
            mixRootBuilderLaunchCacheHash(hash, context.templateId);
            mixRootBuilderLaunchCacheHash(hash, context.defaultProfile);
            mixRootBuilderLaunchCacheHash(hash, context.dataDirectory);
            mixRootBuilderLaunchCacheHash(hash, rootBuilderDirectoryName(context));
            mixRootBuilderLaunchCacheHash(hash, location.modDirectory);
            mixRootBuilderLaunchCacheHash(hash, location.rootDirectory);
            mixRootBuilderLaunchCacheHash(hash, location.relativePath.generic_wstring());
            mixRootBuilderLaunchCacheHash(hash, executableIsUnderData ? 1ULL : 0ULL);
            for (const std::filesystem::path& mod : activeMods)
            {
                mixRootBuilderLaunchCacheHash(hash, L"mod");
                mixRootBuilderLaunchCacheHash(hash, mod);
                mixRootBuilderLaunchCacheHash(hash, rootBuilderDirectory(context, mod));
            }
            if (!context.overwriteDirectory.empty())
            {
                mixRootBuilderLaunchCacheHash(hash, L"overwrite");
                mixRootBuilderLaunchCacheHash(hash, context.overwriteDirectory);
                mixRootBuilderLaunchCacheHash(hash, rootBuilderDirectory(context, context.overwriteDirectory));
            }

            return L"v2:" + std::to_wstring(hash);
        }

        std::optional<std::uintmax_t> parseUnsignedJsonNumber(const JsonValue& value)
        {
            if (!value.isNumber())
            {
                return std::nullopt;
            }

            try
            {
                std::size_t consumed = 0;
                const unsigned long long parsed = std::stoull(value.asNumber(), &consumed, 10);
                if (consumed != value.asNumber().size())
                {
                    return std::nullopt;
                }
                return static_cast<std::uintmax_t>(parsed);
            }
            catch (...)
            {
                return std::nullopt;
            }
        }

        std::optional<std::int64_t> parseSignedJsonNumber(const JsonValue& value)
        {
            if (!value.isNumber())
            {
                return std::nullopt;
            }

            try
            {
                std::size_t consumed = 0;
                const long long parsed = std::stoll(value.asNumber(), &consumed, 10);
                if (consumed != value.asNumber().size())
                {
                    return std::nullopt;
                }
                return static_cast<std::int64_t>(parsed);
            }
            catch (...)
            {
                return std::nullopt;
            }
        }

        std::optional<RootBuilderLaunchCacheFileStamp> rootBuilderLaunchCacheFileStamp(
            const std::filesystem::path& path,
            std::string& failure)
        {
            std::error_code error;
            const std::uintmax_t size = std::filesystem::file_size(path, error);
            if (error)
            {
                failure = "could not inspect " + toUtf8(path.wstring()) +
                    " size (" + filesystemErrorForLog(error) + ")";
                return std::nullopt;
            }

            error.clear();
            const std::filesystem::file_time_type modified =
                std::filesystem::last_write_time(path, error);
            if (error)
            {
                failure = "could not inspect " + toUtf8(path.wstring()) +
                    " modified time (" + filesystemErrorForLog(error) + ")";
                return std::nullopt;
            }

            return RootBuilderLaunchCacheFileStamp{
                size,
                static_cast<std::int64_t>(modified.time_since_epoch().count())
            };
        }

        void rememberRootBuilderLaunchCacheDirectory(
            RootBuilderLaunchCacheDesiredState& state,
            const std::filesystem::path& relativeDirectory)
        {
            const std::filesystem::path normalized = relativeDirectory.lexically_normal();
            if (normalized.empty() || normalized == L".")
            {
                return;
            }

            std::filesystem::path current;
            for (const std::filesystem::path& part : normalized)
            {
                const std::wstring text = part.wstring();
                if (text.empty() || text == L"." || text == L"\\" || text == L"/")
                {
                    continue;
                }

                current /= part;
                state.directories[rootBuilderLaunchCacheRelativeKey(current)] = current;
            }
        }

        bool addRootBuilderLaunchCacheDesiredFile(
            RootBuilderLaunchCacheDesiredState& state,
            const std::filesystem::path& source,
            const std::filesystem::path& relativeDestination,
            std::string& failure)
        {
            const PathSafetyService pathSafety;
            const PathSafetyResult relativeSafety =
                pathSafety.validateRelativePath(relativeDestination);
            if (!relativeSafety.safe())
            {
                failure = "unsafe launch cache relative path " +
                    toUtf8(relativeDestination.wstring()) +
                    " (" + pathSafetyErrorForLog(relativeSafety) + ")";
                return false;
            }

            const std::optional<RootBuilderLaunchCacheFileStamp> stamp =
                rootBuilderLaunchCacheFileStamp(source, failure);
            if (!stamp.has_value())
            {
                return false;
            }

            const std::filesystem::path normalizedRelative =
                relativeDestination.lexically_normal();
            rememberRootBuilderLaunchCacheDirectory(state, normalizedRelative.parent_path());
            state.files[rootBuilderLaunchCacheRelativeKey(normalizedRelative)] =
                RootBuilderLaunchCacheDesiredFile{
                    normalizedRelative,
                    std::filesystem::absolute(source).lexically_normal(),
                    stamp.value()
                };
            return true;
        }

        bool collectRootBuilderLaunchCacheDirectoryOverlay(
            const std::filesystem::path& sourceDirectory,
            const std::filesystem::path& destinationRelativeRoot,
            RootBuilderLaunchCacheDesiredState& state,
            bool skipDataSubtree,
            const std::filesystem::path& dataDirectory,
            std::string& failure)
        {
            const PathSafetyService pathSafety;
            rememberRootBuilderLaunchCacheDirectory(state, destinationRelativeRoot);

            std::error_code error;
            std::filesystem::recursive_directory_iterator iterator(
                sourceDirectory,
                std::filesystem::directory_options::skip_permission_denied,
                error);
            const std::filesystem::recursive_directory_iterator end;
            if (error)
            {
                failure = "could not enumerate " + toUtf8(sourceDirectory.wstring()) +
                    " (" + filesystemErrorForLog(error) + ")";
                return false;
            }

            while (!error && iterator != end)
            {
                const std::filesystem::path current = iterator->path();
                const PathSafetyResult sourceSafety =
                    pathSafety.validateContainedPath(sourceDirectory, current);
                if (!sourceSafety.safe())
                {
                    failure = "unsafe launch cache source " + toUtf8(current.wstring()) +
                        " (" + pathSafetyErrorForLog(sourceSafety) + ")";
                    return false;
                }

                const std::optional<std::filesystem::path> relative =
                    relativePathIfInsideLexical(current, sourceDirectory);
                if (!relative.has_value() || relative->empty())
                {
                    iterator.increment(error);
                    continue;
                }

                const std::filesystem::path destinationRelative =
                    (destinationRelativeRoot / relative.value()).lexically_normal();
                error.clear();
                const bool isDirectoryEntry = iterator->is_directory(error);
                if (error)
                {
                    failure = "could not inspect " + toUtf8(current.wstring()) +
                        " (" + filesystemErrorForLog(error) + ")";
                    return false;
                }

                if (skipDataSubtree && firstPathComponentEquals(destinationRelative, dataDirectory.wstring()))
                {
                    if (isDirectoryEntry)
                    {
                        iterator.disable_recursion_pending();
                    }

                    iterator.increment(error);
                    if (error)
                    {
                        failure = "could not continue enumerating " + toUtf8(sourceDirectory.wstring()) +
                            " (" + filesystemErrorForLog(error) + ")";
                        return false;
                    }
                    continue;
                }

                if (isDirectoryEntry)
                {
                    rememberRootBuilderLaunchCacheDirectory(state, destinationRelative);
                }
                else
                {
                    error.clear();
                    const bool isRegularFile = iterator->is_regular_file(error);
                    if (error)
                    {
                        failure = "could not inspect " + toUtf8(current.wstring()) +
                            " (" + filesystemErrorForLog(error) + ")";
                        return false;
                    }

                    if (isRegularFile &&
                        !addRootBuilderLaunchCacheDesiredFile(
                            state,
                            current,
                            destinationRelative,
                            failure))
                    {
                        return false;
                    }
                }

                iterator.increment(error);
            }

            if (error)
            {
                failure = "could not continue enumerating " + toUtf8(sourceDirectory.wstring()) +
                    " (" + filesystemErrorForLog(error) + ")";
                return false;
            }

            return true;
        }

        bool collectEarlyRootBuilderLaunchCacheDataDirectories(
            const ProjectExecutableContext& context,
            const std::vector<std::filesystem::path>& activeMods,
            RootBuilderLaunchCacheDesiredState& state,
            std::string& failure)
        {
            std::vector<std::wstring> earlyRuntimeDirectories;
            if (context.vfsRules.has_value())
            {
                for (const std::wstring& directoryName :
                     context.vfsRules->rules.excludedLaunchCacheDirectories)
                {
                    if (!equalsIgnoreCase(directoryName, rootBuilderDirectoryName(context)))
                    {
                        earlyRuntimeDirectories.push_back(directoryName);
                    }
                }
            }

            for (const std::filesystem::path& dataRoot : dataOverlayRoots(context, activeMods))
            {
                for (const std::wstring& runtimeDirectoryName : earlyRuntimeDirectories)
                {
                    const std::optional<std::filesystem::path> source =
                        childDirectoryByName(dataRoot, runtimeDirectoryName);
                    if (!source.has_value())
                    {
                        continue;
                    }

                    const std::filesystem::path destinationRelative =
                        dataDirectoryPath(context) / std::filesystem::path(runtimeDirectoryName);
                    if (!collectRootBuilderLaunchCacheDirectoryOverlay(
                        source.value(),
                        destinationRelative,
                        state,
                        false,
                        dataDirectoryPath(context),
                        failure))
                    {
                        return false;
                    }

                    ++state.materializedEarlyDataRoots;
                }
            }

            return true;
        }

        std::optional<RootBuilderLaunchCacheDesiredState> collectRootBuilderLaunchCacheDesiredState(
            const ProjectExecutableContext& context,
            const RootBuilderBackingLocation& location,
            bool executableIsUnderData,
            std::string& failure)
        {
            RootBuilderLaunchCacheDesiredState state;
            const std::vector<std::filesystem::path> activeMods = activeProfileModPaths(context);
            state.revision = rootBuilderLaunchCacheRevision(
                context,
                location,
                activeMods,
                executableIsUnderData);

            const PathSafetyService pathSafety;
            if (!context.gamePath.empty())
            {
                std::error_code error;
                std::filesystem::directory_iterator gameIterator(
                    context.gamePath,
                    std::filesystem::directory_options::skip_permission_denied,
                    error);
                const std::filesystem::directory_iterator gameEnd;
                if (error)
                {
                    failure = "could not enumerate " + toUtf8(context.gamePath.wstring()) +
                        " (" + filesystemErrorForLog(error) + ")";
                    return std::nullopt;
                }

                while (!error && gameIterator != gameEnd)
                {
                    const std::filesystem::path current = gameIterator->path();
                    const PathSafetyResult sourceSafety =
                        pathSafety.validateContainedPath(context.gamePath, current);
                    if (!sourceSafety.safe())
                    {
                        failure = "unsafe launch cache source " + toUtf8(current.wstring()) +
                            " (" + pathSafetyErrorForLog(sourceSafety) + ")";
                        return std::nullopt;
                    }

                    error.clear();
                    if (gameIterator->is_regular_file(error))
                    {
                        if (!addRootBuilderLaunchCacheDesiredFile(
                            state,
                            current,
                            current.filename(),
                            failure))
                        {
                            return std::nullopt;
                        }
                    }
                    else if (error)
                    {
                        failure = "could not inspect " + toUtf8(current.wstring()) +
                            " (" + filesystemErrorForLog(error) + ")";
                        return std::nullopt;
                    }

                    gameIterator.increment(error);
                }

                if (error)
                {
                    failure = "could not continue enumerating " + toUtf8(context.gamePath.wstring()) +
                        " (" + filesystemErrorForLog(error) + ")";
                    return std::nullopt;
                }

                rememberRootBuilderLaunchCacheDirectory(state, dataDirectoryPath(context));
            }

            if (!executableIsUnderData &&
                !collectEarlyRootBuilderLaunchCacheDataDirectories(context, activeMods, state, failure))
            {
                return std::nullopt;
            }

            std::vector<std::filesystem::path> overlayRoots;
            for (const std::filesystem::path& mod : activeMods)
            {
                const std::filesystem::path root = rootBuilderDirectory(context, mod);
                if (isDirectory(root))
                {
                    overlayRoots.push_back(root);
                }
            }
            if (!context.overwriteDirectory.empty())
            {
                const std::filesystem::path root = rootBuilderDirectory(context, context.overwriteDirectory);
                if (isDirectory(root))
                {
                    overlayRoots.push_back(root);
                }
            }

            for (const std::filesystem::path& overlayRoot : overlayRoots)
            {
                if (!collectRootBuilderLaunchCacheDirectoryOverlay(
                    overlayRoot,
                    {},
                    state,
                    !executableIsUnderData,
                    dataDirectoryPath(context),
                    failure))
                {
                    return std::nullopt;
                }
            }

            return state;
        }

        RootBuilderLaunchCacheManifestReadResult readRootBuilderLaunchCacheManifest(
            const std::filesystem::path& manifestPath,
            Logger& logger)
        {
            std::error_code existsError;
            if (!std::filesystem::exists(manifestPath, existsError))
            {
                return RootBuilderLaunchCacheManifestReadResult{};
            }
            if (existsError)
            {
                return RootBuilderLaunchCacheManifestReadResult{
                    RootBuilderLaunchCacheManifestStatus::Corrupt,
                    std::nullopt,
                    "manifest existence could not be inspected (" + filesystemErrorForLog(existsError) + ")"
                };
            }

            try
            {
                static_cast<void>(AtomicFileStore().recoverFile(
                    manifestPath,
                    AtomicFileWriteOptions{
                        L"Root Builder launch cache manifest",
                        ProjectStateValidation::JsonObject
                    },
                    &logger));

                const JsonValue root = JsonReader::parse(fromUtf8(readTextFile(manifestPath)));
                if (!root.isObject())
                {
                    throw std::runtime_error("root is not an object");
                }

                const JsonValue* schemaVersion = root.find(L"schemaVersion");
                const std::optional<std::uintmax_t> schema =
                    schemaVersion == nullptr ? std::nullopt : parseUnsignedJsonNumber(*schemaVersion);
                if (!schema.has_value() ||
                    schema.value() != static_cast<std::uintmax_t>(rootBuilderLaunchCacheManifestSchemaVersion))
                {
                    throw std::runtime_error("schema version is unsupported");
                }

                const JsonValue* revisionValue = root.find(L"revision");
                if (revisionValue == nullptr || !revisionValue->isString())
                {
                    throw std::runtime_error("revision is missing");
                }

                const JsonValue* filesValue = root.find(L"files");
                if (filesValue == nullptr || !filesValue->isArray())
                {
                    throw std::runtime_error("files are missing");
                }

                RootBuilderLaunchCacheManifest manifest;
                manifest.revision = revisionValue->asString();
                for (const JsonValue& item : filesValue->asArray())
                {
                    if (!item.isObject())
                    {
                        throw std::runtime_error("file item is not an object");
                    }

                    const JsonValue* relativePathValue = item.find(L"relativePath");
                    const JsonValue* sourcePathValue = item.find(L"sourcePath");
                    const JsonValue* sizeValue = item.find(L"size");
                    const JsonValue* modifiedValue = item.find(L"mtimeTicks");
                    if (relativePathValue == nullptr || !relativePathValue->isString() ||
                        sourcePathValue == nullptr || !sourcePathValue->isString() ||
                        sizeValue == nullptr ||
                        modifiedValue == nullptr)
                    {
                        throw std::runtime_error("file item has missing fields");
                    }

                    const std::filesystem::path relativePath(relativePathValue->asString());
                    if (!isUsableRelativePath(relativePath))
                    {
                        throw std::runtime_error("file item has unsafe relative path");
                    }

                    const std::optional<std::uintmax_t> size = parseUnsignedJsonNumber(*sizeValue);
                    const std::optional<std::int64_t> modified = parseSignedJsonNumber(*modifiedValue);
                    if (!size.has_value() || !modified.has_value())
                    {
                        throw std::runtime_error("file item has invalid stamp");
                    }

                    manifest.files[rootBuilderLaunchCacheRelativeKey(relativePath)] =
                        RootBuilderLaunchCacheManifestFile{
                            relativePath.lexically_normal(),
                            std::filesystem::path(sourcePathValue->asString()),
                            RootBuilderLaunchCacheFileStamp{
                                size.value(),
                                modified.value()
                            }
                        };
                }

                return RootBuilderLaunchCacheManifestReadResult{
                    RootBuilderLaunchCacheManifestStatus::Loaded,
                    std::move(manifest),
                    {}
                };
            }
            catch (const std::exception& exception)
            {
                return RootBuilderLaunchCacheManifestReadResult{
                    RootBuilderLaunchCacheManifestStatus::Corrupt,
                    std::nullopt,
                    exception.what()
                };
            }
        }

        void writeRootBuilderLaunchCacheManifest(
            const std::filesystem::path& manifestPath,
            const RootBuilderLaunchCacheDesiredState& state)
        {
            JsonWriter writer;
            writer.beginObject()
                .field(L"schemaVersion", rootBuilderLaunchCacheManifestSchemaVersion)
                .field(L"revision", state.revision)
                .key(L"files")
                .beginArray();
            for (const auto& [key, file] : state.files)
            {
                static_cast<void>(key);
                writer.beginObject()
                    .field(L"relativePath", file.relativePath.generic_wstring())
                    .field(L"sourcePath", file.sourcePath.wstring())
                    .field(L"size", file.stamp.size)
                    .key(L"mtimeTicks")
                    .numberValue(std::to_wstring(file.stamp.modifiedTicks))
                    .endObject();
            }
            writer.endArray().endObject();

            AtomicFileStore().writeTextFile(
                manifestPath,
                toUtf8(writer.str()),
                AtomicFileWriteOptions{
                    L"Root Builder launch cache manifest",
                    ProjectStateValidation::JsonObject,
                    {},
                    false
                });
        }

        bool sameRootBuilderLaunchCacheManifestFile(
            const RootBuilderLaunchCacheManifestFile& previous,
            const RootBuilderLaunchCacheDesiredFile& desired)
        {
            return comparablePathText(previous.sourcePath) == comparablePathText(desired.sourcePath) &&
                previous.stamp.size == desired.stamp.size &&
                previous.stamp.modifiedTicks == desired.stamp.modifiedTicks;
        }

        bool rootBuilderLaunchCacheDestinationLooksReusable(
            const std::filesystem::path& destination,
            const RootBuilderLaunchCacheDesiredFile& desired)
        {
            std::error_code error;
            if (!std::filesystem::is_regular_file(destination, error) || error)
            {
                return false;
            }

            error.clear();
            const std::uintmax_t size = std::filesystem::file_size(destination, error);
            return !error && size == desired.stamp.size;
        }

        bool removeExistingRootBuilderLaunchCachePath(
            const std::filesystem::path& path,
            std::string& failure)
        {
            std::error_code error;
            const std::filesystem::file_status status = std::filesystem::symlink_status(path, error);
            if (error)
            {
                if (!std::filesystem::exists(path))
                {
                    return true;
                }

                failure = "could not inspect existing launch cache path " + toUtf8(path.wstring()) +
                    " (" + filesystemErrorForLog(error) + ")";
                return false;
            }

            if (!std::filesystem::exists(status))
            {
                return true;
            }

            if (std::filesystem::is_directory(status) && !std::filesystem::is_symlink(status))
            {
                std::filesystem::remove_all(path, error);
            }
            else
            {
                std::filesystem::remove(path, error);
            }

            if (error)
            {
                failure = "could not remove stale launch cache path " + toUtf8(path.wstring()) +
                    " (" + filesystemErrorForLog(error) + ")";
                return false;
            }

            return true;
        }

        bool removeStaleRootBuilderLaunchCacheFiles(
            const std::filesystem::path& cacheRoot,
            const std::filesystem::path& manifestPath,
            const RootBuilderLaunchCacheDesiredState& state,
            RootBuilderLaunchCacheApplyStats& stats,
            std::string& failure)
        {
            if (!isDirectory(cacheRoot))
            {
                return true;
            }

            const PathSafetyService pathSafety;
            std::error_code error;
            std::filesystem::recursive_directory_iterator iterator(
                cacheRoot,
                std::filesystem::directory_options::skip_permission_denied,
                error);
            const std::filesystem::recursive_directory_iterator end;
            if (error)
            {
                failure = "could not enumerate launch cache " + toUtf8(cacheRoot.wstring()) +
                    " (" + filesystemErrorForLog(error) + ")";
                return false;
            }

            while (!error && iterator != end)
            {
                const std::filesystem::path current = iterator->path();
                if (comparablePathText(current) == comparablePathText(manifestPath))
                {
                    iterator.increment(error);
                    continue;
                }

                error.clear();
                const bool isFile = iterator->is_regular_file(error);
                if (error)
                {
                    failure = "could not inspect launch cache path " + toUtf8(current.wstring()) +
                        " (" + filesystemErrorForLog(error) + ")";
                    return false;
                }

                if (isFile)
                {
                    const std::optional<std::filesystem::path> relative =
                        relativePathIfInsideLexical(current, cacheRoot);
                    if (!relative.has_value() ||
                        state.files.find(rootBuilderLaunchCacheRelativeKey(relative.value())) == state.files.end())
                    {
                        const PathSafetyResult destinationSafety =
                            pathSafety.validateWritePath(cacheRoot, current);
                        if (!destinationSafety.safe())
                        {
                            failure = "unsafe stale launch cache path " + toUtf8(current.wstring()) +
                                " (" + pathSafetyErrorForLog(destinationSafety) + ")";
                            return false;
                        }

                        if (!removeExistingRootBuilderLaunchCachePath(current, failure))
                        {
                            return false;
                        }
                        ++stats.deletedFiles;
                    }
                }

                iterator.increment(error);
            }

            if (error)
            {
                failure = "could not continue enumerating launch cache " + toUtf8(cacheRoot.wstring()) +
                    " (" + filesystemErrorForLog(error) + ")";
                return false;
            }

            return true;
        }

        bool removeStaleRootBuilderLaunchCacheDirectories(
            const std::filesystem::path& cacheRoot,
            const RootBuilderLaunchCacheDesiredState& state,
            RootBuilderLaunchCacheApplyStats& stats,
            std::string& failure)
        {
            if (!isDirectory(cacheRoot))
            {
                return true;
            }

            std::vector<std::filesystem::path> directories;
            std::error_code error;
            std::filesystem::recursive_directory_iterator iterator(
                cacheRoot,
                std::filesystem::directory_options::skip_permission_denied,
                error);
            const std::filesystem::recursive_directory_iterator end;
            while (!error && iterator != end)
            {
                error.clear();
                if (iterator->is_directory(error))
                {
                    directories.push_back(iterator->path());
                }
                if (error)
                {
                    failure = "could not inspect launch cache directory " +
                        toUtf8(iterator->path().wstring()) +
                        " (" + filesystemErrorForLog(error) + ")";
                    return false;
                }
                iterator.increment(error);
            }
            if (error)
            {
                failure = "could not continue enumerating launch cache directories under " +
                    toUtf8(cacheRoot.wstring()) + " (" + filesystemErrorForLog(error) + ")";
                return false;
            }

            std::sort(
                directories.begin(),
                directories.end(),
                [](const std::filesystem::path& left, const std::filesystem::path& right)
                {
                    return left.wstring().size() > right.wstring().size();
                });

            for (const std::filesystem::path& directory : directories)
            {
                const std::optional<std::filesystem::path> relative =
                    relativePathIfInsideLexical(directory, cacheRoot);
                if (!relative.has_value() || relative->empty())
                {
                    continue;
                }

                if (state.directories.find(rootBuilderLaunchCacheRelativeKey(relative.value())) !=
                    state.directories.end())
                {
                    continue;
                }

                error.clear();
                if (std::filesystem::is_empty(directory, error))
                {
                    std::filesystem::remove(directory, error);
                    if (!error)
                    {
                        ++stats.deletedDirectories;
                    }
                }
                if (error && std::filesystem::exists(directory))
                {
                    failure = "could not remove stale launch cache directory " +
                        toUtf8(directory.wstring()) + " (" + filesystemErrorForLog(error) + ")";
                    return false;
                }
            }

            return true;
        }

        bool copyRootBuilderLaunchCacheFile(
            const std::filesystem::path& cacheRoot,
            const RootBuilderLaunchCacheDesiredFile& desired,
            std::string& failure)
        {
            const PathSafetyService pathSafety;
            const std::filesystem::path destination = cacheRoot / desired.relativePath;
            PathSafetyWriteOptions writeOptions;
            writeOptions.requiredBytes = desired.stamp.size;
            const PathSafetyResult destinationSafety =
                pathSafety.validateWritePath(cacheRoot, destination, writeOptions);
            if (!destinationSafety.safe())
            {
                failure = "unsafe launch cache destination " + toUtf8(destination.wstring()) +
                    " (" + pathSafetyErrorForLog(destinationSafety) + ")";
                return false;
            }

            std::error_code error;
            std::filesystem::create_directories(destination.parent_path(), error);
            if (error)
            {
                failure = "could not create launch cache directory " +
                    toUtf8(destination.parent_path().wstring()) +
                    " (" + filesystemErrorForLog(error) + ")";
                return false;
            }

            if (!removeExistingRootBuilderLaunchCachePath(destination, failure))
            {
                return false;
            }

            std::filesystem::copy_file(desired.sourcePath, destination, std::filesystem::copy_options::none, error);
            if (error)
            {
                failure = "could not copy " + toUtf8(desired.sourcePath.wstring()) +
                    " to " + toUtf8(destination.wstring()) +
                    " (" + filesystemErrorForLog(error) + ")";
                return false;
            }

            error.clear();
            std::filesystem::last_write_time(
                destination,
                std::filesystem::file_time_type(
                    std::filesystem::file_time_type::duration(desired.stamp.modifiedTicks)),
                error);
            if (error)
            {
                failure = "could not stamp launch cache file " + toUtf8(destination.wstring()) +
                    " (" + filesystemErrorForLog(error) + ")";
                return false;
            }

            return true;
        }

        bool synchronizeRootBuilderLaunchCache(
            const std::filesystem::path& cacheRoot,
            const std::filesystem::path& manifestPath,
            const RootBuilderLaunchCacheDesiredState& state,
            const std::optional<RootBuilderLaunchCacheManifest>& previousManifest,
            RootBuilderLaunchCacheApplyStats& stats,
            std::string& failure)
        {
            if (!removeStaleRootBuilderLaunchCacheFiles(cacheRoot, manifestPath, state, stats, failure))
            {
                return false;
            }

            std::error_code error;
            for (const auto& [key, directory] : state.directories)
            {
                static_cast<void>(key);
                const std::filesystem::path destination = cacheRoot / directory;
                const PathSafetyResult destinationSafety =
                    PathSafetyService().validateWritePath(cacheRoot, destination);
                if (!destinationSafety.safe())
                {
                    failure = "unsafe launch cache directory " + toUtf8(destination.wstring()) +
                        " (" + pathSafetyErrorForLog(destinationSafety) + ")";
                    return false;
                }

                std::filesystem::create_directories(destination, error);
                if (error)
                {
                    failure = "could not create launch cache directory " +
                        toUtf8(destination.wstring()) +
                        " (" + filesystemErrorForLog(error) + ")";
                    return false;
                }
            }

            for (const auto& [key, desired] : state.files)
            {
                bool reusable = false;
                if (previousManifest.has_value())
                {
                    const auto previous = previousManifest->files.find(key);
                    reusable = previous != previousManifest->files.end() &&
                        sameRootBuilderLaunchCacheManifestFile(previous->second, desired) &&
                        rootBuilderLaunchCacheDestinationLooksReusable(cacheRoot / desired.relativePath, desired);
                }

                if (reusable)
                {
                    ++stats.reusedFiles;
                    continue;
                }

                if (!copyRootBuilderLaunchCacheFile(cacheRoot, desired, failure))
                {
                    return false;
                }
                ++stats.copiedFiles;
            }

            if (!removeStaleRootBuilderLaunchCacheDirectories(cacheRoot, state, stats, failure))
            {
                return false;
            }

            try
            {
                writeRootBuilderLaunchCacheManifest(manifestPath, state);
            }
            catch (const std::exception& exception)
            {
                failure = "could not write launch cache manifest " + toUtf8(manifestPath.wstring()) +
                    " (" + exception.what() + ")";
                return false;
            }

            return true;
        }

        std::optional<RootBuilderBackingLocation> rootBuilderBackingLocation(
            const ProjectExecutableContext& context,
            const std::filesystem::path& backingPath)
        {
            if (!supportsRootBuilder(context))
            {
                return std::nullopt;
            }

            for (const std::filesystem::path& mod : activeProfileModPaths(context))
            {
                const std::filesystem::path root = rootBuilderDirectory(context, mod);
                const std::optional<std::filesystem::path> relative =
                    relativePathIfInsideLexical(backingPath, root);
                if (relative.has_value() && isUsableRelativePath(relative.value()))
                {
                    return RootBuilderBackingLocation{
                        mod,
                        root,
                        relative.value()
                    };
                }
            }

            if (!context.overwriteDirectory.empty())
            {
                const std::filesystem::path root = rootBuilderDirectory(context, context.overwriteDirectory);
                const std::optional<std::filesystem::path> relative =
                    relativePathIfInsideLexical(backingPath, root);
                if (relative.has_value() && isUsableRelativePath(relative.value()))
                {
                    return RootBuilderBackingLocation{
                        context.overwriteDirectory,
                        root,
                        relative.value()
                    };
                }
            }

            return std::nullopt;
        }

        std::optional<RootBuilderLaunchCache> prepareRootBuilderLaunchCache(
            const ProjectExecutableContext& context,
            const std::filesystem::path& backingPath,
            Logger& logger)
        {
            const std::optional<RootBuilderBackingLocation> location =
                rootBuilderBackingLocation(context, backingPath);
            if (!location.has_value())
            {
                return std::nullopt;
            }

            const PathSafetyService pathSafety;
            const PathSafetyResult backingSafety =
                pathSafety.validateContainedPath(location->rootDirectory, backingPath);
            if (!backingSafety.safe())
            {
                logger.write(
                    LogLevel::Warning,
                    "Root Builder launch cache refused unsafe backing executable: " +
                        toUtf8(backingPath.wstring()) + " (" + pathSafetyErrorForLog(backingSafety) + ").");
                return std::nullopt;
            }

            const PathSafetyResult relativeSafety =
                pathSafety.validateRelativePath(location->relativePath);
            if (!relativeSafety.safe())
            {
                logger.write(
                    LogLevel::Warning,
                    "Root Builder launch cache refused unsafe backing relative path: " +
                        toUtf8(location->relativePath.wstring()) + " (" +
                        pathSafetyErrorForLog(relativeSafety) + ").");
                return std::nullopt;
            }

            const bool executableIsUnderData =
                !context.dataDirectory.empty() &&
                firstPathComponentEquals(location->relativePath, context.dataDirectory);
            const std::filesystem::path cacheRoot =
                context.projectDirectory /
                L".flow" /
                L"root-launch" /
                safeDirectoryName(location->modDirectory.filename().wstring());
            const PathSafetyResult cacheRootSafety =
                pathSafety.validateWritePath(context.projectDirectory, cacheRoot);
            if (!cacheRootSafety.safe())
            {
                logger.write(
                    LogLevel::Warning,
                    "Root Builder launch cache refused unsafe cache directory: " +
                        toUtf8(cacheRoot.wstring()) + " (" + pathSafetyErrorForLog(cacheRootSafety) + ").");
                return std::nullopt;
            }

            std::string failure;
            const std::optional<RootBuilderLaunchCacheDesiredState> desiredState =
                collectRootBuilderLaunchCacheDesiredState(
                    context,
                    location.value(),
                    executableIsUnderData,
                    failure);
            if (!desiredState.has_value())
            {
                logger.write(
                    LogLevel::Warning,
                    "Root Builder launch cache could not be prepared: " + failure + ".");
                return std::nullopt;
            }

            std::error_code error;
            const bool cacheRootExisted = std::filesystem::exists(cacheRoot, error);
            if (error)
            {
                logger.write(
                    LogLevel::Warning,
                    "Root Builder launch cache directory could not be inspected: " +
                        toUtf8(cacheRoot.wstring()) + " (" + filesystemErrorForLog(error) + ").");
                return std::nullopt;
            }

            error.clear();
            std::filesystem::create_directories(cacheRoot, error);
            if (error)
            {
                logger.write(
                    LogLevel::Warning,
                    "Root Builder launch cache directory could not be created: " +
                        toUtf8(cacheRoot.wstring()) + " (" + filesystemErrorForLog(error) + ").");
                return std::nullopt;
            }

            const std::filesystem::path manifestPath = rootBuilderLaunchCacheManifestPath(cacheRoot);
            RootBuilderLaunchCacheManifestReadResult manifestRead =
                readRootBuilderLaunchCacheManifest(manifestPath, logger);
            RootBuilderLaunchCacheApplyStats stats;
            if (manifestRead.status == RootBuilderLaunchCacheManifestStatus::Corrupt ||
                (manifestRead.status == RootBuilderLaunchCacheManifestStatus::Missing && cacheRootExisted))
            {
                stats.rebuilt = true;
                const std::string rebuildReason =
                    manifestRead.status == RootBuilderLaunchCacheManifestStatus::Corrupt
                        ? ("manifest was invalid: " + manifestRead.reason)
                        : "manifest was missing";
                logger.write(
                    LogLevel::Info,
                    "Root Builder launch cache will be rebuilt because " + rebuildReason + ".");

                std::filesystem::remove_all(cacheRoot, error);
                if (error)
                {
                    logger.write(
                        LogLevel::Warning,
                        "Root Builder launch cache could not be cleared for rebuild: " +
                            toUtf8(cacheRoot.wstring()) + " (" + filesystemErrorForLog(error) + ").");
                    return std::nullopt;
                }

                error.clear();
                std::filesystem::create_directories(cacheRoot, error);
                if (error)
                {
                    logger.write(
                        LogLevel::Warning,
                        "Root Builder launch cache directory could not be recreated: " +
                            toUtf8(cacheRoot.wstring()) + " (" + filesystemErrorForLog(error) + ").");
                    return std::nullopt;
                }

                manifestRead = RootBuilderLaunchCacheManifestReadResult{};
            }

            stats.revisionChanged = manifestRead.manifest.has_value() &&
                manifestRead.manifest->revision != desiredState->revision;
            if (desiredState->materializedEarlyDataRoots > 0)
            {
                logger.write(
                    LogLevel::Info,
                    "Root Builder launch cache materialized early Data runtime directories: " +
                        std::to_string(desiredState->materializedEarlyDataRoots) + ".");
            }

            if (!synchronizeRootBuilderLaunchCache(
                cacheRoot,
                manifestPath,
                desiredState.value(),
                manifestRead.manifest,
                stats,
                failure))
            {
                logger.write(
                    LogLevel::Warning,
                    "Root Builder launch cache could not be prepared: " + failure + ".");
                error.clear();
                std::filesystem::remove_all(cacheRoot, error);
                return std::nullopt;
            }

            logger.write(
                LogLevel::Info,
                "Root Builder launch cache synchronized: copiedFiles=" +
                    std::to_string(stats.copiedFiles) +
                    ", reusedFiles=" +
                    std::to_string(stats.reusedFiles) +
                    ", deletedFiles=" +
                    std::to_string(stats.deletedFiles) +
                    ", deletedDirectories=" +
                    std::to_string(stats.deletedDirectories) +
                    ", rebuilt=" +
                    std::to_string(stats.rebuilt ? 1 : 0) +
                    ", revisionChanged=" +
                    std::to_string(stats.revisionChanged ? 1 : 0) + ".");

            const std::filesystem::path cachedExecutable = cacheRoot / location->relativePath;
            if (!isReadableExecutableFile(cachedExecutable))
            {
                logger.write(
                    LogLevel::Warning,
                    "Root Builder launch cache did not contain a readable executable: " +
                        toUtf8(cachedExecutable.wstring()) + ".");
                error.clear();
                std::filesystem::remove_all(cacheRoot, error);
                return std::nullopt;
            }

            std::error_code sourceSizeError;
            std::error_code cachedSizeError;
            const std::uintmax_t sourceSize = std::filesystem::file_size(backingPath, sourceSizeError);
            const std::uintmax_t cachedSize = std::filesystem::file_size(cachedExecutable, cachedSizeError);
            if (sourceSizeError || cachedSizeError || sourceSize != cachedSize)
            {
                logger.write(
                    LogLevel::Warning,
                    "Root Builder launch cache executable failed validation: source=\"" +
                        toUtf8(backingPath.wstring()) +
                        "\", cached=\"" +
                        toUtf8(cachedExecutable.wstring()) +
                        "\", sourceSize=" +
                        std::to_string(sourceSize) +
                        ", cachedSize=" +
                        std::to_string(cachedSize) +
                        ", sourceError=(" +
                        filesystemErrorForLog(sourceSizeError) +
                        "), cachedError=(" +
                        filesystemErrorForLog(cachedSizeError) +
                        ").");
                error.clear();
                std::filesystem::remove_all(cacheRoot, error);
                return std::nullopt;
            }

            return RootBuilderLaunchCache{
                std::filesystem::absolute(cachedExecutable),
                std::filesystem::absolute(cacheRoot)
            };
        }

        std::optional<std::wstring> defaultGameExecutableName(
            const ProjectExecutableContext& context)
        {
            std::vector<std::wstring> candidateNames;
            if (context.executableRules.has_value())
            {
                if (context.executableRules->roles.primary.has_value())
                {
                    candidateNames.push_back(context.executableRules->roles.primary->displayName());
                }
                for (const GameExecutableDefinition& executable : context.executableRules->executables)
                {
                    if (executable.role == GameExecutableRole::Primary ||
                        executable.role == GameExecutableRole::Launcher)
                    {
                        candidateNames.push_back(executable.name.displayName());
                    }
                }
            }

            std::set<std::wstring> seen;
            for (const std::wstring& candidateName : candidateNames)
            {
                if (!seen.insert(toLower(candidateName)).second)
                {
                    continue;
                }

                if (isRegularFile(context.gamePath / std::filesystem::path(candidateName)))
                {
                    return candidateName;
                }
            }

            return std::nullopt;
        }

        std::wstring defaultGameExecutableDisplayName(
            const ProjectExecutableContext& context,
            std::wstring_view executableName)
        {
            if (context.executableRules.has_value())
            {
                for (const GameExecutableDefinition& executable : context.executableRules->executables)
                {
                    if (equalsIgnoreCase(executable.name.displayName(), executableName) &&
                        !executable.displayName.empty())
                    {
                        return executable.displayName;
                    }
                }
            }

            return fileNameWithoutExtension(std::wstring(executableName));
        }

        std::optional<GameExecutable> defaultGameExecutable(
            const ProjectExecutableContext& context)
        {
            const std::optional<std::wstring> executableName = defaultGameExecutableName(context);
            if (!executableName.has_value())
            {
                return std::nullopt;
            }

            return GameExecutable{
                L"game",
                defaultGameExecutableDisplayName(context, executableName.value()),
                executableName.value(),
                {},
                {}
            };
        }

        const GameExecutableDefinition* matchingExecutableDefinition(
            const ProjectExecutableContext& context,
            const GameExecutable& executable,
            const std::filesystem::path& resolvedExecutablePath)
        {
            if (!context.executableRules.has_value())
            {
                return nullptr;
            }

            const std::wstring configuredFileName =
                std::filesystem::path(executable.executablePath).filename().wstring();
            const std::wstring resolvedFileName = resolvedExecutablePath.filename().wstring();
            for (const GameExecutableDefinition& definition : context.executableRules->executables)
            {
                if (!definition.id.empty() && equalsIgnoreCase(definition.id, executable.id))
                {
                    return &definition;
                }
                if (!configuredFileName.empty() &&
                    equalsIgnoreCase(configuredFileName, definition.name.displayName()))
                {
                    return &definition;
                }
                if (!resolvedFileName.empty() &&
                    equalsIgnoreCase(resolvedFileName, definition.name.displayName()))
                {
                    return &definition;
                }
            }

            return nullptr;
        }

        std::optional<GameExecutableWorkingDirectoryKind> workingDirectoryKindForExecutable(
            const ProjectExecutableContext& context,
            const GameExecutable& executable,
            const std::filesystem::path& resolvedExecutablePath)
        {
            const GameExecutableDefinition* definition =
                matchingExecutableDefinition(context, executable, resolvedExecutablePath);
            if (definition == nullptr)
            {
                return std::nullopt;
            }

            return definition->workingDirectory;
        }

        struct LaunchTrackingMetadata
        {
            LaunchTrackingKind kind{LaunchTrackingKind::DirectProcess};
            std::vector<std::wstring> expectedChildProcessNames;
            std::wstring handoffDisplayName;
            std::uint32_t handoffTimeoutMs{0};
        };

        LaunchTrackingMetadata launchTrackingMetadataForExecutable(
            const ProjectExecutableContext& context,
            const GameExecutable& executable,
            const std::filesystem::path& resolvedExecutablePath)
        {
            if (!isScriptExtenderLoaderName(context, resolvedExecutablePath) ||
                !context.launchRules.has_value() ||
                !context.launchRules->rules.scriptExtender.has_value())
            {
                return {};
            }

            const GameScriptExtenderRules& rules = context.launchRules->rules.scriptExtender.value();
            LaunchTrackingMetadata metadata;
            metadata.kind = rules.launchTrackingKind;
            metadata.expectedChildProcessNames.reserve(rules.expectedChildProcessNames.size());
            for (const ExecutableName& expected : rules.expectedChildProcessNames)
            {
                metadata.expectedChildProcessNames.push_back(expected.displayName());
            }
            metadata.handoffDisplayName = rules.handoffDisplayName.empty()
                ? rules.name
                : rules.handoffDisplayName;
            metadata.handoffTimeoutMs = rules.handoffTimeoutMs;

            (void)executable;
            return metadata;
        }

        bool hasExecutablePath(
            const std::vector<GameExecutable>& executables,
            std::wstring_view executablePath)
        {
            for (const GameExecutable& executable : executables)
            {
                if (equalsIgnoreCase(executable.executablePath, executablePath))
                {
                    return true;
                }
            }

            return false;
        }

        std::wstring slugifyExecutableId(const GameExecutable& executable, int fallbackIndex)
        {
            std::wstring source = trim(executable.id);
            if (source.empty())
            {
                source = trim(executable.displayName);
            }
            if (source.empty())
            {
                source = fileNameWithoutExtension(executable.executablePath);
            }
            if (source.empty())
            {
                source = L"executable-" + std::to_wstring(fallbackIndex + 1);
            }

            std::wstring id;
            bool previousWasDash = false;
            for (wchar_t character : source)
            {
                const wchar_t lower = static_cast<wchar_t>(std::towlower(character));
                if ((lower >= L'a' && lower <= L'z') || (lower >= L'0' && lower <= L'9'))
                {
                    id.push_back(lower);
                    previousWasDash = false;
                    continue;
                }

                if (!previousWasDash)
                {
                    id.push_back(L'-');
                    previousWasDash = true;
                }
            }

            while (!id.empty() && id.front() == L'-')
            {
                id.erase(id.begin());
            }
            while (!id.empty() && id.back() == L'-')
            {
                id.pop_back();
            }

            return id.empty() ? L"executable-" + std::to_wstring(fallbackIndex + 1) : id;
        }

        std::vector<GameExecutable> normalizeExecutables(const std::vector<GameExecutable>& executables)
        {
            std::vector<GameExecutable> normalized;
            normalized.reserve(executables.size());

            std::map<std::wstring, int> idCounts;
            for (int index = 0; index < static_cast<int>(executables.size()); ++index)
            {
                GameExecutable executable = executables[static_cast<std::size_t>(index)];
                executable.id = trim(executable.id);
                executable.displayName = trim(executable.displayName);
                executable.executablePath = trim(executable.executablePath);
                executable.arguments = trim(executable.arguments);
                executable.workingDirectory = trim(executable.workingDirectory);

                if (executable.executablePath.empty())
                {
                    throw std::invalid_argument("Executable path is required.");
                }
                if (!hasExecutableExtension(executable.executablePath))
                {
                    throw std::invalid_argument("Executable path must point to an .exe file.");
                }
                if (executable.displayName.empty())
                {
                    executable.displayName = fileNameWithoutExtension(executable.executablePath);
                }

                std::wstring baseId = slugifyExecutableId(executable, index);
                int& count = idCounts[baseId];
                ++count;
                executable.id = count == 1 ? baseId : baseId + L"-" + std::to_wstring(count);

                normalized.push_back(std::move(executable));
            }

            return normalized;
        }

        std::vector<GameExecutable> withDefaultGameExecutable(
            const ProjectExecutableContext& context,
            std::vector<GameExecutable> executables)
        {
            if (const std::optional<GameExecutable> defaultExecutable = defaultGameExecutable(context);
                defaultExecutable.has_value() &&
                !hasExecutablePath(executables, defaultExecutable->executablePath))
            {
                executables.insert(executables.begin(), defaultExecutable.value());
            }

            return normalizeExecutables(executables);
        }

        GameExecutable readExecutableObject(const JsonValue& value, int index)
        {
            if (!value.isObject())
            {
                throw std::invalid_argument("Executable entry must be an object.");
            }

            GameExecutable executable{
                readStringOrDefault(value, L"id"),
                readStringOrDefault(value, L"displayName"),
                readStringOrDefault(value, L"executablePath"),
                readStringOrDefault(value, L"arguments"),
                readStringOrDefault(value, L"workingDirectory")
            };

            if (executable.executablePath.empty())
            {
                executable.executablePath = readStringOrDefault(value, L"path");
            }
            if (executable.displayName.empty())
            {
                executable.displayName = readStringOrDefault(value, L"name");
            }
            if (executable.id.empty())
            {
                executable.id = L"executable-" + std::to_wstring(index + 1);
            }

            return executable;
        }

        std::vector<GameExecutable> readExecutablesFromManifest(const JsonValue& manifest)
        {
            if (const JsonValue* launchExecutables = manifest.find(launchExecutablesField);
                launchExecutables != nullptr && !launchExecutables->isNull())
            {
                if (!launchExecutables->isArray())
                {
                    throw std::invalid_argument("Build config launch executables must be an array.");
                }

                std::vector<GameExecutable> executables;
                int index = 0;
                for (const JsonValue& item : launchExecutables->asArray())
                {
                    executables.push_back(readExecutableObject(item, index));
                    ++index;
                }

                return normalizeExecutables(executables);
            }

            return {};
        }

        void writeExecutable(JsonWriter& writer, const GameExecutable& executable)
        {
            writer.beginObject();
            writer.field(L"id", executable.id);
            writer.field(L"displayName", executable.displayName);
            writer.field(L"executablePath", executable.executablePath);
            writer.field(L"arguments", executable.arguments);
            writer.field(L"workingDirectory", executable.workingDirectory);
            writer.endObject();
        }

        void writeExecutablesArray(JsonWriter& writer, const std::vector<GameExecutable>& executables)
        {
            writer.beginArray();
            for (const GameExecutable& executable : executables)
            {
                writeExecutable(writer, executable);
            }
            writer.endArray();
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
                for (const auto& [key, child] : value.asObject())
                {
                    writer.key(key);
                    writeJsonValue(writer, child);
                }
                writer.endObject();
                break;
            case JsonValue::Type::Array:
                writer.beginArray();
                for (const JsonValue& child : value.asArray())
                {
                    writeJsonValue(writer, child);
                }
                writer.endArray();
                break;
            }
        }

        void writeManifestWithExecutables(
            const ProjectExecutableContext& context,
            const std::vector<GameExecutable>& executables)
        {
            JsonWriter writer;
            writer.beginObject();
            for (const auto& [key, value] : context.manifest.asObject())
            {
                if (key == launchExecutablesField)
                {
                    continue;
                }

                writer.key(key);
                writeJsonValue(writer, value);
            }

            writer.key(launchExecutablesField);
            writeExecutablesArray(writer, executables);
            writer.endObject();

            writeProjectManifest(context.configPath, toUtf8(writer.str()));
        }

        std::optional<std::filesystem::path> tryResolveExistingFile(
            const ProjectExecutableContext& context,
            const std::wstring& pathText)
        {
            std::filesystem::path path(pathText);
            if (const std::optional<std::filesystem::path> rootBuilderFile =
                    rootBuilderBackingFile(context, path);
                rootBuilderFile.has_value())
            {
                return rootBuilderFile.value();
            }

            if (const std::optional<std::filesystem::path> scriptExtenderLoader =
                    gameRootScriptExtenderLoader(context, path);
                scriptExtenderLoader.has_value())
            {
                return scriptExtenderLoader.value();
            }

            std::vector<std::filesystem::path> candidates;

            if (path.is_absolute())
            {
                candidates.push_back(path);
                if (!context.gamePath.empty())
                {
                    candidates.push_back(context.gamePath / path.filename());
                }
            }
            else
            {
                if (!context.gamePath.empty())
                {
                    candidates.push_back(context.gamePath / path);
                }
                if (!context.projectDirectory.empty())
                {
                    candidates.push_back(context.projectDirectory / path);
                }
                candidates.push_back(context.manifestDirectory / path);
                candidates.push_back(path);
            }

            for (const auto& candidate : candidates)
            {
                if (isReadableExecutableFile(candidate))
                {
                    return std::filesystem::absolute(candidate);
                }
            }

            return std::nullopt;
        }

        std::filesystem::path resolveExistingFile(
            const ProjectExecutableContext& context,
            const std::wstring& pathText)
        {
            if (const std::optional<std::filesystem::path> resolved = tryResolveExistingFile(context, pathText))
            {
                return *resolved;
            }

            throw std::invalid_argument("Executable file does not exist or is not a readable Windows executable.");
        }

        void resolveExecutableIconPaths(
            const ProjectExecutableContext& context,
            const ExecutableIconService& iconService,
            std::vector<GameExecutable>& executables)
        {
            for (GameExecutable& executable : executables)
            {
                executable.iconPath.clear();
                const std::optional<std::filesystem::path> resolvedPath =
                    tryResolveExistingFile(context, executable.executablePath);
                if (!resolvedPath.has_value())
                {
                    continue;
                }

                executable.iconPath = iconService.resolveIconPath(*resolvedPath).wstring();
            }
        }

        std::filesystem::path resolveWorkingDirectory(
            const ProjectExecutableContext& context,
            const GameExecutable& executable,
            const std::filesystem::path& resolvedExecutablePath)
        {
            if (executable.workingDirectory.empty())
            {
                return resolvedExecutablePath.parent_path();
            }

            std::filesystem::path path(executable.workingDirectory);
            std::vector<std::filesystem::path> candidates;
            if (path.is_absolute())
            {
                candidates.push_back(path);
                if (!context.gamePath.empty() &&
                    equalsIgnoreCase(path.filename().wstring(), context.gamePath.filename().wstring()))
                {
                    candidates.push_back(context.gamePath);
                }
            }
            else
            {
                if (!context.gamePath.empty())
                {
                    candidates.push_back(context.gamePath / path);
                }
                if (!context.projectDirectory.empty())
                {
                    candidates.push_back(context.projectDirectory / path);
                }
                candidates.push_back(context.manifestDirectory / path);
            }

            for (const auto& candidate : candidates)
            {
                if (isDirectory(candidate))
                {
                    return std::filesystem::absolute(candidate);
                }
            }

            throw std::invalid_argument("Executable working directory does not exist.");
        }

        std::wstring quoteCommandLineArgument(const std::wstring& value)
        {
            std::wstring quoted = L"\"";
            for (wchar_t character : value)
            {
                if (character == L'"')
                {
                    quoted.push_back(L'\\');
                }
                quoted.push_back(character);
            }
            quoted.push_back(L'"');
            return quoted;
        }

        [[nodiscard]] std::string joinExecutableNames(const std::vector<std::wstring>& values)
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

        [[nodiscard]] std::string executableRulesSummary(const ProjectExecutableContext& context)
        {
            if (!context.executableRules.has_value())
            {
                return "<none>";
            }

            std::string summary = "executables=" +
                std::to_string(context.executableRules->executables.size());
            if (context.executableRules->roles.primary.has_value())
            {
                summary += ";primary=" +
                    toUtf8(context.executableRules->roles.primary->displayName());
            }
            if (context.executableRules->roles.scriptExtender.has_value())
            {
                summary += ";scriptExtender=" +
                    toUtf8(context.executableRules->roles.scriptExtender->displayName());
            }
            return summary;
        }

        [[nodiscard]] std::string launchRulesSummary(
            const ProjectExecutableContext& context,
            const LaunchTrackingMetadata& tracking)
        {
            std::string summary =
                "trackingKind=" + toUtf8(launchTrackingKindName(tracking.kind)) +
                ";expectedChildren=" + joinExecutableNames(tracking.expectedChildProcessNames) +
                ";handoffDisplayName=" + toUtf8(tracking.handoffDisplayName) +
                ";handoffTimeoutMs=" + std::to_string(tracking.handoffTimeoutMs);
            if (context.launchRules.has_value() &&
                context.launchRules->rules.scriptExtender.has_value())
            {
                const GameScriptExtenderRules& scriptExtender =
                    context.launchRules->rules.scriptExtender.value();
                summary += ";scriptExtenderLoader=" +
                    toUtf8(scriptExtender.loaderExecutable.displayName());
            }
            return summary;
        }
    }

    ExecutableService::ExecutableService(
        Logger& logger,
        ExecutableIconService& iconService,
        const BuildPathSettingsService& pathSettings) noexcept
        : logger_(logger),
          iconService_(iconService),
          pathSettings_(pathSettings)
    {
    }

    void ExecutableService::initialize()
    {
        if (initialized_)
        {
            return;
        }

        initialized_ = true;
        logger_.write(LogLevel::Info, "Executable service initialized.");
    }

    void ExecutableService::shutdown()
    {
        if (!initialized_)
        {
            return;
        }

        initialized_ = false;
        logger_.write(LogLevel::Info, "Executable service shut down.");
    }

    std::vector<GameExecutable> ExecutableService::listProjectExecutables(
        const std::filesystem::path& configPath) const
    {
        ProjectExecutableContext context = readProjectExecutableContext(configPath, &logger_);
        const BuildPathSettings settings = pathSettings_.loadForConfig(configPath);
        context.gamePath = settings.gameDirectory;
        context.modsDirectory = settings.modsDirectory;
        context.overwriteDirectory = settings.overwriteDirectory;
        std::vector<GameExecutable> executables =
            withDefaultGameExecutable(context, readExecutablesFromManifest(context.manifest));
        resolveExecutableIconPaths(context, iconService_, executables);
        return executables;
    }

    std::vector<GameExecutable> ExecutableService::saveProjectExecutables(
        const std::filesystem::path& configPath,
        const std::vector<GameExecutable>& executables) const
    {
        ProjectExecutableContext context = readProjectExecutableContext(configPath, &logger_);
        const BuildPathSettings settings = pathSettings_.loadForConfig(configPath);
        context.gamePath = settings.gameDirectory;
        context.modsDirectory = settings.modsDirectory;
        context.overwriteDirectory = settings.overwriteDirectory;
        std::vector<GameExecutable> normalized = normalizeExecutables(executables);
        writeManifestWithExecutables(context, normalized);
        resolveExecutableIconPaths(context, iconService_, normalized);
        logger_.write(LogLevel::Info, "Project executable list updated.");
        return normalized;
    }

    ResolvedExecutableLaunch ExecutableService::resolveExecutable(
        const std::filesystem::path& configPath,
        std::wstring_view executableId,
        std::wstring_view profileName) const
    {
        if (executableId.empty())
        {
            throw std::invalid_argument("Executable id is required.");
        }

        ProjectExecutableContext context = readProjectExecutableContext(configPath, &logger_);
        if (!profileName.empty())
        {
            context.defaultProfile = std::wstring(profileName);
        }
        const BuildPathSettings settings = pathSettings_.loadForConfig(configPath);
        context.gamePath = settings.gameDirectory;
        context.modsDirectory = settings.modsDirectory;
        context.overwriteDirectory = settings.overwriteDirectory;
        std::vector<GameExecutable> executables =
            withDefaultGameExecutable(context, readExecutablesFromManifest(context.manifest));
        resolveExecutableIconPaths(context, iconService_, executables);
        const auto match = std::find_if(
            executables.begin(),
            executables.end(),
            [executableId](const GameExecutable& executable) { return executable.id == executableId; });
        if (match == executables.end())
        {
            throw std::invalid_argument("Executable was not found.");
        }

        std::filesystem::path resolvedExecutablePath = resolveExistingFile(context, match->executablePath);
        std::filesystem::path rootBuilderLaunchCacheDirectory;
        const std::optional<std::filesystem::path> rootBuilderVirtualPath =
            rootBuilderVirtualPathForBackingFile(context, resolvedExecutablePath);
        if (rootBuilderVirtualPath.has_value())
        {
            if (const std::optional<RootBuilderLaunchCache> cachedExecutable =
                    prepareRootBuilderLaunchCache(context, resolvedExecutablePath, logger_);
                cachedExecutable.has_value())
            {
                logger_.write(
                    LogLevel::Info,
                    "Prepared Root Builder launch cache: " + toUtf8(cachedExecutable->executablePath.wstring()));
                resolvedExecutablePath = cachedExecutable->executablePath;
                rootBuilderLaunchCacheDirectory = cachedExecutable->rootDirectory;
            }
            else
            {
                logger_.write(
                    LogLevel::Warning,
                    "Root Builder launch cache could not be prepared; launching backing executable directly: " +
                        toUtf8(resolvedExecutablePath.wstring()));
            }
        }

        if (!hasExecutableExtension(resolvedExecutablePath.wstring()))
        {
            throw std::invalid_argument("Executable path must point to an .exe file.");
        }

        const std::optional<GameExecutableWorkingDirectoryKind> workingDirectoryKind =
            workingDirectoryKindForExecutable(context, *match, resolvedExecutablePath);
        std::filesystem::path resolvedWorkingDir;
        if (!rootBuilderLaunchCacheDirectory.empty())
        {
            resolvedWorkingDir = rootBuilderLaunchCacheDirectory;
        }
        else if (rootBuilderVirtualPath.has_value() && !context.gamePath.empty())
        {
            resolvedWorkingDir = context.gamePath;
        }
        else if (workingDirectoryKind == GameExecutableWorkingDirectoryKind::GameRoot &&
            !context.gamePath.empty())
        {
            resolvedWorkingDir = context.gamePath;
        }
        else
        {
            resolvedWorkingDir = resolveWorkingDirectory(context, *match, resolvedExecutablePath);
        }

        std::wstring commandLine = quoteCommandLineArgument(resolvedExecutablePath.wstring());
        if (!match->arguments.empty())
        {
            commandLine.push_back(L' ');
            commandLine.append(match->arguments);
        }

        logger_.write(
            LogLevel::Info,
            "Resolved executable launch: exe=\"" + toUtf8(resolvedExecutablePath.wstring()) +
                "\", cwd=\"" + toUtf8(resolvedWorkingDir.wstring()) + "\".");

        const LaunchTrackingMetadata trackingMetadata =
            launchTrackingMetadataForExecutable(context, *match, resolvedExecutablePath);
        logger_.writeOperation(
            LogLevel::Info,
            "LaunchDiagnostics",
            "launchExecutable resolved selectedGameId=\"" + toUtf8(context.gameId.value()) +
                "\", definitionVersion=\"" + toUtf8(context.gameDefinitionVersion) +
                "\", executableId=\"" + toUtf8(match->id) +
                "\", executablePath=\"" + toUtf8(resolvedExecutablePath.wstring()) +
                "\", workingDirectory=\"" + toUtf8(resolvedWorkingDir.wstring()) +
                "\", appliedExecutableRules=\"" + executableRulesSummary(context) +
                "\", appliedLaunchRules=\"" + launchRulesSummary(context, trackingMetadata) + "\".");

        return ResolvedExecutableLaunch{
            *match,
            resolvedExecutablePath,
            resolvedWorkingDir,
            std::move(commandLine),
            context.gamePath,
            rootBuilderLaunchCacheDirectory,
            context.projectDirectory,
            context.gameId,
            context.gameDisplayName,
            context.gameDefinitionVersion,
            context.gameCapabilities,
            context.templateId,
            context.dataDirectory,
            context.defaultProfile,
            context.vfsRules,
            context.contentLayoutRules,
            trackingMetadata.kind,
            trackingMetadata.expectedChildProcessNames,
            trackingMetadata.handoffDisplayName,
            trackingMetadata.handoffTimeoutMs
        };
    }

    GameExecutableLaunchResult ExecutableService::launchProjectExecutable(
        const std::filesystem::path& configPath,
        std::wstring_view executableId,
        std::wstring_view profileName) const
    {
        const ResolvedExecutableLaunch resolved = resolveExecutable(configPath, executableId, profileName);
        logger_.writeOperation(
            LogLevel::Info,
            "LaunchDiagnostics",
            "launchExecutable starting selectedGameId=\"" + toUtf8(resolved.gameId.value()) +
                "\", definitionVersion=\"" + toUtf8(resolved.gameDefinitionVersion) +
                "\", executableId=\"" + toUtf8(resolved.executable.id) +
                "\", executablePath=\"" + toUtf8(resolved.resolvedExecutablePath.wstring()) +
                "\", workingDirectory=\"" + toUtf8(resolved.resolvedWorkingDirectory.wstring()) + "\".");

#ifdef _WIN32
        STARTUPINFOW startupInfo{};
        startupInfo.cb = sizeof(startupInfo);
        PROCESS_INFORMATION processInformation{};
        std::vector<wchar_t> commandLineBuffer(resolved.commandLine.begin(), resolved.commandLine.end());
        commandLineBuffer.push_back(L'\0');

        const BOOL started = CreateProcessW(
            resolved.resolvedExecutablePath.c_str(),
            commandLineBuffer.data(),
            nullptr,
            nullptr,
            FALSE,
            0,
            nullptr,
            resolved.resolvedWorkingDirectory.c_str(),
            &startupInfo,
            &processInformation);
        if (!started)
        {
            const DWORD error = GetLastError();
            logger_.writeOperation(
                LogLevel::Error,
                "LaunchDiagnostics",
                "launchExecutable failed selectedGameId=\"" + toUtf8(resolved.gameId.value()) +
                    "\", definitionVersion=\"" + toUtf8(resolved.gameDefinitionVersion) +
                    "\", executablePath=\"" + toUtf8(resolved.resolvedExecutablePath.wstring()) +
                    "\", workingDirectory=\"" + toUtf8(resolved.resolvedWorkingDirectory.wstring()) +
                    "\", reason=\"Win32 error: " + describeWin32Error(error) + "\".");
            throw std::runtime_error(
                "Failed to launch executable \"" + toUtf8(resolved.resolvedExecutablePath.wstring()) +
                    "\" from \"" + toUtf8(resolved.resolvedWorkingDirectory.wstring()) +
                    "\". Win32 error: " + describeWin32Error(error) + ".");
        }

        const DWORD processId = processInformation.dwProcessId;
        CloseHandle(processInformation.hThread);
        CloseHandle(processInformation.hProcess);
#else
        logger_.writeOperation(
            LogLevel::Error,
            "LaunchDiagnostics",
            "launchExecutable failed selectedGameId=\"" + toUtf8(resolved.gameId.value()) +
                "\", definitionVersion=\"" + toUtf8(resolved.gameDefinitionVersion) +
                "\", reason=\"Executable launching is only implemented on Windows.\".");
        throw std::runtime_error("Executable launching is only implemented on Windows.");
#endif

        logger_.write(LogLevel::Info, "Project executable launched.");
        logger_.writeOperation(
            LogLevel::Info,
            "LaunchDiagnostics",
            "launchExecutable completed selectedGameId=\"" + toUtf8(resolved.gameId.value()) +
                "\", definitionVersion=\"" + toUtf8(resolved.gameDefinitionVersion) +
                "\", executableId=\"" + toUtf8(resolved.executable.id) +
                "\", processId=" + std::to_string(
#ifdef _WIN32
                    static_cast<std::uint32_t>(processId)
#else
                    0
#endif
                ) +
                ", appliedLaunchRules=\"trackingKind=" +
                toUtf8(launchTrackingKindName(resolved.launchTrackingKind)) +
                ";expectedChildren=" + joinExecutableNames(resolved.expectedChildProcessNames) +
                ";handoffDisplayName=" + toUtf8(resolved.handoffDisplayName) +
                ";handoffTimeoutMs=" + std::to_string(resolved.handoffTimeoutMs) + "\".");
        return GameExecutableLaunchResult{
            resolved.executable,
            resolved.resolvedExecutablePath,
            resolved.resolvedWorkingDirectory,
            resolved.launchTrackingKind,
            resolved.expectedChildProcessNames,
            resolved.handoffDisplayName,
            resolved.handoffTimeoutMs,
#ifdef _WIN32
            static_cast<std::uint32_t>(processId)
#else
            0
#endif
        };
    }

    bool ExecutableService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
