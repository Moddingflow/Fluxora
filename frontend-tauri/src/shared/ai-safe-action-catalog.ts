export const AI_SAFE_ACTION_CATALOG_SCHEMA = 'fluxora.ai.safe-action-catalog.v1';

export const AI_SAFE_ACTION_TOOL_NAMES = [
  'projects.create',
  'projects.rename',
  'projects.openConfig',
  'buildPaths.get',
  'buildPaths.save',
  'mods.listInstalled',
  'mods.setEnabled',
  'mods.setAllEnabled',
  'mods.moveOrderItem',
  'mods.createEmpty',
  'mods.createSeparator',
  'mods.deleteSeparator',
  'mods.deleteInstalled',
  'plugins.list',
  'plugins.move',
  'plugins.setEnabled',
  'profiles.list',
  'profiles.create',
  'profiles.clone',
  'profiles.rename',
  'downloads.list',
  'downloads.importFile',
  'downloads.install',
  'downloads.delete',
  'archives.install',
  'downloads.analyzeContentLayout',
  'downloads.analyzeFomod',
  'downloads.installFomod',
  'nexus.getAuthStatus',
  'local.read_text_file',
  'nexus.connect',
  'nexus.disconnect',
  'nxm.captureLinks',
  'nxm.importInboundDownloads',
  'operations.getStatus',
  'operations.cancel'
] as const;

export type AiSafeActionToolName = (typeof AI_SAFE_ACTION_TOOL_NAMES)[number];

export type AiSafeActionPermissionClass =
  | 'read'
  | 'write'
  | 'destructive'
  | 'external-network'
  | 'credential';

export type AiSafeActionDryRunSupport = 'not-applicable' | 'planned' | 'supported';
export type AiSafeActionApprovalMode = 'none' | 'plan' | 'step-by-step' | 'settings-flow';
export type AiSafeActionExecutionState = 'available' | 'approval-gated';

export interface AiSafeActionSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: readonly string[];
  items?: AiSafeActionSchemaProperty;
  additionalProperties?: boolean;
}

export interface AiSafeActionJsonSchema {
  type: 'object';
  additionalProperties: false;
  required: readonly string[];
  properties: Record<string, AiSafeActionSchemaProperty>;
}

export interface AiSafeActionAuditLog {
  category: 'AI.Tool';
  requiredFields: readonly string[];
  messageTemplate: string;
}

export interface AiSafeActionOperationIdPolicy {
  required: true;
  source: 'ai-run';
  propagation: readonly string[];
}

export interface AiSafeActionApprovalPolicy {
  required: boolean;
  mode: AiSafeActionApprovalMode;
  source: 'fluxora-ui-state';
}

export interface AiSafeActionExecutionPolicy {
  state: AiSafeActionExecutionState;
  executorQueue: 'ai-write-executor' | 'not-required';
  coreValidation: 'required';
  bypassesCoreValidation: false;
}

export interface AiSafeActionResultField {
  path: string;
  description: string;
}

export interface AiSafeActionToolDescriptor {
  name: AiSafeActionToolName;
  permissionClass: AiSafeActionPermissionClass;
  riskTags: readonly string[];
  backingSurface: string;
  facadeMethod: string;
  bridgeMethod: string;
  jsonSchema: AiSafeActionJsonSchema;
  dryRunSupport: AiSafeActionDryRunSupport;
  resultFields: readonly AiSafeActionResultField[];
  preconditions: readonly string[];
  postconditions: readonly string[];
  auditLog: AiSafeActionAuditLog;
  operationId: AiSafeActionOperationIdPolicy;
  rollbackNote: string;
  confirmationText: string;
  approval: AiSafeActionApprovalPolicy;
  execution: AiSafeActionExecutionPolicy;
}

export interface AiSafeActionCatalogPolicy {
  operationIdRequired: true;
  destructiveActionsRequireApproval: true;
  writeActionsOnlyThroughExecutorQueue: true;
  hiddenDestructiveActions: false;
  coreValidationRequired: true;
  rendererFilesystemAccess: false;
  modelTextCanApproveActions: false;
}

