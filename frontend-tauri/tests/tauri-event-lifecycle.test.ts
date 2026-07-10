import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTauriFluxoraApi } from '../src/tauri/fluxora-api';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
const onDragDropEventMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: onDragDropEventMock
  })
}));

type TauriTestWindow = Window & {
  __TAURI_INTERNALS__: Record<string, never>;
};

let originalWindowDescriptor: PropertyDescriptor | undefined;

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
    return;
  }
  Reflect.deleteProperty(globalThis, 'window');
});

describe('Tauri event listener lifecycle', () => {
  it('disposes the exact listener after non-LIFO unsubscribe and resubscribe', async () => {
    const disposeProgressA = vi.fn();
    const disposeNxm = vi.fn();
    const disposeProgressB = vi.fn();
    const disposeProgressC = vi.fn();
    listenMock
      .mockResolvedValueOnce(disposeProgressA)
      .mockResolvedValueOnce(disposeNxm)
      .mockResolvedValueOnce(disposeProgressB)
      .mockResolvedValueOnce(disposeProgressC);

    const api = createTauriFluxoraApi();
    const unsubscribeProgressA = api.operations.onProgress(() => undefined);
    const unsubscribeNxm = api.nxm.onInboundLinksCaptured(() => undefined);
    const unsubscribeProgressB = api.operations.onProgress(() => undefined);

    unsubscribeNxm();
    const unsubscribeProgressC = api.operations.onProgress(() => undefined);
    unsubscribeProgressB();
    await Promise.resolve();
    await Promise.resolve();

    expect(disposeProgressB).toHaveBeenCalledOnce();
    expect(disposeProgressC).not.toHaveBeenCalled();

    unsubscribeProgressA();
    unsubscribeProgressC();
    await Promise.resolve();
    await Promise.resolve();
  });
});
