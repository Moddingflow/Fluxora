# Fluxora AI Architecture

Status: current single-agent architecture, 2026-07-20.

## Product Contract

Fluxora AI is one Gemini assistant for the currently selected build. The
product exposes one provider (`gemini`) and one model
(`gemini-3.1-flash-lite`). There is no model picker, routing preset, worker
fan-out, subagent scheduler, autonomous-job queue, or offline answer fallback.
The local fixture provider is test-only and is not shipped in the installer.

Users may create any number of chat tabs inside a build. Each tab owns its own
messages, provider summary, context cursor, intermediate events, runs, and
active operation. Tabs are persisted locally by build scope. Starting or
finishing a run in one tab cannot alter another tab's messages, progress, or
context. Closing a running tab requests cancellation for that operation only;
the shared AI host is not terminated.

The migration to this contract removes all keys under the former
`fluxora.ai.*` state once, then creates `fluxora.ai.single-agent.sessions.v1`.
Unrelated application settings, builds, and OS-stored credentials are not
removed. A run that was queued or streaming when Fluxora stopped is recovered
as stopped on the next launch.

AI is opened from the selected build header. It is intentionally absent from
the global title bar and from builds that are not selected.

## Ownership Boundaries

- The Tauri renderer owns tabs, chat presentation, local persistence, context
  display, source links, real tool progress, diffs, and Undo actions.
- The typed `window.fluxora.ai` facade owns the renderer/native boundary. The
  renderer has no raw filesystem, shell, Node.js, or scattered `invoke` access.
- The Rust shell owns sidecar lifecycle, the managed-provider transport,
  per-operation cancellation, event validation/redaction, dirty-editor guards,
  opaque entity references, and sequential dispatch of typed capability tools.
- `FluxoraAIHost` owns the single Gemini conversation loop, model metadata,
  token counting, summarization, grounding metadata, and function-call history.
- The C++ `BuildFileWorkspaceService` owns all path resolution, indexing,
  effective-VFS decisions, parsing, validation, mutation, verification, and
  rollback. UI or model output never becomes filesystem authority.

Every user-triggered run and every native tool call carries the same
`operationId` through renderer, Rust, AI host, bridge host, C++ core, and logs.

## Authoritative Execution Coordinator

`AiExecutionCoordinator` is a focused module outside `lib.rs`. An explicit
`action` receives the complete supported typed tool set from its first round;
an `answer` receives read-only tools only. The model can choose a declared
tool, but it cannot decide whether work succeeded. Inferred domain and phase
remain diagnostics rather than authority. The coordinator keeps the
authoritative goal, actual domain selected by the tool, monotonic phase,
semantic evidence set, recovery count, pending question, terminal reason and
native verified effects outside Gemini history. The cycle is
`goal -> execute -> native verify -> completed | exact blocker`.

The response adds `execution` with `goalId`, `kind`, `domain`, `phase`,
`state`, `verifiedEffects`, `pendingQuestion` and `terminalReason`. Each tool
result also carries internal `fluxora.ai.tool-outcome.v1` status, exact error
code, new evidence, recovery directive, compensation token and the same
`operationId`. Existing `fileChangeSet` data remains additive and compatible.

One Rust tool-contract registry covers build files, mods, plugins, downloads,
installs, profiles, settings, projects and FluxPack. Every declaration binds
its exact name and argument schema to an operation, domain, risk, verification
method and compensation or exact confirmation. Capability adapters implement
those contracts without name-pattern heuristics.
Entity adapters expose `modRef`, `pluginRef`, `downloadRef` and `operationRef`;
native ids and absolute paths remain inside Rust/native code. Current
reversible mutations include enabled mod state, plugin order, download control,
completed install removal, profile creation and application language. A
verified effect may expose an opaque compensation token; the renderer's Undo
calls the typed Rust command, applies the stored native inverse and rereads the
postcondition before marking it rolled back. Install cancellation is terminal
and deliberately has no fictitious restore token. Project
creation and irreversible FluxPack install stop for the exact native
selection/confirmation that the model cannot supply.

