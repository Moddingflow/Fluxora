import type { FluxoraAiHostStatus } from '../../../shared/fluxora-api';
import { translateForLanguage } from '../../../localization';

export const FLUXORA_AI_PROVIDER_ID = 'gemini' as const;
export const FLUXORA_AI_MODEL_ID = 'gemini-3.1-flash-lite' as const;

export interface AiChatSettings {
  modelId: typeof FLUXORA_AI_MODEL_ID;
}

export interface AiProviderDiagnostic {
  detail?: string;
  level: 'warning' | 'error';
  message: string;
  title: string;
}

export const defaultAiChatSettings: AiChatSettings = {
  modelId: FLUXORA_AI_MODEL_ID
};

export const normalizeAiChatSettings = (): AiChatSettings => defaultAiChatSettings;

export const loadAiChatSettings = (storage: Storage | undefined): AiChatSettings => {
  // The single-agent migration intentionally removes the old model/routing/autonomy choice.
  storage?.removeItem('fluxora.ai.chat.settings.v1');
  return defaultAiChatSettings;
};

export const saveAiChatSettings = (storage: Storage | undefined): void => {
  storage?.removeItem('fluxora.ai.chat.settings.v1');
};

const hostStatusErrorDetail = (status: FluxoraAiHostStatus): string | undefined => {
  const reason = status.error?.details?.reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : undefined;
};

export const aiProviderDiagnostic = (
  status: FluxoraAiHostStatus | null,
  language = 'en-US'
): AiProviderDiagnostic | null => {
  const t = (key: Parameters<typeof translateForLanguage>[1]) =>
    translateForLanguage(language, key);
  if (!status) {
    return {
      level: 'warning',
      title: t('ai.diagnostic.loading.title'),
      message: t('ai.diagnostic.loading.message')
    };
  }

  if (!status.ready) {
    return {
      detail: hostStatusErrorDetail(status),
      level: 'error',
      title: t('ai.diagnostic.unavailable.title'),
      message: t('ai.diagnostic.unavailable.message')
    };
  }

  switch (status.quota.availability) {
    case 'connectionRequired':
      return {
        level: 'error',
        title: t('ai.diagnostic.reconnect.title'),
        message: t('ai.diagnostic.reconnect.message')
      };
    case 'premiumRequired':
      return {
        level: 'error',
        title: t('ai.diagnostic.premium.title'),
        message: t('ai.diagnostic.premium.message')
      };
    case 'quotaExhausted':
      return {
        level: 'error',
        title: t('ai.diagnostic.quota.title'),
        message: t('ai.diagnostic.quota.message')
      };
    case 'searchQuotaExhausted':
      return {
        level: 'error',
        title: t('ai.diagnostic.searchQuota.title'),
        message: t('ai.diagnostic.searchQuota.message')
      };
    case 'rateLimited':
      return {
        level: 'error',
        title: t('ai.diagnostic.rate.title'),
        message: t('ai.diagnostic.rate.message')
      };
    case 'temporaryServerError':
      return {
        level: 'error',
        title: t('ai.diagnostic.temporary.title'),
        message: t('ai.diagnostic.temporary.message')
      };
    case 'disabled':
      return {
        level: 'error',
        title: t('ai.diagnostic.disabled.title'),
        message: t('ai.diagnostic.disabled.message')
      };
    case 'available':
    case 'byok':
      break;
  }

  const provider = status.providers.find((candidate) => candidate.id === FLUXORA_AI_PROVIDER_ID);
  const model = status.models.find((candidate) => candidate.id === FLUXORA_AI_MODEL_ID);
  if (!provider || !model) {
    return {
      level: 'error',
      title: t('ai.diagnostic.contract.title'),
      message: t('ai.diagnostic.contract.message')
    };
  }

  if (!provider.connected) {
    return {
      level: 'error',
      title: t('ai.diagnostic.unavailable.title'),
      message: t('ai.diagnostic.unavailable.message')
    };
  }

  return null;
};
