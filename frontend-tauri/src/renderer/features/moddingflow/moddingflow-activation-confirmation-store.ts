import type {
  FluxoraModdingFlowActivation,
  FluxoraModdingFlowActivationAcceptRequest,
  FluxoraModdingFlowActivationDecisionResult,
  FluxoraModdingFlowActivationDismissRequest,
  FluxoraModdingFlowActivationPlanPreview,
  FluxoraModdingFlowActivationPlanPreviewRequest,
  FluxoraModdingFlowActivationPreview,
  FluxoraModdingFlowActivationPreviewRequest
} from '../../../shared/fluxora-api';

export type ModdingFlowActivationConfirmationState =
  | 'idle'
  | 'loading'
  | FluxoraModdingFlowActivationPreview['state'];

export interface ModdingFlowActivationConfirmationSnapshot {
  state: ModdingFlowActivationConfirmationState;
  preview: FluxoraModdingFlowActivationPreview | null;
  planPreview: FluxoraModdingFlowActivationPlanPreview | null;
  selectedInstanceId: string;
  selectedProfileName: string;
  canPreviewPlan: boolean;
  canAccept: boolean;
  busyAction: 'previewingPlan' | 'accepting' | 'dismissing' | null;
  errorMessage: string | null;
}

export interface ModdingFlowActivationInstanceChoice {
  instanceId: string;
  instanceName: string;
  gameIds: readonly string[];
  profiles: readonly string[];
}

interface ModdingFlowActivationConfirmationApi {
  preview: (
    request: FluxoraModdingFlowActivationPreviewRequest
  ) => Promise<FluxoraModdingFlowActivationPreview>;
  previewPlan: (
    request: FluxoraModdingFlowActivationPlanPreviewRequest
  ) => Promise<FluxoraModdingFlowActivationPlanPreview>;
  accept: (
    request: FluxoraModdingFlowActivationAcceptRequest
  ) => Promise<FluxoraModdingFlowActivationDecisionResult>;
  dismiss: (
    request: FluxoraModdingFlowActivationDismissRequest
  ) => Promise<FluxoraModdingFlowActivationDecisionResult>;
}

interface CreateModdingFlowActivationConfirmationStoreOptions {
  activation: FluxoraModdingFlowActivation;
  api: ModdingFlowActivationConfirmationApi;
  instances: readonly ModdingFlowActivationInstanceChoice[];
  onRemoved: (artifactId: string) => void;
}

export interface ModdingFlowActivationConfirmationStore {
  ensurePreview: (operationId: string) => Promise<void>;
  selectInstance: (instanceId: string) => void;
  selectProfile: (profileName: string) => void;
  previewPlan: (operationId: string) => Promise<FluxoraModdingFlowActivationPlanPreview>;
  accept: (operationId: string) => Promise<FluxoraModdingFlowActivationDecisionResult>;
  dismiss: (operationId: string) => Promise<FluxoraModdingFlowActivationDecisionResult>;
  snapshot: () => ModdingFlowActivationConfirmationSnapshot;
  subscribe: (listener: () => void) => () => void;
}

const validOperationId = (value: string): boolean =>
  value.length > 0
  && value.length <= 256
  && value.trim() === value
  && ![...value].some((character) => character.charCodeAt(0) < 0x20);

