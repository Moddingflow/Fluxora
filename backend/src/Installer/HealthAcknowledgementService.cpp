#include "FluxoraInstaller/HealthAcknowledgementService.hpp"

#include "FluxoraCore/Support/JsonReader.hpp"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cwctype>
#include <fstream>
#include <limits>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

namespace
{
    constexpr std::uintmax_t MaximumAcknowledgementBytes = 4096;
    constexpr std::uint64_t ProcessStartToleranceTicks = 10ULL * 10'000ULL;

    std::filesystem::path defaultAppDataRoot()
    {
        const DWORD required = GetEnvironmentVariableW(L"APPDATA", nullptr, 0);
        if (required == 0)
        {
            throw std::runtime_error("Application data directory is unavailable.");
        }
        std::wstring value(static_cast<std::size_t>(required), L'\0');
        const DWORD actual = GetEnvironmentVariableW(
            L"APPDATA",
            value.data(),
            required);
        if (actual == 0 || actual >= required)
        {
            throw std::runtime_error("Application data directory is unavailable.");
        }
        value.resize(actual);
        return value;
    }

    bool pathEquals(
        const std::filesystem::path& left,
        const std::filesystem::path& right)
    {
        const auto comparisonValue = [](const std::filesystem::path& path) {
            std::wstring value =
                std::filesystem::absolute(path).lexically_normal().wstring();
            constexpr std::wstring_view extendedUncPrefix = LR"(\\?\UNC\)";
            constexpr std::wstring_view extendedPrefix = LR"(\\?\)";
            if (value.starts_with(extendedUncPrefix))
            {
                value = LR"(\\)" + value.substr(extendedUncPrefix.size());
            }
            else if (value.starts_with(extendedPrefix))
            {
                value.erase(0, extendedPrefix.size());
            }
            while (!value.empty() && (value.back() == L'\\' || value.back() == L'/'))
            {
                value.pop_back();
            }
            return value;
        };
        const std::wstring leftValue = comparisonValue(left);
        const std::wstring rightValue = comparisonValue(right);
        return CompareStringOrdinal(
            leftValue.c_str(),
            static_cast<int>(leftValue.size()),
            rightValue.c_str(),
            static_cast<int>(rightValue.size()),
            TRUE) == CSTR_EQUAL;
    }

    void rejectReparseAncestors(const std::filesystem::path& input)
    {
        std::filesystem::path current = std::filesystem::absolute(input).lexically_normal();
        for (;;)
        {
            const DWORD attributes = GetFileAttributesW(current.c_str());
            if (attributes != INVALID_FILE_ATTRIBUTES)
            {
                if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                {
                    throw std::invalid_argument(
                        "Update health path cannot traverse a reparse point.");
                }
            }
            else
            {
                const DWORD error = GetLastError();
                if (error != ERROR_FILE_NOT_FOUND && error != ERROR_PATH_NOT_FOUND)
                {
                    throw std::invalid_argument("Update health path could not be inspected.");
                }
            }
            const std::filesystem::path parent = current.parent_path();
            if (parent.empty() || pathEquals(parent, current))
            {
                return;
            }
            current = parent;
        }
    }

