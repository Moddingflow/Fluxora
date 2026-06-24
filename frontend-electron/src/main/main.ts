import { app, BrowserWindow, dialog, ipcMain, shell, session } from 'electron';
import type { IpcMainInvokeEvent, OpenDialogOptions, SaveDialogOptions } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { NativeBridgeService } from './bridge/native-bridge-service';
import { createOperationId } from './bridge/native-bridge-service';
import { ElectronLogService } from './logging';
import {
  listTransferDestinationDrives,
  prewarmTransferDestinationDrives
} from './transfer-drive-service';
import {
  FluxoraIpcChannels,
  type FluxoraAppInfo,
  type DialogPickResult,
  type FluxoraLogLevel,
  type FluxoraMo2TransferHandoff,
  type FluxoraOperationProgress,
  type FluxoraSecurityState,
  type OpenExternalResult,
  type ShellOpenPathResult,
  type ShellShowItemInFolderResult
} from '../shared/fluxora-api';

const isDev = !app.isPackaged;
const allowedExternalProtocols = new Set(['https:', 'mailto:']);
let electronLogs: ElectronLogService | null = null;
let nativeBridge: NativeBridgeService | null = null;
let mainAppWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

const createContentSecurityPolicy = (): string => {
  const connectSrc = isDev
    ? "connect-src 'self' ws://localhost:* http://localhost:*"
    : "connect-src 'self'";

  return [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    isDev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    connectSrc,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
};

const getRendererEntryFile = (): string =>
  path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);

const getRendererEntryUrl = (): string => pathToFileURL(getRendererEntryFile()).toString();

const getPreloadScriptPath = (): string => path.join(__dirname, 'index.js');

const isAllowedRendererNavigation = (targetUrl: string): boolean => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return new URL(targetUrl).origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
  }

  return targetUrl.startsWith(getRendererEntryUrl());
};

const canOpenExternalUrl = (rawUrl: string): boolean => {
  try {
    const parsed = new URL(rawUrl);
    return allowedExternalProtocols.has(parsed.protocol);
  } catch {
    return false;
  }
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const requiredTransferPath = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 4096 ? trimmed : null;
};

const normalizeMo2TransferHandoff = (raw: unknown): FluxoraMo2TransferHandoff | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as {
    request?: unknown;
    analysis?: unknown;
  };
  if (!candidate.request || typeof candidate.request !== 'object') {
    return null;
  }

  const request = candidate.request as {
    sourceDirectory?: unknown;
    destinationRootDirectory?: unknown;
    existingConfigPath?: unknown;
    replaceExisting?: unknown;
  };
  const sourceDirectory = requiredTransferPath(request.sourceDirectory);
  const destinationRootDirectory = requiredTransferPath(request.destinationRootDirectory);
  if (!sourceDirectory || !destinationRootDirectory || typeof request.replaceExisting !== 'boolean') {
    return null;
  }

  return {
    request: {
      sourceDirectory,
      destinationRootDirectory,
      existingConfigPath: optionalString(request.existingConfigPath),
      replaceExisting: request.replaceExisting
    },
    analysis:
      candidate.analysis && typeof candidate.analysis === 'object'
        ? (candidate.analysis as FluxoraMo2TransferHandoff['analysis'])
        : undefined
  };
};

const isNxmLink = (value: string): boolean => value.toLocaleLowerCase().startsWith('nxm://');

const extractNxmLinks = (args: readonly string[]): string[] =>
  args
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0 && isNxmLink(arg));

const openExternalUrl = async (rawUrl: string): Promise<OpenExternalResult> => {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) {
    return { ok: false, reason: 'invalid-url' };
  }

  if (!canOpenExternalUrl(rawUrl)) {
    return { ok: false, reason: 'unsupported-protocol' };
  }

  try {
    await shell.openExternal(rawUrl);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'open-failed' };
  }
};

const openShellPath = async (rawPath: unknown): Promise<ShellOpenPathResult> => {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0 || rawPath.length > 4096) {
    return { ok: false, reason: 'invalid-path' };
  }

  try {
    const message = await shell.openPath(rawPath);
    if (message) {
      return { ok: false, reason: 'open-failed', message };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'open-failed',
      message: error instanceof Error ? error.message : 'Failed to open path.'
    };
  }
};