## Provider And Managed Gateway

The host sends online traffic only for `gemini-3.1-flash-lite`. It first checks
the configured managed provider and obtains model metadata through `getModel`.
Verified `inputTokenLimit` and `outputTokenLimit` values are cached; 1,048,576
input and 65,536 output tokens are conservative fallbacks when metadata cannot
be fetched.

Fluxora-managed traffic uses the authenticated Supabase Edge Function
`fluxora-ai-gemini`. The server-side Gemini key never reaches the renderer or
desktop host. The desktop uses a public Supabase publishable key only to invoke
the function; service-role and provider secrets remain server-side.

Gateway protocol v2:

- accepts only `gemini-3.1-flash-lite`;
- allowlists `generateContent`, `countTokens`, and `getModel`;
- forwards the bounded raw JSON request body without decoding and rebuilding it;
- accepts at most 64 MiB of provider request data;
- streams the provider response and provider error body back to the client;
- enforces a 120-second upstream timeout;
- uses no-store response headers and does not write prompts or build context to
  application tables.

Protocol v1 remains temporarily accepted for rollout compatibility. The Edge
Function must be deployed before a desktop client that selects v2.

## Gemini Conversation Loop

Chat-only generation requests declare model-native `google_search`; typed
rounds declare the full supported contract for an `action` and its read-only
subset for an `answer`. Phase and inferred domain never remove a declared
capability. These tool families stay in separate `generateContent` requests because that endpoint
rejects the combined declaration, while the single sequential conversation
loop still owns both routes. There is no retry that silently removes a rejected
tool schema. Grounding metadata is normalized to source citations shown beside
the answer.

Before dispatch the host classifies the latest multilingual request as
`action` or `answer` and records one explicit route: `local-required`,
`local-auto`, `web-search`, or `none`. An explicit file action is
`local-required`; it cannot be downgraded to advice or web research. Tool
session schema `fluxora.ai.tool-session.v3` carries this classification through
every round.

Every Gemini 3 request uses `temperature: 1.0`. The host selects
`thinkingConfig.thinkingLevel=high` for file actions and diagnostic prompts,
and `medium` for ordinary chat and continuation-summary compression. Thought
summaries are not requested or rendered. Text parts marked as thoughts are
excluded from user-visible answers, while opaque thought signatures remain
unchanged in provider history for later function-call turns. The selected
level is exposed only as bounded internal diagnostics and safe log metadata.

`FluxoraAIHost` owns one explicit provider-name registry. The public/native
tool contract keeps names such as `local.files.search`, while Gemini receives
only registered names matching `[A-Za-z_][A-Za-z0-9_]{0,63}`, such as
`local_files_search`. Incoming calls are translated back to the internal name
before Tauri/C++ dispatch. The matching `functionResponse` uses the original
provider name and call id, and the original model content (including an opaque
thought signature) remains unchanged in provider history.

Web and local-file content are untrusted data. Neither can grant a capability,
approve a mutation, widen a root, manufacture a valid file reference, or cause
direct URL fetching. The model has no shell, PowerShell, command execution,
arbitrary process launch, or arbitrary URL tool.

Function-call model parts, including their call identifiers and thought
signatures, remain in provider history before matching function responses are
appended. The loop is sequential. An unfinished action uses Gemini
function-calling mode `ANY`; answers and reads use `AUTO`; `NONE` is used only
for the final report after native verification or an exact blocker.

For a build request with a file workspace, failure to begin the tool session is
terminal for that run. Tauri does not issue a second chat-only `chat.respond`
request. Chat-only dispatch remains available only when the request has no file
workspace. The user-visible `file-search` started event is emitted only after
Gemini accepts the function declarations and the host returns an accepted tool
session or final answer.

Before the first provider tool round, the Rust shell idempotently opens the
native build-file chat session. `session-inactive` recovery remains available
only for a real bridge restart or lost native session.

The functional eight-round cap has been removed. Emergency guards are:

