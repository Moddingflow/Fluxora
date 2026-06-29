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

  it('keeps the mod deletion splash progress bar at the standard loading width', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const loadingSplashRule =
      styles.match(/\.operation-overlay\.flx-loading-splash\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(loadingSplashRule).toContain('display: flex;');
    expect(loadingSplashRule).toContain('align-items: center;');
    expect(loadingSplashRule).toContain('justify-content: center;');
  });

  it('renders user-safe error states as alerts', () => {
    const markup = renderOverlay(
      overlay({ errorText: 'Install root is not writable.', isRunning: false })
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Install root is not writable.');
  });
});
