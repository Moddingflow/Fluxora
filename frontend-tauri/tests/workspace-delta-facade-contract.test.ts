import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FluxoraIpcChannels,
  type FluxoraDownloadEntry,
  type FluxoraDownloadsChangedEvent
} from '../src/shared/fluxora-api';
import {
  createFluxoraApi,
  type IpcInvoker
} from '../src/tauri/fluxora-api';

const download = (
  id: string,
  transferState: FluxoraDownloadEntry['transferState'],
  progressPercent: number
): FluxoraDownloadEntry => ({
  id,
  name: id,
  fileName: `${id}.7z`,
  localPath: `C:\\Downloads\\${id}.7z`,
  source: 'Nexus Mods',
  archiveId: null,
  buildStatus: null,
  transferState,
  transferMessage: '',
  sizeText: '',
  createdAtText: '',
  progressPercent,
  progressText: `${progressPercent}%`,
  etaText: '',
  downloadSpeedText: '',
  isDownloading: transferState === 'downloading',
  hasKnownProgress: true,
  hasResolvedFileName: true,
  canResume: false,
  canInstall: transferState === 'idle',
  canDelete: true,
  duplicateDecision: null
});

const event = (
  sequence: number,
  entry: FluxoraDownloadEntry
): FluxoraDownloadsChangedEvent => ({
  projectDirectory: 'C:\\Fluxora\\Build',
  operationId: `op_${sequence}`,
  revision: `downloads-${sequence}`,
  sequence,
  upserts: [entry],
  removedIds: [],
  reason: 'modified',
  fullResyncRequired: false
});

afterEach(() => {
  vi.useRealTimers();
});

describe('workspace and downloads delta facade contract', () => {
  it('routes a typed workspace delta with template and operation identity', async () => {
    const invoke = vi.fn().mockResolvedValue({
      projectDirectory: 'C:\\Fluxora\\Build',
      profileName: 'Default',
      operationId: 'op_workspace_delta',
      sequence: 4,
      mods: {
        baseRevision: 'workspace-3',
        revision: 'workspace-4',
        upserts: [],
        removedOrderIds: [],
        placements: []
      },
      installedModUpserts: [],
      removedInstalledModIds: [],
      plugins: {
        baseRevision: 'workspace-3',
        revision: 'workspace-4',
        upserts: [],
        removedOrderIds: [],
        placements: []
      },
      fullResyncRequired: false
    });
    const api = createFluxoraApi({ invoke });

    const result = await api.workspace.getDelta(
      'C:\\Fluxora\\Build',
      'Default',
      'workspace-3',
      { operationId: 'op_workspace_delta', templateId: 'skyrimse' }
    );

    expect(result.sequence).toBe(4);
    expect(invoke).toHaveBeenCalledWith(
      FluxoraIpcChannels.workspaceGetDelta,
      'C:\\Fluxora\\Build',
      'Default',
      'workspace-3',
      { operationId: 'op_workspace_delta', templateId: 'skyrimse' }
    );
  });

  it('coalesces active updates on one frame and flushes terminal state immediately', () => {
    vi.useFakeTimers();
    const listeners = new Map<string, (_event: unknown, payload: unknown) => void>();
    const removeListener = vi.fn((channel: string) => listeners.delete(channel));
    const ipc: IpcInvoker = {
      invoke: vi.fn(),
      on: (channel, listener) => listeners.set(channel, listener),
      removeListener
    };
    const callback = vi.fn();
    const unsubscribe = createFluxoraApi(ipc).downloads.onChanged(callback);
    const listener = listeners.get(FluxoraIpcChannels.downloadsChanged)!;

    listener({}, event(2, download('archive', 'downloading', 10)));
    listener({}, event(3, download('archive', 'downloading', 25)));
    expect(callback).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toMatchObject({
      revision: 'downloads-3',
      sequence: 3,
      upserts: [{ id: 'archive', progressPercent: 25 }]
    });

    listener({}, event(4, download('archive', 'idle', 100)));
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[1][0]).toMatchObject({
      revision: 'downloads-4',
      sequence: 4,
      upserts: [{ id: 'archive', transferState: 'idle', progressPercent: 100 }]
    });

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(
      FluxoraIpcChannels.downloadsChanged,
      listener
    );
  });

  it('cancels a queued frame and detaches the native listener on cleanup', () => {
    vi.useFakeTimers();
    const listeners = new Map<string, (_event: unknown, payload: unknown) => void>();
    const removeListener = vi.fn((channel: string) => listeners.delete(channel));
    const callback = vi.fn();
    const api = createFluxoraApi({
      invoke: vi.fn(),
      on: (channel, listener) => listeners.set(channel, listener),
      removeListener
    });
    const unsubscribe = api.downloads.onChanged(callback);
    listeners.get(FluxoraIpcChannels.downloadsChanged)!(
      {},
      event(2, download('archive', 'downloading', 10))
    );

    unsubscribe();
    vi.runAllTimers();

    expect(callback).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
