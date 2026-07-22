export type AiVoiceUiLocale = 'en' | 'ru' | 'de';

export const aiVoiceUiLocale = (language: string | null | undefined): AiVoiceUiLocale => {
  const normalized = language?.trim().toLowerCase() ?? '';
  if (normalized.startsWith('ru')) return 'ru';
  if (normalized.startsWith('de')) return 'de';
  return 'en';
};

export interface AiMicrophonePermissionCopy {
  allow: string;
  body: string;
  close: string;
  deny: string;
  title: string;
}

const permissionCopy: Record<AiVoiceUiLocale, AiMicrophonePermissionCopy> = {
  en: {
    allow: 'Allow',
    body: 'Fluxora uses the microphone only for local speech recognition. Audio stays in memory and is not sent online.',
    close: 'Close microphone permission dialog',
    deny: 'Deny',
    title: 'Allow microphone access'
  },
  ru: {
    allow: 'Разрешить',
    body: 'Fluxora использует микрофон только для локального распознавания речи. Аудио остаётся в памяти и не отправляется в сеть.',
    close: 'Закрыть запрос доступа к микрофону',
    deny: 'Отклонить',
    title: 'Разрешить доступ к микрофону'
  },
  de: {
    allow: 'Erlauben',
    body: 'Fluxora verwendet das Mikrofon nur für die lokale Spracherkennung. Audio bleibt im Arbeitsspeicher und wird nicht online gesendet.',
    close: 'Dialog für Mikrofonzugriff schließen',
    deny: 'Ablehnen',
    title: 'Mikrofonzugriff erlauben'
  }
};

export const aiMicrophonePermissionCopy = (language: string): AiMicrophonePermissionCopy =>
  permissionCopy[aiVoiceUiLocale(language)];

const processingStatus: Record<AiVoiceUiLocale, string> = {
  en: 'Transcribing locally',
  ru: 'Локальное распознавание речи',
  de: 'Lokale Spracherkennung'
};

export const aiVoiceProcessingStatus = (language: string): string =>
  processingStatus[aiVoiceUiLocale(language)];

const cancelVoiceLabel: Record<AiVoiceUiLocale, string> = {
  en: 'Cancel voice input',
  ru: 'Отменить голосовой ввод',
  de: 'Spracheingabe abbrechen'
};

export const aiVoiceCancelLabel = (language: string): string =>
  cancelVoiceLabel[aiVoiceUiLocale(language)];

const genericVoiceError: Record<AiVoiceUiLocale, string> = {
  en: 'Voice input failed. Try recording again.',
  ru: 'Не удалось запустить голосовой ввод. Попробуйте записать ещё раз.',
  de: 'Die Spracheingabe konnte nicht gestartet werden. Versuchen Sie die Aufnahme erneut.'
};

