#pragma once

#include "FluxoraCore/Services/ModUpdateService.hpp"

#include <map>
#include <set>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    enum class NexusFileLineageKind
    {
        SameFile,
        SameLineage,
        UnprovenOrDifferentBranch
    };

    struct NexusFileLineageResolution
    {
        NexusFileLineageKind kind{NexusFileLineageKind::UnprovenOrDifferentBranch};
        std::vector<std::wstring> fileIds;
    };

    class NexusFileLineageResolver final
    {
    public:
        explicit NexusFileLineageResolver(
            const std::vector<NexusFileUpdateLink>& updates);

        [[nodiscard]] NexusFileLineageResolution resolve(
            std::wstring_view leftFileId,
            std::wstring_view rightFileId) const;

        [[nodiscard]] NexusFileLineageResolution forwardFrom(
            std::wstring_view fileId) const;

    private:
        [[nodiscard]] NexusFileLineageResolution componentFor(
            std::wstring_view fileId) const;

        std::map<std::wstring, std::set<std::wstring>> successors_;
        std::map<std::wstring, std::set<std::wstring>> predecessors_;
    };
}
