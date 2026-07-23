#include "FluxoraVfs/VfsTree.hpp"

#include "FluxoraVfs/VfsLog.hpp"

#include <algorithm>
#include <atomic>
#include <cwctype>
#include <utility>

namespace fluxora::vfs
{
    namespace
    {
#ifdef FLUXORA_VFS_TEST_HOOKS
        std::atomic<std::uint64_t> g_attributeProbeCount{0};
#endif

        std::wstring stripTrailingSlashes(std::wstring value)
        {
            while (!value.empty() && (value.back() == L'\\' || value.back() == L'/'))
            {
                value.pop_back();
            }
            return value;
        }

        std::wstring normalizeRootPath(std::wstring value)
        {
            std::replace(value.begin(), value.end(), L'/', L'\\');
            const std::size_t minimumLength =
                value.size() >= 3 && value[1] == L':' && value[2] == L'\\'
                    ? 3
                    : 0;
            while (value.size() > minimumLength && value.back() == L'\\')
            {
                value.pop_back();
            }
            return value;
        }

        std::wstring joinPath(const std::wstring& base, const std::wstring& leaf)
        {
            if (base.empty())
            {
                return leaf;
            }
            if (leaf.empty())
            {
                return base;
            }
            return base + L"\\" + leaf;
        }

        LARGE_INTEGER toLargeInteger(const FILETIME& time)
        {
            LARGE_INTEGER value{};
            value.LowPart = time.dwLowDateTime;
            value.HighPart = static_cast<LONG>(time.dwHighDateTime);
            return value;
        }

        bool readAttributes(const std::wstring& path, DWORD& attributes)
        {
#ifdef FLUXORA_VFS_TEST_HOOKS
            g_attributeProbeCount.fetch_add(1, std::memory_order_relaxed);
#endif
            attributes = GetFileAttributesW(path.c_str());
            return attributes != INVALID_FILE_ATTRIBUTES;
        }

        bool hasDirectoryAttributes(const std::wstring& path)
        {
            DWORD attributes = INVALID_FILE_ATTRIBUTES;
            return readAttributes(path, attributes) &&
                (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
        }

        DirChild childFromFindData(
            const std::wstring& realPath,
            const WIN32_FIND_DATAW& data)
        {
            DirChild child;
            child.name = data.cFileName;
            child.nameLower = VfsTree::toLower(child.name);
            child.realPath = realPath;
            child.isDirectory = (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
            child.attributes = data.dwFileAttributes;
            child.creationTime = toLargeInteger(data.ftCreationTime);
            child.lastAccessTime = toLargeInteger(data.ftLastAccessTime);
            child.lastWriteTime = toLargeInteger(data.ftLastWriteTime);
            child.endOfFile.LowPart = data.nFileSizeLow;
            child.endOfFile.HighPart = static_cast<LONG>(data.nFileSizeHigh);
            // Allocation size rounded up to the next cluster keeps tools happy.
            constexpr LONGLONG cluster = 4096;
            child.allocationSize.QuadPart = child.isDirectory
                ? 0
                : ((child.endOfFile.QuadPart + cluster - 1) / cluster) * cluster;
            return child;
        }

        const VfsTree::DirectoryListing& emptyListing()
        {
            static const VfsTree::DirectoryListing empty =
                std::make_shared<const std::vector<DirChild>>();
            return empty;
        }
    }

    std::wstring VfsTree::toLower(std::wstring value)
    {
        std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
        {
            return static_cast<wchar_t>(std::towlower(character));
        });
        return value;
    }

    bool VfsTree::equalsIgnoreCase(const std::wstring& a, const std::wstring& b)
    {
        if (a.size() != b.size())
        {
            return false;
        }

        for (std::size_t index = 0; index < a.size(); ++index)
        {
            if (std::towlower(a[index]) != std::towlower(b[index]))
            {
                return false;
            }
        }
        return true;
    }

