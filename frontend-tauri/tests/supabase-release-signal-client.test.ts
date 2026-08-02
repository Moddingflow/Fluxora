import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn()
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient
}));

import { FLUXORA_RELEASES_SUPABASE_URL } from '../src/renderer/features/update/release-signal-config';
import { createSupabaseFluxoraReleaseSignalSource } from '../src/renderer/features/update/supabase-release-signal-client';

describe('Supabase Fluxora release signal source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses an ephemeral public client and subscribes to stable INSERT and UPDATE rows', () => {
    const postgresHandlers: Array<(payload: { new: unknown }) => void> = [];
    let statusHandler: ((status: string) => void) | undefined;
    const channel = {
      on: vi.fn((_kind, _filter, handler) => {
        postgresHandlers.push(handler);
        return channel;
      }),
      subscribe: vi.fn((handler) => {
        statusHandler = handler;
        return channel;
      })
    };
    const client = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => 'ok')
    };
    mocks.createClient.mockReturnValue(client);
    const onAnnouncement = vi.fn();
    const onSubscribed = vi.fn();

    const source = createSupabaseFluxoraReleaseSignalSource({
      publishableKey: 'sb_publishable_test_value',
      url: FLUXORA_RELEASES_SUPABASE_URL
    });
    const dispose = source.subscribe({ onAnnouncement, onSubscribed });

    expect(mocks.createClient).toHaveBeenCalledWith(
      FLUXORA_RELEASES_SUPABASE_URL,
      'sb_publishable_test_value',
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false
        }
      }
    );
    expect(channel.on.mock.calls.map((call) => call[1])).toEqual([
      {
        event: 'INSERT',
        filter: 'channel=eq.stable',
        schema: 'public',
        table: 'fluxora_desktop_releases'
      },
      {
        event: 'UPDATE',
        filter: 'channel=eq.stable',
        schema: 'public',
        table: 'fluxora_desktop_releases'
      }
    ]);

    statusHandler?.('SUBSCRIBED');
    statusHandler?.('CHANNEL_ERROR');
    postgresHandlers[0]?.({ new: { version: '1.2.3' } });
    expect(onSubscribed).toHaveBeenCalledOnce();
    expect(onAnnouncement).toHaveBeenCalledWith({ version: '1.2.3' });

    dispose();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('loads one latest stable snapshot and fails closed on query errors', async () => {
    const row = {
      channel: 'stable',
      github_release_id: 7,
      published_at: '2026-08-02T12:00:00Z',
      tag_name: 'v1.2.3',
      version: '1.2.3'
    };
    const query = {
      eq: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn(),
      order: vi.fn(),
      select: vi.fn()
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    query.maybeSingle.mockResolvedValueOnce({ data: row, error: null });
    const client = {
      channel: vi.fn(),
      from: vi.fn(() => query),
      removeChannel: vi.fn()
    };
    mocks.createClient.mockReturnValue(client);
    const source = createSupabaseFluxoraReleaseSignalSource({
      publishableKey: 'sb_publishable_test_value',
      url: FLUXORA_RELEASES_SUPABASE_URL
    });

    await expect(source.getLatest()).resolves.toEqual(row);
    expect(client.from).toHaveBeenCalledWith('fluxora_desktop_releases');
    expect(query.eq).toHaveBeenCalledWith('channel', 'stable');
    expect(query.order).toHaveBeenCalledWith('published_at', { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(1);

    query.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await expect(source.getLatest()).rejects.toThrow(
      'fluxora_release_signal_snapshot_failed'
    );
  });
});
