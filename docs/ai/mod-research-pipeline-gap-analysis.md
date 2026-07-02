# Staged modding web surfing gap analysis

Date: 2026-07-02

Scope: docs-only audit. This compares the supplied Deep Research target against
the current `C:\Fluxora` checkout. No product code, config, tests, or runtime
behavior was changed for this audit.

Graphify note: `graphify-out/graph.json` exists, so broad navigation started
with `graphify query`. The AI/web/Nexus queries returned noisy Nexus auth and
installer nodes rather than a useful scoped AI pipeline map, so the audit used
the explicit files requested in the prompt plus narrowly scoped test and
`loot/libloot` searches.

## Deep Research target vs current Fluxora implementation

| Deep Research target | Current Fluxora implementation | Gap / future direction |
| --- | --- | --- |
| Single manager with staged prompts and strict schemas, not one giant prompt. | `FluxoraAIHost` is the single local orchestration process and already returns structured DTOs for cost, task plans, subagents, context graph, research reports, and routing decisions. Provider calls still go through a normal Gemini `generateContent` request with static system instructions and free-form assistant text. | Add a host-owned staged mod research controller with strict per-stage JSON contracts. Reuse the existing host, DTO transport, job state, and UI metadata; do not build a parallel AI surface. |
| Local ingest produces a normalized build snapshot before any web. | `ai-build-tools.ts` already collects read-only build context: build summary, installed mods, mod order, plugins, `local.check_plugins`, selected file tree, profiles, downloads, operations, Nexus auth status, bounded filesystem metadata, and Analyze-only text previews. `ai_context_graph.rs` ingests that into SQLite/FTS with source ids, fingerprints, stale markers, and compact retrieval bundles. | Formalize a `mod-research.build-snapshot` stage input derived from the existing `fluxora.ai.build-context.v1` and `fluxora.ai.context-graph.v1` outputs. Add only missing fields needed by the router, such as explicit game/store/runtime/version and crash/error tokens, through existing read-only/core-backed boundaries. |
| Router decides local-only vs Nexus API vs external web vs insufficient data. | There are heuristic routers: `promptNeedsExternalResearch()` in the renderer, `research_requested()` in `ai_research.rs`, `prompt_task_kind()` in the host, and `FluxoraAiRoutingDecision` for model/cost routing. They do not produce the Deep Research route JSON with missing fields, suspects, and retrieval budget. | Add `fluxora.ai.mod-research.route.v1` as a strict host DTO. It should run after local ingest and before `collect_ai_research_bundle`, with explicit `useLocal`, `useNexus`, `useWeb`, `missingFields`, `suspects`, and budget fields. |
| Local inspector finds deterministic findings and suspect mods without browsing. | Existing build context and context graph can expose missing masters, plugin counts, overwrite evidence, recent operations, and bounded local file metadata. The first dedicated local inspector artifact now packages deterministic findings, hypotheses, `suspect_mods`, and local source ids from the build/context snapshot. | Continue hardening `fluxora.ai.local-inspection.v1` on top of the existing context graph. Keep new deterministic checks in C++/core or existing typed facade tools where they are domain behavior; host may rank and package read-only evidence. |
| Nexus investigator uses Nexus API first and returns compact evidence cards. | `ai_research.rs` parses Nexus URLs/NXM links, fetches Nexus API metadata/files/file details when an env API key exists, records rate-limit headers, caches metadata with TTL, and emits `fluxora.ai.research.v1` snapshots/sources. | Promote this from URL-triggered snapshots to suspect-driven Nexus evidence cards: `source_type`, mod id/name, claim, affected versions, related mods, evidence strength, actionability, quota state, and unanswered questions. Prefer the app's approved credential/broker path over host-only env vars before public use. |
| Do not scrape Nexus website as fallback when Nexus API quota is exhausted. | Current policy allows public Nexus page fetches when `allowPublicWebFetch` is true, after API attempts or even when API credentials are unavailable. The research report records 429/backoff, but the code still has a public-page path for Nexus domains. | This is a high-priority policy gap. Future Nexus stage must fail closed on Nexus website scraping when API quota is exhausted or credential/API access is unavailable, unless product/legal explicitly approves a narrow exception. Non-Nexus allowed sources can continue separately. |
| External investigator searches only when local and Nexus are insufficient. | Gemini Google Search grounding can be enabled when research is requested. Explicit public fetch is currently domain-allowlisted mostly to Nexus domains. There is no query planner stage, preferred/negative domains, source-tier policy, or evidence-card dedupe/corroboration stage. | Add `query-planner` and `external-investigator` stages after Nexus. They should use a small query budget, preferred official/maintainer domains, non-Nexus allowed source policy, dedupe, source tiers, contradiction flags, and compact evidence cards. |
| Judge ranks causes and tests before final response. | The host can run chef/subagent orchestration for deep read-only analysis and returns a final answer with sources. The final answer is not preceded by a strict `ranked diagnosis` judge artifact with supporting/opposing evidence ids, next tests, fix order, and confidence. | Add `fluxora.ai.mod-research.diagnosis.v1` before final text. The final responder should render from that artifact, not from raw research pages or worker prose. |
| Evidence cards, not raw pages, flow between stages. | Current research snapshots summarize JSON/HTML, sanitize instruction-like text, mark `instructionsAllowed: false`, and expose citations. Context graph also exposes compact nodes and citations. | Preserve this, but add a first-class evidence-card schema with source class, trust tier, claim, excerpt summary, relevant mods, affected versions, evidence strength, corroboration count, contradiction risk, and source ids. |
| Retrieval/cost budget is explicit per stage. | Cost preflight, prompt cache estimates, web/search call accounting, Nexus metadata cache, and context graph token budget already exist. Budgets are not tied to a route result or per-stage stop conditions. | Move budgets into the staged route and enforce them in Nexus/web investigators. Add tests that extra retrieval is blocked when local evidence is sufficient or when a claim is already supported. |
| LOOT/libloot is a cheap deterministic signal for Bethesda-family games. | In the audited checkout, LOOT appears only in prompt/skill guidance telling the assistant not to recommend LOOT as the primary answer. There is no current LOOT/libloot tool in the AI files, and scoped search did not find a libloot integration in `docs`, `frontend-tauri/src`, or `backend`. | Decide explicitly whether LOOT/libloot becomes a deterministic core service. If yes, implement it behind the C++ core/typed facade boundary and expose only read-only findings to AI. Do not implement load-order domain logic in TypeScript or the AI host. |
| Trusted policy must stay separate from untrusted web/user content. | Current docs, host prompts, research snapshots, context graph messages, and threat model all mark external/local data as untrusted and deny permission changes from source text. | Keep this unchanged. Add staged-schema tests that malicious Nexus/web/log text cannot modify route policy, approvals, budgets, or tool permissions. |

