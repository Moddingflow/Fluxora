# Fluxora Mod Manager

Fluxora is a desktop mod manager built as part of the ModdingFlow ecosystem. The product architecture is a native C++ core with an Electron UI. The previous C# WPF product frontend has been removed after the Electron migration reached the Phase 17 removal step.

## Tech Stack

- **C++ Core**: native backend layer for domain behavior, filesystem operations, mod/profile/project management, downloads, installs, FluxPack, Nexus Mods, VFS, launch flows, native logging and low-level integration.
- **Electron UI**: TypeScript, React and Vite renderer in `frontend-electron/`, packaged through Electron Forge. The renderer is UI-only and talks to Fluxora through a typed preload API.
- **Bridge Target**: `fluxora.bridge.v1`, a typed native bridge host between Electron main and the C++ core. The bridge contract is documented in `docs/electron-migration/architecture.md`.

## Project Structure

```text
Fluxora/
├── backend/                         # C++ core project and business logic
│   ├── include/                     # Public backend headers
│   ├── src/                         # Backend implementation files
│   └── tests/                       # Google Test coverage for core behavior
├── frontend-electron/               # Target Electron UI
│   ├── src/main/                    # Electron main process
│   ├── src/preload/                 # contextBridge preload API
│   ├── src/renderer/                # React renderer UI
│   ├── tests/                       # Vitest unit tests
│   └── e2e/                         # Playwright Electron smoke tests
├── docs/electron-migration/         # Migration roadmap support docs
├── installer/                       # Installer project and legal resources
├── Icons/                           # Application icons and UI icon assets
├── LICENSE
└── README.md
```

## Backend

The backend is the native core of the mod manager. It owns all business behavior and file-changing work, including:

- project, profile, mod, plugin and download state;
- archive/FOMOD install and extraction behavior;
- FluxPack package/install flows;
- Nexus Mods and NXM protocol behavior;
- VFS and executable launch integration;
- operation, core, bridge and crash logging.

The backend CMake project lives in `backend`.

```powershell
cmake -S backend -B build/backend
cmake --build build/backend
ctest --test-dir build/backend --output-on-failure
```

## Electron Frontend

The target frontend lives in `frontend-electron/`. It owns window UI, routes, visual components, renderer state, accessibility, native dialogs through main/preload, and safe calls into the bridge. It must not duplicate C++ domain logic or expose Node.js, filesystem APIs, native modules, raw `ipcRenderer` or direct shell access to the renderer.

Electron security expectations follow the current Electron guidance: isolated renderer contexts, `nodeIntegration: false`, a typed `contextBridge` API, allowlisted async IPC, controlled navigation, safe external-link handling and no `sendSync`.

```powershell
cd frontend-electron
npm install
npm run dev
npm run typecheck
npm run build
npm test
npm run test:e2e
```

Read `docs/electron-migration/README.md` before large Electron UI, bridge or migration work.

## Migration Docs

- `docs/electron-migration/README.md` - current migration status, agent rules and validation entrypoints.
- `docs/electron-migration/wpf-ui-inventory.md` - WPF parity inventory and Electron target map.
- `docs/electron-migration/architecture.md` - Electron + C++ bridge architecture and `fluxora.bridge.v1` contract.
- `docs/electron-migration/release-pipeline.md` - Phase 15 installer/package policy, dry-run steps, artifact verification and legal/privacy checklist.

For bridge changes, update DTO/protocol docs, tests and operation/logging expectations together.

## Unique Features

- **Speed as the top priority.** Fluxora focuses on fast game startup, responsive UI feedback and minimal waiting while working with mods. Heavy operations stay in the native C++ core or bridge host so the Electron renderer remains responsive.
- **Full offline mode.** Installed games, profiles and mods remain available without an internet connection, so users can launch the game and play with the selected build even when offline.
- **One-click mod pack sharing.** Users can prepare and share their builds without manual packaging, complicated instructions or lengthy setup.
- **Import existing Mod Organizer 2 builds.** Fluxora helps import an existing MO2 build so users can continue working with it in this application.

## Build

The current release build entry point creates the Windows Electron application payload and the approved installer:

```powershell
./Build.ps1 -Configuration Release -Runtime win-x64
```

The script creates:

- `output/` - local Electron application payload staging. It is used only to assemble the installer payload and must not be published as a release artifact.
- `output-installer/` - `FluxoraSetup.exe`, the branded installer.

Electron Forge smoke packaging lives under `frontend-electron/`:

```powershell
cd frontend-electron
npm run build
npm run make
```

The release pipeline bundles the Electron app, native bridge host and C++ core through the approved installer/package flow. Do not publish Electron Forge output directly as a Fluxora release. See `docs/electron-migration/release-pipeline.md`.

## Release Policy

Fluxora releases are installer/package-pipeline only. For the current Windows release path, publish only `output-installer/FluxoraSetup.exe`; do not commit, push, upload, attach, zip or otherwise distribute `output/`, `frontend-electron/out/`, Forge smoke artifacts, `build/electron-native/` or any portable build folder.

Linux `.deb` and `.rpm` are the selected public candidates after native package smoke. macOS public distribution remains blocked on signing/notarization. The same rule remains: no loose staging folders or ad-hoc portable archives as release artifacts.

## Status

The repository is in the Phase 17 Electron reality: C++ core plus Electron UI are the active product surfaces. Historical WPF parity notes remain under `docs/electron-migration/`, but new product UI belongs in `frontend-electron/`.

## Ownership

Fluxora is part of ModdingFlow. See the `LICENSE` file for usage restrictions.
