# Fluxora AI Architecture

Status: current single-agent architecture, 2026-07-22.

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

## Local Voice Input V1

Voice input is an optional local input method inside the selected build's AI
panel. It does not add a provider, model picker, agent, tool, or orchestration
path. The renderer captures mono 16 kHz `Float32` PCM with an `AudioWorklet`,
keeps it only in memory, and sends the bounded byte view through Tauri raw IPC.
The typed facade exposes `prepareVoice`, `armMicrophoneCapture`,
`transcribeVoice`, `resetMicrophonePermission`,
`cancelVoiceTranscription`, and `openMicrophonePrivacySettings`; the renderer
has no filesystem or process access. Fluxora's localized EN/RU/DE consent
dialog runs before model preparation or capture. Allow is stored locally until
Settings > Privacy resets it; Deny is not stored. After Allow, model preparation
starts concurrently with microphone opening and never delays active recording.

The Rust shell validates every raw payload and metadata header, owns separate
Vulkan and CPU speech-host lifecycles, permits one CPU crash restart, and writes
only content-free speech lifecycle records to the separate speech log. It first
uses `FluxoraSpeechHostVulkan` for Vulkan Whisper offload with CPU Silero VAD.
Missing runtime/device, startup, handshake, or GPU initialization automatically
falls back to dependency-light `FluxoraSpeechHost` with the same `operationId`
and absolute deadline; cancellation never launches fallback. Both hosts use the
bundled `small-q5_1`, standalone Silero VAD 6.2.0, deterministic Greedy 1
decoding, bounded per-segment token generation, temperature 0, no translation
or timestamps, and 1..8 threads clamped to logical cores minus one. The renderer
always sends `auto`; Whisper detects the primary language and the typed result
contains `detectedLanguage` plus `backend`. The EN/RU/DE UI locale remains only
for consent and errors.

Mixed-language recognition is local and context-adaptive. The renderer derives
a bounded list of Latin-bearing terms from the selected build's mod names, the
active draft, and the four most recent chat messages. The Rust shell validates
and percent-decodes that list before handing it to the speech host. Whisper's
first pass remains an unprompted automatic-language transcription. If that raw
text is phonetically close to one of the bounded build/chat terms, the host may
run one additional pass with at most four matching terms as a short initial
prompt. The prompted text replaces the neutral result only when it contains
more of those exact contextual terms, so Russian or German prose is not forced
into English. After decoding, a high-confidence phonetic span may be restored
to the exact matching technical term while the surrounding prose is left
untouched. Explicit compatibility languages still use one pass. Neither pass
enables translation.

Silero's first-to-last speech window removes outer silence before inference.
Short recordings use one strictly bounded decoder segment and a duration-sized
encoder context instead of paying for Whisper's default 30-second window. The
versioned glossary remains a deterministic whole-term postprocessor: official
names, common technical options, and abbreviations normalize in every language;
ordinary terms use language-specific EN/RU/DE canonicals; and other languages
receive proper-name normalization only. Exact context terms also restore their
original spelling and casing after decoding.

On Windows, Rust resets any saved WebView2 microphone decision to `DEFAULT` at
startup and handles `PermissionRequested` without storing a profile decision.
Only the normalized `http://tauri.localhost` origin can consume one armed
permission within ten seconds; every other microphone request is denied and
other WebView permission kinds are left untouched. Initialization and reset
fail closed.

Audio is capped at five minutes and is never written to disk, placed in logs,
included in support data, or sent to Gemini. Context terms stay in memory and
are sent only to Fluxora's local speech process; they are never logged or sent
to a provider. Stop adds the local transcript to
the existing draft and completes the voice operation. Send passes the same
voice `operationId` into the normal single Gemini run; only that text follows
the existing online AI privacy contract. Closing/collapsing/changing the AI tab,
Escape, error, or unmount stops tracks, disconnects the worklet, closes the
audio context, clears buffers, and cancels active native transcription.
Short transcription requests have a 15-second native safety deadline; longer
requests scale with audio duration up to a five-minute ceiling. A separate
renderer watchdog starts at 20 seconds, cancels the native process, and returns
a typed retryable error even if native cleanup becomes unresponsive. Users can
also cancel while transcription is active. Immediately after Stop the visible
timer, waveform, and text are replaced by a fixed cancellable spinner; only a
localized screen-reader status remains. Host reset waiting is bounded to five
seconds. Speech logs include backend, threads, model-load/VAD/inference/total
times, real-time factor, and whether the bounded adaptive pass ran, but never
audio, transcript, detected language, context terms, or glossary content.

## Authoritative Execution Coordinator

