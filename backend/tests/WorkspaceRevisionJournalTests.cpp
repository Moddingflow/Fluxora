#include "FluxoraCore/Services/WorkspaceRevisionJournal.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <filesystem>
#include <string>
#include <vector>

namespace
{
    fluxora::ProfileModOrderItem mod(
        std::wstring orderId,
        int order,
        std::wstring version = L"1")
    {
        fluxora::ProfileModOrderItem item;
        item.orderId = std::move(orderId);
        item.kind = L"mod";
        item.order = order;
        item.id = std::filesystem::path(L"mods") / item.orderId;
        item.name = item.orderId;
        item.version = std::move(version);
        item.modUuid = item.orderId;
        return item;
    }

    fluxora::InstalledModEntry installed(
        std::wstring id,
        std::wstring version = L"1")
    {
        fluxora::InstalledModEntry item;
        item.id = std::filesystem::path(L"mods") / id;
        item.name = std::move(id);
        item.version = std::move(version);
        return item;
    }

    fluxora::PluginEntry plugin(
        std::wstring orderId,
        int order,
        bool enabled = true)
    {
        fluxora::PluginEntry item;
        item.orderId = std::move(orderId);
        item.kind = L"plugin";
        item.order = order;
        item.name = item.orderId + L".esp";
        item.isEnabled = enabled;
        return item;
    }

    fluxora::DownloadEntry download(
        std::wstring id,
        int progress,
        std::wstring state = L"downloading")
    {
        fluxora::DownloadEntry item;
        item.id = std::move(id);
        item.name = item.id;
        item.fileName = item.id + L".7z";
        item.localPath = std::filesystem::path(L"downloads") / item.fileName;
        item.transferState = std::move(state);
        item.progressPercent = progress;
        return item;
    }

    fluxora::WorkspaceRevisionInput workspace(
        std::vector<fluxora::ProfileModOrderItem> mods,
        std::vector<fluxora::InstalledModEntry> installedMods,
        std::vector<fluxora::PluginEntry> plugins)
    {
        return {
            fluxora::ModWorkspaceSnapshot{
                std::move(installedMods),
                std::move(mods)},
            std::move(plugins)
        };
    }

    template<typename T>
    bool contains(const std::vector<T>& values, const T& value)
    {
        return std::find(values.begin(), values.end(), value) != values.end();
    }
}

TEST(WorkspaceRevisionJournalTests, EmitsInitialAndNoChangeDeltas)
{
    fluxora::tests::TempDirectory project;
    fluxora::WorkspaceRevisionJournal journal;
    const auto input = workspace(
        {mod(L"a", 0), mod(L"b", 1)},
        {installed(L"a"), installed(L"b")},
        {plugin(L"p-a", 0)});

    const auto initial = journal.captureWorkspace(
        project.path(), L"Default", L"", L"initial", input);
    ASSERT_FALSE(initial.fullResyncRequired);
    EXPECT_EQ(initial.sequence, 1u);
    EXPECT_EQ(initial.mods.upserts.size(), 2u);
    EXPECT_EQ(initial.installedModUpserts.size(), 2u);
    EXPECT_EQ(initial.plugins.upserts.size(), 1u);
    EXPECT_EQ(initial.mods.placements.size(), 2u);

    const auto unchanged = journal.captureWorkspace(
        project.path(), L"Default", initial.mods.revision, L"watcher", input);
    EXPECT_FALSE(unchanged.fullResyncRequired);
    EXPECT_EQ(unchanged.sequence, initial.sequence);
    EXPECT_TRUE(unchanged.mods.upserts.empty());
    EXPECT_TRUE(unchanged.installedModUpserts.empty());
    EXPECT_TRUE(unchanged.plugins.upserts.empty());
}

