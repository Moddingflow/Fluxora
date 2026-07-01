import {
  AI_SAFE_ACTION_CATALOG,
  type AiSafeActionApprovalMode,
  type AiSafeActionPermissionClass,
  type AiSafeActionToolDescriptor,
  type AiSafeActionToolName
} from '../../../shared/ai-safe-action-catalog';
import type {
  CreateFluxoraProjectRequest,
  FluxoraApi,
  FluxoraDownloadEntry,
  FluxoraInstallArchiveRequest,
  FluxoraInstallDownloadRequest,
  FluxoraInstalledModSummary,
  FluxoraModMutationResult,
  FluxoraModOrderItem,
  FluxoraPluginOrderItem,
  FluxoraProject,
  OperationRequest
} from '../../../shared/fluxora-api';
import {
  collectAiBuildContext,
  type AiBuildContextSnapshot,
  type AiBuildToolRuntimeContext,
  type AiReadOnlyBuildToolName
} from './ai-build-tools';

export const AI_BASIC_BUILD_EXECUTION_PLAN_SCHEMA =
  'fluxora.ai.basic-build-execution-plan.v1';
export const AI_BASIC_BUILD_VERIFICATION_DIFF_SCHEMA =
  'fluxora.ai.basic-build-verification-diff.v1';

export type AiBasicBuildScenario =
  | 'create-empty-build'
  | 'rename-build'
  | 'create-profile'
  | 'create-separator'
  | 'set-mod-enabled'
  | 'move-mod-order'
  | 'import-local-archive'
  | 'install-downloaded-mod'
  | 'install-local-archive'
  | 'delete-installed-mod'
  | 'check-basic-plugin-state';

export type AiBasicBuildExecutionPermissionClass = Extract<
  AiSafeActionPermissionClass,
  'read' | 'write' | 'destructive'
>;

export type AiBasicBuildExecutionStatus =
  | 'needs-approval'
  | 'verified'
  | 'partial'
  | 'blocked';

export type AiBasicBuildStepResultStatus = 'verified' | 'failed' | 'skipped';

export type AiBasicBuildSnapshotDomain =
  | 'build'
  | 'profiles'
  | 'mods'
  | 'mod-order'
  | 'plugins'
  | 'downloads'
  | 'operations';

export type AiBasicBuildDiffChangeType = 'added' | 'removed' | 'updated' | 'issue';

export type AiBasicBuildVerificationCheckId =
  | 'mod-exists'
  | 'enabled-state'
  | 'order-changed'
  | 'plugin-order-changed'
  | 'missing-masters'
  | 'duplicate-names'
  | 'failed-install'
  | 'operation-errors';

export type AiBasicBuildVerificationCheckStatus =
  | 'passed'
  | 'failed'
  | 'not-applicable';

export interface AiBasicBuildDiffChange {
  after?: unknown;
  before?: unknown;
  changeType: AiBasicBuildDiffChangeType;
  domain: AiBasicBuildSnapshotDomain;
  humanSummary: string;
  id: string;
  label: string;
  sourceTool: string;
}

export interface AiBasicBuildVerificationCheck {
  id: AiBasicBuildVerificationCheckId;
  issues: string[];
  source: 'snapshot-diff' | 'tool-result' | 'operation-log';
  status: AiBasicBuildVerificationCheckStatus;
  summary: string;
  toolName?: AiSafeActionToolName;
}

export interface AiBasicBuildRollbackHook {
  automatic: false;
  hook: string;
  instructions: string;
  stepId: string;
  supported: boolean;
  toolName: AiSafeActionToolName;
}

export interface AiBasicBuildVerificationDiff {
  afterSnapshotAt?: string;
  beforeSnapshotAt?: string;
  checks: AiBasicBuildVerificationCheck[];
  generatedAt: string;
  humanReadableDiff: string[];
  machineReadableDiff: AiBasicBuildDiffChange[];
  operationId: string;
  recoveryInstructions: string[];
  rollbackHooks: AiBasicBuildRollbackHook[];
  schema: typeof AI_BASIC_BUILD_VERIFICATION_DIFF_SCHEMA;
  snapshotDomains: readonly AiBasicBuildSnapshotDomain[];
}

export interface AiBasicBuildProfileCreateRequest {
  defaultProfileName?: string;
  profileFiles?: string[];
  profileName: string;
  projectDirectory?: string;
}

export interface AiBasicBuildSeparatorRequest {
  profileName?: string;
  projectDirectory?: string;
  targetIndex: number;
  title: string;
}

export interface AiBasicBuildModEnabledRequest {
  isEnabled: boolean;
  modPath: string;
  projectDirectory?: string;
}

export interface AiBasicBuildModMoveRequest {
  orderItemId: string;
  profileName?: string;
  projectDirectory?: string;
  targetIndex: number;
}

export interface AiBasicBuildArchiveImportRequest {
  projectDirectory?: string;
  sourcePath: string;
}

export interface AiBasicBuildDeleteModRequest {
  modPath: string;
  projectDirectory?: string;
}

export interface AiBasicBuildPluginCheckRequest {
  profileName?: string;
  projectDirectory?: string;
  templateId?: string;
}

export interface AiBasicBuildExecutionRequest {
  checkPluginState?: boolean | AiBasicBuildPluginCheckRequest;
  createProject?: CreateFluxoraProjectRequest;
  createProfile?: AiBasicBuildProfileCreateRequest;
  createSeparator?: AiBasicBuildSeparatorRequest;
  deleteInstalledMod?: AiBasicBuildDeleteModRequest;
  importLocalArchive?: AiBasicBuildArchiveImportRequest;
  installDownloadedMod?: FluxoraInstallDownloadRequest;
  installLocalArchive?: FluxoraInstallArchiveRequest;
  moveMod?: AiBasicBuildModMoveRequest;
  project?: FluxoraProject | null;
  renameBuild?: {
    configPath?: string;
    newName: string;
  };
  setModEnabled?: AiBasicBuildModEnabledRequest;
}

export interface AiBasicBuildExecutionStep {
  approvalMode: AiSafeActionApprovalMode;
  arguments: Record<string, unknown>;
  confirmationText: string;
  id: string;
  permissionClass: AiBasicBuildExecutionPermissionClass;
  rollbackNote: string;
  scenario: AiBasicBuildScenario;
  title: string;
  toolName: AiSafeActionToolName;
}

export interface AiBasicBuildExecutionPlan {
  approval: {
    destructiveApprovalMode: 'step-by-step';
    modelTextCanApproveActions: false;
    planMustBeVisibleBeforeMutation: true;
    safeActionApprovalModes: readonly ['approve-all-safe', 'step-by-step'];
  };
  blockedReasons: string[];
  generatedAt: string;
  operationId: string;
  schema: typeof AI_BASIC_BUILD_EXECUTION_PLAN_SCHEMA;
  snapshot: {
    beforeMutationRequired: true;
    domains: readonly AiBasicBuildSnapshotDomain[];
    source: 'read-only-build-context';
  };
  steps: AiBasicBuildExecutionStep[];
  verification: {
    afterEachMutation: true;
    finalReportAfterVerification: true;
    missingMastersCheckIncluded: boolean;
    verificationAgentId: 'verification';
  };
}

