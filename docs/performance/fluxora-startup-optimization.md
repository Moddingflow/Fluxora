# Fluxora startup optimization log

Last updated: 2026-07-11. Measurements use Windows x64 Release builds without
a debugger and with unchanged security/antivirus settings. Raw timing artifacts
are retained under `benchmarks/results/`; generated fixture contents remain
ignored under `benchmarks/work/`.

## Outcome

When a valid durable snapshot exists, the product-critical modlist-open path no
longer waits for a live mod inventory, full file reconciliation, plugin
discovery, or downloads before it becomes interactive. A durable/profile-state
T3 snapshot is reconciled after interaction, and an active watcher makes that
snapshot safe to reuse. The launch path now uses cached order state, isolated
launch-consistent profile snapshots, isolated immutable descriptors, and a
child-only environment without changing USVFS precedence.

On the real packaged Foundation Edition project, the historical warm reopen was
6.111 s. Four final warm reopens had a 0.349 s median (0.322-0.368 s, nearest-
rank p95 0.368 s): 5.762 s / 94.3% less user-visible latency. A fresh packaged
open improved from the historical 13.149 s record to 0.565 s in the final
five-open sample, but each side has only one fresh-process observation, so that
95.7% delta is supporting evidence rather than the repeatable primary result.

The deterministic Foundation-shape BridgeHost harness confirms the native RPC
reduction across two independent final batches (ten warm and ten process-cold
samples). It does not install the Tauri watcher or measure React's interactive
frame, so these values are a native open-RPC proxy rather than UI T0 -> T3:

| Foundation shape, native open RPC proxy | Before | Final | Saved |
|---|---:|---:|---:|
| metadata-warm, new BridgeHost process | 0.726 s median, 0.724-0.759 s, p95 0.759 s (5) | 0.240 s median, 0.226-0.262 s, p95 0.262 s (10) | 0.486 s / 66.9% |
| same process, warm | 0.560 s median, 0.555-0.583 s, p95 0.583 s (5) | 0.203 s median, 0.197-0.212 s, p95 0.212 s (10) | 0.357 s / 63.8% |
| plugin contribution inside warm T3 | 0.184 s median, 0.182-0.195 s (5) | 0.006 s median, 0.006-0.006 s, p95 0.006 s (10) | 0.178 s / 96.8% |

The before column is schema-3
`2026-07-11-foundation-shape-packaged-confirmation.json`; the final column
combines the raw samples from the two schema-5 final batches. The fixture is
identical: 619 mods, 115 modeled files per mod, 292 modeled plugins, deterministic
seed `0xF10C0A`, and imported aggregate Foundation structure.

## Timing boundaries

### Opening a modlist

- **T0**: `openProjectByConfig` accepts the user action and creates an operation
  id and timing context.
- **T1**: `projects.openConfig` has loaded and activated the project/profile
  configuration.
- **T2**: the project watcher is active and persisted mods/order/plugins plus
  profiles and executables are available. If persisted installed/order rows are
  absent, one exact `mods.getWorkspace` fallback completes here; an empty shell
  is never reported as interactive.
- **T3**: React has committed the populated workspace and the next animation
  frame has begun. Mod/profile/plugin state is usable and executables can be
  launched. This is the primary result.
- **T4**: downloads and exact background reconciliation have completed. Exact
  mods are skipped when the T2 fallback already ran or when the same continuously
  watched project already has a validated exact generation. Exact plugins still
  run to restore full discovery diagnostics.

Downloads are not required for T3 and a downloads failure cannot suppress exact
mod/plugin reconciliation. A failed T4 update preserves the last committed
persisted state. UI `Performance` records, Tauri bridge queue timing, and C++
operation logs share the same operation id.

### Launching an executable

- **T0**: the renderer receives the launch action.
- **T1**: executable/profile validation and stale-grass cleanup are complete.
- **T2**: cached launch order and the VFS mount plan are ready.
- **T3**: the immutable descriptor and explicit Unicode child environment are
  ready and Detours/USVFS process creation begins.
