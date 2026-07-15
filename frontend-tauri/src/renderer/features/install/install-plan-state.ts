import type { FluxoraInstallPlan } from '../../../shared/fluxora-api';
import {
  applyInstallNameSuggestion,
  type InstallNameState
} from './install-name-state';

interface InstallPlanState extends InstallNameState {
  installerKind: 'pending' | 'standard' | 'fomod';
  installPlan: FluxoraInstallPlan | null;
}

export const attachBackgroundInstallPlan = <State extends InstallPlanState>(
  current: State,
  plan: FluxoraInstallPlan
): State => {
  const withPlan = {
    ...current,
    installPlan: plan
  };
  if (current.installerKind !== 'standard') {
    return withPlan;
  }

  const nameState = applyInstallNameSuggestion(
    current,
    plan.suggestedModName,
    plan.matchedTarget ? 'identity' : 'source'
  );
  return {
    ...withPlan,
    ...nameState
  };
};
