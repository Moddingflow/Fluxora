#include "FluxoraCore/Services/ModdingFlowPublicApiClient.hpp"

#include <algorithm>
#include <charconv>
#include <cctype>
#include <chrono>
#include <limits>
#include <thread>
#include <utility>

#ifdef _WIN32
#include <Windows.h>
#endif

namespace fluxora
{
    namespace
    {
        constexpr std::size_t maximumOperationIdCodeUnits = 256U;
        constexpr std::size_t maximumPathAndQueryBytes = 4096U;
        constexpr std::size_t maximumRequestBodyBytes = 512U * 1024U;
        constexpr std::size_t maximumBearerTokenBytes = 16U * 1024U;
        constexpr std::size_t maximumRequestIdBytes = 256U;

        bool headerNameEquals(std::string_view left, std::string_view right) noexcept;

        void secureWipe(std::string& value) noexcept
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

        class SensitiveStringGuard final
        {
        public:
            explicit SensitiveStringGuard(std::string& value) noexcept
                : value_(value)
            {
            }

            ~SensitiveStringGuard() { secureWipe(value_); }

            SensitiveStringGuard(const SensitiveStringGuard&) = delete;
            SensitiveStringGuard& operator=(const SensitiveStringGuard&) = delete;

        private:
            std::string& value_;
        };

        class SensitiveHttpRequestGuard final
        {
        public:
            explicit SensitiveHttpRequestGuard(ModdingFlowHttpRequest& request) noexcept
                : request_(request)
            {
            }

            ~SensitiveHttpRequestGuard()
            {
                for (ModdingFlowHttpHeader& header : request_.headers)
                {
                    if (headerNameEquals(header.name, "authorization"))
                    {
                        secureWipe(header.value);
                    }
                }
            }

            SensitiveHttpRequestGuard(const SensitiveHttpRequestGuard&) = delete;
            SensitiveHttpRequestGuard& operator=(const SensitiveHttpRequestGuard&) = delete;

        private:
            ModdingFlowHttpRequest& request_;
        };

        bool asciiEqualsIgnoreCase(std::string_view left, std::string_view right) noexcept
        {
            if (left.size() != right.size())
            {
                return false;
            }
            for (std::size_t index = 0; index < left.size(); ++index)
            {
                if (std::tolower(static_cast<unsigned char>(left[index])) !=
                    std::tolower(static_cast<unsigned char>(right[index])))
                {
                    return false;
                }
            }
            return true;
        }

        bool headerNameEquals(std::string_view left, std::string_view right) noexcept
        {
            return asciiEqualsIgnoreCase(left, right);
        }

        std::vector<std::string_view> headerValues(
            const ModdingFlowHttpResponse& response,
            std::string_view name)
        {
            std::vector<std::string_view> values;
            for (const ModdingFlowHttpHeader& header : response.headers)
            {
                if (headerNameEquals(header.name, name))
                {
                    values.push_back(header.value);
                }
            }
            return values;
        }

        bool isJsonContentType(std::string_view contentType) noexcept
        {
            const std::size_t delimiter = contentType.find(';');
            std::string_view mediaType = contentType.substr(0, delimiter);
            while (!mediaType.empty() &&
                   std::isspace(static_cast<unsigned char>(mediaType.front())))
            {
                mediaType.remove_prefix(1);
            }
            while (!mediaType.empty() &&
                   std::isspace(static_cast<unsigned char>(mediaType.back())))
            {
                mediaType.remove_suffix(1);
            }
            return asciiEqualsIgnoreCase(mediaType, "application/json");
        }

        bool isProblemContentType(std::string_view contentType) noexcept
        {
            const std::size_t delimiter = contentType.find(';');
            std::string_view mediaType = contentType.substr(0, delimiter);
            while (!mediaType.empty() &&
                   std::isspace(static_cast<unsigned char>(mediaType.front())))
            {
                mediaType.remove_prefix(1);
            }
            while (!mediaType.empty() &&
                   std::isspace(static_cast<unsigned char>(mediaType.back())))
            {
                mediaType.remove_suffix(1);
            }
            return asciiEqualsIgnoreCase(mediaType, "application/problem+json");
        }

