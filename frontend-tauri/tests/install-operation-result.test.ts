import { describe, expect, it } from 'vitest';

import {
  installedSummaryFromOperation,
  restoredInstallNeedsPendingProjection
} from '../src/renderer/features/mods/use-pending-install-orchestrator';
import type { FluxoraInstallOperation } from '../src/shared/fluxora-api';

describe('install operation result', () => {
  it('applies the complete durable source and conflict identity to the installed row', () => {
    const operation: FluxoraInstallOperation = {
      operationId: 'install-op',
      sourceKind: 'download',
      sourcePath: 'C:\\Downloads\\nexus.zip',
      archiveFingerprint: 'sha256:fixture',
      profileName: 'Default',
      existingModMode: 0,
      targetModUuid: '',
      targetFolder: 'Nexus Fixture',
      selectedOptionIds: [],
      manualDecisions: [],
      placementOverridesJson: '[]',
      resume: {},
      beforeOrderId: '',
      afterOrderId: '',
      enqueueSequence: 1,
      state: 'completed',
      stage: 'completed',
      progressPercent: 100,
      indeterminate: false,
      errorCode: '',
      errorMessage: '',
      result: {
        id: 'C:\\Build\\mods\\Nexus Fixture',
        name: 'Nexus Fixture',
        version: '2.4.0',
        isEnabled: true,
        latestVersion: '2.5.0',
        latestFileId: '987',
        updateCheckState: 'update_available',
        sourceIsNexus: true,
        sourceIsModdingFlow: false,
        sourceProvider: 'nexus',
        sourceGameDomain: 'skyrimspecialedition',
        sourceModId: '123',
        sourceFileId: '456',
        sourceUrl: 'nxm://skyrimspecialedition/mods/123/files/456',
        isLocal: false,
        isTranslation: true,
        isPatch: false,
        modUuid: 'uuid-nexus',
        orderId: 'order-nexus',
        fileCount: 9,
        conflictingFileCount: 4,
        overwrittenFileCount: 2,
        overwritingFileCount: 3,
        overwritesModIds: ['uuid-old'],
        overwrittenByModIds: ['uuid-new']
      }
    };

    expect(installedSummaryFromOperation(operation)).toMatchObject({
      operationId: 'install-op',
      latestVersion: '2.5.0',
      latestFileId: '987',
      updateCheckState: 'update_available',
      sourceIsNexus: true,
      sourceProvider: 'nexus',
      sourceGameDomain: 'skyrimspecialedition',
      sourceModId: '123',
      sourceFileId: '456',
      isLocal: false,
      isTranslation: true,
      overwritesModIds: ['uuid-old'],
      overwrittenByModIds: ['uuid-new']
    });
  });

  it('never creates a pending row for a terminal operation returned by recovery', () => {
    const operation = {
      operationId: 'recovered-op',
      state: 'completed'
    } as FluxoraInstallOperation;

    expect(restoredInstallNeedsPendingProjection(operation)).toBe(false);
    expect(restoredInstallNeedsPendingProjection({ ...operation, state: 'failed' })).toBe(false);
    expect(restoredInstallNeedsPendingProjection({ ...operation, state: 'cancelled' })).toBe(false);
    expect(restoredInstallNeedsPendingProjection({ ...operation, state: 'needsReview' })).toBe(true);
    expect(restoredInstallNeedsPendingProjection({ ...operation, state: 'recovering' })).toBe(true);
  });
});
