export const FluxoraIpcChannels = {
  appGetInfo: 'fluxora:app:get-info',
  bridgeGetLanguage: 'fluxora:bridge:get-language',
  bridgeGetStatus: 'fluxora:bridge:get-status',
  bridgeSetLanguage: 'fluxora:bridge:set-language',
  bridgeShutdown: 'fluxora:bridge:shutdown',
  buildPathsGet: 'fluxora:build-paths:get',
  buildPathsSave: 'fluxora:build-paths:save',
  dialogPickBuildConfig: 'fluxora:dialog:pick-build-config',
  dialogPickArchive: 'fluxora:dialog:pick-archive',
  dialogPickExecutable: 'fluxora:dialog:pick-executable',
  dialogPickFluxPack: 'fluxora:dialog:pick-fluxpack',
  dialogPickFolder: 'fluxora:dialog:pick-folder',
  dialogSaveFluxPack: 'fluxora:dialog:save-fluxpack',
  downloadsCancel: 'fluxora:downloads:cancel',
  downloadsDelete: 'fluxora:downloads:delete',
  downloadsAnalyzeContentLayout: 'fluxora:downloads:analyze-content-layout',
  downloadsAnalyzeFomod: 'fluxora:downloads:analyze-fomod',
  downloadsAnalyzeFomodContentLayout: 'fluxora:downloads:analyze-fomod-content-layout',
  downloadsImportFile: 'fluxora:downloads:import-file',
  downloadsInstallFomod: 'fluxora:downloads:install-fomod',
  downloadsInstall: 'fluxora:downloads:install',
  downloadsList: 'fluxora:downloads:list',
  downloadsResume: 'fluxora:downloads:resume',
  executablesGetIcon: 'fluxora:executables:get-icon',
  executablesLaunch: 'fluxora:executables:launch',
  executablesList: 'fluxora:executables:list',
  executablesSave: 'fluxora:executables:save',
  processesWaitForExit: 'fluxora:processes:wait-for-exit',
  processesWatchLaunchReady: 'fluxora:processes:watch-launch-ready',
  linksOpenExternal: 'fluxora:links:open-external',
  modsCheckUpdates: 'fluxora:mods:check-updates',
  modsClearOverwrite: 'fluxora:mods:clear-overwrite',
  modsCreateEmpty: 'fluxora:mods:create-empty',
  modsCreateSeparator: 'fluxora:mods:create-separator',
  modsDeleteInstalled: 'fluxora:mods:delete-installed',
  modsDeleteSeparator: 'fluxora:mods:delete-separator',
  modsGetFileTree: 'fluxora:mods:get-file-tree',
  modsGetOrder: 'fluxora:mods:get-order',
  modsListInstalled: 'fluxora:mods:list-installed',
  modsMoveOrderItem: 'fluxora:mods:move-order-item',
  modsSetAllEnabled: 'fluxora:mods:set-all-enabled',
  modsSetEnabled: 'fluxora:mods:set-enabled',
  pluginsCreateSeparator: 'fluxora:plugins:create-separator',
  pluginsDeleteSeparator: 'fluxora:plugins:delete-separator',
  pluginsList: 'fluxora:plugins:list',
  pluginsMove: 'fluxora:plugins:move',
  pluginsSetAllEnabled: 'fluxora:plugins:set-all-enabled',
  pluginsSetEnabled: 'fluxora:plugins:set-enabled',
  profilesClone: 'fluxora:profiles:clone',
  profilesCreate: 'fluxora:profiles:create',
  profilesDelete: 'fluxora:profiles:delete',
  profilesList: 'fluxora:profiles:list',
  profilesRename: 'fluxora:profiles:rename',
  nxmCaptureLinks: 'fluxora:nxm:capture-links',
  nxmImportInboundDownloads: 'fluxora:nxm:import-inbound-downloads',
  nxmRegisterProtocol: 'fluxora:nxm:register-protocol',
  nexusConnect: 'fluxora:nexus:connect',
  nexusDisconnect: 'fluxora:nexus:disconnect',
  nexusGetAuthStatus: 'fluxora:nexus:get-auth-status',
  operationsCancel: 'fluxora:operations:cancel',
  operationsProgress: 'fluxora:operations:progress',
  archivesInstallFomod: 'fluxora:archives:install-fomod',
  archivesInstall: 'fluxora:archives:install',
  fluxPackExport: 'fluxora:flux-pack:export',
  fluxPackInspect: 'fluxora:flux-pack:inspect',
  fluxPackInstall: 'fluxora:flux-pack:install',
  projectsCreate: 'fluxora:projects:create',
  projectsDelete: 'fluxora:projects:delete',
  projectsList: 'fluxora:projects:list',
  projectsOpenConfig: 'fluxora:projects:open-config',
  projectsPreviewDirectory: 'fluxora:projects:preview-directory',
  projectsRename: 'fluxora:projects:rename',
  securityGetState: 'fluxora:security:get-state',
  settingsGetTheme: 'fluxora:settings:get-theme',
  settingsSetTheme: 'fluxora:settings:set-theme',
  shellOpenPath: 'fluxora:shell:open-path',
  shellShowItemInFolder: 'fluxora:shell:show-item-in-folder',
  templatesList: 'fluxora:templates:list',
  templatesResolve: 'fluxora:templates:resolve',
  transferAnalyzeMo2: 'fluxora:transfer:analyze-mo2',
  transferImportMo2: 'fluxora:transfer:import-mo2',
  transferListDestinationDrives: 'fluxora:transfer:list-destination-drives',
  transferStartMo2InMain: 'fluxora:transfer:start-mo2-in-main',
  transferOpenMo2InMain: 'fluxora:transfer:open-mo2-in-main',
  transferMo2Handoff: 'fluxora:transfer:mo2-handoff',
  transferMo2Open: 'fluxora:transfer:mo2-open',
  uiLog: 'fluxora:ui:log',
  windowClose: 'fluxora:window:close',
  windowMinimize: 'fluxora:window:minimize',
  windowOpenSettings: 'fluxora:window:open-settings',
  windowToggleMaximize: 'fluxora:window:toggle-maximize'
} as const;

