# Fluxora Agent Instructions

Read `.agents/PROJECT_RULES.md` before making changes in this repository.

Current frontend reality:

- `backend/` is the C++ core. Business logic belongs there.
- `frontend-tauri/` is the only product UI. New UI work belongs there.
- The old C# WPF product frontend has been removed. Do not recreate `frontend/`, `frontend.Tests/` or `Fluxora.App`; historical WPF parity material is archival only and must not route new product UI work.
- Do not put UI responsibilities into C++.
- Do not put core business logic into Tauri, TypeScript, JavaScript or C#.
- Split work into small focused services. Avoid master files, catch-all managers and god objects.
- Tauri UI must be split by responsibility into small renderer services, stores/hooks and focused components; do not grow a single App/MainWindow/master file with catalog, workspace, settings, install or operation orchestration.

Skill selection rules:

- At the start of each task, choose skills from the available skill names and short descriptions only. Do not read every `SKILL.md`, scan full skill folders, or recurse through skill assets just to decide what applies.
- Use the smallest skill set that directly matches the task. Prefer the most specific project/task skill over broad taste, frontend, migration or testing skills.
- After selecting a skill, read that skill's `SKILL.md` completely and only open the directly referenced files needed for the current task variant. Do not load unrelated references, examples, assets or sibling skills.
- If no skill clearly applies, do not spend tokens searching for one. State the validation plan from these repository rules and continue with the smallest relevant checks.
- When a task needs validation, use the relevant test skill only if it is clearly applicable; otherwise follow the validation rules below.

Tauri product rules:

- Before large UI or bridge work, read the current architecture, bridge, release and validation documentation. Treat WPF migration notes as archival references only.
- Tauri renderer owns UI state, routes, components, tables, trees, dialogs, accessibility and visual states only.
- Tauri Rust shell and the typed `window.fluxora` facade own app lifecycle, safe commands, native dialogs, external links, shell-open behavior, single-instance/deep-link handling and bridge-host lifecycle.
- Renderer must not receive direct Node.js, filesystem, shell, native module or scattered raw `Tauri invoke` access.
- Keep the Tauri security baseline: sandboxed webviews by default, typed `window.fluxora` APIs, allowlisted async commands, controlled navigation and safe external-link handling.
- When changing the bridge contract, update DTO/protocol docs, tests and operation/logging expectations together.
- Bridge and user-triggered mutations must create or propagate an `operationId` through Tauri UI, Tauri Rust shell/facade, bridge host, C++ core, installer, deploy, rollback, cleanup and file-operation paths.

Validation rules:

- For any code change, use the relevant test skill. If no dedicated test skill is available, define the validation plan before editing and run the smallest relevant test or build afterward.
- When adding any new feature, automatically add or update the matching test coverage in the same change before calling the feature done. Cover every applicable layer: Unit Tests, Component Tests, Integration Tests, API Tests and UI Tests. If one of these test types is not applicable to the feature, state why in the handoff instead of silently skipping it.
- After making any changes, immediately build the full project through [Build.ps1](Build.ps1) from the repository root. Skip this only when the chat was launched by Codex automation.
- C++ unit tests live in `backend/tests/` and use Google Test. When adding or changing backend functionality, add or update focused Google Test coverage for that behavior and run the relevant `ctest` target afterward.
- Tauri unit tests live in `frontend-tauri/tests/` and use Vitest. Tauri smoke/e2e tests live in `frontend-tauri/e2e/` and use Playwright.
- For Tauri UI/Rust shell/facade changes, prefer `npm run typecheck`, `npm test` and the smallest relevant Playwright smoke from `frontend-tauri/`.
- The removed WPF product frontend no longer has an active C# test suite. Validate UI and bridge work through Tauri tests and backend CTest as appropriate.
- Logging is part of feature work. Keep core/native, Tauri UI, Tauri Rust shell/bridge, operations and crash logs separated.
- Legal/privacy review is part of feature work. When adding an important feature, especially reports, telemetry, uploads, online services, external integrations, account flows, support bundles or any new data collection/storage/transfer, check whether the privacy policy and terms of use must be updated for German/EU legal expectations, including GDPR/DSGVO.
- When investigating any bug, check the program logs in `logs/` early and use relevant operation, bridge, core, UI, installer and crash entries to guide the diagnosis.
- Release distribution must use the approved installer/package pipeline. Do not commit, push, publish, attach or otherwise distribute a portable build folder or portable archive. The current approved Windows release artifact is `output-installer/FluxoraSetup.exe`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Graphify-first search policy:
- Before any broad repository search for files, symbols, features, bugs or ownership, run `graphify query "<question>"` when `graphify-out/graph.json` exists.
- Before using `rg`, `rg --files`, `grep`, `find`, `Get-ChildItem -Recurse`, IDE/global search or opening large file lists, ask Graphify first and use its result to choose the narrowest files, folders or symbols to inspect.
- Use `graphify explain "<concept>"` for a known symbol/concept and `graphify path "<A>" "<B>"` when investigating relationships between two areas.
- After Graphify returns a scoped result, raw search is allowed only inside the relevant folders/files or when Graphify returns no useful result. If falling back to raw search, say why.

Rules:
- For codebase questions, Graphify is the default navigation layer. These commands return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, project instructions or agent configuration, run `graphify update .` to keep the graph current (AST-only, no API cost).
