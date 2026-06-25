# Fluxora WPF UI inventory for Tauri migration

Дата инвентаризации: 2026-06-24

Статус: historical source inventory complete. После Phase 17 исходники `frontend/` удалены из активной структуры; этот документ остается parity/reference snapshot, а не указателем на существующий frontend.

## Scope and sources

Эта карта фиксирует текущий WPF интерфейс как контракт паритета для `frontend-tauri/`. Инвентаризация сделана по исходникам:

- `frontend/App.xaml.cs`
- `frontend/MainWindow.xaml`
- `frontend/MainWindow.xaml.cs`
- `frontend/ViewModels/MainWindowViewModel.cs`
- `frontend/SettingsWindow.xaml`
- `frontend/ViewModels/SettingsWindowViewModel.cs`
- `frontend/BuildSettingsWindow.xaml`
- `frontend/ViewModels/BuildSettingsWindowViewModel.cs`
- `frontend/InstallModWindow.xaml`
- `frontend/InstallArchiveDetailsWindow.xaml`
- `frontend/FomodInstallerWindow.xaml`
- `frontend/ExecutableManagerWindow.xaml`
- `frontend/Views/ProfileManagerWindow.xaml`
- `frontend/Views/*Splash.xaml`
- `frontend/Services/*CatalogService.cs`
- `frontend/Services/CoreBridgeService.cs`

Out of scope for Phase 0 frontend parity: `installer/Fluxora.Installer/MainWindow.xaml`. Это WPF-окно установщика, а не пользовательский frontend приложения. Его нужно учитывать отдельно в release/installer phase.

Owner legend:

- Tauri UI: renderer state, route, component, view model/store, table/tree/dialog state.
- Tauri Rust shell/facade: window lifecycle, native dialogs, protocol/deep links, shell open, safe command exposure.
- C++ core: domain behavior, file operations, installer, downloads, profiles, FluxPack, MO2 import, VFS/launch, logs.

Tauri renderer must not duplicate C++ behavior. Existing WPF service classes mostly act as UI orchestration over `CoreBridgeService`; Tauri should keep the same boundary through typed command.

## WPF entrypoints and Tauri targets

