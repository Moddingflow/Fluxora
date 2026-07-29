# Fluxora Tauri + C++ bridge architecture

Дата решения: 2026-06-24; NIF preview transport update: 2026-07-13; global Downloads catalog update: 2026-07-16

Статус: Phase 14 Bridge/API surface and cross-platform capability model implemented on top of the Phase 1 decision. This document is the bridge/source-of-truth companion to `docs/tauri-migration/wpf-ui-inventory.md` and `docs/tauri-migration/cross-platform-support.md`.

## Decision summary

Fluxora uses typed, lane-affine native bridge-host processes between Tauri main and the C++ core. Each lane starts its own `FluxoraBridgeHost` lazily and keeps the renderer contract unchanged:

```text
Tauri renderer
  -> facade Tauri invoke facade API
  -> Tauri main command handlers
  -> TypeScript bridge client
  -> FluxoraBridgeHost native process
  -> FluxoraCore.dll / libFluxoraCore.so / libFluxoraCore.dylib
  -> C++ services
```

The bridge protocol is `fluxora.bridge.v1`, carried as JSON-RPC-style messages over the host process stdio stream for the first implementation. The bridge client and host must keep the transport behind a small interface so named pipe or Unix domain socket transport can replace stdio later without changing renderer contracts.

The renderer never loads native modules, never receives direct Node.js access, never performs filesystem mutations, and never owns domain decisions. Tauri contains UI state, window/app lifecycle, safe command exposure, native dialogs, shell-open behavior, and typed orchestration only. C++ remains the only owner of project, mod, plugin, download, install, VFS, FluxPack, Nexus, profile, executable, filesystem and operation behavior.

## Phase 4 Bridge MVP

Phase 4 implements the first working slice of `fluxora.bridge.v1`:

- Native host target: `FluxoraBridgeHost`.
- Tauri main service: `NativeBridgeService` starts the host, performs handshake, owns request metadata and writes Tauri main/bridge logs.
- Preload API: renderer sees only `window.fluxora.bridge.getStatus`, `getLanguage`, `setLanguage` and `shutdown`.
- Renderer startup creates an `operationId`, writes a separate Tauri UI log entry and shows either `Native bridge ready` or a clear fallback error.
- Language get/set goes through the C++ C ABI (`fluxora_get_app_language`, `fluxora_set_app_language`) and the app settings service.
- The C ABI now includes `fluxora_core_shutdown` so the host can shut the core/logger down before process exit.
- `operations.cancel` is present in the protocol MVP. Generic native operation cancellation still reports unsupported, while MO2 transfer uses the Tauri shell cancel marker plus C++ import cleanup path.

## Phase 5 Project Shell MVP

Phase 5 extends the first bridge slice to cover the build catalog and creation entry path:

- Native host routes `templates.list`, `templates.resolve`, `projects.listConfigs`, `projects.openConfig`, `projects.previewDirectory`, `projects.create`, `projects.rename` and `projects.delete` to existing C++ C ABI functions.
- Tauri Rust shell/facade expose typed `window.fluxora.templates.*` and `window.fluxora.projects.*` calls only; renderer still has no Node.js, filesystem or raw command access.
- Tauri Rust shell owns native file/folder dialogs, shell-open and frameless window controls through allowlisted facade APIs.
- Renderer owns only catalog state, local search/filter text, selected-build state, wizard fields, confirmation prompts and visual loading/error/empty states.
- Project mutations still create an `operationId` in renderer/main and flow through the bridge request metadata into the C++ operation context.

## Phase 6 Workspace Mods MVP

Phase 6 extends `fluxora.bridge.v1` to the installed-mod workspace:

- Native host routes `mods.listInstalled`, `mods.getOrder`, the interactive aggregate read `mods.getPersistedWorkspace`, the reconciling aggregate read `mods.getWorkspace`, watcher-driven `mods.invalidateFileCaches`, `mods.createSeparator`, `mods.deleteSeparator`, `mods.moveOrderItem`, `mods.renameInstalled`, `mods.deleteInstalled`, `mods.createEmpty`, `mods.setEnabled`, `mods.setAllEnabled`, `mods.checkUpdates`, `mods.clearOverwrite`, `mods.getFileTree`, `mods.getModDetailsContent`, `mods.getEffectiveFileTree`, `mods.getEffectiveFileTreeRoot`, `mods.getEffectiveFileTreeChildren`, `mods.getModDetailsSummary`, `mods.getModConflictTree`, `mods.startNifPreview`, `mods.prepareNifPreviewVariant` and `mods.prepareNifPreviewTextures` to C++ C ABI functions.
- Tauri Rust shell/facade expose typed `window.fluxora.mods.*` calls only; renderer still has no Node.js, filesystem or raw command access.
- Renderer owns local mod search, selection, row action menus, scroll windowing and expanded file-tree state.
- C++ core remains the owner of installed mod records, profile order, enabled state, separator persistence, update checks, file tree indexing and filesystem mutations.
- Nexus update checking is file-level and core-owned. latestVersion is the version label of the resolved Nexus file, never the mod-page version, and hasUpdate compares opaque file IDs. Only installed records with a complete (gameDomain, modId, fileId) Nexus identity are eligible; profile membership and enabled state do not filter them. Local, ModdingFlow and incomplete records are left unchanged.
- ModUpdateService groups records by (gameDomain, modId), resolves the complete file_updates chain with cycle/branch guards, excludes old/deleted/archived targets, and uses a same-category/is_primary fallback only when it is unambiguous. Failures preserve the last durable latestVersion and latestFileId. The service uses the OAuth-refreshing Nexus auth service through an internal production/fake NexusUpdateApi; ModService performs no Nexus HTTP.
- The shared %APPDATA%\Fluxora\nexus-update-cache.sqlite3 stores only file identity/version/category/update-link, recent-update, quota and retry metadata and prunes entries unused for 90 days. It does not store descriptions, changelogs or credentials. Automatic checks use a 24-hour per-game sweep TTL and Nexus mods/updated (1w/1m) with a five-minute overlap after the initial/full baseline. Manual checks bypass the daily sweep TTL while retaining the short shared cache, quota reserve and retry policy.
- Renderer scheduling keeps the 24-hour automatic lane silent, including partial authentication/quota outcomes, and schedules the next normal attempt instead of exposing internal baseline/recheck states. An explicit manual check supersedes and cancels an in-flight automatic check before starting its own cache-bypassing request. The Mods table always renders the durable latestVersion when known and otherwise uses the installed version as the last-known value; `baseline_pending` and `recheck_required` are synchronization metadata, not user-facing status badges.
- Metadata calls use a quota probe followed by at most four concurrent requests. New requests stop at the larger of 10% or 100 remaining requests, on HTTP 429/auth failure, cancellation, or network backoff. The C ABI v2 request/result/progress envelope carries mode, typed state/reason, quota, counters and per-mod values; the legacy manual C ABI entry point adapts through the same service.
- The renderer starts the silent automatic coordinator only after the selected build's mod workspace is ready. It deduplicates checks, schedules the next run while the app remains open, cancels the prior operation on build switch and rejects stale results by build generation. Only the Latest/file-update fields are merged for the same build; manual checks use the same coordinator and retain explicit user feedback.
- The regular selected-mod file tree in the main workspace remains lazy by `relativeDirectory`. The dedicated mod-properties window uses the explicit `mods.getModDetailsContent` read instead: C++ returns all directory pages and both conflict groups from the prepared SQLite file index in one immutable snapshot. The renderer starts this read on the first row click, treats the second rapid click as the open gesture, and deduplicates both calls. Tauri routes this one interactive read through the safe-read `BridgeProcess` lane so it cannot wait behind long main-lane reconciliation such as `mods.getWorkspace`; the shared lifecycle command shuts down every lazily started lane host. The Rust shell then injects the completed snapshot before the properties webview parses its application scripts. This keeps filesystem/index ownership in C++, removes per-folder and bridge-queue races, and lets the Files and Conflicts tabs render without intermediate loading states.
- Effective game-root Data pages are lazy on cold cache: `mods.getEffectiveFileTreeRoot` and `mods.getEffectiveFileTreeChildren` return shallow bounded pages without preparing a full recursive index. Full `mods.getEffectiveFileTree` and `build.prepareWorkspaceIndexes` remain explicit heavy index operations with a long bridge timeout and are not run during build open.
- `mods.getPersistedWorkspace` returns installed rows and profile order from the last durable file-index generation with zero live inventory synchronization. It is the normal T3 renderer path and may expose deferred (`fileCount = -1`) summaries for never-indexed mods. An absent or incomplete persisted snapshot triggers one exact `mods.getWorkspace` fallback before T3; otherwise `mods.getWorkspace` performs exact offline file-index reconciliation in T4. The build-content watcher is installed before the first workspace read, remains active across same-project reopens, and turns setup errors, event-sequence gaps, or watcher errors into conservative reconciliation instead of trusting a potentially incomplete delta.
- `mods.invalidateFileCaches` accepts deduplicated affected mod-folder paths, clears per-mod file-index generation state plus VFS placement/plugin discovery caches, and must complete before watcher-triggered mod-workspace/effective-tree reads. A watcher plugin read may run first on the isolated Plugin lane only when that request explicitly clears the Plugin-lane discovery cache; the exact post-mod reconciliation repeats the plugin read so a newly discovered mod cannot be missed. Failed invalidation batches remain queued and retry autonomously with a bounded delay even when no later watcher event arrives. These calls carry an operation id and keep bridge/UI/core performance logging separate.

### NIF preview session transport

The public renderer contract is session-based: `startNifPreview`, `prepareNifPreviewVariant`, `prepareNifPreviewTextures`, `readNifPreviewAssetBytes` and `endNifPreview`. The old `mods.readPreviewAsset` Base64/JSON response and `mods.listPreviewVariants` route do not exist. Public handles contain only an opaque token, byte size, MIME type, relative path, display source and content fingerprint. Absolute filesystem paths remain private between C++ and the Rust shell.

C++ resolves all requested textures in one case-insensitive batch using overwrite, enabled profile mods in reverse priority, and Game Data. BSA/BA2 indexes are cached by canonical path + size + mtime fingerprint. Extracted archive assets are finalized atomically in the versioned 512 MiB local LRU; a changed archive fingerprint invalidates both its index and extracted assets.

Tauri Rust owns opaque session/variant/asset tokens and serves asset bytes with `tauri::ipc::Response`, outside JSON serialization. Every token is bound to the preview window label that created it; another window cannot prepare, read or end that session. NIF methods use the interactive bridge lane and retain one `operationId` for the complete session. Limits are 64 paths per batch, 64 MiB per asset and 256 MiB per session. Sessions end explicitly when the preview source changes or unmounts, on preview-window close, or after 15 minutes idle.

The file-preview window receives the project directory directly from the typed `window.fluxora.windowControls.openFilePreview` call. Preview startup therefore does not depend on the secondary renderer reloading or matching the global project catalog before it can call `startNifPreview`.

The renderer transfers NIF parsing and BC1-BC5 software fallback decoding to a Web Worker. It swaps in neutral geometry before requesting one texture batch, reads prepared assets with concurrency 3 and applies textures progressively. Generation tokens reject stale variant work while the previous model remains visible until replacement geometry is ready. The renderer LRU is bounded to 64 textures and 256 MiB raw bytes.

The complete preview path is local-only: it adds no upload, telemetry, account data or external service. Archive indexes, extracted assets and renderer caches stay on the user's device, so this change does not require a privacy policy or terms update.

## Phase 7 Plugins/Load Order MVP

Phase 7 extends `fluxora.bridge.v1` to the plugin/load-order workspace:

- Native host routes `plugins.listPersisted`, `plugins.list`, `plugins.move`, `plugins.createSeparator`, `plugins.deleteSeparator`, `plugins.setEnabled` and `plugins.setAllEnabled` to C++ C ABI functions backed by `PluginService`. Plugin list reads use an isolated Plugin bridge lane; watcher reads may set the additive `forceDiscoveryRefresh` parameter so that lane clears its own process-local discovery cache before scanning.
- Tauri Rust shell/facade expose typed `window.fluxora.plugins.*` calls only; renderer still has no Node.js, filesystem or raw command access.
- Renderer owns local plugin search, selection, row action menus, scroll windowing, selected-plugin details and capability explanation only.
- C++ core remains the owner of plugin detection, active plugin state, base-plugin locks, missing masters, separator persistence and load-order mutation rules.
- T3 uses `plugins.listPersisted`, which reads durable profile state and base-plugin rules without live mod/plugin discovery. After exact mod reconciliation, T4 calls `plugins.list` to discover offline additions/removals and refresh source/master diagnostics. A failed T4 refresh leaves the committed persisted rows usable.
- The renderer intersects bridge capability availability with the selected build's game capabilities. Unsupported games show an explanatory capability state instead of an empty broken panel.

