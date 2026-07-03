export interface ParsedNifMesh {
  name: string;
  positions: number[];
  indices?: number[];
  normals?: number[];
  uvs?: number[];
  texturePath?: string;
  alpha?: number;
}

export interface ParsedNifModel {
  meshes: ParsedNifMesh[];
  texturePaths: string[];
  supportedBlocks: string[];
  warnings: string[];
}

export interface StaticNifFixtureMesh {
  name?: string;
  positions: number[];
  indices?: number[];
  normals?: number[];
  uvs?: number[];
  texturePath?: string;
  alpha?: number;
}

export interface StaticNifFixture {
  blocks?: string[];
  meshes: StaticNifFixtureMesh[];
}

const staticFixtureMarker = 'FLUXORA_STATIC_MESH_JSON:';
const nifHeaderPattern = /^(?:Gamebryo|NetImmerse) File Format/i;
const maxStaticPreviewVertices = 200_000;
const maxStaticPreviewTriangles = 400_000;

const supportedNifBlocks = [
  'NiNode',
  'BSFadeNode',
  'NiTriShape',
  'BSSegmentedTriShape',
  'BSMeshLODTriShape',
  'BSSubIndexTriShape',
  'BSTriShape',
  'NiTriShapeData',
  'NiSkinPartition',
  'BSLightingShaderProperty',
  'BSEffectShaderProperty',
  'BSShaderTextureSet',
  'NiTexturingProperty',
  'NiSourceTexture',
  'NiAlphaProperty'
] as const;

const skinnedBlockNames = [
  'NiSkinInstance',
  'BSDismemberSkinInstance',
  'NiSkinPartition',
  'BSSkin::Instance'
] as const;

interface NifBlockSlice {
  typeName: string;
  data: Uint8Array;
  index: number;
}

interface NifDocument {
  blocks: NifBlockSlice[];
  stringTable: string[];
}

interface NifBlockTypeTable {
  blockTypes: string[];
  nextOffset: number;
}

const normalizeTexturePath = (path: string): string => {
  const normalized = path
    .trim()
    .replace(/[\u0000-\u001f]+/g, '')
    .replace(/[\\/]+/g, '/')
    .replace(/^data\//i, '');
  const textureRoot = normalized.toLowerCase().lastIndexOf('textures/');
  return textureRoot >= 0 ? normalized.slice(textureRoot) : normalized.replace(/^textures\//i, 'textures/');
};

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item));

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const isTexturePath = (value: string): boolean =>
  /\.(?:dds|png|jpe?g)$/i.test(value);

const diffuseTextureWeight = (path: string): number => {
  const fileName = path.split('/').pop()?.toLowerCase() ?? path.toLowerCase();
  return /(?:_n|_msn|_s|_sk|_g|_glow|_e|_em|_m|_p)\.(?:dds|png|jpe?g)$/.test(fileName) ? 1 : 0;
};

const prioritizeDiffuseTexturePaths = (paths: string[]): string[] =>
  uniqueStrings(paths)
    .map((path, index) => ({ path, index, weight: diffuseTextureWeight(path) }))
    .sort((left, right) => left.weight - right.weight || left.index - right.index)
    .map((item) => item.path);

const finiteArray = (values: number[]): boolean =>
  values.every((value) => Number.isFinite(value) && Math.abs(value) < 10_000_000);

const validVertexCount = (value: number): boolean =>
  Number.isInteger(value) && value >= 3 && value <= maxStaticPreviewVertices;

const validTriangleCount = (value: number): boolean =>
  Number.isInteger(value) && value >= 1 && value <= maxStaticPreviewTriangles;

const validIndices = (indices: number[], vertexCount: number): boolean =>
  indices.length >= 3 &&
  indices.length % 3 === 0 &&
  indices.every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount);

const hasNonDegenerateTriangle = (positions: number[], indices: number[]): boolean => {
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset] * 3;
    const b = indices[offset + 1] * 3;
    const c = indices[offset + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    if (crossX * crossX + crossY * crossY + crossZ * crossZ > 1e-12) {
      return true;
    }
  }
  return false;
};

const fallbackMesh = (): ParsedNifMesh => ({
  name: 'Unsupported static preview fallback',
  positions: [
    -0.6, -0.45, 0.35,
    0.6, -0.45, 0.35,
    0.6, 0.45, 0.35,
    -0.6, 0.45, 0.35,
    -0.42, -0.3, -0.35,
    0.42, -0.3, -0.35,
    0.42, 0.3, -0.35,
    -0.42, 0.3, -0.35
  ],
  indices: [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0
  ],
  uvs: [
    0, 0,
    1, 0,
    1, 1,
    0, 1,
    0, 0,
    1, 0,
    1, 1,
    0, 1
  ]
});

