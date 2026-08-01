export type ManagerHandoffSettingsLocale = 'en' | 'ru' | 'de';

export interface ManagerHandoffSettingsCopy {
  title: string;
  detail: string;
  action: string;
  opening: string;
  error: string;
  ariaLabel: string;
}

const localeFromLanguage = (
  language: string | null | undefined
): ManagerHandoffSettingsLocale => {
  const normalized = language?.trim().toLowerCase() ?? '';
  if (normalized.startsWith('ru')) return 'ru';
  if (normalized.startsWith('de')) return 'de';
  return 'en';
};

const copy: Record<ManagerHandoffSettingsLocale, ManagerHandoffSettingsCopy> = {
  en: {
    title: 'Mod manager links',
    detail: 'Choose which compatible app opens moddingflow links in Windows.',
    action: 'Choose app',
    opening: 'Opening...',
    error: 'Windows Default Apps settings could not be opened.',
    ariaLabel: 'Choose the default app for moddingflow links'
  },
  ru: {
    title: 'Ссылки мод-менеджера',
    detail: 'Выберите в Windows приложение для открытия ссылок moddingflow.',
    action: 'Выбрать приложение',
    opening: 'Открываем...',
    error: 'Не удалось открыть настройки приложений по умолчанию Windows.',
    ariaLabel: 'Выбрать приложение по умолчанию для ссылок moddingflow'
  },
  de: {
    title: 'Mod-Manager-Links',
    detail: 'Wählen Sie in Windows eine App zum Öffnen von moddingflow-Links aus.',
    action: 'App auswählen',
    opening: 'Wird geöffnet...',
    error: 'Die Windows-Einstellungen für Standard-Apps konnten nicht geöffnet werden.',
    ariaLabel: 'Standard-App für moddingflow-Links auswählen'
  }
};

export const managerHandoffSettingsCopy = (
  language: string | null | undefined
): ManagerHandoffSettingsCopy => copy[localeFromLanguage(language)];
