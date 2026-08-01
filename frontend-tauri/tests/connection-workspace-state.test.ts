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

  it('persists only the allowlisted connection status fields', () => {
    const values = new Map<string, string>();
    const unsafeSnapshot = snapshot('ready') as FluxoraExternalConnectionSnapshot & {
      authorizationUrl: string;
      accessToken: string;
    };
    unsafeSnapshot.authorizationUrl = 'https://moddingflow.com/oauth/authorize?state=secret';
    unsafeSnapshot.accessToken = 'secret-access-token';
    (unsafeSnapshot.providers[0] as FluxoraExternalConnectionStatus & {
      callbackUrl: string;
      refreshToken: string;
    }).callbackUrl = 'http://127.0.0.1:12345/oauth/fluxora/callback?code=secret';
    (unsafeSnapshot.providers[0] as FluxoraExternalConnectionStatus & {
      callbackUrl: string;
      refreshToken: string;
    }).refreshToken = 'secret-refresh-token';

    saveCachedConnectionSnapshot(
      {
        setItem: (key, value) => values.set(key, value)
      },
      unsafeSnapshot
    );

    const persisted = values.get(connectionSnapshotStorageKey) ?? '';
    expect(persisted).not.toContain('authorizationUrl');
    expect(persisted).not.toContain('accessToken');
    expect(persisted).not.toContain('callbackUrl');
    expect(persisted).not.toContain('refreshToken');
    expect(JSON.parse(persisted)).toEqual(snapshot('ready'));
  });

  it('never persists the ModdingFlow account display name and scrubs legacy cached names', () => {
    const values = new Map<string, string>();
    const moddingFlowSnapshot: FluxoraExternalConnectionSnapshot = {
      ...snapshot('ready'),
      providers: [{
        ...status('ready'),
        providerId: 'moddingflow',
        label: 'ModdingFlow',
        accountName: 'Private nickname'
      }]
    };

    saveCachedConnectionSnapshot(
      {
        setItem: (key, value) => values.set(key, value)
      },
      moddingFlowSnapshot
    );

    const persisted = values.get(connectionSnapshotStorageKey) ?? '';
    expect(persisted).not.toContain('Private nickname');
    expect(loadCachedConnectionSnapshot({
      getItem: (key) => values.get(key) ?? null
    }).providers[0]?.accountName).toBe('');

    values.set(connectionSnapshotStorageKey, JSON.stringify(moddingFlowSnapshot));
    expect(loadCachedConnectionSnapshot({
      getItem: (key) => values.get(key) ?? null
    }).providers[0]?.accountName).toBe('');
  });

  it('renders calm retrying state and reserves explicit error action for reauthentication', () => {
    expect(connectionSummary(status('restoring'))).toBe('Reconnecting');
    expect(connectionSummary(status('temporarilyUnavailable'))).toBe('Reconnecting');
    expect(connectionSummary(status('connecting'))).toBe('Connecting');
    expect(connectionActionLabel(status('connecting'))).toBe('Cancel');
    expect(connectionActionLabel(status('reauthRequired'))).toBe('Reconnect');
    expect(connectionActionLabel(status('ready'))).toBe('Disconnect');
    expect(connectionActionLabel(status('notLinked'))).toBe('Connect');
    expect(connectionCanToggle(status('temporarilyUnavailable'), true)).toBe(false);
    expect(connectionCanToggle(status('connecting'), true)).toBe(true);
    expect(connectionCanToggle(status('reauthRequired'), true)).toBe(true);
    expect(connectionSummary(status('ready'))).toBe('Connected - Valerii');
  });

  it('uses the explicit unavailable message instead of implying user configuration is missing', () => {
    const unavailable = {
      ...status('notConfigured'),
      message: 'ModdingFlow connection is not available in this build.'
    };
    expect(connectionSummary(unavailable)).toBe(
      'ModdingFlow connection is not available in this build.'
    );
    expect(connectionCanToggle(unavailable, true)).toBe(false);
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
