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
