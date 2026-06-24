# Fluxora Electron Migration

Дата обновления: 2026-06-24

Статус: Phase 17 deprecation and removal is in place. The active product shape is C++ core in `backend/` plus Electron UI in `frontend-electron/`; the old C# WPF product frontend and its C# test project have been removed from the active repository structure.

## Current Phase

Phases already completed or bootstrapped:

- Phase 0: WPF UI inventory is captured in `docs/electron-migration/wpf-ui-inventory.md`.
- Phase 1: Electron + C++ bridge architecture is captured in `docs/electron-migration/architecture.md`.
- Phase 2: Electron bootstrap shell exists in `frontend-electron/`.
- Phase 3: Agent-ready docs and project rules now point future UI work to Electron.
- Phase 4: Bridge MVP initializes the native core, reads/writes language settings through C++ and reports bridge readiness/failure in Electron.
- Phase 5: Electron main shell and build home screen list, open, create, rename, delete and shell-open build projects through the typed C++ bridge.
- Phase 6: Workspace mods list, order, search, enabled state, separators, row actions and selected-mod file tree run through typed Electron APIs backed by the C++ bridge.
- Phase 7: Workspace plugins/load order list, search, enabled state, separators, move actions, selected-plugin details and capability state run through typed Electron APIs backed by the C++ bridge.
- Phase 8: Downloads list, local archive import, selected download install, direct archive install, cancel/resume/delete, NXM registration/capture/import and shell reveal run through typed Electron APIs backed by the C++ bridge.
- Phase 9: Install UX replace/merge, editable archive placement tree and FOMOD wizard run through typed Electron APIs backed by the C++ bridge.
- Phase 10: Profiles list/create/clone/rename/delete and executables list/save/icon/launch run through typed Electron APIs backed by the C++ bridge.
- Phase 11: Settings sections, language, light/dark theme persistence, Nexus Mods auth state/connect/disconnect, MO2 transfer analysis/import and operation progress events run through typed Electron APIs backed by the C++ bridge.
- Phase 12: Build path settings, primary game executable persistence, FluxPack export/inspect/install and build operation overlays run through typed Electron APIs backed by the C++ bridge.
- Phase 13: Electron design-system foundation, shared visual tokens, focus/reduced-motion states, deferred search, virtualized heavy lists/archive details, performance budget and visual/performance smoke gates are in place.
- Phase 14: Cross-platform support matrix, Electron platform capability display, Forge protocol/native-resource packaging hooks and backend path-safety hardening are documented in `docs/electron-migration/cross-platform-support.md`.
- Phase 15: Windows Electron payload packaging now flows through `Build.ps1` into the approved installer, Forge smoke artifacts are separated from public releases, and bundled legal/privacy/third-party notices are updated.
- Phase 16: Formal test strategy, parity matrix, Electron parity drift guard and repository-level parity gate script are documented in `docs/electron-migration/parity-gate.md`.
- Final migration DoD: `docs/electron-migration/final-definition-of-done.md` closes the active WPF-to-Electron migration while keeping public release evidence gates explicit.

Current implementation phase:

- Final migration DoD: C++ core + Electron UI is the active product architecture. Remaining gates are public release evidence, not WPF preservation or migration blockers.

## What Is Migrated

Current Electron state:

- Electron main process, preload and renderer are bootstrapped.
- React + Vite renderer shell exists.
- Typed `window.fluxora` preload API exists.
- Basic security baseline is represented in main/preload tests and docs.
- Vitest and Playwright are wired for Electron validation.
- `fluxora.bridge.v1` native host process MVP exists as `FluxoraBridgeHost`.
- Electron main starts the bridge host, performs `system.handshake`, initializes core status and exposes language get/set through preload.
- Build catalog/home: `projects.listConfigs`, `projects.openConfig`, `projects.create`, `projects.rename`, `projects.delete`, `projects.previewDirectory`, `templates.list`, native pickers and shell-open are wired through Electron main/preload.
- Mods workspace: `mods.listInstalled`, `mods.getOrder`, `mods.setEnabled`, `mods.setAllEnabled`, `mods.moveOrderItem`, `mods.createSeparator`, `mods.deleteSeparator`, `mods.createEmpty`, `mods.deleteInstalled`, `mods.checkUpdates` and `mods.getFileTree` are wired through Electron main/preload. Renderer owns search, selection, row context menus, local scroll windowing and lazy file-tree expansion only.
- Plugins workspace: `plugins.list`, `plugins.setEnabled`, `plugins.move`, `plugins.createSeparator` and `plugins.deleteSeparator` are wired through Electron main/preload and the native bridge host to C++ `PluginService`. Renderer owns search, selection, row action menus, local scroll windowing, selected-plugin details and capability explanation only.
- Downloads workspace: `downloads.list`, `downloads.importFile`, `downloads.delete`, `downloads.cancel`, `downloads.resume`, `downloads.install`, `archives.install`, `nxm.registerProtocol`, `nxm.captureLinks` and `nxm.importInboundDownloads` are wired through Electron main/preload and the native bridge host to C++ `DownloadService`. Renderer owns search, selection, row context menus, double-click install trigger, local scroll windowing, selected-download details and platform capability messages only.
- Install UX: `downloads.analyzeContentLayout`, `downloads.analyzeFomod`, `downloads.analyzeFomodContentLayout`, `downloads.installFomod` and `archives.installFomod` are wired through Electron main/preload and the native bridge host to existing C++ install/FOMOD/content-layout services. Renderer owns modal flow, mod-name validation display, replace/merge choice, FOMOD step state and HTML drag/drop placement overrides only.
- Profiles and executables workspace: `profiles.list`, `profiles.create`, `profiles.clone`, `profiles.rename`, `profiles.delete`, `executables.list`, `executables.save`, `executables.getIcon` and `executables.launch` are wired through Electron main/preload and the native bridge host to existing C++ profile/executable services. Renderer owns search, selection, in-app edit controls, table state and launch/status display only.
- Settings workspace: `settings.getLanguage`, `settings.setLanguage`, `settings.getTheme`, `settings.setTheme`, `nexus.getAuthStatus`, `nexus.connect`, `nexus.disconnect`, `transfer.analyzeMo2`, `transfer.importMo2`, `operations.progress` and `operations.cancel` are wired through Electron main/preload and the native bridge host to existing C++ settings/Nexus/MO2 services. Renderer owns settings section selection, local form state, theme mirroring, Nexus status display, MO2 transfer validation/progress display and route close rules only.
- Build/FluxPack workspace: `buildPaths.get`, `buildPaths.save`, `fluxPack.export`, `fluxPack.inspect`, `fluxPack.install`, project delete progress events and FluxPack install progress events are wired through Electron main/preload and the native bridge host to existing C++ build path, project and FluxPack services. Renderer owns path form state, native browse/save/open dialog orchestration, FluxPack summaries and operation overlays only.
- Phase 13 UI foundation: design tokens and component rules are documented in `docs/electron-migration/electron-design-system.md`; performance budgets and profiling gates are documented in `docs/electron-migration/performance-budget.md`; renderer list/windowing helpers live in `frontend-electron/src/renderer/ui-performance.ts`.
- Phase 14 platform hardening: `NativeBridgeStatus.capabilities.supportMatrix` exposes Windows/Linux/macOS readiness; Settings shows platform capability rows; Forge declares `nxm` protocol metadata and can copy native payloads from `FLUXORA_NATIVE_RESOURCES` into `resources/native`; backend path-safety tests cover Unicode, Cyrillic/German characters, spaces, long-path and platform case rules.
- Phase 15 release hardening: `docs/electron-migration/release-pipeline.md` defines approved artifacts; the default root release build packages Electron + `resources/native` into `output-installer/FluxoraSetup.exe`; installer core accepts the Electron `Fluxora.exe` entrypoint.
- Phase 17 removal: root `Build.ps1` is Electron-only, `frontend/` and `frontend.Tests/` are removed, installer-local WPF helper assets live under `installer/Fluxora.Installer/`, and agent docs no longer permit new C# WPF product UI work.

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

`frontend-electron/` is the target UI. It owns:

- Electron main window lifecycle and app shell;
- preload `contextBridge` API;
- renderer routes, components, dialogs, tables, trees and visual state;
- safe native dialogs and shell/external-link calls through main/preload;
- UI orchestration around typed bridge calls.

The old `frontend/` C# WPF product UI has been removed. Use `docs/electron-migration/wpf-ui-inventory.md` as historical parity inventory only; do not recreate WPF product UI or `frontend.Tests/`.

## Agent Rules

Before large UI, bridge or migration work:

- read this file;
- read `docs/electron-migration/wpf-ui-inventory.md`;
- read `docs/electron-migration/architecture.md`;
- use Graphify before broad repository search when `graphify-out/graph.json` exists.

Do not move business logic into Electron. Renderer code may display, select, filter locally for UI purposes and orchestrate dialogs, but C++ remains the owner of project/profile/mod/install/download/VFS/FluxPack/Nexus decisions.

When changing the bridge:

- update protocol/DTO docs in `docs/electron-migration/architecture.md`;
- add or update main/preload/bridge tests;
- keep error envelopes, progress events, cancellation, operation IDs and capability flags consistent;
- keep Electron main/bridge logs separate from renderer/UI logs and C++ core logs.
- keep `docs/electron-migration/cross-platform-support.md` aligned when platform capability fields, package metadata, protocol registration or native resource layout changes.

When changing project instructions or agent configuration:

- update `AGENTS.md` and `.agents/PROJECT_RULES.md` together when both are affected;
- run `graphify update .` afterward.

## Electron Security Baseline

Every production Electron window must keep:

- `contextIsolation: true`;
- `nodeIntegration: false`;
- `sandbox: true` by default;
- typed APIs exposed through preload `contextBridge`;
- allowlisted async IPC only;
- no raw `ipcRenderer`, `shell`, `fs`, `path`, `child_process` or native module exposure to renderer;
- no `sendSync`;
- controlled navigation;
- safe external-link handling in main;
- Content Security Policy;
- no remote module.

This matches the Electron guidance checked for this phase through Context7.

## How To Run Electron

```powershell
cd frontend-electron
npm install
npm run dev
```

Useful validation commands:

```powershell
cd frontend-electron
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

The current Windows public release artifact remains `output-installer/FluxoraSetup.exe`. Do not publish `output/`, `frontend-electron/out/`, `build/electron-native/`, Electron Forge staging folders, Forge smoke installers or ad-hoc portable archives.

`Build.ps1` now defaults to an Electron payload and embeds the packaged Electron app plus native bridge/core into the approved Windows installer:

```powershell
.\Build.ps1 -Configuration Release -Runtime win-x64
```

Electron Forge package/make output is a smoke artifact. The Windows Forge Squirrel smoke setup is named `FluxoraElectronSmokeSetup.exe` so it cannot be confused with the approved installer. See `docs/electron-migration/release-pipeline.md` for the full Phase 15 release checklist.

Optional native-payload smoke packaging:

```powershell
$env:FLUXORA_NATIVE_RESOURCES = "C:\Fluxora\build\electron-native"
cd frontend-electron
npm run build
```
