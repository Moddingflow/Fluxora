#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/NexusModsAuthService.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
namespace fluxora::test_hooks
{
    std::wstring protectNexusSecretForTest(const std::wstring& value);

    void withExistingDownloadOutputPathReservationForTest(
        const std::filesystem::path& path,
        const std::function<void()>& action);

    void withDownloadOutputPathsForTest(
        const std::filesystem::path& directory,
        std::wstring_view destinationFileName,
        const std::function<void(
            const std::filesystem::path&,
            const std::filesystem::path&)>& action);

    void setNexusArchiveTransferHooks(
        std::function<void(std::wstring_view)> beforeAcquire,
        std::function<std::filesystem::path(
            const std::filesystem::path&,
            const std::filesystem::path&,
            std::wstring_view)> transfer);

    void setResumeBeforeClaimHook(std::function<void()> hook);

    std::wstring nexusArchiveFileNameForTest(
        std::wstring_view suggestedName,
        std::wstring_view nexusModName);

    std::wstring resolvedHttpDownloadFileNameForTest(
        std::wstring_view persistedFileName,
        std::wstring_view contentDisposition,
        std::wstring_view fallbackFileName);

    std::wstring nexusDownloadFileNameFromApiPayloadForTest(std::wstring_view payloadJson);

    void setActiveDownloadForTest(const std::filesystem::path& path, bool active);

    std::filesystem::path downloadProgressSidecarPathForTest(const std::filesystem::path& path);

    void writeDownloadProgressCheckpointForTest(
        const std::filesystem::path& path,
        std::uintmax_t bytesReceived,
        std::uintmax_t totalBytes,
        std::uintmax_t startedUnix);

    void writeDownloadProgressSidecarForTest(
        const std::filesystem::path& path,
        std::uintmax_t bytesReceived,
        std::uintmax_t totalBytes,
        std::uintmax_t startedUnix);

    void finalizeHttpDownloadResponseForTest(
        const std::filesystem::path& partialPath,
        const std::filesystem::path& destinationPath,
        std::uint32_t statusCode,
        std::uintmax_t requestedOffset,
        std::wstring_view contentLength,
        std::wstring_view contentRange,
        std::uintmax_t responseBytesReceived);

    std::string externalProcessWaitOutcomeForTest(
        const std::vector<std::string>& events,
        std::size_t& terminationCalls,
        std::size_t& postTerminationWaits);

    void writeNxmWorkerOperationContextLogForTest(
        Logger& logger,
        std::string operationId,
        std::string inScopeMarker,
        std::string afterScopeMarker);
}
#endif

namespace fluxora::tests
{
#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
    namespace
    {
        class ScopedActiveDownload final
        {
        public:
            explicit ScopedActiveDownload(std::filesystem::path path)
                : path_(std::move(path))
            {
                test_hooks::setActiveDownloadForTest(path_, true);
            }

            ScopedActiveDownload(const ScopedActiveDownload&) = delete;
            ScopedActiveDownload& operator=(const ScopedActiveDownload&) = delete;

            ~ScopedActiveDownload()
            {
                test_hooks::setActiveDownloadForTest(path_, false);
            }

        private:
            std::filesystem::path path_;
        };

        class ScopedNexusArchiveTransferHooks final
        {
        public:
            ScopedNexusArchiveTransferHooks(
                std::function<void(std::wstring_view)> beforeAcquire,
                std::function<std::filesystem::path(
                    const std::filesystem::path&,
                    const std::filesystem::path&,
                    std::wstring_view)> transfer)
            {
                test_hooks::setNexusArchiveTransferHooks(
                    std::move(beforeAcquire),
                    std::move(transfer));
            }

            ScopedNexusArchiveTransferHooks(const ScopedNexusArchiveTransferHooks&) = delete;
            ScopedNexusArchiveTransferHooks& operator=(const ScopedNexusArchiveTransferHooks&) = delete;

            ~ScopedNexusArchiveTransferHooks()
            {
                test_hooks::setNexusArchiveTransferHooks({}, {});
            }
        };

        class ScopedResumeBeforeClaimHook final
        {
        public:
            explicit ScopedResumeBeforeClaimHook(std::function<void()> hook)
            {
                test_hooks::setResumeBeforeClaimHook(std::move(hook));
            }

            ScopedResumeBeforeClaimHook(const ScopedResumeBeforeClaimHook&) = delete;
            ScopedResumeBeforeClaimHook& operator=(const ScopedResumeBeforeClaimHook&) = delete;

            ~ScopedResumeBeforeClaimHook()
            {
                test_hooks::setResumeBeforeClaimHook({});
            }
        };
    }
#endif

    TEST(DownloadServiceTests, AutomaticNexusDownloadsRequireLinkedPremiumAccount)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        Logger logger;
        AppSettingsService settings(logger);
        settings.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadTransferLimiter transferLimiter;
        DownloadService downloads(logger, settings, pathSettings, transferLimiter);

        EXPECT_FALSE(downloads.canAutomaticallyDownloadNexus());

        NexusModsStoredAuth freeAuth;
        freeAuth.linked = true;
        freeAuth.protectedApiKey = L"protected-free-key";
        settings.saveNexusModsAuth(freeAuth);
        EXPECT_FALSE(downloads.canAutomaticallyDownloadNexus());

        freeAuth.isPremium = true;
        settings.saveNexusModsAuth(freeAuth);
        EXPECT_TRUE(downloads.canAutomaticallyDownloadNexus());

        pathSettings.shutdown();
        settings.shutdown();
    }

    TEST(DownloadServiceTests, NexusArchiveFileNameUsesDownloadedFileName)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        EXPECT_EQ(
            test_hooks::nexusArchiveFileNameForTest(
                L"Cabbage CS Preset 182366 5 2026-07-01T12-33Z Ks18n0uG9.7z",
                L"Cabbage CS Preset"),
            L"Cabbage CS Preset 182366 5 2026-07-01T12-33Z Ks18n0uG9.7z");
        EXPECT_EQ(
            test_hooks::nexusArchiveFileNameForTest(L"Original Name-3863-5-2-1579093884.zip", L""),
            L"Original Name-3863-5-2-1579093884.zip");
#endif
    }

    TEST(DownloadServiceTests, FreshNexusDownloadUsesHttpResponseFileNameInsteadOfNumericFallback)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        EXPECT_EQ(
            test_hooks::resolvedHttpDownloadFileNameForTest(
                {},
                L"attachment; filename=\"Cabbage CS Preset.7z\"",
                L"Cabbage CS Preset 182366 5 2026-07-01T12-33Z Ks18n0uG9.7z"),
            L"Cabbage CS Preset.7z");