export type FluxoraIpcChannel =
  (typeof FluxoraIpcChannels)[keyof typeof FluxoraIpcChannels];

export interface FluxoraAppInfo {
  appName: string;
  version: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  isPackaged: boolean;
}

export interface FluxoraSecurityState {
  contextIsolation: true;
  nodeIntegration: false;
  sandbox: true;
  remoteModule: false;
  allowedIpcChannels: FluxoraIpcChannel[];
  csp: string;
}

export interface OpenExternalResult {
  ok: boolean;
  reason?: 'invalid-url' | 'unsupported-protocol' | 'open-failed';
}

export interface ShellOpenPathResult {
  ok: boolean;
  reason?: 'invalid-path' | 'open-failed';
  message?: string;
}

export interface ShellShowItemInFolderResult {
  ok: boolean;
  reason?: 'invalid-path' | 'show-failed';
  message?: string;
}

export interface DialogPickResult {
  canceled: boolean;
  path?: string;
}

export type DialogSaveResult = DialogPickResult;

export type FluxoraLogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface OperationRequest {
  operationId?: string;
}

export interface NativeBridgeError {
  code: string;
  message: string;
  category: 'validation' | 'core' | 'capability' | 'notFound' | 'conflict' | 'cancelled' | 'transport' | 'internal';
  retryable: boolean;
  capabilityId?: string | null;
  details?: Record<string, unknown>;
}

export type NativeBridgeFeatureState =
  | 'available'
  | 'limited'
  | 'unsupported'
  | 'disabled'
  | 'unknown'
  | 'runtime-shell';

export interface NativeBridgeFeatureCapability {
  state: NativeBridgeFeatureState;
  platforms?: NodeJS.Platform[];
  requires?: string[];
  supports?: string[];
  reason?: string;
}

export type FluxoraTargetPlatform = 'win32' | 'linux' | 'darwin';

export interface FluxoraPlatformSupport {
  platform: FluxoraTargetPlatform;
  label: string;
  state: NativeBridgeFeatureState;
  nativeLibraryName: string;
  bridgeHostName: string;
  packageFormats: string[];
  protocolState: NativeBridgeFeatureState;
  protocolNotes: string;
  shellOpenState: NativeBridgeFeatureState;
  vfsState: NativeBridgeFeatureState;
  vfsNotes: string;
  pathRules: string[];
  releaseNotes: string[];
}

export interface NativeBridgeCapabilities {
  platform: NodeJS.Platform | 'unknown';
  arch: NodeJS.Architecture | 'unknown';
  core: {
    available: boolean;
    libraryName: string;
  };
  features: Record<string, NativeBridgeFeatureCapability>;
  supportMatrix?: FluxoraPlatformSupport[];
}

export interface NativeBridgeStatus {
  ready: boolean;
  operationId: string;
  protocolVersion?: string;
  hostVersion?: string;
  coreVersion?: string;
  coreApiVersion?: string;
  language?: string;
  theme?: FluxoraThemeMode;
  hostPath?: string;
  capabilities?: NativeBridgeCapabilities;
  error?: NativeBridgeError;
  logs: {
    uiLogPath: string;
    mainBridgeLogPath: string;
    nativeLogDirectory?: string;
  };
}

