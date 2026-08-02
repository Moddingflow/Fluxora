import { useState } from 'react';
import {
  Code2,
  ExternalLink,
  Gauge,
  Languages,
  Link2,
  Mic,
  MonitorCog,
  Plug,
  RefreshCw,
  UploadCloud
} from '../../design-system/icons/lucide-compat';

import {
  apiLimitProviderSummary,
  formatApiLimitReset,
  formatApiLimitUsage,
  formatLastBuildDate,
  languageOptions,
  settingsCapabilityView,
  settingsSections,
  type SettingsSectionId
} from '../../settings-workspace-state';
import {
  connectionActionLabel,
  connectionCanToggle,
  connectionIsReady,
  connectionSummary
} from '../../connection-workspace-state';
import { TransferSettingsPanel } from '../../TransferSettingsPanel';
import { moddingFlowIcon, nexusModsIcon } from '../../design-system/assets';
import { Icon as DesignIcon } from '../../design-system/icons';
import { LanguageSelect } from './LanguageSelect';
import { managerHandoffSettingsCopy } from './manager-handoff-settings-copy';
import { LegalDocumentsPanel } from '../legal/LegalDocumentsPanel';
import { legalLanguageFromAppLanguage } from '../legal/legal-documents';
import type { LegalDocumentKind } from '../../../installer/setup/setup-flow';
import type {
  FluxoraApiLimitProvider,
  FluxoraAppInfo,
  FluxoraExternalConnectionStatus,
  NativeBridgeStatus
} from '../../../shared/fluxora-api';

type SettingsCapabilities = ReturnType<typeof settingsCapabilityView>;

interface SettingsWorkspaceProps {
  apiLimitProviders: FluxoraApiLimitProvider[];
  apiLimitsBusy: boolean;
  appInfo: FluxoraAppInfo | null;
  bridgeStatus: NativeBridgeStatus | null;
  developerModeEnabled: boolean;
  isTransferRunning: boolean;
  languageBusy: string | null;
  microphoneAllowed: boolean;
  microphonePermissionBusy: boolean;
  lastBuildDate: string;
  connectionBusyAction: 'connect' | 'cancel' | 'disconnect' | null;
  connectionBusyProviderId: string | null;
  connectionProviders: FluxoraExternalConnectionStatus[];
  onDeveloperModeChange: (enabled: boolean) => void;
  onOpenTransfer: () => void;
  onOpenRepository: () => void;
  onOpenManagerDefaultApps: () => Promise<void>;
  onResetMicrophonePermission: () => void;
  onSectionChange: (section: SettingsSectionId) => void;
  onSetLanguage: (language: string) => void;
  onToggleConnection: (providerId: string) => void;
  section: SettingsSectionId;
  settingsBusyLabel: string | null;
  settingsCapabilities: SettingsCapabilities;
}