## Phase 8 Downloads, NXM And Archive Install MVP

Phase 8 extends `fluxora.bridge.v1` to downloads and simple archive install:

- Native host routes `downloads.list`, `downloads.importFile`, `downloads.rename`, `downloads.delete`, `downloads.cancel`, `downloads.resume`, `downloads.resolveDuplicateDecision`, `downloads.planInstall`, `downloads.install`, `archives.planInstall`, `archives.install`, `nxm.registerProtocol`, `nxm.captureLinks` and `nxm.importInboundDownloads` to C++ C ABI functions backed by `DownloadService`.
- Tauri Rust shell/facade expose typed `window.fluxora.downloads.*`, `window.fluxora.archives.*` and `window.fluxora.nxm.*` calls only; renderer still has no Node.js, filesystem, shell or raw command access.
- Tauri Rust shell owns `nxm://` app activation handling through startup argv and Windows/Linux/macOS `second-instance`, forwards links to the bridge inbound queue, then emits `fluxora:nxm:inbound-links-captured` so the renderer can import the queued links into the active build.
- Renderer auto-registers the Windows `nxm://` handler once per session when a Nexus account is linked, while the Downloads workspace still exposes the manual `Register NXM` fallback.
- Renderer owns local download search, selection, row context menus, double-click install trigger, selected-download details and platform capability messaging only.
- C++ core remains the owner of NXM capture/import, local archive import, download transfer state, cancel/resume/delete and archive/download install behavior.
- Phase 8 intentionally keeps install UX to the simple path: ready archive/download plus mod name and fail-if-existing mode. Replace/merge, editable placement overrides and FOMOD wizard are the Phase 9 scope.

## Phase 9 Install UX, Placement Details And FOMOD MVP

Phase 9 extends `fluxora.bridge.v1` from simple install to the full WPF parity install flow:

- Native host routes `downloads.analyzeContentLayout`, `downloads.analyzeFomod`, `downloads.analyzeFomodContentLayout`, `downloads.installFomod` and `archives.installFomod` to existing C++ C ABI functions backed by `DownloadService`, `FomodInstallerService` and `ContentLayoutService`.
- Tauri Rust shell/facade expose typed install-analysis and FOMOD methods only; renderer still has no Node.js, filesystem, shell, native module or raw command access.
- Renderer owns the modal flow, scrollable FOMOD step navigation/selection state, automatic previous-selection replay, replace/merge choice, local mod-name validation display and HTML drag/drop archive placement override collection.
- C++ core remains the owner of archive extraction, FOMOD descriptor evaluation inputs, content-layout analysis, placement override validation, existing-mod replace/merge behavior and final filesystem mutation.
- After a successful FOMOD install, C++ persists the applied option ids in `<project>/.flow/fomod-memory.json`; the next analysis returns those ids and the renderer restores them before applying required/default coercion. Preview files are copied by C++ only when the referenced package image exists, under the dedicated `.fomod-previews` cache. The typed facade converts those native paths to Tauri asset URLs, while `assetProtocol.scope` exposes only `**/.fomod-previews/**/*`; missing or failed images render no placeholder surface.
- FOMOD detection is index-first and payload-size independent for ordinary archives. ZIP uses its validated native central-directory index; externally handled formats such as 7z use a bounded 7-Zip include probe for `fomod/ModuleConfig.xml`. A conclusive negative probe persists as an empty fingerprinted metadata cache entry, so neither the initial analysis nor the background identity plan extracts the archive. Positive FOMOD archives retain the existing full descriptor, declared-plugin-header, preview, Smart Select and safety behavior and materialize metadata at most once. Strong archive identity comes from the catalog SHA-256 sidecar only while its file-id/size/write/change identity still matches; the core hashes again when that durable proof is absent or stale.
- Placement details send the additive v2 edit DTO `{ schemaVersion, files, directories, excludedSourcePaths }` back to core. File moves remain `{ sourcePath, target, targetRelativePath }` records, while disabled tree branches serialize their archive source paths in `excludedSourcePaths`. C++ keeps excluded rows in the preview, validates the final enabled layout and omits excluded payloads during materialization; the renderer never moves or deletes archive files directly.
- Skyrim placement assessment is `ready`, `warning` or `blocked`. A safe but unrecognized/non-standard layout is a conspicuous non-blocking warning and installs exactly as shown; only unsafe paths, collisions or other concrete blockers disable Install.
- `downloads.planInstall` and `archives.planInstall` accept additive optional `profileName` and `modName` fields and return a `FluxoraInstallPlan` with `suggestedModName`, `resolutionKind`, optional `matchedTarget { modUuid, displayName, folderName }`, opaque `resolutionId`, the FOMOD descriptor, bounded evidence codes and score. The C++ `ModIdentityResolver` owns all source/FOMOD/name/content scoring, stable-id conflict handling, threshold/margin decisions and the indexed top-five candidate lookup. A unique exact final-name collision remains a `Probable` prompt target even when stable Nexus mod ids differ; it never auto-merges or auto-replaces.
- The renderer tracks the mod-name source as `source | fomod | identity | user`. An asynchronous plan may replace the value only before the user edits it. Before mutation, a user-edited name that is not covered by the background plan is replanned once through the native core with the same `operationId`; this catches collisions with another installed mod while keeping domain matching out of the renderer. FOMOD module names remain authoritative and skip the generic verification screen; a matched identity opens only the existing-mod choice with `Заменить`, `Объединить` and `Это другой мод`.
- All four install mutations carry the opaque `resolutionId`, `identityDecision: use-match | install-new`, optional target mod UUID and `newNamePolicy: first-free-copy-suffix`. C++ validates archive fingerprint, catalog revision and target UUID immediately before mutation and again before commit. A stale plan maps to retryable `install.identityPlanStale`; the renderer replans without overwriting a user-edited name.
- `use-match` preserves the matched mod UUID, display name and folder. `install-new` allocates the first free case-insensitive display/folder pair (`Name`, `Name (2)`, `Name (3)`, ...), including unmanaged disk-folder collisions, under `InstallProjectGate`, target/archive locks and the process-local native install commit lock, so the main and install bridge hosts cannot allocate, commit or delete the same target concurrently. A rejected target is stored as an exclusion and is not copied into the new mod's confirmed aliases. If the same stable source id belongs to multiple separate mods, exclusions do not make that source unique again: automatic selection still requires an additional name or content signal.
- If an archive has no stable source id, local indexed/name/content resolution runs first. Only when that result remains unmatched or ambiguous, a game domain is known and Nexus is connected may C++ perform a bounded best-effort Nexus MD5 lookup. SHA-256 and MD5 are calculated in one cached file pass; only MD5 plus game domain are sent. A response is accepted only when exactly one entry matches both the selected game domain and the locally checked archive size; network failure, quota failure, timeout, missing size or ambiguity keeps the local plan. Fingerprint-scoped incoming-content and successful online results are cached in SQLite and naturally miss after archive content changes. Legal resources disclose this optional transfer in English, German and Russian.

### Instant install conflict projection

- Renderer install mutations use durable `installs.submit`; the four synchronous `downloads.install*` / `archives.install*` methods remain native-test compatibility adapters. `InstallScheduler` owns two C++ heavy-worker slots. A same-target waiter is parked outside those slots; extraction, FOMOD evaluation and staging can overlap while the short directory/metadata commit is serialized.
- `InstallConflictPreviewService` receives exact final staging inventories after layout, manual overrides or FOMOD resolution. All ready/committing sessions of the selected profile are ordered by `enqueueSequence` and projected together, so pending mods conflict with one another and every emitted snapshot contains the aggregate relation patches. Install New projects a virtual owner; Replace substitutes the target file set; Merge uses the union. Renderer never predicts ownership from archive contents.
- SQLite schema 12 stores resumable operations in `install_operations` and permits multiple `pending_install_sessions`. Both records retain stable `beforeOrderId` / `afterOrderId` anchors and `enqueueSequence`; `targetPosition` is migration fallback only. Operation payloads include the archive fingerprint, identity plan, FOMOD selection/manual decisions/context, placement overrides, target, progress, typed error and result.
- Operation states are `queued`, `validating`, `extracting`, `configuringFomod`, `buildingStaging`, `projectingConflicts`, `waitingTarget`, `committing`, `finalizing`, `recovering`, `needsReview`, `completed`, `failed` and `cancelled`. `installs.progress` carries the complete `installOperation`; `installs.list/get` remain authoritative after a missed event or restart.
- Renderer keeps pending sessions in a map keyed by `operationId`, inserts the optimistic row before awaiting `installs.submit`, animates it only on first insertion and preserves the existing row for Replace/Merge. A `needsReview` status reopens the installer with persisted session decisions; terminal failure removes a new row or restores the original Replace/Merge fields.
- `mods.rebasePendingInstall` accepts stable neighbor anchors plus a fallback index. One missing neighbor uses the other; Replace/Merge retain the original mod UUID and profile-order row id, and metadata finalization aborts if either identity changes.
- Regular and FOMOD Merge build a complete replacement staging directory while holding the target lock. Directory publication and SQLite finalization share a cross-process project gate with inventory/order mutations. The fixed acquisition order is target lock, project gate, then SQLite storage lock.
- `.flow/install-transactions/<operationId>.json` records prepared, target-backed-up, promoted and committed stages. Restore removes only journal-confirmed staging, rolls back a confirmed backup/promotion when needed, preserves committed targets, and returns unknown or unsafe paths as `needsReview` without deleting them.
- Atomic target publication retries transient Windows access/sharing/lock failures with bounded backoff. If the target remains busy, the original mod and persisted installer decisions remain intact and the durable operation becomes `needsReview` with `install.targetBusy`, so the same session can be retried instead of ending as a generic failure.
- If the process exits after SQLite/order finalization but before the terminal operation result is published, restore reconstructs the installed-mod result from the completed pending session and persisted profile row. A committed target that cannot be matched safely becomes `needsReview`; the renderer never creates a pending projection for a terminal restored operation, so restart cannot leave a ghost row or duplicate the matched mod.
- While an install is `committing` or `finalizing`, the Tauri watcher accumulates changed paths. Release schedules one deduplicated reconciliation. The Rust bridge process has a permanent stdout reader and synchronized line writer, so install progress continues without an active request.
- Deleting a renderer row owned by a pending install first retires its optimistic projection and calls `installs.cancel` on the install lane. Queued work is removed before execution; running work observes cooperative cancellation before commit and persists the terminal `cancelled` state. If cancellation arrives after the directory was committed, the terminal operation retains its authoritative install result so the delete flow can remove that exact target before reconciliation. Replace/Merge deletion falls back to the original target only when cancellation stopped before a new result was committed.
- The additive C ABI exports include durable install submit/restore/list/get and anchor-aware pending rebase; existing progress-capable synchronous install exports remain compatibility adapters through the same implementation.
- Preview inventories, pending rows and logs stay local. Progress/log records carry operation id, stage, revision, duration, file/conflict counts and no absolute file paths. This feature adds no telemetry, upload, account data or external service, so it does not require a privacy policy or terms update.

### Revisioned workspace and download reconciliation

