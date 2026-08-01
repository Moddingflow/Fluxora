#include "FluxoraCore/Services/ModdingFlowRemoteDownloadResolver.hpp"

#include <gtest/gtest.h>

#include <deque>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        constexpr std::uint64_t nowUnixMs = 1'785'369'600'000ULL;
        constexpr std::string_view artifactId = "33333333-3333-4333-8333-333333333333";
        constexpr std::string_view modId = "11111111-1111-4111-8111-111111111111";
        constexpr std::string_view versionId = "22222222-2222-4222-8222-222222222222";
        constexpr std::string_view jobId = "55555555-5555-4555-8555-555555555555";
        constexpr std::string_view grantId = "44444444-4444-4444-8444-444444444444";
        constexpr std::string_view sha256 =
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        class RecordingDownloadClient final : public IModdingFlowPublicApiClient
        {
        public:
            ModdingFlowPublicApiResponse execute(
                const ModdingFlowPublicApiRequest& request) override
            {
                requests.push_back(request);
                ModdingFlowPublicApiResponse response = std::move(responses.front());
                responses.pop_front();
                return response;
            }

            std::vector<ModdingFlowPublicApiRequest> requests;
            std::deque<ModdingFlowPublicApiResponse> responses;
        };

        class RecordingDownloadTransport final : public IModdingFlowHttpTransport
        {
        public:
            ModdingFlowHttpResponse send(const ModdingFlowHttpRequest& request) override
            {
                requests.push_back(request);
                ModdingFlowHttpResponse response = std::move(responses.front());
                responses.pop_front();
                return response;
            }

            std::vector<ModdingFlowHttpRequest> requests;
            std::deque<ModdingFlowHttpResponse> responses;
        };

        class DownloadTokenProvider final : public IModdingFlowAccessTokenProvider
        {
        public:
            std::string getAccessToken(
                std::string_view requiredScope,
                std::wstring_view operationId,
                bool forceRefresh) override
            {
                scopes.emplace_back(requiredScope);
                operationIds.emplace_back(operationId);
                refreshes.push_back(forceRefresh);
                return "resolver-access-token";
            }

            std::vector<std::string> scopes;
            std::vector<std::wstring> operationIds;
            std::vector<bool> refreshes;
        };

        RemoteArtifactDownloadRequest validRequest()
        {
            return {
                .providerId = "moddingflow",
                .artifactId = std::string(artifactId),
                .modId = std::string(modId),
                .versionId = std::string(versionId),
                .jobId = std::string(jobId),
                .operationId = L"operation-download-resolve"};
        }

        RemoteDownloadFallbackRequest validFallbackRequest()
        {
            return {
                .providerId = "moddingflow",
                .artifactId = std::string(artifactId),
                .modId = std::string(modId),
                .versionId = std::string(versionId),
                .jobId = std::string(jobId),
                .grantId = std::string(grantId),
                .currentRepresentationProviderId = "cloudflare_r2",
                .expectedSize = 1024U,
                .expectedSha256 = std::string(sha256),
                .operationId = L"operation-download-resolve"};
        }

        std::string successJson()
        {
            const std::string resolveEndpoint =
                "/v1/downloads/" + std::string(artifactId) + "/resolve";
            const std::string fallbackEndpoint =
                "/v1/downloads/" + std::string(artifactId) + "/fallback";
            return R"({"ok":true,"data":{"mod":{"id":")" + std::string(modId) +
                R"("},"version":{"id":")" + std::string(versionId) +
                R"(","mod_id":")" + std::string(modId) +
                R"(","artifact_ids":[")" + std::string(artifactId) +
                R"("]},"artifact":{"id":")" + std::string(artifactId) +
                R"(","mod_id":")" + std::string(modId) +
                R"(","version_id":")" + std::string(versionId) +
                R"(","size_bytes":1024,"sha256":")" + std::string(sha256) +
                R"(","hashes":{"sha256":")" + std::string(sha256) +
                R"("},"artifact_source":"r2_blob","status":"published","scan_status":"clean","download_metadata":{"resolve_endpoint":")" +
                resolveEndpoint +
                R"(","range_supported":true}},"distribution":{"service":"moddingflow"},"artifact_id":")" +
                std::string(artifactId) + R"(","download_session_id":")" +
                std::string(grantId) + R"(","download_job":{"id":")" +
                std::string(jobId) + R"(","grant_id":")" + std::string(grantId) +
                R"(","artifact_id":")" + std::string(artifactId) +
                R"(","status":"grant_active","bytes_received":0,"attempt_count":1,"rate_limit_count":0,"provider_effect_count":1,"next_attempt_at":null},"download_grant":{"id":")" +
                std::string(grantId) + R"(","artifact_id":")" + std::string(artifactId) +
                R"(","expires_at":"2026-07-30T00:10:00.000Z","ttl_seconds":600,"refresh_after_seconds":480,"resolve_endpoint":")" +
                resolveEndpoint + R"(","fallback_endpoint":")" + fallbackEndpoint +
                R"(","status":"active"},"primary_url":"https://cdn.example.invalid/archive.7z?signature=primary-secret","head_url":"https://storage.example.invalid/archive.7z?signature=head-secret","fallback_url":"https://fallback.example.invalid/archive.7z?signature=fallback-secret","fallback":{"provider":"cloudflare_r2"},"expires_at":"2026-07-30T00:10:00.000Z","expires_in":600,"refresh_after_seconds":480,"sha256":")" +
                std::string(sha256) + R"(","hashes":{"sha256":")" +
                std::string(sha256) +
                R"("},"size_bytes":1024,"accept_ranges":"bytes","conditional_headers":["If-Match","If-None-Match","If-Modified-Since","If-Unmodified-Since"],"range_supported":true,"representation":{"provider":"cloudflare_r2","etag":"\"archive-etag\"","etag_scope":"cloudflare_r2","if_match":"\"archive-etag\"","head_url":"https://storage.example.invalid/archive.7z?signature=head-secret","requires_head_before_range":false},"verification":{"sha256":")" +
                std::string(sha256) + R"(","hashes":{"sha256":")" +
                std::string(sha256) +
                R"("},"size_bytes":1024},"resume":{"range_supported":true,"etag":"\"archive-etag\"","provider":"cloudflare_r2","etag_scope":"cloudflare_r2","if_match":"\"archive-etag\"","requires_head_before_range":false,"sha256":")" +
                std::string(sha256) + R"(","hashes":{"sha256":")" +
                std::string(sha256) +
                R"("},"head_url":"https://storage.example.invalid/archive.7z?signature=head-secret","conditional_headers":["If-Match","If-None-Match","If-Modified-Since","If-Unmodified-Since"],"chunk_size_hint_bytes":8388608,"signed_url_expiry_refresh":")" +
                resolveEndpoint + R"("}}})";
        }

        ModdingFlowPublicApiResponse successResponse()
        {
            return {
                parseModdingFlowJson(successJson(), {.maximumBytes = 128U * 1024U}),
                L"operation-download-resolve",
                "request-download"};
        }

        std::string replaceOnce(
            std::string value,
            std::string_view before,
            std::string_view after)
        {
            const std::size_t offset = value.find(before);
            if (offset == std::string::npos ||
                value.find(before, offset + before.size()) != std::string::npos)
            {
                throw std::logic_error("Download test replacement is not unique.");
            }
            value.replace(offset, before.size(), after);
            return value;
        }

        std::string replaceAll(
            std::string value,
            std::string_view before,
            std::string_view after)
        {
            std::size_t offset = 0U;
            std::size_t replacements = 0U;
            while ((offset = value.find(before, offset)) != std::string::npos)
            {
                value.replace(offset, before.size(), after);
                offset += after.size();
                ++replacements;
            }
            if (replacements == 0U)
            {
                throw std::logic_error("Download test replacement was not found.");
            }
            return value;
        }

        std::string fallbackSuccessJson()
        {
            constexpr std::string_view bunnyUrl =
                "https://bunny.example.invalid/archive.7z?token=fallback-secret";
            std::string json = successJson();
            json = replaceAll(json, "cloudflare_r2", "bunny_pull_cdn");
            json = replaceAll(
                json,
                "\"etag\":\"\\\"archive-etag\\\"\"",
                "\"etag\":null");
            json = replaceAll(
                json,
                "\"if_match\":\"\\\"archive-etag\\\"\"",
                "\"if_match\":null");
            json = replaceAll(
                json,
                "\"requires_head_before_range\":false",
                "\"requires_head_before_range\":true");
            json = replaceAll(
                json,
                "https://storage.example.invalid/archive.7z?signature=head-secret",
                bunnyUrl);
            json = replaceOnce(
                json,
                "https://fallback.example.invalid/archive.7z?signature=fallback-secret",
                bunnyUrl);
            json = replaceOnce(
                json,
                "\"fallback_url\":\"" + std::string(bunnyUrl) + "\",",
                "\"fallback_url\":\"" + std::string(bunnyUrl) +
                    "\",\"url\":\"" + std::string(bunnyUrl) +
                    "\",\"provider\":\"bunny_pull_cdn\","
                    "\"reason\":\"bunny_probe_failure\",\"etag\":null,");
            json = replaceOnce(
                json,
                "\"scan_status\":\"clean\",\"download_metadata\"",
                "\"scan_status\":\"clean\",\"etag\":null,\"download_metadata\"");
            json = replaceOnce(
                json,
                "\"verification\":{\"sha256\"",
                "\"verification\":{\"etag\":null,\"sha256\"");
            return json;
        }

        ModdingFlowPublicApiResponse fallbackSuccessResponse()
        {
            return {
                parseModdingFlowJson(
                    fallbackSuccessJson(),
                    {.maximumBytes = 128U * 1024U}),
                L"operation-download-resolve",
                "request-download-fallback"};
        }

        ModdingFlowPublicApiResponse responseFromJson(
            std::string json,
            std::wstring operationId = L"operation-download-resolve")
        {
            return {
                parseModdingFlowJson(json, {.maximumBytes = 128U * 1024U}),
                std::move(operationId),
                "request-download"};
        }

        ModdingFlowHttpResponse httpJsonResponse(std::string body)
        {
            return {
                200U,
                {{"content-type", "application/json"},
                 {"x-request-id", "request-download"}},
                std::move(body)};
        }

        ModdingFlowHttpResponse httpProblemResponse(
            std::uint16_t status,
            std::string code,
            bool retryable = false,
            std::optional<std::uint32_t> retryAfter = std::nullopt)
        {
            std::string body =
                R"({"type":"https://moddingflow.com/problems/)" + code +
                R"(","title":"Request failed","detail":"Request failed","status":)" +
                std::to_string(status) + R"(,"instance":"/v1/downloads/resolve","code":")" +
                code + R"(","machine_code":")" + code +
                R"(","request_id":"request-download","trace_id":"trace-download","ok":false,"retryable":)" +
                (retryable ? "true" : "false");
            if (retryAfter)
            {
                body += R"(,"retry_after_seconds":)" + std::to_string(*retryAfter);
            }
            body += R"(,"error":{"machine_code":")" + code +
                R"(","http_status":)" + std::to_string(status) +
                R"(,"message":"Request failed","trace_id":"trace-download","request_id":"request-download"}})";
            ModdingFlowHttpResponse response{
                status,
                {{"content-type", "application/problem+json"},
                 {"x-request-id", "request-download"}},
                std::move(body)};
            if (retryAfter)
            {
                response.headers.push_back({"retry-after", std::to_string(*retryAfter)});
            }
            return response;
        }

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

        template <typename Callback>
        void expectCode(ModdingFlowApiErrorCode code, Callback callback)
        {
            try
            {
                callback();
                FAIL() << "Expected ModdingFlow download resolver failure.";
            }
            catch (const ModdingFlowApiException& exception)
            {
                EXPECT_EQ(exception.code(), code) << exception.what();
                EXPECT_EQ(exception.operationId(), L"operation-download-resolve");
            }
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, ResolvesCanonicalGrantWithoutExposingTransportHeaders)
    {
        RecordingDownloadClient client;
        client.responses.push_back(successResponse());
        ModdingFlowRemoteDownloadResolver resolver(client, {
            .nowUnixMilliseconds = [] { return nowUnixMs; }});

        const ResolvedDownloadGrant grant = resolver.resolve(validRequest());

        ASSERT_EQ(client.requests.size(), 1U);
        EXPECT_EQ(client.requests.front().method, ModdingFlowHttpMethod::Post);
        EXPECT_EQ(
            client.requests.front().pathAndQuery,
            "/downloads/" + std::string(artifactId) + "/resolve");
        EXPECT_EQ(client.requests.front().body,
            "{\"client\":\"mod_manager\",\"job_id\":\"" +
                std::string(jobId) + "\"}");
        EXPECT_EQ(client.requests.front().body.find("progress"), std::string::npos);
        EXPECT_EQ(client.requests.front().auth, ModdingFlowApiAuthMode::Anonymous);
        EXPECT_TRUE(client.requests.front().requiredScope.empty());
        EXPECT_EQ(client.requests.front().retry, ModdingFlowApiRetryMode::Idempotent);
        EXPECT_EQ(
            client.requests.front().idempotencyKey,
            "fluxora-mf-download-" + std::string(jobId));
        EXPECT_EQ(client.requests.front().operationId, L"operation-download-resolve");
        EXPECT_EQ(client.requests.front().maximumResponseBytes, 512U * 1024U);
        EXPECT_EQ(grant.providerId, "moddingflow");
        EXPECT_EQ(grant.representationProviderId, "cloudflare_r2");
        EXPECT_EQ(grant.artifactId, artifactId);
        EXPECT_EQ(grant.grantId, grantId);
        EXPECT_EQ(
            grant.primaryUrl,
            "https://cdn.example.invalid/archive.7z?signature=primary-secret");
        EXPECT_EQ(
            grant.headUrl,
            "https://storage.example.invalid/archive.7z?signature=head-secret");
        EXPECT_EQ(grant.expectedSize, 1024U);
        EXPECT_EQ(grant.expectedSha256, sha256);
        EXPECT_EQ(grant.expiresAtUnixMs, 1'785'370'200'000ULL);
        ASSERT_EQ(grant.fallbackUrls.size(), 1U);
        EXPECT_EQ(
            grant.fallbackUrls.front(),
            "https://fallback.example.invalid/archive.7z?signature=fallback-secret");
        EXPECT_TRUE(grant.transportHeaders.empty());
        EXPECT_EQ(grant.operationId, L"operation-download-resolve");
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, RestrictedResolveRetriesOnceWithScopedBearer)
    {
        RecordingDownloadTransport transport;
        transport.responses.push_back(httpProblemResponse(401U, "authentication_required"));
        transport.responses.push_back(httpJsonResponse(successJson()));
        DownloadTokenProvider tokens;
        ModdingFlowPublicApiClient client(transport, &tokens);
        ModdingFlowRemoteDownloadResolver resolver(client, {
            .nowUnixMilliseconds = [] { return nowUnixMs; }});

        const ResolvedDownloadGrant grant = resolver.resolve(validRequest());

        EXPECT_EQ(grant.grantId, grantId);
        ASSERT_EQ(transport.requests.size(), 2U);
        EXPECT_TRUE(headerValue(transport.requests[0], "authorization").empty());
        EXPECT_EQ(
            headerValue(transport.requests[1], "authorization"),
            "Bearer resolver-access-token");
        EXPECT_EQ(tokens.scopes, std::vector<std::string>({"files:download"}));
        EXPECT_EQ(tokens.refreshes, std::vector<bool>({false}));
        EXPECT_EQ(transport.requests[0].body, transport.requests[1].body);
        EXPECT_EQ(
            headerValue(transport.requests[0], "idempotency-key"),
            headerValue(transport.requests[1], "idempotency-key"));
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, RejectsNonCanonicalProviderAndIdentityBeforeNetwork)
    {
        const std::vector<std::function<void(RemoteArtifactDownloadRequest&)>> invalidMutations = {
            [](RemoteArtifactDownloadRequest& request) { request.providerId = "nexus"; },
            [](RemoteArtifactDownloadRequest& request) { request.artifactId = "not-a-uuid"; },
            [](RemoteArtifactDownloadRequest& request) {
                request.modId = "11111111-1111-4111-8111-11111111111A";
            },
            [](RemoteArtifactDownloadRequest& request) { request.versionId.clear(); },
            [](RemoteArtifactDownloadRequest& request) { request.jobId = "job-1"; },
            [](RemoteArtifactDownloadRequest& request) { request.operationId.clear(); }};

        for (const auto& mutate : invalidMutations)
        {
            RecordingDownloadClient client;
            ModdingFlowRemoteDownloadResolver resolver(client, {
                .nowUnixMilliseconds = [] { return nowUnixMs; }});
            RemoteArtifactDownloadRequest request = validRequest();
            mutate(request);
            if (request.operationId.empty())
            {
                try
                {
                    static_cast<void>(resolver.resolve(request));
                    FAIL() << "Expected invalid operation id rejection.";
                }
                catch (const ModdingFlowApiException& exception)
                {
                    EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::InvalidRequest);
                }
            }
            else
            {
                expectCode(ModdingFlowApiErrorCode::InvalidRequest, [&] {
                    static_cast<void>(resolver.resolve(request));
                });
            }
            EXPECT_TRUE(client.requests.empty());
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, RejectsEveryCrossObjectProvenanceMismatch)
    {
        constexpr std::string_view otherId = "66666666-6666-4666-8666-666666666666";
        const std::vector<std::string> mismatches = {
            replaceOnce(
                successJson(),
                "\"mod\":{\"id\":\"" + std::string(modId),
                "\"mod\":{\"id\":\"" + std::string(otherId)),
            replaceOnce(
                successJson(),
                "\"version\":{\"id\":\"" + std::string(versionId),
                "\"version\":{\"id\":\"" + std::string(otherId)),
            replaceOnce(
                successJson(),
                "\"artifact\":{\"id\":\"" + std::string(artifactId),
                "\"artifact\":{\"id\":\"" + std::string(otherId)),
            replaceOnce(
                successJson(),
                "\"download_job\":{\"id\":\"" + std::string(jobId),
                "\"download_job\":{\"id\":\"" + std::string(otherId)),
            replaceOnce(
                successJson(),
                "\"download_grant\":{\"id\":\"" + std::string(grantId),
                "\"download_grant\":{\"id\":\"" + std::string(otherId))};

        for (const std::string& json : mismatches)
        {
            RecordingDownloadClient client;
            client.responses.push_back(responseFromJson(json));
            ModdingFlowRemoteDownloadResolver resolver(client, {
                .nowUnixMilliseconds = [] { return nowUnixMs; }});
            expectCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
                static_cast<void>(resolver.resolve(validRequest()));
            });
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, RejectsDirtyQuarantinedReadyAndDeletedArtifacts)
    {
        const std::vector<std::string> ineligible = {
            replaceOnce(
                successJson(),
                "\"scan_status\":\"clean\"",
                "\"scan_status\":\"infected\""),
            replaceOnce(
                successJson(),
                "\"status\":\"published\"",
                "\"status\":\"quarantined\""),
            replaceOnce(
                successJson(),
                "\"status\":\"published\"",
                "\"status\":\"ready\""),
            replaceOnce(
                successJson(),
                "\"status\":\"published\"",
                "\"status\":\"deleted\"")};

        for (const std::string& json : ineligible)
        {
            RecordingDownloadClient client;
            client.responses.push_back(responseFromJson(json));
            ModdingFlowRemoteDownloadResolver resolver(client, {
                .nowUnixMilliseconds = [] { return nowUnixMs; }});
            expectCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
                static_cast<void>(resolver.resolve(validRequest()));
            });
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, RejectsBadExpiryHashSizeAndJobProgress)
    {
        const std::string uppercaseSha(64U, 'A');
        const std::vector<std::string> invalid = {
            replaceAll(successJson(), sha256, uppercaseSha),
            replaceOnce(
                successJson(),
                "\"size_bytes\":1024,\"accept_ranges\"",
                "\"size_bytes\":2048,\"accept_ranges\""),
            replaceAll(
                successJson(),
                "2026-07-30T00:10:00.000Z",
                "2026-07-29T23:59:00.000Z"),
            replaceAll(
                successJson(),
                "2026-07-30T00:10:00.000Z",
                "2026-07-31T00:10:00.000Z"),
            replaceOnce(
                successJson(),
                "\"bytes_received\":0",
                "\"bytes_received\":2048")};

        for (const std::string& json : invalid)
        {
            RecordingDownloadClient client;
            client.responses.push_back(responseFromJson(json));
            ModdingFlowRemoteDownloadResolver resolver(client, {
                .nowUnixMilliseconds = [] { return nowUnixMs; }});
            expectCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
                static_cast<void>(resolver.resolve(validRequest()));
            });
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, RejectsUnknownProviderAndConditionalHeader)
    {
        const std::vector<std::string> invalid = {
            replaceAll(successJson(), "cloudflare_r2", "unknown_cdn"),
            replaceAll(successJson(), "If-Unmodified-Since", "Authorization"),
            replaceOnce(
                successJson(),
                "\"representation\":{\"provider\":\"cloudflare_r2\",\"etag\":\"\\\"archive-etag\\\"\",\"etag_scope\":\"cloudflare_r2\"",
                "\"representation\":{\"provider\":\"cloudflare_r2\",\"etag\":\"\\\"archive-etag\\\"\",\"etag_scope\":\"bunny_pull_cdn\""),
            replaceOnce(
                successJson(),
                "\"fallback\":{\"provider\":\"cloudflare_r2\"}",
                "\"fallback\":{\"provider\":\"bunny_pull_cdn\"}")};

        for (const std::string& json : invalid)
        {
            RecordingDownloadClient client;
            client.responses.push_back(responseFromJson(json));
            ModdingFlowRemoteDownloadResolver resolver(client, {
                .nowUnixMilliseconds = [] { return nowUnixMs; }});
            expectCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
                static_cast<void>(resolver.resolve(validRequest()));
            });
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, InvalidSignedUrlIsNeverReflectedByFailure)
    {
        constexpr std::string_view sensitive = "never-log-signed-secret";
        RecordingDownloadClient client;
        client.responses.push_back(responseFromJson(replaceOnce(
            successJson(),
            "https://cdn.example.invalid/archive.7z?signature=primary-secret",
            "https://user@cdn.example.invalid/archive.7z?signature=" +
                std::string(sensitive))));
        ModdingFlowRemoteDownloadResolver resolver(client, {
            .nowUnixMilliseconds = [] { return nowUnixMs; }});

        try
        {
            static_cast<void>(resolver.resolve(validRequest()));
            FAIL() << "Expected unsafe signed URL rejection.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::ProtocolFailure);
            EXPECT_EQ(std::string(exception.what()).find(sensitive), std::string::npos);
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, StrictHttpClientRetries429WithStableRequestAndMapsGone)
    {
        RecordingDownloadTransport retryTransport;
        retryTransport.responses.push_back(httpProblemResponse(
            429U, "download_rate_limited", true, 0U));
        retryTransport.responses.push_back(httpJsonResponse(successJson()));
        DownloadTokenProvider retryTokens;
        ModdingFlowPublicApiClient retryClient(retryTransport, &retryTokens, {
            .maximumAttempts = 2U,
            .sleep = [](std::chrono::milliseconds) {}});
        ModdingFlowRemoteDownloadResolver retryResolver(retryClient, {
            .nowUnixMilliseconds = [] { return nowUnixMs; }});

        const ResolvedDownloadGrant grant = retryResolver.resolve(validRequest());

        EXPECT_EQ(grant.grantId, grantId);
        ASSERT_EQ(retryTransport.requests.size(), 2U);
        EXPECT_EQ(retryTransport.requests[0].body, retryTransport.requests[1].body);
        EXPECT_EQ(
            headerValue(retryTransport.requests[0], "idempotency-key"),
            headerValue(retryTransport.requests[1], "idempotency-key"));
        EXPECT_TRUE(headerValue(retryTransport.requests[0], "authorization").empty());
        EXPECT_TRUE(headerValue(retryTransport.requests[0], "cookie").empty());
        EXPECT_TRUE(retryTokens.scopes.empty());
        EXPECT_TRUE(retryTokens.refreshes.empty());

        RecordingDownloadTransport goneTransport;
        goneTransport.responses.push_back(httpProblemResponse(410U, "artifact_deleted"));
        DownloadTokenProvider goneTokens;
        ModdingFlowPublicApiClient goneClient(goneTransport, &goneTokens);
        ModdingFlowRemoteDownloadResolver goneResolver(goneClient, {
            .nowUnixMilliseconds = [] { return nowUnixMs; }});
        expectCode(ModdingFlowApiErrorCode::NotFound, [&] {
            static_cast<void>(goneResolver.resolve(validRequest()));
        });
        EXPECT_EQ(goneTransport.requests.size(), 1U);
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, StrictHttpClientRejectsMalformedAndDuplicateJson)
    {
        const std::vector<std::string> invalidBodies = {
            R"({"ok":true)",
            R"({"ok":true,"ok":false,"data":{}})",
            std::string(512U * 1024U + 1U, 'x')};
        for (const std::string& body : invalidBodies)
        {
            RecordingDownloadTransport transport;
            transport.responses.push_back(httpJsonResponse(body));
            DownloadTokenProvider tokens;
            ModdingFlowPublicApiClient client(transport, &tokens);
            ModdingFlowRemoteDownloadResolver resolver(client, {
                .nowUnixMilliseconds = [] { return nowUnixMs; }});
            expectCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
                static_cast<void>(resolver.resolve(validRequest()));
            });
            EXPECT_EQ(transport.requests.size(), 1U);
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, ResolvesSessionBoundFreshFallbackGrant)
    {
        RecordingDownloadClient client;
        client.responses.push_back(fallbackSuccessResponse());
        ModdingFlowRemoteDownloadResolver resolver(client, {
            .nowUnixMilliseconds = [] { return nowUnixMs; }});

        const std::optional<ResolvedDownloadGrant> resolved =
            resolver.resolveFallback(validFallbackRequest());

        ASSERT_TRUE(resolved.has_value());
        ASSERT_EQ(client.requests.size(), 1U);
        const ModdingFlowPublicApiRequest& request = client.requests.front();
        EXPECT_EQ(request.method, ModdingFlowHttpMethod::Post);
        EXPECT_EQ(
            request.pathAndQuery,
            "/downloads/" + std::string(artifactId) + "/fallback");
        EXPECT_EQ(
            request.body,
            "{\"downloadSessionId\":\"" + std::string(grantId) + "\"}");
        EXPECT_EQ(request.auth, ModdingFlowApiAuthMode::Anonymous);
        EXPECT_TRUE(request.requiredScope.empty());
        EXPECT_EQ(request.retry, ModdingFlowApiRetryMode::Never);
        EXPECT_TRUE(request.idempotencyKey.empty());
        EXPECT_EQ(request.operationId, L"operation-download-resolve");
        EXPECT_EQ(request.maximumResponseBytes, 512U * 1024U);
        EXPECT_EQ(resolved->providerId, "moddingflow");
        EXPECT_EQ(resolved->representationProviderId, "bunny_pull_cdn");
        EXPECT_EQ(resolved->artifactId, artifactId);
        EXPECT_EQ(resolved->grantId, grantId);
        EXPECT_EQ(
            resolved->primaryUrl,
            "https://bunny.example.invalid/archive.7z?token=fallback-secret");
        EXPECT_EQ(resolved->headUrl, resolved->primaryUrl);
        EXPECT_EQ(resolved->expectedSize, 1024U);
        EXPECT_EQ(resolved->expectedSha256, sha256);
        EXPECT_EQ(resolved->expiresAtUnixMs, 1'785'370'200'000ULL);
        EXPECT_TRUE(resolved->fallbackUrls.empty());
        EXPECT_TRUE(resolved->transportHeaders.empty());
        EXPECT_EQ(resolved->operationId, L"operation-download-resolve");
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, RestrictedFallbackRetriesOnceWithScopedBearer)
    {
        for (const std::uint16_t status :
             {std::uint16_t{401U}, std::uint16_t{403U}})
        {
            RecordingDownloadTransport transport;
            transport.responses.push_back(httpProblemResponse(
                status,
                status == 401U ? "authentication_required" : "forbidden"));
            transport.responses.push_back(httpJsonResponse(fallbackSuccessJson()));
            DownloadTokenProvider tokens;
            ModdingFlowPublicApiClient client(transport, &tokens);
            ModdingFlowRemoteDownloadResolver resolver(client, {
                .nowUnixMilliseconds = [] { return nowUnixMs; }});

            const std::optional<ResolvedDownloadGrant> resolved =
                resolver.resolveFallback(validFallbackRequest());

            ASSERT_TRUE(resolved.has_value());
            ASSERT_EQ(transport.requests.size(), 2U);
            EXPECT_TRUE(headerValue(transport.requests[0], "authorization").empty());
            EXPECT_EQ(
                headerValue(transport.requests[1], "authorization"),
                "Bearer resolver-access-token");
            EXPECT_EQ(tokens.scopes, std::vector<std::string>({"files:download"}));
            EXPECT_EQ(tokens.refreshes, std::vector<bool>({false}));
            EXPECT_EQ(transport.requests[0].body, transport.requests[1].body);
            EXPECT_TRUE(headerValue(
                transport.requests[0], "idempotency-key").empty());
            EXPECT_TRUE(headerValue(
                transport.requests[1], "idempotency-key").empty());
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, RejectsInvalidFallbackIdentityBeforeNetwork)
    {
        const std::vector<std::function<void(RemoteDownloadFallbackRequest&)>> invalidMutations = {
            [](RemoteDownloadFallbackRequest& request) { request.providerId = "nexus"; },
            [](RemoteDownloadFallbackRequest& request) { request.artifactId = "not-a-uuid"; },
            [](RemoteDownloadFallbackRequest& request) { request.modId.clear(); },
            [](RemoteDownloadFallbackRequest& request) { request.versionId = "version-1"; },
            [](RemoteDownloadFallbackRequest& request) { request.jobId = "job-1"; },
            [](RemoteDownloadFallbackRequest& request) { request.grantId = "grant-1"; },
            [](RemoteDownloadFallbackRequest& request) {
                request.currentRepresentationProviderId = "Cloudflare_R2";
            },
            [](RemoteDownloadFallbackRequest& request) {
                request.currentRepresentationProviderId = "unknown_cdn";
            },
            [](RemoteDownloadFallbackRequest& request) { request.expectedSize = 0U; },
            [](RemoteDownloadFallbackRequest& request) {
                request.expectedSha256.assign(64U, 'A');
            },
            [](RemoteDownloadFallbackRequest& request) { request.operationId.clear(); }};

        for (const auto& mutate : invalidMutations)
        {
            RecordingDownloadClient client;
            ModdingFlowRemoteDownloadResolver resolver(client, {
                .nowUnixMilliseconds = [] { return nowUnixMs; }});
            RemoteDownloadFallbackRequest request = validFallbackRequest();
            mutate(request);
            try
            {
                static_cast<void>(resolver.resolveFallback(request));
                FAIL() << "Expected invalid fallback request rejection.";
            }
            catch (const ModdingFlowApiException& exception)
            {
                EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::InvalidRequest);
            }
            EXPECT_TRUE(client.requests.empty());
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, RejectsFallbackProvenanceGrantAndContentDrift)
    {
        constexpr std::string_view otherId = "66666666-6666-4666-8666-666666666666";
        const std::vector<std::string> invalid = {
            replaceOnce(
                fallbackSuccessJson(),
                "\"mod\":{\"id\":\"" + std::string(modId),
                "\"mod\":{\"id\":\"" + std::string(otherId)),
            replaceOnce(
                fallbackSuccessJson(),
                "\"version\":{\"id\":\"" + std::string(versionId),
                "\"version\":{\"id\":\"" + std::string(otherId)),
            replaceOnce(
                fallbackSuccessJson(),
                "\"artifact\":{\"id\":\"" + std::string(artifactId),
                "\"artifact\":{\"id\":\"" + std::string(otherId)),
            replaceOnce(
                fallbackSuccessJson(),
                "\"download_job\":{\"id\":\"" + std::string(jobId),
                "\"download_job\":{\"id\":\"" + std::string(otherId)),
            replaceOnce(
                fallbackSuccessJson(),
                "\"download_session_id\":\"" + std::string(grantId),
                "\"download_session_id\":\"" + std::string(otherId)),
            replaceOnce(
                fallbackSuccessJson(),
                "\"status\":\"grant_active\"",
                "\"status\":\"failed\""),
            replaceOnce(
                fallbackSuccessJson(),
                "\"status\":\"active\"",
                "\"status\":\"revoked\""),
            replaceOnce(
                fallbackSuccessJson(),
                "\"scan_status\":\"clean\"",
                "\"scan_status\":\"infected\""),
            replaceAll(fallbackSuccessJson(), sha256, std::string(64U, 'b')),
            replaceAll(fallbackSuccessJson(), "\"size_bytes\":1024", "\"size_bytes\":2048")};

        for (const std::string& json : invalid)
        {
            RecordingDownloadClient client;
            client.responses.push_back(responseFromJson(json));
            ModdingFlowRemoteDownloadResolver resolver(client, {
                .nowUnixMilliseconds = [] { return nowUnixMs; }});
            expectCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
                static_cast<void>(resolver.resolveFallback(validFallbackRequest()));
            });
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, RejectsExpiredOrInconsistentFallbackLifetime)
    {
        const std::string topExpiryPrefix =
            "\"fallback\":{\"provider\":\"bunny_pull_cdn\"},\"expires_at\":\"";
        const std::vector<std::string> invalid = {
            replaceOnce(
                fallbackSuccessJson(),
                topExpiryPrefix + "2026-07-30T00:10:00.000Z\"",
                topExpiryPrefix + "2026-07-29T23:59:00.000Z\""),
            replaceOnce(
                fallbackSuccessJson(),
                topExpiryPrefix + "2026-07-30T00:10:00.000Z\"",
                topExpiryPrefix + "2026-07-31T00:10:00.000Z\""),
            replaceOnce(
                fallbackSuccessJson(),
                "\"expires_in\":600",
                "\"expires_in\":60"),
            replaceOnce(
                fallbackSuccessJson(),
                "\"download_grant\":{\"id\":\"" + std::string(grantId) +
                    "\",\"artifact_id\":\"" + std::string(artifactId) +
                    "\",\"expires_at\":\"2026-07-30T00:10:00.000Z\"",
                "\"download_grant\":{\"id\":\"" + std::string(grantId) +
                    "\",\"artifact_id\":\"" + std::string(artifactId) +
                    "\",\"expires_at\":\"2026-07-29T23:59:00.000Z\"")};

        for (const std::string& json : invalid)
        {
            RecordingDownloadClient client;
            client.responses.push_back(responseFromJson(json));
            ModdingFlowRemoteDownloadResolver resolver(client, {
                .nowUnixMilliseconds = [] { return nowUnixMs; }});
            expectCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
                static_cast<void>(resolver.resolveFallback(validFallbackRequest()));
            });
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, RejectsReusedOrUnknownFallbackRepresentation)
    {
        const std::vector<std::string> invalid = {
            replaceAll(fallbackSuccessJson(), "bunny_pull_cdn", "cloudflare_r2"),
            replaceAll(fallbackSuccessJson(), "bunny_pull_cdn", "unknown_cdn"),
            replaceOnce(
                fallbackSuccessJson(),
                "\"representation\":{\"provider\":\"bunny_pull_cdn\",\"etag\":null,"
                    "\"etag_scope\":\"bunny_pull_cdn\"",
                "\"representation\":{\"provider\":\"bunny_pull_cdn\",\"etag\":null,"
                    "\"etag_scope\":\"cloudflare_r2\""),
            replaceOnce(
                fallbackSuccessJson(),
                "\"representation\":{\"provider\":\"bunny_pull_cdn\",\"etag\":null",
                "\"representation\":{\"provider\":\"bunny_pull_cdn\","
                    "\"etag\":\"\\\"old-etag\\\"\""),
            replaceOnce(
                fallbackSuccessJson(),
                "\"resume\":{\"range_supported\":true,\"etag\":null",
                "\"resume\":{\"range_supported\":true,\"etag\":\"\\\"old-etag\\\"\""),
            replaceOnce(
                fallbackSuccessJson(),
                "\"representation\":{\"provider\":\"bunny_pull_cdn\",\"etag\":null,"
                    "\"etag_scope\":\"bunny_pull_cdn\",\"if_match\":null,"
                    "\"head_url\":\"https://bunny.example.invalid/archive.7z?token=fallback-secret\","
                    "\"requires_head_before_range\":true",
                "\"representation\":{\"provider\":\"bunny_pull_cdn\",\"etag\":null,"
                    "\"etag_scope\":\"bunny_pull_cdn\",\"if_match\":null,"
                    "\"head_url\":\"https://bunny.example.invalid/archive.7z?token=fallback-secret\","
                    "\"requires_head_before_range\":false")};

        for (const std::string& json : invalid)
        {
            RecordingDownloadClient client;
            client.responses.push_back(responseFromJson(json));
            ModdingFlowRemoteDownloadResolver resolver(client, {
                .nowUnixMilliseconds = [] { return nowUnixMs; }});
            expectCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
                static_cast<void>(resolver.resolveFallback(validFallbackRequest()));
            });
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, RejectsUnsafeFallbackUrlWithoutReflectingSecret)
    {
        constexpr std::string_view secret = "never-reflect-fallback-secret";
        RecordingDownloadClient client;
        client.responses.push_back(responseFromJson(replaceAll(
            fallbackSuccessJson(),
            "https://bunny.example.invalid/archive.7z?token=fallback-secret",
            "https://user@bunny.example.invalid/archive.7z?token=" +
                std::string(secret))));
        ModdingFlowRemoteDownloadResolver resolver(client, {
            .nowUnixMilliseconds = [] { return nowUnixMs; }});

        try
        {
            static_cast<void>(resolver.resolveFallback(validFallbackRequest()));
            FAIL() << "Expected unsafe fallback URL rejection.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::ProtocolFailure);
            EXPECT_EQ(std::string(exception.what()).find(secret), std::string::npos);
        }
    }

    TEST(ModdingFlowRemoteDownloadResolverTests, FallbackPostIsNeverBlindlyRetried)
    {
        struct FailureCase
        {
            std::uint16_t status;
            std::string code;
            ModdingFlowApiErrorCode expected;
            bool retryable;
        };
        const std::vector<FailureCase> cases = {
            {404U, "artifact_not_found", ModdingFlowApiErrorCode::NotFound, false},
            {429U, "download_rate_limited", ModdingFlowApiErrorCode::RateLimited, true},
            {500U, "server_failure", ModdingFlowApiErrorCode::ServerFailure, true}};

        for (const FailureCase& failure : cases)
        {
            SCOPED_TRACE(failure.status);
            RecordingDownloadTransport transport;
            transport.responses.push_back(httpProblemResponse(
                failure.status,
                failure.code,
                failure.retryable,
                failure.status == 429U
                    ? std::optional<std::uint32_t>{0U}
                    : std::nullopt));
            transport.responses.push_back(httpJsonResponse(fallbackSuccessJson()));
            DownloadTokenProvider tokens;
            ModdingFlowPublicApiClient client(transport, &tokens, {
                .maximumAttempts = 2U,
                .sleep = [](std::chrono::milliseconds) {}});
            ModdingFlowRemoteDownloadResolver resolver(client, {
                .nowUnixMilliseconds = [] { return nowUnixMs; }});

            expectCode(failure.expected, [&] {
                static_cast<void>(resolver.resolveFallback(validFallbackRequest()));
            });

            ASSERT_EQ(transport.requests.size(), 1U);
            EXPECT_TRUE(headerValue(
                transport.requests.front(), "idempotency-key").empty());
            EXPECT_TRUE(headerValue(
                transport.requests.front(), "authorization").empty());
            EXPECT_TRUE(tokens.scopes.empty());
        }
    }
}
