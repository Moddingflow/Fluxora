# Fluxora AI Evaluation Suite

Status: current single-agent release gate, 2026-07-22.

## Purpose

The gate verifies the shipped Fluxora AI contract: one Gemini model, isolated
build-scoped tabs, an authoritative goal/evidence coordinator, risk-filtered
typed capabilities, safe complete file discovery, native verified reversible actions,
real context accounting, typed failures, grounding citations, and the managed
gateway v2. It contains no subagent, autonomous-job, cost planner, direct-web
fetch, or offline product-provider scenarios.

Run the focused gate with:

```powershell
cd frontend-tauri
npm run test:ai-gate
```

The script executes:

- `tests/ai-single-agent-contract.test.ts`;
- `tests/ai-single-agent-state.test.ts`;
- `tests/ai-single-agent-panel.test.tsx`;
- `tests/ai-gateway-v2.test.ts`;
- `tests/ai-voice-contract.test.ts`;
- `tests/ai-voice-state.test.ts`.

The complete Vitest suite is still required because AI changes share renderer,
facade, bridge-timeout, settings, titlebar, and native integration boundaries.

## Acceptance Coverage

### Product and state

- exactly `gemini` / `gemini-3.1-flash-lite` is exposed;
- the global title bar has no AI entry and the selected-build header does;
- old `fluxora.ai.*` state is removed once without removing unrelated settings;
- unlimited tabs persist by build scope;
- a new tab receives no messages, summary, events, or runs from another tab;
- background completion and events are routed by run/operation id;
- older saved sessions are normalized when per-tab event storage is absent;
- `needs-input` persists one active goal per tab and a short answer after state
  reload continues the same `goalId`;
- verified completion, terminal blocking, and cancellation clear the active goal;
- cancellation targets one operation and never terminates the shared sidecar.

### Local voice input

- facade tests prove `Uint8Array` remains the raw IPC body, all metadata reaches
  the final Tauri invoke unchanged, renderer calls carry `auto`, explicit
  EN/RU/DE remain contract-compatible, and results serialize detected language
  plus Vulkan/CPU backend;
- component tests prove Allow persistence, Deny non-persistence, reset,
  focus/Escape containment, localized copy, safe error redaction, and reducer
  transitions;
- capture tests prove 16 kHz mono DSP constraints, the exact five-minute cap,
  a 30 FPS waveform ceiling, 32 display bars, and track/node/context cleanup;
- reducer tests cover requesting, recording, transcription, error, tab-owner
  reset, operation-id preservation, and draft append semantics;
- Rust tests cover exact WebView origin/kind, deny-by-default, one-shot and TTL,
  profile reset to `DEFAULT`, late-callback fail-closed behavior, raw framing
  and metadata, exact five minutes versus one extra sample, automatic Whisper
  language with translation disabled, explicit-language compatibility, detected
  language/no-speech serialization, language-aware glossary replacement,
  Vulkan-to-CPU fallback with one deadline and no fallback after cancel, one CPU
  crash restart, SHA-256 failures, concurrent warmup, VAD no-speech,
  outer-silence trimming, and content-free stderr/logging;
- Playwright covers Fluxora-owned consent, Deny and repeated prompt, persisted
  Allow, Privacy reset, safe versus developer error details, mic to waveform to
  draft, recording before warmup completes, immediate spinner-only Stop state,
  Cancel, mic to one Gemini Send using the same operation id, no-speech, and
  close cleanup;
- multilingual fixtures cover RU, EN, DE, and at least one other Whisper
  language without translation, while proper names normalize and ordinary
  words remain in the recording language; installed-app performance smoke covers
  Vulkan and forced CPU separately.

### Gemini host and context

Rust host tests verify:

- one provider/model and a required high-thinking first-round
  `local.execution.declare_goal` call over the current dialogue/active goal;
- `answer | inspect | repair`, `explicit | implicit | continuation`, one invalid
  goal retry, then exact `intent-contract-invalid`;
