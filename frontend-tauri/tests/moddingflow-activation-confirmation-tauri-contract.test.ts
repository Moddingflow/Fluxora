import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FluxoraModdingFlowActivationPreview,
  FluxoraModdingFlowActivationPlanPreview,
  FluxoraModdingFlowActivationPreviewRequest
} from '../src/shared/fluxora-api';
import { createTauriFluxoraApi } from '../src/tauri/fluxora-api';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn() })
}));

const ARTIFACT_ID = '01234567-89ab-4cde-8fab-0123456789ab';
const unavailablePreview: FluxoraModdingFlowActivationPreview = {
  artifactId: ARTIFACT_ID,
  state: 'unavailable',
  eligible: null,
  requiresAccount: false,
  metadata: null,
  operationId: 'op_preview_native'
};
const planPreview: FluxoraModdingFlowActivationPlanPreview = {
  artifactId: ARTIFACT_ID,
  planId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  requiredDownloadCount: 2,
  optionalDownloadCount: 1,
  requiredDiskSizeBytes: 2_735_104,
  conflictCount: 0,
  operationId: 'op_plan_native'
};

let originalWindowDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} }
  });
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

describe('ModdingFlow activation confirmation Tauri contract', () => {
  it('routes metadata preview, plan preview, accept, and dismiss only through focused native commands', async () => {
    invokeMock
      .mockResolvedValueOnce(unavailablePreview)
      .mockResolvedValueOnce(planPreview)
      .mockResolvedValueOnce({
        artifactId: ARTIFACT_ID,
        state: 'accepted',
        operationId: 'op_accept_native'
      })
      .mockResolvedValueOnce({
        artifactId: ARTIFACT_ID,
        state: 'dismissed',
        operationId: 'op_dismiss_native'
      });
    const api = createTauriFluxoraApi();

    await expect(api.moddingFlowActivations.preview({
      artifactId: ARTIFACT_ID,
      operationId: 'op_preview_native'
    })).resolves.toEqual(unavailablePreview);
    await expect(api.moddingFlowActivations.previewPlan({
      artifactId: ARTIFACT_ID,
      instanceId: 'instance-skyrim-se',
      profileName: 'Default',
      operationId: 'op_plan_native'
    })).resolves.toEqual(planPreview);
    await api.moddingFlowActivations.accept({
      artifactId: ARTIFACT_ID,
      instanceId: 'instance-skyrim-se',
      profileName: 'Default',
      confirmedPlanId: planPreview.planId,
      operationId: 'op_accept_native'
    });
    await api.moddingFlowActivations.dismiss({
      artifactId: ARTIFACT_ID,
      operationId: 'op_dismiss_native'
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fluxora_moddingflow_preview_activation', {
      request: { artifactId: ARTIFACT_ID, operationId: 'op_preview_native' }
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fluxora_moddingflow_preview_activation_plan', {
      request: {
        artifactId: ARTIFACT_ID,
        instanceId: 'instance-skyrim-se',
        profileName: 'Default',
        operationId: 'op_plan_native'
      }
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'fluxora_moddingflow_accept_activation', {
      request: {
        artifactId: ARTIFACT_ID,
        instanceId: 'instance-skyrim-se',
        profileName: 'Default',
        confirmedPlanId: planPreview.planId,
        operationId: 'op_accept_native'
      }
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'fluxora_moddingflow_dismiss_activation', {
      request: { artifactId: ARTIFACT_ID, operationId: 'op_dismiss_native' }
    });
  });

  it('rejects a missing operation id instead of creating one for a decision', async () => {
    const invalid = {
      artifactId: ARTIFACT_ID,
      operationId: ''
    } as FluxoraModdingFlowActivationPreviewRequest;

    await expect(
      createTauriFluxoraApi().moddingFlowActivations.preview(invalid)
    ).rejects.toThrow(/operation id/i);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
