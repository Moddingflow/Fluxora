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
    const buttonMarkup = renderToStaticMarkup(
      React.createElement(
        IconButton,
        { label: 'Open settings', variant: 'boxed' },
        React.createElement(Icon, { name: 'settings' })
      )
    );

    expect(iconMarkup).toContain('stroke="currentColor"');
    expect(buttonMarkup).toContain('aria-label="Open settings"');
    expect(buttonMarkup).toContain('title="Open settings"');
    expect(buttonMarkup).toContain('data-variant="boxed"');
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
    expect(cleanStatus).toContain('aria-label="No overwrite conflicts"');
    expect(mixedStatus).toContain('aria-label="Mixed overwrite conflicts"');
    expect(empty).toContain('role="alert"');
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
    expect(primitiveCss).toContain('.flx-button');
    expect(primitiveCss).toContain('.flx-icon-button');
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
