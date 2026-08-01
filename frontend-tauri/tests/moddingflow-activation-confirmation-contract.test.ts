import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { FluxoraIpcChannels } from '../src/shared/fluxora-api';
import { createFluxoraApi, type IpcInvoker } from '../src/tauri/fluxora-api';

const ARTIFACT_ID = '01234567-89ab-4cde-8fab-0123456789ab';

describe('ModdingFlow activation confirmation facade', () => {
  it('allowlists the trusted preview DTO and strips transport, token, and account identity fields', async () => {
    const ipc: IpcInvoker = {
      invoke: vi.fn().mockResolvedValue({
        artifactId: ARTIFACT_ID,
        state: 'available',
        eligible: true,
        requiresAccount: false,
        metadata: {
          mod: { id: '11111111-2222-4333-8444-555555555555', name: 'SkyUI' },
          version: { id: '22222222-3333-4444-8555-666666666666', label: '5.2 SE' },
          game: { id: 'skyrim-special-edition', name: 'Skyrim Special Edition' },
          file: { name: 'SkyUI_5_2_SE.7z', sizeBytes: 2_734_080, signedUrl: 'https://private' },
          authorization: 'Bearer private',
          headers: { cookie: 'private' }
        },
        operationId: 'op_preview_contract',
        accessToken: 'private-access-token',
        userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
      })
    };

    const preview = await createFluxoraApi(ipc).moddingFlowActivations.preview({
      artifactId: ARTIFACT_ID,
      operationId: 'op_preview_contract'
    });

    expect(ipc.invoke).toHaveBeenCalledWith(
      FluxoraIpcChannels.moddingFlowActivationPreview,
      { artifactId: ARTIFACT_ID, operationId: 'op_preview_contract' }
    );
    expect(preview).toEqual({
      artifactId: ARTIFACT_ID,
      state: 'available',
      eligible: true,
      requiresAccount: false,
      metadata: {
        mod: { id: '11111111-2222-4333-8444-555555555555', name: 'SkyUI' },
        version: { id: '22222222-3333-4444-8555-666666666666', label: '5.2 SE' },
        game: { id: 'skyrim-special-edition', name: 'Skyrim Special Edition' },
        file: { name: 'SkyUI_5_2_SE.7z', sizeBytes: 2_734_080 }
      },
      operationId: 'op_preview_contract'
    });
    expect(JSON.stringify(preview)).not.toMatch(/url|header|token|userId|private/i);
  });

  it('exposes only a correlated aggregate install-plan summary to the renderer', async () => {
    const ipc: IpcInvoker = {
      invoke: vi.fn().mockResolvedValue({
        artifactId: ARTIFACT_ID,
        instanceId: 'C:\\FluxoraData\\Builds\\Skyrim.json',
        profileName: 'Default',
        planId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        requiredDownloadCount: 2,
        optionalDownloadCount: 1,
        requiredDiskSizeBytes: 2_735_104,
        conflictCount: 0,
        operationId: 'op_plan_contract',
        steps: [{ artifactId: 'must-not-cross', sha256: 'secret-hash' }],
        signedUrl: 'https://private.example/download',
        accessToken: 'private-access-token'
      })
    };

    const preview = await createFluxoraApi(ipc).moddingFlowActivations.previewPlan({
      artifactId: ARTIFACT_ID,
      instanceId: 'instance-skyrim-se',
      profileName: 'Default',
      operationId: 'op_plan_contract'
    });

    expect(ipc.invoke).toHaveBeenCalledWith(
      FluxoraIpcChannels.moddingFlowActivationPlanPreview,
      {
        artifactId: ARTIFACT_ID,
        instanceId: 'instance-skyrim-se',
        profileName: 'Default',
        operationId: 'op_plan_contract'
      }
    );
    expect(preview).toEqual({
      artifactId: ARTIFACT_ID,
      planId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      requiredDownloadCount: 2,
      optionalDownloadCount: 1,
      requiredDiskSizeBytes: 2_735_104,
      conflictCount: 0,
      operationId: 'op_plan_contract'
    });
    expect(JSON.stringify(preview)).not.toMatch(
      /step|sha256|url|token|private|instanceId|profileName|FluxoraData/i
    );
  });

  it('routes explicit accept and dismiss decisions with caller-supplied operation ids', async () => {
    const ipc: IpcInvoker = {
      invoke: vi.fn()
        .mockResolvedValueOnce({
          artifactId: ARTIFACT_ID,
          state: 'accepted',
          operationId: 'op_accept_contract',
          transferId: 'must-not-cross-the-facade'
        })
        .mockResolvedValueOnce({
          artifactId: ARTIFACT_ID,
          state: 'dismissed',
          operationId: 'op_dismiss_contract',
          accountId: 'must-not-cross-the-facade'
        })
    };
    const api = createFluxoraApi(ipc);

    await expect(api.moddingFlowActivations.accept({
      artifactId: ARTIFACT_ID,
      instanceId: 'instance-skyrim-se',
      profileName: 'Default',
      confirmedPlanId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      operationId: 'op_accept_contract'
    })).resolves.toEqual({
      artifactId: ARTIFACT_ID,
      state: 'accepted',
      operationId: 'op_accept_contract'
    });
    await expect(api.moddingFlowActivations.dismiss({
      artifactId: ARTIFACT_ID,
      operationId: 'op_dismiss_contract'
    })).resolves.toEqual({
      artifactId: ARTIFACT_ID,
      state: 'dismissed',
      operationId: 'op_dismiss_contract'
    });

    expect(ipc.invoke).toHaveBeenNthCalledWith(
      1,
      FluxoraIpcChannels.moddingFlowActivationAccept,
      {
        artifactId: ARTIFACT_ID,
        instanceId: 'instance-skyrim-se',
        profileName: 'Default',
        confirmedPlanId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        operationId: 'op_accept_contract'
      }
    );
    expect(ipc.invoke).toHaveBeenNthCalledWith(
      2,
      FluxoraIpcChannels.moddingFlowActivationDismiss,
      { artifactId: ARTIFACT_ID, operationId: 'op_dismiss_contract' }
    );
  });

  it('rejects a native preview correlated to a different operation', async () => {
    const ipc: IpcInvoker = {
      invoke: vi.fn().mockResolvedValue({
        artifactId: ARTIFACT_ID,
        state: 'unavailable',
        eligible: null,
        requiresAccount: false,
        metadata: null,
        operationId: 'op_different_request'
      })
    };

    await expect(createFluxoraApi(ipc).moddingFlowActivations.preview({
      artifactId: ARTIFACT_ID,
      operationId: 'op_expected_request'
    })).rejects.toThrow(/correlation/i);
  });

  it('fails closed on malformed or miscorrelated plan summaries', async () => {
    const request = {
      artifactId: ARTIFACT_ID,
      instanceId: 'instance-skyrim-se',
      profileName: 'Default',
      operationId: 'op_expected_plan'
    };
    const malformed: IpcInvoker = {
      invoke: vi.fn().mockResolvedValue({
        artifactId: ARTIFACT_ID,
        planId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        requiredDownloadCount: 0,
        optionalDownloadCount: 1,
        requiredDiskSizeBytes: 2_735_104,
        conflictCount: 0,
        operationId: request.operationId
      })
    };
    await expect(
      createFluxoraApi(malformed).moddingFlowActivations.previewPlan(request)
    ).rejects.toThrow(/invalid/i);

    const miscorrelated: IpcInvoker = {
      invoke: vi.fn().mockResolvedValue({
        artifactId: ARTIFACT_ID,
        planId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        requiredDownloadCount: 2,
        optionalDownloadCount: 1,
        requiredDiskSizeBytes: 2_735_104,
        conflictCount: 0,
        operationId: 'op_other_plan'
      })
    };
    await expect(
      createFluxoraApi(miscorrelated).moddingFlowActivations.previewPlan(request)
    ).rejects.toThrow(/correlation/i);
  });

  it('keeps the production host behind both enabled native gates', () => {
    const appSource = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
    const flowSource = readFileSync(
      new URL(
        '../src/renderer/features/moddingflow/ModdingFlowActivationConfirmationDialog.tsx',
        import.meta.url
      ),
      'utf8'
    );
    const hostSource = readFileSync(
      new URL(
        '../src/renderer/features/moddingflow/ModdingFlowActivationConfirmationHost.tsx',
        import.meta.url
      ),
      'utf8'
    );
    const rustSource = readFileSync(
      new URL('../src-tauri/src/moddingflow_activation_confirmation.rs', import.meta.url),
      'utf8'
    );
    const libSource = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

    expect(rustSource).toContain(
      'MODDINGFLOW_ACTIVATION_CONFIRMATION_ENABLED: bool = true'
    );
    expect(libSource).toMatch(
      /MODDINGFLOW_ACTIVATION_FEATURE_ENABLED\s*&&\s*MODDINGFLOW_ACTIVATION_CONFIRMATION_ENABLED/
    );
    expect(appSource).toContain('bridgeStatus?.capabilities?.features.moddingFlowActivation?.state');
    expect(hostSource).toContain("activationCapabilityState !== 'available'");
    expect(appSource).toContain('<ModdingFlowActivationConfirmationHost');
    expect(flowSource).not.toMatch(/\.downloads\b|startTransfer|enqueueDownload|signedUrl|accessToken/);
    expect(rustSource).toContain('"moddingflow.previewActivationPlan"');
    expect(rustSource).toContain('"downloads.queueModdingFlowArtifact"');
    expect(rustSource).toContain('selected_project_target');
    expect(rustSource).toContain('validate_selected_profile');
  });
});
