import type {
  FluxoraApiLimitProvider,
  FluxoraApiRateLimitWindow,
  FluxoraAppInfo,
  FluxoraPlatformSupport,
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportProgress,
  FluxoraNexusModsAuthStatus,
  FluxoraProject,
  FluxoraTransferDriveOption,
  FluxoraThemeMode,
  NativeBridgeFeatureState,
  NativeBridgeStatus
} from '../shared/fluxora-api';

export type SettingsSectionId = 'connections' | 'language' | 'transfer' | 'developers';

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  hint: string;
}

export const settingsSections: SettingsSection[] = [
  {
    id: 'connections',
    label: 'Connections',
    hint: ''
  },
  {
    id: 'language',
    label: 'Languages',
    hint: 'EN / RU / DE'
  },
  {
    id: 'transfer',
    label: 'Transfer',
    hint: 'MO2 import'
  },
  {
    id: 'developers',
    label: 'Для разработчиков',
    hint: 'Debug'
  }
];

export const developerModeStorageKey = 'fluxora.settings.developerMode';

export const fluxoraOriginalRepositoryUrl = 'https://github.com/WhistleSkyrim/Fluxora';

export const loadDeveloperModeSetting = (
  storage: Pick<Storage, 'getItem'> | null | undefined
): boolean => {
  try {
    return storage?.getItem(developerModeStorageKey) === 'true';
  } catch {
    return false;
  }
};

export const saveDeveloperModeSetting = (
  storage: Pick<Storage, 'setItem'> | null | undefined,
  enabled: boolean
): void => {
  try {
    storage?.setItem(developerModeStorageKey, enabled ? 'true' : 'false');
  } catch {
    // Local storage can be unavailable in restricted preview contexts.
  }
};

const formatUtcPart = (value: number): string => value.toString().padStart(2, '0');

export const formatLastBuildDate = (value: string | null | undefined): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 'pending';
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }

  const datePart = [
    date.getUTCFullYear(),
    formatUtcPart(date.getUTCMonth() + 1),
    formatUtcPart(date.getUTCDate())
  ].join('-');
  const timePart = [
    formatUtcPart(date.getUTCHours()),
    formatUtcPart(date.getUTCMinutes())
  ].join(':');
  return `${datePart} ${timePart} UTC`;
};

export interface LanguageOption {
  code: string;
  countryCode: string;
  countryName: string;
  label: string;
  nativeLabel: string;
}

export const languageOptions: LanguageOption[] = [
  {
    code: 'en-us',
    countryCode: 'gb',
    countryName: 'United Kingdom',
    label: 'English',
    nativeLabel: 'English'
  },
  {
    code: 'ru-ru',
    countryCode: 'ru',
    countryName: 'Russia',
    label: 'Russian',
    nativeLabel: 'Русский'
  },
  {
    code: 'de-de',
    countryCode: 'de',
    countryName: 'Germany',
    label: 'German',
    nativeLabel: 'Deutsch'
  }
];

export const defaultThemeMode: FluxoraThemeMode = 'dark';
export const supportedThemeModes: readonly FluxoraThemeMode[] = [defaultThemeMode];
export const nexusStatusStorageKey = 'fluxora.settings.nexusStatus';

const defaultNexusClientId = 'fluxora';
const defaultNexusRedirectUri = 'http://127.0.0.1:8089/callback';
const instantNexusStatusOperationId = 'renderer_instant_nexus_status';

export type NexusAuthVerificationState = 'checking' | 'stale' | 'unavailable' | 'verified';

export interface NexusAuthViewStatus extends FluxoraNexusModsAuthStatus {
  verificationState: NexusAuthVerificationState;
  lastKnownLinked: boolean;
  lastKnownDisplayName: string;
  lastKnownUserId: string;
}

export const normalizeThemeMode = (theme: unknown): FluxoraThemeMode =>
  supportedThemeModes.includes(theme as FluxoraThemeMode)
    ? (theme as FluxoraThemeMode)
    : defaultThemeMode;

export const settingsCapabilityView = (bridgeStatus: NativeBridgeStatus | null) => {
  const features = bridgeStatus?.capabilities?.features ?? {};
  const transferAvailable = features.mo2Transfer?.state === 'available';
  return {
    settingsAvailable: features.settings?.state === 'available',
    nexusAvailable: features.nexusAuth?.state === 'available',
    transferAvailable,
    transferCancellationAvailable: transferAvailable
  };
};

export const createInstantNexusAuthStatus = (
  operationId = instantNexusStatusOperationId
): NexusAuthViewStatus => ({
  isConfigured: true,
  isLinked: false,
  isPremium: false,
  hasApiKey: false,
  displayName: '',
  userId: '',
  message: 'Checking Nexus Mods status.',
  clientId: defaultNexusClientId,
  redirectUri: defaultNexusRedirectUri,
  operationId,
  verificationState: 'checking',
  lastKnownLinked: false,
  lastKnownDisplayName: '',
  lastKnownUserId: ''
});

