import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';

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
        isPatch: true
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
        isEnabled: false,
        canCheckUpdates: true,
        hasUpdate: true,
        sourceIsNexus: true,
        sourceIsModdingFlow: false,
        isLocal: false,
        isTranslation: false,
        isPatch: false
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
        isEnabled: true,
        isMaster: true,
        isLight: false,
        isLocked: true,
        lockReason: 'Base game plugin',
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
        isEnabled: true,
        isMaster: false,
        isLight: false,
        isLocked: false,
        lockReason: '',
        missingMasters: []
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
      isConfigured: true,
      isLinked: nexusLinked,
      message: nexusLinked ? 'Linked' : 'Not linked',
      operationId: 'op_nexus',
      redirectUri: 'http://127.0.0.1/callback',
      userId: nexusLinked ? 'playwright' : ''
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
      dialogs: {
        pickArchive: async () => ({
          canceled: false,
          path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\downloads\\NaturalVisionFomod.7z'
        }),
        pickBuildConfig: async () => ({ canceled: true }),
        pickExecutable: async () => ({ canceled: true }),
        pickFluxPack: async () => ({ canceled: true }),
        pickFolder: async () => ({ canceled: true }),
        saveFluxPack: async () => ({ canceled: false, path: 'D:\\Fluxora\\Exports\\skyrim.fluxpack' })
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
        delete: async () => ({}),
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
        list: async () => downloadRows,
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
        openExternal: async () => ({ ok: true })
      },
      mods: {
        checkUpdates: async (projectDirectory: any, operation: any) => {
          calls.push({ method: 'mods.checkUpdates', payload: { operation, projectDirectory } });
          return modRows.filter((item) => item.isMod);
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
        deleteInstalled: async () => ({}),
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
        disconnect: async (operation: any) => {
          calls.push({ method: 'nexus.disconnect', payload: { operation } });
          nexusLinked = false;
          return nexusStatus();
        },
        getAuthStatus: async (operation: any) => {
          calls.push({ method: 'nexus.getAuthStatus', payload: { operation } });
          return nexusStatus();
        }
      },
      nxm: {
        captureLinks: async () => [],
        importInboundDownloads: async (projectDirectory: any, operation: any) => {
          calls.push({ method: 'nxm.importInboundDownloads', payload: { operation, projectDirectory } });
          return [];
        },
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
        delete: async () => ({ operationId: 'op_delete' }),
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
        openPath: async () => ({ ok: true }),
        showItemInFolder: async () => ({ ok: true })
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
        openSettings: async () => undefined,
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
  await page.getByPlaceholder('My Skyrim build').fill('Playwright build');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByPlaceholder('Path to game executable').fill('C:\\Games\\Skyrim\\SkyrimSE.exe');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByPlaceholder('Folder for Fluxora builds').fill('D:\\Fluxora\\Builds');
  await page.getByRole('button', { name: 'Create' }).click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('projects.create');
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

test('uses the redesigned mods pane for real mod list operations', async ({ page }) => {
  await page.goto(baseUrl);

  await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();

  await expect(page.getByRole('table', { name: 'Mod order' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Версия' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Latest' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Статус' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Core fixes separator/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Unofficial Patch mod/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Overwrites 4 files/ })).toBeVisible();

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
  await page.getByRole('menuitem', { name: 'Move down' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('mods.moveOrderItem');
});

test('uses the redesigned right pane tabs for plugins, data, downloads and build actions', async ({ page }) => {
  await page.goto(baseUrl);

  await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();

  const rightPane = page.getByLabel('Right pane');
  await expect(rightPane.getByRole('tab', { name: /Плагины/ })).toBeVisible();
  await expect(rightPane.getByRole('tab', { name: /Данные/ })).toBeVisible();
  await expect(rightPane.getByRole('tab', { name: /Загрузки/ })).toBeVisible();
  await expect(rightPane.getByRole('tab', { name: /Сборка/ })).toBeVisible();

  await expect(page.getByRole('table', { name: 'Plugin load order' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Skyrim.esm/ })).toBeVisible();
  await expect(rightPane.getByText('00')).toBeVisible();
  await expect(rightPane.locator('.plugin-type-badge', { hasText: 'master' }).first()).toBeVisible();

  const pluginRow = page.getByRole('row', { name: /SkyUI\.esp/ });
  await pluginRow.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Move up' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('plugins.move');

  await page.getByRole('row', { name: /Unofficial Patch mod/ }).click();
  await rightPane.getByRole('tab', { name: /Данные/ }).click();
  await expect(rightPane.getByText('Build folders')).toBeVisible();
  await expect(rightPane.getByText('Selected mod data')).toBeVisible();
  await expect(rightPane.getByText('scripts')).toBeVisible();

  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  await expect(page.getByRole('table', { name: 'Downloads' })).toBeVisible();
  await expect(rightPane.getByRole('row', { name: /SkyUI/ })).toBeVisible();
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

  await rightPane.getByRole('tab', { name: /Сборка/ }).click();
  await expect(rightPane.getByText('Build paths')).toBeVisible();
  await expect(rightPane.getByText('Executable config')).toBeVisible();
  await expect(rightPane.getByText('FluxPack', { exact: true })).toBeVisible();
  await rightPane.getByRole('button', { name: 'Package' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('fluxPack.export');
});

test('uses the redesigned install dialogs for downloads and FOMOD archives', async ({ page }) => {
  await page.goto(baseUrl);

  await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();

  const rightPane = page.getByLabel('Right pane');
  await rightPane.getByRole('tab', { name: /Загрузки/ }).click();

  const skyuiRow = rightPane.getByRole('row', { name: /SkyUI/ });
  await skyuiRow.dblclick();

  const simpleDialog = page.getByRole('dialog', { name: 'Install mod' });
  await expect(simpleDialog).toBeVisible();
  await expect(simpleDialog.getByText('Source')).toBeVisible();
  await expect(simpleDialog.getByText('Category')).toBeVisible();
  await expect(simpleDialog.getByText('Install path')).toBeVisible();
  await simpleDialog.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByRole('tree', { name: 'Archive placement tree' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply' }).click();
  await simpleDialog.getByRole('button', { name: 'Install', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('downloads.install');

  await rightPane.getByRole('button', { name: 'Archive' }).click();
  const fomodDialog = page.getByRole('dialog', { name: 'Install mod' });
  await expect(fomodDialog.getByText('FOMOD installer')).toBeVisible();
  await expect(fomodDialog.getByRole('button', { name: /Preset/ })).toBeVisible();
  await expect(fomodDialog.getByText('Full install').first()).toBeVisible();
  await fomodDialog.getByRole('button', { name: 'Next' }).click();
  await expect(fomodDialog.getByRole('button', { name: /Patches/ })).toBeVisible();
  await fomodDialog.getByRole('button', { name: 'Review install' }).click();
  await expect(page.getByRole('heading', { name: 'Natural Vision Of Tamriel' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Install mod' }).getByRole('button', { name: 'Install', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('archives.installFomod');
});

test('uses the redesigned Settings window for Nexus, language and MO2 transfer actions', async ({ page }) => {
  await page.goto(`${baseUrl}/?window=settings`);

  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Connections/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Languages/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Transfer/ })).toBeVisible();
  await expect(page.getByText('Account bridge')).toBeVisible();
  await expect(page.getByText('Nexus Mods', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Link Nexus Mods with OAuth' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('nexus.connect');
  await expect(page.getByText('Linked - Playwright user')).toBeVisible();

  await page.getByRole('button', { name: /Languages/ }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('ru-ru');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
          ?.map((call) => call.method)
      )
    )
    .toContain('settings.setLanguage');
  await expect(page.getByText('settings.json - language=ru')).toBeVisible();

  await page.getByRole('button', { name: /Transfer/ }).click();
  await expect(page.getByText('Build transfer', { exact: true })).toBeVisible();
  await expect(page.getByText('The native core verifies the MO2 structure before import starts.')).toBeVisible();
  await page.getByRole('button', { name: 'Start transfer' }).click();
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
    const simpleDialog = page.getByRole('dialog', { name: 'Install mod' });
    await expect(simpleDialog).toBeVisible();
    await expect(simpleDialog.getByText('Install path')).toBeVisible();
    await capturePhase13Screenshot(page, testInfo, 'install-dialog', size);

    await simpleDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await rightPane.getByRole('button', { name: 'Archive' }).click();
    const fomodDialog = page.getByRole('dialog', { name: 'Install mod' });
    await expect(fomodDialog.getByText('FOMOD installer')).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
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
