# Fluxora AI Threat Model

Date: 2026-06-30

Status: Phase 14 repository-scoped AI threat model. This complements the current
Fluxora Tauri + C++ bridge architecture and applies to read-only build-context
AI features, `FluxoraContextGraph` retrieval, constrained Nexus/web research,
visible task planning, subagent scheduling, approval-gated action execution,
long-running jobs, skill retrieval, and provider chat.

## Overview

Fluxora is a local desktop mod manager in the ModdingFlow ecosystem. The active
product architecture is a Tauri renderer and Rust shell/facade in
`frontend-tauri/`, a separate `FluxoraBridgeHost`, and a native C++ core in
`backend/`. The C++ core owns projects, profiles, mods, plugins, downloads,
archives, FOMOD, Nexus/NXM, VFS, FluxPack, executable launch, persistence,
filesystem mutation, and native logs. The renderer is UI-only and reaches native
behavior through the typed `window.fluxora` facade and allowlisted async
commands.

The AI feature adds a chat and orchestration layer backed by `FluxoraAIHost`.
The current private-MVP track enables provider chat plus app-owned read-only
build-context tools, local `FluxoraContextGraph` retrieval, SQLite FTS5
indexing, local fallback, constrained Nexus/web research, visible `AiTaskPlan`
payloads, bounded subagent scheduling, approval-gated basic execution,
verification/diff/rollback reporting, long-running job persistence, and
read-only skill retrieval. Browser automation remains outside this phase. The
security goal is to let AI help with build understanding, compatibility checks,
and safe automation planning without giving model output, external content, or
skill metadata direct access to files, shell, renderer internals, credentials,
or C++ objects.

Primary assets and privileges:

- user game/mod/project files, profiles, plugin order, downloads, archives,
  executable paths, FluxPacks, and local settings;
- Nexus tokens, provider API keys, OAuth data, and OS credential-store entries;
- chat history, prompts, provider responses, local context graph nodes/source
  ids/fingerprints/stale markers, web/Nexus snippets, prompt caches,
  usage/cost ledgers, logs, crash diagnostics, and support bundles;
- operation integrity: approvals, `operationId`, progress events, verification,
  rollback notes, and audit logs;
- billing and margin controls for a future `4.99 EUR/month` public AI
  subscription.

## Threat Model, Trust Boundaries, and Assumptions

### Trust Boundaries

The main boundaries are:

- User to renderer: the user can type arbitrary prompts, paste logs, import
  archives, select paths, approve actions, and configure providers.
- Renderer to Tauri shell/facade: renderer code is less trusted than the shell
  boundary and must only use typed `window.fluxora` APIs.
- Tauri shell/facade to `FluxoraAIHost`: the shell controls host lifecycle,
  credentials, cancellation, background jobs, and command allowlists.
- AI host to model providers: prompts, selected context, and tool results may
  leave the device only under an enabled AI mode and provider disclosure.
- AI host to tool router/bridge: model output is untrusted and must become a
  schema-valid, policy-checked, permission-classed tool call before execution.
- AI host to external research sources: Nexus API responses, public Nexus pages,
  search grounding, redirects, rate-limit responses, and snippets are untrusted
  external-network inputs and must remain source-wrapped data.
- Tauri shell/bridge host to C++ core: `fluxora.bridge.v1` is the typed native
  protocol. The core owns domain validation and filesystem effects.
- Fluxora to external content: Nexus API/pages, mod descriptions, HTML, FOMOD
  metadata, archive names, logs, URLs, and web snippets are attacker-controlled
  data unless proven otherwise.
- Fluxora to OS credential store and local filesystem: credentials and files are
  protected by OS/user account boundaries, but Fluxora must not leak secrets into
  renderer storage, prompts, logs, crash dumps, or exported reports.

### Attacker-Controlled Inputs

The most relevant attacker-controlled inputs are:

- Nexus pages, mod descriptions, comments, changelogs, API fields, and web
  snippets;
- arbitrary HTML/Markdown, URLs, redirects, and downloaded page content;
- mod archives, FOMOD XML/text labels, package metadata, file names, path-like
  strings, and archive layout;
- NXM links and external URLs opened or imported by the user;
- user-provided chat prompts and pasted logs;
- built-in and future user-provided skill manifests, skill Markdown, example
  prompts, validation notes, and security notes;
