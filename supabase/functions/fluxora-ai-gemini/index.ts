import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const PROVIDER_ID = 'gemini';
const PRODUCT_MODEL_ID = 'gemini-3.1-flash-lite';
const PROVIDER_CREDENTIAL_RPC = 'fluxora_ai_provider_credential';
const PROVIDER_SECRET_NAME = 'GEMINI_API_KEY';
const PROTOCOL_V1 = '1';
const PROTOCOL_V2 = '2';
const MAX_V1_REQUEST_BYTES = 2_500_000;
const MAX_V2_REQUEST_BYTES = 64 * 1024 * 1024;
const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const V1_ALLOWED_MODELS = new Set([PRODUCT_MODEL_ID, 'gemini-2.5-flash-lite']);
const ALLOWED_METHODS = new Set([
  'generateContent',
  'countTokens',
  'getModel'
]);

type ProviderMethod = 'generateContent' | 'countTokens' | 'getModel';

type GatewayRequestV1 = {
  action?: unknown;
  body?: unknown;
  method?: unknown;
  modelId?: unknown;
  providerId?: unknown;
};

class RequestTooLargeError extends Error {}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8'
    }
  });

const serverEnvironment = (): { serviceRoleKey: string; supabaseUrl: string } | null => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return { serviceRoleKey, supabaseUrl: supabaseUrl.replace(/\/+$/, '') };
};

const extractCredential = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized ? normalized : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const credential = extractCredential(item);
      if (credential) {
        return credential;
      }
    }
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const field of ['apiKey', 'api_key', 'credential', 'decrypted_secret', 'secret', 'value', 'key']) {
    const credential = extractCredential(record[field]);
    if (credential) {
      return credential;
    }
  }
  return null;
};

