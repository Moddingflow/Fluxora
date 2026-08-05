import { describe, expect, it, vi } from 'vitest';

import {
  AI_QUOTA_SIGNAL_EVENT,
  createAiQuotaRefreshGate,
  createSupabaseAiQuotaSignalSource,
  isAiQuotaSignalTopic
} from '../src/renderer/features/ai/ai-quota-signal';

const validTopic = `fluxora-ai-quota-${'0123456789abcdef'.repeat(3)}`;

const stubClient = () => {
  const listeners: Array<{ event: string; handler: (payload: unknown) => void }> = [];
  const channel = {
    on(_type: string, filter: { event: string }, handler: (payload: unknown) => void) {
      listeners.push({ event: filter.event, handler });
      return channel;
    },
    subscribe: vi.fn(() => channel)
  };
  return {
    client: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => 'ok')
    },
    channel,
    listeners
  };
};

describe('managed AI quota realtime signal', () => {
  it('accepts only the server-minted opaque topic shape', () => {
    expect(isAiQuotaSignalTopic(validTopic)).toBe(true);
    expect(isAiQuotaSignalTopic(`${validTopic}0`)).toBe(false);
    expect(isAiQuotaSignalTopic('fluxora-ai-quota-')).toBe(false);
    expect(isAiQuotaSignalTopic(validTopic.toUpperCase())).toBe(false);
    expect(isAiQuotaSignalTopic('realtime:public:fluxora_ai_quota_periods')).toBe(false);
    expect(isAiQuotaSignalTopic(null)).toBe(false);
  });

  it('subscribes to the account topic and reports changes without reading the payload', () => {
    const { client, channel, listeners } = stubClient();
    const source = createSupabaseAiQuotaSignalSource(
      { publishableKey: 'sb_publishable_test', url: 'https://tpciohumwahlctpeuduv.supabase.co' },
      client as never
    );
    const onChanged = vi.fn();

    const unsubscribe = source.subscribe(validTopic, { onChanged });

    expect(client.channel).toHaveBeenCalledWith(validTopic);
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(1);
    expect(listeners[0].event).toBe(AI_QUOTA_SIGNAL_EVENT);

    listeners[0].handler({ payload: { schema: 'fluxora.ai.quota-signal.v1' } });
    expect(onChanged).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('never opens a channel for a topic the gateway did not mint', () => {
    const { client } = stubClient();
    const source = createSupabaseAiQuotaSignalSource(
      { publishableKey: 'sb_publishable_test', url: 'https://tpciohumwahlctpeuduv.supabase.co' },
      client as never
    );

    source.subscribe('fluxora-ai-quota-short', { onChanged: vi.fn() })();

    expect(client.channel).not.toHaveBeenCalled();
  });

  it('collapses bursts of signals into one refresh per interval', () => {
    const refresh = vi.fn();
    let clock = 1_000;
    const gate = createAiQuotaRefreshGate(refresh, () => clock, 3_000);

    expect(gate()).toBe(true);
    expect(gate()).toBe(false);
    clock += 2_999;
    expect(gate()).toBe(false);
    clock += 1;
    expect(gate()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
