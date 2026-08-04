import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  InstallDialog,
  type InstallDialogState
} from '../src/renderer/features/install/InstallDialog';
import { evaluateFomodWizard } from '../src/renderer/install-workspace-state';
import type {
  FluxoraContentLayoutPreview,
  FluxoraFomodInstaller
} from '../src/shared/fluxora-api';

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
  placementEdits: { schemaVersion: 2, files: [], directories: [], excludedSourcePaths: [] },
  placementValidationPending: false,
  draggedSourcePath: null,
  validationMessage: null,
  errorMessage: null,
  isSubmitting: false
});

describe('InstallDialog', () => {
  it('mirrors the standard install dialog while installer detection is busy', () => {
    const markup = renderToStaticMarkup(
      createElement(InstallDialog, {
        archiveTreeScrollTop: 0,
        evaluation: null,
        existingModName: null,
        language: 'ru-RU',
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
    expect(markup).toContain('aria-label="Установка мода"');
    expect(markup).not.toContain('Install Pending');
    expect(markup).toContain('<strong>Установка мода</strong>');
    expect(markup).toContain('install-simple install-detecting-skeleton');
    expect(markup).toContain('install-detecting-skeleton__label');
    expect(markup).toContain('install-detecting-skeleton__input');
    expect(markup).toContain('install-dialog-actions install-dialog-actions--detecting');
    expect(markup).toContain('install-detecting-skeleton__action--details');
    expect(markup).toContain('install-detecting-skeleton__action--install');
    expect(markup.match(/class="flx-skeleton/g)).toHaveLength(4);
    expect(markup).not.toContain('Mod name');
    expect(markup).not.toContain('Подробнее');
    expect(markup).not.toContain('Установить');
  });

  it('shows a binary red incompatibility result without inventing a review status', () => {
    const layoutPreview: FluxoraContentLayoutPreview = {
      gameId: 'skyrimse',
      gameDisplayName: 'Skyrim Special Edition',
      rootFileWrapperDirectory: 'root',
      canInstall: true,
      summary: {
        supported: true,
        hasWarnings: true,
        hasBlockers: false,
        totalEntries: 1,
        plannedEntries: 1,
        gameDataEntries: 0,
        gameRootEntries: 0,
        pluginEntries: 0,
        archiveEntries: 0,
        scriptExtenderEntries: 0,
        unknownEntries: 1,
        unsafeEntries: 0
      },
      entries: [{
        sourcePath: 'Data/тестовая папка/New.txt',
        target: 'data',
        contentArea: 'data',
        targetRelativePath: 'тестовая папка/New.txt',
        classification: 'unknown',
        explanation: '',
        manualOverrideAllowed: true,
        safeManualTargets: ['data', 'gameRoot'],
        included: true
      }],
      validationFindings: [{
        severity: 'warning',
        path: '',
        classification: 'unknown',
        message: 'Fluxora could not recognize any installable game content in this archive.',
        blocksInstall: false
      }],
      explanationSummary: '',
      explanationDetails: [],
      assessment: { status: 'warning', reasonCodes: ['skyrimse.layout.warning'] }
    };
    const markup = renderToStaticMarkup(
      createElement(InstallDialog, {
        archiveTreeScrollTop: 0,
        evaluation: null,
        existingModName: null,
        language: 'ru-RU',
        installDialog: {
          ...detectingDialog(),
          phase: 'details',
          installerKind: 'standard',
          layoutPreview
        },
        onArchiveTreeScrollTopChange: vi.fn(),
        onClose: vi.fn(),
        onContinueFromFomod: vi.fn(),
        onMoveFomodStep: vi.fn(),
        onOpenDetails: vi.fn(),
        onPatch: vi.fn(),
        onPlacementEditsChange: vi.fn(),
        onRecalculateFomod: vi.fn(),
        onResetFomod: vi.fn(),
        onResolveExistingMod: vi.fn(),
        onSubmitInstallOptions: vi.fn()
      })
    );

    expect(markup).toContain('data-status="blocked"');
    expect(markup).toContain('Архив не подходит под структуру игры');
    expect(markup).not.toContain('требует внимания');
    const styles = readFileSync(
      new URL('../src/renderer/styles.css', import.meta.url),
      'utf8'
    );
    expect(styles).toMatch(
      /\.install-placement-assessment\[data-status="blocked"\]\s*\{\s*color: var\(--placement-error\);/
    );
    const installButtonStart = markup.lastIndexOf('<button class="primary-button"');
    const installButton = markup.slice(
      installButtonStart,
      markup.indexOf('</button>', installButtonStart)
    );
    expect(installButton).toContain('Установить');
    expect(installButton).not.toContain('disabled');
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
        language: 'ru-RU',
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

    expect(markup).toContain('Пересчитано · 1 выбрано · 1 требует решения');
    expect(markup).toContain('Пересчитать');
    expect(markup).toContain('Вернуть автоподбор');
    expect(markup).toContain('Выбрано автоматически');
    expect(markup).toContain('Нужен выбор');
    expect(markup).toContain('Почему выбрано');
    expect(markup).toContain('Мастер-файл Lux.esp активен (Lux).');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-describedby=');

    const optionalMarkup = renderToStaticMarkup(
      createElement(InstallDialog, {
        archiveTreeScrollTop: 0,
        evaluation: evaluateFomodWizard(installer, state.selectedFomodOptionIds),
        existingModName: null,
        language: 'ru-RU',
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
      'Мастер-файл Unofficial Skyrim Special Edition Patch.esp активен (Unofficial Skyrim Special Edition Patch).'
    );
  });

  it('reuses the compact thick checkbox visual and keeps the radio dot separate', () => {
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
        language: 'ru-RU',
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
    expect(checkboxLabel).toContain('class="flx-checkbox__native"');
    expect(checkboxLabel).toContain('class="flx-checkbox__box"');
    expect(checkboxLabel).not.toContain('lucide-check');
    expect(checkboxLabel).not.toContain('lucide-check-circle');
    expect(radioLabel).toContain('type="radio"');
    expect(radioLabel).not.toContain('flx-checkbox__box');
    expect(radioLabel).not.toContain('lucide-check');
  });

  it('keeps repeated FOMOD groups distinct and uses the shared thick checkbox check', () => {
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
        language: 'ru-RU',
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
    const primitiveStyles = readFileSync(
      new URL('../src/renderer/design-system/primitives/primitives.css', import.meta.url),
      'utf8'
    );

    expect(markup.match(/<section class="fomod-group"/g)).toHaveLength(3);
    expect(markup).toContain('First radio choice');
    expect(markup).toContain('Second radio choice');
    expect(markup).toContain('Selected checkbox choice');
    expect(radioNames).toEqual(['fomod-step-0-group-0', 'fomod-step-0-group-1']);
    expect(checkboxControl).toContain('class="flx-checkbox__native"');
    expect(checkboxControl).toContain('class="flx-checkbox__box"');
    expect(checkboxControl).not.toContain('lucide-check');
    expect(styles).toMatch(/\.fomod-option \.flx-checkbox__box\s*\{/);
    expect(styles).toMatch(
      /\.fomod-option input\[type="radio"\]:focus,[\s\S]*?box-shadow:\s*inset 0 0 0 1px var\(--focus-ring\);/
    );
    expect(primitiveStyles).toMatch(
      /\.flx-checkbox__box::after\s*\{[^}]*width:\s*10px;[^}]*height:\s*10px;[^}]*mask: url\([^}]*stroke-width='3'/s
    );
    expect(primitiveStyles).toMatch(
      /\.flx-checkbox__native:focus-visible \+ \.flx-checkbox__box\s*\{[^}]*outline:\s*none;[^}]*box-shadow:\s*inset 0 0 0 1px var\(--focus-ring\);/s
    );
  });
});
