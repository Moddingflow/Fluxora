#include "FluxoraCore/Services/BuildFileWorkspaceService.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/BuildFileDiscoveryService.hpp"
#include "FluxoraCore/Services/ConfigRecipeRegistry.hpp"
#include "FluxoraCore/Services/FluxPackPackage.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ManagedAiOverrideService.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cwctype>
#include <fstream>
#include <iomanip>
#include <map>
#include <mutex>
#include <optional>
#include <set>
#include <sstream>
#include <unordered_map>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::uintmax_t maximumFileBytes = 5ull * 1024ull * 1024ull;
        constexpr std::size_t maximumChangedTextBytes = 2ull * 1024ull * 1024ull;
        constexpr std::size_t maximumBatchFiles = 16;
        constexpr std::size_t maximumSearchResults = 20;
        constexpr std::size_t maximumSearchCandidatesPerPage = 512;
        constexpr std::size_t maximumSearchTraversalEntriesPerPage = 100'000;

        [[nodiscard]] std::wstring lower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        [[nodiscard]] std::wstring normalizedSearchText(std::wstring value)
        {
            value = lower(std::move(value));
            value.erase(
                std::remove_if(value.begin(), value.end(), [](wchar_t character)
                {
                    return std::iswspace(character) ||
                        character == L'_' ||
                        character == L'-' ||
                        character == L'.' ||
                        character == L'/' ||
                        character == L'\\';
                }),
                value.end());
            return value;
        }

        [[nodiscard]] std::wstring normalizedRelative(
            const std::filesystem::path& path)
        {
            return path.lexically_normal().generic_wstring();
        }

        [[nodiscard]] std::string narrowAscii(std::wstring_view value)
        {
            std::string result;
            result.reserve(value.size());
            for (const wchar_t character : value)
            {
                result.push_back(character <= 0x7f ? static_cast<char>(character) : '_');
            }
            return result;
        }

        [[nodiscard]] std::filesystem::path checkpointBaseDirectory()
        {
#ifdef _WIN32
            const DWORD required = GetEnvironmentVariableW(L"FLUXORA_APP_ROOT", nullptr, 0);
            if (required > 0)
            {
                std::wstring value(required, L'\0');
                const DWORD actual = GetEnvironmentVariableW(
                    L"FLUXORA_APP_ROOT",
                    value.data(),
                    required);
                if (actual > 0 && actual < required)
                {
                    value.resize(actual);
                    return std::filesystem::path(value) / L".fluxora" / L"ai-checkpoints";
                }
            }
#else
            if (const char* value = std::getenv("FLUXORA_APP_ROOT"))
            {
                return std::filesystem::path(value) / ".fluxora" / "ai-checkpoints";
            }
#endif
            return std::filesystem::temp_directory_path() / L"Fluxora" / L"ai-checkpoints";
        }

        [[nodiscard]] std::wstring opaqueToken(
            std::wstring_view prefix,
            std::atomic<std::uint64_t>& sequence)
        {
            const auto now = std::chrono::steady_clock::now().time_since_epoch().count();
            const std::uint64_t id = sequence.fetch_add(1, std::memory_order_relaxed) + 1;
            std::wostringstream stream;
            stream << prefix << L'_' << std::hex << now << L'_' << id;
            return stream.str();
        }

        [[nodiscard]] std::wstring checkpointSegment(std::wstring_view chatId)
        {
            const std::size_t hash = std::hash<std::wstring_view>{}(chatId);
            std::wostringstream stream;
            stream << L"chat_" << std::hex << hash;
            return stream.str();
        }

        [[nodiscard]] std::vector<char> readBytes(
            const std::filesystem::path& path,
            std::uintmax_t maximum = maximumFileBytes)
        {
            std::error_code error;
            const std::uintmax_t size = std::filesystem::file_size(path, error);
            if (error)
            {
                throw BuildFileWorkspaceError("permission-denied", "File size could not be read.");
            }
            if (size > maximum)
            {
                throw BuildFileWorkspaceError("too-large", "File exceeds the AI workspace size limit.");
            }

            std::ifstream stream(path, std::ios::binary);
            if (!stream)
            {
                throw BuildFileWorkspaceError("permission-denied", "File could not be opened.");
            }
            std::vector<char> bytes(static_cast<std::size_t>(size));
            if (!bytes.empty())
            {
                stream.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
                if (!stream)
                {
                    throw BuildFileWorkspaceError("locked", "File could not be read completely.");
                }
            }
            return bytes;
        }

        void writeCheckpoint(
            const std::filesystem::path& path,
            const std::vector<char>& bytes)
        {
            std::filesystem::create_directories(path.parent_path());
            std::ofstream stream(path, std::ios::binary | std::ios::trunc);
            if (!stream)
            {
                throw BuildFileWorkspaceError("permission-denied", "Checkpoint could not be created.");
            }
            if (!bytes.empty())
            {
                stream.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
            }
            if (!stream)
            {
                throw BuildFileWorkspaceError("permission-denied", "Checkpoint could not be completed.");
            }
        }

        [[nodiscard]] std::wstring sha256(const std::vector<char>& bytes)
        {
            return computeFluxPackBytesSha256(bytes.data(), bytes.size());
        }

        [[nodiscard]] std::wstring fileTimeText(
            const std::filesystem::file_time_type& value)
        {
            return std::to_wstring(value.time_since_epoch().count());
        }

        [[nodiscard]] std::wstring versionFor(
            const std::filesystem::path& path,
            std::wstring_view contentHash = {})
        {
            std::error_code error;
            const std::uintmax_t size = std::filesystem::is_regular_file(path, error)
                ? std::filesystem::file_size(path, error)
                : 0;
            error.clear();
            const auto modified = std::filesystem::last_write_time(path, error);
            std::wstring version = L"v1:" + std::to_wstring(size) + L":" +
                (error ? L"unknown" : fileTimeText(modified));
            if (!contentHash.empty())
            {
                version += L":" + std::wstring(contentHash.substr(0, 12));
            }
            return version;
        }

        [[nodiscard]] bool isAllowedTextExtension(std::wstring extension)
        {
            static const std::set<std::wstring> extensions{
                L".txt", L".md", L".json", L".jsonc", L".ini", L".cfg",
                L".conf", L".xml", L".yaml", L".yml", L".toml", L".csv", L".log"
            };
            return extensions.contains(lower(std::move(extension)));
        }

        [[nodiscard]] bool isArchiveExtension(std::wstring extension)
        {
            static const std::set<std::wstring> extensions{L".zip", L".7z", L".rar"};
            return extensions.contains(lower(std::move(extension)));
        }

        [[nodiscard]] BuildFileKind kindFor(const std::filesystem::path& path)
        {
            std::error_code error;
            if (std::filesystem::is_directory(path, error))
            {
                return BuildFileKind::Directory;
            }
            if (!std::filesystem::is_regular_file(path, error))
            {
                return BuildFileKind::Unsupported;
            }
            if (isAllowedTextExtension(path.extension().wstring()))
            {
                return BuildFileKind::Text;
            }
            if (isArchiveExtension(path.extension().wstring()))
            {
                return BuildFileKind::Archive;
            }
            return BuildFileKind::Unsupported;
        }

        [[nodiscard]] bool isProtectedRelativePath(
            const std::filesystem::path& relativePath)
        {
            const std::wstring normalized = lower(relativePath.generic_wstring());
            const std::wstring fileName = lower(relativePath.filename().wstring());
            if (normalized == L".fluxora" || normalized.starts_with(L".fluxora/"))
            {
                return true;
            }
            if (fileName.ends_with(L".fluxora.json") ||
                fileName.ends_with(L".sqlite") ||
                fileName.ends_with(L".sqlite3") ||
                fileName.ends_with(L".db") ||
                fileName.ends_with(L".tmp") ||
                fileName.ends_with(L".checkpoint") ||
                fileName.ends_with(L".progress.json"))
            {
                return true;
            }
            return fileName == L"modlist.txt" ||
                fileName == L"plugins.txt" ||
                fileName == L"loadorder.txt" ||
                fileName == L"lockedorder.txt" ||
                fileName == L"archives.txt";
        }

        [[nodiscard]] bool containsReparsePoint(
            const std::filesystem::path& root,
            const std::filesystem::path& candidate)
        {
            std::filesystem::path current = root;
            const std::filesystem::path relative = candidate.lexically_relative(root);
            const auto inspect = [](const std::filesystem::path& path)
            {
#ifdef _WIN32
                const DWORD attributes = GetFileAttributesW(path.c_str());
                return attributes != INVALID_FILE_ATTRIBUTES &&
                    (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
#else
                std::error_code error;
                return std::filesystem::is_symlink(std::filesystem::symlink_status(path, error));
#endif
            };
            if (inspect(current))
            {
                return true;
            }
            for (const auto& part : relative)
            {
                if (part == L"." || part.empty())
                {
                    continue;
                }
                current /= part;
                if (std::filesystem::exists(current) && inspect(current))
                {
                    return true;
                }
            }
            return false;
        }

        void ensureContained(
            const std::filesystem::path& root,
            const std::filesystem::path& candidate)
        {
            const PathSafetyResult safety = PathSafetyService().validateContainedPath(root, candidate);
            if (!safety.safe())
            {
                throw BuildFileWorkspaceError("outside-scope", "Path is outside the registered workspace scope.");
            }
            if (containsReparsePoint(root, candidate))
            {
                throw BuildFileWorkspaceError("outside-scope", "Reparse points and symbolic links are not allowed.");
            }
        }

        [[nodiscard]] bool isReadOnly(const std::filesystem::path& path)
        {
#ifdef _WIN32
            const DWORD attributes = GetFileAttributesW(path.c_str());
            return attributes != INVALID_FILE_ATTRIBUTES &&
                (attributes & FILE_ATTRIBUTE_READONLY) != 0;
#else
            std::error_code error;
            const auto permissions = std::filesystem::status(path, error).permissions();
            return !error &&
                (permissions & std::filesystem::perms::owner_write) == std::filesystem::perms::none;
#endif
        }

        [[nodiscard]] bool isHidden(const std::filesystem::path& path)
        {
#ifdef _WIN32
            const DWORD attributes = GetFileAttributesW(path.c_str());
            return attributes != INVALID_FILE_ATTRIBUTES &&
                (attributes & FILE_ATTRIBUTE_HIDDEN) != 0;
#else
            return path.filename().wstring().starts_with(L".");
#endif
        }

        [[nodiscard]] std::wstring decodeUtf8(
            const char* data,
            std::size_t size)
        {
            if (size == 0)
            {
                return {};
            }
#ifdef _WIN32
            const int required = MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                data,
                static_cast<int>(size),
                nullptr,
                0);
            if (required <= 0)
            {
                throw BuildFileWorkspaceError("unsupported-encoding", "Text is not valid UTF-8.");
            }
            std::wstring result(static_cast<std::size_t>(required), L'\0');
            if (MultiByteToWideChar(
                    CP_UTF8,
                    MB_ERR_INVALID_CHARS,
                    data,
                    static_cast<int>(size),
                    result.data(),
                    required) != required)
            {
                throw BuildFileWorkspaceError("unsupported-encoding", "UTF-8 decoding failed.");
            }
            return result;
#else
            std::wstring result;
            result.reserve(size);
            for (std::size_t index = 0; index < size; ++index)
            {
                const unsigned char byte = static_cast<unsigned char>(data[index]);
                if (byte < 0x80)
                {
                    result.push_back(static_cast<wchar_t>(byte));
                    continue;
                }
                throw BuildFileWorkspaceError("unsupported-encoding", "Non-ASCII UTF-8 requires the platform decoder.");
            }
            return result;
#endif
        }

        [[nodiscard]] std::vector<char> encodeUtf8(
            std::wstring_view text,
            bool bom)
        {
            std::vector<char> result;
            if (bom)
            {
                result.insert(result.end(), {'\xEF', '\xBB', '\xBF'});
            }
            if (text.empty())
            {
                return result;
            }
#ifdef _WIN32
            const int required = WideCharToMultiByte(
                CP_UTF8,
                WC_ERR_INVALID_CHARS,
                text.data(),
                static_cast<int>(text.size()),
                nullptr,
                0,
                nullptr,
                nullptr);
            if (required <= 0)
            {
                throw BuildFileWorkspaceError("unsupported-encoding", "Text cannot be encoded as UTF-8.");
            }
            const std::size_t offset = result.size();
            result.resize(offset + static_cast<std::size_t>(required));
            WideCharToMultiByte(
                CP_UTF8,
                WC_ERR_INVALID_CHARS,
                text.data(),
                static_cast<int>(text.size()),
                result.data() + offset,
                required,
                nullptr,
                nullptr);
#else
            for (const wchar_t character : text)
            {
                if (character > 0x7f)
                {
                    throw BuildFileWorkspaceError("unsupported-encoding", "Non-ASCII UTF-8 requires the platform encoder.");
                }
                result.push_back(static_cast<char>(character));
            }
#endif
            return result;
        }

