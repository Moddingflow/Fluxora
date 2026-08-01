# Fluxora Agent Rules

These rules are project-specific and apply to all Codex/agent work in this repository.

## Architecture Boundaries

- C++ is the project core. Put business logic, domain rules, native integration, installer logic, mod-management behavior, file-system behavior and low-level services in `backend/`.
- Do not put UI code in C++ unless it is required by native platform integration and has no Tauri UI responsibility.
- Tauri is the only product frontend. Put all application UI, windows, routes, visual state, renderer stores, components, accessibility behavior and local UI orchestration in `frontend-tauri/`.
- The old C# WPF product frontend has been removed. Do not create new `frontend/`, `frontend.Tests/` or `Fluxora.App` work; historical WPF parity material is archival only and must not route new product UI work.
- Do not put business logic in Tauri, TypeScript, JavaScript or C# when it belongs to the core. UI layers may orchestrate workflows and call backend/bridge services, but core behavior stays in C++.
- Tauri renderer must not get direct Node.js, filesystem, shell, native module or scattered raw `Tauri invoke` access. Use the typed `window.fluxora` facade and allowlisted async commands.
- Tauri Rust shell owns app lifecycle, secure commands, native dialogs, safe external links, shell-open/show-in-folder behavior, single-instance/deep-link handling and bridge-host lifecycle.

## Tauri Product Source Of Truth

- Before large UI or bridge tasks, read the current architecture, bridge contract, release and validation documentation. Treat WPF migration notes as archival references only.
- New UI tasks go to Tauri. WPF product-frontend work is not an active path after Phase 17.
- Keep any WPF references clearly marked as historical migration/reference notes in new documentation.
- When a bridge method, DTO or protocol envelope changes, update the architecture/protocol docs, tests and logging expectations in the same change.
- Preserve the Tauri security baseline from the architecture docs: sandboxed webviews by default, typed `window.fluxora` API, no scattered raw command exposure, no synchronous native calls from renderer, navigation controls, safe external-link handling and Content Security Policy.

## Service Shape

- Split behavior into small, focused services.
- UI work follows the same service split: keep Tauri renderer orchestration in small renderer services, stores/hooks and focused components.
- Renderer UI services may orchestrate typed bridge calls and shape view state only; domain behavior and filesystem decisions still belong in C++ core services.
- Avoid large master files, catch-all managers and god objects.
- Prefer clear ownership: one service should have one main responsibility.
- When adding functionality, first look for an existing service boundary. If none fits, create a small new service instead of expanding an unrelated one.

## Change Process

- For any code change, use the relevant test skill before and after implementation.
- If no dedicated test skill is available in the current agent environment, define the validation plan before editing and run the smallest relevant automated test or build after editing.
- After making any changes, immediately build the full project through the repository-root `Build.ps1`. Skip this only when the chat was launched by Codex automation.
- When investigating any bug, check the program logs in `logs/` early and use relevant operation, bridge, core, UI, installer and crash entries to guide the diagnosis.
- Keep changes scoped to the requested behavior and avoid unrelated refactors.
- Preserve user changes already present in the worktree.
- After modifying code, project instructions or agent configuration, run `graphify update .`.

## Skill Selection

- At task start, match the request against available skill names and short descriptions only. Do not read every `SKILL.md`, scan full skill folders, or recurse through skill assets to discover possible matches.
- Use the smallest directly relevant skill set. Prefer a specific Fluxora, Tauri, roadmap, validation or task skill over broad design, frontend, migration or testing skills.
- Once a skill is selected, read its `SKILL.md` completely, then open only the directly referenced instructions, references, scripts, templates or assets needed for the current task variant.
- Do not load unrelated skill references, examples, sibling skills or entire skill directories for context.
- If no dedicated skill clearly applies, stop skill lookup, define the validation plan from these repository rules, and run the smallest relevant checks.

## Validation Expectations

- New feature work must include test coverage as part of the same change, not as a deferred follow-up. Add or update every applicable category: Unit Tests, Component Tests, Integration Tests, API Tests and UI Tests. If a category genuinely does not apply, document the reason in the handoff and keep the remaining coverage focused on the changed behavior.
- Backend changes should be validated with the relevant CMake build and targeted Google Test/CTest run when available.
- C++ unit tests are built with Google Test in `backend/tests/`. Keep extending that suite as backend behavior grows: every new or changed core function should get focused Google Test coverage unless there is a clear reason it cannot be tested directly.
- Tauri changes should be validated from `frontend-tauri/` with the smallest relevant command:
  - `npm run typecheck` for TypeScript/API shape changes;
  - `npm test` for Rust shell/facade/renderer unit behavior;
  - `npm run test:e2e` or a targeted Playwright command for app startup, renderer and workflow smoke;
  - `npm run build` when packaging, Tauri config, Rust shell/facade build or release-affecting behavior changes.
