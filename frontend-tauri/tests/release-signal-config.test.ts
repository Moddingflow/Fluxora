import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  FLUXORA_RELEASES_SUPABASE_URL,
  resolveFluxoraReleaseSignalConfig
} from '../src/renderer/features/update/release-signal-config';

describe('Fluxora public release signal configuration', () => {
  it('accepts only the canonical public project and keeps the key opaque', () => {
    const key = 'sb_publishable_test_value';
    expect(resolveFluxoraReleaseSignalConfig({
      VITE_FLUXORA_RELEASES_SUPABASE_PUBLISHABLE_KEY: key,
      VITE_FLUXORA_RELEASES_SUPABASE_URL: FLUXORA_RELEASES_SUPABASE_URL
    }, true)).toEqual({ publishableKey: key, url: FLUXORA_RELEASES_SUPABASE_URL });
  });

  it('fails early in production for missing, partial, or wrong-project configuration', () => {
    expect(() => resolveFluxoraReleaseSignalConfig({}, true)).toThrow(
      'Fluxora release signal configuration is required'
    );
    expect(() => resolveFluxoraReleaseSignalConfig({
      VITE_FLUXORA_RELEASES_SUPABASE_URL: FLUXORA_RELEASES_SUPABASE_URL
    }, true)).toThrow('Fluxora release signal configuration is incomplete');
    expect(() => resolveFluxoraReleaseSignalConfig({
      VITE_FLUXORA_RELEASES_SUPABASE_PUBLISHABLE_KEY: 'public-key',
      VITE_FLUXORA_RELEASES_SUPABASE_URL: 'https://attacker.supabase.co'
    }, true)).toThrow('Fluxora release signal project URL is invalid');
  });

  it('allows an entirely absent local configuration so polling remains the fallback', () => {
    expect(resolveFluxoraReleaseSignalConfig({}, false)).toBeNull();
  });

  it('leaves optimized local bundles on polling while the publisher owns the production gate', () => {
    const source = readFileSync(new URL(
      '../src/renderer/features/update/release-signal-config.ts',
      import.meta.url
    ), 'utf8');

    expect(source).toContain('canonical production publisher enforces both values');
    expect(source).not.toContain('import.meta.env.PROD');
  });

  it('pins the dependency and allows only the exact Supabase HTTPS and WSS origins', () => {
    const packageJson = JSON.parse(readFileSync(
      new URL('../package.json', import.meta.url),
      'utf8'
    )) as { dependencies: Record<string, string> };
    const lockfile = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
    const tauriConfig = JSON.parse(readFileSync(
      new URL('../src-tauri/tauri.conf.json', import.meta.url),
      'utf8'
    )) as { app: { security: { csp: string; devCsp: string } } };

    expect(packageJson.dependencies['@supabase/supabase-js']).toBe('2.104.0');
    expect(lockfile).toContain("'@supabase/supabase-js':\n        specifier: 2.104.0\n        version: 2.104.0");
    for (const csp of [tauriConfig.app.security.csp, tauriConfig.app.security.devCsp]) {
      const connectSource = csp.split(';').find((value) =>
        value.trim().startsWith('connect-src ')) ?? '';
      expect(connectSource).toContain(`https://tpciohumwahlctpeuduv.supabase.co`);
      expect(connectSource).toContain(`wss://tpciohumwahlctpeuduv.supabase.co`);
      expect(connectSource).not.toContain('*.supabase.co');
    }
  });
});
