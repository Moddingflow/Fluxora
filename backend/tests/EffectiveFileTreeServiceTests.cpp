#include "FluxoraCore/Services/EffectiveFileTreeService.hpp"

#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModService.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <stdexcept>

namespace fluxora::tests
{
    namespace
    {
        void writeSkyrimPathSettings(const std::filesystem::path& project)
        {
            writeTextFile(
                project / L".fluxora" / L"paths.json",
                "{"
                "\"gameDirectory\":\"stock game\","
                "\"modsDirectory\":\"mods\","
                "\"profilesDirectory\":\"profiles\","
                "\"downloadsDirectory\":\"downloads\","
                "\"overwriteDirectory\":\"overwrite\""
                "}");
        }

        const EffectiveFileTreeEntry* findEntry(
            const EffectiveFileTreeSnapshot& snapshot,
            std::wstring_view relativePath)
        {
            const auto match = std::find_if(
                snapshot.entries.begin(),
                snapshot.entries.end(),
                [relativePath](const EffectiveFileTreeEntry& entry)
                {
                    return entry.relativePath == relativePath;
                });
            return match == snapshot.entries.end() ? nullptr : &*match;
        }

        const EffectiveFileTreeEntry* findPageEntry(
            const EffectiveFileTreePage& page,
            std::wstring_view relativePath)
        {
            const auto match = std::find_if(
                page.entries.begin(),
                page.entries.end(),
                [relativePath](const EffectiveFileTreeEntry& entry)
                {
                    return entry.relativePath == relativePath;
                });
            return match == page.entries.end() ? nullptr : &*match;
        }

        void expectSamePath(
            const std::filesystem::path& actual,
            const std::filesystem::path& expected)
        {
            EXPECT_EQ(normalized(actual), normalized(expected));
        }
    }

    class EffectiveFileTreeServiceTests : public testing::Test
    {
    protected:
        EffectiveFileTreeServiceTests()
            : appData_(L"APPDATA", (temp_.path() / L"AppData").wstring()),
              project_(temp_.path() / L"Effective Tree Build"),
              settings_(logger_),
              pathSettings_(logger_),
              mods_(logger_, pathSettings_),
              profileOrder_(logger_, mods_, pathSettings_),
              service_(logger_, profileOrder_, pathSettings_)
        {
        }

        void SetUp() override
        {
#ifndef _WIN32
            GTEST_SKIP() << "Fluxora instance metadata storage is implemented for Windows builds.";
#else
            writeTextFile(project_ / L"stock game" / L"SkyrimSE.exe", "MZ");
            writeTextFile(project_ / L"stock game" / L"Data" / L"Skyrim.esm", "master");
            writeSkyrimPathSettings(project_);
            InstanceMetadataStore::ensureInstance(project_, L"skyrimse");
#endif
        }

        std::filesystem::path overwriteDirectory() const
        {
            return pathSettings_.overwriteDirectory(project_);
        }

        TempDirectory temp_;
        Logger logger_;
        ScopedEnvironmentVariable appData_;
        std::filesystem::path project_;
        AppSettingsService settings_;
        BuildPathSettingsService pathSettings_;
        ModService mods_;
        ProfileOrderService profileOrder_;
        EffectiveFileTreeService service_;
    };

    TEST_F(EffectiveFileTreeServiceTests, StockGameRootFilesAppear)
    {
        writeTextFile(project_ / L"stock game" / L"Data" / L"Update.esm", "update");

        const EffectiveFileTreeSnapshot snapshot = service_.snapshot(project_, L"Default");

        ASSERT_NE(findEntry(snapshot, L""), nullptr);
        const EffectiveFileTreeEntry* data = findEntry(snapshot, L"Data");
        ASSERT_NE(data, nullptr);
        EXPECT_TRUE(data->isDirectory);
        EXPECT_TRUE(data->hasChildren);

        const EffectiveFileTreeEntry* executable = findEntry(snapshot, L"SkyrimSE.exe");
        ASSERT_NE(executable, nullptr);
        EXPECT_FALSE(executable->isDirectory);
        EXPECT_EQ(executable->sourceKind, L"game");
        EXPECT_EQ(executable->sourceName, L"Game");
        expectSamePath(executable->sourcePath, project_ / L"stock game" / L"SkyrimSE.exe");

        const EffectiveFileTreeEntry* master = findEntry(snapshot, L"Data\\Skyrim.esm");
        ASSERT_NE(master, nullptr);
        EXPECT_EQ(master->sourceKind, L"game");
        expectSamePath(master->sourcePath, project_ / L"stock game" / L"Data" / L"Skyrim.esm");
    }

