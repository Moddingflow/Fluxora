#pragma once

#include "FluxoraVfs/VfsConfig.hpp"

#include <windows.h>

#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace fluxora::vfs
{
    // One merged child entry of a virtual directory. Metadata is captured once,
    // while the tree is built, so directory enumeration needs no per-call I/O.
    struct DirChild
    {
        std::wstring name;       // display name, original case
        std::wstring nameLower;  // normalized lowercase lookup key
        std::wstring realPath;   // absolute backing path on disk
        bool isDirectory{false};
        bool realExists{false};  // for directories: the real game folder has this child too
        ULONG attributes{FILE_ATTRIBUTE_NORMAL};
        LARGE_INTEGER creationTime{};
        LARGE_INTEGER lastAccessTime{};
        LARGE_INTEGER lastWriteTime{};
        LARGE_INTEGER endOfFile{};
        LARGE_INTEGER allocationSize{};
    };

    // The merged, read-mostly view of one virtualized game directory.
    //
    // It is assembled once when the DLL is injected: every enabled mod (in load
    // order) plus the writable overwrite overlay are walked and merged on top of
    // the real game directory. Files contributed by a later mod win over earlier
    // mods, and any mod wins over the real game file. Only directories actually
    // touched by a mod are "virtualized"; every other path falls straight through
    // to the real disk, so the cost is proportional to the mods, not the game.
    class VfsTree final
    {
    public:
        VfsTree() = default;
        VfsTree(const VfsTree&) = delete;
        VfsTree& operator=(const VfsTree&) = delete;
        VfsTree(VfsTree&& other) noexcept;
        VfsTree& operator=(VfsTree&& other) noexcept;

        // What a path under the mount target maps to in the merged tree.
        struct PathInfo
        {
            enum class Kind
            {
                Unknown,   // not provided by any mod / overlay
                Whiteout,  // explicitly deleted from the merged view
                File,
                Directory
            };

            Kind kind{Kind::Unknown};
            std::wstring winner;       // File: backing file; Directory: a real dir to open
            bool directoryRealExists{false}; // Directory also exists in the real game folder
            bool parentVirtual{false}; // Unknown: its parent directory is virtualized
        };

        void build(const VfsMountConfig& config);

        [[nodiscard]] const std::wstring& target() const noexcept { return target_; }
        [[nodiscard]] const std::wstring& overwrite() const noexcept { return overwrite_; }
        [[nodiscard]] const std::wstring& whiteoutRoot() const noexcept { return whiteoutRoot_; }
        [[nodiscard]] bool isBuilt() const noexcept { return built_; }

        // True when `relLower` names a file the mount source owns. Owned files
        // bypass the overwrite overlay in both directions, so the source copy
        // can never be shadowed by a stale fork written during an earlier run.
        [[nodiscard]] bool isOwnedFile(const std::wstring& relLower) const;

        // Absolute path an owned file resolves to: the highest-priority source
        // that declares it, otherwise the last source (where it is created).
        // Empty when the path is not owned or the mount has no source.
        [[nodiscard]] std::wstring ownedFilePath(const std::wstring& rel) const;

        // Pure lookup: classify a path (relative to the mount target, backslashes,
        // "" = the data directory itself). The hooks turn this into a concrete
        // open/redirect decision and perform any disk side effects themselves.
        [[nodiscard]] PathInfo classify(const std::wstring& rel) const;

        // True when `relLower` (a lowercase, normalized relative path) is a
        // directory whose listing must be synthesized from the merged tree.
        [[nodiscard]] bool isVirtualDir(const std::wstring& relLower) const;

        // Merged, name-sorted children of a virtual directory. Built lazily per
        // directory so hook install does not need to materialize every mod file.
        // The snapshot is immutable and shared by directory enumeration callers.
        using DirectoryListing = std::shared_ptr<const std::vector<DirChild>>;
        [[nodiscard]] DirectoryListing listing(const std::wstring& relLower) const;

        // Invalidates lazy lookup/enumeration caches after a redirected write,
        // rename or delete changes the mutable overlay during the session.
        void notifyMutation(const std::wstring& rel);

        // Path helpers shared with the hooks.
        [[nodiscard]] static std::wstring toLower(std::wstring value);
        [[nodiscard]] static std::wstring normalizeRel(std::wstring rel);
        [[nodiscard]] static bool equalsIgnoreCase(const std::wstring& a, const std::wstring& b);
        [[nodiscard]] static bool wildcardMatch(std::wstring_view name, std::wstring_view pattern);

#ifdef FLUXORA_VFS_TEST_HOOKS
        static void resetAttributeProbeCountForTests();
        [[nodiscard]] static std::uint64_t attributeProbeCountForTests();
#endif

    private:
        struct DirNode
        {
            bool realExists{false};        // the real game directory has this path
            std::wstring openPath;         // an existing directory to back a handle
            bool childrenBuilt{false};
            DirectoryListing children;
            std::unordered_set<std::wstring> overlayChildNamesLower;
        };

        struct PathLookup
        {
            PathInfo::Kind kind{PathInfo::Kind::Unknown};
            std::wstring path;
            bool realExists{false};
        };

        [[nodiscard]] PathLookup lookupPathLocked(
            const std::wstring& rel,
            const std::wstring& relLower) const;
        void buildDirectoryLocked(const std::wstring& relLower) const;
        void mergeDirectoryLocked(
            const std::wstring& relLower,
            const std::wstring& displayRel,
            const std::wstring& directory,
            bool overrideExisting,
            bool sourceIsReal,
            bool applyRootExclusions,
            bool skipOwnedFiles,
            std::unordered_map<std::wstring, DirChild>& children,
            std::unordered_set<std::wstring>* overlayChildNamesLower) const;
        DirNode& ensureDir(const std::wstring& relLower) const;
        [[nodiscard]] bool isExcludedTopLevelName(const std::wstring& name) const;
        [[nodiscard]] bool isExcludedRelativePath(const std::wstring& relLower) const;
        [[nodiscard]] bool isWhiteoutedLocked(const std::wstring& relLower) const;
        [[nodiscard]] bool hasOverlayDirectoryLocked(
            const std::wstring& rel,
            const std::wstring& relLower) const;
        [[nodiscard]] bool hasCurrentOverlayMissLocked(const std::wstring& relLower) const;
        void cacheOverlayMissLocked(const std::wstring& relLower) const;
        [[nodiscard]] bool directoryListingProvesOverlayMissLocked(const std::wstring& relLower) const;

        std::wstring target_;
        std::wstring overwrite_;
        std::wstring whiteoutRoot_;
        std::vector<std::wstring> mods_;
        std::vector<std::wstring> excludedRootNames_;
        std::unordered_set<std::wstring> ownedFilesLower_;

        mutable std::mutex cacheMutex_;
        // rel(lower) -> winning backing file path. Populated on demand.
        mutable std::unordered_map<std::wstring, std::wstring> fileMap_;
        // rel(lower) -> directory node. "" is the data root.
        mutable std::unordered_map<std::wstring, DirNode> dirMap_;
        // rel(lower) -> mount revision where no enabled mod provides this path.
        mutable std::unordered_map<std::wstring, std::uint64_t> overlayMissRevisions_;
        // parent rel(lower) -> lookup count since the last mount rebuild. The
        // first child keeps the cheap direct probe path; later siblings amortize
        // by building the parent listing once.
        mutable std::unordered_map<std::wstring, std::size_t> parentLookupCounts_;

        bool built_{false};
        std::uint64_t revision_{0};
    };
}
