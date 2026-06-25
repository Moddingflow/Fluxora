import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type {
  FluxoraApi,
  FluxoraAppInfo,
  CreateFluxoraProjectRequest,
  DeleteFluxoraProjectResult,
  DialogPickResult,
  DialogSaveResult,
  FluxoraBuildPathSettings,
  FluxoraBuildPathSettingsSaveRequest,
  FluxoraDownloadEntry,
  FluxoraDownloadMutationResult,
  FluxoraExecutable,
  FluxoraExecutableIconResult,
  FluxoraExecutableLaunchResult,
  FluxoraIpcChannel,
  FluxoraGameTemplate,
  FluxoraAnalyzeContentLayoutRequest,
  FluxoraAnalyzeFomodContentLayoutRequest,
  FluxoraContentLayoutPreview,
  FluxoraFomodInstaller,
  FluxoraFluxPackExportRequest,
  FluxoraFluxPackInstallRequest,
  FluxoraFluxPackInstallResult,
  FluxoraFluxPackSummary,
  FluxoraInstallArchiveRequest,
  FluxoraInstallDownloadRequest,
  FluxoraInstallFomodArchiveRequest,
  FluxoraInstallFomodDownloadRequest,
  FluxoraInstalledModSummary,
  FluxoraInstalledMod,
  FluxoraModOrganizerImportAnalysis,
  FluxoraMo2TransferHandoff,
  FluxoraModOrganizerImportRequest,
  FluxoraTransferDriveOption,
  FluxoraModFileTreeEntry,
  FluxoraModMutationResult,
  FluxoraModOrderItem,
  FluxoraNxmProtocolResult,
  FluxoraNexusModsAuthStatus,
  FluxoraOperationCancelResult,
  FluxoraOperationProgress,
  FluxoraPluginOrderItem,
  FluxoraProject,
  FluxoraProjectCatalog,
  FluxoraProjectDirectoryPreview,
  NativeBridgeLanguageResult,
  NativeBridgeCapabilities,
  NativeBridgeThemeResult,
  NativeBridgeStatus,
  OperationRequest,
  FluxoraSecurityState,
  FluxoraThemeMode,
  OpenExternalResult,
  ShellOpenPathResult,
  ShellShowItemInFolderResult,
  UiLogEntry
} from '../shared/fluxora-api';
import { FluxoraIpcChannels } from '../shared/fluxora-api';

export interface IpcInvoker {
  invoke: (channel: FluxoraIpcChannel, ...args: unknown[]) => Promise<unknown>;
  on?: (channel: FluxoraIpcChannel, listener: (...args: unknown[]) => void) => void;
  removeListener?: (channel: FluxoraIpcChannel, listener: (...args: unknown[]) => void) => void;
}

const invokeTyped = async <T>(
  ipc: IpcInvoker,
  channel: FluxoraIpcChannel,
  ...args: unknown[]
): Promise<T> => {
  return (await ipc.invoke(channel, ...args)) as T;
};

const listenTyped = <T>(
  ipc: IpcInvoker,
  channel: FluxoraIpcChannel,
  callback: (payload: T) => void
): (() => void) => {
  if (!ipc.on || !ipc.removeListener) {
    return () => undefined;
  }

  const listener = (_event: unknown, payload: unknown) => {
    callback(payload as T);
  };
  ipc.on(channel, listener);
  return () => {
    ipc.removeListener?.(channel, listener);
  };
};

