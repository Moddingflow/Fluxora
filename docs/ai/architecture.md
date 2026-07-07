# Fluxora AI Architecture

Date: 2026-07-07

Status: Phase 18 host-side large-task orchestration and safe context packing.
This document defines the
AI ownership, permission model, first capabilities, access schemes, and
legal/privacy checklist for provider chat with compact build context,
source-traced local context retrieval, constrained external research, visible
task plans, approval-gated subagent scheduling, persistent job state,
checkpointing, heartbeat/watchdog recovery, pause/cancel state, skills
retrieval, final reports after verification or clear terminal state, the
AI release gate used to catch prompt/model regressions, automatic read-only
large-task orchestration, provider-safe context compression, and the target
staged mod research pipeline in `docs/ai/mod-research-pipeline.md`.

## Decision Summary

Fluxora AI is an opt-in assistant layer that must preserve the existing Fluxora
boundary: the Tauri renderer owns UI, the Tauri Rust shell/facade owns safe app
commands and lifecycle, `FluxoraAIHost` owns AI orchestration, and the C++ core
remains the only owner of domain behavior and filesystem mutation.

AI output is always untrusted. Every proposed action becomes a typed tool call
with JSON schema validation, permission classification, policy checks,
operation correlation, and audit logging before it can affect Fluxora state.

Phase 12 builds on the Phase 11 verification executor with a durable
`fluxora.ai.autonomous-job.v1` lifecycle. Each long-running run is recorded in a
per-build `fluxora.ai.autonomous-job-queue.v1` with operation correlation,
background-mode capability, internal progress events, checkpoints after major
steps, heartbeat/watchdog metadata, pause/cancel state, and a final report only
after verification or a clear blocked terminal state. The phase still does not
add public subscription limits, browser automation, or unapproved hidden action
execution.

Phase 14 adds `fluxora.skill.v1` and `fluxora.ai.skill-selection.v1` as a
read-only skills layer. Skills guide retrieval, planning, validation, and UI
visibility; they do not grant new tools, execute scripts, bypass approval, or
mutate builds. Built-in skills are shipped as static metadata and user skills
are local-only by default with executable scripts disabled in v1.

## Ownership

### `frontend-tauri` Renderer

The renderer may own future AI UI only:

- right-side chat panel, message list, input state, agent status, progress, and
  approvals;
- visual diffs, plan/result previews, citations, and user-facing errors;
- voice button state and local recording UI before transcription is sent;
- feature-local view state and accessibility behavior.

The renderer must not own provider keys, AI policy enforcement, filesystem
access, shell access, native modules, raw Tauri `invoke`, raw bridge calls, or
domain decisions. It can display sanitized DTO snapshots from the facade, but it
must not expose React internals, arbitrary window state, DOM contents, or
renderer services as AI tools.

### Tauri Rust Shell And Typed Facade

The Tauri shell/facade owns the safe native app boundary:

- typed `window.fluxora.ai.*` APIs, including chat response, status, restart,
  and best-effort `cancelRun(operationId)` for the active AI host sidecar run;
- starting, stopping, health-checking, and restarting `FluxoraAIHost`;
- credential storage through the OS credential store;
- native dialogs, cancellation, background job lifecycle, safe external links,
  and controlled navigation;
- command allowlists and renderer-safe error envelopes.

The shell/facade may validate and route AI requests, but it must not move mod,
profile, plugin, download, install, Nexus, VFS, FluxPack, or filesystem rules
out of the C++ core.

### `FluxoraAIHost`

`FluxoraAIHost` is a separate local process for orchestration. It may own:

- provider adapters for private/dev BYOK, public subscription routing, and
  future local models;
- agent scheduling, retries, fallbacks, prompt caching, context compaction, and
  token/cost accounting;
- local memory/context graph and retrieval bundles;
- web/Nexus fetch sandboxing in later phases;
- structured plans, tool-call proposals, verification summaries, and final
  reports.

`FluxoraAIHost` must not mutate builds directly. It does not get raw filesystem,
shell, renderer, Tauri invoke, or C++ object access. All actions go through
typed AI tools, policy checks, approval rules, and the existing Fluxora bridge
path.

Phase 3 implements the first local host process as a Tauri-packaged sidecar
binary. The Tauri Rust shell starts it, performs `system.handshake` and
`system.health`, and exposes only typed `window.fluxora.ai.*` methods to the
renderer. The Phase 3 host owns provider/model registries and a no-network
provider test roundtrip.

Phase 4 implements the first real chat-only path. `FluxoraAIHost` owns a
Gemini REST chat adapter, the local dry-run fallback, a system/safety prompt
pair, retry/fallback routing, provider balance/quota fallback across configured
OS/Supabase credentials, citation DTOs, and cost-estimate/ledger DTOs.
Gemini 3.1 Flash-Lite is the main chat model; Gemini 2.5 Flash-Lite remains the
lower-cost web/orchestration model. All Phase 4 models report
`supportsTools: false`, host responses return `toolCallsAllowed: false`, and
the renderer only displays messages, model/preset selection, sources, and cost
metadata. No Fluxora tools, filesystem access, bridge actions, or build
mutation are available to the model in this phase.

Phase 5 keeps provider/native tool calling disabled but adds an app-owned
read-only context path before each host chat request. The renderer asks the
typed `window.fluxora` facade for allowlisted read-only build tools, every tool
call reuses the AI run `operationId`, and the output is serialized as a compact
system message for `FluxoraAIHost`. The AI host may use that build context as
data, but it still cannot call renderer internals, raw Tauri `invoke`,
raw filesystem APIs, shell APIs, write tools, destructive tools, credential
tools, or external-network tools. The read-only tool set may include
`local.filesystemSnapshot`, a bounded metadata-only view produced through
core-backed Fluxora APIs. It returns relative paths, file kinds, sizes, conflict
owners, profile/plugin summaries, SKSE DLL signals and recent Fluxora
operation-log snippets, but never arbitrary OS paths or file contents.
`local.read_text_file(path,max_bytes)` is separate and on-demand: it is added to
the build context only when the GENERAL `Analyze` skill or an explicit
build/crash/log diagnostic prompt triggers it. It returns at most 64 KB previews
from allowlisted text/config/log/XML files inside the selected build's
`mods/` or `profiles/` folders, and it blocks arbitrary Windows paths, browser
data, credentials, user documents, and whole-disk reads.
Mod file overwrite state is exposed as structured `overwrite.state/counts`
data; update-check text such as `Не проверялся` is only Nexus/update status and
must not be interpreted as a file overwrite or conflict signal.

