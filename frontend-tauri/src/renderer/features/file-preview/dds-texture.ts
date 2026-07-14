import * as THREE from 'three';

const DDS_MAGIC = 0x20534444;
const FOURCC_DXT1 = 0x31545844;
const FOURCC_DXT3 = 0x33545844;
const FOURCC_DXT5 = 0x35545844;
const FOURCC_ATI1 = 0x31495441;
const FOURCC_ATI2 = 0x32495441;
const FOURCC_BC4U = 0x55344342;
const FOURCC_BC5U = 0x55354342;
const FOURCC_DX10 = 0x30315844;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDPF_ALPHAPIXELS = 0x1;

export type DdsFormat =
  | 'bc1'
  | 'bc2'
  | 'bc3'
  | 'bc4'
  | 'bc5'
  | 'bc7'
  | 'rgb24'
  | 'rgba32';

export interface DdsHeader {
  width: number;
  height: number;
  format: DdsFormat;
  dataOffset: number;
  mipMapCount: number;
  rgbBitCount: number;
  rMask: number;
  gMask: number;
  bMask: number;
  aMask: number;
}

export interface DdsGpuSupport {
  s3tc: boolean;
  rgtc: boolean;
  bptc: boolean;
}

export interface DdsPreviewTextureOptions {
  gpuSupport?: DdsGpuSupport;
  decodedRgba?: Uint8Array;
  anisotropy?: number;
  srgb?: boolean;
}

const blockBytesForFormat = (format: DdsFormat): number => {
  switch (format) {
    case 'bc1':
    case 'bc4':
      return 8;
    case 'bc2':
    case 'bc3':
    case 'bc5':
    case 'bc7':
      return 16;
    default:
      return 0;
  }
};

interface DdsMipLayout {
  offset: number;
  dataLength: number;
  width: number;
  height: number;
}

const readDdsMipLayouts = (
  bytes: Uint8Array,
  header: DdsHeader
): DdsMipLayout[] => {
  const blockBytes = blockBytesForFormat(header.format);
  const sourceBytesPerPixel = header.rgbBitCount / 8;
  let width = header.width;
  let height = header.height;
  let offset = header.dataOffset;
  const mipmaps: DdsMipLayout[] = [];

  for (let level = 0; level < header.mipMapCount; level += 1) {
    const dataLength = blockBytes > 0
      ? Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * blockBytes
      : width * height * sourceBytesPerPixel;
    if (!Number.isSafeInteger(dataLength) || dataLength < 1 || offset + dataLength > bytes.byteLength) {
      throw new Error('DDS texture payload is truncated.');
    }
    mipmaps.push({
      offset,
      dataLength,
      width,
      height
    });
    offset += dataLength;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }

  return mipmaps;
};

const rgb565 = (value: number): [number, number, number] => [
  Math.round(((value >> 11) & 0x1f) * 255 / 31),
  Math.round(((value >> 5) & 0x3f) * 255 / 63),
  Math.round((value & 0x1f) * 255 / 31)
];

const interpolate = (left: number, right: number, leftWeight: number, rightWeight: number, divisor: number) =>
  Math.round((left * leftWeight + right * rightWeight) / divisor);

const readMaskedChannel = (value: number, mask: number): number => {
  if (mask === 0) {
    return 255;
  }

  const shift = Math.clz32(mask & -mask) ^ 31;
  const maxValue = mask >>> shift;
  return Math.round(((value & mask) >>> shift) * 255 / maxValue);
};

const decodeColorBlock = (
  view: DataView,
  offset: number,
  forceFourColor: boolean
): Array<[number, number, number, number]> => {
  const color0 = view.getUint16(offset, true);
  const color1 = view.getUint16(offset + 2, true);
  const [r0, g0, b0] = rgb565(color0);
  const [r1, g1, b1] = rgb565(color1);
  const colors: Array<[number, number, number, number]> = [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    [0, 0, 0, 255],
    [0, 0, 0, 255]
  ];

  if (color0 > color1 || forceFourColor) {
    colors[2] = [
      interpolate(r0, r1, 2, 1, 3),
      interpolate(g0, g1, 2, 1, 3),
      interpolate(b0, b1, 2, 1, 3),
      255
    ];
    colors[3] = [
      interpolate(r0, r1, 1, 2, 3),
      interpolate(g0, g1, 1, 2, 3),
      interpolate(b0, b1, 1, 2, 3),
      255
    ];
  } else {
    colors[2] = [
      interpolate(r0, r1, 1, 1, 2),
      interpolate(g0, g1, 1, 1, 2),
      interpolate(b0, b1, 1, 1, 2),
      255
    ];
    colors[3] = [0, 0, 0, 0];
  }

  const indices = view.getUint32(offset + 4, true);
  return Array.from({ length: 16 }, (_, index) => colors[(indices >>> (index * 2)) & 0x3]);
};

