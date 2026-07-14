# Fluxora Tauri + C++ bridge architecture

Дата решения: 2026-06-24; NIF preview transport update: 2026-07-13

Статус: Phase 14 Bridge/API surface and cross-platform capability model implemented on top of the Phase 1 decision. This document is the bridge/source-of-truth companion to `docs/tauri-migration/wpf-ui-inventory.md` and `docs/tauri-migration/cross-platform-support.md`.

## Decision summary

Fluxora will use a separate typed native bridge host between Tauri main process and the C++ core:

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

- Native host routes `mods.listInstalled`, `mods.getOrder`, the interactive aggregate read `mods.getPersistedWorkspace`, the reconciling aggregate read `mods.getWorkspace`, watcher-driven `mods.invalidateFileCaches`, `mods.createSeparator`, `mods.deleteSeparator`, `mods.moveOrderItem`, `mods.deleteInstalled`, `mods.createEmpty`, `mods.setEnabled`, `mods.setAllEnabled`, `mods.checkUpdates`, `mods.clearOverwrite`, `mods.getFileTree`, `mods.getModDetailsContent`, `mods.getEffectiveFileTree`, `mods.getEffectiveFileTreeRoot`, `mods.getEffectiveFileTreeChildren`, `mods.getModDetailsSummary`, `mods.getModConflictTree`, `mods.startNifPreview`, `mods.prepareNifPreviewVariant` and `mods.prepareNifPreviewTextures` to C++ C ABI functions.
- Tauri Rust shell/facade expose typed `window.fluxora.mods.*` calls only; renderer still has no Node.js, filesystem or raw command access.
- Renderer owns local mod search, selection, row action menus, scroll windowing and expanded file-tree state.
- C++ core remains the owner of installed mod records, profile order, enabled state, separator persistence, update checks, file tree indexing and filesystem mutations.
- The regular selected-mod file tree in the main workspace remains lazy by `relativeDirectory`. The dedicated mod-properties window uses the explicit `mods.getModDetailsContent` read instead: C++ returns all directory pages and both conflict groups from the prepared SQLite file index in one immutable snapshot. The renderer starts this read on the first row click, treats the second rapid click as the open gesture, and deduplicates both calls. Tauri routes this one interactive read through a separate `BridgeProcess` lane so it cannot wait behind long main-lane reconciliation such as `mods.getWorkspace`; both bridge processes are shut down through the same lifecycle command. The Rust shell then injects the completed snapshot before the properties webview parses its application scripts. This keeps filesystem/index ownership in C++, removes per-folder and bridge-queue races, and lets the Files and Conflicts tabs render without intermediate loading states.
- Effective game-root Data pages are lazy on cold cache: `mods.getEffectiveFileTreeRoot` and `mods.getEffectiveFileTreeChildren` return shallow bounded pages without preparing a full recursive index. Full `mods.getEffectiveFileTree` and `build.prepareWorkspaceIndexes` remain explicit heavy index operations with a long bridge timeout and are not run during build open.
- `mods.getPersistedWorkspace` returns installed rows and profile order from the last durable file-index generation with zero live inventory synchronization. It is the normal T3 renderer path and may expose deferred (`fileCount = -1`) summaries for never-indexed mods. An absent or incomplete persisted snapshot triggers one exact `mods.getWorkspace` fallback before T3; otherwise `mods.getWorkspace` performs exact offline file-index reconciliation in T4. The build-content watcher is installed before the first workspace read, remains active across same-project reopens, and turns setup errors, event-sequence gaps, or watcher errors into conservative reconciliation instead of trusting a potentially incomplete delta.
- `mods.invalidateFileCaches` accepts deduplicated affected mod-folder paths, clears per-mod file-index generation state plus VFS placement/plugin discovery caches, and must complete before watcher-triggered workspace/effective-tree reads. Failed invalidation batches remain queued and retry autonomously with a bounded delay even when no later watcher event arrives. These calls carry an operation id and keep bridge/UI/core performance logging separate.

### NIF preview session transport

