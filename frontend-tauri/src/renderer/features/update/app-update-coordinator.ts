import type { FluxoraApi, FluxoraUpdateStatus } from '../../../shared/fluxora-api';
import type { AppUpdateSettingsViewState, AppUpdateToolbarViewState } from './app-update-state';

export interface AppUpdateCoordinatorOptions {
  api: FluxoraApi['updates'];
  createOperationId: (kind: string) => string;
  onStatus: (status: FluxoraUpdateStatus, userInitiated: boolean) => void;
}

export interface AppUpdateCoordinator {
    start: () => Promise<void>;
    check: (userInitiated?: boolean) => Promise<void>;
    activate: () => Promise<void>;
    cancel: () => Promise<void>;
    stop: () => void;
}

const rendererReadyRetryDelaysMs = [0, 250, 500, 1_000, 2_000] as const;
const rendererReadyNativeAttemptTimeoutMs = 2_000;
const rendererReadyDeadlineMs = 20_000;
export const rendererReadyWorstCaseBudgetMs = rendererReadyRetryDelaysMs.reduce<number>(
  (total, delayMs) => total + delayMs + rendererReadyNativeAttemptTimeoutMs,
  0
);

export interface RendererReadyRetryOptions {
  delaysMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
  isCancelled?: () => boolean;
  deadlineMs?: number;
  now?: () => number;
}

export const acknowledgeRendererReady = async (
  api: Pick<FluxoraApi['updates'], 'rendererReady'>,
  options: RendererReadyRetryOptions = {}
): Promise<boolean> => {
  const delays = options.delaysMs ?? rendererReadyRetryDelaysMs;
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  }));
  const deadlineMs = options.deadlineMs ?? rendererReadyDeadlineMs;
  const now = options.now ?? Date.now;
  const startedAt = now();
  for (const delayMs of delays) {
    if (options.isCancelled?.()) return false;
    if (now() - startedAt + delayMs >= deadlineMs) return false;
    if (delayMs > 0) await sleep(delayMs);
    if (options.isCancelled?.()) return false;
    if (now() - startedAt >= deadlineMs) return false;
    try {
      await api.rendererReady();
      return !options.isCancelled?.();
    } catch {
      // The updater health window is bounded; transient bridge startup and file races retry here.
    }
  }
  return false;
};

const sanitizeUpdateErrorMessage = (message: string): string =>
  message.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim().slice(0, 240)
  || 'Неизвестная ошибка обновления';

const updateErrorMessage = (error: unknown): string => sanitizeUpdateErrorMessage(
  error instanceof Error && error.message.trim() ? error.message : 'Не удалось проверить обновление'
);

export const createAppUpdateCoordinator = ({
  api,
  createOperationId,
  onStatus
}: AppUpdateCoordinatorOptions): AppUpdateCoordinator => {
  let started = false;
  let unsubscribe: (() => void) | null = null;
  let currentStatus: FluxoraUpdateStatus = { state: 'idle', currentVersion: '' };
  let downloadPromise: Promise<void> | null = null;
  let checkPromise: Promise<void> | null = null;
  let cancelPromise: Promise<void> | null = null;
  let userInitiatedOperation = false;

  const acceptStatus = (status: FluxoraUpdateStatus, userInitiated = false) => {
    if (!started) {
      return;
    }
    currentStatus = status;
    onStatus(status, userInitiated);
  };

  return {
    start: async () => {
      if (started) {
        return;
      }
      started = true;
      unsubscribe = api.onStatus((status) => acceptStatus(status, userInitiatedOperation));
      try {
        acceptStatus(await api.getStatus());
      } catch (error) {
        acceptStatus({
          ...currentStatus,
          state: 'error',
          error: {
            code: 'statusBootstrapFailed',
            message: updateErrorMessage(error),
            retryable: true
          }
        });
      }
    },
    check: (userInitiated = false) => {
      if (checkPromise) {
        return checkPromise;
      }
      if (
        !started
        || ['downloading', 'waitingForOperations', 'readyToInstall', 'launchingUpdater'].includes(
          currentStatus.state
        )
      ) {
        return Promise.resolve();
      }

      const operationId = createOperationId(
        userInitiated ? 'app_update_manual_check' : 'app_update_automatic_check'
      );
      userInitiatedOperation = userInitiated;
      let request: Promise<FluxoraUpdateStatus>;
      try {
        request = api.check({ operationId });
      } catch (error) {
        request = Promise.reject(error);
      }
      checkPromise = request
        .then((status) => {
          acceptStatus(status, userInitiated);
        })
        .catch((error) => {
          acceptStatus({
            ...currentStatus,
            state: 'error',
            operationId,
            error: {
              code: 'checkFailed',
              message: updateErrorMessage(error),
              retryable: true
            }
          }, userInitiated);
        })
        .finally(() => {
          checkPromise = null;
          userInitiatedOperation = false;
        });
      return checkPromise;
    },
    activate: () => {
      if (downloadPromise) {
        return downloadPromise;
      }
      const canActivate = currentStatus.state === 'available'
        || currentStatus.state === 'error';
      if (!started || !canActivate) {
        return Promise.resolve();
      }

      const operationId = createOperationId('app_update_download_install');
      userInitiatedOperation = true;
      let request: Promise<FluxoraUpdateStatus>;
      try {
        request = api.downloadAndInstall({ operationId });
      } catch (error) {
        request = Promise.reject(error);
      }
      downloadPromise = request
        .then((status) => {
          acceptStatus(status, true);
        })
        .catch((error) => {
          acceptStatus({
            ...currentStatus,
            state: 'error',
            operationId,
            error: {
              code: 'downloadAndInstallFailed',
              message: updateErrorMessage(error),
              retryable: true
            }
          }, true);
        })
        .finally(() => {
          downloadPromise = null;
          userInitiatedOperation = false;
        });
      return downloadPromise;
    },
    cancel: () => {
      if (cancelPromise) return cancelPromise;
      if (
        !started
        || !['downloading', 'waitingForOperations', 'readyToInstall'].includes(currentStatus.state)
      ) {
        return Promise.resolve();
      }
      const operationId = createOperationId('app_update_cancel');
      userInitiatedOperation = true;
      cancelPromise = api.cancel({ operationId })
        .then(async (result) => {
          if (!result.accepted) acceptStatus(await api.getStatus(), true);
        })
        .catch((error) => {
          acceptStatus({
            ...currentStatus,
            state: 'error',
            operationId,
            error: {
              code: 'cancelFailed',
              message: updateErrorMessage(error),
              retryable: true
            }
          }, true);
        })
        .finally(() => {
          cancelPromise = null;
          userInitiatedOperation = false;
        });
      return cancelPromise;
    },
    stop: () => {
      if (!started) {
        return;
      }
      started = false;
      unsubscribe?.();
      unsubscribe = null;
      userInitiatedOperation = false;
    }
  };
};

