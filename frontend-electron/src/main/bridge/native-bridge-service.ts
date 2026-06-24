import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  CreateFluxoraProjectRequest,
  DeleteFluxoraProjectResult,
  FluxoraAnalyzeContentLayoutRequest,
  FluxoraAnalyzeFomodContentLayoutRequest,
  FluxoraBuildPathSettings,
  FluxoraBuildPathSettingsSaveRequest,
  FluxoraContentLayoutPreview,
  FluxoraDownloadEntry,
  FluxoraDownloadMutationResult,
  FluxoraExecutable,
  FluxoraExecutableIconResult,
  FluxoraExecutableLaunchResult,
  FluxoraFomodInstaller,
  FluxoraFluxPackExportRequest,
  FluxoraFluxPackInstallRequest,
  FluxoraFluxPackInstallResult,
  FluxoraFluxPackProviderProgress,
  FluxoraFluxPackSummary,
  FluxoraGameTemplate,
  FluxoraInstallArchiveRequest,
  FluxoraInstallDownloadRequest,
  FluxoraInstallFomodArchiveRequest,
  FluxoraInstallFomodDownloadRequest,
  FluxoraInstalledModSummary,
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportProgress,
  FluxoraModOrganizerImportRequest,
  FluxoraInstalledMod,
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
  NativeBridgeCapabilities,
  NativeBridgeError,
  NativeBridgeFeatureCapability,
  NativeBridgeLanguageResult,
  NativeBridgeThemeResult,
  NativeBridgeStatus,
  FluxoraPlatformSupport,
  FluxoraTargetPlatform,
  FluxoraThemeMode,
  OperationRequest
} from '../../shared/fluxora-api';
import { ChildProcessBridgeTransport } from './child-process-transport';
import {
  BridgeProtocolClient,
  BridgeRequestError,
  type BridgeRequestOptions,
  createTransportError
} from './protocol-client';
import type { ElectronLogService } from '../logging';

interface HandshakePayload {
  protocolVersion: string;
  hostVersion: string;
  coreVersion: string;
  coreApiVersion: string;
  capabilities: NativeBridgeCapabilities;
}

interface CoreStatusPayload {
  available: boolean;
  initialized: boolean;
  protocolVersion: string;
  hostVersion: string;
  coreApiVersion: string;
  language?: string;
  theme?: FluxoraThemeMode;
  lastError?: string;
}

interface LanguagePayload {
  language: string;
}

interface ThemePayload {
  theme: FluxoraThemeMode;
}

interface ProjectDirectoryPreviewPayload {
  projectDirectory: string;
}

interface DeleteProjectPayload {
  accepted: boolean;
  configPath: string;
}

type BuildPathSettingsPayload = Omit<FluxoraBuildPathSettings, 'operationId'>;

type FluxPackSummaryPayload = Omit<FluxoraFluxPackSummary, 'operationId'>;

type FluxPackInstallPayload = Omit<FluxoraFluxPackInstallResult, 'operationId' | 'summary'> & {
  summary: FluxPackSummaryPayload;
};

interface DeleteDownloadPayload {
  accepted: boolean;
  downloadPath: string;
}

interface RegisterNxmProtocolPayload {
  isRegistered: boolean;
}

interface ExecutableIconPayload {
  iconPath: string;
}

interface OperationCancelPayload {
  status: 'accepted' | 'notFound' | 'unsupported';
  accepted: boolean;
}

const hostExecutableName = (): string =>
  process.platform === 'win32' ? 'FluxoraBridgeHost.exe' : 'FluxoraBridgeHost';

const mo2ImportBridgeTimeoutMs = 5 * 60 * 1000;

const targetPlatformFromNode = (
  platform: NodeJS.Platform = process.platform
): FluxoraTargetPlatform | null => {
  if (platform === 'win32' || platform === 'linux' || platform === 'darwin') {
    return platform;
  }

  return null;
};

const nativeLibraryName = (platform: FluxoraTargetPlatform): string => {
  switch (platform) {
    case 'win32':
      return 'FluxoraCore.dll';
    case 'linux':
      return 'libFluxoraCore.so';
    case 'darwin':
      return 'libFluxoraCore.dylib';
    default:
      return 'FluxoraCore';
  }
};

const bridgeHostName = (platform: FluxoraTargetPlatform): string =>
  platform === 'win32' ? 'FluxoraBridgeHost.exe' : 'FluxoraBridgeHost';

const crossPlatformSupportMatrix = (): FluxoraPlatformSupport[] => [
  {
    platform: 'win32',
    label: 'Windows',
    state: 'available',
    nativeLibraryName: nativeLibraryName('win32'),
    bridgeHostName: bridgeHostName('win32'),
    packageFormats: ['FluxoraSetup.exe', 'Forge Squirrel smoke: FluxoraElectronSmokeSetup.exe'],
    protocolState: 'available',
    protocolNotes: 'NXM uses Electron activation plus the existing Windows registry verification path.',
    shellOpenState: 'electron-main',
    vfsState: 'available',
    vfsNotes: 'VFS launch is available when the native bridge reports FluxoraVfs.dll for x64 builds.',
    pathRules: ['Unicode paths', 'Cyrillic/German characters', 'spaces', 'long-path guard', 'read-only guard'],
    releaseNotes: ['Installer-only public release policy remains in force.']
  },
  {
    platform: 'linux',
    label: 'Linux',
    state: 'limited',
    nativeLibraryName: nativeLibraryName('linux'),
    bridgeHostName: bridgeHostName('linux'),
    packageFormats: ['deb package', 'rpm package', 'zip smoke artifact'],
    protocolState: 'limited',
    protocolNotes: 'NXM capture is wired; durable registration needs xdg desktop MIME metadata in the package.',
    shellOpenState: 'electron-main',
    vfsState: 'unsupported',
    vfsNotes: 'VFS launch stays disabled until a Linux platform adapter exists.',
    pathRules: ['case-sensitive filesystem', 'UTF-8 paths', 'spaces', 'external mount paths', 'read-only guard'],
    releaseNotes: ['Requires native .so payload beside the bridge host in resources/native.']
  },
  {
    platform: 'darwin',
    label: 'macOS',
    state: 'limited',
    nativeLibraryName: nativeLibraryName('darwin'),
    bridgeHostName: bridgeHostName('darwin'),
    packageFormats: ['zip smoke artifact', 'dmg/signing planned'],
    protocolState: 'limited',
    protocolNotes: 'NXM capture uses open-url; bundle URL scheme metadata, signing and notarization remain release gates.',
    shellOpenState: 'electron-main',
    vfsState: 'unsupported',
    vfsNotes: 'VFS launch stays disabled until a signed macOS platform adapter exists.',
    pathRules: ['Unicode paths', 'spaces', 'external volumes', 'app sandbox review', 'read-only guard'],
    releaseNotes: ['Requires signed native .dylib and helper binaries before public release.']
  }
];

