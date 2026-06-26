import type {
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

export type SettingsSectionId = 'connections' | 'language' | 'transfer';

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
  }
];

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

export const nexusConnectionSummary = (
  status: FluxoraNexusModsAuthStatus | null
): string => {
  if (!status) {
    return 'Status not loaded';
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

export const nexusActionLabel = (status: FluxoraNexusModsAuthStatus | null): string =>
  status?.isLinked ? 'Disconnect Nexus Mods' : 'Link Nexus Mods with OAuth';

export const nexusCanToggle = (
  status: FluxoraNexusModsAuthStatus | null,
  nexusAvailable: boolean
): boolean =>
  nexusAvailable &&
  Boolean(status) &&
  (Boolean(status?.isLinked) || Boolean(status?.isConfigured));

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
