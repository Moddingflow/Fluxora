import { describe, expect, it } from 'vitest';

import fs from 'node:fs';
import path from 'node:path';

import {
  localizationResources,
  normalizeAppLocale,
  translateForLanguage
} from '../src/localization';

const placeholderNames = (value: string): string[] =>
  [...value.matchAll(/\{([a-z][a-z0-9]*)\}/giu)]
    .map((match) => match[1].toLowerCase())
    .sort();

describe('bundled localization resources', () => {
  it('keeps every JSON catalog free of duplicate keys and broken text encoding', () => {
    const localeDirectory = path.resolve('src/localization/locales');
    for (const locale of ['en-US', 'de-DE', 'ru-RU'] as const) {
      const source = fs.readFileSync(path.join(localeDirectory, `${locale}.json`), 'utf8');
      const keys = [...source.matchAll(/^\s*"([^"]+)"\s*:/gmu)].map((match) => match[1]);

      expect(new Set(keys).size, locale).toBe(keys.length);
      expect(source, locale).not.toMatch(/(?:Ã.|Â.|â€|Ð.|Ñ.)/u);
    }
  });

  it('normalizes every supported native language code with English fallback', () => {
    expect(normalizeAppLocale('en-us')).toBe('en-US');
    expect(normalizeAppLocale('de-DE')).toBe('de-DE');
    expect(normalizeAppLocale('ru_ru')).toBe('ru-RU');
    expect(normalizeAppLocale('fr-FR')).toBe('en-US');
    expect(normalizeAppLocale(null)).toBe('en-US');
  });

  it('keeps every locale complete and preserves interpolation variables', () => {
    const englishEntries = Object.entries(localizationResources['en-US']);
    const englishKeys = englishEntries.map(([key]) => key).sort();

    for (const locale of ['de-DE', 'ru-RU'] as const) {
      const localized = localizationResources[locale];
      expect(Object.keys(localized).sort()).toEqual(englishKeys);

      for (const [key, englishValue] of englishEntries) {
        expect(localized[key as keyof typeof localized]?.trim(), `${locale}:${key}`).not.toBe('');
        expect(
          placeholderNames(localized[key as keyof typeof localized]),
          `${locale}:${key}`
        ).toEqual(placeholderNames(englishValue));
      }
    }
  });

  it('translates installer copy from resources and interpolates variables', () => {
    expect(translateForLanguage('de-de', 'setup.action.install')).toBe('Installieren');
    expect(translateForLanguage('ru-ru', 'setup.action.install')).toBe('Установить');
    expect(
      translateForLanguage('de-de', 'updater.version', {
        current: '1.0.0',
        target: '1.1.0'
      })
    ).toBe('Aktualisierung von 1.0.0 auf 1.1.0');
  });

  it('keeps Russian copy translated and German address consistent', () => {
    const russianLeakPattern = /\b(?:override|bridge|managed AI|Mod Manager|Stack trace|Setup|Updater|stable|commit|Master|Recommended|NotUsable|script extender|Downloads)\b/iu;
    const russianLeaks = Object.entries(localizationResources['ru-RU'])
      .filter(([, value]) => russianLeakPattern.test(value.replace(/\{[^}]+\}/gu, '')))
      .map(([key, value]) => `${key}: ${value}`);
    const germanFormalAddress = Object.entries(localizationResources['de-DE'])
      .filter(([, value]) => /\b(?:Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihres)\b/u.test(value))
      .map(([key, value]) => `${key}: ${value}`);

    expect(russianLeaks).toEqual([]);
    expect(germanFormalAddress).toEqual([]);
    expect(localizationResources['ru-RU']['app.ui.overwrite']).toBe('Перезапись');
    expect(localizationResources['ru-RU']['app.ui.fluxpackDeltaFacts']).toContain('Создано файлов');
    expect(localizationResources['de-DE']['editor.close.unsavedFiles_one']).toBe(
      '{count} ungespeicherte Datei'
    );
  });
});
