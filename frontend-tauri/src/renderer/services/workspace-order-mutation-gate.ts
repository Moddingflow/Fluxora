export type WorkspaceOrderReconciliation = (
  isCurrent: () => boolean
) => Promise<void>;

export interface WorkspaceOrderMutationGate {
  enqueue: <T>(
    mutation: (isCurrent: () => boolean) => Promise<T>,
    reconcile?: WorkspaceOrderReconciliation
  ) => Promise<T>;
  readStable: <T>(readSnapshot: () => Promise<T>) => Promise<T>;
}

export const createWorkspaceOrderMutationGate = (): WorkspaceOrderMutationGate => {
  const pendingMutations = new Set<Promise<void>>();
  let revision = 0;
  let mutationTail: Promise<unknown> = Promise.resolve();

  const settlePendingMutations = async (): Promise<void> => {
    while (pendingMutations.size > 0) {
      await Promise.all([...pendingMutations]);
    }
  };

  return {
    enqueue: <T>(
      mutation: (isCurrent: () => boolean) => Promise<T>,
      reconcile?: WorkspaceOrderReconciliation
    ): Promise<T> => {
      revision += 1;
      const mutationRevision = revision;
      const isCurrent = (): boolean => mutationRevision === revision;
      const queued = mutationTail.then(async () => {
        const result = await mutation(isCurrent);
        if (reconcile && isCurrent()) {
          await reconcile(isCurrent);
        }
        return result;
      });
      mutationTail = queued;

      let tracked!: Promise<void>;
      const complete = (): void => {
        pendingMutations.delete(tracked);
        if (pendingMutations.size === 0 && mutationTail === queued) {
          mutationTail = Promise.resolve();
        }
      };
      tracked = queued.then(complete, complete);
      pendingMutations.add(tracked);
      return queued;
    },
    readStable: async <T>(readSnapshot: () => Promise<T>): Promise<T> => {
      while (true) {
        await settlePendingMutations();
        const snapshotRevision = revision;
        const snapshot = await readSnapshot();
        if (snapshotRevision === revision && pendingMutations.size === 0) {
          return snapshot;
        }
      }
    }
  };
};
