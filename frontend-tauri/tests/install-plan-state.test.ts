import { describe, expect, it } from 'vitest';

import { attachBackgroundInstallPlan } from '../src/renderer/features/install/install-plan-state';
import type { FluxoraInstallPlan } from '../src/shared/fluxora-api';

describe('background install plan state', () => {
  it('attaches a late plan without resetting FOMOD progress or a user-entered name', () => {
    const current = {
      phase: 'fomod' as const,
      selectedFomodOptionIds: ['option-a', 'option-b'],
      fomodStepIndex: 2,
      activeFomodOptionId: 'option-b',
      modName: 'My Embers setup',
      modNameSource: 'user' as const,
      installerKind: 'fomod' as const,
      installPlan: null
    };
    const plan = {
      suggestedModName: 'Embers XD',
      matchedTarget: null,
      resolutionId: 'resolution-embers'
    } as unknown as FluxoraInstallPlan;

    const next = attachBackgroundInstallPlan(current, plan);

    expect(next).toMatchObject({
      phase: 'fomod',
      selectedFomodOptionIds: ['option-a', 'option-b'],
      fomodStepIndex: 2,
      activeFomodOptionId: 'option-b',
      modName: 'My Embers setup',
      modNameSource: 'user',
      installerKind: 'fomod',
      installPlan: plan
    });
  });

  it('applies an identity suggestion to an untouched standard install', () => {
    const plan = {
      suggestedModName: 'Spell Perk Item Distributor',
      matchedTarget: {
        modUuid: 'mod-spid',
        displayName: 'Spell Perk Item Distributor',
        folderName: 'Spell Perk Item Distributor'
      }
    } as unknown as FluxoraInstallPlan;

    expect(
      attachBackgroundInstallPlan(
        {
          installerKind: 'standard' as const,
          modName: 'SPID-7.3.1',
          modNameSource: 'source' as const,
          installPlan: null
        },
        plan
      )
    ).toMatchObject({
      modName: 'Spell Perk Item Distributor',
      modNameSource: 'identity',
      installPlan: plan
    });
  });
});