- **T4**: the target process has been created and execution begins.
- **T5**: an external ready signal is observed. The deterministic probe atomically
  publishes a marker after validating the descriptor and overlay.

Core timing separates executable resolution, mount-plan construction, post-mount
preparation, descriptor/environment preparation, process creation, and C API
serialization. The probe separately reports process creation to first `wmain`,
process creation to VFS validation, and request start to validated readiness.

## Baseline and verified root causes

The real Foundation Edition snapshot had 618 installed records, approximately
608 active mods, 364 plugins, 81,938 cached mod-file rows, 70,817 profile-file
rows, and an approximately 89 MB `instance.db`.

Before the accepted changes, one warm-up plus five production BridgeHost runs
gave a 1.692 s native-open median (1.657-1.734 s, p95 1.734 s) for open config,
installed mods, order, plugins, and executables. A separate cold-ish record was
7.356 s of native work. Packaged UI logs recorded 13.149 s for a fresh open and
6.111 s for a reopen; background completion was 26.874 s and 18.991 s.

The ranked causes were:

1. **Self-sustaining watcher work.** In 483.7 s, old logs contained 315
   `mods.listInstalled`, 315 `mods.getOrder`, and 314 `plugins.list` requests.
   They occupied the serialized bridge for 468.551 s, or **96.87%** of the
   interval. `plugins.list` rewrote an identical `plugins.txt`; its atomic
   sidecar generated another watcher event.
2. **Exact work before interaction.** Live plugin discovery and exact mod/file
   reconciliation ran before the primary UI could be used even though durable
   state already existed.
3. **Duplicated inventory and RPC work.** Installed mods and profile order each
   synchronized the same inventory. The old two-mod-RPC slice had a 1.048 s
   median; one aggregate exact request reduced it to 0.650 s, saving 0.398 s /
   38.0%, with identical 618 installed and 676 order rows.
4. **Per-file cold validation.** Full scans performed large volumes of path,
   metadata, and database work. On cache absence the final Foundation-shaped
   exact fallback still costs about 10.005 s median; this is now explicit and
   correct instead of being hidden behind an empty persisted result.
5. **Launch lifecycle risk, not target startup.** Shared mutable descriptors and
   manager-environment mutation threatened overlapping launches. The measured
   Fluxora/USVFS path was already sub-second; it did not explain a roughly
   60-second Skyrim startup.

## Accepted production changes

### Persisted interactive workspace and exact reconciliation

- `mods.getPersistedWorkspace` and `plugins.listPersisted` are DB/profile-state
  reads with zero live inventory/plugin discovery. Profiles and executables are
  loaded concurrently with them.
- `mods.getWorkspace` is the single exact aggregate request. It synchronizes
  inventory once and derives installed/order state from that coherent snapshot.
- Missing persisted installed/order rows trigger one exact fallback inside T3.
  The background stage does not repeat it.
- A successful exact mod reconciliation is associated with the active project,
  profile, roots, accepted watcher generation, and per-project observed and
  invalidated-through revisions. Reopening that same project skips duplicate
  exact mod work only when the live watcher key/generation and both revisions
  still match. Key transitions and watcher events invalidate the fast path; an
  exact read that starts before invalidation settles can never earn coverage,
  and a pending/failed invalidation cannot be legitimized by a later completion
  or unrelated reopen.
- Watcher paths are accumulated case-insensitively per project. Sequence gaps or
  more than 2,048 top-level paths escalate to root invalidation. Work is
  project-scoped, cancellation-safe, and limited to one active plus the latest
  trailing refresh.
- Project scopes are invalidated independently, so a failing stale project
  cannot starve the current one. A failed scope receives three immediate bounded
  attempts, is restored to pending state, and is retried autonomously with
  1/2/4-second exponential backoff capped at 30 seconds. Retry work stops with
  the renderer lifecycle and resumes safely after a StrictMode-style remount.
- Delayed work reads the live selected profile before any state-mutating exact
  request. A profile change cannot be overwritten by the original open's T4,
  delayed invalidation reconciles the currently visible profile, and failed
  watcher replacement retries with bounded backoff. A newly accepted watcher
  is followed by exact mods/plugins reconciliation before coverage is reusable.

