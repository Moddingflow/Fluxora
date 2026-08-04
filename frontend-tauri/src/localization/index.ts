import { createInstance } from 'i18next';

import deDE from './locales/de-DE.json';
import enUS from './locales/en-US.json';
import ruRU from './locales/ru-RU.json';

export const supportedAppLocales = ['en-US', 'de-DE', 'ru-RU'] as const;

export type AppLocale = (typeof supportedAppLocales)[number];
export type TranslationKey = keyof typeof enUS;
export type TranslationVariables = Record<string, string | number>;

export const localizationResources = {
  'en-US': enUS,
  'de-DE': deDE,
  'ru-RU': ruRU
} as const;

export const normalizeAppLocale = (language: string | null | undefined): AppLocale => {
  const normalized = language?.trim().replaceAll('_', '-').toLowerCase() ?? '';
  if (normalized.startsWith('de')) {
    return 'de-DE';
  }
  if (normalized.startsWith('ru')) {
    return 'ru-RU';
  }
  return 'en-US';
};

const i18n = createInstance();

void i18n.init({
  fallbackLng: 'en-US',
  initAsync: false,
  interpolation: {
    escapeValue: false,
    prefix: '{',
    suffix: '}'
  },
  keySeparator: false,
  load: 'currentOnly',
  nsSeparator: false,
  resources: {
    'en-US': { translation: enUS },
    'de-DE': { translation: deDE },
    'ru-RU': { translation: ruRU }
  },
  returnEmptyString: false,
  returnNull: false,
  supportedLngs: supportedAppLocales
});

const staticTranslationCache = new Map<string, string>();

export const translateForLanguage = (
  language: string | null | undefined,
  key: TranslationKey,
  variables: TranslationVariables = {}
): string => {
  const locale = normalizeAppLocale(language);
  if (Object.keys(variables).length > 0) {
    return i18n.t(key, { ...variables, lng: locale });
  }

  const cacheKey = `${locale}\u0000${key}`;
  const cached = staticTranslationCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const translated = i18n.t(key, { lng: locale });
  staticTranslationCache.set(cacheKey, translated);
  return translated;
};
