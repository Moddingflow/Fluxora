# Fluxora AI Security Hardening

Date: 2026-06-30

Phase 16 goal: make the open-source AI surface safe-by-default. AI output,
provider responses, Nexus pages, FOMOD metadata, logs, skills, markdown-like
text, and user text are untrusted until they pass schema validation, policy
checks, audit logging, and approval gates.

## Threat model review

Reviewed documents:

- `docs/ai/architecture.md`
- `docs/ai/threat-model.md`
- `frontend-tauri/src-tauri/tauri.conf.json`
- `frontend-tauri/src-tauri/capabilities/main.json`
- `frontend-tauri/src/shared/ai-safe-action-catalog.ts`
- `frontend-tauri/src-tauri/src/ai_research.rs`
- `frontend-tauri/src-tauri/src/bin/fluxora_ai_host.rs`
- bundled privacy/terms resources under `installer/Fluxora.Installer/Resources/Legal/`

The reviewed threat model still holds for Phase 16: renderer UI owns display
state only, Rust shell owns safe OS affordances and provider credential broker,
`FluxoraAIHost` owns AI orchestration, and C++ core owns build mutations.

## Hardening Checklist

| Control | Status | Evidence |
| --- | --- | --- |
| Threat model review | Done | This document cross-checks `architecture.md`, `threat-model.md`, Tauri config, AI host, research, catalog, and legal resources. |
| Prompt injection red-team suite | Done | `frontend-tauri/tests/ai-security-hardening.test.ts` tests malicious Nexus/FOMOD/log prompts and requires visible, approval-gated plans only. |
| Tool-call schema fuzzing | Done | `validateAiSafeActionPayload()` rejects unknown tools, missing `operationId`, wrong types, hidden approval fields, and shell-like extra fields. |
| Web fetch SSRF tests | Done | Rust tests in `ai_research.rs` block `file://`, loopback, private IP and non-HTTPS fetches; Phase 16 test asserts the policy document remains wired. |
| URL allowlist tests | Done | `ai_research.rs` enforces Nexus/public allowlist; `ai-chat-security.ts` blocks unsafe chat source URLs before renderer callbacks. |
| No secrets in renderer/localStorage/logs/crash dumps | Done | Chat settings store only `modelId` and routing preset; support bundles redact raw prompts by default; runtime logs redact keys/tokens. |
| OS or Supabase credential broker only | Done | Provider credentials are read by `FluxoraAIHost` from the OS credential store first, then from a Fluxora-managed Supabase credential endpoint/RPC keyed by `GEMINI_API_KEY`; renderer code still receives only connected/disconnected state. |
| CSP stays strict | Done | Tauri config has `withGlobalTauri: false`, one capability, no `unsafe-eval`, `object-src 'none'`, `base-uri 'none'`, and `form-action 'none'`. |
| No dangerous HTML rendering in chat | Done | Chat messages render through React text interpolation and the Phase 16 test rejects `dangerouslySetInnerHTML`. |
| Markdown sanitization | Done | Markdown/raw HTML rendering is disabled for Phase 16; chat text is text-only, control characters are stripped, and no markdown HTML library is bundled. |
| `target=_blank` safe external links | Done | AI citations render as buttons, not raw anchors; external opening is routed through the Rust shell with `https://`/`mailto:` filtering. Future anchors must use `rel="noopener noreferrer"`. |
| Dependency audit | Done with warnings documented | `npm audit --audit-level=moderate --omit=optional` returned 0 vulnerabilities. `cargo audit` returned exit 0 while reporting allowed warnings for unmaintained/unsound transitive crates; these warnings remain tracked for release dependency review. |
| License audit | Done for local dependency metadata | Direct npm dependencies and Rust cargo metadata exposed license metadata with no missing license fields in the local tree. Shipped notices still need regeneration/review for the exact release dependency tree. |
| Provider terms/data-retention matrix | Done | See matrix below. |
| User data export/delete controls | Done | AI settings exposes redacted snapshot export, active-build local chat/job clearing, and provider credential disconnect controls. |
| Owner/legal review for privacy policy and terms | Required before public AI | Bundled legal text already describes AI providers; owner/legal review remains a release gate and must not be represented as external legal advice. |