Final packaged proof for two consecutive opens under one watcher:

- T3: 326.6 ms then 349.2 ms;
- T4: 7.031 s for the initial exact pass, then 162.5 ms;
- exactly two persisted mod/plugin requests and two exact plugin requests;
- exactly one `mods.getWorkspace` and zero `mods.invalidateFileCaches` feedback
  requests, including after an additional six-second idle interval.

The deterministic harness deliberately performs exact T4 work for every sample
because it does not model the Tauri watcher lifetime. Its ten final warm T4
samples therefore conservatively report 1.344 s median (1.319-1.372 s, p95
1.372 s), including 1.165 s median exact mods and 0.176 s median exact plugins.

### Persistent mod-file cache contract

The implementation in `InstanceMetadataStore` has an explicit correctness
contract:

- SQLite database `user_version` is **6**; the mod-file index schema is **2**.
- Opening a current v6 database reads `user_version`, applies only the three
  per-connection runtime PRAGMAs, and returns before schema DDL or column
  probes. A future version is rejected after one prepare and zero execs; only
  missing/older versions enter migration.
- Cache keys start with `file-index-v2:` and use SHA-256 domain
  `fluxora-mod-file-index-v2`.
- Key material includes the normalized absolute mod path, stable root identity,
  and deterministically sorted entry metadata. NTFS/ReFS enumeration uses file
  identity, size, change/write times, attributes, and kind; filesystems without
  stable identities hash regular-file contents. Timestamps are not the sole
  correctness signal.
- `FILE_ID_EXTD_DIR_INFO` batches Windows directory metadata. Long Windows paths
  are supported.
- Publication of rows and cache state is transactional and occurs only after a
  complete successful scan. A partial/failed scan publishes nothing and is
  retried later.
- The first exact read after a process/project activation validates disk state
  and compares every persisted file row against the collected snapshot. A
  same-count logical row tamper therefore repairs transactionally instead of
  surviving behind a matching key. A same-project reopen under continuous
  watcher coverage reuses the validated generation and avoids that scan.
  Persisted reads never scan mod contents.
- A changed path invalidates only its case-insensitive top-level mod; a mods-root
  event invalidates all mod rows/state/fingerprints. Changes outside the root and
  generated `.flow` state are ignored.
- Missing state or a file-index schema mismatch rebuilds deterministically. A
  database with a future `user_version` is rejected before DDL or version
  mutation, preventing unsafe rollback downgrade. A corrupt authoritative
  database fails safely without deleting it. Crash-recovery of a temp-only
  manifest is deferred to exact reconciliation, never performed by a persisted
  T3 read.
- Storage is bounded to one current row set and one state row per installed mod;
  replacement is transactional, removed mods cascade, and invalidation deletes
  obsolete rows. There are no historical cache generations on disk.
- Persisted T3 file-summary freshness is evaluated by one set-based snapshot
  query rather than per-mod cache-state probes. A 64-mod regression test holds
  SQL prepares to at most 12 while preserving stale/current and conflict
  semantics.
  Already-complete mod/plugin profile orders are write-free: missing rows are
  inserted in batches and position updates run only for actual mismatches.

Tests cover fresh activation, offline add/remove and same-size replacement,
same-count row tampering, future-version rejection, schema replacement,
missing/corrupt state, partial-scan failure, generated-state exclusion,
narrow/root invalidation, repeated zero-handle reuse, batched metadata, bounded
conflict SQL, schema fast paths/migration, write-free profile reads, long paths,
and nonblocking persisted reads.

### Watcher and write feedback control

- `AtomicFileStore` skips a write only when the existing target bytes are valid
  and identical; inspection failure keeps the original atomic recovery path.
- Build-content watching uses notify `NoCache`, avoiding recursive FileIdMap
  indexing before T3.
- Generated `.flow` state, compact backups, temporary plugin files, and other
  transient sidecars do not trigger content reconciliation. Mixed event batches
  retain real mod paths; flow-only batches produce no content event.
