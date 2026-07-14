import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleNifPreviewWorkerRequest } from '../src/renderer/features/file-preview/nif-preview-worker-handler';
import { createTauriFluxoraApi } from '../src/tauri/fluxora-api';
import {
  createSseDynamicTriShapeNifFixture,
  createSseTinyScaleTriShapeNifFixture
} from './fixtures/sse-dynamic-nif-fixture';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
const onDragDropEventMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: onDragDropEventMock })
}));

type TauriTestWindow = Window & { __TAURI_INTERNALS__: Record<string, never> };
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
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

describe('NIF preview session facade', () => {
  it('passes the project directory directly when opening the preview window', async () => {
    invokeMock.mockResolvedValue(undefined);
    const api = createTauriFluxoraApi();

    await api.windowControls.openFilePreview(
      'C:\\Users\\Tester\\AppData\\Roaming\\Fluxora\\Builds\\Foundation Edition.json',
      'E:\\Fluxora Builds\\Foundation Edition',
      'E:\\Fluxora Builds\\Foundation Edition\\mods\\PGPatcher Output',
      'meshes/traps/pressureplate/trapstonepressureplate01.nif',
      'trapstonepressureplate01.nif',
      'Default',
      'nif'
    );

    expect(invokeMock).toHaveBeenCalledWith('fluxora_open_file_preview_window', {
      configPath: 'C:\\Users\\Tester\\AppData\\Roaming\\Fluxora\\Builds\\Foundation Edition.json',
      projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
      modPath: 'E:\\Fluxora Builds\\Foundation Edition\\mods\\PGPatcher Output',
      relativePath: 'meshes/traps/pressureplate/trapstonepressureplate01.nif',
      fileName: 'trapstonepressureplate01.nif',
      profileName: 'Default',
      kind: 'nif'
    });
  });

  it('starts an opaque preview session without exposing native asset paths', async () => {
    invokeMock.mockResolvedValue({
      sessionId: 'preview-session-token',
      variants: [{
        variantId: 'variant-token',
        modName: 'Skyland AIO',
        order: 7,
        enabled: true,
        relativePath: 'meshes/armor/cuirass.nif',
        size: 1024
      }],
      activeIndex: 0,
      modelHandle: {
        assetId: 'asset-token',
        size: 1024,
        mimeType: 'application/x-nif',
        relativePath: 'meshes/armor/cuirass.nif',
        source: 'Skyland AIO',
        contentKey: 'preview-v1-model'
      }
    });

    const api = createTauriFluxoraApi();
    const result = await api.mods.startNifPreview(
      'E:\\Fluxora Builds\\Foundation Edition',
      'Default',
      'E:\\Fluxora Builds\\Foundation Edition\\mods\\Skyland AIO',
      'meshes/armor/cuirass.nif',
      { operationId: 'op_nif_preview' }
    );

    expect(invokeMock).toHaveBeenCalledWith('fluxora_start_nif_preview', {
      projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
      profileName: 'Default',
      initialModPath: 'E:\\Fluxora Builds\\Foundation Edition\\mods\\Skyland AIO',
      relativePath: 'meshes/armor/cuirass.nif',
      request: { operationId: 'op_nif_preview' }
    });
    expect(result.modelHandle).not.toHaveProperty('resolvedPath');
    expect(result.variants[0]).not.toHaveProperty('modPath');
  });

  it('uses session tokens for batch preparation, raw reads, and explicit cleanup', async () => {
    const rawResponse = new Uint8Array([1, 2, 3, 4]);
    invokeMock
      .mockResolvedValueOnce({ assets: [], missing: ['textures/missing.dds'] })
      .mockResolvedValueOnce(rawResponse)
      .mockResolvedValueOnce(undefined);

    const api = createTauriFluxoraApi();
    const batch = await api.mods.prepareNifPreviewTextures(
      'preview-session-token',
      ['textures/missing.dds']
    );
    const bytes = await api.mods.readNifPreviewAssetBytes(
      'preview-session-token',
      'asset-token'
    );
    await api.mods.endNifPreview('preview-session-token');

    expect(batch.missing).toEqual(['textures/missing.dds']);
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(bytes).toBe(rawResponse.buffer);
    expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3, 4]);
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fluxora_prepare_nif_preview_textures', {
      sessionId: 'preview-session-token',
      texturePaths: ['textures/missing.dds']
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fluxora_read_nif_preview_asset_bytes', {
      sessionId: 'preview-session-token',
      assetId: 'asset-token'
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'fluxora_end_nif_preview', {
      sessionId: 'preview-session-token'
    });
  });

  it('preserves dynamic NIF bytes across the Tauri facade and worker boundary', async () => {
    const fixture = createSseDynamicTriShapeNifFixture();
    invokeMock.mockResolvedValue(new Uint8Array(fixture.slice(0)));

    const api = createTauriFluxoraApi();
    const bytes = await api.mods.readNifPreviewAssetBytes(
      'preview-session-token',
      'dynamic-model-token'
    );
    const dispatch = handleNifPreviewWorkerRequest({
      type: 'parse-nif',
      requestId: 23,
      generation: 8,
      buffer: bytes
    });

    expect(bytes.byteLength).toBe(fixture.byteLength);
    expect([...new Uint8Array(bytes)]).toEqual([...new Uint8Array(fixture)]);
    expect(dispatch.response.type).toBe('nif-parsed');
    if (dispatch.response.type === 'nif-parsed') {
      expect(dispatch.response.model.meshes[0].name).toBe('BSDynamicTriShape 2');
      expect(Array.from(dispatch.response.model.meshes[0].indices ?? [])).toEqual([0, 1, 2]);
    }
    expect(invokeMock).toHaveBeenCalledWith('fluxora_read_nif_preview_asset_bytes', {
      sessionId: 'preview-session-token',
      assetId: 'dynamic-model-token'
    });
  });

  it('normalizes a JSON byte array before handing NIF data to the worker', async () => {
    const fixture = createSseDynamicTriShapeNifFixture();
    invokeMock.mockResolvedValue([...new Uint8Array(fixture)]);

    const api = createTauriFluxoraApi();
    const bytes = await api.mods.readNifPreviewAssetBytes(
      'preview-session-token',
      'json-byte-array-model-token'
    );
    const dispatch = handleNifPreviewWorkerRequest({
      type: 'parse-nif',
      requestId: 24,
      generation: 9,
      buffer: bytes
    });

    expect(bytes.byteLength).toBe(fixture.byteLength);
    expect([...new Uint8Array(bytes)]).toEqual([...new Uint8Array(fixture)]);
    expect(dispatch.response.type).toBe('nif-parsed');
  });

  it('rejects malformed binary IPC data instead of reporting an unsupported NIF layout', async () => {
    invokeMock.mockResolvedValue({ bytes: [1, 2, 3] });

    const api = createTauriFluxoraApi();

    await expect(api.mods.readNifPreviewAssetBytes(
      'preview-session-token',
      'malformed-model-token'
    )).rejects.toThrow('NIF preview returned invalid binary asset data.');
  });

  it('keeps the raw Tauri ArrayBuffer zero-copy for tiny geometry worker decoding', async () => {
    const fixture = createSseTinyScaleTriShapeNifFixture();
    invokeMock.mockResolvedValue(fixture);

    const api = createTauriFluxoraApi();
    const bytes = await api.mods.readNifPreviewAssetBytes(
      'preview-session-token',
      'tiny-model-token'
    );
    const dispatch = handleNifPreviewWorkerRequest({
      type: 'parse-nif',
      requestId: 24,
      generation: 9,
      buffer: bytes
    });

    expect(bytes).toBe(fixture);
    expect(dispatch.response.type).toBe('nif-parsed');
    if (dispatch.response.type === 'nif-parsed') {
      expect(Array.from(dispatch.response.model.meshes[0].indices ?? [])).toEqual([0, 1, 2]);
    }
  });
});