export interface AiSafeActionCatalog {
  schema: typeof AI_SAFE_ACTION_CATALOG_SCHEMA;
  generatedAt: 'static-phase-9';
  toolCount: number;
  policy: AiSafeActionCatalogPolicy;
  tools: readonly AiSafeActionToolDescriptor[];
}

export interface AiSafeActionPayloadValidationResult {
  ok: boolean;
  errors: readonly string[];
}

const stringProperty = (description: string): AiSafeActionSchemaProperty => ({
  type: 'string',
  description
});

const booleanProperty = (description: string): AiSafeActionSchemaProperty => ({
  type: 'boolean',
  description
});

const integerProperty = (description: string): AiSafeActionSchemaProperty => ({
  type: 'integer',
  description
});

const stringArrayProperty = (description: string): AiSafeActionSchemaProperty => ({
  type: 'array',
  description,
  items: stringProperty('String item.')
});

const objectProperty = (description: string): AiSafeActionSchemaProperty => ({
  type: 'object',
  description,
  additionalProperties: true
});

const schema = (
  required: readonly string[],
  properties: Record<string, AiSafeActionSchemaProperty>,
  dryRunSupport: AiSafeActionDryRunSupport
): AiSafeActionJsonSchema => ({
  type: 'object',
  additionalProperties: false,
  required: ['operationId', ...required],
  properties: {
    operationId: stringProperty('AI run operationId propagated through Fluxora UI, Tauri, bridge, core, and logs.'),
    ...(dryRunSupport === 'not-applicable'
      ? {}
      : { dryRun: booleanProperty('When true, validate and preview without committing the mutation.') }),
    ...properties
  }
});

const approvalModeFor = (permissionClass: AiSafeActionPermissionClass): AiSafeActionApprovalMode => {
  if (permissionClass === 'destructive') {
    return 'step-by-step';
  }
  if (permissionClass === 'credential') {
    return 'settings-flow';
  }
  if (permissionClass === 'write' || permissionClass === 'external-network') {
    return 'plan';
  }
  return 'none';
};

const defaultDryRunFor = (permissionClass: AiSafeActionPermissionClass): AiSafeActionDryRunSupport =>
  permissionClass === 'read' ? 'not-applicable' : 'planned';

const defaultPreconditions = (permissionClass: AiSafeActionPermissionClass): readonly string[] => {
  if (permissionClass === 'read') {
    return ['AI is enabled.', 'Requested project/profile context is available when the tool needs it.'];
  }
  if (permissionClass === 'credential') {
    return ['AI is enabled.', 'User opened a Fluxora-controlled credential or account flow.'];
  }
  return [
    'AI is enabled.',
    'A visible task plan names this exact tool and target.',
    'Required project/profile/download/mod context is available.',
    'The per-build operation lock is free.'
  ];
};

const defaultPostconditions = (permissionClass: AiSafeActionPermissionClass): readonly string[] => {
  if (permissionClass === 'read') {
    return ['Returned data is compact, source-scoped, and treated as untrusted context.'];
  }
  return [
    'The bridge/core response is recorded with the same operationId.',
    'A verification step must inspect the resulting state before the AI reports success.'
  ];
};

const defaultRollbackNote = (permissionClass: AiSafeActionPermissionClass): string => {
  if (permissionClass === 'read') {
    return 'No rollback is required because the tool does not mutate Fluxora state.';
  }
  if (permissionClass === 'credential') {
    return 'Credential changes are undone through the same Fluxora-controlled credential flow; never expose secrets to chat.';
  }
  return 'Use the pre-mutation snapshot and tool-specific recovery instructions; if automatic rollback is unavailable, report exact manual recovery steps.';
};