The public renderer contract is session-based: `startNifPreview`, `prepareNifPreviewVariant`, `prepareNifPreviewTextures`, `readNifPreviewAssetBytes` and `endNifPreview`. The old `mods.readPreviewAsset` Base64/JSON response and `mods.listPreviewVariants` route do not exist. Public handles contain only an opaque token, byte size, MIME type, relative path, display source and content fingerprint. Absolute filesystem paths remain private between C++ and the Rust shell.

C++ resolves all requested textures in one case-insensitive batch using overwrite, enabled profile mods in reverse priority, and Game Data. BSA/BA2 indexes are cached by canonical path + size + mtime fingerprint. Extracted archive assets are finalized atomically in the versioned 512 MiB local LRU; a changed archive fingerprint invalidates both its index and extracted assets.

Tauri Rust owns opaque session/variant/asset tokens and serves asset bytes with `tauri::ipc::Response`, outside JSON serialization. Every token is bound to the preview window label that created it; another window cannot prepare, read or end that session. NIF methods use the interactive bridge lane and retain one `operationId` for the complete session. Limits are 64 paths per batch, 64 MiB per asset and 256 MiB per session. Sessions end explicitly when the preview source changes or unmounts, on preview-window close, or after 15 minutes idle.

The file-preview window receives the project directory directly from the typed `window.fluxora.windowControls.openFilePreview` call. Preview startup therefore does not depend on the secondary renderer reloading or matching the global project catalog before it can call `startNifPreview`.

The renderer transfers NIF parsing and BC1-BC5 software fallback decoding to a Web Worker. It swaps in neutral geometry before requesting one texture batch, reads prepared assets with concurrency 3 and applies textures progressively. Generation tokens reject stale variant work while the previous model remains visible until replacement geometry is ready. The renderer LRU is bounded to 64 textures and 256 MiB raw bytes.

The complete preview path is local-only: it adds no upload, telemetry, account data or external service. Archive indexes, extracted assets and renderer caches stay on the user's device, so this change does not require a privacy policy or terms update.

## Phase 7 Plugins/Load Order MVP

Phase 7 extends `fluxora.bridge.v1` to the plugin/load-order workspace:

- Native host routes `plugins.listPersisted`, `plugins.list`, `plugins.move`, `plugins.createSeparator`, `plugins.deleteSeparator`, `plugins.setEnabled` and `plugins.setAllEnabled` to C++ C ABI functions backed by `PluginService`.
- Tauri Rust shell/facade expose typed `window.fluxora.plugins.*` calls only; renderer still has no Node.js, filesystem or raw command access.
- Renderer owns local plugin search, selection, row action menus, scroll windowing, selected-plugin details and capability explanation only.
- C++ core remains the owner of plugin detection, active plugin state, base-plugin locks, missing masters, separator persistence and load-order mutation rules.
- T3 uses `plugins.listPersisted`, which reads durable profile state and base-plugin rules without live mod/plugin discovery. After exact mod reconciliation, T4 calls `plugins.list` to discover offline additions/removals and refresh source/master diagnostics. A failed T4 refresh leaves the committed persisted rows usable.
- The renderer intersects bridge capability availability with the selected build's game capabilities. Unsupported games show an explanatory capability state instead of an empty broken panel.

## Phase 8 Downloads, NXM And Archive Install MVP

Phase 8 extends `fluxora.bridge.v1` to downloads and simple archive install:

- Native host routes `downloads.list`, `downloads.importFile`, `downloads.delete`, `downloads.cancel`, `downloads.resume`, `downloads.install`, `archives.install`, `nxm.registerProtocol`, `nxm.captureLinks` and `nxm.importInboundDownloads` to existing C++ C ABI functions backed by `DownloadService`.
- Tauri Rust shell/facade expose typed `window.fluxora.downloads.*`, `window.fluxora.archives.install` and `window.fluxora.nxm.*` calls only; renderer still has no Node.js, filesystem, shell or raw command access.
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
- Placement details send only `{ sourcePath, target, targetRelativePath }` override records back to core. Renderer never moves archive files directly.

## Phase 10 Profiles And Executables MVP

