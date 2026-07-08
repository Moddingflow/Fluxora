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
        name: 'Aetherius - A Race Overhaul-26686-2-14-1-1719514447',
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

    (window as any).__fluxoraCalls = calls;
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
          return { name: request.modName, operationId: operation?.operationId ?? 'op_archive_install' };
        },
        installFomod: async (request: any, operation: any) => {
          calls.push({ method: 'archives.installFomod', payload: { operation, request } });
          return { name: request.modName, operationId: operation?.operationId ?? 'op_archive_fomod' };
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
        onChanged: () => () => undefined,
        unwatch: async (operation: any) => ({
          accepted: true,
          operationId: operation?.operationId ?? 'op_build_content_unwatch'
        }),
        watch: async (_watchRequest: any, operation: any) => ({
          accepted: true,
          operationId: operation?.operationId ?? 'op_build_content_watch'
        })
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
          return { name: request.modName, operationId: operation?.operationId ?? 'op_download_install' };
        },
        installFomod: async (request: any, operation: any) => {
          calls.push({ method: 'downloads.installFomod', payload: { operation, request } });
          return { name: request.modName, operationId: operation?.operationId ?? 'op_download_fomod' };
        },
        list: async () => {
          await waitForDownloadsList();
          return downloadRows;
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
          return { displayName: 'SKSE', operationId: 'op_launch' };
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
          return {
            buildName: 'Skyrim graphics overhaul',
            customConfigCount: 1,
            customPatchCount: 0,
            formatVersion: 1,
            generatedAssetCount: 2,
            generatedAssetsIncluded: true,
            installPlanAvailable: true,
            installStepCount: 3,
            manifestBytes: 2048,
            operationId: operation?.operationId ?? 'op_fluxpack_export',
            outputPath: request.outputPath,
            sourceArchiveCount: 4
          };
        },
        inspect: async () => ({}),
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
        deleteSeparator: async () => [],
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
        getOrder: async () => modRows,
        listInstalled: async () => modRows.filter((item) => item.isMod),
        moveOrderItem: async (projectDirectory: any, profileName: any, orderId: any, targetIndex: any, operation: any) => {
          calls.push({
            method: 'mods.moveOrderItem',
            payload: { operation, orderId, profileName, projectDirectory, targetIndex }
          });
          return modRows;
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
        onProgress: () => () => undefined
      },
      plugins: {
        createSeparator: async () => pluginRows,
        deleteSeparator: async () => pluginRows,
        list: async () => pluginRows,
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

const openSkyrimBuild = async (page: Page) => {
  await page.goto(baseUrl);
  await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
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
  const buildOption = page.getByRole('option', { name: /Skyrim graphics overhaul/ });
  await buildOption.hover();
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

  await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();

  await page.getByRole('button', { name: 'Open', exact: true }).click();
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
});

test('runs build header package, check and launch actions through the facade', async ({ page }) => {
  await page.goto(baseUrl);

  await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();

  const buildHeader = page.getByLabel('Build header');
  await expect(buildHeader).toBeVisible();
  await expect(buildHeader.getByRole('button', { name: 'Package' })).toBeEnabled();
  await expect(buildHeader.getByRole('button', { name: 'Check' })).toBeEnabled();
  await expect(buildHeader.getByRole('button', { name: 'Launch' })).toBeEnabled();

  await buildHeader.getByRole('button', { name: 'Check' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('mods.checkUpdates');

  await buildHeader.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByText('Launching SKSE')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('executables.launch');
  await expect(page.getByText('Launching SKSE')).toBeHidden();

  await buildHeader.getByRole('button', { name: 'Package' }).click();
  await expect(page.getByRole('status', { name: 'Packaging FluxPack' })).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Packaging FluxPack progress' })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('fluxPack.export');
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

  await expect(page.getByRole('status', { name: 'Packaging FluxPack' })).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Packaging FluxPack progress' })
  ).toBeVisible();
  await expect.poll(() => callMethods(page)).toContain('dialogs.saveFluxPack');
  await expect.poll(() => callMethods(page)).toContain('fluxPack.export');

  const exportPayload = (await latestCallPayload(page, 'fluxPack.export')) as {
    request?: { configPath?: string; outputPath?: string };
  } | null;
  expect(exportPayload?.request?.outputPath).toBe('D:\\Fluxora\\Exports\\skyrim.fluxpack');
  expect(exportPayload?.request?.configPath).toBe('D:\\Fluxora\\Configs\\skyrim-main.json');

  await menu.waitFor({ state: 'detached' });
});

test('installs a packaged FluxPack from the mods search-row three-dot menu', async ({ page }) => {
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
    facade.fluxPack.install = async (request: any, operation: any) => {
      calls.push({ method: 'fluxPack.install', payload: { operation, request } });
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 120)));
      return {
        appliedConfigCount: 1,
        appliedProfileOrderItemCount: 12,
        buildName: 'Skyrim graphics overhaul',
        configPath: 'D:\\Fluxora\\Configs\\skyrim-main.json',
        failedSourceCount: 0,
        hasWarnings: false,
        installedSourceCount: 4,
        operationId: operation?.operationId ?? 'op_fluxpack_install',
        pendingSourceCount: 0,
        projectDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul',
        summary: {
          buildName: 'Skyrim graphics overhaul',
          customConfigCount: 1,
          customPatchCount: 0,
          formatVersion: 1,
          generatedAssetCount: 2,
          generatedAssetsIncluded: true,
          installPlanAvailable: true,
          installStepCount: 3,
          manifestBytes: 2048,
          outputPath: 'D:\\Fluxora\\Exports\\skyrim.fluxpack',
          sourceArchiveCount: 4
        },
        totalSourceCount: 4
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

  await expect(page.getByRole('status', { name: 'Installing FluxPack' })).toBeVisible();
  await expect.poll(() => callMethods(page)).toContain('dialogs.pickFluxPack');
  await expect.poll(() => callMethods(page)).toContain('dialogs.pickFolder');
  await expect.poll(() => callMethods(page)).toContain('fluxPack.install');

  const installPayload = (await latestCallPayload(page, 'fluxPack.install')) as {
    request?: { fluxPackPath?: string; installRootDirectory?: string };
  } | null;
  expect(installPayload?.request?.fluxPackPath).toBe('D:\\Fluxora\\Exports\\skyrim.fluxpack');
  expect(installPayload?.request?.installRootDirectory).toBe('D:\\Fluxora\\Builds');

  await expect.poll(() => callMethods(page)).toContain('projects.openConfig');
  await menu.waitFor({ state: 'detached' });
});

