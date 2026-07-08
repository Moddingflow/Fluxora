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
    expect(app).toContain("const visibleConflictHighlight =");
    expect(app).toContain("item.isSeparator ? (isCollapsed ? conflictHighlight : 'none') : conflictHighlight");
    expect(app).toContain('data-conflict-highlight={visibleConflictHighlight}');
    expect(app).toContain("item.isSeparator ? (isCollapsed ? conflictMarkerStates : []) : conflictMarkerStates");
    expect(app).toContain('data-conflict-status={visibleConflictMarkerStates.join');
    expect(app).toContain('modConflictScrollbarMarkers.map');
    expect(app).toContain('modConflictMarkerStatesForHighlight(highlight)');
    expect(app).toContain('modConflictMarkerStatesForHighlight(conflictHighlight)');
    expect(app).toContain('className="mod-list-row__status mod-separator-status"');
    expect(app).toContain('label={status.overwrite.title}');
    expect(app).toContain('states={visibleConflictMarkerStates}');
    expect(app).not.toContain('modSeparatorConflictMarkerStates(modsWorkspace.items, item.orderId)');
    expect(app).not.toContain('modConflictHighlightFromMarkerStates');
    expect(app).not.toContain('mergeModConflictMarkerStates');
    expect(app).not.toContain('const statusMarkers = item.isSeparator');
    expect(app).toContain('window.fluxora.mods.setEnabled');
    expect(app).toContain('window.fluxora.mods.moveOrderItem');
    expect(app).toContain('window.fluxora.mods.createSeparator');
    expect(app).toMatch(
      /await window\.fluxora\.mods\.setEnabled[\s\S]*await loadModsWorkspace\(project, backgroundReorderLoadOptions\);/
    );
    expect(app).toMatch(
      /await window\.fluxora\.mods\.setAllEnabled[\s\S]*await loadModsWorkspace\(project, backgroundReorderLoadOptions\);/
    );
    expect(app).not.toContain('className="mod-overwrite-check"');
    expect(app).not.toContain('className="build-pane__tools mods-pane-toolbar"');
    expect(app).not.toContain('aria-label="Mod commands"');
    expect(app).toContain('MissingMastersStatus');
    expect(app).toContain('showPluginMissingMastersStatus');
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

  it('packages and installs the build from the mods search-row three-dot menu', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(app).toContain('className="mods-pane-toolbar"');
    expect(app).toContain('className="pane-menu-trigger"');
    expect(app).toContain('data-row-context-menu-trigger="true"');
    expect(app).toContain('aria-haspopup="menu"');
    expect(app).toContain('aria-expanded={Boolean(modsToolbarMenuPosition)}');
    expect(app).toContain('<MoreHorizontal size={15} aria-hidden="true" />');
    expect(app).toMatch(
      /className="pane-menu-trigger"[\s\S]*?rowContextMenuPositionFromAnchor\(\s*event\.currentTarget\.getBoundingClientRect\(\)\s*\)/
    );
    expect(app).toContain('aria-label="Действия со сборкой"');
    expect(app).toContain('<span>Упаковать</span>');
    expect(app).toContain('<span>Установить</span>');
    expect(app).toMatch(/const packageBuildDisabled =\s*\n\s*!selectedProject \|\|\s*\n\s*!buildHeaderCapabilities\.packageAvailable \|\|\s*\n\s*Boolean\(operationOverlay\?\.isRunning\)/);
    expect(app).toMatch(/renderModsToolbarMenu[\s\S]*?void packageFluxPack\(\);[\s\S]*?void installFluxPack\(\);/);
    expect(app).toContain("import menuHardDriveDownloadIcon from '../../../Icons/hard-drive-download.svg';");

    expect(app).not.toContain('mod-list-row__menu-trigger');
    expect(app).not.toContain('packageBuildMenuItem');

    expect(styles).toContain('.mods-pane-toolbar {');
    expect(styles).toContain('.mods-pane-toolbar > .pane-search {');
    expect(styles).toContain('.pane-menu-trigger {');
    expect(styles).toContain('.pane-menu-trigger[aria-expanded="true"]');
    expect(styles).not.toContain('.mod-list-row__menu-trigger');
  });

  it('keeps the table surface visually aligned with the build-page UI-kit', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const iconsReadme = readText('Icons', 'README.md');
    const exclamationIcon = readText('Icons', 'exclamation-lg.svg');
    const missingMasterTriggerBlock =
      styles.match(/\.plugin-missing-master-trigger\s*\{[^}]*\}/)?.[0] ?? '';
    const missingMasterHoverBlock =
      styles.match(/\.plugin-missing-master-trigger:hover,\s*\n\.plugin-missing-master-trigger:focus-visible\s*\{[^}]*\}/)?.[0] ?? '';
    const primitives = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'design-system',
      'primitives',
      'primitives.css'
    );

    expect(styles).toContain('.build-pane__header--mods');
    expect(styles).toContain('.build-pane > .pane-search');
    expect(styles).toContain('width: min(267px, calc(100% - 24px));');
    expect(styles).toMatch(/\.pane-search:focus-within\s*\{[^}]*border-color: var\(--flx-accent-hover\);[^}]*\}/);
    expect(styles).not.toMatch(/\.pane-search:focus-within\s*\{[^}]*box-shadow:/);
    expect(styles).toContain('.mods-pane-toolbar');
    expect(styles).toContain('.mod-list__head');
    expect(styles).toContain('grid-template-columns: minmax(180px, 1fr) minmax(78px, 88px) minmax(78px, 88px) minmax(56px, 64px);');
    expect(styles).toContain('height: 48px;');
    expect(styles).toContain('.mod-separator-cell');
    expect(styles).toContain('.mod-overwrite-state-cell');
    expect(styles).toContain('.mod-list-row[data-conflict-highlight="overwrites"]');
    expect(styles).toContain('.mod-list-row:not(.mod-list-row--separator)[data-conflict-highlight="overwrites"]::before');
    expect(styles).not.toContain('.mod-list-row[data-conflict-highlight="overwrites"]::before');
    expect(styles).toContain('.mod-list-row:not(.mod-list-row--separator)[data-conflict-highlight="mixed"]');
    expect(styles).toContain('.mod-list-row--separator[data-conflict-highlight="overwrites"]');
    expect(styles).toContain('.mod-list-row--separator[data-conflict-highlight="overwrites"] .mod-separator-line');
    expect(styles).toContain('.mod-list-row--separator[data-conflict-highlight="overwritten"]');
    expect(styles).toContain('.mod-list-row--separator[data-conflict-highlight="overwritten"] .mod-separator-line');
    expect(styles).not.toContain('.mod-list-row--separator[data-conflict-highlight="mixed"]');
    expect(styles).toContain('.mod-conflict-scrollbar');
    expect(styles).toContain('.mod-conflict-markers > .flx-status-dot');
    expect(styles).toContain('.mod-separator-conflicts');
    expect(styles).toContain('.mod-separator-status');
    expect(styles).toContain('.plugin-status-cell');
    expect(styles).toContain('.plugin-missing-master-tooltip');
    expect(missingMasterTriggerBlock).not.toContain('transform');
    expect(missingMasterHoverBlock).not.toContain('transform');
    expect(exclamationIcon).toContain('viewBox="0 0 16 16"');
    expect(iconsReadme).toContain('exclamation-lg.svg');
    expect(iconsReadme).toContain('BOOTSTRAP-ICONS-LICENSE.txt');
    expect(iconsReadme).toContain('commercial use');
    expect(styles).toMatch(/\.mod-separator-status\s*\{[^}]*grid-column: 4 \/ 5;[^}]*\}/);
    expect(styles).not.toContain('.mod-conflict-markers > span');
    expect(styles).not.toContain('.mod-status-chip');
    expect(primitives).toContain('.flx-status-dot[data-state="none"]');
    expect(primitives).toContain('.flx-status-dot[data-state="mixed"]');
  });
});
