#include "FluxoraCore/Services/VfsMountPlan.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"

#include <algorithm>
#include <cwctype>
#include <utility>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        std::string toUtf8(const std::wstring& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }
            const int size = WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
            std::string out(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
            return out;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        std::wstring toLower(std::wstring value)
        {
            std::transform(
                value.begin(),
                value.end(),
                value.begin(),
                [](wchar_t character) { return static_cast<wchar_t>(std::towlower(character)); });
            return value;
        }

        bool equalsIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
            return toLower(std::wstring(left)) == toLower(std::wstring(right));
        }

        void appendUniqueIgnoreCase(std::vector<std::wstring>& values, std::wstring value)
        {
            if (value.empty() || std::find_if(
                    values.begin(),
                    values.end(),
                    [&value](const std::wstring& candidate)
                    {
                        return equalsIgnoreCase(candidate, value);
                    }) != values.end())
            {
                return;
            }
            values.push_back(std::move(value));
        }

        std::wstring fallbackSourceName(const std::filesystem::path& path)
        {
            const std::wstring name = path.filename().wstring();
            return name.empty() ? path.wstring() : name;
        }

        std::vector<VfsActiveMod> collectEnabledMods(
            const ProfileOrderService& profileOrder,
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName)
        {
            std::vector<VfsActiveMod> mods;
            for (const ProfileModOrderItem& item : profileOrder.listCachedLaunchModOrder(projectDirectory, profileName))
            {
                if (item.kind == L"mod" && item.isEnabled && !item.id.empty())
                {
                    mods.push_back(VfsActiveMod{
                        item.id,
                        item.name.empty() ? fallbackSourceName(item.id) : item.name,
                        item.contentFingerprint
                    });
                }
            }
            return mods;
        }

        std::vector<GameVfsMountRule> effectiveMountRules(const ContentLayoutSupportRules& contentRules)
        {
            if (!contentRules.mountRules.empty())
            {
                return contentRules.mountRules;
            }

            std::vector<GameVfsMountRule> rules;
            if (!contentRules.dataFolder.empty())
            {
                rules.push_back(GameVfsMountRule{
                    L"primary-content",
                    GameVfsMountTargetBase::GameDirectory,
                    contentRules.dataFolder,
                    GameVfsMountSourceKind::ActiveMods,
                    true,
                    true,
                    {contentRules.dataFolder},
                    {}
                });
            }
            if (contentRules.supportsRootFiles && !contentRules.rootFileWrapperDirectory.empty())
            {
                rules.push_back(GameVfsMountRule{
                    L"game-root",
                    GameVfsMountTargetBase::GameDirectory,
                    {},
                    GameVfsMountSourceKind::ActiveMods,
                    false,
                    false,
                    {contentRules.rootFileWrapperDirectory},
                    contentRules.rootFileWrapperDirectory
                });
            }
            return rules;
        }

        std::vector<std::wstring> structuralRootNames(const std::vector<GameVfsMountRule>& rules)
        {
            std::vector<std::wstring> names{L".flow"};
            for (const GameVfsMountRule& rule : rules)
            {
                for (const std::wstring& wrapper : rule.wrapperDirectories)
                {
                    appendUniqueIgnoreCase(names, wrapper);
                }
            }
            return names;
        }

        void appendSource(
            VfsMountDescriptor& mount,
            std::vector<std::filesystem::path>& legacyRoots,
            const VfsActiveMod& mod,
            const std::filesystem::path& root)
        {
            mount.mods.push_back(root);
            mount.modSources.push_back(VfsMountSourceRoot{root, mod.path, mod.name});
            legacyRoots.push_back(root);
        }

        VfsMountDescriptor buildActiveModsMount(
            const GameVfsMountRule& rule,
            const std::vector<GameVfsMountRule>& allRules,
            const std::vector<VfsActiveMod>& mods,
            const std::filesystem::path& gameDirectory,
            const std::filesystem::path& overwriteRoot,
            std::vector<std::filesystem::path>& legacyRoots)
        {
            VfsMountDescriptor mount;
            mount.target = rule.targetPath.empty()
                ? gameDirectory
                : gameDirectory / rule.targetPath;
            mount.overwrite = rule.overwritePath.empty()
                ? overwriteRoot
                : overwriteRoot / rule.overwritePath;
            mount.whiteoutRoot = overwriteRoot.parent_path() / L".flow" / L"vfs" /
                L"whiteouts" / rule.id;
            mount.excludedRootNames = rule.includeUnwrappedModRoot
                ? structuralRootNames(allRules)
                : std::vector<std::wstring>{L".flow"};

            // Preserve load order across mods while giving explicit wrappers
            // priority over an unpackaged root inside the same mod.
            for (const VfsActiveMod& mod : mods)
            {
                if (rule.includeUnwrappedModRoot)
                {
                    appendSource(mount, legacyRoots, mod, mod.path);
                }
                for (const std::wstring& wrapper : rule.wrapperDirectories)
                {
                    const std::filesystem::path wrapperRoot = mod.path / wrapper;
                    std::error_code error;
                    if (std::filesystem::is_directory(wrapperRoot, error) && !error)
                    {
                        appendSource(mount, legacyRoots, mod, wrapperRoot);
                    }
                }
            }
            return mount;
        }
    }

    bool vfsDirectoryHasEntries(const std::filesystem::path& path)
    {
        std::error_code error;
        if (!std::filesystem::exists(path, error) || !std::filesystem::is_directory(path, error))
        {
            return false;
        }
        std::filesystem::directory_iterator iterator(
            path,
            std::filesystem::directory_options::skip_permission_denied,
            error);
        return !error && iterator != std::filesystem::directory_iterator{};
    }

    std::wstring vfsNormalizedPathForComparison(const std::filesystem::path& path)
    {
        std::wstring value = std::filesystem::absolute(path).lexically_normal().wstring();
        while (value.size() > 1 && (value.back() == L'\\' || value.back() == L'/'))
        {
            value.pop_back();
        }
        return toLower(value);
    }

    VfsGameRootMountPlan buildVfsGameRootMountPlan(
        Logger& logger,
        std::vector<VfsActiveMod> activeMods,
        const BuildPathSettingsService& pathSettings,
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& gameDirectory,
        std::wstring_view profileName,
        const CapabilitySet& capabilities,
        const VfsSupportRules& vfsRules,
        const ContentLayoutSupportRules& contentRules)
    {
        VfsGameRootMountPlan plan;
        plan.activeMods = std::move(activeMods);
        plan.rootBuilderDirectoryName = vfsRules.rules.rootBuilderDirectoryName;
        plan.rootBuilderEnabled =
            vfsRules.rules.supportsRootBuilder &&
            !plan.rootBuilderDirectoryName.empty() &&
            capabilities.has(GameCapability::RootFiles);

        const std::vector<GameVfsMountRule> rules = effectiveMountRules(contentRules);
        const std::filesystem::path overwrite = pathSettings.overwriteDirectory(projectDirectory);
        for (const GameVfsMountRule& rule : rules)
        {
            if (rule.sourceKind != GameVfsMountSourceKind::ActiveMods ||
                rule.targetBase != GameVfsMountTargetBase::GameDirectory)
            {
                continue;
            }
            if (!rule.primaryContentRoot && rule.targetPath.empty() &&
                !capabilities.has(GameCapability::RootFiles))
            {
                continue;
            }

            std::vector<std::filesystem::path>& legacyRoots = rule.primaryContentRoot
                ? plan.dataMods
                : plan.rootMods;
            VfsMountDescriptor mount = buildActiveModsMount(
                rule,
                rules,
                plan.activeMods,
                gameDirectory,
                overwrite,
                legacyRoots);
            if (rule.primaryContentRoot)
            {
                plan.dataDirectory = rule.targetPath.wstring();
            }
            if (!mount.mods.empty() || vfsDirectoryHasEntries(mount.overwrite))
            {
                plan.mounts.push_back(std::move(mount));
            }
        }

        const std::wstring profile = profileName.empty() ? L"Default" : std::wstring(profileName);
        logger.write(
            LogLevel::Info,
            "VFS declarative mount plan prepared: profile=\"" + toUtf8(profile) +
                "\", activeMods=" + std::to_string(plan.activeMods.size()) +
                ", contentSources=" + std::to_string(plan.dataMods.size()) +
                ", rootSources=" + std::to_string(plan.rootMods.size()) +
                ", mounts=" + std::to_string(plan.mounts.size()) + ".");
        return plan;
    }

    VfsGameRootMountPlan buildVfsGameRootMountPlan(
        Logger& logger,
        const ProfileOrderService& profileOrder,
        const BuildPathSettingsService& pathSettings,
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& gameDirectory,
        std::wstring_view profileName,
        const CapabilitySet& capabilities,
        const VfsSupportRules& vfsRules,
        const ContentLayoutSupportRules& contentRules)
    {
        const std::wstring profile = profileName.empty() ? L"Default" : std::wstring(profileName);
        return buildVfsGameRootMountPlan(
            logger,
            collectEnabledMods(profileOrder, projectDirectory, profile),
            pathSettings,
            projectDirectory,
            gameDirectory,
            profile,
            capabilities,
            vfsRules,
            contentRules);
    }
}
