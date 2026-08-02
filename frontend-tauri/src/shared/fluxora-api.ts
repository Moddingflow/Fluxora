export const FluxoraIpcChannels = {
  aiArmMicrophoneCapture: 'fluxora:ai:arm-microphone-capture',
  aiCancelVoiceTranscription: 'fluxora:ai:cancel-voice-transcription',
  aiCancelRun: 'fluxora:ai:cancel-run',
  aiChatRespond: 'fluxora:ai:chat-respond',
  aiUndoCapability: 'fluxora:ai:undo-capability',
  aiEstimateContext: 'fluxora:ai:estimate-context',
  aiConnectProvider: 'fluxora:ai:connect-provider',
  aiDisconnectProvider: 'fluxora:ai:disconnect-provider',
  aiFileRead: 'fluxora:ai:file-read',
  aiFileEndChat: 'fluxora:ai:file-end-chat',
  aiFileSave: 'fluxora:ai:file-save',
  aiFileSetDirty: 'fluxora:ai:file-set-dirty',
  aiFileRollbackFile: 'fluxora:ai:file-rollback-file',
  aiFileRollbackRun: 'fluxora:ai:file-rollback-run',
  aiFileGetRollbackStates: 'fluxora:ai:file-get-rollback-states',
  aiFileResetRollbackCheckpoints: 'fluxora:ai:file-reset-rollback-checkpoints',
  aiGetStatus: 'fluxora:ai:get-status',
  aiListModels: 'fluxora:ai:list-models',
  aiListProviders: 'fluxora:ai:list-providers',
  aiOpenMicrophonePrivacySettings: 'fluxora:ai:open-microphone-privacy-settings',
  aiPrepareVoice: 'fluxora:ai:prepare-voice',
  aiResetMicrophonePermission: 'fluxora:ai:reset-microphone-permission',
  aiRestartHost: 'fluxora:ai:restart-host',
  aiRunEvent: 'fluxora:ai:run-event',
  aiTestProvider: 'fluxora:ai:test-provider',
  aiTranscribeVoice: 'fluxora:ai:transcribe-voice',
  apiLimitsList: 'fluxora:api-limits:list',
  connectionsCancelConnect: 'fluxora:connections:cancel-connect',
  connectionsConnect: 'fluxora:connections:connect',
  connectionsDisconnect: 'fluxora:connections:disconnect',
  connectionsListStatus: 'fluxora:connections:list-status',
  connectionsRestoreAll: 'fluxora:connections:restore-all',
  managerHandoffOpenDefaultAppSettings:
    'fluxora:manager-handoff:open-default-app-settings',
  appGetInfo: 'fluxora:app:get-info',
  bridgeGetLanguage: 'fluxora:bridge:get-language',
  bridgeGetStatus: 'fluxora:bridge:get-status',
  bridgeSetLanguage: 'fluxora:bridge:set-language',
  bridgeShutdown: 'fluxora:bridge:shutdown',
  buildPrepareWorkspaceIndexes: 'fluxora:build:prepare-workspace-indexes',
  buildPathsGet: 'fluxora:build-paths:get',
  buildPathsSave: 'fluxora:build-paths:save',
  dialogPickBuildConfig: 'fluxora:dialog:pick-build-config',
  dialogPickArchive: 'fluxora:dialog:pick-archive',
  dialogPickExecutable: 'fluxora:dialog:pick-executable',
  dialogPickFluxPack: 'fluxora:dialog:pick-fluxpack',
  dialogPickFolder: 'fluxora:dialog:pick-folder',
  dialogPickTextFile: 'fluxora:dialog:pick-text-file',
  dialogSaveFluxPack: 'fluxora:dialog:save-fluxpack',
  dialogSaveTextFile: 'fluxora:dialog:save-text-file',
  downloadsCancel: 'fluxora:downloads:cancel',
  downloadsDelete: 'fluxora:downloads:delete',
  downloadsAnalyzeContentLayout: 'fluxora:downloads:analyze-content-layout',
  downloadsAnalyzeFomod: 'fluxora:downloads:analyze-fomod',
  downloadsAnalyzeFomodContentLayout: 'fluxora:downloads:analyze-fomod-content-layout',
  downloadsImportFile: 'fluxora:downloads:import-file',
  downloadsRename: 'fluxora:downloads:rename',
  downloadsPlanInstall: 'fluxora:downloads:plan-install',
  downloadsInstallFomod: 'fluxora:downloads:install-fomod',
  downloadsInstall: 'fluxora:downloads:install',
  downloadsGetDelta: 'fluxora:downloads:get-delta',
  downloadsList: 'fluxora:downloads:list',
  downloadsResume: 'fluxora:downloads:resume',
  downloadsResolveDuplicateDecision: 'fluxora:downloads:resolve-duplicate-decision',
  downloadsWatchFolder: 'fluxora:downloads:watch-folder',
  downloadsUnwatchFolder: 'fluxora:downloads:unwatch-folder',
  downloadsFolderChanged: 'fluxora:downloads:folder-changed',
  downloadsChanged: 'fluxora:downloads:changed',
  buildContentWatch: 'fluxora:build-content:watch',
  buildContentUnwatch: 'fluxora:build-content:unwatch',
  buildContentChanged: 'fluxora:build-content:changed',
  executablesGetIcon: 'fluxora:executables:get-icon',
  executablesCompleteManagedLaunch: 'fluxora:executables:complete-managed-launch',
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
  modsRenameInstalled: 'fluxora:mods:rename-installed',
  modsDeleteSeparator: 'fluxora:mods:delete-separator',
  modsGetEffectiveFileTree: 'fluxora:mods:get-effective-file-tree',
  modsGetEffectiveFileTreeChildren: 'fluxora:mods:get-effective-file-tree-children',
  modsGetEffectiveFileTreeRoot: 'fluxora:mods:get-effective-file-tree-root',
  modsGetFileTree: 'fluxora:mods:get-file-tree',
  modsGetModDetailsContent: 'fluxora:mods:get-mod-details-content',
  modsGetModConflictTree: 'fluxora:mods:get-mod-conflict-tree',
  modsGetModDetailsSummary: 'fluxora:mods:get-mod-details-summary',
  modsGetOrder: 'fluxora:mods:get-order',
  modsGetPersistedWorkspace: 'fluxora:mods:get-persisted-workspace',
  modsGetWorkspace: 'fluxora:mods:get-workspace',
  modsInvalidateFileCaches: 'fluxora:mods:invalidate-file-caches',
  workspaceGetDelta: 'fluxora:workspace:get-delta',
  modsStartNifPreview: 'fluxora:mods:start-nif-preview',
  modsPrepareNifPreviewVariant: 'fluxora:mods:prepare-nif-preview-variant',
  modsPrepareNifPreviewTextures: 'fluxora:mods:prepare-nif-preview-textures',
  modsReadNifPreviewAssetBytes: 'fluxora:mods:read-nif-preview-asset-bytes',
  modsEndNifPreview: 'fluxora:mods:end-nif-preview',
  modsListInstalled: 'fluxora:mods:list-installed',
  modsMoveOrderItem: 'fluxora:mods:move-order-item',
  modsRebasePendingInstall: 'fluxora:mods:rebase-pending-install',
  modsPreviewTextFile: 'fluxora:mods:preview-text-file',
  modsReadTextFile: 'fluxora:mods:read-text-file',
  modsSaveTextFile: 'fluxora:mods:save-text-file',
  modsSetAllEnabled: 'fluxora:mods:set-all-enabled',
  modsSetEnabled: 'fluxora:mods:set-enabled',
  pluginsCreateSeparator: 'fluxora:plugins:create-separator',
  pluginsDeleteSeparator: 'fluxora:plugins:delete-separator',
  pluginsList: 'fluxora:plugins:list',
  pluginsListPersisted: 'fluxora:plugins:list-persisted',
  pluginsMove: 'fluxora:plugins:move',
  pluginsSetAllEnabled: 'fluxora:plugins:set-all-enabled',
  pluginsSetEnabled: 'fluxora:plugins:set-enabled',
  profilesClone: 'fluxora:profiles:clone',
  profilesCreate: 'fluxora:profiles:create',
  profilesDelete: 'fluxora:profiles:delete',
  profilesList: 'fluxora:profiles:list',
  profilesPreviewTextFile: 'fluxora:profiles:preview-text-file',
  profilesRename: 'fluxora:profiles:rename',
  nxmCaptureLinks: 'fluxora:nxm:capture-links',
  nxmInboundLinksCaptured: 'fluxora:nxm:inbound-links-captured',
  nxmImportInboundDownloads: 'fluxora:nxm:import-inbound-downloads',
  nxmRegisterProtocol: 'fluxora:nxm:register-protocol',
  moddingFlowActivationCaptured: 'fluxora:moddingflow:activation-captured',
  moddingFlowActivationConsumePending: 'fluxora:moddingflow:activation-consume-pending',
  moddingFlowActivationPreview: 'fluxora:moddingflow:activation-preview',
  moddingFlowActivationPlanPreview: 'fluxora:moddingflow:activation-plan-preview',
  moddingFlowActivationAccept: 'fluxora:moddingflow:activation-accept',
  moddingFlowActivationDismiss: 'fluxora:moddingflow:activation-dismiss',
  nexusConnect: 'fluxora:nexus:connect',
  nexusConnectWithApiKey: 'fluxora:nexus:connect-with-api-key',
  nexusDisconnect: 'fluxora:nexus:disconnect',
  nexusGetAuthStatus: 'fluxora:nexus:get-auth-status',
  operationsCancel: 'fluxora:operations:cancel',
  operationsGetStatus: 'fluxora:operations:get-status',
  operationsProgress: 'fluxora:operations:progress',
  operationsRecentLogs: 'fluxora:operations:recent-logs',
  installsSubmit: 'fluxora:installs:submit',
  installsCancel: 'fluxora:installs:cancel',
  installsRestore: 'fluxora:installs:restore',
  installsList: 'fluxora:installs:list',
  installsGet: 'fluxora:installs:get',
  installsProgress: 'fluxora:installs:progress',
  archivesInstallFomod: 'fluxora:archives:install-fomod',
  archivesPlanInstall: 'fluxora:archives:plan-install',
  archivesInstall: 'fluxora:archives:install',
  buildSettingsNotifyPathsSaved: 'fluxora:build-settings:notify-paths-saved',
  buildSettingsPathsSaved: 'fluxora:build-settings:paths-saved',
  fluxPackExport: 'fluxora:flux-pack:export',
  fluxPackInspect: 'fluxora:flux-pack:inspect',
  fluxPackPlanInstall: 'fluxora:flux-pack:plan-install',
  fluxPackInstall: 'fluxora:flux-pack:install',
  grassCacheGenerate: 'fluxora:grass-cache:generate',
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
  clipboardWriteText: 'fluxora:clipboard:write-text',
  templatesList: 'fluxora:templates:list',
  templatesResolve: 'fluxora:templates:resolve',
  textFilesRead: 'fluxora:text-files:read',
  textFilesSave: 'fluxora:text-files:save',
  transferAnalyzeMo2: 'fluxora:transfer:analyze-mo2',
  transferImportMo2: 'fluxora:transfer:import-mo2',
  transferListDestinationDrives: 'fluxora:transfer:list-destination-drives',
  transferStartMo2InMain: 'fluxora:transfer:start-mo2-in-main',
  transferOpenMo2InMain: 'fluxora:transfer:open-mo2-in-main',
  transferMo2Handoff: 'fluxora:transfer:mo2-handoff',
  transferMo2Open: 'fluxora:transfer:mo2-open',
  updatesCheck: 'fluxora:updates:check',
  updatesCancel: 'fluxora:updates:cancel',
  updatesDownloadAndInstall: 'fluxora:updates:download-and-install',
  updatesGetStatus: 'fluxora:updates:get-status',
  updatesRendererReady: 'fluxora:updates:renderer-ready',
  updatesStatus: 'fluxora:updates:status',
  uiLog: 'fluxora:ui:log',
  windowClose: 'fluxora:window:close',
  windowMinimize: 'fluxora:window:minimize',
  windowOpenBuildSettings: 'fluxora:window:open-build-settings',
  windowOpenFilePreview: 'fluxora:window:open-file-preview',
  windowOpenModDetails: 'fluxora:window:open-mod-details',
  windowOpenSettings: 'fluxora:window:open-settings',
  windowOpenAiTextEditor: 'fluxora:window:open-ai-text-editor',
  windowOpenTextEditor: 'fluxora:window:open-text-editor',
  windowSetTaskbarProgress: 'fluxora:window:set-taskbar-progress',
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

export type FluxoraUpdateState =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'waitingForOperations'
  | 'readyToInstall'
  | 'launchingUpdater'
  | 'error';

export interface FluxoraUpdateError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface FluxoraUpdateStatus {
  state: FluxoraUpdateState;
  currentVersion: string;
  availableVersion?: string;
  assetKind?: 'delta' | 'full';
  downloadedBytes?: number;
  totalBytes?: number;
  progressPercent?: number;
  checkedAtUtc?: string;
  operationId?: string;
  error?: FluxoraUpdateError;
}

export interface FluxoraUpdateCancelResult {
  accepted: boolean;
  state: FluxoraUpdateState;
  operationId: string;
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

export interface PluginListRequest extends OperationRequest {
  forceDiscoveryRefresh?: boolean;
}

export interface NativeBridgeError {
  code: string;
  message: string;
  category: 'validation' | 'core' | 'capability' | 'notFound' | 'conflict' | 'cancelled' | 'transport' | 'internal';
  retryable: boolean;
  capabilityId?: string | null;
  details?: Record<string, unknown>;
}

export interface NativeBridgeInvokeError extends NativeBridgeError {
  schema: 'fluxora.tauri.bridge-error.v1';
  method: string;
  operationId: string;
}

export const FLUXORA_AI_PROVIDER_ID = 'gemini' as const;
export const FLUXORA_AI_MODEL_ID = 'gemini-3.1-flash-lite' as const;

export interface FluxoraAiChatError {
  code: string;
  category: string;
  stage:
    | 'session-start'
    | 'tool-schema'
    | 'transport'
    | 'provider'
    | 'tool-execution'
    | 'tool-loop'
    | 'context'
    | 'gateway'
    | 'verification';
  retryable: boolean;
  userMessage: string;
  debugId: string;
  details?: Record<string, unknown>;
}

export interface FluxoraAiProviderDescriptor {
  id: typeof FLUXORA_AI_PROVIDER_ID;
  displayName: string;
  kind: 'managed-or-byok';
  requiresCredential: boolean;
  credentialState: 'connected' | 'disconnected' | 'unknown';
  connected: boolean;
  defaultModelId: typeof FLUXORA_AI_MODEL_ID;
  dataDisclosure: string;
}

export interface FluxoraAiModelCapability {
  id: typeof FLUXORA_AI_MODEL_ID;
  providerId: typeof FLUXORA_AI_PROVIDER_ID;
  displayName: string;
  contextWindowTokens: number;
  inputTokenLimit: number;
  outputTokenLimit: number;
  limitSource: 'provider-metadata' | 'fluxora-fallback';
  supportsTools: true;
  supportsWeb: true;
  supportsStreaming: true;
}

export type FluxoraAiQuotaAvailability =
  | 'available'
  | 'connectionRequired'
  | 'premiumRequired'
  | 'quotaExhausted'
  | 'searchQuotaExhausted'
  | 'rateLimited'
  | 'temporaryServerError'
  | 'disabled'
  | 'byok';

export interface FluxoraAiQuotaSnapshot {
  schema: 'fluxora.ai.quota.v1';
  availability: FluxoraAiQuotaAvailability;
  available: boolean;
  eligibility: boolean;
  reason: string;
  periodStart: string | null;
  resetAt: string | null;
  rollover: false;
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  remainingInputTokenEquivalent: number;
  search: {
    limit: number;
    used: number;
    reserved: number;
    remaining: number;
  };
  model: typeof FLUXORA_AI_MODEL_ID;
  priceVersion: string | null;
}

export interface FluxoraAiHostStatus {
  ready: boolean;
  operationId: string;
  health: 'ready' | 'unavailable' | 'starting' | 'blocked';
  protocolVersion?: string;
  hostVersion?: string;
  hostPath?: string;
  processId?: number;
  providers: FluxoraAiProviderDescriptor[];
  models: FluxoraAiModelCapability[];
  capabilities: Record<string, unknown>;
  quota: FluxoraAiQuotaSnapshot;
  error?: (NativeBridgeError & Partial<FluxoraAiChatError>) | FluxoraAiChatError;
}

export interface FluxoraAiProviderConnectionResult {
  providerId: string;
  connected: boolean;
  state:
    | 'connected'
    | 'disconnected'
    | 'invalidProvider'
    | 'invalidCredential'
    | 'unknownProvider'
    | 'hostUnavailable'
    | 'credentialStoreUnavailable';
  message: string;
  operationId: string;
}

export interface FluxoraAiProviderTestResult {
  providerId: string;
  ok: boolean;
  state: 'ready' | 'missingCredential' | 'hostUnavailable' | 'invalidProvider' | 'blocked';
  message: string;
  operationId: string;
  hostRoundTrip: boolean;
  checkedAt: number;
  modelIds: string[];
}

export interface FluxoraAiCancelRunResult {
  operationId: string;
  status: 'accepted' | 'notFound';
  accepted: boolean;
  processId?: number | null;
}

export type FluxoraVoiceCompletionMode = 'draft' | 'send';
export type FluxoraVoiceLanguage = 'auto' | 'en' | 'ru' | 'de';
export type FluxoraVoiceBackend = 'vulkan' | 'cpu';

export interface FluxoraVoiceError {
  code: string;
  userMessage: string;
  stage: string;
  operationId: string;
  debugMessage?: string;
}

export interface FluxoraVoicePrepareRequest extends OperationRequest {}

export interface FluxoraVoiceStatus {
  operationId: string;
  ready: boolean;
  warmed: boolean;
  health: 'ready' | 'starting' | 'unavailable' | 'blocked';
  modelVersion: string;
  glossaryVersion: string;
  error?: FluxoraVoiceError | null;
}

export interface FluxoraVoiceTranscriptionRequest extends OperationRequest {
  sampleRateHz: 16000;
  channelCount: 1;
  durationMs: number;
  completionMode: FluxoraVoiceCompletionMode;
  language: FluxoraVoiceLanguage;
  contextHints?: string[];
}

export interface FluxoraVoiceTranscriptionResult {
  operationId: string;
  transcript: string;
  detectedLanguage: string | null;
  backend: FluxoraVoiceBackend;
  modelVersion: string;
  glossaryVersion: string;
  durationMs: number;
  processingTimeMs: number;
  noSpeech: boolean;
}

export type FluxoraAiChatRole = 'system' | 'user' | 'assistant';

export interface FluxoraAiChatMessage {
  role: FluxoraAiChatRole;
  text: string;
  createdAt?: string;
}

export type FluxoraAiIntermediateEventType =
  | 'progress'
  | 'note'
  | 'tool-started'
  | 'tool-completed'
  | 'tool-blocked'
  | 'recovery-started'
  | 'verification-completed'
  | 'site-visited'
  | 'error';

export type FluxoraAiIntermediateEventLevel = 'info' | 'warning' | 'error';

export interface FluxoraAiIntermediateEventPayload {
  kind: string;
  data?: Record<string, string | number | boolean | null | string[] | number[] | boolean[]>;
}

export interface FluxoraAiIntermediateEvent {
  schema: 'fluxora.ai.intermediate-event.v1';
  eventId: string;
  runId: string;
  operationId: string;
  seq: number;
  createdAt: string;
  type: FluxoraAiIntermediateEventType;
  level: FluxoraAiIntermediateEventLevel;
  visibility: 'user' | 'developer' | 'audit';
  stage: string;
  message: string;
  percent?: number;
  payload?: FluxoraAiIntermediateEventPayload;
}

export type FluxoraAiFileScope = 'build' | 'game' | 'downloads';

export interface FluxoraAiFileWorkspaceEnvelope {
  schema: 'fluxora.ai.file-workspace-envelope.v1';
  chatId: string;
  projectId: string;
  templateId: string;
  buildLabel: string;
  projectDirectory: string;
  game: string;
  profile: string;
  buildRevision?: string;
  fileTreeRevision?: string;
  counts: {
    mods: number;
    plugins: number;
    downloads: number;
  };
  dirtyFileRefs: string[];
}

export interface FluxoraAiFileDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FluxoraAiFileChange {
  fileRef: string;
  scope: FluxoraAiFileScope;
  ownerMod?: string;
  relativePath: string;
  status: 'applied' | 'created' | 'rolled-back' | 'conflict';
  hunks: FluxoraAiFileDiffHunk[];
  addedLines: number;
  removedLines: number;
  validation: string;
  verification: string;
  beforeVersion: string;
  afterVersion: string;
  rollbackState: 'available' | 'rolled-back' | 'conflict' | 'unavailable';
}

export interface FluxoraAiFileChangeSet {
  schema: 'fluxora.ai.file-change-set.v1';
  operationId: string;
  runId: string;
  chatId: string;
  files: FluxoraAiFileChange[];
  rollbackState: 'available' | 'rolled-back' | 'conflict' | 'unavailable';
  rollbackReason?: FluxoraAiFileRollbackReason;
  rollbackMode?: 'exact' | 'inverse-merge';
  preservedNewerChanges?: boolean;
}

export interface FluxoraAiFileReadRequest extends OperationRequest {
  chatId: string;
  fileRef: string;
  startLine?: number;
  maxLines?: number;
  maxBytes?: number;
  editorMode?: boolean;
}

export interface FluxoraAiFileReadResult {
  fileRef: string;
  scope: FluxoraAiFileScope;
  relativePath: string;
  content: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
  encoding: string;
  lineEnding: string;
  sha256: string;
  version: string;
}

export interface FluxoraAiFileSaveRequest extends OperationRequest {
  chatId: string;
  runId: string;
  fileRef: string;
  revision?: string;
  baseSha256: string;
  expectedText: string;
  replacementText: string;
  format: 'plain-text' | 'json' | 'jsonc' | 'ini' | 'exact-text';
}

export interface FluxoraAiFileRollbackResult {
  operationId: string;
  runId: string;
  state: 'available' | 'rolled-back' | 'conflict' | 'unavailable';
  files: FluxoraAiFileChange[];
  mode: 'exact' | 'inverse-merge';
  reason?: FluxoraAiFileRollbackReason;
  preservedNewerChanges: boolean;
}

export type FluxoraAiFileRollbackReason =
  | 'overlapping-edit'
  | 'checkpoint-expired'
  | 'checkpoint-corrupt'
  | 'encoding-changed'
  | 'path-changed'
  | 'created-file-modified';

export interface FluxoraAiFileRollbackState {
  runId: string;
  state: 'available' | 'rolled-back' | 'conflict' | 'unavailable';
  reason?: FluxoraAiFileRollbackReason;
}

export interface FluxoraAiChatRequest extends OperationRequest {
  runId: string;
  sessionId: string;
  messages: FluxoraAiChatMessage[];
  providerId?: typeof FLUXORA_AI_PROVIDER_ID;
  modelId?: typeof FLUXORA_AI_MODEL_ID;
  stream?: boolean;
  fileWorkspace?: FluxoraAiFileWorkspaceEnvelope;
  conversationSummary?: string | null;
  providerHistoryStartIndex?: number;
  activeGoal?: FluxoraAiGoalContext | null;
}

export type FluxoraAiContextUsagePrecision = 'exact' | 'estimated';
export type FluxoraAiContextUsageLevel =
  | 'normal'
  | 'moderate'
  | 'warning'
  | 'critical'
  | 'almost-full';
export type FluxoraAiContextUsageMode = 'full' | 'compressed';

export interface FluxoraAiContextUsage {
  schema: 'fluxora.ai.context-usage.v1' | 'fluxora.ai.context-usage.v2';
  operationId: string;
  providerId: typeof FLUXORA_AI_PROVIDER_ID;
  modelId: typeof FLUXORA_AI_MODEL_ID;
  contextWindowTokens: number;
  modelInputTokenLimit: number;
  modelOutputTokenLimit: number;
  currentContextTokens: number;
  currentContextPercent: number;
  precision: FluxoraAiContextUsagePrecision;
  level: FluxoraAiContextUsageLevel;
  mode: FluxoraAiContextUsageMode;
  includedSections: string[];
  autoCompressionApplied: boolean;
  actionRequired: boolean;
  countedAt: string;
}

export interface FluxoraAiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokensBeforeRequest: number;
  source: 'gemini-count-tokens' | 'gemini-usage-metadata' | 'chars-per-token-estimate';
}

export interface FluxoraAiCitation {
  id: string;
  title: string;
  url: string;
  capturedAt?: string;
  kind?: string;
  provider?: string;
  snippet?: string;
  trust?: 'untrusted-external-content' | 'local-context' | string;
}

export interface FluxoraAiChatStreamChunk {
  index: number;
  text: string;
}

export interface FluxoraAiFileToolDiagnostics {
  schema: 'fluxora.ai.file-tool-diagnostics.v2';
  taskKind: 'action' | 'answer';
  providerRouting: 'local-required' | 'local-auto' | 'web-search' | 'none';
  outcome: 'done' | 'blocked' | 'needs-input';
  validationRetries: number;
  duplicateCalls: number;
  stagedChanges: number;
  verifiedMutations: number;
  terminalReason?: string | null;
  toolCalls: number;
  toolRounds: number;
  metadataBytes: number;
  contentBytes: number;
  searches: number;
  emptyResults: number;
  candidateCount: number;
  providerBytes: number;
  redactionApplied: boolean;
  mutations: number;
  truncatedResponses: number;
  blockedReason?: string | null;
  nativeSessionPreopened: boolean;
  newEvidenceCount: number;
  stagnantResultCount: number;
  phaseTransitions: string[];
  mode?: FluxoraAiGoalMode;
  origin?: FluxoraAiGoalOrigin;
  allowedRisk?: 'read-only' | 'reversible' | 'irreversible-with-confirmation';
  continuedGoal?: boolean;
}

export type FluxoraAiGoalMode = 'answer' | 'inspect' | 'repair';
export type FluxoraAiGoalOrigin = 'explicit' | 'implicit' | 'continuation';

export interface FluxoraAiGoalContext {
  goalId: string;
  mode: FluxoraAiGoalMode;
  origin: FluxoraAiGoalOrigin;
  requestedOutcome: string;
  pendingQuestion?: string | null;
}

export type FluxoraAiExecutionDomain =
  | 'files'
  | 'mods'
  | 'plugins'
  | 'downloads'
  | 'installs'
  | 'profiles'
  | 'settings'
  | 'projects'
  | 'fluxpack'
  | 'general';

export interface FluxoraAiVerifiedEffect {
  tool: string;
  operationId: string;
  verification: string;
  compensationToken?: string;
  rollbackState?: 'available' | 'rolling-back' | 'rolled-back' | 'blocked';
}

export interface FluxoraAiCapabilityUndoResult {
  state: 'rolled-back';
  compensationToken: string;
  operationId: string;
  postconditionVerified: true;
}

export interface FluxoraAiExecution {
  goalId: string;
  kind: 'action' | 'answer';
  mode: FluxoraAiGoalMode;
  origin: FluxoraAiGoalOrigin;
  requestedOutcome: string;
  domain: FluxoraAiExecutionDomain;
  phase: 'discover' | 'inspect' | 'mutate' | 'verify' | 'report';
  state: 'running' | 'needs-input' | 'blocked' | 'completed';
  verifiedEffects: FluxoraAiVerifiedEffect[];
  pendingQuestion?: string | null;
  terminalReason?: string | null;
}

export interface FluxoraAiChatResponse {
  operationId: string;
  providerId: typeof FLUXORA_AI_PROVIDER_ID;
  modelId: typeof FLUXORA_AI_MODEL_ID;
  status: 'done' | 'blocked' | 'needs-input';
  text: string;
  streamChunks: FluxoraAiChatStreamChunk[];
  sources: FluxoraAiCitation[];
  contextUsage?: FluxoraAiContextUsage | null;
  tokenUsage?: FluxoraAiTokenUsage | null;
  conversationSummary?: string | null;
  providerHistoryStartIndex?: number;
  toolLoopTerminalReason?: string | null;
  toolCallsAllowed: boolean;
  fileChangeSet?: FluxoraAiFileChangeSet | null;
  fileToolDiagnostics?: FluxoraAiFileToolDiagnostics | null;
  execution?: FluxoraAiExecution | null;
  error?: FluxoraAiChatError | null;
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

export interface FluxoraExecutableDisplayMetadata {
  id?: string;
  displayName?: string;
  executableName?: string;
  role?: string;
  workingDirectoryKind?: string;
  isPrimary?: boolean;
  isLauncher?: boolean;
  isScriptExtender?: boolean;
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
  externalProviderGameSlugs?: Record<string, string[]>;
  contentLayoutSummary?: Record<string, unknown>;
  executableDisplayMetadata?: FluxoraExecutableDisplayMetadata[];
  launchTrackingMetadata?: unknown;
}

export interface FluxoraExecutable {
  id: string;
  displayName: string;
  executablePath: string;
  arguments: string;
  workingDirectory: string;
  iconPath: string;
  managedToolKind?: 'bodySlide' | 'texGen' | 'dynDoLod';
  executableDisplayMetadata?: FluxoraExecutableDisplayMetadata;
}

export interface FluxoraManagedOutputMod {
  id: string;
  displayName: string;
  folderName: string;
  path: string;
  provider: string;
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
  managedSessionId?: string;
  managedToolKind?: 'bodySlide' | 'texGen' | 'dynDoLod';
  outputMod?: FluxoraManagedOutputMod;
  configurationStatus?: 'configured' | 'recovered' | string;
  warnings?: string[];
}

export type FluxoraManagedLaunchOutcome =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'watcher-error';

export interface FluxoraManagedLaunchCompletion {
  sessionId: string;
  outcome: string;
  finalized: boolean;
  deferred: boolean;
  outputMod: FluxoraManagedOutputMod;
  warnings: string[];
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
  defaultProfile?: string;
  paths?: {
    gameDirectory?: string;
    modsDirectory?: string;
    profilesDirectory?: string;
    downloadsDirectory?: string;
    overwriteDirectory?: string;
  };
  gameCapabilities?: FluxoraGameCapabilities;
  externalProviderGameSlugs?: Record<string, string[]>;
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
  overwriteDirectory: string;
}

export interface FluxoraFluxPackSummary {
  outputPath: string;
  buildName: string;
  formatVersion: number;
  manifestBytes: number;
  sourceArchiveCount: number;
  bundledModCount: number;
  generatedAssetCount: number;
  customPatchCount: number;
  customConfigCount: number;
  installStepCount: number;
  generatedAssetsIncluded: boolean;
  installPlanAvailable: boolean;
  packageType: FluxoraFluxPackPackageType;
  compressionMode: FluxoraFluxPackCompressionMode | 'none';
  logicalPayloadBytes: number;
  uniquePayloadBytes: number;
  storedPayloadBytes: number;
  deduplicatedPayloadBytes: number;
  uniqueChunkCount: number;
  dictionaryCount: number;
  operationId: string;
}

export type FluxoraFluxPackCompressionMode = 'fast' | 'optimal' | 'smallest';
export type FluxoraFluxPackPackageType = 'full' | 'recipe';

export interface FluxoraFluxPackExportRequest {
  configPath: string;
  outputPath: string;
  includeGeneratedAssets: boolean;
  packageType: FluxoraFluxPackPackageType;
}

export interface FluxoraFluxPackInstallRequest {
  fluxPackPath: string;
  installRootDirectory: string;
  existingConfigPath?: string;
  manualSourceArchives?: FluxoraFluxPackManualSourceArchive[];
}

export interface FluxoraFluxPackManualSourceArchive {
  sourceId: string;
  path: string;
}

export interface FluxoraFluxPackInstallPlanRequest {
  fluxPackPath: string;
  existingConfigPath?: string;
}

export type FluxoraFluxPackAcquisitionMode =
  | 'installed'
  | 'cached-download'
  | 'source-build'
  | 'automatic'
  | 'manual'
  | 'unavailable';

export interface FluxoraFluxPackSourceInstallPlan {
  sourceId: string;
  providerId: string;
  providerDisplayName: string;
  displayName: string;
  version: string;
  archiveFileName: string;
  manualDownloadUrl: string;
  acquisitionMode: FluxoraFluxPackAcquisitionMode;
  requiresManualDownload: boolean;
  canAutomaticallyDownload: boolean;
}

export interface FluxoraFluxPackInstallPlan {
  summary: FluxoraFluxPackSummary;
  updatesExistingProject: boolean;
  reusableSourceCount: number;
  reusableDownloadCount: number;
  automaticDownloadCount: number;
  manualDownloadCount: number;
  sources: FluxoraFluxPackSourceInstallPlan[];
  operationId: string;
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
  reusedSourceCount: number;
  reusedDownloadCount: number;
  appliedConfigCount: number;
  appliedProfileOrderItemCount: number;
  reusedFileCount: number;
  materializedFileCount: number;
  updatedExistingProject: boolean;
  hasWarnings: boolean;
  operationId: string;
}

export interface FluxoraGrassCacheGenerationRequest {
  configPath: string;
  profileName?: string;
}

export interface FluxoraGrassCacheGenerationResult {
  accepted: boolean;
  outputModName: string;
  outputModPath: string;
  launchCount: number;
  generatedFileCount: number;
  failedFileCount: number;
  operationId: string;
}

export interface FluxoraInstalledMod {
  id: string;
  name: string;
  version: string;
  installedAt?: string;
  updatedAt?: string;
  latestVersion: string;
  latestFileId: string;
  updateCheckState: string;
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
  sourceProvider?: string;
  sourceGameDomain?: string;
  sourceModId?: string;
  sourceFileId?: string;
  sourceUrl?: string;
  isLocal: boolean;
  isTranslation: boolean;
  isPatch: boolean;
  overwritesModIds: string[];
  overwrittenByModIds: string[];
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

export interface FluxoraModWorkspaceSnapshot {
  installedMods: FluxoraInstalledMod[];
  modOrder: FluxoraModOrderItem[];
}

export interface FluxoraOrderPlacement {
  orderId: string;
  beforeOrderId?: string;
  afterOrderId?: string;
}

export interface FluxoraRevisionedOrderDelta<T> {
  baseRevision: string;
  revision: string;
  upserts: T[];
  removedOrderIds: string[];
  placements: FluxoraOrderPlacement[];
}

export interface FluxoraWorkspaceDelta {
  projectDirectory: string;
  profileName: string;
  operationId: string;
  sequence: number;
  mods: FluxoraRevisionedOrderDelta<FluxoraModOrderItem>;
  installedModUpserts: FluxoraInstalledModSummary[];
  removedInstalledModIds: string[];
  plugins: FluxoraRevisionedOrderDelta<FluxoraPluginOrderItem>;
  fullResyncRequired: boolean;
}

export interface FluxoraWorkspaceDeltaRequest extends OperationRequest {
  templateId?: string;
}

export interface FluxoraModFileCacheInvalidationResult {
  invalidated: boolean;
  changedPathCount: number;
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

export interface FluxoraModConflictTreePage {
  modPath: string;
  totalOverwrites: number;
  totalOverwritten: number;
  limit: number;
  nextCursor?: string | null;
  overwrites: FluxoraModFileTreeEntry[];
  overwritten: FluxoraModFileTreeEntry[];
}

export interface FluxoraModFileTreeDirectory {
  relativePath: string;
  entries: FluxoraModFileTreeEntry[];
}

export interface FluxoraModDetailsContent {
  modPath: string;
  directories: FluxoraModFileTreeDirectory[];
  conflictTree: FluxoraModConflictTreePage;
}

export type FluxoraEffectiveFileTreeSourceKind = 'game' | 'mod' | 'overwrite' | 'virtual';

export interface FluxoraEffectiveFileTreeEntry {
  name: string;
  relativePath: string;
  parentPath: string;
  isDirectory: boolean;
  hasChildren: boolean;
  size: number;
  virtualPath: string;
  sourceKind: FluxoraEffectiveFileTreeSourceKind;
  sourceName: string;
  sourcePath: string;
}

export interface FluxoraEffectiveFileTreeSnapshot {
  profileName: string;
  revision: string;
  totalFileCount: number;
  totalFileCountKnown?: boolean;
  entries: FluxoraEffectiveFileTreeEntry[];
}

export interface FluxoraEffectiveFileTreePage {
  profileName: string;
  revision: string;
  parentPath: string;
  totalFileCount: number;
  totalFileCountKnown?: boolean;
  totalChildCount: number;
  limit: number;
  nextCursor?: string | null;
  entries: FluxoraEffectiveFileTreeEntry[];
}

export interface FluxoraWorkspaceIndexWarmupResult {
  profileName: string;
  revision: string;
  totalFileCount: number;
  totalEntryCount: number;
  cacheHit: boolean;
}

export interface FluxoraModDetailsBootstrap {
  key: string;
  projectId: string;
  projectName: string;
  projectDirectory: string;
  configPath: string;
  profileName?: string;
  modPath: string;
  item: FluxoraModOrderItem;
  rootFileTree?: FluxoraModFileTreeEntry[];
  content?: FluxoraModDetailsContent;
  highlightRelativePath?: string;
  createdAt: number;
}

export interface FluxoraNifPreviewAssetHandle {
  assetId: string;
  size: number;
  mimeType: string;
  relativePath: string;
  source: string;
  contentKey: string;
}

export interface FluxoraNifPreviewVariant {
  variantId: string;
  modName: string;
  order: number;
  enabled: boolean;
  relativePath: string;
  size: number;
}

export interface FluxoraNifPreviewStartResult {
  sessionId: string;
  variants: FluxoraNifPreviewVariant[];
  activeIndex: number;
  modelHandle: FluxoraNifPreviewAssetHandle;
}

export interface FluxoraNifPreviewTextureBatchResult {
  assets: FluxoraNifPreviewAssetHandle[];
  missing: string[];
}

export interface FluxoraTextFileDocument {
  path: string;
  fileName: string;
  content: string;
  size: number;
  relativePath?: string;
  operationId: string;
}

export interface FluxoraTextFilePreview {
  path: string;
  fileName: string;
  contentPreview: string;
  bytesRead: number;
  size: number;
  truncated: boolean;
  relativePath?: string;
  operationId: string;
}

export interface FluxoraTextFileSaveResult {
  path: string;
  fileName: string;
  size: number;
  relativePath?: string;
  operationId: string;
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
  path?: string;
  isEnabled: boolean;
  isMaster: boolean;
  isLight: boolean;
  hasLightFlag: boolean;
  isLocked: boolean;
  lockReason: string;
  masterFiles?: string[];
  missingMasters: string[];
}

export interface FluxoraDownloadDuplicateFile {
  id: string;
  fileId: string;
  fileName: string;
  version: string;
}

export interface FluxoraDownloadDuplicateDecision {
  decisionId: string;
  direction: 'upgrade' | 'downgrade' | 'mixed' | 'same-file';
  incomingFile: FluxoraDownloadDuplicateFile;
  existingFiles: FluxoraDownloadDuplicateFile[];
}

export type FluxoraDownloadDuplicateChoice = 'replace' | 'keepBoth' | 'cancel';

export type FluxoraTaskbarProgressState =
  | { status: 'none' | 'indeterminate' }
  | { status: 'normal'; progress: number }
  | { status: 'paused' | 'error'; progress?: number };

export interface FluxoraDownloadEntry {
  id: string;
  name: string;
  fileName: string;
  localPath: string;
  source: string;
  archiveId: string | null;
  buildStatus: 'Ready' | 'Installing' | 'Installed' | 'Deleted' | 'Failed' | null;
  transferState:
    | 'idle'
    | 'queued'
    | 'awaiting-decision'
    | 'downloading'
    | 'paused'
    | 'canceled'
    | 'indexing'
    | 'failed';
  transferMessage: string;
  sizeText: string;
  createdAtText: string;
  progressPercent: number;
  progressText: string;
  etaText: string;
  downloadSpeedText: string;
  isDownloading: boolean;
  hasKnownProgress: boolean;
  hasResolvedFileName: boolean;
  canResume: boolean;
  canInstall: boolean;
  canDelete: boolean;
  duplicateDecision: FluxoraDownloadDuplicateDecision | null;
}

export interface FluxoraDownloadsChangedEvent {
  projectDirectory: string;
  operationId?: string;
  revision: string;
  sequence: number;
  upserts: FluxoraDownloadEntry[];
  removedIds: string[];
  placements: FluxoraOrderPlacement[];
  reason: string;
  fullResyncRequired: boolean;
}

export interface FluxoraDownloadsFolderWatchResult {
  accepted: boolean;
  operationId: string;
}

export interface FluxoraDownloadsFolderChange {
  path: string;
  fileName: string;
  kind: string;
}

export interface FluxoraDownloadsFolderChangedEvent {
  projectDirectory: string;
  downloadsDirectory: string;
  eventId: string;
  sequence: number;
  reason: string;
  changes: FluxoraDownloadsFolderChange[];
}

export interface FluxoraBuildContentWatchRequest {
  projectDirectory: string;
  modsDirectory: string;
  profilesDirectory: string;
  profileName?: string;
  gameDirectory?: string;
}

export interface FluxoraBuildContentWatchResult {
  accepted: boolean;
  operationId: string;
}

export interface FluxoraBuildContentChange {
  path: string;
  fileName: string;
  kind: string;
  area: string;
}

export interface FluxoraBuildContentChangedEvent {
  projectDirectory: string;
  modsDirectory: string;
  profilesDirectory: string;
  profileName: string;
  eventId: string;
  sequence: number;
  reason: string;
  changes: FluxoraBuildContentChange[];
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
  included: boolean;
}

export interface FluxoraContentLayoutFinding {
  severity: string;
  path: string;
  classification: string;
  message: string;
  blocksInstall: boolean;
}

export type FluxoraPlacementTarget = 'data' | 'gameRoot';

export interface FluxoraPlacementDirectory {
  target: FluxoraPlacementTarget;
  targetRelativePath: string;
}

export interface FluxoraContentLayoutAssessment {
  status: 'ready' | 'warning' | 'blocked';
  reasonCodes: string[];
}

export interface FluxoraContentLayoutPreview {
  gameId: string;
  gameDisplayName: string;
  rootFileWrapperDirectory: string;
  canInstall: boolean;
  summary: FluxoraContentLayoutPreviewSummary;
  entries: FluxoraContentLayoutPreviewEntry[];
  directories?: FluxoraPlacementDirectory[];
  validationFindings: FluxoraContentLayoutFinding[];
  explanationSummary: string;
  explanationDetails: string[];
  archiveContentFingerprint?: string;
  editFingerprint?: string;
  placementFingerprint?: string;
  assessment?: FluxoraContentLayoutAssessment;
}

export interface FluxoraPlacementOverride {
  sourcePath: string;
  target: string;
  targetRelativePath: string;
}

export interface FluxoraPlacementEditsV2 {
  schemaVersion: 2;
  files: FluxoraPlacementOverride[];
  directories: FluxoraPlacementDirectory[];
  excludedSourcePaths: string[];
}

export interface FluxoraFomodFileDependencyState {
  file: string;
  state?: 'Active' | 'Inactive' | 'Missing' | string;
  sourceKind?: string;
  sourceName?: string;
  exists: boolean;
}

export interface FluxoraFomodDetectedVersion {
  kind: string;
  displayName: string;
  version: string;
  known: boolean;
}

export interface FluxoraFomodProfileContext {
  contextId: string;
  profileName: string;
  fingerprint: string;
  modCatalogRevision: number;
  modRevision: string;
  pluginRevision: string;
  autoSelectionAvailable: boolean;
  unavailableReason: string;
  gameVersion: FluxoraFomodDetectedVersion;
  extenderVersions: FluxoraFomodDetectedVersion[];
  basePluginNames: string[];
  fileStates: FluxoraFomodFileDependencyState[];
}

export interface FluxoraFomodPluginHeader {
  outputFile: string;
  masters: string[];
  status: 'parsed' | 'corrupt' | 'oversize' | 'candidateLimit' | 'readBudgetExceeded';
  issueCode: string;
}

export type FluxoraFomodDecisionAction = 'select' | 'deselect' | 'manual' | 'locked';
export type FluxoraFomodDecisionConfidence = 'none' | 'weak' | 'strong' | 'exact';
export type FluxoraFomodDependencyResult = 'satisfied' | 'unsatisfied' | 'unknown';

export interface FluxoraFomodDecisionEvidence {
  code: string;
  subject: string;
  expected: string;
  actual: string;
  sourceKind: string;
  sourceName: string;
}

export interface FluxoraFomodOptionDecision {
  optionId: string;
  action: FluxoraFomodDecisionAction;
  confidence: FluxoraFomodDecisionConfidence;
  effectiveType: string;
  reasonCodes: string[];
  evidence: FluxoraFomodDecisionEvidence[];
}

export interface FluxoraFomodUnresolvedGroup {
  stepId: string;
  groupId: string;
  groupName: string;
  reasonCode: string;
  optionIds: string[];
}

export interface FluxoraFomodAutoSelection {
  contextId: string;
  initialSelectedOptionIds: string[];
  unresolvedGroups: FluxoraFomodUnresolvedGroup[];
  decisions: FluxoraFomodOptionDecision[];
  moduleDependencyResult: FluxoraFomodDependencyResult;
  installBlocked: boolean;
  cycleDetected: boolean;
  warnings: string[];
}

export interface FluxoraFomodManualDecision {
  optionId: string;
  selected: boolean;
}

export interface FluxoraAnalyzeFomodMethod {
  (
    projectDirectory: string,
    downloadPath: string,
    operation?: OperationRequest
  ): Promise<FluxoraFomodInstaller>;
  (
    projectDirectory: string,
    downloadPath: string,
    profileName: string,
    manualDecisions?: FluxoraFomodManualDecision[],
    operation?: OperationRequest
  ): Promise<FluxoraFomodInstaller>;
}

export interface FluxoraPlanInstallMethod {
  (
    projectDirectory: string,
    sourcePath: string,
    operation?: OperationRequest
  ): Promise<FluxoraInstallPlan>;
  (
    projectDirectory: string,
    sourcePath: string,
    profileName: string,
    operation?: OperationRequest
  ): Promise<FluxoraInstallPlan>;
  (
    projectDirectory: string,
    sourcePath: string,
    profileName: string,
    modName: string,
    operation?: OperationRequest
  ): Promise<FluxoraInstallPlan>;
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
  pluginHeaders?: FluxoraFomodPluginHeader[];
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
  structureFingerprint?: string;
  selectionOrigin?: 'restored' | 'recalculated';
  hasPreviousSelection: boolean;
  previousSelectionContextual?: boolean;
  previousSelectionWeak?: boolean;
  previousSelectedOptionIds: string[];
  previousDeselectedOptionIds?: string[];
  moduleDependencies?: FluxoraFomodDependency | null;
  fileDependencies: FluxoraFomodFileDependencyState[];
  requiredFiles: unknown[];
  steps: FluxoraFomodStep[];
  conditionalFilePatterns: unknown[];
  profileContext?: FluxoraFomodProfileContext | null;
  autoSelection?: FluxoraFomodAutoSelection | null;
}

export type FluxoraModIdentityResolutionKind = 'none' | 'exact' | 'probable';
export type FluxoraInstallIdentityDecision = 'use-match' | 'install-new';
export type FluxoraNewNamePolicy = 'first-free-copy-suffix';

export interface FluxoraInstallIdentityTarget {
  modUuid: string;
  displayName: string;
  folderName: string;
}

export interface FluxoraInstallPlan {
  suggestedModName: string;
  resolutionKind: FluxoraModIdentityResolutionKind;
  matchedTarget: FluxoraInstallIdentityTarget | null;
  resolutionId: string;
  fomodInstaller: FluxoraFomodInstaller;
  evidenceCodes: string[];
  score: number;
}

export interface FluxoraInstallIdentitySelection {
  resolutionId?: string;
  identityDecision?: FluxoraInstallIdentityDecision;
  targetModUuid?: string;
  newNamePolicy?: FluxoraNewNamePolicy;
}

export interface FluxoraAnalyzeContentLayoutRequest {
  projectDirectory: string;
  downloadPath: string;
  existingModMode?: FluxoraExistingModInstallMode;
  placementEdits?: FluxoraPlacementEditsV2;
}

export interface FluxoraAnalyzeFomodContentLayoutRequest extends FluxoraAnalyzeContentLayoutRequest {
  selectedOptionIds: string[];
  profileName?: string;
  fomodContextId?: string;
  manualDecisions?: FluxoraFomodManualDecision[];
}

export interface FluxoraInstallArchiveRequest extends FluxoraInstallIdentitySelection {
  projectDirectory: string;
  archivePath: string;
  modName: string;
  profileName: string;
  modOrderTargetIndex?: number;
  existingModMode?: FluxoraExistingModInstallMode;
  placementOverridesJson?: string;
}

export interface FluxoraInstallFomodArchiveRequest extends FluxoraInstallArchiveRequest {
  selectedOptionIds: string[];
  fomodContextId?: string;
  manualDecisions?: FluxoraFomodManualDecision[];
}

export interface FluxoraInstallDownloadRequest extends FluxoraInstallIdentitySelection {
  projectDirectory: string;
  downloadPath: string;
  modName: string;
  profileName: string;
  modOrderTargetIndex?: number;
  existingModMode?: FluxoraExistingModInstallMode;
  placementOverridesJson?: string;
}

export interface FluxoraInstallFomodDownloadRequest extends FluxoraInstallDownloadRequest {
  selectedOptionIds: string[];
  fomodContextId?: string;
  manualDecisions?: FluxoraFomodManualDecision[];
}

export interface FluxoraInstalledModSummary {
  id: string;
  name: string;
  version: string;
  isEnabled: boolean;
  latestVersion: string;
  latestFileId: string;
  updateCheckState: string;
  sourceIsNexus: boolean;
  sourceIsModdingFlow: boolean;
  sourceProvider?: string;
  sourceGameDomain?: string;
  sourceModId?: string;
  sourceFileId?: string;
  sourceUrl?: string;
  isLocal: boolean;
  isTranslation: boolean;
  isPatch: boolean;
  modUuid: string;
  orderId: string;
  fileCount: number;
  conflictingFileCount: number;
  overwrittenFileCount: number;
  overwritingFileCount: number;
  overwritesModIds: string[];
  overwrittenByModIds: string[];
  operationId: string;
}

export type FluxoraInstallOperationState =
  | 'queued'
  | 'validating'
  | 'extracting'
  | 'configuringFomod'
  | 'buildingStaging'
  | 'projectingConflicts'
  | 'waitingTarget'
  | 'committing'
  | 'finalizing'
  | 'recovering'
  | 'cancelled'
  | 'needsReview'
  | 'completed'
  | 'failed';

export interface FluxoraInstallOperationResult {
  id: string;
  name: string;
  version: string;
  isEnabled: boolean;
  latestVersion: string;
  latestFileId: string;
  updateCheckState: string;
  sourceIsNexus: boolean;
  sourceIsModdingFlow: boolean;
  sourceProvider?: string;
  sourceGameDomain?: string;
  sourceModId?: string;
  sourceFileId?: string;
  sourceUrl?: string;
  isLocal: boolean;
  isTranslation: boolean;
  isPatch: boolean;
  modUuid: string;
  orderId: string;
  fileCount: number;
  conflictingFileCount: number;
  overwrittenFileCount: number;
  overwritingFileCount: number;
  overwritesModIds: string[];
  overwrittenByModIds: string[];
}

export interface FluxoraInstallOperation {
  operationId: string;
  sourceKind: 'download' | 'archive';
  sourcePath: string;
  archiveFingerprint: string;
  profileName: string;
  existingModMode: FluxoraExistingModInstallMode;
  targetModUuid: string;
  targetFolder: string;
  selectedOptionIds: string[];
  manualDecisions: FluxoraFomodManualDecision[];
  placementOverridesJson: string;
  resume: {
    isFomod?: boolean;
    fomodContextId?: string;
    modOrderTargetIndex?: number;
  };
  beforeOrderId: string;
  afterOrderId: string;
  enqueueSequence: number;
  state: FluxoraInstallOperationState;
  stage: FluxoraInstallOperationState;
  progressPercent: number;
  indeterminate: boolean;
  errorCode: string;
  errorMessage: string;
  result: FluxoraInstallOperationResult | null;
  workspaceDelta?: FluxoraWorkspaceDelta | null;
}

export interface FluxoraInstallSubmitRequest extends FluxoraInstallIdentitySelection {
  operationId?: string;
  projectDirectory: string;
  sourceKind: 'download' | 'archive';
  sourcePath: string;
  isFomod?: boolean;
  modName: string;
  profileName: string;
  templateId?: string;
  workspaceRevision?: string;
  existingModMode?: FluxoraExistingModInstallMode;
  selectedOptionIds?: string[];
  placementOverridesJson?: string;
  fomodContextId?: string;
  manualDecisions?: FluxoraFomodManualDecision[];
  modOrderTargetIndex?: number;
  beforeOrderId?: string;
  afterOrderId?: string;
}

export interface FluxoraPendingInstallOrderAnchors {
  beforeOrderId?: string;
  afterOrderId?: string;
  fallbackTargetIndex: number;
  expectedRevision: number;
  applyIfCompleted: boolean;
}

export type FluxoraInstallConflictSnapshotState =
  | 'preparing'
  | 'ready'
  | 'committing'
  | 'completed'
  | 'failed';

export interface FluxoraInstallConflictRowPatch {
  orderId: string;
  modUuid: string;
  fileCount: number;
  conflictingFileCount: number;
  overwrittenFileCount: number;
  overwritingFileCount: number;
  overwritesModIds: string[];
  overwrittenByModIds: string[];
}

export interface FluxoraInstallConflictSnapshot {
  operationId: string;
  revision: number;
  state: FluxoraInstallConflictSnapshotState;
  pendingOrderId: string;
  orderId: string;
  targetIndex: number;
  rows: FluxoraInstallConflictRowPatch[];
}

export type FluxoraModUpdateCheckMode = 'automatic' | 'manual';
export type FluxoraModUpdateCheckState = 'completed' | 'skipped' | 'partial' | 'cancelled';
export type FluxoraModUpdateCheckReason =
  | 'none'
  | 'noEligibleMods'
  | 'dailyTtl'
  | 'authenticationUnavailable'
  | 'quotaReserve'
  | 'rateLimited'
  | 'offlineBackoff'
  | 'networkError'
  | 'cancelled'
  | 'ambiguousMetadata'
  | 'metadataUnavailable';

export interface FluxoraModUpdateCheckRequest {
  projectDirectory: string;
  mode: FluxoraModUpdateCheckMode;
}

export interface FluxoraModUpdateQuota {
  hourlyLimit: number;
  hourlyRemaining: number;
  hourlyResetAt: string;
  dailyLimit: number;
  dailyRemaining: number;
  dailyResetAt: string;
  capturedAt: string;
}

export interface FluxoraModUpdateCounters {
  apiRequests: number;
  cacheHits: number;
  checked: number;
  updates: number;
  ambiguous: number;
  failed: number;
}

export interface FluxoraModUpdateResultMod {
  folderName: string;
  latestVersion: string;
  latestFileId: string;
  updateCheckState: string;
  hasUpdate: boolean;
}

export interface FluxoraModUpdateCheckResult {
  state: FluxoraModUpdateCheckState;
  reason: FluxoraModUpdateCheckReason;
  nextEligibleAt: string;
  quota: FluxoraModUpdateQuota;
  counters: FluxoraModUpdateCounters;
  mods: FluxoraModUpdateResultMod[];
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

export interface FluxoraNxmInboundLinksCaptured {
  count: number;
  operationId: string;
  source: string;
}

export interface FluxoraModdingFlowActivation {
  v: 1;
  artifactId: string;
}

export type FluxoraModdingFlowActivationPreviewState =
  | 'available'
  | 'unknown'
  | 'deleted'
  | 'ineligible'
  | 'disconnected'
  | 'unsupportedGame'
  | 'unavailable';

export interface FluxoraModdingFlowActivationPreviewMetadata {
  mod: {
    id: string;
    name: string;
  };
  version: {
    id: string;
    label: string;
  };
  game: {
    id: string;
    name: string;
  };
  file: {
    name: string;
    sizeBytes: number | null;
  };
}

export interface FluxoraModdingFlowActivationPreview {
  artifactId: string;
  state: FluxoraModdingFlowActivationPreviewState;
  eligible: boolean | null;
  requiresAccount: boolean;
  metadata: FluxoraModdingFlowActivationPreviewMetadata | null;
  operationId: string;
}

export interface FluxoraModdingFlowActivationPreviewRequest {
  artifactId: string;
  operationId: string;
}

export interface FluxoraModdingFlowActivationAcceptRequest {
  artifactId: string;
  instanceId: string;
  profileName: string;
  confirmedPlanId: string;
  operationId: string;
}

export interface FluxoraModdingFlowActivationPlanPreviewRequest {
  artifactId: string;
  instanceId: string;
  profileName: string;
  operationId: string;
}

export interface FluxoraModdingFlowActivationPlanPreview {
  artifactId: string;
  planId: string;
  requiredDownloadCount: number;
  optionalDownloadCount: number;
  requiredDiskSizeBytes: number;
  conflictCount: number;
  operationId: string;
}

export interface FluxoraModdingFlowActivationDismissRequest {
  artifactId: string;
  operationId: string;
}

export interface FluxoraModdingFlowActivationDecisionResult {
  artifactId: string;
  state: 'accepted' | 'dismissed';
  operationId: string;
}

export interface FluxoraNexusModsAuthStatus {
  isConfigured: boolean;
  isLinked: boolean;
  hasApiKey: boolean;
  isPremium: boolean;
  displayName: string;
  userId: string;
  message: string;
  clientId: string;
  redirectUri: string;
  requiresReauth?: boolean;
  operationId: string;
}

export type FluxoraExternalConnectionState =
  | 'notConfigured'
  | 'notLinked'
  | 'connecting'
  | 'restoring'
  | 'ready'
  | 'temporarilyUnavailable'
  | 'reauthRequired';

export interface FluxoraExternalConnectionStatus {
  providerId: string;
  label: string;
  state: FluxoraExternalConnectionState;
  accountName: string;
  hasStoredSession: boolean;
  retryable: boolean;
  requiresUserAction: boolean;
  message: string;
  checkedAtUtc: string;
  operationId: string;
}

export interface FluxoraExternalConnectionSnapshot {
  providers: FluxoraExternalConnectionStatus[];
  requestedAtUtc: string;
  completedAtUtc: string;
  durationMs: number;
  timedOut: boolean;
  operationId: string;
}

export type FluxoraApiLimitProviderState =
  | 'available'
  | 'rate-limited'
  | 'unlinked'
  | 'unavailable'
  | 'not-provided';

export interface FluxoraApiRateLimitWindow {
  id: string;
  label: string;
  period: string;
  limit: number | null;
  remaining: number | null;
  resetAtUtc: string;
  resetRaw: string;
}

export interface FluxoraApiLimitProvider {
  id: string;
  label: string;
  state: FluxoraApiLimitProviderState;
  message: string;
  updatedAtUtc: string;
  windows: FluxoraApiRateLimitWindow[];
}

export interface FluxoraApiLimitStatus {
  generatedAtUtc: string;
  providers: FluxoraApiLimitProvider[];
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
  completed?: number;
  total?: number;
  totalSourceCount?: number;
  installedSourceCount?: number;
  pendingSourceCount?: number;
  failedSourceCount?: number;
  deletedBytes?: number;
  deletedEntries?: number;
  totalEntries?: number;
  providers?: FluxoraFluxPackProviderProgress[];
  installConflictSnapshot?: FluxoraInstallConflictSnapshot;
}

export type FluxoraOperationSnapshotState = 'running' | 'completed' | 'unknown';

export interface FluxoraOperationStatusSnapshot {
  operationId: string;
  state: FluxoraOperationSnapshotState;
  phase: string;
  currentStep: string;
  currentItem: string;
  overallPercent: number;
  statusMessage: string;
  updatedAt: string;
}

export interface FluxoraOperationsStatus {
  operationId: string;
  source: 'tauri-progress-cache' | 'browser-preview';
  active: FluxoraOperationStatusSnapshot[];
  recent: FluxoraOperationStatusSnapshot[];
  message: string;
}

export interface FluxoraRecentOperationLogsOptions {
  maxEntries?: number;
  operationIdFilter?: string;
}

export interface FluxoraOperationLogEntry {
  source: string;
  line: string;
  level?: FluxoraLogLevel;
  category?: string;
  operationId?: string;
  timestamp?: string;
}

export interface FluxoraRecentOperationLogs {
  operationId: string;
  entries: FluxoraOperationLogEntry[];
  logPaths: string[];
  maxEntries: number;
  truncated: boolean;
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

export type FluxoraFileDropPosition = {
  x: number;
  y: number;
};

export type FluxoraFileDropEvent =
  | {
      type: 'enter';
      paths: string[];
      position: FluxoraFileDropPosition;
    }
  | {
      type: 'over';
      position: FluxoraFileDropPosition;
    }
  | {
      type: 'drop';
      paths: string[];
      position: FluxoraFileDropPosition;
    }
  | {
      type: 'leave';
    };

export interface FluxoraApi {
  app: {
    getInfo: () => Promise<FluxoraAppInfo>;
  };
  updates: {
    getStatus: () => Promise<FluxoraUpdateStatus>;
    rendererReady: () => Promise<void>;
    check: (request?: OperationRequest) => Promise<FluxoraUpdateStatus>;
    downloadAndInstall: (request?: OperationRequest) => Promise<FluxoraUpdateStatus>;
    cancel: (request?: OperationRequest) => Promise<FluxoraUpdateCancelResult>;
    onStatus: (callback: (status: FluxoraUpdateStatus) => void) => () => void;
  };
  apiLimits: {
    list: (request?: OperationRequest) => Promise<FluxoraApiLimitStatus>;
  };
  connections: {
    listStatus: (request?: OperationRequest) => Promise<FluxoraExternalConnectionSnapshot>;
    restoreAll: (
      attempt?: number,
      request?: OperationRequest
    ) => Promise<FluxoraExternalConnectionSnapshot>;
    connect: (
      providerId: string,
      request?: OperationRequest
    ) => Promise<FluxoraExternalConnectionStatus>;
    cancelConnect: (
      providerId: string,
      request?: OperationRequest
    ) => Promise<FluxoraExternalConnectionStatus>;
    disconnect: (
      providerId: string,
      request?: OperationRequest
    ) => Promise<FluxoraExternalConnectionStatus>;
  };
  managerHandoff: {
    openDefaultAppSettings: () => Promise<void>;
  };
  ai: {
    armMicrophoneCapture: (request: OperationRequest) => Promise<void>;
    prepareVoice: (request: FluxoraVoicePrepareRequest) => Promise<FluxoraVoiceStatus>;
    resetMicrophonePermission: (request: OperationRequest) => Promise<void>;
    transcribeVoice: (
      pcm: Uint8Array,
      metadata: FluxoraVoiceTranscriptionRequest
    ) => Promise<FluxoraVoiceTranscriptionResult>;
    cancelVoiceTranscription: (operationId: string) => Promise<void>;
    openMicrophonePrivacySettings: () => Promise<void>;
    cancelRun: (
      operationId: string,
      request?: OperationRequest
    ) => Promise<FluxoraAiCancelRunResult>;
    chatRespond: (request: FluxoraAiChatRequest) => Promise<FluxoraAiChatResponse>;
    undoCapability: (
      compensationToken: string,
      request?: OperationRequest
    ) => Promise<FluxoraAiCapabilityUndoResult>;
    readFile: (request: FluxoraAiFileReadRequest) => Promise<FluxoraAiFileReadResult>;
    endFileChat: (chatId: string, request?: OperationRequest) => Promise<void>;
    saveFile: (request: FluxoraAiFileSaveRequest) => Promise<FluxoraAiFileChangeSet>;
    setFileDirty: (fileRef: string, dirty: boolean) => Promise<void>;
    rollbackFile: (
      chatId: string,
      runId: string,
      fileRef: string,
      request?: OperationRequest
    ) => Promise<FluxoraAiFileRollbackResult>;
    rollbackRun: (
      chatId: string,
      runId: string,
      request?: OperationRequest
    ) => Promise<FluxoraAiFileRollbackResult>;
    getFileRollbackStates: (
      chatId: string,
      operationId: string
    ) => Promise<FluxoraAiFileRollbackState[]>;
    resetFileRollbackCheckpoints: (operationId: string) => Promise<void>;
    estimateContext: (request: FluxoraAiChatRequest) => Promise<FluxoraAiContextUsage>;
    getStatus: (request?: OperationRequest) => Promise<FluxoraAiHostStatus>;
    restartHost: (request?: OperationRequest) => Promise<FluxoraAiHostStatus>;
    onRunEvent: (callback: (event: FluxoraAiIntermediateEvent) => void) => () => void;
    listProviders: (request?: OperationRequest) => Promise<FluxoraAiProviderDescriptor[]>;
    listModels: (request?: OperationRequest) => Promise<FluxoraAiModelCapability[]>;
    connectProvider: (
      providerId: string,
      apiKey: string,
      request?: OperationRequest
    ) => Promise<FluxoraAiProviderConnectionResult>;
    disconnectProvider: (
      providerId: string,
      request?: OperationRequest
    ) => Promise<FluxoraAiProviderConnectionResult>;
    testProvider: (
      providerId: string,
      request?: OperationRequest
    ) => Promise<FluxoraAiProviderTestResult>;
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
    pickTextFile: (initialDirectory?: string) => Promise<DialogPickResult>;
    saveFluxPack: (
      defaultPath?: string,
      title?: string
    ) => Promise<DialogSaveResult>;
    saveTextFile: (
      defaultPath?: string,
      title?: string
    ) => Promise<DialogSaveResult>;
  };
  fileDrop: {
    onDragDrop: (callback: (event: FluxoraFileDropEvent) => void) => Promise<() => void>;
  };
  build: {
    prepareWorkspaceIndexes: (
      projectDirectory: string,
      profileName?: string,
      request?: OperationRequest
    ) => Promise<FluxoraWorkspaceIndexWarmupResult>;
  };
  buildContent: {
    watch: (
      watchRequest: FluxoraBuildContentWatchRequest,
      request?: OperationRequest
    ) => Promise<FluxoraBuildContentWatchResult>;
    unwatch: (request?: OperationRequest) => Promise<FluxoraBuildContentWatchResult>;
    onChanged: (
      callback: (event: FluxoraBuildContentChangedEvent) => void
    ) => () => void;
  };
  links: {
    openExternal: (url: string) => Promise<OpenExternalResult>;
  };
  workspace: {
    getDelta: (
      projectDirectory: string,
      profileName: string | undefined,
      sinceRevision: string,
      request?: FluxoraWorkspaceDeltaRequest
    ) => Promise<FluxoraWorkspaceDelta>;
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
    getWorkspace: (
      projectDirectory: string,
      profileName?: string,
      request?: OperationRequest
    ) => Promise<FluxoraModWorkspaceSnapshot>;
    getPersistedWorkspace: (
      projectDirectory: string,
      profileName?: string,
      request?: OperationRequest
    ) => Promise<FluxoraModWorkspaceSnapshot>;
    invalidateFileCaches: (
      projectDirectory: string,
      changedPaths: string[],
      request?: OperationRequest
    ) => Promise<FluxoraModFileCacheInvalidationResult>;
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
    rebasePendingInstall: (
      projectDirectory: string,
      operationId: string,
      anchors: FluxoraPendingInstallOrderAnchors,
      request?: OperationRequest
    ) => Promise<FluxoraInstallConflictSnapshot>;
    deleteInstalled: (
      projectDirectory: string,
      modPath: string,
      request?: OperationRequest
    ) => Promise<FluxoraModMutationResult>;
    renameInstalled: (
      projectDirectory: string,
      modPath: string,
      newName: string,
      request?: OperationRequest
    ) => Promise<FluxoraInstalledMod>;
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
      updateRequest: FluxoraModUpdateCheckRequest,
      request?: OperationRequest
    ) => Promise<FluxoraModUpdateCheckResult>;
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
    getModDetailsContent: (
      projectDirectory: string,
      modPath: string,
      request?: OperationRequest
    ) => Promise<FluxoraModDetailsContent>;
    getModConflictTree: (
      projectDirectory: string,
      modPath: string,
      cursor?: string,
      limit?: number,
      request?: OperationRequest
    ) => Promise<FluxoraModConflictTreePage>;
    getModDetailsSummary: (
      projectDirectory: string,
      profileName: string | undefined,
      modPath: string,
      request?: OperationRequest
    ) => Promise<FluxoraModOrderItem>;
    getEffectiveFileTree: (
      projectDirectory: string,
      profileName?: string,
      request?: OperationRequest
    ) => Promise<FluxoraEffectiveFileTreeSnapshot>;
    getEffectiveFileTreeRoot: (
      projectDirectory: string,
      profileName?: string,
      limit?: number,
      request?: OperationRequest
    ) => Promise<FluxoraEffectiveFileTreePage>;
    getEffectiveFileTreeChildren: (
      projectDirectory: string,
      profileName: string | undefined,
      revision: string,
      relativeDirectory: string,
      cursor?: string,
      limit?: number,
      request?: OperationRequest
    ) => Promise<FluxoraEffectiveFileTreePage>;
    startNifPreview: (
      projectDirectory: string,
      profileName: string,
      initialModPath: string,
      relativePath: string,
      request?: OperationRequest
    ) => Promise<FluxoraNifPreviewStartResult>;
    prepareNifPreviewVariant: (
      sessionId: string,
      variantId: string
    ) => Promise<FluxoraNifPreviewAssetHandle>;
    prepareNifPreviewTextures: (
      sessionId: string,
      texturePaths: string[]
    ) => Promise<FluxoraNifPreviewTextureBatchResult>;
    readNifPreviewAssetBytes: (
      sessionId: string,
      assetId: string
    ) => Promise<ArrayBuffer>;
    endNifPreview: (sessionId: string) => Promise<void>;
    readTextFile: (
      projectDirectory: string,
      modPath: string,
      relativePath: string,
      request?: OperationRequest
    ) => Promise<FluxoraTextFileDocument>;
    previewTextFile: (
      projectDirectory: string,
      modPath: string,
      relativePath: string,
      maxBytes: number,
      request?: OperationRequest
    ) => Promise<FluxoraTextFilePreview>;
    saveTextFile: (
      projectDirectory: string,
      modPath: string,
      relativePath: string,
      content: string,
      request?: OperationRequest
    ) => Promise<FluxoraTextFileSaveResult>;
  };
  plugins: {
    list: (
      projectDirectory: string,
      templateId: string,
      profileName?: string,
      request?: PluginListRequest
    ) => Promise<FluxoraPluginOrderItem[]>;
    listPersisted: (
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
    previewTextFile: (
      projectDirectory: string,
      profileName: string,
      fileName: string,
      maxBytes: number,
      request?: OperationRequest
    ) => Promise<FluxoraTextFilePreview>;
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
    completeManagedLaunch: (
      sessionId: string,
      outcome: FluxoraManagedLaunchOutcome,
      request?: OperationRequest
    ) => Promise<FluxoraManagedLaunchCompletion>;
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
    toFomodPreviewImageUrl: (imagePath: string) => string;
    list: (
      projectDirectory: string,
      request?: OperationRequest
    ) => Promise<FluxoraDownloadEntry[]>;
    getDelta: (
      projectDirectory: string,
      sinceRevision: string,
      reason?: string,
      request?: OperationRequest
    ) => Promise<FluxoraDownloadsChangedEvent>;
    importFile: (
      projectDirectory: string,
      sourcePath: string,
      request?: OperationRequest
    ) => Promise<FluxoraDownloadEntry>;
    rename: (
      projectDirectory: string,
      downloadPath: string,
      newBaseName: string,
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
    resolveDuplicateDecision: (
      projectDirectory: string,
      downloadPath: string,
      decisionId: string,
      choice: FluxoraDownloadDuplicateChoice,
      request?: OperationRequest
    ) => Promise<FluxoraDownloadEntry | null>;
    watchFolder: (
      projectDirectory: string,
      downloadsDirectory: string,
      request?: OperationRequest
    ) => Promise<FluxoraDownloadsFolderWatchResult>;
    unwatchFolder: (
      request?: OperationRequest
    ) => Promise<FluxoraDownloadsFolderWatchResult>;
    onFolderChanged: (
      callback: (event: FluxoraDownloadsFolderChangedEvent) => void
    ) => () => void;
    onChanged: (
      callback: (event: FluxoraDownloadsChangedEvent) => void
    ) => () => void;
    analyzeContentLayout: (
      request: FluxoraAnalyzeContentLayoutRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraContentLayoutPreview>;
    analyzeFomod: FluxoraAnalyzeFomodMethod;
    planInstall: FluxoraPlanInstallMethod;
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
    planInstall: FluxoraPlanInstallMethod;
    install: (
      request: FluxoraInstallArchiveRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraInstalledModSummary>;
    installFomod: (
      request: FluxoraInstallFomodArchiveRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraInstalledModSummary>;
  };
  installs: {
    submit: (
      request: FluxoraInstallSubmitRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraInstallOperation>;
    cancel: (
      projectDirectory: string,
      operationId: string,
      operation?: OperationRequest
    ) => Promise<FluxoraInstallOperation>;
    restore: (
      projectDirectory: string,
      operation?: OperationRequest
    ) => Promise<FluxoraInstallOperation[]>;
    list: (
      projectDirectory: string,
      includeTerminal?: boolean,
      operation?: OperationRequest
    ) => Promise<FluxoraInstallOperation[]>;
    get: (
      projectDirectory: string,
      operationId: string,
      operation?: OperationRequest
    ) => Promise<FluxoraInstallOperation>;
    onProgress: (
      callback: (operation: FluxoraInstallOperation) => void
    ) => () => void;
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
    onInboundLinksCaptured: (
      callback: (event: FluxoraNxmInboundLinksCaptured) => void
    ) => () => void;
  };
  moddingFlowActivations: {
    consumePending: () => Promise<FluxoraModdingFlowActivation[]>;
    preview: (
      request: FluxoraModdingFlowActivationPreviewRequest
    ) => Promise<FluxoraModdingFlowActivationPreview>;
    previewPlan: (
      request: FluxoraModdingFlowActivationPlanPreviewRequest
    ) => Promise<FluxoraModdingFlowActivationPlanPreview>;
    accept: (
      request: FluxoraModdingFlowActivationAcceptRequest
    ) => Promise<FluxoraModdingFlowActivationDecisionResult>;
    dismiss: (
      request: FluxoraModdingFlowActivationDismissRequest
    ) => Promise<FluxoraModdingFlowActivationDecisionResult>;
    onCaptured: (
      callback: (activation: FluxoraModdingFlowActivation) => void
    ) => () => void;
  };
  nexus: {
    getAuthStatus: (request?: OperationRequest) => Promise<FluxoraNexusModsAuthStatus>;
    connect: (request?: OperationRequest) => Promise<FluxoraNexusModsAuthStatus>;
    connectWithApiKey: (
      apiKey: string,
      request?: OperationRequest
    ) => Promise<FluxoraNexusModsAuthStatus>;
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
  buildSettings: {
    notifyPathsSaved: (project: FluxoraProject) => Promise<void>;
    onPathsSaved: (callback: (project: FluxoraProject) => void) => () => void;
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
    planInstall: (
      request: FluxoraFluxPackInstallPlanRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraFluxPackInstallPlan>;
    install: (
      request: FluxoraFluxPackInstallRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraFluxPackInstallResult>;
  };
  grassCache: {
    generate: (
      request: FluxoraGrassCacheGenerationRequest,
      operation?: OperationRequest
    ) => Promise<FluxoraGrassCacheGenerationResult>;
  };
  operations: {
    cancel: (operationId: string, request?: OperationRequest) => Promise<FluxoraOperationCancelResult>;
    getStatus: (request?: OperationRequest) => Promise<FluxoraOperationsStatus>;
    recentLogs: (
      options?: FluxoraRecentOperationLogsOptions,
      request?: OperationRequest
    ) => Promise<FluxoraRecentOperationLogs>;
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
  clipboard: {
    writeText: (text: string) => Promise<void>;
  };
  templates: {
    list: (request?: OperationRequest) => Promise<FluxoraGameTemplate[]>;
    resolve: (
      templateId: string,
      request?: OperationRequest
    ) => Promise<FluxoraGameTemplate>;
  };
  textFiles: {
    read: (
      path: string,
      request?: OperationRequest
    ) => Promise<FluxoraTextFileDocument>;
    save: (
      path: string,
      content: string,
      request?: OperationRequest
    ) => Promise<FluxoraTextFileSaveResult>;
  };
  ui: {
    log: (entry: UiLogEntry) => Promise<void>;
  };
  windowControls: {
    close: () => Promise<void>;
    minimize: () => Promise<void>;
    openBuildSettings: (configPath: string, buildName: string) => Promise<void>;
    openFilePreview: (
      configPath: string,
      projectDirectory: string,
      modPath: string,
      relativePath: string,
      fileName: string,
      profileName: string,
      kind: string
    ) => Promise<void>;
    openModDetails: (
      configPath: string,
      modPath: string,
      modName: string,
      profileName?: string,
      bootstrapKey?: string,
      bootstrap?: FluxoraModDetailsBootstrap
    ) => Promise<void>;
    openSettings: () => Promise<void>;
    openAiTextEditor: (
      chatId: string,
      fileRef: string,
      fileName: string,
      firstChangedLine: number
    ) => Promise<void>;
    openTextEditor: (
      configPath: string,
      projectDirectory: string,
      modPath?: string,
      relativePath?: string,
      fileName?: string
    ) => Promise<void>;
    setTaskbarProgress: (state: FluxoraTaskbarProgressState) => Promise<void>;
    toggleMaximize: () => Promise<void>;
  };
}