- `workspace.getDelta(projectDirectory, profileName, sinceRevision, request)` is an additive `fluxora.bridge.v1` read owned by `WorkspaceRevisionJournal` in the C++ core. The returned `FluxoraWorkspaceDelta` carries project/profile scope, `operationId`, monotonic `sequence`, matching mod/plugin `baseRevision` and `revision`, upserts, removals, stable before/after placements, installed-mod summaries and `fullResyncRequired`.
- The journal persists a bounded history under the build-local `.fluxora/revision-journal` directory with atomic replacement. A process restart can continue from a retained revision; an unknown, stale, corrupt or unavailable history returns `fullResyncRequired` instead of guessing a delta. Workspace and download revision streams are scope-separated and Unicode-safe.
- Terminal `installs.progress` includes the authoritative workspace delta produced after native commit/finalization. The renderer removes the keyed pending projection and applies that delta in one non-urgent transition; it does not issue `mods.getWorkspace` or `plugins.list` merely to discover the committed mod or generated plugins. The original install `operationId` is validated through C++ core, bridge host, Rust shell/facade and renderer.
- `downloads.getDelta(projectDirectory, sinceRevision, reason, request)` runs on the Download lane. The Tauri folder watcher establishes a baseline once, debounces filesystem notifications for 100 ms, advances the native revision, and emits typed `fluxora:downloads:changed` events. Each changed row carries an authoritative native placement so a completed or replaced download can move to its activity-sorted position without a full list read. The facade coalesces non-terminal upserts and placements by download id on the next display frame, while removals, terminal states and `fullResyncRequired` flush immediately. This replaces the former 500 ms `downloads.list` loop; full list reads remain only for initial load and recovery.
- Renderer delta application validates scope, operation identity when supplied, base revision, shared mod/plugin revision and exact next sequence. Duplicate revision/sequence pairs are ignored. A gap queues exactly one compatibility full resync, and that resync is retained but deferred until both adaptive lists report scroll-ended.
- Watcher reconciliation invalidates affected native caches first, requests one workspace delta, and deduplicates by scope/sequence/revision. The terminal install delta is installed before the Rust watcher releases its accumulated paths, so the following watcher delta is incremental rather than a second full snapshot.
- Renderer list state preserves unchanged DTO and row-view identities. `ModsListSurface`, `PluginsListSurface`, `ModRow` and `PluginRow` are explicitly memoized; install presentation is held in an `operationId`-keyed `useSyncExternalStore` store. Authoritative deltas use one-pass `orderId` indexes and non-urgent React transitions, while the adaptive virtualizer keeps scroll/window state urgent and local.
- This contract is local-only: the durable journal, benchmark aggregate and separated UI/bridge/core/operation logs are not telemetry and are never uploaded. No privacy-policy or terms update is required.

### FOMOD Smart Select

- `FomodProfileContextService` builds an immutable snapshot for the selected profile and only resolves paths named by the FOMOD. It preserves exact `Active`, `Inactive` and `Missing` states, the winning mod/game owner, persisted plugin enablement, game version and supported script-extender versions. PE version reads and complete profile snapshots are bounded, revision-aware caches.
- `FomodAutoSelectionService` is the sole owner of automatic decisions. It evaluates module/game/FOMM/SKSE/FOSE/NVSE/F4SE dependencies with `satisfied | unsatisfied | unknown`, applies hard FOMOD rules before manual pins, profile evidence, independent memory and author defaults, and iterates condition flags, visibility and dependency types to a fixed point. Cycles and ambiguous exclusive groups remain manual; `CouldBeUsable` is never guessed.
- TES4 evidence is read only from declared `.esp`, `.esm` and `.esl` option outputs and acts as a compatibility guard, not as a positive recommendation: an active or selected master never promotes an `Optional` choice by itself, while an unavailable master prevents an otherwise recommended choice from being selected automatically. ZIP reads are capped at 8 MiB per header, 256 candidates and 64 MiB total; corrupt, encrypted, oversized or over-budget entries become review evidence without making an otherwise valid FOMOD un-installable.
- `fomod-memory.json` schema v3 uses provider/game/mod identity plus the descriptor structure fingerprint as its composite family identity. Nexus `fileId`, archive name and display name are excluded, so matching variants share decisions while a different FOMOD structure on the same page does not. Exact profile fingerprints restore the full selection; a changed profile carries only manual context-independent decisions. Legacy entries are accepted only when their option ids exist in the current descriptor, and long-term memory is written only after successful directory and metadata commit.
- The additive profile-aware contract carries `profileName` through analyze/plan/layout/install and adds `FluxoraFomodProfileContext`, structured option decisions/evidence, `fomodContextId` and manual decisions. Legacy C ABI exports and typed-facade overloads remain available while new exports carry the richer contract.
- Context plans are bound to project, profile, archive content fingerprint and mod/plugin revisions for at most 30 minutes and 128 entries. Install validates that binding before file mutation. `install.fomodContextChanged` performs no write; the renderer refreshes the open wizard, retains valid manual decisions and requires the user to press `Установить` again.
- Renderer remains presentation-only: it displays the compact Smart Select summary, per-option accessible status and `Почему выбрано`, and exposes `Пересчитать` plus `Вернуть автоподбор`. FOMOD module names stay authoritative, there is no generic verification screen, and the last step still enters the existing fast interactive install lane directly.
- Smart Select is fully local: no model, network, telemetry, name inference or description inference. `FomodAutoSelect` logs contain operation correlation, duration and reason-code counts, never absolute paths; this feature does not change privacy or terms requirements.

## Phase 10 Profiles And Executables MVP

Phase 10 extends `fluxora.bridge.v1` to WPF-parity profile management and executable launch configuration:

- Native host routes `profiles.list`, `profiles.create`, `profiles.clone`, `profiles.rename`, `profiles.delete`, `executables.list`, `executables.save`, `executables.getIcon`, `executables.launch` and `executables.completeManagedLaunch` to existing C++ C ABI functions backed by `ProfileService`, `ExecutableService`, `BodySlideIntegrationService` and `LodGeneratorIntegrationService`.
- Managed BodySlide, TexGen and DynDOLOD launches route `executables.completeManagedLaunch` to the background bridge lane. BodySlide owns its config overlay and single generated output; see [BodySlide integration](../integrations/bodyslide.md). TexGen/DynDOLOD automatically create and order `TexGen Output` before `DynDOLOD Output`, enforce `-sse` and a safe virtual `-o`, stage writes through VFS, and atomically publish only a successful non-empty run; see [TexGen and DynDOLOD integration](../integrations/dyndolod-texgen.md).
- Tauri Rust shell/facade expose typed `window.fluxora.profiles.*` and `window.fluxora.executables.*` calls only; renderer still has no Node.js, filesystem, shell, native module or raw command access.
- Tauri Rust shell owns `window.fluxora.processes.waitForLaunchReady` and `waitForExit`. On Windows, process exit uses the signaled process handle as the primary path (`WaitForSingleObject` with an infinite wait on a dedicated native-wait thread); a 250 ms process-presence poll is retained only when the native wait cannot be established. After each exit, the shell enumerates live processes with `FluxoraVfs.dll` loaded and returns the next holder as `trackedKind: "vfsHolder"`, so the renderer keeps the launch splash attached to the process that still owns the active VFS session.
- Renderer owns profile/executable search, selected-row state, in-app edit controls, two-step destructive confirmation state, icon/launch status display and capability explanations only.
- Renderer closes the launch splash as soon as the final tracked/VFS process exits and refreshes the mods workspace asynchronously afterward; a slow workspace read must not extend the process-locking screen.
- C++ core remains the owner of profile folder/state mutations, executable metadata persistence, icon resolving, launch cache preparation and process launch behavior.
- Executable management and executable launch are exposed as separate capability flags so non-Windows bridge builds can still edit launch entries while honestly disabling launch.

## Phase 11 Settings, Nexus Mods And MO2 Transfer MVP

Phase 11 extends `fluxora.bridge.v1` to WPF-parity settings and MO2 transfer:

- Native host routes `settings.getTheme`, `settings.setTheme`, generic `connections.listStatus`, `connections.restoreAll`, `connections.connect`, `connections.disconnect`, the compatible `nexus.*` surface, `transfer.analyzeMo2` and `transfer.importMo2` to C++ C ABI functions backed by `AppSettingsService`, `ExternalConnectionService`, `NexusModsAuthService` and `ModOrganizerImportService`; the Tauri shell handles `operations.cancel` for MO2 transfer by writing an operation cancel marker outside the bridge request mutex. The theme contract currently normalizes every value to the single supported dark theme.
- `ExternalConnectionService` is the core-owned provider registry. Its renderer-safe snapshot uses `notConfigured | notLinked | restoring | ready | temporarilyUnavailable | reauthRequired`, restores linked providers in parallel under one native `2.5 s` deadline and returns non-linked providers from local state without network work. Nexus is the first adapter; future providers register another adapter instead of adding renderer-specific connection logic.
- The main renderer publishes `connections.listStatus` before network restoration, gates only catalog/workspace loading on `connections.restoreAll` under the shell `3 s` timeout, and retries retryable providers after `2/5/15/30/60 s` and then every five minutes. Online, focus and visible-window events request one deduplicated immediate retry. Secondary windows do not run this startup coordinator and restoration never opens OAuth consent automatically.
- `NexusModsAuthService` uses the public OAuth client id `fluxora` by default, but trusted runs may override the OAuth client id through `FLUXORA_NEXUS_CLIENT_ID`, `NEXUS_CLIENT_ID`, `NEXUS_OAUTH_CLIENT_ID` or the Fluxora Supabase credential RPC/table using secret names `NEXUS_CLIENT_ID` / `NEXUS_OAUTH_CLIENT_ID`.
- When Nexus requires a confidential `client_secret` during token exchange, the C++ service resolves it from `FLUXORA_NEXUS_CLIENT_SECRET`, `NEXUS_CLIENT_SECRET`, `NEXUS_OAUTH_CLIENT_SECRET` or the Fluxora Supabase credential RPC/table using secret names `NEXUS_CLIENT_SECRET` / `NEXUS_OAUTH_CLIENT_SECRET`; the secret is never exposed through the Tauri renderer facade or bridge DTOs.
- Nexus OAuth uses the registered loopback callback `http://127.0.0.1:8089/callback` by default. `FLUXORA_NEXUS_REDIRECT_URI`, `NEXUS_REDIRECT_URI`, `NEXUS_OAUTH_REDIRECT_URI` or matching Fluxora Supabase credential entries may override it for a different registered client, but the authorize and token exchange requests must use the exact same redirect URI.
- Nexus downloads use the linked account automatically after OAuth login. `DownloadService` obtains its request credential through `NexusModsAuthService` immediately before Nexus API/transfer calls, so expired OAuth access tokens are refreshed instead of being copied directly from persisted settings; refresh-token rotation is serialized across concurrent native requests. C++ protects OAuth tokens locally and can still accept a legacy `apikey` credential through `nexus.connectWithApiKey` for compatibility, but the renderer must not require users to paste a Personal API Key during the normal connection flow.
- Tauri routes generic connection calls and compatible Nexus status/connect/disconnect calls through the dedicated connection bridge lane. Interactive OAuth connect keeps a 180-second request envelope around the native 120-second loopback-listener deadline plus token exchange, so it neither inherits the normal 10-second bridge timeout nor blocks main, background, download, install or safe-read work. `apiLimits.list` remains background work and does not determine whether a provider is `ready`.
- OAuth refresh outcomes are typed. Offline, timeout, DNS and 5xx failures produce retryable `temporarilyUnavailable` while preserving stored credentials; missing refresh credentials, `invalid_grant`, a rejected API key and a repeated `401` after successful refresh persist `reauthRequired` and stop automatic retries. Logs contain provider id, state, duration, attempt and `operationId`, never tokens, API keys or account payloads.
- Settings API limit display uses generic `apiLimits.list` provider/window DTOs. The first provider is backed by `NexusModsAuthService`, which performs a small authenticated quota-bearing Nexus API request and reports only the quota headers returned by Nexus (`X-RL-*`, standard `X-RateLimit-*` / `RateLimit-*`, `Retry-After`), never hardcoded quota values or renderer-visible credentials. Future API providers should append another provider entry to the same snapshot instead of creating provider-specific settings UI.
- AI Nexus research also uses the linked account automatically, but only through a trusted native-only path: Tauri main asks `FluxoraBridgeHost` for a transient Nexus API auth header, injects it into the AI host request as private `nativeNexusApiCredential`, and removes any renderer-supplied value before dispatch. The generic renderer bridge command rejects `nexus.getApiAuthHeader`, so API keys and OAuth tokens are never exposed through `window.fluxora` or stored in renderer state. If no Nexus account is linked, Nexus API research remains unavailable and the AI report must show that as missing credential evidence instead of pretending it searched.
- Native host emits `operations.progress` JSON-RPC events during MO2 import. Tauri main subscribes through the bridge client and broadcasts them on the allowlisted `fluxora:operations:progress` channel.
- Tauri Rust shell/facade expose typed `window.fluxora.settings.*`, `window.fluxora.connections.*`, compatible `window.fluxora.nexus.*`, `window.fluxora.transfer.*` and `window.fluxora.operations.*` calls only; renderer still has no Node.js, filesystem, shell, native module or raw command access. Nexus API-key compatibility and NXM protocol handling remain provider-specific and outside the generic connection DTO.
- Renderer owns settings section state, language controls, single-theme mirroring into CSS, generic provider snapshot display, MO2 source/destination form state, analysis display, transfer progress display and route/close guard while transfer is running. Connection readiness, API limits and mod-update results are separate state machines. Theme customization controls are deferred until more supported themes are added.
- C++ core remains the owner of persisted app settings, Nexus OAuth status/connect/disconnect behavior, MO2 analysis/import rules, disk-space checks, project creation/replacement, transfer cancellation checks and filesystem cleanup.
- MO2 transfer cancellation is scoped to the transfer operation: the renderer enables `Отменить и очистить` for a running transfer, Tauri writes a marker keyed by `operationId`, and C++ stops before activation or during copy/database work and removes staging files through the existing import failure cleanup path.