- Requested and active watcher generations are separate. A replacement becomes
  active only after all roots succeed; failed or superseded candidates leave the
  prior watcher alive.
- Repeated plugin reads preserve the exact `plugins.txt` SHA-256 and timestamp
  and create no backup.

### VFS and process launch

- Executable resolution creates one minimal launch profile snapshot rather than
  recomputing file/conflict summaries. The first launch after an uncovered
  project activation performs one shallow top-level folder/portable-manifest
  inventory reconciliation and repairs profile rows; a successful exact T4
  satisfies the same generation so launch does not repeat that scan. Existing
  enabled state remains database-authoritative. No mod-content walk or stable
  metadata handles are involved.
- Root Builder resolution and the VFS planner share that ordered path/name/
  fingerprint snapshot; VFS performs zero second metadata/profile reads and
  moves the mount vector instead of copying it. Explicit-profile priority is
  preserved. An offline-added Root Builder executable is resolvable before an
  exact workspace read. ParallaxGen's first mutating launch rebuilds the shared
  view from the same post-registration order used for its MO2 metadata, so its
  first and subsequent layer sets are identical.
- Shallow placement state is invalidated immediately before launch, closing the
  watcher-debounce race. All enabled layers remain in the mount plan so USVFS
  priority, not stale conflict data, decides overlay precedence.
- Every launch gets an immutable `CREATE_NEW`
  `.flow/vfs/sessions/vfs-config-<manager-pid>-<random>.json` descriptor.
- A complete explicit Unicode environment replaces `FLUXORA_VFS_CONFIG` only in
  the child. It is sorted case-insensitively as required by CreateProcess while
  preserving `=C:`-style drive pseudo-variables first; the manager environment
  remains unchanged.
- Pre-launch and Detours failures remove their descriptors. Successful launches
  retain descriptors for descendants; a later manager prunes descriptors whose
  owner manager is dead.
- Ordinary Skyrim launch cleanup now inspects only immediate Root Builder cache
  children. Both the `root-launch` directory and every marker are validated
  against the project trust root, so child or root junctions cannot redirect
  `PrecacheGrass.txt` deletion outside the project.

On the identical Foundation fixture, the pre-persisted-workspace schema-3 launch
median was 120.1 ms and the final two-batch median is 104.4 ms (95.5-117.6 ms,
p95 117.6 ms): 15.7 ms / 13.1% faster while also fixing isolation, cleanup,
offline-inventory, and profile correctness. The broader historical 610x96
fixture recorded 158.8 ms, but it is not a strict A/B because its shape differs.

Final ten-run launch breakdown on the Foundation shape:

| Stage | Median | Range | p95 |
|---|---:|---:|---:|
| bridge request through process creation | 104.4 ms | 95.5-117.6 ms | 117.6 ms |
| request through VFS-validated ready marker | 123.9 ms | 119.5-139.4 ms | 139.4 ms |
| process creation to first probe entry | 16.3 ms | 15.3-17.5 ms | 17.5 ms |
| process creation to validated probe state | 16.4 ms | 15.5-17.7 ms | 17.7 ms |

Ten historical real SKSE launches showed loader-to-Skyrim-child attach at 35 ms
median (24-70 ms), attach-to-hooks at 4 ms (2-5 ms), and attach-to-first
`__MO_Saves` enumeration at 65.301 s (56.716-76.641 s). The last marker is a
menu-adjacent proxy and includes target/lazy-runtime work. It is deliberately
reported separately and is not attributed to Fluxora preparation.

## Final benchmark matrix

The Foundation aggregate source contained only structural statistics: 619 mod
directories, 70,853 content files, mean 114.464 and p95 351 files per mod, 292
plugin files, 6,778 conflict paths, and 14,646 conflicting providers. The
capture excludes names, paths, extensions, content, and private hashes, and
refuses output inside the source project.

