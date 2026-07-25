import type {
  FluxoraInstalledMod,
  FluxoraModOrderItem,
  FluxoraModUpdateCheckMode,
  FluxoraModUpdateCheckRequest,
  FluxoraModUpdateCheckResult,
  OperationRequest
} from '../../shared/fluxora-api';

const automaticFallbackDelayMs = 24 * 60 * 60 * 1_000;

interface ModUpdateCoordinatorApi {
  checkUpdates: (
    request: FluxoraModUpdateCheckRequest,
    operation?: OperationRequest
  ) => Promise<FluxoraModUpdateCheckResult>;
  cancel: (operationId: string, request?: OperationRequest) => Promise<unknown>;
}

export interface ModUpdateCoordinatorOptions {
  api: ModUpdateCoordinatorApi;
  createOperationId: (scope: string) => string;
  onApplied: (projectDirectory: string, result: FluxoraModUpdateCheckResult) => void;
  onAuthenticationUnavailable?: () => void;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface ModUpdateCoordinator {
  activate: (projectDirectory: string) => void;
  checkManual: (
    projectDirectory: string,
    operationId?: string
  ) => Promise<FluxoraModUpdateCheckResult>;
  stop: () => void;
}

const normalizedFolderName = (value: string): string =>
  value.trim().replaceAll('/', '\\').split('\\').at(-1)?.toLocaleLowerCase('en-US') ?? '';

export const applyModUpdateResultToInstalledMods = (
  mods: readonly FluxoraInstalledMod[],
  result: FluxoraModUpdateCheckResult
): FluxoraInstalledMod[] => {
  const updates = new Map(
    result.mods.map((mod) => [mod.folderName.trim().toLocaleLowerCase('en-US'), mod] as const)
  );
  return mods.map((mod) => {
    const update = updates.get(normalizedFolderName(mod.id)) ?? updates.get(normalizedFolderName(mod.name));
    return update
      ? {
          ...mod,
          latestVersion: update.latestVersion,
          latestFileId: update.latestFileId,
          updateCheckState: update.updateCheckState,
          hasUpdate: update.hasUpdate
        }
      : mod;
  });
};

export const applyModUpdateResultToOrderItems = (
  items: readonly FluxoraModOrderItem[],
  result: FluxoraModUpdateCheckResult
): FluxoraModOrderItem[] => {
  const updates = new Map(
    result.mods.map((mod) => [mod.folderName.trim().toLocaleLowerCase('en-US'), mod] as const)
  );
  return items.map((item) => {
    if (!item.isMod) {
      return item;
    }
    const update = updates.get(normalizedFolderName(item.id)) ?? updates.get(normalizedFolderName(item.name));
    return update
      ? {
          ...item,
          latestVersion: update.latestVersion,
          latestFileId: update.latestFileId,
          updateCheckState: update.updateCheckState,
          hasUpdate: update.hasUpdate
        }
      : item;
  });
};

export const createModUpdateCoordinator = (
  options: ModUpdateCoordinatorOptions
): ModUpdateCoordinator => {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  let activeProjectDirectory: string | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: {
    projectDirectory: string;
    mode: FluxoraModUpdateCheckMode;
    operationId: string;
    promise: Promise<FluxoraModUpdateCheckResult>;
  } | null = null;

  const clearScheduledCheck = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const requestCancellation = (
    current: NonNullable<typeof inFlight>
  ): void => {
    void options.api
      .cancel(current.operationId, {
        operationId: options.createOperationId('mods_check_updates_cancel')
      })
      .catch(() => undefined);
  };

  const cancelInFlight = (): void => {
    const current = inFlight;
    if (!current) {
      return;
    }
    requestCancellation(current);
  };

  const scheduleAutomatic = (result?: FluxoraModUpdateCheckResult): void => {
    clearScheduledCheck();
    if (!activeProjectDirectory) {
      return;
    }
    const parsedNext = result?.nextEligibleAt ? Date.parse(result.nextEligibleAt) : Number.NaN;
    const remainingDelay = parsedNext - now();
    const delay =
      Number.isFinite(parsedNext) && remainingDelay > 0
        ? remainingDelay
        : automaticFallbackDelayMs;
    timer = setTimer(() => {
      timer = null;
      void run('automatic').catch(() => undefined);
    }, delay);
  };

  const startRun = (
    mode: FluxoraModUpdateCheckMode,
    projectDirectory: string,
    startedGeneration: number,
    operationId: string
  ): Promise<FluxoraModUpdateCheckResult> => {
    clearScheduledCheck();
    const promise = options.api
      .checkUpdates(
        { projectDirectory, mode },
        { operationId }
      )
      .then((result) => {
        if (
          generation === startedGeneration &&
          activeProjectDirectory === projectDirectory &&
          result.state !== 'cancelled'
        ) {
          options.onApplied(projectDirectory, result);
          if (result.state === 'partial' && result.reason === 'authenticationUnavailable') {
            options.onAuthenticationUnavailable?.();
          }
          scheduleAutomatic(result);
        }
        return result;
      })
      .catch((error: unknown) => {
        if (generation === startedGeneration && activeProjectDirectory === projectDirectory) {
          scheduleAutomatic();
        }
        throw error;
      })
      .finally(() => {
        if (inFlight?.promise === promise) {
          inFlight = null;
        }
      });
    inFlight = { projectDirectory, mode, operationId, promise };
    return promise;
  };

  const run = (
    mode: FluxoraModUpdateCheckMode,
    requestedOperationId?: string
  ): Promise<FluxoraModUpdateCheckResult> => {
    const projectDirectory = activeProjectDirectory;
    if (!projectDirectory) {
      return Promise.reject(new Error('No Fluxora build is active for update checking.'));
    }
    const operationId =
      requestedOperationId ?? options.createOperationId(`mods_check_updates_${mode}`);
    if (inFlight?.projectDirectory === projectDirectory) {
      if (mode !== 'manual' || inFlight.mode === 'manual') {
        return inFlight.promise;
      }

      const automatic = inFlight;
      const startedGeneration = generation;
      requestCancellation(automatic);
      clearScheduledCheck();
      const queuedPromise = automatic.promise
        .catch(() => undefined)
        .then(() => {
          if (
            generation !== startedGeneration ||
            activeProjectDirectory !== projectDirectory
          ) {
            throw new Error('The active Fluxora build changed before the manual update check.');
          }
          return startRun('manual', projectDirectory, startedGeneration, operationId);
        })
        .finally(() => {
          if (inFlight?.promise === queuedPromise) {
            inFlight = null;
          }
        });
      inFlight = {
        projectDirectory,
        mode: 'manual',
        operationId,
        promise: queuedPromise
      };
      return queuedPromise;
    }

    return startRun(mode, projectDirectory, generation, operationId);
  };

  return {
    activate: (projectDirectory) => {
      const normalized = projectDirectory.trim();
      if (!normalized) {
        return;
      }
      if (activeProjectDirectory === normalized) {
        if (!inFlight && timer === null) {
          void run('automatic').catch(() => undefined);
        }
        return;
      }
      cancelInFlight();
      clearScheduledCheck();
      generation += 1;
      activeProjectDirectory = normalized;
      void run('automatic').catch(() => undefined);
    },
    checkManual: (projectDirectory, operationId) => {
      const normalized = projectDirectory.trim();
      if (activeProjectDirectory !== normalized) {
        cancelInFlight();
        clearScheduledCheck();
        generation += 1;
        activeProjectDirectory = normalized;
      }
      return run('manual', operationId);
    },
    stop: () => {
      cancelInFlight();
      clearScheduledCheck();
      generation += 1;
      activeProjectDirectory = null;
    }
  };
};