export const isInstantNexusAuthStatus = (
  status: FluxoraNexusModsAuthStatus | null
): boolean => status?.operationId === instantNexusStatusOperationId;

const statusVerificationState = (
  status: FluxoraNexusModsAuthStatus | NexusAuthViewStatus | null
): NexusAuthVerificationState =>
  status && 'verificationState' in status ? status.verificationState : 'verified';

export const nexusIsVerified = (
  status: FluxoraNexusModsAuthStatus | NexusAuthViewStatus | null
): boolean => Boolean(status) && statusVerificationState(status) === 'verified';

export const nexusIsVerifiedLinked = (
  status: FluxoraNexusModsAuthStatus | NexusAuthViewStatus | null
): boolean => nexusIsVerified(status) && Boolean(status?.isLinked);

export const createVerifiedNexusAuthStatus = (
  status: FluxoraNexusModsAuthStatus
): NexusAuthViewStatus => ({
  ...status,
  verificationState: 'verified',
  lastKnownLinked: Boolean(status.isLinked),
  lastKnownDisplayName: status.displayName,
  lastKnownUserId: status.userId
});

export const createCheckingNexusAuthStatus = (
  status: FluxoraNexusModsAuthStatus | NexusAuthViewStatus | null | undefined,
  operationId = instantNexusStatusOperationId
): NexusAuthViewStatus => {
  const lastKnownLinked = Boolean(
    status && (nexusIsVerifiedLinked(status) || ('lastKnownLinked' in status && status.lastKnownLinked))
  );
  const lastKnownDisplayName =
    (status && 'lastKnownDisplayName' in status ? status.lastKnownDisplayName : '') ||
    (lastKnownLinked ? status?.displayName ?? '' : '');
  const lastKnownUserId =
    (status && 'lastKnownUserId' in status ? status.lastKnownUserId : '') ||
    (lastKnownLinked ? status?.userId ?? '' : '');

  return {
    isConfigured: status?.isConfigured ?? true,
    isLinked: false,
    isPremium: false,
    hasApiKey: false,
    displayName: '',
    userId: '',
    message: 'Checking Nexus Mods status.',
    clientId: status?.clientId || defaultNexusClientId,
    redirectUri: status?.redirectUri || defaultNexusRedirectUri,
    operationId,
    verificationState: 'checking',
    lastKnownLinked,
    lastKnownDisplayName,
    lastKnownUserId
  };
};

export const createUnavailableNexusAuthStatus = (
  status: FluxoraNexusModsAuthStatus | NexusAuthViewStatus | null | undefined,
  message: string,
  operationId = status?.operationId || instantNexusStatusOperationId
): NexusAuthViewStatus => ({
  ...createCheckingNexusAuthStatus(status, operationId),
  message: message.trim() || 'Nexus Mods status is temporarily unavailable. Retry the status check.',
  verificationState: 'unavailable'
});

const cachedString = (
  value: Record<string, unknown>,
  key: keyof FluxoraNexusModsAuthStatus,
  fallback = ''
): string => (typeof value[key] === 'string' ? value[key] : fallback);

const normalizeCachedNexusAuthStatus = (
  value: unknown
): NexusAuthViewStatus | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.isConfigured !== 'boolean') {
    return null;
  }

  const fallback = createInstantNexusAuthStatus();
  const lastKnownLinked =
    typeof record.lastKnownLinked === 'boolean'
      ? record.lastKnownLinked
      : typeof record.isLinked === 'boolean'
        ? record.isLinked
        : false;
  return {
    isConfigured: record.isConfigured,
    isLinked: false,
    isPremium: false,
    hasApiKey: false,
    displayName: '',
    userId: '',
    message: fallback.message,
    clientId: cachedString(record, 'clientId', fallback.clientId),
    redirectUri: cachedString(record, 'redirectUri', fallback.redirectUri),
    operationId: cachedString(record, 'operationId', fallback.operationId),
    verificationState: lastKnownLinked ? 'stale' : 'checking',
    lastKnownLinked,
    lastKnownDisplayName: cachedString(record, 'displayName'),
    lastKnownUserId: cachedString(record, 'userId')
  };
};

export const loadCachedNexusAuthStatus = (
  storage: Pick<Storage, 'getItem'> | null | undefined
): NexusAuthViewStatus => {
  try {
    const raw = storage?.getItem(nexusStatusStorageKey);
    if (!raw) {
      return createInstantNexusAuthStatus();
    }

    return normalizeCachedNexusAuthStatus(JSON.parse(raw)) ?? createInstantNexusAuthStatus();
  } catch {
    return createInstantNexusAuthStatus();
  }
};

