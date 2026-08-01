#include "FluxoraCore/Services/RemoteDownloadProviderRegistry.hpp"
#include "FluxoraCore/Services/RemoteDownloadCoordinator.hpp"
#include "FluxoraCore/Services/RemoteDownloadSidecarStore.hpp"

#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <array>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        constexpr std::string_view validSha256 =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

        RemoteArtifactDownloadRequest requestFor(std::string providerId)
        {
            return RemoteArtifactDownloadRequest{
                .providerId = std::move(providerId),
                .artifactId = "artifact-42",
                .modId = "mod-7",
                .versionId = "version-3",
                .jobId = "job-99",
                .operationId = L"operation-99"};
        }

        ResolvedDownloadGrant grantFor(const RemoteArtifactDownloadRequest& request)
        {
            return ResolvedDownloadGrant{
                .providerId = request.providerId,
                .representationProviderId = "origin-a",
                .artifactId = request.artifactId,
                .grantId = "grant-123",
                .primaryUrl = "https://cdn.example.invalid/signed-primary?token=secret",
                .headUrl = "https://cdn.example.invalid/signed-head?token=secret",
                .fallbackUrls = {"https://fallback.example.invalid/signed?token=secret"},
                .transportHeaders = {
                    {"Authorization", "Bearer secret"},
                    {"Cookie", "session=secret"},
                    {"X-Download-Token", "secret-token"}},
                .expiresAtUnixMs = 1'900'000'000'000ULL,
                .expectedSize = 4096,
                .expectedSha256 = std::string(validSha256),
                .operationId = request.operationId};
        }

        RemoteDownloadFallbackRequest fallbackRequestFor(std::string providerId)
        {
            return RemoteDownloadFallbackRequest{
                .providerId = std::move(providerId),
                .artifactId = "artifact-42",
                .modId = "mod-7",
                .versionId = "version-3",
                .jobId = "job-99",
                .grantId = "grant-123",
                .currentRepresentationProviderId = "origin-a",
                .expectedSize = 4096,
                .expectedSha256 = std::string(validSha256),
                .operationId = L"operation-99"};
        }

        ResolvedDownloadGrant fallbackGrantFor(
            const RemoteDownloadFallbackRequest& request)
        {
            return ResolvedDownloadGrant{
                .providerId = request.providerId,
                .representationProviderId = "origin-b",
                .artifactId = request.artifactId,
                .grantId = request.grantId,
                .primaryUrl = "https://fallback.example.invalid/signed-get?token=secret",
                .headUrl = "https://fallback.example.invalid/signed-head?token=secret",
                .expiresAtUnixMs = 1'900'000'000'000ULL,
                .expectedSize = request.expectedSize,
                .expectedSha256 = request.expectedSha256,
                .operationId = request.operationId};
        }

        RemoteArtifactResumeState checkpointState(std::uint64_t bytesReceived = 1024)
        {
            return RemoteArtifactResumeState{
                .providerId = "moddingflow",
                .artifactId = "artifact-42",
                .modId = "mod-7",
                .versionId = "version-3",
                .jobId = "job-99",
                .grantId = "grant-123",
                .expectedSize = 4096,
                .expectedSha256 = std::string(validSha256),
                .bytesReceived = bytesReceived,
                .grantExpiresAtUnixMs = 1'900'000'000'000ULL,
                .retryAtUnixMs = std::nullopt,
                .validator = RepresentationValidator{
                    .providerId = "origin-a",
                    .kind = RepresentationValidatorKind::StrongEtag,
                    .value = "\"representation-v1\""},
                .phase = RemoteArtifactResumePhase::Checkpointed};
        }

        class RecordingResolver final : public IRemoteDownloadResolver
        {
        public:
            explicit RecordingResolver(
                bool fail = false,
                bool supportsFallback = false)
                : fail_(fail),
                  supportsFallback_(supportsFallback)
            {
            }

            ResolvedDownloadGrant resolve(
                const RemoteArtifactDownloadRequest& request) override
            {
                ++calls;
                lastRequest = request;
                if (fail_)
                {
                    throw std::runtime_error("provider failed");
                }
                return grantFor(request);
            }

            std::optional<ResolvedDownloadGrant> resolveFallback(
                const RemoteDownloadFallbackRequest& request) override
            {
                ++fallbackCalls;
                lastFallbackRequest = request;
                if (fail_)
                {
                    throw std::runtime_error("fallback provider failed");
                }
                if (!supportsFallback_)
                {
                    return std::nullopt;
                }
                return fallbackGrantFor(request);
            }

            std::atomic<int> calls{0};
            std::atomic<int> fallbackCalls{0};
            RemoteArtifactDownloadRequest lastRequest;
            RemoteDownloadFallbackRequest lastFallbackRequest;

        private:
            bool fail_;
            bool supportsFallback_;
        };
    }

    TEST(RemoteDownloadProviderRegistryTests, DispatchesToRegisteredProviderAndPropagatesOperationId)
    {
        RemoteDownloadProviderRegistry registry;
        auto resolver = std::make_shared<RecordingResolver>();
        ASSERT_TRUE(registry.registerProvider("moddingflow", resolver));

        const RemoteDownloadResolution result = registry.resolve(requestFor("moddingflow"));

        ASSERT_TRUE(result.grant.has_value());
        EXPECT_EQ(result.error, RemoteDownloadResolutionError::None);
        EXPECT_EQ(result.grant->operationId, L"operation-99");
        EXPECT_EQ(result.operationId, L"operation-99");
        EXPECT_EQ(resolver->lastRequest.operationId, L"operation-99");
        EXPECT_EQ(resolver->calls.load(), 1);
    }

    TEST(RemoteDownloadProviderRegistryTests, DuplicateRegistrationIsRejectedWithoutReplacingProvider)
    {
        RemoteDownloadProviderRegistry registry;
        auto original = std::make_shared<RecordingResolver>();
        auto duplicate = std::make_shared<RecordingResolver>();
        ASSERT_TRUE(registry.registerProvider("moddingflow", original));

        EXPECT_FALSE(registry.registerProvider("moddingflow", duplicate));
        ASSERT_TRUE(registry.resolve(requestFor("moddingflow")).grant.has_value());
        EXPECT_EQ(original->calls.load(), 1);
        EXPECT_EQ(duplicate->calls.load(), 0);
    }

    TEST(RemoteDownloadProviderRegistryTests, UnknownProviderReturnsTypedError)
    {
        RemoteDownloadProviderRegistry registry;

        const RemoteDownloadResolution result = registry.resolve(requestFor("unknown"));

        EXPECT_FALSE(result.grant.has_value());
        EXPECT_EQ(result.error, RemoteDownloadResolutionError::UnknownProvider);
    }

    TEST(RemoteDownloadProviderRegistryTests, NonCanonicalRequestIsRejectedBeforeDispatch)
    {
        RemoteDownloadProviderRegistry registry;
        auto resolver = std::make_shared<RecordingResolver>();
        ASSERT_TRUE(registry.registerProvider("moddingflow", resolver));
        RemoteArtifactDownloadRequest request = requestFor("moddingflow");
        request.artifactId = " artifact-42";

        const RemoteDownloadResolution result = registry.resolve(request);

        EXPECT_FALSE(result.grant.has_value());
        EXPECT_EQ(result.error, RemoteDownloadResolutionError::InvalidRequest);
        EXPECT_EQ(resolver->calls.load(), 0);
    }

    TEST(RemoteDownloadProviderRegistryTests, ProviderFailureIsIsolatedFromOtherProviders)
    {
        RemoteDownloadProviderRegistry registry;
        auto failing = std::make_shared<RecordingResolver>(true);
        auto healthy = std::make_shared<RecordingResolver>();
        ASSERT_TRUE(registry.registerProvider("failing", failing));
        ASSERT_TRUE(registry.registerProvider("healthy", healthy));

        const RemoteDownloadResolution failure = registry.resolve(requestFor("failing"));
        const RemoteDownloadResolution success = registry.resolve(requestFor("healthy"));

        EXPECT_FALSE(failure.grant.has_value());
        EXPECT_EQ(failure.error, RemoteDownloadResolutionError::ProviderFailure);
        EXPECT_EQ(failure.operationId, L"operation-99");
        ASSERT_TRUE(success.grant.has_value());
        EXPECT_EQ(success.error, RemoteDownloadResolutionError::None);
        EXPECT_EQ(healthy->calls.load(), 1);
    }

    TEST(RemoteDownloadProviderRegistryTests, InvalidGrantIsContainedAtRegistryBoundary)
    {
        class WrongProviderResolver final : public IRemoteDownloadResolver
        {
        public:
            ResolvedDownloadGrant resolve(const RemoteArtifactDownloadRequest& request) override
            {
                ResolvedDownloadGrant grant = grantFor(request);
                grant.providerId = "other";
                return grant;
            }
        };

        RemoteDownloadProviderRegistry registry;
        ASSERT_TRUE(registry.registerProvider("moddingflow", std::make_shared<WrongProviderResolver>()));

        const RemoteDownloadResolution result = registry.resolve(requestFor("moddingflow"));

        EXPECT_FALSE(result.grant.has_value());
        EXPECT_EQ(result.error, RemoteDownloadResolutionError::InvalidGrant);
    }

    TEST(RemoteDownloadProviderRegistryTests, DispatchesFallbackUsingOnlyStableControlPlaneIdentity)
    {
        RemoteDownloadProviderRegistry registry;
        auto resolver = std::make_shared<RecordingResolver>(false, true);
        ASSERT_TRUE(registry.registerProvider("moddingflow", resolver));
        const RemoteDownloadFallbackRequest request = fallbackRequestFor("moddingflow");

        const RemoteDownloadResolution result = registry.resolveFallback(request);

        ASSERT_TRUE(result.grant.has_value());
        EXPECT_EQ(result.error, RemoteDownloadResolutionError::None);
        EXPECT_EQ(result.operationId, request.operationId);
        EXPECT_EQ(resolver->lastFallbackRequest, request);
        EXPECT_EQ(resolver->calls.load(), 0);
        EXPECT_EQ(resolver->fallbackCalls.load(), 1);
        EXPECT_EQ(result.grant->providerId, request.providerId);
        EXPECT_EQ(result.grant->grantId, request.grantId);
        EXPECT_EQ(result.grant->representationProviderId, "origin-b");
        EXPECT_TRUE(result.grant->fallbackUrls.empty());
        EXPECT_TRUE(result.grant->transportHeaders.empty());
    }

    TEST(RemoteDownloadProviderRegistryTests, UnsupportedAndUnknownFallbackProvidersFailClosed)
    {
        RemoteDownloadProviderRegistry registry;
        auto unsupported = std::make_shared<RecordingResolver>();
        ASSERT_TRUE(registry.registerProvider("unsupported", unsupported));

        const RemoteDownloadResolution unsupportedResult =
            registry.resolveFallback(fallbackRequestFor("unsupported"));
        const RemoteDownloadResolution unknownResult =
            registry.resolveFallback(fallbackRequestFor("unknown"));

        EXPECT_FALSE(unsupportedResult.grant.has_value());
        EXPECT_EQ(
            unsupportedResult.error,
            RemoteDownloadResolutionError::FallbackUnsupported);
        EXPECT_EQ(unsupported->fallbackCalls.load(), 1);
        EXPECT_FALSE(unknownResult.grant.has_value());
        EXPECT_EQ(unknownResult.error, RemoteDownloadResolutionError::UnknownProvider);
    }

    TEST(RemoteDownloadProviderRegistryTests, InvalidFallbackRequestIsRejectedBeforeDispatch)
    {
        RemoteDownloadProviderRegistry registry;
        auto resolver = std::make_shared<RecordingResolver>(false, true);
        ASSERT_TRUE(registry.registerProvider("moddingflow", resolver));
        RemoteDownloadFallbackRequest request = fallbackRequestFor("moddingflow");
        request.currentRepresentationProviderId = "Origin-A";

        const RemoteDownloadResolution result = registry.resolveFallback(request);

        EXPECT_FALSE(result.grant.has_value());
        EXPECT_EQ(result.error, RemoteDownloadResolutionError::InvalidRequest);
        EXPECT_EQ(resolver->fallbackCalls.load(), 0);
    }

    TEST(RemoteDownloadProviderRegistryTests, SameScopeOrChangedFallbackContentIsContained)
    {
        class InvalidFallbackResolver final : public IRemoteDownloadResolver
        {
        public:
            explicit InvalidFallbackResolver(bool sameScope)
                : sameScope_(sameScope)
            {
            }

            ResolvedDownloadGrant resolve(
                const RemoteArtifactDownloadRequest& request) override
            {
                return grantFor(request);
            }

            std::optional<ResolvedDownloadGrant> resolveFallback(
                const RemoteDownloadFallbackRequest& request) override
            {
                ResolvedDownloadGrant grant = fallbackGrantFor(request);
                if (sameScope_)
                {
                    grant.representationProviderId = request.currentRepresentationProviderId;
                }
                else
                {
                    ++grant.expectedSize;
                }
                return grant;
            }

        private:
            bool sameScope_;
        };

        for (const bool sameScope : {false, true})
        {
            RemoteDownloadProviderRegistry registry;
            ASSERT_TRUE(registry.registerProvider(
                "moddingflow",
                std::make_shared<InvalidFallbackResolver>(sameScope)));

            const RemoteDownloadResolution result =
                registry.resolveFallback(fallbackRequestFor("moddingflow"));

            EXPECT_FALSE(result.grant.has_value());
            EXPECT_EQ(result.error, RemoteDownloadResolutionError::InvalidGrant);
        }
    }

    TEST(RemoteDownloadSidecarStoreTests, RoundTripsOnlyStableControlPlaneState)
    {
        TempDirectory temp;
        RemoteDownloadSidecarStore store;
        const std::filesystem::path artifact = temp.path() / L"artifact.part";
        RemoteArtifactResumeState expected = checkpointState();
        expected.retryAtUnixMs = 1'800'000'005'000ULL;
        expected.phase = RemoteArtifactResumePhase::RetryScheduled;

        store.save(artifact, expected);
        const RemoteDownloadSidecarLoadResult loaded = store.load(artifact);

        ASSERT_TRUE(loaded.state.has_value());
        EXPECT_EQ(*loaded.state, expected);

        const std::filesystem::path sidecar = RemoteDownloadSidecarStore::sidecarPathFor(artifact);
        EXPECT_EQ(sidecar.parent_path().filename(), L".fluxora-remote-downloads");
        const std::string persisted = readTextFile(sidecar);
        const ResolvedDownloadGrant sensitiveGrant = grantFor(requestFor("moddingflow"));
        EXPECT_EQ(persisted.find(sensitiveGrant.primaryUrl), std::string::npos);
        EXPECT_EQ(persisted.find(sensitiveGrant.headUrl), std::string::npos);
        EXPECT_EQ(persisted.find(sensitiveGrant.fallbackUrls.front()), std::string::npos);
        EXPECT_EQ(persisted.find(sensitiveGrant.transportHeaders.at("Authorization")), std::string::npos);
        EXPECT_EQ(persisted.find(sensitiveGrant.transportHeaders.at("Cookie")), std::string::npos);
        EXPECT_EQ(persisted.find(sensitiveGrant.transportHeaders.at("X-Download-Token")), std::string::npos);
        EXPECT_EQ(persisted.find("https://"), std::string::npos);
        EXPECT_EQ(persisted.find("Authorization"), std::string::npos);
        EXPECT_EQ(persisted.find("Bearer"), std::string::npos);
        EXPECT_EQ(persisted.find("Cookie"), std::string::npos);
        EXPECT_EQ(persisted.find("token"), std::string::npos);
        EXPECT_EQ(persisted.find("primaryUrl"), std::string::npos);
        EXPECT_EQ(persisted.find("headUrl"), std::string::npos);
        EXPECT_EQ(persisted.find("fallback"), std::string::npos);
    }

    TEST(RemoteDownloadSidecarStoreTests, AtomicWriteFailurePreservesLastValidState)
    {
        TempDirectory temp;
        RemoteDownloadSidecarStore store;
        const std::filesystem::path artifact = temp.path() / L"artifact.part";
        const RemoteArtifactResumeState original = checkpointState(512);
        RemoteArtifactResumeState replacement = checkpointState(2048);
        store.save(artifact, original);

        EXPECT_THROW(
            store.save(
                artifact,
                replacement,
                RemoteDownloadSidecarWriteOptions{
                    .simulateFailurePoint = AtomicWriteFailurePoint::BeforeReplace}),
            std::runtime_error);

        const RemoteDownloadSidecarLoadResult loaded = store.load(artifact);
        ASSERT_TRUE(loaded.state.has_value());
        EXPECT_EQ(*loaded.state, original);
        EXPECT_EQ(loaded.recoveryAction, AtomicFileRecoveryAction::RemovedStaleTemp);
    }

    TEST(RemoteDownloadSidecarStoreTests, TruncatedTargetRecoversLastValidBackup)
    {
        TempDirectory temp;
        RemoteDownloadSidecarStore store;
        const std::filesystem::path artifact = temp.path() / L"artifact.part";
        const RemoteArtifactResumeState original = checkpointState(512);
        store.save(artifact, original);
        store.save(artifact, checkpointState(1024));
        writeTextFile(RemoteDownloadSidecarStore::sidecarPathFor(artifact), "{\"schemaVersion\":1");

        const RemoteDownloadSidecarLoadResult loaded = store.load(artifact);

        ASSERT_TRUE(loaded.state.has_value());
        EXPECT_EQ(*loaded.state, original);
        EXPECT_EQ(loaded.recoveryAction, AtomicFileRecoveryAction::RestoredBackup);
    }

    TEST(RemoteDownloadSidecarStoreTests, UnknownSchemaVersionRecoversLastValidBackup)
    {
        TempDirectory temp;
        RemoteDownloadSidecarStore store;
        const std::filesystem::path artifact = temp.path() / L"artifact.part";
        const RemoteArtifactResumeState original = checkpointState(256);
        store.save(artifact, original);
        store.save(artifact, checkpointState(768));

        std::string unknown = readTextFile(RemoteDownloadSidecarStore::sidecarPathFor(artifact));
        const std::size_t version = unknown.find("\"schemaVersion\":1");
        ASSERT_NE(version, std::string::npos);
        unknown.replace(version, std::string("\"schemaVersion\":1").size(), "\"schemaVersion\":2");
        writeTextFile(RemoteDownloadSidecarStore::sidecarPathFor(artifact), unknown);

        const RemoteDownloadSidecarLoadResult loaded = store.load(artifact);

        ASSERT_TRUE(loaded.state.has_value());
        EXPECT_EQ(*loaded.state, original);
        EXPECT_EQ(loaded.recoveryAction, AtomicFileRecoveryAction::RestoredBackup);
    }

    TEST(RemoteDownloadSidecarStoreTests, CrashTempIsRemovedWithoutReplacingValidTarget)
    {
        TempDirectory temp;
        RemoteDownloadSidecarStore store;
        const std::filesystem::path artifact = temp.path() / L"artifact.part";
        const RemoteArtifactResumeState original = checkpointState(128);
        store.save(artifact, original);

        EXPECT_THROW(
            store.save(
                artifact,
                checkpointState(2048),
                RemoteDownloadSidecarWriteOptions{
                    .simulateFailurePoint = AtomicWriteFailurePoint::AfterTempFileValidated}),
            std::runtime_error);

        const RemoteDownloadSidecarLoadResult loaded = store.load(artifact);
        ASSERT_TRUE(loaded.state.has_value());
        EXPECT_EQ(*loaded.state, original);
        EXPECT_EQ(loaded.recoveryAction, AtomicFileRecoveryAction::RemovedStaleTemp);
    }

    TEST(RemoteDownloadSidecarStoreTests, InitialCrashTempIsPromotedAsLastValidState)
    {
        TempDirectory temp;
        RemoteDownloadSidecarStore store;
        const std::filesystem::path artifact = temp.path() / L"artifact.part";
        const RemoteArtifactResumeState expected = checkpointState(384);

        EXPECT_THROW(
            store.save(
                artifact,
                expected,
                RemoteDownloadSidecarWriteOptions{
                    .simulateFailurePoint = AtomicWriteFailurePoint::AfterTempFileValidated}),
            std::runtime_error);

        const RemoteDownloadSidecarLoadResult loaded = store.load(artifact);
        ASSERT_TRUE(loaded.state.has_value());
        EXPECT_EQ(*loaded.state, expected);
        EXPECT_EQ(loaded.recoveryAction, AtomicFileRecoveryAction::PromotedTemp);
    }

    TEST(RemoteDownloadSidecarStoreTests, RejectsDuplicateUnknownAndOversizedDocuments)
    {
        TempDirectory temp;
        RemoteDownloadSidecarStore store;
        const std::filesystem::path artifact = temp.path() / L"artifact.part";
        const std::filesystem::path sidecar = RemoteDownloadSidecarStore::sidecarPathFor(artifact);

        store.save(artifact, checkpointState());
        const std::string valid = readTextFile(sidecar);
        std::string duplicate = valid;
        duplicate.insert(duplicate.find('{') + 1, "\"jobId\":\"shadow\",");
        std::filesystem::remove(AtomicFileStore::backupPathFor(sidecar));
        writeTextFile(sidecar, duplicate);
        EXPECT_THROW((void)store.load(artifact), std::runtime_error);

        std::string unknown = valid;
        unknown.insert(unknown.find('{') + 1, "\"signedUrl\":\"https://forbidden\",");
        writeTextFile(sidecar, unknown);
        EXPECT_THROW((void)store.load(artifact), std::runtime_error);

        writeTextFile(sidecar, std::string(RemoteDownloadSidecarStore::maximumDocumentBytes + 1U, 'x'));
        EXPECT_THROW((void)store.load(artifact), std::runtime_error);
    }

    TEST(RemoteDownloadSidecarStoreTests, RejectsNonCanonicalHashSizeAndValidatorScope)
    {
        TempDirectory temp;
        RemoteDownloadSidecarStore store;
        const std::filesystem::path artifact = temp.path() / L"artifact.part";

        RemoteArtifactResumeState invalidHash = checkpointState();
        invalidHash.expectedSha256[0] = 'A';
        EXPECT_THROW(store.save(artifact, invalidHash), std::invalid_argument);

        RemoteArtifactResumeState invalidSize = checkpointState();
        invalidSize.bytesReceived = invalidSize.expectedSize + 1;
        EXPECT_THROW(store.save(artifact, invalidSize), std::invalid_argument);

        RemoteArtifactResumeState distinctRepresentationProvider = checkpointState();
        distinctRepresentationProvider.validator->providerId = "origin-b";
        ASSERT_NO_THROW(store.save(artifact, distinctRepresentationProvider));
        const auto loaded = store.load(artifact);
        ASSERT_TRUE(loaded.state.has_value());
        ASSERT_TRUE(loaded.state->validator.has_value());
        EXPECT_EQ(loaded.state->providerId, "moddingflow");
        EXPECT_EQ(loaded.state->validator->providerId, "origin-b");

        RemoteArtifactResumeState invalidValidatorScope = checkpointState();
        invalidValidatorScope.validator->providerId = "Origin-B";
        EXPECT_THROW(store.save(artifact, invalidValidatorScope), std::invalid_argument);
    }

    TEST(RemoteDownloadSidecarStoreTests, ConcurrentWritesAlwaysLeaveOneCompleteValidState)
    {
        TempDirectory temp;
        std::array<RemoteDownloadSidecarStore, 4> stores;
        const std::filesystem::path artifact = temp.path() / L"artifact.part";
        std::atomic<int> failures{0};
        std::vector<std::thread> writers;
        for (std::uint64_t index = 1; index <= 16; ++index)
        {
            writers.emplace_back([&stores, &artifact, &failures, index]
            {
                try
                {
                    stores[index % stores.size()].save(artifact, checkpointState(index * 128));
                }
                catch (...)
                {
                    ++failures;
                }
            });
        }
        for (std::thread& writer : writers)
        {
            writer.join();
        }

        EXPECT_EQ(failures.load(), 0);
        const RemoteDownloadSidecarLoadResult loaded = stores.front().load(artifact);
        ASSERT_TRUE(loaded.state.has_value());
        EXPECT_EQ(loaded.state->bytesReceived % 128, 0U);
        EXPECT_GE(loaded.state->bytesReceived, 128U);
        EXPECT_LE(loaded.state->bytesReceived, 2048U);
    }

    TEST(RemoteDownloadCoordinatorTests, ResumeReResolvesStableArtifactBeforeRepresentationDecision)
    {
        RemoteDownloadProviderRegistry registry;
        auto resolver = std::make_shared<RecordingResolver>();
        ASSERT_TRUE(registry.registerProvider("moddingflow", resolver));
        RemoteDownloadCoordinator coordinator(registry);

        const RemoteDownloadPreparation result = coordinator.resolveResume(
            checkpointState(),
            L"resume-operation");

        ASSERT_TRUE(result.grant.has_value());
        ASSERT_TRUE(result.state.has_value());
        EXPECT_EQ(resolver->lastRequest.providerId, "moddingflow");
        EXPECT_EQ(resolver->lastRequest.artifactId, "artifact-42");
        EXPECT_EQ(resolver->lastRequest.operationId, L"resume-operation");
        EXPECT_EQ(result.operationId, L"resume-operation");
        EXPECT_EQ(result.state->phase, RemoteArtifactResumePhase::AwaitingRepresentation);
        EXPECT_EQ(result.state->bytesReceived, 1024U);
    }

    TEST(RemoteDownloadCoordinatorTests, QueueAndResolvePreserveStableIdsAndOperationId)
    {
        RemoteDownloadProviderRegistry registry;
        auto resolver = std::make_shared<RecordingResolver>();
        ASSERT_TRUE(registry.registerProvider("moddingflow", resolver));
        RemoteDownloadCoordinator coordinator(registry);
        const RemoteArtifactDownloadRequest request = requestFor("moddingflow");

        const RemoteDownloadQueueEntry queued = coordinator.queue(request);
        const RemoteDownloadPreparation resolved = coordinator.resolveQueued(queued);

        EXPECT_EQ(queued.request, request);
        ASSERT_TRUE(resolved.state.has_value());
        EXPECT_EQ(resolver->lastRequest.operationId, request.operationId);
        EXPECT_EQ(resolved.state->providerId, request.providerId);
        EXPECT_EQ(resolved.state->artifactId, request.artifactId);
        EXPECT_EQ(resolved.state->jobId, request.jobId);
        EXPECT_EQ(resolved.state->phase, RemoteArtifactResumePhase::AwaitingRepresentation);
    }

    TEST(RemoteDownloadCoordinatorTests, CheckpointAndRetryRemainTransportFreeAndResumeReResolves)
    {
        RemoteDownloadProviderRegistry registry;
        auto resolver = std::make_shared<RecordingResolver>();
        ASSERT_TRUE(registry.registerProvider("moddingflow", resolver));
        RemoteDownloadCoordinator coordinator(registry);
        RemoteArtifactResumeState state = checkpointState();
        state.phase = RemoteArtifactResumePhase::ReadyToAppend;

        RemoteDownloadCoordinator::checkpoint(state, 1536);
        EXPECT_EQ(state.phase, RemoteArtifactResumePhase::Checkpointed);
        EXPECT_EQ(state.bytesReceived, 1536U);

        RemoteDownloadCoordinator::scheduleRetry(state, 1'800'000'005'000ULL);
        EXPECT_EQ(state.phase, RemoteArtifactResumePhase::RetryScheduled);
        ASSERT_TRUE(state.retryAtUnixMs.has_value());

        const RemoteDownloadPreparation resumed = coordinator.resolveResume(
            state,
            L"retry-operation");
        ASSERT_TRUE(resumed.state.has_value());
        EXPECT_EQ(resolver->calls.load(), 1);
        EXPECT_EQ(resolver->lastRequest.operationId, L"retry-operation");
        EXPECT_EQ(resumed.state->phase, RemoteArtifactResumePhase::AwaitingRepresentation);
        EXPECT_FALSE(resumed.state->retryAtUnixMs.has_value());
        EXPECT_EQ(resumed.state->bytesReceived, 1536U);
    }

    TEST(RemoteDownloadCoordinatorTests, SameFreshRepresentationPermitsAppend)
    {
        RemoteArtifactResumeState state = checkpointState();
        state.phase = RemoteArtifactResumePhase::AwaitingRepresentation;

        RemoteDownloadCoordinator::applyVerifiedRepresentationDecision(
            state,
            RemoteDownloadResumeDecision::Append,
            checkpointState().validator);

        EXPECT_EQ(state.phase, RemoteArtifactResumePhase::ReadyToAppend);
        EXPECT_EQ(state.bytesReceived, 1024U);
    }

    TEST(RemoteDownloadCoordinatorTests, ChangedValidatorCannotAppendButRestartBindsFreshRepresentationScope)
    {
        RemoteArtifactResumeState changed = checkpointState();
        changed.phase = RemoteArtifactResumePhase::AwaitingRepresentation;
        RepresentationValidator changedValidator = *changed.validator;
        changedValidator.value = "\"representation-v2\"";

        EXPECT_THROW(
            RemoteDownloadCoordinator::applyVerifiedRepresentationDecision(
                changed,
                RemoteDownloadResumeDecision::Append,
                changedValidator),
            std::invalid_argument);
        RemoteDownloadCoordinator::applyVerifiedRepresentationDecision(
            changed,
            RemoteDownloadResumeDecision::ReResolve);
        EXPECT_EQ(changed.bytesReceived, 0U);
        EXPECT_FALSE(changed.validator.has_value());
        EXPECT_EQ(changed.phase, RemoteArtifactResumePhase::AwaitingRepresentation);

        RemoteArtifactResumeState crossed = checkpointState();
        crossed.phase = RemoteArtifactResumePhase::AwaitingRepresentation;
        RepresentationValidator otherProvider = *crossed.validator;
        otherProvider.providerId = "bunny_pull_cdn";

        RemoteDownloadCoordinator::applyVerifiedRepresentationDecision(
            crossed,
            RemoteDownloadResumeDecision::Restart,
            otherProvider);
        EXPECT_EQ(crossed.bytesReceived, 0U);
        ASSERT_TRUE(crossed.validator.has_value());
        EXPECT_EQ(crossed.validator->providerId, "bunny_pull_cdn");
        EXPECT_EQ(crossed.phase, RemoteArtifactResumePhase::ReadyToStart);
    }

    TEST(RemoteDownloadCoordinatorTests, VerifiedFullRestartKeepsFreshProviderValidator)
    {
        RemoteArtifactResumeState state = checkpointState();
        state.phase = RemoteArtifactResumePhase::AwaitingRepresentation;
        const RepresentationValidator freshValidator = *state.validator;

        RemoteDownloadCoordinator::applyVerifiedRepresentationDecision(
            state,
            RemoteDownloadResumeDecision::Restart,
            freshValidator);

        EXPECT_EQ(state.bytesReceived, 0U);
        ASSERT_TRUE(state.validator.has_value());
        EXPECT_EQ(*state.validator, freshValidator);
        EXPECT_EQ(state.phase, RemoteArtifactResumePhase::ReadyToStart);
    }

    TEST(RemoteDownloadFoundationRegressionTests, LegacyNexusMetadataRemainsReadableWithoutRegistryConsultation)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadTransferLimiter transferLimiter;
        DownloadService downloads(logger, settings, pathSettings, transferLimiter);
        downloads.initialize();

        const std::filesystem::path project = temp.path() / L"Project";
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        const std::filesystem::path archive =
            pathSettings.downloadsDirectory(project) / L"Legacy Nexus Archive.7z";
        writeTextFile(archive, "legacy archive bytes");
        writeTextFile(
            std::filesystem::path(archive.wstring() + L".fluxora.json"),
            R"({"source":"nexus","gameDomain":"skyrimspecialedition","modId":"3863","fileId":"123","modName":"Legacy Nexus Mod","version":"1.2.3","isDownloading":false})");
        const std::filesystem::path legacySidecar(archive.wstring() + L".fluxora.json");
        const std::string legacyBytesBefore = readTextFile(legacySidecar);

        RemoteDownloadProviderRegistry registry;
        auto failIfConsulted = std::make_shared<RecordingResolver>(true);
        ASSERT_TRUE(registry.registerProvider("nexus", failIfConsulted));
        RemoteDownloadSidecarStore remoteStore;
        remoteStore.save(archive, checkpointState(128));
        remoteStore.save(archive, checkpointState(256));
        const std::filesystem::path remoteBackup = AtomicFileStore::backupPathFor(
            RemoteDownloadSidecarStore::sidecarPathFor(archive));
        ASSERT_TRUE(std::filesystem::is_regular_file(remoteBackup));

        const std::vector<DownloadEntry> entries = downloads.listDownloads(project);

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_EQ(entries.front().source, L"nexus");
        EXPECT_EQ(entries.front().name, L"Legacy Nexus Archive");
        EXPECT_EQ(entries.front().fileName, L"Legacy Nexus Archive.7z");
        EXPECT_EQ(readTextFile(legacySidecar), legacyBytesBefore);
        EXPECT_TRUE(std::filesystem::is_regular_file(remoteBackup));
        EXPECT_EQ(failIfConsulted->calls.load(), 0);

        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
    }
}
