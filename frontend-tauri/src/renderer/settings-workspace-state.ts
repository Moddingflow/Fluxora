import type {
  FluxoraAppInfo,
  FluxoraPlatformSupport,
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportProgress,
  FluxoraTransferDriveOption,
  FluxoraThemeMode,
  NativeBridgeFeatureState,
  NativeBridgeStatus
} from '../shared/fluxora-api';

export type SettingsSectionId = 'connections' | 'language' | 'transfer';

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
}

export const settingsSections: SettingsSection[] = [
  {
    id: 'connections',
    label: 'Привязки'
  },
  {
    id: 'language',
    label: 'Language'
  },
  {
    id: 'transfer',
    label: 'Перенос'
  }
];

export interface LanguageOption {
  code: string;
  label: string;
  nativeLabel: string;
}

export const languageOptions: LanguageOption[] = [
  { code: 'en-us', label: 'English', nativeLabel: 'English' },
  { code: 'ru-ru', label: 'Russian', nativeLabel: 'Русский' },
  { code: 'de-de', label: 'German', nativeLabel: 'Deutsch' }
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