- exact-dialogue `readOnlyEvidence` for answer/inspect, including rejection of
  a hallucinated quote that attempts to downgrade a requested change;
- read-only tools for answer/inspect, reversible tools for implicit repair, and
  unchanged exact confirmation for irreversible work;
- separate local-function and web-only `google_search` requests, with research
  returned as untrusted evidence that cannot expand risk;
- function-call id and thought-signature preservation;
- exact registry resolution for both provider-safe and internal dotted tool
  names, while near-miss and invented names remain rejected;
- lossless paging for tool results above 64 KiB, bounded provider pages,
  matching call ids/names, unchanged small responses, and host-only handling of
  continuation calls while native sibling calls remain forwardable;
- 64-round, 128-call, ten-minute emergency guards;
- two recoveries per error cause; recovery errors do not consume stagnation,
  while three semantically repeated successful results stop execution;
- 89.9% does not compress and exactly 90% does;
- the documented 943,718-token fallback threshold;
- repeated compression advances only across newly eligible history;
- estimated context usage is labelled estimated;
- an oversized current turn returns `ai.context.current-turn-too-large`;
- provider errors retain their real stage and retryability.
- Russian, English, and German unwanted-state descriptions using the same
  implicit-repair contract while informational requests remain read-only;
- evidence-first host-owned `request_input`: absent during `discover`, still
  locked after web-only evidence, available after native read-only evidence,
  safe `evidence-required` correction for a hallucinated early call, exact
  bounded blocking after repeats, `needs-input`, same-goal continuation, and no
  C++ dispatch for the host-owned call;
- `high` thinking for goal declaration, repair and diagnostics, `medium` for ordinary chat
  and summary compression, `temperature: 1.0`, hidden thought text, and
  preserved thought signatures;
- exact invalid-field feedback, two bounded correction retries, successful-only
  read-only caching, default `build` search scope, preserved explicit scopes,
  initial-search revision stripping without a cursor, one read-only stale-index
  restart, exact repeated `stale-revision`, and premature-final recovery;
- `ANY` for goal declaration and unfinished repairs, `AUTO` for answers/reads and `NONE` for the
  final report;
- `tool-started/file-search` only for non-empty `state=tool-calls`, never
  `final` or `fallback`; present-progress started copy plus actual-tool completed
  copy, `tool-completed` only for `ok=true`, with separate `tool-blocked`,
  `recovery-started` and `verification-completed` events;
- `action` never completes without a verified native effect.
- a new native chat session is preopened before the first Gemini tool round;
  normal first-tab use does not exercise recovery;
- semantic progress includes distinct search pages/read ranges, parsed
  JSON/INI values, recipe inspection, native state, staging and verification;
- `ai.tool.no-new-evidence` is a `tool-loop` blocker, while native containment
  and permission failures remain safety blockers;

### Capability adapters

Contract tests require every typed tool to declare its exact operation, domain,
risk, argument schema, verification and rollback/compensation or exact
confirmation without name-pattern heuristics.
Focused Rust tests verify that mod, plugin, download and install payloads expose
only typed opaque refs and never absolute paths. Integration coverage exercises
file commit/Undo, mod enable, plugin move, download cancel/resume, install
submit/get/cancel, profile conflict and creation, and language update. Every
mutation must use one operation id for the bridge call and its verification.
The feature-gated Release native fixture additionally imports a real archive,
passes it through the download and install adapters, verifies mod/plugin/profile/
setting mutations, invokes their typed compensation tokens and rereads every
Undo postcondition. Existing native install-operation tests retain the separate
cancellation and durable-recovery coverage.

### Native file workflow

