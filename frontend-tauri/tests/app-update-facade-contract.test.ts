import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FluxoraUpdateStatus } from '../src/shared/fluxora-api';
import { FluxoraIpcChannels } from '../src/shared/fluxora-api';
import { createTauriFluxoraApi } from '../src/tauri/fluxora-api';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
const onDragDropEventMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: onDragDropEventMock })
}));

type TauriTestWindow = Window & { __TAURI_INTERNALS__: Record<string, never> };
let originalWindowDescriptor: PropertyDescriptor | undefined;

const status: FluxoraUpdateStatus = {
  state: 'available',
  currentVersion: '1.1.0',
  availableVersion: '1.2.0',
  assetKind: 'delta',
  checkedAtUtc: '2026-07-30T10:00:00Z'
};

beforeEach(() => {
  originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} } as TauriTestWindow
  });
  invokeMock.mockReset();
  listenMock.mockReset();
  onDragDropEventMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

describe('application update facade contract', () => {
  it('uses only the dedicated updater commands and preserves the install operation id', async () => {
    invokeMock.mockResolvedValue(status);
    const api = createTauriFluxoraApi();

    await api.updates.getStatus();
    await api.updates.rendererReady();
    await api.updates.check({ operationId: 'op_update_check' });
    await api.updates.downloadAndInstall({ operationId: 'op_update_install' });
    await api.updates.cancel({ operationId: 'op_update_cancel' });

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fluxora_updates_get_status');
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fluxora_updates_renderer_ready');
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'fluxora_updates_check', {
      request: { operationId: 'op_update_check' }
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'fluxora_updates_download_and_install', {
      request: { operationId: 'op_update_install' }
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, 'fluxora_updates_cancel', {
      request: { operationId: 'op_update_cancel' }
    });
    expect(FluxoraIpcChannels.updatesStatus).toBe('fluxora:updates:status');
  });

  it('allowlists status event fields and never exposes release URLs or staging paths', async () => {
    const dispose = vi.fn();
    const callback = vi.fn();
    listenMock.mockResolvedValue(dispose);
    const api = createTauriFluxoraApi();

    const unsubscribe = api.updates.onStatus(callback);
    const listener = listenMock.mock.calls[0][1] as (event: { payload: unknown }) => void;
    listener({
      payload: {
        ...status,
        downloadedBytes: 512,
        totalBytes: 1024,
        progressPercent: 50,
        releaseUrl: 'https://github.com/Moddingflow/Fluxora/releases/tag/v1.2.0',
        packagePath: 'C:\\Users\\person\\AppData\\Roaming\\Fluxora\\updates\\package.zip'
      }
    });

    expect(callback).toHaveBeenCalledWith({
      ...status,
      downloadedBytes: 512,
      totalBytes: 1024,
      progressPercent: 50
    });
    expect(callback.mock.calls[0][0]).not.toHaveProperty('releaseUrl');
    expect(callback.mock.calls[0][0]).not.toHaveProperty('packagePath');

    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
