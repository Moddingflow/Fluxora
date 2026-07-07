import { describe, expect, it, vi } from 'vitest';

import {
  AI_READ_ONLY_BUILD_TOOLS,
  collectAiBuildContext,
  runAiBuildTool,
  serializeAiBuildContextSnapshot,
  shouldCollectAnalyzeTextFiles
} from '../src/renderer/features/ai/ai-build-tools';
import {
  buildAiLocalInspectionFromContext,
  validateAiModResearchPipelineDto
} from '../src/shared/ai-mod-research-pipeline';
import type {
  FluxoraApi,
  FluxoraDownloadEntry,
  FluxoraInstalledMod,
  FluxoraModFileTreeEntry,
  FluxoraModOrderItem,
  FluxoraNexusModsAuthStatus,
  FluxoraPluginOrderItem,
  FluxoraProject,
  OperationRequest,
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

const installedMods: FluxoraInstalledMod[] = [
  {
    id: 'mod-a',
    name: 'Visual Pack',
    version: '1.0.0',
    latestVersion: '1.1.0',
    lastCheckedAt: '2026-06-30',
    updateStatus: 'update available',
    conflictStatus: 'overwrites files',
    fileCount: 12,
    conflictingFileCount: 2,
    overwrittenFileCount: 1,
    overwritingFileCount: 1,
    isEnabled: true,
    canCheckUpdates: true,
    hasUpdate: true,
    sourceIsNexus: true,
    sourceIsModdingFlow: false,
    sourceProvider: 'nexus',
    sourceGameDomain: 'skyrimspecialedition',
    sourceModId: '123',
    sourceFileId: '456',
    sourceUrl: 'https://www.nexusmods.com/skyrimspecialedition/mods/123?tab=files&file_id=456',
    isLocal: false,
    isTranslation: false,
    isPatch: false,
    overwritesModIds: [],
    overwrittenByModIds: []
  },
  {
    id: 'mod-b',
    name: 'Audio Fix',
    version: '1.0.0',
    latestVersion: '1.0.0',
    lastCheckedAt: '2026-06-30',
    updateStatus: 'current',
    conflictStatus: 'none',
    fileCount: 3,
    conflictingFileCount: 0,
    overwrittenFileCount: 0,
    overwritingFileCount: 0,
    isEnabled: false,
    canCheckUpdates: false,
    hasUpdate: false,
    sourceIsNexus: false,
    sourceIsModdingFlow: false,
    sourceProvider: '',
    sourceGameDomain: '',
    sourceModId: '',
    sourceFileId: '',
    sourceUrl: '',
    isLocal: true,
    isTranslation: false,
    isPatch: true,
    overwritesModIds: [],
    overwrittenByModIds: []
  }
];

const createModOrderItems = (mods: FluxoraInstalledMod[]): FluxoraModOrderItem[] =>
  mods.map((mod, index) => ({
    ...mod,
    isMod: true,
    isSeparator: false,
    kind: 'mod',
    modUuid: mod.id,
    order: index,
    orderId: `order-${mod.id}`,
    separatorTitle: ''
  }));

const modOrder: FluxoraModOrderItem[] = createModOrderItems(installedMods);

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
    missingMasters: ['BaseGame.esm']
  }
];

const createInstalledModFixture = (index: number): FluxoraInstalledMod => {
  const base = installedMods[index % installedMods.length] ?? installedMods[0]!;
  return {
    ...base,
    conflictStatus: 'none',
    conflictingFileCount: 0,
    hasUpdate: false,
    id: `mod-${String(index).padStart(3, '0')}`,
    isEnabled: index % 5 !== 0,
    latestVersion: base.version,
    name: `Large Mod ${index}`,
    overwrittenFileCount: 0,
    overwritingFileCount: 0,
    updateStatus: 'current'
  };
};

const createPluginFixture = (index: number): FluxoraPluginOrderItem => {
  const base = plugins[0]!;
  return {
    ...base,
    id: `plugin-${String(index).padStart(3, '0')}`,
    isEnabled: index % 7 !== 0,
    missingMasters: [],
    name: `LargePlugin${index}.esp`,
    order: index,
    orderId: `plugin-${String(index).padStart(3, '0')}`,
    sourceMod: `Large Mod ${index}`
  };
};

const downloads: FluxoraDownloadEntry[] = [
  {
    id: 'download-a',
    name: 'Visual Pack Archive',
    fileName: 'visual-pack.7z',
    localPath: 'C:\\Downloads\\visual-pack.7z',
    source: 'Nexus',
    status: 'failed',
    sizeText: '12 MB',
    createdAtText: 'today',
    progressPercent: 50,
    progressText: '50%',
    etaText: '',
    downloadSpeedText: '',
    isDownloading: false,
    hasKnownProgress: true,
    canResume: true,
    canInstall: false,
    canDelete: true
  }
];

const fileTree: FluxoraModFileTreeEntry[] = [
  {
    name: 'meshes',
    relativePath: 'meshes',
    isDirectory: true,
    hasChildren: true,
    size: 0,
    conflictState: 'none',
    conflictOwners: []
  }
];

const nexusStatus: FluxoraNexusModsAuthStatus = {
  isConfigured: true,
  isLinked: false,
  hasApiKey: false,
  displayName: '',
  userId: '',
  message: 'Not linked',
  clientId: 'client',
  redirectUri: 'http://127.0.0.1/callback',
  operationId: 'op_ai_build_context'
};

