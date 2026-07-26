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
    expect(app).toContain('items={displayedModItems}');
    expect(app).toContain('<StatusDot');
    expect(app).toContain('modTableStatusView(item)');
    expect(app).toContain("const visibleConflictHighlight =");
    expect(app).toContain("isCollapsed ? conflictHighlight : 'none'");
    expect(app).toContain('const visibleConflictHighlight = conflictSnapshotReady');
    expect(app).toContain('data-conflict-highlight={visibleConflictHighlight}');
    expect(app).toContain('isCollapsed ? conflictMarkerStates : []');
    expect(app).toContain('const visibleConflictMarkerStates = conflictSnapshotReady');
    expect(app).toContain('data-conflict-status={visibleConflictMarkerStates.join');
    expect(app).toContain('markers={modConflictScrollbarMarkers}');
    expect(app).toContain('modConflictMarkerStatesForHighlight(highlight)');
    expect(app).toContain('modConflictMarkerStatesForHighlight(conflictHighlight)');
    expect(app).toContain('className="mod-list-row__status mod-separator-status"');
    expect(app).toContain('className="mod-list__head-priority"');
    expect(app).toContain('className="mod-list-row__priority"');
    expect(app).toContain('className="workspace-skeleton workspace-skeleton--priority"');
    expect(app).toContain('modPriorityByOrderId(modsWorkspace.items)');
    expect(app).toContain('className="separator-toggle-button mod-separator-toggle-button"');
    expect(app).toContain('className="mod-separator-count"');
    expect(app).toContain('label={status.overwrite.title}');
    expect(app).toContain('states={visibleConflictMarkerStates}');
    expect(app).not.toContain('className="mod-separator-line"');
    expect(app).not.toContain('modSeparatorConflictMarkerStates(modsWorkspace.items, item.orderId)');
    expect(app).not.toContain('modConflictHighlightFromMarkerStates');
    expect(app).not.toContain('mergeModConflictMarkerStates');
    expect(app).not.toContain('const statusMarkers = item.isSeparator');
    expect(app).not.toContain("kind: 'mod-delete'");
    expect(app).not.toContain("runModMutation('Deleting separator'");
    expect(app).toContain('window.fluxora.mods.setEnabled');
    expect(app).toContain('window.fluxora.mods.moveOrderItem');
    expect(app).toContain('window.fluxora.mods.createSeparator');
    expect(app).toContain("createRendererOperationId('mods_delete_separator')");
    expect(app).toContain('removeDeletedModItems([item]);');
    expect(app).toContain('removeDeletedModItems(targets);');
    expect(app).toContain('await refreshAfterModDeletion(project);');
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

  it('exposes selected and bulk enable actions from plugin context menus', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('Включить все моды');
    expect(app).toContain('Выключить все моды');
    expect(app).toContain('void setAllModsEnabled(true)');
    expect(app).toContain('void setAllModsEnabled(false)');
    expect(app).toContain('Включить все плагины');
    expect(app).toContain('Выключить все плагины');
    expect(app).toContain('void setAllPluginsEnabled(true)');
    expect(app).toContain('void setAllPluginsEnabled(false)');
    expect(app).toContain('Включить выбранный плагин');
    expect(app).toContain('Включить выбранные плагины');
    expect(app).toContain('void setSelectedPluginsEnabled(true)');
    expect(app).toContain("createRendererOperationId('plugins_set_selected_enabled')");
    expect(app).toContain('window.fluxora.plugins.setAllEnabled');
    expect(app).not.toContain("'Enabling all plugins'");
    expect(app).not.toContain("'Disabling all plugins'");
  });

  it('creates mods, creates separators, packages and installs from the mods three-dot menu', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const dialog = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'mods',
      'ModCreationDialog.tsx'
    );
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
    expect(app).toContain('<span>Создать разделитель</span>');
    expect(app).toContain('<span>Создать пустой мод</span>');
    expect(app).toContain("openModCreationDialog('separator')");
    expect(app).toContain("openModCreationDialog('empty-mod')");
    expect(app).toContain('const targetIndex = modsWorkspace.items.length;');
    expect(app).toContain('<ModCreationDialog');
    expect(app).not.toContain("window.prompt('New mod name')");
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
    expect(styles).toContain('.mod-create-dialog {');
    expect(styles).toContain('.mod-create-dialog__field');
    expect(styles).not.toContain('.mod-list-row__menu-trigger');

    const modCreateDialogStyles = styles.match(/\.mod-create-dialog \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(modCreateDialogStyles).not.toContain('box-shadow');
    expect(styles).toMatch(/\.mod-create-dialog \.flx-input:focus-within \{\s*box-shadow: none;\s*\}/);

    expect(dialog).toContain("title: 'Создать разделитель'");
    expect(dialog).toContain("title: 'Создать пустой мод'");
    expect(dialog).toContain('MOD_CREATION_NAME_MAX_LENGTH = 255');
    expect(dialog).toContain('maxLength={MOD_CREATION_NAME_MAX_LENGTH}');
    expect(dialog).toContain('<Button disabled={!state.name.trim()} size="sm" type="submit">');
    expect(dialog).toContain('OK');
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
    expect(styles).toContain('--mod-list-columns: 68px minmax(180px, 1fr)');
    expect(styles).toContain('grid-template-columns: var(--mod-list-columns);');
    expect(styles).toContain('.mod-list__head-priority');
    expect(styles).toContain('.mod-list-row__priority');
    expect(styles).toContain('.workspace-skeleton--priority');
    expect(styles).toContain('height: 48px;');
    expect(styles).toContain('.mod-separator-cell');
    expect(styles).toContain('.mod-separator-toggle-button');
    expect(styles).toMatch(/\.mod-separator-cell\s*\{[^}]*justify-content: center;[^}]*\}/);
    expect(styles).toMatch(/\.mod-separator-title\s*\{[^}]*text-align: center;[^}]*\}/);
    expect(styles).toContain('.mod-overwrite-state-cell');
    expect(styles).toContain('.mod-list-row[data-conflict-highlight="overwrites"]');
    expect(styles).toContain('.mod-list-row:not(.mod-list-row--separator)[data-conflict-highlight="overwrites"]::before');
    expect(styles).not.toContain('.mod-list-row[data-conflict-highlight="overwrites"]::before');
    expect(styles).toContain('.mod-list-row:not(.mod-list-row--separator)[data-conflict-highlight="mixed"]');
    expect(styles).toContain('.mod-list-row--separator[data-conflict-highlight="overwrites"]');
    expect(styles).toContain('.mod-list-row--separator[data-conflict-highlight="overwritten"]');
    expect(styles).not.toContain('.mod-list-row--separator[data-conflict-highlight="mixed"]');
    expect(styles).not.toContain('.mod-separator-line');
    expect(styles).not.toContain('.mod-list-row[data-in-separator="true"]::before');
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
    expect(styles).toMatch(/\.mod-separator-status\s*\{[^}]*grid-column: 5 \/ 6;[^}]*\}/);
    expect(styles).not.toContain('.mod-conflict-markers > span');
    expect(styles).not.toContain('.mod-status-chip');
    expect(primitives).toContain('.flx-status-dot[data-state="none"]');
    expect(primitives).toContain('.flx-status-dot[data-state="mixed"]');
  });
});
