#pragma once

#include "FluxoraCore/Services/ModUpdateService.hpp"

#include <filesystem>
#include <optional>
#include <string_view>

namespace fluxora
{
    class NexusUpdateCache final
    {
    public:
        explicit NexusUpdateCache(std::filesystem::path path = {});

        [[nodiscard]] const std::filesystem::path& path() const noexcept;

        [[nodiscard]] std::optional<NexusModFilesResponse> loadModFiles(
            std::wstring_view gameDomain,
            std::wstring_view modId,
            std::wstring_view notOlderThan,
            std::wstring_view usedAt) const;

        void storeModFiles(
            std::wstring_view gameDomain,
            std::wstring_view modId,
            const NexusModFilesResponse& response,
            std::wstring_view fetchedAt) const;

        [[nodiscard]] std::optional<NexusRecentUpdatesResponse> loadRecentUpdates(
            std::wstring_view gameDomain,
            std::wstring_view period,
            std::wstring_view notOlderThan,
            std::wstring_view usedAt) const;

        void storeRecentUpdates(
            std::wstring_view gameDomain,
            std::wstring_view period,
            const NexusRecentUpdatesResponse& response,
            std::wstring_view fetchedAt) const;

        [[nodiscard]] std::optional<NexusQuotaSnapshot> loadQuota() const;
        void storeQuota(const NexusQuotaSnapshot& quota) const;
        void pruneUnusedBefore(std::wstring_view cutoff) const;

    private:
        std::filesystem::path path_;
    };
}
