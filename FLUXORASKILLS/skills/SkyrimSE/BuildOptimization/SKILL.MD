---
schema: fluxora.skill.v1
name: skyrimse-build-optimization
game: SkyrimSE
version: 0.1.0
appliesTo:
  - Skyrim Special Edition
  - Skyrim Anniversary Edition
activation:
  mode: triggered
  triggers:
    - optimize build
    - FPS
    - stutter
    - script lag
    - Papyrus
    - SKSE plugin
    - draw calls
    - texture size
    - VRAM
    - memory limit
    - JK's Skyrim
    - Great Cities
    - Open Cities
    - eFPS
readPolicy: Read this metadata first; load the full skill only for optimization, performance, script, graphics, memory, or city-overhaul requests.
---

# SkyrimSE Build Optimization

Use this skill for SkyrimSE/AE performance, size, graphics, script-load, city-overhaul, and stability optimization.

## Core Rule

Less heavy scripting, fewer redundant draw calls, correct memory limits.

## Safe Size Cleanup

- SKSE mods often include `source`, `src`, C++ source, headers, examples, or Papyrus `.psc` source files that are not needed at runtime.
- These files can usually be removed from the installed mod copy to reduce build size slightly.
- Keep runtime files: DLL, EXE, PEX, BSA, ESP/ESM/ESL, INI, JSON/TOML/YAML configs, meshes, textures, animations, scripts, and all mod documentation needed for support.
- Prefer preserving the original archive so the mod can be reinstalled cleanly.
- Never delete files from the live build without a visible plan and backup/reinstall path.

## Script And Engine Optimization

- Prefer modern SKSE C++ plugin alternatives when they exist and are currently maintained, because they bypass or reduce Papyrus VM load.
- Verify alternatives with current sources before recommending them: Nexus page, posts/comments, changelog, GitHub releases, and known compatibility notes.
- Recommend Vanilla Script Optimization / Vanilla Script (micro)Optimizations where appropriate.
- Avoid stacking multiple script-heavy mods that poll constantly, spawn many aliases, or run cloak effects unless the user accepts the cost.

## Draw Calls And Cities

- Creation Engine struggles with many visible objects in one scene.
- City expansions, dense clutter, open-city setups, JK's Skyrim, Great Cities, and similar overhauls need strict optimization.
- Prefer occlusion/previs-aware setups and eFPS-style occlusion culling where compatible.
- Watch patch requirements. City, lighting, landscape, navmesh, and occlusion mods often need explicit compatibility patches.

## Graphics Guidance

- Prefer BC7 textures.
- Use 2K for most world and environment textures.
- Use 4K only for large objects, mountains, sky, and assets the camera sees up close.
- Use 1K or 512 for small clutter.
- Reduce normal/specular maps first when VRAM pressure is high.
- Avoid mixing many parallax, ENB, high-poly, grass, tree, city, and NPC overhauls without measuring frame time and VRAM.

## Memory And Stability

- Check modern engine-fix and memory-limit recommendations before changing INI values.
- Do not suggest outdated memory hacks without current verification.
- Treat "more texture resolution" and "more objects" as costs, not upgrades by default.
