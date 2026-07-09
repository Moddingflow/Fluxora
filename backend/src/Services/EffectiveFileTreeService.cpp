#include "FluxoraCore/Services/EffectiveFileTreeService.hpp"

#include "FluxoraCore/GameSupport/GameDetectionService.hpp"
#include "FluxoraCore/GameSupport/GameSupportRegistry.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"
#include "FluxoraCore/Services/VfsMountPlan.hpp"

#include <algorithm>
#include <cwctype>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <utility>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        struct SourceMeta
        {
            std::wstring kind;
            std::wstring name;
            std::filesystem::path path;
        };

        struct TreeNode
        {
            std::wstring name;
            std::wstring relativePath;
            std::wstring parentPath;
            bool isDirectory{false};
            std::uintmax_t size{0};
            SourceMeta winner;
            std::map<std::wstring, SourceMeta> contributors;
        };

        struct EffectiveFileTreeBuildContext
        {
            std::filesystem::path projectDirectory;
            std::filesystem::path gameDirectory;
            std::wstring profile;
            VfsGameRootMountPlan plan;
            std::wstring revision;
            std::wstring cacheKey;
        };

        struct LazyTreeSource
        {
            std::filesystem::path sourceRoot;
            std::filesystem::path virtualPrefix;
            SourceMeta source;
            std::vector<std::wstring> excludedRootNames;
        };

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

        std::wstring normalizedVirtualPath(std::filesystem::path path)
        {
            path = path.lexically_normal();
            if (path.empty() || path == L".")
            {
                return {};
            }

            std::wstring value = path.wstring();
            std::replace(value.begin(), value.end(), L'/', L'\\');
            while (!value.empty() && value.front() == L'\\')
            {
                value.erase(value.begin());
            }
            while (!value.empty() && value.back() == L'\\')
            {
                value.pop_back();
            }
            return value;
        }

        std::wstring virtualPathKey(const std::filesystem::path& path)
        {
            return toLower(normalizedVirtualPath(path));
        }

        std::wstring virtualTextKey(std::wstring_view relativePath)
        {
            return toLower(normalizedVirtualPath(std::filesystem::path(std::wstring(relativePath))));
        }

        std::filesystem::path parentVirtualPath(const std::filesystem::path& path)
        {
            const std::filesystem::path normalized = path.lexically_normal();
            if (normalized.empty() || normalized == L"." || !normalized.has_parent_path())
            {
                return {};
            }
            return normalized.parent_path();
        }

        bool containsExcludedRoot(
            const std::vector<std::wstring>& excludedRootNames,
            const std::filesystem::path& sourceRelativePath)
        {
            if (sourceRelativePath.empty())
            {
                return false;
            }

            auto iterator = sourceRelativePath.begin();
            if (iterator == sourceRelativePath.end())
            {
                return false;
            }

            const std::wstring first = iterator->wstring();
            for (const std::wstring& excluded : excludedRootNames)
            {
                if (equalsIgnoreCase(first, excluded))
                {
                    return true;
                }
            }

            return false;
        }

        std::optional<std::filesystem::path> relativePath(
            const std::filesystem::path& path,
            const std::filesystem::path& base)
        {
            std::error_code error;
            std::filesystem::path relative = std::filesystem::relative(path, base, error);
            if (error || relative.empty() || relative == L".")
            {
                return std::nullopt;
            }
            return relative;
        }

        std::wstring fileTimeSignature(const std::filesystem::path& path)
        {
            std::error_code error;
            if (!std::filesystem::exists(path, error))
            {
                return L"missing";
            }

            const auto time = std::filesystem::last_write_time(path, error);
            const auto timeCount = error ? 0 : time.time_since_epoch().count();
            const bool directory = std::filesystem::is_directory(path, error);
            const std::uintmax_t size =
                !directory && !error ? std::filesystem::file_size(path, error) : 0;

            return std::to_wstring(timeCount) + L":" + std::to_wstring(size);
        }

        std::wstring sourceRootLookupKey(const std::filesystem::path& path)
        {
            return vfsNormalizedPathForComparison(path);
        }

        std::map<std::wstring, VfsMountSourceRoot> sourceRootsByPath(const VfsMountDescriptor& mount)
        {
            std::map<std::wstring, VfsMountSourceRoot> result;
            for (const VfsMountSourceRoot& source : mount.modSources)
            {
                result.emplace(sourceRootLookupKey(source.root), source);
            }
            return result;
        }

        std::wstring snapshotRevision(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& gameDirectory,
            std::wstring_view profileName,
            const VfsGameRootMountPlan& plan)
        {
            std::wstringstream stream;
            stream << vfsNormalizedPathForComparison(projectDirectory) << L'|'
                   << vfsNormalizedPathForComparison(gameDirectory) << L'|'
                   << profileName << L'|'
                   << plan.dataDirectory << L'|'
                   << plan.rootBuilderDirectoryName << L'|'
                   << (plan.rootBuilderEnabled ? L"1" : L"0") << L'|'
                   << fileTimeSignature(gameDirectory) << L'|';

            for (const VfsActiveMod& mod : plan.activeMods)
            {
                stream << vfsNormalizedPathForComparison(mod.path) << L':'
                       << mod.name << L':'
                       << mod.contentFingerprint << L':'
                       << fileTimeSignature(mod.path) << L'|';
            }

            for (const VfsMountDescriptor& mount : plan.mounts)
            {
                stream << vfsNormalizedPathForComparison(mount.target) << L':'
                       << vfsNormalizedPathForComparison(mount.overwrite) << L':'
                       << fileTimeSignature(mount.overwrite) << L'|';
            }

            return stream.str();
        }

        void addDirectoryContributor(TreeNode& node, const SourceMeta& source)
        {
            if (source.path.empty())
            {
                return;
            }

            node.contributors[sourceRootLookupKey(source.path)] = source;
        }

        void ensureDirectory(
            std::map<std::wstring, TreeNode>& nodes,
            const std::filesystem::path& relativePath,
            const SourceMeta& source)
        {
            const std::wstring displayPath = normalizedVirtualPath(relativePath);
            const std::wstring key = virtualTextKey(displayPath);
            TreeNode& node = nodes[key];
            node.isDirectory = true;
            node.relativePath = displayPath;
            node.parentPath = normalizedVirtualPath(parentVirtualPath(relativePath));
            node.name = displayPath.empty() ? L"Game Root" : relativePath.filename().wstring();
            addDirectoryContributor(node, source);

            const std::filesystem::path parentPath = parentVirtualPath(relativePath);
            if (!displayPath.empty() && !virtualPathKey(parentPath).empty())
            {
                SourceMeta parentSource = source;
                parentSource.path = source.path.parent_path();
                ensureDirectory(nodes, parentPath, parentSource);
            }
        }

        void ensureVirtualPrefix(
            std::map<std::wstring, TreeNode>& nodes,
            const std::filesystem::path& virtualPrefix,
            const std::filesystem::path& sourceRoot,
            const SourceMeta& source)
        {
            if (virtualPrefix.empty())
            {
                ensureDirectory(nodes, {}, source);
                return;
            }

            std::filesystem::path currentVirtual;
            for (const std::filesystem::path& part : virtualPrefix)
            {
                currentVirtual /= part;
                SourceMeta directorySource = source;
                const auto relative = relativePath(currentVirtual, virtualPrefix);
                directorySource.path = !relative.has_value() || relative->empty()
                    ? sourceRoot
                    : sourceRoot / relative.value();
                ensureDirectory(nodes, currentVirtual, directorySource);
            }
        }

        void ensureAncestors(
            std::map<std::wstring, TreeNode>& nodes,
            const std::filesystem::path& virtualPath,
            const std::filesystem::path& virtualPrefix,
            const std::filesystem::path& sourceRoot,
            const SourceMeta& source)
        {
            ensureVirtualPrefix(nodes, virtualPrefix, sourceRoot, source);

            std::filesystem::path current;
            const std::filesystem::path parent = parentVirtualPath(virtualPath);
            for (const std::filesystem::path& part : parent)
            {
                current /= part;
                if (!virtualPrefix.empty())
                {
                    const std::wstring currentKey = virtualPathKey(current);
                    const std::wstring prefixKey = virtualPathKey(virtualPrefix);
                    if (currentKey == prefixKey || currentKey.size() < prefixKey.size())
                    {
                        continue;
                    }
                }

                SourceMeta directorySource = source;
                const auto rel = virtualPrefix.empty()
                    ? std::optional<std::filesystem::path>(current)
                    : relativePath(current, virtualPrefix);
                directorySource.path = rel.has_value() && !rel->empty()
                    ? sourceRoot / rel.value()
                    : sourceRoot;
                ensureDirectory(nodes, current, directorySource);
            }
        }

        void applyFile(
            std::map<std::wstring, TreeNode>& nodes,
            const std::filesystem::path& virtualPath,
            const std::filesystem::path& virtualPrefix,
            const std::filesystem::path& sourceRoot,
            const SourceMeta& source,
            std::uintmax_t size)
        {
            ensureAncestors(nodes, virtualPath, virtualPrefix, sourceRoot, source);
            const std::wstring displayPath = normalizedVirtualPath(virtualPath);
            TreeNode& node = nodes[virtualTextKey(displayPath)];
            node.name = virtualPath.filename().wstring();
            node.relativePath = displayPath;
            node.parentPath = normalizedVirtualPath(parentVirtualPath(virtualPath));
            node.isDirectory = false;
            node.size = size;
            node.winner = source;
            node.contributors.clear();
        }

        void applyImmediateDirectory(
            std::map<std::wstring, TreeNode>& nodes,
            const std::filesystem::path& virtualPath,
            const SourceMeta& source)
        {
            const std::wstring displayPath = normalizedVirtualPath(virtualPath);
            TreeNode& node = nodes[virtualTextKey(displayPath)];
            node.name = displayPath.empty() ? L"Game Root" : virtualPath.filename().wstring();
            node.relativePath = displayPath;
            node.parentPath = normalizedVirtualPath(parentVirtualPath(virtualPath));
            node.isDirectory = true;
            node.size = 0;
            addDirectoryContributor(node, source);
        }

        void applyImmediateFile(
            std::map<std::wstring, TreeNode>& nodes,
            const std::filesystem::path& virtualPath,
            const SourceMeta& source,
            std::uintmax_t size)
        {
            const std::wstring displayPath = normalizedVirtualPath(virtualPath);
            TreeNode& node = nodes[virtualTextKey(displayPath)];
            node.name = virtualPath.filename().wstring();
            node.relativePath = displayPath;
            node.parentPath = normalizedVirtualPath(parentVirtualPath(virtualPath));
            node.isDirectory = false;
            node.size = size;
            node.winner = source;
            node.contributors.clear();
        }

        void scanSourceRoot(
            std::map<std::wstring, TreeNode>& nodes,
            const std::filesystem::path& sourceRoot,
            const std::filesystem::path& virtualPrefix,
            const SourceMeta& source,
            const std::vector<std::wstring>& excludedRootNames)
        {
            std::error_code error;
            if (!std::filesystem::exists(sourceRoot, error) || !std::filesystem::is_directory(sourceRoot, error))
            {
                return;
            }

            ensureVirtualPrefix(nodes, virtualPrefix, sourceRoot, source);

            std::filesystem::recursive_directory_iterator iterator(
                sourceRoot,
                std::filesystem::directory_options::skip_permission_denied,
                error);
            const std::filesystem::recursive_directory_iterator end;
            while (!error && iterator != end)
            {
                const std::filesystem::directory_entry entry = *iterator;
                const std::filesystem::path path = entry.path();
                const auto sourceRelative = relativePath(path, sourceRoot);
                if (!sourceRelative.has_value())
                {
                    iterator.increment(error);
                    continue;
                }

                if (containsExcludedRoot(excludedRootNames, sourceRelative.value()))
                {
                    if (entry.is_directory(error))
                    {
                        iterator.disable_recursion_pending();
                    }
                    iterator.increment(error);
                    continue;
                }

                const std::filesystem::path virtualPath = virtualPrefix / sourceRelative.value();
                SourceMeta entrySource = source;
                entrySource.path = path;

                if (entry.is_directory(error))
                {
                    ensureDirectory(nodes, virtualPath, entrySource);
                }
                else if (entry.is_regular_file(error))
                {
                    const std::uintmax_t size = entry.file_size(error);
                    applyFile(nodes, virtualPath, virtualPrefix, sourceRoot, entrySource, error ? 0 : size);
                }

                error.clear();
                iterator.increment(error);
            }
        }

        std::filesystem::path mountVirtualPrefix(
            const std::filesystem::path& gameDirectory,
            const VfsMountDescriptor& mount)
        {
            const auto relative = relativePath(mount.target, gameDirectory);
            return relative.has_value() ? relative.value() : std::filesystem::path{};
        }

        std::wstring cacheKey(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            std::wstring_view revision)
        {
            return vfsNormalizedPathForComparison(projectDirectory) +
                L"|" + std::wstring(profileName) +
                L"|" + std::wstring(revision);
        }

        std::vector<std::wstring> virtualPathParts(const std::filesystem::path& path)
        {
            const std::filesystem::path normalizedPath{
                normalizedVirtualPath(path)
            };
            std::vector<std::wstring> parts;
            for (const std::filesystem::path& part : normalizedPath)
            {
                const std::wstring value = part.wstring();
                if (!value.empty() && value != L".")
                {
                    parts.push_back(value);
                }
            }
            return parts;
        }

        bool startsWithParts(
            const std::vector<std::wstring>& value,
            const std::vector<std::wstring>& prefix)
        {
            if (prefix.size() > value.size())
            {
                return false;
            }

            for (std::size_t index = 0; index < prefix.size(); ++index)
            {
                if (!equalsIgnoreCase(value[index], prefix[index]))
                {
                    return false;
                }
            }
            return true;
        }

        std::filesystem::path pathFromParts(
            const std::vector<std::wstring>& parts,
            std::size_t first,
            std::size_t last)
        {
            std::filesystem::path result;
            const std::size_t end = (std::min)(last, parts.size());
            for (std::size_t index = first; index < end; ++index)
            {
                result /= parts[index];
            }
            return result;
        }

        std::filesystem::path pathFromParts(
            const std::vector<std::wstring>& parts,
            std::size_t first)
        {
            return pathFromParts(parts, first, parts.size());
        }

        bool directoryExists(const std::filesystem::path& path)
        {
            std::error_code error;
            return std::filesystem::exists(path, error) &&
                std::filesystem::is_directory(path, error);
        }

        void sortEffectiveFileTreeEntries(std::vector<EffectiveFileTreeEntry>& entries)
        {
            std::sort(
                entries.begin(),
                entries.end(),
                [](const EffectiveFileTreeEntry& left, const EffectiveFileTreeEntry& right)
                {
                    if (left.relativePath.empty() != right.relativePath.empty())
                    {
                        return left.relativePath.empty();
                    }
                    if (left.parentPath != right.parentPath)
                    {
                        return toLower(left.parentPath) < toLower(right.parentPath);
                    }
                    if (left.isDirectory != right.isDirectory)
                    {
                        return left.isDirectory;
                    }
                    return toLower(left.name) < toLower(right.name);
                });
        }

        std::vector<LazyTreeSource> collectLazyTreeSources(
            const std::filesystem::path& gameDirectory,
            const VfsGameRootMountPlan& plan)
        {
            std::vector<LazyTreeSource> sources;
            sources.push_back(LazyTreeSource{
                gameDirectory,
                {},
                SourceMeta{L"game", L"Game", gameDirectory},
                {}
            });

            for (const VfsMountDescriptor& mount : plan.mounts)
            {
                const std::filesystem::path virtualPrefix = mountVirtualPrefix(gameDirectory, mount);
                const std::map<std::wstring, VfsMountSourceRoot> sourcesByRoot = sourceRootsByPath(mount);
                for (const std::filesystem::path& modRoot : mount.mods)
                {
                    const auto source = sourcesByRoot.find(sourceRootLookupKey(modRoot));
                    const std::wstring sourceName = source == sourcesByRoot.end()
                        ? modRoot.filename().wstring()
                        : source->second.sourceName;
                    sources.push_back(LazyTreeSource{
                        modRoot,
                        virtualPrefix,
                        SourceMeta{L"mod", sourceName, modRoot},
                        mount.excludedRootNames
                    });
                }

                sources.push_back(LazyTreeSource{
                    mount.overwrite,
                    virtualPrefix,
                    SourceMeta{L"overwrite", L"Overwrite", mount.overwrite},
                    mount.excludedRootNames
                });
            }

            return sources;
        }

        bool sourceDirectoryHasImmediateChildren(
            const std::filesystem::path& sourceDirectory,
            const std::filesystem::path& sourceRelativeDirectory,
            const std::vector<std::wstring>& excludedRootNames)
        {
            std::error_code error;
            if (!std::filesystem::exists(sourceDirectory, error) ||
                !std::filesystem::is_directory(sourceDirectory, error))
            {
                return false;
            }

            std::filesystem::directory_iterator iterator(
                sourceDirectory,
                std::filesystem::directory_options::skip_permission_denied,
                error);
            const std::filesystem::directory_iterator end;
            while (!error && iterator != end)
            {
                const std::filesystem::directory_entry entry = *iterator;
                const std::filesystem::path childRelative =
                    sourceRelativeDirectory / entry.path().filename();
                if (!containsExcludedRoot(excludedRootNames, childRelative) &&
                    (entry.is_directory(error) || entry.is_regular_file(error)))
                {
                    return true;
                }

                error.clear();
                iterator.increment(error);
            }

            return false;
        }

        bool sourceHasLazyChildren(
            const LazyTreeSource& source,
            const std::vector<std::wstring>& directoryParts)
        {
            if (!directoryExists(source.sourceRoot))
            {
                return false;
            }

            const std::vector<std::wstring> prefixParts = virtualPathParts(source.virtualPrefix);
            if (startsWithParts(directoryParts, prefixParts))
            {
                const std::filesystem::path sourceRelativeDirectory =
                    pathFromParts(directoryParts, prefixParts.size());
                if (containsExcludedRoot(source.excludedRootNames, sourceRelativeDirectory))
                {
                    return false;
                }

                return sourceDirectoryHasImmediateChildren(
                    source.sourceRoot / sourceRelativeDirectory,
                    sourceRelativeDirectory,
                    source.excludedRootNames);
            }

            if (startsWithParts(prefixParts, directoryParts) &&
                prefixParts.size() > directoryParts.size())
            {
                return true;
            }

            return false;
        }

        bool lazyDirectoryHasChildren(
            const std::vector<LazyTreeSource>& sources,
            const std::wstring& relativePath)
        {
            const std::vector<std::wstring> directoryParts =
                virtualPathParts(std::filesystem::path(relativePath));
            return std::any_of(
                sources.begin(),
                sources.end(),
                [&directoryParts](const LazyTreeSource& source)
                {
                    return sourceHasLazyChildren(source, directoryParts);
                });
        }

        void collectImmediateChildrenFromSource(
            std::map<std::wstring, TreeNode>& nodes,
            const LazyTreeSource& source,
            const std::vector<std::wstring>& parentParts)
        {
            if (!directoryExists(source.sourceRoot))
            {
                return;
            }

            const std::vector<std::wstring> prefixParts = virtualPathParts(source.virtualPrefix);
            if (startsWithParts(parentParts, prefixParts))
            {
                const std::filesystem::path sourceRelativeDirectory =
                    pathFromParts(parentParts, prefixParts.size());
                if (containsExcludedRoot(source.excludedRootNames, sourceRelativeDirectory))
                {
                    return;
                }

                const std::filesystem::path sourceDirectory =
                    source.sourceRoot / sourceRelativeDirectory;
                std::error_code error;
                if (!std::filesystem::exists(sourceDirectory, error) ||
                    !std::filesystem::is_directory(sourceDirectory, error))
                {
                    return;
                }

                std::filesystem::directory_iterator iterator(
                    sourceDirectory,
                    std::filesystem::directory_options::skip_permission_denied,
                    error);
                const std::filesystem::directory_iterator end;
                while (!error && iterator != end)
                {
                    const std::filesystem::directory_entry entry = *iterator;
                    const std::filesystem::path sourceRelativePath =
                        sourceRelativeDirectory / entry.path().filename();
                    if (containsExcludedRoot(source.excludedRootNames, sourceRelativePath))
                    {
                        iterator.increment(error);
                        continue;
                    }

                    const std::filesystem::path virtualPath =
                        source.virtualPrefix / sourceRelativePath;
                    SourceMeta entrySource = source.source;
                    entrySource.path = entry.path();

                    if (entry.is_directory(error))
                    {
                        applyImmediateDirectory(nodes, virtualPath, entrySource);
                    }
                    else if (entry.is_regular_file(error))
                    {
                        const std::uintmax_t size = entry.file_size(error);
                        applyImmediateFile(nodes, virtualPath, entrySource, error ? 0 : size);
                    }

                    error.clear();
                    iterator.increment(error);
                }
                return;
            }

            if (startsWithParts(prefixParts, parentParts) &&
                prefixParts.size() > parentParts.size())
            {
                const std::filesystem::path childVirtualPath =
                    pathFromParts(prefixParts, 0, parentParts.size() + 1);
                SourceMeta prefixSource = source.source;
                prefixSource.path = source.sourceRoot;
                applyImmediateDirectory(nodes, childVirtualPath, prefixSource);
            }
        }

        EffectiveFileTreeBuildContext buildEffectiveFileTreeContext(
            Logger& logger,
            const ProfileOrderService& profileOrder,
            const BuildPathSettingsService& pathSettings,
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName)
        {
            if (projectDirectory.empty())
            {
                throw std::invalid_argument("Project directory is required.");
            }

            const BuildPathSettings paths = pathSettings.loadForProjectDirectory(projectDirectory);
            if (paths.gameDirectory.empty())
            {
                throw std::invalid_argument("Game directory is not configured.");
            }
            std::error_code error;
            if (!std::filesystem::exists(paths.gameDirectory, error) ||
                !std::filesystem::is_directory(paths.gameDirectory, error))
            {
                throw std::invalid_argument("Game directory does not exist.");
            }

            GameDetectionRequest request;
            request.installPath = paths.gameDirectory;
            const GameDetectionResult detection =
                GameDetectionService(GameSupportRegistry::embedded()).detect(request);
            if (!detection.detected || detection.support == nullptr)
            {
                throw std::invalid_argument("Game support could not be detected for the configured game directory.");
            }

            const CapabilitySet& capabilities = detection.support->capabilities();
            const GameSupportComponents& components = detection.support->components();
            if (!capabilities.has(GameCapability::GameSpecificVfs) || components.vfsRulesProvider == nullptr)
            {
                throw std::invalid_argument("The selected game does not support virtual file system views.");
            }
            if (!capabilities.has(GameCapability::ContentLayoutRules) ||
                components.contentLayoutRulesProvider == nullptr)
            {
                throw std::invalid_argument("The selected game does not provide content layout rules.");
            }

            const VfsSupportRules& vfsRules = components.vfsRulesProvider->vfsRules();
            const ContentLayoutSupportRules& contentRules =
                components.contentLayoutRulesProvider->contentLayoutRules();
            if (contentRules.dataFolder.empty())
            {
                throw std::invalid_argument("The selected game content layout does not define a data directory.");
            }

            const std::wstring profile = profileName.empty()
                ? std::wstring(L"Default")
                : std::wstring(profileName);
            VfsGameRootMountPlan plan = buildVfsGameRootMountPlan(
                logger,
                profileOrder,
                pathSettings,
                projectDirectory,
                paths.gameDirectory,
                profile,
                capabilities,
                vfsRules,
                contentRules);
            const std::wstring revision =
                snapshotRevision(projectDirectory, paths.gameDirectory, profile, plan);
            return EffectiveFileTreeBuildContext{
                projectDirectory,
                paths.gameDirectory,
                profile,
                std::move(plan),
                revision,
                cacheKey(projectDirectory, profile, revision)
            };
        }

        constexpr int defaultTreePageLimit = 250;
        constexpr int maxTreePageLimit = 1000;

        int normalizePageLimit(int limit)
        {
            if (limit <= 0)
            {
                return defaultTreePageLimit;
            }

            return (std::min)(limit, maxTreePageLimit);
        }

        int parseCursorOffset(std::wstring_view cursor)
        {
            if (cursor.empty())
            {
                return 0;
            }

            try
            {
                const unsigned long value = std::stoul(std::wstring(cursor));
                if (value > static_cast<unsigned long>((std::numeric_limits<int>::max)()))
                {
                    throw std::out_of_range("cursor");
                }
                return static_cast<int>(value);
            }
            catch (const std::exception&)
            {
                throw std::invalid_argument("Effective file tree cursor is invalid.");
            }
        }

        EffectiveFileTreeEntry toEntry(const TreeNode& node, bool hasChildren);

        EffectiveFileTreePage pageFromSnapshot(
            const EffectiveFileTreeSnapshot& snapshot,
            std::wstring_view parentPath,
            std::wstring_view cursor,
            int limit,
            bool includeRoot)
        {
            const std::wstring normalizedParent =
                normalizedVirtualPath(std::filesystem::path(std::wstring(parentPath)));
            const std::wstring parentKey = virtualTextKey(normalizedParent);
            const int pageLimit = normalizePageLimit(limit);
            const int offset = parseCursorOffset(cursor);

            std::vector<EffectiveFileTreeEntry> children;
            for (const EffectiveFileTreeEntry& entry : snapshot.entries)
            {
                if (entry.relativePath.empty())
                {
                    continue;
                }
                if (virtualTextKey(entry.parentPath) == parentKey)
                {
                    children.push_back(entry);
                }
            }

            const int totalChildren = static_cast<int>(children.size());
            const int start = (std::min)(offset, totalChildren);
            const int end = (std::min)(start + pageLimit, totalChildren);

            EffectiveFileTreePage page;
            page.profileName = snapshot.profileName;
            page.revision = snapshot.revision;
            page.parentPath = normalizedParent;
            page.totalFileCount = snapshot.totalFileCount;
            page.totalFileCountKnown = snapshot.totalFileCountKnown;
            page.totalChildCount = totalChildren;
            page.limit = pageLimit;
            if (end < totalChildren)
            {
                page.nextCursor = std::to_wstring(end);
            }

            if (includeRoot && offset == 0)
            {
                const auto root = std::find_if(
                    snapshot.entries.begin(),
                    snapshot.entries.end(),
                    [](const EffectiveFileTreeEntry& entry)
                    {
                        return entry.relativePath.empty();
                    });
                if (root != snapshot.entries.end())
                {
                    page.entries.push_back(*root);
                }
            }

            page.entries.reserve(page.entries.size() + static_cast<std::size_t>(end - start));
            for (int index = start; index < end; ++index)
            {
                page.entries.push_back(children[static_cast<std::size_t>(index)]);
            }

            return page;
        }

        EffectiveFileTreePage lazyPage(
            const EffectiveFileTreeBuildContext& context,
            std::wstring_view parentPath,
            std::wstring_view cursor,
            int limit,
            bool includeRoot)
        {
            const std::wstring normalizedParent =
                normalizedVirtualPath(std::filesystem::path(std::wstring(parentPath)));
            const int pageLimit = normalizePageLimit(limit);
            const int offset = parseCursorOffset(cursor);
            const std::vector<LazyTreeSource> sources =
                collectLazyTreeSources(context.gameDirectory, context.plan);
            const std::vector<std::wstring> parentParts =
                virtualPathParts(std::filesystem::path(normalizedParent));

            std::map<std::wstring, TreeNode> nodes;
            for (const LazyTreeSource& source : sources)
            {
                collectImmediateChildrenFromSource(nodes, source, parentParts);
            }

            std::vector<EffectiveFileTreeEntry> children;
            children.reserve(nodes.size());
            for (const auto& [key, node] : nodes)
            {
                static_cast<void>(key);
                children.push_back(toEntry(
                    node,
                    node.isDirectory && lazyDirectoryHasChildren(sources, node.relativePath)));
            }
            sortEffectiveFileTreeEntries(children);

            const int totalChildren = static_cast<int>(children.size());
            const int start = (std::min)(offset, totalChildren);
            const int end = (std::min)(start + pageLimit, totalChildren);

            EffectiveFileTreePage page;
            page.profileName = context.profile;
            page.revision = context.revision;
            page.parentPath = normalizedParent;
            page.totalFileCount = 0;
            page.totalFileCountKnown = false;
            page.totalChildCount = totalChildren;
            page.limit = pageLimit;
            if (end < totalChildren)
            {
                page.nextCursor = std::to_wstring(end);
            }

            if (includeRoot && offset == 0)
            {
                TreeNode root;
                root.name = L"Game Root";
                root.relativePath = L"";
                root.parentPath = L"";
                root.isDirectory = true;
                page.entries.push_back(toEntry(root, totalChildren > 0));
            }

            page.entries.reserve(page.entries.size() + static_cast<std::size_t>(end - start));
            for (int index = start; index < end; ++index)
            {
                page.entries.push_back(children[static_cast<std::size_t>(index)]);
            }

            return page;
        }

        EffectiveFileTreeEntry toEntry(const TreeNode& node, bool hasChildren)
        {
            EffectiveFileTreeEntry entry;
            entry.name = node.name;
            entry.relativePath = node.relativePath;
            entry.parentPath = node.parentPath;
            entry.isDirectory = node.isDirectory;
            entry.hasChildren = hasChildren;
            entry.size = node.isDirectory ? 0 : node.size;
            entry.virtualPath = node.relativePath;

            if (node.isDirectory)
            {
                if (node.contributors.size() == 1)
                {
                    const SourceMeta& source = node.contributors.begin()->second;
                    entry.sourceKind = source.kind;
                    entry.sourceName = source.name;
                    entry.sourcePath = source.path;
                }
                else
                {
                    entry.sourceKind = L"virtual";
                    entry.sourceName = node.relativePath.empty() ? L"Game Root" : L"Merged";
                    entry.sourcePath.clear();
                }
                return entry;
            }

            entry.sourceKind = node.winner.kind;
            entry.sourceName = node.winner.name;
            entry.sourcePath = node.winner.path;
            return entry;
        }

        std::vector<EffectiveFileTreeEntry> finalizeEntries(const std::map<std::wstring, TreeNode>& nodes)
        {
            std::set<std::wstring> parentsWithChildren;
            for (const auto& [key, node] : nodes)
            {
                static_cast<void>(key);
                if (!node.relativePath.empty())
                {
                    parentsWithChildren.insert(virtualTextKey(node.parentPath));
                }
            }

            std::vector<EffectiveFileTreeEntry> entries;
            entries.reserve(nodes.size());
            for (const auto& [key, node] : nodes)
            {
                entries.push_back(toEntry(node, parentsWithChildren.contains(key)));
            }

            sortEffectiveFileTreeEntries(entries);
            return entries;
        }

        EffectiveFileTreeSnapshot buildSnapshot(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& gameDirectory,
            const std::wstring& profileName,
            const std::wstring& revision,
            const VfsGameRootMountPlan& plan)
        {
            std::map<std::wstring, TreeNode> nodes;
            scanSourceRoot(
                nodes,
                gameDirectory,
                {},
                SourceMeta{L"game", L"Game", gameDirectory},
                {});

            for (const VfsMountDescriptor& mount : plan.mounts)
            {
                const std::filesystem::path virtualPrefix = mountVirtualPrefix(gameDirectory, mount);
                const std::map<std::wstring, VfsMountSourceRoot> sourcesByRoot = sourceRootsByPath(mount);
                for (const std::filesystem::path& modRoot : mount.mods)
                {
                    const auto source = sourcesByRoot.find(sourceRootLookupKey(modRoot));
                    const std::wstring sourceName = source == sourcesByRoot.end()
                        ? modRoot.filename().wstring()
                        : source->second.sourceName;
                    scanSourceRoot(
                        nodes,
                        modRoot,
                        virtualPrefix,
                        SourceMeta{L"mod", sourceName, modRoot},
                        mount.excludedRootNames);
                }

                scanSourceRoot(
                    nodes,
                    mount.overwrite,
                    virtualPrefix,
                    SourceMeta{L"overwrite", L"Overwrite", mount.overwrite},
                    mount.excludedRootNames);
            }

            EffectiveFileTreeSnapshot snapshot;
            snapshot.profileName = profileName;
            snapshot.revision = revision;
            snapshot.entries = finalizeEntries(nodes);
            for (const EffectiveFileTreeEntry& entry : snapshot.entries)
            {
                if (!entry.isDirectory)
                {
                    ++snapshot.totalFileCount;
                }
            }
            static_cast<void>(projectDirectory);
            return snapshot;
        }
    }

    EffectiveFileTreeService::EffectiveFileTreeService(
        Logger& logger,
        ProfileOrderService& profileOrder,
        const BuildPathSettingsService& pathSettings) noexcept
        : logger_(logger),
          profileOrder_(profileOrder),
          pathSettings_(pathSettings)
    {
    }

    void EffectiveFileTreeService::initialize()
    {
        if (initialized_)
        {
            return;
        }

        initialized_ = true;
        logger_.write(LogLevel::Info, "Effective file tree service initialized.");
    }

    void EffectiveFileTreeService::shutdown()
    {
        if (!initialized_)
        {
            return;
        }

        {
            std::lock_guard lock(cacheMutex_);
            cache_.clear();
        }
        initialized_ = false;
        logger_.write(LogLevel::Info, "Effective file tree service shut down.");
    }

    EffectiveFileTreeSnapshot EffectiveFileTreeService::snapshot(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName) const
    {
        return snapshotInternal(projectDirectory, profileName, nullptr);
    }

    EffectiveFileTreeSnapshot EffectiveFileTreeService::snapshotInternal(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        bool* cacheHit) const
    {
        const EffectiveFileTreeBuildContext context = buildEffectiveFileTreeContext(
            logger_,
            profileOrder_,
            pathSettings_,
            projectDirectory,
            profileName);

        {
            std::lock_guard lock(cacheMutex_);
            const auto cached = cache_.find(context.cacheKey);
            if (cached != cache_.end())
            {
                if (cacheHit != nullptr)
                {
                    *cacheHit = true;
                }
                return cached->second;
            }
        }

        if (cacheHit != nullptr)
        {
            *cacheHit = false;
        }

        EffectiveFileTreeSnapshot result = buildSnapshot(
            context.projectDirectory,
            context.gameDirectory,
            context.profile,
            context.revision,
            context.plan);

        {
            std::lock_guard lock(cacheMutex_);
            cache_[context.cacheKey] = result;
        }

        logger_.write(
            LogLevel::Info,
            "Effective file tree snapshot prepared: project=\"" +
                toUtf8(std::filesystem::absolute(projectDirectory).wstring()) +
                "\", profile=\"" + toUtf8(context.profile) +
                "\", files=" + std::to_string(result.totalFileCount) +
                ", entries=" + std::to_string(result.entries.size()) + ".");
        return result;
    }

    EffectiveFileTreeIndexWarmupResult EffectiveFileTreeService::prepareWorkspaceIndexes(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName) const
    {
        bool cacheHit = false;
        const EffectiveFileTreeSnapshot prepared =
            snapshotInternal(projectDirectory, profileName, &cacheHit);

        return EffectiveFileTreeIndexWarmupResult{
            prepared.profileName,
            prepared.revision,
            prepared.totalFileCount,
            static_cast<int>(prepared.entries.size()),
            cacheHit
        };
    }

    EffectiveFileTreePage EffectiveFileTreeService::root(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        int limit) const
    {
        const EffectiveFileTreeBuildContext context = buildEffectiveFileTreeContext(
            logger_,
            profileOrder_,
            pathSettings_,
            projectDirectory,
            profileName);

        {
            std::lock_guard lock(cacheMutex_);
            const auto cached = cache_.find(context.cacheKey);
            if (cached != cache_.end())
            {
                return pageFromSnapshot(cached->second, L"", L"", limit, true);
            }
        }

        return lazyPage(context, L"", L"", limit, true);
    }

    EffectiveFileTreePage EffectiveFileTreeService::children(
        const std::filesystem::path& projectDirectory,
        std::wstring_view profileName,
        std::wstring_view expectedRevision,
        std::wstring_view relativeDirectory,
        std::wstring_view cursor,
        int limit) const
    {
        const std::filesystem::path requested{std::wstring(relativeDirectory)};
        if (requested.is_absolute())
        {
            throw std::invalid_argument("Relative directory is required.");
        }

        const EffectiveFileTreeBuildContext context = buildEffectiveFileTreeContext(
            logger_,
            profileOrder_,
            pathSettings_,
            projectDirectory,
            profileName);
        if (!expectedRevision.empty() && expectedRevision != context.revision)
        {
            throw std::invalid_argument("Effective file tree revision is stale.");
        }

        {
            std::lock_guard lock(cacheMutex_);
            const auto cached = cache_.find(context.cacheKey);
            if (cached != cache_.end())
            {
                return pageFromSnapshot(
                    cached->second,
                    normalizedVirtualPath(requested),
                    cursor,
                    limit,
                    false);
            }
        }

        return lazyPage(context, normalizedVirtualPath(requested), cursor, limit, false);
    }

    bool EffectiveFileTreeService::isInitialized() const noexcept
    {
        return initialized_;
    }
}
