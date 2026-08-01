#include "FluxoraCore/Services/ModdingFlowApiResponse.hpp"
#include "FluxoraCore/Services/ModdingFlowHttpTransport.hpp"
#include "FluxoraCore/Services/ModdingFlowJwksIdTokenVerifier.hpp"
#include "FluxoraCore/Services/ModdingFlowOAuthHttpClient.hpp"

#include <gtest/gtest.h>

#include <array>
#include <deque>
#include <string>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <Windows.h>
#include <winhttp.h>
#endif

namespace fluxora::tests
{
    namespace
    {
        class RecordingTransport final : public IModdingFlowHttpTransport
        {
        public:
            ModdingFlowHttpResponse send(const ModdingFlowHttpRequest& request) override
            {
                requests.push_back(request);
                if (responses.empty())
                {
                    throw std::runtime_error("Unexpected HTTP request.");
                }
                ModdingFlowHttpResponse response = std::move(responses.front());
                responses.pop_front();
                return response;
            }

            std::vector<ModdingFlowHttpRequest> requests;
            std::deque<ModdingFlowHttpResponse> responses;
        };

        class ThrowingTransport final : public IModdingFlowHttpTransport
        {
        public:
            explicit ThrowingTransport(ModdingFlowHttpException failureValue)
                : failure(std::move(failureValue))
            {
            }

            ModdingFlowHttpResponse send(const ModdingFlowHttpRequest& request) override
            {
                requests.push_back(request);
                throw failure;
            }

            ModdingFlowHttpException failure;
            std::vector<ModdingFlowHttpRequest> requests;
        };

        bool hasHeader(
            const ModdingFlowHttpRequest& request,
            std::string_view name,
            std::string_view value = {})
        {
            for (const auto& header : request.headers)
            {
                if (header.name == name && (value.empty() || header.value == value))
                {
                    return true;
                }
            }
            return false;
        }

        std::string base64Url(std::string_view value)
        {
            static constexpr char alphabet[] =
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
            std::string result;
            std::uint32_t accumulator = 0;
            int bits = 0;
            for (const unsigned char character : value)
            {
                accumulator = (accumulator << 8) | character;
                bits += 8;
                while (bits >= 6)
                {
                    bits -= 6;
                    result.push_back(alphabet[(accumulator >> bits) & 0x3FU]);
                }
            }
            if (bits > 0)
            {
                result.push_back(alphabet[(accumulator << (6 - bits)) & 0x3FU]);
            }
            return result;
        }
    }

    TEST(ModdingFlowOAuthHttpClientTests, AuthorizationCodeExchangeUsesExactPublicClientForm)
    {
        RecordingTransport transport;
        transport.responses.push_back({
            200,
            {{"content-type", "application/json"}},
            R"({"access_token":"access-value","refresh_token":"refresh-value","id_token":"header.payload.signature","token_type":"Bearer","expires_in":900,"scope":"openid profile:read mods:read files:download install_plans:resolve"})"});
        ModdingFlowOAuthHttpClient client(ModdingFlowConfiguration::production(), transport);

        const ModdingFlowTokenSet tokens = client.exchangeAuthorizationCode({
            "https://moddingflow.com/oauth/token",
            "desktop_mod_manager",
            "http://127.0.0.1:43125/oauth/fluxora/callback",
            "code+value",
            "verifier~._-",
            L"operation-oauth-exchange"});

        ASSERT_EQ(transport.requests.size(), 1U);
        const ModdingFlowHttpRequest& request = transport.requests.front();
        EXPECT_EQ(request.method, ModdingFlowHttpMethod::Post);
        EXPECT_EQ(request.url, "https://moddingflow.com/oauth/token");
        EXPECT_EQ(request.operationId, L"operation-oauth-exchange");
        EXPECT_TRUE(hasHeader(request, "accept", "application/json"));
        EXPECT_TRUE(hasHeader(
            request,
            "content-type",
            "application/x-www-form-urlencoded; charset=UTF-8"));
        EXPECT_FALSE(hasHeader(request, "authorization"));
        EXPECT_FALSE(hasHeader(request, "cookie"));
        EXPECT_EQ(
            request.body,
            "grant_type=authorization_code&client_id=desktop_mod_manager&"
            "redirect_uri=http%3A%2F%2F127.0.0.1%3A43125%2Foauth%2Ffluxora%2Fcallback&"
            "code=code%2Bvalue&code_verifier=verifier~._-");
        EXPECT_EQ(tokens.accessToken, "access-value");
        EXPECT_EQ(tokens.refreshToken, "refresh-value");
        EXPECT_EQ(tokens.idToken, "header.payload.signature");
        EXPECT_EQ(tokens.expiresIn, std::chrono::seconds(900));
        EXPECT_EQ(tokens.grantedScopes.size(), 5U);
    }