    bool VfsTree::wildcardMatch(std::wstring_view name, std::wstring_view pattern)
    {
        // NtQueryDirectoryFile uses DOS wildcard tokens for Win32 masks:
        // DOS_STAR ('<'), DOS_QM ('>'), and DOS_DOT ('"'). Treat DOS_STAR like
        // '*' here so common masks such as "*.dll" / "*.ess" match after Win32
        // translates them to "<.dll" / "<.ess" at the native API layer.
        std::size_t n = 0;
        std::size_t p = 0;
        std::size_t star = std::wstring_view::npos;
        std::size_t mark = 0;

        while (n < name.size())
        {
            if (p < pattern.size() &&
                (pattern[p] == name[n] || pattern[p] == L'?' || pattern[p] == L'>'))
            {
                ++n;
                ++p;
            }
            else if (p < pattern.size() && pattern[p] == L'"')
            {
                if (name[n] == L'.')
                {
                    ++n;
                }
                ++p;
            }
            else if (p < pattern.size() && (pattern[p] == L'*' || pattern[p] == L'<'))
            {
                star = p++;
                mark = n;
            }
            else if (star != std::wstring_view::npos)
            {
                p = star + 1;
                n = ++mark;
            }
            else
            {
                return false;
            }
        }

        while (p < pattern.size() && (pattern[p] == L'*' || pattern[p] == L'<' || pattern[p] == L'"'))
        {
            ++p;
        }
        return p == pattern.size();
    }

#ifdef FLUXORA_VFS_TEST_HOOKS
    void VfsTree::resetAttributeProbeCountForTests()
    {
        g_attributeProbeCount.store(0, std::memory_order_relaxed);
    }

    std::uint64_t VfsTree::attributeProbeCountForTests()
    {
        return g_attributeProbeCount.load(std::memory_order_relaxed);
    }
#endif

    std::wstring VfsTree::normalizeRel(std::wstring rel)
    {
        std::replace(rel.begin(), rel.end(), L'/', L'\\');
        std::size_t first = 0;
        while (first < rel.size() && rel[first] == L'\\')
        {
            ++first;
        }
        rel.erase(0, first);
        rel = stripTrailingSlashes(std::move(rel));
        return rel;
    }

    VfsTree::VfsTree(VfsTree&& other) noexcept
    {
        *this = std::move(other);
    }

    VfsTree& VfsTree::operator=(VfsTree&& other) noexcept
    {
        if (this == &other)
        {
            return *this;
        }

        {
            std::scoped_lock lock(cacheMutex_, other.cacheMutex_);
            target_ = std::move(other.target_);
            overwrite_ = std::move(other.overwrite_);
            whiteoutRoot_ = std::move(other.whiteoutRoot_);
            mods_ = std::move(other.mods_);
            excludedRootNames_ = std::move(other.excludedRootNames_);
            fileMap_ = std::move(other.fileMap_);
            dirMap_ = std::move(other.dirMap_);
            overlayMissRevisions_ = std::move(other.overlayMissRevisions_);
            parentLookupCounts_ = std::move(other.parentLookupCounts_);
            built_ = other.built_;
            revision_ = other.revision_;

            other.built_ = false;
            other.target_.clear();
            other.overwrite_.clear();
            other.whiteoutRoot_.clear();
            other.mods_.clear();
            other.excludedRootNames_.clear();
            other.fileMap_.clear();
            other.dirMap_.clear();
            other.overlayMissRevisions_.clear();
            other.parentLookupCounts_.clear();
            other.revision_ = 0;
        }

        return *this;
    }

    VfsTree::DirNode& VfsTree::ensureDir(const std::wstring& relLower) const
    {
        return dirMap_[relLower];
    }

    bool VfsTree::isExcludedTopLevelName(const std::wstring& name) const
    {
        const std::wstring nameLower = toLower(name);
        return std::find(excludedRootNames_.begin(), excludedRootNames_.end(), nameLower) !=
            excludedRootNames_.end();
    }

    bool VfsTree::isExcludedRelativePath(const std::wstring& relLower) const
    {
        if (relLower.empty())
        {
            return false;
        }

        const std::size_t separator = relLower.find(L'\\');
        const std::wstring rootName = separator == std::wstring::npos
            ? relLower
            : relLower.substr(0, separator);
        return std::find(excludedRootNames_.begin(), excludedRootNames_.end(), rootName) !=
            excludedRootNames_.end();
    }