export interface AiBasicBuildExecutionApproval {
  approvalId: string;
  approveAllSafeActions?: boolean;
  approvedStepIds?: readonly string[];
}

export interface AiBasicBuildExecutionContext extends AiBuildToolRuntimeContext {
  project: FluxoraProject | null;
}

export interface AiBasicBuildVerificationResult {
  agentId: 'verification';
  checkedAt: string;
  issues: string[];
  passed: boolean;
  summary: string;
}

export interface AiBasicBuildStepExecutionResult {
  error?: string;
  output?: unknown;
  resultStatus: AiBasicBuildStepResultStatus;
  skippedReason?: string;
  step: AiBasicBuildExecutionStep;
  verification?: AiBasicBuildVerificationResult;
}

export interface AiBasicBuildExecutionReport {
  completedStepCount: number;
  failedStepCount: number;
  humanReadableDiff: string[];
  machineReadableDiff: AiBasicBuildDiffChange[];
  operationId: string;
  pendingApprovalStepCount: number;
  recoveryInstructions: string[];
  rollbackHooks: AiBasicBuildRollbackHook[];
  summary: string;
  verificationChecks: AiBasicBuildVerificationCheck[];
  verified: boolean;
}

export interface AiBasicBuildExecutionResult {
  completedAt: string;
  operationId: string;
  postMutationSnapshot?: AiBuildContextSnapshot;
  preMutationSnapshot?: AiBuildContextSnapshot;
  report: AiBasicBuildExecutionReport;
  startedAt: string;
  status: AiBasicBuildExecutionStatus;
  stepResults: AiBasicBuildStepExecutionResult[];
  verificationDiff?: AiBasicBuildVerificationDiff;
}

const descriptorByName = new Map<AiSafeActionToolName, AiSafeActionToolDescriptor>(
  AI_SAFE_ACTION_CATALOG.tools.map((tool) => [tool.name, tool])
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isPhase10PermissionClass = (
  value: AiSafeActionPermissionClass
): value is AiBasicBuildExecutionPermissionClass =>
  value === 'read' || value === 'write' || value === 'destructive';

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const projectDirectoryFor = (
  request: AiBasicBuildExecutionRequest,
  explicit?: string
): string | undefined => nonEmpty(explicit) ?? nonEmpty(request.project?.projectDirectory);

const configPathFor = (
  request: AiBasicBuildExecutionRequest,
  explicit?: string
): string | undefined => nonEmpty(explicit) ?? nonEmpty(request.project?.configPath);

const templateIdFor = (
  request: AiBasicBuildExecutionRequest,
  explicit?: string
): string | undefined => nonEmpty(explicit) ?? nonEmpty(request.project?.templateId);

const addMissingArgument = (
  blockedReasons: string[],
  toolName: AiSafeActionToolName,
  argumentName: string
): undefined => {
  blockedReasons.push(`${toolName} requires ${argumentName}.`);
  return undefined;
};

const stepId = (index: number, toolName: AiSafeActionToolName): string =>
  `${String(index).padStart(2, '0')}-${toolName.replace(/\./g, '-')}`;

const createStep = (
  index: number,
  toolName: AiSafeActionToolName,
  scenario: AiBasicBuildScenario,
  title: string,
  operationId: string,
  args: Record<string, unknown>,
  blockedReasons: string[]
): AiBasicBuildExecutionStep | null => {
  const descriptor = descriptorByName.get(toolName);
  if (!descriptor) {
    blockedReasons.push(`${toolName} is not present in the safe action catalog.`);
    return null;
  }

  if (!isPhase10PermissionClass(descriptor.permissionClass)) {
    blockedReasons.push(`${toolName} is not a Phase 10 read/write/destructive action.`);
    return null;
  }

  return {
    approvalMode: descriptor.approval.mode,
    arguments: {
      operationId,
      ...args
    },
    confirmationText: descriptor.confirmationText,
    id: stepId(index, toolName),
    permissionClass: descriptor.permissionClass,
    rollbackNote: descriptor.rollbackNote,
    scenario,
    title,
    toolName
  };
};

export const createAiBasicBuildExecutionPlan = (
  request: AiBasicBuildExecutionRequest,
  operationId: string,
  now = new Date()
): AiBasicBuildExecutionPlan => {
  const steps: AiBasicBuildExecutionStep[] = [];
  const blockedReasons: string[] = [];
  let index = 1;

  const pushStep = (
    toolName: AiSafeActionToolName,
    scenario: AiBasicBuildScenario,
    title: string,
    args: Record<string, unknown>
  ) => {
    const step = createStep(index, toolName, scenario, title, operationId, args, blockedReasons);
    index += 1;
    if (step) {
      steps.push(step);
    }
  };

  if (request.createProject) {
    pushStep('projects.create', 'create-empty-build', 'Create an empty build from template', {
      project: request.createProject
    });
  }

  if (request.renameBuild) {
    const configPath =
      configPathFor(request, request.renameBuild.configPath) ??
      addMissingArgument(blockedReasons, 'projects.rename', 'configPath');
    if (configPath) {
      pushStep('projects.rename', 'rename-build', 'Rename the build', {
        configPath,
        newName: request.renameBuild.newName
      });
    }
  }

  if (request.createProfile) {
    const projectDirectory =
      projectDirectoryFor(request, request.createProfile.projectDirectory) ??
      addMissingArgument(blockedReasons, 'profiles.create', 'projectDirectory');
    if (projectDirectory) {
      pushStep('profiles.create', 'create-profile', 'Create a profile', {
        defaultProfileName: request.createProfile.defaultProfileName,
        profileFiles: request.createProfile.profileFiles ?? [],
        profileName: request.createProfile.profileName,
        projectDirectory
      });
    }
  }

  if (request.createSeparator) {
    const projectDirectory =
      projectDirectoryFor(request, request.createSeparator.projectDirectory) ??
      addMissingArgument(blockedReasons, 'mods.createSeparator', 'projectDirectory');
    if (projectDirectory) {
      pushStep('mods.createSeparator', 'create-separator', 'Add a mod separator', {
        profileName: request.createSeparator.profileName,
        projectDirectory,
        targetIndex: request.createSeparator.targetIndex,
        title: request.createSeparator.title
      });
    }
  }

  if (request.setModEnabled) {
    const projectDirectory =
      projectDirectoryFor(request, request.setModEnabled.projectDirectory) ??
      addMissingArgument(blockedReasons, 'mods.setEnabled', 'projectDirectory');
    if (projectDirectory) {
      pushStep('mods.setEnabled', 'set-mod-enabled', 'Enable or disable a mod', {
        isEnabled: request.setModEnabled.isEnabled,
        modPath: request.setModEnabled.modPath,
        projectDirectory
      });
    }
  }

  if (request.moveMod) {
    const projectDirectory =
      projectDirectoryFor(request, request.moveMod.projectDirectory) ??
      addMissingArgument(blockedReasons, 'mods.moveOrderItem', 'projectDirectory');
    if (projectDirectory) {
      pushStep('mods.moveOrderItem', 'move-mod-order', 'Move a mod in order', {
        orderItemId: request.moveMod.orderItemId,
        profileName: request.moveMod.profileName,
        projectDirectory,
        targetIndex: request.moveMod.targetIndex
      });
    }
  }

  if (request.importLocalArchive) {
    const projectDirectory =
      projectDirectoryFor(request, request.importLocalArchive.projectDirectory) ??
      addMissingArgument(blockedReasons, 'downloads.importFile', 'projectDirectory');
    if (projectDirectory) {
      pushStep('downloads.importFile', 'import-local-archive', 'Import a local archive', {
        projectDirectory,
        sourcePath: request.importLocalArchive.sourcePath
      });
    }
  }

  if (request.installDownloadedMod) {
    pushStep(
      'downloads.install',
      'install-downloaded-mod',
      'Install an already downloaded mod',
      { request: request.installDownloadedMod }
    );
  }

  if (request.installLocalArchive) {
    pushStep('archives.install', 'install-local-archive', 'Install a local archive', {
      request: request.installLocalArchive
    });
  }

  if (request.deleteInstalledMod) {
    const projectDirectory =
      projectDirectoryFor(request, request.deleteInstalledMod.projectDirectory) ??
      addMissingArgument(blockedReasons, 'mods.deleteInstalled', 'projectDirectory');
    if (projectDirectory) {
      pushStep('mods.deleteInstalled', 'delete-installed-mod', 'Delete an installed mod', {
        modPath: request.deleteInstalledMod.modPath,
        projectDirectory
      });
    }
  }

  const pluginCheck: AiBasicBuildPluginCheckRequest | null =
    request.checkPluginState === true
      ? {}
      : isRecord(request.checkPluginState)
        ? {
            profileName:
              typeof request.checkPluginState.profileName === 'string'
                ? request.checkPluginState.profileName
                : undefined,
            projectDirectory:
              typeof request.checkPluginState.projectDirectory === 'string'
                ? request.checkPluginState.projectDirectory
                : undefined,
            templateId:
              typeof request.checkPluginState.templateId === 'string'
                ? request.checkPluginState.templateId
                : undefined
          }
        : null;
  if (pluginCheck) {
    const projectDirectory =
      projectDirectoryFor(request, pluginCheck.projectDirectory) ??
      addMissingArgument(blockedReasons, 'plugins.list', 'projectDirectory');
    const templateId =
      templateIdFor(request, pluginCheck.templateId) ??
      addMissingArgument(blockedReasons, 'plugins.list', 'templateId');
    if (projectDirectory && templateId) {
      pushStep('plugins.list', 'check-basic-plugin-state', 'Check missing masters and plugin state', {
        profileName: pluginCheck.profileName,
        projectDirectory,
        templateId
      });
    }
  }

  return {
    approval: {
      destructiveApprovalMode: 'step-by-step',
      modelTextCanApproveActions: false,
      planMustBeVisibleBeforeMutation: true,
      safeActionApprovalModes: ['approve-all-safe', 'step-by-step']
    },
    blockedReasons,
    generatedAt: now.toISOString(),
    operationId,
    schema: AI_BASIC_BUILD_EXECUTION_PLAN_SCHEMA,
    snapshot: {
      beforeMutationRequired: true,
      domains: ['build', 'profiles', 'mods', 'mod-order', 'plugins', 'downloads', 'operations'],
      source: 'read-only-build-context'
    },
    steps,
    verification: {
      afterEachMutation: true,
      finalReportAfterVerification: true,
      missingMastersCheckIncluded: steps.some((step) => step.toolName === 'plugins.list'),
      verificationAgentId: 'verification'
    }
  };
};

const requestFor = (operationId: string): OperationRequest => ({ operationId });

const stringArg = (step: AiBasicBuildExecutionStep, name: string): string => {
  const value = step.arguments[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${step.toolName} requires string argument ${name}.`);
  }
  return value;
};

const optionalStringArg = (
  step: AiBasicBuildExecutionStep,
  name: string
): string | undefined => {
  const value = step.arguments[name];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
};

const numberArg = (step: AiBasicBuildExecutionStep, name: string): number => {
  const value = step.arguments[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${step.toolName} requires numeric argument ${name}.`);
  }
  return value;
};

