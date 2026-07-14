import type * as THREE from 'three';

interface NifPreviewResourceCacheOptions {
  maxTextures: number;
  maxRawBytes: number;
}

const defaultOptions: NifPreviewResourceCacheOptions = {
  maxTextures: 64,
  maxRawBytes: 256 * 1024 * 1024
};

export class NifPreviewResourceCache {
  private readonly maxTextures: number;
  private readonly maxRawBytes: number;
  private readonly raw = new Map<string, ArrayBuffer>();
  private readonly textures = new Map<string, THREE.Texture>();
  private totalRawBytes = 0;

  constructor(options: Partial<NifPreviewResourceCacheOptions> = {}) {
    this.maxTextures = Math.max(0, options.maxTextures ?? defaultOptions.maxTextures);
    this.maxRawBytes = Math.max(0, options.maxRawBytes ?? defaultOptions.maxRawBytes);
  }

  get rawBytes(): number {
    return this.totalRawBytes;
  }

  get textureCount(): number {
    return this.textures.size;
  }

  getRaw(contentKey: string): ArrayBuffer | undefined {
    const buffer = this.raw.get(contentKey);
    if (!buffer) {
      return undefined;
    }
    this.raw.delete(contentKey);
    this.raw.set(contentKey, buffer);
    return buffer;
  }

  setRaw(contentKey: string, buffer: ArrayBuffer): void {
    const previous = this.raw.get(contentKey);
    if (previous) {
      this.totalRawBytes -= previous.byteLength;
      this.raw.delete(contentKey);
    }
    this.raw.set(contentKey, buffer);
    this.totalRawBytes += buffer.byteLength;
    while (this.totalRawBytes > this.maxRawBytes && this.raw.size > 0) {
      const oldestKey = this.raw.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      const oldest = this.raw.get(oldestKey);
      this.raw.delete(oldestKey);
      this.totalRawBytes -= oldest?.byteLength ?? 0;
    }
  }

  takeRaw(contentKey: string): ArrayBuffer | undefined {
    const buffer = this.raw.get(contentKey);
    if (!buffer) {
      return undefined;
    }
    this.raw.delete(contentKey);
    this.totalRawBytes -= buffer.byteLength;
    return buffer;
  }

  getTexture(contentKey: string): THREE.Texture | undefined {
    const texture = this.textures.get(contentKey);
    if (!texture) {
      return undefined;
    }
    this.textures.delete(contentKey);
    this.textures.set(contentKey, texture);
    return texture;
  }

  setTexture(contentKey: string, texture: THREE.Texture): void {
    const previous = this.textures.get(contentKey);
    if (previous && previous !== texture) {
      previous.dispose();
    }
    this.textures.delete(contentKey);
    this.textures.set(contentKey, texture);
    while (this.textures.size > this.maxTextures) {
      const oldestKey = this.textures.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      const oldest = this.textures.get(oldestKey);
      this.textures.delete(oldestKey);
      oldest?.dispose();
    }
  }

  dispose(): void {
    const disposed = new Set<THREE.Texture>();
    this.textures.forEach((texture) => {
      if (!disposed.has(texture)) {
        disposed.add(texture);
        texture.dispose();
      }
    });
    this.textures.clear();
    this.raw.clear();
    this.totalRawBytes = 0;
  }
}