const createTool = (input: {
  name: AiSafeActionToolName;
  permissionClass: AiSafeActionPermissionClass;
  riskTags?: readonly string[];
  backingSurface: string;
  facadeMethod: string;
  bridgeMethod: string;
  required?: readonly string[];
  properties?: Record<string, AiSafeActionSchemaProperty>;
  dryRunSupport?: AiSafeActionDryRunSupport;
  resultFields?: readonly AiSafeActionResultField[];
  preconditions?: readonly string[];
  postconditions?: readonly string[];
  rollbackNote?: string;
  confirmationText: string;
}): AiSafeActionToolDescriptor => {
  const approvalMode = approvalModeFor(input.permissionClass);
  const dryRunSupport = input.dryRunSupport ?? defaultDryRunFor(input.permissionClass);
  const usesExecutorQueue = input.permissionClass !== 'read';
  return {
    name: input.name,
    permissionClass: input.permissionClass,
    riskTags: input.riskTags ?? [],
    backingSurface: input.backingSurface,
    facadeMethod: input.facadeMethod,
    bridgeMethod: input.bridgeMethod,
    jsonSchema: schema(input.required ?? [], input.properties ?? {}, dryRunSupport),
    dryRunSupport,
    resultFields: input.resultFields ?? [],
    preconditions: input.preconditions ?? defaultPreconditions(input.permissionClass),
    postconditions: input.postconditions ?? defaultPostconditions(input.permissionClass),
    auditLog: {
      category: 'AI.Tool',
      requiredFields: [
        'toolName',
        'permissionClass',
        'operationId',
        'approvalId',
        'dryRun',
        'phase',
        'result'
      ],
      messageTemplate: `tool=${input.name} permission=${input.permissionClass} phase={phase}`
    },
    operationId: {
      required: true,
      source: 'ai-run',
      propagation: ['renderer-facade', 'tauri-shell', 'bridge-host', 'cpp-core', 'operation-log']
    },
    rollbackNote: input.rollbackNote ?? defaultRollbackNote(input.permissionClass),
    confirmationText: input.confirmationText,
    approval: {
      required: approvalMode !== 'none',
      mode: approvalMode,
      source: 'fluxora-ui-state'
    },
    execution: {
      state: input.permissionClass === 'read' ? 'available' : 'approval-gated',
      executorQueue: usesExecutorQueue ? 'ai-write-executor' : 'not-required',
      coreValidation: 'required',
      bypassesCoreValidation: false
    }
  };
};

const projectDirectory = stringProperty('Absolute Fluxora project/build directory selected by the UI.');
const configPath = stringProperty('Fluxora build config path selected or created by the UI.');
const profileName = stringProperty('Profile name in the selected build.');
const templateId = stringProperty('Resolved game template id for plugin behavior.');
const modPath = stringProperty('Installed mod path or stable mod id from the current build state.');
const downloadPath = stringProperty('Download path or stable download id from the current build state.');
const targetIndex = integerProperty('Zero-based target order index validated by the core.');
const localReadTextPath = stringProperty('Relative safe AI text path under mods/ or profiles/.');
const maxBytes = integerProperty('Requested maximum bytes to read, clamped by Fluxora to 64 KB.');

