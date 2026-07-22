# Fluxora VFS contract

This document records the compatibility boundary between game definitions, the C++ launch planner,
the injected x64 VFS, and materialized launch caches. It is intentionally independent of any one
Skyrim mod or file extension.

## Game definition schema 2

`contentLayout.mountRules` is the single declarative source for installer placement and VFS mounts.
Each `GameVfsMountRule` declares a source (`active-mods`, `profile-settings`, or `profile-saves`), a
target base, a target path, optional source wrappers, and whether the rule is the primary content
root. Exactly one rule must be primary.

For every active mod, the complete mod directory is a source of the primary content mount. Known
wrappers such as `Data` and `root` add higher-priority views of the same mod. The precedence order is:

1. active-mod load order;
2. wrapper priority within that mod;
3. the unwrapped mod root.

Only structural containers (`Data`, `root`, and `.flow`) are excluded from the unwrapped primary
view. File extensions and unknown subdirectories are never filtered. Profile settings, saves, the
game root, Documents, Local AppData, and Roaming AppData are expressed by mount rules rather than
game-specific path logic in the VFS service. Schema 1 definitions are adapted in memory; new or
edited definitions use schema 2.

## Runtime descriptor schema 4

The launch planner writes a schema 4 descriptor for the injected VFS. Every mount includes its
target, ordered sources, overwrite root, and `whiteoutRoot`. The descriptor also carries an
`operationId` and launch preparation duration. The injected layer chooses the most-specific mount
target, compares paths case-insensitively, supports relative NT handles, merges directory listings,
and redirects mutations to overwrite storage.

Deleting or renaming a lower-layer path creates a whiteout; recreating that path clears the
whiteout. Copy-on-write applies to normal writes, truncation, rename/replace, delete,
delete-on-close, and child processes injected by the launcher. VFS logs contain session/prelaunch
summaries and counters, not per-read or per-enumeration traces.

## Materialized launch cache manifest schema 2

Directories listed in `materializedLaunchCacheDirectories` are physical launch-cache inputs, not VFS
exclusions. Before obsolete cache files are cleaned, the reconciler compares the cache with the
manifest baseline:

- an added or changed cache file is atomically copied to overwrite;
- a baseline file deleted from the cache creates a whiteout;
- unchanged files are reused;
- reparse points, unsafe paths, and reconciliation failures fail closed while preserving the cache.

Schema 1 manifests are migrated on the next successful reconciliation. Schema 2 records
`baselineFiles`, allowing changes made by native tools or the game during the previous launch to be
recovered before cache refresh.

## Validation boundary

The native x64 acceptance probe covers unknown directories/extensions, wrapper and load-order
precedence, PBR assets, case-insensitive reads, relative handles, merged enumeration, copy-on-write,
append/truncate, long Unicode paths, rename/replace, delete, delete-on-close, and inherited child
process injection. The opt-in Foundation acceptance tests additionally exercise cache recovery and a
real PBR mesh/descriptor/texture chain without launching the game or modifying source mods.
