#include "FluxoraCore/Services/ModUpdateService.hpp"

#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/NexusModsAuthService.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"

#include <algorithm>
#include <chrono>
#include <ctime>
#include <cwctype>
#include <iomanip>
#include <initializer_list>
#include <map>
#include <memory>
#include <limits>
#include <optional>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <winhttp.h>
#endif

namespace fluxora
{
    namespace
    {
        struct HttpResponse
        {
            unsigned long statusCode{0};
            std::string body;
            std::map<std::wstring, std::wstring> headers;
        };

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

        std::wstring lower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        std::wstring nowUtcText()
        {
            const std::time_t current = std::chrono::system_clock::to_time_t(
                std::chrono::system_clock::now());
            std::tm utc{};
#ifdef _WIN32
            gmtime_s(&utc, &current);
#else
            gmtime_r(&current, &utc);
#endif
            std::wostringstream stream;
            stream << std::put_time(&utc, L"%Y-%m-%dT%H:%M:%SZ");
            return stream.str();
        }

        std::wstring formatUtc(std::time_t value)
        {
            std::tm utc{};
#ifdef _WIN32
            gmtime_s(&utc, &value);
#else
            gmtime_r(&value, &utc);
#endif
            std::wostringstream stream;
            stream << std::put_time(&utc, L"%Y-%m-%dT%H:%M:%SZ");
            return stream.str();
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
                throw NexusUpdateApiError(
                    NexusUpdateApiErrorKind::InvalidResponse,
                    "Nexus returned invalid UTF-8 JSON.");
            }
            std::wstring result(static_cast<std::size_t>(size), L'\0');
            MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                result.data(),
                size);
            return result;
#else
            return std::wstring(value.begin(), value.end());
#endif
        }

        std::wstring percentEncode(std::wstring_view value)
        {
#ifdef _WIN32
            const int size = WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0,
                nullptr,
                nullptr);
            std::string utf8(static_cast<std::size_t>((std::max)(0, size)), '\0');
            if (size > 0)
            {
                WideCharToMultiByte(
                    CP_UTF8,
                    0,
                    value.data(),
                    static_cast<int>(value.size()),
                    utf8.data(),
                    size,
                    nullptr,
                    nullptr);
            }
#else
            const std::string utf8(value.begin(), value.end());
