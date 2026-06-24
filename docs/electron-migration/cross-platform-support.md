# Fluxora Electron Cross-Platform Support Matrix

Дата обновления: 2026-06-24

Статус: Phase 14 hardening implemented for the Electron capability surface, Forge smoke packaging metadata and backend path-safety coverage. Phase 15 now defines the Windows approved installer path and release/legal checklist in `docs/electron-migration/release-pipeline.md`.

## Runtime Contract

`system.getCapabilities` is still the source of domain truth from the native bridge/core. Electron main now merges in main-process platform truth before exposing `NativeBridgeStatus` to preload/renderer:

- `nativeDialogs`, `shellOpen` and `externalLinks` are `electron-main` capabilities.
- `nxmProtocolRegistration` is `available` on Windows and `limited` on Linux/macOS until package-level OS registration is finished.
- `packagedNativeResources` is `limited` in normal dev builds and becomes `available` when `FLUXORA_NATIVE_RESOURCES` is set for packaging.
- `supportMatrix` lists Windows, Linux and macOS target states for UI display and release gates.

Renderer remains a display/orchestration layer only. It does not infer filesystem or platform domain rules from paths.

## Support Matrix

| Area | Windows | Linux | macOS |
| --- | --- | --- | --- |
| Native core | `FluxoraCore.dll` | `libFluxoraCore.so` | `libFluxoraCore.dylib` |
| Bridge host | `FluxoraBridgeHost.exe` | `FluxoraBridgeHost` | `FluxoraBridgeHost` |
| Packaging smoke | `FluxoraSetup.exe` approved installer, `FluxoraElectronSmokeSetup.exe` Forge smoke | deb/rpm package candidates, zip smoke artifact | zip smoke artifact, dmg/signing planned |
| NXM protocol | Available through Electron activation + Windows registry verification | Limited: `x-scheme-handler/nxm` package metadata is configured, xdg registration remains release smoke | Limited: `open-url` activation is wired, bundle URL scheme/signing/notarization remain release smoke |
| Shell open | Electron main `shell.openPath` / `showItemInFolder` | Electron main, xdg behavior | Electron main, Finder behavior |
| VFS/hook launch | Available when bridge/core reports `FluxoraVfs.dll` for x64 | Unsupported until Linux adapter exists | Unsupported until signed macOS adapter exists |
| Path rules | Unicode, Cyrillic/German characters, spaces, long paths, read-only/write guards | UTF-8, case-sensitive filesystem, mount paths, spaces, read-only/write guards | Unicode, spaces, external volumes, sandbox review, read-only/write guards |

## Packaging Notes

Electron Forge now declares the `nxm` protocol in `packagerConfig.protocols`.

Linux deb/rpm makers include `x-scheme-handler/nxm` MIME metadata. AppImage is not approved in Phase 15; revisit it only with an explicit update/signing plan.

Native payload copy is opt-in for smoke/release builds:

```powershell
$env:FLUXORA_NATIVE_RESOURCES = "C:\Fluxora\build\electron-native"
cd C:\Fluxora\frontend-electron
npm run build
```

The hook searches these source layouts and copies the first match into `resources/native`:

- `<root>/<platform>/<arch>/`
- `<root>/<platform>/`
- `<root>/`

Expected payload examples:

- Windows: `FluxoraBridgeHost.exe`, `FluxoraCore.dll`, optional `FluxoraVfs.dll`.
- Linux: `FluxoraBridgeHost`, `libFluxoraCore.so`.
- macOS: `FluxoraBridgeHost`, `libFluxoraCore.dylib`.

## UI State

Settings now includes a Platform section that shows:

- current runtime platform/arch;
- core library and bridge host names;
- NXM, shell-open and native-payload capability state;
- Windows/Linux/macOS support rows with package, protocol, VFS and path-safety notes.

Unsupported or limited platform features stay visible as disabled/limited states instead of being hidden in renderer logic.

## Validation

Automated coverage added in Phase 14:

- renderer unit tests for platform support rows and feature-state summaries;
- backend `PathSafetyServiceTests` for Unicode, Cyrillic/German characters, spaces, non-ASCII contained paths, long-path coverage and platform-specific case-comparison behavior.

Manual/release gates still pending for Phase 16/final release:

- Linux package install smoke with xdg registration;
- macOS bundle URL scheme, signing and notarization smoke;
- release artifact review for native payload completeness.