    std::wstring readUtf8(const std::filesystem::path& path)
    {
        const DWORD attributes = GetFileAttributesW(path.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES ||
            (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0 ||
            (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        {
            throw std::invalid_argument("Update health acknowledgement file is invalid.");
        }
        std::error_code sizeError;
        const std::uintmax_t size = std::filesystem::file_size(path, sizeError);
        if (sizeError || size == 0 || size > MaximumAcknowledgementBytes)
        {
            throw std::invalid_argument("Update health acknowledgement file is invalid.");
        }
        std::ifstream input(path, std::ios::binary);
        std::string bytes(static_cast<std::size_t>(size), '\0');
        input.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
        if (!input)
        {
            throw std::invalid_argument("Update health acknowledgement could not be read.");
        }
        const int count = MultiByteToWideChar(
            CP_UTF8,
            MB_ERR_INVALID_CHARS,
            bytes.data(),
            static_cast<int>(bytes.size()),
            nullptr,
            0);
        if (count <= 0)
        {
            throw std::invalid_argument("Update health acknowledgement is not valid UTF-8.");
        }
        std::wstring text(static_cast<std::size_t>(count), L'\0');
        MultiByteToWideChar(
            CP_UTF8,
            MB_ERR_INVALID_CHARS,
            bytes.data(),
            static_cast<int>(bytes.size()),
            text.data(),
            count);
        return text;
    }

    std::wstring decodeJsonKey(const std::wstring& raw)
    {
        return fluxora::JsonReader::parse(L"\"" + raw + L"\"").asString();
    }

    void rejectDuplicateObjectProperties(std::wstring_view json)
    {
        std::vector<std::set<std::wstring>> objectKeys;
        std::vector<wchar_t> containers;
        bool inString = false;
        bool escaped = false;
        bool expectingObjectKey = false;
        std::wstring rawString;
        for (std::size_t index = 0; index < json.size(); ++index)
        {
            const wchar_t character = json[index];
            if (inString)
            {
                if (escaped)
                {
                    escaped = false;
                    rawString.push_back(character);
                    continue;
                }
                if (character == L'\\')
                {
                    escaped = true;
                    rawString.push_back(character);
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
                            const std::wstring key = decodeJsonKey(rawString);
                            if (objectKeys.empty() || !objectKeys.back().insert(key).second)
                            {
                                throw std::invalid_argument(
                                    "Update health acknowledgement contains a duplicate JSON property.");
                            }
                            expectingObjectKey = false;
                        }
                    }
                    continue;
                }
                rawString.push_back(character);
                continue;
            }
            if (character == L'"')
            {
                inString = true;
                escaped = false;
                rawString.clear();
            }
            else if (character == L'{')
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
            else if (character == L'}' && !containers.empty() && containers.back() == L'{')
            {
                containers.pop_back();
                objectKeys.pop_back();
                expectingObjectKey = !containers.empty() && containers.back() == L'{';
            }
            else if (character == L']' && !containers.empty() && containers.back() == L'[')
            {
                containers.pop_back();
                expectingObjectKey = !containers.empty() && containers.back() == L'{';
            }
            else if (character == L',' && !containers.empty() && containers.back() == L'{')
            {
                expectingObjectKey = true;
            }
        }
    }

    std::uint64_t parseUnsigned(const fluxora::JsonValue& value, const char* label)
    {
        if (!value.isNumber())
        {
            throw std::invalid_argument(std::string(label) + " is invalid.");
        }
        const std::wstring& wide = value.asNumber();
        if (wide.empty() || wide.find_first_not_of(L"0123456789") != std::wstring::npos)
        {
            throw std::invalid_argument(std::string(label) + " is invalid.");
        }
        std::string narrow;
        narrow.reserve(wide.size());
        for (const wchar_t character : wide)
        {
            narrow.push_back(static_cast<char>(character));
        }
        std::uint64_t result = 0;
        const auto [end, error] = std::from_chars(
            narrow.data(),
            narrow.data() + narrow.size(),
            result);
        if (error != std::errc{} || end != narrow.data() + narrow.size())
        {
            throw std::invalid_argument(std::string(label) + " is invalid.");
        }
        return result;
    }

    std::uint64_t parseUtcFileTime(std::wstring_view value)
    {
        if (value.size() < 20 || value[4] != L'-' || value[7] != L'-' ||
            value[10] != L'T' || value[13] != L':' || value[16] != L':')
        {
            throw std::invalid_argument("Acknowledgement process start time is invalid.");
        }
        const auto part = [&](std::size_t offset, std::size_t length) -> WORD {
            unsigned result = 0;
            for (std::size_t index = 0; index < length; ++index)
            {
                const wchar_t character = value[offset + index];
                if (character < L'0' || character > L'9')
                {
                    throw std::invalid_argument(
                        "Acknowledgement process start time is invalid.");
                }
                result = result * 10 + static_cast<unsigned>(character - L'0');
            }
            return static_cast<WORD>(result);
        };
        SYSTEMTIME system{};
        system.wYear = part(0, 4);
        system.wMonth = part(5, 2);
        system.wDay = part(8, 2);
        system.wHour = part(11, 2);
        system.wMinute = part(14, 2);
        system.wSecond = part(17, 2);
        std::size_t position = 19;
        std::uint64_t fraction = 0;
        std::size_t fractionDigits = 0;
        if (position < value.size() && value[position] == L'.')
        {
            ++position;
            while (position < value.size() &&
                   value[position] >= L'0' && value[position] <= L'9')
            {
                if (fractionDigits < 7)
                {
                    fraction = fraction * 10 +
                        static_cast<std::uint64_t>(value[position] - L'0');
                }
                ++fractionDigits;
                ++position;
            }
            if (fractionDigits == 0)
            {
                throw std::invalid_argument(
                    "Acknowledgement process start time is invalid.");
            }
            while (fractionDigits < 7)
            {
                fraction *= 10;
                ++fractionDigits;
            }
        }
        if (value.substr(position) != L"Z" && value.substr(position) != L"+00:00")
        {
            throw std::invalid_argument(
                "Acknowledgement process start time must be UTC.");
        }
        FILETIME fileTime{};
        if (!SystemTimeToFileTime(&system, &fileTime))
        {
            throw std::invalid_argument("Acknowledgement process start time is invalid.");
        }
        ULARGE_INTEGER ticks{};
        ticks.LowPart = fileTime.dwLowDateTime;
        ticks.HighPart = fileTime.dwHighDateTime;
        return ticks.QuadPart + fraction;
    }

    const fluxora::JsonValue& property(
        const fluxora::JsonValue::Object& object,
        std::wstring_view name)
    {
        const auto found = object.find(std::wstring(name));
        if (found == object.end())
        {
            throw std::invalid_argument(
                "Update health acknowledgement is missing a required property.");
        }
        return found->second;
    }

    std::string utf8(std::wstring_view value)
    {
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
            throw std::invalid_argument(
                "Update health acknowledgement contains invalid Unicode.");
        }
        std::string result(static_cast<std::size_t>(length), '\0');
        WideCharToMultiByte(
            CP_UTF8,
            WC_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            result.data(),
            length,
            nullptr,
            nullptr);
        return result;
    }

