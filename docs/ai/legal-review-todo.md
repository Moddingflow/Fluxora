# Fluxora AI Legal Review TODO

Date: 2026-07-22

Status: owner/legal review required. This is an engineering checklist, not
legal advice or approved user-facing wording.

The current product is a single Gemini assistant scoped to the selected build.
Legal review must verify the English, German, and Russian privacy/terms text and
matching in-product disclosure for:

- data sent for a request: prompt, selected tab history or structured summary,
  unfinished active goal/pending question, system/safety instructions, goal-
  and risk-appropriate typed tool declarations (read-only for answer/inspect,
  reversible for unambiguously implied repair), model metadata,
  bounded local file fragments, and minimal selected capability fields such as
  names, versions, order, enabled/transfer/install state, profile name or app
  language explicitly needed for the task;
- separate web-only Google/Gemini Search research and the treatment of returned
  URLs, titles, snippets, citations, and grounding metadata as untrusted evidence;
- recipients/subprocessors: the Fluxora-managed Supabase Edge gateway,
  Supabase infrastructure, Google/Gemini, and Google Search grounding;
- the statement that the gateway does not persist prompts or build context in
  Supabase application tables, while separately describing any unavoidable
  infrastructure/provider logging or retention;
- legal bases, controller/processor roles, international transfers outside the
  EU/EEA, safeguards, opt-in/consent wording, and withdrawal behavior;
- local retention: each build-scoped tab, full chat UI history, provider
  summary, context cursor, source citations, tool events, run metadata and any
  unfinished active goal stay local until verified completion, cancellation,
  terminal blocking, or the user closes/clears the tab or removes application data;
- deletion UX and whether closing a tab is sufficiently clear as deletion from
  Fluxora's local AI session storage;
- selected-file processing: opaque refs and relative paths, bounded allowlisted
  text fragments, no whole-machine scan, and exclusion of credentials,
  protected state, binaries, executables, scripts/source, and arbitrary files;
- staged transactions of up to 16 distinct allowlisted files, managed
  `Fluxora AI Overrides` writes, local checkpoints/diffs, atomic rollback,
  reread verification, Undo, and the fact that source mods are unchanged;
- automatic mutation for an explicitly requested repair or an unambiguously
  implied safe repair, with implied repair limited to read-only/reversible
  capabilities and one concrete question when multiple plausible choices remain;
- typed native actions for mods, plugins, downloads, installs, profiles and
  settings, including opaque refs, native postcondition verification,
  compensation/Undo policy, install cancellation and exact conflict questions;
- project/FluxPack selection remaining native, and one exact confirmation for
  irreversible FluxPack installation;
- support/log exclusions for prompts, chat bodies, file contents, absolute
  paths, raw diffs/checkpoints, cookies, provider keys, Nexus tokens, and other
  credentials;
- user-facing warning that model/Search output may be inaccurate or hostile and
  cannot authorize filesystem changes.
- local voice input: explicit microphone action and Windows permission,
  in-memory-only PCM, local Vulkan Whisper with automatic CPU fallback and CPU
  Silero processing, no audio retention or
  transfer, five-minute limit, content-free speech logs, transcript-to-draft
  behavior, and the fact that only a user Send action enters the existing
  Gemini data flow;
- bundled whisper-rs, whisper.cpp, Whisper model-weight and Silero VAD license
  texts plus installer-size/performance disclosures for the local models.

Public release remains blocked until owner/legal approval is recorded and the
localized in-product disclosure matches the bundled text.
