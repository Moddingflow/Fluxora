import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LocalizationProvider } from '../src/localization/react';
import {
  MOD_CREATION_NAME_MAX_LENGTH,
  ModCreationDialog,
  type ModCreationDialogState
} from '../src/renderer/features/mods/ModCreationDialog';

const noop = () => undefined;

const renderDialog = (state: ModCreationDialogState | null) =>
  renderToStaticMarkup(
    React.createElement(
      LocalizationProvider,
      { language: 'ru-RU' },
      React.createElement(ModCreationDialog, {
        state,
        onCancel: noop,
        onNameChange: noop,
        onSubmit: noop
      })
    )
  );

describe('mod creation dialog', () => {
  it('does not render when no creation request is active', () => {
    expect(renderDialog(null)).toBe('');
  });

  it('renders the separator title field and OK action', () => {
    const markup = renderDialog({
      kind: 'separator',
      name: 'Visuals',
      validationMessage: null
    });

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Создать разделитель');
    expect(markup).toContain('Название разделителя');
    expect(markup).toContain('value="Visuals"');
    expect(markup).toContain(`maxLength="${MOD_CREATION_NAME_MAX_LENGTH}"`);
    expect(markup).toContain('OK');
    expect(markup).toContain('aria-label="Закрыть создание разделителя"');
    expect(markup).not.toContain('Отмена');
  });

  it('renders empty-mod copy and validation feedback', () => {
    const markup = renderDialog({
      kind: 'empty-mod',
      name: '',
      validationMessage: 'Enter a mod name.'
    });

    expect(markup).toContain('Создать пустой мод');
    expect(markup).toContain('Название мода');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Enter a mod name.');
    expect(markup).toContain('disabled=""');
  });
});