    TEST_F(EffectiveFileTreeServiceTests, DataMergesEnabledModsRootBuilderAndOverwriteWithLaunchPriority)
    {
        const InstalledModEntry low = mods_.createEmptyMod(project_, L"Base Texture");
        const InstalledModEntry disabled = mods_.createEmptyMod(project_, L"Disabled Texture");
        const InstalledModEntry high = mods_.createEmptyMod(project_, L"Final Texture");
        const InstalledModEntry rootBuilder = mods_.createEmptyMod(project_, L"Root Builder");
        InstanceMetadataStore::replaceProfileOrderItems(
            project_,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Base Texture", {}},
                ProfileOrderImportItemRecord{L"mod", L"Disabled Texture", {}},
                ProfileOrderImportItemRecord{L"mod", L"Final Texture", {}},
                ProfileOrderImportItemRecord{L"mod", L"Root Builder", {}}
            });

        writeTextFile(project_ / L"stock game" / L"Data" / L"textures" / L"shared.dds", "game");
        writeTextFile(low.id / L"textures" / L"shared.dds", "low");
        writeTextFile(low.id / L"meshes" / L"winner.nif", "low mesh");
        writeTextFile(disabled.id / L"textures" / L"disabled.dds", "disabled");
        writeTextFile(high.id / L"textures" / L"shared.dds", "high");
        writeTextFile(high.id / L"meshes" / L"winner.nif", "high mesh");
        writeTextFile(rootBuilder.id / L"root" / L"EngineFixes.dll", "root dll");
        writeTextFile(rootBuilder.id / L"root" / L"Data" / L"scripts" / L"root-builder.pex", "root data");
        writeTextFile(overwriteDirectory() / L"textures" / L"shared.dds", "overwrite");
        writeTextFile(overwriteDirectory() / L"root" / L"d3dx9_42.dll", "root overwrite");
        mods_.setInstalledModEnabled(project_, disabled.id, false);

        const EffectiveFileTreeSnapshot snapshot = service_.snapshot(project_, L"Default");

        const EffectiveFileTreeEntry* overwritten = findEntry(snapshot, L"Data\\textures\\shared.dds");
        ASSERT_NE(overwritten, nullptr);
        EXPECT_EQ(overwritten->sourceKind, L"overwrite");
        EXPECT_EQ(overwritten->sourceName, L"Overwrite");
        expectSamePath(overwritten->sourcePath, overwriteDirectory() / L"textures" / L"shared.dds");

        const EffectiveFileTreeEntry* winner = findEntry(snapshot, L"Data\\meshes\\winner.nif");
        ASSERT_NE(winner, nullptr);
        EXPECT_EQ(winner->sourceKind, L"mod");
        EXPECT_EQ(winner->sourceName, L"Final Texture");
        expectSamePath(winner->sourcePath, high.id / L"meshes" / L"winner.nif");

        const EffectiveFileTreeEntry* rootFile = findEntry(snapshot, L"EngineFixes.dll");
        ASSERT_NE(rootFile, nullptr);
        EXPECT_EQ(rootFile->sourceKind, L"mod");
        EXPECT_EQ(rootFile->sourceName, L"Root Builder");
        expectSamePath(rootFile->sourcePath, rootBuilder.id / L"root" / L"EngineFixes.dll");

        const EffectiveFileTreeEntry* rootBuilderData =
            findEntry(snapshot, L"Data\\scripts\\root-builder.pex");
        ASSERT_NE(rootBuilderData, nullptr);
        EXPECT_EQ(rootBuilderData->sourceKind, L"mod");
        EXPECT_EQ(rootBuilderData->sourceName, L"Root Builder");
        expectSamePath(
            rootBuilderData->sourcePath,
            rootBuilder.id / L"root" / L"Data" / L"scripts" / L"root-builder.pex");

