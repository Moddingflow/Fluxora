import type {
  FluxoraDownloadEntry,
  FluxoraTaskbarProgressState
} from '../../../shared/fluxora-api';

const isPendingTransfer = (entry: FluxoraDownloadEntry): boolean =>
  !entry.hasResolvedFileName ||
  entry.transferState === 'queued' ||
  entry.transferState === 'downloading' ||
  entry.transferState === 'indexing';

const knownProgress = (items: readonly FluxoraDownloadEntry[]): number | undefined => {
  if (
    items.length === 0 ||
    items.some((entry) => !entry.hasKnownProgress || !Number.isFinite(entry.progressPercent))
  ) {
    return undefined;
  }

  return Math.round(
    items.reduce(
      (total, entry) => total + Math.max(0, Math.min(100, entry.progressPercent)),
      0
    ) / items.length
  );
};

export const taskbarDownloadProgress = (
  items: readonly FluxoraDownloadEntry[]
): FluxoraTaskbarProgressState => {
  const failed = items.filter(
    (entry) => entry.transferState === 'failed' && entry.canResume
  );
  if (failed.length > 0) {
    const failedProgress = knownProgress(failed);
    return failedProgress === undefined
      ? { status: 'error' }
      : { status: 'error', progress: failedProgress };
  }

  const pending = items.filter(isPendingTransfer);
  if (
    pending.some(
      (entry) => !entry.hasKnownProgress || !Number.isFinite(entry.progressPercent)
    )
  ) {
    return { status: 'indeterminate' };
  }

  const progress = knownProgress(pending) ?? 0;

  if (pending.length > 0) {
    return { status: 'normal', progress };
  }

  const paused = items.filter(
    (entry) => entry.transferState === 'paused' || entry.transferState === 'awaiting-decision'
  );
  if (paused.length > 0) {
    const pausedProgress = knownProgress(paused);
    return pausedProgress === undefined
      ? { status: 'paused' }
      : { status: 'paused', progress: pausedProgress };
  }

  return { status: 'none' };
};
