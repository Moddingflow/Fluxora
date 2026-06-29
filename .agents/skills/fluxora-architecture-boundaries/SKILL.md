---
name: fluxora-architecture-boundaries
description: Fluxora repository architecture guardrails. Use when working in C:\Fluxora or close Fluxora copies on feature work, refactoring, bug fixes, roadmap phases, code review, or documentation that may affect ownership between backend C++ core, frontend-tauri UI, Tauri Rust shell/facade, installer/release, logging, legal/privacy, or validation.
---

# Fluxora Architecture Boundaries

## Core Rule

Keep Fluxora code in the layer that owns it:

- Put business logic, domain rules, native integration, installer logic, mod-management behavior, file-system behavior, persistence, and low-level services in `backend/`.
- Put product UI, windows, routes, visual state, renderer stores/hooks, components, accessibility, tables, trees, dialogs, and local UI orchestration in `frontend-tauri/`.
- Put app lifecycle, safe commands, native dialogs, external links, shell-open/show-in-folder, single-instance/deep-link handling, and bridge-host lifecycle in the Tauri Rust shell/facade.
- Do not recreate the removed WPF product frontend: no new `frontend/`, `frontend.Tests/`, or `Fluxora.App` product work.
- Do not move core business logic into Tauri, TypeScript, JavaScript, Rust shell, or C# because it is convenient.

## Start Of Task

1. Read `.agents/PROJECT_RULES.md` before making code changes.
2. If `graphify-out/graph.json` exists and the task needs repository navigation, run `graphify query "<task/question>"` before broad `rg`, recursive listings, or global searches.
3. Identify the touched ownership surface before editing: `backend`, `frontend-tauri` renderer, Tauri Rust shell, bridge/facade contract, installer/release, docs, logs, or legal/privacy.
4. State the smallest validation plan before editing when the task changes code.

## Service Shape

- Prefer existing service boundaries first.
- Create a small focused service when no boundary fits.
- Avoid master files, catch-all managers, global orchestrators, and single-file growth in renderer or backend.
- Keep renderer services limited to typed bridge orchestration and view-state shaping.
- Keep filesystem decisions and domain behavior in the C++ core.

## Tauri Security Baseline

- Do not give the renderer direct Node.js, filesystem, shell, native module, or scattered raw `Tauri invoke` access.
- Use the typed `window.fluxora` facade and allowlisted async commands.
- Preserve sandboxed webviews, controlled navigation, safe external-link handling, and Content Security Policy.
- When a bridge method, DTO, or protocol envelope changes, update docs, tests, and logging expectations together.

## Logging And Operations

- Preserve separate logs for core/native, Tauri UI, Tauri Rust shell/bridge, operations, and crashes.
- For user-triggered business mutations, create or propagate `operationId` from UI through Rust shell/facade, bridge host, C++ core, installer/deploy/rollback/cleanup, and file-operation paths.
- Log real business and filesystem behavior, not purely visual UI state.

## Legal And Privacy Check

For reports, telemetry, diagnostics, crash/support bundles, uploads, downloads, cloud/online services, account/auth, third-party APIs, payments, analytics, notifications, or new data collection/storage/transfer:

- Check whether bundled privacy policy and terms of use need updates.
- Review with German/EU GDPR/DSGVO expectations in mind.
- If final legal wording is uncertain, add an owner/legal-review note instead of inventing legal advice.

## Validation

- Backend changes: add/update focused Google Test coverage in `backend/tests/` where practical and run the relevant CMake/CTest target.
- Tauri UI/Rust shell/facade changes: prefer `npm run typecheck`, `npm test`, and the smallest relevant Playwright smoke from `frontend-tauri/`.
- Release-affecting changes: include `npm run build` or the appropriate packaging check.
- After any code, project-rule, or agent-configuration change, run `graphify update .`.
- After code changes in this repo, run the repository-root `.\Build.ps1 -Configuration Release` unless the task was launched by automation or the user explicitly scoped validation differently. Do not add borrowed flags such as `-NoPause` without checking the local script.

## Done Criteria

Before final response, confirm:

- ownership stayed in the correct layer;
- no removed WPF product path was recreated;
- bridge/security/logging/privacy implications were handled when relevant;
- targeted validation and `Build.ps1` status are reported honestly;
- any skipped validation has a concrete reason.
