import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  createSseDynamicTriShapeNifFixture,
  createSseTinyScaleTriShapeNifFixture
} from '../tests/fixtures/sse-dynamic-nif-fixture';
import type { FluxoraFomodInstaller } from '../src/shared/fluxora-api';
import { createRealSmartFomodFixture } from './fixtures/real-smart-fomod-fixture';

const distRoot = path.resolve(__dirname, '..', 'dist');
const repositoryRoot = path.resolve(__dirname, '..', '..');
const sseDynamicNifFixtureBase64 = Buffer
  .from(createSseDynamicTriShapeNifFixture())
  .toString('base64');
const sseTinyScaleNifFixtureBase64 = Buffer
  .from(createSseTinyScaleTriShapeNifFixture())
  .toString('base64');

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

let server: Server;
let baseUrl: string;

const serveDist = async () => {
  server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const requestPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const targetPath = path.resolve(distRoot, `.${decodeURIComponent(requestPath)}`);

    if (!targetPath.startsWith(distRoot) || !existsSync(targetPath) || statSync(targetPath).isDirectory()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(targetPath)] ?? 'application/octet-stream'
    });
    createReadStream(targetPath).pipe(response);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
};

test.beforeAll(async () => {
  await serveDist();
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ method: string; payload?: unknown }> = [];
    const previewProbe = () => {
      const scope = window as any;
      scope.__fluxoraPreviewProbe ??= {
        peakHeapBytes: 0,
        textureReadCompleted: false,
        variantPrepareStarted: false
      };
      return scope.__fluxoraPreviewProbe as any;
    };
    const skyrimProject = {
      id: 'skyrim-main',
      name: 'Skyrim graphics overhaul',
      templateId: 'skyrim-special-edition',
      uiTemplateId: 'skyrim',
      gameName: 'Skyrim Special Edition',
      gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
      installRootDirectory: 'D:\\Fluxora\\Builds',
      projectDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul',
      configPath: 'D:\\Fluxora\\Configs\\skyrim-main.json',
      paths: {
        downloadsDirectory: 'D:\\Fluxora\\Downloads\\skyrimse',
        gameDirectory: 'C:\\Games\\Skyrim',
        modsDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods',
        overwriteDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\overwrite',
        profilesDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\profiles'
      },
      projectFingerprint: {
        modCount: 248,
        pluginCount: 92,
        sizeBytes: 34789235097,
        lastLaunchedAt: '2026-06-24T18:00:00Z'
      },
      gameCapabilities: {
        supportsLoadOrder: true,
        supportsPlugins: true,
        supportsVfsLaunch: true
      }
    };
    const falloutProject = {
      ...skyrimProject,
      id: 'fallout-test',
      name: 'Fallout test lab',
      templateId: 'fallout-4',
      uiTemplateId: 'fallout',
      gameName: 'Fallout 4',
      gamePath: 'C:\\Games\\Fallout4\\Fallout4.exe',
      projectDirectory: 'D:\\Fluxora\\Builds\\Fallout test lab',
      configPath: 'D:\\Fluxora\\Configs\\fallout-test.json',
      paths: {
        ...skyrimProject.paths,
        downloadsDirectory: 'D:\\Fluxora\\Downloads\\fallout4',
        gameDirectory: 'C:\\Games\\Fallout4',
        modsDirectory: 'D:\\Fluxora\\Builds\\Fallout test lab\\mods',
        overwriteDirectory: 'D:\\Fluxora\\Builds\\Fallout test lab\\overwrite',
        profilesDirectory: 'D:\\Fluxora\\Builds\\Fallout test lab\\profiles'
      },
      projectFingerprint: {
        modCount: 64,
        pluginCount: 38,
        sizeBytes: 7283923509
      }
    };
    const skyrimSecondaryProject = {
      ...skyrimProject,
      id: 'skyrim-secondary',
      name: 'Skyrim performance profile',
      projectDirectory: 'D:\\Fluxora\\Builds\\Skyrim performance profile',
      configPath: 'D:\\Fluxora\\Configs\\skyrim-secondary.json',
      paths: {
        ...skyrimProject.paths,
        modsDirectory: 'D:\\Fluxora\\Builds\\Skyrim performance profile\\mods',
        overwriteDirectory: 'D:\\Fluxora\\Builds\\Skyrim performance profile\\overwrite',
        profilesDirectory: 'D:\\Fluxora\\Builds\\Skyrim performance profile\\profiles'
      },
      projectFingerprint: {
        modCount: 92,
        pluginCount: 51,
        sizeBytes: 1283923509
      }
    };
    const projects = window.localStorage.getItem('fluxora.test.sameGameBuild') === 'true'
      ? [skyrimProject, skyrimSecondaryProject, falloutProject]
      : [skyrimProject, falloutProject];
    const waitForOperationPaint = () =>
      new Promise<void>((resolve) =>
        setTimeout(resolve, Number((window as any).__fluxoraOperationDelayMs ?? 180))
      );
    const waitForDownloadsList = () =>
      new Promise<void>((resolve) =>
        setTimeout(resolve, Number((window as any).__fluxoraDownloadsListDelayMs ?? 0))
      );
    const waitForPersistedWorkspace = () =>
      new Promise<void>((resolve) =>
        setTimeout(resolve, Number((window as any).__fluxoraPersistedWorkspaceDelayMs ?? 0))
      );
    let processExitWaitCount = 0;
    const waitForNexusStatus = () =>
      new Promise<void>((resolve) =>
        setTimeout(resolve, Number((window as any).__fluxoraNexusStatusDelayMs ?? 0))
      );
    const template = {
      id: 'skyrim-special-edition',
      displayName: 'Skyrim Special Edition',
      gameName: 'Skyrim Special Edition',
      summary: 'Bethesda RPG',
      uiTemplateId: 'skyrim'
    };
    const modRows: any[] = [
      {
        id: 'sep_core',
        orderId: 'sep_core',
        kind: 'separator',
        order: 0,
        isSeparator: true,
        isMod: false,
        modUuid: '',
        separatorTitle: 'Core fixes',
        name: 'Core fixes',
        version: '',
        latestVersion: '',
        lastCheckedAt: '',
        updateStatus: '',
        conflictStatus: '',
        fileCount: 0,
        conflictingFileCount: 0,
        overwrittenFileCount: 0,
        overwritingFileCount: 0,
        isEnabled: true,
        canCheckUpdates: false,
        hasUpdate: false,
        sourceIsNexus: false,
        sourceIsModdingFlow: false,
        isLocal: true,
        isTranslation: false,
        isPatch: false
      },
      {
        id: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Unofficial Patch',
        orderId: 'mod_ussep',
        kind: 'mod',
        order: 1,
        isSeparator: false,
        isMod: true,
        modUuid: 'mod_ussep',
        separatorTitle: '',
        name: 'Unofficial Patch',
        version: '4.3.8',
        latestVersion: '4.3.8',
        lastCheckedAt: '',
        updateStatus: '',
        conflictStatus: '',
        fileCount: 42,
        conflictingFileCount: 4,
        overwrittenFileCount: 0,
        overwritingFileCount: 4,
        isEnabled: true,
        canCheckUpdates: true,
        hasUpdate: false,
        sourceIsNexus: true,
        sourceIsModdingFlow: false,
        sourceProvider: 'nexus',
        sourceGameDomain: 'skyrimspecialedition',
        sourceModId: '266',
        sourceFileId: '12345',
        sourceUrl: 'nxm://skyrimspecialedition/mods/266/files/12345',
        isLocal: false,
        isTranslation: false,
        isPatch: true,
        overwritesModIds: ['D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI'],
        overwrittenByModIds: []
      },
      {
        id: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI',
        orderId: 'mod_skyui',
        kind: 'mod',
        order: 2,
        isSeparator: false,
        isMod: true,
        modUuid: 'mod_skyui',
        separatorTitle: '',
        name: 'SkyUI',
        version: '5.2.0',
        latestVersion: '5.3.1',
        lastCheckedAt: '',
        updateStatus: 'Update available',
        conflictStatus: '',
        fileCount: 18,
        conflictingFileCount: 2,
        overwrittenFileCount: 2,
        overwritingFileCount: 1,
        isEnabled: true,
        canCheckUpdates: true,
        hasUpdate: true,
        sourceIsNexus: true,
        sourceIsModdingFlow: false,
        isLocal: false,
        isTranslation: false,
        isPatch: false,
        overwritesModIds: [],
        overwrittenByModIds: ['D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Unofficial Patch']
      }
    ];
    const identityPlanTargets = new Map<string, string>();
    interface MockPendingInstallSession {
      operationId: string;
      pendingOrderId: string;
      revision: number;
      targetIndex: number;
      ready: boolean;
    }
    const pendingInstallSessions = new Map<string, MockPendingInstallSession>();
    const installOperations = new Map<string, any>();
    (window as any).__fluxoraInstallOperations = installOperations;
    let activeMockInstalls = 0;
    const queuedMockInstalls: Array<() => Promise<void>> = [];
    const scheduleMockInstall = (run: () => Promise<void>) => {
      if (activeMockInstalls >= 2) {
        queuedMockInstalls.push(run);
        return false;
      }
      activeMockInstalls += 1;
      void run().finally(() => {
        activeMockInstalls -= 1;
        const next = queuedMockInstalls.shift();
        if (next) {
          scheduleMockInstall(next);
        }
      });
      return true;
    };
    const mockInstallConflictSnapshot = (session: MockPendingInstallSession) => {
      const skyuiIndex = modRows.findIndex((item) => item.orderId === 'mod_skyui');
      const pendingWins = session.targetIndex > skyuiIndex;
      return {
        operationId: session.operationId,
        revision: session.revision,
        state: 'ready',
        pendingOrderId: session.pendingOrderId,
        orderId: '',
        targetIndex: session.targetIndex,
        rows: [
          {
            orderId: session.pendingOrderId,
            modUuid: '',
            fileCount: 2,
            conflictingFileCount: 1,
            overwrittenFileCount: pendingWins ? 0 : 1,
            overwritingFileCount: pendingWins ? 1 : 0,
            overwritesModIds: pendingWins ? ['mod_skyui'] : [],
            overwrittenByModIds: pendingWins ? [] : ['mod_skyui']
          },
          {
            orderId: 'mod_skyui',
            modUuid: 'mod_skyui',
            fileCount: 18,
            conflictingFileCount: 1,
            overwrittenFileCount: pendingWins ? 1 : 0,
            overwritingFileCount: pendingWins ? 0 : 1,
            overwritesModIds: pendingWins ? [] : [session.pendingOrderId],
            overwrittenByModIds: pendingWins ? [session.pendingOrderId] : []
          }
        ]
      };
    };
    const beginMockInstallConflictSession = (request: any, operation: any, fallbackOperationId: string) => {
      const snapshotDelay = window.localStorage.getItem('fluxora.test.installConflictSnapshotDelayMs');
      if (snapshotDelay === null) {
        return;
      }

      const operationId = String(operation?.operationId ?? fallbackOperationId);
      const requestedTarget = Number(request.modOrderTargetIndex);
      const session: MockPendingInstallSession = {
        operationId,
        pendingOrderId: `pending-install:${operationId}`,
        revision: 0,
        targetIndex: Number.isFinite(requestedTarget) ? requestedTarget : modRows.length,
        ready: false
      };
      pendingInstallSessions.set(operationId, session);
      window.setTimeout(() => {
        session.ready = true;
        session.revision += 1;
        const installConflictSnapshot = mockInstallConflictSnapshot(session);
        for (const callback of operationProgressCallbacks) {
          callback({
            operationId,
            phase: 'install-conflict-preview',
            statusMessage: 'Exact install conflicts ready',
            installConflictSnapshot
          });
        }
      }, Math.max(0, Number(snapshotDelay) || 0));
    };
    const throwMockInstallFailure = (requested: boolean) => {
      if (requested) {
        throw Object.assign(new Error('Mock install failed after conflict preview.'), {
          code: 'install.mockFailure'
        });
      }
    };
    const recordInstalledMod = (request: any, operation: any, fallbackOperationId: string) => {
      const operationId = operation?.operationId ?? fallbackOperationId;
      const requestedName = String(request.modName);
      let name = requestedName;
      if (request.identityDecision === 'install-new') {
        const occupiedNames = new Set(
          modRows
            .filter((item) => item.isMod)
            .map((item) => String(item.name).trim().toLocaleLowerCase())
        );
        const matchedTargetName = identityPlanTargets.get(String(request.resolutionId));
        if (matchedTargetName) {
          occupiedNames.add(matchedTargetName.trim().toLocaleLowerCase());
        }
        try {
          const extraOccupiedNames = JSON.parse(
            window.localStorage.getItem('fluxora.test.installNewOccupiedNames') ?? '[]'
          );
          if (Array.isArray(extraOccupiedNames)) {
            for (const occupiedName of extraOccupiedNames) {
              occupiedNames.add(String(occupiedName).trim().toLocaleLowerCase());
            }
          }
        } catch {
          // Malformed test-only state should behave like no extra collision.
        }

        for (let copyIndex = 1; ; copyIndex += 1) {
          const candidate = copyIndex === 1 ? requestedName : `${requestedName} (${copyIndex})`;
          if (!occupiedNames.has(candidate.trim().toLocaleLowerCase())) {
            name = candidate;
            break;
          }
        }
      }
      const existing = modRows.find(
        (item) => item.isMod && String(item.name).toLocaleLowerCase() === name.toLocaleLowerCase()
      );
      const id = existing?.id ?? `${skyrimProject.paths.modsDirectory}\\${name}`;
      const returnNexusLatest =
        window.localStorage.getItem('fluxora.test.installedNexusLatest') === 'true';
      const version = returnNexusLatest ? '2.0.0' : (existing?.version ?? '');
      const latestVersion = returnNexusLatest ? '2.1.0' : (existing?.latestVersion ?? version);
      const orderId = existing?.orderId ??
        `mod_${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
      const modUuid = existing?.modUuid || orderId;

      if (existing) {
        existing.name = name;
        existing.isEnabled = true;
      } else {
        const installedRow = {
          id,
          orderId,
          kind: 'mod',
          order: 0,
          isSeparator: false,
          isMod: true,
          modUuid,
          separatorTitle: '',
          name,
          version,
          latestVersion,
          latestFileId: returnNexusLatest ? '777' : '',
          updateCheckState: returnNexusLatest ? 'update_available' : '',
          lastCheckedAt: '',
          updateStatus: '',
          conflictStatus: '',
          fileCount: 0,
          conflictingFileCount: 0,
          overwrittenFileCount: 0,
          overwritingFileCount: 0,
          isEnabled: true,
          canCheckUpdates: returnNexusLatest,
          hasUpdate: returnNexusLatest,
          sourceIsNexus: returnNexusLatest,
          sourceIsModdingFlow: false,
          sourceProvider: returnNexusLatest ? 'nexus' : undefined,
          sourceGameDomain: returnNexusLatest ? 'skyrimspecialedition' : undefined,
          sourceModId: returnNexusLatest ? '26686' : undefined,
          sourceFileId: returnNexusLatest ? '654' : undefined,
          sourceUrl: returnNexusLatest
            ? 'nxm://skyrimspecialedition/mods/26686/files/654'
            : undefined,
          isLocal: !returnNexusLatest,
          isTranslation: false,
          isPatch: false,
          overwritesModIds: [],
          overwrittenByModIds: []
        };
        const requestedIndex = Number(request.modOrderTargetIndex);
        const insertionIndex = Number.isFinite(requestedIndex)
          ? Math.max(0, Math.min(requestedIndex, modRows.length))
          : modRows.length;
        modRows.splice(insertionIndex, 0, installedRow);
        modRows.forEach((item, index) => {
          item.order = index;
        });
      }

      calls.push({ method: 'test.recordInstalledMod', payload: { name, request } });
      const pendingSession = pendingInstallSessions.get(String(operationId));
      const pendingPatch = pendingSession?.ready
        ? mockInstallConflictSnapshot(pendingSession).rows[0]
        : null;
      return {
        id,
        name,
        version,
        latestVersion,
        latestFileId: returnNexusLatest ? '777' : ((existing as any)?.latestFileId ?? ''),
        updateCheckState: returnNexusLatest
          ? 'update_available'
          : ((existing as any)?.updateCheckState ?? ''),
        isEnabled: true,
        sourceIsNexus: returnNexusLatest || (existing?.sourceIsNexus ?? false),
        sourceIsModdingFlow: existing?.sourceIsModdingFlow ?? false,
        sourceProvider: returnNexusLatest ? 'nexus' : existing?.sourceProvider,
        sourceGameDomain: returnNexusLatest
          ? 'skyrimspecialedition'
          : existing?.sourceGameDomain,
        sourceModId: returnNexusLatest ? '26686' : existing?.sourceModId,
        sourceFileId: returnNexusLatest ? '654' : existing?.sourceFileId,
        sourceUrl: returnNexusLatest
          ? 'nxm://skyrimspecialedition/mods/26686/files/654'
          : existing?.sourceUrl,
        isLocal: returnNexusLatest ? false : (existing?.isLocal ?? true),
        isTranslation: existing?.isTranslation ?? false,
        isPatch: existing?.isPatch ?? false,
        modUuid,
        orderId,
        fileCount: pendingPatch?.fileCount ?? 0,
        conflictingFileCount: pendingPatch?.conflictingFileCount ?? 0,
        overwrittenFileCount: pendingPatch?.overwrittenFileCount ?? 0,
        overwritingFileCount: pendingPatch?.overwritingFileCount ?? 0,
        overwritesModIds: pendingPatch?.overwritesModIds ?? [],
        overwrittenByModIds: pendingPatch?.overwrittenByModIds ?? [],
        operationId
      };
    };
    const ensureFomodExistingMod = () => {
      const existing = modRows.find((item) => item.modUuid === 'mod_nvt');
      if (existing) {
        return existing;
      }
      const template = modRows.find((item) => item.isMod)!;
      const row = {
        ...template,
        id: `${skyrimProject.paths.modsDirectory}\\Natural Vision Of Tamriel`,
        orderId: 'mod_nvt',
        order: modRows.length,
        modUuid: 'mod_nvt',
        name: 'Natural Vision Of Tamriel',
        version: '1.0.0',
        latestVersion: '1.0.0',
        overwritesModIds: [],
        overwrittenByModIds: []
      };
      modRows.push(row);
      return row;
    };
    const ensureConfiguredFomodExistingMod = () => {
      if (window.localStorage.getItem('fluxora.test.fomodExistingMod') === 'true') {
        ensureFomodExistingMod();
      }
    };
    const pluginRows = [
      {
        id: 'Skyrim.esm',
        orderId: 'plugin_skyrim',
        kind: 'plugin',
        order: 0,
        isSeparator: false,
        isPlugin: true,
        name: 'Skyrim.esm',
        separatorTitle: '',
        extension: 'ESM',
        sourceMod: 'Skyrim Special Edition',
        path: 'D:\\Fluxora\\Games\\Skyrim Special Edition\\Data\\Skyrim.esm',
        isEnabled: true,
        isMaster: true,
        isLight: false,
        isLocked: true,
        lockReason: 'Base game plugin',
        masterFiles: [],
        missingMasters: []
      },
      {
        id: 'sep_patches',
        orderId: 'sep_patches',
        kind: 'separator',
        order: 1,
        isSeparator: true,
        isPlugin: false,
        name: '',
        separatorTitle: 'Late patches',
        extension: '',
        sourceMod: '',
        isEnabled: true,
        isMaster: false,
        isLight: false,
        isLocked: false,
        lockReason: '',
        masterFiles: [],
        missingMasters: []
      },
      {
        id: 'SkyUI.esp',
        orderId: 'plugin_skyui',
        kind: 'plugin',
        order: 2,
        isSeparator: false,
        isPlugin: true,
        name: 'SkyUI.esp',
        separatorTitle: '',
        extension: 'ESP',
        sourceMod: 'SkyUI',
        path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI\\Data\\SkyUI.esp',
        isEnabled: true,
        isMaster: false,
        isLight: false,
        isLocked: false,
        lockReason: '',
        masterFiles: ['Aardvark.esm', 'Update.esm', 'Zed.esm'],
        missingMasters: ['Zed.esm', 'Update.esm', 'Aardvark.esm']
      }
    ];
    const downloadRows: any[] = [
      {
        id: 'skyui_archive',
        name: 'SkyUI',
        fileName: 'SkyUI.7z',
        localPath: 'D:\\Fluxora\\Downloads\\skyrimse\\SkyUI.7z',
        source: 'local',
        archiveId: `sha256:${'a'.repeat(64)}`,
        buildStatus: 'Ready',
        transferState: 'idle',
        transferMessage: '',
        sizeText: '11.8 MB',
        createdAtText: 'today',
        progressPercent: 100,
        progressText: '100%',
        etaText: '',
        downloadSpeedText: '',
        isDownloading: false,
        hasKnownProgress: true,
        hasResolvedFileName: true,
        canResume: false,
        canInstall: true,
        canDelete: true
      },
      {
        id: 'smoothcam_archive',
        name: 'SmoothCam',
        fileName: 'SmoothCam.zip',
        localPath: 'D:\\Fluxora\\Downloads\\skyrimse\\SmoothCam.zip',
        source: 'Nexus Mods',
        archiveId: null,
        buildStatus: null,
        transferState: 'paused',
        transferMessage: 'Paused',
        sizeText: '2.4 MB',
        createdAtText: 'today',
        progressPercent: 44,
        progressText: '44%',
        etaText: '',
        downloadSpeedText: '',
        isDownloading: false,
        hasKnownProgress: true,
        hasResolvedFileName: true,
        canResume: true,
        canInstall: false,
        canDelete: true
      },
      {
        id: 'spid_archive',
        name: 'Spell Perks Item Distributor (SPID)',
        fileName: 'Spell Perks Item Distributor (SPID)-7.2.0.7z',
        localPath:
          'D:\\Fluxora\\Downloads\\skyrimse\\Spell Perks Item Distributor (SPID)-7.2.0.7z',
        source: 'Nexus Mods',
        archiveId: `sha256:${'b'.repeat(64)}`,
        buildStatus: 'Ready',
        transferState: 'idle',
        transferMessage: '',
        sizeText: '1.4 MB',
        createdAtText: 'today',
        progressPercent: 100,
        progressText: '100%',
        etaText: '',
        downloadSpeedText: '',
        isDownloading: false,
        hasKnownProgress: true,
        hasResolvedFileName: true,
        canResume: false,
        canInstall: true,
        canDelete: true
      },
      {
        id: 'aetherius_archive',
        name: 'Aetherius mod page title',
        fileName: 'Aetherius - A Race Overhaul-26686-2-14-1-1719514447.7z',
        localPath:
          'D:\\Fluxora\\Downloads\\skyrimse\\Aetherius - A Race Overhaul-26686-2-14-1-1719514447.7z',
        source: 'Nexus Mods',
        archiveId: `sha256:${'c'.repeat(64)}`,
        buildStatus: 'Ready',
        transferState: 'idle',
        transferMessage: '',
        sizeText: '3.6 MB',
        createdAtText: 'today',
        progressPercent: 100,
        progressText: '100%',
        etaText: '',
        downloadSpeedText: '',
        isDownloading: false,
        hasKnownProgress: true,
        hasResolvedFileName: true,
        canResume: false,
        canInstall: true,
        canDelete: true
      }
    ];
    let inboundNxmResolveAt = 0;
    const inboundNxmDownload = (resolved: boolean) => ({
      id: 'nxm_cabbage_cs_preset',
      name: resolved ? 'Cabbage CS Preset' : 'skyrimse-182366-770345.nxm-pending',
      fileName: resolved
        ? 'Cabbage CS Preset.7z'
        : 'skyrimse-182366-770345.nxm-pending',
      localPath: resolved
        ? 'D:\\Fluxora\\Downloads\\skyrimse\\Cabbage CS Preset.7z'
        : 'D:\\Fluxora\\Downloads\\skyrimse\\skyrimse-182366-770345.nxm-pending',
      source: 'Nexus Mods',
      archiveId: null,
      buildStatus: resolved ? 'Ready' : null,
      transferState: resolved ? 'idle' : 'queued',
      transferMessage: resolved ? '' : 'Queued',
      sizeText: resolved ? '4.2 MB' : '',
      createdAtText: 'now',
      progressPercent: resolved ? 100 : 0,
      progressText: resolved ? '100%' : '',
      etaText: '',
      downloadSpeedText: '',
      isDownloading: !resolved,
      hasKnownProgress: resolved,
      hasResolvedFileName: resolved,
      canResume: false,
      canInstall: resolved,
      canDelete: true
    });
    const nexusDuplicateDecisionDownload = () => ({
      id: 'nxm_skyui_update_pending',
      name: 'SkyUI 1.0.1',
      fileName: 'SkyUI 1.0.1.7z',
      localPath: 'D:\\Fluxora\\Downloads\\skyrimse\\skyui-101.nxm',
      source: 'Nexus Mods',
      archiveId: null,
      buildStatus: null,
      transferState: 'awaiting-decision',
      transferMessage: 'Нужно решение',
      sizeText: '',
      createdAtText: 'now',
      progressPercent: 0,
      progressText: '',
      etaText: '',
      downloadSpeedText: '',
      isDownloading: false,
      hasKnownProgress: false,
      hasResolvedFileName: true,
      canResume: false,
      canInstall: false,
      canDelete: false,
      duplicateDecision: {
        decisionId: 'decision-skyui-100-to-101',
        direction: 'upgrade',
        incomingFile: {
          id: 'incoming-skyui-101',
          fileId: '101',
          fileName: 'SkyUI 1.0.1.7z',
          version: '1.0.1'
        },
        existingFiles: [{
          id: 'skyui_archive',
          fileId: '100',
          fileName: 'SkyUI 1.0.0.7z',
          version: '1.0.0'
        }]
      }
    });
    const markDownloadInstalled = (downloadPath: unknown) => {
      const installedDownload = downloadRows.find(
        (entry) => entry.localPath === String(downloadPath ?? '')
      );
      if (installedDownload) {
        installedDownload.buildStatus = 'Installed';
      }
    };
    const installPreview = {
      gameId: 'skyrimse',
      gameDisplayName: 'Skyrim Special Edition',
      rootFileWrapperDirectory: '',
      canInstall: true,
      summary: {
        supported: true,
        hasWarnings: false,
        hasBlockers: false,
        totalEntries: 3,
        plannedEntries: 3,
        gameDataEntries: 2,
        gameRootEntries: 0,
        pluginEntries: 1,
        archiveEntries: 0,
        scriptExtenderEntries: 0,
        unknownEntries: 0,
        unsafeEntries: 0
      },
      entries: [
        {
          sourcePath: 'Data/SkyUI.esp',
          target: 'data',
          contentArea: 'data',
          targetRelativePath: 'SkyUI.esp',
          classification: 'plugin',
          explanation: 'Plugin goes to Data.',
          manualOverrideAllowed: true,
          safeManualTargets: ['data']
        },
        {
          sourcePath: 'Data/interface/skyui.swf',
          target: 'data',
          contentArea: 'data',
          targetRelativePath: 'interface/skyui.swf',
          classification: 'interface',
          explanation: 'UI asset goes to Data.',
          manualOverrideAllowed: true,
          safeManualTargets: ['data']
        },
        {
          sourcePath: 'readme.txt',
          target: 'data',
          contentArea: 'data',
          targetRelativePath: 'readme.txt',
          classification: 'documentation',
          explanation: 'Documentation is safe to install.',
          manualOverrideAllowed: true,
          safeManualTargets: ['data']
        }
      ],
      validationFindings: [],
      explanationSummary: 'Fluxora built a safe archive placement plan.',
      explanationDetails: []
    };
    const fomodPreviewImage =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='10' fill='%23f6bd3b'/%3E%3Cpath d='M16 42 28 28l8 9 6-7 8 12H16Z' fill='%23101317'/%3E%3C/svg%3E";
    const fomodInstaller = {
      isFomod: true,
      moduleName: 'Natural Vision Of Tamriel',
      moduleVersion: '8.2',
      moduleId: 'nvt',
      moduleImagePath: '',
      memoryKey: 'nvt',
      hasPreviousSelection: true,
      previousSelectedOptionIds: ['weather'],
      previousSelectionContextual: false,
      previousSelectionWeak: false,
      previousDeselectedOptionIds: [],
      moduleDependencies: null,
      fileDependencies: [
        {
          file: 'Data\\Lux.esp',
          state: 'Active',
          sourceKind: 'mod',
          sourceName: 'Lux',
          exists: true
        },
        {
          file: 'Data\\Inactive Lighting.esp',
          state: 'Inactive',
          sourceKind: 'mod',
          sourceName: 'Inactive Lighting',
          exists: true
        },
        {
          file: 'Data\\Missing Lighting.esp',
          state: 'Missing',
          sourceKind: '',
          sourceName: '',
          exists: false
        }
      ],
      requiredFiles: [],
      conditionalFilePatterns: [],
      profileContext: {
        contextId: 'fomod-context-1',
        profileName: 'Default',
        fingerprint: 'profile-default-1',
        modCatalogRevision: 7,
        modRevision: 'mods-7',
        pluginRevision: 'plugins-11',
        autoSelectionAvailable: true,
        unavailableReason: '',
        gameVersion: {
          kind: 'game',
          displayName: 'Skyrim Special Edition',
          version: '1.6.1170.0',
          known: true
        },
        extenderVersions: [],
        basePluginNames: ['Skyrim.esm', 'Update.esm'],
        fileStates: [
          {
            file: 'Data\\Lux.esp',
            state: 'Active',
            sourceKind: 'mod',
            sourceName: 'Lux',
            exists: true
          },
          {
            file: 'Data\\Inactive Lighting.esp',
            state: 'Inactive',
            sourceKind: 'mod',
            sourceName: 'Inactive Lighting',
            exists: true
          },
          {
            file: 'Data\\Missing Lighting.esp',
            state: 'Missing',
            sourceKind: '',
            sourceName: '',
            exists: false
          }
        ]
      },
      autoSelection: {
        contextId: 'fomod-context-1',
        initialSelectedOptionIds: ['weather', 'lux'],
        unresolvedGroups: [],
        decisions: [
          {
            optionId: 'full',
            action: 'deselect',
            confidence: 'strong',
            effectiveType: 'Recommended',
            reasonCodes: ['author.optional'],
            evidence: []
          },
          {
            optionId: 'weather',
            action: 'select',
            confidence: 'weak',
            effectiveType: 'Optional',
            reasonCodes: ['memory.global'],
            evidence: []
          },
          {
            optionId: 'lux',
            action: 'select',
            confidence: 'exact',
            effectiveType: 'Optional',
            reasonCodes: ['tes4.masters.satisfied'],
            evidence: [
              {
                code: 'tes4.master.active',
                subject: 'Lux.esp',
                expected: 'Active',
                actual: 'Active',
                sourceKind: 'mod',
                sourceName: 'Lux'
              }
            ]
          }
        ],
        moduleDependencyResult: 'satisfied',
        installBlocked: false,
        cycleDetected: false,
        warnings: []
      },
      steps: [
        {
          id: 'preset',
          name: 'Preset',
          visible: null,
          groups: [
            {
              id: 'variant',
              name: 'Build variant',
              type: 'SelectExactlyOne',
              options: [
                {
                  id: 'full',
                  name: 'Full install',
                  description: 'Weather, lighting and sky files.',
                  imagePath: '',
                  type: 'Recommended',
                  defaultType: 'Recommended',
                  flags: [{ name: 'variant', value: 'full' }],
                  typePatterns: []
                },
                {
                  id: 'weather',
                  name: 'Weather only',
                  description: 'Only weather and sky files.',
                  imagePath: fomodPreviewImage,
                  type: 'Optional',
                  defaultType: 'Optional',
                  flags: [{ name: 'variant', value: 'weather' }],
                  typePatterns: []
                }
              ]
            }
          ]
        },
        {
          id: 'patches',
          name: 'Patches',
          visible: null,
          groups: [
            {
              id: 'compat',
              name: 'Compatibility',
              type: 'SelectAny',
              options: [
                {
                  id: 'lux',
                  name: 'Lux patch',
                  description: 'Adjusts interior lighting records.',
                  imagePath: '',
                  type: 'Optional',
                  defaultType: 'Optional',
                  flags: [],
                  typePatterns: [],
                  pluginHeaders: [
                    {
                      outputFile: 'Data\\NVT Lux Patch.esp',
                      masters: ['Skyrim.esm', 'Lux.esp'],
                      status: 'parsed',
                      issueCode: ''
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
    const repeatedGroupFomodInstaller = {
      ...fomodInstaller,
      moduleName: 'Repeated Select One FOMOD',
      moduleId: 'repeated-select-one',
      memoryKey: 'repeated-select-one',
      hasPreviousSelection: true,
      autoSelection: null,
      previousSelectedOptionIds: Array.from({ length: 3 }, (_, stepIndex) =>
        Array.from(
          { length: 2 },
          (_, groupIndex) => `repeated-${stepIndex + 1}-${groupIndex + 1}-option-1`
        )
      ).flat(),
      steps: Array.from({ length: 3 }, (_, stepIndex) => {
        const stepNumber = stepIndex + 1;
        return {
          id: `repeated-step-${stepNumber}`,
          name: `Repeated step ${stepNumber}`,
          visible: null,
          groups: Array.from({ length: 2 }, (_, groupIndex) => {
            const groupNumber = groupIndex + 1;
            return {
              id: 'Select One',
              name: 'Select One',
              type: 'SelectExactlyOne',
              options: Array.from({ length: 10 }, (_, optionIndex) => {
                const optionNumber = optionIndex + 1;
                return {
                  id: `repeated-${stepNumber}-${groupNumber}-option-${optionNumber}`,
                  name: `Step ${stepNumber} group ${groupNumber} option ${optionNumber}`,
                  description: `Repeated group regression option ${optionNumber}.`,
                  imagePath: '',
                  type: optionIndex === 0 ? 'Recommended' : 'Optional',
                  defaultType: optionIndex === 0 ? 'Recommended' : 'Optional',
                  flags: [],
                  typePatterns: []
                };
              })
            };
          })
        };
      })
    };
    const profileChangedFomodInstaller = () => ({
      ...fomodInstaller,
      fileDependencies: fomodInstaller.fileDependencies.map((dependency) =>
        dependency.file === 'Data\\Lux.esp'
          ? { ...dependency, state: 'Inactive', exists: true }
          : dependency
      ),
      profileContext: {
        ...fomodInstaller.profileContext,
        contextId: 'fomod-context-2',
        fingerprint: 'profile-default-2',
        pluginRevision: 'plugins-12',
        fileStates: fomodInstaller.profileContext.fileStates.map((dependency) =>
          dependency.file === 'Data\\Lux.esp'
            ? { ...dependency, state: 'Inactive', exists: true }
            : dependency
        )
      },
      autoSelection: {
        ...fomodInstaller.autoSelection,
        contextId: 'fomod-context-2',
        initialSelectedOptionIds: ['weather'],
        unresolvedGroups: [
          {
            stepId: 'patches',
            groupId: 'compat',
            groupName: 'Compatibility',
            reasonCode: 'tes4.masterUnavailable',
            optionIds: ['lux']
          }
        ],
        decisions: fomodInstaller.autoSelection.decisions.map((decision) =>
          decision.optionId === 'lux'
            ? {
                ...decision,
                action: 'manual',
                confidence: 'none',
                reasonCodes: ['tes4.masterUnavailable'],
                evidence: [
                  {
                    code: 'tes4.master.inactive',
                    subject: 'Lux.esp',
                    expected: 'Active',
                    actual: 'Inactive',
                    sourceKind: 'mod',
                    sourceName: 'Lux'
                  }
                ]
              }
            : decision
        )
      }
    });
    const activeFomodInstaller = () => {
      const realFixtureInstaller = (window as any).__fluxoraRealFomodInstaller;
      if (realFixtureInstaller) {
        return realFixtureInstaller;
      }
      if (window.localStorage.getItem('fluxora.test.fomodRepeatedGroups') === 'true') {
        return repeatedGroupFomodInstaller;
      }
      return window.localStorage.getItem('fluxora.test.fomodProfileChanged') === 'true'
        ? profileChangedFomodInstaller()
        : fomodInstaller;
    };
    const withManualFomodDecisions = (installer: any, manualDecisions: any[]) => {
      if (!installer.autoSelection || manualDecisions.length === 0) {
        return installer;
      }
      const selectedOptionIds = new Set<string>(installer.autoSelection.initialSelectedOptionIds);
      const decisionsByOptionId = new Map<string, boolean>(
        manualDecisions.map(
          (decision): [string, boolean] => [String(decision.optionId), Boolean(decision.selected)]
        )
      );
      for (const [optionId, selected] of decisionsByOptionId) {
        if (selected) {
          selectedOptionIds.add(optionId);
        } else {
          selectedOptionIds.delete(optionId);
        }
      }
      return {
        ...installer,
        autoSelection: {
          ...installer.autoSelection,
          initialSelectedOptionIds: [...selectedOptionIds],
          unresolvedGroups: installer.autoSelection.unresolvedGroups.filter(
            (group: any) =>
              !group.optionIds.some((optionId: string) => decisionsByOptionId.has(optionId))
          ),
          decisions: installer.autoSelection.decisions.map((decision: any) =>
            decisionsByOptionId.has(decision.optionId)
              ? {
                  ...decision,
                  action: decisionsByOptionId.get(decision.optionId) ? 'select' : 'deselect',
                  confidence: 'exact',
                  reasonCodes: ['manual.pin'],
                  evidence: []
                }
              : decision
          )
        }
      };
    };
    const regularInstaller = {
      ...fomodInstaller,
      isFomod: false,
      moduleName: '',
      moduleVersion: '',
      moduleId: '',
      memoryKey: '',
      hasPreviousSelection: false,
      previousSelectedOptionIds: [],
      profileContext: null,
      autoSelection: null,
      steps: []
    };
    let identityPlanSequence = 0;
    const planInstall = async (
      method: 'archives.planInstall' | 'downloads.planInstall',
      projectDirectory: any,
      sourcePath: any,
      profileNameOrOperation: any,
      modNameOrOperation?: any,
      operation?: any
    ) => {
      const profileAware = typeof profileNameOrOperation === 'string';
      const nameAware = profileAware && typeof modNameOrOperation === 'string';
      const profileName = profileAware ? profileNameOrOperation : '';
      const requestedModName = nameAware ? String(modNameOrOperation).trim() : '';
      const resolvedOperation = profileAware
        ? nameAware
          ? operation
          : modNameOrOperation
        : profileNameOrOperation;
      const pathText = String(sourcePath);
      const delayMs = Number(
        window.localStorage.getItem('fluxora.test.fomodPlanDelayMs') ??
          window.localStorage.getItem('fluxora.test.fomodAnalyzeDelayMs') ??
          '0'
      );
      calls.push({
        method,
        payload: {
          delayMs,
          operation: resolvedOperation,
          profileName,
          projectDirectory,
          sourcePath,
          ...(requestedModName ? { modName: requestedModName } : {})
        }
      });
      if (delayMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      }

      const isForcedFomod =
        window.localStorage.getItem('fluxora.test.forceFomod') === 'true' ||
        window.localStorage.getItem('fluxora.test.fomodRepeatedGroups') === 'true';
      const isFomod = pathText.includes('NaturalVisionFomod') || isForcedFomod;
      const isSpid = pathText.includes('Spell Perks Item Distributor (SPID)');
      const isSkyUi = pathText.includes('SkyUI');
      const nexusLineageMode = window.localStorage.getItem('fluxora.test.nexusLineageMode');
      const isParallelNexusBranch = isSpid && nexusLineageMode === 'parallel';
      const realFixtureModuleName = String(
        (window as any).__fluxoraRealFomodInstaller?.moduleName ?? ''
      ).trim();
      const detectedModName = isFomod
        ? realFixtureModuleName || 'Natural Vision Of Tamriel'
        : isSpid
          ? isParallelNexusBranch
            ? 'Spell Perks Item Distributor (SPID)'
            : 'Spell Perks Item Distributor'
          : isSkyUi
            ? 'SkyUI'
            : pathText.split(/[\\/]/).pop()?.replace(/\.(?:7z|zip|rar)$/i, '') ?? 'Archive';
      const suggestedModName = requestedModName || detectedModName;
      const normalizedRequestedName = requestedModName.toLocaleLowerCase();
      const requestedMatchedTarget = normalizedRequestedName === 'spell perks item distributor'
        ? {
            modUuid: 'mod_spid',
            displayName: 'Spell Perks Item Distributor',
            folderName: 'Spell Perks Item Distributor'
          }
        : normalizedRequestedName === 'skyui'
          ? { modUuid: 'mod_skyui', displayName: 'SkyUI', folderName: 'SkyUI' }
          : normalizedRequestedName === 'natural vision of tamriel' &&
              window.localStorage.getItem('fluxora.test.fomodExistingMod') === 'true'
            ? {
                modUuid: 'mod_nvt',
                displayName: 'Natural Vision Of Tamriel',
                folderName: 'Natural Vision Of Tamriel'
              }
            : null;
      const detectedMatchedTarget = isForcedFomod
        ? isFomod && window.localStorage.getItem('fluxora.test.fomodExistingMod') === 'true'
          ? {
              modUuid: 'mod_nvt',
              displayName: 'Natural Vision Of Tamriel',
              folderName: 'Natural Vision Of Tamriel'
            }
          : null
        : isSpid && !isParallelNexusBranch
        ? {
            modUuid: 'mod_spid',
            displayName: 'Spell Perks Item Distributor',
            folderName: 'Spell Perks Item Distributor'
          }
        : isSkyUi
          ? { modUuid: 'mod_skyui', displayName: 'SkyUI', folderName: 'SkyUI' }
          : isFomod && window.localStorage.getItem('fluxora.test.fomodExistingMod') === 'true'
            ? {
                modUuid: 'mod_nvt',
                displayName: 'Natural Vision Of Tamriel',
                folderName: 'Natural Vision Of Tamriel'
            }
            : null;
      const matchedTarget = requestedModName ? requestedMatchedTarget : detectedMatchedTarget;
      const resolutionId = `identity-plan-${++identityPlanSequence}`;
      if (matchedTarget) {
        identityPlanTargets.set(resolutionId, matchedTarget.displayName);
      }
      return {
        suggestedModName,
        resolutionKind: matchedTarget ? requestedModName ? 'probable' : 'exact' : 'none',
        matchedTarget,
        resolutionId,
        fomodInstaller: isFomod ? activeFomodInstaller() : regularInstaller,
        evidenceCodes: matchedTarget
          ? requestedModName
            ? ['name.normalized-exact', 'source.stable-mod-id-conflict']
            : ['name.normalized-exact']
          : ['result.none'],
        score: matchedTarget ? requestedModName ? 90 : 94 : 0
      };
    };
    const throwFomodContextChangedOnce = () => {
      if (window.localStorage.getItem('fluxora.test.fomodContextChangedOnce') !== 'true') {
        return;
      }
      window.localStorage.removeItem('fluxora.test.fomodContextChangedOnce');
      window.localStorage.setItem('fluxora.test.fomodProfileChanged', 'true');
      throw Object.assign(new Error('FOMOD profile context changed. Recalculate before installing.'), {
        code: 'install.fomodContextChanged'
      });
    };
    let language = 'en-us';
    let nexusLinked = false;
    let nexusInitialStateApplied = false;
    const nexusStatus = () => {
      const initialState = (window as any).__fluxoraNexusInitiallyLinked;
      if (!nexusInitialStateApplied && typeof initialState === 'boolean') {
        nexusLinked = initialState;
        nexusInitialStateApplied = true;
      }
      return {
        clientId: 'test-client',
        displayName: nexusLinked ? 'Playwright user' : '',
        hasApiKey: nexusLinked,
        isConfigured: true,
        isLinked: nexusLinked,
        message: nexusLinked ? 'Linked' : 'Not linked',
        operationId: 'op_nexus',
        redirectUri: 'http://127.0.0.1/callback',
        userId: nexusLinked ? 'playwright' : ''
      };
    };
    const externalConnectionStatus = (operationId = 'op_connections') => {
      nexusStatus();
      return {
        providerId: 'nexus',
        label: 'Nexus Mods',
        state: nexusLinked ? 'ready' : 'notLinked',
        accountName: nexusLinked ? 'Playwright user' : '',
        hasStoredSession: nexusLinked,
        retryable: false,
        requiresUserAction: false,
        message: nexusLinked ? 'Nexus Mods connection is ready.' : 'Nexus Mods is not linked.',
        checkedAtUtc: '2026-07-19T07:00:00Z',
        operationId
      };
    };
    const externalConnectionSnapshot = (operationId = 'op_connections') => ({
      providers: [externalConnectionStatus(operationId)],
      requestedAtUtc: '2026-07-19T07:00:00Z',
      completedAtUtc: '2026-07-19T07:00:00Z',
      durationMs: 1,
      timedOut: false,
      operationId
    });
    const apiLimitStatus = () => ({
      generatedAtUtc: '2026-07-07T10:00:00Z',
      operationId: 'op_api_limits',
      providers: [
        {
          id: 'playwright-api',
          label: 'Playwright API',
          state: nexusLinked ? 'available' : 'unlinked',
          message: nexusLinked ? 'Updated from API response headers.' : 'Account not linked.',
          updatedAtUtc: '2026-07-07T10:00:00Z',
          windows: nexusLinked
            ? [
                {
                  id: 'hourly',
                  label: 'Hourly',
                  period: '1 hour',
                  limit: 500,
                  remaining: 421,
                  resetAtUtc: '2026-07-07T11:00:00Z',
                  resetRaw: '1783422000'
                },
                {
                  id: 'daily',
                  label: 'Daily',
                  period: '24 hours',
                  limit: 20000,
                  remaining: 19876,
                  resetAtUtc: '2026-07-08T00:00:00Z',
                  resetRaw: '1783468800'
                }
              ]
            : []
        }
      ]
    });

    const buildContentChangedCallbacks = new Set<(event: any) => void>();
    let buildContentSequence = 0;
    const inboundNxmCallbacks = new Set<(event: any) => void>();
    const operationProgressCallbacks = new Set<(event: any) => void>();
    const installProgressCallbacks = new Set<(event: any) => void>();
    (window as any).__fluxoraCalls = calls;
    (window as any).__emitFluxoraBuildContentChanged = (event: any = {}) => {
      const payload = {
        eventId: `evt_test_build_content_${Date.now()}`,
        projectDirectory: skyrimProject.projectDirectory,
        modsDirectory: skyrimProject.paths.modsDirectory,
        profilesDirectory: skyrimProject.paths.profilesDirectory,
        profileName: 'Default',
        sequence: ++buildContentSequence,
        reason: 'test-change',
        changes: [],
        ...event
      };
      for (const callback of buildContentChangedCallbacks) {
        callback(payload);
      }
    };
    (window as any).__emitFluxoraInboundNxm = (event: any = {}) => {
      const payload = {
        count: 1,
        operationId: `op_test_nxm_${Date.now()}`,
        ...event
      };
      for (const callback of inboundNxmCallbacks) {
        callback(payload);
      }
    };
    (window as any).__emitFluxoraInstallConflictSnapshot = (
      operationId: string,
      targetIndex: number
    ) => {
      const session = pendingInstallSessions.get(String(operationId));
      if (!session) {
        return;
      }
      session.targetIndex = Number(targetIndex);
      session.revision += 1;
      const installConflictSnapshot = mockInstallConflictSnapshot(session);
      for (const callback of operationProgressCallbacks) {
        callback({
          operationId,
          phase: 'install-conflict-preview',
          statusMessage: 'Late exact install conflicts',
          installConflictSnapshot
        });
      }
    };
    (window as any).fluxora = {
      app: {
        getInfo: async () => ({
          appName: 'Fluxora',
          arch: 'x64',
          isPackaged: false,
          platform: 'win32',
          version: '0.0.0-test'
        })
      },
      ai: {
        getFileRollbackStates: async () => [],
        getStatus: async (operation: any) => {
          calls.push({ method: 'ai.getStatus', payload: { operation } });
          return {
            ready: true,
            operationId: operation?.operationId ?? 'op_ai_status',
            health: 'ready',
            protocolVersion: '1.0',
            hostVersion: 'playwright',
            processId: 0,
            providers: [
              {
                id: 'gemini',
                displayName: 'Google Gemini',
                kind: 'byok',
                requiresCredential: true,
                credentialStore: 'os-or-supabase',
                credentialState: 'disconnected',
                connected: false,
                defaultModelId: 'gemini-3.1-flash-lite',
                supportedRunModes: ['online'],
                networkAdapters: 'available',
                dataDisclosure: 'Prompts are sent to Google only after the provider is connected.'
              },
              {
                id: 'local-dry-run',
                displayName: 'Local dry run',
                kind: 'local',
                requiresCredential: false,
                credentialStore: 'none',
                credentialState: 'notRequired',
                connected: true,
                defaultModelId: 'local-dry-run',
                supportedRunModes: ['offline'],
                networkAdapters: 'disabled',
                dataDisclosure: 'No external AI provider is called.'
              }
            ],
            models: [
              {
                id: 'gemini-3.1-flash-lite',
                providerId: 'gemini',
                displayName: 'Gemini 3.1 Flash-Lite',
                contextWindowTokens: 1048576,
                inputTokenLimit: 1048576,
                outputTokenLimit: 65536,
                limitSource: 'provider-metadata',
                supportsTools: true,
                supportsWeb: false,
                supportsStreaming: true,
                supportsBackground: false,
                priceMetadata: {
                  currency: 'USD',
                  inputPerMillionTokens: null,
                  outputPerMillionTokens: null,
                  cacheReadPerMillionTokens: null,
                  cacheWritePerMillionTokens: null,
                  source: 'playwright',
                  isEstimated: true,
                  remoteConfigurable: true
                }
              },
              {
                id: 'local-dry-run',
                providerId: 'local-dry-run',
                displayName: 'Local dry run',
                contextWindowTokens: 8192,
                inputTokenLimit: 8192,
                outputTokenLimit: 2048,
                limitSource: 'fluxora-fallback',
                supportsTools: false,
                supportsWeb: false,
                supportsStreaming: false,
                supportsBackground: false,
                priceMetadata: {
                  currency: 'USD',
                  inputPerMillionTokens: null,
                  outputPerMillionTokens: null,
                  cacheReadPerMillionTokens: null,
                  cacheWritePerMillionTokens: null,
                  source: 'playwright',
                  isEstimated: true,
                  remoteConfigurable: true
                }
              }
            ],
            capabilities: {}
          };
        },
        resetFileRollbackCheckpoints: async (operationId: string) => {
          calls.push({
            method: 'ai.resetFileRollbackCheckpoints',
            payload: { operationId }
          });
        }
      },
      apiLimits: {
        list: async (operation: any) => {
          calls.push({ method: 'apiLimits.list', payload: { operation } });
          return apiLimitStatus();
        }
      },
      archives: {
        planInstall: async (
          projectDirectory: any,
          archivePath: any,
          profileNameOrOperation: any,
          modNameOrOperation?: any,
          operation?: any
        ) =>
          planInstall(
            'archives.planInstall',
            projectDirectory,
            archivePath,
            profileNameOrOperation,
            modNameOrOperation,
            operation
          ),
        install: async (request: any, operation: any) => {
          calls.push({ method: 'archives.install', payload: { operation, request } });
          beginMockInstallConflictSession(request, operation, 'op_archive_install');
          const failInstall = window.localStorage.getItem('fluxora.test.installFailure') === 'true';
          const delayMs = Number(window.localStorage.getItem('fluxora.test.installDelayMs') ?? '0');
          if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          }
          throwMockInstallFailure(failInstall);
          return recordInstalledMod(request, operation, 'op_archive_install');
        },
        installFomod: async (request: any, operation: any) => {
          calls.push({ method: 'archives.installFomod', payload: { operation, request } });
          beginMockInstallConflictSession(request, operation, 'op_archive_fomod');
          const failInstall = window.localStorage.getItem('fluxora.test.installFailure') === 'true';
          const delayMs = Number(window.localStorage.getItem('fluxora.test.installDelayMs') ?? '0');
          if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          }
          throwMockInstallFailure(failInstall);
          throwFomodContextChangedOnce();
          return recordInstalledMod(request, operation, 'op_archive_fomod');
        }
      },
      bridge: {
        getLanguage: async () => ({ language: 'en-us', operationId: 'op_language' }),
        getStatus: async () => ({
          capabilities: {
            arch: 'x64',
            core: { available: true, libraryName: 'FluxoraCore.dll' },
            features: {
              downloads: { state: 'available' },
              buildPaths: { state: 'available' },
              executables: { state: 'available' },
              executableLaunch: { state: 'available' },
              fluxPackExport: { state: 'available' },
              mods: { state: 'available' },
              modsCheckUpdates: { state: 'available' },
              mo2Transfer: { state: 'available', supports: ['analyze', 'import', 'cancel'] },
              nexusAuth: { state: 'available' },
              operationCancellation: { state: 'available' },
              plugins: { state: 'available' },
              profiles: { state: 'available' },
              projects: { state: 'available' },
              settings: { state: 'available' }
            },
            platform: 'win32',
            supportMatrix: []
          },
          language,
          logs: { mainBridgeLogPath: '', uiLogPath: '' },
          operationId: 'op_status',
          ready: true,
          theme: 'dark'
        }),
        setLanguage: async () => ({ language: 'en-us', operationId: 'op_language' }),
        shutdown: async () => ({ accepted: true, operationId: 'op_shutdown' })
      },
      build: {
        prepareWorkspaceIndexes: async (projectDirectory: any, profileName: any, operation: any) => {
          calls.push({
            method: 'build.prepareWorkspaceIndexes',
            payload: { operation, profileName, projectDirectory }
          });
          return {
            cacheHit: true,
            profileName: profileName || 'Default',
            revision: 'playwright-effective-tree-1',
            totalEntryCount: 6,
            totalFileCount: 4
          };
        }
      },
      buildPaths: {
        get: async () => ({
          downloadsDirectory: 'D:\\Fluxora\\Downloads\\skyrimse',
          gameDirectory: 'C:\\Games\\Skyrim',
          modsDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods',
          operationId: 'op_build_paths',
          overwriteDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\overwrite',
          profilesDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\profiles'
        }),
        save: async () => ({ operationId: 'op_build_paths_save' })
      },
      buildSettings: {
        notifyPathsSaved: async (project: any) => {
          calls.push({ method: 'buildSettings.notifyPathsSaved', payload: { project } });
          return undefined;
        },
        onPathsSaved: () => () => undefined
      },
      dialogs: {
        pickArchive: async () => ({
          canceled: false,
          path: 'D:\\Incoming\\NaturalVisionFomod.7z'
        }),
        pickBuildConfig: async () => ({ canceled: true }),
        pickExecutable: async () => ({ canceled: true }),
        pickFluxPack: async () => ({ canceled: true }),
        pickFolder: async () => ({ canceled: true }),
        pickTextFile: async () => ({ canceled: true }),
        saveFluxPack: async (defaultFileName: any, title: any) => {
          calls.push({ method: 'dialogs.saveFluxPack', payload: { defaultFileName, title } });
          return { canceled: false, path: 'D:\\Fluxora\\Exports\\skyrim.fluxpack' };
        },
        saveTextFile: async (defaultFileName: any, title: any) => {
          calls.push({ method: 'dialogs.saveTextFile', payload: { defaultFileName, title } });
          return { canceled: false, path: 'D:\\Fluxora\\Exports\\BugFixesSSE.json' };
        }
      },
      textFiles: {
        read: async (filePath: any, operation: any) => {
          calls.push({ method: 'textFiles.read', payload: { filePath, operation } });
          const content = '{\n  "standalone": true\n}\n';
          return {
            path: filePath,
            fileName: String(filePath).split(/[\\/]/).pop(),
            content,
            size: content.length,
            operationId: operation?.operationId ?? 'op_text_file_read'
          };
        },
        save: async (filePath: any, content: any, operation: any) => {
          calls.push({ method: 'textFiles.save', payload: { content, filePath, operation } });
          return {
            path: filePath,
            fileName: String(filePath).split(/[\\/]/).pop(),
            size: String(content).length,
            operationId: operation?.operationId ?? 'op_text_file_save'
          };
        }
      },
      fileDrop: {
        onDragDrop: async () => () => undefined
      },
      buildContent: {
        onChanged: (callback: any) => {
          buildContentChangedCallbacks.add(callback);
          return () => {
            buildContentChangedCallbacks.delete(callback);
          };
        },
        unwatch: async (operation: any) => ({
          accepted: true,
          operationId: operation?.operationId ?? 'op_build_content_unwatch'
        }),
        watch: async (watchRequest: any, operation: any) => {
          calls.push({ method: 'buildContent.watch', payload: { operation, watchRequest } });
          return {
            accepted: true,
            operationId: operation?.operationId ?? 'op_build_content_watch'
          };
        }
      },
      downloads: {
        toFomodPreviewImageUrl: (imagePath: any) => String(imagePath),
        analyzeContentLayout: async (request: any, operation: any) => {
          calls.push({ method: 'downloads.analyzeContentLayout', payload: { operation, request } });
          return installPreview;
        },
        analyzeFomod: async (
          projectDirectory: any,
          sourcePath: any,
          profileNameOrOperation: any,
          manualDecisionsOrOperation: any = [],
          operation?: any
        ) => {
          const profileName =
            typeof profileNameOrOperation === 'string' ? profileNameOrOperation : '';
          const manualDecisions = Array.isArray(manualDecisionsOrOperation)
            ? manualDecisionsOrOperation
            : [];
          const resolvedOperation =
            typeof profileNameOrOperation === 'string' ? operation : profileNameOrOperation;
          const delayMs = Number(window.localStorage.getItem('fluxora.test.fomodAnalyzeDelayMs') ?? '0');
          calls.push({
            method: 'downloads.analyzeFomod',
            payload: {
              delayMs,
              manualDecisions,
              operation: resolvedOperation,
              profileName,
              projectDirectory,
              sourcePath
            }
          });
          if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          }
          return String(sourcePath).includes('NaturalVisionFomod') ||
            window.localStorage.getItem('fluxora.test.forceFomod') === 'true' ||
            window.localStorage.getItem('fluxora.test.fomodRepeatedGroups') === 'true'
            ? withManualFomodDecisions(activeFomodInstaller(), manualDecisions)
            : { ...fomodInstaller, isFomod: false, steps: [] };
        },
        analyzeFomodContentLayout: async (request: any, operation: any) => {
          calls.push({ method: 'downloads.analyzeFomodContentLayout', payload: { operation, request } });
          return installPreview;
        },
        cancel: async () => ({}),
        delete: async (projectDirectory: any, downloadPath: any, operation: any) => {
          calls.push({ method: 'downloads.delete', payload: { downloadPath, operation, projectDirectory } });
          return {};
        },
        resolveDuplicateDecision: async (
          projectDirectory: any,
          downloadPath: any,
          decisionId: any,
          choice: any,
          operation: any
        ) => {
          calls.push({
            method: 'downloads.resolveDuplicateDecision',
            payload: { choice, decisionId, downloadPath, operation, projectDirectory }
          });
          window.localStorage.removeItem('fluxora.test.duplicateDecision');
          if (choice === 'cancel') {
            return null;
          }
          const pending = nexusDuplicateDecisionDownload();
          return {
            ...pending,
            name: choice === 'keepBoth' ? 'SkyUI 1.0.1 (2)' : 'SkyUI 1.0.1',
            fileName: choice === 'keepBoth' ? 'SkyUI 1.0.1 (2).7z' : 'SkyUI 1.0.1.7z',
            localPath: choice === 'keepBoth'
              ? 'D:\\Fluxora\\Downloads\\skyrimse\\SkyUI 1.0.1 (2).7z'
              : 'D:\\Fluxora\\Downloads\\skyrimse\\SkyUI 1.0.1.7z',
            archiveId: `sha256:${'d'.repeat(64)}`,
            buildStatus: 'Ready',
            transferState: 'idle',
            transferMessage: '',
            sizeText: '2.1 MB',
            progressPercent: 100,
            progressText: '100%',
            isDownloading: false,
            hasKnownProgress: true,
            canInstall: true,
            canDelete: true,
            duplicateDecision: null
          };
        },
        importFile: async (projectDirectory: any, archivePath: any, operation: any) => {
          calls.push({ method: 'downloads.importFile', payload: { archivePath, operation, projectDirectory } });
          return downloadRows[0];
        },
        planInstall: async (
          projectDirectory: any,
          downloadPath: any,
          profileNameOrOperation: any,
          modNameOrOperation?: any,
          operation?: any
        ) =>
          planInstall(
            'downloads.planInstall',
            projectDirectory,
            downloadPath,
            profileNameOrOperation,
            modNameOrOperation,
            operation
          ),
        install: async (request: any, operation: any) => {
          calls.push({ method: 'downloads.install', payload: { operation, request } });
          beginMockInstallConflictSession(request, operation, 'op_download_install');
          const failInstall = window.localStorage.getItem('fluxora.test.installFailure') === 'true';
          const delayMs = Number(window.localStorage.getItem('fluxora.test.installDelayMs') ?? '0');
          if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          }
          throwMockInstallFailure(failInstall);
          const installed = recordInstalledMod(request, operation, 'op_download_install');
          markDownloadInstalled(request.downloadPath);
          return installed;
        },
        installFomod: async (request: any, operation: any) => {
          calls.push({ method: 'downloads.installFomod', payload: { operation, request } });
          beginMockInstallConflictSession(request, operation, 'op_download_fomod');
          const failInstall = window.localStorage.getItem('fluxora.test.installFailure') === 'true';
          const delayMs = Number(window.localStorage.getItem('fluxora.test.installDelayMs') ?? '0');
          if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          }
          throwMockInstallFailure(failInstall);
          throwFomodContextChangedOnce();
          const installed = recordInstalledMod(request, operation, 'op_download_fomod');
          markDownloadInstalled(request.downloadPath);
          return installed;
        },
        list: async (projectDirectory: any) => {
          await waitForDownloadsList();
          const path = String(projectDirectory);
          if (window.localStorage.getItem('fluxora.test.concurrentInstalls') === 'true') {
            return [1, 2, 3].map((index) => ({
              ...downloadRows[3],
              id: `concurrent_archive_${index}`,
              name: `Concurrent Mod ${index}`,
              fileName: `Concurrent Mod ${index}.7z`,
              localPath: `D:\\Fluxora\\Downloads\\skyrimse\\Concurrent Mod ${index}.7z`
            }));
          }
          if (path.includes('Playwright build') || path.includes('Fallout test lab')) {
            return [];
          }
          if (path.includes('Skyrim performance profile')) {
            return downloadRows.map((entry) =>
              entry.id === 'skyui_archive' ? { ...entry, buildStatus: 'Deleted' } : { ...entry }
            );
          }
          const rows = downloadRows.map((entry) => ({ ...entry }));
          if (window.localStorage.getItem('fluxora.test.duplicateDecision') === 'upgrade') {
            rows.unshift(nexusDuplicateDecisionDownload() as any);
          }
          if (
            window.localStorage.getItem('fluxora.test.returnInboundDownload') ===
              'pending-then-resolved' &&
            inboundNxmResolveAt > 0
          ) {
            rows.push(inboundNxmDownload(Date.now() >= inboundNxmResolveAt));
          }
          return rows;
        },
        watchFolder: async (projectDirectory: any, downloadsDirectory: any, operation: any) => {
          calls.push({
            method: 'downloads.watchFolder',
            payload: { downloadsDirectory, operation, projectDirectory }
          });
          return { accepted: true, operationId: operation?.operationId ?? 'op_downloads_watch' };
        },
        unwatchFolder: async (operation: any) => {
          calls.push({ method: 'downloads.unwatchFolder', payload: { operation } });
          return { accepted: true, operationId: operation?.operationId ?? 'op_downloads_unwatch' };
        },
        onFolderChanged: () => () => undefined,
        resume: async () => ({})
      },
      installs: {
        submit: async (request: any, operation: any) => {
          const operationId = String(request.operationId ?? operation?.operationId ?? `install-${Date.now()}`);
          const isFomod = request.isFomod === true;
          const compatibilityMethod = `${request.sourceKind === 'archive' ? 'archives' : 'downloads'}.${isFomod ? 'installFomod' : 'install'}`;
          const compatibilityRequest = {
            ...request,
            archivePath: request.sourcePath,
            downloadPath: request.sourcePath
          };
          calls.push({ method: 'installs.submit', payload: { operation, request } });
          calls.push({
            method: compatibilityMethod,
            payload: { operation, request: compatibilityRequest }
          });
          beginMockInstallConflictSession(request, { operationId }, operationId);

          const snapshot = {
            operationId,
            sourceKind: request.sourceKind,
            sourcePath: request.sourcePath,
            archiveFingerprint: `mock:${String(request.sourcePath).toLocaleLowerCase()}`,
            profileName: request.profileName || 'Default',
            existingModMode: request.existingModMode ?? 0,
            targetModUuid: request.targetModUuid ?? '',
            targetFolder: request.modName,
            selectedOptionIds: request.selectedOptionIds ?? [],
            manualDecisions: request.manualDecisions ?? [],
            placementOverridesJson: request.placementOverridesJson ?? '[]',
            resume: {
              isFomod,
              fomodContextId: request.fomodContextId ?? '',
              modOrderTargetIndex: request.modOrderTargetIndex ?? -1
            },
            beforeOrderId: request.beforeOrderId ?? '',
            afterOrderId: request.afterOrderId ?? '',
            enqueueSequence: installOperations.size + 1,
            state: 'queued',
            stage: 'queued',
            progressPercent: 0,
            indeterminate: true,
            errorCode: '',
            errorMessage: '',
            result: null
          };
          installOperations.set(operationId, snapshot);

          const emit = (patch: any) => {
            const current = { ...installOperations.get(operationId), ...patch };
            installOperations.set(operationId, current);
            for (const callback of installProgressCallbacks) {
              callback(current);
            }
          };
          const started = scheduleMockInstall(async () => {
            emit({ state: isFomod ? 'configuringFomod' : 'extracting', stage: isFomod ? 'configuringFomod' : 'extracting', progressPercent: 10 });
            const delayMs = Number(window.localStorage.getItem('fluxora.test.installDelayMs') ?? '0');
            if (delayMs > 0) {
              await new Promise((resolve) => window.setTimeout(resolve, delayMs));
            }
            if (installOperations.get(operationId)?.state === 'cancelled') {
              return;
            }
            if (window.localStorage.getItem('fluxora.test.installFailure') === 'true') {
              emit({
                state: 'failed',
                stage: 'failed',
                progressPercent: 100,
                indeterminate: false,
                errorCode: 'install.mockFailure',
                errorMessage: 'Mock install failed after conflict preview.'
              });
              return;
            }
            if (isFomod) {
              try {
                throwFomodContextChangedOnce();
              } catch (error) {
                emit({
                  state: 'needsReview',
                  stage: 'needsReview',
                  progressPercent: 100,
                  indeterminate: false,
                  errorCode: 'install.fomodContextChanged',
                  errorMessage: error instanceof Error ? error.message : String(error)
                });
                return;
              }
            }
            emit({ state: 'committing', stage: 'committing', progressPercent: 85, indeterminate: false });
            const pending = pendingInstallSessions.get(operationId);
            const installed = recordInstalledMod({
              ...request,
              modOrderTargetIndex: pending?.targetIndex ?? request.modOrderTargetIndex
            }, { operationId }, operationId);
            if (request.sourceKind === 'download') {
              markDownloadInstalled(request.sourcePath);
            }
            emit({
              state: 'finalizing',
              stage: 'finalizing',
              progressPercent: 95,
              indeterminate: false
            });
            const finalizationDelayMs = Number(
              window.localStorage.getItem('fluxora.test.installFinalizationDelayMs') ?? '0'
            );
            if (finalizationDelayMs > 0) {
              await new Promise((resolve) => window.setTimeout(resolve, finalizationDelayMs));
            }
            if (installOperations.get(operationId)?.state === 'cancelled') {
              return;
            }
            emit({
              state: 'completed',
              stage: 'completed',
              progressPercent: 100,
              indeterminate: false,
              result: installed
            });
          });
          if (!started) {
            window.setTimeout(() => emit({ state: 'queued', stage: 'queued', progressPercent: 0 }), 0);
          }
          return snapshot;
        },
        cancel: async (projectDirectory: any, operationIdValue: any, operation: any) => {
          const operationId = String(operationIdValue);
          calls.push({
            method: 'installs.cancel',
            payload: { operation, operationId, projectDirectory }
          });
          const current = installOperations.get(operationId);
          if (!current) {
            throw new Error('Install operation was not found.');
          }
          const cancelled = {
            ...current,
            state: 'cancelled',
            stage: 'cancelled',
            progressPercent: 100,
            indeterminate: false,
            errorCode: 'install.cancelled',
            errorMessage: 'Install operation was cancelled.'
          };
          installOperations.set(operationId, cancelled);
          for (const callback of installProgressCallbacks) {
            callback(cancelled);
          }
          return cancelled;
        },
        restore: async (_projectDirectory: any, operation: any) => {
          calls.push({ method: 'installs.restore', payload: { operation } });
          const persisted = window.localStorage.getItem('fluxora.test.restoredInstallOperations');
          const restored: any[] = [];
          if (persisted) {
            try {
              for (const candidate of JSON.parse(persisted)) {
                installOperations.set(String(candidate.operationId), candidate);
                restored.push(candidate);
              }
            } catch {
              // Invalid test-only recovery data behaves as an empty queue.
            }
          }
          calls.push({
            method: 'installs.restore.result',
            payload: { count: restored.length, operationIds: restored.map((candidate) => candidate.operationId) }
          });
          for (const candidate of restored) {
            const operationId = String(candidate.operationId);
            if (['completed', 'failed', 'cancelled'].includes(String(candidate.state))) {
              continue;
            }
            window.setTimeout(() => {
              const recovering = {
                ...installOperations.get(operationId),
                state: 'recovering',
                stage: 'recovering',
                indeterminate: true
              };
              installOperations.set(operationId, recovering);
              for (const callback of installProgressCallbacks) {
                callback(recovering);
              }
            }, 250);
            window.setTimeout(() => {
              const result = recordInstalledMod({
                modName: candidate.targetFolder,
                modOrderTargetIndex: candidate.resume?.modOrderTargetIndex ?? modRows.length,
                targetModUuid: candidate.targetModUuid,
                existingModMode: candidate.existingModMode
              }, { operationId }, operationId);
              const completed = {
                ...installOperations.get(operationId),
                state: 'completed',
                stage: 'completed',
                progressPercent: 100,
                indeterminate: false,
                result
              };
              installOperations.set(operationId, completed);
              for (const callback of installProgressCallbacks) {
                callback(completed);
              }
            }, 8_000);
          }
          const returnTerminal =
            window.localStorage.getItem('fluxora.test.returnTerminalRestoredInstalls') === 'true';
          return [...installOperations.values()].filter((candidate) =>
            returnTerminal || !['completed', 'failed', 'cancelled'].includes(String(candidate.state))
          );
        },
        list: async () => [...installOperations.values()],
        get: async (_projectDirectory: any, operationId: any) =>
          installOperations.get(String(operationId)) ?? null,
        onProgress: (callback: (event: any) => void) => {
          installProgressCallbacks.add(callback);
          return () => installProgressCallbacks.delete(callback);
        }
      },
      executables: {
        completeManagedLaunch: async (sessionId: any, outcome: any, operation: any) => {
          calls.push({
            method: 'executables.completeManagedLaunch',
            payload: { operation, outcome, sessionId }
          });
          await waitForOperationPaint();
          return {
            sessionId,
            outcome,
            finalized: true,
            deferred: false,
            outputMod: {
              id: 'bodyslide-output-id',
              displayName: 'Skyrim graphics overhaul - BodySlide Output',
              folderName: 'Skyrim graphics overhaul - BodySlide Output',
              path: 'D:\\Builds\\Skyrim graphics overhaul\\mods\\Skyrim graphics overhaul - BodySlide Output',
              provider: 'generated-bodyslide'
            },
            warnings: [],
            operationId: operation?.operationId ?? 'op_bodyslide_complete'
          };
        },
        getIcon: async () => ({ iconPath: '', operationId: 'op_icon' }),
        launch: async (configPath: any, executableId: any, profileName: any, operation: any) => {
          calls.push({ method: 'executables.launch', payload: { configPath, executableId, operation, profileName } });
          await waitForOperationPaint();
          if (executableId === 'bodyslide') {
            return {
              arguments: '',
              displayName: 'BodySlide',
              executablePath: 'D:\\Builds\\Skyrim graphics overhaul\\mods\\BodySlide\\CalienteTools\\BodySlide\\BodySlide x64.exe',
              expectedChildProcessNames: [],
              handoffDisplayName: '',
              handoffTimeoutMs: 0,
              iconPath: '',
              launchTrackingKind: 'direct',
              managedSessionId: 'bodyslide-session-1',
              managedToolKind: 'bodySlide',
              outputMod: {
                id: 'bodyslide-output-id',
                displayName: 'Skyrim graphics overhaul - BodySlide Output',
                folderName: 'Skyrim graphics overhaul - BodySlide Output',
                path: 'D:\\Builds\\Skyrim graphics overhaul\\mods\\Skyrim graphics overhaul - BodySlide Output',
                provider: 'generated-bodyslide'
              },
              configurationStatus: 'configured',
              warnings: [],
              operationId: operation?.operationId ?? 'op_bodyslide_launch',
              processId: 5_252,
              resolvedExecutablePath: 'D:\\Builds\\Skyrim graphics overhaul\\mods\\BodySlide\\CalienteTools\\BodySlide\\BodySlide x64.exe',
              resolvedWorkingDirectory: 'D:\\Builds\\Skyrim graphics overhaul\\mods\\BodySlide\\CalienteTools\\BodySlide',
              workingDirectory: ''
            };
          }
          return {
            arguments: '-forcesteamloader',
            displayName: 'SKSE',
            executablePath: 'C:\\Games\\Skyrim\\skse64_loader.exe',
            expectedChildProcessNames: [],
            handoffDisplayName: '',
            handoffTimeoutMs: 0,
            iconPath: '',
            launchTrackingKind: 'direct',
            operationId: 'op_launch',
            processId: 4_242,
            resolvedExecutablePath: 'C:\\Games\\Skyrim\\skse64_loader.exe',
            resolvedWorkingDirectory: 'C:\\Games\\Skyrim',
            workingDirectory: 'C:\\Games\\Skyrim'
          };
        },
        list: async () =>
          window.localStorage.getItem('fluxora.test.bodySlideExecutable') === 'true'
            ? [
                {
                  id: 'bodyslide',
                  displayName: 'BodySlide',
                  executablePath: 'D:\\Builds\\Skyrim graphics overhaul\\mods\\BodySlide\\CalienteTools\\BodySlide\\BodySlide x64.exe',
                  arguments: '',
                  workingDirectory: '',
                  iconPath: '',
                  managedToolKind: 'bodySlide'
                }
              ]
            : [
                {
                  id: 'skse',
                  displayName: 'SKSE',
                  executablePath: 'C:\\Games\\Skyrim\\skse64_loader.exe',
                  arguments: '-forcesteamloader',
                  workingDirectory: 'C:\\Games\\Skyrim',
                  iconPath: ''
                }
              ],
        save: async () => []
      },
      fluxPack: {
        export: async (request: any, operation: any) => {
          calls.push({ method: 'fluxPack.export', payload: { operation, request } });
          await waitForOperationPaint();
          const operationId = operation?.operationId ?? 'op_fluxpack_export';
          for (const callback of operationProgressCallbacks) {
            callback({
              currentItem: 'mods\\Local Patch\\textures',
              currentStep: 'Добавляем файлы в пакет',
              operationId,
              overallPercent: 42,
              phase: 'packing',
              statusMessage: 'Добавляем файлы в пакет'
            });
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          return {
            buildName: 'Skyrim graphics overhaul',
            bundledModCount: request.packageType === 'full' ? 4 : 0,
            compressionMode: 'smallest',
            customConfigCount: 1,
            customPatchCount: 0,
            deduplicatedPayloadBytes: 524288,
            dictionaryCount: 1,
            formatVersion: 3,
            generatedAssetCount: 2,
            generatedAssetsIncluded: true,
            installPlanAvailable: true,
            installStepCount: 3,
            logicalPayloadBytes: 4194304,
            manifestBytes: 2048,
            operationId,
            outputPath: request.outputPath,
            packageType: request.packageType,
            sourceArchiveCount: 4,
            storedPayloadBytes: 1572864,
            uniqueChunkCount: 12,
            uniquePayloadBytes: 3670016
          };
        },
        inspect: async () => ({}),
        planInstall: async () => ({ operationId: 'op_fluxpack_plan', sources: [], summary: {} }),
        install: async () => ({ operationId: 'op_fluxpack_install', summary: {} })
      },
      links: {
        openExternal: async (url: any) => {
          calls.push({ method: 'links.openExternal', payload: { url } });
          return { ok: true };
        }
      },
      mods: {
        checkUpdates: async (updateRequest: any, operation: any) => {
          calls.push({ method: 'mods.checkUpdates', payload: { operation, updateRequest } });
          const shouldAdvanceLatest =
            window.localStorage.getItem('fluxora.test.modUpdateLatest') === 'true';
          const shouldReturnPartial =
            window.localStorage.getItem('fluxora.test.modUpdatePartial') === 'authentication';
          if (shouldAdvanceLatest && !shouldReturnPartial) {
            const updated = modRows.find((item) => item.name === 'Unofficial Patch');
            if (updated) {
              updated.latestVersion = '4.4.0';
              updated.latestFileId = '54321';
              updated.updateCheckState = 'completed';
              updated.hasUpdate = true;
            }
          }
          return {
            state: shouldReturnPartial ? 'partial' : 'completed',
            reason: shouldReturnPartial ? 'authenticationUnavailable' : 'none',
            nextEligibleAt: '2026-06-26T12:00:00Z',
            quota: {
              hourlyLimit: 1_000,
              hourlyRemaining: 900,
              hourlyResetAt: '2026-06-25T13:00:00Z',
              dailyLimit: 20_000,
              dailyRemaining: 19_000,
              dailyResetAt: '2026-06-26T00:00:00Z',
              capturedAt: '2026-06-25T12:00:00Z'
            },
            counters: {
              apiRequests: 1,
              cacheHits: 0,
              checked: 2,
              updates: shouldAdvanceLatest ? 1 : 0,
              ambiguous: 0,
              failed: shouldReturnPartial ? 2 : 0
            },
            mods: modRows
              .filter((item) => item.isMod)
              .map((item) => ({
                folderName: item.name,
                latestVersion:
                  shouldAdvanceLatest && item.name === 'Unofficial Patch'
                    ? '4.4.0'
                    : item.latestVersion,
                latestFileId:
                  shouldAdvanceLatest && item.name === 'Unofficial Patch'
                    ? '54321'
                    : (item.sourceFileId ?? ''),
                updateCheckState: shouldReturnPartial
                  ? (item.updateCheckState || 'baseline_pending')
                  : 'completed',
                hasUpdate:
                  shouldAdvanceLatest && item.name === 'Unofficial Patch'
                    ? true
                    : item.hasUpdate
              }))
          };
        },
        clearOverwrite: async (projectDirectory: any, operation: any) => {
          calls.push({ method: 'mods.clearOverwrite', payload: { operation, projectDirectory } });
          return {};
        },
        createEmpty: async (projectDirectory: any, modName: any, operation: any) => {
          calls.push({ method: 'mods.createEmpty', payload: { modName, operation, projectDirectory } });
          return {};
        },
        createSeparator: async (projectDirectory: any, profileName: any, title: any, index: any, operation: any) => {
          calls.push({
            method: 'mods.createSeparator',
            payload: { index, operation, profileName, projectDirectory, title }
          });
          return modRows;
        },
        deleteInstalled: async (projectDirectory: any, modId: any, operation: any) => {
          calls.push({ method: 'mods.deleteInstalled', payload: { modId, operation, projectDirectory } });
          const delayMs = Number(window.localStorage.getItem('fluxora.test.deleteInstalledDelayMs') ?? '0');
          if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          }
          return {};
        },
        deleteSeparator: async (projectDirectory: any, profileName: any, orderId: any, operation: any) => {
          calls.push({
            method: 'mods.deleteSeparator',
            payload: { operation, orderId, profileName, projectDirectory }
          });
          return [];
        },
        getFileTree: async (_projectDirectory: any, modPath: any, relativeDirectory: any) => {
          if (String(modPath).includes('Bug Fixes SSE')) {
            if (String(relativeDirectory || '').replaceAll('\\', '/') === 'SKSE') {
              return [{
                name: 'Plugins',
                relativePath: 'SKSE/Plugins',
                isDirectory: true,
                hasChildren: true,
                size: 0,
                conflictState: 'none',
                conflictOwners: []
              }];
            }
            if (String(relativeDirectory || '').replaceAll('\\', '/') === 'SKSE/Plugins') {
              return [{
                name: 'BugFixesSSE.json',
                relativePath: 'SKSE/Plugins/BugFixesSSE.json',
                isDirectory: false,
                hasChildren: false,
                size: 49,
                conflictState: 'none',
                conflictOwners: []
              }];
            }
            return [
              {
                name: 'SKSE',
                relativePath: 'SKSE',
                isDirectory: true,
                hasChildren: true,
                size: 0,
                conflictState: 'none',
                conflictOwners: []
              },
              {
                name: 'README.md',
                relativePath: 'README.md',
                isDirectory: false,
                hasChildren: false,
                size: 24,
                conflictState: 'none',
                conflictOwners: []
              }
            ];
          }
          return [{
            name: 'scripts',
            relativePath: 'scripts',
            isDirectory: true,
            hasChildren: false,
            size: 0,
            conflictState: 'none',
            conflictOwners: []
          }];
        },
        getModDetailsContent: async (projectDirectory: any, modPath: any, operation: any) => {
          calls.push({ method: 'mods.getModDetailsContent', payload: { modPath, operation, projectDirectory } });
          return {
            modPath,
            directories: [
              {
                relativePath: '',
                entries: [
                  {
                    name: 'scripts',
                    relativePath: 'scripts',
                    isDirectory: true,
                    hasChildren: false,
                    size: 0,
                    conflictState: 'none',
                    conflictOwners: []
                  }
                ]
              }
            ],
            conflictTree: {
              modPath,
              totalOverwrites: 0,
              totalOverwritten: 0,
              limit: 0,
              nextCursor: null,
              overwrites: [],
              overwritten: []
            }
          };
        },
        readTextFile: async (projectDirectory: any, modPath: any, relativePath: any, operation: any) => {
          calls.push({
            method: 'mods.readTextFile',
            payload: { modPath, operation, projectDirectory, relativePath }
          });
          const content = (window as typeof window & { __fluxoraNumericEditorFixture?: boolean })
            .__fluxoraNumericEditorFixture
            ? '{"value": 51}\n'
            : String(relativePath).toLowerCase().endsWith('.md')
              ? '# Bug Fixes SSE\n\nLocal configuration.'
              : '{\n  "fixes": {\n    "animationLoadSignedCrash": true\n  }\n}\n';
          return {
            path: relativePath,
            fileName: String(relativePath).split(/[\\/]/).pop(),
            content,
            size: content.length,
            relativePath,
            operationId: operation?.operationId ?? 'op_text_editor_read'
          };
        },
        saveTextFile: async (projectDirectory: any, modPath: any, relativePath: any, content: any, operation: any) => {
          calls.push({
            method: 'mods.saveTextFile',
            payload: { content, modPath, operation, projectDirectory, relativePath }
          });
          return {
            path: relativePath,
            fileName: String(relativePath).split(/[\\/]/).pop(),
            size: String(content).length,
            relativePath,
            operationId: operation?.operationId ?? 'op_text_editor_save'
          };
        },
        getEffectiveFileTree: async (projectDirectory: any, profileName: any, operation: any) => {
          calls.push({
            method: 'mods.getEffectiveFileTree',
            payload: { operation, profileName, projectDirectory }
          });
          return {
            profileName: profileName || 'Default',
            revision: 'playwright-effective-tree-1',
            totalFileCount: 4,
            totalFileCountKnown: true,
            entries: [
              {
                name: 'Game Root',
                relativePath: '',
                parentPath: '',
                isDirectory: true,
                hasChildren: true,
                size: 0,
                virtualPath: '',
                sourceKind: 'virtual',
                sourceName: 'Game Root',
                sourcePath: ''
              },
              {
                name: 'Data',
                relativePath: 'Data',
                parentPath: '',
                isDirectory: true,
                hasChildren: true,
                size: 0,
                virtualPath: 'Data',
                sourceKind: 'virtual',
                sourceName: 'Merged',
                sourcePath: ''
              },
              {
                name: 'SkyrimSE.exe',
                relativePath: 'SkyrimSE.exe',
                parentPath: '',
                isDirectory: false,
                hasChildren: false,
                size: 1024,
                virtualPath: 'SkyrimSE.exe',
                sourceKind: 'game',
                sourceName: 'Game',
                sourcePath: 'D:\\Steam\\Skyrim Special Edition\\SkyrimSE.exe'
              },
              {
                name: 'Skyrim.esm',
                relativePath: 'Data\\Skyrim.esm',
                parentPath: 'Data',
                isDirectory: false,
                hasChildren: false,
                size: 128,
                virtualPath: 'Data\\Skyrim.esm',
                sourceKind: 'game',
                sourceName: 'Game',
                sourcePath: 'D:\\Steam\\Skyrim Special Edition\\Data\\Skyrim.esm'
              },
              {
                name: 'SkyUI.esp',
                relativePath: 'Data\\SkyUI.esp',
                parentPath: 'Data',
                isDirectory: false,
                hasChildren: false,
                size: 256,
                virtualPath: 'Data\\SkyUI.esp',
                sourceKind: 'mod',
                sourceName: 'SkyUI',
                sourcePath: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI\\Data\\SkyUI.esp'
              },
              {
                name: 'shared.dds',
                relativePath: 'Data\\textures\\shared.dds',
                parentPath: 'Data\\textures',
                isDirectory: false,
                hasChildren: false,
                size: 64,
                virtualPath: 'Data\\textures\\shared.dds',
                sourceKind: 'overwrite',
                sourceName: 'Overwrite',
                sourcePath: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\overwrite\\textures\\shared.dds'
              },
              {
                name: 'textures',
                relativePath: 'Data\\textures',
                parentPath: 'Data',
                isDirectory: true,
                hasChildren: true,
                size: 0,
                virtualPath: 'Data\\textures',
                sourceKind: 'virtual',
                sourceName: 'Merged',
                sourcePath: ''
              }
            ]
          };
        },
        getEffectiveFileTreeRoot: async (
          projectDirectory: any,
          profileName: any,
          limit: any,
          operation: any
        ) => {
          calls.push({
            method: 'mods.getEffectiveFileTreeRoot',
            payload: { limit, operation, profileName, projectDirectory }
          });
          return {
            profileName: profileName || 'Default',
            revision: 'playwright-effective-tree-1',
            parentPath: '',
            totalFileCount: 4,
            totalFileCountKnown: false,
            totalChildCount: 2,
            limit,
            nextCursor: '',
            entries: [
              {
                name: 'Game Root',
                relativePath: '',
                parentPath: '',
                isDirectory: true,
                hasChildren: true,
                size: 0,
                virtualPath: '',
                sourceKind: 'virtual',
                sourceName: 'Game Root',
                sourcePath: ''
              },
              {
                name: 'Data',
                relativePath: 'Data',
                parentPath: '',
                isDirectory: true,
                hasChildren: true,
                size: 0,
                virtualPath: 'Data',
                sourceKind: 'virtual',
                sourceName: 'Merged',
                sourcePath: ''
              },
              {
                name: 'SkyrimSE.exe',
                relativePath: 'SkyrimSE.exe',
                parentPath: '',
                isDirectory: false,
                hasChildren: false,
                size: 1024,
                virtualPath: 'SkyrimSE.exe',
                sourceKind: 'game',
                sourceName: 'Game',
                sourcePath: 'D:\\Steam\\Skyrim Special Edition\\SkyrimSE.exe'
              }
            ]
          };
        },
        getEffectiveFileTreeChildren: async (
          projectDirectory: any,
          profileName: any,
          revision: any,
          relativeDirectory: any,
          cursor: any,
          limit: any,
          operation: any
        ) => {
          calls.push({
            method: 'mods.getEffectiveFileTreeChildren',
            payload: { cursor, limit, operation, profileName, projectDirectory, relativeDirectory, revision }
          });
          return {
            profileName: profileName || 'Default',
            revision: 'playwright-effective-tree-1',
            parentPath: relativeDirectory,
            totalFileCount: 4,
            totalFileCountKnown: false,
            totalChildCount: 3,
            limit,
            nextCursor: '',
            entries: [
              {
                name: 'Skyrim.esm',
                relativePath: 'Data\\Skyrim.esm',
                parentPath: 'Data',
                isDirectory: false,
                hasChildren: false,
                size: 128,
                virtualPath: 'Data\\Skyrim.esm',
                sourceKind: 'game',
                sourceName: 'Game',
                sourcePath: 'D:\\Steam\\Skyrim Special Edition\\Data\\Skyrim.esm'
              },
              {
                name: 'SkyUI.esp',
                relativePath: 'Data\\SkyUI.esp',
                parentPath: 'Data',
                isDirectory: false,
                hasChildren: false,
                size: 256,
                virtualPath: 'Data\\SkyUI.esp',
                sourceKind: 'mod',
                sourceName: 'SkyUI',
                sourcePath: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI\\Data\\SkyUI.esp'
              },
              {
                name: 'textures',
                relativePath: 'Data\\textures',
                parentPath: 'Data',
                isDirectory: true,
                hasChildren: true,
                size: 0,
                virtualPath: 'Data\\textures',
                sourceKind: 'virtual',
                sourceName: 'Merged',
                sourcePath: ''
              }
            ]
          };
        },
        startNifPreview: async (...args: any[]) => {
          calls.push({ method: 'mods.startNifPreview', payload: { args } });
          previewProbe().sessionStartedAt = performance.now();
          return {
            sessionId: 'playwright-preview-session',
            variants: [
              {
                variantId: 'playwright-low-variant',
                modName: 'Low Model',
                order: 0,
                enabled: true,
                relativePath: 'meshes/armor/cuirass.nif',
                size: 512
              },
              {
                variantId: 'playwright-selected-variant',
                modName: 'Selected Model',
                order: 1,
                enabled: true,
                relativePath: 'meshes/armor/cuirass.nif',
                size: 512
              }
            ],
            activeIndex: 1,
            modelHandle: {
              assetId: 'playwright-model-selected',
              size: 512,
              mimeType: 'application/x-nif',
              relativePath: 'meshes/armor/cuirass.nif',
              source: 'Selected Model',
              contentKey: 'playwright-model-selected-v1'
            }
          };
        },
        prepareNifPreviewVariant: async (sessionId: any, variantId: any) => {
          calls.push({
            method: 'mods.prepareNifPreviewVariant',
            payload: { sessionId, variantId }
          });
          const probe = previewProbe();
          probe.variantPrepareStarted = true;
          await new Promise((resolve) => setTimeout(resolve, probe.variantDelayMs ?? 0));
          const low = variantId === 'playwright-low-variant';
          return {
            assetId: low ? 'playwright-model-low' : 'playwright-model-selected',
            size: 512,
            mimeType: 'application/x-nif',
            relativePath: 'meshes/armor/cuirass.nif',
            source: low ? 'Low Model' : 'Selected Model',
            contentKey: low ? 'playwright-model-low-v1' : 'playwright-model-selected-v1'
          };
        },
        prepareNifPreviewTextures: async (sessionId: any, texturePaths: any) => {
          calls.push({
            method: 'mods.prepareNifPreviewTextures',
            payload: { sessionId, texturePaths }
          });
          const mode = previewProbe().textureMode;
          if (mode === 'missing') {
            return { assets: [], missing: ['textures/armor/cuirass.png'] };
          }
          return {
            assets: [{
              assetId: mode === 'corrupt' ? 'playwright-texture-corrupt' : 'playwright-texture',
              size: mode === 'corrupt' ? 4 : 68,
              mimeType: 'image/png',
              relativePath: 'textures/armor/cuirass.png',
              source: 'Selected Model',
              contentKey: mode === 'corrupt'
                ? 'playwright-texture-corrupt-v1'
                : 'playwright-texture-v1'
            }],
            missing: []
          };
        },
        readNifPreviewAssetBytes: async (_sessionId: any, assetId: any) => {
          calls.push({
            method: 'mods.readNifPreviewAssetBytes',
            payload: { assetId, sessionId: _sessionId }
          });
          const probe = previewProbe();
          if (assetId === 'playwright-texture-corrupt') {
            return new Uint8Array([0, 1, 2, 3]).buffer;
          }
          if (assetId === 'playwright-texture') {
            await new Promise((resolve) => setTimeout(resolve, probe.textureDelayMs ?? 700));
            probe.textureReadCompleted = true;
            const encoded = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZxWQAAAAASUVORK5CYII=');
            return Uint8Array.from(encoded, (character) => character.charCodeAt(0)).buffer;
          }
          if (probe.modelFixtureBase64) {
            const encoded = atob(probe.modelFixtureBase64);
            return Uint8Array.from(encoded, (character) => character.charCodeAt(0)).buffer;
          }
          const fixture = JSON.stringify({
            meshes: [
              {
                name: 'Playwright preview triangle',
                positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
                indices: [0, 1, 2],
                uvs: [0, 0, 1, 0, 0, 1],
                texturePath: 'textures/armor/cuirass.png'
              }
            ]
          });
          return new TextEncoder().encode(
            `Gamebryo File Format, Version 20.2.0.7\nNiNode NiTriShape NiTriShapeData BSLightingShaderProperty BSShaderTextureSet NiAlphaProperty\nFLUXORA_STATIC_MESH_JSON:${fixture}`
          ).buffer;
        },
        endNifPreview: async (sessionId: any) => {
          calls.push({ method: 'mods.endNifPreview', payload: { sessionId } });
          return undefined;
        },
        getOrder: async (projectDirectory: any) => {
          ensureConfiguredFomodExistingMod();
          return String(projectDirectory).includes('Playwright build') ||
            String(projectDirectory).includes('Fallout test lab')
              ? []
              : modRows;
        },
        getWorkspace: async (projectDirectory: any) => {
          ensureConfiguredFomodExistingMod();
          const isEmptyBuild =
            String(projectDirectory).includes('Playwright build') ||
            String(projectDirectory).includes('Fallout test lab');
          return {
            installedMods: isEmptyBuild ? [] : modRows.filter((item) => item.isMod),
            modOrder: isEmptyBuild ? [] : modRows
          };
        },
        getPersistedWorkspace: async (projectDirectory: any) => {
          await waitForPersistedWorkspace();
          ensureConfiguredFomodExistingMod();
          const isEmptyBuild =
            String(projectDirectory).includes('Playwright build') ||
            String(projectDirectory).includes('Fallout test lab');
          const installedMods = isEmptyBuild ? [] : modRows.filter((item) => item.isMod);
          return {
            installedMods,
            modOrder: isEmptyBuild ? [] : modRows
          };
        },
        invalidateFileCaches: async (_projectDirectory: any, changedPaths: any[]) => ({
          invalidated: changedPaths.length > 0,
          changedPathCount: changedPaths.length
        }),
        listInstalled: async (projectDirectory: any, operation: any) => {
          ensureConfiguredFomodExistingMod();
          const delayMs = String(operation?.operationId ?? '').includes('install_flow')
            ? Number(window.localStorage.getItem('fluxora.test.installListDelayMs') ?? '0')
            : 0;
          calls.push({ method: 'mods.listInstalled', payload: { delayMs, operation, projectDirectory } });
          if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          }
          const rows = String(projectDirectory).includes('Playwright build') ||
            String(projectDirectory).includes('Fallout test lab')
            ? []
            : modRows.filter((item) => item.isMod);
          return rows;
        },
        moveOrderItem: async (projectDirectory: any, profileName: any, orderId: any, targetIndex: any, operation: any) => {
          calls.push({
            method: 'mods.moveOrderItem',
            payload: { operation, orderId, profileName, projectDirectory, targetIndex }
          });
          const sourceIndex = modRows.findIndex((item) => item.orderId === orderId);
          if (sourceIndex >= 0) {
            const [moved] = modRows.splice(sourceIndex, 1);
            modRows.splice(Math.max(0, Math.min(Number(targetIndex), modRows.length)), 0, moved);
            modRows.forEach((item, index) => {
              item.order = index;
            });
          }
          return [...modRows];
        },
        rebasePendingInstall: async (projectDirectory: any, operationId: any, anchors: any) => {
          const targetIndex = Number(anchors?.fallbackTargetIndex ?? anchors);
          calls.push({
            method: 'mods.rebasePendingInstall',
            payload: { anchors, operationId, projectDirectory, targetIndex }
          });
          const session = pendingInstallSessions.get(String(operationId));
          if (!session || !session.ready) {
            throw new Error('The mock pending install inventory is not ready.');
          }
          session.targetIndex = targetIndex;
          session.revision += 1;
          return mockInstallConflictSnapshot(session);
        },
        setAllEnabled: async () => ({}),
        setEnabled: async (projectDirectory: any, modId: any, isEnabled: any, operation: any) => {
          calls.push({ method: 'mods.setEnabled', payload: { isEnabled, modId, operation, projectDirectory } });
          return {};
        }
      },
      connections: {
        listStatus: async (operation: any) => {
          calls.push({ method: 'connections.listStatus', payload: { operation } });
          await waitForNexusStatus();
          const scope = window as any;
          const failuresRemaining = Number(scope.__fluxoraNexusStatusFailuresRemaining ?? 0);
          if (failuresRemaining > 0) {
            scope.__fluxoraNexusStatusFailuresRemaining = failuresRemaining - 1;
            throw new Error('Connection status temporarily unavailable');
          }
          return externalConnectionSnapshot(operation?.operationId);
        },
        restoreAll: async (attempt: any, operation: any) => {
          calls.push({ method: 'connections.restoreAll', payload: { attempt, operation } });
          return externalConnectionSnapshot(operation?.operationId);
        },
        connect: async (providerId: any, operation: any) => {
          calls.push({ method: 'connections.connect', payload: { operation, providerId } });
          nexusLinked = true;
          return externalConnectionStatus(operation?.operationId);
        },
        disconnect: async (providerId: any, operation: any) => {
          calls.push({ method: 'connections.disconnect', payload: { operation, providerId } });
          nexusLinked = false;
          return externalConnectionStatus(operation?.operationId);
        }
      },
      nexus: {
        connect: async (operation: any) => {
          calls.push({ method: 'nexus.connect', payload: { operation } });
          nexusLinked = true;
          return nexusStatus();
        },
        connectWithApiKey: async (_apiKey: any, operation: any) => {
          calls.push({ method: 'nexus.connectWithApiKey', payload: { operation } });
          nexusLinked = true;
          return nexusStatus();
        },
        disconnect: async (operation: any) => {
          calls.push({ method: 'nexus.disconnect', payload: { operation } });
          nexusLinked = false;
          return nexusStatus();
        },
        getAuthStatus: async (operation: any) => {
          calls.push({ method: 'nexus.getAuthStatus', payload: { operation } });
          await waitForNexusStatus();
          const scope = window as any;
          const failuresRemaining = Number(scope.__fluxoraNexusStatusFailuresRemaining ?? 0);
          if (failuresRemaining > 0) {
            scope.__fluxoraNexusStatusFailuresRemaining = failuresRemaining - 1;
            throw new Error('Nexus status temporarily unavailable');
          }
          return nexusStatus();
        }
      },
      nxm: {
        captureLinks: async () => [],
        importInboundDownloads: async (projectDirectory: any, operation: any) => {
          calls.push({ method: 'nxm.importInboundDownloads', payload: { operation, projectDirectory } });
          const inboundMode = window.localStorage.getItem('fluxora.test.returnInboundDownload');
          if (inboundMode === 'pending-then-resolved') {
            inboundNxmResolveAt = Date.now() + 300;
            return [inboundNxmDownload(false)];
          }
          return inboundMode === 'true'
            ? [
                {
                  id: 'nxm_cabbage_cs_preset',
                  name: 'Cabbage CS Preset',
                  fileName: 'Cabbage CS Preset.7z',
                  localPath:
                    'D:\\Fluxora\\Downloads\\skyrimse\\Cabbage CS Preset.7z',
                  source: 'Nexus Mods',
                  archiveId: null,
                  buildStatus: null,
                  transferState: 'queued',
                  transferMessage: 'Queued',
                  sizeText: '',
                  createdAtText: 'now',
                  progressPercent: 0,
                  progressText: '',
                  etaText: '',
                  downloadSpeedText: '',
                  isDownloading: false,
                  hasKnownProgress: false,
                  hasResolvedFileName: true,
                  canResume: false,
                  canInstall: false,
                  canDelete: true
                }
              ]
            : [];
        },
        onInboundLinksCaptured: (callback: (event: any) => void) => {
          inboundNxmCallbacks.add(callback);
          return () => {
            inboundNxmCallbacks.delete(callback);
          };
        },
        registerProtocol: async () => ({ operationId: 'op_nxm', registered: true })
      },
      operations: {
        cancel: async () => ({ accepted: false, operationId: 'op_cancel', status: 'unsupported' }),
        onProgress: (callback: (event: any) => void) => {
          operationProgressCallbacks.add(callback);
          return () => {
            operationProgressCallbacks.delete(callback);
          };
        }
      },
      plugins: {
        createSeparator: async () => pluginRows,
        deleteSeparator: async () => pluginRows,
        list: async (projectDirectory: any, templateId: any, profileName: any, operation: any) => {
          calls.push({
            method: 'plugins.list',
            payload: { operation, profileName, projectDirectory, templateId }
          });
          return pluginRows;
        },
        listPersisted: async (
          projectDirectory: any,
          templateId: any,
          profileName: any,
          operation: any
        ) => {
          calls.push({
            method: 'plugins.listPersisted',
            payload: { operation, profileName, projectDirectory, templateId }
          });
          return pluginRows;
        },
        move: async (projectDirectory: any, templateId: any, profileName: any, orderId: any, targetIndex: any, operation: any) => {
          calls.push({
            method: 'plugins.move',
            payload: { operation, orderId, profileName, projectDirectory, targetIndex, templateId }
          });
          return pluginRows;
        },
        setEnabled: async (projectDirectory: any, templateId: any, profileName: any, pluginName: any, isEnabled: any, operation: any) => {
          calls.push({
            method: 'plugins.setEnabled',
            payload: { isEnabled, operation, pluginName, profileName, projectDirectory, templateId }
          });
          return pluginRows;
        },
        setAllEnabled: async (projectDirectory: any, templateId: any, profileName: any, isEnabled: any, operation: any) => {
          calls.push({
            method: 'plugins.setAllEnabled',
            payload: { isEnabled, operation, profileName, projectDirectory, templateId }
          });
          return pluginRows;
        }
      },
      processes: {
        waitForLaunchReady: async (launch: any, operation: any) => {
          calls.push({ method: 'processes.waitForLaunchReady', payload: { launch, operation } });
          return {
            operationId: operation?.operationId ?? 'op_launch_ready',
            processId: launch.processId,
            processName: launch.processName || 'SKSE',
            state: 'running',
            trackedKind: launch.launchTrackingKind || 'direct'
          };
        },
        waitForExit: async (processId: any, operation: any) => {
          calls.push({ method: 'processes.waitForExit', payload: { operation, processId } });
          await waitForOperationPaint();
          if (window.localStorage.getItem('fluxora.test.bodySlideWatcherError') === 'true') {
            throw new Error('Injected BodySlide watcher failure');
          }
          processExitWaitCount += 1;
          if (processExitWaitCount % 2 === 1) {
            return {
              operationId: operation?.operationId ?? 'op_launch_holder',
              processId: 4_343,
              processName: 'CrashLogger.exe',
              state: 'running',
              trackedKind: 'vfsHolder'
            };
          }
          return {
            operationId: operation?.operationId ?? 'op_launch_exit',
            processId,
            processName: 'CrashLogger.exe',
            state: 'exited',
            trackedKind: 'vfsHolder'
          };
        }
      },
      profiles: {
        clone: async () => [],
        create: async () => [],
        delete: async () => [],
        list: async () => ['Default'],
        rename: async () => []
      },
      projects: {
        create: async (request: any, operation: any) => {
          calls.push({ method: 'projects.create', payload: { request, operation } });
          return {
            ...skyrimProject,
            id: 'playwright-build',
            name: request.projectName,
            configPath: 'D:\\Fluxora\\Configs\\playwright-build.json',
            gamePath: request.gamePath,
            installRootDirectory: request.installRootDirectory,
            projectDirectory: `${request.installRootDirectory}\\${request.projectName}`
          };
        },
        delete: async (configPath: any, operation: any) => {
          calls.push({ method: 'projects.delete', payload: { configPath, operation } });
          return { operationId: 'op_delete' };
        },
        list: async () => ({
          buildConfigsDirectory: 'D:\\Fluxora\\Configs',
          defaultInstallRootDirectory: 'D:\\Fluxora\\Builds',
          operationId: 'op_projects_list',
          projects: (window as any).__fluxoraEmptyProjectCatalog ? [] : projects
        }),
        openConfig: async (configPath: any, operation: any) => {
          calls.push({ method: 'projects.openConfig', payload: { configPath, operation } });
          return projects.find((project) => project.configPath === configPath) ?? skyrimProject;
        },
        previewDirectory: async (projectName: any, installRootDirectory: any, operation: any) => {
          calls.push({
            method: 'projects.previewDirectory',
            payload: { installRootDirectory, operation, projectName }
          });
          return {
            operationId: operation?.operationId ?? 'op_preview',
            projectDirectory: `${installRootDirectory}\\${projectName}`
          };
        },
        rename: async (configPath: any, newName: any, operation: any) => {
          calls.push({
            method: 'projects.rename',
            payload: { configPath, newName, operation }
          });
          if (window.localStorage.getItem('fluxora.test.renameFailure') === 'true') {
            throw new Error('A build with this name already exists.');
          }
          const project =
            projects.find((candidate) => candidate.configPath === configPath) ?? skyrimProject;
          const renamedConfigPath = `D:\\Fluxora\\Configs\\${newName}.json`;
          return {
            ...project,
            id: renamedConfigPath,
            name: newName,
            configPath: renamedConfigPath,
            projectDirectory: `D:\\Fluxora\\Builds\\${newName}`
          };
        }
      },
      security: {
        getState: async () => ({
          allowedIpcChannels: [],
          contextIsolation: true,
          csp: 'test',
          nodeIntegration: false,
          remoteModule: false,
          sandbox: true
        })
      },
      settings: {
        getLanguage: async () => ({ language, operationId: 'op_language' }),
        getTheme: async () => ({ operationId: 'op_theme', theme: 'dark' }),
        setLanguage: async (nextLanguage: any, operation: any) => {
          calls.push({ method: 'settings.setLanguage', payload: { language: nextLanguage, operation } });
          language = nextLanguage;
          return { language, operationId: operation?.operationId ?? 'op_language' };
        },
        setTheme: async () => ({ operationId: 'op_theme', theme: 'dark' })
      },
      shell: {
        openPath: async (path: any) => {
          calls.push({ method: 'shell.openPath', payload: { path } });
          return { ok: true };
        },
        showItemInFolder: async (path: any) => {
          calls.push({ method: 'shell.showItemInFolder', payload: { path } });
          return { ok: true };
        }
      },
      templates: {
        list: async () => [template],
        resolve: async () => template
      },
      transfer: {
        analyzeMo2: async () => ({}),
        importMo2: async () => skyrimProject,
        listDestinationDrives: async () => [],
        onMo2Handoff: () => () => undefined,
        onMo2Open: () => () => undefined,
        openMo2InMain: async () => {
          calls.push({ method: 'transfer.openMo2InMain' });
          return undefined;
        },
        startMo2InMain: async (handoff: any) => {
          calls.push({ method: 'transfer.startMo2InMain', payload: { handoff } });
          return undefined;
        }
      },
      ui: {
        log: async (payload: any) => {
          if (payload?.category === 'NifPreview.Performance') {
            calls.push({ method: 'ui.log.NifPreview.Performance', payload });
          } else if (payload?.category === 'ModInstall') {
            calls.push({ method: 'ui.log.ModInstall', payload });
          }
          return undefined;
        }
      },
      windowControls: {
        close: async () => {
          calls.push({ method: 'window.close' });
          return undefined;
        },
        minimize: async () => undefined,
        openBuildSettings: async () => undefined,
        openFilePreview: async () => undefined,
        openModDetails: async (...args: any[]) => {
          calls.push({ method: 'window.openModDetails', payload: { args } });
          return undefined;
        },
        openSettings: async () => undefined,
        openTextEditor: async () => undefined,
        toggleMaximize: async () => undefined
      }
    };
    window.confirm = () => true;
  });
});

const visualReviewSizes = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1080 }
] as const;

const clickSkyrimBuildOpenButton = async (page: Page) => {
  await page.getByRole('button', { name: 'Open Skyrim graphics overhaul' }).click();
};

const clickSkyrimBuildSelectButton = async (page: Page) => {
  await page.getByRole('button', { name: 'Select Skyrim graphics overhaul' }).click();
};

const openSkyrimBuild = async (page: Page) => {
  await page.goto(baseUrl);
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отмена', exact: true })).toBeHidden();
};

const configureDisabledPluginToggleFixture = async (
  page: Page,
  extraPluginNames: readonly string[] = []
) => {
  await page.goto(baseUrl);
  await page.evaluate(async (additionalPluginNames) => {
    const scope = window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: unknown }>;
      fluxora: any;
    };
    const originalRows = await scope.fluxora.plugins.list('', '', null, {
      operationId: 'plugin_selected_toggle_fixture'
    });
    const pluginTemplate = originalRows.find(
      (item: any) => item.orderId === 'plugin_skyui'
    );
    let pluginRows = structuredClone(originalRows).map((item: any) =>
      item.orderId === 'plugin_skyui' ? { ...item, isEnabled: false } : item
    );
    additionalPluginNames.forEach((pluginName, index) => {
      pluginRows.push({
        ...structuredClone(pluginTemplate),
        id: pluginName,
        orderId: `plugin_selected_toggle_${index}`,
        order: pluginRows.length,
        name: pluginName,
        sourceMod: pluginName.replace(/\.[^.]+$/, ''),
        isEnabled: false,
        masterFiles: [],
        missingMasters: []
      });
    });

    scope.fluxora.plugins.list = async () => structuredClone(pluginRows);
    scope.fluxora.plugins.listPersisted = async () => structuredClone(pluginRows);
    scope.fluxora.plugins.setEnabled = async (
      projectDirectory: string,
      templateId: string,
      profileName: string | null,
      pluginName: string,
      isEnabled: boolean,
      operation: unknown
    ) => {
      scope.__fluxoraCalls?.push({
        method: 'plugins.setEnabled',
        payload: {
          isEnabled,
          operation,
          pluginName,
          profileName,
          projectDirectory,
          templateId
        }
      });
      pluginRows = pluginRows.map((item: any) =>
        item.name === pluginName ? { ...item, isEnabled } : item
      );
      return structuredClone(pluginRows);
    };
  }, extraPluginNames);
};

const openSkyrimBuildWithDuplicateDecision = async (page: Page) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('fluxora.test.duplicateDecision', 'upgrade');
  });
  await page.goto(baseUrl);
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Обновление архива Nexus' })).toBeVisible();
};

const enableLargePostInstallRevealWorkspace = async (page: Page) => {
  await page.evaluate(() => {
    const scope = window as typeof window & { fluxora: any };
    const expandWorkspace = (snapshot: { installedMods: any[]; modOrder: any[] }) => {
      const sourceRows = structuredClone(snapshot.modOrder);
      const initialRows = sourceRows.slice(0, 3);
      const installedAfterStartup = sourceRows.slice(3);
      const template = initialRows.find((item: any) => item.isMod);
      const fixtures = Array.from({ length: 86 }, (_, index) => ({
        ...template,
        id: `D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Reveal fixture ${index}`,
        orderId: `mod_reveal_fixture_${index}`,
        modUuid: `mod_reveal_fixture_${index}`,
        name: `Reveal fixture ${index}`
      }));
      const modOrder = [
        ...initialRows,
        ...fixtures.slice(0, 68),
        ...installedAfterStartup,
        ...fixtures.slice(68)
      ].map((item, index) => ({ ...item, order: index }));

      return {
        ...snapshot,
        installedMods: modOrder.filter((item) => item.isMod),
        modOrder
      };
    };
    const getPersistedWorkspace = scope.fluxora.mods.getPersistedWorkspace;
    const getWorkspace = scope.fluxora.mods.getWorkspace;
    scope.fluxora.mods.getPersistedWorkspace = async (...args: unknown[]) =>
      expandWorkspace(await getPersistedWorkspace(...args));
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) =>
      expandWorkspace(await getWorkspace(...args));
  });
};

const enableLargeAdaptiveScrollWorkspace = async (
  page: Page,
  itemCount = 5000
) => {
  await page.evaluate(async (requestedItemCount) => {
    const scope = window as typeof window & { fluxora: any };
    const getPersistedWorkspace = scope.fluxora.mods.getPersistedWorkspace;
    const getWorkspace = scope.fluxora.mods.getWorkspace;
    const expandMods = (snapshot: { installedMods: any[]; modOrder: any[] }) => {
      const template = snapshot.modOrder.find((item: any) => item.isMod);
      const modOrder = Array.from({ length: requestedItemCount }, (_, index) => ({
        ...structuredClone(template),
        id: `D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Performance mod ${index}`,
        order: index,
        orderId: `mod_performance_${index}`,
        modUuid: `mod_performance_${index}`,
        name: `Performance mod ${index}`
      }));

      return {
        ...snapshot,
        installedMods: structuredClone(modOrder),
        modOrder
      };
    };
    scope.fluxora.mods.getPersistedWorkspace = async (...args: unknown[]) =>
      expandMods(await getPersistedWorkspace(...args));
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) =>
      expandMods(await getWorkspace(...args));

    const originalPlugins = await scope.fluxora.plugins.list('', '', null, {
      operationId: 'adaptive_scroll_fixture'
    });
    const pluginTemplate = originalPlugins.find((item: any) => item.isPlugin);
    const pluginRows = Array.from({ length: requestedItemCount }, (_, index) => ({
      ...structuredClone(pluginTemplate),
      id: `PerformancePlugin${index}.esp`,
      isLocked: false,
      name: `PerformancePlugin${index}.esp`,
      order: index,
      orderId: `plugin_performance_${index}`,
      sourceMod: `Performance mod ${index}`
    }));
    scope.fluxora.plugins.list = async () => structuredClone(pluginRows);
    scope.fluxora.plugins.listPersisted = async () => structuredClone(pluginRows);
  }, itemCount);
};

const resetPostInstallRevealAnimationProbe = async (page: Page, orderId: string) => {
  await page.evaluate((targetOrderId) => {
    const scope = window as typeof window & {
      __postInstallRevealProbe?: {
        attached: boolean;
        events: string[];
        orderId: string;
      };
    };
    scope.__postInstallRevealProbe ??= {
      attached: false,
      events: [],
      orderId: targetOrderId
    };
    const probe = scope.__postInstallRevealProbe;
    probe.events = [];
    probe.orderId = targetOrderId;
    if (probe.attached) {
      return;
    }

    const record = (event: Event) => {
      const animationEvent = event as AnimationEvent;
      const row = animationEvent.target instanceof HTMLElement
        ? animationEvent.target.closest<HTMLElement>('[data-order-id]')
        : null;
      if (
        animationEvent.animationName === 'post-install-mod-reveal' &&
        row?.dataset.orderId === probe.orderId
      ) {
        probe.events.push(animationEvent.type);
      }
    };
    document.addEventListener('animationiteration', record);
    document.addEventListener('animationend', record);
    probe.attached = true;
  }, orderId);
};

const postInstallRevealAnimationEvents = async (page: Page) =>
  page.evaluate(() =>
    (
      window as typeof window & {
        __postInstallRevealProbe?: { events: string[] };
      }
    ).__postInstallRevealProbe?.events ?? []
  );

const submitFluxPackExportDialog = async (
  page: Page,
  packageType: 'full' | 'recipe' = 'recipe',
  includeGeneratedAssets = false
) => {
  const packageTypeLabels = {
    full: 'Полная',
    recipe: 'Рецепт'
  } as const;
  const dialog = page.getByRole('dialog', { name: 'Упаковать сборку' });
  await expect(dialog).toBeVisible();
  const packageTypeSelect = dialog.getByRole('combobox', { name: 'Тип упаковки FluxPack' });
  await packageTypeSelect.click();
  const packageTypeMenu = page.getByRole('listbox');
  await expect(packageTypeMenu).toBeVisible();
  await expect(packageTypeMenu).toHaveAttribute('data-open', 'true');
  await packageTypeMenu
    .getByRole('option', { name: packageTypeLabels[packageType], exact: true })
    .click();
  await expect(packageTypeSelect).toContainText(packageTypeLabels[packageType]);
  if (includeGeneratedAssets && packageType === 'recipe') {
    const generatedAssetsCheckbox = dialog.getByRole('checkbox', {
      name: /Добавить сгенерированные файлы/
    });
    await generatedAssetsCheckbox.focus();
    await page.keyboard.press('Space');
    await expect(generatedAssetsCheckbox).toBeChecked();
  }
  await dialog.getByRole('button', { name: 'Упаковать', exact: true }).click();
};

const rowContextMenuScrollbarState = async (menu: Locator) =>
  menu.evaluate((node) => {
    const element = node as HTMLElement;
    const style = window.getComputedStyle(element);
    const borderX = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const borderY = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);

    return {
      horizontalScrollbarGutter: Math.max(
        0,
        Math.round(element.offsetHeight - element.clientHeight - borderY)
      ),
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollHeightDelta: element.scrollHeight - element.clientHeight,
      scrollWidthDelta: element.scrollWidth - element.clientWidth,
      verticalScrollbarGutter: Math.max(
        0,
        Math.round(element.offsetWidth - element.clientWidth - borderX)
      )
    };
  });

const expectRowContextMenuWithoutScrollbar = async (menu: Locator) => {
  await expect(menu).toBeVisible();

  const state = await rowContextMenuScrollbarState(menu);
  expect(state.overflowX).toBe('visible');
  expect(state.overflowY).toBe('visible');
  expect(state.verticalScrollbarGutter).toBeLessThanOrEqual(1);
  expect(state.horizontalScrollbarGutter).toBeLessThanOrEqual(1);
  expect(state.scrollHeightDelta).toBeLessThanOrEqual(1);
  expect(state.scrollWidthDelta).toBeLessThanOrEqual(1);
};

test('renders mod and download popup menus without scrollbars', async ({ page }) => {
  await openSkyrimBuild(page);

  const modRow = page.getByRole('row', { name: /Unofficial Patch mod/ });
  await modRow.click({ button: 'right' });
  const modMenu = page.getByRole('menu', { name: 'Unofficial Patch actions' });
  await expect(modMenu.getByRole('menuitem', { name: 'Open folder' })).toBeVisible();
  await expectRowContextMenuWithoutScrollbar(modMenu);
  await page.keyboard.press('Escape');

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const downloadRow = rightPane.getByRole('row', { name: /SkyUI/ });
  await downloadRow.click({ button: 'right' });
  const downloadMenu = page.getByRole('menu', { name: 'SkyUI actions' });
  await expect(downloadMenu.getByRole('menuitem', { name: 'Install' })).toBeVisible();
  await expect(downloadMenu.getByRole('menuitem', { name: 'Show in folder' })).toBeVisible();
  await expect(downloadMenu.getByRole('menuitem', { name: 'Удалить', exact: true })).toBeVisible();
  await expectRowContextMenuWithoutScrollbar(downloadMenu);
});

test('opens the installed mod source page from the row context menu', async ({ page }) => {
  await openSkyrimBuild(page);

  const modRow = page.getByRole('row', { name: /Unofficial Patch mod/ });
  await modRow.click({ button: 'right' });

  const modMenu = page.getByRole('menu', { name: 'Unofficial Patch actions' });
  const openSourceAction = modMenu.getByRole('menuitem', { name: 'Открыть источник' });
  await expect(openSourceAction).toBeVisible();
  await openSourceAction.click();

  await expect
    .poll(() => latestCallPayload(page, 'links.openExternal'))
    .toEqual({ url: 'https://www.nexusmods.com/skyrimspecialedition/mods/266' });
});

test('positions the overwrite context menu at the right-click point within the viewport', async ({
  page
}) => {
  await page.setViewportSize({ width: 1180, height: 500 });
  await openSkyrimBuild(page);

  const overwriteRow = page.getByRole('row', {
    name: /Skyrim graphics overhaul .* Output files folder overwrite folder/
  });
  await overwriteRow.scrollIntoViewIfNeeded();

  const rowBox = await overwriteRow.boundingBox();
  expect(rowBox).not.toBeNull();

  const clickOffset = {
    x: Math.round(rowBox!.width * 0.45),
    y: Math.round(rowBox!.height / 2)
  };
  const clickPoint = {
    x: rowBox!.x + clickOffset.x,
    y: rowBox!.y + clickOffset.y
  };

  await overwriteRow.click({ button: 'right', position: clickOffset });

  const overwriteMenu = page.getByRole('menu', { name: /Output files folder actions/ });
  await expect(overwriteMenu).toBeVisible();
  const menuBox = await overwriteMenu.boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox).not.toBeNull();
  expect(viewport).not.toBeNull();

  const expectedLeft = Math.max(
    8,
    Math.min(clickPoint.x, viewport!.width - menuBox!.width - 8)
  );
  const expectedTop = Math.max(
    8,
    Math.min(clickPoint.y, viewport!.height - menuBox!.height - 8)
  );

  expect(Math.abs(menuBox!.x - expectedLeft)).toBeLessThanOrEqual(3);
  expect(Math.abs(menuBox!.y - expectedTop)).toBeLessThanOrEqual(3);
});

test('stacks the overwrite context menu above the mod list rows it overlaps', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 500 });
  await openSkyrimBuild(page);

  const overwriteRow = page.getByRole('row', {
    name: /Skyrim graphics overhaul .* Output files folder overwrite folder/
  });
  await overwriteRow.scrollIntoViewIfNeeded();

  const rowBox = await overwriteRow.boundingBox();
  expect(rowBox).not.toBeNull();

  const clickOffset = {
    x: Math.round(rowBox!.width * 0.45),
    y: Math.round(rowBox!.height / 2)
  };
  const overlapPoint = {
    x: rowBox!.x + clickOffset.x + 4,
    y: rowBox!.y + clickOffset.y + 4
  };
  const rowIsTopBeforeMenu = await overwriteRow.evaluate((row, point) => {
    const topElement = document.elementFromPoint(point.x, point.y);
    return topElement !== null && (topElement === row || row.contains(topElement));
  }, overlapPoint);
  expect(rowIsTopBeforeMenu).toBe(true);

  await overwriteRow.click({
    button: 'right',
    position: clickOffset
  });

  const overwriteMenu = page.getByRole('menu', { name: /Output files folder actions/ });
  await expect(overwriteMenu).toBeVisible();
  const menuIsTopAfterOpen = await overwriteMenu.evaluate((menu, point) => {
    const topElement = document.elementFromPoint(point.x, point.y);
    return topElement !== null && (topElement === menu || menu.contains(topElement));
  }, overlapPoint);
  expect(menuIsTopAfterOpen).toBe(true);
});

test.describe('deletes selected mods with Del', () => {
  test('opens confirmation before deleting the focused mod', async ({ page }) => {
    await openSkyrimBuild(page);

    const modRow = page.getByRole('row', { name: /SkyUI mod/ });
    await modRow.click();
    await modRow.press('Delete');

    const dialog = page.getByRole('dialog', { name: 'Удаление мода' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('SkyUI', { exact: true })).toBeVisible();
    expect(await callMethods(page)).not.toContain('mods.deleteInstalled');
  });

  test('focuses the delete action and confirms it with Enter', async ({ page }) => {
    await openSkyrimBuild(page);

    const modRow = page.getByRole('row', { name: /SkyUI mod/ });
    await modRow.click();
    await modRow.press('Delete');

    const dialog = page.getByRole('dialog', { name: 'Удаление мода' });
    const deleteButton = dialog.getByRole('button', { name: 'Удалить' });
    await expect(deleteButton).toBeFocused();
    await page.keyboard.press('Enter');

    await expect.poll(() => callMethods(page)).toContain('mods.deleteInstalled');
  });

  test('reopens confirmation with Del after dismissing it', async ({ page }) => {
    await openSkyrimBuild(page);

    const modRow = page.getByRole('row', { name: /SkyUI mod/ });
    const dialog = page.getByRole('dialog', { name: 'Удаление мода' });
    await modRow.click();
    await modRow.press('Delete');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Закрыть окно удаления' }).click();
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('Delete');

    await expect(dialog).toBeVisible();
  });

  test('confirms and deletes every mod in the focused row selection', async ({ page }) => {
    await openSkyrimBuild(page);

    const patchRow = page.getByRole('row', { name: /Unofficial Patch mod/ });
    const skyuiRow = page.getByRole('row', { name: /SkyUI mod/ });
    await patchRow.click();
    await page.keyboard.down('Control');
    await skyuiRow.click();
    await page.keyboard.up('Control');
    await skyuiRow.press('Delete');

    const dialog = page.getByRole('dialog', { name: 'Удаление модов' });
    await expect(dialog.getByText('2 мода', { exact: true })).toBeVisible();
    expect((await callMethods(page)).filter((method) => method === 'mods.deleteInstalled')).toHaveLength(0);

    await dialog.getByRole('button', { name: 'Удалить' }).click();
    await expect
      .poll(async () =>
        (await callMethods(page)).filter((method) => method === 'mods.deleteInstalled').length
      )
      .toBe(2);
  });

  test('shows the Del hint without changing the delete menu item name', async ({ page }) => {
    await openSkyrimBuild(page);

    const modRow = page.getByRole('row', { name: /SkyUI mod/ });
    await modRow.click({ button: 'right' });

    const deleteItem = page.getByRole('menuitem', { name: 'Удалить', exact: true });
    const label = deleteItem.getByText('Удалить', { exact: true });
    const shortcut = deleteItem.getByText('Del', { exact: true });
    await expect(deleteItem).toBeVisible();
    await expect(deleteItem).toHaveAccessibleName('Удалить');
    await expect(deleteItem).toHaveAttribute('aria-keyshortcuts', 'Delete');
    await expect(shortcut).toBeVisible();

    const itemBox = await deleteItem.boundingBox();
    const labelBox = await label.boundingBox();
    const shortcutBox = await shortcut.boundingBox();
    expect(itemBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(shortcutBox).not.toBeNull();
    expect(shortcutBox!.x).toBeGreaterThan(labelBox!.x + labelBox!.width);
    expect(itemBox!.x + itemBox!.width - shortcutBox!.x - shortcutBox!.width).toBeLessThanOrEqual(10);
  });

  test('ignores Del outside real mod rows', async ({ page }) => {
    await openSkyrimBuild(page);

    const separatorRow = page.getByRole('row', { name: /Core fixes separator/ });
    const overwriteRow = page.getByRole('row', {
      name: /Skyrim graphics overhaul .* Output files folder overwrite folder/
    });
    const searchInput = page.getByLabel('Search mods');
    const deletionDialog = page.getByRole('dialog', { name: /Удаление мод/ });

    await separatorRow.focus();
    await separatorRow.press('Delete');
    await expect(deletionDialog).toHaveCount(0);

    await overwriteRow.focus();
    await overwriteRow.press('Delete');
    await expect(deletionDialog).toHaveCount(0);

    await searchInput.fill('SkyUI');
    await searchInput.press('Delete');
    await expect(deletionDialog).toHaveCount(0);
    expect((await callMethods(page)).filter((method) => method === 'mods.deleteInstalled')).toHaveLength(0);
  });
});

test('does not create browser text selection when dragging across a download row', async ({
  page
}) => {
  await openSkyrimBuild(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const downloadTitle = rightPane
    .getByRole('row', { name: /SmoothCam/ })
    .getByText('SmoothCam', { exact: true });
  const titleBox = await downloadTitle.boundingBox();
  expect(titleBox).not.toBeNull();

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(titleBox!.x + 2, titleBox!.y + titleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    titleBox!.x + titleBox!.width - 2,
    titleBox!.y + titleBox!.height / 2,
    { steps: 8 }
  );
  await page.mouse.up();

  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
});

test('selects only filtered downloads with Ctrl+A after clicking an installable row', async ({
  page
}) => {
  await openSkyrimBuild(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const downloadsTable = rightPane.getByRole('table', { name: 'Downloads' });
  const searchInput = rightPane.getByLabel('Search downloads');
  await searchInput.fill('Ready');

  const skyuiRow = downloadsTable.getByRole('row', { name: /SkyUI/ });
  const spidRow = downloadsTable.getByRole('row', {
    name: /Spell Perks Item Distributor \(SPID\)/
  });
  const aetheriusRow = downloadsTable.getByRole('row', {
    name: /Aetherius - A Race Overhaul/
  });
  await expect(downloadsTable.getByRole('row', { name: /SmoothCam/ })).toHaveCount(0);

  await skyuiRow.click();
  await expect(skyuiRow).toBeFocused();
  await page.keyboard.press('Control+A');

  await expect(skyuiRow).toHaveAttribute('aria-selected', 'true');
  await expect(spidRow).toHaveAttribute('aria-selected', 'true');
  await expect(aetheriusRow).toHaveAttribute('aria-selected', 'true');

  await searchInput.fill('');
  await expect(downloadsTable.getByRole('row', { name: /SmoothCam/ })).toHaveAttribute(
    'aria-selected',
    'false'
  );
});

test('keeps Ctrl+A text selection in the downloads search field', async ({ page }) => {
  await openSkyrimBuild(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const searchInput = rightPane.getByLabel('Search downloads');
  await searchInput.fill('SkyUI');
  await searchInput.press('Control+A');

  expect(
    await searchInput.evaluate((input) => ({
      start: (input as HTMLInputElement).selectionStart,
      end: (input as HTMLInputElement).selectionEnd
    }))
  ).toEqual({ start: 0, end: 'SkyUI'.length });
});

test.describe('deletes selected downloads with Del', () => {
  test('opens confirmation before deleting the focused download', async ({ page }) => {
    await openSkyrimBuild(page);

    const rightPane = page.getByLabel('Right pane');
    await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
    const downloadRow = rightPane.getByRole('row', { name: /SkyUI/ });
    await downloadRow.click();
    await downloadRow.press('Delete');

    const dialog = page.getByRole('dialog', { name: 'Удаление файла' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('SkyUI', { exact: true })).toBeVisible();
    expect(await callMethods(page)).not.toContain('downloads.delete');
  });

  test('confirms and deletes every download in the focused row selection', async ({ page }) => {
    await openSkyrimBuild(page);

    const rightPane = page.getByLabel('Right pane');
    await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
    const skyuiRow = rightPane.getByRole('row', { name: /SkyUI/ });
    const smoothcamRow = rightPane.getByRole('row', { name: /SmoothCam/ });
    await skyuiRow.click();
    await page.keyboard.down('Control');
    await smoothcamRow.click();
    await page.keyboard.up('Control');
    await smoothcamRow.press('Delete');

    const dialog = page.getByRole('dialog', { name: 'Удаление файлов' });
    await expect(dialog.getByText('2 файла', { exact: true })).toBeVisible();
    expect((await callMethods(page)).filter((method) => method === 'downloads.delete')).toHaveLength(0);

    await dialog.getByRole('button', { name: 'Удалить' }).click();
    await expect
      .poll(async () =>
        (await callMethods(page)).filter((method) => method === 'downloads.delete').length
      )
      .toBe(2);
  });

  test('shows the Del hint without changing the download delete menu item name', async ({ page }) => {
    await openSkyrimBuild(page);

    const rightPane = page.getByLabel('Right pane');
    await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
    await rightPane.getByRole('row', { name: /SkyUI/ }).click({ button: 'right' });

    const deleteItem = page.getByRole('menuitem', { name: 'Удалить', exact: true });
    const label = deleteItem.getByText('Удалить', { exact: true });
    const shortcut = deleteItem.getByText('Del', { exact: true });
    await expect(deleteItem).toBeVisible();
    await expect(deleteItem).toHaveAccessibleName('Удалить');
    await expect(deleteItem).toHaveAttribute('aria-keyshortcuts', 'Delete');
    await expect(shortcut).toBeVisible();

    const itemBox = await deleteItem.boundingBox();
    const labelBox = await label.boundingBox();
    const shortcutBox = await shortcut.boundingBox();
    expect(itemBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(shortcutBox).not.toBeNull();
    expect(shortcutBox!.x).toBeGreaterThan(labelBox!.x + labelBox!.width);
    expect(itemBox!.x + itemBox!.width - shortcutBox!.x - shortcutBox!.width).toBeLessThanOrEqual(10);
  });

  test('ignores Del in the downloads search field', async ({ page }) => {
    await openSkyrimBuild(page);

    const rightPane = page.getByLabel('Right pane');
    await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
    const searchInput = rightPane.getByLabel('Search downloads');
    await searchInput.fill('SkyUI');
    await searchInput.press('Delete');

    await expect(page.getByRole('dialog', { name: /Удаление файл/ })).toHaveCount(0);
    expect((await callMethods(page)).filter((method) => method === 'downloads.delete')).toHaveLength(0);
  });
});

test('asks for in-app confirmation before deleting mods, builds and downloaded files', async ({
  page
}) => {
  await openSkyrimBuild(page);

  const modRow = page.getByRole('row', { name: /SkyUI mod/ });
  await modRow.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Удалить', exact: true }).click();

  const modDialog = page.getByRole('dialog', { name: 'Удаление мода' });
  await expect(modDialog).toBeVisible();
  await expect(modDialog.getByText('SkyUI', { exact: true })).toBeVisible();
  expect(await callMethods(page)).not.toContain('mods.deleteInstalled');
  await modDialog.getByRole('button', { name: 'Удалить' }).click();
  await expect.poll(() => callMethods(page)).toContain('mods.deleteInstalled');
  await expect(page.locator('.operation-overlay')).toHaveCount(0);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const downloadRow = rightPane.getByRole('row', { name: /SkyUI/ });
  await downloadRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Удалить', exact: true }).click();

  const downloadDialog = page.getByRole('dialog', { name: 'Удаление файла' });
  await expect(downloadDialog).toBeVisible();
  await expect(downloadDialog.getByText('SkyUI', { exact: true })).toBeVisible();
  await expect(
    downloadDialog.getByText(
      'Архив будет удалён из глобальной библиотеки Downloads для всех сборок этой игры. Уже установленные моды останутся на месте.',
      { exact: true }
    )
  ).toBeVisible();
  expect(await callMethods(page)).not.toContain('downloads.delete');
  await downloadDialog.getByRole('button', { name: 'Закрыть окно удаления' }).click();
  await expect(downloadDialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Select Skyrim graphics overhaul' }).hover();
  await page.getByRole('button', { name: 'Skyrim graphics overhaul actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();

  const buildDialog = page.getByRole('dialog', { name: 'Удаление сборки' });
  await expect(buildDialog).toBeVisible();
  await expect(buildDialog.getByText('Skyrim graphics overhaul', { exact: true })).toBeVisible();
  expect(await callMethods(page)).not.toContain('projects.delete');
  await buildDialog.getByRole('button', { name: 'Закрыть окно удаления' }).click();
  await expect(buildDialog).toHaveCount(0);
});

test('enables the selected plugin from its row context menu', async ({ page }) => {
  await configureDisabledPluginToggleFixture(page);
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const pluginRow = page.getByRole('row', { name: /SkyUI\.esp plugin/ });
  await expect(pluginRow.getByRole('checkbox')).not.toBeChecked();
  await pluginRow.click({ button: 'right' });

  const enableSelected = page.getByRole('menuitem', {
    name: 'Включить выбранный плагин',
    exact: true
  });
  await expect(enableSelected).toBeEnabled();
  await enableSelected.click();

  await expect
    .poll(() => latestCallPayload(page, 'plugins.setEnabled'))
    .toMatchObject({
      isEnabled: true,
      pluginName: 'SkyUI.esp'
    });
  await expect(pluginRow.getByRole('checkbox')).toBeChecked();
});

test('enables every selected plugin from the plural row context action', async ({ page }) => {
  await configureDisabledPluginToggleFixture(page, ['RaceMenu.esp']);
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const skyuiRow = page.getByRole('row', { name: /SkyUI\.esp plugin/ });
  const racemenuRow = page.getByRole('row', { name: /RaceMenu\.esp plugin/ });
  await skyuiRow.click();
  await page.keyboard.down('Control');
  await racemenuRow.click();
  await page.keyboard.up('Control');
  await expect(skyuiRow).toHaveAttribute('data-selected', 'true');
  await expect(racemenuRow).toHaveAttribute('data-selected', 'true');

  await racemenuRow.click({ button: 'right' });
  const enableSelected = page.getByRole('menuitem', {
    name: 'Включить выбранные плагины',
    exact: true
  });
  await expect(enableSelected).toBeEnabled();
  await enableSelected.click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          (
            window as typeof window & {
              __fluxoraCalls?: Array<{ method: string; payload?: any }>;
            }
          ).__fluxoraCalls ?? []
        )
          .filter((call) => call.method === 'plugins.setEnabled')
          .map((call) => ({
            isEnabled: call.payload?.isEnabled,
            operationId: call.payload?.operation?.operationId,
            pluginName: call.payload?.pluginName
          }))
      )
    )
    .toEqual([
      {
        isEnabled: true,
        operationId: expect.stringMatching(/^op_/),
        pluginName: 'SkyUI.esp'
      },
      {
        isEnabled: true,
        operationId: expect.stringMatching(/^op_/),
        pluginName: 'RaceMenu.esp'
      }
    ]);

  const selectedToggleOperationIds = await page.evaluate(() =>
    (
      (
        window as typeof window & {
          __fluxoraCalls?: Array<{ method: string; payload?: any }>;
        }
      ).__fluxoraCalls ?? []
    )
      .filter((call) => call.method === 'plugins.setEnabled')
      .map((call) => call.payload?.operation?.operationId)
  );
  expect(new Set(selectedToggleOperationIds).size).toBe(1);
  await expect(skyuiRow.getByRole('checkbox')).toBeChecked();
  await expect(racemenuRow.getByRole('checkbox')).toBeChecked();
});

test('hides open-in-explorer actions for multi-selected mod and plugin rows', async ({ page }) => {
  await openSkyrimBuild(page);

  const modRow = page.getByRole('row', { name: /Unofficial Patch mod/ });
  const skyuiModRow = page.getByRole('row', { name: /SkyUI mod/ });
  await modRow.click();
  await page.keyboard.down('Control');
  await skyuiModRow.click();
  await page.keyboard.up('Control');
  await expect(modRow).toHaveAttribute('data-selected', 'true');
  await expect(skyuiModRow).toHaveAttribute('data-selected', 'true');
  await modRow.click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open folder' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const pluginRow = page.getByRole('row', { name: /SkyUI\.esp plugin/ });
  const skyrimPluginRow = page.getByRole('row', { name: /Skyrim\.esm plugin/ });
  await pluginRow.click();
  await page.keyboard.down('Control');
  await skyrimPluginRow.click();
  await page.keyboard.up('Control');
  await expect(pluginRow).toHaveAttribute('data-selected', 'true');
  await expect(skyrimPluginRow).toHaveAttribute('data-selected', 'true');
  await pluginRow.click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Открыть в проводнике' })).toHaveCount(0);
});

const moveRowDragToSlot = async (
  page: Page,
  source: Locator,
  target: Locator,
  placement: 'before' | 'after',
  dropChipText = 'Сюда'
) => {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const sourceX = sourceBox!.x + Math.min(140, sourceBox!.width / 2);
  const sourceY = sourceBox!.y + sourceBox!.height / 2;
  const targetX = targetBox!.x + Math.min(180, targetBox!.width / 2);
  const targetY =
    placement === 'before'
      ? targetBox!.y + 4
      : targetBox!.y + targetBox!.height - 4;

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 8, sourceY + 8, { steps: 2 });
  await page.mouse.move(targetX, targetY, { steps: 8 });
  await expect(target).toHaveAttribute('data-drop-target', 'true');
  await expect(target).toHaveAttribute('data-drop-placement', placement);
  await expect(target.locator('.row-drop-target-chip')).toHaveText(dropChipText);
};

const dragRowToSlot = async (
  page: Page,
  source: Locator,
  target: Locator,
  placement: 'before' | 'after'
) => {
  await moveRowDragToSlot(page, source, target, placement);
  await page.mouse.up();
};

const dragDownloadToModSlot = async (
  page: Page,
  source: Locator,
  target: Locator,
  placement: 'before' | 'after'
) => {
  await page.evaluate(() => {
    document.addEventListener('dragstart', (event) => event.preventDefault(), { capture: true });
  });
  await moveRowDragToSlot(page, source, target, placement, 'Установить сюда');
  await expect(source).toHaveAttribute('data-dragging', 'true');
  await expect(target).toHaveAttribute('data-install-drop-target', 'true');
  await page.mouse.up();
};

const dragDownloadIntoSeparator = async (
  page: Page,
  source: Locator,
  separator: Locator
) => {
  await page.evaluate(() => {
    document.addEventListener('dragstart', (event) => event.preventDefault(), { capture: true });
  });
  const sourceBox = await source.boundingBox();
  const separatorBox = await separator.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(separatorBox).not.toBeNull();

  const sourceX = sourceBox!.x + sourceBox!.width / 2;
  const sourceY = sourceBox!.y + sourceBox!.height / 2;
  const separatorX = separatorBox!.x + separatorBox!.width / 2;
  const separatorY = separatorBox!.y + separatorBox!.height / 2;

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 8, sourceY + 8, { steps: 2 });
  await page.mouse.move(separatorX, separatorY, { steps: 8 });
  await expect(source).toHaveAttribute('data-dragging', 'true');
  await expect(separator).toHaveAttribute('data-install-drop-target', 'true');
  await expect(separator).toHaveAttribute('data-drop-placement', 'inside');
  await expect
    .poll(() => separator.evaluate((row) => window.getComputedStyle(row, '::after').borderStyle))
    .toBe('solid');
  await page.mouse.up();
};

const latestCallPayload = async (page: Page, method: string) =>
  page.evaluate((methodName) => {
    const calls =
      (window as typeof window & { __fluxoraCalls?: Array<{ method: string; payload?: unknown }> })
        .__fluxoraCalls ?? [];
    return calls.filter((call) => call.method === methodName).at(-1)?.payload ?? null;
  }, method);

const callMethods = async (page: Page) =>
  page.evaluate(() =>
    (
      (window as typeof window & { __fluxoraCalls?: Array<{ method: string; payload?: unknown }> })
        .__fluxoraCalls ?? []
    ).map((call) => call.method)
  );

test('resolves the Nexus 1.0.0 to 1.0.1 conflict with Replace', async ({ page }) => {
  await openSkyrimBuildWithDuplicateDecision(page);

  await page.getByRole('button', { name: 'Заменить', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Обновление архива Nexus' })).toBeHidden();
  await expect.poll(() => latestCallPayload(page, 'downloads.resolveDuplicateDecision')).toMatchObject({
    choice: 'replace',
    decisionId: 'decision-skyui-100-to-101',
    operation: { operationId: expect.stringContaining('downloads_resolve_duplicate') }
  });

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await expect(rightPane.getByRole('row', { name: /SkyUI 1\.0\.1/ })).toBeVisible();
});

test('resolves the Nexus 1.0.0 to 1.0.1 conflict with Keep both', async ({ page }) => {
  await openSkyrimBuildWithDuplicateDecision(page);

  await page.getByRole('button', { name: 'Сохранить оба', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Обновление архива Nexus' })).toBeHidden();
  await expect.poll(() => latestCallPayload(page, 'downloads.resolveDuplicateDecision')).toMatchObject({
    choice: 'keepBoth',
    decisionId: 'decision-skyui-100-to-101'
  });

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await expect(rightPane.getByRole('row', { name: /SkyUI 1\.0\.1 \(2\)/ })).toBeVisible();
});

test('closing the Nexus archive conflict cancels only the pending request', async ({ page }) => {
  await openSkyrimBuildWithDuplicateDecision(page);

  await page.getByRole('button', { name: 'Отменить загрузку' }).click();
  await expect(page.getByRole('dialog', { name: 'Обновление архива Nexus' })).toBeHidden();
  await expect.poll(() => latestCallPayload(page, 'downloads.resolveDuplicateDecision')).toMatchObject({
    choice: 'cancel',
    decisionId: 'decision-skyui-100-to-101'
  });

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await expect(rightPane.getByText('Нужно решение', { exact: true })).toHaveCount(0);
  await expect(rightPane.getByRole('row', { name: /SkyUI/ }).first()).toBeVisible();
});

const rightPaneTransientSnapshot = async (page: Page) =>
  page.locator('.build-pane[aria-label="Right pane"]').evaluate((pane) => {
    const textOf = (element: Element) => element.textContent?.trim() ?? '';
    return {
      busyStripText: Array.from(pane.querySelectorAll('.mod-busy-strip')).map(textOf),
      downloadDropCueCount: pane.querySelectorAll('.download-drop-cue').length,
      downloadDropState:
        pane.querySelector('.download-drop-surface')?.getAttribute('data-drop-state') ?? null,
      pluginLoadingCount: pane.querySelectorAll(
        '.plugin-table--loading, .plugin-row--skeleton, .workspace-skeleton'
      ).length,
      rowDropTargetCount: pane.querySelectorAll(
        '.mod-list-row[data-drop-target="true"], .plugin-row[data-drop-target="true"]'
      ).length
    };
  });

const expectNoDocumentHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth
  }));

  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.documentClientWidth + 2);
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.bodyClientWidth + 2);
};

const elementFocusIndicator = async (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element as HTMLElement);

    return {
      hasIndicator:
        (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') ||
        style.boxShadow !== 'none',
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow
    };
  });

const expectSolidFocusBand = async (
  control: Locator,
  surfaceSelector?: string
) => {
  await expect
    .poll(() =>
      control.evaluate((element, selector) => {
        const surface = selector ? element.closest(selector) : element;
        if (!(surface instanceof HTMLElement)) {
          throw new Error(`Expected a focus surface matching ${selector}.`);
        }

        const style = getComputedStyle(surface);
        const controlStyle = getComputedStyle(element);
        return {
          borderColor: style.borderTopColor,
          boxShadow: style.boxShadow,
          controlBoxShadow: controlStyle.boxShadow,
          controlOutlineStyle: controlStyle.outlineStyle
        };
      }, surfaceSelector)
    )
    .toEqual({
      borderColor: 'rgb(248, 202, 98)',
      boxShadow: 'rgb(248, 202, 98) 0px 0px 0px 3px',
      controlBoxShadow: surfaceSelector
        ? 'none'
        : 'rgb(248, 202, 98) 0px 0px 0px 3px',
      controlOutlineStyle: 'none'
    });
};

const capturePhase13Screenshot = async (
  page: Page,
  testInfo: { outputPath(path: string): string },
  surface: string,
  size: (typeof visualReviewSizes)[number]
) => {
  await expectNoDocumentHorizontalOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`phase13-${surface}-${size.width}x${size.height}.png`)
  });
};

test('selects, opens and creates builds from the redesigned library home', async ({ page }) => {
  await page.goto(baseUrl);

  await expect(page.getByLabel('Build library sidebar')).toBeVisible();
  await expect(page.getByText('2 builds')).toBeVisible();
  await expect(page.getByText('Choose a build')).toBeVisible();

  await clickSkyrimBuildSelectButton(page);
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();

  await clickSkyrimBuildOpenButton(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('projects.openConfig');

  await page.getByLabel('Home').click();
  await page.getByRole('button', { name: 'New build' }).first().click();
  const buildNameInput = page.getByPlaceholder('My Skyrim build');
  await buildNameInput.fill('  Playwright build  ');
  await buildNameInput.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(buildNameInput).toBeFocused();
  await expectSolidFocusBand(buildNameInput);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByPlaceholder('Path to game executable').fill('C:\\Games\\Skyrim\\SkyrimSE.exe');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByPlaceholder('Folder for Fluxora builds').fill('D:\\Fluxora\\Builds');
  await page.getByRole('button', { name: 'Create' }).click();

  await expect
    .poll(() => latestCallPayload(page, 'projects.create'))
    .toMatchObject({
      operation: {
        operationId: expect.stringContaining('projects_create')
      },
      request: {
        gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
        installRootDirectory: 'D:\\Fluxora\\Builds',
        projectName: 'Playwright build',
        templateId: 'skyrim-special-edition'
      }
    });
  await expect(page.getByRole('heading', { name: 'Playwright build' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Select Skyrim graphics overhaul' }).click();
  const skyrimSummary = page.getByRole('article', { name: 'Skyrim graphics overhaul summary' });
  await expect(skyrimSummary.getByText('248', { exact: true })).toBeVisible();
});

test('renames a build in the Fluxora dialog with complete keyboard behavior', async ({ page }) => {
  await page.goto(baseUrl);
  await clickSkyrimBuildSelectButton(page);

  const openRenameDialog = async () => {
    await page
      .getByRole('button', { name: 'Skyrim graphics overhaul actions' })
      .click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    return page.getByRole('dialog', { name: 'Rename build' });
  };

  let dialog = await openRenameDialog();
  const initialInput = dialog.getByRole('textbox', { name: 'New build name' });
  const closeButton = dialog.getByRole('button', { name: 'Close build rename' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Rename build' })).toBeVisible();
  await expect(dialog.getByText('Skyrim Special Edition', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  expect(
    await dialog.evaluate((dialogElement) => {
      const header = dialogElement.querySelector('.build-rename-dialog__header');
      const title = dialogElement.querySelector('#build-rename-dialog-title');
      if (!(header instanceof HTMLElement) || !(title instanceof HTMLElement)) {
        throw new Error('Expected the compact rename dialog header and title.');
      }

      const dialogRect = dialogElement.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      return {
        headerHeight: headerRect.height,
        titleCenterOffset: Math.abs(
          titleRect.left + titleRect.width / 2 -
            (dialogRect.left + dialogRect.width / 2)
        )
      };
    })
  ).toMatchObject({
    headerHeight: 44,
    titleCenterOffset: 0
  });
  await expect(initialInput).toBeFocused();
  await expect(initialInput).toHaveValue('Skyrim graphics overhaul');
  await expect(dialog.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();
  await initialInput.press('Tab');
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(initialInput).toBeFocused();
  await expectSolidFocusBand(initialInput, '.flx-input');
  expect(
    await initialInput.evaluate((input) => {
      const control = input as HTMLInputElement;
      return {
        end: control.selectionEnd,
        length: control.value.length,
        start: control.selectionStart
      };
    })
  ).toEqual({
    end: 'Skyrim graphics overhaul'.length,
    length: 'Skyrim graphics overhaul'.length,
    start: 0
  });
  await initialInput.press('Tab');
  await expect(closeButton).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => latestCallPayload(page, 'projects.rename'))
    .toBeNull();

  dialog = await openRenameDialog();
  await dialog.getByRole('textbox', { name: 'New build name' }).fill('Skyrim Ascendant');
  await dialog.getByRole('textbox', { name: 'New build name' }).press('Enter');

  await expect
    .poll(() => latestCallPayload(page, 'projects.rename'))
    .toMatchObject({
      configPath: 'D:\\Fluxora\\Configs\\skyrim-main.json',
      newName: 'Skyrim Ascendant',
      operation: {
        operationId: expect.stringContaining('projects_rename')
      }
    });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Skyrim Ascendant' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Select Skyrim graphics overhaul' })
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select Skyrim Ascendant' })).toHaveCount(1);
  await expect(page.getByText('2 builds', { exact: true })).toBeVisible();
});

test('keeps the build rename dialog open and actionable after a native rename error', async ({
  page
}) => {
  await page.goto(baseUrl);
  await page.evaluate(() =>
    window.localStorage.setItem('fluxora.test.renameFailure', 'true')
  );
  await clickSkyrimBuildSelectButton(page);
  await page
    .getByRole('button', { name: 'Skyrim graphics overhaul actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Rename build' });
  const input = dialog.getByRole('textbox', { name: 'New build name' });
  await input.fill('Existing build');
  await input.press('Enter');

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText(
    'A build with this name already exists.'
  );
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Rename', exact: true })).toBeEnabled();
});

test('does not open a build when its row actions are double-clicked', async ({ page }) => {
  await page.goto(baseUrl);

  const callsBefore = await page.evaluate(
    () =>
      (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls?.filter(
        (call) => call.method === 'projects.openConfig'
      ).length ?? 0
  );

  await page.getByRole('button', { name: 'Skyrim graphics overhaul actions' }).dblclick();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls?.filter(
            (call) => call.method === 'projects.openConfig'
          ).length ?? 0
      )
    )
    .toBe(callsBefore);

  await page.getByRole('button', { name: 'Select Skyrim graphics overhaul' }).dblclick();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls?.filter(
            (call) => call.method === 'projects.openConfig'
          ).length ?? 0
      )
    )
    .toBe(callsBefore + 1);

  await page.goto(baseUrl);
  await clickSkyrimBuildSelectButton(page);
  const callsBeforeOpenButton = await page.evaluate(
    () =>
      (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls?.filter(
        (call) => call.method === 'projects.openConfig'
      ).length ?? 0
  );
  await page.getByRole('button', { name: 'Open Skyrim graphics overhaul' }).dblclick();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls?.filter(
            (call) => call.method === 'projects.openConfig'
          ).length ?? 0
      )
    )
    .toBe(callsBeforeOpenButton + 1);
});

test('uses semantic build lists with visible keyboard focus', async ({ page }) => {
  await page.goto(baseUrl);

  const buildList = page.getByRole('list', { name: 'Fluxora builds' });
  await expect(buildList.getByRole('listitem')).toHaveCount(2);

  const selectButton = page.getByRole('button', { name: 'Select Skyrim graphics overhaul' });
  await page.getByRole('textbox', { name: 'Search builds' }).focus();
  await page.keyboard.press('Tab');
  await expect(selectButton).toBeFocused();
  expect(await elementFocusIndicator(selectButton)).toMatchObject({ hasIndicator: true });

  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
});

test('keeps runtime metrics scoped to the build that loaded them', async ({ page }) => {
  await openSkyrimBuild(page);
  await page.getByRole('button', { name: 'Home' }).click();

  await page.getByRole('button', { name: 'Select Fallout test lab' }).click();

  const falloutSummary = page.getByRole('article', { name: 'Fallout test lab summary' });
  await expect(falloutSummary).toBeVisible();
  await expect(falloutSummary.getByText('64', { exact: true })).toBeVisible();
});

test('restores the previous workspace after cancelling a build open', async ({ page }) => {
  await openSkyrimBuild(page);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.evaluate(() => {
    (window as typeof window & { __fluxoraPersistedWorkspaceDelayMs?: number }).__fluxoraPersistedWorkspaceDelayMs =
      2_500;
  });

  await page.getByRole('button', { name: 'Open Fallout test lab' }).click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  const newBuildButton = page.getByRole('button', { name: 'New build' }).first();
  await expect(newBuildButton).toBeDisabled();
  await page.evaluate(() => {
    (window as typeof window & { __fluxoraPersistedWorkspaceDelayMs?: number }).__fluxoraPersistedWorkspaceDelayMs =
      0;
  });

  const skyrimSummary = page.getByRole('article', { name: 'Skyrim graphics overhaul summary' });
  await expect(skyrimSummary).toBeVisible();
  await expect(skyrimSummary.getByText('2', { exact: true })).toBeVisible();
  await expect(newBuildButton).toBeEnabled();
});

test('restores the active non-default profile after cancelling a build open', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: any }>;
      fluxora: any;
    };
    const getWorkspace = scope.fluxora.mods.getWorkspace;
    scope.fluxora.profiles.list = async () => ['Default', 'Testing'];
    scope.fluxora.mods.getWorkspace = async (
      projectDirectory: string,
      profileName: string,
      operation: unknown
    ) => {
      scope.__fluxoraCalls?.push({
        method: 'test.mods.getWorkspace',
        payload: { operation, profileName, projectDirectory }
      });
      return getWorkspace(projectDirectory, profileName, operation);
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  const profileSelect = page.getByRole('combobox', { name: 'Profile' });
  await profileSelect.click();
  await page.getByRole('option', { name: 'Testing' }).click();
  await expect(profileSelect).toContainText('Testing');
  await page.getByRole('button', { name: 'Home' }).click();
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: unknown }>;
      __fluxoraPersistedWorkspaceDelayMs?: number;
    };
    scope.__fluxoraCalls?.splice(0);
    scope.__fluxoraPersistedWorkspaceDelayMs = 2_500;
  });

  await page.getByRole('button', { name: 'Open Fallout test lab' }).click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.evaluate(() => {
    (window as typeof window & { __fluxoraPersistedWorkspaceDelayMs?: number }).__fluxoraPersistedWorkspaceDelayMs =
      0;
  });
  await expect(page.getByRole('button', { name: 'New build' }).first()).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (window as typeof window & {
          __fluxoraCalls?: Array<{ method: string; payload?: any }>;
        }).__fluxoraCalls;
        return calls
          ?.filter(
            (call) =>
              call.method === 'test.mods.getWorkspace' &&
              String(call.payload?.projectDirectory).includes('Skyrim graphics overhaul')
          )
          .at(-1)?.payload?.profileName;
      })
    )
    .toBe('Testing');
});

test('ignores a stale store response after another build opens', async ({ page }) => {
  await openSkyrimBuild(page);
  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await expect(rightPane.getByRole('row', { name: /SkyUI/ })).toBeVisible();
  await page.evaluate(() => {
    const facade = (window as typeof window & { fluxora: any }).fluxora;
    const listDownloads = facade.downloads.list;
    let delayNextSkyrimLoad = true;
    facade.downloads.list = async (projectDirectory: string, ...args: unknown[]) => {
      if (delayNextSkyrimLoad && projectDirectory.includes('Skyrim graphics overhaul')) {
        delayNextSkyrimLoad = false;
        await new Promise((resolve) => setTimeout(resolve, 1_200));
      }
      return listDownloads(projectDirectory, ...args);
    };
  });

  await page.keyboard.press('F5');
  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Open Fallout test lab' }).click();
  await expect(page.getByRole('heading', { name: 'Fallout test lab' })).toBeVisible();
  await page.waitForTimeout(1_400);
  const falloutRightPane = page.getByLabel('Right pane');
  await expect(falloutRightPane.getByRole('row', { name: /SkyUI/ })).toHaveCount(0);
  await expect(falloutRightPane.getByRole('textbox', { name: 'Search downloads' })).toBeEnabled();
});

test('shows one global archive with independent statuses for two builds of the same game', async ({
  page
}) => {
  await page.goto(baseUrl);
  await page.evaluate(() => window.localStorage.setItem('fluxora.test.sameGameBuild', 'true'));
  await page.reload();
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: unknown }>;
      fluxora: any;
    };
    const listDownloads = scope.fluxora.downloads.list;
    scope.fluxora.downloads.list = async (projectDirectory: string, ...args: unknown[]) => {
      const rows = await listDownloads(projectDirectory, ...args);
      const skyUi = rows.find((entry: { id?: string }) => entry.id === 'skyui_archive');
      scope.__fluxoraCalls?.push({
        method: 'downloads.list.same-game',
        payload: { projectDirectory, skyUi }
      });
      return rows;
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  const firstPane = page.getByLabel('Right pane');
  await firstPane.getByRole('tab', { name: /Загрузки/ }).click();
  await expect(firstPane.getByRole('row', { name: /SkyUI/ }).getByText('Ready', { exact: true }))
    .toBeVisible();

  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Open Skyrim performance profile' }).click();
  await expect(page.getByRole('heading', { name: 'Skyrim performance profile' })).toBeVisible();
  const secondPane = page.getByLabel('Right pane');
  await secondPane.getByRole('tab', { name: /Загрузки/ }).click();
  await expect(secondPane.getByRole('row', { name: /SkyUI/ }).getByText('Deleted', { exact: true }))
    .toBeVisible();

  const snapshots = await page.evaluate(() => {
    const calls = (window as typeof window & {
      __fluxoraCalls?: Array<{
        method: string;
        payload?: {
          projectDirectory?: string;
          skyUi?: { archiveId?: string; buildStatus?: string; localPath?: string };
        };
      }>;
    }).__fluxoraCalls ?? [];
    const byProject = new Map<string, { archiveId?: string; buildStatus?: string; localPath?: string }>();
    for (const call of calls) {
      if (call.method === 'downloads.list.same-game' && call.payload?.projectDirectory) {
        byProject.set(call.payload.projectDirectory, call.payload.skyUi ?? {});
      }
    }
    return [...byProject.entries()];
  });
  const main = snapshots.find(([projectDirectory]) =>
    projectDirectory.includes('Skyrim graphics overhaul')
  )?.[1];
  const secondary = snapshots.find(([projectDirectory]) =>
    projectDirectory.includes('Skyrim performance profile')
  )?.[1];

  expect(main).toMatchObject({
    archiveId: `sha256:${'a'.repeat(64)}`,
    buildStatus: 'Ready',
    localPath: 'D:\\Fluxora\\Downloads\\skyrimse\\SkyUI.7z'
  });
  expect(secondary).toMatchObject({
    archiveId: main?.archiveId,
    buildStatus: 'Deleted',
    localPath: main?.localPath
  });
});

test('shows optimistic Installing before the persisted archive status becomes Installed', async ({
  page
}) => {
  await openSkyrimBuild(page);
  await page.evaluate(() => window.localStorage.setItem('fluxora.test.installDelayMs', '900'));

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const skyUiRow = rightPane.getByRole('row', { name: /SkyUI/ });
  await skyUiRow.dblclick();

  const dialog = page.getByRole('dialog', { name: /SkyUI/ });
  await dialog.getByRole('button', { name: 'Установить', exact: true }).click();
  await dialog.getByRole('button', { name: /Объединить/ }).click();

  await expect(skyUiRow.getByText('Installing', { exact: true })).toBeVisible({ timeout: 500 });
  await expect(skyUiRow.getByText('Installed', { exact: true })).toBeVisible({ timeout: 5_000 });
});

test('deleting a pending mod cancels its durable install and it does not reappear', async ({
  page
}) => {
  await openSkyrimBuild(page);
  await page.evaluate(() => window.localStorage.setItem('fluxora.test.installDelayMs', '900'));

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await rightPane.getByRole('row', { name: /Aetherius - A Race Overhaul/ }).dblclick();
  const installDialog = page.getByRole('dialog', { name: /Aetherius - A Race Overhaul/ });
  await installDialog.getByRole('button', { name: 'Установить', exact: true }).click();

  const pendingRow = page.locator('.mod-list-row').filter({
    hasText: 'Aetherius - A Race Overhaul'
  });
  await expect(pendingRow).toHaveAttribute('data-order-id', /^pending-install:/);
  await pendingRow.click();
  await pendingRow.press('Delete');
  await page.getByRole('dialog', { name: 'Удаление мода' })
    .getByRole('button', { name: 'Удалить' })
    .click();

  await expect.poll(() => callMethods(page)).toContain('installs.cancel');
  await expect(pendingRow).toHaveCount(0);
  await page.waitForTimeout(1_100);
  await expect(pendingRow).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).__fluxoraCalls.filter(
        (call: { method: string; payload?: { modId?: string } }) =>
          call.method === 'mods.deleteInstalled' &&
          String(call.payload?.modId ?? '').startsWith('pending-install:')
      ).length
    )
  ).toBe(0);
});

test('keeps the standard install dialog stable while its skeleton resolves', async ({ page }) => {
  await openSkyrimBuild(page);
  await page.evaluate(() => window.localStorage.setItem('fluxora.test.fomodAnalyzeDelayMs', '900'));

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();

  const dialog = page.getByRole('dialog', { name: /SkyUI/ });
  const dialogSurface = dialog.locator('.install-dialog');
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect(dialog.locator('.install-dialog-title')).toHaveText('Установка мода');

  const detectingBox = await dialogSurface.boundingBox();
  const shimmer = await dialog.locator('.workspace-skeleton').first().evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationIterationCount: style.animationIterationCount,
      animationName: style.animationName,
      animationTimingFunction: style.animationTimingFunction,
      backgroundRepeat: style.backgroundRepeat
    };
  });
  expect(shimmer).toEqual({
    animationIterationCount: 'infinite',
    animationName: 'downloadSkeletonSweep',
    animationTimingFunction: 'linear',
    backgroundRepeat: 'no-repeat'
  });

  await expect(dialog).toHaveAttribute('aria-busy', 'false');
  await expect(dialog.getByRole('button', { name: 'Установить', exact: true })).toBeVisible();
  const optionsBox = await dialogSurface.boundingBox();

  expect(detectingBox).not.toBeNull();
  expect(optionsBox).not.toBeNull();
  expect(detectingBox?.width).toBe(optionsBox?.width);
  expect(detectingBox?.height).toBe(optionsBox?.height);
});

test('keeps download search input usable after closing the install dialog', async ({ page }) => {
  await openSkyrimBuild(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();

  const dialog = page.getByRole('dialog', { name: /SkyUI/ });
  await dialog.getByRole('button', { name: 'Закрыть окно установки' }).click();
  await expect(dialog).toHaveCount(0);

  const searchInput = rightPane.getByRole('textbox', { name: 'Search downloads' });
  await searchInput.focus();
  await page.keyboard.down('Alt');
  await page.keyboard.press('Shift');
  await page.keyboard.up('Alt');
  await expect(searchInput).toBeFocused();

  await searchInput.pressSequentially('skyui');
  await expect(searchInput).toHaveValue('skyui');
  await expect(rightPane.getByRole('row', { name: /SkyUI/ })).toBeVisible();
});

test('imports an external archive before starting install from the global Downloads path', async ({
  page
}) => {
  await openSkyrimBuild(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const dropSurface = rightPane.locator('.download-drop-surface');
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'D:\\Incoming\\SkyUI.7z');
    return transfer;
  });
  await dropSurface.dispatchEvent('drop', { dataTransfer });
  await dataTransfer.dispose();

  await expect.poll(() => latestCallPayload(page, 'downloads.importFile')).toMatchObject({
    archivePath: 'D:\\Incoming\\SkyUI.7z',
    projectDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul'
  });
  await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();
  await expect.poll(() => latestCallPayload(page, 'downloads.planInstall')).toMatchObject({
    projectDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul',
    sourcePath: 'D:\\Fluxora\\Downloads\\skyrimse\\SkyUI.7z'
  });

  const orderedMethods = await page.evaluate(() =>
    (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
      ?.map((call) => call.method)
      .filter((method) => method === 'downloads.importFile' || method === 'downloads.planInstall') ?? []
  );
  expect(orderedMethods).toEqual(['downloads.importFile', 'downloads.planInstall']);
});

test('renders the computed global Downloads path as read-only and opens it', async ({ page }) => {
  const configPath = 'D:\\Fluxora\\Configs\\skyrim-main.json';
  await page.goto(
    `${baseUrl}/?window=build-settings&project=${encodeURIComponent(configPath)}&name=${encodeURIComponent('Skyrim graphics overhaul')}`
  );

  const downloadsPath = page.getByRole('textbox', { name: 'Global downloads directory' });
  await expect(downloadsPath).toHaveValue('D:\\Fluxora\\Downloads\\skyrimse');
  await expect(downloadsPath).toHaveAttribute('readonly', '');
  const downloadsField = downloadsPath.locator('xpath=ancestor::label');
  await expect(downloadsField.getByRole('button', { name: 'Browse' })).toHaveCount(0);

  await downloadsField.getByRole('button', { name: 'Open downloads directory' }).click();
  await expect.poll(() => latestCallPayload(page, 'shell.openPath')).toEqual({
    path: 'D:\\Fluxora\\Downloads\\skyrimse'
  });
});

test('ignores refresh shortcuts while a build is opening', async ({ page }) => {
  await openSkyrimBuild(page);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.evaluate(() => {
    (window as typeof window & { __fluxoraPersistedWorkspaceDelayMs?: number }).__fluxoraPersistedWorkspaceDelayMs =
      900;
  });

  await page.getByRole('button', { name: 'Open Fallout test lab' }).click();
  await expect(page.getByRole('button', { name: 'Отмена', exact: true })).toBeVisible();
  await page.keyboard.press('Control+R');
  await page.evaluate(() => {
    (window as typeof window & { __fluxoraPersistedWorkspaceDelayMs?: number }).__fluxoraPersistedWorkspaceDelayMs =
      0;
  });

  await expect(page.getByRole('heading', { name: 'Fallout test lab' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отмена', exact: true })).toBeHidden();
});

test('does not attach partial workspace data after a failed build open', async ({ page }) => {
  await openSkyrimBuild(page);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.evaluate(() => {
    const facade = (window as typeof window & { fluxora: any }).fluxora;
    const getPersistedWorkspace = facade.mods.getPersistedWorkspace;
    facade.mods.getPersistedWorkspace = async (projectDirectory: string, ...args: unknown[]) => {
      if (projectDirectory.includes('Fallout test lab')) {
        throw new Error('Simulated Fallout workspace failure');
      }
      return getPersistedWorkspace(projectDirectory, ...args);
    };
  });

  await page.getByRole('button', { name: 'Open Fallout test lab' }).click();

  const skyrimSummary = page.getByRole('article', { name: 'Skyrim graphics overhaul summary' });
  await expect(skyrimSummary).toBeVisible();
  await expect(skyrimSummary.getByText('2', { exact: true })).toBeVisible();
});

test('restores the previous workspace when plugin loading fails', async ({ page }) => {
  await openSkyrimBuild(page);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.evaluate(() => {
    const facade = (window as typeof window & { fluxora: any }).fluxora;
    const listPersistedPlugins = facade.plugins.listPersisted;
    facade.plugins.listPersisted = async (projectDirectory: string, ...args: unknown[]) => {
      if (projectDirectory.includes('Fallout test lab')) {
        throw new Error('Simulated Fallout plugin failure');
      }
      return listPersistedPlugins(projectDirectory, ...args);
    };
  });

  await page.getByRole('button', { name: 'Open Fallout test lab' }).click();

  const skyrimSummary = page.getByRole('article', { name: 'Skyrim graphics overhaul summary' });
  await expect(skyrimSummary).toBeVisible();
  await expect(skyrimSummary.getByText('2', { exact: true })).toBeVisible();
});

test('reconciles exact plugins after the persisted project-open snapshot', async ({ page }) => {
  await openSkyrimBuild(page);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const methods =
          (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
            ?.map((call) => call.method) ?? [];
        const persistedIndex = methods.indexOf('plugins.listPersisted');
        const exactIndex = methods.indexOf('plugins.list');
        return persistedIndex >= 0 && exactIndex > persistedIndex;
      })
    )
    .toBe(true);
});

test('keeps persisted plugin rows usable when background exact discovery fails', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const facade = (window as typeof window & { fluxora: any }).fluxora;
    const listPlugins = facade.plugins.list;
    facade.plugins.list = async (...args: unknown[]) => {
      await listPlugins(...args);
      throw new Error('Simulated background plugin discovery failure');
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.some((call) => call.method === 'plugins.list')
      )
    )
    .toBe(true);

  const pluginsTable = page.getByRole('table', { name: 'Plugin load order' });
  await expect(pluginsTable).toBeVisible();
  await expect(pluginsTable.getByRole('row', { name: /Skyrim.esm/ })).toBeVisible();
  await expect(page.getByText('Plugins unavailable')).toHaveCount(0);
});

test('continues exact T4 reconciliation when deferred downloads fail', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const facade = (window as typeof window & { fluxora: any }).fluxora;
    const listDownloads = facade.downloads.list;
    facade.downloads.list = async (...args: unknown[]) => {
      await listDownloads(...args);
      throw new Error('Simulated deferred downloads failure');
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  await expect(page.getByRole('row', { name: /SkyUI mod/ })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.some((call) => call.method === 'plugins.list')
      )
    )
    .toBe(true);
});

test('opens mod properties from the second rapid click without waiting for row selection', async ({
  page
}) => {
  await openSkyrimBuild(page);

  const modRow = page.getByRole('row', { name: /SkyUI mod/ });
  await modRow.dispatchEvent('click', { detail: 1 });
  await modRow.dispatchEvent('click', { detail: 2 });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls =
          (window as typeof window & {
            __fluxoraCalls?: Array<{ method: string; payload?: { args?: unknown[] } }>;
          }).__fluxoraCalls ?? [];
        return {
          contentCalls: calls.filter((call) => call.method === 'mods.getModDetailsContent').length,
          contentIndex: calls.findIndex((call) => call.method === 'mods.getModDetailsContent'),
          openIndex: calls.findIndex((call) => call.method === 'window.openModDetails'),
          bootstrap: calls.find((call) => call.method === 'window.openModDetails')?.payload?.args?.[5]
        };
      })
    )
    .toMatchObject({
      contentCalls: 1,
      contentIndex: expect.any(Number),
      openIndex: expect.any(Number),
      bootstrap: {
        content: {
          directories: expect.any(Array),
          conflictTree: expect.any(Object)
        }
      }
    });

  const callOrder = await page.evaluate(() => {
    const calls =
      (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls ?? [];
    return {
      contentIndex: calls.findIndex((call) => call.method === 'mods.getModDetailsContent'),
      openIndex: calls.findIndex((call) => call.method === 'window.openModDetails')
    };
  });
  expect(callOrder.contentIndex).toBeGreaterThanOrEqual(0);
  expect(callOrder.openIndex).toBeGreaterThan(callOrder.contentIndex);
});

test('uses one exact mod fallback before T3 when the persisted snapshot is unprepared', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      fluxora: any;
      __fluxoraCalls?: Array<{ method: string; payload?: unknown }>;
    };
    const exactWorkspace = testWindow.fluxora.mods.getWorkspace;
    testWindow.fluxora.mods.getPersistedWorkspace = async () => ({
      installedMods: [],
      modOrder: []
    });
    testWindow.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      testWindow.__fluxoraCalls?.push({ method: 'mods.getWorkspace.exact-fallback' });
      return exactWorkspace(...args);
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  await expect(page.getByRole('row', { name: /SkyUI mod/ })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.some((call) => call.method === 'plugins.list')
      )
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.filter((call) => call.method === 'mods.getWorkspace.exact-fallback').length
      )
    )
    .toBe(1);
});

test('reuses exact mod reconciliation while the same project watcher remains active', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      fluxora: any;
      __fluxoraCalls?: Array<{ method: string; payload?: unknown }>;
    };
    const exactWorkspace = testWindow.fluxora.mods.getWorkspace;
    testWindow.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      testWindow.__fluxoraCalls?.push({ method: 'mods.getWorkspace.watched-exact' });
      return exactWorkspace(...args);
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.filter((call) => call.method === 'plugins.list').length
      )
    )
    .toBe(1);

  await page.getByRole('button', { name: 'Home' }).click();
  await clickSkyrimBuildOpenButton(page);
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.filter((call) => call.method === 'plugins.list').length
      )
    )
    .toBeGreaterThan(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.filter((call) => call.method === 'mods.getWorkspace.watched-exact').length
      )
    )
    .toBe(1);
});

test('requires exact mods after watcher coverage leaves and returns to a project', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: unknown }>;
      fluxora: any;
    };
    const exactWorkspace = scope.fluxora.mods.getWorkspace;
    const listDownloads = scope.fluxora.downloads.list;
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      scope.__fluxoraCalls?.push({ method: 'mods.getWorkspace.coverage-gap' });
      return exactWorkspace(...args);
    };
    scope.fluxora.downloads.list = async (projectDirectory: string, ...args: unknown[]) => {
      scope.__fluxoraCalls?.push({
        method: 'downloads.list.coverage-gap',
        payload: { projectDirectory }
      });
      return listDownloads(projectDirectory, ...args);
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'mods.getWorkspace.coverage-gap'
        ).length
      )
    )
    .toBe(1);

  await page.getByRole('button', { name: 'Home' }).click();
  await page.evaluate(() => {
    (window as any).__fluxoraDownloadsListDelayMs = 2_500;
  });
  await page.getByRole('button', { name: 'Open Fallout test lab' }).click();
  await expect(page.getByRole('heading', { name: 'Fallout test lab' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.some(
          (call: { method: string; payload?: { projectDirectory?: string } }) =>
            call.method === 'downloads.list.coverage-gap' &&
            call.payload?.projectDirectory?.includes('Fallout test lab')
        )
      )
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Home' }).click();
  await page.evaluate(() => {
    (window as any).__fluxoraDownloadsListDelayMs = 0;
  });
  await clickSkyrimBuildOpenButton(page);
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'mods.getWorkspace.coverage-gap'
        ).length
      )
    )
    .toBe(3);
});

test('requires exact mods after profile watcher coverage leaves and returns', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: any }>;
      fluxora: any;
    };
    const exactWorkspace = scope.fluxora.mods.getWorkspace;
    scope.fluxora.profiles.list = async () => ['Default', 'Testing'];
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      scope.__fluxoraCalls?.push({ method: 'mods.getWorkspace.profile-coverage-gap' });
      return exactWorkspace(...args);
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'mods.getWorkspace.profile-coverage-gap'
        ).length
      )
    )
    .toBe(1);

  const profileSelect = page.getByRole('combobox', { name: 'Profile' });
  await profileSelect.click();
  await page.getByRole('option', { name: 'Testing' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.some(
          (call: { method: string; payload?: { watchRequest?: { profileName?: string } } }) =>
            call.method === 'buildContent.watch' && call.payload?.watchRequest?.profileName === 'Testing'
        )
      )
    )
    .toBe(true);
  const exactCallsBeforeDefaultReturns = await page.evaluate(() =>
    (window as any).__fluxoraCalls.filter(
      (call: { method: string }) => call.method === 'mods.getWorkspace.profile-coverage-gap'
    ).length
  );
  await profileSelect.click();
  await page.getByRole('option', { name: 'Default' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string; payload?: { watchRequest?: { profileName?: string } } }) =>
            call.method === 'buildContent.watch' && call.payload?.watchRequest?.profileName === 'Default'
        ).length
      )
    )
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'mods.getWorkspace.profile-coverage-gap'
        ).length
      )
    )
    .toBeGreaterThan(exactCallsBeforeDefaultReturns);
});

test('does not let delayed open background work overwrite a newly selected profile', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __deferredDownloadsReturned?: number;
      __fluxoraCalls?: Array<{ method: string; payload?: any }>;
      __releaseDeferredDownloads?: () => void;
      fluxora: any;
    };
    const listDownloads = scope.fluxora.downloads.list;
    const exactWorkspace = scope.fluxora.mods.getWorkspace;
    let releaseDownloads!: () => void;
    const downloadsGate = new Promise<void>((resolve) => {
      releaseDownloads = resolve;
    });
    scope.__deferredDownloadsReturned = 0;
    scope.__releaseDeferredDownloads = releaseDownloads;
    scope.fluxora.profiles.list = async () => ['Default', 'Testing'];
    scope.fluxora.downloads.list = async (...args: unknown[]) => {
      await downloadsGate;
      const result = await listDownloads(...args);
      scope.__deferredDownloadsReturned = (scope.__deferredDownloadsReturned ?? 0) + 1;
      return result;
    };
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      scope.__fluxoraCalls?.push({
        method: 'mods.getWorkspace.live-profile',
        payload: { profileName: args[1] }
      });
      return exactWorkspace(...args);
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  const profileSelect = page.getByRole('combobox', { name: 'Profile' });
  await profileSelect.click();
  await page.getByRole('option', { name: 'Testing' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string; payload?: { profileName?: string } }) =>
            call.method === 'mods.getWorkspace.live-profile' &&
            call.payload?.profileName === 'Testing'
        ).length
      )
    )
    .toBeGreaterThanOrEqual(1);

  await page.evaluate(() => (window as any).__releaseDeferredDownloads());
  await expect
    .poll(() => page.evaluate(() => (window as any).__deferredDownloadsReturned))
    .toBeGreaterThanOrEqual(1);
  expect(
    await page.evaluate(() =>
      (window as any).__fluxoraCalls.filter(
        (call: { method: string; payload?: { profileName?: string } }) =>
          call.method === 'mods.getWorkspace.live-profile' &&
          call.payload?.profileName === 'Default'
      ).length
    )
  ).toBe(0);
});

test('reconciles the live profile after a delayed watcher invalidation', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __delayedInvalidationStarted?: boolean;
      __fluxoraCalls?: Array<{ method: string; payload?: any }>;
      __releaseDelayedInvalidation?: () => void;
      fluxora: any;
    };
    const invalidate = scope.fluxora.mods.invalidateFileCaches;
    const exactWorkspace = scope.fluxora.mods.getWorkspace;
    let releaseInvalidation!: () => void;
    const invalidationGate = new Promise<void>((resolve) => {
      releaseInvalidation = resolve;
    });
    scope.__releaseDelayedInvalidation = releaseInvalidation;
    scope.fluxora.profiles.list = async () => ['Default', 'Testing'];
    scope.fluxora.mods.invalidateFileCaches = async (...args: unknown[]) => {
      scope.__delayedInvalidationStarted = true;
      await invalidationGate;
      return invalidate(...args);
    };
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      scope.__fluxoraCalls?.push({
        method: 'mods.getWorkspace.delayed-profile-invalidation',
        payload: { profileName: args[1] }
      });
      return exactWorkspace(...args);
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) =>
            call.method === 'mods.getWorkspace.delayed-profile-invalidation'
        ).length
      )
    )
    .toBe(1);
  await page.evaluate(() => {
    (window as any).__emitFluxoraBuildContentChanged({
      changes: [
        {
          area: 'mods',
          fileName: 'profile-race.txt',
          kind: 'modify',
          path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI\\profile-race.txt'
        }
      ]
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__delayedInvalidationStarted))
    .toBe(true);

  const profileSelect = page.getByRole('combobox', { name: 'Profile' });
  await profileSelect.click();
  await page.getByRole('option', { name: 'Testing' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string; payload?: { profileName?: string } }) =>
            call.method === 'mods.getWorkspace.delayed-profile-invalidation' &&
            call.payload?.profileName === 'Testing'
        ).length
      )
    )
    .toBe(1);

  await page.evaluate(() => (window as any).__releaseDelayedInvalidation());
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string; payload?: { profileName?: string } }) =>
            call.method === 'mods.getWorkspace.delayed-profile-invalidation' &&
            call.payload?.profileName === 'Testing'
        ).length
      )
    )
    .toBe(2);
});

test('retries a failed profile watcher and reconciles after watcher coverage resumes', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: any }>;
      __testingWatchAttempts?: number;
      fluxora: any;
    };
    const watch = scope.fluxora.buildContent.watch;
    const exactWorkspace = scope.fluxora.mods.getWorkspace;
    scope.__testingWatchAttempts = 0;
    scope.fluxora.profiles.list = async () => ['Default', 'Testing'];
    scope.fluxora.buildContent.watch = async (request: any, ...args: unknown[]) => {
      if (request.profileName === 'Testing') {
        scope.__testingWatchAttempts = (scope.__testingWatchAttempts ?? 0) + 1;
        if (scope.__testingWatchAttempts === 1) {
          throw new Error('simulated watcher replacement failure');
        }
      }
      return watch(request, ...args);
    };
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      scope.__fluxoraCalls?.push({
        method: 'mods.getWorkspace.watcher-retry-profile',
        payload: { profileName: args[1] }
      });
      return exactWorkspace(...args);
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  const profileSelect = page.getByRole('combobox', { name: 'Profile' });
  await profileSelect.click();
  await page.getByRole('option', { name: 'Testing' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__testingWatchAttempts), { timeout: 5_000 })
    .toBe(2);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string; payload?: { profileName?: string } }) =>
            call.method === 'mods.getWorkspace.watcher-retry-profile' &&
            call.payload?.profileName === 'Testing'
        ).length
      )
    )
    .toBeGreaterThanOrEqual(2);
});

test('does not mark exact watcher coverage when an event arrives during reconciliation', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __deferNextExact?: () => void;
      __deferredExactStarted?: boolean;
      __fluxoraCalls?: Array<{ method: string; payload?: unknown }>;
      __releaseDeferredExact?: () => void;
      fluxora: any;
    };
    const exactWorkspace = scope.fluxora.mods.getWorkspace;
    let deferNextExact = false;
    scope.__deferNextExact = () => {
      deferNextExact = true;
      scope.__deferredExactStarted = false;
    };
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      scope.__fluxoraCalls?.push({ method: 'mods.getWorkspace.epoch' });
      if (deferNextExact) {
        deferNextExact = false;
        await new Promise<void>((resolve) => {
          scope.__releaseDeferredExact = resolve;
          scope.__deferredExactStarted = true;
        });
      }
      return exactWorkspace(...args);
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'mods.getWorkspace.epoch'
        ).length
      )
    )
    .toBe(1);

  await page.evaluate(() => {
    (window as any).__deferNextExact();
    (window as any).__emitFluxoraBuildContentChanged({
      changes: [
        {
          area: 'mods',
          fileName: 'first.txt',
          kind: 'modify',
          path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI\\first.txt'
        }
      ]
    });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__deferredExactStarted)).toBe(true);
  await page.evaluate(() => {
    (window as any).__emitFluxoraBuildContentChanged({
      changes: [
        {
          area: 'mods',
          fileName: 'second.txt',
          kind: 'modify',
          path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI\\second.txt'
        }
      ]
    });
    (window as any).__releaseDeferredExact();
  });

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'mods.getWorkspace.epoch'
        ).length
      )
    )
    .toBe(3);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.some(
          (call: {
            method: string;
            payload?: { operation?: { operationId?: string } };
          }) =>
            call.method === 'plugins.list' &&
            call.payload?.operation?.operationId?.includes(
              '_build_content_plugins_changed_'
            )
        )
      )
    )
    .toBe(true);

  const pluginsBeforeFinalReopen = await page.evaluate(() =>
    (window as any).__fluxoraCalls.filter(
      (call: { method: string }) => call.method === 'plugins.list'
    ).length
  );
  await page.getByRole('button', { name: 'Home' }).click();
  await clickSkyrimBuildOpenButton(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'plugins.list'
        ).length
      )
    )
    .toBeGreaterThan(pluginsBeforeFinalReopen);
  expect(
    await page.evaluate(() =>
      (window as any).__fluxoraCalls.filter(
        (call: { method: string }) => call.method === 'mods.getWorkspace.epoch'
      ).length
    )
  ).toBe(3);
});

test('starts coverage reconciliation only after the pending invalidation settles', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __coverageExactStarted?: boolean;
      __coverageInvalidationStarted?: boolean;
      __fluxoraCalls?: Array<{ method: string; payload?: unknown }>;
      __releaseCoverageExact?: () => void;
      __releaseCoverageInvalidation?: () => void;
      fluxora: any;
    };
    const invalidate = scope.fluxora.mods.invalidateFileCaches;
    const exactWorkspace = scope.fluxora.mods.getWorkspace;
    let releaseInvalidation!: () => void;
    const invalidationGate = new Promise<void>((resolve) => {
      releaseInvalidation = resolve;
    });
    let deferNextExact = false;
    scope.__releaseCoverageInvalidation = releaseInvalidation;
    scope.fluxora.mods.invalidateFileCaches = async (...args: unknown[]) => {
      scope.__coverageInvalidationStarted = true;
      await invalidationGate;
      return invalidate(...args);
    };
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      scope.__fluxoraCalls?.push({ method: 'mods.getWorkspace.invalidation-happens-before' });
      const result = await exactWorkspace(...args);
      if (deferNextExact) {
        deferNextExact = false;
        scope.__coverageExactStarted = true;
        await new Promise<void>((resolve) => {
          scope.__releaseCoverageExact = resolve;
        });
      }
      return result;
    };
    (scope as any).__deferCoverageExact = () => {
      deferNextExact = true;
      scope.__coverageExactStarted = false;
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) =>
            call.method === 'mods.getWorkspace.invalidation-happens-before'
        ).length
      )
    )
    .toBe(1);
  await page.evaluate(() => {
    (window as any).__deferCoverageExact();
    (window as any).__emitFluxoraBuildContentChanged({
      changes: [
        {
          area: 'mods',
          fileName: 'happens-before.txt',
          kind: 'modify',
          path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI\\happens-before.txt'
        }
      ]
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__coverageInvalidationStarted))
    .toBe(true);

  await page.getByRole('button', { name: 'Home' }).click();
  await clickSkyrimBuildOpenButton(page);
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__coverageExactStarted)).not.toBe(true);
  expect(
    await page.evaluate(() =>
      (window as any).__fluxoraCalls.filter(
        (call: { method: string }) =>
          call.method === 'mods.getWorkspace.invalidation-happens-before'
      ).length
    )
  ).toBe(1);

  await page.evaluate(() => (window as any).__releaseCoverageInvalidation());
  await expect
    .poll(() => page.evaluate(() => (window as any).__coverageExactStarted))
    .toBe(true);
  await page.evaluate(() => (window as any).__releaseCoverageExact());
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) =>
            call.method === 'mods.getWorkspace.invalidation-happens-before'
        ).length
      )
    )
    .toBe(2);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'plugins.list'
        ).length
      )
    )
    .toBeGreaterThanOrEqual(2);

});

test('autonomously retries a failed watcher invalidation before exact refresh', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: unknown }>;
      __watchInvalidationAttempts?: number;
      fluxora: any;
    };
    const invalidate = scope.fluxora.mods.invalidateFileCaches;
    const exactWorkspace = scope.fluxora.mods.getWorkspace;
    scope.__watchInvalidationAttempts = 0;
    scope.fluxora.mods.invalidateFileCaches = async (...args: unknown[]) => {
      scope.__watchInvalidationAttempts = (scope.__watchInvalidationAttempts ?? 0) + 1;
      if (scope.__watchInvalidationAttempts <= 3) {
        throw new Error('simulated bridge restart');
      }
      return invalidate(...args);
    };
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      scope.__fluxoraCalls?.push({ method: 'mods.getWorkspace.retry' });
      return exactWorkspace(...args);
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'mods.getWorkspace.retry'
        ).length
      )
    )
    .toBe(1);

  await page.evaluate(() => {
    (window as any).__emitFluxoraBuildContentChanged({
      changes: [
        {
          area: 'mods',
          fileName: 'retry.txt',
          kind: 'modify',
          path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI\\retry.txt'
        }
      ]
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__watchInvalidationAttempts), { timeout: 6_000 })
    .toBe(4);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'mods.getWorkspace.retry'
        ).length
      )
    )
    .toBe(2);
});

test('does not reuse exact mods while a watcher invalidation remains unresolved', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __allowPendingInvalidation?: boolean;
      __fluxoraCalls?: Array<{ method: string; payload?: unknown }>;
      __pendingInvalidationAttempts?: number;
      fluxora: any;
    };
    const invalidate = scope.fluxora.mods.invalidateFileCaches;
    const exactWorkspace = scope.fluxora.mods.getWorkspace;
    scope.__allowPendingInvalidation = false;
    scope.__pendingInvalidationAttempts = 0;
    scope.fluxora.mods.invalidateFileCaches = async (...args: unknown[]) => {
      scope.__pendingInvalidationAttempts = (scope.__pendingInvalidationAttempts ?? 0) + 1;
      if (!scope.__allowPendingInvalidation) {
        throw new Error('persistent invalidation failure');
      }
      return invalidate(...args);
    };
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      scope.__fluxoraCalls?.push({ method: 'mods.getWorkspace.pending-invalidation' });
      return exactWorkspace(...args);
    };
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'mods.getWorkspace.pending-invalidation'
        ).length
      )
    )
    .toBe(1);

  await page.evaluate(() => {
    (window as any).__emitFluxoraBuildContentChanged({
      changes: [
        {
          area: 'mods',
          fileName: 'pending.txt',
          kind: 'modify',
          path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI\\pending.txt'
        }
      ]
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__pendingInvalidationAttempts))
    .toBeGreaterThanOrEqual(3);

  await page.getByRole('button', { name: 'Home' }).click();
  await clickSkyrimBuildOpenButton(page);
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).__fluxoraCalls.filter(
        (call: { method: string }) => call.method === 'mods.getWorkspace.pending-invalidation'
      ).length
    )
  ).toBe(1);

  await page.getByRole('button', { name: 'Home' }).click();
  await clickSkyrimBuildOpenButton(page);
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).__fluxoraCalls.filter(
        (call: { method: string }) => call.method === 'mods.getWorkspace.pending-invalidation'
      ).length
    )
  ).toBe(1);

  await page.evaluate(() => {
    (window as any).__allowPendingInvalidation = true;
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'mods.getWorkspace.pending-invalidation'
        ).length
      ),
      { timeout: 12_000 }
    )
    .toBe(2);
});

test('runs build package, check and launch actions through the facade', async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __fluxoraNexusInitiallyLinked?: boolean })
      .__fluxoraNexusInitiallyLinked = true;
  });
  await page.goto(baseUrl);
  await page.evaluate(() => {
    (window as any).__fluxoraOperationDelayMs = 500;
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const buildHeader = page.getByLabel('Build header');
  await expect(buildHeader).toBeVisible();
  await expect(buildHeader.getByRole('button', { name: 'Launch' })).toBeEnabled();

  const modsPane = page.getByRole('region', { name: 'Mods', exact: true });
  const actionsTrigger = modsPane.getByRole('button', { name: 'Действия со сборкой' });
  await actionsTrigger.click();
  let actionsMenu = page.getByRole('menu', { name: 'Действия со сборкой' });
  await actionsMenu.getByRole('menuitem', { name: 'Проверить обновления' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('mods.checkUpdates');

  await buildHeader.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByText('Процесс запускается', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('executables.launch');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('processes.waitForExit');
  const launchSplashMessage = page.locator('.flx-loading-splash__message');
  await expect(launchSplashMessage).toHaveText(
    'Процесс запущен — SKSE (skse64_loader.exe)'
  );
  await expect(page.getByText('Screen locked', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Процесс запущен — CrashLogger (CrashLogger.exe)', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Процесс запускается', { exact: true })).toBeHidden();

  await actionsTrigger.click();
  actionsMenu = page.getByRole('menu', { name: 'Действия со сборкой' });
  await actionsMenu.getByRole('menuitem', { name: 'Упаковать' }).click();
  await submitFluxPackExportDialog(page, 'full', true);
  await expect(page.getByRole('status', { name: 'Упаковываем сборку' })).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Упаковываем сборку: прогресс' })
  ).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Упаковываем сборку: прогресс' })
  ).toHaveAttribute('aria-valuenow', '42');
  await expect(page.getByText('Добавляем файлы в пакет', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('fluxPack.export');
  const selectedExportPayload = (await latestCallPayload(page, 'fluxPack.export')) as {
    request?: { packageType?: string; includeGeneratedAssets?: boolean };
  } | null;
  expect(selectedExportPayload?.request?.packageType).toBe('full');
  expect(selectedExportPayload?.request?.includeGeneratedAssets).toBe(true);
});

test('finalizes managed BodySlide after the last VFS holder exits and refreshes mods', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('fluxora.test.bodySlideExecutable', 'true');
  });
  await openSkyrimBuild(page);
  await page.evaluate(() => {
    const scope = window as any;
    const getWorkspace = scope.fluxora.mods.getWorkspace;
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      scope.__fluxoraCalls.push({ method: 'bodyslide.mods.refresh', payload: {} });
      return getWorkspace(...args);
    };
  });

  const launch = page.getByLabel('Build header').getByRole('button', { name: 'Launch' });
  await launch.click();
  await expect(page.getByText('Подготовка BodySlide', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.some(
          (call: { method: string }) => call.method === 'executables.completeManagedLaunch'
        )
      )
    )
    .toBe(true);
  const calls = await page.evaluate(() => (window as any).__fluxoraCalls as Array<any>);
  const completeIndex = calls.findIndex(
    (call) => call.method === 'executables.completeManagedLaunch'
  );
  const refreshIndex = calls.findIndex(
    (call, index) => index > completeIndex && call.method === 'bodyslide.mods.refresh'
  );
  expect(completeIndex).toBeGreaterThan(-1);
  expect(refreshIndex).toBeGreaterThan(completeIndex);
  expect(calls[completeIndex]?.payload?.outcome).toBe('completed');
  await expect(launch).toBeEnabled();
});

test('still finalizes BodySlide and preserves the workspace when the watcher fails', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('fluxora.test.bodySlideExecutable', 'true');
    window.localStorage.setItem('fluxora.test.bodySlideWatcherError', 'true');
  });
  await openSkyrimBuild(page);
  const launch = page.getByLabel('Build header').getByRole('button', { name: 'Launch' });
  await launch.click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const completion = ((window as any).__fluxoraCalls as Array<any>).find(
          (call) => call.method === 'executables.completeManagedLaunch'
        );
        return completion?.payload?.outcome;
      })
    )
    .toBe('watcher-error');
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  await expect(launch).toBeEnabled();
});

test('packages the build from the mods search-row three-dot menu', async ({ page }) => {
  await openSkyrimBuild(page);

  const modsPane = page.getByRole('region', { name: 'Mods', exact: true });
  const trigger = modsPane.getByRole('button', { name: 'Действия со сборкой' });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const menu = page.getByRole('menu', { name: 'Действия со сборкой' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Установить' })).toBeEnabled();
  const packageItem = menu.getByRole('menuitem', { name: 'Упаковать' });
  await expect(packageItem).toBeEnabled();
  await packageItem.click();
  await submitFluxPackExportDialog(page);

  await expect(page.getByRole('status', { name: 'Упаковываем сборку' })).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Упаковываем сборку: прогресс' })
  ).toBeVisible();
  await expect.poll(() => callMethods(page)).toContain('dialogs.saveFluxPack');
  await expect.poll(() => callMethods(page)).toContain('fluxPack.export');

  const exportPayload = (await latestCallPayload(page, 'fluxPack.export')) as {
    request?: {
      packageType?: string;
      configPath?: string;
      includeGeneratedAssets?: boolean;
      outputPath?: string;
    };
  } | null;
  expect(exportPayload?.request?.outputPath).toBe('D:\\Fluxora\\Exports\\skyrim.fluxpack');
  expect(exportPayload?.request?.configPath).toBe('D:\\Fluxora\\Configs\\skyrim-main.json');
  expect(exportPayload?.request?.packageType).toBe('recipe');
  expect(exportPayload?.request?.includeGeneratedAssets).toBe(false);

  await menu.waitFor({ state: 'detached' });
});

test('keeps the FluxPack export dialog cohesive in a compact viewport', async ({ page }) => {
  const viewport = { width: 480, height: 360 };
  await openSkyrimBuild(page);

  const modsPane = page.getByRole('region', { name: 'Mods', exact: true });
  await modsPane.getByRole('button', { name: 'Действия со сборкой' }).click();
  await page
    .getByRole('menu', { name: 'Действия со сборкой' })
    .getByRole('menuitem', { name: 'Упаковать' })
    .click();

  const dialog = page.getByRole('dialog', { name: 'Упаковать сборку' });
  await expect(dialog).toBeVisible();
  await page.setViewportSize(viewport);
  await expect(dialog.locator('select')).toHaveCount(0);

  const dialogBox = await dialog.boundingBox();
  const generatedAssetsBox = await dialog
    .locator('.fluxpack-export-dialog__generated-assets')
    .boundingBox();
  const footerBox = await dialog.locator('.fluxpack-export-dialog__actions').boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(generatedAssetsBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(dialogBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(dialogBox?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? viewport.width + 1)).toBeLessThanOrEqual(
    viewport.width + 1
  );
  expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? viewport.height + 1)).toBeLessThanOrEqual(
    viewport.height + 1
  );
  expect((generatedAssetsBox?.x ?? 0) + (generatedAssetsBox?.width ?? 0)).toBeLessThanOrEqual(
    (dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) + 1
  );
  expect((generatedAssetsBox?.y ?? 0) + (generatedAssetsBox?.height ?? 0)).toBeLessThanOrEqual(
    (footerBox?.y ?? 0) + 1
  );

  const actionButtons = dialog.locator('.fluxpack-export-dialog__actions button');
  const cancelBox = await actionButtons.nth(0).boundingBox();
  const confirmBox = await actionButtons.nth(1).boundingBox();
  expect(Math.abs((cancelBox?.height ?? 0) - (confirmBox?.height ?? 0))).toBeLessThanOrEqual(1);

  const packageTypeSelect = dialog.getByRole('combobox', { name: 'Тип упаковки FluxPack' });
  await packageTypeSelect.click();
  const packageTypeMenu = page.getByRole('listbox');
  await expect(packageTypeMenu).toBeVisible();
  await expect(packageTypeMenu).toHaveAttribute('data-open', 'true');
  await expect
    .poll(() => packageTypeMenu.evaluate((element) => window.getComputedStyle(element).opacity))
    .toBe('1');
  await expect(packageTypeMenu.getByRole('option')).toHaveCount(2);
  const menuBox = await packageTypeMenu.boundingBox();
  const menuBackground = await packageTypeMenu.evaluate(
    (element) => window.getComputedStyle(element).backgroundColor
  );
  expect(menuBox).not.toBeNull();
  expect(menuBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(menuBox?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((menuBox?.x ?? 0) + (menuBox?.width ?? viewport.width + 1)).toBeLessThanOrEqual(
    viewport.width + 1
  );
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? viewport.height + 1)).toBeLessThanOrEqual(
    viewport.height + 1
  );
  expect(menuBackground).not.toBe('rgb(255, 255, 255)');

  await page.keyboard.press('Escape');
  await expect(packageTypeMenu).toBeHidden();
  await expect(dialog).toBeVisible();
});

test('starts a manual Nexus FluxPack install from the Library action', async ({ page }) => {
  await page.goto(baseUrl);

  await page.evaluate(() => {
    const facade = (window as any).fluxora;
    const calls = (window as any).__fluxoraCalls as Array<{ method: string; payload?: unknown }>;
    const summary = {
      buildName: 'Nexus Manual Build',
      customConfigCount: 0,
      customPatchCount: 0,
      formatVersion: 3,
      generatedAssetCount: 0,
      generatedAssetsIncluded: false,
      installPlanAvailable: true,
      installStepCount: 1,
      manifestBytes: 1024,
      outputPath: 'D:\\Fluxora\\Exports\\manual.fluxpack',
      sourceArchiveCount: 1
    };

    facade.dialogs.pickFluxPack = async (initialDirectory: any) => {
      calls.push({ method: 'dialogs.pickFluxPack', payload: { initialDirectory } });
      return { canceled: false, path: 'D:\\Fluxora\\Exports\\manual.fluxpack' };
    };
    facade.fluxPack.inspect = async (fluxPackPath: any, operation: any) => {
      calls.push({ method: 'fluxPack.inspect', payload: { fluxPackPath, operation } });
      return summary;
    };
    facade.fluxPack.planInstall = async (request: any, operation: any) => {
      calls.push({ method: 'fluxPack.planInstall', payload: { operation, request } });
      return {
        automaticDownloadCount: 0,
        manualDownloadCount: 1,
        operationId: operation?.operationId ?? 'op_fluxpack_plan',
        reusableDownloadCount: 0,
        reusableSourceCount: 0,
        sources: [
          {
            acquisitionMode: 'manual',
            archiveFileName: 'SkyUI.7z',
            canAutomaticallyDownload: false,
            displayName: 'SkyUI',
            manualDownloadUrl:
              'https://www.nexusmods.com/skyrimspecialedition/mods/3863?tab=files&file_id=123',
            providerDisplayName: 'Nexus Mods',
            providerId: 'nexus',
            requiresManualDownload: true,
            sourceId: 'source-0:nexus:skyrimspecialedition:3863:123',
            version: '5.2'
          }
        ],
        summary,
        updatesExistingProject: false
      };
    };
  });

  const installButton = page.getByRole('button', { name: 'Установить сборку из FluxPack' });
  await expect(installButton).toBeVisible();
  await installButton.click();

  const dialog = page.getByRole('dialog', { name: 'Ручная загрузка' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('SkyUI', { exact: true }).first()).toBeVisible();
  const downloadButton = dialog.getByRole('button', { name: 'Скачать на Nexus Mods' });
  await expect(downloadButton).toBeFocused();
  await expect(downloadButton).toHaveAttribute('data-highlighted', 'true');
  await expect(downloadButton).toHaveCSS('background-color', 'rgb(217, 143, 43)');
  await downloadButton.click();
  await expect.poll(() => callMethods(page)).toContain('links.openExternal');

  const installAction = dialog.getByRole('button', { name: 'Начать установку' });
  await expect(installAction).toBeDisabled();
  await dialog.getByRole('button', { name: 'Выбрать загруженный файл' }).click();
  await expect(installAction).toBeEnabled();
});

test('updates the current build from FluxPack with delta reuse', async ({ page }) => {
  await openSkyrimBuild(page);

  await page.evaluate(() => {
    const facade = (window as any).fluxora;
    const calls = (window as any).__fluxoraCalls as Array<{ method: string; payload?: unknown }>;

    facade.dialogs.pickFluxPack = async (initialDirectory: any) => {
      calls.push({ method: 'dialogs.pickFluxPack', payload: { initialDirectory } });
      return { canceled: false, path: 'D:\\Fluxora\\Exports\\skyrim.fluxpack' };
    };
    facade.dialogs.pickFolder = async (title: any, initialDirectory: any) => {
      calls.push({ method: 'dialogs.pickFolder', payload: { initialDirectory, title } });
      return { canceled: false, path: 'D:\\Fluxora\\Builds' };
    };
    const summary = {
      buildName: 'Skyrim graphics overhaul',
      customConfigCount: 1,
      customPatchCount: 0,
      formatVersion: 3,
      generatedAssetCount: 2,
      generatedAssetsIncluded: true,
      installPlanAvailable: true,
      installStepCount: 3,
      manifestBytes: 2048,
      outputPath: 'D:\\Fluxora\\Exports\\skyrim.fluxpack',
      sourceArchiveCount: 4
    };
    facade.fluxPack.inspect = async (fluxPackPath: any, operation: any) => {
      calls.push({ method: 'fluxPack.inspect', payload: { fluxPackPath, operation } });
      return summary;
    };
    facade.fluxPack.planInstall = async (request: any, operation: any) => {
      calls.push({ method: 'fluxPack.planInstall', payload: { operation, request } });
      return {
        automaticDownloadCount: 0,
        manualDownloadCount: 0,
        operationId: operation?.operationId ?? 'op_fluxpack_plan',
        reusableDownloadCount: 1,
        reusableSourceCount: 3,
        sources: [],
        summary,
        updatesExistingProject: true
      };
    };
    facade.fluxPack.install = async (request: any, operation: any) => {
      calls.push({ method: 'fluxPack.install', payload: { operation, request } });
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 600)));
      return {
        appliedConfigCount: 1,
        appliedProfileOrderItemCount: 12,
        buildName: 'Skyrim graphics overhaul',
        configPath: 'D:\\Fluxora\\Configs\\skyrim-main.json',
        failedSourceCount: 0,
        hasWarnings: false,
        installedSourceCount: 4,
        materializedFileCount: 2,
        operationId: operation?.operationId ?? 'op_fluxpack_install',
        pendingSourceCount: 0,
        projectDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul',
        reusedDownloadCount: 1,
        reusedFileCount: 18,
        reusedSourceCount: 3,
        summary,
        totalSourceCount: 4,
        updatedExistingProject: true
      };
    };
  });

  const modsPane = page.getByRole('region', { name: 'Mods', exact: true });
  await modsPane.getByRole('button', { name: 'Действия со сборкой' }).click();

  const menu = page.getByRole('menu', { name: 'Действия со сборкой' });
  await expect(menu).toBeVisible();
  const installItem = menu.getByRole('menuitem', { name: 'Установить' });
  await expect(installItem).toBeEnabled();
  await installItem.click();

  const conflictDialog = page.getByRole('dialog', { name: 'Сборка уже существует' });
  await expect(conflictDialog).toBeVisible();
  await conflictDialog.getByRole('button', { name: 'Обновить существующую' }).click();

  await expect(page.getByRole('status', { name: 'Обновляем сборку' })).toBeVisible();
  await expect.poll(() => callMethods(page)).toContain('dialogs.pickFluxPack');
  await expect.poll(() => callMethods(page)).toContain('fluxPack.planInstall');
  await expect.poll(() => callMethods(page)).toContain('fluxPack.install');
  expect(await callMethods(page)).not.toContain('dialogs.pickFolder');

  const installPayload = (await latestCallPayload(page, 'fluxPack.install')) as {
    request?: {
      existingConfigPath?: string;
      fluxPackPath?: string;
      installRootDirectory?: string;
    };
  } | null;
  expect(installPayload?.request?.fluxPackPath).toBe('D:\\Fluxora\\Exports\\skyrim.fluxpack');
  expect(installPayload?.request?.installRootDirectory).toBe('D:\\Fluxora\\Builds');
  expect(installPayload?.request?.existingConfigPath).toBe(
    'D:\\Fluxora\\Configs\\skyrim-main.json'
  );

  await expect.poll(() => callMethods(page)).toContain('projects.openConfig');
  await expect(page.getByText('Delta-обновление завершено', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Переиспользовано: 3 мод., 1 архив., 18 файл. Заменено файлов: 2.', {
      exact: true
    })
  ).toBeVisible();
  await menu.waitFor({ state: 'detached' });
});

test('silently refreshes the Latest file version after the build workspace is ready', async ({
  page
}) => {
  let browserDialogCount = 0;
  page.on('dialog', async (dialog) => {
    browserDialogCount += 1;
    await dialog.dismiss();
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('fluxora.test.modUpdateLatest', 'true');
    (window as typeof window & { __fluxoraNexusInitiallyLinked?: boolean })
      .__fluxoraNexusInitiallyLinked = true;
  });
  await page.goto(baseUrl);

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const modRow = page.getByRole('row', { name: /Unofficial Patch mod/ });
  await expect(modRow).toBeVisible();
  await expect(modRow.locator('.mod-list-row__latest')).toHaveText('4.4.0');
  await expect
    .poll(() => latestCallPayload(page, 'mods.checkUpdates'))
    .toMatchObject({
      updateRequest: {
        projectDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul',
        mode: 'automatic'
      }
    });
  await expect(page.getByText('Checking updates', { exact: true })).toHaveCount(0);
  expect(browserDialogCount).toBe(0);
});

test('keeps automatic partial updates quiet and shows only a short manual message', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('fluxora.test.modUpdatePartial', 'authentication');
    window.localStorage.setItem('fluxora.test.modUpdateLatest', 'true');
    (window as typeof window & { __fluxoraNexusInitiallyLinked?: boolean })
      .__fluxoraNexusInitiallyLinked = true;
  });
  await page.goto(baseUrl);
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  await expect
    .poll(() => latestCallPayload(page, 'mods.checkUpdates'))
    .toMatchObject({ updateRequest: { mode: 'automatic' } });
  await expect(page.locator('.mod-update-warning')).toHaveCount(0);
  await expect(page.getByText('Проверка обновлений завершена частично', { exact: false }))
    .toHaveCount(0);
  await expect(
    page.getByRole('row', { name: /Unofficial Patch mod/ })
      .locator('.mod-list-row__latest-freshness')
  ).toHaveText('Не проверено');

  const modsPane = page.getByRole('region', { name: 'Mods', exact: true });
  await modsPane.getByRole('button', { name: 'Действия со сборкой' }).click();
  await page.getByRole('menu', { name: 'Действия со сборкой' })
    .getByRole('menuitem', { name: 'Проверить обновления' })
    .click();
  await expect(page.getByText('Проверка обновлений завершена частично', { exact: false }))
    .toBeVisible();
  await expect(page.locator('.mod-update-warning')).toHaveCount(0);

  await page.evaluate(() => window.localStorage.removeItem('fluxora.test.modUpdatePartial'));
  await modsPane.getByRole('button', { name: 'Действия со сборкой' }).click();
  await page.getByRole('menu', { name: 'Действия со сборкой' })
    .getByRole('menuitem', { name: 'Проверить обновления' })
    .click();
  await expect(
    page.getByRole('row', { name: /Unofficial Patch mod/ })
      .locator('.mod-list-row__latest-value')
  ).toHaveText('4.4.0');
});

test('uses the redesigned mods pane for real mod list operations', async ({ page }) => {
  await page.goto(baseUrl);

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const modOrderTable = page.getByRole('table', { name: 'Mod order' });
  await expect(modOrderTable).toBeVisible();
  const priorityHeader = modOrderTable.getByRole('columnheader', { name: 'Приоритет' });
  await expect(priorityHeader).toBeVisible();
  await expect
    .poll(() =>
      priorityHeader.evaluate((header) => {
        const textRange = document.createRange();
        textRange.selectNodeContents(header);
        return textRange.getBoundingClientRect().width <= header.clientWidth;
      })
    )
    .toBe(true);
  await expect(modOrderTable.getByRole('columnheader', { name: 'Название' })).toBeVisible();
  await expect(modOrderTable.getByRole('columnheader', { name: 'Версия' })).toBeVisible();
  await expect(modOrderTable.getByRole('columnheader', { name: 'Latest' })).toBeVisible();
  await expect(modOrderTable.getByRole('columnheader', { name: 'Статус' })).toBeVisible();
  const outdatedLatest = page.getByRole('row', { name: /SkyUI mod/ }).locator('.mod-list-row__latest');
  await expect(outdatedLatest).toHaveAttribute('data-version-mismatch', 'true');
  await expect(outdatedLatest).toHaveCSS('color', 'rgb(248, 113, 113)');
  await expect(
    page.getByRole('row', { name: /Unofficial Patch mod/ }).locator('.mod-list-row__latest')
  ).toHaveAttribute('data-version-mismatch', 'false');

  const modsPane = page.getByRole('region', { name: 'Mods', exact: true });
  await modsPane.getByRole('button', { name: 'Действия со сборкой' }).click();
  await page.getByRole('menuitem', { name: 'Создать разделитель' }).click();
  const creationDialog = page.getByRole('dialog', { name: 'Создать разделитель' });
  await expect(creationDialog).toBeVisible();
  const separatorTitleInput = creationDialog.getByLabel('Название разделителя');
  await expect(separatorTitleInput).toHaveAttribute('maxLength', '255');
  const titleInputWidthRatio = await separatorTitleInput.evaluate((input) => {
    const wrapper = input.closest('.flx-input');
    if (!wrapper) {
      return 0;
    }

    return input.getBoundingClientRect().width / wrapper.getBoundingClientRect().width;
  });
  expect(titleInputWidthRatio).toBeGreaterThan(0.8);
  await page.keyboard.press('Escape');
  await expect(creationDialog).toBeHidden();

  const separatorRow = page.getByRole('row', { name: /Core fixes separator/ });
  await expect(separatorRow).toBeVisible();
  await expect(separatorRow).toHaveAttribute('data-conflict-highlight', 'none');
  await expect(separatorRow).toHaveAttribute('data-conflict-status', '');
  await expect(separatorRow.locator('.mod-list-row__priority')).toHaveText('');
  await expect(separatorRow.locator('.mod-separator-status .flx-status-dot')).toHaveCount(0);
  await expect(separatorRow.locator('.mod-separator-status .mod-separator-count')).toHaveText('2 mods');
  await expect(separatorRow.locator('.mod-separator-cell .mod-separator-count')).toHaveCount(0);
  await expect(separatorRow.locator('.mod-separator-line')).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse Core fixes' }).click();
  await expect(separatorRow).toHaveAttribute('data-collapsed', 'true');
  await expect(separatorRow).toHaveAttribute('data-conflict-highlight', 'none');
  await expect(separatorRow).toHaveAttribute('data-conflict-status', '');
  await expect(separatorRow.locator('.mod-separator-cell .flx-status-dot')).toHaveCount(0);
  await expect(separatorRow.locator('.mod-separator-status .flx-status-dot')).toHaveCount(0);
  await expect
    .poll(() => separatorRow.evaluate((row) => window.getComputedStyle(row, '::before').content))
    .toBe('none');
  await page.getByRole('button', { name: 'Expand Core fixes' }).click();
  await expect(separatorRow).toHaveAttribute('data-conflict-highlight', 'none');
  await expect(separatorRow).toHaveAttribute('data-conflict-status', '');
  await expect(separatorRow.locator('.mod-separator-status .flx-status-dot')).toHaveCount(0);
  const nestedModRow = page.getByRole('row', { name: /Unofficial Patch mod/ });
  await expect(nestedModRow).toBeVisible();
  await expect(nestedModRow.locator('.mod-list-row__priority')).toHaveText('1');
  await expect(page.getByRole('row', { name: /SkyUI mod/ }).locator('.mod-list-row__priority')).toHaveText('2');
  await expect
    .poll(() => nestedModRow.evaluate((row) => window.getComputedStyle(row, '::before').content))
    .toBe('none');
  await expect(page.getByRole('img', { name: /Overwrites 4 files/ })).toBeVisible();
  const overwriteRow = page.getByRole('row', {
    name: /Skyrim graphics overhaul .* Output files folder overwrite folder/
  });
  await expect(overwriteRow).toBeVisible();

  await page.getByLabel('Disable Unofficial Patch').click({ force: true });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('mods.setEnabled');

  const modRow = page.getByRole('row', { name: /Unofficial Patch mod/ });
  await modRow.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Open folder' }).click();
  await expect
    .poll(() => latestCallPayload(page, 'shell.openPath'))
    .toMatchObject({
      path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Unofficial Patch'
    });

  await separatorRow.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Свернуть все' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Развернуть все' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete separator' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Delete separator' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('mods.deleteSeparator');
  await expect(page.getByText('Loading mods', { exact: true })).toHaveCount(0);
  await expect(page.locator('.operation-overlay--mod-delete')).toHaveCount(0);

  await overwriteRow.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Очистить папку перезаписи' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('mods.clearOverwrite');
  await expect(page.getByLabel('Очистка override')).toBeHidden();

  await overwriteRow.click();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Открыть в проводнике' }).click();
  await expect
    .poll(() => latestCallPayload(page, 'shell.openPath'))
    .toMatchObject({
      path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\overwrite'
    });
});

test('does not show row focus rings when Shift is pressed without Tab navigation', async ({ page }) => {
  await openSkyrimBuild(page);

  const modRow = page.getByRole('row', { name: /Unofficial Patch mod/ });
  await modRow.click();
  await expect(modRow).toBeFocused();

  await page.keyboard.press('Shift');

  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.focusNavigation))
    .toBeUndefined();
  await expect.poll(async () => (await elementFocusIndicator(modRow)).hasIndicator).toBe(false);
});

test('drags mod order rows with pointer placement feedback', async ({ page }) => {
  await openSkyrimBuild(page);

  const source = page.getByRole('row', { name: /Unofficial Patch mod/ });
  const target = page.getByRole('row', { name: /SkyUI mod/ });

  await dragRowToSlot(page, source, target, 'after');
  await expect(page.getByText('Moving mod', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Loading mods', { exact: true })).toHaveCount(0);

  await expect
    .poll(() => latestCallPayload(page, 'mods.moveOrderItem'))
    .toMatchObject({
      orderId: 'mod_ussep',
      targetIndex: 2
    });
  await expect(source.locator('.mod-list-row__priority')).toHaveText('2');
  await expect(target.locator('.mod-list-row__priority')).toHaveText('1');
});

test('drags every selected mod row as one ordered group', async ({ page }) => {
  await openSkyrimBuild(page);

  const separator = page.getByRole('row', { name: /Core fixes separator/ });
  const patch = page.getByRole('row', { name: /Unofficial Patch mod/ });
  const skyui = page.getByRole('row', { name: /SkyUI mod/ });
  await patch.click();
  await page.keyboard.down('Control');
  await skyui.click();
  await page.keyboard.up('Control');

  await moveRowDragToSlot(page, patch, separator, 'before');
  await expect(patch).toHaveAttribute('data-dragging', 'true');
  await expect(skyui).toHaveAttribute('data-dragging', 'true');
  await page.mouse.up();

  await expect
    .poll(() =>
      page.locator('.mod-list-row[data-order-id]').evaluateAll((rows) =>
        rows.slice(0, 3).map((row) => row.getAttribute('data-order-id'))
      )
    )
    .toEqual(['mod_ussep', 'mod_skyui', 'sep_core']);
  await expect(patch).toHaveAttribute('data-selected', 'true');
  await expect(skyui).toHaveAttribute('data-selected', 'true');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          (window as typeof window & {
            __fluxoraCalls?: Array<{ method: string; payload?: { orderId?: string; targetIndex?: number } }>;
          }).__fluxoraCalls ?? []
        )
          .filter((call) => call.method === 'mods.moveOrderItem')
          .map((call) => call.payload)
      )
    )
    .toEqual([
      expect.objectContaining({ orderId: 'mod_ussep', targetIndex: 0 }),
      expect.objectContaining({ orderId: 'mod_skyui', targetIndex: 1 })
    ]);
});

test('continuously scrolls the mod list while a dragged row stays at either edge', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const scope = window as typeof window & { fluxora: any };
    const expandWorkspace = (snapshot: { installedMods: any[]; modOrder: any[] }) => {
      const rows = structuredClone(snapshot.modOrder);
      const template = rows.find((item: any) => item.isMod);
      for (let index = 0; template && index < 40; index += 1) {
        rows.push({
          ...template,
          id: `D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Scroll fixture ${index}`,
          orderId: `mod_scroll_fixture_${index}`,
          order: rows.length,
          modUuid: `mod_scroll_fixture_${index}`,
          name: `Scroll fixture ${index}`
        });
      }
      return {
        installedMods: rows.filter((item: any) => item.isMod),
        modOrder: rows
      };
    };
    const getPersistedWorkspace = scope.fluxora.mods.getPersistedWorkspace;
    const getWorkspace = scope.fluxora.mods.getWorkspace;
    scope.fluxora.mods.getPersistedWorkspace = async (...args: unknown[]) =>
      expandWorkspace(await getPersistedWorkspace(...args));
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) =>
      expandWorkspace(await getWorkspace(...args));
  });

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  const body = page.locator('.mod-list__body');
  await expect(body).toHaveAttribute('data-virtualized', 'adaptive');
  await expect
    .poll(() => body.evaluate((element) => Math.round(element.scrollHeight / 48)))
    .toBeGreaterThan(40);

  const source = page.getByRole('row', { name: /Unofficial Patch mod/ });
  const sourceBox = await source.boundingBox();
  const bodyBox = await body.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(bodyBox).not.toBeNull();

  const sourceX = sourceBox!.x + Math.min(140, sourceBox!.width / 2);
  const sourceY = sourceBox!.y + sourceBox!.height / 2;
  const edgeX = bodyBox!.x + bodyBox!.width / 2;
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 8, sourceY + 8);
  await page.mouse.move(edgeX, bodyBox!.y + bodyBox!.height - 2);
  await expect(source).toHaveAttribute('data-dragging', 'true');

  await expect
    .poll(() => body.evaluate((element) => element.scrollTop), { timeout: 2_000 })
    .toBeGreaterThan(120);
  const lowerEdgeScrollTop = await body.evaluate((element) => element.scrollTop);

  await page.mouse.move(edgeX, bodyBox!.y + 2);
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop), { timeout: 2_000 })
    .toBeLessThan(lowerEdgeScrollTop - 100);
  await page.mouse.up();
});

test('installs a dragged download immediately at the chosen mod position', async ({ page }) => {
  await openSkyrimBuild(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();

  const source = rightPane.getByRole('row', { name: /Aetherius - A Race Overhaul/ });
  const target = page.getByRole('row', { name: /SkyUI mod/ });
  await dragDownloadToModSlot(page, source, target, 'before');

  const installDialog = page.getByRole('dialog', { name: /Aetherius - A Race Overhaul/ });
  await expect(installDialog).toBeVisible();
  await installDialog.getByLabel(/Mod name/).fill('Aetherius - A Race Overhaul');
  await installDialog.getByRole('button', { name: 'Установить', exact: true }).click();

  await expect(installDialog).toHaveCount(0);
  const installedRow = page.locator('.mod-list-row').filter({
    hasText: 'Aetherius - A Race Overhaul'
  });
  await expect(installedRow).toBeVisible();
  await expect(page.getByText('Loading mods', { exact: true })).toHaveCount(0);

  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as any).__fluxoraCalls as Array<{ method: string }>).filter(
          (call) => call.method === 'downloads.install'
        ).length
      )
    )
    .toBe(1);
  await expect
    .poll(() => latestCallPayload(page, 'downloads.install'))
    .toMatchObject({
      request: {
        modOrderTargetIndex: 2,
        profileName: 'Default'
      }
    });
  await expect
    .poll(() =>
      page.locator('.mod-list-row[data-order-id]').evaluateAll((rows) => {
        const orderIds = rows.map((row) => row.getAttribute('data-order-id'));
        return {
          installedIndex: orderIds.indexOf('mod_aetherius_a_race_overhaul'),
          targetIndex: orderIds.indexOf('mod_skyui')
        };
      })
    )
    .toEqual({ installedIndex: 2, targetIndex: 3 });
});

test('shows two concurrent installs and keeps the third visible in the queue', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto(baseUrl);
  await page.evaluate(() => {
    window.localStorage.setItem('fluxora.test.concurrentInstalls', 'true');
    window.localStorage.setItem('fluxora.test.installDelayMs', '8000');
  });
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  for (const index of [1, 2, 3]) {
    const name = `Concurrent Mod ${index}`;
    await rightPane.getByRole('row', { name: new RegExp(name) }).dblclick();
    const dialog = page.getByRole('dialog', { name: new RegExp(name) });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Установить', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (index === 1) {
      await expect(
        page.locator('.mod-list-row').filter({ hasText: name })
      ).toHaveAttribute('data-state', 'post-install-reveal');
    }
  }

  const first = page.locator('.mod-list-row').filter({ hasText: 'Concurrent Mod 1' });
  const second = page.locator('.mod-list-row').filter({ hasText: 'Concurrent Mod 2' });
  const third = page.locator('.mod-list-row').filter({ hasText: 'Concurrent Mod 3' });
  await expect(first.locator('.mod-install-pending-label')).toHaveText('Распаковка');
  await expect(second.locator('.mod-install-pending-label')).toHaveText('Распаковка');
  await expect(third.locator('.mod-install-pending-label')).toHaveText('В очереди');
  await expect(rightPane.getByRole('row', { name: /Concurrent Mod 3/ })).toBeVisible();
  await expect.poll(() => latestCallPayload(page, 'installs.submit')).not.toBeNull();
});

test('restores an interrupted install row and continues it after reopening the build', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    window.localStorage.setItem('fluxora.test.restoredInstallOperations', JSON.stringify([{
      operationId: 'restored-install-1',
      sourceKind: 'download',
      sourcePath: 'D:\\Fluxora\\Downloads\\skyrimse\\Restored Install.7z',
      archiveFingerprint: 'mock:restored',
      profileName: 'Default',
      existingModMode: 0,
      targetModUuid: '',
      targetFolder: 'Restored Install',
      selectedOptionIds: [],
      manualDecisions: [],
      placementOverridesJson: '[]',
      resume: { isFomod: false, modOrderTargetIndex: 2 },
      beforeOrderId: 'sep_core',
      afterOrderId: 'mod_ussep',
      enqueueSequence: 1,
      state: 'extracting',
      stage: 'extracting',
      progressPercent: 20,
      indeterminate: true,
      errorCode: '',
      errorMessage: '',
      result: null
    }]));
  });
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  await expect.poll(() => latestCallPayload(page, 'installs.restore')).not.toBeNull();
  await expect.poll(() => latestCallPayload(page, 'installs.restore.result')).toEqual({
    count: 1,
    operationIds: ['restored-install-1']
  });
  await expect.poll(() => latestCallPayload(page, 'ui.log.ModInstall')).toMatchObject({
    message: 'Restored 1 pending install projection(s) after workspace refresh.'
  });
  const restored = page.locator('.mod-list-row').filter({ hasText: 'Restored Install' });
  await expect(restored).toBeVisible();
  await expect(restored.locator('.mod-install-pending-label')).toHaveText('Восстановление');
  await expect(restored).toHaveAttribute('data-order-id', 'mod_restored_install', {
    timeout: 12_000
  });
});

test('does not create a ghost row when recovery returns an already completed install', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    window.localStorage.setItem('fluxora.test.returnTerminalRestoredInstalls', 'true');
    window.localStorage.setItem('fluxora.test.restoredInstallOperations', JSON.stringify([{
      operationId: 'restored-completed-install',
      sourceKind: 'download',
      sourcePath: 'D:\\Fluxora\\Downloads\\skyrimse\\SkyUI.7z',
      archiveFingerprint: 'mock:completed',
      profileName: 'Default',
      existingModMode: 2,
      targetModUuid: 'mod_skyui',
      targetFolder: 'SkyUI',
      selectedOptionIds: [],
      manualDecisions: [],
      placementOverridesJson: '[]',
      resume: { isFomod: false, modOrderTargetIndex: 2 },
      beforeOrderId: 'mod_ussep',
      afterOrderId: 'mod_skyui',
      enqueueSequence: 1,
      state: 'completed',
      stage: 'completed',
      progressPercent: 100,
      indeterminate: false,
      errorCode: '',
      errorMessage: '',
      result: null
    }]));
  });
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  await expect.poll(() => latestCallPayload(page, 'installs.restore.result')).toEqual({
    count: 1,
    operationIds: ['restored-completed-install']
  });
  await expect(page.locator('.mod-list-row[data-order-id="mod_skyui"]')).toHaveCount(1);
  await expect(page.locator('.mod-list-row[data-order-id^="pending-install:"]')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() =>
    (window as any).__fluxoraCalls.filter(
      (call: { method: string; payload?: { message?: string } }) =>
        call.method === 'ui.log.ModInstall' &&
        String(call.payload?.message ?? '').startsWith('Restored ')
    ).length
  )).toBe(0);
});

test('shows exact pending conflicts and rebases an install dragged before the snapshot is ready', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto(baseUrl);
  await page.evaluate(() => {
    window.localStorage.setItem('fluxora.test.installDelayMs', '1600');
    window.localStorage.setItem('fluxora.test.installConflictSnapshotDelayMs', '500');
  });
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await rightPane.getByRole('row', { name: /Aetherius - A Race Overhaul/ }).dblclick();

  const installDialog = page.getByRole('dialog', { name: /Aetherius - A Race Overhaul/ });
  await expect(installDialog).toBeVisible();
  await installDialog.getByLabel(/Mod name/).fill('Aetherius - A Race Overhaul');
  await installDialog.getByRole('button', { name: 'Установить', exact: true }).click();

  const installedRow = page.locator('.mod-list-row').filter({
    hasText: 'Aetherius - A Race Overhaul'
  });
  await expect(installedRow).toBeVisible();
  await expect(installedRow).toHaveAttribute('data-order-id', /^pending-install:/);
  await expect(installedRow).toHaveAttribute('data-conflict-status', '');
  await expect(installedRow.locator('.mod-overwrite-state-cell')).toHaveAttribute(
    'data-pending',
    'true'
  );
  await expect(installedRow.locator('.mod-install-pending-label')).toHaveText('Распаковка');
  await expect(installedRow.locator('.mod-conflict-dot')).toHaveCount(0);

  const target = page.getByRole('row', { name: /Unofficial Patch mod/ });
  await dragRowToSlot(page, installedRow, target, 'before');

  await expect(installedRow.locator('.mod-overwrite-state-cell')).toHaveAttribute(
    'data-pending',
    'true'
  );
  await expect(installedRow).not.toHaveAttribute('data-conflict-status', '');
  await expect(installedRow.locator('.mod-conflict-dot')).toHaveCount(0);

  await expect
    .poll(() => latestCallPayload(page, 'mods.rebasePendingInstall'))
    .toMatchObject({
      targetIndex: 1
    });
  await expect(installedRow).toHaveAttribute('data-order-id', 'mod_aetherius_a_race_overhaul');
  await expect
    .poll(() =>
      page.locator('.mod-list-row[data-order-id]').evaluateAll((rows) => {
        const orderIds = rows.map((row) => row.getAttribute('data-order-id'));
        return {
          installedIndex: orderIds.indexOf('mod_aetherius_a_race_overhaul'),
          targetIndex: orderIds.indexOf('mod_ussep')
        };
      })
    )
    .toEqual({ installedIndex: 1, targetIndex: 2 });
});

test('rolls back the pending row and both conflict projections when install fails', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto(baseUrl);
  await page.evaluate(() => {
    window.localStorage.setItem('fluxora.test.installDelayMs', '1000');
    window.localStorage.setItem('fluxora.test.installConflictSnapshotDelayMs', '250');
    window.localStorage.setItem('fluxora.test.installFailure', 'true');
  });
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const skyuiRow = page.getByRole('row', { name: /SkyUI mod/ });
  const baselineSkyuiConflict = await skyuiRow.getAttribute('data-conflict-status');
  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await rightPane.getByRole('row', { name: /Aetherius - A Race Overhaul/ }).dblclick();

  const installDialog = page.getByRole('dialog', { name: /Aetherius - A Race Overhaul/ });
  await installDialog.getByLabel(/Mod name/).fill('Aetherius - A Race Overhaul');
  await installDialog.getByRole('button', { name: 'Установить', exact: true }).click();

  const pendingRow = page.locator('.mod-list-row').filter({
    hasText: 'Aetherius - A Race Overhaul'
  });
  await expect(pendingRow).toHaveAttribute('data-order-id', /^pending-install:/);
  await expect(pendingRow.locator('.mod-overwrite-state-cell')).toHaveAttribute(
    'data-pending',
    'true'
  );
  await expect(skyuiRow).not.toHaveAttribute(
    'data-conflict-status',
    baselineSkyuiConflict ?? ''
  );

  await expect(pendingRow).toHaveCount(0);
  await expect(
    rightPane.getByRole('row', { name: /Aetherius - A Race Overhaul/ }).getByText('Failed')
  ).toBeVisible();
  await expect(skyuiRow).toHaveAttribute(
    'data-conflict-status',
    baselineSkyuiConflict ?? ''
  );
});

test('reveals a new mod without a full workspace reconciliation and does not restore it after deletion', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __postDeleteWorkspaceRead?: boolean;
      __postInstallWorkspaceReads?: number;
      fluxora: any;
    };
    const deletedModIds = new Set<string>();
    const deleteInstalled = scope.fluxora.mods.deleteInstalled;
    const getPersistedWorkspace = scope.fluxora.mods.getPersistedWorkspace;
    const getWorkspace = scope.fluxora.mods.getWorkspace;
    const withoutDeletedMods = (snapshot: { installedMods: any[]; modOrder: any[] }) => ({
      installedMods: snapshot.installedMods.filter((item) => !deletedModIds.has(String(item.id))),
      modOrder: snapshot.modOrder.filter(
        (item) => !item.isMod || !deletedModIds.has(String(item.id))
      )
    });

    scope.__postDeleteWorkspaceRead = false;
    scope.__postInstallWorkspaceReads = 0;
    scope.fluxora.mods.deleteInstalled = async (...args: unknown[]) => {
      const result = await deleteInstalled(...args);
      deletedModIds.add(String(args[1] ?? ''));
      return result;
    };
    scope.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      const snapshot = structuredClone(await getWorkspace(...args));
      const filtered = withoutDeletedMods(snapshot);
      if (deletedModIds.size > 0) {
        scope.__postDeleteWorkspaceRead = true;
      }
      return filtered;
    };
    scope.fluxora.mods.getPersistedWorkspace = async (...args: unknown[]) => {
      const snapshot = structuredClone(await getPersistedWorkspace(...args));
      const request = args.at(-1) as { operationId?: string } | undefined;
      if (String(request?.operationId ?? '').includes('install_flow')) {
        scope.__postInstallWorkspaceReads = (scope.__postInstallWorkspaceReads ?? 0) + 1;
      }
      return withoutDeletedMods(snapshot);
    };
  });
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await rightPane.getByRole('row', { name: /Aetherius - A Race Overhaul/ }).dblclick();

  const installDialog = page.getByRole('dialog', { name: /Aetherius - A Race Overhaul/ });
  await expect(installDialog).toBeVisible();
  await installDialog.getByLabel(/Mod name/).fill('Aetherius - A Race Overhaul');
  await installDialog.getByRole('button', { name: 'Установить', exact: true }).click();

  const installedRow = page.getByRole('row', { name: /Aetherius - A Race Overhaul mod/ });
  await expect(installedRow).toBeVisible();
  await expect(installedRow).toHaveAttribute('data-state', 'post-install-reveal');
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  ));
  expect(await page.evaluate(() => (window as any).__postInstallWorkspaceReads)).toBe(0);

  await installedRow.click();
  await installedRow.press('Delete');
  const deleteDialog = page.getByRole('dialog', { name: 'Удаление мода' });
  await deleteDialog.getByRole('button', { name: 'Удалить' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__postDeleteWorkspaceRead))
    .toBe(true);
  await expect(installedRow).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__postInstallWorkspaceReads)).toBe(0);
});

test('outlines a separator and installs a dragged download after its last mod', async ({ page }) => {
  await openSkyrimBuild(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();

  const source = rightPane.getByRole('row', { name: /Aetherius - A Race Overhaul/ });
  const separator = page.getByRole('row', { name: /Core fixes separator/ });
  await dragDownloadIntoSeparator(page, source, separator);

  const installDialog = page.getByRole('dialog', { name: /Aetherius - A Race Overhaul/ });
  await expect(installDialog).toBeVisible();
  await installDialog.getByLabel(/Mod name/).fill('Aetherius - A Race Overhaul');
  await installDialog.getByRole('button', { name: 'Установить', exact: true }).click();

  const installedRow = page.getByRole('row', { name: /Aetherius - A Race Overhaul mod/ });
  await expect(installedRow).toBeVisible();
  await expect(installedRow).toHaveAttribute('data-in-separator', 'true');
  await expect
    .poll(() => latestCallPayload(page, 'downloads.install'))
    .toMatchObject({
      request: {
        modOrderTargetIndex: 3,
        profileName: 'Default'
      }
    });
  expect((await callMethods(page)).filter((method) => method === 'mods.moveOrderItem')).toEqual([]);
  await expect
    .poll(() =>
      page.locator('.mod-list-row[data-order-id]').evaluateAll((rows) =>
        rows.slice(0, 4).map((row) => row.getAttribute('data-order-id'))
      )
    )
    .toEqual(['sep_core', 'mod_ussep', 'mod_skyui', 'mod_aetherius_a_race_overhaul']);
});

test('post-install mod reveal clears search, expands the separator and scrolls to a new virtualized row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseUrl);
  await enableLargePostInstallRevealWorkspace(page);
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const modListBody = page.locator('.mod-list__body');
  await expect(modListBody).toBeVisible();
  const initialListMetrics = await modListBody.evaluate((element) => ({
    renderedRowCount: element.querySelectorAll('.mod-list-row[data-order-id]').length,
    virtualRowCount: Math.round(element.scrollHeight / 48)
  }));
  expect(initialListMetrics.virtualRowCount).toBeGreaterThan(80);
  expect(initialListMetrics.renderedRowCount).toBeLessThan(initialListMetrics.virtualRowCount);

  const separatorRow = page.getByRole('row', { name: /Core fixes separator/ });
  await separatorRow.getByRole('button', { name: /Collapse Core fixes/ }).click();
  await expect(separatorRow).toHaveAttribute('aria-expanded', 'false');

  const searchInput = page.getByLabel('Search mods');
  await searchInput.fill('SkyUI');
  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await resetPostInstallRevealAnimationProbe(page, 'mod_aetherius_a_race_overhaul');
  await rightPane.getByRole('row', { name: /Aetherius - A Race Overhaul/ }).dblclick();

  const installDialog = page.getByRole('dialog', { name: /Aetherius - A Race Overhaul/ });
  await expect(installDialog).toBeVisible();
  await installDialog.getByLabel(/Mod name/).fill('Aetherius - A Race Overhaul');
  await installDialog.getByRole('button', { name: 'Установить', exact: true }).click();
  await expect(installDialog).toHaveCount(0);

  const installedRow = page.locator(
    '.mod-list-row[data-order-id="mod_aetherius_a_race_overhaul"]'
  );
  await expect(searchInput).toHaveValue('');
  await expect(installedRow).toBeVisible();
  await expect(installedRow).toHaveAttribute('data-selected', 'true');
  await expect(installedRow).toHaveAttribute('data-in-separator', 'true');
  await expect(page.locator('.mod-list-row[data-selected="true"]')).toHaveCount(1);
  await expect(installedRow).toBeFocused();
  await expect(installedRow).toHaveAttribute('data-state', 'post-install-reveal');

  const revealState = await installedRow.evaluate((element) => {
    const container = element.closest<HTMLElement>('.mod-list__body');
    const rowBounds = element.getBoundingClientRect();
    const containerBounds = container?.getBoundingClientRect();
    const animation = window.getComputedStyle(element, '::after');
    return {
      animationDuration: animation.animationDuration,
      animationFillMode: animation.animationFillMode,
      animationIterationCount: animation.animationIterationCount,
      animationName: animation.animationName,
      centerDelta: containerBounds
        ? Math.abs(
            rowBounds.top + rowBounds.height / 2 -
              (containerBounds.top + containerBounds.height / 2)
          )
        : Number.POSITIVE_INFINITY,
      maxVisibleCenterDelta: containerBounds
        ? Math.max(0, (containerBounds.height - rowBounds.height) / 2) + 2
        : 0,
      scrollTop: container?.scrollTop ?? 0
    };
  });
  expect(revealState).toMatchObject({
    animationDuration: '0.7s',
    animationFillMode: 'both',
    animationIterationCount: '1',
    animationName: 'post-install-mod-reveal'
  });
  expect(revealState.centerDelta).toBeLessThanOrEqual(revealState.maxVisibleCenterDelta);
  expect(revealState.scrollTop).toBeGreaterThan(0);

  await expect
    .poll(() => postInstallRevealAnimationEvents(page), { timeout: 3_000 })
    .toEqual(['animationend']);
  await expect(installedRow).not.toHaveAttribute('data-state');
  await expect(installedRow).toBeFocused();
  expect((await callMethods(page)).filter((method) => method === 'window.openModDetails')).toEqual([]);
  await modListBody.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(separatorRow).toHaveAttribute('aria-expanded', 'true');
});

test('fast 5k mod and plugin scrolls paint the destination window without growing the DOM', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseUrl);
  await enableLargeAdaptiveScrollWorkspace(page);
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const assertFastDestinationWindow = async (
    body: Locator,
    targetOrderId: string
  ) => {
    await expect(body).toHaveAttribute('data-virtualized', 'adaptive');
    const result = await body.evaluate(async (element, orderId) => {
      const targetIndex = 4200;
      element.scrollTop = targetIndex * 48;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      const target = element.querySelector<HTMLElement>(
        `[data-order-id="${orderId}"]`
      );
      const rows = element.querySelectorAll<HTMLElement>('[data-order-id]');
      return {
        contentVisibility: target ? getComputedStyle(target).contentVisibility : '',
        endIndex: Number(element.dataset.virtualEndIndex),
        renderedRows: rows.length,
        scrollHeight: element.scrollHeight,
        startIndex: Number(element.dataset.virtualStartIndex),
        targetIsRendered: Boolean(target)
      };
    }, targetOrderId);

    expect(result.targetIsRendered).toBe(true);
    expect(result.contentVisibility).toBe('visible');
    expect(result.startIndex).toBeLessThanOrEqual(4200);
    expect(result.endIndex).toBeGreaterThan(4200);
    expect(result.renderedRows).toBeLessThan(150);
    expect(result.scrollHeight).toBeGreaterThanOrEqual(5000 * 48);
    expect(result.scrollHeight).toBeLessThanOrEqual(5001 * 48);
  };

  await assertFastDestinationWindow(
    page.locator('.mod-list__body[data-virtualized="adaptive"]'),
    'mod_performance_4200'
  );
  await assertFastDestinationWindow(
    page.locator('.plugin-table .mod-table__body[data-virtualized="adaptive"]').first(),
    'plugin_performance_4200'
  );
});

test('Replace and Merge reveal and highlight the existing row', async ({ page }) => {
  await openSkyrimBuild(page);
  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const searchInput = page.getByLabel('Search mods');
  const installedRow = page.locator('.mod-list-row[data-order-id="mod_skyui"]');
  await expect(installedRow).toBeVisible();

  const installAgain = async (mode: 'Объединить' | 'Заменить') => {
    await searchInput.fill('Aetherius');
    await expect(installedRow).toHaveCount(0);
    await resetPostInstallRevealAnimationProbe(page, 'mod_skyui');
    await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();
    const dialog = page.getByRole('dialog', { name: /SkyUI/ });
    await dialog.getByRole('button', { name: 'Установить', exact: true }).click();
    await expect(dialog.getByText('Уже есть мод с таким же названием')).toBeVisible();
    await dialog.getByRole('button', { name: new RegExp(mode) }).click();
    await expect(dialog).toHaveCount(0);

    await expect(searchInput).toHaveValue('');
    await expect(installedRow).toBeVisible();
    await expect(installedRow).toHaveAttribute('data-state', 'post-install-reveal');
    await expect(installedRow).toHaveAttribute('data-selected', 'true');
    await expect(installedRow).toBeFocused();
    await expect
      .poll(() => postInstallRevealAnimationEvents(page), { timeout: 3_000 })
      .toEqual(['animationend']);
    await expect(installedRow).not.toHaveAttribute('data-state');
  };

  await installAgain('Объединить');
  await installAgain('Заменить');
});

test('post-install mod reveal keeps selection and focus without animation for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSkyrimBuild(page);

  const separatorRow = page.getByRole('row', { name: /Core fixes separator/ });
  await separatorRow.getByRole('button', { name: /Collapse Core fixes/ }).click();
  await expect(separatorRow).toHaveAttribute('aria-expanded', 'false');
  const searchInput = page.getByLabel('Search mods');
  await searchInput.fill('no installed mod matches this');

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await resetPostInstallRevealAnimationProbe(page, 'mod_skyui');
  await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();
  const dialog = page.getByRole('dialog', { name: /SkyUI/ });
  await dialog.getByRole('button', { name: 'Установить', exact: true }).click();
  await dialog.getByRole('button', { name: /Объединить/ }).click();
  await expect(dialog).toHaveCount(0);

  const installedRow = page.locator('.mod-list-row[data-order-id="mod_skyui"]');
  await expect(searchInput).toHaveValue('');
  await expect(separatorRow).toHaveAttribute('aria-expanded', 'true');
  await expect(installedRow).toHaveAttribute('data-selected', 'true');
  await expect(installedRow).toBeFocused();
  await expect(installedRow).not.toHaveAttribute('data-state');
  await page.waitForTimeout(250);
  expect(await postInstallRevealAnimationEvents(page)).toEqual([]);
});

test('shows an accepted inbound Nexus download before any native list refresh', async ({ page }) => {
  await openSkyrimBuild(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await expect(rightPane.getByRole('row', { name: /SkyUI/ })).toBeVisible();

  const listCallsBeforeInbound = await page.evaluate(() => {
    const scope = window as any;
    scope.localStorage.setItem('fluxora.test.returnInboundDownload', 'true');
    const count = scope.__fluxoraCalls.filter(
      (call: { method: string }) => call.method === 'downloads.list'
    ).length;
    scope.__emitFluxoraInboundNxm({ operationId: 'op_test_inbound_download' });
    return count;
  });

  await expect(
    rightPane.getByRole('row', { name: /Cabbage CS Preset/ })
  ).toBeVisible();
  await expect
    .poll(() => latestCallPayload(page, 'nxm.importInboundDownloads'))
    .toMatchObject({ operation: { operationId: 'op_test_inbound_download' } });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'downloads.list'
        ).length
      )
    )
    .toBe(listCallsBeforeInbound);
});

test('keeps NXM responsive while two installs finalize and preserves the terminal row identity and position', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto(baseUrl);
  await page.evaluate(() => {
    window.localStorage.setItem('fluxora.test.installDelayMs', '200');
    window.localStorage.setItem('fluxora.test.installFinalizationDelayMs', '1200');
    window.localStorage.setItem('fluxora.test.installConflictSnapshotDelayMs', '150');
    window.localStorage.setItem('fluxora.test.returnInboundDownload', 'pending-then-resolved');
    window.localStorage.setItem('fluxora.test.installedNexusLatest', 'true');
  });
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const source = rightPane.getByRole('row', { name: /Aetherius - A Race Overhaul/ });
  const separator = page.getByRole('row', { name: /Core fixes separator/ });
  await dragDownloadIntoSeparator(page, source, separator);
  const installDialog = page.getByRole('dialog', { name: /Aetherius - A Race Overhaul/ });
  await installDialog.getByLabel(/Mod name/).fill('Aetherius - A Race Overhaul');
  await installDialog.getByRole('button', { name: 'Установить', exact: true }).click();

  await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();
  const secondInstallDialog = page.getByRole('dialog', { name: /SkyUI/ });
  await secondInstallDialog.getByRole('button', { name: 'Установить', exact: true }).click();
  await secondInstallDialog.getByRole('button', { name: /Объединить/ }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const operations = [...(window as any).__fluxoraInstallOperations.values()];
        return operations.filter((operation: { state?: string }) => operation.state === 'finalizing').length;
      })
    )
    .toBe(2);

  await page.evaluate(() => {
    (window as any).__emitFluxoraInboundNxm({ operationId: 'op_nxm_during_install' });
  });
  await expect(rightPane.getByText('Importing NXM', { exact: true })).toHaveCount(0);
  await expect(rightPane.getByRole('row', { name: /Получаем название/ })).toBeVisible({
    timeout: 500
  });
  await expect(rightPane.getByRole('row', { name: /Cabbage CS Preset/ })).toBeVisible({
    timeout: 1_500
  });

  const installedRow = page.locator(
    '.mod-list-row[data-order-id="mod_aetherius_a_race_overhaul"]'
  );
  await expect(installedRow).toBeVisible();
  await expect(installedRow.locator('.mod-list-row__latest')).toHaveText('2.1.0');
  const installedIndex = await installedRow.evaluate((row) =>
    [...document.querySelectorAll('.mod-list-row[data-order-id]')].indexOf(row)
  );
  expect(installedIndex).toBe(3);

  const submit = await page.evaluate(() =>
    (window as any).__fluxoraCalls
      .filter((call: { method: string; payload?: { request?: { modName?: string } } }) =>
        call.method === 'installs.submit' &&
        call.payload?.request?.modName === 'Aetherius - A Race Overhaul'
      )
      .at(-1)?.payload
  ) as any;
  const operationId = String(submit?.request?.operationId ?? '');
  const rebasesBeforeLateSnapshot = (await callMethods(page)).filter(
    (method) => method === 'mods.rebasePendingInstall'
  ).length;
  await page.evaluate(({ operationId }) => {
    (window as any).__emitFluxoraInstallConflictSnapshot(operationId, 0);
  }, { operationId });
  await page.waitForTimeout(200);

  await expect(installedRow).toBeVisible();
  expect(await installedRow.evaluate((row) =>
    [...document.querySelectorAll('.mod-list-row[data-order-id]')].indexOf(row)
  )).toBe(installedIndex);
  expect((await callMethods(page)).filter(
    (method) => method === 'mods.rebasePendingInstall'
  ).length).toBe(rebasesBeforeLateSnapshot);
  await expect(page.getByText(/Bridge request timed out/i)).toHaveCount(0);
});

test('keeps NXM responsive while a destructive main-lane delete is pending', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto(baseUrl);
  await page.evaluate(() => {
    window.localStorage.setItem('fluxora.test.deleteInstalledDelayMs', '1200');
    window.localStorage.setItem('fluxora.test.returnInboundDownload', 'pending-then-resolved');
  });
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const modRow = page.getByRole('row', { name: /SkyUI mod/ });
  await modRow.click();
  await modRow.press('Delete');
  await page.getByRole('dialog', { name: 'Удаление мода' })
    .getByRole('button', { name: 'Удалить' })
    .click();
  await expect.poll(() => callMethods(page)).toContain('mods.deleteInstalled');

  await page.evaluate(() => {
    (window as any).__emitFluxoraInboundNxm({ operationId: 'op_nxm_during_delete' });
  });
  await expect(rightPane.getByText('Importing NXM', { exact: true })).toHaveCount(0);
  await expect(rightPane.getByRole('row', { name: /Получаем название/ })).toBeVisible({
    timeout: 500
  });
  await expect(rightPane.getByRole('row', { name: /Cabbage CS Preset/ })).toBeVisible({
    timeout: 1_500
  });
  await expect(page.locator('.operation-overlay')).toHaveCount(0);
  await expect(page.getByText(/Bridge request timed out/i)).toHaveCount(0);
});

test('keeps downloads rows visible during delayed refresh', async ({ page }) => {
  await page.goto(baseUrl);

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await expect(rightPane.getByRole('row', { name: /SkyUI/ })).toBeVisible();

  await page.evaluate(() => {
    (window as typeof window & { __fluxoraDownloadsListDelayMs?: number }).__fluxoraDownloadsListDelayMs =
      900;
  });
  await page.keyboard.press('F5');
  const skeletonTable = rightPane.locator('.download-table--skeleton');
  await expect(skeletonTable).toHaveCount(0);
  await expect(rightPane.getByText('Loading downloads', { exact: true })).toHaveCount(0);
  await expect(rightPane.getByRole('row', { name: /SkyUI/ })).toBeVisible();
});

test('refreshes the build in place without a blocking loading splash', async ({ page }) => {
  await openSkyrimBuild(page);
  const skyUiRow = page.getByRole('row', { name: /SkyUI mod/ });
  await expect(skyUiRow).toBeVisible();

  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __backgroundWorkspaceRefreshCalls?: number;
      fluxora: any;
    };
    const getWorkspace = testWindow.fluxora.mods.getWorkspace;
    testWindow.__backgroundWorkspaceRefreshCalls = 0;
    testWindow.fluxora.mods.getWorkspace = async (...args: unknown[]) => {
      testWindow.__backgroundWorkspaceRefreshCalls =
        (testWindow.__backgroundWorkspaceRefreshCalls ?? 0) + 1;
      await new Promise((resolve) => setTimeout(resolve, 900));
      return getWorkspace(...args);
    };
  });

  await page.keyboard.press('F5');
  await expect(skyUiRow).toBeVisible();
  await expect(page.locator('.mod-list-row--skeleton')).toHaveCount(0);
  await expect(page.getByText('Обновляем интерфейс', { exact: true })).toHaveCount(0);
  await expect(page.locator('.flx-loading-splash')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).__backgroundWorkspaceRefreshCalls ?? 0))
    .toBeGreaterThanOrEqual(1);
});

test('does not flash a stale downloads drop cue when returning to the downloads tab', async ({ page }) => {
  await openSkyrimBuild(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();

  const dropSurface = rightPane.locator('.download-drop-surface');
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await dropSurface.dispatchEvent('dragenter', { dataTransfer });
  await dataTransfer.dispose();
  await expect(dropSurface).toHaveAttribute('data-drop-state', 'hover');

  await rightPane.getByRole('tab', { name: /Данные/ }).click();
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();

  expect(await rightPaneTransientSnapshot(page)).toMatchObject({
    downloadDropCueCount: 0,
    downloadDropState: 'idle'
  });
});

test('clears plugin row drop indicators before switching right pane tabs', async ({ page }) => {
  await openSkyrimBuild(page);

  const rightPane = page.getByLabel('Right pane');
  const source = page.getByRole('row', { name: /SkyUI\.esp plugin/ });
  const target = page.getByRole('row', { name: /Skyrim\.esm plugin/ });

  await moveRowDragToSlot(page, source, target, 'after');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).evaluate((element) => {
    (element as HTMLElement).click();
  });
  await rightPane.getByRole('tab', { name: /Плагины/ }).evaluate((element) => {
    (element as HTMLElement).click();
  });

  const snapshot = await rightPaneTransientSnapshot(page);
  await page.mouse.up();

  expect(snapshot).toMatchObject({
    pluginLoadingCount: 0,
    rowDropTargetCount: 0
  });
});

test('uses the redesigned right pane tabs for plugins, data and downloads', async ({ page }) => {
  await page.goto(baseUrl);

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  const rightPaneTabs = rightPane.locator('.right-pane-tabs');
  await expect(rightPane.getByRole('tab', { name: 'Плагины', exact: true })).toBeVisible();
  await expect(rightPane.getByRole('tab', { name: 'Данные', exact: true })).toBeVisible();
  await expect(rightPane.getByRole('tab', { name: 'Загрузки', exact: true })).toBeVisible();
  await expect(rightPane.getByRole('tab', { name: /Сборка/ })).toHaveCount(0);
  await expect(rightPaneTabs.locator('strong')).toHaveCount(0);
  await expect(rightPaneTabs).toHaveAttribute('data-active-index', '0');
  await expect
    .poll(() =>
      rightPane
        .getByRole('tab', { name: 'Плагины', exact: true })
        .evaluate((element) => getComputedStyle(element).color)
    )
    .toBe('rgb(255, 255, 255)');
  const rightPaneTabWidths = await rightPane.locator('.right-pane-tabs button').evaluateAll((tabs) =>
    tabs.map((tab) => Math.round((tab as HTMLElement).getBoundingClientRect().width))
  );
  expect(new Set(rightPaneTabWidths).size).toBe(1);

  const pluginsTable = page.getByRole('table', { name: 'Plugin load order' });
  await expect(pluginsTable).toBeVisible();
  await expect(pluginsTable.getByRole('columnheader', { name: 'State' })).toHaveCount(0);
  await expect(pluginsTable.getByRole('columnheader', { name: 'Статус' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Skyrim.esm/ })).toBeVisible();
  await expect(rightPane.getByText('00')).toBeVisible();
  await expect(rightPane.locator('.plugin-type-badge')).toHaveCount(0);

  await rightPane.getByRole('tab', { name: 'Загрузки', exact: true }).click();
  await expect(rightPaneTabs).toHaveAttribute('data-active-index', '2');
  await expect(rightPane.getByRole('tab', { name: 'Загрузки', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await rightPane.getByRole('tab', { name: 'Плагины', exact: true }).click();

  const pluginSeparatorRow = page.getByRole('row', { name: /Late patches separator/ });
  await pluginSeparatorRow.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Свернуть все' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Развернуть все' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete separator' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Collapse Late patches' }).click();
  await expect(pluginSeparatorRow).toHaveAttribute('data-collapsed', 'true');
  await expect(pluginSeparatorRow).toHaveAttribute('data-missing-masters', 'true');
  const separatorWarning = pluginSeparatorRow.getByRole('button', {
    name: /Отсутствуют мастер-файлы/
  });
  await expect(separatorWarning).toBeVisible();
  await separatorWarning.hover();
  await expect(page.getByRole('tooltip', { name: 'Отсутствующие мастер-файлы' })).toContainText(
    'Aardvark.esm'
  );
  await page.getByRole('button', { name: 'Expand Late patches' }).click();
  await expect(pluginSeparatorRow).toHaveAttribute('data-missing-masters', 'false');

  const pluginRow = page.getByRole('row', { name: /SkyUI\.esp/ });
  const warning = pluginRow.getByRole('button', { name: /Отсутствуют мастер-файлы/ });
  await expect(warning).toBeVisible();
  await warning.hover();
  const tooltip = page.getByRole('tooltip', { name: 'Отсутствующие мастер-файлы' });
  await expect(tooltip).toContainText('Отсутствующие мастер-файлы');
  await expect(tooltip.locator('li').first()).toHaveText('Aardvark.esm');
  await expect(tooltip).toContainText('Update.esm');
  await expect(tooltip).toContainText('Zed.esm');
  await pluginRow.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
  const shellCallsBeforePluginReveal = await page.evaluate(() => {
    const calls = (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls ?? [];
    return {
      openPath: calls.filter((call) => call.method === 'shell.openPath').length,
      showItemInFolder: calls.filter((call) => call.method === 'shell.showItemInFolder').length
    };
  });
  await page.getByRole('menuitem', { name: 'Открыть в проводнике' }).click();
  await expect
    .poll(() => latestCallPayload(page, 'shell.showItemInFolder'))
    .toMatchObject({
      path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI\\Data\\SkyUI.esp'
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.filter((call) => call.method === 'shell.showItemInFolder').length
      )
    )
    .toBe(shellCallsBeforePluginReveal.showItemInFolder + 1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.filter((call) => call.method === 'shell.openPath').length
      )
    )
    .toBe(shellCallsBeforePluginReveal.openPath);

  await rightPane.getByRole('tab', { name: /Данные/ }).click();
  await expect(rightPane.getByText('Project paths and selected mod files')).toHaveCount(0);
  await expect(rightPane.getByText('Selected mod data')).toHaveCount(0);
  await expect(rightPane.getByText('Loading tree', { exact: true })).toHaveCount(0);
  await expect(rightPane.locator('.right-pane-path-list')).toHaveCount(0);
  const effectiveTree = rightPane.getByRole('tree', { name: 'Effective game root' });
  await expect(effectiveTree).toBeVisible();
  await expect(effectiveTree.getByRole('treeitem', { name: /Game Root/ })).toBeVisible();
  await expect(effectiveTree.getByRole('treeitem', { name: /^Collapse Data\b/ })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  await expect(effectiveTree.getByRole('treeitem', { name: /Data\\SkyUI\.esp/ })).toContainText(
    'SkyUI'
  );
  await expect(effectiveTree.getByRole('treeitem', { name: /Data\\textures/ })).toBeVisible();
  await expect(rightPane.getByRole('button', { name: 'Open Mods' })).toHaveCount(0);
  await expect(rightPane.getByRole('button', { name: 'Edit Mods' })).toHaveCount(0);
  await effectiveTree.getByRole('button', { name: 'Open Data\\SkyUI.esp' }).click();
  await expect
    .poll(() => latestCallPayload(page, 'shell.openPath'))
    .toMatchObject({
      path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI\\Data\\SkyUI.esp'
    });

  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const downloadsTable = rightPane.getByRole('table', { name: 'Downloads' });
  await expect(downloadsTable).toBeVisible();
  await expect(rightPane.getByRole('row', { name: /SkyUI/ })).toBeVisible();
  await expect(downloadsTable.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);
  await expect(rightPane.getByText('Selected download')).toHaveCount(0);
  await expect(downloadsTable.getByText('Aetherius - A Race Overhaul', { exact: true })).toBeVisible();
  await expect(downloadsTable.getByText(/26686-2-14-1-1719514447/)).toHaveCount(0);
  await expect(rightPane.getByRole('button', { name: 'Refresh downloads' })).toHaveCount(0);
  await expect(rightPane.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
  await expect(rightPane.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0);
  await expect(rightPane.getByRole('button', { name: 'NXM', exact: true })).toHaveCount(0);
});

test('restores collapsed mod and plugin separators per build after restart', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => window.localStorage.setItem('fluxora.test.sameGameBuild', 'true'));
  await page.reload();
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const modSeparator = page.getByRole('row', { name: /Core fixes separator/ });
  const pluginSeparator = page.getByRole('row', { name: /Late patches separator/ });
  await modSeparator.getByRole('button', { name: 'Collapse Core fixes' }).click();
  await pluginSeparator.getByRole('button', { name: 'Collapse Late patches' }).click();
  await expect(modSeparator).toHaveAttribute('aria-expanded', 'false');
  await expect(pluginSeparator).toHaveAttribute('aria-expanded', 'false');

  await page.reload();
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);
  await expect(page.getByRole('row', { name: /Core fixes separator/ })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await expect(page.getByRole('row', { name: /Late patches separator/ })).toHaveAttribute(
    'aria-expanded',
    'false'
  );

  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Open Skyrim performance profile' }).click();
  await expect(page.getByRole('heading', { name: 'Skyrim performance profile' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Core fixes separator/ })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  await expect(page.getByRole('row', { name: /Late patches separator/ })).toHaveAttribute(
    'aria-expanded',
    'true'
  );

  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Open Skyrim graphics overhaul' }).click();
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Core fixes separator/ })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await expect(page.getByRole('row', { name: /Late patches separator/ })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
});

test('creates a plugin separator from the row menu and moves the selected plugins into it', async ({
  page
}) => {
  await page.goto(baseUrl);
  await page.evaluate(async () => {
    const scope = window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: unknown }>;
      fluxora: any;
    };
    const originalRows = await scope.fluxora.plugins.list('', '', null, {
      operationId: 'plugin_separator_fixture'
    });
    const skyrim = structuredClone(
      originalRows.find((item: any) => item.orderId === 'plugin_skyrim')
    );
    const firstSeparator = structuredClone(
      originalRows.find((item: any) => item.orderId === 'sep_patches')
    );
    const skyui = structuredClone(
      originalRows.find((item: any) => item.orderId === 'plugin_skyui')
    );
    let pluginRows = [
      skyrim,
      firstSeparator,
      skyui,
      {
        ...structuredClone(firstSeparator),
        id: 'sep_late',
        orderId: 'sep_late',
        order: 3,
        separatorTitle: 'Late compatibility'
      },
      {
        ...structuredClone(skyui),
        id: 'Patch.esp',
        orderId: 'plugin_patch',
        order: 4,
        name: 'Patch.esp',
        sourceMod: 'Patch',
        masterFiles: [],
        missingMasters: []
      }
    ];
    const reindex = () => {
      pluginRows = pluginRows.map((item: any, order: number) => ({ ...item, order }));
    };

    scope.fluxora.plugins.list = async () => structuredClone(pluginRows);
    scope.fluxora.plugins.listPersisted = async () => structuredClone(pluginRows);
    scope.fluxora.plugins.createSeparator = async (
      projectDirectory: string,
      templateId: string,
      profileName: string | null,
      title: string,
      targetIndex: number,
      operation: unknown
    ) => {
      scope.__fluxoraCalls?.push({
        method: 'plugins.createSeparator',
        payload: {
          operation,
          profileName,
          projectDirectory,
          targetIndex,
          templateId,
          title
        }
      });
      pluginRows.splice(targetIndex, 0, {
        ...structuredClone(firstSeparator),
        id: 'sep_created',
        orderId: 'sep_created',
        separatorTitle: title
      });
      reindex();
      return structuredClone(pluginRows);
    };
    scope.fluxora.plugins.deleteSeparator = async (
      projectDirectory: string,
      templateId: string,
      profileName: string | null,
      orderId: string,
      operation: unknown
    ) => {
      scope.__fluxoraCalls?.push({
        method: 'plugins.deleteSeparator',
        payload: { operation, orderId, profileName, projectDirectory, templateId }
      });
      pluginRows = pluginRows.filter((item: any) => item.orderId !== orderId);
      reindex();
      return structuredClone(pluginRows);
    };
    scope.fluxora.plugins.move = async (
      projectDirectory: string,
      templateId: string,
      profileName: string | null,
      orderId: string,
      targetIndex: number,
      operation: unknown
    ) => {
      scope.__fluxoraCalls?.push({
        method: 'plugins.move',
        payload: { operation, orderId, profileName, projectDirectory, targetIndex, templateId }
      });
      const sourceIndex = pluginRows.findIndex((item: any) => item.orderId === orderId);
      const [moving] = pluginRows.splice(sourceIndex, 1);
      pluginRows.splice(Math.max(0, Math.min(targetIndex, pluginRows.length)), 0, moving);
      reindex();
      return structuredClone(pluginRows);
    };
  });
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  const skyrim = rightPane.getByRole('row', { name: /Skyrim\.esm plugin/ });
  const skyui = rightPane.getByRole('row', { name: /SkyUI\.esp plugin/ });
  const patch = rightPane.getByRole('row', { name: /Patch\.esp plugin/ });
  await skyrim.click();
  await page.keyboard.down('Control');
  await skyui.click();
  await patch.click();
  await page.keyboard.up('Control');

  await skyui.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create separator' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create separator' });
  await dialog.getByLabel('Separator name').fill('Official content');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();

  await expect
    .poll(() =>
      rightPane.locator('.plugin-row[data-order-id]').evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-order-id'))
      )
    )
    .toEqual([
      'sep_created',
      'plugin_skyrim',
      'plugin_skyui',
      'plugin_patch',
      'sep_patches',
      'sep_late'
    ]);
  await expect(skyrim).toHaveAttribute('data-in-separator', 'true');
  await expect(skyui).toHaveAttribute('data-in-separator', 'true');
  await expect(patch).toHaveAttribute('data-in-separator', 'true');
  await expect
    .poll(() => latestCallPayload(page, 'plugins.createSeparator'))
    .toMatchObject({
      targetIndex: 0,
      title: 'Official content'
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          (window as typeof window & {
            __fluxoraCalls?: Array<{
              method: string;
              payload?: { orderId?: string; targetIndex?: number };
            }>;
          }).__fluxoraCalls ?? []
        )
          .filter((call) => call.method === 'plugins.move')
          .map((call) => call.payload)
      )
    )
    .toEqual([
      expect.objectContaining({ orderId: 'plugin_skyui', targetIndex: 2 }),
      expect.objectContaining({ orderId: 'plugin_patch', targetIndex: 3 })
    ]);
});

test('aligns plugin and download searches with mods and hides download commands', async ({ page }) => {
  await page.goto(baseUrl);

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const modsPane = page.getByRole('region', { name: 'Mods', exact: true });
  const rightPane = page.getByRole('region', { name: 'Right pane', exact: true });
  const modsSearch = modsPane.getByRole('textbox', { name: 'Search mods' });

  const expectSearchesAligned = async (rightPaneSearch: Locator) => {
    await expect
      .poll(async () => {
        const [modsSearchBox, rightPaneSearchBox] = await Promise.all([
          modsSearch.boundingBox(),
          rightPaneSearch.boundingBox()
        ]);

        if (!modsSearchBox || !rightPaneSearchBox) {
          return Number.POSITIVE_INFINITY;
        }

        return Math.abs(modsSearchBox.y - rightPaneSearchBox.y);
      })
      .toBeLessThanOrEqual(1);
  };

  const pluginsSearch = rightPane.getByRole('textbox', { name: 'Search plugins' });
  await expect(pluginsSearch).toBeVisible();
  await expectSearchesAligned(pluginsSearch);

  await rightPane.getByRole('tab', { name: 'Загрузки', exact: true }).click();
  const downloadsSearch = rightPane.getByRole('textbox', { name: 'Search downloads' });
  await expect(downloadsSearch).toBeVisible();
  await expectSearchesAligned(downloadsSearch);

  await expect(rightPane.getByRole('button', { name: 'Refresh downloads' })).toHaveCount(0);
  await expect(rightPane.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
  await expect(rightPane.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0);
  await expect(rightPane.getByRole('button', { name: 'NXM', exact: true })).toHaveCount(0);
});

test('keeps both build panes at the full available height as their lists change', async ({ page }) => {
  await page.goto(baseUrl);

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const buildPage = page.locator('.build-page');
  const workbench = page.locator('.build-workbench');
  const modsPane = page.getByRole('region', { name: 'Mods', exact: true });
  const rightPane = page.getByRole('region', { name: 'Right pane', exact: true });

  await expect(modsPane).toBeVisible();
  await expect(rightPane).toBeVisible();

  const paneGeometry = async () => {
    const [buildPageBox, workbenchBox, modsPaneBox, rightPaneBox] = await Promise.all([
      buildPage.boundingBox(),
      workbench.boundingBox(),
      modsPane.boundingBox(),
      rightPane.boundingBox()
    ]);

    if (!buildPageBox || !workbenchBox || !modsPaneBox || !rightPaneBox) {
      throw new Error('Build pane geometry is unavailable');
    }

    return {
      buildPageBottom: buildPageBox.y + buildPageBox.height,
      workbenchBottom: workbenchBox.y + workbenchBox.height,
      workbenchHeight: workbenchBox.height,
      modsPaneHeight: modsPaneBox.height,
      rightPaneHeight: rightPaneBox.height
    };
  };

  const before = await paneGeometry();
  expect(Math.abs(before.buildPageBottom - before.workbenchBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.modsPaneHeight - before.rightPaneHeight)).toBeLessThanOrEqual(1);

  await page.getByLabel('Search mods').fill('no-matching-mods');
  await expect(modsPane.getByText(/0 visible/)).toBeVisible();
  const downloadsTab = rightPane.getByRole('tab', { name: 'Загрузки', exact: true });
  await downloadsTab.click();
  await expect(downloadsTab).toHaveAttribute('aria-selected', 'true');
  await rightPane.getByLabel('Search downloads').fill('no-matching-downloads');
  await expect(rightPane.getByText('No matching downloads')).toBeVisible();

  const after = await paneGeometry();
  expect(Math.abs(after.buildPageBottom - after.workbenchBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.modsPaneHeight - after.rightPaneHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.workbenchHeight - before.workbenchHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.modsPaneHeight - before.modsPaneHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.rightPaneHeight - before.rightPaneHeight)).toBeLessThanOrEqual(1);
});

test('does not auto-loop failed effective Data tree loads', async ({ page }) => {
  await page.goto(baseUrl);

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  await page.evaluate(() => {
    let attempts = 0;
    const api = (window as any).fluxora;
    api.mods.getEffectiveFileTreeRoot = async (
      projectDirectory: string,
      profileName: string,
      limit: number,
      operation: unknown
    ) => {
      attempts += 1;
      (window as any).__failedEffectiveTreeAttempts = attempts;
      (window as any).__fluxoraCalls.push({
        method: 'mods.getEffectiveFileTreeRoot',
        payload: { limit, operation, profileName, projectDirectory }
      });
      throw new Error('simulated effective tree timeout');
    };
  });

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Данные/ }).click();
  await expect(rightPane.getByRole('button', { name: 'Повторить' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__failedEffectiveTreeAttempts ?? 0))
    .toBe(1);

  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).__failedEffectiveTreeAttempts ?? 0)).toBe(1);

  await rightPane.getByRole('button', { name: 'Повторить' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__failedEffectiveTreeAttempts ?? 0))
    .toBe(2);

  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).__failedEffectiveTreeAttempts ?? 0)).toBe(2);
});

test('keeps the loaded effective Data tree stable across same-revision refresh events', async ({ page }) => {
  await openSkyrimBuild(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Данные/ }).click();

  const effectiveTree = rightPane.getByRole('tree', { name: 'Effective game root' });
  const dataFolder = effectiveTree.getByRole('treeitem', { name: /^Collapse Data\b/ });
  const skyUiFile = effectiveTree.getByRole('treeitem', { name: /Data\\SkyUI\.esp/ });

  await expect(dataFolder).toHaveAttribute('aria-expanded', 'true');
  await expect(skyUiFile).toBeVisible();

  const callCountsBeforeRefresh = await page.evaluate(() => {
    const calls = (window as any).__fluxoraCalls as Array<{ method: string }>;
    return {
      root: calls.filter((call) => call.method === 'mods.getEffectiveFileTreeRoot').length,
      children: calls.filter((call) => call.method === 'mods.getEffectiveFileTreeChildren').length
    };
  });

  await page.evaluate(() => (window as any).__emitFluxoraBuildContentChanged());

  await expect(dataFolder).toHaveAttribute('aria-expanded', 'true');
  await expect(skyUiFile).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (window as any).__fluxoraCalls as Array<{ method: string }>;
        return calls.filter((call) => call.method === 'mods.getEffectiveFileTreeRoot').length;
      })
    )
    .toBe(callCountsBeforeRefresh.root + 1);

  await page.waitForTimeout(400);
  const callCountsAfterRefresh = await page.evaluate(() => {
    const calls = (window as any).__fluxoraCalls as Array<{ method: string }>;
    return {
      root: calls.filter((call) => call.method === 'mods.getEffectiveFileTreeRoot').length,
      children: calls.filter((call) => call.method === 'mods.getEffectiveFileTreeChildren').length
    };
  });

  expect(callCountsAfterRefresh).toEqual({
    root: callCountsBeforeRefresh.root + 1,
    children: callCountsBeforeRefresh.children
  });
});

test('drags plugin rows without selecting text', async ({ page }) => {
  await openSkyrimBuild(page);

  const source = page.getByRole('row', { name: /SkyUI\.esp plugin/ });
  const target = page.getByRole('row', { name: /Skyrim\.esm plugin/ });

  await dragRowToSlot(page, source, target, 'after');
  await expect(page.getByText('Moving plugin', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Loading plugins', { exact: true })).toHaveCount(0);

  await expect
    .poll(() => latestCallPayload(page, 'plugins.move'))
    .toMatchObject({
      orderId: 'plugin_skyui',
      targetIndex: 1
    });
});

test('drags every movable selected plugin row and separator as one ordered group', async ({
  page
}) => {
  await page.goto(baseUrl);
  await page.evaluate(async () => {
    const scope = window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: unknown }>;
      fluxora: any;
    };
    const originalRows = await scope.fluxora.plugins.list('', '', null, {
      operationId: 'plugin_group_drag_fixture'
    });
    const template = originalRows.find((item: any) => item.orderId === 'plugin_skyui');
    let pluginRows = [
      ...structuredClone(originalRows),
      {
        ...structuredClone(template),
        id: 'RaceMenu.esp',
        orderId: 'plugin_racemenu',
        order: originalRows.length,
        name: 'RaceMenu.esp',
        sourceMod: 'RaceMenu',
        missingMasters: []
      }
    ];
    scope.fluxora.plugins.list = async () => structuredClone(pluginRows);
    scope.fluxora.plugins.listPersisted = async () => structuredClone(pluginRows);
    scope.fluxora.plugins.move = async (
      projectDirectory: string,
      templateId: string,
      profileName: string | null,
      orderId: string,
      targetIndex: number,
      operation: unknown
    ) => {
      scope.__fluxoraCalls?.push({
        method: 'plugins.move',
        payload: { operation, orderId, profileName, projectDirectory, targetIndex, templateId }
      });
      const sourceIndex = pluginRows.findIndex((item: any) => item.orderId === orderId);
      const [moving] = pluginRows.splice(sourceIndex, 1);
      pluginRows.splice(Math.max(0, Math.min(targetIndex, pluginRows.length)), 0, moving);
      pluginRows = pluginRows.map((item: any, order: number) => ({ ...item, order }));
      return structuredClone(pluginRows);
    };
  });
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  const separator = rightPane.getByRole('row', { name: /Late patches separator/ });
  const skyui = rightPane.getByRole('row', { name: /SkyUI\.esp plugin/ });
  const racemenu = rightPane.getByRole('row', { name: /RaceMenu\.esp plugin/ });
  await separator.click();
  await page.keyboard.down('Control');
  await skyui.click();
  await page.keyboard.up('Control');

  await moveRowDragToSlot(page, skyui, racemenu, 'after');
  await expect(separator).toHaveAttribute('data-dragging', 'true');
  await expect(skyui).toHaveAttribute('data-dragging', 'true');
  await page.mouse.up();

  await expect
    .poll(() =>
      rightPane.locator('.plugin-row[data-order-id]').evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-order-id'))
      )
    )
    .toEqual(['plugin_skyrim', 'plugin_racemenu', 'sep_patches', 'plugin_skyui']);
  await expect(separator).toHaveAttribute('data-selected', 'true');
  await expect(skyui).toHaveAttribute('data-selected', 'true');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          (window as typeof window & {
            __fluxoraCalls?: Array<{ method: string; payload?: { orderId?: string; targetIndex?: number } }>;
          }).__fluxoraCalls ?? []
        )
          .filter((call) => call.method === 'plugins.move')
          .map((call) => call.payload)
      )
    )
    .toEqual([
      expect.objectContaining({ orderId: 'plugin_skyui', targetIndex: 3 }),
      expect.objectContaining({ orderId: 'sep_patches', targetIndex: 2 })
    ]);
});

test('auto-fills SPID identity and installs separate copies as (2) then (3)', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    window.localStorage.setItem('fluxora.test.fomodAnalyzeDelayMs', '50');
    window.localStorage.setItem('fluxora.test.fomodPlanDelayMs', '1000');
  });
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const sourceRow = rightPane.getByRole('row', {
    name: /Spell Perks Item Distributor \(SPID\)/
  });

  const installSeparateCopy = async (expectedSuffix: 2 | 3) => {
    await sourceRow.dblclick();
    const dialog = page.getByRole('dialog', { name: /Install Spell Perks Item Distributor/ });
    const nameInput = dialog.getByLabel(/Mod name/);
    if (expectedSuffix === 2) {
      await expect(nameInput).not.toHaveValue('Spell Perks Item Distributor');
    }
    await nameInput.focus();
    await nameInput.press('Home');
    await nameInput.press('ArrowRight');
    await nameInput.press('ArrowRight');
    await expect(nameInput).toHaveValue('Spell Perks Item Distributor');
    await expect(nameInput).toBeFocused();
    expect(await nameInput.evaluate((input) => (input as HTMLInputElement).selectionStart)).toBe(2);
    await expect(dialog.getByText(/auto.?detected|автоподстанов/i)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Установить', exact: true }).click();
    await expect(dialog.getByText('Уже есть мод с таким же названием')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Заменить/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Объединить/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Это другой мод/ })).toBeVisible();
    await dialog.getByRole('button', { name: /Это другой мод/ }).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(() => latestCallPayload(page, 'downloads.install')).toMatchObject({
      request: {
        modName: 'Spell Perks Item Distributor',
        existingModMode: 0,
        identityDecision: 'install-new',
        newNamePolicy: 'first-free-copy-suffix'
      }
    });
    await expect.poll(() => latestCallPayload(page, 'test.recordInstalledMod')).toMatchObject({
      name: `Spell Perks Item Distributor (${expectedSuffix})`
    });
  };

  await installSeparateCopy(2);
  await page.evaluate(() => {
    window.localStorage.removeItem('fluxora.test.fomodAnalyzeDelayMs');
    window.localStorage.removeItem('fluxora.test.fomodPlanDelayMs');
  });
  await installSeparateCopy(3);
});

test('auto-fills only a proven Nexus lineage and leaves a parallel branch name intact', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => window.localStorage.setItem('fluxora.test.nexusLineageMode', 'proven'));
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  const sourceRow = rightPane.getByRole('row', {
    name: /Spell Perks Item Distributor \(SPID\)/
  });
  await sourceRow.dblclick();
  let dialog = page.getByRole('dialog', { name: /Install Spell Perks Item Distributor/ });
  await expect(dialog.getByLabel(/Mod name/)).toHaveValue('Spell Perks Item Distributor');
  await dialog.getByRole('button', { name: 'Установить', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Заменить/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Объединить/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть окно установки' }).click();
  await expect(dialog).toHaveCount(0);

  await page.evaluate(() => window.localStorage.setItem('fluxora.test.nexusLineageMode', 'parallel'));
  await sourceRow.dblclick();
  dialog = page.getByRole('dialog', { name: /Install Spell Perks Item Distributor/ });
  await expect(dialog.getByLabel(/Mod name/)).toHaveValue('Spell Perks Item Distributor (SPID)');
});

test('uses the first free suffix gap for a separate identity install', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    window.localStorage.setItem(
      'fluxora.test.installNewOccupiedNames',
      JSON.stringify([
        'Spell Perks Item Distributor',
        'Spell Perks Item Distributor (2)',
        'Spell Perks Item Distributor (4)'
      ])
    );
  });
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await rightPane.getByRole('row', {
    name: /Spell Perks Item Distributor \(SPID\)/
  }).dblclick();

  const dialog = page.getByRole('dialog', { name: /Install Spell Perks Item Distributor/ });
  await expect(dialog.getByLabel(/Mod name/)).toHaveValue('Spell Perks Item Distributor');
  await dialog.getByRole('button', { name: 'Установить', exact: true }).click();
  await dialog.getByRole('button', { name: /Это другой мод/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => latestCallPayload(page, 'test.recordInstalledMod')).toMatchObject({
    name: 'Spell Perks Item Distributor (3)'
  });
});

test('replans a user-edited name and shows the newly matched mod conflict', async ({ page }) => {
  await page.goto(baseUrl);
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await rightPane.getByRole('row', {
    name: /Spell Perks Item Distributor \(SPID\)/
  }).dblclick();

  const dialog = page.locator('.install-modal-layout');
  await dialog.getByLabel(/Mod name/).fill('SkyUI');
  await dialog.getByRole('button', { name: 'Установить', exact: true }).click();

  await expect.poll(() => latestCallPayload(page, 'downloads.planInstall')).toMatchObject({
    modName: 'SkyUI',
    profileName: 'Default'
  });
  await expect(dialog.getByText('Уже есть мод с таким же названием')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Заменить/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Объединить/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Это другой мод/ })).toBeVisible();

  await dialog.getByRole('button', { name: /Объединить/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => latestCallPayload(page, 'downloads.install')).toMatchObject({
    request: {
      modName: 'SkyUI',
      existingModMode: 2,
      identityDecision: 'use-match',
      targetModUuid: 'mod_skyui'
    }
  });
});

test('installs a user-renamed identity match without showing the stale conflict', async ({ page }) => {
  await page.goto(baseUrl);
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await rightPane.getByRole('row', {
    name: /Spell Perks Item Distributor \(SPID\)/
  }).dblclick();

  const dialog = page.getByRole('dialog', { name: /Install Spell Perks Item Distributor/ });
  const nameInput = dialog.getByLabel(/Mod name/);
  await expect(nameInput).toHaveValue('Spell Perks Item Distributor');
  await nameInput.fill('Spell Perks Item Distributor Lod Helper');
  await dialog.getByRole('button', { name: 'Установить', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Уже есть мод с таким же названием')).toHaveCount(0);
  await expect.poll(() => latestCallPayload(page, 'downloads.install')).toMatchObject({
    request: {
      modName: 'Spell Perks Item Distributor Lod Helper',
      existingModMode: 0,
      identityDecision: 'install-new',
      newNamePolicy: 'first-free-copy-suffix'
    }
  });
  const installCall = await latestCallPayload(page, 'downloads.install') as {
    request?: { targetModUuid?: string };
  };
  expect(installCall.request?.targetModUuid).toBeUndefined();
  await expect.poll(() => latestCallPayload(page, 'test.recordInstalledMod')).toMatchObject({
    name: 'Spell Perks Item Distributor Lod Helper'
  });
});

test('isolates repeated FOMOD groups and resets native list scrolling between steps', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseUrl);
  await page.evaluate(() =>
    window.localStorage.setItem('fluxora.test.fomodRepeatedGroups', 'true')
  );
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();

  const fomodDialog = page.locator('.install-modal-layout[data-phase="fomod"]');
  const installBody = fomodDialog.locator('.install-dialog-body');
  const groupList = fomodDialog.locator('.fomod-group-list');
  await expect(fomodDialog).toBeVisible();
  await expect(groupList).toBeVisible();

  const bodyScrollState = await installBody.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    scrollTop: element.scrollTop
  }));
  expect(bodyScrollState).toEqual({ overflowY: 'hidden', scrollTop: 0 });

  const assertStep = async (stepNumber: 1 | 2 | 3) => {
    await expect(
      fomodDialog.getByRole('heading', { name: `Repeated step ${stepNumber}`, exact: true })
    ).toBeVisible();
    await expect(groupList.locator('.fomod-group')).toHaveCount(2);
    await expect(groupList.getByText('Select One', { exact: true })).toHaveCount(2);
    await expect(
      groupList.getByText(`Step ${stepNumber} group 1 option 1`, { exact: true })
    ).toHaveCount(1);
    await expect(
      groupList.getByText(`Step ${stepNumber} group 2 option 1`, { exact: true })
    ).toHaveCount(1);
    for (const adjacentStep of [1, 2, 3] as const) {
      if (adjacentStep !== stepNumber) {
        await expect(
          groupList.getByText(`Step ${adjacentStep} group 1 option 1`, { exact: true })
        ).toHaveCount(0);
      }
    }

    await expect(groupList.locator('input[type="radio"]')).toHaveCount(20);
    const radioNames = await groupList.locator('input[type="radio"]').evaluateAll((inputs) =>
      [...new Set(inputs.map((input) => (input as HTMLInputElement).name))]
    );
    expect(radioNames).toEqual([
      `fomod-step-${stepNumber - 1}-group-0`,
      `fomod-step-${stepNumber - 1}-group-1`
    ]);
  };

  await fomodDialog
    .getByRole('button', { name: 'Repeated step 3', exact: true })
    .click();
  await assertStep(3);
  expect(await groupList.evaluate((element) => element.scrollTop)).toBe(0);

  const listScrollState = await groupList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    overscrollBehaviorY: getComputedStyle(element).overscrollBehaviorY,
    scrollHeight: element.scrollHeight
  }));
  expect(listScrollState.overflowY).toBe('auto');
  expect(listScrollState.overscrollBehaviorY).toBe('contain');
  expect(listScrollState.scrollHeight).toBeGreaterThan(listScrollState.clientHeight);

  await groupList.hover();
  await page.mouse.wheel(0, 640);
  await expect
    .poll(() => groupList.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await installBody.evaluate((element) => element.scrollTop)).toBe(0);

  for (const stepNumber of [2, 3, 2, 3, 2] as const) {
    await fomodDialog
      .getByRole('button', { name: `Repeated step ${stepNumber}`, exact: true })
      .click();
    await assertStep(stepNumber);
    expect(await groupList.evaluate((element) => element.scrollTop)).toBe(0);
  }
});

test('explains FOMOD Smart Select and rejects a stale profile before writing files', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => window.localStorage.setItem('fluxora.test.forceFomod', 'true'));
  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();

  const fomodDialog = page.getByRole('dialog', { name: /Natural Vision Of Tamriel/ });
  await expect(fomodDialog).toBeVisible();
  await expect(
    fomodDialog.getByText('Автовыбор · 2 выбрано · 0 требует решения', { exact: true })
  ).toBeVisible();
  await expect.poll(() => latestCallPayload(page, 'downloads.analyzeFomod')).toMatchObject({
    manualDecisions: [],
    profileName: 'Default',
    sourcePath: expect.stringContaining('SkyUI.7z')
  });
  await expect.poll(() => latestCallPayload(page, 'downloads.planInstall')).toMatchObject({
    profileName: 'Default',
    sourcePath: expect.stringContaining('SkyUI.7z')
  });

  await fomodDialog.getByRole('button', { name: 'Patches', exact: true }).click();
  const luxOption = fomodDialog.locator('label.fomod-option').filter({ hasText: 'Lux patch' });
  const luxCheckbox = luxOption.getByRole('checkbox', { name: /Lux patch/ });
  await expect(luxCheckbox).toBeChecked();
  await expect(luxOption.getByText('Выбрано автоматически', { exact: true })).toBeVisible();
  await luxOption.hover();
  await expect(
    fomodDialog.getByText('Master Lux.esp активен (Lux).', { exact: true })
  ).toBeVisible();

  await fomodDialog.getByRole('button', { name: 'Preset', exact: true }).click();
  const fullOption = fomodDialog.locator('label.fomod-option').filter({ hasText: 'Full install' });
  const fullRadio = fullOption.getByRole('radio', { name: /Full install/ });
  await fullRadio.click();
  await expect(fullRadio).toBeChecked();
  await expect(fullOption.getByText('Изменено вручную', { exact: true })).toBeVisible();
  await fomodDialog.getByRole('button', { name: 'Patches', exact: true }).click();

  await page.evaluate(() =>
    window.localStorage.setItem('fluxora.test.fomodContextChangedOnce', 'true')
  );
  await fomodDialog.getByRole('button', { name: 'Установить', exact: true }).click();

  await expect(
    fomodDialog.getByText(
      'Профиль изменился. Автоподбор обновлён; проверьте выбор и нажмите «Установить» ещё раз.',
      { exact: true }
    )
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      ((window as any).__fluxoraCalls as Array<{ method: string }>).filter(
        (call) => call.method === 'test.recordInstalledMod'
      ).length
    )
  ).toBe(0);
  await expect(
    fomodDialog.getByText('Автовыбор · 1 выбрано · 1 требует решения', { exact: true })
  ).toBeVisible();
  await fomodDialog.getByRole('button', { name: 'Preset', exact: true }).click();
  await expect(fullRadio).toBeChecked();
  await expect(fullOption.getByText('Изменено вручную', { exact: true })).toBeVisible();

  await fomodDialog.getByRole('button', { name: 'Patches', exact: true }).click();
  await expect(luxCheckbox).not.toBeChecked();
  await expect(luxOption.getByText('Предупреждение о master', { exact: true })).toBeVisible();
  await luxOption.hover();
  await expect(
    fomodDialog.getByText('Master Lux.esp найден, но неактивен (Lux).', { exact: true })
  ).toBeVisible();
  await luxCheckbox.check();
  await expect(luxOption.getByText('Изменено вручную', { exact: true })).toBeVisible();

  const recalculateButton = fomodDialog.getByRole('button', { name: 'Пересчитать', exact: true });
  await recalculateButton.click();
  await expect(
    fomodDialog.getByText('Автовыбор · 2 выбрано · 0 требует решения', { exact: true })
  ).toBeVisible();
  await expect(luxCheckbox).toBeChecked();
  await expect(luxOption.getByText('Изменено вручную', { exact: true })).toBeVisible();
  await expect(recalculateButton).toBeFocused();

  await fomodDialog.getByRole('button', { name: 'Установить', exact: true }).click();
  await expect(fomodDialog).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as any).__fluxoraCalls as Array<{ method: string }>).filter(
          (call) => call.method === 'test.recordInstalledMod'
        ).length
      )
    )
    .toBe(1);

  const installCalls = await page.evaluate(() =>
    ((window as any).__fluxoraCalls as Array<{ method: string; payload: any }>).filter(
      (call) => call.method === 'downloads.installFomod'
    )
  );
  expect(installCalls).toHaveLength(2);
  expect(installCalls[1]?.payload?.request).toMatchObject({
    fomodContextId: 'fomod-context-2',
    manualDecisions: expect.arrayContaining([
      { optionId: 'full', selected: true },
      { optionId: 'weather', selected: false },
      { optionId: 'lux', selected: true }
    ]),
    profileName: 'Default',
    selectedOptionIds: expect.arrayContaining(['full', 'lux'])
  });
});

test('drives Smart Select from a real ZIP FOMOD with TES4 master headers', async ({ page }) => {
  const fixture = await createRealSmartFomodFixture<FluxoraFomodInstaller>(repositoryRoot);
  try {
    expect(fixture.installer.isFomod).toBe(true);
    expect(fixture.installer.autoSelection?.initialSelectedOptionIds).toHaveLength(1);
    const contextId = fixture.installer.autoSelection?.contextId;
    expect(contextId).toBeTruthy();

    await page.addInitScript(
      ({ installer }) => {
        (window as any).__fluxoraRealFomodInstaller = installer;
        window.localStorage.setItem('fluxora.test.forceFomod', 'true');
      },
      { installer: fixture.installer }
    );
    await page.goto(baseUrl);
    await clickSkyrimBuildSelectButton(page);
    await clickSkyrimBuildOpenButton(page);

    const rightPane = page.getByLabel('Right pane');
    await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
    await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();

    const fomodDialog = page.getByRole('dialog', { name: /Smart Playwright Mod/ });
    await expect(fomodDialog).toBeVisible();
    await expect(
      fomodDialog.getByText('Автовыбор · 1 выбрано · 0 требует решения', { exact: true })
    ).toBeVisible();
    const luxOption = fomodDialog.locator('label.fomod-option').filter({ hasText: 'Lux Patch' });
    await expect(luxOption.getByRole('checkbox', { name: /Lux Patch/ })).toBeChecked();
    await expect(luxOption.getByText('Выбрано автоматически', { exact: true })).toBeVisible();
    await luxOption.hover();
    await expect(
      fomodDialog.getByText('Master Lux.esp активен (Lux).', { exact: true })
    ).toBeVisible();

    await fomodDialog.getByRole('button', { name: 'Установить', exact: true }).click();
    await expect(fomodDialog).toHaveCount(0);
    await expect
      .poll(() => latestCallPayload(page, 'test.recordInstalledMod'))
      .toMatchObject({ name: 'Smart Playwright Mod' });
    await expect.poll(() => latestCallPayload(page, 'downloads.installFomod')).toMatchObject({
      request: {
        fomodContextId: contextId,
        profileName: 'Default',
        selectedOptionIds: fixture.installer.autoSelection?.initialSelectedOptionIds
      }
    });
  } finally {
    await fixture.dispose();
  }
});

test('opens install controls immediately and keeps native installation non-modal', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(baseUrl);
  await page.evaluate(() => window.localStorage.setItem('fluxora.test.fomodExistingMod', 'true'));

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();

  const skyuiRow = rightPane.getByRole('row', { name: /SkyUI/ });
  await skyuiRow.dblclick();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('downloads.planInstall');
  const preflightCalls = await page.evaluate(() =>
    (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
      ?.map((call) => call.method) ?? []
  );
  expect(preflightCalls).toContain('downloads.planInstall');
  expect(preflightCalls).not.toContain('downloads.analyzeContentLayout');
  expect(preflightCalls).not.toContain('downloads.install');

  const skyuiDialog = page.getByRole('dialog', { name: /SkyUI/ });
  await expect(skyuiDialog.getByText('SkyUI', { exact: true }).first()).toBeVisible();
  await expect(skyuiDialog.getByRole('button', { name: 'Подробнее' })).toBeVisible();
  await expect(skyuiDialog.getByRole('button', { name: 'Установить', exact: true })).toBeVisible();
  await skyuiDialog.getByRole('button', { name: 'Установить', exact: true }).click();
  await expect(skyuiDialog.getByText('Уже есть мод с таким же названием')).toBeVisible();
  await expect(skyuiDialog.getByRole('button', { name: /Заменить/ })).toBeVisible();
  await expect(skyuiDialog.getByRole('button', { name: /Объединить/ })).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
        ?.map((call) => call.method) ?? []
    )
  ).not.toContain('downloads.install');
  await page.evaluate(() => window.localStorage.setItem('fluxora.test.installDelayMs', '1200'));
  await skyuiDialog.getByRole('button', { name: /Объединить/ }).click();
  await expect(skyuiDialog).toHaveCount(0);
  await expect(page.locator('.install-dialog[data-phase="installing"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('downloads.install');
  expect(await rightPane.locator('.mod-busy-strip').count()).toBe(0);
  const downloadInstallCall = await page.evaluate(() =>
    (window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: { request?: { existingModMode?: number } } }>;
    }).__fluxoraCalls?.find((call) => call.method === 'downloads.install')
  );
  expect(downloadInstallCall?.payload?.request?.existingModMode).toBe(2);
  await page.evaluate(() => window.localStorage.removeItem('fluxora.test.installDelayMs'));
  await expect(skyuiRow.getByText('Installed', { exact: true })).toBeVisible();

  const listCallsBeforeFomod = await page.evaluate(() =>
    (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
      ?.filter((call) => call.method === 'mods.listInstalled').length ?? 0
  );
  await page.evaluate(() => {
    window.localStorage.setItem('fluxora.test.fomodAnalyzeDelayMs', '1000');
    window.localStorage.setItem('fluxora.test.fomodPlanDelayMs', '15000');
    window.localStorage.setItem('fluxora.test.installListDelayMs', '500');
    window.localStorage.setItem('fluxora.test.fomodExistingMod', 'true');
    window.localStorage.setItem('fluxora.test.forceFomod', 'true');
  });
  await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();
  const immediateDialog = page.locator('.install-modal-layout[role="dialog"]');
  await expect.poll(() => latestCallPayload(page, 'downloads.analyzeFomod')).toMatchObject({
    delayMs: 1_000,
    sourcePath: expect.stringContaining('SkyUI.7z')
  });
  await expect(immediateDialog).toHaveAttribute('aria-busy', 'true', { timeout: 500 });
  await expect(immediateDialog.getByLabel(/Mod name/)).toHaveCount(0);
  await expect(immediateDialog.getByRole('button', { name: 'Подробнее' })).toHaveCount(0);
  await expect(immediateDialog.getByRole('button', { name: 'Установить', exact: true })).toHaveCount(0);
  await expect(page.locator('.install-dialog[data-phase="analyzing"]')).toHaveCount(0);
  await expect.poll(() => latestCallPayload(page, 'downloads.planInstall')).toMatchObject({ delayMs: 15_000 });
  const fomodDialog = page.getByRole('dialog', { name: /Natural Vision Of Tamriel/ });
  await expect(fomodDialog.getByText('Natural Vision Of Tamriel').first()).toBeVisible({ timeout: 2_000 });
  await expect(fomodDialog).not.toHaveAttribute('aria-busy', 'true');
  const stepSidebar = fomodDialog.locator('.install-step-sidebar');
  await expect(stepSidebar).toBeVisible();
  await expect(fomodDialog.locator('.install-step-ribbon')).toHaveCount(0);
  await expect(fomodDialog.getByText('choose one', { exact: true })).toHaveCount(0);
  await expect(fomodDialog.getByText('Previously selected', { exact: true })).toBeVisible();
  await expect(fomodDialog.locator('.fomod-option__thumb')).toHaveCount(1);
  await expect(fomodDialog.locator('.install-fomod-preview__image img')).toHaveCount(1);

  const sidebarBox = await stepSidebar.boundingBox();
  const dialogBox = await fomodDialog.locator('.install-dialog').boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(Math.abs((sidebarBox?.height ?? 0) - (dialogBox?.height ?? 0))).toBeLessThanOrEqual(1);
  expect(await stepSidebar.locator('.install-step-sidebar__list').evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');

  const weatherRadio = fomodDialog.getByRole('radio', { name: /Weather only/ });
  await expect(weatherRadio).toBeChecked();
  await expect(fomodDialog.getByText('Full install').first()).toBeVisible();
  const fullRadio = fomodDialog.getByRole('radio', { name: /Full install/ });
  await fullRadio.click();
  await expect(fullRadio).toBeChecked();
  expect(await fullRadio.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('999px');
  await expect(fomodDialog.locator('.install-fomod-preview__image')).toHaveCount(0);
  await expect(fomodDialog.getByText('option', { exact: true })).toHaveCount(0);

  await fomodDialog.getByRole('button', { name: 'Patches', exact: true }).click();
  await expect(fomodDialog.getByText('Lux patch').first()).toBeVisible();
  const luxOption = fomodDialog.locator('label.fomod-option').filter({ hasText: 'Lux patch' });
  const luxCheckbox = luxOption.getByRole('checkbox', { name: /Lux patch/ });
  await luxCheckbox.check();
  await expect(luxCheckbox).toBeChecked();
  await expect(luxOption.locator('.fomod-option__control > svg.lucide-check')).toHaveCount(1);
  await expect(luxOption.locator(':scope > svg')).toHaveCount(0);
  expect(await luxCheckbox.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('4px');
  await fomodDialog.getByRole('button', { name: 'Preset', exact: true }).click();
  await expect(fullRadio).toBeChecked();
  await fomodDialog.getByRole('button', { name: 'Patches', exact: true }).click();
  await expect(luxCheckbox).toBeChecked();
  await fomodDialog.getByRole('button', { name: 'Установить', exact: true }).click();
  await expect(fomodDialog.getByRole('button', { name: 'Подготовка…', exact: true })).toBeVisible();
  await expect(luxCheckbox).toBeChecked();
  await expect(fomodDialog.getByText('Installing mod', { exact: true })).toHaveCount(0);
  await expect(fomodDialog.getByLabel(/Mod name/)).toHaveCount(0);
  await expect(fomodDialog.getByText('Уже есть мод с таким же названием')).toBeVisible({
    timeout: 17_000
  });
  expect(
    await page.evaluate(() =>
      (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
        ?.filter((call) => call.method === 'mods.listInstalled').length ?? 0
    )
  ).toBe(listCallsBeforeFomod);
  expect(
    await page.evaluate(() =>
      (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
        ?.map((call) => call.method) ?? []
    )
  ).not.toContain('downloads.installFomod');
  await page.evaluate(() => window.localStorage.setItem('fluxora.test.installDelayMs', '1200'));
  await fomodDialog.getByRole('button', { name: /Заменить/ }).click();
  await expect(fomodDialog).toHaveCount(0);
  await expect(page.locator('.install-dialog[data-phase="installing"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('downloads.installFomod');
  const fomodInstallCall = await page.evaluate(() =>
    (window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: { request?: Record<string, unknown> } }>;
    }).__fluxoraCalls?.find((call) => call.method === 'downloads.installFomod')
  );
  expect(fomodInstallCall?.payload?.request).toMatchObject({
    existingModMode: 1,
    fomodContextId: 'fomod-context-1',
    manualDecisions: expect.arrayContaining([
      { optionId: 'full', selected: true },
      { optionId: 'weather', selected: false }
    ]),
    profileName: 'Default',
    selectedOptionIds: expect.arrayContaining(['full', 'lux']),
    resolutionId: expect.any(String),
    identityDecision: 'use-match',
    targetModUuid: 'mod_nvt',
    newNamePolicy: 'first-free-copy-suffix'
  });
  await page.evaluate(() => {
    window.localStorage.removeItem('fluxora.test.installDelayMs');
    window.localStorage.removeItem('fluxora.test.fomodAnalyzeDelayMs');
    window.localStorage.removeItem('fluxora.test.fomodPlanDelayMs');
    window.localStorage.removeItem('fluxora.test.forceFomod');
  });
});

test('renders Settings Nexus status instantly while native auth status is delayed', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'fluxora.settings.nexusStatus',
      JSON.stringify({
        isConfigured: true,
        isLinked: true,
        hasApiKey: true,
        displayName: 'Cached Playwright user',
        userId: 'cached-playwright',
        message: 'Linked',
        clientId: 'fluxora',
        redirectUri: 'http://127.0.0.1:8089/callback',
        operationId: 'op_cached_nexus'
      })
    );
    (window as typeof window & { __fluxoraNexusStatusDelayMs?: number }).__fluxoraNexusStatusDelayMs = 60_000;
  });

  await page.goto(`${baseUrl}/?window=settings`);

  await expect(page.locator('.titlebar__brand-name')).toHaveText('Settings');
  await expect(page.getByText('Reconnecting')).toBeVisible();
  await expect(page.getByText('Status not loaded')).toHaveCount(0);
  await expect(page.getByText('Loading settings')).toHaveCount(0);
  await expect(page.locator('.mod-busy-strip')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('connections.listStatus');
});

test('keeps secondary Settings connection recovery passive without starting OAuth', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'fluxora.settings.nexusStatus',
      JSON.stringify({
        isConfigured: true,
        isLinked: true,
        displayName: 'Cached Playwright user',
        userId: 'cached-playwright',
        clientId: 'fluxora',
        redirectUri: 'http://127.0.0.1:8089/callback',
        operationId: 'op_cached_nexus'
      })
    );
    const scope = window as typeof window & {
      __fluxoraNexusInitiallyLinked?: boolean;
      __fluxoraNexusStatusFailuresRemaining?: number;
    };
    scope.__fluxoraNexusInitiallyLinked = true;
    scope.__fluxoraNexusStatusFailuresRemaining = 2;
  });

  await page.goto(`${baseUrl}/?window=settings`);

  await expect(page.getByText('Reconnecting')).toBeVisible();
  const nexusSwitch = page.getByRole('switch', { name: 'Nexus Mods account' });
  await expect(nexusSwitch).toBeDisabled();

  const callsBeforeRetry = await page.evaluate(() =>
    (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
      ?.map((call) => call.method) ?? []
  );
  expect(callsBeforeRetry).not.toContain('nexus.connect');
  expect(callsBeforeRetry).not.toContain('nexus.disconnect');

  expect(callsBeforeRetry).toContain('connections.listStatus');
  expect(callsBeforeRetry).not.toContain('connections.restoreAll');
  expect(callsBeforeRetry).not.toContain('connections.connect');
  expect(callsBeforeRetry).not.toContain('connections.disconnect');
});

test('uses the redesigned Settings window for Nexus, language and MO2 transfer actions', async ({ page }) => {
  await page.goto(`${baseUrl}/?window=settings`);

  await expect(page.locator('.settings-nav__header')).toHaveCount(0);
  await expect(page.locator('.titlebar__brand-name')).toHaveText('Settings');
  await expect(page.locator('.titlebar__mark--settings')).toBeVisible();
  await expect(page.getByRole('button', { name: /Connections/ })).toBeVisible();
  await expect(page.locator('.settings-nav button').filter({ hasText: /^AI/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Languages/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Transfer/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Для разработчиков/ })).toBeVisible();
  await expect(page.locator('.settings-nav button').last()).toContainText('Для разработчиков');
  await expect(page.locator('.settings-panel--ai')).toHaveCount(0);
  await expect(page.getByText('Chat model')).toHaveCount(0);
  await page.getByRole('button', { name: /Connections/ }).click();
  await expect(page.getByText('Account bridge')).toHaveCount(0);
  await expect(page.getByText('Nexus Mods', { exact: true })).toBeVisible();
  const connectionsPanelBox = await page.locator('.settings-panel--connections').boundingBox();
  const connectionRowBox = await page.locator('.settings-service-row--connection').boundingBox();
  expect(connectionsPanelBox).not.toBeNull();
  expect(connectionRowBox).not.toBeNull();
  if (connectionsPanelBox && connectionRowBox) {
    const leftGap = connectionRowBox.x - connectionsPanelBox.x;
    const rightGap = connectionsPanelBox.x + connectionsPanelBox.width - (connectionRowBox.x + connectionRowBox.width);
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
  }

  await page.getByRole('switch', { name: 'Nexus Mods account' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('connections.connect');
  await expect(page.getByText('Connected - Playwright user')).toBeVisible();
  await expect(page.getByText('Playwright API')).toBeVisible();
  await expect(page.getByText('421 / 500')).toBeVisible();
  await expect(page.getByText('19,876 / 20,000')).toBeVisible();

  await page.getByRole('button', { name: /Languages/ }).click();
  await expect(page.getByText('Choose the renderer language.')).toHaveCount(0);
  await expect(page.getByText(/settings\.json - language=/)).toHaveCount(0);
  const languagePanelBox = await page.locator('.settings-panel--language').boundingBox();
  const languageRowBox = await page.locator('.settings-language-row').boundingBox();
  expect(languagePanelBox).not.toBeNull();
  expect(languageRowBox).not.toBeNull();
  if (languagePanelBox && languageRowBox && connectionRowBox) {
    const leftGap = languageRowBox.x - languagePanelBox.x;
    const rightGap = languagePanelBox.x + languagePanelBox.width - (languageRowBox.x + languageRowBox.width);
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(languageRowBox.width - connectionRowBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(languageRowBox.height - connectionRowBox.height)).toBeLessThanOrEqual(4);
  }
  const languageButton = page.getByRole('combobox', { name: 'Language' });
  await languageButton.click();
  const languageMenu = page.locator('.language-select__menu[data-open="true"]');
  await expect(languageMenu).toBeVisible();
  const languageMenuBox = await languageMenu.boundingBox();
  expect(languageMenuBox).not.toBeNull();
  expect(languageMenuBox?.height).toBeGreaterThanOrEqual(132);
  expect(languageMenuBox?.height).toBeLessThan(180);
  await expect
    .poll(() =>
      languageMenu.evaluate((element) => ({
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight
      }))
    )
    .toEqual(expect.objectContaining({ overflowY: 'auto' }));
  const languageMenuMetrics = await languageMenu.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(languageMenuMetrics.scrollHeight).toBeLessThanOrEqual(languageMenuMetrics.clientHeight + 1);
  const selectedLanguageOption = page.getByRole('option', { name: /English - English/ });
  const selectedLanguageStyle = await selectedLanguageOption.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      borderTopColor: style.borderTopColor,
      borderTopWidth: style.borderTopWidth
    };
  });
  expect(selectedLanguageStyle.backgroundImage).toBe('none');
  expect(selectedLanguageStyle.borderTopWidth).toBe('1px');
  expect(selectedLanguageStyle.borderTopColor).not.toBe('rgba(0, 0, 0, 0)');
  const germanLanguageOption = page.getByRole('option', { name: /Deutsch - German/ });
  await germanLanguageOption.hover();
  await expect
    .poll(() =>
      germanLanguageOption.evaluate((element) => getComputedStyle(element).backgroundColor)
    )
    .toContain('0.15');
  const hoveredLanguageStyle = await germanLanguageOption.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderTopColor: style.borderTopColor
    };
  });
  expect(hoveredLanguageStyle.backgroundImage).toBe('none');
  expect(hoveredLanguageStyle.backgroundColor).toContain('0.15');
  expect(hoveredLanguageStyle.borderTopColor).toBe('rgba(0, 0, 0, 0)');
  await page.getByRole('option', { name: /Русский - Russian/ }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('settings.setLanguage');
  await expect(page.getByText(/settings\.json - language=/)).toHaveCount(0);

  await page.getByRole('button', { name: /Для разработчиков/ }).click();
  await expect(page.locator('.settings-panel--developer')).toBeVisible();
  const developerSwitch = page.getByRole('switch', { name: 'Режим разработчика' });
  await expect(developerSwitch).toHaveAttribute('aria-checked', 'false');
  await developerSwitch.click();
  await expect(developerSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Дата последней сборки')).toBeVisible();
  await expect(page.getByText('Tauri 2 / React / TypeScript')).toBeVisible();
  await expect(page.getByText('Rust shell / C++ core')).toBeVisible();
  await expect(page.getByText('0.0.0-test')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть оригинальный репозиторий Fluxora на GitHub' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string; payload?: unknown }> }).__fluxoraCalls
          ?.find((call) => call.method === 'links.openExternal')
      )
    )
    .toEqual({
      method: 'links.openExternal',
      payload: { url: 'https://github.com/WhistleSkyrim/Fluxora' }
    });

  await page.getByRole('button', { name: /Transfer/ }).click();
  await expect(page.getByText('Mod Organizer 2', { exact: true })).toBeVisible();
  const transferButton = page.getByRole('button', {
    name: 'Перенести сборку из Mod Organizer 2'
  });
  await expect(transferButton).toBeEnabled();
  await transferButton.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toEqual(expect.arrayContaining(['transfer.openMo2InMain', 'window.close']));
});

test('captures phase 13 visual acceptance surfaces across desktop sizes', async ({ page }, testInfo) => {
  test.setTimeout(180_000);

  for (const size of visualReviewSizes) {
    await page.setViewportSize(size);

    await page.goto(baseUrl);
    await page.evaluate(() => window.localStorage.removeItem('fluxora.test.forceFomod'));
    await expect(page.getByLabel('Build library sidebar')).toBeVisible();
    await expect(page.getByText('2 builds')).toBeVisible();
    await capturePhase13Screenshot(page, testInfo, 'home-library', size);

    await openSkyrimBuild(page);
    const workbench = page.locator('.build-workbench');
    await expect(page.getByRole('table', { name: 'Mod order' })).toBeVisible();
    await expect(workbench).toBeVisible();

    const workbenchOverflow = await workbench.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    expect(workbenchOverflow.scrollWidth).toBeLessThanOrEqual(workbenchOverflow.clientWidth + 2);

    await capturePhase13Screenshot(page, testInfo, 'build-mods', size);

    const rightPane = page.getByLabel('Right pane');
    await expect(page.getByRole('table', { name: 'Plugin load order' })).toBeVisible();
    await expect(rightPane.getByRole('tab', { name: /Плагины/ })).toHaveAttribute('aria-selected', 'true');
    await capturePhase13Screenshot(page, testInfo, 'plugins-right-pane', size);

    await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
    await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();
    const simpleDialog = page.getByRole('dialog', { name: /SkyUI/ });
    await expect(simpleDialog).toBeVisible();
    await expect(simpleDialog.getByRole('button', { name: 'Подробнее' })).toBeVisible();
    await expect(simpleDialog.getByRole('button', { name: 'Установить', exact: true })).toBeVisible();
    await capturePhase13Screenshot(page, testInfo, 'install-dialog', size);

    await simpleDialog.getByRole('button', { name: 'Закрыть окно установки' }).click();
    await page.evaluate(() => window.localStorage.setItem('fluxora.test.forceFomod', 'true'));
    await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();
    const fomodDialog = page.getByRole('dialog', { name: /Natural Vision Of Tamriel/ });
    await expect(fomodDialog.getByText('Natural Vision Of Tamriel').first()).toBeVisible();
    await expect(fomodDialog.getByRole('button', { name: /Preset/ })).toBeVisible();
    await capturePhase13Screenshot(page, testInfo, 'fomod-wizard', size);

    await page.keyboard.press('Escape');
    await openSkyrimBuild(page);
    await page.evaluate(() => {
      (window as typeof window & { __fluxoraOperationDelayMs?: number }).__fluxoraOperationDelayMs = 900;
    });
    const modsPane = page.getByRole('region', { name: 'Mods', exact: true });
    await modsPane.getByRole('button', { name: 'Действия со сборкой' }).click();
    await page
      .getByRole('menu', { name: 'Действия со сборкой' })
      .getByRole('menuitem', { name: 'Упаковать' })
      .click();
    const fluxPackDialog = page.getByRole('dialog', { name: 'Упаковать сборку' });
    await expect(fluxPackDialog).toBeVisible();
    const fluxPackDialogBox = await fluxPackDialog.boundingBox();
    expect(fluxPackDialogBox).not.toBeNull();
    expect((fluxPackDialogBox?.x ?? -1) + (fluxPackDialogBox?.width ?? size.width + 1)).toBeLessThanOrEqual(
      size.width + 1
    );
    expect((fluxPackDialogBox?.y ?? -1) + (fluxPackDialogBox?.height ?? size.height + 1)).toBeLessThanOrEqual(
      size.height + 1
    );
    await capturePhase13Screenshot(page, testInfo, 'fluxpack-export-dialog', size);
    const fluxPackPackageTypeSelect = fluxPackDialog.getByRole('combobox', {
      name: 'Тип упаковки FluxPack'
    });
    await fluxPackPackageTypeSelect.click();
    const fluxPackPackageTypeMenu = page.getByRole('listbox');
    await expect(fluxPackPackageTypeMenu).toBeVisible();
    await expect(fluxPackPackageTypeMenu).toHaveAttribute('data-open', 'true');
    await expect
      .poll(() =>
        fluxPackPackageTypeMenu.evaluate((element) => window.getComputedStyle(element).opacity)
      )
      .toBe('1');
    await capturePhase13Screenshot(page, testInfo, 'fluxpack-export-package-type-menu', size);
    await page.keyboard.press('Escape');
    await expect(fluxPackDialog).toBeVisible();
    await submitFluxPackExportDialog(page, 'full');
    await expect(page.getByRole('status', { name: 'Упаковываем сборку' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Упаковываем сборку: прогресс' })).toBeVisible();
    await capturePhase13Screenshot(page, testInfo, 'operation-overlay', size);

    await page.goto(`${baseUrl}/?window=settings`);
    await expect(page.locator('.titlebar__brand-name')).toHaveText('Settings');
    await expect(page.locator('.titlebar__mark--settings')).toBeVisible();
    await expect(page.getByText('Nexus Mods', { exact: true })).toBeVisible();
    await capturePhase13Screenshot(page, testInfo, 'settings', size);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(baseUrl);
  await expect(page.getByLabel('Build library sidebar')).toBeVisible();
  await page.keyboard.press('Tab');

  const focusIndicator = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) {
      return { hasIndicator: false };
    }

    const style = getComputedStyle(active);

    return {
      hasIndicator:
        (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') ||
        style.boxShadow !== 'none',
      label: active.getAttribute('aria-label') ?? active.textContent?.trim() ?? ''
    };
  });

  expect(focusIndicator.hasIndicator, `Focused element: ${focusIndicator.label}`).toBe(true);
  await expect(page.getByLabel('Home')).toBeVisible();
  await expect(page.getByLabel('Open settings')).toBeVisible();
  await expect(page.getByLabel('Minimize')).toBeVisible();
  await expect(page.getByLabel('Maximize')).toBeVisible();
  await expect(page.getByLabel('Close')).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);
});

test('captures mods pane visual review sizes', async ({ page }, testInfo) => {
  for (const size of visualReviewSizes) {
    await page.setViewportSize(size);
    await page.goto(baseUrl);
    await clickSkyrimBuildSelectButton(page);
    await clickSkyrimBuildOpenButton(page);

    const workbench = page.locator('.build-workbench');
    await expect(page.getByRole('table', { name: 'Mod order' })).toBeVisible();
    await expect(workbench).toBeVisible();

    const overflow = await workbench.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`mods-pane-${size.width}x${size.height}.png`)
    });
  }
});

test('text editor provides a VS Code-style workbench and protects dirty files', async ({ page }, testInfo) => {
  const project = encodeURIComponent('D:\\Fluxora\\Configs\\skyrim-main.json');
  const projectDirectory = encodeURIComponent('D:\\Fluxora\\Builds\\Skyrim graphics overhaul');
  const mod = encodeURIComponent('D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Bug Fixes SSE');
  const relativePath = encodeURIComponent('SKSE/Plugins/BugFixesSSE.json');

  await page.addInitScript(() => {
    (window as typeof window & { __fluxoraNexusStatusDelayMs?: number })
      .__fluxoraNexusStatusDelayMs = 60_000;
  });

  await page.setViewportSize({ width: 1344, height: 912 });
  await page.goto(
    `${baseUrl}/?window=text-editor&project=${project}&directory=${projectDirectory}&mod=${mod}&path=${relativePath}&name=BugFixesSSE.json`
  );

  await expect(page.getByLabel('Fluxora code editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'true');
  const codeEditor = page.locator('.monaco-editor').first();
  await expect(codeEditor).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.view-lines')).toContainText('animationLoadSignedCrash');
  await expect(page.getByRole('button', { name: 'Command Palette' })).toBeVisible();

  await page.getByRole('treeitem', { name: /SKSE/ }).click();
  await page.getByRole('treeitem', { name: /Plugins/ }).click();
  await expect(page.getByRole('treeitem', { name: /BugFixesSSE\.json/ })).toBeVisible();

  await page.keyboard.press('Control+Shift+P');
  const commandPalette = page.getByRole('dialog', { name: 'Command Palette' });
  const commandInput = commandPalette.getByRole('textbox', {
    name: 'Command Palette'
  });
  await expect(commandPalette).toBeVisible();
  await expect(commandInput).toBeFocused();
  await expectSolidFocusBand(commandInput, '.text-editor-quick-input-field');
  await page.keyboard.press('Escape');

  await codeEditor.click();
  await page.keyboard.press('Control+End');
  await expect(page.locator('.text-editor-statusbar')).toContainText('Ln 6, Col 1');
  await page.keyboard.press('Control+Delete');
  await expect(page.locator('.text-editor-statusbar')).toContainText('Ln 6, Col 1');

  await page.keyboard.press('Control+S');
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as typeof window & {
      __fluxoraCalls?: Array<{ method: string }>;
    }).__fluxoraCalls ?? [];
    return calls.filter((call) => call.method === 'mods.saveTextFile').length;
  })).toBe(1);
  await page.keyboard.press('Control+S');
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as typeof window & {
      __fluxoraCalls?: Array<{ method: string }>;
    }).__fluxoraCalls ?? [];
    return calls.filter((call) => call.method === 'mods.saveTextFile').length;
  })).toBe(2);
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: { content?: string } }>;
    }).__fluxoraCalls ?? [];
    return calls.filter((call) => call.method === 'mods.saveTextFile').at(-1)?.payload?.content;
  })).toBe('{\n  "fixes": {\n    "animationLoadSignedCrash": true\n  }\n}\n');
  await expect(page.locator('.text-editor-statusbar')).toContainText('Ln 6, Col 1');

  await page.keyboard.type(' ');
  await expect(page.getByLabel('Unsaved').first()).toBeVisible();

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Save changes?');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.keyboard.press('Control+S');
  await expect(page.locator('.text-editor-statusbar')).toContainText('Saved BugFixesSSE.json');
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as typeof window & {
      __fluxoraCalls?: Array<{ method: string }>;
    }).__fluxoraCalls ?? [];
    return calls.filter((call) => call.method === 'mods.saveTextFile').length;
  })).toBe(3);

  await page.keyboard.press('Control+Shift+S');
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as typeof window & {
      __fluxoraCalls?: Array<{ method: string }>;
    }).__fluxoraCalls ?? [];
    return calls.some((call) => call.method === 'textFiles.save');
  })).toBe(true);

  await page.keyboard.press('Control+Shift+F');
  const searchInput = page.locator('input[aria-label="Search open editors"]');
  await searchInput.fill('animationLoadSignedCrash');
  await expect(page.locator('.text-editor-search-result')).toHaveCount(1);
  await expect(page.locator('.text-editor-statusbar')).toContainText('JSON');
  await expectNoDocumentHorizontalOverflow(page);

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('text-editor-workbench.png')
  });

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as typeof window & {
      __fluxoraCalls?: Array<{ method: string }>;
    }).__fluxoraCalls ?? [];
    return calls.some((call) => call.method === 'window.close');
  })).toBe(true);
});

test('text editor deletes the numeric character selected by a mouse-positioned caret', async ({ page }) => {
  const project = encodeURIComponent('D:\\Fluxora\\Configs\\skyrim-main.json');
  const projectDirectory = encodeURIComponent('D:\\Fluxora\\Builds\\Skyrim graphics overhaul');
  const mod = encodeURIComponent('D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Bug Fixes SSE');
  const relativePath = encodeURIComponent('SKSE/Plugins/BugFixesSSE.json');

  await page.addInitScript(() => {
    (window as typeof window & { __fluxoraNumericEditorFixture?: boolean })
      .__fluxoraNumericEditorFixture = true;
  });
  await page.route(/IBMPlexMono-Regular-.*\.woff2$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.continue();
  });
  await page.goto(
    `${baseUrl}/?window=text-editor&project=${project}&directory=${projectDirectory}&mod=${mod}&path=${relativePath}&name=BugFixesSSE.json`
  );

  const codeEditor = page.locator('.monaco-editor').first();
  const numericToken = page.locator('.view-line span').filter({ hasText: /^51$/ }).last();
  await expect(codeEditor).toBeVisible({ timeout: 5_000 });
  await expect(numericToken).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const tokenBox = await numericToken.boundingBox();
  expect(tokenBox).not.toBeNull();
  await page.mouse.click(
    tokenBox!.x + tokenBox!.width * 0.51,
    tokenBox!.y + tokenBox!.height / 2
  );

  await expect(page.locator('.text-editor-statusbar')).toContainText('Ln 1, Col 12');
  const cursorBox = await page.locator('.cursor').last().boundingBox();
  expect(cursorBox).not.toBeNull();
  const caretCenter = cursorBox!.x + cursorBox!.width / 2;
  const digitBoundary = tokenBox!.x + tokenBox!.width / 2;
  expect(Math.abs(caretCenter - digitBoundary)).toBeLessThan(0.5);
  await page.keyboard.press('Delete');
  await expect(page.locator('.view-lines')).toContainText('{"value": 5}');
});

test('file preview progressively renders geometry, textures, and variant replacement', async ({ page }) => {
  const project = encodeURIComponent('D:\\Fluxora\\Configs\\skyrim-main.json');
  const mod = encodeURIComponent('D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Selected Model');
  const relativePath = encodeURIComponent('meshes/armor/cuirass.nif');

  await page.setViewportSize({ width: 1344, height: 912 });
  await page.addInitScript(() => {
    (window as any).__fluxoraPreviewProbe = {
      textureReadCompleted: false,
      variantDelayMs: 500,
      variantPrepareStarted: false
    };
  });
  await page.goto(
    `${baseUrl}/?window=file-preview&project=${project}&mod=${mod}&path=${relativePath}&name=cuirass.nif&profile=Default&kind=nif`
  );

  await expect(page.getByRole('heading', { name: '.nif Preview' })).toBeVisible();
  await expect(page.getByTestId('file-preview-source-mod')).toContainText('Selected Model');
  await expect(page.getByText('meshes/armor/cuirass.nif')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous mod variant' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Next mod variant' })).toBeDisabled();
  await expect(page.getByTestId('file-preview-canvas')).toBeVisible();
  await expect(page.getByText('Loading preview')).toHaveCount(0);
  await expect(page.locator('.file-preview-canvas-host')).toHaveAttribute('data-state', 'ready');
  await expect.poll(() => page.evaluate(
    () => (window as any).__fluxoraPreviewProbe.textureReadCompleted
  )).toBe(false);

  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="file-preview-canvas"]') as HTMLCanvasElement | null;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
      return false;
    }
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) {
      return false;
    }
    const pixels = new Uint8Array(4);
    gl.readPixels(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels
    );
    return pixels.some((value) => value !== 0);
  });

  await expect.poll(() => page.evaluate(
    () => (window as any).__fluxoraPreviewProbe.textureReadCompleted
  )).toBe(true);
  await expect(page.locator('.file-preview-canvas-host')).toHaveAttribute('data-state', 'ready');

  await page.getByRole('button', { name: 'Previous mod variant' }).click();
  await expect.poll(() => page.evaluate(
    () => (window as any).__fluxoraPreviewProbe.variantPrepareStarted
  )).toBe(true);
  await expect(page.locator('.file-preview-canvas-host')).toHaveAttribute('data-state', 'loading');
  await expect(page.getByTestId('file-preview-canvas')).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="file-preview-canvas"]') as HTMLCanvasElement | null;
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!canvas || !gl) {
      return false;
    }
    const pixels = new Uint8Array(4);
    gl.readPixels(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels
    );
    return pixels.some((value) => value !== 0);
  });
  await expect(page.locator('.file-preview-canvas-host')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('file-preview-source-mod')).toContainText('Low Model');
});

test('file preview renders BSDynamicTriShape through the instant worker pipeline', async ({ page }) => {
  const project = encodeURIComponent('D:\\Fluxora\\Configs\\skyrim-main.json');
  const mod = encodeURIComponent('D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Selected Model');
  const relativePath = encodeURIComponent('meshes/actors/character/face.nif');

  await page.addInitScript((modelFixtureBase64) => {
    (window as any).__fluxoraPreviewProbe = {
      modelFixtureBase64,
      textureMode: 'missing',
      textureReadCompleted: false,
      variantPrepareStarted: false
    };
  }, sseDynamicNifFixtureBase64);
  await page.goto(
    `${baseUrl}/?window=file-preview&project=${project}&mod=${mod}&path=${relativePath}&name=face.nif&profile=Default&kind=nif`
  );

  await expect(page.locator('.file-preview-canvas-host')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByText(
    'NIF geometry could not be decoded. This model uses an unsupported geometry layout.'
  )).toHaveCount(0);
  await expect(page.getByTestId('file-preview-canvas')).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="file-preview-canvas"]') as HTMLCanvasElement | null;
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!canvas || !gl) {
      return false;
    }
    const pixels = new Uint8Array(4);
    gl.readPixels(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels
    );
    return pixels.some((value) => value !== 0);
  });
});

test('file preview renders tiny BSTriShape geometry through the instant worker pipeline', async ({ page }) => {
  const project = encodeURIComponent('D:\\Fluxora\\Configs\\skyrim-main.json');
  const mod = encodeURIComponent('D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Selected Model');
  const relativePath = encodeURIComponent('meshes/furniture/smallcookingpotnohandleinv.nif');

  await page.addInitScript((modelFixtureBase64) => {
    (window as any).__fluxoraPreviewProbe = {
      modelFixtureBase64,
      textureMode: 'missing',
      textureReadCompleted: false,
      variantPrepareStarted: false
    };
  }, sseTinyScaleNifFixtureBase64);
  await page.goto(
    `${baseUrl}/?window=file-preview&project=${project}&mod=${mod}&path=${relativePath}&name=smallcookingpotnohandleinv.nif&profile=Default&kind=nif`
  );

  await expect(page.locator('.file-preview-canvas-host')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByText(
    'NIF geometry could not be decoded. This model uses an unsupported geometry layout.'
  )).toHaveCount(0);
  await expect(page.getByTestId('file-preview-canvas')).toBeVisible();
});

test('file preview starts from direct project context when the project catalog is unavailable', async ({ page }) => {
  const project = encodeURIComponent('D:\\Fluxora\\Configs\\skyrim-main.json');
  const projectDirectory = 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul';
  const directory = encodeURIComponent(projectDirectory);
  const mod = encodeURIComponent(`${projectDirectory}\\mods\\Selected Model`);
  const relativePath = encodeURIComponent('meshes/armor/cuirass.nif');

  await page.addInitScript(() => {
    (window as any).__fluxoraEmptyProjectCatalog = true;
  });
  await page.goto(
    `${baseUrl}/?window=file-preview&project=${project}&directory=${directory}&mod=${mod}&path=${relativePath}&name=cuirass.nif&profile=Default&kind=nif`
  );

  await expect(page.getByText('Preview source is unavailable.')).toHaveCount(0);
  await expect(page.locator('.file-preview-canvas-host')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('file-preview-source-mod')).toContainText('Selected Model');
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as any).__fluxoraCalls as Array<{ method: string; payload?: any }>;
    const start = calls.find((call) => call.method === 'mods.startNifPreview');
    return start?.payload?.args?.[0] ?? '';
  })).toBe(projectDirectory);
});

for (const textureMode of ['missing', 'corrupt'] as const) {
  test(`file preview keeps neutral geometry when a texture is ${textureMode}`, async ({ page }) => {
    const project = encodeURIComponent('D:\\Fluxora\\Configs\\skyrim-main.json');
    const mod = encodeURIComponent('D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Selected Model');
    const relativePath = encodeURIComponent('meshes/armor/cuirass.nif');

    await page.addInitScript((mode) => {
      (window as any).__fluxoraPreviewProbe = {
        textureMode: mode,
        textureReadCompleted: false,
        variantPrepareStarted: false
      };
    }, textureMode);
    await page.goto(
      `${baseUrl}/?window=file-preview&project=${project}&mod=${mod}&path=${relativePath}&name=cuirass.nif&profile=Default&kind=nif`
    );

    await expect(page.locator('.file-preview-canvas-host')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('file-preview-canvas')).toBeVisible();
    await expect(page.locator('.file-preview-warnings')).toBeVisible();
    await expect(page.locator('.file-preview-warnings')).toContainText(
      textureMode === 'missing' ? 'Texture not found' : 'Texture could not be decoded'
    );
    await expect(page.locator('.file-preview-canvas-host')).toHaveAttribute('data-state', 'ready');
  });
}

test('file preview performance probe records bounded raw cold and warm runs', async ({ page }) => {
  const project = encodeURIComponent('D:\\Fluxora\\Configs\\skyrim-main.json');
  const mod = encodeURIComponent('D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Selected Model');
  const relativePath = encodeURIComponent('meshes/armor/cuirass.nif');
  const url = `${baseUrl}/?window=file-preview&project=${project}&mod=${mod}&path=${relativePath}&name=cuirass.nif&profile=Default&kind=nif`;

  await page.addInitScript(() => {
    const probe = (window as any).__fluxoraPreviewProbe = {
      peakHeapBytes: 0,
      textureDelayMs: 40,
      textureReadCompleted: false,
      variantPrepareStarted: false
    };
    const sampleHeap = () => {
      const memory = (performance as any).memory;
      if (memory?.usedJSHeapSize) {
        probe.peakHeapBytes = Math.max(probe.peakHeapBytes, memory.usedJSHeapSize);
      }
      window.requestAnimationFrame(sampleHeap);
    };
    window.requestAnimationFrame(sampleHeap);
  });

  const collectRun = async () => {
    await expect(page.locator('.file-preview-canvas-host')).toHaveAttribute('data-state', 'ready');
    await expect.poll(() => page.evaluate(
      () => (window as any).__fluxoraPreviewProbe.textureReadCompleted
    )).toBe(true);
    await expect.poll(() => page.evaluate(() => (
      ((window as any).__fluxoraCalls as Array<{ method: string; payload?: any }>).some(
        (call) => call.method === 'ui.log.NifPreview.Performance'
          && String(call.payload?.message).startsWith('texturesReady ')
      )
    ))).toBe(true);
    return page.evaluate(() => {
      const calls = (window as any).__fluxoraCalls as Array<{ method: string; payload?: any }>;
      const messages = calls
        .filter((call) => call.method === 'ui.log.NifPreview.Performance')
        .map((call) => String(call.payload?.message ?? ''));
      const duration = (prefix: string) => {
        const message = messages.find((candidate) => candidate.startsWith(`${prefix} `)) ?? '';
        return Number(/durationMs=(\d+)/.exec(message)?.[1] ?? Number.NaN);
      };
      const count = (method: string) => calls.filter((call) => call.method === method).length;
      return {
        firstFrameMs: duration('firstFrame'),
        texturesReadyMs: duration('texturesReady'),
        peakHeapBytes: (window as any).__fluxoraPreviewProbe.peakHeapBytes as number,
        startCalls: count('mods.startNifPreview'),
        textureBatchCalls: count('mods.prepareNifPreviewTextures'),
        rawReadCalls: count('mods.readNifPreviewAssetBytes'),
        operationIds: Array.from(new Set(calls
          .filter((call) => call.method === 'ui.log.NifPreview.Performance')
          .map((call) => call.payload?.operationId)
          .filter(Boolean))),
        serializedCalls: JSON.stringify(calls)
      };
    });
  };

  await page.goto(url);
  const cold = await collectRun();
  await page.reload();
  const warm = await collectRun();

  expect(cold.firstFrameMs).toBeLessThan(1_000);
  expect(cold.texturesReadyMs).toBeLessThan(3_000);
  expect(warm.firstFrameMs).toBeLessThan(500);
  expect(warm.texturesReadyMs).toBeLessThan(1_500);
  expect(cold.peakHeapBytes).toBeGreaterThan(0);
  expect(warm.peakHeapBytes).toBeGreaterThan(0);
  for (const run of [cold, warm]) {
    expect(run.startCalls).toBe(1);
    expect(run.textureBatchCalls).toBe(1);
    expect(run.rawReadCalls).toBe(2);
    expect(run.operationIds).toHaveLength(1);
    expect(run.serializedCalls).not.toContain('contentBase64');
  }
});
