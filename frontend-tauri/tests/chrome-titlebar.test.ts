import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppTitlebar } from '../src/renderer/components/chrome/AppTitlebar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const noop = () => undefined;

describe('redesign app chrome titlebar', () => {
  it('renders the UI-kit chrome with brand, shortcuts, window controls and drag regions', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AppTitlebar, {
        homeActive: true,
        onClose: noop,
        onHome: noop,
        onMinimize: noop,
        onOpenSettings: noop,
        onRefresh: noop,
        onToggleMaximize: noop
      })
    );

    expect(markup).toContain('Fluxora');
    expect(markup).toContain('data-tauri-drag-region');
    expect(markup).toContain('aria-label="Home"');
    expect(markup).toContain('aria-label="Refresh"');
    expect(markup).toContain('aria-label="Open settings"');
    expect(markup).toContain('aria-label="Minimize"');
    expect(markup).toContain('aria-label="Maximize"');
    expect(markup).toContain('aria-label="Close"');
    expect(markup).toContain('data-active="true"');
  });

  it('keeps the separate settings window branded while hiding main-window shortcuts', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AppTitlebar, {
        mode: 'settings',
        showShortcuts: false,
        title: 'Settings · Foundation Edition',
        onClose: noop,
        onMinimize: noop,
        onToggleMaximize: noop
      })
    );

    expect(markup).toContain('Fluxora');
    expect(markup).toContain('Settings · Foundation Edition');
    expect(markup).toContain('Fluxora settings window chrome');
    expect(markup).not.toContain('aria-label="Home"');
    expect(markup).not.toContain('aria-label="Open settings"');
    expect(markup).not.toContain('aria-label="Minimize"');
    expect(markup).not.toContain('aria-label="Maximize"');
    expect(markup).toContain('titlebar__caption-button--custom-close');
    expect(markup).toContain('data-icon="window-close"');
    expect(markup).toContain('mask-image:');
    expect(markup).not.toContain('<svg');
  });

  it('keeps chrome styling aligned with the compact UI-kit titlebar', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(styles).toContain('--flx-titlebar-height: 32px;');
    expect(styles).toContain(':root[data-platform="darwin"] .desktop-shell');
    expect(styles).toContain(':root[data-platform="linux"] .desktop-shell');
    expect(styles).toContain('grid-template-rows: var(--flx-titlebar-height) minmax(0, 1fr);');
    expect(styles).toContain('height: var(--flx-titlebar-height);');
    expect(styles).toContain('padding-left: 0;');
    expect(styles).toContain('width: var(--flx-titlebar-caption-width);');
    expect(styles).toContain('cursor: default;');
    expect(styles).toContain('--flx-titlebar-close-hover: #c42b1c;');
    expect(styles).toContain('.titlebar__caption-button--close:hover');
    expect(styles).toContain('background: var(--flx-titlebar-close-hover);');
    expect(styles).toContain('.titlebar--settings-window .titlebar__brand');
    expect(styles).toContain('text-overflow: ellipsis;');
    expect(styles).toContain('white-space: nowrap;');
    expect(styles).toContain('.titlebar__caption-button--custom-close');
  });

  it('preserves the Tauri window-control facade boundary', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const chrome = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'components',
      'chrome',
      'AppTitlebar.tsx'
    );

    expect(app).toContain('<AppTitlebar');
    expect(app).toContain('await window.fluxora.windowControls.openSettings();');
    expect(app).toContain('await window.fluxora.windowControls.minimize();');
    expect(app).toContain('await window.fluxora.windowControls.toggleMaximize();');
    expect(app).toContain('await window.fluxora.windowControls.close();');
    expect(app).toContain('document.documentElement.dataset.platform = chromePlatform;');
    expect(chrome).not.toContain('@tauri-apps/api');
    expect(chrome).not.toContain('window.fluxora');
  });

  it('disables minimize and maximize for every secondary Tauri window', () => {
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const secondaryWindowBuilderCount = rustShell.match(/WebviewWindowBuilder::new/g)?.length ?? 0;
    const disabledMinimizeCount = rustShell.match(/\.minimizable\(false\)/g)?.length ?? 0;
    const disabledMaximizeCount = rustShell.match(/\.maximizable\(false\)/g)?.length ?? 0;

    expect(secondaryWindowBuilderCount).toBeGreaterThan(0);
    expect(disabledMinimizeCount).toBe(secondaryWindowBuilderCount);
    expect(disabledMaximizeCount).toBe(secondaryWindowBuilderCount);
  });
});
