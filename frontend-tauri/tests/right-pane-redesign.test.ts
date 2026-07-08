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
    expect(app).toContain('className="right-pane-path-tree"');
    expect(app).toContain('aria-label="Selected mod data tree"');
    expect(app).not.toContain('aria-label="Plugin commands"');
    expect(app).not.toContain('Selected download');
  });

  it('keeps right pane actions routed through the typed facade and existing helpers', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('window.fluxora.plugins.list');
    expect(app).toContain('window.fluxora.plugins.setEnabled');
    expect(app).toContain('window.fluxora.plugins.setAllEnabled');
    expect(app).toContain('window.fluxora.plugins.move');
    expect(app).toContain('window.fluxora.downloads.importFile');
    expect(app).toContain('window.fluxora.downloads.install');
    expect(app).toContain('window.fluxora.archives.install');
    expect(app).toContain('window.fluxora.nxm.importInboundDownloads');
    expect(app).toContain('onDoubleClick={() => {');
    expect(app).toContain('window.fluxora.buildPaths.get');
    expect(app).toContain('window.fluxora.executables.launch');
    expect(app).toContain('window.fluxora.fluxPack.export');
    expect(app).toContain('window.fluxora.fluxPack.inspect');
    expect(app).toContain('window.fluxora.fluxPack.install');
    expect(app).not.toContain('@tauri-apps/api');
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
    expect(app).toMatch(/if \(id === 'plugins'\) \{\s+return null;/);
    expect(app).not.toContain('return String(pluginCount);');
    expect(app).not.toContain('enabled · ${filteredPluginItems.length} visible');

    expect(styles).toContain('.plugins-pane-toolbar');
    expect(styles).toContain('.plugins-info-trigger:hover .plugins-info-popover');
    expect(styles).toContain('.plugins-info-popover__row');
  });

  it('keeps the compact right pane styling aligned with the build-page UI-kit', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(styles).toContain('.right-pane-content--plugins');
    expect(styles).toContain('.right-pane-content--data');
    expect(styles).toContain('.right-pane-content--build');
    expect(styles).toContain('.plugin-hex-index');
    expect(styles).not.toContain('.plugin-type-badge');
    expect(styles).toContain('.build-pane--right .plugin-row > :nth-child(3)');
    expect(styles).not.toContain('.right-pane-detail-card');
    expect(styles).toContain('.right-pane-section');
    expect(styles).toContain('.right-pane-path-row code');
    expect(styles).toContain('.right-pane-section--fluxpack .fluxpack-panel');
  });

  it('uses table-shaped skeleton rows while downloads are loading', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(app).toContain('downloadSkeletonRows.map');
    expect(app).toContain('download-table--skeleton');
    expect(app).toContain("downloadsBusyLabel && downloadsWorkspace.loadState !== 'loading'");
    expect(styles).toContain('.download-row--skeleton');
    expect(styles).toContain('@keyframes downloadSkeletonSweep');
  });
});
