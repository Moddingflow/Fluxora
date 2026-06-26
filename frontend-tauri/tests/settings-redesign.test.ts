import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TransferSettingsPanel } from '../src/renderer/TransferSettingsPanel';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

type TransferSettingsPanelProps = ComponentProps<typeof TransferSettingsPanel>;

const baseTransferProps: TransferSettingsPanelProps = {
  bridgeReady: true,
  transferAvailable: true,
  busyLabel: null,
  isRunning: false,
  cancellationSupported: true,
  cancelRequested: false,
  analysis: {
    sourceDirectory: 'E:\\MO2\\Skyrim',
    destinationRootDirectory: 'D:\\Fluxora',
    targetProjectDirectory: 'D:\\Fluxora\\Skyrim',
    targetConfigPath: 'D:\\Fluxora\\Skyrim\\fluxora.json',
    projectName: 'Skyrim',
    profileName: 'Default',
    templateId: 'skyrimse',
    gameName: 'Skyrim Special Edition',
    gamePath: 'E:\\Steam\\SkyrimSE.exe',
    totalBytes: 2048,
    availableBytes: 4096,
    modCount: 12,
    separatorCount: 2,
    hasEnoughSpace: true,
    willOverwrite: false,
    canImport: true,
    statusMessage: 'Ready',
    warningMessage: '',
    operationId: 'op_analysis'
  },
  progress: null,
  error: null,
  result: null,
  onOpenTransfer: () => undefined,
  onCancel: () => undefined
};

const renderTransferSettings = (
  overrides: Partial<TransferSettingsPanelProps> = {}
): string =>
  renderToStaticMarkup(
    React.createElement(TransferSettingsPanel, {
      ...baseTransferProps,
      ...overrides
    })
  );

describe('settings redesign', () => {
  it('keeps Settings as a UI-kit style left-nav layout backed by existing facade calls', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const settingsWorkspace = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'settings',
      'SettingsWorkspace.tsx'
    );
    const languageSelect = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'settings',
      'LanguageSelect.tsx'
    );
    const titlebar = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'components',
      'chrome',
      'AppTitlebar.tsx'
    );

    expect(app).toContain("import { SettingsWorkspace } from './features/settings/SettingsWorkspace';");
    expect(settingsWorkspace).not.toContain('className="settings-nav__header"');
    expect(settingsWorkspace).not.toContain('Connections, languages, and build transfer.');
    expect(settingsWorkspace).toContain('className="settings-connections-list"');
    expect(settingsWorkspace).toContain('settings-service-row--connection');
    expect(settingsWorkspace).toContain('<LanguageSelect');
    expect(languageSelect).toContain('settings-language-row');
    expect(languageSelect).toContain('../../../../../Icons/flag-united-kingdom.svg');
    expect(languageSelect).toContain('languageMenuViewportHeight = 330');
    expect(languageSelect).toContain('languageMenuContentHeight');
    expect(languageSelect).toContain('role="listbox"');
    expect(languageSelect).toContain('role="option"');
    expect(languageSelect).not.toContain('<select');
    expect(languageSelect).not.toContain('{selectedLanguage.countryName}');
    expect(languageSelect).not.toContain('{language.countryName}');
    for (const iconName of [
      'flag-united-kingdom.svg',
      'flag-russia.svg',
      'flag-germany.svg'
    ]) {
      expect(fs.existsSync(path.join(repoRoot, 'Icons', iconName))).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            repoRoot,
            'frontend-tauri',
            'src',
            'renderer',
            'assets',
            'images',
            iconName
          )
        )
      ).toBe(false);
    }
    expect(settingsWorkspace).not.toContain('settings.json - language=');
    expect(settingsWorkspace).not.toContain('Choose the renderer language.');
    expect(settingsWorkspace).toContain('<TransferSettingsPanel');
    expect(titlebar).toContain('titlebar__mark titlebar__mark--settings');
    expect(titlebar).toContain("isSettingsWindow ? 'Settings' : 'Fluxora'");
    expect(settingsWorkspace).not.toContain('Account bridge');
    expect(settingsWorkspace).not.toContain('Link Nexus Mods with OAuth');
    expect(settingsWorkspace).not.toContain('Refresh status');
    expect(app).toContain('window.fluxora.settings.setLanguage');
    expect(app).toContain('window.fluxora.nexus.getAuthStatus');
    expect(app).toContain('window.fluxora.nexus.connect');
    expect(app).toContain('window.fluxora.nexus.disconnect');
    expect(app).toContain('window.fluxora.transfer.analyzeMo2');
    expect(app).toContain('window.fluxora.transfer.importMo2');
    expect(app).toContain('window.fluxora.operations.cancel');
    expect(app).toContain('return window.fluxora.operations.onProgress((progress) => {');
    expect(app).not.toContain('@tauri-apps/api');
    expect(settingsWorkspace).not.toContain('window.fluxora.');
    expect(settingsWorkspace).not.toContain('@tauri-apps/api');
  });

  it('keeps Settings styling aligned with the compact UI-kit source', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(styles).toContain('grid-template-columns: 240px minmax(0, 1fr);');
    expect(styles).not.toContain('.settings-nav__header');
    expect(styles).toContain('.titlebar__mark--settings');
    expect(styles).toContain('.settings-connections-list');
    expect(styles).toContain('width: 100%;');
    expect(styles).toContain('.settings-service-row--connection');
    expect(styles).toContain('min-height: 74px;');
    expect(styles).toContain('.settings-language-row');
    expect(styles).toContain('*::-webkit-scrollbar-button:vertical:start:decrement');
    expect(styles).toContain('*::-webkit-scrollbar-button:vertical:end:increment');
    expect(styles).toContain('overflow-y: auto;');
    expect(styles).not.toContain('scrollbar-gutter: stable;');
    expect(styles).not.toContain('overflow-y: scroll;');
    expect(styles).toContain('.language-select__option:hover:not([data-selected="true"])');
    expect(styles).toContain('.language-select__option[data-highlighted="true"]:not([data-selected="true"])');
    expect(styles).toContain('background: rgba(var(--flx-accent-rgb), 0.15);');
    expect(styles).toContain('box-shadow: inset 0 0 0 1px rgba(var(--flx-accent-rgb), 0.12);');
    expect(styles).not.toContain('linear-gradient(180deg, rgba(var(--flx-accent-rgb), 0.18), rgba(var(--flx-accent-rgb), 0.1))');
    expect(styles).toContain('.settings-card--transfer');
    expect(styles).toContain('.transfer-entry-progress');
    expect(styles).toContain('.settings-facts--transfer');
  });

  it('renders MO2 transfer progress and operation-scoped cancellation in the Settings card', () => {
    const html = renderTransferSettings({
      isRunning: true,
      progress: {
        operationId: 'op_transfer_import',
        phase: 'copying',
        currentStep: 'Copy files',
        currentItem: 'SkyUI',
        overallPercent: 42,
        copyPercent: 55,
        databasePercent: 0,
        copiedBytes: 1024,
        totalBytes: 2048
      }
    });

    expect(html).toContain('Build transfer');
    expect(html).toContain('Mod Organizer 2');
    expect(html).toContain('MO2 transfer progress');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('Cancel and clean');
    expect(html).toContain('E:\\MO2\\Skyrim');
    expect(html).toContain('D:\\Fluxora\\Skyrim');
  });
});
