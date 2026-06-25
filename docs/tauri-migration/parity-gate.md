# Fluxora Tauri parity gate

Дата обновления: 2026-06-24

Статус: Phase 17 deprecation and removal is in place. The automated Windows-local gate was green on 2026-06-24, and the old C# WPF product frontend has now been removed from the active repository/build/release path.

Final migration Definition of Done is tracked in `docs/tauri-migration/final-definition-of-done.md`. That document closes the active WPF-to-Tauri migration and keeps remaining public-release evidence separate from migration completion.

## Gate commands

Fast Tauri gate:

```powershell
cd frontend-tauri
npm run typecheck
npm test
npm run test:parity
npm run test:e2e
```

Full local gate:

```powershell
.\scripts\Invoke-FluxoraParityGate.ps1
```

Release smoke gate:

```powershell
.\scripts\Invoke-FluxoraParityGate.ps1 -ReleaseSmoke
```

`npm test` includes the parity guard in `frontend-tauri/tests/parity-gate.test.ts`. `npm run test:parity` runs only that guard when a faster checklist drift check is enough.

Checked on 2026-06-24:

- `npm run test:parity` - 8 passed.
- `npm run typecheck` - passed.
- `npm test` - 12 files, 48 tests passed.
- `npm run test:e2e` - package build passed; 3 Playwright tests passed.
- `cmake --build .\build\backend --config Debug --target FluxoraCoreTests` - passed.
- `ctest --test-dir .\build\backend -C Debug --output-on-failure` - 209 tests passed.
- `.\scripts\Invoke-FluxoraParityGate.ps1 -SkipE2E -SkipBackend` - script syntax and fast Tauri path passed after the final DoD guard update.
- `.\scripts\Invoke-FluxoraParityGate.ps1 -SkipE2E -SkipBackend -ReleaseSmoke` - approved Windows installer smoke passed and produced `output-installer\FluxoraSetup.exe`.

## Unit coverage matrix

| Phase 16 requirement | Gate | Evidence |
| --- | --- | --- |
| Renderer stores/hooks | Automated | `frontend-tauri/tests/*-workspace-state.test.ts`, `frontend-tauri/tests/project-catalog-state.test.ts` |
| Preload exposed API | Automated | `frontend-tauri/tests/facade-api.test.ts` |
| Bridge DTO mapping | Automated | `frontend-tauri/tests/bridge-protocol-client.test.ts`, facade API route assertions |
| Validation helpers | Automated | project draft validation, install mod-name validation, profile/executable state tests |
| Wizard state machines | Automated | create-project step validation, FOMOD selection/evaluation, MO2 transfer validation state |

Required unit anchors:

- `project-catalog-state.test.ts` covers project/template filtering and create wizard step completion.
- `mod-workspace-state.test.ts` covers mod list state, row/windowing helpers and mod UI formatting.
- `plugin-workspace-state.test.ts` covers plugin/load-order UI state.
- `download-workspace-state.test.ts` covers download filtering, state labels and row actions.
- `install-workspace-state.test.ts` covers mod-name validation, archive placement overrides and FOMOD wizard state.
- `profiles-executables-workspace-state.test.ts` covers profile and executable UI state.
- `settings-workspace-state.test.ts` covers settings sections, single-theme normalization, language and MO2 transfer validation state.
- `build-workspace-state.test.ts` covers build paths and FluxPack UI state.
- `facade-api.test.ts` covers the typed `window.fluxora` surface and allowlisted command routes.
- `bridge-protocol-client.test.ts` covers JSON-RPC metadata, error envelopes and progress events.
- `ui-performance.test.ts` covers renderer virtual window bounds.

## E2E coverage matrix

| Phase 16 scenario | Current gate | Evidence |
| --- | --- | --- |
| Startup | Automated | Playwright secure shell smoke |
| Create/open project | Automated | Playwright creates a temporary project and opens its workspace |
| Mod list operations | Automated | Playwright creates a mod/separator, searches, toggles enablement and expands file tree |
| Plugin operations | Automated | Playwright creates a plugin separator, searches and toggles plugin enablement |
| Downloads/install | Partial automated | Playwright imports a local archive and checks download row install affordance; full archive install is covered by API/backend tests and still needs a real archive e2e fixture |
| FOMOD | Partial automated | Vitest covers wizard state and facade routes expose FOMOD calls; a real FOMOD archive e2e fixture remains a fixture-hardening item |
| Profiles | Automated | Playwright create/clone/rename/delete profile flow |
| Executables | Automated | Playwright save/rename/delete executable flow and launch capability state |
| Settings | Automated | Playwright settings sections, language/Nexus/MO2 transfer surfaces; theme customization is absent while the single dark theme is supported |
| MO2 transfer | Automated validation smoke | Playwright opens MO2 transfer and verifies required-field validation; full import needs a real MO2 fixture |
| FluxPack | Automated | Playwright export/inspect/install flow with progress events |

