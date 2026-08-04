import React, { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { LocalizationProvider } from '../src/localization/react';

export const renderLocalized = (
  element: ReactElement,
  language: string | null | undefined = 'ru-RU'
): string => renderToStaticMarkup(
  React.createElement(LocalizationProvider, { language }, element)
);