Focused `BuildFileWorkspaceService` and bridge tests cover complete indexing,
stable distinct pages, stale revisions, matches beyond the first traversal
window, `unique`/`ambiguous`/`not-found`, cooperative cancellation, reparse and
path containment, protected/binary files, UTF-16 and Windows-1251, external
read/write races, read-only Game/Downloads scopes, structured and reversible
Overwrite INI/JSON mutations, the 16-mutation and
2-MiB batch limits, distinct same-file INI keys, duplicate-key rejection,
atomic failure, managed overrides,
reread verification, diff, and rollback. The rollback suite additionally covers
exact undo; independent undo of the first of two runs; later line insertion;
overlapping-line and multi-file transactional conflicts; unchanged and modified
created files; UTF-8, UTF-16, Windows-1251 and CRLF preservation; restoration
after a partial write failure; restart persistence; corrupt manifest rejection;
content-addressed deduplication; and whole-run eviction under the 256 MiB chat
and 1 GiB global policies. Bridge coverage asserts additive `mode`, `reason`,
and `preservedNewerChanges`, `getRollbackStates` operation correlation, and
protocol-v1 compatibility.

Winner-resolution regressions place the same normalized virtual config in a
source mod, `Fluxora AI Overrides`, and Overwrite. They require grouping before
pagination, `totalMatches` based on unique virtual paths, Overwrite's single
effective ref, both shadowed owners in `conflictingOwners`, and the same ref for
filename and source-owner-path queries. A second virtual path with the same
filename remains a separate paged result. Broker unit coverage requires the
typed `effective-winner-ref-mismatch`, `mutation-ineligible`,
`multiple-virtual-targets`, and `unproven-file-ref` blockers.

The feature-gated native integration fixture runs the real
`fluxora-ai-host` against a localhost mock of the managed Gemini transport. Its
first invalid goal response proves the single retry, then it traces search, two
distinct bounded read ranges, text search, JSON query, recipe inspection,
staging and commit. The first file search omits `scope`, so the real
default-to-`build` path is exercised with this Russian regression request:

`Можешь в Community Shaders сделать так, чтобы Menu.ToggleKey был PageDown?`

It places the real Community Shaders JSON beside
`EternalFlamesCandles_SWAP.ini` and a weak JSON-name match. Passing requires
that the broker finds the real target, stages and commits exactly one
`ToggleKey=34`
managed override, leaves both source and distractors unchanged, returns a
verified diff, puts `Fluxora AI Overrides` last and enabled, and removes the
override on rollback.

The same fixture then sends the original natural English problem description,
`The battle music in this build is painfully loud.`, and requires
`mode=repair`, `origin=implicit`, `allowedRisk=reversible`, a generic INI
managed override, source preservation, native reread, verified diff and Undo.
Two files match the broad `AudioMixer.ini` search; after the intended file is
read, the host must prove the same opaque ref through its own exact-path search.
The fixture also sends an inapplicable JSON recipe probe in the staging round;
that bounded validation failure must not prevent the verified INI commit.
A two-parameter INI produces exactly one host-owned `needs-input`; `the first
one` continues the same `goalId`, changes only the selected parameter, verifies,
and rolls back. A binary config must finish with exact `binary` blocking and no
manual-edit advice. Host security tests additionally inject instructions through
local config and web research and prove that neither changes risk or scope.

The evidence-first regression adds
`No Grass In Objects - Grass Control/SKSE/Plugins/GrassControl.ini` only inside
the temporary fixture. Mock Gemini first hallucinates a path question, receives
the host-owned `evidence-required` result, then must cause real
`buildFiles.search` and `buildFiles.readText` calls, inspect
`Use-grass-cache` plus `Only-load-from-cache`, and ask one question about those
settings with `newEvidenceCount>0`. Captured run events require real
`tool-started`/`tool-completed` tool names and exclude synthetic final/fallback
search starts. A second neutral `RendererTuning.ini` scenario repeats the same
flow, proving the production policy contains no mod name, repro prompt, or
prepared answer special case.

A separate NGIO batch regression stages `Use-grass-cache` and
`Only-load-from-cache` through two `local.ini.stage_set_key` calls against the
same opaque file ref. Passing requires both stage results to succeed, one
`buildFiles.apply` commit to return one file with two diffs and native reread
verification, the source mod to remain unchanged, and rollback to remove the
single managed override. Repeating the same case-insensitive section/key remains
blocked as a duplicate.