const booleanArg = (step: AiBasicBuildExecutionStep, name: string): boolean => {
  const value = step.arguments[name];
  if (typeof value !== 'boolean') {
    throw new Error(`${step.toolName} requires boolean argument ${name}.`);
  }
  return value;
};

const recordArg = (step: AiBasicBuildExecutionStep, name: string): Record<string, unknown> => {
  const value = step.arguments[name];
  if (!isRecord(value)) {
    throw new Error(`${step.toolName} requires object argument ${name}.`);
  }
  return value;
};

const stringArrayArg = (step: AiBasicBuildExecutionStep, name: string): string[] => {
  const value = step.arguments[name];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
};

const logExecutionTool = async (
  api: FluxoraApi,
  step: AiBasicBuildExecutionStep,
  phase: 'started' | 'succeeded' | 'failed' | 'skipped',
  operationId: string,
  approvalId: string,
  level: 'info' | 'warning' | 'error' = phase === 'failed' ? 'error' : 'info'
) => {
  try {
    await api.ui.log({
      category: 'AI.Tool',
      level,
      message:
        `tool=${step.toolName} permission=${step.permissionClass} approvalId=${approvalId} ` +
        `dryRun=false phase=${phase}`,
      operationId
    });
  } catch {
    // Execution is already routed through typed facade calls; logging failures must not mask tool results.
  }
};

