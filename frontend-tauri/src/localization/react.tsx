import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type PropsWithChildren
} from 'react';

import {
  normalizeAppLocale,
  translateForLanguage,
  type AppLocale,
  type TranslationKey,
  type TranslationVariables
} from './index';

export interface LocalizationContextValue {
  locale: AppLocale;
  t: (key: TranslationKey, variables?: TranslationVariables) => string;
}

const defaultLocale = normalizeAppLocale(null);
const defaultContext: LocalizationContextValue = {
  locale: defaultLocale,
  t: (key, variables) => translateForLanguage(defaultLocale, key, variables)
};

const LocalizationContext = createContext<LocalizationContextValue>(defaultContext);

export interface LocalizationProviderProps extends PropsWithChildren {
  language: string | null | undefined;
}

export const LocalizationProvider = ({ children, language }: LocalizationProviderProps) => {
  const locale = normalizeAppLocale(language);
  const t = useCallback(
    (key: TranslationKey, variables?: TranslationVariables) =>
      translateForLanguage(locale, key, variables),
    [locale]
  );
  const value = useMemo<LocalizationContextValue>(() => ({ locale, t }), [locale, t]);

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
};

export const useLocalization = (): LocalizationContextValue => useContext(LocalizationContext);
