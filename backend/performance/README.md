# Fluxora performance suite

This opt-in suite exercises the production C++ core through `FluxoraBridgeHost`.
It is intentionally separate from correctness CI: timings are reported as JSON
and are never compared with absolute machine-dependent thresholds.

## What it measures

- metadata-cold native open RPC flow (`instance.db` absent; OS cache explicitly uncontrolled),
- process-cold native open RPC flow with persisted metadata,
- repeated native open RPC flow in one warm bridge process,
- exact file-index and plugin reconciliation reported separately as T4 background work,
- executable preparation plus `DetourCreateProcessWithDllExW`,
- process creation to the first statement in a small x64 probe,
- process creation to descriptor/overlay validation inside that probe,
- request start to a probe-validated VFS read.

The native open flow uses the same production methods as the renderer:
`projects.openConfig`, `mods.getPersistedWorkspace`, `plugins.listPersisted`,
`profiles.list`, and `executables.list`. If persisted installed/order rows are
empty, exact `mods.getWorkspace` runs once as a metadata-cold fallback inside
`nativeOpenRpcTotalMs`. The deferred sequence then runs `downloads.list`, skips duplicate exact mods when that
fallback already ran, and finishes with exact `plugins.list`.

Result schema 5 records persisted plugin RPC time as `pluginsMs` and
exact discovery time as `exactPluginsMs`. `backgroundTotalMs` is the sum of
`downloadsMs`, exact-mod `reconciliationMs`, and `exactPluginsMs`; the summary
uses `plugins` and `exactPlugins` respectively. `pluginCount` is the persisted
row count and `exactPluginCount` is the post-reconciliation discovery count.
`persistedInstalledCount` and `persistedOrderCount` preserve the raw snapshot
shape; `installedCount` and `orderCount` describe the interactive rows after
any fallback. `interactiveFallbackMs` is included in `nativeOpenRpcTotalMs`, while
`reconciliationMs` is zero when the fallback already performed exact mods.

The launch probe verifies that the highest-priority enabled mod wins for a
deterministic sentinel path. It publishes a JSON marker atomically and exits
cleanly. The harness also checks that launch descriptors are unique and that
the bridge process does not mutate its own `FLUXORA_VFS_CONFIG` environment.

## Build

```powershell
cmake -S backend -B build/backend-perf -A x64 `
  -DFLUXORA_ENABLE_VFS=ON `
  -DFLUXORA_BUILD_TESTS=ON `
  -DFLUXORA_BUILD_BENCHMARKS=ON

cmake --build build/backend-perf --config Release `
  --target FluxoraPerformanceTools -- /m:1

ctest --test-dir build/backend-perf -C Release `
  -R "^FluxoraPerformance.*Smoke$" --output-on-failure
```

## Representative run

```powershell
pwsh -NoProfile -File backend/performance/Run-FluxoraPerformance.ps1 `
  -HostPath build/backend-perf/Release/FluxoraBridgeHost.exe `
  -FixtureBuilderPath build/backend-perf/performance/Release/FluxoraSyntheticModlistFixture.exe `
  -ProbePath build/backend-perf/performance/Release/FluxoraLaunchProbe.exe `
  -ResultPath benchmarks/results/final-release.json `
  -WorkRoot benchmarks/work `
  -ModCounts '610,1500,3000' `
  -FilesPerMod 96 `
  -DirectoriesPerMod 20 `
  -PluginCount 350 `
  -Runs 5 `
  -Warmups 1 `
  -ColdRuns 1
```

## Importing a real modlist shape safely

Capture only aggregate structure outside the source modlist directory:

```powershell
pwsh -NoProfile -File backend/performance/Capture-FluxoraModlistStructure.ps1 `
  -ProjectDirectory 'E:\My Fluxora Build' `
  -BuildConfigPath 'C:\Users\me\AppData\Roaming\Fluxora\Builds\My Build.json' `
  -OutputPath benchmarks/results/private-structure.json
```

The document contains counts/distributions only: no source paths, mod/profile/
file names, raw extensions, contents, or private-name hashes. Feed it back to
the production-path harness with `-StructuralStatisticsPath`; explicit harness
shape switches still override imported defaults. Do not commit even aggregate
real-workload statistics unless their owner has approved publication.

`benchmarks/work/` is ignored. The generator will replace an existing fixture
only when both the exact `.fluxora-perf-owner` token and the structured
`.fluxora-perf-fixture.json` generator/schema signature prove that the directory
belongs to the suite. It refuses to delete malformed, foreign, unmarked, or
filesystem-root directories.

The harness holds an exclusive `.fluxora-performance.lock` under the resolved
WorkRoot from before binary validation/fixture setup through result writing. A
concurrent run using the same explicit or default WorkRoot fails
clearly instead of deleting or mixing the other run's fixture.

The deterministic seed is `0xF10C0A`. The generator models loose files,
directory depth and directories-per-mod, groups of four conflicting mods, enabled/disabled state,
valid Bethesda plugin headers, profile files, executable configuration, and a
VFS overlay sentinel. All shape parameters are recorded with raw samples,
median, nearest-rank p95, min, and max in the result JSON.

Pass multiple sizes as one quoted comma-separated value. The harness parses
each token with invariant integer rules and rejects values outside 1–100000;
this avoids native `pwsh -File` treating commas as thousands separators while
binding an integer-array parameter.

The harness refuses more than 2,000,000 modeled files by default, before it
replaces or generates a fixture. `-AllowLargeFixture` is an explicit escape
hatch for a deliberately provisioned stress experiment.

## Interpretation

Fixture generation time is excluded. `metadataCold` means only that Fluxora's
SQLite metadata is absent; writing the fixture can warm the operating-system
file cache. Do not label it a storage-cold result. `nativeOpenRpcTotalMs` is a
sum of BridgeHost request elapsed times: it does not install the Tauri watcher,
schedule renderer work, commit React, or wait for the next interactive frame,
so it is not a UI T0-to-T3 measurement. It excludes downloads and deferred
reconciliation, but includes the exact-mod fallback used for an empty persisted
snapshot. Use `interactiveFallback`
and `backgroundTotal` together with `reconciliation` and `exactPlugins` when
evaluating the split. Likewise, the
launch probe separates Fluxora/Detours overhead from a real game's own startup time.

Never commit fixture contents or third-party mod data. Only aggregate workload
shape, harness source, and selected JSON result files belong in the repository.