#endif
    }

    TEST(DownloadServiceTests, NexusApiDisplayNameReplacesGeneratedCdnSuffix)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        EXPECT_EQ(
            test_hooks::nexusDownloadFileNameFromApiPayloadForTest(
                LR"json({
                    "name": "Disabled Reference Integrity Fix AE (SKSE)",
                    "file_name": "Disabled Reference Integrity Fix AE (SKSE) 175062 1.3.1 2026-07-14T18-48Z OyYrPuXUe.7z",
                    "version": "1.3.1"
                })json"),
            L"Disabled Reference Integrity Fix AE (SKSE).7z");
#endif
    }

    TEST(DownloadServiceTests, CaptureNxmLinkWithoutDownloadKeyQueuesAuthenticatedDownload)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Nexus downloads are implemented for Windows builds.";
#else
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

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::vector<DownloadEntry> entries = downloads.captureNxmLinks(
            projectDirectory,
            {L"nxm://skyrimspecialedition/mods/3863/files/123"});

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_FALSE(entries.front().canInstall);
        EXPECT_TRUE(entries.front().localPath.extension() == L".nxm");
        EXPECT_TRUE(entries.front().isDownloading);
        EXPECT_FALSE(entries.front().hasKnownProgress);
        EXPECT_EQ(entries.front().progressPercent, 0);

        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(DownloadServiceTests, CompletedQueuedNexusDownloadAppearsInPersistentDownloadList)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadTransferLimiter transferLimiter;
        const ScopedNexusArchiveTransferHooks transferHooks(
            {},
            [](const std::filesystem::path& directory,
               const std::filesystem::path&,
               std::wstring_view)
            {
                const std::filesystem::path archivePath = directory / L"Cabbage CS Preset.7z";
                writeTextFile(archivePath, "fixture archive");
                return archivePath;
            });

        DownloadService downloads(logger, settings, pathSettings, transferLimiter);
        downloads.initialize();
        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::vector<DownloadEntry> accepted = downloads.captureNxmLinks(
            projectDirectory,
            {L"nxm://skyrimspecialedition/mods/182366/files/770345"});

        ASSERT_EQ(accepted.size(), 1U);
        EXPECT_EQ(accepted.front().localPath.extension(), L".nxm");

        std::vector<DownloadEntry> completed;
        for (int attempt = 0; attempt < 200; ++attempt)
        {
            completed = downloads.listDownloads(projectDirectory);
            if (completed.size() == 1U && completed.front().canInstall)
            {
                break;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }

        downloads.shutdown();
        const std::vector<DownloadEntry> reloaded = downloads.listDownloads(projectDirectory);
        const std::filesystem::path downloadsDirectory = pathSettings.downloadsDirectory(projectDirectory);

        ASSERT_EQ(completed.size(), 1U);
        EXPECT_EQ(completed.front().fileName, L"Cabbage CS Preset.7z");
        EXPECT_TRUE(completed.front().canInstall);
        ASSERT_EQ(reloaded.size(), 1U);
        EXPECT_EQ(reloaded.front().fileName, L"Cabbage CS Preset.7z");
        for (const auto& entry : std::filesystem::directory_iterator(downloadsDirectory))
        {
            const std::wstring name = entry.path().filename().wstring();
            EXPECT_NE(entry.path().extension(), L".nxm");
            EXPECT_FALSE(name.size() == 11 && name.rfind(L".fb", 0) == 0);
        }

        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(DownloadServiceTests, CaptureNxmLinkWithOAuthAuthWithoutApiKeyQueuesOAuthDownload)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Nexus downloads are implemented for Windows builds.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.username = L"modder";
        auth.userId = L"42";
        auth.tokenType = L"Bearer";
        auth.expiresAtUtc = L"2026-06-16T10:00:00Z";
        auth.protectedAccessToken = L"legacy-access-token";
        settings.saveNexusModsAuth(auth);

        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadTransferLimiter transferLimiter;
        DownloadService downloads(logger, settings, pathSettings, transferLimiter);
        downloads.initialize();

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::vector<DownloadEntry> entries = downloads.captureNxmLinks(
            projectDirectory,
            {L"nxm://skyrimspecialedition/mods/3863/files/123"});

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_FALSE(entries.front().canInstall);
        EXPECT_TRUE(entries.front().localPath.extension() == L".nxm");
        EXPECT_TRUE(entries.front().isDownloading);
        EXPECT_FALSE(entries.front().hasKnownProgress);
        EXPECT_EQ(entries.front().progressPercent, 0);

        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(DownloadServiceTests, ExpiredOAuthTokenIsRejectedBeforeQueuedNexusTransfer)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Nexus downloads are implemented for Windows builds.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();

        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.isPremium = true;
        auth.tokenType = L"Bearer";
        auth.expiresAtUtc = L"2000-01-01T00:00:00Z";
        auth.protectedAccessToken = test_hooks::protectNexusSecretForTest(L"expired-access-token");
        settings.saveNexusModsAuth(auth);

        NexusModsAuthService nexusAuth(logger, settings);
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadTransferLimiter transferLimiter;
        std::atomic_int transferCalls{0};
        const ScopedNexusArchiveTransferHooks transferHooks(
            {},
            [&](const std::filesystem::path& directory, const std::filesystem::path&, std::wstring_view)
            {
                ++transferCalls;
                const std::filesystem::path archivePath = directory / L"unexpected-transfer.zip";
                writeTextFile(archivePath, "fixture archive");
                return archivePath;
            });

        DownloadService downloads(logger, settings, pathSettings, transferLimiter, nexusAuth);
        downloads.initialize();

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        downloads.captureNxmLinks(
            projectDirectory,
            {L"nxm://skyrimspecialedition/mods/3863/files/123"});

        std::vector<DownloadEntry> entries;
        for (int attempt = 0; attempt < 100; ++attempt)
        {
            entries = downloads.listDownloads(projectDirectory);
            if (!entries.empty() && !entries.front().isDownloading)
            {
                break;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_FALSE(entries.front().isDownloading);
        EXPECT_FALSE(entries.front().canInstall);
        EXPECT_NE(entries.front().status.find(L"expired"), std::wstring::npos);
        EXPECT_EQ(transferCalls.load(), 0);

        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(DownloadServiceTests, ListDownloadsRemovesAtomicBackupFiles)
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

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::filesystem::path downloadsDirectory = projectDirectory / L"downloads";
        writeTextFile(downloadsDirectory / L"Ready.zip", "archive");
        writeTextFile(downloadsDirectory / L".fb1234abcd", "nxm://skyrimspecialedition/mods/3863/files/123");

        const std::vector<DownloadEntry> entries = downloads.listDownloads(projectDirectory);

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_EQ(entries.front().fileName, L"Ready.zip");
        EXPECT_FALSE(std::filesystem::exists(downloadsDirectory / L".fb1234abcd"));

        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
    }

    TEST(DownloadServiceTests, ListDownloadsSortsFilesByCachedLastWriteTime)
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

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::filesystem::path downloadsDirectory = projectDirectory / L"downloads";
        const std::filesystem::path olderPath = downloadsDirectory / L"Older.zip";
        const std::filesystem::path newerPath = downloadsDirectory / L"Newer.zip";
        writeTextFile(olderPath, "old archive");
        writeTextFile(newerPath, "new archive");

        const std::filesystem::file_time_type now = std::filesystem::file_time_type::clock::now();
        std::filesystem::last_write_time(olderPath, now - std::chrono::hours(2));
        std::filesystem::last_write_time(newerPath, now - std::chrono::hours(1));

        const std::vector<DownloadEntry> entries = downloads.listDownloads(projectDirectory);

        ASSERT_EQ(entries.size(), 2U);
        EXPECT_EQ(entries[0].fileName, L"Newer.zip");
        EXPECT_EQ(entries[1].fileName, L"Older.zip");

        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
    }

    TEST(DownloadServiceTests, ListDownloadsSkipsUnsupportedFilesAndLeavesCompletedProgressEmpty)
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

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::filesystem::path downloadsDirectory = projectDirectory / L"downloads";
        const std::filesystem::path archivePath = downloadsDirectory / L"Ready.zip";
        writeTextFile(archivePath, "archive");
        writeTextFile(downloadsDirectory / L"notes.txt", "not a supported download");
        writeTextFile(
            archivePath.wstring() + L".fluxora.json",
            R"({"installedModName":"Sky Mod","bytesReceived":100,"totalBytes":100,"isDownloading":false})");

        const std::vector<DownloadEntry> entries = downloads.listDownloads(projectDirectory);

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_EQ(entries.front().fileName, L"Ready.zip");
        EXPECT_FALSE(entries.front().hasKnownProgress);
        EXPECT_EQ(entries.front().progressPercent, 0);
        EXPECT_TRUE(entries.front().progressText.empty());

        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
    }

    TEST(DownloadServiceTests, ListDownloadsUsesDownloadedFileNameInsteadOfNexusModTitle)
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

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::filesystem::path archivePath = projectDirectory / L"downloads" /
            L"Cabbage CS Preset 182366 5 2026-07-01T12-33Z Ks18n0uG9.7z";
        writeTextFile(archivePath, "archive");
        writeTextFile(
            archivePath.wstring() + L".fluxora.json",
            R"({"nexusModName":"Cabbage Community Shaders preset for NAT","isDownloading":false})");

        const std::vector<DownloadEntry> entries = downloads.listDownloads(projectDirectory);

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_EQ(entries.front().name, L"Cabbage CS Preset 182366 5 2026-07-01T12-33Z Ks18n0uG9");

        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
    }

    TEST(DownloadServiceTests, ListDownloadsUsesVolatileProgressSidecarWithoutRewritingDurableMetadata)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
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

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::filesystem::path downloadsDirectory = projectDirectory / L"downloads";
        const std::filesystem::path pendingPath = downloadsDirectory / L"skyrimspecialedition-3863-123.nxm";
        writeTextFile(pendingPath, "nxm://skyrimspecialedition/mods/3863/files/123");

        constexpr std::uintmax_t startedUnix = 1782067200;
        test_hooks::writeDownloadProgressCheckpointForTest(pendingPath, 0, 1000, startedUnix);
        const std::filesystem::path durableMetadataPath = pendingPath.wstring() + L".fluxora.json";
        const std::string durableMetadataBefore = readTextFile(durableMetadataPath);

        test_hooks::writeDownloadProgressSidecarForTest(pendingPath, 500, 1000, startedUnix);

        EXPECT_EQ(readTextFile(durableMetadataPath), durableMetadataBefore);
        EXPECT_TRUE(std::filesystem::exists(test_hooks::downloadProgressSidecarPathForTest(pendingPath)));

        const ScopedActiveDownload activeDownload(pendingPath);
        const std::vector<DownloadEntry> entries = downloads.listDownloads(projectDirectory);

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_EQ(entries.front().fileName, L"skyrimspecialedition-3863-123.nxm");
        EXPECT_TRUE(entries.front().isDownloading);
        EXPECT_TRUE(entries.front().hasKnownProgress);
        EXPECT_EQ(entries.front().progressPercent, 50);

        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(DownloadServiceTests, ListDownloadsPreservesWaitingForSlotStatus)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
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

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::filesystem::path pendingPath =
            projectDirectory / L"downloads" / L"skyrimspecialedition-3863-123.nxm";
        writeTextFile(pendingPath, "nxm://skyrimspecialedition/mods/3863/files/123");
        writeTextFile(
            pendingPath.wstring() + L".fluxora.json",
            R"({"status":"Ожидает свободный слот","isDownloading":true})");

        const ScopedActiveDownload activeDownload(pendingPath);
        const std::vector<DownloadEntry> entries = downloads.listDownloads(projectDirectory);

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_TRUE(entries.front().isDownloading);
        EXPECT_EQ(entries.front().status, L"Ожидает свободный слот");

        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(DownloadServiceTests, TruncatedHttp200ResponseDoesNotPromotePartialDownload)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        TempDirectory temp;
        const std::filesystem::path partialPath = temp.path() / L"mod.zip.part";
        const std::filesystem::path destinationPath = temp.path() / L"mod.zip";
        writeTextFile(partialPath, "short");

        EXPECT_THROW(
            test_hooks::finalizeHttpDownloadResponseForTest(
                partialPath,
                destinationPath,
                200,
                0,
                L"10",
                L"",
                5),
            std::runtime_error);

        EXPECT_TRUE(std::filesystem::is_regular_file(partialPath));
        EXPECT_EQ("short", readTextFile(partialPath));
        EXPECT_FALSE(std::filesystem::exists(destinationPath));
