import { describe, expect, it } from 'vitest';

import {
  attachBackgroundInstallPlan,
  installPlanNeedsUserNameReplan,
  matchedInstallTargetForCurrentName
} from '../src/renderer/features/install/install-plan-state';
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

  it('applies a specific archive variant from the install plan to an untouched FOMOD name', () => {
    const plan = {
      suggestedModName: 'Dragonborn UI - SkyUI Reskin - Widescreen 21x9',
      matchedTarget: null
    } as unknown as FluxoraInstallPlan;

    expect(
      attachBackgroundInstallPlan(
        {
          installerKind: 'fomod' as const,
          modName: 'Dragonborn UI - SkyUI Reskin',
          modNameSource: 'fomod' as const,
          installPlan: null
        },
        plan
      )
    ).toMatchObject({
      modName: 'Dragonborn UI - SkyUI Reskin - Widescreen 21x9',
      modNameSource: 'source',
      installPlan: plan
    });
  });

  it('keeps a newly replanned identity target for a user-named standard install', () => {
    const oldPlan = {
      suggestedModName: 'Spell Perks Item Distributor',
      matchedTarget: {
        modUuid: 'mod-spid',
        displayName: 'Spell Perks Item Distributor',
        folderName: 'Spell Perks Item Distributor'
      }
    } as unknown as FluxoraInstallPlan;
    const replanned = {
      suggestedModName: 'SkyUI',
      matchedTarget: {
        modUuid: 'mod-skyui',
        displayName: 'SkyUI',
        folderName: 'SkyUI'
      }
    } as unknown as FluxoraInstallPlan;

    const next = attachBackgroundInstallPlan(
      {
        installerKind: 'standard' as const,
        modName: 'SkyUI',
        modNameSource: 'user' as const,
        installPlan: oldPlan
      },
      replanned
    );

    expect(next.modName).toBe('SkyUI');
    expect(next.modNameSource).toBe('user');
    expect(next.installPlan).toBe(replanned);
  });

  it('ignores a stale identity match after the user gives the addon a distinct name', () => {
    const matchedTarget = {
      modUuid: 'imperial-forts-remake-pbr',
      displayName: 'Imperial Forts Remake PBR',
      folderName: 'Imperial Forts Remake PBR'
    };

    expect(
      matchedInstallTargetForCurrentName({
        modName: 'Imperial Forts Remake PBR Lod Helper',
        modNameSource: 'user',
        installPlan: {
          matchedTarget
        } as unknown as FluxoraInstallPlan
      })
    ).toBeNull();
  });

  it('replans a user-edited name when the background plan targets a different installed mod', () => {
    const russianTarget = {
      modUuid: 'installed-usmp-ru',
      displayName: 'Unofficial Skyrim Modders Patch RU',
      folderName: 'Unofficial Skyrim Modders Patch RU'
    };
    const originalTarget = {
      modUuid: 'installed-usmp',
      displayName: 'Unofficial Skyrim Modders Patch',
      folderName: 'Unofficial Skyrim Modders Patch'
    };
    const currentName = 'Unofficial Skyrim Modders Patch';

    expect(
      installPlanNeedsUserNameReplan({
        modName: currentName,
        modNameSource: 'user',
        installPlan: { matchedTarget: russianTarget } as FluxoraInstallPlan
      })
    ).toBe(true);
    expect(
      installPlanNeedsUserNameReplan({
        modName: currentName,
        modNameSource: 'user',
        installPlan: { matchedTarget: originalTarget } as FluxoraInstallPlan
      })
    ).toBe(false);
  });
});
