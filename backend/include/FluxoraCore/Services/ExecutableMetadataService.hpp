#pragma once

#include <filesystem>
#include <string>

namespace fluxora
{
    enum class ExecutableDisplayNameSource
    {
        FileDescription,
        ProductName,
        FileName
    };

    struct ExecutableMetadataInspection
    {
        std::filesystem::path executablePath;
        std::wstring suggestedDisplayName;
        ExecutableDisplayNameSource displayNameSource{ExecutableDisplayNameSource::FileName};
    };

    class ExecutableMetadataService final
    {
    public:
        [[nodiscard]] ExecutableMetadataInspection inspect(
            const std::filesystem::path& executablePath) const;
    };
}