Phase 6 keeps the same read-only input boundary and adds token-economy
retrieval in `FluxoraAIHost`. The host extracts the Phase 5
`fluxora.ai.build-context.v1` snapshot, builds `FluxoraContextGraph` nodes for
`Build`, `Profile`, `Mod`, `Plugin`, `Archive`, `Download`, `NexusMod`, `File`,
`Conflict`, `Operation`, `LogEvent`, `Skill`, and `Source`, stores them in a
local SQLite graph with an FTS5 index, and replaces the raw snapshot message
with a `fluxora.ai.context-graph.v1` context bundle before provider calls.
Retrieval policy is exact match first, then SQLite FTS, then graph-neighbor
expansion, with optional embeddings explicitly disabled until a provider is
configured. Every context bundle carries source ids, source fingerprints,
timestamps, stale markers, retrieval steps, and a trace that the UI can expose
as "why this answer used these sources." The AI host still does not read the
raw filesystem, bypass the typed facade, or mutate builds.

Context-usage preflight uses the same host-owned prompt preparation path as
`chat.respond`. The renderer calls `window.fluxora.ai.estimateContext()`, the
Rust shell forwards `chat.estimateContext`, and the AI host prepares the same
system instructions, compacted history, build snapshot, context graph, research
route/bundle, and Gemini tool declarations before estimating the next request.
Before any remote provider request, the host packs the prompt to the smaller of
the provider-safe model input window and the Fluxora per-request budget. Ordinary
chat is capped at 96k input tokens, large-audit dispatch/final packages at 160k,
large-audit worker shards at 64k, and continuation packages stay compact.
Packing compacts the build-context graph first, then optional research/large
sections and older history. When Gemini credentials are available, the host calls
`models.countTokens` with a dedicated `generateContentRequest` body whose nested
`model` is always `models/<model-id>` and whose contents, system instruction,
generation config and `google_search` tool declaration match generation. If the
exact count is still at or above the request budget, or Gemini returns a
token/context-limit error, the host retries through stricter package levels
before `generateContent`. If generation itself returns a token/context-limit
error, the host retries with the next stricter package and reports a sanitized
context-limit fallback reason instead of raw provider JSON. Without credentials,
the host returns the existing `chars / 4` estimate.
The renderer may display `FluxoraAiContextUsage` and lightweight draft
approximation only. It must not store raw prompt packages or decide provider
routing, compaction, blocking, cost policy, token ledger values, or large-task
orchestration.

Phase 7 adds `fluxora.ai.research.v1` bundles. The AI host can recognize Nexus
URLs and NXM links in the prompt, build an official Nexus API-first source plan
for metadata, files, and file details/direct dependency metadata. Public Nexus
page fetch is disabled by default and is not a fallback for missing API
credentials, quota exhaustion, `429`, `Retry-After`, or API transport failures.
Non-Nexus public fetches, when separately allowed by policy, are HTTPS-only,
redirect-blocked, domain-allowlisted, size-limited, timeout-bounded, and
protected against loopback, link-local, private network, `file://`, and other
unsupported schemes. Nexus API responses carry `X-RL-*` and `Retry-After`
rate-limit metadata when available. Browser-sandbox fallback and
user-authenticated pages fail closed unless a future explicit approval flow
enables them. Deep research remains disabled by default and requires
expensive-run approval or BYOK. The target staged mod research pipeline is
stricter: Nexus official API/cache data is primary, and missing credentials,
quota exhaustion, `429`, or per-run/API limits create blocked/quota evidence
instead of silently falling back to public Nexus page scraping. Public Nexus
pages may be considered only through a separate explicit public-source policy
after owner/legal review.

Phase 8 adds `fluxora.ai.task-plan.v1` and
`fluxora.ai.subagent-schedule.v1` DTOs to the normal chat response. The plan
contains the goal, assumptions, read steps, proposed mutations, validation
steps, rollback plan, expected risks, review state, and the rule that the host
asks the user only when blocked. The scheduler exposes a default limit of 3
subagents, a maximum of 10 for large tasks, a plan-review agent, visible
long-running progress stages, and an `ai-write-executor` policy with one
mutation at a time per build. Proposed write or destructive actions are queued
and approval-required; Phase 8 does not execute them.

Phase 18 keeps the renderer quiet by default while making `FluxoraAIHost`
responsible for large read-only analysis scaling. The host classifies
`AiTaskScale` from the user prompt plus real build-context counts; explicit
full-audit/all-requirements prompts or read-only analysis over at least 20
mods, plugins, or Nexus targets are treated as large. Large read-only jobs can
automatically use real worker subagents only when a remote provider credential
is available and cost preflight approves the run. Full requirements audits use
the host-owned `fluxora.ai.large-audit-manifest.v1` stage: the full
`build.summary.nexusTargets` list stays in Rust host memory, provider prompts
receive compact counts/source ids/shard references, and workers receive only
their assigned shard. The current large-audit controller dynamically shards the
target list across at most 5 worker jobs and runs at most 2 workers
concurrently. The
manifest records the 160k dispatch/final and 64k worker input budgets. The chef
dispatch call is optional planning; if it hits a context limit, the host marks
`dispatch-fallback` in developer metadata and runs deterministic shard workers
anyway. Normal chat does not show orchestration diagnostics. Developer mode may
show why subagents were or were not used and whether context compression ran.
Real subagent rows come only from attempted `orchestration.subagents` results,
including blocked workers, not from the planning schedule.

If any Gemini chat path still hits a provider context limit after the strictest
safe packing level, the host creates a fresh
`fluxora.ai.context-continuation.v1` system package instead of appending more
compressed text to the original history. The package contains only the user
prompt, operation id, task scale, intent/research route, compact local
inspection, compact research coverage, source ids/counts, completed worker
summaries, and explicit continuation limits. It excludes raw inventory arrays,
raw chat history, raw provider errors, credentials, unsanitized filesystem
paths, and unbounded Nexus/web content. Orchestration returns
`status=completed`, `status=partial`, or `status=blocked`; attempted and
blocked subagents remain in `orchestration.subagents` with redacted error
metadata so the renderer can distinguish "not used" from "attempted but
blocked."

Provider credentials are brokered by the Tauri Rust shell through the OS
credential manager. Renderer code may request connect, disconnect, status, and
test operations through the typed facade, but provider keys are never persisted
in renderer storage, never returned to renderer code, and are not written to AI
host or bridge logs. Phase 4 provider calls read credentials only from the OS
credential store or developer environment variables owned by the host process;
the renderer never receives Gemini or other provider keys.

