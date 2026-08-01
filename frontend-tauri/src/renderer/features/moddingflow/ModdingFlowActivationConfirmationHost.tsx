import { useEffect, useMemo, useState } from 'react';

import type {
  FluxoraApi,
  FluxoraModdingFlowActivation,
  FluxoraProject
} from '../../../shared/fluxora-api';
import {
  createModdingFlowActivationCoordinator,
  moddingFlowActivationStore
} from '../../services/moddingflow-activation-coordinator';
import { ModdingFlowActivationConfirmationFlow } from './ModdingFlowActivationConfirmationDialog';
import type { ModdingFlowActivationInstanceChoice } from './moddingflow-activation-confirmation-store';

interface ModdingFlowActivationConfirmationHostProps {
  activationCapabilityState: string | null | undefined;
  api: FluxoraApi['moddingFlowActivations'];
  connectAccount: (
    operationId: string
  ) => Promise<Awaited<ReturnType<FluxoraApi['connections']['connect']>>>;
  isSecondaryWindow: boolean;
  projects: readonly FluxoraProject[];
  selectedProjectId: string | null;
  selectedProjectProfiles: readonly string[];
}

export const ModdingFlowActivationConfirmationHost = ({
  activationCapabilityState,
  api,
  connectAccount,
  isSecondaryWindow,
  projects,
  selectedProjectId,
  selectedProjectProfiles
}: ModdingFlowActivationConfirmationHostProps) => {
  const [pendingActivations, setPendingActivations] = useState<
    FluxoraModdingFlowActivation[]
  >([]);

  const instances = useMemo<ModdingFlowActivationInstanceChoice[]>(
    () => projects
      .filter((project) => project.id.length > 0 && project.templateId.length > 0)
      .map((project) => {
        const profiles = project.id === selectedProjectId
          ? selectedProjectProfiles
          : [project.defaultProfile || project.template?.defaultProfile || 'Default'];
        const gameIds = [
          ...(project.externalProviderGameSlugs?.moddingflow ?? []),
          ...(project.template?.externalProviderGameSlugs?.moddingflow ?? [])
        ];
        return {
          instanceId: project.id,
          instanceName: project.name,
          gameIds: [...new Set(gameIds.filter((gameId) => gameId.length > 0))],
          profiles: [...new Set(profiles.filter((profile) => profile.length > 0))]
        };
      }),
    [projects, selectedProjectId, selectedProjectProfiles]
  );

  useEffect(() => {
    if (isSecondaryWindow || activationCapabilityState !== 'available') {
      setPendingActivations([]);
      return;
    }

    setPendingActivations(moddingFlowActivationStore.snapshot());
    return moddingFlowActivationStore.subscribe(setPendingActivations);
  }, [activationCapabilityState, isSecondaryWindow]);

  useEffect(() => {
    if (isSecondaryWindow || activationCapabilityState !== 'available') {
      return;
    }

    const coordinator = createModdingFlowActivationCoordinator(
      api,
      moddingFlowActivationStore
    );
    return coordinator.start();
  }, [activationCapabilityState, api, isSecondaryWindow]);

  const activation = pendingActivations[0] ?? null;
  if (
    isSecondaryWindow
    || activationCapabilityState !== 'available'
    || activation === null
  ) {
    return null;
  }

  return (
    <ModdingFlowActivationConfirmationFlow
      activation={activation}
      api={api}
      connectAccount={connectAccount}
      instances={instances}
      onRemoved={moddingFlowActivationStore.remove}
    />
  );
};
