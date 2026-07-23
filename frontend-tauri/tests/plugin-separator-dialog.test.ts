import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  PluginSeparatorDialog,
  pluginSeparatorCopy
} from '../src/renderer/features/plugins/PluginSeparatorDialog';

const renderDialog = (language: string): string =>
  renderToStaticMarkup(
    createElement(PluginSeparatorDialog, {
      language,
      onCancel: () => undefined,
      onNameChange: () => undefined,
      onSubmit: () => undefined,
      state: {
        name: 'Official content',
        validationMessage: null
      }
    })
  );

describe('plugin separator dialog', () => {
  it('renders a focused name form instead of relying on a browser prompt', () => {
    const markup = renderDialog('en-us');

    expect(markup).toContain('Create separator');
    expect(markup).toContain('Separator name');
    expect(markup).toContain('value="Official content"');
    expect(markup).toContain('maxLength="255"');
    expect(markup).toContain('Cancel');
  });

  it('provides complete English, German and Russian copy for the menu and dialog', () => {
    expect(pluginSeparatorCopy('en-us')).toMatchObject({
      menuLabel: 'Create separator',
      title: 'Create separator'
    });
    expect(pluginSeparatorCopy('de-de')).toMatchObject({
      menuLabel: 'Trenner erstellen',
      title: 'Trenner erstellen'
    });
    expect(pluginSeparatorCopy('ru-ru')).toMatchObject({
      menuLabel: 'Создать разделитель',
      title: 'Создать разделитель'
    });

    expect(renderDialog('de-de')).toContain('Name des Trenners');
    expect(renderDialog('ru-ru')).toContain('Название разделителя');
  });
});
