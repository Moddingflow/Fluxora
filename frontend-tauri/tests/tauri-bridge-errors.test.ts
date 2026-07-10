import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperationRequest } from '../src/shared/fluxora-api';
import {
  createTauriFluxoraApi,
  FluxoraBridgeError
} from '../src/tauri/fluxora-api';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
const onDragDropEventMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: onDragDropEventMock
  })
}));

type TauriTestWindow = Window & {
  __TAURI_INTERNALS__: Record<string, never>;
};

let originalWindowDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} } as TauriTestWindow
  });
  invokeMock.mockReset();
  listenMock.mockReset();
  onDragDropEventMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

describe('Tauri bridge error contract', () => {
  it('preserves the native JSON-RPC error envelope as a typed Error', async () => {
    const request: OperationRequest = { operationId: 'op_project_open_42' };
    invokeMock.mockRejectedValue(
      JSON.stringify({
        schema: 'fluxora.tauri.bridge-error.v1',
        method: 'projects.openConfig',
        operationId: request.operationId,
        error: {
          code: 'core.projectOpenFailed',
          message: 'The selected build could not be opened.',
          category: 'core',
          retryable: true,
          capabilityId: 'projects.openConfig',
          details: {
            configPath: 'C:/Builds/Foundation/fluxora.json',
            attempt: 2
          }
        }
      })
    );

    const api = createTauriFluxoraApi();
    const rejection = api.projects.openConfig(
      'C:/Builds/Foundation/fluxora.json',
      request
    );

    await expect(rejection).rejects.toBeInstanceOf(FluxoraBridgeError);
    await expect(rejection).rejects.toMatchObject({
      name: 'FluxoraBridgeError',
      message: 'The selected build could not be opened.',
      code: 'core.projectOpenFailed',
      category: 'core',
      retryable: true,
      capabilityId: 'projects.openConfig',
      details: {
        configPath: 'C:/Builds/Foundation/fluxora.json',
        attempt: 2
      },
      method: 'projects.openConfig',
      operationId: 'op_project_open_42'
    });
  });

  it('parses a versioned bridge envelope from Error.message', async () => {
    const request: OperationRequest = { operationId: 'op_project_open_error_object' };
    invokeMock.mockRejectedValue(
      new Error(
        JSON.stringify({
          schema: 'fluxora.tauri.bridge-error.v1',
          method: 'projects.openConfig',
          operationId: request.operationId,
          error: {
            code: 'core.projectOpenFailed',
            message: 'The Error-wrapped build could not be opened.',
            category: 'core',
            retryable: true,
            capabilityId: 'projects.openConfig',
            details: { source: 'Error.message' }
          }
        })
      )
    );

    const rejection = createTauriFluxoraApi().projects.openConfig(
      'C:/Builds/Foundation/fluxora.json',
      request
    );

    await expect(rejection).rejects.toMatchObject({
      message: 'The Error-wrapped build could not be opened.',
      code: 'core.projectOpenFailed',
      category: 'core',
      retryable: true,
      details: { source: 'Error.message' },
      method: 'projects.openConfig',
      operationId: 'op_project_open_error_object'
    });
  });

  it('parses a versioned bridge envelope from a message-bearing rejection object', async () => {
    const request: OperationRequest = { operationId: 'op_project_open_message_object' };
    invokeMock.mockRejectedValue({
      message: JSON.stringify({
        schema: 'fluxora.tauri.bridge-error.v1',
        method: 'projects.openConfig',
        operationId: request.operationId,
        error: {
          code: 'capability.projectOpenUnavailable',
          message: 'Opening this build is unavailable.',
          category: 'capability',
          retryable: false,
          capabilityId: 'projects.openConfig',
          details: { source: 'message-object' }
        }
      })
    });

    const rejection = createTauriFluxoraApi().projects.openConfig(
      'C:/Builds/Foundation/fluxora.json',
      request
    );

    await expect(rejection).rejects.toMatchObject({
      message: 'Opening this build is unavailable.',
      code: 'capability.projectOpenUnavailable',
      category: 'capability',
      retryable: false,
      capabilityId: 'projects.openConfig',
      details: { source: 'message-object' },
      method: 'projects.openConfig',
      operationId: 'op_project_open_message_object'
    });
  });

  it('wraps a legacy string rejection without losing its user-friendly message', async () => {
    const request: OperationRequest = { operationId: 'op_project_open_legacy' };
    invokeMock.mockRejectedValue('Bridge host exited before replying.');

    const rejection = createTauriFluxoraApi().projects.openConfig(
      'C:/Builds/Foundation/fluxora.json',
      request
    );

    await expect(rejection).rejects.toBeInstanceOf(FluxoraBridgeError);
    await expect(rejection).rejects.toMatchObject({
      message: 'Bridge host exited before replying.',
      code: 'bridge.requestFailed',
      category: 'transport',
      retryable: false,
      capabilityId: null,
      details: {},
      method: 'projects.openConfig',
      operationId: 'op_project_open_legacy'
    });
  });

  it('falls back safely when a versioned rejection is malformed', async () => {
    const request: OperationRequest = { operationId: 'op_project_open_malformed' };
    invokeMock.mockRejectedValue(
      '{"schema":"fluxora.tauri.bridge-error.v1","error":{"message":"truncated"}'
    );

    const rejection = createTauriFluxoraApi().projects.openConfig(
      'C:/Builds/Foundation/fluxora.json',
      request
    );

    await expect(rejection).rejects.toMatchObject({
      message: 'Native bridge request failed.',
      code: 'bridge.requestFailed',
      method: 'projects.openConfig',
      operationId: 'op_project_open_malformed'
    });
  });
});