        bool hasControlCharacter(std::string_view value) noexcept
        {
            return std::any_of(value.begin(), value.end(), [](char character) {
                const unsigned char byte = static_cast<unsigned char>(character);
                return byte < 0x20U || byte == 0x7FU;
            });
        }

        bool isValidOperationId(std::wstring_view operationId) noexcept
        {
            if (operationId.empty() || operationId.size() > maximumOperationIdCodeUnits)
            {
                return false;
            }
            return std::none_of(operationId.begin(), operationId.end(), [](wchar_t character) {
                return character < 0x20 || character == 0x7F;
            });
        }

        bool isValidPathAndQuery(std::string_view value) noexcept
        {
            if (value.empty() || value.size() > maximumPathAndQueryBytes ||
                value.front() != '/' || value.starts_with("//") ||
                value.find('#') != std::string_view::npos ||
                value.find('\\') != std::string_view::npos ||
                value.find("://") != std::string_view::npos ||
                value.find("/../") != std::string_view::npos ||
                value.ends_with("/..") || hasControlCharacter(value))
            {
                return false;
            }
            return true;
        }

        bool isValidIdempotencyKey(std::string_view value) noexcept
        {
            if (value.size() < 8U || value.size() > 160U)
            {
                return false;
            }
            return std::none_of(value.begin(), value.end(), [](char character) {
                const unsigned char byte = static_cast<unsigned char>(character);
                return byte <= 0x20U || byte >= 0x7FU;
            });
        }

        bool isValidBearerToken(std::string_view value) noexcept
        {
            return !value.empty() && value.size() <= maximumBearerTokenBytes &&
                std::none_of(value.begin(), value.end(), [](char character) {
                    const unsigned char byte = static_cast<unsigned char>(character);
                    return byte <= 0x20U || byte == 0x7FU;
                });
        }

        bool isValidRequestId(std::string_view value) noexcept
        {
            return value.size() <= maximumRequestIdBytes && !hasControlCharacter(value);
        }

        [[noreturn]] void throwInvalidRequest(
            std::wstring_view operationId,
            std::string message)
        {
            throw ModdingFlowApiException(
                ModdingFlowApiErrorCode::InvalidRequest,
                std::move(message),
                std::wstring(operationId));
        }

        std::optional<std::chrono::seconds> parseRetryAfter(
            const ModdingFlowHttpResponse& response,
            const std::optional<ModdingFlowProblemDetails>& problem,
            std::chrono::seconds maximum)
        {
            std::optional<std::uint64_t> seconds;
            const std::vector<std::string_view> values = headerValues(response, "retry-after");
            if (values.size() > 1U)
            {
                throw std::runtime_error("ModdingFlow response contains duplicate Retry-After headers.");
            }
            if (!values.empty())
            {
                const std::string_view value = values.front();
                std::uint64_t parsed = 0;
                const auto [end, error] = std::from_chars(
                    value.data(),
                    value.data() + value.size(),
                    parsed);
                if (error != std::errc{} || end != value.data() + value.size())
                {
                    throw std::runtime_error("ModdingFlow Retry-After header is invalid.");
                }
                seconds = parsed;
            }
            if (problem && problem->retryAfterSeconds)
            {
                if (seconds && *seconds != *problem->retryAfterSeconds)
                {
                    throw std::runtime_error("ModdingFlow retry delays are inconsistent.");
                }
                seconds = *problem->retryAfterSeconds;
            }
            if (!seconds)
            {
                return std::nullopt;
            }

            const auto bounded = std::min<std::uint64_t>(
                *seconds,
                static_cast<std::uint64_t>(std::max<std::int64_t>(0, maximum.count())));
            return std::chrono::seconds(bounded);
        }

