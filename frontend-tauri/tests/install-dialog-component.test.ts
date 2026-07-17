import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  InstallDialog,
  type InstallDialogState
} from '../src/renderer/features/install/InstallDialog';
import { evaluateFomodWizard } from '../src/renderer/install-workspace-state';
import type { FluxoraFomodInstaller } from '../src/shared/fluxora-api';

const detectingDialog = (): InstallDialogState => ({
  phase: 'detecting',
  source: {
    kind: 'archive',
    sourcePath: 'C:\\Mods\\Pending.zip',
    displayName: 'Pending',
    fileName: 'Pending.zip'
  },
  operationId: 'op_detecting',
  installerKind: 'pending',
  fomodInstaller: null,
  selectedFomodOptionIds: [],
  fomodStepIndex: 0,
  activeFomodOptionId: null,
  layoutPreview: null,
  installPlan: null,
  modName: 'Pending',
  modNameSource: 'source',
  modOrderPlacement: null,
  existingModMode: 0,
  placementOverrides: {},
  draggedSourcePath: null,
  validationMessage: null,
  errorMessage: null,
  isSubmitting: false
});

describe('InstallDialog', () => {
  it('renders installer detection as a neutral busy skeleton without install controls', () => {
    const markup = renderToStaticMarkup(
      createElement(InstallDialog, {
        archiveTreeScrollTop: 0,
        evaluation: null,
        existingModName: null,
        installDialog: detectingDialog(),
        onArchiveTreeScrollTopChange: vi.fn(),
        onClose: vi.fn(),
        onContinueFromFomod: vi.fn(),
        onMoveFomodStep: vi.fn(),
        onOpenDetails: vi.fn(),
        onPatch: vi.fn(),
        onRecalculateFomod: vi.fn(),
        onResetFomod: vi.fn(),
        onResolveExistingMod: vi.fn(),
        onSubmitInstallOptions: vi.fn()
      })
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('install-detecting-skeleton');
    expect(markup).not.toContain('Mod name');
    expect(markup).not.toContain('Подробнее');
    expect(markup).not.toContain('Установить');
  });

  it('renders explainable Smart Select status, actions and accessible option labels', () => {
    const installer: FluxoraFomodInstaller = {
      isFomod: true,
      moduleName: 'Smart patches',
      moduleVersion: '1.0',
      moduleId: 'smart-patches',
      moduleImagePath: '',
      memoryKey: 'smart-patches',
      hasPreviousSelection: false,
      previousSelectedOptionIds: [],
      fileDependencies: [],
      requiredFiles: [],
      conditionalFilePatterns: [],
      profileContext: {
        contextId: 'context-1',
        profileName: 'Default',
        fingerprint: 'profile-1',
        modCatalogRevision: 4,
        modRevision: 'mods-4',
        pluginRevision: 'plugins-7',
        autoSelectionAvailable: true,
        unavailableReason: '',
        gameVersion: {
          kind: 'game',
          displayName: 'Skyrim Special Edition',
          version: '1.6.1170.0',
          known: true
        },
        extenderVersions: [],
        basePluginNames: ['Skyrim.esm'],
        fileStates: []
      },
      autoSelection: {
        contextId: 'context-1',
        initialSelectedOptionIds: ['compatible-patch'],
        unresolvedGroups: [
          {
            stepId: 'main',
            groupId: 'choices',
            groupName: 'Choices',
            reasonCode: 'group.ambiguous',
            optionIds: ['personal-style']
          }
        ],
        decisions: [
          {
            optionId: 'compatible-patch',
            action: 'select',
            confidence: 'exact',
            effectiveType: 'Recommended',
            reasonCodes: ['tes4.masters.satisfied'],
            evidence: [
              {
                code: 'tes4.master.active',
                subject: 'Lux.esp',
                expected: 'Active',
                actual: 'Active',
                sourceKind: 'mod',
                sourceName: 'Lux'
              }
            ]
          },
          {
            optionId: 'free-crops',
            action: 'deselect',
            confidence: 'strong',
            effectiveType: 'Optional',
            reasonCodes: ['author.optional'],
            evidence: [
              {
                code: 'tes4.master.active',
                subject: 'Unofficial Skyrim Special Edition Patch.esp',
                expected: 'Active',
                actual: 'Active',
                sourceKind: 'mod',
                sourceName: 'Unofficial Skyrim Special Edition Patch'
              }
            ]
          },
          {
            optionId: 'personal-style',
            action: 'manual',
            confidence: 'none',
            effectiveType: 'CouldBeUsable',
            reasonCodes: ['group.ambiguous'],
            evidence: []
          }
        ],
        moduleDependencyResult: 'satisfied',
        installBlocked: false,
        cycleDetected: false,
        warnings: []
      },
      steps: [
        {
          id: 'main',
          name: 'Main',
          visible: null,
          groups: [
            {
              id: 'choices',
              name: 'Choices',
              type: 'SelectAny',
              options: [
                {
                  id: 'compatible-patch',
                  name: 'Compatible patch',
                  description: 'Patch for Lux',
                  imagePath: '',
                  type: 'Recommended',
                  defaultType: 'Recommended',
                  flags: [],
                  typePatterns: []
                },
                {
                  id: 'personal-style',
                  name: 'Personal style',
                  description: 'Choose manually',
                  imagePath: '',
                  type: 'CouldBeUsable',
                  defaultType: 'CouldBeUsable',
                  flags: [],
                  typePatterns: []
                },
                {
                  id: 'free-crops',
                  name: 'Free Crops',
                  description: 'Keep crops owned by their farmers',
                  imagePath: '',
                  type: 'Optional',
                  defaultType: 'Optional',
                  flags: [],
                  typePatterns: []
                }
              ]
            }
          ]
        }
      ]
    };
    const state: InstallDialogState = {
      ...detectingDialog(),
      phase: 'fomod',
      installerKind: 'fomod',
      fomodInstaller: installer,
      selectedFomodOptionIds: ['compatible-patch'],
      manualFomodDecisions: [],
      activeFomodOptionId: 'compatible-patch'
    };
    const markup = renderToStaticMarkup(
      createElement(InstallDialog, {
        archiveTreeScrollTop: 0,
        evaluation: evaluateFomodWizard(installer, state.selectedFomodOptionIds),
        existingModName: null,
        installDialog: state,
        onArchiveTreeScrollTopChange: vi.fn(),
        onClose: vi.fn(),
        onContinueFromFomod: vi.fn(),
        onMoveFomodStep: vi.fn(),
        onOpenDetails: vi.fn(),
        onPatch: vi.fn(),
        onRecalculateFomod: vi.fn(),
        onResetFomod: vi.fn(),
        onResolveExistingMod: vi.fn(),
        onSubmitInstallOptions: vi.fn()
      })
    );

    expect(markup).toContain('Автовыбор · 1 выбрано · 1 требует решения');
    expect(markup).toContain('Пересчитать');
    expect(markup).toContain('Вернуть автоподбор');
    expect(markup).toContain('Выбрано автоматически');
    expect(markup).toContain('Нужен выбор');
    expect(markup).toContain('Почему выбрано');
    expect(markup).toContain('Master Lux.esp активен (Lux).');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-describedby=');

    const optionalMarkup = renderToStaticMarkup(
      createElement(InstallDialog, {
        archiveTreeScrollTop: 0,
        evaluation: evaluateFomodWizard(installer, state.selectedFomodOptionIds),
        existingModName: null,
        installDialog: { ...state, activeFomodOptionId: 'free-crops' },
        onArchiveTreeScrollTopChange: vi.fn(),
        onClose: vi.fn(),
        onContinueFromFomod: vi.fn(),
        onMoveFomodStep: vi.fn(),
        onOpenDetails: vi.fn(),
        onPatch: vi.fn(),
        onRecalculateFomod: vi.fn(),
        onResetFomod: vi.fn(),
        onResolveExistingMod: vi.fn(),
        onSubmitInstallOptions: vi.fn()
      })
    );

    expect(optionalMarkup).toContain('Почему не выбрано');
    expect(optionalMarkup).toContain('Автор FOMOD оставил вариант необязательным.');
    expect(optionalMarkup).toContain(
      'Master Unofficial Skyrim Special Edition Patch.esp активен (Unofficial Skyrim Special Edition Patch).'
    );
  });

  it('renders one check inside a selected checkbox and keeps the radio dot separate', () => {
    const installer: FluxoraFomodInstaller = {
      isFomod: true,
      moduleName: 'Checkbox FOMOD',
      moduleVersion: '1.0',
      moduleId: 'checkbox-fomod',
      moduleImagePath: '',
      memoryKey: 'checkbox-fomod',
      hasPreviousSelection: false,
      previousSelectedOptionIds: [],
      fileDependencies: [],
      requiredFiles: [],
      conditionalFilePatterns: [],
      steps: [
        {
          id: 'choices',
          name: 'Choices',
          visible: null,
          groups: [
            {
              id: 'patches',
              name: 'Patches',
              type: 'SelectAny',
              options: [
                {
                  id: 'lux-patch',
                  name: 'Lux patch',
                  description: '',
                  imagePath: '',
                  type: 'Optional',
                  defaultType: 'Optional',
                  flags: [],
                  typePatterns: []
                }
              ]
            },
            {
              id: 'preset',
              name: 'Preset',
              type: 'SelectExactlyOne',
              options: [
                {
                  id: 'full-preset',
                  name: 'Full preset',
                  description: '',
                  imagePath: '',
                  type: 'Recommended',
                  defaultType: 'Recommended',
                  flags: [],
                  typePatterns: []
                }
              ]
            }
          ]
        }
      ]
    };
    const state: InstallDialogState = {
      ...detectingDialog(),
      phase: 'fomod',
      installerKind: 'fomod',
      fomodInstaller: installer,
      selectedFomodOptionIds: ['lux-patch', 'full-preset']
    };
    const markup = renderToStaticMarkup(
      createElement(InstallDialog, {
        archiveTreeScrollTop: 0,
        evaluation: evaluateFomodWizard(installer, state.selectedFomodOptionIds),
        existingModName: null,
        installDialog: state,
        onArchiveTreeScrollTopChange: vi.fn(),
        onClose: vi.fn(),
        onContinueFromFomod: vi.fn(),
        onMoveFomodStep: vi.fn(),
        onOpenDetails: vi.fn(),
        onPatch: vi.fn(),
        onRecalculateFomod: vi.fn(),
        onResetFomod: vi.fn(),
        onResolveExistingMod: vi.fn(),
        onSubmitInstallOptions: vi.fn()
      })
    );
    const checkboxLabelStart = markup.indexOf('<label class="fomod-option"');
    const checkboxLabelEnd = markup.indexOf('</label>', checkboxLabelStart);
    const checkboxLabel = markup.slice(checkboxLabelStart, checkboxLabelEnd);
    const radioLabelStart = markup.indexOf('<label class="fomod-option"', checkboxLabelEnd);
    const radioLabel = markup.slice(radioLabelStart, markup.indexOf('</label>', radioLabelStart));

    expect(checkboxLabel).toContain('fomod-option__control');
    expect(checkboxLabel.match(/lucide-check/g)).toHaveLength(1);
    expect(checkboxLabel).not.toContain('lucide-check-circle');
    expect(radioLabel).toContain('type="radio"');
    expect(radioLabel).not.toContain('lucide-check');
  });

  it('keeps repeated FOMOD groups distinct and renders one ink-colored checkbox check', () => {
    const option = (id: string, name: string) => ({
      id,
      name,
      description: '',
      imagePath: '',
      type: 'Optional',
      defaultType: 'Optional',
      flags: [],
      typePatterns: []
    });
    const installer: FluxoraFomodInstaller = {
      isFomod: true,
      moduleName: 'Repeated groups FOMOD',
      moduleVersion: '1.0',
      moduleId: 'repeated-groups',
      moduleImagePath: '',
      memoryKey: 'repeated-groups',
      hasPreviousSelection: false,
      previousSelectedOptionIds: [],
      fileDependencies: [],
      requiredFiles: [],
      conditionalFilePatterns: [],
      steps: [
        {
          id: 'repeated-step',
          name: 'Repeated groups',
          visible: null,
          groups: [
            {
              id: 'Select One',
              name: 'Select One',
              type: 'SelectExactlyOne',
              options: [option('first-radio', 'First radio choice')]
            },
            {
              id: 'Select One',
              name: 'Select One',
              type: 'SelectExactlyOne',
              options: [option('second-radio', 'Second radio choice')]
            },
            {
              id: 'optional-patches',
              name: 'Optional patches',
              type: 'SelectAny',
              options: [option('selected-checkbox', 'Selected checkbox choice')]
            }
          ]
        }
      ]
    };
    const state: InstallDialogState = {
      ...detectingDialog(),
      phase: 'fomod',
      installerKind: 'fomod',
      fomodInstaller: installer,
      selectedFomodOptionIds: ['first-radio', 'second-radio', 'selected-checkbox']
    };
    const markup = renderToStaticMarkup(
      createElement(InstallDialog, {
        archiveTreeScrollTop: 0,
        evaluation: evaluateFomodWizard(installer, state.selectedFomodOptionIds),
        existingModName: null,
        installDialog: state,
        onArchiveTreeScrollTopChange: vi.fn(),
        onClose: vi.fn(),
        onContinueFromFomod: vi.fn(),
        onMoveFomodStep: vi.fn(),
        onOpenDetails: vi.fn(),
        onPatch: vi.fn(),
        onRecalculateFomod: vi.fn(),
        onResetFomod: vi.fn(),
        onResolveExistingMod: vi.fn(),
        onSubmitInstallOptions: vi.fn()
      })
    );
    const radioNames = [...markup.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(
      ([input]) => input.match(/name="([^"]+)"/)?.[1] ?? ''
    );
    const checkboxControl =
      markup.match(
        /<span class="fomod-option__control"><input[^>]*type="checkbox"[^>]*>.*?<\/span>/s
      )?.[0] ?? '';
    const styles = readFileSync(
      new URL('../src/renderer/styles.css', import.meta.url),
      'utf8'
    );

    expect(markup.match(/<section class="fomod-group"/g)).toHaveLength(3);
    expect(markup).toContain('First radio choice');
    expect(markup).toContain('Second radio choice');
    expect(markup).toContain('Selected checkbox choice');
    expect(radioNames).toEqual(['fomod-step-0-group-0', 'fomod-step-0-group-1']);
    expect(checkboxControl.match(/lucide-check/g)).toHaveLength(1);
    expect(styles).toMatch(
      /\.fomod-option__control > svg\s*\{[^}]*color:\s*var\(--flx-ink-on-accent\);/s
    );
    expect(styles).toMatch(
      /\.fomod-option input\[type="checkbox"\]\s*\{[^}]*border-radius:\s*4px;/s
    );
    expect(styles).toMatch(
      /\.fomod-option input\[type="checkbox"\]:checked\s*\{[^}]*border-color:\s*rgba\(var\(--flx-accent-rgb\), 0\.8\);[^}]*background:\s*var\(--accent\);/s
    );
  });
});
