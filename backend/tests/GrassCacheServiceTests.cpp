#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/ExecutableIconService.hpp"
#include "FluxoraCore/Services/ExecutableService.hpp"
#include "FluxoraCore/Services/GrassCacheService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModService.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Services/TemplateService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <functional>
#include <stdexcept>
#include <utility>

namespace fluxora::tests
{
    namespace
    {
        std::string jsonPath(const std::filesystem::path& path)
        {
            std::string text = path.string();
            std::string escaped;
            escaped.reserve(text.size());
            for (char character : text)
            {
                if (character == '\\')
                {
                    escaped += "\\\\";
                }
                else
                {
                    escaped.push_back(character);
                }
            }
            return escaped;
        }

        void writeExecutableStub(const std::filesystem::path& path)
        {
            writeTextFile(path, "MZ executable stub");
        }

        const InstalledModRecord* findInstalledMod(
            const std::vector<InstalledModRecord>& records,
            std::wstring_view folderName)
        {
            const auto match = std::find_if(
                records.begin(),
                records.end(),
                [folderName](const InstalledModRecord& record)
                {
                    return record.folderName == folderName;
                });
            return match == records.end() ? nullptr : &*match;
        }

        class FakeGrassCacheRunner final : public IGrassCacheProcessRunner
        {
        public:
            using LaunchHook = std::function<void(int)>;

            FakeGrassCacheRunner(
                std::filesystem::path gameDirectory,
                std::filesystem::path overwriteDirectory,
                int removeMarkerAfterLaunch,
                int writeOutputAfterLaunch = 1,
                LaunchHook launchHook = {})
                : gameDirectory_(std::move(gameDirectory)),
                  overwriteDirectory_(std::move(overwriteDirectory)),
                  removeMarkerAfterLaunch_(removeMarkerAfterLaunch),
                  writeOutputAfterLaunch_(writeOutputAfterLaunch),
                  launchHook_(std::move(launchHook))
            {
            }

            void launchAndWait(
                const GrassCacheLaunchSpec& spec,
                const std::function<bool()>& cancellationRequested) override
            {
                if (cancellationRequested && cancellationRequested())
                {
                    throw std::runtime_error("NGIO grass cache generation was canceled.");
                }
                ++launchCount;
                lastSpec = spec;
                EXPECT_EQ(spec.additionalArguments, L"-forcesteamloader");
                EXPECT_TRUE(std::filesystem::is_regular_file(gameDirectory_ / L"PrecacheGrass.txt"));
                if (launchHook_)
                {
                    launchHook_(launchCount);
                }
                if (cancellationRequested && cancellationRequested())
                {
                    throw std::runtime_error("NGIO grass cache generation was canceled.");
                }

                if (launchCount >= writeOutputAfterLaunch_)
                {
                    writeTextFile(overwriteDirectory_ / L"Grass" / L"Tamriel.cgid", "grass cache");
                    writeTextFile(overwriteDirectory_ / L"Grass" / L"Tamriel.fail", "failed cell");
                }
                if (launchCount >= removeMarkerAfterLaunch_)
                {
                    std::filesystem::remove(gameDirectory_ / L"PrecacheGrass.txt");
                }
            }

            int launchCount{0};
            GrassCacheLaunchSpec lastSpec;

        private:
            std::filesystem::path gameDirectory_;
            std::filesystem::path overwriteDirectory_;
            int removeMarkerAfterLaunch_{1};
            int writeOutputAfterLaunch_{1};
            LaunchHook launchHook_;
        };

        class GrassCacheServiceTestFixture : public testing::Test
        {
        protected:
            GrassCacheServiceTestFixture()
                : appData_(L"APPDATA", (temp_.path() / L"AppData").wstring()),
                  project_(temp_.path() / L"Skyrim Main"),
                  config_(project_ / L"build.json"),
                  game_(project_ / L"stock game"),
                  settings_(logger_),
                  pathSettings_(logger_),
                  templates_(logger_),
                  projects_(logger_, templates_),
                  mods_(logger_, settings_, pathSettings_),
                  profileOrder_(logger_, mods_, pathSettings_),
                  executableIcons_(logger_),
                  executables_(logger_, executableIcons_, pathSettings_)
            {
            }

