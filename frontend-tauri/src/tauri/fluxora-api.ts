import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview, type DragDropEvent as TauriDragDropEvent } from '@tauri-apps/api/webview';

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
  FluxoraFileDropEvent,
  FluxoraLaunchProcessWatchRequest,
  FluxoraIpcChannel,
  FluxoraGameTemplate,
  FluxoraAnalyzeContentLayoutRequest,
  FluxoraAnalyzeFomodContentLayoutRequest,
  FluxoraAiCancelRunResult,
  FluxoraAiChatRequest,
  FluxoraAiChatResponse,
  FluxoraAiContextUsage,
  FluxoraAiHostStatus,
  FluxoraAiIntermediateEvent,
  FluxoraAiModelCapability,
  FluxoraAiProviderConnectionResult,
  FluxoraAiProviderDescriptor,
  FluxoraAiProviderTestResult,
  FluxoraApiLimitStatus,
  FluxoraBuildContentChangedEvent,
  FluxoraBuildContentWatchRequest,
  FluxoraBuildContentWatchResult,
  FluxoraContentLayoutPreview,
  FluxoraFomodInstaller,
  FluxoraFomodManualDecision,
  FluxoraDownloadsFolderChangedEvent,
  FluxoraDownloadsFolderWatchResult,
  FluxoraFluxPackExportRequest,
  FluxoraGrassCacheGenerationRequest,
  FluxoraGrassCacheGenerationResult,
  FluxoraFluxPackInstallRequest,
  FluxoraFluxPackInstallResult,
  FluxoraFluxPackInstallPlan,
  FluxoraFluxPackInstallPlanRequest,
  FluxoraFluxPackSummary,
  FluxoraInstallArchiveRequest,
  FluxoraInstallDownloadRequest,
  FluxoraInstallFomodArchiveRequest,
  FluxoraInstallFomodDownloadRequest,
  FluxoraInstallPlan,
  FluxoraInstallConflictSnapshot,
  FluxoraInstalledModSummary,
  FluxoraInstalledMod,
  FluxoraModOrganizerImportAnalysis,
  FluxoraMo2TransferHandoff,
  FluxoraModOrganizerImportRequest,
  FluxoraTransferDriveOption,
  FluxoraEffectiveFileTreePage,
  FluxoraEffectiveFileTreeSnapshot,
  FluxoraModConflictTreePage,
  FluxoraModDetailsBootstrap,
  FluxoraModDetailsContent,
  FluxoraModFileTreeEntry,
  FluxoraModFileCacheInvalidationResult,
  FluxoraModMutationResult,
  FluxoraModUpdateCheckRequest,
  FluxoraModUpdateCheckResult,
  FluxoraModOrderItem,
  FluxoraModWorkspaceSnapshot,
  FluxoraNifPreviewAssetHandle,
  FluxoraNifPreviewStartResult,
  FluxoraNifPreviewTextureBatchResult,
  FluxoraNxmInboundLinksCaptured,
  FluxoraNxmProtocolResult,
  FluxoraNexusModsAuthStatus,
  FluxoraOperationCancelResult,
  FluxoraOperationLogEntry,
  FluxoraOperationProgress,
  FluxoraOperationsStatus,
  FluxoraProcessWatchResult,
  FluxoraPluginOrderItem,
  FluxoraProject,
  FluxoraProjectCatalog,
  FluxoraProjectDirectoryPreview,
  FluxoraRecentOperationLogs,
  FluxoraWorkspaceIndexWarmupResult,
  NativeBridgeLanguageResult,
  NativeBridgeCapabilities,
  NativeBridgeError,
  NativeBridgeInvokeError,
  NativeBridgeThemeResult,
  NativeBridgeStatus,
  OperationRequest,
  FluxoraSecurityState,
  FluxoraThemeMode,
  OpenExternalResult,
  ShellOpenPathResult,
  ShellShowItemInFolderResult,
  FluxoraTextFileDocument,
  FluxoraTextFilePreview,
  FluxoraTextFileSaveResult,
  UiLogEntry
} from '../shared/fluxora-api';
import {
  AI_SAFE_ACTION_CATALOG,
  AI_SAFE_ACTION_CATALOG_CAPABILITY
} from '../shared/ai-safe-action-catalog';
import { createFluxoraAiTaskPlanningBundle } from '../shared/ai-task-planner';
import { createModdingflowPublicApiDogfoodClient } from '../shared/moddingflow-public-api-dogfood';
import {
  FLUXORA_SKILL_CATALOG,
  FLUXORA_SKILL_CATALOG_CAPABILITY
} from '../shared/ai-skills';
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

const toArrayBuffer = (value: unknown): ArrayBuffer => {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) {
    if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
      return value.buffer;
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
  }
  if (
    Array.isArray(value)
    && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0xff)
  ) {
    return Uint8Array.from(value).buffer;
  }
  throw new Error('NIF preview returned invalid binary asset data.');
};

const toFomodPreviewImageUrl = (imagePath: string): string => {
  const normalizedPath = imagePath.trim();
  if (!normalizedPath || /^(?:asset|blob|data|https?):/i.test(normalizedPath)) {
    return normalizedPath;
  }

  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
    ? convertFileSrc(normalizedPath)
    : normalizedPath;
};

