# Fluxora Tauri UI

This folder is the Fluxora product UI. Before larger UI, bridge or parity changes, follow `../AGENTS.md` and the current architecture/validation documentation.

## Stack

- Tauri Rust shell for window lifecycle, single-instance handling, safe commands and shell integration.
- TypeScript across renderer, the `window.fluxora` facade and tests.
- React + Vite for the renderer UI.
- i18next with complete bundled `en-US`, `de-DE` and `ru-RU` JSON catalogs; see `src/localization/README.md`.
- Native-authoritative locale startup and a typed cross-window language event, so every open product window switches together without fallback-language frames.
- Tauri bundler with the Vite plugin for dev and package workflows.
- Vitest for focused unit tests.
- Playwright for Tauri smoke tests.

## Commands

Install the Rust stable toolchain first so `cargo` and `rustc` are available in `PATH`.

```powershell
npm install
npm run dev
npm run build
npm test
npm run test:parity
npm run parity:gate
npm run test:e2e
npm run release:dry-run
```

`npm run release:dry-run` creates Tauri smoke artifacts only. The approved Windows public installer is still assembled from the repository root through `../Build.ps1 -Configuration Release -Runtime win-x64`.

`npm run test:parity` runs the parity drift guard. `npm run parity:gate` runs the Tauri gate: typecheck, Vitest and Playwright. The repository-level gate is `../scripts/Invoke-FluxoraParityGate.ps1`.

## Boundaries

The renderer has no direct Node.js, filesystem or native access. UI code calls the typed facade exposed as `window.fluxora`; the facade forwards only allowlisted commands to the Tauri Rust shell. Content Security Policy is set by Tauri config so dev can allow the Vite React Refresh preamble while packaged builds stay stricter. Business behavior stays in the C++ core and `fluxora.bridge.v1` host.

Pending install rows are renderer orchestration state only. `use-pending-install-orchestrator.ts` creates/reuses the visible row before the native install promise, applies monotonic `FluxoraInstallConflictSnapshot` payloads from `operations.progress` or `mods.rebasePendingInstall`, and performs the temporary-to-permanent id swap or rollback. Exact file inventory, overwrite direction, profile order persistence and filesystem/SQLite commit remain C++ responsibilities.

Do not recreate the removed C# WPF product frontend. New product UI belongs here, with business behavior remaining in the C++ core.