            void SetUp() override
            {
#ifndef _WIN32
                GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
                writeExecutableStub(game_ / L"SkyrimSE.exe");
                writeExecutableStub(game_ / L"skse64_loader.exe");
                writeTextFile(game_ / L"Data" / L"Skyrim.esm", "master");
                writeTextFile(
                    config_,
                    "{"
                    "\"schemaVersion\":\"1\","
                    "\"name\":\"Skyrim Main\","
                    "\"templateId\":\"skyrimse\","
                    "\"gameName\":\"Skyrim Special Edition\","
                    "\"projectDirectory\":\"" + jsonPath(project_) + "\","
                    "\"gamePath\":\"stock game\","
                    "\"dataDirectory\":\"Data\","
                    "\"defaultProfile\":\"Default\","
                    "\"launchExecutables\":[{"
                    "\"id\":\"script-extender\","
                    "\"displayName\":\"SKSE64\","
                    "\"executablePath\":\"skse64_loader.exe\","
                    "\"arguments\":\"\","
                    "\"workingDirectory\":\"\""
                    "}]"
                    "}");

                const BuildPathSettings paths{
                    game_,
                    project_ / L"mods",
                    project_ / L"profiles",
                    project_ / L"downloads",
                    project_ / L"overwrite"
                };
                const BuildPathSettings savedPaths = pathSettings_.saveForConfig(config_, paths);
                (void)savedPaths;

                const std::filesystem::path ngioMod = paths.modsDirectory / L"No Grass In Objects";
                writeTextFile(
                    ngioMod / L"NetScriptFramework" / L"Plugins" / L"GrassControl.dll",
                    "dll");
                writeTextFile(
                    ngioMod / L"SKSE" / L"Plugins" / L"GrassControl.ini",
                    "Use-grass-cache = true");

                InstanceMetadataStore::ensureInstance(project_, L"skyrimse");
                InstanceMetadataStore::registerInstalledMods(
                    project_,
                    {InstalledModImportRecord{ngioMod, L"No Grass In Objects", {}, true, {}}});
                InstanceMetadataStore::replaceProfileOrderItems(
                    project_,
                    L"Default",
                    {ProfileOrderImportItemRecord{L"mod", L"No Grass In Objects", {}}});
#endif
            }

            TempDirectory temp_;
            Logger logger_;
            ScopedEnvironmentVariable appData_;
            std::filesystem::path project_;
            std::filesystem::path config_;
            std::filesystem::path game_;
            AppSettingsService settings_;
            BuildPathSettingsService pathSettings_;
            TemplateService templates_;
            ProjectService projects_;
            ModService mods_;
            ProfileOrderService profileOrder_;
            ExecutableIconService executableIcons_;
            ExecutableService executables_;
        };
    }

    TEST_F(GrassCacheServiceTestFixture, NgioGenerationMovesOverwriteGrassIntoGeneratedMod)
    {
        const BuildPathSettings paths = pathSettings_.loadForConfig(config_);
        FakeGrassCacheRunner runner(paths.gameDirectory, paths.overwriteDirectory, 1);
        GrassCacheService service(
            logger_,
            projects_,
            executables_,
            mods_,
            profileOrder_,
            pathSettings_,
            runner);

        const GrassCacheGenerationResult result =
            service.generateNgioGrassCache(config_, L"Default", GrassCacheGenerationOptions{3, 0});

        const std::wstring expectedModName = L"Skyrim Main \x00B7 Grass Cache";
        EXPECT_EQ(runner.launchCount, 1);
        EXPECT_EQ(runner.lastSpec.executableId, L"script-extender");
        EXPECT_EQ(runner.lastSpec.profileName, L"Default");
        EXPECT_EQ(result.outputModName, expectedModName);
        EXPECT_EQ(result.launchCount, 1);
        EXPECT_EQ(result.generatedFileCount, 2);
        EXPECT_EQ(result.failedFileCount, 1);

        const std::filesystem::path outputMod = paths.modsDirectory / expectedModName;
        EXPECT_TRUE(std::filesystem::is_regular_file(outputMod / L"Grass" / L"Tamriel.cgid"));
        EXPECT_TRUE(std::filesystem::is_regular_file(outputMod / L"Grass" / L"Tamriel.fail"));
        EXPECT_FALSE(std::filesystem::exists(paths.overwriteDirectory / L"Grass"));

        const std::vector<InstalledModRecord> records =
            InstanceMetadataStore::listInstalledMods(project_, paths.modsDirectory);
        const InstalledModRecord* record = findInstalledMod(records, expectedModName);
        ASSERT_NE(record, nullptr);
        EXPECT_EQ(record->displayName, expectedModName);
        EXPECT_EQ(record->state, L"installed");
        EXPECT_EQ(record->source.provider, L"generated-ngio");

        const std::vector<ProfileModOrderItem> order =
            profileOrder_.listCachedModOrder(project_, L"Default");
        const auto orderItem = std::find_if(
            order.begin(),
            order.end(),
            [&expectedModName](const ProfileModOrderItem& item)
            {
                return item.kind == L"mod" && item.name == expectedModName;
            });
        ASSERT_NE(orderItem, order.end());
        EXPECT_EQ(orderItem->id, outputMod);
        EXPECT_TRUE(orderItem->isEnabled);
    }

