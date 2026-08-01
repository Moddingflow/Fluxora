# Fluxora icon provenance

`C:\Fluxora\Icons` is the single source for SVG assets imported by Fluxora
renderer targets. New renderer code must reference these files through the
configured Vite alias or a repository-relative import; it must not copy SVG
path data into TypeScript, Rust, C++, or another asset directory.

The machine-readable provenance registry is `provenance.json`. Setup and
Updater have the narrower fail-closed allowlist
`installer-updater-icons.json`. An imported icon is release-eligible only when
the file exists, the provenance entry is `verified` (or explicitly
`projectOwned`), the pinned file hash matches, and the referenced licence or
rights-notice file exists.

## Lucide icons

Upstream: `lucide-icons/lucide`, tag `1.21.0`, repository directory `icons/`.
Licence: ISC; icons derived from Feather also retain the MIT notice. Both
notices are in `LUCIDE-LICENSE.txt`. Commercial use is permitted under those
terms.

| Fluxora filename | Upstream filename | Actual use |
|---|---|---|
| `ai-arrow-up.svg` | `arrow-up.svg` | AI composer submit action |
| `ai-circle-stop.svg` | `circle-stop.svg` | AI composer stop action |
| `ai-mic.svg` | `mic.svg` | AI local voice capture |
| `ai-plus.svg` | `plus.svg` | AI composer add action |
| `alert-triangle.svg` | `triangle-alert.svg` | Setup/Updater warning and native failure |
| `back.svg` | `arrow-left.svg` | Back navigation in the shared icon primitive |
| `calendar.svg` | `calendar.svg` | Date and scheduling metadata |
| `chevron-down.svg` | `chevron-down.svg` | Product menus and compact selectors |
| `chevron-up.svg` | `chevron-up.svg` | Product menus and compact selectors |
| `circle-check.svg` | `circle-check.svg` | Setup success and product success state |
| `circle-x.svg` | `circle-x.svg` | Setup/Updater failure and close state |
| `cuboid.svg` | `cuboid.svg` | Generic file preview header |
| `file-text.svg` | `file-text.svg` | Setup legal documents and open-logs action |
| `folder.svg` | `folder.svg` | Generic folder state |
| `folder-open.svg` | `folder-open.svg` | Setup folder picker/open folder and product menus |
| `folder-tree.svg` | `folder-tree.svg` | Mod details file-tree tab |
| `gamepad.svg` | `gamepad-2.svg` | Game selection and game metadata |
| `gemini.svg` | `sparkles.svg` | Generic AI feature mark; intentionally not a third-party brand logo |
| `git-compare-arrows.svg` | `git-compare-arrows.svg` | Mod details conflicts tab |
| `hard-drive-download.svg` | `hard-drive-download.svg` | Product update and download action |
| `hard-drive.svg` | `hard-drive.svg` | Optional Setup disk-space status |
| `image-expand.svg` | `expand.svg` | Expand image preview |
| `language.svg` | `languages.svg` | Language selection |
| `layers.svg` | `layers.svg` | Mod creation, separators, and product menus |
| `link.svg` | `link.svg` | Linked resource or source |
| `more-horizontal.svg` | `ellipsis.svg` | Overflow actions |
| `open.svg` | `external-link.svg` | Safe external-link action |
| `package-plus.svg` | `package-plus.svg` | Mod installation and creation |
| `play.svg` | `play.svg` | Setup launch action and executable menu |
| `plus.svg` | `plus.svg` | Product add action |
| `refresh.svg` | `refresh-cw.svg` | Refresh and retry actions |
| `search.svg` | `search.svg` | Search input and action |
| `settings.svg` | `settings.svg` | Settings navigation |
| `toggle-left.svg` | `toggle-left.svg` | Product disable action |
| `toggle-right.svg` | `toggle-right.svg` | Product enable action |
| `transfer.svg` | `arrow-right-left.svg` | Transfer and import actions |
| `trash-2.svg` | `trash-2.svg` | Product destructive menu action |
| `trash.svg` | `trash.svg` | Deletion confirmation dialog |
| `triangle-alert.svg` | `triangle-alert.svg` | General product warning state |
| `window-close.svg` | `x.svg` | Setup/Updater custom titlebar close |
| `window-maximize.svg` | `square.svg` | Product custom titlebar maximise |
| `window-minimize.svg` | `minus.svg` | Setup/Updater custom titlebar minimise |
| `window-restore.svg` | `copy.svg` | Product custom titlebar restore |

The renderer also uses the following byte-exact files from the same Lucide
`1.21.0` tag and ISC licence. They replace the generated `lucide-react`
dependency while preserving the existing component-level icon vocabulary.

