# Fluxora Tauri + C++ bridge architecture

Дата решения: 2026-06-24

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

- Native host routes `mods.listInstalled`, `mods.getOrder`, `mods.createSeparator`, `mods.deleteSeparator`, `mods.moveOrderItem`, `mods.deleteInstalled`, `mods.createEmpty`, `mods.setEnabled`, `mods.setAllEnabled`, `mods.checkUpdates`, `mods.clearOverwrite` and `mods.getFileTree` to existing C++ C ABI functions.
- Tauri Rust shell/facade expose typed `window.fluxora.mods.*` calls only; renderer still has no Node.js, filesystem or raw command access.
- Renderer owns local mod search, selection, row action menus, scroll windowing and expanded file-tree state.
- C++ core remains the owner of installed mod records, profile order, enabled state, separator persistence, update checks, file tree indexing and filesystem mutations.
- Selected-mod file tree is lazy by `relativeDirectory` so large mods do not require one unbounded payload.

## Phase 7 Plugins/Load Order MVP

Phase 7 extends `fluxora.bridge.v1` to the plugin/load-order workspace:

- Native host routes `plugins.list`, `plugins.move`, `plugins.createSeparator`, `plugins.deleteSeparator`, `plugins.setEnabled` and `plugins.setAllEnabled` to existing C++ C ABI functions backed by `PluginService`.
- Tauri Rust shell/facade expose typed `window.fluxora.plugins.*` calls only; renderer still has no Node.js, filesystem or raw command access.
- Renderer owns local plugin search, selection, row action menus, scroll windowing, selected-plugin details and capability explanation only.
- C++ core remains the owner of plugin detection, active plugin state, base-plugin locks, missing masters, separator persistence and load-order mutation rules.
- The renderer intersects bridge capability availability with the selected build's game capabilities. Unsupported games show an explanatory capability state instead of an empty broken panel.

## Phase 8 Downloads, NXM And Archive Install MVP

Phase 8 extends `fluxora.bridge.v1` to downloads and simple archive install:

- Native host routes `downloads.list`, `downloads.importFile`, `downloads.delete`, `downloads.cancel`, `downloads.resume`, `downloads.install`, `archives.install`, `nxm.registerProtocol`, `nxm.captureLinks` and `nxm.importInboundDownloads` to existing C++ C ABI functions backed by `DownloadService`.
- Tauri Rust shell/facade expose typed `window.fluxora.downloads.*`, `window.fluxora.archives.install` and `window.fluxora.nxm.*` calls only; renderer still has no Node.js, filesystem, shell or raw command access.
- Tauri Rust shell owns `nxm://` app activation handling through startup argv, Windows/Linux `second-instance` and macOS `open-url`, then forwards links to the bridge inbound queue.
- Renderer owns local download search, selection, row context menus, double-click install trigger, selected-download details and platform capability messaging only.
- C++ core remains the owner of NXM capture/import, local archive import, download transfer state, cancel/resume/delete and archive/download install behavior.
- Phase 8 intentionally keeps install UX to the simple path: ready archive/download plus mod name and fail-if-existing mode. Replace/merge, editable placement overrides and FOMOD wizard are the Phase 9 scope.

## Phase 9 Install UX, Placement Details And FOMOD MVP

Phase 9 extends `fluxora.bridge.v1` from simple install to the full WPF parity install flow:

- Native host routes `downloads.analyzeContentLayout`, `downloads.analyzeFomod`, `downloads.analyzeFomodContentLayout`, `downloads.installFomod` and `archives.installFomod` to existing C++ C ABI functions backed by `DownloadService`, `FomodInstallerService` and `ContentLayoutService`.
- Tauri Rust shell/facade expose typed install-analysis and FOMOD methods only; renderer still has no Node.js, filesystem, shell, native module or raw command access.
- Renderer owns the modal flow, FOMOD step navigation/selection state, previous-selection replay, replace/merge choice, local mod-name validation display and HTML drag/drop archive placement override collection.
- C++ core remains the owner of archive extraction, FOMOD descriptor evaluation inputs, content-layout analysis, placement override validation, existing-mod replace/merge behavior and final filesystem mutation.
- Placement details send only `{ sourcePath, target, targetRelativePath }` override records back to core. Renderer never moves archive files directly.