const scanSupportedBlocks = (text: string): string[] =>
  supportedNifBlocks.filter((block) => text.includes(block));

const scanTexturePaths = (text: string): string[] => {
  const matches = text.match(/[A-Za-z0-9_./\\ -]+?\.(?:dds|png|jpe?g)/gi) ?? [];
  return prioritizeDiffuseTexturePaths(matches.map(normalizeTexturePath));
};

const scanWarnings = (text: string, supportedBlocks: string[]): string[] => {
  const warnings: string[] = [];
  if (skinnedBlockNames.some((block) => text.includes(block))) {
    warnings.push('Skinned NIF blocks are rendered as static bind-pose geometry; animation is not previewed.');
  }

  if (!supportedBlocks.length) {
    warnings.push('No supported static NIF blocks were detected.');
  }

  return warnings;
};

const validateFixtureMesh = (mesh: StaticNifFixtureMesh, index: number): ParsedNifMesh => {
  if (!isNumberArray(mesh.positions) || mesh.positions.length < 9 || mesh.positions.length % 3 !== 0) {
    throw new Error(`Fixture mesh ${index + 1} has invalid vertex positions.`);
  }

  const parsed: ParsedNifMesh = {
    name: mesh.name?.trim() || `Mesh ${index + 1}`,
    positions: mesh.positions
  };

  if (isNumberArray(mesh.indices) && mesh.indices.length >= 3) {
    parsed.indices = mesh.indices;
  }

  if (isNumberArray(mesh.normals) && mesh.normals.length === mesh.positions.length) {
    parsed.normals = mesh.normals;
  }

  if (isNumberArray(mesh.uvs) && mesh.uvs.length === (mesh.positions.length / 3) * 2) {
    parsed.uvs = mesh.uvs;
  }

  if (typeof mesh.texturePath === 'string' && mesh.texturePath.trim()) {
    parsed.texturePath = normalizeTexturePath(mesh.texturePath);
  }

  if (typeof mesh.alpha === 'number' && Number.isFinite(mesh.alpha)) {
    parsed.alpha = Math.max(0, Math.min(1, mesh.alpha));
  }

  return parsed;
};

const parseStaticFixture = (text: string): ParsedNifMesh[] | null => {
  const markerIndex = text.indexOf(staticFixtureMarker);
  if (markerIndex < 0) {
    return null;
  }

  const payload = text.slice(markerIndex + staticFixtureMarker.length).trim();
  const fixture = JSON.parse(payload) as StaticNifFixture;
  if (!Array.isArray(fixture.meshes) || fixture.meshes.length === 0) {
    throw new Error('Static NIF fixture did not include any meshes.');
  }

  return fixture.meshes.map(validateFixtureMesh);
};

class BinaryReader {
  private readonly view: DataView;

  constructor(
    private readonly bytes: Uint8Array,
    private offset = 0
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  skip(length: number): void {
    if (length < 0 || this.remaining < length) {
      throw new Error('NIF header is truncated.');
    }
    this.offset += length;
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.bytes.byteLength) {
      throw new Error('NIF header is truncated.');
    }
    this.offset = offset;
  }

  readUint8(): number {
    if (this.remaining < 1) {
      throw new Error('NIF header is truncated.');
    }
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint16(): number {
    if (this.remaining < 2) {
      throw new Error('NIF header is truncated.');
    }
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUint32(): number {
    if (this.remaining < 4) {
      throw new Error('NIF header is truncated.');
    }
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readSizedString(): string {
    const length = this.readUint32();
    if (length > this.remaining) {
      throw new Error('NIF string table is truncated.');
    }
    const value = new TextDecoder('utf-8', { fatal: false })
      .decode(this.bytes.slice(this.offset, this.offset + length))
      .replace(/\u0000/g, '');
    this.offset += length;
    return value;
  }
}

const readUint16At = (bytes: Uint8Array, offset: number): number | null => {
  if (offset < 0 || offset + 2 > bytes.byteLength) {
    return null;
  }
  return bytes[offset] | (bytes[offset + 1] << 8);
};

const readUint32At = (bytes: Uint8Array, offset: number): number | null => {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    return null;
  }
  return bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24);
};

const isPlausibleBlockTypeName = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 160 &&
  /^[A-Za-z0-9_:]+$/.test(value) &&
  /^(?:Ni|BS|bhk|hk|RootCollisionNode)/.test(value);

const parseBlockTypeTableAt = (bytes: Uint8Array, offset: number): NifBlockTypeTable | null => {
  const blockTypeCount = readUint16At(bytes, offset);
  if (blockTypeCount === null || blockTypeCount < 1 || blockTypeCount > 4096) {
    return null;
  }

  const blockTypes: string[] = [];
  let cursor = offset + 2;
  for (let index = 0; index < blockTypeCount; index += 1) {
    const length = readUint32At(bytes, cursor);
    if (length === null || length < 1 || length > 160 || cursor + 4 + length > bytes.byteLength) {
      return null;
    }

    cursor += 4;
    const value = new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.slice(cursor, cursor + length))
      .replace(/\u0000/g, '');
    if (!isPlausibleBlockTypeName(value)) {
      return null;
    }

    blockTypes.push(value);
    cursor += length;
  }

