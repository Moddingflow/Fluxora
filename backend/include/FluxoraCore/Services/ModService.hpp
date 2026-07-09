#pragma once

#include "FluxoraCore/Services/IService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace fluxora
{
    class AppSettingsService;
    class BuildPathSettingsService;
    class Logger;

    struct ModDescriptor
    {
        std::string id;
        std::string name;
        std::string version;
        bool enabled{false};
    };

    struct InstalledModEntry
    {
        std::filesystem::path id;
        std::wstring name;
        std::wstring version;
        std::wstring installedAt;
        std::wstring updatedAt;
        std::wstring latestVersion;
        std::wstring lastCheckedAt;
        std::wstring updateStatus;
        std::wstring conflictStatus;
        int fileCount{0};
        int conflictingFileCount{0};
        int overwrittenFileCount{0};
        int overwritingFileCount{0};
        bool isEnabled{true};
        bool canCheckUpdates{false};
        bool hasUpdate{false};
        bool sourceIsNexus{false};
        bool sourceIsModdingFlow{false};
        bool isLocal{false};
        bool isTranslation{false};
        bool isPatch{false};
        std::wstring sourceProvider;
        std::wstring sourceGameDomain;
        std::wstring sourceModId;
        std::wstring sourceFileId;
        std::wstring sourceUrl;
        std::vector<std::wstring> overwritesModIds;
        std::vector<std::wstring> overwrittenByModIds;
    };

    struct ModTextFileDocument
    {
        std::filesystem::path path;
        std::wstring relativePath;
        std::wstring fileName;
        std::wstring content;
        std::uintmax_t size{0};
    };

    struct ModTextFileSaveResult
    {
        std::filesystem::path path;
        std::wstring relativePath;
        std::wstring fileName;
        std::uintmax_t size{0};
    };

    struct ModTextFilePreview
    {
        std::filesystem::path path;
        std::wstring relativePath;
        std::wstring fileName;
        std::wstring contentPreview;
        std::uintmax_t bytesRead{0};
        std::uintmax_t size{0};
        bool truncated{false};
    };

    struct ModPreviewVariant
    {
        std::filesystem::path modPath;
        std::wstring modName;
        int order{0};
        bool enabled{false};
        std::wstring relativePath;
        std::uintmax_t size{0};
    };

    struct ModPreviewAsset
    {
        std::wstring kind;
        std::filesystem::path sourceModPath;
        std::wstring sourceModName;
        std::wstring relativePath;
        std::wstring fileName;
        std::uintmax_t size{0};
        std::vector<std::uint8_t> bytes;
    };

    class ModService final : public IService
    {
    public:
        ModService(
            Logger& logger,
            AppSettingsService& settings,
            const BuildPathSettingsService& pathSettings) noexcept;

        void initialize() override;
        void shutdown() override;

        void registerMod(ModDescriptor descriptor);

        [[nodiscard]] const std::vector<ModDescriptor>& mods() const noexcept;
        [[nodiscard]] std::vector<InstalledModEntry> listInstalledMods(
            const std::filesystem::path& projectDirectory) const;
        [[nodiscard]] std::vector<InstalledModEntry> checkInstalledModUpdates(
            const std::filesystem::path& projectDirectory) const;
        [[nodiscard]] std::vector<ModFileTreeEntry> listModFileTree(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            std::wstring_view relativeDirectory) const;
        [[nodiscard]] ModConflictTreePage listModConflictTree(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            std::wstring_view cursor,
            int limit) const;
        [[nodiscard]] ModTextFileDocument readModTextFile(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            std::wstring_view relativePath) const;
        [[nodiscard]] ModTextFilePreview previewModTextFile(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            std::wstring_view relativePath,
            std::uintmax_t maxBytes) const;
        [[nodiscard]] ModTextFileSaveResult saveModTextFile(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            std::wstring_view relativePath,
            std::wstring_view content) const;
        [[nodiscard]] std::vector<ModPreviewVariant> listPreviewVariants(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            std::wstring_view relativePath) const;
        [[nodiscard]] ModPreviewAsset readPreviewAsset(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& modPath,
            std::wstring_view relativePath,
            std::wstring_view kind) const;
        [[nodiscard]] InstalledModEntry createEmptyMod(
            const std::filesystem::path& projectDirectory,
            std::wstring_view modName) const;
        void deleteInstalledMod(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath) const;
        void setInstalledModEnabled(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            bool isEnabled) const;
        void setAllInstalledModsEnabled(
            const std::filesystem::path& projectDirectory,
            bool isEnabled) const;
        void clearOverwriteFolder(
            const std::filesystem::path& projectDirectory) const;
        [[nodiscard]] bool isInitialized() const noexcept;

    private:
        Logger& logger_;
        AppSettingsService& settings_;
        const BuildPathSettingsService& pathSettings_;
        std::vector<ModDescriptor> mods_;
        bool initialized_{false};
    };
}
