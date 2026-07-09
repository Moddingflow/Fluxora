# Fluxora Tauri performance budget

Дата обновления: 2026-06-24

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
| Effective Data tree | load visible root/child pages through bounded lazy bridge calls; full index warmup is explicit and not part of build open | `mods.getEffectiveFileTreeRoot` plus `mods.getEffectiveFileTreeChildren` |
| Mod details conflicts | load indexed conflict pages, not recursive renderer directory fanout | `mods.getModConflictTree` |
| Row paint cost | stable row heights, `content-visibility`, no layout-shifting hover states | CSS system rules |
| Motion | transform/opacity-oriented micro-interactions, reduced motion fallback | CSS system rules |
| Long-running operations | progress/status overlay, async bridge calls, renderer remains interactive | existing operation overlays plus smoke tests |

## Implementation notes

- `frontend-tauri/src/renderer/ui-performance.ts` is the shared renderer helper for virtual windows.
- `frontend-tauri/tests/ui-performance.test.ts` verifies overscan math, stale scroll clamping and empty-list behavior.
- `App.tsx` uses React `useDeferredValue`, matching current React guidance for keeping input responsive while expensive list rendering updates in the background.
- `App.tsx` keeps mods/plugins/downloads/search state local to renderer. It does not move project/mod/install decisions out of C++.
- `styles.css` defines focus, reduced-motion, row containment and shared component tokens.

## Profiling checklist

Before closing final parity:

- Startup: measure time from process launch to Home shell visible.
- Project open: measure time from selecting a build to workspace route ready.
- List scroll: test 5k mods, 5k plugins and 5k downloads with smooth wheel/trackpad scrolling.
- Search: test fast typing against large mods/plugins/downloads lists.
- File tree: test a mod with deep nested directories and lazy expansion.
- Archive details: test a large archive preview with manual placement details open.
- FOMOD wizard: test a large multi-step installer with previous selections.
- Long operations: verify progress events do not freeze titlebar, navigation or cancel affordances.

## Known evidence gap

Phase 13 added the Tauri-side budget, implementation guardrails and automated smoke. After Phase 17 removal, final acceptance should compare Tauri results against the budgets below, release smoke evidence and any archived historical WPF reference that already exists.