const showShellItemInFolder = async (rawPath: unknown): Promise<ShellShowItemInFolderResult> => {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0 || rawPath.length > 4096) {
    return { ok: false, reason: 'invalid-path' };
  }

  try {
    shell.showItemInFolder(rawPath);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'show-failed',
      message: error instanceof Error ? error.message : 'Failed to show item in folder.'
    };
  }
};

const captureNxmLinksFromArgs = async (args: readonly string[]): Promise<void> => {
  const links = extractNxmLinks(args);
  if (links.length === 0 || !nativeBridge) {
    return;
  }

  const operationId = createOperationId('nxm_external_activation');
  try {
    await electronLogs?.write(
      'main-bridge',
      'info',
      'NXM',
      `capturing ${links.length} inbound link(s)`,
      operationId
    );
    await nativeBridge.captureNxmLinks('', links, { operationId });
  } catch (error) {
    await electronLogs?.write(
      'main-bridge',
      'error',
      'NXM',
      error instanceof Error ? error.message : 'Failed to capture inbound NXM links.',
      operationId
    );
  }
};

const pickSinglePath = async (
  options: OpenDialogOptions
): Promise<DialogPickResult> => {
  const result = await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return {
    canceled: false,
    path: result.filePaths[0]
  };
};

const saveSinglePath = async (
  options: SaveDialogOptions
): Promise<DialogPickResult> => {
  const result = await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  return {
    canceled: false,
    path: result.filePath
  };
};

const controlWindow = (
  event: IpcMainInvokeEvent,
  action: (window: BrowserWindow) => void
): void => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return;
  }

  action(window);
};

const getAppIconPath = (): string =>
  path.join(app.getAppPath(), '..', 'Icons', process.platform === 'win32' ? 'Fluxora.ico' : 'Fluxora.png');

const securityState = (): FluxoraSecurityState => ({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  remoteModule: false,
  allowedIpcChannels: Object.values(FluxoraIpcChannels),
  csp: createContentSecurityPolicy()
});

const configureRendererWindow = (browserWindow: BrowserWindow): void => {
  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url);
    return { action: 'deny' };
  });

  browserWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (isAllowedRendererNavigation(targetUrl)) {
      return;
    }

    event.preventDefault();
    void openExternalUrl(targetUrl);
  });
};

const loadRendererWindow = async (
  browserWindow: BrowserWindow,
  query?: Record<string, string>
): Promise<void> => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const rendererUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    Object.entries(query ?? {}).forEach(([key, value]) => {
      rendererUrl.searchParams.set(key, value);
    });
    await browserWindow.loadURL(rendererUrl.toString());
    return;
  }

  await browserWindow.loadFile(getRendererEntryFile(), query ? { query } : undefined);
};

const broadcastOperationProgress = (progress: FluxoraOperationProgress): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(FluxoraIpcChannels.operationsProgress, progress);
    }
  }
};

const isFluxoraLogLevel = (value: unknown): value is FluxoraLogLevel =>
  value === 'debug' || value === 'info' || value === 'warning' || value === 'error';

