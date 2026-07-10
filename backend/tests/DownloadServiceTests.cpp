#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

#ifdef FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
namespace fluxora::test_hooks
{
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
    }
#endif

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
        DownloadService downloads(logger, settings, pathSettings);
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
        DownloadService downloads(logger, settings, pathSettings);
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

    TEST(DownloadServiceTests, ListDownloadsSkipsAtomicBackupFiles)
    {
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadService downloads(logger, settings, pathSettings);
        downloads.initialize();

        const std::filesystem::path projectDirectory = temp.path() / L"Project";
        const std::filesystem::path downloadsDirectory = projectDirectory / L"downloads";
        writeTextFile(downloadsDirectory / L"Ready.zip", "archive");
        writeTextFile(downloadsDirectory / L".fb1234abcd", "nxm://skyrimspecialedition/mods/3863/files/123");

        const std::vector<DownloadEntry> entries = downloads.listDownloads(projectDirectory);

        ASSERT_EQ(entries.size(), 1U);
        EXPECT_EQ(entries.front().fileName, L"Ready.zip");

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
        DownloadService downloads(logger, settings, pathSettings);
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
        DownloadService downloads(logger, settings, pathSettings);
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
        DownloadService downloads(logger, settings, pathSettings);
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
}
