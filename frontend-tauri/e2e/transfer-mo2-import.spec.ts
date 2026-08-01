import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
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
    type FluxoraCall = { method: string; payload?: unknown };
    const gib = (value: number) => value * 1024 * 1024 * 1024;
    const calls: FluxoraCall[] = [];
    const mo2OpenCallbacks: Array<() => void> = [];
    const projects: any[] = [];
    const template = {
      id: 'skyrimse',
      displayName: 'Skyrim Special Edition',
      gameName: 'Skyrim Special Edition',
      summary: 'Bethesda RPG',
      uiTemplateId: 'skyrim'
    };
    const sourceDirectory = 'C:\\MO2\\Dragonborn Ascendant';
    const projectName = 'Dragonborn Ascendant';
    const gamePath = 'C:\\Games\\Skyrim Special Edition\\SkyrimSE.exe';
    const drives = [
      {
        id: 'c',
        rootPath: 'C:\\',
        label: 'Локальный диск (C:)',
        volumeName: 'Windows',
        fileSystem: 'NTFS',
        totalBytes: gib(1000),
        availableBytes: gib(128),
        driveKind: 'nvme',
        mediaLabel: 'NVMe M.2',
        busType: 'NVMe',
        friendlyName: 'System',
        isSystem: true
      },
      {
        id: 'e',
        rootPath: 'E:\\',
        label: 'Локальный диск (E:)',
        volumeName: 'Games',
        fileSystem: 'NTFS',
        totalBytes: gib(2000),
        availableBytes: gib(760),
        driveKind: 'ssd',
        mediaLabel: 'SSD',
        busType: 'SATA',
        friendlyName: 'Games',
        isSystem: false
      }
    ];
    const projectCatalog = () => ({
      buildConfigsDirectory: 'D:\\Fluxora\\Configs',
      defaultInstallRootDirectory: 'E:\\Fluxora',
      operationId: 'op_projects_list',
      projects
    });
    const currentScenario = () =>
      ((window as any).__fluxoraScenario as 'ready' | 'blocked' | undefined) ?? 'ready';
    const createAnalysis = (
      destinationRootDirectory: string,
      operation: { operationId?: string } | undefined
    ) => {
      const blocked = currentScenario() === 'blocked';
      const root = String(destinationRootDirectory).trim().replace(/[\\/]+$/, '');
      const totalBytes = blocked ? gib(900) : gib(104);
      const availableBytes = blocked ? gib(8) : gib(760);

      return {
        sourceDirectory,
        destinationRootDirectory,
        targetProjectDirectory: `${root}\\${projectName}`,
        targetConfigPath: `${root}\\${projectName}\\fluxora.json`,
        projectName,
        profileName: 'Default',
        templateId: 'skyrimse',
        gameName: 'Skyrim Special Edition',
        gamePath,
        totalBytes,
        availableBytes,
        modCount: 621,
        separatorCount: 24,
        hasEnoughSpace: !blocked,
        willOverwrite: false,
        canImport: !blocked,
        statusMessage: blocked ? 'Недостаточно места для переноса.' : 'Сборка готова к переносу.',
        warningMessage: blocked ? 'На выбранном диске недостаточно свободного места.' : '',
        operationId: operation?.operationId ?? 'op_transfer_analysis'
      };
    };

    (window as any).__fluxoraCalls = calls;
    (window as any).__fluxoraMo2OpenCallbackCount = 0;
    (window as any).__emitMo2Open = () => {
      for (const callback of mo2OpenCallbacks) {
        callback();
      }
    };
    (window as any).confirm = () => true;
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
      updates: {
        getStatus: async () => ({ state: 'upToDate', currentVersion: '0.0.0-test' }),
        rendererReady: async () => undefined,
        check: async () => ({ state: 'upToDate', currentVersion: '0.0.0-test' }),
        downloadAndInstall: async () => ({ state: 'upToDate', currentVersion: '0.0.0-test' }),
        cancel: async (operation: { operationId?: string } | undefined) => ({
          accepted: false,
          state: 'upToDate',
          operationId: operation?.operationId ?? 'op_update_cancel'
        }),
        onStatus: () => () => undefined
      },
      ai: {
        resetFileRollbackCheckpoints: async () => undefined,
        getFileRollbackStates: async () => [],
        getStatus: async (operation: { operationId?: string } | undefined) => ({
          ready: false,
          operationId: operation?.operationId ?? 'op_ai_status',
          health: 'unavailable',
          providers: [],
          models: [],
          capabilities: {},
          quota: {
            schema: 'fluxora.ai.quota.v1',
            availability: 'unavailable',
            available: false,
            eligibility: false,
            reason: 'test',
            periodStart: null,
            resetAt: null,
            rollover: false,
            limit: 0,
            used: 0,
            reserved: 0,
            remaining: 0,
            remainingInputTokenEquivalent: 0,
            search: { limit: 0, used: 0, reserved: 0, remaining: 0 },
            model: 'gemini-3.1-flash-lite',
            priceVersion: null
          }
        })
      },
      apiLimits: {
        list: async (operation: any) => {
          calls.push({ method: 'apiLimits.list', payload: { operation } });
          return {
            generatedAtUtc: '2026-07-07T10:00:00Z',
            operationId: operation?.operationId ?? 'op_api_limits',
            providers: []
          };
        }
      },
      archives: {
        install: async () => ({}),
        installFomod: async () => ({})
      },
      bridge: {
        getLanguage: async () => ({ language: 'en-us', operationId: 'op_language' }),
        getStatus: async () => ({
          capabilities: {
            arch: 'x64',
            core: { available: true, libraryName: 'FluxoraCore.dll' },
            features: {
              buildPaths: { state: 'available' },
              downloads: { state: 'available' },
              executableLaunch: { state: 'available' },
              executables: { state: 'available' },
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
          language: 'en-us',
          logs: { mainBridgeLogPath: '', uiLogPath: '' },
          operationId: 'op_status',
          ready: true,
          theme: 'dark'
        }),
        setLanguage: async () => ({ language: 'en-us', operationId: 'op_language' }),
        shutdown: async () => ({ accepted: true, operationId: 'op_shutdown' })
      },
      buildPaths: {
        get: async () => ({}),
        save: async () => ({ operationId: 'op_build_paths_save' })
      },
      buildSettings: {
        notifyPathsSaved: async () => undefined,
        onPathsSaved: () => () => undefined
      },
      buildContent: {
        onChanged: () => () => undefined,
        unwatch: async () => ({ accepted: true, operationId: 'op_build_content_unwatch' }),
        watch: async () => ({ accepted: true, operationId: 'op_build_content_watch' })
      },
      dialogs: {
        pickArchive: async () => ({ canceled: true }),
        pickBuildConfig: async () => ({ canceled: true }),
        pickExecutable: async () => ({ canceled: true }),
        pickFluxPack: async () => ({ canceled: true }),
        pickFolder: async (title: string, initialPath: string) => {
          calls.push({ method: 'dialogs.pickFolder', payload: { initialPath, title } });
          return { canceled: false, path: sourceDirectory };
        },
        saveFluxPack: async () => ({ canceled: true })
      },
      downloads: {
        analyzeContentLayout: async () => ({}),
        analyzeFomod: async () => ({ isFomod: false, steps: [] }),
        analyzeFomodContentLayout: async () => ({}),
        cancel: async () => ({}),
        delete: async () => ({}),
        importFile: async () => ({}),
        install: async () => ({}),
        installFomod: async () => ({}),
        list: async () => [],
        onChanged: () => () => undefined,
        onFolderChanged: () => () => undefined,
        resume: async () => ({}),
        unwatchFolder: async () => ({ accepted: true, operationId: 'op_unwatch' }),
        watchFolder: async () => ({ accepted: true, operationId: 'op_watch' })
      },
      installs: {
        submit: async () => ({}),
        cancel: async () => ({}),
        restore: async () => [],
        list: async () => [],
        get: async () => ({}),
        onProgress: () => () => undefined
      },
      executables: {
        getIcon: async () => ({ iconPath: '', operationId: 'op_icon' }),
        launch: async () => ({ displayName: 'SKSE', operationId: 'op_launch' }),
        list: async () => [],
        save: async () => []
      },
      fileDrop: {
        onDragDrop: async () => () => undefined
      },
      fluxPack: {
        export: async () => {
          calls.push({ method: 'fluxPack.export' });
          return {};
        },
        inspect: async () => ({}),
        install: async () => ({ operationId: 'op_fluxpack_install', summary: {} })
      },
      links: {
        openExternal: async (url: string) => {
          calls.push({ method: 'links.openExternal', payload: { url } });
          return { ok: true };
        }
      },
      mods: {
        checkUpdates: async () => [],
        clearOverwrite: async () => ({}),
        createEmpty: async () => ({}),
        createSeparator: async () => [],
        deleteInstalled: async () => ({}),
        deleteSeparator: async () => [],
        getFileTree: async () => [],
        getModDetailsContent: async (_projectDirectory: string, modPath: string) => ({
          modPath,
          directories: [{ relativePath: '', entries: [] }],
          conflictTree: {
            modPath,
            totalOverwrites: 0,
            totalOverwritten: 0,
            limit: 0,
            nextCursor: null,
            overwrites: [],
            overwritten: []
          }
        }),
        getOrder: async () => [],
        getWorkspace: async () => ({ installedMods: [], modOrder: [] }),
        invalidateFileCaches: async (_projectDirectory: string, changedPaths: string[]) => ({
          invalidated: changedPaths.length > 0,
          changedPathCount: changedPaths.length
        }),
        listInstalled: async () => [],
        listPreviewVariants: async () => [],
        moveOrderItem: async () => [],
        readPreviewAsset: async () => ({}),
        setAllEnabled: async () => ({}),
        setEnabled: async () => ({})
      },
      nexus: {
        connect: async () => ({ isConfigured: true, isLinked: true, hasApiKey: true, message: 'Linked' }),
        connectWithApiKey: async () => ({ isConfigured: true, isLinked: true, hasApiKey: true, message: 'Linked' }),
        disconnect: async () => ({ isConfigured: true, isLinked: false, hasApiKey: false, message: 'Not linked' }),
        getAuthStatus: async () => ({ isConfigured: true, isLinked: false, hasApiKey: false, message: 'Not linked' })
      },
      nxm: {
        captureLinks: async () => [],
        importInboundDownloads: async () => [],
        onInboundLinksCaptured: () => () => undefined,
        registerProtocol: async () => ({ operationId: 'op_nxm', registered: true })
      },
      operations: {
        cancel: async (operationId: string, request: { operationId?: string }) => {
          calls.push({ method: 'operations.cancel', payload: { operationId, request } });
          return { accepted: true, operationId: request?.operationId ?? 'op_cancel', status: 'accepted' };
        },
        onProgress: () => () => undefined
      },
      plugins: {
        createSeparator: async () => [],
        deleteSeparator: async () => [],
        list: async () => [],
        move: async () => [],
        setAllEnabled: async () => [],
        setEnabled: async () => []
      },
      profiles: {
        clone: async () => [],
        create: async () => [],
        delete: async () => [],
        list: async () => ['Default'],
        rename: async () => []
      },
      projects: {
        create: async () => ({}),
        delete: async () => ({ operationId: 'op_delete' }),
        list: async (request: { operationId?: string } | undefined) => {
          calls.push({ method: 'projects.list', payload: { request } });
          return projectCatalog();
        },
        openConfig: async (configPath: string) =>
          projects.find((project) => project.configPath === configPath) ?? projects[0],
        previewDirectory: async () => ({ operationId: 'op_preview', projectDirectory: '' }),
        rename: async () => projects[0]
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
        getLanguage: async () => ({ language: 'en-us', operationId: 'op_language' }),
        getTheme: async () => ({ operationId: 'op_theme', theme: 'dark' }),
        setLanguage: async () => ({ language: 'en-us', operationId: 'op_language' }),
        setTheme: async () => ({ operationId: 'op_theme', theme: 'dark' })
      },
      shell: {
        openPath: async (targetPath: string) => ({ message: targetPath, ok: true }),
        showItemInFolder: async (targetPath: string) => ({ message: targetPath, ok: true })
      },
      templates: {
        list: async (request: { operationId?: string } | undefined) => {
          calls.push({ method: 'templates.list', payload: { request } });
          return [template];
        },
        resolve: async () => template
      },
      transfer: {
        analyzeMo2: async (
          receivedSourceDirectory: string,
          destinationRootDirectory: string,
          existingConfigPath: string | undefined,
          operation: { operationId?: string } | undefined
        ) => {
          calls.push({
            method: 'transfer.analyzeMo2',
            payload: {
              destinationRootDirectory,
              existingConfigPath,
              operation,
              sourceDirectory: receivedSourceDirectory
            }
          });
          return createAnalysis(destinationRootDirectory, operation);
        },
        importMo2: async (request: any, operation: { operationId?: string } | undefined) => {
          calls.push({ method: 'transfer.importMo2', payload: { operation, request } });
          const imported = {
            id: 'mo2-dragonborn-ascendant',
            name: projectName,
            templateId: 'skyrimse',
            uiTemplateId: 'skyrim',
            gameName: 'Skyrim Special Edition',
            gamePath,
            installRootDirectory: request.destinationRootDirectory,
            projectDirectory: `${request.destinationRootDirectory}\\${projectName}`,
            configPath: `${request.destinationRootDirectory}\\${projectName}\\fluxora.json`,
            projectFingerprint: {
              lastLaunchedAt: '',
              modCount: 621,
              pluginCount: 179,
              sizeBytes: gib(104)
            }
          };
          projects.unshift(imported);
          return imported;
        },
        listDestinationDrives: async (request: { operationId?: string } | undefined) => {
          calls.push({ method: 'transfer.listDestinationDrives', payload: { request } });
          return drives;
        },
        onMo2Handoff: () => () => undefined,
        onMo2Open: (callback: () => void) => {
          mo2OpenCallbacks.push(callback);
          (window as any).__fluxoraMo2OpenCallbackCount = mo2OpenCallbacks.length;
          return () => {
            const index = mo2OpenCallbacks.indexOf(callback);
            if (index >= 0) {
              mo2OpenCallbacks.splice(index, 1);
            }
            (window as any).__fluxoraMo2OpenCallbackCount = mo2OpenCallbacks.length;
          };
        },
        openMo2InMain: async () => undefined,
        startMo2InMain: async (handoff: unknown) => {
          calls.push({ method: 'transfer.startMo2InMain', payload: { handoff } });
          return undefined;
        }
      },
      ui: {
        log: async () => undefined
      },
      windowControls: {
        close: async () => undefined,
        minimize: async () => undefined,
        openBuildSettings: async () => undefined,
        openFilePreview: async () => undefined,
        openModDetails: async () => undefined,
        openSettings: async () => undefined,
        openTextEditor: async () => undefined,
        setTaskbarProgress: async () => undefined,
        toggleMaximize: async () => undefined
      }
    };
  });
});