interface ApiFixtures {
  downloads?: FluxoraDownloadEntry[];
  fileTree?: FluxoraModFileTreeEntry[];
  installedMods?: FluxoraInstalledMod[];
  modOrder?: FluxoraModOrderItem[];
  plugins?: FluxoraPluginOrderItem[];
  profiles?: string[];
}

const createApi = (fixtures: ApiFixtures = {}) => {
  const operationIds: string[] = [];
  const logs: UiLogEntry[] = [];
  const fixtureDownloads = fixtures.downloads ?? downloads;
  const fixtureFileTree = fixtures.fileTree ?? fileTree;
  const fixtureInstalledMods = fixtures.installedMods ?? installedMods;
  const fixtureModOrder = fixtures.modOrder ?? modOrder;
  const fixturePlugins = fixtures.plugins ?? plugins;
  const fixtureProfiles = fixtures.profiles ?? ['Default', 'Testing'];
  const capture = (request?: OperationRequest) => {
    operationIds.push(request?.operationId ?? '');
  };

  const api = {
    ui: {
      log: vi.fn(async (entry: UiLogEntry) => {
        logs.push(entry);
      })
    },
    mods: {
      listInstalled: vi.fn(async (_projectDirectory: string, request?: OperationRequest) => {
        capture(request);
        return fixtureInstalledMods;
      }),
      getOrder: vi.fn(async (_projectDirectory: string, _profile?: string, request?: OperationRequest) => {
        capture(request);
        return fixtureModOrder;
      }),
      getFileTree: vi.fn(
        async (
          _projectDirectory: string,
          _modPath: string,
          _relativeDirectory?: string,
          request?: OperationRequest
        ) => {
          capture(request);
          return fixtureFileTree;
        }
      ),
      previewTextFile: vi.fn(
        async (
          _projectDirectory: string,
          modPath: string,
          relativePath: string,
          maxBytes: number,
          request?: OperationRequest
        ) => {
          capture(request);
          const content = 'RaceMenu requires SKSE and Address Library.\nUse the matching runtime.\n';
          const preview = content.slice(0, Math.min(content.length, maxBytes));
          return {
            path: `${modPath}\\${relativePath}`,
            fileName: relativePath.split(/[\\/]/).pop() ?? 'README.txt',
            contentPreview: preview,
            bytesRead: preview.length,
            size: content.length + maxBytes,
            truncated: true,
            relativePath,
            operationId: request?.operationId ?? 'op_ai_preview'
          };
        }
      )
    },
    plugins: {
      list: vi.fn(
        async (
          _projectDirectory: string,
          _templateId: string,
          _profile?: string,
          request?: OperationRequest
        ) => {
          capture(request);
          return fixturePlugins;
        }
      )
    },
    profiles: {
      list: vi.fn(async (_projectDirectory: string, _defaultProfile?: string, request?: OperationRequest) => {
        capture(request);
        return fixtureProfiles;
      }),
      previewTextFile: vi.fn(
        async (
          _projectDirectory: string,
          profileName: string,
          fileName: string,
          maxBytes: number,
          request?: OperationRequest
        ) => {
          capture(request);
          const content = '*Skyrim.esm\n*RaceMenu.esp\n';
          const preview = content.slice(0, Math.min(content.length, maxBytes));
          return {
            path: `C:\\Fluxora Projects\\Skyrim Main\\profiles\\${profileName}\\${fileName}`,
            fileName,
            contentPreview: preview,
            bytesRead: preview.length,
            size: content.length,
            truncated: false,
            relativePath: `${profileName}/${fileName}`,
            operationId: request?.operationId ?? 'op_ai_profile_preview'
          };
        }
      )
    },
    downloads: {
      list: vi.fn(async (_projectDirectory: string, request?: OperationRequest) => {
        capture(request);
        return fixtureDownloads;
      })
    },
    nexus: {
      getAuthStatus: vi.fn(async (request?: OperationRequest) => {
        capture(request);
        return nexusStatus;
      })
    },
    operations: {
      getStatus: vi.fn(async (request?: OperationRequest) => {
        capture(request);
        return {
          operationId: request?.operationId ?? 'op_ai_build_context',
          source: 'tauri-progress-cache',
          active: [],
          recent: [],
          message: 'No active operations.'
        };
      }),
      recentLogs: vi.fn(async (_options: unknown, request?: OperationRequest) => {
        capture(request);
        return {
          operationId: request?.operationId ?? 'op_ai_build_context',
          entries: [],
          logPaths: ['fluxora-tauri-ui-current.log'],
          maxEntries: 20,
          truncated: false
        };
      })
    }
  } as unknown as FluxoraApi;

  return { api, logs, operationIds };
};

