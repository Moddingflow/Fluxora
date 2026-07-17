import type {
  FluxoraBuildPathSettings,
  FluxoraBuildPathSettingsSaveRequest,
  FluxoraExecutable,
  FluxoraFluxPackSummary,
  FluxoraInstalledMod,
  FluxoraProject,
  NativeBridgeStatus
} from '../shared/fluxora-api';

export interface BuildPathDraft extends FluxoraBuildPathSettingsSaveRequest {
  projectDirectory: string;
  gameExecutablePath: string;
  downloadsDirectory: string;
}

export interface BuildActionAvailability {
  available: boolean;
  reason: string;
}

export interface BuildHeaderCapabilityView {
  packageAvailable: boolean;
  packageReason: string;
  refreshAvailable: boolean;
  refreshReason: string;
  settingsAvailable: boolean;
  settingsReason: string;
}

export interface NgioGrassCacheActionView {
  visible: boolean;
  available: boolean;
  reason: string;
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
  overwriteDirectory: draft.overwriteDirectory.trim()
});

const enabledFeatureStates = new Set(['available', 'limited', 'runtime-shell']);

export const buildActionAvailability = (
  bridgeStatus: NativeBridgeStatus | null,
  featureIds: string[],
  label: string
): BuildActionAvailability => {
  if (!bridgeStatus?.ready) {
    return {
      available: false,
      reason: 'Native bridge is not ready.'
    };
  }

  const feature = featureIds
    .map((featureId) => bridgeStatus.capabilities?.features[featureId])
    .find(Boolean);

  if (!feature) {
    return {
      available: true,
      reason: ''
    };
  }

  if (enabledFeatureStates.has(feature.state)) {
    return {
      available: true,
      reason: ''
    };
  }

  return {
    available: false,
    reason: feature.reason || `${label} is not available in this bridge build.`
  };
};

export const buildHeaderCapabilityView = (
  bridgeStatus: NativeBridgeStatus | null
): BuildHeaderCapabilityView => {
  const packageAction = buildActionAvailability(
    bridgeStatus,
    ['fluxPackExport', 'fluxPack'],
    'FluxPack export'
  );
  const refreshAction = buildActionAvailability(
    bridgeStatus,
    ['modsCheckUpdates', 'mods'],
    'Mod update checks'
  );
  const settingsAction = buildActionAvailability(
    bridgeStatus,
    ['buildPathsSave', 'buildPaths'],
    'Build settings'
  );

  return {
    packageAvailable: packageAction.available,
    packageReason: packageAction.reason,
    refreshAvailable: refreshAction.available,
    refreshReason: refreshAction.reason,
    settingsAvailable: settingsAction.available,
    settingsReason: settingsAction.reason
  };
};

const isSkyrimProject = (project: FluxoraProject | null): boolean => {
  if (!project) {
    return false;
  }

  return [
    project.templateId,
    project.uiTemplateId,
    project.gameName,
    project.template?.id,
    project.template?.gameName,
    project.template?.uiTemplateId
  ]
    .filter(Boolean)
    .some((value) => /skyrim/i.test(String(value)));
};

const modLooksLikeNgio = (mod: Pick<FluxoraInstalledMod, 'id' | 'name'>): boolean => {
  const normalized = `${mod.name} ${mod.id}`.replace(/[_-]+/g, ' ');
  return /\bno\s*grass\s*in\s*objects\b/i.test(normalized) ||
    /\bngio\b/i.test(normalized) ||
    /grass\s*control/i.test(normalized);
};

export const ngioGrassCacheActionView = (
  project: FluxoraProject | null,
  installedMods: ReadonlyArray<Pick<FluxoraInstalledMod, 'id' | 'name' | 'isEnabled'>>,
  bridgeStatus: NativeBridgeStatus | null
): NgioGrassCacheActionView => {
  if (!isSkyrimProject(project)) {
    return {
      visible: false,
      available: false,
      reason: ''
    };
  }

  const hasEnabledNgio = installedMods.some((mod) => mod.isEnabled && modLooksLikeNgio(mod));
  if (!hasEnabledNgio) {
    return {
      visible: false,
      available: false,
      reason: ''
    };
  }

  const availability = buildActionAvailability(
    bridgeStatus,
    ['grassCacheGeneration', 'grassCache'],
    'NGIO grass cache generation'
  );
  return {
    visible: true,
    available: availability.available,
    reason: availability.reason
  };
};

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

const formatFluxPackBytes = (bytes: number | undefined): string => {
  if (!Number.isFinite(bytes) || (bytes ?? 0) <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes ?? 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
};

const fluxPackCompressionLabel = (mode: FluxoraFluxPackSummary['compressionMode']): string => {
  if (mode === 'fast') return 'Быстро';
  if (mode === 'smallest') return 'Минимальный размер';
  if (mode === 'optimal') return 'Оптимально';
  return 'Без сжатия';
};

export const fluxPackSummaryFacts = (summary: FluxoraFluxPackSummary): Array<[string, string]> => [
  ['Build', summary.buildName || '-'],
  ['Format', String(summary.formatVersion)],
  ['Package type', summary.packageType === 'full' ? 'Полная' : 'Рецепт'],
  ['Compression', fluxPackCompressionLabel(summary.compressionMode)],
  ['Stored', formatFluxPackBytes(summary.storedPayloadBytes)],
  ['Deduplicated', formatFluxPackBytes(summary.deduplicatedPayloadBytes)],
  ['Chunks', String(summary.uniqueChunkCount ?? 0)],
  ['Sources', String(summary.sourceArchiveCount)],
  ['Bundled mods', String(summary.bundledModCount ?? 0)],
  ['Generated assets', String(summary.generatedAssetCount)],
  ['Configs', String(summary.customConfigCount)],
  ['Install steps', String(summary.installStepCount)]
];