#ifdef _WIN32
        [[nodiscard]] std::wstring decodeWindowsCodePage(
            const std::vector<char>& bytes,
            UINT codePage)
        {
            if (bytes.empty())
            {
                return {};
            }
            const int required = MultiByteToWideChar(
                codePage,
                0,
                bytes.data(),
                static_cast<int>(bytes.size()),
                nullptr,
                0);
            if (required <= 0)
            {
                throw BuildFileWorkspaceError("unsupported-encoding", "Legacy text decoding failed.");
            }
            std::wstring result(static_cast<std::size_t>(required), L'\0');
            if (MultiByteToWideChar(
                    codePage,
                    0,
                    bytes.data(),
                    static_cast<int>(bytes.size()),
                    result.data(),
                    required) != required)
            {
                throw BuildFileWorkspaceError("unsupported-encoding", "Legacy text decoding failed.");
            }
            return result;
        }

        [[nodiscard]] std::vector<char> encodeWindowsCodePage(
            std::wstring_view text,
            UINT codePage)
        {
            if (text.empty())
            {
                return {};
            }
            BOOL usedDefault = FALSE;
            const int required = WideCharToMultiByte(
                codePage,
                WC_NO_BEST_FIT_CHARS,
                text.data(),
                static_cast<int>(text.size()),
                nullptr,
                0,
                nullptr,
                &usedDefault);
            if (required <= 0 || usedDefault)
            {
                throw BuildFileWorkspaceError("unsupported-encoding", "Text cannot be represented in its original legacy encoding.");
            }
            std::vector<char> result(static_cast<std::size_t>(required));
            usedDefault = FALSE;
            if (WideCharToMultiByte(
                    codePage,
                    WC_NO_BEST_FIT_CHARS,
                    text.data(),
                    static_cast<int>(text.size()),
                    result.data(),
                    required,
                    nullptr,
                    &usedDefault) != required || usedDefault)
            {
                throw BuildFileWorkspaceError("unsupported-encoding", "Text cannot be represented in its original legacy encoding.");
            }
            return result;
        }
