import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient
} from '@supabase/supabase-js';

import {
  releaseSignalConfigFromImportMeta,
  type FluxoraReleaseSignalConfig
} from '../update/release-signal-config';

/**
 * Managed AI limits change the moment ModdingFlow billing changes: a new
 * subscription, a renewal, a lapsed payment, or a refund. The Website resolves
 * the allowance on every status call, so the desktop only needs to learn *when*
 * to ask again.
 *
 * The account's quota topic is an opaque name minted server-side and delivered
 * exclusively through the authenticated gateway status response. Messages on it
 * are content-free by contract: they never carry a budget, a tier, or a token
 * count. Everything the panel displays still comes from the authenticated
 * status call, so an observer who somehow reached the channel would learn
 * nothing, and a forged message can only cost one extra status request.
 */
export const AI_QUOTA_SIGNAL_EVENT = 'fluxora.ai.quota.changed';

/** Floor between two signal-driven refreshes, so a noisy topic cannot loop. */
export const AI_QUOTA_SIGNAL_MIN_INTERVAL_MS = 3_000;

export const AI_QUOTA_SIGNAL_TOPIC_PATTERN = /^fluxora-ai-quota-[0-9a-f]{48}$/;

export interface AiQuotaSignalHandlers {
  onChanged: () => void;
}

export interface AiQuotaSignalSource {
  subscribe(topic: string, handlers: AiQuotaSignalHandlers): () => void;
}

export const isAiQuotaSignalTopic = (value: unknown): value is string =>
  typeof value === 'string' && AI_QUOTA_SIGNAL_TOPIC_PATTERN.test(value);

export const createSupabaseAiQuotaSignalSource = (
  config: FluxoraReleaseSignalConfig,
  client: SupabaseClient = createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  })
): AiQuotaSignalSource => ({
  subscribe: (topic, handlers) => {
    if (!isAiQuotaSignalTopic(topic)) return () => undefined;

    let channel: RealtimeChannel | null = client
      .channel(topic)
      .on(
        'broadcast',
        { event: AI_QUOTA_SIGNAL_EVENT },
        () => handlers.onChanged()
      );
    channel.subscribe();

    return () => {
      const subscribed = channel;
      channel = null;
      if (subscribed) void client.removeChannel(subscribed);
    };
  }
});

/**
 * The quota channel lives in the same ModdingFlow Supabase project as the
 * release signal and uses the same publishable key, so it shares that
 * configuration instead of introducing a second build-time secret.
 */
export const aiQuotaSignalSourceFromImportMeta = (): AiQuotaSignalSource | null => {
  const config = releaseSignalConfigFromImportMeta();
  return config ? createSupabaseAiQuotaSignalSource(config) : null;
};

/**
 * Rate-limited refresh trigger. A signal, a window focus, and a finished run
 * can all ask for the same refresh; only one runs per interval.
 */
export const createAiQuotaRefreshGate = (
  refresh: () => void,
  now: () => number = Date.now,
  minimumIntervalMs = AI_QUOTA_SIGNAL_MIN_INTERVAL_MS
) => {
  let lastAt = Number.NEGATIVE_INFINITY;
  return () => {
    const current = now();
    if (current - lastAt < minimumIntervalMs) return false;
    lastAt = current;
    refresh();
    return true;
  };
};
