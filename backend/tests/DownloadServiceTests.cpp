#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

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

    TEST(DownloadServiceTests, CaptureNxmLinkWithoutDownloadKeyUsesAuthenticatedDownloadPath)
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
        EXPECT_NE(entries.front().status.find(L"NexusMods account is not linked"), std::wstring::npos);

        downloads.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(DownloadServiceTests, CaptureNxmLinkWithOAuthAuthWithoutApiKeyUsesOAuthTokenPath)
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
        EXPECT_NE(entries.front().status.find(L"Invalid protected NexusMods OAuth token"), std::wstring::npos);

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
}