  return {
    blockTypes,
    nextOffset: cursor
  };
};

const findBlockTypeTable = (bytes: Uint8Array, startOffset: number): NifBlockTypeTable | null => {
  const scanEnd = Math.min(bytes.byteLength - 2, startOffset + 1024);
  for (let offset = startOffset; offset <= scanEnd; offset += 1) {
    const table = parseBlockTypeTableAt(bytes, offset);
    if (table) {
      return table;
    }
  }
  return null;
};

const readFloat32Array = (view: DataView, offset: number, count: number): number[] | null => {
  if (offset < 0 || offset + count * 4 > view.byteLength) {
    return null;
  }

  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(view.getFloat32(offset + index * 4, true));
  }
  return finiteArray(values) ? values : null;
};

const halfToFloat = (value: number): number => {
  const sign = (value & 0x8000) ? -1 : 1;
  const exponent = (value >> 10) & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) {
    return sign * Math.pow(2, -14) * (fraction / 1024);
  }
  if (exponent === 0x1f) {
    return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  }
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
};

const readTriangleIndicesAt = (
  view: DataView,
  offset: number,
  vertexCount: number
): { indices: number[]; nextOffset: number } | null => {
  if (offset + 7 > view.byteLength) {
    return null;
  }

  const triangleCount = view.getUint16(offset, true);
  const pointCount = view.getUint32(offset + 2, true);
  const hasTriangles = view.getUint8(offset + 6) !== 0;
  if (!hasTriangles || !validTriangleCount(triangleCount) || pointCount !== triangleCount * 3) {
    return null;
  }

  const indicesOffset = offset + 7;
  const indicesLength = triangleCount * 3;
  if (indicesOffset + indicesLength * 2 > view.byteLength) {
    return null;
  }

  const indices: number[] = [];
  for (let index = 0; index < indicesLength; index += 1) {
    indices.push(view.getUint16(indicesOffset + index * 2, true));
  }

  return validIndices(indices, vertexCount)
    ? { indices, nextOffset: indicesOffset + indicesLength * 2 }
    : null;
};

const findTriangleIndices = (
  view: DataView,
  startOffset: number,
  vertexCount: number
): { indices: number[]; offset: number } | null => {
  const searchEnd = Math.min(view.byteLength - 7, startOffset + 2048);
  for (let offset = startOffset; offset <= searchEnd; offset += 1) {
    const result = readTriangleIndicesAt(view, offset, vertexCount);
    if (result) {
      return { indices: result.indices, offset };
    }
  }
  return null;
};

const parseNiTriShapeDataCandidate = (
  view: DataView,
  name: string,
  startOffset: number,
  flagBytes: number
): ParsedNifMesh | null => {
  if (startOffset + 3 + flagBytes > view.byteLength) {
    return null;
  }

  const vertexCount = view.getUint16(startOffset, true);
  if (!validVertexCount(vertexCount)) {
    return null;
  }

  let offset = startOffset + 2 + flagBytes;
  if (view.getUint8(offset) === 0) {
    return null;
  }
  offset += 1;

  const positions = readFloat32Array(view, offset, vertexCount * 3);
  if (!positions) {
    return null;
  }
  offset += vertexCount * 12;

  let normals: number[] | undefined;
  let uvs: number[] | undefined;
  try {
    const uvSetFlags = view.getUint16(offset, true);
    offset += 2;
    const uvSetCount = uvSetFlags & 0x3f;
    if (uvSetCount > 8) {
      return null;
    }

    const hasNormals = view.getUint8(offset) !== 0;
    offset += 1;
    if (hasNormals) {
      const parsedNormals = readFloat32Array(view, offset, vertexCount * 3);
      if (!parsedNormals) {
        return null;
      }
      normals = parsedNormals;
      offset += vertexCount * 12;
      if ((uvSetFlags & 0x1040) !== 0) {
        offset += vertexCount * 24;
      }
    }

    offset += 16;
    if (offset >= view.byteLength) {
      return null;
    }

    const hasVertexColors = view.getUint8(offset) !== 0;
    offset += 1;
    if (hasVertexColors) {
      offset += vertexCount * 16;
    }

    if (uvSetCount > 0) {
      const parsedUvs = readFloat32Array(view, offset, vertexCount * 2);
      if (parsedUvs) {
        uvs = parsedUvs;
      }
      offset += vertexCount * uvSetCount * 8;
    }

    offset += 6;
  } catch {
    return null;
  }

  const triangleResult = readTriangleIndicesAt(view, offset, vertexCount) ?? findTriangleIndices(view, offset, vertexCount);
  if (!triangleResult) {
    return null;
  }
  if (!hasNonDegenerateTriangle(positions, triangleResult.indices)) {
    return null;
  }

  return {
    name,
    positions,
    indices: triangleResult.indices,
    normals,
    uvs
  };
};

