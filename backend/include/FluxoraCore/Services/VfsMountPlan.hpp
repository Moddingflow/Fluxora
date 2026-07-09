#pragma once

#include "FluxoraCore/GameSupport/IGameSupport.hpp"

#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    class BuildPathSettingsService;
    class Logger;
    class ProfileOrderService;

    struct VfsActiveMod
    {
        std::filesystem::path path;
        std::wstring name;
        std::wstring contentFingerprint;
    };

    struct VfsMountSourceRoot
    {
        std::filesystem::path root;
        std::filesystem::path modPath;
        std::wstring sourceName;
    };

    struct VfsMountDescriptor
    {
        std::filesystem::path target;
        std::filesystem::path overwrite;
        std::vector<std::filesystem::path> mods;
        std::vector<std::wstring> excludedRootNames;
        std::vector<VfsMountSourceRoot> modSources;
    };

    struct VfsGameRootMountPlan
    {
        std::vector<VfsMountDescriptor> mounts;
        std::vector<VfsActiveMod> activeMods;
        std::vector<std::filesystem::path> dataMods;
        std::vector<std::filesystem::path> rootMods;
        std::wstring dataDirectory;
        std::wstring rootBuilderDirectoryName;
        bool rootBuilderEnabled{false};
    };

    [[nodiscard]] bool vfsDirectoryHasEntries(const std::filesystem::path& path);
    [[nodiscard]] std::wstring vfsNormalizedPathForComparison(const std::filesystem::path& path);

    [[nodiscard]] VfsGameRootMountPlan buildVfsGameRootMountPlan(
        Logger& logger,
        const ProfileOrderService& profileOrder,
        const BuildPathSettingsService& pathSettings,
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& gameDirectory,
        std::wstring_view profileName,
        const CapabilitySet& capabilities,
        const VfsSupportRules& vfsRules,
        const ContentLayoutSupportRules& contentRules);
}