const registerSecurityHandlers = (
  bridge: NativeBridgeService,
  logs: ElectronLogService
): void => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [createContentSecurityPolicy()]
      }
    });
  });

  ipcMain.handle(FluxoraIpcChannels.appGetInfo, (): FluxoraAppInfo => ({
    appName: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged
  }));

  ipcMain.handle(FluxoraIpcChannels.securityGetState, (): FluxoraSecurityState =>
    securityState()
  );

  ipcMain.handle(
    FluxoraIpcChannels.linksOpenExternal,
    async (_event, rawUrl: unknown): Promise<OpenExternalResult> => {
      if (typeof rawUrl !== 'string') {
        return { ok: false, reason: 'invalid-url' };
      }

      return openExternalUrl(rawUrl);
    }
  );

  ipcMain.handle(FluxoraIpcChannels.shellOpenPath, async (_event, rawPath: unknown) =>
    openShellPath(rawPath)
  );

  ipcMain.handle(FluxoraIpcChannels.shellShowItemInFolder, async (_event, rawPath: unknown) =>
    showShellItemInFolder(rawPath)
  );

  ipcMain.handle(
    FluxoraIpcChannels.dialogPickArchive,
    async (_event, initialDirectory: unknown): Promise<DialogPickResult> =>
      pickSinglePath({
        title: 'Import mod archive',
        defaultPath: optionalString(initialDirectory),
        properties: ['openFile'],
        filters: [
          { name: 'Mod archives', extensions: ['zip', '7z', 'rar', 'fomod', 'omod', 'ba2', 'bsa'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
  );

  ipcMain.handle(
    FluxoraIpcChannels.dialogPickBuildConfig,
    async (_event, initialDirectory: unknown): Promise<DialogPickResult> =>
      pickSinglePath({
        title: 'Open Fluxora build config',
        defaultPath: optionalString(initialDirectory),
        properties: ['openFile'],
        filters: [{ name: 'Fluxora build config', extensions: ['json'] }]
      })
  );

  ipcMain.handle(
    FluxoraIpcChannels.dialogPickExecutable,
    async (_event, title: unknown, initialPath: unknown): Promise<DialogPickResult> =>
      pickSinglePath({
        title: optionalString(title) ?? 'Select executable',
        defaultPath: optionalString(initialPath),
        properties: ['openFile'],
        filters:
          process.platform === 'win32'
            ? [{ name: 'Executable', extensions: ['exe'] }]
            : undefined
      })
  );

  ipcMain.handle(
    FluxoraIpcChannels.dialogPickFluxPack,
    async (_event, initialDirectory: unknown): Promise<DialogPickResult> =>
      pickSinglePath({
        title: 'Open FluxPack',
        defaultPath: optionalString(initialDirectory),
        properties: ['openFile'],
        filters: [
          { name: 'FluxPack packages', extensions: ['fluxpack'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
  );

  ipcMain.handle(
    FluxoraIpcChannels.dialogPickFolder,
    async (_event, title: unknown, initialPath: unknown): Promise<DialogPickResult> =>
      pickSinglePath({
        title: optionalString(title) ?? 'Select folder',
        defaultPath: optionalString(initialPath),
        properties: ['openDirectory', 'createDirectory']
      })
  );

  ipcMain.handle(
    FluxoraIpcChannels.dialogSaveFluxPack,
    async (_event, defaultPath: unknown, title: unknown): Promise<DialogPickResult> =>
      saveSinglePath({
        title: optionalString(title) ?? 'Save FluxPack',
        defaultPath: optionalString(defaultPath),
        filters: [
          { name: 'FluxPack packages', extensions: ['fluxpack'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
  );

  ipcMain.handle(FluxoraIpcChannels.bridgeGetStatus, async (_event, request: unknown) =>
    bridge.getStatus(request)
  );

  ipcMain.handle(FluxoraIpcChannels.bridgeGetLanguage, async (_event, request: unknown) =>
    bridge.getLanguage(request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.bridgeSetLanguage,
    async (_event, language: unknown, request: unknown) => bridge.setLanguage(language, request)
  );

  ipcMain.handle(FluxoraIpcChannels.bridgeShutdown, async (_event, request: unknown) =>
    bridge.shutdown(request)
  );

  ipcMain.handle(FluxoraIpcChannels.settingsGetTheme, async (_event, request: unknown) =>
    bridge.getTheme(request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.settingsSetTheme,
    async (_event, theme: unknown, request: unknown) => bridge.setTheme(theme, request)
  );

  ipcMain.handle(FluxoraIpcChannels.templatesList, async (_event, request: unknown) =>
    bridge.listTemplates(request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.templatesResolve,
    async (_event, templateId: unknown, request: unknown) =>
      bridge.resolveTemplate(templateId, request)
  );

  ipcMain.handle(FluxoraIpcChannels.projectsList, async (_event, request: unknown) =>
    bridge.listProjects(request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.projectsOpenConfig,
    async (_event, configPath: unknown, request: unknown) =>
      bridge.openProjectConfig(configPath, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.projectsPreviewDirectory,
    async (_event, projectName: unknown, installRootDirectory: unknown, request: unknown) =>
      bridge.previewProjectDirectory(projectName, installRootDirectory, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.projectsCreate,
    async (_event, project: unknown, request: unknown) =>
      bridge.createProject(project, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.projectsRename,
    async (_event, configPath: unknown, newName: unknown, request: unknown) =>
      bridge.renameProject(configPath, newName, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.projectsDelete,
    async (_event, configPath: unknown, request: unknown) =>
      bridge.deleteProject(configPath, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.buildPathsGet,
    async (_event, configPath: unknown, request: unknown) =>
      bridge.getBuildPathSettings(configPath, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.buildPathsSave,
    async (_event, configPath: unknown, settings: unknown, request: unknown) =>
      bridge.saveBuildPathSettings(configPath, settings, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.fluxPackExport,
    async (_event, exportRequest: unknown, request: unknown) =>
      bridge.exportFluxPack(exportRequest, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.fluxPackInspect,
    async (_event, fluxPackPath: unknown, request: unknown) =>
      bridge.inspectFluxPack(fluxPackPath, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.fluxPackInstall,
    async (_event, installRequest: unknown, request: unknown) =>
      bridge.installFluxPack(installRequest, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.modsListInstalled,
    async (_event, projectDirectory: unknown, request: unknown) =>
      bridge.listInstalledMods(projectDirectory, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.modsGetOrder,
    async (_event, projectDirectory: unknown, profileName: unknown, request: unknown) =>
      bridge.getModOrder(projectDirectory, profileName, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.modsCreateSeparator,
    async (
      _event,
      projectDirectory: unknown,
      profileName: unknown,
      title: unknown,
      targetIndex: unknown,
      request: unknown
    ) => bridge.createModSeparator(projectDirectory, profileName, title, targetIndex, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.modsDeleteSeparator,
    async (
      _event,
      projectDirectory: unknown,
      profileName: unknown,
      separatorId: unknown,
      request: unknown
    ) => bridge.deleteModSeparator(projectDirectory, profileName, separatorId, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.modsMoveOrderItem,
    async (
      _event,
      projectDirectory: unknown,
      profileName: unknown,
      orderItemId: unknown,
      targetIndex: unknown,
      request: unknown
    ) => bridge.moveModOrderItem(projectDirectory, profileName, orderItemId, targetIndex, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.modsDeleteInstalled,
    async (_event, projectDirectory: unknown, modPath: unknown, request: unknown) =>
      bridge.deleteInstalledMod(projectDirectory, modPath, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.modsCreateEmpty,
    async (_event, projectDirectory: unknown, modName: unknown, request: unknown) =>
      bridge.createEmptyMod(projectDirectory, modName, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.modsSetEnabled,
    async (
      _event,
      projectDirectory: unknown,
      modPath: unknown,
      isEnabled: unknown,
      request: unknown
    ) => bridge.setInstalledModEnabled(projectDirectory, modPath, isEnabled, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.modsSetAllEnabled,
    async (_event, projectDirectory: unknown, isEnabled: unknown, request: unknown) =>
      bridge.setAllInstalledModsEnabled(projectDirectory, isEnabled, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.modsCheckUpdates,
    async (_event, projectDirectory: unknown, request: unknown) =>
      bridge.checkModUpdates(projectDirectory, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.modsGetFileTree,
    async (
      _event,
      projectDirectory: unknown,
      modPath: unknown,
      relativeDirectory: unknown,
      request: unknown
    ) => bridge.getModFileTree(projectDirectory, modPath, relativeDirectory, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.pluginsList,
    async (
      _event,
      projectDirectory: unknown,
      templateId: unknown,
      profileName: unknown,
      request: unknown
    ) => bridge.listPlugins(projectDirectory, templateId, profileName, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.pluginsCreateSeparator,
    async (
      _event,
      projectDirectory: unknown,
      templateId: unknown,
      profileName: unknown,
      title: unknown,
      targetIndex: unknown,
      request: unknown
    ) =>
      bridge.createPluginSeparator(
        projectDirectory,
        templateId,
        profileName,
        title,
        targetIndex,
        request
      )
  );

  ipcMain.handle(
    FluxoraIpcChannels.pluginsDeleteSeparator,
    async (
      _event,
      projectDirectory: unknown,
      templateId: unknown,
      profileName: unknown,
      separatorId: unknown,
      request: unknown
    ) =>
      bridge.deletePluginSeparator(
        projectDirectory,
        templateId,
        profileName,
        separatorId,
        request
      )
  );

  ipcMain.handle(
    FluxoraIpcChannels.pluginsMove,
    async (
      _event,
      projectDirectory: unknown,
      templateId: unknown,
      profileName: unknown,
      orderItemId: unknown,
      targetIndex: unknown,
      request: unknown
    ) =>
      bridge.movePlugin(
        projectDirectory,
        templateId,
        profileName,
        orderItemId,
        targetIndex,
        request
      )
  );

  ipcMain.handle(
    FluxoraIpcChannels.pluginsSetEnabled,
    async (
      _event,
      projectDirectory: unknown,
      templateId: unknown,
      profileName: unknown,
      pluginName: unknown,
      isEnabled: unknown,
      request: unknown
    ) =>
      bridge.setPluginEnabled(
        projectDirectory,
        templateId,
        profileName,
        pluginName,
        isEnabled,
        request
      )
  );

  ipcMain.handle(
    FluxoraIpcChannels.profilesList,
    async (
      _event,
      projectDirectory: unknown,
      defaultProfileName: unknown,
      request: unknown
    ) => bridge.listProfiles(projectDirectory, defaultProfileName, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.profilesCreate,
    async (
      _event,
      projectDirectory: unknown,
      profileName: unknown,
      defaultProfileName: unknown,
      profileFiles: unknown,
      request: unknown
    ) => bridge.createProfile(projectDirectory, profileName, defaultProfileName, profileFiles, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.profilesClone,
    async (
      _event,
      projectDirectory: unknown,
      sourceProfileName: unknown,
      targetProfileName: unknown,
      defaultProfileName: unknown,
      request: unknown
    ) =>
      bridge.cloneProfile(
        projectDirectory,
        sourceProfileName,
        targetProfileName,
        defaultProfileName,
        request
      )
  );

  ipcMain.handle(
    FluxoraIpcChannels.profilesRename,
    async (
      _event,
      projectDirectory: unknown,
      sourceProfileName: unknown,
      targetProfileName: unknown,
      defaultProfileName: unknown,
      request: unknown
    ) =>
      bridge.renameProfile(
        projectDirectory,
        sourceProfileName,
        targetProfileName,
        defaultProfileName,
        request
      )
  );

  ipcMain.handle(
    FluxoraIpcChannels.profilesDelete,
    async (
      _event,
      projectDirectory: unknown,
      profileName: unknown,
      defaultProfileName: unknown,
      request: unknown
    ) => bridge.deleteProfile(projectDirectory, profileName, defaultProfileName, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.executablesList,
    async (_event, configPath: unknown, request: unknown) =>
      bridge.listExecutables(configPath, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.executablesSave,
    async (_event, configPath: unknown, executables: unknown, request: unknown) =>
      bridge.saveExecutables(configPath, executables, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.executablesLaunch,
    async (
      _event,
      configPath: unknown,
      executableId: unknown,
      profileName: unknown,
      request: unknown
    ) => bridge.launchExecutable(configPath, executableId, profileName, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.executablesGetIcon,
    async (_event, executablePath: unknown, request: unknown) =>
      bridge.getExecutableIcon(executablePath, request)
  );

  ipcMain.handle(FluxoraIpcChannels.nexusGetAuthStatus, async (_event, request: unknown) =>
    bridge.getNexusAuthStatus(request)
  );

  ipcMain.handle(FluxoraIpcChannels.nexusConnect, async (_event, request: unknown) =>
    bridge.connectNexus(request)
  );

  ipcMain.handle(FluxoraIpcChannels.nexusDisconnect, async (_event, request: unknown) =>
    bridge.disconnectNexus(request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.transferAnalyzeMo2,
    async (
      _event,
      sourceDirectory: unknown,
      destinationRootDirectory: unknown,
      existingConfigPath: unknown,
      request: unknown
    ) =>
      bridge.analyzeMo2Transfer(
        sourceDirectory,
        destinationRootDirectory,
        existingConfigPath,
        request
      )
  );

  ipcMain.handle(
    FluxoraIpcChannels.transferImportMo2,
    async (_event, importRequest: unknown, request: unknown) =>
      bridge.importMo2Transfer(importRequest, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.transferListDestinationDrives,
    async (_event, request: unknown) => listTransferDestinationDrives(logs, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.transferStartMo2InMain,
    async (event, rawHandoff: unknown): Promise<void> => {
      const handoff = normalizeMo2TransferHandoff(rawHandoff);
      if (!handoff) {
        throw new Error('Invalid MO2 transfer handoff.');
      }

      const targetWindow =
        mainAppWindow && !mainAppWindow.isDestroyed()
          ? mainAppWindow
          : await createMainWindow();
      if (targetWindow.isMinimized()) {
        targetWindow.restore();
      }

      targetWindow.webContents.send(FluxoraIpcChannels.transferMo2Handoff, handoff);
      targetWindow.focus();

      const sourceWindow = BrowserWindow.fromWebContents(event.sender);
      if (sourceWindow && sourceWindow !== targetWindow && sourceWindow === settingsWindow) {
        sourceWindow.close();
      }
    }
  );

  ipcMain.handle(
    FluxoraIpcChannels.transferOpenMo2InMain,
    async (event): Promise<void> => {
      const targetWindow =
        mainAppWindow && !mainAppWindow.isDestroyed()
          ? mainAppWindow
          : await createMainWindow();
      if (targetWindow.isMinimized()) {
        targetWindow.restore();
      }

      targetWindow.webContents.send(FluxoraIpcChannels.transferMo2Open);
      targetWindow.focus();

      const sourceWindow = BrowserWindow.fromWebContents(event.sender);
      if (sourceWindow && sourceWindow !== targetWindow && sourceWindow === settingsWindow) {
        sourceWindow.close();
      }
    }
  );

  ipcMain.handle(
    FluxoraIpcChannels.operationsCancel,
    async (_event, operationId: unknown, request: unknown) =>
      bridge.cancelOperation(operationId, request)
  );

  ipcMain.handle(FluxoraIpcChannels.nxmRegisterProtocol, async (_event, request: unknown) => {
    const operationId =
      request && typeof request === 'object' && typeof (request as { operationId?: unknown }).operationId === 'string'
        ? (request as { operationId: string }).operationId
        : createOperationId('nxm_register_protocol');
    const electronRegistered =
      process.defaultApp && process.argv.length >= 2
        ? app.setAsDefaultProtocolClient('nxm', process.execPath, [path.resolve(process.argv[1])])
        : app.setAsDefaultProtocolClient('nxm');

    await logs.write(
      'main-bridge',
      electronRegistered ? 'info' : 'warning',
      'NXM',
      electronRegistered ? 'Electron protocol registration accepted' : 'Electron protocol registration failed',
      operationId
    );

    return bridge.registerNxmProtocol(process.execPath, electronRegistered, { operationId });
  });

  ipcMain.handle(
    FluxoraIpcChannels.nxmCaptureLinks,
    async (_event, projectDirectory: unknown, links: unknown, request: unknown) =>
      bridge.captureNxmLinks(projectDirectory, links, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.nxmImportInboundDownloads,
    async (_event, projectDirectory: unknown, request: unknown) =>
      bridge.importInboundDownloads(projectDirectory, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.downloadsList,
    async (_event, projectDirectory: unknown, request: unknown) =>
      bridge.listDownloads(projectDirectory, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.downloadsImportFile,
    async (_event, projectDirectory: unknown, sourcePath: unknown, request: unknown) =>
      bridge.importDownloadFile(projectDirectory, sourcePath, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.downloadsDelete,
    async (_event, projectDirectory: unknown, downloadPath: unknown, request: unknown) =>
      bridge.deleteDownload(projectDirectory, downloadPath, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.downloadsCancel,
    async (_event, projectDirectory: unknown, downloadPath: unknown, request: unknown) =>
      bridge.cancelDownload(projectDirectory, downloadPath, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.downloadsResume,
    async (_event, projectDirectory: unknown, downloadPath: unknown, request: unknown) =>
      bridge.resumeDownload(projectDirectory, downloadPath, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.downloadsAnalyzeContentLayout,
    async (_event, analyze: unknown, request: unknown) =>
      bridge.analyzeDownloadContentLayout(analyze, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.downloadsAnalyzeFomod,
    async (_event, projectDirectory: unknown, downloadPath: unknown, request: unknown) =>
      bridge.analyzeFomodDownload(projectDirectory, downloadPath, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.downloadsAnalyzeFomodContentLayout,
    async (_event, analyze: unknown, request: unknown) =>
      bridge.analyzeFomodDownloadContentLayout(analyze, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.downloadsInstall,
    async (_event, install: unknown, request: unknown) => bridge.installDownload(install, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.downloadsInstallFomod,
    async (_event, install: unknown, request: unknown) =>
      bridge.installFomodDownload(install, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.archivesInstall,
    async (_event, install: unknown, request: unknown) => bridge.installArchive(install, request)
  );

  ipcMain.handle(
    FluxoraIpcChannels.archivesInstallFomod,
    async (_event, install: unknown, request: unknown) =>
      bridge.installFomodArchive(install, request)
  );

  ipcMain.handle(FluxoraIpcChannels.uiLog, async (_event, entry: unknown): Promise<void> => {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    const candidate = entry as {
      level?: unknown;
      message?: unknown;
      operationId?: unknown;
      category?: unknown;
    };

    if (!isFluxoraLogLevel(candidate.level) || typeof candidate.message !== 'string') {
      return;
    }

    await logs.write(
      'ui',
      candidate.level,
      typeof candidate.category === 'string' ? candidate.category : 'Renderer',
      candidate.message,
      typeof candidate.operationId === 'string' ? candidate.operationId : undefined
    );
  });

  ipcMain.handle(FluxoraIpcChannels.windowMinimize, async (event): Promise<void> => {
    controlWindow(event, (window) => window.minimize());
  });

  ipcMain.handle(FluxoraIpcChannels.windowOpenSettings, async (): Promise<void> => {
    await createSettingsWindow();
  });

  ipcMain.handle(FluxoraIpcChannels.windowToggleMaximize, async (event): Promise<void> => {
    controlWindow(event, (window) => {
      if (window.isMaximized()) {
        window.unmaximize();
        return;
      }

      window.maximize();
    });
  });

  ipcMain.handle(FluxoraIpcChannels.windowClose, async (event): Promise<void> => {
    controlWindow(event, (window) => window.close());
  });
};

const createSettingsWindow = async (): Promise<BrowserWindow> => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }

    settingsWindow.focus();
    return settingsWindow;
  }

  const nextSettingsWindow = new BrowserWindow({
    title: 'Settings',
    width: 980,
    height: 700,
    minWidth: 860,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#101317',
    icon: getAppIconPath(),
    webPreferences: {
      preload: getPreloadScriptPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  settingsWindow = nextSettingsWindow;

  nextSettingsWindow.once('ready-to-show', () => {
    nextSettingsWindow.show();
  });

  nextSettingsWindow.on('closed', () => {
    if (settingsWindow === nextSettingsWindow) {
      settingsWindow = null;
    }
  });

  configureRendererWindow(nextSettingsWindow);
  await loadRendererWindow(nextSettingsWindow, { window: 'settings' });
  return nextSettingsWindow;
};

const createMainWindow = async (): Promise<BrowserWindow> => {
  const nextMainWindow = new BrowserWindow({
    title: 'Fluxora',
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    show: false,
    backgroundColor: '#101317',
    icon: getAppIconPath(),
    webPreferences: {
      preload: getPreloadScriptPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainAppWindow = nextMainWindow;

  nextMainWindow.once('ready-to-show', () => {
    nextMainWindow.show();
  });

  nextMainWindow.on('closed', () => {
    if (mainAppWindow === nextMainWindow) {
      mainAppWindow = null;
    }
  });

  configureRendererWindow(nextMainWindow);
  await loadRendererWindow(nextMainWindow);

  return nextMainWindow;
};

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) {
      void createMainWindow();
    } else {
      if (window.isMinimized()) {
        window.restore();
      }

      window.focus();
    }

    void captureNxmLinksFromArgs(commandLine);
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    void captureNxmLinksFromArgs([url]);
  });

  app.whenReady().then(async () => {
    electronLogs = new ElectronLogService(path.join(app.getPath('userData'), 'logs'));
    nativeBridge = new NativeBridgeService(electronLogs);
    nativeBridge.onOperationProgress(broadcastOperationProgress);
    registerSecurityHandlers(nativeBridge, electronLogs);
    prewarmTransferDestinationDrives(electronLogs);
    void captureNxmLinksFromArgs(process.argv);
    await createMainWindow();
  });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (!nativeBridge) {
    return;
  }

  void nativeBridge.shutdown({ operationId: 'op_electron_before_quit' });
});