const decodeBc4Values = (bytes: Uint8Array, offset: number): number[] => {
  const a0 = bytes[offset];
  const a1 = bytes[offset + 1];
  const palette = [a0, a1, 0, 0, 0, 0, 0, 0];
  if (a0 > a1) {
    for (let index = 2; index < 8; index += 1) {
      palette[index] = interpolate(a0, a1, 8 - index, index - 1, 7);
    }
  } else {
    for (let index = 2; index < 6; index += 1) {
      palette[index] = interpolate(a0, a1, 6 - index, index - 1, 5);
    }
    palette[6] = 0;
    palette[7] = 255;
  }

  let packed = 0n;
  for (let index = 0; index < 6; index += 1) {
    packed |= BigInt(bytes[offset + 2 + index]) << BigInt(index * 8);
  }

  return Array.from({ length: 16 }, (_, index) => {
    const paletteIndex = Number((packed >> BigInt(index * 3)) & 0x7n);
    return palette[paletteIndex];
  });
};

const writePixel = (
  target: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: [number, number, number, number]
) => {
  if (x >= width || y >= height) {
    return;
  }

  const targetOffset = (y * width + x) * 4;
  target[targetOffset] = color[0];
  target[targetOffset + 1] = color[1];
  target[targetOffset + 2] = color[2];
  target[targetOffset + 3] = color[3];
};

const decodeCompressedDds = (bytes: Uint8Array, header: DdsHeader): Uint8Array => {
  const { width, height, format, dataOffset } = header;
  const blockBytes = blockBytesForFormat(format);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const expectedBytes = blocksX * blocksY * blockBytes;
  if (dataOffset + expectedBytes > bytes.byteLength) {
    throw new Error('DDS texture payload is truncated.');
  }

  const rgba = new Uint8Array(width * height * 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let blockY = 0; blockY < blocksY; blockY += 1) {
    for (let blockX = 0; blockX < blocksX; blockX += 1) {
      const blockOffset = dataOffset + (blockY * blocksX + blockX) * blockBytes;
      let colors: Array<[number, number, number, number]>;

      if (format === 'bc1') {
        colors = decodeColorBlock(view, blockOffset, false);
      } else if (format === 'bc2') {
        colors = decodeColorBlock(view, blockOffset + 8, true).map((color, index) => {
          const alphaByte = bytes[blockOffset + Math.floor(index / 2)];
          const alpha = (index % 2 === 0 ? alphaByte & 0x0f : alphaByte >> 4) * 17;
          return [color[0], color[1], color[2], alpha] as [number, number, number, number];
        });
      } else if (format === 'bc3') {
        const alpha = decodeBc4Values(bytes, blockOffset);
        colors = decodeColorBlock(view, blockOffset + 8, true).map((color, index) => [
          color[0],
          color[1],
          color[2],
          alpha[index]
        ]);
      } else if (format === 'bc4') {
        const red = decodeBc4Values(bytes, blockOffset);
        colors = red.map((value) => [value, value, value, 255]);
      } else {
        const red = decodeBc4Values(bytes, blockOffset);
        const green = decodeBc4Values(bytes, blockOffset + 8);
        colors = red.map((value, index) => {
          const nx = value / 127.5 - 1;
          const ny = green[index] / 127.5 - 1;
          const blue = Math.round((Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * 0.5 + 0.5) * 255);
          return [value, green[index], blue, 255];
        });
      }

      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          writePixel(rgba, width, height, blockX * 4 + x, blockY * 4 + y, colors[y * 4 + x]);
        }
      }
    }
  }

  return rgba;
};

