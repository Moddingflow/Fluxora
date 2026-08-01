import type { FluxoraModdingFlowActivation } from '../../shared/fluxora-api';

interface ModdingFlowActivationApi {
  consumePending: () => Promise<FluxoraModdingFlowActivation[]>;
  onCaptured: (
    callback: (activation: FluxoraModdingFlowActivation) => void
  ) => () => void;
}

type ModdingFlowActivationStoreListener = (
  pending: FluxoraModdingFlowActivation[]
) => void;

export interface ModdingFlowActivationStore {
  remember: (activation: FluxoraModdingFlowActivation) => void;
  remove: (artifactId: string) => void;
  snapshot: () => FluxoraModdingFlowActivation[];
  subscribe: (listener: ModdingFlowActivationStoreListener) => () => void;
}

export interface ModdingFlowActivationCoordinator {
  start: () => () => void;
  snapshot: () => FluxoraModdingFlowActivation[];
}

export const createModdingFlowActivationStore = (): ModdingFlowActivationStore => {
  const pending = new Map<string, FluxoraModdingFlowActivation>();
  const listeners = new Set<ModdingFlowActivationStoreListener>();
  const snapshot = (): FluxoraModdingFlowActivation[] => [...pending.values()];
  const notify = (): void => {
    const current = snapshot();
    listeners.forEach((listener) => listener(current));
  };

  return {
    remember: (activation) => {
      const existing = pending.get(activation.artifactId);
      pending.set(activation.artifactId, activation);
      if (!existing) {
        notify();
      }
    },
    remove: (artifactId) => {
      if (pending.delete(artifactId)) {
        notify();
      }
    },
    snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};

export const moddingFlowActivationStore = createModdingFlowActivationStore();

export const createModdingFlowActivationCoordinator = (
  api: ModdingFlowActivationApi,
  store: ModdingFlowActivationStore = createModdingFlowActivationStore()
): ModdingFlowActivationCoordinator => {
  let stopCurrent: (() => void) | null = null;

  return {
    start: () => {
      stopCurrent?.();
      let stopped = false;
      const unsubscribe = api.onCaptured((activation) => {
        if (!stopped) {
          store.remember(activation);
        }
      });
      const stopThis = () => {
        if (stopped) {
          return;
        }
        stopped = true;
        unsubscribe();
      };
      stopCurrent = stopThis;
      void api.consumePending().then((activations) => {
        // The native command drains these items. Persist them even if the
        // subscribing effect was cleaned up while the command was in flight.
        activations.forEach(store.remember);
      }).catch(() => undefined);
      return () => {
        stopThis();
        if (stopCurrent === stopThis) {
          stopCurrent = null;
        }
      };
    },
    snapshot: store.snapshot
  };
};