## Phase 12 Build Settings, FluxPack And Build Operations MVP

Phase 12 extends `fluxora.bridge.v1` to WPF-parity build path settings and FluxPack workflows:

- Native host routes `buildPaths.get`, `buildPaths.save`, `fluxPack.export`, `fluxPack.inspect`, `fluxPack.planInstall` and `fluxPack.install` to C++ C ABI functions backed by `BuildPathSettingsService`, `ExecutableService`, `FluxPackService`, `DownloadService`, `NexusModsAuthService` and `ProjectService`.
- New exports use the FluxPack v3 content-store container. Every mod/config path remains a distinct manifest entry, while its bytes reference SHA-256-addressed chunks that are stored once and materialized as ordinary independent files during install. Large files use normalized content-defined chunking (`fastcdc`, 64 KiB minimum, 256 KiB average, 1 MiB maximum), so local insertions can reuse the unchanged chunk sequence instead of duplicating the rest of the file.
- Export exposes `packageType: "full" | "recipe"`. `full` embeds every installed mod plus generated/local/config content and emits no remote source requirements, so install is autonomous. `recipe` keeps reproducible remote identities as source references and embeds only the local payload that cannot be reacquired; Nexus Premium may be automatic, while other/free-account sources use the existing validated manual flow. Full packages force generated assets into the payload even if an older caller sends `includeGeneratedAssets: false`.
- Each unique chunk uses adaptive Zstandard compression at the library's `ZSTD_maxCLevel()`; compression is no longer user-selectable. DDS/BSA/BA2/ZIP/7z/OGG/audio/video inputs are probed first and remain raw when the sample does not save at least one percent; every other chunk also falls back to raw storage when compression would not produce a meaningful gain. Small INI/JSON/XML files are grouped by extension into shared content chunks, exact duplicates share a slice, and a trained type dictionary is stored/applied only when total stored bytes decrease. Install reuses one Zstandard decompression context and streams verified chunks to ordinary independent files.
- Inspect/install remain backward-compatible with FluxPack v2 containers and bounded legacy v1 JSON recipes; missing `packageType` defaults to `recipe`, while a package advertised as `full` is rejected if it still contains remote source requirements. Oversized legacy manifests fail with an actionable re-export error instead of exhausting memory. Inspect summaries expose package type, bundled/source counts, compression mode, logical/unique/stored/deduplicated bytes, chunk count, and dictionary count.
- `fluxPack.install` accepts optional `existingConfigPath`. When it is present, C++ verifies the game template and updates that exact build instead of allocating a suffixed project. Source mods are reused only when the target folder and strong remote file identity match; enabled state is synchronized without reinstalling. A matching archive in the shared game catalog is reused only after file-name, size and SHA-256 validation. Embedded mod/config files are reused only after size and SHA-256 validation; changed payloads are validated in a temporary file and promoted atomically, while changed source mods use the existing replace-install path. Unreferenced user mods/files are preserved conservatively instead of being pruned without prior FluxPack ownership state. Create-new installs allocate a unique suffixed project name when the recipe name already exists.
- `fluxPack.planInstall` returns a source-level acquisition plan before mutation. Each source is classified as `installed`, `cached-download`, `source-build`, `automatic`, `manual` or `unavailable`. A linked Nexus account is automatic only when the native verified account state is Premium; free accounts receive the Nexus file page and the renderer collects a user-selected archive. Manual archive source ids, paths, file sizes and SHA-256 hashes are validated by C++ before a project is created or updated.
- Delta results expose `updatedExistingProject`, `reusedSourceCount`, `reusedDownloadCount`, `reusedFileCount` and `materializedFileCount`. The legacy `fluxora_install_fluxpack` ABI remains a create-new wrapper; `fluxora_install_fluxpack_with_target` remains compatible, while additive `fluxora_install_fluxpack_with_options_and_progress` carries the optional existing config and validated manual source archives through the native host.
- Native host now calls `fluxora_delete_project_with_progress` for `projects.delete` and emits `operations.progress` events for project deletion.
- Native host emits `operations.progress` events during FluxPack export and install. Export reports bounded, monotonic phases for build analysis, file inventory, streamed payload copy, compact description writing and atomic finalization; install keeps provider/source progress. The renderer presents provider sectors proportionally by source count, uses Nexus orange for Nexus sectors and assigns stable fallback colors to future providers. The final response still remains authoritative.
- Tauri Rust shell/facade expose typed `window.fluxora.buildPaths.*`, `window.fluxora.fluxPack.*` and `.fluxpack` native open/save dialogs only; renderer still has no Node.js, filesystem, shell, native module or raw command access.
- Renderer owns the Build Paths inspector, primary executable form state, native browse/save/open dialog orchestration, FluxPack summary display, same-name choice dialog, manual-download queue and operation overlays. C++ core remains the owner of path persistence, executable persistence, FluxPack recipe creation, package inspection, acquisition planning, Premium eligibility, package install, provider/source handling, archive validation and filesystem mutation.
- Generic operation cancellation remains capability-reported as unsupported until each operation has a cancellable C++ path. Build creation/deletion and FluxPack overlays show close/cancel rules honestly: close is disabled while running, and cancel is disabled unless the bridge capability reports support.

## Global Downloads library and per-build archive states

The Downloads surface uses one game-scoped archive library at `<Fluxora.exe directory>/Downloads/<gameId>`. The Rust shell derives the actual executable directory and passes it to every Bridge Host as `FLUXORA_APP_ROOT`; C++ validates the canonical game id and writable root and never falls back to a build-local folder. Builds for the same game therefore see the same physical files, while different game ids remain isolated. Existing `<build>/downloads` folders are ignored, not migrated and not deleted; users can explicitly import those files through the normal archive-import action.

