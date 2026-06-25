import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const fileExists = (...segments: string[]): boolean =>
  fs.existsSync(path.join(repoRoot, ...segments));

describe('redesign foundations', () => {
  it('keeps Tauri styles on the local redesign token entrypoint', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const tokens = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'design-system',
      'tokens',
      'foundations.css'
    );

    expect(styles).toContain('@import "./design-system/tokens/foundations.css";');
    expect(styles).not.toContain('fonts.googleapis.com');
    expect(styles).not.toContain('fonts.gstatic.com');
    expect(tokens).toContain('--flx-accent: #e6b450;');
    expect(tokens).toContain('--flx-accent-rgb: 230, 180, 80;');
    expect(tokens).toContain('--focus-ring: rgba(var(--flx-accent-hover-rgb), 0.72);');
    expect(tokens).not.toContain('--accent-blue');
  });

  it('bundles redesign brand, content and icon assets locally', () => {
    for (const requiredAsset of [
      ['frontend-tauri', 'src', 'renderer', 'assets', 'brand', 'Fluxora.png'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'brand', 'Fluxora.svg'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'brand', 'Fluxora.ico'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'images', 'SkyrimSpecialEditionIcon.png'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'images', 'mod-organizer-2.png'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'images', 'app-icon-placeholder.png'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'icons', 'window-close.svg'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'icons', 'settings.svg'],
      ['frontend-tauri', 'src-tauri', 'icons', 'Fluxora.png'],
      ['frontend-tauri', 'src-tauri', 'icons', 'Fluxora.ico']
    ]) {
      expect(fileExists(...requiredAsset), requiredAsset.join('/')).toBe(true);
    }
  });
});