## Already ready and should not be rewritten

- Tauri/C++ ownership boundary: renderer UI only, Rust shell/facade for safe native app boundary, C++ core for domain and filesystem behavior.
- `FluxoraAIHost` sidecar process, provider/model registry, credential broker shape, model fallback, local dry-run fallback, and host health/capability contract.
- Read-only build context collection in `frontend-tauri/src/renderer/features/ai/ai-build-tools.ts`, including `local.filesystemSnapshot`, `local.check_plugins`, and Analyze-only `local.read_text_file`.
- `FluxoraContextGraph` in `frontend-tauri/src-tauri/src/ai_context_graph.rs`: SQLite/FTS retrieval, source ids, fingerprints, stale markers, compact bundles, and citation conversion.
- Existing constrained research primitives in `frontend-tauri/src-tauri/src/ai_research.rs`: URL/NXM parsing, SSRF/private network blocking, denied schemes, redirect blocking, size/time limits, sanitizer, source snapshots, citations, rate-limit metadata, and Nexus metadata cache. Reuse the machinery while tightening policy.
- `FluxoraAiResearchRequest`, `FluxoraAiResearchReport`, `FluxoraAiContextBundle`, `FluxoraAiRoutingDecision`, `FluxoraAiTaskPlan`, `FluxoraAiSubagentSchedule`, and related DTOs in `frontend-tauri/src/shared/fluxora-api.ts`.
- Task plan and subagent visibility flow in `frontend-tauri/src/shared/ai-task-planner.ts`, `frontend-tauri/src/renderer/features/ai/ai-chat-runtime.ts`, and existing AI chat state/rendering tests.
- Cost preflight, prompt cache/cost ledger, margin telemetry, Nexus metadata TTL policy, and AI gate cost thresholds.
- `fluxora.ai.safe-action-catalog.v1` and the approved-action execution MVP. Staged research should remain read-only until a separate approved execution prompt uses the existing safe action catalog.
- `frontend-tauri/src/shared/ai-evaluation-suite.ts` and `npm run test:ai-gate` as the release gate foundation.

