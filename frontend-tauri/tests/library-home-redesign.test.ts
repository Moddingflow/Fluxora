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
  size: '32.4 GB'
};

const noop = () => undefined;

const renderLibrary = (
  selectedProject: FluxoraProject | null = projects[0],
  selectedStats: ProjectLibraryStats = stats
) =>
  renderToStaticMarkup(
    React.createElement(LibraryHome, {
      catalogPath: 'D:\\Fluxora\\Configs',
      catalogState: 'ready',
      filteredProjects: projects,
      isInstallFluxPackDisabled: false,
      isNewBuildDisabled: false,
      isProjectInteractionDisabled: false,
      onInstallFluxPack: noop,
      onNewBuild: noop,
      onOpenProject: noop,
      onOpenProjectDirectory: noop,
      onProjectMenuToggle: noop,
      onSearchChange: noop,
      onSelectProject: noop,
      projectMenuId: null,
      projects,
      projectStats: () => selectedStats,
      renderProjectRowMenu: () => null,
      searchText: '',
      selectedProject,
      selectedProjectStats: selectedProject ? selectedStats : null
    })
  );

describe('library home redesign', () => {
  it('renders the UI-kit library sidebar with search, build count and compact rows', () => {
    const markup = renderLibrary();

    expect(markup).toContain('Build library sidebar');
    expect(markup).toContain('Library');
    expect(markup).toContain('2 builds');
    expect(markup).toContain('Search builds');
    expect(markup).toContain('Установить');
    expect(markup).toContain('aria-label="Установить сборку из FluxPack"');
    expect(markup).toContain('Skyrim graphics overhaul');
    expect(markup).toContain('248 mods · 32.4 GB');
    expect(markup).toContain('aria-label="Open Skyrim graphics overhaul"');
    expect(markup).toContain('aria-label="Select Skyrim graphics overhaul"');
    expect(markup).toContain('library-build-open');
    expect(markup).toContain('aria-label="Skyrim graphics overhaul actions"');
    expect(markup).toContain('role="list"');
    expect(markup).toContain('role="listitem"');
    expect(markup).not.toContain('role="listbox"');
    expect(markup).not.toContain('role="option"');
    expect(markup).toContain('New build');
    expect(markup).toContain('stroke-width="2.35"');
  });

  it('renders the selected build summary without plugin counts or clipped accent badges', () => {
    const markup = renderLibrary();

    expect(markup).toContain('aria-label="Skyrim graphics overhaul summary"');
    expect(markup).toContain('Skyrim Special Edition');
    expect(markup).toContain('<dt>Mods</dt>');
    expect(markup).toContain('<dd>248</dd>');
    expect(markup).toContain('<dt>Last launched</dt>');
    expect(markup).toContain('<dd>Jun 24, 2026</dd>');
    expect(markup).toContain('<dt>Size</dt>');
    expect(markup).toContain('<dd>32.4 GB</dd>');
    expect(markup).toContain('Project path');
    expect(markup).toContain('Open folder');
    expect(markup).not.toContain('<dt>Plugins</dt>');
    expect(markup).not.toContain('92');
    expect(markup).not.toContain('data-tone="accent"');
  });

  it('keeps the summary metrics visible with instant fallback values', () => {
    const markup = renderLibrary(projects[0], {
      disabledMods: '-',
      downloads: '-',
      lastLaunch: 'Not tracked',
      mods: '-',
      size: '-'
    });

    expect(markup).toContain('<dt>Mods</dt>');
    expect(markup).toContain('<dd>Not indexed</dd>');
    expect(markup).toContain('<dt>Last launched</dt>');
    expect(markup).toContain('<dd>Not launched</dd>');
    expect(markup).toContain('<dt>Size</dt>');
  });

  it('shows the composed choose-build empty state until a build is selected', () => {
    const markup = renderLibrary(null);

    expect(markup).toContain('Choose a build');
    expect(markup).toContain('Open a build from the library on the left');
  });

  it('keeps the Phase 5 layout dimensions and lightweight row actions in CSS', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const component = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'library',
      'LibraryHome.tsx'
    );

    expect(styles).toContain('grid-template-columns: 290px minmax(0, 1fr);');
    expect(styles).toContain('min-height: 96px;');
    expect(styles).toContain('"open actions"');
    expect(styles).toContain('.library-build-open');
    expect(styles).toMatch(
      /\.library-build-row:focus-visible:not\(:disabled\)\s*\{[^}]*outline: 2px solid var\(--focus-ring\);/s
    );
    expect(styles).toContain('.library-build-actions[data-menu-open="true"]');
    expect(styles).toContain('grid-template-columns: repeat(3, minmax(140px, 1fr));');
    expect(styles).toContain('.library-detail-path-row');
    expect(component).toContain('aria-label={`Open ${project.name}`}');
    expect(component).not.toContain('onOpenSelectedProject');
    expect(styles).not.toContain('.library-detail-actions');
    expect(styles).not.toContain('activity-banner');
    expect(styles).not.toContain('library-message');
  });

  it('prevents horizontal scrolling in the library sidebar list', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(styles).toMatch(/\.library-list\s*\{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;[^}]*\}/);
    expect(styles).toMatch(
      /\.library-list \.flx-empty-state__description\s*\{[^}]*overflow-wrap: anywhere;[^}]*\}/
    );
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
