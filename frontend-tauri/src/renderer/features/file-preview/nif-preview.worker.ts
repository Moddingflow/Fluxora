/// <reference lib="webworker" />

import { handleNifPreviewWorkerRequest } from './nif-preview-worker-handler';
import type { NifPreviewWorkerRequest } from './nif-preview-worker-protocol';

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener('message', (event: MessageEvent<NifPreviewWorkerRequest>) => {
  const { response, transfer } = handleNifPreviewWorkerRequest(event.data);
  workerScope.postMessage(response, transfer);
});

export {};