    TEST_F(GrassCacheServiceTestFixture, NgioGenerationRestartsWhilePrecacheMarkerStillExistsAndOutputIsMissing)
    {
        const BuildPathSettings paths = pathSettings_.loadForConfig(config_);
        FakeGrassCacheRunner runner(paths.gameDirectory, paths.overwriteDirectory, 2, 2);
        GrassCacheService service(
            logger_,
            projects_,
            executables_,
            mods_,
            profileOrder_,
            pathSettings_,
            runner);

        const GrassCacheGenerationResult result =
            service.generateNgioGrassCache(config_, L"Default", GrassCacheGenerationOptions{3, 0});

        EXPECT_EQ(runner.launchCount, 2);
        EXPECT_EQ(result.launchCount, 2);
        EXPECT_FALSE(std::filesystem::exists(paths.gameDirectory / L"PrecacheGrass.txt"));
    }

    TEST_F(GrassCacheServiceTestFixture, NgioGenerationClearsStaleOverwriteGrassBeforeLaunching)
    {
        const BuildPathSettings paths = pathSettings_.loadForConfig(config_);
        const std::filesystem::path staleGrass = paths.overwriteDirectory / L"Grass";
        writeTextFile(staleGrass / L"OldCache.cgid", "stale cache");

        FakeGrassCacheRunner runner(
            paths.gameDirectory,
            paths.overwriteDirectory,
            2,
            2,
            [&](int)
            {
                EXPECT_FALSE(std::filesystem::exists(staleGrass / L"OldCache.cgid"));
            });
        GrassCacheService service(
            logger_,
            projects_,
            executables_,
            mods_,
            profileOrder_,
            pathSettings_,
            runner);

        const GrassCacheGenerationResult result =
            service.generateNgioGrassCache(config_, L"Default", GrassCacheGenerationOptions{3, 0});

        const std::filesystem::path outputMod = paths.modsDirectory / result.outputModName;
        EXPECT_EQ(runner.launchCount, 2);
        EXPECT_EQ(result.launchCount, 2);
        EXPECT_FALSE(std::filesystem::exists(outputMod / L"Grass" / L"OldCache.cgid"));
        EXPECT_TRUE(std::filesystem::is_regular_file(outputMod / L"Grass" / L"Tamriel.cgid"));
    }

    TEST_F(GrassCacheServiceTestFixture, NgioGenerationClearsPreviousGeneratedModGrassBeforeLaunching)
    {
        const BuildPathSettings paths = pathSettings_.loadForConfig(config_);
        const std::wstring expectedModName = L"Skyrim Main \x00B7 Grass Cache";
        const std::filesystem::path outputMod = paths.modsDirectory / expectedModName;
        const std::filesystem::path staleGeneratedGrass = outputMod / L"Grass";
        writeTextFile(staleGeneratedGrass / L"OldCache.cgid", "old generated cache");

        FakeGrassCacheRunner runner(
            paths.gameDirectory,
            paths.overwriteDirectory,
            1,
            1,
            [&](int)
            {
                EXPECT_FALSE(std::filesystem::exists(staleGeneratedGrass / L"OldCache.cgid"));
            });
        GrassCacheService service(
            logger_,
            projects_,
            executables_,
            mods_,
            profileOrder_,
            pathSettings_,
            runner);

        const GrassCacheGenerationResult result =
            service.generateNgioGrassCache(config_, L"Default", GrassCacheGenerationOptions{3, 0});

        EXPECT_EQ(runner.launchCount, 1);
        EXPECT_EQ(result.outputModName, expectedModName);
        EXPECT_FALSE(std::filesystem::exists(staleGeneratedGrass / L"OldCache.cgid"));
        EXPECT_TRUE(std::filesystem::is_regular_file(outputMod / L"Grass" / L"Tamriel.cgid"));
    }

