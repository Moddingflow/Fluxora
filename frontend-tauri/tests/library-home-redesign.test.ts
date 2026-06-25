import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LibraryHome, type ProjectLibraryStats } from '../src/renderer/features/library/LibraryHome';
import type { FluxoraProject } from '../src/shared/fluxora-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const projects: FluxoraProject[] = [
  {
    id: 'skyrim-main',
    name: 'Skyrim graphics overhaul',
    templateId: 'skyrim-special-edition',
    uiTemplateId: 'skyrim',
    gameName: 'Skyrim Special Edition',
    gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
    installRootDirectory: 'D:\\Fluxora\\Builds',
    projectDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul',
    configPath: 'D:\\Fluxora\\Configs\\skyrim-main.json'
  },
  {
    id: 'fallout-test',
    name: 'Fallout test lab',
    templateId: 'fallout-4',
    uiTemplateId: 'fallout',
    gameName: 'Fallout 4',
    gamePath: 'C:\\Games\\Fallout4\\Fallout4.exe',
    installRootDirectory: 'D:\\Fluxora\\Builds',
    projectDirectory: 'D:\\Fluxora\\Builds\\Fallout test lab',
    configPath: 'D:\\Fluxora\\Configs\\fallout-test.json'
  }
];

const stats: ProjectLibraryStats = {
  disabledMods: '-',
  downloads: '-',
  lastLaunch: 'Jun 24, 2026',
  mods: '248',
  plugins: '92',
  size: '32.4 GB'
};

const noop = () => undefined;

const renderLibrary = (selectedProject: FluxoraProject | null = projects[0]) =>
  renderToStaticMarkup(
    React.createElement(LibraryHome, {
      catalogPath: 'D:\\Fluxora\\Configs',
      catalogState: 'ready',
      filteredProjects: projects,
      isNewBuildDisabled: false,
      message: null,
      onNewBuild: noop,
      onOpenProject: noop,
      onOpenProjectDirectory: noop,
      onOpenSelectedProject: noop,
      onProjectMenuToggle: noop,
      onSearchChange: noop,
      onSelectProject: noop,
      projectMenuId: null,
      projects,
      projectStats: () => stats,
      renderProjectRowMenu: () => null,
      searchText: '',
      selectedProject,
      selectedProjectStats: selectedProject ? stats : null
    })
  );

describe('library home redesign', () => {
  it('renders the UI-kit library sidebar with search, build count and compact rows', () => {
    const markup = renderLibrary();

    expect(markup).toContain('Build library sidebar');
    expect(markup).toContain('Library');
    expect(markup).toContain('2 builds');
    expect(markup).toContain('Search builds');
    expect(markup).toContain('Skyrim graphics overhaul');
    expect(markup).toContain('248 mods · 32.4 GB');
    expect(markup).toContain('aria-label="Skyrim graphics overhaul actions"');
    expect(markup).toContain('New build');
  });

  it('shows the composed choose-build empty state until a build is selected', () => {
    const markup = renderLibrary(null);

    expect(markup).toContain('Choose a build');
    expect(markup).toContain('Open a build from the library on the left');
  });

  it('keeps the Phase 5 layout dimensions and lightweight row actions in CSS', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(styles).toContain('grid-template-columns: 290px minmax(0, 1fr);');
    expect(styles).toContain('min-height: 56px;');
    expect(styles).toContain('.library-build-actions[data-menu-open="true"]');
    expect(styles).not.toContain('.library-build-open {');
  });

  it('keeps project mutations on the typed facade with renderer-created operation ids', () => {
    const service = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'services',
      'project-catalog-service.ts'
    );

    expect(service).toContain("createRendererOperationId('projects_create')");
    expect(service).toContain("createRendererOperationId('projects_rename')");
    expect(service).toContain("createRendererOperationId('projects_delete')");
    expect(service).toContain('window.fluxora.projects.create');
    expect(service).toContain('window.fluxora.projects.openConfig');
    expect(service).toContain('window.fluxora.projects.rename');
    expect(service).toContain('window.fluxora.projects.delete');
  });
});
