import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  Badge,
  Button,
  Card,
  Checkbox,
  CustomSelect,
  EmptyState,
  FacetSpinner,
  Icon,
  IconButton,
  Input,
  LoadingSplash,
  NavItem,
  ProgressBar,
  SectionLabel,
  Select,
  StatusDot,
  Switch,
  Tabs
} from '../src/renderer/design-system';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const noop = () => undefined;

const collectSourceFiles = (directory: string): string[] => {
  const absoluteDirectory = path.join(repoRoot, directory);
  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const relativePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectSourceFiles(relativePath);
    }

    return /\.(css|ts|tsx)$/.test(entry.name) ? [relativePath] : [];
  });
};

describe('redesign primitives', () => {
  it('exports every Phase 3 primitive as typed React components', () => {
    for (const primitive of [
      Badge,
      Button,
      Card,
      Checkbox,
      CustomSelect,
      EmptyState,
      FacetSpinner,
      IconButton,
      Input,
      LoadingSplash,
      NavItem,
      ProgressBar,
      SectionLabel,
      Select,
      StatusDot,
      Switch,
      Tabs
    ]) {
      expect(typeof primitive).toBe('function');
    }
  });

  it('keeps icon-only controls labeled and icons on currentColor', () => {
    const iconMarkup = renderToStaticMarkup(React.createElement(Icon, { name: 'settings' }));
    const playMarkup = renderToStaticMarkup(
      React.createElement(Icon, { name: 'play', size: 16, strokeWidth: 2.35 })
    );
    const buttonMarkup = renderToStaticMarkup(
      React.createElement(
        IconButton,
        { label: 'Open settings', variant: 'boxed' },
        React.createElement(Icon, { name: 'settings' })
      )
    );

    expect(iconMarkup).toContain('stroke="currentColor"');
    expect(playMarkup).toContain('stroke-width="2.35"');
    expect(playMarkup).toContain('M5 5a2 2 0 0 1 3.008-1.728');
    expect(buttonMarkup).toContain('aria-label="Open settings"');
    expect(buttonMarkup).toContain('title="Open settings"');
    expect(buttonMarkup).toContain('data-variant="boxed"');
  });

  it('keeps primary buttons bold, font-aligned and free of decorative outlines', () => {
    const primitiveCss = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'design-system',
      'primitives',
      'primitives.css'
    );

    expect(primitiveCss).toContain('.flx-button[data-variant="primary"]');
    expect(primitiveCss).toContain('border-color: transparent;');
    expect(primitiveCss).toContain('font-family: var(--font-sans);');
    expect(primitiveCss).toContain('font-size: var(--fs-base);');
    expect(primitiveCss).toContain('font-weight: 800;');
    expect(primitiveCss).toContain('.flx-button[data-size="sm"][data-variant="primary"]');
    expect(primitiveCss).toContain('font-size: var(--fs-sm);');
  });

  it('preserves accessibility contracts for feedback and selection primitives', () => {
    const tabs = renderToStaticMarkup(
      React.createElement(Tabs, {
        tabs: [{ label: 'Plugins', value: 'plugins' }],
        value: 'plugins'
      })
    );
    const progress = renderToStaticMarkup(
      React.createElement(ProgressBar, {
        'aria-label': 'Install progress',
        label: 'Installing',
        value: 42,
        valueLabel: '42%'
      })
    );
    const status = renderToStaticMarkup(React.createElement(StatusDot, { state: 'overwritten' }));
    const cleanStatus = renderToStaticMarkup(React.createElement(StatusDot, { state: 'none' }));
    const mixedStatus = renderToStaticMarkup(React.createElement(StatusDot, { state: 'mixed' }));
    const spinner = renderToStaticMarkup(React.createElement(FacetSpinner));
    const empty = renderToStaticMarkup(
      React.createElement(EmptyState, { title: 'No builds', tone: 'error' })
    );

    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('role="tab"');
    expect(progress).toContain('role="progressbar"');
    expect(progress).toContain('aria-label="Install progress"');
    expect(progress).toContain('aria-valuenow="42"');
    expect(status).toContain('role="img"');
    expect(status).toContain('aria-label="Overwritten by others"');
    expect(status).toContain('flx-status-dot__icon');
    expect(cleanStatus).toContain('aria-label="No overwrite conflicts"');
    expect(cleanStatus).not.toContain('flx-status-dot__icon');
    expect(mixedStatus).toContain('aria-label="Mixed overwrite conflicts"');
    expect(spinner).toContain('stroke-width="6"');
    expect(empty).toContain('role="alert"');
  });

  it('keeps mod conflict indicators as filled downloaded SVG masks', () => {
    const plus = readText('Icons', 'conflict-overwrites-plus.svg');
    const minus = readText('Icons', 'conflict-overwritten-minus.svg');
    const circle = readText('Icons', 'conflict-fully-overwritten-dot.svg');
    const foundations = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'design-system',
      'tokens',
      'foundations.css'
    );
    const primitiveCss = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'design-system',
      'primitives',
      'primitives.css'
    );

    expect(plus).toContain('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z');
    expect(minus).toContain('M19 13H5v-2h14v2z');
    expect(circle).toContain('M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10');

    for (const icon of [plus, minus, circle]) {
      expect(icon).not.toContain('stroke=');
      expect(icon).not.toContain('<circle');
    }

    expect(foundations).toContain('--flx-conflict-overwrites: #4ade80;');
    expect(foundations).toContain('--flx-conflict-overwritten: #f87171;');
    expect(foundations).toContain('--flx-conflict-fully-overwritten: #7a828e;');
    expect(primitiveCss).toContain('border: 0;');
    expect(primitiveCss).toContain('background: transparent;');
    expect(primitiveCss).toContain('width: 72%;');
    expect(primitiveCss).toContain('height: 72%;');
  });

  it('renders the loading splash with rotating copy, progress percent and an escape hatch', () => {
    const splash = renderToStaticMarkup(
      React.createElement(LoadingSplash, {
        buildName: 'Foundation Edition',
        cancelLabel: 'Отмена',
        detail: 'Opening build progress',
        messages: ['Загружаем вашу сборку', 'Смотрим плагины'],
        onCancel: noop,
        progress: 47,
        subtitle: 'Foundation Edition'
      })
    );

    expect(splash).toContain('role="status"');
    expect(splash).toContain('Загружаем вашу сборку');
    expect(splash).toContain('Foundation Edition');
    expect(splash).toContain('Opening build progress');
    expect(splash).toContain('aria-valuenow="47"');
    expect(splash).toContain('47%');
    expect(splash).toContain('Отмена');
    expect(splash).toContain('flx-loading-splash__progress');

    const primitiveCss = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'design-system',
      'primitives',
      'primitives.css'
    );
    expect(primitiveCss).toContain(
      'grid-template-columns: minmax(0, 1fr) minmax(260px, 360px) minmax(0, 1fr);'
    );
    expect(primitiveCss).toContain('font-size: 32.5px;');
    expect(primitiveCss).toContain('font-weight: 800;');
  });

  it('renders the custom select as a renderer-only combobox shell', () => {
    const combo = renderToStaticMarkup(
      React.createElement(CustomSelect, {
        ariaLabel: 'Profile',
        density: 'compact',
        onValueChange: noop,
        options: [
          { label: 'Foundation Edition', value: 'foundation' },
          { label: 'Testing', value: 'testing' }
        ],
        value: 'foundation'
      })
    );

    expect(combo).toContain('role="combobox"');
    expect(combo).toContain('aria-expanded="false"');
    expect(combo).toContain('aria-label="Profile"');
    expect(combo).toContain('flx-custom-select');
    expect(combo).toContain('Foundation Edition');
    expect(combo).not.toContain('<select');
  });

  it('keeps primitive styles on the public CSS entrypoint with reduced-motion support', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const primitiveCss = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'design-system',
      'primitives',
      'primitives.css'
    );

    expect(styles).toContain('@import "./design-system/primitives/primitives.css";');
    expect(styles).not.toContain('button:not(:disabled):active');
    expect(styles).not.toContain('.phase-tile:active');
    expect(styles).not.toContain('.archive-tree-row:active');
    expect(primitiveCss).toContain('.flx-button');
    expect(primitiveCss).toContain('.flx-icon-button');
    expect(primitiveCss).toContain('stroke: currentColor;');
    expect(primitiveCss).not.toContain('.flx-button:not(:disabled):active');
    expect(primitiveCss).not.toContain('.flx-icon-button:not(:disabled):active');
    expect(primitiveCss).not.toContain('.flx-switch:not(:disabled):active');
    expect(primitiveCss).not.toContain('.flx-nav-item:not(:disabled):active');
    expect(primitiveCss).not.toContain('.flx-tabs__tab:not(:disabled):active');
    expect(primitiveCss).toContain('.flx-loading-splash__cancel');
    expect(primitiveCss).toContain('@keyframes flx-splash-message-in');
    expect(primitiveCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(primitiveCss).not.toContain('127, 176, 250');
  });

  it('keeps primitives pure renderer UI without prototype globals or native bridge access', () => {
    const files = collectSourceFiles(path.join('frontend-tauri', 'src', 'renderer', 'design-system'));
    const designSystemSource = files.map((file) => readText(file)).join('\n');
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(designSystemSource).not.toContain('FluxoraDesignSystem_c83a40');
    expect(designSystemSource).not.toContain('window.fluxora');
    expect(designSystemSource).not.toContain('@tauri-apps/api');
    expect(designSystemSource).not.toContain('from "node:');
    expect(app).toContain("window.location.hash === '#design-system'");
    expect(app).toContain('<PrimitivePreview />');
  });
});
