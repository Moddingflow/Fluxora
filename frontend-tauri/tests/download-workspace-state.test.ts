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
  queuedDownloadDuplicateDecisions,
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
  archiveId: `sha256:${id.padEnd(64, '0').slice(0, 64)}`,
  buildStatus: 'Ready',
  transferState: 'idle',
  transferMessage: '',
  sizeText: '12 MB',
  createdAtText: 'today',
  progressPercent: 100,
  progressText: '100%',
  etaText: '',
  downloadSpeedText: '',
  isDownloading: false,
  hasKnownProgress: true,
  hasResolvedFileName: true,
  canResume: false,
  canInstall: true,
  canDelete: true,
  duplicateDecision: null,
  ...extra
});

const items: FluxoraDownloadEntry[] = [
  downloadEntry('skyui', 'SkyUI.7z'),
  downloadEntry('paused', 'SmoothCam.zip', {
    buildStatus: null,
    transferState: 'paused',
    transferMessage: 'Paused',
    progressPercent: 44,
    progressText: '44%',
    canInstall: false,
    canResume: true
  }),
  downloadEntry('active', 'RaceMenu.7z', {
    archiveId: null,
    buildStatus: null,
    transferState: 'downloading',
    transferMessage: 'Downloading',
    progressPercent: 12.4,
    progressText: '12%',
    downloadSpeedText: '1.2 MB/s',
    isDownloading: true,
    canInstall: false,
    canDelete: false
  })
];