export interface NativeBridgeLanguageResult {
  language: string;
  operationId: string;
}

export type FluxoraThemeMode = 'dark';

export interface NativeBridgeThemeResult {
  theme: FluxoraThemeMode;
  operationId: string;
}

export interface FluxoraTemplateCapability {
  id: string;
  displayName: string;
  description?: string;
}

export interface FluxoraGameCapabilities {
  supportsPlugins?: boolean;
  supportsLoadOrder?: boolean;
  supportsScriptExtender?: boolean;
  supportsVfsLaunch?: boolean;
  [key: string]: unknown;
}

export interface FluxoraGameTemplate {
  id: string;
  displayName: string;
  gameName: string;
  summary: string;
  uiTemplateId: string;
  baseTemplateId?: string;
  defaultProfile?: string;
  dataDirectory?: string;
  nexusDomain?: string;
  folders?: string[];
  profileFiles?: string[];
  basePlugins?: string[];
  pluginExtensions?: string[];
  archiveExtensions?: string[];
  requiredFiles?: string[];
  executables?: string[];
  capabilities?: FluxoraTemplateCapability[];
  gameCapabilities?: FluxoraGameCapabilities;
  contentLayoutSummary?: Record<string, unknown>;
  executableDisplayMetadata?: unknown;
  launchTrackingMetadata?: unknown;
}

export interface FluxoraExecutable {
  id: string;
  displayName: string;
  executablePath: string;
  arguments: string;
  workingDirectory: string;
  iconPath: string;
  executableDisplayMetadata?: unknown;
}

export interface FluxoraExecutableLaunchResult extends FluxoraExecutable {
  resolvedExecutablePath: string;
  resolvedWorkingDirectory: string;
  launchTrackingKind: string;
  expectedChildProcessNames: string[];
  handoffDisplayName: string;
  handoffTimeoutMs: number;
  launchTrackingMetadata?: unknown;
  processId: number;
  operationId: string;
}

export type FluxoraProcessWatchState = 'running' | 'exited' | 'notFound' | 'timeout';

export interface FluxoraLaunchProcessWatchRequest {
  processId: number;
  processName?: string;
  launchTrackingKind?: string;
  expectedChildProcessNames?: string[];
  handoffTimeoutMs?: number;
  pollIntervalMs?: number;
  operationId?: string;
}

export interface FluxoraProcessWatchResult {
  processId: number;
  processName: string;
  state: FluxoraProcessWatchState;
  trackedKind: string;
  operationId: string;
}

export interface FluxoraExecutableIconResult {
  iconPath: string;
  operationId: string;
}

export interface FluxoraProject {
  id: string;
  name: string;
  templateId: string;
  uiTemplateId: string;
  gameName: string;
  gamePath: string;
  installRootDirectory: string;
  projectDirectory: string;
  configPath: string;
  paths?: {
    gameDirectory?: string;
    modsDirectory?: string;
    profilesDirectory?: string;
    downloadsDirectory?: string;
    overwriteDirectory?: string;
  };
  gameCapabilities?: FluxoraGameCapabilities;
  gameHealthSummary?: Record<string, unknown>;
  projectFingerprint?: Record<string, unknown> | null;
  contentLayoutSummary?: Record<string, unknown>;
  executables?: FluxoraExecutable[];
  template?: FluxoraGameTemplate;
}

export interface FluxoraProjectCatalog {
  projects: FluxoraProject[];
  buildConfigsDirectory: string;
  defaultInstallRootDirectory: string;
  operationId: string;
}

export interface FluxoraProjectDirectoryPreview {
  projectDirectory: string;
  operationId: string;
}

export interface CreateFluxoraProjectRequest {
  projectName: string;
  templateId: string;
  gamePath: string;
  installRootDirectory: string;
}

export interface DeleteFluxoraProjectResult {
  accepted: boolean;
  configPath: string;
  operationId: string;
}

export interface FluxoraBuildPathSettings {
  gameDirectory: string;
  modsDirectory: string;
  profilesDirectory: string;
  downloadsDirectory: string;
  overwriteDirectory: string;
  operationId?: string;
}

export interface FluxoraBuildPathSettingsSaveRequest {
  gameDirectory: string;
  modsDirectory: string;
  profilesDirectory: string;
  downloadsDirectory: string;
  overwriteDirectory: string;
}

