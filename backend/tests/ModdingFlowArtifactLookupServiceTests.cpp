#include "FluxoraCore/Services/ModdingFlowArtifactLookupService.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <deque>
#include <string>
#include <utility>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        constexpr std::string_view gameId = "11111111-1111-4111-8111-111111111111";
        constexpr std::string_view modId = "22222222-2222-4222-8222-222222222222";
        constexpr std::string_view versionId = "33333333-3333-4333-8333-333333333333";
        constexpr std::string_view artifactId = "44444444-4444-4444-8444-444444444444";
        constexpr std::string_view sha256 =
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        class RecordingArtifactClient final : public IModdingFlowPublicApiClient
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

        class RecordingArtifactTransport final : public IModdingFlowHttpTransport
        {
        public:
            ModdingFlowHttpResponse send(const ModdingFlowHttpRequest& request) override
            {
                requests.push_back(request);
                if (responses.empty())
                {
                    throw std::runtime_error("No artifact transport response configured.");
                }
                ModdingFlowHttpResponse response = std::move(responses.front());
                responses.pop_front();
                return response;
            }

            std::vector<ModdingFlowHttpRequest> requests;
            std::deque<ModdingFlowHttpResponse> responses;
        };

        class RecordingArtifactTokenProvider final : public IModdingFlowAccessTokenProvider
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
                const std::size_t tokenIndex = std::min(
                    tokens.size() - 1U,
                    forceRefreshes.size() - 1U);
                return tokens[tokenIndex];
            }

            std::vector<std::string> tokens{"artifact-token"};
            std::vector<std::string> scopes;
            std::vector<std::wstring> operationIds;
            std::vector<bool> forceRefreshes;
        };

        std::string artifactMetadataJson()
        {
            return R"({"ok":true,"data":{"artifact_id":")" + std::string(artifactId) +
                R"(","mod_id":")" + std::string(modId) +
                R"(","version_id":")" + std::string(versionId) +
                R"(","game":{"id":")" + std::string(gameId) +
                R"(","slug":"skyrim-se"},"mod":{"id":")" + std::string(modId) +
                R"(","slug":"dragon-armor","game_slug":"skyrim-se","title":{"en":"Dragon Armor"},"summary":{"en":"Armor summary"},"author":{"display_name":"Creator","profile_url":"https://moddingflow.com/users/creator"},"visibility":"public","access_tier":"public","links":{"web":"https://moddingflow.com/mods/dragon-armor","api":"https://moddingflow.com/v1/mods/)" + std::string(modId) +
                R"(","versions":"https://moddingflow.com/v1/mods/)" + std::string(modId) +
                R"(/versions"}},"version":{"id":")" + std::string(versionId) +
                R"(","mod_id":")" + std::string(modId) +
                R"(","primary_artifact_id":")" + std::string(artifactId) +
                R"(","version":"1.0","semantic_version":"1.0.0","release_channel":"stable","game_versions":["1.6.1170"],"loaders":["skse"],"published_at":"2026-07-30T00:00:00Z","updated_at":"2026-07-30T00:00:00Z"},"artifact":{"id":")" + std::string(artifactId) +
                R"(","mod_id":")" + std::string(modId) +
                R"(","version_id":")" + std::string(versionId) +
                R"(","file_kind":"main","file_version":"1.0","label":"Main archive","filename":"dragon-armor.zip","original_filename":"dragon-armor.zip","content_type":"application/zip","game_version_key":"1.6.1170","loader_key":"skse","size_bytes":1024,"hashes":{"sha256":")" + std::string(sha256) +
                R"(","sha1":null},"artifact_source":"r2_blob","status":"published","scan_status":"clean"},"distribution":{"service":"moddingflow","website_url":"https://moddingflow.com","mod_url":"https://moddingflow.com/mods/dragon-armor","api_url":"https://moddingflow.com/v1/mods/)" + std::string(modId) +
                R"("},"verification":{"hashes":{"sha256":")" + std::string(sha256) +
                R"(","sha1":null},"size_bytes":1024},"download":{"resolve_endpoint":"/v1/downloads/)" + std::string(artifactId) +
                R"(/resolve"}}})";
        }

        ModdingFlowPublicApiResponse artifactResponse(std::wstring operationId)
        {
            return {
                parseModdingFlowJson(
                    artifactMetadataJson(),
                    {.maximumBytes = 128U * 1024U}),
                std::move(operationId),
                "artifact-request"};
        }

        ModdingFlowPublicApiResponse artifactResponseFromJson(
            std::string json,
            std::wstring operationId)
        {
            return {
                parseModdingFlowJson(json, {.maximumBytes = 128U * 1024U}),
                std::move(operationId),
                "artifact-request"};
        }

        ModdingFlowHttpResponse artifactHttpResponse(
            std::uint16_t statusCode,
            std::string body,
            std::string contentType = "application/json")
        {
            return {
                statusCode,
                {{"content-type", std::move(contentType)},
                    {"x-request-id", "artifact-request"}},
                std::move(body)};
        }

        ModdingFlowHttpResponse invalidTokenResponse()
        {
            return artifactHttpResponse(
                401U,
                R"({"type":"https://moddingflow.com/problems/invalid_token","title":"Request failed","detail":"Request failed","status":401,"instance":"/v1/artifacts/44444444-4444-4444-8444-444444444444","code":"invalid_token","machine_code":"invalid_token","request_id":"artifact-request","trace_id":"trace-1","ok":false,"retryable":false,"error":{"machine_code":"invalid_token","http_status":401,"message":"Request failed","trace_id":"trace-1","request_id":"artifact-request"}})",
                "application/problem+json");
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

        std::string replaceOnce(
            std::string value,
            std::string_view from,
            std::string_view to)
        {
            const std::size_t offset = value.find(from);
            if (offset == std::string::npos)
            {
                throw std::runtime_error("Artifact fixture replacement was not found.");
            }
            value.replace(offset, from.size(), to);
            return value;
        }

        template <typename Callback>
        void expectLookupCode(ModdingFlowApiErrorCode code, Callback callback)
        {
            try
            {
                callback();
                FAIL() << "Expected artifact lookup failure.";
            }
            catch (const ModdingFlowApiException& exception)
            {
                EXPECT_EQ(exception.code(), code) << exception.what();
            }
        }
    }

    TEST(ModdingFlowArtifactLookupServiceTests, ReturnsStrictMetadataPreviewFromExactArtifactEndpoint)
    {
        RecordingArtifactClient client;
        client.responses.push_back(artifactResponse(L"operation-artifact-preview"));
        ModdingFlowArtifactLookupService lookup(client);

        const ModdingFlowArtifactPreview preview = lookup.lookup(
            artifactId,
            ModdingFlowArtifactLookupAuthMode::Anonymous,
            L"operation-artifact-preview");

        EXPECT_EQ(preview.artifactId, artifactId);
        EXPECT_EQ(preview.modId, modId);
        EXPECT_EQ(preview.versionId, versionId);
        EXPECT_EQ(preview.gameId, gameId);
        EXPECT_EQ(preview.gameSlug, "skyrim-se");
        EXPECT_EQ(preview.title.at("en"), "Dragon Armor");
        EXPECT_EQ(preview.filename, "dragon-armor.zip");
        EXPECT_EQ(preview.sizeBytes, 1024U);
        EXPECT_EQ(preview.sha256, sha256);
        EXPECT_EQ(preview.operationId, L"operation-artifact-preview");
        ASSERT_EQ(client.requests.size(), 1U);
        EXPECT_EQ(
            client.requests.front().pathAndQuery,
            "/artifacts/" + std::string(artifactId));
        EXPECT_EQ(client.requests.front().method, ModdingFlowHttpMethod::Get);
        EXPECT_EQ(client.requests.front().auth, ModdingFlowApiAuthMode::Anonymous);
        EXPECT_EQ(client.requests.front().retry, ModdingFlowApiRetryMode::ReadOnly);
        EXPECT_TRUE(client.requests.front().requiredScope.empty());
        EXPECT_EQ(client.requests.front().maximumResponseBytes, 128U * 1024U);
    }

    TEST(ModdingFlowArtifactLookupServiceTests, RejectsInvalidArtifactIdentityBeforeEndpointConstruction)
    {
        RecordingArtifactClient client;
        ModdingFlowArtifactLookupService lookup(client);

        expectLookupCode(ModdingFlowApiErrorCode::InvalidRequest, [&]
        {
            static_cast<void>(lookup.lookup(
                "../../downloads/secret",
                ModdingFlowArtifactLookupAuthMode::Anonymous,
                L"operation-invalid-artifact"));
        });
        expectLookupCode(ModdingFlowApiErrorCode::InvalidRequest, [&]
        {
            static_cast<void>(lookup.lookup(
                artifactId,
                ModdingFlowArtifactLookupAuthMode::Anonymous,
                L""));
        });
        EXPECT_TRUE(client.requests.empty());
    }

    TEST(ModdingFlowArtifactLookupServiceTests, RejectsMalformedOrSensitiveUnknownResponseMembers)
    {
        const std::vector<std::string> invalidResponses{
            R"({"ok":true,"data":[]})",
            replaceOnce(
                artifactMetadataJson(),
                R"("artifact_id":")" + std::string(artifactId) + R"(",)",
                R"("artifact_id":")" + std::string(artifactId) +
                    R"(","primary_url":"https://storage.invalid/signed-secret",)"),
            replaceOnce(
                artifactMetadataJson(),
                R"("artifact_id":")" + std::string(artifactId) + R"(",)",
                R"("artifact_id":")" + std::string(artifactId) +
                    R"(","job_id":"job-secret",)"),
            replaceOnce(
                artifactMetadataJson(),
                R"("artifact_id":")" + std::string(artifactId) + R"(",)",
                R"("artifact_id":")" + std::string(artifactId) +
                    R"(","grant":{"token":"grant-secret"},)")};

        for (const std::string& json : invalidResponses)
        {
            RecordingArtifactClient client;
            client.responses.push_back(artifactResponseFromJson(
                json, L"operation-malformed-artifact"));
            ModdingFlowArtifactLookupService lookup(client);
            expectLookupCode(ModdingFlowApiErrorCode::ProtocolFailure, [&]
            {
                static_cast<void>(lookup.lookup(
                    artifactId,
                    ModdingFlowArtifactLookupAuthMode::Anonymous,
                    L"operation-malformed-artifact"));
            });
        }
    }

    TEST(ModdingFlowArtifactLookupServiceTests, RejectsEveryArtifactProvenanceMismatch)
    {
        const std::string otherArtifact = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const std::string otherMod = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        const std::string otherVersion = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        const std::vector<std::string> invalidResponses{
            replaceOnce(artifactMetadataJson(), artifactId, otherArtifact),
            replaceOnce(artifactMetadataJson(), modId, otherMod),
            replaceOnce(artifactMetadataJson(), versionId, otherVersion),
            replaceOnce(artifactMetadataJson(), "\"slug\":\"skyrim-se\"", "\"slug\":\"fallout-4\""),
            replaceOnce(artifactMetadataJson(), sha256,
                "baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            replaceOnce(artifactMetadataJson(), "\"size_bytes\":1024", "\"size_bytes\":2048"),
            replaceOnce(artifactMetadataJson(), "\"status\":\"published\"", "\"status\":\"draft\""),
            replaceOnce(artifactMetadataJson(), "\"scan_status\":\"clean\"", "\"scan_status\":\"pending\""),
            replaceOnce(artifactMetadataJson(), "\"artifact_source\":\"r2_blob\"", "\"artifact_source\":\"local\""),
            replaceOnce(artifactMetadataJson(),
                "/v1/downloads/" + std::string(artifactId) + "/resolve",
                "/v1/downloads/" + otherArtifact + "/resolve")};

        for (std::size_t index = 0U; index < invalidResponses.size(); ++index)
        {
            SCOPED_TRACE(index);
            RecordingArtifactClient client;
            client.responses.push_back(artifactResponseFromJson(
                invalidResponses[index], L"operation-provenance"));
            ModdingFlowArtifactLookupService lookup(client);
            expectLookupCode(ModdingFlowApiErrorCode::ProtocolFailure, [&]
            {
                static_cast<void>(lookup.lookup(
                    artifactId,
                    ModdingFlowArtifactLookupAuthMode::Anonymous,
                    L"operation-provenance"));
            });
        }
    }

    TEST(ModdingFlowArtifactLookupServiceTests, AcceptsNullableClosedAuthorProfileWithoutSurfacingIt)
    {
        RecordingArtifactClient client;
        client.responses.push_back(artifactResponseFromJson(
            replaceOnce(
                artifactMetadataJson(),
                R"("profile_url":"https://moddingflow.com/users/creator")",
                R"("profile_url":null)"),
            L"operation-null-profile"));
        ModdingFlowArtifactLookupService lookup(client);

        const ModdingFlowArtifactPreview preview = lookup.lookup(
            artifactId,
            ModdingFlowArtifactLookupAuthMode::Anonymous,
            L"operation-null-profile");

        ASSERT_TRUE(preview.authorDisplayName.has_value());
        EXPECT_EQ(*preview.authorDisplayName, "Creator");
    }

    TEST(ModdingFlowArtifactLookupServiceTests, RejectsOperationCorrelationMismatch)
    {
        RecordingArtifactClient client;
        client.responses.push_back(artifactResponse(L"operation-from-other-request"));
        ModdingFlowArtifactLookupService lookup(client);

        expectLookupCode(ModdingFlowApiErrorCode::ProtocolFailure, [&]
        {
            static_cast<void>(lookup.lookup(
                artifactId,
                ModdingFlowArtifactLookupAuthMode::Anonymous,
                L"operation-artifact-correlation"));
        });
    }

    TEST(ModdingFlowArtifactLookupServiceTests, BearerLookupUsesModsReadAndOneValidated401Refresh)
    {
        RecordingArtifactTransport transport;
        transport.responses.push_back(invalidTokenResponse());
        transport.responses.push_back(artifactHttpResponse(200U, artifactMetadataJson()));
        RecordingArtifactTokenProvider tokens;
        tokens.tokens = {"token-before", "token-after"};
        ModdingFlowPublicApiClient client(transport, &tokens);
        ModdingFlowArtifactLookupService lookup(client);

        const ModdingFlowArtifactPreview preview = lookup.lookup(
            artifactId,
            ModdingFlowArtifactLookupAuthMode::BearerModsRead,
            L"operation-artifact-refresh");

        EXPECT_EQ(preview.artifactId, artifactId);
        ASSERT_EQ(tokens.forceRefreshes.size(), 2U);
        EXPECT_FALSE(tokens.forceRefreshes[0]);
        EXPECT_TRUE(tokens.forceRefreshes[1]);
        EXPECT_EQ(tokens.scopes, (std::vector<std::string>{"mods:read", "mods:read"}));
        EXPECT_EQ(tokens.operationIds, (std::vector<std::wstring>{
            L"operation-artifact-refresh", L"operation-artifact-refresh"}));
        ASSERT_EQ(transport.requests.size(), 2U);
        for (const ModdingFlowHttpRequest& request : transport.requests)
        {
            EXPECT_EQ(
                request.url,
                "https://moddingflow.com/v1/artifacts/" + std::string(artifactId));
            EXPECT_EQ(request.method, ModdingFlowHttpMethod::Get);
            EXPECT_EQ(request.operationId, L"operation-artifact-refresh");
            EXPECT_EQ(request.maximumResponseBodyBytes, 128U * 1024U);
        }
        EXPECT_EQ(headerValue(transport.requests[0], "authorization"), "Bearer token-before");
        EXPECT_EQ(headerValue(transport.requests[1], "authorization"), "Bearer token-after");
    }

    TEST(ModdingFlowArtifactLookupServiceTests, BearerLookupNeverRefreshesASecond401Twice)
    {
        RecordingArtifactTransport transport;
        transport.responses.push_back(invalidTokenResponse());
        transport.responses.push_back(invalidTokenResponse());
        RecordingArtifactTokenProvider tokens;
        tokens.tokens = {"token-before", "token-after", "token-never-used"};
        ModdingFlowPublicApiClient client(transport, &tokens, {.maximumAttempts = 3U});
        ModdingFlowArtifactLookupService lookup(client);

        expectLookupCode(ModdingFlowApiErrorCode::Unauthorized, [&]
        {
            static_cast<void>(lookup.lookup(
                artifactId,
                ModdingFlowArtifactLookupAuthMode::BearerModsRead,
                L"operation-artifact-refresh-once"));
        });

        EXPECT_EQ(tokens.forceRefreshes, (std::vector<bool>{false, true}));
        EXPECT_EQ(tokens.scopes, (std::vector<std::string>{"mods:read", "mods:read"}));
        EXPECT_EQ(transport.requests.size(), 2U);
    }
}
