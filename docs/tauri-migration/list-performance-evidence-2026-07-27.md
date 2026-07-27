# Mod/plugin list performance evidence — 2026-07-27

## Pre-change Foundation Edition baseline

The baseline used the existing release binary from
`frontend-tauri/src-tauri/target/release/Fluxora.exe` built at
`2026-07-27 09:45:26`, before the list-performance changes in this worktree.
The real `E:\Fluxora Builds\Foundation Edition` workspace reported 621 mods
(678 visible order rows) and 365 enabled plugins. The WebView was attached
through local CDP with background throttling disabled so the hidden benchmark
window continued to sample the active display cadence.

The benchmark continuously issued read-only native stress calls while native
wheel events scrolled each list:

- `mods.getWorkspace` and `plugins.list` every 1.2 seconds;
- `downloads.list` every 500 ms;
- rAF interval, scroll-to-next-frame latency, long tasks, rendered-row count,
  virtual-window mutations and bridge-call counts were recorded in the WebView;
- operation ids used the `baseline_full_*`, `baseline_plugins_*` and
  `baseline_downloads_*` prefixes for correlation with the separated bridge and
  operation logs.

The active-display median interval was `6.9–7.0 ms`, corresponding to the
available 143/144 Hz display.

| Run | Surface | F (ms) | p95 frame (ms) | p99 frame (ms) | Max frame (ms) | Gaps >= 3F | Long tasks | Max long task (ms) | Rendered rows | Full mods/plugins calls | Download list calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Mods | 7.0 | 90.3 | 111.0 | 125.0 | 79 | 78 | 105 | 40–62 | 6 / 6 | 20 |
| 2 | Mods | 7.0 | 104.2 | 111.2 | 118.0 | 81 | 81 | 105 | 40–60 | 4 / 4 | 21 |
| 3 | Mods | 7.0 | 90.3 | 104.2 | 132.0 | 81 | 80 | 114 | 40–77 | 6 / 6 | 20 |
| 1 | Plugins | 6.9 | 7.1 | 34.8 | 208.4 | 10 | 1 | 158 | 27–80 | 4 / 4 | 10 |
| 2 | Plugins | 6.9 | 7.1 | 14.0 | 132.0 | 5 | 1 | 132 | 27–85 | 2 / 2 | 9 |
| 3 | Plugins | 6.9 | 7.1 | 13.9 | 14.0 | 0 | 0 | 0 | 27–80 | 3 / 3 | 9 |

All three Mods runs fail the acceptance thresholds (`p95 <= 1.5F`,
`p99 <= 2F`, no renderer/IPC gap `>= 3F`). Plugin runs also fail the strict
all-runs contract because the first two contain renderer/IPC gaps over `3F`.

Correlated native evidence is in the local pre-change logs under
`frontend-tauri/src-tauri/target/release/logs/`:

- `fluxora-operations-20260727.log` records `ConflictSummary` for
  `baseline_full_*` at 621 mods, with observed durations from 352 ms through
  1052 ms during the benchmark;
- the same log records the repeated `baseline_plugins_*` `PluginDiagnostics`
  reads for profile `Foundation Edition`;
- `fluxora-tauri-main-bridge-current.log` carries the matching request and lane
  timing envelope.

This baseline intentionally made no workspace mutation and added no production
telemetry or upload.

## Post-change 5,000 + 5,000 automated acceptance

The post-change scenario uses a production Vite bundle and Chromium at its
measured approximately 60 Hz cadence. It loads 5,000 mods and 5,000 plugins,
keeps both virtualized lists moving with real Playwright wheel input, publishes
eight keyed install-progress updates, publishes a download update, applies the
terminal install workspace delta and then applies a watcher delta.

Each run records exactly one aggregate from
`window.__fluxoraListPerformance`, including frame cadence, long tasks,
rendered-row bounds, React commits, bridge-call classes and update-scoped row
commits. The acceptance test is
`keeps 5k Mods and Plugins frame-paced while keyed install, download, and
watcher deltas arrive` in `frontend-tauri/e2e/library-home.spec.ts`.

