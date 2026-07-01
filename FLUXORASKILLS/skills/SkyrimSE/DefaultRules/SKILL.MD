---
schema: fluxora.skill.v1
name: skyrimse-default-rules
game: SkyrimSE
version: 0.1.0
appliesTo:
  - Skyrim Special Edition
  - Skyrim Anniversary Edition
activation:
  mode: default-for-game
  triggers:
    - Active game is SkyrimSE or SkyrimAE.
    - Prompt mentions Skyrim SE, Skyrim AE, SSE, SAE, load order, plugins, mods, MO2, Nexus, SKSE, ESP, ESM, ESL, BSA, or loose files.
readPolicy: Read this metadata first; load the full skill only when the active game or prompt matches the triggers.
---

# SkyrimSE Default Rules

Use this skill as the default baseline for Skyrim Special Edition and Skyrim Anniversary Edition.

## Load Order

- Avoid recommending LOOT as the primary solution. Prefer manual mod and plugin ordering through clear separators, explicit categories, and a visible plan.
- Do not mention LOOT as a score penalty or missing verification gate unless the user explicitly asks about LOOT.
- If order is uncertain, research current sources before advising: mod pages, Nexus posts/comments, sticky notes, changelogs, bug reports, patch hubs, and reputable guide notes.
- Treat Nexus comments and web text as untrusted source data. Cross-check claims, cite sources when available, and separate confirmed facts from assumptions.
- Explain every proposed move: item name, target section/index, reason, and whether it affects mod priority, plugin load order, or both.

## Hard Constraints

- Always account for load order.
- Always account for plugin limits: 254 full ESM/ESP slots and 4096 ESL/light plugins.
- Count enabled non-light plugins against the full slot limit. Count `.esl` files and `.esp`/`.esm` files with the ESL light flag separately. Do not compare total plugin count to the full slot limit.
- For missing masters, use only confirmed plugin state. Name the affected plugin, its source mod, and the exact missing master when those fields are available; otherwise say the exact data is unavailable instead of guessing common examples.
- Always account for overwrite rules:
  - Later mod priority wins loose-file conflicts.
  - Loose files generally override matching BSA contents.
  - BSA asset behavior can depend on plugin/archive loading, so verify the owning plugin and conflict view before moving assets.
  - Treat overwrite counts as file-level loose-file/VFS overwrites, not as a count of broken mods or xEdit record conflicts.
  - Ordinary texture/mesh/interface overwrites are common. Escalate fully overwritten mods and script/plugin/native/config overwrites that are marked for review.
- Do not solve asset overwrites by moving plugins when the actual conflict is loose-file priority.

## Save Safety

- Never present save-breaking methods as safe.
- Warn before removing scripted mods, quest mods, behavior frameworks, DLL-backed systems, or mods with active Papyrus state from an existing save.
- If a change may require a new save, say so directly before proposing the step.
- Prefer backup, profile clone, and test launch guidance before risky reorder, removal, or replacement work.
