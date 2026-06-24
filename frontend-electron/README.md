# Fluxora Electron UI

This folder is the Fluxora product UI after the migration from WPF to Electron. Read `../docs/electron-migration/README.md` before larger UI, bridge or parity changes.

## Stack

- Electron main process for window lifecycle, single-instance handling, safe IPC and shell integration.
- TypeScript across main, preload, renderer and tests.
- React + Vite for the renderer UI.
- Electron Forge with the Vite plugin for dev and package workflows.
- Vitest for focused unit tests.
- Playwright for Electron smoke tests.

## Commands

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

`npm run release:dry-run` creates Forge smoke artifacts only. The approved Windows public installer is still assembled from the repository root through `../Build.ps1 -Configuration Release -Runtime win-x64`.

`npm run test:parity` runs the Phase 16 parity drift guard. `npm run parity:gate` runs the Electron side of the Phase 16 gate: typecheck, Vitest and Playwright. The repository-level gate is `../scripts/Invoke-FluxoraParityGate.ps1`.

## Boundaries

The renderer has no direct Node.js, filesystem or native access. UI code calls the typed preload API exposed as `window.fluxora`; preload forwards only allowlisted IPC channels to Electron main. Content Security Policy is set by Electron main so dev can allow the Vite React Refresh preamble while packaged builds stay stricter. Business behavior stays in the C++ core and future `fluxora.bridge.v1` host.

Do not recreate the removed C# WPF product frontend. New product UI belongs here, with business behavior remaining in the C++ core.