| Scenario | Native open RPC proxy median | Range / p95 | Exact mods / total background median | Launch bridge median |
|---|---:|---:|---:|---:|
| Foundation shape, metadata absent (2 cold runs) | 10.112 s | 10.068-10.156 s / 10.156 s | 0 / 0.336 s plugin-only | not sampled in cold section |
| Foundation shape, new process (10 runs) | 0.240 s | 0.226-0.262 s / 0.262 s | 2.714 / 3.032 s | separate launch set below |
| Foundation shape, same process (10 runs) | 0.203 s | 0.197-0.212 s / 0.212 s | 1.165 / 1.344 s | 0.104 s |
| 1,500 mods x 32 files (3 runs) | 0.249 s warm | p95 0.269 s | 0.737 / 1.162 s | 0.230 s |
| 3,000 mods x 32 files (3 runs) | 0.505 s warm | p95 0.562 s | 1.492 / 2.467 s | 0.412 s |

The larger-shape warm native RPC proxy improved from schema-3 medians of 1.174 s
to 0.249 s at 1,500 mods (0.925 s / 78.8%) and 2.453 s to 0.505 s at 3,000
mods (1.948 s / 79.4%). Strict launch medians improved from 0.264 s to 0.230 s
(12.8%) and from 0.518 s to 0.412 s (20.5%). Strict exact-mod medians moved
from 0.703 s to 0.737 s (+5.0%) and 1.453 s to 1.492 s (+2.6%) because the
final path performs stronger activation/cache correctness checks; that work is
deferred from UI T3 and skipped on watcher-valid same-project reopens. It is
also substantially below the intermediate schema-4 1.174/2.452 s result.

Metadata-cold results are intentionally honest: raw persisted counts were zero,
the exact fallback populated all 619 installed/order rows before T3, and T4 did
not repeat exact mods. The historical schema-1 610x96 metadata-cold median was
12.331 s (12.239-12.424 s, two runs); the final 619x115 median is 10.112 s,
2.219 s / 18.0% lower despite the larger modeled shape. Because those fixture
shapes differ, this is directional evidence rather than a strict A/B.

Retained result artifacts:

- `benchmarks/results/2026-07-10-synthetic-610-release.json`
- `benchmarks/results/2026-07-11-foundation-shape-packaged-confirmation.json`
- `benchmarks/results/2026-07-11-foundation-shape-packaged-final-a.json`
- `benchmarks/results/2026-07-11-foundation-shape-packaged-final-b.json`
- `benchmarks/results/2026-07-11-packaged-scale-1500-3000.json`
- `benchmarks/results/2026-07-11-packaged-scale-1500-3000-final.json`

## Performance suite and correctness gates

`backend/performance/` provides:

- a deterministic configurable fixture with mod/file counts, directory depth
  and branching, conflicts, disabled mods, plugin headers, two profiles,
  executable configuration, and overlay sentinels;
- an x64 probe that distinguishes first entry from VFS-validated readiness;
- schema-5 result validation with raw samples plus min/median/nearest-rank
  p95/max;
- parameter-binding and structural-statistics smoke verification;
- safe fixture ownership markers, structured metadata, refusal to replace
  unowned/malformed roots, and a default 2,000,000-modeled-file ceiling.
- an exclusive `.fluxora-performance.lock` held for the full WorkRoot lifetime;
  concurrent runs fail before binary validation or fixture mutation, and a
  focused contention smoke verifies that contract.

Every open sample checks expected installed/order/plugin counts, and the suite
checks exact/persisted plugin equality. Every launch checks enabled priority,
disabled-layer exclusion, Alternate/Default isolation, unique descriptors,
matching child PID and x64 architecture, descriptor existence, correct overlay,
and unchanged manager environment. The combined warm/launch group is bracketed
by profile-file hash/timestamp checks. Timing thresholds are deliberately not CI
correctness gates.

Final validation evidence:

- full backend CTest: **406/406 passed**;
- full Tauri Rust tests: **115 passed** (29 shell/library and 86 AI tests);
- full renderer Vitest: **75/75 files, 506/506 tests passed**;
- TypeScript typecheck: passed with zero diagnostics;
- focused persisted/exact/failure/fallback/watcher/profile-race Playwright: **7/7
  passed**;
