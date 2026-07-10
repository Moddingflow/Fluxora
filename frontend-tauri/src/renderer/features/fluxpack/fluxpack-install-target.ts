export interface FluxPackInstallTargetProject {
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
    requiresRootSelection: !existingConfigPath || !installRootDirectory
  };
};
