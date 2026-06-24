import fs from 'node:fs/promises';
import path from 'node:path';

import type { FluxoraLogLevel } from '../shared/fluxora-api';

type ElectronLogChannel = 'ui' | 'main-bridge';

const channelFileNames: Record<ElectronLogChannel, string> = {
  ui: 'fluxora-electron-ui',
  'main-bridge': 'fluxora-electron-main-bridge'
};

const dateStamp = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const timestamp = (): string => new Date().toISOString();

const sanitizeLogText = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

export class ElectronLogService {
  constructor(private readonly logDirectory: string) {}

  paths() {
    return {
      uiLogPath: this.pathFor('ui'),
      mainBridgeLogPath: this.pathFor('main-bridge')
    };
  }

  pathFor(channel: ElectronLogChannel): string {
    return path.join(this.logDirectory, `${channelFileNames[channel]}-${dateStamp()}.log`);
  }

  async write(
    channel: ElectronLogChannel,
    level: FluxoraLogLevel,
    category: string,
    message: string,
    operationId?: string
  ): Promise<void> {
    const safeCategory = sanitizeLogText(category || channel);
    const safeMessage = sanitizeLogText(message);
    const opText = operationId ? ` [operationId=${sanitizeLogText(operationId)}]` : '';
    const line = `[${timestamp()}] [${level.toUpperCase()}] [${safeCategory}]${opText} ${safeMessage}\n`;

    await fs.mkdir(this.logDirectory, { recursive: true });
    await fs.appendFile(this.pathFor(channel), line, 'utf8');
  }
}
