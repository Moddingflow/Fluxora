# Fluxora Tauri performance budget

Дата обновления: 2026-07-18

Статус: Phase 13 budget and automated smoke gates are in place. After Phase 17, WPF baseline capture is historical/superseded; ongoing acceptance uses Tauri screenshots, performance budgets and release smoke evidence.

## Goals

Fluxora must not feel like a heavy Tauri wrapper. Renderer work stays visual and orchestration-only, C++ owns domain and filesystem behavior, Tauri Rust shell/facade own safe async command, and large renderer surfaces must stay bounded.

## Budgets

| Scenario | Budget | Gate |
| --- | --- | --- |
| Startup shell visible | Home heading and bridge/runtime state visible after app launch | Playwright startup smoke |
| Renderer Node exposure | `window.process` and `window.require` are unavailable | Playwright startup smoke |
| command model | no synchronous native calls, renderer uses typed facade API, Tauri shell uses allowlisted async command handlers | code review plus `rg` check |
| Search typing | input updates immediately while heavy result rendering can lag | React `useDeferredValue` for project/templates/mods/plugins/downloads/profiles/executables searches |
| Mods/plugins/downloads list DOM | render visible rows plus overscan, not the full collection | `createVirtualWindow` unit tests and App usage |
| Archive placement tree DOM | render visible rows plus overscan, not the full placement preview | `createVirtualWindow` usage in install details |
| Mod file tree | load directories incrementally and avoid rendering unopened children | existing lazy `mods.getFileTree` directory loading |
| Text editor startup | Dedicated secondary-window entrypoint must render independently from generic bridge/Nexus/catalog startup; Monaco and the initial file read start in parallel; editor file/tree reads must not queue behind background workspace work | delayed-startup Playwright smoke, lazy `TextEditorWindow`/`MonacoEditorSurface` chunks, interactive bridge-lane routing test and production bundle review |
| Text editor document lifecycle | preserve per-tab undo/view state without retaining closed models; no recursive disk search in renderer | Monaco model disposal, open-document search unit tests and Playwright editor smoke |
| Effective Data tree | load visible root/child pages through bounded lazy bridge calls; full index warmup is explicit and not part of build open | `mods.getEffectiveFileTreeRoot` plus `mods.getEffectiveFileTreeChildren` |
| Mod details conflicts | load indexed conflict pages, not recursive renderer directory fanout | `mods.getModConflictTree` |
| Row paint cost | stable row heights, `content-visibility`, no layout-shifting hover states | CSS system rules |
| Motion | transform/opacity-oriented micro-interactions, reduced motion fallback | CSS system rules |
| Long-running operations | progress/status overlay, async bridge calls, renderer remains interactive | existing operation overlays plus smoke tests |
| Bridge queue isolation | Download lock remains available while Install and Main are occupied; a timeout/restart affects only its selected host | exhaustive Rust method-routing, lock-isolation, restart-isolation and all-lane lifecycle tests |
| NXM intake during install | pending row visible `<= 500 ms` on a warmed active project even while install metadata finalization is running | metadata-lock gate GTest plus concurrent install/NXM Playwright smoke |
| Nexus resolved filename | real file name within one Nexus file-info round trip plus at most one `500 ms` renderer poll | pre-transfer-permit GTest, download-state Vitest and concurrent Playwright smoke |
| Cached conflict summary | exact counts and directed relations in `<= 500 ms` after fixture/cache preparation at the current 10k-conflict scale | covering-index SQLite GTest with bounded SQL prepare count |
| Install metadata finalization | commit-side metadata finalization `<= 2 s` at the current production scale | correlated `InstallFinalization durationMs` operation log and install integration tests |
| NIF preview geometry | first neutral geometry frame `< 1 s` cold / `< 500 ms` warm | Playwright progressive-preview smoke plus `NifPreview.Performance firstFrame` log |
| NIF preview textures | all resolvable textures applied `< 3 s` cold / `< 1.5 s` warm | batched resolver/cache tests plus `texturesReady` log |
| NIF preview main-thread slice | no preview task longer than 50 ms | worker parsing/BC fallback, transferable typed arrays and 8 ms geometry construction yields |
| NIF preview transfer | no Base64 model/texture payloads; raw IPC is bounded to 64 MiB per asset and 256 MiB per session | facade/Rust contract tests and raw-read logs |

