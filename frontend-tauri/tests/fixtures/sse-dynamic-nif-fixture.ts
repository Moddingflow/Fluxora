type NifFixtureBlock = {
  typeName: string;
  data: Uint8Array;
};

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.byteLength;
  });
  return output;
};

const bytesOf = (value: string): Uint8Array => new TextEncoder().encode(value);
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

const half = (value: 0 | 1): Uint8Array => u16(value === 0 ? 0 : 0x3c00);
const sizedString = (value: string): Uint8Array => {
  const bytes = bytesOf(value);
  return concatBytes(u32(bytes.byteLength), bytes);
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const createNif = (blocks: NifFixtureBlock[], strings: string[]): ArrayBuffer => {
  const blockTypes = Array.from(new Set(blocks.map((block) => block.typeName)));
  const maxStringLength = strings.reduce((maximum, value) => Math.max(maximum, value.length), 0);
  return toArrayBuffer(concatBytes(
    bytesOf('Gamebryo File Format, Version 20.2.0.7\n'),
    u32(0x14020007),
    u8(1),
    u32(12),
    u32(blocks.length),
    u32(100),
    sizedString('Fluxora'),
    sizedString(''),
    sizedString(''),
    u16(blockTypes.length),
    ...blockTypes.map(sizedString),
    ...blocks.map((block) => u16(blockTypes.indexOf(block.typeName))),
    ...blocks.map((block) => u32(block.data.byteLength)),
    u32(strings.length),
    u32(maxStringLength),
    ...strings.map(sizedString),
    u32(0),
    ...blocks.map((block) => block.data)
  ));
};

/**
 * Schema-faithful SSE BSTriShape with a valid triangle whose edges are 1e-4.
 * This mirrors the scale/layout that previously tripped the parser's absolute
 * area threshold while keeping the fixture synthetic and license-independent.
 */
export const createSseTinyScaleTriShapeNifFixture = (): ArrayBuffer => {
  const descriptor = concatBytes(u32(0x07650408), u32(0x0003b000));
  const vertex = (x: number, y: number, u: 0 | 1, v: 0 | 1): Uint8Array => concatBytes(
    f32(x), f32(y), f32(-50.824932), f32(0),
    half(u), half(v),
    Uint8Array.of(127, 127, 255, 0),
    Uint8Array.of(127, 0, 0, 0),
    Uint8Array.of(255, 255, 255, 255)
  );
  const vertexData = concatBytes(
    vertex(0, 0, 0, 0),
    vertex(0.0001, 0, 1, 0),
    vertex(0, 0.0001, 0, 1)
  );
  const shape = concatBytes(
    i32(0),
    u32(0),
    i32(-1),
    u32(0x0008000e),
    f32(0), f32(0), f32(0),
    f32(1), f32(0), f32(0),
    f32(0), f32(1), f32(0),
    f32(0), f32(0), f32(1),
    f32(1),
    i32(-1),
    f32(0), f32(0), f32(-50.824932), f32(1),
    i32(-1), i32(-1), i32(-1),
    descriptor,
    u16(1), u16(3), u32(vertexData.byteLength + 6),
    vertexData,
    u16(0), u16(1), u16(2),
    u32(0)
  );

  return createNif(
    [{ typeName: 'BSTriShape', data: shape }],
    ['Tiny inventory mesh', 'textures\\furniture\\small-cooking-pot.dds']
  );
};

/**
 * SSE BSTriShape whose stored Data Size is corrupt while its descriptor,
 * vertex/triangle counts and block boundary still describe the payload.
 * Some optimized water meshes in the real corpus use this layout.
 */
export const createSseMismatchedDataSizeTriShapeNifFixture = (): ArrayBuffer => {
  const descriptor = concatBytes(u32(0x00650407), u32(0x0001b000));
  const vertex = (x: number, y: number, u: 0 | 1, v: 0 | 1): Uint8Array => concatBytes(
    f32(x), f32(y), f32(0), f32(1),
    half(u), half(v),
    Uint8Array.of(127, 127, 255, 127),
    Uint8Array.of(127, 0, 127, 127)
  );
  const vertexData = concatBytes(
    vertex(-1, -1, 0, 0),
    vertex(1, -1, 1, 0),
    vertex(1, 1, 1, 1),
    vertex(-1, 1, 0, 1)
  );
  const shape = concatBytes(
    i32(0),
    u32(0),
    i32(-1),
    u32(0x0008000e),
    f32(0), f32(0), f32(0),
    f32(1), f32(0), f32(0),
    f32(0), f32(1), f32(0),
    f32(0), f32(0), f32(1),
    f32(1),
    i32(-1),
    f32(0), f32(0), f32(0), f32(1),
    i32(-1), i32(-1), i32(-1),
    descriptor,
    u16(2), u16(4), u32(0x0000a71c),
    vertexData,
    u16(0), u16(1), u16(2),
    u16(0), u16(2), u16(3),
    u32(0)
  );

  return createNif(
    [{ typeName: 'BSTriShape', data: shape }],
    ['Optimized water mesh']
  );
};

/** Valid effect container whose shape blocks intentionally declare no mesh data. */
export const createSseEmptyEffectTriShapesNifFixture = (): ArrayBuffer => {
  const descriptor = concatBytes(u32(1), u32(0x00008000));
  const emptyShape = (nameIndex: number): Uint8Array => concatBytes(
    i32(nameIndex),
    u32(0),
    i32(-1),
    u32(0x0008000e),
    f32(0), f32(0), f32(0),
    f32(1), f32(0), f32(0),
    f32(0), f32(1), f32(0),
    f32(0), f32(0), f32(1),
    f32(1),
    i32(-1),
    f32(0), f32(0), f32(0), f32(1),
    i32(-1), i32(-1), i32(-1),
    descriptor,
    u16(0), u16(0), u32(0),
    u32(0)
  );

  return createNif(
    [
      { typeName: 'BSTriShape', data: emptyShape(0) },
      { typeName: 'BSTriShape', data: emptyShape(1) },
      { typeName: 'BSTriShape', data: emptyShape(2) }
    ],
    ['Lightning Arc A', 'Lightning Arc B', 'Lightning Arc C']
  );
};

const createSkinPartition = (
  vertexDescriptor: Uint8Array,
  vertexData: Uint8Array,
  vertexSize: number,
  emptyPartitions: { before?: number; after?: number } = {}
): Uint8Array => {
  const emptyPartition = concatBytes(
    u16(0), u16(0), u16(0), u16(0), u16(4),
    u8(1),
    u8(1),
    u8(1),
    u8(1),
    u8(0), u8(0),
    vertexDescriptor
  );
  const partition = concatBytes(
    u16(3), u16(1), u16(1), u16(0), u16(4),
    u16(0),
    u8(1), u16(2), u16(0), u16(1),
    u8(1),
    f32(1), f32(0), f32(0), f32(0),
    f32(1), f32(0), f32(0), f32(0),
    f32(1), f32(0), f32(0), f32(0),
    u8(1), u16(0), u16(1), u16(2),
    u8(1), new Uint8Array(12),
    u8(0), u8(0),
    vertexDescriptor,
    u16(0), u16(1), u16(2)
  );
  const emptyBefore = Array.from(
    { length: emptyPartitions.before ?? 0 },
    () => emptyPartition
  );
  const emptyAfter = Array.from(
    { length: emptyPartitions.after ?? 0 },
    () => emptyPartition
  );
  return concatBytes(
    u32(1 + emptyBefore.length + emptyAfter.length),
    u32(vertexData.byteLength),
    u32(vertexSize),
    vertexDescriptor,
    vertexData,
    ...emptyBefore,
    partition,
    ...emptyAfter
  );
};

/**
 * Minimal Skyrim SE BSDynamicTriShape. Positions are Vector4 values on the
 * shape while UVs/normals and topology are supplied by NiSkinPartition.
 * Its non-identity skinning vertex map guards against remapping SSE's global
 * triangle-copy indices.
 */
export const createSseDynamicTriShapeNifFixture = (): ArrayBuffer => {
  const vertexDescriptor = concatBytes(u32(0x30210046), u32(0x0045a000));
  const vertex = (u: 0 | 1, v: 0 | 1): Uint8Array => concatBytes(
    half(u),
    half(v),
    Uint8Array.of(127, 127, 255, 0),
    new Uint8Array(4),
    half(1), half(0), half(0), half(0),
    new Uint8Array(4)
  );
  const vertexData = concatBytes(vertex(0, 0), vertex(1, 0), vertex(0, 1));
  const skinPartition = createSkinPartition(vertexDescriptor, vertexData, 24);
  const dynamicPositions = concatBytes(
    f32(0), f32(0), f32(0), f32(0),
    f32(1), f32(0), f32(0), f32(0),
    f32(0), f32(1), f32(0), f32(0)
  );
  const dynamicShape = concatBytes(
    i32(-1),
    u32(0),
    i32(-1),
    u32(14),
    f32(0), f32(0), f32(0),
    f32(1), f32(0), f32(0),
    f32(0), f32(1), f32(0),
    f32(0), f32(0), f32(1),
    f32(1),
    i32(-1),
    f32(0), f32(0), f32(0), f32(1),
    i32(2), i32(4), i32(-1),
    vertexDescriptor,
    u16(0), u16(3), u32(0),
    u32(0),
    u32(dynamicPositions.byteLength),
    dynamicPositions
  );

  return createNif(
    [
      { typeName: 'NiNode', data: new Uint8Array(0) },
      { typeName: 'BSDynamicTriShape', data: dynamicShape },
      { typeName: 'NiSkinInstance', data: concatBytes(i32(-1), i32(3), i32(0), u32(0)) },
      { typeName: 'NiSkinPartition', data: skinPartition },
      { typeName: 'BSLightingShaderProperty', data: i32(5) },
      { typeName: 'BSShaderTextureSet', data: concatBytes(u32(1), u32(0)) }
    ],
    ['textures\\actors\\character\\facegendetail.dds']
  );
};

/** Regular SSE skinned shape whose complete bind-pose geometry lives in NiSkinPartition. */
export const createSseSkinnedTriShapeNifFixture = (
  emptyPartitions: { before?: number; after?: number } = {}
): ArrayBuffer => {
  const vertexDescriptor = concatBytes(u32(9), u32(0x0004b000));
  const vertex = (x: number, y: number, u: 0 | 1, v: 0 | 1): Uint8Array => concatBytes(
    f32(x), f32(y), f32(0), f32(1),
    half(u), half(v),
    Uint8Array.of(127, 127, 255, 0),
    new Uint8Array(12)
  );
  const skinPartition = createSkinPartition(
    vertexDescriptor,
    concatBytes(vertex(0, 0, 0, 0), vertex(1, 0, 1, 0), vertex(0, 1, 0, 1)),
    36,
    emptyPartitions
  );
  const shape = concatBytes(
    i32(-1),
    u32(0),
    i32(-1),
    u32(14),
    f32(0), f32(0), f32(0),
    f32(1), f32(0), f32(0),
    f32(0), f32(1), f32(0),
    f32(0), f32(0), f32(1),
    f32(1),
    i32(-1),
    f32(0), f32(0), f32(0), f32(1),
    i32(2), i32(4), i32(-1),
    vertexDescriptor,
    u16(0), u16(3), u32(0),
    u32(0)
  );

  return createNif(
    [
      { typeName: 'NiNode', data: new Uint8Array(0) },
      { typeName: 'BSTriShape', data: shape },
      { typeName: 'NiSkinInstance', data: concatBytes(i32(-1), i32(3), i32(0), u32(0)) },
      { typeName: 'NiSkinPartition', data: skinPartition },
      { typeName: 'BSLightingShaderProperty', data: i32(5) },
      { typeName: 'BSShaderTextureSet', data: concatBytes(u32(1), u32(0)) }
    ],
    ['textures\\actors\\character\\body.dds']
  );
};
