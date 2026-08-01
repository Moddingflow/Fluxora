#include "FluxoraCore/Services/ModdingFlowPublicApiClient.hpp"

#include <gtest/gtest.h>

#include <deque>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        class RecordingPublicApiTransport final : public IModdingFlowHttpTransport
        {
        public:
            ModdingFlowHttpResponse send(const ModdingFlowHttpRequest& request) override
            {
                requests.push_back(request);
                if (responses.empty())
                {
                    throw std::runtime_error("No response configured.");
                }
                ModdingFlowHttpResponse response = std::move(responses.front());
                responses.pop_front();
                return response;
            }

            std::vector<ModdingFlowHttpRequest> requests;
            std::deque<ModdingFlowHttpResponse> responses;
        };

        ModdingFlowHttpResponse jsonResponse(
            std::uint16_t statusCode,
            std::string body)
        {
            return {
                statusCode,
                {{"content-type", "application/json"}, {"x-request-id", "request-1"}},
                std::move(body)};
        }

        ModdingFlowHttpResponse problemResponse(
            std::uint16_t statusCode,
            std::string code,
            bool retryable = false,
            std::optional<std::uint32_t> retryAfter = std::nullopt)
        {
            std::string body =
                R"({"type":"https://moddingflow.com/problems/)" + code +
                R"(","title":"Request failed","detail":"Request failed","status":)" +
                std::to_string(statusCode) +
                R"(,"instance":"/v1/test","code":")" + code +
                R"(","machine_code":")" + code +
                R"(","request_id":"request-1","trace_id":"trace-1","ok":false,"retryable":)" +
                (retryable ? "true" : "false");
            if (retryAfter)
            {
                body += R"(,"retry_after_seconds":)" + std::to_string(*retryAfter);
            }
            body += R"(,"error":{"machine_code":")" + code +
                R"(","http_status":)" + std::to_string(statusCode) +
                R"(,"message":"Request failed","trace_id":"trace-1","request_id":"request-1"}})";
            return {
                statusCode,
                {{"content-type", "application/problem+json"}, {"x-request-id", "request-1"}},
                std::move(body)};
        }

        class ScriptedPublicApiTransport final : public IModdingFlowHttpTransport
        {
        public:
            ModdingFlowHttpResponse send(const ModdingFlowHttpRequest& request) override
            {
                requests.push_back(request);
                if (actions.empty())
                {
                    throw std::runtime_error("No action configured.");
                }
                auto action = std::move(actions.front());
                actions.pop_front();
                return action(request);
            }

            std::vector<ModdingFlowHttpRequest> requests;
            std::deque<std::function<ModdingFlowHttpResponse(const ModdingFlowHttpRequest&)>> actions;
        };

        class RecordingTokenProvider final : public IModdingFlowAccessTokenProvider
        {
        public:
            std::string getAccessToken(
                std::string_view requiredScope,
                std::wstring_view operationId,
                bool forceRefresh) override
            {
                scopes.emplace_back(requiredScope);
                operationIds.emplace_back(operationId);
                forceRefreshes.push_back(forceRefresh);
                if (failure)
                {
                    throw std::runtime_error(*failure);
                }
                const std::size_t index = std::min(tokens.size() - 1U, forceRefreshes.size() - 1U);
                return tokens[index];
            }

            std::vector<std::string> tokens{"token-one"};
            std::optional<std::string> failure;
            std::vector<std::string> scopes;
            std::vector<std::wstring> operationIds;
            std::vector<bool> forceRefreshes;
        };

        std::string headerValue(
            const ModdingFlowHttpRequest& request,
            std::string_view name)
        {
            for (const ModdingFlowHttpHeader& header : request.headers)
            {
                if (header.name == name)
                {
                    return header.value;
                }
            }
            return {};
        }
    }

    TEST(ModdingFlowPublicApiClientTests, AnonymousGetUsesFixedOriginAndPropagatesOperationId)
    {
        RecordingPublicApiTransport transport;
        transport.responses.push_back(jsonResponse(200, R"({"ok":true,"data":{"items":[]}})"));
        ModdingFlowPublicApiClient client(transport);

        const ModdingFlowPublicApiResponse response = client.execute({
            .method = ModdingFlowHttpMethod::Get,
            .pathAndQuery = "/games",
            .auth = ModdingFlowApiAuthMode::Anonymous,
            .retry = ModdingFlowApiRetryMode::ReadOnly,
            .operationId = L"operation-catalog-games"});

        ASSERT_EQ(transport.requests.size(), 1U);
        const ModdingFlowHttpRequest& request = transport.requests.front();
        EXPECT_EQ(request.url, "https://moddingflow.com/v1/games");
        EXPECT_EQ(request.operationId, L"operation-catalog-games");
        EXPECT_TRUE(request.body.empty());
        EXPECT_EQ(response.operationId, L"operation-catalog-games");
        EXPECT_EQ(response.requestId, "request-1");
        ASSERT_TRUE(response.body.find(L"ok") != nullptr);
        EXPECT_TRUE(response.body.find(L"ok")->asBoolean());
    }

    TEST(ModdingFlowPublicApiClientTests, MapsPublicApiStatusesAndTypedIdempotencyConflicts)
    {
        const std::vector<std::pair<std::uint16_t, ModdingFlowApiErrorCode>> statusCases = {
            {400U, ModdingFlowApiErrorCode::InvalidRequest},
            {401U, ModdingFlowApiErrorCode::Unauthorized},
            {403U, ModdingFlowApiErrorCode::Forbidden},
            {404U, ModdingFlowApiErrorCode::NotFound},
            {410U, ModdingFlowApiErrorCode::NotFound},
            {422U, ModdingFlowApiErrorCode::InvalidRequest},
            {429U, ModdingFlowApiErrorCode::RateLimited},
            {500U, ModdingFlowApiErrorCode::ServerFailure}};
        for (const auto [status, expected] : statusCases)
        {
            RecordingPublicApiTransport transport;
            transport.responses.push_back(problemResponse(status, "failure"));
            ModdingFlowPublicApiClient client(transport);
            try
            {
                static_cast<void>(client.execute({
                    .pathAndQuery = "/games",
                    .auth = ModdingFlowApiAuthMode::Anonymous,
                    .retry = ModdingFlowApiRetryMode::Never,
                    .operationId = L"operation-status"}));
                FAIL() << "Expected typed status failure.";
            }
            catch (const ModdingFlowApiException& exception)
            {
                EXPECT_EQ(exception.code(), expected);
                EXPECT_EQ(exception.statusCode(), status);
                EXPECT_EQ(exception.operationId(), L"operation-status");
            }
        }

        RecordingPublicApiTransport transport;
        transport.responses.push_back(problemResponse(409U, "idempotency_conflict"));
        ModdingFlowPublicApiClient client(transport);
        try
        {
            static_cast<void>(client.execute({
                .method = ModdingFlowHttpMethod::Post,
                .pathAndQuery = "/install-plans:resolve",
                .body = "{}",
                .auth = ModdingFlowApiAuthMode::Anonymous,
                .retry = ModdingFlowApiRetryMode::Idempotent,
                .idempotencyKey = "plan-key-0001",
                .operationId = L"operation-conflict"}));
            FAIL() << "Expected idempotency mismatch.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::IdempotencyMismatch)
                << exception.what();
            ASSERT_TRUE(exception.problem().has_value());
            EXPECT_EQ(exception.problem()->code, "idempotency_conflict");
        }
    }

    TEST(ModdingFlowPublicApiClientTests, Bearer401CoordinatesOneForcedRefreshAndReplay)
    {
        RecordingPublicApiTransport transport;
        transport.responses.push_back(problemResponse(401U, "invalid_token"));
        transport.responses.push_back(jsonResponse(200U, R"({"ok":true,"data":{}})"));
        RecordingTokenProvider tokens;
        tokens.tokens = {"token-before", "token-after"};
        ModdingFlowPublicApiClient client(transport, &tokens);

        static_cast<void>(client.execute({
            .pathAndQuery = "/me/profile",
            .auth = ModdingFlowApiAuthMode::BearerRequired,
            .requiredScope = "mods:read",
            .retry = ModdingFlowApiRetryMode::ReadOnly,
            .operationId = L"operation-refresh"}));

        ASSERT_EQ(tokens.forceRefreshes.size(), 2U);
        EXPECT_FALSE(tokens.forceRefreshes[0]);
        EXPECT_TRUE(tokens.forceRefreshes[1]);
        EXPECT_EQ(tokens.operationIds[0], L"operation-refresh");
        ASSERT_EQ(transport.requests.size(), 2U);
        EXPECT_EQ(headerValue(transport.requests[0], "authorization"), "Bearer token-before");
        EXPECT_EQ(headerValue(transport.requests[1], "authorization"), "Bearer token-after");
        EXPECT_EQ(transport.requests[0].operationId, transport.requests[1].operationId);
    }

    TEST(ModdingFlowPublicApiClientTests, Bearer401RefreshIsNeverRepeated)
    {
        RecordingPublicApiTransport transport;
        transport.responses.push_back(problemResponse(401U, "invalid_token"));
        transport.responses.push_back(problemResponse(401U, "invalid_token"));
        RecordingTokenProvider tokens;
        tokens.tokens = {"token-before", "token-after", "token-never-used"};
        ModdingFlowPublicApiClient client(transport, &tokens, {.maximumAttempts = 3U});

        try
        {
            static_cast<void>(client.execute({
                .pathAndQuery = "/me/profile",
                .auth = ModdingFlowApiAuthMode::BearerRequired,
                .requiredScope = "mods:read",
                .retry = ModdingFlowApiRetryMode::ReadOnly,
                .operationId = L"operation-refresh-once"}));
            FAIL() << "Expected second 401 to terminate replay.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::Unauthorized);
        }
        EXPECT_EQ(tokens.forceRefreshes, std::vector<bool>({false, true}));
        EXPECT_EQ(transport.requests.size(), 2U);
    }

    TEST(ModdingFlowPublicApiClientTests, MalformedBearer401CannotTriggerCredentialRefresh)
    {
        RecordingPublicApiTransport transport;
        transport.responses.push_back({
            401U,
            {{"content-type", "text/plain"}, {"x-request-id", "request-1"}},
            "unauthorized"});
        RecordingTokenProvider tokens;
        ModdingFlowPublicApiClient client(transport, &tokens);

        try
        {
            static_cast<void>(client.execute({
                .pathAndQuery = "/me/profile",
                .auth = ModdingFlowApiAuthMode::BearerRequired,
                .requiredScope = "mods:read",
                .retry = ModdingFlowApiRetryMode::ReadOnly,
                .operationId = L"operation-malformed-401"}));
            FAIL() << "Expected malformed 401 rejection.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::ProtocolFailure);
        }

        EXPECT_EQ(tokens.forceRefreshes, std::vector<bool>({false}));
        EXPECT_EQ(transport.requests.size(), 1U);
    }

    TEST(ModdingFlowPublicApiClientTests, Anonymous401NeverConsultsTokenProvider)
    {
        RecordingPublicApiTransport transport;
        transport.responses.push_back(problemResponse(401U, "authentication_required"));
        RecordingTokenProvider tokens;
        ModdingFlowPublicApiClient client(transport, &tokens);

        EXPECT_THROW(
            static_cast<void>(client.execute({
                .pathAndQuery = "/games",
                .auth = ModdingFlowApiAuthMode::Anonymous,
                .retry = ModdingFlowApiRetryMode::ReadOnly,
                .operationId = L"operation-anonymous"})),
            ModdingFlowApiException);
        EXPECT_TRUE(tokens.forceRefreshes.empty());
        ASSERT_EQ(transport.requests.size(), 1U);
        EXPECT_TRUE(headerValue(transport.requests.front(), "authorization").empty());
    }

    TEST(ModdingFlowPublicApiClientTests, ReadOnlyTimeoutRetriesWithinBoundAndPreservesOperationId)
    {
        ScriptedPublicApiTransport transport;
        transport.actions.push_back([](const ModdingFlowHttpRequest&) -> ModdingFlowHttpResponse {
            throw ModdingFlowHttpException(
                ModdingFlowHttpFailureKind::Timeout,
                true,
                "timeout");
        });
        transport.actions.push_back([](const ModdingFlowHttpRequest&) {
            return jsonResponse(200U, R"({"ok":true,"data":{}})");
        });
        std::vector<std::chrono::milliseconds> sleeps;
        ModdingFlowPublicApiClient client(transport, nullptr, {
            .maximumAttempts = 2U,
            .sleep = [&](std::chrono::milliseconds delay) { sleeps.push_back(delay); }});

        static_cast<void>(client.execute({
            .pathAndQuery = "/games",
            .auth = ModdingFlowApiAuthMode::Anonymous,
            .retry = ModdingFlowApiRetryMode::ReadOnly,
            .operationId = L"operation-timeout"}));

        ASSERT_EQ(transport.requests.size(), 2U);
        EXPECT_EQ(transport.requests[0].operationId, L"operation-timeout");
        EXPECT_EQ(transport.requests[1].operationId, L"operation-timeout");
        ASSERT_EQ(sleeps.size(), 1U);
        EXPECT_EQ(sleeps.front(), std::chrono::milliseconds(100));
    }

    TEST(ModdingFlowPublicApiClientTests, UnsafePostNeverBlindlyRetriesAmbiguousFailure)
    {
        ScriptedPublicApiTransport transport;
        transport.actions.push_back([](const ModdingFlowHttpRequest&) -> ModdingFlowHttpResponse {
            throw ModdingFlowHttpException(
                ModdingFlowHttpFailureKind::Ambiguous,
                true,
                "ambiguous");
        });
        ModdingFlowPublicApiClient client(transport, nullptr, {.maximumAttempts = 3U});

        try
        {
            static_cast<void>(client.execute({
                .method = ModdingFlowHttpMethod::Post,
                .pathAndQuery = "/test",
                .body = "{}",
                .auth = ModdingFlowApiAuthMode::Anonymous,
                .retry = ModdingFlowApiRetryMode::Never,
                .operationId = L"operation-unsafe"}));
            FAIL() << "Expected ambiguous transport failure.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::TransportFailure);
        }
        EXPECT_EQ(transport.requests.size(), 1U);
    }

    TEST(ModdingFlowPublicApiClientTests, IdempotentPostRetriesAmbiguousFailureWithSameKey)
    {
        ScriptedPublicApiTransport transport;
        transport.actions.push_back([](const ModdingFlowHttpRequest&) -> ModdingFlowHttpResponse {
            throw ModdingFlowHttpException(
                ModdingFlowHttpFailureKind::Ambiguous,
                true,
                "ambiguous");
        });
        transport.actions.push_back([](const ModdingFlowHttpRequest&) {
            return jsonResponse(200U, R"({"ok":true,"data":{}})");
        });
        ModdingFlowPublicApiClient client(transport, nullptr, {
            .maximumAttempts = 2U,
            .sleep = [](std::chrono::milliseconds) {}});

        static_cast<void>(client.execute({
            .method = ModdingFlowHttpMethod::Post,
            .pathAndQuery = "/install-plans:resolve",
            .body = "{}",
            .auth = ModdingFlowApiAuthMode::Anonymous,
            .retry = ModdingFlowApiRetryMode::Idempotent,
            .idempotencyKey = "plan-key-0001",
            .operationId = L"operation-idempotent"}));

        ASSERT_EQ(transport.requests.size(), 2U);
        EXPECT_EQ(headerValue(transport.requests[0], "idempotency-key"), "plan-key-0001");
        EXPECT_EQ(headerValue(transport.requests[1], "idempotency-key"), "plan-key-0001");
    }

    TEST(ModdingFlowPublicApiClientTests, RetryAfterIsCappedBeforeSafeReplay)
    {
        RecordingPublicApiTransport transport;
        ModdingFlowHttpResponse limited = problemResponse(429U, "rate_limited", true);
        limited.headers.push_back({"retry-after", "999"});
        transport.responses.push_back(std::move(limited));
        transport.responses.push_back(jsonResponse(200U, R"({"ok":true,"data":{}})"));
        std::vector<std::chrono::milliseconds> sleeps;
        ModdingFlowPublicApiClient client(transport, nullptr, {
            .maximumAttempts = 2U,
            .maximumRetryAfter = std::chrono::seconds(3),
            .sleep = [&](std::chrono::milliseconds delay) { sleeps.push_back(delay); }});

        static_cast<void>(client.execute({
            .pathAndQuery = "/games",
            .auth = ModdingFlowApiAuthMode::Anonymous,
            .retry = ModdingFlowApiRetryMode::ReadOnly,
            .operationId = L"operation-rate"}));
        ASSERT_EQ(sleeps.size(), 1U);
        EXPECT_EQ(sleeps.front(), std::chrono::seconds(3));
    }

    TEST(ModdingFlowPublicApiClientTests, IdempotencyInProgressRetriesButReplayUnavailableIsTerminal)
    {
        RecordingPublicApiTransport retryTransport;
        retryTransport.responses.push_back(problemResponse(
            409U,
            "idempotency_in_progress",
            true,
            0U));
        retryTransport.responses.push_back(jsonResponse(200U, R"({"ok":true,"data":{}})"));
        ModdingFlowPublicApiClient retryClient(retryTransport, nullptr, {
            .maximumAttempts = 2U,
            .sleep = [](std::chrono::milliseconds) {}});
        static_cast<void>(retryClient.execute({
            .method = ModdingFlowHttpMethod::Post,
            .pathAndQuery = "/install-plans:resolve",
            .body = "{}",
            .auth = ModdingFlowApiAuthMode::Anonymous,
            .retry = ModdingFlowApiRetryMode::Idempotent,
            .idempotencyKey = "in-progress-key-0001",
            .operationId = L"operation-in-progress"}));
        EXPECT_EQ(retryTransport.requests.size(), 2U);

        RecordingPublicApiTransport unavailableTransport;
        unavailableTransport.responses.push_back(problemResponse(
            409U,
            "idempotency_replay_unavailable"));
        ModdingFlowPublicApiClient unavailableClient(unavailableTransport);
        try
        {
            static_cast<void>(unavailableClient.execute({
                .method = ModdingFlowHttpMethod::Post,
                .pathAndQuery = "/install-plans:resolve",
                .body = "{}",
                .auth = ModdingFlowApiAuthMode::Anonymous,
                .retry = ModdingFlowApiRetryMode::Idempotent,
                .idempotencyKey = "unavailable-key-0001",
                .operationId = L"operation-unavailable"}));
            FAIL() << "Expected replay-unavailable failure.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::IdempotencyReplayUnavailable);
        }
        EXPECT_EQ(unavailableTransport.requests.size(), 1U);
    }

    TEST(ModdingFlowPublicApiClientTests, ExhaustedTimeoutBudgetIsTyped)
    {
        ScriptedPublicApiTransport transport;
        for (std::size_t index = 0U; index < 2U; ++index)
        {
            transport.actions.push_back([](const ModdingFlowHttpRequest&) -> ModdingFlowHttpResponse {
                throw ModdingFlowHttpException(
                    ModdingFlowHttpFailureKind::Timeout,
                    true,
                    "timeout");
            });
        }
        ModdingFlowPublicApiClient client(transport, nullptr, {
            .maximumAttempts = 2U,
            .sleep = [](std::chrono::milliseconds) {}});
        try
        {
            static_cast<void>(client.execute({
                .pathAndQuery = "/games",
                .auth = ModdingFlowApiAuthMode::Anonymous,
                .retry = ModdingFlowApiRetryMode::ReadOnly,
                .operationId = L"operation-timeout-final"}));
            FAIL() << "Expected timeout exhaustion.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::Timeout);
            EXPECT_EQ(exception.operationId(), L"operation-timeout-final");
        }
        EXPECT_EQ(transport.requests.size(), 2U);
    }

    TEST(ModdingFlowPublicApiClientTests, StrictParserRejectsMalformedDuplicateAndOversizeJson)
    {
        const std::vector<std::string> malformedBodies = {
            R"({"ok":true)",
            R"({"ok":true,"ok":false})"};
        for (const std::string& body : malformedBodies)
        {
            RecordingPublicApiTransport transport;
            transport.responses.push_back(jsonResponse(200U, body));
            ModdingFlowPublicApiClient client(transport);
            try
            {
                static_cast<void>(client.execute({
                    .pathAndQuery = "/games",
                    .auth = ModdingFlowApiAuthMode::Anonymous,
                    .operationId = L"operation-json"}));
                FAIL() << "Expected malformed JSON rejection.";
            }
            catch (const ModdingFlowApiException& exception)
            {
                EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::ProtocolFailure);
            }
        }

        RecordingPublicApiTransport transport;
        transport.responses.push_back(jsonResponse(200U, R"({"ok":true,"padding":"0123456789"})"));
        ModdingFlowPublicApiClient client(transport);
        try
        {
            static_cast<void>(client.execute({
                .pathAndQuery = "/games",
                .auth = ModdingFlowApiAuthMode::Anonymous,
                .operationId = L"operation-size",
                .maximumResponseBytes = 16U}));
            FAIL() << "Expected response-size rejection.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::ProtocolFailure);
        }
    }

    TEST(ModdingFlowPublicApiClientTests, RejectsOriginEscapeAndDuplicateContentTypeBeforeUse)
    {
        RecordingPublicApiTransport transport;
        ModdingFlowPublicApiClient client(transport);
        EXPECT_THROW(
            static_cast<void>(client.execute({
                .pathAndQuery = "https://evil.invalid/games",
                .auth = ModdingFlowApiAuthMode::Anonymous,
                .operationId = L"operation-origin"})),
            ModdingFlowApiException);
        EXPECT_TRUE(transport.requests.empty());

        EXPECT_THROW(
            static_cast<void>(client.execute({
                .method = ModdingFlowHttpMethod::Post,
                .pathAndQuery = "/install-plans:resolve",
                .body = R"({"unterminated":)",
                .auth = ModdingFlowApiAuthMode::Anonymous,
                .retry = ModdingFlowApiRetryMode::Idempotent,
                .idempotencyKey = "malformed-key-0001",
                .operationId = L"operation-malformed-request"})),
            ModdingFlowApiException);
        EXPECT_TRUE(transport.requests.empty());

        transport.responses.push_back({
            200U,
            {{"content-type", "application/json"}, {"Content-Type", "application/json"}},
            R"({"ok":true})"});
        try
        {
            static_cast<void>(client.execute({
                .pathAndQuery = "/games",
                .auth = ModdingFlowApiAuthMode::Anonymous,
                .operationId = L"operation-content-type"}));
            FAIL() << "Expected duplicate content type rejection.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::ProtocolFailure);
        }
    }

    TEST(ModdingFlowPublicApiClientTests, AuthProviderFailureDoesNotExposeSensitiveExceptionText)
    {
        RecordingPublicApiTransport transport;
        RecordingTokenProvider tokens;
        tokens.failure = "do-not-leak-token-secret";
        ModdingFlowPublicApiClient client(transport, &tokens);
        try
        {
            static_cast<void>(client.execute({
                .pathAndQuery = "/me/profile",
                .auth = ModdingFlowApiAuthMode::BearerRequired,
                .requiredScope = "mods:read",
                .operationId = L"operation-auth-error"}));
            FAIL() << "Expected auth failure.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::Unauthorized);
            EXPECT_EQ(std::string(exception.what()).find("do-not-leak"), std::string::npos);
        }
        EXPECT_TRUE(transport.requests.empty());
    }
}