const electronPlatformFeatures = (
  platform: NodeJS.Platform
): Record<string, NativeBridgeFeatureCapability> => {
  const targetPlatform = targetPlatformFromNode(platform);
  const knownPlatforms: NodeJS.Platform[] = ['win32', 'linux', 'darwin'];
  const nativeResourcesConfigured = Boolean(process.env.FLUXORA_NATIVE_RESOURCES?.trim());

  return {
    nativeDialogs: {
      state: 'electron-main',
      platforms: knownPlatforms,
      supports: ['openFile', 'openDirectory', 'saveFile']
    },
    shellOpen: {
      state: 'electron-main',
      platforms: knownPlatforms,
      supports: ['shell.openPath', 'shell.showItemInFolder']
    },
    externalLinks: {
      state: 'electron-main',
      platforms: knownPlatforms,
      supports: ['https', 'mailto'],
      reason: 'Renderer opens external links only through the main-process allowlist.'
    },
    nxmProtocolRegistration: {
      state: targetPlatform === 'win32' ? 'available' : targetPlatform ? 'limited' : 'unknown',
      platforms: knownPlatforms,
      supports:
        targetPlatform === 'darwin'
          ? ['app.open-url', 'bundle URL scheme metadata']
          : targetPlatform === 'linux'
            ? ['second-instance capture', 'x-scheme-handler/nxm package metadata']
            : ['app.setAsDefaultProtocolClient', 'Windows registry verification'],
      reason:
        targetPlatform === 'win32'
          ? 'Windows registration is verified by the native bridge.'
          : targetPlatform
            ? 'Activation is wired; durable OS registration depends on platform packaging metadata.'
            : 'This platform is outside the current Fluxora support target.'
    },
    packagedNativeResources: {
      state: nativeResourcesConfigured ? 'available' : 'limited',
      platforms: knownPlatforms,
      requires: ['FLUXORA_NATIVE_RESOURCES'],
      reason: nativeResourcesConfigured
        ? 'Forge will copy native payloads into resources/native during package.'
        : 'Dev packages stay runnable without native payloads; release smoke builds must set FLUXORA_NATIVE_RESOURCES.'
    },
    caseSensitiveFilesystem: {
      state: platform === 'linux' ? 'available' : 'limited',
      platforms: ['linux'],
      reason:
        platform === 'linux'
          ? 'Current platform uses Linux path casing rules.'
          : 'Backend path tests cover case-only archive comparisons for Linux parity.'
    }
  };
};

const withElectronPlatformCapabilities = (
  capabilities: NativeBridgeCapabilities
): NativeBridgeCapabilities => {
  const platform = capabilities.platform === 'unknown' ? process.platform : capabilities.platform;
  const targetPlatform = targetPlatformFromNode(platform);
  const coreLibraryName =
    capabilities.core.libraryName || (targetPlatform ? nativeLibraryName(targetPlatform) : 'FluxoraCore');

  return {
    ...capabilities,
    platform,
    arch: capabilities.arch === 'unknown' ? process.arch : capabilities.arch,
    core: {
      ...capabilities.core,
      libraryName: coreLibraryName
    },
    features: {
      ...capabilities.features,
      ...electronPlatformFeatures(platform)
    },
    supportMatrix: capabilities.supportMatrix ?? crossPlatformSupportMatrix()
  };
};

const defaultFluxoraDataDirectory = (): string => path.join(app.getPath('appData'), 'Fluxora');

const defaultBuildConfigsDirectory = (): string =>
  path.join(defaultFluxoraDataDirectory(), 'Builds');

const defaultInstallRootDirectory = (): string =>
  path.join(defaultFluxoraDataDirectory(), 'Projects');

const canAccessFile = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const createOperationId = (scope: string): string =>
  `op_${new Date().toISOString().replace(/[-:.TZ]/g, '')}_${scope}_${randomUUID().slice(0, 8)}`;

const normalizeOperationRequest = (request: unknown, scope: string): OperationRequest => {
  if (!request || typeof request !== 'object') {
    return { operationId: createOperationId(scope) };
  }

  const operationId = (request as OperationRequest).operationId;
  return {
    operationId:
      typeof operationId === 'string' && operationId.length > 0
        ? operationId
        : createOperationId(scope)
  };
};

const bridgeErrorFromUnknown = (error: unknown): NativeBridgeError => {
  if (error instanceof BridgeRequestError) {
    return error.bridgeError;
  }

  return createTransportError(
    'bridge.unavailable',
    error instanceof Error ? error.message : 'Native bridge is unavailable.'
  );
};

const validationError = (
  code: string,
  message: string,
  operationId?: string
): BridgeRequestError =>
  new BridgeRequestError(
    {
      code,
      message,
      category: 'validation',
      retryable: false,
      capabilityId: null,
      details: {}
    },
    operationId
  );

const requiredString = (
  value: unknown,
  fieldName: string,
  operationId?: string
): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError(
      `bridge.${fieldName}Required`,
      `${fieldName} is required.`,
      operationId
    );
  }

  return value.trim();
};

const optionalString = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const normalizeThemeMode = (value: unknown): FluxoraThemeMode =>
  value === 'light' ? 'light' : 'dark';

const optionalNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const optionalProviderProgress = (value: unknown): FluxoraFluxPackProviderProgress[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      providerId: optionalString(entry.providerId),
      displayName: optionalString(entry.displayName),
      totalCount: optionalNumber(entry.totalCount),
      completedCount: optionalNumber(entry.completedCount),
      pendingCount: optionalNumber(entry.pendingCount),
      failedCount: optionalNumber(entry.failedCount),
      currentItem: optionalString(entry.currentItem),
      statusText: optionalString(entry.statusText),
      progressPercent: optionalNumber(entry.progressPercent)
    }));
};

const normalizeOperationProgress = (
  value: unknown,
  operationId?: string
): FluxoraOperationProgress | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const progress = value as Partial<FluxoraOperationProgress>;
  const nextOperationId = optionalString(progress.operationId) || operationId || '';
  if (!nextOperationId) {
    return null;
  }

  return {
    operationId: nextOperationId,
    phase: optionalString(progress.phase),
    currentStep: optionalString(progress.currentStep),
    currentItem: optionalString(progress.currentItem),
    overallPercent: optionalNumber(progress.overallPercent),
    copyPercent: optionalNumber(progress.copyPercent),
    databasePercent: optionalNumber(progress.databasePercent),
    copiedBytes: optionalNumber(progress.copiedBytes),
    totalBytes: optionalNumber(progress.totalBytes),
    statusMessage: optionalString(progress.statusMessage),
    totalSourceCount: optionalNumber(progress.totalSourceCount),
    installedSourceCount: optionalNumber(progress.installedSourceCount),
    pendingSourceCount: optionalNumber(progress.pendingSourceCount),
    failedSourceCount: optionalNumber(progress.failedSourceCount),
    deletedBytes: optionalNumber(progress.deletedBytes),
    deletedEntries: optionalNumber(progress.deletedEntries),
    totalEntries: optionalNumber(progress.totalEntries),
    providers: optionalProviderProgress(progress.providers)
  };
};

const requiredBoolean = (
  value: unknown,
  fieldName: string,
  operationId?: string
): boolean => {
  if (typeof value !== 'boolean') {
    throw validationError(
      `bridge.${fieldName}Required`,
      `${fieldName} is required.`,
      operationId
    );
  }

  return value;
};

const requiredInteger = (
  value: unknown,
  fieldName: string,
  operationId?: string
): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw validationError(
      `bridge.${fieldName}Required`,
      `${fieldName} is required.`,
      operationId
    );
  }

  return value;
};

const optionalExistingModMode = (
  value: unknown,
  operationId?: string
): 0 | 1 | 2 => {
  if (value === undefined || value === null) {
    return 0;
  }

  if (value !== 0 && value !== 1 && value !== 2) {
    throw validationError(
      'bridge.existingModModeInvalid',
      'existingModMode must be 0, 1, or 2.',
      operationId
    );
  }

  return value;
};

const requiredStringArray = (
  value: unknown,
  fieldName: string,
  operationId?: string
): string[] => {
  if (!Array.isArray(value)) {
    throw validationError(
      `bridge.${fieldName}Required`,
      `${fieldName} is required.`,
      operationId
    );
  }

  const strings = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  if (strings.length !== value.length || strings.length === 0) {
    throw validationError(
      `bridge.${fieldName}Invalid`,
      `${fieldName} must contain non-empty strings.`,
      operationId
    );
  }

  return strings;
};