export interface FluxoraFluxPackSummary {
  outputPath: string;
  buildName: string;
  formatVersion: number;
  manifestBytes: number;
  sourceArchiveCount: number;
  generatedAssetCount: number;
  customPatchCount: number;
  customConfigCount: number;
  installStepCount: number;
  generatedAssetsIncluded: boolean;
  installPlanAvailable: boolean;
  operationId: string;
}

export interface FluxoraFluxPackExportRequest {
  configPath: string;
  outputPath: string;
  includeGeneratedAssets: boolean;
}

export interface FluxoraFluxPackInstallRequest {
  fluxPackPath: string;
  installRootDirectory: string;
}

export interface FluxoraFluxPackProviderProgress {
  providerId: string;
  displayName: string;
  totalCount: number;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
  currentItem: string;
  statusText: string;
  progressPercent: number;
}

export interface FluxoraFluxPackInstallResult {
  summary: FluxoraFluxPackSummary;
  configPath: string;
  projectDirectory: string;
  buildName: string;
  totalSourceCount: number;
  installedSourceCount: number;
  pendingSourceCount: number;
  failedSourceCount: number;
  appliedConfigCount: number;
  appliedProfileOrderItemCount: number;
  hasWarnings: boolean;
  operationId: string;
}

export interface FluxoraInstalledMod {
  id: string;
  name: string;
  version: string;
  latestVersion: string;
  lastCheckedAt: string;
  updateStatus: string;
  conflictStatus: string;
  fileCount: number;
  conflictingFileCount: number;
  overwrittenFileCount: number;
  overwritingFileCount: number;
  isEnabled: boolean;
  canCheckUpdates: boolean;
  hasUpdate: boolean;
  sourceIsNexus: boolean;
  sourceIsModdingFlow: boolean;
  isLocal: boolean;
  isTranslation: boolean;
  isPatch: boolean;
}

export interface FluxoraModOrderItem extends FluxoraInstalledMod {
  orderId: string;
  kind: string;
  order: number;
  isSeparator: boolean;
  isMod: boolean;
  isOverwrite?: boolean;
  modUuid: string;
  separatorTitle: string;
}

export interface FluxoraModFileTreeEntry {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  hasChildren: boolean;
  size: number;
  conflictState: string;
  conflictOwners: string[];
}

export interface FluxoraModMutationResult {
  accepted: boolean;
  operationId: string;
  modPath?: string;
  isEnabled?: boolean;
}

export interface FluxoraPluginOrderItem {
  id: string;
  orderId: string;
  kind: string;
  order: number;
  isSeparator: boolean;
  isPlugin: boolean;
  name: string;
  separatorTitle: string;
  extension: string;
  sourceMod: string;
  isEnabled: boolean;
  isMaster: boolean;
  isLight: boolean;
  isLocked: boolean;
  lockReason: string;
  missingMasters: string[];
}

export interface FluxoraDownloadEntry {
  id: string;
  name: string;
  fileName: string;
  localPath: string;
  source: string;
  status: string;
  sizeText: string;
  createdAtText: string;
  progressPercent: number;
  progressText: string;
  etaText: string;
  downloadSpeedText: string;
  isDownloading: boolean;
  hasKnownProgress: boolean;
  canResume: boolean;
  canInstall: boolean;
  canDelete: boolean;
}

export type FluxoraExistingModInstallMode = 0 | 1 | 2;

export interface FluxoraContentLayoutPreviewSummary {
  supported: boolean;
  hasWarnings: boolean;
  hasBlockers: boolean;
  totalEntries: number;
  plannedEntries: number;
  gameDataEntries: number;
  gameRootEntries: number;
  pluginEntries: number;
  archiveEntries: number;
  scriptExtenderEntries: number;
  unknownEntries: number;
  unsafeEntries: number;
}

export interface FluxoraContentLayoutPreviewEntry {
  sourcePath: string;
  target: string;
  contentArea: string;
  targetRelativePath: string;
  classification: string;
  explanation: string;
  manualOverrideAllowed: boolean;
  safeManualTargets: string[];
}

export interface FluxoraContentLayoutFinding {
  severity: string;
  path: string;
  classification: string;
  message: string;
  blocksInstall: boolean;
}

export interface FluxoraContentLayoutPreview {
  gameId: string;
  gameDisplayName: string;
  rootFileWrapperDirectory: string;
  canInstall: boolean;
  summary: FluxoraContentLayoutPreviewSummary;
  entries: FluxoraContentLayoutPreviewEntry[];
  validationFindings: FluxoraContentLayoutFinding[];
  explanationSummary: string;
  explanationDetails: string[];
}

