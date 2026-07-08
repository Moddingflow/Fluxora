import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  OperationOverlay,
  type OperationOverlayState
} from '../src/renderer/features/operations/OperationOverlay';

const noop = () => undefined;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const overlay = (patch: Partial<OperationOverlayState> = {}): OperationOverlayState => ({
  operationId: 'op_test',
  kind: 'fluxpack-install',
  title: 'Installing FluxPack',
  statusText: 'Copying files',
  currentItem: 'Skyrim graphics overhaul',
  percent: 44,
  isRunning: true,
  canClose: false,
  cancelRequested: false,
  createdProject: null,
  resultText: null,
  errorText: null,
  ...patch
});

const renderOverlay = (
  nextOverlay: OperationOverlayState,
  cancellationSupported = false
): string =>
  renderToStaticMarkup(
    React.createElement(OperationOverlay, {
      cancellationSupported,
      onCancel: noop,
      onClose: noop,
      overlay: nextOverlay
    })
  );

describe('operation overlays', () => {
  it('renders running operations through redesign feedback primitives', () => {
    const markup = renderOverlay(overlay(), true);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('flx-facet-spinner');
    expect(markup).toContain('flx-progress');
    expect(markup).toContain('operation-progress__bar operation-progress__bar--percent');
    expect(markup).toContain('aria-valuenow="44"');
    expect(markup).toContain('Отменить');
  });

  it('uses indeterminate progress only when the native API has no percent yet', () => {
    const markup = renderOverlay(overlay({ kind: 'fluxpack-export', percent: null }));

    expect(markup).toContain('data-indeterminate="true"');
    expect(markup).toContain('Waiting for progress');
  });

  it('lets NGIO grass cache generation cancel through its operation marker', () => {
    const markup = renderOverlay(
      overlay({
        kind: 'grass-cache',
        title: 'Генерация кэша травы'
      }),
      false
    );

    expect(markup).toContain('Отменить');
  });

  it('shows cancel for build creation even before native cancellation is available', () => {
    const markup = renderOverlay(
      overlay({
        kind: 'build-create',
        title: 'Creating build'
      }),
      false
    );

    expect(markup).toContain('Отменить');
    expect(markup).not.toContain('Закрыть');
  });

  it('disables build creation cancel after the user has requested cancellation', () => {
    const markup = renderOverlay(
      overlay({
        kind: 'build-create',
        title: 'Creating build',
        cancelRequested: true
      }),
      false
    );

    expect(markup).toContain('operation-splash__action--cancel" disabled=""');
    expect(markup).toContain('Отменить');
  });

  it('keeps build creation cancel visible while cleaning up a created project', () => {
    const markup = renderOverlay(
      overlay({
        kind: 'build-create',
        title: 'Cleaning up build',
        statusText: 'Removing partially created project',
        isRunning: false,
        canClose: true,
        createdProject: {
          id: 'foundation-edition',
          name: 'Foundation Edition',
          templateId: 'skyrim-special-edition',
          uiTemplateId: 'skyrim',
          gameName: 'Skyrim Special Edition',
          gamePath: 'E:\\Steam\\Skyrim Special Edition',
          installRootDirectory: 'E:\\Fluxora Builds',
          projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
          configPath:
            'C:\\Users\\Валера\\AppData\\Roaming\\Fluxora\\Builds\\Foundation Edition-9.json'
        }
      }),
      false
    );

    expect(markup).toContain('Отменить');
    expect(markup).not.toContain('Закрыть');
  });

  it('does not render the rapidly changing file path during build deletion', () => {
    const markup = renderOverlay(
      overlay({
        kind: 'build-delete',
        title: 'Deleting build',
        statusText: 'Удаляю файлы сборки',
        currentItem: 'mods\\Tomato\\textures\\architecture\\column01.dds',
        percent: 62
      })
    );

    expect(markup).toContain('Deleting build');
    expect(markup).toContain('Удаляю файлы сборки');
    expect(markup).not.toContain('mods\\Tomato\\textures\\architecture\\column01.dds');
  });

  it('renders mod deletion as the full loading splash with percent feedback', () => {
    const markup = renderOverlay(
      overlay({ kind: 'mod-delete', title: 'Удаляем мод', percent: 37 })
    );

    expect(markup).toContain('flx-loading-splash');
    expect(markup).toContain('operation-overlay--mod-delete');
    expect(markup).toContain('Удаляем мод');
    expect(markup).toContain('37%');
    expect(markup).toContain('aria-valuenow="37"');
    expect(markup).not.toContain('operation-overlay__panel');
    expect(markup).not.toContain('Deleting mod');
  });

  it('renders download deletion through the same full loading splash pattern', () => {
    const markup = renderOverlay(
      overlay({ kind: 'download-delete', title: 'Удаляем файл', percent: 42 })
    );

    expect(markup).toContain('flx-loading-splash');
    expect(markup).toContain('operation-overlay--download-delete');
    expect(markup).toContain('Удаляем файл');
    expect(markup).toContain('42%');
    expect(markup).toContain('aria-valuenow="42"');
    expect(markup).not.toContain('operation-overlay__panel');
  });

  it('starts download deletion with a loading splash before calling the native delete API', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toMatch(
      /const deleteDownload = async \(entry: FluxoraDownloadEntry\) => \{[\s\S]*beginOperationOverlay\(\{[\s\S]*kind: 'download-delete'[\s\S]*await window\.fluxora\.downloads\.delete[\s\S]*closeOperationOverlay\(operationId\);/
    );
  });

  it('centers deletion splash progress bars with a large nearby percent counter', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const primitiveStyles = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'design-system',
      'primitives',
      'primitives.css'
    );
    const loadingSplashRule =
      styles.match(/\.operation-overlay\.flx-loading-splash\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(loadingSplashRule).toContain('display: flex;');
    expect(loadingSplashRule).toContain('align-items: center;');
    expect(loadingSplashRule).toContain('justify-content: center;');
    expect(styles).toContain('.operation-overlay--download-delete .flx-loading-splash__panel');
    expect(styles).toContain('max-width: 580px;');
    expect(primitiveStyles).toContain(
      'grid-template-columns: minmax(0, 1fr) minmax(260px, 360px) minmax(0, 1fr);'
    );
    expect(primitiveStyles).toContain('.flx-loading-splash__progress .flx-progress');
    expect(primitiveStyles).toContain('font-size: 32.5px;');
    expect(primitiveStyles).toContain('font-weight: 800;');
  });

  it('centers regular operation progress bars with the percent next to the bar', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const progressRule = styles.match(/\.operation-progress__bar\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    const percentRule =
      styles.match(/\.operation-progress__bar--percent \.flx-progress__meta > strong\s*\{[\s\S]*?\n\}/)?.[0] ??
      '';

    expect(progressRule).toContain(
      'grid-template-columns: minmax(0, 1fr) minmax(280px, 520px) minmax(0, 1fr);'
    );
    expect(progressRule).toContain('column-gap: 8px;');
    expect(styles).toContain('.operation-progress__bar .flx-progress__track');
    expect(percentRule).toContain('font-size: 32.5px;');
    expect(percentRule).toContain('font-weight: 800;');
  });

  it('renders user-safe error states as alerts', () => {
    const markup = renderOverlay(
      overlay({ errorText: 'Install root is not writable.', isRunning: false })
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Install root is not writable.');
  });
});