The NGIO mock deliberately supplies an unrelated build-context `revision`
without a cursor on its first filename search. Passing requires the host to
discard that untrusted pagination token, complete the real native search, and
never surface `native-failed`. Unit coverage separately proves that a genuinely
stale read-only continuation restarts from the first page once, while write
operations cannot use that recovery.

Core regression coverage also pre-creates the same NGIO virtual path in
`Fluxora AI Overrides`, then searches through the original mod-specific path.
Passing requires the filename search to return the effective managed winner,
apply two distinct INI keys atomically, preserve the source file and restore the
previous managed file on rollback.

The production-shape NGIO regression creates the same virtual path in the
source mod, `Fluxora AI Overrides`, and Overwrite, making Overwrite the
effective winner exactly as in the observed build. Passing requires
`directMutationEligible=true`, both shadowed owners in `conflictingOwners`, no
managed/source-mod writes, two verified INI postconditions in one atomic file
change, and exact restoration of all three previous byte sequences on rollback.
Exact text patches and file creation in Overwrite remain rejected.

### Gateway

The source contract test verifies protocol v1/v2 compatibility, the v2 single
model and three-method allowlists, raw request-body forwarding, 64 MiB bound,
120-second timeout, and streamed upstream responses/errors. A release check
also makes authenticated live v2 `status` and `getModel` calls with the current
publishable client key; the expected model limits are 1,048,576 input and
65,536 output tokens.

JWT verification remains deployment configuration and must be confirmed on the
deployed function, not inferred only from TypeScript source.

### Component and E2E

`ai-single-agent-panel.test.tsx` verifies exact context display, sources, one
Undo per response, file diff statistics, 616px/56px fixed panel tokens, no
resize handle, no message author/time metadata, and no model/routing/subagent
UI. Titlebar component tests require AI between Refresh and Settings and absent
outside build-scoped routes; reducer tests restore unavailable/conflict state by
independent run id. `e2e/ai-chat.spec.ts` uses
the natural polite Russian Community Shaders action and requires a verified
change set rather than instructional prose. It verifies the managed override
path, persisted read-only red/green diff preview, explicit full-editor handoff,
the custom reveal-in-file-manager context menu, run Undo, inverse-merge
preservation, persisted Undo after restart, conflict/no-data-loss behavior,
1100x700 and maximized layout, and that
an action response without a change set or verified execution effect is shown as blocked. Playwright checks honest
blocked/recovery/verification events before the final response. It also covers
selected-build-only access, a real
persistence reload, isolated empty new tab, live tool event, sources,
legacy-state migration, unrelated-setting preservation, and cancellation.

## Required Release Commands

```powershell
cd C:\Fluxora\frontend-tauri
npm run typecheck
npm test
npm run test:ai-gate
npm run build:frontend
node node_modules/@playwright/test/cli.js test e2e/ai-chat.spec.ts

cd C:\Fluxora\frontend-tauri\src-tauri
cargo test --all-targets
cargo test --features native-ai-integration-fixture --test ai_task_native_integration -- --nocapture
# Explicit opt-in only; performs real Gemini requests on a temporary build. The
# evidence-first case must either verify and roll back a managed override or
# return needs-input after real search/read with a settings-specific question:
$env:FLUXORA_AI_LIVE_PROVIDER_SMOKE = '1'
cargo test --release --features native-ai-integration-fixture --test ai_task_live_provider_smoke -- --nocapture
$env:FLUXORA_AI_LIVE_PROVIDER_SMOKE = $null

cd C:\Fluxora
ctest --test-dir build/backend -C Release --output-on-failure -R "^(BuildFileWorkspaceServiceTests\\.|FluxoraBuildFilesBridgeProtocol$|FluxoraCoreApiTests\\.BuildFilesAdapter)"
.\Build.ps1 -Configuration Release
graphify update .
```

The release is not accepted if any command fails, the live managed gateway is
unavailable, or the approved `output-installer/FluxoraSetup.exe` is missing.
