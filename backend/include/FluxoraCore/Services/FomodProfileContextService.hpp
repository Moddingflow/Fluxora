#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace fluxora
{
    enum class FomodProfileFileStateKind
    {
        Active,
        Inactive,
        Missing
    };

    struct FomodProfileFileState
    {
        std::wstring file;
        FomodProfileFileStateKind state{FomodProfileFileStateKind::Missing};
        std::wstring sourceKind;
        std::wstring sourceName;
        // Kept for compatibility with the original FOMOD descriptor contract.
        bool exists{false};
    };

    struct FomodDetectedVersion
    {
        std::wstring kind;
        std::wstring displayName;
        std::wstring version;
        bool known{false};
    };

    struct FomodProfileContext
    {
        std::wstring contextId;
        std::wstring profileName;
        std::wstring fingerprint;
        std::uint64_t modCatalogRevision{0};
        std::wstring modRevision;
        std::wstring pluginRevision;
        bool autoSelectionAvailable{false};
        std::wstring unavailableReason;
        FomodDetectedVersion gameVersion;
        std::vector<FomodDetectedVersion> extenderVersions;
        std::vector<std::wstring> basePluginNames;
        std::vector<FomodProfileFileState> fileStates;
    };

    struct FomodProfileContextRequest
    {
        std::filesystem::path projectDirectory;
        std::filesystem::path gameDirectory;
        std::filesystem::path modsDirectory;
        std::filesystem::path profilesDirectory;
        std::wstring profileName;
        std::vector<std::wstring> gameDataFolders;
        std::vector<std::wstring> referencedFiles;
    };

    class FomodProfileContextService final
    {
    public:
        FomodProfileContextService() = delete;

        [[nodiscard]] static FomodProfileContext build(
            const FomodProfileContextRequest& request);

        [[nodiscard]] static std::wstring stateName(FomodProfileFileStateKind state);
    };
}