export const appUpdateToolbarView = (
  status: FluxoraUpdateStatus,
  userInitiated: boolean,
  onActivate: () => void | Promise<void>,
  onCancel: () => void | Promise<void> = onActivate
): AppUpdateToolbarViewState => {
  if (
    status.state === 'idle'
    || status.state === 'checking'
    || status.state === 'upToDate'
    || (status.state === 'error' && !userInitiated)
  ) {
    return { state: 'hidden' };
  }

  const version = status.availableVersion?.trim();
  if (!version) {
    return { state: 'hidden' };
  }

  if (status.state === 'available') {
    return { state: 'available', version, onActivate };
  }

  if (status.state === 'error') {
    const errorMessage = sanitizeUpdateErrorMessage(
      status.error?.message ?? 'Неизвестная ошибка обновления'
    );
    if (status.error?.retryable) return {
      state: 'error',
      version,
      errorMessage,
      retryable: true,
      onActivate
    };
    return { state: 'error', version, errorMessage, retryable: false };
  }

  if (status.state === 'downloading' || status.state === 'waitingForOperations') {
    const byteProgress = status.totalBytes && status.totalBytes > 0
      ? (status.downloadedBytes ?? 0) / status.totalBytes * 100
      : 0;
    const progressPercent = Number.isFinite(status.progressPercent)
      ? status.progressPercent ?? 0
      : byteProgress;
    return {
      state: status.state,
      version,
      progressPercent: Math.max(0, Math.min(100, progressPercent)),
      onCancel
    };
  }

  if (status.state === 'readyToInstall') {
    return { state: status.state, version, onCancel };
  }

  if (status.state === 'launchingUpdater') {
    return { state: status.state, version };
  }

  return { state: 'hidden' };
};

export const appUpdateSettingsView = (
  status: FluxoraUpdateStatus,
  onCheck: () => void | Promise<void>
): AppUpdateSettingsViewState => {
  const base = {
    currentVersion: status.currentVersion,
    onCheck
  };
  if (
    status.state === 'downloading'
    || status.state === 'waitingForOperations'
    || status.state === 'readyToInstall'
    || status.state === 'launchingUpdater'
  ) {
    return { ...base, state: 'busy', availableVersion: status.availableVersion };
  }
  if (status.state === 'available') {
    return { ...base, state: 'available', availableVersion: status.availableVersion };
  }
  if (status.state === 'checking' || status.state === 'upToDate') {
    return { ...base, state: status.state };
  }
  if (status.state === 'error') {
    return {
      ...base,
      state: 'error',
      errorMessage: sanitizeUpdateErrorMessage(
        status.error?.message ?? 'Не удалось проверить обновления'
      )
    };
  }
  return { ...base, state: 'idle' };
};
