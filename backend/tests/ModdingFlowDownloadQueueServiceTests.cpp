#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/DownloadTransferLimiter.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModdingFlowDownloadQueueService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        constexpr std::string_view artifactId = "123e4567-e89b-42d3-a456-426614174000";
        constexpr std::string_view modId = "123e4567-e89b-42d3-a456-426614174001";
        constexpr std::string_view versionId = "123e4567-e89b-42d3-a456-426614174002";
        constexpr std::string_view jobId = "123e4567-e89b-42d3-a456-426614174003";
        constexpr std::string_view sha256 =
            "ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f";

        class FakeArtifactLookup final : public IModdingFlowArtifactLookupService
        {
        public:
            ModdingFlowArtifactPreview preview;
            std::size_t calls{0U};
            std::optional<ModdingFlowApiErrorCode> anonymousFailure;
            std::optional<ModdingFlowApiErrorCode> bearerFailure;
            std::vector<ModdingFlowArtifactLookupAuthMode> authModes;

            ModdingFlowArtifactPreview lookup(
                std::string_view requestedArtifactId,
                ModdingFlowArtifactLookupAuthMode authMode,
                std::wstring_view operationId) override
            {
                ++calls;
                authModes.push_back(authMode);
                EXPECT_EQ(requestedArtifactId, artifactId);
                EXPECT_EQ(operationId, L"operation-managed-download");
                const std::optional<ModdingFlowApiErrorCode> failure =
                    authMode == ModdingFlowArtifactLookupAuthMode::Anonymous
                        ? anonymousFailure
                        : bearerFailure;
                if (failure.has_value())
                {
                    throw ModdingFlowApiException(
                        *failure,
                        "safe lookup failure",
                        std::wstring(operationId));
                }
                return preview;
            }
        };

        ModdingFlowArtifactPreview validPreview()
        {
            ModdingFlowArtifactPreview preview;
            preview.artifactId = std::string(artifactId);
            preview.modId = std::string(modId);
            preview.versionId = std::string(versionId);
            preview.gameSlug = "skyrim-special-edition";
            preview.accessTier = "public";
            preview.version = "1.2.3";
            preview.filename = "Verified Archive.zip";
            preview.sizeBytes = 8U;
            preview.sha256 = std::string(sha256);
            preview.operationId = L"operation-managed-download";
            return preview;
        }

        ModdingFlowManagedDownloadRequest validRequest(
            const std::filesystem::path& projectDirectory)
        {
            return {
                .projectDirectory = projectDirectory,
                .artifactId = std::string(artifactId),
                .modId = std::string(modId),
                .versionId = std::string(versionId),
                .jobId = std::string(jobId),
                .operationId = L"operation-managed-download"};
        }

        template <typename Predicate>
        bool waitUntil(Predicate&& predicate)
        {
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
            while (std::chrono::steady_clock::now() < deadline)
            {
                if (predicate())
                {
                    return true;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
            }
            return predicate();
        }

        struct ManagedDownloadFixture
        {
            TempDirectory temp;
            std::filesystem::path projectDirectory{temp.path() / L"Project"};
            Logger logger;
            BuildPathSettingsService paths{logger};
            DownloadTransferLimiter limiter;

            ManagedDownloadFixture()
            {
                std::filesystem::create_directories(projectDirectory);
                InstanceMetadataStore::ensureInstance(projectDirectory, L"skyrimse");
                logger.initialize();
                paths.initialize();
            }

            ~ManagedDownloadFixture()
            {
                paths.shutdown();
                logger.shutdown();
            }
        };
    }

    TEST(ModdingFlowDownloadQueueServiceTests,
         FinalArchiveStaysInvisibleUntilVerifiedTransferCompletes)
    {
        ManagedDownloadFixture fixture;
        FakeArtifactLookup lookup;
        lookup.preview = validPreview();

        std::mutex mutex;
        std::condition_variable condition;
        bool transferStarted = false;
        bool releaseTransfer = false;
        std::filesystem::path observedRoot;
        std::filesystem::path observedPartial;
        std::filesystem::path observedDestination;

        ModdingFlowDownloadQueueService queue(
            fixture.logger,
            fixture.paths,
            fixture.limiter,
            lookup,
            [&](const RemoteDownloadTransferRequest& request,
                const IRemoteDownloadCancellation& cancellation)
            {
                observedRoot = request.allowedRoot;
                observedPartial = request.partialPath;
                observedDestination = request.destinationPath;
                EXPECT_EQ(request.artifact.providerId, "moddingflow");
                EXPECT_EQ(request.artifact.artifactId, artifactId);
                EXPECT_FALSE(cancellation.isCancellationRequested());
                EXPECT_FALSE(std::filesystem::exists(request.destinationPath));
                if (request.progress)
                {
                    request.progress(4U, 8U);
                }
                {
                    std::unique_lock lock(mutex);
                    transferStarted = true;
                    condition.notify_all();
                    condition.wait(lock, [&]() { return releaseTransfer; });
                }
                EXPECT_FALSE(std::filesystem::exists(request.destinationPath));
                writeTextFile(request.destinationPath, "12345678");
                return RemoteDownloadTransferResult{
                    .outcome = RemoteDownloadTransferOutcome::Completed,
                    .finalPath = request.destinationPath,
                    .bytesReceived = 8U,
                    .message = "completed",
                    .operationId = request.artifact.operationId};
            });
        queue.initialize();

        const ModdingFlowManagedDownloadSnapshot queued =
            queue.queue(validRequest(fixture.projectDirectory));
        ASSERT_EQ(lookup.authModes.size(), 1U);
        EXPECT_EQ(
            lookup.authModes.front(),
            ModdingFlowArtifactLookupAuthMode::Anonymous);
        EXPECT_EQ(queued.state, ModdingFlowManagedDownloadState::Queued);
        EXPECT_TRUE(std::filesystem::exists(queued.pendingPath));
        EXPECT_FALSE(std::filesystem::exists(queued.destinationPath));

        {
            std::unique_lock lock(mutex);
            ASSERT_TRUE(condition.wait_for(
                lock,
                std::chrono::seconds(5),
                [&]() { return transferStarted; }));
        }
        ASSERT_TRUE(waitUntil([&]()
        {
            const auto snapshots = queue.list(fixture.projectDirectory);
            return snapshots.size() == 1U && snapshots.front().bytesReceived == 4U;
        }));
        EXPECT_EQ(observedRoot, fixture.paths.downloadsDirectory(fixture.projectDirectory));
        EXPECT_EQ(observedPartial, queued.partialPath);
        EXPECT_EQ(observedDestination, queued.destinationPath);
        EXPECT_FALSE(std::filesystem::exists(queued.destinationPath));

        {
            std::lock_guard lock(mutex);
            releaseTransfer = true;
        }
        condition.notify_all();
        ASSERT_TRUE(waitUntil([&]()
        {
            const auto snapshots = queue.list(fixture.projectDirectory);
            return snapshots.size() == 1U &&
                snapshots.front().state == ModdingFlowManagedDownloadState::Completed;
        }));
        EXPECT_TRUE(std::filesystem::exists(queued.destinationPath));
        queue.shutdown();
    }

    TEST(ModdingFlowDownloadQueueServiceTests,
         ProtectedMetadataRetriesBearerOnlyAfterAuthenticationFailure)
    {
        for (const ModdingFlowApiErrorCode authenticationFailure : {
                 ModdingFlowApiErrorCode::Unauthorized,
                 ModdingFlowApiErrorCode::Forbidden})
        {
            ManagedDownloadFixture fixture;
            FakeArtifactLookup lookup;
            lookup.preview = validPreview();
            lookup.preview.accessTier = "authenticated";
            lookup.anonymousFailure = authenticationFailure;
            ModdingFlowDownloadQueueService queue(
                fixture.logger,
                fixture.paths,
                fixture.limiter,
                lookup,
                [](const RemoteDownloadTransferRequest& request,
                   const IRemoteDownloadCancellation&)
                {
                    return RemoteDownloadTransferResult{
                        .outcome = RemoteDownloadTransferOutcome::Cancelled,
                        .resumableStateRetained = true,
                        .message = "cancelled",
                        .operationId = request.artifact.operationId};
                });
            queue.initialize();

            static_cast<void>(queue.queue(validRequest(fixture.projectDirectory)));

            ASSERT_EQ(lookup.authModes.size(), 2U);
            EXPECT_EQ(
                lookup.authModes[0],
                ModdingFlowArtifactLookupAuthMode::Anonymous);
            EXPECT_EQ(
                lookup.authModes[1],
                ModdingFlowArtifactLookupAuthMode::BearerModsRead);
            queue.shutdown();
        }
    }

    TEST(ModdingFlowDownloadQueueServiceTests,
         NonAuthenticationMetadataFailureNeverAttemptsBearer)
    {
        for (const ModdingFlowApiErrorCode failure : {
                 ModdingFlowApiErrorCode::NotFound,
                 ModdingFlowApiErrorCode::RateLimited,
                 ModdingFlowApiErrorCode::ServerFailure,
                 ModdingFlowApiErrorCode::TransportFailure,
                 ModdingFlowApiErrorCode::ProtocolFailure})
        {
            ManagedDownloadFixture fixture;
            FakeArtifactLookup lookup;
            lookup.preview = validPreview();
            lookup.anonymousFailure = failure;
            ModdingFlowDownloadQueueService queue(
                fixture.logger,
                fixture.paths,
                fixture.limiter,
                lookup,
                [](const RemoteDownloadTransferRequest&,
                   const IRemoteDownloadCancellation&)
                {
                    return RemoteDownloadTransferResult{};
                });
            queue.initialize();

            EXPECT_THROW(
                static_cast<void>(queue.queue(validRequest(fixture.projectDirectory))),
                ModdingFlowApiException);

            ASSERT_EQ(lookup.authModes.size(), 1U);
            EXPECT_EQ(
                lookup.authModes.front(),
                ModdingFlowArtifactLookupAuthMode::Anonymous);
            queue.shutdown();
        }
    }

    TEST(ModdingFlowDownloadQueueServiceTests,
         RejectsServerFilenameThatCouldEscapeNativeDownloadsRoot)
    {
        ManagedDownloadFixture fixture;
        FakeArtifactLookup lookup;
        lookup.preview = validPreview();
        lookup.preview.filename = "../outside.zip";
        std::atomic<bool> transferCalled{false};
        ModdingFlowDownloadQueueService queue(
            fixture.logger,
            fixture.paths,
            fixture.limiter,
            lookup,
            [&](const RemoteDownloadTransferRequest&,
                const IRemoteDownloadCancellation&)
            {
                transferCalled = true;
                return RemoteDownloadTransferResult{};
            });
        queue.initialize();

        EXPECT_THROW(
            static_cast<void>(queue.queue(validRequest(fixture.projectDirectory))),
            std::invalid_argument);
        EXPECT_FALSE(transferCalled.load());
        EXPECT_FALSE(std::filesystem::exists(fixture.temp.path() / L"outside.zip"));
        queue.shutdown();
    }

    TEST(ModdingFlowDownloadQueueServiceTests,
         DownloadServicePublishesManagedQueueThroughOrdinaryLifecycle)
    {
        ManagedDownloadFixture fixture;
        AppSettingsService settings(fixture.logger);
        settings.initialize();
        FakeArtifactLookup lookup;
        lookup.preview = validPreview();
        std::atomic<bool> releaseTransfer{false};
        ModdingFlowDownloadQueueService managedQueue(
            fixture.logger,
            fixture.paths,
            fixture.limiter,
            lookup,
            [&](const RemoteDownloadTransferRequest& request,
                const IRemoteDownloadCancellation& cancellation)
            {
                while (!releaseTransfer.load() && !cancellation.isCancellationRequested())
                {
                    std::this_thread::sleep_for(std::chrono::milliseconds(5));
                }
                if (cancellation.isCancellationRequested())
                {
                    return RemoteDownloadTransferResult{
                        .outcome = RemoteDownloadTransferOutcome::Cancelled,
                        .resumableStateRetained = true,
                        .message = "cancelled",
                        .operationId = request.artifact.operationId};
                }
                writeTextFile(request.destinationPath, "12345678");
                return RemoteDownloadTransferResult{
                    .outcome = RemoteDownloadTransferOutcome::Completed,
                    .finalPath = request.destinationPath,
                    .bytesReceived = 8U,
                    .message = "completed",
                    .operationId = request.artifact.operationId};
            });
        DownloadService downloads(
            fixture.logger,
            settings,
            fixture.paths,
            fixture.limiter);
        downloads.configureModdingFlowDownloadQueue(&managedQueue);
        downloads.initialize();

        const DownloadEntry queued = downloads.queueModdingFlowArtifact(
            validRequest(fixture.projectDirectory));
        EXPECT_EQ(queued.source, L"ModdingFlow");
        EXPECT_EQ(queued.transferState, L"queued");
        EXPECT_TRUE(queued.isDownloading);
        EXPECT_FALSE(queued.canInstall);
        EXPECT_NE(queued.localPath.filename(), L"Verified Archive.zip");
        ASSERT_TRUE(waitUntil([&]()
        {
            const auto entries = downloads.listDownloads(fixture.projectDirectory);
            return entries.size() == 1U && entries.front().isDownloading;
        }));

        releaseTransfer = true;
        ASSERT_TRUE(waitUntil([&]()
        {
            const auto entries = downloads.listDownloads(fixture.projectDirectory);
            return entries.size() == 1U && entries.front().canInstall &&
                entries.front().fileName == L"Verified Archive.zip";
        }));
        const auto completed = downloads.listDownloads(fixture.projectDirectory);
        ASSERT_EQ(completed.size(), 1U);
        EXPECT_EQ(completed.front().source, L"ModdingFlow");
        EXPECT_FALSE(completed.front().isDownloading);
        EXPECT_EQ(completed.front().transferState, L"idle");

        downloads.shutdown();
        settings.shutdown();
    }
}