## Backend gate

Backend parity remains C++ owned. Phase 16 requires:

```powershell
cmake --build .\build\backend --config Debug --target FluxoraCoreTests
ctest --test-dir .\build\backend -C Debug --output-on-failure
```

Backend test anchors for parity-critical domains:

- `ProjectServiceTests.cpp`
- `BuildPathSettingsServiceTests.cpp`
- `DownloadServiceTests.cpp`
- `ContentLayoutServiceTests.cpp`
- `FomodInstallerServiceTests.cpp`
- `PluginServiceTests.cpp`
- `ModOrganizerImportServiceTests.cpp`
- `FluxPackServiceTests.cpp`
- `ExecutableServiceTests.cpp`
- `PathSafetyServiceTests.cpp`

Bridge API changes must also update the Tauri facade/Rust shell tests and add backend/API contract coverage when the C++ adapter behavior changes.

## Visual and performance gate

Automated Tauri checks:

- Playwright captures desktop screenshots for 1280x720, 1440x900, 1920x1080 and 2560x1080.
- Playwright verifies no renderer Node exposure.
- `parity-gate.test.ts` blocks `sendSync` and synchronous filesystem/process APIs in Tauri source.
- `ui-performance.test.ts` keeps virtual list/tree windowing bounded.
- `docs/tauri-migration/performance-budget.md` remains the budget source of truth.

WPF baseline capture is no longer a blocking input after Phase 17 removal. The historical WPF inventory remains in `docs/tauri-migration/wpf-ui-inventory.md`, while ongoing visual/performance evidence should compare Tauri against the budgets and release acceptance checks in this document and `performance-budget.md`.

## Manual acceptance gate

Manual acceptance must not be replaced by a green automated smoke. Required before public release:

- Walk every screen listed in `docs/tauri-migration/wpf-ui-inventory.md`.
- Run real Windows user scenarios for project lifecycle, mods, plugins, downloads/install, FOMOD, profiles, executables, settings, MO2 transfer and FluxPack.
- Run Linux and macOS smoke according to `docs/tauri-migration/cross-platform-support.md`.
- Verify capability states are honest where a platform or native feature is limited.
- Confirm there is no Tauri-missing scenario still needed for normal Fluxora use.

## Phase 17 deprecation and removal

Removal evidence:

- `Build.ps1` is Tauri-only and no longer accepts `-Frontend LegacyWpf`.
- `frontend/` and `frontend.Tests/` are removed from the active repository structure.
- Installer UI helper assets/classes are owned by `installer/Fluxora.Installer/`, not linked from the removed frontend.
- Installer core resolves the installed app through `Fluxora.exe` only.
- README, AGENTS and project rules state that new product UI belongs in `frontend-tauri/`.

## Release smoke gate

Windows release smoke remains installer-only:

```powershell
.\Build.ps1 -Configuration Release -Runtime win-x64
```

Required artifact:

- `output-installer/FluxoraSetup.exe`

Do not publish `output/`, `frontend-tauri/src-tauri/target/`, Tauri bundler output or ad-hoc portable archives.

## Final migration Definition of Done

The final migration DoD is considered closed when these remain true:

- Tauri is the only active product UI.
- WPF is absent from active build, release and user workflow paths.
- C++ owns business logic, filesystem work and domain mutations.
- Tauri renderer remains isolated from Node/raw command and acts only through typed facade APIs.
- Main user scenarios have Tauri workflow evidence in Playwright, Vitest, backend tests or release acceptance gates.
- Visual and performance guardrails are documented and tested.
- Windows/Linux/macOS platform states are exposed through capabilities and documented support matrix.
- Public release gates remain explicit instead of being treated as hidden migration tasks.

## Pending release evidence

These items remain release-hardening gates after Phase 17:

- Real archive install e2e fixture.
- Real FOMOD archive e2e fixture.
- Real MO2 import fixture or documented owner acceptance.
- Linux `.deb`/`.rpm` install smoke.
- macOS bundle/signing/notarization smoke.
- Clean-machine Windows installer smoke with the approved `FluxoraSetup.exe`.
