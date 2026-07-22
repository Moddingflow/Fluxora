#include "FluxoraCore/Services/BodySlideIntegrationService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
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
        constexpr std::uintmax_t maximumManagedXmlBytes = 4U * 1024U * 1024U;
        constexpr std::wstring_view skyrimSeGameId = L"skyrimse";
        constexpr std::wstring_view bodySlideRootDirectory = L"body-slide";
        constexpr std::wstring_view outputStateFileName = L"output.json";
        constexpr std::wstring_view activeSessionFileName = L"active-session.json";
        constexpr std::wstring_view activeSessionLockName = L"active-session.lock";

        struct OutputState
        {
            std::wstring modUuid;
            std::wstring folderName;
            std::wstring displayName;
        };

        struct SessionState
        {
            std::wstring sessionId;
            std::filesystem::path configPath;
            std::filesystem::path projectDirectory;
            std::filesystem::path modsDirectory;
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
                throw std::invalid_argument("Managed BodySlide file is not valid UTF-8.");
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
            throw BodySlideIntegrationError(std::move(code), toUtf8(message));
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
            std::uintmax_t maximumBytes = std::numeric_limits<std::uintmax_t>::max())
        {
            std::error_code error;
            const std::uintmax_t size = std::filesystem::file_size(path, error);
            if (error || size > maximumBytes)
            {
                throw std::runtime_error("Managed BodySlide file is missing or too large.");
            }
            std::ifstream stream(path, std::ios::binary);
            if (!stream)
            {
                throw std::runtime_error("Managed BodySlide file could not be opened.");
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
                throw std::invalid_argument("Managed BodySlide state has an invalid field type.");
            }
            return value->asString();
        }

        std::uint32_t jsonProcessId(const JsonValue& object)
        {
            const JsonValue* value = object.find(L"processId");
            if (value == nullptr || value->isNull())
            {
                return 0;
            }
            if (value->type() != JsonValue::Type::Number)
            {
                throw std::invalid_argument("Managed BodySlide process id is invalid.");
            }
            const unsigned long parsed = std::stoul(value->asNumber());
            if (parsed > std::numeric_limits<std::uint32_t>::max())
            {
                throw std::invalid_argument("Managed BodySlide process id is out of range.");
            }
            return static_cast<std::uint32_t>(parsed);
        }

        std::wstring generateSessionId()
        {
#ifdef _WIN32
            GUID guid{};
            if (CoCreateGuid(&guid) == S_OK)
            {
                std::array<wchar_t, 40> text{};
                const int length = StringFromGUID2(guid, text.data(), static_cast<int>(text.size()));
                if (length > 2)
                {
                    return std::wstring(text.data() + 1, text.data() + length - 2);
                }
            }
#endif
            const auto now = std::chrono::high_resolution_clock::now().time_since_epoch().count();
            return L"bodyslide-" + std::to_wstring(now);
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

        std::filesystem::path integrationRoot(const std::filesystem::path& projectDirectory)
        {
            return projectDirectory / L".flow" / L"tools" / bodySlideRootDirectory;
        }

        std::filesystem::path sessionPath(
            const std::filesystem::path& root,
            std::wstring_view sessionId)
        {
            return root / L"sessions" / (safePathSegment(std::wstring(sessionId), L"session") + L".json");
        }

        void atomicWriteUtf8(
            const std::filesystem::path& path,
            const std::string& content,
            std::wstring_view stateName,
            ProjectStateValidation validation = ProjectStateValidation::Utf8Text)
        {
            AtomicFileStore().writeTextFile(
                path,
                content,
                AtomicFileWriteOptions{std::wstring(stateName), validation});
        }

        std::optional<OutputState> readOutputState(const std::filesystem::path& path)
        {
            if (!std::filesystem::is_regular_file(path))
            {
                return std::nullopt;
            }
            const JsonValue root = JsonReader::parse(fromUtf8(readFileBytes(path)));
            if (!root.isObject())
            {
                throw std::invalid_argument("Managed BodySlide output state must be an object.");
            }
            OutputState state;
            state.modUuid = jsonString(root, L"modUuid");
            state.folderName = jsonString(root, L"folderName");
            state.displayName = jsonString(root, L"displayName");
            if (state.modUuid.empty() || state.folderName.empty())
            {
                throw std::invalid_argument("Managed BodySlide output state is incomplete.");
            }
            return state;
        }

        void writeOutputState(const std::filesystem::path& path, const ManagedOutputMod& output)
        {
            JsonWriter writer;
            writer.beginObject();
            writer.field(L"schemaVersion", 1);
            writer.field(L"modUuid", output.id);
            writer.field(L"folderName", output.folderName);
            writer.field(L"displayName", output.displayName);
            writer.field(L"provider", output.provider);
            writer.endObject();
            atomicWriteUtf8(
                path,
                toUtf8(writer.str()),
                L"BodySlide output state",
                ProjectStateValidation::JsonObject);
        }

        void writeSessionState(const std::filesystem::path& path, const SessionState& state)
        {
            JsonWriter writer;
            writer.beginObject();
            writer.field(L"schemaVersion", 1);
            writer.field(L"sessionId", state.sessionId);
            writer.field(L"configPath", state.configPath.wstring());
            writer.field(L"projectDirectory", state.projectDirectory.wstring());
            writer.field(L"modsDirectory", state.modsDirectory.wstring());
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
                L"BodySlide managed launch session",
                ProjectStateValidation::JsonObject);
        }

        SessionState readSessionState(const std::filesystem::path& path)
        {
            const JsonValue root = JsonReader::parse(fromUtf8(readFileBytes(path)));
            if (!root.isObject())
            {
                throw std::invalid_argument("Managed BodySlide launch session must be an object.");
            }
            SessionState state;
            state.sessionId = jsonString(root, L"sessionId");
            state.configPath = jsonString(root, L"configPath");
            state.projectDirectory = jsonString(root, L"projectDirectory");
            state.modsDirectory = jsonString(root, L"modsDirectory");
            state.outputMod.id = jsonString(root, L"outputModId");
            state.outputMod.displayName = jsonString(root, L"outputDisplayName");
            state.outputMod.folderName = jsonString(root, L"outputFolderName");
            state.outputMod.path = jsonString(root, L"outputPath");
            state.outputMod.provider = jsonString(root, L"outputProvider", bodySlideGeneratedProvider);
            if (const JsonValue* manager = root.find(L"managerProcessId");
                manager != nullptr && !manager->isNull())
            {
                if (manager->type() != JsonValue::Type::Number)
                {
                    throw std::invalid_argument("Managed BodySlide manager process id is invalid.");
                }
                state.managerProcessId = static_cast<std::uint32_t>(std::stoul(manager->asNumber()));
            }
            state.processId = jsonProcessId(root);
            state.status = jsonString(root, L"status", L"prepared");
            state.outcome = jsonString(root, L"outcome");
            if (state.sessionId.empty() || state.projectDirectory.empty() || state.modsDirectory.empty() ||
                state.outputMod.id.empty() ||
                state.outputMod.path.empty())
            {
                throw std::invalid_argument("Managed BodySlide launch session is incomplete.");
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
            DWORD exitCode = 0;
            const bool alive = GetExitCodeProcess(process, &exitCode) != FALSE && exitCode == STILL_ACTIVE;
            CloseHandle(process);
            return alive;
#else
            return false;
#endif
        }

        bool isX64PeExecutable(const std::filesystem::path& path, bool& isX86)
        {
            isX86 = false;
            std::ifstream stream(path, std::ios::binary);
            if (!stream)
            {
                return false;
            }
            std::array<unsigned char, 64> dosHeader{};
            stream.read(reinterpret_cast<char*>(dosHeader.data()), dosHeader.size());
            if (stream.gcount() != static_cast<std::streamsize>(dosHeader.size()) ||
                dosHeader[0] != 'M' || dosHeader[1] != 'Z')
            {
                return false;
            }
            const std::uint32_t peOffset =
                static_cast<std::uint32_t>(dosHeader[0x3c]) |
                (static_cast<std::uint32_t>(dosHeader[0x3d]) << 8U) |
                (static_cast<std::uint32_t>(dosHeader[0x3e]) << 16U) |
                (static_cast<std::uint32_t>(dosHeader[0x3f]) << 24U);
            stream.seekg(peOffset, std::ios::beg);
            std::array<unsigned char, 6> peHeader{};
            stream.read(reinterpret_cast<char*>(peHeader.data()), peHeader.size());
            if (stream.gcount() != static_cast<std::streamsize>(peHeader.size()) ||
                peHeader[0] != 'P' || peHeader[1] != 'E' || peHeader[2] != 0 || peHeader[3] != 0)
            {
                return false;
            }
            const std::uint16_t machine = static_cast<std::uint16_t>(
                peHeader[4] | (static_cast<std::uint16_t>(peHeader[5]) << 8U));
            isX86 = machine == 0x014c;
            return machine == 0x8664;
        }

        std::size_t findTagEnd(const std::string& xml, std::size_t start)
        {
            char quote = '\0';
            for (std::size_t index = start; index < xml.size(); ++index)
            {
                const char character = xml[index];
                if (quote != '\0')
                {
                    if (character == quote)
                    {
                        quote = '\0';
                    }
                    continue;
                }
                if (character == '\'' || character == '"')
                {
                    quote = character;
                    continue;
                }
                if (character == '>')
                {
                    return index;
                }
            }
            return std::string::npos;
        }

        bool isXmlNameCharacter(char character)
        {
            return (character >= 'a' && character <= 'z') ||
                (character >= 'A' && character <= 'Z') ||
                (character >= '0' && character <= '9') ||
                character == '_' || character == ':' || character == '-' || character == '.';
        }

        bool isWellFormedBodySlideConfig(const std::string& xml)
        {
            try
            {
                static_cast<void>(fromUtf8(xml));
            }
            catch (...)
            {
                return false;
            }

            std::vector<std::string> elements;
            bool sawConfigRoot = false;
            std::size_t cursor = 0;
            while (true)
            {
                const std::size_t open = xml.find('<', cursor);
                if (open == std::string::npos)
                {
                    break;
                }
                if (xml.compare(open, 4, "<!--") == 0)
                {
                    const std::size_t end = xml.find("-->", open + 4);
                    if (end == std::string::npos)
                    {
                        return false;
                    }
                    cursor = end + 3;
                    continue;
                }
                if (xml.compare(open, 9, "<![CDATA[") == 0)
                {
                    const std::size_t end = xml.find("]]>", open + 9);
                    if (end == std::string::npos)
                    {
                        return false;
                    }
                    cursor = end + 3;
                    continue;
                }
                if (open + 1 >= xml.size())
                {
                    return false;
                }
                if (xml[open + 1] == '?')
                {
                    const std::size_t end = xml.find("?>", open + 2);
                    if (end == std::string::npos)
                    {
                        return false;
                    }
                    cursor = end + 2;
                    continue;
                }
                if (xml[open + 1] == '!')
                {
                    const std::size_t end = findTagEnd(xml, open + 2);
                    if (end == std::string::npos)
                    {
                        return false;
                    }
                    cursor = end + 1;
                    continue;
                }

                const bool closing = xml[open + 1] == '/';
                std::size_t nameStart = open + (closing ? 2 : 1);
                while (nameStart < xml.size() &&
                    (xml[nameStart] == ' ' || xml[nameStart] == '\t' ||
                     xml[nameStart] == '\r' || xml[nameStart] == '\n'))
                {
                    ++nameStart;
                }
                std::size_t nameEnd = nameStart;
                while (nameEnd < xml.size() && isXmlNameCharacter(xml[nameEnd]))
                {
                    ++nameEnd;
                }
                if (nameEnd == nameStart)
                {
                    return false;
                }
                const std::string name = xml.substr(nameStart, nameEnd - nameStart);
                const std::size_t end = findTagEnd(xml, nameEnd);
                if (end == std::string::npos)
                {
                    return false;
                }
                if (closing)
                {
                    if (elements.empty() || elements.back() != name)
                    {
                        return false;
                    }
                    elements.pop_back();
                }
                else
                {
                    std::size_t suffix = end;
                    while (suffix > nameEnd &&
                        (xml[suffix - 1] == ' ' || xml[suffix - 1] == '\t' ||
                         xml[suffix - 1] == '\r' || xml[suffix - 1] == '\n'))
                    {
                        --suffix;
                    }
                    const bool selfClosing = suffix > nameEnd && xml[suffix - 1] == '/';
                    if (elements.empty())
                    {
                        if (name != "Config" || sawConfigRoot)
                        {
                            return false;
                        }
                        sawConfigRoot = true;
                    }
                    if (!selfClosing)
                    {
                        elements.push_back(name);
                    }
                }
                cursor = end + 1;
            }
            return sawConfigRoot && elements.empty();
        }

        std::string xmlEscape(std::wstring_view value)
        {
            const std::string utf8 = toUtf8(value);
            std::string escaped;
            escaped.reserve(utf8.size());
            for (const char character : utf8)
            {
                switch (character)
                {
                case '&': escaped.append("&amp;"); break;
                case '<': escaped.append("&lt;"); break;
                case '>': escaped.append("&gt;"); break;
                case '"': escaped.append("&quot;"); break;
                case '\'': escaped.append("&apos;"); break;
                default: escaped.push_back(character); break;
                }
            }
            return escaped;
        }

        bool tagNameMatchesAt(
            const std::string& xml,
            std::size_t position,
            std::string_view tagName)
        {
            if (xml.compare(position, tagName.size(), tagName) != 0)
            {
                return false;
            }
            const std::size_t after = position + tagName.size();
            return after < xml.size() &&
                (xml[after] == '>' || xml[after] == '/' || xml[after] == ' ' ||
                 xml[after] == '\t' || xml[after] == '\r' || xml[after] == '\n');
        }

        std::size_t findOpeningTag(
            const std::string& xml,
            std::string_view tagName,
            std::size_t begin,
            std::size_t end)
        {
            const std::string needle = "<" + std::string(tagName);
            std::size_t position = begin;
            while ((position = xml.find(needle, position)) != std::string::npos && position < end)
            {
                if (tagNameMatchesAt(xml, position + 1, tagName))
                {
                    return position;
                }
                position += needle.size();
            }
            return std::string::npos;
        }

        bool replaceElementValue(
            std::string& xml,
            std::string_view tagName,
            std::wstring_view value,
            std::size_t begin = 0,
            std::size_t end = std::string::npos)
        {
            if (end == std::string::npos || end > xml.size())
            {
                end = xml.size();
            }
            const std::size_t opening = findOpeningTag(xml, tagName, begin, end);
            if (opening == std::string::npos)
            {
                return false;
            }
            const std::size_t openingEnd = findTagEnd(xml, opening + 1);
            if (openingEnd == std::string::npos || openingEnd >= end)
            {
                return false;
            }
            const std::string closing = "</" + std::string(tagName) + ">";
            const std::size_t closingStart = xml.find(closing, openingEnd + 1);
            if (closingStart == std::string::npos || closingStart >= end)
            {
                return false;
            }
            xml.replace(openingEnd + 1, closingStart - openingEnd - 1, xmlEscape(value));
            return true;
        }

        void insertBeforeConfigClose(std::string& xml, const std::string& element)
        {
            const std::size_t close = xml.rfind("</Config>");
            if (close == std::string::npos)
            {
                throw std::invalid_argument("BodySlide config has no Config root close tag.");
            }
            xml.insert(close, element);
        }

        void setRootElement(std::string& xml, std::string_view tagName, std::wstring_view value)
        {
            if (!replaceElementValue(xml, tagName, value))
            {
                insertBeforeConfigClose(
                    xml,
                    "  <" + std::string(tagName) + ">" + xmlEscape(value) + "</" +
                        std::string(tagName) + ">\n");
            }
        }

        void setSkyrimSeDataPath(std::string& xml, std::wstring_view value)
        {
            const std::size_t group = findOpeningTag(xml, "GameDataPaths", 0, xml.size());
            if (group == std::string::npos)
            {
                insertBeforeConfigClose(
                    xml,
                    "  <GameDataPaths>\n    <SkyrimSpecialEdition>" + xmlEscape(value) +
                        "</SkyrimSpecialEdition>\n  </GameDataPaths>\n");
                return;
            }
            const std::size_t groupOpenEnd = findTagEnd(xml, group + 1);
            const std::size_t groupClose = xml.find("</GameDataPaths>", groupOpenEnd + 1);
            if (groupOpenEnd == std::string::npos || groupClose == std::string::npos)
            {
                throw std::invalid_argument("BodySlide GameDataPaths element is malformed.");
            }
            if (!replaceElementValue(
                    xml,
                    "SkyrimSpecialEdition",
                    value,
                    groupOpenEnd + 1,
                    groupClose))
            {
                xml.insert(
                    groupClose,
                    "    <SkyrimSpecialEdition>" + xmlEscape(value) +
                        "</SkyrimSpecialEdition>\n  ");
            }
        }

        std::wstring bodySlideDirectoryPrefix(const std::filesystem::path& directory)
        {
            std::wstring value = directory.wstring();
            if (!value.empty() && value.back() != L'\\' && value.back() != L'/')
            {
                value.push_back(std::filesystem::path::preferred_separator);
            }
            return value;
        }

        std::string minimalConfig(
            const std::filesystem::path& gameData,
            const std::filesystem::path& projectPath)
        {
            std::string xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Config>\n</Config>\n";
            const std::wstring gameDataPrefix = bodySlideDirectoryPrefix(gameData);
            setRootElement(xml, "TargetGame", L"4");
            setSkyrimSeDataPath(xml, gameDataPrefix);
            setRootElement(xml, "GameDataPath", gameDataPrefix);
            setRootElement(xml, "OutputDataPath", gameDataPrefix);
            setRootElement(xml, "ProjectPath", projectPath.wstring());
            return xml;
        }

        std::filesystem::path recoveryFilePath(const std::filesystem::path& recoveryDirectory)
        {
            const auto stamp = std::chrono::system_clock::now().time_since_epoch().count();
            return recoveryDirectory / (L"Config-" + std::to_wstring(stamp) + L".xml");
        }

        std::wstring prepareConfigOverlay(
            const std::filesystem::path& executableDirectory,
            const std::filesystem::path& overlayDirectory,
            const std::filesystem::path& gameData,
            const std::filesystem::path& projectPath,
            std::vector<std::wstring>& warnings)
        {
            std::filesystem::create_directories(overlayDirectory);
            const std::filesystem::path sourceConfig = executableDirectory / L"Config.xml";
            const std::filesystem::path overlayConfig = overlayDirectory / L"Config.xml";
            const std::filesystem::path sourcePreferences = executableDirectory / L"BodySlide.xml";
            const std::filesystem::path overlayPreferences = overlayDirectory / L"BodySlide.xml";

            if (!std::filesystem::exists(overlayPreferences) &&
                std::filesystem::is_regular_file(sourcePreferences))
            {
                try
                {
                    const std::string preferences = readFileBytes(sourcePreferences, maximumManagedXmlBytes);
                    static_cast<void>(fromUtf8(preferences));
                    atomicWriteUtf8(overlayPreferences, preferences, L"BodySlide user preferences");
                }
                catch (const std::exception&)
                {
                    warnings.push_back(L"BodySlide.xml не скопирован: файл повреждён или слишком велик.");
                }
            }

            std::string xml;
            bool recovered = false;
            const std::filesystem::path selectedSource =
                std::filesystem::is_regular_file(overlayConfig) ? overlayConfig : sourceConfig;
            if (std::filesystem::is_regular_file(selectedSource))
            {
                try
                {
                    xml = readFileBytes(selectedSource, maximumManagedXmlBytes);
                }
                catch (...)
                {
                    xml.clear();
                }
            }

            if (xml.empty() || !isWellFormedBodySlideConfig(xml))
            {
                if (!xml.empty())
                {
                    const std::filesystem::path recoveryDirectory = overlayDirectory / L"recovery";
                    std::filesystem::create_directories(recoveryDirectory);
                    atomicWriteUtf8(
                        recoveryFilePath(recoveryDirectory),
                        xml,
                        L"BodySlide damaged config recovery");
                    warnings.push_back(
                        L"Повреждённый Config.xml сохранён в recovery; создан безопасный overlay.");
                    recovered = true;
                }
                xml = minimalConfig(gameData, projectPath);
            }
            else
            {
                const std::wstring gameDataPrefix = bodySlideDirectoryPrefix(gameData);
                setRootElement(xml, "TargetGame", L"4");
                setSkyrimSeDataPath(xml, gameDataPrefix);
                setRootElement(xml, "GameDataPath", gameDataPrefix);
                setRootElement(xml, "OutputDataPath", gameDataPrefix);
                setRootElement(xml, "ProjectPath", projectPath.wstring());
            }

            if (!isWellFormedBodySlideConfig(xml))
            {
                throw std::runtime_error("Managed BodySlide Config.xml could not be produced safely.");
            }
            atomicWriteUtf8(overlayConfig, xml, L"BodySlide managed Config.xml");
            return recovered ? L"recovered" : L"configured";
        }

        std::optional<InstalledModRecord> findInstalledByFolder(
            const std::vector<InstalledModRecord>& mods,
            std::wstring_view folderName)
        {
            const std::wstring expected = toLower(std::wstring(folderName));
            const auto match = std::find_if(
                mods.begin(),
                mods.end(),
                [&expected](const InstalledModRecord& mod)
                {
                    return toLower(mod.folderName) == expected &&
                        (mod.state == L"installed" || mod.state == L"disabled");
                });
            return match == mods.end() ? std::nullopt : std::optional<InstalledModRecord>(*match);
        }

        std::optional<InstalledModRecord> findInstalledByUuid(
            const std::vector<InstalledModRecord>& mods,
            std::wstring_view modUuid)
        {
            const auto match = std::find_if(
                mods.begin(),
                mods.end(),
                [modUuid](const InstalledModRecord& mod)
                {
                    return mod.uuid == modUuid;
                });
            return match == mods.end() ? std::nullopt : std::optional<InstalledModRecord>(*match);
        }

        ManagedOutputMod toManagedOutput(const InstalledModRecord& record)
        {
            return ManagedOutputMod{
                record.uuid,
                record.displayName,
                record.folderName,
                record.path,
                std::wstring(bodySlideGeneratedProvider)};
        }

        void ensureOutputLastInProfile(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory,
            std::wstring_view profileName,
            const ManagedOutputMod& output)
        {
            InstanceMetadataStore::ensureProfileState(projectDirectory, profileName, modsDirectory);
            const std::vector<ProfileOrderItemRecord> current =
                InstanceMetadataStore::listCachedProfileOrderItems(
                    projectDirectory,
                    profileName,
                    modsDirectory);
            std::vector<ProfileOrderImportItemRecord> ordered;
            ordered.reserve(current.size() + 1);
            for (const ProfileOrderItemRecord& item : current)
            {
                if (item.kind == L"separator")
                {
                    ordered.push_back(ProfileOrderImportItemRecord{
                        L"separator",
                        {},
                        item.separatorTitle});
                }
                else if (item.hasMod && item.mod.uuid != output.id &&
                    toLower(item.mod.folderName) != toLower(output.folderName))
                {
                    ordered.push_back(ProfileOrderImportItemRecord{
                        L"mod",
                        item.mod.folderName,
                        {}});
                }
            }
            ordered.push_back(ProfileOrderImportItemRecord{L"mod", output.folderName, {}});
            InstanceMetadataStore::replaceProfileOrderItems(projectDirectory, profileName, ordered);
            InstanceMetadataStore::setInstalledModEnabled(projectDirectory, output.path, true);
        }

        ManagedOutputMod ensureOutputMod(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modsDirectory,
            std::wstring_view projectName,
            std::wstring_view activeProfile)
        {
            const std::wstring effectiveProjectName = projectName.empty()
                ? projectDirectory.filename().wstring()
                : std::wstring(projectName);
            const std::wstring displayName = effectiveProjectName + L" - BodySlide Output";
            const std::wstring folderName = safePathSegment(displayName, L"BodySlide Output");
            const std::filesystem::path desiredPath = modsDirectory / folderName;
            const std::filesystem::path statePath = integrationRoot(projectDirectory) / outputStateFileName;

            std::vector<InstalledModRecord> installed =
                InstanceMetadataStore::listInstalledMods(projectDirectory, modsDirectory);
            std::optional<OutputState> persisted;
            try
            {
                persisted = readOutputState(statePath);
            }
            catch (const std::exception& exception)
            {
                throwIntegrationError(
                    L"BODYSLIDE_CONFIGURATION_FAILED",
                    L"Состояние BodySlide Output повреждено: " + fromUtf8(exception.what()));
            }

            InstalledModRecord record;
            bool hasRecord = false;
            if (persisted.has_value())
            {
                if (const std::optional<InstalledModRecord> byUuid =
                        findInstalledByUuid(installed, persisted->modUuid);
                    byUuid.has_value())
                {
                    record = *byUuid;
                    hasRecord = true;
                }
                else if (const std::optional<InstalledModRecord> byFolder =
                             findInstalledByFolder(installed, persisted->folderName);
                         byFolder.has_value())
                {
                    record = *byFolder;
                    hasRecord = true;
                }
                if (hasRecord && record.source.provider != bodySlideGeneratedProvider)
                {
                    throwIntegrationError(
                        L"BODYSLIDE_CONFIGURATION_FAILED",
                        L"Fluxora не может подтвердить принадлежность существующего BodySlide Output.");
                }
                if (!hasRecord && std::filesystem::exists(modsDirectory / persisted->folderName))
                {
                    throwIntegrationError(
                        L"BODYSLIDE_OUTPUT_CONFLICT",
                        L"Каталог прежнего BodySlide Output существует, но его принадлежность не подтверждена.");
                }
            }
            else if (const std::optional<InstalledModRecord> existing =
                         findInstalledByFolder(installed, folderName);
                     existing.has_value())
            {
                if (existing->source.provider != bodySlideGeneratedProvider)
                {
                    throwIntegrationError(
                        L"BODYSLIDE_OUTPUT_CONFLICT",
                        L"Имя BodySlide Output уже занято пользовательским модом.");
                }
                record = *existing;
                hasRecord = true;
            }

            if (hasRecord && !samePath(record.path, desiredPath))
            {
                if (std::filesystem::exists(desiredPath))
                {
                    throwIntegrationError(
                        L"BODYSLIDE_OUTPUT_CONFLICT",
                        L"Новое имя BodySlide Output уже занято; существующие данные не изменены.");
                }
                const std::filesystem::path currentPath = modsDirectory / record.folderName;
                try
                {
                    record = InstanceMetadataStore::renameInstalledMod(
                        projectDirectory,
                        currentPath,
                        desiredPath,
                        displayName);
                }
                catch (const std::exception& exception)
                {
                    throwIntegrationError(
                        L"BODYSLIDE_CONFIGURATION_FAILED",
                        L"BodySlide Output не удалось безопасно переименовать: " + fromUtf8(exception.what()));
                }
            }

            if (!hasRecord)
            {
                if (std::filesystem::exists(desiredPath))
                {
                    throwIntegrationError(
                        L"BODYSLIDE_OUTPUT_CONFLICT",
                        L"Имя BodySlide Output уже занято; каталог не будет перезаписан.");
                }
                std::filesystem::create_directories(desiredPath);
                ModSourceRecord source;
                source.provider = std::wstring(bodySlideGeneratedProvider);
                try
                {
                    record = InstanceMetadataStore::registerInstalledMod(
                        projectDirectory,
                        desiredPath,
                        displayName,
                        {},
                        source);
                }
                catch (...)
                {
                    std::error_code cleanupError;
                    std::filesystem::remove(desiredPath, cleanupError);
                    throw;
                }
            }

            ManagedOutputMod output = toManagedOutput(record);
            output.displayName = displayName;
            output.folderName = folderName;
            output.path = desiredPath;
            writeOutputState(statePath, output);

            std::set<std::wstring> profiles;
            for (const std::wstring& profile : InstanceMetadataStore::listProfileNames(projectDirectory))
            {
                profiles.insert(profile.empty() ? L"Default" : profile);
            }
            profiles.insert(activeProfile.empty() ? L"Default" : std::wstring(activeProfile));
            for (const std::wstring& profile : profiles)
            {
                ensureOutputLastInProfile(projectDirectory, modsDirectory, profile, output);
            }
            return output;
        }

        std::filesystem::path findProjectRelativeDirectory(
            const ResolvedExecutableLaunch& resolved,
            const std::vector<ExecutableLaunchMod>& activeMods)
        {
            const std::filesystem::path executableDirectory =
                normalizedCanonicalPath(resolved.resolvedExecutablePath.parent_path());
            for (const ExecutableLaunchMod& mod : activeMods)
            {
                if (isContainedPath(mod.path, executableDirectory))
                {
                    const std::filesystem::path relative = executableDirectory.lexically_relative(
                        normalizedCanonicalPath(mod.path));
                    if (!relative.empty() && !relative.is_absolute())
                    {
                        return relative;
                    }
                }
            }
            const std::array<std::filesystem::path, 2> conventional{
                std::filesystem::path(L"CalienteTools") / L"BodySlide",
                std::filesystem::path(L"Tools") / L"BodySlide"};
            for (const std::filesystem::path& relative : conventional)
            {
                for (const ExecutableLaunchMod& mod : activeMods)
                {
                    if (std::filesystem::is_directory(mod.path / relative))
                    {
                        return relative;
                    }
                }
            }
            throwIntegrationError(
                L"BODYSLIDE_CONFIGURATION_FAILED",
                L"Каталог проекта BodySlide не найден в активном VFS-профиле.");
        }

        void validateBodySlideExecutable(const ResolvedExecutableLaunch& resolved)
        {
#ifndef _WIN32
            static_cast<void>(resolved);
            throwIntegrationError(
                L"BODYSLIDE_PLATFORM_UNSUPPORTED",
                L"Управляемый запуск BodySlide поддерживается только на Windows.");
#else
            if (resolved.gameId.value() != skyrimSeGameId)
            {
                throwIntegrationError(
                    L"BODYSLIDE_GAME_UNSUPPORTED",
                    L"BodySlide v1 поддерживает только Skyrim SE/AE.");
            }
            bool isX86 = false;
            if (!isX64PeExecutable(resolved.resolvedExecutablePath, isX86))
            {
                throwIntegrationError(
                    isX86 ? L"BODYSLIDE_X86_UNSUPPORTED" : L"BODYSLIDE_RUNTIME_INVALID",
                    isX86
                        ? L"32-битный BodySlide не поддерживается; требуется официальный x64 executable."
                        : L"BodySlide executable не является корректным x64 PE-файлом.");
            }
            const std::filesystem::path resources =
                resolved.resolvedExecutablePath.parent_path() / L"res";
            std::error_code error;
            if (!std::filesystem::is_directory(resources, error) ||
                std::filesystem::directory_iterator(resources, error) ==
                    std::filesystem::directory_iterator())
            {
                throwIntegrationError(
                    L"BODYSLIDE_RUNTIME_INVALID",
                    L"Рядом с BodySlide отсутствуют ожидаемые runtime-ресурсы (res).");
            }
#endif
        }

        ManagedLaunchCompletion finalizeSession(
            const std::filesystem::path& statePath,
            SessionState state,
            std::wstring_view outcome)
        {
            ManagedLaunchCompletion completion;
            completion.sessionId = state.sessionId;
            completion.outcome = state.outcome.empty() ? std::wstring(outcome) : state.outcome;
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
                    L"Процесс BodySlide ещё работает; обновление output отложено.");
                return completion;
            }
            if (!isContainedPath(state.modsDirectory, state.outputMod.path) ||
                state.outputMod.provider != bodySlideGeneratedProvider)
            {
                throwIntegrationError(
                    L"BODYSLIDE_CONFIGURATION_FAILED",
                    L"Путь BodySlide Output в сессии не прошёл проверку безопасности.");
            }

            ModSourceRecord source;
            source.provider = std::wstring(bodySlideGeneratedProvider);
            const InstalledModRecord refreshed = InstanceMetadataStore::registerInstalledMod(
                state.projectDirectory,
                state.outputMod.path,
                state.outputMod.displayName,
                {},
                source);
            state.outputMod = toManagedOutput(refreshed);
            InstanceMetadataStore::invalidateModFileCaches(
                state.projectDirectory,
                {state.outputMod.path},
                state.outputMod.path.parent_path());
            state.status = L"completed";
            state.outcome = std::wstring(outcome);
            writeSessionState(statePath, state);

            const std::filesystem::path root = integrationRoot(state.projectDirectory);
            std::error_code error;
            std::filesystem::remove(root / activeSessionFileName, error);
            error.clear();
            std::filesystem::remove(root / activeSessionLockName, error);

            completion.outcome = state.outcome;
            completion.outputMod = state.outputMod;
            completion.finalized = true;
            return completion;
        }
    }

    BodySlideIntegrationError::BodySlideIntegrationError(
        std::wstring code,
        std::string message)
        : std::runtime_error(std::move(message)),
          code_(std::move(code))
    {
    }

    const std::wstring& BodySlideIntegrationError::code() const noexcept
    {
        return code_;
    }

    BodySlideIntegrationService::BodySlideIntegrationService(
        Logger& logger,
        const BuildPathSettingsService& pathSettings) noexcept
        : logger_(logger),
          pathSettings_(pathSettings)
    {
    }

    void BodySlideIntegrationService::initialize()
    {
        initialized_ = true;
        logger_.write(LogLevel::Info, "BodySlide integration service initialized.");
    }

    void BodySlideIntegrationService::shutdown()
    {
        initialized_ = false;
        const std::lock_guard lock(sessionRegistryMutex_);
        sessionRegistry_.clear();
        logger_.write(LogLevel::Info, "BodySlide integration service shut down.");
    }

    std::wstring BodySlideIntegrationService::detectManagedToolKind(
        const GameExecutable&,
        const std::filesystem::path& resolvedExecutablePath)
    {
        const std::wstring fileName = toLower(resolvedExecutablePath.filename().wstring());
        return fileName == L"bodyslide.exe" || fileName == L"bodyslide x64.exe"
            ? std::wstring(bodySlideManagedToolKind)
            : std::wstring{};
    }

    void BodySlideIntegrationService::preflightProjectRename(
        const std::filesystem::path& projectDirectory,
        std::wstring_view newProjectName) const
    {
        const std::filesystem::path root = integrationRoot(projectDirectory);
        if (std::filesystem::exists(root / activeSessionLockName))
        {
            try
            {
                const SessionState active = readSessionState(root / activeSessionFileName);
                if (processIsAlive(active.processId) ||
                    (active.processId == 0 && processIsAlive(active.managerProcessId)))
                {
                    throwIntegrationError(
                        L"BODYSLIDE_SESSION_ACTIVE",
                        L"Сборку нельзя переименовать во время активной сессии BodySlide.");
                }
            }
            catch (const BodySlideIntegrationError&)
            {
                throw;
            }
            catch (const std::exception&)
            {
                // A dead or damaged lease is recovered by the next managed
                // launch. It does not authorize overwriting an output target.
            }
        }
        const std::filesystem::path statePath =
            root / outputStateFileName;
        std::optional<OutputState> state;
        try
        {
            state = readOutputState(statePath);
        }
        catch (const std::exception& exception)
        {
            throwIntegrationError(
                L"BODYSLIDE_CONFIGURATION_FAILED",
                L"Состояние BodySlide Output повреждено: " + fromUtf8(exception.what()));
        }
        if (!state.has_value())
        {
            return;
        }

        const BuildPathSettings settings = pathSettings_.loadForProjectDirectory(projectDirectory);
        const std::wstring displayName = std::wstring(newProjectName) + L" - BodySlide Output";
        const std::filesystem::path desiredPath =
            settings.modsDirectory / safePathSegment(displayName, L"BodySlide Output");
        const std::optional<InstalledModRecord> owned = findInstalledByUuid(
            InstanceMetadataStore::listInstalledMods(projectDirectory, settings.modsDirectory),
            state->modUuid);
        if (!owned.has_value() || owned->source.provider != bodySlideGeneratedProvider)
        {
            throwIntegrationError(
                L"BODYSLIDE_CONFIGURATION_FAILED",
                L"Fluxora не может подтвердить принадлежность BodySlide Output перед переименованием.");
        }
        if (!samePath(owned->path, desiredPath) && std::filesystem::exists(desiredPath))
        {
            throwIntegrationError(
                L"BODYSLIDE_OUTPUT_CONFLICT",
                L"Новое имя BodySlide Output уже занято; сборка не переименована.");
        }
    }

    void BodySlideIntegrationService::completeProjectRename(
        const std::filesystem::path& projectDirectory,
        std::wstring_view newProjectName) const
    {
        const std::filesystem::path statePath =
            integrationRoot(projectDirectory) / outputStateFileName;
        if (!std::filesystem::is_regular_file(statePath))
        {
            return;
        }
        const BuildPathSettings settings = pathSettings_.loadForProjectDirectory(projectDirectory);
        OutputState state;
        try
        {
            const std::optional<OutputState> persisted = readOutputState(statePath);
            if (!persisted.has_value())
            {
                return;
            }
            state = *persisted;
        }
        catch (const std::exception& exception)
        {
            throwIntegrationError(
                L"BODYSLIDE_CONFIGURATION_FAILED",
                L"Состояние BodySlide Output повреждено: " + fromUtf8(exception.what()));
        }

        const std::optional<InstalledModRecord> owned = findInstalledByUuid(
            InstanceMetadataStore::listInstalledMods(projectDirectory, settings.modsDirectory),
            state.modUuid);
        if (!owned.has_value() || owned->source.provider != bodySlideGeneratedProvider)
        {
            throwIntegrationError(
                L"BODYSLIDE_CONFIGURATION_FAILED",
                L"Fluxora не может подтвердить принадлежность BodySlide Output после переименования сборки.");
        }

        const std::wstring displayName = std::wstring(newProjectName) + L" - BodySlide Output";
        const std::wstring folderName = safePathSegment(displayName, L"BodySlide Output");
        const std::filesystem::path desiredPath = settings.modsDirectory / folderName;
        if (samePath(owned->path, desiredPath) && owned->displayName == displayName)
        {
            return;
        }
        if (!samePath(owned->path, desiredPath) && std::filesystem::exists(desiredPath))
        {
            throwIntegrationError(
                L"BODYSLIDE_OUTPUT_CONFLICT",
                L"Новое имя BodySlide Output уже занято; существующие данные не изменены.");
        }

        InstalledModRecord renamed;
        try
        {
            renamed = InstanceMetadataStore::renameInstalledMod(
                projectDirectory,
                owned->path,
                desiredPath,
                displayName);
            writeOutputState(statePath, toManagedOutput(renamed));
        }
        catch (const BodySlideIntegrationError&)
        {
            throw;
        }
        catch (const std::exception& exception)
        {
            if (!renamed.uuid.empty() && std::filesystem::exists(desiredPath) &&
                !std::filesystem::exists(owned->path))
            {
                try
                {
                    static_cast<void>(InstanceMetadataStore::renameInstalledMod(
                        projectDirectory,
                        desiredPath,
                        owned->path,
                        owned->displayName));
                    writeOutputState(statePath, toManagedOutput(*owned));
                }
                catch (...)
                {
                }
            }
            throwIntegrationError(
                L"BODYSLIDE_CONFIGURATION_FAILED",
                L"BodySlide Output не удалось безопасно переименовать: " + fromUtf8(exception.what()));
        }
    }

    BodySlideLaunchPreparation BodySlideIntegrationService::prepareLaunch(
        const std::filesystem::path& configPath,
        const ResolvedExecutableLaunch& resolved,
        std::wstring_view profileName) const
    {
        const BuildPathSettings settings = pathSettings_.loadForConfig(configPath);
        if (settings.gameDirectory.empty() || settings.modsDirectory.empty())
        {
            throwIntegrationError(
                L"BODYSLIDE_CONFIGURATION_FAILED",
                L"Для сборки не настроены каталоги игры и модов.");
        }
        if (!isContainedPath(resolved.projectDirectory, resolved.resolvedExecutablePath) &&
            !isContainedPath(settings.modsDirectory, resolved.resolvedExecutablePath))
        {
            throwIntegrationError(
                L"BODYSLIDE_EXTERNAL_TOOL",
                L"Внешний BodySlide не изменяется. Импортировать BodySlide в сборку.");
        }
        validateBodySlideExecutable(resolved);

        BodySlideLaunchPreparation preparation;
        preparation.outputMod = ensureOutputMod(
            resolved.projectDirectory,
            settings.modsDirectory,
            resolved.projectName,
            profileName.empty() ? resolved.defaultProfile : profileName);
        preparation.activeProfileMods.reserve(resolved.activeProfileMods.size());
        for (const ExecutableLaunchMod& mod : resolved.activeProfileMods)
        {
            if (!samePath(mod.path, preparation.outputMod.path))
            {
                preparation.activeProfileMods.push_back(mod);
            }
        }
        preparation.projectRelativeDirectory = findProjectRelativeDirectory(
            resolved,
            preparation.activeProfileMods);
        const std::wstring dataDirectory = resolved.dataDirectory.empty()
            ? L"Data"
            : resolved.dataDirectory;
        const std::filesystem::path gameData =
            normalizedCanonicalPath(settings.gameDirectory / dataDirectory);
        preparation.virtualProjectPath =
            normalizedCanonicalPath(gameData / preparation.projectRelativeDirectory);

        const std::wstring executableId = safePathSegment(resolved.executable.id, L"bodyslide");
        preparation.configOverlayDirectory =
            integrationRoot(resolved.projectDirectory) / executableId;
        if (!isContainedPath(resolved.projectDirectory, preparation.configOverlayDirectory) ||
            !isContainedPath(settings.modsDirectory, preparation.outputMod.path))
        {
            throwIntegrationError(
                L"BODYSLIDE_CONFIGURATION_FAILED",
                L"Управляемый путь BodySlide вышел за разрешённые каталоги сборки.");
        }
        try
        {
            preparation.configurationStatus = prepareConfigOverlay(
                resolved.resolvedExecutablePath.parent_path(),
                preparation.configOverlayDirectory,
                gameData,
                preparation.virtualProjectPath,
                preparation.warnings);
        }
        catch (const BodySlideIntegrationError&)
        {
            throw;
        }
        catch (const std::exception& exception)
        {
            throwIntegrationError(
                L"BODYSLIDE_CONFIGURATION_FAILED",
                L"Не удалось подготовить Config.xml: " + fromUtf8(exception.what()));
        }

        const std::filesystem::path root = integrationRoot(resolved.projectDirectory);
        const std::filesystem::path activePath = root / activeSessionFileName;
        const std::filesystem::path lockPath = root / activeSessionLockName;
        std::filesystem::create_directories(root / L"sessions");
        if (std::filesystem::exists(lockPath))
        {
            try
            {
                const SessionState active = readSessionState(activePath);
                if (processIsAlive(active.processId) ||
                    (active.processId == 0 && processIsAlive(active.managerProcessId)))
                {
                    throwIntegrationError(
                        L"BODYSLIDE_SESSION_ACTIVE",
                        L"Для этой сборки уже запущена управляемая сессия BodySlide.");
                }
                const std::filesystem::path stalePath = sessionPath(root, active.sessionId);
                static_cast<void>(finalizeSession(stalePath, active, L"stale-recovered"));
                preparation.warnings.push_back(
                    L"Мёртвая BodySlide-сессия восстановлена, output обновлён.");
            }
            catch (const BodySlideIntegrationError&)
            {
                throw;
            }
            catch (const std::exception&)
            {
                std::error_code cleanupError;
                std::filesystem::remove(activePath, cleanupError);
                cleanupError.clear();
                std::filesystem::remove_all(lockPath, cleanupError);
                preparation.warnings.push_back(
                    L"Повреждённый stale lease удалён после проверки PID.");
            }
        }

        std::error_code leaseError;
        if (!std::filesystem::create_directory(lockPath, leaseError))
        {
            throwIntegrationError(
                L"BODYSLIDE_SESSION_ACTIVE",
                L"Не удалось получить эксклюзивный lease BodySlide для этой сборки.");
        }
        preparation.sessionId = generateSessionId();
        const std::filesystem::path statePath = sessionPath(root, preparation.sessionId);
        SessionState state;
        state.sessionId = preparation.sessionId;
        state.configPath = normalizedCanonicalPath(configPath);
        state.projectDirectory = normalizedCanonicalPath(resolved.projectDirectory);
        state.modsDirectory = normalizedCanonicalPath(settings.modsDirectory);
        state.outputMod = preparation.outputMod;
#ifdef _WIN32
        state.managerProcessId = GetCurrentProcessId();
#endif
        try
        {
            writeSessionState(statePath, state);
            writeSessionState(activePath, state);
        }
        catch (...)
        {
            std::error_code cleanupError;
            std::filesystem::remove(activePath, cleanupError);
            cleanupError.clear();
            std::filesystem::remove(lockPath, cleanupError);
            throw;
        }
        {
            const std::lock_guard lock(sessionRegistryMutex_);
            sessionRegistry_[preparation.sessionId] = statePath;
        }
        logger_.writeOperation(
            LogLevel::Info,
            "BodySlide",
            "Prepared managed BodySlide session id=\"" + toUtf8(preparation.sessionId) +
                "\", output=\"" + toUtf8(preparation.outputMod.path.wstring()) + "\".");
        return preparation;
    }

    void BodySlideIntegrationService::applyVfsPolicy(
        std::vector<VfsMountDescriptor>& mounts,
        const ResolvedExecutableLaunch& resolved,
        const BodySlideLaunchPreparation& preparation) const
    {
        const BuildPathSettings settings = pathSettings_.loadForProjectDirectory(
            resolved.projectDirectory);
        const std::wstring dataDirectory = resolved.dataDirectory.empty()
            ? L"Data"
            : resolved.dataDirectory;
        const std::filesystem::path dataTarget =
            normalizedCanonicalPath(resolved.gamePath / dataDirectory);
        auto dataMount = std::find_if(
            mounts.begin(),
            mounts.end(),
            [&dataTarget](const VfsMountDescriptor& mount)
            {
                return samePath(mount.target, dataTarget);
            });
        if (dataMount == mounts.end())
        {
            mounts.push_back(VfsMountDescriptor{dataTarget, {}, {}});
            dataMount = std::prev(mounts.end());
        }

        dataMount->mods.erase(
            std::remove_if(
                dataMount->mods.begin(),
                dataMount->mods.end(),
                [&preparation](const std::filesystem::path& path)
                {
                    return samePath(path, preparation.outputMod.path);
                }),
            dataMount->mods.end());
        const std::filesystem::path normalOverwrite = dataMount->overwrite.empty()
            ? settings.overwriteDirectory
            : dataMount->overwrite;
        if (!normalOverwrite.empty())
        {
            dataMount->mods.push_back(normalOverwrite);
        }
        dataMount->mods.push_back(preparation.outputMod.path);
        dataMount->overwrite = preparation.outputMod.path;

        mounts.push_back(VfsMountDescriptor{
            normalizedCanonicalPath(resolved.resolvedExecutablePath.parent_path()),
            normalizedCanonicalPath(preparation.configOverlayDirectory),
            {}});
    }

    void BodySlideIntegrationService::bindProcess(
        std::wstring_view sessionId,
        std::uint32_t processId) const
    {
        if (sessionId.empty() || processId == 0)
        {
            throw std::invalid_argument("Managed BodySlide session and process ids are required.");
        }
        std::filesystem::path statePath;
        {
            const std::lock_guard lock(sessionRegistryMutex_);
            const auto found = sessionRegistry_.find(std::wstring(sessionId));
            if (found == sessionRegistry_.end())
            {
                throwIntegrationError(
                    L"BODYSLIDE_SESSION_NOT_FOUND",
                    L"Управляемая сессия BodySlide не найдена.");
            }
            statePath = found->second;
        }
        SessionState state = readSessionState(statePath);
        state.processId = processId;
        state.status = L"running";
        writeSessionState(statePath, state);
        writeSessionState(
            integrationRoot(state.projectDirectory) / activeSessionFileName,
            state);
    }

    void BodySlideIntegrationService::abandonLaunch(std::wstring_view sessionId) const noexcept
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
            }
            SessionState state = readSessionState(statePath);
            state.status = L"abandoned";
            state.outcome = L"launch-failed";
            writeSessionState(statePath, state);
            const std::filesystem::path root = integrationRoot(state.projectDirectory);
            std::error_code error;
            std::filesystem::remove(root / activeSessionFileName, error);
            error.clear();
            std::filesystem::remove(root / activeSessionLockName, error);
        }
        catch (...)
        {
        }
    }

    ManagedLaunchCompletion BodySlideIntegrationService::completeManagedLaunch(
        std::wstring_view sessionId,
        std::wstring_view outcome) const
    {
        if (sessionId.empty())
        {
            throw std::invalid_argument("Managed BodySlide session id is required.");
        }
        const std::set<std::wstring> supportedOutcomes{
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
            throw std::invalid_argument("Managed BodySlide completion outcome is invalid.");
        }

        std::filesystem::path statePath;
        {
            const std::lock_guard lock(sessionRegistryMutex_);
            const auto found = sessionRegistry_.find(std::wstring(sessionId));
            if (found == sessionRegistry_.end())
            {
                throwIntegrationError(
                    L"BODYSLIDE_SESSION_NOT_FOUND",
                    L"Управляемая сессия BodySlide не найдена.");
            }
            statePath = found->second;
        }
        SessionState state = readSessionState(statePath);
        if (state.sessionId != sessionId)
        {
            throwIntegrationError(
                L"BODYSLIDE_SESSION_NOT_FOUND",
                L"Идентификатор BodySlide-сессии не совпадает с сохранённым lease.");
        }
        ManagedLaunchCompletion completion = finalizeSession(
            statePath,
            std::move(state),
            normalizedOutcome);
        logger_.writeOperation(
            LogLevel::Info,
            "BodySlide",
            "Completed managed BodySlide session id=\"" + toUtf8(sessionId) +
                "\", finalized=" + std::to_string(completion.finalized ? 1 : 0) + ".");
        return completion;
    }

    bool BodySlideIntegrationService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