const executeStepTool = async (
  api: FluxoraApi,
  step: AiBasicBuildExecutionStep,
  operationId: string
): Promise<unknown> => {
  const operation = requestFor(operationId);

  switch (step.toolName) {
    case 'projects.create':
      return api.projects.create(
        recordArg(step, 'project') as unknown as CreateFluxoraProjectRequest,
        operation
      );
    case 'projects.rename':
      return api.projects.rename(
        stringArg(step, 'configPath'),
        stringArg(step, 'newName'),
        operation
      );
    case 'profiles.create':
      return api.profiles.create(
        stringArg(step, 'projectDirectory'),
        stringArg(step, 'profileName'),
        optionalStringArg(step, 'defaultProfileName'),
        stringArrayArg(step, 'profileFiles'),
        operation
      );
    case 'mods.createSeparator':
      return api.mods.createSeparator(
        stringArg(step, 'projectDirectory'),
        optionalStringArg(step, 'profileName'),
        stringArg(step, 'title'),
        numberArg(step, 'targetIndex'),
        operation
      );
    case 'mods.setEnabled':
      return api.mods.setEnabled(
        stringArg(step, 'projectDirectory'),
        stringArg(step, 'modPath'),
        booleanArg(step, 'isEnabled'),
        operation
      );
    case 'mods.moveOrderItem':
      return api.mods.moveOrderItem(
        stringArg(step, 'projectDirectory'),
        optionalStringArg(step, 'profileName'),
        stringArg(step, 'orderItemId'),
        numberArg(step, 'targetIndex'),
        operation
      );
    case 'downloads.importFile':
      return api.downloads.importFile(
        stringArg(step, 'projectDirectory'),
        stringArg(step, 'sourcePath'),
        operation
      );
    case 'downloads.install':
      return api.downloads.install(
        recordArg(step, 'request') as unknown as FluxoraInstallDownloadRequest,
        operation
      );
    case 'archives.install':
      return api.archives.install(
        recordArg(step, 'request') as unknown as FluxoraInstallArchiveRequest,
        operation
      );
    case 'mods.deleteInstalled':
      return api.mods.deleteInstalled(
        stringArg(step, 'projectDirectory'),
        stringArg(step, 'modPath'),
        operation
      );
    case 'plugins.list':
      return api.plugins.list(
        stringArg(step, 'projectDirectory'),
        stringArg(step, 'templateId'),
        optionalStringArg(step, 'profileName'),
        operation
      );
    default:
      throw new Error(`${step.toolName} is not executable by the Phase 10 MVP runner.`);
  }
};

const outputProject = (output: unknown): FluxoraProject | null => {
  if (!isRecord(output)) {
    return null;
  }

  return typeof output.projectDirectory === 'string' && typeof output.configPath === 'string'
    ? (output as unknown as FluxoraProject)
    : null;
};

const acceptedMutation = (output: unknown): boolean =>
  isRecord(output) && output.accepted === true;

const verifyStepOutput = (
  step: AiBasicBuildExecutionStep,
  output: unknown,
  now = new Date()
): AiBasicBuildVerificationResult => {
  const checkedAt = now.toISOString();
  const pass = (summary: string, issues: string[] = []): AiBasicBuildVerificationResult => ({
    agentId: 'verification',
    checkedAt,
    issues,
    passed: true,
    summary
  });
  const fail = (summary: string, issues: string[] = []): AiBasicBuildVerificationResult => ({
    agentId: 'verification',
    checkedAt,
    issues,
    passed: false,
    summary
  });

  switch (step.toolName) {
    case 'projects.create': {
      const project = outputProject(output);
      return project
        ? pass(`Created build ${project.name}.`)
        : fail('Project create did not return a usable build.');
    }
    case 'projects.rename': {
      const project = outputProject(output);
      const expectedName = stringArg(step, 'newName');
      return project?.name === expectedName
        ? pass(`Renamed build to ${expectedName}.`)
        : fail(`Rename result did not confirm ${expectedName}.`);
    }
    case 'profiles.create': {
      const profileName = stringArg(step, 'profileName');
      return Array.isArray(output) && output.includes(profileName)
        ? pass(`Profile ${profileName} exists.`)
        : fail(`Profile ${profileName} was not returned by the core.`);
    }
    case 'mods.createSeparator': {
      const title = stringArg(step, 'title');
      const order = Array.isArray(output) ? (output as FluxoraModOrderItem[]) : [];
      return order.some((item) => item.isSeparator && item.separatorTitle === title)
        ? pass(`Separator ${title} exists in mod order.`)
        : fail(`Separator ${title} was not returned by mod order.`);
    }
    case 'mods.setEnabled': {
      const expectedEnabled = booleanArg(step, 'isEnabled');
      const mutation = output as FluxoraModMutationResult;
      return acceptedMutation(output) && mutation.isEnabled === expectedEnabled
        ? pass(`Mod enabled state is ${expectedEnabled}.`)
        : fail('Mod enabled mutation was not accepted or returned the wrong state.');
    }
    case 'mods.moveOrderItem': {
      const orderItemId = stringArg(step, 'orderItemId');
      const targetIndex = numberArg(step, 'targetIndex');
      const order = Array.isArray(output) ? (output as FluxoraModOrderItem[]) : [];
      const moved = order.find((item) => item.orderId === orderItemId);
      return moved && (moved.order === targetIndex || order.indexOf(moved) === targetIndex)
        ? pass(`Moved ${orderItemId} to index ${targetIndex}.`)
        : fail(`Move result did not place ${orderItemId} at index ${targetIndex}.`);
    }
    case 'downloads.importFile': {
      const download = output as FluxoraDownloadEntry;
      return isRecord(output) && typeof download.localPath === 'string'
        ? pass(`Imported archive ${download.fileName || download.name}.`)
        : fail('Archive import did not return a download entry.');
    }
    case 'downloads.install':
    case 'archives.install': {
      const summary = output as FluxoraInstalledModSummary;
      return isRecord(output) && typeof summary.id === 'string' && typeof summary.name === 'string'
        ? pass(`Installed mod ${summary.name}.`)
        : fail('Install did not return an installed mod summary.');
    }
    case 'mods.deleteInstalled':
      return acceptedMutation(output)
        ? pass('Installed mod deletion was explicitly approved and accepted.')
        : fail('Installed mod deletion was not accepted.');
    case 'plugins.list': {
      const plugins = Array.isArray(output) ? (output as FluxoraPluginOrderItem[]) : [];
      const missingMasters = plugins.filter((plugin) => plugin.missingMasters.length > 0);
      return pass(
        `Checked ${plugins.length} plugin(s); ${missingMasters.length} missing-master issue(s).`,
        missingMasters.map(
          (plugin) => `${plugin.name}: missing ${plugin.missingMasters.join(', ')}`
        )
      );
    }
    default:
      return fail(`${step.toolName} verification is not supported by the Phase 10 runner.`);
  }
};

const isApproved = (
  step: AiBasicBuildExecutionStep,
  approval: AiBasicBuildExecutionApproval
): boolean => {
  if (step.permissionClass === 'read') {
    return true;
  }

  if (step.permissionClass === 'destructive') {
    return approval.approvedStepIds?.includes(step.id) ?? false;
  }

  return Boolean(approval.approveAllSafeActions || approval.approvedStepIds?.includes(step.id));
};

const collectSnapshot = (
  api: FluxoraApi,
  context: AiBasicBuildExecutionContext,
  operationId: string
): Promise<AiBuildContextSnapshot> =>
  collectAiBuildContext(
    api,
    {
      ...context,
      project: context.project
    },
    operationId
  );

