import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { NifPreviewResourceCache } from '../src/renderer/features/file-preview/nif-preview-resource-cache';

describe('NIF preview renderer resource cache', () => {
  it('evicts least-recently-used raw buffers before crossing the byte budget', () => {
    const cache = new NifPreviewResourceCache({ maxTextures: 64, maxRawBytes: 10 });
    cache.setRaw('old', new ArrayBuffer(6));
    cache.setRaw('new', new ArrayBuffer(6));

    expect(cache.getRaw('old')).toBeUndefined();
    expect(cache.getRaw('new')?.byteLength).toBe(6);
    expect(cache.rawBytes).toBe(6);
  });

  it('keeps no more than the configured texture count and disposes evictions', () => {
    const cache = new NifPreviewResourceCache({ maxTextures: 2, maxRawBytes: 256 });
    const first = new THREE.Texture();
    const second = new THREE.Texture();
    const third = new THREE.Texture();
    const dispose = vi.spyOn(first, 'dispose');

    cache.setTexture('first', first);
    cache.setTexture('second', second);
    cache.getTexture('second');
    cache.setTexture('third', third);

    expect(cache.getTexture('first')).toBeUndefined();
    expect(cache.textureCount).toBe(2);
    expect(dispose).toHaveBeenCalledOnce();
    cache.dispose();
  });

  it('removes transferred buffers from the raw LRU so detached memory is not reused', () => {
    const cache = new NifPreviewResourceCache({ maxTextures: 64, maxRawBytes: 256 });
    cache.setRaw('model', new ArrayBuffer(32));

    const transferred = cache.takeRaw('model');

    expect(transferred?.byteLength).toBe(32);
    expect(cache.getRaw('model')).toBeUndefined();
    expect(cache.rawBytes).toBe(0);
  });
});
