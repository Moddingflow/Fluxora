import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MODDINGFLOW_PUBLIC_API_DEFAULT_BASE_URL,
  MODDINGFLOW_PUBLIC_API_TEST_MODE_HEADER,
  createModdingflowPublicApiDogfoodClient
} from '../src/shared/moddingflow-public-api-dogfood';
import { createFluxoraApi, type IpcInvoker } from '../src/tauri/fluxora-api';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
    ...init
  });
}

describe('Moddingflow public API dogfood client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: { results: [] } }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the public /v1 catalog surface for Fluxora test-mode reads', async () => {
    const client = createModdingflowPublicApiDogfoodClient({ fetchImpl: fetchMock });

    await expect(
      client.listMods(
        {
          category: 'interface',
          game: 'skyrim-se-ae',
          gameVersion: '1.6.1170',
          limit: 20,
          loader: 'skse',
          query: 'skyui',
          sort: 'downloads'
        },
        { operationId: 'op_public_api_catalog' }
      )
    ).resolves.toMatchObject({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      `${MODDINGFLOW_PUBLIC_API_DEFAULT_BASE_URL}/mods?q=skyui&game=skyrim-se-ae&sort=downloads&limit=20&gameVersion=1.6.1170&loader=skse&category=interface`
    );
    expect(url.pathname).not.toContain('/internal');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('x-moddingflow-client-mode')).toBe(
      MODDINGFLOW_PUBLIC_API_TEST_MODE_HEADER
    );
    expect(new Headers(init.headers).get('x-operation-id')).toBe('op_public_api_catalog');
  });

  it('resolves downloads and install plans through public Mod Manager operations', async () => {
    const artifactId = '01cb8d90-61bf-43ae-9bdc-749a5de1c6f3';
    const client = createModdingflowPublicApiDogfoodClient({
      baseUrl: 'https://staging.moddingflow.test/v1',
      fetchImpl: fetchMock
    });

    await client.resolveDownload(artifactId, { preferred_cdn: 'r2' }, { accessToken: 'token' });
    await client.resolveInstallPlan({
      artifact_id: artifactId,
      game_slug: 'skyrim-se-ae',
      game_version: '1.6.1170',
      loader: 'skse'
    });

    const [downloadUrl, downloadInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(downloadUrl.toString()).toBe(
      `https://staging.moddingflow.test/v1/downloads/${artifactId}/resolve`
    );
    expect(JSON.parse(String(downloadInit.body))).toEqual({
      client: 'mod_manager',
      preferred_cdn: 'r2'
    });
    expect(new Headers(downloadInit.headers).get('authorization')).toBe('Bearer token');

    const [installPlanUrl, installPlanInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(installPlanUrl.toString()).toBe('https://staging.moddingflow.test/v1/install-plans:resolve');
    expect(JSON.parse(String(installPlanInit.body))).toMatchObject({
      artifact_id: artifactId,
      game_slug: 'skyrim-se-ae',
      game_version: '1.6.1170'
    });
  });

  it('exposes the dogfood client through the typed window.fluxora facade without IPC', async () => {
    const ipc: IpcInvoker = {
      invoke: vi.fn()
    };
    vi.stubGlobal('fetch', fetchMock);

    const api = createFluxoraApi(ipc);
    await expect(api.publicApi.listMods({ q: 'skyui' })).resolves.toMatchObject({ ok: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(ipc.invoke).not.toHaveBeenCalled();
  });
});
