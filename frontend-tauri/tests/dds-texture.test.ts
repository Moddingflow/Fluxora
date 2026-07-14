import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  createDdsPreviewTexture,
  isDdsBuffer,
  readDdsHeader
} from '../src/renderer/features/file-preview/dds-texture';

const DDS_MAGIC = 0x20534444;
const FOURCC_DXT1 = 0x31545844;
const FOURCC_DXT3 = 0x33545844;
const FOURCC_DXT5 = 0x35545844;
const FOURCC_ATI1 = 0x31495441;
const FOURCC_ATI2 = 0x32495441;
const FOURCC_DX10 = 0x30315844;

const createDdsFixture = (
  options: {
    width?: number;
    height?: number;
    mipMapCount?: number;
    fourCc: number;
    dxgiFormat?: number;
    payload: Uint8Array;
  }
): ArrayBuffer => {
  const width = options.width ?? 4;
  const height = options.height ?? 4;
  const headerSize = options.dxgiFormat === undefined ? 128 : 148;
  const bytes = new Uint8Array(headerSize + options.payload.byteLength);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, DDS_MAGIC, true);
  view.setUint32(4, 124, true);
  view.setUint32(8, 0x00001007, true);
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(20, options.payload.byteLength, true);
  view.setUint32(28, options.mipMapCount ?? 1, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, 0x4, true);
  view.setUint32(84, options.fourCc, true);
  view.setUint32(108, 0x1000, true);

  if (options.dxgiFormat !== undefined) {
    view.setUint32(128, options.dxgiFormat, true);
    view.setUint32(132, 3, true);
    view.setUint32(140, 1, true);
  }

  bytes.set(options.payload, headerSize);
  return bytes.buffer;
};

