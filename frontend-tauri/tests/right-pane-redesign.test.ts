import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('right pane redesign', () => {
  it('keeps visible Phase 8 tabs, panels and details in the build workspace', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain("type RightPaneId = 'plugins' | 'data' | 'downloads' | 'build';");
    expect(app).toContain("label: 'Плагины'");
    expect(app).toContain("label: 'Данные'");
    expect(app).toContain("label: 'Загрузки'");
    expect(app).not.toContain("label: 'Сборка'");
    expect(app).toContain('renderPluginsRightPane');
    expect(app).toContain('renderDataRightPane');
    expect(app).toContain('renderDownloadsRightPane');
    expect(app).toContain('renderBuildRightPane');
    expect(app).not.toContain('renderRightPanePluginDetails');
    expect(app).not.toContain('aria-label="Selected plugin detail"');
    expect(app).toContain('className="right-pane-section"');
    expect(app).toContain('className="right-pane-data-tree file-tree"');
    expect(app).toContain('aria-label="Effective game root"');
    expect(app).toContain('visibleEffectiveFileTreeWindow.items.map(renderEffectiveFileTreeRow)');
    expect(app).toContain('renderEffectiveFileTreeSkeletonRows');
    expect(app).not.toContain('Project paths and selected mod files');
    expect(app).not.toContain('Selected mod data');
    expect(app).not.toContain('renderRightPaneDataPathRows');
    expect(app).not.toContain('RightPaneDataPathRow');
    expect(app).not.toContain('className="right-pane-path-tree"');
    expect(app).not.toContain('aria-label="Plugin commands"');
    expect(app).not.toContain('Selected download');
  });

  it('renders the data pane from the effective game-root tree without selected-mod copy or loading text', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const dataPane =
      app.match(/const renderDataRightPane = \(\) => \{[\s\S]*?const renderBuildRightPane/)?.[0] ??
      '';

    expect(app).toContain('window.fluxora.mods.getEffectiveFileTreeRoot');
    expect(app).toContain('window.fluxora.mods.getEffectiveFileTreeChildren');
    expect(app).toContain("const [expandedEffectiveFileTree");
    expect(app).toContain("Data: true");
    expect(app).toContain("const buildWorkspaceVisible = activeRoute === 'build' || activeRoute === 'workspace';");
    expect(app).toContain("const dataTreeVisible = buildWorkspaceVisible && activeRightPane === 'data';");
    expect(app).toContain('requestKey: effectiveFileTreeRequestKey');
    expect(dataPane).toContain('role="tree"');
    expect(dataPane).toContain('aria-label="Effective game root"');
    expect(app).toContain('effectiveFileTreeSourceLabel(entry)');
    expect(app).toContain('openEffectiveFileTreeEntry(entry)');
    expect(app).toContain('createVirtualWindow(effectiveFileTreeRows');
    expect(dataPane).toContain('aria-busy={showInitialSkeleton || effectiveFileTreeState ===');
    expect(dataPane).toContain('renderEffectiveFileTreeSkeletonRows()');
    expect(dataPane).toContain('Данные недоступны.');
    expect(dataPane).toContain('Нет файлов в дереве.');
    expect(dataPane).not.toContain('selectedModItem');
    expect(dataPane).not.toContain('loadModFileTree');
    expect(dataPane).not.toContain('right-pane-path-list');
    expect(app).not.toContain('effectiveFileTreeRows.map(renderEffectiveFileTreeRow)');
    expect(dataPane).not.toContain('Loading tree');
    expect(dataPane).not.toContain("['Project'");
    expect(dataPane).not.toContain('Open Mods');
    expect(dataPane).not.toContain('Edit Mods');
  });

  it('keeps effective tree loading lazy, non-looping and free of unknown count badges', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const loadTree =
      app.match(/const loadEffectiveFileTree = async \([\s\S]*?const runModMutation/)?.[0] ??
      '';
    const effect =
      app.match(/const dataTreeVisible = buildWorkspaceVisible[\s\S]*?selectedProjectProfileName\s+\]\);/)?.[0] ??
      '';
    const watcher =
      app.match(
        /const unsubscribe = window\.fluxora\.buildContent\.onChanged\(\(event\) => \{[\s\S]*?return unsubscribe;/
      )?.[0] ??
      '';
    const rightPaneTabsHeader =
      app.match(/<header className="build-pane__header build-pane__header--tabs">[\s\S]*?<\/header>/)?.[0] ??
      '';
    const retryBlock =
      app.match(/onClick=\{\(\) =>\s+void loadEffectiveFileTree[\s\S]*?Повторить/)?.[0] ??
      '';

    expect(loadTree).toContain('effectiveFileTreeFailedRequestKeyRef.current === requestKey');
    expect(loadTree).toContain('effectiveFileTreeInFlightRequestKeyRef.current === requestKey');
    expect(loadTree).not.toContain('!options.force && effectiveFileTreeInFlightRequestKeyRef.current === requestKey');
    expect(loadTree).toContain('previousSnapshot?.revision === page.revision');
    expect(loadTree).toContain('mergeEffectiveFileTreePage(previousSnapshot, page)');
    expect(app).toContain('if (entry.parentPath === pageParentPath)');
    expect(app).toContain('effectiveFileTreeLoadingChildrenRef.current.has(childKey)');
    expect(loadTree).toContain('!dataTreeVisible && !canRefreshHiddenSnapshot');
    expect(effect).toContain('if (!dataTreeVisible && !canRefreshExistingTree)');
    expect(effect).toContain('effectiveFileTreeSnapshotRef.current !== null');
    expect(watcher).toContain('effectiveFileTreeCacheRef.current = {};');
    expect(watcher).toContain('effectiveFileTreeFailedRequestKeyRef.current = null;');
    expect(watcher).toContain('effectiveFileTreeLoadingChildrenRef.current.clear();');
    expect(watcher).toContain('activeRightPane === \'data\' || effectiveFileTreeSnapshotRef.current');
    expect(watcher).toContain('requestKey: effectiveFileTreeRequestKey');
    expect(watcher).not.toContain('build-content-changed');
    expect(watcher).not.toContain('setEffectiveFileTreeSnapshot(null);');
    expect(loadTree).not.toContain("setExpandedEffectiveFileTree((current) => ({ ...current, '': true, Data: true }))");
    expect(app).not.toContain('prepareWorkspaceIndexes(opened.projectDirectory');
    expect(app).not.toContain('const rightPaneTabCount');
    expect(app).not.toContain('const rightPaneSummary');
    expect(rightPaneTabsHeader).not.toContain('data-active-index');
    expect(rightPaneTabsHeader).toContain('aria-selected={activeRightPane === id}');
    expect(rightPaneTabsHeader).not.toContain('<h3>');
    expect(rightPaneTabsHeader).not.toContain('activeRightPaneSummary');
    expect(rightPaneTabsHeader).not.toContain('<strong>{count}</strong>');
    expect(retryBlock).toContain('force: true');
    expect(retryBlock).toContain('requestKey: effectiveFileTreeRequestKey');
    expect(retryBlock).not.toContain("requestKey: `${effectiveFileTreeRequestKey}\\nretry`");
  });

  it('keeps right pane actions routed through the typed facade and existing helpers', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('window.fluxora.plugins.list');
    expect(app).toContain('window.fluxora.plugins.setEnabled');
    expect(app).toContain('window.fluxora.plugins.setAllEnabled');
    expect(app).toContain('window.fluxora.plugins.move');
    expect(app).toContain('window.fluxora.downloads.importFile');
    expect(app).toContain('window.fluxora.installs.submit');
    expect(app).toContain('window.fluxora.nxm.importInboundDownloads');
    expect(app).toContain('window.fluxora.shell.openPath');
    expect(app).toContain('window.fluxora.mods.getEffectiveFileTreeRoot');
    expect(app).toContain('window.fluxora.windowControls.openTextEditor');
    expect(app).toContain('window.fluxora.windowControls.openFilePreview');
    expect(app).toContain('onClick={() => void openBuildPathSettings()}');
    expect(app).toContain('onDoubleClick={() => {');
    expect(app).toContain('window.fluxora.buildPaths.get');
    expect(app).toContain('window.fluxora.executables.launch');
    expect(app).toContain('window.fluxora.fluxPack.export');
    expect(app).toContain('window.fluxora.fluxPack.inspect');
    expect(app).toContain('window.fluxora.fluxPack.install');
    expect(app).not.toContain('@tauri-apps/api');
  });

  it('exposes the complete download status when the visible row text is truncated', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('<small title={status.text}>{status.text}</small>');
  });

  it('keeps the plugin table free of noisy type, state and action columns', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const pluginTableHeader =
      app.match(/aria-label="Plugin load order"[\s\S]*?<div\s+className="mod-table__body"/)?.[0] ??
      '';

    expect(pluginTableHeader).toContain('<span role="columnheader">Order</span>');
    expect(pluginTableHeader).toContain('<span role="columnheader">Plugin</span>');
    expect(pluginTableHeader).toContain('<span role="columnheader">Source</span>');
    expect(pluginTableHeader).toContain('<span role="columnheader">Статус</span>');
    expect(pluginTableHeader).not.toContain('<span role="columnheader">Type</span>');
    expect(pluginTableHeader).not.toContain('<span role="columnheader">State</span>');
    expect(pluginTableHeader).not.toContain('<span role="columnheader">Actions</span>');
  });

  it('moves Skyrim plugin slot counts into the search-row info popover', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(app).toContain("import infoCircleIcon from '../../../Icons/info-circle.svg';");
    expect(app).toContain('className="plugins-pane-toolbar"');
    expect(app).toContain('showPluginMissingMastersStatus ? (');
    expect(app).toContain('aria-label="Skyrim plugin slot information"');
    expect(app).toContain('Кол-во плагинов (включенных)');
    expect(app).toContain('Кол-во лёгких плагинов');
    expect(app).toContain('{enabledPluginSlotCounts.light} / 4096');
    expect(app).toContain('Кол-во тяжёлых плагинов');
    expect(app).toContain('{enabledPluginSlotCounts.heavy} / 256');
    expect(app).not.toContain('rightPaneTabCount');
    expect(app).not.toContain('return String(pluginCount);');
    expect(app).not.toContain('enabled · ${filteredPluginItems.length} visible');

    expect(styles).toContain('.plugins-pane-toolbar');
    expect(styles).toContain('.plugins-info-trigger:hover .plugins-info-popover');
    expect(styles).toContain('.plugins-info-popover__row');
  });

  it('keeps the compact right pane styling aligned with the build-page UI-kit', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const rightPaneTabsStyles = styles.match(/\.right-pane-tabs \{[\s\S]*?\n\}/)?.[0] ?? '';
    const activeRightPaneTabStyles =
      styles.match(/\.right-pane-tabs button\[data-active="true"\] \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(styles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(rightPaneTabsStyles).toContain('justify-self: stretch;');
    expect(rightPaneTabsStyles).toContain('width: 100%;');
    expect(styles).not.toContain('.right-pane-tabs::before');
    expect(styles).not.toContain('data-active-index');
    expect(styles).toContain('.right-pane-tabs button[data-active="true"]');
    expect(activeRightPaneTabStyles).toContain('color: #fff;');
    expect(activeRightPaneTabStyles).toContain('background-color: var(--flx-accent-soft);');
    expect(activeRightPaneTabStyles).not.toContain('box-shadow');
    expect(styles).toContain('background-color 150ms ease;');
    expect(styles).not.toContain('.right-pane-tabs strong');
    expect(styles).toContain('@keyframes rightPaneContentIn');
    expect(styles).toContain('.right-pane-content--plugins');
    expect(styles).toContain('.right-pane-content--data');
    expect(styles).toContain('height: 100%;');
    expect(styles).toContain('.right-pane-content--build');
    expect(styles).toContain('.plugin-hex-index');
    expect(styles).not.toContain('.plugin-type-badge');
    expect(styles).toContain('.build-pane--right .plugin-row > :nth-child(3)');
    expect(styles).not.toContain('.right-pane-detail-card');
    expect(styles).toContain('.right-pane-section');
    expect(styles).toContain('.right-pane-data-tree');
    expect(styles).toContain('.right-pane-data-row--skeleton');
    expect(styles).toContain('.right-pane-data-row code');
    expect(styles).toContain('.right-pane-data-row__source');
    expect(styles).toContain('.file-tree-row__action');
    expect(styles).not.toContain('.right-pane-section--tree');
    expect(styles).not.toContain('.right-pane-path-row code');
    expect(styles).toContain('.right-pane-section--fluxpack .fluxpack-panel');

    const dataTreeBlock =
      styles.match(/\.right-pane-data-tree \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(dataTreeBlock).not.toContain('border:');
    expect(dataTreeBlock).not.toContain('background:');
    expect(dataTreeBlock).not.toContain('border-radius:');
  });

  it('uses table-shaped skeleton rows while downloads are loading', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(app).toContain('downloadSkeletonRows.map');
    expect(app).toContain('download-table--skeleton');
    expect(app).toContain("downloadsBusyLabel && downloadsWorkspace.loadState !== 'loading'");
    expect(styles).toContain('.download-row--skeleton');
    expect(styles).toContain('.download-progress__fill-skeleton.flx-skeleton');
  });
});