export const AI_SAFE_ACTION_TOOLS: readonly AiSafeActionToolDescriptor[] = [
  createTool({
    name: 'projects.create',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core project service',
    facadeMethod: 'projects.create',
    bridgeMethod: 'projects.create',
    required: ['project'],
    properties: { project: objectProperty('CreateFluxoraProjectRequest DTO.') },
    confirmationText: 'Create a new Fluxora build from the reviewed project request.'
  }),
  createTool({
    name: 'projects.rename',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core project service',
    facadeMethod: 'projects.rename',
    bridgeMethod: 'projects.rename',
    required: ['configPath', 'newName'],
    properties: { configPath, newName: stringProperty('New build name.') },
    confirmationText: 'Rename the selected Fluxora build.'
  }),
  createTool({
    name: 'projects.openConfig',
    permissionClass: 'read',
    backingSurface: 'Tauri facade -> bridge/core project service',
    facadeMethod: 'projects.openConfig',
    bridgeMethod: 'projects.openConfig',
    required: ['configPath'],
    properties: { configPath },
    confirmationText: 'Open and read the selected Fluxora build config.'
  }),
  createTool({
    name: 'buildPaths.get',
    permissionClass: 'read',
    backingSurface: 'Tauri facade -> bridge/core build path service',
    facadeMethod: 'buildPaths.get',
    bridgeMethod: 'buildPaths.get',
    required: ['configPath'],
    properties: { configPath },
    confirmationText: 'Read build path settings for the selected build.'
  }),
  createTool({
    name: 'buildPaths.save',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core build path service',
    facadeMethod: 'buildPaths.save',
    bridgeMethod: 'buildPaths.save',
    required: ['configPath', 'settings'],
    properties: { configPath, settings: objectProperty('FluxoraBuildPathSettingsSaveRequest DTO.') },
    confirmationText: 'Save reviewed build path settings.'
  }),
  createTool({
    name: 'mods.listInstalled',
    permissionClass: 'read',
    backingSurface: 'Tauri facade -> bridge/core mod service',
    facadeMethod: 'mods.listInstalled',
    bridgeMethod: 'mods.listInstalled',
    required: ['projectDirectory'],
    properties: { projectDirectory },
    confirmationText: 'Read installed mods for the selected build.'
  }),
  createTool({
    name: 'mods.setEnabled',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core mod service',
    facadeMethod: 'mods.setEnabled',
    bridgeMethod: 'mods.setEnabled',
    required: ['projectDirectory', 'modPath', 'isEnabled'],
    properties: { projectDirectory, modPath, isEnabled: booleanProperty('Target enabled state.') },
    confirmationText: 'Change the enabled state of the selected mod.'
  }),
  createTool({
    name: 'mods.setAllEnabled',
    permissionClass: 'destructive',
    riskTags: ['bulk-change'],
    backingSurface: 'Tauri facade -> bridge/core mod service',
    facadeMethod: 'mods.setAllEnabled',
    bridgeMethod: 'mods.setAllEnabled',
    required: ['projectDirectory', 'isEnabled'],
    properties: { projectDirectory, isEnabled: booleanProperty('Bulk enabled state.') },
    confirmationText: 'Apply a bulk enabled-state change to all installed mods.'
  }),
  createTool({
    name: 'mods.moveOrderItem',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core mod order service',
    facadeMethod: 'mods.moveOrderItem',
    bridgeMethod: 'mods.moveOrderItem',
    required: ['projectDirectory', 'orderItemId', 'targetIndex'],
    properties: {
      projectDirectory,
      profileName,
      orderItemId: stringProperty('Stable mod order item id.'),
      targetIndex
    },
    confirmationText: 'Move the selected mod order item to the reviewed position.'
  }),
  createTool({
    name: 'mods.createEmpty',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core mod service',
    facadeMethod: 'mods.createEmpty',
    bridgeMethod: 'mods.createEmpty',
    required: ['projectDirectory', 'modName'],
    properties: { projectDirectory, modName: stringProperty('Name for the empty mod.') },
    confirmationText: 'Create an empty mod in the selected build.'
  }),
  createTool({
    name: 'mods.createSeparator',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core mod order service',
    facadeMethod: 'mods.createSeparator',
    bridgeMethod: 'mods.createSeparator',
    required: ['projectDirectory', 'title', 'targetIndex'],
    properties: { projectDirectory, profileName, title: stringProperty('Separator title.'), targetIndex },
    confirmationText: 'Create a mod separator at the reviewed order position.'
  }),
  createTool({
    name: 'mods.deleteSeparator',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core mod order service',
    facadeMethod: 'mods.deleteSeparator',
    bridgeMethod: 'mods.deleteSeparator',
    required: ['projectDirectory', 'separatorId'],
    properties: { projectDirectory, profileName, separatorId: stringProperty('Stable separator id.') },
    confirmationText: 'Delete the selected mod separator.'
  }),
  createTool({
    name: 'mods.deleteInstalled',
    permissionClass: 'destructive',
    riskTags: ['delete-files'],
    backingSurface: 'Tauri facade -> bridge/core mod service',
    facadeMethod: 'mods.deleteInstalled',
    bridgeMethod: 'mods.deleteInstalled',
    required: ['projectDirectory', 'modPath'],
    properties: { projectDirectory, modPath },
    confirmationText: 'Delete the selected installed mod after step-by-step approval.'
  }),
  createTool({
    name: 'plugins.list',
    permissionClass: 'read',
    backingSurface: 'Tauri facade -> bridge/core plugin service',
    facadeMethod: 'plugins.list',
    bridgeMethod: 'plugins.list',
    required: ['projectDirectory', 'templateId'],
    properties: { projectDirectory, templateId, profileName },
    resultFields: [
      {
        path: '[].name',
        description: 'Plugin filename for the load-order row.'
      },
      {
        path: '[].sourceMod',
        description: 'Source mod label resolved by the C++ plugin service.'
      },
      {
        path: '[].missingMasters',
        description: 'Exact missing master filenames for this plugin; empty means no missing masters.'
      },
      {
        path: '[].masterFiles',
        description: 'Declared master filenames read from plugin metadata when available.'
      }
    ],
    confirmationText: 'Read plugin order for the selected build and profile.'
  }),
  createTool({
    name: 'plugins.move',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core plugin service',
    facadeMethod: 'plugins.move',
    bridgeMethod: 'plugins.move',
    required: ['projectDirectory', 'templateId', 'orderItemId', 'targetIndex'],
    properties: {
      projectDirectory,
      templateId,
      profileName,
      orderItemId: stringProperty('Stable plugin order item id.'),
      targetIndex
    },
    confirmationText: 'Move the selected plugin order item to the reviewed position.'
  }),
  createTool({
    name: 'plugins.setEnabled',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core plugin service',
    facadeMethod: 'plugins.setEnabled',
    bridgeMethod: 'plugins.setEnabled',
    required: ['projectDirectory', 'templateId', 'pluginName', 'isEnabled'],
    properties: {
      projectDirectory,
      templateId,
      profileName,
      pluginName: stringProperty('Plugin filename.'),
      isEnabled: booleanProperty('Target enabled state.')
    },
    confirmationText: 'Change the selected plugin enabled state.'
  }),
  createTool({
    name: 'profiles.list',
    permissionClass: 'read',
    backingSurface: 'Tauri facade -> bridge/core profile service',
    facadeMethod: 'profiles.list',
    bridgeMethod: 'profiles.list',
    required: ['projectDirectory'],
    properties: { projectDirectory, defaultProfileName: stringProperty('Fallback/default profile name.') },
    confirmationText: 'Read profiles in the selected build.'
  }),
  createTool({
    name: 'profiles.create',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core profile service',
    facadeMethod: 'profiles.create',
    bridgeMethod: 'profiles.create',
    required: ['projectDirectory', 'profileName'],
    properties: {
      projectDirectory,
      profileName,
      defaultProfileName: stringProperty('Fallback/default profile name.'),
      profileFiles: stringArrayProperty('Profile files to initialize.')
    },
    confirmationText: 'Create a new profile in the selected build.'
  }),
  createTool({
    name: 'profiles.clone',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core profile service',
    facadeMethod: 'profiles.clone',
    bridgeMethod: 'profiles.clone',
    required: ['projectDirectory', 'sourceProfileName', 'targetProfileName'],
    properties: {
      projectDirectory,
      sourceProfileName: stringProperty('Existing source profile name.'),
      targetProfileName: stringProperty('New cloned profile name.'),
      defaultProfileName: stringProperty('Fallback/default profile name.')
    },
    confirmationText: 'Clone the selected profile to a reviewed target name.'
  }),
  createTool({
    name: 'profiles.rename',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core profile service',
    facadeMethod: 'profiles.rename',
    bridgeMethod: 'profiles.rename',
    required: ['projectDirectory', 'sourceProfileName', 'targetProfileName'],
    properties: {
      projectDirectory,
      sourceProfileName: stringProperty('Existing profile name.'),
      targetProfileName: stringProperty('New profile name.'),
      defaultProfileName: stringProperty('Fallback/default profile name.')
    },
    confirmationText: 'Rename the selected profile.'
  }),
  createTool({
    name: 'downloads.list',
    permissionClass: 'read',
    backingSurface: 'Tauri facade -> bridge/core download service',
    facadeMethod: 'downloads.list',
    bridgeMethod: 'downloads.list',
    required: ['projectDirectory'],
    properties: { projectDirectory },
    confirmationText: 'Read downloads for the selected build.'
  }),
  createTool({
    name: 'downloads.importFile',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core download service',
    facadeMethod: 'downloads.importFile',
    bridgeMethod: 'downloads.importFile',
    required: ['projectDirectory', 'sourcePath'],
    properties: { projectDirectory, sourcePath: stringProperty('User-selected local archive path.') },
    confirmationText: 'Import the selected local archive into downloads.'
  }),
  createTool({
    name: 'downloads.install',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core installer service',
    facadeMethod: 'downloads.install',
    bridgeMethod: 'downloads.install',
    required: ['request'],
    properties: { request: objectProperty('FluxoraInstallDownloadRequest DTO.') },
    confirmationText: 'Install the reviewed downloaded archive.'
  }),
  createTool({
    name: 'downloads.delete',
    permissionClass: 'destructive',
    riskTags: ['delete-files'],
    backingSurface: 'Tauri facade -> bridge/core download service',
    facadeMethod: 'downloads.delete',
    bridgeMethod: 'downloads.delete',
    required: ['projectDirectory', 'downloadPath'],
    properties: { projectDirectory, downloadPath },
    confirmationText: 'Delete the selected download after step-by-step approval.'
  }),
  createTool({
    name: 'archives.install',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core installer service',
    facadeMethod: 'archives.install',
    bridgeMethod: 'archives.install',
    required: ['request'],
    properties: { request: objectProperty('FluxoraInstallArchiveRequest DTO.') },
    confirmationText: 'Install the reviewed local archive.'
  }),
  createTool({
    name: 'downloads.analyzeContentLayout',
    permissionClass: 'read',
    backingSurface: 'Tauri facade -> bridge/core installer analysis service',
    facadeMethod: 'downloads.analyzeContentLayout',
    bridgeMethod: 'downloads.analyzeContentLayout',
    required: ['request'],
    properties: { request: objectProperty('FluxoraAnalyzeContentLayoutRequest DTO.') },
    confirmationText: 'Analyze archive content layout without installing it.'
  }),
  createTool({
    name: 'downloads.analyzeFomod',
    permissionClass: 'read',
    backingSurface: 'Tauri facade -> bridge/core FOMOD analysis service',
    facadeMethod: 'downloads.analyzeFomod',
    bridgeMethod: 'downloads.analyzeFomod',
    required: ['projectDirectory', 'downloadPath'],
    properties: { projectDirectory, downloadPath },
    confirmationText: 'Analyze FOMOD choices without installing the archive.'
  }),
  createTool({
    name: 'downloads.installFomod',
    permissionClass: 'write',
    backingSurface: 'Tauri facade -> bridge/core FOMOD installer service',
    facadeMethod: 'downloads.installFomod',
    bridgeMethod: 'downloads.installFomod',
    required: ['request'],
    properties: { request: objectProperty('FluxoraInstallFomodDownloadRequest DTO.') },
    confirmationText: 'Install the reviewed FOMOD download with selected options.'
  }),
  createTool({
    name: 'nexus.getAuthStatus',
    permissionClass: 'read',
    backingSurface: 'Tauri facade -> bridge/core Nexus auth service',
    facadeMethod: 'nexus.getAuthStatus',
    bridgeMethod: 'nexus.getAuthStatus',
    confirmationText: 'Read Nexus authentication status without exposing tokens.'
  }),
  createTool({
    name: 'local.read_text_file',
    permissionClass: 'read',
    riskTags: ['bounded-content-preview'],
    backingSurface: 'AI read-only Analyze tool -> Tauri facade -> bridge/core mod/profile text preview services',
    facadeMethod: 'ai.readOnly.local.readTextFile',
    bridgeMethod: 'mods.previewTextFile | profiles.previewTextFile',
    required: ['path', 'maxBytes'],
    properties: { path: localReadTextPath, maxBytes },
    resultFields: [
      {
        path: 'content_preview',
        description: 'UTF-8 text preview capped at 64 KB and treated as untrusted diagnostic data.'
      },
      {
        path: 'truncated',
        description: 'Whether the source text file was larger than the bytes returned.'
      },
      {
        path: 'bytes_read',
        description: 'Number of bytes returned in the preview.'
      }
    ],
    preconditions: [
      'AI is enabled.',
      'The Analyze skill or an equivalent build/crash/log diagnostic prompt selected this on-demand tool.',
      'Path resolves inside the selected build profiles or installed-mod folders.',
      'Path extension and file name match the AI text-read allowlist.'
    ],
    postconditions: [
      'Returned content is capped at 64 KB, marked truncated when partial, and treated as untrusted context.',
      'No arbitrary Windows, browser-data, credential, or user-document path is accepted.'
    ],
    rollbackNote: 'No rollback is required because the tool reads a bounded text preview only.',
    confirmationText: 'Read a bounded text preview from an allowlisted profile/mod diagnostic file.'
  }),
  createTool({
    name: 'nexus.connect',
    permissionClass: 'credential',
    backingSurface: 'Tauri facade -> bridge/core Nexus auth service',
    facadeMethod: 'nexus.connect',
    bridgeMethod: 'nexus.connect',
    confirmationText: 'Open the Fluxora-controlled Nexus connection flow.'
  }),
  createTool({
    name: 'nexus.disconnect',
    permissionClass: 'credential',
    backingSurface: 'Tauri facade -> bridge/core Nexus auth service',
    facadeMethod: 'nexus.disconnect',
    bridgeMethod: 'nexus.disconnect',
    confirmationText: 'Disconnect Nexus credentials through the Fluxora-controlled account flow.'
  }),
  createTool({
    name: 'nxm.captureLinks',
    permissionClass: 'external-network',
    riskTags: ['network', 'download-intent'],
    backingSurface: 'Tauri facade -> bridge/core NXM service',
    facadeMethod: 'nxm.captureLinks',
    bridgeMethod: 'nxm.captureLinks',
    required: ['links'],
    properties: {
      projectDirectory,
      links: stringArrayProperty('NXM links captured from the OS protocol handler or user approval flow.')
    },
    confirmationText: 'Capture reviewed NXM links for the selected build.'
  }),
  createTool({
    name: 'nxm.importInboundDownloads',
    permissionClass: 'external-network',
    riskTags: ['network', 'download-intent'],
    backingSurface: 'Tauri facade -> bridge/core NXM service',
    facadeMethod: 'nxm.importInboundDownloads',
    bridgeMethod: 'nxm.importInboundDownloads',
    required: ['projectDirectory'],
    properties: { projectDirectory },
    confirmationText: 'Import reviewed inbound NXM downloads for the selected build.'
  }),
  createTool({
    name: 'operations.getStatus',
    permissionClass: 'read',
    backingSurface: 'Tauri shell operation status cache',
    facadeMethod: 'operations.getStatus',
    bridgeMethod: 'operations.getStatus',
    confirmationText: 'Read current Fluxora operation status.'
  }),
  createTool({
    name: 'operations.cancel',
    permissionClass: 'write',
    riskTags: ['cancellation'],
    backingSurface: 'Tauri facade -> bridge/core operation service',
    facadeMethod: 'operations.cancel',
    bridgeMethod: 'operations.cancel',
    required: ['targetOperationId'],
    properties: { targetOperationId: stringProperty('Operation id to cancel.') },
    confirmationText: 'Cancel the selected running operation.'
  })
];