const parseNiTriShapeDataBlock = (block: NifBlockSlice): ParsedNifMesh[] => {
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  const meshName = `${block.typeName} ${block.index + 1}`;
  for (const startOffset of [0, 4, 8, 12, 16]) {
    for (const flagBytes of [2, 0]) {
      const mesh = parseNiTriShapeDataCandidate(view, meshName, startOffset, flagBytes);
      if (mesh) {
        return [mesh];
      }
    }
  }
  return [];
};

const parseBsTriShapeCandidate = (
  view: DataView,
  name: string,
  vertexDataOffset: number,
  vertexBytes: number,
  vertexCount: number,
  triangleCount: number
): ParsedNifMesh | null => {
  const trianglesBytes = triangleCount * 6;
  const trianglesOffset = vertexDataOffset + vertexBytes;
  if (vertexBytes <= 0 || vertexBytes % vertexCount !== 0 || trianglesOffset + trianglesBytes > view.byteLength) {
    return null;
  }

  const stride = vertexBytes / vertexCount;
  if (stride < 12 || stride > 128) {
    return null;
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertexDataOffset + vertex * stride;
    const x = view.getFloat32(offset, true);
    const y = view.getFloat32(offset + 4, true);
    const z = view.getFloat32(offset + 8, true);
    positions.push(x, y, z);
    if (stride >= 20) {
      uvs.push(halfToFloat(view.getUint16(offset + 16, true)), halfToFloat(view.getUint16(offset + 18, true)));
    }
  }

  if (!finiteArray(positions) || positions.every((value) => Math.abs(value) < 0.000001)) {
    return null;
  }

  const indices: number[] = [];
  for (let index = 0; index < triangleCount * 3; index += 1) {
    indices.push(view.getUint16(trianglesOffset + index * 2, true));
  }

  if (!validIndices(indices, vertexCount)) {
    return null;
  }
  if (!hasNonDegenerateTriangle(positions, indices)) {
    return null;
  }

  return {
    name,
    positions,
    indices,
    uvs: uvs.length === vertexCount * 2 && finiteArray(uvs) ? uvs : undefined
  };
};

interface BsTriShapeLayoutCandidate {
  triangleCountOffset: number;
  vertexCountOffset: number;
  dataSizeOffset: number;
  vertexDataOffset: number;
}

const bsTriShapeLayoutCandidates = (offset: number): BsTriShapeLayoutCandidate[] => [
  {
    triangleCountOffset: offset + 8,
    vertexCountOffset: offset + 10,
    dataSizeOffset: offset + 12,
    vertexDataOffset: offset + 16
  },
  {
    triangleCountOffset: offset,
    vertexCountOffset: offset + 2,
    dataSizeOffset: offset + 4,
    vertexDataOffset: offset + 16
  },
  {
    triangleCountOffset: offset,
    vertexCountOffset: offset + 2,
    dataSizeOffset: offset + 4,
    vertexDataOffset: offset + 8
  }
];

const parseBsTriShapeBlock = (block: NifBlockSlice): ParsedNifMesh[] => {
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  const meshName = `${block.typeName} ${block.index + 1}`;
  for (let offset = 0; offset <= view.byteLength - 8; offset += 1) {
    for (const layout of bsTriShapeLayoutCandidates(offset)) {
      if (layout.vertexDataOffset > view.byteLength || layout.dataSizeOffset + 4 > view.byteLength) {
        continue;
      }

      const triangleCount = view.getUint16(layout.triangleCountOffset, true);
      const vertexCount = view.getUint16(layout.vertexCountOffset, true);
      const dataSize = view.getUint32(layout.dataSizeOffset, true);
      if (!validTriangleCount(triangleCount) || !validVertexCount(vertexCount)) {
        continue;
      }

      for (const vertexBytes of [dataSize, dataSize - triangleCount * 6]) {
        const mesh = parseBsTriShapeCandidate(
          view,
          meshName,
          layout.vertexDataOffset,
          vertexBytes,
          vertexCount,
          triangleCount
        );
        if (mesh) {
          return [mesh];
        }
      }
    }
  }
  return [];
};

