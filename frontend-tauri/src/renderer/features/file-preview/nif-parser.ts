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
  'BSDynamicTriShape',
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

const staticBsTriShapeBlockNames = new Set([
  'BSTriShape',
  'BSSegmentedTriShape',
  'BSMeshLODTriShape',
  'BSSubIndexTriShape'
]);

interface NifBlockSlice {
  typeName: string;
  data: Uint8Array;
  index: number;
}

interface NifDocument {
  blocks: NifBlockSlice[];
  stringTable: string[];
  userVersion: number;
  streamVersion: number;
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

const nifTextDecoder = new TextDecoder('utf-8', { fatal: false });

const scanPrintableBytes = (bytes: Uint8Array): string => {
  const fragments: string[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start >= 0 && end - start >= 4) {
      fragments.push(nifTextDecoder.decode(bytes.subarray(start, end)));
    }
    start = -1;
  };

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    const printable = byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126);
    if (printable) {
      if (start < 0) {
        start = index;
      }
    } else {
      flush(index);
    }
  }
  flush(bytes.length);
  return fragments.join('\n');
};

const scanPrintableNifText = (buffer: ArrayBuffer): string =>
  scanPrintableBytes(new Uint8Array(buffer));

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
  const minimumRelativeAreaSquared = 1e-12;
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
    const bcx = positions[c] - positions[b];
    const bcy = positions[c + 1] - positions[b + 1];
    const bcz = positions[c + 2] - positions[b + 2];
    const maximumEdgeSquared = Math.max(
      abx * abx + aby * aby + abz * abz,
      acx * acx + acy * acy + acz * acz,
      bcx * bcx + bcy * bcy + bcz * bcz
    );
    const areaSquared = crossX * crossX + crossY * crossY + crossZ * crossZ;
    if (
      maximumEdgeSquared > 0 &&
      areaSquared > maximumEdgeSquared * maximumEdgeSquared * minimumRelativeAreaSquared
    ) {
      return true;
    }
  }
  return false;
};

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
    const value = nifTextDecoder
      .decode(this.bytes.subarray(this.offset, this.offset + length))
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
    const value = nifTextDecoder
      .decode(bytes.subarray(cursor, cursor + length))
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
  flagBytes: number,
  materialCrcBytes: number
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
    offset += 2 + materialCrcBytes;
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
      if ((uvSetFlags & 0x1000) !== 0) {
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
      for (const materialCrcBytes of [4, 0]) {
        const mesh = parseNiTriShapeDataCandidate(
          view,
          meshName,
          startOffset,
          flagBytes,
          materialCrcBytes
        );
        if (mesh) {
          return [mesh];
        }
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

  const header = nifTextDecoder.decode(bytes.subarray(0, newlineIndex)).trim();
  if (!nifHeaderPattern.test(header)) {
    return null;
  }

  try {
    const reader = new BinaryReader(bytes, newlineIndex + 1);
    const version = reader.readUint32();
    if (version >= 0x14000004) {
      reader.readUint8();
    }
    const userVersion = version >= 0x0a010000 ? reader.readUint32() : 0;

    const blockCount = reader.readUint32();
    if (!Number.isInteger(blockCount) || blockCount < 1 || blockCount > 100_000) {
      return null;
    }

    const streamVersion = version >= 0x14020007 ? reader.readUint32() : 0;
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
        data: bytes.subarray(offset, offset + size)
      });
      offset += size;
    }
    return {
      blocks,
      stringTable,
      userVersion,
      streamVersion
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
  'BSDynamicTriShape',
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

const blockText = (block: NifBlockSlice): string => scanPrintableBytes(block.data);

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

interface SseBsTriShapeLayout {
  skinInstanceIndex: number;
  vertexAttributes: number;
  vertexStride: number;
  triangleCount: number;
  vertexCount: number;
  dataSize: number;
  vertexDataOffset: number;
  dynamicDataSizeOffset: number;
}

interface SseVertexAttributes {
  positions?: number[];
  normals?: number[];
  uvs?: number[];
}

interface SseSkinPartitionGeometry extends SseVertexAttributes {
  indices: number[];
}

const parseSseBsTriShapeLayout = (
  block: NifBlockSlice,
  streamVersion: number
): SseBsTriShapeLayout | null => {
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  try {
    if (view.byteLength < 120) {
      return null;
    }

    const extraDataCount = view.getUint32(4, true);
    if (extraDataCount > 1_024) {
      return null;
    }

    let offset = 8 + extraDataCount * 4;
    offset += 4; // Controller reference.
    offset += 4; // NiAVObject flags.
    offset += 12 + 36 + 4; // Translation, rotation and scale.
    offset += 4; // Collision reference.
    offset += 16; // Bounding sphere.
    if (streamVersion > 139) {
      offset += 24;
    }
    if (offset + 28 > view.byteLength) {
      return null;
    }

    const skinInstanceIndex = view.getInt32(offset, true);
    offset += 12; // Skin, shader and alpha property references.
    const descriptor = view.getBigUint64(offset, true);
    const vertexStride = Number(descriptor & 0x0fn) * 4;
    const vertexAttributes = Number((descriptor >> 44n) & 0xfffn);
    offset += 8;

    const triangleCount = view.getUint16(offset, true);
    const vertexCount = view.getUint16(offset + 2, true);
    let dataSize = view.getUint32(offset + 4, true);
    const vertexDataOffset = offset + 8;
    if (
      (triangleCount > 0 && !validVertexCount(vertexCount)) ||
      (triangleCount === 0 && vertexCount > maxStaticPreviewVertices) ||
      triangleCount > maxStaticPreviewTriangles ||
      vertexStride > 128
    ) {
      return null;
    }

    if (vertexDataOffset + dataSize + 4 > view.byteLength) {
      const inferredDataSize = vertexCount * vertexStride + triangleCount * 6;
      if (
        vertexStride < 4 ||
        vertexDataOffset + inferredDataSize + 4 > view.byteLength
      ) {
        return null;
      }
      dataSize = inferredDataSize;
    }

    const particleDataSizeOffset = vertexDataOffset + dataSize;
    const particleDataSize = view.getUint32(particleDataSizeOffset, true);
    const dynamicDataSizeOffset = particleDataSizeOffset + 4 + particleDataSize * 2;
    if (
      dynamicDataSizeOffset > view.byteLength ||
      (block.typeName === 'BSDynamicTriShape' && dynamicDataSizeOffset + 4 > view.byteLength)
    ) {
      return null;
    }

    return {
      skinInstanceIndex,
      vertexAttributes,
      vertexStride,
      triangleCount,
      vertexCount,
      dataSize,
      vertexDataOffset,
      dynamicDataSizeOffset
    };
  } catch {
    return null;
  }
};

const parseSseVertexAttributes = (
  view: DataView,
  vertexDataOffset: number,
  vertexCount: number,
  vertexStride: number,
  vertexAttributes: number
): SseVertexAttributes | null => {
  if (
    vertexStride <= 0 ||
    vertexStride > 128 ||
    vertexDataOffset < 0 ||
    vertexDataOffset + vertexCount * vertexStride > view.byteLength
  ) {
    return null;
  }

  let positionOffset = -1;
  let uvOffset = -1;
  let normalOffset = -1;
  let fieldOffset = 0;
  if ((vertexAttributes & 0x1) !== 0) {
    positionOffset = fieldOffset;
    fieldOffset += 16;
  }
  if ((vertexAttributes & 0x2) !== 0) {
    uvOffset = fieldOffset;
    fieldOffset += 4;
  }
  if ((vertexAttributes & 0x8) !== 0) {
    normalOffset = fieldOffset;
    fieldOffset += 4;
    if ((vertexAttributes & 0x10) !== 0) {
      fieldOffset += 4;
    }
  }
  if ((vertexAttributes & 0x20) !== 0) {
    fieldOffset += 4;
  }
  if ((vertexAttributes & 0x40) !== 0) {
    fieldOffset += 12;
  }
  if ((vertexAttributes & 0x100) !== 0) {
    fieldOffset += 4;
  }
  if (fieldOffset > vertexStride) {
    return null;
  }

  const positions = positionOffset >= 0 ? [] as number[] : undefined;
  const uvs = uvOffset >= 0 ? [] as number[] : undefined;
  const normals = normalOffset >= 0 ? [] as number[] : undefined;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const base = vertexDataOffset + vertex * vertexStride;
    if (positions) {
      positions.push(
        view.getFloat32(base + positionOffset, true),
        view.getFloat32(base + positionOffset + 4, true),
        view.getFloat32(base + positionOffset + 8, true)
      );
    }
    if (uvs) {
      uvs.push(
        halfToFloat(view.getUint16(base + uvOffset, true)),
        halfToFloat(view.getUint16(base + uvOffset + 2, true))
      );
    }
    if (normals) {
      normals.push(
        view.getUint8(base + normalOffset) / 127.5 - 1,
        view.getUint8(base + normalOffset + 1) / 127.5 - 1,
        view.getUint8(base + normalOffset + 2) / 127.5 - 1
      );
    }
  }

  if (
    (positions && !finiteArray(positions)) ||
    (uvs && !finiteArray(uvs)) ||
    (normals && !finiteArray(normals))
  ) {
    return null;
  }
  return { positions, uvs, normals };
};