## Phase 10 Profiles And Executables MVP

Phase 10 extends `fluxora.bridge.v1` to WPF-parity profile management and executable launch configuration:

- Native host routes `profiles.list`, `profiles.create`, `profiles.clone`, `profiles.rename`, `profiles.delete`, `executables.list`, `executables.save`, `executables.getIcon` and `executables.launch` to existing C++ C ABI functions backed by `ProfileService` and `ExecutableService`.
- Tauri Rust shell/facade expose typed `window.fluxora.profiles.*` and `window.fluxora.executables.*` calls only; renderer still has no Node.js, filesystem, shell, native module or raw command access.
- Renderer owns profile/executable search, selected-row state, in-app edit controls, two-step destructive confirmation state, icon/launch status display and capability explanations only.
- C++ core remains the owner of profile folder/state mutations, executable metadata persistence, icon resolving, launch cache preparation and process launch behavior.
- Executable management and executable launch are exposed as separate capability flags so non-Windows bridge builds can still edit launch entries while honestly disabling launch.

## Phase 11 Settings, Nexus Mods And MO2 Transfer MVP

Phase 11 extends `fluxora.bridge.v1` to WPF-parity settings and MO2 transfer:

- Native host routes `settings.getTheme`, `settings.setTheme`, `nexus.getAuthStatus`, `nexus.connect`, `nexus.disconnect`, `transfer.analyzeMo2` and `transfer.importMo2` to existing C++ C ABI functions backed by `AppSettingsService`, `NexusModsAuthService` and `ModOrganizerImportService`; the Tauri shell handles `operations.cancel` for MO2 transfer by writing an operation cancel marker outside the bridge request mutex. The theme contract currently normalizes every value to the single supported dark theme.
- Native host emits `operations.progress` JSON-RPC events during MO2 import. Tauri main subscribes through the bridge client and broadcasts them on the allowlisted `fluxora:operations:progress` channel.
- Tauri Rust shell/facade expose typed `window.fluxora.settings.*`, `window.fluxora.nexus.*`, `window.fluxora.transfer.*` and `window.fluxora.operations.*` calls only; renderer still has no Node.js, filesystem, shell, native module or raw command access.
- Renderer owns settings section state, language controls, single-theme mirroring into CSS, Nexus status display, MO2 source/destination form state, analysis display, transfer progress display and route/close guard while transfer is running. Theme customization controls are deferred until more supported themes are added.
- C++ core remains the owner of persisted app settings, Nexus OAuth status/connect/disconnect behavior, MO2 analysis/import rules, disk-space checks, project creation/replacement, transfer cancellation checks and filesystem cleanup.
- MO2 transfer cancellation is scoped to the transfer operation: the renderer enables `Отменить и очистить` for a running transfer, Tauri writes a marker keyed by `operationId`, and C++ stops before activation or during copy/database work and removes staging files through the existing import failure cleanup path.

## Phase 12 Build Settings, FluxPack And Build Operations MVP

Phase 12 extends `fluxora.bridge.v1` to WPF-parity build path settings and FluxPack workflows:

