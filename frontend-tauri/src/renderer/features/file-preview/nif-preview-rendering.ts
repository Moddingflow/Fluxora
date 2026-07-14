import * as THREE from 'three';

import type { ParsedNifMesh, ParsedNifModel } from './nif-parser';
import type { WorkerNifMesh, WorkerNifModel } from './nif-preview-worker-protocol';

const genericPathTokens = new Set([
  'architecture',
  'clutter',
  'common',
  'data',
  'effects',
  'meshes',
  'textures'
]);

const textureRolePenalty = (path: string): number => {
  const fileName = path.split('/').pop()?.toLowerCase() ?? path.toLowerCase();
  return /(?:_n|_msn|_s|_sk|_g|_glow|_e|_em|_m|_p)\.(?:dds|png|jpe?g)$/.test(fileName) ? 20 : 0;
};

const comparableName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '');

const pathTokens = (value: string): Set<string> =>
  new Set(
    value
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !genericPathTokens.has(token))
  );

const commonPrefixLength = (left: string, right: string): number => {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (index < length && left[index] === right[index]) {
    index += 1;
  }
  return index;
};

const cleanZero = (value: number): number => Object.is(value, -0) ? 0 : value;

export interface NifPreviewCameraFrame {
  target: THREE.Vector3;
  position: THREE.Vector3;
  near: number;
  far: number;
}

export const computeNifPreviewCameraFrame = (bounds: THREE.Box3): NifPreviewCameraFrame => {
  const size = new THREE.Vector3();
  const target = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(target);
  const span = Math.max(size.x, size.y, size.z, 1e-6);
  const near = Math.max(span / 100, 1e-8);

  return {
    target,
    position: new THREE.Vector3(
      target.x + span * 1.25,
      target.y + span * 0.85,
      target.z + span * 1.75
    ),
    near,
    far: Math.max(span * 100, near * 1_000)
  };
};

const scoreTexturePathForModel = (texturePath: string, modelRelativePath: string): number => {
  const textureName = comparableName(texturePath.split('/').pop() ?? texturePath);
  const modelName = comparableName(modelRelativePath.split(/[\\/]/).pop() ?? modelRelativePath);
  const textureComparable = comparableName(texturePath);
  const modelComparable = comparableName(modelRelativePath);
  const modelTokens = pathTokens(modelRelativePath);
  const textureTokens = pathTokens(texturePath);

  let score = 0;
  const prefix = commonPrefixLength(modelName, textureName);
  if (prefix >= 4) {
    score += prefix * 2;
  }
  if (textureComparable.includes(modelName) || modelComparable.includes(textureName)) {
    score += 36;
  }
  modelTokens.forEach((token) => {
    if (textureTokens.has(token)) {
      score += 8;
    }
  });
  return score - textureRolePenalty(texturePath);
};

export const transformNifVectorForPreview = (x: number, y: number, z: number): [number, number, number] => [
  cleanZero(x),
  cleanZero(z),
  cleanZero(-y)
];

export const transformNifVectorArrayForPreview = (values: ArrayLike<number>): number[] => {
  const transformed: number[] = [];
  for (let index = 0; index + 2 < values.length; index += 3) {
    transformed.push(...transformNifVectorForPreview(values[index], values[index + 1], values[index + 2]));
  }
  return transformed;
};

export const createNifPreviewGeometry = (
  mesh: ParsedNifMesh | WorkerNifMesh
): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  const isWorkerMesh = 'previewCoordinates' in mesh && mesh.previewCoordinates;
  geometry.setAttribute('position', isWorkerMesh
    ? new THREE.BufferAttribute(mesh.positions, 3)
    : new THREE.Float32BufferAttribute(transformNifVectorArrayForPreview(mesh.positions), 3));
  if (mesh.indices?.length) {
    geometry.setIndex(mesh.indices instanceof Uint32Array
      ? new THREE.BufferAttribute(mesh.indices, 1)
      : mesh.indices);
  }
  if (mesh.normals?.length === mesh.positions.length) {
    geometry.setAttribute('normal', isWorkerMesh
      ? new THREE.BufferAttribute(mesh.normals as Float32Array, 3)
      : new THREE.Float32BufferAttribute(transformNifVectorArrayForPreview(mesh.normals), 3));
  } else {
    geometry.computeVertexNormals();
  }
  if (mesh.uvs?.length) {
    geometry.setAttribute('uv', mesh.uvs instanceof Float32Array
      ? new THREE.BufferAttribute(mesh.uvs, 2)
      : new THREE.Float32BufferAttribute(mesh.uvs, 2));
  }
  if (isWorkerMesh) {
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(...mesh.bounds.min),
      new THREE.Vector3(...mesh.bounds.max)
    );
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(...mesh.bounds.center),
      mesh.bounds.radius
    );
  } else {
    geometry.computeBoundingSphere();
  }
  return geometry;
};

export const selectNifPreviewTexturePath = (
  mesh: ParsedNifMesh | WorkerNifMesh,
  model: ParsedNifModel | WorkerNifModel,
  modelRelativePath: string
): string | undefined => {
  if (mesh.texturePath) {
    return mesh.texturePath;
  }

  if (model.texturePaths.length === 1) {
    return model.texturePaths[0];
  }

  const ranked = model.texturePaths
    .map((path, index) => ({
      path,
      index,
      score: scoreTexturePathForModel(path, modelRelativePath)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const best = ranked[0];
  if (!best || best.score <= 0) {
    return undefined;
  }

  const second = ranked[1];
  return !second || best.score >= second.score + 4 ? best.path : undefined;
};