export const createFluxoraApi = (ipc: IpcInvoker): FluxoraApi => ({
  app: {
    getInfo: () => invokeTyped<FluxoraAppInfo>(ipc, FluxoraIpcChannels.appGetInfo)
  },
  bridge: {
    getStatus: (request?: OperationRequest) =>
      invokeTyped<NativeBridgeStatus>(ipc, FluxoraIpcChannels.bridgeGetStatus, request),
    getLanguage: (request?: OperationRequest) =>
      invokeTyped<NativeBridgeLanguageResult>(ipc, FluxoraIpcChannels.bridgeGetLanguage, request),
    setLanguage: (language: string, request?: OperationRequest) =>
      invokeTyped<NativeBridgeLanguageResult>(
        ipc,
        FluxoraIpcChannels.bridgeSetLanguage,
        language,
        request
      ),
    shutdown: (request?: OperationRequest) =>
      invokeTyped<{ accepted: boolean; operationId: string }>(
        ipc,
        FluxoraIpcChannels.bridgeShutdown,
        request
      )
  },
  settings: {
    getLanguage: (request?: OperationRequest) =>
      invokeTyped<NativeBridgeLanguageResult>(ipc, FluxoraIpcChannels.bridgeGetLanguage, request),
    setLanguage: (language: string, request?: OperationRequest) =>
      invokeTyped<NativeBridgeLanguageResult>(
        ipc,
        FluxoraIpcChannels.bridgeSetLanguage,
        language,
        request
      ),
    getTheme: (request?: OperationRequest) =>
      invokeTyped<NativeBridgeThemeResult>(ipc, FluxoraIpcChannels.settingsGetTheme, request),
    setTheme: (theme: FluxoraThemeMode, request?: OperationRequest) =>
      invokeTyped<NativeBridgeThemeResult>(
        ipc,
        FluxoraIpcChannels.settingsSetTheme,
        theme,
        request
      )
  },
  dialogs: {
    pickArchive: (initialDirectory?: string) =>
      invokeTyped<DialogPickResult>(
        ipc,
        FluxoraIpcChannels.dialogPickArchive,
        initialDirectory
      ),
    pickBuildConfig: (initialDirectory?: string) =>
      invokeTyped<DialogPickResult>(
        ipc,
        FluxoraIpcChannels.dialogPickBuildConfig,
        initialDirectory
      ),
    pickExecutable: (title?: string, initialPath?: string) =>
      invokeTyped<DialogPickResult>(
        ipc,
        FluxoraIpcChannels.dialogPickExecutable,
        title,
        initialPath
      ),
    pickFluxPack: (initialDirectory?: string) =>
      invokeTyped<DialogPickResult>(
        ipc,
        FluxoraIpcChannels.dialogPickFluxPack,
        initialDirectory
      ),
    pickFolder: (title?: string, initialPath?: string) =>
      invokeTyped<DialogPickResult>(
        ipc,
        FluxoraIpcChannels.dialogPickFolder,
        title,
        initialPath
      ),
    saveFluxPack: (defaultPath?: string, title?: string) =>
      invokeTyped<DialogSaveResult>(
        ipc,
        FluxoraIpcChannels.dialogSaveFluxPack,
        defaultPath,
        title
      )
  },
  links: {
    openExternal: (url: string) =>
      invokeTyped<OpenExternalResult>(ipc, FluxoraIpcChannels.linksOpenExternal, url)
  },
  mods: {
    listInstalled: (projectDirectory: string, request?: OperationRequest) =>
      invokeTyped<FluxoraInstalledMod[]>(
        ipc,
        FluxoraIpcChannels.modsListInstalled,
        projectDirectory,
        request
      ),
    getOrder: (projectDirectory: string, profileName?: string, request?: OperationRequest) =>
      invokeTyped<FluxoraModOrderItem[]>(
        ipc,
        FluxoraIpcChannels.modsGetOrder,
        projectDirectory,
        profileName,
        request
      ),
    createSeparator: (
      projectDirectory: string,
      profileName: string | undefined,
      title: string,
      targetIndex: number,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModOrderItem[]>(
        ipc,
        FluxoraIpcChannels.modsCreateSeparator,
        projectDirectory,
        profileName,
        title,
        targetIndex,
        request
      ),
    deleteSeparator: (
      projectDirectory: string,
      profileName: string | undefined,
      separatorId: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModOrderItem[]>(
        ipc,
        FluxoraIpcChannels.modsDeleteSeparator,
        projectDirectory,
        profileName,
        separatorId,
        request
      ),
    moveOrderItem: (
      projectDirectory: string,
      profileName: string | undefined,
      orderItemId: string,
      targetIndex: number,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModOrderItem[]>(
        ipc,
        FluxoraIpcChannels.modsMoveOrderItem,
        projectDirectory,
        profileName,
        orderItemId,
        targetIndex,
        request
      ),
    deleteInstalled: (projectDirectory: string, modPath: string, request?: OperationRequest) =>
      invokeTyped<FluxoraModMutationResult>(
        ipc,
        FluxoraIpcChannels.modsDeleteInstalled,
        projectDirectory,
        modPath,
        request
      ),
    createEmpty: (projectDirectory: string, modName: string, request?: OperationRequest) =>
      invokeTyped<FluxoraInstalledMod>(
        ipc,
        FluxoraIpcChannels.modsCreateEmpty,
        projectDirectory,
        modName,
        request
      ),
    setEnabled: (
      projectDirectory: string,
      modPath: string,
      isEnabled: boolean,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModMutationResult>(
        ipc,
        FluxoraIpcChannels.modsSetEnabled,
        projectDirectory,
        modPath,
        isEnabled,
        request
      ),
    setAllEnabled: (
      projectDirectory: string,
      isEnabled: boolean,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModMutationResult>(
        ipc,
        FluxoraIpcChannels.modsSetAllEnabled,
        projectDirectory,
        isEnabled,
        request
      ),
    checkUpdates: (projectDirectory: string, request?: OperationRequest) =>
      invokeTyped<FluxoraInstalledMod[]>(
        ipc,
        FluxoraIpcChannels.modsCheckUpdates,
        projectDirectory,
        request
      ),
    getFileTree: (
      projectDirectory: string,
      modPath: string,
      relativeDirectory?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModFileTreeEntry[]>(
        ipc,
        FluxoraIpcChannels.modsGetFileTree,
        projectDirectory,
        modPath,
        relativeDirectory,
        request
      )
  },
  plugins: {
    list: (
      projectDirectory: string,
      templateId: string,
      profileName?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraPluginOrderItem[]>(
        ipc,
        FluxoraIpcChannels.pluginsList,
        projectDirectory,
        templateId,
        profileName,
        request
      ),
    createSeparator: (
      projectDirectory: string,
      templateId: string,
      profileName: string | undefined,
      title: string,
      targetIndex: number,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraPluginOrderItem[]>(
        ipc,
        FluxoraIpcChannels.pluginsCreateSeparator,
        projectDirectory,
        templateId,
        profileName,
        title,
        targetIndex,
        request
      ),
    deleteSeparator: (
      projectDirectory: string,
      templateId: string,
      profileName: string | undefined,
      separatorId: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraPluginOrderItem[]>(
        ipc,
        FluxoraIpcChannels.pluginsDeleteSeparator,
        projectDirectory,
        templateId,
        profileName,
        separatorId,
        request
      ),
    move: (
      projectDirectory: string,
      templateId: string,
      profileName: string | undefined,
      orderItemId: string,
      targetIndex: number,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraPluginOrderItem[]>(
        ipc,
        FluxoraIpcChannels.pluginsMove,
        projectDirectory,
        templateId,
        profileName,
        orderItemId,
        targetIndex,
        request
      ),
    setEnabled: (
      projectDirectory: string,
      templateId: string,
      profileName: string | undefined,
      pluginName: string,
      isEnabled: boolean,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraPluginOrderItem[]>(
        ipc,
        FluxoraIpcChannels.pluginsSetEnabled,
        projectDirectory,
        templateId,
        profileName,
        pluginName,
        isEnabled,
        request
      )
  },
  profiles: {
    list: (
      projectDirectory: string,
      defaultProfileName?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<string[]>(
        ipc,
        FluxoraIpcChannels.profilesList,
        projectDirectory,
        defaultProfileName,
        request
      ),
    create: (
      projectDirectory: string,
      profileName: string,
      defaultProfileName?: string,
      profileFiles?: string[],
      request?: OperationRequest
    ) =>
      invokeTyped<string[]>(
        ipc,
        FluxoraIpcChannels.profilesCreate,
        projectDirectory,
        profileName,
        defaultProfileName,
        profileFiles,
        request
      ),
    clone: (
      projectDirectory: string,
      sourceProfileName: string,
      targetProfileName: string,
      defaultProfileName?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<string[]>(
        ipc,
        FluxoraIpcChannels.profilesClone,
        projectDirectory,
        sourceProfileName,
        targetProfileName,
        defaultProfileName,
        request
      ),
    rename: (
      projectDirectory: string,
      sourceProfileName: string,
      targetProfileName: string,
      defaultProfileName?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<string[]>(
        ipc,
        FluxoraIpcChannels.profilesRename,
        projectDirectory,
        sourceProfileName,
        targetProfileName,
        defaultProfileName,
        request
      ),
    delete: (
      projectDirectory: string,
      profileName: string,
      defaultProfileName?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<string[]>(
        ipc,
        FluxoraIpcChannels.profilesDelete,
        projectDirectory,
        profileName,
        defaultProfileName,
        request
      )
  },
  executables: {
    list: (configPath: string, request?: OperationRequest) =>
      invokeTyped<FluxoraExecutable[]>(
        ipc,
        FluxoraIpcChannels.executablesList,
        configPath,
        request
      ),
    save: (
      configPath: string,
      executables: FluxoraExecutable[],
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraExecutable[]>(
        ipc,
        FluxoraIpcChannels.executablesSave,
        configPath,
        executables,
        request
      ),
    launch: (
      configPath: string,
      executableId: string,
      profileName?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraExecutableLaunchResult>(
        ipc,
        FluxoraIpcChannels.executablesLaunch,
        configPath,
        executableId,
        profileName,
        request
      ),
    getIcon: (executablePath: string, request?: OperationRequest) =>
      invokeTyped<FluxoraExecutableIconResult>(
        ipc,
        FluxoraIpcChannels.executablesGetIcon,
        executablePath,
        request
      )
  },
  downloads: {
    list: (projectDirectory: string, request?: OperationRequest) =>
      invokeTyped<FluxoraDownloadEntry[]>(
        ipc,
        FluxoraIpcChannels.downloadsList,
        projectDirectory,
        request
      ),
    importFile: (projectDirectory: string, sourcePath: string, request?: OperationRequest) =>
      invokeTyped<FluxoraDownloadEntry>(
        ipc,
        FluxoraIpcChannels.downloadsImportFile,
        projectDirectory,
        sourcePath,
        request
      ),
    delete: (projectDirectory: string, downloadPath: string, request?: OperationRequest) =>
      invokeTyped<FluxoraDownloadMutationResult>(
        ipc,
        FluxoraIpcChannels.downloadsDelete,
        projectDirectory,
        downloadPath,
        request
      ),
    cancel: (projectDirectory: string, downloadPath: string, request?: OperationRequest) =>
      invokeTyped<FluxoraDownloadMutationResult>(
        ipc,
        FluxoraIpcChannels.downloadsCancel,
        projectDirectory,
        downloadPath,
        request
      ),
    resume: (projectDirectory: string, downloadPath: string, request?: OperationRequest) =>
      invokeTyped<FluxoraDownloadEntry>(
        ipc,
        FluxoraIpcChannels.downloadsResume,
        projectDirectory,
        downloadPath,
        request
      ),
    analyzeContentLayout: (
      request: FluxoraAnalyzeContentLayoutRequest,
      operation?: OperationRequest
    ) =>
      invokeTyped<FluxoraContentLayoutPreview>(
        ipc,
        FluxoraIpcChannels.downloadsAnalyzeContentLayout,
        request,
        operation
      ),
    analyzeFomod: (
      projectDirectory: string,
      downloadPath: string,
      operation?: OperationRequest
    ) =>
      invokeTyped<FluxoraFomodInstaller>(
        ipc,
        FluxoraIpcChannels.downloadsAnalyzeFomod,
        projectDirectory,
        downloadPath,
        operation
      ),
    analyzeFomodContentLayout: (
      request: FluxoraAnalyzeFomodContentLayoutRequest,
      operation?: OperationRequest
    ) =>
      invokeTyped<FluxoraContentLayoutPreview>(
        ipc,
        FluxoraIpcChannels.downloadsAnalyzeFomodContentLayout,
        request,
        operation
      ),
    install: (request: FluxoraInstallDownloadRequest, operation?: OperationRequest) =>
      invokeTyped<FluxoraInstalledModSummary>(
        ipc,
        FluxoraIpcChannels.downloadsInstall,
        request,
        operation
      ),
    installFomod: (request: FluxoraInstallFomodDownloadRequest, operation?: OperationRequest) =>
      invokeTyped<FluxoraInstalledModSummary>(
        ipc,
        FluxoraIpcChannels.downloadsInstallFomod,
        request,
        operation
      )
  },
  archives: {
    install: (request: FluxoraInstallArchiveRequest, operation?: OperationRequest) =>
      invokeTyped<FluxoraInstalledModSummary>(
        ipc,
        FluxoraIpcChannels.archivesInstall,
        request,
        operation
      ),
    installFomod: (request: FluxoraInstallFomodArchiveRequest, operation?: OperationRequest) =>
      invokeTyped<FluxoraInstalledModSummary>(
        ipc,
        FluxoraIpcChannels.archivesInstallFomod,
        request,
        operation
      )
  },
  nxm: {
    registerProtocol: (request?: OperationRequest) =>
      invokeTyped<FluxoraNxmProtocolResult>(
        ipc,
        FluxoraIpcChannels.nxmRegisterProtocol,
        request
      ),
    captureLinks: (
      projectDirectory: string | undefined,
      links: string[],
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraDownloadEntry[]>(
        ipc,
        FluxoraIpcChannels.nxmCaptureLinks,
        projectDirectory,
        links,
        request
      ),
    importInboundDownloads: (projectDirectory: string, request?: OperationRequest) =>
      invokeTyped<FluxoraDownloadEntry[]>(
        ipc,
        FluxoraIpcChannels.nxmImportInboundDownloads,
        projectDirectory,
        request
      )
  },
  nexus: {
    getAuthStatus: (request?: OperationRequest) =>
      invokeTyped<FluxoraNexusModsAuthStatus>(
        ipc,
        FluxoraIpcChannels.nexusGetAuthStatus,
        request
      ),
    connect: (request?: OperationRequest) =>
      invokeTyped<FluxoraNexusModsAuthStatus>(
        ipc,
        FluxoraIpcChannels.nexusConnect,
        request
      ),
    disconnect: (request?: OperationRequest) =>
      invokeTyped<FluxoraNexusModsAuthStatus>(
        ipc,
        FluxoraIpcChannels.nexusDisconnect,
        request
      )
  },
  transfer: {
    analyzeMo2: (
      sourceDirectory: string,
      destinationRootDirectory: string,
      existingConfigPath?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModOrganizerImportAnalysis>(
        ipc,
        FluxoraIpcChannels.transferAnalyzeMo2,
        sourceDirectory,
        destinationRootDirectory,
        existingConfigPath,
        request
      ),
    importMo2: (request: FluxoraModOrganizerImportRequest, operation?: OperationRequest) =>
      invokeTyped<FluxoraProject>(
        ipc,
        FluxoraIpcChannels.transferImportMo2,
        request,
        operation
      ),
    listDestinationDrives: (request?: OperationRequest) =>
      invokeTyped<FluxoraTransferDriveOption[]>(
        ipc,
        FluxoraIpcChannels.transferListDestinationDrives,
        request
      ),
    startMo2InMain: (handoff: FluxoraMo2TransferHandoff) =>
      invokeTyped<void>(ipc, FluxoraIpcChannels.transferStartMo2InMain, handoff),
    openMo2InMain: () =>
      invokeTyped<void>(ipc, FluxoraIpcChannels.transferOpenMo2InMain),
    onMo2Handoff: (callback: (handoff: FluxoraMo2TransferHandoff) => void) =>
      listenTyped<FluxoraMo2TransferHandoff>(
        ipc,
        FluxoraIpcChannels.transferMo2Handoff,
        callback
      ),
    onMo2Open: (callback: () => void) =>
      listenTyped<void>(
        ipc,
        FluxoraIpcChannels.transferMo2Open,
        callback
      )
  },
  buildPaths: {
    get: (configPath: string, request?: OperationRequest) =>
      invokeTyped<FluxoraBuildPathSettings>(
        ipc,
        FluxoraIpcChannels.buildPathsGet,
        configPath,
        request
      ),
    save: (
      configPath: string,
      settings: FluxoraBuildPathSettingsSaveRequest,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraBuildPathSettings>(
        ipc,
        FluxoraIpcChannels.buildPathsSave,
        configPath,
        settings,
        request
      )
  },
  fluxPack: {
    export: (request: FluxoraFluxPackExportRequest, operation?: OperationRequest) =>
      invokeTyped<FluxoraFluxPackSummary>(
        ipc,
        FluxoraIpcChannels.fluxPackExport,
        request,
        operation
      ),
    inspect: (fluxPackPath: string, request?: OperationRequest) =>
      invokeTyped<FluxoraFluxPackSummary>(
        ipc,
        FluxoraIpcChannels.fluxPackInspect,
        fluxPackPath,
        request
      ),
    install: (request: FluxoraFluxPackInstallRequest, operation?: OperationRequest) =>
      invokeTyped<FluxoraFluxPackInstallResult>(
        ipc,
        FluxoraIpcChannels.fluxPackInstall,
        request,
        operation
      )
  },
  operations: {
    cancel: (operationId: string, request?: OperationRequest) =>
      invokeTyped<FluxoraOperationCancelResult>(
        ipc,
        FluxoraIpcChannels.operationsCancel,
        operationId,
        request
      ),
    onProgress: (callback: (progress: FluxoraOperationProgress) => void) =>
      listenTyped<FluxoraOperationProgress>(
        ipc,
        FluxoraIpcChannels.operationsProgress,
        callback
      )
  },
  projects: {
    list: (request?: OperationRequest) =>
      invokeTyped<FluxoraProjectCatalog>(ipc, FluxoraIpcChannels.projectsList, request),
    openConfig: (configPath: string, request?: OperationRequest) =>
      invokeTyped<FluxoraProject>(
        ipc,
        FluxoraIpcChannels.projectsOpenConfig,
        configPath,
        request
      ),
    previewDirectory: (
      projectName: string,
      installRootDirectory: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraProjectDirectoryPreview>(
        ipc,
        FluxoraIpcChannels.projectsPreviewDirectory,
        projectName,
        installRootDirectory,
        request
      ),
    create: (project: CreateFluxoraProjectRequest, request?: OperationRequest) =>
      invokeTyped<FluxoraProject>(
        ipc,
        FluxoraIpcChannels.projectsCreate,
        project,
        request
      ),
    rename: (configPath: string, newName: string, request?: OperationRequest) =>
      invokeTyped<FluxoraProject>(
        ipc,
        FluxoraIpcChannels.projectsRename,
        configPath,
        newName,
        request
      ),
    delete: (configPath: string, request?: OperationRequest) =>
      invokeTyped<DeleteFluxoraProjectResult>(
        ipc,
        FluxoraIpcChannels.projectsDelete,
        configPath,
        request
      )
  },
  security: {
    getState: () =>
      invokeTyped<FluxoraSecurityState>(ipc, FluxoraIpcChannels.securityGetState)
  },
  shell: {
    openPath: (path: string) =>
      invokeTyped<ShellOpenPathResult>(ipc, FluxoraIpcChannels.shellOpenPath, path),
    showItemInFolder: (path: string) =>
      invokeTyped<ShellShowItemInFolderResult>(
        ipc,
        FluxoraIpcChannels.shellShowItemInFolder,
        path
      )
  },
  templates: {
    list: (request?: OperationRequest) =>
      invokeTyped<FluxoraGameTemplate[]>(ipc, FluxoraIpcChannels.templatesList, request),
    resolve: (templateId: string, request?: OperationRequest) =>
      invokeTyped<FluxoraGameTemplate>(
        ipc,
        FluxoraIpcChannels.templatesResolve,
        templateId,
        request
      )
  },
  ui: {
    log: (entry: UiLogEntry) => invokeTyped<void>(ipc, FluxoraIpcChannels.uiLog, entry)
  },
  windowControls: {
    close: () => invokeTyped<void>(ipc, FluxoraIpcChannels.windowClose),
    minimize: () => invokeTyped<void>(ipc, FluxoraIpcChannels.windowMinimize),
    openSettings: () => invokeTyped<void>(ipc, FluxoraIpcChannels.windowOpenSettings),
    toggleMaximize: () => invokeTyped<void>(ipc, FluxoraIpcChannels.windowToggleMaximize)
  }
});

interface RuntimePaths {
  buildConfigsDirectory: string;
  defaultInstallRootDirectory: string;
}

type EventUnlisten = () => void;

const eventUnlisteners = new Map<string, Promise<EventUnlisten>>();
const legacyShellState = ['elec', 'tron-main'].join('');
const legacyRuntimePattern = new RegExp(['Elec', 'tron'].join(''), 'gi');
const legacyPackagerPattern = new RegExp(['Fo', 'rge'].join(''), 'gi');
const transferImportTimeoutMs = 2 * 60 * 60 * 1000;

const createOperationId = (scope: string): string =>
  `op_${new Date().toISOString().replace(/[-:.TZ]/g, '')}_${scope}_${crypto.randomUUID().slice(0, 8)}`;

const requestWithOperationId = (rawRequest: unknown, scope: string): OperationRequest => {
  const request = rawRequest && typeof rawRequest === 'object' ? (rawRequest as OperationRequest) : {};
  return {
    operationId:
      typeof request.operationId === 'string' && request.operationId.length > 0
        ? request.operationId
        : createOperationId(scope)
  };
};

const operationIdOf = (request: OperationRequest, scope: string): string =>
  request.operationId ?? createOperationId(scope);

const optionalString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bridgeRequest = async <T>(
  method: string,
  params: Record<string, unknown>,
  request: OperationRequest,
  timeoutMs?: number
): Promise<T> =>
  invoke<T>('fluxora_bridge_request', {
    method,
    params,
    request,
    timeoutMs
  });

const runtimePaths = (): Promise<RuntimePaths> => invoke<RuntimePaths>('fluxora_runtime_paths');

const withOperationId = <T extends Record<string, unknown>>(
  value: T,
  request: OperationRequest,
  scope: string
): T & { operationId: string } => ({
  ...value,
  operationId: operationIdOf(request, scope)
});

const bridgeStatusWithRuntimeCapabilities = async (
  rawRequest: unknown
): Promise<NativeBridgeStatus> => {
  const request = requestWithOperationId(rawRequest, 'bridge_status');
  return invoke<NativeBridgeStatus>('fluxora_bridge_status', { request });
};

const bridgeCapabilities = (capabilities: NativeBridgeCapabilities): NativeBridgeCapabilities => ({
  ...capabilities,
  supportMatrix: capabilities.supportMatrix?.map((row) => ({
    ...row,
    shellOpenState:
      (row.shellOpenState as string) === legacyShellState ? 'runtime-shell' : row.shellOpenState,
    packageFormats: row.packageFormats.map((format) =>
      format.replace(legacyRuntimePattern, 'Tauri').replace(legacyPackagerPattern, 'Tauri')
    ),
    protocolNotes: row.protocolNotes.replace(legacyRuntimePattern, 'Tauri')
  }))
});

const normalizeStatus = (status: NativeBridgeStatus): NativeBridgeStatus => ({
  ...status,
  capabilities: status.capabilities ? bridgeCapabilities(status.capabilities) : status.capabilities
});

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const createBrowserPreviewInvoker = (): IpcInvoker => ({
  invoke: async (channel: FluxoraIpcChannel, ...args: unknown[]): Promise<unknown> => {
    switch (channel) {
      case FluxoraIpcChannels.appGetInfo:
        return {
          appName: 'Fluxora',
          version: '0.0.0-dev',
          platform: 'win32',
          arch: 'x64',
          isPackaged: false
        } satisfies FluxoraAppInfo;

      case FluxoraIpcChannels.securityGetState:
        return {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          remoteModule: false,
          allowedIpcChannels: Object.values(FluxoraIpcChannels),
          csp: 'browser-preview'
        } satisfies FluxoraSecurityState;

      case FluxoraIpcChannels.bridgeGetStatus: {
        const request = requestWithOperationId(args[0], 'bridge_status');
        return {
          ready: false,
          operationId: operationIdOf(request, 'bridge_status'),
          language: 'en-us',
          theme: 'dark',
          capabilities: {
            platform: 'win32',
            arch: 'x64',
            core: { available: false, libraryName: 'FluxoraCore.dll' },
            features: {}
          },
          error: {
            code: 'runtime.browserPreview',
            message: 'Tauri runtime is unavailable in browser preview.',
            category: 'transport',
            retryable: false,
            capabilityId: null,
            details: {}
          },
          logs: {
            uiLogPath: '',
            mainBridgeLogPath: ''
          }
        } satisfies NativeBridgeStatus;
      }

      case FluxoraIpcChannels.projectsList: {
        const request = requestWithOperationId(args[0], 'projects_list');
        return {
          projects: [],
          buildConfigsDirectory: '',
          defaultInstallRootDirectory: '',
          operationId: operationIdOf(request, 'projects_list')
        } satisfies FluxoraProjectCatalog;
      }

      case FluxoraIpcChannels.templatesList:
        return [] satisfies FluxoraGameTemplate[];

      case FluxoraIpcChannels.uiLog:
      case FluxoraIpcChannels.windowClose:
      case FluxoraIpcChannels.windowMinimize:
      case FluxoraIpcChannels.windowOpenSettings:
      case FluxoraIpcChannels.windowToggleMaximize:
        return undefined;

      case FluxoraIpcChannels.dialogPickArchive:
      case FluxoraIpcChannels.dialogPickBuildConfig:
      case FluxoraIpcChannels.dialogPickExecutable:
      case FluxoraIpcChannels.dialogPickFluxPack:
      case FluxoraIpcChannels.dialogPickFolder:
      case FluxoraIpcChannels.dialogSaveFluxPack:
        return { canceled: true } satisfies DialogPickResult;

      case FluxoraIpcChannels.shellOpenPath:
        return {
          ok: false,
          reason: 'open-failed',
          message: 'Tauri runtime is unavailable in browser preview.'
        } satisfies ShellOpenPathResult;

      case FluxoraIpcChannels.shellShowItemInFolder:
        return {
          ok: false,
          reason: 'show-failed',
          message: 'Tauri runtime is unavailable in browser preview.'
        } satisfies ShellShowItemInFolderResult;

      case FluxoraIpcChannels.transferListDestinationDrives:
        return [] satisfies FluxoraTransferDriveOption[];

      case FluxoraIpcChannels.transferStartMo2InMain:
      case FluxoraIpcChannels.transferOpenMo2InMain:
        return undefined;

      case FluxoraIpcChannels.operationsCancel: {
        const operationId = optionalString(args[0]) || createOperationId('operations_cancel');
        return {
          operationId,
          status: 'unsupported',
          accepted: false
        } satisfies FluxoraOperationCancelResult;
      }

      default:
        throw new Error('Tauri runtime is unavailable in browser preview.');
    }
  },
  on: () => undefined,
  removeListener: () => undefined
});

const createTauriInvoker = (): IpcInvoker => ({
  invoke: async (channel: FluxoraIpcChannel, ...args: unknown[]): Promise<unknown> => {
    switch (channel) {
      case FluxoraIpcChannels.appGetInfo:
        return invoke<FluxoraAppInfo>('fluxora_app_info');

      case FluxoraIpcChannels.securityGetState:
        return invoke<FluxoraSecurityState>('fluxora_security_state', {
          allowedChannels: Object.values(FluxoraIpcChannels)
        });

      case FluxoraIpcChannels.uiLog:
        return invoke('fluxora_log', { entry: args[0] });

      case FluxoraIpcChannels.dialogPickArchive:
        return invoke<DialogPickResult>('fluxora_dialog_pick_file', {
          request: {
            title: 'Import mod archive',
            initialDirectory: optionalString(args[0]) || undefined,
            filters: [
              {
                name: 'Mod archives',
                extensions: ['zip', '7z', 'rar', 'fomod', 'omod', 'ba2', 'bsa']
              },
              { name: 'All files', extensions: ['*'] }
            ]
          }
        });

      case FluxoraIpcChannels.dialogPickBuildConfig:
        return invoke<DialogPickResult>('fluxora_dialog_pick_file', {
          request: {
            title: 'Open Fluxora build config',
            initialDirectory: optionalString(args[0]) || undefined,
            filters: [{ name: 'Fluxora build config', extensions: ['json'] }]
          }
        });

      case FluxoraIpcChannels.dialogPickExecutable:
        return invoke<DialogPickResult>('fluxora_dialog_pick_file', {
          request: {
            title: optionalString(args[0]) || 'Select executable',
            initialDirectory: optionalString(args[1]) || undefined,
            filters: [
              { name: 'Executable', extensions: ['exe'] },
              { name: 'All files', extensions: ['*'] }
            ]
          }
        });

      case FluxoraIpcChannels.dialogPickFluxPack:
        return invoke<DialogPickResult>('fluxora_dialog_pick_file', {
          request: {
            title: 'Open FluxPack',
            initialDirectory: optionalString(args[0]) || undefined,
            filters: [
              { name: 'FluxPack packages', extensions: ['fluxpack'] },
              { name: 'All files', extensions: ['*'] }
            ]
          }
        });

      case FluxoraIpcChannels.dialogPickFolder:
        return invoke<DialogPickResult>('fluxora_dialog_pick_folder', {
          request: {
            title: optionalString(args[0]) || 'Select folder',
            initialPath: optionalString(args[1]) || undefined
          }
        });

      case FluxoraIpcChannels.dialogSaveFluxPack:
        return invoke<DialogSaveResult>('fluxora_dialog_save_file', {
          request: {
            title: optionalString(args[1]) || 'Save FluxPack',
            defaultPath: optionalString(args[0]) || undefined,
            filters: [
              { name: 'FluxPack packages', extensions: ['fluxpack'] },
              { name: 'All files', extensions: ['*'] }
            ]
          }
        });

      case FluxoraIpcChannels.linksOpenExternal:
        return invoke<OpenExternalResult>('fluxora_open_external', {
          url: optionalString(args[0])
        });

      case FluxoraIpcChannels.shellOpenPath:
        return invoke<ShellOpenPathResult>('fluxora_shell_open_path', {
          path: optionalString(args[0])
        });

      case FluxoraIpcChannels.shellShowItemInFolder:
        return invoke<ShellShowItemInFolderResult>('fluxora_shell_show_item_in_folder', {
          path: optionalString(args[0])
        });

      case FluxoraIpcChannels.windowMinimize:
        return invoke('fluxora_window_minimize');

      case FluxoraIpcChannels.windowToggleMaximize:
        return invoke('fluxora_window_toggle_maximize');

      case FluxoraIpcChannels.windowClose:
        return invoke('fluxora_window_close');

      case FluxoraIpcChannels.windowOpenSettings:
        return invoke('fluxora_open_settings_window');

      case FluxoraIpcChannels.transferStartMo2InMain:
        return invoke('fluxora_transfer_start_mo2_in_main', { handoff: args[0] });

      case FluxoraIpcChannels.transferOpenMo2InMain:
        return invoke('fluxora_transfer_open_mo2_in_main');

      case FluxoraIpcChannels.transferListDestinationDrives:
        return invoke<FluxoraTransferDriveOption[]>('fluxora_list_destination_drives');

      case FluxoraIpcChannels.bridgeGetStatus:
        return normalizeStatus(await bridgeStatusWithRuntimeCapabilities(args[0]));

      case FluxoraIpcChannels.bridgeShutdown: {
        const request = requestWithOperationId(args[0], 'bridge_shutdown');
        await invoke('fluxora_shutdown_bridge', { request });
        return { accepted: true, operationId: operationIdOf(request, 'bridge_shutdown') };
      }

      case FluxoraIpcChannels.bridgeGetLanguage:
      case FluxoraIpcChannels.settingsGetTheme:
      case FluxoraIpcChannels.templatesList:
      case FluxoraIpcChannels.nexusGetAuthStatus:
      case FluxoraIpcChannels.nexusConnect:
      case FluxoraIpcChannels.nexusDisconnect: {
        const simpleMap: Partial<Record<FluxoraIpcChannel, [string, string]>> = {
          [FluxoraIpcChannels.bridgeGetLanguage]: ['settings.getLanguage', 'bridge_language_get'],
          [FluxoraIpcChannels.settingsGetTheme]: ['settings.getTheme', 'settings_theme_get'],
          [FluxoraIpcChannels.templatesList]: ['templates.list', 'templates_list'],
          [FluxoraIpcChannels.nexusGetAuthStatus]: ['nexus.getAuthStatus', 'nexus_status'],
          [FluxoraIpcChannels.nexusConnect]: ['nexus.connect', 'nexus_connect'],
          [FluxoraIpcChannels.nexusDisconnect]: ['nexus.disconnect', 'nexus_disconnect']
        };
        const [method, scope] = simpleMap[channel]!;
        const request = requestWithOperationId(args[0], scope);
        const data = await bridgeRequest<Record<string, unknown>>(method, {}, request);
        return channel === FluxoraIpcChannels.templatesList ? data : withOperationId(data, request, scope);
      }

      case FluxoraIpcChannels.bridgeSetLanguage: {
        const request = requestWithOperationId(args[1], 'bridge_language_set');
        const data = await bridgeRequest<Record<string, unknown>>(
          'settings.setLanguage',
          { language: args[0] },
          request
        );
        return withOperationId(data, request, 'bridge_language_set');
      }

      case FluxoraIpcChannels.settingsSetTheme: {
        const request = requestWithOperationId(args[1], 'settings_theme_set');
        const data = await bridgeRequest<Record<string, unknown>>(
          'settings.setTheme',
          { theme: args[0] },
          request
        );
        return withOperationId(data, request, 'settings_theme_set');
      }

      case FluxoraIpcChannels.templatesResolve: {
        const request = requestWithOperationId(args[1], 'templates_resolve');
        return bridgeRequest('templates.resolve', { templateId: args[0] }, request);
      }

      case FluxoraIpcChannels.projectsList: {
        const request = requestWithOperationId(args[0], 'projects_list');
        const paths = await runtimePaths();
        const projects = await bridgeRequest<FluxoraProject[]>(
          'projects.listConfigs',
          { buildConfigsDirectory: paths.buildConfigsDirectory },
          request
        );
        return {
          projects,
          buildConfigsDirectory: paths.buildConfigsDirectory,
          defaultInstallRootDirectory: paths.defaultInstallRootDirectory,
          operationId: operationIdOf(request, 'projects_list')
        } satisfies FluxoraProjectCatalog;
      }

      case FluxoraIpcChannels.projectsOpenConfig: {
        const request = requestWithOperationId(args[1], 'projects_open_config');
        return bridgeRequest('projects.openConfig', { configPath: args[0] }, request);
      }

      case FluxoraIpcChannels.projectsPreviewDirectory: {
        const request = requestWithOperationId(args[2], 'projects_preview_directory');
        const data = await bridgeRequest<Record<string, unknown>>(
          'projects.previewDirectory',
          { projectName: args[0], installRootDirectory: args[1] },
          request
        );
        return withOperationId(data, request, 'projects_preview_directory');
      }

      case FluxoraIpcChannels.projectsCreate: {
        const request = requestWithOperationId(args[1], 'projects_create');
        return bridgeRequest('projects.create', args[0] as Record<string, unknown>, request);
      }

      case FluxoraIpcChannels.projectsRename: {
        const request = requestWithOperationId(args[2], 'projects_rename');
        return bridgeRequest('projects.rename', { configPath: args[0], newName: args[1] }, request);
      }

      case FluxoraIpcChannels.projectsDelete: {
        const request = requestWithOperationId(args[1], 'projects_delete');
        const data = await bridgeRequest<Record<string, unknown>>(
          'projects.delete',
          { configPath: args[0] },
          request
        );
        return withOperationId(data, request, 'projects_delete');
      }

      case FluxoraIpcChannels.buildPathsGet: {
        const request = requestWithOperationId(args[1], 'build_paths_get');
        const data = await bridgeRequest<Record<string, unknown>>(
          'buildPaths.get',
          { configPath: args[0] },
          request
        );
        return withOperationId(data, request, 'build_paths_get');
      }

      case FluxoraIpcChannels.buildPathsSave: {
        const request = requestWithOperationId(args[2], 'build_paths_save');
        const data = await bridgeRequest<Record<string, unknown>>(
          'buildPaths.save',
          { configPath: args[0], settingsJson: JSON.stringify(args[1]) },
          request
        );
        return withOperationId(data, request, 'build_paths_save');
      }

      case FluxoraIpcChannels.fluxPackExport: {
        const request = requestWithOperationId(args[1], 'fluxpack_export');
        const data = await bridgeRequest<Record<string, unknown>>(
          'fluxPack.export',
          args[0] as Record<string, unknown>,
          request
        );
        return withOperationId(data, request, 'fluxpack_export');
      }

      case FluxoraIpcChannels.fluxPackInspect: {
        const request = requestWithOperationId(args[1], 'fluxpack_inspect');
        const data = await bridgeRequest<Record<string, unknown>>(
          'fluxPack.inspect',
          { fluxPackPath: args[0] },
          request
        );
        return withOperationId(data, request, 'fluxpack_inspect');
      }

      case FluxoraIpcChannels.fluxPackInstall: {
        const request = requestWithOperationId(args[1], 'fluxpack_install');
        const data = await bridgeRequest<FluxoraFluxPackInstallResult>(
          'fluxPack.install',
          args[0] as Record<string, unknown>,
          request
        );
        const operationId = operationIdOf(request, 'fluxpack_install');
        return {
          ...data,
          summary: { ...data.summary, operationId },
          operationId
        };
      }

      case FluxoraIpcChannels.modsListInstalled:
        return bridgeRequest('mods.listInstalled', { projectDirectory: args[0] }, requestWithOperationId(args[1], 'mods_list_installed'));
      case FluxoraIpcChannels.modsGetOrder:
        return bridgeRequest('mods.getOrder', { projectDirectory: args[0], profileName: optionalString(args[1]) }, requestWithOperationId(args[2], 'mods_get_order'));
      case FluxoraIpcChannels.modsCreateSeparator:
        return bridgeRequest('mods.createSeparator', { projectDirectory: args[0], profileName: optionalString(args[1]), title: args[2], targetIndex: args[3] }, requestWithOperationId(args[4], 'mods_create_separator'));
      case FluxoraIpcChannels.modsDeleteSeparator:
        return bridgeRequest('mods.deleteSeparator', { projectDirectory: args[0], profileName: optionalString(args[1]), separatorId: args[2] }, requestWithOperationId(args[3], 'mods_delete_separator'));
      case FluxoraIpcChannels.modsMoveOrderItem:
        return bridgeRequest('mods.moveOrderItem', { projectDirectory: args[0], profileName: optionalString(args[1]), orderItemId: args[2], targetIndex: args[3] }, requestWithOperationId(args[4], 'mods_move_order_item'));
      case FluxoraIpcChannels.modsCreateEmpty:
        return bridgeRequest('mods.createEmpty', { projectDirectory: args[0], modName: args[1] }, requestWithOperationId(args[2], 'mods_create_empty'));
      case FluxoraIpcChannels.modsCheckUpdates:
        return bridgeRequest('mods.checkUpdates', { projectDirectory: args[0] }, requestWithOperationId(args[1], 'mods_check_updates'));
      case FluxoraIpcChannels.modsGetFileTree:
        return bridgeRequest('mods.getFileTree', { projectDirectory: args[0], modPath: args[1], relativeDirectory: optionalString(args[2]) }, requestWithOperationId(args[3], 'mods_get_file_tree'));

      case FluxoraIpcChannels.modsDeleteInstalled:
      case FluxoraIpcChannels.modsSetEnabled:
      case FluxoraIpcChannels.modsSetAllEnabled: {
        const mutation =
          channel === FluxoraIpcChannels.modsDeleteInstalled
            ? ['mods.deleteInstalled', { projectDirectory: args[0], modPath: args[1] }, args[2], 'mods_delete_installed']
            : channel === FluxoraIpcChannels.modsSetEnabled
              ? ['mods.setEnabled', { projectDirectory: args[0], modPath: args[1], isEnabled: args[2] }, args[3], 'mods_set_enabled']
              : ['mods.setAllEnabled', { projectDirectory: args[0], isEnabled: args[1] }, args[2], 'mods_set_all_enabled'];
        const request = requestWithOperationId(mutation[2], mutation[3] as string);
        const data = await bridgeRequest<Record<string, unknown>>(
          mutation[0] as string,
          mutation[1] as Record<string, unknown>,
          request
        );
        return withOperationId(data, request, mutation[3] as string);
      }

      case FluxoraIpcChannels.pluginsList:
        return bridgeRequest('plugins.list', { projectDirectory: args[0], templateId: args[1], profileName: optionalString(args[2]) }, requestWithOperationId(args[3], 'plugins_list'));
      case FluxoraIpcChannels.pluginsCreateSeparator:
        return bridgeRequest('plugins.createSeparator', { projectDirectory: args[0], templateId: args[1], profileName: optionalString(args[2]), title: args[3], targetIndex: args[4] }, requestWithOperationId(args[5], 'plugins_create_separator'));
      case FluxoraIpcChannels.pluginsDeleteSeparator:
        return bridgeRequest('plugins.deleteSeparator', { projectDirectory: args[0], templateId: args[1], profileName: optionalString(args[2]), separatorId: args[3] }, requestWithOperationId(args[4], 'plugins_delete_separator'));
      case FluxoraIpcChannels.pluginsMove:
        return bridgeRequest('plugins.move', { projectDirectory: args[0], templateId: args[1], profileName: optionalString(args[2]), orderItemId: args[3], targetIndex: args[4] }, requestWithOperationId(args[5], 'plugins_move'));
      case FluxoraIpcChannels.pluginsSetEnabled:
        return bridgeRequest('plugins.setEnabled', { projectDirectory: args[0], templateId: args[1], profileName: optionalString(args[2]), pluginName: args[3], isEnabled: args[4] }, requestWithOperationId(args[5], 'plugins_set_enabled'));

      case FluxoraIpcChannels.profilesList:
        return bridgeRequest('profiles.list', { projectDirectory: args[0], defaultProfileName: optionalString(args[1]) }, requestWithOperationId(args[2], 'profiles_list'));
      case FluxoraIpcChannels.profilesCreate:
        return bridgeRequest('profiles.create', { projectDirectory: args[0], profileName: args[1], defaultProfileName: optionalString(args[2]), profileFilesJson: JSON.stringify(args[3] ?? []) }, requestWithOperationId(args[4], 'profiles_create'));
      case FluxoraIpcChannels.profilesClone:
        return bridgeRequest('profiles.clone', { projectDirectory: args[0], sourceProfileName: args[1], targetProfileName: args[2], defaultProfileName: optionalString(args[3]) }, requestWithOperationId(args[4], 'profiles_clone'));
      case FluxoraIpcChannels.profilesRename:
        return bridgeRequest('profiles.rename', { projectDirectory: args[0], sourceProfileName: args[1], targetProfileName: args[2], defaultProfileName: optionalString(args[3]) }, requestWithOperationId(args[4], 'profiles_rename'));
      case FluxoraIpcChannels.profilesDelete:
        return bridgeRequest('profiles.delete', { projectDirectory: args[0], profileName: args[1], defaultProfileName: optionalString(args[2]) }, requestWithOperationId(args[3], 'profiles_delete'));

      case FluxoraIpcChannels.executablesList:
        return bridgeRequest('executables.list', { configPath: args[0] }, requestWithOperationId(args[1], 'executables_list'));
      case FluxoraIpcChannels.executablesSave:
        return bridgeRequest('executables.save', { configPath: args[0], executablesJson: JSON.stringify(args[1]) }, requestWithOperationId(args[2], 'executables_save'));
      case FluxoraIpcChannels.executablesGetIcon: {
        const request = requestWithOperationId(args[1], 'executables_icon');
        const data = await bridgeRequest<Record<string, unknown>>('executables.getIcon', { executablePath: args[0] }, request);
        return withOperationId(data, request, 'executables_icon');
      }
      case FluxoraIpcChannels.executablesLaunch: {
        const request = requestWithOperationId(args[3], 'executables_launch');
        const data = await bridgeRequest<Record<string, unknown>>(
          'executables.launch',
          { configPath: args[0], executableId: args[1], profileName: optionalString(args[2]) },
          request
        );
        return withOperationId(data, request, 'executables_launch');
      }

      case FluxoraIpcChannels.transferAnalyzeMo2: {
        const request = requestWithOperationId(args[3], 'transfer_analyze_mo2');
        const data = await bridgeRequest<Record<string, unknown>>(
          'transfer.analyzeMo2',
          { sourceDirectory: args[0], destinationRootDirectory: args[1], existingConfigPath: optionalString(args[2]) },
          request
        );
        return withOperationId(data, request, 'transfer_analyze_mo2');
      }
      case FluxoraIpcChannels.transferImportMo2:
        return bridgeRequest(
          'transfer.importMo2',
          args[0] as Record<string, unknown>,
          requestWithOperationId(args[1], 'transfer_import_mo2'),
          transferImportTimeoutMs
        );
      case FluxoraIpcChannels.operationsCancel: {
        const request = requestWithOperationId(args[1], 'operations_cancel');
        const targetOperationId = optionalString(args[0]);
        const data = await bridgeRequest<Record<string, unknown>>('operations.cancel', { operationId: targetOperationId }, request);
        return { ...data, operationId: targetOperationId };
      }

      case FluxoraIpcChannels.nxmRegisterProtocol: {
        const request = requestWithOperationId(args[0], 'nxm_register_protocol');
        const appInfo = await invoke<FluxoraAppInfo>('fluxora_app_info');
        const executablePath = await invoke<string>('fluxora_current_executable');
        if (appInfo.platform !== 'win32') {
          return {
            registered: true,
            platform: appInfo.platform,
            state: 'limited',
            message: appInfo.platform === 'darwin'
              ? 'macOS NXM handling requires app bundle URL scheme metadata during packaging.'
              : 'Linux NXM handling requires .desktop and xdg registration during packaging.',
            operationId: operationIdOf(request, 'nxm_register_protocol')
          } satisfies FluxoraNxmProtocolResult;
        }
        const reply = await bridgeRequest<{ isRegistered: boolean }>(
          'nxm.registerProtocol',
          { executablePath },
          request
        );
        return {
          registered: reply.isRegistered,
          isRegistered: reply.isRegistered,
          platform: appInfo.platform,
          state: reply.isRegistered ? 'available' : 'limited',
          message: reply.isRegistered
            ? 'Fluxora is registered for NXM Mod Manager links.'
            : 'The OS registration request completed, but Windows registry verification did not confirm Fluxora as handler.',
          operationId: operationIdOf(request, 'nxm_register_protocol')
        } satisfies FluxoraNxmProtocolResult;
      }
      case FluxoraIpcChannels.nxmCaptureLinks:
        return bridgeRequest('nxm.captureLinks', { projectDirectory: optionalString(args[0]), links: args[1] }, requestWithOperationId(args[2], 'nxm_capture_links'));
      case FluxoraIpcChannels.nxmImportInboundDownloads:
        return bridgeRequest('nxm.importInboundDownloads', { projectDirectory: args[0] }, requestWithOperationId(args[1], 'nxm_import_inbound'));

      case FluxoraIpcChannels.downloadsList:
        return bridgeRequest('downloads.list', { projectDirectory: args[0] }, requestWithOperationId(args[1], 'downloads_list'));
      case FluxoraIpcChannels.downloadsImportFile:
        return bridgeRequest('downloads.importFile', { projectDirectory: args[0], sourcePath: args[1] }, requestWithOperationId(args[2], 'downloads_import_file'));
      case FluxoraIpcChannels.downloadsResume:
        return bridgeRequest('downloads.resume', { projectDirectory: args[0], downloadPath: args[1] }, requestWithOperationId(args[2], 'downloads_resume'));
      case FluxoraIpcChannels.downloadsAnalyzeFomod:
        return bridgeRequest('downloads.analyzeFomod', { projectDirectory: args[0], downloadPath: args[1] }, requestWithOperationId(args[2], 'downloads_analyze_fomod'));
      case FluxoraIpcChannels.downloadsAnalyzeContentLayout:
      case FluxoraIpcChannels.downloadsAnalyzeFomodContentLayout: {
        const analyze = (args[0] ?? {}) as Record<string, unknown>;
        const request = requestWithOperationId(args[1], channel === FluxoraIpcChannels.downloadsAnalyzeContentLayout ? 'downloads_analyze_layout' : 'downloads_analyze_fomod_layout');
        const params: Record<string, unknown> = {
          projectDirectory: analyze.projectDirectory,
          downloadPath: analyze.downloadPath,
          existingModMode: analyze.existingModMode ?? 0
        };
        if (channel === FluxoraIpcChannels.downloadsAnalyzeFomodContentLayout) {
          params.selectedOptionIdsJson = JSON.stringify(analyze.selectedOptionIds ?? []);
        }
        return bridgeRequest(
          channel === FluxoraIpcChannels.downloadsAnalyzeContentLayout ? 'downloads.analyzeContentLayout' : 'downloads.analyzeFomodContentLayout',
          params,
          request
        );
      }
      case FluxoraIpcChannels.downloadsDelete:
      case FluxoraIpcChannels.downloadsCancel: {
        const scope = channel === FluxoraIpcChannels.downloadsDelete ? 'downloads_delete' : 'downloads_cancel';
        const request = requestWithOperationId(args[2], scope);
        const data = await bridgeRequest<Record<string, unknown>>(
          channel === FluxoraIpcChannels.downloadsDelete ? 'downloads.delete' : 'downloads.cancel',
          { projectDirectory: args[0], downloadPath: args[1] },
          request
        );
        return withOperationId(data, request, scope);
      }
      case FluxoraIpcChannels.downloadsInstall:
      case FluxoraIpcChannels.downloadsInstallFomod:
      case FluxoraIpcChannels.archivesInstall:
      case FluxoraIpcChannels.archivesInstallFomod: {
        const install = (args[0] ?? {}) as Record<string, unknown>;
        const isFomod = channel === FluxoraIpcChannels.downloadsInstallFomod || channel === FluxoraIpcChannels.archivesInstallFomod;
        const isArchive = channel === FluxoraIpcChannels.archivesInstall || channel === FluxoraIpcChannels.archivesInstallFomod;
        const scope = isArchive
          ? isFomod ? 'archives_install_fomod' : 'archives_install'
          : isFomod ? 'downloads_install_fomod' : 'downloads_install';
        const request = requestWithOperationId(args[1], scope);
        const params: Record<string, unknown> = {
          ...install,
          existingModMode: install.existingModMode ?? 0,
          placementOverridesJson: optionalString(install.placementOverridesJson)
        };
        if (isFomod) {
          params.selectedOptionIdsJson = JSON.stringify(install.selectedOptionIds ?? []);
          delete params.selectedOptionIds;
        }
        const method = isArchive
          ? isFomod ? 'archives.installFomod' : 'archives.install'
          : isFomod ? 'downloads.installFomod' : 'downloads.install';
        const data = await bridgeRequest<Record<string, unknown>>(method, params, request);
        return withOperationId(data, request, scope);
      }

      default:
        throw new Error(`Unsupported Fluxora API channel: ${channel}`);
    }
  },
  on: (channel: FluxoraIpcChannel, listener: (...args: unknown[]) => void) => {
    const key = `${channel}:${eventUnlisteners.size}`;
    const unlisten = listen(channel, (event) => {
      listener(undefined, event.payload);
    });
    eventUnlisteners.set(key, unlisten);
    Object.defineProperty(listener, '__fluxoraTauriEventKey', {
      value: key,
      configurable: true
    });
  },
  removeListener: (_channel: FluxoraIpcChannel, listener: (...args: unknown[]) => void) => {
    const key = (listener as { __fluxoraTauriEventKey?: string }).__fluxoraTauriEventKey;
    if (!key) {
      return;
    }
    const unlisten = eventUnlisteners.get(key);
    eventUnlisteners.delete(key);
    void unlisten?.then((dispose) => dispose());
  }
});

export const createTauriFluxoraApi = (): FluxoraApi =>
  createFluxoraApi(isTauriRuntime() ? createTauriInvoker() : createBrowserPreviewInvoker());
