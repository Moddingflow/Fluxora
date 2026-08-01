# TexGen and DynDOLOD integration

Fluxora supports managed TexGen and DynDOLOD launches for Skyrim Special
Edition and Anniversary Edition (`gameId=skyrimse`). Fluxora recognizes the
official executable names `TexGen.exe`, `TexGenx64.exe`, `DynDOLOD.exe`, and
`DynDOLODx64.exe` case-insensitively. It does not bundle or download either
tool and does not classify generic xEdit executables as TexGen or DynDOLOD.

## Automatic setup

Before a managed tool starts, the C++ core:

- creates, adopts, and registers only that tool's `<BuildName> - TexGen Output`
  or `<BuildName> - DynDOLOD Output` with its matching generated provider;
- safely renames only that tool's older managed output folder to the
  build-prefixed name without changing its UUID or generated files;
- never creates `DynDOLOD Output` during a TexGen launch or a placeholder
  `TexGen Output` during a DynDOLOD launch;
- requires an existing managed TexGen Output before DynDOLOD can start, because
  DynDOLOD consumes it as input;
- enables the outputs that actually exist in every known profile and places
  them last, with TexGen Output immediately before DynDOLOD Output when both
  exist;
- decodes Qt/QSettings-escaped executable arguments imported from Mod Organizer;
- removes any existing xEdit game-mode, `-d` Data-path, and `-o` output-path
  arguments from the configured command line, preserves unrelated arguments,
  and supplies exactly one `-sse`, one `-d:"<current build>\Data\"`, and one
  managed `-o:"...\"` path with directory separators/trailing slashes shaped
  for xEdit;
- atomically updates only the matching `[TexGen]` or `[DynDOLOD]`
  `OutputPath` keys under the tool's `Edit Scripts` tree before launch, so a
  preset copied from MO2 cannot replace the managed output after the process
  starts; all other preset options are preserved, and a multi-file failure is
  rolled back before launch;
- derives `-d` from the current resolved build on every launch, so copied,
  transferred, or renamed builds cannot keep using an obsolete absolute path.

TexGen launches without either generated output in its input profile.
DynDOLOD launches with TexGen Output enabled as an input and without its own
DynDOLOD Output. This enforces the required TexGen-before-DynDOLOD workflow
without asking the user to edit profile order or executable arguments.

## Safe output path and publication

The tool sees a drive-root virtual output path shaped like:

`C:\Fluxora Tool Output\<build-hash>\<BuildName - Tool Output>`

This keeps the configured `-o` outside the physical game, Steam library,
Fluxora build, and mod-manager directories as recommended by the DynDOLOD
documentation. Fluxora VFS maps that path to a hidden, same-volume transaction
stage under:

`<mods>\.fluxora-lod-output\<tool>\sessions\<session>\output`

The hidden staging tree is excluded from the installed-mod inventory. The real
build-prefixed `TexGen Output` or `DynDOLOD Output` remains untouched while the
tool runs.
After the last tracked VFS process exits successfully, Fluxora atomically
replaces the previous output with the staged result, refreshes its fingerprint,
and invalidates native mod/VFS caches. A failed, cancelled, watcher-error, or
empty run removes only the stage and preserves the previous output.

## Managed sessions and recovery

Each tool has a per-build native lease under
`.flow/tools/lod-generators/<tool>/`. A live tool process, or the live Fluxora
manager before process binding finishes, blocks a concurrent launch of the same
tool. The renderer always calls `executables.completeManagedLaunch` after
process/VFS-holder tracking. Completion is idempotent and executes on the same
main bridge host that prepared and owns the managed session; independent bridge
lanes cannot lose its in-memory session registry before publication.

If Fluxora exits unexpectedly, the next launch checks the stored process ids.
A live process retains its lease. A dead session has only its owned hidden
stage removed; the last published output is preserved and the launch is
recovered automatically.

## Scope and privacy

- The integration configures generation and output handling; it does not
  automate TexGen/DynDOLOD option choices.
- Managed launch requires the Windows VFS. There is no unsafe plain-launch
  fallback.
- Full FluxPack includes these generated mods under the existing generated
  asset policy; recipe export follows the configured generated-assets policy.
- The integration is entirely local and adds no telemetry, upload, account
  flow, or other network transfer, so it does not change the privacy-policy
  data inventory.

The argument and workflow behavior follows the official
[DynDOLOD command-line documentation](https://dyndolod.info/Help/Command-Line-Argument).
