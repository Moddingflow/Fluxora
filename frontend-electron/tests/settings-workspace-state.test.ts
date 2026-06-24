import { describe, expect, it } from 'vitest';

import {
  capabilityStateLabel,
  formatTransferBytes,
  currentPlatformSupport,
  normalizeThemeMode,
  platformFeatureState,
  platformSupportRows,
  platformSupportSummary,
  selectPreferredTransferDrive,
  settingsSections,
  transferDriveRootForPath,
  transferAnalysisStatus,
  transferProgressSummary
} from '../src/renderer/settings-workspace-state';
import type {
  FluxoraAppInfo,
  FluxoraModOrganizerImportAnalysis,
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
        state: 'electron-main'
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
        shellOpenState: 'electron-main',
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
        shellOpenState: 'electron-main',
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

describe('settings workspace state', () => {
  it('keeps settings sections focused on user-facing configuration', () => {
    expect(settingsSections.map((section) => section.id)).toEqual([
      'connections',
      'language',
      'theme',
      'transfer'
    ]);
    expect(settingsSections.find((section) => section.id === 'connections')?.label).toBe('Nexus Mods');
    expect(settingsSections.find((section) => section.id === 'theme')?.label).toBe('Кастомизация');
    expect(settingsSections.find((section) => section.id === 'transfer')?.label).toBe('Перенос');
  });

  it('normalizes theme and formats transfer bytes', () => {
    expect(normalizeThemeMode('light')).toBe('light');
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
    expect(
      transferProgressSummary({
        operationId: 'op_import',
        phase: 'copying',
        currentStep: 'Copy files',
        currentItem: 'SkyUI',
        overallPercent: 30,
        copyPercent: 40,
        databasePercent: 0,
        copiedBytes: 1024,
        totalBytes: 2048
      })
    ).toBe('Copy files - SkyUI - 1.0 KB / 2.0 KB');
  });

  it('summarizes platform support from bridge capabilities', () => {
    expect(capabilityStateLabel('electron-main')).toBe('Electron main');
    expect(platformFeatureState(bridgeStatus, 'nxmProtocolRegistration')).toBe('limited');
    expect(platformSupportRows(bridgeStatus, appInfo).map((row) => row.isCurrent)).toEqual([
      false,
      true
    ]);
    expect(currentPlatformSupport(bridgeStatus, appInfo)?.label).toBe('Linux');
    expect(platformSupportSummary(bridgeStatus, appInfo)).toContain('Linux: Limited');
  });
});