const selectedIds = (
  state: { selectedIds: ReadonlySet<string> },
  ids: readonly string[] = items.map((entry) => entry.id)
): string[] => ids.filter((id) => state.selectedIds.has(id));

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
    expect([...loaded.selectedIds]).toEqual(['paused']);
    expect(selectedDownloadEntry(items, 'missing')?.id).toBe('skyui');
  });

  it('upserts newly accepted NXM rows before the next native refresh', () => {
    const ready = downloadWorkspaceReducer(emptyDownloadWorkspaceState(), {
      type: 'items-loaded',
      items: [items[0]]
    });
    const inbound = downloadEntry('nxm-inbound', 'Cabbage CS Preset.7z', {
      archiveId: null,
      buildStatus: null,
      transferState: 'downloading',
      transferMessage: 'Скачивается',
      progressPercent: 0,
      progressText: 'Подготовка загрузки',
      isDownloading: true,
      hasKnownProgress: false,
      canInstall: false,
      canDelete: false
    });

    const updated = downloadWorkspaceReducer(ready, {
      type: 'items-upserted',
      items: [inbound]
    });

    expect(updated.items.map((entry) => entry.id)).toEqual(['nxm-inbound', 'skyui']);
    expect(updated.items[0]).toEqual(inbound);
    expect(updated.loadState).toBe('ready');
  });

  it('applies event deltas in one reducer pass while retaining untouched row identity', () => {
    const ready = downloadWorkspaceReducer(emptyDownloadWorkspaceState(), {
      type: 'items-loaded',
      items
    });
    const progressed = {
      ...items[2],
      progressPercent: 48,
      progressText: '48%'
    };
    const added = downloadEntry('new-archive', 'New Archive.7z');

    const updated = downloadWorkspaceReducer(ready, {
      type: 'delta-applied',
      upserts: [progressed, added],
      removedIds: ['paused']
    });

    expect(updated.items.map((entry) => entry.id)).toEqual([
      'skyui',
      'active',
      'new-archive'
    ]);
    expect(updated.items[0]).toBe(items[0]);
    expect(updated.items[1]).toBe(progressed);
    expect(updated.items[2]).toBe(added);
  });

  it('queues duplicate decisions in row order and removes a canceled pending row', () => {
    const firstDecision = downloadEntry('decision-first', 'SkyUI 1.0.1.7z', {
      archiveId: null,
      buildStatus: null,
      transferState: 'awaiting-decision',
      transferMessage: 'Нужно решение',
      canInstall: false,
      canDelete: false,
      duplicateDecision: {
        decisionId: 'decision-1',
        direction: 'upgrade',
        incomingFile: {
          id: 'incoming-101',
          fileId: '101',
          fileName: 'SkyUI 1.0.1.7z',
          version: '1.0.1'
        },
        existingFiles: [{
          id: 'existing-100',
          fileId: '100',
          fileName: 'SkyUI 1.0.0.7z',
          version: '1.0.0'
        }]
      }
    });
    const secondDecision = downloadEntry('decision-second', 'SkyUI 0.9.0.7z', {
      archiveId: null,
      buildStatus: null,
      transferState: 'awaiting-decision',
      duplicateDecision: {
        decisionId: 'decision-2',
        direction: 'downgrade',
        incomingFile: {
          id: 'incoming-090',
          fileId: '90',
          fileName: 'SkyUI 0.9.0.7z',
          version: '0.9.0'
        },
        existingFiles: [{
          id: 'existing-100',
          fileId: '100',
          fileName: 'SkyUI 1.0.0.7z',
          version: '1.0.0'
        }]
      }
    });
    const loaded = downloadWorkspaceReducer(emptyDownloadWorkspaceState(), {
      type: 'items-loaded',
      items: [firstDecision, items[0], secondDecision]
    });

    expect(queuedDownloadDuplicateDecisions(loaded.items).map((entry) => entry.id)).toEqual([
      'decision-first',
      'decision-second'
    ]);
    expect(downloadStatusText(firstDecision)).toBe('Нужно решение');
    expect(filterDownloadEntries(loaded.items, '0.9.0')).toEqual([secondDecision]);

    const canceled = downloadWorkspaceReducer(loaded, {
      type: 'item-removed',
      id: 'decision-first'
    });
    expect(queuedDownloadDuplicateDecisions(canceled.items).map((entry) => entry.id)).toEqual([
      'decision-second'
    ]);
  });

  it('tracks ctrl, shift and select-all selection across visible downloads', () => {
    const ids = items.map((entry) => entry.id);
    let state = downloadWorkspaceReducer(emptyDownloadWorkspaceState(), {
      type: 'items-loaded',
      items
    });

    state = downloadWorkspaceReducer(state, { type: 'selected', id: 'paused' });
    state = downloadWorkspaceReducer(state, {
      type: 'selection-range-selected',
      id: 'active',
      orderedIds: ids,
      additive: false
    });
    expect(selectedIds(state)).toEqual(['paused', 'active']);

    state = downloadWorkspaceReducer(state, {
      type: 'selection-toggled',
      id: 'paused',
      orderedIds: ids
    });
    expect(selectedIds(state)).toEqual(['active']);

    state = downloadWorkspaceReducer(state, { type: 'all-selected', orderedIds: ids });
    expect(selectedIds(state)).toEqual(['skyui', 'paused', 'active']);
  });

  it('detects active download rows for live progress refreshes', () => {
    expect(hasActiveDownload(items)).toBe(true);
    expect(hasActiveDownload(items.filter((entry) => !entry.isDownloading))).toBe(false);
    expect(
      hasActiveDownload([
        downloadEntry('indexing', 'Explorer Archive.7z', {
          archiveId: null,
          buildStatus: null,
          transferState: 'indexing'
        })
      ])
    ).toBe(true);
    expect(
      hasActiveDownload([
        downloadEntry('pending-name', 'skyrimse-182366-770345.nxm-pending', {
          hasResolvedFileName: false,
          transferState: 'queued'
        })
      ])
    ).toBe(true);
    expect(
      hasActiveDownload([
        downloadEntry('queued', 'Queued Archive.7z', {
          hasResolvedFileName: true,
          transferState: 'queued'
        })
      ])
    ).toBe(true);
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
    const installed = downloadEntry('installed', 'Installed Mod.zip', {
      buildStatus: 'Installed'
    });

    expect(downloadTitle(items[0])).toBe('SkyUI');
    expect(downloadStatusText(items[0])).toBe('Ready');
    expect(downloadStatusText(installed)).toBe('Installed');
    expect(downloadStatusText(items[1])).toBe('Paused');
    expect(downloadStatusText(items[2])).toBe('1.2 MB/s');
    expect(downloadProgressValue(items[2])).toBe(12);
    expect(downloadStatusView(items[0])).toMatchObject({
      text: 'Ready',
      tone: 'ready',
      showProgress: false
    });
    expect(downloadStatusView(installed)).toMatchObject({
      text: 'Installed',
      tone: 'installed',
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
      archiveId: null,
      buildStatus: null,
      transferState: 'paused',
      transferMessage: '',
      progressPercent: 0,
      progressText: '',
      hasKnownProgress: false,
      canInstall: false,
      canResume: true
    });
    const failed = {
      ...pending,
      transferState: 'failed' as const,
      transferMessage: 'NexusMods authentication token is not available. Reconnect NexusMods in settings.'
    };

    expect(downloadStatusText(pending)).toBe('Paused');
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
    expect(
      downloadDisplayName('Cabbage CS Preset 182366 5 2026-07-01T12-33Z Ks18n0uG9.7z')
    ).toBe('Cabbage CS Preset');
  });

  it('uses the downloaded file name instead of the mod title', () => {
    const entry = downloadEntry(
      'cabbage',
      'Cabbage CS Preset 182366 5 2026-07-01T12-33Z Ks18n0uG9.7z',
      { name: 'Cabbage Community Shaders preset for NAT' }
    );

    expect(downloadTitle(entry)).toBe('Cabbage CS Preset');
  });

  it('keeps unresolved NXM placeholders neutral until the file name is known', () => {
    const unresolved = downloadEntry('nxm-pending', 'skyrimspecialedition-3863-123.nxm', {
      name: 'skyrimspecialedition-3863-123',
      hasResolvedFileName: false
    });
    const resolved = downloadEntry('nxm-resolved', 'SkyUI 5.2 SE-3863-5-2-1579093884.7z');

    expect(downloadTitle(unresolved)).toBe('Получаем название…');
    expect(downloadTitle(resolved)).toBe('SkyUI 5.2 SE');
  });

  it('describes download capabilities from bridge feature state', () => {
    const supported = downloadCapabilityView(project, readyBridge);
    expect(supported.bridgeAvailable).toBe(true);
    expect(supported.nxmRegistrationState).toBe('available');

    const missingProject = downloadCapabilityView(null, readyBridge);
    expect(missingProject.reason).toContain('Open a build');
  });
});
