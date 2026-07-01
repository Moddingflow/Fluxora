import type { FluxoraAiTaskPlanningBundle } from '../../../shared/ai-task-planner';
import type {
  FluxoraAiAutonomousJob,
  FluxoraAiAutonomousJobBlockedReason,
  FluxoraAiAutonomousJobCheckpoint,
  FluxoraAiAutonomousJobProgressEvent,
  FluxoraAiAutonomousJobQueue,
  FluxoraAiTaskPlan,
  FluxoraAiSubagentSchedule
} from '../../../shared/fluxora-api';
import type { AiRun, AiSession } from './ai-chat-state';

export interface AiAutonomousJobStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface AiAutonomousJobCreateOptions {
  modelId?: string;
  modelSupportsBackground?: boolean;
  now?: Date;
  providerId?: string;
}

export const AI_AUTONOMOUS_JOB_QUEUE_STORAGE_PREFIX =
  'fluxora.ai.autonomous.job.queue.v1';

export const AI_AUTONOMOUS_JOB_PROGRESS_EVENT_LIMIT = 80;
export const AI_AUTONOMOUS_JOB_HEARTBEAT_INTERVAL_MS = 15_000;
export const AI_AUTONOMOUS_JOB_STALE_AFTER_MS = 45_000;

export const AI_AUTONOMOUS_JOB_BLOCKED_REASONS: FluxoraAiAutonomousJobBlockedReason[] = [
  'user',
  'login',
  'captcha',
  'missing-file',
  'permission',
  'budget'
];

const iso = (now = new Date()) => now.toISOString();

const compactIdTime = (now = new Date()) => now.toISOString().replace(/[-:.TZ]/g, '');

const randomSuffix = () => Math.random().toString(36).slice(2, 8);

const jobId = (operationId: string, now = new Date()) =>
  `ai-job-${operationId}-${compactIdTime(now)}-${randomSuffix()}`;

const eventId = (prefix: string, now = new Date()) =>
  `${prefix}-${compactIdTime(now)}-${randomSuffix()}`;

const normalizePercent = (percent: number) =>
  Math.max(0, Math.min(100, Math.round(percent)));

const heartbeatFor = (now = new Date(), sequence = 1): FluxoraAiAutonomousJob['heartbeat'] => ({
  sequence,
  sentAt: iso(now),
  deadlineAt: iso(new Date(now.getTime() + AI_AUTONOMOUS_JOB_STALE_AFTER_MS)),
  missed: false
});

const checkpoint = (
  title: string,
  summary: string,
  status: FluxoraAiAutonomousJobCheckpoint['status'],
  now = new Date()
): FluxoraAiAutonomousJobCheckpoint => ({
  id: eventId('ai-checkpoint', now),
  createdAt: iso(now),
  status,
  title,
  summary
});

const progressEvent = (
  stage: string,
  message: string,
  percent: number,
  now = new Date()
): FluxoraAiAutonomousJobProgressEvent => ({
  id: eventId('ai-progress', now),
  createdAt: iso(now),
  stage,
  message,
  percent: normalizePercent(percent),
  internal: true
});

const withUpdatedAt = (
  job: FluxoraAiAutonomousJob,
  now = new Date()
): FluxoraAiAutonomousJob => ({
  ...job,
  updatedAt: iso(now)
});

const appendProgress = (
  job: FluxoraAiAutonomousJob,
  event: FluxoraAiAutonomousJobProgressEvent,
  now = new Date()
): FluxoraAiAutonomousJob => ({
  ...withUpdatedAt(job, now),
  currentStage: event.stage,
  percent: event.percent,
  progressEvents: [...job.progressEvents, event].slice(-AI_AUTONOMOUS_JOB_PROGRESS_EVENT_LIMIT)
});

export const aiAutonomousJobQueueStorageKey = (scopeKey: string): string =>
  `${AI_AUTONOMOUS_JOB_QUEUE_STORAGE_PREFIX}.${scopeKey}`;