Supabase anon/publishable keys are not treated as private secrets by
themselves, but they are safe in a browser/renderer only when Row Level Security
and server/Edge Function policy make every exposed operation safe. Supabase
service role, secret, provider, and database credentials must never be shipped
to renderer code, prompt text, logs, support bundles, or public repository
files.

### `fluxora.bridge.v1` And C++ Core

The C++ core remains the single owner of Fluxora domain truth:

- projects, profiles, mods, plugins, downloads, archives, FOMOD, Nexus/NXM,
  operations, VFS, FluxPack, executable launch, path safety, persistence, and
  filesystem changes;
- core/native, operation, bridge, and crash logs;
- validation, preconditions, postconditions, rollback support, and capability
  truth for domain behavior.

User-triggered AI actions must create or propagate an `operationId` through:

```text
renderer -> Tauri shell/facade -> FluxoraAIHost -> policy/tool router ->
Tauri shell/facade -> FluxoraBridgeHost -> C++ core -> logs/progress
```

Future implementation may optimize the exact host routing, but it must preserve
the same ownership rule: AI cannot bypass typed facade, bridge, policy, core
validation, approval, logging, or operation correlation.

## First AI Capabilities

The first product slice is intentionally read-only. The initial capability set
is:

| Capability | Permission class | Owner of truth | Notes |
| --- | --- | --- | --- |
| Chat-only assistant | `plan` | AI host | No Fluxora tools. No build mutation. |
| Read build state | `read` | C++ core via bridge | Current/open project, template/capability summary, build paths summary where already exposed. |
| Read installed mods | `read` | C++ core via bridge | Uses existing installed-mod DTOs. No file moves or enable/disable. |
| Read plugins | `read` | C++ core via bridge | Uses existing plugin/load-order DTOs. `local.check_plugins(profile_id)` returns compact missing-master and enabled ESM/full ESP/ESL-light counts. No load-order mutation. |
| Read selected mod file tree | `read` | C++ core via bridge | Uses existing mod file-tree DTOs for the explicitly selected mod only. No file content reads. |
| Read bounded local file metadata | `read` | C++ core via bridge | `local.filesystemSnapshot` summarizes Fluxora-owned build folders with relative paths, file kinds, sizes, SKSE DLL signals, missing masters and file-conflict samples. No raw file contents or arbitrary OS paths. |
| Read bounded diagnostic text preview | `read` | C++ core via bridge | `local.read_text_file(path,max_bytes)` is Analyze-only/on-demand, scoped to allowlisted files under selected build `mods/` and `profiles/`, capped at 64 KB, and treats contents as untrusted diagnostic data. |
| Read profiles | `read` | C++ core via bridge | Uses existing profile list DTOs. No create/clone/rename/delete. |
| Read downloads | `read` | C++ core via bridge | Uses existing download DTOs. No import, delete, resume, cancel, or install. |
| Read operation status/logs | `read` | Tauri shell and bridge events | Uses cached progress events and safe app-log tailing. No arbitrary file access. |
| Read Nexus status | `read` | C++ core via bridge | Status only. No token disclosure. No connect/disconnect in the first slice. |
| Nexus/web research | `external-network` | AI host over allowlisted fetch/provider grounding | Nexus API/cache-first, public Nexus page fallback disabled, Gemini Google Search grounding when enabled, source snapshots and citations only. No write tools. |

Write/destructive execution, credential setup UI, voice, public billing enforcement, and
approved action execution are future phases. They are
documented here so the early chat-only slice keeps the same permission classes.

## AI Tool Permission Classes

Every AI tool must have a stable ID, JSON schema, permission class,
preconditions, postconditions, audit fields, operation behavior, user-facing
confirmation text when needed, and a clear owner.

| Class | Meaning | Approval rule | Examples |
| --- | --- | --- | --- |
| `read` | Returns existing Fluxora state without external network or mutation. | Allowed after AI is enabled, subject to data minimization and logging. | `mods.listInstalled`, `plugins.list`, `downloads.list`, `nexus.getAuthStatus`. |
| `plan` | Produces analysis, proposed steps, diffs, or explanations without mutation. | Allowed, but outputs are untrusted and must not be treated as commands. | Build explanation, compatibility plan draft, proposed install order. |
| `write` | Changes project/profile/mod/plugin/download state without expected data loss. | Requires visible plan and explicit approval before execution. | Enable/disable mod, move plugin, create separator. |
| `destructive` | Deletes, overwrites, replaces, disables many items, clears state, or can make a build unusable. | Requires step-by-step approval, snapshot where practical, and verification. | Delete mod, replace installed mod, bulk disable, cleanup output. |
| `external-network` | Fetches or sends data outside the device. | Requires AI enabled plus provider/network disclosure; expensive or deep web requires separate approval. | Nexus/API fetch, web fetch, provider call, paid search. |
| `credential` | Reads, creates, tests, rotates, or deletes provider/Nexus credentials. | Requires explicit user action in a settings flow. Never exposed to renderer or AI text. | Store provider API key, test provider key, disconnect provider. |

### Draft Phase 0 Tool Catalog

| Tool ID | Class | Backing surface | Phase 0 decision |
| --- | --- | --- | --- |
| `ai.chat.respond` | `plan` | `FluxoraAIHost` | Chat-only response, no tools. |
| `ai.estimateContext` | `plan` | `FluxoraAIHost` | Next-request context preflight using the same prompt package as `ai.chat.respond`; no tools or mutation. |
| `ai.plan.summarizeBuild` | `plan` | AI host over read-only snapshots | Returns explanation only. |
| `build.state.read` | `read` | bridge/core | Sanitized build/project capability snapshot. |
| `mods.listInstalled` | `read` | bridge/core | Existing installed-mod state, no file tree expansion by default. |
| `mods.getFileTree` | `read` | bridge/core | Explicitly selected mod tree only, paged and compact. |
| `local.check_plugins` | `read` | bridge/core via renderer context tool | Compact profile plugin health check. Returns `missing_masters`, `plugins_with_errors`, and `plugin_count` from existing plugin metadata. |
| `local.filesystemSnapshot` | `read` | bridge/core via renderer context tool | Bounded metadata snapshot for `local.get_profile_snapshot`, `local.detect_skse_plugins`, `local.scan_recently_installed_mods`, `local.parse_crash_logs`, `local.check_missing_masters`, and `local.check_file_conflicts`. Metadata only; no content reads. |
| `local.read_text_file` | `read` | bridge/core via renderer Analyze tool | On-demand bounded text preview for `README.txt`, `requirements.txt`, `fomod/info.xml`, `fomod/ModuleConfig.xml`, `*.log`, `plugins.txt`, `loadorder.txt`, and `modlist.txt` under selected build `mods/`/`profiles/`. Capped at 64 KB and blocked for arbitrary OS, browser, credential, document, or disk-wide reads. |
| `plugins.list` | `read` | bridge/core | Existing plugin/load-order state. |
| `profiles.list` | `read` | bridge/core | Existing profile names only. |
| `downloads.list` | `read` | bridge/core | Existing download state, no install/delete/resume/cancel. |
| `nexus.status.read` | `read` | bridge/core | Auth/status only, no tokens. |
| `operations.getStatus` | `read` | Tauri shell progress cache | Recovery/status from recent bridge progress events. |
| `operations.recentLogs` | `read` | Tauri shell log boundary | Safe tail of Fluxora-owned log files, filtered to operation lines. |

