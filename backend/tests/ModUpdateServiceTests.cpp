#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModUpdateService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        class FakeNexusUpdateApi final : public NexusUpdateApi
        {
        public:
            NexusModFilesResponse filesResponse;
            std::map<std::wstring, NexusModFilesResponse> filesResponsesByModId;
            NexusRecentUpdatesResponse recentResponse;
            std::vector<std::pair<std::wstring, std::wstring>> fileRequests;
            std::vector<std::pair<std::wstring, std::wstring>> recentRequests;
            std::optional<NexusUpdateApiErrorKind> fileErrorKind;
            NexusQuotaSnapshot fileErrorQuota;
            std::wstring fileErrorRetryAt;
            std::chrono::milliseconds fileDelay{0};
            std::atomic<std::size_t> activeFileRequests{0};
            std::atomic<std::size_t> maxActiveFileRequests{0};
            std::mutex mutex;

            NexusModFilesResponse fetchModFiles(
                std::wstring_view gameDomain,
                std::wstring_view modId) override
            {
                const std::size_t active = activeFileRequests.fetch_add(1) + 1;
                std::size_t observed = maxActiveFileRequests.load();
                while (observed < active &&
                    !maxActiveFileRequests.compare_exchange_weak(observed, active))
                {
                }
                struct ActiveRequestGuard
                {
                    std::atomic<std::size_t>& count;
                    ~ActiveRequestGuard()
                    {
                        count.fetch_sub(1);
                    }
                } guard{activeFileRequests};

                NexusModFilesResponse response;
                std::optional<NexusUpdateApiErrorKind> errorKind;
                NexusQuotaSnapshot errorQuota;
                std::wstring errorRetryAt;
                {
                    const std::lock_guard lock(mutex);
                    fileRequests.emplace_back(gameDomain, modId);
                    const auto perMod = filesResponsesByModId.find(std::wstring(modId));
                    response = perMod == filesResponsesByModId.end()
                        ? filesResponse
                        : perMod->second;
                    errorKind = fileErrorKind;
                    errorQuota = fileErrorQuota;
                    errorRetryAt = fileErrorRetryAt;
                }
                if (fileDelay.count() > 0)
                {
                    std::this_thread::sleep_for(fileDelay);
                }
                if (errorKind.has_value())
                {
                    throw NexusUpdateApiError(
                        *errorKind,
                        "Fake Nexus metadata failure.",
                        std::move(errorQuota),
                        std::move(errorRetryAt));
                }
                return response;
            }

            NexusRecentUpdatesResponse fetchRecentUpdates(
                std::wstring_view gameDomain,
                std::wstring_view period) override
            {
                recentRequests.emplace_back(gameDomain, period);
                return recentResponse;
            }
        };

        class ModUpdateServiceFixture : public testing::Test
        {
        protected:
            ModUpdateServiceFixture()
                : appData_(L"APPDATA", (temp_.path() / L"AppData").wstring()),
                  project_(temp_.path() / L"Nexus update project"),
                  pathSettings_(logger_)
            {
            }

            void SetUp() override
            {
#ifndef _WIN32
                GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
                InstanceMetadataStore::ensureInstance(project_, L"skyrimse");
#endif
            }

            void registerNexusMod(
                std::wstring_view folderName,
                std::wstring_view installedVersion,
                std::wstring_view modId,
                std::wstring_view fileId,
                ModSourceRecord source = {})
            {
                const std::filesystem::path modPath =
                    pathSettings_.modsDirectory(project_) / std::filesystem::path(folderName);
                writeTextFile(modPath / L"Data" / L"content.bin", "content");
                if (source.provider.empty())
                {
                    source = ModSourceRecord{
                        L"nexus",
                        L"skyrimspecialedition",
                        std::wstring(modId),
                        std::wstring(fileId),
                        L"nxm://skyrimspecialedition/mods/" + std::wstring(modId) +
                            L"/files/" + std::wstring(fileId)};
                }
                InstanceMetadataStore::registerInstalledMod(
                    project_,
                    modPath,
                    folderName,
                    installedVersion,
                    source);
            }

            ModUpdateCheckResult check(ModUpdateCheckMode mode = ModUpdateCheckMode::Manual)
            {
                ModUpdateServiceOptions options;
                options.cachePath = temp_.path() / L"nexus-update-cache.sqlite3";
                if (!nowUtc_.empty())
                {
                    options.nowUtc = [this]() { return nowUtc_; };
                }
                ModUpdateService service(
                    logger_,
                    pathSettings_,
                    api_,
                    std::move(options));
                return service.check(ModUpdateCheckRequest{project_, mode});
            }

            TempDirectory temp_;
            ScopedEnvironmentVariable appData_;
            std::filesystem::path project_;
            Logger logger_;
            BuildPathSettingsService pathSettings_;
            FakeNexusUpdateApi api_;
            std::wstring nowUtc_;
        };
    }

    TEST(ModUpdateServiceTests, CheckUsesTheInstalledNexusFileVersionInsteadOfTheModPageVersion)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());
        const std::filesystem::path project = temp.path() / L"CS Particle Patch project";

        Logger logger;
        BuildPathSettingsService pathSettings(logger);
        const std::filesystem::path modPath = pathSettings.modsDirectory(project) / L"CS Particle Patch";
        writeTextFile(modPath / L"SKSE" / L"Plugins" / L"CSParticlePatch.dll", "plugin");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMod(
            project,
            modPath,
            L"CS Particle Patch",
            L"1.5.2",
            ModSourceRecord{
                L"nexus",
                L"skyrimspecialedition",
                L"67856",
                L"100",
                L"nxm://skyrimspecialedition/mods/67856/files/100"});

        FakeNexusUpdateApi api;
        api.filesResponse.files.push_back(NexusFileMetadata{
            L"100",
            L"1.5.2",
            L"1",
            true,
            NexusFileAvailability::Active,
            1'700'000'000});

        ModUpdateService service(
            logger,
            pathSettings,
            api,
            ModUpdateServiceOptions{temp.path() / L"nexus-update-cache.sqlite3"});

        const ModUpdateCheckResult result = service.check(ModUpdateCheckRequest{
            project,
            ModUpdateCheckMode::Manual});

        ASSERT_EQ(result.state, ModUpdateCheckState::Completed);
        EXPECT_EQ(result.counters.apiRequests, 1U);
        EXPECT_EQ(result.counters.checked, 1U);
        EXPECT_EQ(result.counters.updates, 0U);
        ASSERT_EQ(api.fileRequests.size(), 1U);
        EXPECT_EQ(api.fileRequests.front().first, L"skyrimspecialedition");
        EXPECT_EQ(api.fileRequests.front().second, L"67856");
        ASSERT_EQ(result.mods.size(), 1U);
        EXPECT_EQ(result.mods.front().latestVersion, L"1.5.2");
        EXPECT_EQ(result.mods.front().latestFileId, L"100");
        EXPECT_FALSE(result.mods.front().hasUpdate);
#endif
    }

    TEST_F(ModUpdateServiceFixture, CheckFollowsTheCompleteFileUpdateChain)
    {
        registerNexusMod(L"Chain Mod", L"1.0", L"42", L"100");
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"1", true, NexusFileAvailability::Old, 100},
            NexusFileMetadata{L"200", L"1.5", L"1", true, NexusFileAvailability::Old, 200},
            NexusFileMetadata{L"300", L"2.0", L"1", true, NexusFileAvailability::Active, 300}
        };
        api_.filesResponse.fileUpdates = {
            NexusFileUpdateLink{L"100", L"200", 200},
            NexusFileUpdateLink{L"200", L"300", 300}
        };

        const ModUpdateCheckResult result = check();

        ASSERT_EQ(result.state, ModUpdateCheckState::Completed);
        ASSERT_EQ(result.mods.size(), 1U);
        EXPECT_EQ(result.mods.front().latestVersion, L"2.0");
        EXPECT_EQ(result.mods.front().latestFileId, L"300");
        EXPECT_TRUE(result.mods.front().hasUpdate);
        EXPECT_EQ(result.counters.checked, 1U);
        EXPECT_EQ(result.counters.updates, 1U);
    }

    TEST_F(ModUpdateServiceFixture, SweepDeadlineStopsIssuingRequestsAndReturnsPartialNetworkError)
    {
        registerNexusMod(L"First Deadline Mod", L"1.0", L"501", L"100");
        registerNexusMod(L"Second Deadline Mod", L"1.0", L"502", L"100");
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"1", true, NexusFileAvailability::Active, 100}
        };
        api_.fileDelay = std::chrono::milliseconds(120);

        ModUpdateServiceOptions options;
        options.cachePath = temp_.path() / L"deadline-cache.sqlite3";
        options.maxConcurrentMetadataRequests = 1;
        options.overallTimeout = std::chrono::milliseconds(250);
        options.requestTimeoutBudget = std::chrono::milliseconds(150);
        ModUpdateService service(logger_, pathSettings_, api_, std::move(options));
        const ModUpdateCheckResult result = service.check(
            ModUpdateCheckRequest{project_, ModUpdateCheckMode::Manual});

        EXPECT_EQ(result.state, ModUpdateCheckState::Partial);
        EXPECT_EQ(result.reason, ModUpdateCheckReason::NetworkError);
        EXPECT_EQ(result.counters.apiRequests, 1U);
        EXPECT_EQ(api_.fileRequests.size(), 1U);
        EXPECT_FALSE(result.nextEligibleAt.empty());
    }

    TEST_F(ModUpdateServiceFixture, TdmLikeLineagePromotes226To227)
    {
        registerNexusMod(L"True Directional Movement", L"2.2.6", L"51614", L"745065");
        api_.filesResponse.files = {
            NexusFileMetadata{L"745065", L"2.2.6", L"1", true, NexusFileAvailability::Old, 100},
            NexusFileMetadata{L"766239", L"2.2.7", L"1", true, NexusFileAvailability::Active, 200}
        };
        api_.filesResponse.fileUpdates = {
            NexusFileUpdateLink{L"745065", L"766239", 200}
        };

        const ModUpdateCheckResult result = check();

        ASSERT_EQ(result.state, ModUpdateCheckState::Completed);
        ASSERT_EQ(result.mods.size(), 1U);
        EXPECT_EQ(result.mods.front().latestVersion, L"2.2.7");
        EXPECT_EQ(result.mods.front().latestFileId, L"766239");
        EXPECT_TRUE(result.mods.front().hasUpdate);
    }

    TEST_F(ModUpdateServiceFixture, DifferentFileIdsAreAnUpdateWhenVersionStringsMatch)
    {
        registerNexusMod(L"Opaque Version Mod", L"release", L"43", L"100");
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"release", L"1", true, NexusFileAvailability::Old, 100},
            NexusFileMetadata{L"200", L"release", L"1", true, NexusFileAvailability::Active, 200}
        };
        api_.filesResponse.fileUpdates = {
            NexusFileUpdateLink{L"100", L"200", 200}
        };

        const ModUpdateCheckResult result = check();

        ASSERT_EQ(result.mods.size(), 1U);
        EXPECT_EQ(result.mods.front().latestVersion, L"release");
        EXPECT_EQ(result.mods.front().latestFileId, L"200");
        EXPECT_TRUE(result.mods.front().hasUpdate);
        EXPECT_EQ(result.counters.updates, 1U);
    }

    TEST_F(ModUpdateServiceFixture, DeletedAndArchivedChainTerminalsAreNotSelected)
    {
        registerNexusMod(L"Deleted Terminal Mod", L"1.0", L"44", L"100");
        registerNexusMod(L"Archived Terminal Mod", L"1.1", L"44", L"110");
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"1", true, NexusFileAvailability::Active, 100},
            NexusFileMetadata{L"200", L"2.0", L"1", true, NexusFileAvailability::Deleted, 200},
            NexusFileMetadata{L"110", L"1.1", L"2", false, NexusFileAvailability::Active, 110},
            NexusFileMetadata{L"210", L"2.1", L"2", false, NexusFileAvailability::Archived, 210}
        };
        api_.filesResponse.fileUpdates = {
            NexusFileUpdateLink{L"100", L"200", 200},
            NexusFileUpdateLink{L"110", L"210", 210}
        };

        const ModUpdateCheckResult result = check();

        ASSERT_EQ(result.state, ModUpdateCheckState::Completed);
        ASSERT_EQ(result.mods.size(), 2U);
        EXPECT_EQ(result.mods[0].latestFileId, L"110");
        EXPECT_EQ(result.mods[0].latestVersion, L"1.1");
        EXPECT_FALSE(result.mods[0].hasUpdate);
        EXPECT_EQ(result.mods[1].latestFileId, L"100");
        EXPECT_EQ(result.mods[1].latestVersion, L"1.0");
        EXPECT_FALSE(result.mods[1].hasUpdate);
        EXPECT_EQ(result.counters.apiRequests, 1U);
        EXPECT_EQ(result.counters.checked, 2U);
        EXPECT_EQ(result.counters.updates, 0U);
    }

    TEST_F(ModUpdateServiceFixture, AUniqueNewerActiveFileInTheSameCategoryIsASafeFallback)
    {
        registerNexusMod(L"Heuristic Mod", L"1.0", L"45", L"100");
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"4", true, NexusFileAvailability::Active, 100},
            NexusFileMetadata{L"200", L"2.0", L"4", true, NexusFileAvailability::Active, 200},
            NexusFileMetadata{L"300", L"3.0", L"5", true, NexusFileAvailability::Active, 300}
        };

        const ModUpdateCheckResult result = check();

        ASSERT_EQ(result.state, ModUpdateCheckState::Completed);
        ASSERT_EQ(result.mods.size(), 1U);
        EXPECT_EQ(result.mods.front().latestFileId, L"200");
        EXPECT_EQ(result.mods.front().latestVersion, L"2.0");
        EXPECT_TRUE(result.mods.front().hasUpdate);
        EXPECT_EQ(result.counters.updates, 1U);
    }

    TEST_F(ModUpdateServiceFixture, ABranchedUpdateChainPreservesThePreviousLatestValue)
    {
        registerNexusMod(
            L"Branched Mod",
            L"1.0",
            L"46",
            L"100",
            ModSourceRecord{
                L"nexus",
                L"skyrimspecialedition",
                L"46",
                L"100",
                L"nxm://skyrimspecialedition/mods/46/files/100",
                L"2026-07-15T10:00:00Z",
                L"1.5",
                L"150",
                L"completed",
                L"2026-07-15T10:00:00Z"});
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"1", true, NexusFileAvailability::Old, 100},
            NexusFileMetadata{L"200", L"2.0-a", L"1", true, NexusFileAvailability::Active, 200},
            NexusFileMetadata{L"300", L"2.0-b", L"1", true, NexusFileAvailability::Active, 300}
        };
        api_.filesResponse.fileUpdates = {
            NexusFileUpdateLink{L"100", L"200", 200},
            NexusFileUpdateLink{L"100", L"300", 300}
        };

        const ModUpdateCheckResult result = check();

        ASSERT_EQ(result.state, ModUpdateCheckState::Partial);
        EXPECT_EQ(result.counters.ambiguous, 1U);
        EXPECT_EQ(result.counters.checked, 0U);
        ASSERT_EQ(result.mods.size(), 1U);
        EXPECT_EQ(result.mods.front().latestVersion, L"1.5");
        EXPECT_EQ(result.mods.front().latestFileId, L"150");
        EXPECT_TRUE(result.mods.front().hasUpdate);
    }

    TEST_F(ModUpdateServiceFixture, MultipleInstalledFilesForOneModUseOneMetadataRequestIncludingDisabledMods)
    {
        registerNexusMod(L"Main File", L"1.0", L"47", L"100");
        registerNexusMod(L"Optional File", L"1.1", L"47", L"110");
        InstanceMetadataStore::setInstalledModEnabled(
            project_,
            pathSettings_.modsDirectory(project_) / L"Optional File",
            false);
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"1", true, NexusFileAvailability::Old, 100},
            NexusFileMetadata{L"200", L"2.0", L"1", true, NexusFileAvailability::Active, 200},
            NexusFileMetadata{L"110", L"1.1", L"2", false, NexusFileAvailability::Old, 110},
            NexusFileMetadata{L"210", L"2.1", L"2", false, NexusFileAvailability::Active, 210}
        };
        api_.filesResponse.fileUpdates = {
            NexusFileUpdateLink{L"100", L"200", 200},
            NexusFileUpdateLink{L"110", L"210", 210}
        };

        const ModUpdateCheckResult result = check();

        ASSERT_EQ(result.state, ModUpdateCheckState::Completed);
        EXPECT_EQ(result.counters.apiRequests, 1U);
        EXPECT_EQ(result.counters.checked, 2U);
        EXPECT_EQ(result.counters.updates, 2U);
        ASSERT_EQ(api_.fileRequests.size(), 1U);
        ASSERT_EQ(result.mods.size(), 2U);
        EXPECT_TRUE(result.mods[0].hasUpdate);
        EXPECT_TRUE(result.mods[1].hasUpdate);
    }

    TEST_F(ModUpdateServiceFixture, NonNexusAndIncompleteNexusIdentitiesAreNeverGuessed)
    {
        registerNexusMod(
            L"Incomplete Nexus Mod",
            L"1.0",
            L"48",
            L"",
            ModSourceRecord{
                L"nexus",
                L"skyrimspecialedition",
                L"48",
                L"",
                L"https://www.nexusmods.com/skyrimspecialedition/mods/48"});
        registerNexusMod(
            L"Local Mod",
            L"local",
            L"",
            L"",
            ModSourceRecord{L"local"});
        registerNexusMod(
            L"ModdingFlow Mod",
            L"1.0",
            L"mf-1",
            L"mf-file-1",
            ModSourceRecord{
                L"moddingflow",
                L"skyrimspecialedition",
                L"mf-1",
                L"mf-file-1",
                L"https://moddingflow.example/mods/mf-1"});

        const ModUpdateCheckResult result = check();

        EXPECT_EQ(result.state, ModUpdateCheckState::Skipped);
        EXPECT_EQ(result.reason, ModUpdateCheckReason::NoEligibleMods);
        EXPECT_EQ(result.counters.apiRequests, 0U);
        EXPECT_TRUE(api_.fileRequests.empty());
        ASSERT_EQ(result.mods.size(), 3U);
        for (const ModUpdateInstalledMod& mod : result.mods)
        {
            EXPECT_FALSE(mod.hasUpdate);
        }
    }

    TEST_F(ModUpdateServiceFixture, PrimaryFlagMakesTheSafeHeuristicUnambiguous)
    {
        registerNexusMod(L"Primary Heuristic Mod", L"1.0", L"49", L"100");
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"1", true, NexusFileAvailability::Active, 100},
            NexusFileMetadata{L"200", L"2.0", L"1", true, NexusFileAvailability::Active, 200},
            NexusFileMetadata{L"300", L"2.0 optional", L"1", false, NexusFileAvailability::Active, 300}
        };

        const ModUpdateCheckResult result = check();

        ASSERT_EQ(result.state, ModUpdateCheckState::Completed);
        ASSERT_EQ(result.mods.size(), 1U);
        EXPECT_EQ(result.mods.front().latestFileId, L"200");
        EXPECT_EQ(result.mods.front().latestVersion, L"2.0");
        EXPECT_TRUE(result.mods.front().hasUpdate);
    }

    TEST_F(ModUpdateServiceFixture, AutomaticCheckUsesTheDailyTtlWithoutANetworkRequest)
    {
        nowUtc_ = L"2026-07-16T10:00:00Z";
        registerNexusMod(L"Daily Mod", L"1.0", L"50", L"100");
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"1", true, NexusFileAvailability::Active, 100}
        };

        const ModUpdateCheckResult first = check(ModUpdateCheckMode::Automatic);
        ASSERT_EQ(first.state, ModUpdateCheckState::Completed);
        ASSERT_EQ(api_.fileRequests.size(), 1U);

        api_.fileRequests.clear();
        nowUtc_ = L"2026-07-17T09:59:59Z";
        const ModUpdateCheckResult second = check(ModUpdateCheckMode::Automatic);

        EXPECT_EQ(second.state, ModUpdateCheckState::Skipped);
        EXPECT_EQ(second.reason, ModUpdateCheckReason::DailyTtl);
        EXPECT_EQ(second.counters.apiRequests, 0U);
        EXPECT_TRUE(api_.fileRequests.empty());
        EXPECT_EQ(second.nextEligibleAt, L"2026-07-17T10:00:00Z");
    }

    TEST_F(ModUpdateServiceFixture, TheSharedFileCacheIsReusedAcrossProjects)
    {
        nowUtc_ = L"2026-07-16T10:00:00Z";
        registerNexusMod(L"Shared Cache Mod", L"1.0", L"51", L"100");
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"1", true, NexusFileAvailability::Active, 100}
        };
        const ModUpdateCheckResult first = check(ModUpdateCheckMode::Automatic);
        ASSERT_EQ(first.state, ModUpdateCheckState::Completed);
        ASSERT_EQ(api_.fileRequests.size(), 1U);

        const std::filesystem::path secondProject = temp_.path() / L"Second Nexus project";
        InstanceMetadataStore::ensureInstance(secondProject, L"skyrimse");
        const std::filesystem::path secondModPath =
            pathSettings_.modsDirectory(secondProject) / L"Shared Cache Mod";
        writeTextFile(secondModPath / L"Data" / L"content.bin", "content");
        InstanceMetadataStore::registerInstalledMod(
            secondProject,
            secondModPath,
            L"Shared Cache Mod",
            L"1.0",
            ModSourceRecord{
                L"nexus",
                L"skyrimspecialedition",
                L"51",
                L"100",
                L"nxm://skyrimspecialedition/mods/51/files/100"});

        api_.fileRequests.clear();
        ModUpdateServiceOptions options;
        options.cachePath = temp_.path() / L"nexus-update-cache.sqlite3";
        options.nowUtc = [this]() { return nowUtc_; };
        ModUpdateService secondService(logger_, pathSettings_, api_, std::move(options));
        const ModUpdateCheckResult second = secondService.check(ModUpdateCheckRequest{
            secondProject,
            ModUpdateCheckMode::Automatic});

        EXPECT_EQ(second.state, ModUpdateCheckState::Completed);
        EXPECT_EQ(second.counters.apiRequests, 0U);
        EXPECT_EQ(second.counters.cacheHits, 1U);
        EXPECT_TRUE(api_.fileRequests.empty());
        ASSERT_EQ(second.mods.size(), 1U);
        EXPECT_EQ(second.mods.front().latestFileId, L"100");
    }

    TEST_F(ModUpdateServiceFixture, ManualChecksBypassDailyTtlButReuseOnlyTheShortSharedCache)
    {
        nowUtc_ = L"2026-07-16T10:00:00Z";
        registerNexusMod(L"Manual Cache Mod", L"1.0", L"54", L"100");
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"1", true, NexusFileAvailability::Active, 100}
        };
        ASSERT_EQ(check(ModUpdateCheckMode::Automatic).state, ModUpdateCheckState::Completed);
        ASSERT_EQ(api_.fileRequests.size(), 1U);

        api_.fileRequests.clear();
        nowUtc_ = L"2026-07-16T10:02:00Z";
        const ModUpdateCheckResult cachedManual = check(ModUpdateCheckMode::Manual);
        EXPECT_EQ(cachedManual.state, ModUpdateCheckState::Completed);
        EXPECT_EQ(cachedManual.reason, ModUpdateCheckReason::None);
        EXPECT_EQ(cachedManual.counters.apiRequests, 0U);
        EXPECT_EQ(cachedManual.counters.cacheHits, 1U);
        EXPECT_TRUE(api_.fileRequests.empty());

        nowUtc_ = L"2026-07-16T10:06:00Z";
        const ModUpdateCheckResult refreshedManual = check(ModUpdateCheckMode::Manual);
        EXPECT_EQ(refreshedManual.state, ModUpdateCheckState::Completed);
        EXPECT_EQ(refreshedManual.counters.apiRequests, 1U);
        EXPECT_EQ(api_.fileRequests.size(), 1U);
    }

    TEST_F(ModUpdateServiceFixture, DailyFastPathFetchesFilesOnlyForRecentlyChangedModIds)
    {
        nowUtc_ = L"2026-07-16T10:00:00Z";
        registerNexusMod(L"Changed Mod", L"1.0", L"52", L"100");
        registerNexusMod(L"Unchanged Mod", L"1.0", L"53", L"110");
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"1", true, NexusFileAvailability::Active, 100},
            NexusFileMetadata{L"110", L"1.0", L"2", true, NexusFileAvailability::Active, 110}
        };
        const ModUpdateCheckResult baseline = check(ModUpdateCheckMode::Automatic);
        ASSERT_EQ(baseline.state, ModUpdateCheckState::Completed);
        ASSERT_EQ(api_.fileRequests.size(), 2U);

        api_.fileRequests.clear();
        api_.recentRequests.clear();
        nowUtc_ = L"2026-07-17T10:00:01Z";
        api_.recentResponse.updates = {
            NexusRecentUpdate{L"52", 1'784'282'401, 1'784'282'401}
        };
        api_.filesResponse.files.push_back(
            NexusFileMetadata{L"200", L"2.0", L"1", true, NexusFileAvailability::Active, 200});
        api_.filesResponse.fileUpdates = {
            NexusFileUpdateLink{L"100", L"200", 200}
        };

        const ModUpdateCheckResult daily = check(ModUpdateCheckMode::Automatic);

        ASSERT_EQ(daily.state, ModUpdateCheckState::Completed);
        ASSERT_EQ(api_.recentRequests.size(), 1U);
        EXPECT_EQ(api_.recentRequests.front().first, L"skyrimspecialedition");
        EXPECT_EQ(api_.recentRequests.front().second, L"1w");
        ASSERT_EQ(api_.fileRequests.size(), 1U);
        EXPECT_EQ(api_.fileRequests.front().second, L"52");
        EXPECT_EQ(daily.counters.apiRequests, 2U);
        ASSERT_EQ(daily.mods.size(), 2U);
        EXPECT_EQ(daily.mods[0].latestFileId, L"200");
        EXPECT_EQ(daily.mods[1].latestFileId, L"110");
    }

    TEST_F(ModUpdateServiceFixture, QuotaReserveStopsIssuingNewMetadataRequests)
    {
        nowUtc_ = L"2026-07-16T10:00:00Z";
        registerNexusMod(L"First Quota Mod", L"1.0", L"60", L"100");
        registerNexusMod(L"Second Quota Mod", L"1.0", L"61", L"110");
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"1", true, NexusFileAvailability::Active, 100}
        };
        api_.filesResponse.quota = NexusQuotaSnapshot{
            1'000,
            100,
            L"2026-07-16T11:00:00Z",
            20'000,
            19'000,
            L"2026-07-17T00:00:00Z",
            L"2026-07-16T10:00:00Z"};

        const ModUpdateCheckResult result = check();

        EXPECT_EQ(result.state, ModUpdateCheckState::Partial);
        EXPECT_EQ(result.reason, ModUpdateCheckReason::QuotaReserve);
        EXPECT_EQ(result.nextEligibleAt, L"2026-07-16T11:00:00Z");
        EXPECT_EQ(result.counters.apiRequests, 1U);
        EXPECT_EQ(result.counters.checked, 1U);
        EXPECT_EQ(api_.fileRequests.size(), 1U);
        ASSERT_EQ(result.mods.size(), 2U);
        const auto second = std::find_if(
            result.mods.begin(),
            result.mods.end(),
            [](const ModUpdateInstalledMod& mod)
            {
                return mod.folderName == L"Second Quota Mod";
            });
        ASSERT_NE(second, result.mods.end());
        EXPECT_EQ(second->latestVersion, L"1.0");
        EXPECT_EQ(second->latestFileId, L"110");
        EXPECT_FALSE(second->hasUpdate);
    }

    TEST_F(ModUpdateServiceFixture, APartialBaselineResumesFromTheSharedCacheAfterQuotaReset)
    {
        nowUtc_ = L"2026-07-16T10:00:00Z";
        registerNexusMod(L"Cached Baseline Mod", L"1.0", L"80", L"180");
        registerNexusMod(L"Pending Baseline Mod", L"1.0", L"81", L"181");

        NexusModFilesResponse firstResponse;
        firstResponse.files = {
            NexusFileMetadata{L"180", L"1.0", L"1", true, NexusFileAvailability::Active, 100}
        };
        firstResponse.quota = NexusQuotaSnapshot{
            1'000,
            100,
            L"2026-07-16T11:00:00Z",
            20'000,
            19'000,
            L"2026-07-17T00:00:00Z",
            nowUtc_};
        api_.filesResponsesByModId[L"80"] = firstResponse;

        NexusModFilesResponse secondResponse;
        secondResponse.files = {
            NexusFileMetadata{L"181", L"1.0", L"1", true, NexusFileAvailability::Active, 100}
        };
        secondResponse.quota = NexusQuotaSnapshot{
            1'000,
            900,
            L"2026-07-16T12:00:00Z",
            20'000,
            19'000,
            L"2026-07-17T00:00:00Z",
            L"2026-07-16T11:01:00Z"};
        api_.filesResponsesByModId[L"81"] = secondResponse;

        const ModUpdateCheckResult partial = check(ModUpdateCheckMode::Automatic);
        ASSERT_EQ(partial.state, ModUpdateCheckState::Partial);
        EXPECT_EQ(partial.reason, ModUpdateCheckReason::QuotaReserve);
        ASSERT_EQ(api_.fileRequests.size(), 1U);
        EXPECT_EQ(api_.fileRequests.front().second, L"80");

        api_.fileRequests.clear();
        nowUtc_ = L"2026-07-16T11:01:00Z";
        const ModUpdateCheckResult resumed = check(ModUpdateCheckMode::Automatic);

        EXPECT_EQ(resumed.state, ModUpdateCheckState::Completed);
        EXPECT_EQ(resumed.counters.cacheHits, 1U);
        EXPECT_EQ(resumed.counters.apiRequests, 1U);
        EXPECT_EQ(resumed.counters.checked, 2U);
        ASSERT_EQ(api_.fileRequests.size(), 1U);
        EXPECT_EQ(api_.fileRequests.front().second, L"81");
    }

    TEST_F(ModUpdateServiceFixture, MetadataRequestsRunInParallelButNeverExceedFour)
    {
        nowUtc_ = L"2026-07-16T10:00:00Z";
        api_.fileDelay = std::chrono::milliseconds(40);
        for (int index = 0; index < 9; ++index)
        {
            const std::wstring modId = std::to_wstring(70 + index);
            const std::wstring fileId = std::to_wstring(170 + index);
            registerNexusMod(
                L"Parallel Mod " + std::to_wstring(index),
                L"1.0",
                modId,
                fileId);
            NexusModFilesResponse response;
            response.files.push_back(NexusFileMetadata{
                fileId,
                L"1.0",
                L"1",
                true,
                NexusFileAvailability::Active,
                100 + index});
            response.quota = NexusQuotaSnapshot{
                1'000,
                900,
                L"2026-07-16T11:00:00Z",
                20'000,
                19'000,
                L"2026-07-17T00:00:00Z",
                nowUtc_};
            api_.filesResponsesByModId.emplace(modId, std::move(response));
        }

        ModUpdateServiceOptions options;
        options.cachePath = temp_.path() / L"parallel-nexus-update-cache.sqlite3";
        options.nowUtc = [this]() { return nowUtc_; };
        options.maxConcurrentMetadataRequests = 8;
        ModUpdateService service(logger_, pathSettings_, api_, std::move(options));

        const ModUpdateCheckResult result = service.check(ModUpdateCheckRequest{
            project_,
            ModUpdateCheckMode::Manual});

        EXPECT_EQ(result.state, ModUpdateCheckState::Completed);
        EXPECT_EQ(result.counters.apiRequests, 9U);
        EXPECT_EQ(result.counters.checked, 9U);
        EXPECT_EQ(api_.fileRequests.size(), 9U);
        EXPECT_GT(api_.maxActiveFileRequests.load(), 1U);
        EXPECT_LE(api_.maxActiveFileRequests.load(), 4U);
    }

    TEST_F(ModUpdateServiceFixture, RateLimitPersistsRetryAtAndBlocksAnotherRequest)
    {
        nowUtc_ = L"2026-07-16T10:00:00Z";
        registerNexusMod(L"Rate Limited Mod", L"1.0", L"62", L"100");
        api_.fileErrorKind = NexusUpdateApiErrorKind::RateLimited;
        api_.fileErrorRetryAt = L"2026-07-16T10:30:00Z";
        api_.fileErrorQuota = NexusQuotaSnapshot{
            1'000,
            0,
            L"2026-07-16T10:30:00Z",
            20'000,
            19'000,
            L"2026-07-17T00:00:00Z",
            nowUtc_};

        const ModUpdateCheckResult first = check();

        ASSERT_EQ(first.state, ModUpdateCheckState::Partial);
        EXPECT_EQ(first.reason, ModUpdateCheckReason::RateLimited);
        EXPECT_EQ(first.nextEligibleAt, L"2026-07-16T10:30:00Z");
        EXPECT_EQ(api_.fileRequests.size(), 1U);
        ASSERT_EQ(first.mods.size(), 1U);
        EXPECT_EQ(first.mods.front().latestFileId, L"100");

        api_.fileErrorKind.reset();
        nowUtc_ = L"2026-07-16T10:15:00Z";
        const ModUpdateCheckResult blocked = check();

        EXPECT_EQ(blocked.state, ModUpdateCheckState::Skipped);
        EXPECT_EQ(blocked.reason, ModUpdateCheckReason::RateLimited);
        EXPECT_EQ(blocked.nextEligibleAt, L"2026-07-16T10:30:00Z");
        EXPECT_EQ(api_.fileRequests.size(), 1U);
    }

    TEST_F(ModUpdateServiceFixture, NetworkFailuresBackOffBeforeRetrying)
    {
        nowUtc_ = L"2026-07-16T10:00:00Z";
        registerNexusMod(L"Offline Mod", L"1.0", L"63", L"100");
        api_.fileErrorKind = NexusUpdateApiErrorKind::Network;

        const ModUpdateCheckResult failed = check();

        ASSERT_EQ(failed.state, ModUpdateCheckState::Partial);
        EXPECT_EQ(failed.reason, ModUpdateCheckReason::NetworkError);
        EXPECT_EQ(failed.nextEligibleAt, L"2026-07-16T10:15:00Z");
        EXPECT_EQ(api_.fileRequests.size(), 1U);

        api_.fileErrorKind.reset();
        api_.filesResponse.files = {
            NexusFileMetadata{L"100", L"1.0", L"1", true, NexusFileAvailability::Active, 100}
        };
        nowUtc_ = L"2026-07-16T10:10:00Z";
        const ModUpdateCheckResult blocked = check();
        EXPECT_EQ(blocked.state, ModUpdateCheckState::Skipped);
        EXPECT_EQ(blocked.reason, ModUpdateCheckReason::OfflineBackoff);
        EXPECT_EQ(api_.fileRequests.size(), 1U);

        nowUtc_ = L"2026-07-16T10:16:00Z";
        const ModUpdateCheckResult recovered = check();
        EXPECT_EQ(recovered.state, ModUpdateCheckState::Completed);
        EXPECT_EQ(recovered.counters.checked, 1U);
        EXPECT_EQ(api_.fileRequests.size(), 2U);
    }

    TEST_F(ModUpdateServiceFixture, CancellationStopsBeforeIssuingMetadataRequests)
    {
        registerNexusMod(L"Cancelled Mod", L"1.0", L"64", L"100");
        ModUpdateServiceOptions options;
        options.cachePath = temp_.path() / L"cancelled-nexus-update-cache.sqlite3";
        options.nowUtc = []() { return L"2026-07-16T10:00:00Z"; };
        options.cancellationRequested = []() { return true; };
        ModUpdateService service(logger_, pathSettings_, api_, std::move(options));

        const ModUpdateCheckResult result = service.check(ModUpdateCheckRequest{
            project_,
            ModUpdateCheckMode::Manual});

        EXPECT_EQ(result.state, ModUpdateCheckState::Cancelled);
        EXPECT_EQ(result.reason, ModUpdateCheckReason::Cancelled);
        EXPECT_TRUE(api_.fileRequests.empty());
        ASSERT_EQ(result.mods.size(), 1U);
        EXPECT_EQ(result.mods.front().latestFileId, L"100");
    }
}
