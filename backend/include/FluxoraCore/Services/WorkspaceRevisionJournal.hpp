#pragma once

#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/PluginService.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    struct OrderPlacement
    {
        std::wstring orderId;
        std::wstring beforeOrderId;
        std::wstring afterOrderId;
    };

    template<typename T>
    struct RevisionedOrderDelta
    {
        std::wstring baseRevision;
        std::wstring revision;
        std::vector<T> upserts;
        std::vector<std::wstring> removedOrderIds;
        std::vector<OrderPlacement> placements;
    };

    struct WorkspaceRevisionInput
    {
        ModWorkspaceSnapshot workspace;
        std::vector<PluginEntry> plugins;
    };

    struct WorkspaceDelta
    {
        std::filesystem::path projectDirectory;
        std::wstring profileName;
        std::wstring operationId;
        std::uint64_t sequence{0};
        RevisionedOrderDelta<ProfileModOrderItem> mods;
        std::vector<InstalledModEntry> installedModUpserts;
        std::vector<std::wstring> removedInstalledModIds;
        RevisionedOrderDelta<PluginEntry> plugins;
        bool fullResyncRequired{false};
    };

    struct DownloadsChangedDelta
    {
        std::filesystem::path projectDirectory;
        std::wstring operationId;
        std::wstring revision;
        std::uint64_t sequence{0};
        std::vector<DownloadEntry> upserts;
        std::vector<std::wstring> removedIds;
        std::vector<OrderPlacement> placements;
        std::wstring reason;
        bool fullResyncRequired{false};
    };

    class WorkspaceRevisionJournal final
    {
    public:
        explicit WorkspaceRevisionJournal(std::size_t historyLimit = 64);

        [[nodiscard]] WorkspaceDelta captureWorkspace(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            std::wstring_view sinceRevision,
            std::wstring_view operationId,
            const WorkspaceRevisionInput& input);

        [[nodiscard]] DownloadsChangedDelta captureDownloads(
            const std::filesystem::path& projectDirectory,
            std::wstring_view sinceRevision,
            std::wstring_view operationId,
            std::wstring_view reason,
            const std::vector<DownloadEntry>& downloads);

    private:
        std::size_t historyLimit_;
        std::mutex mutex_;
    };
}
