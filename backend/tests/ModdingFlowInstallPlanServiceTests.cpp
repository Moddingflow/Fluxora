#include "FluxoraCore/Services/ModdingFlowInstallPlanService.hpp"

#include <gtest/gtest.h>

#include <deque>
#include <functional>
#include <optional>
#include <utility>

namespace fluxora::tests
{
    namespace
    {
        class RecordingInstallPlanClient final : public IModdingFlowPublicApiClient
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

        constexpr std::string_view artifactId = "44444444-4444-4444-8444-444444444444";
        constexpr std::string_view versionId = "33333333-3333-4333-8333-333333333333";
        constexpr std::string_view modId = "22222222-2222-4222-8222-222222222222";
        constexpr std::string_view sha256 =
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        ModdingFlowPublicApiResponse planResponse(std::wstring operationId)
        {
            const std::string json =
                R"({"ok":true,"data":{"plan_id":"11111111-1111-4111-8111-111111111111","game_slug":"skyrim-se","game_version":"1.6.1170","release_channel":"stable","dependency_constraints":[],"conflicts":[],"required_disk_size_bytes":1024,"install_order":[{"step_index":1,"mod_id":")" +
                std::string(modId) + R"(","version_id":")" + std::string(versionId) +
                R"(","artifact_id":")" + std::string(artifactId) +
                R"(","required":true,"selection_kind":"selected_artifact","decision_reasons":["explicit"],"file":{"kind":"main","file_version":"1.0","label":"Trusted provider name","filename":"trusted-provider.zip","content_type":"application/zip","size_bytes":1024},"sha256":")" +
                std::string(sha256) + R"(","hashes":{"sha256":")" + std::string(sha256) +
                R"(","sha1":null}}],"file_hashes":[{"artifact_id":")" + std::string(artifactId) +
                R"(","sha256":")" + std::string(sha256) + R"(","hashes":{"sha256":")" +
                std::string(sha256) + R"(","sha1":null}}],"warnings":[]}})";
            return {
                parseModdingFlowJson(json, {.maximumBytes = 128U * 1024U}),
                std::move(operationId),
                "plan-request"};
        }

        ModdingFlowPublicApiResponse customPlanResponse(
            std::string json,
            std::wstring operationId)
        {
            return {
                parseModdingFlowJson(json, {.maximumBytes = 128U * 1024U}),
                std::move(operationId),
                "plan-request"};
        }

        class ThrowingInstallPlanClient final : public IModdingFlowPublicApiClient
        {
        public:
            ModdingFlowPublicApiResponse execute(const ModdingFlowPublicApiRequest& request) override
            {
                requests.push_back(request);
                throw ModdingFlowApiException(
                    code,
                    "provider failure",
                    request.operationId,
                    status);
            }

            ModdingFlowApiErrorCode code{ModdingFlowApiErrorCode::NotFound};
            std::uint16_t status{404U};
            std::vector<ModdingFlowPublicApiRequest> requests;
        };

        class RestrictedInstallPlanClient final : public IModdingFlowPublicApiClient
        {
        public:
            ModdingFlowPublicApiResponse execute(
                const ModdingFlowPublicApiRequest& request) override
            {
                requests.push_back(request);
                if (requests.size() == 1U)
                {
                    throw ModdingFlowApiException(
                        ModdingFlowApiErrorCode::Forbidden,
                        "restricted plan",
                        request.operationId,
                        403U);
                }
                return planResponse(request.operationId);
            }

            std::vector<ModdingFlowPublicApiRequest> requests;
        };

        template <typename Callback>
        void expectPlanCode(ModdingFlowApiErrorCode code, Callback callback)
        {
            try
            {
                callback();
                FAIL() << "Expected install-plan failure.";
            }
            catch (const ModdingFlowApiException& exception)
            {
                EXPECT_EQ(exception.code(), code) << exception.what();
            }
        }
    }

    TEST(ModdingFlowInstallPlanServiceTests, ResolvesPreviewWithIdempotencyAndNoMutationCapability)
    {
        RecordingInstallPlanClient client;
        client.responses.push_back(planResponse(L"operation-plan"));
        ModdingFlowInstallPlanService service(client);

        const ModdingFlowInstallPlan plan = service.resolve({
            .artifactIds = {std::string(artifactId)},
            .gameSlug = "skyrim-se",
            .gameVersion = "1.6.1170",
            .idempotencyKey = "plan-key-0001",
            .operationId = L"operation-plan"});

        ASSERT_EQ(client.requests.size(), 1U);
        EXPECT_EQ(client.requests.front().method, ModdingFlowHttpMethod::Post);
        EXPECT_EQ(client.requests.front().pathAndQuery, "/install-plans:resolve");
        EXPECT_EQ(client.requests.front().auth, ModdingFlowApiAuthMode::Anonymous);
        EXPECT_EQ(client.requests.front().retry, ModdingFlowApiRetryMode::Idempotent);
        EXPECT_EQ(client.requests.front().idempotencyKey, "plan-key-0001");
        EXPECT_EQ(client.requests.front().operationId, L"operation-plan");
        ASSERT_EQ(plan.steps.size(), 1U);
        EXPECT_EQ(plan.steps.front().artifactId, artifactId);
        EXPECT_EQ(plan.steps.front().sha256, sha256);
        EXPECT_EQ(plan.idempotencyKey, "plan-key-0001");
        EXPECT_EQ(plan.operationId, L"operation-plan");
    }

    TEST(ModdingFlowInstallPlanServiceTests, ActivationPreviewAcceptsOnlyIdsAndUsesProviderMetadata)
    {
        RecordingInstallPlanClient client;
        client.responses.push_back(planResponse(L"operation-preview"));
        ModdingFlowInstallPlanService service(client);
        IModProviderActivationPreviewResolver& preview = service;

        const ModdingFlowInstallPlan result = preview.previewActivation({
            .artifactIds = {std::string(artifactId)},
            .gameSlug = "skyrim-se",
            .gameVersion = "1.6.1170",
            .idempotencyKey = "preview-key-0001",
            .operationId = L"operation-preview"});

        ASSERT_EQ(result.steps.size(), 1U);
        EXPECT_EQ(result.steps.front().filename, "trusted-provider.zip");
        EXPECT_EQ(result.steps.front().label, "Trusted provider name");
        ASSERT_EQ(client.requests.size(), 1U);
        EXPECT_EQ(client.requests.front().body.find("trusted-provider.zip"), std::string::npos);
        EXPECT_EQ(client.requests.front().body.find("Trusted provider name"), std::string::npos);
        EXPECT_NE(client.requests.front().body.find(std::string(artifactId)), std::string::npos);
    }

    TEST(ModdingFlowInstallPlanServiceTests, RestrictedActivationPlanFallsBackOnceToScopedBearer)
    {
        RestrictedInstallPlanClient client;
        ModdingFlowInstallPlanService service(client);

        const ModdingFlowInstallPlan result = service.previewActivation({
            .artifactIds = {std::string(artifactId)},
            .gameSlug = "skyrim-se",
            .gameVersion = "1.6.1170",
            .idempotencyKey = "restricted-key-0001",
            .operationId = L"operation-restricted"});

        ASSERT_EQ(result.steps.size(), 1U);
        ASSERT_EQ(client.requests.size(), 2U);
        EXPECT_EQ(client.requests[0].auth, ModdingFlowApiAuthMode::Anonymous);
        EXPECT_TRUE(client.requests[0].requiredScope.empty());
        EXPECT_EQ(client.requests[1].auth, ModdingFlowApiAuthMode::BearerRequired);
        EXPECT_EQ(client.requests[1].requiredScope, "install_plans:resolve");
        EXPECT_EQ(client.requests[0].idempotencyKey, client.requests[1].idempotencyKey);
        EXPECT_EQ(client.requests[0].body, client.requests[1].body);
    }

    TEST(ModdingFlowInstallPlanServiceTests, GeneratedKeyCanBeReplayedExactlyWithoutSecondNetworkCall)
    {
        RecordingInstallPlanClient client;
        client.responses.push_back(planResponse(L"operation-generated"));
        ModdingFlowInstallPlanService service(client, {
            .maximumCachedReplays = 8U,
            .generateIdempotencyKey = [] { return "generated-plan-key-0001"; }});
        ModdingFlowInstallPlanRequest request{
            .artifactIds = {std::string(artifactId)},
            .gameSlug = "skyrim-se",
            .gameVersion = "1.6.1170",
            .operationId = L"operation-generated"};

        const ModdingFlowInstallPlan first = service.resolve(request);
        request.idempotencyKey = first.idempotencyKey;
        request.operationId = L"operation-generated-replay";
        const ModdingFlowInstallPlan replay = service.resolve(request);

        EXPECT_EQ(first.idempotencyKey, "generated-plan-key-0001");
        EXPECT_EQ(client.requests.size(), 1U);
        ModdingFlowInstallPlan normalizedFirst = first;
        ModdingFlowInstallPlan normalizedReplay = replay;
        normalizedFirst.operationId.clear();
        normalizedReplay.operationId.clear();
        EXPECT_EQ(normalizedFirst, normalizedReplay);
        EXPECT_EQ(replay.operationId, L"operation-generated-replay");
    }

    TEST(ModdingFlowInstallPlanServiceTests, SameKeyDifferentNormalizedRequestIsTyped409WithoutNetwork)
    {
        RecordingInstallPlanClient client;
        client.responses.push_back(planResponse(L"operation-first"));
        ModdingFlowInstallPlanService service(client);
        static_cast<void>(service.resolve({
            .artifactIds = {std::string(artifactId)},
            .gameSlug = "skyrim-se",
            .gameVersion = "1.6.1170",
            .idempotencyKey = "shared-plan-key-0001",
            .operationId = L"operation-first"}));

        try
        {
            static_cast<void>(service.resolve({
                .artifactIds = {std::string(artifactId)},
                .gameSlug = "skyrim-se",
                .gameVersion = "1.5.97",
                .idempotencyKey = "shared-plan-key-0001",
                .operationId = L"operation-mismatch"}));
            FAIL() << "Expected local idempotency mismatch.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::IdempotencyMismatch);
            EXPECT_EQ(exception.statusCode(), 409U);
            EXPECT_EQ(exception.operationId(), L"operation-mismatch");
        }
        EXPECT_EQ(client.requests.size(), 1U);
    }

    TEST(ModdingFlowInstallPlanServiceTests, DuplicateSelectionsNormalizeToOneDeterministicRequest)
    {
        RecordingInstallPlanClient client;
        client.responses.push_back(planResponse(L"operation-normalize"));
        ModdingFlowInstallPlanService service(client);

        static_cast<void>(service.resolve({
            .artifactIds = {std::string(artifactId), std::string(artifactId)},
            .gameSlug = "skyrim-se",
            .gameVersion = "1.6.1170",
            .idempotencyKey = "normalized-key-0001",
            .operationId = L"operation-normalize"}));

        ASSERT_EQ(client.requests.size(), 1U);
        const std::string& body = client.requests.front().body;
        const std::size_t first = body.find(std::string(artifactId));
        ASSERT_NE(first, std::string::npos);
        EXPECT_EQ(body.find(std::string(artifactId), first + 1U), std::string::npos);
    }

    TEST(ModdingFlowInstallPlanServiceTests, DependenciesAndConflictsAreCanonicalAndDeterministicallySorted)
    {
        constexpr std::string_view dependencyA = "55555555-5555-4555-8555-555555555555";
        constexpr std::string_view dependencyB = "66666666-6666-4666-8666-666666666666";
        const std::string json =
            R"({"ok":true,"data":{"plan_id":"11111111-1111-4111-8111-111111111111","game_slug":"skyrim-se","game_version":"1.6.1170","release_channel":"stable","dependency_constraints":[{"dependency_id":")" +
            std::string(dependencyB) + R"(","mod_id":")" + std::string(modId) +
            R"(","target_mod_id":"77777777-7777-4777-8777-777777777777","semantic":"optional","relation":">=2","reason":"B"},{"dependency_id":")" +
            std::string(dependencyA) + R"(","mod_id":")" + std::string(modId) +
            R"(","target_mod_id":"88888888-8888-4888-8888-888888888888","semantic":"required","relation":">=1","reason":"A"}],"conflicts":[{"dependency_id":"99999999-9999-4999-8999-999999999999","mod_id":")" +
            std::string(modId) +
            R"(","target_mod_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","semantic":"conflict","relation":"incompatible","reason":"Conflict"}],"install_order":[{"step_index":1,"mod_id":")" +
            std::string(modId) + R"(","version_id":")" + std::string(versionId) +
            R"(","artifact_id":")" + std::string(artifactId) +
            R"(","required":true,"file":{"kind":"main","size_bytes":1024},"sha256":")" +
            std::string(sha256) + R"(","hashes":{"sha256":")" + std::string(sha256) +
            R"("}}],"file_hashes":[{"artifact_id":")" + std::string(artifactId) +
            R"(","sha256":")" + std::string(sha256) + R"(","hashes":{"sha256":")" +
            std::string(sha256) + R"("}}],"warnings":["review_conflicts"]}})";
        RecordingInstallPlanClient client;
        client.responses.push_back(customPlanResponse(json, L"operation-constraints"));
        ModdingFlowInstallPlanService service(client);

        const ModdingFlowInstallPlan plan = service.resolve({
            .artifactIds = {std::string(artifactId)},
            .gameSlug = "skyrim-se",
            .gameVersion = "1.6.1170",
            .idempotencyKey = "constraints-key-0001",
            .operationId = L"operation-constraints"});

        ASSERT_EQ(plan.dependencies.size(), 2U);
        EXPECT_EQ(plan.dependencies[0].dependencyId, dependencyA);
        EXPECT_EQ(plan.dependencies[1].dependencyId, dependencyB);
        ASSERT_EQ(plan.conflicts.size(), 1U);
        EXPECT_EQ(plan.conflicts.front().relation, "incompatible");
        EXPECT_EQ(plan.warnings, std::vector<std::string>({"review_conflicts"}));
    }

    TEST(ModdingFlowInstallPlanServiceTests, RejectsHashMismatchAndOperationMismatch)
    {
        const std::string badHash(64U, 'b');
        const std::string mismatched =
            R"({"ok":true,"data":{"plan_id":"11111111-1111-4111-8111-111111111111","game_slug":"skyrim-se","game_version":"1.6.1170","install_order":[{"mod_id":")" +
            std::string(modId) + R"(","version_id":")" + std::string(versionId) +
            R"(","artifact_id":")" + std::string(artifactId) +
            R"(","required":true,"file":{"kind":"main","size_bytes":1},"sha256":")" +
            std::string(sha256) + R"(","hashes":{"sha256":")" + std::string(sha256) +
            R"("}}],"file_hashes":[{"artifact_id":")" + std::string(artifactId) +
            R"(","sha256":")" + badHash + R"(","hashes":{"sha256":")" + badHash +
            R"("}}],"warnings":[]}})";
        RecordingInstallPlanClient hashClient;
        hashClient.responses.push_back(customPlanResponse(mismatched, L"operation-hash"));
        ModdingFlowInstallPlanService hashService(hashClient);
        expectPlanCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
            static_cast<void>(hashService.resolve({
                .artifactIds = {std::string(artifactId)},
                .gameSlug = "skyrim-se",
                .gameVersion = "1.6.1170",
                .idempotencyKey = "hash-key-0001",
                .operationId = L"operation-hash"}));
        });

        RecordingInstallPlanClient operationClient;
        operationClient.responses.push_back(planResponse(L"different-operation"));
        ModdingFlowInstallPlanService operationService(operationClient);
        expectPlanCode(ModdingFlowApiErrorCode::ProtocolFailure, [&] {
            static_cast<void>(operationService.resolve({
                .artifactIds = {std::string(artifactId)},
                .gameSlug = "skyrim-se",
                .gameVersion = "1.6.1170",
                .idempotencyKey = "operation-key-0001",
                .operationId = L"operation-correlation"}));
        });
    }

    TEST(ModdingFlowInstallPlanServiceTests, DeletedArtifactProviderFailureRemainsTypedAndDoesNotCache)
    {
        ThrowingInstallPlanClient client;
        ModdingFlowInstallPlanService service(client);

        try
        {
            static_cast<void>(service.resolve({
                .artifactIds = {std::string(artifactId)},
                .gameSlug = "skyrim-se",
                .gameVersion = "1.6.1170",
                .idempotencyKey = "deleted-key-0001",
                .operationId = L"operation-deleted"}));
            FAIL() << "Expected deleted artifact failure.";
        }
        catch (const ModdingFlowApiException& exception)
        {
            EXPECT_EQ(exception.code(), ModdingFlowApiErrorCode::NotFound);
            EXPECT_EQ(exception.statusCode(), 404U);
            EXPECT_EQ(exception.operationId(), L"operation-deleted");
        }
        EXPECT_EQ(client.requests.size(), 1U);
    }

    TEST(ModdingFlowInstallPlanServiceTests, RejectsMissingOrOversizeSelectionsBeforeNetwork)
    {
        RecordingInstallPlanClient client;
        ModdingFlowInstallPlanService service(client);
        expectPlanCode(ModdingFlowApiErrorCode::InvalidRequest, [&] {
            static_cast<void>(service.resolve({
                .gameSlug = "skyrim-se",
                .gameVersion = "1.6.1170",
                .idempotencyKey = "missing-key-0001",
                .operationId = L"operation-missing"}));
        });

        std::vector<std::string> tooMany(129U, std::string(artifactId));
        expectPlanCode(ModdingFlowApiErrorCode::InvalidRequest, [&] {
            static_cast<void>(service.resolve({
                .artifactIds = tooMany,
                .gameSlug = "skyrim-se",
                .gameVersion = "1.6.1170",
                .idempotencyKey = "oversize-key-0001",
                .operationId = L"operation-oversize"}));
        });
        EXPECT_TRUE(client.requests.empty());
    }
}
