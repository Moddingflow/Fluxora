import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('mods pane redesign', () => {
  it('keeps the Phase 7 mods table on virtualized rows and typed facade mutations', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('className="mod-list mod-list--table"');
    expect(app).toContain('role="table" aria-label="Mod order"');
    expect(app).toContain('visibleModWindow.items.map');
    expect(app).toContain('<StatusDot');
    expect(app).toContain('modTableStatusView(item)');
    expect(app).toContain('window.fluxora.mods.setEnabled');
    expect(app).toContain('window.fluxora.mods.moveOrderItem');
    expect(app).toContain('window.fluxora.mods.createSeparator');
    expect(app).not.toContain('className="mod-overwrite-check"');
  });

  it('exposes bulk enable and disable actions from mod and plugin context menus', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('Включить все моды');
    expect(app).toContain('Выключить все моды');
    expect(app).toContain('void setAllModsEnabled(true)');
    expect(app).toContain('void setAllModsEnabled(false)');
    expect(app).toContain('Включить все плагины');
    expect(app).toContain('Выключить все плагины');
    expect(app).toContain('void setAllPluginsEnabled(true)');
    expect(app).toContain('void setAllPluginsEnabled(false)');
    expect(app).toContain('window.fluxora.plugins.setAllEnabled');
    expect(app).not.toContain("'Enabling all plugins'");
    expect(app).not.toContain("'Disabling all plugins'");
  });

  it('keeps the table surface visually aligned with the build-page UI-kit', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const primitives = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'design-system',
      'primitives',
      'primitives.css'
    );

    expect(styles).toContain('.build-pane__header--mods');
    expect(styles).toContain('.mods-pane-toolbar');
    expect(styles).toContain('.mod-list__head');
    expect(styles).toContain('grid-template-columns: minmax(180px, 1fr) minmax(78px, 88px) minmax(78px, 88px) minmax(110px, 124px);');
    expect(styles).toContain('height: 48px;');
    expect(styles).toContain('.mod-separator-cell');
    expect(styles).toContain('.mod-status-chip');
    expect(primitives).toContain('.flx-status-dot[data-state="none"]');
    expect(primitives).toContain('.flx-status-dot[data-state="mixed"]');
  });
});
