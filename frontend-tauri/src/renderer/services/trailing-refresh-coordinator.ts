export type RefreshTask = () => Promise<void>;

export interface TrailingRefreshCoordinator {
  isRunning: () => boolean;
  resume: () => void;
  schedule: (task: RefreshTask) => Promise<void>;
  stop: () => void;
}

export interface PendingPathDrainResult {
  failedScopes: string[];
}

export interface PendingPathAccumulator {
  add: (scope: string, paths: readonly string[], revision?: number) => void;
  drain: (scope: string) => string[];
  drainAll: () => Array<{ scope: string; paths: string[]; revision: number }>;
  clear: (scope: string) => void;
}

export interface ScopedSequenceTracker {
  record: (scope: string, sequence: number) => boolean;
  clear: (scope: string) => void;
}

export const createPendingPathAccumulator = (): PendingPathAccumulator => {
  const pendingByScope = new Map<
    string,
    { scope: string; paths: Map<string, string>; revision: number }
  >();
  const keyFor = (value: string) => value.replaceAll('/', '\\').toLocaleLowerCase('en-US');

  return {
    add: (scope, paths, revision = 0) => {
      const scopeKey = keyFor(scope);
      const pending = pendingByScope.get(scopeKey) ?? {
        scope,
        paths: new Map<string, string>(),
        revision
      };
      pendingByScope.set(scopeKey, pending);
      pending.revision = Math.max(pending.revision, revision);
      for (const path of paths) {
        if (path.length > 0) {
          const key = keyFor(path);
          if (!pending.paths.has(key)) {
            pending.paths.set(key, path);
          }
        }
      }
    },
    drain: (scope) => {
      const scopeKey = keyFor(scope);
      const pending = pendingByScope.get(scopeKey);
      if (!pending) {
        return [];
      }
      const paths = [...pending.paths.values()];
      pendingByScope.delete(scopeKey);
      return paths;
    },
    drainAll: () => {
      const batches = [...pendingByScope.values()].map((pending) => ({
        scope: pending.scope,
        paths: [...pending.paths.values()],
        revision: pending.revision
      }));
      pendingByScope.clear();
      return batches;
    },
    clear: (scope) => pendingByScope.delete(keyFor(scope))
  };
};

export const drainPendingPathsWithRetry = async (
  pendingPaths: PendingPathAccumulator,
  consume: (batch: { scope: string; paths: string[]; revision: number }) => Promise<void>,
  maximumAttempts = 3,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
): Promise<PendingPathDrainResult> => {
  const attempts = Math.max(1, maximumAttempts);
  const failedScopes: string[] = [];
  const batches = pendingPaths.drainAll();

  for (const batch of batches) {
    let completed = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await consume(batch);
        completed = true;
        break;
      } catch {
        if (attempt + 1 < attempts) {
          await wait(100 * 2 ** attempt);
        }
      }
    }
    if (!completed) {
      // A permanently failing stale scope must not prevent later project
      // scopes from being invalidated. Keep only this scope pending for the
      // coordinator's bounded-backoff autonomous retry.
      pendingPaths.add(batch.scope, batch.paths, batch.revision);
      failedScopes.push(batch.scope);
    }
  }

  return { failedScopes };
};

export const createScopedSequenceTracker = (): ScopedSequenceTracker => {
  const latestByScope = new Map<string, number>();
  const keyFor = (value: string) => value.replaceAll('/', '\\').toLocaleLowerCase('en-US');

  return {
    record: (scope, sequence) => {
      const key = keyFor(scope);
      const previous = latestByScope.get(key);
      latestByScope.set(key, sequence);
      return previous !== undefined && sequence !== previous + 1;
    },
    clear: (scope) => latestByScope.delete(keyFor(scope))
  };
};

const normalizedWindowsPath = (value: string): string =>
  value.replaceAll('/', '\\').replace(/\\+$/u, '');