`AiExecutionCoordinator` is a focused module outside `lib.rs`. Every build task
starts with the host-owned `local.execution.declare_goal` contract in required
function-calling mode. The validated modes are `answer`, `inspect`, and
`repair`; a repair records `explicit`, `implicit`, or `continuation` origin.
An `answer` or `inspect` declaration must also return an exact bounded quote
from the current user dialogue as `readOnlyEvidence`. The host rejects a
missing or invented quote, retries the declaration once, and never lets an
unsupported read-only classification silently downgrade a requested change.
Answer and inspect receive read-only tools. An implicit repair receives only
read-only and reversible capabilities, while explicit irreversible work keeps
its existing exact confirmation. The model can choose a declared tool, but it
cannot decide whether work succeeded. Inferred domain and phase
remain diagnostics rather than authority. The coordinator keeps the
authoritative goal, actual domain selected by the tool, monotonic phase,
semantic evidence set, recovery count, pending question, terminal reason and
native verified effects outside Gemini history. The repair cycle is
`declare goal -> inspect/search -> optional research -> stage -> commit ->
native reread -> completed | needs-input | exact blocker`.

The response adds `execution` with `goalId`, compatible `kind`, `mode`, `origin`,
`requestedOutcome`, `domain`, `phase`, `state`, `verifiedEffects`,
`pendingQuestion` and `terminalReason`. Each tool
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

The first provider round declares only host-owned
`local.execution.declare_goal`, uses function-calling mode `ANY`, and analyzes
the complete current dialogue plus any unfinished active goal. Invalid output
gets one matched correction round and then exact `intent-contract-invalid`;
there is no keyword fallback. Subsequent typed rounds are filtered by the
validated risk. Host-owned `local.execution.research_web` can request a separate
web-only `google_search` round of the same Gemini model when local evidence does
not establish semantics. Local declarations and Search stay in separate
`generateContent` requests. Returned grounding/citations are appended as
untrusted evidence and never grant write authority.

The goal contract maps `repair` to compatible `kind=action` and
`local-required`; `answer` and `inspect` map to compatible `kind=answer` with
read-only authority. A natural description of an unwanted build state is an
implicit repair unless the user explicitly limits the request to explanation or
diagnosis. Tool-session schema `fluxora.ai.tool-session.v3` carries mode, origin,
requested outcome, allowed risk, and continuation state through every round.

Every Gemini 3 request uses `temperature: 1.0`. Goal declaration always uses
`thinkingConfig.thinkingLevel=high`; validated repair and inspect rounds remain
high, while answer and continuation-summary compression use medium. Thought
summaries are not requested or rendered. Text parts marked as thoughts are
excluded from user-visible answers, while opaque thought signatures remain
unchanged in provider history for later function-call turns. The selected
level is exposed only as bounded internal diagnostics and safe log metadata.

`FluxoraAIHost` owns one explicit provider-name registry. The public/native
tool contract keeps names such as `local.files.search`, while Gemini receives
only registered names matching `[A-Za-z_][A-Za-z0-9_]{0,63}`, such as
`local_files_search`. Incoming calls are canonicalized only when they exactly
match either name of a registry entry: the provider-safe name or its internal
dotted name. This tolerates Gemini following a model-facing internal label
without admitting fuzzy, suffixed, or invented tool names. Model-generated
instructions use the provider-safe registry name. Before Tauri/C++ dispatch,
the call is translated to its internal name. The matching `functionResponse`
uses the exact name and call id from the original call, and the original model
content (including an opaque thought signature) remains unchanged in provider
history.

One function response remains bounded to 64 KiB. A larger redacted tool result
is no longer rejected: the AI host retains up to 64 MiB of serialized JSON in
the current in-memory session, returns the first lossless bounded chunk with an
opaque `resultRef` and `nextOffset`, and serves later chunks through the
host-owned read-only `local.tool_result.read_page` tool. Continuation calls do
not repeat the native operation and are never forwarded to the Tauri/C++
bridge; mixed turns still forward their ordinary typed-tool siblings and merge
one correctly matched response per Gemini call id. The stored result is removed
after its final page or when the tool session ends. If the per-session store is
exhausted, Gemini receives a small retryable tool result asking for a narrower
query, cursor, JSON pointer, or text window instead of a fatal session error.

Web and local-file content are untrusted data. Neither can change the validated
goal/risk, grant a capability,
approve a mutation, widen a root, manufacture a valid file reference, or cause
direct URL fetching. The model has no shell, PowerShell, command execution,
arbitrary process launch, or arbitrary URL tool.

