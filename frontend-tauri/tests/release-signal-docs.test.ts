import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (relativeUrl: string) => readFileSync(
  new URL(relativeUrl, import.meta.url),
  'utf8'
);

describe('release signal architecture and release documentation', () => {
  it('documents the untrusted renderer signal and native signed-manifest authority', () => {
    const architecture = read('../../docs/tauri-migration/architecture.md');

    for (const contract of [
      'https://tpciohumwahlctpeuduv.supabase.co',
      'wss://tpciohumwahlctpeuduv.supabase.co',
      'public.fluxora_desktop_releases',
      'subscribes before reading state',
      'Every `SUBSCRIBED` transition',
      '2, 5, 15, 30 and 60 seconds',
      'only native `FluxoraUpdateStatus.state ===',
      'available` exposes the existing green action',
      'Startup, focus and 15-minute'
    ]) {
      expect(architecture).toContain(contract);
    }
    expect(architecture).toContain('Settings contains no application-update');
    expect(architecture).toContain('status, error, or manual check action.');
  });

  it('documents webhook durability, Graphify preservation, and irreversible publication postflight', () => {
    const release = read('../../docs/tauri-migration/release-pipeline.md');

    for (const contract of [
      'POST /api/webhooks/github/fluxora-release/',
      'FLUXORA_GITHUB_RELEASE_WEBHOOK_SECRET',
      '20260802170000_fluxora_desktop_release_signals.sql',
      'supabase_realtime',
      'only unstaged modifications to already tracked files below `graphify-out/`',
      'public GitHub `latest/download` manifest',
      '`published, announcement unconfirmed`',
      'forbids retrying or reusing that SemVer'
    ]) {
      expect(release).toContain(contract);
    }
  });

  it('keeps the design source aligned with the single verified toolbar action', () => {
    const design = read('../../.agents/skills/stitch-design-taste/DESIGN.md');

    expect(design).toContain(
      'Application-update discovery has no Settings row or manual check button.'
    );
    expect(design).toContain('native-verified available update');
  });
});
