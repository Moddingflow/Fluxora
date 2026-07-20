#pragma once

#include "FluxoraCore/Services/ModUpdateService.hpp"

#include <optional>
#include <string>
#include <vector>

namespace fluxora
{
    struct NexusDownloadFileVersion
    {
        std::wstring id;
        std::wstring gameDomain;
        std::wstring modId;
        std::wstring fileId;
        std::wstring fileName;
        std::wstring version;
        std::wstring sha256;
    };

    enum class NexusDownloadDuplicateKind
    {
        None,
        SameFile,
        Upgrade,
        Downgrade,
        Mixed
    };

    struct NexusDownloadDuplicateResolution
    {
        NexusDownloadDuplicateKind kind{NexusDownloadDuplicateKind::None};
        std::optional<NexusDownloadFileVersion> sameFile;
        std::vector<NexusDownloadFileVersion> existingFiles;
        std::vector<std::wstring> lineageFileIds;
    };

    class NexusDownloadDuplicateResolver final
    {
    public:
        [[nodiscard]] NexusDownloadDuplicateResolution resolve(
            const NexusDownloadFileVersion& incoming,
            const std::vector<NexusDownloadFileVersion>& existingFiles,
            const std::vector<NexusFileUpdateLink>& updates) const;
    };
}
