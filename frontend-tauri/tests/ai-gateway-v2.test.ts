import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const hostSource = readFileSync(
  resolve(__dirname, '../src-tauri/src/bin/fluxora_ai_host.rs'),
  'utf8'
);
const shellSource = readFileSync(
  resolve(__dirname, '../src-tauri/src/lib.rs'),
  'utf8'
);

describe('managed Gemini Website gateway protocol v3', () => {
  it('uses only the fixed Website endpoint with OAuth and no publishable-key transport', () => {
    expect(hostSource).toContain(
      'const MANAGED_AI_GATEWAY_URL: &str = "https://moddingflow.com/api/fluxora/ai/gemini"'
    );
    expect(hostSource).toContain('const MANAGED_AI_GATEWAY_PROTOCOL: &str = "3"');
    expect(hostSource).toContain('.bearer_auth(access_token)');
    expect(hostSource).toContain('.header("x-fluxora-ai-search-mode", search_mode)');
    expect(hostSource).toContain('"idempotency-key"');
    expect(hostSource).not.toContain('DEFAULT_SUPABASE_PUBLISHABLE_KEY');
    expect(hostSource).not.toContain('FLUXORA_AI_SUPABASE_ANON_KEY');
  });

  it('keeps OAuth private and permits one refresh retry only', () => {
    expect(shellSource).toContain('"moddingflow.getManagedAiAccessToken"');
    expect(shellSource).toContain('PRIVATE_MANAGED_AI_ACCESS_TOKEN_FIELD');
    expect(shellSource).toContain('completed_retries == 0');
    expect(shellSource).toContain('with_managed_ai_access_token(app, params, &operation_id, true)');
    expect(shellSource).not.toContain('window.fluxora.managedAiAccessToken');
  });
});
