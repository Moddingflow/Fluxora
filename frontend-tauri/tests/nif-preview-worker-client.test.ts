import { describe, expect, it } from 'vitest';

import { NifPreviewWorkerClient } from '../src/renderer/features/file-preview/nif-preview-worker-client';

type MessageListener = (event: MessageEvent) => void;

class FakeWorker {
  listener: MessageListener | null = null;
  posts: Array<{ message: Record<string, unknown>; transfer: Transferable[] }> = [];

  addEventListener(_type: 'message', listener: MessageListener) {
    this.listener = listener;
  }

  removeEventListener(_type: 'message', listener: MessageListener) {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  postMessage(message: Record<string, unknown>, transfer: Transferable[]) {
    this.posts.push({ message, transfer });
  }

  terminate() {}

  respond(data: Record<string, unknown>) {
    this.listener?.({ data } as MessageEvent);
  }
}

describe('NIF preview worker client', () => {
  it('transfers NIF ownership and resolves typed geometry without main-thread parsing', async () => {
    const worker = new FakeWorker();
    const client = new NifPreviewWorkerClient(worker);
    const buffer = new ArrayBuffer(32);
    const pending = client.parseNif(buffer, 7);
    const requestId = worker.posts[0].message.requestId as number;

    expect(worker.posts[0].message).toMatchObject({ type: 'parse-nif', generation: 7 });
    expect(worker.posts[0].transfer).toEqual([buffer]);

    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    worker.respond({
      type: 'nif-parsed',
      requestId,
      generation: 7,
      model: {
        meshes: [{ name: 'Triangle', positions, indices }],
        texturePaths: [],
        supportedBlocks: ['NiTriShape'],
        warnings: []
      }
    });

    const result = await pending;
    expect(result.generation).toBe(7);
    expect(result.model.meshes[0].positions).toBeInstanceOf(Float32Array);
    expect(result.model.meshes[0].indices).toBeInstanceOf(Uint32Array);
  });

  it('transfers DDS bytes and returns worker-decoded RGBA pixels', async () => {
    const worker = new FakeWorker();
    const client = new NifPreviewWorkerClient(worker);
    const buffer = new ArrayBuffer(16);
    const pending = client.decodeDds(buffer, 11);
    const requestId = worker.posts[0].message.requestId as number;
    const rgba = new Uint8Array([255, 0, 0, 255]);

    worker.respond({
      type: 'dds-decoded',
      requestId,
      generation: 11,
      width: 1,
      height: 1,
      rgba
    });

    await expect(pending).resolves.toMatchObject({ generation: 11, width: 1, height: 1, rgba });
    expect(worker.posts[0].transfer).toEqual([buffer]);
  });
});
