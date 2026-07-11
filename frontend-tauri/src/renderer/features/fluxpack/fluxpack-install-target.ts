export interface FluxPackInstallTargetProject {
  id?: string;
  name?: string;
  configPath: string;
  installRootDirectory: string;
}

export interface FluxPackInstallTarget {
  existingConfigPath: string | undefined;
  installRootDirectory: string;
  requiresRootSelection: boolean;
}

export const resolveFluxPackInstallTarget = (
  selectedProject: FluxPackInstallTargetProject | null,
  defaultInstallRootDirectory: string
): FluxPackInstallTarget => {
  const existingConfigPath = selectedProject?.configPath.trim() || undefined;
  const installRootDirectory =
    selectedProject?.installRootDirectory.trim() || defaultInstallRootDirectory.trim();

  return {
    existingConfigPath,
    installRootDirectory,
    requiresRootSelection: !installRootDirectory
  };
};

const normalizedBuildName = (value: string): string => value.trim().toLocaleLowerCase();

export const findFluxPackNameConflict = <T extends FluxPackInstallTargetProject>(
  projects: readonly T[],
  buildName: string,
  selectedProjectId?: string | null
): T | null => {
  const normalizedName = normalizedBuildName(buildName);
  if (!normalizedName) {
    return null;
  }

  const matches = projects.filter(
    (project) => normalizedBuildName(project.name ?? '') === normalizedName
  );
  return (
    matches.find((project) => Boolean(selectedProjectId) && project.id === selectedProjectId) ??
    matches[0] ??
    null
  );
};
