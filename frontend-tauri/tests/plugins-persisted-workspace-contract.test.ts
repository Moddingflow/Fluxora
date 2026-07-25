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

describe('persisted plugin workspace bridge contract', () => {
  it('routes the interactive plugin snapshot separately from exact discovery', async () => {
    const request: OperationRequest = { operationId: 'op_plugins_persisted' };
    const response = [{ id: 'Skyrim.esm', kind: 'plugin', name: 'Skyrim.esm' }];
    invokeMock.mockResolvedValue(response);

    const api = createTauriFluxoraApi();
    await expect(
      api.plugins.listPersisted(
        'E:\\Fluxora Builds\\Foundation Edition',
        'skyrimse',
        'Default',
        request
      )
    ).resolves.toEqual(response);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'plugins.listPersisted',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        templateId: 'skyrimse',
        profileName: 'Default'
      },
      request,
      timeoutMs: undefined
    });
  });

  it('forwards an explicit fresh-discovery request to the native plugin list', async () => {
    const request = {
      operationId: 'op_plugins_fresh',
      forceDiscoveryRefresh: true
    };
    invokeMock.mockResolvedValue([]);

    const api = createTauriFluxoraApi();
    await api.plugins.list(
      'E:\\Fluxora Builds\\Foundation Edition',
      'skyrimse',
      'Default',
      request
    );

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'plugins.list',
      params: {
        forceDiscoveryRefresh: true,
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        templateId: 'skyrimse',
        profileName: 'Default'
      },
      request: {
        operationId: 'op_plugins_fresh'
      },
      timeoutMs: undefined
    });
  });

  it('uses persisted plugins for T3 and exact plugins after T4 mod reconciliation', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'App.tsx'), 'utf8');
    const pluginLoader =
      app.match(/const loadPluginsWorkspace = async[\s\S]*?\n  const runPluginMutation = async/)?.[0] ?? '';
    const openBackground =
      app.match(/void \(async \(\) => \{[\s\S]*?completeBackground\(current\.projectId\)/)?.[0] ?? '';

    expect(pluginLoader).toContain('window.fluxora.plugins.listPersisted');
    expect(pluginLoader).toContain('window.fluxora.plugins.list');
    expect(pluginLoader).toContain('options.persistedSnapshot');

    const exactModsIndex = openBackground.indexOf('loadModsWorkspace(current.project');
    const exactPluginsIndex = openBackground.indexOf('loadPluginsWorkspace(current.project');
    const completionIndex = openBackground.indexOf('completeBackground(current.projectId)');
    expect(exactModsIndex).toBeGreaterThanOrEqual(0);
    expect(exactPluginsIndex).toBeGreaterThan(exactModsIndex);
    expect(completionIndex).toBeGreaterThan(exactPluginsIndex);
  });
});
