import { describe, expect, it } from 'vitest';

import {
  FluxoraIpcChannels,
  type FluxoraDownloadEntry
} from '../src/shared/fluxora-api';
import { createFluxoraApi, type IpcInvoker } from '../src/tauri/fluxora-api';

const legacyDownloadEntry = {
  id: 'legacy-download',
  name: 'Legacy Archive',
  fileName: 'legacy-archive.zip',
  localPath: 'C:/Fluxora/Downloads/skyrimse/legacy-archive.zip'
} as unknown as FluxoraDownloadEntry;

describe('download entry compatibility', () => {
  it('treats a missing hasResolvedFileName field from an older host as resolved', async () => {
    const invocations: Array<{ channel: string; args: unknown[] }> = [];
    const ipc: IpcInvoker = {
      invoke: async (channel, ...args) => {
        invocations.push({ channel, args });
        switch (channel) {
          case FluxoraIpcChannels.downloadsList:
          case FluxoraIpcChannels.nxmCaptureLinks:
          case FluxoraIpcChannels.nxmImportInboundDownloads:
            return [legacyDownloadEntry];
          case FluxoraIpcChannels.downloadsImportFile:
          case FluxoraIpcChannels.downloadsResume:
            return legacyDownloadEntry;
          case FluxoraIpcChannels.downloadsResolveDuplicateDecision:
            return args[3] === 'cancel' ? null : legacyDownloadEntry;
          default:
            throw new Error(`Unexpected channel: ${channel}`);
        }
      }
    };
    const api = createFluxoraApi(ipc);

    const listed = await api.downloads.list('C:/Fluxora/Build');
    const imported = await api.downloads.importFile(
      'C:/Fluxora/Build',
      legacyDownloadEntry.localPath
    );
    const resumed = await api.downloads.resume(
      'C:/Fluxora/Build',
      legacyDownloadEntry.localPath
    );
    const captured = await api.nxm.captureLinks('C:/Fluxora/Build', ['nxm://example']);
    const inbound = await api.nxm.importInboundDownloads('C:/Fluxora/Build');
    const resolved = await api.downloads.resolveDuplicateDecision(
      'C:/Fluxora/Build',
      'C:/Fluxora/Build/downloads/pending.nxm',
      'decision-1',
      'replace',
      { operationId: 'op-resolve' }
    );
    const canceled = await api.downloads.resolveDuplicateDecision(
      'C:/Fluxora/Build',
      'C:/Fluxora/Build/downloads/pending.nxm',
      'decision-2',
      'cancel',
      { operationId: 'op-cancel' }
    );

    expect(listed[0]?.hasResolvedFileName).toBe(true);
    expect(imported.hasResolvedFileName).toBe(true);
    expect(resumed.hasResolvedFileName).toBe(true);
    expect(captured[0]?.hasResolvedFileName).toBe(true);
    expect(inbound[0]?.hasResolvedFileName).toBe(true);
    expect(listed[0]?.duplicateDecision).toBeNull();
    expect(resolved?.duplicateDecision).toBeNull();
    expect(canceled).toBeNull();
    expect(invocations.at(-2)).toEqual({
      channel: FluxoraIpcChannels.downloadsResolveDuplicateDecision,
      args: [
        'C:/Fluxora/Build',
        'C:/Fluxora/Build/downloads/pending.nxm',
        'decision-1',
        'replace',
        { operationId: 'op-resolve' }
      ]
    });
  });
});