- Native host routes `buildPaths.get`, `buildPaths.save`, `fluxPack.export`, `fluxPack.inspect` and `fluxPack.install` to existing C++ C ABI functions backed by `BuildPathSettingsService`, `ExecutableService`, `FluxPackService` and `ProjectService`.
- Native host now calls `fluxora_delete_project_with_progress` for `projects.delete` and emits `operations.progress` events for project deletion.
- Native host emits `operations.progress` events during FluxPack install provider/source progress. FluxPack export remains a request/response operation because the current C++ export API does not expose a progress callback.
- Tauri Rust shell/facade expose typed `window.fluxora.buildPaths.*`, `window.fluxora.fluxPack.*` and `.fluxpack` native open/save dialogs only; renderer still has no Node.js, filesystem, shell, native module or raw command access.
- Renderer owns the Build Paths inspector, primary executable form state, native browse/save/open dialog orchestration, FluxPack summary display and operation overlays. C++ core remains the owner of path persistence, executable persistence, FluxPack recipe creation, package inspection, package install, provider/source handling and filesystem mutation.
- Generic operation cancellation remains capability-reported as unsupported until each operation has a cancellable C++ path. Build creation/deletion and FluxPack overlays show close/cancel rules honestly: close is disabled while running, and cancel is disabled unless the bridge capability reports support.

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
- `fluxPack.export`
- `fluxPack.inspect`
- `fluxPack.install`
- `mods.listInstalled`
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
- `nexus.connect`
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

First request after host spawn:

```json
{ "jsonrpc": "2.0", "id": "hello_1", "method": "system.handshake", "params": { "supportedProtocolVersions": ["1.0"] } }
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

- `fluxPack.export`
- `fluxPack.inspect`
- `fluxPack.install`

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
- `nexus.connect`
- `nexus.disconnect`
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

### Plugins

- `plugins.list`
- `plugins.move`
- `plugins.createSeparator`
- `plugins.deleteSeparator`
- `plugins.setEnabled`
- `plugins.setAllEnabled`

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

`operations.getStatus` is new in the typed contract. It allows renderer recovery after refresh, route changes or bridge reconnects without inventing UI-only operation truth.

## Mapping from current C ABI

The native host initially maps bridge methods to the existing exported functions:

- Availability and metadata: `fluxora_core_is_available`, `fluxora_get_last_error`.
- Host lifecycle: `fluxora_core_shutdown`.
- Operation context/log correlation: `fluxora_set_operation_context`.
- Buffer handling: `fluxora_get_last_required_buffer_length`, `fluxora_copy_last_output`.
- Templates/projects/build paths: `fluxora_get_game_templates`, `fluxora_resolve_template`, `fluxora_preview_project_directory`, `fluxora_create_project`, `fluxora_open_project_config`, `fluxora_list_project_configs`, `fluxora_rename_project`, `fluxora_delete_project`, `fluxora_delete_project_with_progress`, `fluxora_get_build_path_settings`, `fluxora_save_build_path_settings`.
- FluxPack and transfer: `fluxora_export_fluxpack`, `fluxora_inspect_fluxpack`, `fluxora_install_fluxpack`, `fluxora_analyze_mod_organizer_instance`, `fluxora_import_mod_organizer_instance`.
- Settings/executables/Nexus/NXM: `fluxora_get_app_language`, `fluxora_set_app_language`, `fluxora_get_app_theme`, `fluxora_set_app_theme`, `fluxora_get_game_executables`, `fluxora_save_game_executables`, `fluxora_launch_game_executable`, `fluxora_get_executable_icon`, `fluxora_get_nexusmods_auth_status`, `fluxora_connect_nexusmods`, `fluxora_disconnect_nexusmods`, `fluxora_register_nxm_protocol`.
- Mods/profiles/plugins/downloads/install: every exported `fluxora_get_*`, `fluxora_create_*`, `fluxora_delete_*`, `fluxora_move_*`, `fluxora_set_*`, `fluxora_capture_nxm_links`, `fluxora_import_*`, `fluxora_install_*`, `fluxora_analyze_*` function listed in `FluxoraCoreApi.hpp`.

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

## Concurrency

Current WPF `CoreBridgeService` serializes native calls because the native core is process-wide and destructive operations must not overlap unsafe reads. Bridge v1 keeps this rule:

- One mutating operation at a time per host.
- Read operations can be serialized initially.
- Parallel reads require explicit core approval and tests.
- Renderer can remain responsive because requests are asynchronous and progress/event driven.

## Testing and validation strategy

Phase 1 is documentation and contract design, so no product build is required to close this phase. Later phases must add:

- Native host unit tests for envelope parsing, error mapping and method routing.
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
