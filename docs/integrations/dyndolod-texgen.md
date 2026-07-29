# TexGen and DynDOLOD integration

Fluxora supports managed TexGen and DynDOLOD launches for Skyrim Special
Edition and Anniversary Edition (`gameId=skyrimse`). Fluxora recognizes the
official executable names `TexGen.exe`, `TexGenx64.exe`, `DynDOLOD.exe`, and
`DynDOLODx64.exe` case-insensitively. It does not bundle or download either
tool and does not classify generic xEdit executables as TexGen or DynDOLOD.

## Automatic setup

Before either tool starts, the C++ core:

- creates or adopts the exact generated mods `TexGen Output` and
  `DynDOLOD Output`;
- registers them with the providers `generated-texgen` and
  `generated-dyndolod`;
- enables them in every known profile and places them last, with TexGen Output
  immediately before DynDOLOD Output;
- removes any existing xEdit game-mode and `-o` arguments from the configured
  command line, preserves unrelated arguments, and supplies `-sse` plus one
  managed `-o:"..."` path.

TexGen launches without either generated output in its input profile.
DynDOLOD launches with TexGen Output enabled as an input and without its own
DynDOLOD Output. This enforces the required TexGen-before-DynDOLOD workflow
without asking the user to edit profile order or executable arguments.

## Safe output path and publication

The tool sees a drive-root virtual output path shaped like:

`C:\Fluxora Tool Output\<build-hash>\<Tool Output>`

This keeps the configured `-o` outside the physical game, Steam library,
Fluxora build, and mod-manager directories as recommended by the DynDOLOD
documentation. Fluxora VFS maps that path to a hidden, same-volume transaction
stage under:

`<mods>\.fluxora-lod-output\<tool>\sessions\<session>\output`

The hidden staging tree is excluded from the installed-mod inventory. The real
`TexGen Output` or `DynDOLOD Output` remains untouched while the tool runs.
After the last tracked VFS process exits successfully, Fluxora atomically
replaces the previous output with the staged result, refreshes its fingerprint,
and invalidates native mod/VFS caches. A failed, cancelled, watcher-error, or
empty run removes only the stage and preserves the previous output.

## Managed sessions and recovery

Each tool has a per-build native lease under
`.flow/tools/lod-generators/<tool>/`. A live tool process, or the live Fluxora
manager before process binding finishes, blocks a concurrent launch of the same
tool. The renderer always calls `executables.completeManagedLaunch` after
process/VFS-holder tracking. Completion is idempotent and executes on the
background bridge lane.

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
[DynDOLOD documentation](https://dyndolod.info/).
