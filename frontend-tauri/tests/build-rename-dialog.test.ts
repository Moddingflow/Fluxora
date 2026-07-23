import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  BUILD_RENAME_NAME_MAX_LENGTH,
  BuildRenameDialog,
  buildRenameDialogCopy,
  type BuildRenameDialogState
} from '../src/renderer/features/library/BuildRenameDialog';

const noop = () => undefined;

const renderDialog = (
  state: BuildRenameDialogState | null,
  language = 'en-us'
): string =>
  renderToStaticMarkup(
    createElement(BuildRenameDialog, {
      language,
      onCancel: noop,
      onNameChange: noop,
      onSubmit: noop,
      state
    })
  );

describe('build rename dialog', () => {
  it('does not render without an active rename request', () => {
    expect(renderDialog(null)).toBe('');
  });

  it('renders a compact accessible rename form without redundant build context or actions', () => {
    const markup = renderDialog({
      currentName: 'SkyrimDragonis',
      gameName: 'Skyrim Special Edition',
      isSubmitting: false,
      name: 'SkyrimDragonis',
      validationMessage: null
    });

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Rename build');
    expect(markup).toContain('New build name');
    expect(markup).toContain('value="SkyrimDragonis"');
    expect(markup).toContain(`maxLength="${BUILD_RENAME_NAME_MAX_LENGTH}"`);
    expect(markup).toContain('Rename');
    expect(markup).not.toContain('Skyrim Special Edition');
    expect(markup).not.toContain('build-rename-dialog__icon');
    expect(markup).not.toContain('>Cancel<');
    expect(markup).not.toContain('tauri.localhost');
  });

  it('exposes inline validation and a locked submitting state', () => {
    const validationMarkup = renderDialog({
      currentName: 'SkyrimDragonis',
      gameName: 'Skyrim Special Edition',
      isSubmitting: false,
      name: '',
      validationMessage: 'Enter a build name.'
    });
    const submittingMarkup = renderDialog({
      currentName: 'SkyrimDragonis',
      gameName: 'Skyrim Special Edition',
      isSubmitting: true,
      name: 'Skyrim Ascendant',
      validationMessage: null
    });

    expect(validationMarkup).toContain('role="alert"');
    expect(validationMarkup).toContain('Enter a build name.');
    expect(validationMarkup).toContain('data-invalid="true"');
    expect(submittingMarkup).toContain('aria-busy="true"');
    expect(submittingMarkup).toContain('Renaming…');
  });

  it('provides complete English, German and Russian copy', () => {
    expect(buildRenameDialogCopy('en-us')).toMatchObject({
      inputLabel: 'New build name',
      renameLabel: 'Rename',
      title: 'Rename build'
    });
    expect(buildRenameDialogCopy('de-de')).toMatchObject({
      inputLabel: 'Neuer Name der Sammlung',
      renameLabel: 'Umbenennen',
      title: 'Sammlung umbenennen'
    });
    expect(buildRenameDialogCopy('ru-ru')).toMatchObject({
      inputLabel: 'Новое название сборки',
      renameLabel: 'Переименовать',
      title: 'Переименовать сборку'
    });
  });
});
