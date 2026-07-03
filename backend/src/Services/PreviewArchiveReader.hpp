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

    [[nodiscard]] std::optional<PreviewArchiveAsset> readPreviewAssetFromBethesdaArchives(
        const std::filesystem::path& rootDirectory,
        std::wstring_view relativePath);
}
