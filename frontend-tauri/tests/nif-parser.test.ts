import { describe, expect, it } from 'vitest';

import {
  createStaticNifFixture,
  parseNifModel
} from '../src/renderer/features/file-preview/nif-parser';
import {
  createSseDynamicTriShapeNifFixture,
  createSseEmptyEffectTriShapesNifFixture,
  createSseMismatchedDataSizeTriShapeNifFixture,
  createSseSkinnedTriShapeNifFixture,
  createSseTinyScaleTriShapeNifFixture
} from './fixtures/sse-dynamic-nif-fixture';

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.byteLength;
  });
  return output;
};

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

const u8 = (value: number): Uint8Array => Uint8Array.of(value);

const u16 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
};

const u32 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};

const i32 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
};

const f32 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return bytes;
};

const sizedString = (value: string): Uint8Array => {
  const bytes = bytesOf(value);
  return concatBytes(u32(bytes.byteLength), bytes);
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const createBinaryNifFixture = (
  blockType: string,
  block: Uint8Array,
  strings: string[],
  headerMetadata = concatBytes(sizedString('Fluxora'), sizedString(''), sizedString(''))
): ArrayBuffer => {
  const maxStringLength = strings.reduce((maxLength, value) => Math.max(maxLength, value.length), 0);
  return toArrayBuffer(
    concatBytes(
      bytesOf('Gamebryo File Format, Version 20.2.0.7\n'),
      u32(0x14020007),
      u8(1),
      u32(12),
      u32(1),
      u32(83),
      headerMetadata,
      u16(1),
      sizedString(blockType),
      u16(0),
      u32(block.byteLength),
      u32(strings.length),
      u32(maxStringLength),
      ...strings.map(sizedString),
      u32(0),
      block
    )
  );
};

const createBinaryNifFixtureWithBlocks = (
  blocks: Array<{ typeName: string; data: Uint8Array }>,
  strings: string[],
  headerMetadata = concatBytes(sizedString('Fluxora'), sizedString(''), sizedString(''))
): ArrayBuffer => {
  const blockTypes = Array.from(new Set(blocks.map((block) => block.typeName)));
  const maxStringLength = strings.reduce((maxLength, value) => Math.max(maxLength, value.length), 0);
  return toArrayBuffer(
    concatBytes(
      bytesOf('Gamebryo File Format, Version 20.2.0.7\n'),
      u32(0x14020007),
      u8(1),
      u32(12),
      u32(blocks.length),
      u32(83),
      headerMetadata,
      u16(blockTypes.length),
      ...blockTypes.map(sizedString),
      ...blocks.map((block) => u16(blockTypes.indexOf(block.typeName))),
      ...blocks.map((block) => u32(block.data.byteLength)),
      u32(strings.length),
      u32(maxStringLength),
      ...strings.map(sizedString),
      u32(0),
      ...blocks.map((block) => block.data)
    )
  );
};

const createBinaryNiTriShapeDataFixture = (sseMetadata = false): ArrayBuffer => {
  const positions = [
    0, 0, 0,
    1, 0, 0,
    0, 1, 0
  ];
  const uvs = [
    0, 0,
    1, 0,
    0, 1
  ];
  const block = concatBytes(
    ...(sseMetadata ? [i32(0)] : []),
    u16(3),
    u8(0),
    u8(0),
    u8(1),
    ...positions.map(f32),
    u16(1),
    ...(sseMetadata ? [u32(0x12345678)] : []),
    u8(0),
    f32(0.5),
    f32(0.5),
    f32(0),
    f32(1),
    u8(0),
    ...uvs.map(f32),
    u16(0),
    i32(-1),
    u16(1),
    u32(3),
    u8(1),
    u16(0),
    u16(1),
    u16(2)
  );

  return createBinaryNifFixture('NiTriShapeData', block, [
    'textures\\dungeons\\stoneplate_n.dds',
    'textures\\dungeons\\stoneplate.dds'
  ]);
};

const half = (value: 0 | 1): Uint8Array => u16(value === 0 ? 0x0000 : 0x3c00);

const optimizedHeaderMetadata = (): Uint8Array => {
  const message = bytesOf('Optimized with SSE NIF Optimizer v3.0.7.\0');
  return concatBytes(u16(1), u8(message.byteLength), message, u16(1));
};

const createBsTriShapeBlock = (): Uint8Array => {
  const vertex = (x: number, y: number, z: number, u: 0 | 1, v: 0 | 1): Uint8Array =>
    concatBytes(f32(x), f32(y), f32(z), f32(0), half(u), half(v));

  const vertexData = concatBytes(
    vertex(0, 0, 0, 0, 0),
    vertex(1, 0, 0, 1, 0),
    vertex(0, 1, 0, 0, 1)
  );
  return concatBytes(
    new Uint8Array(8),
    new Uint8Array(8),
    u16(1),
    u16(3),
    u32(vertexData.byteLength),
    vertexData,
    u16(0),
    u16(1),
    u16(2)
  );
};

const createBsTriShapeBlockWithShaderReference = (shaderBlockIndex: number): Uint8Array => {
  const block = createBsTriShapeBlock();
  new DataView(block.buffer, block.byteOffset, block.byteLength).setInt32(0, shaderBlockIndex, true);
  return block;
};

const createBsShaderTextureSetBlock = (...stringIndices: number[]): Uint8Array =>
  concatBytes(
    u32(stringIndices.length),
    ...stringIndices.map((index) => u32(index))
  );

const createBinaryBsTriShapeFixture = (headerMetadata?: Uint8Array): ArrayBuffer => {
  return createBinaryNifFixture('BSTriShape', createBsTriShapeBlock(), ['textures\\traps\\plate.dds'], headerMetadata);
};

const createBinaryBsTriShapeWithVertexDescriptorFixture = (): ArrayBuffer => {
  const vertex = (x: number, y: number, z: number, u: 0 | 1, v: 0 | 1): Uint8Array =>
    concatBytes(f32(x), f32(y), f32(z), f32(0), half(u), half(v));

  const vertexData = concatBytes(
    vertex(0, 0, 0, 0, 0),
    vertex(1, 0, 0, 1, 0),
    vertex(0, 1, 0, 0, 1)
  );
  const block = concatBytes(
    new Uint8Array(8),
    u16(1),
    u16(3),
    u32(vertexData.byteLength),
    new Uint8Array([0x17, 0, 0, 0, 0, 0, 0, 0]),
    vertexData,
    u16(0),
    u16(1),
    u16(2)
  );

  return createBinaryNifFixture('BSTriShape', block, ['textures\\effects\\FXButterflyGreen.dds']);
};

const createSkinPartitionBlock = (): Uint8Array => {
  const vertex = (x: number, y: number, z: number, u: 0 | 1, v: 0 | 1): Uint8Array =>
    concatBytes(
      f32(x),
      f32(y),
      f32(z),
      new Uint8Array(20),
      half(u),
      half(v),
      new Uint8Array(8)
    );

  const vertexData = concatBytes(
    vertex(0, 0, 0, 0, 0),
    vertex(1, 0, 0, 1, 0),
    vertex(0, 1, 0, 0, 1)
  );
  const partition = concatBytes(
    u16(3),
    u16(1),
    u16(1),
    u16(0),
    u16(1),
    u16(0),
    u8(1),
    u16(0),
    u16(1),
    u16(2),
    u8(1),
    f32(1),
    f32(1),
    f32(1),
    u8(1),
    u16(0),
    u16(1),
    u16(2),
    u8(1),
    u8(0),
    u8(0),
    u8(0)
  );

  return concatBytes(
    u32(1),
    u32(vertexData.byteLength),
    u32(44),
    u32(0x8765040b),
    u32(0x0007b000),
    vertexData,
    partition
  );
};

const createBinarySkinPartitionFixture = (): ArrayBuffer => {
  return createBinaryNifFixture('NiSkinPartition', createSkinPartitionBlock(), ['textures\\armor\\skinned.dds']);
};

describe('nif parser', () => {
  it('parses a small static textured mesh fixture', () => {
    const fixture = createStaticNifFixture({
      meshes: [
        {
          name: 'Preview triangle',
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
          uvs: [0, 0, 1, 0, 0, 1],
          texturePath: 'textures\\armor\\preview.dds'
        }
      ]
    });

    const model = parseNifModel(fixture);

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].name).toBe('Preview triangle');
    expect(model.meshes[0].indices).toEqual([0, 1, 2]);
    expect(model.texturePaths).toEqual(['textures/armor/preview.dds']);
    expect(model.supportedBlocks).toContain('NiTriShape');
    expect(model.warnings).not.toContain('preview.warning.noDiffuseTexture');
  });

  it('parses binary static NiTriShapeData geometry and prioritizes diffuse textures', () => {
    const model = parseNifModel(createBinaryNiTriShapeDataFixture());

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].name).toBe('NiTriShapeData 1');
    expect(model.meshes[0].positions).toEqual([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ]);
    expect(model.meshes[0].indices).toEqual([0, 1, 2]);
    expect(model.meshes[0].uvs).toEqual([0, 0, 1, 0, 0, 1]);
    expect(model.texturePaths.slice(0, 2)).toEqual([
      'textures/dungeons/stoneplate.dds',
      'textures/dungeons/stoneplate_n.dds'
    ]);
    expect(model.warnings).not.toContain(
      'Static geometry for the supported NIF subset was not found; rendering a neutral fallback shape.'
    );
  });

  it('parses Skyrim NiTriShapeData with group id and material CRC fields', () => {
    const model = parseNifModel(createBinaryNiTriShapeDataFixture(true));

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].positions).toEqual([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ]);
    expect(model.meshes[0].indices).toEqual([0, 1, 2]);
  });

  it('parses binary BSTriShape static geometry', () => {
    const model = parseNifModel(createBinaryBsTriShapeFixture());

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].name).toBe('BSTriShape 1');
    expect(model.meshes[0].positions).toEqual([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ]);
    expect(model.meshes[0].indices).toEqual([0, 1, 2]);
    expect(model.meshes[0].uvs).toEqual([0, 0, 1, 0, 0, 1]);
    expect(model.texturePaths).toContain('textures/traps/plate.dds');
    expect(model.warnings).not.toContain(
      'Static geometry for the supported NIF subset was not found; rendering a neutral fallback shape.'
    );
  });

  it('preserves valid BSTriShape triangles at very small model scales', () => {
    const fixture = createSseTinyScaleTriShapeNifFixture();

    const model = parseNifModel(fixture);

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].indices).toEqual([0, 1, 2]);
    expect(model.meshes[0].positions).toEqual([
      0, 0, expect.closeTo(-50.824932),
      expect.closeTo(0.0001), 0, expect.closeTo(-50.824932),
      0, expect.closeTo(0.0001), expect.closeTo(-50.824932)
    ]);
  });

  it('recovers SSE BSTriShape data when the stored payload size is corrupt', () => {
    const model = parseNifModel(createSseMismatchedDataSizeTriShapeNifFixture());

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].positions).toEqual([
      -1, -1, 0,
      1, -1, 0,
      1, 1, 0,
      -1, 1, 0
    ]);
    expect(model.meshes[0].indices).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('opens a valid SSE effect container whose shape blocks are intentionally empty', () => {
    const model = parseNifModel(createSseEmptyEffectTriShapesNifFixture());

    expect(model.meshes).toEqual([]);
    expect(model.warnings).toContain(
      'preview.warning.noGeometry'
    );
  });

  it('associates BSTriShape meshes with their referenced shader texture set', () => {
    const correctDiffuse = 'textures\\architecture\\farmhouse\\farmhousewindmill\\farmhousewindmill01.dds';
    const model = parseNifModel(createBinaryNifFixtureWithBlocks(
      [
        {
          typeName: 'BSTriShape',
          data: createBsTriShapeBlockWithShaderReference(1)
        },
        {
          typeName: 'BSLightingShaderProperty',
          data: concatBytes(i32(2), new Uint8Array(24))
        },
        {
          typeName: 'BSShaderTextureSet',
          data: createBsShaderTextureSetBlock(1, 2)
        }
      ],
      [
        'textures\\architecture\\solitude\\swindow01.dds',
        correctDiffuse,
        'textures\\architecture\\farmhouse\\farmhousewindmill\\farmhousewindmill01_n.dds'
      ]
    ));

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].texturePath).toBe(
      'textures/architecture/farmhouse/farmhousewindmill/farmhousewindmill01.dds'
    );
    expect(model.texturePaths[0]).toBe(
      'textures/architecture/farmhouse/farmhousewindmill/farmhousewindmill01.dds'
    );
  });

  it('parses binary BSTriShape geometry when a vertex descriptor precedes vertex data', () => {
    const model = parseNifModel(createBinaryBsTriShapeWithVertexDescriptorFixture());

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].positions).toEqual([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ]);
    expect(model.meshes[0].indices).toEqual([0, 1, 2]);
    expect(model.texturePaths).toContain('textures/effects/FXButterflyGreen.dds');
    expect(model.warnings).not.toContain(
      'Static geometry for the supported NIF subset was not found; rendering a neutral fallback shape.'
    );
  });

  it('parses binary BSTriShape geometry after an SSE optimizer export header', () => {
    const model = parseNifModel(createBinaryBsTriShapeFixture(optimizedHeaderMetadata()));

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].name).toBe('BSTriShape 1');
    expect(model.meshes[0].indices).toEqual([0, 1, 2]);
    expect(model.texturePaths).toContain('textures/traps/plate.dds');
    expect(model.warnings).not.toContain(
      'Static geometry for the supported NIF subset was not found; rendering a neutral fallback shape.'
    );
  });

  it('recovers static BSTriShape geometry when block metadata cannot be trusted', () => {
    const bytes = concatBytes(
      bytesOf(
        'Gamebryo File Format, Version 20.2.0.7\n' +
          'NiNode BSTriShape BSLightingShaderProperty textures\\johnskyrim\\common\\septim\\septim_d.dds\0'
      ),
      new Uint8Array(64),
      createBsTriShapeBlock()
    );

    const model = parseNifModel(toArrayBuffer(bytes));

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].name).toBe('BSTriShape static geometry');
    expect(model.meshes[0].indices).toEqual([0, 1, 2]);
    expect(model.texturePaths).toContain('textures/johnskyrim/common/septim/septim_d.dds');
    expect(model.warnings).not.toContain(
      'Static geometry for the supported NIF subset was not found; rendering a neutral fallback shape.'
    );
  });

  it('parses skinned NiSkinPartition geometry as a static bind-pose mesh', () => {
    const model = parseNifModel(createBinarySkinPartitionFixture());

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].name).toBe('NiSkinPartition 1');
    expect(model.meshes[0].positions).toEqual([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ]);
    expect(model.meshes[0].indices).toEqual([0, 1, 2]);
    expect(model.meshes[0].uvs).toEqual([0, 0, 1, 0, 0, 1]);
    expect(model.warnings).toContain(
      'preview.warning.skinnedStatic'
    );
    expect(model.warnings).not.toContain(
      'Static geometry for the supported NIF subset was not found; rendering a neutral fallback shape.'
    );
  });

  it('parses BSDynamicTriShape positions with SSE NiSkinPartition topology', () => {
    const model = parseNifModel(createSseDynamicTriShapeNifFixture());

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].name).toBe('BSDynamicTriShape 2');
    expect(model.meshes[0].positions).toEqual([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ]);
    expect(model.meshes[0].indices).toEqual([0, 1, 2]);
    expect(model.meshes[0].uvs).toEqual([0, 0, 1, 0, 0, 1]);
    expect(model.meshes[0].texturePath).toBe('textures/actors/character/facegendetail.dds');
    expect(model.supportedBlocks).toContain('BSDynamicTriShape');
  });

  it('parses a regular SSE skinned shape from its NiSkinPartition bind pose', () => {
    const model = parseNifModel(createSseSkinnedTriShapeNifFixture());

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].name).toBe('NiSkinPartition 4');
    expect(model.meshes[0].positions).toEqual([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ]);
    expect(model.meshes[0].indices).toEqual([0, 1, 2]);
    expect(model.meshes[0].uvs).toEqual([0, 0, 1, 0, 0, 1]);
    expect(model.meshes[0].texturePath).toBe('textures/actors/character/body.dds');
  });

  it('accepts empty SSE skin partitions around a populated partition', () => {
    const model = parseNifModel(createSseSkinnedTriShapeNifFixture({
      before: 1,
      after: 1
    }));

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].name).toBe('NiSkinPartition 4');
    expect(model.meshes[0].indices).toEqual([0, 1, 2]);
  });

  it('associates skinned NiSkinPartition meshes through their skin instance owner', () => {
    const correctDiffuse = 'textures\\clutter\\containers\\miscpouch.dds';
    const model = parseNifModel(createBinaryNifFixtureWithBlocks(
      [
        {
          typeName: 'NiTriShape',
          data: concatBytes(i32(1), i32(3), new Uint8Array(24))
        },
        {
          typeName: 'BSLightingShaderProperty',
          data: concatBytes(i32(2), new Uint8Array(24))
        },
        {
          typeName: 'BSShaderTextureSet',
          data: createBsShaderTextureSetBlock(1, 2, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff)
        },
        {
          typeName: 'BSDismemberSkinInstance',
          data: concatBytes(new Uint8Array(8), i32(4), new Uint8Array(16))
        },
        {
          typeName: 'NiSkinPartition',
          data: createSkinPartitionBlock()
        }
      ],
      [
        'textures\\clutter\\containers\\unrelated.dds',
        correctDiffuse,
        'textures\\clutter\\containers\\miscpouch_n.dds',
        'unused-3',
        'unused-4',
        'unused-5',
        'unused-6',
        'unused-7',
        'unused-8',
        'textures\\clutter\\containers\\wrong-count-slot.dds'
      ]
    ));

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].name).toBe('NiSkinPartition 5');
    expect(model.meshes[0].texturePath).toBe('textures/clutter/containers/miscpouch.dds');
    expect(model.texturePaths[0]).toBe('textures/clutter/containers/miscpouch.dds');
  });

  it('keeps geometry and reports fallback material when no texture is present', () => {
    const fixture = createStaticNifFixture({
      meshes: [
        {
          name: 'Untextured triangle',
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2]
        }
      ]
    });

    const model = parseNifModel(fixture);

    expect(model.meshes).toHaveLength(1);
    expect(model.texturePaths).toEqual([]);
    expect(model.warnings).toContain('preview.warning.noDiffuseTexture');
  });

  it('rejects unsupported geometry instead of returning a placeholder mesh', () => {
    const bytes = new TextEncoder().encode(
      'Gamebryo File Format, Version 20.2.0.7\nNiNode NiSkinInstance BSDismemberSkinInstance'
    ).buffer;

    expect(() => parseNifModel(bytes)).toThrow(
      'NIF geometry could not be decoded. This model uses an unsupported geometry layout.'
    );
  });
});