Phase 5 tool outputs use cursor/offset pagination for large auxiliary lists.
The first context bundle includes current build summary, complete installed
mod, mod-order, and plugin/load-order inventories, selected mod file tree when a
mod is selected, profiles, downloads, operation status, recent operation logs,
Nexus auth status, and a bounded `local.filesystemSnapshot` result. File trees,
local filesystem metadata, downloads, profiles, and logs stay compact; the
inventory lists are complete snapshots rather than 80-item samples.
When an Analyze diagnostic prompt triggers `local.read_text_file`, the snapshot
may also include a small `fluxora.ai.local-read-text-file.v1` bundle with
`content_preview`, `bytes_read`, `truncated`, and `path` fields for allowlisted
profile/mod text files only.
`build.summary.conflictEvidence` additionally performs a bounded read-only
`mods.getFileTree` pass over the highest-signal overwrite candidates and stores
concrete file-owner pairs plus file samples. Models may name exact mod pairs
only from this evidence or explicit file-tree `conflictOwners`; aggregate
overwrite counts alone remain warning material, not proof of a pairwise
conflict.

Phase 6 upgrades that lossy snapshot into a source-traced context bundle:

- SQLite tables store context sources, graph nodes, graph edges, and optional
  embedding placeholders.
- FTS5 indexes node labels, summaries, and compact raw DTO text.
- Source fingerprints and capture timestamps are recorded for each read-only
  tool result.
- Newer operation snapshots mark older source rows stale for the same tool
  kind.
- Models receive only the compact bundle and source ids; raw Phase 5 snapshot
  messages are not forwarded after successful graph ingestion.
- Assistant responses include local `FluxoraContextGraph` citations so the UI
  can open the source-id trace without using external web access.

Phase 9 adds the safe action catalog for the first write/destructive-capable
surface. Execution still remains approval-gated: the catalog describes exactly
which Fluxora UI actions the AI may propose, the schema and policy for each
action, and the existing facade/bridge/core method that must perform the real
validation.

### Phase 8 Planner And Subagent Shape

`AiTaskPlan` is represented by the host-owned
`fluxora.ai.task-plan.v1` DTO. It contains:

- `goal`;
- `assumptions`;
- `readSteps`;
- `proposedMutations`;
- `validationSteps`;
- `rollbackPlan`;
- `expectedRisks`;
- a plan review state;
- `askUserOnlyIfBlocked: true`;
- `finalResponsePolicy: after-verification-or-clear-blocked-state`.

`AiSubagentSchedule` is represented by
`fluxora.ai.subagent-schedule.v1`. It contains:

- `defaultSubagentLimit: 3`;
- `maxSubagentsForLargeTasks: 5`;
- scheduled read, external-network, plan and report agents;
- a plan review agent;
- an `ai-write-executor` queue with `maxConcurrentMutations: 1`,
  `operationLock: per-build`, `writeActionsOnlyThroughQueue: true`, and
  `hiddenDestructiveActions: false`;
- visible long-running progress stages.

The current scheduler can split "check compatibility for these 20 mods" into
web research, build-state, compatibility-analysis, and report agents. It can
turn "prepare a basic build" into a plan with queued write proposals and a
`needs-approval` review state. It does not run parallel conflicting mutations,
because all mutations remain proposed and the executor queue allows only one
approved mutation at a time.

The renderer treats the schedule as planning metadata. It surfaces real
subagent rows only when a host response includes attempted
`fluxora.ai.multi-model-orchestration.v1` subagent results, including blocked
workers with redacted error metadata. Each visible subagent has a stable name,
derived status, and a renderer-owned chat tab that opens the returned subagent
output or blocked-state summary. Schedule-only entries do not create fake worker
tabs. These tabs are view state derived from the host DTOs; they do not grant
the renderer raw filesystem, shell, provider-key, or hidden host access.

For large read-only build analysis, requirements, compatibility, or audit
prompts, `FluxoraAIHost` now upgrades the schedule into a real
`fluxora.ai.multi-model-orchestration.v1` run when the prompt/build scale,
remote credentials, and cost preflight allow it. Gemini 3.1 Flash-Lite becomes
the chef: it reads a compact dispatch package, may write a capped dispatch
plan, runs bounded shard workers for web/orchestration work, caps worker output,
and then produces the final synthesis from a compact final package rather than
the full message bundle. Every chef and worker provider call is packed against
runtime provider limits when available; for Gemini the host fetches model
metadata and uses `countTokens` with a reserved output budget before
`generateContent`. Subagent output is advisory data, not instructions, and the
final chef answer must stay grounded in Fluxora context, `conflictEvidence`,
`missingMasterDetails`, research citations, or explicit uncertainty. If the
task is ordinary, credentials are missing, cost preflight blocks the run, or
only one remote model is available, the host returns an
`orchestrationDecision` reason instead of claiming subagents ran.

### Phase 9 Safe Action Catalog

`frontend-tauri/src/shared/ai-safe-action-catalog.ts` is the Phase 9
source of truth for the allowlisted AI action surface. The renderer can read it
through `window.fluxora.ai.listSafeActions()`, and `FluxoraAIHost` exposes the
same capability as `safeActionCatalog` in `system.health`.

The catalog schema is `fluxora.ai.safe-action-catalog.v1`. It contains the
Phase 9 actions:

- projects: `projects.create`, `projects.rename`, `projects.openConfig`;
- build paths: `buildPaths.get`, `buildPaths.save`;
- mods: `mods.listInstalled`, `mods.setEnabled`, `mods.setAllEnabled`,
  `mods.moveOrderItem`, `mods.createEmpty`, `mods.createSeparator`,
  `mods.deleteSeparator`, `mods.deleteInstalled`;