const requiredStringArrayAllowEmpty = (
  value: unknown,
  fieldName: string,
  operationId?: string
): string[] => {
  if (!Array.isArray(value)) {
    throw validationError(
      `bridge.${fieldName}Required`,
      `${fieldName} is required.`,
      operationId
    );
  }

  const strings = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  if (strings.length !== value.length) {
    throw validationError(
      `bridge.${fieldName}Invalid`,
      `${fieldName} must contain strings.`,
      operationId
    );
  }

  return strings;
};

const optionalStringArrayAllowEmpty = (
  value: unknown,
  fieldName: string,
  operationId?: string
): string[] => {
  if (value === undefined || value === null) {
    return [];
  }

  return requiredStringArrayAllowEmpty(value, fieldName, operationId);
};

const normalizedExecutableEntries = (
  value: unknown,
  operationId?: string
): FluxoraExecutable[] => {
  if (!Array.isArray(value)) {
    throw validationError(
      'bridge.executablesRequired',
      'executables must be an array.',
      operationId
    );
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw validationError(
        'bridge.executableEntryInvalid',
        `Executable entry ${index + 1} must be an object.`,
        operationId
      );
    }

    const executable = entry as Partial<FluxoraExecutable>;
    return {
      id: optionalString(executable.id),
      displayName: optionalString(executable.displayName),
      executablePath: requiredString(
        executable.executablePath,
        `executables[${index}].executablePath`,
        operationId
      ),
      arguments: optionalString(executable.arguments),
      workingDirectory: optionalString(executable.workingDirectory),
      iconPath: optionalString(executable.iconPath),
      executableDisplayMetadata: executable.executableDisplayMetadata
    };
  });
};

const normalizedOperationId = (request: OperationRequest, scope: string): string =>
  request.operationId ?? createOperationId(scope);

export class NativeBridgeService {
  private client: BridgeProtocolClient | null = null;
  private hostPath: string | null = null;
  private handshake: HandshakePayload | null = null;
  private readonly progressListeners = new Set<(progress: FluxoraOperationProgress) => void>();

  constructor(private readonly logger: ElectronLogService) {}