export const AI_SAFE_ACTION_CATALOG: AiSafeActionCatalog = {
  schema: AI_SAFE_ACTION_CATALOG_SCHEMA,
  generatedAt: 'static-phase-9',
  toolCount: AI_SAFE_ACTION_TOOLS.length,
  policy: {
    operationIdRequired: true,
    destructiveActionsRequireApproval: true,
    writeActionsOnlyThroughExecutorQueue: true,
    hiddenDestructiveActions: false,
    coreValidationRequired: true,
    rendererFilesystemAccess: false,
    modelTextCanApproveActions: false
  },
  tools: AI_SAFE_ACTION_TOOLS
};

export const AI_SAFE_ACTION_CATALOG_CAPABILITY = {
  state: 'available',
  schema: AI_SAFE_ACTION_CATALOG_SCHEMA,
  owner: 'typed-window-fluxora-ai-facade',
  toolCount: AI_SAFE_ACTION_CATALOG.toolCount,
  tools: AI_SAFE_ACTION_TOOLS.map((tool) => ({
    name: tool.name,
    permissionClass: tool.permissionClass,
    approvalMode: tool.approval.mode,
    dryRunSupport: tool.dryRunSupport,
    executionState: tool.execution.state,
    coreValidation: tool.execution.coreValidation
  })),
  operationIdRequired: true,
  destructiveToolsRequireApproval: true,
  writeActionsOnlyThroughQueue: true,
  hiddenDestructiveActions: false,
  coreValidationRequired: true,
  toolExecution: 'catalog-ready-execution-gated'
} as const;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const DISALLOWED_AI_PAYLOAD_KEYS = new Set([
  '__proto__',
  'approvedByModel',
  'autoApprove',
  'bypassApproval',
  'hidden',
  'hiddenDestructiveActions',
  'rawInvoke',
  'shellCommand',
  'tauriInvoke'
]);

