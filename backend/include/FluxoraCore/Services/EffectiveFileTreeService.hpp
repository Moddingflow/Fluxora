#pragma once

#include "FluxoraCore/Services/IService.hpp"

#include <cstdint>
#include <filesystem>
#include <map>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    class BuildPathSettingsService;
    class Logger;
    class ProfileOrderService;

    struct EffectiveFileTreeEntry
    {
        std::wstring name;
        std::wstring relativePath;
        std::wstring parentPath;
        bool isDirectory{false};
        bool hasChildren{false};
        std::uintmax_t size{0};
        std::wstring virtualPath;
        std::wstring sourceKind;
        std::wstring sourceName;
        std::filesystem::path sourcePath;
    };

    struct EffectiveFileTreeSnapshot
    {
        std::wstring profileName;
        std::wstring revision;
        std::uintmax_t totalFileCount{0};
        bool totalFileCountKnown{true};
        std::vector<EffectiveFileTreeEntry> entries;
    };

    struct EffectiveFileTreePage
    {
        std::wstring profileName;
        std::wstring revision;
        std::wstring parentPath;
        std::uintmax_t totalFileCount{0};
        bool totalFileCountKnown{true};
        int totalChildCount{0};
        int limit{0};
        std::wstring nextCursor;
        std::vector<EffectiveFileTreeEntry> entries;
    };

    struct EffectiveFileTreeIndexWarmupResult
    {
        std::wstring profileName;
        std::wstring revision;
        std::uintmax_t totalFileCount{0};
        int totalEntryCount{0};
        bool cacheHit{false};
    };

    class EffectiveFileTreeService final : public IService
    {
    public:
        EffectiveFileTreeService(
            Logger& logger,
            ProfileOrderService& profileOrder,
            const BuildPathSettingsService& pathSettings) noexcept;

        void initialize() override;
        void shutdown() override;

        [[nodiscard]] EffectiveFileTreeSnapshot snapshot(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName) const;

        [[nodiscard]] EffectiveFileTreeIndexWarmupResult prepareWorkspaceIndexes(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName) const;

        [[nodiscard]] EffectiveFileTreePage root(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            int limit) const;

        [[nodiscard]] EffectiveFileTreePage children(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            std::wstring_view expectedRevision,
            std::wstring_view relativeDirectory,
            std::wstring_view cursor,
            int limit) const;

        [[nodiscard]] bool isInitialized() const noexcept;

    private:
        [[nodiscard]] EffectiveFileTreeSnapshot snapshotInternal(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            bool* cacheHit) const;

        Logger& logger_;
        ProfileOrderService& profileOrder_;
        const BuildPathSettingsService& pathSettings_;
        mutable std::mutex cacheMutex_;
        mutable std::map<std::wstring, EffectiveFileTreeSnapshot> cache_;
        bool initialized_{false};
    };
}
