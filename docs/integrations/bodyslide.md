# BodySlide integration

Fluxora supports a managed interactive BodySlide launch for Skyrim Special
Edition and Anniversary Edition (`gameId=skyrimse`). Version 1 is validated
against the official BodySlide 5.8.2 layout and requires the 64-bit
`BodySlide.exe` or `BodySlide x64.exe` to belong to the current build. Fluxora
does not bundle or download BodySlide.

## Managed configuration

The original BodySlide mod stays unchanged. Fluxora creates a small overlay at
`.flow/tools/body-slide/<executable-id>/`, copies only existing small
`Config.xml` and `BodySlide.xml` files, and manages these `Config.xml` values:

- `TargetGame=4` (`SkyrimSpecialEdition`);
- `GameDataPath` and `GameDataPaths/SkyrimSpecialEdition` point to the current
  real game `Data` directory and include the trailing directory separator that
  BodySlide expects when it appends relative `meshes/...` output paths;
- `OutputDataPath` points to that same virtualized `Data` directory with the
  same trailing separator;
- `ProjectPath` points to the BodySlide project directory visible through the
  active VFS, preferring the executable's directory inside its mod, then
  `CalienteTools/BodySlide`, then `Tools/BodySlide`.

Unknown XML settings are preserved. A malformed source is copied byte-for-byte
to the overlay's `recovery/` directory, while Fluxora creates a minimal valid
managed config and reports a warning. Absolute paths are regenerated for the
current project and game location on every launch.

The executable directory is a separate VFS mount: the real BodySlide directory
is the read-only base and the small project overlay is writable. Large
`ShapeData`, `SliderSets`, `SliderGroups`, and related resources are
therefore never copied into `.flow`.

## Output and Data mount order

The first launch creates `<BuildName> - BodySlide Output` with provider
`generated-bodyslide`. Its UUID is stable across later build renames. Fluxora
never clears this directory automatically and keeps it last and enabled in all
known profiles (and rechecks the active profile before every launch).
If the user deletes this managed output mod, the next launch recreates it and
retains its UUID. Fluxora refuses recovery when either the previous or desired
folder name is occupied by an unverified directory.

For BodySlide only, the virtual game `Data` mount has this exact order, from
lower to higher precedence:

1. active profile mods in their normal order;
2. the normal build `overwrite` as a read-only source layer;
3. the existing BodySlide Output as a readable source layer;
4. the same BodySlide Output as the only writable overlay.

The output is removed from the ordinary active-mod snapshot before the plan is
built, so it cannot be mounted twice. BodySlide always launches through VFS,
including an otherwise empty profile. Missing VFS, injection failure, an x86
binary, an unsupported game, or an external executable is a hard typed error;
there is no plain-launch fallback.

## Managed sessions and recovery

Preparation creates a native, per-build lease in
`.flow/tools/body-slide/`. A live BodySlide process, or a live manager that has
not yet attached the new PID, blocks another launch. The renderer always calls
`executables.completeManagedLaunch` in a `finally` block after process/VFS-holder
tracking. Completion is idempotent and runs on the bridge background lane; it
refreshes the output fingerprint, invalidates mod/VFS caches, releases the
lease, and then lets the renderer reload the mod list.

If the UI or host exits unexpectedly, the next preparation checks the stored
manager and BodySlide PIDs. A live process retains the lease. A dead lease is
finalized and recovered automatically before the next launch.

## FluxPack and limitations

- Full FluxPack includes the generated output under the existing generated
  asset policy.
- Recipe export includes it only when `generated-assets` is enabled.
- `.flow/tools/body-slide` overlays, recovery data, and lease/session files are
  not package payloads.
- Version 1 does not automate preset/group selection, one-click Batch Build,
  Outfit Studio, download BodySlide, or support a shared external installation.
- This integration adds no telemetry, upload, account flow, or other network
  transfer, so it does not change the privacy-policy data inventory.

The configuration behavior follows the official
[BodySlide 5.8.2 application code](https://github.com/ousnius/BodySlide-and-Outfit-Studio/blob/v5.8.2/src/program/BodySlideApp.cpp),
[game enumeration](https://github.com/ousnius/BodySlide-and-Outfit-Studio/blob/v5.8.2/src/utils/GameUtil.cpp),
and [Config.xml](https://github.com/ousnius/BodySlide-and-Outfit-Studio/blob/v5.8.2/Config.xml).