const readSkinPartitionVertexData = (
  view: DataView,
  vertexDataOffset: number,
  vertexSize: number,
  vertexCount: number
): { positions: number[]; uvs?: number[] } | null => {
  const positions: number[] = [];
  const uvs: number[] = [];
  const uvOffset = vertexSize >= 36 ? 32 : vertexSize >= 20 ? 16 : -1;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertexDataOffset + vertex * vertexSize;
    positions.push(
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true)
    );
    if (uvOffset >= 0 && uvOffset + 4 <= vertexSize) {
      uvs.push(
        halfToFloat(view.getUint16(offset + uvOffset, true)),
        halfToFloat(view.getUint16(offset + uvOffset + 2, true))
      );
    }
  }

  if (!finiteArray(positions) || positions.every((value) => Math.abs(value) < 0.000001)) {
    return null;
  }

  return {
    positions,
    uvs: uvs.length === vertexCount * 2 && finiteArray(uvs) ? uvs : undefined
  };
};

const parseNiSkinPartitionBlock = (block: NifBlockSlice): ParsedNifMesh[] => {
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  if (view.byteLength < 20) {
    return [];
  }

  try {
    const partitionCount = view.getUint32(0, true);
    const vertexDataSize = view.getUint32(4, true);
    const vertexSize = view.getUint32(8, true);
    const vertexDataOffset = 20;
    if (
      partitionCount < 1 ||
      partitionCount > 128 ||
      vertexSize < 12 ||
      vertexSize > 128 ||
      vertexDataSize % vertexSize !== 0 ||
      vertexDataOffset + vertexDataSize > view.byteLength
    ) {
      return [];
    }

    const vertexCount = vertexDataSize / vertexSize;
    if (!validVertexCount(vertexCount)) {
      return [];
    }

    const vertexData = readSkinPartitionVertexData(view, vertexDataOffset, vertexSize, vertexCount);
    if (!vertexData) {
      return [];
    }

    const indices: number[] = [];
    let cursor = vertexDataOffset + vertexDataSize;
    const skip = (count: number) => {
      if (count < 0 || cursor + count > view.byteLength) {
        throw new Error('NIF skin partition is truncated.');
      }
      cursor += count;
    };
    const readU8 = () => {
      if (cursor + 1 > view.byteLength) {
        throw new Error('NIF skin partition is truncated.');
      }
      const value = view.getUint8(cursor);
      cursor += 1;
      return value;
    };
    const readU16 = () => {
      if (cursor + 2 > view.byteLength) {
        throw new Error('NIF skin partition is truncated.');
      }
      const value = view.getUint16(cursor, true);
      cursor += 2;
      return value;
    };

    for (let partition = 0; partition < partitionCount; partition += 1) {
      const partitionVertexCount = readU16();
      const triangleCount = readU16();
      const boneCount = readU16();
      const stripCount = readU16();
      const weightsPerVertex = readU16();
      if (
        partitionVertexCount < 3 ||
        partitionVertexCount > vertexCount ||
        !validTriangleCount(triangleCount) ||
        boneCount > 1024 ||
        stripCount > 4096 ||
        weightsPerVertex > 16
      ) {
        return [];
      }

      skip(boneCount * 2);

      let vertexMap: number[] | null = null;
      if (readU8() !== 0) {
        vertexMap = [];
        for (let index = 0; index < partitionVertexCount; index += 1) {
          const mapped = readU16();
          if (mapped >= vertexCount) {
            return [];
          }
          vertexMap.push(mapped);
        }
      }

      if (readU8() !== 0) {
        skip(partitionVertexCount * weightsPerVertex * 4);
      }

      const stripLengths: number[] = [];
      for (let index = 0; index < stripCount; index += 1) {
        stripLengths.push(readU16());
      }

      if (readU8() !== 0) {
        if (stripCount > 0) {
          const stripIndexCount = stripLengths.reduce((sum, value) => sum + value, 0);
          skip(stripIndexCount * 2);
        } else {
          for (let index = 0; index < triangleCount * 3; index += 1) {
            const localIndex = readU16();
            const mappedIndex = vertexMap ? vertexMap[localIndex] : localIndex;
            if (!Number.isInteger(mappedIndex) || mappedIndex < 0 || mappedIndex >= vertexCount) {
              return [];
            }
            indices.push(mappedIndex);
          }
        }
      }

      if (cursor < view.byteLength && readU8() !== 0) {
        skip(partitionVertexCount * weightsPerVertex);
      }
    }

    if (!validIndices(indices, vertexCount) || !hasNonDegenerateTriangle(vertexData.positions, indices)) {
      return [];
    }

    return [{
      name: `${block.typeName} ${block.index + 1}`,
      positions: vertexData.positions,
      indices,
      uvs: vertexData.uvs
    }];
  } catch {
    return [];
  }
};