const parseSseStaticBsTriShapeBlock = (
  document: NifDocument,
  block: NifBlockSlice
): ParsedNifMesh[] => {
  if (document.userVersion !== 12 || document.streamVersion !== 100) {
    return [];
  }

  const layout = parseSseBsTriShapeLayout(block, document.streamVersion);
  if (!layout) {
    return [];
  }

  const vertexBytes = layout.vertexCount * layout.vertexStride;
  const triangleBytes = layout.triangleCount * 6;
  if (vertexBytes <= 0 || layout.dataSize < vertexBytes + triangleBytes) {
    return [];
  }

  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  const attributes = parseSseVertexAttributes(
    view,
    layout.vertexDataOffset,
    layout.vertexCount,
    layout.vertexStride,
    layout.vertexAttributes
  );
  if (!attributes?.positions) {
    return [];
  }

  const triangleOffset = layout.vertexDataOffset + vertexBytes;
  const indices: number[] = [];
  for (let index = 0; index < layout.triangleCount * 3; index += 1) {
    indices.push(view.getUint16(triangleOffset + index * 2, true));
  }
  if (
    !validIndices(indices, layout.vertexCount) ||
    !hasNonDegenerateTriangle(attributes.positions, indices)
  ) {
    return [];
  }

  return [{
    name: `${block.typeName} ${block.index + 1}`,
    positions: attributes.positions,
    indices,
    normals: attributes.normals,
    uvs: attributes.uvs
  }];
};

