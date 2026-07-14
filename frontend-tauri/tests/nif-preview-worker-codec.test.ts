import { describe, expect, it } from 'vitest';

import { encodeNifModelForTransfer } from '../src/renderer/features/file-preview/nif-preview-worker-codec';
import type { ParsedNifModel } from '../src/renderer/features/file-preview/nif-parser';

describe('NIF preview worker codec', () => {
  it('converts a large mesh to transferable preview-space typed arrays', () => {
    const vertexCount = 60_000;
    const positions = Array.from({ length: vertexCount * 3 }, (_, index) => {
      const axis = index % 3;
      return axis === 0 ? index / 3 : axis === 1 ? 2 : 4;
    });
    const model: ParsedNifModel = {
      meshes: [{ name: 'Large fixture', positions }],
      texturePaths: [],
      supportedBlocks: ['BSTriShape'],
      warnings: []
    };

    const encoded = encodeNifModelForTransfer(model);
    const mesh = encoded.model.meshes[0];

    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.positions).toHaveLength(vertexCount * 3);
    expect(Array.from(mesh.positions.slice(0, 3))).toEqual([0, 4, -2]);
    expect(mesh.bounds.min).toEqual([0, 4, -2]);
    expect(mesh.bounds.max[0]).toBe(vertexCount - 1);
    expect(encoded.transfer).toContain(mesh.positions.buffer);
  });
});
