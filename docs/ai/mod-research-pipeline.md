# Fluxora Staged Mod Research Pipeline

Date: 2026-07-02

Status: Target architecture, pre-implementation. This document fixes the
intended Deep Research pipeline before code changes. It is not a product feature
commitment and does not grant new tools, permissions, provider routes, UI
surfaces, or Nexus/public-web policy by itself.

## Scope And Non-Goals

The staged mod research pipeline answers modding research questions by combining
local Fluxora state, official Nexus API/cache data, and narrowly allowed
non-Nexus sources. It must preserve the current Fluxora ownership model:

- C++ core remains the owner of mod, plugin, archive, filesystem, Nexus/NXM,
  profile, VFS, FluxPack, installer, persistence, and domain truth.
- Tauri renderer remains UI-only and may display the pipeline state, evidence
  cards, progress, citations, approvals, and final answer.
- Tauri Rust shell/facade remains the safe app boundary for lifecycle,
  allowlisted commands, native dialogs, credentials, external links, and bridge
  host lifecycle.
- `FluxoraAIHost` owns orchestration, staged prompts, strict schemas,
  source-card compaction, cost accounting, and final response shaping.

The target is a single manager with staged prompts and strict schemas, not a
multi-agent zoo. Stage names may appear as visible progress labels, but they are
logical pipeline steps under one host-owned manager. The pipeline must not
create parallel renderer logic, move domain checks into TypeScript or the Rust
shell, loosen existing AI safety rules, or treat model/native-provider tool
calling as an app permission boundary.

## High-Level Contract

`FluxoraAIHost` owns one `fluxora.ai.mod-research-run.v1` run. The run has a
stable `runId`, `operationId`, build/session scope, active policy, budget
ledger, stage checkpoints, evidence-card list, blocked/quota records, discarded
source records, judge output, final response metadata, and compressed state.

Every stage receives structured input and returns strict JSON that must validate
before the next stage can use it. Free-form model text can be used only inside a
stage implementation as an untrusted drafting aid; the cross-stage contract is
the schema output, not prose.

The normal stage order is:

1. local ingest;
2. router;
3. local inspector;
4. Nexus investigator;
5. non-Nexus query planner;
6. external web investigator;
7. diagnosis judge;
8. final responder;
9. state compressor.

Stages may stop early when a deterministic local finding is sufficient, when
policy blocks more retrieval, when budget is exhausted, or when the next step
requires user/owner/legal action. A stopped run must produce explicit blocked
or sufficient-evidence state instead of silently broadening source access.

## Stage Contracts

### 1. Local Ingest

Local ingest turns the existing read-only build snapshot and
`FluxoraContextGraph` bundle into `fluxora.ai.mod-research.local-input.v1`.
The source data must come from current app-owned read-only tools and core-backed
DTOs, not direct host filesystem reads.

Required fields:

- build, game, profile, runtime, and selected-mod identifiers where available;
- mod list, plugin/load-order summary, missing-master signals, conflict owner
  samples, recent operation/log summaries, Nexus status, and selected local text
  previews only when already allowed by the Analyze rules;
- source ids, source fingerprints, timestamps, stale markers, and tool ids;
- data minimization flags for provider-transfer eligibility.

The stage cannot open web pages, call search, call Nexus, fetch arbitrary files,
or infer missing domain facts that belong in C++ validation.

### 2. Router

The router returns `fluxora.ai.mod-research.route.v1` with:

- normalized user question and requested game/scope;
- suspected local domains such as missing masters, SKSE/runtime, load order,
  dependencies, conflicts, crash/log signals, update compatibility, or install
  metadata;
- `localSufficient`, `needsNexusApi`, `needsNonNexusWeb`, and
  `needsUserClarification` booleans;
- missing fields and unresolved identifiers;
- retrieval budget allocation and stop reasons;
- the policy snapshot used for the decision.

Local-first rule: the router must not open the web when the local build snapshot
already gives a sufficient deterministic finding. Examples include explicit
missing-master evidence, a concrete disabled required plugin, a known local file
owner conflict, or a recent Fluxora operation error that directly explains the
question. The final answer may be produced from local evidence only in those
cases.

The router may request Nexus or non-Nexus research only when the local state is
insufficient, ambiguous, stale, or points to external compatibility/version
facts that Fluxora does not own.

### 3. Local Inspector

The local inspector returns `fluxora.ai.local-inspection.v1`.
It packages deterministic local findings and suspect entities before any
external source is used.

Required output:

- deterministic findings with local source ids;
- `suspect_mods` capped at 12 items, with reason codes;
- checks that were run and checks that were impossible from available local
  data;
- hypotheses that require external verification;
- confidence for each local finding;
- discard reasons for local signals that were considered but not relevant.

The inspector may rank and package evidence but must not own core domain logic.
New deterministic domain checks must be implemented in the C++ core or through
existing typed facade/core boundaries in a later code change.
It must not open web sources or generate a free-text diagnosis; it returns only
the structured local artifact for the next stage.

