import { decodeDdsBaseLevel } from './dds-texture';
import { parseNifModel } from './nif-parser';
import { encodeNifModelForTransfer } from './nif-preview-worker-codec';
import type {
  NifPreviewWorkerRequest,
  NifPreviewWorkerResponse
} from './nif-preview-worker-protocol';

export interface NifPreviewWorkerDispatch {
  response: NifPreviewWorkerResponse;
  transfer: Transferable[];
}

export const handleNifPreviewWorkerRequest = (
  request: NifPreviewWorkerRequest
): NifPreviewWorkerDispatch => {
  try {
    if (request.type === 'parse-nif') {
      const { model, transfer } = encodeNifModelForTransfer(parseNifModel(request.buffer));
      return {
        response: {
          type: 'nif-parsed',
          requestId: request.requestId,
          generation: request.generation,
          model
        },
        transfer
      };
    }

    const decoded = decodeDdsBaseLevel(request.buffer);
    return {
      response: {
        type: 'dds-decoded',
        requestId: request.requestId,
        generation: request.generation,
        width: decoded.width,
        height: decoded.height,
        rgba: decoded.rgba
      },
      transfer: [decoded.rgba.buffer]
    };
  } catch (error) {
    return {
      response: {
        type: 'error',
        requestId: request.requestId,
        generation: request.generation,
        message: error instanceof Error ? error.message : 'Preview worker failed.'
      },
      transfer: []
    };
  }
};