- `BuildPathSettingsService` returns `downloadsDirectory` as computed read-only project information for watchers, FluxPack, AI context and other consumers. `buildPaths.save` accepts legacy `downloadsDirectory`/`downloadsPath` input for compatibility but ignores it and omits it from the next `.fluxora/paths.json` write. The renderer exposes the computed path and an allowlisted shell-open action, not a path picker.
- `ArchiveCatalogService` is the single C++ entry point for NXM/Nexus completion, drag-and-drop, Import file, Install archive, FluxPack manual sources and Mod Organizer imports. An external archive is imported before analysis or install. MO2 rollback removes only files newly created by that import operation.
- A completed archive has `archiveId = sha256:<lowercase hash>`. SHA-256 and source metadata are cached locally in sidecars. Equal bytes deduplicate to the existing catalog object; a same-name/different-content collision becomes `<stem>-<hash8>.<ext>`. More authoritative Nexus/source identities are not replaced by weaker local metadata.
- A Nexus archive update is recognized for an exact `(gameDomain, modId)` pair and a single proven `file_updates` chain. When both cached and fresh Nexus lineage are unavailable, the core may use the narrower local fallback of the same normalized archive display name (including removal of Fluxora's numeric copy suffix) plus comparable non-empty file versions. This fallback only opens the existing Replace/Keep both/Cancel decision; it never deletes or replaces an archive automatically. Available Nexus lineage remains authoritative, so a proven parallel branch stays independent even when display names match. Cyclic, ambiguous or branching available lineage is treated as a different file.
- Repeating the same `fileId` persists an explicit `same-file` decision instead of silently returning an already `Installed` row. The dialog shows the archive file name once, without a repeated version suffix, and offers only Replace; the close button and Escape dismiss the pending request. Dismissal leaves the existing archive and installed mod unchanged. Replace revalidates the snapshot, atomically stages the existing archive out of the visible catalog before transfer, downloads to the original file name without a numeric copy suffix, and removes the staged copy after the new archive and metadata are complete. A failed transfer restores the staged archive. Archive-level Keep both is unavailable because it would only create an identical byte-for-byte copy.
- A proven update or identical-file reinstall persists `transferState: "awaiting-decision"` plus an opaque `decisionId`, direction and incoming/existing file snapshot in the pending sidecar before yielding the NXM worker and all five transfer permits. `downloads.resolveDuplicateDecision` accepts `replace | keepBoth | cancel` with the request `operationId`; the renderer queues one accessible dialog at a time and keeps the pending row visible as `Нужно решение`.
- Replace revalidates the snapshot under a lineage lock and `ArchiveUseGuard`. An identical-file replacement stages its existing archive immediately and reuses the exact original name with rollback on transfer/finalization failure; version upgrades and downgrades continue downloading and verifying the new archive before older versions are removed. Keep both follows normal collision naming and SHA-256 deduplication. Cancel, Escape and dialog close delete only the pending NXM request and sidecars. None of these choices changes an installed mod or its build history.
- Explorer-added files remain visible while an asynchronous hash job reports `transferState: "indexing"`. External duplicates are not removed automatically, but identical SHA-256 values resolve to the same per-build state.
- Each build's SQLite schema v8 stores archive-to-mod link history and active install attempts. State priority is `Installing` for an active attempt, `Installed` while at least one current linked installed/disabled mod remains, `Deleted` when prior links exist but none remain current, otherwise `Ready`. Replace/Merge deactivates the target mod's previous archive link and registers the new one atomically. Failed/canceled attempts are removed, and stale attempts are cleared when a build is opened.
- Global sidecar `installedModName`/legacy status fields remain read-compatible metadata only; they do not decide whether an archive is installed in the selected build. History remains in the build database after the physical archive is deleted, so reimporting equal bytes restores the computed `Installed` or `Deleted` result.
- The typed `FluxoraDownloadEntry` contract contains `archiveId: string | null`, `buildStatus: "Ready" | "Installing" | "Installed" | "Deleted" | null`, `transferState: "idle" | "queued" | "awaiting-decision" | "downloading" | "paused" | "canceled" | "indexing" | "failed"`, `duplicateDecision: FluxoraDownloadDuplicateDecision | null`, `transferMessage`, and the existing progress fields. The legacy free-form `status` field is not serialized. Incomplete transfers have `buildStatus: null`; older sidecars remain readable without migration.
- Renderer state applies an immediate optimistic `Installing` badge, then refreshes from C++. Transfer/progress information takes visual priority while the exact English build badge remains available. Switching builds changes only per-build badges over the same game catalog.
- Physical archive deletion warns that the file disappears for every build of that game while installed mods stay in place. It is rejected while that SHA-256 is downloading or held by an install in any process/build.
- Import, install, delete and status mutations continue carrying `operationId`. Transfer, install, bridge, core, operation and crash events keep their existing separated logs.
- New FluxPack manifests do not emit `installPlan.targetPaths.downloadsDirectory`; legacy manifests with the field remain readable, and archive reuse resolves through the shared catalog.

## NGIO Grass Cache Generation

The Skyrim-only No Grass In Objects integration extends `fluxora.bridge.v1` with `grassCache.generate` backed by `GrassCacheService` in C++:

- Native host routes `grassCache.generate` to `fluxora_generate_ngio_grass_cache` and emits `operations.progress` events during marker setup, SKSE launch/restart, output collection and mod registration.
- Tauri Rust shell/facade expose typed `window.fluxora.grassCache.generate` only; renderer still has no filesystem, shell, process or direct `invoke` access.
- Renderer owns only the visibility button, localized tooltip, custom confirmation dialog and operation overlay.
- C++ core remains the owner of Skyrim/NGIO validation, `PrecacheGrass.txt`, SKSE/VFS launch, `overwrite/Grass` collection and generated mod creation at `<build name> · Grass Cache`. The generation marker is published through `overwrite/root/PrecacheGrass.txt`, which keeps it visible above any lower `game-root` whiteout left by an earlier Root Builder/VFS launch.
- C++ core treats NGIO generation as complete only after the managed root-overlay `PrecacheGrass.txt` disappears and `overwrite/Grass` contains output; partial `Grass` output while the marker remains is treated as an incomplete run that must restart. A physical marker copy in the root-launch cache is diagnostic only and cannot decide completion.
- While Skyrim is running, the process runner polls the managed marker and profile-isolated `documents/SKSE/NGIO-NG.log`. Appended `cell_` records supply completed-cell activity, and NGIO's current-world percentage is projected into a monotonic overall percentage for the existing determinate operation progress bar.
- Ordinary Skyrim launches remove stale VFS-visible `PrecacheGrass.txt` markers from the game root, `overwrite/root`, and root-launch cache before SKSE starts so NGIO does not resume unless the user requested grass-cache generation.
- C++ core checks the operation cancel marker and the Tauri manager process before each launch/restart so closing Fluxora or cancelling the operation stops the generation loop before another Skyrim launch.
- The bridge capability key is `grassCacheGeneration`; unsupported platforms or bridge builds disable the visible action with a reason.

Implemented MVP methods:

- `system.handshake`
- `system.initialize`
- `system.shutdown`
- `system.getCapabilities`
- `system.getCoreStatus`
- `settings.getLanguage`
- `settings.setLanguage`
- `settings.getTheme`
- `settings.setTheme`
- `templates.list`
- `templates.resolve`
- `projects.previewDirectory`
- `projects.create`
- `projects.openConfig`
- `projects.listConfigs`
- `projects.rename`
- `projects.delete`
- `buildPaths.get`
- `buildPaths.save`
- `build.prepareWorkspaceIndexes`
- `fluxPack.export`
- `fluxPack.inspect`
- `fluxPack.install`
- `grassCache.generate`
- `mods.listInstalled`
- `mods.getOrder`
- `mods.getWorkspace`
- `mods.getPersistedWorkspace`
- `workspace.getDelta`
- `mods.invalidateFileCaches`
- `mods.createSeparator`
- `mods.deleteSeparator`
- `mods.moveOrderItem`
- `mods.rebasePendingInstall`
- `mods.deleteInstalled`
- `mods.renameInstalled`
- `mods.createEmpty`
- `mods.setEnabled`
- `mods.setAllEnabled`
- `mods.checkUpdates`
- `mods.clearOverwrite`
- `mods.getFileTree`
- `mods.getModDetailsContent`
- `mods.getEffectiveFileTree`
- `mods.getEffectiveFileTreeRoot`
- `mods.getEffectiveFileTreeChildren`
- `mods.getModDetailsSummary`
- `mods.getModConflictTree`
- `mods.startNifPreview`
- `mods.prepareNifPreviewVariant`
- `mods.prepareNifPreviewTextures`
- `plugins.list`
- `plugins.move`
- `plugins.createSeparator`
- `plugins.deleteSeparator`
- `plugins.setEnabled`
- `plugins.setAllEnabled`
- `profiles.list`
- `profiles.create`
- `profiles.clone`
- `profiles.rename`
- `profiles.delete`
- `executables.list`
- `executables.save`
- `executables.getIcon`
- `executables.launch`
- `executables.completeManagedLaunch`
- `nexus.getAuthStatus`
- `apiLimits.list`
- `nexus.connect`
- `nexus.connectWithApiKey`
- `nexus.disconnect`
- `transfer.analyzeMo2`
- `transfer.importMo2`
- `downloads.list`
- `downloads.getDelta`
- `downloads.importFile`
- `downloads.delete`
- `downloads.rename`
- `downloads.cancel`
- `downloads.resume`
- `downloads.resolveDuplicateDecision`
- `downloads.analyzeContentLayout`
- `downloads.analyzeFomod`
- `downloads.analyzeFomodContentLayout`
- `downloads.planInstall`
- `downloads.install`
- `downloads.installFomod`
- `archives.planInstall`
- `archives.install`
- `archives.installFomod`
- `installs.submit`
- `installs.cancel`
- `installs.restore`
- `installs.list`
- `installs.get`
- `nxm.registerProtocol`
- `nxm.captureLinks`
- `nxm.importInboundDownloads`
- `operations.setContext`
- `operations.clearContext`
- `operations.progress`
- `operations.cancel`

`mods.createSeparator` treats a negative `targetIndex` as an append request resolved against the
current native profile order. The renderer uses this form for “create at end” so a stale renderer
snapshot cannot place a newly discovered last mod beneath the new separator.

`nxm.captureLinks` / `nxm.importInboundDownloads` return a download row as soon
as the pending request is durably captured. `FluxoraDownloadEntry.hasResolvedFileName`
is `false` until Nexus file-info resolves the archive display name; the renderer
must show a neutral pending label instead of exposing the internal `.nxm-pending`
filename and keeps a silent Downloads refresh active until the flag resolves.
For compatibility with an older host, the Tauri facade normalizes an absent
`hasResolvedFileName` field to `true`. File-info preflight and metadata persistence happen before a transfer
permit is acquired, while the short-lived download URL is requested only after
the permit is available. Automatic inbound import is a silent row upsert and
does not participate in the global Downloads mutation busy state.
When file-info proves that completed versions belong to the same Nexus lineage,
the pending row instead enters `awaiting-decision`. This state is durable across
restart but holds neither an NXM worker nor a transfer permit. Resolution stays
on the Download lane and preserves `fluxora.bridge.v1`; additive sidecar fields
carry the snapshot while the renderer-safe DTO omits internal hashes and lineage keys.

Logging paths remain separated:

- Tauri UI: `fluxora-tauri-ui-YYYYMMDD.log`
- Tauri main/bridge: `fluxora-tauri-main-bridge-YYYYMMDD.log`
- Native core: `fluxora-core-YYYYMMDD.log`
- Native operations: `fluxora-operations-YYYYMMDD.log`
- Native crash: `fluxora-crash-YYYYMMDD.log`

## Inputs reviewed

- `docs/tauri-migration/wpf-ui-inventory.md`
- `frontend/Services/CoreBridgeService.cs`
- `backend/include/FluxoraCore/FluxoraCoreApi.hpp`
- `backend/vfs/README.md`
- `backend/src/Services/VirtualFileSystemService.cpp`
- `backend/src/Services/DownloadService.cpp`
- Tauri security and native module documentation from Context7:
  - secure Tauri webview window/facade defaults with `contextIsolation`
  - `Tauri invoke facade` as the safe renderer exposure point
  - wrapped command methods instead of exposing `Tauri invoke`
  - Tauri native modules require Tauri ABI rebuilds

## Bridge options

### Option A: Direct Node native addon / N-API

Shape:

- Tauri main process imports a `.node` addon.
- The addon links to or wraps `FluxoraCore`.
- TypeScript calls addon functions directly from main.

Pros:

- One process fewer than a host process.
- Low call overhead for small request/response calls.
- Can expose typed functions to main with no text protocol.

Cons:

- Tauri native modules must match the Tauri Node/V8 ABI and be rebuilt or prebuilt per Tauri version, OS and architecture.
- A native crash can take down the Tauri app process.
- Packaging gets tied to Tauri's runtime details instead of Fluxora's core ABI.
- Long-running operations and progress/cancel streams still need separate lifecycle plumbing.
- It encourages treating the C ABI as the app contract, which makes renderer/main migration harder to version.

Decision:

- Not the product default for Phase 1.
- Can be revisited only for a narrow performance hotspot after the JSON-RPC host contract is proven insufficient.

### Option B: Native host process with JSON-RPC over stdin/stdout

Shape:

- Tauri Rust shell starts `FluxoraBridgeHost`.
- The host loads `FluxoraCore.dll`, `libFluxoraCore.so` or `libFluxoraCore.dylib`.
- Main sends newline-delimited JSON-RPC-style requests.
- The host returns responses and emits progress events on the same stream.

Pros:

- Strong process isolation: bridge/core crashes do not directly crash renderer/main.
- Tauri is not coupled to Node native addon ABI.
- Cross-platform packaging can keep the native core beside the host.
- Protocol envelopes make version negotiation, operation IDs, errors, progress and capabilities first-class.
- Easy to log the bridge boundary and replay protocol fixtures in tests.

Cons:

- Requires host lifecycle management: spawn, ready handshake, restart policy, shutdown, stderr handling, crash reporting.
- Requires careful framing and backpressure for large JSON payloads.
- Stdio is not ideal for very chatty or high-volume streams.

Decision:

- Chosen as `fluxora.bridge.v1`.
- Stdio is the initial transport.
- The TypeScript client and native host must hide transport details behind `BridgeTransport`.

### Option C: Local command through named pipe / Unix domain socket

Shape:

- Tauri main connects to a local named pipe on Windows and Unix domain socket on Linux/macOS.
- A native bridge host process or daemon serves typed requests/events.

Pros:

- Better fit for multiplexing large progress/event streams.
- Can support reconnect and multi-client patterns if needed later.
- Keeps process isolation.

Cons:

- More platform-specific lifecycle, permissions and cleanup.
- More complex startup and socket path management.
- More surface area to secure than stdio in the first skeleton.

Decision:

- Approved as the future transport option for `fluxora.bridge.v1.1+`.
- Do not expose socket details to renderer or app features.
- Use when stdio backpressure or event volume becomes a real limitation.

### Option D: Temporary P/Invoke-equivalent compatibility layer

Shape:

- Tauri main or a temporary helper mimics the current C# `CoreBridgeService` by calling exported C ABI functions directly.

Pros:

- Matches the existing WPF bridge shape.
- Useful as a migration reference while the host is being built.

Cons:

- Repeats the direct ABI coupling that Phase 1 is trying to remove.
- Does not solve Tauri ABI/security boundaries by itself.
- Harder to negotiate versions or expose platform capabilities cleanly.

Decision:

- Transition-only reference, not a production architecture.
- Existing `CoreBridgeService` and `FluxoraCoreApi.hpp` are the method and DTO inventory, not the new Tauri boundary.

## Chosen architecture

### Responsibility boundary

Tauri renderer owns:

- UI routes, visual components, table/tree/dialog state and selections.
- Form state and display validation.
- Search text, expanded/collapsed rows, local sorting/filtering where it does not mutate domain truth.
- Aggregation of core-provided download states into the primary window's taskbar progress view.
- Install/FOMOD/archive wizard screen flow, using evaluated DTOs from the bridge.

Tauri facade owns:

- A small `window.fluxora` API exposed through `Tauri invoke facade`.
- Argument/callback wrapping so renderer never sees `Tauri invoke` or Node primitives.
- Runtime shape validation before forwarding renderer calls to main.

Tauri Rust shell owns:

- Tauri webview window lifecycle, app startup/shutdown and single-instance behavior.
- Secure command allowlist.
- Native dialogs, external link handling, shell-open/show-in-folder behavior.
- Native taskbar/dock progress application through the Tauri window API.
- NXM/deep-link app activation capture and forwarding into bridge calls.
- Bridge host lifecycle: spawn, handshake, restart, crash reporting and shutdown.

TypeScript bridge client owns:

- Request IDs, timeout handling, cancellation requests and event subscription routing.
- DTO validation at the Tauri/main boundary.
- Mapping Tauri errors into renderer-safe errors.
- Bridge logs and operation correlation.

Native bridge host owns:

- Loading and calling `FluxoraCore`.
- Converting protocol requests into core calls.
- Enforcing one mutating core operation at a time until the C++ core explicitly supports broader concurrency.
- Emitting progress events.
- Translating `FluxoraCoreResult`, native exceptions and `fluxora_get_last_error` into structured error envelopes.
- Calling `fluxora_set_operation_context` before each core call and clearing it afterward.

C++ core owns:

- All business logic and all filesystem/project/profile/mod/plugin/download/install/VFS/FluxPack/Nexus behavior.
- Core, bridge, operation and crash logs.
- Platform-specific implementation details and capability truth.

## Tauri security baseline

Every production Tauri webview window must use:

- `contextIsolation: true`.
- `nodeIntegration: false`.
- `sandbox: true` unless a future feature has a documented exception.
- A facade script that exposes only typed, allowlisted methods through `Tauri invoke facade`.
- No raw `Tauri invoke`, `Tauri invoke.on`, `Tauri invoke.invoke`, `shell`, `fs`, `path` or `child_process` exposure to renderer.
- Async command only. No `sendSync`.
- Strict navigation control: app windows cannot navigate to arbitrary external origins.
- `window.open` denied by default. External HTTP(S) links go through main and `shell.openExternal` after scheme/URL allowlist checks.
- Content Security Policy in the renderer build.
- No remote module.

These rules follow the current Tauri guidance reviewed for Phase 1. They are acceptance criteria for Phase 2 bootstrap, but the architecture is already shaped around them here.

## Protocol v1

### Framing

Initial transport: newline-delimited UTF-8 JSON messages over host stdio.

Message forms:

```json
{ "jsonrpc": "2.0", "id": "req_01H...", "method": "projects.create", "params": {}, "meta": {} }
{ "jsonrpc": "2.0", "id": "req_01H...", "result": {}, "meta": {} }
{ "jsonrpc": "2.0", "id": "req_01H...", "error": {}, "meta": {} }
{ "jsonrpc": "2.0", "method": "operations.progress", "params": {}, "meta": {} }
```

All messages must be single-line JSON. Large response payloads are allowed but must respect the bridge client's maximum payload budget. If a payload is too large for smooth UI usage, the bridge method must become paged, filtered or incremental instead of pushing unbounded data into renderer.

### Request metadata

Every request metadata object includes:

```json
{
  "protocolVersion": "1.0",
  "operationId": "op_20260624_...",
  "requestSource": "tauri-main",
  "appVersion": "0.0.0-dev",
  "platform": "win32",
  "arch": "x64",
  "locale": "ru-RU"
}
```

Rules:

- `operationId` is required for user-triggered mutations and long-running reads.
- Tauri main creates or propagates operation IDs.
- The bridge host passes `operationId` into `fluxora_set_operation_context`.
- Bridge, core, operation and crash logs must include the same operation ID.

### Response envelope

Success:

```json
{
  "jsonrpc": "2.0",
  "id": "req_01H...",
  "result": {
    "ok": true,
    "data": {}
  },
  "meta": {
    "operationId": "op_20260624_...",
    "durationMs": 42
  }
}
```

Failure:

```json
{
  "jsonrpc": "2.0",
  "id": "req_01H...",
  "error": {
    "code": "core.invalidArgument",
    "message": "Build config path is required.",
    "category": "validation",
    "retryable": false,
    "capabilityId": null,
    "details": {}
  },
  "meta": {
    "operationId": "op_20260624_...",
    "durationMs": 12
  }
}
```

Error categories:

- `validation`: bad user input or missing required field.
- `core`: native core rejected or failed the operation.
- `capability`: feature unsupported on current platform/build/game.
- `notFound`: project/mod/download/profile/executable path no longer exists.
- `conflict`: existing mod, stale state, duplicate name, locked resource.
- `cancelled`: user cancellation or shutdown cancellation.
- `transport`: bridge process, framing, timeout or restart failure.
- `internal`: unexpected bridge host/main failure.

Renderer must display user-safe `message` and can use `category`, `code` and `capabilityId` for state. Stack traces, native file internals and raw stderr stay in logs.

### Progress events

Progress events are operation-scoped:

```json
{
  "jsonrpc": "2.0",
  "method": "operations.progress",
  "params": {
    "operationId": "op_20260624_...",
    "phase": "copying",
    "message": "Installing files",
    "current": 12,
    "total": 40,
    "percent": 30,
    "payload": {}
  },
  "meta": {
    "protocolVersion": "1.0"
  }
}
```

Rules:

- Progress events never replace the final response.
- Renderer subscribes by `operationId`.
- Progress payloads must be small and stable.
- Existing native callbacks from FluxPack, MO2 import and build deletion map into this event shape.

### AI run events

AI intermediate run events are intentionally not `operations.progress`.
`FluxoraAIHost` emits `ai.intermediateEvent` JSON-RPC notifications while a
`chat.respond`, `chat.beginToolRun`, or `chat.continueToolRun` request is in
flight. Tauri main recognizes those notifications on the AI host stdout stream,
validates the canonical
`fluxora.ai.intermediate-event.v1` DTO, redacts text and typed payload values,
logs the sanitized event on the AI host log with `operationId`, and emits the
renderer channel `fluxora:ai:run-event` for
`window.fluxora.ai.onRunEvent(callback)`.

The renderer-surface event contract carries `eventId`, `runId`, `operationId`,
monotonic `seq`, `createdAt`, canonical event `type`, `level`, `visibility`,
`stage`, `message`, optional `percent`, and optional typed redacted `payload`.
Supported v1 types are `progress`, `note`, `tool-started`, `tool-completed`,
`tool-blocked`, `recovery-started`, `verification-completed`, `site-visited`,
`error`, and `heartbeat`. `tool-completed` is valid only for `ok=true`. Tauri ignores unrelated JSON-RPC
notifications and provider-native event names instead of forwarding them.

AI events are for low-volume chat-run progress: prompt/context preparation,
local inspection, research route decisions, Nexus/web source capture or block,
provider attempts, finalization, heartbeat, and terminal blocked/error state.
For a request with a file workspace, a failed `chat.beginToolRun` is terminal
and must not trigger an independent `chat.respond`; the file-search started
event is emitted only after the provider accepts the declared tools. Events
never replace the final host response, expose raw provider deltas or tool
output, or carry provider credentials,
`nativeNexusApiCredential`, Nexus auth headers, cookies, tokens, raw prompts,
raw HTML/page bodies, provider response bodies, raw stdout/stderr, or full logs.
C++ remains the owner of domain operation progress and filesystem mutation
truth.

Gemini function declarations use provider-safe names from the AI host registry.
The unchanged bridge contract continues to use `local.*` names; Tauri receives
only those internal names. Provider calls are mapped to internal names before
dispatch, while matching function responses retain the provider name, call id,
and opaque thought signature. Every build task first declares one validated
goal through the host-owned `local.execution.declare_goal`; invalid output gets
one retry and then exact `intent-contract-invalid`. Local function rounds omit
`google_search`; host-owned web research uses a separate web-only request of the
same Gemini model because the provider rejects those tool families when combined
on that endpoint.
Invalid tool schemas, transport failures, rate
limits, and managed-gateway failures remain distinct typed errors. Their safe
payloads contain no prompt, local path, or provider response body.

The file loop uses `fluxora.ai.tool-session.v3`. The host validates
`answer | inspect | repair` plus `explicit | implicit | continuation`, maps
`repair` to compatible `action`/`local-required`, and filters declarations by
the goal's risk ceiling. Answer/inspect are read-only; an implicit repair may
use only read-only and reversible capabilities. Inferred domain and monotonic
phase remain diagnostics. Host-owned `local.execution.request_input` never
crosses into C++; it persists one active goal per renderer tab and a short
answer continues the same `goalId`. Mutations are staged without side effects and a
separate `local.files.commit` maps the whole batch to one native
`buildFiles.apply`. The Rust shell caches duplicate read-only calls, enforces 16
distinct targets and one mutation per target, and emits only redacted
`fluxora.ai.file-tool-diagnostics.v2`, including native-session preopen, goal
mode/risk/continuation, semantic-evidence/stagnation counts and phase transitions;
prompts, config contents, web snippets, and user questions stay out of logs. The additive `execution` response object
is authoritative for all domains; host, shell, and renderer reject a completed
action without a native verified effect. File actions additionally retain the
compatible verified `fileChangeSet`.

### Cancellation

Cancellation uses a separate request:

```json
{ "jsonrpc": "2.0", "id": "req_cancel_1", "method": "operations.cancel", "params": { "operationId": "op_..." } }
```

Rules:

- `operations.cancel` returns `accepted`, `notFound` or `unsupported`.
- Durable installs use the domain-specific `installs.cancel` request because their authoritative state and cooperative worker context live in the process-affine install lane. It returns the terminal install operation (`cancelled`, or an already-terminal state when cancellation lost the completion race) rather than the generic acceptance DTO.
- UI must show honest operation-scoped capability state. A cancel button is disabled or hidden when the current operation cannot cancel safely.
- MO2 transfer cancellation is implemented with an operation marker written by the Tauri shell and consumed by C++ import analysis/copy/database stages. Generic bridge v1 cancellation remains mandatory in the contract even where a specific operation still returns `unsupported`.

### Version negotiation

First request after host spawn uses the same required protocol metadata as every
other request:

```json
{
  "jsonrpc": "2.0",
  "id": "hello_1",
  "method": "system.handshake",
  "params": { "supportedProtocolVersions": ["1.0"] },
  "meta": { "protocolVersion": "1.0", "operationId": "op_startup" }
}
```

The host returns:

```json
{
  "ok": true,
  "data": {
    "protocolVersion": "1.0",
    "hostVersion": "0.0.0-dev",
    "coreVersion": "0.0.0-dev",
    "coreApiVersion": "FluxoraCoreApi/legacy-cabi",
    "capabilities": {}
  }
}
```

Rules:

- Tauri main refuses to continue if there is no compatible protocol.
- The host rejects requests whose `jsonrpc` is not `2.0`, whose metadata is
  missing, or whose metadata protocol does not equal the host protocol.
- `system.handshake` succeeds only when `supportedProtocolVersions` contains
  the host protocol, and Tauri main verifies the returned `protocolVersion`
  before caching the handshake.
- Bridge status is ready only after core initialization succeeds and the
  capability response reports `core.available: true`; initialization or
  capability transport failures remain fail-closed `ready: false` states.
- Additive fields are allowed inside a protocol minor version.
- Removing or changing field meaning requires a new protocol major version.

## Capability model

`system.getCapabilities` returns platform, build and feature truth from the bridge host/core:

```json
{
  "platform": "win32",
  "arch": "x64",
  "core": {
    "available": true,
    "libraryName": "FluxoraCore.dll"
  },
  "features": {
    "projects": { "state": "available" },
    "downloads": { "state": "available" },
    "nexusAuth": { "state": "available" },
    "nxmProtocolRegistration": { "state": "available", "platforms": ["win32"] },
    "vfsLaunch": { "state": "available", "platforms": ["win32"], "requires": ["FluxoraVfs.dll", "x64"] },
    "shellOpen": { "state": "tauri-main" }
  },
  "supportMatrix": [
    {
      "platform": "win32",
      "label": "Windows",
      "state": "available",
      "nativeLibraryName": "FluxoraCore.dll",
      "bridgeHostName": "FluxoraBridgeHost.exe",
      "packageFormats": ["FluxoraSetup.exe", "Tauri NSIS smoke under src-tauri/target"],
      "protocolState": "available",
      "protocolNotes": "NXM uses Tauri activation plus Windows registry verification.",
      "shellOpenState": "tauri-main",
      "vfsState": "available",
      "vfsNotes": "VFS launch is available when FluxoraVfs.dll is present.",
      "pathRules": ["Unicode paths", "spaces", "long-path guard"],
      "releaseNotes": ["Installer-only public release policy remains in force."]
    }
  ]
}
```

Feature state values:

- `available`
- `limited`
- `unsupported`
- `disabled`
- `unknown`

Capability truth comes from Tauri main only for UI-shell features such as dialogs and shell open. Domain capabilities come from native bridge/core.

Phase 14 extends the exposed capability DTO with `supportMatrix`, a renderer-safe Windows/Linux/macOS readiness table. Tauri Rust shell merges this table and main-owned feature states into the native bridge response before facade exposes `NativeBridgeStatus`. The renderer may display this matrix and disabled/limited states, but it must not invent domain support from the current OS string.

## Bridge method list for full UI parity

The method names below are the `fluxora.bridge.v1` target surface. They are grouped from the current `CoreBridgeService` and `FluxoraCoreApi`.

### System, settings and templates

- `system.handshake`
- `system.initialize`
- `system.shutdown`
- `system.getCapabilities`
- `system.getCoreStatus`
- `settings.getLanguage`
- `settings.setLanguage`
- `settings.getTheme`
- `settings.setTheme`
- `templates.list`
- `templates.resolve`

### Projects and build paths

- `projects.previewDirectory`
- `projects.create`
- `projects.openConfig`
- `projects.listConfigs`
- `projects.rename`
- `projects.delete`
- `buildPaths.get`
- `buildPaths.save`

### FluxPack

- `fluxPack.export` with `{ configPath, outputPath, includeGeneratedAssets, packageType: "full" | "recipe" }`; C++ always applies maximum adaptive compression.
- `fluxPack.inspect`
- `fluxPack.planInstall` with `{ fluxPackPath, existingConfigPath? }`
- `fluxPack.install` with `{ fluxPackPath, installRootDirectory, existingConfigPath?, manualSourceArchives?: [{ sourceId, path }] }`

### MO2 transfer

- `transfer.analyzeMo2`
- `transfer.importMo2`

### Executables and launch

- `executables.list`
- `executables.save`
- `executables.launch`
- `executables.getIcon`
- `executables.completeManagedLaunch`

### Nexus and NXM

- `connections.listStatus`
- `connections.restoreAll`
- `connections.connect`
- `connections.disconnect`
- `nexus.getAuthStatus`
- `apiLimits.list`
- `nexus.connect`
- `nexus.connectWithApiKey`
- `nexus.disconnect`
- `nexus.getApiAuthHeader` (trusted native-only; blocked from the generic renderer bridge facade)
- `nxm.registerProtocol`
- `nxm.captureLinks`
- `nxm.importInboundDownloads`

### Mods and profiles

- `mods.listInstalled`
- `profiles.list`
- `profiles.create`
- `profiles.clone`
- `profiles.rename`
- `profiles.delete`
- `mods.getOrder`
- `mods.createSeparator`
- `mods.deleteSeparator`
- `mods.moveOrderItem`
- `mods.deleteInstalled`
- `mods.renameInstalled`
- `mods.createEmpty`
- `mods.setEnabled`
- `mods.setAllEnabled`
- `mods.checkUpdates`
- `mods.clearOverwrite`
- `mods.getFileTree`
- `mods.getModDetailsContent`
- `mods.getEffectiveFileTree`
- `mods.getEffectiveFileTreeRoot`
- `mods.getEffectiveFileTreeChildren`
- `mods.getModDetailsSummary`
- `mods.getModConflictTree`
- `mods.startNifPreview`
- `mods.prepareNifPreviewVariant`
- `mods.prepareNifPreviewTextures`
- `grassCache.generate`

`mods.listInstalled` and `mods.getOrder` return conflict count fields plus directed
`overwritesModIds` / `overwrittenByModIds` arrays. The C++ core computes those
relationships from installed/profile file-owner order; the renderer may use them
for selection highlighting, separator summaries and scrollbar markers, but must
not recompute overwrite ownership from raw file paths.

### Plugins

- `plugins.list`
- `plugins.move`
- `plugins.createSeparator`
- `plugins.deleteSeparator`
- `plugins.setEnabled`
- `plugins.setAllEnabled`

`plugins.list` returns plugin metadata read by the C++ core, including declared
`masterFiles` and currently computed `missingMasters`. The renderer may derive
status indicators from the current enabled state and collapsed separator groups,
but must not parse plugin files or invent master dependency data. The renderer
also uses these core-provided relationships to mark impossible drag targets
before drop. `plugins.move` remains authoritative and rejects any mutation that
would place a present dependency before its required master, or a master after
one of its dependents. On every exact plugin reconciliation, the core also
repairs an invalid persisted order with a stable topological ordering: unrelated
plugins and separator slots retain their relative positions wherever the master
graph permits it, and the repaired order is written atomically to profile
metadata before the text plugin state is refreshed.

### Downloads and install

- `downloads.list`
- `downloads.importFile`
- `downloads.delete`
- `downloads.rename` with `{ projectDirectory, downloadPath, newBaseName }`
- `downloads.cancel`
- `downloads.resume`
- `downloads.resolveDuplicateDecision` with `{ projectDirectory, downloadPath, decisionId, choice }`
- `downloads.planInstall` with `{ projectDirectory, downloadPath, profileName?, modName? }`
- `downloads.install`
- `archives.planInstall` with `{ projectDirectory, archivePath, profileName?, modName? }`
- `archives.install`
- `downloads.analyzeContentLayout`
- `downloads.analyzeFomod`
- `downloads.analyzeFomodContentLayout`
- `downloads.installFomod`
- `archives.installFomod`

The primary renderer window derives one taskbar progress state from the
authoritative `downloads.list` rows and sends it through the typed
`window.fluxora.windowControls.setTaskbarProgress` facade. Concurrent known
transfers use one aggregate percentage; any pending transfer with unknown
progress uses the native indeterminate state. Paused/decision and retryable
failure rows map to the native paused/error states, and terminal or empty
queues clear the indicator. Active downloads continue their bounded background
refresh when the Downloads surface is hidden or the main window is minimized.
The Rust shell validates the DTO and applies it with Tauri's native window API;
it does not duplicate download-domain state or transfer rules.

All four install request DTOs carry `profileName` and optional
`modOrderTargetIndex`. Successful `downloads.install*` and `archives.install*`
responses include stable `modUuid` / `orderId`, exact file/conflict counts and
directed relation arrays together with the persisted mod source identity
(`latestVersion`, provider flags, remote ids and source URL). The renderer uses
that authoritative result for its immediate row, so a Nexus install must not
appear as `Local` while the background workspace reconciliation is pending.
The same complete payload is stored in durable `FluxoraInstallOperationResult`
and delivered by `installs.get/list/restore` and `installs.progress`; it includes
`latestFileId`, `updateCheckState`, local/translation/patch flags and both
directed conflict-relation arrays. Completion updates the mod row and archive
status immediately, then performs only a silent Downloads reread. Exact plugin
and conflict reconciliation remains owned by the single build-content watcher,
not a completion-triggered whole-workspace refresh.
`mods.rebasePendingInstall` accepts `{ projectDirectory, operationId,
beforeOrderId?, afterOrderId?, fallbackTargetIndex }` and returns the latest
aggregate `FluxoraInstallConflictSnapshot`.
Once a pending install session is `completed`, rebase is a read-only replay of
its final snapshot: anchors, target index, revision and persisted order cannot
change. The renderer removes the terminal session before accepting later
snapshots; subsequent user moves use `mods.moveOrderItem`.

### Operations

- `operations.setContext`
- `operations.clearContext`
- `operations.progress`
- `operations.cancel`
- `operations.getStatus`
- `operations.recentLogs`

`operations.getStatus` remains the generic typed status contract. Durable installs use the C++ `install_operations` queue through `installs.list/get/restore`; the Tauri progress cache is only a delivery aid and is not install truth.

Fluxora AI uses independent build-scoped chat tabs rather than a durable
autonomous-job queue. Each tab owns its history, summary, context cursor, runs
and active operation. `fluxora.ai.intermediate-event.v1` is the live AI run
timeline contract. Events are correlated by chat, `runId` and `operationId`,
not by core operation subscriptions, and a background tab cannot update the
currently selected tab. Cancellation marks only its target AI operation and
does not terminate the shared sidecar. C++ `operations.*` remains the source of
truth for real domain operations and filesystem mutations.

`operations.recentLogs` is a read-only Tauri shell helper for AI/build diagnostics. It tails only Fluxora-owned log files in the app log directory, filters operation-related lines, caps output size and returns typed compact entries. The renderer does not receive arbitrary filesystem access.

`local.filesystemSnapshot` is a read-only AI context tool, not a renderer filesystem permission. It composes existing core-backed Fluxora APIs such as installed mods, mod file trees, plugin load order, profiles, downloads and operation logs into a bounded metadata snapshot for troubleshooting prompts. The snapshot can include relative paths, file kinds, sizes, SKSE DLL signals, missing masters and file-conflict samples, but it cannot read arbitrary OS paths or file contents and it cannot mutate the build.

## Mapping from current C ABI

The native host initially maps bridge methods to the existing exported functions:

- Availability and metadata: `fluxora_core_is_available`, `fluxora_get_last_error`.
- Host lifecycle: `fluxora_core_shutdown`.
- Operation context/log correlation: `fluxora_set_operation_context`.
- Buffer handling: `fluxora_get_last_required_buffer_length`, `fluxora_copy_last_output`.
- Templates/projects/build paths: `fluxora_get_game_templates`, `fluxora_resolve_template`, `fluxora_preview_project_directory`, `fluxora_create_project`, `fluxora_open_project_config`, `fluxora_list_project_configs`, `fluxora_rename_project`, `fluxora_delete_project`, `fluxora_delete_project_with_progress`, `fluxora_get_build_path_settings`, `fluxora_save_build_path_settings`.
- FluxPack and transfer: `fluxora_export_fluxpack`, `fluxora_export_fluxpack_with_progress` (both ABI-compatible and defaulting to optimal compression), `fluxora_export_fluxpack_with_options_and_progress`, `fluxora_inspect_fluxpack`, `fluxora_plan_fluxpack_install`, `fluxora_install_fluxpack`, `fluxora_install_fluxpack_with_target`, `fluxora_install_fluxpack_with_options_and_progress`, `fluxora_analyze_mod_organizer_instance`, `fluxora_import_mod_organizer_instance`.
- Settings/executables/connections/Nexus/NXM: `fluxora_get_app_language`, `fluxora_set_app_language`, `fluxora_get_app_theme`, `fluxora_set_app_theme`, `fluxora_get_game_executables`, `fluxora_save_game_executables`, `fluxora_launch_game_executable`, `fluxora_get_executable_icon`, `fluxora_list_external_connections`, `fluxora_restore_external_connections`, `fluxora_connect_external_connection`, `fluxora_disconnect_external_connection`, `fluxora_get_nexusmods_auth_status`, `fluxora_get_api_limit_status`, `fluxora_connect_nexusmods`, `fluxora_connect_nexusmods_with_api_key`, `fluxora_disconnect_nexusmods`, `fluxora_register_nxm_protocol`.
- Mods/profiles/plugins/downloads/install: every exported `fluxora_get_*`, `fluxora_create_*`, `fluxora_delete_*`, `fluxora_move_*`, `fluxora_set_*`, `fluxora_capture_nxm_links`, `fluxora_import_*`, `fluxora_install_*`, `fluxora_analyze_*` function listed in `FluxoraCoreApi.hpp`, the additive `fluxora_plan_download_install_for_profile_with_name` and `fluxora_plan_archive_install_for_profile_with_name` adapters for final-name replanning, plus `fluxora_generate_ngio_grass_cache` for Skyrim NGIO cache generation.

Pending install conflicts use the additive progress C ABI entry points listed in
the Instant install conflict projection section. The bridge host forwards their
nested snapshot unchanged through `operations.progress`; legacy install exports
remain available and route through the same exact-inventory/finalization path.

For update checks, the bridge maps mods.checkUpdates to fluxora_check_mod_updates_v2 so automatic/manual mode, progress, typed stop reason, quota, counters and per-mod values cross the boundary together. Progress events preserve the request `operationId` and expose `phase`, `completed`, `total`, `currentItem` (the installed mod folder/display identity, never the remote Nexus id) and `overallPercent`. The renderer correlates those events only with the active manual request and presents them in a blocking `LoadingSplash`; automatic checks never open that surface. The older fluxora_check_mod_updates entry point remains a manual compatibility adapter through the same service.

The host may wrap several low-level C ABI functions into one bridge method when that produces a cleaner UI contract. It must not move business rules into TypeScript.

## Cross-platform rules

### Native libraries

- Windows ships `FluxoraBridgeHost.exe`, `FluxoraCore.dll` and `FluxoraVfs.dll`.
- Linux ships `FluxoraBridgeHost`, `libFluxoraCore.so` and any Linux platform adapter libraries.
- macOS ships `FluxoraBridgeHost`, `libFluxoraCore.dylib` and any signed/notarized helper libraries.
- Tauri main locates the host through packaged app resources, not current working directory assumptions.
- The host locates the core library relative to itself unless an explicit dev environment variable overrides it.

### Platform capability matrix for Phase 1

| Capability | Windows | Linux | macOS | Owner |
| --- | --- | --- | --- | --- |
| Core load and typed request/response | Available target | Available target | Available target | Bridge host |
| Project/profile/mod/plugin/download filesystem operations | Available target | Available target with path-case hardening | Available target with path-case/signing checks | C++ core |
| VFS launch hooks | Available target, x64, requires `FluxoraVfs.dll` | Unsupported until Linux adapter exists | Unsupported until macOS adapter exists | C++ core/platform adapter |
| Plain executable launch | Available target | Available target | Available target | C++ core |
| NXM protocol registration | Current implementation available on Windows | Needs xdg/open desktop adapter | Needs URL scheme/signing adapter | Main + C++ core/platform adapter |
| Shell open/show item | `shell.openPath` / show in folder | `shell.openPath` / xdg behavior | `shell.openPath` / Finder behavior | Tauri main |
| Native file/folder dialogs | Available | Available | Available | Tauri main |
| Taskbar/dock download progress | Native Windows taskbar state | Desktop-environment support through Tauri/libunity | Native dock progress | Renderer aggregation + Tauri main |
| Nexus OAuth browser/callback | Available target | Available target after callback binding review | Available target after callback/signing review | C++ core/platform adapter |

Renderer displays this matrix as capability state. It must not hardcode "Windows only" assumptions except as display of a bridge-provided capability.

### Path normalization

- Renderer treats paths as opaque display strings.
- Main/facade may open dialogs and return selected paths, but it does not normalize project semantics.
- Bridge/core normalize paths with `std::filesystem::path` and existing path safety services.
- Bridge DTOs use UTF-8 JSON strings.
- Core C ABI currently uses wide strings. The host owns UTF-8 to native path conversion.
- Case-sensitive collisions must be handled in core rules, not renderer rules.
- Tests for Unicode, Cyrillic, German characters, spaces, long paths, external drives and read-only paths belong in backend tests as behavior changes are added.

### Shell open behavior

- Renderer calls typed APIs such as `shell.openPath`, `shell.showItemInFolder` and `links.openExternal`.
- Main validates path or URL schemes and calls Tauri shell APIs.
- Core should not open Explorer/Finder for UI convenience. Core may still open a system browser for existing Nexus OAuth until that platform decision is revisited.

### Protocol registration

- Tauri Rust shell owns app activation and single-instance forwarding.
- Core/platform adapter owns durable registration details when they affect OS state.
- Windows can initially keep current `fluxora_register_nxm_protocol` through the bridge.
- Linux needs xdg desktop file and MIME/URL scheme registration.
- macOS needs URL scheme registration through app bundle metadata and signing/notarization review.

## Text editor workbench boundary

The active text/code editor is documented in `docs/tauri-migration/text-editor-workbench.md`. Its VS Code-style workbench and Monaco lifecycle remain renderer concerns, while file access stays on the existing typed facade:

- mod exploration/read/save uses `mods.getFileTree`, `mods.readTextFile` and `mods.saveTextFile`;
- standalone file selection/read/save uses native dialogs plus `textFiles.read` and `textFiles.save`;
- `windowControls.openTextEditor` passes the selected build's opaque `configPath` and already-known `projectDirectory` into a dedicated `TextEditorWindow` entrypoint, so editor startup does not depend on the main renderer's catalog/Nexus bootstrap;
- atomic writes, path validation, UTF-8 persistence, operation ids and native logging remain outside the renderer;
- Monaco workers are local bundled assets and do not create a network or CDN dependency;
- workspace-wide indexing, language-service hosts, source control, terminals and debugging require explicit future core/shell contracts and must not be emulated by renderer-only controls.

## Logging and observability

Required log flow for user-triggered operations:

1. Renderer asks main to start operation.
2. Main creates or propagates `operationId`.
3. Main logs bridge request start/result in bridge log.
4. Bridge host logs host call start/result and passes `operationId` to core.
5. Core logs domain behavior in core/operation logs.
6. Progress events carry `operationId`.
7. Error envelopes carry `operationId`.

Bridge logs must be separate from UI logs. Do not merge Tauri renderer console noise into core or operations logs.
Tauri main starts `FluxoraBridgeHost` with `FLUXORA_LOG_DIR` set to the app log directory so native core, bridge, operation and crash logs stay discoverable alongside the Tauri UI/main logs while remaining separate files.
Every bridge request emits a machine-readable queue measurement in the main/bridge log as `bridgeQueue lane=main|plugin|interactive|background|connection|download|install method=<method> queueWaitUs=<value>`. In particular, plugin reads, connection restoration, downloads and installs are diagnosed through their own lanes without mixing renderer timing with native transfer/finalization timings.
The shell selects the first writable log root in this order: explicit
`FLUXORA_LOG_DIR`, `<executable>/logs`, the per-user Fluxora data directory,
then the OS temporary Fluxora directory. Operation cancellation markers live
under the same selected writable root, so a protected installation directory
cannot prevent bridge startup.

## Concurrency

Bridge v1 keeps unsafe project mutations serialized while separating independent work into seven lazy, process-affine lanes. The additive generic connection methods keep the same `fluxora.bridge.v1` envelope and operation/error contracts.

- `Download`: `nxm.captureLinks`, `nxm.importInboundDownloads`, `downloads.list`, `downloads.getDelta`, `downloads.cancel`, `downloads.resume`, `downloads.resolveDuplicateDecision`, `downloads.rename` and `downloads.delete`. Tauri activation and the downloads-folder watcher send work directly to this lane. The NXM queue, active-download registry, durable download revision stream and complete NXM lifecycle stay in this one host. C++ accepts the pending row before metadata reconciliation, resolves file-info and any duplicate decision before acquiring a transfer permit, yields the worker while a decision is pending, and limits active transfers to five. Replace and rename decisions are additionally serialized by the native archive-use lock without blocking unrelated downloads or the Install lane.
- `Install`: install analysis/planning, `installs.submit`, `installs.cancel`, `installs.restore`, `installs.list`, `installs.get` and the synchronous download/archive install compatibility adapters. Planning, resolution/session state and the two-worker `InstallScheduler` stay in this one host; a third operation is durably accepted and remains queued. Cancellation stays on the same process-affine lane so it can reach the active native operation context; cancel requests use the original install `operationId` as their target and keep the user-triggered delete `operationId` in request metadata and logs.
- `Plugin`: `plugins.list` and `plugins.listPersisted`. Read isolation prevents a long `mods.getWorkspace` on Main from delaying generated-plugin visibility. Plugin mutations remain serialized on Main, while the renderer snapshot gate prevents list publication during a multi-step reorder transaction.
- `Interactive`: only independently safe user-driven file, text, mod-detail/effective-tree and NIF reads. Text/file saves and project metadata mutations remain on `Main`.
- `Connection`: `connections.*` plus compatible `nexus.getAuthStatus`, `nexus.connect`, `nexus.connectWithApiKey` and `nexus.disconnect`. Native-only `nexus.getApiAuthHeader` remains on Main because it is not renderer-callable.
- `Background`: `mods.checkUpdates` and `apiLimits.list`.
- `Main`: every other bridge method, including read-only `workspace.getDelta`, project/workspace mutations, local archive import, FluxPack, MO2, project lifecycle and installed-mod `mods.renameInstalled` / `mods.deleteInstalled` mutations.

Each `BridgeProcess` owns its own child, stdin, response map, reader task and handshake. A timeout or process exit resets only the selected lane; another lane's install workers, NXM queue and main workspace session remain alive. Shutdown walks all seven lanes even when one lane was never started or failed, and each lane is restarted lazily on its next request.

Cross-process safety remains core-owned. `InstallProjectGate`, target/archive locks and the short commit/finalization gates serialize conflicting writes and deletes. SQLite uses WAL-backed readers and bounded write transactions, so `downloads.list` and NXM intake can remain available while install/main work is busy without moving project rules into Rust. Every request keeps the same `operationId` through renderer, Rust shell, bridge host, C++ worker and native logs.

- Other parallel reads require explicit core approval and focused routing/isolation tests.
- Renderer remains responsive because requests are asynchronous and progress/event driven.
- The 10-second bridge timeout is reserved for short control/read calls.
  Connection restoration uses a 3-second shell timeout around the native
  2.5-second shared provider deadline.
  Nexus OAuth connect uses a 180-second shell timeout around the native
  120-second callback deadline plus token exchange.
  Mod update checks use an 8-second per-HTTP-request budget, a 60-second native
  sweep deadline and a 70-second shell timeout.
  Recursive project/mod cleanup, overwrite cleanup, local download import,
  archive/download install and FluxPack export/install use an explicit
  two-hour file-mutation budget so normal large filesystem work is not treated
  as a crashed host and terminated mid-operation.

## Local speech boundary

Fluxora AI voice input uses a separate `FluxoraSpeechHost` process and never
passes audio to `FluxoraAIHost`, Gemini, the C++ core, or the bridge lanes. The
WebView sends only in-memory mono 16 kHz f32 PCM through one raw Tauri command;
metadata remains in bounded ASCII headers. Rust validates size, format and
completion metadata,
owns cancellation and one-restart lifecycle, and resolves only installer-owned
host/model resources. The renderer always sends speech language `auto`; the
EN/RU/DE interface locale is used only for consent and localized errors. The
host lets Whisper select the recording's language, always disables translation,
and returns `detectedLanguage` (or `null` for no speech) together with the
selected `vulkan` or `cpu` backend. The transcript therefore remains in its
original language and becomes ordinary AI draft text only after local inference
completes.

The speech host uses deterministic Greedy 1 decoding with bounded token output;
short recordings are decoded as one segment after trimming Silero-detected
outer silence, with a duration-sized encoder context rather than Whisper's
default 30-second window. Rust applies a duration-aware deadline from 15 seconds
up to five minutes and bounds host reset waiting to five seconds. A renderer
watchdog starting at 20 seconds independently cancels the process and returns a
typed retryable error instead of leaving renderer state pending.

On Windows the Rust shell first starts `FluxoraSpeechHostVulkan` for Vulkan
Whisper offload while keeping Silero VAD on CPU. Missing Vulkan runtime/device,
startup, handshake, or GPU-initialization failures fall back automatically to
the dependency-light `FluxoraSpeechHost` CPU process with the same `operationId`
and absolute deadline. Cancellation never starts fallback. Both processes start
without a console window and keep their stdio protocol loop on one dedicated
thread with an explicit native-inference stack reserve so Whisper/VAD model
preparation cannot overflow the executable main-thread stack.

After consent, model preparation starts concurrently with microphone opening
and never gates the start of recording. Stop immediately replaces the recording
waveform/timer with a fixed `LoaderCircle`, accessible Cancel action, and a
screen-reader-only localized status while PCM finalization and the already
running preparation finish. Reduced-motion mode keeps the same geometry without
continuous rotation.

The versioned glossary normalizes official proper names and abbreviations for
every detected language. Ordinary terms are language-specific for EN/RU/DE and
are not replaced by English equivalents; other languages receive proper-name
normalization only. Speech logs contain technical lifecycle/error data plus the
backend, thread count, model-load/VAD/inference/total timing and real-time
factor. Audio, transcript, glossary matches, and detected language are never
logged.

The renderer-owned consent flag is local and persists only after Allow. The
Windows shell owns the WebView2 `PermissionRequested` gate: it clears old saved
microphone decisions to `DEFAULT`, never saves a new decision, and permits only
one request from `http://tauri.localhost` during a ten-second arm window. The
gate and profile reset fail closed without affecting other permission kinds.

This boundary intentionally has no temporary audio file, database record,
cache, telemetry, transcript log, glossary log, prompt log, or runtime download.
The renderer owns permission UI, recording timer/waveform, processing indicator
and cleanup; Rust owns OS settings launch and process safety; the speech hosts
own inference only.

## Testing and validation strategy

Phase 1 is documentation and contract design, so no product build is required to close this phase. Later phases must add:

- Native host unit tests for envelope parsing, error mapping and method routing.
- `backend/tests/BridgeHostProtocol.Tests.ps1` exercises the built native host
  over real stdio for compatible and incompatible protocol envelopes.
- Contract fixture tests for every `fluxora.bridge.v1` method.
- Tauri Rust shell/facade tests proving renderer only sees typed APIs.
- Backend CTest coverage when a new C++ bridge-host adapter changes core behavior.
- Playwright smoke after the Tauri shell exists.

## Phase 1 acceptance checklist

- Bridge options are documented.
- Product choice is documented: native host process with typed JSON-RPC v1 over stdio.
- Tauri does not contain domain logic.
- Bridge protocol includes request/response DTOs, error envelopes, progress events, cancellation, operation IDs, capability flags, version negotiation and structured log correlation.
- Bridge version `fluxora.bridge.v1` exists.
- Full UI parity method list exists and maps to current `CoreBridgeService`/`FluxoraCoreApi`.
- Windows/Linux/macOS capability differences are explicit.