| Run | F (ms) | p95 frame (ms) | p99 frame (ms) | Max frame (ms) | Gaps >= 3F | Long tasks | Max rendered Mods / Plugins | Full snapshots Mods / Plugins / Downloads | Workspace / download deltas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 16.7 | 16.7 | 16.8 | 33.3 | 0 | 0 | 36 / 35 | 0 / 0 / 0 | 1 / 1 |
| 2 | 16.7 | 16.7 | 16.8 | 16.8 | 0 | 0 | 36 / 35 | 0 / 0 / 0 | 1 / 1 |
| 3 | 16.7 | 16.7 | 16.8 | 33.3 | 0 | 0 | 36 / 35 | 0 / 0 / 0 | 1 / 1 |

All three runs pass `p95 <= 1.5F`, `p99 <= 2F`, zero gaps at or above `3F`
and zero long tasks. The maximum rendered row count remains bounded far below
the 5,000-item datasets.

The update-scoped evidence is also green in every run:

- every install-progress update commits at most its one keyed mod row and
  commits neither list surface;
- the download update commits no mod/plugin surface or row;
- terminal-install and watcher deltas commit each affected surface at most once
  and each affected row at most once;
- the terminal install replaces the pending identity without dropping or
  duplicating its row;
- the healthy stream performs no `mods.getWorkspace`, `plugins.list` or
  `downloads.list` full snapshot;
- workspace-delta apply took at most 3.6 ms in these runs. The fast semantic
  row-index path reuses unchanged row views for native DTO clones and limits
  new derivation to changed rows.

## React Profiler evidence

Normal production React intentionally makes `<Profiler>` timing callbacks a
no-op. For automated render-duration evidence only, Vite supports an opt-in
`FLUXORA_LIST_PROFILING=1` bundle that aliases `react-dom/client` to
`react-dom/profiling`. The ordinary Release build does not set this flag and
continues to use standard production React.

The same 5,000 + 5,000 Playwright scenario passed with the profiling bundle,
and the test directly enforces `p99 actualDuration < 0.5F` whenever profiling
commits are present:

| Surface | Profiler commits | p99 actualDuration (ms) | 0.5F budget (ms) | Result |
| --- | ---: | ---: | ---: | --- |
| Mods | 18 | 1.5 | about 8.35 | Pass |
| Plugins | 10 | 2.3 | about 8.35 | Pass |

That profiling run also recorded `p95 = 16.8 ms`, `p99 = 16.8 ms`, no
`>= 3F` gaps, no long tasks, no full snapshots and one workspace plus one
download delta. Unrelated install/download updates still produced zero list
surface renders.

## Coverage and privacy boundary

Focused unit and integration coverage exercises adaptive 60/144/240/360 Hz
cadence sampling, background-pause rejection, native and fallback scroll-end
settling, viewport-relative overscan, keyed progress subscriptions, memoized
row/surface isolation, semantic 5,000-row index reuse, terminal identity
replacement, delta validation/deduplication/fallback/scroll deferral, download
event coalescing, journal replay after restart and stale-revision full resync.

The benchmark aggregate is test-only, remains local to the browser test and is
attached to the local Playwright result. The revision journal stores only local
workspace reconciliation state under `.fluxora`; this change adds no telemetry,
upload, account flow, online service or new transfer of personal data, so the
privacy policy and terms do not require a data-processing update.

## Refresh-rate acceptance and hardware boundary

Refresh support is cadence-independent rather than an allowlist tied to the
available 143/144 Hz display. Production code starts with a conservative frame
duration only until live `requestAnimationFrame` samples arrive, then uses the
rolling median of the measured intervals. Scroll settling and directional
overscan consume that measured duration directly; there are no 144, 240 or
360 Hz production branches or refresh-rate ceiling.

The named 60/144/240/360 Hz unit cases remain useful regression checkpoints.
An additional generated fractional-cadence case exercises the same public
sampler and scroll-settling APIs across non-integer refresh rates from 23.976 Hz
through 1,000 Hz. These values are representative samples of one continuous
calculation, not a supported-frequency table.

The available 143/144 Hz hardware establishes that Fluxora can observe a
high-refresh cadence, but it is not the product's support ceiling. Per-device
physical wheel/trackpad coverage is supplementary rather than the definition
of refresh-rate support. Synthetic 240/360 Hz evidence validates the scheduler
math only, and is not reported as physical 360 Hz testing.