const validatePayloadKeyPolicy = (value: unknown, path = 'payload'): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => validatePayloadKeyPolicy(item, `${path}[${index}]`));
  }

  if (!isPlainRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) => {
    const currentPath = `${path}.${key}`;
    const errors = DISALLOWED_AI_PAYLOAD_KEYS.has(key)
      ? [`Disallowed AI payload key: ${currentPath}.`]
      : [];
    return [...errors, ...validatePayloadKeyPolicy(nested, currentPath)];
  });
};

const validateSchemaProperty = (
  value: unknown,
  property: AiSafeActionSchemaProperty,
  path: string
): string[] => {
  if (property.type === 'array') {
    if (!Array.isArray(value)) {
      return [`${path} must be an array.`];
    }

    return value.flatMap((item, index) =>
      property.items ? validateSchemaProperty(item, property.items, `${path}[${index}]`) : []
    );
  }

  if (property.type === 'object') {
    if (!isPlainRecord(value)) {
      return [`${path} must be an object.`];
    }

    return validatePayloadKeyPolicy(value, path);
  }

  if (property.type === 'integer') {
    return Number.isInteger(value) ? [] : [`${path} must be an integer.`];
  }

  if (property.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value)
      ? []
      : [`${path} must be a finite number.`];
  }

  if (typeof value !== property.type) {
    return [`${path} must be a ${property.type}.`];
  }

  if (property.enum && !property.enum.includes(String(value))) {
    return [`${path} must be one of: ${property.enum.join(', ')}.`];
  }

  return [];
};

