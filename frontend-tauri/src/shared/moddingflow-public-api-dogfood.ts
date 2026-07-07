import type {
  FluxoraPublicApiCallOptions,
  FluxoraPublicApiCatalogRequest,
  FluxoraPublicApiClient,
  FluxoraPublicApiDownloadResolveRequest,
  FluxoraPublicApiEnvelope,
  FluxoraPublicApiInstallPlanResolveRequest
} from './fluxora-api';

export const MODDINGFLOW_PUBLIC_API_DEFAULT_BASE_URL = 'https://api.moddingflow.com/v1';
export const MODDINGFLOW_PUBLIC_API_TEST_MODE_HEADER = 'test-dogfood';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ModdingflowPublicApiDogfoodClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  const candidate = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!candidate) {
    throw new Error('A fetch implementation is required for Moddingflow public API dogfood calls.');
  }
  return candidate;
}

function apiUrl(baseUrl: string, path: string): URL {
  return new URL(`${baseUrl.replace(/\/+$/, '')}${path}`);
}

function applyQuery(url: URL, query: FluxoraPublicApiCatalogRequest = {}): void {
  const entries: Array<[string, string | number | boolean | null | undefined]> = [
    ['q', query.query ?? query.q],
    ['game', query.game],
    ['sort', query.sort],
    ['limit', query.limit],
    ['cursor', query.cursor],
    ['gameVersion', query.gameVersion],
    ['loader', query.loader],
    ['category', query.category]
  ];
  for (const [key, value] of entries) {
    if (value === null || value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
}

function headers(options: FluxoraPublicApiCallOptions | undefined, hasBody: boolean): Headers {
  const result = new Headers(options?.headers);
  result.set('accept', 'application/json');
  result.set('x-moddingflow-client', 'fluxora');
  result.set('x-moddingflow-client-mode', MODDINGFLOW_PUBLIC_API_TEST_MODE_HEADER);
  if (options?.operationId) {
    result.set('x-operation-id', options.operationId);
  }
  if (options?.accessToken) {
    result.set('authorization', `Bearer ${options.accessToken}`);
  }
  if (hasBody) {
    result.set('content-type', result.get('content-type') ?? 'application/json');
  }
  return result;
}

async function parseJsonEnvelope(response: Response): Promise<FluxoraPublicApiEnvelope> {
  const text = await response.text();
  const payload = (text ? JSON.parse(text) : null) as FluxoraPublicApiEnvelope;
  if (!response.ok) {
    const error = new Error(`Moddingflow public API request failed with HTTP ${response.status}`);
    Object.assign(error, { payload, status: response.status });
    throw error;
  }
  return payload;
}

function bodyWithModManagerClient(payload: FluxoraPublicApiDownloadResolveRequest | undefined): string {
  return JSON.stringify({
    client: 'mod_manager',
    ...(payload?.preferred_cdn ? { preferred_cdn: payload.preferred_cdn } : {})
  });
}

export function createModdingflowPublicApiDogfoodClient(
  clientOptions: ModdingflowPublicApiDogfoodClientOptions = {}
): FluxoraPublicApiClient {
  const fetchImpl = resolveFetch(clientOptions.fetchImpl);
  const defaultBaseUrl = clientOptions.baseUrl ?? MODDINGFLOW_PUBLIC_API_DEFAULT_BASE_URL;

  return {
    listMods: async (request = {}, options = {}) => {
      const url = apiUrl(options.baseUrl ?? defaultBaseUrl, '/mods');
      applyQuery(url, request);
      const response = await fetchImpl(url, {
        headers: headers(options, false),
        method: 'GET'
      });
      return parseJsonEnvelope(response);
    },
    resolveDownload: async (artifactId, request = {}, options = {}) => {
      const encodedArtifactId = encodeURIComponent(artifactId);
      const url = apiUrl(options.baseUrl ?? defaultBaseUrl, `/downloads/${encodedArtifactId}/resolve`);
      const response = await fetchImpl(url, {
        body: bodyWithModManagerClient(request),
        headers: headers(options, true),
        method: 'POST'
      });
      return parseJsonEnvelope(response);
    },
    resolveInstallPlan: async (request: FluxoraPublicApiInstallPlanResolveRequest, options = {}) => {
      const url = apiUrl(options.baseUrl ?? defaultBaseUrl, '/install-plans:resolve');
      const response = await fetchImpl(url, {
        body: JSON.stringify(request),
        headers: headers(options, true),
        method: 'POST'
      });
      return parseJsonEnvelope(response);
    }
  };
}
