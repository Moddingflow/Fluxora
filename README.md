<div align="center">
  <img src="Icons/Fluxora.png" alt="Fluxora logo" width="104" />

  <h1>Fluxora</h1>

  <p>A fast, native-first Skyrim mod manager for large builds, Nexus Mods workflows, VFS launch, FluxPack sharing and AI-assisted mod research.</p>

  <p>
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.x-24C8DB?style=flat-square" />
    <img alt="C++ Core" src="https://img.shields.io/badge/Core-C%2B%2B-00599C?style=flat-square" />
    <img alt="React" src="https://img.shields.io/badge/UI-React%20%2B%20TypeScript-61DAFB?style=flat-square" />
    <img alt="Release" src="https://img.shields.io/badge/Release-Installer%20only-6E56CF?style=flat-square" />
    <img alt="License" src="https://img.shields.io/badge/License-Proprietary-lightgrey?style=flat-square" />
  </p>
</div>

## Overview

Fluxora is a Windows-first Tauri desktop app with a native C++ mod manager core. It is built for serious Skyrim modding: large profiles, Nexus Mods downloads, Mod Organizer 2 migration, virtual file system launch, plugin and mod ordering, archive installs, FluxPack packaging and build-aware AI diagnostics.

The active product UI lives in `frontend-tauri/`. The C++ core in `backend/` owns domain behavior, filesystem changes, downloads, installs, VFS integration and launch flows. The old C# WPF frontend has been removed; WPF migration documents remain only as historical reference.

## Highlights

- **Native mod workspace**: manage installed mods, separators, enable state, profile order, plugin load order, lazy file trees and overwrite relationships.
- **Nexus Mods workflow**: OAuth/API-key compatibility, NXM link capture, download queue management, local archive import and install actions.
- **Install experience**: archive layout analysis, FOMOD flows, replace/merge decisions, placement details and operation progress.
- **Skyrim automation**: VFS launch support, Parallax Gen output setup and No Grass In Objects grass cache generation.
- **Build portability**: import existing Mod Organizer 2 builds and export or install `.fluxpack` packages for one-click build sharing.
- **AI-assisted modding**: local build context, Nexus/web-backed research, requirements audits, recommendations and troubleshooting through the Fluxora AI host.
- **Secure desktop boundary**: renderer code uses a typed `window.fluxora` facade instead of direct filesystem, shell, Node.js or native module access.

## Architecture

```text
Tauri renderer
  -> typed window.fluxora facade
  -> Tauri Rust command layer
  -> native bridge host
  -> FluxoraCore C++ services
```

| Layer | Responsibility |
| --- | --- |
| `backend/` | C++ core for projects, profiles, mods, plugins, downloads, installs, FluxPack, Nexus Mods, VFS, launch and logging. |
| `frontend-tauri/src-tauri/` | Rust shell for app lifecycle, allowlisted commands, native dialogs, safe external links and bridge-host management. |
| `frontend-tauri/src/renderer/` | React UI, routes, visual state, accessibility, tables, dialogs and local orchestration. |
| `frontend-tauri/src/shared/` | Shared TypeScript contracts for bridge-facing DTOs and renderer/runtime helpers. |
| `installer/` | Approved Windows installer pipeline and bundled legal resources. |

The bridge protocol is `fluxora.bridge.v1`. UI code must not duplicate C++ domain rules; core behavior stays in the native services.

## Repository

```text
Fluxora/
├── backend/              # Native C++ core, VFS support and Google Test coverage
├── frontend-tauri/       # Tauri 2 app, React renderer, Rust shell and tests
├── docs/                 # Architecture, release, migration and validation notes
├── installer/            # Windows installer project and legal resources
├── Icons/                # Fluxora brand and UI icon assets
├── Build.ps1             # Release build entry point
├── LICENSE               # Proprietary license
└── README.md
```

## Getting Started

Prerequisites for local development:

- Windows development environment
- Visual Studio C++ toolchain and CMake
- Rust stable toolchain
- Node.js and npm

Run the Tauri app in development:

```powershell
cd frontend-tauri
npm install
npm run dev
```

Build and test the native core:

```powershell
cmake -S backend -B build/backend
cmake --build build/backend
ctest --test-dir build/backend --output-on-failure
```

## Build And Release

Create the Windows release payload and approved installer from the repository root:

```powershell
./Build.ps1 -Configuration Release -Runtime win-x64
```

The build pipeline creates:

- `output/` as local staging for the Tauri app payload and native resources.
- `output-installer/FluxoraSetup.exe` as the approved Windows release artifact.

Do not publish `output/`, loose Tauri bundler files, portable folders or ad-hoc archives. Public distribution goes through the installer/package pipeline.

## Development Checks

Useful focused checks:

```powershell
cd frontend-tauri
npm run typecheck
npm test
npm run test:e2e
```

For release-affecting changes, run the repository build:

```powershell
./Build.ps1 -Configuration Release -Runtime win-x64
```

When changing bridge contracts, update the shared DTOs, docs, tests and operation/logging expectations together.

## Documentation

- `docs/tauri-migration/architecture.md` documents the Tauri plus C++ bridge architecture.
- `docs/tauri-migration/release-pipeline.md` documents installer policy and release validation.
- `docs/tauri-migration/parity-gate.md` documents product parity checks.
- `docs/tauri-migration/wpf-ui-inventory.md` is archival migration reference only.

## License

Fluxora is proprietary software and part of the ModdingFlow ecosystem. Access to this repository does not grant redistribution, reuse, sublicensing, modification or branding rights. See `LICENSE` for the full terms.
