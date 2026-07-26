import type { FluxoraInstallPlan } from '../../../shared/fluxora-api';
import {
  applyInstallNameSuggestion,
  type InstallNameState
} from './install-name-state';

interface InstallPlanState extends InstallNameState {
  installerKind: 'pending' | 'standard' | 'fomod';
  installPlan: FluxoraInstallPlan | null;
}

interface InstallPlanMatchState extends InstallNameState {
  installPlan: FluxoraInstallPlan | null;
}

type InstallPlanDisplayPhase =
  | 'detecting'
  | 'fomod'
  | 'options'
  | 'conflict'
  | 'details'
  | 'error';

const normalizedInstallIdentityName = (value: string): string =>
  value.trim().toLocaleLowerCase();

export const matchedInstallTargetForCurrentName = (
  current: InstallPlanMatchState
): FluxoraInstallPlan['matchedTarget'] => {
  const matchedTarget = current.installPlan?.matchedTarget ?? null;
  if (!matchedTarget || current.modNameSource !== 'user') {
    return matchedTarget;
  }

  const currentName = normalizedInstallIdentityName(current.modName);
  return currentName === normalizedInstallIdentityName(matchedTarget.displayName) ||
    currentName === normalizedInstallIdentityName(matchedTarget.folderName)
    ? matchedTarget
    : null;
};

export const installPlanNeedsUserNameReplan = (
  current: InstallPlanMatchState
): boolean =>
  current.modNameSource === 'user' && matchedInstallTargetForCurrentName(current) === null;

export const attachBackgroundInstallPlan = <State extends InstallPlanState>(
  current: State,
  plan: FluxoraInstallPlan
): State => {
  const withPlan = {
    ...current,
    installPlan: plan
  };
  if (current.installerKind === 'pending') {
    return withPlan;
  }

  const nameState = applyInstallNameSuggestion(
    current,
    plan.suggestedModName,
    plan.matchedTarget ? 'identity' : 'source'
  );
  return {
    ...withPlan,
    modName: nameState.modName,
    modNameSource: nameState.modNameSource
  };
};

export const attachInstallPlanForDisplay = <
  State extends InstallPlanState & { phase: InstallPlanDisplayPhase }
>(
  current: State,
  plan: FluxoraInstallPlan
): State => {
  const planned = attachBackgroundInstallPlan(current, plan);
  return planned.phase === 'detecting' && planned.installerKind === 'standard'
    ? { ...planned, phase: 'options' }
    : planned;
};
