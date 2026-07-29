#include "FluxoraCore/Services/LodGeneratorIntegrationService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <cwctype>
#include <fstream>
#include <iomanip>
#include <iterator>
#include <limits>
#include <set>
#include <sstream>
#include <system_error>
#include <utility>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <objbase.h>
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::wstring_view skyrimSeGameId = L"skyrimse";
        constexpr std::wstring_view texGenOutputFolderName = L"TexGen Output";
        constexpr std::wstring_view dynDoLodOutputFolderName = L"DynDOLOD Output";
        constexpr std::wstring_view integrationDirectoryName = L"lod-generators";
        constexpr std::wstring_view stageDirectoryName = L".fluxora-lod-output";
        constexpr std::wstring_view activeSessionFileName = L"active-session.json";
        constexpr std::wstring_view activeSessionLockName = L"active-session.lock";
        constexpr std::wstring_view virtualOutputRootName = L"Fluxora Tool Output";

        struct ToolDefinition
        {
            std::wstring kind;
            std::wstring displayName;
            std::wstring outputFolderName;
            std::wstring provider;
        };

        struct SessionState
        {
            std::wstring sessionId;
            std::wstring managedToolKind;
            std::filesystem::path configPath;
            std::filesystem::path projectDirectory;
            std::filesystem::path modsDirectory;
            std::filesystem::path stagingDirectory;
            std::filesystem::path virtualOutputDirectory;
            ManagedOutputMod outputMod;
            std::uint32_t managerProcessId{0};
            std::uint32_t processId{0};
            std::wstring status{L"prepared"};
            std::wstring outcome;
        };

        std::wstring toLower(std::wstring value)
        {
            std::transform(
                value.begin(),
                value.end(),
                value.begin(),
                [](wchar_t character)
                {
                    return static_cast<wchar_t>(std::towlower(character));
                });
            return value;
        }

        std::string toUtf8(std::wstring_view value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }
            const int size = WideCharToMultiByte(
                CP_UTF8,
                WC_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0,
                nullptr,
                nullptr);
            if (size <= 0)
            {
                throw std::invalid_argument("Text contains invalid Unicode.");
            }
            std::string output(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8,
                WC_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                output.data(),
                size,
                nullptr,
                nullptr);
            return output;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        std::wstring fromUtf8(std::string_view value)
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
                throw std::invalid_argument("Managed LOD generator state is not valid UTF-8.");
            }
            std::wstring output(static_cast<std::size_t>(size), L'\0');
            MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                output.data(),
                size);
            return output;
#else
            return std::wstring(value.begin(), value.end());