describe('AI read-only build tools', () => {
  it('collects compact paged build context through read-only facade calls', async () => {
    const { api, logs, operationIds } = createApi();
    const snapshot = await collectAiBuildContext(
      api,
      {
        defaultProfileName: 'Default',
        limit: 1,
        profileName: 'Testing',
        project,
        selectedModId: 'mod-a',
        selectedModName: 'Visual Pack'
      },
      'op_ai_build_context'
    );

    expect(snapshot.tools.map((tool) => tool.toolName)).toEqual(
      AI_READ_ONLY_BUILD_TOOLS.map((tool) => tool.name)
    );
    expect(snapshot.tools.every((tool) => tool.permissionClass === 'read')).toBe(true);
    expect(snapshot.tools.find((tool) => tool.toolName === 'mods.installed')?.page?.nextCursor).toBe('1');
    expect(snapshot.tools.find((tool) => tool.toolName === 'mods.fileTree')?.page?.items).toHaveLength(1);
    expect(snapshot.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'mods.file-overwrite-review',
        'plugins.missing-masters',
        'downloads.failed',
        'nexus.not-linked',
        'tool.page-sampled'
      ])
    );
    expect(operationIds.every((operationId) => operationId === 'op_ai_build_context')).toBe(true);
    expect(logs.every((entry) => entry.operationId === 'op_ai_build_context')).toBe(true);
    expect(logs.map((entry) => entry.category)).toContain('AI.Tool');

    const installedPageItem = snapshot.tools.find((tool) => tool.toolName === 'mods.installed')?.page
      ?.items?.[0] as
      | {
          nexus?: {
            fileId?: string;
            gameDomain: string;
            modId: string;
            pageUrl: string;
            provider: string;
            sourceUrl?: string;
          };
        }
      | undefined;
    const orderPageItem = snapshot.tools.find((tool) => tool.toolName === 'mods.order')?.page
      ?.items?.[0] as typeof installedPageItem;
    expect(installedPageItem?.nexus).toMatchObject({
      fileId: '456',
      gameDomain: 'skyrimspecialedition',
      modId: '123',
      pageUrl: 'https://www.nexusmods.com/skyrimspecialedition/mods/123',
      provider: 'nexus',
      sourceUrl: 'https://www.nexusmods.com/skyrimspecialedition/mods/123?tab=files&file_id=456'
    });
    expect(orderPageItem?.nexus).toMatchObject(installedPageItem?.nexus ?? {});

    const buildSummary = snapshot.tools.find((tool) => tool.toolName === 'build.summary')?.output as {
      plugins?: {
        fullPluginSlots?: { active: number; limit: number };
        lightPluginSlots?: { active: number; limit: number };
        missingMasterDetails?: Array<{ missingMasters: string[]; pluginName: string; sourceMod: string }>;
      };
    };
    const pluginTool = snapshot.tools.find((tool) => tool.toolName === 'plugins.loadOrder')?.output as {
      slotSummary?: {
        full?: { active: number; limit: number };
        light?: { active: number; limit: number };
        missingMasterDetails?: Array<{ missingMasters: string[]; pluginName: string; sourceMod: string }>;
      };
    };
    const pluginCheckTool = snapshot.tools.find((tool) => tool.toolName === 'local.check_plugins')?.output as {
      missing_masters?: Array<{ missing: string[]; plugin: string; source_mod: string }>;
      plugin_count?: { esm: number; esp: number; esl: number };
      profile_id?: string | null;
      schema?: string;
    };
    expect(buildSummary.plugins?.fullPluginSlots).toMatchObject({ active: 1, limit: 254 });
    expect(buildSummary.plugins?.lightPluginSlots).toMatchObject({ active: 0, limit: 4096 });
    expect(buildSummary.plugins?.missingMasterDetails?.[0]).toMatchObject({
      missingMasters: ['BaseGame.esm'],
      pluginName: 'VisualPack.esp',
      sourceMod: 'Visual Pack'
    });
    expect(pluginTool.slotSummary?.missingMasterDetails?.[0]).toMatchObject({
      pluginName: 'VisualPack.esp',
      sourceMod: 'Visual Pack'
    });
    expect(pluginCheckTool).toMatchObject({
      missing_masters: [
        expect.objectContaining({
          missing: ['BaseGame.esm'],
          plugin: 'VisualPack.esp',
          source_mod: 'Visual Pack'
        })
      ],
      plugin_count: { esm: 0, esp: 1, esl: 0 },
      profile_id: 'Testing',
      schema: 'fluxora.ai.local-check-plugins.v1'
    });

    const serialized = serializeAiBuildContextSnapshot(snapshot);
    expect(serialized).toContain('fluxora.ai.build-context.v1');
    expect(serialized).toContain('No write, destructive, credential, shell, raw filesystem, or external-network tools');
    expect(serialized).toContain('local.check_plugins');
    expect(serialized).toContain('fluxora.ai.local-check-plugins.v1');
    expect(serialized).toContain('local.filesystemSnapshot');
    expect(serialized).toContain('local.detect_skse_plugins');
    expect(serialized).toContain('"schema": "fluxora.ai.local-filesystem-snapshot.v1"');
    expect(serialized).toContain('mods.order is the actual left-panel installed mod priority order');
    expect(serialized).toContain('downloads.list is only the downloaded archive queue');
    expect(serialized).toContain('mod overwrite data is loose-file/VFS overwrite state');
    expect(serialized).toContain('Raw overwrite counts are file counts');
    expect(serialized).toContain('"conflictEvidence"');
    expect(serialized).toContain('build.summary.conflictEvidence contains bounded file-owner evidence');
    expect(serialized).toContain('hasLightFlag=true are light plugins');
    expect(serialized).toContain('do not compare total plugin count to the full plugin limit');
    expect(serialized).toContain('"fullPluginSlots"');
    expect(serialized).toContain('"lightPluginSlots"');
    expect(serialized).toContain('"sourceMod": "Visual Pack"');
    expect(serialized).toContain('"nexus"');
    expect(serialized).toContain('"gameDomain": "skyrimspecialedition"');
    expect(serialized).toContain('"modId": "123"');
    expect(serialized).toContain('"overwrite"');
    expect(serialized).toContain('"updateCheckStatus"');
    expect(serialized).toContain('"inventoryRole": "download-archive-queue"');
    expect(serialized).toContain('Treat page items as a sample, not the complete build.');
  });

  it('returns partial context when preflight budget is exhausted before expensive file-tree evidence', async () => {
    const { api, logs } = createApi();
    const snapshot = await collectAiBuildContext(
      api,
      {
        defaultProfileName: 'Default',
        profileName: 'Testing',
        project,
        selectedModId: 'mod-a',
        selectedModName: 'Visual Pack'
      },
      'op_ai_preflight_budget',
      { budgetMs: 0 }
    );

    const summary = snapshot.tools.find((tool) => tool.toolName === 'build.summary');
    const summaryOutput = summary?.output as
      | {
          conflictEvidence?: {
            budgetExhausted?: boolean;
            scannedModCount?: number;
            truncated?: boolean;
          };
        }
      | undefined;

    expect(api.mods.getFileTree).not.toHaveBeenCalled();
    expect(summaryOutput?.conflictEvidence).toMatchObject({
      budgetExhausted: true,
      scannedModCount: 0,
      truncated: true
    });
    expect(summary?.issues.map((item) => item.code)).toContain('tool.preflight-budget-exhausted');
    expect(snapshot.tools.find((tool) => tool.toolName === 'mods.installed')?.issues[0]?.code).toBe(
      'tool.preflight-budget-exhausted'
    );
    expect(logs.some((entry) => entry.message === 'tool=mods.installed permission=read phase=skipped')).toBe(
      true
    );
  });

  it('builds deterministic local inspection findings for missing masters with source ids', async () => {
    const { api } = createApi();
    const snapshot = await collectAiBuildContext(
      api,
      {
        defaultProfileName: 'Default',
        profileName: 'Testing',
        project
      },
      'op_ai_missing_master_inspection'
    );

    const inspection = buildAiLocalInspectionFromContext({
      buildSnapshot: snapshot,
      generatedAt: '2026-07-02T10:00:00.000Z',
      operationId: 'op_ai_missing_master_inspection'
    });
    const missingMasterFinding = inspection.deterministicFindings.find((finding) =>
      finding.claim.includes('missing masters')
    );

    expect(validateAiModResearchPipelineDto(inspection)).toEqual({ ok: true, errors: [] });
    expect(missingMasterFinding).toMatchObject({
      deterministic: true,
      relevantMods: ['Visual Pack']
    });
    expect(missingMasterFinding?.claim).toContain('VisualPack.esp');
    expect(missingMasterFinding?.claim).toContain('Visual Pack');
    expect(missingMasterFinding?.claim).toContain('BaseGame.esm');
    expect(missingMasterFinding?.evidenceIds).toEqual(
      expect.arrayContaining(['source:plugins-loadorder:op-ai-missing-master-inspection'])
    );
    expect(inspection.suspect_mods.length).toBeGreaterThan(0);
    expect(inspection.suspect_mods.length).toBeLessThanOrEqual(12);
  });

  it('keeps aggregate overwrite counts out of exact pairwise conflict findings without file-owner evidence', async () => {
    const aggregateOnlyMod: FluxoraInstalledMod = {
      ...installedMods[0],
      conflictingFileCount: 4,
      conflictStatus: 'needs review',
      id: 'mod-overwrite-aggregate',
      name: 'Aggregate Only Visual Pack',
      overwrittenFileCount: 2,
      overwritingFileCount: 1
    };
    const { api } = createApi({
      downloads: [],
      fileTree: [
        {
          name: 'texture.dds',
          relativePath: 'textures/texture.dds',
          isDirectory: false,
          hasChildren: false,
          size: 4096,
          conflictState: 'none',
          conflictOwners: []
        }
      ],
      installedMods: [aggregateOnlyMod],
      modOrder: createModOrderItems([aggregateOnlyMod]),
      plugins: []
    });
    const snapshot = await collectAiBuildContext(
      api,
      {
        defaultProfileName: 'Default',
        profileName: 'Testing',
        project
      },
      'op_ai_aggregate_overwrite'
    );

    const inspection = buildAiLocalInspectionFromContext({
      buildSnapshot: snapshot,
      generatedAt: '2026-07-02T10:00:00.000Z',
      operationId: 'op_ai_aggregate_overwrite'
    });

    expect(inspection.deterministicFindings.some((finding) =>
      finding.claim.includes('Concrete file-owner conflict evidence')
    )).toBe(false);
    expect(inspection.hypotheses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relevantMods: ['Aggregate Only Visual Pack']
        })
      ])
    );
    expect(inspection.hypotheses[0]?.falsifiableBy).toContain('conflictEvidence');
  });

  it('turns failed downloads or install operations into local deterministic findings without web', async () => {
    const { api } = createApi({
      plugins: []
    });
    const snapshot = await collectAiBuildContext(
      api,
      {
        defaultProfileName: 'Default',
        profileName: 'Testing',
        project
      },
      'op_ai_failed_download_inspection'
    );

    const inspection = buildAiLocalInspectionFromContext({
      buildSnapshot: snapshot,
      generatedAt: '2026-07-02T10:00:00.000Z',
      operationId: 'op_ai_failed_download_inspection'
    });
    const failedFinding = inspection.deterministicFindings.find((finding) =>
      finding.claim.includes('failed locally')
    );

    expect(failedFinding?.claim).toContain('Visual Pack Archive');
    expect(failedFinding?.evidenceIds).toEqual(
      expect.arrayContaining(['source:downloads-list:op-ai-failed-download-inspection'])
    );
    expect(inspection.evidenceCards.every((card) => card.sourceType !== 'public-web')).toBe(true);
    expect(inspection.evidenceCards.every((card) => card.instructionsAllowed === false)).toBe(true);
  });

  it('treats local.read_text_file content as untrusted diagnostic data and never policy', async () => {
    const raceMenu: FluxoraInstalledMod = {
      ...installedMods[0],
      id: 'C:\\Fluxora Projects\\Skyrim Main\\mods\\RaceMenu',
      name: 'RaceMenu',
      version: '0.4.19.16'
    };
    const { api } = createApi({
      downloads: [],
      fileTree: [
        {
          name: 'README.txt',
          relativePath: 'README.txt',
          isDirectory: false,
          hasChildren: false,
          size: 78000,
          conflictState: 'none',
          conflictOwners: []
        }
      ],
      installedMods: [raceMenu],
      modOrder: createModOrderItems([raceMenu]),
      plugins: []
    });

    const snapshot = await collectAiBuildContext(
      api,
      {
        defaultProfileName: 'Default',
        profileName: 'Testing',
        project,
        prompt: 'Проанализируй сборку, она крашит. Проверь README.txt.'
      },
      'op_ai_untrusted_text_inspection'
    );
    const inspection = buildAiLocalInspectionFromContext({
      buildSnapshot: snapshot,
      generatedAt: '2026-07-02T10:00:00.000Z',
      operationId: 'op_ai_untrusted_text_inspection'
    });

    expect(inspection.deterministicFindings.some((finding) =>
      finding.evidenceIds.some((sourceId) => sourceId.includes('local-read-text-file'))
    )).toBe(false);
    expect(inspection.deterministicFindings.map((finding) => finding.claim).join('\n')).not.toContain(
      'RaceMenu requires SKSE'
    );
    expect(inspection.hypotheses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claim: expect.stringContaining('untrusted diagnostic data')
        })
      ])
    );
    expect(inspection.evidenceCards.every((card) => card.instructionsAllowed === false)).toBe(true);
  });

  it('returns a compact local.check_plugins report from plugin metadata for the requested profile', async () => {
    const { api } = createApi({
      plugins: [
        {
          ...createPluginFixture(0),
          extension: '.esm',
          hasLightFlag: false,
          isEnabled: true,
          isLight: false,
          isMaster: true,
          missingMasters: [],
          name: 'Skyrim.esm',
          sourceMod: 'Base Game'
        },
        {
          ...createPluginFixture(1),
          extension: '.esp',
          hasLightFlag: false,
          isEnabled: true,
          isLight: false,
          isMaster: false,
          missingMasters: ['Lux.esp'],
          name: 'Lux - Patch.esp',
          sourceMod: 'Lux Patch'
        },
        {
          ...createPluginFixture(2),
          extension: '.esp',
          hasLightFlag: true,
          isEnabled: true,
          isLight: true,
          isMaster: false,
          missingMasters: [],
          name: 'LightFlaggedPatch.esp',
          sourceMod: 'Light Patch'
        }
      ]
    });

    const result = await runAiBuildTool(
      api,
      'local.check_plugins',
      {
        defaultProfileName: 'Default',
        profileName: 'Profile A',
        project
      },
      'op_ai_check_plugins'
    );
    const output = result.output as {
      missing_masters?: Array<{ enabled?: boolean; missing?: string[]; plugin?: string; source_mod?: string }>;
      plugin_count?: { esm: number; esp: number; esl: number };
      plugins_with_errors?: unknown[];
      profile_id?: string | null;
      schema?: string;
    };

    expect(api.plugins.list).toHaveBeenCalledWith(
      project.projectDirectory,
      project.templateId,
      'Profile A',
      expect.objectContaining({ operationId: 'op_ai_check_plugins' })
    );
    expect(output).toMatchObject({
      missing_masters: [
        {
          enabled: true,
          missing: ['Lux.esp'],
          plugin: 'Lux - Patch.esp',
          source_mod: 'Lux Patch'
        }
      ],
      plugin_count: {
        esm: 1,
        esp: 1,
        esl: 1
      },
      plugins_with_errors: [],
      profile_id: 'Profile A',
      schema: 'fluxora.ai.local-check-plugins.v1'
    });
    expect(result.issues[0]).toMatchObject({
      code: 'plugins.missing-masters',
      sourceTool: 'local.check_plugins'
    });
  });

  it('detects SKSE DLL metadata through the bounded local filesystem snapshot', async () => {
    const raceMenu: FluxoraInstalledMod = {
      ...installedMods[0],
      id: 'C:\\Fluxora Projects\\Skyrim Main\\mods\\RaceMenu',
      installedAt: '2026-07-01T05:00:00.000Z',
      name: 'RaceMenu',
      updatedAt: '2026-07-01T05:30:00.000Z',
      version: '0.4.19.16'
    };
    const { api } = createApi({
      fileTree: [
        {
          name: 'skee64.dll',
          relativePath: 'SKSE/Plugins/skee64.dll',
          isDirectory: false,
          hasChildren: false,
          size: 512000,
          conflictState: 'none',
          conflictOwners: []
        },
        {
          name: 'skee64.ini',
          relativePath: 'SKSE/Plugins/skee64.ini',
          isDirectory: false,
          hasChildren: false,
          size: 2048,
          conflictState: 'none',
          conflictOwners: []
        }
      ],
      installedMods: [raceMenu],
      modOrder: createModOrderItems([raceMenu]),
      plugins: []
    });

    const result = await runAiBuildTool(
      api,
      'local.filesystemSnapshot',
      {
        defaultProfileName: 'Default',
        limit: 80,
        profileName: 'Default',
        project
      },
      'op_ai_local_snapshot'
    );
    const output = result.output as {
      accessPolicy?: { contentReads?: boolean; arbitraryOsPaths?: boolean };
      localTools?: {
        'local.detect_skse_plugins'?: {
          nativePluginCount?: number;
          nativePlugins?: Array<{ modName?: string; relativePath?: string; size?: number }>;
          raceMenuSignals?: Array<{ relativePath?: string }>;
        };
        'local.scan_recently_installed_mods'?: {
          mods?: Array<{ installedAt?: string; name?: string; updatedAt?: string }>;
        };
      };
      scan?: { byKind?: Record<string, number>; scannedFileCount?: number };
      schema?: string;
    };

    expect(output.schema).toBe('fluxora.ai.local-filesystem-snapshot.v1');
    expect(output.accessPolicy).toMatchObject({
      arbitraryOsPaths: false,
      contentReads: false
    });
    expect(output.localTools?.['local.detect_skse_plugins']).toMatchObject({
      nativePluginCount: 1,
      nativePlugins: [
        expect.objectContaining({
          modName: 'RaceMenu',
          relativePath: 'SKSE/Plugins/skee64.dll',
          size: 512000
        })
      ],
      raceMenuSignals: [
        expect.objectContaining({
          relativePath: 'SKSE/Plugins/skee64.dll'
        })
      ]
    });
    expect(output.localTools?.['local.scan_recently_installed_mods']?.mods?.[0]).toMatchObject({
      installedAt: '2026-07-01T05:00:00.000Z',
      name: 'RaceMenu',
      updatedAt: '2026-07-01T05:30:00.000Z'
    });
    expect(output.scan?.byKind?.['native-plugin']).toBe(1);
    expect(output.scan?.scannedFileCount).toBe(2);
    expect(result.issues.map((item) => item.code)).toContain('local.crash-log-parser-not-exposed');
  });

  it('infers installed Skyrim crash logger candidates without direct crash-log parsing', async () => {
    const crashLogger: FluxoraInstalledMod = {
      ...installedMods[0],
      id: 'C:\\Fluxora Projects\\Skyrim Main\\mods\\Crash Logger SSE AE VR',
      name: 'Crash Logger SSE AE VR',
      version: '1.15.0'
    };
    const { api } = createApi({
      fileTree: [
        {
          name: 'CrashLogger.dll',
          relativePath: 'SKSE/Plugins/CrashLogger.dll',
          isDirectory: false,
          hasChildren: false,
          size: 420000,
          conflictState: 'none',
          conflictOwners: []
        }
      ],
      installedMods: [crashLogger],
      modOrder: createModOrderItems([crashLogger]),
      plugins: []
    });

    const result = await runAiBuildTool(
      api,
      'local.filesystemSnapshot',
      {
        defaultProfileName: 'Default',
        profileName: 'Default',
        project
      },
      'op_ai_crash_logger_snapshot'
    );
    const output = result.output as {
      localTools?: {
        'local.parse_crash_logs'?: {
          fallbackOrder?: string[];
          gameCrashLogParserAvailable?: boolean;
          installedLoggerCandidates?: Array<{
            confidence?: string;
            evidence?: string;
            logger?: string;
            relativePath?: string;
          }>;
          installedLoggerDetected?: boolean;
          likelyInstalledLogger?: string | null;
          logDiscoveryAvailable?: boolean;
          newestCrashLogStatus?: string;
        };
      };
    };
    const crashLogTool = output.localTools?.['local.parse_crash_logs'];

    expect(crashLogTool).toMatchObject({
      gameCrashLogParserAvailable: false,
      installedLoggerDetected: true,
      likelyInstalledLogger: 'Crash Logger SSE/AE/VR',
      logDiscoveryAvailable: false,
      newestCrashLogStatus: 'not-exposed-by-current-core-api'
    });
    expect(crashLogTool?.installedLoggerCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          confidence: 'high',
          evidence: 'file-path',
          logger: 'Crash Logger SSE/AE/VR',
          relativePath: 'SKSE/Plugins/CrashLogger.dll'
        })
      ])
    );
    expect(crashLogTool?.fallbackOrder?.join(' ')).toContain('older crash logs');
    expect(result.issues.map((item) => item.code)).toContain('local.crash-log-parser-not-exposed');
  });

  it('uses local.read_text_file only for Analyze diagnostic prompts', async () => {
    const raceMenu: FluxoraInstalledMod = {
      ...installedMods[0],
      id: 'C:\\Fluxora Projects\\Skyrim Main\\mods\\RaceMenu',
      name: 'RaceMenu',
      version: '0.4.19.16'
    };
    const { api } = createApi({
      fileTree: [
        {
          name: 'README.txt',
          relativePath: 'README.txt',
          isDirectory: false,
          hasChildren: false,
          size: 78000,
          conflictState: 'none',
          conflictOwners: []
        },
        {
          name: 'ModuleConfig.xml',
          relativePath: 'fomod/ModuleConfig.xml',
          isDirectory: false,
          hasChildren: false,
          size: 4096,
          conflictState: 'none',
          conflictOwners: []
        }
      ],
      installedMods: [raceMenu],
      modOrder: createModOrderItems([raceMenu]),
      plugins: []
    });

    expect(shouldCollectAnalyzeTextFiles('hello')).toBe(false);
    expect(shouldCollectAnalyzeTextFiles('Skyrim AE CDT when entering Solitude; possible Crash Logger log')).toBe(true);
    const ordinary = await collectAiBuildContext(
      api,
      {
        defaultProfileName: 'Default',
        profileName: 'Testing',
        project
      },
      'op_ai_no_analyze'
    );
    expect(ordinary.tools.map((tool) => tool.toolName)).not.toContain('local.read_text_file');
    expect(api.mods.previewTextFile).not.toHaveBeenCalled();

    const diagnostic = await collectAiBuildContext(
      api,
      {
        defaultProfileName: 'Default',
        profileName: 'Testing',
        project,
        prompt: 'Проанализируй сборку, она крашит. Проверь README.txt и loadorder.txt.'
      },
      'op_ai_analyze'
    );
    const readTextTool = diagnostic.tools.find((tool) => tool.toolName === 'local.read_text_file');
    const output = readTextTool?.output as {
      accessPolicy?: { arbitraryOsPaths?: boolean; contentReads?: string; maxBytes?: number; pathScope?: string[] };
      files?: Array<{ bytes_read?: number; content_preview?: string; path?: string; truncated?: boolean }>;
      schema?: string;
    };

    expect(readTextTool).toBeTruthy();
    expect(output.schema).toBe('fluxora.ai.local-read-text-file.v1');
    expect(output.accessPolicy).toMatchObject({
      arbitraryOsPaths: false,
      contentReads: 'bounded-on-demand',
      maxBytes: 64 * 1024,
      pathScope: ['mods', 'profiles']
    });
    expect(output.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content_preview: expect.stringContaining('RaceMenu requires SKSE'),
          path: 'mods/RaceMenu/README.txt',
          truncated: true
        }),
        expect.objectContaining({
          path: 'profiles/Testing/loadorder.txt'
        })
      ])
    );
    expect(output.files?.every((file) => (file.bytes_read ?? 0) <= 64 * 1024)).toBe(true);
    expect(api.mods.previewTextFile).toHaveBeenCalledWith(
      project.projectDirectory,
      raceMenu.id,
      'README.txt',
      64 * 1024,
      expect.objectContaining({ operationId: 'op_ai_analyze' })
    );
    expect(api.profiles.previewTextFile).toHaveBeenCalledWith(
      project.projectDirectory,
      'Testing',
      'loadorder.txt',
      64 * 1024,
      expect.objectContaining({ operationId: 'op_ai_analyze' })
    );
  });

  it('adds concrete file-owner conflict evidence for high-signal overwrite mods', async () => {
    const { api } = createApi({
      fileTree: [
        {
          name: 'ActorScript.pex',
          relativePath: 'scripts/ActorScript.pex',
          isDirectory: false,
          hasChildren: false,
          size: 2400,
          conflictState: 'overwritten',
          conflictOwners: ['Visual Pack', 'Combat Patch']
        },
        {
          name: 'mountain.dds',
          relativePath: 'textures/landscape/mountain.dds',
          isDirectory: false,
          hasChildren: false,
          size: 6400,
          conflictState: 'overwrites',
          conflictOwners: ['Visual Pack', 'Landscape Retexture']
        }
      ]
    });

    const snapshot = await collectAiBuildContext(
      api,
      {
        defaultProfileName: 'Default',
        profileName: 'Testing',
        project
      },
      'op_ai_conflict_evidence'
    );

    const buildSummary = snapshot.tools.find((tool) => tool.toolName === 'build.summary')?.output as {
      conflictEvidence?: {
        pairCount: number;
        pairs: Array<{
          fileSamples: Array<{ fileKind: string; relativePath: string; sourceModName: string }>;
          modNames: string[];
        }>;
        scannedModCount: number;
      };
    };

    expect(buildSummary.conflictEvidence?.scannedModCount).toBeGreaterThan(0);
    expect(buildSummary.conflictEvidence?.pairCount).toBe(2);
    expect(buildSummary.conflictEvidence?.pairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modNames: ['Visual Pack', 'Combat Patch'],
          fileSamples: [
            expect.objectContaining({
              fileKind: 'script',
              relativePath: 'scripts/ActorScript.pex',
              sourceModName: 'Visual Pack'
            })
          ]
        }),
        expect.objectContaining({
          modNames: ['Visual Pack', 'Landscape Retexture']
        })
      ])
    );

    const serialized = serializeAiBuildContextSnapshot(snapshot);
    expect(serialized).toContain('"modNames"');
    expect(serialized).toContain('Combat Patch');
    expect(serialized).toContain('scripts/ActorScript.pex');
  });

  it('keeps ESL-flagged ESP plugins out of the full plugin slot count', async () => {
    const heavyPlugins = Array.from({ length: 30 }, (_value, index): FluxoraPluginOrderItem => ({
      ...createPluginFixture(index),
      hasLightFlag: false,
      isEnabled: true,
      isLight: false,
      name: `HeavyPlugin${index}.esp`,
      order: index,
      sourceMod: `Heavy Mod ${index}`
    }));
    const lightFlaggedEspPlugins = Array.from({ length: 300 }, (_value, index): FluxoraPluginOrderItem => ({
      ...createPluginFixture(index + heavyPlugins.length),
      extension: '.esp',
      hasLightFlag: true,
      isEnabled: true,
      isLight: true,
      name: `LightFlaggedPatch${index}.esp`,
      order: index + heavyPlugins.length,
      sourceMod: `Light Patch ${index}`
    }));
    const { api } = createApi({
      plugins: [...heavyPlugins, ...lightFlaggedEspPlugins]
    });

    const snapshot = await collectAiBuildContext(
      api,
      {
        defaultProfileName: 'Default',
        limit: 80,
        profileName: 'Default',
        project
      },
      'op_ai_light_flagged_plugins'
    );

    const buildSummary = snapshot.tools.find((tool) => tool.toolName === 'build.summary')?.output as {
      plugins?: {
        fullPluginSlots?: { active: number; limit: number; remaining: number };
        lightPluginSlots?: { active: number; limit: number; remaining: number };
        total?: number;
      };
    };
    expect(buildSummary.plugins).toMatchObject({
      total: 330,
      fullPluginSlots: { active: 30, limit: 254, remaining: 224 },
      lightPluginSlots: { active: 300, limit: 4096, remaining: 3796 }
    });

    const pluginPage = snapshot.tools.find((tool) => tool.toolName === 'plugins.loadOrder')?.page;
    const firstLightFlaggedEsp = pluginPage?.items.find((item) =>
      (item as { name?: string }).name === 'LightFlaggedPatch0.esp'
    ) as {
      consumesFullPluginSlot?: boolean;
      hasLightFlag?: boolean;
      pluginType?: string;
      slotMetadata?: { countsAgainst?: string; reason?: string };
      slotType?: string;
    } | undefined;
    expect(firstLightFlaggedEsp).toMatchObject({
      consumesFullPluginSlot: false,
      hasLightFlag: true,
      pluginType: 'light-esp-esl-flag',
      slotMetadata: {
        countsAgainst: 'light-plugin-limit',
        reason: '.esp plugin has the ESL light flag and uses a light plugin slot'
      },
      slotType: 'light'
    });

    const serialized = serializeAiBuildContextSnapshot(snapshot);
    expect(serialized).toContain('"total": 330');
    expect(serialized).toContain('"active": 30');
    expect(serialized).toContain('"active": 300');
    expect(serialized).toContain('hasLightFlag=true are light plugins');
  });

  it('limits large inventory pages while preserving compact Nexus targets for full requirement audits', async () => {
    const largeInstalledMods = Array.from({ length: 610 }, (_value, index) => ({
      ...createInstalledModFixture(index),
      sourceFileId: String(2000 + index),
      sourceGameDomain: 'skyrimspecialedition',
      sourceIsNexus: true,
      sourceModId: String(1000 + index),
      sourceProvider: 'nexus',
      sourceUrl: `https://www.nexusmods.com/skyrimspecialedition/mods/${1000 + index}?tab=files&file_id=${2000 + index}`
    }));
    const largePlugins = Array.from({ length: 121 }, (_value, index) =>
      createPluginFixture(index)
    );
    const { api } = createApi({
      installedMods: largeInstalledMods,
      modOrder: createModOrderItems(largeInstalledMods),
      plugins: largePlugins
    });

    const snapshot = await collectAiBuildContext(
      api,
      {
        defaultProfileName: 'Default',
        profileName: 'Default',
        project
      },
      'op_ai_full_inventory'
    );

    const modsPage = snapshot.tools.find((tool) => tool.toolName === 'mods.installed')?.page;
    const orderPage = snapshot.tools.find((tool) => tool.toolName === 'mods.order')?.page;
    const pluginsPage = snapshot.tools.find((tool) => tool.toolName === 'plugins.loadOrder')?.page;

    expect(modsPage?.items).toHaveLength(20);
    expect(modsPage?.limit).toBe(20);
    expect(modsPage?.nextCursor).toBe('20');
    expect(orderPage?.items).toHaveLength(20);
    expect(orderPage?.nextCursor).toBe('20');
    expect(pluginsPage?.items).toHaveLength(20);
    expect(pluginsPage?.limit).toBe(20);
    expect(pluginsPage?.nextCursor).toBe('20');
    expect(
      snapshot.tools
        .filter((tool) =>
          ['mods.installed', 'mods.order', 'plugins.loadOrder'].includes(tool.toolName)
        )
        .flatMap((tool) => tool.issues.map((item) => item.code))
    ).toContain('tool.page-sampled');

    const buildSummary = snapshot.tools.find((tool) => tool.toolName === 'build.summary')?.output as {
      nexusTargets?: {
        items: Array<{ fileId?: string; gameDomain: string; modId: string; name: string }>;
        maxTargets: number;
        totalCount: number;
        truncated: boolean;
      };
    };
    expect(buildSummary.nexusTargets).toMatchObject({
      maxTargets: 1000,
      totalCount: 610,
      truncated: false
    });
    expect(buildSummary.nexusTargets?.items).toHaveLength(610);
    expect(buildSummary.nexusTargets?.items[609]).toMatchObject({
      fileId: '2609',
      gameDomain: 'skyrimspecialedition',
      modId: '1609',
      name: 'Large Mod 609'
    });

    const explicitLargePage = await runAiBuildTool(
      api,
      'plugins.loadOrder',
      {
        limit: 100,
        profileName: 'Default',
        project
      },
      'op_ai_large_plugin_page'
    );

    expect(explicitLargePage.page?.items).toHaveLength(80);
    expect(explicitLargePage.page?.limit).toBe(80);
    expect(explicitLargePage.page?.nextCursor).toBe('80');
  });

  it('keeps selected mod file-tree reads explicit', async () => {
    const { api } = createApi();
    const result = await runAiBuildTool(
      api,
      'mods.fileTree',
      {
        project,
        profileName: 'Default'
      },
      'op_ai_file_tree'
    );

    expect(result.issues[0]?.code).toBe('mods.no-selected-mod');
    expect(result.permissionClass).toBe('read');
  });
});
