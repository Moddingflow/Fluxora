import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readLegal = (locale: 'en' | 'de' | 'ru', document: 'privacy' | 'terms'): string =>
  readFileSync(
    new URL(
      `../../legal/desktop/${locale}/${document}.md`,
      import.meta.url
    ),
    'utf8'
  ).toLowerCase();

describe('ModdingFlow legal disclosure parity', () => {
  it.each([
    ['en', 'signed', 'artifact'],
    ['de', 'signiert', 'artefakt'],
    ['ru', 'signed', 'артефакт']
  ] as const)('%s privacy draft covers the desktop data boundary', (locale, signedText, artifactText) => {
    const privacy = readLegal(locale, 'privacy');

    for (const required of [
      'moddingflow',
      'oauth',
      'refresh',
      'windows',
      signedText,
      'sha-256',
      artifactText
    ]) {
      expect(privacy).toContain(required);
    }
  });

  it.each([
    ['en', 'artifact', 'explicitly confirm', 'queues any required downloads in the manager'],
    ['de', 'artefakt', 'ausdrückliche bestätigung', 'downloads im manager eingereiht werden'],
    ['ru', 'артефакт', 'явно подтвердить', 'загрузки будут поставлены в очередь менеджера']
  ] as const)('%s terms draft requires an explicit handoff decision', (
    locale,
    artifactText,
    confirmationText,
    queueText
  ) => {
    const terms = readLegal(locale, 'terms');

    expect(terms).toContain('moddingflow://');
    expect(terms).toContain(artifactText);
    expect(terms).toContain('sha-256');
    expect(terms).toContain(confirmationText);
    expect(terms).toContain(queueText);
  });
});
