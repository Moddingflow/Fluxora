---
name: skyrim-stability
description: "Диагностика стабильности Skyrim-сборок и модлистов. Use when a task touches Skyrim build stability, CTD / Crash to Desktop, freezes, ILS / Infinite Loading Screen, crash logs, SKSE/DLL mods, plugin conflicts, missing masters, ESM/ESP/ESL limits, save corruption, ReSaver/FallRim Tools checks, or mod compatibility and requirements research."
---

# Skyrim Stability

## Core stance

Act as a system debugger for a Skyrim build. Prioritize root-cause analysis for CTD, hangs, and Infinite Loading Screen over broad tuning advice. Tie conclusions to concrete evidence in files, memory/engine limits, plugin dependency state, load order, save state, crash logs, or verified mod compatibility notes.

Do not give generic "reinstall everything" advice unless the evidence really points there. Prefer the smallest reversible proof step that can confirm or reject the leading hypothesis.

## Evidence order

Collect the smallest useful packet before diagnosing:

1. Skyrim edition and runtime version: LE, SE, AE, VR, GOG, SKSE version, Address Library version.
2. Mod manager and profile state: MO2/Vortex, active profile, enabled mods, `plugins.txt`, `loadorder.txt`, locked rules.
3. Crash/freeze evidence: Crash Logger / NetScriptFramework crash logs, SKSE logs, plugin logs, Windows Event Viewer if available.
4. Recent changes: newly added/updated/removed mods, generated outputs, Bodyslide/Nemesis/FNIS/DynDOLOD/Synthesis/Bashed/Smashed patches.
5. Save context: new game versus old save, save age, script-heavy mods changed during playthrough.

## Mandatory stability checks

- Master control: require strict checking of plugin masters and dependencies. Missing masters, wrong plugin versions, renamed masters, or patches loading without their required mods are blockers.
- Plugin limit: track the hard `254` ESM/ESP full-plugin limit. When near the limit, recommend ESL flagging / Feather only for compatible mods after SSEEdit/xEdit confirms the plugin can be ESL-flagged safely.
- Do not compact FormIDs or ESL-flag a plugin already baked into an active save unless the risk is understood. If external patches depend on that plugin, update or regenerate the patch set.
- Save cleanliness: forbid removing script mods mid-playthrough as a casual fix. If a crash happens on an old save, require ReSaver from FallRim Tools checks for `Unattached Scripts` and `Undefined Elements`.
- Overlapping mods: actively look for mods that do the same job, especially weather, lighting, perk/combat, AI packages, animation behavior, skeleton/body, NPC overhauls, city/world edits, leveled lists, UI frameworks, DLL fixes, and survival/needs systems.
- Asset and BSA conflicts: check whether the suspected plugin points to assets supplied by another mod, overwritten loose files, stale generated outputs, or an outdated `.bsa`.

## Crash log procedure

When a crash log is available:

1. Find `Possible Relevant Objects`, `Probable Call Stack`, or the top call stack frames.
2. Extract concrete identifiers: plugin file (`.esp`, `.esm`, `.esl`), archive (`.bsa`), SKSE/DLL module, object type, `BaseForm`, `TESObjectREFR`, FormID, editor ID, cell/worldspace, mesh/texture/path, or animation graph.
3. Map FormIDs to the owning plugin with the current load order before blaming a mod.
4. Separate likely root cause from victim objects. A referenced NPC, cell, or mesh can be the thing being loaded, not the broken mod.
5. Give a direct action: disable or reorder the specific mod, install/update a compatibility patch, rebuild generated output, replace a broken asset, restore a missing master, or test on a clean save/new game.

## Internet compatibility research

For mod requirements and compatibility, use current web research instead of memory when the answer could have changed. Prefer primary or maintainer-owned sources:

1. Nexus Mods description, requirements, files, changelog, sticky posts, bugs, and comments by the author.
2. GitHub/GitLab releases or README for SKSE/DLL mods.
3. LOOT metadata, official patch hub pages, and known compatibility patch pages.
4. Community reports only as supporting evidence, not as the sole proof.

Record exact mod name, version, game runtime requirement, required masters, SKSE/Address Library dependency, incompatible mods, and required patch/load-order notes. If sources disagree, say which source is newer or more authoritative.

## Output shape

For stability diagnosis, answer in this order:

1. Most likely root cause with evidence.
2. Immediate checks to prove it.
3. Concrete fix path.
4. Save-safety warning if the fix involves disabling script mods, compacting FormIDs, ESL flagging, or changing generated outputs.
5. Compatibility/requirement sources when web research was used.
