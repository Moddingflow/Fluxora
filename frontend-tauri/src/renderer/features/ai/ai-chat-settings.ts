import type {
  FluxoraAiHostStatus,
  FluxoraAiModelCapability,
  FluxoraAiProviderDescriptor,
  FluxoraAiRoutingPreset
} from '../../../shared/fluxora-api';

export interface AiRoutingPresetOption {
  id: FluxoraAiRoutingPreset;
  label: string;
  summary: string;
}

export interface AiChatSettings {
  modelId: string;
  routingPreset: FluxoraAiRoutingPreset;
}

export const AI_CHAT_SETTINGS_STORAGE_KEY = 'fluxora.ai.chat.settings.v1';
export const LOCAL_DRY_RUN_PROVIDER_ID = 'local-dry-run';
export const LOCAL_DRY_RUN_MODEL_ID = 'local-dry-run';

export interface AiProviderDiagnostic {
  detail?: string;
  level: 'warning' | 'error';
  message: string;
  title: string;
}

export const aiRoutingPresetOptions: AiRoutingPresetOption[] = [
  {
    id: 'free-demo',
    label: 'Free demo',
    summary: 'Local fallback'
  },
  {
    id: 'paid-economy',
    label: 'Paid economy',
    summary: 'Cheap BYOK route'
  },
  {
    id: 'paid-large-job',
    label: 'Paid large job',
    summary: 'Large context'
  },
  {
    id: 'byok',
    label: 'BYOK',
    summary: 'User key'
  }
];

export const defaultAiChatSettings: AiChatSettings = {
  modelId: LOCAL_DRY_RUN_MODEL_ID,
  routingPreset: 'free-demo'
};

const isRoutingPreset = (value: unknown): value is FluxoraAiRoutingPreset =>
  aiRoutingPresetOptions.some((preset) => preset.id === value);

export const providerForModel = (
  modelId: string,
  models: FluxoraAiModelCapability[],
  providers: FluxoraAiProviderDescriptor[]
): FluxoraAiProviderDescriptor | null => {
  const model = models.find((candidate) => candidate.id === modelId);
  if (!model) {
    return null;
  }

  return providers.find((provider) => provider.id === model.providerId) ?? null;
};

const providerCanRun = (provider: FluxoraAiProviderDescriptor): boolean =>
  provider.connected || !provider.requiresCredential;

export const isLocalDryRunProvider = (provider: FluxoraAiProviderDescriptor | null): boolean =>
  provider?.id === LOCAL_DRY_RUN_PROVIDER_ID || provider?.kind === 'local';

const joinProviderNames = (providers: FluxoraAiProviderDescriptor[]): string =>
  providers.map((provider) => provider.displayName).join(', ');

const hostStatusErrorDetail = (status: FluxoraAiHostStatus): string | undefined => {
  const reason = status.error?.details?.reason;
  return typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : undefined;
};

export const aiProviderDiagnostic = (
  settings: AiChatSettings,
  status: FluxoraAiHostStatus | null
): AiProviderDiagnostic | null => {
  if (!status) {
    return {
      level: 'warning',
      title: 'AI status is loading',
      message: 'Fluxora is checking the AI host and provider registry.'
    };
  }

  if (!status.ready) {
    return {
      detail: hostStatusErrorDetail(status),
      level: 'error',
      title: 'AI host unavailable',
      message: status.error?.message || 'FluxoraAIHost is not ready.'
    };
  }

  if (status.models.length === 0 || status.providers.length === 0) {
    return {
      level: 'error',
      title: 'No AI providers registered',
      message: 'FluxoraAIHost did not return any model/provider registry.'
    };
  }

  const selectedProvider = providerForModel(settings.modelId, status.models, status.providers);
  if (!selectedProvider) {
    return {
      level: 'error',
      title: 'Selected AI model is unavailable',
      message: 'Choose another AI model after the provider registry refreshes.'
    };
  }

  if (selectedProvider.requiresCredential && !selectedProvider.connected) {
    return {
      level: 'error',
      title: `${selectedProvider.displayName} key missing`,
      message: 'Connect this provider in Settings > AI before sending chat prompts.'
    };
  }

  if (isLocalDryRunProvider(selectedProvider)) {
    const disconnectedRemoteProviders = status.providers.filter(
      (provider) =>
        !isLocalDryRunProvider(provider) &&
        provider.requiresCredential &&
        !provider.connected
    );

    return {
      level: 'warning',
      title: 'Local dry run selected',
      message:
        disconnectedRemoteProviders.length > 0
          ? `No provider key is connected. Connect ${joinProviderNames(disconnectedRemoteProviders)} in Settings > AI for real replies.`
          : 'This offline placeholder returns a fixed planning template and does not call an external model.'
    };
  }

  return null;
};

