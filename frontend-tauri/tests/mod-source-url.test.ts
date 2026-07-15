import { describe, expect, it } from 'vitest';

import { resolveModSourcePageUrl } from '../src/renderer/features/mods/mod-source-url';

describe('mod source URL', () => {
  it('resolves Nexus download metadata to the public mod page', () => {
    expect(
      resolveModSourcePageUrl({
        sourceIsNexus: true,
        sourceProvider: 'nexus',
        sourceGameDomain: 'skyrimspecialedition',
        sourceModId: '266',
        sourceUrl: 'nxm://skyrimspecialedition/mods/266/files/12345'
      })
    ).toBe('https://www.nexusmods.com/skyrimspecialedition/mods/266');
  });

  it('keeps an explicit HTTPS source page for other providers', () => {
    expect(
      resolveModSourcePageUrl({
        sourceProvider: 'moddingflow',
        sourceUrl: 'https://moddingflow.com/mods/example-mod'
      })
    ).toBe('https://moddingflow.com/mods/example-mod');
  });

  it('recovers the Nexus mod page from a legacy NXM source URL', () => {
    expect(
      resolveModSourcePageUrl({
        sourceIsNexus: true,
        sourceUrl: 'nxm://fallout4/mods/4598/files/288893?key=download-token'
      })
    ).toBe('https://www.nexusmods.com/fallout4/mods/4598');
  });

  it('does not expose local paths or unsafe web protocols as source pages', () => {
    expect(resolveModSourcePageUrl({ sourceUrl: 'D:\\Downloads\\mod.7z' })).toBeNull();
    expect(resolveModSourcePageUrl({ sourceUrl: 'http://example.test/mod' })).toBeNull();
    expect(resolveModSourcePageUrl({ sourceUrl: 'https://user:pass@example.test/mod' })).toBeNull();
  });
});
