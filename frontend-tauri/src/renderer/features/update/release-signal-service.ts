import type { FluxoraUpdateStatus } from '../../../shared/fluxora-api';
import {
  compareStrictSemver,
  parseFluxoraReleaseAnnouncement,
  type FluxoraReleaseAnnouncement
} from './release-signal-contract';

export const releaseSignalRetryTargetsMs = [0, 2_000, 5_000, 15_000, 30_000, 60_000] as const;

export interface FluxoraReleaseSignalHandlers {
  onAnnouncement: (value: unknown) => void;
  onSubscribed: () => void;
}

export interface FluxoraReleaseSignalSource {
  getLatest: () => Promise<unknown | null>;
  subscribe: (handlers: FluxoraReleaseSignalHandlers) => () => void;
}

export interface FluxoraReleaseSignalServiceOptions {
  checkSignedManifest: (
    announcement: FluxoraReleaseAnnouncement
  ) => Promise<FluxoraUpdateStatus | null>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  getNativeStatus: () => FluxoraUpdateStatus;
  now?: () => number;
  scheduleTimer?: (
    listener: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout>;
  source: FluxoraReleaseSignalSource;
}

export interface FluxoraReleaseSignalService {
  start: () => void;
  stop: () => void;
}

const blockingStates = new Set<FluxoraUpdateStatus['state']>([
  'downloading',
  'waitingForOperations',
  'readyToInstall',
  'launchingUpdater'
]);

const statusStopsBurst = (
  status: FluxoraUpdateStatus,
  announcement: FluxoraReleaseAnnouncement
): boolean => {
  if (blockingStates.has(status.state)) return true;
  const currentComparison = compareStrictSemver(
    status.currentVersion,
    announcement.version
  );
  if (currentComparison !== null && currentComparison >= 0) return true;
  if (status.state !== 'available' || !status.availableVersion) return false;
  const availableComparison = compareStrictSemver(
    status.availableVersion,
    announcement.version
  );
  return availableComparison !== null && availableComparison >= 0;
};

export const createFluxoraReleaseSignalService = ({
  checkSignedManifest,
  clearTimer = clearTimeout,
  getNativeStatus,
  now = Date.now,
  scheduleTimer = setTimeout,
  source
}: FluxoraReleaseSignalServiceOptions): FluxoraReleaseSignalService => {
  let started = false;
  let unsubscribe: (() => void) | null = null;
  let activeTimer: ReturnType<typeof setTimeout> | null = null;
  let burstGeneration = 0;
  let newestAnnouncement: FluxoraReleaseAnnouncement | null = null;
  const seenReleaseIds = new Set<string>();
  const seenVersions = new Set<string>();

  const cancelBurst = () => {
    burstGeneration += 1;
    if (activeTimer !== null) clearTimer(activeTimer);
    activeTimer = null;
  };

  const startBurst = (announcement: FluxoraReleaseAnnouncement) => {
    cancelBurst();
    if (statusStopsBurst(getNativeStatus(), announcement)) return;
    const generation = burstGeneration;
    const startedAt = now();

    const runAttempt = async (attemptIndex: number): Promise<void> => {
      if (
        !started ||
        generation !== burstGeneration ||
        newestAnnouncement !== announcement ||
        statusStopsBurst(getNativeStatus(), announcement)
      ) {
        return;
      }

      let result: FluxoraUpdateStatus | null = null;
      try {
        result = await checkSignedManifest(announcement);
      } catch {
        // Polling remains the fallback; retry only within this bounded burst.
      }
      if (
        !started ||
        generation !== burstGeneration ||
        newestAnnouncement !== announcement ||
        statusStopsBurst(result ?? getNativeStatus(), announcement)
      ) {
        return;
      }

      const nextAttemptIndex = attemptIndex + 1;
      if (nextAttemptIndex >= releaseSignalRetryTargetsMs.length) return;
      const elapsedMs = Math.max(0, now() - startedAt);
      const delayMs = Math.max(
        0,
        releaseSignalRetryTargetsMs[nextAttemptIndex] - elapsedMs
      );
      activeTimer = scheduleTimer(() => {
        activeTimer = null;
        void runAttempt(nextAttemptIndex);
      }, delayMs);
    };

    void runAttempt(0);
  };

  const acceptAnnouncement = (value: unknown) => {
    if (!started) return;
    const announcement = parseFluxoraReleaseAnnouncement(value);
    if (!announcement) return;
    if (
      seenReleaseIds.has(announcement.githubReleaseId) ||
      seenVersions.has(announcement.version)
    ) {
      return;
    }
    if (newestAnnouncement) {
      const comparison = compareStrictSemver(
        announcement.version,
        newestAnnouncement.version
      );
      if (comparison === null || comparison <= 0) return;
    }

    seenReleaseIds.add(announcement.githubReleaseId);
    seenVersions.add(announcement.version);
    newestAnnouncement = announcement;
    startBurst(announcement);
  };

  const snapshotLatest = () => {
    void source.getLatest()
      .then((value) => acceptAnnouncement(value))
      .catch(() => undefined);
  };

  return {
    start: () => {
      if (started) return;
      started = true;
      unsubscribe = source.subscribe({
        onAnnouncement: acceptAnnouncement,
        onSubscribed: snapshotLatest
      });
    },
    stop: () => {
      if (!started) return;
      started = false;
      cancelBurst();
      unsubscribe?.();
      unsubscribe = null;
    }
  };
};