    TEST_F(GrassCacheServiceTestFixture, NgioGenerationStopsWhenOutputExistsAndPrecacheMarkerRemains)
    {
        const BuildPathSettings paths = pathSettings_.loadForConfig(config_);
        FakeGrassCacheRunner runner(paths.gameDirectory, paths.overwriteDirectory, 99);
        GrassCacheService service(
            logger_,
            projects_,
            executables_,
            mods_,
            profileOrder_,
            pathSettings_,
            runner);

        const GrassCacheGenerationResult result =
            service.generateNgioGrassCache(config_, L"Default", GrassCacheGenerationOptions{3, 0});

        EXPECT_EQ(runner.launchCount, 1);
        EXPECT_EQ(result.launchCount, 1);
        EXPECT_FALSE(std::filesystem::exists(paths.gameDirectory / L"PrecacheGrass.txt"));
    }

    TEST_F(GrassCacheServiceTestFixture, NgioGenerationRecreatesMissingPrecacheMarkerWhenOutputIsMissing)
    {
        const BuildPathSettings paths = pathSettings_.loadForConfig(config_);
        FakeGrassCacheRunner runner(paths.gameDirectory, paths.overwriteDirectory, 1, 2);
        GrassCacheService service(
            logger_,
            projects_,
            executables_,
            mods_,
            profileOrder_,
            pathSettings_,
            runner);

        const GrassCacheGenerationResult result =
            service.generateNgioGrassCache(config_, L"Default", GrassCacheGenerationOptions{3, 0});

        EXPECT_EQ(runner.launchCount, 2);
        EXPECT_EQ(result.launchCount, 2);
        EXPECT_FALSE(std::filesystem::exists(paths.gameDirectory / L"PrecacheGrass.txt"));
    }

    TEST_F(GrassCacheServiceTestFixture, OrdinaryLaunchCleanupRemovesVfsVisiblePrecacheMarkers)
    {
        const BuildPathSettings paths = pathSettings_.loadForConfig(config_);
        writeTextFile(paths.gameDirectory / L"PrecacheGrass.txt", "stock marker");
        writeTextFile(paths.overwriteDirectory / L"root" / L"PrecacheGrass.txt", "vfs marker");
        writeTextFile(
            project_ / L".flow" / L"root-launch" / L"SKSE64" / L"PrecacheGrass.txt",
            "cache marker");
        const std::filesystem::path nestedUnrelatedMarker =
            project_ / L".flow" / L"root-launch" / L"SKSE64" /
            L"copied-cache" / L"deep" / L"PrecacheGrass.txt";
        writeTextFile(nestedUnrelatedMarker, "not a game-root marker");

        FakeGrassCacheRunner runner(paths.gameDirectory, paths.overwriteDirectory, 1);
        GrassCacheService service(
            logger_,
            projects_,
            executables_,
            mods_,
            profileOrder_,
            pathSettings_,
            runner);

        EXPECT_EQ(service.clearStaleNgioPrecacheMarkersForLaunch(config_), 3);
        EXPECT_FALSE(std::filesystem::exists(paths.gameDirectory / L"PrecacheGrass.txt"));
        EXPECT_FALSE(std::filesystem::exists(paths.overwriteDirectory / L"root" / L"PrecacheGrass.txt"));
        EXPECT_FALSE(std::filesystem::exists(
            project_ / L".flow" / L"root-launch" / L"SKSE64" / L"PrecacheGrass.txt"));
        EXPECT_TRUE(std::filesystem::exists(nestedUnrelatedMarker));
    }

#ifdef _WIN32
    TEST_F(GrassCacheServiceTestFixture, OrdinaryLaunchCleanupDoesNotFollowRootLaunchJunction)
    {
        const BuildPathSettings paths = pathSettings_.loadForConfig(config_);
        const std::filesystem::path rootLaunchDirectory =
            project_ / L".flow" / L"root-launch";
        const std::filesystem::path safeMarker =
            rootLaunchDirectory / L"SKSE64" / L"PrecacheGrass.txt";
        const std::filesystem::path outsideDirectory = temp_.path() / L"outside-root-launch";
        const std::filesystem::path outsideMarker = outsideDirectory / L"PrecacheGrass.txt";
        const std::filesystem::path junction = rootLaunchDirectory / L"unsafe-overlay";

        writeTextFile(safeMarker, "safe cache marker");
        writeTextFile(outsideMarker, "outside sentinel");

        std::error_code junctionError;
        if (!createDirectoryJunction(outsideDirectory, junction, junctionError))
        {
            GTEST_SKIP() << "Directory junction creation is not available: " << junctionError.message();
        }

        FakeGrassCacheRunner runner(paths.gameDirectory, paths.overwriteDirectory, 1);
        GrassCacheService service(
            logger_,
            projects_,
            executables_,
            mods_,
            profileOrder_,
            pathSettings_,
            runner);

        EXPECT_EQ(service.clearStaleNgioPrecacheMarkersForLaunch(config_), 1);
        EXPECT_FALSE(std::filesystem::exists(safeMarker));
        EXPECT_EQ(readTextFile(outsideMarker), "outside sentinel");

        std::error_code cleanupError;
        std::filesystem::remove(junction, cleanupError);
    }

