import type { ReactElement } from 'react';

import { fluxoraLogo, skyrimIcon } from '../../design-system/assets';
import {
  Badge,
  Button,
  EmptyState,
  Icon,
  IconButton,
  Input,
  SectionLabel,
  Skeleton
} from '../../design-system';
import { projectDisplayPath } from '../../project-catalog-state';
import { shortPath } from '../../services/path-display-service';
import type { FluxoraProject } from '../../../shared/fluxora-api';
import { useLocalization, type LocalizationContextValue } from '../../../localization/react';

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
  isInstallFluxPackDisabled: boolean;
  isNewBuildDisabled: boolean;
  isProjectInteractionDisabled: boolean;
  onInstallFluxPack: () => void;
  onNewBuild: () => void;
  onOpenProject: (project: FluxoraProject) => void;
  onOpenProjectDirectory: (project: FluxoraProject) => void;
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

const primaryActionIcon = { size: 16, strokeWidth: 2.35 } as const;
const libraryLoadingRows = [0, 1, 2] as const;

const hasStatValue = (value: string, notTracked = ''): boolean => {
  const normalized = value.trim();
  return normalized !== '' && normalized !== '-' && normalized !== notTracked;
};

const statValue = (value: string, fallback: string, notTracked = ''): string =>
  hasStatValue(value, notTracked) ? value : fallback;

const projectGameLabel = (project: FluxoraProject, fallback: string): string =>
  project.gameName || project.templateId || fallback;

const projectIcon = (project: FluxoraProject, fallback: string): string =>
  /skyrim/i.test(projectGameLabel(project, fallback)) ? skyrimIcon : fluxoraLogo;

