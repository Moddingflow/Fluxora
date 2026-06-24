import type { ProjectDraft } from '../project-catalog-state';
import type {
  DeleteFluxoraProjectResult,
  FluxoraGameTemplate,
  FluxoraProject,
  FluxoraProjectCatalog,
  FluxoraProjectDirectoryPreview,
  NativeBridgeStatus
} from '../../shared/fluxora-api';
import { createRendererOperationId } from './renderer-operation-service';

export interface ProjectCatalogLoadResult {
  catalog: FluxoraProjectCatalog;
  templates: FluxoraGameTemplate[];
  operationId: string;
}

export interface ProjectMutationResult {
  project: FluxoraProject;
  operationId: string;
}

export interface ProjectDeleteResult {
  result: DeleteFluxoraProjectResult;
  operationId: string;
}

export const projectCatalogFallback: FluxoraProjectCatalog = {
  projects: [],
  buildConfigsDirectory: '',
  defaultInstallRootDirectory: '',
  operationId: ''
};

export const bridgeStatusLabel = (status: NativeBridgeStatus | null): string => {
  if (!status) {
    return 'checking';
  }

  return status.ready ? 'ready' : 'error';
};

export const upsertProject = (projects: FluxoraProject[], next: FluxoraProject): FluxoraProject[] => {
  const index = projects.findIndex(
    (project) =>
      project.configPath === next.configPath ||
      project.projectDirectory === next.projectDirectory ||
      project.id === next.id
  );

  if (index < 0) {
    return [next, ...projects];
  }

  const copy = [...projects];
  copy[index] = next;
  return copy;
};

export const loadProjectCatalog = async (): Promise<ProjectCatalogLoadResult> => {
  const operationId = createRendererOperationId('projects_list');
  const [catalog, templates] = await Promise.all([
    window.fluxora.projects.list({ operationId }),
    window.fluxora.templates.list({ operationId })
  ]);

  return { catalog, templates, operationId };
};

export const previewProjectDirectory = (
  projectName: string,
  installRootDirectory: string,
  operationId = createRendererOperationId('projects_preview')
): Promise<FluxoraProjectDirectoryPreview> =>
  window.fluxora.projects.previewDirectory(projectName, installRootDirectory, { operationId });

export const openProjectConfig = async (
  configPath: string,
  operationId = createRendererOperationId('projects_open')
): Promise<ProjectMutationResult> => {
  const project = await window.fluxora.projects.openConfig(configPath, { operationId });
  return { project, operationId };
};

export const createProjectFromDraft = async (
  draft: ProjectDraft,
  operationId = createRendererOperationId('projects_create')
): Promise<ProjectMutationResult> => {
  const project = await window.fluxora.projects.create(
    {
      projectName: draft.projectName.trim(),
      templateId: draft.templateId,
      gamePath: draft.gamePath.trim(),
      installRootDirectory: draft.installRootDirectory.trim()
    },
    { operationId }
  );

  return { project, operationId };
};

export const renameProjectConfig = async (
  project: FluxoraProject,
  newName: string,
  operationId = createRendererOperationId('projects_rename')
): Promise<ProjectMutationResult> => {
  const renamed = await window.fluxora.projects.rename(project.configPath, newName, {
    operationId
  });

  return { project: renamed, operationId };
};

export const deleteProjectConfig = async (
  project: FluxoraProject,
  operationId = createRendererOperationId('projects_delete')
): Promise<ProjectDeleteResult> => {
  const result = await window.fluxora.projects.delete(project.configPath, { operationId });
  return { result, operationId };
};
