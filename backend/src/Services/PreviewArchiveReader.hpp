#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace fluxora
{
    struct PreviewArchiveAsset
    {
        std::filesystem::path archivePath;
        std::wstring archiveDisplayName;
        std::vector<std::uint8_t> bytes;
    };

    struct PreparedPreviewArchiveAsset
    {
        std::filesystem::path resolvedPath;
        std::filesystem::path archivePath;
        std::wstring archiveDisplayName;
        std::wstring relativePath;
        std::wstring contentKey;
        std::uintmax_t size{0};
    };

    struct PreviewArchiveBatchResult
    {
        std::vector<PreparedPreviewArchiveAsset> assets;
        std::uint64_t indexHits{0};
        std::uint64_t indexMisses{0};
        std::uint64_t assetCacheHits{0};
        std::uint64_t assetCacheMisses{0};
    };

    [[nodiscard]] std::optional<PreviewArchiveAsset> readPreviewAssetFromBethesdaArchives(
        const std::filesystem::path& rootDirectory,
        std::wstring_view relativePath);

    [[nodiscard]] PreviewArchiveBatchResult preparePreviewAssetsFromBethesdaArchives(
        const std::filesystem::path& rootDirectory,
        const std::vector<std::wstring>& relativePaths,
        const std::filesystem::path& cacheDirectory);

    void enforcePreviewArchiveCacheLimit(
        const std::filesystem::path& cacheDirectory,
        std::uintmax_t maxBytes);
}
