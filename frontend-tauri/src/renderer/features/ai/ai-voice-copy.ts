import { translateForLanguage, type TranslationKey } from '../../../localization';

export interface AiMicrophonePermissionCopy {
  allow: string;
  body: string;
  close: string;
  deny: string;
  title: string;
}

export const aiMicrophonePermissionCopy = (language: string): AiMicrophonePermissionCopy => ({
  allow: translateForLanguage(language, 'ai.voice.permission.allow'),
  body: translateForLanguage(language, 'ai.voice.permission.body'),
  close: translateForLanguage(language, 'ai.voice.permission.close'),
  deny: translateForLanguage(language, 'ai.voice.permission.deny'),
  title: translateForLanguage(language, 'ai.voice.permission.title')
});

export const aiVoiceProcessingStatus = (language: string): string =>
  translateForLanguage(language, 'ai.voice.processing');

export const aiVoiceCancelLabel = (language: string): string =>
  translateForLanguage(language, 'ai.voice.cancel');

export const aiVoiceErrorMessage = (code: string, language: string): string => {
  const key = `ai.voice.error.${code}` as TranslationKey;
  const localized = translateForLanguage(language, key);
  return localized === key
    ? translateForLanguage(language, 'ai.voice.error.generic')
    : localized;
};