export function SettingsWorkspace({
  apiLimitProviders,
  apiLimitsBusy,
  appInfo,
  bridgeStatus,
  developerModeEnabled,
  isTransferRunning,
  languageBusy,
  microphoneAllowed,
  microphonePermissionBusy,
  lastBuildDate,
  connectionBusyAction,
  connectionBusyProviderId,
  connectionProviders,
  onDeveloperModeChange,
  onOpenTransfer,
  onOpenRepository,
  onOpenManagerDefaultApps,
  onResetMicrophonePermission,
  onSectionChange,
  onSetLanguage,
  onToggleConnection,
  section,
  settingsBusyLabel,
  settingsCapabilities
}: SettingsWorkspaceProps) {
  const [managerHandoffSettingsBusy, setManagerHandoffSettingsBusy] = useState(false);
  const [managerHandoffSettingsError, setManagerHandoffSettingsError] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocumentKind>('privacy');
  const managerHandoffCopy = managerHandoffSettingsCopy(bridgeStatus?.language);
  const openManagerDefaultApps = async (): Promise<void> => {
    if (managerHandoffSettingsBusy) {
      return;
    }
    setManagerHandoffSettingsBusy(true);
    setManagerHandoffSettingsError(false);
    try {
      await onOpenManagerDefaultApps();
    } catch {
      setManagerHandoffSettingsError(true);
    } finally {
      setManagerHandoffSettingsBusy(false);
    }
  };

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
              case 'privacy':
                return Mic;
              case 'legal':
                return null;
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
              {Icon ? (
                <Icon size={17} aria-hidden="true" />
              ) : (
                <DesignIcon className="settings-nav__asset-icon" name="file-text" size={17} />
              )}
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

  const renderConnectionSettings = () => {
    return (
      <div className="settings-panel settings-panel--connections" aria-label="Connections settings">
        <div className="settings-connections-list">
          {connectionProviders.map((provider) => {
            const isBusyProvider = connectionBusyProviderId === provider.providerId;
            const presentedProvider = isBusyProvider && (
              connectionBusyAction === 'connect' || connectionBusyAction === 'cancel'
            )
              ? { ...provider, state: 'connecting' as const }
              : provider;
            const providerAvailable = provider.providerId === 'nexus'
              ? settingsCapabilities.nexusAvailable
              : settingsCapabilities.settingsAvailable;
            const actionText = connectionActionLabel(presentedProvider);
            const connectionStatus = presentedProvider.state === 'reauthRequired'
              ? 'error'
              : presentedProvider.state === 'ready'
                ? 'ready'
                : 'checking';
            const canCancelPendingModdingFlow = isBusyProvider
              && connectionBusyAction === 'connect'
              && provider.providerId === 'moddingflow';
            return (
              <div
                className="settings-service-row settings-service-row--connection"
                data-status={connectionStatus}
                key={provider.providerId}
              >
                <div className="settings-service-main">
                  <span
                    className={`settings-service-icon${
                      provider.providerId === 'nexus' ? ' settings-service-icon--nexus' : ''
                    }${
                      provider.providerId === 'moddingflow'
                        ? ' settings-service-icon--moddingflow'
                        : ''
                    }`}
                  >
                    {provider.providerId === 'nexus'
                      ? <img src={nexusModsIcon} alt="" />
                      : provider.providerId === 'moddingflow'
                        ? <img src={moddingFlowIcon} alt="" />
                        : <Plug size={20} aria-hidden="true" />}
                  </span>
                  <span className="settings-service-copy">
                    <strong>{provider.label}</strong>
                    <span aria-live="polite">{connectionSummary(presentedProvider)}</span>
                  </span>
                </div>
                <div className="settings-connection-action">
                  <span>{actionText}</span>
                  <button
                    className="settings-switch"
                    type="button"
                    role="switch"
                    aria-checked={connectionIsReady(presentedProvider)}
                    aria-label={`${provider.label} account`}
                    title={provider.message || `${actionText} ${provider.label}`}
                    disabled={
                      (isBusyProvider && !canCancelPendingModdingFlow)
                      || !connectionCanToggle(presentedProvider, providerAvailable)
                    }
                    onClick={() => onToggleConnection(provider.providerId)}
                  >
                    <span aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
          <div
            className="settings-service-row settings-service-row--connection"
            data-status={managerHandoffSettingsError ? 'error' : 'checking'}
          >
            <div className="settings-service-main">
              <span className="settings-service-icon" aria-hidden="true">
                <MonitorCog size={20} />
              </span>
              <span className="settings-service-copy">
                <strong>{managerHandoffCopy.title}</strong>
                <span role={managerHandoffSettingsError ? 'alert' : undefined}>
                  {managerHandoffSettingsError
                    ? managerHandoffCopy.error
                    : managerHandoffCopy.detail}
                </span>
              </span>
            </div>
            <button
              className="primary-button"
              type="button"
              aria-label={managerHandoffCopy.ariaLabel}
              disabled={managerHandoffSettingsBusy}
              onClick={() => void openManagerDefaultApps()}
            >
              {managerHandoffSettingsBusy
                ? managerHandoffCopy.opening
                : managerHandoffCopy.action}
            </button>
          </div>
          {apiLimitsBusy && apiLimitProviders.length === 0 ? (
            <div className="settings-service-row settings-service-row--api-limit" data-status="checking">
              <div className="settings-service-main">
                <span className="settings-service-icon settings-service-icon--api" aria-hidden="true">
                  <Gauge size={20} />
                </span>
                <span className="settings-service-copy">
                  <strong>API limits</strong>
                  <span>Checking response headers</span>
                </span>
              </div>
            </div>
          ) : null}
          {apiLimitProviders.map((provider) => (
            <div
              key={provider.id}
              className="settings-service-row settings-service-row--api-limit"
              data-status={provider.state}
            >
              <div className="settings-service-main">
                <span className="settings-service-icon settings-service-icon--api" aria-hidden="true">
                  <Gauge size={20} />
                </span>
                <span className="settings-service-copy">
                  <strong>{provider.label}</strong>
                  <span>{apiLimitProviderSummary(provider)}</span>
                </span>
              </div>
              {provider.windows.length > 0 ? (
                <dl className="settings-api-limit-windows" aria-label={`${provider.label} rate limits`}>
                  {provider.windows.map((limitWindow) => (
                    <div key={limitWindow.id}>
                      <dt>{limitWindow.label}</dt>
                      <dd>
                        <span>{formatApiLimitUsage(limitWindow)}</span>
                        <small>{formatApiLimitReset(limitWindow)}</small>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          ))}
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

  const renderPrivacySettings = () => (
    <div className="settings-panel settings-panel--privacy" aria-label="Privacy settings">
      <div className="settings-connections-list">
        <div
          className="settings-service-row settings-service-row--connection settings-service-row--privacy"
          data-status={microphoneAllowed ? 'ready' : 'checking'}
        >
          <div className="settings-service-main">
            <span className="settings-service-icon settings-service-icon--privacy" aria-hidden="true">
              <Mic size={20} />
            </span>
            <span className="settings-service-copy">
              <strong>AI microphone</strong>
              <span>{microphoneAllowed ? 'Allowed until reset' : 'Fluxora will ask before recording'}</span>
            </span>
          </div>
          <button
            className="primary-button"
            disabled={!microphoneAllowed || microphonePermissionBusy}
            onClick={onResetMicrophonePermission}
            type="button"
          >
            {microphonePermissionBusy ? 'Resetting…' : 'Reset access'}
          </button>
        </div>
      </div>
    </div>
  );

  const renderLegalSettings = () => (
    <div className="settings-panel settings-panel--legal" aria-label="Legal documents">
      <LegalDocumentsPanel
        language={legalLanguageFromAppLanguage(bridgeStatus?.language)}
        onSelect={setLegalDocument}
        selected={legalDocument}
      />
    </div>
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
          <dt>Версия Fluxora</dt>
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
        return renderConnectionSettings();
      case 'language':
        return renderLanguageSettings();
      case 'privacy':
        return renderPrivacySettings();
      case 'legal':
        return renderLegalSettings();
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