| WPF entrypoint | Current role | Tauri target | Owner notes |
| --- | --- | --- | --- |
| `App.xaml.cs` | Startup, logging handlers, single-instance guard, NXM startup links, startup splash, service composition, theme init. | `main/appLifecycle`, `main/singleInstance`, `main/protocol`, renderer `StartupGate`. | Main owns instance/protocol/window lifecycle. C++ core still initializes through bridge. Renderer shows startup status only. |
| `StartupSplashWindow.xaml` + `StartupSplashViewModel` | Startup progress with minimum display duration and startup failure surfacing. | `routes/startup` or shell-level `StartupOverlay`. | Renderer visual. Main/facade exposes startup progress events. |
| `MainWindow.xaml` + `MainWindow.xaml.cs` | Main shell: project catalog/home, project workspace, tabs, create wizard, MO2 transfer host, process overlays, WPF selection gestures. | `AppShell`, routes `/builds`, `/builds/new`, `/builds/:id/mods`, `/builds/:id/plugins`, `/builds/:id/data`, `/builds/:id/downloads`, `/transfer/mo2`. | Renderer owns layout/state/selection. Main handles external activation and native dialogs. Core owns all mutations. |
| `SettingsWindow.xaml` | Settings modal with connections, language, customization, transfer entry, embedded transfer process. | `routes/settings`, modal or shell route `/settings/*`. | Renderer owns tabs/forms. Main handles close/window/modal rules. Core owns Nexus auth and MO2 import. |
| `BuildSettingsWindow.xaml` | Build path settings: game executable, mods, profiles, downloads, overwrite. | `/builds/:id/settings/paths` or modal `BuildPathsDialog`. | Renderer owns form/validation display. Main provides file/folder pickers. Core loads/saves path settings and executables. |
| `ProfileManagerWindow.xaml` | Profile management dialog sharing `MainWindowViewModel`: refresh, create, clone, rename, delete, open profiles folder. | `/builds/:id/profiles` or `ProfileManagerDialog`. | Renderer owns list/form/processing state. Main handles shell-open folder. Core owns profile CRUD. |
| `ExecutableManagerWindow.xaml` | Executables list/editor: add/delete, display name, executable path, args, working directory, icon resolving. | `/builds/:id/executables` or `ExecutableManagerDialog`. | Renderer owns editor. Main owns native file/folder pickers. Core owns icon resolving, save, launch. |
| `InstallModWindow.xaml` | Install confirmation/name dialog, existing-mod replace/merge, placement preview and validation gate. | `InstallOptionsDialog`. | Renderer owns form, conflict choice, layout warning details. Core owns archive/FOMOD analysis and final install. |
| `InstallArchiveDetailsWindow.xaml` | Detailed archive file tree, drag-and-drop placement overrides, reset, apply/close. | `ArchivePlacementDialog` with virtualized draggable tree. | Renderer owns drag/drop placement override UI. Core owns layout preview and install with overrides. |
| `FomodInstallerWindow.xaml` | Step-based FOMOD installer, option groups, validation, previous selections, preview images, lightbox. | `FomodInstallerDialog`. | Renderer owns wizard state and image UI. Core owns FOMOD analysis and install using selected option IDs. |
| `ConfirmDialogWindow.xaml` | Generic confirmation for destructive/actions and FluxPack generated asset inclusion. | Shared `ConfirmDialog`. | Renderer visual. Main may host modal; core only acts after confirmation. |
| `CreateProjectWizardSplash.xaml` | Create-project wizard surface embedded in main shell. | `/builds/new`. | Renderer owns wizard; core owns project directory preview and create. |
| `ModOrganizerTransferView.xaml` | MO2 transfer wizard embedded in main shell/settings. | `/transfer/mo2`. | Renderer owns wizard/progress. Main owns folder pickers. Core owns analyze/import. |
| `BuildLoadingSplash.xaml` | Opening build/project loading overlay. | `BuildLoadingOverlay`. | Renderer visual/progress. Core/catalog services provide load status. |
| `BuildCreationProcessSplash.xaml` | Create build progress/cancel/close overlay. | `BuildCreationOverlay`. | Renderer visual. Core owns create. Cancellation should be bridge capability/event. |
| `BuildDeletionProcessSplash.xaml` | Delete build progress overlay. | `BuildDeletionOverlay`. | Renderer visual. Core owns delete with progress. |
| `FluxPackPackageProcessSplash.xaml` | FluxPack export progress/summary/error overlay. | `FluxPackPackageOverlay`. | Renderer visual. Core owns export/package. |
| `FluxPackInstallProcessSplash.xaml` | FluxPack install provider/source progress, summary/error. | `FluxPackInstallOverlay`. | Renderer visual. Core owns inspect/install and provider progress. |
| `ModOperationProcessSplash.xaml` | Archive/FOMOD install and mod operation progress. | `ModOperationOverlay`. | Renderer visual. Core owns archive analysis/install/mutations. |
| `ExecutableLaunchProcessSplash.xaml` | Launch status, process tracking, close/terminate status. | `ExecutableLaunchOverlay`. | Renderer visual. Main/process tracking may live in main/bridge; core owns launch request. |
| `TransferProcessSplash.xaml` | Transfer progress overlay bound to `SettingsWindowViewModel`. | `TransferProgressOverlay`. | Renderer visual. Core owns transfer progress events. |
| `LanguageSwitchSplash.xaml` | Language switching overlay. | `LanguageSwitchOverlay`. | Renderer visual. Core/app settings own persisted language. |

## Main shell state map

Primary shell states from `MainWindowViewModel`:

- Project catalog/home: `Projects`, `SelectedProject`, `IsHomeEmptyStateVisible`, project size/mod count summaries.
- Project workspace: `IsProjectWorkspaceOpen`, `SelectedWorkspaceTabIndex`, capability flags such as plugins panel support.
- Create project wizard: `IsCreateProjectPanelOpen`, `CreateProjectStepIndex`, `AvailableTemplates`, `SelectedTemplate`, `SelectedResolvedTemplate`, `GamePath`, `InstallRootDirectory`, directory preview.
- Transfer panel: `IsTransferPanelOpen`, `TransferViewModel`, closeability and return-to-workspace behavior.
- Busy blockers: `IsOpeningProject`, `IsCreatingProject`, `IsProcessingDownload`, `IsProcessingPlugins`, `IsCheckingModUpdates`, `IsProcessingFluxPack`, `IsLoadingModFiles`.
- Workspace collections: `VisibleMods`, `Mods`, `Plugins`, `Downloads`, `SelectedModFileTree`, `AvailableProfiles`, `AvailableExecutables`.
- Selection behavior: replace/range/toggle multi-select for mods/plugins/downloads, select all, delete key, context-menu focus preservation.
- Global messages: `ActivityMessage`, `ValidationMessage`, `CoreStatus`, empty/error state strings.

Tauri target:

- Use a store split by domain: `projectCatalog`, `workspace`, `mods`, `plugins`, `downloads`, `profiles`, `executables`, `createProject`, `transfer`, `operations`.
- Keep selection state in renderer, but persist all domain mutations through bridge.
- Use virtualized rows/trees for mods, plugins, downloads and file trees.

## MainWindow command inventory

