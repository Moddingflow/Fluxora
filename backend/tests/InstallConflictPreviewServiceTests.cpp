#include "FluxoraCore/Services/InstallConflictPreviewService.hpp"

#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>

namespace fluxora
{
    namespace
    {
        InstallConflictProfileMod profileMod(
            std::wstring orderId,
            std::wstring modUuid,
            std::wstring relationId,
            bool enabled,
            std::initializer_list<std::wstring_view> files)
        {
            InstallConflictProfileMod mod;
            mod.orderId = std::move(orderId);
            mod.modUuid = std::move(modUuid);
            mod.relationId = std::move(relationId);
            mod.enabled = enabled;
            for (const std::wstring_view file : files)
            {
                mod.files.push_back(InstallConflictFile{std::wstring(file)});
            }
            return mod;
        }

        const InstallConflictRowPatch& patchFor(
            const FluxoraInstallConflictSnapshot& snapshot,
            std::wstring_view orderId)
        {
            const auto selected = std::find_if(
                snapshot.rows.begin(),
                snapshot.rows.end(),
                [orderId](const InstallConflictRowPatch& row)
                {
                    return row.orderId == orderId;
                });
            EXPECT_NE(selected, snapshot.rows.end());
            return *selected;
        }
    }

    TEST(InstallConflictPreviewServiceTests, ComputesCaseInsensitiveTwoSidedSnapshot)
    {
        InstallConflictPreviewRequest request;
        request.operationId = L"operation-1";
        request.revision = 7;
        request.mode = InstallConflictPreviewMode::Install;
        request.pendingOrderId = L"pending-install:operation-1";
        request.targetIndex = 3;
        request.profileMods = {
            profileMod(L"order-a", L"uuid-a", L"C:\\Mods\\Alpha", true,
                {L"Meshes\\Shared.NIF", L"alpha.txt"}),
            profileMod(L"order-disabled", L"uuid-disabled", L"C:\\Mods\\Disabled", false,
                {L"meshes/shared.nif"}),
            profileMod(L"order-b", L"uuid-b", L"C:\\Mods\\Beta", true,
                {L"beta.txt"})
        };
        request.incomingFiles = {
            InstallConflictFile{L"meshes/shared.nif"},
            InstallConflictFile{L"incoming.txt"}
        };

        const FluxoraInstallConflictSnapshot snapshot =
            InstallConflictPreviewService::calculate(request);

        EXPECT_EQ(snapshot.operationId, L"operation-1");
        EXPECT_EQ(snapshot.revision, 7U);
        EXPECT_EQ(snapshot.state, InstallConflictSnapshotState::Ready);
        ASSERT_EQ(snapshot.rows.size(), 2U);

        const InstallConflictRowPatch& alpha = patchFor(snapshot, L"order-a");
        EXPECT_EQ(alpha.fileCount, 2);
        EXPECT_EQ(alpha.conflictingFileCount, 1);
        EXPECT_EQ(alpha.overwrittenFileCount, 1);
        EXPECT_EQ(alpha.overwritingFileCount, 0);
        EXPECT_EQ(alpha.overwrittenByModIds,
            std::vector<std::wstring>{L"pending-install:operation-1"});

        const InstallConflictRowPatch& pending =
            patchFor(snapshot, L"pending-install:operation-1");
        EXPECT_EQ(pending.fileCount, 2);
        EXPECT_EQ(pending.conflictingFileCount, 1);
        EXPECT_EQ(pending.overwrittenFileCount, 0);
        EXPECT_EQ(pending.overwritingFileCount, 1);
        EXPECT_EQ(pending.overwritesModIds,
            std::vector<std::wstring>{L"C:\\Mods\\Alpha"});
    }

    TEST(InstallConflictPreviewServiceTests, RebaseChangesConflictDirection)
    {
        InstallConflictPreviewRequest request;
        request.operationId = L"operation-2";
        request.revision = 1;
        request.pendingOrderId = L"pending-install:operation-2";
        request.targetIndex = 1;
        request.profileMods = {
            profileMod(L"order-a", L"uuid-a", L"alpha", true, {L"shared.txt"})
        };
        request.incomingFiles = {InstallConflictFile{L"SHARED.TXT"}};

        const FluxoraInstallConflictSnapshot below =
            InstallConflictPreviewService::calculate(request);
        request.revision = 2;
        request.targetIndex = 0;
        const FluxoraInstallConflictSnapshot above =
            InstallConflictPreviewService::calculate(request);

        EXPECT_EQ(patchFor(below, request.pendingOrderId).overwritingFileCount, 1);
        EXPECT_EQ(patchFor(below, L"order-a").overwrittenFileCount, 1);
        EXPECT_EQ(patchFor(above, request.pendingOrderId).overwrittenFileCount, 1);
        EXPECT_EQ(patchFor(above, L"order-a").overwritingFileCount, 1);
    }