- plugins: `plugins.list`, `plugins.move`, `plugins.setEnabled`;
- profiles: `profiles.list`, `profiles.create`, `profiles.clone`,
  `profiles.rename`;
- downloads and archives: `downloads.list`, `downloads.importFile`,
  `downloads.install`, `downloads.delete`, `archives.install`,
  `downloads.analyzeContentLayout`, `downloads.analyzeFomod`,
  `downloads.installFomod`;
- Nexus/NXM: `nexus.getAuthStatus`, `nexus.connect`, `nexus.disconnect`,
  `nxm.captureLinks`, `nxm.importInboundDownloads`;
- operations: `operations.getStatus`, `operations.cancel`.

Every descriptor has:

- a JSON schema with required `operationId`;
- a permission class;
- dry-run support state (`not-applicable`, `planned`, or `supported`);
- preconditions and postconditions;
- `AI.Tool` audit-log requirements;
- operation-id propagation through renderer facade, Tauri shell, bridge host,
  C++ core, and operation log;
- rollback or undo notes;
- user-facing confirmation text;
- backing facade and bridge/core method names.

Read actions are available as catalog/read context. Non-read actions are
`approval-gated`, go through the `ai-write-executor` queue, and require core
validation. Destructive actions use `step-by-step` approval. Credential actions
must stay inside Fluxora-controlled settings/account flows. The model cannot
approve actions, web/Nexus/FOMOD/log content cannot change permissions, and the
catalog does not expose shell, dialogs, text-file, process, or raw filesystem
tools.

Phase 9 therefore gives the AI the same functional action vocabulary as the UI
without bypassing core validation. Phase 10 is responsible for executing
approved basic build actions against this catalog.

### Phase 10 Execution MVP

`frontend-tauri/src/renderer/features/ai/ai-execution-mvp.ts` is the first
approved-action runner for basic build tasks. It does not add a new native
business layer. Instead, it turns an explicit structured request into
`fluxora.ai.basic-build-execution-plan.v1`, validates every planned action
against the Phase 9 safe action catalog, and dispatches approved steps through
the existing typed `window.fluxora` facade.

The Phase 10 runner covers the first build scenarios:

- create an empty build from a reviewed template request through
  `projects.create`;
- rename the selected build through `projects.rename`;
- create profiles through `profiles.create`;
- add mod separators through `mods.createSeparator`;
- enable or disable one mod through `mods.setEnabled`;
- move one mod-order item through `mods.moveOrderItem`;
- import a local archive through `downloads.importFile`;
- install an already downloaded archive through `downloads.install`;
- delete an installed mod only with step-by-step approval through
  `mods.deleteInstalled`;
- check basic plugin state and missing masters through `plugins.list` and
  `local.check_plugins(profile_id)`;
- return a final execution report after verification.

Approval state is passed as UI-owned data, not AI text. `approveAllSafeActions`
can execute safe write actions, but destructive actions still require the exact
step id in `approvedStepIds`. The runner takes a read-only build-context
snapshot before approved mutations, verifies each tool result before continuing,
takes a post-mutation snapshot, and returns `verified`, `partial`,
`needs-approval`, or `blocked` with recovery instructions. Missing required
targets block execution instead of being guessed.

### Phase 11 Verification, Diff, And Rollback

The Phase 11 executor keeps verification evidence attached to the execution
result instead of relying on model prose. Approved mutations produce a
`fluxora.ai.basic-build-verification-diff.v1` bundle with:

- pre/post read-only snapshots for build, profile, mod, mod-order, plugin,
  download, operation status, and recent operation log state;
- a human-readable diff for review in Fluxora UI surfaces;
- a machine-readable diff with domain, source tool, entity id, change type,
  before value, after value, and summary;
- verification checks for mod existence, enabled state, mod order, plugin
  order, missing masters, duplicate names, failed installs, and operation
  errors;
- rollback hook metadata for supported recovery paths and clear manual
  instructions where automatic rollback is not supported.

The runner reports `verified` only when executed steps pass and every required
verification check is green. Missing masters, failed installs, operation errors,
or failed postconditions produce `partial` with recovery instructions. Rollback
hooks are explicit and never claim universal automatic undo; destructive
recovery still requires the safe action catalog approval rules.

### Phase 12 Long-Running Autonomous Jobs

Phase 12 introduces the first persistent autonomous-job contract:

- `fluxora.ai.autonomous-job.v1` records one long-running AI run with `jobId`,
  `runId`, `operationId`, session/build scope, model/provider metadata, current
  state, current stage, percent, heartbeat, watchdog, checkpoints, internal
  progress events, pause/cancel flags, optional blocked reason, task plan,
  subagent schedule, policy, and final report.
- `fluxora.ai.autonomous-job-queue.v1` stores jobs per build/session scope so
  app refresh or restart can recover queued/running work without losing the
  plan, operation id, checkpoint history, or progress trail.
- Background mode is explicit. Jobs run as `provider-background` only when the
  selected model advertises background support; otherwise they use
  `local-resumable` mode and resume from the persisted checkpoints.
- Internal progress is streamed as small stable events. It does not replace the
  final response and it does not expose raw filesystem, shell, provider keys,
  raw prompts, or renderer internals.
- The watchdog stores heartbeat sequence/deadline/missed-heartbeat state. A
  stale heartbeat is recoverable evidence, not a fake final answer.
- Checkpoints are recorded after every major step: queue, background start,
  provider response, streaming, verification, pause/resume/cancel, blocked
  state, restart recovery, and final report.
- Pause and cancellation are explicit persistent states. Resume queues the job
  from the last checkpoint; cancellation prevents pretending an unfinished run
  produced a verified result.
- `blocked` is allowed only for user action, login, captcha, missing file,
  permission, or budget. Network/provider failures must map to a user-actionable
  terminal state instead of arbitrary model prose.
- The final report is stored only after verification or a clear blocked state.

The current renderer records this queue through typed Fluxora AI runtime state,
shows explicit `Остановлено` terminal state on user cancellation, and the Tauri
shell gives AI chat runs a long-running timeout plus best-effort host-sidecar
cancel by operation id. A future host
iteration can move queue persistence into an AI-host SQLite store and replace
request/response stdout with a long-lived response/event router without changing
the renderer DTO schema.

### AI Intermediate Run Events V1