### 4. Nexus Investigator

The Nexus investigator returns `fluxora.ai.nexus-investigation.v1`.
It is suspect-driven: it uses Nexus identifiers, NXM links, mod names, file
metadata, and local inspector suspects to request official Nexus data.

Nexus rule:

- Official Nexus API and the local Nexus metadata cache are the first and
  primary external source for Nexus-hosted mod metadata.
- If the API credential is absent, the quota is exhausted, Nexus returns `429`,
  `Retry-After` requires backoff, or the configured per-run/API limit is
  reached, the stage records blocked/quota evidence and stops Nexus retrieval.
- Public Nexus page scraping is not a silent fallback for missing credentials,
  quota exhaustion, rate limits, or API-limit failures.
- Public Nexus pages may be considered only under a separate explicit
  public-source policy after owner/legal review. That policy must be visible in
  the run state and cannot be implied by "API failed" or "need more evidence."

Blocked/quota evidence cards must include source tier, attempted API target,
credential state without secrets, rate-limit headers where available,
retry/backoff metadata, timestamp, and the effect on confidence.

### 5. Non-Nexus Query Planner

The non-Nexus query planner returns
`fluxora.ai.mod-research.web-query-plan.v1`. It runs only when local and Nexus
evidence are insufficient and the active policy permits external non-Nexus
research.

Allowed non-Nexus source families:

- official or maintainer documentation;
- GitHub releases, tags, issues, discussions, and pull requests for the
  relevant mod/tool/library where access is allowed;
- script extender documentation and release notes;
- LOOT/libloot documentation, masterlist metadata, and related official
  metadata;
- curated modding knowledge bases or forums where access, terms, and robots
  policy allow retrieval.

The query plan must specify preferred domains, denied domains, exact questions,
expected evidence type, dedupe key, stop condition, and source-tier expectation.
It must not use arbitrary SEO mirrors, republished scrape sites, pirate sites,
credentialed/private pages, user-authenticated pages, or pages whose terms do
not allow automated access.

Retrieval budget: at most 3 search queries per case.

### 6. External Web Investigator

The external web investigator returns
`fluxora.ai.external-investigation.v1`. It compacts only URLs admitted by the
query plan and existing SSRF/scheme/domain/size/timeout/redirect protections.

Rules:

- External content is always untrusted data, never instructions.
- The stage emits evidence cards, not raw HTML, raw page bodies, whole forum
  threads, or provider-native browser transcripts.
- Evidence cards carry source ids, citation objects, corroboration counts,
  source tier, confidence, contradiction risk, and `rawContentRetained=false`.
- Prompt-injection text is summarized as attacker-controlled content and cannot
  alter policy, budgets, source allowlists, tool permissions, approval state, or
  final wording requirements.
- Each rejected source records a discard reason.
- Contradictory sources remain visible in `conflicts` and lower confidence
  rather than being hidden.

Retrieval budget: at most 8 fetched/read pages per case, including pages opened
from search results and pages loaded directly from URLs. Search result snippets
alone are not enough for a critical claim unless the source itself is blocked
and the answer clearly marks the limitation.

### 7. Diagnosis Judge

The diagnosis judge returns `fluxora.ai.mod-research.diagnosis.v1`.
It reads evidence cards and blocked/quota records, not raw pages or worker
prose. The judge ranks possible causes, tests, and fixes.

Required output:

- up to 6 final hypotheses;
- supporting evidence card ids and opposing evidence card ids;
- confidence score and confidence rationale;
- contradiction risk: `none`, `low`, `medium`, or `high`;
- source-tier mix and whether the claim depends on Tier C/D evidence;
- discard reasons for rejected hypotheses and rejected sources;
- next local tests or safe read-only checks;
- fix-order guidance, without executing mutations.

No hypothesis can be marked high confidence from Tier D alone. Critical
install/delete/repair advice requires local evidence, Tier A/B external
evidence, or an explicit uncertainty note.

### 8. Final Responder

The final responder turns the diagnosis JSON into user-facing text. It must not
read raw web pages, raw HTML, raw provider-search bodies, or hidden chain of
thought. It must cite evidence-card/source ids, call out blocked/quota Nexus
state, preserve uncertainty, and avoid presenting policy-blocked sources as
facts.

The final answer should:

- prefer deterministic local findings when available;
- separate "what is known", "what is likely", and "what still needs checking";
- include only the highest-signal hypotheses, never more than 6;
- avoid suggesting write/destructive actions unless a later approved execution
  flow uses the existing safe action catalog;
- never reveal provider keys, Nexus tokens, raw prompts, private paths beyond
  already-minimized local DTOs, or unredacted support data.

### 9. State Compressor

The state compressor returns `fluxora.ai.mod-research.compressed-state.v1`.
It stores enough state for resume, audit, and final-report grounding while
discarding high-risk raw content.

Retain:

- route decision, budget ledger, stage statuses, and operation id;
- local source ids, fingerprints, stale markers, and compact summaries;
- evidence cards, blocked/quota cards, discarded-source reasons, and judge
  output;