#endif
        }

        [[noreturn]] void throwIntegrationError(
            std::wstring code,
            std::wstring_view message)
        {
            throw LodGeneratorIntegrationError(std::move(code), toUtf8(message));
        }

        ToolDefinition definitionFor(std::wstring_view kind)
        {
            if (kind == texGenManagedToolKind)
            {
                return ToolDefinition{
                    std::wstring(texGenManagedToolKind),
                    L"TexGen",
                    std::wstring(texGenOutputFolderName),
                    std::wstring(texGenGeneratedProvider)};
            }
            if (kind == dynDoLodManagedToolKind)
            {
                return ToolDefinition{
                    std::wstring(dynDoLodManagedToolKind),
                    L"DynDOLOD",
                    std::wstring(dynDoLodOutputFolderName),
                    std::wstring(dynDoLodGeneratedProvider)};
            }
            throwIntegrationError(
                L"LOD_GENERATOR_UNSUPPORTED",
                L"Fluxora не распознала выбранный генератор LOD.");
        }

        std::filesystem::path normalizedCanonicalPath(const std::filesystem::path& path)
        {
            std::error_code error;
            std::filesystem::path result = std::filesystem::weakly_canonical(
                std::filesystem::absolute(path),
                error);
            if (error)
            {
                result = std::filesystem::absolute(path).lexically_normal();
            }
            return result;
        }

        bool samePath(
            const std::filesystem::path& left,
            const std::filesystem::path& right)
        {
            return toLower(normalizedCanonicalPath(left).wstring()) ==
                toLower(normalizedCanonicalPath(right).wstring());
        }

        bool isContainedPath(
            const std::filesystem::path& root,
            const std::filesystem::path& candidate)
        {
            const std::filesystem::path normalizedRoot = normalizedCanonicalPath(root);
            const std::filesystem::path normalizedCandidate = normalizedCanonicalPath(candidate);
            auto rootPart = normalizedRoot.begin();
            auto candidatePart = normalizedCandidate.begin();
            for (; rootPart != normalizedRoot.end(); ++rootPart, ++candidatePart)
            {
                if (candidatePart == normalizedCandidate.end() ||
                    toLower(rootPart->wstring()) != toLower(candidatePart->wstring()))
                {
                    return false;
                }
            }
            return true;
        }

        std::string readFileBytes(
            const std::filesystem::path& path,
            std::uintmax_t maximumBytes = 256U * 1024U)
        {
            std::error_code error;
            const std::uintmax_t size = std::filesystem::file_size(path, error);
            if (error || size > maximumBytes)
            {
                throw std::runtime_error("Managed LOD generator state is missing or too large.");
            }
            std::ifstream stream(path, std::ios::binary);
            if (!stream)
            {
                throw std::runtime_error("Managed LOD generator state could not be opened.");
            }
            return std::string(
                std::istreambuf_iterator<char>(stream),
                std::istreambuf_iterator<char>());
        }

        std::wstring jsonString(
            const JsonValue& object,
            std::wstring_view key,
            std::wstring_view fallback = {})
        {
            const JsonValue* value = object.find(key);
            if (value == nullptr || value->isNull())
            {
                return std::wstring(fallback);
            }
            if (!value->isString())
            {
                throw std::invalid_argument("Managed LOD generator state has an invalid field type.");
            }
            return value->asString();
        }

        std::uint32_t jsonProcessId(const JsonValue& object, std::wstring_view key)
        {
            const JsonValue* value = object.find(key);
            if (value == nullptr || value->isNull())
            {
                return 0;
            }
            if (value->type() != JsonValue::Type::Number)
            {
                throw std::invalid_argument("Managed LOD generator process id is invalid.");
            }
            const unsigned long parsed = std::stoul(value->asNumber());
            if (parsed > std::numeric_limits<std::uint32_t>::max())
            {
                throw std::invalid_argument("Managed LOD generator process id is out of range.");
            }
            return static_cast<std::uint32_t>(parsed);
        }

        std::wstring safePathSegment(std::wstring value, std::wstring_view fallback)
        {
            for (wchar_t& character : value)
            {
                if (character < 32 ||
                    character == L'<' || character == L'>' || character == L':' ||
                    character == L'"' || character == L'/' || character == L'\\' ||
                    character == L'|' || character == L'?' || character == L'*')
                {
                    character = L'_';
                }
            }
            const auto first = value.find_first_not_of(L" .\t\r\n");
            if (first == std::wstring::npos)
            {
                return std::wstring(fallback);
            }
            const auto last = value.find_last_not_of(L" .\t\r\n");
            value = value.substr(first, last - first + 1);
            if (value.empty() || value == L"." || value == L"..")
            {
                return std::wstring(fallback);
            }
            return value;
        }

        std::wstring generateSessionId(std::wstring_view kind)
        {
#ifdef _WIN32
            GUID guid{};
            if (CoCreateGuid(&guid) == S_OK)
            {
                std::array<wchar_t, 40> text{};
                const int length = StringFromGUID2(guid, text.data(), static_cast<int>(text.size()));
                if (length > 2)
                {
                    return L"lodgen-" + std::wstring(kind) + L"-" +
                        std::wstring(text.data() + 1, text.data() + length - 2);
                }
            }
#endif
            const auto now = std::chrono::high_resolution_clock::now().time_since_epoch().count();
            return L"lodgen-" + std::wstring(kind) + L"-" + std::to_wstring(now);
        }

        std::filesystem::path integrationRoot(
            const std::filesystem::path& projectDirectory,
            std::wstring_view kind)
        {
            return projectDirectory /
                L".flow" /
                L"tools" /
                std::filesystem::path(integrationDirectoryName) /
                safePathSegment(std::wstring(kind), L"lod");
        }

        std::filesystem::path sessionPath(
            const std::filesystem::path& root,
            std::wstring_view sessionId)
        {
            return root /
                L"sessions" /
                (safePathSegment(std::wstring(sessionId), L"session") + L".json");
        }

        std::filesystem::path stageRoot(
            const std::filesystem::path& modsDirectory,
            std::wstring_view kind)
        {
            return modsDirectory /
                std::filesystem::path(stageDirectoryName) /
                safePathSegment(std::wstring(kind), L"lod");
        }

        std::filesystem::path stageSessionDirectory(
            const std::filesystem::path& modsDirectory,
            std::wstring_view kind,
            std::wstring_view sessionId)
        {
            return stageRoot(modsDirectory, kind) /
                L"sessions" /
                safePathSegment(std::wstring(sessionId), L"session");
        }

        void atomicWriteUtf8(
            const std::filesystem::path& path,
            const std::string& content,
            std::wstring_view stateName)
        {
            AtomicFileStore().writeTextFile(
                path,
                content,
                AtomicFileWriteOptions{
                    std::wstring(stateName),
                    ProjectStateValidation::JsonObject});
        }

        void writeSessionState(const std::filesystem::path& path, const SessionState& state)
        {
            JsonWriter writer;
            writer.beginObject();
            writer.field(L"schemaVersion", 1);
            writer.field(L"sessionId", state.sessionId);
            writer.field(L"managedToolKind", state.managedToolKind);
            writer.field(L"configPath", state.configPath.wstring());
            writer.field(L"projectDirectory", state.projectDirectory.wstring());
            writer.field(L"modsDirectory", state.modsDirectory.wstring());
            writer.field(L"stagingDirectory", state.stagingDirectory.wstring());
            writer.field(L"virtualOutputDirectory", state.virtualOutputDirectory.wstring());
            writer.field(L"outputModId", state.outputMod.id);
            writer.field(L"outputDisplayName", state.outputMod.displayName);
            writer.field(L"outputFolderName", state.outputMod.folderName);
            writer.field(L"outputPath", state.outputMod.path.wstring());
            writer.field(L"outputProvider", state.outputMod.provider);
            writer.field(L"managerProcessId", static_cast<std::uint64_t>(state.managerProcessId));
            writer.field(L"processId", static_cast<std::uint64_t>(state.processId));
            writer.field(L"status", state.status);
            writer.field(L"outcome", state.outcome);
            writer.endObject();
            atomicWriteUtf8(
                path,
                toUtf8(writer.str()),
                L"LOD generator managed launch session");
        }

        SessionState readSessionState(const std::filesystem::path& path)
        {
            const JsonValue root = JsonReader::parse(fromUtf8(readFileBytes(path)));
            if (!root.isObject())
            {
                throw std::invalid_argument("Managed LOD generator launch session must be an object.");
            }
            SessionState state;
            state.sessionId = jsonString(root, L"sessionId");
            state.managedToolKind = jsonString(root, L"managedToolKind");
            state.configPath = jsonString(root, L"configPath");
            state.projectDirectory = jsonString(root, L"projectDirectory");
            state.modsDirectory = jsonString(root, L"modsDirectory");
            state.stagingDirectory = jsonString(root, L"stagingDirectory");
            state.virtualOutputDirectory = jsonString(root, L"virtualOutputDirectory");
            state.outputMod.id = jsonString(root, L"outputModId");
            state.outputMod.displayName = jsonString(root, L"outputDisplayName");
            state.outputMod.folderName = jsonString(root, L"outputFolderName");
            state.outputMod.path = jsonString(root, L"outputPath");
            state.outputMod.provider = jsonString(root, L"outputProvider");
            state.managerProcessId = jsonProcessId(root, L"managerProcessId");
            state.processId = jsonProcessId(root, L"processId");
            state.status = jsonString(root, L"status", L"prepared");
            state.outcome = jsonString(root, L"outcome");
            if (state.sessionId.empty() || state.managedToolKind.empty() ||
                state.projectDirectory.empty() || state.modsDirectory.empty() ||
                state.stagingDirectory.empty() || state.outputMod.id.empty() ||
                state.outputMod.path.empty() || state.outputMod.provider.empty())
            {
                throw std::invalid_argument("Managed LOD generator launch session is incomplete.");
            }
            return state;
        }

        bool processIsAlive(std::uint32_t processId)
        {
            if (processId == 0)
            {
                return false;
            }
#ifdef _WIN32
            const HANDLE process = OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
                FALSE,
                processId);
            if (process == nullptr)
            {
                return GetLastError() == ERROR_ACCESS_DENIED;
            }
            const DWORD waitResult = WaitForSingleObject(process, 0);
            CloseHandle(process);
            return waitResult == WAIT_TIMEOUT;
