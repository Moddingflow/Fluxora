export interface WorkerNifMesh {
  name: string;
  previewCoordinates: true;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    radius: number;
  };
  positions: Float32Array;
  indices?: Uint32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  texturePath?: string;
  alpha?: number;
}

export interface WorkerNifModel {
  meshes: WorkerNifMesh[];
  texturePaths: string[];
  supportedBlocks: string[];
  warnings: string[];
}

export type NifPreviewWorkerRequest =
  | {
      type: 'parse-nif';
      requestId: number;
      generation: number;
      buffer: ArrayBuffer;
    }
  | {
      type: 'decode-dds';
      requestId: number;
      generation: number;
      buffer: ArrayBuffer;
    };

export type NifPreviewWorkerResponse =
  | {
      type: 'nif-parsed';
      requestId: number;
      generation: number;
      model: WorkerNifModel;
    }
  | {
      type: 'dds-decoded';
      requestId: number;
      generation: number;
      width: number;
      height: number;
      rgba: Uint8Array;
    }
  | {
      type: 'error';
      requestId: number;
      generation: number;
      message: string;
    };

export interface ParsedNifWorkerResult {
  generation: number;
  model: WorkerNifModel;
}

export interface DecodedDdsWorkerResult {
  generation: number;
  width: number;
  height: number;
  rgba: Uint8Array;
}