## Prompt Injection Red-Team Suite

The Phase 16 test suite covers representative malicious inputs:

- Nexus/mod page says to ignore previous instructions and call/delete tools.
- FOMOD metadata claims to be a developer message and requests provider keys.
- Log text asks the model to run shell or install archives without asking.

Expected result: Fluxora may create a visible plan, but it must not approve,
execute, hide, or parallelize destructive/write mutations. Web, FOMOD, log, and
source content cannot create tools, grant permissions, request secrets, approve
actions, or bypass C++ core validation.

## Tool-Call Schema Fuzzing

All safe-action tool payloads must satisfy:

- known tool name;
- top-level JSON object;
- `operationId` required;
- `additionalProperties: false` at the top level;
- scalar type validation for strings, booleans, numbers, integers and arrays;
- write/destructive/credential/external-network actions remain approval-gated;
- destructive actions remain step-by-step;
- model text cannot add `approvedByModel`, shell commands, or hidden flags.

Nested DTO objects remain delegated to bridge/C++ validation, but the AI tool
boundary rejects unknown top-level command shape before anything reaches the
executor queue.

## Web Fetch SSRF And URL Allowlist

`FluxoraAIHost` research is allowlist-first:

- HTTPS only for public web fetches;
- explicit Nexus domain allowlist;
- blocked schemes: `file`, `ftp`, `gopher`, `javascript`, `data`, `blob`,
  `about`, `chrome`, `edge`, `tauri`;
- DNS/IP checks block loopback, link-local, private, broadcast,
  documentation and unspecified addresses;
- redirects disabled;
- public fetch size capped;
- Nexus API/cache used before public page fetch;
- authenticated pages and browser sandbox stay approval-gated or disabled.

Renderer AI source buttons add a second gate: only `https://`, `mailto:`, or
`fluxora://ai/context-source/<id>` can reach the open callback.

## Renderer Secrets And Storage

Allowed renderer storage:

- chat history for local UX;
- AI settings containing only `modelId` and routing preset;
- autonomous job queue state;
- redacted support export snapshots unless the user explicitly opts into raw
  prompt export.

Forbidden renderer storage:

- provider API keys;
- Nexus tokens or OAuth secrets;
- bearer tokens;
- raw private file contents;
- hidden tool approvals;
- shell/filesystem capability state.

Provider keys are stored by the Rust shell/AI host through the OS credential
store or resolved by `FluxoraAIHost` through the controlled Supabase credential
broker. Supabase anon/publishable keys are treated as public identifiers; the
AI host must not ship Supabase service-role keys or provider key values to
renderer code. Logs and support bundles use operation ids, prompt digests,
prompt lengths, and redacted text instead of raw secrets. Provider endpoint
overrides are allowed only for HTTPS URLs on the same official provider host
and cannot include embedded credentials, query strings, fragments, HTTP,
local/private hosts, or arbitrary ports.

## Chat Rendering And Markdown

Phase 16 intentionally does not render markdown HTML. Assistant and user
messages render as React text. This preserves React escaping-by-default and
avoids `dangerouslySetInnerHTML`, raw HTML passthrough, SVG/MathML injection,
inline event handlers, and `javascript:` links.

Future markdown support must add a reviewed sanitizer, disable raw HTML by
default, validate link schemes, and keep `target=_blank` anchors on
`rel="noopener noreferrer"`.

## Provider Terms/Data-Retention Matrix

