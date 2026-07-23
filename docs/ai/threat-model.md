# Fluxora AI Threat Model

Status: current single-agent design, 2026-07-22.

## Scope And Trust Boundaries

Protected assets are user files, source mods, managed overrides/checkpoints,
project/profile state, chat history, provider and Nexus credentials, the
server-side Gemini key, operation logs, and user control over network transfer
and mutation.

Trust boundaries:

1. User and untrusted chat/file/web content to the renderer.
2. Sandboxed renderer to the typed Tauri facade.
3. Rust shell/tool broker to the AI sidecar and native bridge.
4. Native bridge to C++ core and registered filesystem roots.
5. Desktop host to the Supabase Edge gateway.
6. Gateway to Google/Gemini and a separate web-only model-native Search round.

The model, model output, grounding results, local file contents, filenames, and
tool arguments are never trusted authorities.

## Threats And Mitigations

### Prompt injection expands capabilities

An instruction in chat, a local config, or a web page asks for shell access,
arbitrary URL access, secrets, new roots, or an unapproved mutation.

Mitigations:

- undeclared tools do not exist;
- there is no shell, process-launch, or direct URL-fetch declaration;
- tools use fixed schemas and opaque refs;
- the validated goal fixes the risk ceiling before local or web evidence is
  processed; evidence cannot replace or upgrade that goal;
- C++ independently enforces root, format, revision, hash, VFS, and mutation
  policy;
- Search/file content cannot mint refs or approval state.

### Goal misclassification or continuation escalates authority

A natural problem description is downgraded to advice, or a short answer after
clarification is treated as a fresh explicit request with broader authority.

Mitigations:

- every build task begins with required host-owned `declare_goal` using the
  complete current dialogue and any unfinished active goal;
- modes and origins are validated enums; invalid output gets one retry and then
  exact `intent-contract-invalid`, never a keyword fallback;
- an unwanted state is an implicit repair unless the user explicitly requests
  only explanation or diagnosis;
- answer/inspect must cite an exact bounded quote from the current user
  dialogue; absent or invented read-only evidence is an invalid goal contract;
- implicit repair is capped at reversible risk, and continuation reuses the
  same `goalId` and original risk ceiling;
- the renderer persists active goals per tab and clears them on verified
  completion, cancellation, or terminal blocking.

### Path traversal, symlink escape, or broad machine scan

A crafted path or reparse point attempts to escape the selected build roots.

Mitigations:

- the core registers only selected build/profile/game/download roots;
- every operation canonicalizes and revalidates containment;
- absolute paths from the model are rejected and reparse points are not
  followed;
- protected state, credentials, binaries, executables, source/scripts, and
  oversized files are denied.

### Wrong-file or stale-file mutation

The model selects a weak match, a config changes after reading, or an older
search revision is used to write.

Mitigations:

- resolution is `unique`, `ambiguous`, or `not-found`, not model confidence;
- writes require the current effective VFS winner and revision;
- opaque ref, prior-read hash, expected semantic value, and supported recipe
  are checked by C++;
- source-mod writes are redirected to the managed override, while an effective
  Overwrite winner accepts only structured INI/JSON mutation with checkpoint,
  reread postconditions, and rollback;
- ambiguity produces one question and no mutation;
- dirty-editor and external-edit races fail closed.

### Destructive or irreversible write

A tool overwrites a source mod, loses formatting, or rolls back over later work.

Mitigations:

- automatic writes are staged and limited to 16 mutations across at most 16
  distinct allowlisted files and 2 MiB of changed text; multiple mutations in
  one file are allowed only for distinct case-insensitive INI section/key targets;
- the entire batch is preflighted and committed atomically, with rollback on a
  write or verification failure;
- source mods remain unchanged and the managed override is used;
- encoding/BOM/EOL are preserved where supported;
- checkpoint, reread, semantic verification, diff, and post-write hash are
  mandatory;
- Undo refuses a changed post-write hash.

### False completion without a native postcondition

The model searches lazily, repeats an invalid empty query, returns instructions
instead of acting, or claims success without a native write.

Mitigations:

- validated `repair` forces `local-required` routing and cannot be downgraded by
  provider prose;
- goal/risk validation and argument validation are host-owned; answer/inspect
  are read-only, implicit repair is reversible-only, and phase/domain inference
  never grants authority;
- invalid calls receive exact field/code/hint feedback and at most two retries;
- duplicate read-only calls are cached within the run;
- staged file changes have no side effects and only `local.files.commit` can
  write them;
- domain mutations are reread through their C++ bridge verification method;
- the coordinator, Rust shell, and renderer refuse completed action state
  without a verified native effect, and file actions additionally require a
  verified file change set; the terminal result is
  `blocked`/`needs-input`.

### A compensation token claims Undo without restoring state

A model or stale renderer response could replay a decorative, expired or
wrong-effect token and present the original change as rolled back.

Mitigations:

- compensation tokens are generated per operation and tool call and map only
  to a Rust-owned typed inverse; native ids never cross into the renderer;
- the inverse is removed from the registry only after its native verification
  reread succeeds, so a failed Undo remains blocked and retryable;
- completed installs compensate by deleting the exact installed mod, while an
  install cancellation exposes no unsupported restore token;
- the renderer updates only the verified effect carrying that exact token.

### Native identifiers or absolute paths leak to Gemini

A mod, plugin, download or install payload includes an internal id, source path
or absolute local path that could reveal the machine layout or be replayed as
authority.

Mitigations:

- Rust sanitizes capability payloads to minimal display/status fields;
- model-visible entities use run-local opaque refs with a type check;
- stale or wrong-kind refs return `expired-reference` plus current opaque refs;
- native paths are resolved only after the typed ref crosses back into Rust;
- project and FluxPack selection cannot accept model-supplied filesystem paths.

### Cross-tab data or operation leakage

A background response is appended to the active tab, a new tab inherits an old
summary, or cancellation terminates unrelated work.

Mitigations:

- tabs own messages, summary, provider cursor, events, runs, and any active goal;
- reducer updates locate tabs by run/operation id rather than current selection;
- the Rust shell tracks active/cancelled operation ids;
- cancelling one run marks only that operation and does not terminate the
  shared sidecar;
- persisted legacy sessions are normalized and pre-single-agent state is
  removed once.

### User questions or private content leak through diagnostics

A pending clarification, prompt, config body, or research snippet is copied to
ordinary operation logs.

Mitigations:

- diagnostics log only bounded mode, allowed risk, continuation, lifecycle,
  counts, operation ids, and safe error codes;
- prompts, user questions, local config contents, and web snippets are excluded;
- host-owned `request_input` remains in the response/session path and is never
  forwarded to C++ merely for logging.

### Context truncation or misleading usage

Local budgets silently remove evidence or the UI reports an incorrect window.

Mitigations:

- model metadata supplies input/output limits with documented fallbacks;
- `countTokens` covers the prepared provider payload;
- estimates are visibly distinguished from exact values;
- at 90%, one structured summary is updated and the payload is recounted;
- only newly eligible history is summarized on later passes;
- an oversized current turn returns a typed error.

### Tool-loop denial of service or false provider outage

The model repeats calls, never completes, or reaches an emergency guard.

Mitigations:

- cancellation, ten-minute request timeout, 64 rounds, 128 calls and two
  recoveries per cause are independent terminal guards;
- successful results use stable semantic fingerprints, so distinct search
  pages, read ranges, parsed values, recipe/native state, staging and
  verification count as progress; only three repeated successful semantic
  results trigger `ai.tool.no-new-evidence` at the `tool-loop` stage;
- errors do not consume the stagnation budget, and native containment or
  permission rejection remains a separate safety blocker;
- one final no-tools turn requests a precise report;
- terminal errors retain the real provider/model and typed `tool-loop` stage;
- cancellation is checked between provider/tool steps. A blocking upstream call
  may finish before cancellation is observed, but no later tool is dispatched.

### Gateway abuse or secret disclosure

A client attempts a different model/method, oversized body, long-running call,
or extraction of the managed Gemini key.

Mitigations:

- authenticated Edge Function invocation and method/model allowlists;
- 64 MiB body limit and 120-second upstream abort;
- server-side Vault/service-role access only;
- raw streaming response rather than a key or credential response;
- no-store headers and no application-table persistence of request bodies;
- secret/auth-header redaction in local logs.

### Sensitive data leakage through logs or support artifacts

Prompts, local contents, paths, diffs, credentials, or provider bodies appear in
diagnostics.

Mitigations:

- logs use ids, digests, stages, counts, revisions, tools, and terminal reasons;
- event and error payloads are validated/redacted at the Rust boundary;
- prompts, file bodies, absolute paths, keys/tokens, checkpoints, and raw diffs
  are excluded from standard logs and support output;
- renderer never receives the managed provider key.

### Unclear transfer, retention, or deletion behavior

Users cannot tell what leaves the device or how local tabs are removed.

Mitigations and open gate:

- localized privacy/terms identify prompt/history/summary, skill/tool context,
  bounded selected file fragments, Supabase gateway, Gemini, and Search;
- local tabs are retained until closed/cleared or application data is removed;
- closing a tab deletes it from local AI session storage;
- owner/legal review must confirm GDPR/DSGVO legal bases, processor roles,
  international transfers, provider/infrastructure retention, consent wording,
  and deletion UX before public release.

## Residual Risk

Gemini may be wrong, Search may return hostile or misleading material, token
counts may temporarily fall back to estimates, cancellation cannot interrupt
every already-blocking OS/network call instantly, and provider/infrastructure
retention is outside the desktop client's sole control. These risks must remain
visible in release review and user disclosures; they do not justify widening
tool authority.
