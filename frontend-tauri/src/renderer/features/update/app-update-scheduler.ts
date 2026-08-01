export const appUpdatePeriodicIntervalMs = 15 * 60 * 1_000;
export const appUpdateFocusMinimumAgeMs = 5 * 60 * 1_000;

export interface AppUpdateSchedulerOptions {
  check: () => Promise<void>;
  now?: () => number;
  scheduleInterval: (listener: () => void, intervalMs: number) => () => void;
  listenForFocus: (listener: () => void) => () => void;
}

export interface AppUpdateScheduler {
  start: () => void;
  stop: () => void;
}

export const createAppUpdateScheduler = ({
  check,
  now = Date.now,
  scheduleInterval,
  listenForFocus
}: AppUpdateSchedulerOptions): AppUpdateScheduler => {
  let started = false;
  let lastCheckStartedAt = 0;
  let disposeInterval: (() => void) | null = null;
  let disposeFocus: (() => void) | null = null;

  const runCheck = () => {
    lastCheckStartedAt = now();
    void check().catch(() => undefined);
  };

  return {
    start: () => {
      if (started) return;
      started = true;
      lastCheckStartedAt = now();
      disposeInterval = scheduleInterval(runCheck, appUpdatePeriodicIntervalMs);
      disposeFocus = listenForFocus(() => {
        if (now() - lastCheckStartedAt >= appUpdateFocusMinimumAgeMs) {
          runCheck();
        }
      });
    },
    stop: () => {
      if (!started) return;
      started = false;
      disposeInterval?.();
      disposeFocus?.();
      disposeInterval = null;
      disposeFocus = null;
    }
  };
};