    TEST(InstallConflictPreviewServiceTests, ReplaceDropsOldFilesAndMergeUsesUnion)
    {
        InstallConflictPreviewRequest request;
        request.operationId = L"operation-3";
        request.revision = 1;
        request.pendingOrderId = L"pending-install:operation-3";
        request.targetModUuid = L"uuid-target";
        request.targetIndex = 1;
        request.profileMods = {
            profileMod(L"order-other", L"uuid-other", L"other", true, {L"old.txt"}),
            profileMod(L"order-target", L"uuid-target", L"target", true, {L"old.txt"})
        };
        request.incomingFiles = {InstallConflictFile{L"new.txt"}};

        request.mode = InstallConflictPreviewMode::Replace;
        const FluxoraInstallConflictSnapshot replaced =
            InstallConflictPreviewService::calculate(request);
        ASSERT_EQ(replaced.rows.size(), 2U);
        EXPECT_EQ(patchFor(replaced, L"order-target").fileCount, 1);
        EXPECT_EQ(patchFor(replaced, L"order-target").conflictingFileCount, 0);
        EXPECT_EQ(patchFor(replaced, L"order-other").conflictingFileCount, 0);

        request.revision = 2;
        request.mode = InstallConflictPreviewMode::Merge;
        const FluxoraInstallConflictSnapshot merged =
            InstallConflictPreviewService::calculate(request);
        ASSERT_EQ(merged.rows.size(), 1U);
        EXPECT_EQ(patchFor(merged, L"order-target").fileCount, 2);
        EXPECT_EQ(patchFor(merged, L"order-target").overwritingFileCount, 1);
    }

#ifdef _WIN32
    TEST(InstallConflictPreviewServiceTests, PersistsExactInventoryAndRebasesMonotonically)
    {
        tests::TempDirectory temporary;
        const std::filesystem::path project = temporary.path() / L"Project";
        const std::filesystem::path alphaPath = project / L"mods" / L"Alpha";
        tests::writeTextFile(alphaPath / L"Shared.txt", "alpha");
        InstanceMetadataStore::registerInstalledMod(
            project,
            alphaPath,
            L"Alpha",
            L"1.0",
            ModSourceRecord{});

        InstallConflictSessionStartRequest start;
        start.projectDirectory = project;
        start.operationId = L"operation-persisted";
        start.profileName = L"Default";
        start.pendingOrderId = L"pending-install:operation-persisted";
        start.mode = InstallConflictPreviewMode::Install;
        start.targetIndex = 1;
        InstallConflictPreviewService::beginSession(start);

        const FluxoraInstallConflictSnapshot ready =
            InstallConflictPreviewService::publishExactInventory(
                project,
                start.operationId,
                {InstallConflictFile{L"shared.TXT"}});
        EXPECT_EQ(ready.revision, 1U);
        EXPECT_EQ(ready.state, InstallConflictSnapshotState::Ready);
        EXPECT_EQ(patchFor(ready, start.pendingOrderId).overwritingFileCount, 1);

        InstanceMetadataStore::setInstalledModEnabled(project, alphaPath, false);
        const FluxoraInstallConflictSnapshot disabled =
            InstallConflictPreviewService::rebase(
                project,
                start.operationId,
                1);
        EXPECT_EQ(disabled.revision, 2U);
        EXPECT_EQ(disabled.targetIndex, 1);
        ASSERT_EQ(disabled.rows.size(), 1U);
        EXPECT_EQ(patchFor(disabled, start.pendingOrderId).conflictingFileCount, 0);

        InstanceMetadataStore::setInstalledModEnabled(project, alphaPath, true);
        const FluxoraInstallConflictSnapshot rebased =
            InstallConflictPreviewService::rebase(
                project,
                start.operationId,
                0);
        EXPECT_EQ(rebased.revision, 3U);
        EXPECT_EQ(rebased.targetIndex, 0);
        EXPECT_EQ(patchFor(rebased, start.pendingOrderId).overwrittenFileCount, 1);

        const PendingInstallSessionRecord persisted =
            InstanceMetadataStore::pendingInstallSession(project, start.operationId);
        EXPECT_EQ(persisted.profileName, L"Default");
        EXPECT_EQ(persisted.targetPosition, 0);
        EXPECT_EQ(persisted.revision, 3U);
        EXPECT_EQ(persisted.state, L"ready");
    }
#endif
}
