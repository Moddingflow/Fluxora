import { useState } from 'react';
import { useLocalization } from '../../../localization/react';
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
  const { locale, t } = useLocalization();
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
    <aside className="settings-nav" aria-label={t('settings.aria.sections')}>
      <div className="settings-nav__items">
        {settingsSections(locale).map((item) => {
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
      <div
        className="settings-panel settings-panel--connections"
        aria-label={t('settings.aria.connections')}
      >
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
            const actionText = connectionActionLabel(presentedProvider, locale);
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
                    <span aria-live="polite">{connectionSummary(presentedProvider, locale)}</span>
                  </span>
                </div>
                <div className="settings-connection-action">
                  <span>{actionText}</span>
                  <button
                    className="settings-switch"
                    type="button"
                    role="switch"
                    aria-checked={connectionIsReady(presentedProvider)}
                    aria-label={t('settings.connection.account', { provider: provider.label })}
                    title={t('settings.connection.actionTitle', {
                      action: actionText,
                      provider: provider.label
                    })}
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
                  <strong>{t('settings.api.title')}</strong>
                  <span>{t('settings.api.checking')}</span>
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
                  <span>{apiLimitProviderSummary(provider, locale)}</span>
                </span>
              </div>
              {provider.windows.length > 0 ? (
                <dl
                  className="settings-api-limit-windows"
                  aria-label={t('settings.aria.apiRateLimits', { provider: provider.label })}
                >
                  {provider.windows.map((limitWindow) => (
                    <div key={limitWindow.id}>
                      <dt>{limitWindow.label}</dt>
                      <dd>
                        <span>{formatApiLimitUsage(limitWindow, locale)}</span>
                        <small>{formatApiLimitReset(limitWindow, locale)}</small>
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
    const options = languageOptions(locale);
    const selectedLanguage =
      options.find((language) => language.code === bridgeStatus?.language) ??
      options[0];

    return (
      <div className="settings-panel settings-panel--language" aria-label={t('settings.aria.language')}>
        <LanguageSelect
          disabled={!bridgeStatus?.ready || languageBusy !== null}
          onChange={onSetLanguage}
          value={selectedLanguage?.code ?? options[0].code}
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
    <div className="settings-panel settings-panel--privacy" aria-label={t('settings.aria.privacy')}>
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
              <strong>{t('settings.privacy.microphone')}</strong>
              <span>
                {microphoneAllowed ? t('settings.privacy.allowed') : t('settings.privacy.ask')}
              </span>
            </span>
          </div>
          <button
            className="primary-button"
            disabled={!microphoneAllowed || microphonePermissionBusy}
            onClick={onResetMicrophonePermission}
            type="button"
          >
            {microphonePermissionBusy
              ? t('settings.privacy.resetting')
              : t('settings.privacy.reset')}
          </button>
        </div>
      </div>
    </div>
  );

  const renderLegalSettings = () => (
    <div className="settings-panel settings-panel--legal" aria-label={t('settings.aria.legal')}>
      <LegalDocumentsPanel
        language={legalLanguageFromAppLanguage(bridgeStatus?.language)}
        onSelect={setLegalDocument}
        selected={legalDocument}
      />
    </div>
  );

  const renderDeveloperSettings = () => (
    <div className="settings-panel settings-panel--developer" aria-label={t('settings.aria.developer')}>
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
              <strong>{t('settings.developer.mode')}</strong>
              <span>
                {developerModeEnabled
                  ? t('settings.developer.enabled')
                  : t('settings.developer.disabled')}
              </span>
            </span>
          </div>
          <button
            className="settings-switch"
            type="button"
            role="switch"
            aria-checked={developerModeEnabled}
            aria-label={t('settings.developer.mode')}
            title={developerModeEnabled
              ? t('settings.developer.enabledTitle')
              : t('settings.developer.disabledTitle')}
            onClick={() => onDeveloperModeChange(!developerModeEnabled)}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </div>

      <dl className="settings-facts settings-facts--developer">
        <div>
          <dt>{t('settings.developer.lastBuild')}</dt>
          <dd>{formatLastBuildDate(lastBuildDate, locale)}</dd>
        </div>
        <div>
          <dt>{t('settings.developer.uiLabel')}</dt>
          <dd>{t('settings.developer.uiStack')}</dd>
        </div>
        <div>
          <dt>{t('settings.developer.coreLabel')}</dt>
          <dd>{t('settings.developer.coreStack')}</dd>
        </div>
        <div>
          <dt>{t('settings.developer.version')}</dt>
          <dd>{appInfo?.version ?? t('settings.status.pending')}</dd>
        </div>
        <div>
          <dt>{t('settings.developer.platform')}</dt>
          <dd>{appInfo ? `${appInfo.platform}/${appInfo.arch}` : t('settings.status.pending')}</dd>
        </div>
        <div>
          <dt>{t('settings.developer.bridgeLabel')}</dt>
          <dd>
            {bridgeStatus?.ready
              ? t('settings.status.ready')
              : bridgeStatus?.error
                ? t('settings.status.unavailable')
                : t('settings.status.pending')}
          </dd>
        </div>
      </dl>

      <button
        className="primary-button settings-repository-button"
        type="button"
        aria-label={t('settings.aria.repository')}
        onClick={onOpenRepository}
      >
        <ExternalLink size={15} aria-hidden="true" />
        <span>{t('settings.developer.githubLabel')}</span>
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
    <section className="settings-layout" aria-label={t('settings.aria.root')}>
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