const emitMo2Open = async (page: Page, scenario: 'ready' | 'blocked' = 'ready') => {
  await page.goto(baseUrl);
  await expect(page.getByLabel('Fluxora window chrome')).toBeVisible();
  await page.waitForFunction(() => (window as any).__fluxoraMo2OpenCallbackCount > 0);
  await page.evaluate((nextScenario) => {
    (window as any).__fluxoraScenario = nextScenario;
    (window as any).__emitMo2Open();
  }, scenario);
  await expect(page.getByRole('heading', { name: 'Папка сборки' })).toBeVisible();
};

const transferCalls = async (page: Page) =>
  page.evaluate(() => ((window as any).__fluxoraCalls ?? []) as Array<{ method: string; payload?: any }>);

const latestTransferCall = async (page: Page, method: string) =>
  (await transferCalls(page)).filter((call) => call.method === method).at(-1);

test('imports a Mod Organizer 2 build through the transfer wizard', async ({ page }) => {
  await emitMo2Open(page);

  await page.getByRole('button', { name: 'Выбрать папку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Диск установки' })).toBeVisible();
  await expect(page.getByText('E:\\Fluxora Builds\\Dragonborn Ascendant')).toBeVisible();
  await expect(page.getByRole('button', { name: /Локальный диск \(E:\)/ })).toBeVisible();

  await page.getByRole('button', { name: /Локальный диск \(E:\)/ }).click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Проверка' })).toBeVisible();
  await expect(page.getByText('Skyrim Special Edition')).toBeVisible();
  await expect(page.getByText('E:\\Fluxora Builds\\Dragonborn Ascendant')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Перенести', exact: true })).toBeEnabled();

  const analyzeCall = await latestTransferCall(page, 'transfer.analyzeMo2');
  expect(analyzeCall?.payload).toMatchObject({
    destinationRootDirectory: 'E:\\',
    existingConfigPath: undefined,
    sourceDirectory: 'C:\\MO2\\Dragonborn Ascendant'
  });
  expect(analyzeCall?.payload.operation.operationId).toMatch(/^op_\d+_transfer_analyze_mo2_/);

  await page.getByRole('button', { name: 'Перенести', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Select Dragonborn Ascendant' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Dragonborn Ascendant summary' })).toBeVisible();
  await expect(page.getByText('Fluxora Builds\\Dragonborn Ascendant')).toBeVisible();

  const importCall = await latestTransferCall(page, 'transfer.importMo2');
  expect(importCall?.payload.request).toEqual({
    destinationRootDirectory: 'E:\\Fluxora Builds',
    replaceExisting: false,
    sourceDirectory: 'C:\\MO2\\Dragonborn Ascendant'
  });
  expect(importCall?.payload.operation.operationId).toMatch(/^op_\d+_transfer_import_mo2_/);

  const methods = (await transferCalls(page)).map((call) => call.method);
  expect(methods).toEqual(
    expect.arrayContaining([
      'dialogs.pickFolder',
      'transfer.listDestinationDrives',
      'transfer.analyzeMo2',
      'transfer.importMo2',
      'projects.list'
    ])
  );
  expect(methods).not.toContain('fluxPack.export');
});

test('keeps a blocked MO2 analysis on review without importing', async ({ page }) => {
  await emitMo2Open(page, 'blocked');

  await page.getByRole('button', { name: 'Выбрать папку', exact: true }).click();
  await page.getByRole('button', { name: /Локальный диск \(E:\)/ }).click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Проверка' })).toBeVisible();
  await expect(page.getByText('Недостаточно места для переноса.')).toBeVisible();
  await expect(page.getByText('На выбранном диске недостаточно свободного места.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Перенести', exact: true })).toHaveCount(0);

  const methods = (await transferCalls(page)).map((call) => call.method);
  expect(methods).toContain('transfer.analyzeMo2');
  expect(methods).not.toContain('transfer.importMo2');
  expect(methods).not.toContain('fluxPack.export');
});