- local logs, crash reports, support bundles, and operation output when they
  contain attacker-controlled file names or text;
- provider responses and tool-call suggestions returned by models.

Operator-controlled inputs include explicit approvals, provider selection,
BYOK keys, AI enable/disable settings, build/project selection, and public
subscription tier. Developer-controlled inputs include shipped code, Tauri
capabilities, bridge schemas, model routing policy, pricing registry defaults,
and bundled legal/privacy text.

### Assumptions

- The local Windows/macOS/Linux user account boundary is the baseline. A fully
  compromised local account, admin malware, or a malicious patched Fluxora binary
  is out of scope for the AI model, though secret minimization still matters.
- AI is opt-in. If disabled, Fluxora should not call model providers or send AI
  context.
- `FluxoraAIHost` is local and separate from the renderer. It does not get raw
  filesystem or shell access.
- Provider keys are kept outside the renderer through OS credential storage.
- Phase 8 provider calls may send chat prompts, selected chat history, and a
  `FluxoraContextGraph` compact context bundle to the selected/fallback BYOK
  provider when AI chat is enabled. The bundle is source-traced, includes
  complete mod/plugin inventories, keeps auxiliary lists paged or lossy, and is
  selected by exact/FTS/graph retrieval before optional embeddings or LLM
  summarization. It excludes raw provider keys, Nexus tokens, arbitrary file
  contents, shell output, and full log files.
- The local context graph is a retrieval/cache layer over app-owned read-only
  DTO snapshots. It is not a new filesystem reader and it must not become the
  owner of build truth.
- Phase 7 may use Gemini Google Search grounding when research policy enables
  it. This is provider web grounding for cited context only, not a Fluxora tool
  execution channel.
- Phase 8 model responses cannot execute provider-native Fluxora tools.
  Host/model metadata keeps Fluxora tool calling disabled while the app-owned
  build context remains `read` permission only and research remains
  `external-network` source data.
- Phase 8 task plans and subagent schedules are structured planning artifacts.
  Read, external-network, analysis, review and report agents may be scheduled,
  but write/destructive proposals stay queued behind visible approval state and
  a single per-build executor queue. The executor queue policy is not a bypass
  around future C++ core validation.
- Phase 14 skill selection is a retrieval and planning aid only. A
  `FluxoraSkill` cannot grant new tools, execute scripts, lower permission
  classes, approve actions, read raw files, or override the safe action catalog.
  User skills are local-only by default and executable scripts are disabled in
  v1.
- C++ core validation remains authoritative for build, mod, plugin, download,
  archive, Nexus, path, and filesystem behavior.
- Public subscription cost controls are policy and product safety boundaries,
  not only business analytics.

## Attack Surface, Mitigations, and Attacker Stories

### Prompt Injection And Tool Confusion

Malicious Nexus pages, FOMOD descriptions, mod metadata, logs, or user-pasted
text may instruct the model to ignore policies, approve actions, reveal secrets,
delete mods, install a dependency, or spend budget. This is realistic because AI
will intentionally read untrusted mod ecosystem content.

Mitigations:

- Treat retrieved content as data, not instructions.
- Keep approvals in Fluxora UI state controlled by the user.
- Run schema validation and policy checks after model output.
- Require permission classes and approval state for every tool call.
- Fail closed when source trust, permission, budget, or operation lock state is
  unclear.
- Cite sources without letting them change system policy.
- Keep context graph source ids, fingerprints, timestamps, and stale markers in
  the answer trace so the user can inspect which local sources were used without
  exposing new tools or permissions.
- Treat `skill.md`, `manifest.json`, example prompts, validation checklist text,
  and security notes as policy-bounded data. They can help choose a planning
  template, but they cannot create tools, approve tools, request secrets, or
  relax approval rules.

### Skill Registry And User Skill Risks

Skills can steer the AI toward a task style. That makes them useful, but also
dangerous if a malicious or mistaken skill claims it needs shell access, raw file
reads, hidden destructive changes, broad web access, or provider secrets.

Mitigations:

- Built-in skills are static metadata with `skill.md` and `manifest.json`
  shape, not executable code.