    void validateAcknowledgement(
        const std::filesystem::path& path,
        const fluxora::installer::UpdateWorkflowRequest& request,
        const fluxora::installer::ILaunchedApplicationIdentity& application)
    {
        const std::wstring text = readUtf8(path);
        rejectDuplicateObjectProperties(text);
        const fluxora::JsonValue root = fluxora::JsonReader::parse(text);
        if (!root.isObject())
        {
            throw std::invalid_argument(
                "Update health acknowledgement root must be an object.");
        }
        const fluxora::JsonValue::Object& object = root.asObject();
        const std::set<std::wstring> expected{
            L"schemaVersion",
            L"operationId",
            L"nonce",
            L"appVersion",
            L"pid",
            L"processStartTimeUtc"};
        if (object.size() != expected.size())
        {
            throw std::invalid_argument(
                "Update health acknowledgement contains unknown or missing fields.");
        }
        for (const auto& [name, value] : object)
        {
            (void)value;
            if (!expected.contains(name))
            {
                throw std::invalid_argument(
                    "Update health acknowledgement contains an unknown field.");
            }
        }
        const fluxora::JsonValue& nonce = property(object, L"nonce");
        const fluxora::JsonValue& operationId =
            property(object, L"operationId");
        const fluxora::JsonValue& version = property(object, L"appVersion");
        const fluxora::JsonValue& start = property(object, L"processStartTimeUtc");
        if (!operationId.isString() || !nonce.isString() ||
            !version.isString() || !start.isString())
        {
            throw std::invalid_argument(
                "Update health acknowledgement contains an invalid field type.");
        }
        const std::uint64_t pid = parseUnsigned(property(object, L"pid"), "pid");
        const std::uint64_t schema =
            parseUnsigned(property(object, L"schemaVersion"), "schemaVersion");
        const std::uint64_t acknowledgementStart = parseUtcFileTime(start.asString());
        const std::uint64_t observedStart = application.startFileTime();
        const std::uint64_t difference = acknowledgementStart > observedStart
            ? acknowledgementStart - observedStart
            : observedStart - acknowledgementStart;
        if (schema != 1 ||
            utf8(operationId.asString()) != request.operationId ||
            utf8(nonce.asString()) != request.handoffNonce ||
            utf8(version.asString()) != request.targetVersion ||
            pid != application.processId() ||
            difference > ProcessStartToleranceTicks ||
            application.hasExited() ||
            !pathEquals(application.executablePath(), request.applicationPath()))
        {
            throw std::invalid_argument(
                "Update health acknowledgement does not match the launched Fluxora process.");
        }
    }
}

