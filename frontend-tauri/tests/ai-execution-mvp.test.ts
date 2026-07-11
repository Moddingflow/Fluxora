import { describe, expect, it, vi } from 'vitest';

import {
  createAiBasicBuildExecutionPlan,
  executeAiBasicBuildPlan
} from '../src/renderer/features/ai/ai-execution-mvp';
import type {
  FluxoraApi,
  FluxoraDownloadEntry,
  FluxoraInstalledMod,
  FluxoraModOrderItem,
  FluxoraNexusModsAuthStatus,
  FluxoraPluginOrderItem,
  FluxoraProject,
  UiLogEntry
} from '../src/shared/fluxora-api';

const project: FluxoraProject = {
  id: 'skyrim-main',
  name: 'Skyrim Main',
  templateId: 'skyrim-special-edition',
  uiTemplateId: 'skyrim',
  gameName: 'Skyrim Special Edition',
  gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
  installRootDirectory: 'C:\\Fluxora Projects',
  projectDirectory: 'C:\\Fluxora Projects\\Skyrim Main',
  configPath: 'C:\\Fluxora\\Builds\\Skyrim.json',
  paths: {
    downloadsDirectory: 'C:\\Fluxora Projects\\Skyrim Main\\downloads',
    gameDirectory: 'C:\\Games\\Skyrim',
    modsDirectory: 'C:\\Fluxora Projects\\Skyrim Main\\mods',
    profilesDirectory: 'C:\\Fluxora Projects\\Skyrim Main\\profiles'
  }
};

const renamedProject: FluxoraProject = {
  ...project,
  name: 'Skyrim AI Draft'
};

const mods: FluxoraInstalledMod[] = [
  {
    id: 'mod-a',
    name: 'Visual Pack',
    version: '1.0.0',
    latestVersion: '1.0.0',
    lastCheckedAt: '2026-06-30',
    updateStatus: 'current',
    conflictStatus: 'none',
    fileCount: 12,
    conflictingFileCount: 0,
    overwrittenFileCount: 0,
    overwritingFileCount: 0,
    isEnabled: false,
    canCheckUpdates: false,
    hasUpdate: false,
    sourceIsNexus: false,
    sourceIsModdingFlow: false,
    isLocal: true,
    isTranslation: false,
    isPatch: false,
    overwritesModIds: [],
    overwrittenByModIds: []
  }
];

const orderAfterMove: FluxoraModOrderItem[] = [
  {
    ...mods[0],
    isMod: true,
    isSeparator: false,
    kind: 'mod',
    modUuid: 'mod-a',
    order: 0,
    orderId: 'order-mod-a',
    separatorTitle: ''
  },
  {
    ...mods[0],
    id: 'separator-ai',
    isMod: false,
    isSeparator: true,
    kind: 'separator',
    modUuid: '',
    name: 'AI Setup',
    order: 1,
    orderId: 'separator-ai',
    separatorTitle: 'AI Setup'
  }
];

const orderBeforeMove: FluxoraModOrderItem[] = [
  {
    ...mods[0],
    id: 'separator-existing',
    isMod: false,
    isSeparator: true,
    kind: 'separator',
    modUuid: '',
    name: 'Existing',
    order: 0,
    orderId: 'separator-existing',
    separatorTitle: 'Existing'
  },
  {
    ...mods[0],
    isMod: true,
    isSeparator: false,
    kind: 'mod',
    modUuid: 'mod-a',
    order: 1,
    orderId: 'order-mod-a',
    separatorTitle: ''
  }
];

const plugins: FluxoraPluginOrderItem[] = [
  {
    id: 'plugin-a',
    orderId: 'plugin-a',
    kind: 'plugin',
    order: 0,
    isSeparator: false,
    isPlugin: true,
    name: 'VisualPack.esp',
    separatorTitle: '',
    extension: '.esp',
    sourceMod: 'Visual Pack',
    isEnabled: true,
    isMaster: false,
    isLight: false,
    hasLightFlag: false,
    isLocked: false,
    lockReason: '',
    missingMasters: []
  }
];

const pluginsWithMissingMasters: FluxoraPluginOrderItem[] = [
  {
    ...plugins[0],
    missingMasters: ['BaseGame.esm']
  }
];

