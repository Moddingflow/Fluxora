import type {
  FluxoraBuildPathSettings,
  FluxoraBuildPathSettingsSaveRequest,
  FluxoraExecutable,
  FluxoraFluxPackSummary,
  FluxoraInstalledMod,
  FluxoraProject,
  NativeBridgeStatus
} from '../shared/fluxora-api';
import { translateForLanguage } from '../localization';

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
  platform: NodeJS.Platform | 'unknown',
  language?: string | null
): string | null => {
  if (!draft.projectDirectory.trim()) {
    return translateForLanguage(language, 'build.paths.required', {
      field: translateForLanguage(language, 'build.paths.project')
    });
  }

  if (!draft.gameExecutablePath.trim()) {
    return translateForLanguage(language, 'build.paths.required', {
      field: translateForLanguage(language, 'build.paths.gameExecutable')
    });
  }

  if (platform === 'win32' && !pathLooksLikeWindowsExecutable(draft.gameExecutablePath)) {
    return translateForLanguage(language, 'build.paths.windowsExecutable');
  }

  for (const [key, value] of [
    ['build.paths.gameDirectory', draft.gameDirectory],
    ['build.paths.mods', draft.modsDirectory],
    ['build.paths.profiles', draft.profilesDirectory],
    ['build.paths.downloads', draft.downloadsDirectory],
    ['build.paths.overwrite', draft.overwriteDirectory]
  ] as const) {
    if (!value.trim()) {
      return translateForLanguage(language, 'build.paths.required', {
        field: translateForLanguage(language, key)
      });
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
  label: string,
  language?: string | null
): BuildActionAvailability => {
  if (!bridgeStatus?.ready) {
    return {
      available: false,
      reason: translateForLanguage(language, 'capability.bridgeNotReady')
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
    reason: feature.reason || translateForLanguage(language, 'capability.unavailableInBridge', {
      feature: label
    })
  };
};

export const buildHeaderCapabilityView = (
  bridgeStatus: NativeBridgeStatus | null,
  language?: string | null
): BuildHeaderCapabilityView => {
  const packageAction = buildActionAvailability(
    bridgeStatus,
    ['fluxPackExport', 'fluxPack'],
    translateForLanguage(language, 'capability.fluxPackExport'),
    language
  );
  const refreshAction = buildActionAvailability(
    bridgeStatus,
    ['modsCheckUpdates', 'mods'],
    translateForLanguage(language, 'capability.modUpdateChecks'),
    language
  );
  const settingsAction = buildActionAvailability(
    bridgeStatus,
    ['buildPathsSave', 'buildPaths'],
    translateForLanguage(language, 'build.settings'),
    language
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
  bridgeStatus: NativeBridgeStatus | null,
  language?: string | null
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
    translateForLanguage(language, 'capability.ngioGrassCache'),
    language
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

const fluxPackCompressionLabel = (
  mode: FluxoraFluxPackSummary['compressionMode'],
  language: string
): string => {
  if (mode === 'fast') return translateForLanguage(language, 'fluxpack.summary.compression.fast');
  if (mode === 'smallest') return translateForLanguage(language, 'fluxpack.summary.compression.smallest');
  if (mode === 'optimal') return translateForLanguage(language, 'fluxpack.summary.compression.optimal');
  return translateForLanguage(language, 'fluxpack.summary.compression.none');
};

export const fluxPackSummaryFacts = (
  summary: FluxoraFluxPackSummary,
  language = 'en-US'
): Array<[string, string]> => [
  [translateForLanguage(language, 'fluxpack.summary.build'), summary.buildName || '-'],
  [translateForLanguage(language, 'fluxpack.summary.format'), String(summary.formatVersion)],
  [translateForLanguage(language, 'fluxpack.summary.packageType'), summary.packageType === 'full'
    ? translateForLanguage(language, 'fluxpack.summary.package.full')
    : translateForLanguage(language, 'fluxpack.summary.package.recipe')],
  [translateForLanguage(language, 'fluxpack.summary.compression'), fluxPackCompressionLabel(summary.compressionMode, language)],
  [translateForLanguage(language, 'fluxpack.summary.stored'), formatFluxPackBytes(summary.storedPayloadBytes)],
  [translateForLanguage(language, 'fluxpack.summary.deduplicated'), formatFluxPackBytes(summary.deduplicatedPayloadBytes)],
  [translateForLanguage(language, 'fluxpack.summary.chunks'), String(summary.uniqueChunkCount ?? 0)],
  [translateForLanguage(language, 'fluxpack.summary.sources'), String(summary.sourceArchiveCount)],
  [translateForLanguage(language, 'fluxpack.summary.bundledMods'), String(summary.bundledModCount ?? 0)],
  [translateForLanguage(language, 'fluxpack.summary.generatedAssets'), String(summary.generatedAssetCount)],
  [translateForLanguage(language, 'fluxpack.summary.configs'), String(summary.customConfigCount)],
  [translateForLanguage(language, 'fluxpack.summary.installSteps'), String(summary.installStepCount)]
];
