import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('build refresh loading', () => {
  it('renders F5 refresh through the full loading splash', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('interfaceRefreshMessages');
    expect(app).toContain('setInterfaceRefreshSplash({');
    expect(app).toContain("createRendererOperationId('renderer_refresh')");
    expect(app).toContain('title="Обновляем интерфейс"');
    expect(app).toContain('renderInterfaceRefreshSplash()');
  });

  it('keeps mods and plugins table-shaped while initial rows are loading', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(app).toContain(
      "modsWorkspace.loadState === 'loading' && modsWorkspace.items.length === 0"
    );
    expect(app).toContain(
      "pluginsWorkspace.loadState === 'loading' && pluginsWorkspace.items.length === 0"
    );
    expect(app).toContain('mod-list-row--skeleton');
    expect(app).toContain('plugin-row--skeleton');
    expect(styles).toContain('.mod-list-row--skeleton,');
    expect(styles).toContain('.plugin-row--skeleton {');
    expect(styles).toContain('min-height: 48px;');
    expect(styles).toContain('.workspace-skeleton');
  });
});
