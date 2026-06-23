# Fluxora Agent Instructions

Read `.agents/PROJECT_RULES.md` before making changes in this repository.

Core rules:

- C++ in `backend/` is the project core. Business logic belongs there.
- C# in `frontend/` is the WPF frontend. UI belongs there.
- Do not put UI responsibilities into C++.
- Do not put core business logic into C#.
- Split work into small focused services. Avoid master files, catch-all managers, and god objects.
- For any code change, use the relevant test skill. If no dedicated test skill is available, define the validation plan before editing and run the smallest relevant test or build afterward.
- C++ unit tests live in `backend/tests/` and use Google Test. When adding or changing backend functionality, add or update focused Google Test coverage for that behavior and run the relevant `ctest` target afterward.
- C# unit tests live in `frontend.Tests/` and use xUnit.net. Extend them for UI-layer behavior such as ViewModel state, commands, validation, sorting/filtering, DTO-to-UI mapping, bridge error handling, progress/status transitions, operation re-entry protection, and reactions to core events; do not try to cover every XAML file, button, color, or animation.
- Logging is part of feature work. Keep core/native, UI, bridge, operations, and crash logs separated; create/reuse an operation ID for user-triggered business operations and propagate it through C# UI, Bridge, C++ Core, Installer, deploy, rollback, cleanup, and file-operation paths. New features that mutate files, project/profile state, downloads, installs, external integrations, or launch/deploy/rollback state should add/update the relevant logs.
- Legal/privacy review is part of feature work. When adding an important feature, especially reports, telemetry, uploads, online services, external integrations, account flows, support bundles, or any new data collection/storage/transfer, check whether the privacy policy and terms of use must be updated for German/EU legal expectations, including GDPR/DSGVO. If needed, update all bundled legal documents before shipping and describe what data is processed, where it goes, why, retention/controls when relevant, and any third-party terms.
- When investigating any bug, check the program logs in `logs/` early and use relevant operation, bridge, core, UI, installer, and crash entries to guide the diagnosis.
- Release distribution must use the installer only. Never commit, push, publish, attach, or otherwise distribute the portable build folder or a portable archive; only `output-installer/FluxoraSetup.exe` may be used as a release artifact.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Graphify-first search policy:
- Before any broad repository search for files, symbols, features, bugs, or ownership, run `graphify query "<question>"` when `graphify-out/graph.json` exists.
- Before using `rg`, `rg --files`, `grep`, `find`, `Get-ChildItem -Recurse`, IDE/global search, or opening large file lists, ask Graphify first and use its result to choose the narrowest files, folders, or symbols to inspect.
- Use `graphify explain "<concept>"` for a known symbol/concept and `graphify path "<A>" "<B>"` when investigating relationships between two areas.
- After Graphify returns a scoped result, raw search is allowed only inside the relevant folders/files or when Graphify returns no useful result. If falling back to raw search, say why.

Rules:
- For codebase questions, Graphify is the default navigation layer. These commands return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, project instructions, or agent configuration, run `graphify update .` to keep the graph current (AST-only, no API cost).
