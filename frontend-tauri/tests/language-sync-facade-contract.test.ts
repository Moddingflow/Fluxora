import { describe, expect, it, vi } from 'vitest';

import {
  FluxoraIpcChannels,
  type NativeBridgeLanguageResult
} from '../src/shared/fluxora-api';
import {
  createFluxoraApi,
  type IpcInvoker
} from '../src/tauri/fluxora-api';

describe('application language facade contract', () => {
  it('delivers a persisted language change to every subscribed renderer window', () => {
    const listeners = new Map<string, (_event: unknown, payload: unknown) => void>();
    const removeListener = vi.fn((channel: string) => listeners.delete(channel));
    const ipc: IpcInvoker = {
      invoke: vi.fn(),
      on: (channel, listener) => listeners.set(channel, listener),
      removeListener
    };
    const callback = vi.fn();
    const api = createFluxoraApi(ipc);

    const unsubscribe = api.settings.onLanguageChanged(callback);
    const result: NativeBridgeLanguageResult = {
      language: 'ru-ru',
      operationId: 'op_language_ru'
    };
    listeners.get(FluxoraIpcChannels.settingsLanguageChanged)?.({}, result);

    expect(callback).toHaveBeenCalledWith(result);

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(
      FluxoraIpcChannels.settingsLanguageChanged,
      expect.any(Function)
    );
  });
});
