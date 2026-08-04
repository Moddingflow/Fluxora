import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  DeletionConfirmationDialog,
  type DeletionConfirmationKind
} from '../src/renderer/features/deletion/DeletionConfirmationDialog';

const noop = () => undefined;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const renderDialog = (
  kind: DeletionConfirmationKind,
  itemName = 'SkyUI 5.2',
  itemCount?: number,
  description?: string,
  language = 'ru-ru'
) =>
  renderToStaticMarkup(
    React.createElement(DeletionConfirmationDialog, {
      itemCount,
      itemName,
      kind,
      language,
      description,
      onCancel: noop,
      onConfirm: noop
    })
  );

describe('deletion confirmation dialog', () => {
  it('adapts the title for mods, separators, builds and downloaded files', () => {
    expect(renderDialog('mod')).toContain('Удаление мода');
    expect(renderDialog('separator', 'Visual separators')).toContain('Удаление разделителя');
    expect(renderDialog('build', 'Skyrim graphics overhaul')).toContain('Удаление сборки');
    expect(renderDialog('download', 'Texture Pack.7z')).toContain('Удаление файла');
  });

  it('renders the requested chrome, item name and delete action', () => {
    const markup = renderDialog('mod');

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('delete-confirmation-dialog__icon');
    expect(markup).toContain('Закрыть окно удаления');
    expect(markup).toContain('SkyUI 5.2');
    expect(markup).toContain('Удалить');
  });

  it('uses Russian count labels for bulk mod, separator and download deletion', () => {
    expect(renderDialog('mod', 'SkyUI 5.2', 5)).toContain('5 модов');
    expect(renderDialog('mod', 'SkyUI 5.2', 10)).toContain('10 модов');
    expect(renderDialog('separator', 'Visual separators', 3)).toContain('3 разделителя');
    expect(renderDialog('separator', 'Visual separators', 5)).toContain('5 разделителей');
    expect(renderDialog('download', 'Texture Pack.7z', 2)).toContain('2 файла');
    expect(renderDialog('download', 'Texture Pack.7z', 5)).toContain('5 файлов');
  });

  it('provides complete English and German deletion copy', () => {
    expect(renderDialog('download', 'Texture Pack.7z', 5, undefined, 'en-us')).toContain(
      '5 files'
    );
    expect(renderDialog('mod', 'SkyUI 5.2', 2, undefined, 'de-de')).toContain('2 Mods');
    expect(renderDialog('build', 'Skyrim', 1, undefined, 'de-de')).toContain('Build löschen');
  });

  it('warns that deleting an archive affects the global game library but not installed mods', () => {
    const warning =
      'Архив будет удалён из глобальной библиотеки Downloads для всех сборок этой игры. Уже установленные моды останутся на месте.';
    expect(renderDialog('download', 'Texture Pack.7z', 1, warning)).toContain(warning);

    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    expect(app).toContain("t('app.message.downloadDeleteDescription')");
  });

  it('routes destructive mod, separator, build and download actions through the in-app confirmation', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('<DeletionConfirmationDialog');
    expect(app).toContain('itemCount={deletionConfirmation.itemCount}');
    expect(app).toContain('requestDeleteInstalledMod(item)');
    expect(app).toContain('requestDeleteModSeparatorSelection(item)');
    expect(app).toContain('requestDeletePluginSeparatorSelection(item)');
    expect(app).toContain('requestDeleteProject(project)');
    expect(app).toContain('requestDeleteDownload(entry)');
    expect(app).toContain('itemCount: targets.length');
    expect(app).toContain('onConfirm: () => deleteModSeparators(separatorOrderIds)');
    expect(app).toContain('onConfirm: () => deletePluginSeparators(separatorOrderIds)');
    expect(app).toContain('onConfirm: () => deleteInstalledMods(targets)');
    expect(app).toContain('onConfirm: () => deleteDownloads(targets)');
    expect(app).toContain("kind: 'mod'");
    expect(app).toContain("kind: 'separator'");
    expect(app).toContain("kind: 'build'");
    expect(app).toContain("kind: 'download'");
    expect(app).not.toContain("'Deleting mod separator'");
    expect(app).not.toContain("'Deleting plugin separator'");
    expect(app).not.toContain('window.confirm(`Удалить установленный мод');
    expect(app).not.toContain('window.confirm(`Удалить файл из загрузок');
    expect(app).not.toContain('window.confirm(`Delete build');
  });

  it('uses the compact titlebar-style dialog surface and icon mask', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(styles).toContain('.delete-confirmation-dialog__title');
    expect(styles).toContain('mask: var(--delete-confirmation-icon) center / contain no-repeat;');
    expect(styles).toContain('.delete-confirmation-dialog__actions .danger-button');
  });
});