export const saveCachedNexusAuthStatus = (
  storage: Pick<Storage, 'setItem'> | null | undefined,
  status: FluxoraNexusModsAuthStatus
): void => {
  try {
    storage?.setItem(
      nexusStatusStorageKey,
      JSON.stringify({
        isConfigured: status.isConfigured,
        lastKnownLinked: status.isLinked,
        displayName: status.displayName,
        userId: status.userId,
        clientId: status.clientId,
        redirectUri: status.redirectUri,
        operationId: status.operationId
      })
    );
  } catch {
    // Local storage can be unavailable in restricted preview contexts.
  }
};

export const nexusConnectionSummary = (
  status: FluxoraNexusModsAuthStatus | NexusAuthViewStatus | null
): string => {
  if (!status) {
    return 'Not linked';
  }

  if (!nexusIsVerified(status)) {
    const accountName =
      ('lastKnownDisplayName' in status ? status.lastKnownDisplayName : '') ||
      ('lastKnownUserId' in status ? status.lastKnownUserId : '');
    if (statusVerificationState(status) === 'unavailable') {
      return accountName ? `Unavailable - last linked as ${accountName}` : 'Status unavailable - retry';
    }
    if (accountName) {
      return `Checking - last linked as ${accountName}`;
    }

    return 'Checking status';
  }

  if (!status.isConfigured && !status.isLinked) {
    return 'OAuth is not configured in the native core';
  }

  if (!status.isLinked) {
    return 'Not linked';
  }

  const accountName = status.displayName || status.userId;
  return accountName ? `Linked - ${accountName}` : 'Linked';
};

export const nexusActionLabel = (
  status: FluxoraNexusModsAuthStatus | NexusAuthViewStatus | null
): string => {
  if (status && statusVerificationState(status) === 'unavailable') {
    return 'Retry Nexus Mods status';
  }

  if (status && !nexusIsVerified(status)) {
    return 'Checking Nexus Mods';
  }

  return nexusIsVerifiedLinked(status) ? 'Disconnect Nexus Mods' : 'Link Nexus Mods with OAuth';
};

export const nexusCanToggle = (
  status: FluxoraNexusModsAuthStatus | NexusAuthViewStatus | null,
  nexusAvailable: boolean
): boolean => {
  if (!nexusAvailable || !status || statusVerificationState(status) === 'checking') {
    return false;
  }

  if (!nexusIsVerified(status)) {
    return statusVerificationState(status) === 'stale' || statusVerificationState(status) === 'unavailable';
  }

  return Boolean(status.isLinked) || Boolean(status.isConfigured);
};

export const apiLimitProviderSummary = (provider: FluxoraApiLimitProvider): string => {
  if (provider.windows.length > 0) {
    return provider.message || 'Updated from API response headers';
  }

  switch (provider.state) {
    case 'unlinked':
      return provider.message || 'Account not linked';
    case 'not-provided':
      return provider.message || 'Rate-limit headers were not returned';
    case 'rate-limited':
      return provider.message || 'Rate limit reached';
    case 'unavailable':
      return provider.message || 'API limits unavailable';
    case 'available':
    default:
      return provider.message || 'API limits available';
  }
};

export const formatApiLimitUsage = (limitWindow: FluxoraApiRateLimitWindow): string => {
  const { limit, remaining } = limitWindow;
  if (typeof remaining === 'number' && typeof limit === 'number') {
    return `${remaining.toLocaleString()} / ${limit.toLocaleString()}`;
  }
  if (typeof remaining === 'number') {
    return `${remaining.toLocaleString()} remaining`;
  }
  if (typeof limit === 'number') {
    return `${limit.toLocaleString()} limit`;
  }
  return 'Not reported';
};

export const formatApiLimitReset = (limitWindow: FluxoraApiRateLimitWindow): string => {
  const raw = (limitWindow.resetAtUtc || limitWindow.resetRaw).trim();
  if (!raw) {
    return 'Reset not reported';
  }

  if (!limitWindow.resetAtUtc && /^\d+$/.test(raw)) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds < 1_000_000_000) {
      if (seconds < 60) {
        return `Reset in ${seconds}s`;
      }

      const minutes = Math.ceil(seconds / 60);
      if (minutes < 60) {
        return `Reset in ${minutes}m`;
      }

      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return remainingMinutes > 0 ? `Reset in ${hours}h ${remainingMinutes}m` : `Reset in ${hours}h`;
    }
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return `Reset ${formatUtcPart(date.getUTCHours())}:${formatUtcPart(date.getUTCMinutes())} UTC`;
  }

  return `Reset ${raw}`;
};

export const transferSettingsSummary = (
  progress: FluxoraModOrganizerImportProgress | null,
  result: FluxoraProject | null,
  error: string | null
): string => {
  if (error) {
    return error;
  }

  if (result) {
    return `Completed - ${result.name}`;
  }

  if (progress) {
    return transferProgressSummary(progress);
  }

  return 'Transfer mods, profiles, load order, and metadata from an existing MO2 build.';
};

