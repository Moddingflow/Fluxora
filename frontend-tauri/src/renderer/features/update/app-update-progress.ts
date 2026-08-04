import type { FluxoraUpdateStatus } from '../../../shared/fluxora-api';

export interface AppUpdateProgressSnapshot {
  downloadPercent: number;
  installPercent: number;
}

const boundedPercent = (value: number): number =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

export const projectAppUpdateProgress = (
  status: FluxoraUpdateStatus
): AppUpdateProgressSnapshot => {
  if (
    status.state === 'waitingForOperations'
    || status.state === 'readyToInstall'
    || status.state === 'launchingUpdater'
  ) {
    return { downloadPercent: 100, installPercent: 0 };
  }

  const bytePercent = status.totalBytes && status.totalBytes > 0
    ? (status.downloadedBytes ?? 0) / status.totalBytes * 100
    : 0;
  return {
    downloadPercent: boundedPercent(status.progressPercent ?? bytePercent),
    installPercent: 0
  };
};

export interface DownloadSpeedSampler {
  sample: (downloadedBytes: number, nowMs: number) => number | undefined;
  reset: () => void;
}

export const createDownloadSpeedSampler = (): DownloadSpeedSampler => {
  let previousBytes: number | undefined;
  let previousTimeMs: number | undefined;

  return {
    sample: (downloadedBytes, nowMs) => {
      const bytes = Math.max(0, downloadedBytes);
      if (
        previousBytes === undefined
        || previousTimeMs === undefined
        || bytes < previousBytes
        || nowMs <= previousTimeMs
      ) {
        previousBytes = bytes;
        previousTimeMs = nowMs;
        return undefined;
      }
      const bytesPerSecond = (bytes - previousBytes) / (nowMs - previousTimeMs) * 1_000;
      previousBytes = bytes;
      previousTimeMs = nowMs;
      return Math.max(0, bytesPerSecond);
    },
    reset: () => {
      previousBytes = undefined;
      previousTimeMs = undefined;
    }
  };
};