- explicit cancellation for the target operation;
- ten minutes for one desktop request;
- 64 provider rounds;
- 128 total tool calls;
- at most two recoveries for the same cause;
- at most three consecutive tool results without new evidence;
- repeated identical call/result detection.

Tool arguments are validated against the same typed registry that produces the
Gemini declarations. An invalid field is returned as a precise function result
with field, code, and correction hint; Gemini gets at most two correction
retries. Missing or blank `scope` on `local.files.search` and
`local.text.search` is normalized to `build` before validation, cache-key
creation, and native dispatch; explicit `game` and `downloads` values remain
unchanged. Exact duplicate read-only calls are served from a per-run cache only
after the original call succeeds. Failed native results are never cached.
Repeated native validation errors share the bounded correction/no-progress
budget and terminate with a deterministic blocker. Every successful tool
result is reduced to a stable semantic fingerprint after volatile ids and
timestamps are removed. New search pages, bounded read ranges, JSON/INI values,
recipe inspection, native state changes, staging and verification therefore
count as progress. Three semantically repeated successful results terminate as
compatible code `ai.tool.no-new-evidence` at the `tool-loop` stage. Errors use
their own recovery budget and never increment the stagnation counter. Session loss and
expired refs rediscover, stale revisions reread, invalid scope is normalized,
ambiguity/conflict asks one concrete question, and path escape/protected access
is terminal. An action that returns prose before a verified postcondition gets
at most two corrective turns and then ends as a concrete blocker.

Before an emergency tool-loop stop, the host performs one final no-tools turn
so Gemini can report the exact blocker or ask one concrete question. Errors are
not replaced with a fake local provider response.

## Context Accounting And Compression

The displayed metric is the prepared provider input, for example
`Использовано контекста: 2 107 / 1 048 576 токенов`. The percentage denominator
is the model input limit. The output limit is descriptive metadata, not part of
that percentage.

The host calls `countTokens` with the actual prepared request: system and safety
instructions, automatically selected skill text, tool declarations, current
summary, retained messages, function history, and current request. If the
provider counter is unavailable, the same shape is estimated and marked
`estimated`; an estimate is never presented as exact.

At 90% of the input limit the same Gemini model creates or updates one
structured summary for the old eligible history. Goals, decisions, verified
facts, opaque file refs, operation/rollback facts, and unresolved questions are
retained. Recent messages and the current turn remain verbatim. The host then
runs `countTokens` again before generation.

`providerHistoryStartIndex` advances only across the newly summarized segment.
A later compression updates the existing summary with newly eligible messages;
it does not repeatedly summarize messages already represented by that summary.
The renderer retains full history for display. If the current request and
required instructions still exceed the model window after compression, the
host returns a typed context-size error instead of silently dropping content.

## Typed Capability Tools

For an explicit action, discovery, bounded reads, staging, commit and all
supported domain capabilities are declared from the first tool round. The
coordinator still advances monotonically through discovery, inspection,
staging, verification and report phases for diagnostics. Supported file
operations are:

- filename/path/extension/word search;
- directory listing and metadata/stat;
- bounded text reads and fixed-string content search;
- INI and JSON/JSONC queries;
- generic JSON/JSONC pointer preflight and value normalization;
- staged exact text patch/create and staged INI/JSON mutations;
- one separate atomic `local.files.commit` call;
- rollback of a verified committed change.

Only roots registered for the selected build may be searched: build/mods,
profile layers, game data, and bounded Downloads scope. Game, Downloads, and
Overwrite are read-only; every mod patch or create is materialized only in the
managed `Fluxora AI Overrides` layer. The core does not scan
the machine. It refuses traversal outside a root, reparse/symlink escapes,
protected Fluxora state, credentials, binary or unsupported formats, source or
executable content, and oversized reads.

Search indexes the complete allowed scope and returns real pages with
`totalMatches`, `nextCursor`, `complete`, `indexedCount`, and `revision`.
Cursors are stable for one revision and cannot replay page one as a later page.
Content search checks all eligible bounded text files, reports progress, and
cooperatively observes cancellation.

