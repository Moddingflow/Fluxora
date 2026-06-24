import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

import type { BridgeTransport } from './protocol-client';

export class ChildProcessBridgeTransport implements BridgeTransport {
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly lineListeners = new Set<(line: string) => void>();
  private readonly exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  constructor(private readonly hostPath: string) {}

  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    this.process = spawn(this.hostPath, [], {
      stdio: 'pipe',
      windowsHide: true
    });

    const stdout = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity
    });

    stdout.on('line', (line) => {
      for (const listener of this.lineListeners) {
        listener(line);
      }
    });

    this.process.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim();
      if (message.length === 0) {
        return;
      }

      for (const listener of this.lineListeners) {
        listener(JSON.stringify({
          jsonrpc: '2.0',
          method: 'bridge.stderr',
          params: { message }
        }));
      }
    });

    this.process.on('exit', (code, signal) => {
      this.process = null;
      stdout.close();
      for (const listener of this.exitListeners) {
        listener(code, signal);
      }
    });

    this.process.on('error', (error) => {
      for (const listener of this.errorListeners) {
        listener(error);
      }
    });
  }

  send(line: string): void {
    if (!this.process?.stdin.writable) {
      throw new Error('Bridge host stdin is not writable.');
    }

    this.process.stdin.write(line, 'utf8');
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.process.stdin.end();
    this.process.kill();
    this.process = null;
  }

  onLine(listener: (line: string) => void): void {
    this.lineListeners.add(listener);
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.exitListeners.add(listener);
  }

  onError(listener: (error: Error) => void): void {
    this.errorListeners.add(listener);
  }
}
