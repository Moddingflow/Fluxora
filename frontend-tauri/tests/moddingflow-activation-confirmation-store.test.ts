import { describe, expect, it, vi } from 'vitest';

import {
  createModdingFlowActivationConfirmationStore,
  type ModdingFlowActivationInstanceChoice
} from '../src/renderer/features/moddingflow/moddingflow-activation-confirmation-store';
import { createModdingFlowActivationStore } from '../src/renderer/services/moddingflow-activation-coordinator';
import type {
  FluxoraModdingFlowActivation,
  FluxoraModdingFlowActivationPlanPreview,
  FluxoraModdingFlowActivationPreview
} from '../src/shared/fluxora-api';

const activation: FluxoraModdingFlowActivation = {
  v: 1,
  artifactId: '01234567-89ab-4cde-8fab-0123456789ab'
};

const availablePreview: FluxoraModdingFlowActivationPreview = {
  artifactId: activation.artifactId,
  state: 'available',
  eligible: true,
  requiresAccount: false,
  metadata: {
    mod: { id: '11111111-2222-4333-8444-555555555555', name: 'SkyUI' },
    version: { id: '22222222-3333-4444-8555-666666666666', label: '5.2 SE' },
    game: { id: 'skyrim-se', name: 'Skyrim Special Edition' },
    file: { name: 'SkyUI_5_2_SE.7z', sizeBytes: 2_734_080 }
  },
  operationId: 'op_preview_1'
};

const availablePlanPreview: FluxoraModdingFlowActivationPlanPreview = {
  artifactId: activation.artifactId,
  planId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  requiredDownloadCount: 2,
  optionalDownloadCount: 1,
  requiredDiskSizeBytes: 2_735_104,
  conflictCount: 0,
  operationId: 'op_plan_preview'
};

