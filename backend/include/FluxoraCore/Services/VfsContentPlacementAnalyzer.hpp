#pragma once

#include "FluxoraCore/GameSupport/IGameSupport.hpp"

#include <filesystem>
#include <string>

namespace fluxora
{
    class Logger;

    struct VfsContentPlacementRoots
    {
        bool dataAtModRoot{false};
        bool dataWrapper{false};
        bool rootBuilderData{false};
        bool rootBuilderRoot{false};
    };

    class VfsContentPlacementAnalyzer final
    {
    public:
        [[nodiscard]] VfsContentPlacementRoots analyze(
            const std::filesystem::path& mod,
            const ContentLayoutSupportRules& rules,
            const std::wstring& dataDirectory,
            const std::wstring& rootBuilderDirectoryName,
            Logger* logger = nullptr) const;
    };
}
