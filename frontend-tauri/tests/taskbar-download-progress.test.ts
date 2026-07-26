import { describe, expect, it, vi } from 'vitest';

import { taskbarDownloadProgress } from '../src/renderer/features/downloads/taskbar-download-progress';
import {
  FluxoraIpcChannels,
  type FluxoraDownloadEntry
} from '../src/shared/fluxora-api';
import {
  createFluxoraApi,
  createTauriFluxoraApi,
  type IpcInvoker
} from '../src/tauri/fluxora-api';

const tauriInvoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (value: string) => value,
  invoke: tauriInvoke
}));

const downloadEntry = (
  id: string,
  extra: Partial<FluxoraDownloadEntry> = {}
): FluxoraDownloadEntry => ({
  id,
  name: id,
  fileName: `${id}.7z`,
  localPath: `C:\\Fluxora\\Downloads\\${id}.7z`,
  source: 'nexus',
  archiveId: null,
  buildStatus: null,
  transferState: 'idle',
  transferMessage: '',
  sizeText: '',
  createdAtText: 'today',
  progressPercent: 0,
  progressText: '',
  etaText: '',
  downloadSpeedText: '',
  isDownloading: false,
  hasKnownProgress: false,
  hasResolvedFileName: true,
  canResume: false,
  canInstall: false,
  canDelete: false,
  duplicateDecision: null,
  ...extra
});

describe('taskbar download progress', () => {
  it('shows native determinate progress for a known active download', () => {
    const state = taskbarDownloadProgress([
      downloadEntry('active', {
        transferState: 'downloading',
        isDownloading: true,
        hasKnownProgress: true,
        progressPercent: 37.6
      })
    ]);

    expect(state).toEqual({ status: 'normal', progress: 38 });
  });

  it('aggregates concurrent known downloads into one stable taskbar percentage', () => {
    const state = taskbarDownloadProgress([
      downloadEntry('first', {
        transferState: 'downloading',
        isDownloading: true,
        hasKnownProgress: true,
        progressPercent: 20
      }),
      downloadEntry('second', {
        transferState: 'downloading',
        isDownloading: true,
        hasKnownProgress: true,
        progressPercent: 70
      })
    ]);

    expect(state).toEqual({ status: 'normal', progress: 45 });
  });

  it('uses indeterminate state when any pending transfer has unknown progress', () => {
    const state = taskbarDownloadProgress([
      downloadEntry('known', {
        transferState: 'downloading',
        isDownloading: true,
        hasKnownProgress: true,
        progressPercent: 64
      }),
      downloadEntry('queued', {
        transferState: 'queued',
        hasResolvedFileName: false
      })
    ]);

    expect(state).toEqual({ status: 'indeterminate' });
  });

  it('uses the native paused state when all incomplete downloads need user action', () => {
    const state = taskbarDownloadProgress([
      downloadEntry('paused', {
        transferState: 'paused',
        canResume: true,
        hasKnownProgress: true,
        progressPercent: 52
      })
    ]);

    expect(state).toEqual({ status: 'paused', progress: 52 });
  });

  it('uses the native error state for a failed download that can be retried', () => {
    const state = taskbarDownloadProgress([
      downloadEntry('failed', {
        transferState: 'failed',
        canResume: true,
        hasKnownProgress: true,
        progressPercent: 81
      })
    ]);

    expect(state).toEqual({ status: 'error', progress: 81 });
  });

  it('clears the taskbar after completed, canceled, and non-retryable failed rows', () => {
    const state = taskbarDownloadProgress([
      downloadEntry('complete', {
        buildStatus: 'Ready',
        transferState: 'idle',
        hasKnownProgress: true,
        progressPercent: 100
      }),
      downloadEntry('canceled', { transferState: 'canceled' }),
      downloadEntry('terminal-failure', { transferState: 'failed', canResume: false })
    ]);

    expect(state).toEqual({ status: 'none' });
    expect(taskbarDownloadProgress([])).toEqual({ status: 'none' });
  });
});

describe('taskbar progress facade', () => {
  it('routes progress through the typed window shell channel', async () => {
    const invocations: Array<{ channel: string; args: unknown[] }> = [];
    const ipc: IpcInvoker = {
      invoke: async (channel, ...args) => {
        invocations.push({ channel, args });
      }
    };
    const api = createFluxoraApi(ipc);

    await api.windowControls.setTaskbarProgress({ status: 'normal', progress: 42 });

    expect(invocations).toEqual([
      {
        channel: FluxoraIpcChannels.windowSetTaskbarProgress,
        args: [{ status: 'normal', progress: 42 }]
      }
    ]);
  });

  it('maps the typed facade call to the allowlisted Rust command', async () => {
    tauriInvoke.mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} }
    });

    try {
      await createTauriFluxoraApi().windowControls.setTaskbarProgress({
        status: 'paused',
        progress: 73
      });

      expect(tauriInvoke).toHaveBeenCalledWith('fluxora_window_set_taskbar_progress', {
        state: { status: 'paused', progress: 73 }
      });
    } finally {
      Reflect.deleteProperty(globalThis, 'window');
      tauriInvoke.mockReset();
    }
  });

  it('rejects an invalid percentage before it reaches the native window command', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} }
    });

    try {
      await expect(
        createTauriFluxoraApi().windowControls.setTaskbarProgress({
          status: 'normal',
          progress: 101
        })
      ).rejects.toThrow('taskbar progress');
      expect(tauriInvoke).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(globalThis, 'window');
      tauriInvoke.mockReset();
    }
  });
});