    bool VfsTree::isWhiteoutedLocked(const std::wstring& relLower) const
    {
        if (whiteoutRoot_.empty() || relLower.empty())
        {
            return false;
        }
        const std::wstring marker = joinPath(whiteoutRoot_, relLower);
        const DWORD attributes = GetFileAttributesW(marker.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0)
        {
            return false;
        }
        if (!overwrite_.empty())
        {
            const DWORD overwriteAttributes = GetFileAttributesW(joinPath(overwrite_, relLower).c_str());
            if (overwriteAttributes != INVALID_FILE_ATTRIBUTES)
            {
                return false;
            }
        }
        return true;
    }

    bool VfsTree::hasCurrentOverlayMissLocked(const std::wstring& relLower) const
    {
        std::wstring key = relLower;
        while (!key.empty())
        {
            const auto miss = overlayMissRevisions_.find(key);
            if (miss != overlayMissRevisions_.end())
            {
                if (miss->second == revision_)
                {
                    return true;
                }
                overlayMissRevisions_.erase(miss);
            }

            const std::size_t separator = key.find_last_of(L'\\');
            if (separator == std::wstring::npos)
            {
                break;
            }
            key.erase(separator);
        }

        return false;
    }

    void VfsTree::cacheOverlayMissLocked(const std::wstring& relLower) const
    {
        if (!relLower.empty())
        {
            overlayMissRevisions_[relLower] = revision_;
        }
    }

    bool VfsTree::directoryListingProvesOverlayMissLocked(const std::wstring& relLower) const
    {
        if (relLower.empty())
        {
            return false;
        }

        const std::size_t separator = relLower.find_last_of(L'\\');
        const std::wstring parentLower = separator == std::wstring::npos
            ? std::wstring()
            : relLower.substr(0, separator);
        const std::wstring nameLower = separator == std::wstring::npos
            ? relLower
            : relLower.substr(separator + 1);

        const auto parent = dirMap_.find(parentLower);
        return parent != dirMap_.end() &&
            parent->second.childrenBuilt &&
            parent->second.overlayChildNamesLower.find(nameLower) == parent->second.overlayChildNamesLower.end();
    }

    void VfsTree::mergeDirectoryLocked(
        const std::wstring& relLower,
        const std::wstring& displayRel,
        const std::wstring& directory,
        bool overrideExisting,
        bool sourceIsReal,
        bool applyRootExclusions,
        std::unordered_map<std::wstring, DirChild>& children,
        std::unordered_set<std::wstring>* overlayChildNamesLower) const
    {
        WIN32_FIND_DATAW data{};
        const HANDLE find = FindFirstFileW((directory + L"\\*").c_str(), &data);
        if (find == INVALID_HANDLE_VALUE)
        {
            return;
        }

        do
        {
            const std::wstring name = data.cFileName;
            if (name == L"." || name == L"..")
            {
                continue;
            }

            if (applyRootExclusions && isExcludedTopLevelName(name))
            {
                continue;
            }

            const std::wstring fullChild = joinPath(directory, name);
            DirChild child = childFromFindData(fullChild, data);
            const std::wstring key = child.nameLower;
            if (child.isDirectory)
            {
                child.realExists = sourceIsReal;
                if (!sourceIsReal)
                {
                    const auto existing = children.find(key);
                    child.realExists = existing != children.end() &&
                        existing->second.isDirectory &&
                        existing->second.realExists;
                }
            }
            if (overrideExisting)
            {
                if (overlayChildNamesLower != nullptr)
                {
                    overlayChildNamesLower->insert(key);
                }
                children[key] = std::move(child);
            }
            else
            {
                children.emplace(key, std::move(child));
            }
        } while (FindNextFileW(find, &data) != 0);

        FindClose(find);

        (void)relLower;
        (void)displayRel;
    }