#endif

        struct DecodedText
        {
            std::wstring text;
            BuildFileTextEncoding encoding{BuildFileTextEncoding::Unsupported};
            BuildFileLineEnding lineEnding{BuildFileLineEnding::None};
        };

        [[nodiscard]] BuildFileLineEnding detectLineEnding(std::wstring_view text)
        {
            bool lf = false;
            bool crlf = false;
            for (std::size_t index = 0; index < text.size(); ++index)
            {
                if (text[index] != L'\n')
                {
                    continue;
                }
                if (index > 0 && text[index - 1] == L'\r')
                {
                    crlf = true;
                }
                else
                {
                    lf = true;
                }
            }
            if (lf && crlf)
            {
                return BuildFileLineEnding::Mixed;
            }
            if (crlf)
            {
                return BuildFileLineEnding::CrLf;
            }
            return lf ? BuildFileLineEnding::Lf : BuildFileLineEnding::None;
        }

        [[nodiscard]] DecodedText decodeText(const std::vector<char>& bytes)
        {
            const bool utf16Le = bytes.size() >= 2 &&
                static_cast<unsigned char>(bytes[0]) == 0xFF &&
                static_cast<unsigned char>(bytes[1]) == 0xFE;
            const bool utf16Be = bytes.size() >= 2 &&
                static_cast<unsigned char>(bytes[0]) == 0xFE &&
                static_cast<unsigned char>(bytes[1]) == 0xFF;
            if (utf16Le || utf16Be)
            {
                if ((bytes.size() - 2) % 2 != 0)
                {
                    throw BuildFileWorkspaceError("unsupported-encoding", "UTF-16 text has an incomplete code unit.");
                }
                DecodedText result;
                result.text.reserve((bytes.size() - 2) / 2);
                for (std::size_t index = 2; index < bytes.size(); index += 2)
                {
                    const unsigned int first = static_cast<unsigned char>(bytes[index]);
                    const unsigned int second = static_cast<unsigned char>(bytes[index + 1]);
                    const wchar_t codeUnit = static_cast<wchar_t>(
                        utf16Le ? first | (second << 8) : (first << 8) | second);
                    result.text.push_back(codeUnit);
                }
                result.encoding = utf16Le
                    ? BuildFileTextEncoding::Utf16Le
                    : BuildFileTextEncoding::Utf16Be;
                result.lineEnding = detectLineEnding(result.text);
                return result;
            }
            if (std::find(bytes.begin(), bytes.end(), '\0') != bytes.end())
            {
                throw BuildFileWorkspaceError("binary", "Binary files are read-only for AI tools.");
            }
            const bool bom = bytes.size() >= 3 &&
                static_cast<unsigned char>(bytes[0]) == 0xEF &&
                static_cast<unsigned char>(bytes[1]) == 0xBB &&
                static_cast<unsigned char>(bytes[2]) == 0xBF;
            const std::size_t offset = bom ? 3 : 0;
            DecodedText result;
            try
            {
                result.text = decodeUtf8(bytes.data() + offset, bytes.size() - offset);
                result.encoding = bom ? BuildFileTextEncoding::Utf8Bom : BuildFileTextEncoding::Utf8;
            }
            catch (const BuildFileWorkspaceError& error)
            {
                if (bom || error.code() != "unsupported-encoding")
                {
                    throw;
                }
#ifdef _WIN32
                const std::size_t cyrillicByteCount = static_cast<std::size_t>(std::count_if(
                    bytes.begin(),
                    bytes.end(),
                    [](char value)
                    {
                        const unsigned char byte = static_cast<unsigned char>(value);
                        return byte == 0xA8 || byte == 0xB8 || byte >= 0xC0;
                    }));
                const bool likelyWindows1251 = cyrillicByteCount >= 2 &&
                    cyrillicByteCount * 5 >= bytes.size();
                result.encoding = likelyWindows1251
                    ? BuildFileTextEncoding::Windows1251
                    : BuildFileTextEncoding::Windows1252;
                result.text = decodeWindowsCodePage(
                    bytes,
                    likelyWindows1251 ? 1251u : 1252u);
#else
                throw;
#endif
            }
            result.lineEnding = detectLineEnding(result.text);
            return result;
        }

        [[nodiscard]] std::vector<char> encodeText(
            std::wstring_view text,
            BuildFileTextEncoding encoding)
        {
            if (encoding == BuildFileTextEncoding::Utf8 || encoding == BuildFileTextEncoding::Utf8Bom)
            {
                return encodeUtf8(text, encoding == BuildFileTextEncoding::Utf8Bom);
            }
            if (encoding == BuildFileTextEncoding::Utf16Le ||
                encoding == BuildFileTextEncoding::Utf16Be)
            {
                const bool littleEndian = encoding == BuildFileTextEncoding::Utf16Le;
                std::vector<char> bytes;
                bytes.reserve(2 + text.size() * 2);
                bytes.push_back(littleEndian ? static_cast<char>(0xFF) : static_cast<char>(0xFE));
                bytes.push_back(littleEndian ? static_cast<char>(0xFE) : static_cast<char>(0xFF));
                for (const wchar_t character : text)
                {
                    if (static_cast<unsigned int>(character) > 0xFFFF)
                    {
                        throw BuildFileWorkspaceError("unsupported-encoding", "UTF-16 text contains an unsupported code point.");
                    }
                    const unsigned int codeUnit = static_cast<unsigned int>(character);
                    const char low = static_cast<char>(codeUnit & 0xFF);
                    const char high = static_cast<char>((codeUnit >> 8) & 0xFF);
                    bytes.push_back(littleEndian ? low : high);
                    bytes.push_back(littleEndian ? high : low);
                }
                return bytes;
            }
#ifdef _WIN32
            if (encoding == BuildFileTextEncoding::Windows1251 ||
                encoding == BuildFileTextEncoding::Windows1252)
            {
                return encodeWindowsCodePage(
                    text,
                    encoding == BuildFileTextEncoding::Windows1251 ? 1251u : 1252u);
            }
#endif
            throw BuildFileWorkspaceError("unsupported-encoding", "The original text encoding cannot be preserved.");
        }

        [[nodiscard]] std::wstring jsonWithoutComments(std::wstring_view input)
        {
            std::wstring output;
            output.reserve(input.size());
            bool string = false;
            bool escape = false;
            bool lineComment = false;
            bool blockComment = false;
            for (std::size_t index = 0; index < input.size(); ++index)
            {
                const wchar_t current = input[index];
                const wchar_t next = index + 1 < input.size() ? input[index + 1] : L'\0';
                if (lineComment)
                {
                    if (current == L'\n')
                    {
                        lineComment = false;
                        output.push_back(current);
                    }
                    else
                    {
                        output.push_back(L' ');
                    }
                    continue;
                }
                if (blockComment)
                {
                    if (current == L'*' && next == L'/')
                    {
                        output.append(L"  ");
                        ++index;
                        blockComment = false;
                    }
                    else
                    {
                        output.push_back(current == L'\n' || current == L'\r' ? current : L' ');
                    }
                    continue;
                }
                if (string)
                {
                    output.push_back(current);
                    if (escape)
                    {
                        escape = false;
                    }
                    else if (current == L'\\')
                    {
                        escape = true;
                    }
                    else if (current == L'"')
                    {
                        string = false;
                    }
                    continue;
                }
                if (current == L'"')
                {
                    string = true;
                    output.push_back(current);
                }
                else if (current == L'/' && next == L'/')
                {
                    output.append(L"  ");
                    ++index;
                    lineComment = true;
                }
                else if (current == L'/' && next == L'*')
                {
                    output.append(L"  ");
                    ++index;
                    blockComment = true;
                }
                else
                {
                    output.push_back(current);
                }
            }
            if (string || blockComment)
            {
                throw BuildFileWorkspaceError("validation-failed", "JSONC contains an unfinished token.");
            }

            for (std::size_t index = 0; index < output.size(); ++index)
            {
                if (output[index] != L',')
                {
                    continue;
                }
                std::size_t lookahead = index + 1;
                while (lookahead < output.size() && std::iswspace(output[lookahead]))
                {
                    ++lookahead;
                }
                if (lookahead < output.size() && (output[lookahead] == L'}' || output[lookahead] == L']'))
                {
                    output[index] = L' ';
                }
            }
            return output;
        }

        void validateMutationText(
            std::wstring_view text,
            BuildFileMutationFormat format)
        {
            try
            {
                if (format == BuildFileMutationFormat::Json)
                {
                    static_cast<void>(JsonReader::parse(text));
                }
                else if (format == BuildFileMutationFormat::Jsonc)
                {
                    static_cast<void>(JsonReader::parse(jsonWithoutComments(text)));
                }
            }
            catch (const BuildFileWorkspaceError&)
            {
                throw;
            }
            catch (const std::exception&)
            {
                throw BuildFileWorkspaceError("validation-failed", "The resulting document is not valid JSON/JSONC.");
            }
        }

        void writeJsonValue(JsonWriter& writer, const JsonValue& value)
        {
            if (value.isNull()) writer.nullValue();
            else if (value.isString()) writer.value(value.asString());
            else if (value.isNumber()) writer.numberValue(value.asNumber());
            else if (value.type() == JsonValue::Type::Boolean) writer.value(value.asBoolean());
            else if (value.isArray())
            {
                writer.beginArray();
                for (const auto& child : value.asArray()) writeJsonValue(writer, child);
                writer.endArray();
            }
            else
            {
                writer.beginObject();
                for (const auto& [key, child] : value.asObject())
                {
                    writer.key(key);
                    writeJsonValue(writer, child);
                }
                writer.endObject();
            }
        }

        [[nodiscard]] std::wstring serializeJsonValue(const JsonValue& value)
        {
            JsonWriter writer;
            writeJsonValue(writer, value);
            return writer.str();
        }

        [[nodiscard]] std::wstring jsonOutlineType(const JsonValue& value)
        {
            if (value.isObject()) return L"object(" + std::to_wstring(value.asObject().size()) + L")";
            if (value.isArray()) return L"array(" + std::to_wstring(value.asArray().size()) + L")";
            if (value.isString()) return L"string";
            if (value.isNumber()) return L"number";
            if (value.type() == JsonValue::Type::Boolean) return L"boolean";
            return L"null";
        }

        [[nodiscard]] std::wstring jsonPointerSegment(std::wstring_view value)
        {
            std::wstring result;
            result.reserve(value.size());
            for (const wchar_t character : value)
            {
                if (character == L'~') result += L"~0";
                else if (character == L'/') result += L"~1";
                else result.push_back(character);
            }
            return result;
        }

        void appendJsonOutline(
            const JsonValue& value,
            std::wstring_view pointer,
            std::size_t depth,
            std::size_t& nodes,
            std::wstring& output)
        {
            constexpr std::size_t maximumOutlineNodes = 256;
            constexpr std::size_t maximumOutlineDepth = 4;
            if (nodes >= maximumOutlineNodes)
            {
                return;
            }
            ++nodes;
            output += pointer.empty() ? L"/" : std::wstring(pointer);
            output += L" : " + jsonOutlineType(value) + L"\n";
            if (depth >= maximumOutlineDepth)
            {
                return;
            }
            if (value.isObject())
            {
                for (const auto& [key, child] : value.asObject())
                {
                    const std::wstring childPointer = std::wstring(pointer) + L"/" + jsonPointerSegment(key);
                    appendJsonOutline(child, childPointer, depth + 1, nodes, output);
                    if (nodes >= maximumOutlineNodes) break;
                }
            }
            else if (value.isArray() && !value.asArray().empty())
            {
                const std::wstring childPointer = std::wstring(pointer) + L"/0";
                appendJsonOutline(value.asArray().front(), childPointer, depth + 1, nodes, output);
            }
        }

        [[nodiscard]] std::wstring jsonOutline(const JsonValue& value)
        {
            std::wstring result;
            std::size_t nodes = 0;
            appendJsonOutline(value, L"", 0, nodes, result);
            if (nodes >= 256)
            {
                result += L"... outline truncated ...\n";
            }
            return result;
        }

        [[nodiscard]] std::wstring decodeJsonPointerToken(std::wstring_view token)
        {
            std::wstring result;
            for (std::size_t index = 0; index < token.size(); ++index)
            {
                if (token[index] != L'~')
                {
                    result.push_back(token[index]);
                    continue;
                }
                if (index + 1 >= token.size() || (token[index + 1] != L'0' && token[index + 1] != L'1'))
                {
                    throw BuildFileWorkspaceError("validation-failed", "JSON Pointer contains an invalid escape.");
                }
                result.push_back(token[++index] == L'0' ? L'~' : L'/');
            }
            return result;
        }

        [[nodiscard]] const JsonValue& resolveJsonPointer(
            const JsonValue& root,
            std::wstring_view pointer)
        {
            if (pointer.empty()) return root;
            if (pointer.front() != L'/')
            {
                throw BuildFileWorkspaceError("validation-failed", "JSON Pointer must be empty or start with '/'.");
            }
            const JsonValue* current = &root;
            std::size_t start = 1;
            while (start <= pointer.size())
            {
                const std::size_t end = pointer.find(L'/', start);
                const std::wstring token = decodeJsonPointerToken(pointer.substr(
                    start,
                    end == std::wstring_view::npos ? pointer.size() - start : end - start));
                if (current->isObject())
                {
                    current = current->find(token);
                    if (current == nullptr)
                    {
                        throw BuildFileWorkspaceError("validation-failed", "JSON Pointer property was not found.");
                    }
                }
                else if (current->isArray())
                {
                    if (token.empty() || token == L"-")
                    {
                        throw BuildFileWorkspaceError("validation-failed", "JSON Pointer array index is invalid.");
                    }
                    std::size_t consumed = 0;
                    std::size_t index = 0;
                    try { index = static_cast<std::size_t>(std::stoull(token, &consumed)); }
                    catch (...) { throw BuildFileWorkspaceError("validation-failed", "JSON Pointer array index is invalid."); }
                    if (consumed != token.size() || index >= current->asArray().size())
                    {
                        throw BuildFileWorkspaceError("validation-failed", "JSON Pointer array index is out of range.");
                    }
                    current = &current->asArray()[index];
                }
                else
                {
                    throw BuildFileWorkspaceError("validation-failed", "JSON Pointer cannot traverse a scalar value.");
                }
                if (end == std::wstring_view::npos) break;
                start = end + 1;
            }
            return *current;
        }

        [[nodiscard]] JsonValue& resolveMutableJsonPointer(
            JsonValue& root,
            std::wstring_view pointer)
        {
            if (pointer.empty()) return root;
            if (pointer.front() != L'/')
            {
                throw BuildFileWorkspaceError("validation-failed", "JSON Pointer must be empty or start with '/'.");
            }
            JsonValue* current = &root;
            std::size_t start = 1;
            while (start <= pointer.size())
            {
                const std::size_t end = pointer.find(L'/', start);
                const std::wstring token = decodeJsonPointerToken(pointer.substr(
                    start,
                    end == std::wstring_view::npos ? pointer.size() - start : end - start));
                if (current->isObject())
                {
                    auto& object = current->asObject();
                    const auto match = object.find(token);
                    if (match == object.end())
                    {
                        throw BuildFileWorkspaceError("validation-failed", "JSON Pointer property was not found.");
                    }
                    current = &match->second;
                }
                else if (current->isArray())
                {
                    if (token.empty() || token == L"-")
                    {
                        throw BuildFileWorkspaceError("validation-failed", "JSON Pointer array index is invalid.");
                    }
                    std::size_t consumed = 0;
                    std::size_t index = 0;
                    try { index = static_cast<std::size_t>(std::stoull(token, &consumed)); }
                    catch (...) { throw BuildFileWorkspaceError("validation-failed", "JSON Pointer array index is invalid."); }
                    if (consumed != token.size() || index >= current->asArray().size())
                    {
                        throw BuildFileWorkspaceError("validation-failed", "JSON Pointer array index is out of range.");
                    }
                    current = &current->asArray()[index];
                }
                else
                {
                    throw BuildFileWorkspaceError("validation-failed", "JSON Pointer cannot traverse a scalar value.");
                }
                if (end == std::wstring_view::npos) break;
                start = end + 1;
            }
            return *current;
        }

        [[nodiscard]] std::wstring trimText(std::wstring_view value)
        {
            std::size_t start = 0;
            while (start < value.size() && std::iswspace(value[start])) ++start;
            std::size_t end = value.size();
            while (end > start && std::iswspace(value[end - 1])) --end;
            return std::wstring(value.substr(start, end - start));
        }

        struct IniLineEdit
        {
            std::size_t offset{0};
            std::wstring expected;
            std::wstring replacement;
        };

        [[nodiscard]] IniLineEdit applyIniKeyOperation(
            std::wstring_view document,
            BuildFileMutationOperation operation,
            std::wstring_view requestedSection,
            std::wstring_view requestedKey,
            std::wstring_view requestedValue)
        {
            if (requestedKey.empty())
            {
                throw BuildFileWorkspaceError("validation-failed", "INI key is required.");
            }
            const std::wstring eol = document.find(L"\r\n") != std::wstring_view::npos ? L"\r\n" : L"\n";
            const std::wstring wantedSection = lower(trimText(requestedSection));
            const std::wstring wantedKey = lower(trimText(requestedKey));
            std::wstring currentSection;
            std::vector<IniLineEdit> matches;
            std::size_t sectionInsertOffset = std::wstring::npos;
            std::size_t offset = 0;
            while (offset <= document.size())
            {
                const std::size_t lineEnd = document.find(L'\n', offset);
                const std::size_t rawEnd = lineEnd == std::wstring_view::npos ? document.size() : lineEnd + 1;
                std::wstring raw(document.substr(offset, rawEnd - offset));
                std::wstring line = raw;
                while (!line.empty() && (line.back() == L'\n' || line.back() == L'\r')) line.pop_back();
                const std::wstring trimmed = trimText(line);
                if (trimmed.size() >= 2 && trimmed.front() == L'[' && trimmed.back() == L']')
                {
                    if (lower(trimText(std::wstring_view(trimmed).substr(1, trimmed.size() - 2))) == wantedSection)
                    {
                        currentSection = wantedSection;
                        sectionInsertOffset = rawEnd;
                    }
                    else
                    {
                        if (currentSection == wantedSection && sectionInsertOffset != std::wstring::npos)
                        {
                            sectionInsertOffset = offset;
                        }
                        currentSection = lower(trimText(std::wstring_view(trimmed).substr(1, trimmed.size() - 2)));
                    }
                }
                else if (currentSection == wantedSection && !trimmed.empty() && trimmed.front() != L';' && trimmed.front() != L'#')
                {
                    const std::size_t separator = line.find_first_of(L"=:");
                    if (separator != std::wstring::npos && lower(trimText(std::wstring_view(line).substr(0, separator))) == wantedKey)
                    {
                        matches.push_back(IniLineEdit{
                            offset,
                            raw,
                            std::wstring(requestedKey) + L"=" + std::wstring(requestedValue) + eol});
                    }
                    sectionInsertOffset = rawEnd;
                }
                if (lineEnd == std::wstring_view::npos) break;
                offset = rawEnd;
            }
            if (operation == BuildFileMutationOperation::IniAddKey)
            {
                if (sectionInsertOffset == std::wstring::npos)
                {
                    throw BuildFileWorkspaceError("validation-failed", "INI section was not found.");
                }
                return IniLineEdit{
                    sectionInsertOffset,
                    L"",
                    std::wstring(requestedKey) + L"=" + std::wstring(requestedValue) + eol};
            }
            if (matches.size() != 1)
            {
                throw BuildFileWorkspaceError("ambiguous", "INI set/remove requires exactly one matching key.");
            }
            if (operation == BuildFileMutationOperation::IniRemoveKey)
            {
                matches.front().replacement.clear();
            }
            return matches.front();
        }

        [[nodiscard]] std::vector<std::wstring> splitLines(std::wstring_view text);

        [[nodiscard]] std::vector<std::wstring> iniKeyValues(
            std::wstring_view document,
            std::wstring_view requestedSection,
            std::wstring_view requestedKey)
        {
            const std::wstring wantedSection = lower(trimText(requestedSection));
            const std::wstring wantedKey = lower(trimText(requestedKey));
            std::wstring currentSection;
            std::vector<std::wstring> values;
            for (const auto& rawLine : splitLines(document))
            {
                const std::wstring line = trimText(rawLine);
                if (line.size() >= 2 && line.front() == L'[' && line.back() == L']')
                {
                    currentSection = lower(trimText(
                        std::wstring_view(line).substr(1, line.size() - 2)));
                    continue;
                }
                if (currentSection != wantedSection || line.empty() ||
                    line.front() == L';' || line.front() == L'#')
                {
                    continue;
                }
                const std::size_t separator = rawLine.find_first_of(L"=:");
                if (separator != std::wstring::npos &&
                    lower(trimText(std::wstring_view(rawLine).substr(0, separator))) == wantedKey)
                {
                    values.push_back(trimText(std::wstring_view(rawLine).substr(separator + 1)));
                }
            }
            return values;
        }

        [[nodiscard]] std::vector<std::wstring> splitLines(std::wstring_view text)
        {
            std::vector<std::wstring> lines;
            std::size_t start = 0;
            while (start <= text.size())
            {
                const std::size_t end = text.find(L'\n', start);
                std::wstring line(text.substr(start, end == std::wstring_view::npos ? text.size() - start : end - start));
                if (!line.empty() && line.back() == L'\r')
                {
                    line.pop_back();
                }
                lines.push_back(std::move(line));
                if (end == std::wstring_view::npos)
                {
                    break;
                }
                start = end + 1;
            }
            return lines;
        }

        [[nodiscard]] std::size_t lineAt(
            std::wstring_view text,
            std::size_t offset)
        {
            return 1 + static_cast<std::size_t>(std::count(text.begin(), text.begin() + offset, L'\n'));
        }
    }

    BuildFileWorkspaceError::BuildFileWorkspaceError(std::string code, std::string message)
        : std::runtime_error(std::move(message)),
          code_(std::move(code))
    {
    }

    const std::string& BuildFileWorkspaceError::code() const noexcept
    {
        return code_;
    }

    BuildFileMutation BuildFileMutation::patch(
        std::wstring fileRef,
        std::wstring baseSha256,
        std::wstring expectedText,
        std::wstring replacementText,
        BuildFileMutationFormat format)
    {
        BuildFileMutation mutation;
        mutation.fileRef = std::move(fileRef);
        mutation.baseSha256 = std::move(baseSha256);
        mutation.expectedText = std::move(expectedText);
        mutation.replacementText = std::move(replacementText);
        mutation.format = format;
        return mutation;
    }

    BuildFileMutation BuildFileMutation::create(
        std::wstring parentRef,
        std::wstring fileName,
        std::wstring content,
        BuildFileMutationFormat format)
    {
        BuildFileMutation mutation;
        mutation.parentRef = std::move(parentRef);
        mutation.fileName = std::move(fileName);
        mutation.content = std::move(content);
        mutation.format = format;
        mutation.createFile = true;
        mutation.expectedAbsent = true;
        return mutation;
    }

    BuildFileMutation BuildFileMutation::iniKey(
        BuildFileMutationOperation operation,
        std::wstring fileRef,
        std::wstring baseSha256,
        std::wstring section,
        std::wstring key,
        std::wstring value)
    {
        if (operation == BuildFileMutationOperation::ExactPatch)
        {
            throw BuildFileWorkspaceError("validation-failed", "INI key mutation requires set, add, or remove.");
        }
        BuildFileMutation mutation;
        mutation.fileRef = std::move(fileRef);
        mutation.baseSha256 = std::move(baseSha256);
        mutation.format = BuildFileMutationFormat::Ini;
        mutation.operation = operation;
        mutation.section = std::move(section);
        mutation.key = std::move(key);
        mutation.value = std::move(value);
        return mutation;
    }

    BuildFileMutation BuildFileMutation::jsonPointer(
        std::wstring fileRef,
        std::wstring baseSha256,
        std::wstring pointer,
        std::wstring expectedValue,
        std::wstring value)
    {
        BuildFileMutation mutation;
        mutation.fileRef = std::move(fileRef);
        mutation.baseSha256 = std::move(baseSha256);
        mutation.format = BuildFileMutationFormat::Json;
        mutation.operation = BuildFileMutationOperation::JsonSetPointer;
        mutation.pointer = std::move(pointer);
        mutation.expectedValue = std::move(expectedValue);
        mutation.value = std::move(value);
        return mutation;
    }

    struct BuildFileWorkspaceService::State
    {
        struct Root
        {
            BuildFileScope scope{BuildFileScope::Build};
            std::filesystem::path path;
            std::wstring fixedOwnerMod;
            bool contentsAreVirtualRoot{false};
            bool alwaysWins{false};
        };

        struct Reference
        {
            std::wstring token;
            BuildFileScope scope{BuildFileScope::Build};
            std::filesystem::path root;
            std::filesystem::path path;
            std::wstring relativePath;
            std::wstring fixedOwnerMod;
            bool contentsAreVirtualRoot{false};
            BuildFileKind kind{BuildFileKind::Unsupported};
            BuildFileResolution resolution{BuildFileResolution::NotFound};
            bool effectiveWinner{false};
            bool read{false};
            std::wstring readHash;
            std::wstring indexRevision;
            BuildFileTextEncoding encoding{BuildFileTextEncoding::Unsupported};
            BuildFileLineEnding lineEnding{BuildFileLineEnding::None};
        };

        struct ChangeRecord
        {
            std::wstring fileRef;
            std::filesystem::path path;
            std::filesystem::path checkpointPath;
            std::wstring beforeHash;
            std::wstring afterHash;
            BuildFileTextEncoding encoding{BuildFileTextEncoding::Unsupported};
            bool created{false};
            std::optional<ManagedAiOverridePlan> managedOverride;
            bool registeredManagedMod{false};
            BuildFileChange change;
        };

        struct Run
        {
            std::wstring operationId;
            std::vector<ChangeRecord> changes;
            BuildFileRollbackState rollbackState{BuildFileRollbackState::Available};
        };

        struct Session
        {
            std::wstring chatId;
            std::wstring profileName;
            std::filesystem::path projectDirectory;
            std::filesystem::path checkpointRoot;
            std::vector<Root> roots;
            std::unordered_map<std::wstring, Reference> refs;
            std::unordered_map<std::wstring, std::wstring> refsByPath;
            std::unordered_map<std::wstring, Run> runs;
        };

        State(Logger& loggerValue, const BuildPathSettingsService& pathSettingsValue)
            : logger(loggerValue),
              pathSettings(pathSettingsValue),
              managedOverrides(loggerValue, pathSettingsValue)
        {
        }

        Logger& logger;
        const BuildPathSettingsService& pathSettings;
        BuildFileDiscoveryService discovery;
        ManagedAiOverrideService managedOverrides;
        ConfigRecipeRegistry configRecipes;
        bool initialized{false};
        std::atomic<std::uint64_t> sequence{0};
        std::mutex mutex;
        std::unordered_map<std::wstring, Session> sessions;
    };

    namespace
    {
        [[nodiscard]] BuildFileWorkspaceService::State::Session& requireSession(
            BuildFileWorkspaceService::State& state,
            std::wstring_view chatId)
        {
            const auto match = state.sessions.find(std::wstring(chatId));
            if (match == state.sessions.end())
            {
                throw BuildFileWorkspaceError("outside-scope", "AI file workspace chat is not active.");
            }
            return match->second;
        }

        [[nodiscard]] const BuildFileWorkspaceService::State::Root& requireRoot(
            const BuildFileWorkspaceService::State::Session& session,
            BuildFileScope scope)
        {
            const auto match = std::find_if(session.roots.begin(), session.roots.end(), [scope](const auto& root)
            {
                return root.scope == scope;
            });
            if (match == session.roots.end())
            {
                throw BuildFileWorkspaceError("outside-scope", "Requested workspace scope is unavailable.");
            }
            return *match;
        }

        [[nodiscard]] const BuildFileWorkspaceService::State::Root& requireRoot(
            const BuildFileWorkspaceService::State::Session& session,
            BuildFileScope scope,
            const std::filesystem::path& path)
        {
            const std::wstring normalized = lower(path.lexically_normal().generic_wstring());
            const auto match = std::find_if(session.roots.begin(), session.roots.end(), [&](const auto& root)
            {
                return root.scope == scope &&
                    lower(root.path.lexically_normal().generic_wstring()) == normalized;
            });
            if (match == session.roots.end())
            {
                throw BuildFileWorkspaceError("outside-scope", "Discovery root is no longer available.");
            }
            return *match;
        }

        [[nodiscard]] std::wstring referenceKey(
            BuildFileScope scope,
            const std::filesystem::path& path)
        {
            return std::to_wstring(static_cast<int>(scope)) + L":" + lower(path.lexically_normal().wstring());
        }

        struct WorkspaceIndexedFile
        {
            const BuildFileWorkspaceService::State::Root* root{nullptr};
            std::filesystem::path path;
            std::filesystem::path relative;
            BuildFileKind kind{BuildFileKind::Unsupported};
            std::uintmax_t size{0};
            std::filesystem::file_time_type modified{};
        };

        struct WorkspaceIndexSnapshot
        {
            std::vector<WorkspaceIndexedFile> files;
            std::wstring revision;
            bool cancelled{false};
        };

        void combineWorkspaceRevision(std::size_t& seed, std::size_t value)
        {
            seed ^= value + 0x9e3779b9 + (seed << 6) + (seed >> 2);
        }

        [[nodiscard]] WorkspaceIndexSnapshot buildWorkspaceIndex(
            const BuildFileWorkspaceService::State::Session& session,
            BuildFileScope scope,
            const std::function<bool()>& cancellationRequested)
        {
            WorkspaceIndexSnapshot snapshot;
            for (const auto& root : session.roots)
            {
                if (root.scope != scope)
                {
                    continue;
                }
                std::error_code error;
                if (!std::filesystem::is_directory(root.path, error) || error)
                {
                    continue;
                }
                std::filesystem::recursive_directory_iterator iterator(
                    root.path,
                    std::filesystem::directory_options::skip_permission_denied,
                    error);
                const std::filesystem::recursive_directory_iterator end;
                for (; iterator != end; iterator.increment(error))
                {
                    if (cancellationRequested && cancellationRequested())
                    {
                        snapshot.cancelled = true;
                        break;
                    }
                    if (error)
                    {
                        error.clear();
                        continue;
                    }
                    const std::filesystem::path path = iterator->path();
                    if (containsReparsePoint(root.path, path))
                    {
                        if (iterator->is_directory(error))
                        {
                            iterator.disable_recursion_pending();
                        }
                        error.clear();
                        continue;
                    }
                    const BuildFileKind kind = kindFor(path);
                    if (kind == BuildFileKind::Unsupported || kind == BuildFileKind::Directory)
                    {
                        continue;
                    }
                    const std::filesystem::path relative = path.lexically_relative(root.path);
                    if (isProtectedRelativePath(relative))
                    {
                        continue;
                    }
                    WorkspaceIndexedFile file;
                    file.root = &root;
                    file.path = path;
                    file.relative = relative;
                    file.kind = kind;
                    file.size = std::filesystem::file_size(path, error);
                    if (error)
                    {
                        error.clear();
                        continue;
                    }
                    file.modified = std::filesystem::last_write_time(path, error);
                    if (error)
                    {
                        error.clear();
                        continue;
                    }
                    snapshot.files.push_back(std::move(file));
                    if (snapshot.files.size() > maximumSearchTraversalEntriesPerPage)
                    {
                        throw BuildFileWorkspaceError(
                            "too-large",
                            "The selected workspace contains more than 100000 allowlisted files.");
                    }
                }
                if (snapshot.cancelled)
                {
                    break;
                }
            }
            std::sort(snapshot.files.begin(), snapshot.files.end(), [](const auto& left, const auto& right)
            {
                const std::wstring leftKey = lower(left.root->path.generic_wstring()) + L"|" +
                    lower(left.relative.generic_wstring());
                const std::wstring rightKey = lower(right.root->path.generic_wstring()) + L"|" +
                    lower(right.relative.generic_wstring());
                return leftKey < rightKey;
            });
            std::size_t seed = 0;
            for (const auto& file : snapshot.files)
            {
                combineWorkspaceRevision(seed, std::hash<std::wstring>{}(
                    lower(file.root->path.generic_wstring()) + L"|" +
                    lower(file.relative.generic_wstring())));
                combineWorkspaceRevision(seed, static_cast<std::size_t>(file.size));
                combineWorkspaceRevision(seed, std::hash<decltype(file.modified.time_since_epoch().count())>{}(
                    file.modified.time_since_epoch().count()));
            }
            std::wostringstream revision;
            revision << L"workspace-index-v2:" << std::hex << seed;
            snapshot.revision = revision.str();
            return snapshot;
        }

        [[nodiscard]] std::size_t cursorOffset(
            std::wstring_view cursor,
            std::wstring_view revision,
            std::wstring_view label)
        {
            if (cursor.empty())
            {
                return 0;
            }
            const std::size_t separator = cursor.rfind(L'|');
            if (separator == std::wstring_view::npos || cursor.substr(0, separator) != revision)
            {
                throw BuildFileWorkspaceError(
                    "stale-revision",
                    narrowAscii(label) + " cursor belongs to a different index revision.");
            }
            try
            {
                return static_cast<std::size_t>(std::stoull(std::wstring(cursor.substr(separator + 1))));
            }
            catch (...)
            {
                throw BuildFileWorkspaceError(
                    "validation-failed",
                    narrowAscii(label) + " cursor is invalid.");
            }
        }

        [[nodiscard]] BuildFileWorkspaceService::State::Reference& registerReference(
            BuildFileWorkspaceService::State& state,
            BuildFileWorkspaceService::State::Session& session,
            const BuildFileWorkspaceService::State::Root& root,
            const std::filesystem::path& path)
        {
            ensureContained(root.path, path);
            const BuildFileKind kind = kindFor(path);
            if (kind == BuildFileKind::Unsupported)
            {
                throw BuildFileWorkspaceError("protected", "File type is not allowed in AI file workspace v1.");
            }
            const std::filesystem::path relative = path.lexically_relative(root.path);
            if (isProtectedRelativePath(relative))
            {
                throw BuildFileWorkspaceError("protected", "Fluxora-managed files cannot be raw-edited.");
            }
            const std::wstring key = referenceKey(root.scope, path);
            if (const auto existing = session.refsByPath.find(key); existing != session.refsByPath.end())
            {
                return session.refs.at(existing->second);
            }
            BuildFileWorkspaceService::State::Reference reference;
            reference.token = opaqueToken(kind == BuildFileKind::Directory ? L"parentRef" : L"fileRef", state.sequence);
            reference.scope = root.scope;
            reference.root = root.path;
            reference.path = path;
            reference.relativePath = normalizedRelative(relative);
            reference.fixedOwnerMod = root.fixedOwnerMod;
            reference.contentsAreVirtualRoot = root.contentsAreVirtualRoot;
            reference.kind = kind;
            const std::wstring token = reference.token;
            session.refsByPath.emplace(key, token);
            return session.refs.emplace(token, std::move(reference)).first->second;
        }

        [[nodiscard]] BuildFileWorkspaceService::State::Reference& requireReference(
            BuildFileWorkspaceService::State::Session& session,
            std::wstring_view token)
        {
            const auto match = session.refs.find(std::wstring(token));
            if (match == session.refs.end())
            {
                throw BuildFileWorkspaceError("outside-scope", "Opaque file reference is unknown or expired.");
            }
            ensureContained(match->second.root, match->second.path);
            return match->second;
        }

        [[nodiscard]] std::wstring ownerModFor(
            BuildFileScope scope,
            std::wstring_view relativePath)
        {
            if (scope != BuildFileScope::Build)
            {
                return {};
            }
            const std::size_t separator = relativePath.find(L'/');
            return std::wstring(relativePath.substr(0, separator));
        }

        [[nodiscard]] BuildFileMetadata metadataFor(
            BuildFileWorkspaceService::State& state,
            BuildFileWorkspaceService::State::Session& session,
            BuildFileWorkspaceService::State::Reference& reference)
        {
            BuildFileMetadata metadata;
            metadata.fileRef = reference.token;
            metadata.scope = reference.scope;
            metadata.kind = reference.kind;
            metadata.ownerMod = reference.fixedOwnerMod.empty()
                ? ownerModFor(reference.scope, reference.relativePath)
                : reference.fixedOwnerMod;
            metadata.relativePath = reference.relativePath;
            metadata.fileName = reference.path.filename().wstring();
            metadata.extension = lower(reference.path.extension().wstring());
            std::error_code error;
            if (reference.kind != BuildFileKind::Directory)
            {
                metadata.size = std::filesystem::file_size(reference.path, error);
                error.clear();
            }
            const auto modified = std::filesystem::last_write_time(reference.path, error);
            if (!error)
            {
                metadata.modifiedAt = fileTimeText(modified);
            }
            metadata.readOnly = isReadOnly(reference.path);
            metadata.hidden = isHidden(reference.path);
            metadata.indexRevision = reference.indexRevision;
            metadata.version = versionFor(reference.path, reference.read ? reference.readHash : L"");
            if (reference.path != reference.root)
            {
                auto& parent = registerReference(
                    state,
                    session,
                    requireRoot(session, reference.scope, reference.root),
                    reference.path.parent_path());
                metadata.parentRef = parent.token;
            }
            return metadata;
        }
    }

    BuildFileWorkspaceService::BuildFileWorkspaceService(
        Logger& logger,
        const BuildPathSettingsService& pathSettings) noexcept
        : state_(std::make_unique<State>(logger, pathSettings))
    {
    }

    BuildFileWorkspaceService::~BuildFileWorkspaceService() = default;

    void BuildFileWorkspaceService::initialize()
    {
        std::scoped_lock lock(state_->mutex);
        if (state_->initialized)
        {
            return;
        }
        std::error_code error;
        std::filesystem::remove_all(checkpointBaseDirectory(), error);
        state_->initialized = true;
    }

    void BuildFileWorkspaceService::shutdown()
    {
        std::scoped_lock lock(state_->mutex);
        for (const auto& [_, session] : state_->sessions)
        {
            std::error_code error;
            std::filesystem::remove_all(session.checkpointRoot, error);
        }
        state_->sessions.clear();
        state_->initialized = false;
    }

    void BuildFileWorkspaceService::beginChat(
        std::wstring_view chatId,
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName)
    {
        if (chatId.empty() || projectDirectory.empty())
        {
            throw BuildFileWorkspaceError("outside-scope", "Chat and project are required.");
        }
        std::scoped_lock lock(state_->mutex);
        if (!state_->initialized)
        {
            throw BuildFileWorkspaceError("outside-scope", "AI file workspace service is not initialized.");
        }
        const std::filesystem::path canonicalProject =
            PathSafetyService().canonicalize(projectDirectory);
        const std::wstring normalizedProfile = profileName.empty()
            ? L"Default"
            : std::wstring(profileName);
        if (const auto existing = state_->sessions.find(std::wstring(chatId));
            existing != state_->sessions.end() &&
            existing->second.projectDirectory == canonicalProject &&
            existing->second.profileName == normalizedProfile)
        {
            return;
        }
        const BuildPathSettings paths = state_->pathSettings.loadForProjectDirectory(canonicalProject);
        State::Session session;
        session.chatId = std::wstring(chatId);
        session.profileName = normalizedProfile;
        session.projectDirectory = canonicalProject;
        session.checkpointRoot = checkpointBaseDirectory() / checkpointSegment(chatId);
        session.roots = {
            {BuildFileScope::Build, PathSafetyService().canonicalize(paths.modsDirectory)},
            {BuildFileScope::Game, PathSafetyService().canonicalize(paths.gameDirectory)},
            {BuildFileScope::Downloads, PathSafetyService().canonicalize(paths.downloadsDirectory)}
        };
        std::error_code overwriteError;
        if (std::filesystem::is_directory(paths.overwriteDirectory, overwriteError) && !overwriteError)
        {
            session.roots.insert(
                session.roots.begin() + 1,
                State::Root{
                    BuildFileScope::Build,
                    PathSafetyService().canonicalize(paths.overwriteDirectory),
                    L"Overwrite",
                    true,
                    true
                });
        }
        for (const auto& root : session.roots)
        {
            if (std::filesystem::exists(root.path) && containsReparsePoint(root.path, root.path))
            {
                throw BuildFileWorkspaceError("outside-scope", "Workspace roots cannot be reparse points.");
            }
        }
        if (const auto existing = state_->sessions.find(session.chatId); existing != state_->sessions.end())
        {
            std::error_code error;
            std::filesystem::remove_all(existing->second.checkpointRoot, error);
            state_->sessions.erase(existing);
        }
        state_->sessions.emplace(session.chatId, std::move(session));
    }

    BuildFileDiscoveryPage BuildFileWorkspaceService::discover(
        std::wstring_view chatId,
        const BuildFileDiscoveryRequest& request)
    {
        std::scoped_lock lock(state_->mutex);
        State::Session& session = requireSession(*state_, chatId);
        std::vector<BuildFileDiscoveryRoot> roots;
        roots.reserve(session.roots.size());
        for (const auto& root : session.roots)
        {
            roots.push_back(BuildFileDiscoveryRoot{
                root.scope,
                root.path,
                root.fixedOwnerMod,
                root.contentsAreVirtualRoot,
                root.alwaysWins
            });
        }
        BuildFileDiscoveryScan scan = state_->discovery.discover(
            session.projectDirectory,
            session.profileName,
            roots,
            request);
        if (!request.revision.empty() && request.revision != scan.revision)
        {
            throw BuildFileWorkspaceError(
                "stale-revision",
                "Discovery index changed; restart discovery before using earlier results.");
        }
        std::size_t offset = 0;
        if (!request.cursor.empty())
        {
            const std::size_t separator = request.cursor.rfind(L'|');
            if (separator == std::wstring::npos ||
                request.cursor.substr(0, separator) != scan.revision)
            {
                throw BuildFileWorkspaceError(
                    "stale-revision",
                    "Discovery cursor belongs to a different index revision.");
            }
            try
            {
                offset = static_cast<std::size_t>(std::stoull(request.cursor.substr(separator + 1)));
            }
            catch (...)
            {
                throw BuildFileWorkspaceError("validation-failed", "Discovery cursor is invalid.");
            }
            if (offset > scan.hits.size())
            {
                throw BuildFileWorkspaceError("validation-failed", "Discovery cursor is outside the result set.");
            }
        }
        const std::size_t limit = std::clamp(request.limit, std::size_t{1}, std::size_t{100});
        const std::size_t pageEnd = (std::min)(scan.hits.size(), offset + limit);
        BuildFileDiscoveryPage page;
        page.statistics = scan.statistics;
        page.revision = scan.revision;
        page.totalMatches = scan.hits.size();
        page.indexedCount = scan.statistics.scannedEntries;
        const std::size_t effectiveMatches = static_cast<std::size_t>(std::count_if(
            scan.hits.begin(),
            scan.hits.end(),
            [](const auto& hit) { return hit.effectiveWinner; }));
        page.resolution = effectiveMatches == 1
            ? BuildFileResolution::Unique
            : effectiveMatches == 0
                ? BuildFileResolution::NotFound
                : BuildFileResolution::Ambiguous;
        page.complete = scan.complete && pageEnd == scan.hits.size();
        page.cancelled = scan.cancelled;
        if (!page.complete && !scan.cancelled)
        {
            page.nextCursor = scan.revision + L"|" + std::to_wstring(pageEnd);
        }
        page.candidates.reserve(pageEnd - offset);
        std::map<BuildFileScope, std::wstring> scopeRevisions;
        for (std::size_t index = offset; index < pageEnd; ++index)
        {
            auto& hit = scan.hits[index];
            const auto& root = requireRoot(session, hit.scope, hit.root);
            auto& reference = registerReference(*state_, session, root, hit.path);
            auto revision = scopeRevisions.find(hit.scope);
            if (revision == scopeRevisions.end())
            {
                revision = scopeRevisions.emplace(
                    hit.scope,
                    buildWorkspaceIndex(session, hit.scope, request.cancellationRequested).revision).first;
            }
            reference.indexRevision = revision->second;
            reference.resolution = page.resolution;
            reference.effectiveWinner = hit.effectiveWinner;
            BuildFileMetadata metadata = metadataFor(*state_, session, reference);
            metadata.conflictingOwners = std::move(hit.conflictingOwners);
            page.candidates.push_back(BuildFileDiscoveryCandidate{
                std::move(metadata),
                hit.confidence,
                std::move(hit.matchReasons),
                std::move(hit.virtualPath),
                std::move(hit.effectiveOwner),
                hit.effectiveWinner
            });
        }
        return page;
    }

    void BuildFileWorkspaceService::endChat(std::wstring_view chatId)
    {
        std::scoped_lock lock(state_->mutex);
        const auto match = state_->sessions.find(std::wstring(chatId));
        if (match == state_->sessions.end())
        {
            return;
        }
        std::error_code error;
        std::filesystem::remove_all(match->second.checkpointRoot, error);
        state_->sessions.erase(match);
    }

    BuildFileSearchPage BuildFileWorkspaceService::search(
        std::wstring_view chatId,
        const BuildFileSearchRequest& request)
    {
        std::scoped_lock lock(state_->mutex);
        State::Session& session = requireSession(*state_, chatId);
        const WorkspaceIndexSnapshot index =
            buildWorkspaceIndex(session, request.scope, request.cancellationRequested);
        BuildFileSearchPage page;
        page.revision = index.revision;
        page.indexedCount = index.files.size();
        page.indexed = !index.cancelled;
        page.cancelled = index.cancelled;
        if (!request.revision.empty() && request.revision != index.revision)
        {
            throw BuildFileWorkspaceError(
                "stale-revision",
                "Filename index changed; restart search before using earlier results.");
        }

        struct RankedCandidate
        {
            const WorkspaceIndexedFile* file{nullptr};
            int matchRank{4};
            std::size_t depth{0};
            std::wstring sortKey;
        };
        std::vector<std::wstring> queryParts;
        std::wistringstream words(request.query);
        for (std::wstring word; words >> word;)
        {
            const std::wstring normalized = normalizedSearchText(std::move(word));
            if (!normalized.empty())
            {
                queryParts.push_back(normalized);
            }
        }
        if (queryParts.empty())
        {
            const std::wstring normalized = normalizedSearchText(request.query);
            if (!normalized.empty())
            {
                queryParts.push_back(normalized);
            }
        }

        std::vector<RankedCandidate> matches;
        matches.reserve(index.files.size());
        for (const auto& file : index.files)
        {
            const std::wstring normalizedRelativePath =
                normalizedSearchText(file.relative.generic_wstring());
            if (!std::all_of(queryParts.begin(), queryParts.end(), [&](const auto& part)
            {
                return normalizedRelativePath.find(part) != std::wstring::npos;
            }))
            {
                continue;
            }
            RankedCandidate candidate;
            candidate.file = &file;
            candidate.sortKey = lower(file.root->path.generic_wstring()) + L"|" +
                lower(file.relative.generic_wstring());
            for (const auto& part : file.relative)
            {
                ++candidate.depth;
                const std::wstring normalizedPart = normalizedSearchText(part.wstring());
                for (const auto& queryPart : queryParts)
                {
                    if (normalizedPart == queryPart)
                    {
                        candidate.matchRank = (std::min)(candidate.matchRank, 2);
                    }
                    else if (normalizedPart.find(queryPart) != std::wstring::npos)
                    {
                        candidate.matchRank = (std::min)(candidate.matchRank, 3);
                    }
                }
            }
            const std::wstring normalizedFileName =
                normalizedSearchText(file.relative.filename().wstring());
            if (queryParts.size() == 1 && normalizedFileName == queryParts.front())
            {
                candidate.matchRank = 0;
            }
            else if (std::all_of(queryParts.begin(), queryParts.end(), [&](const auto& part)
            {
                return normalizedFileName.find(part) != std::wstring::npos;
            }))
            {
                candidate.matchRank = 1;
            }
            matches.push_back(std::move(candidate));
        }
        std::sort(matches.begin(), matches.end(), [](const auto& left, const auto& right)
        {
            if (left.matchRank != right.matchRank)
            {
                return left.matchRank < right.matchRank;
            }
            if (left.depth != right.depth)
            {
                return left.depth < right.depth;
            }
            return left.sortKey < right.sortKey;
        });

        const std::size_t offset = cursorOffset(request.cursor, index.revision, L"Search");
        if (offset > matches.size())
        {
            throw BuildFileWorkspaceError("validation-failed", "Search cursor is outside the result set.");
        }
        const std::size_t limit = std::clamp(request.limit, std::size_t{1}, maximumSearchResults);
        const std::size_t pageEnd = (std::min)(matches.size(), offset + limit);
        page.totalMatches = matches.size();
        page.complete = !page.cancelled && pageEnd == matches.size();
        if (!page.complete && !page.cancelled)
        {
            page.nextCursor = index.revision + L"|" + std::to_wstring(pageEnd);
        }
        page.entries.reserve(pageEnd - offset);
        for (std::size_t candidateIndex = offset; candidateIndex < pageEnd; ++candidateIndex)
        {
            const auto& candidate = *matches[candidateIndex].file;
            auto& reference = registerReference(*state_, session, *candidate.root, candidate.path);
            reference.indexRevision = index.revision;
            reference.resolution = matches.size() == 1
                ? BuildFileResolution::Unique
                : BuildFileResolution::Ambiguous;
            reference.effectiveWinner = matches.size() == 1;
            page.entries.push_back(metadataFor(*state_, session, reference));
        }
        return page;
    }

    BuildFileMetadata BuildFileWorkspaceService::stat(
        std::wstring_view chatId,
        std::wstring_view fileRef)
    {
        std::scoped_lock lock(state_->mutex);
        State::Session& session = requireSession(*state_, chatId);
        auto& reference = requireReference(session, fileRef);
        return metadataFor(*state_, session, reference);
    }

    BuildFileTextRead BuildFileWorkspaceService::readText(
        std::wstring_view chatId,
        const BuildFileTextReadRequest& request)
    {
        std::scoped_lock lock(state_->mutex);
        State::Session& session = requireSession(*state_, chatId);
        State::Reference& reference = requireReference(session, request.fileRef);
        if (reference.kind == BuildFileKind::Archive)
        {
            throw BuildFileWorkspaceError("protected", "Archive contents are metadata-only in v1.");
        }
        if (reference.kind != BuildFileKind::Text)
        {
            throw BuildFileWorkspaceError("protected", "Only allowlisted text files can be read.");
        }
        const std::vector<char> bytes = readBytes(reference.path);
        const DecodedText decoded = decodeText(bytes);
        const std::wstring hash = sha256(bytes);
        reference.read = true;
        reference.readHash = hash;
        reference.encoding = decoded.encoding;
        reference.lineEnding = decoded.lineEnding;

        const std::vector<std::wstring> lines = splitLines(decoded.text);
        const std::size_t start = request.startLine == 0 ? 1 : request.startLine;
        const std::size_t startIndex = (std::min)(start - 1, lines.size());
        const std::size_t maximumLines = std::clamp(
            request.maxLines,
            std::size_t{1},
            request.editorMode ? std::size_t{65'536} : std::size_t{120});
        const std::size_t maximumBytes = std::clamp(request.maxBytes, std::size_t{1}, std::size_t{64 * 1024});
        std::wstring fragment;
        std::size_t endLine = start;
        for (std::size_t index = startIndex; index < lines.size() && index < startIndex + maximumLines; ++index)
        {
            const std::wstring suffix = index + 1 < lines.size() ? L"\n" : L"";
            if ((fragment.size() + lines[index].size() + suffix.size()) * sizeof(wchar_t) > maximumBytes)
            {
                break;
            }
            fragment += lines[index];
            fragment += suffix;
            endLine = index + 1;
        }
        BuildFileTextRead result;
        result.fileRef = reference.token;
        result.scope = reference.scope;
        result.relativePath = reference.relativePath;
        result.content = std::move(fragment);
        result.startLine = start;
        result.endLine = endLine;
        result.truncated = endLine < lines.size();
        result.encoding = decoded.encoding;
        result.lineEnding = decoded.lineEnding;
        result.sha256 = hash;
        result.revision = reference.indexRevision;
        result.version = versionFor(reference.path, hash);
        return result;
    }

    BuildFileQueryResult BuildFileWorkspaceService::queryJson(
        std::wstring_view chatId,
        std::wstring_view fileRef,
        std::wstring_view pointer)
    {
        std::scoped_lock lock(state_->mutex);
        State::Session& session = requireSession(*state_, chatId);
        State::Reference& reference = requireReference(session, fileRef);
        const std::wstring extension = lower(reference.path.extension().wstring());
        if (reference.kind != BuildFileKind::Text || (extension != L".json" && extension != L".jsonc"))
        {
            throw BuildFileWorkspaceError("protected", "JSON queries require an allowlisted JSON/JSONC fileRef.");
        }
        const std::vector<char> bytes = readBytes(reference.path);
        const DecodedText decoded = decodeText(bytes);
        std::optional<JsonValue> root;
        try
        {
            root.emplace(JsonReader::parse(
                extension == L".jsonc" ? jsonWithoutComments(decoded.text) : decoded.text));
        }
        catch (const std::exception&)
        {
            throw BuildFileWorkspaceError("validation-failed", "JSON/JSONC document could not be parsed.");
        }
        const std::wstring hash = sha256(bytes);
        reference.read = true;
        reference.readHash = hash;
        reference.encoding = decoded.encoding;
        reference.lineEnding = decoded.lineEnding;
        BuildFileQueryResult result;
        result.fileRef = reference.token;
        result.query = std::wstring(pointer);
        if (pointer == L"@outline")
        {
            result.kind = extension == L".jsonc" ? L"jsonc-outline" : L"json-outline";
            result.value = jsonOutline(*root);
        }
        else
        {
            const JsonValue& selected = resolveJsonPointer(*root, pointer);
            result.kind = extension == L".jsonc" ? L"jsonc-pointer" : L"json-pointer";
            result.value = serializeJsonValue(selected);
        }
        if (result.value.size() * sizeof(wchar_t) > 64 * 1024)
        {
            throw BuildFileWorkspaceError("too-large", "JSON query result exceeds the 64 KiB hard cap.");
        }
        result.sha256 = hash;
        result.version = versionFor(reference.path, hash);
        return result;
    }

    BuildFileQueryResult BuildFileWorkspaceService::queryIni(
        std::wstring_view chatId,
        std::wstring_view fileRef,
        std::wstring_view section,
        std::wstring_view key)
    {
        std::scoped_lock lock(state_->mutex);
        State::Session& session = requireSession(*state_, chatId);
        State::Reference& reference = requireReference(session, fileRef);
        const std::wstring extension = lower(reference.path.extension().wstring());
        if (reference.kind != BuildFileKind::Text ||
            (extension != L".ini" && extension != L".cfg" && extension != L".conf"))
        {
            throw BuildFileWorkspaceError("protected", "INI queries require an INI/CFG/CONF fileRef.");
        }
        const std::vector<char> bytes = readBytes(reference.path);
        const DecodedText decoded = decodeText(bytes);
        const std::wstring wantedSection = lower(trimText(section));
        const std::wstring wantedKey = lower(trimText(key));
        std::wstring currentSection;
        std::wstring resultText;
        for (const std::wstring& line : splitLines(decoded.text))
        {
            const std::wstring trimmed = trimText(line);
            if (trimmed.size() >= 2 && trimmed.front() == L'[' && trimmed.back() == L']')
            {
                currentSection = lower(trimText(std::wstring_view(trimmed).substr(1, trimmed.size() - 2)));
                if (wantedSection.empty() || currentSection == wantedSection)
                {
                    resultText += line + L"\n";
                }
                continue;
            }
            if ((!wantedSection.empty() && currentSection != wantedSection) ||
                trimmed.empty() || trimmed.front() == L';' || trimmed.front() == L'#')
            {
                continue;
            }
            const std::size_t separator = line.find_first_of(L"=:");
            if (separator == std::wstring::npos) continue;
            const std::wstring lineKey = lower(trimText(std::wstring_view(line).substr(0, separator)));
            if (wantedKey.empty() || lineKey == wantedKey)
            {
                resultText += line + L"\n";
            }
        }
        if (!wantedKey.empty() && resultText.empty())
        {
            throw BuildFileWorkspaceError("validation-failed", "INI section/key was not found.");
        }
        if (resultText.size() * sizeof(wchar_t) > 64 * 1024)
        {
            throw BuildFileWorkspaceError("too-large", "INI query result exceeds the 64 KiB hard cap.");
        }
        const std::wstring hash = sha256(bytes);
        reference.read = true;
        reference.readHash = hash;
        reference.encoding = decoded.encoding;
        reference.lineEnding = decoded.lineEnding;
        BuildFileQueryResult result;
        result.fileRef = reference.token;
        result.query = std::wstring(section) + L"/" + std::wstring(key);
        result.kind = L"ini-line-model";
        result.value = std::move(resultText);
        result.sha256 = hash;
        result.version = versionFor(reference.path, hash);
        return result;
    }

    ConfigRecipeInspection BuildFileWorkspaceService::inspectConfigRecipe(
        std::wstring_view chatId,
        std::wstring_view fileRef,
        std::wstring_view targetPointer,
        std::wstring_view requestedValue)
    {
        std::scoped_lock lock(state_->mutex);
        State::Session& session = requireSession(*state_, chatId);
        State::Reference& reference = requireReference(session, fileRef);
        if (reference.kind != BuildFileKind::Text)
        {
            throw BuildFileWorkspaceError("protected", "Config recipes require an allowlisted text fileRef.");
        }
        const std::vector<char> bytes = readBytes(reference.path);
        const DecodedText decoded = decodeText(bytes);
        const std::wstring extension = lower(reference.path.extension().wstring());
        ConfigRecipeInspection result = state_->configRecipes.inspect(
            reference.relativePath,
            extension == L".jsonc" ? jsonWithoutComments(decoded.text) : decoded.text,
            targetPointer,
            requestedValue);
        if (!result.matched)
        {
            throw BuildFileWorkspaceError(
                "validation-failed",
                "No trusted local configuration recipe matched this file.");
        }
        reference.read = true;
        reference.readHash = sha256(bytes);
        reference.encoding = decoded.encoding;
        reference.lineEnding = decoded.lineEnding;
        return result;
    }

    BuildFileTextSearchPage BuildFileWorkspaceService::searchText(
        std::wstring_view chatId,
        const BuildFileSearchRequest& request)
    {
        std::scoped_lock lock(state_->mutex);
        State::Session& session = requireSession(*state_, chatId);
        const std::wstring query = lower(trimText(request.query));
        if (query.empty())
        {
            throw BuildFileWorkspaceError("validation-failed", "Content search query is required.");
        }
        const WorkspaceIndexSnapshot index =
            buildWorkspaceIndex(session, request.scope, request.cancellationRequested);
        if (!request.revision.empty() && request.revision != index.revision)
        {
            throw BuildFileWorkspaceError(
                "stale-revision",
                "Content index changed; restart search before using earlier results.");
        }

        BuildFileTextSearchPage page;
        page.revision = index.revision;
        page.indexedCount = index.files.size();
        page.cancelled = index.cancelled;
        std::vector<BuildFileTextSearchMatch> matches;
        for (const auto& file : index.files)
        {
            if (request.cancellationRequested && request.cancellationRequested())
            {
                page.cancelled = true;
                break;
            }
            if (file.kind != BuildFileKind::Text)
            {
                continue;
            }
            DecodedText decoded;
            try
            {
                decoded = decodeText(readBytes(file.path));
            }
            catch (const BuildFileWorkspaceError&)
            {
                continue;
            }
            const auto lines = splitLines(decoded.text);
            for (std::size_t lineIndex = 0; lineIndex < lines.size(); ++lineIndex)
            {
                if (lower(lines[lineIndex]).find(query) == std::wstring::npos)
                {
                    continue;
                }
                auto& reference = registerReference(*state_, session, *file.root, file.path);
                reference.indexRevision = index.revision;
                const auto joinContext = [&lines](std::size_t begin, std::size_t finish)
                {
                    std::wstring context;
                    for (std::size_t contextIndex = begin; contextIndex < finish; ++contextIndex)
                    {
                        if (!context.empty())
                        {
                            context += L"\n";
                        }
                        context += lines[contextIndex];
                    }
                    return context;
                };
                matches.push_back(BuildFileTextSearchMatch{
                    reference.token,
                    reference.scope,
                    reference.relativePath,
                    lineIndex + 1,
                    joinContext(lineIndex > 2 ? lineIndex - 2 : 0, lineIndex),
                    lines[lineIndex],
                    joinContext(lineIndex + 1, (std::min)(lines.size(), lineIndex + 3))});
            }
        }

        const std::size_t offset = cursorOffset(request.cursor, index.revision, L"Content search");
        if (offset > matches.size())
        {
            throw BuildFileWorkspaceError(
                "validation-failed",
                "Content search cursor is outside the result set.");
        }
        const std::size_t limit = std::clamp(request.limit, std::size_t{1}, maximumSearchResults);
        const std::size_t pageEnd = (std::min)(matches.size(), offset + limit);
        page.totalMatches = matches.size();
        page.complete = !page.cancelled && pageEnd == matches.size();
        if (!page.complete && !page.cancelled)
        {
            page.nextCursor = index.revision + L"|" + std::to_wstring(pageEnd);
        }
        page.matches.assign(matches.begin() + static_cast<std::ptrdiff_t>(offset),
            matches.begin() + static_cast<std::ptrdiff_t>(pageEnd));
        return page;
    }

    FluxoraAiFileChangeSet BuildFileWorkspaceService::apply(
        std::wstring_view chatId,
        std::wstring_view runId,
        std::wstring_view operationId,
        const std::vector<BuildFileMutation>& mutations)
    {
        if (runId.empty() || operationId.empty())
        {
            throw BuildFileWorkspaceError("validation-failed", "Run and operation ids are required.");
        }
        if (mutations.empty() || mutations.size() > maximumBatchFiles)
        {
            throw BuildFileWorkspaceError("too-large", "A file mutation batch must contain 1 to 16 files.");
        }
        std::scoped_lock lock(state_->mutex);
        State::Session& session = requireSession(*state_, chatId);
        if (session.runs.contains(std::wstring(runId)))
        {
            throw BuildFileWorkspaceError("validation-failed", "Run id has already been used.");
        }

        struct Plan
        {
            std::wstring referenceToken;
            BuildFileMutation mutation;
            std::filesystem::path sourcePath;
            std::filesystem::path root;
            std::filesystem::path path;
            BuildFileScope scope{BuildFileScope::Build};
            std::wstring relativePath;
            BuildFileTextEncoding encoding{BuildFileTextEncoding::Unsupported};
            bool created{false};
            std::vector<char> beforeBytes;
            std::vector<char> afterBytes;
            std::wstring beforeText;
            std::wstring afterText;
            std::wstring beforeHash;
            std::wstring afterHash;
            std::wstring beforeVersion;
            std::wstring afterVersion;
            std::wstring verification{L"sha256-matched-after-reread"};
            std::size_t matchOffset{0};
            std::optional<ManagedAiOverridePlan> managedOverride;
            bool registeredManagedMod{false};
        };
        std::vector<Plan> plans;
        plans.reserve(mutations.size());
        std::set<std::wstring> uniqueRefs;
        std::size_t changedBytes = 0;
        for (const BuildFileMutation& mutation : mutations)
        {
            const std::wstring uniquenessKey = mutation.createFile
                ? L"create:" + mutation.parentRef + L":" + lower(mutation.fileName)
                : L"patch:" + mutation.fileRef;
            if (!uniqueRefs.insert(uniquenessKey).second)
            {
                throw BuildFileWorkspaceError("validation-failed", "A batch cannot mutate one file twice.");
            }
            if (mutation.createFile)
            {
                State::Reference& parent = requireReference(session, mutation.parentRef);
                if (parent.kind != BuildFileKind::Directory)
                {
                    throw BuildFileWorkspaceError("outside-scope", "Create requires an existing folder parentRef.");
                }
                if (parent.scope != BuildFileScope::Build || parent.contentsAreVirtualRoot)
                {
                    throw BuildFileWorkspaceError(
                        "protected",
                        "AI file creation is allowed only through the managed mod override scope.");
                }
                const std::filesystem::path fileName(mutation.fileName);
                if (!mutation.expectedAbsent ||
                    fileName.empty() ||
                    fileName.is_absolute() ||
                    fileName.has_parent_path() ||
                    fileName.filename() != fileName ||
                    !isAllowedTextExtension(fileName.extension().wstring()))
                {
                    throw BuildFileWorkspaceError("protected", "Create requires a safe allowlisted text filename and expectedAbsent=true.");
                }
                Plan plan;
                plan.mutation = mutation;
                plan.root = parent.root;
                plan.sourcePath = parent.path / fileName;
                plan.path = plan.sourcePath;
                plan.scope = parent.scope;
                plan.relativePath = normalizedRelative(plan.path.lexically_relative(plan.root));
                plan.encoding = BuildFileTextEncoding::Utf8;
                plan.created = true;
                const std::wstring extension = lower(fileName.extension().wstring());
                if ((extension == L".json" && mutation.format != BuildFileMutationFormat::Json) ||
                    (extension == L".jsonc" && mutation.format != BuildFileMutationFormat::Jsonc))
                {
                    throw BuildFileWorkspaceError("validation-failed", "Created JSON/JSONC files require matching full-document validation.");
                }
                ensureContained(plan.root, plan.sourcePath);
                if (isProtectedRelativePath(plan.relativePath))
                {
                    throw BuildFileWorkspaceError("protected", "Fluxora-managed files cannot be created by raw AI tools.");
                }
                std::error_code existsError;
                if (std::filesystem::exists(plan.sourcePath, existsError) || existsError)
                {
                    throw BuildFileWorkspaceError("stale-version", "Create never overwrites an existing file.");
                }
                ManagedAiOverridePlan managed;
                try
                {
                    managed = state_->managedOverrides.plan(
                        session.projectDirectory,
                        session.profileName,
                        parent.root,
                        plan.sourcePath);
                }
                catch (const std::exception&)
                {
                    throw BuildFileWorkspaceError(
                        "stale-version",
                        "Managed override create target is no longer available.");
                }
                if (managed.targetExisted)
                {
                    throw BuildFileWorkspaceError("stale-version", "Create never overwrites an existing managed override.");
                }
                plan.root = managed.modsRoot;
                plan.path = managed.targetPath;
                plan.relativePath = managed.relativePath;
                plan.managedOverride = managed;
                plan.afterText = mutation.content;
                validateMutationText(plan.afterText, mutation.format);
                plan.afterBytes = encodeText(plan.afterText, plan.encoding);
                if (plan.afterBytes.size() > maximumFileBytes)
                {
                    throw BuildFileWorkspaceError("too-large", "Created file exceeds the 5 MiB limit.");
                }
                changedBytes += plan.afterBytes.size();
                if (changedBytes > maximumChangedTextBytes)
                {
                    throw BuildFileWorkspaceError("too-large", "Batch exceeds the 2 MiB changed-text limit.");
                }
                plan.beforeHash = L"absent";
                plan.beforeVersion = L"absent";
                plan.afterHash = sha256(plan.afterBytes);
                plans.push_back(std::move(plan));
                continue;
            }
            State::Reference& reference = requireReference(session, mutation.fileRef);
            if (reference.scope != BuildFileScope::Build || reference.contentsAreVirtualRoot)
            {
                throw BuildFileWorkspaceError(
                    "protected",
                    "AI file changes are allowed only through the managed mod override scope.");
            }
            if (reference.resolution != BuildFileResolution::Unique || !reference.effectiveWinner)
            {
                throw BuildFileWorkspaceError(
                    "ambiguous",
                    "File changes require one unique effective VFS winner.");
            }
            if (mutation.revision.empty() || reference.indexRevision.empty() ||
                mutation.revision != reference.indexRevision)
            {
                throw BuildFileWorkspaceError(
                    "stale-revision",
                    "File change revision does not match the resolved workspace index.");
            }
            const WorkspaceIndexSnapshot currentIndex =
                buildWorkspaceIndex(session, reference.scope, {});
            if (currentIndex.revision != mutation.revision)
            {
                throw BuildFileWorkspaceError(
                    "stale-revision",
                    "Workspace index changed after target resolution.");
            }
            if (!reference.read || reference.readHash.empty())
            {
                throw BuildFileWorkspaceError("stale-version", "A file must be read before it can be changed.");
            }
            if (reference.kind != BuildFileKind::Text || isProtectedRelativePath(reference.relativePath))
            {
                throw BuildFileWorkspaceError("protected", "This file cannot be changed by raw AI tools.");
            }
            const std::wstring extension = lower(reference.path.extension().wstring());
            if ((mutation.format == BuildFileMutationFormat::Json && extension != L".json") ||
                (mutation.format == BuildFileMutationFormat::Jsonc && extension != L".jsonc") ||
                (mutation.format == BuildFileMutationFormat::Ini &&
                    extension != L".ini" && extension != L".cfg" && extension != L".conf"))
            {
                throw BuildFileWorkspaceError("validation-failed", "Mutation format does not match the target extension.");
            }
            Plan plan;
            plan.referenceToken = reference.token;
            plan.mutation = mutation;
            plan.sourcePath = reference.path;
            plan.root = reference.root;
            plan.path = reference.path;
            plan.scope = reference.scope;
            plan.relativePath = reference.relativePath;
            plan.encoding = reference.encoding;
            plan.beforeBytes = readBytes(reference.path);
            plan.beforeHash = sha256(plan.beforeBytes);
            plan.beforeVersion = versionFor(reference.path, plan.beforeHash);
            if (mutation.baseSha256.empty() ||
                mutation.baseSha256 != reference.readHash ||
                mutation.baseSha256 != plan.beforeHash)
            {
                throw BuildFileWorkspaceError("stale-version", "File changed after the AI read it.");
            }
            const DecodedText decoded = decodeText(plan.beforeBytes);
            if (decoded.encoding != reference.encoding)
            {
                throw BuildFileWorkspaceError("stale-version", "File encoding changed after the AI read it.");
            }
            plan.beforeText = decoded.text;
            if (mutation.operation == BuildFileMutationOperation::JsonSetPointer)
            {
                if (reference.scope != BuildFileScope::Build ||
                    (extension != L".json" && extension != L".jsonc"))
                {
                    throw BuildFileWorkspaceError(
                        "protected",
                        "Semantic JSON mutations require a mod-owned JSON effective winner.");
                }
                if (reference.contentsAreVirtualRoot)
                {
                    throw BuildFileWorkspaceError(
                        "protected",
                        "The effective file is owned by Overwrite and cannot be superseded by a managed mod without changing the original.");
                }
                const ConfigRecipeInspection recipe = state_->configRecipes.inspect(
                    reference.relativePath,
                    extension == L".jsonc" ? jsonWithoutComments(plan.beforeText) : plan.beforeText,
                    mutation.pointer,
                    mutation.value);
                if (recipe.needsInput && !mutation.allowKnownConflict)
                {
                    throw BuildFileWorkspaceError("needs-input", narrowAscii(recipe.question));
                }
                ManagedAiOverridePlan managed;
                try
                {
                    managed = state_->managedOverrides.plan(
                        session.projectDirectory,
                        session.profileName,
                        reference.root,
                        reference.path);
                }
                catch (const std::exception&)
                {
                    throw BuildFileWorkspaceError(
                        "stale-version",
                        "Managed override target is no longer available for this discovery result.");
                }
                plan.root = managed.modsRoot;
                plan.path = managed.targetPath;
                plan.relativePath = managed.relativePath;
                plan.created = !managed.targetExisted;
                plan.managedOverride = managed;
                JsonValue document = JsonValue::null();
                JsonValue expected = JsonValue::null();
                JsonValue replacement = JsonValue::null();
                try
                {
                    document = JsonReader::parse(
                        extension == L".jsonc" ? jsonWithoutComments(plan.beforeText) : plan.beforeText);
                    expected = JsonReader::parse(mutation.expectedValue);
                    replacement = JsonReader::parse(mutation.value);
                }
                catch (const std::exception&)
                {
                    throw BuildFileWorkspaceError(
                        "validation-failed",
                        "JSON Pointer mutation values must be valid JSON values.");
                }
                JsonValue& selected = resolveMutableJsonPointer(document, mutation.pointer);
                if (serializeJsonValue(selected) != serializeJsonValue(expected))
                {
                    throw BuildFileWorkspaceError(
                        "stale-version",
                        "JSON Pointer value changed after discovery.");
                }
                selected = std::move(replacement);
                plan.afterText = serializeJsonValue(document);
                if (decoded.lineEnding == BuildFileLineEnding::CrLf)
                {
                    plan.afterText += L"\r\n";
                }
                else if (decoded.lineEnding != BuildFileLineEnding::None)
                {
                    plan.afterText += L"\n";
                }
                plan.mutation.expectedText = mutation.expectedValue;
                plan.mutation.replacementText = mutation.value;
                plan.verification = L"json-pointer-matched-after-reread";
            }
            else if (mutation.operation == BuildFileMutationOperation::ExactPatch)
            {
                if (mutation.wholeDocument)
                {
                    plan.matchOffset = 0;
                    plan.mutation.expectedText = plan.beforeText;
                    plan.afterText = mutation.replacementText;
                }
                else if (mutation.expectedText.empty())
                {
                    throw BuildFileWorkspaceError("ambiguous", "Exact patch context cannot be empty.");
                }
                else
                {
                    plan.matchOffset = plan.beforeText.find(mutation.expectedText);
                    if (plan.matchOffset == std::wstring::npos ||
                        plan.beforeText.find(mutation.expectedText, plan.matchOffset + 1) != std::wstring::npos)
                    {
                        throw BuildFileWorkspaceError("ambiguous", "Exact patch context must match exactly once.");
                    }
                    plan.afterText = plan.beforeText;
                    plan.afterText.replace(
                        plan.matchOffset,
                        mutation.expectedText.size(),
                        mutation.replacementText);
                }
            }
            else
            {
                if (mutation.format != BuildFileMutationFormat::Ini ||
                    reference.scope != BuildFileScope::Build)
                {
                    throw BuildFileWorkspaceError(
                        "protected",
                        "Semantic INI mutations require a mod-owned effective winner.");
                }
                if (reference.contentsAreVirtualRoot)
                {
                    throw BuildFileWorkspaceError(
                        "protected",
                        "The effective file is owned by Overwrite and cannot be superseded by a managed mod without changing the original.");
                }
                ManagedAiOverridePlan managed;
                try
                {
                    managed = state_->managedOverrides.plan(
                        session.projectDirectory,
                        session.profileName,
                        reference.root,
                        reference.path);
                }
                catch (const std::exception&)
                {
                    throw BuildFileWorkspaceError(
                        "stale-version",
                        "Managed override target is no longer available for this discovery result.");
                }
                plan.root = managed.modsRoot;
                plan.path = managed.targetPath;
                plan.relativePath = managed.relativePath;
                plan.created = !managed.targetExisted;
                plan.managedOverride = managed;
                const IniLineEdit edit = applyIniKeyOperation(
                    plan.beforeText,
                    mutation.operation,
                    mutation.section,
                    mutation.key,
                    mutation.value);
                if (!mutation.expectedValue.empty())
                {
                    const auto values = iniKeyValues(
                        plan.beforeText,
                        mutation.section,
                        mutation.key);
                    if (values.size() != 1 || values.front() != trimText(mutation.expectedValue))
                    {
                        throw BuildFileWorkspaceError(
                            "stale-version",
                            "INI key value changed after discovery.");
                    }
                }
                plan.matchOffset = edit.offset;
                plan.mutation.expectedText = edit.expected;
                plan.mutation.replacementText = edit.replacement;
                plan.afterText = plan.beforeText;
                plan.afterText.replace(edit.offset, edit.expected.size(), edit.replacement);
                plan.verification = L"ini-key-matched-after-reread";
            }
            if (!plan.managedOverride.has_value())
            {
                ManagedAiOverridePlan managed;
                try
                {
                    managed = state_->managedOverrides.plan(
                        session.projectDirectory,
                        session.profileName,
                        reference.root,
                        reference.path);
                }
                catch (const std::exception&)
                {
                    throw BuildFileWorkspaceError(
                        "stale-version",
                        "Managed override target is no longer available for this discovery result.");
                }
                plan.root = managed.modsRoot;
                plan.path = managed.targetPath;
                plan.relativePath = managed.relativePath;
                plan.created = !managed.targetExisted;
                plan.managedOverride = managed;
            }
            validateMutationText(plan.afterText, mutation.format);
            plan.afterBytes = encodeText(plan.afterText, reference.encoding);
            if (plan.afterBytes.size() > maximumFileBytes)
            {
                throw BuildFileWorkspaceError("too-large", "Resulting file exceeds the 5 MiB limit.");
            }
            changedBytes += (std::max)(
                plan.mutation.expectedText.size(),
                plan.mutation.replacementText.size()) * sizeof(wchar_t);
            if (changedBytes > maximumChangedTextBytes)
            {
                throw BuildFileWorkspaceError("too-large", "Batch exceeds the 2 MiB changed-text limit.");
            }
            plan.afterHash = sha256(plan.afterBytes);
            plans.push_back(std::move(plan));
        }

        std::map<std::filesystem::path, std::uintmax_t> requiredBytesByVolume;
        for (const auto& plan : plans)
        {
            requiredBytesByVolume[plan.root] +=
                static_cast<std::uintmax_t>(plan.beforeBytes.size() + plan.afterBytes.size()) + 64 * 1024;
        }
        for (const auto& [root, requiredBytes] : requiredBytesByVolume)
        {
            std::error_code spaceError;
            const auto space = std::filesystem::space(root, spaceError);
            if (spaceError)
            {
                throw BuildFileWorkspaceError("permission-denied", "Free disk space could not be verified.");
            }
            if (space.available < requiredBytes)
            {
                throw BuildFileWorkspaceError("too-large", "Insufficient free disk space for atomic write and checkpoints.");
            }
        }

        State::Run run;
        run.operationId = std::wstring(operationId);
        const std::filesystem::path runCheckpointRoot =
            session.checkpointRoot / checkpointSegment(runId);
        std::vector<std::size_t> committed;
        try
        {
            for (std::size_t index = 0; index < plans.size(); ++index)
            {
                Plan& plan = plans[index];
                const std::filesystem::path checkpoint =
                    runCheckpointRoot / (L"file_" + std::to_wstring(index) + L".checkpoint");
                if (!plan.created)
                {
                    writeCheckpoint(checkpoint, plan.beforeBytes);
                }

                PathSafetyWriteOptions writeOptions;
                writeOptions.requiredBytes = plan.afterBytes.size();
                PathSafetyService()
                    .validateWritePath(plan.root, plan.path, writeOptions)
                    .throwIfUnsafe("AI build file patch");
                if (plan.created && std::filesystem::exists(plan.path))
                {
                    throw BuildFileWorkspaceError("stale-version", "Create target appeared during commit.");
                }
                AtomicFileStore().writeTextFile(
                    plan.path,
                    std::string(plan.afterBytes.begin(), plan.afterBytes.end()),
                    AtomicFileWriteOptions{L"AI build file", ProjectStateValidation::None, {}, true});
                const std::vector<char> verifiedBytes = readBytes(plan.path);
                if (sha256(verifiedBytes) != plan.afterHash)
                {
                    throw BuildFileWorkspaceError("validation-failed", "Post-write verification failed.");
                }
                committed.push_back(index);
                if (plan.managedOverride.has_value())
                {
                    if (plan.mutation.createFile)
                    {
                        std::error_code sourceError;
                        if (std::filesystem::exists(plan.sourcePath, sourceError) || sourceError)
                        {
                            throw BuildFileWorkspaceError(
                                "stale-version",
                                "Source mod create target appeared while the managed override was committed.");
                        }
                    }
                    else if (plan.created && sha256(readBytes(plan.sourcePath)) != plan.beforeHash)
                    {
                        throw BuildFileWorkspaceError(
                            "stale-version",
                            "Effective source changed while the managed override was committed.");
                    }
                    plan.registeredManagedMod = state_->managedOverrides.activate(
                        session.projectDirectory,
                        session.profileName,
                        *plan.managedOverride,
                        operationId);
                    try
                    {
                        const DecodedText verified = decodeText(verifiedBytes);
                        if (plan.mutation.operation == BuildFileMutationOperation::JsonSetPointer)
                        {
                            JsonValue verifiedJson = JsonReader::parse(
                                plan.mutation.format == BuildFileMutationFormat::Jsonc
                                    ? jsonWithoutComments(verified.text)
                                    : verified.text);
                            if (serializeJsonValue(resolveJsonPointer(verifiedJson, plan.mutation.pointer)) !=
                                serializeJsonValue(JsonReader::parse(plan.mutation.value)))
                            {
                                throw BuildFileWorkspaceError(
                                    "validation-failed",
                                    "JSON Pointer postcondition did not match after reread.");
                            }
                        }
                        else if (plan.mutation.operation != BuildFileMutationOperation::ExactPatch)
                        {
                            const auto values = iniKeyValues(
                                verified.text,
                                plan.mutation.section,
                                plan.mutation.key);
                            const bool removed =
                                plan.mutation.operation == BuildFileMutationOperation::IniRemoveKey;
                            if ((removed && !values.empty()) ||
                                (!removed && (values.size() != 1 ||
                                    values.front() != trimText(plan.mutation.value))))
                            {
                                throw BuildFileWorkspaceError(
                                    "validation-failed",
                                    "INI key postcondition did not match after reread.");
                            }
                        }
                    }
                    catch (const BuildFileWorkspaceError&)
                    {
                        throw;
                    }
                    catch (const std::exception&)
                    {
                        throw BuildFileWorkspaceError(
                            "validation-failed",
                            "Managed override config could not be verified after reread.");
                    }
                }
                if (plan.created)
                {
                    auto& reference = registerReference(
                        *state_,
                        session,
                        requireRoot(session, plan.scope),
                        plan.path);
                    reference.read = true;
                    reference.readHash = plan.afterHash;
                    reference.encoding = plan.encoding;
                    reference.lineEnding = detectLineEnding(plan.afterText);
                    plan.referenceToken = reference.token;
                }
                plan.afterVersion = versionFor(plan.path, plan.afterHash);

                State::Reference& committedReference =
                    requireReference(session, plan.referenceToken);

                BuildFileChange change;
                change.fileRef = committedReference.token;
                change.scope = committedReference.scope;
                change.ownerMod = ownerModFor(committedReference.scope, committedReference.relativePath);
                change.relativePath = committedReference.relativePath;
                change.status = plan.created
                    ? BuildFileChangeStatus::Created
                    : BuildFileChangeStatus::Applied;
                change.validation = L"validated-in-memory";
                change.verification = plan.verification;
                change.beforeVersion = plan.beforeVersion;
                change.afterVersion = plan.afterVersion;
                BuildFileDiffHunk hunk;
                hunk.oldStart = plan.created ? 1 : lineAt(plan.beforeText, plan.matchOffset);
                hunk.newStart = hunk.oldStart;
                const auto removed = plan.mutation.createFile
                    ? std::vector<std::wstring>{}
                    : splitLines(plan.mutation.expectedText);
                const auto added = splitLines(
                    plan.mutation.createFile
                        ? plan.mutation.content
                        : plan.mutation.replacementText);
                hunk.oldLines = removed.size();
                hunk.newLines = added.size();
                for (const auto& line : removed)
                {
                    hunk.lines.push_back(L"-" + line);
                }
                for (const auto& line : added)
                {
                    hunk.lines.push_back(L"+" + line);
                }
                change.removedLines = removed.size();
                change.addedLines = added.size();
                change.hunks.push_back(std::move(hunk));
                run.changes.push_back(State::ChangeRecord{
                    committedReference.token,
                    plan.path,
                    checkpoint,
                    plan.beforeHash,
                    plan.afterHash,
                    plan.encoding,
                    plan.created,
                    plan.managedOverride,
                    plan.registeredManagedMod,
                    change
                });
                committedReference.readHash = plan.afterHash;
            }
        }
        catch (...)
        {
            for (auto iterator = committed.rbegin(); iterator != committed.rend(); ++iterator)
            {
                Plan& plan = plans[*iterator];
                try
                {
                    if (plan.created)
                    {
                        std::filesystem::remove(plan.path);
                        if (plan.managedOverride.has_value())
                        {
                            state_->managedOverrides.cleanupAfterRollback(
                                session.projectDirectory,
                                *plan.managedOverride,
                                plan.registeredManagedMod,
                                operationId);
                        }
                    }
                    else
                    {
                        AtomicFileStore().writeTextFile(
                            plan.path,
                            std::string(plan.beforeBytes.begin(), plan.beforeBytes.end()),
                            AtomicFileWriteOptions{L"AI build file recovery", ProjectStateValidation::None, {}, true});
                        requireReference(session, plan.referenceToken).readHash = plan.beforeHash;
                    }
                }
                catch (...)
                {
                }
            }
            std::error_code error;
            std::filesystem::remove_all(runCheckpointRoot, error);
            throw;
        }

        FluxoraAiFileChangeSet result;
        result.operationId = std::wstring(operationId);
        result.runId = std::wstring(runId);
        result.chatId = std::wstring(chatId);
        for (const auto& change : run.changes)
        {
            result.files.push_back(change.change);
        }
        session.runs.emplace(std::wstring(runId), std::move(run));
        state_->logger.writeOperation(
            LogLevel::Info,
            "AiBuildFiles",
            "Applied AI file batch files=" + std::to_string(result.files.size()) +
                " operationId=" + narrowAscii(operationId));
        return result;
    }

    BuildFileRollbackResult BuildFileWorkspaceService::rollbackFile(
        std::wstring_view chatId,
        std::wstring_view runId,
        std::wstring_view fileRef,
        std::wstring_view operationId)
    {
        std::scoped_lock lock(state_->mutex);
        State::Session& session = requireSession(*state_, chatId);
        const auto runMatch = session.runs.find(std::wstring(runId));
        if (runMatch == session.runs.end())
        {
            throw BuildFileWorkspaceError("validation-failed", "Change run was not found.");
        }
        State::Run& run = runMatch->second;
        const auto changeMatch = std::find_if(run.changes.begin(), run.changes.end(), [fileRef](const auto& change)
        {
            return change.fileRef == fileRef;
        });
        if (changeMatch == run.changes.end())
        {
            throw BuildFileWorkspaceError("validation-failed", "Changed file was not found in the run.");
        }
        BuildFileRollbackResult result;
        result.operationId = std::wstring(operationId);
        result.runId = std::wstring(runId);
        const std::vector<char> current = readBytes(changeMatch->path);
        if (sha256(current) != changeMatch->afterHash)
        {
            BuildFileChange conflict = changeMatch->change;
            conflict.status = BuildFileChangeStatus::Conflict;
            conflict.rollbackState = BuildFileRollbackState::Conflict;
            result.files.push_back(std::move(conflict));
            result.state = BuildFileRollbackState::Conflict;
            return result;
        }
        State::Reference& reference = requireReference(session, changeMatch->fileRef);
        if (changeMatch->created)
        {
            std::error_code removeError;
            if (!std::filesystem::remove(changeMatch->path, removeError) || removeError)
            {
                throw BuildFileWorkspaceError("permission-denied", "Created file could not be removed during rollback.");
            }
            reference.read = false;
            reference.readHash.clear();
            if (changeMatch->managedOverride.has_value())
            {
                state_->managedOverrides.cleanupAfterRollback(
                    session.projectDirectory,
                    *changeMatch->managedOverride,
                    changeMatch->registeredManagedMod,
                    operationId);
            }
        }
        else
        {
            const std::vector<char> checkpoint = readBytes(changeMatch->checkpointPath);
            AtomicFileStore().writeTextFile(
                changeMatch->path,
                std::string(checkpoint.begin(), checkpoint.end()),
                AtomicFileWriteOptions{L"AI build file rollback", ProjectStateValidation::None, {}, true});
            reference.readHash = changeMatch->beforeHash;
        }
        BuildFileChange rolledBack = changeMatch->change;
        rolledBack.status = BuildFileChangeStatus::RolledBack;
        rolledBack.rollbackState = BuildFileRollbackState::RolledBack;
        result.files.push_back(std::move(rolledBack));
        result.state = BuildFileRollbackState::RolledBack;
        return result;
    }

    BuildFileRollbackResult BuildFileWorkspaceService::rollbackRun(
        std::wstring_view chatId,
        std::wstring_view runId,
        std::wstring_view operationId)
    {
        std::scoped_lock lock(state_->mutex);
        State::Session& session = requireSession(*state_, chatId);
        const auto runMatch = session.runs.find(std::wstring(runId));
        if (runMatch == session.runs.end())
        {
            throw BuildFileWorkspaceError("validation-failed", "Change run was not found.");
        }
        State::Run& run = runMatch->second;
        BuildFileRollbackResult result;
        result.operationId = std::wstring(operationId);
        result.runId = std::wstring(runId);
        for (const auto& change : run.changes)
        {
            if (sha256(readBytes(change.path)) != change.afterHash)
            {
                BuildFileChange conflict = change.change;
                conflict.status = BuildFileChangeStatus::Conflict;
                conflict.rollbackState = BuildFileRollbackState::Conflict;
                result.files.push_back(std::move(conflict));
                result.state = BuildFileRollbackState::Conflict;
                run.rollbackState = BuildFileRollbackState::Conflict;
                return result;
            }
        }
        for (auto iterator = run.changes.rbegin(); iterator != run.changes.rend(); ++iterator)
        {
            State::Reference& reference = requireReference(session, iterator->fileRef);
            if (iterator->created)
            {
                std::error_code removeError;
                if (!std::filesystem::remove(iterator->path, removeError) || removeError)
                {
                    throw BuildFileWorkspaceError("permission-denied", "Created file could not be removed during rollback.");
                }
                reference.read = false;
                reference.readHash.clear();
                if (iterator->managedOverride.has_value())
                {
                    state_->managedOverrides.cleanupAfterRollback(
                        session.projectDirectory,
                        *iterator->managedOverride,
                        iterator->registeredManagedMod,
                        operationId);
                }
            }
            else
            {
                const std::vector<char> checkpoint = readBytes(iterator->checkpointPath);
                AtomicFileStore().writeTextFile(
                    iterator->path,
                    std::string(checkpoint.begin(), checkpoint.end()),
                    AtomicFileWriteOptions{L"AI build file rollback", ProjectStateValidation::None, {}, true});
                reference.readHash = iterator->beforeHash;
            }
            BuildFileChange rolledBack = iterator->change;
            rolledBack.status = BuildFileChangeStatus::RolledBack;
            rolledBack.rollbackState = BuildFileRollbackState::RolledBack;
            result.files.push_back(std::move(rolledBack));
        }
        run.rollbackState = BuildFileRollbackState::RolledBack;
        result.state = BuildFileRollbackState::RolledBack;
        state_->logger.writeOperation(
            LogLevel::Info,
            "AiBuildFiles",
            "Rolled back AI file batch files=" + std::to_string(result.files.size()) +
                " operationId=" + narrowAscii(operationId));
        return result;
    }

    bool BuildFileWorkspaceService::isInitialized() const noexcept
    {
        return state_->initialized;
    }
}