Phase 10 extends `fluxora.bridge.v1` to WPF-parity profile management and executable launch configuration:

- Native host routes `profiles.list`, `profiles.create`, `profiles.clone`, `profiles.rename`, `profiles.delete`, `executables.list`, `executables.save`, `executables.getIcon` and `executables.launch` to existing C++ C ABI functions backed by `ProfileService` and `ExecutableService`.
- Tauri Rust shell/facade expose typed `window.fluxora.profiles.*` and `window.fluxora.executables.*` calls only; renderer still has no Node.js, filesystem, shell, native module or raw command access.
- Tauri Rust shell owns `window.fluxora.processes.waitForLaunchReady` and `waitForExit`. On Windows, process exit uses the signaled process handle as the primary path (`WaitForSingleObject` with an infinite wait on a dedicated native-wait thread); a 250 ms process-presence poll is retained only when the native wait cannot be established. After each exit, the shell enumerates live processes with `FluxoraVfs.dll` loaded and returns the next holder as `trackedKind: "vfsHolder"`, so the renderer keeps the launch splash attached to the process that still owns the active VFS session.
- Renderer owns profile/executable search, selected-row state, in-app edit controls, two-step destructive confirmation state, icon/launch status display and capability explanations only.
- Renderer closes the launch splash as soon as the final tracked/VFS process exits and refreshes the mods workspace asynchronously afterward; a slow workspace read must not extend the process-locking screen.
- C++ core remains the owner of profile folder/state mutations, executable metadata persistence, icon resolving, launch cache preparation and process launch behavior.
- Executable management and executable launch are exposed as separate capability flags so non-Windows bridge builds can still edit launch entries while honestly disabling launch.

## Phase 11 Settings, Nexus Mods And MO2 Transfer MVP

Phase 11 extends `fluxora.bridge.v1` to WPF-parity settings and MO2 transfer:

- Native host routes `settings.getTheme`, `settings.setTheme`, `nexus.getAuthStatus`, `nexus.connect`, `nexus.connectWithApiKey`, `nexus.disconnect`, `transfer.analyzeMo2` and `transfer.importMo2` to existing C++ C ABI functions backed by `AppSettingsService`, `NexusModsAuthService` and `ModOrganizerImportService`; the Tauri shell handles `operations.cancel` for MO2 transfer by writing an operation cancel marker outside the bridge request mutex. The theme contract currently normalizes every value to the single supported dark theme.
- `NexusModsAuthService` uses the public OAuth client id `fluxora` by default, but trusted runs may override the OAuth client id through `FLUXORA_NEXUS_CLIENT_ID`, `NEXUS_CLIENT_ID`, `NEXUS_OAUTH_CLIENT_ID` or the Fluxora Supabase credential RPC/table using secret names `NEXUS_CLIENT_ID` / `NEXUS_OAUTH_CLIENT_ID`.
- When Nexus requires a confidential `client_secret` during token exchange, the C++ service resolves it from `FLUXORA_NEXUS_CLIENT_SECRET`, `NEXUS_CLIENT_SECRET`, `NEXUS_OAUTH_CLIENT_SECRET` or the Fluxora Supabase credential RPC/table using secret names `NEXUS_CLIENT_SECRET` / `NEXUS_OAUTH_CLIENT_SECRET`; the secret is never exposed through the Tauri renderer facade or bridge DTOs.
- Nexus OAuth uses the registered loopback callback `http://127.0.0.1:8089/callback` by default. `FLUXORA_NEXUS_REDIRECT_URI`, `NEXUS_REDIRECT_URI`, `NEXUS_OAUTH_REDIRECT_URI` or matching Fluxora Supabase credential entries may override it for a different registered client, but the authorize and token exchange requests must use the exact same redirect URI.
- Nexus downloads use the linked account automatically after OAuth login. `DownloadService` obtains its request credential through `NexusModsAuthService` immediately before Nexus API/transfer calls, so expired OAuth access tokens are refreshed instead of being copied directly from persisted settings; refresh-token rotation is serialized across concurrent native requests. C++ protects OAuth tokens locally and can still accept a legacy `apikey` credential through `nexus.connectWithApiKey` for compatibility, but the renderer must not require users to paste a Personal API Key during the normal connection flow.
- Tauri routes the long-running `nexus.connect` callback wait through the interactive bridge lane and gives it a 180-second request envelope around the native 120-second loopback-listener deadline plus token exchange, so it neither inherits the normal 10-second bridge timeout nor blocks main-lane Nexus/download work. Renderer status verification and the optional API-limit probe settle independently; a failed status read becomes an explicit retryable unavailable state instead of remaining indefinitely in `Checking` or discarding a successful auth result because the quota probe failed.
- Settings API limit display uses generic `apiLimits.list` provider/window DTOs. The first provider is backed by `NexusModsAuthService`, which performs a small authenticated quota-bearing Nexus API request and reports only the quota headers returned by Nexus (`X-RL-*`, standard `X-RateLimit-*` / `RateLimit-*`, `Retry-After`), never hardcoded quota values or renderer-visible credentials. Future API providers should append another provider entry to the same snapshot instead of creating provider-specific settings UI.
- AI Nexus research also uses the linked account automatically, but only through a trusted native-only path: Tauri main asks `FluxoraBridgeHost` for a transient Nexus API auth header, injects it into the AI host request as private `nativeNexusApiCredential`, and removes any renderer-supplied value before dispatch. The generic renderer bridge command rejects `nexus.getApiAuthHeader`, so API keys and OAuth tokens are never exposed through `window.fluxora` or stored in renderer state. If no Nexus account is linked, Nexus API research remains unavailable and the AI report must show that as missing credential evidence instead of pretending it searched.
- Native host emits `operations.progress` JSON-RPC events during MO2 import. Tauri main subscribes through the bridge client and broadcasts them on the allowlisted `fluxora:operations:progress` channel.
- Tauri Rust shell/facade expose typed `window.fluxora.settings.*`, `window.fluxora.nexus.*`, `window.fluxora.transfer.*` and `window.fluxora.operations.*` calls only; renderer still has no Node.js, filesystem, shell, native module or raw command access.
- Renderer owns settings section state, language controls, single-theme mirroring into CSS, Nexus status display, MO2 source/destination form state, analysis display, transfer progress display and route/close guard while transfer is running. Theme customization controls are deferred until more supported themes are added.
- C++ core remains the owner of persisted app settings, Nexus OAuth status/connect/disconnect behavior, MO2 analysis/import rules, disk-space checks, project creation/replacement, transfer cancellation checks and filesystem cleanup.
- MO2 transfer cancellation is scoped to the transfer operation: the renderer enables `Отменить и очистить` for a running transfer, Tauri writes a marker keyed by `operationId`, and C++ stops before activation or during copy/database work and removes staging files through the existing import failure cleanup path.

## Phase 12 Build Settings, FluxPack And Build Operations MVP

Phase 12 extends `fluxora.bridge.v1` to WPF-parity build path settings and FluxPack workflows:

- Native host routes `buildPaths.get`, `buildPaths.save`, `fluxPack.export`, `fluxPack.inspect`, `fluxPack.planInstall` and `fluxPack.install` to C++ C ABI functions backed by `BuildPathSettingsService`, `ExecutableService`, `FluxPackService`, `DownloadService`, `NexusModsAuthService` and `ProjectService`.
- New exports use the FluxPack v3 content-store container. Every mod/config path remains a distinct manifest entry, while its bytes reference SHA-256-addressed chunks that are stored once and materialized as ordinary independent files during install. Large files use normalized content-defined chunking (`fastcdc`, 64 KiB minimum, 256 KiB average, 1 MiB maximum), so local insertions can reuse the unchanged chunk sequence instead of duplicating the rest of the file.
- Export exposes `packageType: "full" | "recipe"`. `full` embeds every installed mod plus generated/local/config content and emits no remote source requirements, so install is autonomous. `recipe` keeps reproducible remote identities as source references and embeds only the local payload that cannot be reacquired; Nexus Premium may be automatic, while other/free-account sources use the existing validated manual flow. Full packages force generated assets into the payload even if an older caller sends `includeGeneratedAssets: false`.
- Each unique chunk uses adaptive Zstandard compression at the library's `ZSTD_maxCLevel()`; compression is no longer user-selectable. DDS/BSA/BA2/ZIP/7z/OGG/audio/video inputs are probed first and remain raw when the sample does not save at least one percent; every other chunk also falls back to raw storage when compression would not produce a meaningful gain. Small INI/JSON/XML files are grouped by extension into shared content chunks, exact duplicates share a slice, and a trained type dictionary is stored/applied only when total stored bytes decrease. Install reuses one Zstandard decompression context and streams verified chunks to ordinary independent files.
- Inspect/install remain backward-compatible with FluxPack v2 containers and bounded legacy v1 JSON recipes; missing `packageType` defaults to `recipe`, while a package advertised as `full` is rejected if it still contains remote source requirements. Oversized legacy manifests fail with an actionable re-export error instead of exhausting memory. Inspect summaries expose package type, bundled/source counts, compression mode, logical/unique/stored/deduplicated bytes, chunk count, and dictionary count.
- `fluxPack.install` accepts optional `existingConfigPath`. When it is present, C++ verifies the game template and updates that exact build instead of allocating a suffixed project. Source mods are reused only when the target folder and strong remote file identity match; enabled state is synchronized without reinstalling. A matching archive already in the build downloads directory is reused only after file-name, size and SHA-256 validation. Embedded mod/config files are reused only after size and SHA-256 validation; changed payloads are validated in a temporary file and promoted atomically, while changed source mods use the existing replace-install path. Unreferenced user mods/files are preserved conservatively instead of being pruned without prior FluxPack ownership state. Create-new installs allocate a unique suffixed project name when the recipe name already exists.
- `fluxPack.planInstall` returns a source-level acquisition plan before mutation. Each source is classified as `installed`, `cached-download`, `source-build`, `automatic`, `manual` or `unavailable`. A linked Nexus account is automatic only when the native verified account state is Premium; free accounts receive the Nexus file page and the renderer collects a user-selected archive. Manual archive source ids, paths, file sizes and SHA-256 hashes are validated by C++ before a project is created or updated.
- Delta results expose `updatedExistingProject`, `reusedSourceCount`, `reusedDownloadCount`, `reusedFileCount` and `materializedFileCount`. The legacy `fluxora_install_fluxpack` ABI remains a create-new wrapper; `fluxora_install_fluxpack_with_target` remains compatible, while additive `fluxora_install_fluxpack_with_options_and_progress` carries the optional existing config and validated manual source archives through the native host.
- Native host now calls `fluxora_delete_project_with_progress` for `projects.delete` and emits `operations.progress` events for project deletion.
- Native host emits `operations.progress` events during FluxPack export and install. Export reports bounded, monotonic phases for build analysis, file inventory, streamed payload copy, compact description writing and atomic finalization; install keeps provider/source progress. The renderer presents provider sectors proportionally by source count, uses Nexus orange for Nexus sectors and assigns stable fallback colors to future providers. The final response still remains authoritative.
- Tauri Rust shell/facade expose typed `window.fluxora.buildPaths.*`, `window.fluxora.fluxPack.*` and `.fluxpack` native open/save dialogs only; renderer still has no Node.js, filesystem, shell, native module or raw command access.
- Renderer owns the Build Paths inspector, primary executable form state, native browse/save/open dialog orchestration, FluxPack summary display, same-name choice dialog, manual-download queue and operation overlays. C++ core remains the owner of path persistence, executable persistence, FluxPack recipe creation, package inspection, acquisition planning, Premium eligibility, package install, provider/source handling, archive validation and filesystem mutation.
- Generic operation cancellation remains capability-reported as unsupported until each operation has a cancellable C++ path. Build creation/deletion and FluxPack overlays show close/cancel rules honestly: close is disabled while running, and cancel is disabled unless the bridge capability reports support.

## NGIO Grass Cache Generation

The Skyrim-only No Grass In Objects integration extends `fluxora.bridge.v1` with `grassCache.generate` backed by `GrassCacheService` in C++:

