#include "FluxoraCore/Services/ModdingFlowOAuthHttpClient.hpp"

#include "FluxoraCore/Services/ModdingFlowApiResponse.hpp"
#include "FluxoraCore/Services/ModdingFlowHttpTransport.hpp"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cstdint>
#include <exception>
#include <iomanip>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <utility>

#ifdef _WIN32
#include <Windows.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::size_t maximumTokenResponseBytes = 64U * 1024U;
        constexpr std::size_t maximumProfileResponseBytes = 32U * 1024U;

        enum class RequestPurpose
        {
            AuthorizationCode,
            Refresh,
            Profile,
            Revoke
        };

        void wipe(std::string& value) noexcept
        {
#ifdef _WIN32
            if (!value.empty())
            {
                SecureZeroMemory(value.data(), value.size());
            }
#else
            std::fill(value.begin(), value.end(), '\0');
#endif
            value.clear();
        }

        class SensitiveRequestGuard final
        {
        public:
            explicit SensitiveRequestGuard(ModdingFlowHttpRequest& request) noexcept
                : request_(request)
            {
            }
            ~SensitiveRequestGuard()
            {
                wipe(request_.body);
                for (ModdingFlowHttpHeader& header : request_.headers)
                {
                    wipe(header.value);
                }
            }

        private:
            ModdingFlowHttpRequest& request_;
        };

        class SensitiveResponseGuard final
        {
        public:
            explicit SensitiveResponseGuard(ModdingFlowHttpResponse& response) noexcept
                : response_(response)
            {
            }
            ~SensitiveResponseGuard() { wipe(response_.body); }

        private:
            ModdingFlowHttpResponse& response_;
        };

        std::string formEncode(std::string_view value)
        {
            std::ostringstream encoded;
            encoded << std::uppercase << std::hex;
            for (const unsigned char character : value)
            {
                if ((character >= 'A' && character <= 'Z') ||
                    (character >= 'a' && character <= 'z') ||
                    (character >= '0' && character <= '9') ||
                    character == '-' || character == '.' || character == '_' || character == '~')
                {
                    encoded << static_cast<char>(character);
                }
                else
                {
                    encoded << '%' << std::setw(2) << std::setfill('0') <<
                        static_cast<unsigned int>(character);
                }
            }
            return encoded.str();
        }

        std::string encodeUtf8(std::wstring_view value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }
            if (value.size() > static_cast<std::size_t>((std::numeric_limits<int>::max)()))
            {
                throw std::runtime_error("ModdingFlow JSON string is too large.");
            }
            const int inputLength = static_cast<int>(value.size());
            const int required = WideCharToMultiByte(
                CP_UTF8,
                WC_ERR_INVALID_CHARS,
                value.data(),
                inputLength,
                nullptr,
                0,
                nullptr,
                nullptr);
            if (required <= 0)
            {
                throw std::runtime_error("ModdingFlow JSON string is invalid.");
            }
            std::string result(static_cast<std::size_t>(required), '\0');
            if (WideCharToMultiByte(
                    CP_UTF8,
                    WC_ERR_INVALID_CHARS,
                    value.data(),
                    inputLength,
                    result.data(),
                    required,
                    nullptr,
                    nullptr) != required)
            {
                throw std::runtime_error("ModdingFlow JSON string conversion failed.");
            }
            return result;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        const JsonValue& requiredMember(
            const JsonValue& object,
            std::wstring_view name,
            JsonValue::Type type)
        {
            const JsonValue* value = object.find(name);
            if (value == nullptr || value->type() != type)
            {
                throw std::runtime_error("ModdingFlow response has an invalid required field.");
            }
            return *value;
        }

        std::string requiredString(const JsonValue& object, std::wstring_view name)
        {
            return encodeUtf8(requiredMember(object, name, JsonValue::Type::String).asString());
        }

        std::string optionalString(const JsonValue& object, std::wstring_view name)
        {
            const JsonValue* value = object.find(name);
            if (value == nullptr)
            {
                return {};
            }
            if (!value->isString())
            {
                throw std::runtime_error("ModdingFlow response has an invalid optional field.");
            }
            return encodeUtf8(value->asString());
        }

        bool equalsAsciiCaseInsensitive(std::string_view left, std::string_view right) noexcept
        {
            if (left.size() != right.size())
            {
                return false;
            }
            for (std::size_t index = 0; index < left.size(); ++index)
            {
                const unsigned char leftCharacter = static_cast<unsigned char>(left[index]);
                const unsigned char rightCharacter = static_cast<unsigned char>(right[index]);
                if (std::tolower(leftCharacter) != std::tolower(rightCharacter))
                {
                    return false;
                }
            }
            return true;
        }

        bool isJsonContentType(std::string_view value) noexcept
        {
            const std::size_t separator = value.find(';');
            const std::string_view mediaType = value.substr(0, separator);
            return equalsAsciiCaseInsensitive(mediaType, "application/json") ||
                equalsAsciiCaseInsensitive(mediaType, "application/problem+json");
        }

        bool isSuccessJsonContentType(std::string_view value) noexcept
        {
            const std::size_t separator = value.find(';');
            return equalsAsciiCaseInsensitive(
                value.substr(0, separator),
                "application/json");
        }

        bool isProblemJsonContentType(std::string_view value) noexcept
        {
            const std::size_t separator = value.find(';');
            return equalsAsciiCaseInsensitive(
                value.substr(0, separator),
                "application/problem+json");
        }

        void requireSingleJsonContentType(const ModdingFlowHttpResponse& response)
        {
            std::size_t count = 0;
            std::string_view contentType;
            for (const auto& header : response.headers)
            {
                if (equalsAsciiCaseInsensitive(header.name, "content-type"))
                {
                    ++count;
                    contentType = header.value;
                }
            }
            if (count != 1 || !isSuccessJsonContentType(contentType))
            {
                throw std::runtime_error("ModdingFlow response content type is invalid or ambiguous.");
            }
        }

        ModdingFlowOAuthFailureMetadata responseFailureMetadata(
            const ModdingFlowHttpResponse& response)
        {
            std::size_t contentTypeCount = 0;
            std::string_view contentType;
            for (const ModdingFlowHttpHeader& header : response.headers)
            {
                if (equalsAsciiCaseInsensitive(header.name, "content-type"))
                {
                    ++contentTypeCount;
                    contentType = header.value;
                }
            }
            if (response.body.empty() || response.body.size() > maximumTokenResponseBytes ||
                contentTypeCount != 1U || !isJsonContentType(contentType))
            {
                return {};
            }
            try
            {
                if (isProblemJsonContentType(contentType))
                {
                    const auto problem = parseModdingFlowProblemDetails(
                        response,
                        {.maximumBytes = maximumTokenResponseBytes});
                    return problem
                        ? ModdingFlowOAuthFailureMetadata{
                            problem->machineCode,
                            problem->requestId,
                            problem->traceId}
                        : ModdingFlowOAuthFailureMetadata{};
                }
                const JsonValue root = parseModdingFlowJson(
                    response.body,
                    {.maximumBytes = maximumTokenResponseBytes});
                if (!root.isObject())
                {
                    return {};
                }
                if (const JsonValue* oauthError = root.find(L"error");
                    oauthError != nullptr && oauthError->isString())
                {
                    return {.machineCode = encodeUtf8(oauthError->asString())};
                }
                for (const std::wstring_view field : {L"code", L"machine_code"})
                {
                    if (const JsonValue* code = root.find(field);
                        code != nullptr && code->isString())
                    {
                        return {.machineCode = encodeUtf8(code->asString())};
                    }
                }
                if (const JsonValue* problemError = root.find(L"error");
                    problemError != nullptr && problemError->isObject())
                {
                    if (const JsonValue* code = problemError->find(L"machine_code");
                        code != nullptr && code->isString())
                    {
                        return {.machineCode = encodeUtf8(code->asString())};
                    }
                }
            }
            catch (...)
            {
            }
            return {};
        }

        [[noreturn]] void throwForHttpStatus(
            const ModdingFlowHttpResponse& response,
            RequestPurpose purpose)
        {
            const ModdingFlowOAuthFailureMetadata metadata =
                responseFailureMetadata(response);
            const std::string& code = metadata.machineCode;
            if (code == "invalid_grant" || code == "oauth_invalid_grant" ||
                code == "invalid_token" || code == "auth_invalid_token")
            {
                throw ModdingFlowOAuthException(
                    ModdingFlowOAuthFailureKind::InvalidGrant,
                    "ModdingFlow rejected the supplied OAuth grant.",
                    metadata);
            }
            if (response.statusCode == 429)
            {
                throw ModdingFlowOAuthException(
                    ModdingFlowOAuthFailureKind::Temporary,
                    "ModdingFlow temporarily rate limited the request.",
                    metadata);
            }
            if (purpose == RequestPurpose::Refresh &&
                response.statusCode == 503 &&
                code == "oauth_refresh_rotation_unavailable")
            {
                throw ModdingFlowOAuthException(
                    ModdingFlowOAuthFailureKind::Temporary,
                    "ModdingFlow refresh rotation is temporarily unavailable.",
                    metadata);
            }
            if (response.statusCode == 401 || response.statusCode == 403)
            {
                throw ModdingFlowOAuthException(
                    ModdingFlowOAuthFailureKind::Security,
                    "ModdingFlow rejected the request credentials or scope.",
                    metadata);
            }
            if (response.statusCode >= 500 && response.statusCode <= 599)
            {
                throw ModdingFlowOAuthException(
                    purpose == RequestPurpose::Refresh
                        ? ModdingFlowOAuthFailureKind::Ambiguous
                        : ModdingFlowOAuthFailureKind::Temporary,
                    purpose == RequestPurpose::Refresh
                        ? "ModdingFlow refresh outcome was ambiguous."
                        : "ModdingFlow service is temporarily unavailable.",
                    metadata);
            }
            if (response.statusCode >= 300 && response.statusCode <= 399)
            {
                throw ModdingFlowOAuthException(
                    ModdingFlowOAuthFailureKind::Security,
                    "ModdingFlow endpoint redirect was rejected.",
                    metadata);
            }
            throw ModdingFlowOAuthException(
                ModdingFlowOAuthFailureKind::Protocol,
                "ModdingFlow returned an unexpected HTTP response.",
                metadata);
        }

        ModdingFlowHttpResponse sendOnce(
            IModdingFlowHttpTransport& transport,
            const ModdingFlowHttpRequest& request,
            RequestPurpose purpose)
        {
            try
            {
                return transport.send(request);
            }
            catch (const ModdingFlowHttpException& exception)
            {
                if (exception.kind() == ModdingFlowHttpFailureKind::Security)
                {
                    throw ModdingFlowOAuthException(
                        ModdingFlowOAuthFailureKind::Security,
                        "ModdingFlow transport security validation failed.");
                }
                if (exception.kind() == ModdingFlowHttpFailureKind::DefinitelyNotSent &&
                    !exception.requestMayHaveBeenSent())
                {
                    throw ModdingFlowOAuthException(
                        ModdingFlowOAuthFailureKind::RequestNotSent,
                        "ModdingFlow request was not sent.");
                }
                if (purpose == RequestPurpose::Refresh || exception.requestMayHaveBeenSent())
                {
                    throw ModdingFlowOAuthException(
                        ModdingFlowOAuthFailureKind::Ambiguous,
                        "ModdingFlow request outcome was ambiguous.");
                }
                if (exception.kind() == ModdingFlowHttpFailureKind::Timeout ||
                    exception.kind() == ModdingFlowHttpFailureKind::Ambiguous)
                {
                    throw ModdingFlowOAuthException(
                        ModdingFlowOAuthFailureKind::Temporary,
                        "ModdingFlow request failed temporarily.");
                }
                throw ModdingFlowOAuthException(
                    ModdingFlowOAuthFailureKind::Protocol,
                    "ModdingFlow transport response was invalid.");
            }
        }

        std::vector<std::string> parseScopes(std::string_view value)
        {
            std::vector<std::string> scopes;
            std::size_t start = 0;
            while (start < value.size())
            {
                const std::size_t end = value.find(' ', start);
                const std::string_view scope = value.substr(start, end - start);
                if (scope.empty())
                {
                    throw std::runtime_error("ModdingFlow token scope is invalid.");
                }
                scopes.emplace_back(scope);
                if (end == std::string_view::npos)
                {
                    break;
                }
                start = end + 1;
            }
            return scopes;
        }

        ModdingFlowTokenSet parseAuthorizationTokenResponse(const ModdingFlowHttpResponse& response)
        {
            if (response.statusCode != 200)
            {
                throwForHttpStatus(response, RequestPurpose::AuthorizationCode);
            }
            if (response.body.size() > maximumTokenResponseBytes)
            {
                throw ModdingFlowOAuthException(
                    ModdingFlowOAuthFailureKind::Protocol,
                    "ModdingFlow token response exceeded its size limit.");
            }

            try
            {
                requireSingleJsonContentType(response);
                const JsonValue root = parseModdingFlowJson(
                    response.body,
                    {.maximumBytes = maximumTokenResponseBytes});
                if (!root.isObject())
                {
                    throw std::runtime_error("Token response is not an object.");
                }
                ModdingFlowTokenSet result;
                result.accessToken = requiredString(root, L"access_token");
                result.refreshToken = requiredString(root, L"refresh_token");
                result.idToken = requiredString(root, L"id_token");
                result.tokenType = requiredString(root, L"token_type");
                const std::wstring& expiresText = requiredMember(
                    root,
                    L"expires_in",
                    JsonValue::Type::Number).asNumber();
                std::uint64_t expires = 0;
                std::string expiresUtf8;
                expiresUtf8.reserve(expiresText.size());
                for (const wchar_t character : expiresText)
                {
                    if (character < L'0' || character > L'9')
                    {
                        throw std::runtime_error("Token expiry is invalid.");
                    }
                    expiresUtf8.push_back(static_cast<char>(character));
                }
                const auto [end, error] = std::from_chars(
                    expiresUtf8.data(),
                    expiresUtf8.data() + expiresUtf8.size(),
                    expires);
                if (error != std::errc{} || end != expiresUtf8.data() + expiresUtf8.size() ||
                    expires == 0 || expires > 7U * 24U * 60U * 60U)
                {
                    throw std::runtime_error("Token expiry is invalid.");
                }
                result.expiresIn = std::chrono::seconds(expires);
                result.grantedScopes = parseScopes(requiredString(root, L"scope"));
                return result;
            }
            catch (const ModdingFlowOAuthException&)
            {
                throw;
            }
            catch (...)
            {
                throw ModdingFlowOAuthException(
                    ModdingFlowOAuthFailureKind::Protocol,
                    "ModdingFlow token response was malformed.");
            }
        }
    }

    ModdingFlowOAuthHttpClient::ModdingFlowOAuthHttpClient(
        ModdingFlowConfiguration configuration,
        IModdingFlowHttpTransport& transport)
        : configuration_(std::move(configuration)),
          transport_(transport)
    {
    }

    ModdingFlowTokenSet ModdingFlowOAuthHttpClient::exchangeAuthorizationCode(
        const ModdingFlowAuthorizationCodeRequest& request)
    {
        if (request.tokenEndpoint != configuration_.tokenEndpoint() ||
            request.clientId != configuration_.clientId())
        {
            throw ModdingFlowOAuthException(
                ModdingFlowOAuthFailureKind::Security,
                "ModdingFlow authorization exchange configuration was rejected.");
        }
        configuration_.validateRedirectUri(request.redirectUri);
        if (request.authorizationCode.empty() || request.codeVerifier.empty())
        {
            throw ModdingFlowOAuthException(
                ModdingFlowOAuthFailureKind::Protocol,
                "ModdingFlow authorization exchange input was incomplete.");
        }

        ModdingFlowHttpRequest httpRequest;
        httpRequest.method = ModdingFlowHttpMethod::Post;
        httpRequest.url = request.tokenEndpoint;
        httpRequest.headers = {
            {"accept", "application/json"},
            {"content-type", "application/x-www-form-urlencoded; charset=UTF-8"}};
        httpRequest.body =
            "grant_type=authorization_code&client_id=" + formEncode(request.clientId) +
            "&redirect_uri=" + formEncode(request.redirectUri) +
            "&code=" + formEncode(request.authorizationCode) +
            "&code_verifier=" + formEncode(request.codeVerifier);
        httpRequest.operationId = request.operationId;
        httpRequest.policy = request.transport;
        httpRequest.maximumResponseBodyBytes = maximumTokenResponseBytes;
        SensitiveRequestGuard requestGuard(httpRequest);
        ModdingFlowHttpResponse response = sendOnce(
            transport_,
            httpRequest,
            RequestPurpose::AuthorizationCode);
        SensitiveResponseGuard responseGuard(response);
        return parseAuthorizationTokenResponse(response);
    }

    ModdingFlowTokenSet ModdingFlowOAuthHttpClient::refreshAccessToken(
        const ModdingFlowRefreshRequest& request)
    {
        if (request.tokenEndpoint != configuration_.tokenEndpoint() ||
            request.clientId != configuration_.clientId())
        {
            throw ModdingFlowOAuthException(
                ModdingFlowOAuthFailureKind::Security,
                "ModdingFlow refresh configuration was rejected.");
        }
        if (request.refreshToken.empty())
        {
            throw ModdingFlowOAuthException(
                ModdingFlowOAuthFailureKind::Protocol,
                "ModdingFlow refresh token was missing.");
        }

        ModdingFlowHttpRequest httpRequest;
        httpRequest.method = ModdingFlowHttpMethod::Post;
        httpRequest.url = request.tokenEndpoint;
        httpRequest.headers = {
            {"accept", "application/json"},
            {"content-type", "application/x-www-form-urlencoded; charset=UTF-8"}};
        httpRequest.body =
            "grant_type=refresh_token&client_id=" + formEncode(request.clientId) +
            "&refresh_token=" + formEncode(request.refreshToken);
        httpRequest.operationId = request.operationId;
        httpRequest.policy = request.transport;
        httpRequest.maximumResponseBodyBytes = maximumTokenResponseBytes;
        SensitiveRequestGuard requestGuard(httpRequest);
        ModdingFlowHttpResponse response = sendOnce(
            transport_,
            httpRequest,
            RequestPurpose::Refresh);
        SensitiveResponseGuard responseGuard(response);
        if (response.statusCode != 200)
        {
            throwForHttpStatus(response, RequestPurpose::Refresh);
        }

        try
        {
            requireSingleJsonContentType(response);
            const JsonValue root = parseModdingFlowJson(
                response.body,
                {.maximumBytes = maximumTokenResponseBytes});
            if (!root.isObject())
            {
                throw std::runtime_error("Refresh response is not an object.");
            }
            ModdingFlowTokenSet result;
            result.accessToken = requiredString(root, L"access_token");
            result.refreshToken = requiredString(root, L"refresh_token");
            result.idToken = optionalString(root, L"id_token");
            result.tokenType = requiredString(root, L"token_type");
            const std::wstring& expiresText = requiredMember(
                root,
                L"expires_in",
                JsonValue::Type::Number).asNumber();
            std::string expiresAscii;
            for (const wchar_t character : expiresText)
            {
                if (character < L'0' || character > L'9')
                {
                    throw std::runtime_error("Refresh expiry is invalid.");
                }
                expiresAscii.push_back(static_cast<char>(character));
            }
            std::uint64_t expires = 0;
            const auto [end, error] = std::from_chars(
                expiresAscii.data(),
                expiresAscii.data() + expiresAscii.size(),
                expires);
            if (error != std::errc{} || end != expiresAscii.data() + expiresAscii.size() ||
                expires == 0 || expires > 7U * 24U * 60U * 60U)
            {
                throw std::runtime_error("Refresh expiry is invalid.");
            }
            result.expiresIn = std::chrono::seconds(expires);
            result.grantedScopes = parseScopes(requiredString(root, L"scope"));
            return result;
        }
        catch (const ModdingFlowOAuthException&)
        {
            throw;
        }
        catch (...)
        {
            throw ModdingFlowOAuthException(
                ModdingFlowOAuthFailureKind::Ambiguous,
                "ModdingFlow refresh response was malformed after the request was sent.");
        }
    }

    ModdingFlowProfile ModdingFlowOAuthHttpClient::fetchCurrentProfile(
        const ModdingFlowProfileRequest& request)
    {
        if (request.apiBaseUrl != configuration_.apiBaseUrl() || request.accessToken.empty() ||
            request.accessToken.size() > 16U * 1024U ||
            request.accessToken.find_first_of(" \t\r\n") != std::string::npos)
        {
            throw ModdingFlowOAuthException(
                ModdingFlowOAuthFailureKind::Security,
                "ModdingFlow profile request configuration was rejected.");
        }

        ModdingFlowHttpRequest httpRequest;
        httpRequest.method = ModdingFlowHttpMethod::Get;
        httpRequest.url = std::string(configuration_.apiBaseUrl()) + "/me/profile";
        httpRequest.headers = {
            {"accept", "application/json"},
            {"authorization", "Bearer " + request.accessToken}};
        httpRequest.operationId = request.operationId;
        httpRequest.policy = request.transport;
        httpRequest.maximumResponseBodyBytes = maximumProfileResponseBytes;
        SensitiveRequestGuard requestGuard(httpRequest);
        ModdingFlowHttpResponse response = sendOnce(
            transport_,
            httpRequest,
            RequestPurpose::Profile);
        SensitiveResponseGuard responseGuard(response);
        if (response.statusCode != 200)
        {
            throwForHttpStatus(response, RequestPurpose::Profile);
        }

        try
        {
            requireSingleJsonContentType(response);
            const JsonValue root = parseModdingFlowJson(
                response.body,
                {.maximumBytes = maximumProfileResponseBytes});
            if (!root.isObject() || root.asObject().size() != 2U ||
                root.find(L"ok") == nullptr || root.find(L"data") == nullptr ||
                root.find(L"ok")->type() != JsonValue::Type::Boolean ||
                !root.find(L"ok")->asBoolean() || !root.find(L"data")->isObject())
            {
                throw std::runtime_error("Profile envelope is invalid.");
            }
            const JsonValue& data = *root.find(L"data");
            static constexpr std::wstring_view profileFields[] = {
                L"user_id",
                L"nickname",
                L"mention_tag",
                L"avatar_url",
                L"preferred_language",
                L"status",
                L"updated_at"};
            if (data.asObject().size() != std::size(profileFields))
            {
                throw std::runtime_error("Profile data shape is invalid.");
            }
            for (const std::wstring_view field : profileFields)
            {
                if (data.find(field) == nullptr)
                {
                    throw std::runtime_error("Profile data field is missing.");
                }
            }

            ModdingFlowProfile profile;
            profile.userId = requiredString(data, L"user_id");
            if (profile.userId.size() != 36U ||
                profile.userId[8] != '-' || profile.userId[13] != '-' ||
                profile.userId[18] != '-' || profile.userId[23] != '-')
            {
                throw std::runtime_error("Profile user id is invalid.");
            }
            for (std::size_t index = 0; index < profile.userId.size(); ++index)
            {
                if (index == 8 || index == 13 || index == 18 || index == 23)
                {
                    continue;
                }
                if (!std::isxdigit(static_cast<unsigned char>(profile.userId[index])))
                {
                    throw std::runtime_error("Profile user id is invalid.");
                }
            }

            const JsonValue* nickname = data.find(L"nickname");
            const JsonValue* mentionTag = data.find(L"mention_tag");
            for (const JsonValue* optionalText : {
                nickname,
                mentionTag,
                data.find(L"avatar_url"),
                data.find(L"preferred_language")})
            {
                if (!optionalText->isNull() && !optionalText->isString())
                {
                    throw std::runtime_error("Profile optional text field is invalid.");
                }
            }
            const JsonValue* status = data.find(L"status");
            const JsonValue* updatedAt = data.find(L"updated_at");
            if (!status->isString() || !updatedAt->isString())
            {
                throw std::runtime_error("Profile status metadata is invalid.");
            }
            const std::wstring& statusText = status->asString();
            if (statusText != L"admin" && statusText != L"verified" &&
                statusText != L"premium" && statusText != L"experienced" &&
                statusText != L"newbie")
            {
                throw std::runtime_error("Profile status is invalid.");
            }
            if (!nickname->isNull())
            {
                profile.displayName = nickname->asString();
            }
            else if (!mentionTag->isNull())
            {
                profile.displayName = mentionTag->asString();
            }
            if (profile.displayName.size() > 256U || updatedAt->asString().size() > 64U)
            {
                throw std::runtime_error("Profile display metadata is too large.");
            }
            return profile;
        }
        catch (const ModdingFlowOAuthException&)
        {
            throw;
        }
        catch (...)
        {
            throw ModdingFlowOAuthException(
                ModdingFlowOAuthFailureKind::Protocol,
                "ModdingFlow profile response was malformed.");
        }
    }

    void ModdingFlowOAuthHttpClient::revokeToken(const ModdingFlowRevokeRequest& request)
    {
        if (request.revocationEndpoint != configuration_.revocationEndpoint() ||
            request.clientId != configuration_.clientId() || request.token.empty() ||
            request.token.size() > 16U * 1024U ||
            (request.tokenTypeHint != "access_token" &&
             request.tokenTypeHint != "refresh_token"))
        {
            throw ModdingFlowOAuthException(
                ModdingFlowOAuthFailureKind::Security,
                "ModdingFlow revocation request configuration was rejected.");
        }

        ModdingFlowHttpRequest httpRequest;
        httpRequest.method = ModdingFlowHttpMethod::Post;
        httpRequest.url = request.revocationEndpoint;
        httpRequest.headers = {
            {"accept", "application/json"},
            {"content-type", "application/x-www-form-urlencoded; charset=UTF-8"}};
        httpRequest.body =
            "client_id=" + formEncode(request.clientId) +
            "&token=" + formEncode(request.token) +
            "&token_type_hint=" + formEncode(request.tokenTypeHint);
        httpRequest.operationId = request.operationId;
        httpRequest.policy = request.transport;
        httpRequest.maximumResponseBodyBytes = maximumTokenResponseBytes;
        SensitiveRequestGuard requestGuard(httpRequest);
        ModdingFlowHttpResponse response = sendOnce(
            transport_,
            httpRequest,
            RequestPurpose::Revoke);
        SensitiveResponseGuard responseGuard(response);
        if (response.statusCode != 200 && response.statusCode != 204)
        {
            throwForHttpStatus(response, RequestPurpose::Revoke);
        }
        if (!response.body.empty())
        {
            requireSingleJsonContentType(response);
            static_cast<void>(parseModdingFlowJson(
                response.body,
                {.maximumBytes = maximumTokenResponseBytes}));
        }
    }
}
