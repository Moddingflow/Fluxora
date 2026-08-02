import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  CREATE_BUILD_STEPS,
  CreateBuildWizard
} from '../src/renderer/features/library/CreateBuildWizard';
import type { FluxoraGameTemplate } from '../src/shared/fluxora-api';

const template: FluxoraGameTemplate = {
  id: 'skyrimse',
  displayName: 'Skyrim Special Edition',
  gameName: 'Skyrim Special Edition',
  summary: 'This description must stay out of the tile.',
  uiTemplateId: 'skyrimse',
  executableDisplayMetadata: [
    {
      id: 'game',
      displayName: 'Skyrim Special Edition',
      executableName: 'SkyrimSE.exe',
      role: 'primary',
      workingDirectoryKind: '',
      isPrimary: true,
      isLauncher: false,
      isScriptExtender: false
    }
  ]
};

const noop = () => undefined;
const acceptExecutable = async () => true;

const renderWizard = (stepIndex: number, overrides: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(CreateBuildWizard, {
      activeStepIndex: stepIndex,
      busy: false,
      draft: {
        projectName: 'Northwind',
        templateId: stepIndex > 1 ? template.id : '',
        gamePath: stepIndex > 2 ? 'C:\\Games\\Skyrim\\SkyrimSE.exe' : '',
        installRootDirectory: 'C:\\Fluxora Builds'
      },
      error: null,
      furthestStepIndex: stepIndex,
      onBack: noop,
      onBrowseExecutable: acceptExecutable,
      onBrowseInstallRoot: noop,
      onCancel: noop,
      onChangeInstallRoot: noop,
      onChangeName: noop,
      onCreate: noop,
      onNext: noop,
      onSelectStep: noop,
      onSelectTemplate: noop,
      previewBusy: false,
      previewDirectory: 'C:\\Fluxora Builds\\Northwind',
      selectedTemplate: stepIndex > 1 ? template : null,
      templates: [template],
      ...overrides
    })
  );

describe('CreateBuildWizard', () => {
  it('uses one form submit so Enter advances through the validated flow', () => {
    const markup = renderWizard(0);

    expect(markup).toContain('<form');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('Next');
    expect(markup).toContain(`Step 1 of ${CREATE_BUILD_STEPS.length}`);
  });

  it('renders game choices with only the game name and no automatic selection', () => {
    const markup = renderWizard(1, {
      draft: {
        projectName: 'Northwind',
        templateId: '',
        gamePath: '',
        installRootDirectory: 'C:\\Fluxora Builds'
      },
      selectedTemplate: null
    });

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('Skyrim Special Edition');
    expect(markup).not.toContain(template.summary);
  });

  it('makes the game executable read-only and names the required official file', () => {
    const markup = renderWizard(2);

    expect(markup).toContain('SkyrimSE.exe');
    expect(markup).toContain('readOnly=""');
    expect(markup).toContain('Choose SkyrimSE.exe');
  });
});