- Native host routes `grassCache.generate` to `fluxora_generate_ngio_grass_cache` and emits `operations.progress` events during marker setup, SKSE launch/restart, output collection and mod registration.
- Tauri Rust shell/facade expose typed `window.fluxora.grassCache.generate` only; renderer still has no filesystem, shell, process or direct `invoke` access.
- Renderer owns only the visibility button, localized tooltip, custom confirmation dialog and operation overlay.
- C++ core remains the owner of Skyrim/NGIO validation, `PrecacheGrass.txt`, SKSE/VFS launch, `overwrite/Grass` collection and generated mod creation at `<build name> · Grass Cache`.
- C++ core treats NGIO generation as complete only after `PrecacheGrass.txt` disappears and `overwrite/Grass` contains output; partial `Grass` output while the marker remains is treated as an incomplete run that must restart.
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
- `mods.invalidateFileCaches`
- `mods.createSeparator`
- `mods.deleteSeparator`
- `mods.moveOrderItem`
- `mods.deleteInstalled`
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
- `nexus.getAuthStatus`
- `apiLimits.list`
- `nexus.connect`
- `nexus.connectWithApiKey`
- `nexus.disconnect`
- `transfer.analyzeMo2`
- `transfer.importMo2`
- `downloads.list`
- `downloads.importFile`
- `downloads.delete`
- `downloads.cancel`
- `downloads.resume`
- `downloads.analyzeContentLayout`
- `downloads.analyzeFomod`
- `downloads.analyzeFomodContentLayout`
- `downloads.install`
- `downloads.installFomod`
- `archives.install`
- `archives.installFomod`
- `nxm.registerProtocol`
- `nxm.captureLinks`
- `nxm.importInboundDownloads`
- `operations.setContext`
- `operations.clearContext`
- `operations.progress`
- `operations.cancel`

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
- Install/FOMOD/archive wizard screen flow, using evaluated DTOs from the bridge.

Tauri facade owns:

- A small `window.fluxora` API exposed through `Tauri invoke facade`.
- Argument/callback wrapping so renderer never sees `Tauri invoke` or Node primitives.
- Runtime shape validation before forwarding renderer calls to main.

Tauri Rust shell owns:

- Tauri webview window lifecycle, app startup/shutdown and single-instance behavior.
- Secure command allowlist.
- Native dialogs, external link handling, shell-open/show-in-folder behavior.
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
`chat.respond` request is in flight. Tauri main recognizes those notifications
on the AI host stdout stream, validates the canonical
`fluxora.ai.intermediate-event.v1` DTO, redacts text and typed payload values,
logs the sanitized event on the AI host log with `operationId`, and emits the
renderer channel `fluxora:ai:run-event` for
`window.fluxora.ai.onRunEvent(callback)`.

The renderer-surface event contract carries `eventId`, `runId`, `operationId`,
monotonic `seq`, `createdAt`, canonical event `type`, `level`, `visibility`,
`stage`, `message`, optional `percent`, and optional typed redacted `payload`.
Supported v1 types are `progress`, `note`, `tool-started`, `tool-completed`,
`site-visited`, `error`, and `heartbeat`. Tauri ignores unrelated JSON-RPC
notifications and provider-native event names instead of forwarding them.

AI events are for low-volume chat-run progress: prompt/context preparation,
local inspection, research route decisions, Nexus/web source capture or block,
provider attempt/fallback, finalization, heartbeat, and terminal blocked/error
state. They never replace the final `chat.respond` response, never expose raw
provider deltas or tool output, and never carry provider credentials,
`nativeNexusApiCredential`, Nexus auth headers, cookies, tokens, raw prompts,
raw HTML/page bodies, raw stdout/stderr, or full logs. C++ remains the owner of
domain operation progress and filesystem mutation truth.

### Cancellation

Cancellation uses a separate request:

```json
{ "jsonrpc": "2.0", "id": "req_cancel_1", "method": "operations.cancel", "params": { "operationId": "op_..." } }
```

Rules:

- `operations.cancel` returns `accepted`, `notFound` or `unsupported`.
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

