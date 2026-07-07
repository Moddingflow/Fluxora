import {
  Code2,
  ExternalLink,
  Languages,
  Link2,
  RefreshCw,
  UploadCloud
} from 'lucide-react';

import {
  formatLastBuildDate,
  languageOptions,
  nexusActionLabel,
  nexusCanToggle,
  nexusConnectionSummary,
  nexusIsVerified,
  nexusIsVerifiedLinked,
  settingsCapabilityView,
  settingsSections,
  type NexusAuthViewStatus,
  type SettingsSectionId
} from '../../settings-workspace-state';
import { TransferSettingsPanel } from '../../TransferSettingsPanel';
import { nexusModsIcon } from '../../design-system/assets';
import { LanguageSelect } from './LanguageSelect';
import type {
  FluxoraAppInfo,
  NativeBridgeStatus
} from '../../../shared/fluxora-api';

type SettingsCapabilities = ReturnType<typeof settingsCapabilityView>;

interface SettingsWorkspaceProps {
  appInfo: FluxoraAppInfo | null;
  bridgeStatus: NativeBridgeStatus | null;
  developerModeEnabled: boolean;
  isTransferRunning: boolean;
  languageBusy: string | null;
  lastBuildDate: string;
  nexusBusy: boolean;
  nexusStatus: NexusAuthViewStatus | null;
  onDeveloperModeChange: (enabled: boolean) => void;
  onOpenTransfer: () => void;
  onOpenRepository: () => void;
  onSectionChange: (section: SettingsSectionId) => void;
  onSetLanguage: (language: string) => void;
  onToggleNexusConnection: () => void;
  section: SettingsSectionId;
  settingsBusyLabel: string | null;
  settingsCapabilities: SettingsCapabilities;
}

export function SettingsWorkspace({
  appInfo,
  bridgeStatus,
  developerModeEnabled,
  isTransferRunning,
  languageBusy,
  lastBuildDate,
  nexusBusy,
  nexusStatus,
  onDeveloperModeChange,
  onOpenTransfer,
  onOpenRepository,
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
          const icon = (() => {
            switch (item.id) {
              case 'connections':
                return Link2;
              case 'language':
                return Languages;
              case 'developers':
                return Code2;
              case 'transfer':
              default:
                return UploadCloud;
            }
          })();
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
    const actionText = nexusActionLabel(nexusStatus);
    const connectionStatus = !nexusStatus || !nexusIsVerified(nexusStatus)
      ? 'checking'
      : nexusIsVerifiedLinked(nexusStatus)
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
              aria-checked={nexusIsVerifiedLinked(nexusStatus)}
              aria-label="Nexus Mods account"
              title={nexusStatus?.message || actionText}
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

  const renderDeveloperSettings = () => (
    <div className="settings-panel settings-panel--developer" aria-label="Developer settings">
      <div className="settings-connections-list">
        <div
          className="settings-service-row settings-service-row--connection settings-service-row--developer"
          data-status={developerModeEnabled ? 'ready' : 'checking'}
        >
          <div className="settings-service-main">
            <span className="settings-service-icon settings-service-icon--developer" aria-hidden="true">
              <Code2 size={20} />
            </span>
            <span className="settings-service-copy">
              <strong>Режим разработчика</strong>
              <span>{developerModeEnabled ? 'Включен' : 'Выключен'}</span>
            </span>
          </div>
          <button
            className="settings-switch"
            type="button"
            role="switch"
            aria-checked={developerModeEnabled}
            aria-label="Режим разработчика"
            title={developerModeEnabled ? 'Режим разработчика включен' : 'Режим разработчика выключен'}
            onClick={() => onDeveloperModeChange(!developerModeEnabled)}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </div>

      <dl className="settings-facts settings-facts--developer">
        <div>
          <dt>Дата последней сборки</dt>
          <dd>{formatLastBuildDate(lastBuildDate)}</dd>
        </div>
        <div>
          <dt>UI</dt>
          <dd>Tauri 2 / React / TypeScript</dd>
        </div>
        <div>
          <dt>Core</dt>
          <dd>Rust shell / C++ core</dd>
        </div>
        <div>
          <dt>Версия</dt>
          <dd>{appInfo?.version ?? 'pending'}</dd>
        </div>
        <div>
          <dt>Платформа</dt>
          <dd>{appInfo ? `${appInfo.platform}/${appInfo.arch}` : 'pending'}</dd>
        </div>
        <div>
          <dt>Bridge</dt>
          <dd>{bridgeStatus?.ready ? 'ready' : bridgeStatus?.error ? 'unavailable' : 'pending'}</dd>
        </div>
      </dl>

      <button
        className="primary-button settings-repository-button"
        type="button"
        aria-label="Открыть оригинальный репозиторий Fluxora на GitHub"
        onClick={onOpenRepository}
      >
        <ExternalLink size={15} aria-hidden="true" />
        <span>GitHub</span>
      </button>
    </div>
  );

  const activeSection = (() => {
    switch (section) {
      case 'connections':
        return renderNexusSettings();
      case 'language':
        return renderLanguageSettings();
      case 'developers':
        return renderDeveloperSettings();
      case 'transfer':
      default:
        return renderTransferSettings();
    }
  })();

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
