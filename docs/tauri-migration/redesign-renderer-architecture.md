# Fluxora redesign renderer architecture

Дата решения: 2026-06-25; NIF preview worker update: 2026-07-13

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
| Library/home/catalog | `features/library/LibraryHome.tsx`, `features/library/CreateBuildWizard.tsx`, `features/library/useCreateBuildWizard.ts`, `features/library/projectLibraryStats.ts`, `App.tsx`, `project-catalog-state.ts`, `services/project-catalog-service.ts` | Project list/search, create/open/rename/delete, explicit game/executable selection, create-wizard view orchestration, visible FluxPack install entry, catalog loading and compact project metrics. |
| Build workspace | `App.tsx`, `features/build/BuildDetailHeader.tsx`, `features/build/BuildPathsInspector.tsx`, `features/fluxpack/*`, `build-workspace-state.ts` | Build header actions, build path drawer, FluxPack inspect/plan/conflict/manual-download orchestration and summary state. |
| Mods table/tree | `features/mods/ModsListSurface.tsx`, `features/mods/ModRow.tsx`, `features/mods/use-pending-install-orchestrator.ts`, `features/mods/install-progress-store.ts`, `features/lists/order-row-view-index.ts`, `components/virtualization/AdaptiveVirtualList.tsx`, `App.tsx` | Memoized list/row presentation, keyed install progress, O(1) row-view lookup, adaptive virtual windowing, file tree expansion and delta orchestration. |
| Text/code editor | `main.tsx`, `features/text-editor/TextEditorWindow.tsx`, `features/text-editor/*` | Lightweight secondary-window bootstrap, Monaco lifecycle, document tabs/view state, Explorer/search/Problems/palette/status UI and guarded save orchestration over typed facade calls. The editor does not execute generic `App.tsx` startup. |
| NIF file preview | `features/file-preview/FilePreviewWorkspace.tsx`, worker client/protocol/codec, DDS texture service and bounded resource cache | Opaque session orchestration, neutral geometry first, progressive texture application, WebGL resource disposal. |
| Plugins/load order | `features/plugins/PluginsListSurface.tsx`, `features/plugins/PluginRow.tsx`, `features/lists/order-row-view-index.ts`, `components/virtualization/AdaptiveVirtualList.tsx`, `App.tsx` | Memoized list/row presentation, O(1) row-view lookup, adaptive virtual windowing, selected-plugin details, delta orchestration and capability state. |
| Downloads/install entry | `App.tsx`, `download-workspace-state.ts` | Download list/search, row context menu, import/archive/NXM actions and selected-download details. |
| Install/FOMOD/details | `features/install/InstallDialog.tsx`, `App.tsx`, `install-workspace-state.ts` | Dialog state, analyze/install flow, FOMOD selections, placement overrides and virtualized details tree. |
| Profiles/executables | `App.tsx`, `profiles-executables-workspace-state.ts` | Profile CRUD, executable list/edit/icon/launch state and capability display. |
| Settings/transfer | `features/settings/SettingsWorkspace.tsx`, `App.tsx`, `settings-workspace-state.ts`, `TransferSettingsPanel.tsx`, `TransferMo2Page.tsx`, `mo2-transfer-request.ts` | Settings nav, Nexus/language/transfer forms, MO2 handoff page and transfer progress/cancel state. |
| Application localization | `localization/app-language-state.ts`, `localization/react.tsx`, `App.tsx`, `features/text-editor/TextEditorWindow.tsx` | Startup language gate, optimistic renderer locale, rollback state and typed cross-window locale-event consumption. Native settings remain the persistence authority. |
| Operation overlays/dialogs | `features/operations/OperationOverlay.tsx`, `features/fluxpack/*`, `App.tsx`, `services/renderer-operation-service.ts` | Operation id creation, progress subscription, provider-segmented FluxPack progress, conflict/manual-download dialogs, cancel affordance and build overlays. |

The redesign migration should reduce `App.tsx` toward app startup, route selection, global bridge/security state, selected build context and top-level composition only.

## Phase 12 cleanup snapshot

Redesign Phase 12 moved these surfaces out of `App.tsx`:

- `features/install/InstallDialog.tsx` owns install modal chrome, FOMOD option UI, install options and virtualized placement details tree.
- `features/settings/SettingsWorkspace.tsx` owns Settings nav and Nexus/language/MO2 transfer panel composition.
- `features/build/BuildPathsInspector.tsx` owns the build path drawer form and native browse affordances.
- `features/library/projectLibraryStats.ts` owns pure project metric formatting for the library home.
- `features/library/CreateBuildWizard.tsx` owns bounded Create Build form rendering and keyboard interaction; `features/library/useCreateBuildWizard.ts` owns step reachability, dialog orchestration, validation messages and directory-preview state.