### Nexus and NXM

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
but must not parse plugin files or invent master dependency data.

### Downloads and install

- `downloads.list`
- `downloads.importFile`
- `downloads.delete`
- `downloads.cancel`
- `downloads.resume`
- `downloads.install`
- `archives.install`
- `downloads.analyzeContentLayout`
- `downloads.analyzeFomod`
- `downloads.analyzeFomodContentLayout`
- `downloads.installFomod`
- `archives.installFomod`

### Operations

- `operations.setContext`
- `operations.clearContext`
- `operations.progress`
- `operations.cancel`
- `operations.getStatus`
- `operations.recentLogs`

`operations.getStatus` is in the typed contract. It allows renderer and AI recovery after refresh, route changes or bridge reconnects without inventing UI-only operation truth. The Tauri shell keeps a small read-only cache of recent `operations.progress` envelopes and exposes it as a compact status snapshot until the native core grows a broader persistent operation queue.

AI long-running jobs use a separate `fluxora.ai.autonomous-job.v1` / `fluxora.ai.autonomous-job-queue.v1` contract rather than overloading core operation snapshots. The AI queue records job plans, heartbeats, checkpoints, pause/cancel state and final reports for host orchestration, while C++ `operations.*` remains the source of truth for real domain operations and filesystem mutations.

`fluxora.ai.intermediate-event.v1` is the live AI run timeline contract that
feeds the chat panel and can be persisted into the autonomous job queue as a
bounded 80-event progress trail. It is correlated by `runId` and `operationId`,
not by core operation subscriptions, and support bundles expose counts only
unless a future explicit diagnostic export policy says otherwise.

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
- Settings/executables/Nexus/NXM: `fluxora_get_app_language`, `fluxora_set_app_language`, `fluxora_get_app_theme`, `fluxora_set_app_theme`, `fluxora_get_game_executables`, `fluxora_save_game_executables`, `fluxora_launch_game_executable`, `fluxora_get_executable_icon`, `fluxora_get_nexusmods_auth_status`, `fluxora_get_api_limit_status`, `fluxora_connect_nexusmods`, `fluxora_connect_nexusmods_with_api_key`, `fluxora_disconnect_nexusmods`, `fluxora_register_nxm_protocol`.
- Mods/profiles/plugins/downloads/install: every exported `fluxora_get_*`, `fluxora_create_*`, `fluxora_delete_*`, `fluxora_move_*`, `fluxora_set_*`, `fluxora_capture_nxm_links`, `fluxora_import_*`, `fluxora_install_*`, `fluxora_analyze_*` function listed in `FluxoraCoreApi.hpp`, plus `fluxora_generate_ngio_grass_cache` for Skyrim NGIO cache generation.

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
The shell selects the first writable log root in this order: explicit
`FLUXORA_LOG_DIR`, `<executable>/logs`, the per-user Fluxora data directory,
then the OS temporary Fluxora directory. Operation cancellation markers live
under the same selected writable root, so a protected installation directory
cannot prevent bridge startup.

## Concurrency

Current WPF `CoreBridgeService` serializes native calls because the native core is process-wide and destructive operations must not overlap unsafe reads. Bridge v1 keeps this rule:

- One mutating operation at a time per host.
- Read operations can be serialized initially.
- Allowlisted latency-sensitive reads and bounded user-interactive waits may use the separate interactive bridge-host lane when they are safe to run independently and have focused routing/isolation tests. Text editor file/tree reads and the `nexus.connect` loopback callback wait use this lane; editor save calls remain on the serialized main lane.
- Other parallel reads require explicit core approval and tests.
- Renderer can remain responsive because requests are asynchronous and progress/event driven.
- The 10-second bridge timeout is reserved for short control/read calls.
  Nexus OAuth connect uses a 180-second shell timeout around the native
  120-second callback deadline plus token exchange.
  Recursive project/mod cleanup, overwrite cleanup, local download import,
  archive/download install and FluxPack export/install use an explicit
  two-hour file-mutation budget so normal large filesystem work is not treated
  as a crashed host and terminated mid-operation.

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