| WPF command | Current behavior | Tauri target | Owner |
| --- | --- | --- | --- |
| `OpenCreateProjectCommand` | Opens embedded create wizard, resets inputs. | Navigate `/builds/new`. | Tauri UI. |
| `BrowseGamePathCommand` | WPF executable picker for game exe. | `facade.dialog.pickExecutable`. | Tauri Rust shell/facade. |
| `BrowseInstallRootCommand` | WPF folder picker. | `facade.dialog.pickFolder`. | Tauri Rust shell/facade. |
| `PreviousCreateStepCommand`, `NextCreateStepCommand`, `CancelCreateProjectCommand` | Wizard navigation/validation. | Create-project wizard store. | Tauri UI. |
| `CreateProjectCommand` | Validates template/path and calls project create. | `bridge.projects.create`. | UI orchestrates; C++ core owns create. |
| `OpenProjectCommand` | File picker for build config, opens project. | `dialog.pickBuildConfig` + `bridge.projects.openConfig`. | Main/facade + C++ core. |
| `OpenProjectBuildCommand` | Opens selected project from catalog. | `bridge.projects.open`. | Tauri UI selection; C++ core read/validate. |
| `RenameProjectCommand` | Name dialog, core rename, refresh selection/cache. | `RenameBuildDialog` + `bridge.projects.rename`. | UI dialog; C++ core rename. |
| `DeleteProjectCommand` | Confirm, delete progress overlay, remove from catalog. | `ConfirmDialog` + `BuildDeletionOverlay` + `bridge.projects.delete`. | UI confirmation/progress; C++ core delete. |
| `PackageProjectCommand` | Save picker, include-generated-assets confirm, FluxPack export overlay. | `bridge.fluxPack.export`. | Main picker + UI overlay + C++ core. |
| `InstallFluxPackCommand` | Pick `.fluxpack`, install progress, open installed build. | `bridge.fluxPack.install`. | Main picker + UI overlay + C++ core. |
| `BackToProjectsCommand` | Leaves workspace and returns to catalog. | Navigate `/builds`. | Tauri UI. |
| `RefreshWorkspaceCommand` | Reloads mods/plugins/downloads/profile-scoped data. | `bridge.workspace.load`. | UI trigger; C++ core/catalog read. |
| `OpenBuildSettingsCommand` | Opens path settings dialog and applies saved result. | `BuildPathsDialog`. | UI dialog + C++ core save. |
| `OpenProjectDirectoryCommand`, `OpenGameDirectoryCommand`, `OpenHomeProjectDirectoryCommand`, `OpenHomeGameDirectoryCommand`, `OpenModsDirectoryCommand`, `OpenProfilesDirectoryCommand`, `OpenDownloadsDirectoryCommand` | Shell-open folders; creates downloads folder when needed. | `facade.shell.openPath`. | Tauri Rust shell/facade. |
| `OpenProfileManagerCommand` | Opens profile manager dialog. | `ProfileManagerDialog` or route. | Tauri UI. |
| `ToggleProfileMenuCommand` | Opens profile dropdown. | Renderer menu/popover. | Tauri UI. |
| `RefreshProfilesCommand` | Reloads profile list. | `bridge.profiles.list`. | C++ core. |
| `CreateProfileCommand`, `CloneProfileCommand`, `RenameProfileCommand`, `DeleteProfileCommand` | Profile CRUD, confirm delete, reload profile-scoped lists. | `bridge.profiles.*`. | UI dialog/confirmation; C++ core mutation. |
| `InstallModFromArchiveCommand` | Pick archive, analyze FOMOD/layout, install through archive flow. | `InstallFromArchiveFlow`. | Main picker + renderer dialogs + C++ core. |
| `AddDownloadFileCommand` | Pick archive and import into downloads. | `bridge.downloads.importFile`. | Main picker + C++ core. |
| `CheckModUpdatesCommand` | Core update check then reload mod order. | `bridge.mods.checkUpdates`. | C++ core. |
| `CreateModSeparatorCommand`, `CreateModSeparatorAtEndCommand` | Name dialog, create separator at target/end. | `bridge.mods.createSeparator`. | UI dialog; C++ core order mutation. |
| `CreateEmptyModCommand` | Name dialog, create empty mod. | `bridge.mods.createEmpty`. | UI dialog; C++ core filesystem mutation. |
| `OpenModInExplorerCommand` | Shell-open installed mod folder. | `facade.shell.openPath`. | Tauri Rust shell/facade. |
| `ToggleModSeparatorCommand` | Collapse/expand separator locally. | Renderer state. | Tauri UI. |
| `MoveSelectedModUpCommand`, `MoveSelectedModDownCommand`, drag drop move | Move selected mods/separator spans in order. | `bridge.mods.moveOrderItem`. | Renderer drag/selection; C++ core order mutation. |
| `DeleteSelectedModCommand` | Confirm delete selected mods/separators; delete mods from disk or separators from order. | `bridge.mods.deleteInstalled`, `bridge.mods.deleteSeparator`. | UI confirm; C++ core mutation. |
| `ToggleModEnabledCommand`, `EnableSelectedModCommand`, `DisableSelectedModCommand`, `EnableAllModsCommand`, `DisableAllModsCommand` | Enable/disable mods. | `bridge.mods.setEnabled`, `bridge.mods.setAllEnabled`. | C++ core. |
| `MoveSelectedPluginUpCommand`, `MoveSelectedPluginDownCommand`, plugin drag drop move | Move plugins/separator spans. | `bridge.plugins.move`. | Renderer drag/selection; C++ core order mutation. |
| `CreatePluginSeparatorCommand` | Name dialog, create separator. | `bridge.plugins.createSeparator`. | UI dialog; C++ core order mutation. |
| `TogglePluginSeparatorCommand` | Collapse/expand separator locally. | Renderer state. | Tauri UI. |
| `DeleteSelectedPluginCommand` | Delete plugin separator entries. | `bridge.plugins.deleteSeparator`. | UI confirm if needed; C++ core mutation. |
| `EnableSelectedPluginCommand`, `DisableSelectedPluginCommand`, `TogglePluginEnabledCommand` | Plugin enable/disable. | `bridge.plugins.setEnabled`. | C++ core. |
| `InstallSelectedDownloadCommand`, download row double-click, download-to-mod-list drag drop | Analyze/download install flow, optional insertion index. | `InstallDownloadFlow`. | Renderer flow/dialogs; C++ core install. |
| `DeleteSelectedDownloadCommand` | Confirm and delete selected downloads. | `bridge.downloads.delete`. | UI confirm; C++ core mutation. |
| `CancelDownloadCommand`, `ResumeDownloadCommand` | Cancel/resume active download with live refresh. | `bridge.downloads.cancel`, `bridge.downloads.resume`. | C++ core; UI progress/state. |
| `OpenDownloadInExplorerCommand` | Shell-open file or downloads folder. | `facade.shell.showItemInFolder/openPath`. | Tauri Rust shell/facade. |
| `RegisterNxmProtocolCommand` | Registers current user NXM handler. | `main.protocol.registerNxm` plus core capability if retained. | Tauri Rust shell/facade, C++ core if existing API remains source. |
| `LaunchSelectedExecutableCommand` | Core launch, process tracking, expected child process handoff, launch overlay. | `bridge.executables.launch` + `ExecutableLaunchOverlay`. | C++ core launches; main/bridge may track process; renderer visual. |
| `CloseTransferPanelCommand`, `CloseBuildCreationProcessCommand`, `CloseBuildDeletionProcessCommand`, `CloseFluxPackPackageProcessCommand`, `CloseFluxPackInstallProcessCommand`, `CloseExecutableLaunchProcessCommand` | Close overlays when allowed. | Overlay store commands. | Tauri UI. |
| `CancelBuildCreationCommand` | Requests create cancellation. | `bridge.operations.cancel` when bridge supports it. | C++ core/bridge capability; UI trigger. |