        ModdingFlowApiErrorCode statusErrorCode(
            std::uint16_t status,
            const std::optional<ModdingFlowProblemDetails>& problem) noexcept
        {
            if (status == 401U)
            {
                return ModdingFlowApiErrorCode::Unauthorized;
            }
            if (status == 403U)
            {
                return ModdingFlowApiErrorCode::Forbidden;
            }
            if (status == 404U || status == 410U)
            {
                return ModdingFlowApiErrorCode::NotFound;
            }
            if (status == 409U && problem)
            {
                const std::string& code = problem->code;
                if (code == "idempotency_conflict")
                {
                    return ModdingFlowApiErrorCode::IdempotencyMismatch;
                }
                if (code == "idempotency_in_progress")
                {
                    return ModdingFlowApiErrorCode::IdempotencyInProgress;
                }
                if (code == "idempotency_replay_unavailable")
                {
                    return ModdingFlowApiErrorCode::IdempotencyReplayUnavailable;
                }
            }
            if (status == 429U)
            {
                return ModdingFlowApiErrorCode::RateLimited;
            }
            if (status >= 500U)
            {
                return ModdingFlowApiErrorCode::ServerFailure;
            }
            if (status >= 400U && status < 500U)
            {
                return ModdingFlowApiErrorCode::InvalidRequest;
            }
            return ModdingFlowApiErrorCode::ProtocolFailure;
        }

        bool isRetryableStatus(
            std::uint16_t status,
            const std::optional<ModdingFlowProblemDetails>& problem,
            ModdingFlowApiRetryMode retry) noexcept
        {
            if (retry == ModdingFlowApiRetryMode::Never)
            {
                return false;
            }
            if (status == 429U || status >= 500U)
            {
                return true;
            }
            return retry == ModdingFlowApiRetryMode::Idempotent && status == 409U &&
                problem && problem->code == "idempotency_in_progress" && problem->retryable;
        }

        bool isRetryableTransportFailure(
            const ModdingFlowHttpException& exception,
            ModdingFlowApiRetryMode retry) noexcept
        {
            if (retry == ModdingFlowApiRetryMode::Never)
            {
                return false;
            }
            switch (exception.kind())
            {
            case ModdingFlowHttpFailureKind::DefinitelyNotSent:
            case ModdingFlowHttpFailureKind::Ambiguous:
            case ModdingFlowHttpFailureKind::Timeout:
                return true;
            case ModdingFlowHttpFailureKind::Security:
            case ModdingFlowHttpFailureKind::Protocol:
            case ModdingFlowHttpFailureKind::ResponseTooLarge:
                return false;
            }
            return false;
        }

        ModdingFlowApiErrorCode transportErrorCode(
            ModdingFlowHttpFailureKind kind) noexcept
        {
            switch (kind)
            {
            case ModdingFlowHttpFailureKind::Timeout:
                return ModdingFlowApiErrorCode::Timeout;
            case ModdingFlowHttpFailureKind::Security:
                return ModdingFlowApiErrorCode::SecurityFailure;
            case ModdingFlowHttpFailureKind::Protocol:
            case ModdingFlowHttpFailureKind::ResponseTooLarge:
                return ModdingFlowApiErrorCode::ProtocolFailure;
            case ModdingFlowHttpFailureKind::DefinitelyNotSent:
            case ModdingFlowHttpFailureKind::Ambiguous:
                return ModdingFlowApiErrorCode::TransportFailure;
            }
            return ModdingFlowApiErrorCode::TransportFailure;
        }

        void sleepForRetry(
            const ModdingFlowPublicApiClientOptions& options,
            std::chrono::milliseconds delay)
        {
            if (options.sleep)
            {
                options.sleep(delay);
            }
            else
            {
                std::this_thread::sleep_for(delay);
            }
        }

        std::chrono::milliseconds fallbackRetryDelay(std::size_t attempt) noexcept
        {
            return std::chrono::milliseconds(
                std::min<std::size_t>(attempt * 100U, 1000U));
        }
    }

