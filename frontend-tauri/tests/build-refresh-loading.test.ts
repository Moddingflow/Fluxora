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
  it('keeps F5 refresh in the background without replacing committed workspace rows', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const refreshFlow =
      app.match(/const refreshBuildWorkspace = async[\s\S]*?refreshCurrentViewRef\.current = refreshCurrentView;/)?.[0] ??
      '';

    expect(app).toContain("createRendererOperationId('renderer_refresh')");
    expect(refreshFlow).toContain('showLoading: false');
    expect(refreshFlow).not.toContain('setInterfaceRefreshSplash');
    expect(app).not.toContain('renderInterfaceRefreshSplash');
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
    expect(styles).toContain('.flx-skeleton');
  });

  it('uses table-shaped first paint and keeps generic loading strips out of workspace refreshes', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const executableManager = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'executables',
      'ExecutableSettingsWindow.tsx'
    );
    const executableManagerStyles = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'executables',
      'executable-settings-window.css'
    );
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(app).toContain(
      "profilesWorkspace.loadState === 'loading' && profilesWorkspace.items.length === 0"
    );
    expect(app).toContain('profile-row--skeleton');
    expect(styles).toContain('.profile-row--skeleton');
    expect(app).not.toContain('executable-row--skeleton');
    expect(executableManager).toContain('loading && draft.length === 0');
    expect(executableManager).toContain('<Skeleton /><Skeleton /><Skeleton />');
    expect(executableManagerStyles).toContain('.executable-settings__skeleton');
    expect(app).toContain('const showBusy = options.showBusy ?? false;');
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
    expect(app).toContain("createRendererOperationId('build_content_workspace_delta')");
    expect(watcher).toMatch(/buildContentRefreshCoordinator\s*\.\s*schedule/);
    expect(watcher).toContain('drainPendingPathsWithRetry');
    expect(watcher).toContain('buildContentEventSequences.record');
    expect(watcher).toContain('await refreshWorkspaceDelta(');
    expect(watcher).not.toContain('loadModsWorkspace(reconciliationProject');
    expect(watcher).not.toContain('loadPluginsWorkspace(');
    expect(watcher).toContain('effectiveFileTreeCacheRef.current = {};');
    expect(watcher).not.toContain('setEffectiveFileTreeSnapshot(null);');
  });
});