export const findAiSafeActionTool = (
  toolName: string
): AiSafeActionToolDescriptor | undefined =>
  AI_SAFE_ACTION_TOOLS.find((tool) => tool.name === toolName);

export const validateAiSafeActionPayload = (
  toolName: string,
  payload: unknown
): AiSafeActionPayloadValidationResult => {
  const tool = findAiSafeActionTool(toolName);
  if (!tool) {
    return { ok: false, errors: [`Unknown AI safe action tool: ${toolName}.`] };
  }

  if (!isPlainRecord(payload)) {
    return { ok: false, errors: ['Payload must be a JSON object.'] };
  }

  const errors: string[] = [];
  errors.push(...validatePayloadKeyPolicy(payload));
  const allowedProperties = new Set(Object.keys(tool.jsonSchema.properties));
  for (const key of Object.keys(payload)) {
    if (!allowedProperties.has(key)) {
      errors.push(`Unexpected property: ${key}.`);
    }
  }

  for (const required of tool.jsonSchema.required) {
    if (!(required in payload)) {
      errors.push(`Missing required property: ${required}.`);
    }
  }

  for (const [key, property] of Object.entries(tool.jsonSchema.properties)) {
    if (key in payload) {
      errors.push(...validateSchemaProperty(payload[key], property, key));
    }
  }

  return { ok: errors.length === 0, errors };
};
