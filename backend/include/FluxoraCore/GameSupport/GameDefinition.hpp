#pragma once

#include "FluxoraCore/GameSupport/GameTypes.hpp"

#include <cstdint>
#include <filesystem>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    using ExternalProviderGameSlugMap =
        std::map<std::wstring, std::vector<std::wstring>>;

    [[nodiscard]] bool isCanonicalExternalProviderId(
        std::wstring_view value) noexcept;
    [[nodiscard]] bool isCanonicalExternalGameSlug(
        std::wstring_view value) noexcept;
    void validateExternalProviderGameSlugs(
        const ExternalProviderGameSlugMap& mappings);

    enum class GameExecutableRole
    {
        Primary,
        Launcher,
        ScriptExtender
    };

    struct GameExecutableDefinition
    {
        std::wstring id;
        std::wstring displayName;
        ExecutableName name;
        GameExecutableRole role{GameExecutableRole::Primary};
        std::optional<GameExecutableWorkingDirectoryKind> workingDirectory;
    };

    struct GameExecutableRoles
    {
        std::optional<ExecutableName> primary;
        std::optional<ExecutableName> launcher;
        std::optional<ExecutableName> scriptExtender;
    };

    struct GameDetectionHints
    {
        std::vector<ExecutableName> executableNames;
        std::vector<std::wstring> folderNames;
        std::vector<std::wstring> domains;
    };

    enum class GameInstallDiscoveryProviderId
    {
        Fluxora,
        Steam,
        Gog,
        Epic,
        Windows
    };

    [[nodiscard]] std::optional<GameInstallDiscoveryProviderId>
        parseGameInstallDiscoveryProviderId(std::wstring_view value) noexcept;
    [[nodiscard]] std::wstring_view gameInstallDiscoveryProviderIdName(
        GameInstallDiscoveryProviderId value) noexcept;
    [[nodiscard]] bool isCanonicalGameInstallProductId(
        std::wstring_view value) noexcept;

    struct GameInstallDiscoveryProviderDefinition
    {
        GameInstallDiscoveryProviderId id{GameInstallDiscoveryProviderId::Fluxora};
        std::vector<std::wstring> productIds;
    };

    struct GameInstallDiscoveryRules
    {
        std::vector<GameInstallDiscoveryProviderDefinition> providers;
    };

    struct GamePluginRules
    {
        std::vector<std::wstring> profileFiles;
        std::vector<std::wstring> basePlugins;
    };

    enum class GameVfsMountTargetBase
    {
        GameDirectory,
        Documents,
        LocalAppData,
        RoamingAppData
    };

    enum class GameVfsMountSourceKind
    {
        ActiveMods,
        ProfileSettings,
        ProfileSaves
    };

    // Declarative mapping shared by content placement and VFS launch planning.
    // Game-specific paths belong in the definition, never in native C++ code.
    struct GameVfsMountRule
    {
        std::wstring id;
        GameVfsMountTargetBase targetBase{GameVfsMountTargetBase::GameDirectory};
        std::filesystem::path targetPath;
        GameVfsMountSourceKind sourceKind{GameVfsMountSourceKind::ActiveMods};
        bool primaryContentRoot{false};
        bool includeUnwrappedModRoot{false};
        std::vector<std::wstring> wrapperDirectories;
        std::filesystem::path overwritePath;
    };

    struct GameContentLayoutRules
    {
        std::wstring dataFolder;
        bool supportsRootFiles{false};
        std::wstring rootFileWrapperDirectory;
        std::vector<GameVfsMountRule> mountRules;
    };

    struct GameVfsRules
    {
        bool supportsRootBuilder{false};
        std::wstring rootBuilderDirectoryName;
        std::wstring userSettingsDirectoryName;
        std::vector<std::wstring> profileIniFileNames;
        std::vector<std::wstring> saveDirectoryNames;
        std::vector<std::wstring> materializedLaunchCacheDirectories;
        // Profile state files the manager owns end to end (plugins.txt,
        // loadorder.txt, ...). They are compiled from the plugin rules rather
        // than authored separately, and the VFS keeps them out of the writable
        // overwrite overlay so the profile copy stays the single source of
        // truth for both Fluxora and the game.
        std::vector<std::wstring> profileStateFileNames;
    };

    struct GameScriptExtenderRules
    {
        std::wstring name;
        ExecutableName loaderExecutable;
        std::wstring website;
        std::vector<ExecutableName> expectedChildProcessNames;
        std::wstring handoffDisplayName;
        std::uint32_t handoffTimeoutMs{0};
        LaunchTrackingKind launchTrackingKind{LaunchTrackingKind::DirectProcess};
    };

    struct GameLaunchRules
    {
        std::optional<GameScriptExtenderRules> scriptExtender;
    };

    struct GameHealthRules
    {
        std::vector<std::wstring> requiredFiles;
    };

    struct GameDefinition
    {
        std::wstring schemaVersion;
        std::wstring definitionVersion;
        GameId id;
        std::wstring displayName;
        std::wstring summary;
        std::vector<std::wstring> aliases;
        std::vector<std::wstring> domains;
        ExternalProviderGameSlugMap externalProviderGameSlugs;
        std::vector<std::wstring> installFolderAliases;
        GameInstallDiscoveryRules installDiscovery;
        std::wstring defaultProfileName;
        std::wstring dataFolder;
        std::vector<std::wstring> requiredFiles;
        std::vector<GameExecutableDefinition> executables;
        GameExecutableRoles executableRoles;
        std::vector<NormalizedExtension> archiveExtensions;
        std::vector<NormalizedExtension> pluginExtensions;
        CapabilitySet capabilities;
        UiTemplateId uiTemplateId;
        GameDetectionHints detectionHints;
        GamePluginRules pluginRules;
        GameContentLayoutRules contentLayoutRules;
        GameVfsRules vfsRules;
        GameLaunchRules launchRules;
        GameHealthRules healthRules;
    };
}
