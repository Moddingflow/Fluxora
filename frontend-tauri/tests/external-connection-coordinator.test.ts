import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  FluxoraExternalConnectionSnapshot,
  FluxoraExternalConnectionState
} from '../src/shared/fluxora-api';
import { createExternalConnectionCoordinator } from '../src/renderer/services/external-connection-coordinator';

const snapshot = (
  state: FluxoraExternalConnectionState,
  attempt: number,
  retryable = state === 'temporarilyUnavailable'
): FluxoraExternalConnectionSnapshot => ({
  providers: [
    {
      providerId: 'nexus',
      label: 'Nexus Mods',
      state,
      accountName: 'Valerii',
      hasStoredSession: state !== 'notLinked',
      retryable,
      requiresUserAction: state === 'reauthRequired',
      message: state,
      checkedAtUtc: '2026-07-19T07:00:00Z',
      operationId: `op-${attempt}`
    }
  ],
  requestedAtUtc: '2026-07-19T07:00:00Z',
  completedAtUtc: '2026-07-19T07:00:00Z',
  durationMs: 1,
  timedOut: state === 'temporarilyUnavailable',
  operationId: `op-${attempt}`
});

afterEach(() => {
  vi.useRealTimers();
});

describe('external connection coordinator', () => {
  it('publishes the Core-restored startup status before scheduling bounded retries', async () => {
    vi.useFakeTimers();
    const local = snapshot('restoring', 0, true);
    const restoreAll = vi
      .fn()
      .mockResolvedValueOnce(snapshot('temporarilyUnavailable', 1))
      .mockResolvedValueOnce(snapshot('temporarilyUnavailable', 2))
      .mockResolvedValueOnce(snapshot('temporarilyUnavailable', 3))
      .mockResolvedValueOnce(snapshot('temporarilyUnavailable', 4))
      .mockResolvedValueOnce(snapshot('temporarilyUnavailable', 5))
      .mockResolvedValueOnce(snapshot('temporarilyUnavailable', 6))
      .mockResolvedValue(snapshot('temporarilyUnavailable', 7));
    const onSnapshot = vi.fn();
    const coordinator = createExternalConnectionCoordinator({
      api: {
        listStatus: vi.fn(async () => local),
        restoreAll
      },
      createOperationId: (scope) => `op-${scope}`,
      onSnapshot
    });

    await expect(coordinator.bootstrap()).resolves.toEqual(local);

    expect(onSnapshot.mock.calls.map(([value]) => value)).toEqual([local]);
    expect(restoreAll).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_999);
    expect(restoreAll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(restoreAll).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({
      operationId: expect.stringContaining('connections_restore_scheduled')
    }));
    expect(onSnapshot).toHaveBeenLastCalledWith(snapshot('temporarilyUnavailable', 1));

    for (const [index, delay] of [2_000, 5_000, 15_000, 30_000, 60_000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(restoreAll).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(restoreAll).toHaveBeenCalledTimes(index + 2);
    }

    await vi.advanceTimersByTimeAsync(300_000);
    expect(restoreAll).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(restoreAll).toHaveBeenCalledTimes(8);
    coordinator.stop();
  });

  it('deduplicates immediate focus/online retries while a restoration is in flight', async () => {
    let resolveRestore!: (value: FluxoraExternalConnectionSnapshot) => void;
    const pending = new Promise<FluxoraExternalConnectionSnapshot>((resolve) => {
      resolveRestore = resolve;
    });
    const restoreAll = vi.fn(() => pending);
    const coordinator = createExternalConnectionCoordinator({
      api: {
        listStatus: vi.fn(async () => snapshot('temporarilyUnavailable', 0)),
        restoreAll
      },
      createOperationId: () => 'op-immediate',
      onSnapshot: vi.fn()
    });
    coordinator.acceptSnapshot(snapshot('temporarilyUnavailable', 0));

    const first = coordinator.retryNow('online');
    const second = coordinator.retryNow('focus');

    expect(restoreAll).toHaveBeenCalledTimes(1);
    resolveRestore(snapshot('ready', 1, false));
    await Promise.all([first, second]);
    coordinator.stop();
  });

  it.each(['ready', 'notConfigured', 'notLinked', 'reauthRequired'] as const)(
    'does not retry terminal state %s',
    async (state) => {
      vi.useFakeTimers();
      const restoreAll = vi.fn(async () => snapshot(state, 1, false));
      const coordinator = createExternalConnectionCoordinator({
        api: { listStatus: vi.fn(async () => snapshot(state, 0, false)), restoreAll },
        createOperationId: () => 'op-terminal',
        onSnapshot: vi.fn()
      });

      coordinator.acceptSnapshot(snapshot(state, 0, false));
      await coordinator.retryNow('focus');
      await vi.runOnlyPendingTimersAsync();

      expect(restoreAll).not.toHaveBeenCalled();
      coordinator.stop();
    }
  );

  it('does not duplicate the authoritative Core startup restore for a ready provider', async () => {
    const local = snapshot('ready', 0, false);
    const listStatus = vi.fn(async () => local);
    const restoreAll = vi.fn(async () => snapshot('ready', 1, false));
    const onSnapshot = vi.fn();
    const coordinator = createExternalConnectionCoordinator({
      api: { listStatus, restoreAll },
      createOperationId: () => 'op-ready-bootstrap',
      onSnapshot
    });

    await expect(coordinator.bootstrap()).resolves.toEqual(local);

    expect(listStatus).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledOnce();
    expect(onSnapshot).toHaveBeenCalledWith(local);
    expect(restoreAll).not.toHaveBeenCalled();
    coordinator.stop();
  });

  it('keeps retry scheduling when a deferred shell restoration call times out', async () => {
    vi.useFakeTimers();
    const restoreAll = vi
      .fn()
      .mockRejectedValueOnce(new Error('bridge timeout'))
      .mockResolvedValueOnce(snapshot('ready', 2, false));
    const onSnapshot = vi.fn();
    const coordinator = createExternalConnectionCoordinator({
      api: {
        listStatus: vi.fn(async () => snapshot('restoring', 0)),
        restoreAll
      },
      createOperationId: () => 'op-shell-timeout',
      onSnapshot
    });

    const local = snapshot('restoring', 0);
    await expect(coordinator.bootstrap()).resolves.toEqual(local);
    expect(restoreAll).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      timedOut: true,
      providers: [expect.objectContaining({ state: 'temporarilyUnavailable', retryable: true })]
    }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(restoreAll).toHaveBeenCalledTimes(2);
    coordinator.stop();
  });
});
