import type {
  FluxoraGameTemplate,
  FluxoraProject
} from '../shared/fluxora-api';
import { translateForLanguage } from '../localization';

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

const pathFileName = (value: string): string => {
  const segments = value.trim().split(/[\\/]/u);
  return segments.at(-1) ?? '';
};

export const primaryGameExecutableName = (
  template: FluxoraGameTemplate | null | undefined
): string | null => {
  const primary = template?.executableDisplayMetadata?.find(
    (entry) => entry.isPrimary || entry.role === 'primary'
  );
  const executableName = primary?.executableName?.trim();

  return executableName || null;
};

export const isOfficialGameExecutablePath = (
  template: FluxoraGameTemplate | null | undefined,
  gamePath: string
): boolean => {
  const expectedName = primaryGameExecutableName(template);
  return Boolean(expectedName && normalize(pathFileName(gamePath)) === normalize(expectedName));
};

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
  stepIndex: number,
  selectedTemplate?: FluxoraGameTemplate | null
): boolean => {
  if (stepIndex === 0) {
    return draft.projectName.trim().length > 0;
  }

  if (stepIndex === 1) {
    return draft.templateId.trim().length > 0;
  }

  if (stepIndex === 2) {
    return isOfficialGameExecutablePath(selectedTemplate, draft.gamePath);
  }

  return draft.installRootDirectory.trim().length > 0;
};

export const projectDraftStepError = (
  draft: ProjectDraft,
  stepIndex: number,
  selectedTemplate?: FluxoraGameTemplate | null,
  language?: string | null
): string | null => {
  if (stepIndex === 0) {
    return draft.projectName.trim() ? null : translateForLanguage(language, 'wizard.enterBuildName');
  }

  if (stepIndex === 1) {
    return draft.templateId.trim() ? null : translateForLanguage(language, 'wizard.chooseGameTemplate');
  }

  if (stepIndex === 2) {
    if (!selectedTemplate) {
      return translateForLanguage(language, 'wizard.chooseGameTemplateFirst');
    }

    const executableName = primaryGameExecutableName(selectedTemplate);
    if (!executableName) {
      return translateForLanguage(language, 'wizard.noOfficialExecutable');
    }

    if (!draft.gamePath.trim()) {
      return translateForLanguage(language, 'wizard.chooseExecutable', { name: executableName });
    }

    return isOfficialGameExecutablePath(selectedTemplate, draft.gamePath)
      ? null
      : translateForLanguage(language, 'wizard.invalidExecutable', { name: executableName });
  }

  return draft.installRootDirectory.trim()
    ? null
    : translateForLanguage(language, 'wizard.chooseInstallLocation');
};

export const firstIncompleteProjectDraftStep = (
  draft: ProjectDraft,
  templates: FluxoraGameTemplate[]
): number | null => {
  const selectedTemplate = templates.find((template) => template.id === draft.templateId) ?? null;

  for (let stepIndex = 0; stepIndex < 4; stepIndex += 1) {
    if (!isProjectDraftStepComplete(draft, stepIndex, selectedTemplate)) {
      return stepIndex;
    }
  }

  return null;
};

export const projectDisplayPath = (project: FluxoraProject): string =>
  project.projectDirectory || project.configPath || project.installRootDirectory;

export const projectCapabilitiesLabel = (
  project: FluxoraProject,
  language = 'en-US'
): string => {
  const flags = project.gameCapabilities ?? {};
  const labels = [
    flags.supportsPlugins ? translateForLanguage(language, 'project.capability.plugins') : null,
    flags.supportsLoadOrder ? translateForLanguage(language, 'project.capability.loadOrder') : null,
    flags.supportsVfsLaunch ? translateForLanguage(language, 'project.capability.vfs') : null
  ].filter(Boolean);

  return labels.length > 0
    ? labels.join(', ')
    : translateForLanguage(language, 'project.capability.coreManaged');
};