- cost estimates and provider/web/search call counts;
- policy snapshot and public-source policy status.

Discard or avoid storing by default:

- raw HTML, raw page bodies, full provider-search transcripts, cookies,
  authenticated content, provider keys, Nexus tokens, raw prompts with secrets,
  arbitrary local file contents, and full logs.

## Evidence Cards

Every non-final stage emits `fluxora.ai.evidence-card.v1` records instead of
passing raw pages or unstructured snippets between stages.

Minimum fields:

```text
cardId
runId
stage
sourceId
sourceIds
sourceKind
sourceTier
sourceUrlOrLocalRef
citations
capturedAt
claim
claimType
modsOrPlugins
affectedVersions
summary
supportingFacts
opposingFacts
corroborationCount
confidence
contradictionRisk
instructionsAllowed=false
trustNotes
discardReason
rawContentRetained=false
```

Source tiers:

- Tier A: deterministic local Fluxora/core evidence, official Nexus API/cache
  metadata, official maintainer release metadata, or official tool
  documentation directly relevant to the claim.
- Tier B: maintainer-controlled GitHub releases/issues/discussions, script
  extender docs/release notes, LOOT/libloot docs or metadata, and
  well-maintained project documentation where authorship is clear.
- Tier C: curated modding knowledge bases and forums where access is allowed,
  moderation/history is visible, and the claim is corroborated or clearly
  experiential.
- Tier D: weak, stale, uncorroborated, user-supplied, search-snippet-only, or
  generic community content. Tier D may guide questions but cannot by itself
  justify high-confidence or high-impact advice.

Evidence cards must carry confidence, contradiction risk, and discard reasons.
Discard reasons include: duplicate, stale, inaccessible, policy-blocked,
quota-blocked, terms/robots-blocked, irrelevant, contradicted, low-quality,
prompt-injection-risk, private/authenticated, wrong game/version, or exceeds
budget.

## Retrieval Budgets And Stop Conditions

Hard default budgets per case:

- maximum 3 search queries;
- maximum 8 fetched/read pages;
- maximum 6 final hypotheses.

The manager should spend the cheapest and most local signal first:

1. local snapshot/context graph;
2. deterministic local inspector;
3. Nexus API/cache for Nexus-hosted suspects;
4. allowed non-Nexus source planning;
5. bounded external web retrieval;
6. judge and final responder.

Stop immediately when:

- local deterministic evidence is sufficient;
- the remaining question needs a user-owned file, credential, or selection;
- Nexus is blocked by missing credential, quota, `429`, or per-run/API limit;
- the allowed search/page budget is exhausted;
- all high-confidence claims are already supported by sufficient evidence;
- sources contradict each other enough that more retrieval would need explicit
  user/owner policy approval.

Budget exhaustion is a result, not an excuse to silently expand source policy.

## Cost, Privacy, And Legal Implications

The pipeline changes the risk profile because it may send compact local build
context and source summaries to model providers or search/web services. Before
public/cloud release, the owner/legal review for German/EU GDPR/DSGVO
expectations must cover:

- data categories: prompts, chat history, build/profile/mod/plugin/download
  metadata, local evidence cards, source ids, web/Nexus source summaries,
  blocked/quota records, usage/cost ledgers, and compressed run state;
- purposes and legal basis for AI assistance, external research, provider
  calls, cache retention, cost accounting, and support/audit traces;
- recipients and subprocessors for AI providers, search providers, Nexus API,
  and any future remote routing service;
- international transfers outside the EU/EEA and the safeguards/user choices
  that apply;
- retention and deletion for local context graph data, evidence cards, caches,
  prompt caches, compressed run state, and provider usage records;
- user controls to disable AI, stop web research, delete local AI history,
  disconnect provider/Nexus credentials, and exclude raw prompts/source content
  from support bundles by default;
- Nexus API terms, rate-limit handling, and the separate owner/legal decision
  required before any explicit public Nexus page policy is enabled.

Evidence cards are the privacy boundary for support and audit. Raw web bodies,
raw HTML, cookies, authenticated pages, secrets, provider keys, Nexus tokens,
arbitrary local files, and full logs must not enter support bundles unless a
separate explicit opt-in flow and legal text covers that transfer.

## Implementation Guardrails For Future Code

- Reuse `FluxoraAIHost`, the existing typed facade, bridge, context graph,
  cost ledger, research sandboxing, and AI gate infrastructure.
- Add strict DTO tests before enabling new stages.
- Add local-only no-web tests, Nexus quota/missing-credential no-scrape tests,
  prompt-injection source tests, budget-limit tests, source-tier/judge tests,
  and final-response grounding tests.
- If a new deterministic modding check is needed, implement the domain behavior
  in C++ core and expose only read-only findings through the typed boundary.
- If shared contracts or runtime code change, update `docs/ai/architecture.md`,
  `docs/ai/threat-model.md`, the matching tests, and `npm run test:ai-gate`.