export const transferSettingsProgressPercent = (
  progress: FluxoraModOrganizerImportProgress | null,
  result: FluxoraProject | null
): number | null => {
  if (result) {
    return 100;
  }

  if (!progress) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(progress.overallPercent)));
};

export interface PlatformSupportRow extends FluxoraPlatformSupport {
  isCurrent: boolean;
}

export const capabilityStateLabel = (
  state: NativeBridgeFeatureState | undefined
): string => {
  switch (state) {
    case 'available':
      return 'Available';
    case 'limited':
      return 'Limited';
    case 'unsupported':
      return 'Unsupported';
    case 'disabled':
      return 'Disabled';
    case 'runtime-shell':
      return 'Tauri shell';
    case 'unknown':
    default:
      return 'Unknown';
  }
};

export const platformSupportRows = (
  bridgeStatus: NativeBridgeStatus | null,
  appInfo: FluxoraAppInfo | null
): PlatformSupportRow[] => {
  const currentPlatform = bridgeStatus?.capabilities?.platform ?? appInfo?.platform ?? 'unknown';
  return (bridgeStatus?.capabilities?.supportMatrix ?? []).map((row) => ({
    ...row,
    isCurrent: row.platform === currentPlatform
  }));
};

export const currentPlatformSupport = (
  bridgeStatus: NativeBridgeStatus | null,
  appInfo: FluxoraAppInfo | null
): PlatformSupportRow | null => {
  const rows = platformSupportRows(bridgeStatus, appInfo);
  return rows.find((row) => row.isCurrent) ?? rows[0] ?? null;
};

export const platformSupportSummary = (
  bridgeStatus: NativeBridgeStatus | null,
  appInfo: FluxoraAppInfo | null
): string => {
  const current = currentPlatformSupport(bridgeStatus, appInfo);
  if (!current) {
    return 'Platform support matrix is not reported by the native bridge yet.';
  }

  const packageText = current.packageFormats.length > 0
    ? current.packageFormats.join(', ')
    : 'package format pending';
  return `${current.label}: ${capabilityStateLabel(current.state)} with ${packageText}.`;
};

export const platformFeatureState = (
  bridgeStatus: NativeBridgeStatus | null,
  featureId: string
): NativeBridgeFeatureState =>
  bridgeStatus?.capabilities?.features[featureId]?.state ?? 'unknown';

export const formatTransferBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

export const transferDriveRootForPath = (rawPath: string): string => {
  const value = rawPath.trim();
  const windowsDrive = value.match(/^([a-zA-Z]):[\\/]/);
  if (windowsDrive) {
    return `${windowsDrive[1].toUpperCase()}:\\`;
  }

  return value.startsWith('/') ? '/' : '';
};

export const findTransferDriveForPath = (
  drives: FluxoraTransferDriveOption[],
  rawPath: string
): FluxoraTransferDriveOption | null => {
  const root = transferDriveRootForPath(rawPath);
  if (!root) {
    return null;
  }

  return drives.find((drive) => drive.rootPath.toLowerCase() === root.toLowerCase()) ?? null;
};

export const selectPreferredTransferDrive = (
  drives: FluxoraTransferDriveOption[],
  preferredPath = '',
  requiredBytes = 0
): FluxoraTransferDriveOption | null => {
  const preferred = findTransferDriveForPath(drives, preferredPath);
  if (preferred) {
    return preferred;
  }

  const candidates = [...drives].sort((left, right) => {
    const leftFits = requiredBytes > 0 && left.availableBytes >= requiredBytes ? 1 : 0;
    const rightFits = requiredBytes > 0 && right.availableBytes >= requiredBytes ? 1 : 0;
    if (leftFits !== rightFits) {
      return rightFits - leftFits;
    }

    return right.availableBytes - left.availableBytes;
  });

  return candidates[0] ?? null;
};

export const transferAnalysisStatus = (
  analysis: FluxoraModOrganizerImportAnalysis | null
): 'ready' | 'blocked' | 'empty' => {
  if (!analysis) {
    return 'empty';
  }

  return analysis.canImport && analysis.hasEnoughSpace ? 'ready' : 'blocked';
};

export const transferProgressSummary = (
  progress: FluxoraModOrganizerImportProgress | null
): string => {
  if (!progress) {
    return 'Waiting for import progress';
  }

  const bytes =
    progress.totalBytes > 0
      ? `${formatTransferBytes(progress.copiedBytes)} / ${formatTransferBytes(progress.totalBytes)}`
      : '';
  return [progress.currentStep || progress.phase || 'Importing', progress.currentItem, bytes]
    .filter(Boolean)
    .join(' - ');
};
