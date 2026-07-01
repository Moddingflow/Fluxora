---
schema: fluxora.skill.v1
name: skyrimse-stability-diagnosis
game: SkyrimSE
version: 0.1.0
appliesTo:
  - Skyrim Special Edition
  - Skyrim Anniversary Edition
activation:
  mode: triggered
  triggers:
    - CTD
    - Crash to Desktop
    - crash log
    - crash on load
    - Infinite Loading Screen
    - ILS
    - freeze
    - hang
    - stability
    - crash stack
    - Possible Relevant Objects
    - Call Stack
    - ReSaver
    - FallRim Tools
    - Unattached Scripts
    - Undefined Elements
    - вылет
    - зависание
    - бесконечная загрузка
    - стабильность сборки
readPolicy: Read this metadata first; load the full skill when the prompt touches Skyrim build stability, CTD, freezes, ILS, crash logs, save corruption, plugin conflict diagnosis, or compatibility/requirement checks related to stability.
---

# SkyrimSE Stability Diagnosis

Use this skill when SkyrimSE/AE stability is involved. Treat CTD, freezes, and Infinite Loading Screen as root-cause debugging problems, not generic modlist tuning.

## Debugger Stance

- Prioritize CTD and ILS causes before broad optimization advice.
- Tie every conclusion to evidence from plugin dependencies, load order, file overwrites, crash logs, SKSE/DLL modules, save state, memory/engine limits, or verified compatibility notes.
- Prefer the smallest reversible proof step that can confirm or reject the leading hypothesis.
- Do not recommend reinstalling the whole build unless the evidence really points to corrupt installation state.

## Required Checks

- Master control: require strict dependency checks for every affected plugin. Missing masters, wrong master versions, renamed masters, and patches loaded without their required mods are blockers.
- Full plugin limit: track the hard `254` ESM/ESP full-plugin limit. Near the limit, recommend ESL flagging / Feather only for mods that SSEEdit/xEdit confirms are compatible.
- ESL safety: do not casually compact FormIDs or ESL-flag a plugin already baked into an active save. If patches depend on that plugin, update or regenerate the patch set.
- Save cleanliness: do not tell the user to remove script mods mid-playthrough as a casual fix. If the crash is on an old save, require ReSaver from FallRim Tools checks for `Unattached Scripts` and `Undefined Elements`.
- Duplicate purpose: look for mods that do the same job, especially weather, lighting, perk/combat, AI packages, animation behavior, skeleton/body, NPC overhauls, city/world edits, leveled lists, UI frameworks, DLL fixes, and survival/needs systems.
- Asset ownership: check whether a suspected plugin references assets supplied by another mod, stale generated output, overwritten loose files, or an outdated `.bsa`.

## Crash Log Procedure

When a crash log is available:

1. Find `Possible Relevant Objects`, `Probable Call Stack`, or the top `Call Stack` frames.
2. Extract concrete identifiers: `.esp`, `.esm`, `.esl`, `.bsa`, SKSE/DLL module, object type, `BaseForm`, `TESObjectREFR`, FormID, editor ID, cell/worldspace, mesh/texture path, animation graph, or script name.
3. Map FormIDs through the current load order before blaming a mod.
4. Separate the likely root cause from victim objects. A referenced NPC, cell, or mesh may only be the thing being loaded.
5. Give a direct fix path: disable or reorder the specific mod, restore a missing master, update/install a compatibility patch, rebuild generated output, replace a broken asset, or test on a clean save/new game.

## Compatibility Research

For mod compatibility and requirements, use current web research when the answer could have changed. Prefer mod-author or maintainer sources:

- Nexus Mods description, requirements, files, changelog, sticky posts, bug reports, and author comments.
- GitHub/GitLab releases or README for SKSE/DLL mods.
- LOOT metadata, official patch hubs, and known compatibility patch pages.
- Community reports only as supporting evidence, not as sole proof.

Record exact mod name, version, Skyrim runtime requirement, required masters, SKSE/Address Library dependency, incompatible mods, and required patch/load-order notes. If sources disagree, state which source is newer or more authoritative.

## Final Answer Shape

1. Most likely root cause and evidence.
2. Immediate proof checks.
3. Concrete fix path.
4. Save-safety warning when disabling script mods, compacting FormIDs, ESL-flagging, or changing generated outputs.
5. Compatibility/requirement sources when web research was used.
