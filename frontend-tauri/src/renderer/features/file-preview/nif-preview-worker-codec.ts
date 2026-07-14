import type { ParsedNifModel } from './nif-parser';
import type { WorkerNifModel } from './nif-preview-worker-protocol';

const previewVectors = (values: number[]): Float32Array => {
  const transformed = new Float32Array(values.length);
  for (let index = 0; index + 2 < values.length; index += 3) {
    transformed[index] = values[index];
    transformed[index + 1] = values[index + 2];
    transformed[index + 2] = -values[index + 1];
  }
  return transformed;
};

const vectorBounds = (positions: Float32Array): WorkerNifModel['meshes'][number]['bounds'] => {
  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let index = 0; index + 2 < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2
  ];
  let radiusSquared = 0;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const x = positions[index] - center[0];
    const y = positions[index + 1] - center[1];
    const z = positions[index + 2] - center[2];
    radiusSquared = Math.max(radiusSquared, x * x + y * y + z * z);
  }
  return { min, max, center, radius: Math.sqrt(radiusSquared) };
};

export const encodeNifModelForTransfer = (parsed: ParsedNifModel): {
  model: WorkerNifModel;
  transfer: Transferable[];
} => {
  const transfer: Transferable[] = [];
  const meshes = parsed.meshes.map((mesh) => {
    const positions = previewVectors(mesh.positions);
    const indices = mesh.indices?.length ? Uint32Array.from(mesh.indices) : undefined;
    const normals = mesh.normals?.length ? previewVectors(mesh.normals) : undefined;
    const uvs = mesh.uvs?.length ? Float32Array.from(mesh.uvs) : undefined;
    transfer.push(positions.buffer);
    if (indices) transfer.push(indices.buffer);
    if (normals) transfer.push(normals.buffer);
    if (uvs) transfer.push(uvs.buffer);
    return {
      name: mesh.name,
      previewCoordinates: true as const,
      bounds: vectorBounds(positions),
      positions,
      indices,
      normals,
      uvs,
      texturePath: mesh.texturePath,
      alpha: mesh.alpha
    };
  });
  return {
    model: {
      meshes,
      texturePaths: parsed.texturePaths,
      supportedBlocks: parsed.supportedBlocks,
      warnings: parsed.warnings
    },
    transfer
  };
};
