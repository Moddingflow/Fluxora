import type { NativeBridgeError, OperationRequest } from '../../shared/fluxora-api';
import type { ElectronLogService } from '../logging';

export interface BridgeTransport {
  start: () => Promise<void>;
  send: (line: string) => void;
  stop: () => Promise<void> | void;
  onLine: (listener: (line: string) => void) => void;
  onExit: (listener: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
  onError: (listener: (error: Error) => void) => void;
}

export interface BridgeProtocolMetadata {
  appVersion: string;
  locale: string;
}

export interface BridgeReply<T> {
  data: T;
  operationId?: string;
}

export interface BridgeEvent<T = unknown> {
  method: string;
  params: T;
  operationId?: string;
}

interface PendingRequest {
  resolve: (reply: BridgeReply<unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  method: string;
  operationId?: string;
  timeoutMs: number;
}

export interface BridgeRequestOptions {
  timeoutMs?: number;
}

interface BridgeEnvelope {
  id?: string;
  method?: string;
  params?: unknown;
  result?: {
    ok?: boolean;
    data?: unknown;
  };
  error?: NativeBridgeError;
  meta?: {
    operationId?: string;
    durationMs?: number;
  };
}

const normalizedTimeoutMs = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

const operationIdFromParams = (params: unknown): string | undefined => {
  if (!params || typeof params !== 'object') {
    return undefined;
  }

  const operationId = (params as { operationId?: unknown }).operationId;
  return typeof operationId === 'string' && operationId.length > 0 ? operationId : undefined;
};

const operationIdFromEnvelope = (envelope: BridgeEnvelope): string | undefined => {
  const operationId = envelope.meta?.operationId;
  return typeof operationId === 'string' && operationId.length > 0
    ? operationId
    : operationIdFromParams(envelope.params);
};

export class BridgeRequestError extends Error {
  constructor(
    readonly bridgeError: NativeBridgeError,
    readonly operationId?: string
  ) {
    super(bridgeError.message);
    this.name = 'BridgeRequestError';
  }
}

export const createTransportError = (
  code: string,
  message: string,
  retryable = true
): NativeBridgeError => ({
  code,
  message,
  category: 'transport',
  retryable,
  capabilityId: null,
  details: {}
});

export class BridgeProtocolClient {
  private nextId = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Map<string, Set<(event: BridgeEvent) => void>>();
  private started = false;

  constructor(
    private readonly transport: BridgeTransport,
    private readonly metadata: BridgeProtocolMetadata,
    private readonly logger: ElectronLogService,
    private readonly timeoutMs = 10000
  ) {
    this.transport.onLine((line) => this.handleLine(line));
    this.transport.onExit((code, signal) => this.handleExit(code, signal));
    this.transport.onError((error) => this.handleTransportError(error));
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    await this.transport.start();
    this.started = true;
  }

  async request<T>(
    method: string,
    params: Record<string, unknown> = {},
    request: OperationRequest = {},
    options: BridgeRequestOptions = {}
  ): Promise<BridgeReply<T>> {
    await this.start();

    const id = `req_${Date.now()}_${++this.nextId}`;
    const operationId = request.operationId;
    const timeoutMs = normalizedTimeoutMs(options.timeoutMs, this.timeoutMs);
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params,
      meta: {
        protocolVersion: '1.0',
        operationId,
        requestSource: 'electron-main',
        appVersion: this.metadata.appVersion,
        platform: process.platform,
        arch: process.arch,
        locale: this.metadata.locale
      }
    };

    await this.logger.write('main-bridge', 'debug', 'BridgeClient', `request ${method}`, operationId);

    return new Promise<BridgeReply<T>>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (reply) => resolve(reply as BridgeReply<T>),
        reject,
        timeout: this.createRequestTimeout(id, method, operationId, timeoutMs, reject),
        method,
        operationId,
        timeoutMs
      });

      try {
        this.transport.send(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timeout);
        }
        this.pending.delete(id);
        reject(
          new BridgeRequestError(
            createTransportError(
              'bridge.sendFailed',
              error instanceof Error ? error.message : 'Failed to send bridge request.'
            ),
            operationId
          )
        );
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.transport.stop();
    this.started = false;
  }

  onEvent(method: string, listener: (event: BridgeEvent) => void): () => void {
    const listeners = this.eventListeners.get(method) ?? new Set<(event: BridgeEvent) => void>();
    listeners.add(listener);
    this.eventListeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.eventListeners.delete(method);
      }
    };
  }

  private handleLine(line: string): void {
    let envelope: BridgeEnvelope;
    try {
      envelope = JSON.parse(line) as BridgeEnvelope;
    } catch {
      void this.logger.write('main-bridge', 'warning', 'BridgeClient', 'ignored malformed host line');
      return;
    }

    if (!envelope.id) {
      const operationId = operationIdFromEnvelope(envelope);
      this.refreshPendingForOperation(operationId);
      if (envelope.method) {
        this.emitEvent({
          method: envelope.method,
          params: envelope.params,
          operationId
        });
        return;
      }

      void this.logger.write('main-bridge', 'debug', 'BridgeClient', 'ignored host event');
      return;
    }

    const pending = this.pending.get(envelope.id);
    if (!pending) {
      void this.logger.write('main-bridge', 'warning', 'BridgeClient', `unexpected response ${envelope.id}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(envelope.id);

    if (envelope.error) {
      pending.reject(new BridgeRequestError(envelope.error, envelope.meta?.operationId));
      return;
    }

    if (!envelope.result?.ok) {
      pending.reject(
        new BridgeRequestError(
          createTransportError('bridge.invalidEnvelope', 'Bridge response did not include an ok result.', false),
          envelope.meta?.operationId
        )
      );
      return;
    }

    pending.resolve({
      data: envelope.result.data,
      operationId: envelope.meta?.operationId
    });
  }

  private createRequestTimeout(
    id: string,
    method: string,
    operationId: string | undefined,
    timeoutMs: number,
    reject: (error: Error) => void
  ): NodeJS.Timeout {
    return setTimeout(() => {
      this.pending.delete(id);
      reject(
        new BridgeRequestError(
          createTransportError('bridge.timeout', `Bridge request timed out: ${method}`),
          operationId
        )
      );
    }, timeoutMs);
  }

  private refreshPendingForOperation(operationId?: string): void {
    if (!operationId) {
      return;
    }

    for (const [id, pending] of this.pending) {
      if (pending.operationId !== operationId) {
        continue;
      }

      clearTimeout(pending.timeout);
      pending.timeout = this.createRequestTimeout(
        id,
        pending.method,
        pending.operationId,
        pending.timeoutMs,
        pending.reject
      );
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.started = false;
    const error = new BridgeRequestError(
      createTransportError('bridge.hostExited', `Bridge host exited. code=${code ?? 'null'} signal=${signal ?? 'null'}`),
      undefined
    );
    this.rejectAll(error);
  }

  private handleTransportError(error: Error): void {
    this.started = false;
    this.rejectAll(
      new BridgeRequestError(createTransportError('bridge.transportError', error.message), undefined)
    );
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }

    this.pending.clear();
  }

  private emitEvent(event: BridgeEvent): void {
    const listeners = this.eventListeners.get(event.method);
    if (!listeners || listeners.size === 0) {
      void this.logger.write('main-bridge', 'debug', 'BridgeClient', `ignored host event ${event.method}`);
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }
}