## Gaps in engineering order

1. Define staged mod research contracts.
   Add docs and TypeScript/Rust DTO shape for `route`, `local-inspection`, `nexus-evidence`, `web-query-plan`, `web-evidence`, `diagnosis`, and final report linkage. Keep this in the AI host/shared DTO boundary.

2. Make local ingest/router explicit.
   Replace prompt-token research triggers with a route stage that consumes existing build context/context graph output, returns strict JSON, and blocks web when local evidence is enough.

3. Add local inspector output.
   Package deterministic local findings, hypotheses, suspect mods, missing checks, and recommended read-only tools. Add or expose missing local fields only through existing core/facade boundaries.

4. Tighten Nexus policy before expanding web surfing.
   Change Nexus research behavior so API quota exhaustion or missing API access does not silently fall back to Nexus website scraping. Record quota/backoff as evidence and continue only with approved non-Nexus sources.

5. Turn Nexus research into suspect-driven evidence cards.
   Use suspect mod ids/names from local inspector and router, not only URLs pasted in prompts. Preserve cache/rate-limit metadata and source citations.

6. Add external query planner and investigator.
   Introduce small query budgets, preferred domains, denied domains, source tiers, dedupe, contradiction flags, and explicit non-Nexus source policy. Keep browser sandbox and authenticated pages disabled unless a later approval/BYOK stage enables them.

7. Add judge and final responder separation.
   Generate `ranked_causes`, `why`, `why_not`, `next_tests`, `fix_order`, and confidence as strict JSON before rendering user-facing text.

8. Extend autonomous job progress and subagent metadata.
   Map each stage to visible job checkpoints and subagent rows without making subagent output trusted instructions.

9. Expand the evaluation gate.
   Add golden tasks for local-only no-web routing, Nexus quota exhaustion without Nexus page scraping, suspect-driven Nexus evidence, external non-Nexus evidence, conflicting sources, prompt injection inside a source, and final answer grounded in diagnosis JSON.

10. Legal/privacy review for broader web surfing.
    If external web sources expand beyond the current Nexus-focused allowlist, update `docs/ai/threat-model.md`, `docs/ai/architecture.md`, bundled legal text if product data transfer changes, and support-bundle redaction expectations.

## Future stage file and test map

