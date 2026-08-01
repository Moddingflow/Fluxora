#include "FluxoraInstaller/UpdateWorkflowRequest.hpp"

#include "FluxoraCore/Support/JsonReader.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cwctype>
#include <fstream>
#include <limits>
#include <set>
#include <sstream>
#include <stdexcept>
#include <system_error>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

namespace
{
    constexpr std::uintmax_t MaximumRequestBytes = 1024ULL * 1024ULL;
    constexpr std::size_t MaximumJsonDepth = 16;

    std::wstring readUtf8File(const std::filesystem::path& path)
    {
        std::error_code sizeError;
        const std::uintmax_t size = std::filesystem::file_size(path, sizeError);
        if (sizeError || size == 0 || size > MaximumRequestBytes)
        {
            throw std::invalid_argument("Update request file is missing, empty or too large.");
        }

        std::ifstream input(path, std::ios::binary);
        if (!input)
        {
            throw std::invalid_argument("Update request file could not be opened.");
        }
        std::string bytes(static_cast<std::size_t>(size), '\0');
        input.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
        if (!input || input.peek() != std::char_traits<char>::eof())
        {
            throw std::invalid_argument("Update request file could not be read exactly.");
        }
        if (bytes.size() >= 3 &&
            static_cast<unsigned char>(bytes[0]) == 0xEF &&
            static_cast<unsigned char>(bytes[1]) == 0xBB &&
            static_cast<unsigned char>(bytes[2]) == 0xBF)
        {
            throw std::invalid_argument("Update request must be UTF-8 without a byte-order mark.");
        }

        if (bytes.empty())
        {
            throw std::invalid_argument("Update request file is empty.");
        }
        const int length = MultiByteToWideChar(
            CP_UTF8,
            MB_ERR_INVALID_CHARS,
            bytes.data(),
            static_cast<int>(bytes.size()),
            nullptr,
            0);
        if (length <= 0)
        {
            throw std::invalid_argument("Update request is not valid UTF-8.");
        }
        std::wstring text(static_cast<std::size_t>(length), L'\0');
        if (MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                bytes.data(),
                static_cast<int>(bytes.size()),
                text.data(),
                length) != length)
        {
            throw std::invalid_argument("Update request is not valid UTF-8.");
        }
        return text;
    }

    std::string toUtf8(std::wstring_view value)
    {
        if (value.empty())
        {
            return {};
        }
        const int length = WideCharToMultiByte(
            CP_UTF8,
            WC_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0,
            nullptr,
            nullptr);
        if (length <= 0)
        {
            throw std::invalid_argument("Update request contains invalid Unicode.");
        }
        std::string text(static_cast<std::size_t>(length), '\0');
        if (WideCharToMultiByte(
                CP_UTF8,
                WC_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                text.data(),
                length,
                nullptr,
                nullptr) != length)
        {
            throw std::invalid_argument("Update request contains invalid Unicode.");
        }
        return text;
    }

    std::wstring jsonEscape(std::wstring_view value)
    {
        std::wstring result;
        result.reserve(value.size() + 8);
        constexpr wchar_t Digits[] = L"0123456789abcdef";
        for (const wchar_t character : value)
        {
            switch (character)
            {
            case L'"':
                result += L"\\\"";
                break;
            case L'\\':
                result += L"\\\\";
                break;
            case L'\b':
                result += L"\\b";
                break;
            case L'\f':
                result += L"\\f";
                break;
            case L'\n':
                result += L"\\n";
                break;
            case L'\r':
                result += L"\\r";
                break;
            case L'\t':
                result += L"\\t";
                break;
            default:
                if (character < 0x20)
                {
                    result += L"\\u";
                    result.push_back(Digits[(character >> 12) & 0x0F]);
                    result.push_back(Digits[(character >> 8) & 0x0F]);
                    result.push_back(Digits[(character >> 4) & 0x0F]);
                    result.push_back(Digits[character & 0x0F]);
                }
                else
                {
                    result.push_back(character);
                }
                break;
            }
        }
        return result;
    }

    std::filesystem::path canonicalAbsolutePath(
        const std::filesystem::path& value,
        std::string_view label)
    {
        if (value.empty() || !value.is_absolute())
        {
            throw std::invalid_argument(std::string(label) + " must be an absolute path.");
        }
        const std::wstring raw = value.wstring();
        if (raw.find(L'\0') != std::wstring::npos)
        {
            throw std::invalid_argument(std::string(label) + " contains an embedded NUL.");
        }

        const DWORD required = GetFullPathNameW(raw.c_str(), 0, nullptr, nullptr);
        if (required == 0)
        {
            throw std::invalid_argument(std::string(label) + " could not be normalized.");
        }
        std::wstring buffer(static_cast<std::size_t>(required), L'\0');
        const DWORD actual = GetFullPathNameW(
            raw.c_str(),
            required,
            buffer.data(),
            nullptr);
        if (actual == 0 || actual >= required)
        {
            throw std::invalid_argument(std::string(label) + " could not be normalized.");
        }
        buffer.resize(actual);
        while (buffer.size() > 3 && (buffer.back() == L'\\' || buffer.back() == L'/'))
        {
            buffer.pop_back();
        }
        return std::filesystem::path(buffer).lexically_normal();
    }

    bool pathEquals(
        const std::filesystem::path& left,
        const std::filesystem::path& right)
    {
        const std::wstring leftValue = canonicalAbsolutePath(left, "path").wstring();
        const std::wstring rightValue = canonicalAbsolutePath(right, "path").wstring();
        return CompareStringOrdinal(
            leftValue.c_str(),
            static_cast<int>(leftValue.size()),
            rightValue.c_str(),
            static_cast<int>(rightValue.size()),
            TRUE) == CSTR_EQUAL;
    }

    bool isWithin(
        const std::filesystem::path& candidate,
        const std::filesystem::path& root)
    {
        const std::wstring candidateValue = canonicalAbsolutePath(candidate, "candidate path").wstring();
        std::wstring rootValue = canonicalAbsolutePath(root, "root path").wstring();
        if (CompareStringOrdinal(
                candidateValue.c_str(),
                static_cast<int>(candidateValue.size()),
                rootValue.c_str(),
                static_cast<int>(rootValue.size()),
                TRUE) == CSTR_EQUAL)
        {
            return true;
        }
        rootValue.push_back(L'\\');
        return candidateValue.size() > rootValue.size() &&
            CompareStringOrdinal(
                candidateValue.c_str(),
                static_cast<int>(rootValue.size()),
                rootValue.c_str(),
                static_cast<int>(rootValue.size()),
                TRUE) == CSTR_EQUAL;
    }

    void rejectReparseAncestors(const std::filesystem::path& input)
    {
        std::filesystem::path current = canonicalAbsolutePath(input, "update path");
        for (;;)
        {
            const DWORD attributes = GetFileAttributesW(current.c_str());
            if (attributes != INVALID_FILE_ATTRIBUTES)
            {
                if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                {
                    throw std::invalid_argument("Update path cannot traverse a reparse point.");
                }
            }
            else
            {
                const DWORD error = GetLastError();
                if (error != ERROR_FILE_NOT_FOUND && error != ERROR_PATH_NOT_FOUND)
                {
                    throw std::invalid_argument("Update path could not be inspected.");
                }
            }

            const std::filesystem::path parent = current.parent_path();
            if (parent.empty() || pathEquals(parent, current))
            {
                break;
            }
            current = parent;
        }
    }

    void requireExistingFile(
        const std::filesystem::path& path,
        std::string_view label)
    {
        const DWORD attributes = GetFileAttributesW(path.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES ||
            (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0 ||
            (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        {
            throw std::invalid_argument(std::string(label) + " is missing or unsafe.");
        }
        rejectReparseAncestors(path);
    }

    void requireExistingDirectory(
        const std::filesystem::path& path,
        std::string_view label)
    {
        const DWORD attributes = GetFileAttributesW(path.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES ||
            (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0 ||
            (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        {
            throw std::invalid_argument(std::string(label) + " is missing or unsafe.");
        }
        rejectReparseAncestors(path);
    }

    std::filesystem::path validateRelativeApplicationPath(
        const std::filesystem::path& value)
    {
        if (value.empty() || value.is_absolute() || value.has_root_name() || value.has_root_directory())
        {
            throw std::invalid_argument("Application executable must be a safe relative path.");
        }
        const std::wstring raw = value.generic_wstring();
        if (raw.find(L':') != std::wstring::npos || raw.find(L'\0') != std::wstring::npos)
        {
            throw std::invalid_argument("Application executable must be a safe relative path.");
        }

        std::filesystem::path result;
        for (const std::filesystem::path& component : value)
        {
            const std::wstring part = component.wstring();
            if (part.empty() || part == L"." || part == L".." ||
                part.back() == L'.' || part.back() == L' ')
            {
                throw std::invalid_argument(
                    "Application executable contains an unsafe path component.");
            }
            result /= component;
        }
        if (result.empty())
        {
            throw std::invalid_argument("Application executable is required.");
        }
        return result;
    }

    const fluxora::JsonValue& requireProperty(
        const fluxora::JsonValue::Object& object,
        std::wstring_view name)
    {
        const auto found = object.find(std::wstring(name));
        if (found == object.end())
        {
            throw std::invalid_argument("Update request is missing a required field.");
        }
        return found->second;
    }

    std::wstring requireString(
        const fluxora::JsonValue::Object& object,
        std::wstring_view name)
    {
        const fluxora::JsonValue& value = requireProperty(object, name);
        if (!value.isString() || value.asString().empty())
        {
            throw std::invalid_argument("Update request string field is invalid.");
        }
        return value.asString();
    }

    std::uint64_t parseUnsignedNumber(
        const fluxora::JsonValue& value,
        std::string_view label)
    {
        if (!value.isNumber())
        {
            throw std::invalid_argument(std::string(label) + " must be an integer.");
        }
        const std::wstring& wide = value.asNumber();
        if (wide.empty() || wide.find_first_not_of(L"0123456789") != std::wstring::npos)
        {
            throw std::invalid_argument(std::string(label) + " must be an unsigned integer.");
        }
        std::string narrow;
        narrow.reserve(wide.size());
        for (const wchar_t digit : wide)
        {
            narrow.push_back(static_cast<char>(digit));
        }
        std::uint64_t parsed = 0;
        const auto [end, error] = std::from_chars(
            narrow.data(),
            narrow.data() + narrow.size(),
            parsed);
        if (error != std::errc{} || end != narrow.data() + narrow.size())
        {
            throw std::invalid_argument(std::string(label) + " is outside the supported range.");
        }
        return parsed;
    }

    std::uint64_t requireUnsigned(
        const fluxora::JsonValue::Object& object,
        std::wstring_view name,
        std::string_view label)
    {
        return parseUnsignedNumber(requireProperty(object, name), label);
    }

    std::uint64_t utcTimestampToFileTime(std::wstring_view value)
    {
        // System.Text.Json emits DateTimeOffset as ISO-8601 with either Z or +00:00.
        if (value.size() < 20 || value[4] != L'-' || value[7] != L'-' ||
            value[10] != L'T' || value[13] != L':' || value[16] != L':')
        {
            throw std::invalid_argument("Parent process start time is invalid.");
        }
        const auto parsePart = [&](std::size_t offset, std::size_t length) -> WORD {
            unsigned valuePart = 0;
            for (std::size_t index = 0; index < length; ++index)
            {
                const wchar_t character = value[offset + index];
                if (character < L'0' || character > L'9')
                {
                    throw std::invalid_argument("Parent process start time is invalid.");
                }
                valuePart = valuePart * 10 + static_cast<unsigned>(character - L'0');
            }
            if (valuePart > std::numeric_limits<WORD>::max())
            {
                throw std::invalid_argument("Parent process start time is invalid.");
            }
            return static_cast<WORD>(valuePart);
        };

        SYSTEMTIME systemTime{};
        systemTime.wYear = parsePart(0, 4);
        systemTime.wMonth = parsePart(5, 2);
        systemTime.wDay = parsePart(8, 2);
        systemTime.wHour = parsePart(11, 2);
        systemTime.wMinute = parsePart(14, 2);
        systemTime.wSecond = parsePart(17, 2);
        std::size_t position = 19;
        std::uint32_t fractional100Nanoseconds = 0;
        if (position < value.size() && value[position] == L'.')
        {
            ++position;
            std::size_t digits = 0;
            while (position < value.size() && value[position] >= L'0' && value[position] <= L'9')
            {
                if (digits < 7)
                {
                    fractional100Nanoseconds =
                        fractional100Nanoseconds * 10 +
                        static_cast<std::uint32_t>(value[position] - L'0');
                }
                ++digits;
                ++position;
            }
            if (digits == 0)
            {
                throw std::invalid_argument("Parent process start time is invalid.");
            }
            while (digits < 7)
            {
                fractional100Nanoseconds *= 10;
                ++digits;
            }
        }
        if (value.substr(position) != L"Z" && value.substr(position) != L"+00:00")
        {
            throw std::invalid_argument("Parent process start time must be UTC.");
        }

        FILETIME fileTime{};
        if (!SystemTimeToFileTime(&systemTime, &fileTime))
        {
            throw std::invalid_argument("Parent process start time is invalid.");
        }
        ULARGE_INTEGER ticks{};
        ticks.LowPart = fileTime.dwLowDateTime;
        ticks.HighPart = fileTime.dwHighDateTime;
        return ticks.QuadPart + fractional100Nanoseconds;
    }

    void validateDepth(const fluxora::JsonValue& value, std::size_t depth)
    {
        if (depth > MaximumJsonDepth)
        {
            throw std::invalid_argument("Update request JSON is too deeply nested.");
        }
        if (value.isObject())
        {
            for (const auto& [name, child] : value.asObject())
            {
                (void)name;
                validateDepth(child, depth + 1);
            }
        }
        else if (value.isArray())
        {
            for (const fluxora::JsonValue& child : value.asArray())
            {
                validateDepth(child, depth + 1);
            }
        }
    }

    void rejectDuplicateObjectProperties(std::wstring_view json)
    {
        // The project JsonReader intentionally stores objects in a map. This small
        // scanner rejects duplicate keys before parsing so signed updater requests
        // cannot exploit first/last-property ambiguity.
        std::vector<std::set<std::wstring>> objectKeys;
        std::vector<wchar_t> containers;
        bool inString = false;
        bool escaped = false;
        bool expectingObjectKey = false;
        std::wstring currentString;
        for (std::size_t index = 0; index < json.size(); ++index)
        {
            const wchar_t character = json[index];
            if (inString)
            {
                if (escaped)
                {
                    escaped = false;
                    currentString.push_back(character);
                    continue;
                }
                if (character == L'\\')
                {
                    escaped = true;
                    currentString.push_back(character);
                    continue;
                }
                if (character == L'"')
                {
                    inString = false;
                    if (expectingObjectKey)
                    {
                        std::size_t lookahead = index + 1;
                        while (lookahead < json.size() && std::iswspace(json[lookahead]) != 0)
                        {
                            ++lookahead;
                        }
                        if (lookahead < json.size() && json[lookahead] == L':')
                        {
                            const fluxora::JsonValue decoded =
                                fluxora::JsonReader::parse(
                                    L"\"" + currentString + L"\"");
                            if (!decoded.isString() ||
                                objectKeys.empty() ||
                                !objectKeys.back().insert(decoded.asString()).second)
                            {
                                throw std::invalid_argument(
                                    "Update request contains a duplicate JSON property.");
                            }
                            expectingObjectKey = false;
                        }
                    }
                    continue;
                }
                currentString.push_back(character);
                continue;
            }
            if (character == L'"')
            {
                inString = true;
                escaped = false;
                currentString.clear();
                continue;
            }
            if (character == L'{')
            {
                containers.push_back(character);
                objectKeys.emplace_back();
                expectingObjectKey = true;
            }
            else if (character == L'[')
            {
                containers.push_back(character);
                expectingObjectKey = false;
            }
            else if (character == L'}')
            {
                if (!containers.empty() && containers.back() == L'{')
                {
                    containers.pop_back();
                    objectKeys.pop_back();
                    expectingObjectKey =
                        !containers.empty() && containers.back() == L'{';
                }
            }
            else if (character == L']')
            {
                if (!containers.empty() && containers.back() == L'[')
                {
                    containers.pop_back();
                    expectingObjectKey =
                        !containers.empty() && containers.back() == L'{';
                }
            }
            else if (character == L',' && !containers.empty() && containers.back() == L'{')
            {
                expectingObjectKey = true;
            }
        }
    }
}

namespace fluxora::installer
{
    bool isSafeOperationId(std::string_view value) noexcept
    {
        return !value.empty() && value.size() <= 128 &&
            std::all_of(value.begin(), value.end(), [](char character) {
                return (character >= 'A' && character <= 'Z') ||
                    (character >= 'a' && character <= 'z') ||
                    (character >= '0' && character <= '9') ||
                    character == '.' || character == '_' || character == '-';
            });
    }

    bool isLowerHexSha256(std::string_view value) noexcept
    {
        return value.size() == 64 &&
            std::all_of(value.begin(), value.end(), [](char character) {
                return (character >= '0' && character <= '9') ||
                    (character >= 'a' && character <= 'f');
            });
    }

    bool isThreePartSemanticVersion(std::string_view value) noexcept
    {
        std::size_t position = 0;
        for (int component = 0; component < 3; ++component)
        {
            const std::size_t start = position;
            while (position < value.size() && value[position] >= '0' && value[position] <= '9')
            {
                ++position;
            }
            if (position == start || (position - start > 1 && value[start] == '0'))
            {
                return false;
            }
            if (component < 2)
            {
                if (position >= value.size() || value[position] != '.')
                {
                    return false;
                }
                ++position;
            }
        }
        return position == value.size();
    }

    std::filesystem::path UpdateWorkflowRequest::applicationPath() const
    {
        const std::filesystem::path relative =
            validateRelativeApplicationPath(applicationExecutable);
        const std::filesystem::path resolved =
            canonicalAbsolutePath(installDirectory / relative, "application path");
        if (!isWithin(resolved, installDirectory))
        {
            throw std::invalid_argument(
                "Application executable escapes the installation directory.");
        }
        return resolved;
    }

    UpdateRequest UpdateWorkflowRequest::nativeUpdateRequest() const
    {
        UpdateRequest request;
        request.manifestPath = manifestPath;
        request.signaturePath = signaturePath;
        request.packagePath = packagePath;
        request.installDirectory = installDirectory;
        request.currentVersion = currentVersion;
        request.targetVersion = targetVersion;
        request.target = target;
        request.assetKind = assetKind;
        if (!fromVersion.empty())
        {
            request.fromVersion = fromVersion;
        }
        request.expectedPackageSha256 = packageSha256;
        request.expectedPackageSize = packageSize;
        request.applicationExecutable = applicationExecutable.wstring();
        return request;
    }

    UpdateWorkflowRequest UpdateWorkflowRequestLoader::loadAndValidate(
        const std::filesystem::path& requestPath,
        const std::filesystem::path& updaterExecutablePath,
        bool recoveryInvocation)
    {
        const std::filesystem::path canonicalRequest =
            canonicalAbsolutePath(requestPath, "request path");
        requireExistingFile(canonicalRequest, "Update request");
        const std::wstring text = readUtf8File(canonicalRequest);
        rejectDuplicateObjectProperties(text);
        const JsonValue root = JsonReader::parse(text);
        validateDepth(root, 1);
        if (!root.isObject())
        {
            throw std::invalid_argument("Update request root must be an object.");
        }
        const JsonValue::Object& object = root.asObject();
        const std::set<std::wstring> allowed{
            L"schemaVersion",
            L"operationId",
            L"handoffNonce",
            L"parentPid",
            L"parentStartTimeUtc",
            L"installDirectory",
            L"updaterWorkingDirectory",
            L"packagePath",
            L"manifestPath",
            L"signaturePath",
            L"currentVersion",
            L"targetVersion",
            L"target",
            L"assetKind",
            L"fromVersion",
            L"packageSha256",
            L"packageSize",
            L"applicationExecutable",
            L"workingDirectory"};
        for (const auto& [name, value] : object)
        {
            (void)value;
            if (!allowed.contains(name))
            {
                throw std::invalid_argument("Update request contains an unknown field.");
            }
        }

        if (requireUnsigned(object, L"schemaVersion", "schemaVersion") != 1)
        {
            throw std::invalid_argument("Update request schema version is unsupported.");
        }
        UpdateWorkflowRequest request;
        request.requestPath = canonicalRequest;
        request.recoveryInvocation = recoveryInvocation;
        request.operationId = toUtf8(requireString(object, L"operationId"));
        request.handoffNonce = toUtf8(requireString(object, L"handoffNonce"));
        const std::uint64_t parentPid = requireUnsigned(object, L"parentPid", "parentPid");
        if (parentPid == 0 || parentPid > std::numeric_limits<std::uint32_t>::max())
        {
            throw std::invalid_argument("Parent process identifier is invalid.");
        }
        request.parentPid = static_cast<std::uint32_t>(parentPid);
        request.parentStartFileTime =
            utcTimestampToFileTime(requireString(object, L"parentStartTimeUtc"));
        request.installDirectory = requireString(object, L"installDirectory");
        request.updaterWorkingDirectory = requireString(object, L"updaterWorkingDirectory");
        request.packagePath = requireString(object, L"packagePath");
        request.manifestPath = requireString(object, L"manifestPath");
        request.signaturePath = requireString(object, L"signaturePath");
        request.currentVersion = toUtf8(requireString(object, L"currentVersion"));
        request.targetVersion = toUtf8(requireString(object, L"targetVersion"));
        request.target = toUtf8(requireString(object, L"target"));
        const std::string assetKind = toUtf8(requireString(object, L"assetKind"));
        if (assetKind == "full")
        {
            request.assetKind = UpdateAssetKind::Full;
        }
        else if (assetKind == "delta")
        {
            request.assetKind = UpdateAssetKind::Delta;
        }
        else
        {
            throw std::invalid_argument("Update request asset kind is invalid.");
        }
        if (const auto fromVersion = object.find(L"fromVersion"); fromVersion != object.end())
        {
            if (!fromVersion->second.isNull())
            {
                if (!fromVersion->second.isString())
                {
                    throw std::invalid_argument("Update request fromVersion is invalid.");
                }
                request.fromVersion = toUtf8(fromVersion->second.asString());
            }
        }
        request.packageSha256 = toUtf8(requireString(object, L"packageSha256"));
        request.packageSize = requireUnsigned(object, L"packageSize", "packageSize");
        request.applicationExecutable = requireString(object, L"applicationExecutable");
        request.workingDirectory = requireString(object, L"workingDirectory");

        validate(request, updaterExecutablePath);
        return request;
    }

    void UpdateWorkflowRequestLoader::validate(
        const UpdateWorkflowRequest& request,
        const std::filesystem::path& updaterExecutablePath)
    {
        if (!isSafeOperationId(request.operationId) ||
            !isLowerHexSha256(request.handoffNonce) ||
            request.parentPid == 0 ||
            request.parentStartFileTime == 0)
        {
            throw std::invalid_argument(
                "Update request identity or parent process metadata is invalid.");
        }
        if (!isThreePartSemanticVersion(request.currentVersion) ||
            !isThreePartSemanticVersion(request.targetVersion) ||
            request.target != "win-x64" ||
            !isLowerHexSha256(request.packageSha256) ||
            request.packageSize == 0)
        {
            throw std::invalid_argument(
                "Update request version, target or package metadata is invalid.");
        }
        if (request.assetKind == UpdateAssetKind::Full)
        {
            if (!request.fromVersion.empty())
            {
                throw std::invalid_argument("Full update request cannot specify fromVersion.");
            }
        }
        else if (request.fromVersion != request.currentVersion ||
                 !isThreePartSemanticVersion(request.fromVersion))
        {
            throw std::invalid_argument("Delta update request base version is invalid.");
        }

        const std::filesystem::path install =
            canonicalAbsolutePath(request.installDirectory, "installDirectory");
        const std::filesystem::path runtime =
            canonicalAbsolutePath(request.updaterWorkingDirectory, "updaterWorkingDirectory");
        const std::filesystem::path package =
            canonicalAbsolutePath(request.packagePath, "packagePath");
        const std::filesystem::path manifest =
            canonicalAbsolutePath(request.manifestPath, "manifestPath");
        const std::filesystem::path signature =
            canonicalAbsolutePath(request.signaturePath, "signaturePath");
        const std::filesystem::path working =
            canonicalAbsolutePath(request.workingDirectory, "workingDirectory");
        const std::filesystem::path updater =
            canonicalAbsolutePath(updaterExecutablePath, "updater executable");
        const std::filesystem::path requestPath =
            canonicalAbsolutePath(request.requestPath, "request path");

        requireExistingDirectory(runtime, "Updater working directory");
        if (!pathEquals(install, working) ||
            isWithin(runtime, install) ||
            isWithin(updater, install) ||
            !isWithin(updater, runtime) ||
            !isWithin(requestPath, runtime) ||
            !isWithin(package, runtime) ||
            !isWithin(manifest, runtime) ||
            !isWithin(signature, runtime))
        {
            throw std::invalid_argument(
                "Updater runtime and artifact paths are outside their allowed scope.");
        }
        requireExistingFile(updater, "Updater executable");
        requireExistingFile(requestPath, "Update request");
        if (!request.recoveryInvocation)
        {
            requireExistingFile(package, "Update package");
            requireExistingFile(manifest, "Update manifest");
            requireExistingFile(signature, "Update signature");
        }
        rejectReparseAncestors(install);

        const std::filesystem::path application = request.applicationPath();
        if (!isWithin(application, install))
        {
            throw std::invalid_argument(
                "Application executable escapes the installation directory.");
        }
    }

    std::wstring UpdateWorkflowRequestLoader::sanitizedSummaryJson(
        const UpdateWorkflowRequest& request)
    {
        const std::wstring operationId(
            request.operationId.begin(),
            request.operationId.end());
        const std::wstring currentVersion(
            request.currentVersion.begin(),
            request.currentVersion.end());
        const std::wstring targetVersion(
            request.targetVersion.begin(),
            request.targetVersion.end());
        std::wostringstream json;
        json << L"{\"schemaVersion\":1"
             << L",\"operationId\":\"" << jsonEscape(operationId) << L"\""
             << L",\"currentVersion\":\"" << jsonEscape(currentVersion) << L"\""
             << L",\"targetVersion\":\"" << jsonEscape(targetVersion) << L"\""
             << L",\"assetKind\":\""
             << (request.assetKind == UpdateAssetKind::Full ? L"full" : L"delta")
             << L"\"}";
        return json.str();
    }
}
