import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  createNifPreviewGeometry,
  selectNifPreviewTexturePath,
  transformNifVectorArrayForPreview
} from '../src/renderer/features/file-preview/nif-preview-rendering';
import type { ParsedNifMesh, ParsedNifModel } from '../src/renderer/features/file-preview/nif-parser';

const baseModel = (texturePaths: string[]): ParsedNifModel => ({
  meshes: [],
  texturePaths,
  supportedBlocks: [],
  warnings: []
});

describe('nif preview rendering helpers', () => {
  it('converts NIF Z-up vectors into the Three.js Y-up preview space', () => {
    expect(transformNifVectorArrayForPreview([
      0, 0, 0,
      0, 0, 2,
      0, 1, 0
    ])).toEqual([
      0, 0, 0,
      0, 2, 0,
      0, 0, -1
    ]);
  });

  it('creates geometry with transformed positions and normals while preserving tiled UVs', () => {
    const mesh: ParsedNifMesh = {
      name: 'Door',
      positions: [
        0, 0, 0,
        0, 0, 2,
        0, 1, 0
      ],
      normals: [
        0, 0, 1,
        0, 0, 1,
        0, 1, 0
      ],
      indices: [0, 1, 2],
      uvs: [
        0, 0,
        2, 0,
        -1, 3
      ]
    };

    const geometry = createNifPreviewGeometry(mesh);
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const uvs = geometry.getAttribute('uv') as THREE.BufferAttribute;

    expect(Array.from(positions.array)).toEqual([
      0, 0, 0,
      0, 2, 0,
      0, 0, -1
    ]);
    expect(Array.from(normals.array)).toEqual([
      0, 1, 0,
      0, 1, 0,
      0, 0, -1
    ]);
    expect(Array.from(uvs.array)).toEqual([
      0, 0,
      2, 0,
      -1, 3
    ]);

    geometry.dispose();
  });

  it('uses explicit mesh texture paths before model-level fallbacks', () => {
    const mesh: ParsedNifMesh = {
      name: 'Blade',
      positions: [],
      texturePath: 'textures/smim/windmill/blade.dds'
    };

    expect(selectNifPreviewTexturePath(
      mesh,
      baseModel(['textures/architecture/solitude/swindow01.dds']),
      'meshes/architecture/farmhouse/farmhousewindmill/farmhousewindmillfan.nif'
    )).toBe('textures/smim/windmill/blade.dds');
  });

  it('prefers model-related diffuse textures over unrelated global texture strings', () => {
    const mesh: ParsedNifMesh = {
      name: 'Windmill fan',
      positions: []
    };

    expect(selectNifPreviewTexturePath(
      mesh,
      baseModel([
        'textures/architecture/solitude/swindow01.dds',
        'textures/architecture/farmhouse/farmhousewindmill/farmhousewindmill01_n.dds',
        'textures/architecture/farmhouse/farmhousewindmill/farmhousewindmill01.dds'
      ]),
      'meshes/architecture/farmhouse/farmhousewindmill/farmhousewindmillfan.nif'
    )).toBe('textures/architecture/farmhouse/farmhousewindmill/farmhousewindmill01.dds');
  });
});