export const topLevelChangedModPaths = (
  modsDirectory: string,
  changedPaths: readonly string[],
  maximumFolders = 2048
): string[] => {
  const root = normalizedWindowsPath(modsDirectory);
  if (!root || maximumFolders < 1) {
    return [];
  }
  const prefix = `${root}\\`;
  const rootKey = root.toLocaleLowerCase('en-US');
  const prefixKey = prefix.toLocaleLowerCase('en-US');
  const folders = new Map<string, string>();

  for (const changedPath of changedPaths) {
    const normalized = normalizedWindowsPath(changedPath);
    const normalizedKey = normalized.toLocaleLowerCase('en-US');
    if (normalizedKey === rootKey) {
      return [root];
    }
    if (!normalizedKey.startsWith(prefixKey)) {
      continue;
    }
    const relative = normalized.slice(prefix.length);
    const folderName = relative.split('\\', 1)[0];
    if (!folderName) {
      return [root];
    }
    const folderPath = `${root}\\${folderName}`;
    const folderKey = folderPath.toLocaleLowerCase('en-US');
    if (!folders.has(folderKey)) {
      folders.set(folderKey, folderPath);
    }
    if (folders.size > maximumFolders) {
      return [root];
    }
  }
  return [...folders.values()];
};

export const createTrailingRefreshCoordinator = (
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
): TrailingRefreshCoordinator => {
  let pendingTask: RefreshTask | null = null;
  let running: Promise<void> | null = null;
  let stopped = false;
  let lifecycleGeneration = 0;
  let cancelActiveRetryWait: (() => void) | null = null;

  const waitForRetry = async (milliseconds: number): Promise<void> => {
    let cancel!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      cancel = resolve;
    });
    cancelActiveRetryWait = cancel;
    try {
      await Promise.race([wait(milliseconds), cancelled]);
    } finally {
      if (cancelActiveRetryWait === cancel) {
        cancelActiveRetryWait = null;
      }
    }
  };

  const drain = async (): Promise<void> => {
    let consecutiveFailures = 0;
    while (pendingTask && !stopped) {
      const task = pendingTask;
      const taskGeneration = lifecycleGeneration;
      pendingTask = null;
      try {
        await task();
        consecutiveFailures = 0;
      } catch {
        if (stopped || taskGeneration !== lifecycleGeneration) {
          // The task belonged to a renderer lifetime that has already stopped.
          // Never replay its captured project/UI closure after a remount.
          consecutiveFailures = 0;
          continue;
        }
        // A newer event takes priority and gets an immediate attempt. When the
        // latest task itself keeps failing, retry autonomously with capped
        // exponential backoff to preserve correctness without bridge/log spam.
        if (!pendingTask) {
          pendingTask = task;
          const retryDelay = Math.min(1_000 * 2 ** Math.min(consecutiveFailures, 5), 30_000);
          consecutiveFailures += 1;
          await waitForRetry(retryDelay);
        } else {
          consecutiveFailures = 0;
        }
      }
    }
  };

  const startDrain = (): Promise<void> => {
    const current = drain().finally(() => {
      if (running === current) {
        running = null;
      }
      if (pendingTask && !stopped && !running) {
        running = startDrain();
      }
    });
    return current;
  };

  return {
    isRunning: () => running !== null,
    resume: () => {
      stopped = false;
      if (pendingTask && !running) {
        running = startDrain();
      }
    },
    schedule: (task) => {
      if (stopped) {
        return Promise.resolve();
      }
      pendingTask = task;
      // A newer watcher event supersedes the failed task that is sleeping in
      // backoff. Wake the drain so the latest invalidation is attempted now.
      cancelActiveRetryWait?.();
      if (!running) {
        running = startDrain();
      }
      return running;
    },
    stop: () => {
      stopped = true;
      lifecycleGeneration += 1;
      pendingTask = null;
      cancelActiveRetryWait?.();
    }
  };
};
