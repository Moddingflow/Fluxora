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
    operationId: string;
    promise: Promise<FluxoraModUpdateCheckResult>;
  } | null = null;

  const clearScheduledCheck = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const cancelInFlight = (): void => {
    const current = inFlight;
    if (!current) {
      return;
    }
    void options.api
      .cancel(current.operationId, {
        operationId: options.createOperationId('mods_check_updates_cancel')
      })
      .catch(() => undefined);
  };

  const scheduleAutomatic = (result?: FluxoraModUpdateCheckResult): void => {
    clearScheduledCheck();
    if (!activeProjectDirectory) {
      return;
    }
    const parsedNext = result?.nextEligibleAt ? Date.parse(result.nextEligibleAt) : Number.NaN;
    const delay = Number.isFinite(parsedNext)
      ? Math.max(1_000, parsedNext - now())
      : automaticFallbackDelayMs;
    timer = setTimer(() => {
      timer = null;
      void run('automatic').catch(() => undefined);
    }, delay);
  };

  const run = (
    mode: FluxoraModUpdateCheckMode,
    requestedOperationId?: string
  ): Promise<FluxoraModUpdateCheckResult> => {
    const projectDirectory = activeProjectDirectory;
    if (!projectDirectory) {
      return Promise.reject(new Error('No Fluxora build is active for update checking.'));
    }
    if (inFlight?.projectDirectory === projectDirectory) {
      return inFlight.promise;
    }

    clearScheduledCheck();
    const startedGeneration = generation;
    const operationId = requestedOperationId ?? options.createOperationId(`mods_check_updates_${mode}`);
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
    inFlight = { projectDirectory, operationId, promise };
    return promise;
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