## Implementation notes

- `frontend-tauri/src/renderer/ui-performance.ts` is the shared renderer helper for virtual windows.
- `frontend-tauri/tests/ui-performance.test.ts` verifies overscan math, stale scroll clamping and empty-list behavior.
- `App.tsx` uses React `useDeferredValue`, matching current React guidance for keeping input responsive while expensive list rendering updates in the background.
- `App.tsx` keeps mods/plugins/downloads/search state local to renderer. It does not move project/mod/install decisions out of C++.
- `styles.css` defines focus, reduced-motion, row containment and shared component tokens.
- `mod_conflicts(mod_id, relative_path COLLATE NOCASE, source)` is the covering
  index for the cached conflict-summary query. Correlated operation logs report
  `ConflictSummary`, `NxmIntake`, `NxmPreflight` and `InstallFinalization`
  durations with counts only; those new entries do not include URLs or absolute
  paths.
- Tauri main records `bridgeQueue lane=main|interactive|background|download|install method=... queueWaitUs=...` for every request. `lane=download` and `lane=install` are separate lazy host processes; a high wait in one lane must not appear as a wait in the other.
- The text editor is routed by `main.tsx` into a dedicated secondary-window chunk, receives the known project directory directly from the typed window contract, and preloads Monaco in parallel with the first file read. It does not execute the main `App.tsx` bridge/Nexus/catalog startup, reuses lazy mod directory reads and disposes models when tabs close. Search is intentionally bounded to open in-memory documents until a native indexed-search contract exists.
- NIF preview C++ tests cover a ten-texture batch, priority resolution, cold/warm archive index and extracted-asset cache hits, fingerprint invalidation and 512 MiB LRU behavior.
- NIF preview renderer tests cover a large typed-array model fixture, transferable worker messages, BC1-BC7 extension routing, BC1-BC5 software fallback, a full-mip 4K BC3 fixture, compressed GPU upload, raw/texture LRU limits and opaque facade DTOs.
- The Playwright progressive smoke delays texture and variant bytes, verifies neutral geometry reaches `ready` before texture completion, keeps the old canvas visible during variant replacement, and preserves the model for missing/corrupt textures.
- The Playwright performance probe records cold and warm `firstFrame`/`texturesReady` durations, samples peak JS heap, asserts one start call, one deduplicated texture batch and two raw reads per synthetic run, verifies one session `operationId`, and rejects any `contentBase64` evidence.

## Profiling checklist

Before closing final parity:

- Startup: measure time from process launch to Home shell visible.
- Project open: measure time from selecting a build to workspace route ready.
- List scroll: test 5k mods, 5k plugins and 5k downloads with smooth wheel/trackpad scrolling.
- Search: test fast typing against large mods/plugins/downloads lists.
- File tree: test a mod with deep nested directories and lazy expansion.
- Text editor: delay generic Nexus/catalog startup and verify the editor still becomes interactive, verify the Monaco chunk does not enter the main startup path, switch repeatedly across large documents, repeat save/EOF word deletion, close tabs and confirm model memory is reclaimed.
- Archive details: test a large archive preview with manual placement details open.
- FOMOD wizard: test a large multi-step installer with previous selections.
- Long operations: verify progress events do not freeze titlebar, navigation or cancel affordances.
- NIF preview: record cold and warm `firstFrame`, `nifParse`, `ddsPrepare` and `texturesReady` entries for representative loose, BSA and BA2 assets; investigate any renderer long task over 50 ms.

## Known evidence gap

Phase 13 added the Tauri-side budget, implementation guardrails and automated smoke. After Phase 17 removal, final acceptance should compare Tauri results against the budgets below, release smoke evidence and any archived historical WPF reference that already exists.