  onOperationProgress(listener: (progress: FluxoraOperationProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  async getStatus(rawRequest?: unknown): Promise<NativeBridgeStatus> {
    const request = normalizeOperationRequest(rawRequest, 'bridge_status');

    try {
      await this.logger.write(
        'main-bridge',
        'info',
        'NativeBridge',
        'status request started',
        request.operationId
      );

      const client = await this.ensureClient();
      const handshake = await this.ensureHandshake(client, request);
      const status = await client.request<CoreStatusPayload>('system.initialize', {}, request);
      const capabilities = await client.request<NativeBridgeCapabilities>(
        'system.getCapabilities',
        {},
        request
      );
      const mergedCapabilities = withElectronPlatformCapabilities(capabilities.data);

      await this.logger.write(
        'main-bridge',
        'info',
        'NativeBridge',
        'status request completed',
        request.operationId
      );

      return {
        ready: status.data.available && status.data.initialized,
        operationId: request.operationId ?? createOperationId('bridge_status'),
        protocolVersion: status.data.protocolVersion ?? handshake.protocolVersion,
        hostVersion: status.data.hostVersion ?? handshake.hostVersion,
        coreVersion: handshake.coreVersion,
        coreApiVersion: status.data.coreApiVersion ?? handshake.coreApiVersion,
        language: status.data.language,
        theme: normalizeThemeMode(status.data.theme),
        hostPath: this.hostPath ?? undefined,
        capabilities: mergedCapabilities,
        error: status.data.available
          ? undefined
          : createTransportError('core.unavailable', status.data.lastError ?? 'Native core is unavailable.', false),
        logs: this.logger.paths()
      };
    } catch (error) {
      const bridgeError = bridgeErrorFromUnknown(error);
      await this.logger.write(
        'main-bridge',
        'error',
        'NativeBridge',
        bridgeError.message,
        request.operationId
      );

      return {
        ready: false,
        operationId: request.operationId ?? createOperationId('bridge_status'),
        hostPath: this.hostPath ?? undefined,
        error: bridgeError,
        logs: this.logger.paths()
      };
    }
  }

  async getLanguage(rawRequest?: unknown): Promise<NativeBridgeLanguageResult> {
    const request = normalizeOperationRequest(rawRequest, 'bridge_language_get');
    const client = await this.ensureClient();
    await this.ensureHandshake(client, request);
    const reply = await client.request<LanguagePayload>('settings.getLanguage', {}, request);
    return {
      language: reply.data.language,
      operationId: request.operationId ?? createOperationId('bridge_language_get')
    };
  }

  async setLanguage(language: unknown, rawRequest?: unknown): Promise<NativeBridgeLanguageResult> {
    const request = normalizeOperationRequest(rawRequest, 'bridge_language_set');
    if (typeof language !== 'string' || language.trim().length === 0 || language.length > 32) {
      throw new BridgeRequestError(
        {
          code: 'bridge.invalidLanguage',
          message: 'Language code is required.',
          category: 'validation',
          retryable: false,
          capabilityId: null,
          details: {}
        },
        request.operationId
      );
    }

    await this.logger.write(
      'main-bridge',
      'info',
      'NativeBridge',
      `set language ${language}`,
      request.operationId
    );

    const client = await this.ensureClient();
    await this.ensureHandshake(client, request);
    const reply = await client.request<LanguagePayload>(
      'settings.setLanguage',
      { language },
      request
    );

    return {
      language: reply.data.language,
      operationId: request.operationId ?? createOperationId('bridge_language_set')
    };
  }

  async getTheme(rawRequest?: unknown): Promise<NativeBridgeThemeResult> {
    const request = normalizeOperationRequest(rawRequest, 'settings_theme_get');
    const reply = await this.requestBridge<ThemePayload>('settings.getTheme', {}, request);
    return {
      theme: normalizeThemeMode(reply.theme),
      operationId: normalizedOperationId(request, 'settings_theme_get')
    };
  }

  async setTheme(theme: unknown, rawRequest?: unknown): Promise<NativeBridgeThemeResult> {
    const request = normalizeOperationRequest(rawRequest, 'settings_theme_set');
    const themeValue = normalizeThemeMode(theme);
    const reply = await this.requestBridge<ThemePayload>(
      'settings.setTheme',
      { theme: themeValue },
      request
    );

    return {
      theme: normalizeThemeMode(reply.theme),
      operationId: normalizedOperationId(request, 'settings_theme_set')
    };
  }

  async listTemplates(rawRequest?: unknown): Promise<FluxoraGameTemplate[]> {
    const request = normalizeOperationRequest(rawRequest, 'templates_list');
    return this.requestBridge<FluxoraGameTemplate[]>('templates.list', {}, request);
  }

  async resolveTemplate(templateId: unknown, rawRequest?: unknown): Promise<FluxoraGameTemplate> {
    const request = normalizeOperationRequest(rawRequest, 'templates_resolve');
    const templateIdValue = requiredString(templateId, 'templateId', request.operationId);
    return this.requestBridge<FluxoraGameTemplate>(
      'templates.resolve',
      { templateId: templateIdValue },
      request
    );
  }

  async listProjects(rawRequest?: unknown): Promise<FluxoraProjectCatalog> {
    const request = normalizeOperationRequest(rawRequest, 'projects_list');
    const projects = await this.requestBridge<FluxoraProject[]>(
      'projects.listConfigs',
      { buildConfigsDirectory: defaultBuildConfigsDirectory() },
      request
    );

    return {
      projects,
      buildConfigsDirectory: defaultBuildConfigsDirectory(),
      defaultInstallRootDirectory: defaultInstallRootDirectory(),
      operationId: normalizedOperationId(request, 'projects_list')
    };
  }

  async openProjectConfig(configPath: unknown, rawRequest?: unknown): Promise<FluxoraProject> {
    const request = normalizeOperationRequest(rawRequest, 'projects_open_config');
    const configPathValue = requiredString(configPath, 'configPath', request.operationId);
    return this.requestBridge<FluxoraProject>(
      'projects.openConfig',
      { configPath: configPathValue },
      request
    );
  }

  async previewProjectDirectory(
    projectName: unknown,
    installRootDirectory: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraProjectDirectoryPreview> {
    const request = normalizeOperationRequest(rawRequest, 'projects_preview_directory');
    const projectNameValue = requiredString(projectName, 'projectName', request.operationId);
    const installRootDirectoryValue = requiredString(
      installRootDirectory,
      'installRootDirectory',
      request.operationId
    );
    const reply = await this.requestBridge<ProjectDirectoryPreviewPayload>(
      'projects.previewDirectory',
      {
        projectName: projectNameValue,
        installRootDirectory: installRootDirectoryValue
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'projects_preview_directory')
    };
  }

  async createProject(rawProject: unknown, rawRequest?: unknown): Promise<FluxoraProject> {
    const request = normalizeOperationRequest(rawRequest, 'projects_create');
    if (!rawProject || typeof rawProject !== 'object') {
      throw validationError(
        'bridge.projectCreateRequestRequired',
        'Project create request is required.',
        request.operationId
      );
    }

    const project = rawProject as Partial<CreateFluxoraProjectRequest>;
    return this.requestBridge<FluxoraProject>(
      'projects.create',
      {
        projectName: requiredString(project.projectName, 'projectName', request.operationId),
        templateId: requiredString(project.templateId, 'templateId', request.operationId),
        gamePath: requiredString(project.gamePath, 'gamePath', request.operationId),
        installRootDirectory: requiredString(
          project.installRootDirectory,
          'installRootDirectory',
          request.operationId
        )
      },
      request
    );
  }

  async renameProject(
    configPath: unknown,
    newName: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraProject> {
    const request = normalizeOperationRequest(rawRequest, 'projects_rename');
    return this.requestBridge<FluxoraProject>(
      'projects.rename',
      {
        configPath: requiredString(configPath, 'configPath', request.operationId),
        newName: requiredString(newName, 'newName', request.operationId)
      },
      request
    );
  }

  async deleteProject(
    configPath: unknown,
    rawRequest?: unknown
  ): Promise<DeleteFluxoraProjectResult> {
    const request = normalizeOperationRequest(rawRequest, 'projects_delete');
    const reply = await this.requestBridge<DeleteProjectPayload>(
      'projects.delete',
      { configPath: requiredString(configPath, 'configPath', request.operationId) },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'projects_delete')
    };
  }

  async getBuildPathSettings(
    configPath: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraBuildPathSettings> {
    const request = normalizeOperationRequest(rawRequest, 'build_paths_get');
    const reply = await this.requestBridge<BuildPathSettingsPayload>(
      'buildPaths.get',
      { configPath: requiredString(configPath, 'configPath', request.operationId) },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'build_paths_get')
    };
  }

  async saveBuildPathSettings(
    configPath: unknown,
    rawSettings: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraBuildPathSettings> {
    const request = normalizeOperationRequest(rawRequest, 'build_paths_save');
    if (!rawSettings || typeof rawSettings !== 'object') {
      throw validationError(
        'bridge.buildPathSettingsRequired',
        'Build path settings are required.',
        request.operationId
      );
    }

    const settings = rawSettings as Partial<FluxoraBuildPathSettingsSaveRequest>;
    const normalized: FluxoraBuildPathSettingsSaveRequest = {
      gameDirectory: requiredString(settings.gameDirectory, 'gameDirectory', request.operationId),
      modsDirectory: requiredString(settings.modsDirectory, 'modsDirectory', request.operationId),
      profilesDirectory: requiredString(settings.profilesDirectory, 'profilesDirectory', request.operationId),
      downloadsDirectory: requiredString(settings.downloadsDirectory, 'downloadsDirectory', request.operationId),
      overwriteDirectory: requiredString(settings.overwriteDirectory, 'overwriteDirectory', request.operationId)
    };

    const reply = await this.requestBridge<BuildPathSettingsPayload>(
      'buildPaths.save',
      {
        configPath: requiredString(configPath, 'configPath', request.operationId),
        settingsJson: JSON.stringify(normalized)
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'build_paths_save')
    };
  }

  async exportFluxPack(
    rawExport: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraFluxPackSummary> {
    const request = normalizeOperationRequest(rawRequest, 'fluxpack_export');
    if (!rawExport || typeof rawExport !== 'object') {
      throw validationError(
        'bridge.fluxPackExportRequestRequired',
        'FluxPack export request is required.',
        request.operationId
      );
    }

    const exportRequest = rawExport as Partial<FluxoraFluxPackExportRequest>;
    const reply = await this.requestBridge<FluxPackSummaryPayload>(
      'fluxPack.export',
      {
        configPath: requiredString(exportRequest.configPath, 'configPath', request.operationId),
        outputPath: requiredString(exportRequest.outputPath, 'outputPath', request.operationId),
        includeGeneratedAssets: requiredBoolean(
          exportRequest.includeGeneratedAssets,
          'includeGeneratedAssets',
          request.operationId
        )
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'fluxpack_export')
    };
  }

  async inspectFluxPack(
    fluxPackPath: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraFluxPackSummary> {
    const request = normalizeOperationRequest(rawRequest, 'fluxpack_inspect');
    const reply = await this.requestBridge<FluxPackSummaryPayload>(
      'fluxPack.inspect',
      {
        fluxPackPath: requiredString(fluxPackPath, 'fluxPackPath', request.operationId)
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'fluxpack_inspect')
    };
  }

  async installFluxPack(
    rawInstall: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraFluxPackInstallResult> {
    const request = normalizeOperationRequest(rawRequest, 'fluxpack_install');
    if (!rawInstall || typeof rawInstall !== 'object') {
      throw validationError(
        'bridge.fluxPackInstallRequestRequired',
        'FluxPack install request is required.',
        request.operationId
      );
    }

    const installRequest = rawInstall as Partial<FluxoraFluxPackInstallRequest>;
    const reply = await this.requestBridge<FluxPackInstallPayload>(
      'fluxPack.install',
      {
        fluxPackPath: requiredString(installRequest.fluxPackPath, 'fluxPackPath', request.operationId),
        installRootDirectory: requiredString(
          installRequest.installRootDirectory,
          'installRootDirectory',
          request.operationId
        )
      },
      request
    );

    const operationId = normalizedOperationId(request, 'fluxpack_install');
    return {
      ...reply,
      summary: {
        ...reply.summary,
        operationId
      },
      operationId
    };
  }

  async listInstalledMods(
    projectDirectory: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraInstalledMod[]> {
    const request = normalizeOperationRequest(rawRequest, 'mods_list_installed');
    return this.requestBridge<FluxoraInstalledMod[]>(
      'mods.listInstalled',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId)
      },
      request
    );
  }

  async getModOrder(
    projectDirectory: unknown,
    profileName: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraModOrderItem[]> {
    const request = normalizeOperationRequest(rawRequest, 'mods_get_order');
    return this.requestBridge<FluxoraModOrderItem[]>(
      'mods.getOrder',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        profileName: optionalString(profileName)
      },
      request
    );
  }

  async createModSeparator(
    projectDirectory: unknown,
    profileName: unknown,
    title: unknown,
    targetIndex: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraModOrderItem[]> {
    const request = normalizeOperationRequest(rawRequest, 'mods_create_separator');
    return this.requestBridge<FluxoraModOrderItem[]>(
      'mods.createSeparator',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        profileName: optionalString(profileName),
        title: requiredString(title, 'title', request.operationId),
        targetIndex: requiredInteger(targetIndex, 'targetIndex', request.operationId)
      },
      request
    );
  }

  async deleteModSeparator(
    projectDirectory: unknown,
    profileName: unknown,
    separatorId: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraModOrderItem[]> {
    const request = normalizeOperationRequest(rawRequest, 'mods_delete_separator');
    return this.requestBridge<FluxoraModOrderItem[]>(
      'mods.deleteSeparator',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        profileName: optionalString(profileName),
        separatorId: requiredString(separatorId, 'separatorId', request.operationId)
      },
      request
    );
  }

  async moveModOrderItem(
    projectDirectory: unknown,
    profileName: unknown,
    orderItemId: unknown,
    targetIndex: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraModOrderItem[]> {
    const request = normalizeOperationRequest(rawRequest, 'mods_move_order_item');
    return this.requestBridge<FluxoraModOrderItem[]>(
      'mods.moveOrderItem',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        profileName: optionalString(profileName),
        orderItemId: requiredString(orderItemId, 'orderItemId', request.operationId),
        targetIndex: requiredInteger(targetIndex, 'targetIndex', request.operationId)
      },
      request
    );
  }

  async deleteInstalledMod(
    projectDirectory: unknown,
    modPath: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraModMutationResult> {
    const request = normalizeOperationRequest(rawRequest, 'mods_delete_installed');
    const modPathValue = requiredString(modPath, 'modPath', request.operationId);
    const reply = await this.requestBridge<{ accepted: boolean; modPath: string }>(
      'mods.deleteInstalled',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        modPath: modPathValue
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'mods_delete_installed')
    };
  }

  async createEmptyMod(
    projectDirectory: unknown,
    modName: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraInstalledMod> {
    const request = normalizeOperationRequest(rawRequest, 'mods_create_empty');
    return this.requestBridge<FluxoraInstalledMod>(
      'mods.createEmpty',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        modName: requiredString(modName, 'modName', request.operationId)
      },
      request
    );
  }

  async setInstalledModEnabled(
    projectDirectory: unknown,
    modPath: unknown,
    isEnabled: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraModMutationResult> {
    const request = normalizeOperationRequest(rawRequest, 'mods_set_enabled');
    const modPathValue = requiredString(modPath, 'modPath', request.operationId);
    const isEnabledValue = requiredBoolean(isEnabled, 'isEnabled', request.operationId);
    const reply = await this.requestBridge<{
      accepted: boolean;
      modPath: string;
      isEnabled: boolean;
    }>(
      'mods.setEnabled',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        modPath: modPathValue,
        isEnabled: isEnabledValue
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'mods_set_enabled')
    };
  }

  async setAllInstalledModsEnabled(
    projectDirectory: unknown,
    isEnabled: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraModMutationResult> {
    const request = normalizeOperationRequest(rawRequest, 'mods_set_all_enabled');
    const isEnabledValue = requiredBoolean(isEnabled, 'isEnabled', request.operationId);
    const reply = await this.requestBridge<{ accepted: boolean; isEnabled: boolean }>(
      'mods.setAllEnabled',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        isEnabled: isEnabledValue
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'mods_set_all_enabled')
    };
  }

  async checkModUpdates(
    projectDirectory: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraInstalledMod[]> {
    const request = normalizeOperationRequest(rawRequest, 'mods_check_updates');
    return this.requestBridge<FluxoraInstalledMod[]>(
      'mods.checkUpdates',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId)
      },
      request
    );
  }

  async getModFileTree(
    projectDirectory: unknown,
    modPath: unknown,
    relativeDirectory: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraModFileTreeEntry[]> {
    const request = normalizeOperationRequest(rawRequest, 'mods_get_file_tree');
    return this.requestBridge<FluxoraModFileTreeEntry[]>(
      'mods.getFileTree',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        modPath: requiredString(modPath, 'modPath', request.operationId),
        relativeDirectory: optionalString(relativeDirectory)
      },
      request
    );
  }

  async listPlugins(
    projectDirectory: unknown,
    templateId: unknown,
    profileName: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraPluginOrderItem[]> {
    const request = normalizeOperationRequest(rawRequest, 'plugins_list');
    return this.requestBridge<FluxoraPluginOrderItem[]>(
      'plugins.list',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        templateId: requiredString(templateId, 'templateId', request.operationId),
        profileName: optionalString(profileName)
      },
      request
    );
  }

  async createPluginSeparator(
    projectDirectory: unknown,
    templateId: unknown,
    profileName: unknown,
    title: unknown,
    targetIndex: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraPluginOrderItem[]> {
    const request = normalizeOperationRequest(rawRequest, 'plugins_create_separator');
    return this.requestBridge<FluxoraPluginOrderItem[]>(
      'plugins.createSeparator',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        templateId: requiredString(templateId, 'templateId', request.operationId),
        profileName: optionalString(profileName),
        title: requiredString(title, 'title', request.operationId),
        targetIndex: requiredInteger(targetIndex, 'targetIndex', request.operationId)
      },
      request
    );
  }

  async deletePluginSeparator(
    projectDirectory: unknown,
    templateId: unknown,
    profileName: unknown,
    separatorId: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraPluginOrderItem[]> {
    const request = normalizeOperationRequest(rawRequest, 'plugins_delete_separator');
    return this.requestBridge<FluxoraPluginOrderItem[]>(
      'plugins.deleteSeparator',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        templateId: requiredString(templateId, 'templateId', request.operationId),
        profileName: optionalString(profileName),
        separatorId: requiredString(separatorId, 'separatorId', request.operationId)
      },
      request
    );
  }

  async movePlugin(
    projectDirectory: unknown,
    templateId: unknown,
    profileName: unknown,
    orderItemId: unknown,
    targetIndex: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraPluginOrderItem[]> {
    const request = normalizeOperationRequest(rawRequest, 'plugins_move');
    return this.requestBridge<FluxoraPluginOrderItem[]>(
      'plugins.move',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        templateId: requiredString(templateId, 'templateId', request.operationId),
        profileName: optionalString(profileName),
        orderItemId: requiredString(orderItemId, 'orderItemId', request.operationId),
        targetIndex: requiredInteger(targetIndex, 'targetIndex', request.operationId)
      },
      request
    );
  }

  async setPluginEnabled(
    projectDirectory: unknown,
    templateId: unknown,
    profileName: unknown,
    pluginName: unknown,
    isEnabled: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraPluginOrderItem[]> {
    const request = normalizeOperationRequest(rawRequest, 'plugins_set_enabled');
    return this.requestBridge<FluxoraPluginOrderItem[]>(
      'plugins.setEnabled',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        templateId: requiredString(templateId, 'templateId', request.operationId),
        profileName: optionalString(profileName),
        pluginName: requiredString(pluginName, 'pluginName', request.operationId),
        isEnabled: requiredBoolean(isEnabled, 'isEnabled', request.operationId)
      },
      request
    );
  }

  async listProfiles(
    projectDirectory: unknown,
    defaultProfileName: unknown,
    rawRequest?: unknown
  ): Promise<string[]> {
    const request = normalizeOperationRequest(rawRequest, 'profiles_list');
    return this.requestBridge<string[]>(
      'profiles.list',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        defaultProfileName: optionalString(defaultProfileName)
      },
      request
    );
  }

  async createProfile(
    projectDirectory: unknown,
    profileName: unknown,
    defaultProfileName: unknown,
    profileFiles: unknown,
    rawRequest?: unknown
  ): Promise<string[]> {
    const request = normalizeOperationRequest(rawRequest, 'profiles_create');
    return this.requestBridge<string[]>(
      'profiles.create',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        profileName: requiredString(profileName, 'profileName', request.operationId),
        defaultProfileName: optionalString(defaultProfileName),
        profileFiles: optionalStringArrayAllowEmpty(profileFiles, 'profileFiles', request.operationId)
      },
      request
    );
  }

  async cloneProfile(
    projectDirectory: unknown,
    sourceProfileName: unknown,
    targetProfileName: unknown,
    defaultProfileName: unknown,
    rawRequest?: unknown
  ): Promise<string[]> {
    const request = normalizeOperationRequest(rawRequest, 'profiles_clone');
    return this.requestBridge<string[]>(
      'profiles.clone',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        sourceProfileName: requiredString(
          sourceProfileName,
          'sourceProfileName',
          request.operationId
        ),
        targetProfileName: requiredString(
          targetProfileName,
          'targetProfileName',
          request.operationId
        ),
        defaultProfileName: optionalString(defaultProfileName)
      },
      request
    );
  }

  async renameProfile(
    projectDirectory: unknown,
    sourceProfileName: unknown,
    targetProfileName: unknown,
    defaultProfileName: unknown,
    rawRequest?: unknown
  ): Promise<string[]> {
    const request = normalizeOperationRequest(rawRequest, 'profiles_rename');
    return this.requestBridge<string[]>(
      'profiles.rename',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        sourceProfileName: requiredString(
          sourceProfileName,
          'sourceProfileName',
          request.operationId
        ),
        targetProfileName: requiredString(
          targetProfileName,
          'targetProfileName',
          request.operationId
        ),
        defaultProfileName: optionalString(defaultProfileName)
      },
      request
    );
  }

  async deleteProfile(
    projectDirectory: unknown,
    profileName: unknown,
    defaultProfileName: unknown,
    rawRequest?: unknown
  ): Promise<string[]> {
    const request = normalizeOperationRequest(rawRequest, 'profiles_delete');
    return this.requestBridge<string[]>(
      'profiles.delete',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        profileName: requiredString(profileName, 'profileName', request.operationId),
        defaultProfileName: optionalString(defaultProfileName)
      },
      request
    );
  }

