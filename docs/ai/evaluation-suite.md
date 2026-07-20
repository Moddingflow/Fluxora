# Fluxora AI Evaluation Suite

Status: current single-agent release gate, 2026-07-20.

## Purpose

The gate verifies the shipped Fluxora AI contract: one Gemini model, isolated
build-scoped tabs, an authoritative evidence coordinator, action-wide typed
capabilities with read-only answers, safe complete file discovery, native verified reversible actions,
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
- `tests/ai-gateway-v2.test.ts`.

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
- cancellation targets one operation and never terminates the shared sidecar.

### Gemini host and context

Rust host tests verify:

- one provider/model, the full typed contract from the first action round, and
  read-only functions for answers;
- simultaneous `google_search` and local function declarations;
- function-call id and thought-signature preservation;
- 64-round, 128-call, ten-minute emergency guards;
- two recoveries per error cause; recovery errors do not consume stagnation,
  while three semantically repeated successful results stop execution;
- 89.9% does not compress and exactly 90% does;
- the documented 943,718-token fallback threshold;
- repeated compression advances only across newly eligible history;
- estimated context usage is labelled estimated;
- an oversized current turn returns `ai.context.current-turn-too-large`;
- provider errors retain their real stage and retryability.
- polite Russian, English, and German action detection while instructional
  questions remain `answer`, plus all four provider routes;
- `high` thinking for file actions and diagnostics, `medium` for ordinary chat
  and summary compression, `temperature: 1.0`, hidden thought text, and
  preserved thought signatures;
- exact invalid-field feedback, two bounded correction retries, successful-only
  read-only caching, default `build` search scope, preserved explicit scopes,
  and premature-final recovery;
- `ANY` for unfinished actions, `AUTO` for answers/reads and `NONE` for the
  final report;
- `tool-completed` only for `ok=true`, with separate `tool-blocked`,
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
read/write races, read-only Game/Downloads/Overwrite scopes, the 16-file and
2-MiB batch limits, one mutation per file, atomic failure, managed overrides,
reread verification, diff, and rollback.

The feature-gated native integration fixture runs the real
`fluxora-ai-host` against a localhost mock of the managed Gemini transport. It
first tries to finish with manual-edit advice. The host rejects that premature
completion, then traces search, two distinct bounded read ranges, text search,
JSON query, recipe inspection, staging and commit. The first file search omits
`scope`, so the real default-to-`build` path is exercised with this Russian request:

`Можешь в Community Shaders сделать так, чтобы Menu.ToggleKey был PageDown?`

It places the real Community Shaders JSON beside
`EternalFlamesCandles_SWAP.ini` and a weak JSON-name match. Passing requires
that the broker finds the real target, stages and commits exactly one
`ToggleKey=34`
managed override, leaves both source and distractors unchanged, returns a
verified diff, puts `Fluxora AI Overrides` last and enabled, and removes the
override on rollback.

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

`ai-single-agent-panel.test.tsx` verifies exact context display, sources, file
changes and Undo, with no model/routing/subagent UI. `e2e/ai-chat.spec.ts` uses
the natural polite Russian Community Shaders action and requires a verified
change set rather than instructional prose. It verifies the managed override
path, verified diff, file/run Undo, and that an action response without a change
set or verified execution effect is shown as blocked. Playwright checks honest
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
# Explicit opt-in only; performs a real Gemini request and local reversible file mutation:
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
