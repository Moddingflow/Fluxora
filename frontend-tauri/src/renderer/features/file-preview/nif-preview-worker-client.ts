import type {
  DecodedDdsWorkerResult,
  NifPreviewWorkerRequest,
  NifPreviewWorkerResponse,
  ParsedNifWorkerResult
} from './nif-preview-worker-protocol';

export interface NifPreviewWorkerPort {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<NifPreviewWorkerResponse>) => void
  ) => void;
  removeEventListener: (
    type: 'message',
    listener: (event: MessageEvent<NifPreviewWorkerResponse>) => void
  ) => void;
  postMessage: (message: NifPreviewWorkerRequest, transfer: Transferable[]) => void;
  terminate: () => void;
}

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

export class NifPreviewWorkerClient {
  private readonly worker: NifPreviewWorkerPort;
  private readonly pending = new Map<number, PendingRequest<unknown>>();
  private nextRequestId = 1;

  constructor(worker?: NifPreviewWorkerPort) {
    this.worker = worker ?? new Worker(
      new URL('./nif-preview.worker.ts', import.meta.url),
      { type: 'module', name: 'fluxora-nif-preview' }
    );
    this.worker.addEventListener('message', this.handleMessage);
  }

  parseNif(buffer: ArrayBuffer, generation: number): Promise<ParsedNifWorkerResult> {
    return this.request<ParsedNifWorkerResult>({
      type: 'parse-nif',
      requestId: this.nextRequestId,
      generation,
      buffer
    }, buffer);
  }

  decodeDds(buffer: ArrayBuffer, generation: number): Promise<DecodedDdsWorkerResult> {
    return this.request<DecodedDdsWorkerResult>({
      type: 'decode-dds',
      requestId: this.nextRequestId,
      generation,
      buffer
    }, buffer);
  }

  dispose(): void {
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.terminate();
    this.pending.forEach(({ reject }) => reject(new Error('NIF preview worker was disposed.')));
    this.pending.clear();
  }

  private request<T>(request: NifPreviewWorkerRequest, buffer: ArrayBuffer): Promise<T> {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject
      });
      this.worker.postMessage({ ...request, requestId } as NifPreviewWorkerRequest, [buffer]);
    });
  }

  private readonly handleMessage = (event: MessageEvent<NifPreviewWorkerResponse>): void => {
    const response = event.data;
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(response.requestId);
    if (response.type === 'error') {
      pending.reject(new Error(response.message));
      return;
    }
    if (response.type === 'nif-parsed') {
      pending.resolve({ generation: response.generation, model: response.model });
      return;
    }
    pending.resolve({
      generation: response.generation,
      width: response.width,
      height: response.height,
      rgba: response.rgba
    });
  };
}