const hasOnlyEmptySseTriShapes = (document: NifDocument): boolean => {
  if (document.userVersion !== 12 || document.streamVersion !== 100) {
    return false;
  }

  if (document.blocks.some((block) =>
    block.typeName === 'NiTriShapeData' ||
    block.typeName === 'NiSkinPartition' ||
    block.typeName === 'BSDynamicTriShape'
  )) {
    return false;
  }

  const shapeBlocks = document.blocks.filter((block) =>
    staticBsTriShapeBlockNames.has(block.typeName)
  );
  return shapeBlocks.length > 0 && shapeBlocks.every((block) => {
    const layout = parseSseBsTriShapeLayout(block, document.streamVersion);
    return Boolean(
      layout &&
      layout.vertexCount === 0 &&
      layout.triangleCount === 0 &&
      layout.dataSize === 0
    );
  });
};

const parseSseSkinPartitionGeometry = (
  block: NifBlockSlice,
  expectedVertexCount: number
): SseSkinPartitionGeometry | null => {
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  if (view.byteLength < 20) {
    return null;
  }

  try {
    const partitionCount = view.getUint32(0, true);
    const vertexDataSize = view.getUint32(4, true);
    const vertexStride = view.getUint32(8, true);
    const descriptor = view.getBigUint64(12, true);
    const vertexAttributes = Number((descriptor >> 44n) & 0xfffn);
    if (
      partitionCount < 1 ||
      partitionCount > 128 ||
      vertexStride < 4 ||
      vertexStride > 128 ||
      vertexDataSize % vertexStride !== 0 ||
      vertexDataSize / vertexStride !== expectedVertexCount ||
      20 + vertexDataSize > view.byteLength
    ) {
      return null;
    }

    const attributes = parseSseVertexAttributes(
      view,
      20,
      expectedVertexCount,
      vertexStride,
      vertexAttributes
    );
    if (!attributes) {
      return null;
    }

    let cursor = 20 + vertexDataSize;
    const requireBytes = (count: number) => {
      if (count < 0 || cursor + count > view.byteLength) {
        throw new Error('NIF skin partition is truncated.');
      }
    };
    const skip = (count: number) => {
      requireBytes(count);
      cursor += count;
    };
    const readU8 = () => {
      requireBytes(1);
      const value = view.getUint8(cursor);
      cursor += 1;
      return value;
    };
    const readU16 = () => {
      requireBytes(2);
      const value = view.getUint16(cursor, true);
      cursor += 2;
      return value;
    };
    const readU16Array = (count: number): number[] => {
      const values: number[] = [];
      for (let index = 0; index < count; index += 1) {
        values.push(readU16());
      }
      return values;
    };

    const indices: number[] = [];
    for (let partition = 0; partition < partitionCount; partition += 1) {
      const partitionVertexCount = readU16();
      const triangleCount = readU16();
      const boneCount = readU16();
      const stripCount = readU16();
      const weightsPerVertex = readU16();
      const emptyPartition = partitionVertexCount === 0 && triangleCount === 0;
      if (
        (!emptyPartition && partitionVertexCount < 3) ||
        partitionVertexCount > expectedVertexCount ||
        triangleCount > maxStaticPreviewTriangles ||
        boneCount > 1_024 ||
        stripCount > 4_096 ||
        weightsPerVertex > 16 ||
        indices.length + triangleCount * 3 > maxStaticPreviewTriangles * 3
      ) {
        return null;
      }

      skip(boneCount * 2);
      if (readU8() !== 0) {
        for (let vertex = 0; vertex < partitionVertexCount; vertex += 1) {
          if (readU16() >= expectedVertexCount) {
            return null;
          }
        }
      }
      if (readU8() !== 0) {
        skip(partitionVertexCount * weightsPerVertex * 4);
      }

      const stripLengths = readU16Array(stripCount);
      if (readU8() !== 0) {
        const faceIndexCount = stripCount > 0
          ? stripLengths.reduce((sum, length) => sum + length, 0)
          : triangleCount * 3;
        if (faceIndexCount > maxStaticPreviewTriangles * 3) {
          return null;
        }
        skip(faceIndexCount * 2);
      }

      if (readU8() !== 0) {
        skip(partitionVertexCount * weightsPerVertex);
      }
      readU8(); // LOD level.
      readU8(); // Global vertex buffer flag.
      skip(8); // Partition vertex descriptor.
      const triangleCopy = readU16Array(triangleCount * 3);
      // SSE's trailing triangle copy is already in shape/global vertex space.
      // Vertex Map belongs to the skinning weights and must not be applied to
      // these indices (nifly calls this the non-mapped-index layout).
      for (const index of triangleCopy) {
        if (!Number.isInteger(index) || index < 0 || index >= expectedVertexCount) {
          return null;
        }
        indices.push(index);
      }
    }

    return validIndices(indices, expectedVertexCount)
      ? { ...attributes, indices }
      : null;
  } catch {
    return null;
  }
};

