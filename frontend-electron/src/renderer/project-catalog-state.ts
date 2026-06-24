import type {
  FluxoraGameTemplate,
  FluxoraProject
} from '../shared/fluxora-api';

export interface ProjectDraft {
  projectName: string;
  templateId: string;
  gamePath: string;
  installRootDirectory: string;
}

export const emptyProjectDraft = (installRootDirectory = ''): ProjectDraft => ({
  projectName: '',
  templateId: '',
  gamePath: '',
  installRootDirectory
});

const normalize = (value: string): string => value.trim().toLowerCase();

const includesTerm = (value: string | undefined, term: string): boolean =>
  typeof value === 'string' && normalize(value).includes(term);

export const filterProjects = (
  projects: FluxoraProject[],
  searchText: string
): FluxoraProject[] => {
  const terms = normalize(searchText)
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return projects;
  }

  return projects.filter((project) =>
    terms.every((term) =>
      includesTerm(project.name, term) ||
      includesTerm(project.gameName, term) ||
      includesTerm(project.templateId, term) ||
      includesTerm(project.projectDirectory, term) ||
      includesTerm(project.configPath, term)
    )
  );
};

export const filterTemplates = (
  templates: FluxoraGameTemplate[],
  searchText: string
): FluxoraGameTemplate[] => {
  const terms = normalize(searchText)
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return templates;
  }

  return templates.filter((template) =>
    terms.every((term) =>
      includesTerm(template.displayName, term) ||
      includesTerm(template.gameName, term) ||
      includesTerm(template.summary, term) ||
      includesTerm(template.id, term) ||
      includesTerm(template.uiTemplateId, term)
    )
  );
};

export const isProjectDraftStepComplete = (
  draft: ProjectDraft,
  stepIndex: number
): boolean => {
  if (stepIndex === 0) {
    return draft.projectName.trim().length > 0;
  }

  if (stepIndex === 1) {
    return draft.templateId.trim().length > 0;
  }

  if (stepIndex === 2) {
    return draft.gamePath.trim().length > 0;
  }

  return draft.installRootDirectory.trim().length > 0;
};

export const projectDisplayPath = (project: FluxoraProject): string =>
  project.projectDirectory || project.configPath || project.installRootDirectory;

export const projectCapabilitiesLabel = (project: FluxoraProject): string => {
  const flags = project.gameCapabilities ?? {};
  const labels = [
    flags.supportsPlugins ? 'plugins' : null,
    flags.supportsLoadOrder ? 'load order' : null,
    flags.supportsVfsLaunch ? 'VFS' : null
  ].filter(Boolean);

  return labels.length > 0 ? labels.join(', ') : 'core managed';
};
