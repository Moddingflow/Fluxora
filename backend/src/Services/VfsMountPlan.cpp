#include "FluxoraCore/Services/VfsMountPlan.hpp"

#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"
#include "FluxoraCore/Services/VfsContentPlacementAnalyzer.hpp"

#include <algorithm>
#include <cwctype>
#include <map>
#include <mutex>

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

        struct VfsContentPlacementCacheEntry
        {
            std::wstring contentFingerprint;
            VfsContentPlacementRoots roots;
        };

        std::mutex& vfsContentPlacementCacheMutex()
        {
            static std::mutex mutex;
            return mutex;
        }

        std::map<std::wstring, VfsContentPlacementCacheEntry>& vfsContentPlacementCache()
        {
            static std::map<std::wstring, VfsContentPlacementCacheEntry> cache;
            return cache;
        }

        VfsContentPlacementRoots analyzeVfsContentPlacement(
            const VfsActiveMod& mod,
            const VfsContentPlacementAnalyzer& placementAnalyzer,
            const ContentLayoutSupportRules& contentRules,
            const std::wstring& dataDirectory,
            const std::wstring& rootBuilderDirectoryName,
            Logger& logger)
        {
            const std::wstring cacheKey = vfsNormalizedPathForComparison(mod.path);
            if (!cacheKey.empty() && !mod.contentFingerprint.empty())
            {
                std::lock_guard lock(vfsContentPlacementCacheMutex());
                const auto cached = vfsContentPlacementCache().find(cacheKey);
                if (cached != vfsContentPlacementCache().end() &&
                    cached->second.contentFingerprint == mod.contentFingerprint)
                {
                    return cached->second.roots;
                }
            }

            const VfsContentPlacementRoots roots = placementAnalyzer.analyze(
                mod.path,
                contentRules,
                dataDirectory,
                rootBuilderDirectoryName,
                &logger);

            if (!cacheKey.empty() && !mod.contentFingerprint.empty())
            {
                std::lock_guard lock(vfsContentPlacementCacheMutex());
                vfsContentPlacementCache()[cacheKey] =
                    VfsContentPlacementCacheEntry{mod.contentFingerprint, roots};
            }

            return roots;
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
            for (const ProfileModOrderItem& item : profileOrder.listCachedModOrder(projectDirectory, profileName))
            {
                const bool isFullyOverwritten =
                    item.fileCount > 0 &&
                    item.overwrittenFileCount >= item.fileCount;
                if (item.kind == L"mod" && item.isEnabled && !item.id.empty() && !isFullyOverwritten)
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

        void appendMountSource(
            std::vector<std::filesystem::path>& mountRoots,
            std::vector<VfsMountSourceRoot>& sources,
            const VfsActiveMod& mod,
            const std::filesystem::path& root)
        {
            mountRoots.push_back(root);
            sources.push_back(VfsMountSourceRoot{root, mod.path, mod.name});
        }

        std::vector<VfsMountSourceRoot> collectRootBuilderSources(
            const std::vector<VfsActiveMod>& mods,
            const std::vector<VfsContentPlacementRoots>& placements,
            const std::wstring& rootBuilderDirectoryName,
            std::vector<std::filesystem::path>& rootMods)
        {
            std::vector<VfsMountSourceRoot> sources;
            rootMods.reserve(mods.size());
            sources.reserve(mods.size());
            for (std::size_t index = 0; index < mods.size(); ++index)
            {
                if (index >= placements.size() || !placements[index].rootBuilderRoot)
                {
                    continue;
                }

                appendMountSource(rootMods, sources, mods[index], mods[index].path / rootBuilderDirectoryName);
            }

            return sources;
        }

        std::vector<VfsMountSourceRoot> collectDataMountSources(
            const std::vector<VfsActiveMod>& mods,
            const std::vector<VfsContentPlacementRoots>& placements,
            const std::wstring& dataDirectory,
            bool rootBuilderEnabled,
            const std::wstring& rootBuilderDirectoryName,
            std::vector<std::filesystem::path>& dataMods)
        {
            std::vector<VfsMountSourceRoot> sources;
            dataMods.reserve(rootBuilderEnabled ? mods.size() * 2 : mods.size());
            sources.reserve(dataMods.capacity());
            for (std::size_t index = 0; index < mods.size(); ++index)
            {
                if (index >= placements.size())
                {
                    continue;
                }

                const VfsActiveMod& mod = mods[index];
                const VfsContentPlacementRoots& placement = placements[index];
                if (placement.dataAtModRoot)
                {
                    appendMountSource(dataMods, sources, mod, mod.path);
                }

                const std::filesystem::path nestedData = mod.path / dataDirectory;
                if (placement.dataWrapper)
                {
                    appendMountSource(dataMods, sources, mod, nestedData);
                }

                if (!rootBuilderEnabled)
                {
                    continue;
                }

                const std::filesystem::path rootData =
                    mod.path / rootBuilderDirectoryName / dataDirectory;
                if (placement.rootBuilderData)
                {
                    appendMountSource(dataMods, sources, mod, rootData);
                }
            }

            return sources;
        }

        std::vector<std::wstring> dataMountExcludedRootNames(
            const std::wstring& dataDirectory,
            bool rootBuilderEnabled,
            const std::wstring& rootBuilderDirectoryName)
        {
            std::vector<std::wstring> names;
            if (!dataDirectory.empty())
            {
                names.push_back(dataDirectory);
            }
            if (rootBuilderEnabled &&
                !rootBuilderDirectoryName.empty() &&
                !equalsIgnoreCase(dataDirectory, rootBuilderDirectoryName))
            {
                names.push_back(rootBuilderDirectoryName);
            }
            return names;
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
        const ProfileOrderService& profileOrder,
        const BuildPathSettingsService& pathSettings,
        const std::filesystem::path& projectDirectory,
        const std::filesystem::path& gameDirectory,
        std::wstring_view profileName,
        const CapabilitySet& capabilities,
        const VfsSupportRules& vfsRules,
        const ContentLayoutSupportRules& contentRules)
    {
        const GameVfsRules& rules = vfsRules.rules;
        VfsGameRootMountPlan plan;
        plan.dataDirectory = contentRules.dataFolder;
        plan.rootBuilderDirectoryName = rules.rootBuilderDirectoryName;
        plan.rootBuilderEnabled =
            rules.supportsRootBuilder &&
            !plan.rootBuilderDirectoryName.empty() &&
            contentRules.supportsRootFiles &&
            capabilities.has(GameCapability::RootFiles);

        const std::wstring profile = profileName.empty()
            ? std::wstring(L"Default")
            : std::wstring(profileName);
        plan.activeMods = collectEnabledMods(profileOrder, projectDirectory, profile);

        const VfsContentPlacementAnalyzer placementAnalyzer;
        std::vector<VfsContentPlacementRoots> placements;
        placements.reserve(plan.activeMods.size());
        for (const VfsActiveMod& mod : plan.activeMods)
        {
            placements.push_back(analyzeVfsContentPlacement(
                mod,
                placementAnalyzer,
                contentRules,
                plan.dataDirectory,
                plan.rootBuilderDirectoryName,
                logger));
        }

        const std::filesystem::path overwrite = pathSettings.overwriteDirectory(projectDirectory);
        const std::filesystem::path dataTarget = gameDirectory / plan.dataDirectory;
        std::vector<VfsMountSourceRoot> dataSources = collectDataMountSources(
            plan.activeMods,
            placements,
            plan.dataDirectory,
            plan.rootBuilderEnabled,
            plan.rootBuilderDirectoryName,
            plan.dataMods);

        if (!plan.dataMods.empty() || vfsDirectoryHasEntries(overwrite))
        {
            plan.mounts.push_back(VfsMountDescriptor{
                dataTarget,
                overwrite,
                plan.dataMods,
                dataMountExcludedRootNames(
                    plan.dataDirectory,
                    plan.rootBuilderEnabled,
                    plan.rootBuilderDirectoryName),
                std::move(dataSources)
            });
        }

        if (plan.rootBuilderEnabled)
        {
            std::vector<VfsMountSourceRoot> rootSources = collectRootBuilderSources(
                plan.activeMods,
                placements,
                plan.rootBuilderDirectoryName,
                plan.rootMods);
            const std::filesystem::path rootOverwrite = overwrite / plan.rootBuilderDirectoryName;
            if (!plan.rootMods.empty() || vfsDirectoryHasEntries(rootOverwrite))
            {
                plan.mounts.push_back(VfsMountDescriptor{
                    gameDirectory,
                    rootOverwrite,
                    plan.rootMods,
                    {plan.dataDirectory},
                    std::move(rootSources)
                });
            }
        }

        logger.write(
            LogLevel::Info,
            "VFS game-root mount plan prepared: profile=\"" + toUtf8(profile) +
                "\", activeMods=" + std::to_string(plan.activeMods.size()) +
                ", dataMods=" + std::to_string(plan.dataMods.size()) +
                ", rootMods=" + std::to_string(plan.rootMods.size()) +
                ", mounts=" + std::to_string(plan.mounts.size()) + ".");
        return plan;
    }
}
