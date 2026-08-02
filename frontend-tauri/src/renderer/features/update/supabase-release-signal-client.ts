import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient
} from '@supabase/supabase-js';

import type { FluxoraReleaseSignalConfig } from './release-signal-config';
import type {
  FluxoraReleaseSignalHandlers,
  FluxoraReleaseSignalSource
} from './release-signal-service';

const releaseColumns =
  'github_release_id,channel,version,tag_name,published_at';

export const createSupabaseFluxoraReleaseSignalSource = (
  config: FluxoraReleaseSignalConfig,
  client: SupabaseClient = createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  })
): FluxoraReleaseSignalSource => {
  let channel: RealtimeChannel | null = null;

  const addPostgresListener = (
    currentChannel: RealtimeChannel,
    event: 'INSERT' | 'UPDATE',
    handlers: FluxoraReleaseSignalHandlers
  ) => currentChannel.on(
    'postgres_changes',
    {
      event,
      filter: 'channel=eq.stable',
      schema: 'public',
      table: 'fluxora_desktop_releases'
    },
    (payload) => handlers.onAnnouncement(payload.new)
  );

  return {
    getLatest: async () => {
      const { data, error } = await client
        .from('fluxora_desktop_releases')
        .select(releaseColumns)
        .eq('channel', 'stable')
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error('fluxora_release_signal_snapshot_failed');
      return data;
    },
    subscribe: (handlers) => {
      if (channel) throw new Error('Fluxora release signal source is already subscribed');
      let nextChannel = client.channel('fluxora-desktop-releases-stable');
      nextChannel = addPostgresListener(nextChannel, 'INSERT', handlers);
      nextChannel = addPostgresListener(nextChannel, 'UPDATE', handlers);
      channel = nextChannel;
      nextChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') handlers.onSubscribed();
      });

      return () => {
        const subscribedChannel = channel;
        channel = null;
        if (subscribedChannel) void client.removeChannel(subscribedChannel);
      };
    }
  };
};
