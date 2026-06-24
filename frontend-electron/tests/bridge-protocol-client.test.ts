import { describe, expect, it, vi } from 'vitest';

import {
  BridgeProtocolClient,
  BridgeRequestError,
  type BridgeTransport
} from '../src/main/bridge/protocol-client';
import type { ElectronLogService } from '../src/main/logging';

class InMemoryBridgeTransport implements BridgeTransport {
  readonly sent: string[] = [];
  private lineListener: ((line: string) => void) | null = null;
  private exitListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;

  async start(): Promise<void> {}

  send(line: string): void {
    this.sent.push(line);
    const request = JSON.parse(line) as {
      id: string;
      method: string;
      meta: { operationId?: string };
    };

    if (request.method === 'system.fail') {
      this.lineListener?.(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: 'core.failed',
            message: 'Core failed.',
            category: 'core',
            retryable: false,
            capabilityId: null,
            details: {}
          },
          meta: { operationId: request.meta.operationId, durationMs: 1 }
        })
      );
      return;
    }

    if (request.method === 'system.pending') {
      return;
    }

    this.lineListener?.(
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          ok: true,
          data: {
            method: request.method,
            operationId: request.meta.operationId
          }
        },
        meta: { operationId: request.meta.operationId, durationMs: 1 }
      })
    );
  }

  async stop(): Promise<void> {
    this.exitListener?.(0, null);
  }

  onLine(listener: (line: string) => void): void {
    this.lineListener = listener;
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.exitListener = listener;
  }

  onError(listener: (error: Error) => void): void {
    this.errorListener = listener;
  }

  emitError(error: Error): void {
    this.errorListener?.(error);
  }

  emitLine(line: string): void {
    this.lineListener?.(line);
  }
}

const createLogger = (): ElectronLogService =>
  ({
    write: vi.fn(async () => undefined)
  }) as unknown as ElectronLogService;

describe('BridgeProtocolClient', () => {
  it('sends JSON-RPC requests with operation metadata', async () => {
    const transport = new InMemoryBridgeTransport();
    const client = new BridgeProtocolClient(
      transport,
      { appVersion: '0.0.0-test', locale: 'ru-RU' },
      createLogger()
    );

    const reply = await client.request<{ method: string; operationId: string }>(
      'system.handshake',
      { supportedProtocolVersions: ['1.0'] },
      { operationId: 'op_test_1' }
    );

    expect(reply.data).toEqual({
      method: 'system.handshake',
      operationId: 'op_test_1'
    });

    const sent = JSON.parse(transport.sent[0]) as {
      method: string;
      params: { supportedProtocolVersions: string[] };
      meta: { operationId: string; requestSource: string; appVersion: string; locale: string };
    };
    expect(sent.method).toBe('system.handshake');
    expect(sent.params.supportedProtocolVersions).toEqual(['1.0']);
    expect(sent.meta).toMatchObject({
      operationId: 'op_test_1',
      requestSource: 'electron-main',
      appVersion: '0.0.0-test',
      locale: 'ru-RU'
    });
  });

  it('maps host error envelopes to BridgeRequestError', async () => {
    const client = new BridgeProtocolClient(
      new InMemoryBridgeTransport(),
      { appVersion: '0.0.0-test', locale: 'ru-RU' },
      createLogger()
    );

    await expect(
      client.request('system.fail', {}, { operationId: 'op_test_error' })
    ).rejects.toMatchObject({
      name: 'BridgeRequestError',
      bridgeError: {
        code: 'core.failed',
        message: 'Core failed.',
        category: 'core',
        retryable: false,
        capabilityId: null,
        details: {}
      },
      operationId: 'op_test_error'
    });
  });

  it('routes host events to typed listeners without resolving a request', async () => {
    const transport = new InMemoryBridgeTransport();
    const client = new BridgeProtocolClient(
      transport,
      { appVersion: '0.0.0-test', locale: 'ru-RU' },
      createLogger()
    );
    const events: unknown[] = [];
    client.onEvent('operations.progress', (event) => events.push(event));

    await client.start();
    transport.emitLine(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'operations.progress',
        params: { phase: 'copying', overallPercent: 40 },
        meta: { operationId: 'op_progress' }
      })
    );

    expect(events).toEqual([
      {
        method: 'operations.progress',
        params: { phase: 'copying', overallPercent: 40 },
        operationId: 'op_progress'
      }
    ]);
  });

  it('refreshes a pending request timeout when matching operation progress arrives', async () => {
    vi.useFakeTimers();

    try {
      const transport = new InMemoryBridgeTransport();
      const client = new BridgeProtocolClient(
        transport,
        { appVersion: '0.0.0-test', locale: 'ru-RU' },
        createLogger(),
        20
      );

      const replyPromise = client.request<{ completed: boolean }>(
        'system.pending',
        {},
        { operationId: 'op_keepalive' }
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(transport.sent).toHaveLength(1);
      const sent = JSON.parse(transport.sent[0]) as { id: string };
      await vi.advanceTimersByTimeAsync(15);
      transport.emitLine(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'operations.progress',
          params: { phase: 'copying', overallPercent: 12 },
          meta: { operationId: 'op_keepalive' }
        })
      );

      await vi.advanceTimersByTimeAsync(15);
      transport.emitLine(
        JSON.stringify({
          jsonrpc: '2.0',
          id: sent.id,
          result: {
            ok: true,
            data: { completed: true }
          },
          meta: { operationId: 'op_keepalive', durationMs: 30 }
        })
      );

      await expect(replyPromise).resolves.toEqual({
        data: { completed: true },
        operationId: 'op_keepalive'
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