    ModdingFlowApiException::ModdingFlowApiException(
        ModdingFlowApiErrorCode code,
        std::string message,
        std::wstring operationId,
        std::uint16_t statusCode,
        std::optional<ModdingFlowProblemDetails> problem,
        std::optional<std::chrono::seconds> retryAfter)
        : std::runtime_error(std::move(message)),
          code_(code),
          statusCode_(statusCode),
          operationId_(std::move(operationId)),
          problem_(std::move(problem)),
          retryAfter_(retryAfter)
    {
    }

    ModdingFlowApiErrorCode ModdingFlowApiException::code() const noexcept
    {
        return code_;
    }

    std::uint16_t ModdingFlowApiException::statusCode() const noexcept
    {
        return statusCode_;
    }

    const std::wstring& ModdingFlowApiException::operationId() const noexcept
    {
        return operationId_;
    }

    const std::optional<ModdingFlowProblemDetails>& ModdingFlowApiException::problem() const noexcept
    {
        return problem_;
    }

    std::optional<std::chrono::seconds> ModdingFlowApiException::retryAfter() const noexcept
    {
        return retryAfter_;
    }

    ModdingFlowAuthAccessTokenProvider::ModdingFlowAuthAccessTokenProvider(
        ModdingFlowAuthService& authService) noexcept
        : authService_(authService)
    {
    }

    std::string ModdingFlowAuthAccessTokenProvider::getAccessToken(
        std::string_view requiredScope,
        std::wstring_view operationId,
        bool forceRefresh)
    {
        return authService_.getAccessToken(requiredScope, operationId, forceRefresh);
    }

    ModdingFlowPublicApiClient::ModdingFlowPublicApiClient(
        IModdingFlowHttpTransport& transport,
        IModdingFlowAccessTokenProvider* accessTokens,
        ModdingFlowPublicApiClientOptions options)
        : transport_(transport),
          accessTokens_(accessTokens),
          options_(std::move(options))
    {
        if (options_.maximumAttempts < 2U || options_.maximumAttempts > 5U ||
            options_.maximumRetryAfter.count() < 0 ||
            options_.jsonLimits.maximumBytes == 0U)
        {
            throw std::invalid_argument("ModdingFlow Public API client options are invalid.");
        }
    }

