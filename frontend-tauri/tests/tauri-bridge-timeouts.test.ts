import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FluxoraExecutable,
  FluxoraProject,
  OperationRequest
} from '../src/shared/fluxora-api';
import { createTauriFluxoraApi } from '../src/tauri/fluxora-api';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock
}));

type TauriTestWindow = Window & {
  __TAURI_INTERNALS__: Record<string, never>;
};

let originalWindowDescriptor: PropertyDescriptor | undefined;

const project = (overrides: Partial<FluxoraProject> = {}): FluxoraProject => ({
  id: 'foundation-edition',
  name: 'Foundation Edition',
  templateId: 'skyrim-special-edition',
  uiTemplateId: 'skyrim',
  gameName: 'Skyrim Special Edition',
  gamePath: 'E:\\Steam\\Skyrim Special Edition',
  installRootDirectory: 'E:\\Fluxora Builds',
  projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
  configPath: 'C:\\Users\\Валера\\AppData\\Roaming\\Fluxora\\Builds\\Foundation Edition-9.json',
  ...overrides
});

beforeEach(() => {
  originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} } as TauriTestWindow
  });
  invokeMock.mockReset();
  listenMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();

  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, 'window');
});

describe('Tauri bridge request timeouts', () => {
  it('gives heavy project config opens enough time for cold MO2-migrated builds', async () => {
    const configPath =
      'C:\\Users\\Валера\\AppData\\Roaming\\Fluxora\\Builds\\Foundation Edition-9.json';
    const request: OperationRequest = { operationId: 'op_projects_open' };
    invokeMock.mockResolvedValue(project({ configPath }));

    const api = createTauriFluxoraApi();
    await expect(api.projects.openConfig(configPath, request)).resolves.toMatchObject({
      configPath
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'projects.openConfig',
      params: { configPath },
      request,
      timeoutMs: 60_000
    });
  });

  it('keeps executable discovery from sharing the short default bridge timeout', async () => {
    const executable: FluxoraExecutable = {
      id: 'skse',
      displayName: 'SKSE',
      executablePath: 'E:\\Steam\\Skyrim Special Edition\\skse64_loader.exe',
      arguments: '',
      workingDirectory: 'E:\\Steam\\Skyrim Special Edition',
      iconPath: ''
    };
    const request: OperationRequest = { operationId: 'op_executables_list' };
    invokeMock.mockResolvedValue([executable]);

    const api = createTauriFluxoraApi();
    await expect(api.executables.list('C:\\Fluxora\\Builds\\Foundation.json', request)).resolves.toEqual([
      executable
    ]);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'executables.list',
      params: { configPath: 'C:\\Fluxora\\Builds\\Foundation.json' },
      request,
      timeoutMs: 30_000
    });
  });
});