#endif
            std::wostringstream stream;
            stream << std::uppercase << std::hex;
            for (const unsigned char character : utf8)
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

        long long parseInteger(std::wstring_view value, long long fallback = -1)
        {
            try
            {
                const std::wstring normalized = trim(std::wstring(value));
                std::size_t consumed = 0;
                const long long parsed = std::stoll(normalized, &consumed);
                return consumed == normalized.size() ? parsed : fallback;
            }
            catch (const std::exception&)
            {
                return fallback;
            }
        }

        std::wstring stringValue(const JsonValue& object, std::wstring_view key)
        {
            const JsonValue* value = object.find(key);
            if (value == nullptr)
            {
                return {};
            }
            if (value->isString())
            {
                return value->asString();
            }
            return value->isNumber() ? value->asNumber() : std::wstring{};
        }

        long long integerValue(const JsonValue& object, std::wstring_view key, long long fallback = 0)
        {
            const JsonValue* value = object.find(key);
            if (value == nullptr)
            {
                return fallback;
            }
            if (value->isNumber())
            {
                return parseInteger(value->asNumber(), fallback);
            }
            if (value->isString())
            {
                return parseInteger(value->asString(), fallback);
            }
            return fallback;
        }

        std::optional<bool> booleanValue(const JsonValue& object, std::wstring_view key)
        {
            const JsonValue* value = object.find(key);
            if (value == nullptr || value->isNull())
            {
                return std::nullopt;
            }
            if (value->type() == JsonValue::Type::Boolean)
            {
                return value->asBoolean();
            }
            if (value->isNumber())
            {
                return parseInteger(value->asNumber(), 0) != 0;
            }
            return std::nullopt;
        }

        std::optional<std::wstring> headerValue(
            const std::map<std::wstring, std::wstring>& headers,
            std::initializer_list<std::wstring_view> names)
        {
            for (const std::wstring_view name : names)
            {
                const std::wstring wanted = lower(std::wstring(name));
                for (const auto& [headerName, value] : headers)
                {
                    if (lower(headerName) == wanted)
                    {
                        return value;
                    }
                }
            }
            return std::nullopt;
        }

        std::wstring normalizeReset(std::wstring_view value)
        {
            const std::wstring normalized = trim(std::wstring(value));
            const long long epoch = parseInteger(normalized, -1);
            if (epoch > 1'000'000'000)
            {
                return formatUtc(static_cast<std::time_t>(epoch));
            }
            return normalized.size() == 20 && normalized.back() == L'Z' ? normalized : std::wstring{};
        }

        NexusQuotaSnapshot quotaFromHeaders(const std::map<std::wstring, std::wstring>& headers)
        {
            NexusQuotaSnapshot quota;
            const auto hourlyLimit = headerValue(headers, {L"X-RL-Hourly-Limit"});
            const auto hourlyRemaining = headerValue(headers, {L"X-RL-Hourly-Remaining"});
            const auto hourlyReset = headerValue(headers, {L"X-RL-Hourly-Reset"});
            const auto dailyLimit = headerValue(headers, {L"X-RL-Daily-Limit"});
            const auto dailyRemaining = headerValue(headers, {L"X-RL-Daily-Remaining"});
            const auto dailyReset = headerValue(headers, {L"X-RL-Daily-Reset"});
            quota.hourlyLimit = hourlyLimit.has_value() ? parseInteger(*hourlyLimit) : -1;
            quota.hourlyRemaining = hourlyRemaining.has_value() ? parseInteger(*hourlyRemaining) : -1;
            quota.hourlyResetAt = hourlyReset.has_value() ? normalizeReset(*hourlyReset) : L"";
            quota.dailyLimit = dailyLimit.has_value() ? parseInteger(*dailyLimit) : -1;
            quota.dailyRemaining = dailyRemaining.has_value() ? parseInteger(*dailyRemaining) : -1;
            quota.dailyResetAt = dailyReset.has_value() ? normalizeReset(*dailyReset) : L"";
            quota.capturedAt = nowUtcText();
            return quota;
        }

        std::wstring retryAtFromHeaders(
            const std::map<std::wstring, std::wstring>& headers,
            const NexusQuotaSnapshot& quota)
        {
            if (const auto retryAfter = headerValue(headers, {L"Retry-After"}); retryAfter.has_value())
            {
                const long long seconds = parseInteger(*retryAfter, -1);
                if (seconds >= 0)
                {
                    return formatUtc(std::chrono::system_clock::to_time_t(
                        std::chrono::system_clock::now() + std::chrono::seconds(seconds)));
                }
                if (const std::wstring normalized = normalizeReset(*retryAfter); !normalized.empty())
                {
                    return normalized;
                }
            }
            if (!quota.hourlyResetAt.empty())
            {
                return quota.hourlyResetAt;
            }
            return quota.dailyResetAt;
        }

        NexusFileAvailability availabilityFor(const JsonValue& file)
        {
            const long long categoryId = integerValue(file, L"category_id", -1);
            if (categoryId == 4)
            {
                return NexusFileAvailability::Old;
            }
            if (categoryId == 6)
            {
                return NexusFileAvailability::Deleted;
            }
            if (categoryId == 7)
            {
                return NexusFileAvailability::Archived;
            }
            const std::wstring category = lower(stringValue(file, L"category_name"));
            if (category.find(L"delete") != std::wstring::npos)
            {
                return NexusFileAvailability::Deleted;
            }
            if (category.find(L"archiv") != std::wstring::npos)
            {
                return NexusFileAvailability::Archived;
            }
            if (category.find(L"old") != std::wstring::npos)
            {
                return NexusFileAvailability::Old;
            }
            return NexusFileAvailability::Active;
        }

        NexusModFilesResponse parseModFiles(const HttpResponse& response)
        {
            NexusModFilesResponse parsed;
            parsed.quota = quotaFromHeaders(response.headers);
            JsonValue root = JsonReader::parse(fromUtf8(response.body));
            if (!root.isObject())
            {
                throw NexusUpdateApiError(
                    NexusUpdateApiErrorKind::InvalidResponse,
                    "Nexus files response is not an object.",
                    parsed.quota);
            }
            const JsonValue* files = root.find(L"files");
            if (files == nullptr || !files->isArray())
            {
                throw NexusUpdateApiError(
                    NexusUpdateApiErrorKind::InvalidResponse,
                    "Nexus files response does not contain a files array.",
                    parsed.quota);
            }
            parsed.files.reserve(files->asArray().size());
            for (const JsonValue& value : files->asArray())
            {
                if (!value.isObject())
                {
                    continue;
                }
                const std::wstring fileId = stringValue(value, L"file_id");
                if (fileId.empty())
                {
                    continue;
                }
                parsed.files.push_back(NexusFileMetadata{
                    fileId,
                    stringValue(value, L"version"),
                    stringValue(value, L"category_id"),
                    booleanValue(value, L"is_primary"),
                    availabilityFor(value),
                    integerValue(value, L"uploaded_timestamp", 0)});
            }
            if (const JsonValue* updates = root.find(L"file_updates"); updates != nullptr && updates->isArray())
            {
                parsed.fileUpdates.reserve(updates->asArray().size());
                for (const JsonValue& value : updates->asArray())
                {
                    if (!value.isObject())
                    {
                        continue;
                    }
                    const std::wstring oldFileId = stringValue(value, L"old_file_id");
                    const std::wstring newFileId = stringValue(value, L"new_file_id");
                    if (!oldFileId.empty() && !newFileId.empty())
                    {
                        parsed.fileUpdates.push_back(NexusFileUpdateLink{
                            oldFileId,
                            newFileId,
                            integerValue(value, L"uploaded_timestamp", 0)});
                    }
                }
            }
            return parsed;
        }

        NexusRecentUpdatesResponse parseRecentUpdates(const HttpResponse& response)
        {
            NexusRecentUpdatesResponse parsed;
            parsed.quota = quotaFromHeaders(response.headers);
            JsonValue root = JsonReader::parse(fromUtf8(response.body));
            const JsonValue* updates = root.isArray() ? &root : root.find(L"updates");
            if (updates == nullptr || !updates->isArray())
            {
                throw NexusUpdateApiError(
                    NexusUpdateApiErrorKind::InvalidResponse,
                    "Nexus recent-updates response is not an array.",
                    parsed.quota);
            }
            parsed.updates.reserve(updates->asArray().size());
            for (const JsonValue& value : updates->asArray())
            {
                if (!value.isObject())
                {
                    continue;
                }
                const std::wstring modId = stringValue(value, L"mod_id");
                if (!modId.empty())
                {
                    parsed.updates.push_back(NexusRecentUpdate{
                        modId,
                        integerValue(value, L"latest_file_update", 0),
                        integerValue(value, L"latest_mod_activity", 0)});
                }
            }
            return parsed;
        }

#ifdef _WIN32
        class InternetHandle final
        {
        public:
            explicit InternetHandle(HINTERNET value = nullptr) noexcept : value_(value) {}
            ~InternetHandle()
            {
                if (value_ != nullptr)
                {
                    WinHttpCloseHandle(value_);
                }
            }
            InternetHandle(const InternetHandle&) = delete;
            InternetHandle& operator=(const InternetHandle&) = delete;
            [[nodiscard]] HINTERNET get() const noexcept { return value_; }

        private:
            HINTERNET value_;
        };

        std::wstring queryHeader(HINTERNET request, std::wstring_view name)
        {
            const std::wstring headerName(name);
            DWORD size = 0;
            WinHttpQueryHeaders(
                request,
                WINHTTP_QUERY_CUSTOM,
                headerName.c_str(),
                WINHTTP_NO_OUTPUT_BUFFER,
                &size,
                WINHTTP_NO_HEADER_INDEX);
            if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || size == 0)
            {
                return {};
            }
            std::wstring value(size / sizeof(wchar_t), L'\0');
            if (!WinHttpQueryHeaders(
                    request,
                    WINHTTP_QUERY_CUSTOM,
                    headerName.c_str(),
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
            return trim(std::move(value));
        }

        NexusUpdateApiErrorKind networkErrorKind(DWORD error)
        {
            switch (error)
            {
            case ERROR_WINHTTP_CANNOT_CONNECT:
            case ERROR_WINHTTP_CONNECTION_ERROR:
            case ERROR_WINHTTP_NAME_NOT_RESOLVED:
            case ERROR_WINHTTP_TIMEOUT:
                return NexusUpdateApiErrorKind::Offline;
            default:
                return NexusUpdateApiErrorKind::Network;
            }
        }
#endif

        class NexusUpdateHttpApi final : public NexusUpdateApi
        {
        public:
            NexusUpdateHttpApi(
                Logger& logger,
                NexusModsAuthService& auth,
                std::chrono::milliseconds overallTimeout) noexcept
                : logger_(logger), auth_(auth), overallTimeout_(overallTimeout)
            {
            }

            NexusModFilesResponse fetchModFiles(
                std::wstring_view gameDomain,
                std::wstring_view modId) override
            {
                return parseModFiles(get(
                    L"/v1/games/" + percentEncode(gameDomain) +
                    L"/mods/" + percentEncode(modId) + L"/files.json"));
            }

            NexusRecentUpdatesResponse fetchRecentUpdates(
                std::wstring_view gameDomain,
                std::wstring_view period) override
            {
                return parseRecentUpdates(get(
                    L"/v1/games/" + percentEncode(gameDomain) +
                    L"/mods/updated.json?period=" + percentEncode(period)));
            }

        private:
            HttpResponse get(const std::wstring& pathAndQuery)
            {
                const NexusModsApiAuthHeader authHeader = auth_.apiAuthHeader();
                if (!authHeader.isAvailable || authHeader.headerName.empty() || authHeader.headerValue.empty())
                {
                    throw NexusUpdateApiError(
                        NexusUpdateApiErrorKind::AuthenticationUnavailable,
                        "NexusMods authentication is unavailable.");
                }
                const std::chrono::steady_clock::time_point deadline =
                    overallTimeout_.count() > 0
                    ? std::chrono::steady_clock::now() + overallTimeout_
                    : (std::chrono::steady_clock::time_point::max)();
                return getWithAuth(pathAndQuery, authHeader, true, deadline);
            }

            HttpResponse getWithAuth(
                const std::wstring& pathAndQuery,
                const NexusModsApiAuthHeader& authHeader,
                bool allowUnauthorizedRetry,
                std::chrono::steady_clock::time_point deadline)
            {
#ifdef _WIN32
                const auto applyRemainingTimeout = [&](HINTERNET handle)
                {
                    if (overallTimeout_.count() <= 0)
                    {
                        return;
                    }
                    const auto now = std::chrono::steady_clock::now();
                    if (now >= deadline)
                    {
                        throw NexusUpdateApiError(
                            NexusUpdateApiErrorKind::Offline,
                            "NexusMods update request exceeded its overall timeout.");
                    }
                    const long long remainingMs = (std::max)(
                        1LL,
                        std::chrono::duration_cast<std::chrono::milliseconds>(
                            deadline - now).count());
                    const int timeoutMs = static_cast<int>((std::min)(
                        remainingMs,
                        static_cast<long long>((std::numeric_limits<int>::max)())));
                    WinHttpSetTimeouts(
                        handle,
                        timeoutMs,
                        timeoutMs,
                        timeoutMs,
                        timeoutMs);
                };

                InternetHandle session(WinHttpOpen(
                    L"Fluxora/0.1",
                    WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                    WINHTTP_NO_PROXY_NAME,
                    WINHTTP_NO_PROXY_BYPASS,
                    0));
                if (session.get() == nullptr)
                {
                    throw NexusUpdateApiError(
                        NexusUpdateApiErrorKind::Network,
                        "Failed to initialize NexusMods update request.");
                }
                if (overallTimeout_.count() > 0)
                {
                    applyRemainingTimeout(session.get());
                }
                else
                {
                    WinHttpSetTimeouts(session.get(), 15'000, 15'000, 15'000, 30'000);
                }

                InternetHandle connection(WinHttpConnect(
                    session.get(),
                    L"api.nexusmods.com",
                    INTERNET_DEFAULT_HTTPS_PORT,
                    0));
                if (connection.get() == nullptr)
                {
                    throw NexusUpdateApiError(
                        networkErrorKind(GetLastError()),
                        "Failed to connect to NexusMods update API.");
                }

                InternetHandle request(WinHttpOpenRequest(
                    connection.get(),
                    L"GET",
                    pathAndQuery.c_str(),
                    nullptr,
                    WINHTTP_NO_REFERER,
                    WINHTTP_DEFAULT_ACCEPT_TYPES,
                    WINHTTP_FLAG_SECURE));
                if (request.get() == nullptr)
                {
                    throw NexusUpdateApiError(
                        NexusUpdateApiErrorKind::Network,
                        "Failed to open NexusMods update request.");
                }

                const std::wstring headers =
                    L"Accept: application/json\r\n"
                    L"Application-Name: Fluxora\r\n"
                    L"Application-Version: 0.1.0\r\n" +
                    authHeader.headerName + L": " + authHeader.headerValue + L"\r\n";
                applyRemainingTimeout(request.get());
                if (!WinHttpSendRequest(
                        request.get(),
                        headers.c_str(),
                        static_cast<DWORD>(headers.size()),
                        WINHTTP_NO_REQUEST_DATA,
                        0,
                        0,
                        0))
                {
                    const DWORD error = GetLastError();
                    throw NexusUpdateApiError(
                        networkErrorKind(error),
                        "NexusMods update request failed.");
                }
                applyRemainingTimeout(request.get());
                if (!WinHttpReceiveResponse(request.get(), nullptr))
                {
                    const DWORD error = GetLastError();
                    throw NexusUpdateApiError(
                        networkErrorKind(error),
                        "NexusMods update request failed.");
                }

                DWORD statusCode = 0;
                DWORD statusSize = sizeof(statusCode);
                WinHttpQueryHeaders(
                    request.get(),
                    WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                    WINHTTP_HEADER_NAME_BY_INDEX,
                    &statusCode,
                    &statusSize,
                    WINHTTP_NO_HEADER_INDEX);

                HttpResponse response;
                response.statusCode = statusCode;
                for (const std::wstring_view headerName : {
                         L"X-RL-Hourly-Limit",
                         L"X-RL-Hourly-Remaining",
                         L"X-RL-Hourly-Reset",
                         L"X-RL-Daily-Limit",
                         L"X-RL-Daily-Remaining",
                         L"X-RL-Daily-Reset",
                         L"Retry-After"})
                {
                    if (std::wstring value = queryHeader(request.get(), headerName); !value.empty())
                    {
                        response.headers.emplace(std::wstring(headerName), std::move(value));
                    }
                }

                DWORD available = 0;
                for (;;)
                {
                    applyRemainingTimeout(request.get());
                    if (!WinHttpQueryDataAvailable(request.get(), &available) || available == 0)
                    {
                        break;
                    }
                    std::vector<char> chunk(available);
                    DWORD read = 0;
                    applyRemainingTimeout(request.get());
                    if (!WinHttpReadData(request.get(), chunk.data(), available, &read))
                    {
                        const DWORD error = GetLastError();
                        throw NexusUpdateApiError(
                            networkErrorKind(error),
                            "Failed to read NexusMods update response.",
                            quotaFromHeaders(response.headers));
                    }
                    response.body.append(chunk.data(), chunk.data() + read);
                }

                const NexusQuotaSnapshot quota = quotaFromHeaders(response.headers);
                if (statusCode == 429)
                {
                    throw NexusUpdateApiError(
                        nexusUpdateApiErrorKindForHttpStatus(statusCode),
                        "NexusMods update request was rate limited.",
                        quota,
                        retryAtFromHeaders(response.headers, quota));
                }
                if (statusCode == 401 &&
                    allowUnauthorizedRetry)
                {
                    const bool isOAuth = authHeader.credentialKind == L"oauth";
                    const NexusModsApiAuthHeader retryHeader = isOAuth
                        ? auth_.retryApiAuthHeaderAfterUnauthorized(authHeader)
                        : authHeader;
                    if (retryHeader.isAvailable)
                    {
                        logger_.writeOperation(
                            LogLevel::Info,
                            "ModUpdates",
                            isOAuth
                                ? "Nexus request received HTTP 401; retrying once after synchronized OAuth refresh."
                                : "Nexus request received HTTP 401; retrying the current API credential once.");
                        return getWithAuth(pathAndQuery, retryHeader, false, deadline);
                    }
                }
                if (statusCode == 401)
                {
                    if (!allowUnauthorizedRetry)
                    {
                        static_cast<void>(auth_.retryApiAuthHeaderAfterUnauthorized(authHeader));
                    }
                    throw NexusUpdateApiError(
                        nexusUpdateApiErrorKindForHttpStatus(statusCode),
                        "NexusMods rejected the current authentication.",
                        quota);
                }
                if (statusCode == 403 || statusCode == 404 || statusCode == 410)
                {
                    throw NexusUpdateApiError(
                        nexusUpdateApiErrorKindForHttpStatus(statusCode),
                        "NexusMods metadata is unavailable for this resource (HTTP " +
                            std::to_string(statusCode) + ").",
                        quota);
                }
                if (statusCode < 200 || statusCode >= 300)
                {
                    throw NexusUpdateApiError(
                        nexusUpdateApiErrorKindForHttpStatus(statusCode),
                        "NexusMods update request returned HTTP " + std::to_string(statusCode) + ".",
                        quota);
                }
                return response;
#else
                (void)pathAndQuery;
                throw NexusUpdateApiError(
                    NexusUpdateApiErrorKind::Network,
                    "NexusMods update requests are currently implemented for Windows builds.");
#endif
            }

            Logger& logger_;
            NexusModsAuthService& auth_;
            std::chrono::milliseconds overallTimeout_;
        };
    }

    NexusUpdateApiErrorKind nexusUpdateApiErrorKindForHttpStatus(
        unsigned long statusCode) noexcept
    {
        switch (statusCode)
        {
        case 401:
            return NexusUpdateApiErrorKind::AuthenticationUnavailable;
        case 403:
        case 404:
        case 410:
            return NexusUpdateApiErrorKind::ResourceUnavailable;
        case 429:
            return NexusUpdateApiErrorKind::RateLimited;
        default:
            return NexusUpdateApiErrorKind::Network;
        }
    }

    std::unique_ptr<NexusUpdateApi> createNexusUpdateApi(
        Logger& logger,
        NexusModsAuthService& auth,
        std::chrono::milliseconds overallTimeout)
    {
        return std::make_unique<NexusUpdateHttpApi>(logger, auth, overallTimeout);
    }
}