| Future stage | Files likely to change | Tests/gates to update or add |
| --- | --- | --- |
| Stage 0: contracts and docs | `docs/ai/architecture.md`, `docs/ai/threat-model.md`, `docs/ai/evaluation-suite.md`, `docs/ai/mod-research-pipeline-gap-analysis.md`, `frontend-tauri/src/shared/fluxora-api.ts` | `frontend-tauri/tests/ai-host-contract.test.ts`, `frontend-tauri/tests/ai-evaluation-suite.test.ts`, `frontend-tauri/tests/ai-security-hardening.test.ts` |
| Stage 1: explicit router/local ingest | `frontend-tauri/src-tauri/src/bin/fluxora_ai_host.rs`, `frontend-tauri/src/shared/fluxora-api.ts`, `frontend-tauri/src/renderer/features/ai/ai-chat-runtime.ts`, `frontend-tauri/src/renderer/features/ai/ai-build-tools.ts`, `frontend-tauri/src/shared/ai-task-planner.ts` | `frontend-tauri/tests/ai-chat-runtime.test.ts`, `frontend-tauri/tests/ai-build-tools.test.ts`, `frontend-tauri/tests/ai-task-planner.test.ts`, `frontend-tauri/tests/ai-host-contract.test.ts` |
| Stage 2: local inspector | `frontend-tauri/src-tauri/src/bin/fluxora_ai_host.rs`, `frontend-tauri/src-tauri/src/ai_context_graph.rs`, optional new `frontend-tauri/src-tauri/src/ai_mod_research.rs`, `frontend-tauri/src/shared/fluxora-api.ts`, possibly `backend/` only for new deterministic domain checks | Rust unit tests near the new host module, `frontend-tauri/tests/ai-build-tools.test.ts`, `frontend-tauri/tests/ai-evaluation-suite.test.ts`, targeted backend CTest if C++ domain checks are added |
| Stage 3: Nexus investigator | `frontend-tauri/src-tauri/src/ai_research.rs`, `frontend-tauri/src-tauri/src/bin/fluxora_ai_host.rs`, `frontend-tauri/src/shared/fluxora-api.ts`, potentially `backend/src/Services/NexusModsAuthService.cpp` and related headers if the app credential/API broker changes | Rust tests in `ai_research.rs`, `frontend-tauri/tests/ai-host-contract.test.ts`, `frontend-tauri/tests/ai-cost-optimization.test.ts`, `frontend-tauri/tests/ai-evaluation-suite.test.ts`, `backend/tests/NexusModsAuthServiceTests.cpp` if backend Nexus behavior changes |
| Stage 4: external web query planner/investigator | `frontend-tauri/src-tauri/src/ai_research.rs` or a focused new web research module, `frontend-tauri/src/shared/fluxora-api.ts`, `docs/ai/threat-model.md`, `docs/ai/architecture.md`, possible bundled legal resources if public/cloud transfer scope changes | `frontend-tauri/tests/ai-security-hardening.test.ts`, `frontend-tauri/tests/ai-host-contract.test.ts`, `frontend-tauri/tests/ai-evaluation-suite.test.ts`, new SSRF/domain/quota/query-budget tests |
| Stage 5: judge and final responder | `frontend-tauri/src-tauri/src/bin/fluxora_ai_host.rs`, new staged pipeline module if introduced, `frontend-tauri/src/shared/fluxora-api.ts`, `frontend-tauri/src/renderer/features/ai/ai-chat-runtime.ts` | `frontend-tauri/tests/ai-chat-runtime.test.ts`, `frontend-tauri/tests/ai-chat-rendering.test.ts`, `frontend-tauri/tests/ai-evaluation-suite.test.ts`, `frontend-tauri/e2e/ai-chat.spec.ts` |
| Stage 6: release gate expansion | `frontend-tauri/src/shared/ai-evaluation-suite.ts`, `docs/ai/evaluation-suite.md`, `frontend-tauri/tests/ai-evaluation-suite.test.ts`, package scripts only if the command changes | `npm run test:ai-gate`, plus targeted Vitest for changed AI modules |
| Stage 7: optional browser sandbox/deep research | Tauri capability/Rust shell files, AI host research module, shared DTOs, docs, legal/privacy resources | Security tests for approvals, browser/auth disabled-by-default, support-bundle redaction, targeted Playwright only after UI approval surfaces exist |

## Validation ladder for next prompts

Use the smallest applicable rung first, then escalate when the touched surface
crosses a boundary.

1. Docs-only stage:
   `graphify update .`
   Do not run `Build.ps1` when only repo docs changed.

2. Shared TypeScript DTO/planner/runtime stage:
   `cd frontend-tauri`
   `npm run typecheck`
   `npx vitest run tests/ai-task-planner.test.ts tests/ai-chat-runtime.test.ts tests/ai-host-contract.test.ts`

3. Build-context/context-graph stage:
   `cd frontend-tauri`
   `npm run typecheck`
   `npx vitest run tests/ai-build-tools.test.ts tests/ai-chat-runtime.test.ts tests/ai-host-contract.test.ts`
   Add Rust unit tests for `ai_context_graph.rs` changes and run the focused Cargo test target.

4. AI host/research Rust stage:
   `cd frontend-tauri`
   `npm run typecheck`
   `npx vitest run tests/ai-host-contract.test.ts tests/ai-cost-optimization.test.ts tests/ai-security-hardening.test.ts`
   Run focused Rust tests for `fluxora_ai_host`/`ai_research` modules.

5. Nexus/core credential or domain behavior stage:
   Run the relevant frontend AI tests above.
   Add or update backend Google Test coverage, especially `backend/tests/NexusModsAuthServiceTests.cpp`, then run the relevant CTest target.

6. UI-visible staged progress/subagent stage:
   `cd frontend-tauri`
   `npm run typecheck`
   `npx vitest run tests/ai-chat-runtime.test.ts tests/ai-chat-rendering.test.ts tests/ai-chat-state.test.ts`
   Run `frontend-tauri/e2e/ai-chat.spec.ts` when UI flow or Playwright-visible behavior changes.

7. Release gate stage:
   `cd frontend-tauri`
   `npm run test:ai-gate`
   Use this whenever prompts, model routing, research policy, evidence schemas, cost thresholds, or final diagnosis behavior change.

8. Full product validation after code/config changes:
   From repo root, run `.\Build.ps1 -Configuration Release` after the targeted tests above, unless a future prompt explicitly scopes validation differently.

9. Graph refresh:
   Run `graphify update .` after code, docs, project-rule, or agent-configuration changes.
