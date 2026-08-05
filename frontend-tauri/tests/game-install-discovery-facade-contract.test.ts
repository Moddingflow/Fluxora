import { describe, expect, it, vi } from 'vitest';

import { FluxoraIpcChannels } from '../src/shared/fluxora-api';
import { createFluxoraApi } from '../src/tauri/fluxora-api';

describe('game install discovery facade contract', () => {
  it('routes the read-only discovery request with the caller operation id', async () => {
    const snapshot = {
      installs: [{
        templateId: 'skyrimse',
        resolution: 'found' as const,
        primaryExecutablePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
        providerId: 'steam' as const
      }],
      operationId: 'op_discover'
    };
    const invoke = vi.fn().mockResolvedValue(snapshot);
    const api = createFluxoraApi({ invoke });

    const result = await api.gameInstalls.discover({ operationId: 'op_discover' });

    expect(result).toBe(snapshot);
    expect(invoke).toHaveBeenCalledWith(
      FluxoraIpcChannels.gameInstallsDiscover,
      { operationId: 'op_discover' }
    );
  });
});
