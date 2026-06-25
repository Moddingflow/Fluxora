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

    expect(app).toContain("import { SettingsWorkspace } from './features/settings/SettingsWorkspace';");
    expect(settingsWorkspace).toContain('className="settings-nav__header"');
    expect(settingsWorkspace).toContain('Connections, languages, and build transfer.');
    expect(settingsWorkspace).toContain('className="settings-card settings-card--connections"');
    expect(settingsWorkspace).toContain('className="settings-card settings-card--language"');
    expect(settingsWorkspace).toContain('<TransferSettingsPanel');
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
    expect(styles).toContain('.settings-nav__header');
    expect(styles).toContain('.settings-card--connections');
    expect(styles).toContain('.settings-card--language');
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