    TEST(ModdingFlowOAuthHttpClientTests, RefreshPostsOnceAndClassifiesInvalidGrant)
    {
        RecordingTransport transport;
        transport.responses.push_back({
            400,
            {{"content-type", "application/json"}},
            R"({"error":"invalid_grant","error_description":"rotated token is no longer valid"})"});
        ModdingFlowOAuthHttpClient client(ModdingFlowConfiguration::production(), transport);

        try
        {
            static_cast<void>(client.refreshAccessToken({
                "https://moddingflow.com/oauth/token",
                "desktop_mod_manager",
                "refresh/value+secret",
                L"operation-oauth-refresh"}));
            FAIL() << "Expected invalid_grant to be classified.";
        }
        catch (const ModdingFlowOAuthException& exception)
        {
            EXPECT_EQ(exception.kind(), ModdingFlowOAuthFailureKind::InvalidGrant);
        }

        ASSERT_EQ(transport.requests.size(), 1U);
        const ModdingFlowHttpRequest& request = transport.requests.front();
        EXPECT_EQ(request.method, ModdingFlowHttpMethod::Post);
        EXPECT_EQ(request.url, "https://moddingflow.com/oauth/token");
        EXPECT_FALSE(hasHeader(request, "authorization"));
        EXPECT_FALSE(hasHeader(request, "cookie"));
        EXPECT_EQ(
            request.body,
            "grant_type=refresh_token&client_id=desktop_mod_manager&"
            "refresh_token=refresh%2Fvalue%2Bsecret");
        EXPECT_EQ(request.body.find("client_secret"), std::string::npos);
    }

    TEST(ModdingFlowApiResponseTests, StrictParserRejectsDuplicateMalformedOversizedAndDeepJson)
    {
        EXPECT_THROW(
            static_cast<void>(parseModdingFlowJson(R"({"kid":"one","kid":"two"})")),
            std::runtime_error);
        EXPECT_THROW(
            static_cast<void>(parseModdingFlowJson(R"({"unterminated":)")),
            std::runtime_error);
        EXPECT_THROW(
            static_cast<void>(parseModdingFlowJson(
                R"({"value":"too large"})",
                {.maximumBytes = 8})),
            std::runtime_error);
        EXPECT_THROW(
            static_cast<void>(parseModdingFlowJson(
                R"({"a":{"b":{"c":true}}})",
                {.maximumDepth = 2})),
            std::runtime_error);
    }

