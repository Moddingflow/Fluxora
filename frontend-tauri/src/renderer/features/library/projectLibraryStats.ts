import type { FluxoraProject } from '../../../shared/fluxora-api';
import type { ProjectLibraryStats } from './LibraryHome';

export interface ProjectRuntimeSummary {
  projectId: string;
  modCount?: number;
  disabledModCount?: number;
  downloadsCount?: number;
}

const projectMetricKeys = {
  lastLaunch: ['lastLaunchedAt', 'lastLaunchAt', 'lastRunAt', 'lastOpenedAt', 'lastOpened'],
  size: ['sizeBytes', 'totalBytes', 'projectSizeBytes', 'installSizeBytes', 'diskSizeBytes'],
  mods: ['modCount', 'modsCount', 'installedModCount', 'totalMods'],
  disabledMods: ['disabledModCount', 'disabledMods', 'inactiveModCount'],
  downloads: ['downloadCount', 'downloadsCount', 'queuedDownloadCount']
} as const;

const isMetricRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const projectMetricSources = (project: FluxoraProject): Array<Record<string, unknown>> =>
  [project.projectFingerprint, project.gameHealthSummary, project.contentLayoutSummary].filter(
    isMetricRecord
  );

const readNumberMetric = (
  project: FluxoraProject,
  keys: readonly string[]
): number | null => {
  for (const source of projectMetricSources(project)) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, value);
      }

      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return Math.max(0, parsed);
        }
      }
    }
  }

  return null;
};

const readTextMetric = (
  project: FluxoraProject,
  keys: readonly string[]
): string | null => {
  for (const source of projectMetricSources(project)) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }

  return null;
};

const formatOptionalCount = (value: number | null | undefined): string =>
  Number.isFinite(value) ? String(value) : '-';

const formatProjectBytes = (value: number | null): string => {
  if (!value || value <= 0) {
    return '-';
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const kilobytes = value / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 10 ? 0 : 1)} KB`;
  }

  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) {
    return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
  }

  const gigabytes = megabytes / 1024;
  return `${gigabytes.toFixed(gigabytes >= 10 ? 1 : 2)} GB`;
};

const formatProjectDate = (value: string | null): string => {
  if (!value) {
    return 'Not tracked';
  }

  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10000000000 ? numeric * 1000 : numeric)
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  }).format(date);
};

export const buildProjectLibraryStats = (
  project: FluxoraProject,
  runtime?: ProjectRuntimeSummary
): ProjectLibraryStats => {
  const matchingRuntime = runtime?.projectId === project.id ? runtime : undefined;

  return {
    lastLaunch: formatProjectDate(readTextMetric(project, projectMetricKeys.lastLaunch)),
    size: formatProjectBytes(readNumberMetric(project, projectMetricKeys.size)),
    mods: formatOptionalCount(
      matchingRuntime?.modCount ?? readNumberMetric(project, projectMetricKeys.mods)
    ),
    disabledMods: formatOptionalCount(
      matchingRuntime?.disabledModCount ?? readNumberMetric(project, projectMetricKeys.disabledMods)
    ),
    downloads: formatOptionalCount(
      matchingRuntime?.downloadsCount ?? readNumberMetric(project, projectMetricKeys.downloads)
    )
  };
};
