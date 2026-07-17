#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModService.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"
#include "FluxoraCore/Services/VfsMountPlan.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

namespace fluxora::tests
{
    class VfsMountPlanTests : public testing::Test
    {
    protected:
        VfsMountPlanTests()
            : appData_(L"APPDATA", (temp_.path() / L"AppData").wstring()),
              project_(temp_.path() / L"Vfs Mount Plan Build"),
              settings_(logger_),
              pathSettings_(logger_),
              mods_(logger_, pathSettings_),
              profileOrder_(logger_, mods_, pathSettings_)
        {
        }

        void SetUp() override
        {
#ifndef _WIN32
            GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
            writeTextFile(
                project_ / L".fluxora" / L"paths.json",
                "{\"gameDirectory\":\"Game\",\"modsDirectory\":\"mods\","
                "\"profilesDirectory\":\"profiles\",\"downloadsDirectory\":\"downloads\","
                "\"overwriteDirectory\":\"overwrite\"}");
            writeTextFile(project_ / L"Game" / L"SkyrimSE.exe", "MZ");
            writeTextFile(project_ / L"Game" / L"Data" / L"Skyrim.esm", "master");
            InstanceMetadataStore::ensureInstance(project_, L"skyrimse");
#endif
        }

        VfsGameRootMountPlan buildPlan()
        {
            CapabilitySet capabilities;
            capabilities.enable(GameCapability::RootFiles);
            VfsSupportRules vfsRules;
            vfsRules.rules.supportsRootBuilder = true;
            vfsRules.rules.rootBuilderDirectoryName = L"root";
            ContentLayoutSupportRules contentRules;
            contentRules.dataFolder = L"Data";
            contentRules.supportsRootFiles = true;
            contentRules.rootFileWrapperDirectory = L"root";
            return buildVfsGameRootMountPlan(
                logger_,
                profileOrder_,
                pathSettings_,
                project_,
                project_ / L"Game",
                L"Default",
                capabilities,
                vfsRules,
                contentRules);
        }

        TempDirectory temp_;
        Logger logger_;
        ScopedEnvironmentVariable appData_;
        std::filesystem::path project_;
        AppSettingsService settings_;
        BuildPathSettingsService pathSettings_;
        ModService mods_;
        ProfileOrderService profileOrder_;
    };

#ifdef _WIN32
    TEST_F(VfsMountPlanTests, InvalidatingChangedModRefreshesContentPlacement)
    {
        const InstalledModEntry mod = mods_.createEmptyMod(project_, L"Layout Mod");
        InstanceMetadataStore::replaceProfileOrderItems(
            project_,
            L"Default",
            {ProfileOrderImportItemRecord{L"mod", L"Layout Mod", {}}});
        writeTextFile(mod.id / L"Data" / L"textures" / L"base.dds", "base");

        (void)mods_.listInstalledMods(project_);
        const VfsGameRootMountPlan initial = buildPlan();
        EXPECT_FALSE(initial.dataMods.empty());
        EXPECT_TRUE(initial.rootMods.empty());
        ASSERT_TRUE(vfsContentPlacementCacheContainsForTesting(mod.id));

        const std::filesystem::path newRootFile = mod.id / L"root" / L"EngineFixes.dll";
        writeTextFile(newRootFile, "root");
        invalidateVfsContentPlacementCache(
            pathSettings_.modsDirectory(project_),
            {newRootFile});
        EXPECT_FALSE(vfsContentPlacementCacheContainsForTesting(mod.id));

        const VfsGameRootMountPlan refreshed = buildPlan();
        ASSERT_EQ(refreshed.rootMods.size(), 1U);
        EXPECT_EQ(normalized(refreshed.rootMods.front()), normalized(mod.id / L"root"));
    }

    TEST_F(VfsMountPlanTests, FreshActivationLaunchReconcilesOfflineTopLevelInventoryBeforeWorkspaceRead)
    {
        const InstalledModEntry kept = mods_.createEmptyMod(project_, L"Kept Mod");
        const InstalledModEntry disabled = mods_.createEmptyMod(project_, L"Offline Disabled Mod");
        const InstalledModEntry removed = mods_.createEmptyMod(project_, L"Offline Removed Mod");
        writeTextFile(kept.id / L"Data" / L"kept.txt", "kept");
        writeTextFile(disabled.id / L"Data" / L"disabled.txt", "disabled");
        writeTextFile(removed.id / L"Data" / L"removed.txt", "removed");
        mods_.setInstalledModEnabled(project_, disabled.id, false);
        InstanceMetadataStore::replaceProfileOrderItems(
            project_,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Kept Mod", {}},
                ProfileOrderImportItemRecord{L"mod", L"Offline Removed Mod", {}},
                ProfileOrderImportItemRecord{L"mod", L"Offline Disabled Mod", {}}
            });

        // Model an uncovered interval between processes. No exact workspace
        // read occurs after these portable-manifest and folder changes.
        InstanceMetadataStore::beginProjectActivation(project_);
        InstanceMetadataStore::beginProjectActivation(temp_.path() / L"Other Build");

