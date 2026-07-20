import { describe, expect, it } from 'vitest';

import {
  connectionActionLabel,
  connectionCanToggle,
  connectionIsReady,
  connectionSnapshotStorageKey,
  connectionSummary,
  loadCachedConnectionSnapshot,
  mergeConnectionStatus,
  providerFromSnapshot,
  saveCachedConnectionSnapshot
} from '../src/renderer/connection-workspace-state';
import { nexusStatusStorageKey } from '../src/renderer/settings-workspace-state';
import type {
  FluxoraExternalConnectionSnapshot,
  FluxoraExternalConnectionStatus
} from '../src/shared/fluxora-api';

const status = (
  state: FluxoraExternalConnectionStatus['state']
): FluxoraExternalConnectionStatus => ({
  providerId: 'nexus',
  label: 'Nexus Mods',
  state,
  accountName: 'Valerii',
  hasStoredSession: state !== 'notLinked',
  retryable: state === 'temporarilyUnavailable',
  requiresUserAction: state === 'reauthRequired',
  message: state,
  checkedAtUtc: '2026-07-19T07:00:00Z',
  operationId: 'op-status'
});

const snapshot = (state: FluxoraExternalConnectionStatus['state']): FluxoraExternalConnectionSnapshot => ({
  providers: [status(state)],
  requestedAtUtc: '2026-07-19T07:00:00Z',
  completedAtUtc: '2026-07-19T07:00:00Z',
  durationMs: 1,
  timedOut: false,
  operationId: 'op-snapshot'
});

describe('connection workspace state', () => {
  it('migrates the old Nexus cache into a restoring generic provider without treating it as ready', () => {
    const values = new Map<string, string>([
      [nexusStatusStorageKey, JSON.stringify({
        isConfigured: true,
        lastKnownLinked: true,
        displayName: 'Cached user',
        userId: 'cached-id',
        operationId: 'op-legacy'
      })]
    ]);

    const migrated = loadCachedConnectionSnapshot({
      getItem: (key) => values.get(key) ?? null
    });

    expect(migrated.providers).toEqual([
      expect.objectContaining({
        providerId: 'nexus',
        state: 'restoring',
        accountName: 'Cached user',
        hasStoredSession: true,
        retryable: true
      })
    ]);
    expect(connectionIsReady(providerFromSnapshot(migrated, 'nexus'))).toBe(false);
  });

  it('persists the generic safe snapshot and ignores malformed cache data', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    saveCachedConnectionSnapshot(storage, snapshot('ready'));
    expect(loadCachedConnectionSnapshot(storage)).toEqual(snapshot('ready'));
    values.set(connectionSnapshotStorageKey, '{bad');
    expect(loadCachedConnectionSnapshot(storage).providers).toEqual([]);
  });

  it('renders calm retrying state and reserves explicit error action for reauthentication', () => {
    expect(connectionSummary(status('restoring'))).toBe('Reconnecting');
    expect(connectionSummary(status('temporarilyUnavailable'))).toBe('Reconnecting');
    expect(connectionActionLabel(status('reauthRequired'))).toBe('Sign in again');
    expect(connectionCanToggle(status('temporarilyUnavailable'), true)).toBe(false);
    expect(connectionCanToggle(status('reauthRequired'), true)).toBe(true);
    expect(connectionSummary(status('ready'))).toBe('Connected - Valerii');
  });

  it('merges one manual provider result without losing other providers', () => {
    const initial = {
      ...snapshot('restoring'),
      providers: [status('restoring'), { ...status('ready'), providerId: 'other', label: 'Other' }]
    };
    const merged = mergeConnectionStatus(initial, status('ready'));

    expect(merged.providers.map((provider) => [provider.providerId, provider.state])).toEqual([
      ['nexus', 'ready'],
      ['other', 'ready']
    ]);
  });
});