const decodeUncompressedDds = (bytes: Uint8Array, header: DdsHeader): Uint8Array => {
  const { width, height, dataOffset, rgbBitCount, rMask, gMask, bMask, aMask } = header;
  const sourceBytesPerPixel = rgbBitCount / 8;
  if (dataOffset + width * height * sourceBytesPerPixel > bytes.byteLength) {
    throw new Error('DDS texture payload is truncated.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sourceOffset = dataOffset + pixel * sourceBytesPerPixel;
    const value = sourceBytesPerPixel === 4
      ? view.getUint32(sourceOffset, true)
      : bytes[sourceOffset] | (bytes[sourceOffset + 1] << 8) | (bytes[sourceOffset + 2] << 16);
    const targetOffset = pixel * 4;
    rgba[targetOffset] = readMaskedChannel(value, rMask);
    rgba[targetOffset + 1] = readMaskedChannel(value, gMask);
    rgba[targetOffset + 2] = readMaskedChannel(value, bMask);
    rgba[targetOffset + 3] = (header.format === 'rgba32' || aMask !== 0) ? readMaskedChannel(value, aMask) : 255;
  }
  return rgba;
};

const formatFromDxgi = (dxgiFormat: number): DdsFormat | null => {
  switch (dxgiFormat) {
    case 71:
    case 72:
      return 'bc1';
    case 74:
    case 75:
      return 'bc2';
    case 77:
    case 78:
      return 'bc3';
    case 80:
    case 81:
      return 'bc4';
    case 83:
    case 84:
      return 'bc5';
    case 98:
    case 99:
      return 'bc7';
    default:
      return null;
  }
};

export const isDdsBuffer = (buffer: ArrayBuffer): boolean =>
  buffer.byteLength >= 4 && new DataView(buffer).getUint32(0, true) === DDS_MAGIC;

export const readDdsHeader = (buffer: ArrayBuffer): DdsHeader => {
  const view = new DataView(buffer);
  if (view.byteLength < 128 || view.getUint32(0, true) !== DDS_MAGIC) {
    throw new Error('DDS texture header is invalid.');
  }

  const headerSize = view.getUint32(4, true);
  if (headerSize !== 124) {
    throw new Error('DDS texture header size is unsupported.');
  }

  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const mipMapCount = Math.max(1, view.getUint32(28, true));
  const pixelFlags = view.getUint32(80, true);
  const fourCc = view.getUint32(84, true);
  const rgbBitCount = view.getUint32(88, true);
  const rMask = view.getUint32(92, true);
  const gMask = view.getUint32(96, true);
  const bMask = view.getUint32(100, true);
  const aMask = view.getUint32(104, true);
  let dataOffset = 128;
  let format: DdsFormat | null = null;

  if ((pixelFlags & DDPF_FOURCC) !== 0) {
    switch (fourCc) {
      case FOURCC_DXT1:
        format = 'bc1';
        break;
      case FOURCC_DXT3:
        format = 'bc2';
        break;
      case FOURCC_DXT5:
        format = 'bc3';
        break;
      case FOURCC_ATI1:
      case FOURCC_BC4U:
        format = 'bc4';
        break;
      case FOURCC_ATI2:
      case FOURCC_BC5U:
        format = 'bc5';
        break;
      case FOURCC_DX10: {
        if (view.byteLength < 148) {
          throw new Error('DDS DX10 texture header is truncated.');
        }
        format = formatFromDxgi(view.getUint32(128, true));
        dataOffset = 148;
        break;
      }
      default:
        format = null;
    }
  } else if ((pixelFlags & DDPF_RGB) !== 0 && rgbBitCount === 32 && (pixelFlags & DDPF_ALPHAPIXELS) !== 0) {
    format = 'rgba32';
  } else if ((pixelFlags & DDPF_RGB) !== 0 && rgbBitCount === 24) {
    format = 'rgb24';
  }

  if (!format || width < 1 || height < 1) {
    throw new Error('DDS texture format is unsupported.');
  }

  return {
    width,
    height,
    format,
    dataOffset,
    mipMapCount,
    rgbBitCount,
    rMask,
    gMask,
    bMask,
    aMask
  };
};

const configurePreviewTexture = (
  texture: THREE.Texture,
  options: DdsPreviewTextureOptions
): void => {
  texture.colorSpace = options.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false;
  texture.anisotropy = Math.min(Math.max(options.anisotropy ?? 1, 1), 8);
  texture.needsUpdate = true;
};

const createDataTexture = (
  rgba: Uint8Array,
  width: number,
  height: number,
  options: DdsPreviewTextureOptions
): THREE.DataTexture => {
  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  configurePreviewTexture(texture, options);
  return texture;
};

const threeCompressedFormat = (format: DdsFormat): THREE.CompressedPixelFormat => {
  switch (format) {
    case 'bc1':
      return THREE.RGBA_S3TC_DXT1_Format;
    case 'bc2':
      return THREE.RGBA_S3TC_DXT3_Format;
    case 'bc3':
      return THREE.RGBA_S3TC_DXT5_Format;
    case 'bc4':
      return THREE.RED_RGTC1_Format;
    case 'bc5':
      return THREE.RED_GREEN_RGTC2_Format;
    case 'bc7':
      return THREE.RGBA_BPTC_Format;
    default:
      throw new Error('DDS texture is not GPU-compressed.');
  }
};

const createCompressedTexture = (
  bytes: Uint8Array,
  header: DdsHeader,
  options: DdsPreviewTextureOptions
): THREE.CompressedTexture => {
  const mipmaps = readDdsMipLayouts(bytes, header).map((mip) => ({
    data: bytes.subarray(mip.offset, mip.offset + mip.dataLength),
    width: mip.width,
    height: mip.height
  }));

  const texture = new THREE.CompressedTexture(
    mipmaps,
    header.width,
    header.height,
    threeCompressedFormat(header.format)
  );
  texture.minFilter = mipmaps.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.generateMipmaps = false;
  configurePreviewTexture(texture, options);
  return texture;
};

const supportsCompressedFormat = (format: DdsFormat, support: DdsGpuSupport): boolean => {
  if (format === 'bc1' || format === 'bc2' || format === 'bc3') {
    return support.s3tc;
  }
  if (format === 'bc4' || format === 'bc5') {
    return support.rgtc;
  }
  return format === 'bc7' && support.bptc;
};

export const detectDdsGpuSupport = (renderer: THREE.WebGLRenderer): DdsGpuSupport => {
  const context = renderer.getContext();
  return {
    s3tc: Boolean(
      context.getExtension('WEBGL_compressed_texture_s3tc')
      || context.getExtension('MOZ_WEBGL_compressed_texture_s3tc')
      || context.getExtension('WEBKIT_WEBGL_compressed_texture_s3tc')
    ),
    rgtc: Boolean(context.getExtension('EXT_texture_compression_rgtc')),
    bptc: Boolean(context.getExtension('EXT_texture_compression_bptc'))
  };
};

export const createDdsPreviewTexture = (
  buffer: ArrayBuffer,
  options: DdsPreviewTextureOptions = {}
): THREE.Texture => {
  const header = readDdsHeader(buffer);
  const bytes = new Uint8Array(buffer);
  readDdsMipLayouts(bytes, header);
  const support = options.gpuSupport ?? {
    s3tc: false,
    rgtc: false,
    bptc: false
  };
  if (blockBytesForFormat(header.format) > 0 && supportsCompressedFormat(header.format, support)) {
    return createCompressedTexture(bytes, header, options);
  }
  if (header.format === 'bc7') {
    throw new Error('BC7 preview requires EXT_texture_compression_bptc.');
  }

  const rgba = options.decodedRgba ?? (header.format === 'rgb24' || header.format === 'rgba32'
    ? decodeUncompressedDds(bytes, header)
    : decodeCompressedDds(bytes, header));
  if (rgba.byteLength !== header.width * header.height * 4) {
    throw new Error('DDS decoded pixel payload has an invalid size.');
  }
  return createDataTexture(rgba, header.width, header.height, options);
};

export const createDecodedDdsPreviewTexture = (
  decoded: { width: number; height: number; rgba: Uint8Array },
  options: DdsPreviewTextureOptions = {}
): THREE.DataTexture => createDataTexture(
  decoded.rgba,
  decoded.width,
  decoded.height,
  options
);

export const decodeDdsBaseLevel = (buffer: ArrayBuffer): {
  width: number;
  height: number;
  rgba: Uint8Array;
} => {
  const header = readDdsHeader(buffer);
  if (header.format === 'bc7') {
    throw new Error('BC7 software decoding is unsupported.');
  }
  const bytes = new Uint8Array(buffer);
  readDdsMipLayouts(bytes, header);
  return {
    width: header.width,
    height: header.height,
    rgba: header.format === 'rgb24' || header.format === 'rgba32'
      ? decodeUncompressedDds(bytes, header)
      : decodeCompressedDds(bytes, header)
  };
};
