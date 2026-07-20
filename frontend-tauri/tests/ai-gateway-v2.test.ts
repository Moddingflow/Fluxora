import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const gatewaySource = readFileSync(
  resolve(__dirname, '../../supabase/functions/fluxora-ai-gemini/index.ts'),
  'utf8'
);

describe('managed Gemini gateway protocol v2', () => {
  it('keeps v1 compatibility while v2 accepts only the product model and provider methods', () => {
    expect(gatewaySource).toContain("const PROTOCOL_V1 = '1'");
    expect(gatewaySource).toContain("const PROTOCOL_V2 = '2'");
    expect(gatewaySource).toContain("const PRODUCT_MODEL_ID = 'gemini-3.1-flash-lite'");
    expect(gatewaySource).toContain("'generateContent'");
    expect(gatewaySource).toContain("'countTokens'");
    expect(gatewaySource).toContain("'getModel'");
  });

  it('forwards the v2 provider body and response as streams within explicit guards', () => {
    expect(gatewaySource).toContain('64 * 1024 * 1024');
    expect(gatewaySource).toContain('AbortSignal.timeout(120_000)');
    expect(gatewaySource).toContain('body: method === \'getModel\' ? undefined : boundedRequestBody');
    expect(gatewaySource).toContain('new Response(upstream.body');
    expect(gatewaySource).toContain("request.headers.get('x-fluxora-ai-method')");
    expect(gatewaySource).toContain("request.headers.get('x-fluxora-ai-model')");
  });
});
