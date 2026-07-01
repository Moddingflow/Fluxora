import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('mod details window', () => {
  it('opens installed mods in a dedicated Tauri window from double-click', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const sharedApi = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const capabilities = readText('frontend-tauri', 'src-tauri', 'capabilities', 'main.json');

    expect(app).toContain("const isModDetailsWindow = windowMode === 'mod-details';");
    expect(app).toContain('void openModDetailsWindow(item);');
    expect(app).toContain('window.fluxora.windowControls.openModDetails(');
    expect(app).toContain('role="tablist" aria-label="Mod details sections"');
    expect(app).toContain('Файлы');
    expect(app).toContain('Конфликты');
    expect(app).toContain('Перезаписывает:');
    expect(app).toContain('Перезаписывается:');
    expect(sharedApi).toContain("windowOpenModDetails: 'fluxora:window:open-mod-details'");
    expect(facade).toContain("invoke('fluxora_open_mod_details_window'");
    expect(rustShell).toContain('MOD_DETAILS_WINDOW_LABEL_PREFIX');
    expect(rustShell).toContain('Mod \\u{00B7}');
    expect(capabilities).toContain('"mod-details:*"');
  });

  it('uses downloaded commercial-use icon assets for the mod details tabs', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const iconsReadme = readText('Icons', 'README.md');
    const folderTree = readText('Icons', 'folder-tree.svg');
    const compare = readText('Icons', 'git-compare-arrows.svg');

    expect(app).toContain("../../../Icons/folder-tree.svg");
    expect(app).toContain("../../../Icons/git-compare-arrows.svg");
    expect(app).toContain('className="asset-icon"');
    expect(styles).toContain('.mod-details-window');
    expect(styles).toContain('mask: var(--asset-icon) center / contain no-repeat;');
    expect(iconsReadme).toContain('folder-tree.svg');
    expect(iconsReadme).toContain('git-compare-arrows.svg');
    expect(iconsReadme).toContain('Lucide is distributed under the ISC license');
    expect(folderTree).toContain('<svg');
    expect(compare).toContain('<svg');
  });

  it('opens text files from the mod tree in a larger app text editor window', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const editor = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'text-editor',
      'TextEditorWorkspace.tsx'
    );
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const sharedApi = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const capabilities = readText('frontend-tauri', 'src-tauri', 'capabilities', 'main.json');

    expect(app).toContain("const isTextEditorWindow = windowMode === 'text-editor';");
    expect(app).toContain('window.fluxora.windowControls.openTextEditor(');
    expect(app).toContain('isTextEditorFileName(entry.name)');
    expect(app).toContain('<TextEditorWorkspace');
    expect(editor).toContain("'.json'");
    expect(editor).toContain("'.txt'");
    expect(editor).toContain('text-editor-save-dot');
    expect(editor).toContain('Save All');
    expect(editor).toContain("runEditCommand('undo')");
    expect(editor).toContain("runEditCommand('redo')");
    expect(styles).toContain('.text-editor-window');
    expect(styles).toContain('.text-editor-save-dot[data-dirty="true"]');
    expect(sharedApi).toContain("windowOpenTextEditor: 'fluxora:window:open-text-editor'");
    expect(sharedApi).toContain('textFiles: {');
    expect(facade).toContain("invoke('fluxora_open_text_editor_window'");
    expect(facade).toContain("'mods.readTextFile'");
    expect(facade).toContain("'textFiles.save'");
    expect(rustShell).toContain('TEXT_EDITOR_WINDOW_LABEL_PREFIX');
    expect(rustShell).toContain('Editor \\u{00B7}');
    expect(rustShell).toContain('.inner_size(1344.0, 912.0)');
    expect(capabilities).toContain('"text-editor:*"');
  });
});
