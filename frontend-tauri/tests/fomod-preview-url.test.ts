import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFluxoraApi } from '../src/tauri/fluxora-api';

const unavailableInvoker = {
  invoke: async () => {
    throw new Error('IPC is not used by FOMOD preview URL conversion.');
  }
};

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
  vi.restoreAllMocks();
});

describe('FOMOD preview URLs', () => {
  it('keeps browser-safe image sources unchanged', () => {
    const api = createFluxoraApi(unavailableInvoker);

    expect(api.downloads.toFomodPreviewImageUrl(' data:image/png;base64,AA== ')).toBe(
      'data:image/png;base64,AA=='
    );
  });

  it('converts native preview cache paths through the Tauri asset protocol', () => {
    const convertFileSrc = vi.fn((path: string, protocol?: string) =>
      `asset://localhost/${protocol ?? 'asset'}/${encodeURIComponent(path)}`
    );
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __TAURI_INTERNALS__: { convertFileSrc }
      }
    });
    const api = createFluxoraApi(unavailableInvoker);
    const path = 'D:\\Fluxora\\downloads\\.fomod-previews\\option.png';

    expect(api.downloads.toFomodPreviewImageUrl(path)).toContain('asset://localhost/');
    expect(convertFileSrc).toHaveBeenCalledWith(path, 'asset');
  });
});
