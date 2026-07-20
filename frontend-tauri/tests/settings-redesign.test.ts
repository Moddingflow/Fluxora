import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SettingsWorkspace } from '../src/renderer/features/settings/SettingsWorkspace';
import { TransferSettingsPanel } from '../src/renderer/TransferSettingsPanel';
import type {
  FluxoraApiLimitProvider,
  FluxoraAppInfo,
  FluxoraExternalConnectionStatus
} from '../src/shared/fluxora-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

type TransferSettingsPanelProps = ComponentProps<typeof TransferSettingsPanel>;
type SettingsWorkspaceProps = ComponentProps<typeof SettingsWorkspace>;

const baseTransferProps: TransferSettingsPanelProps = {
  bridgeReady: true,
  transferAvailable: true,
  busyLabel: null,
  isRunning: false,
  onOpenTransfer: () => undefined
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

const appInfo: FluxoraAppInfo = {
  appName: 'Fluxora',
  version: '0.0.0-test',
  platform: 'win32',
  arch: 'x64',
  isPackaged: false
};

const baseSettingsWorkspaceProps: SettingsWorkspaceProps = {
  apiLimitProviders: [],
  apiLimitsBusy: false,
  appInfo,
  bridgeStatus: null,
  developerModeEnabled: false,
  isTransferRunning: false,
  languageBusy: null,
  lastBuildDate: '2026-07-03T10:15:00.000Z',
  connectionBusyProviderId: null,
  connectionProviders: [],
  section: 'developers',
  settingsBusyLabel: null,
  settingsCapabilities: {
    settingsAvailable: false,
    nexusAvailable: false,
    transferAvailable: false,
    transferCancellationAvailable: false
  },
  onDeveloperModeChange: () => undefined,
  onOpenRepository: () => undefined,
  onOpenTransfer: () => undefined,
  onSectionChange: () => undefined,
  onSetLanguage: () => undefined,
  onToggleConnection: () => undefined
};

const cachedNexusStatus: FluxoraExternalConnectionStatus = {
  providerId: 'nexus',
  label: 'Nexus Mods',
  state: 'restoring',
  accountName: 'Cached user',
  hasStoredSession: true,
  retryable: true,
  requiresUserAction: false,
  message: 'Restoring saved session.',
  checkedAtUtc: '',
  operationId: 'op_cached_nexus'
};

const exampleApiLimitProvider: FluxoraApiLimitProvider = {
  id: 'example-api',
  label: 'Example API',
  state: 'available',
  message: 'Updated from API response headers.',
  updatedAtUtc: '2026-07-07T10:00:00Z',
  windows: [
    {
      id: 'hourly',
      label: 'Hourly',
      period: '1 hour',
      limit: 500,
      remaining: 421,
      resetAtUtc: '2026-07-07T11:00:00Z',
      resetRaw: '1783422000'
    },
    {
      id: 'daily',
      label: 'Daily',
      period: '24 hours',
      limit: 20000,
      remaining: 19876,
      resetAtUtc: '2026-07-08T00:00:00Z',
      resetRaw: '1783468800'
    }
  ]
};

const renderSettingsWorkspace = (
  overrides: Partial<SettingsWorkspaceProps> = {}
): string =>
  renderToStaticMarkup(
    React.createElement(SettingsWorkspace, {
      ...baseSettingsWorkspaceProps,
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
    expect(settingsWorkspace).toContain('settings-service-row--api-limit');
    expect(settingsWorkspace).toContain('<LanguageSelect');
    expect(settingsWorkspace).not.toContain('<AiSettingsPanel');
    expect(settingsWorkspace).not.toContain("case 'ai'");
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
    expect(settingsWorkspace).toContain('settings-panel--developer');
    expect(settingsWorkspace).toContain('Режим разработчика');
    expect(settingsWorkspace).toContain('onDeveloperModeChange(!developerModeEnabled)');
    expect(titlebar).toContain('titlebar__mark titlebar__mark--settings');
    expect(titlebar).toContain("title ?? (isSettingsWindow ? 'Settings' : 'Fluxora')");
    expect(settingsWorkspace).not.toContain('Account bridge');
    expect(settingsWorkspace).not.toContain('Link Nexus Mods with OAuth');
    expect(settingsWorkspace).not.toContain('Refresh status');
    expect(app).toContain('window.fluxora.settings.setLanguage');
    expect(app).toContain('window.fluxora.connections.listStatus');
    expect(app).toContain('window.fluxora.apiLimits.list');
    expect(app).toContain('window.fluxora.connections.connect');
    expect(app).toContain('window.fluxora.connections.disconnect');
    expect(app).toContain('loadCachedConnectionSnapshot(window.localStorage)');
    expect(app).toContain('saveCachedConnectionSnapshot(window.localStorage, snapshot)');
    expect(app).toContain("window.addEventListener('online', handleOnline)");
    expect(app).toContain("window.addEventListener('focus', handleFocus)");
    expect(app).not.toContain("setSettingsBusyLabel('Loading settings')");
    expect(app).toContain('window.fluxora.transfer.analyzeMo2');
    expect(app).toContain('window.fluxora.transfer.importMo2');
    expect(app).toContain('window.fluxora.operations.cancel');
    expect(app).toContain('return window.fluxora.operations.onProgress((progress) => {');
    expect(app).not.toContain('@tauri-apps/api');
    expect(settingsWorkspace).not.toContain('window.fluxora.');
    expect(settingsWorkspace).not.toContain('@tauri-apps/api');
    expect(app).toContain('window.fluxora.links.openExternal(fluxoraOriginalRepositoryUrl)');
  });

  it('does not expose a separate AI provider setup page in Settings', () => {
    const html = renderSettingsWorkspace();

    expect(html).not.toContain('AI settings');
    expect(html).not.toContain('Google Gemini key missing');
    expect(html).not.toContain('Connect this provider');
  });

  it('keeps Settings styling aligned with the compact UI-kit source', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(styles).toContain('grid-template-columns: 240px minmax(0, 1fr);');
    expect(styles).not.toContain('.settings-nav__header');
    expect(styles).toContain('.titlebar__mark--settings');
    expect(styles).toContain('.settings-connections-list');
    expect(styles).toContain('width: 100%;');
    expect(styles).toContain('.settings-service-row--connection');
    expect(styles).toContain('.settings-service-row--api-limit');
    expect(styles).toContain('.settings-api-limit-windows');
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
    expect(styles).toContain('.settings-panel--transfer');
    expect(styles).toContain('.settings-panel--developer');
    expect(styles).toContain('.settings-repository-button');
    expect(styles).not.toContain('.settings-panel--ai');
    expect(styles).not.toContain('.settings-ai-');
    expect(styles).toContain('.ai-chat-diagnostic');
    expect(styles).toContain('.ai-chat-message__diagnostics');
    expect(styles).toContain('.settings-service-row--transfer');
    expect(styles).toContain('.settings-transfer-button');
    expect(styles).not.toContain('.settings-card');
    expect(styles).not.toContain('.transfer-entry-progress');
    expect(styles).not.toContain('.settings-facts--transfer');
    expect(styles).not.toContain('.settings-actions');
  });

  it('renders the MO2 transfer entry as a minimal settings row', () => {
    const html = renderTransferSettings();

    expect(html).toContain('Mod Organizer 2');
    expect(html).toContain('Перенести');
    expect(html).toContain('settings-service-row--transfer');
    expect(html).not.toContain('Build transfer');
    expect(html).not.toContain('MO2 transfer progress');
    expect(html).not.toContain('Native core check');
    expect(html).not.toContain('Source');
    expect(html).not.toContain('Target');
    expect(html).not.toContain('Cancel and clean');
    expect(html).not.toContain('status-pill');
  });

  it('renders developer settings as the final settings section with build and stack facts', () => {
    const html = renderSettingsWorkspace();

    expect(html).toContain('Для разработчиков');
    expect(html).toContain('Режим разработчика');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('Дата последней сборки');
    expect(html).toContain('2026-07-03 10:15 UTC');
    expect(html).toContain('Tauri 2 / React / TypeScript');
    expect(html).toContain('Rust shell / C++ core');
    expect(html).toContain('0.0.0-test');
    expect(html).toContain('win32/x64');
    expect(html).toContain('GitHub');
    expect(html).not.toContain('settings-card');
  });

  it('renders Nexus cached hints as checking until the native bridge verifies status', () => {
    const html = renderSettingsWorkspace({
      section: 'connections',
      connectionProviders: [cachedNexusStatus],
      settingsCapabilities: {
        ...baseSettingsWorkspaceProps.settingsCapabilities,
        nexusAvailable: true
      }
    });

    expect(html).toContain('Nexus Mods');
    expect(html).toContain('Reconnecting');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Linked - Cached user');
    expect(html).not.toContain('Status not loaded');
    expect(html).not.toContain('Loading settings');
    expect(html).not.toContain('Refresh status');
  });

  it('renders API limits from generic provider windows', () => {
    const html = renderSettingsWorkspace({
      section: 'connections',
      apiLimitProviders: [exampleApiLimitProvider]
    });

    expect(html).toContain('Example API');
    expect(html).toContain('Updated from API response headers.');
    expect(html).toContain('421 / 500');
    expect(html).toContain('19,876 / 20,000');
    expect(html).toContain('Reset 11:00 UTC');
    expect(html).toContain('settings-service-row--api-limit');
  });

  it('uses a generic fallback icon and exposes reauthentication as the only connection error state', () => {
    const html = renderSettingsWorkspace({
      section: 'connections',
      connectionProviders: [
        {
          ...cachedNexusStatus,
          providerId: 'example',
          label: 'Example Cloud',
          state: 'reauthRequired',
          requiresUserAction: true,
          retryable: false
        }
      ],
      settingsCapabilities: {
        ...baseSettingsWorkspaceProps.settingsCapabilities,
        settingsAvailable: true
      }
    });

    expect(html).toContain('Example Cloud');
    expect(html).toContain('Sign in again - Cached user');
    expect(html).toContain('data-status="error"');
    expect(html).toContain('lucide-plug');
    expect(html).not.toContain('settings-service-icon--nexus');
  });
});
