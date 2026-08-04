import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ExecutableIdentity } from '../src/renderer/features/executables/ExecutableIdentity';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

describe('ExecutableIdentity', () => {
  it('uses a decorative real icon with a stable adjacent accessible name', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ExecutableIdentity, {
        displayName: 'SKSE',
        iconPath: 'C:\\Cache\\skse.png',
        size: 24
      })
    );

    expect(markup).toContain('<img');
    expect(markup).toContain('alt=""');
    expect(markup).toContain('SKSE');
    expect(markup).toContain('--executable-identity-size:24px');
  });

  it('renders the central Tabler fallback when no icon is available', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ExecutableIdentity, {
        displayName: 'Tool',
        iconPath: '',
        size: 20
      })
    );
    expect(markup).toContain('data-icon="app-window"');
    expect(markup).not.toContain('<img');
  });

  it('switches immediately to fallback on image failure', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'frontend-tauri', 'src', 'renderer', 'features', 'executables', 'ExecutableIdentity.tsx'),
      'utf8'
    );
    expect(source).toContain('onError={() => setImageFailed(true)}');
    expect(source).toContain("<Icon name=\"app-window\"");
  });
});
