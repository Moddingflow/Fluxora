# Fluxora redesign renderer architecture

Дата решения: 2026-06-25

Статус: Фаза 1 redesign roadmap закрыта как архитектурная раскладка. Фаза 12 начала production cleanup: крупные Tauri UI surfaces вынесены из `App.tsx` в feature-owned компоненты без изменения bridge/runtime поведения.

## Inputs reviewed

- `docs/tauri-migration/architecture.md`
- `docs/tauri-migration/tauri-design-system.md`
- `docs/tauri-migration/parity-gate.md`
- `docs/tauri-migration/final-definition-of-done.md`
- `docs/tauri-migration/cross-platform-support.md`
- `docs/tauri-migration/release-pipeline.md`
- `frontend-tauri/src/renderer/App.tsx`
- `frontend-tauri/src/renderer/*-workspace-state.ts`
- `frontend-tauri/src/renderer/services/*`
- `frontend-tauri/src/tauri/fluxora-api.ts`
- `frontend-tauri/src/shared/fluxora-api.ts`

Graphify query for the broad redesign split returned backend-heavy noise around `DownloadService`, so the inspection fell back to the known active Tauri paths above.

## Current renderer responsibility map

`frontend-tauri/src/renderer/App.tsx` is still the main composition file for the active product UI. After redesign Phase 12 it owns app startup, route selection, selected build context, bridge/security state, operation wiring and feature orchestration; large install, settings and build-path UI surfaces are no longer inline render blocks.

| Area | Current home | Current responsibility |
| --- | --- | --- |
| App shell/titlebar | `App.tsx` `renderTitlebar` | Frameless chrome, drag region and `window.fluxora.windowControls` calls. |
| Library/home/catalog | `features/library/LibraryHome.tsx`, `features/library/projectLibraryStats.ts`, `App.tsx`, `project-catalog-state.ts`, `services/project-catalog-service.ts` | Project list/search, create/open/rename/delete, visible FluxPack install entry, template filtering, catalog loading and compact project metrics. |
| Build workspace | `App.tsx`, `features/build/BuildDetailHeader.tsx`, `features/build/BuildPathsInspector.tsx`, `features/fluxpack/*`, `build-workspace-state.ts` | Build header actions, build path drawer, FluxPack inspect/plan/conflict/manual-download orchestration and summary state. |
| Mods table/tree | `App.tsx`, `mod-workspace-state.ts`, `ui-performance.ts` | Mod list/order/search, row menus, virtual windowing, file tree expansion and bridge calls. |
| Plugins/load order | `App.tsx`, `plugin-workspace-state.ts`, `ui-performance.ts` | Plugin list/order/search, row menus, virtual windowing, selected-plugin details and capability state. |
| Downloads/install entry | `App.tsx`, `download-workspace-state.ts` | Download list/search, row context menu, import/archive/NXM actions and selected-download details. |
| Install/FOMOD/details | `features/install/InstallDialog.tsx`, `App.tsx`, `install-workspace-state.ts` | Dialog state, analyze/install flow, FOMOD selections, placement overrides and virtualized details tree. |
| Profiles/executables | `App.tsx`, `profiles-executables-workspace-state.ts` | Profile CRUD, executable list/edit/icon/launch state and capability display. |
| Settings/transfer | `features/settings/SettingsWorkspace.tsx`, `App.tsx`, `settings-workspace-state.ts`, `TransferSettingsPanel.tsx`, `TransferMo2Page.tsx`, `mo2-transfer-request.ts` | Settings nav, Nexus/language/transfer forms, MO2 handoff page and transfer progress/cancel state. |
| Operation overlays/dialogs | `features/operations/OperationOverlay.tsx`, `features/fluxpack/*`, `App.tsx`, `services/renderer-operation-service.ts` | Operation id creation, progress subscription, provider-segmented FluxPack progress, conflict/manual-download dialogs, cancel affordance and build overlays. |

The redesign migration should reduce `App.tsx` toward app startup, route selection, global bridge/security state, selected build context and top-level composition only.

## Phase 12 cleanup snapshot

Redesign Phase 12 moved these surfaces out of `App.tsx`:

- `features/install/InstallDialog.tsx` owns install modal chrome, FOMOD option UI, install options and virtualized placement details tree.
- `features/settings/SettingsWorkspace.tsx` owns Settings nav and Nexus/language/MO2 transfer panel composition.
- `features/build/BuildPathsInspector.tsx` owns the build path drawer form and native browse affordances.
- `features/library/projectLibraryStats.ts` owns pure project metric formatting for the library home.

`App.tsx` still creates operation ids, owns bridge/facade calls, keeps mutation handlers close to selected project state and passes callbacks into feature components. The cleanup reduced `App.tsx` from roughly 7650 lines to roughly 6630 lines in this phase. The old `operation-loader` CSS animation was removed after Phase 11 replaced it with design-system `FacetSpinner` and `ProgressBar` primitives.

Phase 12 checks confirmed active Electron/C# product routes are absent from renderer code. Remaining WPF/Electron references are historical migration or agent-rule documentation, and raw Tauri `invoke` remains isolated in `frontend-tauri/src/tauri/fluxora-api.ts`.

## Target renderer folders

The target structure for the redesign phases is:

```text
frontend-tauri/src/renderer/
  App.tsx
  styles.css
  design-system/
    tokens/
    primitives/
    icons/
  components/
    chrome/
  features/
    library/
    build/
    mods/
    plugins/
    downloads/
    install/
    settings/
    operations/
  services/
```

`styles.css` remains the public CSS entrypoint for global styles, semantic aliases and token compatibility during the redesign. If a future phase moves token implementation into `design-system/tokens/`, that phase must update `docs/tauri-migration/tauri-design-system.md` in the same change and keep `styles.css` as the import/compatibility boundary unless explicitly replaced there.

## Module boundaries

| Module | Owns | May call | Must not own |
| --- | --- | --- | --- |
| `design-system/` | Pure typed primitives, token imports, icon wrapper and accessibility defaults. | No bridge calls. | Project/mod/download/install business rules, raw Tauri invoke, filesystem or shell behavior. |
| `components/chrome/` | Titlebar, window controls, app chrome visual composition and `data-tauri-drag-region`. | `window.fluxora.windowControls.*` only for chrome actions. | Domain state, bridge host lifecycle or C++ behavior. |
| `features/library/` | Home/library route, project rows, create wizard UI state and catalog hooks. | `window.fluxora.projects.*`, `window.fluxora.templates.*`, dialogs/shell through facade. | Project filesystem rules or template resolution logic beyond display/orchestration. |
| `features/build/` | Build detail shell, header actions, build path drawer, executable picker affordances and FluxPack UI state. | `buildPaths`, `executables`, `fluxPack`, dialogs and operation overlay helpers through facade/services. | FluxPack recipe rules, executable launch rules or path persistence logic. |
| `features/mods/` | Mods pane, mod rows, grouping, search, local selection, file-tree display and virtual list state. | `window.fluxora.mods.*`, shared `createVirtualWindow`. | Mod installation, load-order persistence, filesystem mutation or conflict truth. |
| `features/plugins/` | Plugins tab/pane, load-order rows, selected-plugin detail and capability messages. | `window.fluxora.plugins.*`, selected build capability data. | Plugin detection, master validation or load-order mutation rules. |
| `features/downloads/` | Downloads tab/pane, import/NXM affordances, row menu, double-click install entry and selected-download detail. | `window.fluxora.downloads.*`, `window.fluxora.nxm.*`, dialogs and shell helpers. | Download transfer, NXM capture/import rules, archive validation or filesystem mutation. |
| `features/install/` | Simple install dialog, FOMOD wizard, placement override UI and details tree. | `downloads.analyze*`, `downloads.install*`, `archives.install*`, mods refresh through facade. | Archive extraction, FOMOD evaluation inputs, replace/merge filesystem rules or path validation. |
| `features/settings/` | Settings nav, language/Nexus/MO2 transfer panels and settings-window composition. | `settings`, `nexus`, `transfer`, `operations`, `windowControls` through facade. | Token storage, OAuth secrets, MO2 import rules or operation cancellation mechanics in C++. |
| `features/operations/` | Shared operation overlay components, progress subscription hooks and user-safe status/error copy. | `window.fluxora.operations.*`, shared operation-id helpers. | Domain-specific progress generation, core logs or crash handling. |
| `services/` | Renderer-only shared helpers that are genuinely cross-feature. | Facade calls only when the service is explicitly an orchestration boundary. | Catch-all managers or broad domain services. |