    VfsTree::PathLookup VfsTree::lookupPathLocked(
        const std::wstring& rel,
        const std::wstring& relLower) const
    {
        if (const auto dir = dirMap_.find(relLower);
            dir != dirMap_.end() && !dir->second.openPath.empty())
        {
            return PathLookup{
                PathInfo::Kind::Directory,
                dir->second.openPath,
                dir->second.realExists
            };
        }

        if (const auto file = fileMap_.find(relLower); file != fileMap_.end())
        {
            return PathLookup{PathInfo::Kind::File, file->second, false};
        }

        const std::wstring realPath = rel.empty() ? target_ : joinPath(target_, rel);
        const auto cacheDirectory = [&](const std::wstring& path)
        {
            DirNode& node = ensureDir(relLower);
            node.openPath = path;
            node.realExists = hasDirectoryAttributes(realPath);
            overlayMissRevisions_.erase(relLower);
            return PathLookup{PathInfo::Kind::Directory, path, node.realExists};
        };

        const auto cacheFile = [&](const std::wstring& path)
        {
            fileMap_[relLower] = path;
            overlayMissRevisions_.erase(relLower);
            return PathLookup{PathInfo::Kind::File, path, false};
        };

        const auto probe = [&](const std::wstring& path) -> PathLookup
        {
            DWORD attributes = INVALID_FILE_ATTRIBUTES;
            if (!readAttributes(path, attributes))
            {
                return {};
            }

            return (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0
                ? cacheDirectory(path)
                : cacheFile(path);
        };

        std::wstring parentLower;
        std::wstring nameLower;
        bool parentWasSeen = false;
        if (!relLower.empty())
        {
            const std::size_t separator = relLower.find_last_of(L'\\');
            parentLower = separator == std::wstring::npos
                ? std::wstring()
                : relLower.substr(0, separator);
            nameLower = separator == std::wstring::npos
                ? relLower
                : relLower.substr(separator + 1);

            std::size_t& parentLookupCount = parentLookupCounts_[parentLower];
            parentWasSeen = parentLookupCount > 0;
            ++parentLookupCount;
        }

        const auto lookupFromParentListing = [&]() -> PathLookup
        {
            if (relLower.empty())
            {
                return {};
            }

            const auto parentBeforeBuild = dirMap_.find(parentLower);
            if (parentBeforeBuild == dirMap_.end() || !parentBeforeBuild->second.childrenBuilt)
            {
                buildDirectoryLocked(parentLower);
            }

            if (const auto dir = dirMap_.find(relLower);
                dir != dirMap_.end() && !dir->second.openPath.empty())
            {
                return PathLookup{
                    PathInfo::Kind::Directory,
                    dir->second.openPath,
                    dir->second.realExists
                };
            }

            if (const auto file = fileMap_.find(relLower); file != fileMap_.end())
            {
                return PathLookup{PathInfo::Kind::File, file->second, false};
            }

            const auto parent = dirMap_.find(parentLower);
            if (parent != dirMap_.end() &&
                parent->second.childrenBuilt &&
                parent->second.overlayChildNamesLower.find(nameLower) ==
                    parent->second.overlayChildNamesLower.end())
            {
                cacheOverlayMissLocked(relLower);
            }

            return {};
        };

        if (!isExcludedRelativePath(relLower))
        {
            if (!overwrite_.empty())
            {
                if (PathLookup lookup = probe(rel.empty() ? overwrite_ : joinPath(overwrite_, rel));
                    lookup.kind != PathInfo::Kind::Unknown)
                {
                    return lookup;
                }
            }

            if (isWhiteoutedLocked(relLower))
            {
                return PathLookup{PathInfo::Kind::Whiteout, {}, false};
            }

            if (directoryListingProvesOverlayMissLocked(relLower))
            {
                cacheOverlayMissLocked(relLower);
            }
            else if (!hasCurrentOverlayMissLocked(relLower))
            {
                if (parentWasSeen)
                {
                    if (PathLookup lookup = lookupFromParentListing();
                        lookup.kind != PathInfo::Kind::Unknown)
                    {
                        return lookup;
                    }
                }

                if (!hasCurrentOverlayMissLocked(relLower))
                {
                    for (auto it = mods_.rbegin(); it != mods_.rend(); ++it)
                    {
                        if (PathLookup lookup = probe(rel.empty() ? *it : joinPath(*it, rel));
                            lookup.kind != PathInfo::Kind::Unknown)
                        {
                            return lookup;
                        }
                    }
                    cacheOverlayMissLocked(relLower);
                }
            }
        }

        if (relLower.empty() && hasDirectoryAttributes(realPath))
        {
            return cacheDirectory(realPath);
        }

        return {};
    }

    bool VfsTree::hasOverlayDirectoryLocked(
        const std::wstring& rel,
        const std::wstring& relLower) const
    {
        return lookupPathLocked(rel, relLower).kind == PathInfo::Kind::Directory;
    }

    void VfsTree::buildDirectoryLocked(const std::wstring& relLower) const
    {
        DirNode& node = ensureDir(relLower);
        if (node.childrenBuilt)
        {
            return;
        }

        std::unordered_map<std::wstring, DirChild> children;
        std::unordered_set<std::wstring> overlayChildNamesLower;
        const std::wstring displayRel = relLower;
        const std::wstring realDir = relLower.empty() ? target_ : joinPath(target_, displayRel);
        node.realExists = hasDirectoryAttributes(realDir);
        if (node.realExists && node.openPath.empty())
        {
            node.openPath = realDir;
        }
        if (node.realExists)
        {
            mergeDirectoryLocked(
                relLower,
                displayRel,
                realDir,
                /*overrideExisting=*/false,
                /*sourceIsReal=*/true,
                /*applyRootExclusions=*/false,
                children,
                nullptr);
        }

        if (!isExcludedRelativePath(relLower))
        {
            const bool applyRootExclusions = relLower.empty();
            for (const std::wstring& mod : mods_)
            {
                const std::wstring directory = relLower.empty() ? mod : joinPath(mod, displayRel);
                if (!hasDirectoryAttributes(directory))
                {
                    continue;
                }

                node.openPath = directory;
                mergeDirectoryLocked(
                    relLower,
                    displayRel,
                    directory,
                    /*overrideExisting=*/true,
                    /*sourceIsReal=*/false,
                    applyRootExclusions,
                    children,
                    &overlayChildNamesLower);
            }

            if (!overwrite_.empty())
            {
                const std::wstring directory = relLower.empty() ? overwrite_ : joinPath(overwrite_, displayRel);
                if (hasDirectoryAttributes(directory))
                {
                    node.openPath = directory;
                    mergeDirectoryLocked(
                        relLower,
                        displayRel,
                        directory,
                        /*overrideExisting=*/true,
                        /*sourceIsReal=*/false,
                        applyRootExclusions,
                        children,
                        &overlayChildNamesLower);
                }
            }
        }

        std::vector<DirChild> mergedChildren;
        node.overlayChildNamesLower = std::move(overlayChildNamesLower);
        mergedChildren.reserve(children.size());
        for (auto& [nameLower, child] : children)
        {
            const std::wstring childRelLower = relLower.empty()
                ? nameLower
                : relLower + L"\\" + nameLower;
            if (isWhiteoutedLocked(childRelLower))
            {
                fileMap_.erase(childRelLower);
                dirMap_.erase(childRelLower);
                continue;
            }
            if (child.isDirectory)
            {
                DirNode& childNode = ensureDir(childRelLower);
                childNode.openPath = child.realPath;
                childNode.realExists = child.realExists;
                fileMap_.erase(childRelLower);
            }
            else
            {
                fileMap_[childRelLower] = child.realPath;
            }
            mergedChildren.push_back(std::move(child));
        }

        std::sort(mergedChildren.begin(), mergedChildren.end(),
            [](const DirChild& a, const DirChild& b)
            {
                return a.nameLower < b.nameLower;
            });
        node.children = std::make_shared<const std::vector<DirChild>>(std::move(mergedChildren));
        node.childrenBuilt = true;
    }

    void VfsTree::build(const VfsMountConfig& config)
    {
        std::scoped_lock lock(cacheMutex_);
        target_ = normalizeRootPath(config.target);
        overwrite_ = normalizeRootPath(config.overwrite);
        whiteoutRoot_ = normalizeRootPath(config.whiteoutRoot);
        mods_.clear();
        mods_.reserve(config.mods.size());
        for (const std::wstring& mod : config.mods)
        {
            const std::wstring root = normalizeRootPath(mod);
            if (hasDirectoryAttributes(root))
            {
                mods_.push_back(root);
            }
        }

        excludedRootNames_.clear();
        excludedRootNames_.reserve(config.excludedRootNames.size());
        for (const std::wstring& name : config.excludedRootNames)
        {
            const std::wstring normalized = normalizeRel(name);
            if (!normalized.empty() && normalized.find(L'\\') == std::wstring::npos)
            {
                excludedRootNames_.push_back(toLower(normalized));
            }
        }

        fileMap_.clear();
        dirMap_.clear();
        overlayMissRevisions_.clear();
        parentLookupCounts_.clear();
        ++revision_;
        ensureDir(L"");
        built_ = true;

        VfsLog::writef(
            L"VfsTree initialized lazily: %zu overlay roots, target=%s",
            mods_.size() + (overwrite_.empty() ? 0 : 1),
            target_.c_str());
    }

    bool VfsTree::isVirtualDir(const std::wstring& relLower) const
    {
        const std::wstring rel = normalizeRel(relLower);
        const std::wstring key = toLower(rel);
        std::scoped_lock lock(cacheMutex_);
        if (key.empty())
        {
            return dirMap_.find(L"") != dirMap_.end();
        }
        if (const auto existing = dirMap_.find(key);
            existing != dirMap_.end() && !existing->second.openPath.empty())
        {
            return true;
        }

        if (isExcludedRelativePath(key))
        {
            return false;
        }

        return hasOverlayDirectoryLocked(rel, key);
    }

    VfsTree::DirectoryListing VfsTree::listing(const std::wstring& relLower) const
    {
        const std::wstring rel = normalizeRel(relLower);
        const std::wstring key = toLower(rel);
        std::scoped_lock lock(cacheMutex_);
        buildDirectoryLocked(key);
        const auto it = dirMap_.find(key);
        return it == dirMap_.end() || !it->second.children
            ? emptyListing()
            : it->second.children;
    }

    void VfsTree::notifyMutation(const std::wstring& rel)
    {
        const std::wstring key = toLower(normalizeRel(rel));
        std::scoped_lock lock(cacheMutex_);
        ++revision_;
        fileMap_.erase(key);
        overlayMissRevisions_.erase(key);
        parentLookupCounts_.erase(key);

        const std::size_t separator = key.find_last_of(L'\\');
        const std::wstring parent = separator == std::wstring::npos
            ? std::wstring()
            : key.substr(0, separator);
        parentLookupCounts_.erase(parent);
        overlayMissRevisions_.erase(parent);
        if (auto node = dirMap_.find(parent); node != dirMap_.end())
        {
            node->second.childrenBuilt = false;
            node->second.children.reset();
            node->second.overlayChildNamesLower.clear();
        }
        if (auto node = dirMap_.find(key); node != dirMap_.end())
        {
            node->second.childrenBuilt = false;
            node->second.children.reset();
            node->second.overlayChildNamesLower.clear();
        }
    }

    VfsTree::PathInfo VfsTree::classify(const std::wstring& rel) const
    {
        const std::wstring relN = normalizeRel(rel);
        const std::wstring key = toLower(relN);
        std::scoped_lock lock(cacheMutex_);

        const PathLookup lookup = lookupPathLocked(relN, key);
        if (lookup.kind == PathInfo::Kind::Directory)
        {
            PathInfo info;
            info.kind = PathInfo::Kind::Directory;
            info.winner = lookup.path;
            info.directoryRealExists = lookup.realExists;
            return info;
        }
        if (lookup.kind == PathInfo::Kind::File)
        {
            PathInfo info;
            info.kind = PathInfo::Kind::File;
            info.winner = lookup.path;
            return info;
        }
        if (lookup.kind == PathInfo::Kind::Whiteout)
        {
            PathInfo info;
            info.kind = PathInfo::Kind::Whiteout;
            return info;
        }

        PathInfo info;
        info.kind = PathInfo::Kind::Unknown;
        const auto slash = key.find_last_of(L'\\');
        const std::wstring parentLower = slash == std::wstring::npos ? std::wstring() : key.substr(0, slash);
        if (parentLower.empty())
        {
            info.parentVirtual = dirMap_.find(L"") != dirMap_.end();
        }
        else
        {
            const auto relSlash = relN.find_last_of(L'\\');
            const std::wstring parentRel = relSlash == std::wstring::npos ? std::wstring() : relN.substr(0, relSlash);
            info.parentVirtual = hasOverlayDirectoryLocked(parentRel, parentLower);
        }
        return info;
    }
}
