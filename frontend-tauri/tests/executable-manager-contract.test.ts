import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FluxoraIpcChannels,
  type FluxoraExecutable,
  type FluxoraExecutablesSavedEvent
} from '../src/shared/fluxora-api';
import {
  createFluxoraApi,
  type IpcInvoker
} from '../src/tauri/fluxora-api';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
  vi.restoreAllMocks();
});

const executable = (id: string): FluxoraExecutable => ({
  id,
  displayName: id,
  executablePath: `C:\\Games\\${id}.exe`,
  arguments: '',
  workingDirectory: 'C:\\Games',
  iconPath: ''
});

describe('executable manager typed facade', () => {
  it('keeps executable icon asset access inside the PNG cache directory', () => {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const config = JSON.parse(fs.readFileSync(
      path.resolve(directory, '..', 'src-tauri', 'tauri.conf.json'),
      'utf8'
    )) as { app: { security: { assetProtocol: { scope: { allow: string[] } } } } };
    expect(config.app.security.assetProtocol.scope.allow).toContain(
      '$CONFIG/Fluxora/cache/executable-icons/**/*.png'
    );
    expect(config.app.security.assetProtocol.scope.allow).not.toContain(
      '$APPDATA/Fluxora/cache/executable-icons/**/*.png'
    );
    expect(config.app.security.assetProtocol.scope.allow).not.toContain('$APPDATA/**/*');
  });

  it('carries inspection and atomic primary update through dedicated channels', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === FluxoraIpcChannels.executablesInspect) {
        return {
          executablePath: 'C:\\Tools\\skse64_loader.exe',
          suggestedDisplayName: 'SKSE',
          displayNameSource: 'file-name',
          iconPath: '',
          operationId: 'op_inspect'
        };
      }
      return [executable('game'), executable('tool')];
    });
    const api = createFluxoraApi({ invoke });

    const inspection = await api.executables.inspect(
      'C:\\Build\\build.json',
      'C:\\Tools\\skse64_loader.exe',
      { operationId: 'op_inspect' }
    );
    const updated = await api.executables.updatePrimary(
      'C:\\Build\\build.json',
      'C:\\Games\\SkyrimSE.exe',
      { operationId: 'op_primary' }
    );

    expect(inspection.suggestedDisplayName).toBe('SKSE');
    expect(inspection.operationId).toBe('op_inspect');
    expect(updated.map((entry) => entry.id)).toEqual(['game', 'tool']);
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      FluxoraIpcChannels.executablesInspect,
      'C:\\Build\\build.json',
      'C:\\Tools\\skse64_loader.exe',
      { operationId: 'op_inspect' }
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      FluxoraIpcChannels.executablesUpdatePrimary,
      'C:\\Build\\build.json',
      'C:\\Games\\SkyrimSE.exe',
      { operationId: 'op_primary' }
    );
  });

  it('delivers native saved events and removes the exact listener', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const removeListener = vi.fn((channel: string) => listeners.delete(channel));
    const ipc: IpcInvoker = {
      invoke: vi.fn(),
      on: (channel, listener) => listeners.set(channel, listener),
      removeListener
    };
    const callback = vi.fn();
    const unsubscribe = createFluxoraApi(ipc).executables.onSaved(callback);
    const payload: FluxoraExecutablesSavedEvent = {
      configPath: 'C:\\Build\\build.json',
      executables: [executable('game')],
      operationId: 'op_saved'
    };

    listeners.get(FluxoraIpcChannels.executablesSaved)?.({}, payload);

    expect(callback).toHaveBeenCalledWith(payload);
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(
      FluxoraIpcChannels.executablesSaved,
      expect.any(Function)
    );
  });

  it('keeps icon conversion and close-request events behind the typed facade', async () => {
    const convertFileSrc = vi.fn((path: string, protocol?: string) =>
      `asset://localhost/${protocol ?? 'asset'}/${encodeURIComponent(path)}`
    );
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __TAURI_INTERNALS__: { convertFileSrc } }
    });
    const nativeCloseSubscription = vi.fn(async (listener: () => boolean | Promise<boolean>) => {
      expect(await listener()).toBe(false);
      return vi.fn();
    });
    const api = createFluxoraApi({
      invoke: vi.fn(),
      onCloseRequested: nativeCloseSubscription
    });

    expect(api.executables.toIconUrl('C:\\Cache\\icon.png')).toContain('asset://localhost/');
    expect(api.executables.toIconUrl('')).toBe('');
    expect(api.executables.toIconUrl('https://example.test/tracker.png')).toBe('');
    expect(api.executables.toIconUrl('data:image/png;base64,AAAA')).toBe('');
    await api.windowControls.onCloseRequested(() => false);

    expect(convertFileSrc).toHaveBeenCalledWith('C:\\Cache\\icon.png', 'asset');
    expect(nativeCloseSubscription).toHaveBeenCalledOnce();
  });

  it('exposes a force-close path for a window that already resolved discard state', async () => {
    const invoke = vi.fn(async () => undefined);
    const api = createFluxoraApi({ invoke });

    await api.windowControls.forceClose();

    expect(invoke).toHaveBeenCalledWith(FluxoraIpcChannels.windowForceClose);
  });
});
