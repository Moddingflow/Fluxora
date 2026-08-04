import {
  normalizeAppLocale,
  translateForLanguage,
  type TranslationKey
} from '../localization';
import type { InstallerLanguage, NativeFailure, SetupMode } from './contracts';

export function installerLanguageFromLocale(locale: string | null | undefined): InstallerLanguage {
  const normalized = normalizeAppLocale(locale);
  if (normalized === 'de-DE') {
    return 'de';
  }
  if (normalized === 'ru-RU') {
    return 'ru';
  }
  return 'en';
}

export function translate(
  language: InstallerLanguage,
  key: string,
  variables: Record<string, string> = {}
): string {
  return translateForLanguage(language, key as TranslationKey, variables);
}

export function setupModeLabel(language: InstallerLanguage, mode: SetupMode): string {
  return translate(language, `setup.mode.${mode}`);
}

export function failureMessage(language: InstallerLanguage, failure: NativeFailure): string {
  const translated = translate(language, failure.messageKey);
  return translated === failure.messageKey
    ? translate(language, failure.code.startsWith('updater.') ? 'updater.error.generic' : 'setup.error.generic')
    : translated;
}
