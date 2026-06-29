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

  it('gives executable launches enough time for VFS preparation', async () => {
    const executable: FluxoraExecutable = {
      id: 'skse',
      displayName: 'SKSE',
      executablePath: 'E:\\Steam\\Skyrim Special Edition\\skse64_loader.exe',
      arguments: '',
      workingDirectory: 'E:\\Steam\\Skyrim Special Edition',
      iconPath: ''
    };
    const launchResult = {
      ...executable,
      resolvedExecutablePath: executable.executablePath,
      resolvedWorkingDirectory: executable.workingDirectory,
      launchTrackingKind: 'directProcess',
      expectedChildProcessNames: [],
      handoffDisplayName: '',
      handoffTimeoutMs: 30_000,
      processId: 24_680
    };
    const request: OperationRequest = { operationId: 'op_executables_launch' };
    invokeMock.mockResolvedValue(launchResult);

    const api = createTauriFluxoraApi();
    await expect(
      api.executables.launch('C:\\Fluxora\\Builds\\Foundation.json', 'skse', 'Default', request)
    ).resolves.toMatchObject({
      ...launchResult,
      operationId: 'op_executables_launch'
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'executables.launch',
      params: {
        configPath: 'C:\\Fluxora\\Builds\\Foundation.json',
        executableId: 'skse',
        profileName: 'Default'
      },
      request,
      timeoutMs: 120_000
    });
  });

  it('routes overwrite clearing through the typed native bridge', async () => {
    const request: OperationRequest = { operationId: 'op_clear_overwrite' };
    invokeMock.mockResolvedValue({ accepted: true });

    const api = createTauriFluxoraApi();
    await expect(api.mods.clearOverwrite(project().projectDirectory, request)).resolves.toMatchObject({
      accepted: true,
      operationId: 'op_clear_overwrite'
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'mods.clearOverwrite',
      params: { projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition' },
      request,
      timeoutMs: undefined
    });
  });

  it('keeps NGIO grass cache generation on a long-running typed bridge request', async () => {
    const request: OperationRequest = { operationId: 'op_grass_cache' };
    invokeMock.mockResolvedValue({
      accepted: true,
      outputModName: 'Foundation Edition · Grass Cache',
      outputModPath: 'E:\\Fluxora Builds\\Foundation Edition\\mods\\Foundation Edition · Grass Cache',
      launchCount: 2,
      generatedFileCount: 18,
      failedFileCount: 0
    });

    const api = createTauriFluxoraApi();
    await expect(
      api.grassCache.generate(
        {
          configPath: 'C:\\Fluxora\\Builds\\Foundation.json',
          profileName: 'Default'
        },
        request
      )
    ).resolves.toMatchObject({
      outputModName: 'Foundation Edition · Grass Cache',
      operationId: 'op_grass_cache'
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'grassCache.generate',
      params: {
        configPath: 'C:\\Fluxora\\Builds\\Foundation.json',
        profileName: 'Default'
      },
      request,
      timeoutMs: 21_600_000
    });
  });

  it('routes bulk plugin enable through one typed native bridge call', async () => {
    const request: OperationRequest = { operationId: 'op_plugins_set_all' };
    invokeMock.mockResolvedValue([]);

    const api = createTauriFluxoraApi();
    await expect(
      api.plugins.setAllEnabled(project().projectDirectory, 'skyrimse', 'Default', false, request)
    ).resolves.toEqual([]);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'plugins.setAllEnabled',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        templateId: 'skyrimse',
        profileName: 'Default',
        isEnabled: false
      },
      request,
      timeoutMs: undefined
    });
  });
});
