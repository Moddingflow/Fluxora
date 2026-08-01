import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { createFluxoraApi, type IpcInvoker } from '../src/tauri/fluxora-api';

describe('ModdingFlow renderer security boundary', () => {
  it('does not expose a renderer-owned public API client', () => {
    const ipc: IpcInvoker = {
      invoke: vi.fn()
    };

    const api = createFluxoraApi(ipc);

    expect(api).not.toHaveProperty('publicApi');
    expect(ipc.invoke).not.toHaveBeenCalled();
  });

  it('keeps ModdingFlow origins, tokens, and fetch authority out of the facade source', () => {
    const sharedApiSource = readFileSync(
      new URL('../src/shared/fluxora-api.ts', import.meta.url),
      'utf8'
    );
    const facadeSource = readFileSync(
      new URL('../src/tauri/fluxora-api.ts', import.meta.url),
      'utf8'
    );

    expect(existsSync(new URL('../src/shared/moddingflow-public-api-dogfood.ts', import.meta.url)))
      .toBe(false);
    expect(sharedApiSource).not.toMatch(/\bpublicApi\s*:/);
    expect(facadeSource).not.toContain('createModdingflowPublicApiDogfoodClient');
    expect(facadeSource).not.toMatch(/api\.moddingflow\.com|moddingflow\.com\/v1/i);
  });

  it('allowlists connection DTO fields before any IPC result reaches renderer state', async () => {
    const unsafeStatus = {
      providerId: 'moddingflow',
      label: 'ModdingFlow',
      state: 'notConfigured',
      accountName: '',
      hasStoredSession: false,
      retryable: false,
      requiresUserAction: false,
      message: 'ModdingFlow connection is not available in this build.',
      checkedAtUtc: '',
      operationId: 'op_safe_snapshot',
      authorizationUrl: 'https://example.invalid/oauth?state=private',
      callbackQuery: 'code=private&state=private',
      accessToken: 'private-access-token',
      refreshToken: 'private-refresh-token'
    };
    const ipc: IpcInvoker = {
      invoke: vi.fn().mockResolvedValue({
        providers: [unsafeStatus],
        requestedAtUtc: '',
        completedAtUtc: '',
        durationMs: 0,
        timedOut: false,
        operationId: 'op_safe_snapshot',
        callbackUrl: 'http://127.0.0.1/callback?code=private'
      })
    };

    const snapshot = await createFluxoraApi(ipc).connections.listStatus({
      operationId: 'op_safe_snapshot'
    });
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.providers).toEqual([{
      providerId: 'moddingflow',
      label: 'ModdingFlow',
      state: 'notConfigured',
      accountName: '',
      hasStoredSession: false,
      retryable: false,
      requiresUserAction: false,
      message: 'ModdingFlow connection is not available in this build.',
      checkedAtUtc: '',
      operationId: 'op_safe_snapshot'
    }]);
    expect(serialized).not.toMatch(/authorizationUrl|callback|accessToken|refreshToken|private-/);
  });
});