test('uses the redesigned mods pane for real mod list operations', async ({ page }) => {
  await page.goto(baseUrl);

  await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();

  const modOrderTable = page.getByRole('table', { name: 'Mod order' });
  await expect(modOrderTable).toBeVisible();
  await expect(modOrderTable.getByRole('columnheader', { name: 'Название' })).toBeVisible();
  await expect(modOrderTable.getByRole('columnheader', { name: 'Версия' })).toBeVisible();
  await expect(modOrderTable.getByRole('columnheader', { name: 'Latest' })).toBeVisible();
  await expect(modOrderTable.getByRole('columnheader', { name: 'Статус' })).toBeVisible();
  const separatorRow = page.getByRole('row', { name: /Core fixes separator/ });
  await expect(separatorRow).toBeVisible();
  await expect(separatorRow).toHaveAttribute('data-conflict-highlight', 'none');
  await expect(separatorRow).toHaveAttribute('data-conflict-status', '');
  await expect(separatorRow.locator('.mod-separator-status .flx-status-dot')).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse Core fixes' }).click();
  await expect(separatorRow).toHaveAttribute('data-collapsed', 'true');
  await expect(separatorRow).toHaveAttribute('data-conflict-highlight', 'mixed');
  await expect(separatorRow).toHaveAttribute('data-conflict-status', 'overwrites overwritten');
  await expect(separatorRow.locator('.mod-separator-cell .flx-status-dot')).toHaveCount(0);
  await expect(separatorRow.locator('.mod-separator-status .flx-status-dot')).toHaveCount(2);
  await expect
    .poll(() => separatorRow.evaluate((row) => window.getComputedStyle(row, '::before').content))
    .toBe('none');
  await expect(separatorRow.getByRole('img', { name: 'Перезаписывает', exact: true })).toBeVisible();
  await expect(separatorRow.getByRole('img', { name: 'Перезаписывается', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Core fixes' }).click();
  await expect(separatorRow).toHaveAttribute('data-conflict-highlight', 'none');
  await expect(separatorRow).toHaveAttribute('data-conflict-status', '');
  await expect(separatorRow.locator('.mod-separator-status .flx-status-dot')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Unofficial Patch mod/ })).toBeVisible();
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
  await page.keyboard.press('Escape');

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

test('keeps downloads rows visible during delayed refresh', async ({ page }) => {
  await page.goto(baseUrl);

  await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();

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

  await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();

  const rightPane = page.getByLabel('Right pane');
  await expect(rightPane.getByRole('tab', { name: /Плагины/ })).toBeVisible();
  await expect(rightPane.getByRole('tab', { name: /Данные/ })).toBeVisible();
  await expect(rightPane.getByRole('tab', { name: /Загрузки/ })).toBeVisible();
  await expect(rightPane.getByRole('tab', { name: /Сборка/ })).toHaveCount(0);

  const pluginsTable = page.getByRole('table', { name: 'Plugin load order' });
  await expect(pluginsTable).toBeVisible();
  await expect(pluginsTable.getByRole('columnheader', { name: 'State' })).toHaveCount(0);
  await expect(pluginsTable.getByRole('columnheader', { name: 'Статус' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Skyrim.esm/ })).toBeVisible();
  await expect(rightPane.getByText('00')).toBeVisible();
  await expect(rightPane.locator('.plugin-type-badge', { hasText: 'master' }).first()).toBeVisible();

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
  await expect(page.getByRole('tooltip')).toContainText('Aardvark.esm');
  await page.getByRole('button', { name: 'Expand Late patches' }).click();
  await expect(pluginSeparatorRow).toHaveAttribute('data-missing-masters', 'false');

  const pluginRow = page.getByRole('row', { name: /SkyUI\.esp/ });
  const warning = pluginRow.getByRole('button', { name: /Отсутствуют мастер-файлы/ });
  await expect(warning).toBeVisible();
  await warning.hover();
  const tooltip = page.getByRole('tooltip');
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

  await page.getByRole('row', { name: /Unofficial Patch mod/ }).click();
  await rightPane.getByRole('tab', { name: /Данные/ }).click();
  await expect(rightPane.getByText('Build folders')).toBeVisible();
  await expect(rightPane.getByText('Selected mod data')).toBeVisible();
  await expect(rightPane.getByText('scripts')).toBeVisible();

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

  await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();

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
    await page.getByLabel('Build header').getByRole('button', { name: 'Package' }).click();
    await expect(page.getByRole('status', { name: 'Packaging FluxPack' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Packaging FluxPack progress' })).toBeVisible();
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
    await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();

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