    TEST_F(GrassCacheServiceTestFixture, OrdinaryLaunchCleanupDoesNotFollowRootLaunchDirectoryJunction)
    {
        const BuildPathSettings paths = pathSettings_.loadForConfig(config_);
        const std::filesystem::path rootLaunchDirectory =
            project_ / L".flow" / L"root-launch";
        const std::filesystem::path outsideDirectory = temp_.path() / L"outside-root-launch-root";
        const std::filesystem::path outsideMarker =
            outsideDirectory / L"SKSE64" / L"PrecacheGrass.txt";
        const std::filesystem::path gameMarker =
            paths.gameDirectory / L"PrecacheGrass.txt";

        writeTextFile(outsideMarker, "outside root sentinel");
        writeTextFile(gameMarker, "stock marker");
        std::filesystem::create_directories(rootLaunchDirectory.parent_path());

        std::error_code junctionError;
        if (!createDirectoryJunction(outsideDirectory, rootLaunchDirectory, junctionError))
        {
            GTEST_SKIP() << "Directory junction creation is not available: " << junctionError.message();
        }

        FakeGrassCacheRunner runner(paths.gameDirectory, paths.overwriteDirectory, 1);
        GrassCacheService service(
            logger_,
            projects_,
            executables_,
            mods_,
            profileOrder_,
            pathSettings_,
            runner);

        EXPECT_EQ(service.clearStaleNgioPrecacheMarkersForLaunch(config_), 1);
        EXPECT_FALSE(std::filesystem::exists(gameMarker));
        EXPECT_EQ(readTextFile(outsideMarker), "outside root sentinel");

        std::error_code cleanupError;
        std::filesystem::remove(rootLaunchDirectory, cleanupError);
    }
#endif

    TEST_F(GrassCacheServiceTestFixture, NgioGenerationStopsWhenOperationCancelMarkerExists)
    {
        const BuildPathSettings paths = pathSettings_.loadForConfig(config_);
        const std::filesystem::path cancelDirectory = temp_.path() / L"operation-cancel";
        const std::filesystem::path cancelMarker = cancelDirectory / L"op_grass_cancel.cancel";
        ScopedEnvironmentVariable cancelDir(L"FLUXORA_OPERATION_CANCEL_DIR", cancelDirectory.wstring());
        Logger::setOperationId(L"op_grass_cancel");

        FakeGrassCacheRunner runner(
            paths.gameDirectory,
            paths.overwriteDirectory,
            99,
            99,
            [&](int)
            {
                writeTextFile(cancelMarker, "1\n");
            });
        GrassCacheService service(
            logger_,
            projects_,
            executables_,
            mods_,
            profileOrder_,
            pathSettings_,
            runner);

        EXPECT_THROW(
            (void)service.generateNgioGrassCache(config_, L"Default", GrassCacheGenerationOptions{3, 0}),
            std::runtime_error);
        Logger::clearOperationId();

        EXPECT_EQ(runner.launchCount, 1);
        EXPECT_FALSE(std::filesystem::exists(paths.gameDirectory / L"PrecacheGrass.txt"));
        EXPECT_FALSE(std::filesystem::exists(paths.overwriteDirectory / L"Grass"));
    }

    TEST_F(GrassCacheServiceTestFixture, NgioGenerationStopsWhenServiceShutsDownAfterLaunch)
    {
        const BuildPathSettings paths = pathSettings_.loadForConfig(config_);
        GrassCacheService* servicePtr = nullptr;
        FakeGrassCacheRunner runner(
            paths.gameDirectory,
            paths.overwriteDirectory,
            99,
            99,
            [&](int)
            {
                ASSERT_NE(servicePtr, nullptr);
                servicePtr->shutdown();
            });
        GrassCacheService service(
            logger_,
            projects_,
            executables_,
            mods_,
            profileOrder_,
            pathSettings_,
            runner);
        servicePtr = &service;

        EXPECT_THROW(
            (void)service.generateNgioGrassCache(config_, L"Default", GrassCacheGenerationOptions{3, 0}),
            std::runtime_error);

        EXPECT_EQ(runner.launchCount, 1);
        EXPECT_FALSE(std::filesystem::exists(paths.gameDirectory / L"PrecacheGrass.txt"));
        EXPECT_FALSE(std::filesystem::exists(paths.overwriteDirectory / L"Grass"));
    }
}