        const std::filesystem::path disabledManifest =
            disabled.id / L".flow" / L"manifest.json";
        std::string disabledManifestText = readTextFile(disabledManifest);
        const std::string disabledState = R"("state":"disabled")";
        const std::size_t stateOffset = disabledManifestText.find(disabledState);
        ASSERT_NE(stateOffset, std::string::npos);
        disabledManifestText.replace(
            stateOffset,
            disabledState.size(),
            R"("state":"installed")");
        writeTextFile(disabledManifest, disabledManifestText);

        ASSERT_GT(std::filesystem::remove_all(removed.id), 0U);

        const std::filesystem::path added =
            pathSettings_.modsDirectory(project_) / L"Offline Added Mod";
        writeTextFile(added / L"Data" / L"added.txt", "added");
        writeTextFile(
            added / L".flow" / L"manifest.json",
            R"({"schemaVersion":1,"modUuid":"offline-added-mod","gameId":"skyrimse",)"
            R"("folderName":"Offline Added Mod","displayName":"Offline Added Mod",)"
            R"("version":"1.0","installedAt":"2026-07-11T00:00:00Z",)"
            R"("updatedAt":"2026-07-11T00:00:00Z","state":"installed",)"
            R"("contentFingerprint":"offline-added-v1","source":{"provider":"manual"}})");

        InstanceMetadataStore::beginProjectActivation(project_);
        InstanceMetadataStore::resetInventorySyncCountForTesting();
        InstanceMetadataStore::resetStableMetadataHandleOpenCountForTesting();

        const VfsGameRootMountPlan plan = buildPlan();

        ASSERT_EQ(plan.activeMods.size(), 2U);
        EXPECT_EQ(normalized(plan.activeMods[0].path), normalized(kept.id));
        EXPECT_EQ(normalized(plan.activeMods[1].path), normalized(added));
        ASSERT_EQ(plan.dataMods.size(), 2U);
        EXPECT_EQ(normalized(plan.dataMods[0]), normalized(kept.id / L"Data"));
        EXPECT_EQ(normalized(plan.dataMods[1]), normalized(added / L"Data"));
        EXPECT_EQ(InstanceMetadataStore::inventorySyncCountForTesting(), 1U);
        EXPECT_EQ(InstanceMetadataStore::stableMetadataHandleOpenCountForTesting(), 0U);
        EXPECT_NE(readTextFile(disabledManifest).find(R"("state":"disabled")"), std::string::npos);

        const VfsGameRootMountPlan repeated = buildPlan();
        ASSERT_EQ(repeated.activeMods.size(), 2U);
        EXPECT_EQ(InstanceMetadataStore::inventorySyncCountForTesting(), 1U);
        EXPECT_EQ(InstanceMetadataStore::stableMetadataHandleOpenCountForTesting(), 0U);

        InstanceMetadataStore::invalidateModFileCaches(
            project_,
            {added / L".flow" / L"manifest.json"},
            pathSettings_.modsDirectory(project_));
        const VfsGameRootMountPlan afterWatcherInvalidation = buildPlan();
        ASSERT_EQ(afterWatcherInvalidation.activeMods.size(), 2U);
        EXPECT_EQ(InstanceMetadataStore::inventorySyncCountForTesting(), 2U);
        EXPECT_EQ(InstanceMetadataStore::stableMetadataHandleOpenCountForTesting(), 0U);
    }

    TEST_F(VfsMountPlanTests, PrecomputedLaunchSnapshotBuildsPlanWithoutMetadataRead)
    {
        const std::filesystem::path mod = project_ / L"snapshot-mod";
        writeTextFile(mod / L"Data" / L"snapshot.txt", "snapshot");

        CapabilitySet capabilities;
        capabilities.enable(GameCapability::RootFiles);
        VfsSupportRules vfsRules;
        vfsRules.rules.supportsRootBuilder = true;
        vfsRules.rules.rootBuilderDirectoryName = L"root";
        ContentLayoutSupportRules contentRules;
        contentRules.dataFolder = L"Data";
        contentRules.supportsRootFiles = true;
        contentRules.rootFileWrapperDirectory = L"root";

        InstanceMetadataStore::resetSqlPrepareCountForTesting();
        const VfsGameRootMountPlan plan = buildVfsGameRootMountPlan(
            logger_,
            {VfsActiveMod{mod, L"Snapshot Mod", L"snapshot-v1"}},
            pathSettings_,
            project_,
            project_ / L"Game",
            L"Testing",
            capabilities,
            vfsRules,
            contentRules);

        ASSERT_EQ(plan.activeMods.size(), 1U);
        EXPECT_EQ(normalized(plan.activeMods.front().path), normalized(mod));
        ASSERT_EQ(plan.dataMods.size(), 1U);
        EXPECT_EQ(normalized(plan.dataMods.front()), normalized(mod / L"Data"));
        EXPECT_EQ(InstanceMetadataStore::sqlPrepareCountForTesting(), 0U);
    }
#endif
}