The first live AI progress stream is Fluxora-owned runtime event streaming, not
provider-native token streaming. `FluxoraAIHost` emits JSON-RPC notifications on
stdout with method `ai.intermediateEvent`; Tauri validates and redacts the
payload, logs it to the AI host log with `operationId`, then forwards it to the
renderer on `fluxora:ai:run-event` through
`window.fluxora.ai.onRunEvent(callback)`.

The shared DTO schema is `fluxora.ai.intermediate-event.v1`. Each event has
`eventId`, renderer-created `runId`, `operationId`, monotonic `seq`,
`createdAt`, canonical `type`, `level`, `visibility`, `stage`, `message`,
optional `percent`, and an optional typed redacted `payload`. V1 event types are
`progress`, `note`, `tool-started`, `tool-completed`, `site-visited`, `error`,
and `heartbeat`; provider/OpenAI/Anthropic/Gemini raw event names are not part
of the renderer contract.

Events describe real host stages only: prompt/context preparation, local
inspection, research routing, Nexus/web source capture or policy block,
provider attempt/fallback, response finalization, heartbeat, and terminal
blocked/error states. They do not carry assistant deltas, raw tool output, raw
HTML, raw prompts, provider credentials, Nexus auth headers, cookies, tokens,
stdout/stderr, or full logs. Renderer display treats all event text and URLs as
untrusted and runs them through the existing AI chat sanitization path.

The chat UI shows only `visibility: "user"` events as a compact latest status
and collapsed step list while keeping final answer text hidden until completion.
`developer` and `audit` events remain available for logging/debug surfaces but
are not normal chat chrome. The autonomous job queue may persist canonical
events in its bounded progress trail, capped at 80 entries. Support bundles
record intermediate-event counts only and never include event payloads or
messages by default.

This stream is separate from C++ `operations.progress`. AI run events explain
host orchestration for one chat run; C++ operation progress remains the source
of truth for mod-management mutations and filesystem work. The two can share an
`operationId` for correlation, but one must not be converted into the other.

### Phase 14 Skills System

`frontend-tauri/src/shared/ai-skills.ts` defines the first Fluxora skills
contract. Built-in runtime skill markdown now lives under
`FLUXORASKILLS/skills/<game>/<skill-name>/SKILL.MD` and `Build.ps1` copies it
into the app payload as `Fluxora AI/Skills/<game>/<skill-name>/SKILL.MD` next
to `Fluxora.exe`. `docs/ai/skills/<skill-id>/` remains reference material for
older Phase 14 artifacts. The schema set is:

- `fluxora.skill.v1` for a single `FluxoraSkill`;
- `fluxora.skill.manifest.v1` for `manifest.json`;
- `fluxora.ai.skills.v1` for the catalog;
- `fluxora.ai.skill-selection.v1` for the selected skill evidence attached to a
  task plan and chat response.

Each `FluxoraSkill` has trigger metadata, a game scope, a markdown skill body,
and a descriptor with allowed tools, required provider capabilities, example
prompts, validation checklist, and security notes. Agents read trigger metadata
first and load the full `SKILL.MD` body only after an `always`,
`default-for-game`, or prompt trigger matches. The allowed tools must already
exist in `fluxora.ai.safe-action-catalog.v1`; a skill cannot create a new tool,
lower a permission class, approve a write, or bypass C++ core validation. The
selected skill is visible in the chat message and in the task plan through
`selectedSkill`.

The first built-in skills are:

- GENERAL concise response style;
- GENERAL Analyze for build/crash/log diagnostics with gated bounded text previews;
- SkyrimSE/AE default safety and load-order rules;
- SkyrimSE/AE build optimization;
- Skyrim basic build setup;
- Nexus compatibility check;
- FOMOD install assistant;
- load-order cleanup;
- missing masters diagnosis;
- MO2 transfer assistant;
- FluxPack export/import assistant.

User skills are local-only by default. Executable scripts are not allowed in v1.
Import/export with signatures is reserved for a later phase and must not be
treated as a current trust mechanism.

Skill retrieval uses the existing context graph concept. Built-in skills project
to `Skill` nodes with stable source ids such as `builtin-skill:<id>`, and the
planner records which nodes matched the prompt. This gives the user and future
AI host a visible "why this skill was used" trace without giving the renderer or
model filesystem, shell, raw invoke, or direct host access.

### Phase 7 Research Tool Shape

`web.research` and `nexus.research` are represented by the host-owned
`fluxora.ai.research.v1` bundle rather than renderer fetches or model-native
Fluxora tools. The bundle contains:

- `permissionClass: external-network`;
- the preceding `fluxora.ai.mod-research-route.v1` route decision from
  `FluxoraAIHost`, derived from prompt, local build/context bundle, and the
  requested research policy before Nexus/web fetches run;
- the active policy: allowlisted domains, denied schemes, SSRF protection,
  public-fetch limits, Gemini Google Search state, browser-sandbox state,
  authenticated-page approval state, deep-research state, and backoff mode;
- `fluxora.ai.nexus-investigation.v1` with Nexus targets extracted from
  user-provided Nexus/NXM links, safe explicit ids, and local suspect metadata;
- source snapshots with `captured` or `blocked` status, summaries, rate-limit
  headers, prompt-injection filtering metadata, and `instructionsAllowed: false`;
- clickable citations exposed through the normal AI `sources` array.

The renderer does not fetch the web, store web pages, receive Nexus tokens, or
gain a generic browser/shell/filesystem tool. Web/Nexus content cannot approve
actions, alter system policy, request secrets, or call Fluxora tools.
When local context already contains deterministic high-signal evidence such as
missing masters, failed operations, bridge/path setup failures, failed
downloads/installs, or concrete file-conflict samples, the route is
`no-web/local-only` and no `searchBudget` is emitted. `searchBudget` is present
only when local inspection is insufficient and external Nexus/search
verification is allowed by policy.
Explicit requirement/dependency audits are the narrow exception: local missing
masters are treated as suspect evidence to verify through Nexus API/cache, not
as a terminal local-only answer. Public Nexus page scraping still remains
disabled unless a separate public-web policy explicitly allows it.
Generic public-web research uses `route=google-search-only` when Gemini
grounding is approved: the host passes Gemini's provider-side `google_search`
tool to generation, but `allowPublicWebFetch=false` and Fluxora does not collect
direct URL snapshots.
When the user asks to audit every mod or the whole build for missing
requirements, the route switches to `auditScope=full-build-requirements`:
Fluxora may collect official Nexus API/cache evidence from local Nexus mod ids
up to the daily Nexus request budget, including GraphQL legacy requirements and
v3 file-version dependency evidence when a file-version id is known. The report
must include exact checked/target/remaining coverage and stop on credential,
quota, 429, retry-after or availability failures instead of claiming that Nexus
API research is forbidden or that all mods were checked.

