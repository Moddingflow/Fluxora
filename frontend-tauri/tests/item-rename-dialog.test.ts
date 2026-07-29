import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ItemRenameDialog,
  downloadRenameBaseName,
  itemRenameDialogCopy,
  type ItemRenameDialogState
} from '../src/renderer/features/rename/ItemRenameDialog';

const noop = () => undefined;

const renderDialog = (state: ItemRenameDialogState | null, language = 'en-us'): string =>
  renderToStaticMarkup(
    createElement(ItemRenameDialog, {
      language,
      onCancel: noop,
      onNameChange: noop,
      onSubmit: noop,
      state
    })
  );

describe('item rename dialog', () => {
  it('uses the established install-dialog shell for mod renaming', () => {
    const markup = renderDialog({
      currentName: 'Old Armor',
      isSubmitting: false,
      kind: 'mod',
      maxNameLength: 255,
      name: 'New Armor',
      validationMessage: null
    });

    expect(markup).toContain('install-modal-backdrop');
    expect(markup).toContain('install-modal-layout');
    expect(markup).toContain('install-dialog');
    expect(markup).toContain('install-dialog-header');
    expect(markup).toContain('install-dialog-body');
    expect(markup).toContain('install-dialog-actions');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Rename mod');
    expect(markup).toContain('value="New Armor"');
  });

  it('renders download-specific copy, validation, and a locked submitting state', () => {
    const markup = renderDialog(
      {
        currentName: 'Old Archive',
        isSubmitting: true,
        kind: 'download',
        maxNameLength: 248,
        name: 'New Archive',
        validationMessage: 'The name is already in use.'
      },
      'ru-ru'
    );

    expect(markup).toContain('Переименовать файл');
    expect(markup).toContain('Новое имя файла');
    expect(markup).toContain('Переименование…');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-busy="true"');
  });

  it('removes complete archive suffixes without corrupting compound formats', () => {
    expect(downloadRenameBaseName('My Mod.tar.gz')).toBe('My Mod');
    expect(downloadRenameBaseName('My Mod.7z')).toBe('My Mod');
    expect(downloadRenameBaseName('folder.name.zip')).toBe('folder.name');
    expect(downloadRenameBaseName('extensionless')).toBe('extensionless');
  });

  it('provides complete English, German, and Russian action copy', () => {
    expect(itemRenameDialogCopy('en-us', 'download')).toMatchObject({
      copyPathLabel: 'Copy as path',
      menuRenameLabel: 'Rename',
      title: 'Rename file'
    });
    expect(itemRenameDialogCopy('de-de', 'mod')).toMatchObject({
      menuRenameLabel: 'Umbenennen',
      title: 'Mod umbenennen'
    });
    expect(itemRenameDialogCopy('ru-ru', 'download')).toMatchObject({
      copyPathLabel: 'Копировать как путь',
      menuRenameLabel: 'Переименовать',
      title: 'Переименовать файл'
    });
  });
});