export interface FluxoraPlacementOverride {
  sourcePath: string;
  target: string;
  targetRelativePath: string;
}

export interface FluxoraFomodFileDependencyState {
  file: string;
  exists: boolean;
}

export interface FluxoraFomodConditionFlag {
  name: string;
  value: string;
}

export interface FluxoraFomodDependency {
  kind: string;
  operator: string;
  file: string;
  state: string;
  flag: string;
  value: string;
  version: string;
  children: FluxoraFomodDependency[];
}

export interface FluxoraFomodTypePattern {
  dependencies: FluxoraFomodDependency | null;
  type: string;
}

export interface FluxoraFomodOption {
  id: string;
  name: string;
  description: string;
  imagePath: string;
  type: string;
  defaultType: string;
  flags: FluxoraFomodConditionFlag[];
  typePatterns: FluxoraFomodTypePattern[];
}

export interface FluxoraFomodGroup {
  id: string;
  name: string;
  type: string;
  options: FluxoraFomodOption[];
}

export interface FluxoraFomodStep {
  id: string;
  name: string;
  visible: FluxoraFomodDependency | null;
  groups: FluxoraFomodGroup[];
}

export interface FluxoraFomodInstaller {
  isFomod: boolean;
  moduleName: string;
  moduleVersion: string;
  moduleId: string;
  moduleImagePath: string;
  memoryKey: string;
  hasPreviousSelection: boolean;
  previousSelectedOptionIds: string[];
  fileDependencies: FluxoraFomodFileDependencyState[];
  requiredFiles: unknown[];
  steps: FluxoraFomodStep[];
  conditionalFilePatterns: unknown[];
}

export interface FluxoraAnalyzeContentLayoutRequest {
  projectDirectory: string;
  downloadPath: string;
  existingModMode?: FluxoraExistingModInstallMode;
}

export interface FluxoraAnalyzeFomodContentLayoutRequest extends FluxoraAnalyzeContentLayoutRequest {
  selectedOptionIds: string[];
}

export interface FluxoraInstallArchiveRequest {
  projectDirectory: string;
  archivePath: string;
  modName: string;
  existingModMode?: FluxoraExistingModInstallMode;
  placementOverridesJson?: string;
}

export interface FluxoraInstallFomodArchiveRequest extends FluxoraInstallArchiveRequest {
  selectedOptionIds: string[];
}

export interface FluxoraInstallDownloadRequest {
  projectDirectory: string;
  downloadPath: string;
  modName: string;
  existingModMode?: FluxoraExistingModInstallMode;
  placementOverridesJson?: string;
}

export interface FluxoraInstallFomodDownloadRequest extends FluxoraInstallDownloadRequest {
  selectedOptionIds: string[];
}

export interface FluxoraInstalledModSummary {
  id: string;
  name: string;
  version: string;
  isEnabled: boolean;
  operationId: string;
}

export interface FluxoraDownloadMutationResult {
  accepted: boolean;
  downloadPath: string;
  operationId: string;
}

export interface FluxoraNxmProtocolResult {
  registered: boolean;
  isRegistered?: boolean;
  platform: NodeJS.Platform;
  state: NativeBridgeFeatureState;
  message: string;
  operationId: string;
}

export interface FluxoraNexusModsAuthStatus {
  isConfigured: boolean;
  isLinked: boolean;
  displayName: string;
  userId: string;
  message: string;
  clientId: string;
  redirectUri: string;
  operationId: string;
}

export interface FluxoraModOrganizerImportAnalysis {
  sourceDirectory: string;
  destinationRootDirectory: string;
  targetProjectDirectory: string;
  targetConfigPath: string;
  projectName: string;
  profileName: string;
  templateId: string;
  gameName: string;
  gamePath: string;
  totalBytes: number;
  availableBytes: number;
  modCount: number;
  separatorCount: number;
  hasEnoughSpace: boolean;
  willOverwrite: boolean;
  canImport: boolean;
  statusMessage: string;
  warningMessage: string;
  operationId: string;
}

export interface FluxoraModOrganizerImportProgress {
  operationId: string;
  phase: string;
  currentStep: string;
  currentItem: string;
  overallPercent: number;
  copyPercent: number;
  databasePercent: number;
  copiedBytes: number;
  totalBytes: number;
}

export interface FluxoraOperationProgress extends FluxoraModOrganizerImportProgress {
  statusMessage?: string;
  totalSourceCount?: number;
  installedSourceCount?: number;
  pendingSourceCount?: number;
  failedSourceCount?: number;
  deletedBytes?: number;
  deletedEntries?: number;
  totalEntries?: number;
  providers?: FluxoraFluxPackProviderProgress[];
}

