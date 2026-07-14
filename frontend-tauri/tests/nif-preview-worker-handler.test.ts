import { describe, expect, it } from 'vitest';

import { handleNifPreviewWorkerRequest } from '../src/renderer/features/file-preview/nif-preview-worker-handler';
import {
  createSseDynamicTriShapeNifFixture,
  createSseEmptyEffectTriShapesNifFixture,
  createSseMismatchedDataSizeTriShapeNifFixture,
  createSseSkinnedTriShapeNifFixture,
  createSseTinyScaleTriShapeNifFixture
} from './fixtures/sse-dynamic-nif-fixture';

describe('NIF preview worker handler', () => {
  it('decodes SSE dynamic geometry into transferable typed arrays', () => {
    const dispatch = handleNifPreviewWorkerRequest({
      type: 'parse-nif',
      requestId: 17,
      generation: 4,
      buffer: createSseDynamicTriShapeNifFixture()
    });

    expect(dispatch.response.type).toBe('nif-parsed');
    if (dispatch.response.type !== 'nif-parsed') {
      throw new Error(`Unexpected worker response: ${dispatch.response.type}`);
    }

    const mesh = dispatch.response.model.meshes[0];
    expect(dispatch.response).toMatchObject({ requestId: 17, generation: 4 });
    expect(mesh.name).toBe('BSDynamicTriShape 2');
    expect(Array.from(mesh.positions)).toEqual([
      0, 0, -0,
      1, 0, -0,
      0, 0, -1
    ]);
    expect(Array.from(mesh.indices ?? [])).toEqual([0, 1, 2]);
    expect(mesh.previewCoordinates).toBe(true);
    expect(dispatch.transfer).toContain(mesh.positions.buffer);
    expect(dispatch.transfer).toContain(mesh.indices?.buffer);
  });

  it('keeps tiny valid BSTriShape geometry on the off-main-thread path', () => {
    const dispatch = handleNifPreviewWorkerRequest({
      type: 'parse-nif',
      requestId: 18,
      generation: 5,
      buffer: createSseTinyScaleTriShapeNifFixture()
    });

    expect(dispatch.response.type).toBe('nif-parsed');
    if (dispatch.response.type !== 'nif-parsed') {
      throw new Error(`Unexpected worker response: ${dispatch.response.type}`);
    }

    const mesh = dispatch.response.model.meshes[0];
    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.positions).toHaveLength(9);
    expect(Array.from(mesh.indices ?? [])).toEqual([0, 1, 2]);
    expect(mesh.bounds.max[0] - mesh.bounds.min[0]).toBeGreaterThan(0);
    expect(mesh.bounds.max[2] - mesh.bounds.min[2]).toBeGreaterThan(0);
    expect(dispatch.transfer).toContain(mesh.positions.buffer);
  });

  it.each([
    {
      name: 'skin partitions with empty sections',
      buffer: () => createSseSkinnedTriShapeNifFixture({ before: 1, after: 1 }),
      meshName: 'NiSkinPartition 4'
    },
    {
      name: 'a recovered static payload boundary',
      buffer: createSseMismatchedDataSizeTriShapeNifFixture,
      meshName: 'BSTriShape 1'
    }
  ])('decodes $name on the off-main-thread path', ({ buffer, meshName }) => {
    const dispatch = handleNifPreviewWorkerRequest({
      type: 'parse-nif',
      requestId: 19,
      generation: 6,
      buffer: buffer()
    });

    expect(dispatch.response.type).toBe('nif-parsed');
    if (dispatch.response.type !== 'nif-parsed') {
      throw new Error(`Unexpected worker response: ${dispatch.response.type}`);
    }

    const mesh = dispatch.response.model.meshes[0];
    expect(mesh.name).toBe(meshName);
    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
    expect(dispatch.transfer).toContain(mesh.positions.buffer);
    expect(dispatch.transfer).toContain(mesh.indices?.buffer);
  });

  it('returns an intentionally empty effect container as a successful worker result', () => {
    const dispatch = handleNifPreviewWorkerRequest({
      type: 'parse-nif',
      requestId: 20,
      generation: 7,
      buffer: createSseEmptyEffectTriShapesNifFixture()
    });

    expect(dispatch.response.type).toBe('nif-parsed');
    if (dispatch.response.type !== 'nif-parsed') {
      throw new Error(`Unexpected worker response: ${dispatch.response.type}`);
    }
    expect(dispatch.response.model.meshes).toEqual([]);
    expect(dispatch.response.model.warnings).toContain(
      'NIF contains no renderable triangle geometry; the preview is intentionally empty.'
    );
    expect(dispatch.transfer).toEqual([]);
  });
});
