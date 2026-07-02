import { describe, expect, it } from 'vitest';

import {
  downloadCapabilityView,
  downloadDisplayName,
  downloadProgressValue,
  downloadStatusText,
  downloadStatusView,
  downloadTitle,
  downloadWorkspaceReducer,
  emptyDownloadWorkspaceState,
  filterDownloadEntries,
  hasActiveDownload,
  selectedDownloadEntry
} from '../src/renderer/download-workspace-state';
import type {
  FluxoraDownloadEntry,
  FluxoraProject,
  NativeBridgeStatus
} from '../src/shared/fluxora-api';

const downloadEntry = (
  id: string,
  fileName: string,
  extra: Partial<FluxoraDownloadEntry> = {}
): FluxoraDownloadEntry => ({
  id,
  name: fileName.replace(/\.[^.]+$/, ''),
  fileName,
  localPath: `C:\\Builds\\Skyrim\\downloads\\${fileName}`,
  source: 'local',
  status: 'Ready',
  sizeText: '12 MB',
  createdAtText: 'today',
  progressPercent: 100,
  progressText: '100%',
  etaText: '',
  downloadSpeedText: '',
  isDownloading: false,
  hasKnownProgress: true,
  canResume: false,
  canInstall: true,
  canDelete: true,
  ...extra
});

const items: FluxoraDownloadEntry[] = [
  downloadEntry('skyui', 'SkyUI.7z'),
  downloadEntry('paused', 'SmoothCam.zip', {
    status: 'Paused',
    progressPercent: 44,
    progressText: '44%',
    canInstall: false,
    canResume: true
  }),
  downloadEntry('active', 'RaceMenu.7z', {
    status: 'Downloading',
    progressPercent: 12.4,
    progressText: '12%',
    downloadSpeedText: '1.2 MB/s',
    isDownloading: true,
    canInstall: false,
    canDelete: false
  })
];

const readyBridge: NativeBridgeStatus = {
  ready: true,
  operationId: 'op_test',
  capabilities: {
    platform: 'win32',
    arch: 'x64',
    core: {
      available: true,
      libraryName: 'FluxoraCore.dll'
    },
    features: {
      downloads: {
        state: 'available'
      },
      nxmProtocolRegistration: {
        state: 'available'
      }
    }
  },
  logs: {
    uiLogPath: '',
    mainBridgeLogPath: ''
  }
};

const project: FluxoraProject = {
  id: 'build',
  name: 'Build',
  templateId: 'skyrimse',
  uiTemplateId: 'skyrimse',
  gameName: 'Skyrim Special Edition',
  gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
  installRootDirectory: 'C:\\Builds',
  projectDirectory: 'C:\\Builds\\Skyrim',
  configPath: 'C:\\Builds\\Skyrim.json'
};

describe('download workspace state', () => {
  it('filters download rows by filename, source and status terms', () => {
    expect(filterDownloadEntries(items, 'skyui')).toEqual([items[0]]);
    expect(filterDownloadEntries(items, 'paused')).toEqual([items[1]]);
    expect(filterDownloadEntries(items, 'local')).toEqual(items);
    expect(filterDownloadEntries(items, '')).toEqual(items);
  });

  it('keeps selection stable and prefers installable rows as fallback', () => {
    const loaded = downloadWorkspaceReducer(
      { ...emptyDownloadWorkspaceState(), selectedId: 'paused' },
      { type: 'items-loaded', items }
    );

    expect(loaded.selectedId).toBe('paused');
    expect(selectedDownloadEntry(items, 'missing')?.id).toBe('skyui');
  });

  it('detects active download rows for live progress refreshes', () => {
    expect(hasActiveDownload(items)).toBe(true);
    expect(hasActiveDownload(items.filter((entry) => !entry.isDownloading))).toBe(false);
  });

  it('keeps rows visible during silent refreshes', () => {
    const emptyRefreshing = downloadWorkspaceReducer(emptyDownloadWorkspaceState(), {
      type: 'load-started',
      silent: true
    });
    const ready = downloadWorkspaceReducer(emptyDownloadWorkspaceState(), {
      type: 'items-loaded',
      items
    });
    const refreshing = downloadWorkspaceReducer(ready, {
      type: 'load-started',
      silent: true
    });
    const failedRefresh = downloadWorkspaceReducer(refreshing, {
      type: 'load-failed',
      message: 'Bridge timed out',
      silent: true
    });

    expect(emptyRefreshing.loadState).toBe('idle');
    expect(refreshing.items).toEqual(items);
    expect(refreshing.loadState).toBe('ready');
    expect(failedRefresh.items).toEqual(items);
    expect(failedRefresh.loadState).toBe('ready');
    expect(failedRefresh.errorMessage).toBe('Bridge timed out');
  });

  it('formats dense-row status and progress', () => {
    expect(downloadTitle(items[0])).toBe('SkyUI');
    expect(downloadStatusText(items[0])).toBe('Ready to install');
    expect(downloadStatusText(items[1])).toBe('Paused');
    expect(downloadStatusText(items[2])).toBe('1.2 MB/s');
    expect(downloadProgressValue(items[2])).toBe(12);
    expect(downloadStatusView(items[0])).toMatchObject({
      text: 'Ready to install',
      tone: 'ready',
      showProgress: false
    });
    expect(downloadStatusView(items[2])).toMatchObject({
      text: '12% · 1.2 MB/s',
      tone: 'downloading',
      progressValue: 12,
      showProgress: true
    });
  });

  it('keeps pending Nexus retries actionable without calling them paused', () => {
    const pending = downloadEntry('nxm', 'skyrimspecialedition-3863-123.nxm', {
      status: 'Ожидает загрузки',
      progressPercent: 0,
      progressText: '',
      hasKnownProgress: false,
      canInstall: false,
      canResume: true
    });
    const failed = {
      ...pending,
      status: 'Ожидает загрузки: NexusMods authentication token is not available. Reconnect NexusMods in settings.'
    };

    expect(downloadStatusText(pending)).toBe('Ready to download');
    expect(downloadStatusText(failed)).toContain('Reconnect NexusMods');
  });

  it('trims Nexus archive id tails while preserving meaningful numbers', () => {
    expect(downloadDisplayName('Aetherius - A Race Overhaul-26686-2-14-1-1719514447.7z')).toBe(
      'Aetherius - A Race Overhaul'
    );
    expect(
      downloadDisplayName(
        'Aetherius - A Race Overhaul - Russian Translation-96334-2-14-1-1719514447.7z'
      )
    ).toBe('Aetherius - A Race Overhaul - Russian Translation');
    expect(downloadDisplayName('SkyUI 5.2 SE-3863-5-2-1579093884.7z')).toBe(
      'SkyUI 5.2 SE'
    );
    expect(downloadDisplayName('Texture Pack 2024-12345-1-0-1719514447.zip')).toBe(
      'Texture Pack 2024'
    );
    expect(downloadDisplayName('Archive 2048 Edition.7z')).toBe('Archive 2048 Edition');
  });

  it('describes download capabilities from bridge feature state', () => {
    const supported = downloadCapabilityView(project, readyBridge);
    expect(supported.bridgeAvailable).toBe(true);
    expect(supported.nxmRegistrationState).toBe('available');

    const missingProject = downloadCapabilityView(null, readyBridge);
    expect(missingProject.reason).toContain('Open a build');
  });
});
