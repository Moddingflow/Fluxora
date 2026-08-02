import { describe, expect, it } from 'vitest';

import {
  compareStrictSemver,
  parseFluxoraReleaseAnnouncement
} from '../src/renderer/features/update/release-signal-contract';

const row = (version = '1.2.3', releaseId: string | number = 123) => ({
  channel: 'stable',
  github_release_id: releaseId,
  published_at: '2026-08-02T12:34:56Z',
  tag_name: `v${version}`,
  version
});

describe('Fluxora release signal contract', () => {
  it('normalizes the public stable release row without trusting extra fields', () => {
    expect(parseFluxoraReleaseAnnouncement({ ...row(), ignored: 'payload-data' })).toEqual({
      channel: 'stable',
      githubReleaseId: '123',
      publishedAt: '2026-08-02T12:34:56.000Z',
      tagName: 'v1.2.3',
      version: '1.2.3'
    });
  });

  it.each([
    ['wrong channel', { ...row(), channel: 'beta' }],
    ['unsafe release id', row('1.2.3', Number.MAX_SAFE_INTEGER + 1)],
    ['negative release id', row('1.2.3', '-1')],
    ['leading zero', row('01.2.3')],
    ['prerelease', row('1.2.3-beta.1')],
    ['tag mismatch', { ...row(), tag_name: 'v9.9.9' }],
    ['invalid timestamp', { ...row(), published_at: 'not-a-date' }]
  ])('rejects %s rows', (_name, value) => {
    expect(parseFluxoraReleaseAnnouncement(value)).toBeNull();
  });

  it('compares numeric SemVer components without lexical or number overflow bugs', () => {
    expect(compareStrictSemver('1.10.0', '1.9.99')).toBe(1);
    expect(compareStrictSemver('2.0.0', '2.0.0')).toBe(0);
    expect(compareStrictSemver('0.9.9', '1.0.0')).toBe(-1);
    expect(compareStrictSemver('999999999999999999999.0.0', '2.0.0')).toBe(1);
    expect(compareStrictSemver('1.0.0-beta', '1.0.0')).toBeNull();
  });
});