#endif
    }

    TEST(DownloadServiceTests, TruncatedHttp206ResponseDoesNotPromotePartialDownload)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        TempDirectory temp;
        const std::filesystem::path partialPath = temp.path() / L"mod.zip.part";
        const std::filesystem::path destinationPath = temp.path() / L"mod.zip";
        writeTextFile(partialPath, "prefixxy");

        EXPECT_THROW(
            test_hooks::finalizeHttpDownloadResponseForTest(
                partialPath,
                destinationPath,
                206,
                6,
                L"5",
                L"bytes 6-10/11",
                2),
            std::runtime_error);

        EXPECT_TRUE(std::filesystem::is_regular_file(partialPath));
        EXPECT_EQ("prefixxy", readTextFile(partialPath));
        EXPECT_FALSE(std::filesystem::exists(destinationPath));
#endif
    }

    TEST(DownloadServiceTests, IncompleteUnsolicitedHttp206RangeDoesNotPromotePartialDownload)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        TempDirectory temp;
        const std::filesystem::path partialPath = temp.path() / L"mod.zip.part";
        const std::filesystem::path destinationPath = temp.path() / L"mod.zip";
        writeTextFile(partialPath, "short");

        EXPECT_THROW(
            test_hooks::finalizeHttpDownloadResponseForTest(
                partialPath,
                destinationPath,
                206,
                0,
                L"5",
                L"bytes 0-4/10",
                5),
            std::runtime_error);

        EXPECT_TRUE(std::filesystem::is_regular_file(partialPath));
        EXPECT_EQ("short", readTextFile(partialPath));
        EXPECT_FALSE(std::filesystem::exists(destinationPath));