export interface FluxoraModOrganizerImportRequest {
  sourceDirectory: string;
  destinationRootDirectory: string;
  existingConfigPath?: string;
  replaceExisting: boolean;
}

export type FluxoraTransferDriveKind =
  | 'nvme'
  | 'ssd'
  | 'hdd'
  | 'removable'
  | 'network'
  | 'unknown';

export interface FluxoraTransferDriveOption {
  id: string;
  rootPath: string;
  label: string;
  volumeName: string;
  fileSystem: string;
  totalBytes: number;
  availableBytes: number;
  driveKind: FluxoraTransferDriveKind;
  mediaLabel: string;
  busType: string;
  friendlyName: string;
  isSystem: boolean;
}

export interface FluxoraMo2TransferHandoff {
  request: FluxoraModOrganizerImportRequest;
  analysis?: FluxoraModOrganizerImportAnalysis;
}

export interface FluxoraOperationCancelResult {
  operationId: string;
  status: 'accepted' | 'notFound' | 'unsupported';
  accepted: boolean;
}

export interface UiLogEntry {
  level: FluxoraLogLevel;
  message: string;
  operationId?: string;
  category?: string;
}

export interface FluxoraApi {
  app: {
    getInfo: () => Promise<FluxoraAppInfo>;
  };
  bridge: {
    getStatus: (request?: OperationRequest) => Promise<NativeBridgeStatus>;
    getLanguage: (request?: OperationRequest) => Promise<NativeBridgeLanguageResult>;
    setLanguage: (
      language: string,
      request?: OperationRequest
    ) => Promise<NativeBridgeLanguageResult>;
    shutdown: (request?: OperationRequest) => Promise<{ accepted: boolean; operationId: string }>;
  };
  settings: {
    getLanguage: (request?: OperationRequest) => Promise<NativeBridgeLanguageResult>;
    setLanguage: (
      language: string,
      request?: OperationRequest
    ) => Promise<NativeBridgeLanguageResult>;
    getTheme: (request?: OperationRequest) => Promise<NativeBridgeThemeResult>;
    setTheme: (
      theme: FluxoraThemeMode,
      request?: OperationRequest
    ) => Promise<NativeBridgeThemeResult>;
  };
  dialogs: {
    pickArchive: (initialDirectory?: string) => Promise<DialogPickResult>;
    pickBuildConfig: (initialDirectory?: string) => Promise<DialogPickResult>;
    pickExecutable: (
      title?: string,
      initialPath?: string
    ) => Promise<DialogPickResult>;
    pickFluxPack: (initialDirectory?: string) => Promise<DialogPickResult>;
    pickFolder: (title?: string, initialPath?: string) => Promise<DialogPickResult>;
    saveFluxPack: (
      defaultPath?: string,
      title?: string
    ) => Promise<DialogSaveResult>;
  };
  links: {
    openExternal: (url: string) => Promise<OpenExternalResult>;
  };
  mods: {
    listInstalled: (
      projectDirectory: string,
      request?: OperationRequest
    ) => Promise<FluxoraInstalledMod[]>;
    getOrder: (
      projectDirectory: string,
      profileName?: string,
      request?: OperationRequest
    ) => Promise<FluxoraModOrderItem[]>;
    createSeparator: (
      projectDirectory: string,
      profileName: string | undefined,
      title: string,
      targetIndex: number,
      request?: OperationRequest
    ) => Promise<FluxoraModOrderItem[]>;
    deleteSeparator: (
      projectDirectory: string,
      profileName: string | undefined,
      separatorId: string,
      request?: OperationRequest
    ) => Promise<FluxoraModOrderItem[]>;
    moveOrderItem: (
      projectDirectory: string,
      profileName: string | undefined,
      orderItemId: string,
      targetIndex: number,
      request?: OperationRequest
    ) => Promise<FluxoraModOrderItem[]>;
    deleteInstalled: (
      projectDirectory: string,
      modPath: string,
      request?: OperationRequest
    ) => Promise<FluxoraModMutationResult>;
    createEmpty: (
      projectDirectory: string,
      modName: string,
      request?: OperationRequest
    ) => Promise<FluxoraInstalledMod>;
    setEnabled: (
      projectDirectory: string,
      modPath: string,
      isEnabled: boolean,
      request?: OperationRequest
    ) => Promise<FluxoraModMutationResult>;
    setAllEnabled: (
      projectDirectory: string,
      isEnabled: boolean,
      request?: OperationRequest
    ) => Promise<FluxoraModMutationResult>;
    checkUpdates: (
      projectDirectory: string,
      request?: OperationRequest
    ) => Promise<FluxoraInstalledMod[]>;
    clearOverwrite: (
      projectDirectory: string,
      request?: OperationRequest
    ) => Promise<FluxoraModMutationResult>;
    getFileTree: (
      projectDirectory: string,
      modPath: string,
      relativeDirectory?: string,
      request?: OperationRequest
    ) => Promise<FluxoraModFileTreeEntry[]>;
  };
  plugins: {
    list: (
      projectDirectory: string,
      templateId: string,
      profileName?: string,
      request?: OperationRequest
    ) => Promise<FluxoraPluginOrderItem[]>;
    createSeparator: (
      projectDirectory: string,
      templateId: string,
      profileName: string | undefined,
      title: string,
      targetIndex: number,
      request?: OperationRequest
    ) => Promise<FluxoraPluginOrderItem[]>;
    deleteSeparator: (
      projectDirectory: string,
      templateId: string,
      profileName: string | undefined,
      separatorId: string,
      request?: OperationRequest
    ) => Promise<FluxoraPluginOrderItem[]>;
    move: (
      projectDirectory: string,
      templateId: string,
      profileName: string | undefined,
      orderItemId: string,
      targetIndex: number,
      request?: OperationRequest
    ) => Promise<FluxoraPluginOrderItem[]>;
    setEnabled: (
      projectDirectory: string,
      templateId: string,
      profileName: string | undefined,
      pluginName: string,
      isEnabled: boolean,
      request?: OperationRequest
    ) => Promise<FluxoraPluginOrderItem[]>;
    setAllEnabled: (
      projectDirectory: string,
      templateId: string,
      profileName: string | undefined,
      isEnabled: boolean,
      request?: OperationRequest
    ) => Promise<FluxoraPluginOrderItem[]>;
  };
  profiles: {
    list: (
      projectDirectory: string,
      defaultProfileName?: string,
      request?: OperationRequest
    ) => Promise<string[]>;
    create: (
      projectDirectory: string,
      profileName: string,
      defaultProfileName?: string,
      profileFiles?: string[],
      request?: OperationRequest
    ) => Promise<string[]>;
    clone: (
      projectDirectory: string,
      sourceProfileName: string,
      targetProfileName: string,
      defaultProfileName?: string,
      request?: OperationRequest
    ) => Promise<string[]>;
    rename: (
      projectDirectory: string,
      sourceProfileName: string,
      targetProfileName: string,
      defaultProfileName?: string,
      request?: OperationRequest
    ) => Promise<string[]>;
    delete: (
      projectDirectory: string,
      profileName: string,
      defaultProfileName?: string,
      request?: OperationRequest
    ) => Promise<string[]>;
  };
  executables: {
    list: (
      configPath: string,
      request?: OperationRequest
    ) => Promise<FluxoraExecutable[]>;
    save: (
      configPath: string,
      executables: FluxoraExecutable[],
      request?: OperationRequest
    ) => Promise<FluxoraExecutable[]>;
    launch: (
      configPath: string,
      executableId: string,
      profileName?: string,
      request?: OperationRequest
    ) => Promise<FluxoraExecutableLaunchResult>;
    getIcon: (
      executablePath: string,
      request?: OperationRequest
    ) => Promise<FluxoraExecutableIconResult>;
  };
  processes: {
    waitForLaunchReady: (
      launch: FluxoraLaunchProcessWatchRequest,
      request?: OperationRequest
    ) => Promise<FluxoraProcessWatchResult>;
    waitForExit: (
      processId: number,
      request?: OperationRequest
    ) => Promise<FluxoraProcessWatchResult>;
  };
  downloads: {
    list: (
      projectDirectory: string,
      request?: OperationRequest
    ) => Promise<FluxoraDownloadEntry[]>;
    importFile: (
      projectDirectory: string,
      sourcePath: string,
      request?: OperationRequest
    ) => Promise<FluxoraDownloadEntry>;
    delete: (
      projectDirectory: string,
      downloadPath: string,
      request?: OperationRequest
    ) => Promise<FluxoraDownloadMutationResult>;
    cancel: (
      projectDirectory: string,
      downloadPath: string,
      request?: OperationRequest
    ) => Promise<FluxoraDownloadMutationResult>;
    resume: (
      projectDirectory: string,
      downloadPath: string,
      request?: OperationRequest
    ) => Promise<FluxoraDownloadEntry>;
    analyzeContentLayout: (
      request: FluxoraAnalyzeContentLayoutRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraContentLayoutPreview>;
    analyzeFomod: (
      projectDirectory: string,
      downloadPath: string,
      operation?: OperationRequest
    ) => Promise<FluxoraFomodInstaller>;
    analyzeFomodContentLayout: (
      request: FluxoraAnalyzeFomodContentLayoutRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraContentLayoutPreview>;
    install: (
      request: FluxoraInstallDownloadRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraInstalledModSummary>;
    installFomod: (
      request: FluxoraInstallFomodDownloadRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraInstalledModSummary>;
  };
  archives: {
    install: (
      request: FluxoraInstallArchiveRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraInstalledModSummary>;
    installFomod: (
      request: FluxoraInstallFomodArchiveRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraInstalledModSummary>;
  };
  nxm: {
    registerProtocol: (request?: OperationRequest) => Promise<FluxoraNxmProtocolResult>;
    captureLinks: (
      projectDirectory: string | undefined,
      links: string[],
      request?: OperationRequest
    ) => Promise<FluxoraDownloadEntry[]>;
    importInboundDownloads: (
      projectDirectory: string,
      request?: OperationRequest
    ) => Promise<FluxoraDownloadEntry[]>;
  };
  nexus: {
    getAuthStatus: (request?: OperationRequest) => Promise<FluxoraNexusModsAuthStatus>;
    connect: (request?: OperationRequest) => Promise<FluxoraNexusModsAuthStatus>;
    disconnect: (request?: OperationRequest) => Promise<FluxoraNexusModsAuthStatus>;
  };
  transfer: {
    analyzeMo2: (
      sourceDirectory: string,
      destinationRootDirectory: string,
      existingConfigPath?: string,
      request?: OperationRequest
    ) => Promise<FluxoraModOrganizerImportAnalysis>;
    importMo2: (
      request: FluxoraModOrganizerImportRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraProject>;
    listDestinationDrives: (
      request?: OperationRequest
    ) => Promise<FluxoraTransferDriveOption[]>;
    startMo2InMain: (handoff: FluxoraMo2TransferHandoff) => Promise<void>;
    openMo2InMain: () => Promise<void>;
    onMo2Handoff: (callback: (handoff: FluxoraMo2TransferHandoff) => void) => () => void;
    onMo2Open: (callback: () => void) => () => void;
  };
  buildPaths: {
    get: (
      configPath: string,
      request?: OperationRequest
    ) => Promise<FluxoraBuildPathSettings>;
    save: (
      configPath: string,
      settings: FluxoraBuildPathSettingsSaveRequest,
      request?: OperationRequest
    ) => Promise<FluxoraBuildPathSettings>;
  };
  fluxPack: {
    export: (
      request: FluxoraFluxPackExportRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraFluxPackSummary>;
    inspect: (
      fluxPackPath: string,
      request?: OperationRequest
    ) => Promise<FluxoraFluxPackSummary>;
    install: (
      request: FluxoraFluxPackInstallRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraFluxPackInstallResult>;
  };
  operations: {
    cancel: (operationId: string, request?: OperationRequest) => Promise<FluxoraOperationCancelResult>;
    onProgress: (callback: (progress: FluxoraOperationProgress) => void) => () => void;
  };
  projects: {
    list: (request?: OperationRequest) => Promise<FluxoraProjectCatalog>;
    openConfig: (
      configPath: string,
      request?: OperationRequest
    ) => Promise<FluxoraProject>;
    previewDirectory: (
      projectName: string,
      installRootDirectory: string,
      request?: OperationRequest
    ) => Promise<FluxoraProjectDirectoryPreview>;
    create: (
      project: CreateFluxoraProjectRequest,
      request?: OperationRequest
    ) => Promise<FluxoraProject>;
    rename: (
      configPath: string,
      newName: string,
      request?: OperationRequest
    ) => Promise<FluxoraProject>;
    delete: (
      configPath: string,
      request?: OperationRequest
    ) => Promise<DeleteFluxoraProjectResult>;
  };
  security: {
    getState: () => Promise<FluxoraSecurityState>;
  };
  shell: {
    openPath: (path: string) => Promise<ShellOpenPathResult>;
    showItemInFolder: (path: string) => Promise<ShellShowItemInFolderResult>;
  };
  templates: {
    list: (request?: OperationRequest) => Promise<FluxoraGameTemplate[]>;
    resolve: (
      templateId: string,
      request?: OperationRequest
    ) => Promise<FluxoraGameTemplate>;
  };
  ui: {
    log: (entry: UiLogEntry) => Promise<void>;
  };
  windowControls: {
    close: () => Promise<void>;
    minimize: () => Promise<void>;
    openSettings: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
  };
}