## Settings command inventory

| WPF command/control | Current behavior | Tauri target | Owner |
| --- | --- | --- | --- |
| `SelectConnectionsCommand`, `SelectLanguagesCommand`, `SelectCustomizationCommand`, `SelectTransferCommand` | Settings section navigation disabled during transfer process. | `/settings/connections`, `/settings/language`, `/settings/customization`, `/settings/transfer`. | Tauri UI. |
| `ToggleNexusModsCommand` | Connect/disconnect Nexus Mods, applies status. | `bridge.nexus.connect`, `bridge.nexus.disconnect`, `bridge.nexus.status`. | C++ core/auth service; UI status. |
| Language combo `SelectedLanguage` | Saves app language, shows language switch splash, updates localization. | `bridge.settings.saveLanguage` + renderer i18n reload. | UI + C++ settings persistence. |
| Theme toggle `IsLightThemeEnabled` | Saves/applies light/dark theme. | Renderer theme store + `bridge.settings.saveTheme` if persisted in core/app settings. | UI visual; C++/app settings persistence. |
| `OpenModOrganizerTransferCommand` | Opens MO2 transfer wizard. | `/transfer/mo2`. | Tauri UI. |
| `BrowseSourceCommand`, `BrowseDestinationCommand` | Folder pickers for MO2 source/destination. | `facade.dialog.pickFolder`. | Tauri Rust shell/facade. |
| `PreviousTransferStepCommand`, `NextTransferStepCommand`, `SelectTransferStepCommand`, `CancelTransferFlowCommand` | Transfer wizard navigation and cancellation before running. | Transfer wizard store. | Tauri UI. |
| Automatic analysis / review step | Calls `AnalyzeModOrganizerInstanceAsync`, shows mod count, size, profile, game, disk warnings. | `bridge.transfer.analyzeMo2`. | C++ core. |
| `StartTransferCommand` | Calls `ImportModOrganizerInstanceAsync`, progress overlay, imports project into catalog/workspace. | `bridge.transfer.importMo2` with progress events. | C++ core; UI progress. |
| Settings close rule | Blocks close while transfer is running. | Modal route guard. | Tauri UI/main window behavior. |
| Transfer to main button | Closes settings and opens transfer in main shell. | Navigate `/transfer/mo2`. | Tauri UI. |

## Build settings inventory

Fields:

- Read-only `ProjectDirectory`.
- Editable `GameExecutablePath`.
- Editable `ModsDirectory`.
- Editable `ProfilesDirectory`.
- Editable `DownloadsDirectory`.
- Editable `OverwriteDirectory`.
- Error banner `ErrorText` / `HasError`.

Commands and owners:

- `BrowseGameExecutableCommand`: Tauri Rust shell/facade file picker.
- `BrowseModsDirectoryCommand`, `BrowseProfilesDirectoryCommand`, `BrowseDownloadsDirectoryCommand`, `BrowseOverwriteDirectoryCommand`: Tauri Rust shell/facade folder pickers.
- `InitializeAsync`: C++ core `GetBuildPathSettingsAsync` and `GetGameExecutablesAsync`.
- `SaveAsync`: validates `.exe` path in UI, then C++ core `SaveBuildPathSettingsAsync` and `SaveGameExecutablesAsync`.

Tauri target: `BuildPathsDialog` with explicit save/cancel, path validation, native browse controls and error state.

## Installer dialogs and flows

### Shared archive/download install flow

Both `InstallArchiveAsync` and `InstallDownloadAsync` follow this sequence:

1. Start `ModOperationProcess`.
2. Analyze whether the archive/download is FOMOD.
3. If FOMOD, open `FomodInstallerWindow` and collect selected option IDs.
4. Analyze content layout for plain archive or selected FOMOD files.
5. Open `InstallModWindow` with suggested name and placement preview.
6. If layout is blocked, require placement overrides from `InstallArchiveDetailsWindow`.
7. If mod name already exists, open replace/merge conflict dialog.
8. Run install through C++ core.
9. Refresh mods/plugins/downloads and focus installed mod.

Tauri target components:

- `InstallDownloadFlow` / `InstallArchiveFlow` orchestrator in renderer.
- `FomodInstallerDialog`.
- `InstallOptionsDialog`.
- `ArchivePlacementDialog`.
- `ModOperationOverlay`.

Core calls required:

- `AnalyzeFomodDownloadAsync`
- `AnalyzeDownloadContentLayoutAsync`
- `AnalyzeFomodDownloadContentLayoutAsync`
- `InstallDownloadAsync`
- `InstallArchiveAsync`
- `InstallFomodDownloadAsync`
- `InstallFomodArchiveAsync`

### `InstallModWindow`

States:

- Suggested/new mod name.
- Optional conflict mode: replace or merge existing mod.
- Placement preview summary, blocking/non-blocking findings, first entries.
- Validation message.
- Details button visible when layout preview exists.

Tauri parity:

- Name field validation must reject empty/invalid names.
- Blocked layout must not allow install until overrides exist.
- Replace/merge decision must be explicit.
- `Details` opens editable tree without losing current dialog state.

### `InstallArchiveDetailsWindow`

States and interactions:

- Archive tree generated from `ContentLayoutPreview`.
- Drag file/folder nodes onto valid folders.
- Hover/drag visual states.
- `Reset` returns targets to original layout.
- Closing applies the current placement overrides back to install dialog.

Tauri parity:

- Use a virtualized tree for large archives.
- Drag-and-drop must create `PlacementOverride` records only; renderer must not move real files.
- Keep reset/apply and invalid-drop feedback.

### `FomodInstallerWindow`

States and interactions:

- Module title/subtitle and step counter.
- Navigation steps with current/visited state.
- Option groups with validation.
- Toggle/select options, effective type/availability rules in view model.
- Previously selected option marker and `UsePreviousSelectionsCommand`.
- Option details panel with image preview.
- Lightbox overlay with responsive decode width.
- Previous/next/install primary button and cancel.

Tauri parity:

- Keep validation scroll-to-target behavior.
- Preserve previous selections.
- Preload/lazy-load preview images to avoid jank.
- Do not make FOMOD rules a loose renderer rewrite unless the bridge exposes the same evaluated model. If rule evaluation remains in C++/bridge, renderer only displays the evaluated wizard DTO.

## Profile manager inventory