const parseGlobalBsTriShapeMeshes = (buffer: ArrayBuffer): ParsedNifMesh[] => {
  const view = new DataView(buffer);
  for (let offset = 0; offset <= view.byteLength - 8; offset += 1) {
    for (const layout of bsTriShapeLayoutCandidates(offset)) {
      if (layout.vertexDataOffset > view.byteLength || layout.dataSizeOffset + 4 > view.byteLength) {
        continue;
      }

      const triangleCount = view.getUint16(layout.triangleCountOffset, true);
      const vertexCount = view.getUint16(layout.vertexCountOffset, true);
      const dataSize = view.getUint32(layout.dataSizeOffset, true);
      if (!validTriangleCount(triangleCount) || !validVertexCount(vertexCount)) {
        continue;
      }

      for (const vertexBytes of [dataSize, dataSize - triangleCount * 6]) {
        const mesh = parseBsTriShapeCandidate(
          view,
          'BSTriShape static geometry',
          layout.vertexDataOffset,
          vertexBytes,
          vertexCount,
          triangleCount
        );
        if (mesh) {
          return [mesh];
        }
      }
    }
  }

  return [];
};

const parseNifDocument = (buffer: ArrayBuffer): NifDocument | null => {
  const bytes = new Uint8Array(buffer);
  const newlineIndex = bytes.findIndex((byte) => byte === 0x0a);
  if (newlineIndex < 0) {
    return null;
  }

  const header = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, newlineIndex)).trim();
  if (!nifHeaderPattern.test(header)) {
    return null;
  }

  try {
    const reader = new BinaryReader(bytes, newlineIndex + 1);
    const version = reader.readUint32();
    if (version >= 0x14000004) {
      reader.readUint8();
    }
    if (version >= 0x0a010000) {
      reader.readUint32();
    }

    const blockCount = reader.readUint32();
    if (!Number.isInteger(blockCount) || blockCount < 1 || blockCount > 100_000) {
      return null;
    }

    if (version >= 0x14020007) {
      reader.readUint32();
    }
    const blockTypeTable = findBlockTypeTable(bytes, reader.position);
    if (!blockTypeTable) {
      return null;
    }

    const blockTypes = blockTypeTable.blockTypes;
    reader.seek(blockTypeTable.nextOffset);

    const blockTypeIndices: number[] = [];
    for (let index = 0; index < blockCount; index += 1) {
      blockTypeIndices.push(reader.readUint16());
    }

    const blockSizes: number[] = [];
    for (let index = 0; index < blockCount; index += 1) {
      blockSizes.push(reader.readUint32());
    }

    const stringCount = reader.readUint32();
    reader.readUint32();
    const stringTable: string[] = [];
    for (let index = 0; index < stringCount; index += 1) {
      stringTable.push(reader.readSizedString());
    }

    const groupCount = reader.readUint32();
    reader.skip(groupCount * 4);

    const payloadSize = blockSizes.reduce((sum, size) => sum + size, 0);
    if (payloadSize > reader.remaining) {
      return null;
    }

    const blocks: NifBlockSlice[] = [];
    let offset = reader.position;
    for (let index = 0; index < blockCount; index += 1) {
      const size = blockSizes[index];
      const typeName = blockTypes[blockTypeIndices[index]] ?? '';
      blocks.push({
        typeName,
        index,
        data: bytes.slice(offset, offset + size)
      });
      offset += size;
    }
    return {
      blocks,
      stringTable
    };
  } catch {
    return null;
  }
};

const shaderPropertyBlocks = new Set([
  'BSLightingShaderProperty',
  'BSEffectShaderProperty',
  'NiTexturingProperty'
]);

const geometryBlocks = new Set([
  'NiTriShape',
  'BSTriShape',
  'BSSegmentedTriShape',
  'BSMeshLODTriShape',
  'BSSubIndexTriShape'
]);