| Fluxora filename | Upstream filename | Actual use |
|---|---|---|
| `bot.svg` | `bot.svg` | AI assistant state |
| `box.svg` | `box.svg` | Package and archive state |
| `case-sensitive.svg` | `case-sensitive.svg` | Text-search case toggle |
| `check.svg` | `check.svg` | Selection and completion affordance |
| `chevron-left.svg` | `chevron-left.svg` | Previous preview navigation |
| `chevron-right.svg` | `chevron-right.svg` | Next preview navigation |
| `circle-alert.svg` | `circle-alert.svg` | Inline validation warning |
| `circle-dot.svg` | `circle-dot.svg` | Selected-item status |
| `cloud-upload.svg` | `cloud-upload.svg` | Export and upload action |
| `code-xml.svg` | `code-xml.svg` | Source and code file type |
| `command.svg` | `command.svg` | Command and shortcut affordance |
| `copy.svg` | `copy.svg` | Copy action |
| `download.svg` | `download.svg` | Manual-download action |
| `earth.svg` | `earth.svg` | Product language selection |
| `file.svg` | `file.svg` | Generic file type |
| `file-archive.svg` | `file-archive.svg` | Archive download type |
| `file-code-corner.svg` | `file-code-corner.svg` | Code-file type |
| `file-pen-line.svg` | `file-pen-line.svg` | AI file-diff edit state |
| `files.svg` | `files.svg` | Multiple-file state |
| `folder-plus.svg` | `folder-plus.svg` | Add-folder action |
| `gauge.svg` | `gauge.svg` | Performance and status meter |
| `house.svg` | `house.svg` | Home navigation |
| `loader-circle.svg` | `loader-circle.svg` | Busy indicator |
| `monitor-cog.svg` | `monitor-cog.svg` | System configuration |
| `move.svg` | `move.svg` | Install-placement move action |
| `package-check.svg` | `package-check.svg` | FluxPack conflict resolution |
| `package-open.svg` | `package-open.svg` | FluxPack export |
| `panel-bottom.svg` | `panel-bottom.svg` | Editor panel action |
| `pencil.svg` | `pencil.svg` | Rename and edit action |
| `plug.svg` | `plug.svg` | Plugin state |
| `redo-2.svg` | `redo-2.svg` | Redo action |
| `regex.svg` | `regex.svg` | Text-search regular-expression toggle |
| `rotate-ccw.svg` | `rotate-ccw.svg` | Revert action |
| `save.svg` | `save.svg` | Save action |
| `send.svg` | `send.svg` | AI send action |
| `shield-check.svg` | `shield-check.svg` | Trusted or verified state |
| `sprout.svg` | `sprout.svg` | No Grass In Objects cache generation |
| `undo-2.svg` | `undo-2.svg` | Undo action |
| `whole-word.svg` | `whole-word.svg` | Text-search whole-word toggle |

The Setup/Updater copies of `window-close.svg`, `window-minimize.svg`,
`file-text.svg`, `alert-triangle.svg`, and `hard-drive.svg` previously
contained hand-adjusted geometry or stroke widths. They were replaced with the
byte-exact upstream files from tag `1.21.0`. `gemini.svg`, `layers.svg`, and
`trash.svg` were likewise replaced by byte-exact Lucide sources so already
imported product assets no longer depend on undocumented substitute geometry.

## Twemoji language flags

Upstream: `jdecked/twemoji`, tag `v16.0.1`, repository directory
`assets/svg/`. Graphics licence: CC-BY-4.0. The attribution and licence
reference are in `TWEMOJI-LICENSE.txt`.

| Fluxora filename | Upstream path | Actual use |
|---|---|---|
| `flag-united-kingdom.svg` | `assets/svg/1f1ec-1f1e7.svg` | English language option |
| `flag-russia.svg` | `assets/svg/1f1f7-1f1fa.svg` | Russian language option |
| `flag-germany.svg` | `assets/svg/1f1e9-1f1ea.svg` | German language option |

These are byte-exact upstream SVGs; they replace earlier hand-authored flags.

## Bootstrap icon

Upstream: `twbs/icons`, tag `v1.13.1`, path
`icons/exclamation-lg.svg`. Licence: MIT in
`BOOTSTRAP-ICONS-LICENSE.txt`.

| Fluxora filename | Actual use |
|---|---|
| `exclamation-lg.svg` | Missing-master status in the plugin view |

## Tabler icon

Upstream: `tabler/tabler-icons`, tag `v3.44.0`, path
`icons/outline/info-circle.svg`. Licence: MIT in
`TABLER-ICONS-LICENSE.txt`.

| Fluxora filename | Actual use |
|---|---|
| `info-circle.svg` | Plugin-count information popover |

## Material Design conflict icons

Upstream package: `@material-design-icons/svg`, version `0.14.15`.
Licence: Apache-2.0 in `MATERIAL-DESIGN-ICONS-LICENSE.txt`.

| Fluxora filename | Upstream path | Actual use |
|---|---|---|
| `conflict-fully-overwritten-dot.svg` | `filled/circle.svg` | Fully overwritten mod state |
| `conflict-overwritten-minus.svg` | `filled/remove.svg` | Overwritten mod state |
| `conflict-overwrites-plus.svg` | `filled/add.svg` | Overwriting or mixed mod state |

## Fluxora product artwork

`Fluxora.svg` is project-owned product artwork. `Fluxora.png` and
`Fluxora.ico` are raster/icon derivatives used for product and installer
identity. They are not represented as third-party artwork and must not be
silently replaced by an external logo. Their project-owned status, pinned
hashes, and reserved-use notice are recorded in `provenance.json` and
`FLUXORA-ASSET-NOTICE.txt`; `Fluxora.svg` is used in the Setup/Updater
titlebar.

## Quarantined repository assets

The following SVG file existed before this audit but has no confirmed
byte-exact upstream mapping in `provenance.json`. It is retained to avoid
destroying unrelated work, but it is `quarantined`: new code, Setup, and
Updater must not import it until an official source, pinned revision, licence,
local hash, and actual use are recorded.

- `auto-scroll.svg`

Any future import of a quarantined file is a release error. The audit does not
delete these files because the worktree contains unrelated user work and no
current Setup/Updater implementation requires them.