#endif
    }

    TEST(DownloadServiceTests, ResumedHttp206ResponseMustStartAtRequestedOffset)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        TempDirectory temp;
        const std::filesystem::path partialPath = temp.path() / L"mod.zip.part";
        const std::filesystem::path destinationPath = temp.path() / L"mod.zip";
        writeTextFile(partialPath, "prefix");

        EXPECT_THROW(
            test_hooks::finalizeHttpDownloadResponseForTest(
                partialPath,
                destinationPath,
                206,
                6,
                L"5",
                L"bytes 5-9/10",
                0),
            std::runtime_error);

        EXPECT_TRUE(std::filesystem::is_regular_file(partialPath));
        EXPECT_EQ("prefix", readTextFile(partialPath));
        EXPECT_FALSE(std::filesystem::exists(destinationPath));
#endif
    }

    TEST(DownloadServiceTests, ExternalExtractorCancellationTerminatesOwnedProcessAndConfirmsExit)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        std::size_t terminationCalls = 0;
        std::size_t postTerminationWaits = 0;

        EXPECT_EQ(
            "canceled",
            test_hooks::externalProcessWaitOutcomeForTest(
                {"wait", "cancel"},
                terminationCalls,
                postTerminationWaits));
        EXPECT_EQ(terminationCalls, 1U);
        EXPECT_EQ(postTerminationWaits, 1U);
#endif
    }

    TEST(DownloadServiceTests, ExternalExtractorTimeoutTerminatesOwnedProcessAndConfirmsExit)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        std::size_t terminationCalls = 0;
        std::size_t postTerminationWaits = 0;

        EXPECT_EQ(
            "timed-out",
            test_hooks::externalProcessWaitOutcomeForTest(
                {"wait", "timeout"},
                terminationCalls,
                postTerminationWaits));
        EXPECT_EQ(terminationCalls, 1U);
        EXPECT_EQ(postTerminationWaits, 1U);
#endif
    }

    TEST(DownloadServiceTests, NxmWorkerRestoresCapturedOperationContextAndClearsItAfterJob)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable logDirectory(L"FLUXORA_LOG_DIR", (temp.path() / L"logs").wstring());
        constexpr std::string_view inScopeMarker = "nxm-worker-operation-context";
        constexpr std::string_view afterScopeMarker = "nxm-worker-context-cleared";

        Logger::setOperationId(L"queued-nxm-operation");
        Logger logger;
        logger.initialize();
        test_hooks::writeNxmWorkerOperationContextLogForTest(
            logger,
            Logger::operationId(),
            std::string(inScopeMarker),
            std::string(afterScopeMarker));
        EXPECT_EQ(Logger::operationId(), "queued-nxm-operation");
        logger.shutdown();
        Logger::clearOperationId();

        const std::string content = readTextFile(logger.logPath());
        const std::size_t inScopePosition = content.find(inScopeMarker);
        ASSERT_NE(inScopePosition, std::string::npos);
        const std::size_t inScopeLineStart = content.rfind('\n', inScopePosition);
        const std::size_t inScopeLineEnd = content.find('\n', inScopePosition);
        const std::string inScopeLine = content.substr(
            inScopeLineStart == std::string::npos ? 0 : inScopeLineStart + 1,
            inScopeLineEnd - (inScopeLineStart == std::string::npos ? 0 : inScopeLineStart + 1));
        EXPECT_NE(inScopeLine.find("operationId=queued-nxm-operation"), std::string::npos);

        const std::size_t afterScopePosition = content.find(afterScopeMarker);
        ASSERT_NE(afterScopePosition, std::string::npos);
        const std::size_t afterScopeLineStart = content.rfind('\n', afterScopePosition);
        const std::size_t afterScopeLineEnd = content.find('\n', afterScopePosition);
        const std::string afterScopeLine = content.substr(
            afterScopeLineStart == std::string::npos ? 0 : afterScopeLineStart + 1,
            afterScopeLineEnd - (afterScopeLineStart == std::string::npos ? 0 : afterScopeLineStart + 1));
        EXPECT_EQ(afterScopeLine.find("operationId="), std::string::npos);
#endif
    }

    TEST(DownloadServiceTests, QueueWorkersAndSynchronousTransfersShareFiveSlots)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
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

        std::mutex mutex;
        std::condition_variable changed;
        std::size_t activeCount = 0;
        std::size_t maximumObserved = 0;
        std::size_t completedQueuedCount = 0;
        std::size_t queuedReleases = 0;
        bool synchronousWaiting = false;
        bool synchronousStarted = false;

        const auto queuedTransfer = [&]()
        {
            std::unique_lock lock(mutex);
            ++activeCount;
            maximumObserved = (std::max)(maximumObserved, activeCount);
            changed.notify_all();
            changed.wait(lock, [&]()
            {
                return queuedReleases > 0;
            });
            --queuedReleases;
            --activeCount;
            ++completedQueuedCount;
            changed.notify_all();
        };

        for (std::ptrdiff_t index = 0;
             index < DownloadTransferLimiter::MaximumActiveTransfers;
             ++index)
        {
            downloads.queueTransferProbeForTest(queuedTransfer);
        }

        bool fiveWorkersStarted = false;
        {
            std::unique_lock lock(mutex);
            fiveWorkersStarted = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return activeCount == static_cast<std::size_t>(
                    DownloadTransferLimiter::MaximumActiveTransfers);
            });
        }

        std::thread synchronousTransfer;
        try
        {
            synchronousTransfer = std::thread([&]()
            {
                downloads.runSynchronousTransferProbeForTest(
                    [&]()
                    {
                        std::lock_guard lock(mutex);
                        synchronousWaiting = true;
                        changed.notify_all();
                    },
                    [&]()
                    {
                        std::lock_guard lock(mutex);
                        ++activeCount;
                        maximumObserved = (std::max)(maximumObserved, activeCount);
                        synchronousStarted = true;
                        --activeCount;
                        changed.notify_all();
                    });
            });
        }
        catch (...)
        {
            {
                std::lock_guard lock(mutex);
                queuedReleases = DownloadTransferLimiter::MaximumActiveTransfers;
            }
            changed.notify_all();
            downloads.shutdown();
            pathSettings.shutdown();
            settings.shutdown();
            logger.shutdown();
            throw;
        }

        bool sixthReachedLimiter = false;
        bool startedAfterOneRelease = false;
        bool queuedTransfersCompleted = false;
        {
            std::unique_lock lock(mutex);
            sixthReachedLimiter = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return synchronousWaiting;
            });
            if (fiveWorkersStarted && sixthReachedLimiter)
            {
                EXPECT_FALSE(synchronousStarted);
            }

            queuedReleases = 1;
            changed.notify_all();
            startedAfterOneRelease = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return synchronousStarted;
            });

            queuedReleases = DownloadTransferLimiter::MaximumActiveTransfers;
            changed.notify_all();
            queuedTransfersCompleted = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return completedQueuedCount == static_cast<std::size_t>(
                    DownloadTransferLimiter::MaximumActiveTransfers);
            });
        }

        if (synchronousTransfer.joinable())
        {
            synchronousTransfer.join();
        }
        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();

        EXPECT_TRUE(fiveWorkersStarted);
        EXPECT_TRUE(sixthReachedLimiter);
        EXPECT_TRUE(startedAfterOneRelease);
        EXPECT_TRUE(queuedTransfersCompleted);
        EXPECT_EQ(maximumObserved, 5U);