const rowMeta = (
  project: FluxoraProject,
  stats: ProjectLibraryStats,
  t: LocalizationContextValue['t'],
  fallback: string
): string => {
  const modCount = Number(stats.mods);
  const notTracked = t('library.notTracked');
  const parts = [
    hasStatValue(stats.mods, notTracked)
      ? Number.isFinite(modCount)
        ? t('library.modsCount', { count: modCount })
        : stats.mods
      : null,
    hasStatValue(stats.size, notTracked) ? stats.size : null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : projectGameLabel(project, fallback);
};

const detailMetrics = (stats: ProjectLibraryStats, t: LocalizationContextValue['t']) => {
  const notTracked = t('library.notTracked');
  return [
    {
      label: t('library.metric.mods'),
      value: statValue(stats.mods, t('library.notIndexed'), notTracked)
    },
    {
      label: t('library.metric.lastLaunched'),
      value: statValue(stats.lastLaunch, t('library.notLaunched'), notTracked)
    },
    {
      label: t('library.metric.size'),
      value: statValue(stats.size, t('library.notIndexed'), notTracked)
    }
  ];
};

export function LibraryHome({
  bridgeErrorMessage,
  catalogPath,
  catalogState,
  filteredProjects,
  isInstallFluxPackDisabled,
  isNewBuildDisabled,
  isProjectInteractionDisabled,
  onInstallFluxPack,
  onNewBuild,
  onOpenProject,
  onOpenProjectDirectory,
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
  const { t } = useLocalization();
  const fallbackName = t('build.fallbackName');
  const selectedGameLabel = selectedProject ? projectGameLabel(selectedProject, fallbackName) : '';
  const selectedMetrics = selectedProjectStats ? detailMetrics(selectedProjectStats, t) : [];

  return (
    <section className="library-page" aria-label={t('library.aria')}>
      <aside className="library-sidebar" aria-label={t('library.sidebarAria')}>
        <header className="library-header">
          <div className="library-header__title">
            <span className="library-header__heading">{t('library.title')}</span>
            <Badge tone="neutral">{t('library.buildsCount', { count: projects.length })}</Badge>
            <Button
              aria-label={t('library.installFluxPack')}
              className="library-header__install"
              disabled={isInstallFluxPackDisabled}
              iconLeft={<Icon name="hard-drive" size={14} />}
              onClick={onInstallFluxPack}
              size="sm"
              variant="secondary"
            >
              {t('library.install')}
            </Button>
          </div>
          <Input
            aria-label={t('library.search')}
            leadingIcon={<Icon name="search" size={14} />}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder={t('library.search')}
            value={searchText}
          />
        </header>

        <div className="library-list" aria-label={t('library.builds')}>
          <SectionLabel>{t('library.builds')}</SectionLabel>
          <LibraryProjectRows
            bridgeErrorMessage={bridgeErrorMessage}
            catalogPath={catalogPath}
            catalogState={catalogState}
            filteredProjects={filteredProjects}
            isNewBuildDisabled={isNewBuildDisabled}
            isProjectInteractionDisabled={isProjectInteractionDisabled}
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
            {t('library.newBuild')}
          </Button>
        </footer>
      </aside>

      <section className="library-home-main" aria-label={t('library.selectedSummary')}>
        {selectedProject && selectedProjectStats ? (
          <article className="library-detail-card" aria-label={t('library.namedSummary', { name: selectedProject.name })}>
            <header className="library-detail-hero">
              <img src={projectIcon(selectedProject, fallbackName)} alt="" />
              <div className="library-detail-identity">
                <h2>{selectedProject.name}</h2>
                <span>{selectedGameLabel}</span>
              </div>
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
                  <span>{t('library.projectPath')}</span>
                  <strong title={projectDisplayPath(selectedProject)}>
                    {shortPath(projectDisplayPath(selectedProject))}
                  </strong>
                </div>
                <Button
                  iconLeft={<Icon name="folder" size={15} />}
                  onClick={() => onOpenProjectDirectory(selectedProject)}
                  variant="secondary"
                >
                  {t('library.openFolder')}
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
                {t('library.newBuild')}
              </Button>
            }
            className="library-home-empty"
            description={t('library.chooseBuildDescription')}
            icon={<Icon name="layers" size={26} />}
            title={t('library.chooseBuild')}
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
  isProjectInteractionDisabled: boolean;
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
  isProjectInteractionDisabled,
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
  const { t } = useLocalization();
  const fallbackName = t('build.fallbackName');
  if (catalogState === 'loading' && projects.length === 0) {
    return (
      <div
        className="library-build-list library-build-list--loading"
        role="list"
        aria-label={t('library.fluxoraBuilds')}
        aria-busy="true"
      >
        <span className="sr-only" role="status">
          {t('library.loading')}
        </span>
        {libraryLoadingRows.map((index) => (
          <div
            aria-hidden="true"
            className="project-row project-row--library project-row--library-skeleton"
            key={`library-build-skeleton-${index}`}
            role="listitem"
          >
            <div className="library-build-row">
              <Skeleton className="project-row__icon library-build-skeleton__icon" />
              <span className="project-row__main library-build-skeleton__copy">
                <Skeleton className="library-build-skeleton__title" />
                <Skeleton className="library-build-skeleton__meta" />
              </span>
            </div>
            <Skeleton className="library-build-open library-build-skeleton__button" />
            <span className="row-actions library-build-actions">
              <Skeleton className="library-build-skeleton__action" />
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (catalogState === 'blocked' || catalogState === 'error') {
    return (
      <EmptyState
        compact
        description={bridgeErrorMessage ?? t('library.bridgeRequired')}
        icon={<Icon name="alert-triangle" size={18} />}
        title={catalogState === 'blocked' ? t('library.coreUnavailable') : t('library.catalogUnavailable')}
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
              disabled={isProjectInteractionDisabled}
              iconLeft={<Icon name="plus" {...primaryActionIcon} />}
              onClick={onNewBuild}
              size="sm"
            >
              {t('library.newBuild')}
            </Button>
          ) : null
        }
        compact
        description={catalogPath || t('library.createOrOpen')}
        icon={<Icon name="folder" size={18} />}
        title={projects.length === 0 ? t('library.noBuilds') : t('library.noMatches')}
      />
    );
  }

  return (
    <div className="library-build-list" role="list" aria-label={t('library.fluxoraBuilds')}>
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
            role="listitem"
          >
            <button
              aria-current={isSelected ? 'true' : undefined}
              aria-label={t('library.selectNamed', { name: project.name })}
              className="library-build-row"
              disabled={isNewBuildDisabled}
              onClick={() => onSelectProject(project)}
              onDoubleClick={() => {
                if (!isNewBuildDisabled) {
                  onOpenProject(project);
                }
              }}
              type="button"
            >
              <img className="project-row__icon" src={projectIcon(project, fallbackName)} alt="" />
              <span className="project-row__main">
                <strong>{project.name}</strong>
                <small>{rowMeta(project, stats, t, fallbackName)}</small>
              </span>
            </button>
            <Button
              aria-label={t('library.openNamed', { name: project.name })}
              className="library-build-open"
              disabled={isNewBuildDisabled}
              fullWidth
              iconLeft={<Icon name="open" size={14} strokeWidth={2.35} />}
              onClick={(event) => {
                event.stopPropagation();
                onSelectProject(project);
                onOpenProject(project);
              }}
              size="sm"
            >
              {t('library.open')}
            </Button>
            <div
              className="row-actions library-build-actions"
              aria-label={t('library.namedActions', { name: project.name })}
              data-menu-open={isProjectMenuOpen}
            >
              <IconButton
                data-project-menu-trigger="true"
                disabled={isProjectInteractionDisabled}
                label={t('library.namedActions', { name: project.name })}
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