export const createModdingFlowActivationConfirmationStore = ({
  activation,
  api,
  instances,
  onRemoved
}: CreateModdingFlowActivationConfirmationStoreOptions): ModdingFlowActivationConfirmationStore => {
  let snapshot: ModdingFlowActivationConfirmationSnapshot = {
    state: 'idle',
    preview: null,
    planPreview: null,
    selectedInstanceId: '',
    selectedProfileName: '',
    canPreviewPlan: false,
    canAccept: false,
    busyAction: null,
    errorMessage: null
  };
  let previewRequest: Promise<void> | null = null;
  const usedOperationIds = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((listener) => listener());

  const selectedInstance = (): ModdingFlowActivationInstanceChoice | undefined =>
    instances.find((instance) => instance.instanceId === snapshot.selectedInstanceId);
  const refreshActions = (): void => {
    const instance = selectedInstance();
    const compatibleSelection = Boolean(
      snapshot.state === 'available'
      && snapshot.preview?.eligible === true
      && snapshot.preview.metadata
      && instance
      && instance.gameIds.includes(snapshot.preview.metadata.game.id)
      && snapshot.selectedProfileName
      && instance.profiles.includes(snapshot.selectedProfileName)
    );
    const planMatchesSelection = Boolean(
      snapshot.planPreview?.artifactId === activation.artifactId
    );
    snapshot = {
      ...snapshot,
      canPreviewPlan: Boolean(
        compatibleSelection
        && snapshot.busyAction === null
        && (!planMatchesSelection || (snapshot.planPreview?.conflictCount ?? 0) > 0)
      ),
      canAccept: Boolean(
        compatibleSelection
        && planMatchesSelection
        && snapshot.planPreview?.conflictCount === 0
        && snapshot.busyAction === null
      )
    };
    notify();
  };

  return {
    ensurePreview: (operationId) => {
      if (previewRequest) {
        return previewRequest;
      }
      if (!validOperationId(operationId) || usedOperationIds.has(operationId)) {
        return Promise.reject(new Error('A fresh operation id is required to preview this activation.'));
      }
      usedOperationIds.add(operationId);
      snapshot = {
        ...snapshot,
        state: 'loading',
        preview: null,
        planPreview: null,
        canPreviewPlan: false,
        canAccept: false,
        errorMessage: null
      };
      notify();
      previewRequest = api.preview({ artifactId: activation.artifactId, operationId })
        .then((preview) => {
          if (
            preview.artifactId !== activation.artifactId
            || preview.operationId !== operationId
            || (preview.state === 'available'
              && (preview.eligible !== true || preview.metadata === null))
            || (preview.state !== 'available' && preview.metadata !== null)
          ) {
            throw new Error('ModdingFlow activation preview identity did not match the request.');
          }
          snapshot = { ...snapshot, state: preview.state, preview, errorMessage: null };
          refreshActions();
        })
        .catch(() => {
          snapshot = {
            ...snapshot,
            state: 'unavailable',
            preview: null,
            canAccept: false,
            errorMessage: null
          };
          notify();
        })
        .finally(() => {
          previewRequest = null;
        });
      return previewRequest;
    },
    selectInstance: (instanceId) => {
      snapshot = {
        ...snapshot,
        selectedInstanceId: instances.some((instance) => instance.instanceId === instanceId)
          ? instanceId
          : '',
        selectedProfileName: '',
        planPreview: null,
        errorMessage: null
      };
      refreshActions();
    },
    selectProfile: (profileName) => {
      const instance = selectedInstance();
      snapshot = {
        ...snapshot,
        selectedProfileName: instance?.profiles.includes(profileName) ? profileName : '',
        planPreview: null,
        errorMessage: null
      };
      refreshActions();
    },
    previewPlan: async (operationId) => {
      if (!validOperationId(operationId) || usedOperationIds.has(operationId)) {
        throw new Error('A fresh operation id is required to preview this activation plan.');
      }
      if (!snapshot.canPreviewPlan) {
        throw new Error('Select a compatible instance and profile before previewing the plan.');
      }
      const instance = selectedInstance();
      if (!instance) {
        throw new Error('Select a compatible instance and profile before previewing the plan.');
      }
      const profileName = snapshot.selectedProfileName;
      usedOperationIds.add(operationId);
      snapshot = {
        ...snapshot,
        busyAction: 'previewingPlan',
        canPreviewPlan: false,
        canAccept: false,
        errorMessage: null
      };
      notify();
      try {
        const preview = await api.previewPlan({
          artifactId: activation.artifactId,
          instanceId: instance.instanceId,
          profileName,
          operationId
        });
        if (
          preview.artifactId !== activation.artifactId
          || preview.operationId !== operationId
          || snapshot.selectedInstanceId !== instance.instanceId
          || snapshot.selectedProfileName !== profileName
        ) {
          throw new Error('ModdingFlow activation plan preview identity did not match the request.');
        }
        snapshot = { ...snapshot, planPreview: preview, busyAction: null, errorMessage: null };
        refreshActions();
        return preview;
      } catch (error) {
        snapshot = {
          ...snapshot,
          planPreview: null,
          busyAction: null,
          errorMessage: 'preview-plan'
        };
        refreshActions();
        throw error;
      }
    },
    accept: async (operationId) => {
      if (!validOperationId(operationId) || usedOperationIds.has(operationId)) {
        throw new Error('A fresh operation id is required to accept this activation.');
      }
      const instance = selectedInstance();
      const metadata = snapshot.preview?.metadata;
      if (
        snapshot.state !== 'available'
        || snapshot.preview?.eligible !== true
        || !metadata
        || !instance
        || !instance.gameIds.includes(metadata.game.id)
        || !instance.profiles.includes(snapshot.selectedProfileName)
      ) {
        throw new Error('Select a compatible instance and profile before accepting.');
      }
      const planPreview = snapshot.planPreview;
      if (planPreview && planPreview.conflictCount > 0) {
        throw new Error('The install plan contains conflicts and cannot be accepted.');
      }
      if (!snapshot.canAccept || !planPreview) {
        throw new Error('Preview the install plan before accepting this activation.');
      }
      usedOperationIds.add(operationId);
      snapshot = { ...snapshot, busyAction: 'accepting', canAccept: false, errorMessage: null };
      notify();
      try {
        const result = await api.accept({
          artifactId: activation.artifactId,
          instanceId: instance.instanceId,
          profileName: snapshot.selectedProfileName,
          confirmedPlanId: planPreview.planId,
          operationId
        });
        if (
          result.artifactId !== activation.artifactId
          || result.state !== 'accepted'
          || result.operationId !== operationId
        ) {
          throw new Error('ModdingFlow activation confirmation response was invalid.');
        }
        onRemoved(activation.artifactId);
        return result;
      } catch (error) {
        snapshot = {
          ...snapshot,
          planPreview: null,
          busyAction: null,
          errorMessage: 'action-accept'
        };
        refreshActions();
        throw error;
      }
    },
    dismiss: async (operationId) => {
      if (
        !validOperationId(operationId)
        || usedOperationIds.has(operationId)
        || snapshot.busyAction !== null
      ) {
        throw new Error('A fresh operation id is required to dismiss this activation.');
      }
      usedOperationIds.add(operationId);
      snapshot = { ...snapshot, busyAction: 'dismissing', canAccept: false, errorMessage: null };
      notify();
      try {
        const result = await api.dismiss({
          artifactId: activation.artifactId,
          operationId
        });
        if (
          result.artifactId !== activation.artifactId
          || result.state !== 'dismissed'
          || result.operationId !== operationId
        ) {
          throw new Error('ModdingFlow activation dismissal response was invalid.');
        }
        onRemoved(activation.artifactId);
        return result;
      } catch (error) {
        snapshot = {
          ...snapshot,
          busyAction: null,
          errorMessage: 'action-dismiss'
        };
        refreshActions();
        throw error;
      }
    },
    snapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
};