TEST(WorkspaceRevisionJournalTests, DiffsInstallReplaceMergeRemovalAndPluginDiscovery)
{
    fluxora::tests::TempDirectory project;
    fluxora::WorkspaceRevisionJournal journal;
    const auto baseline = workspace(
        {mod(L"a", 0)},
        {installed(L"a")},
        {plugin(L"p-a", 0)});
    const auto first = journal.captureWorkspace(
        project.path(), L"Default", L"", L"initial", baseline);

    auto installedInput = workspace(
        {mod(L"a", 0), mod(L"b", 1)},
        {installed(L"a"), installed(L"b")},
        {plugin(L"p-a", 0), plugin(L"p-b", 1)});
    const auto installDelta = journal.captureWorkspace(
        project.path(), L"Default", first.mods.revision, L"install", installedInput);
    ASSERT_FALSE(installDelta.fullResyncRequired);
    ASSERT_EQ(installDelta.mods.upserts.size(), 1u);
    EXPECT_EQ(installDelta.mods.upserts.front().orderId, L"b");
    ASSERT_EQ(installDelta.plugins.upserts.size(), 1u);
    EXPECT_EQ(installDelta.plugins.upserts.front().orderId, L"p-b");

    installedInput.workspace.modOrder[0].version = L"2";
    installedInput.workspace.installedMods[0].version = L"2";
    const auto replaceDelta = journal.captureWorkspace(
        project.path(), L"Default", installDelta.mods.revision, L"replace", installedInput);
    ASSERT_EQ(replaceDelta.mods.upserts.size(), 1u);
    EXPECT_EQ(replaceDelta.mods.upserts.front().orderId, L"a");

    installedInput.workspace.modOrder[0].fileCount = 42;
    installedInput.workspace.installedMods[0].fileCount = 42;
    const auto mergeDelta = journal.captureWorkspace(
        project.path(), L"Default", replaceDelta.mods.revision, L"merge", installedInput);
    ASSERT_EQ(mergeDelta.mods.upserts.size(), 1u);
    EXPECT_EQ(mergeDelta.mods.upserts.front().fileCount, 42);

    installedInput.workspace.modOrder.erase(installedInput.workspace.modOrder.begin());
    installedInput.workspace.installedMods.erase(installedInput.workspace.installedMods.begin());
    installedInput.plugins.erase(installedInput.plugins.begin());
    const auto removalDelta = journal.captureWorkspace(
        project.path(), L"Default", mergeDelta.mods.revision, L"remove", installedInput);
    EXPECT_TRUE(contains(removalDelta.mods.removedOrderIds, std::wstring(L"a")));
    EXPECT_TRUE(contains(removalDelta.plugins.removedOrderIds, std::wstring(L"p-a")));
    EXPECT_EQ(removalDelta.removedInstalledModIds.size(), 1u);
}

TEST(WorkspaceRevisionJournalTests, ReturnsFullResyncAfterBoundedHistoryGap)
{
    fluxora::tests::TempDirectory project;
    fluxora::WorkspaceRevisionJournal journal(2);
    auto input = workspace({mod(L"a", 0)}, {installed(L"a")}, {});
    const auto first = journal.captureWorkspace(
        project.path(), L"Default", L"", L"initial", input);
    std::wstring latest = first.mods.revision;
    for (int version = 2; version <= 5; ++version)
    {
        input.workspace.modOrder[0].version = std::to_wstring(version);
        input.workspace.installedMods[0].version = std::to_wstring(version);
        latest = journal.captureWorkspace(
            project.path(), L"Default", latest, L"change", input).mods.revision;
    }

    const auto stale = journal.captureWorkspace(
        project.path(), L"Default", first.mods.revision, L"stale", input);
    EXPECT_TRUE(stale.fullResyncRequired);
    EXPECT_EQ(stale.mods.revision, latest);
}

TEST(WorkspaceRevisionJournalTests, PersistsUnicodeScopeAcrossRestart)
{
    fluxora::tests::TempDirectory root;
    const auto project = root.path() / L"Сборка_日本語";
    std::filesystem::create_directories(project);
    auto input = workspace({mod(L"мод-一", 0)}, {installed(L"мод-一")}, {});
    fluxora::WorkspaceRevisionJournal firstJournal;
    const auto first = firstJournal.captureWorkspace(
        project, L"Профиль 一", L"", L"initial", input);
    input.workspace.modOrder.push_back(mod(L"мод-二", 1));
    input.workspace.installedMods.push_back(installed(L"мод-二"));
    const auto second = firstJournal.captureWorkspace(
        project, L"Профиль 一", first.mods.revision, L"install", input);

    fluxora::WorkspaceRevisionJournal restarted;
    const auto replayed = restarted.captureWorkspace(
        project, L"Профиль 一", first.mods.revision, L"restart", input);
    ASSERT_FALSE(replayed.fullResyncRequired);
    EXPECT_EQ(replayed.mods.revision, second.mods.revision);
    ASSERT_EQ(replayed.mods.upserts.size(), 1u);
    EXPECT_EQ(replayed.mods.upserts.front().orderId, L"мод-二");
}