Intent routing is represented separately as `fluxora.ai.intent-route.v1`.
`FluxoraAIHost` derives this canonical DTO before the mod-research route so
policy decisions are language-independent and do not depend on renderer keyword
checks. The DTO records `promptLanguage`, `replyLanguage`, confidence, signals,
canonical intent, scope, explicit targets, Nexus API/public-web flags, external
network need, and clarification state. Deterministic signals such as Nexus URLs,
`nxm://`, explicit `gameDomain:modId`, tool ids, local Nexus metadata, and
research params win first; multilingual semantic examples or a low-cost
structured classifier may classify requirements, compatibility, public-web,
local diagnosis, mutation, or unknown intents after that. Embeddings may
optimize matching only through the existing context graph `context_embeddings`
hook when a provider is configured; embeddings are not a policy boundary and are
not exposed to the renderer. The renderer may display `intentRoute` from chat
responses, mod-research routes, or context-usage traces, but it must not approve
Nexus API, public web, or mutation policy from source text or renderer state.

For the target staged mod research flow, `docs/ai/mod-research-pipeline.md` is
the governing pre-code specification. It requires a single `FluxoraAIHost`
manager with staged prompts and strict schemas for local ingest, routing, local
inspection, Nexus investigation, non-Nexus query planning, external web
investigation, diagnosis judging, final response rendering, and state
compression. It also fixes local-first routing, evidence cards instead of raw
page bodies, source ids plus citations, corroboration counts, visible conflict
records, source tiers A/B/C/D, confidence and contradiction-risk metadata,
discard reasons, a maximum of 3 search queries, 8 fetched/read pages, and 6
final hypotheses per case.

## Prompt Injection And Untrusted Content

Prompt injection is expected from content that Fluxora may ingest or display:

- Nexus pages, mod descriptions, changelogs, comments, and API text fields;
- arbitrary HTML, Markdown, URLs, screenshots with OCR text, and web snippets;
- FOMOD metadata, XML labels/descriptions, archive file names, and installer
  notes;
- logs, crash reports, stack traces, support bundles, and operation output;
- user-provided text, pasted instructions, imported project names, mod names,
  profile names, and path-like strings.

Rules:

- Treat retrieved content as data, not instructions. It cannot grant
  permissions, approve actions, change system policy, hide sources, or request
  secrets.
- Tool outputs and web/Nexus content must be wrapped with source metadata so the
  model can cite them without confusing them with developer/system policy.
- HTML and Markdown rendered in chat must be sanitized. No dangerous inline
  event handlers, scripts, arbitrary navigation, or unsafe `target=_blank`
  behavior.
- External-network tools use SSRF/local-network/file-URL protection before web
  research sources are admitted.
- Tool calls must pass schema validation and policy checks after model output,
  not rely on prompt wording alone.
- Approvals come only from Fluxora UI state controlled by the user, never from
  AI text, web content, FOMOD metadata, or logs.
- The policy layer must fail closed when source trust, permission class,
  operation lock, budget, or approval state is unclear.

## Access Schemes

### Private/Dev: BYOK-First

Private/dev AI starts as BYOK-first:

- users or testers provide their own provider key;
- provider keys are stored through the OS credential store, never in renderer
  env vars, localStorage, IndexedDB, logs, crash dumps, or support bundles;
- provider cost is paid by the key owner;
- advanced debug traces stay local by default and must redact secrets;
- public billing promises and hard product limits are deferred until private
  tasks produce real cost and reliability data.

This mode is best for private alpha, developer testing, provider comparison, and
high-cost providers that Fluxora should not bundle into a low-price subscription.

### Public: `4.99 EUR/month` Subscription With Centralized Cost Control

The public subscription path must be centrally cost-controlled:

- Fluxora owns provider routing, model selection, cost preflight, usage ledger,
  and remote-configurable pricing metadata;
- user-facing limits use internal `AI credits`, not raw provider tokens;
- expensive web/deep research and large jobs require separate approval or BYOK;
- premium providers are excluded from the bundled default stack unless current
  production economics prove they fit the margin target;
- ordinary prompts cannot silently consume a large share of the monthly budget;
- provider calls need clear disclosure of what leaves the device and which
  provider class receives it.

Public billing and hard public limits should ship only after private MVP data
proves realistic cost envelopes.

## Phase 15 Cost Optimization And Unit Economics Contract

`FluxoraAIHost` owns the Phase 15 cost policy. The renderer may display the
returned DTOs, but it must not decide monthly wallets, safe-percent thresholds,
provider routing, BYOK billing, web sub-budgets, prompt-cache behavior, or
margin enforcement.

The host returns these artifacts for every chat run:

- `routingDecision`: Gemini-only remote routing with Gemini 3.1 Flash-Lite as
  the main chat model, Gemini 2.5 Flash-Lite reserved for web/orchestration
  work, premium routes only for BYOK, and local models where they can satisfy
  the request.
- `costPreflight`: an internal `AI credits` wallet check with free-demo,
  paid-monthly, web-research and long-job budgets. Ordinary paid prompts cannot
  silently exceed the safe monthly percentage; large jobs require preflight and
  may return economy/full/BYOK choices instead of calling a provider.
- `costPipeline`: the large-task pipeline contract. Runs classify cheaply,
  retrieve through `FluxoraContextGraph`, prefer Nexus API/cache before paid web,
  compact context before stronger planning models, verify with cheap checks,
  deduplicate sources, batch low-cost checks, apply stop conditions, and produce
  final reports from structured artifacts.
- `costEstimate` and `ledgerEntry`: per-run estimate/actual usage data with
  hard cost, display cost, risk buffer, prompt-cache status, usage breakdown,
  orchestration/subagent token cost, credit debit, and whether the run charges
  Fluxora provider budget.
- `contextUsage` and `tokenUsage`: next-request context pressure and provider
  token usage. `contextUsage` keeps `contextWindowTokens` for compatibility, and
  also reports model input/output limits, the Fluxora safe input budget,
  budget-percent, current input tokens, precision, mode, level, included
  sections, compaction/blocking hints and timestamp. `tokenUsage` records input,
  output, total and pre-request context tokens from Gemini usage metadata or
  fallback estimation.
- `marginTelemetry`: the local estimate for
  `gross_margin_after_ai_cost`, including gross revenue, VAT/payment/
  infrastructure reserve, AI provider cost, web/search cost, margin after AI
  cost, and heavy-user detection.