describe('ModdingFlow activation confirmation store', () => {
  it('publishes stable loading and safe unavailable snapshots to a React host', async () => {
    const api = {
      preview: vi.fn().mockResolvedValue({
        ...availablePreview,
        artifactId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
      }),
      previewPlan: vi.fn(),
      accept: vi.fn(),
      dismiss: vi.fn()
    };
    const store = createModdingFlowActivationConfirmationStore({
      activation,
      api,
      instances: [],
      onRemoved: vi.fn()
    });
    const observed: string[] = [];
    const unsubscribe = store.subscribe(() => observed.push(store.snapshot().state));

    await store.ensurePreview('op_preview_identity_mismatch');
    unsubscribe();

    expect(observed).toEqual(['loading', 'unavailable']);
    expect(store.snapshot()).toMatchObject({
      state: 'unavailable',
      preview: null,
      canAccept: false,
      errorMessage: null
    });
  });

  it('deduplicates an effect-restarted preview and never starts a transfer', async () => {
    let resolvePreview!: (preview: FluxoraModdingFlowActivationPreview) => void;
    const previewPromise = new Promise<FluxoraModdingFlowActivationPreview>((resolve) => {
      resolvePreview = resolve;
    });
    const api = {
      preview: vi.fn(() => previewPromise),
      previewPlan: vi.fn(),
      accept: vi.fn(),
      dismiss: vi.fn(),
      startTransfer: vi.fn(),
      enqueueDownload: vi.fn()
    };
    const store = createModdingFlowActivationConfirmationStore({
      activation,
      api,
      instances: [],
      onRemoved: vi.fn()
    });

    const firstEffect = store.ensurePreview('op_preview_1');
    const restartedEffect = store.ensurePreview('op_preview_2');

    expect(store.snapshot().state).toBe('loading');
    expect(api.preview).toHaveBeenCalledOnce();
    expect(api.preview).toHaveBeenCalledWith({
      artifactId: activation.artifactId,
      operationId: 'op_preview_1'
    });
    resolvePreview(availablePreview);
    await Promise.all([firstEffect, restartedEffect]);

    expect(store.snapshot().state).toBe('available');
    expect(store.snapshot().preview).toEqual(availablePreview);
    expect(api.startTransfer).not.toHaveBeenCalled();
    expect(api.enqueueDownload).not.toHaveBeenCalled();
  });

  it('allows a fresh metadata preview after account authorization completes', async () => {
    const disconnectedPreview: FluxoraModdingFlowActivationPreview = {
      artifactId: activation.artifactId,
      state: 'disconnected',
      eligible: null,
      requiresAccount: true,
      metadata: null,
      operationId: 'op_preview_anonymous'
    };
    const authenticatedPreview = {
      ...availablePreview,
      requiresAccount: true,
      operationId: 'op_preview_after_connect'
    };
    const api = {
      preview: vi.fn()
        .mockResolvedValueOnce(disconnectedPreview)
        .mockResolvedValueOnce(authenticatedPreview),
      previewPlan: vi.fn(),
      accept: vi.fn(),
      dismiss: vi.fn()
    };
    const store = createModdingFlowActivationConfirmationStore({
      activation,
      api,
      instances: [],
      onRemoved: vi.fn()
    });

    await store.ensurePreview('op_preview_anonymous');
    expect(store.snapshot().state).toBe('disconnected');

    await store.ensurePreview('op_preview_after_connect');

    expect(api.preview).toHaveBeenCalledTimes(2);
    expect(api.preview).toHaveBeenLastCalledWith({
      artifactId: activation.artifactId,
      operationId: 'op_preview_after_connect'
    });
    expect(store.snapshot()).toMatchObject({
      state: 'available',
      preview: authenticatedPreview
    });
  });

  it('accepts only after an explicit compatible target and safe plan confirmation', async () => {
    const onRemoved = vi.fn();
    const instances: ModdingFlowActivationInstanceChoice[] = [
      {
        instanceId: 'fallout-instance',
        instanceName: 'Fallout test lab',
        gameIds: ['fallout-4'],
        profiles: ['Default']
      },
      {
        instanceId: 'skyrim-instance',
        instanceName: 'Skyrim main',
        gameIds: ['skyrim-se-ae', 'skyrim-se'],
        profiles: ['Default', 'Testing']
      }
    ];
    const api = {
      preview: vi.fn().mockResolvedValue(availablePreview),
      previewPlan: vi.fn().mockResolvedValue(availablePlanPreview),
      accept: vi.fn().mockResolvedValue({
        artifactId: activation.artifactId,
        state: 'accepted',
        operationId: 'op_accept_fresh'
      }),
      dismiss: vi.fn()
    };
    const store = createModdingFlowActivationConfirmationStore({
      activation,
      api,
      instances,
      onRemoved
    });
    await store.ensurePreview('op_preview_1');

    expect(store.snapshot().canAccept).toBe(false);
    await expect(store.accept('op_accept_too_early')).rejects.toThrow(/compatible instance/i);
    expect(api.accept).not.toHaveBeenCalled();

    store.selectInstance('fallout-instance');
    store.selectProfile('Default');
    expect(store.snapshot().canAccept).toBe(false);
    await expect(store.accept('op_accept_wrong_game')).rejects.toThrow(/compatible instance/i);
    expect(api.accept).not.toHaveBeenCalled();

    store.selectInstance('skyrim-instance');
    expect(store.snapshot().selectedProfileName).toBe('');
    store.selectProfile('Testing');
    expect(store.snapshot().canPreviewPlan).toBe(true);
    expect(store.snapshot().canAccept).toBe(false);
    await expect(store.accept('op_accept_before_plan')).rejects.toThrow(/preview.*plan/i);
    await store.previewPlan('op_plan_preview');
    expect(api.previewPlan).toHaveBeenCalledWith({
      artifactId: activation.artifactId,
      instanceId: 'skyrim-instance',
      profileName: 'Testing',
      operationId: 'op_plan_preview'
    });
    expect(store.snapshot().planPreview).toEqual(availablePlanPreview);
    expect(store.snapshot().canPreviewPlan).toBe(false);
    expect(store.snapshot().canAccept).toBe(true);
    await expect(store.accept('op_preview_1')).rejects.toThrow(/fresh operation id/i);
    expect(api.accept).not.toHaveBeenCalled();
    await store.accept('op_accept_fresh');

    expect(api.accept).toHaveBeenCalledOnce();
    expect(api.accept).toHaveBeenCalledWith({
      artifactId: activation.artifactId,
      instanceId: 'skyrim-instance',
      profileName: 'Testing',
      confirmedPlanId: availablePlanPreview.planId,
      operationId: 'op_accept_fresh'
    });
    expect(onRemoved).toHaveBeenCalledWith(activation.artifactId);
  });

  it('dismisses only the chosen unknown activation without accepting or transferring it', async () => {
    const otherActivation: FluxoraModdingFlowActivation = {
      v: 1,
      artifactId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    };
    const pending = createModdingFlowActivationStore();
    pending.remember(activation);
    pending.remember(otherActivation);
    const api = {
      preview: vi.fn().mockResolvedValue({
        artifactId: activation.artifactId,
        state: 'unknown',
        eligible: null,
        requiresAccount: false,
        metadata: null,
        operationId: 'op_preview_unknown'
      }),
      previewPlan: vi.fn(),
      accept: vi.fn(),
      dismiss: vi.fn().mockResolvedValue({
        artifactId: activation.artifactId,
        state: 'dismissed',
        operationId: 'op_dismiss_unknown'
      }),
      startTransfer: vi.fn()
    };
    const store = createModdingFlowActivationConfirmationStore({
      activation,
      api,
      instances: [],
      onRemoved: pending.remove
    });

    await store.ensurePreview('op_preview_unknown');
    expect(store.snapshot().state).toBe('unknown');
    await store.dismiss('op_dismiss_unknown');

    expect(api.dismiss).toHaveBeenCalledWith({
      artifactId: activation.artifactId,
      operationId: 'op_dismiss_unknown'
    });
    expect(api.accept).not.toHaveBeenCalled();
    expect(api.startTransfer).not.toHaveBeenCalled();
    expect(pending.snapshot()).toEqual([otherActivation]);
  });

  it('surfaces a conflict-only aggregate and blocks accept before any mutation', async () => {
    const api = {
      preview: vi.fn().mockResolvedValue(availablePreview),
      previewPlan: vi.fn().mockResolvedValue({
        ...availablePlanPreview,
        conflictCount: 1,
        operationId: 'op_plan_conflict'
      }),
      accept: vi.fn(),
      dismiss: vi.fn()
    };
    const store = createModdingFlowActivationConfirmationStore({
      activation,
      api,
      instances: [{
        instanceId: 'skyrim-instance',
        instanceName: 'Skyrim main',
        gameIds: ['skyrim-se'],
        profiles: ['Testing']
      }],
      onRemoved: vi.fn()
    });

    await store.ensurePreview('op_preview_1');
    store.selectInstance('skyrim-instance');
    store.selectProfile('Testing');
    await store.previewPlan('op_plan_conflict');

    expect(store.snapshot()).toMatchObject({
      canAccept: false,
      canPreviewPlan: true,
      planPreview: { conflictCount: 1 }
    });
    await expect(store.accept('op_accept_conflict')).rejects.toThrow(/conflict/i);
    expect(api.accept).not.toHaveBeenCalled();
  });
});
