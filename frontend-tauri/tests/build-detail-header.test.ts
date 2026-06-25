import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BuildDetailHeader } from '../src/renderer/features/build/BuildDetailHeader';
import type { ProjectLibraryStats } from '../src/renderer/features/library/LibraryHome';
import type { FluxoraExecutable, FluxoraProject } from '../src/shared/fluxora-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const noop = () => undefined;

const project: FluxoraProject = {
  id: 'skyrim-main',
  name: 'Skyrim graphics overhaul',
  templateId: 'skyrim-special-edition',
  uiTemplateId: 'skyrim',
  gameName: 'Skyrim Special Edition',
  gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
  installRootDirectory: 'D:\\Fluxora\\Builds',
  projectDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul',
  configPath: 'D:\\Fluxora\\Configs\\skyrim-main.json'
};

const executable: FluxoraExecutable = {
  id: 'skse',
  displayName: 'SKSE',
  executablePath: 'C:\\Games\\Skyrim\\skse64_loader.exe',
  arguments: '-forcesteamloader',
  workingDirectory: 'C:\\Games\\Skyrim',
  iconPath: ''
};

const stats: ProjectLibraryStats = {
  disabledMods: '12',
  downloads: '4',
  lastLaunch: 'Jun 24, 2026',
  mods: '248',
  plugins: '92',
  size: '32.4 GB'
};

const defaultProps = {
  buildCapabilities: {
    packageAvailable: true,
    packageReason: '',
    refreshAvailable: true,
    refreshReason: '',
    settingsAvailable: true,
    settingsReason: ''
  },
  executables: [executable],
  executablesBusyLabel: null,
  isOperationRunning: false,
  launchAvailable: true,
  launchReason: '',
  onBack: noop,
  onExecutableChange: noop,
  onLaunch: noop,
  onPackage: noop,
  onProfileChange: noop,
  onRefresh: noop,
  onSettings: noop,
  profileOptions: ['Default', 'Testing'],
  profilesBusyLabel: null,
  project,
  refreshBusyLabel: null,
  selectedExecutable: executable,
  selectedProfileName: 'Default',
  settingsBusyLabel: null,
  stats
} satisfies React.ComponentProps<typeof BuildDetailHeader>;

const renderHeader = (
  overrides: Partial<React.ComponentProps<typeof BuildDetailHeader>> = {}
) => renderToStaticMarkup(React.createElement(BuildDetailHeader, { ...defaultProps, ...overrides }));

describe('build detail header redesign', () => {
  it('renders the UI-kit build shell controls on real project data', () => {
    const markup = renderHeader();

    expect(markup).toContain('aria-label="Build header"');
    expect(markup).toContain('Back');
    expect(markup).toContain('Skyrim graphics overhaul');
    expect(markup).toContain('Skyrim Special Edition');
    expect(markup).toContain('248 mods');
    expect(markup).toContain('92 plugins');
    expect(markup).toContain('32.4 GB');
    expect(markup).toContain('Package');
    expect(markup).toContain('Check');
    expect(markup).toContain('aria-label="Build settings"');
    expect(markup).toContain('aria-label="Profile"');
    expect(markup).toContain('aria-label="Executable"');
    expect(markup).toContain('Launch');
  });

  it('surfaces capability reasons when a header action is unsupported', () => {
    const markup = renderHeader({
      buildCapabilities: {
        packageAvailable: false,
        packageReason: 'FluxPack export is unavailable on this bridge.',
        refreshAvailable: true,
        refreshReason: '',
        settingsAvailable: true,
        settingsReason: ''
      }
    });

    expect(markup).toContain('FluxPack export is unavailable on this bridge.');
    expect(markup).toContain('disabled=""');
  });

  it('keeps Phase 6 styling compact and aligned with the build-page UI-kit', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(styles).toContain('grid-template-areas:');
    expect(styles).toContain('"back title controls"');
    expect(styles).toContain('min-height: 64px;');
    expect(styles).toContain('height: 34px;');
    expect(styles).toContain('.build-select--executable');
    expect(styles).toContain('.build-header__capability-note');
  });

  it('keeps header actions wired to existing App handlers and typed facade calls', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('<BuildDetailHeader');
    expect(app).toContain('onPackage={() => void packageFluxPack()}');
    expect(app).toContain('onRefresh={() => void checkModUpdates()}');
    expect(app).toContain('onSettings={() => void openBuildPathSettings()}');
    expect(app).toContain('onLaunch={() => void launchExecutable()}');
    expect(app).toContain('window.fluxora.executables.launch');
    expect(app).toContain('window.fluxora.fluxPack.export');
    expect(app).toContain('window.fluxora.mods.checkUpdates');
    expect(app).toContain('window.fluxora.buildPaths.get');
  });
});
