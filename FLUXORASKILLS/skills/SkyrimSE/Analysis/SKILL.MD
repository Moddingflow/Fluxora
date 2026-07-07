---
schema: fluxora.skill.v1
name: skyrimse-analysis
game: SkyrimSE
version: 0.2.0
appliesTo:
  - Skyrim Special Edition
  - Skyrim Anniversary Edition
activation:
  mode: triggered
  triggers:
    - analyze Skyrim
    - Skyrim analysis
    - CTD
    - CDT
    - Crash to Desktop
    - crash log
    - Crash Logger
    - Crash Logger SSE AE VR
    - Trainwreck
    - NetScriptFramework
    - crash on load
    - crash on startup
    - crash entering cell
    - Infinite Loading Screen
    - ILS
    - freeze
    - hang
    - stability
    - incompatibility
    - incompatible mods
    - crash stack
    - Possible Relevant Objects
    - Probable Call Stack
    - Call Stack
    - ReSaver
    - FallRim Tools
    - Unattached Scripts
    - Undefined Elements
    - broken mesh
    - bad texture
    - Papyrus
    - SKSE DLL
    - вылет
    - вылетает
    - краш
    - крашит
    - зависание
    - бесконечная загрузка
    - лог краша
    - анализ сборки
    - стабильность сборки
    - несовместимые моды
    - битый меш
    - битая текстура
    - скрипты
    - Absturz
    - sturzt ab
    - Crashlog
    - se cierra
    - pantalla de carga infinita
    - plante au chargement
readPolicy: Read this metadata first; load the full skill when the prompt context asks for SkyrimSE/AE build analysis, stability diagnosis, CTD/crash/freeze/ILS investigation, crash-log or logger discovery, suspected mod incompatibility, save corruption, asset/script/DLL causes, or compatibility/requirement checks related to stability. Treat triggers as hints after reading the full user context; do not require exact English or Russian wording.
---

# SkyrimSE Analysis

Use this skill when SkyrimSE/AE stability or build analysis is involved. Treat CTD, freezes, Infinite Loading Screen, suspicious mod interactions, and user-described crash scenarios as root-cause debugging problems, not generic modlist tuning.

## Context-First Activation

- Infer intent from the whole prompt before relying on trigger words. Misspellings, abbreviations, translated crash phrases, or non-English wording can still mean Skyrim stability analysis.
- Activate for Skyrim context plus crash/stability symptoms, crash logs, logger names, load-order/plugin evidence, save-health concerns, SKSE/DLL mismatch hints, asset paths, generated-output issues, or questions about incompatible mods.
- Do not require the user to say "CTD" exactly. A prompt such as "game closes when I enter a city", "Skyrim CDT after updating animations", or "Скайрим падает при загрузке сейва" is enough context.
- If the prompt is only a broad review with no crash, instability, analysis, or compatibility concern, prefer the default Skyrim rules skill.

## Debugger Stance

- Prioritize root cause over broad optimization advice.
- Tie every conclusion to evidence from plugin dependencies, load order, file overwrites, crash logs, SKSE/DLL modules, save state, memory/engine limits, generated outputs, or verified compatibility notes.
- Prefer the smallest reversible proof step that can confirm or reject the leading hypothesis.
- Do not recommend reinstalling the whole build unless the evidence really points to corrupt installation state.

## Modder Reasoning Loop

For every relevant enabled mod, reason like a modder instead of only matching names:

1. Classify the mod's role: framework, SKSE/DLL fix, perk/combat overhaul, animation behavior, skeleton/body, UI framework, weather/lighting, city/world edit, NPC overhaul, leveled list/economy, survival/needs, quest, patch, generated output, texture/mesh replacer, or tool output.
2. Compare mods that edit the same system. Multiple mods can be compatible only when their records/assets/scripts are patched, ordered intentionally, or explicitly designed to cooperate.
3. Check requirements and exclusions: required masters, runtime/SKSE/Address Library versions, optional files, patches, loader order notes, incompatible features, and "choose one" families.
4. Check record and asset ownership: plugins may reference meshes, textures, scripts, animations, or BSAs supplied by another mod, overwritten by loose files, or made stale by generated outputs.
5. Distinguish a victim from a cause. A crash log can name an NPC, cell, mesh, or plugin that is merely being loaded when another overwrite, patch, DLL, or missing requirement breaks it.

Do not hard-code one famous incompatibility pair as the solution. Build the incompatibility hypothesis from mod purpose, requirements, records/assets touched, generated patches, and current evidence.

## Required Checks

