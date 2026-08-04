import { translateForLanguage } from '../../../localization';

export interface ManagerHandoffSettingsCopy {
  title: string;
  detail: string;
  action: string;
  opening: string;
  error: string;
  ariaLabel: string;
}

export const managerHandoffSettingsCopy = (
  language: string | null | undefined
): ManagerHandoffSettingsCopy => ({
  title: translateForLanguage(language, 'managerHandoff.title'),
  detail: translateForLanguage(language, 'managerHandoff.detail'),
  action: translateForLanguage(language, 'managerHandoff.action'),
  opening: translateForLanguage(language, 'managerHandoff.opening'),
  error: translateForLanguage(language, 'managerHandoff.error'),
  ariaLabel: translateForLanguage(language, 'managerHandoff.ariaLabel')
});
