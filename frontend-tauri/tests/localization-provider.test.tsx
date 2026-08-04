import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  LocalizationProvider,
  useLocalization
} from '../src/localization/react';

const LocalizedAction = () => {
  const { locale, t } = useLocalization();
  return <button lang={locale}>{t('common.action.cancel')}</button>;
};

describe('LocalizationProvider', () => {
  it.each([
    ['en-us', 'en-US', 'Cancel'],
    ['de-de', 'de-DE', 'Abbrechen'],
    ['ru-ru', 'ru-RU', 'Отмена']
  ] as const)('renders %s copy from the bundled resource', (language, locale, label) => {
    const html = renderToStaticMarkup(
      <LocalizationProvider language={language}>
        <LocalizedAction />
      </LocalizationProvider>
    );

    expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain(`>${label}</button>`);
  });
});
