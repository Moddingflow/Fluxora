import type {
  FluxoraBuildPathSettings,
  FluxoraBuildPathSettingsSaveRequest,
  FluxoraExecutable,
  FluxoraFluxPackSummary,
  FluxoraProject
} from '../shared/fluxora-api';

export interface BuildPathDraft extends FluxoraBuildPathSettingsSaveRequest {
  projectDirectory: string;
  gameExecutablePath: string;
}

export const emptyBuildPathDraft = (project: FluxoraProject | null): BuildPathDraft => ({
  projectDirectory: project?.projectDirectory ?? '',
  gameExecutablePath: project?.gamePath ?? '',
  gameDirectory: project?.paths?.gameDirectory ?? '',
  modsDirectory: project?.paths?.modsDirectory ?? '',
  profilesDirectory: project?.paths?.profilesDirectory ?? '',
  downloadsDirectory: project?.paths?.downloadsDirectory ?? '',
  overwriteDirectory: project?.paths?.overwriteDirectory ?? ''
});

export const draftFromBuildPathSettings = (
  project: FluxoraProject,
  settings: FluxoraBuildPathSettings,
  executables: FluxoraExecutable[]
): BuildPathDraft => ({
  projectDirectory: project.projectDirectory,
  gameExecutablePath: resolvePrimaryExecutablePath(project, settings.gameDirectory, executables),
  gameDirectory: settings.gameDirectory,
  modsDirectory: settings.modsDirectory,
  profilesDirectory: settings.profilesDirectory,
  downloadsDirectory: settings.downloadsDirectory,
  overwriteDirectory: settings.overwriteDirectory
});

export const directoryFromExecutablePath = (executablePath: string): string => {
  const trimmed = executablePath.trim();
  const separatorIndex = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return separatorIndex > 0 ? trimmed.slice(0, separatorIndex) : '';
};

export const fileNameFromBuildPath = (value: string): string => {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
};

export const pathLooksLikeWindowsExecutable = (value: string): boolean =>
  /\.exe$/i.test(fileNameFromBuildPath(value.trim()));

export const validateBuildPathDraft = (
  draft: BuildPathDraft,
  platform: NodeJS.Platform | 'unknown'
): string | null => {
  if (!draft.projectDirectory.trim()) {
    return 'Project directory is required.';
  }

  if (!draft.gameExecutablePath.trim()) {
    return 'Game executable is required.';
  }

  if (platform === 'win32' && !pathLooksLikeWindowsExecutable(draft.gameExecutablePath)) {
    return 'Game executable must point to an .exe file on Windows.';
  }

  for (const [label, value] of [
    ['Game directory', draft.gameDirectory],
    ['Mods directory', draft.modsDirectory],
    ['Profiles directory', draft.profilesDirectory],
    ['Downloads directory', draft.downloadsDirectory],
    ['Overwrite directory', draft.overwriteDirectory]
  ] as const) {
    if (!value.trim()) {
      return `${label} is required.`;
    }
  }

  return null;
};

export const buildPathSaveRequest = (
  draft: BuildPathDraft
): FluxoraBuildPathSettingsSaveRequest => ({
  gameDirectory: draft.gameDirectory.trim(),
  modsDirectory: draft.modsDirectory.trim(),
  profilesDirectory: draft.profilesDirectory.trim(),
  downloadsDirectory: draft.downloadsDirectory.trim(),
  overwriteDirectory: draft.overwriteDirectory.trim()
});

const resolveExecutablePath = (executablePath: string, gameDirectory: string): string => {
  const trimmed = executablePath.trim();
  if (!trimmed) {
    return '';
  }

  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\\\')) {
    return trimmed;
  }

  return gameDirectory
    ? `${gameDirectory.replace(/[\\/]+$/, '')}\\${trimmed}`
    : trimmed;
};

const primaryExecutable = (
  executables: FluxoraExecutable[],
  gameDirectory: string
): FluxoraExecutable | null => {
  const known = executables.find(
    (entry) =>
      entry.id.toLowerCase() === 'game' ||
      Boolean(
        entry.executableDisplayMetadata &&
          typeof entry.executableDisplayMetadata === 'object' &&
          ((entry.executableDisplayMetadata as { isPrimary?: unknown }).isPrimary === true ||
            (entry.executableDisplayMetadata as { role?: unknown }).role === 'primary')
      )
  );
  if (known) {
    return known;
  }

  return executables.find((entry) => pathLooksLikeWindowsExecutable(entry.executablePath)) ??
    executables.find((entry) => resolveExecutablePath(entry.executablePath, gameDirectory)) ??
    null;
};

export const resolvePrimaryExecutablePath = (
  project: FluxoraProject,
  gameDirectory: string,
  executables: FluxoraExecutable[]
): string => {
  const primary = primaryExecutable(executables, gameDirectory);
  if (primary) {
    return resolveExecutablePath(primary.executablePath, gameDirectory);
  }

  return project.gamePath;
};

const storedExecutablePath = (executablePath: string, gameDirectory: string): string => {
  const normalizedDirectory = directoryFromExecutablePath(executablePath)
    .replace(/[\\/]+$/, '')
    .toLowerCase();
  const normalizedGameDirectory = gameDirectory.replace(/[\\/]+$/, '').toLowerCase();
  return normalizedDirectory && normalizedDirectory === normalizedGameDirectory
    ? fileNameFromBuildPath(executablePath)
    : executablePath;
};

export const buildPrimaryExecutableList = (
  executables: FluxoraExecutable[],
  draft: BuildPathDraft
): FluxoraExecutable[] => {
  const executablePath = draft.gameExecutablePath.trim();
  const gameDirectory = draft.gameDirectory.trim();
  const next = executables.map((entry) => ({ ...entry }));
  let index = next.findIndex(
    (entry) =>
      entry.id.toLowerCase() === 'game' ||
      Boolean(
        entry.executableDisplayMetadata &&
          typeof entry.executableDisplayMetadata === 'object' &&
          ((entry.executableDisplayMetadata as { isPrimary?: unknown }).isPrimary === true ||
            (entry.executableDisplayMetadata as { role?: unknown }).role === 'primary')
      )
  );

  if (index < 0) {
    index = 0;
    next.unshift({
      id: 'game',
      displayName: fileNameFromBuildPath(executablePath).replace(/\.[^.]+$/, '') || 'Game',
      executablePath: '',
      arguments: '',
      workingDirectory: '',
      iconPath: '',
      executableDisplayMetadata: {
        id: 'game',
        displayName: 'Game',
        executableName: fileNameFromBuildPath(executablePath),
        role: 'primary',
        isPrimary: true
      }
    });
  }

  next[index] = {
    ...next[index],
    id: next[index].id || 'game',
    displayName:
      next[index].displayName ||
      fileNameFromBuildPath(executablePath).replace(/\.[^.]+$/, '') ||
      'Game',
    executablePath: storedExecutablePath(executablePath, gameDirectory),
    workingDirectory: '',
    iconPath: ''
  };

  return next;
};

export const fluxPackSummaryFacts = (summary: FluxoraFluxPackSummary): Array<[string, string]> => [
  ['Build', summary.buildName || '-'],
  ['Format', String(summary.formatVersion)],
  ['Sources', String(summary.sourceArchiveCount)],
  ['Generated assets', String(summary.generatedAssetCount)],
  ['Configs', String(summary.customConfigCount)],
  ['Install steps', String(summary.installStepCount)]
];
