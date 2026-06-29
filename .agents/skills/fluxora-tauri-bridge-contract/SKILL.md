---
name: fluxora-tauri-bridge-contract
description: Fluxora Tauri bridge and facade workflow. Use when changing frontend-tauri typed window.fluxora APIs, frontend-tauri/src/tauri facade code, frontend-tauri/src-tauri Rust commands, Tauri capabilities, bridge-host lifecycle, DTOs, protocol envelopes, native command routing, operationId propagation, or tests/docs for renderer-to-C++ integration.
---

# Fluxora Tauri Bridge Contract

## Contract

The renderer talks to Fluxora native behavior through the typed `window.fluxora` facade. The Tauri Rust shell owns safe OS/app affordances and bridge-host lifecycle. The C++ core owns business behavior.

Do not bypass this contract with direct renderer Node.js, filesystem, shell, native module access, plugin imports for shell affordances, or scattered raw `Tauri invoke` calls.

## First Pass

1. Read `.agents/PROJECT_RULES.md`.
2. Use `graphify query "<bridge/facade task>"` when `graphify-out/graph.json` exists.
3. Inspect the current facade/Rust/capability/doc/test shape before assuming file layout.
4. If the task asks about Tauri, React, Vitest, Playwright, or another library/API behavior, use Context7 docs before relying on memory.

## Ownership Map

- Renderer facade: keep typed APIs in `frontend-tauri/src/tauri/fluxora-api.ts` or the current local facade module.
- Rust shell: keep app lifecycle, window controls, native dialogs, safe external links, shell open/reveal, single-instance/deep-link handling, runtime capability discovery, and bridge-host lifecycle in `frontend-tauri/src-tauri/`.
- C++ core: keep install/import/delete/deploy/rollback, archive/file-system, profile/project, persistence, VFS, and mod-management business logic in `backend/`.
- Capabilities: keep `frontend-tauri/src-tauri/capabilities/` aligned with the Rust-owned surface. Remove direct plugin permissions when the renderer no longer needs them.
- Docs/tests: update architecture/protocol docs and regression tests when the bridge contract changes.

## DTO And Command Changes

When adding or changing a bridge method:

1. Define the renderer-facing TypeScript type first, matching the real domain DTO rather than UI convenience shape.
2. Add/adjust the Rust command as a thin validated shell wrapper.
3. Route business behavior to the bridge host/C++ core instead of implementing it in Rust or TypeScript.
4. Preserve async command boundaries; do not add synchronous native calls from renderer.
5. Update tests that prove renderer facade, Rust command registration, capabilities, and bridge payload expectations.
6. Update docs/logging expectations in the same change when the protocol envelope or behavior changes.

## OperationId Rule

For any user-triggered mutation or business operation:

- create or reuse an `operationId` at the UI/operation boundary;
- pass it through renderer facade, Rust shell/facade, bridge host, C++ core, installer/deploy/rollback/cleanup/file operations;
- include it in relevant UI/bridge/core/operation/crash logs;
- avoid losing it in helper wrappers, error adapters, progress callbacks, and cleanup paths.

## Error Handling

- Return typed, user-actionable errors to the renderer.
- Keep technical details in logs where useful.
- Do not convert bridge/core errors into generic "failed" UI copy when the user can take a specific action.
- Keep cancellation, timeout, permission, missing-path, validation, and native-startup failures distinct.

## Validation

Choose the smallest relevant set, then escalate when the touched surface requires it:

- `npm run typecheck` from `frontend-tauri/` for TypeScript facade/API changes.
- `npm test` from `frontend-tauri/` for renderer, facade, Rust-shell-facing unit coverage.
- Targeted Playwright smoke from `frontend-tauri/e2e/` for startup/window/workflow behavior.
- `cargo check` or `npm run build` when Rust shell, Tauri config, capabilities, resources, or packaging behavior changes.
- Relevant backend CTest when bridge changes expose or depend on C++ behavior.
- Repository-root `.\Build.ps1 -Configuration Release` after code changes unless automation/user scope says otherwise.
- `graphify update .` after code, docs, project-rule, or agent-configuration changes.

## Common Pitfalls

- Do not assume `frontend-tauri/src-tauri/src/lib.rs` layout; reopen the file and patch small exact spans.
- Do not guess crate/plugin signatures; confirm with local code or current docs.
- Do not leave renderer permissions broader than the real command surface.
- Do not validate a `.test.tsx` file if the local Vitest include only matches `.test.ts`.
- Do not treat the Tauri bundler smoke artifact as the approved Fluxora public release artifact; use the installer pipeline.
