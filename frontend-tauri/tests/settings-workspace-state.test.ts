import { describe, expect, it } from 'vitest';

import {
  capabilityStateLabel,
  apiLimitProviderSummary,
  createCheckingNexusAuthStatus,
  createInstantNexusAuthStatus,
  createVerifiedNexusAuthStatus,
  formatApiLimitReset,
  formatApiLimitUsage,
  formatTransferBytes,
  currentPlatformSupport,
  developerModeStorageKey,
  fluxoraOriginalRepositoryUrl,
  formatLastBuildDate,
  languageOptions,
  isInstantNexusAuthStatus,
  loadCachedNexusAuthStatus,
  loadDeveloperModeSetting,
  nexusActionLabel,
  nexusCanToggle,
  nexusConnectionSummary,
  nexusIsVerifiedLinked,
  nexusStatusStorageKey,
  normalizeThemeMode,
  platformFeatureState,
  platformSupportRows,
  platformSupportSummary,
  saveCachedNexusAuthStatus,
  saveDeveloperModeSetting,
  selectPreferredTransferDrive,
  settingsCapabilityView,
  settingsSections,
  transferDriveRootForPath,
  transferAnalysisStatus,
  transferProgressSummary,
  transferSettingsProgressPercent,
  transferSettingsSummary
} from '../src/renderer/settings-workspace-state';
import type {
  FluxoraAppInfo,
  FluxoraApiLimitProvider,
  FluxoraModOrganizerImportAnalysis,
  FluxoraNexusModsAuthStatus,
  FluxoraProject,
  FluxoraTransferDriveOption,
  NativeBridgeStatus
} from '../src/shared/fluxora-api';

const baseAnalysis: FluxoraModOrganizerImportAnalysis = {
  sourceDirectory: 'C:\\MO2',
  destinationRootDirectory: 'C:\\Fluxora',
  targetProjectDirectory: 'C:\\Fluxora\\MO2',
  targetConfigPath: 'C:\\Fluxora\\MO2.json',
  projectName: 'MO2',
  profileName: 'Default',
  templateId: 'skyrimse',
  gameName: 'Skyrim Special Edition',
  gamePath: 'C:\\Skyrim\\SkyrimSE.exe',
  totalBytes: 2048,
  availableBytes: 4096,
  modCount: 2,
  separatorCount: 1,
  hasEnoughSpace: true,
  willOverwrite: false,
  canImport: true,
  statusMessage: 'Ready',
  warningMessage: '',
  operationId: 'op_analysis'
};

const appInfo: FluxoraAppInfo = {
  appName: 'Fluxora',
  version: '0.0.0',
  platform: 'linux',
  arch: 'x64',
  isPackaged: false
};

const bridgeStatus: NativeBridgeStatus = {
  ready: true,
  operationId: 'op_status',
  capabilities: {
    platform: 'linux',
    arch: 'x64',
    core: {
      available: true,
      libraryName: 'libFluxoraCore.so'
    },
    features: {
      nxmProtocolRegistration: {
        state: 'limited'
      },
      shellOpen: {
        state: 'runtime-shell'
      },
      packagedNativeResources: {
        state: 'limited'
      }
    },
    supportMatrix: [
      {
        platform: 'win32',
        label: 'Windows',
        state: 'available',
        nativeLibraryName: 'FluxoraCore.dll',
        bridgeHostName: 'FluxoraBridgeHost.exe',
        packageFormats: ['FluxoraSetup.exe'],
        protocolState: 'available',
        protocolNotes: 'Windows registry verification.',
        shellOpenState: 'runtime-shell',
        vfsState: 'available',
        vfsNotes: 'VFS DLL required.',
        pathRules: ['Unicode paths'],
        releaseNotes: ['Installer-only.']
      },
      {
        platform: 'linux',
        label: 'Linux',
        state: 'limited',
        nativeLibraryName: 'libFluxoraCore.so',
        bridgeHostName: 'FluxoraBridgeHost',
        packageFormats: ['deb smoke artifact', 'rpm smoke artifact'],
        protocolState: 'limited',
        protocolNotes: 'xdg registration required.',
        shellOpenState: 'runtime-shell',
        vfsState: 'unsupported',
        vfsNotes: 'Linux adapter pending.',
        pathRules: ['case-sensitive filesystem'],
        releaseNotes: ['Native .so payload required.']
      }
    ]
  },
  logs: {
    uiLogPath: '',
    mainBridgeLogPath: ''
  }
};