#else
            return false;
#endif
        }

        ManagedOutputMod toManagedOutput(
            const InstalledModRecord& record,
            std::wstring_view provider)
        {
            return ManagedOutputMod{
                record.uuid,
                record.displayName,
                record.folderName,
                record.path,
                std::wstring(provider)};
        }

        ManagedOutputMod ensureOutputMod(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory,
            const ToolDefinition& definition)
        {
            const std::filesystem::path outputPath =
                modsDirectory / definition.outputFolderName;
            const PathSafetyService safety;
            safety.validateDirectoryWriteRoot(modsDirectory)
                .throwIfUnsafe("Mods directory is unsafe");
            safety.validateWritePath(modsDirectory, outputPath)
                .throwIfUnsafe("LOD generator output mod path is unsafe");

            std::error_code error;
            const bool existed = std::filesystem::exists(outputPath, error);
            if (error)
            {
                throw std::runtime_error("Could not inspect the LOD generator output mod path.");
            }
            if (existed && !std::filesystem::is_directory(outputPath, error))
            {
                throwIntegrationError(
                    L"LOD_GENERATOR_OUTPUT_CONFLICT",
                    definition.displayName + L" Output уже существует и не является каталогом.");
            }
            if (error)
            {
                throw std::runtime_error("Could not inspect the LOD generator output mod directory.");
            }

            bool created = false;
            try
            {
                if (!existed)
                {
                    std::filesystem::create_directories(outputPath);
                    created = true;
                }
                ModSourceRecord source;
                source.provider = definition.provider;
                const InstalledModRecord record = InstanceMetadataStore::registerInstalledMod(
                    projectDirectory,
                    outputPath,
                    definition.outputFolderName,
                    {},
                    source);
                return toManagedOutput(record, definition.provider);
            }
            catch (...)
            {
                if (created)
                {
                    std::error_code cleanupError;
                    std::filesystem::remove_all(outputPath, cleanupError);
                }
                throw;
            }
        }

        void ensureOutputOrderForProfile(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory,
            std::wstring_view profileName,
            const ManagedOutputMod& texGenOutput,
            const ManagedOutputMod& dynDoLodOutput)
        {
            InstanceMetadataStore::ensureProfileState(
                projectDirectory,
                profileName,
                modsDirectory);
            const std::vector<ProfileOrderItemRecord> current =
                InstanceMetadataStore::listCachedProfileOrderItems(
                    projectDirectory,
                    profileName,
                    modsDirectory);

            std::vector<ProfileOrderImportItemRecord> ordered;
            ordered.reserve(current.size() + 2);
            for (const ProfileOrderItemRecord& item : current)
            {
                if (item.kind == L"separator")
                {
                    ordered.push_back(ProfileOrderImportItemRecord{
                        L"separator",
                        {},
                        item.separatorTitle});
                    continue;
                }
                if (!item.hasMod ||
                    item.mod.uuid == texGenOutput.id ||
                    item.mod.uuid == dynDoLodOutput.id ||
                    samePath(item.mod.path, texGenOutput.path) ||
                    samePath(item.mod.path, dynDoLodOutput.path))
                {
                    continue;
                }
                ordered.push_back(ProfileOrderImportItemRecord{
                    L"mod",
                    item.mod.folderName,
                    {}});
            }
            ordered.push_back(ProfileOrderImportItemRecord{
                L"mod",
                texGenOutput.folderName,
                {}});
            ordered.push_back(ProfileOrderImportItemRecord{
                L"mod",
                dynDoLodOutput.folderName,
                {}});
            InstanceMetadataStore::replaceProfileOrderItems(
                projectDirectory,
                profileName,
                ordered);
            InstanceMetadataStore::setInstalledModEnabled(
                projectDirectory,
                texGenOutput.path,
                true);
            InstanceMetadataStore::setInstalledModEnabled(
                projectDirectory,
                dynDoLodOutput.path,
                true);
        }

        std::wstring projectPathHash(const std::filesystem::path& projectDirectory)
        {
            constexpr std::uint64_t offsetBasis = 1469598103934665603ULL;
            constexpr std::uint64_t prime = 1099511628211ULL;
            std::uint64_t value = offsetBasis;
            for (const wchar_t character : toLower(
                     normalizedCanonicalPath(projectDirectory).wstring()))
            {
                value ^= static_cast<std::uint64_t>(character);
                value *= prime;
            }
            std::wostringstream stream;
            stream << std::hex << std::setw(16) << std::setfill(L'0') << value;
            return stream.str();
        }

        std::filesystem::path virtualOutputDirectory(
            const ResolvedExecutableLaunch& resolved,
            const ToolDefinition& definition)
        {
            std::filesystem::path root = normalizedCanonicalPath(
                resolved.gamePath.empty() ? resolved.projectDirectory : resolved.gamePath)
                .root_path();
            if (root.empty())
            {
                root = normalizedCanonicalPath(resolved.projectDirectory).root_path();
            }
            return (root /
                std::filesystem::path(virtualOutputRootName) /
                projectPathHash(resolved.projectDirectory) /
                definition.outputFolderName)
                .lexically_normal();
        }

        std::vector<std::wstring> parseWindowsCommandLine(std::wstring_view commandLine)
        {
            std::vector<std::wstring> arguments;
            std::size_t index = 0;
            while (index < commandLine.size())
            {
                while (index < commandLine.size() && std::iswspace(commandLine[index]))
                {
                    ++index;
                }
                if (index >= commandLine.size())
                {
                    break;
                }

                std::wstring argument;
                bool quoted = false;
                while (index < commandLine.size())
                {
                    if (!quoted && std::iswspace(commandLine[index]))
                    {
                        break;
                    }
                    if (commandLine[index] == L'"')
                    {
                        quoted = !quoted;
                        ++index;
                        continue;
                    }
                    if (commandLine[index] == L'\\')
                    {
                        std::size_t slashCount = 0;
                        while (index < commandLine.size() && commandLine[index] == L'\\')
                        {
                            ++slashCount;
                            ++index;
                        }
                        if (index < commandLine.size() && commandLine[index] == L'"')
                        {
                            argument.append(slashCount / 2, L'\\');
                            if ((slashCount % 2) != 0)
                            {
                                argument.push_back(L'"');
                                ++index;
                            }
                            else
                            {
                                quoted = !quoted;
                                ++index;
                            }
                        }
                        else
                        {
                            argument.append(slashCount, L'\\');
                        }
                        continue;
                    }
                    argument.push_back(commandLine[index]);
                    ++index;
                }
                arguments.push_back(std::move(argument));
            }
            return arguments;
        }

        std::wstring quoteCommandLineArgument(std::wstring_view value)
        {
            if (!value.empty() &&
                value.find_first_of(L" \t\n\v\"") == std::wstring_view::npos)
            {
                return std::wstring(value);
            }
            std::wstring quoted = L"\"";
            std::size_t backslashes = 0;
            for (const wchar_t character : value)
            {
                if (character == L'\\')
                {
                    ++backslashes;
                    continue;
                }
                if (character == L'"')
                {
                    quoted.append(backslashes * 2 + 1, L'\\');
                    quoted.push_back(L'"');
                    backslashes = 0;
                    continue;
                }
                quoted.append(backslashes, L'\\');
                backslashes = 0;
                quoted.push_back(character);
            }
            quoted.append(backslashes * 2, L'\\');
            quoted.push_back(L'"');
            return quoted;
        }

        bool isGameModeSwitch(std::wstring_view argument)
        {
            static constexpr std::array<std::wstring_view, 7> switches{
                L"-tes5",
                L"-sse",
                L"-tes5vr",
                L"-enderal",
                L"-enderalse",
                L"-fo4",
                L"-fo4vr"};
            const std::wstring lowered = toLower(std::wstring(argument));
            return std::find(switches.begin(), switches.end(), lowered) != switches.end();
        }

        std::wstring managedCommandLine(
            std::wstring_view original,
            const std::filesystem::path& outputPath,
            bool& replacedManagedArgument)
        {
            std::vector<std::wstring> arguments = parseWindowsCommandLine(original);
            if (arguments.empty())
            {
                throw std::invalid_argument("LOD generator command line is empty.");
            }
            std::vector<std::wstring> retained;
            retained.reserve(arguments.size() + 2);
            retained.push_back(arguments.front());
            for (std::size_t index = 1; index < arguments.size(); ++index)
            {
                const std::wstring lowered = toLower(arguments[index]);
                if (isGameModeSwitch(lowered) || lowered.starts_with(L"-o:"))
                {
                    replacedManagedArgument = true;
                    continue;
                }
                if (lowered == L"-o")
                {
                    replacedManagedArgument = true;
                    if (index + 1 < arguments.size())
                    {
                        ++index;
                    }
                    continue;
                }
                retained.push_back(arguments[index]);
            }

            std::wstring commandLine;
            for (const std::wstring& argument : retained)
            {
                if (!commandLine.empty())
                {
                    commandLine.push_back(L' ');
                }
                commandLine.append(quoteCommandLineArgument(argument));
            }
            commandLine.append(L" -sse -o:");
            commandLine.append(quoteCommandLineArgument(outputPath.wstring()));
            return commandLine;
        }

        bool directoryHasPayload(const std::filesystem::path& directory)
        {
            std::error_code error;
            if (!std::filesystem::is_directory(directory, error) || error)
            {
                return false;
            }
            for (std::filesystem::recursive_directory_iterator iterator(
                     directory,
                     std::filesystem::directory_options::skip_permission_denied,
                     error),
                 end;
                 iterator != end;
                 iterator.increment(error))
            {
                if (error)
                {
                    throw std::runtime_error(
                        "Could not enumerate the generated LOD output staging directory.");
                }
                if (iterator->is_regular_file(error))
                {
                    if (error)
                    {
                        throw std::runtime_error(
                            "Could not inspect generated LOD output.");
                    }
                    return true;
                }
            }
            return false;
        }

        void removeOwnedStage(
            const std::filesystem::path& modsDirectory,
            std::wstring_view kind,
            const std::filesystem::path& path)
        {
            const std::filesystem::path ownedRoot = stageRoot(modsDirectory, kind);
            if (!isContainedPath(ownedRoot, path))
            {
                throwIntegrationError(
                    L"LOD_GENERATOR_CONFIGURATION_FAILED",
                    L"Путь staging генератора LOD не прошёл проверку безопасности.");
            }
            const PathSafetyService safety;
            safety.validateDirectoryWriteRoot(modsDirectory)
                .throwIfUnsafe("Mods directory is unsafe");
            safety.validateWritePath(modsDirectory, path)
                .throwIfUnsafe("LOD generator staging path is unsafe");
            std::error_code error;
            std::filesystem::remove_all(path, error);
            if (error)
            {
                throw std::runtime_error("Could not remove the managed LOD output staging directory.");
            }
        }

        ManagedOutputMod commitStagedOutput(SessionState& state)
        {
            const ToolDefinition definition = definitionFor(state.managedToolKind);
            if (!isContainedPath(state.modsDirectory, state.outputMod.path) ||
                state.outputMod.provider != definition.provider)
            {
                throwIntegrationError(
                    L"LOD_GENERATOR_CONFIGURATION_FAILED",
                    L"Путь output-мода генератора LOD не прошёл проверку безопасности.");
            }

            const std::filesystem::path sessionDirectory = state.stagingDirectory.parent_path();
            const std::filesystem::path backupDirectory = sessionDirectory / L"previous-output";
            const PathSafetyService safety;
            safety.validateDirectoryWriteRoot(state.modsDirectory)
                .throwIfUnsafe("Mods directory is unsafe");
            safety.validateWritePath(state.modsDirectory, state.outputMod.path)
                .throwIfUnsafe("LOD generator output path is unsafe");
            safety.validateWritePath(state.modsDirectory, sessionDirectory)
                .throwIfUnsafe("LOD generator session path is unsafe");
            safety.validateWritePath(state.modsDirectory, backupDirectory)
                .throwIfUnsafe("LOD generator backup path is unsafe");

            std::error_code error;
            std::filesystem::remove_all(backupDirectory, error);
            if (error)
            {
                throw std::runtime_error("Could not clear the previous managed LOD output backup.");
            }

            bool backedUp = false;
            try
            {
                if (std::filesystem::exists(state.outputMod.path))
                {
                    std::filesystem::rename(state.outputMod.path, backupDirectory);
                    backedUp = true;
                }
                std::filesystem::rename(state.stagingDirectory, state.outputMod.path);

                ModSourceRecord source;
                source.provider = definition.provider;
                const InstalledModRecord refreshed = InstanceMetadataStore::registerInstalledMod(
                    state.projectDirectory,
                    state.outputMod.path,
                    definition.outputFolderName,
                    {},
                    source);
                InstanceMetadataStore::invalidateModFileCaches(
                    state.projectDirectory,
                    {state.outputMod.path},
                    state.modsDirectory);
                std::filesystem::remove_all(backupDirectory, error);
                return toManagedOutput(refreshed, definition.provider);
            }
            catch (...)
            {
                std::error_code rollbackError;
                std::filesystem::remove_all(state.outputMod.path, rollbackError);
                if (backedUp && std::filesystem::exists(backupDirectory))
                {
                    rollbackError.clear();
                    std::filesystem::rename(
                        backupDirectory,
                        state.outputMod.path,
                        rollbackError);
                }
                throw;
            }
        }

        void releaseActiveLease(const SessionState& state)
        {
            const std::filesystem::path root =
                integrationRoot(state.projectDirectory, state.managedToolKind);
            std::error_code error;
            std::filesystem::remove(root / activeSessionFileName, error);
            error.clear();
            std::filesystem::remove_all(root / activeSessionLockName, error);
        }
    }

    LodGeneratorIntegrationError::LodGeneratorIntegrationError(
        std::wstring code,
        std::string message)
        : std::runtime_error(std::move(message)),
          code_(std::move(code))
    {
    }

    const std::wstring& LodGeneratorIntegrationError::code() const noexcept
    {
        return code_;
    }

    LodGeneratorIntegrationService::LodGeneratorIntegrationService(
        Logger& logger,
        const BuildPathSettingsService& pathSettings) noexcept
        : logger_(logger),
          pathSettings_(pathSettings)
    {
    }

    void LodGeneratorIntegrationService::initialize()
    {
        initialized_ = true;
        logger_.write(LogLevel::Info, "LOD generator integration service initialized.");
    }

    void LodGeneratorIntegrationService::shutdown()
    {
        initialized_ = false;
        const std::lock_guard lock(sessionRegistryMutex_);
        sessionRegistry_.clear();
        logger_.write(LogLevel::Info, "LOD generator integration service shut down.");
    }

    std::wstring LodGeneratorIntegrationService::detectManagedToolKind(
        const GameExecutable&,
        const std::filesystem::path& resolvedExecutablePath)
    {
        const std::wstring fileName = toLower(resolvedExecutablePath.filename().wstring());
        if (fileName == L"texgen.exe" || fileName == L"texgenx64.exe")
        {
            return std::wstring(texGenManagedToolKind);
        }
        if (fileName == L"dyndolod.exe" || fileName == L"dyndolodx64.exe")
        {
            return std::wstring(dynDoLodManagedToolKind);
        }
        return {};
    }

    LodGeneratorLaunchPreparation LodGeneratorIntegrationService::prepareLaunch(
        const std::filesystem::path& configPath,
        const ResolvedExecutableLaunch& resolved,
        std::wstring_view profileName) const
    {
        if (toLower(resolved.gameId.value()) != skyrimSeGameId)
        {
            throwIntegrationError(
                L"LOD_GENERATOR_GAME_UNSUPPORTED",
                L"Автоматическая настройка TexGen и DynDOLOD сейчас доступна для Skyrim Special Edition.");
        }
        const ToolDefinition definition =
            definitionFor(resolved.executable.managedToolKind);
        if (detectManagedToolKind(resolved.executable, resolved.resolvedExecutablePath) !=
            definition.kind)
        {
            throwIntegrationError(
                L"LOD_GENERATOR_EXECUTABLE_INVALID",
                L"Выбранный executable не совпадает с официальным TexGen или DynDOLOD.");
        }

        const BuildPathSettings settings = pathSettings_.loadForConfig(configPath);
        if (settings.modsDirectory.empty() || resolved.projectDirectory.empty())
        {
            throwIntegrationError(
                L"LOD_GENERATOR_CONFIGURATION_FAILED",
                L"Для сборки не настроен каталог модов.");
        }

        LodGeneratorLaunchPreparation preparation;
        preparation.managedToolKind = definition.kind;
        const ManagedOutputMod texGenOutput = ensureOutputMod(
            resolved.projectDirectory,
            settings.modsDirectory,
            definitionFor(texGenManagedToolKind));
        const ManagedOutputMod dynDoLodOutput = ensureOutputMod(
            resolved.projectDirectory,
            settings.modsDirectory,
            definitionFor(dynDoLodManagedToolKind));
        preparation.outputMod = definition.kind == texGenManagedToolKind
            ? texGenOutput
            : dynDoLodOutput;

        std::set<std::wstring> profiles;
        for (const std::wstring& profile :
             InstanceMetadataStore::listProfileNames(resolved.projectDirectory))
        {
            profiles.insert(profile.empty() ? L"Default" : profile);
        }
        const std::wstring activeProfile = profileName.empty()
            ? (resolved.defaultProfile.empty() ? L"Default" : resolved.defaultProfile)
            : std::wstring(profileName);
        profiles.insert(activeProfile);
        for (const std::wstring& profile : profiles)
        {
            ensureOutputOrderForProfile(
                resolved.projectDirectory,
                settings.modsDirectory,
                profile,
                texGenOutput,
                dynDoLodOutput);
        }

        preparation.activeProfileMods.reserve(resolved.activeProfileMods.size() + 1);
        for (const ExecutableLaunchMod& mod : resolved.activeProfileMods)
        {
            const bool isTexGenOutput = samePath(mod.path, texGenOutput.path);
            const bool isDynDoLodOutput = samePath(mod.path, dynDoLodOutput.path);
            if (isDynDoLodOutput ||
                (definition.kind == texGenManagedToolKind && isTexGenOutput))
            {
                continue;
            }
            preparation.activeProfileMods.push_back(mod);
        }
        if (definition.kind == dynDoLodManagedToolKind)
        {
            const auto texGenInSnapshot = std::find_if(
                preparation.activeProfileMods.begin(),
                preparation.activeProfileMods.end(),
                [&texGenOutput](const ExecutableLaunchMod& mod)
                {
                    return samePath(mod.path, texGenOutput.path);
                });
            if (texGenInSnapshot == preparation.activeProfileMods.end())
            {
                preparation.activeProfileMods.push_back(ExecutableLaunchMod{
                    texGenOutput.path,
                    texGenOutput.displayName,
                    {}});
            }
        }

        const std::filesystem::path root =
            integrationRoot(resolved.projectDirectory, definition.kind);
        const std::filesystem::path activePath = root / activeSessionFileName;
        const std::filesystem::path lockPath = root / activeSessionLockName;
        if (std::filesystem::exists(lockPath))
        {
            try
            {
                const SessionState stale = readSessionState(activePath);
                if (processIsAlive(stale.processId) ||
                    (stale.processId == 0 && processIsAlive(stale.managerProcessId)))
                {
                    throwIntegrationError(
                        L"LOD_GENERATOR_SESSION_ACTIVE",
                        L"Для этой сборки уже запущена управляемая сессия " +
                            definition.displayName + L".");
                }
                removeOwnedStage(
                    stale.modsDirectory,
                    stale.managedToolKind,
                    stale.stagingDirectory.parent_path());
                releaseActiveLease(stale);
                preparation.configurationStatus = L"recovered";
                preparation.warnings.push_back(
                    L"Незавершённая сессия " + definition.displayName +
                    L" очищена; прежний output сохранён.");
            }
            catch (const LodGeneratorIntegrationError&)
            {
                throw;
            }
            catch (const std::exception& exception)
            {
                throwIntegrationError(
                    L"LOD_GENERATOR_CONFIGURATION_FAILED",
                    L"Не удалось безопасно восстановить предыдущую сессию " +
                        definition.displayName + L": " + fromUtf8(exception.what()));
            }
        }

        std::error_code lockError;
        std::filesystem::create_directories(root / L"sessions");
        if (!std::filesystem::create_directory(lockPath, lockError))
        {
            throwIntegrationError(
                L"LOD_GENERATOR_SESSION_ACTIVE",
                L"Не удалось получить эксклюзивный lease " + definition.displayName + L".");
        }

        preparation.sessionId = generateSessionId(definition.kind);
        const std::filesystem::path stageSession = stageSessionDirectory(
            settings.modsDirectory,
            definition.kind,
            preparation.sessionId);
        preparation.stagingDirectory = stageSession / L"output";
        preparation.virtualOutputDirectory =
            virtualOutputDirectory(resolved, definition);
        bool replacedManagedArgument = false;
        preparation.commandLine = managedCommandLine(
            resolved.commandLine,
            preparation.virtualOutputDirectory,
            replacedManagedArgument);
        if (replacedManagedArgument)
        {
            preparation.warnings.push_back(
                L"Fluxora заменила прежние game mode/output аргументы на управляемые -sse и -o.");
        }
        if (preparation.configurationStatus.empty())
        {
            preparation.configurationStatus = L"configured";
        }

        const PathSafetyService safety;
        safety.validateDirectoryWriteRoot(settings.modsDirectory)
            .throwIfUnsafe("Mods directory is unsafe");
        safety.validateWritePath(settings.modsDirectory, stageSession)
            .throwIfUnsafe("LOD generator session directory is unsafe");
        try
        {
            std::filesystem::remove_all(stageSession);
            std::filesystem::create_directories(preparation.stagingDirectory);

            SessionState state;
            state.sessionId = preparation.sessionId;
            state.managedToolKind = definition.kind;
            state.configPath = normalizedCanonicalPath(configPath);
            state.projectDirectory = normalizedCanonicalPath(resolved.projectDirectory);
            state.modsDirectory = normalizedCanonicalPath(settings.modsDirectory);
            state.stagingDirectory = normalizedCanonicalPath(preparation.stagingDirectory);
            state.virtualOutputDirectory = preparation.virtualOutputDirectory;
            state.outputMod = preparation.outputMod;
#ifdef _WIN32
            state.managerProcessId = GetCurrentProcessId();
#endif
            const std::filesystem::path statePath = sessionPath(root, state.sessionId);
            writeSessionState(statePath, state);
            writeSessionState(activePath, state);
            {
                const std::lock_guard lock(sessionRegistryMutex_);
                sessionRegistry_[state.sessionId] = statePath;
            }
        }
        catch (...)
        {
            std::error_code cleanupError;
            std::filesystem::remove_all(stageSession, cleanupError);
            cleanupError.clear();
            std::filesystem::remove(activePath, cleanupError);
            cleanupError.clear();
            std::filesystem::remove_all(lockPath, cleanupError);
            throw;
        }

        logger_.writeOperation(
            LogLevel::Info,
            toUtf8(definition.displayName),
            "Prepared managed " + toUtf8(definition.displayName) +
                " session id=\"" + toUtf8(preparation.sessionId) +
                "\", virtualOutput=\"" +
                toUtf8(preparation.virtualOutputDirectory.wstring()) +
                "\", outputMod=\"" + toUtf8(preparation.outputMod.path.wstring()) + "\".");
        return preparation;
    }

    void LodGeneratorIntegrationService::applyVfsPolicy(
        std::vector<VfsMountDescriptor>& mounts,
        const LodGeneratorLaunchPreparation& preparation) const
    {
        mounts.push_back(VfsMountDescriptor{
            normalizedCanonicalPath(preparation.virtualOutputDirectory),
            normalizedCanonicalPath(preparation.stagingDirectory),
            {}});
    }

    void LodGeneratorIntegrationService::bindProcess(
        std::wstring_view sessionId,
        std::uint32_t processId) const
    {
        if (sessionId.empty() || processId == 0)
        {
            throw std::invalid_argument("Managed LOD generator session and process ids are required.");
        }
        std::filesystem::path statePath;
        {
            const std::lock_guard lock(sessionRegistryMutex_);
            const auto found = sessionRegistry_.find(std::wstring(sessionId));
            if (found == sessionRegistry_.end())
            {
                throwIntegrationError(
                    L"LOD_GENERATOR_SESSION_NOT_FOUND",
                    L"Управляемая сессия генератора LOD не найдена.");
            }
            statePath = found->second;
        }
        SessionState state = readSessionState(statePath);
        state.processId = processId;
        state.status = L"running";
        writeSessionState(statePath, state);
        writeSessionState(
            integrationRoot(state.projectDirectory, state.managedToolKind) /
                activeSessionFileName,
            state);
    }

    void LodGeneratorIntegrationService::abandonLaunch(
        std::wstring_view sessionId) const noexcept
    {
        try
        {
            std::filesystem::path statePath;
            {
                const std::lock_guard lock(sessionRegistryMutex_);
                const auto found = sessionRegistry_.find(std::wstring(sessionId));
                if (found == sessionRegistry_.end())
                {
                    return;
                }
                statePath = found->second;
                sessionRegistry_.erase(found);
            }
            SessionState state = readSessionState(statePath);
            removeOwnedStage(
                state.modsDirectory,
                state.managedToolKind,
                state.stagingDirectory.parent_path());
            state.status = L"abandoned";
            state.outcome = L"launch-failed";
            writeSessionState(statePath, state);
            releaseActiveLease(state);
        }
        catch (...)
        {
        }
    }

    ManagedLaunchCompletion LodGeneratorIntegrationService::completeManagedLaunch(
        std::wstring_view sessionId,
        std::wstring_view outcome) const
    {
        if (sessionId.empty())
        {
            throw std::invalid_argument("Managed LOD generator session id is required.");
        }
        static const std::set<std::wstring> supportedOutcomes{
            L"completed",
            L"failed",
            L"cancelled",
            L"watcher-error",
            L"stale-recovered"};
        const std::wstring normalizedOutcome = outcome.empty()
            ? L"completed"
            : std::wstring(outcome);
        if (!supportedOutcomes.contains(normalizedOutcome))
        {
            throw std::invalid_argument("Managed LOD generator completion outcome is invalid.");
        }

        std::filesystem::path statePath;
        {
            const std::lock_guard lock(sessionRegistryMutex_);
            const auto found = sessionRegistry_.find(std::wstring(sessionId));
            if (found == sessionRegistry_.end())
            {
                throwIntegrationError(
                    L"LOD_GENERATOR_SESSION_NOT_FOUND",
                    L"Управляемая сессия генератора LOD не найдена.");
            }
            statePath = found->second;
        }
        SessionState state = readSessionState(statePath);
        if (state.sessionId != sessionId || !ownsSession(sessionId))
        {
            throwIntegrationError(
                L"LOD_GENERATOR_SESSION_NOT_FOUND",
                L"Идентификатор сессии генератора LOD не совпадает с сохранённым lease.");
        }

        ManagedLaunchCompletion completion;
        completion.sessionId = state.sessionId;
        completion.outcome = state.outcome.empty() ? normalizedOutcome : state.outcome;
        completion.outputMod = state.outputMod;
        if (state.status == L"completed")
        {
            completion.finalized = true;
            return completion;
        }
        if (processIsAlive(state.processId))
        {
            completion.deferred = true;
            completion.warnings.push_back(
                L"Процесс " + definitionFor(state.managedToolKind).displayName +
                L" ещё работает; обновление output отложено.");
            return completion;
        }

        const ToolDefinition definition = definitionFor(state.managedToolKind);
        if (normalizedOutcome == L"completed" &&
            directoryHasPayload(state.stagingDirectory))
        {
            state.outputMod = commitStagedOutput(state);
            completion.outputMod = state.outputMod;
        }
        else
        {
            removeOwnedStage(
                state.modsDirectory,
                state.managedToolKind,
                state.stagingDirectory.parent_path());
            completion.warnings.push_back(
                normalizedOutcome == L"completed"
                    ? definition.displayName +
                        L" не создал файлов; прежний output сохранён."
                    : definition.displayName +
                        L" завершился без подтверждённого результата; прежний output сохранён.");
        }

        state.status = L"completed";
        state.outcome = normalizedOutcome;
        writeSessionState(statePath, state);
        releaseActiveLease(state);
        completion.outcome = normalizedOutcome;
        completion.finalized = true;
        {
            const std::lock_guard lock(sessionRegistryMutex_);
            sessionRegistry_[state.sessionId] = statePath;
        }
        logger_.writeOperation(
            LogLevel::Info,
            toUtf8(definition.displayName),
            "Completed managed " + toUtf8(definition.displayName) +
                " session id=\"" + toUtf8(sessionId) +
                "\", finalized=1, outputUpdated=" +
                std::to_string(completion.warnings.empty() ? 1 : 0) + ".");
        return completion;
    }

    bool LodGeneratorIntegrationService::ownsSession(
        std::wstring_view sessionId) const noexcept
    {
        return sessionId.starts_with(L"lodgen-");
    }

    bool LodGeneratorIntegrationService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