Nexus research uses an in-process metadata cache with TTL and retained
rate-limit headers. This avoids repeatedly paying network/provider context costs
for the same mod metadata while keeping web/Nexus content untrusted and cited.

## Phase 17 Evaluation Suite

`frontend-tauri/src/shared/ai-evaluation-suite.ts` defines
`fluxora.ai.evaluation-suite.v1`, the first release-gate harness for AI
quality. It keeps evaluation code in the Tauri/shared test boundary and does
not move build-domain behavior out of the C++ core.

The suite contains eight golden tasks:

- explain current build;
- find missing masters;
- check Nexus compatibility;
- install local archive;
- reorder mod/plugin;
- create basic Skyrim build;
- recover from failed install;
- refuse dangerous prompt injection.

Each task declares expected tools, disallowed tools, required evidence,
cost thresholds, latency thresholds, and the minimum human-review score.

Tool-call record/replay uses `fluxora.ai.tool-call-tape.v1`. Replay validates
operation ids, strict call order, safe-action payload schemas, approval ids for
executed non-read actions, and disallowed-tool handling. Hidden approvals,
raw Tauri invoke, shell commands, and bypass flags fail the gate.

The deterministic provider is `deterministic-eval` with model
`deterministic-eval-v1`. It is a local fixture provider for tests only: no
network, no prompt storage, stable output fingerprints, and no production model
trust. Real providers remain untrusted until schema validation, policy checks,
approval gates, and verification complete.

Cost regression checks compare per-task hard AI credit cost, actual internal
cost, displayed cost, and web/search call count. Latency regression checks
compare per-task stage duration. The human review rubric scores correctness,
grounding, safety, cost discipline, latency, and recovery honesty, with hard
failures for secret leaks, model-approved mutations, ungrounded critical
claims, "done" without verification, network policy bypass, and hidden
destructive actions.

The runnable gate is:

```powershell
cd frontend-tauri
npm run test:ai-gate
```

The gate report schema is `fluxora.ai.release-gate.v1`; it summarizes golden
task, replay, deterministic-provider, cost, latency, and human-review status
without raw prompts, provider keys, Nexus tokens, private file contents, or raw
web page bodies.

## EU/GDPR Legal And Privacy Checklist

Before cloud AI or public AI ships, the bundled privacy policy, terms, and any
in-app disclosure must answer these questions for German/EU expectations:

- Data categories: which prompts, chat history, build/project metadata, mod
  lists, plugin lists, download records, Nexus status, web/Nexus snippets, logs,
  crash/support data, voice transcripts, audio, citations, and usage/cost data
  may be processed.
- Phase 5 provider prompts may include compact read-only build context when the
  user sends an AI chat message: project name/game/template, path configuration
  booleans, complete installed-mod and plugin/load-order summaries, selected
  mod file-tree names, bounded file-owner samples for high-signal
  overwrite/conflict evidence, local filesystem metadata for Fluxora-owned
  build folders such as relative paths, file kinds, sizes, SKSE DLL/config
  signals and conflict owners, profile names, download summaries, Nexus
  linked/configured status, operation progress snapshots, and recent operation
  log lines. When an Analyze diagnostic prompt is used, Phase 5 may also include
  up to 64 KB `content_preview` snippets from allowlisted profile/mod text files
  such as `README.txt`, `requirements.txt`, FOMOD XML, crash/SKSE logs inside
  build folders, `plugins.txt`, `loadorder.txt`, and `modlist.txt`. Raw provider
  keys, Nexus tokens, arbitrary OS paths, arbitrary file contents outside that
  scoped preview, shell output, browser data, user documents, and full log files
  are not included by this phase.
- Phase 7 research prompts may include Nexus URLs/NXM links provided in chat,
  official Nexus API metadata/file summaries when a credential is available to
  the host, Gemini Google Search grounding citations, source ids, snapshot
  summaries, rate-limit/backoff metadata, and blocked-source reasons. The target
  staged mod research pipeline must not include public Nexus page summaries as
  a fallback for missing API credentials, exhausted quota, `429`, or configured
  API limits. Public Nexus pages require a separate explicit public-source
  policy after owner/legal review. Raw page bodies, provider keys, Nexus tokens,
  authenticated private pages, arbitrary file contents, and browser cookies are
  not included by default.
- Purpose and legal basis: why Fluxora processes AI data, which parts are
  necessary for the requested AI function, and which optional processing needs
  consent or opt-in.
- Recipients: which providers or subprocessors may receive data in BYOK,
  private/dev, and public subscription modes.
- Transfers: whether provider processing can occur outside the EU/EEA and what
  safeguards, provider terms, or user choices apply.
- Retention: where chat history, local context graph data, prompt caches,
  provider usage records, and web/Nexus snapshots are stored and when they are
  deleted.
- User controls: how to disable AI, delete local AI history/context/cache,
  disconnect provider keys, revoke Nexus/provider access, and export relevant
  AI data if required.
- Secrets: provider keys, Nexus tokens, OAuth data, and personal API keys must
  not appear in renderer storage, logs, prompts, crash dumps, or support bundles.
- Support bundles: raw prompts, web content, build metadata, and logs are
  excluded by default unless the user explicitly opts in.
- Voice: audio stays local by default for `whisper.cpp`; cloud STT requires a
  separate opt-in and disclosure.
- Public release gate: owner/legal review is required before enabling public AI,
  telemetry, analytics, paid web research, subscriptions, uploads, support bundle
  transfer, centralized provider calls, or Phase 5 build-context transfer to AI
  providers in a public build. Bundled privacy and terms localizations must be
  aligned before that release.

## Acceptance Rules For Future Phases

- No AI tool can bypass the typed `window.fluxora` facade, Tauri allowlist,
  bridge protocol, C++ validation, operation lock, or approval policy.
- No AI code can recreate the removed WPF frontend or move business logic into
  renderer, TypeScript, JavaScript, Rust shell, or C#.
- No provider key is available to renderer code.
- No web/Nexus/FOMOD/log/user content can approve actions or change permissions.
- Staged mod research follows `docs/ai/mod-research-pipeline.md`: local
  deterministic evidence wins before web, Nexus uses official API/cache first
  without silent public-page fallback on credential/quota/rate-limit failure,
  external content is untrusted data, and evidence cards are the only
  cross-stage research artifact.
- Every write/destructive action has an `operationId`, audit trail, visible plan,
  user approval, and verification result.
- Direct AI access to renderer internals, raw filesystem, shell, raw Tauri
  invoke, native modules, or C++ objects is explicitly out of scope.
