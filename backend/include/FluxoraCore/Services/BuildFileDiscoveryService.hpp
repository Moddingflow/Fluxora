#pragma once

#include "FluxoraCore/Services/BuildFileWorkspaceService.hpp"

#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    struct BuildFileDiscoveryRoot
    {
        BuildFileScope scope{BuildFileScope::Build};
        std::filesystem::path path;
        std::wstring fixedOwnerMod;
        bool contentsAreVirtualRoot{false};
        bool alwaysWins{false};
    };

    struct BuildFileDiscoveryHit
    {
        BuildFileScope scope{BuildFileScope::Build};
        std::filesystem::path root;
        std::filesystem::path path;
        std::wstring virtualPath;
        std::wstring ownerMod;
        std::wstring effectiveOwner;
        std::vector<std::wstring> conflictingOwners;
        double confidence{0.0};
        std::vector<std::wstring> matchReasons;
        bool effectiveWinner{false};
    };

    struct BuildFileDiscoveryScan
    {
        std::vector<BuildFileDiscoveryHit> hits;
        BuildFileDiscoveryStatistics statistics;
        std::wstring revision;
        bool complete{false};
        bool cancelled{false};
    };

    class BuildFileDiscoveryService final
    {
    public:
        [[nodiscard]] BuildFileDiscoveryScan discover(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::vector<BuildFileDiscoveryRoot>& roots,
            const BuildFileDiscoveryRequest& request) const;
    };
}