- Allowed tools must already exist in `fluxora.ai.safe-action-catalog.v1`.
- `skillCanGrantNewTools` is false, and the skill catalog does not add C++,
  shell, process, raw filesystem, dialog, text-file, or renderer tools.
- User skills are local-only by default. Import/export with signatures is a
  later mechanism, not a current trust claim.
- Executable scripts are disabled in v1.
- The selected skill is visible to the user in the chat/task-plan surface.
- Skill retrieval uses context graph `Skill` nodes and source ids, so selection
  can be inspected without letting skill text become system policy.

### Renderer And Tauri Boundary Bypass

A severe failure would expose raw Tauri `invoke`, shell, filesystem APIs, native
modules, React internals, or broad renderer services to AI. Existing Fluxora
architecture already requires a typed `window.fluxora` facade, sandboxed
webviews, no Node/filesystem exposure in renderer, controlled navigation, safe
external-link handling, and C++ ownership of domain behavior.

Mitigations:

- Keep raw Tauri calls isolated in the facade layer.
- Add future `window.fluxora.ai.*` methods as narrow allowlisted commands.
- Never expose DOM scraping, renderer stores, file paths, or native handles as
  generic AI tools.
- Add facade/permission tests whenever AI APIs are introduced.

### Write, Destructive, And Concurrency Risks

AI automation can damage a build by deleting mods, replacing files, changing
load order, disabling plugins, importing archives incorrectly, or starting
conflicting operations in parallel.

Mitigations:

- Phase 5 tool access is read-only.
- Phase 9 write/destructive actions are cataloged but execution remains
  approval-gated. The `fluxora.ai.safe-action-catalog.v1` descriptors require
  JSON schema, permission class, dry-run state, visible preconditions,
  postconditions, audit fields, `operationId`, rollback/undo note, and
  confirmation text before Phase 10 can execute them.
- Phase 10 executes only explicit basic-build plans through
  `fluxora.ai.basic-build-execution-plan.v1`; missing targets block execution
  instead of being guessed.
- Destructive actions require step-by-step approval and snapshots where
  practical.
- Approval state comes only from Fluxora UI state; AI text, web pages, FOMOD
  metadata, logs, and tool output cannot approve an action or lower its
  permission class.
- Mutations must go through C++ core validation and the existing operation lock.
- The safe action catalog maps to existing typed facade/bridge/core methods and
  intentionally excludes shell, dialogs, raw filesystem, process, text-file, and
  generic renderer tools.
- Phase 11 stores the human-readable diff, machine-readable diff,
  postcondition checks, rollback hooks, and manual recovery instructions in the
  execution report. AI must not say "done" until verification is green; failed
  checks such as missing masters, duplicate names, failed install state, or
  operation errors must return `partial` or `blocked` with concrete recovery
  instructions.
- Rollback is not universal. Supported hooks name the exact safe action path to
  use after approval; unsupported rollback writes explicit manual recovery
  instructions instead of pretending that automatic undo is available.

### External Network, SSRF, And Web Content

Web/Nexus research can be abused to fetch local URLs, metadata services, private
networks, `file://` URLs, huge payloads, redirects, or malicious HTML. It can
also create provider data-transfer and citation integrity issues.

Mitigations:

- Use the Phase 7 web/Nexus research boundary before external research reaches a
  model.
- Block local/private network ranges, `file://`, loopback, link-local,
  non-HTTPS URLs, unallowlisted domains, and unsupported schemes.
- Enforce size, redirect, timeout, rate-limit, robots/terms, and cache/backoff
  policies.
- Prefer official Nexus API metadata/files/file-details before public page
  fetch. Record Nexus `X-RL-*` and `Retry-After` headers when present.
- Keep browser-sandbox fallback and user-authenticated pages disabled unless a
  future explicit approval flow enables them.
- Sanitize HTML/Markdown before display.
- Keep deep research disabled by default and gated by expensive-run approval or
  BYOK.

### Credential And Secret Leakage

Provider keys, Nexus tokens, OAuth data, personal API keys, prompts containing
paths, and logs may leak through renderer storage, prompts, provider calls,
crash dumps, support bundles, or debug traces.

Mitigations:

- Store user credentials only through the OS credential store; resolve
  Fluxora-managed provider keys only inside `FluxoraAIHost` through the
  controlled Supabase credential broker.
