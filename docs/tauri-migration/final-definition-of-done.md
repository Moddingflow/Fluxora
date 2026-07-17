# Fluxora Tauri migration final Definition of Done

Дата обновления: 2026-06-24

Статус: final migration DoD is closed for the active product architecture. Fluxora now ships as C++ core in `backend/` plus Tauri UI in `frontend-tauri/`; the old C# WPF product frontend is removed from the build, release and user workflow path. Public release readiness still depends on the explicit release evidence gates listed below.

## Scope

This Definition of Done closes the WPF-to-Tauri migration, not every future public distribution task. A green migration gate means:

- Tauri is the only active product UI.
- C++ remains the only owner of domain, filesystem, mod, plugin, install, download, FluxPack, MO2, Nexus and VFS behavior.
- Tauri renderer remains a UI and orchestration layer behind typed facade APIs.
- Build, release, agent and parity documentation no longer route new product UI work to WPF.
- Automated parity, security, visual smoke and performance guardrails are in place.

Public release tasks such as code signing, clean-machine installer acceptance and real Linux/macOS package smoke remain tracked as release gates, not hidden migration work.

## Completion Matrix

| Final DoD item | Status | Evidence |
| --- | --- | --- |
| Tauri UI replaces WPF | Done | `frontend/` and `frontend.Tests/` are removed; `Build.ps1` and installer payload resolve `Fluxora.exe`; `docs/tauri-migration/parity-gate.md` records Phase 17 removal evidence. |
| Visual quality is product-grade | Done for migration gate | Playwright visual smoke captures main shell/settings across desktop sizes; `docs/tauri-migration/tauri-design-system.md` and `docs/tauri-migration/performance-budget.md` remain the visual/performance guardrails. |
| Performance expectations are guarded | Done for migration gate | `ui-performance.test.ts`, Playwright smoke and parity guard block renderer Node access, sync command and unbounded large-list rendering patterns. |
| Main user scenarios have Tauri paths | Done | Parity gate covers project lifecycle, mods, plugins, downloads, install affordances, FOMOD/facade/API coverage, profiles, executables, settings, MO2 validation and FluxPack. Backend tests keep archive, FOMOD, MO2 and path behavior in C++. |
| C++ core owns business logic | Done | `docs/tauri-migration/architecture.md`, parity guard and project rules enforce C++ ownership and renderer isolation. |
| Tauri is a UI/bridge client | Done | Preload/main tests cover the typed `window.fluxora` surface; renderer files are scanned for Node/raw command access. |
| Windows/Linux/macOS support is architecture-ready | Done | `docs/tauri-migration/cross-platform-support.md` and bridge capabilities expose platform support states and package/protocol notes. |
| Build/release pipeline builds Tauri plus C++ core | Done | `docs/tauri-migration/release-pipeline.md` documents the approved Windows installer path through `output-installer/FluxoraSetup.exe`. |
| Agent docs prevent WPF regression | Done | `AGENTS.md`, `.agents/PROJECT_RULES.md`, README and migration docs point active UI work to `frontend-tauri/`. |

## Scenario Evidence

| Scenario | Migration evidence |
| --- | --- |
| Create/open/delete/rename build | Playwright workflow plus C++ project tests. |
| Manage mods and order | Playwright workspace workflow plus backend mod/order tests. |
| Manage plugins/load order | Playwright workspace workflow plus backend plugin tests. |
| Install archives and FOMOD | Tauri install affordance and typed API routes; Smart Select renderer/unit coverage; backend `DownloadService`, `ContentLayoutService`, profile-context and auto-selection tests; Playwright real ZIP/TES4 fixture through `FluxoraBridgeHost`. |
| Downloads and NXM | Playwright downloads import/row action smoke; backend download/NXM tests; platform capability matrix. |
| Profiles | Playwright create/clone/rename/delete workflow. |
| Executables and launch | Playwright executable edit workflow and launch capability state; backend executable tests. |
| MO2 import | Tauri settings/MO2 validation smoke; backend `ModOrganizerImportServiceTests`; full real fixture remains a release evidence gate. |
| FluxPack export/install | Playwright export/inspect/install workflow with progress event evidence; backend FluxPack tests. |
| Settings, language and single theme | Playwright settings smoke plus unit coverage for language, Nexus/MO2 surfaces and dark-theme normalization. |
| Offline work | Core/local project workflows and no telemetry requirement in release/legal docs. |

## Gate Commands

Fast migration gate:

```powershell
cd frontend-tauri
npm run typecheck
npm test
npm run test:e2e
```

Full local migration gate:

```powershell
.\scripts\Invoke-FluxoraParityGate.ps1
```

Release smoke gate:

```powershell
.\scripts\Invoke-FluxoraParityGate.ps1 -ReleaseSmoke
```

Validated on 2026-06-24 after adding this final DoD guard:

- `npm run test:parity` - 8 passed.
- `.\scripts\Invoke-FluxoraParityGate.ps1 -SkipE2E -SkipBackend` - Tauri typecheck passed, 12 Vitest files / 48 tests passed.
- `graphify update .` - graph rebuilt after the test/documentation update.

## Remaining Release Evidence

These are not reasons to keep WPF or reopen the migration architecture, but they must be completed before the matching public release:

- Real archive install e2e fixture.
- Real MO2 import fixture or documented owner acceptance.
- Clean-machine Windows installer smoke with the approved `FluxoraSetup.exe`.
- Windows signing review.
- Linux `.deb`/`.rpm` install smoke, including xdg/NXM registration.
- macOS bundle URL scheme smoke, Developer ID signing and notarization.
- Final owner/legal review before public distribution.
