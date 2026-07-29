import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceOrderMutationGate } from '../src/renderer/services/workspace-order-mutation-gate';

describe('workspace order mutation gate', () => {
  it('serializes mod and plugin mutations through the same durable queue', async () => {
    let releaseModMove!: () => void;
    const modMove = new Promise<void>((resolve) => {
      releaseModMove = resolve;
    });
    const calls: string[] = [];
    const gate = createWorkspaceOrderMutationGate();

    const first = gate.enqueue(async () => {
      calls.push('mod:start');
      await modMove;
      calls.push('mod:end');
    });
    const second = gate.enqueue(async () => {
      calls.push('plugin:start');
      calls.push('plugin:end');
    });

    await Promise.resolve();
    expect(calls).toEqual(['mod:start']);

    releaseModMove();
    await Promise.all([first, second]);
    expect(calls).toEqual(['mod:start', 'mod:end', 'plugin:start', 'plugin:end']);
  });

  it('reconciles only the latest queued mutation before exposing a stable snapshot', async () => {
    let releaseFirstMove!: () => void;
    const firstMove = new Promise<void>((resolve) => {
      releaseFirstMove = resolve;
    });
    const firstReconcile = vi.fn(async () => undefined);
    const secondReconcile = vi.fn(async (isCurrent: () => boolean) => {
      expect(isCurrent()).toBe(true);
    });
    const readSnapshot = vi.fn(async () => ['separator', 'mod-a', 'mod-b']);
    const gate = createWorkspaceOrderMutationGate();

    const first = gate.enqueue(async () => firstMove, firstReconcile);
    const second = gate.enqueue(async () => undefined, secondReconcile);
    const snapshot = gate.readStable(readSnapshot);

    releaseFirstMove();
    await Promise.all([first, second]);
    await expect(snapshot).resolves.toEqual(['separator', 'mod-a', 'mod-b']);
    expect(firstReconcile).not.toHaveBeenCalled();
    expect(secondReconcile).toHaveBeenCalledTimes(1);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it('invalidates a reconciliation when a newer mutation starts while it is reading', async () => {
    let releaseReconciliation!: () => void;
    const reconciliationRead = new Promise<void>((resolve) => {
      releaseReconciliation = resolve;
    });
    let markReconciliationStarted!: () => void;
    const reconciliationStarted = new Promise<void>((resolve) => {
      markReconciliationStarted = resolve;
    });
    let firstWasCurrentAfterRead: boolean | null = null;
    const gate = createWorkspaceOrderMutationGate();

    const first = gate.enqueue(
      async () => undefined,
      async (isCurrent) => {
        markReconciliationStarted();
        await reconciliationRead;
        firstWasCurrentAfterRead = isCurrent();
      }
    );
    await reconciliationStarted;
    const second = gate.enqueue(async () => undefined);

    releaseReconciliation();
    await Promise.all([first, second]);
    expect(firstWasCurrentAfterRead).toBe(false);
  });
});