const geometryDataBlocks = new Set([
  'NiTriShapeData',
  'NiSkinPartition'
]);

const skinInstanceBlocks = new Set([
  'NiSkinInstance',
  'BSDismemberSkinInstance',
  'BSSkin::Instance'
]);

const blockText = (block: NifBlockSlice): string =>
  new TextDecoder('utf-8', { fatal: false }).decode(block.data);

const blockReferenceIndices = (
  block: NifBlockSlice,
  allowedIndices: Set<number>,
  scanByteLimit = 512
): number[] => {
  if (allowedIndices.size === 0 || block.data.byteLength < 4) {
    return [];
  }

  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  const end = Math.min(view.byteLength - 4, scanByteLimit);
  const found: number[] = [];
  for (let offset = 0; offset <= end; offset += 4) {
    const index = view.getInt32(offset, true);
    if (allowedIndices.has(index)) {
      found.push(index);
    }
  }
  return Array.from(new Set(found));
};

const stringTableTexturePathsForBlock = (
  block: NifBlockSlice,
  stringTable: string[]
): string[] => {
  if (stringTable.length === 0 || block.data.byteLength < 4) {
    return [];
  }

  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  if (block.typeName === 'BSShaderTextureSet') {
    const textureCount = view.getUint32(0, true);
    if (textureCount > 0 && textureCount <= 32 && 4 + textureCount * 4 <= view.byteLength) {
      const slotPaths: string[] = [];
      for (let slot = 0; slot < textureCount; slot += 1) {
        const index = view.getUint32(4 + slot * 4, true);
        if (index < stringTable.length && isTexturePath(stringTable[index])) {
          slotPaths.push(normalizeTexturePath(stringTable[index]));
        }
      }
      if (slotPaths.length > 0) {
        return slotPaths;
      }
    }
  }

  const paths: string[] = [];
  const startOffset = block.typeName === 'BSShaderTextureSet' ? 4 : 0;
  for (let offset = startOffset; offset <= view.byteLength - 4; offset += 4) {
    const index = view.getUint32(offset, true);
    if (index < stringTable.length) {
      const value = stringTable[index];
      if (isTexturePath(value)) {
        paths.push(normalizeTexturePath(value));
      }
    }
  }
  return paths;
};

const texturePathsForBlock = (
  block: NifBlockSlice,
  stringTable: string[]
): string[] =>
  prioritizeDiffuseTexturePaths([
    ...stringTableTexturePathsForBlock(block, stringTable),
    ...scanTexturePaths(blockText(block))
  ]);

const firstMappedTexturePath = (
  references: number[],
  texturePathsByBlock: Map<number, string>
): string | undefined => {
  for (const reference of references) {
    const texturePath = texturePathsByBlock.get(reference);
    if (texturePath) {
      return texturePath;
    }
  }
  return undefined;
};

const buildGeometryTexturePathMap = (document: NifDocument): Map<number, string> => {
  const blockByIndex = new Map(document.blocks.map((block) => [block.index, block]));
  const textureSetIndices = new Set(
    document.blocks
      .filter((block) => block.typeName === 'BSShaderTextureSet' || block.typeName === 'NiSourceTexture')
      .map((block) => block.index)
  );
  const shaderIndices = new Set(
    document.blocks
      .filter((block) => shaderPropertyBlocks.has(block.typeName))
      .map((block) => block.index)
  );
  const geometryDataIndices = new Set(
    document.blocks
      .filter((block) => geometryDataBlocks.has(block.typeName))
      .map((block) => block.index)
  );
  const skinInstanceIndices = new Set(
    document.blocks
      .filter((block) => skinInstanceBlocks.has(block.typeName))
      .map((block) => block.index)
  );
  const skinPartitionIndices = new Set(
    document.blocks
      .filter((block) => block.typeName === 'NiSkinPartition')
      .map((block) => block.index)
  );

  const texturePathsByBlock = new Map<number, string>();
  document.blocks.forEach((block) => {
    if (!textureSetIndices.has(block.index)) {
      return;
    }

    const paths = texturePathsForBlock(block, document.stringTable);
    if (paths.length > 0) {
      texturePathsByBlock.set(block.index, paths[0]);
    }
  });

  const shaderTexturePaths = new Map<number, string>();
  document.blocks.forEach((block) => {
    if (!shaderIndices.has(block.index)) {
      return;
    }

    const directPaths = texturePathsForBlock(block, document.stringTable);
    const textureSetPath = firstMappedTexturePath(
      blockReferenceIndices(block, textureSetIndices),
      texturePathsByBlock
    );
    const texturePath = textureSetPath ?? directPaths[0];
    if (texturePath) {
      shaderTexturePaths.set(block.index, texturePath);
    }
  });

  const geometryTexturePaths = new Map<number, string>();
  document.blocks.forEach((block) => {
    if (!geometryBlocks.has(block.typeName)) {
      return;
    }

    const directTextureSetPath = firstMappedTexturePath(
      blockReferenceIndices(block, textureSetIndices),
      texturePathsByBlock
    );
    const shaderTexturePath = firstMappedTexturePath(
      blockReferenceIndices(block, shaderIndices),
      shaderTexturePaths
    );
    const texturePath = shaderTexturePath ?? directTextureSetPath;
    if (!texturePath) {
      return;
    }

    geometryTexturePaths.set(block.index, texturePath);
    blockReferenceIndices(block, geometryDataIndices).forEach((dataIndex) => {
      geometryTexturePaths.set(dataIndex, texturePath);
    });
    blockReferenceIndices(block, skinInstanceIndices).forEach((skinInstanceIndex) => {
      geometryTexturePaths.set(skinInstanceIndex, texturePath);
      const skinInstanceBlock = blockByIndex.get(skinInstanceIndex);
      if (!skinInstanceBlock) {
        return;
      }
      blockReferenceIndices(skinInstanceBlock, skinPartitionIndices).forEach((partitionIndex) => {
        geometryTexturePaths.set(partitionIndex, texturePath);
      });
    });
  });

  return geometryTexturePaths;
};