#endif
    }

    TEST(DownloadServiceTests, PublicNexusEntryPointsShareFiveTransferSlots)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.isPremium = true;
        auth.protectedApiKey = L"protected-test-key";
        settings.saveNexusModsAuth(auth);
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadTransferLimiter transferLimiter;
        DownloadService downloads(logger, settings, pathSettings, transferLimiter);
        downloads.initialize();

        std::mutex mutex;
        std::condition_variable changed;
        std::size_t activeCount = 0;
        std::size_t maximumObserved = 0;
        std::size_t completedCount = 0;
        std::size_t releaseCount = 0;
        bool synchronousWaiting = false;
        bool synchronousEnteredTransfer = false;

        const ScopedNexusArchiveTransferHooks transferHooks(
            [&](std::wstring_view fileId)
            {
                if (fileId != L"999")
                {
                    return;
                }

                std::lock_guard lock(mutex);
                synchronousWaiting = true;
                changed.notify_all();
            },
            [&](const std::filesystem::path& directory,
                const std::filesystem::path&,
                std::wstring_view fileId)
            {
                {
                    std::unique_lock lock(mutex);
                    ++activeCount;
                    maximumObserved = (std::max)(maximumObserved, activeCount);
                    if (fileId == L"999")
                    {
                        synchronousEnteredTransfer = true;
                    }
                    changed.notify_all();
                    changed.wait(lock, [&]()
                    {
                        return releaseCount > 0;
                    });
                    --releaseCount;
                    --activeCount;
                    ++completedCount;
                    changed.notify_all();
                }

                const std::filesystem::path archivePath =
                    directory / (L"nexus-fixture-" + std::wstring(fileId) + L".zip");
                writeTextFile(archivePath, "fixture archive");
                return archivePath;
            });

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::vector<DownloadEntry> queuedEntries = downloads.captureNxmLinks(
            projectDirectory,
            {
                L"nxm://skyrimspecialedition/mods/3863/files/101",
                L"nxm://skyrimspecialedition/mods/3863/files/102",
                L"nxm://skyrimspecialedition/mods/3863/files/103",
                L"nxm://skyrimspecialedition/mods/3863/files/104",
                L"nxm://skyrimspecialedition/mods/3863/files/105"
            });

        bool fiveQueuedTransfersStarted = false;
        {
            std::unique_lock lock(mutex);
            fiveQueuedTransfersStarted = changed.wait_for(
                lock,
                std::chrono::seconds(5),
                [&]()
                {
                    return activeCount == static_cast<std::size_t>(
                        DownloadTransferLimiter::MaximumActiveTransfers);
                });
        }

        std::exception_ptr synchronousFailure;
        std::thread synchronousDownload;
        try
        {
            synchronousDownload = std::thread([&]()
            {
                try
                {
                    (void)downloads.downloadNxmForFluxPack(
                        projectDirectory,
                        L"nxm://skyrimspecialedition/mods/3863/files/999");
                }
                catch (...)
                {
                    synchronousFailure = std::current_exception();
                }
            });
        }
        catch (...)
        {
            {
                std::lock_guard lock(mutex);
                releaseCount = DownloadTransferLimiter::MaximumActiveTransfers;
            }
            changed.notify_all();
            downloads.shutdown();
            pathSettings.shutdown();
            settings.shutdown();
            logger.shutdown();
            throw;
        }

        bool sixthReachedProductionLimiter = false;
        bool sixthStartedAfterRelease = false;
        bool allTransfersCompleted = false;
        {
            std::unique_lock lock(mutex);
            sixthReachedProductionLimiter = changed.wait_for(
                lock,
                std::chrono::seconds(5),
                [&]()
                {
                    return synchronousWaiting;
                });
            if (fiveQueuedTransfersStarted && sixthReachedProductionLimiter)
            {
                EXPECT_FALSE(synchronousEnteredTransfer);
            }

            releaseCount = 1;
            changed.notify_all();
            sixthStartedAfterRelease = changed.wait_for(
                lock,
                std::chrono::seconds(5),
                [&]()
                {
                    return synchronousEnteredTransfer;
                });

            releaseCount = DownloadTransferLimiter::MaximumActiveTransfers;
            changed.notify_all();
            allTransfersCompleted = changed.wait_for(
                lock,
                std::chrono::seconds(5),
                [&]()
                {
                    return completedCount == 6U;
                });
        }

        if (synchronousDownload.joinable())
        {
            synchronousDownload.join();
        }
        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();

        EXPECT_EQ(queuedEntries.size(), 5U);
        EXPECT_TRUE(fiveQueuedTransfersStarted);
        EXPECT_TRUE(sixthReachedProductionLimiter);
        EXPECT_TRUE(sixthStartedAfterRelease);
        EXPECT_TRUE(allTransfersCompleted);
        EXPECT_EQ(maximumObserved, 5U);
        if (synchronousFailure != nullptr)
        {
            try
            {
                std::rethrow_exception(synchronousFailure);
            }
            catch (const std::exception& exception)
            {
                ADD_FAILURE() << "Synchronous FluxPack transfer failed: " << exception.what();
            }
            catch (...)
            {
                ADD_FAILURE() << "Synchronous FluxPack transfer failed with an unknown error.";
            }
        }