export const createAiAutonomousJobQueue = (
  scopeKey: string,
  now = new Date()
): FluxoraAiAutonomousJobQueue => ({
  schema: 'fluxora.ai.autonomous-job-queue.v1',
  scopeKey,
  updatedAt: iso(now),
  jobs: []
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isPersistedAutonomousJobQueue = (
  value: unknown
): value is FluxoraAiAutonomousJobQueue =>
  isRecord(value) &&
  value.schema === 'fluxora.ai.autonomous-job-queue.v1' &&
  typeof value.scopeKey === 'string' &&
  typeof value.updatedAt === 'string' &&
  Array.isArray(value.jobs);

export const loadAiAutonomousJobQueue = (
  storage: AiAutonomousJobStorage | undefined,
  scopeKey: string,
  now = new Date()
): FluxoraAiAutonomousJobQueue => {
  if (!storage) {
    return createAiAutonomousJobQueue(scopeKey, now);
  }

  const stored = storage.getItem(aiAutonomousJobQueueStorageKey(scopeKey));
  if (!stored) {
    return createAiAutonomousJobQueue(scopeKey, now);
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (isPersistedAutonomousJobQueue(parsed)) {
      return {
        ...parsed,
        jobs: parsed.jobs.filter((job) => job.schema === 'fluxora.ai.autonomous-job.v1')
      };
    }
  } catch {
    return createAiAutonomousJobQueue(scopeKey, now);
  }

  return createAiAutonomousJobQueue(scopeKey, now);
};

export const saveAiAutonomousJobQueue = (
  storage: AiAutonomousJobStorage | undefined,
  queue: FluxoraAiAutonomousJobQueue
): void => {
  storage?.setItem(aiAutonomousJobQueueStorageKey(queue.scopeKey), JSON.stringify(queue));
};

export const upsertAiAutonomousJob = (
  queue: FluxoraAiAutonomousJobQueue,
  job: FluxoraAiAutonomousJob,
  now = new Date()
): FluxoraAiAutonomousJobQueue => {
  const existingIndex = queue.jobs.findIndex((candidate) => candidate.id === job.id);
  const jobs =
    existingIndex >= 0
      ? queue.jobs.map((candidate, index) => (index === existingIndex ? job : candidate))
      : [...queue.jobs, job];

  return {
    ...queue,
    updatedAt: iso(now),
    jobs
  };
};

export const createAiAutonomousJob = (
  run: Pick<AiRun, 'id' | 'operationId'>,
  session: Pick<AiSession, 'buildLabel' | 'id' | 'scopeKey'>,
  planning: FluxoraAiTaskPlanningBundle,
  options: AiAutonomousJobCreateOptions = {}
): FluxoraAiAutonomousJob => {
  const now = options.now ?? new Date();
  const createdAt = iso(now);
  const modelSupportsBackground = options.modelSupportsBackground === true;

  return {
    schema: 'fluxora.ai.autonomous-job.v1',
    id: jobId(run.operationId, now),
    sessionId: session.id,
    scopeKey: session.scopeKey,
    buildLabel: session.buildLabel,
    runId: run.id,
    operationId: run.operationId,
    goal: planning.taskPlan.goal,
    state: 'queued',
    createdAt,
    updatedAt: createdAt,
    ...(options.modelId ? { modelId: options.modelId } : {}),
    ...(options.providerId ? { providerId: options.providerId } : {}),
    backgroundMode: modelSupportsBackground ? 'provider-background' : 'local-resumable',
    providerBackgroundMode: modelSupportsBackground ? 'available' : 'unavailable',
    currentStage: 'queued',
    percent: 0,
    heartbeat: heartbeatFor(now),
    watchdog: {
      heartbeatIntervalMs: AI_AUTONOMOUS_JOB_HEARTBEAT_INTERVAL_MS,
      staleAfterMs: AI_AUTONOMOUS_JOB_STALE_AFTER_MS,
      missedHeartbeats: 0,
      lastCheckedAt: createdAt
    },
    checkpoints: [
      checkpoint(
        'Job queued',
        'Persistent autonomous job was queued before provider work started.',
        'completed',
        now
      )
    ],
    progressEvents: [
      progressEvent(
        'queued',
        'AI job queued with persistent plan and operation correlation.',
        0,
        now
      )
    ],
    pauseRequested: false,
    cancellationRequested: false,
    taskPlan: planning.taskPlan,
    subagentSchedule: planning.subagentSchedule,
    policy: {
      checkpointAfterEveryMajorStep: true,
      cancellationSupported: true,
      pauseSupported: true,
      streamInternalProgress: true,
      blockOnlyForAllowedReasons: true,
      allowedBlockedReasons: AI_AUTONOMOUS_JOB_BLOCKED_REASONS,
      finalReportAfterVerification: true
    }
  };
};

export const attachAiAutonomousJobPlan = (
  job: FluxoraAiAutonomousJob,
  taskPlan: FluxoraAiTaskPlan | null | undefined,
  subagentSchedule: FluxoraAiSubagentSchedule | null | undefined,
  now = new Date()
): FluxoraAiAutonomousJob =>
  taskPlan && subagentSchedule
    ? {
        ...withUpdatedAt(job, now),
        goal: taskPlan.goal,
        taskPlan,
        subagentSchedule
      }
    : job;

export const startAiAutonomousJob = (
  job: FluxoraAiAutonomousJob,
  now = new Date()
): FluxoraAiAutonomousJob =>
  appendProgress(
    {
      ...job,
      state: 'running',
      pauseRequested: false,
      heartbeat: heartbeatFor(now, job.heartbeat.sequence + 1)
    },
    progressEvent('running', 'Background run started.', 5, now),
    now
  );

export const recordAiAutonomousProgress = (
  job: FluxoraAiAutonomousJob,
  stage: string,
  message: string,
  percent: number,
  now = new Date()
): FluxoraAiAutonomousJob =>
  appendProgress(job, progressEvent(stage, message, percent, now), now);

export const checkpointAiAutonomousJob = (
  job: FluxoraAiAutonomousJob,
  title: string,
  summary: string,
  now = new Date()
): FluxoraAiAutonomousJob => ({
  ...withUpdatedAt(job, now),
  checkpoints: [...job.checkpoints, checkpoint(title, summary, 'completed', now)]
});

export const heartbeatAiAutonomousJob = (
  job: FluxoraAiAutonomousJob,
  now = new Date()
): FluxoraAiAutonomousJob => ({
  ...withUpdatedAt(job, now),
  heartbeat: heartbeatFor(now, job.heartbeat.sequence + 1),
  watchdog: {
    ...job.watchdog,
    lastCheckedAt: iso(now)
  }
});

export const watchdogAiAutonomousJob = (
  job: FluxoraAiAutonomousJob,
  now = new Date()
): FluxoraAiAutonomousJob => {
  const deadline = new Date(job.heartbeat.deadlineAt).getTime();
  if (!Number.isFinite(deadline) || now.getTime() <= deadline) {
    return {
      ...withUpdatedAt(job, now),
      watchdog: {
        ...job.watchdog,
        lastCheckedAt: iso(now)
      }
    };
  }

  return {
    ...withUpdatedAt(job, now),
    heartbeat: {
      ...job.heartbeat,
      missed: true
    },
    watchdog: {
      ...job.watchdog,
      lastCheckedAt: iso(now),
      missedHeartbeats: job.watchdog.missedHeartbeats + 1
    }
  };
};

export const pauseAiAutonomousJob = (
  job: FluxoraAiAutonomousJob,
  now = new Date()
): FluxoraAiAutonomousJob =>
  checkpointAiAutonomousJob(
    recordAiAutonomousProgress(
      {
        ...job,
        state: 'paused',
        pauseRequested: true
      },
      'paused',
      'Autonomous job paused by the user.',
      job.percent,
      now
    ),
    'Job paused',
    'The current plan and checkpoints were preserved for resume.',
    now
  );

export const resumeAiAutonomousJob = (
  job: FluxoraAiAutonomousJob,
  now = new Date()
): FluxoraAiAutonomousJob =>
  checkpointAiAutonomousJob(
    heartbeatAiAutonomousJob(
      recordAiAutonomousProgress(
        {
          ...job,
          state: 'queued',
          pauseRequested: false
        },
        'resume',
        'Autonomous job is queued to resume from the last checkpoint.',
        job.percent,
        now
      ),
      now
    ),
    'Job resumed',
    'The job will continue from persisted checkpoints.',
    now
  );

export const cancelAiAutonomousJob = (
  job: FluxoraAiAutonomousJob,
  now = new Date()
): FluxoraAiAutonomousJob =>
  checkpointAiAutonomousJob(
    recordAiAutonomousProgress(
      {
        ...job,
        state: 'cancelled',
        cancellationRequested: true
      },
      'cancelled',
      'Autonomous job cancellation was requested.',
      job.percent,
      now
    ),
    'Job cancelled',
    'The job stopped before final report generation.',
    now
  );

export const blockAiAutonomousJob = (
  job: FluxoraAiAutonomousJob,
  reason: FluxoraAiAutonomousJobBlockedReason,
  message: string,
  now = new Date()
): FluxoraAiAutonomousJob => {
  if (!job.policy.allowedBlockedReasons.includes(reason)) {
    throw new Error(`Unsupported autonomous job blocked reason: ${reason}`);
  }

  return checkpointAiAutonomousJob(
    recordAiAutonomousProgress(
      {
        ...job,
        state: 'blocked',
        blockedReason: reason,
        blockedMessage: message
      },
      'blocked',
      message,
      job.percent,
      now
    ),
    'Job blocked',
    message,
    now
  );
};

export const completeAiAutonomousJob = (
  job: FluxoraAiAutonomousJob,
  finalReport: string,
  now = new Date()
): FluxoraAiAutonomousJob =>
  checkpointAiAutonomousJob(
    recordAiAutonomousProgress(
      {
        ...job,
        state: 'completed',
        finalReport
      },
      'verification',
      'Final report produced after verification or clear terminal state.',
      100,
      now
    ),
    'Final report',
    'Verification gate completed before the final report was stored.',
    now
  );

export const recoverAiAutonomousJobAfterRestart = (
  job: FluxoraAiAutonomousJob,
  now = new Date()
): FluxoraAiAutonomousJob => {
  if (!['queued', 'running'].includes(job.state)) {
    return job;
  }

  return checkpointAiAutonomousJob(
    watchdogAiAutonomousJob(
      recordAiAutonomousProgress(
        {
          ...job,
          state: 'queued'
        },
        'resume-after-restart',
        'Fluxora restarted; the job plan and checkpoints were restored for resume.',
        job.percent,
        now
      ),
      now
    ),
    'Recovered after restart',
    'The persistent job queue kept the plan, progress, checkpoints and operation id.',
    now
  );
};

export const recoverAiAutonomousJobQueueAfterRestart = (
  queue: FluxoraAiAutonomousJobQueue,
  now = new Date()
): FluxoraAiAutonomousJobQueue => ({
  ...queue,
  updatedAt: iso(now),
  jobs: queue.jobs.map((job) => recoverAiAutonomousJobAfterRestart(job, now))
});

export const persistAiAutonomousJob = (
  storage: AiAutonomousJobStorage | undefined,
  job: FluxoraAiAutonomousJob,
  now = new Date()
): FluxoraAiAutonomousJobQueue | null => {
  if (!storage) {
    return null;
  }

  const queue = upsertAiAutonomousJob(
    loadAiAutonomousJobQueue(storage, job.scopeKey, now),
    job,
    now
  );
  saveAiAutonomousJobQueue(storage, queue);
  return queue;
};
