import type { ReactElement } from 'react';

import { fluxoraLogo, skyrimIcon } from '../../design-system/assets';
import {
  Badge,
  Button,
  EmptyState,
  Icon,
  IconButton,
  Input,
  SectionLabel
} from '../../design-system';
import { projectDisplayPath } from '../../project-catalog-state';
import { shortPath } from '../../services/path-display-service';
import type { FluxoraProject } from '../../../shared/fluxora-api';

export type LibraryCatalogState = 'idle' | 'loading' | 'ready' | 'blocked' | 'error';

export interface ProjectLibraryStats {
  lastLaunch: string;
  size: string;
  mods: string;
  disabledMods: string;
  downloads: string;
}

interface LibraryHomeProps {
  bridgeErrorMessage?: string;
  catalogPath: string;
  catalogState: LibraryCatalogState;
  filteredProjects: FluxoraProject[];
  isNewBuildDisabled: boolean;
  onNewBuild: () => void;
  onOpenProject: (project: FluxoraProject) => void;
  onOpenProjectDirectory: (project: FluxoraProject) => void;
  onOpenSelectedProject: () => void;
  onProjectMenuToggle: (project: FluxoraProject, anchor: DOMRect) => void;
  onSearchChange: (value: string) => void;
  onSelectProject: (project: FluxoraProject) => void;
  projectMenuId: string | null;
  projects: FluxoraProject[];
  projectStats: (project: FluxoraProject, isSelected: boolean) => ProjectLibraryStats;
  renderProjectRowMenu: (project: FluxoraProject) => ReactElement | null;
  searchText: string;
  selectedProject: FluxoraProject | null;
  selectedProjectStats: ProjectLibraryStats | null;
}

const hiddenStatValues = new Set(['', '-', 'Not tracked']);
const primaryActionIcon = { size: 16, strokeWidth: 2.35 } as const;

const hasStatValue = (value: string): boolean => !hiddenStatValues.has(value.trim());

const statValue = (value: string, fallback: string): string =>
  hasStatValue(value) ? value : fallback;

const projectGameLabel = (project: FluxoraProject): string =>
  project.gameName || project.templateId || 'Fluxora build';

const projectIcon = (project: FluxoraProject): string =>
  /skyrim/i.test(projectGameLabel(project)) ? skyrimIcon : fluxoraLogo;