#endif
    }

    TEST(DownloadServiceTests, CanceledQueuedNexusTransferDoesNotEnterTransportAfterSlotRelease)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        NexusModsStoredAuth auth;
        auth.linked = true;
        auth.isPremium = true;
        auth.protectedApiKey = L"protected-test-key";
        settings.saveNexusModsAuth(auth);
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadTransferLimiter transferLimiter;
        DownloadService downloads(logger, settings, pathSettings, transferLimiter);
        downloads.initialize();

        std::mutex mutex;
        std::condition_variable changed;
        std::size_t activeSynchronousCount = 0;
        std::size_t completedSynchronousCount = 0;
        std::size_t releaseCount = 0;
        bool queuedReachedLimiter = false;
        bool canceledTransferEnteredTransport = false;

        const ScopedNexusArchiveTransferHooks transferHooks(
            [&](std::wstring_view fileId)
            {
                if (fileId != L"777")
                {
                    return;
                }

                std::lock_guard lock(mutex);
                queuedReachedLimiter = true;
                changed.notify_all();
            },
            [&](const std::filesystem::path& directory,
                const std::filesystem::path&,
                std::wstring_view fileId)
            {
                if (fileId == L"777")
                {
                    {
                        std::lock_guard lock(mutex);
                        canceledTransferEnteredTransport = true;
                        changed.notify_all();
                    }
                }
                else
                {
                    std::unique_lock lock(mutex);
                    ++activeSynchronousCount;
                    changed.notify_all();
                    changed.wait(lock, [&]()
                    {
                        return releaseCount > 0;
                    });
                    --releaseCount;
                    --activeSynchronousCount;
                    ++completedSynchronousCount;
                    changed.notify_all();
                }

                const std::filesystem::path archivePath =
                    directory / (L"nexus-cancel-fixture-" + std::wstring(fileId) + L".zip");
                writeTextFile(archivePath, "fixture archive");
                return archivePath;
            });

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        std::array<std::exception_ptr, 5> synchronousFailures;
        std::vector<std::thread> synchronousDownloads;
        synchronousDownloads.reserve(synchronousFailures.size());
        try
        {
            for (std::size_t index = 0; index < synchronousFailures.size(); ++index)
            {
                synchronousDownloads.emplace_back([&, index]()
                {
                    try
                    {
                        (void)downloads.downloadNxmForFluxPack(
                            projectDirectory,
                            L"nxm://skyrimspecialedition/mods/3863/files/" +
                                std::to_wstring(201U + index));
                    }
                    catch (...)
                    {
                        synchronousFailures[index] = std::current_exception();
                    }
                });
            }
        }
        catch (...)
        {
            {
                std::lock_guard lock(mutex);
                releaseCount = synchronousFailures.size();
            }
            changed.notify_all();
            for (std::thread& download : synchronousDownloads)
            {
                download.join();
            }
            downloads.shutdown();
            pathSettings.shutdown();
            settings.shutdown();
            logger.shutdown();
            throw;
        }

        bool fiveSynchronousTransfersStarted = false;
        {
            std::unique_lock lock(mutex);
            fiveSynchronousTransfersStarted = changed.wait_for(
                lock,
                std::chrono::seconds(5),
                [&]()
                {
                    return activeSynchronousCount == synchronousFailures.size();
                });
        }

        const std::vector<DownloadEntry> queuedEntries = downloads.captureNxmLinks(
            projectDirectory,
            {L"nxm://skyrimspecialedition/mods/3863/files/777"});
        bool waiterObserved = false;
        {
            std::unique_lock lock(mutex);
            waiterObserved = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return queuedReachedLimiter;
            });
        }

        if (!queuedEntries.empty())
        {
            downloads.cancelDownload(projectDirectory, queuedEntries.front().localPath);
        }

        bool synchronousTransfersCompleted = false;
        {
            std::unique_lock lock(mutex);
            releaseCount = synchronousFailures.size();
            changed.notify_all();
            synchronousTransfersCompleted = changed.wait_for(
                lock,
                std::chrono::seconds(5),
                [&]()
                {
                    return completedSynchronousCount == synchronousFailures.size();
                });
        }
        for (std::thread& download : synchronousDownloads)
        {
            download.join();
        }

        downloads.shutdown();
        const std::vector<DownloadEntry> finalEntries = downloads.listDownloads(projectDirectory);
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();

        const auto canceledEntry = std::find_if(
            finalEntries.begin(),
            finalEntries.end(),
            [&](const DownloadEntry& entry)
            {
                return !queuedEntries.empty() && entry.localPath == queuedEntries.front().localPath;
            });
        EXPECT_TRUE(fiveSynchronousTransfersStarted);
        EXPECT_EQ(queuedEntries.size(), 1U);
        EXPECT_TRUE(waiterObserved);
        EXPECT_TRUE(synchronousTransfersCompleted);
        EXPECT_FALSE(canceledTransferEnteredTransport);
        ASSERT_NE(canceledEntry, finalEntries.end());
        EXPECT_FALSE(canceledEntry->isDownloading);
        EXPECT_EQ(canceledEntry->status, L"Отменено");
        for (const std::exception_ptr& failure : synchronousFailures)
        {
            EXPECT_EQ(failure, nullptr);
        }
#endif
    }

    TEST(DownloadServiceTests, NewPendingNexusTransferIgnoresOrphanedCancelMarker)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadTransferLimiter transferLimiter;
        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::wstring link = L"nxm://skyrimspecialedition/mods/3863/files/778";

        std::filesystem::path orphanedPendingPath;
        {
            DownloadService stoppedDownloads(logger, settings, pathSettings, transferLimiter);
            stoppedDownloads.initialize();
            stoppedDownloads.shutdown();
            const std::vector<DownloadEntry> stoppedEntries = stoppedDownloads.captureNxmLinks(
                projectDirectory,
                {link});
            ASSERT_EQ(stoppedEntries.size(), 1U);
            orphanedPendingPath = stoppedEntries.front().localPath;
        }

        ASSERT_TRUE(std::filesystem::remove(orphanedPendingPath));
        const std::filesystem::path orphanedCancelMarker(
            orphanedPendingPath.wstring() + L".cancel");
        writeTextFile(orphanedCancelMarker, "cancel");

        std::mutex mutex;
        std::condition_variable changed;
        bool enteredTransport = false;
        bool markerPresentBeforeAcquire = false;
        const ScopedNexusArchiveTransferHooks transferHooks(
            [&](std::wstring_view fileId)
            {
                if (fileId == L"778")
                {
                    markerPresentBeforeAcquire = std::filesystem::exists(orphanedCancelMarker);
                }
            },
            [&](const std::filesystem::path& directory,
                const std::filesystem::path&,
                std::wstring_view fileId)
            {
                {
                    std::lock_guard lock(mutex);
                    enteredTransport = true;
                    changed.notify_all();
                }
                const std::filesystem::path archivePath =
                    directory / (L"nexus-orphan-marker-fixture-" + std::wstring(fileId) + L".zip");
                writeTextFile(archivePath, "fixture archive");
                return archivePath;
            });

        DownloadService downloads(logger, settings, pathSettings, transferLimiter);
        downloads.initialize();
        const std::vector<DownloadEntry> entries = downloads.captureNxmLinks(
            projectDirectory,
            {link});
        bool transferCompleted = false;
        {
            std::unique_lock lock(mutex);
            transferCompleted = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return enteredTransport;
            });
        }
        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_EQ(entries.front().localPath, orphanedPendingPath);
        EXPECT_TRUE(transferCompleted);
        EXPECT_FALSE(markerPresentBeforeAcquire);
