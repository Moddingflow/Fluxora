import {
  Bot,
  Cpu,
  Download,
  KeyRound,
  ShieldCheck,
  Trash2,
  XCircle,
  Route
} from 'lucide-react';

import type { FluxoraAiHostStatus } from '../../../shared/fluxora-api';
import {
  aiProviderDiagnostic,
  aiRoutingPresetOptions,
  providerForModel,
  type AiChatSettings
} from './ai-chat-settings';

interface AiSettingsPanelProps {
  busyLabel: string | null;
  settings: AiChatSettings;
  status: FluxoraAiHostStatus | null;
  onChange: (settings: AiChatSettings) => void;
  onClearLocalData: () => void;
  onConnectProvider: (providerId: string) => void;
  onDisconnectProvider: (providerId: string) => void;
  onExportData: () => void;
}

const providerStateLabel = (connected: boolean, requiresCredential: boolean) => {
  if (!requiresCredential) {
    return 'Local';
  }

  return connected ? 'Ready' : 'Key needed';
};

export function AiSettingsPanel({
  busyLabel,
  settings,
  status,
  onChange,
  onClearLocalData,
  onConnectProvider,
  onDisconnectProvider,
  onExportData
}: AiSettingsPanelProps) {
  const models = status?.models ?? [];
  const providers = status?.providers ?? [];
  const selectedProvider = providerForModel(settings.modelId, models, providers);
  const diagnostic = aiProviderDiagnostic(settings, status);
  const controlsDisabled = Boolean(busyLabel);

  return (
    <div className="settings-panel settings-panel--ai" aria-label="AI settings">
      <div className="settings-connections-list">
        <div className="settings-service-row settings-service-row--connection settings-service-row--ai">
          <div className="settings-service-main">
            <span className="settings-service-icon settings-service-icon--ai">
              <Bot size={19} aria-hidden="true" />
            </span>
            <span className="settings-service-copy">
              <strong>Chat model</strong>
              <span>{selectedProvider?.displayName ?? 'AI host registry'}</span>
            </span>
          </div>
          <label className="settings-inline-select">
            <span className="sr-only">AI model</span>
            <select
              value={settings.modelId}
              disabled={!status?.ready || models.length === 0}
              onChange={(event) =>
                onChange({
                  ...settings,
                  modelId: event.target.value
                })
              }
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="settings-service-row settings-service-row--connection settings-service-row--ai">
          <div className="settings-service-main">
            <span className="settings-service-icon settings-service-icon--ai">
              <Route size={19} aria-hidden="true" />
            </span>
            <span className="settings-service-copy">
              <strong>Routing preset</strong>
              <span>{aiRoutingPresetOptions.find((preset) => preset.id === settings.routingPreset)?.summary}</span>
            </span>
          </div>
          <div className="settings-ai-presets" role="group" aria-label="AI routing presets">
            {aiRoutingPresetOptions.map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-active={settings.routingPreset === preset.id ? 'true' : undefined}
                onClick={() =>
                  onChange({
                    ...settings,
                    routingPreset: preset.id
                  })
                }
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-service-row settings-service-row--connection settings-service-row--ai-data">
          <div className="settings-service-main">
            <span className="settings-service-icon settings-service-icon--ai">
              <ShieldCheck size={19} aria-hidden="true" />
            </span>
            <span className="settings-service-copy">
              <strong>AI data</strong>
              <span>{busyLabel ?? 'Redacted snapshot and local chat state'}</span>
            </span>
          </div>
          <div className="settings-ai-data-actions">
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={onExportData}
            >
              <Download size={14} aria-hidden="true" />
              <span>Export</span>
            </button>
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={onClearLocalData}
            >
              <Trash2 size={14} aria-hidden="true" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {diagnostic ? (
          <div
            className="settings-ai-diagnostic"
            data-level={diagnostic.level}
            role={diagnostic.level === 'error' ? 'alert' : 'status'}
          >
            <strong>{diagnostic.title}</strong>
            <span>{diagnostic.message}</span>
            {diagnostic.detail ? <small>{diagnostic.detail}</small> : null}
          </div>
        ) : null}

        <div className="settings-ai-provider-list" aria-label="AI providers">
          {providers.map((provider) => (
            <div className="settings-ai-provider" key={provider.id} data-connected={provider.connected ? 'true' : undefined}>
              <Cpu size={15} aria-hidden="true" />
              <span>{provider.displayName}</span>
              <strong>{providerStateLabel(provider.connected, provider.requiresCredential)}</strong>
              {provider.requiresCredential && provider.connected ? (
                <button
                  type="button"
                  disabled={controlsDisabled}
                  title={`Disconnect ${provider.displayName}`}
                  onClick={() => onDisconnectProvider(provider.id)}
                >
                  <XCircle size={13} aria-hidden="true" />
                  <span>Disconnect</span>
                </button>
              ) : provider.requiresCredential ? (
                <button
                  type="button"
                  disabled={controlsDisabled}
                  title={`Connect ${provider.displayName}`}
                  onClick={() => onConnectProvider(provider.id)}
                >
                  <KeyRound size={13} aria-hidden="true" />
                  <span>Connect</span>
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