const parseSseSkinPartitionBlock = (block: NifBlockSlice): ParsedNifMesh[] => {
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  if (view.byteLength < 20) {
    return [];
  }

  try {
    const vertexDataSize = view.getUint32(4, true);
    const vertexStride = view.getUint32(8, true);
    if (
      vertexStride < 4 ||
      vertexStride > 128 ||
      vertexDataSize % vertexStride !== 0
    ) {
      return [];
    }
    const vertexCount = vertexDataSize / vertexStride;
    if (!validVertexCount(vertexCount)) {
      return [];
    }

    const geometry = parseSseSkinPartitionGeometry(block, vertexCount);
    if (
      !geometry?.positions ||
      !hasNonDegenerateTriangle(geometry.positions, geometry.indices)
    ) {
      return [];
    }
    return [{
      name: `${block.typeName} ${block.index + 1}`,
      positions: geometry.positions,
      indices: geometry.indices,
      normals: geometry.normals,
      uvs: geometry.uvs
    }];
  } catch {
    return [];
  }
};

const parseSseDynamicTriShapeBlock = (
  document: NifDocument,
  block: NifBlockSlice
): ParsedNifMesh[] => {
  if (document.userVersion !== 12 || document.streamVersion !== 100) {
    return [];
  }

  const layout = parseSseBsTriShapeLayout(block, document.streamVersion);
  if (!layout) {
    return [];
  }

  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  const expectedDynamicBytes = layout.vertexCount * 16;
  const dynamicBytes = view.getUint32(layout.dynamicDataSizeOffset, true);
  const dynamicDataOffset = layout.dynamicDataSizeOffset + 4;
  if (
    dynamicBytes !== expectedDynamicBytes ||
    dynamicDataOffset + dynamicBytes !== view.byteLength
  ) {
    return [];
  }

  const positions: number[] = [];
  for (let vertex = 0; vertex < layout.vertexCount; vertex += 1) {
    const offset = dynamicDataOffset + vertex * 16;
    positions.push(
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true)
    );
  }
  if (!finiteArray(positions)) {
    return [];
  }

  let attributes: SseVertexAttributes | null = null;
  let indices: number[] = [];
  const baseVertexBytes = layout.vertexCount * layout.vertexStride;
  if (
    layout.dataSize >= baseVertexBytes + layout.triangleCount * 6 &&
    baseVertexBytes > 0
  ) {
    attributes = parseSseVertexAttributes(
      view,
      layout.vertexDataOffset,
      layout.vertexCount,
      layout.vertexStride,
      layout.vertexAttributes
    );
    const triangleOffset = layout.vertexDataOffset + baseVertexBytes;
    for (let index = 0; index < layout.triangleCount * 3; index += 1) {
      indices.push(view.getUint16(triangleOffset + index * 2, true));
    }
  }

  const skinInstance = document.blocks[layout.skinInstanceIndex];
  if (skinInstance?.data.byteLength >= 8) {
    const skinView = new DataView(
      skinInstance.data.buffer,
      skinInstance.data.byteOffset,
      skinInstance.data.byteLength
    );
    const partitionIndex = skinView.getInt32(4, true);
    const partition = document.blocks[partitionIndex];
    if (partition?.typeName === 'NiSkinPartition') {
      const skinGeometry = parseSseSkinPartitionGeometry(partition, layout.vertexCount);
      if (skinGeometry) {
        if (!validIndices(indices, layout.vertexCount)) {
          indices = skinGeometry.indices;
        }
        attributes = {
          positions: attributes?.positions ?? skinGeometry.positions,
          normals: attributes?.normals ?? skinGeometry.normals,
          uvs: attributes?.uvs ?? skinGeometry.uvs
        };
      }
    }
  }

  if (
    !validIndices(indices, layout.vertexCount) ||
    !hasNonDegenerateTriangle(positions, indices)
  ) {
    return [];
  }

  return [{
    name: `${block.typeName} ${block.index + 1}`,
    positions,
    indices,
    normals: attributes?.normals,
    uvs: attributes?.uvs
  }];
};

