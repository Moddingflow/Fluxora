import { describe, expect, it, vi } from 'vitest';

import {
  appUpdateFocusMinimumAgeMs,
  appUpdatePeriodicIntervalMs,
  createAppUpdateScheduler
} from '../src/renderer/features/update/app-update-scheduler';

describe('app update scheduler', () => {
  it('checks periodically and when focus returns after the minimum age', async () => {
    let nowMs = 0;
    let interval: (() => void) | undefined;
    let focus: (() => void) | undefined;
    const disposeInterval = vi.fn();
    const disposeFocus = vi.fn();
    const check = vi.fn(async () => undefined);
    const scheduler = createAppUpdateScheduler({
      check,
      now: () => nowMs,
      scheduleInterval: (listener, intervalMs) => {
        expect(intervalMs).toBe(appUpdatePeriodicIntervalMs);
        interval = listener;
        return disposeInterval;
      },
      listenForFocus: (listener) => {
        focus = listener;
        return disposeFocus;
      }
    });

    scheduler.start();
    nowMs = appUpdateFocusMinimumAgeMs - 1;
    focus?.();
    expect(check).not.toHaveBeenCalled();

    nowMs = appUpdateFocusMinimumAgeMs;
    focus?.();
    await Promise.resolve();
    expect(check).toHaveBeenCalledTimes(1);

    nowMs += appUpdatePeriodicIntervalMs;
    interval?.();
    await Promise.resolve();
    expect(check).toHaveBeenCalledTimes(2);

    scheduler.stop();
    expect(disposeInterval).toHaveBeenCalledOnce();
    expect(disposeFocus).toHaveBeenCalledOnce();
  });
});
