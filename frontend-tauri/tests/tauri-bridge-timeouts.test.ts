import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FluxoraExecutable,
  FluxoraProject,
  OperationRequest
} from '../src/shared/fluxora-api';
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

  it('keeps NXM captures and inbound imports on a long-running download timeout', async () => {
    const captureRequest: OperationRequest = { operationId: 'op_nxm_capture' };
    const importRequest: OperationRequest = { operationId: 'op_nxm_import' };
    invokeMock.mockResolvedValue([]);

    const api = createTauriFluxoraApi();
    await expect(
      api.nxm.captureLinks(project().projectDirectory, [
        'nxm://skyrimspecialedition/mods/3863/files/123?key=abc'
      ], captureRequest)
    ).resolves.toEqual([]);
    await expect(api.nxm.importInboundDownloads(project().projectDirectory, importRequest)).resolves.toEqual([]);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fluxora_bridge_request', {
      method: 'nxm.captureLinks',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        links: ['nxm://skyrimspecialedition/mods/3863/files/123?key=abc']
      },
      request: captureRequest,
      timeoutMs: 21_600_000
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fluxora_bridge_request', {
      method: 'nxm.importInboundDownloads',
      params: { projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition' },
      request: importRequest,
      timeoutMs: 21_600_000
    });
  });

  it('routes Nexus API key linking through the typed native bridge', async () => {
    const request: OperationRequest = { operationId: 'op_nexus_api_key' };
    invokeMock.mockResolvedValue({
      isConfigured: true,
      isLinked: true,
      hasApiKey: true,
      displayName: 'Playwright user',
      userId: '42',
      message: 'NexusMods API key linked.',
      clientId: 'test-client',
      redirectUri: 'http://127.0.0.1/callback'
    });

    const api = createTauriFluxoraApi();
    await expect(api.nexus.connectWithApiKey('personal-key', request)).resolves.toMatchObject({
      hasApiKey: true,
      operationId: 'op_nexus_api_key'
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'nexus.connectWithApiKey',
      params: { apiKey: 'personal-key' },
      request,
      timeoutMs: undefined
    });
  });

  it('subscribes to inbound NXM activation events through the typed Tauri event bridge', async () => {
    const dispose = vi.fn();
    const callback = vi.fn();
    listenMock.mockResolvedValue(dispose);

    const api = createTauriFluxoraApi();
    const unsubscribe = api.nxm.onInboundLinksCaptured(callback);

    expect(listenMock).toHaveBeenCalledWith(
      'fluxora:nxm:inbound-links-captured',
      expect.any(Function)
    );

    const listener = listenMock.mock.calls[0][1] as (event: { payload: unknown }) => void;
    const event = {
      count: 1,
      operationId: 'op_nxm_activation',
      source: 'second-instance'
    };
    listener({ payload: event });
    expect(callback).toHaveBeenCalledWith(event);

    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalled();
  });

  it('routes downloads folder watch commands through the typed Rust shell facade', async () => {
    const watchRequest: OperationRequest = { operationId: 'op_downloads_watch' };
    const unwatchRequest: OperationRequest = { operationId: 'op_downloads_unwatch' };
    invokeMock
      .mockResolvedValueOnce({ accepted: true, operationId: watchRequest.operationId })
      .mockResolvedValueOnce({ accepted: true, operationId: unwatchRequest.operationId });

    const api = createTauriFluxoraApi();
    await expect(
      api.downloads.watchFolder(
        'C:\\Fluxora\\Builds\\Foundation',
        'C:\\Fluxora\\Builds\\Foundation\\downloads',
        watchRequest
      )
    ).resolves.toEqual({ accepted: true, operationId: watchRequest.operationId });
    await expect(api.downloads.unwatchFolder(unwatchRequest)).resolves.toEqual({
      accepted: true,
      operationId: unwatchRequest.operationId
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fluxora_downloads_watch_folder', {
      projectDirectory: 'C:\\Fluxora\\Builds\\Foundation',
      downloadsDirectory: 'C:\\Fluxora\\Builds\\Foundation\\downloads',
      request: watchRequest
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fluxora_downloads_unwatch_folder', {
      request: unwatchRequest
    });
  });

  it('subscribes to downloads folder changes through the typed Tauri event bridge', async () => {
    const dispose = vi.fn();
    const callback = vi.fn();
    listenMock.mockResolvedValue(dispose);

    const api = createTauriFluxoraApi();
    const unsubscribe = api.downloads.onFolderChanged(callback);

    expect(listenMock).toHaveBeenCalledWith(
      'fluxora:downloads:folder-changed',
      expect.any(Function)
    );

    const listener = listenMock.mock.calls[0][1] as (event: { payload: unknown }) => void;
    const event = {
      projectDirectory: 'C:\\Fluxora\\Builds\\Foundation',
      downloadsDirectory: 'C:\\Fluxora\\Builds\\Foundation\\downloads',
      eventId: 'evt_1_downloads_folder_1',
      sequence: 1,
      reason: 'created',
      changes: [
        {
          path: 'C:\\Fluxora\\Builds\\Foundation\\downloads\\mod.7z',
          fileName: 'mod.7z',
          kind: 'created'
        }
      ]
    };
    listener({ payload: event });
    expect(callback).toHaveBeenCalledWith(event);

    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalled();
  });

  it('exposes Tauri file drop events through the typed Fluxora facade', async () => {
    const dispose = vi.fn();
    const callback = vi.fn();
    onDragDropEventMock.mockResolvedValue(dispose);

    const api = createTauriFluxoraApi();
    const unsubscribe = await api.fileDrop.onDragDrop(callback);

    expect(onDragDropEventMock).toHaveBeenCalledWith(expect.any(Function));

    const listener = onDragDropEventMock.mock.calls[0][0] as (event: { payload: unknown }) => void;
    const event = {
      type: 'drop',
      paths: ['C:\\Mods\\SkyUI.7z'],
      position: {
        x: 240,
        y: 320
      }
    };
    listener({ payload: event });

    expect(callback).toHaveBeenCalledWith(event);

    unsubscribe();
    expect(dispose).toHaveBeenCalled();
  });
});
