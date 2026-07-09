import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BuildDetailHeader } from '../src/renderer/features/build/BuildDetailHeader';
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
  grassCacheAvailable: false,
  grassCacheReason: '',
  grassCacheVisible: false,
  isOperationRunning: false,
  language: 'en-us',
  launchAvailable: true,
  launchReason: '',
  onBack: noop,
  onExecutableChange: noop,
  onGenerateGrassCache: noop,
  onLaunch: noop,
  onProfileChange: noop,
  onSettings: noop,
  profileOptions: ['Default', 'Testing'],
  profilesBusyLabel: null,
  project,
  selectedExecutable: executable,
  selectedProfileName: 'Default',
  settingsBusyLabel: null
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
    expect(markup).not.toContain('248 mods');
    expect(markup).not.toContain('92 plugins');
    expect(markup).not.toContain('32.4 GB');
    expect(markup).not.toContain('Package');
    expect(markup).not.toContain('Check');
    expect(markup).toContain('aria-label="Build settings"');
    expect(markup).toContain('aria-label="Profile"');
    expect(markup).toContain('aria-label="Executable"');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('flx-custom-select');
    expect(markup).not.toContain('<select');
    expect(markup).toContain('Launch');
    expect(markup).toContain('stroke-width="2.35"');
  });

  it('surfaces capability reasons when a visible header action is unsupported', () => {
    const markup = renderHeader({
      buildCapabilities: {
        packageAvailable: true,
        packageReason: '',
        refreshAvailable: true,
        refreshReason: '',
        settingsAvailable: false,
        settingsReason: 'Build settings are unavailable on this bridge.'
      }
    });

    expect(markup).toContain('Build settings are unavailable on this bridge.');
    expect(markup).toContain('disabled=""');
  });

  it('keeps Phase 6 styling compact and aligned with the build-page UI-kit', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(styles).toContain('grid-template-areas:');
    expect(styles).toContain('"back title controls"');
    expect(styles).toContain('--build-header-control-size: 40px;');
    expect(styles).toContain('min-height: 82px;');
    expect(styles).toContain('height: var(--build-header-control-size);');
    expect(styles).toContain('.build-select--executable');
    expect(styles).toContain('.build-select .flx-custom-select');
    expect(styles).toContain('.flx-custom-select__menu');
    expect(styles).toContain('.build-header__capability-note');
  });

  it('keeps header actions wired to existing App handlers and typed facade calls', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('<BuildDetailHeader');
    expect(app).not.toContain('onPackage={() => void packageFluxPack()}');
    expect(app).not.toContain('onRefresh={() => void checkModUpdates()}');
    expect(app).toContain('onSettings={() => void openBuildPathSettings()}');
    expect(app).toContain('await window.fluxora.windowControls.openBuildSettings(');
    expect(app).toContain('onLaunch={() => void launchExecutable()}');
    expect(app).toContain('window.fluxora.executables.launch');
    expect(app).toContain('window.fluxora.fluxPack.export');
    expect(app).toContain('window.fluxora.mods.checkUpdates');
    expect(app).toContain('window.fluxora.buildPaths.get');
  });

  it('renders the NGIO grass cache action with localized tooltip text when enabled', () => {
    const markup = renderHeader({
      grassCacheAvailable: true,
      grassCacheVisible: true
    });
    const ruMarkup = renderHeader({
      grassCacheAvailable: true,
      grassCacheVisible: true,
      language: 'ru'
    });
    const icon = readText('frontend-tauri', 'src', 'renderer', 'assets', 'icons', 'grass-cache.svg');

    expect(markup).toContain('aria-label="No Grass In Objects Grass Cache Generation"');
    expect(markup).toContain('class="build-header__grass-trigger"');
    expect(markup).toContain('build-header__grass-icon');
    expect(markup).toContain('data:image/svg+xml');
    expect(markup).not.toContain('title="No Grass In Objects Grass Cache Generation"');
    expect(icon).toContain('Minimalistic white three-blade grass icon');
    expect(icon).toContain('fill="#FFFFFF"');
    expect(ruMarkup).toContain('aria-label="Генерация кэша травы No Grass In Objects"');
    expect(ruMarkup).not.toContain('title="Генерация кэша травы No Grass In Objects"');
  });

  it('keeps NGIO generation wired through a custom dialog and typed facade call', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const header = readText('frontend-tauri', 'src', 'renderer', 'features', 'build', 'BuildDetailHeader.tsx');
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(app).toContain('renderGrassCacheConfirmation()');
    expect(app).toContain('window.fluxora.grassCache.generate');
    expect(app).toContain('Сейчас начнётся генерация кэша травы');
    expect(app).not.toContain('window.confirm(`Generate grass cache');
    expect(header).toContain('window.innerHeight');
    expect(header).toContain('data-placement={grassTooltipPosition.placement}');
    expect(header).toContain('title={null}');
    expect(styles).toContain('.build-header__grass-tooltip');
    expect(styles).toContain('position: fixed;');
    expect(styles).toContain('.grass-cache-dialog');
  });
});
