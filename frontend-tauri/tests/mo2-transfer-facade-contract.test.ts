import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportRequest,
  FluxoraMo2TransferHandoff,
  FluxoraProject,
  OperationRequest
} from '../src/shared/fluxora-api';
import { FluxoraIpcChannels } from '../src/shared/fluxora-api';
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

const operation = (operationId: string): OperationRequest => ({ operationId });

const importRequest: FluxoraModOrganizerImportRequest = {
  sourceDirectory: 'E:\\MO2\\Foundation Edition',
  destinationRootDirectory: 'D:\\Fluxora Builds',
  replaceExisting: false
};

const analysis: FluxoraModOrganizerImportAnalysis = {
  sourceDirectory: importRequest.sourceDirectory,
  destinationRootDirectory: importRequest.destinationRootDirectory,
  targetProjectDirectory: 'D:\\Fluxora Builds\\Foundation Edition',
  targetConfigPath: 'D:\\Fluxora Builds\\Foundation Edition\\fluxora.json',
  projectName: 'Foundation Edition',
  profileName: 'Default',
  templateId: 'skyrim-se',
  gameName: 'Skyrim Special Edition',
  gamePath: 'E:\\Steam\\Skyrim Special Edition',
  totalBytes: 109 * 1024 * 1024 * 1024,
  availableBytes: 816 * 1024 * 1024 * 1024,
  modCount: 621,
  separatorCount: 0,
  hasEnoughSpace: true,
  willOverwrite: false,
  canImport: true,
  statusMessage: 'Сборка готова к переносу.',
  warningMessage: '',
  operationId: 'op_native_analysis'
};

const importedProject: FluxoraProject = {
  id: 'foundation-edition',
  name: 'Foundation Edition',
  templateId: 'skyrim-se',
  uiTemplateId: 'skyrim',
  gameName: 'Skyrim Special Edition',
  gamePath: 'E:\\Steam\\Skyrim Special Edition',
  installRootDirectory: 'D:\\Fluxora Builds',
  projectDirectory: 'D:\\Fluxora Builds\\Foundation Edition',
  configPath: 'D:\\Fluxora Builds\\Foundation Edition\\fluxora.json'
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
    return;
  }

  Reflect.deleteProperty(globalThis, 'window');
});

describe('MO2 transfer typed facade contract', () => {
  it('routes MO2 analysis through the bridge with renderer operation metadata', async () => {
    const request = operation('op_transfer_analyze');
    invokeMock.mockResolvedValue(analysis);

    const api = createTauriFluxoraApi();
    await expect(
      api.transfer.analyzeMo2(
        importRequest.sourceDirectory,
        importRequest.destinationRootDirectory,
        undefined,
        request
      )
    ).resolves.toMatchObject({
      projectName: 'Foundation Edition',
      operationId: request.operationId
    });

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'transfer.analyzeMo2',
      params: {
        sourceDirectory: importRequest.sourceDirectory,
        destinationRootDirectory: importRequest.destinationRootDirectory,
        existingConfigPath: ''
      },
      request,
      timeoutMs: undefined
    });
  });

  it('keeps MO2 imports on the long-running bridge timeout with the request as params', async () => {
    const request = operation('op_transfer_import');
    invokeMock.mockResolvedValue(importedProject);

    const api = createTauriFluxoraApi();
    await expect(api.transfer.importMo2(importRequest, request)).resolves.toEqual(importedProject);

    expect(invokeMock).toHaveBeenCalledWith('fluxora_bridge_request', {
      method: 'transfer.importMo2',
      params: importRequest,
      request,
      timeoutMs: 7_200_000
    });
  });

  it('hands off a settings-window transfer to the main Tauri window intact', async () => {
    const handoff: FluxoraMo2TransferHandoff = {
      request: importRequest,
      analysis
    };
    invokeMock.mockResolvedValue(undefined);

    const api = createTauriFluxoraApi();
    await expect(api.transfer.startMo2InMain(handoff)).resolves.toBeUndefined();
    await expect(api.transfer.openMo2InMain()).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fluxora_transfer_start_mo2_in_main', {
      handoff
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fluxora_transfer_open_mo2_in_main');
  });

  it('subscribes to MO2 transfer handoff and open events through typed Tauri events', async () => {
    const dispose = vi.fn();
    const handoffCallback = vi.fn();
    const openCallback = vi.fn();
    listenMock.mockResolvedValue(dispose);

    const api = createTauriFluxoraApi();
    const unsubscribeHandoff = api.transfer.onMo2Handoff(handoffCallback);
    const unsubscribeOpen = api.transfer.onMo2Open(openCallback);

    expect(listenMock).toHaveBeenNthCalledWith(
      1,
      FluxoraIpcChannels.transferMo2Handoff,
      expect.any(Function)
    );
    expect(listenMock).toHaveBeenNthCalledWith(
      2,
      FluxoraIpcChannels.transferMo2Open,
      expect.any(Function)
    );

    const handoffListener = listenMock.mock.calls[0][1] as (event: { payload: unknown }) => void;
    const openListener = listenMock.mock.calls[1][1] as (event: { payload: unknown }) => void;
    const handoff: FluxoraMo2TransferHandoff = { request: importRequest, analysis };

    handoffListener({ payload: handoff });
    openListener({ payload: undefined });

    expect(handoffCallback).toHaveBeenCalledWith(handoff);
    expect(openCallback).toHaveBeenCalledWith(undefined);

    unsubscribeHandoff();
    unsubscribeOpen();
    await Promise.resolve();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
