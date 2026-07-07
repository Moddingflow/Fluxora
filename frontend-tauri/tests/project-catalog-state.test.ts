import { describe, expect, it } from 'vitest';

import {
  emptyProjectDraft,
  filterProjects,
  filterTemplates,
  isProjectDraftStepComplete,
  projectCapabilitiesLabel,
  projectDisplayPath
} from '../src/renderer/project-catalog-state';
import {
  mergeProjectIntoCatalog,
  projectCatalogFallback
} from '../src/renderer/services/project-catalog-service';
import type {
  FluxoraGameTemplate,
  FluxoraProject,
  FluxoraProjectCatalog
} from '../src/shared/fluxora-api';

const projects: FluxoraProject[] = [
  {
    id: 'C:\\Fluxora\\Builds\\Skyrim.json',
    name: 'Skyrim Main',
    templateId: 'skyrim-special-edition',
    uiTemplateId: 'skyrim',
    gameName: 'Skyrim Special Edition',
    gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
    installRootDirectory: 'C:\\Fluxora Projects',
    projectDirectory: 'C:\\Fluxora Projects\\Skyrim Main',
    configPath: 'C:\\Fluxora\\Builds\\Skyrim.json',
    gameCapabilities: {
      supportsPlugins: true,
      supportsLoadOrder: true,
      supportsVfsLaunch: true
    }
  },
  {
    id: 'C:\\Fluxora\\Builds\\Fallout.json',
    name: 'Fallout Test',
    templateId: 'fallout-4',
    uiTemplateId: 'fallout',
    gameName: 'Fallout 4',
    gamePath: 'C:\\Games\\Fallout4\\Fallout4.exe',
    installRootDirectory: 'C:\\Fluxora Projects',
    projectDirectory: 'C:\\Fluxora Projects\\Fallout Test',
    configPath: 'C:\\Fluxora\\Builds\\Fallout.json'
  }
];

const templates: FluxoraGameTemplate[] = [
  {
    id: 'skyrim-special-edition',
    displayName: 'Skyrim Special Edition',
    gameName: 'Skyrim Special Edition',
    summary: 'Bethesda RPG',
    uiTemplateId: 'skyrim'
  },
  {
    id: 'fallout-4',
    displayName: 'Fallout 4',
    gameName: 'Fallout 4',
    summary: 'Commonwealth RPG',
    uiTemplateId: 'fallout'
  }
];

describe('project catalog state', () => {
  it('filters projects by build, game and path terms', () => {
    expect(filterProjects(projects, 'skyrim')).toEqual([projects[0]]);
    expect(filterProjects(projects, 'fallout builds')).toEqual([projects[1]]);
    expect(filterProjects(projects, '')).toEqual(projects);
  });

  it('filters templates by display text and identifiers', () => {
    expect(filterTemplates(templates, 'commonwealth')).toEqual([templates[1]]);
    expect(filterTemplates(templates, 'skyrim special')).toEqual([templates[0]]);
  });

  it('tracks create wizard required fields by step', () => {
    const draft = {
      ...emptyProjectDraft('C:\\Fluxora Projects'),
      projectName: 'Skyrim Main',
      templateId: 'skyrim-special-edition',
      gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe'
    };

    expect(isProjectDraftStepComplete(draft, 0)).toBe(true);
    expect(isProjectDraftStepComplete(draft, 1)).toBe(true);
    expect(isProjectDraftStepComplete(draft, 2)).toBe(true);
    expect(isProjectDraftStepComplete(draft, 3)).toBe(true);
  });

  it('keeps default install root as the only populated field in an empty draft', () => {
    expect(emptyProjectDraft('C:\\Fluxora Projects')).toEqual({
      projectName: '',
      templateId: '',
      gamePath: '',
      installRootDirectory: 'C:\\Fluxora Projects'
    });
  });

  it('rejects whitespace-only required fields on every create wizard step', () => {
    const completeDraft = {
      ...emptyProjectDraft('C:\\Fluxora Projects'),
      projectName: 'Skyrim Main',
      templateId: 'skyrim-special-edition',
      gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe'
    };

    const cases = [
      { stepIndex: 0, draft: { ...completeDraft, projectName: '   ' } },
      { stepIndex: 1, draft: { ...completeDraft, templateId: '\t  ' } },
      { stepIndex: 2, draft: { ...completeDraft, gamePath: '  \n ' } },
      { stepIndex: 3, draft: { ...completeDraft, installRootDirectory: '\r\n ' } }
    ];

    cases.forEach(({ draft, stepIndex }) => {
      expect(isProjectDraftStepComplete(draft, stepIndex)).toBe(false);
    });
  });

  it('formats project display details without mutating domain DTOs', () => {
    expect(projectDisplayPath(projects[0])).toBe('C:\\Fluxora Projects\\Skyrim Main');
    expect(projectCapabilitiesLabel(projects[0])).toBe('plugins, load order, VFS');
    expect(projectCapabilitiesLabel(projects[1])).toBe('core managed');
  });

  it('can preserve a transferred project in the local catalog after a refresh error', () => {
    const imported: FluxoraProject = {
      ...projects[0],
      id: 'C:\\Fluxora\\Builds\\Imported.json',
      name: 'Imported MO2 Build',
      installRootDirectory: 'E:\\Fluxora Builds',
      projectDirectory: 'E:\\Fluxora Builds\\Imported MO2 Build',
      configPath: 'C:\\Fluxora\\Builds\\Imported.json'
    };

    const catalog = mergeProjectIntoCatalog(projectCatalogFallback, imported);

    expect(catalog.projects).toEqual([imported]);
    expect(catalog.buildConfigsDirectory).toBe(projectCatalogFallback.buildConfigsDirectory);
    expect(catalog.defaultInstallRootDirectory).toBe(projectCatalogFallback.defaultInstallRootDirectory);
  });

  it('merges a created build without losing catalog identity fields', () => {
    const existing = projects[0];
    const catalog: FluxoraProjectCatalog = {
      projects: [existing],
      buildConfigsDirectory: 'C:\\Fluxora\\Builds',
      defaultInstallRootDirectory: 'D:\\Fluxora Builds',
      operationId: 'op_catalog_load'
    };
    const created: FluxoraProject = {
      ...existing,
      name: 'Skyrim Main Created',
      projectDirectory: 'D:\\Fluxora Builds\\Skyrim Main Created'
    };

    const merged = mergeProjectIntoCatalog(catalog, created);

    expect(merged.projects).toEqual([created]);
    expect(merged.buildConfigsDirectory).toBe(catalog.buildConfigsDirectory);
    expect(merged.defaultInstallRootDirectory).toBe(catalog.defaultInstallRootDirectory);
    expect(merged.operationId).toBe(catalog.operationId);
  });
});
