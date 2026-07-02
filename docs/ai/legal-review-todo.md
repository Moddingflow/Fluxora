# Fluxora AI Legal Review TODO

Date: 2026-07-02

Status: owner/legal review required. This is an engineering TODO, not final
privacy-policy or terms wording.

The staged web-surfing release gate expands the planned AI research surface
beyond local/Nexus-only evidence into policy-limited non-Nexus sources such as
official maintainer documentation, maintainer-controlled GitHub metadata,
script extender documentation, LOOT/libloot metadata, and curated modding
forums where access is allowed.

Owner/legal review must decide whether the bundled privacy policy, terms of
use, in-app disclosures, consent/opt-in copy, and support-bundle export wording
need updates for:

- data categories: prompts, selected chat history, compact build/profile/mod
  context, evidence cards, source ids, source tiers, citations, blocked/quota
  and backoff records, discarded-source reasons, compressed run state,
  cost/usage ledgers, and support/audit trace metadata;
- purposes and legal bases for external AI research, source-tier evaluation,
  evidence-card retention, quota/backoff handling, support diagnostics, and
  cost control;
- recipients/subprocessors: AI providers, search/grounding providers, Nexus API
  endpoints, allowed non-Nexus source hosts, and any future Fluxora routing or
  support service;
- international transfers outside the EU/EEA and the safeguards or user choices
  that apply;
- retention/deletion/export controls for local AI history, context graph data,
  evidence cards, caches, compressed run state, prompt cache observations, and
  provider usage records;
- support-bundle defaults: source/evidence ids, tiers, confidence, fingerprints,
  blocked/quota state, discard reasons, and compact summaries may be useful,
  while raw web/forum bodies, raw HTML, provider-search transcripts, cookies,
  authenticated pages, provider keys, Nexus tokens, raw prompts, arbitrary local
  files, and full logs must stay excluded by default unless a separate explicit
  opt-in flow and legal text covers that transfer;
- Nexus API terms, rate limits, and the separate decision required before any
  explicit public Nexus page policy is enabled.

Do not treat this TODO as legal advice or user-facing final wording.