TEST(WorkspaceRevisionJournalTests, HandlesFiveThousandEntriesAndDownloadChanges)
{
    fluxora::tests::TempDirectory project;
    fluxora::WorkspaceRevisionJournal journal;
    std::vector<fluxora::ProfileModOrderItem> mods;
    std::vector<fluxora::InstalledModEntry> installedMods;
    std::vector<fluxora::PluginEntry> plugins;
    for (int index = 0; index < 5000; ++index)
    {
        const std::wstring id = L"item-" + std::to_wstring(index);
        mods.push_back(mod(id, index));
        installedMods.push_back(installed(id));
        plugins.push_back(plugin(L"plugin-" + std::to_wstring(index), index));
    }

    const auto initial = journal.captureWorkspace(
        project.path(),
        L"Default",
        L"",
        L"large",
        workspace(std::move(mods), std::move(installedMods), std::move(plugins)));
    EXPECT_EQ(initial.mods.upserts.size(), 5000u);
    EXPECT_EQ(initial.plugins.upserts.size(), 5000u);

    auto downloads = std::vector{download(L"one", 10), download(L"two", 100, L"completed")};
    const auto firstDownloads = journal.captureDownloads(
        project.path(), L"", L"download", L"initial", downloads);
    downloads[0].progressPercent = 55;
    downloads.erase(downloads.begin() + 1);
    const auto changedDownloads = journal.captureDownloads(
        project.path(),
        firstDownloads.revision,
        L"download",
        L"progress",
        downloads);
    ASSERT_EQ(changedDownloads.upserts.size(), 1u);
    EXPECT_EQ(changedDownloads.upserts.front().progressPercent, 55);
    ASSERT_EQ(changedDownloads.removedIds.size(), 1u);
    EXPECT_EQ(changedDownloads.removedIds.front(), L"two");

    std::vector<fluxora::DownloadEntry> reorderedDownloads{
        download(L"replacement", 100, L"completed"),
        downloads.front()};
    const auto reordered = journal.captureDownloads(
        project.path(),
        changedDownloads.revision,
        L"download",
        L"replacement-completed",
        reorderedDownloads);
    ASSERT_EQ(reordered.upserts.size(), 1u);
    EXPECT_EQ(reordered.upserts.front().id, L"replacement");
    ASSERT_EQ(reordered.placements.size(), 1u);
    EXPECT_EQ(reordered.placements.front().orderId, L"replacement");
    EXPECT_EQ(reordered.placements.front().beforeOrderId, L"one");
}

TEST(WorkspaceRevisionJournalTests, DownloadPlacementMovesAChangedExistingArchiveToTheFront)
{
    fluxora::tests::TempDirectory project;
    fluxora::WorkspaceRevisionJournal journal;
    const auto initial = journal.captureDownloads(
        project.path(),
        L"",
        L"download",
        L"initial",
        {download(L"newer", 100, L"completed"), download(L"replacement", 100, L"completed")});

    const auto changed = journal.captureDownloads(
        project.path(),
        initial.revision,
        L"download",
        L"replacement-completed",
        {download(L"replacement", 99, L"completed"), download(L"newer", 100, L"completed")});

    ASSERT_EQ(changed.upserts.size(), 1u);
    EXPECT_EQ(changed.upserts.front().id, L"replacement");
    ASSERT_EQ(changed.placements.size(), 1u);
    EXPECT_EQ(changed.placements.front().orderId, L"replacement");
    EXPECT_EQ(changed.placements.front().beforeOrderId, L"newer");
}