#endif
    }

    TEST(DownloadServiceTests, ConcurrentAliasedNamesReserveDistinctOutputPaths)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        TempDirectory temp;
        const std::filesystem::path directory = temp.path() / L"Downloads";
        std::filesystem::create_directories(directory);
        writeTextFile(directory / L"shared-name.zip", "existing fixture");

        std::mutex mutex;
        std::condition_variable changed;
        bool firstEntered = false;
        bool releaseFirst = false;
        std::filesystem::path firstDestination;
        std::filesystem::path firstPartial;
        std::exception_ptr firstFailure;
        std::thread first([&]()
        {
            try
            {
                test_hooks::withDownloadOutputPathsForTest(
                    directory,
                    L"shared-name.zip",
                    [&](const std::filesystem::path& destinationPath,
                        const std::filesystem::path& partialPath)
                    {
                        firstDestination = destinationPath;
                        firstPartial = partialPath;
                        std::unique_lock lock(mutex);
                        firstEntered = true;
                        changed.notify_all();
                        changed.wait(lock, [&]()
                        {
                            return releaseFirst;
                        });
                    });
            }
            catch (...)
            {
                firstFailure = std::current_exception();
                std::lock_guard lock(mutex);
                firstEntered = true;
                changed.notify_all();
            }
        });

        bool observedFirst = false;
        {
            std::unique_lock lock(mutex);
            observedFirst = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return firstEntered;
            });
        }

        std::filesystem::path aliasedDestination;
        std::filesystem::path aliasedPartial;
        test_hooks::withDownloadOutputPathsForTest(
            directory,
            L"shared-name (2).zip",
            [&](const std::filesystem::path& destinationPath,
                const std::filesystem::path& partialPath)
            {
                aliasedDestination = destinationPath;
                aliasedPartial = partialPath;
            });

        std::filesystem::path sameNameDestination;
        std::filesystem::path sameNamePartial;
        test_hooks::withDownloadOutputPathsForTest(
            directory,
            L"shared-name.zip",
            [&](const std::filesystem::path& destinationPath,
                const std::filesystem::path& partialPath)
            {
                sameNameDestination = destinationPath;
                sameNamePartial = partialPath;
            });

        {
            std::lock_guard lock(mutex);
            releaseFirst = true;
        }
        changed.notify_all();
        first.join();

        EXPECT_TRUE(observedFirst);
        EXPECT_EQ(firstFailure, nullptr);
        EXPECT_EQ(firstDestination.filename(), L"shared-name (2).zip");
        EXPECT_NE(firstDestination, aliasedDestination);
        EXPECT_NE(firstDestination, sameNameDestination);
        EXPECT_NE(firstPartial, aliasedPartial);
        EXPECT_NE(firstPartial, sameNamePartial);
#endif
    }

    TEST(DownloadServiceTests, AliasedExistingPartialPathCanOnlyHaveOneActiveOwner)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        TempDirectory temp;
        const std::filesystem::path partialPath = temp.path() / L"shared-download.zip.part";
        writeTextFile(partialPath, "partial fixture");

        std::mutex mutex;
        std::condition_variable changed;
        bool firstEntered = false;
        bool releaseFirst = false;
        std::exception_ptr firstFailure;
        std::thread first([&]()
        {
            try
            {
                test_hooks::withExistingDownloadOutputPathReservationForTest(
                    partialPath,
                    [&]()
                    {
                        std::unique_lock lock(mutex);
                        firstEntered = true;
                        changed.notify_all();
                        changed.wait(lock, [&]()
                        {
                            return releaseFirst;
                        });
                    });
            }
            catch (...)
            {
                firstFailure = std::current_exception();
                std::lock_guard lock(mutex);
                firstEntered = true;
                changed.notify_all();
            }
        });

        bool observedFirst = false;
        {
            std::unique_lock lock(mutex);
            observedFirst = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return firstEntered;
            });
        }

        bool aliasedOwnerRejected = false;
        try
        {
            test_hooks::withExistingDownloadOutputPathReservationForTest(partialPath, []() {});
        }
        catch (const std::runtime_error&)
        {
            aliasedOwnerRejected = true;
        }

        {
            std::lock_guard lock(mutex);
            releaseFirst = true;
        }
        changed.notify_all();
        first.join();

        bool acquiredAfterRelease = false;
        test_hooks::withExistingDownloadOutputPathReservationForTest(
            partialPath,
            [&]()
            {
                acquiredAfterRelease = true;
            });

        EXPECT_TRUE(observedFirst);
        EXPECT_EQ(firstFailure, nullptr);
        EXPECT_TRUE(aliasedOwnerRejected);
        EXPECT_TRUE(acquiredAfterRelease);
#endif
    }

    TEST(DownloadServiceTests, LocalImportAvoidsActiveHttpOutputReservation)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
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

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::filesystem::path directory = pathSettings.downloadsDirectory(projectDirectory);
        std::filesystem::create_directories(directory);
        writeTextFile(directory / L"shared-name.zip", "existing fixture");
        const std::filesystem::path sourceDirectory = temp.path() / L"Source";
        std::filesystem::create_directories(sourceDirectory);
        const std::filesystem::path sourcePath = sourceDirectory / L"shared-name (2).zip";
        writeTextFile(sourcePath, "import fixture");

        std::mutex mutex;
        std::condition_variable changed;
        bool reservationEntered = false;
        bool releaseReservation = false;
        std::filesystem::path reservedDestination;
        std::exception_ptr reservationFailure;
        std::thread reservation([&]()
        {
            try
            {
                test_hooks::withDownloadOutputPathsForTest(
                    directory,
                    L"shared-name.zip",
                    [&](const std::filesystem::path& destinationPath,
                        const std::filesystem::path&)
                    {
                        reservedDestination = destinationPath;
                        std::unique_lock lock(mutex);
                        reservationEntered = true;
                        changed.notify_all();
                        changed.wait(lock, [&]()
                        {
                            return releaseReservation;
                        });
                    });
            }
            catch (...)
            {
                reservationFailure = std::current_exception();
                std::lock_guard lock(mutex);
                reservationEntered = true;
                changed.notify_all();
            }
        });

        bool observedReservation = false;
        {
            std::unique_lock lock(mutex);
            observedReservation = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return reservationEntered;
            });
        }

        DownloadEntry importedEntry;
        std::exception_ptr importFailure;
        try
        {
            importedEntry = downloads.importLocalFile(projectDirectory, sourcePath);
        }
        catch (...)
        {
            importFailure = std::current_exception();
        }

        {
            std::lock_guard lock(mutex);
            releaseReservation = true;
        }
        changed.notify_all();
        reservation.join();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();

        EXPECT_TRUE(observedReservation);
        EXPECT_EQ(reservationFailure, nullptr);
        EXPECT_EQ(importFailure, nullptr);
        EXPECT_EQ(reservedDestination.filename(), L"shared-name (2).zip");
        EXPECT_NE(importedEntry.localPath, reservedDestination);
        EXPECT_TRUE(std::filesystem::exists(importedEntry.localPath));
