import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  createDdsPreviewTexture,
  isDdsBuffer,
  readDdsHeader
} from '../src/renderer/features/file-preview/dds-texture';

const DDS_MAGIC = 0x20534444;
const FOURCC_DXT1 = 0x31545844;
const FOURCC_DX10 = 0x30315844;

const createDdsFixture = (
  options: {
    width?: number;
    height?: number;
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
  view.setUint32(28, 1, true);
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

    const texture = createDdsPreviewTexture(buffer) as THREE.CompressedTexture;

    expect(texture.isCompressedTexture).toBe(true);
    expect(texture.format).toBe(THREE.RGBA_BPTC_Format);
    expect(texture.mipmaps[0].data).toHaveLength(16);
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