const transferDrives: FluxoraTransferDriveOption[] = [
  {
    id: 'C:\\',
    rootPath: 'C:\\',
    label: 'Локальный диск (C:)',
    volumeName: '',
    fileSystem: 'NTFS',
    totalBytes: 1000,
    availableBytes: 200,
    driveKind: 'nvme',
    mediaLabel: 'NVMe M.2',
    busType: 'NVMe',
    friendlyName: 'System',
    isSystem: true
  },
  {
    id: 'E:\\',
    rootPath: 'E:\\',
    label: 'Локальный диск (E:)',
    volumeName: '',
    fileSystem: 'NTFS',
    totalBytes: 1000,
    availableBytes: 700,
    driveKind: 'ssd',
    mediaLabel: 'SSD',
    busType: 'SATA',
    friendlyName: 'Games',
    isSystem: false
  }
];

const nexusStatus: FluxoraNexusModsAuthStatus = {
  isConfigured: true,
  isLinked: true,
  hasApiKey: true,
  displayName: 'Valerii',
  userId: '123',
  message: 'Linked',
  clientId: '',
  redirectUri: '',
  operationId: 'op_nexus'
};

const apiLimitProvider: FluxoraApiLimitProvider = {
  id: 'example-api',
  label: 'Example API',
  state: 'available',
  message: 'Updated from API response headers.',
  updatedAtUtc: '2026-07-07T10:00:00Z',
  windows: [
    {
      id: 'hourly',
      label: 'Hourly',
      period: '1 hour',
      limit: 500,
      remaining: 421,
      resetAtUtc: '2026-07-07T11:00:00Z',
      resetRaw: '1783422000'
    }
  ]
};

const transferredProject: FluxoraProject = {
  id: 'mo2-import',
  name: 'MO2 Import',
  templateId: 'skyrimse',
  uiTemplateId: 'skyrim',
  gameName: 'Skyrim Special Edition',
  gamePath: 'C:\\Skyrim\\SkyrimSE.exe',
  installRootDirectory: 'D:\\Fluxora',
  projectDirectory: 'D:\\Fluxora\\MO2 Import',
  configPath: 'D:\\Fluxora\\MO2 Import\\fluxora.json'
};