const fluxPackExportRequestParams = (rawRequest: unknown): Record<string, unknown> => {
  const request =
    rawRequest && typeof rawRequest === 'object'
      ? (rawRequest as Partial<Record<keyof FluxoraFluxPackExportRequest, unknown>>)
      : {};
  const stringParam = (value: unknown): string => (typeof value === 'string' ? value : '');
  const packageType = request.packageType === 'full' ? 'full' : 'recipe';

  return {
    configPath: stringParam(request.configPath),
    outputPath: stringParam(request.outputPath),
    includeGeneratedAssets: request.includeGeneratedAssets === true,
    packageType
  };
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
  apiLimits: {
    list: (request?: OperationRequest) =>
      invokeTyped<FluxoraApiLimitStatus>(ipc, FluxoraIpcChannels.apiLimitsList, request)
  },
  publicApi: createModdingflowPublicApiDogfoodClient(),
  ai: {
    cancelRun: (operationId: string, request?: OperationRequest) =>
      invokeTyped<FluxoraAiCancelRunResult>(
        ipc,
        FluxoraIpcChannels.aiCancelRun,
        operationId,
        request
      ),
    chatRespond: (request: FluxoraAiChatRequest) =>
      invokeTyped<FluxoraAiChatResponse>(ipc, FluxoraIpcChannels.aiChatRespond, request),
    estimateContext: (request: FluxoraAiChatRequest) =>
      invokeTyped<FluxoraAiContextUsage>(ipc, FluxoraIpcChannels.aiEstimateContext, request),
    getStatus: (request?: OperationRequest) =>
      invokeTyped<FluxoraAiHostStatus>(ipc, FluxoraIpcChannels.aiGetStatus, request),
    restartHost: (request?: OperationRequest) =>
      invokeTyped<FluxoraAiHostStatus>(ipc, FluxoraIpcChannels.aiRestartHost, request),
    onRunEvent: (callback: (event: FluxoraAiIntermediateEvent) => void) =>
      listenTyped<FluxoraAiIntermediateEvent>(ipc, FluxoraIpcChannels.aiRunEvent, callback),
    listSafeActions: async () => AI_SAFE_ACTION_CATALOG,
    listSkills: async () => FLUXORA_SKILL_CATALOG,
    listProviders: (request?: OperationRequest) =>
      invokeTyped<FluxoraAiProviderDescriptor[]>(
        ipc,
        FluxoraIpcChannels.aiListProviders,
        request
      ),
    listModels: (request?: OperationRequest) =>
      invokeTyped<FluxoraAiModelCapability[]>(ipc, FluxoraIpcChannels.aiListModels, request),
    connectProvider: (providerId: string, apiKey: string, request?: OperationRequest) =>
      invokeTyped<FluxoraAiProviderConnectionResult>(
        ipc,
        FluxoraIpcChannels.aiConnectProvider,
        providerId,
        apiKey,
        request
      ),
    disconnectProvider: (providerId: string, request?: OperationRequest) =>
      invokeTyped<FluxoraAiProviderConnectionResult>(
        ipc,
        FluxoraIpcChannels.aiDisconnectProvider,
        providerId,
        request
      ),
    testProvider: (providerId: string, request?: OperationRequest) =>
      invokeTyped<FluxoraAiProviderTestResult>(
        ipc,
        FluxoraIpcChannels.aiTestProvider,
        providerId,
        request
      )
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
    pickTextFile: (initialDirectory?: string) =>
      invokeTyped<DialogPickResult>(
        ipc,
        FluxoraIpcChannels.dialogPickTextFile,
        initialDirectory
      ),
    saveFluxPack: (defaultPath?: string, title?: string) =>
      invokeTyped<DialogSaveResult>(
        ipc,
        FluxoraIpcChannels.dialogSaveFluxPack,
        defaultPath,
        title
      ),
    saveTextFile: (defaultPath?: string, title?: string) =>
      invokeTyped<DialogSaveResult>(
        ipc,
        FluxoraIpcChannels.dialogSaveTextFile,
        defaultPath,
        title
      )
  },
  fileDrop: {
    onDragDrop: (callback: (event: FluxoraFileDropEvent) => void) => listenToFileDrop(callback)
  },
  build: {
    prepareWorkspaceIndexes: (
      projectDirectory: string,
      profileName?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraWorkspaceIndexWarmupResult>(
        ipc,
        FluxoraIpcChannels.buildPrepareWorkspaceIndexes,
        projectDirectory,
        profileName,
        request
      )
  },
  buildContent: {
    watch: (watchRequest: FluxoraBuildContentWatchRequest, request?: OperationRequest) =>
      invokeTyped<FluxoraBuildContentWatchResult>(
        ipc,
        FluxoraIpcChannels.buildContentWatch,
        watchRequest,
        request
      ),
    unwatch: (request?: OperationRequest) =>
      invokeTyped<FluxoraBuildContentWatchResult>(
        ipc,
        FluxoraIpcChannels.buildContentUnwatch,
        request
      ),
    onChanged: (callback: (event: FluxoraBuildContentChangedEvent) => void) =>
      listenTyped<FluxoraBuildContentChangedEvent>(
        ipc,
        FluxoraIpcChannels.buildContentChanged,
        callback
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
    getWorkspace: (
      projectDirectory: string,
      profileName?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModWorkspaceSnapshot>(
        ipc,
        FluxoraIpcChannels.modsGetWorkspace,
        projectDirectory,
        profileName,
        request
      ),
    getPersistedWorkspace: (
      projectDirectory: string,
      profileName?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModWorkspaceSnapshot>(
        ipc,
        FluxoraIpcChannels.modsGetPersistedWorkspace,
        projectDirectory,
        profileName,
        request
      ),
    invalidateFileCaches: (
      projectDirectory: string,
      changedPaths: string[],
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModFileCacheInvalidationResult>(
        ipc,
        FluxoraIpcChannels.modsInvalidateFileCaches,
        projectDirectory,
        changedPaths,
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
    rebasePendingInstall: (
      projectDirectory: string,
      operationId: string,
      targetIndex: number,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraInstallConflictSnapshot>(
        ipc,
        FluxoraIpcChannels.modsRebasePendingInstall,
        projectDirectory,
        operationId,
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
    checkUpdates: (updateRequest: FluxoraModUpdateCheckRequest, request?: OperationRequest) =>
      invokeTyped<FluxoraModUpdateCheckResult>(
        ipc,
        FluxoraIpcChannels.modsCheckUpdates,
        updateRequest,
        request
      ),
    clearOverwrite: (projectDirectory: string, request?: OperationRequest) =>
      invokeTyped<FluxoraModMutationResult>(
        ipc,
        FluxoraIpcChannels.modsClearOverwrite,
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
      ),
    getModDetailsContent: (
      projectDirectory: string,
      modPath: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModDetailsContent>(
        ipc,
        FluxoraIpcChannels.modsGetModDetailsContent,
        projectDirectory,
        modPath,
        request
      ),
    getModConflictTree: (
      projectDirectory: string,
      modPath: string,
      cursor?: string,
      limit?: number,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModConflictTreePage>(
        ipc,
        FluxoraIpcChannels.modsGetModConflictTree,
        projectDirectory,
        modPath,
        cursor,
        limit,
        request
      ),
    getModDetailsSummary: (
      projectDirectory: string,
      profileName: string | undefined,
      modPath: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraModOrderItem>(
        ipc,
        FluxoraIpcChannels.modsGetModDetailsSummary,
        projectDirectory,
        profileName,
        modPath,
        request
      ),
    getEffectiveFileTree: (
      projectDirectory: string,
      profileName?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraEffectiveFileTreeSnapshot>(
        ipc,
        FluxoraIpcChannels.modsGetEffectiveFileTree,
        projectDirectory,
        profileName,
        request
      ),
    getEffectiveFileTreeRoot: (
      projectDirectory: string,
      profileName?: string,
      limit?: number,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraEffectiveFileTreePage>(
        ipc,
        FluxoraIpcChannels.modsGetEffectiveFileTreeRoot,
        projectDirectory,
        profileName,
        limit,
        request
      ),
    getEffectiveFileTreeChildren: (
      projectDirectory: string,
      profileName: string | undefined,
      revision: string,
      relativeDirectory: string,
      cursor?: string,
      limit?: number,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraEffectiveFileTreePage>(
        ipc,
        FluxoraIpcChannels.modsGetEffectiveFileTreeChildren,
        projectDirectory,
        profileName,
        revision,
        relativeDirectory,
        cursor,
        limit,
        request
      ),
    startNifPreview: (
      projectDirectory: string,
      profileName: string,
      initialModPath: string,
      relativePath: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraNifPreviewStartResult>(
        ipc,
        FluxoraIpcChannels.modsStartNifPreview,
        projectDirectory,
        profileName,
        initialModPath,
        relativePath,
        request
      ),
    prepareNifPreviewVariant: (sessionId: string, variantId: string) =>
      invokeTyped<FluxoraNifPreviewAssetHandle>(
        ipc,
        FluxoraIpcChannels.modsPrepareNifPreviewVariant,
        sessionId,
        variantId
      ),
    prepareNifPreviewTextures: (sessionId: string, texturePaths: string[]) =>
      invokeTyped<FluxoraNifPreviewTextureBatchResult>(
        ipc,
        FluxoraIpcChannels.modsPrepareNifPreviewTextures,
        sessionId,
        texturePaths
      ),
    readNifPreviewAssetBytes: (sessionId: string, assetId: string) =>
      invokeTyped<unknown>(
        ipc,
        FluxoraIpcChannels.modsReadNifPreviewAssetBytes,
        sessionId,
        assetId
      ).then(toArrayBuffer),
    endNifPreview: (sessionId: string) =>
      invokeTyped<void>(ipc, FluxoraIpcChannels.modsEndNifPreview, sessionId),
    readTextFile: (
      projectDirectory: string,
      modPath: string,
      relativePath: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraTextFileDocument>(
        ipc,
        FluxoraIpcChannels.modsReadTextFile,
        projectDirectory,
        modPath,
        relativePath,
        request
      ),
    previewTextFile: (
      projectDirectory: string,
      modPath: string,
      relativePath: string,
      maxBytes: number,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraTextFilePreview>(
        ipc,
        FluxoraIpcChannels.modsPreviewTextFile,
        projectDirectory,
        modPath,
        relativePath,
        maxBytes,
        request
      ),
    saveTextFile: (
      projectDirectory: string,
      modPath: string,
      relativePath: string,
      content: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraTextFileSaveResult>(
        ipc,
        FluxoraIpcChannels.modsSaveTextFile,
        projectDirectory,
        modPath,
        relativePath,
        content,
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
    listPersisted: (
      projectDirectory: string,
      templateId: string,
      profileName?: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraPluginOrderItem[]>(
        ipc,
        FluxoraIpcChannels.pluginsListPersisted,
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
      ),
    setAllEnabled: (
      projectDirectory: string,
      templateId: string,
      profileName: string | undefined,
      isEnabled: boolean,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraPluginOrderItem[]>(
        ipc,
        FluxoraIpcChannels.pluginsSetAllEnabled,
        projectDirectory,
        templateId,
        profileName,
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
    previewTextFile: (
      projectDirectory: string,
      profileName: string,
      fileName: string,
      maxBytes: number,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraTextFilePreview>(
        ipc,
        FluxoraIpcChannels.profilesPreviewTextFile,
        projectDirectory,
        profileName,
        fileName,
        maxBytes,
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
  processes: {
    waitForLaunchReady: (
      launch: FluxoraLaunchProcessWatchRequest,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraProcessWatchResult>(
        ipc,
        FluxoraIpcChannels.processesWatchLaunchReady,
        launch,
        request
      ),
    waitForExit: (processId: number, request?: OperationRequest) =>
      invokeTyped<FluxoraProcessWatchResult>(
        ipc,
        FluxoraIpcChannels.processesWaitForExit,
        processId,
        request
      )
  },
  downloads: {
    toFomodPreviewImageUrl,
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
    watchFolder: (
      projectDirectory: string,
      downloadsDirectory: string,
      request?: OperationRequest
    ) =>
      invokeTyped<FluxoraDownloadsFolderWatchResult>(
        ipc,
        FluxoraIpcChannels.downloadsWatchFolder,
        projectDirectory,
        downloadsDirectory,
        request
      ),
    unwatchFolder: (request?: OperationRequest) =>
      invokeTyped<FluxoraDownloadsFolderWatchResult>(
        ipc,
        FluxoraIpcChannels.downloadsUnwatchFolder,
        request
      ),
    onFolderChanged: (callback: (event: FluxoraDownloadsFolderChangedEvent) => void) =>
      listenTyped<FluxoraDownloadsFolderChangedEvent>(
        ipc,
        FluxoraIpcChannels.downloadsFolderChanged,
        callback
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
      profileNameOrOperation?: string | OperationRequest,
      manualDecisions: FluxoraFomodManualDecision[] = [],
      operation?: OperationRequest
    ) =>
      invokeTyped<FluxoraFomodInstaller>(
        ipc,
        FluxoraIpcChannels.downloadsAnalyzeFomod,
        projectDirectory,
        downloadPath,
        profileNameOrOperation,
        manualDecisions,
        operation
      ),
    planInstall: (
      projectDirectory: string,
      downloadPath: string,
      profileNameOrOperation?: string | OperationRequest,
      modNameOrOperation?: string | OperationRequest,
      operation?: OperationRequest
    ) =>
      invokeTyped<FluxoraInstallPlan>(
        ipc,
        FluxoraIpcChannels.downloadsPlanInstall,
        projectDirectory,
        downloadPath,
        profileNameOrOperation,
        modNameOrOperation,
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
    planInstall: (
      projectDirectory: string,
      archivePath: string,
      profileNameOrOperation?: string | OperationRequest,
      modNameOrOperation?: string | OperationRequest,
      operation?: OperationRequest
    ) =>
      invokeTyped<FluxoraInstallPlan>(
        ipc,
        FluxoraIpcChannels.archivesPlanInstall,
        projectDirectory,
        archivePath,
        profileNameOrOperation,
        modNameOrOperation,
        operation
      ),
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
      ),
    onInboundLinksCaptured: (callback: (event: FluxoraNxmInboundLinksCaptured) => void) =>
      listenTyped<FluxoraNxmInboundLinksCaptured>(
        ipc,
        FluxoraIpcChannels.nxmInboundLinksCaptured,
        callback
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
    connectWithApiKey: (apiKey: string, request?: OperationRequest) =>
      invokeTyped<FluxoraNexusModsAuthStatus>(
        ipc,
        FluxoraIpcChannels.nexusConnectWithApiKey,
        apiKey,
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
  buildSettings: {
    notifyPathsSaved: (project: FluxoraProject) =>
      invokeTyped<void>(ipc, FluxoraIpcChannels.buildSettingsNotifyPathsSaved, project),
    onPathsSaved: (callback: (project: FluxoraProject) => void) =>
      listenTyped<FluxoraProject>(
        ipc,
        FluxoraIpcChannels.buildSettingsPathsSaved,
        callback
      )
  },
  fluxPack: {
    export: (request: FluxoraFluxPackExportRequest, operation?: OperationRequest) =>
      invokeTyped<FluxoraFluxPackSummary>(
        ipc,
        FluxoraIpcChannels.fluxPackExport,
        fluxPackExportRequestParams(request),
        operation
      ),
    inspect: (fluxPackPath: string, request?: OperationRequest) =>
      invokeTyped<FluxoraFluxPackSummary>(
        ipc,
        FluxoraIpcChannels.fluxPackInspect,
        fluxPackPath,
        request
      ),
    planInstall: (
      request: FluxoraFluxPackInstallPlanRequest,
      operation?: OperationRequest
    ) =>
      invokeTyped<FluxoraFluxPackInstallPlan>(
        ipc,
        FluxoraIpcChannels.fluxPackPlanInstall,
        request,
        operation
      ),
    install: (request: FluxoraFluxPackInstallRequest, operation?: OperationRequest) =>
      invokeTyped<FluxoraFluxPackInstallResult>(
        ipc,
        FluxoraIpcChannels.fluxPackInstall,
        request,
        operation
      )
  },
  grassCache: {
    generate: (request: FluxoraGrassCacheGenerationRequest, operation?: OperationRequest) =>
      invokeTyped<FluxoraGrassCacheGenerationResult>(
        ipc,
        FluxoraIpcChannels.grassCacheGenerate,
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
    getStatus: (request?: OperationRequest) =>
      invokeTyped<FluxoraOperationsStatus>(
        ipc,
        FluxoraIpcChannels.operationsGetStatus,
        request
      ),
    recentLogs: (options = {}, request?: OperationRequest) =>
      invokeTyped<FluxoraRecentOperationLogs>(
        ipc,
        FluxoraIpcChannels.operationsRecentLogs,
        options,
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
  textFiles: {
    read: (path: string, request?: OperationRequest) =>
      invokeTyped<FluxoraTextFileDocument>(
        ipc,
        FluxoraIpcChannels.textFilesRead,
        path,
        request
      ),
    save: (path: string, content: string, request?: OperationRequest) =>
      invokeTyped<FluxoraTextFileSaveResult>(
        ipc,
        FluxoraIpcChannels.textFilesSave,
        path,
        content,
        request
      )
  },
  ui: {
    log: (entry: UiLogEntry) => invokeTyped<void>(ipc, FluxoraIpcChannels.uiLog, entry)
  },
  windowControls: {
    close: () => invokeTyped<void>(ipc, FluxoraIpcChannels.windowClose),
    minimize: () => invokeTyped<void>(ipc, FluxoraIpcChannels.windowMinimize),
    openBuildSettings: (configPath: string, buildName: string) =>
      invokeTyped<void>(
        ipc,
        FluxoraIpcChannels.windowOpenBuildSettings,
        configPath,
        buildName
      ),
    openModDetails: (
      configPath: string,
      modPath: string,
      modName: string,
      profileName?: string,
      bootstrapKey?: string,
      bootstrap?: FluxoraModDetailsBootstrap
    ) =>
      invokeTyped<void>(
        ipc,
        FluxoraIpcChannels.windowOpenModDetails,
        configPath,
        modPath,
        modName,
        profileName,
        bootstrapKey,
        bootstrap
      ),
    openFilePreview: (
      configPath: string,
      projectDirectory: string,
      modPath: string,
      relativePath: string,
      fileName: string,
      profileName: string,
      kind: string
    ) =>
      invokeTyped<void>(
        ipc,
        FluxoraIpcChannels.windowOpenFilePreview,
        configPath,
        projectDirectory,
        modPath,
        relativePath,
        fileName,
        profileName,
        kind
      ),
    openSettings: () => invokeTyped<void>(ipc, FluxoraIpcChannels.windowOpenSettings),
    openTextEditor: (
      configPath: string,
      projectDirectory: string,
      modPath?: string,
      relativePath?: string,
      fileName?: string
    ) =>
      invokeTyped<void>(
        ipc,
        FluxoraIpcChannels.windowOpenTextEditor,
        configPath,
        projectDirectory,
        modPath,
        relativePath,
        fileName
      ),
    toggleMaximize: () => invokeTyped<void>(ipc, FluxoraIpcChannels.windowToggleMaximize)
  }
});

interface RuntimePaths {
  buildConfigsDirectory: string;
  defaultInstallRootDirectory: string;
}

type EventUnlisten = () => void;

const eventUnlisteners = new Map<number, Promise<EventUnlisten>>();
let nextEventListenerToken = 1;
const legacyShellState = ['elec', 'tron-main'].join('');
const legacyRuntimePattern = new RegExp(['Elec', 'tron'].join(''), 'gi');
const legacyPackagerPattern = new RegExp(['Fo', 'rge'].join(''), 'gi');
const projectsListTimeoutMs = 30_000;
const projectOpenConfigTimeoutMs = 60_000;
const modsWorkspaceTimeoutMs = 60_000;
const executablesListTimeoutMs = 30_000;
const executablesLaunchTimeoutMs = 2 * 60 * 1000;
const effectiveFileTreeIndexTimeoutMs = 2 * 60 * 1000;
const fileMutationTimeoutMs = 2 * 60 * 60 * 1000;
const transferImportTimeoutMs = 2 * 60 * 60 * 1000;
const grassCacheGenerationTimeoutMs = 6 * 60 * 60 * 1000;
const nexusDownloadTimeoutMs = 6 * 60 * 60 * 1000;
const nexusOAuthTimeoutMs = 180_000;

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

export const FLUXORA_BRIDGE_ERROR_SCHEMA = 'fluxora.tauri.bridge-error.v1' as const;

const nativeBridgeErrorCategories = new Set<NativeBridgeError['category']>([
  'validation',
  'core',
  'capability',
  'notFound',
  'conflict',
  'cancelled',
  'transport',
  'internal'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class FluxoraBridgeError extends Error implements NativeBridgeInvokeError {
  readonly schema = FLUXORA_BRIDGE_ERROR_SCHEMA;
  readonly code: string;
  readonly category: NativeBridgeError['category'];
  readonly retryable: boolean;
  readonly capabilityId: string | null;
  readonly details: Record<string, unknown>;
  readonly method: string;
  readonly operationId: string;

  constructor(error: NativeBridgeInvokeError) {
    super(error.message);
    this.name = 'FluxoraBridgeError';
    this.code = error.code;
    this.category = error.category;
    this.retryable = error.retryable;
    this.capabilityId = error.capabilityId ?? null;
    this.details = error.details ?? {};
    this.method = error.method;
    this.operationId = error.operationId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const rejectedErrorText = (rejection: unknown): string => {
  if (typeof rejection === 'string') {
    return rejection;
  }
  if (rejection instanceof Error) {
    return rejection.message;
  }
  if (isRecord(rejection) && typeof rejection.message === 'string') {
    return rejection.message;
  }
  return '';
};

const parseBridgeInvokeError = (rejection: unknown): NativeBridgeInvokeError | null => {
  let payload: unknown = rejection;
  if (!isRecord(payload) || payload.schema !== FLUXORA_BRIDGE_ERROR_SCHEMA) {
    const serialized = rejectedErrorText(rejection);
    if (!serialized) {
      return null;
    }
    try {
      payload = JSON.parse(serialized) as unknown;
    } catch {
      return null;
    }
  }

  if (!isRecord(payload) || payload.schema !== FLUXORA_BRIDGE_ERROR_SCHEMA) {
    return null;
  }
  const nativeError = payload.error;
  if (!isRecord(nativeError)) {
    return null;
  }

  const category = nativeError.category;
  const capabilityId = nativeError.capabilityId;
  const details = nativeError.details;
  if (
    typeof nativeError.code !== 'string' ||
    typeof nativeError.message !== 'string' ||
    typeof category !== 'string' ||
    !nativeBridgeErrorCategories.has(category as NativeBridgeError['category']) ||
    typeof nativeError.retryable !== 'boolean' ||
    (capabilityId !== undefined && capabilityId !== null && typeof capabilityId !== 'string') ||
    (details !== undefined && !isRecord(details)) ||
    typeof payload.method !== 'string' ||
    typeof payload.operationId !== 'string'
  ) {
    return null;
  }

  return {
    schema: FLUXORA_BRIDGE_ERROR_SCHEMA,
    code: nativeError.code,
    message: nativeError.message || 'Native bridge request failed.',
    category: category as NativeBridgeError['category'],
    retryable: nativeError.retryable,
    capabilityId: capabilityId ?? null,
    details: details ?? {},
    method: payload.method,
    operationId: payload.operationId
  };
};

const legacyBridgeErrorMessage = (rejection: unknown): string => {
  const message = rejectedErrorText(rejection).replace(/[\r\n\t]+/g, ' ').trim();
  if (!message || message.startsWith('{') || message.startsWith('[')) {
    return 'Native bridge request failed.';
  }
  return message.slice(0, 1_000);
};

const bridgeErrorFromInvokeRejection = (
  rejection: unknown,
  method: string,
  operationId: string
): FluxoraBridgeError => {
  const nativeError = parseBridgeInvokeError(rejection);
  if (nativeError) {
    return new FluxoraBridgeError(nativeError);
  }

  return new FluxoraBridgeError({
    schema: FLUXORA_BRIDGE_ERROR_SCHEMA,
    code: 'bridge.requestFailed',
    message: legacyBridgeErrorMessage(rejection),
    category: 'transport',
    retryable: false,
    capabilityId: null,
    details: {},
    method,
    operationId
  });
};

const bridgeRequest = async <T>(
  method: string,
  params: Record<string, unknown>,
  request: OperationRequest,
  timeoutMs?: number
): Promise<T> => {
  try {
    return await invoke<T>('fluxora_bridge_request', {
      method,
      params,
      request,
      timeoutMs
    });
  } catch (error) {
    throw bridgeErrorFromInvokeRejection(error, method, request.operationId ?? '');
  }
};

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

const browserPreviewAiProviders = (): FluxoraAiProviderDescriptor[] => [
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
    dataDisclosure: 'Browser preview does not call external AI providers.'
  }
];

const browserPreviewAiModels = (): FluxoraAiModelCapability[] => [
  {
    id: 'local-dry-run',
    providerId: 'local-dry-run',
    displayName: 'Local dry run',
    contextWindowTokens: 8192,
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
      source: 'browser-preview',
      isEstimated: true,
      remoteConfigurable: true
    }
  }
];

const browserPreviewAiStatus = (rawRequest: unknown): FluxoraAiHostStatus => {
  const request = requestWithOperationId(rawRequest, 'ai_status');
  return {
    ready: true,
    operationId: operationIdOf(request, 'ai_status'),
    health: 'ready',
    protocolVersion: '1.0',
    hostVersion: 'browser-preview',
    processId: 0,
    providers: browserPreviewAiProviders(),
    models: browserPreviewAiModels(),
    capabilities: {
      providerRegistry: { state: 'available' },
      providerCredentialBroker: { state: 'disabled', reason: 'browser-preview' },
      providerTestCall: { state: 'available', network: 'disabled' },
      modelCapabilitiesRegistry: { state: 'available' },
      planner: {
        state: 'available',
        schema: 'fluxora.ai.task-plan.v1',
        owner: 'FluxoraAIHost',
        askUserOnlyIfBlocked: true
      },
      subagentScheduler: {
        state: 'available',
        schema: 'fluxora.ai.subagent-schedule.v1',
        defaultSubagentLimit: 3,
        maxSubagentsForLargeTasks: 5,
        writeActionsOnlyThroughQueue: true,
        hiddenDestructiveActions: false
      },
      safeActionCatalog: AI_SAFE_ACTION_CATALOG_CAPABILITY,
      skillCatalog: FLUXORA_SKILL_CATALOG_CAPABILITY,
      modResearchRouter: {
        state: 'available',
        schema: 'fluxora.ai.mod-research-route.v1',
        owner: 'FluxoraAIHost',
        localFirst: true,
        blocksWebWhenLocalHighSignalIssueExists: true,
        searchBudgetOnlyWhenExternalVerificationNeeded: true,
        rendererPolicyDecisions: false
      }
    }
  };
};

const contextUsageLevel = (percent: number): FluxoraAiContextUsage['level'] => {
  if (percent >= 97) {
    return 'almost-full';
  }
  if (percent >= 92) {
    return 'critical';
  }
  if (percent >= 80) {
    return 'warning';
  }
  if (percent >= 60) {
    return 'moderate';
  }
  return 'normal';
};

const contextUsageMode = (percent: number): FluxoraAiContextUsage['mode'] => {
  if (percent >= 95) {
    return 'strict';
  }
  if (percent >= 85) {
    return 'compressed';
  }
  if (percent >= 70) {
    return 'smart';
  }
  return 'full';
};

const browserPreviewAiContextUsage = (rawRequest: unknown): FluxoraAiContextUsage => {
  const chatRequest = (rawRequest && typeof rawRequest === 'object'
    ? rawRequest
    : {}) as Partial<FluxoraAiChatRequest>;
  const request = requestWithOperationId(chatRequest, 'ai_context_estimate');
  const operationId = operationIdOf(request, 'ai_context_estimate');
  const promptText = chatRequest.messages?.map((message) => message.text).join('\n') ?? '';
  const currentContextTokens = Math.max(1, Math.ceil(promptText.length / 4));
  const contextWindowTokens = chatRequest.modelId && chatRequest.modelId !== 'local-dry-run'
    ? 1_000_000
    : 8_192;
  const currentContextPercent = Math.min(100, (currentContextTokens / contextWindowTokens) * 100);

  return {
    schema: 'fluxora.ai.context-usage.v1',
    operationId,
    providerId: chatRequest.providerId || 'local-dry-run',
    modelId: chatRequest.modelId || 'local-dry-run',
    contextWindowTokens,
    currentContextTokens,
    currentContextPercent,
    precision: 'estimated',
    level: contextUsageLevel(currentContextPercent),
    mode: contextUsageMode(currentContextPercent),
    includedSections: ['browser-preview', 'messages'],
    autoCompressionApplied: false,
    actionRequired: currentContextPercent >= 97,
    countedAt: new Date().toISOString()
  };
};

const browserPreviewAiChatResponse = (rawRequest: unknown): FluxoraAiChatResponse => {
  const chatRequest = (rawRequest && typeof rawRequest === 'object'
    ? rawRequest
    : {}) as Partial<FluxoraAiChatRequest>;
  const request = requestWithOperationId(chatRequest, 'ai_chat_run');
  const operationId = operationIdOf(request, 'ai_chat_run');
  const prompt =
    chatRequest.messages
      ?.filter((message) => message.role === 'user')
      .at(-1)
      ?.text.trim() || 'Fluxora chat';
  const text =
    `Plan: review "${prompt}" and suggest the next safe Fluxora steps. ` +
    'Chat-only mode cannot run tools or change the build.';
  const estimatedInputTokens = Math.max(1, Math.ceil(prompt.length / 4));
  const estimatedOutputTokens = Math.max(8, Math.ceil(text.length / 4));
  const modelId = chatRequest.modelId || 'local-dry-run';
  const routingPreset = chatRequest.routingPreset ?? 'free-demo';
  const planningBundle = createFluxoraAiTaskPlanningBundle(prompt, operationId);
  const contextUsage = browserPreviewAiContextUsage({ ...chatRequest, operationId });
  const status =
    planningBundle.taskPlan.proposedMutations.length > 0 ? 'needs-approval' : 'done';

  return {
    operationId,
    providerId: 'local-dry-run',
    modelId,
    routingPreset,
    status,
    text,
    streamChunks: text.match(/.{1,36}(?:\s|$)/g)?.map((chunk, index) => ({
      index,
      text: chunk
    })) ?? [{ index: 0, text }],
    sources: [],
    costEstimate: {
      currency: 'USD',
      actualInternalCost: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: estimatedInputTokens,
      displayCost: 0,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCost: 0,
      actualCost: 0,
      hardCost: 0,
      internalCost: 0,
      promptCache: {
        key: `browser-preview-${operationId}`,
        status: 'write',
        rawPromptStored: false
      },
      pricingSource: 'browser-preview',
      riskBuffer: 0,
      usageBreakdown: {
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: estimatedInputTokens,
        webSearchCalls: 0,
        fetchUrlCalls: 0,
        sandboxMinutes: 0,
        providerRiskBuffer: 0
      },
      isEstimate: true
    },
    costPipeline: {
      schema: 'fluxora.ai.cost-pipeline.v1',
      generatedAt: new Date().toISOString(),
      operationId,
      classifyCheaply: true,
      retrieveThroughContextGraph: true,
      nexusApiCacheFirst: true,
      compactContextBeforeStrongModel: true,
      useCheapVerification: true,
      structuredFinalReport: true,
      promptCaching: true,
      conversationCompaction: true,
      deduplicateWebSources: true,
      nexusMetadataCache: {
        ttlMs: 3_600_000,
        storesRateLimitHeaders: true
      },
      batchCheapChecks: true,
      stopConditionsForLowValueLoops: true
    },
    costPreflight: {
      schema: 'fluxora.ai.cost-preflight.v1',
      generatedAt: new Date().toISOString(),
      operationId,
      routingPreset,
      runSize: 'ordinary',
      required: false,
      decision: 'allowed',
      estimatedRunCredits: 0,
      estimatedMonthlyBudgetPercent: 0,
      expensiveRunApprovalRequired: false,
      wallet: {
        tier: routingPreset === 'byok' ? 'byok' : routingPreset === 'free-demo' ? 'free' : 'paid',
        currency: 'AI credits',
        freeDemoWalletCredits: 0.01,
        monthlyWalletCredits: routingPreset === 'byok' ? 0 : routingPreset === 'free-demo' ? 0.01 : 0.65,
        remainingMonthlyCredits: routingPreset === 'byok' ? 0 : routingPreset === 'free-demo' ? 0.01 : 0.65,
        webResearchSubBudgetCredits: routingPreset === 'byok' ? 0 : 0.12,
        longJobPreflightBudgetCredits: routingPreset === 'byok' ? 0 : 0.25,
        safePromptMaxMonthlyPercent: 0.2,
        safePromptThresholdCredits: routingPreset === 'byok' ? 0 : 0.13,
        byokChargesFluxoraBudget: false
      },
      fallbackChoices: ['economy', 'full', 'byok'],
      appliedOptimizations: ['browser-preview']
    },
    ledgerEntry: {
      operationId,
      providerId: 'local-dry-run',
      modelId,
      routingPreset,
      chargesFluxoraBudget: false,
      creditDebit: 0,
      estimatedInternalCost: 0,
      actualInternalCost: 0,
      currency: 'USD',
      billable: false,
      costPreflightDecision: 'allowed',
      createdAt: new Date().toISOString(),
      pricingVersion: 'browser-preview',
      promptCacheKey: `browser-preview-${operationId}`,
      usageBreakdown: {
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: estimatedInputTokens,
        webSearchCalls: 0,
        fetchUrlCalls: 0,
        sandboxMinutes: 0,
        providerRiskBuffer: 0
      }
    },
    marginTelemetry: {
      schema: 'fluxora.ai.margin-telemetry.v1',
      generatedAt: new Date().toISOString(),
      operationId,
      metricName: 'gross_margin_after_ai_cost',
      userTier: routingPreset === 'byok' ? 'byok' : routingPreset === 'free-demo' ? 'free' : 'paid',
      grossRevenueEur: routingPreset === 'paid-economy' || routingPreset === 'paid-large-job' ? 4.99 : 0,
      estimatedVatPaymentInfrastructureReserveEur:
        routingPreset === 'paid-economy' || routingPreset === 'paid-large-job' ? 3.7 : 0,
      aiProviderCost: 0,
      webSearchCost: 0,
      marginAfterAiCostEur:
        routingPreset === 'paid-economy' || routingPreset === 'paid-large-job' ? 1.29 : 0,
      grossMarginAfterAiCost:
        routingPreset === 'paid-economy' || routingPreset === 'paid-large-job' ? 0.25852 : 0,
      heavyUserDetected: false,
      localEstimateOnly: true
    },
    routingDecision: {
      schema: 'fluxora.ai.routing-decision.v1',
      generatedAt: new Date().toISOString(),
      operationId,
      routingPreset,
      runSize: 'ordinary',
      cheapClassifierFirst: true,
      candidateModelIds: [modelId],
      selectedModelId: modelId,
      selectedProviderId: 'local-dry-run',
      selectedModelClass: 'local',
      premiumRequiresByok: true,
      webModelOnlyWhenNeeded: true,
      localModelPreferredWhenPossible: true,
      reasons: ['browser preview uses the local dry-run route']
    },
    contextUsage,
    tokenUsage: {
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      totalTokens: estimatedInputTokens + estimatedOutputTokens,
      contextTokensBeforeRequest: contextUsage.currentContextTokens,
      source: 'chars-per-token-estimate'
    },
    fallbackProviders: [],
    taskPlan: planningBundle.taskPlan,
    subagentSchedule: planningBundle.subagentSchedule,
    selectedSkill: planningBundle.selectedSkill,
    toolCallsAllowed: false
  };
};

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const toFluxoraFileDropEvent = (event: TauriDragDropEvent): FluxoraFileDropEvent => {
  if (event.type === 'leave') {
    return { type: 'leave' };
  }

  const position = {
    x: event.position.x,
    y: event.position.y
  };

  if (event.type === 'over') {
    return {
      type: 'over',
      position
    };
  }

  return {
    type: event.type,
    paths: event.paths,
    position
  };
};

const listenToFileDrop = async (
  callback: (event: FluxoraFileDropEvent) => void
): Promise<() => void> => {
  if (!isTauriRuntime()) {
    return () => undefined;
  }

  return getCurrentWebview().onDragDropEvent((event) => {
    callback(toFluxoraFileDropEvent(event.payload));
  });
};

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

      case FluxoraIpcChannels.aiGetStatus:
      case FluxoraIpcChannels.aiRestartHost:
        return browserPreviewAiStatus(args[0]);

      case FluxoraIpcChannels.apiLimitsList: {
        const request = requestWithOperationId(args[0], 'api_limits_list');
        return {
          generatedAtUtc: '',
          providers: [],
          operationId: operationIdOf(request, 'api_limits_list')
        } satisfies FluxoraApiLimitStatus;
      }

      case FluxoraIpcChannels.aiChatRespond:
        return browserPreviewAiChatResponse(args[0]);

      case FluxoraIpcChannels.aiEstimateContext:
        return browserPreviewAiContextUsage(args[0]);

      case FluxoraIpcChannels.aiListProviders:
        return browserPreviewAiProviders();

      case FluxoraIpcChannels.aiListModels:
        return browserPreviewAiModels();

      case FluxoraIpcChannels.aiConnectProvider: {
        const request = requestWithOperationId(args[2], 'ai_provider_connect');
        return {
          providerId: optionalString(args[0]),
          connected: false,
          state: 'hostUnavailable',
          message: 'Provider credentials are unavailable in browser preview.',
          operationId: operationIdOf(request, 'ai_provider_connect')
        } satisfies FluxoraAiProviderConnectionResult;
      }

      case FluxoraIpcChannels.aiDisconnectProvider: {
        const request = requestWithOperationId(args[1], 'ai_provider_disconnect');
        return {
          providerId: optionalString(args[0]),
          connected: false,
          state: 'disconnected',
          message: 'Provider credential is disconnected.',
          operationId: operationIdOf(request, 'ai_provider_disconnect')
        } satisfies FluxoraAiProviderConnectionResult;
      }

      case FluxoraIpcChannels.aiTestProvider: {
        const request = requestWithOperationId(args[1], 'ai_provider_test');
        const providerId = optionalString(args[0]) || 'local-dry-run';
        return {
          providerId,
          ok: providerId === 'local-dry-run',
          state: providerId === 'local-dry-run' ? 'ready' : 'missingCredential',
          message:
            providerId === 'local-dry-run'
              ? 'Local dry-run provider is ready.'
              : 'Provider credential is not connected.',
          operationId: operationIdOf(request, 'ai_provider_test'),
          hostRoundTrip: false,
          checkedAt: Date.now(),
          modelIds: providerId === 'local-dry-run' ? ['local-dry-run'] : []
        } satisfies FluxoraAiProviderTestResult;
      }

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

      case FluxoraIpcChannels.buildSettingsNotifyPathsSaved:
      case FluxoraIpcChannels.uiLog:
      case FluxoraIpcChannels.windowClose:
      case FluxoraIpcChannels.windowMinimize:
      case FluxoraIpcChannels.windowOpenBuildSettings:
      case FluxoraIpcChannels.windowOpenFilePreview:
      case FluxoraIpcChannels.windowOpenModDetails:
      case FluxoraIpcChannels.windowOpenSettings:
      case FluxoraIpcChannels.windowOpenTextEditor:
      case FluxoraIpcChannels.windowToggleMaximize:
        return undefined;

      case FluxoraIpcChannels.dialogPickArchive:
      case FluxoraIpcChannels.dialogPickBuildConfig:
      case FluxoraIpcChannels.dialogPickExecutable:
      case FluxoraIpcChannels.dialogPickFluxPack:
      case FluxoraIpcChannels.dialogPickFolder:
      case FluxoraIpcChannels.dialogPickTextFile:
      case FluxoraIpcChannels.dialogSaveFluxPack:
      case FluxoraIpcChannels.dialogSaveTextFile:
        return { canceled: true } satisfies DialogPickResult;

      case FluxoraIpcChannels.modsPreviewTextFile:
      case FluxoraIpcChannels.profilesPreviewTextFile: {
        const request = requestWithOperationId(
          channel === FluxoraIpcChannels.modsPreviewTextFile ? args[4] : args[4],
          'text_file_preview'
        );
        const relativePath =
          channel === FluxoraIpcChannels.modsPreviewTextFile
            ? optionalString(args[2])
            : `${optionalString(args[1])}/${optionalString(args[2])}`;
        return {
          path: relativePath,
          fileName: optionalString(
            channel === FluxoraIpcChannels.modsPreviewTextFile ? args[2] : args[2]
          ).split(/[\\/]/).pop() ?? 'preview.txt',
          contentPreview: '',
          bytesRead: 0,
          size: 0,
          truncated: false,
          relativePath,
          operationId: operationIdOf(request, 'text_file_preview')
        } satisfies FluxoraTextFilePreview;
      }

      case FluxoraIpcChannels.modsReadTextFile:
      case FluxoraIpcChannels.textFilesRead: {
        const request = requestWithOperationId(
          channel === FluxoraIpcChannels.modsReadTextFile ? args[3] : args[1],
          'text_file_read'
        );
        return {
          path: optionalString(channel === FluxoraIpcChannels.modsReadTextFile ? args[2] : args[0]),
          fileName: 'preview.txt',
          content: '',
          size: 0,
          operationId: operationIdOf(request, 'text_file_read')
        } satisfies FluxoraTextFileDocument;
      }

      case FluxoraIpcChannels.modsStartNifPreview:
        return {
          sessionId: 'browser-preview-session',
          variants: [{
            variantId: 'browser-preview-variant',
            modName: 'Preview Mod',
            order: 0,
            enabled: true,
            relativePath: optionalString(args[3]),
            size: 0
          }],
          activeIndex: 0,
          modelHandle: {
            assetId: 'browser-preview-model',
            size: 0,
            mimeType: 'application/x-nif',
            relativePath: optionalString(args[3]),
            source: 'Preview Mod',
            contentKey: 'browser-preview-model'
          }
        } satisfies FluxoraNifPreviewStartResult;

      case FluxoraIpcChannels.modsPrepareNifPreviewVariant:
        return {
          assetId: 'browser-preview-model',
          size: 0,
          mimeType: 'application/x-nif',
          relativePath: '',
          source: 'Preview Mod',
          contentKey: 'browser-preview-model'
        } satisfies FluxoraNifPreviewAssetHandle;

      case FluxoraIpcChannels.modsPrepareNifPreviewTextures:
        return { assets: [], missing: args[1] as string[] } satisfies FluxoraNifPreviewTextureBatchResult;

      case FluxoraIpcChannels.modsReadNifPreviewAssetBytes:
        return new ArrayBuffer(0);

      case FluxoraIpcChannels.modsEndNifPreview:
        return undefined;

      case FluxoraIpcChannels.modsSaveTextFile:
      case FluxoraIpcChannels.textFilesSave: {
        const request = requestWithOperationId(
          channel === FluxoraIpcChannels.modsSaveTextFile ? args[4] : args[2],
          'text_file_save'
        );
        return {
          path: optionalString(channel === FluxoraIpcChannels.modsSaveTextFile ? args[2] : args[0]),
          fileName: 'preview.txt',
          size: optionalString(channel === FluxoraIpcChannels.modsSaveTextFile ? args[3] : args[1]).length,
          operationId: operationIdOf(request, 'text_file_save')
        } satisfies FluxoraTextFileSaveResult;
      }

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

      case FluxoraIpcChannels.processesWatchLaunchReady:
      case FluxoraIpcChannels.processesWaitForExit: {
        const request = requestWithOperationId(args[1], 'process_watch');
        return {
          processId: 0,
          processName: '',
          state: 'notFound',
          trackedKind: 'directProcess',
          operationId: operationIdOf(request, 'process_watch')
        } satisfies FluxoraProcessWatchResult;
      }

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

      case FluxoraIpcChannels.operationsGetStatus: {
        const request = requestWithOperationId(args[0], 'operations_status');
        return {
          operationId: operationIdOf(request, 'operations_status'),
          source: 'browser-preview',
          active: [],
          recent: [],
          message: 'Operation status is unavailable in browser preview.'
        } satisfies FluxoraOperationsStatus;
      }

      case FluxoraIpcChannels.operationsRecentLogs: {
        const request = requestWithOperationId(args[1], 'operations_recent_logs');
        return {
          operationId: operationIdOf(request, 'operations_recent_logs'),
          entries: [] satisfies FluxoraOperationLogEntry[],
          logPaths: [],
          maxEntries: 0,
          truncated: false
        } satisfies FluxoraRecentOperationLogs;
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

      case FluxoraIpcChannels.aiGetStatus:
        return invoke<FluxoraAiHostStatus>('fluxora_ai_get_status', {
          request: requestWithOperationId(args[0], 'ai_status')
        });

      case FluxoraIpcChannels.aiCancelRun:
        return invoke<FluxoraAiCancelRunResult>('fluxora_ai_cancel_run', {
          operationId: optionalString(args[0]),
          request: requestWithOperationId(args[1], 'ai_cancel_run')
        });

      case FluxoraIpcChannels.aiRestartHost:
        return invoke<FluxoraAiHostStatus>('fluxora_ai_restart_host', {
          request: requestWithOperationId(args[0], 'ai_restart_host')
        });

      case FluxoraIpcChannels.aiListProviders:
        return invoke<FluxoraAiProviderDescriptor[]>('fluxora_ai_list_providers', {
          request: requestWithOperationId(args[0], 'ai_list_providers')
        });

      case FluxoraIpcChannels.aiListModels:
        return invoke<FluxoraAiModelCapability[]>('fluxora_ai_list_models', {
          request: requestWithOperationId(args[0], 'ai_list_models')
        });

      case FluxoraIpcChannels.aiConnectProvider:
        return invoke<FluxoraAiProviderConnectionResult>('fluxora_ai_connect_provider', {
          providerId: optionalString(args[0]),
          apiKey: optionalString(args[1]),
          request: requestWithOperationId(args[2], 'ai_provider_connect')
        });

      case FluxoraIpcChannels.aiDisconnectProvider:
        return invoke<FluxoraAiProviderConnectionResult>('fluxora_ai_disconnect_provider', {
          providerId: optionalString(args[0]),
          request: requestWithOperationId(args[1], 'ai_provider_disconnect')
        });

      case FluxoraIpcChannels.aiTestProvider:
        return invoke<FluxoraAiProviderTestResult>('fluxora_ai_test_provider', {
          providerId: optionalString(args[0]),
          request: requestWithOperationId(args[1], 'ai_provider_test')
        });

      case FluxoraIpcChannels.aiChatRespond:
        return invoke<FluxoraAiChatResponse>('fluxora_ai_chat_respond', {
          request: {
            ...(args[0] && typeof args[0] === 'object' ? args[0] as Record<string, unknown> : {}),
            operationId: operationIdOf(
              requestWithOperationId(args[0], 'ai_chat_run'),
              'ai_chat_run'
            )
          }
        });

      case FluxoraIpcChannels.aiEstimateContext:
        return invoke<FluxoraAiContextUsage>('fluxora_ai_estimate_context', {
          request: {
            ...(args[0] && typeof args[0] === 'object' ? args[0] as Record<string, unknown> : {}),
            operationId: operationIdOf(
              requestWithOperationId(args[0], 'ai_context_estimate'),
              'ai_context_estimate'
            )
          }
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

      case FluxoraIpcChannels.dialogPickTextFile:
        return invoke<DialogPickResult>('fluxora_dialog_pick_file', {
          request: {
            title: 'Open text file',
            initialDirectory: optionalString(args[0]) || undefined,
            filters: [
              {
                name: 'Text documents',
                extensions: [
                  'txt',
                  'json',
                  'jsonc',
                  'json5',
                  'ini',
                  'xml',
                  'yaml',
                  'yml',
                  'toml',
                  'cfg',
                  'conf',
                  'config',
                  'properties',
                  'log',
                  'md',
                  'markdown',
                  'csv',
                  'css',
                  'scss',
                  'sass',
                  'less',
                  'html',
                  'htm',
                  'js',
                  'jsx',
                  'mjs',
                  'cjs',
                  'ts',
                  'tsx',
                  'vue',
                  'svelte',
                  'py',
                  'rb',
                  'php',
                  'java',
                  'c',
                  'cc',
                  'cpp',
                  'h',
                  'hpp',
                  'cs',
                  'rs',
                  'go',
                  'swift',
                  'kt',
                  'kts',
                  'sh',
                  'bash',
                  'zsh',
                  'ps1',
                  'bat',
                  'cmd',
                  'sql',
                  'graphql',
                  'gql',
                  'lock',
                  'meta',
                  'strings',
                  'po',
                  'pot',
                  'lua'
                ]
              },
              { name: 'All files', extensions: ['*'] }
            ]
          }
        });

      case FluxoraIpcChannels.dialogSaveTextFile:
        return invoke<DialogSaveResult>('fluxora_dialog_save_file', {
          request: {
            title: optionalString(args[1]) || 'Save text file',
            defaultPath: optionalString(args[0]) || undefined,
            filters: [
              {
                name: 'Text documents',
                extensions: [
                  'txt',
                  'json',
                  'jsonc',
                  'json5',
                  'ini',
                  'xml',
                  'yaml',
                  'yml',
                  'toml',
                  'cfg',
                  'conf',
                  'config',
                  'properties',
                  'log',
                  'md',
                  'markdown',
                  'csv',
                  'css',
                  'html',
                  'js',
                  'ts',
                  'lua'
                ]
              },
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

      case FluxoraIpcChannels.windowOpenBuildSettings:
        return invoke('fluxora_open_build_settings_window', {
          configPath: optionalString(args[0]),
          buildName: optionalString(args[1])
        });

      case FluxoraIpcChannels.windowOpenModDetails:
        return invoke('fluxora_open_mod_details_window', {
          configPath: optionalString(args[0]),
          modPath: optionalString(args[1]),
          modName: optionalString(args[2]),
          profileName: optionalString(args[3]),
          bootstrapKey: optionalString(args[4]),
          bootstrap: args[5] ?? null
        });

      case FluxoraIpcChannels.windowOpenFilePreview:
        return invoke('fluxora_open_file_preview_window', {
          configPath: optionalString(args[0]),
          projectDirectory: optionalString(args[1]),
          modPath: optionalString(args[2]),
          relativePath: optionalString(args[3]),
          fileName: optionalString(args[4]),
          profileName: optionalString(args[5]),
          kind: optionalString(args[6])
        });

      case FluxoraIpcChannels.windowOpenTextEditor:
        return invoke('fluxora_open_text_editor_window', {
          configPath: optionalString(args[0]),
          projectDirectory: optionalString(args[1]),
          modPath: optionalString(args[2]),
          relativePath: optionalString(args[3]),
          fileName: optionalString(args[4])
        });

      case FluxoraIpcChannels.windowOpenSettings:
        return invoke('fluxora_open_settings_window');

      case FluxoraIpcChannels.buildSettingsNotifyPathsSaved:
        return invoke('fluxora_build_settings_paths_saved', { project: args[0] });

      case FluxoraIpcChannels.transferStartMo2InMain:
        return invoke('fluxora_transfer_start_mo2_in_main', { handoff: args[0] });

      case FluxoraIpcChannels.transferOpenMo2InMain:
        return invoke('fluxora_transfer_open_mo2_in_main');

      case FluxoraIpcChannels.transferListDestinationDrives:
        return invoke<FluxoraTransferDriveOption[]>('fluxora_list_destination_drives');

      case FluxoraIpcChannels.processesWatchLaunchReady: {
        const request = requestWithOperationId(args[1], 'process_watch_launch');
        return invoke<FluxoraProcessWatchResult>('fluxora_wait_for_launch_ready', {
          launch: args[0],
          request
        });
      }

      case FluxoraIpcChannels.processesWaitForExit: {
        const request = requestWithOperationId(args[1], 'process_wait_exit');
        return invoke<FluxoraProcessWatchResult>('fluxora_wait_for_process_exit', {
          processId: args[0],
          request
        });
      }

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
      case FluxoraIpcChannels.apiLimitsList:
      case FluxoraIpcChannels.nexusGetAuthStatus:
      case FluxoraIpcChannels.nexusConnect:
      case FluxoraIpcChannels.nexusDisconnect: {
        const simpleMap: Partial<Record<FluxoraIpcChannel, [string, string]>> = {
          [FluxoraIpcChannels.bridgeGetLanguage]: ['settings.getLanguage', 'bridge_language_get'],
          [FluxoraIpcChannels.settingsGetTheme]: ['settings.getTheme', 'settings_theme_get'],
          [FluxoraIpcChannels.templatesList]: ['templates.list', 'templates_list'],
          [FluxoraIpcChannels.apiLimitsList]: ['apiLimits.list', 'api_limits_list'],
          [FluxoraIpcChannels.nexusGetAuthStatus]: ['nexus.getAuthStatus', 'nexus_status'],
          [FluxoraIpcChannels.nexusConnect]: ['nexus.connect', 'nexus_connect'],
          [FluxoraIpcChannels.nexusDisconnect]: ['nexus.disconnect', 'nexus_disconnect']
        };
        const [method, scope] = simpleMap[channel]!;
        const request = requestWithOperationId(args[0], scope);
        const timeoutMs = channel === FluxoraIpcChannels.nexusConnect ? nexusOAuthTimeoutMs : undefined;
        const data = await bridgeRequest<Record<string, unknown>>(method, {}, request, timeoutMs);
        return channel === FluxoraIpcChannels.templatesList ? data : withOperationId(data, request, scope);
      }

      case FluxoraIpcChannels.nexusConnectWithApiKey: {
        const request = requestWithOperationId(args[1], 'nexus_connect_api_key');
        const data = await bridgeRequest<Record<string, unknown>>(
          'nexus.connectWithApiKey',
          { apiKey: optionalString(args[0]) },
          request
        );
        return withOperationId(data, request, 'nexus_connect_api_key');
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
          request,
          projectsListTimeoutMs
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
        return bridgeRequest(
          'projects.openConfig',
          { configPath: args[0] },
          request,
          projectOpenConfigTimeoutMs
        );
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
          request,
          fileMutationTimeoutMs
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

      case FluxoraIpcChannels.buildPrepareWorkspaceIndexes:
        return bridgeRequest(
          'build.prepareWorkspaceIndexes',
          { projectDirectory: args[0], profileName: optionalString(args[1]) },
          requestWithOperationId(args[2], 'build_prepare_workspace_indexes'),
          effectiveFileTreeIndexTimeoutMs
        );

      case FluxoraIpcChannels.fluxPackExport: {
        const request = requestWithOperationId(args[1], 'fluxpack_export');
        const data = await bridgeRequest<Record<string, unknown>>(
          'fluxPack.export',
          fluxPackExportRequestParams(args[0]),
          request,
          fileMutationTimeoutMs
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

      case FluxoraIpcChannels.fluxPackPlanInstall: {
        const request = requestWithOperationId(args[1], 'fluxpack_plan_install');
        const data = await bridgeRequest<FluxoraFluxPackInstallPlan>(
          'fluxPack.planInstall',
          args[0] as Record<string, unknown>,
          request,
          fileMutationTimeoutMs
        );
        const operationId = operationIdOf(request, 'fluxpack_plan_install');
        return {
          ...data,
          summary: { ...data.summary, operationId },
          operationId
        };
      }

      case FluxoraIpcChannels.fluxPackInstall: {
        const request = requestWithOperationId(args[1], 'fluxpack_install');
        const data = await bridgeRequest<FluxoraFluxPackInstallResult>(
          'fluxPack.install',
          args[0] as Record<string, unknown>,
          request,
          fileMutationTimeoutMs
        );
        const operationId = operationIdOf(request, 'fluxpack_install');
        return {
          ...data,
          summary: { ...data.summary, operationId },
          operationId
        };
      }

      case FluxoraIpcChannels.grassCacheGenerate: {
        const request = requestWithOperationId(args[1], 'grass_cache_generate');
        const data = await bridgeRequest<Record<string, unknown>>(
          'grassCache.generate',
          args[0] as Record<string, unknown>,
          request,
          grassCacheGenerationTimeoutMs
        );
        return withOperationId(data, request, 'grass_cache_generate');
      }

      case FluxoraIpcChannels.modsListInstalled:
        return bridgeRequest('mods.listInstalled', { projectDirectory: args[0] }, requestWithOperationId(args[1], 'mods_list_installed'));
      case FluxoraIpcChannels.modsGetOrder:
        return bridgeRequest('mods.getOrder', { projectDirectory: args[0], profileName: optionalString(args[1]) }, requestWithOperationId(args[2], 'mods_get_order'));
      case FluxoraIpcChannels.modsGetWorkspace:
        return bridgeRequest(
          'mods.getWorkspace',
          { projectDirectory: args[0], profileName: optionalString(args[1]) },
          requestWithOperationId(args[2], 'mods_get_workspace'),
          modsWorkspaceTimeoutMs
        );
      case FluxoraIpcChannels.modsGetPersistedWorkspace:
        return bridgeRequest(
          'mods.getPersistedWorkspace',
          { projectDirectory: args[0], profileName: optionalString(args[1]) },
          requestWithOperationId(args[2], 'mods_get_persisted_workspace'),
          modsWorkspaceTimeoutMs
        );
      case FluxoraIpcChannels.modsInvalidateFileCaches:
        return bridgeRequest(
          'mods.invalidateFileCaches',
          { projectDirectory: args[0], changedPaths: args[1] },
          requestWithOperationId(args[2], 'mods_invalidate_file_caches'),
          modsWorkspaceTimeoutMs
        );
      case FluxoraIpcChannels.modsCreateSeparator:
        return bridgeRequest('mods.createSeparator', { projectDirectory: args[0], profileName: optionalString(args[1]), title: args[2], targetIndex: args[3] }, requestWithOperationId(args[4], 'mods_create_separator'));
      case FluxoraIpcChannels.modsDeleteSeparator:
        return bridgeRequest('mods.deleteSeparator', { projectDirectory: args[0], profileName: optionalString(args[1]), separatorId: args[2] }, requestWithOperationId(args[3], 'mods_delete_separator'));
      case FluxoraIpcChannels.modsMoveOrderItem:
        return bridgeRequest('mods.moveOrderItem', { projectDirectory: args[0], profileName: optionalString(args[1]), orderItemId: args[2], targetIndex: args[3] }, requestWithOperationId(args[4], 'mods_move_order_item'));
      case FluxoraIpcChannels.modsRebasePendingInstall:
        return bridgeRequest(
          'mods.rebasePendingInstall',
          { projectDirectory: args[0], operationId: args[1], targetIndex: args[2] },
          requestWithOperationId(args[3], 'mods_rebase_pending_install')
        );
      case FluxoraIpcChannels.modsCreateEmpty:
        return bridgeRequest('mods.createEmpty', { projectDirectory: args[0], modName: args[1] }, requestWithOperationId(args[2], 'mods_create_empty'));
      case FluxoraIpcChannels.modsCheckUpdates:
        return bridgeRequest('mods.checkUpdates', args[0] as Record<string, unknown>, requestWithOperationId(args[1], 'mods_check_updates'));
      case FluxoraIpcChannels.modsClearOverwrite: {
        const request = requestWithOperationId(args[1], 'mods_clear_overwrite');
        const data = await bridgeRequest<Record<string, unknown>>(
          'mods.clearOverwrite',
          { projectDirectory: args[0] },
          request,
          fileMutationTimeoutMs
        );
        return withOperationId(data, request, 'mods_clear_overwrite');
      }
      case FluxoraIpcChannels.modsGetFileTree:
        return bridgeRequest('mods.getFileTree', { projectDirectory: args[0], modPath: args[1], relativeDirectory: optionalString(args[2]) }, requestWithOperationId(args[3], 'mods_get_file_tree'));

      case FluxoraIpcChannels.modsGetModDetailsContent:
        return bridgeRequest(
          'mods.getModDetailsContent',
          { projectDirectory: args[0], modPath: args[1] },
          requestWithOperationId(args[2], 'mods_get_mod_details_content'),
          effectiveFileTreeIndexTimeoutMs
        );

      case FluxoraIpcChannels.modsGetModConflictTree:
        return bridgeRequest(
          'mods.getModConflictTree',
          {
            projectDirectory: args[0],
            modPath: args[1],
            cursor: optionalString(args[2]),
            limit: args[3]
          },
          requestWithOperationId(args[4], 'mods_get_mod_conflict_tree')
        );

      case FluxoraIpcChannels.modsGetModDetailsSummary:
        return bridgeRequest(
          'mods.getModDetailsSummary',
          {
            projectDirectory: args[0],
            profileName: optionalString(args[1]),
            modPath: args[2]
          },
          requestWithOperationId(args[3], 'mods_get_mod_details_summary')
        );

      case FluxoraIpcChannels.modsGetEffectiveFileTree:
        return bridgeRequest(
          'mods.getEffectiveFileTree',
          { projectDirectory: args[0], profileName: optionalString(args[1]) },
          requestWithOperationId(args[2], 'mods_get_effective_file_tree'),
          effectiveFileTreeIndexTimeoutMs
        );

      case FluxoraIpcChannels.modsGetEffectiveFileTreeRoot:
        return bridgeRequest(
          'mods.getEffectiveFileTreeRoot',
          { projectDirectory: args[0], profileName: optionalString(args[1]), limit: args[2] },
          requestWithOperationId(args[3], 'mods_get_effective_file_tree_root')
        );

      case FluxoraIpcChannels.modsGetEffectiveFileTreeChildren:
        return bridgeRequest(
          'mods.getEffectiveFileTreeChildren',
          {
            projectDirectory: args[0],
            profileName: optionalString(args[1]),
            revision: args[2],
            relativeDirectory: optionalString(args[3]),
            cursor: optionalString(args[4]),
            limit: args[5]
          },
          requestWithOperationId(args[6], 'mods_get_effective_file_tree_children')
        );

      case FluxoraIpcChannels.modsStartNifPreview:
        return invoke<FluxoraNifPreviewStartResult>('fluxora_start_nif_preview', {
          projectDirectory: args[0],
          profileName: args[1],
          initialModPath: args[2],
          relativePath: args[3],
          request: args[4]
        });

      case FluxoraIpcChannels.modsPrepareNifPreviewVariant:
        return invoke<FluxoraNifPreviewAssetHandle>('fluxora_prepare_nif_preview_variant', {
          sessionId: args[0],
          variantId: args[1]
        });

      case FluxoraIpcChannels.modsPrepareNifPreviewTextures:
        return invoke<FluxoraNifPreviewTextureBatchResult>('fluxora_prepare_nif_preview_textures', {
          sessionId: args[0],
          texturePaths: args[1]
        });

      case FluxoraIpcChannels.modsReadNifPreviewAssetBytes:
        return invoke<unknown>('fluxora_read_nif_preview_asset_bytes', {
          sessionId: args[0],
          assetId: args[1]
        });

      case FluxoraIpcChannels.modsEndNifPreview:
        return invoke<void>('fluxora_end_nif_preview', { sessionId: args[0] });

      case FluxoraIpcChannels.modsReadTextFile: {
        const request = requestWithOperationId(args[3], 'mods_read_text_file');
        const data = await bridgeRequest<Record<string, unknown>>(
          'mods.readTextFile',
          { projectDirectory: args[0], modPath: args[1], relativePath: args[2] },
          request
        );
        return withOperationId(data, request, 'mods_read_text_file');
      }

      case FluxoraIpcChannels.modsPreviewTextFile: {
        const request = requestWithOperationId(args[4], 'mods_preview_text_file');
        const data = await bridgeRequest<Record<string, unknown>>(
          'mods.previewTextFile',
          { projectDirectory: args[0], modPath: args[1], relativePath: args[2], maxBytes: args[3] },
          request
        );
        return withOperationId(data, request, 'mods_preview_text_file');
      }

      case FluxoraIpcChannels.modsSaveTextFile: {
        const request = requestWithOperationId(args[4], 'mods_save_text_file');
        const data = await bridgeRequest<Record<string, unknown>>(
          'mods.saveTextFile',
          { projectDirectory: args[0], modPath: args[1], relativePath: args[2], content: args[3] },
          request
        );
        return withOperationId(data, request, 'mods_save_text_file');
      }

      case FluxoraIpcChannels.textFilesRead: {
        const request = requestWithOperationId(args[1], 'text_files_read');
        const data = await bridgeRequest<Record<string, unknown>>(
          'textFiles.read',
          { path: args[0] },
          request
        );
        return withOperationId(data, request, 'text_files_read');
      }

      case FluxoraIpcChannels.textFilesSave: {
        const request = requestWithOperationId(args[2], 'text_files_save');
        const data = await bridgeRequest<Record<string, unknown>>(
          'textFiles.save',
          { path: args[0], content: args[1] },
          request
        );
        return withOperationId(data, request, 'text_files_save');
      }

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
        const timeoutMs =
          channel === FluxoraIpcChannels.modsDeleteInstalled
            ? fileMutationTimeoutMs
            : undefined;
        const data = await bridgeRequest<Record<string, unknown>>(
          mutation[0] as string,
          mutation[1] as Record<string, unknown>,
          request,
          timeoutMs
        );
        return withOperationId(data, request, mutation[3] as string);
      }

      case FluxoraIpcChannels.pluginsList:
        return bridgeRequest('plugins.list', { projectDirectory: args[0], templateId: args[1], profileName: optionalString(args[2]) }, requestWithOperationId(args[3], 'plugins_list'));
      case FluxoraIpcChannels.pluginsListPersisted:
        return bridgeRequest('plugins.listPersisted', { projectDirectory: args[0], templateId: args[1], profileName: optionalString(args[2]) }, requestWithOperationId(args[3], 'plugins_list_persisted'));
      case FluxoraIpcChannels.pluginsCreateSeparator:
        return bridgeRequest('plugins.createSeparator', { projectDirectory: args[0], templateId: args[1], profileName: optionalString(args[2]), title: args[3], targetIndex: args[4] }, requestWithOperationId(args[5], 'plugins_create_separator'));
      case FluxoraIpcChannels.pluginsDeleteSeparator:
        return bridgeRequest('plugins.deleteSeparator', { projectDirectory: args[0], templateId: args[1], profileName: optionalString(args[2]), separatorId: args[3] }, requestWithOperationId(args[4], 'plugins_delete_separator'));
      case FluxoraIpcChannels.pluginsMove:
        return bridgeRequest('plugins.move', { projectDirectory: args[0], templateId: args[1], profileName: optionalString(args[2]), orderItemId: args[3], targetIndex: args[4] }, requestWithOperationId(args[5], 'plugins_move'));
      case FluxoraIpcChannels.pluginsSetEnabled:
        return bridgeRequest('plugins.setEnabled', { projectDirectory: args[0], templateId: args[1], profileName: optionalString(args[2]), pluginName: args[3], isEnabled: args[4] }, requestWithOperationId(args[5], 'plugins_set_enabled'));
      case FluxoraIpcChannels.pluginsSetAllEnabled:
        return bridgeRequest('plugins.setAllEnabled', { projectDirectory: args[0], templateId: args[1], profileName: optionalString(args[2]), isEnabled: args[3] }, requestWithOperationId(args[4], 'plugins_set_all_enabled'));

      case FluxoraIpcChannels.profilesList:
        return bridgeRequest('profiles.list', { projectDirectory: args[0], defaultProfileName: optionalString(args[1]) }, requestWithOperationId(args[2], 'profiles_list'));
      case FluxoraIpcChannels.profilesPreviewTextFile: {
        const request = requestWithOperationId(args[4], 'profiles_preview_text_file');
        const data = await bridgeRequest<Record<string, unknown>>(
          'profiles.previewTextFile',
          { projectDirectory: args[0], profileName: args[1], fileName: args[2], maxBytes: args[3] },
          request
        );
        return withOperationId(data, request, 'profiles_preview_text_file');
      }
      case FluxoraIpcChannels.profilesCreate:
        return bridgeRequest('profiles.create', { projectDirectory: args[0], profileName: args[1], defaultProfileName: optionalString(args[2]), profileFilesJson: JSON.stringify(args[3] ?? []) }, requestWithOperationId(args[4], 'profiles_create'));
      case FluxoraIpcChannels.profilesClone:
        return bridgeRequest('profiles.clone', { projectDirectory: args[0], sourceProfileName: args[1], targetProfileName: args[2], defaultProfileName: optionalString(args[3]) }, requestWithOperationId(args[4], 'profiles_clone'));
      case FluxoraIpcChannels.profilesRename:
        return bridgeRequest('profiles.rename', { projectDirectory: args[0], sourceProfileName: args[1], targetProfileName: args[2], defaultProfileName: optionalString(args[3]) }, requestWithOperationId(args[4], 'profiles_rename'));
      case FluxoraIpcChannels.profilesDelete:
        return bridgeRequest('profiles.delete', { projectDirectory: args[0], profileName: args[1], defaultProfileName: optionalString(args[2]) }, requestWithOperationId(args[3], 'profiles_delete'));

      case FluxoraIpcChannels.executablesList:
        return bridgeRequest(
          'executables.list',
          { configPath: args[0] },
          requestWithOperationId(args[1], 'executables_list'),
          executablesListTimeoutMs
        );
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
          request,
          executablesLaunchTimeoutMs
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

      case FluxoraIpcChannels.operationsGetStatus:
        return invoke<FluxoraOperationsStatus>('fluxora_operations_get_status', {
          request: requestWithOperationId(args[0], 'operations_status')
        });

      case FluxoraIpcChannels.operationsRecentLogs:
        return invoke<FluxoraRecentOperationLogs>('fluxora_recent_operation_logs', {
          options: args[0] ?? {},
          request: requestWithOperationId(args[1], 'operations_recent_logs')
        });

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
        return bridgeRequest(
          'nxm.captureLinks',
          { projectDirectory: optionalString(args[0]), links: args[1] },
          requestWithOperationId(args[2], 'nxm_capture_links'),
          nexusDownloadTimeoutMs
        );
      case FluxoraIpcChannels.nxmImportInboundDownloads:
        return bridgeRequest(
          'nxm.importInboundDownloads',
          { projectDirectory: args[0] },
          requestWithOperationId(args[1], 'nxm_import_inbound'),
          nexusDownloadTimeoutMs
        );

      case FluxoraIpcChannels.downloadsWatchFolder:
        return invoke<FluxoraDownloadsFolderWatchResult>('fluxora_downloads_watch_folder', {
          projectDirectory: optionalString(args[0]),
          downloadsDirectory: optionalString(args[1]),
          request: requestWithOperationId(args[2], 'downloads_watch_folder')
        });
      case FluxoraIpcChannels.downloadsUnwatchFolder:
        return invoke<FluxoraDownloadsFolderWatchResult>('fluxora_downloads_unwatch_folder', {
          request: requestWithOperationId(args[0], 'downloads_unwatch_folder')
        });
      case FluxoraIpcChannels.buildContentWatch:
        return invoke<FluxoraBuildContentWatchResult>('fluxora_build_content_watch', {
          watchRequest: args[0] ?? {},
          operation: requestWithOperationId(args[1], 'build_content_watch')
        });
      case FluxoraIpcChannels.buildContentUnwatch:
        return invoke<FluxoraBuildContentWatchResult>('fluxora_build_content_unwatch', {
          operation: requestWithOperationId(args[0], 'build_content_unwatch')
        });

      case FluxoraIpcChannels.downloadsList:
        return bridgeRequest('downloads.list', { projectDirectory: args[0] }, requestWithOperationId(args[1], 'downloads_list'));
      case FluxoraIpcChannels.downloadsImportFile:
        return bridgeRequest(
          'downloads.importFile',
          { projectDirectory: args[0], sourcePath: args[1] },
          requestWithOperationId(args[2], 'downloads_import_file'),
          fileMutationTimeoutMs
        );
      case FluxoraIpcChannels.downloadsResume:
        return bridgeRequest('downloads.resume', { projectDirectory: args[0], downloadPath: args[1] }, requestWithOperationId(args[2], 'downloads_resume'));
      case FluxoraIpcChannels.downloadsPlanInstall:
      case FluxoraIpcChannels.archivesPlanInstall: {
        const isArchive = channel === FluxoraIpcChannels.archivesPlanInstall;
        const profileAware = typeof args[2] === 'string';
        const nameAware = profileAware && typeof args[3] === 'string';
        const profileName = profileAware ? args[2] : undefined;
        const modName = nameAware ? args[3] : undefined;
        const request = profileAware ? (nameAware ? args[4] : args[3]) : args[2];
        const params: Record<string, unknown> = isArchive
          ? { projectDirectory: args[0], archivePath: args[1] }
          : { projectDirectory: args[0], downloadPath: args[1] };
        if (profileAware) {
          params.profileName = profileName;
        }
        if (nameAware) {
          params.modName = modName;
        }
        return bridgeRequest(
          isArchive ? 'archives.planInstall' : 'downloads.planInstall',
          params,
          requestWithOperationId(request, isArchive ? 'archives_plan_install' : 'downloads_plan_install'),
          fileMutationTimeoutMs
        );
      }
      case FluxoraIpcChannels.downloadsAnalyzeFomod: {
        const profileAware = typeof args[2] === 'string';
        const params: Record<string, unknown> = {
          projectDirectory: args[0],
          downloadPath: args[1]
        };
        if (profileAware) {
          params.profileName = args[2];
          params.manualDecisionsJson = JSON.stringify(Array.isArray(args[3]) ? args[3] : []);
        }
        return bridgeRequest(
          'downloads.analyzeFomod',
          params,
          requestWithOperationId(profileAware ? args[4] : args[2], 'downloads_analyze_fomod')
        );
      }
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
          if (typeof analyze.profileName === 'string') {
            params.profileName = analyze.profileName;
          }
          if (typeof analyze.fomodContextId === 'string') {
            params.fomodContextId = analyze.fomodContextId;
          }
          if (Array.isArray(analyze.manualDecisions)) {
            params.manualDecisionsJson = JSON.stringify(analyze.manualDecisions);
          }
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
          if (Array.isArray(install.manualDecisions)) {
            params.manualDecisionsJson = JSON.stringify(install.manualDecisions);
          }
          delete params.selectedOptionIds;
          delete params.manualDecisions;
        }
        const method = isArchive
          ? isFomod ? 'archives.installFomod' : 'archives.install'
          : isFomod ? 'downloads.installFomod' : 'downloads.install';
        const data = await bridgeRequest<Record<string, unknown>>(
          method,
          params,
          request,
          fileMutationTimeoutMs
        );
        return withOperationId(data, request, scope);
      }

      default:
        throw new Error(`Unsupported Fluxora API channel: ${channel}`);
    }
  },
  on: (channel: FluxoraIpcChannel, listener: (...args: unknown[]) => void) => {
    const key = nextEventListenerToken;
    nextEventListenerToken += 1;
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
    const key = (listener as { __fluxoraTauriEventKey?: number }).__fluxoraTauriEventKey;
    if (key === undefined) {
      return;
    }
    const unlisten = eventUnlisteners.get(key);
    eventUnlisteners.delete(key);
    void unlisten?.then((dispose) => dispose());
  }
});

export const createTauriFluxoraApi = (): FluxoraApi =>
  createFluxoraApi(isTauriRuntime() ? createTauriInvoker() : createBrowserPreviewInvoker());