Current WPF uses `ProfileManagerWindow` with `MainWindowViewModel` commands:

- `RefreshProfilesCommand`
- `CreateProfileCommand`
- `CloneProfileCommand`
- `RenameProfileCommand`
- `DeleteProfileCommand`
- `OpenProfilesDirectoryCommand`

States:

- `AvailableProfiles`
- `SelectedProfile`
- `ProfileActionName`
- `IsProcessingProfile`
- `CanRenameSelectedProfile`
- `CanDeleteSelectedProfile`
- `ProfileCountText`

Tauri target: `ProfileManagerDialog` or `/builds/:id/profiles`.

Owners:

- Tauri UI: profile list, action name input, selected profile, busy state, validation messages.
- Tauri Rust shell/facade: open profiles directory.
- C++ core: list/create/clone/rename/delete profiles and any profile-scoped refresh.

## Executable manager and launch inventory

`ExecutableManagerWindow` fields:

- `Executables`
- `SelectedExecutable`
- `DisplayName`
- `ExecutablePath`
- `Arguments`
- `WorkingDirectory`
- `IconPath`

Commands/events:

- Add executable.
- Delete executable.
- Browse executable path.
- Browse working directory.
- Save/cancel.
- Validate executable path exists and extension is `.exe`.

Main shell executable commands:

- `OpenExecutableManager` through executable menu/editor service.
- `LaunchSelectedExecutableCommand`.
- `CloseExecutableLaunchProcessCommand`.

Tauri target:

- `ExecutableManagerDialog`.
- `ExecutableSelector` in workspace toolbar.
- `ExecutableLaunchOverlay`.

Owners:

- Tauri UI: list/editor/dropdown and launch overlay.
- Tauri Rust shell/facade: pick executable/folder, shell/process tracking if moved out of renderer.
- C++ core: get/save executables, resolve icon path or expose icon data, launch executable with profile.

Cross-platform note: current validation is Windows `.exe`-centric. Tauri migration must convert this to platform capability/validation rather than hiding unsupported platforms in UI logic.

## Visual parity checklist

Shell and layout:

- Dense desktop workbench, not landing-page layout.
- Left/home project catalog and workspace content hierarchy.
- Project cards/list actions and context menus.
- Workspace toolbar with profile selector, build settings, executable selector and launch.
- Tabs for plugins/data/downloads.
- Embedded create wizard and transfer wizard.

Tables and lists:

- Mods table columns: name, version, latest, status.
- Downloads table columns: name, progress, status, size.
- Plugins list rows with separator rows and locked/disabled states.
- Profile/executable lists in dialogs.
- Smooth scrolling and stable row height.
- Multi-select gestures: replace, range, toggle, select all.

Menus and row actions:

- Project action context menu.
- Mod row context menus for installed mod/separator.
- Plugin row context menus for plugin/separator.
- Download row context menu with resume/cancel/delete/install/open.
- Delete-key shortcuts through context-menu gesture service equivalent.

Drag and drop:

- Mod order drag/drop.
- Plugin order drag/drop.
- Download archive file drag/drop into downloads.
- Download row drag/drop into mod insertion position.
- Archive placement tree drag/drop.

Search/filter:

- Debounced mod search.
- Template/game search in create wizard.
- Search result/empty states.

Empty/error/loading states:

- Empty home/project catalog.
- Empty mod list and search-empty state.
- Empty plugins/downloads/data states.
- Core unavailable state.
- Workspace section load failures.
- Build loading overlay.
- Validation banners in create/settings/build/install flows.

Progress overlays:

- Startup.
- Build create/delete/open.
- FluxPack package/install.
- Mod install/archive operation.
- MO2 transfer.
- Executable launch and process handoff.
- Language switch.

Themes and localization:

- Light/dark theme.
- RU/EN/DE localization files.
- Dynamic language/theme updates.
- Clear focus/disabled/error/loading states in both themes.

Accessibility and keyboard:

