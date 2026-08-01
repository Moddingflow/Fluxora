#include "FluxoraCore/Services/ModdingFlowProviderCatalog.hpp"

#include <gtest/gtest.h>

#include <deque>
#include <string>
#include <utility>

namespace fluxora::tests
{
    namespace
    {
        class RecordingCatalogClient final : public IModdingFlowPublicApiClient
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

        ModdingFlowPublicApiResponse catalogResponse(
            std::string_view json,
            std::wstring operationId)
        {
            return {
                parseModdingFlowJson(json, {.maximumBytes = 128U * 1024U}),
                std::move(operationId),
                "catalog-request"};
        }

        constexpr std::string_view gameId = "11111111-1111-4111-8111-111111111111";
        constexpr std::string_view modId = "22222222-2222-4222-8222-222222222222";
        constexpr std::string_view versionId = "33333333-3333-4333-8333-333333333333";
        constexpr std::string_view artifactId = "44444444-4444-4444-8444-444444444444";
        constexpr std::string_view dependencyId = "55555555-5555-4555-8555-555555555555";
        constexpr std::string_view sha256 =
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        std::string modJson()
        {
            return R"({"id":")" + std::string(modId) +
                R"(","slug":"dragon-armor","game_slug":"skyrim-se","title":{"en":"Dragon Armor"},"summary":{"en":"Armor summary"},"updated_at":"2026-07-30T00:00:00Z"})";
        }

        std::string artifactJson(
            std::string status = "published",
            std::string scanStatus = "clean",
            std::string resolveEndpoint = {})
        {
            if (resolveEndpoint.empty())
            {
                resolveEndpoint = "/v1/downloads/" + std::string(artifactId) + "/resolve";
            }
            return R"({"id":")" + std::string(artifactId) +
                R"(","mod_id":")" + std::string(modId) +
                R"(","version_id":")" + std::string(versionId) +
                R"(","file_kind":"main","file_version":"1.0","label":"Main archive","original_filename":"trusted-provider.zip","content_type":"application/zip","game_version_key":"1.6.1170","loader_key":"skse","size_bytes":1024,"sha256":")" +
                std::string(sha256) + R"(","hashes":{"sha256":")" + std::string(sha256) +
                R"(","sha1":null},"artifact_source":"r2_blob","status":")" + status +
                R"(","scan_status":")" + scanStatus +
                R"(","download_metadata":{"resolve_endpoint":")" + resolveEndpoint +
                R"(","range_supported":true}})";
        }

        std::string versionJson(std::string artifact = {})
        {
            std::string json = R"({"id":")" + std::string(versionId) +
                R"(","mod_id":")" + std::string(modId) +
                R"(","version":"1.0","release_channel":"stable","game_versions":["1.6.1170"],"loaders":["skse"],"artifact_ids":[")" +
                std::string(artifactId) + R"("] )";
            if (!artifact.empty())
            {
                json.pop_back();
                json += R"(,"artifacts":[)" + artifact + "]";
            }
            json += R"(,"published_at":"2026-07-30T00:00:00Z"})";
            return json;
        }

        template <typename Callback>
        void expectCatalogCode(ModdingFlowApiErrorCode code, Callback callback)
        {
            try
            {
                callback();
                FAIL() << "Expected catalog failure.";
            }
            catch (const ModdingFlowApiException& exception)
            {
                EXPECT_EQ(exception.code(), code) << exception.what();
            }
        }
    }

    TEST(ModdingFlowProviderCatalogTests, ListsGamesAnonymouslyWithBoundedTypedFields)
    {
        RecordingCatalogClient client;
        client.responses.push_back(catalogResponse(
            R"({"ok":true,"data":{"items":[{"id":"11111111-1111-4111-8111-111111111111","slug":"skyrim-se","title":{"en":"Skyrim Special Edition"},"is_enabled":true}]}})",
            L"operation-games"));
        ModdingFlowProviderCatalog catalog(client);

        const std::vector<ModProviderGame> games = catalog.listGames(L"operation-games");

        ASSERT_EQ(games.size(), 1U);
        EXPECT_EQ(games.front().id, "11111111-1111-4111-8111-111111111111");
        EXPECT_EQ(games.front().slug, "skyrim-se");
        EXPECT_EQ(games.front().title.at("en"), "Skyrim Special Edition");
        EXPECT_TRUE(games.front().enabled);
        ASSERT_EQ(client.requests.size(), 1U);
        EXPECT_EQ(client.requests.front().pathAndQuery, "/games");
        EXPECT_EQ(client.requests.front().auth, ModdingFlowApiAuthMode::Anonymous);
        EXPECT_EQ(client.requests.front().operationId, L"operation-games");
    }

    TEST(ModdingFlowProviderCatalogTests, ModCursorIsBoundToNormalizedFilterIdentity)
    {
        RecordingCatalogClient client;
        client.responses.push_back(catalogResponse(
            R"({"ok":true,"data":{"items":[)" + modJson() +
                R"(],"pagination":{"limit":25,"next_cursor":"v1.opaque-next","order":"latest"}}})",
            L"operation-mods"));
        ModdingFlowProviderCatalog catalog(client);
        ModProviderModQuery query;
        query.gameSlug = "skyrim-se";
        query.query = "  Dragon   Armor ";
        query.sort = "latest";
        query.gameVersion = "1.6.1170";
        query.loader = "skse";
        query.category = "armor";

        const ModProviderCatalogPage<ModProviderMod> page =
            catalog.listMods(query, L"operation-mods");

        ASSERT_EQ(page.items.size(), 1U);
        EXPECT_EQ(page.items.front().id, modId);
        ASSERT_TRUE(page.nextCursor.has_value());
        EXPECT_EQ(page.nextCursor->opaque, "v1.opaque-next");
        const std::string expectedIdentity =
            "/mods?limit=25&game_slug=skyrim-se&q=dragon%20armor&sort=latest&game_version=1.6.1170&loader=skse&category=armor";
        EXPECT_EQ(page.nextCursor->queryIdentity, expectedIdentity);
        ASSERT_EQ(client.requests.size(), 1U);
        EXPECT_EQ(client.requests.front().pathAndQuery, expectedIdentity);
        EXPECT_EQ(client.requests.front().auth, ModdingFlowApiAuthMode::Anonymous);

        ModProviderModQuery changed = query;
        changed.sort = "downloads";
        changed.cursor = page.nextCursor;
        expectCatalogCode(ModdingFlowApiErrorCode::InvalidRequest, [&] {
            static_cast<void>(catalog.listMods(changed, L"operation-mods-changed"));
        });
        EXPECT_EQ(client.requests.size(), 1U);
    }

    TEST(ModdingFlowProviderCatalogTests, EnforcesPageUuidSlugAndStringBoundsBeforeTransport)
    {
        RecordingCatalogClient client;
        ModdingFlowProviderCatalog catalog(client);

        ModProviderModQuery tooLarge;
        tooLarge.limit = 101U;
        expectCatalogCode(ModdingFlowApiErrorCode::InvalidRequest, [&] {
            static_cast<void>(catalog.listMods(tooLarge, L"operation-limit"));
        });
        expectCatalogCode(ModdingFlowApiErrorCode::InvalidRequest, [&] {
            static_cast<void>(catalog.getMod("NOT-A-UUID", L"operation-id"));
        });
        expectCatalogCode(ModdingFlowApiErrorCode::InvalidRequest, [&] {
            static_cast<void>(catalog.getVersion(modId, "bad-version-id", L"operation-version"));
        });
        EXPECT_TRUE(client.requests.empty());
    }

    TEST(ModdingFlowProviderCatalogTests, ParsesCanonicalVersionArtifactsWithoutExposingTransportUrls)
    {
        RecordingCatalogClient client;
        client.responses.push_back(catalogResponse(
            R"({"ok":true,"data":)" + versionJson(artifactJson()) + "}",
            L"operation-version"));
        ModdingFlowProviderCatalog catalog(client);

        const ModProviderVersion version = catalog.getVersion(
            modId,
            versionId,
            L"operation-version");

        ASSERT_EQ(version.artifacts.size(), 1U);
        const ModProviderArtifact& artifact = version.artifacts.front();
        EXPECT_EQ(artifact.id, artifactId);
        EXPECT_EQ(artifact.originalFilename, "trusted-provider.zip");
        EXPECT_EQ(artifact.sizeBytes, 1024U);
        EXPECT_EQ(artifact.sha256, sha256);
        EXPECT_EQ(artifact.hashes.at("sha256"), sha256);
        ASSERT_EQ(client.requests.size(), 1U);
        EXPECT_EQ(
            client.requests.front().pathAndQuery,
            "/mods/" + std::string(modId) + "/versions/" + std::string(versionId));
        EXPECT_EQ(client.requests.front().auth, ModdingFlowApiAuthMode::Anonymous);
    }

    TEST(ModdingFlowProviderCatalogTests, RejectsDirtyOrAbsoluteResolveArtifactMetadata)
    {
        const std::vector<std::string> invalidArtifacts = {
            artifactJson("published", "infected"),
            artifactJson("published", "clean", "https://storage.invalid/signed-secret")};
        for (const std::string& artifact : invalidArtifacts)
        {
            RecordingCatalogClient client;
            client.responses.push_back(catalogResponse(
                R"({"ok":true,"data":)" + versionJson(artifact) + "}",
                L"operation-invalid-artifact"));
            ModdingFlowProviderCatalog catalog(client);
            expectCatalogCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
                static_cast<void>(catalog.getVersion(
                    modId,
                    versionId,
                    L"operation-invalid-artifact"));
            });
        }
    }

    TEST(ModdingFlowProviderCatalogTests, ParsesCanonicalDependenciesWithoutLeakingExternalUrls)
    {
        RecordingCatalogClient client;
        const std::string json = R"({"ok":true,"data":{"items":[{"id":")" +
            std::string(dependencyId) + R"(","mod_id":")" + std::string(modId) +
            R"(","target_mod_id":")" + std::string(gameId) +
            R"(","dependency_kind":"required_mod","dependency_semantic":"required","label":"Required library","url":"https://example.invalid/untrusted","note":"Needed","relation":">=1.0"}]}})";
        client.responses.push_back(catalogResponse(json, L"operation-dependencies"));
        ModdingFlowProviderCatalog catalog(client);

        const std::vector<ModProviderDependency> dependencies = catalog.listDependencies(
            modId,
            L"operation-dependencies");

        ASSERT_EQ(dependencies.size(), 1U);
        EXPECT_EQ(dependencies.front().id, dependencyId);
        EXPECT_EQ(dependencies.front().targetModId, gameId);
        EXPECT_EQ(dependencies.front().semantic, "required");
        EXPECT_EQ(dependencies.front().relation, ">=1.0");
        EXPECT_EQ(client.requests.front().auth, ModdingFlowApiAuthMode::Anonymous);
    }

    TEST(ModdingFlowProviderCatalogTests, RejectsOversizePagesAndMismatchedOperationCorrelation)
    {
        std::string items;
        for (std::size_t index = 0U; index < 101U; ++index)
        {
            if (!items.empty()) items.push_back(',');
            items += R"({"id":")" + std::string(gameId) +
                R"(","slug":"skyrim-se","title":{"en":"Skyrim"},"is_enabled":true})";
        }
        RecordingCatalogClient oversizedClient;
        oversizedClient.responses.push_back(catalogResponse(
            R"({"ok":true,"data":{"items":[)" + items + "]}}",
            L"operation-oversize"));
        ModdingFlowProviderCatalog oversizedCatalog(oversizedClient);
        expectCatalogCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
            static_cast<void>(oversizedCatalog.listGames(L"operation-oversize"));
        });

        RecordingCatalogClient correlationClient;
        correlationClient.responses.push_back(catalogResponse(
            R"({"ok":true,"data":{"items":[]}})",
            L"different-operation"));
        ModdingFlowProviderCatalog correlationCatalog(correlationClient);
        expectCatalogCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
            static_cast<void>(correlationCatalog.listGames(L"operation-correlation"));
        });
    }
}