const connectedRemoteDefaultModelId = (
  models: FluxoraAiModelCapability[],
  providers: FluxoraAiProviderDescriptor[]
): string | null => {
  const provider = providers.find(
    (candidate) =>
      !isLocalDryRunProvider(candidate) &&
      providerCanRun(candidate) &&
      models.some((model) => model.id === candidate.defaultModelId)
  );

  return provider?.defaultModelId ?? null;
};

const routingPresetForModel = (
  modelId: string,
  routingPreset: FluxoraAiRoutingPreset,
  status: FluxoraAiHostStatus | null
): FluxoraAiRoutingPreset => {
  const provider = providerForModel(modelId, status?.models ?? [], status?.providers ?? []);
  if (!provider) {
    return routingPreset;
  }

  if (isLocalDryRunProvider(provider)) {
    return 'free-demo';
  }

  return provider.kind === 'byok' || provider.requiresCredential ? 'byok' : routingPreset;
};

export const preferredAiModelId = (
  settings: AiChatSettings,
  status: FluxoraAiHostStatus | null
): string => {
  const models = status?.models ?? [];
  const providers = status?.providers ?? [];
  const selectedModel = models.find((model) => model.id === settings.modelId);
  const selectedProvider = selectedModel
    ? providers.find((provider) => provider.id === selectedModel.providerId) ?? null
    : null;
  const remoteDefaultModelId = connectedRemoteDefaultModelId(models, providers);

  if (
    selectedModel &&
    selectedProvider &&
    !isLocalDryRunProvider(selectedProvider) &&
    providerCanRun(selectedProvider)
  ) {
    return settings.modelId;
  }

  if (
    remoteDefaultModelId &&
    (!selectedModel || !selectedProvider || isLocalDryRunProvider(selectedProvider))
  ) {
    return remoteDefaultModelId;
  }

  if (selectedModel && selectedProvider && providerCanRun(selectedProvider)) {
    return selectedModel.id;
  }

  return (
    remoteDefaultModelId ??
    models.find((model) => model.id === LOCAL_DRY_RUN_MODEL_ID)?.id ??
    models[0]?.id ??
    defaultAiChatSettings.modelId
  );
};

export const normalizeAiChatSettings = (
  raw: Partial<AiChatSettings> | null | undefined,
  status?: FluxoraAiHostStatus | null
): AiChatSettings => {
  const routingPreset = isRoutingPreset(raw?.routingPreset)
    ? raw.routingPreset
    : defaultAiChatSettings.routingPreset;
  const modelId =
    typeof raw?.modelId === 'string' && raw.modelId.trim()
      ? raw.modelId.trim()
      : defaultAiChatSettings.modelId;
  const preferredModelId = preferredAiModelId({ modelId, routingPreset }, status ?? null);
  return {
    modelId: preferredModelId,
    routingPreset: routingPresetForModel(preferredModelId, routingPreset, status ?? null)
  };
};

export const loadAiChatSettings = (storage: Storage | undefined): AiChatSettings => {
  if (!storage) {
    return defaultAiChatSettings;
  }

  try {
    const raw = storage.getItem(AI_CHAT_SETTINGS_STORAGE_KEY);
    return normalizeAiChatSettings(raw ? JSON.parse(raw) as Partial<AiChatSettings> : null);
  } catch {
    return defaultAiChatSettings;
  }
};

export const saveAiChatSettings = (
  storage: Storage | undefined,
  settings: AiChatSettings
): void => {
  storage?.setItem(AI_CHAT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};

export const formatAiCost = (value: number | null | undefined, currency = 'USD'): string => {
  if (!Number.isFinite(value ?? NaN) || !value) {
    return `${currency} 0.0000`;
  }

  return `${currency} ${value.toFixed(value < 0.01 ? 4 : 2)}`;
};