`App.tsx` still creates operation ids, owns bridge/facade calls, keeps mutation handlers close to selected project state and passes callbacks into feature components. The cleanup reduced `App.tsx` from roughly 7650 lines to roughly 6630 lines in this phase. The old `operation-loader` CSS animation was removed after Phase 11 replaced it with design-system `FacetSpinner` and `ProgressBar` primitives.

Phase 12 checks confirmed active Electron/C# product routes are absent from renderer code. Remaining WPF/Electron references are historical migration or agent-rule documentation, and raw Tauri `invoke` remains isolated in `frontend-tauri/src/tauri/fluxora-api.ts`.

## List isolation and refresh-adaptive reconciliation

- `ModsListSurface` and `PluginsListSurface` are explicit `memo` boundaries below the root composition. Their rows are separately memoized with semantic presentation keys, so unrelated download/install state does not invalidate either subtree.
- Install phase text is ephemeral state in a keyed external store consumed with `useSyncExternalStore`. A progress event publishes only the affected operation key; authoritative mod/plugin arrays are not mapped merely to update one pending label.
- `order-row-view-index.ts` builds one immutable view index per authoritative revision/selection/collapse context. Render callbacks perform `orderId` map lookups only. Flat delta updates preserve prior view objects for unchanged rows, including native DTO clones and the pending-to-installed row replacement.
- `workspace-delta-state.ts` applies validated revision/sequence deltas with structural sharing. Bulk publication uses `startTransition`; exactly one retained full fallback is scheduled only for stale/gapped history and waits until both lists are idle.
- `AdaptiveVirtualList` owns urgent scroll state locally, samples recent valid rAF intervals without a high-refresh clamp, derives bounded viewport-relative directional overscan from cadence and velocity, and exposes active/ended state via native `scrollend` plus a cadence-derived fallback. Browser-native overflow, wheel physics and `scrollTop` remain untouched.
- `list-performance-benchmark.ts` is enabled only by an explicit test/development flag. It emits one aggregate with frame cadence, scroll-to-frame latency, long tasks, bounded rendered rows, bridge full/delta counts, root/row commit isolation and measured derivation stages. It adds no production telemetry or per-frame logging.

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
    text-editor/
    file-preview/
  services/
```

`styles.css` remains the public CSS entrypoint for global styles, semantic aliases and token compatibility during the redesign. If a future phase moves token implementation into `design-system/tokens/`, that phase must update `docs/tauri-migration/tauri-design-system.md` in the same change and keep `styles.css` as the import/compatibility boundary unless explicitly replaced there.

## Module boundaries

| Module | Owns | May call | Must not own |
| --- | --- | --- | --- |
| `design-system/` | Pure typed primitives, token imports, icon wrapper, shared `WizardStepper`, local asset exports and accessibility defaults. | No bridge calls. | Project/mod/download/install business rules, raw Tauri invoke, filesystem or shell behavior. |
| `components/chrome/` | Titlebar, window controls, app chrome visual composition and `data-tauri-drag-region`. | `window.fluxora.windowControls.*` only for chrome actions. | Domain state, bridge host lifecycle or C++ behavior. |
| `features/library/` | Home/library route, project rows, create wizard UI state and catalog hooks. | `window.fluxora.projects.*`, `window.fluxora.templates.*`, dialogs/shell through facade. | Project filesystem rules or template resolution logic beyond display/orchestration. |
| `features/text-editor/` | Workbench composition, Monaco models/view state, open-document search, language labels, command/menu UI and unsaved-change guards. | Typed `window.fluxora.mods`, `window.fluxora.textFiles` and native dialog facade methods. | Raw filesystem access, shell processes, workspace indexing, compiler/LSP ownership or domain save rules. |
| `features/build/` | Build detail shell, header actions, build path drawer, executable picker affordances and FluxPack UI state. | `buildPaths`, `executables`, `fluxPack`, dialogs and operation overlay helpers through facade/services. | FluxPack recipe rules, executable launch rules or path persistence logic. |
| `features/mods/` | Memoized Mods surface/rows, grouping, search, local selection, keyed pending-install presentation, file-tree display and virtual list state. | `window.fluxora.mods.*`, `window.fluxora.workspace.*`, shared adaptive virtualizer. | Mod installation, load-order persistence, filesystem mutation or conflict truth. |
| `features/plugins/` | Memoized Plugins surface/rows, load-order presentation, selected-plugin detail and capability messages. | `window.fluxora.plugins.*`, `window.fluxora.workspace.*`, shared adaptive virtualizer. | Plugin detection, master validation or load-order mutation rules. |
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
| Copy raw file path | `window.fluxora.clipboard.writeText`; Rust owns the clipboard plugin and renderer passes the exact unquoted path. |
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