`local.execution.request_input` is also host-owned and is never forwarded to
C++. It is phase-gated: the declaration is absent during `discover` and becomes
available only after a successful native read-only result adds verifiable build
evidence. Web research alone cannot unlock it. A hallucinated early call gets a
matched `evidence-required` function response and the same tool loop continues;
after the existing two-correction budget is exhausted, the run ends with exact
`request-input-evidence-required` blocking rather than `needs-input`. Accepted
calls may ask one bounded concrete question only about verified candidate files,
parameters, or values; they must never ask for a path or manual editing. Native
`ambiguous`, `conflict`, and `needs-input` outcomes remain authoritative and may
immediately surface their concrete question without waiting for the model-owned
call. Each tab persists its own optional `activeGoal`; a short answer is
revalidated as `continuation` and must reuse the same `goalId` and original risk
ceiling. Verified completion, cancellation, and terminal blocking clear it.
Safe diagnostics record only accepted/rejected decision, phase, evidence count,
and reason code, never prompts, config contents, paths, or user questions.

Function-call model parts, including their call identifiers and thought
signatures, remain in provider history before matching function responses are
appended. The loop is sequential. An unfinished action uses Gemini
function-calling mode `ANY`; answers and reads use `AUTO`; `NONE` is used only
for the final report after native verification or an exact blocker.

For a build request with a file workspace, failure to begin the tool session is
terminal for that run. Tauri does not issue a second chat-only `chat.respond`
request. Chat-only dispatch remains available only when the request has no file
workspace. The user-visible `tool-started/file-search` event is emitted only for
a real, non-empty `state=tool-calls` result whose first actual tool is a search
tool. `final` and `fallback` never synthesize a search event. Started messages
use present-progress wording and the event's real creation time; successful
result events use completed-action wording and carry the actual internal tool
name.

Paged discovery and search revisions are native index revisions, not build or
chat revisions. When Gemini starts `local.files.search` or `local.text.search`
without a cursor, the host clears any model-supplied revision before cache-key
generation and native dispatch. A real continuation preserves its paired
revision and cursor. If a read-only `buildFiles.discover`, `buildFiles.search`,
or `buildFiles.searchText` continuation still returns `stale-revision`, Tauri
restarts that same query once from its first page with the same `operationId`.
Mutations are never retried by this recovery. A second failure remains the exact
`stale-revision` blocker instead of being collapsed to `native-failed`.

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
Repeated native validation errors and premature model-owned input requests use
bounded correction and terminate with deterministic blockers. Every successful tool
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

For a validated repair, discovery, bounded reads, permitted staging, commit and
supported domain capabilities up to the goal's risk ceiling are declared from
the first execution tool round. The
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
profile layers, game data, and bounded Downloads scope. Game and Downloads are
read-only; every source-mod patch or create is materialized only in the managed
`Fluxora AI Overrides` layer. An effective Overwrite config may be changed in
place only through structured INI or JSON operations, with the same atomic
checkpoint, reread verification and rollback contract. The core does not scan
the machine. It refuses traversal outside a root, reparse/symlink escapes,
protected Fluxora state, credentials, binary or unsupported formats, source or
executable content, and oversized reads.

File metadata includes core-owned `managedOverrideEligible` and
`directMutationEligible` flags. The AI host records opaque file and parent refs
for a unique mod-owned managed target; a directly mutable Overwrite result grants
only its file ref. Build search groups all physical owners by normalized virtual
path before pagination, resolves the current profile/Overwrite winner, returns
only that winner's opaque ref, and lists the other owners in
`conflictingOwners`. A filename query and a query containing the shadowed source
owner path therefore resolve to the same effective `fileRef`. Several returned
entries mean several distinct virtual paths, not several physical copies of one
file. When several distinct targets remain, reading one candidate triggers a
host-owned exact search using the native `relativePath`; staging is unlocked
only when that search returns the same single eligible `fileRef`.
`buildFiles.apply` repeats the unique-winner, revision, hash, expected-value,
format and destination-policy checks before materializing a change.

Search indexes the complete allowed scope and returns real pages with
`totalMatches`, `nextCursor`, `complete`, `indexedCount`, and `revision`.
Cursors are stable for one revision and cannot replay page one as a later page.
Content search checks all eligible bounded text files, reports progress, and
cooperatively observes cancellation.

Candidate resolution is core-owned and returns `unique`, `ambiguous`, or
`not-found`. Physical conflicts at one virtual path are resolved before those
candidate states and before pagination. A write requires a unique effective VFS winner, current revision,
a valid opaque `fileRef`, a matching prior-read hash, the expected old value,
and a supported semantic mutation. Model confidence or arguments cannot bypass
these checks.

