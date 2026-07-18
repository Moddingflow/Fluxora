# Fluxora Tauri Migration

Дата обновления: 2026-06-24

Статус: Phase 17 deprecation and removal is in place. The active product shape is C++ core in `backend/` plus Tauri UI in `frontend-tauri/`; the old C# WPF product frontend and its C# test project have been removed from the active repository structure.

## Current Phase

Phases already completed or bootstrapped:

- Phase 0: WPF UI inventory is captured in `docs/tauri-migration/wpf-ui-inventory.md`.
- Phase 1: Tauri + C++ bridge architecture is captured in `docs/tauri-migration/architecture.md`.
- Phase 2: Tauri bootstrap shell exists in `frontend-tauri/`.
- Phase 3: Agent-ready docs and project rules now point future UI work to Tauri.
- Phase 4: Bridge MVP initializes the native core, reads/writes language settings through C++ and reports bridge readiness/failure in Tauri.
- Phase 5: Tauri main shell and build home screen list, open, create, rename, delete and shell-open build projects through the typed C++ bridge.
- Phase 6: Workspace mods list, order, search, enabled state, separators, row actions and selected-mod file tree run through typed Tauri APIs backed by the C++ bridge.
- Phase 7: Workspace plugins/load order list, search, enabled state, separators, move actions, selected-plugin details and capability state run through typed Tauri APIs backed by the C++ bridge.
- Phase 8: Downloads list, local archive import, selected download install, direct archive install, cancel/resume/delete, NXM registration/capture/import and shell reveal run through typed Tauri APIs backed by the C++ bridge.
- Phase 9: Install UX replace/merge, editable archive placement tree and FOMOD wizard run through typed Tauri APIs backed by the C++ bridge.
- Phase 10: Profiles list/create/clone/rename/delete and executables list/save/icon/launch run through typed Tauri APIs backed by the C++ bridge.
- Phase 11: Settings sections, language, single dark theme state with a preserved theme contract, Nexus Mods auth state/connect/disconnect, MO2 transfer analysis/import and operation progress events run through typed Tauri APIs backed by the C++ bridge.
- Phase 12: Build path settings, primary game executable persistence, FluxPack export/inspect/install and build operation overlays run through typed Tauri APIs backed by the C++ bridge.
- Phase 13: Tauri design-system foundation, shared visual tokens, focus/reduced-motion states, deferred search, virtualized heavy lists/archive details, performance budget and visual/performance smoke gates are in place.
- Redesign Phase 1: target renderer split for the new Tauri redesign is captured in `docs/tauri-migration/redesign-renderer-architecture.md`.
- Redesign Phase 12: initial monolith cleanup moved install/FOMOD, settings workspace, build paths drawer and library metric helpers out of `App.tsx` into feature-owned Tauri renderer modules.
- Phase 14: Cross-platform support matrix, Tauri platform capability display, Tauri protocol/native-resource packaging hooks and backend path-safety hardening are documented in `docs/tauri-migration/cross-platform-support.md`.
- Phase 15: Windows Tauri payload packaging now flows through `Build.ps1` into the approved installer, Tauri smoke artifacts are separated from public releases, and bundled legal/privacy/third-party notices are updated.
- Phase 16: Formal test strategy, parity matrix, Tauri parity drift guard and repository-level parity gate script are documented in `docs/tauri-migration/parity-gate.md`.
- Final migration DoD: `docs/tauri-migration/final-definition-of-done.md` closes the active WPF-to-Tauri migration while keeping public release evidence gates explicit.

Current implementation phase:

- Final migration DoD: C++ core + Tauri UI is the active product architecture. Remaining gates are public release evidence, not WPF preservation or migration blockers.

## What Is Migrated

Current Tauri state:

- Tauri Rust shell, typed facade and renderer are bootstrapped.
- React + Vite renderer shell exists.
- Typed `window.fluxora` facade API exists.
- Basic security baseline is represented in Rust shell/facade tests and docs.
- Vitest and Playwright are wired for Tauri validation.
- `fluxora.bridge.v1` native host process MVP exists as `FluxoraBridgeHost`.
- Tauri Rust shell starts the bridge host, performs `system.handshake`, initializes core status and exposes language get/set through facade.
- Build catalog/home: `projects.listConfigs`, `projects.openConfig`, `projects.create`, `projects.rename`, `projects.delete`, `projects.previewDirectory`, `templates.list`, native pickers and shell-open are wired through Tauri Rust shell/facade.
- Mods workspace: `mods.listInstalled`, `mods.getOrder`, `mods.setEnabled`, `mods.setAllEnabled`, `mods.moveOrderItem`, `mods.createSeparator`, `mods.deleteSeparator`, `mods.createEmpty`, `mods.deleteInstalled`, `mods.checkUpdates`, `mods.clearOverwrite` and `mods.getFileTree` are wired through Tauri Rust shell/facade. Mod rows include conflict counts plus `overwritesModIds` / `overwrittenByModIds` from C++ for MO2-style row and scrollbar highlighting. Renderer owns search, selection, row context menus, local scroll windowing and lazy file-tree expansion only.
- Plugins workspace: `plugins.list`, `plugins.setEnabled`, `plugins.setAllEnabled`, `plugins.move`, `plugins.createSeparator` and `plugins.deleteSeparator` are wired through Tauri Rust shell/facade and the native bridge host to C++ `PluginService`. Plugin rows include C++-read `masterFiles` plus computed `missingMasters`; renderer owns search, selection, row action menus, local scroll windowing, selected-plugin details, collapsed-separator status aggregation and capability explanation only.
- Downloads workspace: `downloads.list`, `downloads.importFile`, `downloads.delete`, `downloads.cancel`, `downloads.resume`, `nxm.registerProtocol`, `nxm.captureLinks` and `nxm.importInboundDownloads` are wired through Tauri Rust shell/facade and the native bridge host to C++ `DownloadService`. Renderer owns search, selection, row context menus, double-click install trigger, local scroll windowing, selected-download details and platform capability messages only.
- Install UX: renderer submits durable work through typed `installs.submit/restore/list/get`; two heavy workers, target waiting, commit serialization, crash recovery and aggregate conflict projection stay in C++ core. The renderer owns its operation-keyed optimistic rows, independent status display, one-time reveal animation, `needsReview` reopen flow and the FOMOD/placement dialog state only. Synchronous `downloads.install*` / `archives.install*` remain compatibility adapters for native tests.
- Profiles and executables workspace: `profiles.list`, `profiles.create`, `profiles.clone`, `profiles.rename`, `profiles.delete`, `executables.list`, `executables.save`, `executables.getIcon` and `executables.launch` are wired through Tauri Rust shell/facade and the native bridge host to existing C++ profile/executable services. Windows launch lifetime uses the OS process signal first, polling only as fallback, and dynamically hands the splash to another live process that still has `FluxoraVfs.dll` loaded. Renderer owns search, selection, in-app edit controls, table state and launch/status display only; the splash closes before the asynchronous post-exit workspace refresh.
- Settings workspace: `settings.getLanguage`, `settings.setLanguage`, `settings.getTheme`, `settings.setTheme`, `nexus.getAuthStatus`, `nexus.connect`, `nexus.connectWithApiKey`, `nexus.disconnect`, `transfer.analyzeMo2`, `transfer.importMo2`, `operations.progress` and transfer-scoped `operations.cancel` are wired through Tauri Rust shell/facade and existing C++ settings/Nexus/MO2 services. Renderer owns settings section selection, local form state, single-theme CSS mirroring, Nexus status display, MO2 transfer validation/progress display and route close rules only; theme customization controls are intentionally absent while only the dark theme is supported.
- Build/FluxPack workspace: `buildPaths.get`, `buildPaths.save`, `fluxPack.export`, `fluxPack.inspect`, `fluxPack.install`, project delete progress events and FluxPack install progress events are wired through Tauri Rust shell/facade and the native bridge host to existing C++ build path, project and FluxPack services. Renderer owns path form state, native browse/save/open dialog orchestration, FluxPack summaries and operation overlays only.
- Phase 13 UI foundation: design tokens and component rules are documented in `docs/tauri-migration/tauri-design-system.md`; performance budgets and profiling gates are documented in `docs/tauri-migration/performance-budget.md`; renderer list/windowing helpers live in `frontend-tauri/src/renderer/ui-performance.ts`.
- Redesign Phase 1 renderer architecture: `docs/tauri-migration/redesign-renderer-architecture.md` defines the target `design-system/`, `components/chrome/` and feature-module split while preserving `styles.css` as the public CSS entrypoint and `window.fluxora` as the only renderer facade.
- Redesign Phase 12 renderer cleanup: `features/install/InstallDialog.tsx`, `features/settings/SettingsWorkspace.tsx`, `features/build/BuildPathsInspector.tsx` and `features/library/projectLibraryStats.ts` now own their UI/helper surfaces while `App.tsx` keeps selected project state, facade calls and route orchestration.
- Phase 14 platform hardening: `NativeBridgeStatus.capabilities.supportMatrix` exposes Windows/Linux/macOS readiness; Settings shows platform capability rows; Tauri declares `nxm` protocol metadata and can copy native payloads from `src-tauri/resources/native` into `resources/native`; backend path-safety tests cover Unicode, Cyrillic/German characters, spaces, long-path and platform case rules.
- Phase 15 release hardening: `docs/tauri-migration/release-pipeline.md` defines approved artifacts; the default root release build packages Tauri + `resources/native` into `output-installer/FluxoraSetup.exe`; installer core accepts the Tauri `Fluxora.exe` entrypoint.
- Phase 17 removal: root `Build.ps1` is Tauri-only, `frontend/` and `frontend.Tests/` are removed, installer-local WPF helper assets live under `installer/Fluxora.Installer/`, and agent docs no longer permit new C# WPF product UI work.

Not public-release accepted yet:

- Final signing/notarization and clean-machine public release smoke.
- Real archive/FOMOD/MO2 fixture acceptance, Linux/macOS smoke evidence, clean-machine Windows installer smoke and full profiling.
- macOS dmg/signing pipeline.

## Architecture Boundary

`backend/` is the C++ core. It owns:

- project/profile/mod/plugin/download/install behavior;
- archive extraction and FOMOD/domain decisions;
- FluxPack, Nexus Mods, NXM and VFS behavior;
- filesystem mutations and path safety;
- operation, core, bridge and crash logs;
- platform capability truth for domain features.

`frontend-tauri/` is the target UI. It owns:

- Tauri main window lifecycle and app shell;
- facade `Tauri invoke facade` API;
- renderer routes, components, dialogs, tables, trees and visual state;
- safe native dialogs and shell/external-link calls through Rust shell/facade;
- UI orchestration around typed bridge calls.

The old `frontend/` C# WPF product UI has been removed. Use `docs/tauri-migration/wpf-ui-inventory.md` as historical parity inventory only; do not recreate WPF product UI or `frontend.Tests/`.

## Agent Rules

Before large UI, bridge or migration work:

- read this file;
- read `docs/tauri-migration/wpf-ui-inventory.md`;
- read `docs/tauri-migration/architecture.md`;
- use Graphify before broad repository search when `graphify-out/graph.json` exists.

Do not move business logic into Tauri. Renderer code may display, select, filter locally for UI purposes and orchestrate dialogs, but C++ remains the owner of project/profile/mod/install/download/VFS/FluxPack/Nexus decisions.

When changing the bridge:

- update protocol/DTO docs in `docs/tauri-migration/architecture.md`;
- add or update Rust shell/facade/bridge tests;
- keep error envelopes, progress events, cancellation, operation IDs and capability flags consistent;
- keep Tauri main/bridge logs separate from renderer/UI logs and C++ core logs.
- keep `docs/tauri-migration/cross-platform-support.md` aligned when platform capability fields, package metadata, protocol registration or native resource layout changes.

When changing project instructions or agent configuration:

- update `AGENTS.md` and `.agents/PROJECT_RULES.md` together when both are affected;
- run `graphify update .` afterward.

## Tauri Security Baseline

Every production Tauri window must keep:

- `contextIsolation: true`;
- `nodeIntegration: false`;
- `sandbox: true` by default;
- typed APIs exposed through facade `Tauri invoke facade`;
- allowlisted async command only;
- no raw `Tauri invoke`, `shell`, `fs`, `path`, `child_process` or native module exposure to renderer;
- no `sendSync`;
- controlled navigation;
- safe external-link handling in main;
- Content Security Policy;
- no remote module.

This matches the Tauri guidance checked for this phase through Context7.

## How To Run Tauri

Install the Rust stable toolchain first so `cargo` and `rustc` are available in `PATH`.

```powershell
cd frontend-tauri
npm install
npm run dev
```

Useful validation commands:

```powershell
cd frontend-tauri
npm run typecheck
npm test
npm run test:parity
npm run parity:gate
npm run build
npm run test:e2e
```

`npm run test:e2e` currently runs `npm run build` first.

Repository-level Phase 16 gate:

```powershell
.\scripts\Invoke-FluxoraParityGate.ps1
```

## Backend And Bridge Validation

Backend validation:

```powershell
cmake -S backend -B build/backend
cmake --build build/backend
ctest --test-dir build/backend --output-on-failure
```

The Phase 4 native bridge host target is:

```powershell
cmake --build build/backend --target FluxoraBridgeHost
```

Focused Phase 4 backend validation:

```powershell
cmake --build build/backend --target FluxoraCoreTests
.\build\backend\tests\Debug\FluxoraCoreTests.exe --gtest_filter=AppSettingsServiceTests.*
```

`ctest --test-dir build/backend -N` may fail on a stale generated `FluxoraInstallerCoreTests` include until that test target is generated in the local build tree; use the direct filtered executable above for Phase 4 language/settings validation.

## Release Notes For Migration Period

The current Windows public release artifact remains `output-installer/FluxoraSetup.exe`. Do not publish `output/`, `frontend-tauri/src-tauri/target/`, `build/tauri-native/`, Tauri bundler staging folders, Tauri smoke installers or ad-hoc portable archives.

`Build.ps1` now defaults to a Tauri payload and embeds the packaged Tauri app plus native bridge/core into the approved Windows installer:

```powershell
.\Build.ps1 -Configuration Release -Runtime win-x64
```

Tauri bundler output is a smoke artifact. The Windows Tauri NSIS smoke setup is named by Tauri under `frontend-tauri/src-tauri/target/release/bundle/nsis/` and must not be confused with the approved installer. See `docs/tauri-migration/release-pipeline.md` for the full Phase 15 release checklist.

Optional native-payload smoke packaging:

```powershell
Copy-Item C:\Fluxora\build\tauri-native\win32\x64\* C:\Fluxora\frontend-tauri\src-tauri\resources\native\ -Force
cd frontend-tauri
npm run build
```
