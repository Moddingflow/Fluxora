import type {
  FluxoraExternalConnectionSnapshot,
  OperationRequest
} from '../../shared/fluxora-api';
import { translateForLanguage } from '../../localization';

const retryDelaysMs = [2_000, 5_000, 15_000, 30_000, 60_000] as const;
const steadyRetryDelayMs = 5 * 60 * 1_000;

interface ExternalConnectionCoordinatorApi {
  listStatus: (request?: OperationRequest) => Promise<FluxoraExternalConnectionSnapshot>;
  restoreAll: (
    attempt?: number,
    request?: OperationRequest
  ) => Promise<FluxoraExternalConnectionSnapshot>;
}

export interface ExternalConnectionCoordinatorOptions {
  api: ExternalConnectionCoordinatorApi;
  createOperationId: (scope: string) => string;
  initialSnapshot?: FluxoraExternalConnectionSnapshot;
  language?: () => string;
  onSnapshot: (snapshot: FluxoraExternalConnectionSnapshot) => void;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface ExternalConnectionCoordinator {
  acceptSnapshot: (snapshot: FluxoraExternalConnectionSnapshot) => void;
  bootstrap: () => Promise<FluxoraExternalConnectionSnapshot>;
  retryNow: (reason: 'focus' | 'online' | 'visible' | 'mod_updates_auth_unavailable') =>
    Promise<FluxoraExternalConnectionSnapshot | null>;
  stop: () => void;
}

const shouldRetrySnapshot = (snapshot: FluxoraExternalConnectionSnapshot): boolean =>
  snapshot.providers.some(
    (provider) =>
      provider.state === 'restoring' ||
      (provider.retryable && provider.state === 'temporarilyUnavailable')
  );

export const createExternalConnectionCoordinator = (
  options: ExternalConnectionCoordinatorOptions
): ExternalConnectionCoordinator => {
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  let stopped = false;
  let attempt = 0;
  let lastSnapshot: FluxoraExternalConnectionSnapshot | null = options.initialSnapshot ?? null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<FluxoraExternalConnectionSnapshot> | null = null;
  let retryPending = false;

  const clearScheduledRetry = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const publish = (snapshot: FluxoraExternalConnectionSnapshot): void => {
    lastSnapshot = snapshot;
    options.onSnapshot(snapshot);
    if (!shouldRetrySnapshot(snapshot)) {
      clearScheduledRetry();
      attempt = 0;
      retryPending = false;
    }
  };

  const retryDelay = (completedAttempt: number): number =>
    retryDelaysMs[Math.max(0, completedAttempt - 1)] ?? steadyRetryDelayMs;

  const scheduleRetry = (force = false): void => {
    clearScheduledRetry();
    retryPending = force || retryPending || Boolean(lastSnapshot && shouldRetrySnapshot(lastSnapshot));
    if (stopped || !retryPending) {
      return;
    }
    timer = setTimer(() => {
      timer = null;
      void restore('scheduled').catch(() => undefined);
    }, retryDelay(attempt));
  };

  const restore = (
    reason: 'startup' | 'scheduled' | 'focus' | 'online' | 'visible' | 'mod_updates_auth_unavailable'
  ): Promise<FluxoraExternalConnectionSnapshot> => {
    if (inFlight) {
      return inFlight;
    }
    clearScheduledRetry();
    retryPending = false;
    attempt += 1;
    const currentAttempt = attempt;
    const promise = options.api.restoreAll(currentAttempt, {
      operationId: options.createOperationId(`connections_restore_${reason}`)
    }).then((snapshot) => {
      if (!stopped) {
        publish(snapshot);
        if (shouldRetrySnapshot(snapshot)) {
          scheduleRetry();
        }
      }
      return snapshot;
    }).catch((error: unknown) => {
      if (!stopped) {
        if (lastSnapshot) {
          const checkedAtUtc = new Date().toISOString();
          publish({
            ...lastSnapshot,
            providers: lastSnapshot.providers.map((provider) =>
              provider.hasStoredSession && provider.state !== 'reauthRequired'
                ? {
                    ...provider,
                    state: 'temporarilyUnavailable',
                    retryable: true,
                    requiresUserAction: false,
                    message: translateForLanguage(
                      options.language?.() ?? 'en-US',
                      'connections.restoreTimeout'
                    ),
                    checkedAtUtc
                  }
                : provider
            ),
            completedAtUtc: checkedAtUtc,
            timedOut: true
          });
        }
        retryPending = true;
        scheduleRetry(true);
      }
      throw error;
    }).finally(() => {
      if (inFlight === promise) {
        inFlight = null;
      }
    });
    inFlight = promise;
    return promise;
  };

  return {
    acceptSnapshot: (snapshot) => {
      if (!stopped) {
        publish(snapshot);
        if (shouldRetrySnapshot(snapshot) && !inFlight) {
          scheduleRetry();
        }
      }
    },
    bootstrap: async () => {
      stopped = false;
      let local: FluxoraExternalConnectionSnapshot;
      try {
        local = await options.api.listStatus({
          operationId: options.createOperationId('connections_list_startup')
        });
      } catch {
        return restore('startup');
      }
      if (!stopped) {
        publish(local);
        if (shouldRetrySnapshot(local)) {
          scheduleRetry();
        }
      }
      return local;
    },
    retryNow: (reason) => {
      if (
        stopped ||
        (!inFlight && !retryPending && (!lastSnapshot || !shouldRetrySnapshot(lastSnapshot)))
      ) {
        return Promise.resolve(null);
      }
      return restore(reason);
    },
    stop: () => {
      stopped = true;
      clearScheduledRetry();
      lastSnapshot = null;
      retryPending = false;
    }
  };
};
