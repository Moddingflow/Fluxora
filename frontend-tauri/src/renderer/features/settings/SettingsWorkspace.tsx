import {
  ChevronDown,
  CircleDot,
  Globe2,
  Languages,
  Link2,
  RefreshCw,
  UploadCloud
} from 'lucide-react';

import {
  languageOptions,
  languageSettingsHint,
  nexusActionLabel,
  nexusCanToggle,
  nexusConnectionSummary,
  settingsCapabilityView,
  settingsSections,
  type SettingsSectionId
} from '../../settings-workspace-state';
import {
  TransferSettingsPanel,
  type TransferMode
} from '../../TransferSettingsPanel';
import { nexusModsIcon } from '../../design-system/assets';
import type {
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportProgress,
  FluxoraNexusModsAuthStatus,
  FluxoraProject,
  NativeBridgeStatus
} from '../../../shared/fluxora-api';

type SettingsCapabilities = ReturnType<typeof settingsCapabilityView>;

interface SettingsWorkspaceProps {
  bridgeStatus: NativeBridgeStatus | null;
  cancelRequested: boolean;
  cancellationSupported: boolean;
  isTransferRunning: boolean;
  languageBusy: string | null;
  message: string | null;
  nexusBusy: boolean;
  nexusStatus: FluxoraNexusModsAuthStatus | null;
  onCancelTransfer: () => void;
  onOpenTransfer: () => void;
  onRefreshNexusStatus: () => void;
  onSectionChange: (section: SettingsSectionId) => void;
  onSetLanguage: (language: string) => void;
  onToggleNexusConnection: () => void;
  section: SettingsSectionId;
  settingsBusyLabel: string | null;
  settingsCapabilities: SettingsCapabilities;
  transferAnalysis: FluxoraModOrganizerImportAnalysis | null;
  transferError: string | null;
  transferProgress: FluxoraModOrganizerImportProgress | null;
  transferResult: FluxoraProject | null;
}

export function SettingsWorkspace({
  bridgeStatus,
  cancelRequested,
  cancellationSupported,
  isTransferRunning,
  languageBusy,
  message,
  nexusBusy,
  nexusStatus,
  onCancelTransfer,
  onOpenTransfer,
  onRefreshNexusStatus,
  onSectionChange,
  onSetLanguage,
  onToggleNexusConnection,
  section,
  settingsBusyLabel,
  settingsCapabilities,
  transferAnalysis,
  transferError,
  transferProgress,
  transferResult
}: SettingsWorkspaceProps) {
  const renderSettingsNav = () => (
    <aside className="settings-nav" aria-label="Settings sections">
      <header className="settings-nav__header">
        <h2>Settings</h2>
        <p>Connections, languages, and build transfer.</p>
      </header>
      <div className="settings-nav__items">
        {settingsSections.map((item) => {
          const isActive = section === item.id;
          const icon =
            item.id === 'connections'
              ? Link2
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
                <small>{item.hint}</small>
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
      <div className="settings-panel" aria-label="Nexus Mods settings">
        <div className="settings-card settings-card--connections">
          <header className="settings-card__header">
            <div>
              <h3>Account bridge</h3>
              <p>Connect an account so Fluxora can use modding services through the native bridge.</p>
            </div>
            <span className="status-pill" data-status={connectionStatus}>
              {nexusStatus?.isLinked ? 'Linked' : 'Not linked'}
            </span>
          </header>

          <div className="settings-service-row">
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

          <div className="settings-actions settings-actions--footer">
            <button
              className={nexusStatus?.isLinked ? 'tool-button' : 'primary-button'}
              type="button"
              disabled={nexusBusy || !canToggleNexus}
              onClick={onToggleNexusConnection}
            >
              <Link2 size={16} aria-hidden="true" />
              {nexusActionLabel(nexusStatus)}
            </button>
            <button
              className="tool-button"
              type="button"
              disabled={nexusBusy || !settingsCapabilities.nexusAvailable}
              onClick={onRefreshNexusStatus}
            >
              <RefreshCw size={16} aria-hidden="true" />
              Refresh status
            </button>
          </div>

          <p className="settings-card__meta">Changes apply as soon as the native bridge responds.</p>
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
        <div className="settings-card settings-card--language">
          <header className="settings-card__header">
            <div>
              <h3>Interface language</h3>
              <p>Choose the renderer language. Fluxora updates the open interface after the bridge confirms.</p>
            </div>
            <span className="status-pill" data-status={languageBusy ? 'checking' : 'ready'}>
              {languageBusy ? 'Saving' : 'Saved'}
            </span>
          </header>

          <label className="settings-select-card" aria-label="Interface language">
            <span className="settings-select-control">
              <Globe2 size={17} aria-hidden="true" />
              <select
                aria-label="Language"
                value={selectedLanguage?.code ?? ''}
                disabled={!bridgeStatus?.ready || languageBusy !== null}
                onChange={(event) => onSetLanguage(event.target.value)}
              >
                {languageOptions.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.nativeLabel} - {language.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={17} aria-hidden="true" />
            </span>
          </label>

          <p className="settings-card__meta settings-card__meta--mono">
            {languageSettingsHint(selectedLanguage?.code)}
          </p>
        </div>
      </div>
    );
  };

  const renderTransferSettings = () => (
    <TransferSettingsPanel
      bridgeReady={Boolean(bridgeStatus?.ready)}
      transferAvailable={settingsCapabilities.transferAvailable}
      busyLabel={settingsBusyLabel}
      isRunning={isTransferRunning}
      cancellationSupported={cancellationSupported}
      cancelRequested={cancelRequested}
      analysis={transferAnalysis}
      progress={transferProgress}
      error={transferError}
      result={transferResult}
      onOpenTransfer={onOpenTransfer}
      onCancel={onCancelTransfer}
    />
  );

  const activeSection =
    section === 'connections'
      ? renderNexusSettings()
      : section === 'language'
        ? renderLanguageSettings()
        : renderTransferSettings();

  return (
    <section className="settings-layout" aria-label="Settings">
      {renderSettingsNav()}
      <section className="work-surface settings-surface">
        {message ? (
          <div className="activity-banner" role="status">
            <CircleDot size={16} aria-hidden="true" />
            <span>{message}</span>
          </div>
        ) : null}
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

export type { SettingsCapabilities, TransferMode };