    ModdingFlowPublicApiResponse ModdingFlowPublicApiClient::execute(
        const ModdingFlowPublicApiRequest& request)
    {
        if (!isValidOperationId(request.operationId))
        {
            throwInvalidRequest(request.operationId, "ModdingFlow operation id is invalid.");
        }
        if (!isValidPathAndQuery(request.pathAndQuery))
        {
            throwInvalidRequest(request.operationId, "ModdingFlow API path is invalid.");
        }
        if (request.body.size() > maximumRequestBodyBytes ||
            request.maximumResponseBytes == 0U ||
            request.maximumResponseBytes > options_.jsonLimits.maximumBytes)
        {
            throwInvalidRequest(request.operationId, "ModdingFlow API size limit is invalid.");
        }
        if (request.method == ModdingFlowHttpMethod::Get &&
            (!request.body.empty() || !request.idempotencyKey.empty() ||
             request.retry == ModdingFlowApiRetryMode::Idempotent))
        {
            throwInvalidRequest(request.operationId, "ModdingFlow GET request contract is invalid.");
        }
        if (request.method == ModdingFlowHttpMethod::Post &&
            request.retry == ModdingFlowApiRetryMode::ReadOnly)
        {
            throwInvalidRequest(request.operationId, "ModdingFlow POST request cannot use read-only retry mode.");
        }
        if (request.retry == ModdingFlowApiRetryMode::Idempotent &&
            !isValidIdempotencyKey(request.idempotencyKey))
        {
            throwInvalidRequest(request.operationId, "ModdingFlow idempotency key is invalid.");
        }
        if (!request.idempotencyKey.empty() && !isValidIdempotencyKey(request.idempotencyKey))
        {
            throwInvalidRequest(request.operationId, "ModdingFlow idempotency key is invalid.");
        }
        if (request.auth == ModdingFlowApiAuthMode::BearerRequired && accessTokens_ == nullptr)
        {
            throwInvalidRequest(request.operationId, "ModdingFlow access-token provider is missing.");
        }
        if (request.auth == ModdingFlowApiAuthMode::BearerRequired &&
            (!isValidBearerToken(request.requiredScope) || request.requiredScope.size() > 256U))
        {
            throwInvalidRequest(request.operationId, "ModdingFlow required scope is invalid.");
        }
        if (request.method == ModdingFlowHttpMethod::Post)
        {
            if (request.body.empty())
            {
                throwInvalidRequest(request.operationId, "ModdingFlow JSON request body is missing.");
            }
            try
            {
                ModdingFlowJsonLimits requestLimits = options_.jsonLimits;
                requestLimits.maximumBytes = maximumRequestBodyBytes;
                static_cast<void>(parseModdingFlowJson(request.body, requestLimits));
            }
            catch (const std::exception&)
            {
                throwInvalidRequest(request.operationId, "ModdingFlow JSON request body is malformed.");
            }
        }

        bool forceRefresh = false;
        bool refreshedAfterUnauthorized = false;
        for (std::size_t attempt = 1U; attempt <= options_.maximumAttempts; ++attempt)
        {
            ModdingFlowHttpRequest httpRequest;
            SensitiveHttpRequestGuard sensitiveRequestGuard(httpRequest);
            httpRequest.method = request.method;
            httpRequest.url = std::string(moddingFlowPublicApiOrigin) + request.pathAndQuery;
            httpRequest.headers.push_back({"accept", "application/json"});
            if (request.method == ModdingFlowHttpMethod::Post)
            {
                httpRequest.headers.push_back({"content-type", "application/json"});
            }
            if (!request.idempotencyKey.empty())
            {
                httpRequest.headers.push_back({"idempotency-key", request.idempotencyKey});
            }
            if (request.auth == ModdingFlowApiAuthMode::BearerRequired)
            {
                std::string token;
                SensitiveStringGuard tokenGuard(token);
                try
                {
                    token = accessTokens_->getAccessToken(
                        request.requiredScope,
                        request.operationId,
                        forceRefresh);
                }
                catch (const std::exception&)
                {
                    throw ModdingFlowApiException(
                        ModdingFlowApiErrorCode::Unauthorized,
                        "ModdingFlow access token could not be obtained.",
                        request.operationId,
                        401U);
                }
                if (!isValidBearerToken(token))
                {
                    throw ModdingFlowApiException(
                        ModdingFlowApiErrorCode::SecurityFailure,
                        "ModdingFlow access token was invalid.",
                        request.operationId);
                }
                httpRequest.headers.push_back({"authorization", {}});
                std::string& authorization = httpRequest.headers.back().value;
                authorization.reserve(7U + token.size());
                authorization.append("Bearer ");
                authorization.append(token);
            }
            httpRequest.body = request.body;
            httpRequest.operationId = request.operationId;
            httpRequest.policy = options_.transport;
            httpRequest.maximumResponseBodyBytes = request.maximumResponseBytes;

            ModdingFlowHttpResponse response;
            try
            {
                response = transport_.send(httpRequest);
            }
            catch (const ModdingFlowHttpException& exception)
            {
                if (attempt < options_.maximumAttempts &&
                    isRetryableTransportFailure(exception, request.retry))
                {
                    forceRefresh = false;
                    sleepForRetry(options_, fallbackRetryDelay(attempt));
                    continue;
                }
                throw ModdingFlowApiException(
                    transportErrorCode(exception.kind()),
                    "ModdingFlow HTTP transport failed.",
                    request.operationId);
            }
            catch (const std::exception&)
            {
                throw ModdingFlowApiException(
                    ModdingFlowApiErrorCode::TransportFailure,
                    "ModdingFlow HTTP transport failed.",
                    request.operationId);
            }

            if (response.body.size() > request.maximumResponseBytes)
            {
                throw ModdingFlowApiException(
                    ModdingFlowApiErrorCode::ProtocolFailure,
                    "ModdingFlow response exceeded its size limit.",
                    request.operationId,
                    response.statusCode);
            }

            const std::vector<std::string_view> requestIds = headerValues(response, "x-request-id");
            if (requestIds.size() > 1U ||
                (!requestIds.empty() && !isValidRequestId(requestIds.front())))
            {
                throw ModdingFlowApiException(
                    ModdingFlowApiErrorCode::ProtocolFailure,
                    "ModdingFlow response correlation header is invalid.",
                    request.operationId,
                    response.statusCode);
            }

            std::optional<ModdingFlowProblemDetails> problem;
            std::optional<std::chrono::seconds> retryAfter;
            if (response.statusCode != 200U)
            {
                try
                {
                    const std::vector<std::string_view> contentTypes =
                        headerValues(response, "content-type");
                    if (contentTypes.size() != 1U ||
                        !isProblemContentType(contentTypes.front()))
                    {
                        throw std::runtime_error(
                            "ModdingFlow error response content type is invalid.");
                    }
                    ModdingFlowJsonLimits problemLimits = options_.jsonLimits;
                    problemLimits.maximumBytes = request.maximumResponseBytes;
                    problem = parseModdingFlowProblemDetails(response, problemLimits);
                    if (!problem ||
                        (!requestIds.empty() && problem->requestId != requestIds.front()))
                    {
                        throw std::runtime_error(
                            "ModdingFlow Problem Details correlation is invalid.");
                    }
                    retryAfter = parseRetryAfter(
                        response,
                        problem,
                        options_.maximumRetryAfter);
                }
                catch (const std::exception& exception)
                {
                    throw ModdingFlowApiException(
                        ModdingFlowApiErrorCode::ProtocolFailure,
                        exception.what(),
                        request.operationId,
                        response.statusCode);
                }

                // A response must satisfy the same strict Problem Details and
                // correlation contract before it is allowed to trigger a
                // credential refresh. This keeps malformed 401 responses from
                // causing an auth-side effect.
                if (response.statusCode == 401U &&
                    request.auth == ModdingFlowApiAuthMode::BearerRequired &&
                    !refreshedAfterUnauthorized && attempt < options_.maximumAttempts)
                {
                    refreshedAfterUnauthorized = true;
                    forceRefresh = true;
                    continue;
                }

                if (attempt < options_.maximumAttempts &&
                    isRetryableStatus(response.statusCode, problem, request.retry))
                {
                    forceRefresh = false;
                    const std::chrono::milliseconds delay = retryAfter
                        ? std::chrono::duration_cast<std::chrono::milliseconds>(*retryAfter)
                        : fallbackRetryDelay(attempt);
                    sleepForRetry(options_, delay);
                    continue;
                }

                const ModdingFlowApiErrorCode errorCode =
                    statusErrorCode(response.statusCode, problem);
                throw ModdingFlowApiException(
                    errorCode,
                    "ModdingFlow API request failed.",
                    request.operationId,
                    response.statusCode,
                    std::move(problem),
                    retryAfter);
            }

            try
            {
                const std::vector<std::string_view> contentTypes =
                    headerValues(response, "content-type");
                if (contentTypes.size() != 1U || !isJsonContentType(contentTypes.front()))
                {
                    throw std::runtime_error("ModdingFlow success response content type is invalid.");
                }
                ModdingFlowJsonLimits limits = options_.jsonLimits;
                limits.maximumBytes = request.maximumResponseBytes;
                return {
                    parseModdingFlowJson(response.body, limits),
                    request.operationId,
                    requestIds.empty() ? std::string{} : std::string(requestIds.front())};
            }
            catch (const ModdingFlowApiException&)
            {
                throw;
            }
            catch (const std::exception& exception)
            {
                throw ModdingFlowApiException(
                    ModdingFlowApiErrorCode::ProtocolFailure,
                    exception.what(),
                    request.operationId,
                    response.statusCode);
            }
        }

        throw ModdingFlowApiException(
            ModdingFlowApiErrorCode::TransportFailure,
            "ModdingFlow API retry budget was exhausted.",
            request.operationId);
    }
}