    TEST(ModdingFlowApiResponseTests, ProblemDetailsUsesStableMachineFields)
    {
        const ModdingFlowHttpResponse response{
            429,
            {{"content-type", "application/problem+json; charset=utf-8"}},
            R"({"type":"https://moddingflow.com/problems/rate-limit","title":"Rate limited","status":429,"detail":"localized and unstable","instance":"/v1/me/profile","ok":false,"code":"rate_limited","machine_code":"rate_limited","http_status":429,"request_id":"request-1","trace_id":"trace-1","retryable":true,"docs_slug":"rate-limits","retry_after_seconds":17,"required_scopes":[],"error":{"machine_code":"rate_limited","http_status":429,"message":"localized","trace_id":"trace-1","request_id":"request-1"}})"};

        const auto problem = parseModdingFlowProblemDetails(response);

        ASSERT_TRUE(problem.has_value());
        EXPECT_EQ(problem->status, 429);
        EXPECT_EQ(problem->code, "rate_limited");
        EXPECT_EQ(problem->machineCode, "rate_limited");
        EXPECT_EQ(problem->requestId, "request-1");
        EXPECT_EQ(problem->traceId, "trace-1");
        EXPECT_TRUE(problem->retryable);
        ASSERT_TRUE(problem->retryAfterSeconds.has_value());
        EXPECT_EQ(*problem->retryAfterSeconds, 17U);
    }

    TEST(ModdingFlowApiResponseTests, ProblemDetailsRejectsInconsistentCompatibilityFields)
    {
        const std::vector<std::string> bodies = {
            R"({"type":"https://moddingflow.com/problems/auth","title":"Denied","status":401,"detail":"localized","instance":"/v1/me/profile","ok":false,"code":"invalid_token","machine_code":"different_code","http_status":401,"request_id":"request-1","trace_id":"trace-1","retryable":false,"error":{"machine_code":"different_code","http_status":401,"message":"localized","trace_id":"trace-1","request_id":"request-1"}})",
            R"({"type":"https://moddingflow.com/problems/auth","title":"Denied","status":401,"detail":"localized","instance":"/v1/me/profile","ok":false,"code":"invalid_token","machine_code":"invalid_token","http_status":403,"request_id":"request-1","trace_id":"trace-1","retryable":false,"error":{"machine_code":"invalid_token","http_status":401,"message":"localized","trace_id":"trace-1","request_id":"request-1"}})"};
        for (const std::string& body : bodies)
        {
            EXPECT_THROW(
                static_cast<void>(parseModdingFlowProblemDetails({
                    401,
                    {{"content-type", "application/problem+json"}},
                    body})),
                std::runtime_error);
        }
    }

    TEST(ModdingFlowOAuthHttpClientTests, ProfileUsesFixedEndpointAndParsesStrictIdentityEnvelope)
    {
        RecordingTransport transport;
        transport.responses.push_back({
            200,
            {{"content-type", "application/json"}},
            R"({"ok":true,"data":{"user_id":"7d0d24a4-23d6-4f7f-a2d1-bbd04dfd3d76","nickname":"Valera","mention_tag":"valera","avatar_url":null,"preferred_language":"ru","status":"verified","updated_at":"2026-07-29T08:30:00Z"}})"});
        ModdingFlowOAuthHttpClient client(ModdingFlowConfiguration::production(), transport);

        const ModdingFlowProfile profile = client.fetchCurrentProfile({
            "https://moddingflow.com/v1",
            "memory-only-access-token",
            L"operation-profile"});

        EXPECT_EQ(profile.userId, "7d0d24a4-23d6-4f7f-a2d1-bbd04dfd3d76");
        EXPECT_EQ(profile.displayName, L"Valera");
        ASSERT_EQ(transport.requests.size(), 1U);
        const ModdingFlowHttpRequest& request = transport.requests.front();
        EXPECT_EQ(request.method, ModdingFlowHttpMethod::Get);
        EXPECT_EQ(request.url, "https://moddingflow.com/v1/me/profile");
        EXPECT_TRUE(hasHeader(request, "accept", "application/json"));
        EXPECT_TRUE(hasHeader(request, "authorization", "Bearer memory-only-access-token"));
        EXPECT_FALSE(hasHeader(request, "cookie"));
        EXPECT_TRUE(request.body.empty());
    }

    TEST(ModdingFlowOAuthHttpClientTests, RefreshNeverRetriesAndPreservesPostSendAmbiguity)
    {
        ThrowingTransport notSentTransport(ModdingFlowHttpException(
            ModdingFlowHttpFailureKind::DefinitelyNotSent,
            false,
            "local setup failed"));
        ModdingFlowOAuthHttpClient notSentClient(
            ModdingFlowConfiguration::production(),
            notSentTransport);
        try
        {
            static_cast<void>(notSentClient.refreshAccessToken({
                "https://moddingflow.com/oauth/token",
                "desktop_mod_manager",
                "refresh-one",
                L"operation-refresh-not-sent"}));
            FAIL() << "Expected a pre-send failure.";
        }
        catch (const ModdingFlowOAuthException& exception)
        {
            EXPECT_EQ(exception.kind(), ModdingFlowOAuthFailureKind::RequestNotSent);
        }
        EXPECT_EQ(notSentTransport.requests.size(), 1U);

        ThrowingTransport ambiguousTransport(ModdingFlowHttpException(
            ModdingFlowHttpFailureKind::Timeout,
            true,
            "overall deadline elapsed"));
        ModdingFlowOAuthHttpClient ambiguousClient(
            ModdingFlowConfiguration::production(),
            ambiguousTransport);
        try
        {
            static_cast<void>(ambiguousClient.refreshAccessToken({
                "https://moddingflow.com/oauth/token",
                "desktop_mod_manager",
                "refresh-two",
                L"operation-refresh-timeout"}));
            FAIL() << "Expected an ambiguous timeout.";
        }
        catch (const ModdingFlowOAuthException& exception)
        {
            EXPECT_EQ(exception.kind(), ModdingFlowOAuthFailureKind::Ambiguous);
        }
        EXPECT_EQ(ambiguousTransport.requests.size(), 1U);
    }

    TEST(ModdingFlowOAuthHttpClientTests, RefreshClassifies401RateLimitAndServerFailureWithoutRetry)
    {
        struct Scenario
        {
            std::uint16_t status;
            std::string code;
            ModdingFlowOAuthFailureKind expected;
        };
        const Scenario scenarios[] = {
            {401, "invalid_client", ModdingFlowOAuthFailureKind::Security},
            {429, "rate_limited", ModdingFlowOAuthFailureKind::Temporary},
            {500, "oauth_refresh_rotation_unavailable", ModdingFlowOAuthFailureKind::Ambiguous},
            {503, "service_unavailable", ModdingFlowOAuthFailureKind::Ambiguous}};

        for (const Scenario& scenario : scenarios)
        {
            RecordingTransport transport;
            transport.responses.push_back({
                scenario.status,
                {{"content-type", "application/json"}},
                "{\"error\":\"" + scenario.code + "\"}"});
            ModdingFlowOAuthHttpClient client(ModdingFlowConfiguration::production(), transport);
            try
            {
                static_cast<void>(client.refreshAccessToken({
                    "https://moddingflow.com/oauth/token",
                    "desktop_mod_manager",
                    "refresh-value",
                    L"operation-refresh-classification"}));
                FAIL() << "Expected HTTP failure classification.";
            }
            catch (const ModdingFlowOAuthException& exception)
            {
                EXPECT_EQ(exception.kind(), scenario.expected);
            }
            EXPECT_EQ(transport.requests.size(), 1U);
        }
    }

    TEST(ModdingFlowOAuthHttpClientTests, RefreshTreatsOnlyProvenMissingRotationRpcAsTemporary)
    {
        const std::string problemBody =
            R"({"type":"https://moddingflow.com/problems/oauth-refresh-rotation-unavailable","title":"OAuth refresh unavailable","status":503,"detail":"OAuth refresh rotation is temporarily unavailable.","instance":"/oauth/token","ok":false,"code":"oauth_refresh_rotation_unavailable","machine_code":"oauth_refresh_rotation_unavailable","http_status":503,"request_id":"request-oauth-readiness","trace_id":"trace-oauth-readiness","retryable":true,"docs_slug":"oauth-refresh","retry_after_seconds":5,"required_scopes":[],"error":{"machine_code":"oauth_refresh_rotation_unavailable","http_status":503,"message":"OAuth refresh rotation is temporarily unavailable.","trace_id":"trace-oauth-readiness","request_id":"request-oauth-readiness"}})";

        RecordingTransport transport;
        transport.responses.push_back({
            503,
            {{"content-type", "application/problem+json"}},
            problemBody});
        ModdingFlowOAuthHttpClient client(ModdingFlowConfiguration::production(), transport);

        try
        {
            static_cast<void>(client.refreshAccessToken({
                "https://moddingflow.com/oauth/token",
                "desktop_mod_manager",
                "refresh-value",
                L"operation-refresh-readiness"}));
            FAIL() << "Expected the proven missing-RPC response to be classified.";
        }
        catch (const ModdingFlowOAuthException& exception)
        {
            EXPECT_EQ(exception.kind(), ModdingFlowOAuthFailureKind::Temporary);
            EXPECT_EQ(
                exception.metadata().machineCode,
                "oauth_refresh_rotation_unavailable");
            EXPECT_EQ(exception.metadata().requestId, "request-oauth-readiness");
            EXPECT_EQ(exception.metadata().traceId, "trace-oauth-readiness");
        }

        ASSERT_EQ(transport.requests.size(), 1U);
    }

    TEST(ModdingFlowOAuthHttpClientTests, RevocationUsesPublicClientFormWithoutAuthorizationHeader)
    {
        RecordingTransport transport;
        transport.responses.push_back({200, {}, {}});
        ModdingFlowOAuthHttpClient client(ModdingFlowConfiguration::production(), transport);

        client.revokeToken({
            "https://moddingflow.com/oauth/revoke",
            "desktop_mod_manager",
            "refresh/value+secret",
            "refresh_token",
            L"operation-revoke"});

        ASSERT_EQ(transport.requests.size(), 1U);
        const ModdingFlowHttpRequest& request = transport.requests.front();
        EXPECT_EQ(request.method, ModdingFlowHttpMethod::Post);
        EXPECT_EQ(request.url, "https://moddingflow.com/oauth/revoke");
        EXPECT_FALSE(hasHeader(request, "authorization"));
        EXPECT_FALSE(hasHeader(request, "cookie"));
        EXPECT_EQ(
            request.body,
            "client_id=desktop_mod_manager&token=refresh%2Fvalue%2Bsecret&"
            "token_type_hint=refresh_token");
        EXPECT_EQ(request.body.find("client_secret"), std::string::npos);
    }

    TEST(ModdingFlowOAuthHttpClientTests, AuthorizationExchangeClassifiesOAuthRedirectAndTemporaryErrors)
    {
        struct Scenario
        {
            std::uint16_t status;
            std::string error;
            ModdingFlowOAuthFailureKind expected;
        };
        const Scenario scenarios[] = {
            {400, "invalid_grant", ModdingFlowOAuthFailureKind::InvalidGrant},
            {302, "redirect", ModdingFlowOAuthFailureKind::Security},
            {429, "rate_limited", ModdingFlowOAuthFailureKind::Temporary},
            {503, "service_unavailable", ModdingFlowOAuthFailureKind::Temporary}};
        for (const Scenario& scenario : scenarios)
        {
            RecordingTransport transport;
            transport.responses.push_back({
                scenario.status,
                {{"content-type", "application/json"}},
                "{\"error\":\"" + scenario.error + "\"}"});
            ModdingFlowOAuthHttpClient client(ModdingFlowConfiguration::production(), transport);
            try
            {
                static_cast<void>(client.exchangeAuthorizationCode({
                    "https://moddingflow.com/oauth/token",
                    "desktop_mod_manager",
                    "http://127.0.0.1:43125/oauth/fluxora/callback",
                    "code",
                    "verifier",
                    L"operation-exchange-error"}));
                FAIL() << "Expected authorization exchange failure.";
            }
            catch (const ModdingFlowOAuthException& exception)
            {
                EXPECT_EQ(exception.kind(), scenario.expected);
            }
            EXPECT_EQ(transport.requests.size(), 1U);
        }
    }

    TEST(ModdingFlowOAuthHttpClientTests, TokenSuccessRejectsDuplicateFieldsAndContentTypes)
    {
        const std::string validTail =
            R"(,"refresh_token":"refresh","id_token":"header.payload.signature","token_type":"Bearer","expires_in":900,"scope":"openid profile:read mods:read files:download install_plans:resolve"})";
        std::vector<ModdingFlowHttpResponse> responses = {
            {200,
             {{"content-type", "application/json"}},
             R"({"access_token":"one","access_token":"two")" + validTail},
            {200,
             {{"content-type", "application/json"}, {"content-type", "application/json"}},
             R"({"access_token":"access")" + validTail}};
        responses.push_back({
            200,
            {{"content-type", "application/json"}},
            std::string(64U * 1024U + 1U, 'x')});

        for (const ModdingFlowHttpResponse& response : responses)
        {
            RecordingTransport transport;
            transport.responses.push_back(response);
            ModdingFlowOAuthHttpClient client(ModdingFlowConfiguration::production(), transport);
            try
            {
                static_cast<void>(client.exchangeAuthorizationCode({
                    "https://moddingflow.com/oauth/token",
                    "desktop_mod_manager",
                    "http://127.0.0.1:43125/oauth/fluxora/callback",
                    "code",
                    "verifier",
                    L"operation-token-parse"}));
                FAIL() << "Expected strict token response rejection.";
            }
            catch (const ModdingFlowOAuthException& exception)
            {
                EXPECT_EQ(exception.kind(), ModdingFlowOAuthFailureKind::Protocol);
            }
        }
    }

    TEST(ModdingFlowJwksIdTokenVerifierTests, UnknownKidRefreshesAndCacheHonorsAgeNoStoreAndNoCache)
    {
        static constexpr std::string_view modulus =
            "wjb7_hTlC2eJ1iuMuGeG9XD4BlBfdZHBe_Cnp91Cug5_F_qyjkWy6FOkD55MVxQy4Pqhg0qr"
            "KohvJVRcF6vgxE9oKnviCvEqyONv2xmKJk6TBDJjW0FZtcGLJeAvvJOxGK9yfMBK05a0uZSQ_"
            "V4-d_6S-mB9Jkl8fGSvZgV6HfC1p7vtJDB3WLMa3O3u1EKFlvsdQP-FUz4Ga3dkEGyt5TMILup"
            "_5Bgw3OjgL2ZlSWXsS5FDg_cyYgYM4QzKPc5oTikAmhcOu6sh9uwi0213HX5dZqZEJPGVTaX9"
            "bMRToolj9ZdemTkMjyQ-olmwl8TrwdloUdQdnZv1yUkMSswQeQ";
        static constexpr std::string_view jwt =
            "eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2V5LTIwMjYiLCJ0eXAiOiJKV1QifQ."
            "eyJpc3MiOiJodHRwczovL21vZGRpbmdmbG93LmNvbSIsImF1ZCI6ImRlc2t0b3BfbW9kX21h"
            "bmFnZXIiLCJzdWIiOiI3ZDBkMjRhNC0yM2Q2LTRmN2YtYTJkMS1iYmQwNGRmZDNkNzYiLCJub2"
            "5jZSI6Im5vbmNlLWZpeGVkIiwiaWF0IjoxNzg1MzEyMDAwLCJleHAiOjE3ODUzMTI5MDB9."
            "gzLAhQPLoes68MFgE3x7h_brgkm3n0tmDw5U-NVO0h61DndQAXm3os3VqQSGUavbcSRyM2AHT"
            "Ae86MeIAVZfCw9-VvCU1Xw3LJ4D5-WBpRPfU17dDs_vt9qYVugAnWzO3ge6UfHURsP30QTLp"
            "XV6xp6HJEQzSaPEAcy9-sGXF8a9wjG-_LV54O_i4izulBgaJ_8qrjaRzW4saESTkWFkvU7qNb"
            "GlIwzkOhLUyY_1Fi4fMTVdat5C1Q4CdiQistiRm6KQek6cm60Mo6d100_zOmgY2lPfNrdW9J0"
            "U-XyyCPgP1w5hP4T_hZal_Ku0OSnWIjVcLq-qqP3p4NupkVk2jg";

        const auto jwks = [](
            std::string_view keyId,
            std::string cacheControl,
            std::string age)
        {
            std::vector<ModdingFlowHttpHeader> headers{
                {"content-type", "application/jwk-set+json; charset=utf-8"},
                {"cache-control", std::move(cacheControl)}};
            if (!age.empty())
            {
                headers.push_back({"age", std::move(age)});
            }
            return ModdingFlowHttpResponse{
                200,
                std::move(headers),
                "{\"keys\":[{\"kty\":\"RSA\",\"kid\":\"" + std::string(keyId) +
                "\",\"use\":\"sig\",\"alg\":\"RS256\",\"n\":\"" + std::string(modulus) +
                "\",\"e\":\"AQAB\"}]}"};
        };
        RecordingTransport transport;
        transport.responses.push_back(jwks("previous-key", "public, max-age=300", {}));
        transport.responses.push_back(jwks("test-key-2026", "PuBlIc, MaX-aGe=300", "299"));
        transport.responses.push_back(jwks("test-key-2026", "public, No-StOrE, max-age=300", {}));
        transport.responses.push_back(jwks("test-key-2026", "NO-CACHE, max-age=300", {}));
        transport.responses.push_back(jwks("test-key-2026", "public, max-age=300", {}));
        auto clock = std::chrono::steady_clock::time_point(std::chrono::seconds(50));
        ModdingFlowJwksIdTokenVerifier verifier(
            ModdingFlowConfiguration::production(),
            transport,
            {.monotonicClock = [&clock] { return clock; }});

        const ModdingFlowIdTokenClaims claims = verifier.verifySignatureAndDecode({
            std::string(jwt),
            "https://moddingflow.com/.well-known/jwks.json",
            true,
            {},
            L"operation-jwks"});

        EXPECT_TRUE(claims.signatureValid);
        EXPECT_EQ(claims.algorithm, "RS256");
        EXPECT_EQ(claims.issuer, "https://moddingflow.com");
        ASSERT_EQ(claims.audience.size(), 1U);
        EXPECT_EQ(claims.audience.front(), "desktop_mod_manager");
        EXPECT_EQ(claims.subject, "7d0d24a4-23d6-4f7f-a2d1-bbd04dfd3d76");
        EXPECT_EQ(claims.nonce, "nonce-fixed");
        static_cast<void>(verifier.verifySignatureAndDecode({
            std::string(jwt),
            "https://moddingflow.com/.well-known/jwks.json",
            true}));
        clock += std::chrono::seconds(2);
        static_cast<void>(verifier.verifySignatureAndDecode({
            std::string(jwt),
            "https://moddingflow.com/.well-known/jwks.json",
            true,
            {},
            L"operation-aged"}));
        static_cast<void>(verifier.verifySignatureAndDecode({
            std::string(jwt),
            "https://moddingflow.com/.well-known/jwks.json",
            true,
            {},
            L"operation-no-store"}));
        static_cast<void>(verifier.verifySignatureAndDecode({
            std::string(jwt),
            "https://moddingflow.com/.well-known/jwks.json",
            true,
            {},
            L"operation-no-cache"}));
        std::string tampered(jwt);
        tampered.back() = tampered.back() == 'A' ? 'B' : 'A';
        EXPECT_THROW(
            static_cast<void>(verifier.verifySignatureAndDecode({
                tampered,
                "https://moddingflow.com/.well-known/jwks.json",
                true})),
            ModdingFlowOAuthException);
        ASSERT_EQ(transport.requests.size(), 5U);
        const ModdingFlowHttpRequest& request = transport.requests.front();
        EXPECT_EQ(request.method, ModdingFlowHttpMethod::Get);
        EXPECT_EQ(request.url, "https://moddingflow.com/.well-known/jwks.json");
        EXPECT_FALSE(hasHeader(request, "authorization"));
        EXPECT_FALSE(hasHeader(request, "cookie"));
        EXPECT_TRUE(request.body.empty());
        EXPECT_EQ(request.operationId, L"operation-jwks");
        EXPECT_EQ(transport.requests[1].operationId, L"operation-jwks");
        EXPECT_EQ(transport.requests[2].operationId, L"operation-aged");
        EXPECT_EQ(transport.requests[3].operationId, L"operation-no-store");
        EXPECT_EQ(transport.requests[4].operationId, L"operation-no-cache");
    }

    TEST(ModdingFlowJwksIdTokenVerifierTests, RejectsEmbeddedKeysNoneAndDuplicateSecurityClaimsBeforeJwks)
    {
        const std::vector<std::pair<std::string, std::string>> documents = {
            {R"({"alg":"none","kid":"key"})", R"({"iss":"https://moddingflow.com","aud":"desktop_mod_manager","sub":"user","nonce":"n","iat":1,"exp":2})"},
            {R"({"alg":"RS256","kid":"key","jku":"https://evil.invalid/jwks"})", R"({"iss":"https://moddingflow.com","aud":"desktop_mod_manager","sub":"user","nonce":"n","iat":1,"exp":2})"},
            {R"({"alg":"RS256","kid":"key","x5u":"https://evil.invalid/cert"})", R"({"iss":"https://moddingflow.com","aud":"desktop_mod_manager","sub":"user","nonce":"n","iat":1,"exp":2})"},
            {R"({"alg":"RS256","kid":"key","jwk":{"kty":"RSA"}})", R"({"iss":"https://moddingflow.com","aud":"desktop_mod_manager","sub":"user","nonce":"n","iat":1,"exp":2})"},
            {R"({"alg":"RS256","alg":"RS256","kid":"key"})", R"({"iss":"https://moddingflow.com","aud":"desktop_mod_manager","sub":"user","nonce":"n","iat":1,"exp":2})"},
            {R"({"alg":"RS256","kid":"key","kid":"other"})", R"({"iss":"https://moddingflow.com","aud":"desktop_mod_manager","sub":"user","nonce":"n","iat":1,"exp":2})"},
            {R"({"alg":"RS256","kid":"key"})", R"({"iss":"https://moddingflow.com","iss":"https://evil.invalid","aud":"desktop_mod_manager","sub":"user","nonce":"n","iat":1,"exp":2})"}};

        for (const auto& [header, payload] : documents)
        {
            RecordingTransport transport;
            ModdingFlowJwksIdTokenVerifier verifier(
                ModdingFlowConfiguration::production(),
                transport);
            EXPECT_THROW(
                static_cast<void>(verifier.verifySignatureAndDecode({
                    base64Url(header) + "." + base64Url(payload) + ".AA",
                    "https://moddingflow.com/.well-known/jwks.json",
                    true})),
                ModdingFlowOAuthException);
            EXPECT_TRUE(transport.requests.empty());
        }
    }

    TEST(WinHttpModdingFlowTransportTests, RejectsUnsafeOriginCredentialsAndUnboundedPolicyBeforeNetwork)
    {
        EXPECT_THROW(
            WinHttpModdingFlowTransport(L"Fluxora/0.0.0\r\nInjected: true"),
            std::invalid_argument);
        WinHttpModdingFlowTransport transport(L"Fluxora/0.0.0 ModdingFlow");
        ModdingFlowHttpRequest request;
        request.method = ModdingFlowHttpMethod::Post;
        request.url = "http://moddingflow.com/oauth/token";
        request.headers = {{"content-type", "application/x-www-form-urlencoded"}};
        request.body = "grant_type=refresh_token&client_id=desktop_mod_manager";

        try
        {
            static_cast<void>(transport.send(request));
            FAIL() << "Expected non-HTTPS origin rejection.";
        }
        catch (const ModdingFlowHttpException& exception)
        {
            EXPECT_EQ(exception.kind(), ModdingFlowHttpFailureKind::Security);
            EXPECT_FALSE(exception.requestMayHaveBeenSent());
        }

        request.url = "https://moddingflow.com/oauth/token";
        request.headers.push_back({"authorization", "Bearer forbidden"});
        EXPECT_THROW(static_cast<void>(transport.send(request)), ModdingFlowHttpException);

        request.headers.pop_back();
        request.body += "&client_secret=forbidden";
        EXPECT_THROW(static_cast<void>(transport.send(request)), ModdingFlowHttpException);

        request.body = "grant_type=refresh_token&ClIeNt_SeCrEt=forbidden";
        EXPECT_THROW(static_cast<void>(transport.send(request)), ModdingFlowHttpException);

        request.body = "grant_type=refresh_token&client_id=desktop_mod_manager";
        const std::vector<ModdingFlowHttpHeader> forbiddenHeaders = {
            {"host", "evil.invalid"},
            {"content-length", "1"},
            {"transfer-encoding", "chunked"},
            {"connection", "close"},
            {"cookie", "session=forbidden"},
            {"proxy-authorization", "Basic forbidden"},
            {"upgrade", "websocket"},
            {"te", "trailers"},
            {"trailer", "x-extra"}};
        for (const ModdingFlowHttpHeader& forbidden : forbiddenHeaders)
        {
            request.headers = {
                {"content-type", "application/x-www-form-urlencoded"},
                forbidden};
            try
            {
                static_cast<void>(transport.send(request));
                FAIL() << "Expected caller-owned framing header rejection.";
            }
            catch (const ModdingFlowHttpException& exception)
            {
                EXPECT_EQ(exception.kind(), ModdingFlowHttpFailureKind::Security);
                EXPECT_FALSE(exception.requestMayHaveBeenSent());
            }
        }

        request.headers = {{"content-type", "application/x-www-form-urlencoded"}};
        request.policy.timeouts.overall = std::chrono::milliseconds::zero();
        try
        {
            static_cast<void>(transport.send(request));
            FAIL() << "Expected invalid overall deadline rejection.";
        }
        catch (const ModdingFlowHttpException& exception)
        {
            EXPECT_EQ(exception.kind(), ModdingFlowHttpFailureKind::Protocol);
            EXPECT_FALSE(exception.requestMayHaveBeenSent());
        }
    }

    TEST(WinHttpModdingFlowTransportTests, RejectsAmbiguousResponseFraming)
    {
        const std::vector<std::vector<ModdingFlowHttpHeader>> hostileHeaders = {
            {{"content-length", "12"}, {"content-length", "12"}},
            {{"content-length", "12"}, {"transfer-encoding", "chunked"}},
            {{"transfer-encoding", "chunked"}, {"transfer-encoding", "chunked"}},
            {{"transfer-encoding", "gzip, chunked"}},
            {{"content-length", "12x"}}};
        for (const auto& headers : hostileHeaders)
        {
            EXPECT_THROW(
                validateModdingFlowHttpResponseFramingForTests(headers),
                std::runtime_error);
        }
        EXPECT_NO_THROW(validateModdingFlowHttpResponseFramingForTests({
            {"transfer-encoding", "chunked"}}));
        EXPECT_NO_THROW(validateModdingFlowHttpResponseFramingForTests({
            {"content-length", "12"}}));
    }

#ifdef _WIN32
    TEST(WinHttpModdingFlowTransportTests, ClassifiesOnlyProvenPreSubmissionFailuresAsDefinitelyUnsent)
    {
        for (const DWORD error : {
            ERROR_WINHTTP_NAME_NOT_RESOLVED,
            ERROR_WINHTTP_CANNOT_CONNECT})
        {
            const auto classification = classifyModdingFlowWinHttpAsyncFailureForTests(
                API_SEND_REQUEST,
                error,
                false);
            EXPECT_EQ(classification.kind, ModdingFlowHttpFailureKind::DefinitelyNotSent);
            EXPECT_FALSE(classification.requestMayHaveBeenSent);
        }

        const auto afterSubmission = classifyModdingFlowWinHttpAsyncFailureForTests(
            API_SEND_REQUEST,
            ERROR_WINHTTP_CANNOT_CONNECT,
            true);
        EXPECT_EQ(afterSubmission.kind, ModdingFlowHttpFailureKind::Ambiguous);
        EXPECT_TRUE(afterSubmission.requestMayHaveBeenSent);

        const auto unknownSendFailure = classifyModdingFlowWinHttpAsyncFailureForTests(
            API_SEND_REQUEST,
            ERROR_WINHTTP_TIMEOUT,
            false);
        EXPECT_EQ(unknownSendFailure.kind, ModdingFlowHttpFailureKind::Ambiguous);
        EXPECT_TRUE(unknownSendFailure.requestMayHaveBeenSent);

        const auto receiveFailure = classifyModdingFlowWinHttpAsyncFailureForTests(
            API_RECEIVE_RESPONSE,
            ERROR_WINHTTP_CONNECTION_ERROR,
            false);
        EXPECT_EQ(receiveFailure.kind, ModdingFlowHttpFailureKind::Ambiguous);
        EXPECT_TRUE(receiveFailure.requestMayHaveBeenSent);
    }
#endif
}
