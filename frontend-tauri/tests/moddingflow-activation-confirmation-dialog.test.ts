import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  ModdingFlowActivationConfirmationDialog,
  ModdingFlowActivationConfirmationFlow
} from '../src/renderer/features/moddingflow/ModdingFlowActivationConfirmationDialog';
import type { ModdingFlowActivationConfirmationSnapshot } from '../src/renderer/features/moddingflow/moddingflow-activation-confirmation-store';

const loading: ModdingFlowActivationConfirmationSnapshot = {
  state: 'loading',
  preview: null,
  planPreview: null,
  selectedInstanceId: '',
  selectedProfileName: '',
  canPreviewPlan: false,
  canAccept: false,
  busyAction: null,
  errorMessage: null
};

describe('ModdingFlow activation confirmation dialog', () => {
  it('renders the host inertly before mount without preview, accept, dismiss, or transfer work', () => {
    const api = {
      preview: vi.fn(),
      previewPlan: vi.fn(),
      accept: vi.fn(),
      dismiss: vi.fn(),
      startTransfer: vi.fn()
    };
    const markup = renderToStaticMarkup(React.createElement(
      ModdingFlowActivationConfirmationFlow,
      {
        activation: {
          v: 1,
          artifactId: '01234567-89ab-4cde-8fab-0123456789ab'
        },
        api,
        connectAccount: vi.fn(),
        instances: [],
        onRemoved: vi.fn()
      }
    ));

    expect(markup).toContain('aria-busy="true"');
    expect(api.preview).not.toHaveBeenCalled();
    expect(api.accept).not.toHaveBeenCalled();
    expect(api.dismiss).not.toHaveBeenCalled();
    expect(api.startTransfer).not.toHaveBeenCalled();
  });

  it('renders a safe loading skeleton without a spoofable title or enabled confirmation', () => {
    const markup = renderToStaticMarkup(React.createElement(
      ModdingFlowActivationConfirmationDialog,
      {
        snapshot: loading,
        instances: [],
        onAccept: vi.fn(),
        onPreviewPlan: vi.fn(),
        onDismiss: vi.fn(),
        onSelectInstance: vi.fn(),
        onSelectProfile: vi.fn()
      }
    ));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('moddingflow-activation-dialog__skeleton');
    expect(markup).not.toContain('artifactId');
    expect(markup).not.toContain('Подтвердить');
  });

  it('renders fixed safe copy for every non-actionable native state', () => {
    const states = [
      ['unknown', 'Файл не найден'],
      ['deleted', 'Файл удалён'],
      ['ineligible', 'Файл недоступен для Fluxora'],
      ['disconnected', 'Подключите ModdingFlow'],
      ['unsupportedGame', 'Игра пока не поддерживается'],
      ['unavailable', 'ModdingFlow сейчас недоступен']
    ] as const;

    states.forEach(([state, expected]) => {
      const markup = renderToStaticMarkup(React.createElement(
        ModdingFlowActivationConfirmationDialog,
        {
          snapshot: {
            ...loading,
            state,
            preview: {
              artifactId: '01234567-89ab-4cde-8fab-0123456789ab',
              state,
              eligible: state === 'ineligible' ? false : null,
              requiresAccount: state === 'disconnected',
              metadata: null,
              operationId: `op_${state}`
            }
          },
          instances: [],
          onAccept: vi.fn(),
          onPreviewPlan: vi.fn(),
          onDismiss: vi.fn(),
          onSelectInstance: vi.fn(),
          onSelectProfile: vi.fn()
        }
      ));

      expect(markup).toContain(expected);
      expect(markup).toContain('Отклонить');
      expect(markup).not.toContain('Подтвердить');
      expect(markup).not.toContain('01234567-89ab');
    });
  });

  it('offers an explicit account connection action only for an account-protected artifact', () => {
    const disconnected = {
      ...loading,
      state: 'disconnected' as const,
      preview: {
        artifactId: '01234567-89ab-4cde-8fab-0123456789ab',
        state: 'disconnected' as const,
        eligible: null,
        requiresAccount: true,
        metadata: null,
        operationId: 'op_preview_disconnected'
      }
    };
    const markup = renderToStaticMarkup(React.createElement(
      ModdingFlowActivationConfirmationDialog,
      {
        snapshot: disconnected,
        instances: [],
        onAccept: vi.fn(),
        onConnectAccount: vi.fn(),
        onPreviewPlan: vi.fn(),
        onDismiss: vi.fn(),
        onSelectInstance: vi.fn(),
        onSelectProfile: vi.fn()
      }
    ));
    const busyMarkup = renderToStaticMarkup(React.createElement(
      ModdingFlowActivationConfirmationDialog,
      {
        snapshot: disconnected,
        instances: [],
        accountConnectBusy: true,
        onAccept: vi.fn(),
        onConnectAccount: vi.fn(),
        onPreviewPlan: vi.fn(),
        onDismiss: vi.fn(),
        onSelectInstance: vi.fn(),
        onSelectProfile: vi.fn()
      }
    ));

    expect(markup).toContain('Подключить ModdingFlow');
    expect(markup).not.toContain('Подключаем…');
    expect(busyMarkup).toContain('Подключаем…');
    expect(busyMarkup).toMatch(/disabled=""[^>]*>Подключаем…/);
  });

  it('requires a safe native plan preview before enabling final confirmation', () => {
    const instances = [
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
    const preview = {
      artifactId: '01234567-89ab-4cde-8fab-0123456789ab',
      state: 'available' as const,
      eligible: true,
      requiresAccount: false,
      metadata: {
        mod: { id: '11111111-2222-4333-8444-555555555555', name: 'SkyUI' },
        version: { id: '22222222-3333-4444-8555-666666666666', label: '5.2 SE' },
        game: { id: 'skyrim-se', name: 'Skyrim Special Edition' },
        file: { name: 'SkyUI_5_2_SE.7z', sizeBytes: 2_734_080 }
      },
      operationId: 'op_preview_available'
    };
    const markup = renderToStaticMarkup(React.createElement(
      ModdingFlowActivationConfirmationDialog,
      {
        snapshot: {
          ...loading,
          state: 'available',
          preview,
          selectedInstanceId: 'skyrim-instance',
          selectedProfileName: 'Testing',
          canPreviewPlan: true,
          canAccept: false
        },
        instances,
        onAccept: vi.fn(),
        onPreviewPlan: vi.fn(),
        onDismiss: vi.fn(),
        onSelectInstance: vi.fn(),
        onSelectProfile: vi.fn()
      }
    ));

    expect(markup).toContain('SkyUI');
    expect(markup).toContain('5.2 SE');
    expect(markup).toContain('Skyrim Special Edition');
    expect(markup).toContain('SkyUI_5_2_SE.7z');
    expect(markup).toContain('2.6 MB');
    expect(markup).toContain('Skyrim main');
    expect(markup).toContain('Testing');
    expect(markup).not.toContain('Fallout test lab');
    const previewStart = markup.indexOf('>Проверить план</button>');
    expect(previewStart).toBeGreaterThan(0);
    expect(markup.slice(markup.lastIndexOf('<button', previewStart), previewStart))
      .not.toContain('disabled');
    expect(markup).not.toContain('Подтвердить загрузку');

    const confirmedMarkup = renderToStaticMarkup(React.createElement(
      ModdingFlowActivationConfirmationDialog,
      {
        snapshot: {
          ...loading,
          state: 'available',
          preview,
          selectedInstanceId: 'skyrim-instance',
          selectedProfileName: 'Testing',
          planPreview: {
            artifactId: preview.artifactId,
            planId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            requiredDownloadCount: 2,
            optionalDownloadCount: 1,
            requiredDiskSizeBytes: 2_735_104,
            conflictCount: 0,
            operationId: 'op_plan_preview'
          },
          canPreviewPlan: false,
          canAccept: true
        },
        instances,
        onAccept: vi.fn(),
        onPreviewPlan: vi.fn(),
        onDismiss: vi.fn(),
        onSelectInstance: vi.fn(),
        onSelectProfile: vi.fn()
      }
    ));

    expect(confirmedMarkup).toContain('Обязательные файлы');
    expect(confirmedMarkup).toContain('<dd>2</dd>');
    expect(confirmedMarkup).toContain('Исключённые необязательные файлы');
    expect(confirmedMarkup).toContain('Подтвердить загрузку');
    expect(confirmedMarkup).not.toContain('aaaaaaaa-bbbb');

    const conflictMarkup = renderToStaticMarkup(React.createElement(
      ModdingFlowActivationConfirmationDialog,
      {
        snapshot: {
          ...loading,
          state: 'available',
          preview,
          selectedInstanceId: 'skyrim-instance',
          selectedProfileName: 'Testing',
          planPreview: {
            artifactId: preview.artifactId,
            planId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            requiredDownloadCount: 2,
            optionalDownloadCount: 1,
            requiredDiskSizeBytes: 2_735_104,
            conflictCount: 1,
            operationId: 'op_plan_conflict'
          },
          canPreviewPlan: true,
          canAccept: false
        },
        instances,
        onAccept: vi.fn(),
        onPreviewPlan: vi.fn(),
        onDismiss: vi.fn(),
        onSelectInstance: vi.fn(),
        onSelectProfile: vi.fn()
      }
    ));

    expect(conflictMarkup).toContain('role="alert"');
    expect(conflictMarkup).toContain('План содержит конфликтов: 1');
    expect(conflictMarkup).toContain('Проверить снова');
    expect(conflictMarkup).not.toContain('Подтвердить загрузку');
  });
});
