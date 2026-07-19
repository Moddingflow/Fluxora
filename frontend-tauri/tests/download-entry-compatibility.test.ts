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
    const ipc: IpcInvoker = {
      invoke: async (channel) => {
        switch (channel) {
          case FluxoraIpcChannels.downloadsList:
          case FluxoraIpcChannels.nxmCaptureLinks:
          case FluxoraIpcChannels.nxmImportInboundDownloads:
            return [legacyDownloadEntry];
          case FluxoraIpcChannels.downloadsImportFile:
          case FluxoraIpcChannels.downloadsResume:
            return legacyDownloadEntry;
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

    expect(listed[0]?.hasResolvedFileName).toBe(true);
    expect(imported.hasResolvedFileName).toBe(true);
    expect(resumed.hasResolvedFileName).toBe(true);
    expect(captured[0]?.hasResolvedFileName).toBe(true);
    expect(inbound[0]?.hasResolvedFileName).toBe(true);
  });
});
