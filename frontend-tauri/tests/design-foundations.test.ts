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

const fileSize = (...segments: string[]): number =>
  fs.statSync(path.join(repoRoot, ...segments)).size;

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
    expect(styles).toMatch(/body\s*{[\s\S]*font-size: 12px;/);
    expect(tokens).toContain('@font-face');
    expect(tokens).toContain('font-family: "Geist";');
    expect(tokens).toContain('font-family: "IBM Plex Mono";');
    expect(tokens).toContain('../../assets/fonts/geist/geist-latin-wght-normal.woff2');
    expect(tokens).toContain('../../assets/fonts/geist/geist-latin-ext-wght-normal.woff2');
    expect(tokens).toContain('../../assets/fonts/geist/geist-cyrillic-wght-normal.woff2');
    expect(tokens).toContain('../../assets/fonts/geist/geist-cyrillic-ext-wght-normal.woff2');
    expect(tokens).toContain('../../assets/fonts/geist/geist-vietnamese-wght-normal.woff2');
    expect(tokens).toContain('../../assets/fonts/ibm-plex/IBMPlexMono-Regular.woff2');
    expect(tokens).toContain('--font-sans: "Geist", "Noto Sans", "Segoe UI Variable"');
    expect(tokens).not.toContain('font-family: "Inter";');
    expect(tokens).not.toContain('font-family: "Source Sans 3";');
    expect(tokens).not.toContain('font-family: "Noto Sans UI";');
    expect(tokens).toContain('--flx-accent: #edb848;');
    expect(tokens).toContain('--flx-accent-rgb: 237, 184, 72;');
    expect(tokens).toContain('--focus-ring: rgba(var(--flx-accent-hover-rgb), 0.72);');
    expect(tokens).not.toContain('--accent-blue');
  });

  it('bundles commercial-safe Geist UI fonts locally', () => {
    for (const requiredFontAsset of [
      ['frontend-tauri', 'src', 'renderer', 'assets', 'fonts', 'geist', 'geist-latin-wght-normal.woff2'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'fonts', 'geist', 'geist-latin-wght-italic.woff2'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'fonts', 'geist', 'geist-latin-ext-wght-normal.woff2'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'fonts', 'geist', 'geist-cyrillic-wght-normal.woff2'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'fonts', 'geist', 'geist-cyrillic-ext-wght-normal.woff2'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'fonts', 'ibm-plex', 'IBMPlexMono-Regular.woff2'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'fonts', 'ibm-plex', 'IBMPlexMono-Medium.woff2'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'fonts', 'ibm-plex', 'IBMPlexMono-SemiBold.woff2'],
      ['frontend-tauri', 'src', 'renderer', 'assets', 'fonts', 'ibm-plex', 'IBMPlexMono-Bold.woff2']
    ]) {
      expect(fileExists(...requiredFontAsset), requiredFontAsset.join('/')).toBe(true);
      expect(fileSize(...requiredFontAsset), requiredFontAsset.join('/')).toBeGreaterThan(1_000);
    }

    const license = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'assets',
      'fonts',
      'geist',
      'LICENSE.txt'
    );

    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(license).toContain('redistributed and/or sold with any software');
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
