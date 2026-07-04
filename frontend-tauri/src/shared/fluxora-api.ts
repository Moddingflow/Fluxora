import type { AiSafeActionCatalog, AiSafeActionToolName } from './ai-safe-action-catalog';
import type {
  FluxoraAiCaseState,
  FluxoraAiDiagnosisJudge,
  FluxoraAiExternalInvestigation,
  FluxoraAiLocalInspection,
  FluxoraAiModResearchNexusApiStatus,
  FluxoraAiModResearchNexusQuotaState,
  FluxoraAiNexusInvestigation,
  FluxoraAiWebQueryPlan
} from './ai-mod-research-pipeline';
import type { FluxoraSkillCatalog, FluxoraSkillSelection } from './ai-skills';

export type {
  FluxoraAiCaseState,
  FluxoraAiDiagnosisJudge,
  FluxoraAiExternalInvestigation,
  FluxoraAiLocalInspection,
  FluxoraAiWebQueryPlan
} from './ai-mod-research-pipeline';
export type { FluxoraSkillCatalog, FluxoraSkillSelection } from './ai-skills';

export const FluxoraIpcChannels = {
  aiChatRespond: 'fluxora:ai:chat-respond',
  aiEstimateContext: 'fluxora:ai:estimate-context',
  aiConnectProvider: 'fluxora:ai:connect-provider',
  aiDisconnectProvider: 'fluxora:ai:disconnect-provider',
  aiGetStatus: 'fluxora:ai:get-status',
  aiListModels: 'fluxora:ai:list-models',
  aiListProviders: 'fluxora:ai:list-providers',
  aiRestartHost: 'fluxora:ai:restart-host',
  aiRunEvent: 'fluxora:ai:run-event',
  aiTestProvider: 'fluxora:ai:test-provider',
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
  dialogPickTextFile: 'fluxora:dialog:pick-text-file',
  dialogSaveFluxPack: 'fluxora:dialog:save-fluxpack',
  dialogSaveTextFile: 'fluxora:dialog:save-text-file',
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
  downloadsWatchFolder: 'fluxora:downloads:watch-folder',
  downloadsUnwatchFolder: 'fluxora:downloads:unwatch-folder',
  downloadsFolderChanged: 'fluxora:downloads:folder-changed',
  buildContentWatch: 'fluxora:build-content:watch',
  buildContentUnwatch: 'fluxora:build-content:unwatch',
  buildContentChanged: 'fluxora:build-content:changed',
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
  modsListPreviewVariants: 'fluxora:mods:list-preview-variants',
  modsListInstalled: 'fluxora:mods:list-installed',
  modsMoveOrderItem: 'fluxora:mods:move-order-item',
  modsPreviewTextFile: 'fluxora:mods:preview-text-file',
  modsReadPreviewAsset: 'fluxora:mods:read-preview-asset',
  modsReadTextFile: 'fluxora:mods:read-text-file',
  modsSaveTextFile: 'fluxora:mods:save-text-file',
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
  profilesPreviewTextFile: 'fluxora:profiles:preview-text-file',
  profilesRename: 'fluxora:profiles:rename',
  nxmCaptureLinks: 'fluxora:nxm:capture-links',
  nxmInboundLinksCaptured: 'fluxora:nxm:inbound-links-captured',
  nxmImportInboundDownloads: 'fluxora:nxm:import-inbound-downloads',
  nxmRegisterProtocol: 'fluxora:nxm:register-protocol',
  nexusConnect: 'fluxora:nexus:connect',
  nexusConnectWithApiKey: 'fluxora:nexus:connect-with-api-key',
  nexusDisconnect: 'fluxora:nexus:disconnect',
  nexusGetAuthStatus: 'fluxora:nexus:get-auth-status',
  operationsCancel: 'fluxora:operations:cancel',
  operationsGetStatus: 'fluxora:operations:get-status',
  operationsProgress: 'fluxora:operations:progress',
  operationsRecentLogs: 'fluxora:operations:recent-logs',
  archivesInstallFomod: 'fluxora:archives:install-fomod',
  archivesInstall: 'fluxora:archives:install',
  buildSettingsNotifyPathsSaved: 'fluxora:build-settings:notify-paths-saved',
  buildSettingsPathsSaved: 'fluxora:build-settings:paths-saved',
  fluxPackExport: 'fluxora:flux-pack:export',
  fluxPackInspect: 'fluxora:flux-pack:inspect',
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
  uiLog: 'fluxora:ui:log',
  windowClose: 'fluxora:window:close',
  windowMinimize: 'fluxora:window:minimize',
  windowOpenBuildSettings: 'fluxora:window:open-build-settings',
  windowOpenFilePreview: 'fluxora:window:open-file-preview',
  windowOpenModDetails: 'fluxora:window:open-mod-details',
  windowOpenSettings: 'fluxora:window:open-settings',
  windowOpenTextEditor: 'fluxora:window:open-text-editor',
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

export type FluxoraAiProviderKind = 'byok' | 'hosted' | 'local';

export type FluxoraAiCredentialState =
  | 'connected'
  | 'disconnected'
  | 'notRequired'
  | 'credentialStoreUnavailable'
  | 'unknown';

export interface FluxoraAiProviderDescriptor {
  id: string;
  displayName: string;
  kind: FluxoraAiProviderKind;
  requiresCredential: boolean;
  credentialStore: 'os' | 'os-or-supabase' | 'none';
  credentialState: FluxoraAiCredentialState;
  connected: boolean;
  defaultModelId: string;
  supportedRunModes: string[];
  networkAdapters: 'phase-4' | 'available' | 'disabled';
  dataDisclosure: string;
}

export interface FluxoraAiModelPriceMetadata {
  currency: string;
  inputPerMillionTokens: number | null;
  outputPerMillionTokens: number | null;
  cacheReadPerMillionTokens: number | null;
  cacheWritePerMillionTokens: number | null;
  source: string;
  isEstimated: boolean;
  remoteConfigurable: boolean;
}

export interface FluxoraAiModelCapability {
  id: string;
  providerId: string;
  displayName: string;
  contextWindowTokens: number;
  supportsTools: boolean;
  supportsWeb: boolean;
  supportsStreaming: boolean;
  supportsBackground: boolean;
  priceMetadata: FluxoraAiModelPriceMetadata;
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
  error?: NativeBridgeError;
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

export type FluxoraAiChatRole = 'system' | 'user' | 'assistant';

export type FluxoraAiRoutingPreset =
  | 'free-demo'
  | 'paid-economy'
  | 'paid-large-job'
  | 'byok';

export type FluxoraAiBudgetTier = 'free' | 'paid' | 'byok';

export type FluxoraAiRunSize = 'ordinary' | 'long-running';

export type FluxoraAiIntermediateEventType =
  | 'progress'
  | 'note'
  | 'tool-started'
  | 'tool-completed'
  | 'site-visited'
  | 'error'
  | 'heartbeat';

export type FluxoraAiIntermediateEventLevel = 'info' | 'warning' | 'error';

export type FluxoraAiIntermediateEventVisibility = 'user' | 'developer' | 'audit';

export type FluxoraAiIntermediateEventPayloadValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | boolean[];

export interface FluxoraAiIntermediateEventPayload {
  kind: string;
  data?: Record<string, FluxoraAiIntermediateEventPayloadValue>;
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
  visibility: FluxoraAiIntermediateEventVisibility;
  stage: string;
  message: string;
  percent?: number;
  payload?: FluxoraAiIntermediateEventPayload;
}

export type FluxoraAiBudgetDecision =
  | 'allowed'
  | 'needs-expensive-run-approval'
  | 'blocked';

export type FluxoraAiPromptCacheStatus = 'hit' | 'write' | 'disabled';

export interface FluxoraAiChatMessage {
  role: FluxoraAiChatRole;
  text: string;
  createdAt?: string;
}

export interface FluxoraAiResearchRequest {
  enabled: boolean;
  mode: 'nexus-api-first';
  allowAuthenticatedPages: false;
  allowBrowserSandbox: false;
  allowGeminiGoogleSearch: boolean;
  allowPublicWebFetch: boolean;
  deepResearchApproved: false;
  auditScope?: 'targeted' | 'batch-requirements' | 'full-build-requirements';
  maxNexusTargets?: number;
  maxNexusInitialTargets?: number;
  maxNexusApiRequests?: number;
}

export type FluxoraAiModResearchRouteKind =
  | 'no-web/local-only'
  | 'missing-local-fields'
  | 'nexus-api'
  | 'nexus-api-with-search';

export interface FluxoraAiModResearchSearchBudget {
  auditScope?: 'targeted' | 'batch-requirements' | 'full-build-requirements';
  maxExternalSources: number;
  maxSearchQueries: number;
  nexusApiRequests: number;
  maxNexusTargets?: number;
  maxNexusInitialTargets?: number;
  maxNexusApiRequests?: number;
  publicWebFetches: number;
  geminiGoogleSearch: boolean;
  coverageMode?: 'targeted-official-api' | 'bounded-official-api-batch';
  reason: string;
}

export interface FluxoraAiModResearchRoute {
  schema: 'fluxora.ai.mod-research-route.v1';
  generatedAt: string;
  operationId: string;
  route: FluxoraAiModResearchRouteKind;
  localFirst: true;
  externalResearchAllowed: boolean;
  nexusAllowed: boolean;
  publicWebAllowed: boolean;
  geminiGoogleSearchAllowed: boolean;
  auditScope?: 'targeted' | 'batch-requirements' | 'full-build-requirements';
  highSignalIssues: string[];
  missingFields: string[];
  reasons: string[];
  searchBudget?: FluxoraAiModResearchSearchBudget;
}

export interface FluxoraAiChatRequest extends OperationRequest {
  runId: string;
  sessionId: string;
  messages: FluxoraAiChatMessage[];
  costPolicy?: {
    currentMonthSpentCredits?: number;
    expensiveRunApproved?: boolean;
  };
  modelId?: string;
  providerId?: string;
  research?: FluxoraAiResearchRequest;
  routingPreset?: FluxoraAiRoutingPreset;
  stream?: boolean;
}

export type FluxoraAiContextUsagePrecision = 'exact' | 'estimated';

export type FluxoraAiContextUsageLevel =
  | 'normal'
  | 'moderate'
  | 'warning'
  | 'critical'
  | 'almost-full';

export type FluxoraAiContextUsageMode = 'full' | 'smart' | 'compressed' | 'strict';

export interface FluxoraAiContextUsage {
  schema: 'fluxora.ai.context-usage.v1';
  operationId: string;
  providerId: string;
  modelId: string;
  contextWindowTokens: number;
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

export interface FluxoraAiCostEstimate {
  currency: string;
  actualInternalCost: number | null;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  displayCost: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
  actualCost: number | null;
  hardCost: number;
  internalCost: number;
  promptCache: {
    key: string;
    status: FluxoraAiPromptCacheStatus;
    rawPromptStored: false;
  };
  pricingSource: string;
  riskBuffer: number;
  isEstimate: boolean;
  usageBreakdown: FluxoraAiCostUsageBreakdown;
}

export interface FluxoraAiCostUsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearchCalls: number;
  fetchUrlCalls: number;
  sandboxMinutes: number;
  providerRiskBuffer: number;
  mainInputTokens?: number;
  mainOutputTokens?: number;
  orchestrationInputTokens?: number;
  orchestrationOutputTokens?: number;
  orchestrationEstimatedCost?: number;
  orchestrationInternalCost?: number;
  orchestrationRiskBuffer?: number;
  orchestrationWebSearchCalls?: number;
}

export interface FluxoraAiCostLedgerEntry {
  operationId: string;
  providerId: string;
  modelId: string;
  routingPreset: FluxoraAiRoutingPreset;
  chargesFluxoraBudget: boolean;
  creditDebit: number;
  estimatedInternalCost: number;
  actualInternalCost: number | null;
  currency: string;
  billable: boolean;
  costPreflightDecision: FluxoraAiBudgetDecision;
  createdAt: string;
  pricingVersion: string;
  promptCacheKey: string;
  usageBreakdown: FluxoraAiCostUsageBreakdown;
}

export interface FluxoraAiRoutingDecision {
  schema: 'fluxora.ai.routing-decision.v1';
  generatedAt: string;
  operationId: string;
  routingPreset: FluxoraAiRoutingPreset;
  runSize: FluxoraAiRunSize;
  cheapClassifierFirst: true;
  candidateModelIds: string[];
  selectedModelId: string;
  selectedProviderId: string;
  selectedModelClass: 'local' | 'cheap-worker' | 'compact-planner' | 'web' | 'byok';
  premiumRequiresByok: true;
  webModelOnlyWhenNeeded: true;
  localModelPreferredWhenPossible: true;
  reasons: string[];
}

export interface FluxoraAiModelAgentResult {
  agentId: string;
  durationMs: number;
  error?: {
    message: string;
    statusCode?: number | null;
  } | null;
  label: string;
  modelId: string;
  providerId: string;
  status: 'completed' | 'blocked';
  text: string;
}

export interface FluxoraAiMultiModelOrchestration {
  schema: 'fluxora.ai.multi-model-orchestration.v1';
  generatedAt: string;
  operationId: string;
  mode: 'chef-first';
  strategy: string;
  chef: {
    agentId: string;
    label: string;
    providerId: string;
    modelId: string;
    status: 'dispatch-completed' | 'final-completed' | string;
    durationMs: number;
    finalDurationMs?: number;
    dispatchPlan: string;
  };
  subagents: FluxoraAiModelAgentResult[];
  completedSubagentCount: number;
  policy: {
    finalAnswerByChef: true;
    subagentOutputTrustedAsInstructions: false;
    requiresGroundedFacts: true;
    mutationsAllowed: false;
    askUserOnlyIfBlocked: true;
  };
}

export interface FluxoraAiCreditWalletPolicy {
  tier: FluxoraAiBudgetTier;
  currency: 'AI credits';
  freeDemoWalletCredits: number;
  monthlyWalletCredits: number;
  remainingMonthlyCredits: number;
  webResearchSubBudgetCredits: number;
  longJobPreflightBudgetCredits: number;
  safePromptMaxMonthlyPercent: number;
  safePromptThresholdCredits: number;
  byokChargesFluxoraBudget: false;
}

export interface FluxoraAiCostPreflight {
  schema: 'fluxora.ai.cost-preflight.v1';
  generatedAt: string;
  operationId: string;
  routingPreset: FluxoraAiRoutingPreset;
  runSize: FluxoraAiRunSize;
  required: boolean;
  decision: FluxoraAiBudgetDecision;
  estimatedRunCredits: number;
  estimatedMonthlyBudgetPercent: number;
  expensiveRunApprovalRequired: boolean;
  wallet: FluxoraAiCreditWalletPolicy;
  fallbackChoices: Array<'economy' | 'full' | 'byok'>;
  appliedOptimizations: string[];
  blockReason?: 'monthly-wallet-exceeded' | 'free-tier-long-job' | 'ordinary-safe-percent';
}

export interface FluxoraAiCostPipelinePolicy {
  schema: 'fluxora.ai.cost-pipeline.v1';
  generatedAt: string;
  operationId: string;
  classifyCheaply: true;
  retrieveThroughContextGraph: true;
  nexusApiCacheFirst: true;
  compactContextBeforeStrongModel: true;
  useCheapVerification: true;
  structuredFinalReport: true;
  promptCaching: true;
  conversationCompaction: true;
  deduplicateWebSources: true;
  nexusMetadataCache: {
    ttlMs: number;
    storesRateLimitHeaders: true;
  };
  batchCheapChecks: true;
  stopConditionsForLowValueLoops: true;
}

export interface FluxoraAiMarginTelemetry {
  schema: 'fluxora.ai.margin-telemetry.v1';
  generatedAt: string;
  operationId: string;
  metricName: 'gross_margin_after_ai_cost';
  userTier: FluxoraAiBudgetTier;
  grossRevenueEur: number;
  estimatedVatPaymentInfrastructureReserveEur: number;
  aiProviderCost: number;
  webSearchCost: number;
  marginAfterAiCostEur: number;
  grossMarginAfterAiCost: number;
  heavyUserDetected: boolean;
  localEstimateOnly: true;
}

export type FluxoraAiContextNodeKind =
  | 'Build'
  | 'Profile'
  | 'Mod'
  | 'Plugin'
  | 'Archive'
  | 'Download'
  | 'NexusMod'
  | 'File'
  | 'Conflict'
  | 'Operation'
  | 'LogEvent'
  | 'Skill'
  | 'Source';

export interface FluxoraAiContextSource {
  id: string;
  kind: string;
  title: string;
  fingerprint: string;
  capturedAt: string;
  stale: boolean;
  staleReason?: string | null;
}

export interface FluxoraAiContextNode {
  id: string;
  kind: FluxoraAiContextNodeKind;
  label: string;
  summary: string;
  sourceIds: string[];
  tokenEstimate: number;
}

export interface FluxoraAiContextTrace {
  nodeIds: string[];
  sourceIds: string[];
  staleSourceIds: string[];
  fingerprints: Array<{
    sourceId: string;
    fingerprint: string;
  }>;
  why: string;
}

export interface FluxoraAiContextBundle {
  schema: 'fluxora.ai.context-graph.v1';
  generatedAt: string;
  operationId: string;
  query: string;
  tokenBudget: number;
  tokenEstimate: number;
  storage: {
    engine: 'sqlite';
    fts: 'fts5';
    embeddings: 'optional-disabled' | 'available';
  };
  nodeKinds: FluxoraAiContextNodeKind[];
  retrievalPolicy: Array<Record<string, unknown>>;
  sourceIds: string[];
  sources: FluxoraAiContextSource[];
  nodes: FluxoraAiContextNode[];
  trace: FluxoraAiContextTrace;
}

export interface FluxoraAiResearchSnapshot {
  id: string;
  kind: string;
  title: string;
  url: string;
  capturedAt: string;
  status: 'captured' | 'blocked';
  summary?: string;
  reason?: string;
  httpStatus?: number;
  rateLimit?: Record<string, string | null>;
  credentialSource?: string;
  cache?: Record<string, unknown>;
  relatedTargets?: Array<Record<string, unknown>>;
  trust: 'untrusted-external-content';
  instructionsAllowed: false;
  promptInjectionFilter?: Record<string, unknown>;
}

export interface FluxoraAiResearchReport {
  schema: 'fluxora.ai.research.v1';
  generatedAt: string;
  operationId: string;
  permissionClass: 'external-network';
  mode: 'nexus-api-first';
  policy: Record<string, unknown>;
  targets: Array<Record<string, unknown>>;
  apiAvailability?: FluxoraAiModResearchNexusApiStatus;
  apiQuotaState?: FluxoraAiModResearchNexusQuotaState;
  nexusInvestigation?: FluxoraAiNexusInvestigation;
  webQueryPlan?: FluxoraAiWebQueryPlan;
  nextBestNonNexusQueries?: string[];
  snapshots: FluxoraAiResearchSnapshot[];
  sources: FluxoraAiCitation[];
  issues: Array<Record<string, unknown>>;
}

export type FluxoraAiTaskPermissionClass =
  | 'read'
  | 'plan'
  | 'write'
  | 'destructive'
  | 'external-network'
  | 'credential';

export type FluxoraAiTaskStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'needs-approval'
  | 'blocked';

export interface FluxoraAiTaskPlanStep {
  id: string;
  title: string;
  agentId: string;
  permissionClass: FluxoraAiTaskPermissionClass;
  status: FluxoraAiTaskStepStatus;
  requiresApproval: boolean;
  canRunInParallel: boolean;
  summary: string;
  dependsOn?: string[];
  toolName?: string;
}

export interface FluxoraAiProposedMutation {
  id: string;
  title: string;
  permissionClass: 'write' | 'destructive';
  requiresApproval: true;
  approvalMode: 'plan' | 'step-by-step';
  queued: true;
  executorQueueId: 'ai-write-executor';
  hidden: false;
  summary: string;
  rollbackNote: string;
  targetSummary?: string;
  toolName?: AiSafeActionToolName;
}

export interface FluxoraAiPlanReview {
  agentId: 'plan-review';
  status: 'ready' | 'needs-approval' | 'blocked';
  summary: string;
}

export interface FluxoraAiTaskPlan {
  schema: 'fluxora.ai.task-plan.v1';
  generatedAt: string;
  operationId: string;
  selectedSkill?: FluxoraSkillSelection | null;
  goal: string;
  assumptions: string[];
  readSteps: FluxoraAiTaskPlanStep[];
  proposedMutations: FluxoraAiProposedMutation[];
  validationSteps: FluxoraAiTaskPlanStep[];
  rollbackPlan: string[];
  expectedRisks: string[];
  review: FluxoraAiPlanReview;
  askUserOnlyIfBlocked: true;
  finalResponsePolicy: 'after-verification-or-clear-blocked-state';
}

export interface FluxoraAiSubagentDescriptor {
  id: string;
  role: string;
  label: string;
  permissionClass: FluxoraAiTaskPermissionClass;
  status: FluxoraAiTaskStepStatus;
  canRunInParallel: boolean;
  summary: string;
  dependsOn?: string[];
}

export interface FluxoraAiExecutorQueuePolicy {
  id: 'ai-write-executor';
  writeActionsOnlyThroughQueue: true;
  maxConcurrentMutations: 1;
  operationLock: 'per-build';
  hiddenDestructiveActions: false;
  destructiveApprovalMode: 'step-by-step';
}

export interface FluxoraAiLongRunningProgressPolicy {
  userVisibleStages: true;
  streamInternalProgress: true;
  finalAnswerAfterVerificationOrBlocked: true;
}

export interface FluxoraAiSubagentSchedule {
  schema: 'fluxora.ai.subagent-schedule.v1';
  generatedAt: string;
  operationId: string;
  defaultSubagentLimit: 3;
  maxSubagentsForLargeTasks: 10;
  requestedSubagentCount: number;
  scheduledSubagents: FluxoraAiSubagentDescriptor[];
  executorQueue: FluxoraAiExecutorQueuePolicy;
  planReviewAgent: FluxoraAiSubagentDescriptor;
  askUserOnlyIfBlocked: true;
  longRunningProgress: FluxoraAiLongRunningProgressPolicy;
}

export type FluxoraAiAutonomousJobState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'blocked';

export type FluxoraAiAutonomousJobBlockedReason =
  | 'user'
  | 'login'
  | 'captcha'
  | 'missing-file'
  | 'permission'
  | 'budget';

export type FluxoraAiAutonomousJobBackgroundMode =
  | 'local-resumable'
  | 'provider-background';

export interface FluxoraAiAutonomousJobCheckpoint {
  id: string;
  createdAt: string;
  status: 'completed' | 'blocked' | 'recovered';
  title: string;
  summary: string;
}

export interface FluxoraAiAutonomousJobProgressEvent {
  id: string;
  createdAt: string;
  stage: string;
  message: string;
  percent: number;
  internal: boolean;
  canonicalEvent?: FluxoraAiIntermediateEvent;
}

export interface FluxoraAiAutonomousJobHeartbeat {
  sequence: number;
  sentAt: string;
  deadlineAt: string;
  missed: boolean;
}

export interface FluxoraAiAutonomousJobWatchdog {
  heartbeatIntervalMs: number;
  staleAfterMs: number;
  missedHeartbeats: number;
  lastCheckedAt: string;
}

export interface FluxoraAiAutonomousJobPolicy {
  checkpointAfterEveryMajorStep: true;
  cancellationSupported: true;
  pauseSupported: true;
  streamInternalProgress: true;
  blockOnlyForAllowedReasons: true;
  allowedBlockedReasons: FluxoraAiAutonomousJobBlockedReason[];
  finalReportAfterVerification: true;
}

export interface FluxoraAiAutonomousJob {
  schema: 'fluxora.ai.autonomous-job.v1';
  id: string;
  sessionId: string;
  scopeKey: string;
  buildLabel: string;
  runId: string;
  operationId: string;
  goal: string;
  state: FluxoraAiAutonomousJobState;
  createdAt: string;
  updatedAt: string;
  modelId?: string;
  providerId?: string;
  backgroundMode: FluxoraAiAutonomousJobBackgroundMode;
  providerBackgroundMode: 'available' | 'unavailable';
  currentStage: string;
  percent: number;
  heartbeat: FluxoraAiAutonomousJobHeartbeat;
  watchdog: FluxoraAiAutonomousJobWatchdog;
  checkpoints: FluxoraAiAutonomousJobCheckpoint[];
  progressEvents: FluxoraAiAutonomousJobProgressEvent[];
  pauseRequested: boolean;
  cancellationRequested: boolean;
  blockedReason?: FluxoraAiAutonomousJobBlockedReason;
  blockedMessage?: string;
  finalReport?: string;
  taskPlan: FluxoraAiTaskPlan;
  subagentSchedule: FluxoraAiSubagentSchedule;
  policy: FluxoraAiAutonomousJobPolicy;
}

export interface FluxoraAiAutonomousJobQueue {
  schema: 'fluxora.ai.autonomous-job-queue.v1';
  scopeKey: string;
  updatedAt: string;
  jobs: FluxoraAiAutonomousJob[];
}

export interface FluxoraAiChatStreamChunk {
  index: number;
  text: string;
}

export interface FluxoraAiChatResponse {
  operationId: string;
  providerId: string;
  modelId: string;
  routingPreset: FluxoraAiRoutingPreset;
  status: 'done' | 'blocked' | 'needs-approval';
  text: string;
  streamChunks: FluxoraAiChatStreamChunk[];
  sources: FluxoraAiCitation[];
  costEstimate: FluxoraAiCostEstimate;
  costPipeline: FluxoraAiCostPipelinePolicy;
  costPreflight: FluxoraAiCostPreflight;
  ledgerEntry: FluxoraAiCostLedgerEntry;
  marginTelemetry: FluxoraAiMarginTelemetry;
  routingDecision: FluxoraAiRoutingDecision;
  contextUsage?: FluxoraAiContextUsage | null;
  tokenUsage?: FluxoraAiTokenUsage | null;
  modResearchRoute?: FluxoraAiModResearchRoute | null;
  localInspection?: FluxoraAiLocalInspection | null;
  nexusInvestigation?: FluxoraAiNexusInvestigation | null;
  externalInvestigation?: FluxoraAiExternalInvestigation | null;
  diagnosisJudge?: FluxoraAiDiagnosisJudge | null;
  caseState?: FluxoraAiCaseState | null;
  orchestration?: FluxoraAiMultiModelOrchestration | null;
  contextBundle?: FluxoraAiContextBundle | null;
  researchReport?: FluxoraAiResearchReport | null;
  taskPlan?: FluxoraAiTaskPlan | null;
  subagentSchedule?: FluxoraAiSubagentSchedule | null;
  selectedSkill?: FluxoraSkillSelection | null;
  fallbackProviders: string[];
  toolCallsAllowed: false;
  error?: NativeBridgeError;
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

export interface FluxoraModFileTreeEntry {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  hasChildren: boolean;
  size: number;
  conflictState: string;
  conflictOwners: string[];
}

export type FluxoraPreviewAssetKind = 'nif' | 'texture';

export interface FluxoraPreviewVariant {
  modPath: string;
  modName: string;
  order: number;
  enabled: boolean;
  relativePath: string;
  size: number;
}

export interface FluxoraPreviewAsset {
  kind: FluxoraPreviewAssetKind;
  modPath: string;
  modName: string;
  relativePath: string;
  fileName: string;
  size: number;
  mimeType: string;
  contentBase64: string;
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

export interface FluxoraNxmInboundLinksCaptured {
  count: number;
  operationId: string;
  source: string;
}

export interface FluxoraNexusModsAuthStatus {
  isConfigured: boolean;
  isLinked: boolean;
  hasApiKey: boolean;
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
  ai: {
    chatRespond: (request: FluxoraAiChatRequest) => Promise<FluxoraAiChatResponse>;
    estimateContext: (request: FluxoraAiChatRequest) => Promise<FluxoraAiContextUsage>;
    getStatus: (request?: OperationRequest) => Promise<FluxoraAiHostStatus>;
    restartHost: (request?: OperationRequest) => Promise<FluxoraAiHostStatus>;
    onRunEvent: (callback: (event: FluxoraAiIntermediateEvent) => void) => () => void;
    listSafeActions: () => Promise<AiSafeActionCatalog>;
    listSkills: () => Promise<FluxoraSkillCatalog>;
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
    listPreviewVariants: (
      projectDirectory: string,
      profileName: string,
      relativePath: string,
      request?: OperationRequest
    ) => Promise<FluxoraPreviewVariant[]>;
    readPreviewAsset: (
      projectDirectory: string,
      profileName: string,
      modPath: string,
      relativePath: string,
      kind: FluxoraPreviewAssetKind,
      request?: OperationRequest
    ) => Promise<FluxoraPreviewAsset>;
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
    onInboundLinksCaptured: (
      callback: (event: FluxoraNxmInboundLinksCaptured) => void
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
      profileName?: string
    ) => Promise<void>;
    openSettings: () => Promise<void>;
    openTextEditor: (
      configPath: string,
      modPath?: string,
      relativePath?: string,
      fileName?: string
    ) => Promise<void>;
    toggleMaximize: () => Promise<void>;
  };
}
