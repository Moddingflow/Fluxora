import {
  Bot,
  Languages,
  Link2,
  RefreshCw,
  UploadCloud
} from 'lucide-react';

import {
  languageOptions,
  nexusCanToggle,
  nexusConnectionSummary,
  settingsCapabilityView,
  settingsSections,
  type SettingsSectionId
} from '../../settings-workspace-state';
import { TransferSettingsPanel } from '../../TransferSettingsPanel';
import { nexusModsIcon } from '../../design-system/assets';
import { AiSettingsPanel } from '../ai/AiSettingsPanel';
import type { AiChatSettings } from '../ai/ai-chat-settings';
import { LanguageSelect } from './LanguageSelect';
import type {
  FluxoraAiHostStatus,
  FluxoraNexusModsAuthStatus,
  NativeBridgeStatus
} from '../../../shared/fluxora-api';

type SettingsCapabilities = ReturnType<typeof settingsCapabilityView>;

interface SettingsWorkspaceProps {
  aiHostStatus: FluxoraAiHostStatus | null;
  aiSettings: AiChatSettings;
  bridgeStatus: NativeBridgeStatus | null;
  isTransferRunning: boolean;
  languageBusy: string | null;
  nexusBusy: boolean;
  nexusStatus: FluxoraNexusModsAuthStatus | null;
  onAiSettingsChange: (settings: AiChatSettings) => void;
  onClearAiLocalData: () => void;
  onConnectAiProvider: (providerId: string) => void;
  onDisconnectAiProvider: (providerId: string) => void;
  onExportAiData: () => void;
  onOpenTransfer: () => void;
  onSectionChange: (section: SettingsSectionId) => void;
  onSetLanguage: (language: string) => void;
  onToggleNexusConnection: () => void;
  section: SettingsSectionId;
  settingsBusyLabel: string | null;
  settingsCapabilities: SettingsCapabilities;
}

export function SettingsWorkspace({
  aiHostStatus,
  aiSettings,
  bridgeStatus,
  isTransferRunning,
  languageBusy,
  nexusBusy,
  nexusStatus,
  onAiSettingsChange,
  onClearAiLocalData,
  onConnectAiProvider,
  onDisconnectAiProvider,
  onExportAiData,
  onOpenTransfer,
  onSectionChange,
  onSetLanguage,
  onToggleNexusConnection,
  section,
  settingsBusyLabel,
  settingsCapabilities
}: SettingsWorkspaceProps) {
  const renderSettingsNav = () => (
    <aside className="settings-nav" aria-label="Settings sections">
      <div className="settings-nav__items">
        {settingsSections.map((item) => {
          const isActive = section === item.id;
          const icon =
            item.id === 'connections'
              ? Link2
              : item.id === 'ai'
                ? Bot
              : item.id === 'language'
                ? Languages
                : UploadCloud;
          const Icon = icon;
          return (
            <button
              key={item.id}
              type="button"
              data-active={isActive}
              disabled={isTransferRunning && item.id !== 'transfer'}
              onClick={() => onSectionChange(item.id)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>
                <strong>{item.label}</strong>
                {item.hint ? <small>{item.hint}</small> : null}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );

  const renderNexusSettings = () => {
    const accountText = nexusConnectionSummary(nexusStatus);
    const canToggleNexus = nexusCanToggle(nexusStatus, settingsCapabilities.nexusAvailable);
    const connectionStatus = !nexusStatus
      ? 'checking'
      : nexusStatus.isLinked
        ? 'ready'
        : nexusStatus.isConfigured
          ? 'checking'
          : 'error';

    return (
      <div className="settings-panel settings-panel--connections" aria-label="Connections settings">
        <div className="settings-connections-list">
          <div className="settings-service-row settings-service-row--connection" data-status={connectionStatus}>
            <div className="settings-service-main">
              <span className="settings-service-icon settings-service-icon--nexus">
                <img src={nexusModsIcon} alt="" />
              </span>
              <span className="settings-service-copy">
                <strong>Nexus Mods</strong>
                <span>{accountText}</span>
              </span>
            </div>
            <button
              className="settings-switch"
              type="button"
              role="switch"
              aria-checked={Boolean(nexusStatus?.isLinked)}
              aria-label="Nexus Mods account"
              title={nexusStatus?.message || accountText}
              disabled={nexusBusy || !canToggleNexus}
              onClick={onToggleNexusConnection}
            >
              <span aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderLanguageSettings = () => {
    const selectedLanguage =
      languageOptions.find((language) => language.code === bridgeStatus?.language) ??
      languageOptions[0];

    return (
      <div className="settings-panel settings-panel--language" aria-label="Language settings">
        <LanguageSelect
          disabled={!bridgeStatus?.ready || languageBusy !== null}
          onChange={onSetLanguage}
          value={selectedLanguage?.code ?? languageOptions[0].code}
        />
      </div>
    );
  };

  const renderTransferSettings = () => (
    <TransferSettingsPanel
      bridgeReady={Boolean(bridgeStatus?.ready)}
      transferAvailable={settingsCapabilities.transferAvailable}
      busyLabel={settingsBusyLabel}
      isRunning={isTransferRunning}
      onOpenTransfer={onOpenTransfer}
    />
  );

  const renderAiSettings = () => (
    <AiSettingsPanel
      busyLabel={settingsBusyLabel}
      settings={aiSettings}
      status={aiHostStatus}
      onChange={onAiSettingsChange}
      onClearLocalData={onClearAiLocalData}
      onConnectProvider={onConnectAiProvider}
      onDisconnectProvider={onDisconnectAiProvider}
      onExportData={onExportAiData}
    />
  );

  const activeSection =
    section === 'connections'
      ? renderNexusSettings()
      : section === 'ai'
        ? renderAiSettings()
      : section === 'language'
        ? renderLanguageSettings()
        : renderTransferSettings();

  return (
    <section className="settings-layout" aria-label="Settings">
      {renderSettingsNav()}
      <section className="work-surface settings-surface">
        {settingsBusyLabel ? (
          <div className="mod-busy-strip" role="status">
            <RefreshCw size={15} aria-hidden="true" />
            <span>{settingsBusyLabel}</span>
          </div>
        ) : null}
        {activeSection}
      </section>
    </section>
  );
}

export type { SettingsCapabilities };
