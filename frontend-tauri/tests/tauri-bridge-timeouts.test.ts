import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CreateFluxoraProjectRequest,
  FluxoraBuildContentWatchRequest,
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
  it('keeps AI editor dirty state and opaque editor bootstrap in the Tauri shell', async () => {
    invokeMock.mockResolvedValue(undefined);
    const api = createTauriFluxoraApi();

    await api.ai.setFileDirty('opaque-file-ref', true);
    await api.windowControls.openAiTextEditor('chat-1', 'opaque-file-ref', 'settings.ini', 17);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_ai_file_set_dirty', {
      fileRef: 'opaque-file-ref',
      dirty: true
    });
    expect(invokeMock).toHaveBeenCalledWith('fluxora_open_ai_text_editor_window', {
      chatId: 'chat-1',
      fileRef: 'opaque-file-ref',
      fileName: 'settings.ini',
      firstChangedLine: 17
    });
  });

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

  it('routes project creation through the typed native bridge with its operation id', async () => {
    const createRequest: CreateFluxoraProjectRequest = {
      projectName: 'Foundation Edition',
      templateId: 'skyrim-special-edition',
      gamePath: 'E:\\Steam\\Skyrim Special Edition',
      installRootDirectory: 'E:\\Fluxora Builds'
    };
    const request: OperationRequest = { operationId: 'op_projects_create' };
    const createdProject = project({
      name: createRequest.projectName,
      templateId: createRequest.templateId,
      gamePath: createRequest.gamePath,
      installRootDirectory: createRequest.installRootDirectory
    });
    invokeMock.mockResolvedValue(createdProject);

    const api = createTauriFluxoraApi();
    await expect(api.projects.create(createRequest, request)).resolves.toEqual(createdProject);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'projects.create',
      params: createRequest,
      request,
      timeoutMs: undefined
    });
  });

  it('gives recursive project deletion a long file-mutation timeout', async () => {
    const configPath = 'C:\\Users\\Валера\\AppData\\Roaming\\Fluxora\\Builds\\Foundation Edition-9.json';
    const request: OperationRequest = { operationId: 'op_projects_delete' };
    invokeMock.mockResolvedValue({ accepted: true });

    const api = createTauriFluxoraApi();
    await api.projects.delete(configPath, request);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'projects.delete',
      params: { configPath },
      request,
      timeoutMs: 7_200_000
    });
  });

  it('preserves previewDirectory payload and operation id from the typed bridge request', async () => {
    const request: OperationRequest = { operationId: 'op_projects_preview_directory' };
    invokeMock.mockResolvedValue({
      projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition'
    });

    const api = createTauriFluxoraApi();
    await expect(
      api.projects.previewDirectory('Foundation Edition', 'E:\\Fluxora Builds', request)
    ).resolves.toEqual({
      projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
      operationId: 'op_projects_preview_directory'
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'projects.previewDirectory',
      params: {
        projectName: 'Foundation Edition',
        installRootDirectory: 'E:\\Fluxora Builds'
      },
      request,
      timeoutMs: undefined
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

  it('allows the interactive Nexus OAuth callback window to outlive the default bridge timeout', async () => {
    const request: OperationRequest = { operationId: 'op_nexus_connect' };
    invokeMock.mockResolvedValue({
      isConfigured: true,
      isLinked: true,
      isPremium: true,
      hasApiKey: false,
      displayName: 'Playwright user',
      userId: 'playwright',
      message: 'Linked',
      clientId: 'fluxora',
      redirectUri: 'http://127.0.0.1:8089/callback'
    });

    const api = createTauriFluxoraApi();
    await api.nexus.connect(request);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'nexus.connect',
      params: {},
      request,
      timeoutMs: 180_000
    });
  });

  it('uses one three-second shell envelope for generic startup restore', async () => {
    const request: OperationRequest = { operationId: 'op_connections_restore' };
    const snapshot = {
      providers: [],
      requestedAtUtc: '2026-07-19T09:00:00Z',
      completedAtUtc: '2026-07-19T09:00:01Z',
      durationMs: 1_000,
      timedOut: false,
      operationId: request.operationId
    };
    invokeMock.mockResolvedValue(snapshot);

    const api = createTauriFluxoraApi();
    await expect(api.connections.restoreAll(2, request)).resolves.toEqual(snapshot);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'connections.restoreAll',
      params: { attempt: 2 },
      request,
      timeoutMs: 3_000
    });
  });

  it('keeps generic connection login on the OAuth envelope', async () => {
    const request: OperationRequest = { operationId: 'op_connections_connect' };
    invokeMock.mockResolvedValue({
      providerId: 'nexus',
      label: 'Nexus Mods',
      state: 'ready',
      accountName: 'Playwright user',
      hasStoredSession: true,
      retryable: false,
      requiresUserAction: false,
      message: 'Ready',
      checkedAtUtc: '2026-07-19T09:00:00Z',
      operationId: request.operationId
    });

    const api = createTauriFluxoraApi();
    await api.connections.connect('nexus', request);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'connections.connect',
      params: { providerId: 'nexus' },
      request,
      timeoutMs: 180_000
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

  it('routes managed executable completion through the long-running bridge lane', async () => {
    const request: OperationRequest = { operationId: 'op_bodyslide_finalize' };
    invokeMock.mockResolvedValue({
      sessionId: 'session-1',
      outcome: 'completed',
      finalized: true,
      deferred: false,
      outputMod: {
        id: 'output-1',
        displayName: 'Foundation - BodySlide Output',
        folderName: 'Foundation - BodySlide Output',
        path: 'C:\\Fluxora\\Builds\\Foundation\\mods\\Foundation - BodySlide Output',
        provider: 'generated-bodyslide'
      },
      warnings: []
    });

    const api = createTauriFluxoraApi();
    await expect(
      api.executables.completeManagedLaunch('session-1', 'completed', request)
    ).resolves.toMatchObject({
      sessionId: 'session-1',
      finalized: true,
      operationId: request.operationId
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'executables.completeManagedLaunch',
      params: { sessionId: 'session-1', outcome: 'completed' },
      request,
      timeoutMs: 120_000
    });
  });

  it('gives overwrite cleanup a long file-mutation timeout', async () => {
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
      timeoutMs: 7_200_000
    });
  });

  it('passes the typed mod-update mode and operation id to the background bridge method', async () => {
    const updateRequest = {
      projectDirectory: project().projectDirectory,
      mode: 'automatic' as const
    };
    const request: OperationRequest = { operationId: 'op_mod_updates_auto' };
    const result = {
      state: 'completed' as const,
      reason: 'none' as const,
      nextEligibleAt: '2026-07-17T10:00:00Z',
      quota: {
        hourlyLimit: 1_000,
        hourlyRemaining: 900,
        hourlyResetAt: '2026-07-16T11:00:00Z',
        dailyLimit: 20_000,
        dailyRemaining: 19_000,
        dailyResetAt: '2026-07-17T00:00:00Z',
        capturedAt: '2026-07-16T10:00:00Z'
      },
      counters: {
        apiRequests: 1,
        cacheHits: 0,
        checked: 1,
        updates: 0,
        ambiguous: 0,
        failed: 0
      },
      mods: []
    };
    invokeMock.mockResolvedValue(result);

    const api = createTauriFluxoraApi();
    await expect(api.mods.checkUpdates(updateRequest, request)).resolves.toEqual(result);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'mods.checkUpdates',
      params: updateRequest,
      request,
      timeoutMs: 70_000
    });
  });

  it('gives installed-mod deletion a long file-mutation timeout', async () => {
    const request: OperationRequest = { operationId: 'op_mods_delete_installed' };
    const projectDirectory = project().projectDirectory;
    const modPath = 'E:\\Fluxora Builds\\Foundation Edition\\mods\\Large Mod';
    invokeMock.mockResolvedValue({ accepted: true });

    const api = createTauriFluxoraApi();
    await api.mods.deleteInstalled(projectDirectory, modPath, request);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'mods.deleteInstalled',
      params: { projectDirectory, modPath },
      request,
      timeoutMs: 7_200_000
    });
  });

  it('routes installed-mod rename through the typed bridge with a long file-mutation timeout', async () => {
    const request: OperationRequest = { operationId: 'op_mods_rename_installed' };
    const projectDirectory = project().projectDirectory;
    const modPath = 'E:\\Fluxora Builds\\Foundation Edition\\mods\\Old Armor';
    const newName = 'New Armor';
    invokeMock.mockResolvedValue({ id: `${projectDirectory}\\mods\\${newName}`, name: newName });

    const api = createTauriFluxoraApi();
    await api.mods.renameInstalled(projectDirectory, modPath, newName, request);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'mods.renameInstalled',
      params: { projectDirectory, modPath, newName },
      request,
      timeoutMs: 7_200_000
    });
  });

  it('routes effective game-root file tree snapshots through the typed native bridge', async () => {
    const request: OperationRequest = { operationId: 'op_effective_tree' };
    invokeMock.mockResolvedValue({
      profileName: 'Default',
      revision: 'rev-1',
      totalFileCount: 2,
      totalFileCountKnown: true,
      entries: [
        {
          name: 'Game Root',
          relativePath: '',
          parentPath: '',
          isDirectory: true,
          hasChildren: true,
          size: 0,
          virtualPath: '',
          sourceKind: 'virtual',
          sourceName: 'Game Root',
          sourcePath: ''
        }
      ]
    });

    const api = createTauriFluxoraApi();
    await expect(
      api.mods.getEffectiveFileTree(project().projectDirectory, 'Default', request)
    ).resolves.toMatchObject({
      profileName: 'Default',
      totalFileCount: 2,
      totalFileCountKnown: true
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'mods.getEffectiveFileTree',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        profileName: 'Default'
      },
      request,
      timeoutMs: 120_000
    });
  });

  it('routes bounded effective game-root root and child pages through the typed native bridge', async () => {
    const request: OperationRequest = { operationId: 'op_effective_tree_page' };
    invokeMock
      .mockResolvedValueOnce({
        profileName: 'Default',
        revision: 'rev-1',
        parentPath: '',
        totalFileCount: 2,
        totalFileCountKnown: false,
        totalChildCount: 1,
        limit: 250,
        nextCursor: null,
        entries: []
      })
      .mockResolvedValueOnce({
        profileName: 'Default',
        revision: 'rev-1',
        parentPath: 'Data',
        totalFileCount: 2,
        totalFileCountKnown: false,
        totalChildCount: 1,
        limit: 100,
        nextCursor: null,
        entries: []
      });

    const api = createTauriFluxoraApi();
    await expect(
      api.mods.getEffectiveFileTreeRoot(project().projectDirectory, 'Default', 250, request)
    ).resolves.toMatchObject({ totalFileCountKnown: false });
    await expect(
      api.mods.getEffectiveFileTreeChildren(
        project().projectDirectory,
        'Default',
        'rev-1',
        'Data',
        '100',
        100,
        request
      )
    ).resolves.toMatchObject({ totalFileCountKnown: false });

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fluxora_bridge_request', {
      method: 'mods.getEffectiveFileTreeRoot',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        profileName: 'Default',
        limit: 250
      },
      request,
      timeoutMs: undefined
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fluxora_bridge_request', {
      method: 'mods.getEffectiveFileTreeChildren',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        profileName: 'Default',
        revision: 'rev-1',
        relativeDirectory: 'Data',
        cursor: '100',
        limit: 100
      },
      request,
      timeoutMs: undefined
    });
  });

  it('routes workspace index warmup through the build bridge surface', async () => {
    const request: OperationRequest = { operationId: 'op_prepare_indexes' };
    invokeMock.mockResolvedValue({
      profileName: 'Default',
      revision: 'rev-1',
      totalFileCount: 12,
      totalEntryCount: 20,
      cacheHit: false
    });

    const api = createTauriFluxoraApi();
    await expect(
      api.build.prepareWorkspaceIndexes(project().projectDirectory, 'Default', request)
    ).resolves.toMatchObject({ totalFileCount: 12 });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'build.prepareWorkspaceIndexes',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        profileName: 'Default'
      },
      request,
      timeoutMs: 120_000
    });
  });

  it('routes mod details summary and conflict pages without recursive file-tree fanout', async () => {
    const request: OperationRequest = { operationId: 'op_mod_details' };
    invokeMock
      .mockResolvedValueOnce({
        id: 'E:\\Fluxora Builds\\Foundation Edition\\mods\\SkyUI',
        orderId: 'mod_skyui',
        kind: 'mod',
        order: 1,
        isSeparator: false,
        isMod: true,
        modUuid: 'skyui',
        separatorTitle: '',
        name: 'SkyUI'
      })
      .mockResolvedValueOnce({
        modPath: 'E:\\Fluxora Builds\\Foundation Edition\\mods\\SkyUI',
        totalOverwrites: 1,
        totalOverwritten: 0,
        limit: 200,
        nextCursor: null,
        overwrites: [],
        overwritten: []
      });

    const api = createTauriFluxoraApi();
    await api.mods.getModDetailsSummary(
      project().projectDirectory,
      'Default',
      'E:\\Fluxora Builds\\Foundation Edition\\mods\\SkyUI',
      request
    );
    await api.mods.getModConflictTree(
      project().projectDirectory,
      'E:\\Fluxora Builds\\Foundation Edition\\mods\\SkyUI',
      undefined,
      200,
      request
    );

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fluxora_bridge_request', {
      method: 'mods.getModDetailsSummary',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        profileName: 'Default',
        modPath: 'E:\\Fluxora Builds\\Foundation Edition\\mods\\SkyUI'
      },
      request,
      timeoutMs: undefined
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fluxora_bridge_request', {
      method: 'mods.getModConflictTree',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        modPath: 'E:\\Fluxora Builds\\Foundation Edition\\mods\\SkyUI',
        cursor: '',
        limit: 200
      },
      request,
      timeoutMs: undefined
    });
  });

  it('routes one complete mod details content snapshot on the long index timeout', async () => {
    const request: OperationRequest = { operationId: 'op_mod_details_content' };
    invokeMock.mockResolvedValue({
      modPath: 'E:\\Fluxora Builds\\Foundation Edition\\mods\\SkyUI',
      directories: [{ relativePath: '', entries: [] }],
      conflictTree: {
        modPath: 'E:\\Fluxora Builds\\Foundation Edition\\mods\\SkyUI',
        totalOverwrites: 0,
        totalOverwritten: 0,
        limit: 0,
        nextCursor: null,
        overwrites: [],
        overwritten: []
      }
    });

    const api = createTauriFluxoraApi();
    await api.mods.getModDetailsContent(
      project().projectDirectory,
      'E:\\Fluxora Builds\\Foundation Edition\\mods\\SkyUI',
      request
    );

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'mods.getModDetailsContent',
      params: {
        projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
        modPath: 'E:\\Fluxora Builds\\Foundation Edition\\mods\\SkyUI'
      },
      request,
      timeoutMs: 120_000
    });
  });

  it('normalizes FluxPack export options and keeps packaging on a long timeout', async () => {
    const request: OperationRequest = { operationId: 'op_fluxpack_export' };
    invokeMock.mockResolvedValue({
      buildName: 'Foundation Edition',
      customConfigCount: 0,
      customPatchCount: 0,
      formatVersion: 1,
      generatedAssetCount: 0,
      generatedAssetsIncluded: false,
      installPlanAvailable: true,
      installStepCount: 1,
      manifestBytes: 128,
      outputPath: 'E:\\Exports\\Foundation.fluxpack',
      sourceArchiveCount: 0
    });

    const api = createTauriFluxoraApi();
    await expect(
      api.fluxPack.export(
        {
          configPath: 'C:\\Fluxora\\Builds\\Foundation.json',
          outputPath: 'E:\\Exports\\Foundation.fluxpack',
          includeGeneratedAssets: null as unknown as boolean,
          packageType: null as unknown as 'recipe'
        },
        request
      )
    ).resolves.toMatchObject({
      buildName: 'Foundation Edition',
      operationId: 'op_fluxpack_export'
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'fluxPack.export',
      params: {
        configPath: 'C:\\Fluxora\\Builds\\Foundation.json',
        outputPath: 'E:\\Exports\\Foundation.fluxpack',
        includeGeneratedAssets: false,
        packageType: 'recipe'
      },
      request,
      timeoutMs: 7_200_000
    });
  });

  it('passes the existing build target through the long-running FluxPack install request', async () => {
    const request: OperationRequest = { operationId: 'op_fluxpack_delta' };
    invokeMock.mockResolvedValue({
      appliedConfigCount: 1,
      appliedProfileOrderItemCount: 4,
      buildName: 'Foundation Edition',
      configPath: 'C:\\Fluxora\\Builds\\Foundation.json',
      failedSourceCount: 0,
      hasWarnings: false,
      installedSourceCount: 1,
      materializedFileCount: 2,
      pendingSourceCount: 0,
      projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
      reusedDownloadCount: 1,
      reusedFileCount: 8,
      reusedSourceCount: 3,
      summary: {},
      totalSourceCount: 4,
      updatedExistingProject: true
    });

    const api = createTauriFluxoraApi();
    await expect(
      api.fluxPack.install(
        {
          existingConfigPath: 'C:\\Fluxora\\Builds\\Foundation.json',
          fluxPackPath: 'E:\\Updates\\Foundation.fluxpack',
          installRootDirectory: 'E:\\Fluxora Builds',
          manualSourceArchives: [
            {
              sourceId: 'source-0:nexus:skyrimspecialedition:3863:123',
              path: 'E:\\Downloads\\SkyUI.7z'
            }
          ]
        },
        request
      )
    ).resolves.toMatchObject({
      operationId: 'op_fluxpack_delta',
      updatedExistingProject: true
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'fluxPack.install',
      params: {
        existingConfigPath: 'C:\\Fluxora\\Builds\\Foundation.json',
        fluxPackPath: 'E:\\Updates\\Foundation.fluxpack',
        installRootDirectory: 'E:\\Fluxora Builds',
        manualSourceArchives: [
          {
            sourceId: 'source-0:nexus:skyrimspecialedition:3863:123',
            path: 'E:\\Downloads\\SkyUI.7z'
          }
        ]
      },
      request,
      timeoutMs: 7_200_000
    });
  });

  it('plans FluxPack acquisition through the typed bridge before installation', async () => {
    const request: OperationRequest = { operationId: 'op_fluxpack_plan' };
    invokeMock.mockResolvedValue({
      automaticDownloadCount: 0,
      manualDownloadCount: 1,
      reusableDownloadCount: 2,
      reusableSourceCount: 3,
      sources: [
        {
          acquisitionMode: 'manual',
          archiveFileName: 'SkyUI.7z',
          canAutomaticallyDownload: false,
          displayName: 'SkyUI',
          manualDownloadUrl:
            'https://www.nexusmods.com/skyrimspecialedition/mods/3863?tab=files&file_id=123',
          providerDisplayName: 'Nexus Mods',
          providerId: 'nexus',
          requiresManualDownload: true,
          sourceId: 'source-0:nexus:skyrimspecialedition:3863:123',
          version: '5.2'
        }
      ],
      summary: { buildName: 'Foundation Edition' },
      updatesExistingProject: true
    });

    const api = createTauriFluxoraApi();
    await expect(
      api.fluxPack.planInstall(
        {
          existingConfigPath: 'C:\\Fluxora\\Builds\\Foundation.json',
          fluxPackPath: 'E:\\Updates\\Foundation.fluxpack'
        },
        request
      )
    ).resolves.toMatchObject({
      manualDownloadCount: 1,
      operationId: 'op_fluxpack_plan'
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'fluxPack.planInstall',
      params: {
        existingConfigPath: 'C:\\Fluxora\\Builds\\Foundation.json',
        fluxPackPath: 'E:\\Updates\\Foundation.fluxpack'
      },
      request,
      timeoutMs: 7_200_000
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

  it('gives local download imports a long file-mutation timeout', async () => {
    const request: OperationRequest = { operationId: 'op_downloads_import_file' };
    const projectDirectory = project().projectDirectory;
    const sourcePath = 'E:\\Incoming Mods\\large-mod.7z';
    invokeMock.mockResolvedValue({ path: 'E:\\Fluxora Builds\\Foundation Edition\\downloads\\large-mod.7z' });

    const api = createTauriFluxoraApi();
    await api.downloads.importFile(projectDirectory, sourcePath, request);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'downloads.importFile',
      params: { projectDirectory, sourcePath },
      request,
      timeoutMs: 7_200_000
    });
  });

  it('routes download rename through the typed bridge with a long file-mutation timeout', async () => {
    const request: OperationRequest = { operationId: 'op_downloads_rename' };
    const projectDirectory = project().projectDirectory;
    const downloadPath = `${projectDirectory}\\downloads\\Old Archive.7z`;
    const newBaseName = 'New Archive';
    invokeMock.mockResolvedValue({
      id: `${projectDirectory}\\downloads\\${newBaseName}.7z`,
      localPath: `${projectDirectory}\\downloads\\${newBaseName}.7z`,
      fileName: `${newBaseName}.7z`
    });

    const api = createTauriFluxoraApi();
    await api.downloads.rename(projectDirectory, downloadPath, newBaseName, request);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'downloads.rename',
      params: { projectDirectory, downloadPath, newBaseName },
      request,
      timeoutMs: 7_200_000
    });
  });

  it('writes the exact unquoted download path through the native clipboard command', async () => {
    const rawPath = 'E:\\Fluxora Builds\\Загрузки\\New Archive.7z';
    invokeMock.mockResolvedValue(undefined);

    const api = createTauriFluxoraApi();
    await api.clipboard.writeText(rawPath);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_clipboard_write_text', {
      text: rawPath
    });
  });

  it('keeps archive extraction and mod installation on a long file-mutation timeout', async () => {
    const request: OperationRequest = { operationId: 'op_downloads_install' };
    const installRequest = {
      projectDirectory: project().projectDirectory,
      downloadPath: 'E:\\Fluxora Builds\\Foundation Edition\\downloads\\large-mod.7z',
      modName: 'Large Mod',
      profileName: 'Default'
    };
    invokeMock.mockResolvedValue({
      id: 'large-mod',
      name: 'Large Mod',
      version: '1.4.0',
      isEnabled: true,
      latestVersion: '1.4.0',
      sourceIsNexus: true,
      sourceIsModdingFlow: false,
      sourceProvider: 'nexus',
      sourceGameDomain: 'skyrimspecialedition',
      sourceModId: '182366',
      sourceFileId: '770345',
      sourceUrl: 'nxm://skyrimspecialedition/mods/182366/files/770345',
      isLocal: false,
      isTranslation: false,
      isPatch: false
    });

    const api = createTauriFluxoraApi();
    await expect(api.downloads.install(installRequest, request)).resolves.toMatchObject({
      latestVersion: '1.4.0',
      sourceIsNexus: true,
      sourceProvider: 'nexus',
      isLocal: false,
      operationId: request.operationId
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'downloads.install',
      params: {
        ...installRequest,
        existingModMode: 0,
        placementOverridesJson: ''
      },
      request,
      timeoutMs: 7_200_000
    });
  });

  it('submits durable installs with a short acknowledgement and typed background progress channel', async () => {
    const operation: OperationRequest = { operationId: 'op_install_submit' };
    const install = {
      projectDirectory: project().projectDirectory,
      sourceKind: 'download' as const,
      sourcePath: `${project().projectDirectory}\\downloads\\queued-mod.7z`,
      isFomod: true,
      modName: 'Queued Mod',
      profileName: 'Default',
      selectedOptionIds: ['main-option'],
      manualDecisions: [{ optionId: 'main-option', selected: true }],
      placementOverridesJson: JSON.stringify({
        schemaVersion: 2,
        files: [],
        directories: [],
        excludedSourcePaths: ['Data/Scripts/Disabled.pex']
      })
    };
    invokeMock.mockResolvedValue({
      operationId: operation.operationId,
      state: 'queued',
      stage: 'queued'
    });
    listenMock.mockResolvedValue(() => undefined);

    const api = createTauriFluxoraApi();
    await api.installs.submit(install, operation);
    api.installs.onProgress(() => undefined);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'installs.submit',
      params: {
        projectDirectory: install.projectDirectory,
        sourceKind: install.sourceKind,
        sourcePath: install.sourcePath,
        isFomod: install.isFomod,
        modName: install.modName,
        profileName: install.profileName,
        operationId: operation.operationId,
        existingModMode: 0,
        selectedOptionIdsJson: '["main-option"]',
        manualDecisionsJson: '[{"optionId":"main-option","selected":true}]',
        placementOverridesJson: install.placementOverridesJson
      },
      request: operation
    });
    expect(listenMock).toHaveBeenCalledWith('fluxora:installs:progress', expect.any(Function));
  });

  it('cancels a durable install through the install bridge lane contract', async () => {
    const projectDirectory = project().projectDirectory;
    const targetOperationId = 'op_install_target';
    const request: OperationRequest = { operationId: 'op_delete_pending_install' };
    invokeMock.mockResolvedValue({
      operationId: targetOperationId,
      state: 'cancelled',
      stage: 'cancelled'
    });

    const api = createTauriFluxoraApi();
    await api.installs.cancel(projectDirectory, targetOperationId, request);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'installs.cancel',
      params: { projectDirectory, operationId: targetOperationId },
      request,
      timeoutMs: 7_200_000
    });
  });

  it('plans install identity and forwards an opaque matched-target decision unchanged', async () => {
    const planOperation: OperationRequest = { operationId: 'op_downloads_identity_plan' };
    const installOperation: OperationRequest = { operationId: 'op_archives_identity_install' };
    const projectDirectory = project().projectDirectory;
    const downloadPath = `${projectDirectory}\\downloads\\SkyUI.7z`;
    const archivePath = 'E:\\Incoming Mods\\SkyUI Update.7z';
    const plan = {
      suggestedModName: 'SkyUI',
      resolutionKind: 'exact',
      matchedTarget: {
        modUuid: 'mod-skyui-uuid',
        displayName: 'SkyUI',
        folderName: 'SkyUI'
      },
      resolutionId: 'identity-resolution-1',
      fomodInstaller: { isFomod: false },
      evidenceCodes: ['source.stable'],
      score: 100
    };
    invokeMock
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce({ id: 'mod-skyui-uuid', name: 'SkyUI' });

    const api = createTauriFluxoraApi();
    await expect(
      api.downloads.planInstall(projectDirectory, downloadPath, planOperation)
    ).resolves.toMatchObject(plan);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fluxora_bridge_request', {
      method: 'downloads.planInstall',
      params: { projectDirectory, downloadPath },
      request: planOperation,
      timeoutMs: 7_200_000
    });

    await api.archives.install(
      {
        projectDirectory,
        archivePath,
        modName: 'User edit is ignored for the matched target',
        profileName: 'Default',
        existingModMode: 1,
        resolutionId: plan.resolutionId,
        identityDecision: 'use-match',
        targetModUuid: plan.matchedTarget.modUuid,
        newNamePolicy: 'first-free-copy-suffix'
      },
      installOperation
    );

    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fluxora_bridge_request', {
      method: 'archives.install',
      params: {
        projectDirectory,
        archivePath,
        modName: 'User edit is ignored for the matched target',
        profileName: 'Default',
        existingModMode: 1,
        resolutionId: 'identity-resolution-1',
        identityDecision: 'use-match',
        targetModUuid: 'mod-skyui-uuid',
        newNamePolicy: 'first-free-copy-suffix',
        placementOverridesJson: ''
      },
      request: installOperation,
      timeoutMs: 7_200_000
    });
  });

  it('forwards the final user-edited mod name when replanning install identity', async () => {
    const operation: OperationRequest = { operationId: 'op_install_name_replan' };
    const projectDirectory = project().projectDirectory;
    const archivePath = 'E:\\Incoming Mods\\Unofficial Skyrim Modders Patch RU.rar';
    const modName = 'Unofficial Skyrim Modders Patch';
    invokeMock.mockResolvedValueOnce({
      suggestedModName: modName,
      resolutionKind: 'probable',
      matchedTarget: {
        modUuid: 'installed-usmp',
        displayName: modName,
        folderName: modName
      },
      resolutionId: 'identity-resolution-user-name',
      fomodInstaller: { isFomod: false },
      evidenceCodes: ['name.normalized-exact', 'source.stable-mod-id-conflict'],
      score: 90
    });

    const api = createTauriFluxoraApi();
    await api.archives.planInstall(
      projectDirectory,
      archivePath,
      'Default',
      modName,
      operation
    );

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'archives.planInstall',
      params: { projectDirectory, archivePath, profileName: 'Default', modName },
      request: operation,
      timeoutMs: 7_200_000
    });
  });

  it('forwards profile-aware FOMOD context and manual decisions additively', async () => {
    const operation: OperationRequest = { operationId: 'op_fomod_smart_select' };
    const projectDirectory = project().projectDirectory;
    const downloadPath = `${projectDirectory}\\downloads\\Patches.zip`;
    const archivePath = 'E:\\Incoming Mods\\Patches.zip';
    const manualDecisions = [{ optionId: 'visual-style', selected: true }];
    invokeMock
      .mockResolvedValueOnce({ isFomod: true, steps: [] })
      .mockResolvedValueOnce({ suggestedModName: 'Patches', fomodInstaller: { isFomod: true } })
      .mockResolvedValueOnce({ id: 'installed-patches', name: 'Patches' });

    const api = createTauriFluxoraApi();
    await api.downloads.analyzeFomod(
      projectDirectory,
      downloadPath,
      'Default',
      manualDecisions,
      operation
    );
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fluxora_bridge_request', {
      method: 'downloads.analyzeFomod',
      params: {
        projectDirectory,
        downloadPath,
        profileName: 'Default',
        manualDecisionsJson: JSON.stringify(manualDecisions)
      },
      request: operation,
      timeoutMs: 7_200_000
    });

    await api.archives.planInstall(projectDirectory, archivePath, 'Default', operation);
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fluxora_bridge_request', {
      method: 'archives.planInstall',
      params: { projectDirectory, archivePath, profileName: 'Default' },
      request: operation,
      timeoutMs: 7_200_000
    });

    await api.downloads.installFomod(
      {
        projectDirectory,
        downloadPath,
        modName: 'Patches',
        selectedOptionIds: ['lux-patch', 'visual-style'],
        profileName: 'Default',
        fomodContextId: 'fomod-context-1',
        manualDecisions
      },
      operation
    );
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'fluxora_bridge_request', {
      method: 'downloads.installFomod',
      params: {
        projectDirectory,
        downloadPath,
        modName: 'Patches',
        profileName: 'Default',
        fomodContextId: 'fomod-context-1',
        existingModMode: 0,
        placementOverridesJson: '',
        selectedOptionIdsJson: JSON.stringify(['lux-patch', 'visual-style']),
        manualDecisionsJson: JSON.stringify(manualDecisions)
      },
      request: operation,
      timeoutMs: 7_200_000
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

  it('routes build content watch commands through the typed Rust shell facade', async () => {
    const watchRequest: FluxoraBuildContentWatchRequest = {
      projectDirectory: 'C:\\Fluxora\\Builds\\Foundation',
      modsDirectory: 'C:\\Fluxora\\Builds\\Foundation\\mods',
      profilesDirectory: 'C:\\Fluxora\\Builds\\Foundation\\profiles',
      profileName: 'Default',
      gameDirectory: 'E:\\Steam\\Skyrim Special Edition'
    };
    const operation: OperationRequest = { operationId: 'op_build_content_watch' };
    const unwatchRequest: OperationRequest = { operationId: 'op_build_content_unwatch' };
    invokeMock
      .mockResolvedValueOnce({ accepted: true, operationId: operation.operationId })
      .mockResolvedValueOnce({ accepted: true, operationId: unwatchRequest.operationId });

    const api = createTauriFluxoraApi();
    await expect(api.buildContent.watch(watchRequest, operation)).resolves.toEqual({
      accepted: true,
      operationId: operation.operationId
    });
    await expect(api.buildContent.unwatch(unwatchRequest)).resolves.toEqual({
      accepted: true,
      operationId: unwatchRequest.operationId
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fluxora_build_content_watch', {
      watchRequest,
      operation
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fluxora_build_content_unwatch', {
      operation: unwatchRequest
    });
  });

  it('subscribes to build content changes through the typed Tauri event bridge', async () => {
    const dispose = vi.fn();
    const callback = vi.fn();
    listenMock.mockResolvedValue(dispose);

    const api = createTauriFluxoraApi();
    const unsubscribe = api.buildContent.onChanged(callback);

    expect(listenMock).toHaveBeenCalledWith(
      'fluxora:build-content:changed',
      expect.any(Function)
    );

    const listener = listenMock.mock.calls[0][1] as (event: { payload: unknown }) => void;
    const event = {
      projectDirectory: 'C:\\Fluxora\\Builds\\Foundation',
      modsDirectory: 'C:\\Fluxora\\Builds\\Foundation\\mods',
      profilesDirectory: 'C:\\Fluxora\\Builds\\Foundation\\profiles',
      profileName: 'Default',
      eventId: 'evt_1_build_content_1',
      sequence: 1,
      reason: 'mods-created',
      changes: [
        {
          path: 'C:\\Fluxora\\Builds\\Foundation\\mods\\SkyUI',
          fileName: 'SkyUI',
          kind: 'created',
          area: 'mods'
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