const importedDownload: FluxoraDownloadEntry = {
  id: 'download-a',
  name: 'Visual Pack Archive',
  fileName: 'visual-pack.7z',
  localPath: 'C:\\Archives\\visual-pack.7z',
  source: 'Local',
  status: 'ready',
  sizeText: '12 MB',
  createdAtText: 'today',
  progressPercent: 100,
  progressText: '100%',
  etaText: '',
  downloadSpeedText: '',
  isDownloading: false,
  hasKnownProgress: true,
  canResume: false,
  canInstall: true,
  canDelete: true
};

const nexusStatus: FluxoraNexusModsAuthStatus = {
  isConfigured: true,
  isLinked: true,
  isPremium: true,
  hasApiKey: true,
  displayName: 'Valerii',
  userId: '1',
  message: 'Linked',
  clientId: 'client',
  redirectUri: 'http://127.0.0.1/callback',
  operationId: 'op_ai_phase10'
};

const clone = <TValue>(value: TValue): TValue => JSON.parse(JSON.stringify(value)) as TValue;

const createApi = (options: { plugins?: FluxoraPluginOrderItem[] } = {}) => {
  const operationIds: string[] = [];
  const logs: UiLogEntry[] = [];
  let currentDownloads: FluxoraDownloadEntry[] = [];
  let currentMods: FluxoraInstalledMod[] = clone(mods);
  let currentOrder: FluxoraModOrderItem[] = clone(orderBeforeMove);
  let currentPlugins: FluxoraPluginOrderItem[] = clone(options.plugins ?? plugins);
  let currentProfiles = ['Default'];
  const capture = (request?: { operationId?: string }) => {
    operationIds.push(request?.operationId ?? '');
  };
  const matchesModPath = (mod: FluxoraInstalledMod, modPath: string) =>
    mod.id === modPath ||
    mod.name === modPath ||
    modPath.toLowerCase().endsWith(mod.name.toLowerCase());

  const api = {
    ui: {
      log: vi.fn(async (entry: UiLogEntry) => {
        logs.push(entry);
      })
    },
    projects: {
      create: vi.fn(async (_request, operation) => {
        capture(operation);
        return project;
      }),
      rename: vi.fn(async (_configPath, _newName, operation) => {
        capture(operation);
        return renamedProject;
      })
    },
    profiles: {
      list: vi.fn(async (_projectDirectory, _defaultProfile, request) => {
        capture(request);
        return currentProfiles;
      }),
      create: vi.fn(async (_projectDirectory, profileName, _defaultProfile, _files, request) => {
        capture(request);
        currentProfiles = [...new Set([...currentProfiles, profileName])];
        return currentProfiles;
      })
    },
    mods: {
      listInstalled: vi.fn(async (_projectDirectory, request) => {
        capture(request);
        return currentMods;
      }),
      getOrder: vi.fn(async (_projectDirectory, _profileName, request) => {
        capture(request);
        return currentOrder;
      }),
      getFileTree: vi.fn(),
      createSeparator: vi.fn(async (_projectDirectory, _profileName, _title, _targetIndex, request) => {
        capture(request);
        const separator: FluxoraModOrderItem = {
          ...mods[0],
          id: 'separator-ai',
          isMod: false,
          isSeparator: true,
          kind: 'separator',
          modUuid: '',
          name: 'AI Setup',
          order: 1,
          orderId: 'separator-ai',
          separatorTitle: 'AI Setup'
        };
        currentOrder = [...currentOrder, separator].map((item, index) => ({
          ...item,
          order: index
        }));
        return currentOrder;
      }),
      setEnabled: vi.fn(async (_projectDirectory, modPath, isEnabled, request) => {
        capture(request);
        currentMods = currentMods.map((mod) =>
          matchesModPath(mod, modPath) ? { ...mod, isEnabled } : mod
        );
        currentOrder = currentOrder.map((item) =>
          matchesModPath(item, modPath) ? { ...item, isEnabled } : item
        );
        return { accepted: true, isEnabled, modPath, operationId: request?.operationId ?? '' };
      }),
      moveOrderItem: vi.fn(async (_projectDirectory, _profileName, _orderItemId, _targetIndex, request) => {
        capture(request);
        currentOrder = clone(orderAfterMove);
        return currentOrder;
      }),
      deleteInstalled: vi.fn(async (_projectDirectory, modPath, request) => {
        capture(request);
        currentMods = currentMods.filter((mod) => !matchesModPath(mod, modPath));
        currentOrder = currentOrder.filter((item) => !matchesModPath(item, modPath));
        return { accepted: true, modPath, operationId: request?.operationId ?? '' };
      })
    },
    plugins: {
      list: vi.fn(async (_projectDirectory, _templateId, _profileName, request) => {
        capture(request);
        return currentPlugins;
      })
    },
    downloads: {
      list: vi.fn(async (_projectDirectory, request) => {
        capture(request);
        return currentDownloads;
      }),
      importFile: vi.fn(async (_projectDirectory, _sourcePath, request) => {
        capture(request);
        currentDownloads = [importedDownload];
        return importedDownload;
      }),
      install: vi.fn(async (_installRequest, operation) => {
        capture(operation);
        currentMods = currentMods.map((mod) =>
          mod.id === 'mod-a' ? { ...mod, isEnabled: true } : mod
        );
        return {
          id: 'mod-a',
          isEnabled: true,
          name: 'Visual Pack',
          operationId: operation?.operationId ?? '',
          version: '1.0.0'
        };
      })
    },
    archives: {
      install: vi.fn(async (_installRequest, operation) => {
        capture(operation);
        currentMods = [
          ...currentMods,
          {
            ...mods[0],
            id: 'mod-local',
            name: 'Local Patch',
            version: '1.0.0',
            isEnabled: true
          }
        ];
        return {
          id: 'mod-local',
          isEnabled: true,
          name: 'Local Patch',
          operationId: operation?.operationId ?? '',
          version: '1.0.0'
        };
      })
    },
    nexus: {
      getAuthStatus: vi.fn(async (request) => {
        capture(request);
        return nexusStatus;
      })
    },
    operations: {
      getStatus: vi.fn(async (request) => {
        capture(request);
        return {
          operationId: request?.operationId ?? '',
          source: 'tauri-progress-cache',
          active: [],
          recent: [],
          message: 'No active operations.'
        };
      }),
      recentLogs: vi.fn(async (_options, request) => {
        capture(request);
        return {
          operationId: request?.operationId ?? '',
          entries: [],
          logPaths: [],
          maxEntries: 20,
          truncated: false
        };
      })
    }
  } as unknown as FluxoraApi;

  return { api, logs, operationIds };
};

