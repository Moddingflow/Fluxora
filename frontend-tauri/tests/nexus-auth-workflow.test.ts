import { describe, expect, it, vi } from 'vitest';

import { loadNexusStatusAndLimits } from '../src/renderer/nexus-auth-workflow';
import type {
  FluxoraApiLimitProvider,
  FluxoraNexusModsAuthStatus
} from '../src/shared/fluxora-api';

const linkedStatus: FluxoraNexusModsAuthStatus = {
  isConfigured: true,
  isLinked: true,
  isPremium: true,
  hasApiKey: false,
  displayName: 'Valerii',
  userId: '123',
  message: 'Linked',
  clientId: 'fluxora',
  redirectUri: 'http://127.0.0.1:8089/callback',
  operationId: 'op_nexus'
};

const nexusLimits: FluxoraApiLimitProvider[] = [
  {
    id: 'nexus-mods',
    label: 'Nexus Mods',
    state: 'available',
    message: 'Available',
    updatedAtUtc: '2026-07-14T09:00:00Z',
    windows: []
  }
];

describe('Nexus auth workflow', () => {
  it('preserves a verified auth result when the optional API-limits probe fails', async () => {
    const result = await loadNexusStatusAndLimits({
      getAuthStatus: vi.fn().mockResolvedValue(linkedStatus),
      listApiLimits: vi.fn().mockRejectedValue(new Error('Nexus quota probe failed'))
    });

    expect(result.authStatus).toEqual(linkedStatus);
    expect(result.authError).toBeNull();
    expect(result.apiLimitProviders).toBeNull();
    expect(result.apiLimitsError).toEqual(new Error('Nexus quota probe failed'));
  });

  it('preserves API-limit data when the auth status request is temporarily unavailable', async () => {
    const result = await loadNexusStatusAndLimits({
      getAuthStatus: vi.fn().mockRejectedValue(new Error('Bridge unavailable')),
      listApiLimits: vi.fn().mockResolvedValue({ providers: nexusLimits })
    });

    expect(result.authStatus).toBeNull();
    expect(result.authError).toEqual(new Error('Bridge unavailable'));
    expect(result.apiLimitProviders).toEqual(nexusLimits);
    expect(result.apiLimitsError).toBeNull();
  });
});
