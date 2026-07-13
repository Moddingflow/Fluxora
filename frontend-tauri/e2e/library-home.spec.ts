import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test, type Locator, type Page } from '@playwright/test';

const distRoot = path.resolve(__dirname, '..', 'dist');

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
        downloadsDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\downloads',
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
      projectFingerprint: {
        modCount: 64,
        pluginCount: 38,
        sizeBytes: 7283923509
      }
    };
    const projects = [skyrimProject, falloutProject];
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
    const modRows = [
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
    const recordInstalledMod = (request: any, operation: any, fallbackOperationId: string) => {
      const operationId = operation?.operationId ?? fallbackOperationId;
      const name = String(request.modName);
      const existing = modRows.find(
        (item) => item.isMod && String(item.name).toLocaleLowerCase() === name.toLocaleLowerCase()
      );
      const id = existing?.id ?? `${skyrimProject.paths.modsDirectory}\\${name}`;
      const version = existing?.version ?? '';

      if (existing) {
        existing.name = name;
        existing.isEnabled = true;
      } else {
        modRows.push({
          id,
          orderId: `mod_${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
          kind: 'mod',
          order: modRows.length,
          isSeparator: false,
          isMod: true,
          modUuid: '',
          separatorTitle: '',
          name,
          version,
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
          isPatch: false,
          overwritesModIds: [],
          overwrittenByModIds: []
        });
      }

      return { id, name, version, isEnabled: true, operationId };
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
    const downloadRows = [
      {
        id: 'skyui_archive',
        name: 'SkyUI',
        fileName: 'SkyUI.7z',
        localPath: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\downloads\\SkyUI.7z',
        source: 'local',
        status: 'Ready',
        sizeText: '11.8 MB',
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
      },
      {
        id: 'smoothcam_archive',
        name: 'SmoothCam',
        fileName: 'SmoothCam.zip',
        localPath: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\downloads\\SmoothCam.zip',
        source: 'Nexus Mods',
        status: 'Paused',
        sizeText: '2.4 MB',
        createdAtText: 'today',
        progressPercent: 44,
        progressText: '44%',
        etaText: '',
        downloadSpeedText: '',
        isDownloading: false,
        hasKnownProgress: true,
        canResume: true,
        canInstall: false,
        canDelete: true
      },
      {
        id: 'aetherius_archive',
        name: 'Aetherius mod page title',
        fileName: 'Aetherius - A Race Overhaul-26686-2-14-1-1719514447.7z',
        localPath:
          'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\downloads\\Aetherius - A Race Overhaul-26686-2-14-1-1719514447.7z',
        source: 'Nexus Mods',
        status: 'Ready',
        sizeText: '3.6 MB',
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
      }
    ];
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
    const fomodInstaller = {
      isFomod: true,
      moduleName: 'Natural Vision Of Tamriel',
      moduleVersion: '8.2',
      moduleId: 'nvt',
      moduleImagePath: '',
      memoryKey: 'nvt',
      hasPreviousSelection: false,
      previousSelectedOptionIds: [],
      fileDependencies: [],
      requiredFiles: [],
      conditionalFilePatterns: [],
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
                  imagePath: '',
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
                  typePatterns: []
                }
              ]
            }
          ]
        }
      ]
    };
    let language = 'en-us';
    let nexusLinked = false;
    const nexusStatus = () => ({
      clientId: 'test-client',
      displayName: nexusLinked ? 'Playwright user' : '',
      hasApiKey: nexusLinked,
      isConfigured: true,
      isLinked: nexusLinked,
      message: nexusLinked ? 'Linked' : 'Not linked',
      operationId: 'op_nexus',
      redirectUri: 'http://127.0.0.1/callback',
      userId: nexusLinked ? 'playwright' : ''
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
    const operationProgressCallbacks = new Set<(event: any) => void>();
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
      apiLimits: {
        list: async (operation: any) => {
          calls.push({ method: 'apiLimits.list', payload: { operation } });
          return apiLimitStatus();
        }
      },
      archives: {
        install: async (request: any, operation: any) => {
          calls.push({ method: 'archives.install', payload: { operation, request } });
          return recordInstalledMod(request, operation, 'op_archive_install');
        },
        installFomod: async (request: any, operation: any) => {
          calls.push({ method: 'archives.installFomod', payload: { operation, request } });
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
          downloadsDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\downloads',
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
          path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\downloads\\NaturalVisionFomod.7z'
        }),
        pickBuildConfig: async () => ({ canceled: true }),
        pickExecutable: async () => ({ canceled: true }),
        pickFluxPack: async () => ({ canceled: true }),
        pickFolder: async () => ({ canceled: true }),
        saveFluxPack: async (defaultFileName: any, title: any) => {
          calls.push({ method: 'dialogs.saveFluxPack', payload: { defaultFileName, title } });
          return { canceled: false, path: 'D:\\Fluxora\\Exports\\skyrim.fluxpack' };
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
        analyzeContentLayout: async (request: any, operation: any) => {
          calls.push({ method: 'downloads.analyzeContentLayout', payload: { operation, request } });
          return installPreview;
        },
        analyzeFomod: async (projectDirectory: any, sourcePath: any, operation: any) => {
          calls.push({ method: 'downloads.analyzeFomod', payload: { operation, projectDirectory, sourcePath } });
          return String(sourcePath).includes('NaturalVisionFomod')
            ? fomodInstaller
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
        importFile: async (projectDirectory: any, archivePath: any, operation: any) => {
          calls.push({ method: 'downloads.importFile', payload: { archivePath, operation, projectDirectory } });
          return downloadRows[0];
        },
        install: async (request: any, operation: any) => {
          calls.push({ method: 'downloads.install', payload: { operation, request } });
          return recordInstalledMod(request, operation, 'op_download_install');
        },
        installFomod: async (request: any, operation: any) => {
          calls.push({ method: 'downloads.installFomod', payload: { operation, request } });
          return recordInstalledMod(request, operation, 'op_download_fomod');
        },
        list: async (projectDirectory: any) => {
          await waitForDownloadsList();
          const path = String(projectDirectory);
          return path.includes('Playwright build') || path.includes('Fallout test lab')
            ? []
            : downloadRows;
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
      executables: {
        getIcon: async () => ({ iconPath: '', operationId: 'op_icon' }),
        launch: async (configPath: any, executableId: any, profileName: any, operation: any) => {
          calls.push({ method: 'executables.launch', payload: { configPath, executableId, operation, profileName } });
          await waitForOperationPaint();
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
        list: async () => [
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
        checkUpdates: async (projectDirectory: any, operation: any) => {
          calls.push({ method: 'mods.checkUpdates', payload: { operation, projectDirectory } });
          return modRows.filter((item) => item.isMod);
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
          return {};
        },
        deleteSeparator: async (projectDirectory: any, profileName: any, orderId: any, operation: any) => {
          calls.push({
            method: 'mods.deleteSeparator',
            payload: { operation, orderId, profileName, projectDirectory }
          });
          return [];
        },
        getFileTree: async () => [
          {
            name: 'scripts',
            relativePath: 'scripts',
            isDirectory: true,
            hasChildren: false,
            size: 0,
            conflictState: 'none',
            conflictOwners: []
          }
        ],
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
        listPreviewVariants: async () => [
          {
            modPath: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Low Model',
            modName: 'Low Model',
            order: 0,
            enabled: true,
            relativePath: 'meshes/armor/cuirass.nif',
            size: 512
          },
          {
            modPath: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Selected Model',
            modName: 'Selected Model',
            order: 1,
            enabled: true,
            relativePath: 'meshes/armor/cuirass.nif',
            size: 512
          }
        ],
        readPreviewAsset: async (_projectDirectory: any, _profileName: any, modPath: any, relativePath: any, kind: any) => {
          const fixture = JSON.stringify({
            meshes: [
              {
                name: 'Playwright preview triangle',
                positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
                indices: [0, 1, 2],
                uvs: [0, 0, 1, 0, 0, 1]
              }
            ]
          });
          return {
            kind,
            modPath,
            modName: String(modPath).includes('Selected Model') ? 'Selected Model' : 'Low Model',
            relativePath,
            fileName: String(relativePath).split(/[\\/]/).pop() || 'cuirass.nif',
            size: fixture.length,
            mimeType: 'application/octet-stream',
            contentBase64: btoa(`Gamebryo File Format, Version 20.2.0.7\nNiNode NiTriShape NiTriShapeData BSLightingShaderProperty BSShaderTextureSet NiAlphaProperty\nFLUXORA_STATIC_MESH_JSON:${fixture}`)
          };
        },
        getOrder: async (projectDirectory: any) =>
          String(projectDirectory).includes('Playwright build') ||
          String(projectDirectory).includes('Fallout test lab')
            ? []
            : modRows,
        getWorkspace: async (projectDirectory: any) => {
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
          const isEmptyBuild =
            String(projectDirectory).includes('Playwright build') ||
            String(projectDirectory).includes('Fallout test lab');
          return {
            installedMods: isEmptyBuild ? [] : modRows.filter((item) => item.isMod),
            modOrder: isEmptyBuild ? [] : modRows
          };
        },
        invalidateFileCaches: async (_projectDirectory: any, changedPaths: any[]) => ({
          invalidated: changedPaths.length > 0,
          changedPathCount: changedPaths.length
        }),
        listInstalled: async (projectDirectory: any) =>
          String(projectDirectory).includes('Playwright build') ||
          String(projectDirectory).includes('Fallout test lab')
            ? []
            : modRows.filter((item) => item.isMod),
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
        setAllEnabled: async () => ({}),
        setEnabled: async (projectDirectory: any, modId: any, isEnabled: any, operation: any) => {
          calls.push({ method: 'mods.setEnabled', payload: { isEnabled, modId, operation, projectDirectory } });
          return {};
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
          return nexusStatus();
        }
      },
      nxm: {
        captureLinks: async () => [],
        importInboundDownloads: async (projectDirectory: any, operation: any) => {
          calls.push({ method: 'nxm.importInboundDownloads', payload: { operation, projectDirectory } });
          return [];
        },
        onInboundLinksCaptured: () => () => undefined,
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
          projects
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
        rename: async () => skyrimProject
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
        log: async () => undefined
      },
      windowControls: {
        close: async () => {
          calls.push({ method: 'window.close' });
          return undefined;
        },
        minimize: async () => undefined,
        openBuildSettings: async () => undefined,
        openFilePreview: async () => undefined,
        openModDetails: async () => undefined,
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
  await expect(downloadMenu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible();
  await expectRowContextMenuWithoutScrollbar(downloadMenu);
});

test('asks for in-app confirmation before deleting mods, builds and downloaded files', async ({
  page
}) => {
  await openSkyrimBuild(page);

  const modRow = page.getByRole('row', { name: /SkyUI mod/ });
  await modRow.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Delete mod' }).click();

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
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();

  const downloadDialog = page.getByRole('dialog', { name: 'Удаление файла' });
  await expect(downloadDialog).toBeVisible();
  await expect(downloadDialog.getByText('SkyUI', { exact: true })).toBeVisible();
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
  placement: 'before' | 'after'
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
  await expect(target.locator('.row-drop-target-chip')).toHaveText('Сюда');
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
  await page.getByPlaceholder('My Skyrim build').fill('  Playwright build  ');
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

  await rightPane.getByRole('button', { name: 'Refresh downloads' }).click();
  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Open Fallout test lab' }).click();
  await expect(page.getByRole('heading', { name: 'Fallout test lab' })).toBeVisible();
  await page.waitForTimeout(1_400);
  const falloutRightPane = page.getByLabel('Right pane');
  await expect(falloutRightPane.getByRole('row', { name: /SkyUI/ })).toHaveCount(0);
  await expect(falloutRightPane.getByRole('button', { name: 'Refresh downloads' })).toBeEnabled();
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
    .toBe(2);
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

  const exactCallsBeforeReopen = await page.evaluate(() =>
    (window as any).__fluxoraCalls.filter(
      (call: { method: string }) => call.method === 'mods.getWorkspace.profile-coverage-gap'
    ).length
  );
  await page.getByRole('button', { name: 'Home' }).click();
  await clickSkyrimBuildOpenButton(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__fluxoraCalls.filter(
          (call: { method: string }) => call.method === 'mods.getWorkspace.profile-coverage-gap'
        ).length
      )
    )
    .toBe(exactCallsBeforeReopen + 1);
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
    .toBe(2);

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
    .toBe(3);
  expect(
    await page.evaluate(() =>
      (window as any).__fluxoraCalls.filter(
        (call: { method: string }) =>
          call.method === 'mods.getWorkspace.invalidation-happens-before'
      ).length
    )
  ).toBe(2);
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

test('uses the redesigned mods pane for real mod list operations', async ({ page }) => {
  await page.goto(baseUrl);

  await clickSkyrimBuildSelectButton(page);
  await clickSkyrimBuildOpenButton(page);

  const modOrderTable = page.getByRole('table', { name: 'Mod order' });
  await expect(modOrderTable).toBeVisible();
  await expect(modOrderTable.getByRole('columnheader', { name: 'Название' })).toBeVisible();
  await expect(modOrderTable.getByRole('columnheader', { name: 'Версия' })).toBeVisible();
  await expect(modOrderTable.getByRole('columnheader', { name: 'Latest' })).toBeVisible();
  await expect(modOrderTable.getByRole('columnheader', { name: 'Статус' })).toBeVisible();

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
});

test('installs a dragged download immediately at the chosen mod position', async ({ page }) => {
  await openSkyrimBuild(page);

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();

  const source = rightPane.getByRole('row', { name: /Aetherius - A Race Overhaul/ });
  const target = page.getByRole('row', { name: /SkyUI mod/ });
  const targetBox = await target.boundingBox();
  expect(targetBox).not.toBeNull();

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer });
  await expect(source).toHaveAttribute('data-dragging', 'true');
  await target.dispatchEvent('dragover', {
    clientX: targetBox!.x + targetBox!.width / 2,
    clientY: targetBox!.y + 2,
    dataTransfer
  });
  await expect(target).toHaveAttribute('data-install-drop-target', 'true');
  await expect(target).toHaveAttribute('data-drop-placement', 'before');
  await target.dispatchEvent('drop', {
    clientX: targetBox!.x + targetBox!.width / 2,
    clientY: targetBox!.y + 2,
    dataTransfer
  });
  await source.dispatchEvent('dragend', { dataTransfer });
  await dataTransfer.dispose();

  const installDialog = page.getByRole('dialog', { name: /Aetherius - A Race Overhaul/ });
  await expect(installDialog).toBeVisible();
  await expect(
    installDialog.getByText('Aetherius - A Race Overhaul', { exact: true }).first()
  ).toBeVisible();
  await installDialog.getByRole('button', { name: 'Установить', exact: true }).click();

  await expect(installDialog).toHaveCount(0);
  const installedRow = page.getByRole('row', { name: /Aetherius - A Race Overhaul mod/ });
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
    .poll(() => latestCallPayload(page, 'mods.moveOrderItem'))
    .toMatchObject({
      orderId: 'mod_aetherius_a_race_overhaul',
      targetIndex: 2
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
  await rightPane.getByRole('button', { name: 'Refresh downloads' }).click();
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
  await rightPane.getByRole('button', { name: 'Import' }).click();
  await rightPane.getByRole('button', { name: 'NXM' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
  )
    .toEqual(expect.arrayContaining(['downloads.importFile', 'nxm.importInboundDownloads']));
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

test('uses the redesigned install dialogs for downloads and FOMOD archives', async ({ page }) => {
  await page.goto(baseUrl);

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
    .toContain('downloads.analyzeContentLayout');
  const preflightCalls = await page.evaluate(() =>
    (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
      ?.map((call) => call.method) ?? []
  );
  expect(preflightCalls).toContain('downloads.analyzeFomod');
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
  await skyuiDialog.getByRole('button', { name: /Объединить/ }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('downloads.install');
  const downloadInstallCall = await page.evaluate(() =>
    (window as typeof window & {
      __fluxoraCalls?: Array<{ method: string; payload?: { request?: { existingModMode?: number } } }>;
    }).__fluxoraCalls?.find((call) => call.method === 'downloads.install')
  );
  expect(downloadInstallCall?.payload?.request?.existingModMode).toBe(2);

  await rightPane.getByRole('button', { name: 'Archive' }).click();
  const fomodDialog = page.getByRole('dialog', { name: /Natural Vision Of Tamriel/ });
  await expect(fomodDialog.getByText('Natural Vision Of Tamriel').first()).toBeVisible();
  await expect(fomodDialog.getByRole('button', { name: /Preset/ })).toBeVisible();
  await expect(fomodDialog.getByText('Full install').first()).toBeVisible();
  await fomodDialog.getByRole('button', { name: 'Next' }).click();
  await expect(fomodDialog.getByRole('button', { name: /Patches/ })).toBeVisible();
  await fomodDialog.getByRole('button', { name: 'Review install' }).click();
  await expect(
    page
      .getByRole('dialog', { name: /Natural Vision Of Tamriel/ })
      .getByText('Natural Vision Of Tamriel', { exact: true })
      .first()
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: /Natural Vision Of Tamriel/ })
    .getByRole('button', { name: 'Установить', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('archives.installFomod');
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
  await expect(page.getByText('Checking - last linked as Cached Playwright user')).toBeVisible();
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
    .toContain('nexus.getAuthStatus');
});

test('uses the redesigned Settings window for Nexus, language and MO2 transfer actions', async ({ page }) => {
  await page.goto(`${baseUrl}/?window=settings`);

  await expect(page.locator('.settings-nav__header')).toHaveCount(0);
  await expect(page.locator('.titlebar__brand-name')).toHaveText('Settings');
  await expect(page.locator('.titlebar__mark--settings')).toBeVisible();
  await expect(page.getByRole('button', { name: /Connections/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^AI$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Languages/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Transfer/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Для разработчиков/ })).toBeVisible();
  await expect(page.locator('.settings-nav button').last()).toContainText('Для разработчиков');
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
    .toContain('nexus.connect');
  await expect(page.getByText('Linked - Playwright user')).toBeVisible();
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
    await rightPane.getByRole('button', { name: 'Archive' }).click();
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

  expect(focusIndicator.hasIndicator).toBe(true);
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

test('file preview window renders a nonblank nif canvas and source mod label', async ({ page }) => {
  const project = encodeURIComponent('D:\\Fluxora\\Configs\\skyrim-main.json');
  const mod = encodeURIComponent('D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Selected Model');
  const relativePath = encodeURIComponent('meshes/armor/cuirass.nif');

  await page.setViewportSize({ width: 1344, height: 912 });
  await page.goto(
    `${baseUrl}/?window=file-preview&project=${project}&mod=${mod}&path=${relativePath}&name=cuirass.nif&profile=Default&kind=nif`
  );

  await expect(page.getByRole('heading', { name: '.nif Preview' })).toBeVisible();
  await expect(page.getByTestId('file-preview-source-mod')).toContainText('Selected Model');
  await expect(page.getByText('meshes/armor/cuirass.nif')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous mod variant' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Next mod variant' })).toBeDisabled();
  await expect(page.getByTestId('file-preview-canvas')).toBeVisible();

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
});
