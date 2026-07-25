export interface PluginWorkspaceSnapshotGate {
  enqueue: <T>(save: () => Promise<T>) => Promise<T>;
  readStable: <T>(readSnapshot: () => Promise<T>) => Promise<T>;
}

export const createPluginWorkspaceSnapshotGate = (): PluginWorkspaceSnapshotGate => {
  const pendingSaves = new Set<Promise<void>>();
  let revision = 0;
  let saveTail: Promise<unknown> = Promise.resolve();

  const settlePendingSaves = async (): Promise<void> => {
    while (pendingSaves.size > 0) {
      await Promise.all([...pendingSaves]);
    }
  };

  return {
    enqueue: <T>(save: () => Promise<T>): Promise<T> => {
      revision += 1;
      const queued = saveTail.then(save);
      saveTail = queued;

      let tracked!: Promise<void>;
      const complete = (): void => {
        pendingSaves.delete(tracked);
        if (pendingSaves.size === 0 && saveTail === queued) {
          saveTail = Promise.resolve();
        }
      };
      tracked = queued.then(complete, complete);
      pendingSaves.add(tracked);
      return queued;
    },
    readStable: async <T>(readSnapshot: () => Promise<T>): Promise<T> => {
      while (true) {
        await settlePendingSaves();
        const snapshotRevision = revision;
        const snapshot = await readSnapshot();
        if (snapshotRevision === revision && pendingSaves.size === 0) {
          return snapshot;
        }
      }
    }
  };
};