  async listExecutables(
    configPath: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraExecutable[]> {
    const request = normalizeOperationRequest(rawRequest, 'executables_list');
    return this.requestBridge<FluxoraExecutable[]>(
      'executables.list',
      {
        configPath: requiredString(configPath, 'configPath', request.operationId)
      },
      request
    );
  }

  async saveExecutables(
    configPath: unknown,
    executables: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraExecutable[]> {
    const request = normalizeOperationRequest(rawRequest, 'executables_save');
    const normalized = normalizedExecutableEntries(executables, request.operationId);
    return this.requestBridge<FluxoraExecutable[]>(
      'executables.save',
      {
        configPath: requiredString(configPath, 'configPath', request.operationId),
        executablesJson: JSON.stringify(normalized)
      },
      request
    );
  }

  async launchExecutable(
    configPath: unknown,
    executableId: unknown,
    profileName: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraExecutableLaunchResult> {
    const request = normalizeOperationRequest(rawRequest, 'executables_launch');
    const reply = await this.requestBridge<Omit<FluxoraExecutableLaunchResult, 'operationId'>>(
      'executables.launch',
      {
        configPath: requiredString(configPath, 'configPath', request.operationId),
        executableId: requiredString(executableId, 'executableId', request.operationId),
        profileName: optionalString(profileName)
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'executables_launch')
    };
  }

  async getExecutableIcon(
    executablePath: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraExecutableIconResult> {
    const request = normalizeOperationRequest(rawRequest, 'executables_icon');
    const reply = await this.requestBridge<ExecutableIconPayload>(
      'executables.getIcon',
      {
        executablePath: requiredString(executablePath, 'executablePath', request.operationId)
      },
      request
    );

    return {
      iconPath: reply.iconPath,
      operationId: normalizedOperationId(request, 'executables_icon')
    };
  }

  async getNexusAuthStatus(rawRequest?: unknown): Promise<FluxoraNexusModsAuthStatus> {
    const request = normalizeOperationRequest(rawRequest, 'nexus_status');
    const reply = await this.requestBridge<Omit<FluxoraNexusModsAuthStatus, 'operationId'>>(
      'nexus.getAuthStatus',
      {},
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'nexus_status')
    };
  }

  async connectNexus(rawRequest?: unknown): Promise<FluxoraNexusModsAuthStatus> {
    const request = normalizeOperationRequest(rawRequest, 'nexus_connect');
    const reply = await this.requestBridge<Omit<FluxoraNexusModsAuthStatus, 'operationId'>>(
      'nexus.connect',
      {},
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'nexus_connect')
    };
  }

  async disconnectNexus(rawRequest?: unknown): Promise<FluxoraNexusModsAuthStatus> {
    const request = normalizeOperationRequest(rawRequest, 'nexus_disconnect');
    const reply = await this.requestBridge<Omit<FluxoraNexusModsAuthStatus, 'operationId'>>(
      'nexus.disconnect',
      {},
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'nexus_disconnect')
    };
  }

  async analyzeMo2Transfer(
    sourceDirectory: unknown,
    destinationRootDirectory: unknown,
    existingConfigPath: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraModOrganizerImportAnalysis> {
    const request = normalizeOperationRequest(rawRequest, 'transfer_analyze_mo2');
    const reply = await this.requestBridge<Omit<FluxoraModOrganizerImportAnalysis, 'operationId'>>(
      'transfer.analyzeMo2',
      {
        sourceDirectory: requiredString(sourceDirectory, 'sourceDirectory', request.operationId),
        destinationRootDirectory: requiredString(
          destinationRootDirectory,
          'destinationRootDirectory',
          request.operationId
        ),
        existingConfigPath: optionalString(existingConfigPath)
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'transfer_analyze_mo2')
    };
  }

  async importMo2Transfer(
    rawImport: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraProject> {
    const request = normalizeOperationRequest(rawRequest, 'transfer_import_mo2');
    if (!rawImport || typeof rawImport !== 'object') {
      throw validationError(
        'bridge.mo2ImportRequestRequired',
        'MO2 import request is required.',
        request.operationId
      );
    }

    const importRequest = rawImport as Partial<FluxoraModOrganizerImportRequest>;
    return this.requestBridge<FluxoraProject>(
      'transfer.importMo2',
      {
        sourceDirectory: requiredString(importRequest.sourceDirectory, 'sourceDirectory', request.operationId),
        destinationRootDirectory: requiredString(
          importRequest.destinationRootDirectory,
          'destinationRootDirectory',
          request.operationId
        ),
        existingConfigPath: optionalString(importRequest.existingConfigPath),
        replaceExisting: requiredBoolean(importRequest.replaceExisting, 'replaceExisting', request.operationId)
      },
      request,
      { timeoutMs: mo2ImportBridgeTimeoutMs }
    );
  }

  async cancelOperation(
    operationId: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraOperationCancelResult> {
    const request = normalizeOperationRequest(rawRequest, 'operations_cancel');
    const targetOperationId = requiredString(operationId, 'operationId', request.operationId);
    const reply = await this.requestBridge<OperationCancelPayload>(
      'operations.cancel',
      { operationId: targetOperationId },
      request
    );

    return {
      ...reply,
      operationId: targetOperationId
    };
  }

  async registerNxmProtocol(
    executablePath: unknown,
    electronRegistered: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraNxmProtocolResult> {
    const request = normalizeOperationRequest(rawRequest, 'nxm_register_protocol');
    const operationId = normalizedOperationId(request, 'nxm_register_protocol');
    const platform = process.platform;

    if (platform !== 'win32') {
      return {
        registered: Boolean(electronRegistered),
        platform,
        state: 'limited',
        message:
          platform === 'darwin'
            ? 'macOS NXM handling requires app bundle URL scheme metadata during packaging.'
            : 'Linux NXM handling requires .desktop and xdg registration during packaging.',
        operationId
      };
    }

    const executablePathValue = requiredString(executablePath, 'executablePath', request.operationId);
    const reply = await this.requestBridge<RegisterNxmProtocolPayload>(
      'nxm.registerProtocol',
      { executablePath: executablePathValue },
      request
    );

    return {
      registered: Boolean(electronRegistered) && reply.isRegistered,
      isRegistered: reply.isRegistered,
      platform,
      state: reply.isRegistered ? 'available' : 'limited',
      message: reply.isRegistered
        ? 'Fluxora is registered for NXM Mod Manager links.'
        : 'Electron accepted the protocol request, but Windows registry verification did not confirm Fluxora as handler.',
      operationId
    };
  }

  async captureNxmLinks(
    projectDirectory: unknown,
    links: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraDownloadEntry[]> {
    const request = normalizeOperationRequest(rawRequest, 'nxm_capture_links');
    return this.requestBridge<FluxoraDownloadEntry[]>(
      'nxm.captureLinks',
      {
        projectDirectory: optionalString(projectDirectory),
        links: requiredStringArray(links, 'links', request.operationId)
      },
      request
    );
  }

  async importInboundDownloads(
    projectDirectory: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraDownloadEntry[]> {
    const request = normalizeOperationRequest(rawRequest, 'nxm_import_inbound');
    return this.requestBridge<FluxoraDownloadEntry[]>(
      'nxm.importInboundDownloads',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId)
      },
      request
    );
  }

  async listDownloads(
    projectDirectory: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraDownloadEntry[]> {
    const request = normalizeOperationRequest(rawRequest, 'downloads_list');
    return this.requestBridge<FluxoraDownloadEntry[]>(
      'downloads.list',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId)
      },
      request
    );
  }

  async importDownloadFile(
    projectDirectory: unknown,
    sourcePath: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraDownloadEntry> {
    const request = normalizeOperationRequest(rawRequest, 'downloads_import_file');
    return this.requestBridge<FluxoraDownloadEntry>(
      'downloads.importFile',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        sourcePath: requiredString(sourcePath, 'sourcePath', request.operationId)
      },
      request
    );
  }

  async deleteDownload(
    projectDirectory: unknown,
    downloadPath: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraDownloadMutationResult> {
    const request = normalizeOperationRequest(rawRequest, 'downloads_delete');
    const reply = await this.requestBridge<DeleteDownloadPayload>(
      'downloads.delete',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        downloadPath: requiredString(downloadPath, 'downloadPath', request.operationId)
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'downloads_delete')
    };
  }

  async cancelDownload(
    projectDirectory: unknown,
    downloadPath: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraDownloadMutationResult> {
    const request = normalizeOperationRequest(rawRequest, 'downloads_cancel');
    const reply = await this.requestBridge<DeleteDownloadPayload>(
      'downloads.cancel',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        downloadPath: requiredString(downloadPath, 'downloadPath', request.operationId)
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'downloads_cancel')
    };
  }

  async resumeDownload(
    projectDirectory: unknown,
    downloadPath: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraDownloadEntry> {
    const request = normalizeOperationRequest(rawRequest, 'downloads_resume');
    return this.requestBridge<FluxoraDownloadEntry>(
      'downloads.resume',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        downloadPath: requiredString(downloadPath, 'downloadPath', request.operationId)
      },
      request
    );
  }

  async analyzeDownloadContentLayout(
    rawAnalyze: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraContentLayoutPreview> {
    const request = normalizeOperationRequest(rawRequest, 'downloads_analyze_layout');
    if (!rawAnalyze || typeof rawAnalyze !== 'object') {
      throw validationError(
        'bridge.downloadContentLayoutAnalyzeRequestRequired',
        'Content layout analysis request is required.',
        request.operationId
      );
    }

    const analyze = rawAnalyze as Partial<FluxoraAnalyzeContentLayoutRequest>;
    return this.requestBridge<FluxoraContentLayoutPreview>(
      'downloads.analyzeContentLayout',
      {
        projectDirectory: requiredString(analyze.projectDirectory, 'projectDirectory', request.operationId),
        downloadPath: requiredString(analyze.downloadPath, 'downloadPath', request.operationId),
        existingModMode: optionalExistingModMode(analyze.existingModMode, request.operationId)
      },
      request
    );
  }

  async analyzeFomodDownload(
    projectDirectory: unknown,
    downloadPath: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraFomodInstaller> {
    const request = normalizeOperationRequest(rawRequest, 'downloads_analyze_fomod');
    return this.requestBridge<FluxoraFomodInstaller>(
      'downloads.analyzeFomod',
      {
        projectDirectory: requiredString(projectDirectory, 'projectDirectory', request.operationId),
        downloadPath: requiredString(downloadPath, 'downloadPath', request.operationId)
      },
      request
    );
  }

  async analyzeFomodDownloadContentLayout(
    rawAnalyze: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraContentLayoutPreview> {
    const request = normalizeOperationRequest(rawRequest, 'downloads_analyze_fomod_layout');
    if (!rawAnalyze || typeof rawAnalyze !== 'object') {
      throw validationError(
        'bridge.fomodContentLayoutAnalyzeRequestRequired',
        'FOMOD content layout analysis request is required.',
        request.operationId
      );
    }

    const analyze = rawAnalyze as Partial<FluxoraAnalyzeFomodContentLayoutRequest>;
    const selectedOptionIds = requiredStringArrayAllowEmpty(
      analyze.selectedOptionIds,
      'selectedOptionIds',
      request.operationId
    );

    return this.requestBridge<FluxoraContentLayoutPreview>(
      'downloads.analyzeFomodContentLayout',
      {
        projectDirectory: requiredString(analyze.projectDirectory, 'projectDirectory', request.operationId),
        downloadPath: requiredString(analyze.downloadPath, 'downloadPath', request.operationId),
        existingModMode: optionalExistingModMode(analyze.existingModMode, request.operationId),
        selectedOptionIdsJson: JSON.stringify(selectedOptionIds)
      },
      request
    );
  }

  async installDownload(
    rawInstall: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraInstalledModSummary> {
    const request = normalizeOperationRequest(rawRequest, 'downloads_install');
    if (!rawInstall || typeof rawInstall !== 'object') {
      throw validationError(
        'bridge.downloadInstallRequestRequired',
        'Download install request is required.',
        request.operationId
      );
    }

    const install = rawInstall as Partial<FluxoraInstallDownloadRequest>;
    const reply = await this.requestBridge<Omit<FluxoraInstalledModSummary, 'operationId'>>(
      'downloads.install',
      {
        projectDirectory: requiredString(install.projectDirectory, 'projectDirectory', request.operationId),
        downloadPath: requiredString(install.downloadPath, 'downloadPath', request.operationId),
        modName: requiredString(install.modName, 'modName', request.operationId),
        existingModMode: optionalExistingModMode(install.existingModMode, request.operationId),
        placementOverridesJson: optionalString(install.placementOverridesJson)
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'downloads_install')
    };
  }

  async installFomodDownload(
    rawInstall: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraInstalledModSummary> {
    const request = normalizeOperationRequest(rawRequest, 'downloads_install_fomod');
    if (!rawInstall || typeof rawInstall !== 'object') {
      throw validationError(
        'bridge.fomodDownloadInstallRequestRequired',
        'FOMOD download install request is required.',
        request.operationId
      );
    }

    const install = rawInstall as Partial<FluxoraInstallFomodDownloadRequest>;
    const selectedOptionIds = requiredStringArrayAllowEmpty(
      install.selectedOptionIds,
      'selectedOptionIds',
      request.operationId
    );
    const reply = await this.requestBridge<Omit<FluxoraInstalledModSummary, 'operationId'>>(
      'downloads.installFomod',
      {
        projectDirectory: requiredString(install.projectDirectory, 'projectDirectory', request.operationId),
        downloadPath: requiredString(install.downloadPath, 'downloadPath', request.operationId),
        modName: requiredString(install.modName, 'modName', request.operationId),
        existingModMode: optionalExistingModMode(install.existingModMode, request.operationId),
        selectedOptionIdsJson: JSON.stringify(selectedOptionIds),
        placementOverridesJson: optionalString(install.placementOverridesJson)
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'downloads_install_fomod')
    };
  }

  async installArchive(
    rawInstall: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraInstalledModSummary> {
    const request = normalizeOperationRequest(rawRequest, 'archives_install');
    if (!rawInstall || typeof rawInstall !== 'object') {
      throw validationError(
        'bridge.archiveInstallRequestRequired',
        'Archive install request is required.',
        request.operationId
      );
    }

    const install = rawInstall as Partial<FluxoraInstallArchiveRequest>;
    const reply = await this.requestBridge<Omit<FluxoraInstalledModSummary, 'operationId'>>(
      'archives.install',
      {
        projectDirectory: requiredString(install.projectDirectory, 'projectDirectory', request.operationId),
        archivePath: requiredString(install.archivePath, 'archivePath', request.operationId),
        modName: requiredString(install.modName, 'modName', request.operationId),
        existingModMode: optionalExistingModMode(install.existingModMode, request.operationId),
        placementOverridesJson: optionalString(install.placementOverridesJson)
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'archives_install')
    };
  }

  async installFomodArchive(
    rawInstall: unknown,
    rawRequest?: unknown
  ): Promise<FluxoraInstalledModSummary> {
    const request = normalizeOperationRequest(rawRequest, 'archives_install_fomod');
    if (!rawInstall || typeof rawInstall !== 'object') {
      throw validationError(
        'bridge.fomodArchiveInstallRequestRequired',
        'FOMOD archive install request is required.',
        request.operationId
      );
    }

    const install = rawInstall as Partial<FluxoraInstallFomodArchiveRequest>;
    const selectedOptionIds = requiredStringArrayAllowEmpty(
      install.selectedOptionIds,
      'selectedOptionIds',
      request.operationId
    );
    const reply = await this.requestBridge<Omit<FluxoraInstalledModSummary, 'operationId'>>(
      'archives.installFomod',
      {
        projectDirectory: requiredString(install.projectDirectory, 'projectDirectory', request.operationId),
        archivePath: requiredString(install.archivePath, 'archivePath', request.operationId),
        modName: requiredString(install.modName, 'modName', request.operationId),
        existingModMode: optionalExistingModMode(install.existingModMode, request.operationId),
        selectedOptionIdsJson: JSON.stringify(selectedOptionIds),
        placementOverridesJson: optionalString(install.placementOverridesJson)
      },
      request
    );

    return {
      ...reply,
      operationId: normalizedOperationId(request, 'archives_install_fomod')
    };
  }

  async shutdown(rawRequest?: unknown): Promise<{ accepted: boolean; operationId: string }> {
    const request = normalizeOperationRequest(rawRequest, 'bridge_shutdown');
    if (!this.client) {
      return {
        accepted: true,
        operationId: request.operationId ?? createOperationId('bridge_shutdown')
      };
    }

    try {
      await this.client.request<{ accepted: boolean }>('system.shutdown', {}, request);
    } finally {
      await this.client.stop();
      this.client = null;
      this.handshake = null;
    }

    return {
      accepted: true,
      operationId: request.operationId ?? createOperationId('bridge_shutdown')
    };
  }

  private async requestBridge<T>(
    method: string,
    params: Record<string, unknown>,
    request: OperationRequest,
    options: BridgeRequestOptions = {}
  ): Promise<T> {
    const client = await this.ensureClient();
    await this.ensureHandshake(client, request);
    const reply = await client.request<T>(method, params, request, options);
    return reply.data;
  }

  private async ensureClient(): Promise<BridgeProtocolClient> {
    if (this.client) {
      return this.client;
    }

    this.hostPath = await resolveBridgeHostPath();
    if (!this.hostPath) {
      throw new BridgeRequestError(
        createTransportError(
          'bridge.hostNotFound',
          'FluxoraBridgeHost was not found. Build the backend target FluxoraBridgeHost or set FLUXORA_BRIDGE_HOST_PATH.',
          false
        )
      );
    }

    const client = new BridgeProtocolClient(
      new ChildProcessBridgeTransport(this.hostPath),
      {
        appVersion: app.getVersion(),
        locale: app.getLocale()
      },
      this.logger
    );
    client.onEvent('operations.progress', (event) => {
      const progress = normalizeOperationProgress(event.params, event.operationId);
      if (!progress) {
        return;
      }

      for (const listener of this.progressListeners) {
        listener(progress);
      }
    });
    this.client = client;

    return this.client;
  }

  private async ensureHandshake(
    client: BridgeProtocolClient,
    request: OperationRequest
  ): Promise<HandshakePayload> {
    if (this.handshake) {
      return this.handshake;
    }

    const reply = await client.request<HandshakePayload>(
      'system.handshake',
      { supportedProtocolVersions: ['1.0'] },
      request
    );
    this.handshake = reply.data;
    await this.logger.write(
      'main-bridge',
      'info',
      'NativeBridge',
      `handshake ${reply.data.protocolVersion}`,
      request.operationId
    );
    return this.handshake;
  }
}

export const resolveBridgeHostPath = async (): Promise<string | null> => {
  const executable = hostExecutableName();
  const fromEnv = process.env.FLUXORA_BRIDGE_HOST_PATH;
  const appPath = app.getAppPath();
  const repoRoot = path.resolve(appPath, '..');
  const candidates = [
    fromEnv,
    app.isPackaged ? path.join(process.resourcesPath, 'native', executable) : undefined,
    path.resolve(repoRoot, 'build', 'backend', executable),
    path.resolve(repoRoot, 'build', 'backend', 'Debug', executable),
    path.resolve(repoRoot, 'build', 'backend', 'Release', executable),
    path.resolve(repoRoot, 'build', 'backend', 'RelWithDebInfo', executable),
    path.resolve(process.cwd(), '..', 'build', 'backend', executable),
    path.resolve(process.cwd(), '..', 'build', 'backend', 'Debug', executable),
    path.resolve(process.cwd(), '..', 'build', 'backend', 'Release', executable),
    path.resolve(process.cwd(), '..', 'build', 'backend', 'RelWithDebInfo', executable)
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await canAccessFile(candidate)) {
      return candidate;
    }
  }

  return null;
};