const SNAPSHOT_DOMAINS: readonly AiBasicBuildSnapshotDomain[] = [
  'build',
  'profiles',
  'mods',
  'mod-order',
  'plugins',
  'downloads',
  'operations'
];

const snapshotTool = (
  snapshot: AiBuildContextSnapshot | undefined,
  toolName: AiReadOnlyBuildToolName
) => snapshot?.tools.find((tool) => tool.toolName === toolName);

const snapshotPageItems = (
  snapshot: AiBuildContextSnapshot | undefined,
  toolName: AiReadOnlyBuildToolName
): unknown[] => snapshotTool(snapshot, toolName)?.page?.items ?? [];

const snapshotRecords = (
  snapshot: AiBuildContextSnapshot | undefined,
  toolName: AiReadOnlyBuildToolName
): Record<string, unknown>[] => snapshotPageItems(snapshot, toolName).filter(isRecord);

const snapshotStrings = (
  snapshot: AiBuildContextSnapshot | undefined,
  toolName: AiReadOnlyBuildToolName
): string[] =>
  snapshotPageItems(snapshot, toolName).filter((item): item is string => typeof item === 'string');

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }

  return value;
};

const stableJson = (value: unknown): string => JSON.stringify(stableValue(value));

const asComparableRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'string' ? { name: value } : isRecord(value) ? value : { value };

