import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  FluxoraInstalledMod,
  FluxoraModUpdateCheckResult
} from '../src/shared/fluxora-api';
import {
  applyModUpdateResultToInstalledMods,
  createModUpdateCoordinator
} from '../src/renderer/services/mod-update-coordinator';

const result = (
  projectFileId = '200',
  nextEligibleAt = '2026-07-17T10:00:00Z'
): FluxoraModUpdateCheckResult => ({
  state: 'completed',
  reason: 'none',
  nextEligibleAt,
  quota: {
    hourlyLimit: 1_000,
    hourlyRemaining: 900,
    hourlyResetAt: '2026-07-16T11:00:00Z',
    dailyLimit: 20_000,
    dailyRemaining: 19_000,
    dailyResetAt: '2026-07-17T00:00:00Z',
    capturedAt: '2026-07-16T10:00:00Z'
  },
  counters: {
    apiRequests: 1,
    cacheHits: 0,
    checked: 1,
    updates: 1,
    ambiguous: 0,
    failed: 0
  },
  mods: [
    {
      folderName: 'CS Particle Patch',
      latestVersion: '1.5.2',
      latestFileId: projectFileId,
      updateCheckState: 'completed',
      hasUpdate: projectFileId !== '100'
    }
  ]
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('mod update coordinator', () => {
  it('deduplicates automatic checks for the same ready workspace', async () => {
    const pending = deferred<FluxoraModUpdateCheckResult>();
    const checkUpdates = vi.fn(() => pending.promise);
    const onApplied = vi.fn();
    const coordinator = createModUpdateCoordinator({
      api: { checkUpdates, cancel: vi.fn(async () => undefined) },
      createOperationId: () => 'op-auto',
      onApplied
    });

    coordinator.activate('C:\\Builds\\A');
    coordinator.activate('C:\\Builds\\A');

    expect(checkUpdates).toHaveBeenCalledTimes(1);
    expect(checkUpdates).toHaveBeenCalledWith(
      { projectDirectory: 'C:\\Builds\\A', mode: 'automatic' },
      { operationId: 'op-auto' }
    );
    pending.resolve(result());
    await pending.promise;
    await Promise.resolve();
    expect(onApplied).toHaveBeenCalledTimes(1);
    coordinator.stop();
  });

  it('cancels an in-flight automatic check before starting an explicit manual check', async () => {
    const automatic = deferred<FluxoraModUpdateCheckResult>();
    const manual = deferred<FluxoraModUpdateCheckResult>();
    const checkUpdates = vi
      .fn()
      .mockImplementationOnce(() => automatic.promise)
      .mockImplementationOnce(() => manual.promise);
    const cancel = vi.fn(async () => undefined);
    const coordinator = createModUpdateCoordinator({
      api: { checkUpdates, cancel },
      createOperationId: (scope) => `op-${scope}`,
      onApplied: vi.fn()
    });

    coordinator.activate('C:\\Builds\\A');
    const manualResult = coordinator.checkManual('C:\\Builds\\A', 'op-manual');

    expect(cancel).toHaveBeenCalledWith('op-mods_check_updates_automatic', {
      operationId: 'op-mods_check_updates_cancel'
    });
    expect(checkUpdates).toHaveBeenCalledTimes(1);

    automatic.resolve(result('201'));
    await automatic.promise;

    await vi.waitFor(() => expect(checkUpdates).toHaveBeenCalledTimes(2));
    expect(checkUpdates).toHaveBeenLastCalledWith(
      { projectDirectory: 'C:\\Builds\\A', mode: 'manual' },
      { operationId: 'op-manual' }
    );

    manual.resolve(result('202'));
    await expect(manualResult).resolves.toMatchObject({
      mods: [expect.objectContaining({ latestFileId: '202' })]
    });
    coordinator.stop();
  });

  it('cancels on build switch and never applies the stale result', async () => {
    const first = deferred<FluxoraModUpdateCheckResult>();
    const second = deferred<FluxoraModUpdateCheckResult>();
    const checkUpdates = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const cancel = vi.fn(async () => undefined);
    const onApplied = vi.fn();
    let operation = 0;
    const coordinator = createModUpdateCoordinator({
      api: { checkUpdates, cancel },
      createOperationId: () => `op-${++operation}`,
      onApplied
    });

    coordinator.activate('C:\\Builds\\A');
    coordinator.activate('C:\\Builds\\B');

    expect(cancel).toHaveBeenCalledWith('op-1', { operationId: 'op-2' });
    first.resolve(result('201'));
    second.resolve(result('202'));
    await Promise.all([first.promise, second.promise]);
    await Promise.resolve();

    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith('C:\\Builds\\B', expect.objectContaining({
      mods: [expect.objectContaining({ latestFileId: '202' })]
    }));
    coordinator.stop();
  });

  it('runs again after nextEligibleAt while the app stays open', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T10:00:00Z'));
    const checkUpdates = vi.fn(async () => result());
    const coordinator = createModUpdateCoordinator({
      api: { checkUpdates, cancel: vi.fn(async () => undefined) },
      createOperationId: () => 'op-long-open',
      onApplied: vi.fn()
    });

    coordinator.activate('C:\\Builds\\A');
    await vi.runAllTicks();
    await Promise.resolve();
    expect(checkUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(checkUpdates).toHaveBeenCalledTimes(2);
    coordinator.stop();
  });

  it('changes only the Latest identity fields in the installed-mod view model', () => {
    const installed: FluxoraInstalledMod = {
      id: 'C:\\Builds\\A\\mods\\CS Particle Patch',
      name: 'CS Particle Patch',
      version: '1.5.2',
      latestVersion: '1.5.2',
      latestFileId: '100',
      updateCheckState: 'baseline_pending',
      lastCheckedAt: '',
      updateStatus: 'not checked',
      conflictStatus: 'none',
      fileCount: 1,
      conflictingFileCount: 0,
      overwrittenFileCount: 0,
      overwritingFileCount: 0,
      isEnabled: false,
      canCheckUpdates: true,
      hasUpdate: false,
      sourceIsNexus: true,
      sourceIsModdingFlow: false,
      sourceProvider: 'nexus',
      sourceGameDomain: 'skyrimspecialedition',
      sourceModId: '67856',
      sourceFileId: '100',
      sourceUrl: 'nxm://skyrimspecialedition/mods/67856/files/100',
      isLocal: false,
      isTranslation: false,
      isPatch: false,
      overwritesModIds: [],
      overwrittenByModIds: []
    };

    expect(applyModUpdateResultToInstalledMods([installed], result())[0]).toEqual({
      ...installed,
      latestVersion: '1.5.2',
      latestFileId: '200',
      updateCheckState: 'completed',
      hasUpdate: true
    });
  });

  it('applies a partial result without discarding its reason', async () => {
    const partial = {
      ...result(),
      state: 'partial' as const,
      reason: 'authenticationUnavailable' as const
    };
    const onApplied = vi.fn();
    const coordinator = createModUpdateCoordinator({
      api: {
        checkUpdates: vi.fn(async () => partial),
        cancel: vi.fn(async () => undefined)
      },
      createOperationId: () => 'op-partial',
      onApplied
    });

    coordinator.activate('C:\\Builds\\A');
    await Promise.resolve();
    await Promise.resolve();

    expect(onApplied).toHaveBeenCalledWith(
      'C:\\Builds\\A',
      expect.objectContaining({
        state: 'partial',
        reason: 'authenticationUnavailable'
      })
    );
    coordinator.stop();
  });

  it('hands authenticationUnavailable to connection recovery and keeps the daily retry alive', async () => {
    vi.useFakeTimers();
    const partial = {
      ...result(),
      state: 'partial' as const,
      reason: 'authenticationUnavailable' as const
    };
    const checkUpdates = vi.fn(async () => partial);
    const onAuthenticationUnavailable = vi.fn();
    const coordinator = createModUpdateCoordinator({
      api: { checkUpdates, cancel: vi.fn(async () => undefined) },
      createOperationId: () => 'op-auth-unavailable',
      onApplied: vi.fn(),
      onAuthenticationUnavailable
    });

    coordinator.activate('C:\\Builds\\A');
    await vi.runAllTicks();
    await Promise.resolve();

    expect(onAuthenticationUnavailable).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(checkUpdates).toHaveBeenCalledTimes(2);
    coordinator.stop();
  });

  it('keeps a resource-specific metadata failure out of connection recovery', async () => {
    const partial = {
      ...result(),
      state: 'partial' as const,
      reason: 'metadataUnavailable' as const
    };
    const onAuthenticationUnavailable = vi.fn();
    const coordinator = createModUpdateCoordinator({
      api: {
        checkUpdates: vi.fn(async () => partial),
        cancel: vi.fn(async () => undefined)
      },
      createOperationId: () => 'op-resource-unavailable',
      onApplied: vi.fn(),
      onAuthenticationUnavailable
    });

    coordinator.activate('C:\\Builds\\A');
    await Promise.resolve();
    await Promise.resolve();

    expect(onAuthenticationUnavailable).not.toHaveBeenCalled();
    coordinator.stop();
  });
});