- Keyboard navigation for dialogs, lists, tabs and wizard steps.
- Focus restoration after modal/lightbox.
- Focus rings and screen-reader labels for icon-only actions.
- Delete/select-all shortcuts.
- Reduced-motion path for overlays/animations.

Performance parity:

- Virtualize large lists/trees.
- Debounce search.
- Lazy-load heavy dialogs like FOMOD and archive placement.
- Async bridge command only.
- Renderer must remain responsive during C++ operations.
- Track startup, project open, section switch, search, large list scroll, archive file tree and FOMOD wizard.

## Backend and bridge method inventory

The following `CoreBridgeService` methods are part of WPF UI parity and should be represented in the Tauri bridge contract or intentionally replaced by equivalent methods:

- App/settings/templates: `InitializeAsync`, `GetAppLanguageCode`, `SaveAppLanguageCodeAsync`, `GetGameTemplates`, `ResolveTemplate`.
- Project lifecycle: `BuildProjectDirectoryPreviewAsync`, `CreateProjectAsync`, `OpenProjectFromConfigAsync`, `ListProjectConfigsAsync`, `RenameProjectAsync`, `DeleteProjectAsync`.
- Build paths: `GetBuildPathSettingsAsync`, `SaveBuildPathSettingsAsync`.
- FluxPack: `ExportFluxPackAsync`, `InspectFluxPackAsync`, `InstallFluxPackAsync`.
- MO2 transfer: `AnalyzeModOrganizerInstanceAsync`, `ImportModOrganizerInstanceAsync`.
- Executables: `GetGameExecutablesAsync`, `SaveGameExecutablesAsync`, `LaunchGameExecutableAsync`, `ResolveExecutableIconPath`.
- Nexus/NXM: `GetNexusModsAuthStatus`, `ConnectNexusModsAsync`, `DisconnectNexusModsAsync`, `RegisterNxmProtocol`.
- Mods/profiles: `GetInstalledModsAsync`, `GetProfilesAsync`, `CreateProfileAsync`, `CloneProfileAsync`, `RenameProfileAsync`, `DeleteProfileAsync`, `GetModOrderAsync`, `CreateModSeparatorAsync`, `DeleteModSeparatorAsync`, `MoveModOrderItemAsync`, `DeleteInstalledModAsync`, `CreateEmptyModAsync`, `SetInstalledModEnabledAsync`, `SetAllInstalledModsEnabledAsync`, `CheckModUpdatesAsync`, `GetModFileTreeAsync`.
- Plugins: `GetPluginsAsync`, `MovePluginAsync`, `CreatePluginSeparatorAsync`, `DeletePluginSeparatorAsync`, `SetPluginEnabledAsync`.
- Downloads/install: `GetDownloadsAsync`, `CaptureNxmLinksAsync`, `ImportInboundDownloadsAsync`, `ImportDownloadFileAsync`, `DeleteDownloadAsync`, `CancelDownloadAsync`, `ResumeDownloadAsync`, `InstallDownloadAsync`, `InstallArchiveAsync`, `AnalyzeDownloadContentLayoutAsync`, `AnalyzeFomodDownloadAsync`, `AnalyzeFomodDownloadContentLayoutAsync`, `InstallFomodDownloadAsync`, `InstallFomodArchiveAsync`.

## Unknowns and follow-up checks

No additional WPF windows or user-facing process surfaces were found outside the entrypoints listed above in `frontend/`. The separate WPF installer window under `installer/Fluxora.Installer/` is intentionally outside this frontend parity inventory and belongs to the release/installer migration work.

Manual checks still required before closing the visual baseline:

- Run the current WPF app.
- Capture baseline screenshots for: startup, home/project catalog, create wizard, workspace mods, plugins, data tree, downloads, settings sections, build paths, profiles, executables, install options, archive details, FOMOD, MO2 transfer, FluxPack package/install, executable launch.
- Time or record baseline for: startup, project open, section switch, mod search, large list scroll, file tree expansion, FOMOD wizard, archive install, MO2 import progress.
