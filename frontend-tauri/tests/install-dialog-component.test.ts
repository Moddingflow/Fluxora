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
