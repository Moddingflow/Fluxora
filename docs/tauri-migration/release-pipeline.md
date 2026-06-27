# Fluxora Tauri release pipeline

Дата обновления: 2026-06-24

Статус: Phase 17 release pipeline is Tauri-only for the product payload. Linux/macOS public distribution remains gated by native smoke, signing/notarization and final owner/legal review.

## Approved artifacts

Windows public release:

- `output-installer/FluxoraSetup.exe` is the only approved Windows public artifact.
- `Build.ps1` now defaults to the Tauri payload and embeds `frontend-tauri/src-tauri/target/release/Fluxora.exe` plus native resources into the installer payload.
- `output/` is local installer staging only. Do not publish it, zip it, attach it or treat it as portable Fluxora.
- `frontend-tauri/src-tauri/target/`, `build/tauri-native/` and Tauri bundler output are smoke/build artifacts only.

Linux public candidates:

- `.deb` and `.rpm` are the selected package formats once native `.so` payload smoke passes on a real Linux host.
- Tauri side artifacts are internal smoke artifacts, not public portable releases.
- AppImage is not approved in Phase 15. Revisit only with an explicit update/signing plan.

macOS public candidates:

- No public macOS artifact is approved until Developer ID signing, notarization and native `.dylib`/helper signing are validated.
- Tauri side artifacts are internal smoke artifacts.
- `.dmg` remains the preferred public-package plan after signing/notarization is ready.

## Windows release build

Default Tauri installer build:

```powershell
.\Build.ps1 -Configuration Release -Runtime win-x64
```

The Tauri build path performs these steps:

- configure and build `backend/` through CMake;
- collect `FluxoraBridgeHost.exe`, `FluxoraCore.dll` and `FluxoraVfs.dll` into `build/tauri-native/win32/x64`;
- run `npm install` and `npm run build` in `frontend-tauri/` after staging native payloads into `frontend-tauri/src-tauri/resources/native`;
- copy the built Tauri app from `frontend-tauri/src-tauri/target/release/Fluxora.exe` into `output/`;
- verify `output/Fluxora.exe`, `output/resources/native/FluxoraBridgeHost.exe`, `output/resources/native/FluxoraCore.dll` and `output/resources/native/FluxoraVfs.dll`;
- create `installer/Fluxora.Installer/Resources/Payload/FluxoraPayload.flxpkg.gz`;
- publish the approved Windows installer to `output-installer/FluxoraSetup.exe`.

## Tauri smoke builds

Tauri bundler smoke dry-run:

```powershell
cd frontend-tauri
npm run release:dry-run
```

When testing native payload packaging without the root installer:

```powershell
cd frontend-tauri
npm run build
```

The Windows Tauri NSIS output is written under `frontend-tauri/src-tauri/target/release/bundle/nsis/` and is a smoke artifact only, separate from the approved `output-installer/FluxoraSetup.exe`.

## Artifact verification

Before a Phase 15 dry-run is accepted:

- `output-installer/FluxoraSetup.exe` exists.
- `output/Fluxora.exe` exists.
- `output/resources/native/FluxoraBridgeHost.exe` exists.
- `output/resources/native/FluxoraCore.dll` exists.
- `output/resources/native/FluxoraVfs.dll` exists for Windows builds; missing VFS is a release-blocking packaging error.
- `installer/Fluxora.Installer/Resources/Payload/FluxoraPayload.flxpkg.gz` exists and its manifest hash is recorded in `build/installer-cache/payload.manifest.json`.
- No portable staging folder, loose payload folder or ad-hoc zip is published.

## Legal and privacy checklist

Phase 15 reviewed these data-processing surfaces for German/EU transparency expectations:

- Tauri UI logs: local `fluxora-tauri-ui-YYYYMMDD.log`, no automatic upload.
- Tauri main/bridge logs: local `fluxora-tauri-main-bridge-YYYYMMDD.log`, no automatic upload.
- Native core, bridge, operation and crash logs: local files in the app log directory via `FLUXORA_LOG_DIR`; operation IDs and path/file metadata may appear.
- Installer UI/bridge/operation/crash logs: local files under the user's app data or temp path.
- Nexus Mods auth: optional user-triggered OAuth/API connection, tokens stored locally and disconnectable.
- NXM protocol/deep links: local protocol links are captured when the user registers/uses Fluxora as handler.
- Downloads: user-triggered network requests to mod hosting URLs or Nexus Mods.
- Support logs: sent only when the user manually shares them.
- Telemetry/analytics: none is enabled in Phase 15. Adding it later requires explicit opt-in/legal review.
- Third-party components: Tauri, the platform webview runtime, React, Lucide, Vite, TypeScript, Tauri bundler, Playwright/Vitest test tooling, spdlog, Microsoft Detours where VFS is built, SharpVectors for the installer UI, and GoogleTest for backend tests.

Bundled legal resources live under `installer/Fluxora.Installer/Resources/Legal/`. The Phase 15 update keeps privacy/terms aligned with the Tauri architecture and adds third-party notice files. Final public distribution should still receive owner/legal review before publishing.

## Open release gates

- Windows Authenticode signing for `FluxoraSetup.exe`.
- Linux install smoke for `.deb` and `.rpm`, including xdg/NXM registration.
- macOS bundle URL scheme smoke, Developer ID signing and notarization.
- Final manual installer smoke on a clean machine.
- Final owner/legal review of privacy policy, terms and third-party notices.
