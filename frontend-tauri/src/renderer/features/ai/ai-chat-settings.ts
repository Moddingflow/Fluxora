import type { FluxoraAiHostStatus } from '../../../shared/fluxora-api';

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
  status: FluxoraAiHostStatus | null
): AiProviderDiagnostic | null => {
  if (!status) {
    return {
      level: 'warning',
      title: 'AI status is loading',
      message: 'Fluxora is checking Gemini availability.'
    };
  }

  if (!status.ready) {
    return {
      detail: hostStatusErrorDetail(status),
      level: 'error',
      title: 'Managed AI unavailable',
      message: status.error && 'userMessage' in status.error && status.error.userMessage
        ? status.error.userMessage
        : status.error && 'message' in status.error
          ? status.error.message
          : 'Gemini is unavailable.'
    };
  }

  switch (status.quota.availability) {
    case 'connectionRequired':
      return {
        level: 'error',
        title: 'Reconnect ModdingFlow',
        message: 'Reconnect once to grant the new agent:run permission for managed Fluxora AI.'
      };
    case 'premiumRequired':
      return {
        level: 'error',
        title: 'Premium required',
        message: 'Managed Fluxora AI is available only with an active Premium subscription.'
      };
    case 'quotaExhausted':
      return {
        level: 'error',
        title: 'Managed AI quota exhausted',
        message: 'The managed-cost allowance is exhausted until the displayed reset date.'
      };
    case 'searchQuotaExhausted':
      return {
        level: 'error',
        title: 'Search quota exhausted',
        message: 'The managed Google Search allowance is exhausted until the displayed reset date.'
      };
    case 'rateLimited':
      return {
        level: 'error',
        title: 'Managed AI rate limited',
        message: 'Wait briefly before starting another managed request.'
      };
    case 'temporaryServerError':
      return {
        level: 'error',
        title: 'Managed AI temporarily unavailable',
        message: 'The Website gateway or accounting service is temporarily unavailable.'
      };
    case 'disabled':
      return {
        level: 'error',
        title: 'Managed AI is not enabled',
        message: 'Managed Fluxora AI is not enabled for this account or rollout stage.'
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
      title: 'AI contract mismatch',
      message: 'The AI host did not expose the required Gemini 3.1 Flash-Lite model.'
    };
  }

  if (!provider.connected) {
    return {
      level: 'error',
      title: 'Managed AI unavailable',
      message: 'The managed Gemini status check failed. Try again in a moment.'
    };
  }

  return null;
};
