#include "FluxoraCore/Services/FomodProfileContextService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <string>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        const FomodProfileFileState& stateFor(
            const FomodProfileContext& context,
            std::wstring_view file)
        {
            const auto match = std::find_if(
                context.fileStates.begin(),
                context.fileStates.end(),
                [file](const FomodProfileFileState& state)
                {
                    return state.file == file;
                });
            EXPECT_NE(match, context.fileStates.end());
            return *match;
        }
    }

    TEST(FomodProfileContextServiceTests, ResolvesProfileOrderPluginStateAndDisabledMods)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path game = project / L"game";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path profiles = project / L"profiles";

        writeTextFile(game / L"Data" / L"GameFile.txt", "game");
        writeTextFile(mods / L"Lower" / L"shared.txt", "lower");
        writeTextFile(mods / L"Higher" / L"shared.txt", "higher");
        writeTextFile(mods / L"Higher" / L"Active.esp", "active");
        writeTextFile(mods / L"Higher" / L"Inactive.esp", "inactive");
        writeTextFile(mods / L"Disabled" / L"DisabledOnly.txt", "disabled");
        writeTextFile(mods / L"Disabled" / L"DisabledPlugin.esp", "disabled plugin");
        writeTextFile(
            profiles / L"Gameplay" / L"plugins.txt",
            "*Active.esp\nInactive.esp\n*DisabledPlugin.esp\n");

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{mods / L"Lower", L"Lower", {}, true, {}},
                InstalledModImportRecord{mods / L"Higher", L"Higher", {}, true, {}},
                InstalledModImportRecord{mods / L"Disabled", L"Disabled", {}, false, {}}
            });
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Gameplay",
            {
                ProfileOrderImportItemRecord{L"mod", L"Lower", {}},
                ProfileOrderImportItemRecord{L"mod", L"Higher", {}},
                ProfileOrderImportItemRecord{L"mod", L"Disabled", {}}
            });

        const FomodProfileContext context = FomodProfileContextService::build(
            FomodProfileContextRequest{
                project,
                game,
                mods,
                profiles,
                L"Gameplay",
                {L"Data"},
                {
                    L"Data\\GameFile.txt",
                    L"Data\\shared.txt",
                    L"Data\\Active.esp",
                    L"Data\\Inactive.esp",
                    L"Data\\DisabledOnly.txt",
                    L"Data\\DisabledPlugin.esp",
                    L"Data\\Missing.txt"
                }
            });

        EXPECT_EQ(stateFor(context, L"Data\\GameFile.txt").state, FomodProfileFileStateKind::Active);
        const FomodProfileFileState& shared = stateFor(context, L"Data\\shared.txt");
        EXPECT_EQ(shared.state, FomodProfileFileStateKind::Active);
        EXPECT_EQ(shared.sourceKind, L"mod");
        EXPECT_EQ(shared.sourceName, L"Higher");

        EXPECT_EQ(stateFor(context, L"Data\\Active.esp").state, FomodProfileFileStateKind::Active);
        EXPECT_EQ(stateFor(context, L"Data\\Inactive.esp").state, FomodProfileFileStateKind::Inactive);
        EXPECT_EQ(stateFor(context, L"Data\\DisabledOnly.txt").state, FomodProfileFileStateKind::Inactive);
        EXPECT_EQ(stateFor(context, L"Data\\DisabledPlugin.esp").state, FomodProfileFileStateKind::Inactive);
        EXPECT_EQ(stateFor(context, L"Data\\Missing.txt").state, FomodProfileFileStateKind::Missing);
        EXPECT_FALSE(context.contextId.empty());
        EXPECT_FALSE(context.fingerprint.empty());
    }

    TEST(FomodProfileContextServiceTests, SyntheticLargeProfileMeetsColdAndCachedAnalysisBudgets)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Synthetic profile performance budget targets the Windows product runtime.";
#else
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / L"project";
        const std::filesystem::path game = project / L"game";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path profiles = project / L"profiles";
        constexpr int modCount = 1000;
        constexpr int pluginCount = 2000;
        constexpr int dependencyCount = 200;

        writeTextFile(game / L"SkyrimSE.exe", "MZ executable stub");
        std::vector<InstalledModImportRecord> installedMods;
        std::vector<ProfileOrderImportItemRecord> order;
        installedMods.reserve(modCount);
        order.reserve(modCount);
        for (int index = 0; index < modCount; ++index)
        {
            const std::wstring name = L"Synthetic Mod " + std::to_wstring(index);
            const std::filesystem::path path = mods / name;
            std::filesystem::create_directories(path);
            installedMods.push_back(InstalledModImportRecord{path, name, {}, true, {}});
            order.push_back(ProfileOrderImportItemRecord{L"mod", name, {}});
        }

        std::string plugins;
        for (int index = 0; index < pluginCount; ++index)
        {
            plugins += "*Dependency" + std::to_string(index) + ".esp\n";
        }
        writeTextFile(profiles / L"Performance" / L"plugins.txt", plugins);

        std::vector<std::wstring> dependencies;
        dependencies.reserve(dependencyCount);
        const std::filesystem::path winningMod = mods / (L"Synthetic Mod " + std::to_wstring(modCount - 1));
        for (int index = 0; index < dependencyCount; ++index)
        {
            const std::wstring plugin = L"Dependency" + std::to_wstring(index) + L".esp";
            writeTextFile(winningMod / plugin, "plugin");
            dependencies.push_back(L"Data\\" + plugin);
        }

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(project, installedMods);
        InstanceMetadataStore::replaceProfileOrderItems(project, L"Performance", order);
        const FomodProfileContextRequest request{
            project,
            game,
            mods,
            profiles,
            L"Performance",
            {L"Data"},
            dependencies
        };

        const auto coldStartedAt = std::chrono::steady_clock::now();
        const FomodProfileContext cold = FomodProfileContextService::build(request);
        const auto coldDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - coldStartedAt);
        const auto cachedStartedAt = std::chrono::steady_clock::now();
        const FomodProfileContext cached = FomodProfileContextService::build(request);
        const auto cachedDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - cachedStartedAt);

        EXPECT_EQ(cold.fileStates.size(), dependencyCount);
        EXPECT_EQ(cached.fingerprint, cold.fingerprint);
        EXPECT_LE(coldDuration.count(), 500) << "cold analysis took " << coldDuration.count() << " ms";
        EXPECT_LE(cachedDuration.count(), 100) << "cached analysis took " << cachedDuration.count() << " ms";
#endif
    }
}