const stringField = (record: Record<string, unknown>, names: string[]): string | undefined => {
  for (const name of names) {
    const value = record[name];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const snapshotItemId = (domain: AiBasicBuildSnapshotDomain, item: unknown): string => {
  const record = asComparableRecord(item);
  const id =
    domain === 'profiles'
      ? stringField(record, ['name'])
      : domain === 'mod-order' || domain === 'plugins'
        ? stringField(record, ['orderId', 'id', 'name', 'label'])
        : stringField(record, ['id', 'name', 'fileName']);
  return id ?? stableJson(record);
};

const snapshotItemLabel = (domain: AiBasicBuildSnapshotDomain, item: unknown): string => {
  const record = asComparableRecord(item);
  return (
    stringField(record, ['label', 'name', 'fileName', 'orderId', 'id']) ??
    `${domain} item ${snapshotItemId(domain, item)}`
  );
};

const changedFieldNames = (
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => stableJson(before[key]) !== stableJson(after[key]))
    .slice(0, 6);

const diffCollection = (
  domain: AiBasicBuildSnapshotDomain,
  sourceTool: AiReadOnlyBuildToolName,
  beforeItems: unknown[],
  afterItems: unknown[]
): AiBasicBuildDiffChange[] => {
  const beforeById = new Map(beforeItems.map((item) => [snapshotItemId(domain, item), item]));
  const afterById = new Map(afterItems.map((item) => [snapshotItemId(domain, item), item]));
  const changes: AiBasicBuildDiffChange[] = [];

  for (const [id, before] of beforeById) {
    if (!afterById.has(id)) {
      const label = snapshotItemLabel(domain, before);
      changes.push({
        before,
        changeType: 'removed',
        domain,
        humanSummary: `${label} was removed from ${domain}.`,
        id,
        label,
        sourceTool
      });
      continue;
    }

    const after = afterById.get(id);
    if (stableJson(before) !== stableJson(after)) {
      const label = snapshotItemLabel(domain, after);
      const fields = changedFieldNames(asComparableRecord(before), asComparableRecord(after));
      changes.push({
        after,
        before,
        changeType: 'updated',
        domain,
        humanSummary: `${label} changed in ${domain}${fields.length ? ` (${fields.join(', ')})` : ''}.`,
        id,
        label,
        sourceTool
      });
    }
  }

  for (const [id, after] of afterById) {
    if (!beforeById.has(id)) {
      const label = snapshotItemLabel(domain, after);
      changes.push({
        after,
        changeType: 'added',
        domain,
        humanSummary: `${label} was added to ${domain}.`,
        id,
        label,
        sourceTool
      });
    }
  }

  return changes;
};

const diffToolOutput = (
  domain: AiBasicBuildSnapshotDomain,
  sourceTool: AiReadOnlyBuildToolName,
  label: string,
  beforeSnapshot: AiBuildContextSnapshot | undefined,
  afterSnapshot: AiBuildContextSnapshot | undefined
): AiBasicBuildDiffChange[] => {
  const before = snapshotTool(beforeSnapshot, sourceTool)?.output;
  const after = snapshotTool(afterSnapshot, sourceTool)?.output;
  if (stableJson(before) === stableJson(after)) {
    return [];
  }

  return [
    {
      after,
      before,
      changeType: 'updated',
      domain,
      humanSummary: `${label} changed.`,
      id: sourceTool,
      label,
      sourceTool
    }
  ];
};

const createSnapshotDiff = (
  beforeSnapshot: AiBuildContextSnapshot | undefined,
  afterSnapshot: AiBuildContextSnapshot | undefined
): AiBasicBuildDiffChange[] => [
  ...diffToolOutput('build', 'build.summary', 'Build summary', beforeSnapshot, afterSnapshot),
  ...diffCollection(
    'profiles',
    'profiles.list',
    snapshotStrings(beforeSnapshot, 'profiles.list'),
    snapshotStrings(afterSnapshot, 'profiles.list')
  ),
  ...diffCollection(
    'mods',
    'mods.installed',
    snapshotRecords(beforeSnapshot, 'mods.installed'),
    snapshotRecords(afterSnapshot, 'mods.installed')
  ),
  ...diffCollection(
    'mod-order',
    'mods.order',
    snapshotRecords(beforeSnapshot, 'mods.order'),
    snapshotRecords(afterSnapshot, 'mods.order')
  ),
  ...diffCollection(
    'plugins',
    'plugins.loadOrder',
    snapshotRecords(beforeSnapshot, 'plugins.loadOrder'),
    snapshotRecords(afterSnapshot, 'plugins.loadOrder')
  ),
  ...diffCollection(
    'downloads',
    'downloads.list',
    snapshotRecords(beforeSnapshot, 'downloads.list'),
    snapshotRecords(afterSnapshot, 'downloads.list')
  ),
  ...diffToolOutput(
    'operations',
    'operations.status',
    'Operation status',
    beforeSnapshot,
    afterSnapshot
  ),
  ...diffCollection(
    'operations',
    'operations.recentLogs',
    snapshotPageItems(beforeSnapshot, 'operations.recentLogs'),
    snapshotPageItems(afterSnapshot, 'operations.recentLogs')
  )
];

const lowerString = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const targetLeaf = (value: string): string =>
  value.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? value.toLowerCase();

const recordMatchesTarget = (record: Record<string, unknown>, target: string): boolean => {
  const normalizedTarget = target.trim().toLowerCase();
  const leaf = targetLeaf(target);
  return ['id', 'name', 'fileName', 'orderId', 'label', 'modUuid'].some((field) => {
    const value = lowerString(record[field]);
    return Boolean(value) && (value === normalizedTarget || value === leaf || normalizedTarget.includes(value));
  });
};

const duplicatesByName = (
  domain: AiBasicBuildSnapshotDomain,
  records: Record<string, unknown>[]
): string[] => {
  const counts = new Map<string, { count: number; label: string }>();
  for (const record of records) {
    const label = snapshotItemLabel(domain, record);
    const key = label.trim().toLowerCase();
    if (!key) {
      continue;
    }
    const current = counts.get(key) ?? { count: 0, label };
    counts.set(key, { count: current.count + 1, label: current.label });
  }

  return [...counts.values()]
    .filter((entry) => entry.count > 1)
    .map((entry) => `${entry.label} (${entry.count})`);
};

const missingMasterIssues = (plugins: Record<string, unknown>[]): string[] =>
  plugins.flatMap((plugin) => {
    const missingMasters = plugin.missingMasters;
    return Array.isArray(missingMasters) && missingMasters.length > 0
      ? [
          `${snapshotItemLabel('plugins', plugin)}: missing ${missingMasters
            .filter((item): item is string => typeof item === 'string')
            .join(', ')}`
        ]
      : [];
  });

const downloadLooksFailedForVerification = (download: Record<string, unknown>): boolean => {
  const status = lowerString(download.status);
  return status.includes('fail') || status.includes('error') || status.includes('blocked');
};

const check = (
  id: AiBasicBuildVerificationCheckId,
  status: AiBasicBuildVerificationCheckStatus,
  summary: string,
  issues: string[] = [],
  source: AiBasicBuildVerificationCheck['source'] = 'snapshot-diff',
  toolName?: AiSafeActionToolName
): AiBasicBuildVerificationCheck => ({
  id,
  issues,
  source,
  status,
  summary,
  ...(toolName ? { toolName } : {})
});

const createVerificationChecks = (
  afterSnapshot: AiBuildContextSnapshot | undefined,
  stepResults: AiBasicBuildStepExecutionResult[],
  machineReadableDiff: AiBasicBuildDiffChange[]
): AiBasicBuildVerificationCheck[] => {
  const postMods = snapshotRecords(afterSnapshot, 'mods.installed');
  const postModOrder = snapshotRecords(afterSnapshot, 'mods.order');
  const postPlugins = snapshotRecords(afterSnapshot, 'plugins.loadOrder');
  const postDownloads = snapshotRecords(afterSnapshot, 'downloads.list');
  const operationLogs = snapshotRecords(afterSnapshot, 'operations.recentLogs');
  const verifiedSteps = stepResults.filter((result) => result.resultStatus === 'verified');
  const failedSteps = stepResults.filter((result) => result.resultStatus === 'failed');

  const installSteps = verifiedSteps.filter((result) =>
    ['downloads.install', 'archives.install'].includes(result.step.toolName)
  );
  const modExistIssues = installSteps.flatMap((result) => {
    const output = asComparableRecord(result.output);
    const expected = stringField(output, ['id', 'name']);
    return expected && !postMods.some((mod) => recordMatchesTarget(mod, expected))
      ? [`${result.step.title}: ${expected} was not found in the post-mutation mod snapshot.`]
      : [];
  });

  const enabledSteps = verifiedSteps.filter((result) => result.step.toolName === 'mods.setEnabled');
  const enabledIssues = enabledSteps.flatMap((result) => {
    const target = stringArg(result.step, 'modPath');
    const expected = booleanArg(result.step, 'isEnabled');
    const mod = postMods.find((item) => recordMatchesTarget(item, target));
    return mod && mod.enabled === expected
      ? []
      : [`${result.step.title}: ${target} did not verify enabled=${expected} in the post snapshot.`];
  });

  const moveSteps = verifiedSteps.filter((result) => result.step.toolName === 'mods.moveOrderItem');
  const orderIssues = moveSteps.flatMap((result) => {
    const orderItemId = stringArg(result.step, 'orderItemId');
    const targetIndex = numberArg(result.step, 'targetIndex');
    const item = postModOrder.find((entry) => recordMatchesTarget(entry, orderItemId));
    return item && item.order === targetIndex
      ? []
      : [`${result.step.title}: ${orderItemId} did not verify at order ${targetIndex}.`];
  });

  const pluginOrderChanged = machineReadableDiff.some(
    (change) =>
      change.domain === 'plugins' &&
      (change.changeType === 'added' ||
        change.changeType === 'removed' ||
        (change.changeType === 'updated' &&
          (isRecord(change.before) || isRecord(change.after)) &&
          stableJson(asComparableRecord(change.before).order) !==
            stableJson(asComparableRecord(change.after).order)))
  );
  const missingMasters = missingMasterIssues(postPlugins);
  const duplicateIssues = [
    ...duplicatesByName('profiles', snapshotStrings(afterSnapshot, 'profiles.list').map((name) => ({ name }))),
    ...duplicatesByName('mods', postMods),
    ...duplicatesByName('plugins', postPlugins),
    ...duplicatesByName('downloads', postDownloads)
  ];
  const failedInstallIssues = [
    ...failedSteps
      .filter((result) => ['downloads.install', 'archives.install'].includes(result.step.toolName))
      .map((result) => `${result.step.title}: ${result.error ?? result.verification?.summary ?? 'install failed'}`),
    ...postDownloads
      .filter(downloadLooksFailedForVerification)
      .map((download) => `${snapshotItemLabel('downloads', download)}: ${String(download.status ?? 'failed')}`)
  ];
  const operationErrorIssues = [
    ...failedSteps.map((result) => `${result.step.title}: ${result.error ?? result.verification?.summary ?? 'failed'}`),
    ...operationLogs
      .filter((entry) => lowerString(entry.level) === 'error' || lowerString(entry.line).includes('error'))
      .map((entry) => String(entry.line ?? snapshotItemLabel('operations', entry)))
  ];

  return [
    check(
      'mod-exists',
      installSteps.length === 0 ? 'not-applicable' : modExistIssues.length ? 'failed' : 'passed',
      installSteps.length === 0
        ? 'No installed-mod existence check was required.'
        : modExistIssues.length
          ? 'One or more installed mods were not found in the post snapshot.'
          : 'Installed mods were found in the post snapshot.',
      modExistIssues
    ),
    check(
      'enabled-state',
      enabledSteps.length === 0 ? 'not-applicable' : enabledIssues.length ? 'failed' : 'passed',
      enabledSteps.length === 0
        ? 'No enabled-state mutation ran.'
        : enabledIssues.length
          ? 'Enabled state did not match the requested postcondition.'
          : 'Enabled state matched the requested postcondition.',
      enabledIssues,
      'snapshot-diff',
      'mods.setEnabled'
    ),
    check(
      'order-changed',
      moveSteps.length === 0 ? 'not-applicable' : orderIssues.length ? 'failed' : 'passed',
      moveSteps.length === 0
        ? 'No mod-order mutation ran.'
        : orderIssues.length
          ? 'Mod order did not match the requested postcondition.'
          : 'Mod order matched the requested postcondition.',
      orderIssues,
      'snapshot-diff',
      'mods.moveOrderItem'
    ),
    check(
      'plugin-order-changed',
      pluginOrderChanged ? 'passed' : 'not-applicable',
      pluginOrderChanged
        ? 'Plugin order changes were captured in the machine-readable diff.'
        : 'No plugin-order mutation ran.',
      []
    ),
    check(
      'missing-masters',
      missingMasters.length ? 'failed' : postPlugins.length ? 'passed' : 'not-applicable',
      missingMasters.length
        ? 'Missing masters are present in the post snapshot.'
        : postPlugins.length
          ? 'No missing masters were found in the post snapshot.'
          : 'Plugin state was not available in the post snapshot.',
      missingMasters
    ),
    check(
      'duplicate-names',
      duplicateIssues.length ? 'failed' : 'passed',
      duplicateIssues.length
        ? 'Duplicate names were found in post snapshot state.'
        : 'No duplicate profile, mod, plugin or download names were found.',
      duplicateIssues
    ),
    check(
      'failed-install',
      failedInstallIssues.length ? 'failed' : installSteps.length || postDownloads.length ? 'passed' : 'not-applicable',
      failedInstallIssues.length
        ? 'Failed install/download state was found.'
        : installSteps.length || postDownloads.length
          ? 'No failed install/download state was found.'
          : 'No install step or download state was available.',
      failedInstallIssues,
      failedSteps.some((result) => ['downloads.install', 'archives.install'].includes(result.step.toolName))
        ? 'tool-result'
        : 'snapshot-diff'
    ),
    check(
      'operation-errors',
      operationErrorIssues.length ? 'failed' : 'passed',
      operationErrorIssues.length
        ? 'Operation errors were found in step results or recent logs.'
        : 'No operation errors were found in step results or recent logs.',
      operationErrorIssues,
      operationLogs.some((entry) => lowerString(entry.level) === 'error') ? 'operation-log' : 'tool-result'
    )
  ];
};

const rollbackHookFor = (
  result: AiBasicBuildStepExecutionResult
): AiBasicBuildRollbackHook | null => {
  const step = result.step;
  if (step.permissionClass === 'read') {
    return null;
  }

  switch (step.toolName) {
    case 'projects.rename':
      return {
        automatic: false,
        hook: 'projects.rename.restore-previous-name',
        instructions: 'Use the pre-mutation project snapshot and call projects.rename with the previous build name.',
        stepId: step.id,
        supported: true,
        toolName: step.toolName
      };
    case 'profiles.create':
      return {
        automatic: false,
        hook: 'profiles.create.manual-remove-created-profile',
        instructions: 'Automatic profile deletion is not in the safe action catalog yet; remove the created profile through the UI or restore the pre-mutation profiles snapshot.',
        stepId: step.id,
        supported: false,
        toolName: step.toolName
      };
    case 'mods.createSeparator':
      return {
        automatic: false,
        hook: 'mods.deleteSeparator.remove-created-separator',
        instructions: 'Use the post-mutation separator id and call mods.deleteSeparator after approval.',
        stepId: step.id,
        supported: true,
        toolName: step.toolName
      };
    case 'mods.setEnabled':
      return {
        automatic: false,
        hook: 'mods.setEnabled.restore-previous-enabled-state',
        instructions: 'Use the pre-mutation mod snapshot and call mods.setEnabled with the previous enabled state.',
        stepId: step.id,
        supported: true,
        toolName: step.toolName
      };
    case 'mods.moveOrderItem':
      return {
        automatic: false,
        hook: 'mods.moveOrderItem.restore-previous-index',
        instructions: 'Use the pre-mutation mod-order snapshot and call mods.moveOrderItem with the previous index.',
        stepId: step.id,
        supported: true,
        toolName: step.toolName
      };
    case 'downloads.importFile':
      return {
        automatic: false,
        hook: 'downloads.delete.remove-imported-download',
        instructions: 'Use the imported download id/path and call downloads.delete only after explicit destructive approval.',
        stepId: step.id,
        supported: true,
        toolName: step.toolName
      };
    case 'downloads.install':
    case 'archives.install':
      return {
        automatic: false,
        hook: 'mods.deleteInstalled.remove-installed-mod',
        instructions: 'Use the installed mod id/path and call mods.deleteInstalled only after explicit destructive approval, or give manual recovery instructions.',
        stepId: step.id,
        supported: true,
        toolName: step.toolName
      };
    case 'mods.deleteInstalled':
      return {
        automatic: false,
        hook: 'mods.deleteInstalled.restore-from-source',
        instructions: 'Automatic rollback is unsupported after deleting files; reinstall from the source archive or restore from backup.',
        stepId: step.id,
        supported: false,
        toolName: step.toolName
      };
    case 'projects.create':
      return {
        automatic: false,
        hook: 'projects.create.manual-remove-created-build',
        instructions: 'Automatic project deletion is not in the safe action catalog yet; remove the created build through a reviewed UI flow or restore from backup.',
        stepId: step.id,
        supported: false,
        toolName: step.toolName
      };
    default:
      return {
        automatic: false,
        hook: `${step.toolName}.manual-recovery`,
        instructions: step.rollbackNote,
        stepId: step.id,
        supported: false,
        toolName: step.toolName
      };
  }
};

const createVerificationDiff = (
  operationId: string,
  beforeSnapshot: AiBuildContextSnapshot | undefined,
  afterSnapshot: AiBuildContextSnapshot | undefined,
  stepResults: AiBasicBuildStepExecutionResult[],
  now = new Date()
): AiBasicBuildVerificationDiff => {
  const machineReadableDiff = createSnapshotDiff(beforeSnapshot, afterSnapshot);
  const humanReadableDiff = machineReadableDiff.length
    ? machineReadableDiff.map((change) => change.humanSummary)
    : ['No build/profile/mod/plugin/download diff was detected.'];
  const checks = createVerificationChecks(afterSnapshot, stepResults, machineReadableDiff);
  const rollbackHooks = stepResults
    .map(rollbackHookFor)
    .filter((hook): hook is AiBasicBuildRollbackHook => Boolean(hook));
  const recoveryInstructions = [
    ...checks
      .filter((item) => item.status === 'failed')
      .map((item) => `${item.id}: ${item.issues.join(' ') || item.summary}`),
    ...rollbackHooks
      .filter((hook) => !hook.supported)
      .map((hook) => `${hook.toolName}: ${hook.instructions}`)
  ];

  return {
    afterSnapshotAt: afterSnapshot?.generatedAt,
    beforeSnapshotAt: beforeSnapshot?.generatedAt,
    checks,
    generatedAt: now.toISOString(),
    humanReadableDiff,
    machineReadableDiff,
    operationId,
    recoveryInstructions,
    rollbackHooks,
    schema: AI_BASIC_BUILD_VERIFICATION_DIFF_SCHEMA,
    snapshotDomains: SNAPSHOT_DOMAINS
  };
};

const recoveryInstructionsFor = (
  stepResults: AiBasicBuildStepExecutionResult[],
  verificationDiff?: AiBasicBuildVerificationDiff
): string[] => {
  const recovery = stepResults
    .filter((result) => result.resultStatus !== 'verified')
    .map((result) =>
      result.resultStatus === 'skipped'
        ? `${result.step.title}: waiting for explicit approval.`
        : `${result.step.title}: ${result.step.rollbackNote}`
    );
  const verificationRecovery = verificationDiff?.recoveryInstructions ?? [];
  const combined = [...recovery, ...verificationRecovery];

  return combined.length > 0
    ? [...new Set(combined)]
    : ['No recovery action is required for the verified Phase 10 run.'];
};

const buildReport = (
  operationId: string,
  status: AiBasicBuildExecutionStatus,
  stepResults: AiBasicBuildStepExecutionResult[],
  verificationDiff?: AiBasicBuildVerificationDiff
): AiBasicBuildExecutionReport => {
  const completedStepCount = stepResults.filter((result) => result.resultStatus === 'verified').length;
  const failedStepCount = stepResults.filter((result) => result.resultStatus === 'failed').length;
  const pendingApprovalStepCount = stepResults.filter(
    (result) => result.resultStatus === 'skipped'
  ).length;
  const verified = status === 'verified';

  return {
    completedStepCount,
    failedStepCount,
    humanReadableDiff: verificationDiff?.humanReadableDiff ?? [],
    machineReadableDiff: verificationDiff?.machineReadableDiff ?? [],
    operationId,
    pendingApprovalStepCount,
    recoveryInstructions: recoveryInstructionsFor(stepResults, verificationDiff),
    rollbackHooks: verificationDiff?.rollbackHooks ?? [],
    summary: verified
      ? `Verified ${completedStepCount} Phase 10 step(s).`
      : `Phase 10 run is ${status}; ${completedStepCount} verified, ${failedStepCount} failed, ${pendingApprovalStepCount} waiting for approval.`,
    verificationChecks: verificationDiff?.checks ?? [],
    verified
  };
};

export const executeAiBasicBuildPlan = async (
  api: FluxoraApi,
  plan: AiBasicBuildExecutionPlan,
  approval: AiBasicBuildExecutionApproval,
  context: AiBasicBuildExecutionContext,
  now = new Date()
): Promise<AiBasicBuildExecutionResult> => {
  const startedAt = now.toISOString();

  if (plan.blockedReasons.length > 0) {
    const stepResults: AiBasicBuildStepExecutionResult[] = [];
    const report = buildReport(plan.operationId, 'blocked', stepResults);
    return {
      completedAt: new Date().toISOString(),
      operationId: plan.operationId,
      report: {
        ...report,
        recoveryInstructions: plan.blockedReasons,
        summary: `Phase 10 plan is blocked: ${plan.blockedReasons.join(' ')}`
      },
      startedAt,
      status: 'blocked',
      stepResults
    };
  }

  const approvedMutations = plan.steps.filter(
    (step) => step.permissionClass !== 'read' && isApproved(step, approval)
  );
  const skippedApprovalSteps = plan.steps.filter(
    (step) => step.permissionClass !== 'read' && !isApproved(step, approval)
  );

  if (approvedMutations.length === 0 && skippedApprovalSteps.length > 0) {
    const stepResults = skippedApprovalSteps.map((step) => ({
      resultStatus: 'skipped' as const,
      skippedReason:
        step.permissionClass === 'destructive'
          ? 'destructive-step-by-step-approval-required'
          : 'approval-required',
      step
    }));
    return {
      completedAt: new Date().toISOString(),
      operationId: plan.operationId,
      report: buildReport(plan.operationId, 'needs-approval', stepResults),
      startedAt,
      status: 'needs-approval',
      stepResults
    };
  }

  const mutableContext: AiBasicBuildExecutionContext = { ...context };
  const preMutationSnapshot =
    approvedMutations.length > 0
      ? await collectSnapshot(api, mutableContext, plan.operationId)
      : undefined;
  const stepResults: AiBasicBuildStepExecutionResult[] = [];
  let failed = false;

  for (const step of plan.steps) {
    if (step.permissionClass !== 'read' && !isApproved(step, approval)) {
      await logExecutionTool(
        api,
        step,
        'skipped',
        plan.operationId,
        approval.approvalId,
        'warning'
      );
      stepResults.push({
        resultStatus: 'skipped',
        skippedReason:
          step.permissionClass === 'destructive'
            ? 'destructive-step-by-step-approval-required'
            : 'approval-required',
        step
      });
      continue;
    }

    try {
      await logExecutionTool(api, step, 'started', plan.operationId, approval.approvalId);
      const output = await executeStepTool(api, step, plan.operationId);
      const project = outputProject(output);
      if (project) {
        mutableContext.project = project;
      }
      const verification = verifyStepOutput(step, output);
      await logExecutionTool(
        api,
        step,
        verification.passed ? 'succeeded' : 'failed',
        plan.operationId,
        approval.approvalId,
        verification.passed ? 'info' : 'error'
      );
      stepResults.push({
        output,
        resultStatus: verification.passed ? 'verified' : 'failed',
        step,
        verification
      });
      if (!verification.passed) {
        failed = true;
        break;
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'AI tool failed.';
      await logExecutionTool(api, step, 'failed', plan.operationId, approval.approvalId, 'error');
      stepResults.push({
        error: message,
        resultStatus: 'failed',
        step,
        verification: {
          agentId: 'verification',
          checkedAt: new Date().toISOString(),
          issues: [message],
          passed: false,
          summary: message
        }
      });
      failed = true;
      break;
    }
  }

  const postMutationSnapshot =
    approvedMutations.length > 0
      ? await collectSnapshot(api, mutableContext, plan.operationId)
      : undefined;
  const verificationDiff =
    preMutationSnapshot || postMutationSnapshot
      ? createVerificationDiff(
          plan.operationId,
          preMutationSnapshot,
          postMutationSnapshot,
          stepResults
        )
      : undefined;
  const pendingApproval = stepResults.some((result) => result.resultStatus === 'skipped');
  const failedVerificationChecks =
    verificationDiff?.checks.some((check) => check.status === 'failed') ?? false;
  const status: AiBasicBuildExecutionStatus = failed || failedVerificationChecks
    ? 'partial'
    : pendingApproval
      ? 'partial'
      : 'verified';

  return {
    completedAt: new Date().toISOString(),
    operationId: plan.operationId,
    postMutationSnapshot,
    preMutationSnapshot,
    report: buildReport(plan.operationId, status, stepResults, verificationDiff),
    startedAt,
    status,
    stepResults,
    verificationDiff
  };
};