const voiceErrorMessages: Record<string, Record<AiVoiceUiLocale, string>> = {
  'speech.permission.denied': {
    en: 'Windows blocked microphone access. Open Windows microphone settings and try again.',
    ru: 'Windows заблокировала доступ к микрофону. Откройте настройки микрофона Windows и повторите попытку.',
    de: 'Windows hat den Mikrofonzugriff blockiert. Öffnen Sie die Windows-Mikrofoneinstellungen und versuchen Sie es erneut.'
  },
  'speech.permission.native-unavailable': {
    en: 'Microphone access could not be initialized. Restart Fluxora and try again.',
    ru: 'Не удалось инициализировать доступ к микрофону. Перезапустите Fluxora и повторите попытку.',
    de: 'Der Mikrofonzugriff konnte nicht initialisiert werden. Starten Sie Fluxora neu und versuchen Sie es erneut.'
  },
  'speech.microphone.missing': {
    en: 'No microphone was found. Check its connection and try again.',
    ru: 'Микрофон не найден. Проверьте подключение и повторите попытку.',
    de: 'Kein Mikrofon wurde gefunden. Prüfen Sie die Verbindung und versuchen Sie es erneut.'
  },
  'speech.microphone.busy': {
    en: 'The microphone is unavailable or already in use. Check it and try recording again.',
    ru: 'Микрофон недоступен или уже используется. Проверьте его и повторите запись.',
    de: 'Das Mikrofon ist nicht verfügbar oder wird bereits verwendet. Prüfen Sie es und versuchen Sie die Aufnahme erneut.'
  },
  'speech.audio.too-short': {
    en: 'The recording is too short. Try recording again.',
    ru: 'Запись слишком короткая. Попробуйте записать ещё раз.',
    de: 'Die Aufnahme ist zu kurz. Versuchen Sie die Aufnahme erneut.'
  },
  'speech.audio.too-long': {
    en: 'A voice recording can be at most five minutes. Start a new recording.',
    ru: 'Голосовая запись может длиться не более пяти минут. Начните новую запись.',
    de: 'Eine Sprachaufnahme darf höchstens fünf Minuten lang sein. Starten Sie eine neue Aufnahme.'
  },
  'speech.no-speech': {
    en: 'No speech was detected. Check the microphone and try recording again.',
    ru: 'Речь не обнаружена. Проверьте микрофон и повторите запись.',
    de: 'Es wurde keine Sprache erkannt. Prüfen Sie das Mikrofon und versuchen Sie die Aufnahme erneut.'
  },
  'speech.cancelled': {
    en: 'Voice transcription was cancelled.',
    ru: 'Распознавание речи отменено.',
    de: 'Die Spracherkennung wurde abgebrochen.'
  },
  'speech.model.hash-mismatch': {
    en: 'The local speech model is damaged. Reinstall Fluxora and try again.',
    ru: 'Локальная модель речи повреждена. Переустановите Fluxora и повторите попытку.',
    de: 'Das lokale Sprachmodell ist beschädigt. Installieren Sie Fluxora neu und versuchen Sie es erneut.'
  },
  'speech.model.corrupt': {
    en: 'The local speech model could not be loaded. Reinstall Fluxora and try again.',
    ru: 'Не удалось загрузить локальную модель речи. Переустановите Fluxora и повторите попытку.',
    de: 'Das lokale Sprachmodell konnte nicht geladen werden. Installieren Sie Fluxora neu und versuchen Sie es erneut.'
  },
  'speech.vad.hash-mismatch': {
    en: 'The local voice activity model is damaged. Reinstall Fluxora and try again.',
    ru: 'Локальная модель определения речи повреждена. Переустановите Fluxora и повторите попытку.',
    de: 'Das lokale Spracherkennungsmodell ist beschädigt. Installieren Sie Fluxora neu und versuchen Sie es erneut.'
  },
  'speech.host.timeout': {
    en: 'Local speech recognition timed out. Try recording again.',
    ru: 'Локальное распознавание речи превысило время ожидания. Повторите запись.',
    de: 'Die lokale Spracherkennung hat das Zeitlimit überschritten. Versuchen Sie die Aufnahme erneut.'
  },
  'speech.host.repeated-crash': {
    en: 'Local speech recognition stopped unexpectedly. Restart Fluxora and try again.',
    ru: 'Локальное распознавание речи неожиданно остановилось. Перезапустите Fluxora и повторите попытку.',
    de: 'Die lokale Spracherkennung wurde unerwartet beendet. Starten Sie Fluxora neu und versuchen Sie es erneut.'
  },
  'speech.host.missing': {
    en: 'The local speech component is missing. Reinstall Fluxora and try again.',
    ru: 'Локальный компонент речи отсутствует. Переустановите Fluxora и повторите попытку.',
    de: 'Die lokale Sprachkomponente fehlt. Installieren Sie Fluxora neu und versuchen Sie es erneut.'
  },
  'speech.resources.missing': {
    en: 'The local speech models are missing. Reinstall Fluxora and try again.',
    ru: 'Локальные модели речи отсутствуют. Переустановите Fluxora и повторите попытку.',
    de: 'Die lokalen Sprachmodelle fehlen. Installieren Sie Fluxora neu und versuchen Sie es erneut.'
  }
};

export const aiVoiceErrorMessage = (code: string, language: string): string => {
  const locale = aiVoiceUiLocale(language);
  return voiceErrorMessages[code]?.[locale] ?? genericVoiceError[locale];
};