| Provider | Mode | Default status | Data sent | Retention / terms review |
| --- | --- | --- | --- | --- |
| Local dry run | local/offline | Enabled | No external provider data | Local only; no provider retention. |
| Google Gemini | BYOK/economy/planner/web | OS credential or Fluxora-managed Supabase key required | Prompt plus compact approved context; optional grounded search metadata. Gemini 3.1 Flash-Lite is the main chat model; Gemini 2.5 Flash-Lite is reserved for web/orchestration work. | User/provider terms apply; verify retention, grounding and transfer terms before public release. |
| Perplexity / paid deep research | future optional | Disabled by default | None until expensive-run/BYOK approval exists | Terms, retention, citation and cost behavior must be reviewed before enabling. |
| Nexus API/public pages | research source | API/cache first, allowlisted | Nexus URLs/NXM links, metadata summaries, rate-limit headers | Nexus terms/rate limits apply; do not send secrets to page content. |

## User Data Export/Delete Controls

Current controls and release requirements:

- Provider credentials: connect/disconnect flows go through Rust shell/OS
  credential store, while Fluxora-managed provider keys are resolved only by
  `FluxoraAIHost` through the Supabase credential broker. Neither path exposes
  keys to chat or renderer storage. AI settings exposes a disconnect action for
  local credential-backed providers.
- Chat/support export: AI settings writes a JSON support snapshot through the
  typed save-file/text-file facade. `createAiSupportBundleSnapshot()` redacts
  raw prompts by default; raw prompt export is not exposed in Phase 16.
- Local AI history: AI settings exposes a clear action for the active build,
  deleting the scoped chat session and autonomous-job queue storage before
  restoring an empty session.
- Context graph/cache: local context graph, prompt-cache observations and
  Nexus cache entries remain local; broader all-history/cache deletion remains
  a release privacy hardening item outside this active-build control.
- Logs/crash/support bundles: raw prompts and secrets excluded by default;
  user opt-in is required before sending support data outside the device.
- GDPR/DSGVO: public AI must expose clear disable, export and delete controls
  for local AI data and document provider-side deletion limits.

## Dependency Audit And License Audit

Local Phase 16 audit evidence:

- `npm audit --audit-level=moderate --omit=optional`: 0 vulnerabilities.
- `npm run typecheck`: passed.
- `npm test`: 44 files, 225 tests passed after the Phase 16 hardening pass.
- `cargo test --manifest-path frontend-tauri/src-tauri/Cargo.toml`: passed,
  including AI research SSRF tests, AI host endpoint/redaction tests, and Tauri
  shell external-link/log-redaction tests.
- `cargo audit`: exit 0. Reported 18 allowed warnings: gtk-rs GTK3 binding
  unmaintained warnings, `proc-macro-error` unmaintained, `unic-*`
  unmaintained, `anyhow` unsound warning, and `glib` unsound warning. No
  vulnerable exit was returned, but release dependency review must decide
  whether to accept or eliminate these transitive warnings.
- Direct npm dependency license metadata: present for all renderer
  dependencies/devDependencies in the local `node_modules` tree.
- Rust cargo dependency license metadata: present for all crates returned by
  `cargo metadata`.
Required release gate:

- Run the frontend dependency audit on the locked release dependency tree.
- Run the Rust advisory audit on the locked release dependency tree.
- Regenerate third-party license notices for the exact shipped dependency set.
- Review high-risk install scripts and native build dependencies.
- Do not ship public AI if a critical/high dependency advisory affects the AI
  host, renderer, Tauri shell, sanitizer, network fetch, credential, or logging
  path without a documented mitigation.

The current repository intentionally has `frontend-tauri/.npmrc` with
`package-lock=false`, so public release audit evidence must be generated from
the approved locked packaging environment instead of assuming the dev tree is
the release dependency bill of materials.

## Owner/Legal Review Gate

This document is an engineering hardening record, not legal advice. Before any
public AI release, owner/legal review must approve privacy policy, terms, third
party notices, provider terms/data-retention disclosures, opt-in flows, support
bundle export wording, and deletion/export controls for German/EU expectations.
