import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const read = (...segments: string[]) => fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('executable settings secondary window contract', () => {
  it('uses a stable project-scoped native label and focused singleton lifecycle', () => {
    const rust = read('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    expect(rust).toContain('EXECUTABLE_SETTINGS_WINDOW_LABEL_PREFIX');
    expect(rust).toContain('fluxora_open_executable_settings_window');
    expect(rust).toContain('/?window=executable-settings&project={}');
    expect(rust).toContain('.inner_size(980.0, 700.0)');
    expect(rust).toContain('.min_inner_size(860.0, 620.0)');
    expect(rust).toContain('show_activation_window(&window, true)');
  });

  it('lazy-loads a focused renderer root and keeps its capability narrow', () => {
    const main = read('frontend-tauri', 'src', 'renderer', 'main.tsx');
    const capability = read('frontend-tauri', 'src-tauri', 'capabilities', 'main.json');
    expect(main).toContain("windowMode === 'executable-settings'");
    expect(main).toContain("import('./features/executables/ExecutableSettingsWindow')");
    expect(capability).toContain('"executable-settings:*"');
  });

  it('opens only through the typed window facade', () => {
    const shared = read('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const facade = read('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    expect(shared).toContain("windowOpenExecutableSettings: 'fluxora:window:open-executable-settings'");
    expect(shared).toContain('openExecutableSettings: (configPath: string, buildName: string)');
    expect(facade).toContain("invoke('fluxora_open_executable_settings_window'");
  });

  it('routes titlebar close and confirmed discard through the explicit close coordinator', () => {
    const source = read(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'executables',
      'ExecutableSettingsWindow.tsx'
    );

    expect(source).toContain('onClose={() => void closeWindow()}');
    expect(source).toContain('requestExecutableSettingsClose({');
    expect(source).toContain('window.fluxora.windowControls.forceClose()');
    expect(source).not.toContain('onClose={() => window.fluxora.windowControls.close()}');
  });

  it('allocates real height to both the ordered list and the editor', () => {
    const styles = read(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'executables',
      'executable-settings-window.css'
    );
    expect(styles).toContain(
      'grid-template-rows: minmax(186px, 0.9fr) minmax(245px, 1.1fr);'
    );
    expect(styles).not.toContain('minmax(186px, 0.9fr) 1px minmax(245px, 1.1fr)');
  });

  it('keeps executable rows icon-first and limits the editor to user-facing fields', () => {
    const source = read(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'executables',
      'ExecutableSettingsWindow.tsx'
    );
    const styles = read(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'executables',
      'executable-settings-window.css'
    );

    expect(source).not.toContain('name="move"');
    expect(source).not.toContain("t('executables.autoDetect')");
    expect(source).not.toContain("t('executables.field.workingDirectory')");
    expect(source).toContain('executable-settings__drag-preview');
    expect(styles).toContain('margin-right: -14px;');
    expect(styles).toContain('.executable-settings__drag-preview');
  });

  it('removes the old App editor and delegates primary upsert to native core', () => {
    const app = read('frontend-tauri', 'src', 'renderer', 'App.tsx');
    expect(app).not.toContain('renderExecutablesWorkspace');
    expect(app).not.toContain('renderExecutablesInspector');
    expect(app).not.toContain("activeRoute === 'executables'");
    expect(app).toContain('window.fluxora.executables.updatePrimary(');
    expect(app).not.toContain('buildPrimaryExecutableList(');
  });
});