- The removed WPF product frontend no longer has an active C# test suite. Cross-layer changes should validate the C++ backend boundary and the Tauri bridge/Rust shell/facade integration path.

## Release Distribution

- Fluxora releases are installer/package-pipeline only. Never commit, push, publish, attach or distribute the portable build folder, loose portable files, portable zip archives or any equivalent portable package.
- The current approved Windows public release artifact is the branded installer produced as `output-installer/FluxoraSetup.exe`.
- The `output/` folder is a local build staging area used to create the installer payload. Treat it as temporary build output, not as a distributable product.
- Tauri bundler output under `frontend-tauri/` is a migration/build artifact until the release phase defines approved Windows/Linux/macOS public artifacts.

## Logging Expectations

- Fluxora keeps separate crash-safe logs for core/native work, Tauri UI work, Tauri Rust shell/bridge work, operations and crashes. Preserve that split when adding or changing features.
- User-triggered business operations must create or reuse an operation id at the UI/installer boundary, then keep it flowing through Tauri UI, Tauri Rust shell/facade, bridge host, native C++ core, installer, deploy, rollback, cleanup and file-operation paths.
- Log real business behavior and filesystem behavior: startup paths, selected game/profile/project paths, install/import/delete/deploy/rollback stages, archive validation/extraction, copy/move/delete/rename failures, metadata writes, launch/VFS setup, progress callback failures and native bridge failures.
- Do not log purely visual UI state, colors, animation details or noisy polling unless it directly explains a business operation.
- When adding a feature that changes files, native state, project/profile state, downloads, installs, deploys, rollback/cleanup or external integration state, add or update the relevant UI/bridge/core/operation/crash log entries as part of the feature.
- Use `operationId` consistently in new logs. The expected chain is: UI creates an operation id and logs the request, Tauri Rust shell/bridge logs the native call start/result, Core/Installer logs domain stages and file operations, and crash/error logs preserve the same operation id when available.

## Legal And Privacy Expectations

- Treat legal/privacy review as part of feature work, not as a separate afterthought.
- When adding an important feature, check whether the bundled privacy policy and terms of use need updates. This especially applies to reports, telemetry, diagnostics, crash/support bundles, uploads, downloads, cloud or online services, account/auth flows, third-party APIs, external integrations, payments, subscriptions, analytics, notifications or any new collection, storage, processing, disclosure or transfer of user/device/project data.
- Review the legal documents with German/EU expectations in mind, including GDPR/DSGVO transparency requirements. If a feature changes data processing, document the relevant data categories, purpose, legal basis or consent/opt-in flow when applicable, recipients or third-party services, transfer destination, retention or deletion behavior and user controls.
- If a feature depends on a third-party service or terms, make sure the terms of use and privacy policy describe that dependency clearly enough for users before they enable or use it.
- Update every bundled legal document/localization that ships in Setup and the product when a legal/privacy change is needed. The single desktop source lives under `legal/desktop/{en,de,ru}/` and is bound by `legal/desktop/manifest.json`.
- If the correct legal wording is uncertain, do not invent final legal advice. Add a clear implementation note/TODO for owner or legal review and explain the risk in the handoff.

## Backend Integration Test Areas

- C++ file-operation integration tests live in `backend/tests/` alongside the Google Test suite. Extend them when changing mod install/delete behavior, archive extraction, profile load order, conflict summaries, manifest/database persistence, virtual file-system file views, transferred build paths or bridge-facing path/string handling.
- Keep archive tests security-focused: path traversal entries, absolute/rooted paths, case-only duplicate paths on Windows, Unicode paths, spaces, Cyrillic, German characters and normal English paths should stay covered as the installer evolves.
- Reinstall/update, read-only or access-denied replacement failures and broader virtual file-system scenarios are expected future integration-test additions when those behaviors are implemented or changed.

## Graphify-First Navigation

- Before any broad repository search for files, symbols, features, bugs, ownership or architecture, run `graphify query "<question>"` when `graphify-out/graph.json` exists.
- Use `graphify explain "<concept>"` for known concepts and `graphify path "<A>" "<B>"` for relationships between areas.
- Use `rg`, recursive directory listings and other global searches only after Graphify has narrowed the likely files/folders, or when Graphify returns no useful result. If falling back to raw search, explain why.
- After modifying code, project instructions or agent configuration, run `graphify update .`.