const managedGeminiCredential = async (): Promise<string | null> => {
  const environment = serverEnvironment();
  if (!environment) {
    return null;
  }
  const response = await fetch(
    `${environment.supabaseUrl}/rest/v1/rpc/${PROVIDER_CREDENTIAL_RPC}`,
    {
      method: 'POST',
      headers: {
        apikey: environment.serviceRoleKey,
        Authorization: `Bearer ${environment.serviceRoleKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider_id: PROVIDER_ID,
        secret_name: PROVIDER_SECRET_NAME
      }),
      signal: AbortSignal.timeout(4_000)
    }
  );
  if (!response.ok) {
    return null;
  }
  return extractCredential(await response.json());
};

const requestLength = (request: Request): number | null => {
  const raw = request.headers.get('content-length');
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const parseV1Request = async (request: Request): Promise<GatewayRequestV1 | null> => {
  const contentLength = requestLength(request);
  if (contentLength !== null && contentLength > MAX_V1_REQUEST_BYTES) {
    throw new RequestTooLargeError();
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_V1_REQUEST_BYTES) {
    throw new RequestTooLargeError();
  }
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as GatewayRequestV1
      : null;
  } catch {
    return null;
  }
};

const boundedBody = (
  source: ReadableStream<Uint8Array> | null,
  maximumBytes: number
): ReadableStream<Uint8Array> | null => {
  if (!source) {
    return null;
  }
  let receivedBytes = 0;
  return source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maximumBytes) {
        throw new RequestTooLargeError();
      }
      controller.enqueue(chunk);
    }
  }));
};

const geminiTarget = (modelId: string, method: ProviderMethod, credential: string): string => {
  const model = encodeURIComponent(modelId);
  const key = encodeURIComponent(credential);
  return method === 'getModel'
    ? `${GEMINI_API_ROOT}/${model}?key=${key}`
    : `${GEMINI_API_ROOT}/${model}:${method}?key=${key}`;
};

const providerResponse = async (
  modelId: string,
  method: ProviderMethod,
  credential: string,
  boundedRequestBody: BodyInit | null,
  gatewayVersion: string
): Promise<Response> => {
  const upstream = await fetch(geminiTarget(modelId, method, credential), {
    method: method === 'getModel' ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `FluxoraSupabaseAIGateway/${gatewayVersion}`
    },
    body: method === 'getModel' ? undefined : boundedRequestBody,
    signal: AbortSignal.timeout(120_000)
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8'
    }
  });
};

const statusResponse = async (): Promise<Response> => {
  const credential = await managedGeminiCredential();
  return jsonResponse(200, {
    available: Boolean(credential),
    providerId: PROVIDER_ID,
    modelId: PRODUCT_MODEL_ID,
    credentialSource: 'supabase-vault',
    protocols: [PROTOCOL_V1, PROTOCOL_V2]
  });
};

const handleV2 = async (request: Request): Promise<Response> => {
  const action = request.headers.get('x-fluxora-ai-action')?.trim() ?? 'request';
  if (action === 'status') {
    return statusResponse();
  }
  const providerId = request.headers.get('x-fluxora-ai-provider')?.trim();
  const modelId = request.headers.get('x-fluxora-ai-model')?.trim();
  const methodValue = request.headers.get('x-fluxora-ai-method')?.trim();
  if (
    action !== 'request' ||
    providerId !== PROVIDER_ID ||
    modelId !== PRODUCT_MODEL_ID ||
    !methodValue ||
    !ALLOWED_METHODS.has(methodValue)
  ) {
    return jsonResponse(400, { code: 'unsupportedProviderRequest' });
  }
  const method = methodValue as ProviderMethod;
  const contentLength = requestLength(request);
  if (contentLength !== null && contentLength > MAX_V2_REQUEST_BYTES) {
    return jsonResponse(413, { code: 'requestTooLarge', maximumBytes: MAX_V2_REQUEST_BYTES });
  }
  if (method !== 'getModel' && !request.body) {
    return jsonResponse(400, { code: 'invalidProviderBody' });
  }
  const credential = await managedGeminiCredential();
  if (!credential) {
    return jsonResponse(503, { code: 'managedProviderUnavailable' });
  }
  const boundedRequestBody = boundedBody(request.body, MAX_V2_REQUEST_BYTES);
  try {
    return await providerResponse(modelId, method, credential, boundedRequestBody, PROTOCOL_V2);
  } catch (error) {
    return error instanceof RequestTooLargeError
      ? jsonResponse(413, { code: 'requestTooLarge', maximumBytes: MAX_V2_REQUEST_BYTES })
      : jsonResponse(503, { code: 'providerTransportUnavailable' });
  }
};

const handleV1 = async (request: Request): Promise<Response> => {
  let payload: GatewayRequestV1 | null;
  try {
    payload = await parseV1Request(request);
  } catch (error) {
    return error instanceof RequestTooLargeError
      ? jsonResponse(413, { code: 'requestTooLarge', maximumBytes: MAX_V1_REQUEST_BYTES })
      : jsonResponse(400, { code: 'invalidRequest' });
  }
  if (!payload || payload.providerId !== PROVIDER_ID) {
    return jsonResponse(400, { code: 'invalidRequest' });
  }
  if (payload.action === 'status') {
    return statusResponse();
  }
  const modelId = typeof payload.modelId === 'string' ? payload.modelId.trim() : '';
  const methodValue = typeof payload.method === 'string' ? payload.method.trim() : '';
  if (
    payload.action !== 'request' ||
    !V1_ALLOWED_MODELS.has(modelId) ||
    !ALLOWED_METHODS.has(methodValue)
  ) {
    return jsonResponse(400, { code: 'unsupportedProviderRequest' });
  }
  const method = methodValue as ProviderMethod;
  if (method !== 'getModel' && (!payload.body || typeof payload.body !== 'object' || Array.isArray(payload.body))) {
    return jsonResponse(400, { code: 'invalidProviderBody' });
  }
  const credential = await managedGeminiCredential();
  if (!credential) {
    return jsonResponse(503, { code: 'managedProviderUnavailable' });
  }
  try {
    return await providerResponse(
      modelId,
      method,
      credential,
      method === 'getModel' ? null : JSON.stringify(payload.body),
      PROTOCOL_V1
    );
  } catch {
    return jsonResponse(503, { code: 'providerTransportUnavailable' });
  }
};

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse(405, { code: 'methodNotAllowed' });
  }
  if (!request.headers.get('authorization')) {
    return jsonResponse(401, { code: 'authorizationRequired' });
  }
  const protocol = request.headers.get('x-fluxora-ai-protocol');
  if (protocol === PROTOCOL_V2) {
    return handleV2(request);
  }
  if (protocol === PROTOCOL_V1) {
    return handleV1(request);
  }
  return jsonResponse(400, { code: 'unsupportedProtocol' });
});