describe('dds texture preview loader', () => {
  it('decodes DXT1 DDS payloads into uploadable RGBA data textures', () => {
    const payload = new Uint8Array(8);
    const payloadView = new DataView(payload.buffer);
    payloadView.setUint16(0, 0xf800, true);
    payloadView.setUint16(2, 0x07e0, true);
    payloadView.setUint32(4, 0, true);
    const buffer = createDdsFixture({ fourCc: FOURCC_DXT1, payload });

    expect(isDdsBuffer(buffer)).toBe(true);
    expect(readDdsHeader(buffer)).toMatchObject({ width: 4, height: 4, format: 'bc1' });

    const texture = createDdsPreviewTexture(buffer) as THREE.DataTexture;
    const pixels = texture.image.data as Uint8Array;

    expect(texture.isDataTexture).toBe(true);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(Array.from(pixels.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it('maps DX10 BC7 DDS payloads to Three BPTC compressed textures', () => {
    const buffer = createDdsFixture({
      fourCc: FOURCC_DX10,
      dxgiFormat: 98,
      payload: new Uint8Array(16)
    });

    const texture = createDdsPreviewTexture(buffer, {
      gpuSupport: { s3tc: false, rgtc: false, bptc: true }
    }) as THREE.CompressedTexture;

    expect(texture.isCompressedTexture).toBe(true);
    expect(texture.format).toBe(THREE.RGBA_BPTC_Format);
    expect(texture.mipmaps[0].data).toHaveLength(16);
  });

  it('preserves the complete source mip chain for GPU-compressed textures', () => {
    const buffer = createDdsFixture({
      width: 8,
      height: 8,
      mipMapCount: 4,
      fourCc: FOURCC_DX10,
      dxgiFormat: 98,
      payload: new Uint8Array(64 + 16 + 16 + 16)
    });

    const texture = createDdsPreviewTexture(buffer, {
      gpuSupport: { s3tc: false, rgtc: false, bptc: true }
    }) as THREE.CompressedTexture;

    expect(readDdsHeader(buffer).mipMapCount).toBe(4);
    expect(texture.mipmaps.map((mip) => [mip.width, mip.height, mip.data.byteLength])).toEqual([
      [8, 8, 64],
      [4, 4, 16],
      [2, 2, 16],
      [1, 1, 16]
    ]);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  });

  it('uploads BC1 through S3TC when the WebGL extension is available', () => {
    const buffer = createDdsFixture({
      width: 8,
      height: 8,
      mipMapCount: 2,
      fourCc: FOURCC_DXT1,
      payload: new Uint8Array(32 + 8)
    });

    const texture = createDdsPreviewTexture(buffer, {
      gpuSupport: { s3tc: true, rgtc: false, bptc: false },
      anisotropy: 8
    }) as THREE.CompressedTexture;

    expect(texture.isCompressedTexture).toBe(true);
    expect(texture.format).toBe(THREE.RGBA_S3TC_DXT1_Format);
    expect(texture.mipmaps).toHaveLength(2);
    expect(texture.anisotropy).toBe(8);
  });

  it.each([
    ['bc2', FOURCC_DXT3, { s3tc: true, rgtc: false, bptc: false }, THREE.RGBA_S3TC_DXT3_Format, 16],
    ['bc3', FOURCC_DXT5, { s3tc: true, rgtc: false, bptc: false }, THREE.RGBA_S3TC_DXT5_Format, 16],
    ['bc4', FOURCC_ATI1, { s3tc: false, rgtc: true, bptc: false }, THREE.RED_RGTC1_Format, 8],
    ['bc5', FOURCC_ATI2, { s3tc: false, rgtc: true, bptc: false }, THREE.RED_GREEN_RGTC2_Format, 16]
  ] as const)(
    'uploads %s with its matching compressed texture extension',
    (format, fourCc, gpuSupport, expectedFormat, payloadBytes) => {
      const buffer = createDdsFixture({ fourCc, payload: new Uint8Array(payloadBytes) });

      const texture = createDdsPreviewTexture(buffer, { gpuSupport }) as THREE.CompressedTexture;

      expect(readDdsHeader(buffer).format).toBe(format);
      expect(texture.isCompressedTexture).toBe(true);
      expect(texture.format).toBe(expectedFormat);
      expect(texture.generateMipmaps).toBe(false);
    }
  );

  it('uses a GPU-mipmapped data texture for BC1-BC5 software fallback', () => {
    const buffer = createDdsFixture({
      fourCc: FOURCC_ATI2,
      payload: new Uint8Array(16)
    });
    const decodedRgba = new Uint8Array(4 * 4 * 4);

    const texture = createDdsPreviewTexture(buffer, {
      gpuSupport: { s3tc: false, rgtc: false, bptc: false },
      decodedRgba,
      anisotropy: 32,
      srgb: false
    }) as THREE.DataTexture;

    expect(texture.isDataTexture).toBe(true);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.flipY).toBe(false);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(texture.anisotropy).toBe(8);
  });

  it('keeps BC7 neutral when BPTC is unavailable instead of assuming support', () => {
    const buffer = createDdsFixture({
      fourCc: FOURCC_DX10,
      dxgiFormat: 98,
      payload: new Uint8Array(16)
    });

    expect(() => createDdsPreviewTexture(buffer)).toThrow(
      'BC7 preview requires EXT_texture_compression_bptc.'
    );
  });

  it('validates every declared mip before software fallback decoding', () => {
    const buffer = createDdsFixture({
      width: 8,
      height: 8,
      mipMapCount: 2,
      fourCc: FOURCC_DXT1,
      payload: new Uint8Array(32)
    });

    expect(() => createDdsPreviewTexture(buffer, {
      gpuSupport: { s3tc: false, rgtc: false, bptc: false }
    })).toThrow('DDS texture payload is truncated.');
  });

  it('keeps a 4K BC3 fixture compressed with its full source mip chain', () => {
    const mipMapCount = 13;
    let width = 4096;
    let height = 4096;
    let payloadBytes = 0;
    for (let level = 0; level < mipMapCount; level += 1) {
      payloadBytes += Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * 16;
      width = Math.max(1, Math.floor(width / 2));
      height = Math.max(1, Math.floor(height / 2));
    }
    const buffer = createDdsFixture({
      width: 4096,
      height: 4096,
      mipMapCount,
      fourCc: FOURCC_DXT5,
      payload: new Uint8Array(payloadBytes)
    });

    const texture = createDdsPreviewTexture(buffer, {
      gpuSupport: { s3tc: true, rgtc: false, bptc: false }
    }) as THREE.CompressedTexture;

    expect(texture.isCompressedTexture).toBe(true);
    expect(texture.format).toBe(THREE.RGBA_S3TC_DXT5_Format);
    expect(texture.mipmaps).toHaveLength(mipMapCount);
    expect(texture.mipmaps[0]).toMatchObject({ width: 4096, height: 4096 });
    expect(texture.mipmaps.at(-1)).toMatchObject({ width: 1, height: 1 });
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.mipmaps[0].data.buffer).toBe(buffer);
    texture.dispose();
  });

  it('rejects unsupported DDS compression formats before renderer upload', () => {
    const buffer = createDdsFixture({
      fourCc: FOURCC_DX10,
      dxgiFormat: 999,
      payload: new Uint8Array(16)
    });

    expect(() => createDdsPreviewTexture(buffer)).toThrow('DDS texture format is unsupported.');
  });
});
