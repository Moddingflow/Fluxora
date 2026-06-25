# Fluxora Mod Manager

Fluxora is a desktop mod manager built as part of the ModdingFlow ecosystem. The product architecture is a native C++ core with a Tauri UI. The previous C# WPF product frontend has been removed and is no longer an active product path.

## Tech Stack

- **C++ Core**: native backend layer for domain behavior, filesystem operations, mod/profile/project management, downloads, installs, FluxPack, Nexus Mods, VFS, launch flows, native logging and low-level integration.
- **Tauri UI**: TypeScript, React and Vite renderer in `frontend-tauri/`, packaged through Tauri bundler. The renderer is UI-only and talks to Fluxora through a typed `window.fluxora` facade.
- **Bridge Target**: `fluxora.bridge.v1`, a typed native bridge host between the Tauri Rust shell and the C++ core. The bridge contract is documented in the current architecture documentation.

## Project Structure

```text
Fluxora/
├── backend/                         # C++ core project and business logic
│   ├── include/                     # Public backend headers
│   ├── src/                         # Backend implementation files
│   └── tests/                       # Google Test coverage for core behavior
├── frontend-tauri/                  # Target Tauri UI
│   ├── src-tauri/                   # Rust shell, Tauri config and capabilities
│   ├── src/tauri/                   # Typed window.fluxora facade
│   ├── src/renderer/                # React renderer UI
│   ├── tests/                       # Vitest unit tests
│   └── e2e/                         # Playwright Tauri smoke tests
├── docs/                           # Product architecture, release and archived migration docs
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

## Tauri Frontend

The target frontend lives in `frontend-tauri/`. It owns window UI, routes, visual components, renderer state, accessibility, native dialogs through the typed facade, and safe calls into the bridge. It must not duplicate C++ domain logic or expose Node.js, filesystem APIs, native modules, scattered raw `Tauri invoke` or direct shell access to the renderer.

Tauri security expectations follow the current Tauri guidance: sandboxed webviews, a typed `window.fluxora` API, allowlisted async commands, controlled navigation, safe external-link handling and no synchronous native calls from renderer code.

Tauri builds require the Rust stable toolchain (`cargo` and `rustc`) in `PATH`; install it with `rustup` before running package or release commands on a new machine.

```powershell
cd frontend-tauri
npm install
npm run dev
npm run typecheck
npm run build
npm test
npm run test:e2e
```

Before large Tauri UI or bridge work, follow `AGENTS.md` and the current architecture, release and validation documentation.

## Documentation

- `docs/tauri-migration/README.md` - historical WPF-to-Tauri migration record and validation notes.
- `docs/tauri-migration/wpf-ui-inventory.md` - archival WPF parity inventory and Tauri target map.
- `docs/tauri-migration/architecture.md` - Tauri + C++ bridge architecture and `fluxora.bridge.v1` contract.
- `docs/tauri-migration/release-pipeline.md` - installer/package policy, dry-run steps, artifact verification and legal/privacy checklist.

For bridge changes, update DTO/protocol docs, tests and operation/logging expectations together.

## Unique Features

- **Speed as the top priority.** Fluxora focuses on fast game startup, responsive UI feedback and minimal waiting while working with mods. Heavy operations stay in the native C++ core or bridge host so the Tauri renderer remains responsive.
- **Full offline mode.** Installed games, profiles and mods remain available without an internet connection, so users can launch the game and play with the selected build even when offline.
- **One-click mod pack sharing.** Users can prepare and share their builds without manual packaging, complicated instructions or lengthy setup.
- **Import existing Mod Organizer 2 builds.** Fluxora helps import an existing MO2 build so users can continue working with it in this application.

## Build

The current release build entry point creates the Windows Tauri application payload and the approved installer:

```powershell
./Build.ps1 -Configuration Release -Runtime win-x64
```

The script creates:

- `output/` - local Tauri application payload staging. It is used only to assemble the installer payload and must not be published as a release artifact.
- `output-installer/` - `FluxoraSetup.exe`, the branded installer.

Tauri bundler smoke packaging lives under `frontend-tauri/`:

```powershell
cd frontend-tauri
npm run build
```

The release pipeline bundles the Tauri app, native bridge host and C++ core through the approved installer/package flow. Do not publish Tauri bundler output directly as a Fluxora release. See the current release pipeline documentation.

## Release Policy

Fluxora releases are installer/package-pipeline only. For the current Windows release path, publish only `output-installer/FluxoraSetup.exe`; do not commit, push, upload, attach, zip or otherwise distribute `output/`, `frontend-tauri/src-tauri/target/`, Tauri smoke artifacts, `build/tauri-native/` or any portable build folder.

Linux `.deb` and `.rpm` are the selected public candidates after native package smoke. macOS public distribution remains blocked on signing/notarization. The same rule remains: no loose staging folders or ad-hoc portable archives as release artifacts.

## Status

Fluxora’s active product architecture is C++ core plus Tauri UI. Historical WPF parity notes remain under `docs/tauri-migration/`, but new product UI belongs in `frontend-tauri/`.

## Ownership

Fluxora is part of ModdingFlow. See the `LICENSE` file for usage restrictions.
