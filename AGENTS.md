# Fluxora Agent Instructions

Read `.agents/PROJECT_RULES.md` before making changes in this repository.

Current frontend reality:

- `backend/` is the C++ core. Business logic belongs there.
- `frontend-electron/` is the only product UI. New UI work belongs there.
- The old C# WPF product frontend has been removed. Do not recreate `frontend/`, `frontend.Tests/` or `Fluxora.App`; use `docs/electron-migration/wpf-ui-inventory.md` only as historical parity reference.
- Do not put UI responsibilities into C++.
- Do not put core business logic into Electron, TypeScript, JavaScript or C#.
- Split work into small focused services. Avoid master files, catch-all managers and god objects.
- Electron UI must be split by responsibility into small renderer services, stores/hooks and focused components; do not grow a single App/MainWindow/master file with catalog, workspace, settings, install or operation orchestration.

Electron migration rules:

- Before large UI, bridge or migration work, read `docs/electron-migration/README.md`, `docs/electron-migration/wpf-ui-inventory.md` and `docs/electron-migration/architecture.md`.
- Electron renderer owns UI state, routes, components, tables, trees, dialogs, accessibility and visual states only.
- Electron main/preload own app lifecycle, safe IPC, native dialogs, external links, shell-open behavior, single-instance/deep-link handling and bridge-host lifecycle.
- Renderer must not receive direct Node.js, filesystem, shell, native module or raw `ipcRenderer` access.
- Keep the Electron security baseline: `contextIsolation: true`, `nodeIntegration: false`, sandboxed windows by default, typed `contextBridge` APIs, allowlisted async IPC, controlled navigation and safe external-link handling.
- When changing the bridge contract, update DTO/protocol docs, tests and operation/logging expectations together.
- Bridge and user-triggered mutations must create or propagate an `operationId` through Electron UI, Electron main/preload, bridge host, C++ core, installer, deploy, rollback, cleanup and file-operation paths.

Validation rules:

- For any code change, use the relevant test skill. If no dedicated test skill is available, define the validation plan before editing and run the smallest relevant test or build afterward.
- C++ unit tests live in `backend/tests/` and use Google Test. When adding or changing backend functionality, add or update focused Google Test coverage for that behavior and run the relevant `ctest` target afterward.
- Electron unit tests live in `frontend-electron/tests/` and use Vitest. Electron smoke/e2e tests live in `frontend-electron/e2e/` and use Playwright.
- For Electron UI/preload/main changes, prefer `npm run typecheck`, `npm test` and the smallest relevant Playwright smoke from `frontend-electron/`.
- The removed WPF product frontend no longer has an active C# test suite. Validate UI and bridge work through Electron tests and backend CTest as appropriate.
- Logging is part of feature work. Keep core/native, Electron UI, Electron main/bridge, operations and crash logs separated.
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