namespace fluxora::installer
{
    HealthAcknowledgementService::HealthAcknowledgementService(
        std::filesystem::path appDataRoot,
        std::chrono::milliseconds pollInterval)
        : appDataRoot_(appDataRoot.empty() ? defaultAppDataRoot() : std::move(appDataRoot)),
          pollInterval_(pollInterval)
    {
        if (!appDataRoot_.is_absolute())
        {
            throw std::invalid_argument("Application data directory must be absolute.");
        }
        if (pollInterval_ <= std::chrono::milliseconds::zero() ||
            pollInterval_ > std::chrono::seconds(1))
        {
            throw std::invalid_argument("Health acknowledgement poll interval is invalid.");
        }
    }

    void HealthAcknowledgementService::prepare(
        const UpdateWorkflowRequest& request) const
    {
        const std::filesystem::path directory = healthDirectory();
        rejectReparseAncestors(directory);
        std::error_code error;
        std::filesystem::create_directories(directory, error);
        if (error)
        {
            throw std::runtime_error(
                "Update health acknowledgement directory could not be created.");
        }
        rejectReparseAncestors(directory);
        if (std::filesystem::exists(acknowledgementPath(request)))
        {
            throw std::invalid_argument(
                "Update health acknowledgement nonce was already used.");
        }
    }

    void HealthAcknowledgementService::wait(
        const UpdateWorkflowRequest& request,
        const ILaunchedApplicationIdentity& application,
        std::chrono::milliseconds timeout) const
    {
        if (timeout <= std::chrono::milliseconds::zero() ||
            timeout > std::chrono::seconds(30))
        {
            throw std::invalid_argument(
                "Health acknowledgement timeout must be between 1 millisecond and 30 seconds.");
        }
        const std::filesystem::path path = acknowledgementPath(request);
        const auto deadline = std::chrono::steady_clock::now() + timeout;
        while (std::chrono::steady_clock::now() < deadline)
        {
            if (std::filesystem::exists(path))
            {
                validateAcknowledgement(path, request, application);
                return;
            }
            if (application.hasExited())
            {
                throw std::runtime_error(
                    "Updated Fluxora exited before reporting renderer and BridgeHost readiness.");
            }
            const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
                deadline - std::chrono::steady_clock::now());
            std::this_thread::sleep_for(std::min(pollInterval_, remaining));
        }
        throw std::runtime_error(
            "Updated Fluxora did not pass its health handshake within 30 seconds.");
    }

    void HealthAcknowledgementService::cleanup(
        const UpdateWorkflowRequest& request) const noexcept
    {
        try
        {
            const std::filesystem::path path = acknowledgementPath(request);
            const DWORD attributes = GetFileAttributesW(path.c_str());
            if (attributes == INVALID_FILE_ATTRIBUTES ||
                (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
            {
                return;
            }
            std::error_code error;
            std::filesystem::remove(path, error);
        }
        catch (...)
        {
        }
    }

    std::filesystem::path HealthAcknowledgementService::acknowledgementPath(
        const UpdateWorkflowRequest& request) const
    {
        if (!isLowerHexSha256(request.handoffNonce))
        {
            throw std::invalid_argument("Update health handoff nonce is invalid.");
        }
        return healthDirectory() / (std::wstring(
            request.handoffNonce.begin(),
            request.handoffNonce.end()) + L".ack");
    }

    std::filesystem::path HealthAcknowledgementService::healthDirectory() const
    {
        return std::filesystem::absolute(appDataRoot_).lexically_normal() /
            L"Fluxora" / L"updates" / L"health";
    }
}
