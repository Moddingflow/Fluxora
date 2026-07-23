# Fluxora AI Security Hardening

Status: current release checklist, 2026-07-20.

## Required Invariants

| Control | State | Enforcement |
| --- | --- | --- |
| One provider and model | Implemented | Contracts and host allow only `gemini` / `gemini-3.1-flash-lite`; gateway repeats the model allowlist. |
| No shell or arbitrary URL fetch | Implemented | Neither capability is declared to Gemini; the renderer has no raw native access. |
| Task-appropriate tools from round one | Implemented | Action rounds declare the complete supported typed contract; answer rounds declare read-only tools. Route, inferred domain and phase remain diagnostics, not authority. |
| Action completion invariant | Implemented | Every action requires completed execution and non-empty native `verifiedEffects`; file actions additionally require a verified `fileChangeSet`. Premature prose gets two corrections then a typed blocker. |
| Semantic progress and bounded stagnation | Implemented | Stable semantic fingerprints count distinct pages, ranges, parsed values, recipe/native state, staging and verification; three repeated successful results stop as `ai.tool.no-new-evidence`, while errors use a separate recovery budget. |
| Native session preopen | Implemented | The Rust shell idempotently calls `buildFiles.beginChat` before the first Gemini tool round; recovery is reserved for bridge restart or true session loss. |
| Build-scoped filesystem access | Implemented | C++ canonicalizes every operation against registered roots and rejects traversal/reparse escapes and protected types. |
| Core-owned mutation authority | Implemented | Build matches are grouped by normalized virtual path before pagination, each group is rebound to its profile/Overwrite winner, and only that opaque ref can be authorized; revision, read hash, expected value, format policy, checkpoint, reread, verification, and rollback remain core checks. |
| Source mods remain unchanged | Implemented | Source-mod writes target `Fluxora AI Overrides`; only the effective Overwrite INI/JSON config may be changed directly, with checkpoint and rollback. |
| Independent chat tabs | Implemented | Messages, summaries, events, runs, and cancellation are keyed by chat/operation; cancelling one run does not kill the shared host. |
| Real context accounting | Implemented | `getModel` limits and `countTokens` drive input usage; fallback counts are marked estimated. |
| Structured compression | Implemented | Compression starts at 90%, updates one summary, advances the provider-history cursor, and recounts before generation. |
| Typed failures | Implemented | Provider, gateway, context, tool, loop, and verification failures keep their real stage and provider identity. |
| Secret minimization | Implemented | Provider/service-role secrets stay outside renderer, prompts, logs, and support output. |
| Legal approval | Required | Bundled disclosures are engineering drafts pending owner/legal GDPR/DSGVO approval. |

## Prompt And Content Injection

Treat user prompts, local file text, filenames, web grounding text, provider
output, citations, and tool arguments as untrusted. They may influence the
assistant's answer but cannot change policy.

Mandatory behavior:

- instructions found in a file or web page do not grant tools or approvals;
- only typed tool names and schemas declared by the host are accepted;
- unknown tool calls, invalid opaque refs, absolute paths, traversal, stale
  revisions, hash mismatches, and unsupported mutations fail closed;
- web evidence cannot select an ambiguous local file or approve a write;
- content containing apparent secrets is not written automatically and is
  excluded from normal logs;
- direct URL fetch, `file:` URLs, loopback/private-network fetches, and embedded
  credentials are unavailable to the model.

## Filesystem And Mutation Controls

The metadata index is build-scoped and contains no persistent file contents.
Reads are explicit, bounded, text-only, and size-limited. Archives expose only
metadata/listings. Reparse points are not followed. Every operation rechecks
canonical containment and the selected project/chat binding.

Search pagination is revision-aware. A stale cursor is rejected or restarted
explicitly; it must not be interpreted as a complete scan. Content scanning
cooperatively checks cancellation and caps every file read.

Build filename/path search counts unique normalized virtual paths, not physical
owners. The core returns one effective winner and records the shadowed owners as
`conflictingOwners`; filename and source-owner-path searches resolve to the same
winner ref. Multiple results therefore represent distinct virtual targets.
Before staging, the Rust broker requires that exact core ref and its mutation
eligibility. Winner-ref mismatch, missing eligibility, multiple targets, and
missing proof are separate typed blockers and never authorize a write or manual
fallback.

Automatic mutation is a staged, bounded transaction of at most 16 mutations
across at most 16 distinct allowlisted text/config files and 2 MiB changed
text. Multiple mutations in one file are limited to distinct case-insensitive
INI section/key targets; duplicate targets fail before commit.
The core preflights the whole batch and writes only managed overrides after
matching revisions, read hashes and expected values. Any failed write or
postcondition rolls back the complete batch. It then rereads and verifies every
result. Rollback requires verified post-write hashes, so it cannot overwrite a
later edit. Game and Downloads are read-only. Overwrite accepts only structured
INI/JSON mutations of a unique effective config; arbitrary patch/create remains
blocked. Unsaved Monaco buffers are protected by the Rust dirty-ref registry.

## Provider And Gateway Controls

The renderer never handles provider secrets. A public Supabase publishable key
may identify the Edge Function client, but it is not authorization to obtain
the server-side Gemini key. Service-role/Vault access remains inside the
deployed function.

The gateway enforces JWT verification, the single model, the three allowed
provider methods, 64 MiB request limit, 120-second timeout, no-store response
headers, and streaming pass-through. Protocol v1 remains only for deployment
compatibility; new clients use v2.

No prompt, chat history, build fragment, or provider body is intentionally
persisted in Supabase application tables. Infrastructure/provider logging and
retention still require legal and operational review.

## Logging And Diagnostics

Allowed diagnostic fields include operation/chat/run identifiers,
provider/model, method/tool, round, phase, whether a new semantic fact was
observed, revision, counts, elapsed time, typed error code/stage, task kind,
provider route, bounded retry/cache/stage/verification/stagnation counts,
phase transitions, native-session-preopen status, and terminal reason. Diagnostics use
`fluxora.ai.file-tool-diagnostics.v2`.

Forbidden diagnostic content includes raw prompts, chat bodies, file contents,
diff/checkpoint bodies, absolute paths, auth headers, cookies, Supabase
service-role keys, Gemini keys, Nexus tokens, and credentials found in files.
Sanitization occurs before writing native logs or emitting renderer events.

## Data And Retention Matrix

| Data | Location | Lifecycle |
| --- | --- | --- |
| Chat tabs and full UI history | Local renderer storage, scoped by build | Kept until the tab/build AI data is cleared or application data is removed. |
| Provider summary/context cursor | Local with its chat tab | Removed with that tab; updated at later 90% compression. |
| File index metadata | Native local session/cache | Revision-bound; no permanent content index. |
| Checkpoints/diffs | Local native mutation lifecycle | Kept only while needed for verified Undo; excluded from normal logs/support output. |
| Managed request payload | Transient Supabase/Google processing | No application-table persistence; provider/infrastructure terms apply. |
| Operation logs | Separate local log channels | Minimized/redacted; current product retention controls apply. |

## Release Checks

- Run focused `BuildFileWorkspaceService` and bridge protocol CTest coverage.
- Run all Rust targets and the native AI fixture.
- Run typecheck, complete Vitest, `test:ai-gate`, and Playwright AI smoke.
- Probe deployed gateway v2 `status` and `getModel` with the current client key.
- Run `Build.ps1 -Configuration Release` and verify only the approved installer.
- Run `graphify update .` and review the final diff for secrets and stale AI
  contracts.