describe('settings workspace state', () => {
  it('keeps settings sections focused on user-facing configuration', () => {
    expect(settingsSections.map((section) => section.id)).toEqual([
      'connections',
      'language',
      'transfer',
      'developers'
    ]);
    expect(settingsSections).toEqual([
      { id: 'connections', label: 'Connections', hint: '' },
      { id: 'language', label: 'Languages', hint: 'EN / RU / DE' },
      { id: 'transfer', label: 'Transfer', hint: 'MO2 import' },
      { id: 'developers', label: 'Для разработчиков', hint: 'Debug' }
    ]);
  });

  it('keeps developer settings local and points to the original repository', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      }
    };

    expect(fluxoraOriginalRepositoryUrl).toBe('https://github.com/WhistleSkyrim/Fluxora');
    expect(loadDeveloperModeSetting(storage)).toBe(false);
    saveDeveloperModeSetting(storage, true);
    expect(values.get(developerModeStorageKey)).toBe('true');
    expect(loadDeveloperModeSetting(storage)).toBe(true);
    saveDeveloperModeSetting(storage, false);
    expect(values.get(developerModeStorageKey)).toBe('false');
    expect(formatLastBuildDate('2026-07-03T10:15:00.000Z')).toBe('2026-07-03 10:15 UTC');
    expect(formatLastBuildDate('')).toBe('pending');
  });

  it('keeps language options paired with country flag metadata', () => {
    expect(languageOptions.map((language) => language.code)).toEqual([
      'en-us',
      'ru-ru',
      'de-de'
    ]);
    expect(languageOptions.map((language) => language.countryCode)).toEqual([
      'gb',
      'ru',
      'de'
    ]);
    expect(languageOptions.map((language) => language.countryName)).toEqual([
      'United Kingdom',
      'Russia',
      'Germany'
    ]);
  });

  it('normalizes theme and formats transfer bytes', () => {
    expect(normalizeThemeMode('light')).toBe('dark');
    expect(normalizeThemeMode('dark')).toBe('dark');
    expect(normalizeThemeMode('neon')).toBe('dark');
    expect(formatTransferBytes(1536)).toBe('1.5 KB');
  });

  it('reports transfer analysis readiness', () => {
    expect(transferAnalysisStatus(null)).toBe('empty');
    expect(transferAnalysisStatus(baseAnalysis)).toBe('ready');
    expect(transferAnalysisStatus({ ...baseAnalysis, hasEnoughSpace: false })).toBe('blocked');
    expect(transferAnalysisStatus({ ...baseAnalysis, canImport: false })).toBe('blocked');
  });

  it('matches and selects destination drives for transfer paths', () => {
    expect(transferDriveRootForPath('e:\\Fluxora\\Imported')).toBe('E:\\');
    expect(selectPreferredTransferDrive(transferDrives, 'C:\\Fluxora')?.rootPath).toBe('C:\\');
    expect(selectPreferredTransferDrive(transferDrives, '', 600)?.rootPath).toBe('E:\\');
  });

  it('summarizes MO2 import progress', () => {
    const progress = {
      operationId: 'op_import',
      phase: 'copying',
      currentStep: 'Copy files',
      currentItem: 'SkyUI',
      overallPercent: 30,
      copyPercent: 40,
      databasePercent: 0,
      copiedBytes: 1024,
      totalBytes: 2048
    };

    expect(transferProgressSummary(progress)).toBe('Copy files - SkyUI - 1.0 KB / 2.0 KB');
    expect(transferSettingsSummary(progress, null, null)).toBe('Copy files - SkyUI - 1.0 KB / 2.0 KB');
    expect(transferSettingsProgressPercent(progress, null)).toBe(30);
    expect(transferSettingsSummary(null, transferredProject, null)).toBe('Completed - MO2 Import');
    expect(transferSettingsProgressPercent(null, transferredProject)).toBe(100);
  });

  it('keeps Nexus account copy action-oriented without exposing token data', () => {
    const verifiedNexusStatus = createVerifiedNexusAuthStatus(nexusStatus);

    expect(nexusConnectionSummary(null)).toBe('Not linked');
    expect(nexusConnectionSummary(verifiedNexusStatus)).toBe('Linked - Valerii');
    expect(nexusActionLabel(verifiedNexusStatus)).toBe('Disconnect Nexus Mods');
    expect(nexusCanToggle(verifiedNexusStatus, true)).toBe(true);
    expect(nexusIsVerifiedLinked(verifiedNexusStatus)).toBe(true);
    expect(nexusCanToggle({ ...verifiedNexusStatus, isConfigured: false, isLinked: false }, true)).toBe(false);
    expect(nexusConnectionSummary({ ...verifiedNexusStatus, hasApiKey: false })).toBe(
      'Linked - Valerii'
    );

    const checkingStatus = createCheckingNexusAuthStatus(verifiedNexusStatus);
    expect(nexusConnectionSummary(checkingStatus)).toBe('Checking - last linked as Valerii');
    expect(nexusActionLabel(checkingStatus)).toBe('Checking Nexus Mods');
    expect(nexusCanToggle(checkingStatus, true)).toBe(false);
    expect(nexusIsVerifiedLinked(checkingStatus)).toBe(false);
  });

  it('formats API limit providers from reported quota windows only', () => {
    expect(apiLimitProviderSummary(apiLimitProvider)).toBe('Updated from API response headers.');
    expect(formatApiLimitUsage(apiLimitProvider.windows[0])).toBe('421 / 500');
    expect(formatApiLimitReset(apiLimitProvider.windows[0])).toBe('Reset 11:00 UTC');
    expect(
      formatApiLimitReset({
        ...apiLimitProvider.windows[0],
        resetAtUtc: '',
        resetRaw: '60'
      })
    ).toBe('Reset in 1m');
    expect(
      formatApiLimitReset({
        ...apiLimitProvider.windows[0],
        resetAtUtc: '',
        resetRaw: '3660'
      })
    ).toBe('Reset in 1h 1m');
    expect(
      apiLimitProviderSummary({
        ...apiLimitProvider,
        state: 'not-provided',
        message: '',
        windows: []
      })
    ).toBe('Rate-limit headers were not returned');
    expect(
      formatApiLimitUsage({
        ...apiLimitProvider.windows[0],
        limit: null,
        remaining: null
      })
    ).toBe('Not reported');
  });

  it('loads Nexus account status from an instant cache-safe fallback', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      }
    };

    const instantStatus = createInstantNexusAuthStatus();

    expect(instantStatus).toMatchObject({
      isConfigured: true,
      isLinked: false,
      verificationState: 'checking',
      clientId: 'fluxora',
      redirectUri: 'http://127.0.0.1:8089/callback'
    });
    expect(isInstantNexusAuthStatus(instantStatus)).toBe(true);
    expect(nexusCanToggle(instantStatus, true)).toBe(false);
    expect(loadCachedNexusAuthStatus(storage)).toMatchObject({
      isConfigured: true,
      isLinked: false,
      verificationState: 'checking',
      clientId: 'fluxora'
    });

    saveCachedNexusAuthStatus(storage, nexusStatus);

    const cachedPayload = values.get(nexusStatusStorageKey) ?? '';
    expect(cachedPayload).not.toContain('token');
    expect(cachedPayload).not.toContain('hasApiKey');
    expect(cachedPayload).not.toContain('"isLinked":true');
    expect(loadCachedNexusAuthStatus(storage)).toMatchObject({
      isLinked: false,
      hasApiKey: false,
      verificationState: 'stale',
      lastKnownLinked: true,
      lastKnownDisplayName: 'Valerii',
      lastKnownUserId: '123'
    });
    expect(nexusConnectionSummary(loadCachedNexusAuthStatus(storage))).toBe(
      'Checking - last linked as Valerii'
    );
  });

  it('summarizes platform support from bridge capabilities', () => {
    expect(capabilityStateLabel('runtime-shell')).toBe('Tauri shell');
    expect(platformFeatureState(bridgeStatus, 'nxmProtocolRegistration')).toBe('limited');
    expect(platformSupportRows(bridgeStatus, appInfo).map((row) => row.isCurrent)).toEqual([
      false,
      true
    ]);
    expect(currentPlatformSupport(bridgeStatus, appInfo)?.label).toBe('Linux');
    expect(platformSupportSummary(bridgeStatus, appInfo)).toContain('Linux: Limited');
  });

  it('reports transfer cancellation as scoped to MO2 transfer availability', () => {
    expect(settingsCapabilityView(bridgeStatus).transferCancellationAvailable).toBe(false);
    expect(
      settingsCapabilityView({
        ...bridgeStatus,
        capabilities: {
          ...bridgeStatus.capabilities!,
          features: {
            ...bridgeStatus.capabilities!.features,
            mo2Transfer: {
              state: 'available',
              supports: ['analyze', 'import', 'cancel']
            }
          }
        }
      }).transferCancellationAvailable
    ).toBe(true);
  });
});