#endif
    }

    TEST(DownloadServiceTests, ConcurrentResumeClaimsPendingDownloadOnce)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadTransferLimiter transferLimiter;
        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::wstring link = L"nxm://skyrimspecialedition/mods/3863/files/779";

        std::filesystem::path pendingPath;
        {
            DownloadService stoppedDownloads(logger, settings, pathSettings, transferLimiter);
            stoppedDownloads.initialize();
            stoppedDownloads.shutdown();
            const std::vector<DownloadEntry> entries = stoppedDownloads.captureNxmLinks(
                projectDirectory,
                {link});
            ASSERT_EQ(entries.size(), 1U);
            pendingPath = entries.front().localPath;
        }

        std::mutex mutex;
        std::condition_variable changed;
        std::size_t claimArrivals = 0;
        std::size_t callsCompleted = 0;
        std::size_t transportCount = 0;
        bool releaseTransport = false;
        const ScopedResumeBeforeClaimHook claimHook([&]()
        {
            std::unique_lock lock(mutex);
            ++claimArrivals;
            changed.notify_all();
            changed.wait(lock, [&]()
            {
                return claimArrivals == 2U;
            });
        });
        const ScopedNexusArchiveTransferHooks transferHooks(
            {},
            [&](const std::filesystem::path& directory,
                const std::filesystem::path&,
                std::wstring_view fileId)
            {
                {
                    std::unique_lock lock(mutex);
                    ++transportCount;
                    changed.notify_all();
                    changed.wait(lock, [&]()
                    {
                        return releaseTransport;
                    });
                }
                const std::filesystem::path archivePath =
                    directory / (L"nexus-resume-fixture-" + std::wstring(fileId) + L".zip");
                writeTextFile(archivePath, "fixture archive");
                return archivePath;
            });

        DownloadService downloads(logger, settings, pathSettings, transferLimiter);
        downloads.initialize();
        std::array<bool, 2> resumed{};
        std::array<std::exception_ptr, 2> failures{};
        std::array<std::thread, 2> callers;
        for (std::size_t index = 0; index < callers.size(); ++index)
        {
            callers[index] = std::thread([&, index]()
            {
                try
                {
                    (void)downloads.resumeDownload(projectDirectory, pendingPath);
                    resumed[index] = true;
                }
                catch (...)
                {
                    failures[index] = std::current_exception();
                }
                std::lock_guard lock(mutex);
                ++callsCompleted;
                changed.notify_all();
            });
        }

        bool bothCallsCompleted = false;
        bool transportObserved = false;
        {
            std::unique_lock lock(mutex);
            bothCallsCompleted = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return callsCompleted == callers.size();
            });
            transportObserved = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return transportCount > 0;
            });
            releaseTransport = true;
        }
        changed.notify_all();
        for (std::thread& caller : callers)
        {
            caller.join();
        }
        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();

        const std::size_t resumeSuccesses = static_cast<std::size_t>(resumed[0]) +
            static_cast<std::size_t>(resumed[1]);
        const std::size_t resumeFailures = static_cast<std::size_t>(failures[0] != nullptr) +
            static_cast<std::size_t>(failures[1] != nullptr);
        EXPECT_TRUE(bothCallsCompleted);
        EXPECT_TRUE(transportObserved);
        EXPECT_EQ(claimArrivals, 2U);
        EXPECT_EQ(resumeSuccesses, 1U);
        EXPECT_EQ(resumeFailures, 1U);
        EXPECT_EQ(transportCount, 1U);
#endif
    }

    TEST(DownloadServiceTests, QueueRejectsNewJobsAfterShutdown)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
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
        downloads.shutdown();

        EXPECT_THROW(downloads.queueTransferProbeForTest([]() {}), std::runtime_error);

        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(DownloadServiceTests, QueueWorkersContinueAfterTransferExceptions)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
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

        for (std::ptrdiff_t index = 0;
             index < DownloadTransferLimiter::MaximumActiveTransfers;
             ++index)
        {
            downloads.queueTransferProbeForTest([]()
            {
                throw std::runtime_error("simulated queued transfer failure");
            });
        }

        std::mutex mutex;
        std::condition_variable changed;
        bool followUpRan = false;
        downloads.queueTransferProbeForTest([&]()
        {
            std::lock_guard lock(mutex);
            followUpRan = true;
            changed.notify_all();
        });

        bool workerContinued = false;
        {
            std::unique_lock lock(mutex);
            workerContinued = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return followUpRan;
            });
        }

        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();

        EXPECT_TRUE(workerContinued);
#endif
    }

    TEST(DownloadServiceTests, ConcurrentShutdownJoinsWorkerPoolOnce)
    {
#ifndef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        GTEST_SKIP() << "Download service test hooks are disabled.";
#else
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

        std::mutex mutex;
        std::condition_variable changed;
        bool probeCompleted = false;
        downloads.queueTransferProbeForTest([&]()
        {
            std::lock_guard lock(mutex);
            probeCompleted = true;
            changed.notify_all();
        });
        {
            std::unique_lock lock(mutex);
            ASSERT_TRUE(changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return probeCompleted;
            }));
        }

        std::size_t readyCount = 0;
        bool startShutdown = false;
        const auto shutdown = [&]()
        {
            {
                std::unique_lock lock(mutex);
                ++readyCount;
                changed.notify_all();
                changed.wait(lock, [&]()
                {
                    return startShutdown;
                });
            }
            downloads.shutdown();
        };

        std::thread firstShutdown;
        std::thread secondShutdown;
        try
        {
            firstShutdown = std::thread(shutdown);
            secondShutdown = std::thread(shutdown);
        }
        catch (...)
        {
            {
                std::lock_guard lock(mutex);
                startShutdown = true;
            }
            changed.notify_all();
            if (firstShutdown.joinable())
            {
                firstShutdown.join();
            }
            downloads.shutdown();
            pathSettings.shutdown();
            settings.shutdown();
            logger.shutdown();
            throw;
        }

        {
            std::unique_lock lock(mutex);
            const bool bothReady = changed.wait_for(lock, std::chrono::seconds(5), [&]()
            {
                return readyCount == 2U;
            });
            EXPECT_TRUE(bothReady);
            startShutdown = true;
        }
        changed.notify_all();
        firstShutdown.join();
        secondShutdown.join();

        EXPECT_FALSE(downloads.isInitialized());
        EXPECT_THROW(downloads.queueTransferProbeForTest([]() {}), std::runtime_error);

        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }
}