For every build-scoped result, `buildFiles.search` resolves the matched source
path to the current effective VFS winner before issuing the opaque `fileRef`.
This includes existing `Fluxora AI Overrides` and Overwrite files, so a
mod-specific search cannot mislabel a shadowed source file as writable. If
Overwrite is the effective winner, the result is marked only for direct
structured-config mutation. The broker authorizes only the core-returned winner
ref. It reports `effective-winner-ref-mismatch`, `mutation-ineligible`,
`multiple-virtual-targets`, or `unproven-file-ref` instead of collapsing these
states into `validation-failed`; none permits a manual-edit fallback.

Staging is side-effect free. One commit accepts at most 16 mutations across at
most 16 distinct files and 2 MiB of changed text. A file normally has one
mutation target; one INI file may contain multiple staged mutations only when
their case-insensitive section/key targets are distinct. C++ preflights the entire batch,
creates checkpoints, applies it atomically, rolls the batch back on any write or
verification failure, rereads every target, and returns core-generated diffs
plus rollback state. Exact text patch/create and supported INI/JSON semantic
operations share the same native containment, revision, hash, encoding and
postcondition guards. The source mod is unchanged. Rollback checks each
response-owned `runId` independently. If the target still equals that run's
`after` snapshot, rollback is exact. Otherwise C++ performs an inverse three-way
merge with `base=after`, `ours=current`, and `theirs=before`, preserving newer
non-overlapping edits and refusing overlapping logical lines, encoding/path
changes, or ambiguity without writing any file. A created file is removed only
while it still matches `after`. Every run is preflighted as one transaction; one
conflict leaves all current files untouched, and a later write failure restores
the original current bytes of every file already touched.

Rollback checkpoints are a separate C++ service under the local Fluxora app
root. Per-file `before` and `after` snapshots are SHA-256 content-addressed
blobs, deduplicated across runs, and Zstandard-compressed only when the stored
payload becomes smaller. Versioned manifests contain verified build ownership
and contained relative paths, never arbitrary absolute targets. Loading checks
manifest version, build/chat ownership, path containment, hashes, encoding, and
blob integrity. Corrupt, expired, incompatible, or incomplete data is
unavailable and cannot authorize a write. A run is admitted before its file
mutation or the mutation does not start. Storage is bounded to 256 MiB per chat
and 1 GiB globally; cleanup garbage-collects unreferenced blobs and then expires
oldest available runs whole, first in the overflowing chat and then globally.
Closing a chat removes that chat's checkpoints, and deleting a build removes
every checkpoint owned by that build.
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
stagnation counts, request-input accepted/rejected decision and reason code,
revision, result counts, and terminal reason. They must not include
prompt text, file contents, diff bodies, credentials, provider keys, absolute
paths, or provider response bodies. Failed provider HTTP bodies are not read
into desktop error payloads.

The right-side AI panel is a fixed `616px` design token (`56px` collapsed); it
has no renderer width state, resize separator, or direct filesystem access. Its
only build-scoped entry is the main titlebar button between Refresh and Settings,
hidden on Home, Settings, create/transfer flows, and secondary windows. The body uses named grid areas `tabs`, `context`, optional
`diagnostic`, `messages`, and `input`. Messages own the only flexible row; the
single input surface is the final row. Each assistant response owns at most one
neutral managed-change block and one run-level Undo. File rows show the relative
path and `+N`/`-N` statistics and open a persisted read-only diff preview at the
first hunk without reopening the ended native chat session. Red removed lines
and green added lines use the core-generated verified hunks. A separate explicit
action opens the managed mod file in the full editor. Right-click replaces the
WebView context menu with the standard Fluxora row menu and can reveal the file
in the platform file manager. Per-file rollback remains protocol-compatible but
is not exposed in chat.
`getFileRollbackStates(chatId, operationId)` restores `available`, `rolled-back`,
`conflict`, or `unavailable` after reload, rollback, and storage eviction.

## Privacy And Release

Sending a chat may transfer the prompt, the selected tab history or summary,
system/skill/tool declarations, grounding requests, and explicitly requested
bounded local fragments to Supabase and Google/Gemini. Tabs remain locally
stored until the user closes/clears them or removes Fluxora application data.
Closing a tab removes it from local AI session storage; provider-side handling
is governed by the applicable provider terms.

The rollback store never uploads checkpoint blobs, file bodies, or diff bodies.
It retains local snapshots only while their chat/build lifecycle and the
256 MiB per-chat / 1 GiB global bounds permit. Logs record operation, chat/run,
exact versus inverse mode, file count, conflict reason, and eviction only; they
exclude checkpoint content and diffs.

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