- performance correctness/syntax/schema/parameter/structure smokes: **5/5
  passed**;
- both Foundation final batches and the 1,500/3,000 scale artifact pass the
  schema-5 verifier;
- final root `Build.ps1` Release build passed and produced the approved
  `output-installer/FluxoraSetup.exe` artifact.

Privacy/legal review found no new collection or transfer. Imported real-modlist
structure is local, aggregate-only, path/name/content-free, and not shipped;
no privacy-policy or terms update is required for this performance work.

## Rejected or deferred changes and remaining evidence-backed work

- **Bridge parallelism remains rejected.** The native host and metadata store
  are serialized. Removing the Rust mutex would expose descriptor, Root Builder,
  and lifecycle races without addressing duplicated work.
- **A fake empty cold T3 is rejected.** When durable rows are absent, exact
  reconciliation must complete before the UI claims usable mod state. The
  measured cost is about 10.1 s on the Foundation shape. A future last-project
  idle prewarm could reduce the probability of this case, but only with bounded
  I/O and the same activation/invalidation contract.
- **Successful descriptors remain while their manager lives.** They may be used
  by descendants after the initial process exits. Dead-manager cleanup bounds
  cross-session accumulation; deleting current-manager descriptors earlier is
  unsafe without explicit descendant lifetime tracking.
- **Persistent cache storage grows with current loose-file inventory.** It no
  longer grows with historical generations, but a very large active modlist
  still intentionally stores roughly one current row per indexed entry.
- **Full-row workspace materialization is the clearest next controlled
  optimization.** Persisted T3 still reads full installed records and then a
  second full mod/source join for order references. Exact T4 similarly rereads
  full records around cache preparation, summaries, installed projection, and
  order decoration. A shared exact `{mods,summaries}` snapshot plus lightweight
  order references should remove 2-3 O(N) joins before attempting more granular
  invalidation.
- **Exact T4 remains the largest controlled background cost.** At 3,000 mods,
  exact mods are about 1.492 s and total background is about 2.467 s. The
  watcher-valid same-project fast path removes it from reopens. More granular
  incremental reconciliation remains secondary until the duplicated full-row
  materialization above is removed and remeasured.
- **Launch retains two intentional/constrained linear costs.** Placement roots
  are invalidated and shallowly reclassified immediately before launch to close
  the 900 ms watcher-debounce correctness gap; the 3,000-mod launch proxy is
  still 0.412 s. Project path settings are also reparsed by grass cleanup and
  several VFS path helpers. Carrying the resolved settings/cleanup context
  through launch is a smaller measured follow-up, not a reason to weaken the
  placement safety check.
- **The approximately 65 s Skyrim interval is external/lazy target work.** A
  persistent USVFS lookup index is deferred until ETW aggregate counters show
  lazy VFS lookup, rather than Skyrim initialization, dominates T5.
- OS-cache state cannot be forced portably by the harness. Results explicitly
  separate metadata-absent, new-process/metadata-warm, and same-process warm
  sections and retain all raw values.

## Reproduction commands

```powershell
.\Build.ps1 -Configuration Release -Runtime win-x64 -IncludeSymbols -NoClean
ctest --test-dir build/backend -C Release --output-on-failure

cd frontend-tauri
npm run typecheck
npm test
cargo test --release --manifest-path src-tauri/Cargo.toml
npx playwright test e2e/library-home.spec.ts --grep "persisted|fallback|download|watcher"

cd ..
cmake -S backend -B build/backend-perf -A x64 `
  -DFLUXORA_ENABLE_VFS=ON -DFLUXORA_BUILD_TESTS=ON -DFLUXORA_BUILD_BENCHMARKS=ON
cmake --build build/backend-perf --config Release --target FluxoraPerformanceTools -- /m:1
ctest --test-dir build/backend-perf -C Release `
  -R "^FluxoraPerformance.*Smoke$" --output-on-failure

.\backend\performance\Verify-PerformanceResultSchema.ps1 `
  -ResultPath .\benchmarks\results\2026-07-11-foundation-shape-packaged-final-a.json
```
