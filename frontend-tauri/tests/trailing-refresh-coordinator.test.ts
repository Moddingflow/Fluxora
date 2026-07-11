import { describe, expect, it } from 'vitest';

import {
  createPendingPathAccumulator,
  createScopedSequenceTracker,
  createTrailingRefreshCoordinator,
  drainPendingPathsWithRetry,
  topLevelChangedModPaths
} from '../src/renderer/services/trailing-refresh-coordinator';

describe('trailing refresh coordinator', () => {
  it('accumulates every changed path until the trailing refresh drains them', () => {
    const pendingPaths = createPendingPathAccumulator();

    pendingPaths.add('C:\\Build A', ['C:\\mods\\Alpha', 'C:\\mods\\Beta']);
    pendingPaths.add('c:\\build a', ['c:\\mods\\alpha', 'C:\\mods\\Gamma']);
    pendingPaths.add('C:\\Build B', ['C:\\other\\Delta']);

    expect(pendingPaths.drain('C:\\BUILD A')).toEqual([
      'C:\\mods\\Alpha',
      'C:\\mods\\Beta',
      'C:\\mods\\Gamma'
    ]);
    expect(pendingPaths.drain('C:\\Build A')).toEqual([]);
    expect(pendingPaths.drain('C:\\Build B')).toEqual(['C:\\other\\Delta']);
  });

  it('drains every project scope so a rapid switch cannot strand invalidation', () => {
    const pendingPaths = createPendingPathAccumulator();
    pendingPaths.add('C:\\Build A', ['C:\\Build A\\mods\\Alpha']);
    pendingPaths.add('C:\\Build B', []);

    expect(pendingPaths.drainAll()).toEqual([
      { scope: 'C:\\Build A', paths: ['C:\\Build A\\mods\\Alpha'], revision: 0 },
      { scope: 'C:\\Build B', paths: [], revision: 0 }
    ]);
    expect(pendingPaths.drainAll()).toEqual([]);
  });

  it('coalesces a scope at its newest watcher revision', () => {
    const pendingPaths = createPendingPathAccumulator();

    pendingPaths.add('C:\\Build A', ['C:\\Build A\\mods\\Alpha'], 17);
    pendingPaths.add('c:\\build a', ['C:\\Build A\\mods\\Beta'], 15);
    pendingPaths.add('C:\\BUILD A', ['C:\\Build A\\mods\\Gamma'], 23);

    expect(pendingPaths.drainAll()).toEqual([
      {
        scope: 'C:\\Build A',
        paths: [
          'C:\\Build A\\mods\\Alpha',
          'C:\\Build A\\mods\\Beta',
          'C:\\Build A\\mods\\Gamma'
        ],
        revision: 23
      }
    ]);
  });

  it('requeues a failed scope without blocking later project invalidation', async () => {
    const pendingPaths = createPendingPathAccumulator();
    pendingPaths.add('C:\\Build A', ['C:\\Build A\\mods\\Alpha'], 41);
    pendingPaths.add('C:\\Build B', ['C:\\Build B\\mods\\Beta']);
    const consumedScopes: string[] = [];

    const result = await drainPendingPathsWithRetry(
      pendingPaths,
      async ({ scope }) => {
        consumedScopes.push(scope);
        if (scope === 'C:\\Build A') {
          throw new Error('bridge unavailable');
        }
      },
      1
    );

    expect(consumedScopes).toEqual(['C:\\Build A', 'C:\\Build B']);
    expect(result.failedScopes).toEqual(['C:\\Build A']);
    expect(pendingPaths.drainAll()).toEqual([
      { scope: 'C:\\Build A', paths: ['C:\\Build A\\mods\\Alpha'], revision: 41 }
    ]);
  });

  it('retries a transient invalidation without losing its paths', async () => {
    const pendingPaths = createPendingPathAccumulator();
    pendingPaths.add('C:\\Build A', ['C:\\Build A\\mods\\Alpha']);
    let attempts = 0;

    const result = await drainPendingPathsWithRetry(
      pendingPaths,
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('bridge restarting');
        }
      },
      3,
      async () => undefined
    );

    expect(attempts).toBe(2);
    expect(result.failedScopes).toEqual([]);
    expect(pendingPaths.drainAll()).toEqual([]);
  });

  it('flags sequence gaps per project without treating the first event as a gap', () => {
    const sequences = createScopedSequenceTracker();

    expect(sequences.record('C:\\Build A', 7)).toBe(false);
    expect(sequences.record('c:\\build a', 8)).toBe(false);
    expect(sequences.record('C:\\Build B', 20)).toBe(false);
    expect(sequences.record('C:\\Build A', 10)).toBe(true);
    sequences.clear('C:\\Build A');
    expect(sequences.record('C:\\Build A', 42)).toBe(false);
  });

  it('reduces watcher files to affected mod folders and caps large batches', () => {
    expect(
      topLevelChangedModPaths('C:\\Build\\mods', [
        'C:\\Build\\mods\\Alpha\\textures\\a.dds',
        'c:/build/mods/alpha/meshes/a.nif',
        'C:\\Build\\mods\\Beta\\plugin.esp',
        'C:\\Build\\Game\\Data\\Skyrim.esm'
      ])
    ).toEqual(['C:\\Build\\mods\\Alpha', 'C:\\Build\\mods\\Beta']);

    expect(
      topLevelChangedModPaths(
        'C:\\Build\\mods',
        [
          'C:\\Build\\mods\\Alpha\\a.txt',
          'C:\\Build\\mods\\Beta\\b.txt',
          'C:\\Build\\mods\\Gamma\\c.txt'
        ],
        2
      )
    ).toEqual(['C:\\Build\\mods']);
  });

  it('runs one active refresh and only the latest queued refresh', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];
    const coordinator = createTrailingRefreshCoordinator();

    const active = coordinator.schedule(async () => {
      calls.push('first');
      await firstGate;
    });
    const superseded = coordinator.schedule(async () => {
      calls.push('second');
    });
    const trailing = coordinator.schedule(async () => {
      calls.push('third');
    });

    expect(calls).toEqual(['first']);
    releaseFirst();
    await Promise.all([active, superseded, trailing]);

    expect(calls).toEqual(['first', 'third']);
    expect(coordinator.isRunning()).toBe(false);
  });

  it('continues draining with the newest task after a refresh fails', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];
    const coordinator = createTrailingRefreshCoordinator(async () => undefined);

    const active = coordinator.schedule(async () => {
      calls.push('first');
      await firstGate;
      throw new Error('refresh failed');
    });
    const trailing = coordinator.schedule(async () => {
      calls.push('trailing');
    });

    releaseFirst();
    await Promise.all([active, trailing]);

    await coordinator.schedule(async () => {
      calls.push('after-failure');
    });
    expect(calls).toEqual(['first', 'trailing', 'after-failure']);
  });

  it('retries a failed latest task without requiring another watcher event', async () => {
    let attempts = 0;
    const waits: number[] = [];
    const coordinator = createTrailingRefreshCoordinator(async (milliseconds) => {
      waits.push(milliseconds);
    });

    await coordinator.schedule(async () => {
      attempts += 1;
      if (attempts < 4) {
        throw new Error('bridge remains unavailable');
      }
    });

    expect(attempts).toBe(4);
    expect(waits).toEqual([1_000, 2_000, 4_000]);
    expect(coordinator.isRunning()).toBe(false);
  });

  it('stops autonomous retries on teardown and can resume after a StrictMode-style remount', async () => {
    let releaseWait!: () => void;
    const waitGate = new Promise<void>((resolve) => {
      releaseWait = resolve;
    });
    let attempts = 0;
    const coordinator = createTrailingRefreshCoordinator(async () => waitGate);

    const running = coordinator.schedule(async () => {
      attempts += 1;
      throw new Error('bridge remains unavailable');
    });
    await Promise.resolve();
    expect(attempts).toBe(1);

    coordinator.stop();
    releaseWait();
    await running;
    expect(attempts).toBe(1);
    expect(coordinator.isRunning()).toBe(false);

    coordinator.resume();
    await coordinator.schedule(async () => {
      attempts += 1;
    });
    expect(attempts).toBe(2);
  });

  it('wakes a never-resolving retry wait so an immediate resume can drain new work', async () => {
    let retryWaitStarted!: () => void;
    const retryWaitIsActive = new Promise<void>((resolve) => {
      retryWaitStarted = resolve;
    });
    const neverResolvingWait = new Promise<void>(() => undefined);
    const calls: string[] = [];
    const coordinator = createTrailingRefreshCoordinator(async () => {
      retryWaitStarted();
      await neverResolvingWait;
    });

    const stale = coordinator.schedule(async () => {
      calls.push('stale');
      throw new Error('bridge unavailable');
    });
    await retryWaitIsActive;

    coordinator.stop();
    coordinator.resume();
    const resumed = coordinator.schedule(async () => {
      calls.push('resumed');
    });

    await Promise.all([stale, resumed]);
    expect(calls).toEqual(['stale', 'resumed']);
    expect(coordinator.isRunning()).toBe(false);
  });

  it('wakes retry backoff when a newer watcher task supersedes failed work', async () => {
    let retryWaitStarted!: () => void;
    const retryWaitIsActive = new Promise<void>((resolve) => {
      retryWaitStarted = resolve;
    });
    const calls: string[] = [];
    const coordinator = createTrailingRefreshCoordinator(async () => {
      retryWaitStarted();
      await new Promise<void>(() => undefined);
    });

    const failed = coordinator.schedule(async () => {
      calls.push('failed');
      throw new Error('bridge unavailable');
    });
    await retryWaitIsActive;
    const newest = coordinator.schedule(async () => {
      calls.push('newest');
    });

    await Promise.all([failed, newest]);
    expect(calls).toEqual(['failed', 'newest']);
    expect(coordinator.isRunning()).toBe(false);
  });

  it('never replays a rejected active task from a stopped renderer lifetime', async () => {
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const calls: string[] = [];
    const waits: number[] = [];
    const coordinator = createTrailingRefreshCoordinator(async (milliseconds) => {
      waits.push(milliseconds);
    });

    const active = coordinator.schedule(async () => {
      calls.push('old-lifetime');
      await activeGate;
      throw new Error('old renderer failed after teardown');
    });
    coordinator.stop();
    coordinator.resume();
    const remounted = coordinator.schedule(async () => {
      calls.push('new-lifetime');
    });

    releaseActive();
    await Promise.all([active, remounted]);

    expect(calls).toEqual(['old-lifetime', 'new-lifetime']);
    expect(waits).toEqual([]);
    expect(coordinator.isRunning()).toBe(false);
  });
});
