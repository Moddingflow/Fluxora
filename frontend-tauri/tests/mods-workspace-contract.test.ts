import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperationRequest } from '../src/shared/fluxora-api';
import { createTauriFluxoraApi } from '../src/tauri/fluxora-api';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
const onDragDropEventMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: onDragDropEventMock })
}));

let originalWindowDescriptor: PropertyDescriptor | undefined;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} }
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

describe('mods workspace bridge contract', () => {
  it('loads installed mods and profile order through one long-running native request', async () => {
    const request: OperationRequest = { operationId: 'op_mods_workspace' };
    const response = { installedMods: [], modOrder: [] };
    invokeMock.mockResolvedValue(response);

    const api = createTauriFluxoraApi();
    await expect(
      api.mods.getWorkspace('E:\\Fluxora Builds\\Foundation Edition', 'Foundation Edition', request)
    ).resolves.toEqual(response);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'mods.getWorkspace',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        profileName: 'Foundation Edition'
      },
      request,
      timeoutMs: 60_000
    });
  });

  it('routes the interactive persisted snapshot separately from reconciliation', async () => {
    const request: OperationRequest = { operationId: 'op_mods_persisted_workspace' };
    const response = { installedMods: [], modOrder: [] };
    invokeMock.mockResolvedValue(response);

    const api = createTauriFluxoraApi();
    await expect(
      api.mods.getPersistedWorkspace('E:\\Fluxora Builds\\Foundation Edition', 'Default', request)
    ).resolves.toEqual(response);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'mods.getPersistedWorkspace',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        profileName: 'Default'
      },
      request,
      timeoutMs: 60_000
    });
  });

  it('uses the aggregate request for the renderer mods workspace load', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'App.tsx'), 'utf8');
    const loader =
      app.match(/const loadModsWorkspace = async[\s\S]*?\n  const loadModFileTree = async/)?.[0] ?? '';

    expect(loader).toContain('window.fluxora.mods.getPersistedWorkspace');
    expect(loader).toContain('window.fluxora.mods.getWorkspace');
    expect(loader).toContain('await getWorkspace(');
    expect(loader).not.toContain('window.fluxora.mods.listInstalled(');
    expect(loader).not.toContain('window.fluxora.mods.getOrder(');
  });

  it('routes watcher paths through targeted native cache invalidation', async () => {
    const request: OperationRequest = { operationId: 'op_mod_cache_invalidate' };
    invokeMock.mockResolvedValue({ invalidated: true, changedPathCount: 2 });

    const api = createTauriFluxoraApi();
    await expect(
      api.mods.invalidateFileCaches(
        'E:\\Fluxora Builds\\Foundation Edition',
        [
          'E:\\Fluxora Builds\\Foundation Edition\\mods\\A\\Data\\new.dds',
          'E:\\Fluxora Builds\\Foundation Edition\\mods\\B\\Data\\old.dds'
        ],
        request
      )
    ).resolves.toEqual({ invalidated: true, changedPathCount: 2 });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'mods.invalidateFileCaches',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        changedPaths: [
          'E:\\Fluxora Builds\\Foundation Edition\\mods\\A\\Data\\new.dds',
          'E:\\Fluxora Builds\\Foundation Edition\\mods\\B\\Data\\old.dds'
        ]
      },
      request,
      timeoutMs: 60_000
    });
  });

  it('invalidates changed mod paths before watcher-triggered native deltas', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'App.tsx'), 'utf8');
    const watcher =
      app.match(/const unsubscribe = window\.fluxora\.buildContent\.onChanged[\s\S]*?\n  \}, \[/)?.[0] ?? '';

    expect(watcher).toContain("change.area === 'mods'");
    expect(watcher).toContain('window.fluxora.mods.invalidateFileCaches(');
    expect(watcher.indexOf('window.fluxora.mods.invalidateFileCaches(')).toBeLessThan(
      watcher.indexOf('refreshWorkspaceDelta(')
    );
    expect(watcher).not.toContain('loadModsWorkspace(reconciliationProject');
    expect(watcher).not.toContain('loadPluginsWorkspace(reconciliationProject');
    expect(watcher).toContain('buildContentInvalidatedRevisionByScopeRef.current.set(');
  });
});