## State and service placement

Keep these shared for now:

- `services/renderer-operation-service.ts` because operation id creation is cross-feature.
- `services/path-display-service.ts` because it is display-only formatting.
- `ui-performance.ts` because virtual-window bounds are shared by mods, plugins, downloads and install details.

Move closer to features in later refactor phases:

- `project-catalog-state.ts` and `services/project-catalog-service.ts` -> `features/library/`.
- `build-workspace-state.ts` -> `features/build/`.
- `mod-workspace-state.ts` -> `features/mods/`.
- `plugin-workspace-state.ts` -> `features/plugins/`.
- `download-workspace-state.ts` -> `features/downloads/`.
- `install-workspace-state.ts` -> `features/install/`.
- `profiles-executables-workspace-state.ts` -> `features/build/` or `features/settings/` only if the final UI keeps profiles/executables as build-scoped controls; otherwise use a small dedicated subfolder under `features/build/`.
- `settings-workspace-state.ts`, `TransferSettingsPanel.tsx`, `TransferMo2Page.tsx` and `mo2-transfer-request.ts` -> `features/settings/`.

Do not create a new master store. Feature hooks may compose typed facade calls and view state, but C++ remains the owner of project, mod, plugin, download, install, profile, executable, FluxPack, Nexus, transfer and filesystem behavior.

## Facade and operation rules

- Renderer code must call native behavior through `window.fluxora`.
- Raw Tauri `invoke`, `listen`, shell, dialog and filesystem access stay isolated in `frontend-tauri/src/tauri/fluxora-api.ts`.
- The current scoped check shows renderer files use `window.fluxora`; `@tauri-apps/api/*` and raw `invoke` appear only in the Tauri facade layer.
- User-triggered mutations must create or propagate an `operationId` using existing renderer operation helpers or equivalent feature-local wrappers.
- Feature modules may show capability-driven disabled/limited states from `NativeBridgeStatus`; they must not invent platform/domain support from OS strings.
- Logs remain split: Tauri UI, Tauri main/bridge, native core, operations and crash logs.

## Electron-to-Tauri mapping

| Redesign/Electron concept | Tauri implementation |
| --- | --- |
| Caption buttons | `window.fluxora.windowControls.minimize/toggleMaximize/close/openSettings`. |
| Drag region | `data-tauri-drag-region` on chrome drag surfaces. |
| External URL open | `window.fluxora.links.openExternal`. |
| Open path / show in folder | `window.fluxora.shell.openPath` and `window.fluxora.shell.showItemInFolder`. |
| Native file/folder dialogs | `window.fluxora.dialogs.*`. |
| Main-process UI state | Rust shell only for app lifecycle, windows, dialogs, external links, shell-open, single-instance/deep-link and bridge-host lifecycle. |
| Domain/main-process state | C++ core through `fluxora.bridge.v1`, never renderer or Rust shell business logic. |
| NXM and MO2 handoff | Tauri Rust shell/facade activation and handoff events, then bridge/core for domain work. |

Electron source from `C:\Users\Валера\Desktop\Fluxora Redesign` is a visual specification only. No Electron runtime API, C# WPF product path or Node/native renderer access is part of the redesign plan.

## Phase 1 verification

- The plan matches `docs/tauri-migration/architecture.md`: renderer owns UI state and orchestration only; C++ core owns domain/filesystem behavior; Rust shell stays a thin safe shell.
- The plan keeps `frontend-tauri/src/renderer/styles.css` as the public token/global-style entrypoint until a future documented replacement.
- The plan preserves the existing typed `window.fluxora` facade and the raw-invoke boundary in `src/tauri/fluxora-api.ts`.
- The plan contains no Electron or C# implementation path.
- No product behavior changed in this phase.