const rowMeta = (project: FluxoraProject, stats: ProjectLibraryStats): string => {
  const parts = [
    hasStatValue(stats.mods) ? `${stats.mods} mods` : null,
    hasStatValue(stats.size) ? stats.size : null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : projectGameLabel(project);
};

const detailMetrics = (stats: ProjectLibraryStats) =>
  [
    { label: 'Mods', value: statValue(stats.mods, 'Not indexed') },
    { label: 'Last launched', value: statValue(stats.lastLaunch, 'Not launched') },
    { label: 'Size', value: statValue(stats.size, 'Not indexed') }
  ];

export function LibraryHome({
  bridgeErrorMessage,
  catalogPath,
  catalogState,
  filteredProjects,
  isNewBuildDisabled,
  onNewBuild,
  onOpenProject,
  onOpenProjectDirectory,
  onOpenSelectedProject,
  onProjectMenuToggle,
  onSearchChange,
  onSelectProject,
  projectMenuId,
  projects,
  projectStats,
  renderProjectRowMenu,
  searchText,
  selectedProject,
  selectedProjectStats
}: LibraryHomeProps) {
  const selectedGameLabel = selectedProject ? projectGameLabel(selectedProject) : '';
  const selectedMetrics = selectedProjectStats ? detailMetrics(selectedProjectStats) : [];

  return (
    <section className="library-page" aria-label="Build library">
      <aside className="library-sidebar" aria-label="Build library sidebar">
        <header className="library-header">
          <div className="library-header__title">
            <span>Library</span>
            <Badge tone="neutral">{projects.length} builds</Badge>
          </div>
          <Input
            aria-label="Search builds"
            leadingIcon={<Icon name="search" size={14} />}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="Search builds"
            value={searchText}
          />
        </header>

        <div className="library-list" aria-label="Builds">
          <SectionLabel>Builds</SectionLabel>
          <LibraryProjectRows
            bridgeErrorMessage={bridgeErrorMessage}
            catalogPath={catalogPath}
            catalogState={catalogState}
            filteredProjects={filteredProjects}
            isNewBuildDisabled={isNewBuildDisabled}
            onNewBuild={onNewBuild}
            onOpenProject={onOpenProject}
            onProjectMenuToggle={onProjectMenuToggle}
            onSelectProject={onSelectProject}
            projectMenuId={projectMenuId}
            projects={projects}
            projectStats={projectStats}
            renderProjectRowMenu={renderProjectRowMenu}
            selectedProject={selectedProject}
          />
        </div>

        <footer className="library-footer">
          <Button
            disabled={isNewBuildDisabled}
            fullWidth
            iconLeft={<Icon name="plus" {...primaryActionIcon} />}
            onClick={onNewBuild}
          >
            New build
          </Button>
        </footer>
      </aside>

      <section className="library-home-main" aria-label="Selected build summary">
        {selectedProject && selectedProjectStats ? (
          <article className="library-detail-card" aria-label={`${selectedProject.name} summary`}>
            <header className="library-detail-hero">
              <img src={projectIcon(selectedProject)} alt="" />
              <div className="library-detail-identity">
                <h2>{selectedProject.name}</h2>
                <span>{selectedGameLabel}</span>
              </div>
              <Button
                disabled={isNewBuildDisabled}
                iconLeft={<Icon name="open" {...primaryActionIcon} />}
                onClick={onOpenSelectedProject}
              >
                Open
              </Button>
            </header>

            <dl className="library-detail-metrics">
              {selectedMetrics.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>

            <div className="library-detail-paths">
              <div className="library-detail-path-row">
                <div>
                  <span>Project path</span>
                  <strong title={projectDisplayPath(selectedProject)}>
                    {shortPath(projectDisplayPath(selectedProject))}
                  </strong>
                </div>
                <Button
                  iconLeft={<Icon name="folder" size={15} />}
                  onClick={() => onOpenProjectDirectory(selectedProject)}
                  variant="secondary"
                >
                  Open folder
                </Button>
              </div>
            </div>
          </article>
        ) : (
          <EmptyState
            action={
              <Button
                disabled={isNewBuildDisabled}
                iconLeft={<Icon name="plus" {...primaryActionIcon} />}
                onClick={onNewBuild}
              >
                New build
              </Button>
            }
            className="library-home-empty"
            description="Open a build from the library on the left or create a new one to see its details."
            icon={<Icon name="layers" size={26} />}
            title="Choose a build"
          />
        )}
      </section>
    </section>
  );
}

interface LibraryProjectRowsProps {
  bridgeErrorMessage?: string;
  catalogPath: string;
  catalogState: LibraryCatalogState;
  filteredProjects: FluxoraProject[];
  isNewBuildDisabled: boolean;
  onNewBuild: () => void;
  onOpenProject: (project: FluxoraProject) => void;
  onProjectMenuToggle: (project: FluxoraProject, anchor: DOMRect) => void;
  onSelectProject: (project: FluxoraProject) => void;
  projectMenuId: string | null;
  projects: FluxoraProject[];
  projectStats: (project: FluxoraProject, isSelected: boolean) => ProjectLibraryStats;
  renderProjectRowMenu: (project: FluxoraProject) => ReactElement | null;
  selectedProject: FluxoraProject | null;
}

function LibraryProjectRows({
  bridgeErrorMessage,
  catalogPath,
  catalogState,
  filteredProjects,
  isNewBuildDisabled,
  onNewBuild,
  onOpenProject,
  onProjectMenuToggle,
  onSelectProject,
  projectMenuId,
  projects,
  projectStats,
  renderProjectRowMenu,
  selectedProject
}: LibraryProjectRowsProps) {
  if (catalogState === 'loading') {
    return (
      <EmptyState
        compact
        description={catalogPath || 'Fluxora catalog'}
        icon={<Icon name="refresh" size={18} />}
        title="Loading builds"
      />
    );
  }

  if (catalogState === 'blocked' || catalogState === 'error') {
    return (
      <EmptyState
        compact
        description={bridgeErrorMessage ?? 'Build the native bridge host first.'}
        icon={<Icon name="alert-triangle" size={18} />}
        title={catalogState === 'blocked' ? 'Core unavailable' : 'Catalog unavailable'}
        tone="error"
      />
    );
  }

  if (filteredProjects.length === 0) {
    return (
      <EmptyState
        action={
          projects.length === 0 ? (
            <Button
              disabled={isNewBuildDisabled}
              iconLeft={<Icon name="plus" {...primaryActionIcon} />}
              onClick={onNewBuild}
              size="sm"
            >
              New build
            </Button>
          ) : null
        }
        compact
        description={catalogPath || 'Create or open a Fluxora build.'}
        icon={<Icon name="folder" size={18} />}
        title={projects.length === 0 ? 'No builds yet' : 'No matching builds'}
      />
    );
  }

  return (
    <div className="library-build-list" role="listbox" aria-label="Fluxora builds">
      {filteredProjects.map((project) => {
        const isSelected =
          selectedProject?.id === project.id ||
          selectedProject?.configPath === project.configPath ||
          selectedProject?.projectDirectory === project.projectDirectory;
        const stats = projectStats(project, isSelected);
        const isProjectMenuOpen = projectMenuId === project.id;

        return (
          <div
            className="project-row project-row--library"
            data-selected={isSelected}
            key={project.id}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            onClick={() => onSelectProject(project)}
            onDoubleClick={() => onOpenProject(project)}
            onKeyDown={(event) => {
              if (event.currentTarget !== event.target) {
                return;
              }

              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectProject(project);
              }
            }}
          >
            <div className="library-build-row">
              <img className="project-row__icon" src={projectIcon(project)} alt="" />
              <span className="project-row__main">
                <strong>{project.name}</strong>
                <small>{rowMeta(project, stats)}</small>
              </span>
            </div>
            <div
              className="row-actions library-build-actions"
              aria-label={`${project.name} actions`}
              data-menu-open={isProjectMenuOpen}
            >
              <IconButton
                data-project-menu-trigger="true"
                label={`${project.name} actions`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectProject(project);
                  onProjectMenuToggle(project, event.currentTarget.getBoundingClientRect());
                }}
                size="sm"
                variant="boxed"
              >
                <Icon name="more-horizontal" size={17} />
              </IconButton>
              {isProjectMenuOpen ? renderProjectRowMenu(project) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