- Never send provider keys to renderer or model prompts.
- Treat Supabase anon/publishable keys as public client identifiers that are
  safe only with Row Level Security and server/Edge Function policy; never ship
  Supabase service role, secret, database, or provider keys to renderer code.
- Redact secrets from AI logs, operation logs, crash dumps, and support bundles.
- Exclude raw prompts/support data by default unless the user explicitly opts
  in.
- Provide disconnect/delete controls for provider credentials and AI history.

### Billing, Budget, And Resource Abuse

A prompt-injection payload, model loop, malicious user, or provider failure can
spend too much money, exhaust a public subscription wallet, or run long jobs that
degrade the local app.

Mitigations:

- Use internal `AI credits`, cost preflight, per-run and monthly limits, and
  remote-configurable pricing metadata.
- Phase 15 records cost-preflight, routing-decision, local prompt-cache,
  pipeline-policy, ledger, actual/estimated usage, and
  `gross_margin_after_ai_cost` telemetry DTOs for each chat response. These
  values are local enforcement estimates until public billing is connected to
  production usage data.
- Prefer cache, SQLite/FTS context graph retrieval, compact bundles, cheap
  routing models, and staged checkpoints.
- Require separate approval for expensive runs, deep web research, or BYOK.
- Add cancellation, watchdogs, and stop conditions for low-value loops.

### Privacy, Legal, And Support-Bundle Exposure

AI can turn local desktop metadata into provider-transferred data. Build state,
mod lists, paths, download records, logs, and prompts may identify the user or
their machine.

Mitigations:

- Keep AI disabled until the user enables it and sees data-disclosure copy.
- Update privacy policy, terms, and in-app disclosures before public/cloud AI.
- Document data categories, purpose, legal basis, recipients, transfers,
  retention, deletion/export controls, and opt-in requirements.
- Keep voice local by default through `whisper.cpp`; cloud STT requires opt-in.
- Keep context graph data local by default. Support bundles should include only
  source ids, fingerprints, counts, and redacted trace metadata unless the user
  explicitly opts into raw prompt/context export.
- Keep research snapshots summarized by default. Support bundles should avoid raw
  web page bodies, authenticated page content, cookies, Nexus tokens, provider
  keys, and prompt text unless the user explicitly opts in and the support flow
  documents what is being exported.

## Severity Calibration (Critical, High, Medium, Low)

Critical examples:

- AI, web content, or prompt injection obtains direct filesystem/shell/raw Tauri
  invoke access.
- A renderer or AI API exposes provider keys, Nexus tokens, or OS credential
  material.
- External content can execute write/destructive tools without real user
  approval.
- A bridge/facade bug lets AI bypass C++ core validation and mutate arbitrary
  paths.

High examples:

- Prompt injection causes approved-looking but unauthorized destructive changes
  because approval state is confused or hidden.
- Web fetch allows SSRF to local/private services or `file://` reads.
- Chat rendering permits script execution, unsafe navigation, or credential
  theft.
- Logs, crash dumps, or support bundles include raw provider keys, OAuth tokens,
  or sensitive prompts by default.
- Public subscription routing lacks per-run budget enforcement and can spend a
  large share of monthly budget silently.

Medium examples:

- Read-only build analysis leaks more local metadata to providers than the user
  was told.
- Cache poisoning or stale web/Nexus data causes incorrect compatibility advice
  without direct mutation.
- Long-running AI jobs consume CPU/network/provider quota until cancellation.
- Missing citations, source confusion, or bad summarization produces unsafe
  recommendations that still require user approval before mutation.
- Provider outage/retry loops cause repeated failed runs or duplicate charges
  within configured limits.

Low examples:

- AI status, progress, or citation UI is confusing but cannot trigger actions.
- Read-only tool errors are reported poorly without exposing secrets.
- Local-only non-sensitive chat history is retained longer than the user expects
  but can be deleted manually.
- A model refuses or over-warns on safe tasks without changing Fluxora state.

Out of scope or lower priority:

- A fully compromised local administrator, patched Fluxora binary, or malware
  reading user files directly.
- Malicious game/mod behavior after the user intentionally installs and runs
  third-party content outside Fluxora's AI/tool boundary.
- Provider-side misuse that is governed by provider terms but not caused by
  Fluxora sending unnecessary data; Fluxora still has to minimize and disclose
  transfers.
