import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BuildSettingsWorkspace } from '../src/renderer/features/build/BuildSettingsWorkspace';
import type { BuildPathDraft } from '../src/renderer/build-workspace-state';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const readJson = <T,>(...segments: string[]): T =>
  JSON.parse(readText(...segments)) as T;

const draft = {
  projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
  gameExecutablePath: 'E:\\Fluxora Builds\\Foundation Edition\\Stock Game\\SkyrimSE.exe',
  gameDirectory: 'E:\\Fluxora Builds\\Foundation Edition\\Stock Game',
  modsDirectory: 'E:\\Fluxora Builds\\Foundation Edition\\mods',
  profilesDirectory: 'E:\\Fluxora Builds\\Foundation Edition\\profiles',
  downloadsDirectory: 'E:\\Fluxora Builds\\Foundation Edition\\downloads',
  overwriteDirectory: 'E:\\Fluxora Builds\\Foundation Edition\\overwrite'
} satisfies BuildPathDraft;

const noop = () => undefined;

describe('build settings window', () => {
  it('renders build paths inside the Settings left-nav shell', () => {
    const markup = renderToStaticMarkup(
      React.createElement(BuildSettingsWorkspace, {
        busyLabel: null,
        draft,
        error: null,
        isLoading: false,
        projectName: 'Foundation Edition',
        projectReady: true,
        onBrowseDirectory: noop,
        onBrowseGameExecutable: noop,
        onChange: noop,
        onClose: noop,
        onSave: noop
      })
    );

    expect(markup).toContain('settings-layout--build');
    expect(markup).toContain('Build settings sections');
    expect(markup).toContain('Пути');
    expect(markup).toContain('settings-panel--build-paths');
    expect(markup).toContain('Project directory');
    expect(markup).toContain('Game executable');
    expect(markup).toContain('Mods directory');
    expect(markup).not.toContain('Build settings</p>');
  });

  it('opens build settings as a dedicated Tauri window and syncs saved paths back to main', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const sharedApi = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const tauriConfig = readJson<{
      app: {
        windows: Array<{
          label?: string;
          maximized?: boolean;
        }>;
      };
    }>('frontend-tauri', 'src-tauri', 'tauri.conf.json');
    const capabilities = readText('frontend-tauri', 'src-tauri', 'capabilities', 'main.json');
    const dynamicWindowBuilderCount = rustShell.match(/WebviewWindowBuilder::new/g)?.length ?? 0;
    const centeredWindowBuilderCount = rustShell.match(/\.center\(\)/g)?.length ?? 0;

    expect(tauriConfig.app.windows).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'main', maximized: true })])
    );
    expect(app).toContain("const isBuildSettingsWindow = windowMode === 'build-settings';");
    expect(app).toContain("return `Settings · ${selectedProject?.name ?? (buildSettingsInitialName || 'Build')}`;");
    expect(app).toContain('window.fluxora.windowControls.openBuildSettings(');
    expect(app).toContain('<BuildSettingsWorkspace');
    expect(app).toContain('window.fluxora.buildSettings.notifyPathsSaved(nextProject)');
    expect(app).toContain('window.fluxora.buildSettings.onPathsSaved((project) => {');
    expect(sharedApi).toContain("windowOpenBuildSettings: 'fluxora:window:open-build-settings'");
    expect(sharedApi).toContain("buildSettingsPathsSaved: 'fluxora:build-settings:paths-saved'");
    expect(facade).toContain("invoke('fluxora_open_build_settings_window'");
    expect(facade).toContain("invoke('fluxora_build_settings_paths_saved'");
    expect(rustShell).toContain('BUILD_SETTINGS_WINDOW_LABEL_PREFIX');
    expect(rustShell).toContain('Settings \\u{00B7}');
    expect(rustShell).toContain('WebviewUrl::App("/?window=settings".into()),');
    expect(centeredWindowBuilderCount).toBe(dynamicWindowBuilderCount);
    expect(capabilities).toContain('"build-settings:*"');
  });
});