- Master control: require strict dependency checks for every affected plugin. Missing masters, wrong master versions, renamed masters, and patches loaded without their required mods are blockers.
- Full plugin limit: track the hard `254` ESM/ESP full-plugin limit. Near the limit, recommend ESL flagging / Feather only for mods that SSEEdit/xEdit confirms are compatible.
- ESL safety: do not casually compact FormIDs or ESL-flag a plugin already baked into an active save. If patches depend on that plugin, update or regenerate the patch set.
- Save cleanliness: do not tell the user to remove script mods mid-playthrough as a casual fix. If the crash is on an old save, require ReSaver from FallRim Tools checks for `Unattached Scripts` and `Undefined Elements`.
- Duplicate purpose: look for mods that do the same job, especially weather, lighting, perk/combat, AI packages, animation behavior, skeleton/body, NPC overhauls, city/world edits, leveled lists, UI frameworks, DLL fixes, and survival/needs systems.
- Asset ownership: check whether a suspected plugin references assets supplied by another mod, stale generated output, overwritten loose files, or an outdated `.bsa`.

## Crash Logger Discovery

Before parsing a crash, identify which logger the user has:

- Crash Logger SSE/AE/VR and related PDB-support builds usually produce detailed crash logs with registers, call stack, possible relevant objects, and plugin/module lists.
- Trainwreck usually produces simpler logs; treat it as useful for direction but weaker than Crash Logger evidence.
- .NET Script Framework crash logs usually indicate older SE 1.5.97-era setups and have their own call-stack/object sections.
- Other logs such as SKSE plugin logs, Papyrus logs, ENB logs, Nemesis/FNIS/DynDOLOD/Synthesis/Bashed/Smashed output logs, and Windows Event Viewer are supporting evidence, not equivalent to a crash logger unless they contain the failure point.

Use the newest relevant crash log first. If a crash logger appears installed but there is no current log, say that explicitly, then inspect older crash logs for repeated signatures and mark them as stale. If there are no crash logs at all, inspect the remaining evidence for any clue: SKSE logs, DLL/plugin logs, `plugins.txt`, `loadorder.txt`, `modlist.txt`, generated-output logs, missing masters, recent operation logs, mod metadata, asset paths, and the user's symptom description.

## Crash Log Procedure

When a crash log is available:

1. Confirm logger type and log freshness.
2. Find `Possible Relevant Objects`, `Probable Call Stack`, the top `Call Stack` frames, registers, exception code, module list, and loaded plugins.
3. Extract concrete identifiers: `.esp`, `.esm`, `.esl`, `.bsa`, SKSE/DLL module, object type, `BaseForm`, `TESObjectREFR`, FormID, editor ID, cell/worldspace, mesh/texture path, animation graph, or script name.
4. Map FormIDs through the current load order before blaming a mod.
5. Separate the likely root cause from victim objects.
6. Give a direct fix path: disable or reorder a specific mod for proof, restore a missing master, update/install a compatibility patch, rebuild generated output, replace a broken asset, update a DLL/runtime dependency, or test on a clean save/new game.

## Symptom Reasoning

If the user describes when or how the crash happens, use that timeline as evidence:

- Startup or main menu: suspect missing masters, runtime/SKSE/Address Library mismatch, incompatible SKSE DLL, ENB/D3D chain issues, or broken INI/plugin initialization.
- Loading an old save: suspect removed/updated script mods, save corruption, unresolved forms, broken references, stale generated outputs, or too-heavy script state.
- Entering a cell, city, dungeon, or fast travel: suspect bad mesh/texture, navmesh/cell/worldspace conflict, NPC overhaul conflict, lighting/weather/city edit overlap, or object reference from the named location.
- Equipping an item, opening inventory/MCM, or changing body/armor: suspect mesh, texture, skeleton/body, UI framework, animation graph, or script event issues.
- Combat, killmoves, transformations, or animations: suspect behavior generation, animation framework mismatch, skeleton issues, DAR/OAR rules, combat/perk overhauls, or behavior patches.
- After adding/updating/removing mods: compare only the recent changes first, including generated patches that must be rebuilt.

## Compatibility Research

For mod compatibility and requirements, use current web research when the answer could have changed. Prefer mod-author or maintainer sources:

- Nexus Mods description, requirements, files, changelog, sticky posts, bug reports, and author comments.
- GitHub/GitLab releases or README for SKSE/DLL mods.
- LOOT metadata, official patch hubs, and known compatibility patch pages.
- Community reports only as supporting evidence, not as sole proof.

Record exact mod name, version, Skyrim runtime requirement, required masters, SKSE/Address Library dependency, incompatible mods, and required patch/load-order notes. If sources disagree, state which source is newer or more authoritative.

## Final Answer Shape

1. Most likely root cause and evidence.
2. Crash logger/log freshness status, or the best fallback evidence if no current log exists.
3. Immediate proof checks.
4. Concrete fix path.
5. Save-safety warning when disabling script mods, compacting FormIDs, ESL-flagging, or changing generated outputs.
6. Compatibility/requirement sources when web research was used.