const applyAssociatedTexturePath = (
  meshes: ParsedNifMesh[],
  texturePath: string | undefined
): ParsedNifMesh[] => {
  if (!texturePath) {
    return meshes;
  }

  return meshes.map((mesh) => mesh.texturePath ? mesh : { ...mesh, texturePath });
};

const parseBinaryNifMeshes = (buffer: ArrayBuffer): ParsedNifMesh[] => {
  const document = parseNifDocument(buffer);
  const blocks = document?.blocks ?? [];
  const geometryTexturePaths = document ? buildGeometryTexturePathMap(document) : new Map<number, string>();
  const staticMeshes = blocks.flatMap((block) => {
    const associatedTexturePath = geometryTexturePaths.get(block.index);
    if (block.typeName === 'NiTriShapeData') {
      return applyAssociatedTexturePath(parseNiTriShapeDataBlock(block), associatedTexturePath);
    }
    if (
      block.typeName === 'BSTriShape' ||
      block.typeName === 'BSSegmentedTriShape' ||
      block.typeName === 'BSMeshLODTriShape' ||
      block.typeName === 'BSSubIndexTriShape'
    ) {
      return applyAssociatedTexturePath(parseBsTriShapeBlock(block), associatedTexturePath);
    }
    return [];
  });
  if (staticMeshes.length > 0) {
    return staticMeshes;
  }

  const skinMeshes = blocks.flatMap((block) => block.typeName === 'NiSkinPartition'
    ? applyAssociatedTexturePath(parseNiSkinPartitionBlock(block), geometryTexturePaths.get(block.index))
    : []);
  return skinMeshes.length > 0 ? skinMeshes : parseGlobalBsTriShapeMeshes(buffer);
};

export const createStaticNifFixture = (fixture: StaticNifFixture): ArrayBuffer =>
  new TextEncoder()
    .encode(
      [
        'Gamebryo File Format, Version 20.2.0.7',
        supportedNifBlocks.join(' '),
        `${staticFixtureMarker}${JSON.stringify(fixture)}`
      ].join('\n')
    )
    .buffer;

export const parseNifModel = (buffer: ArrayBuffer): ParsedNifModel => {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const supportedBlocks = scanSupportedBlocks(text);
  const warnings = scanWarnings(text, supportedBlocks);
  let meshes: ParsedNifMesh[] = [];

  try {
    meshes = parseStaticFixture(text) ?? [];
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Static NIF fixture could not be parsed.');
  }

  if (meshes.length === 0) {
    meshes = parseBinaryNifMeshes(buffer);
  }

  if (meshes.length === 0) {
    meshes = [fallbackMesh()];
    warnings.push('Static geometry for the supported NIF subset was not found; rendering a neutral fallback shape.');
  }

  const texturePaths = prioritizeDiffuseTexturePaths([
    ...meshes.map((mesh) => mesh.texturePath ?? ''),
    ...scanTexturePaths(text)
  ]);

  if (texturePaths.length === 0) {
    warnings.push('No diffuse texture path was found; fallback material will be used.');
  }

  return {
    meshes,
    texturePaths,
    supportedBlocks,
    warnings: uniqueStrings(warnings)
  };
};
