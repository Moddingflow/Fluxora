#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    class BuildPathSettingsService;
    class Logger;

    struct ModPreviewVariant
    {
        std::filesystem::path modPath;
        std::wstring modName;
        int order{0};
        bool enabled{false};
        std::wstring relativePath;
        std::uintmax_t size{0};
    };

    struct NifPreviewPreparedAsset
    {
        std::filesystem::path resolvedPath;
        std::wstring kind;
        std::wstring relativePath;
        std::wstring fileName;
        std::wstring mimeType;
        std::wstring source;
        std::wstring contentKey;
        std::uintmax_t size{0};
    };

    struct NifPreviewStartResult
    {
        std::vector<ModPreviewVariant> variants;
        int activeIndex{0};
        NifPreviewPreparedAsset model;
    };

    struct NifPreviewTextureBatchResult
    {
        std::vector<NifPreviewPreparedAsset> assets;
        std::vector<std::wstring> missing;
        std::uintmax_t totalBytes{0};
        std::uint64_t archiveIndexHits{0};
        std::uint64_t archiveIndexMisses{0};
        std::uint64_t archiveAssetCacheHits{0};
        std::uint64_t archiveAssetCacheMisses{0};
    };

    class NifPreviewResolver final
    {
    public:
        NifPreviewResolver(
            Logger& logger,
            const BuildPathSettingsService& pathSettings) noexcept;

        [[nodiscard]] std::vector<ModPreviewVariant> listVariants(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            std::wstring_view relativePath) const;
        [[nodiscard]] NifPreviewStartResult start(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& activeModPath,
            std::wstring_view relativePath) const;
        [[nodiscard]] NifPreviewPreparedAsset prepareVariant(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& modPath,
            std::wstring_view relativePath) const;
        [[nodiscard]] NifPreviewTextureBatchResult prepareTextures(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& modelModPath,
            const std::vector<std::wstring>& texturePaths) const;

    private:
        Logger& logger_;
        const BuildPathSettingsService& pathSettings_;
    };
}