const parseBinaryNifMeshes = (
  buffer: ArrayBuffer,
  document: NifDocument | null = parseNifDocument(buffer)
): ParsedNifMesh[] => {
  const blocks = document?.blocks ?? [];
  const geometryTexturePaths = document ? buildGeometryTexturePathMap(document) : new Map<number, string>();
  const staticMeshes = blocks.flatMap((block) => {
    const associatedTexturePath = geometryTexturePaths.get(block.index);
    if (block.typeName === 'NiTriShapeData') {
      return applyAssociatedTexturePath(parseNiTriShapeDataBlock(block), associatedTexturePath);
    }
    if (block.typeName === 'BSDynamicTriShape' && document) {
      return applyAssociatedTexturePath(
        parseSseDynamicTriShapeBlock(document, block),
        associatedTexturePath
      );
    }
    if (staticBsTriShapeBlockNames.has(block.typeName)) {
      const sseMeshes = document
        ? parseSseStaticBsTriShapeBlock(document, block)
        : [];
      return applyAssociatedTexturePath(
        sseMeshes.length > 0 ? sseMeshes : parseBsTriShapeBlock(block),
        associatedTexturePath
      );
    }
    return [];
  });
  if (staticMeshes.length > 0) {
    return staticMeshes;
  }

  const skinMeshes = blocks.flatMap((block) => {
    if (block.typeName !== 'NiSkinPartition') {
      return [];
    }
    const meshes = document?.userVersion === 12 && document.streamVersion === 100
      ? parseSseSkinPartitionBlock(block)
      : parseNiSkinPartitionBlock(block);
    return applyAssociatedTexturePath(meshes, geometryTexturePaths.get(block.index));
  });
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
  const text = scanPrintableNifText(buffer);
  const supportedBlocks = scanSupportedBlocks(text);
  const warnings = scanWarnings(text, supportedBlocks);
  let meshes: ParsedNifMesh[] = [];
  let document: NifDocument | null = null;

  try {
    meshes = parseStaticFixture(text) ?? [];
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Static NIF fixture could not be parsed.');
  }

  if (meshes.length === 0) {
    document = parseNifDocument(buffer);
    meshes = parseBinaryNifMeshes(buffer, document);
  }

  if (meshes.length === 0) {
    if (document && hasOnlyEmptySseTriShapes(document)) {
      warnings.push('NIF contains no renderable triangle geometry; the preview is intentionally empty.');
    } else {
      throw new Error('NIF geometry could not be decoded. This model uses an unsupported geometry layout.');
    }
  }

  const texturePaths = prioritizeDiffuseTexturePaths([
    ...meshes.map((mesh) => mesh.texturePath ?? ''),
    ...scanTexturePaths(text)
  ]);

  if (meshes.length > 0 && texturePaths.length === 0) {
    warnings.push('No diffuse texture path was found; fallback material will be used.');
  }

  return {
    meshes,
    texturePaths,
    supportedBlocks,
    warnings: uniqueStrings(warnings)
  };
};