        const EffectiveFileTreeEntry* rootOverwrite = findEntry(snapshot, L"d3dx9_42.dll");
        ASSERT_NE(rootOverwrite, nullptr);
        EXPECT_EQ(rootOverwrite->sourceKind, L"overwrite");
        expectSamePath(rootOverwrite->sourcePath, overwriteDirectory() / L"root" / L"d3dx9_42.dll");

        EXPECT_EQ(findEntry(snapshot, L"Data\\textures\\disabled.dds"), nullptr);
    }

    TEST_F(EffectiveFileTreeServiceTests, LargeConflictTreeKeepsStableWarmSnapshot)
    {
        const InstalledModEntry low = mods_.createEmptyMod(project_, L"Low Meshes");
        const InstalledModEntry high = mods_.createEmptyMod(project_, L"High Meshes");
        InstanceMetadataStore::replaceProfileOrderItems(
            project_,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Low Meshes", {}},
                ProfileOrderImportItemRecord{L"mod", L"High Meshes", {}}
            });

        writeTextFile(low.id / L"meshes" / L"armor" / L"shared.nif", "low");
        writeTextFile(high.id / L"meshes" / L"armor" / L"shared.nif", "high");
        for (int index = 0; index < 10050; ++index)
        {
            writeTextFile(
                high.id / L"textures" / L"bulk" / (L"texture-" + std::to_wstring(index) + L".dds"),
                "bulk");
        }

        const EffectiveFileTreeSnapshot first = service_.snapshot(project_, L"Default");
        const EffectiveFileTreeEntry* winner = findEntry(first, L"Data\\meshes\\armor\\shared.nif");
        ASSERT_NE(winner, nullptr);
        EXPECT_EQ(winner->sourceKind, L"mod");
        EXPECT_EQ(winner->sourceName, L"High Meshes");
        expectSamePath(winner->sourcePath, high.id / L"meshes" / L"armor" / L"shared.nif");
        EXPECT_GE(first.totalFileCount, 10052U);

        const EffectiveFileTreeSnapshot warm = service_.snapshot(project_, L"Default");
        EXPECT_EQ(warm.revision, first.revision);
        EXPECT_EQ(warm.entries.size(), first.entries.size());
        EXPECT_EQ(warm.totalFileCount, first.totalFileCount);
    }

    TEST_F(EffectiveFileTreeServiceTests, ColdRootPageDoesNotWarmFullSnapshotCache)
    {
        for (int index = 0; index < 300; ++index)
        {
            writeTextFile(
                project_ / L"stock game" / L"Data" / L"textures" / L"bulk" /
                    (L"texture-" + std::to_wstring(index) + L".dds"),
                "bulk");
        }

        const EffectiveFileTreePage root = service_.root(project_, L"Default", 2);

        EXPECT_EQ(root.parentPath, L"");
        EXPECT_FALSE(root.totalFileCountKnown);
        EXPECT_EQ(root.totalFileCount, 0U);
        ASSERT_FALSE(root.entries.empty());
        EXPECT_EQ(root.entries.front().relativePath, L"");
        EXPECT_LE(root.entries.size(), 3U);

        const EffectiveFileTreeIndexWarmupResult warmup =
            service_.prepareWorkspaceIndexes(project_, L"Default");
        EXPECT_FALSE(warmup.cacheHit);
        EXPECT_GE(warmup.totalFileCount, 302U);
    }

    TEST_F(EffectiveFileTreeServiceTests, ColdLazyPagesMergeGameModsRootBuilderAndOverwrite)
    {
        const InstalledModEntry low = mods_.createEmptyMod(project_, L"Base Texture");
        const InstalledModEntry disabled = mods_.createEmptyMod(project_, L"Disabled Texture");
        const InstalledModEntry high = mods_.createEmptyMod(project_, L"Final Texture");
        const InstalledModEntry rootBuilder = mods_.createEmptyMod(project_, L"Root Builder");
        InstanceMetadataStore::replaceProfileOrderItems(
            project_,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Base Texture", {}},
                ProfileOrderImportItemRecord{L"mod", L"Disabled Texture", {}},
                ProfileOrderImportItemRecord{L"mod", L"Final Texture", {}},
                ProfileOrderImportItemRecord{L"mod", L"Root Builder", {}}
            });

        writeTextFile(project_ / L"stock game" / L"Data" / L"textures" / L"shared.dds", "game");
        writeTextFile(low.id / L"textures" / L"shared.dds", "low");
        writeTextFile(low.id / L"meshes" / L"winner.nif", "low mesh");
        writeTextFile(disabled.id / L"textures" / L"disabled.dds", "disabled");
        writeTextFile(high.id / L"textures" / L"shared.dds", "high");
        writeTextFile(high.id / L"meshes" / L"winner.nif", "high mesh");
        writeTextFile(rootBuilder.id / L"root" / L"EngineFixes.dll", "root dll");
        writeTextFile(rootBuilder.id / L"root" / L"Data" / L"scripts" / L"root-builder.pex", "root data");
        writeTextFile(overwriteDirectory() / L"textures" / L"shared.dds", "overwrite");
        writeTextFile(overwriteDirectory() / L"root" / L"d3dx9_42.dll", "root overwrite");
        mods_.setInstalledModEnabled(project_, disabled.id, false);

        const EffectiveFileTreePage root = service_.root(project_, L"Default", 20);

        EXPECT_FALSE(root.totalFileCountKnown);
        const EffectiveFileTreeEntry* rootFile = findPageEntry(root, L"EngineFixes.dll");
        ASSERT_NE(rootFile, nullptr);
        EXPECT_EQ(rootFile->sourceKind, L"mod");
        EXPECT_EQ(rootFile->sourceName, L"Root Builder");
        expectSamePath(rootFile->sourcePath, rootBuilder.id / L"root" / L"EngineFixes.dll");

        const EffectiveFileTreeEntry* rootOverwrite = findPageEntry(root, L"d3dx9_42.dll");
        ASSERT_NE(rootOverwrite, nullptr);
        EXPECT_EQ(rootOverwrite->sourceKind, L"overwrite");
        expectSamePath(rootOverwrite->sourcePath, overwriteDirectory() / L"root" / L"d3dx9_42.dll");

        const EffectiveFileTreePage data = service_.children(
            project_,
            L"Default",
            root.revision,
            L"Data",
            L"",
            20);
        EXPECT_FALSE(data.totalFileCountKnown);
        const EffectiveFileTreeEntry* textures = findPageEntry(data, L"Data\\textures");
        ASSERT_NE(textures, nullptr);
        EXPECT_TRUE(textures->isDirectory);
        EXPECT_TRUE(textures->hasChildren);
        const EffectiveFileTreeEntry* scripts = findPageEntry(data, L"Data\\scripts");
        ASSERT_NE(scripts, nullptr);
        EXPECT_TRUE(scripts->isDirectory);
        EXPECT_TRUE(scripts->hasChildren);

        const EffectiveFileTreePage textureFiles = service_.children(
            project_,
            L"Default",
            root.revision,
            L"Data\\textures",
            L"",
            20);
        const EffectiveFileTreeEntry* overwritten = findPageEntry(textureFiles, L"Data\\textures\\shared.dds");
        ASSERT_NE(overwritten, nullptr);
        EXPECT_EQ(overwritten->sourceKind, L"overwrite");
        EXPECT_EQ(overwritten->sourceName, L"Overwrite");
        expectSamePath(overwritten->sourcePath, overwriteDirectory() / L"textures" / L"shared.dds");
        EXPECT_EQ(findPageEntry(textureFiles, L"Data\\textures\\disabled.dds"), nullptr);

        const EffectiveFileTreePage meshFiles = service_.children(
            project_,
            L"Default",
            root.revision,
            L"Data\\meshes",
            L"",
            20);
        const EffectiveFileTreeEntry* winner = findPageEntry(meshFiles, L"Data\\meshes\\winner.nif");
        ASSERT_NE(winner, nullptr);
        EXPECT_EQ(winner->sourceKind, L"mod");
        EXPECT_EQ(winner->sourceName, L"Final Texture");
        expectSamePath(winner->sourcePath, high.id / L"meshes" / L"winner.nif");

        const EffectiveFileTreePage scriptFiles = service_.children(
            project_,
            L"Default",
            root.revision,
            L"Data\\scripts",
            L"",
            20);
        const EffectiveFileTreeEntry* rootBuilderData =
            findPageEntry(scriptFiles, L"Data\\scripts\\root-builder.pex");
        ASSERT_NE(rootBuilderData, nullptr);
        EXPECT_EQ(rootBuilderData->sourceKind, L"mod");
        EXPECT_EQ(rootBuilderData->sourceName, L"Root Builder");
        expectSamePath(
            rootBuilderData->sourcePath,
            rootBuilder.id / L"root" / L"Data" / L"scripts" / L"root-builder.pex");
    }

    TEST_F(EffectiveFileTreeServiceTests, RootAndChildrenPagesStayBounded)
    {
        writeTextFile(project_ / L"stock game" / L"Data" / L"Update.esm", "update");
        writeTextFile(project_ / L"stock game" / L"Data" / L"Dawnguard.esm", "dawnguard");
        writeTextFile(project_ / L"stock game" / L"Data" / L"Dragonborn.esm", "dragonborn");

        const EffectiveFileTreePage root = service_.root(project_, L"Default", 1);

        EXPECT_EQ(root.parentPath, L"");
        EXPECT_EQ(root.limit, 1);
        EXPECT_GE(root.totalChildCount, 2);
        ASSERT_GE(root.entries.size(), 2U);
        EXPECT_EQ(root.entries.front().relativePath, L"");
        EXPECT_FALSE(root.nextCursor.empty());

        const EffectiveFileTreePage firstDataPage =
            service_.children(project_, L"Default", root.revision, L"Data", L"", 2);

        EXPECT_EQ(firstDataPage.parentPath, L"Data");
        EXPECT_EQ(firstDataPage.limit, 2);
        EXPECT_GE(firstDataPage.totalChildCount, 4);
        EXPECT_LE(firstDataPage.entries.size(), 2U);
        EXPECT_FALSE(firstDataPage.nextCursor.empty());

        const EffectiveFileTreePage secondDataPage =
            service_.children(project_, L"Default", root.revision, L"Data", firstDataPage.nextCursor, 2);

        EXPECT_EQ(secondDataPage.parentPath, L"Data");
        EXPECT_LE(secondDataPage.entries.size(), 2U);
        EXPECT_NE(secondDataPage.entries.front().relativePath, firstDataPage.entries.front().relativePath);
    }

    TEST_F(EffectiveFileTreeServiceTests, WorkspaceIndexWarmupReportsCacheHit)
    {
        const EffectiveFileTreeIndexWarmupResult cold =
            service_.prepareWorkspaceIndexes(project_, L"Default");
        const EffectiveFileTreeIndexWarmupResult warm =
            service_.prepareWorkspaceIndexes(project_, L"Default");

        EXPECT_FALSE(cold.cacheHit);
        EXPECT_TRUE(warm.cacheHit);
        EXPECT_EQ(warm.revision, cold.revision);
        EXPECT_EQ(warm.totalFileCount, cold.totalFileCount);
        EXPECT_EQ(warm.totalEntryCount, cold.totalEntryCount);
    }

    TEST_F(EffectiveFileTreeServiceTests, ChildrenRejectStaleRevision)
    {
        const EffectiveFileTreePage root = service_.root(project_, L"Default", 50);

        const InstalledModEntry added = mods_.createEmptyMod(project_, L"New Revision Mod");
        InstanceMetadataStore::replaceProfileOrderItems(
            project_,
            L"Default",
            {ProfileOrderImportItemRecord{L"mod", L"New Revision Mod", {}}});
        writeTextFile(added.id / L"textures" / L"new.dds", "new");

        EXPECT_THROW(
            {
                const EffectiveFileTreePage page =
                    service_.children(project_, L"Default", root.revision, L"Data", L"", 50);
                (void)page;
            },
            std::invalid_argument);
    }

    TEST_F(EffectiveFileTreeServiceTests, ModConflictTreeUsesCachedFileIndex)
    {
        const InstalledModEntry low = mods_.createEmptyMod(project_, L"Low Textures");
        const InstalledModEntry high = mods_.createEmptyMod(project_, L"High Textures");
        InstanceMetadataStore::replaceProfileOrderItems(
            project_,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Low Textures", {}},
                ProfileOrderImportItemRecord{L"mod", L"High Textures", {}}
            });

        writeTextFile(low.id / L"textures" / L"shared.dds", "low");
        writeTextFile(high.id / L"textures" / L"shared.dds", "high");
        static_cast<void>(profileOrder_.listModOrder(project_, L"Default"));

        const ModConflictTreePage highConflicts =
            mods_.listModConflictTree(project_, high.id, L"", 20);
        const ModConflictTreePage lowConflicts =
            mods_.listModConflictTree(project_, low.id, L"", 20);

        ASSERT_EQ(highConflicts.overwrites.size(), 1U);
        EXPECT_EQ(highConflicts.overwrites.front().relativePath, L"textures/shared.dds");
        EXPECT_EQ(highConflicts.overwrites.front().conflictState, L"overwrites");
        EXPECT_EQ(highConflicts.totalOverwrites, 1);

        ASSERT_EQ(lowConflicts.overwritten.size(), 1U);
        EXPECT_EQ(lowConflicts.overwritten.front().relativePath, L"textures/shared.dds");
        EXPECT_EQ(lowConflicts.overwritten.front().conflictState, L"overwritten");
        EXPECT_EQ(lowConflicts.totalOverwritten, 1);
    }

    TEST_F(EffectiveFileTreeServiceTests, ModDetailsContentReturnsEveryDirectoryAndConflictInOneSnapshot)
    {
        const InstalledModEntry low = mods_.createEmptyMod(project_, L"Low Details");
        const InstalledModEntry high = mods_.createEmptyMod(project_, L"High Details");
        InstanceMetadataStore::replaceProfileOrderItems(
            project_,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Low Details", {}},
                ProfileOrderImportItemRecord{L"mod", L"High Details", {}}
            });

        writeTextFile(low.id / L"textures" / L"shared.dds", "low");
        writeTextFile(high.id / L"textures" / L"shared.dds", "high");
        writeTextFile(high.id / L"SKSE" / L"Plugins" / L"SprintFix.dll", "plugin");
        static_cast<void>(profileOrder_.listModOrder(project_, L"Default"));

        const ModDetailsContent content = mods_.getModDetailsContent(project_, high.id);
        const auto findDirectory = [&content](std::wstring_view relativePath)
        {
            return std::find_if(
                content.directories.begin(),
                content.directories.end(),
                [relativePath](const ModFileTreeDirectory& directory)
                {
                    return directory.relativePath == relativePath;
                });
        };

        EXPECT_EQ(content.modPath, high.id);
        const auto root = findDirectory(L"");
        const auto skse = findDirectory(L"SKSE");
        const auto plugins = findDirectory(L"SKSE/Plugins");
        const auto textures = findDirectory(L"textures");
        ASSERT_NE(root, content.directories.end());
        ASSERT_NE(skse, content.directories.end());
        ASSERT_NE(plugins, content.directories.end());
        ASSERT_NE(textures, content.directories.end());
        EXPECT_TRUE(std::any_of(
            root->entries.begin(),
            root->entries.end(),
            [](const ModFileTreeEntry& entry)
            {
                return entry.relativePath == L"SKSE" && entry.isDirectory && entry.hasChildren;
            }));
        EXPECT_TRUE(std::any_of(
            skse->entries.begin(),
            skse->entries.end(),
            [](const ModFileTreeEntry& entry)
            {
                return entry.relativePath == L"SKSE/Plugins" && entry.isDirectory && entry.hasChildren;
            }));
        EXPECT_TRUE(std::any_of(
            plugins->entries.begin(),
            plugins->entries.end(),
            [](const ModFileTreeEntry& entry)
            {
                return entry.relativePath == L"SKSE/Plugins/SprintFix.dll" && !entry.isDirectory;
            }));

        ASSERT_EQ(content.conflictTree.overwrites.size(), 1U);
        EXPECT_EQ(content.conflictTree.overwrites.front().relativePath, L"textures/shared.dds");
        EXPECT_EQ(content.conflictTree.totalOverwrites, 1);
        EXPECT_EQ(content.conflictTree.totalOverwritten, 0);
        EXPECT_EQ(content.conflictTree.limit, 1);
        EXPECT_TRUE(content.conflictTree.nextCursor.empty());
    }
}