Candidate resolution is core-owned and returns `unique`, `ambiguous`, or
`not-found`. A write requires a unique effective VFS winner, current revision,
a valid opaque `fileRef`, a matching prior-read hash, the expected old value,
and a supported semantic mutation. Model confidence or arguments cannot bypass
these checks.

Staging is side-effect free. One commit accepts at most 16 distinct files, one
mutation per file, and 2 MiB of changed text. C++ preflights the entire batch,
creates checkpoints, applies it atomically, rolls the batch back on any write or
verification failure, rereads every target, and returns core-generated diffs
plus rollback state. Exact text patch/create and supported INI/JSON semantic
operations share the same native containment, revision, hash, encoding and
postcondition guards. The source mod is unchanged. Rollback checks each
post-write hash and refuses to overwrite later user or external edits.
Ambiguity, key conflicts, unsupported formats, stale revisions, dirty editors,
and external changes fail closed without mutation and produce one concrete
question or typed blocker. The built-in Community Shaders recipe maps PageDown
to key code `34` at `/Menu/ToggleKey` in `SettingsUser.json`.

## Events, Errors, And Logs

The renderer receives real `fluxora.ai.intermediate-event.v1` events for the
current tool, files inspected, match counts, write, reread, and verification.
Events are correlated to chat, run, and operation; a background tab cannot
append events to the active tab.

Errors use `code`, `category`, `stage`, `retryable`, `userMessage`, and
`debugId`. Provider HTTP 400 with file declarations is
`ai.provider.invalid-tool-request` at `tool-schema`; transport failures, rate
limits, managed-gateway failures, tool execution, tool-loop, context, and
verification remain distinct typed states. Managed-AI unavailable copy is used
only after a real status or transport failure. Normal UI shows the safe message
only; `code`, `stage`, and `debugId` are visible only in developer diagnostics.

`fluxora.ai.file-tool-diagnostics.v2` reports bounded metadata only:
task/routing, selected thinking level, outcome, validation retries, duplicate
calls, staged/verified counts, terminal reason, `nativeSessionPreopened`,
`newEvidenceCount`, `stagnantResultCount`, `phaseTransitions`, and legacy
aggregate counters. Every action requires `execution.state=completed` and a
non-empty `verifiedEffects`; only a file action additionally requires a native
`fileChangeSet`.

AI UI, host, bridge, core, operation, and crash logs remain separate. Logs may
include operation/chat ids, provider/model, selected thinking level, tool name,
round, phase, whether the result contributed a new fact, bounded evidence and
stagnation counts, revision, result counts, and terminal reason. They must not include
prompt text, file contents, diff bodies, credentials, provider keys, absolute
paths, or provider response bodies. Failed provider HTTP bodies are not read
into desktop error payloads.

The right-side AI panel body uses named grid areas `tabs`, `context`, optional
`diagnostic`, `messages`, and `input`. Messages own the only flexible row; the
single input surface is the final row and stays flush with the panel bottom at
supported viewport sizes.

## Privacy And Release

Sending a chat may transfer the prompt, the selected tab history or summary,
system/skill/tool declarations, grounding requests, and explicitly requested
bounded local fragments to Supabase and Google/Gemini. Tabs remain locally
stored until the user closes/clears them or removes Fluxora application data.
Closing a tab removes it from local AI session storage; provider-side handling
is governed by the applicable provider terms.

Bundled English, German, and Russian privacy/terms text describes the managed
gateway, Gemini/Search processing, selected local fragments, local tab
retention, managed overrides, and rollback. Owner/legal GDPR/DSGVO review and
localized in-product disclosure remain release gates; engineering text is not
legal advice.

The approved Windows distribution is only
`output-installer/FluxoraSetup.exe`. A release candidate must pass focused C++
tests, Rust unit/native fixture tests, Vitest and AI gate, Playwright AI smoke,
typecheck, the root Release build, live managed-gateway status/model probes, and
Graphify update.