describe('AI Phase 10 basic build execution MVP', () => {
  it('creates an explicit plan covering the Phase 10 basic build scenarios', () => {
    const plan = createAiBasicBuildExecutionPlan(
      {
        checkPluginState: true,
        createProfile: { profileName: 'AI Test' },
        createProject: {
          gamePath: project.gamePath,
          installRootDirectory: project.installRootDirectory,
          projectName: 'Skyrim AI Draft',
          templateId: project.templateId
        },
        createSeparator: { targetIndex: 1, title: 'AI Setup' },
        deleteInstalledMod: { modPath: 'mods\\Visual Pack' },
        importLocalArchive: { sourcePath: 'C:\\Archives\\visual-pack.7z' },
        installDownloadedMod: {
          downloadPath: importedDownload.localPath,
          modName: 'Visual Pack',
          projectDirectory: project.projectDirectory
        },
        moveMod: { orderItemId: 'order-mod-a', targetIndex: 0 },
        project,
        renameBuild: { newName: 'Skyrim AI Draft' },
        setModEnabled: { isEnabled: true, modPath: 'mods\\Visual Pack' }
      },
      'op_ai_phase10',
      new Date('2026-06-30T08:00:00Z')
    );

    expect(plan.schema).toBe('fluxora.ai.basic-build-execution-plan.v1');
    expect(plan.blockedReasons).toEqual([]);
    expect(plan.approval).toMatchObject({
      planMustBeVisibleBeforeMutation: true,
      destructiveApprovalMode: 'step-by-step',
      modelTextCanApproveActions: false
    });
    expect(plan.snapshot.beforeMutationRequired).toBe(true);
    expect(plan.snapshot.domains).toEqual([
      'build',
      'profiles',
      'mods',
      'mod-order',
      'plugins',
      'downloads',
      'operations'
    ]);
    expect(plan.verification).toMatchObject({
      afterEachMutation: true,
      finalReportAfterVerification: true,
      missingMastersCheckIncluded: true,
      verificationAgentId: 'verification'
    });
    expect(plan.steps.map((step) => step.toolName)).toEqual([
      'projects.create',
      'projects.rename',
      'profiles.create',
      'mods.createSeparator',
      'mods.setEnabled',
      'mods.moveOrderItem',
      'downloads.importFile',
      'downloads.install',
      'mods.deleteInstalled',
      'plugins.list'
    ]);
    expect(plan.steps.find((step) => step.toolName === 'mods.deleteInstalled')).toMatchObject({
      approvalMode: 'step-by-step',
      permissionClass: 'destructive'
    });
  });

  it('executes approved safe actions sequentially, snapshots state and skips destructive actions without step approval', async () => {
    const { api, logs, operationIds } = createApi();
    const plan = createAiBasicBuildExecutionPlan(
      {
        checkPluginState: true,
        createProfile: { profileName: 'AI Test' },
        createSeparator: { targetIndex: 1, title: 'AI Setup' },
        deleteInstalledMod: { modPath: 'mods\\Visual Pack' },
        importLocalArchive: { sourcePath: 'C:\\Archives\\visual-pack.7z' },
        installDownloadedMod: {
          downloadPath: importedDownload.localPath,
          modName: 'Visual Pack',
          projectDirectory: project.projectDirectory
        },
        moveMod: { orderItemId: 'order-mod-a', targetIndex: 0 },
        project,
        renameBuild: { newName: 'Skyrim AI Draft' },
        setModEnabled: { isEnabled: true, modPath: 'mods\\Visual Pack' }
      },
      'op_ai_phase10',
      new Date('2026-06-30T08:05:00Z')
    );

    const result = await executeAiBasicBuildPlan(
      api,
      plan,
      { approvalId: 'approval-safe', approveAllSafeActions: true },
      { defaultProfileName: 'Default', profileName: 'Default', project },
      new Date('2026-06-30T08:06:00Z')
    );

    expect(result.status).toBe('partial');
    expect(result.preMutationSnapshot?.operationId).toBe('op_ai_phase10');
    expect(result.postMutationSnapshot?.operationId).toBe('op_ai_phase10');
    expect(result.verificationDiff).toMatchObject({
      operationId: 'op_ai_phase10',
      schema: 'fluxora.ai.basic-build-verification-diff.v1'
    });
    expect(result.verificationDiff?.snapshotDomains).toEqual(plan.snapshot.domains);
    expect(result.report.humanReadableDiff).toEqual(
      expect.arrayContaining([
        expect.stringContaining('AI Test was added to profiles'),
        expect.stringContaining('Visual Pack changed in mods'),
        expect.stringContaining('AI Setup was added to mod-order'),
        expect.stringContaining('Visual Pack Archive was added to downloads')
      ])
    );
    expect(result.report.machineReadableDiff.map((change) => change.domain)).toEqual(
      expect.arrayContaining(['profiles', 'mods', 'mod-order', 'downloads'])
    );
    expect(result.report.verificationChecks.map((check) => check.id)).toEqual([
      'mod-exists',
      'enabled-state',
      'order-changed',
      'plugin-order-changed',
      'missing-masters',
      'duplicate-names',
      'failed-install',
      'operation-errors'
    ]);
    expect(result.report.verificationChecks.find((check) => check.id === 'enabled-state')).toMatchObject({
      status: 'passed'
    });
    expect(result.report.verificationChecks.find((check) => check.id === 'order-changed')).toMatchObject({
      status: 'passed'
    });
    expect(result.report.verificationChecks.find((check) => check.id === 'missing-masters')).toMatchObject({
      status: 'passed'
    });
    expect(result.report.rollbackHooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          automatic: false,
          hook: 'mods.setEnabled.restore-previous-enabled-state',
          supported: true,
          toolName: 'mods.setEnabled'
        }),
        expect.objectContaining({
          automatic: false,
          supported: false,
          toolName: 'profiles.create'
        })
      ])
    );
    expect(result.stepResults.filter((step) => step.resultStatus === 'verified')).toHaveLength(8);
    expect(result.stepResults.find((step) => step.step.toolName === 'mods.deleteInstalled')).toMatchObject({
      resultStatus: 'skipped',
      skippedReason: 'destructive-step-by-step-approval-required'
    });
    expect(api.mods.deleteInstalled).not.toHaveBeenCalled();
    expect(api.projects.rename).toHaveBeenCalledWith(
      project.configPath,
      'Skyrim AI Draft',
      { operationId: 'op_ai_phase10' }
    );
    expect(logs.some((entry) => entry.message.includes('tool=mods.deleteInstalled') && entry.message.includes('phase=skipped'))).toBe(true);
    expect(logs.every((entry) => entry.operationId === 'op_ai_phase10')).toBe(true);
    expect(operationIds.every((operationId) => operationId === 'op_ai_phase10')).toBe(true);
    expect(result.report.summary).toContain('waiting for approval');
    expect(result.report.recoveryInstructions).toContain('Delete an installed mod: waiting for explicit approval.');
    expect(result.report.recoveryInstructions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('profiles.create: Automatic profile deletion is not in the safe action catalog yet')
      ])
    );
  });

  it('runs destructive deletion only when its exact step is approved', async () => {
    const { api } = createApi();
    const plan = createAiBasicBuildExecutionPlan(
      {
        deleteInstalledMod: {
          modPath: 'mods\\Visual Pack',
          projectDirectory: project.projectDirectory
        },
        project
      },
      'op_ai_delete_mod',
      new Date('2026-06-30T08:10:00Z')
    );
    const deleteStep = plan.steps.find((step) => step.toolName === 'mods.deleteInstalled');

    const result = await executeAiBasicBuildPlan(
      api,
      plan,
      { approvalId: 'approval-delete-step', approvedStepIds: [deleteStep?.id ?? ''] },
      { defaultProfileName: 'Default', profileName: 'Default', project },
      new Date('2026-06-30T08:11:00Z')
    );

    expect(result.status).toBe('verified');
    expect(result.report.verified).toBe(true);
    expect(result.report.rollbackHooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          supported: false,
          toolName: 'mods.deleteInstalled'
        })
      ])
    );
    expect(api.mods.deleteInstalled).toHaveBeenCalledWith(
      project.projectDirectory,
      'mods\\Visual Pack',
      { operationId: 'op_ai_delete_mod' }
    );
    expect(result.stepResults[0]?.verification?.summary).toContain('explicitly approved');
  });

  it('returns partial state instead of done when Phase 11 verification finds missing masters', async () => {
    const { api } = createApi({ plugins: pluginsWithMissingMasters });
    const plan = createAiBasicBuildExecutionPlan(
      {
        checkPluginState: true,
        project,
        setModEnabled: { isEnabled: true, modPath: 'mods\\Visual Pack' }
      },
      'op_ai_missing_masters',
      new Date('2026-06-30T08:12:00Z')
    );

    const result = await executeAiBasicBuildPlan(
      api,
      plan,
      { approvalId: 'approval-safe', approveAllSafeActions: true },
      { defaultProfileName: 'Default', profileName: 'Default', project },
      new Date('2026-06-30T08:13:00Z')
    );

    expect(result.status).toBe('partial');
    expect(result.report.verified).toBe(false);
    expect(result.report.verificationChecks.find((check) => check.id === 'missing-masters')).toMatchObject({
      status: 'failed',
      issues: [expect.stringContaining('BaseGame.esm')]
    });
    expect(result.report.summary).not.toContain('Verified');
    expect(result.report.recoveryInstructions).toEqual(
      expect.arrayContaining([expect.stringContaining('missing-masters')])
    );
  });

  it('blocks missing required targets instead of guessing mutation arguments', async () => {
    const { api } = createApi();
    const plan = createAiBasicBuildExecutionPlan(
      {
        createProfile: { profileName: 'AI Test' }
      },
      'op_ai_missing_context',
      new Date('2026-06-30T08:15:00Z')
    );

    const result = await executeAiBasicBuildPlan(
      api,
      plan,
      { approvalId: 'approval-missing', approveAllSafeActions: true },
      { project: null },
      new Date('2026-06-30T08:16:00Z')
    );

    expect(plan.blockedReasons).toEqual(['profiles.create requires projectDirectory.']);
    expect(result.status).toBe('blocked');
    expect(result.report.summary).toContain('profiles.create requires projectDirectory');
    expect(api.profiles.create).not.toHaveBeenCalled();
  });
});
