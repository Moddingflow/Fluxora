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

  it('refreshes mods and plugins from filesystem watcher events without loading chrome', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const watcher =
      app.match(
        /const unsubscribe = window\.fluxora\.buildContent\.onChanged\(\(event\) => \{[\s\S]*?return unsubscribe;/
      )?.[0] ??
      '';

    expect(app).toMatch(/window\.fluxora\.buildContent\s*\.\s*watch/);
    expect(app).not.toContain('modsDirectory: selectedProject.projectDirectory');
    expect(app).toContain('modsDirectory,');
    expect(app).toContain('profilesDirectory,');
    expect(app).toContain("createRendererOperationId('build_content_watch')");
    expect(app).toContain('loadedWorkspaceProjectId !== selectedProject.id');
    expect(app.indexOf("createRendererOperationId('build_content_watch_before_workspace')")).toBeLessThan(
      app.indexOf('await loadBuildWorkspaceData(opened')
    );
    expect(app).toMatch(/window\.fluxora\.buildContent\s*\.\s*onChanged/);
    expect(app).toContain("createRendererOperationId('build_content_mods_changed')");
    expect(app).toContain("createRendererOperationId('build_content_plugins_changed')");
    expect(watcher).toMatch(/buildContentRefreshCoordinator\s*\.\s*schedule/);
    expect(watcher).toContain('drainPendingPathsWithRetry');
    expect(watcher).toContain('buildContentEventSequences.record');
    expect(app).toContain('showBusy: false');
    expect(app).toContain('showLoading: false');
    expect(app).toContain('resetScroll: false');
    expect(watcher).toContain('effectiveFileTreeCacheRef.current = {};');
    expect(watcher).not.toContain('setEffectiveFileTreeSnapshot(null);');
  });
});
