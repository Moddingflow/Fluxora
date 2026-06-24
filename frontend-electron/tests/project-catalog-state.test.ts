import { describe, expect, it } from 'vitest';

import {
  emptyProjectDraft,
  filterProjects,
  filterTemplates,
  isProjectDraftStepComplete,
  projectCapabilitiesLabel,
  projectDisplayPath
} from '../src/renderer/project-catalog-state';
import type {
  FluxoraGameTemplate,
  FluxoraProject
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

  it('formats project display details without mutating domain DTOs', () => {
    expect(projectDisplayPath(projects[0])).toBe('C:\\Fluxora Projects\\Skyrim Main');
    expect(projectCapabilitiesLabel(projects[0])).toBe('plugins, load order, VFS');
    expect(projectCapabilitiesLabel(projects[1])).toBe('core managed');
  });
});
