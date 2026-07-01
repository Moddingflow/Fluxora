import { describe, expect, it, vi } from 'vitest';

import {
  aiAutonomousJobQueueStorageKey,
  blockAiAutonomousJob,
  cancelAiAutonomousJob,
  checkpointAiAutonomousJob,
  completeAiAutonomousJob,
  createAiAutonomousJob,
  createAiAutonomousJobQueue,
  heartbeatAiAutonomousJob,
  loadAiAutonomousJobQueue,
  pauseAiAutonomousJob,
  persistAiAutonomousJob,
  recoverAiAutonomousJobQueueAfterRestart,
  recordAiAutonomousProgress,
  resumeAiAutonomousJob,
  saveAiAutonomousJobQueue,
  startAiAutonomousJob,
  watchdogAiAutonomousJob
} from '../src/renderer/features/ai/ai-autonomous-jobs';
import { createAiRunForPrompt, createAiSessionForScope } from '../src/renderer/features/ai/ai-chat-runtime';
import { createFluxoraAiTaskPlanningBundle } from '../src/shared/ai-task-planner';
import type { FluxoraAiAutonomousJobBlockedReason } from '../src/shared/fluxora-api';

const createMemoryStorage = () => {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values
  };
};

describe('AI autonomous job queue', () => {
  it('creates a persistent background job with checkpoints, heartbeat and provider capability state', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    const session = createAiSessionForScope(
      { buildLabel: 'Skyrim Main', projectId: 'skyrim-main' },
      new Date('2026-06-30T09:00:00Z')
    );
    const run = createAiRunForPrompt(
      session,
      'op_ai_long_job',
      'Проверь совместимость этих 20 модов',
      new Date('2026-06-30T09:00:01Z')
    );
    const planning = createFluxoraAiTaskPlanningBundle(
      'Проверь совместимость этих 20 модов',
      run.operationId,
      new Date('2026-06-30T09:00:02Z')
    );

    const job = createAiAutonomousJob(run, session, planning, {
      modelId: 'gemini-background',
      modelSupportsBackground: true,
      now: new Date('2026-06-30T09:00:03Z'),
      providerId: 'gemini'
    });

    expect(job.schema).toBe('fluxora.ai.autonomous-job.v1');
    expect(job.state).toBe('queued');
    expect(job.backgroundMode).toBe('provider-background');
    expect(job.providerBackgroundMode).toBe('available');
    expect(job.operationId).toBe('op_ai_long_job');
    expect(job.policy).toMatchObject({
      cancellationSupported: true,
      checkpointAfterEveryMajorStep: true,
      pauseSupported: true,
      streamInternalProgress: true,
      blockOnlyForAllowedReasons: true,
      finalReportAfterVerification: true
    });
    expect(job.policy.allowedBlockedReasons).toEqual([
      'user',
      'login',
      'captcha',
      'missing-file',
      'permission',
      'budget'
    ]);
    expect(job.heartbeat.deadlineAt).toBe('2026-06-30T09:00:48.000Z');
    expect(job.checkpoints[0]?.title).toBe('Job queued');
    expect(job.progressEvents[0]?.stage).toBe('queued');

    vi.restoreAllMocks();
  });

  it('persists and recovers queued/running jobs after restart without losing the operation id', () => {
    const storage = createMemoryStorage();
    const session = createAiSessionForScope(
      { buildLabel: 'Skyrim Main', projectId: 'skyrim-main' },
      new Date('2026-06-30T09:05:00Z')
    );
    const run = createAiRunForPrompt(
      session,
      'op_ai_resume',
      'long-running compatibility check',
      new Date('2026-06-30T09:05:01Z')
    );
    const job = startAiAutonomousJob(
      createAiAutonomousJob(
        run,
        session,
        createFluxoraAiTaskPlanningBundle(
          'long-running compatibility check',
          run.operationId,
          new Date('2026-06-30T09:05:02Z')
        ),
        { now: new Date('2026-06-30T09:05:03Z') }
      ),
      new Date('2026-06-30T09:05:04Z')
    );

    persistAiAutonomousJob(storage, job, new Date('2026-06-30T09:05:05Z'));
    const restored = recoverAiAutonomousJobQueueAfterRestart(
      loadAiAutonomousJobQueue(storage, session.scopeKey, new Date('2026-06-30T09:06:00Z')),
      new Date('2026-06-30T09:06:01Z')
    );
    saveAiAutonomousJobQueue(storage, restored);
    const stored = JSON.parse(
      storage.values.get(aiAutonomousJobQueueStorageKey(session.scopeKey)) ?? '{}'
    ) as { jobs: Array<{ operationId: string; state: string; checkpoints: Array<{ title: string }> }> };

    expect(restored.jobs[0]).toMatchObject({
      operationId: 'op_ai_resume',
      state: 'queued',
      currentStage: 'resume-after-restart'
    });
    expect(restored.jobs[0]?.checkpoints.map((checkpoint) => checkpoint.title)).toEqual(
      expect.arrayContaining(['Recovered after restart'])
    );
    expect(stored.jobs[0]?.operationId).toBe('op_ai_resume');
  });

  it('streams progress, checkpoints major steps and completes only with a final report', () => {
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_complete', 'run a long job');
    const job = createAiAutonomousJob(
      run,
      session,
      createFluxoraAiTaskPlanningBundle('run a long job', run.operationId)
    );
    const running = startAiAutonomousJob(job, new Date('2026-06-30T09:10:00Z'));
    const progressed = checkpointAiAutonomousJob(
      recordAiAutonomousProgress(
        running,
        'verification',
        'Verification agent is checking the result.',
        91,
        new Date('2026-06-30T09:10:10Z')
      ),
      'Verification checkpoint',
      'Verification evidence was stored before final report.',
      new Date('2026-06-30T09:10:11Z')
    );
    const completed = completeAiAutonomousJob(
      progressed,
      'Verified compatibility report.',
      new Date('2026-06-30T09:10:12Z')
    );

    expect(completed.state).toBe('completed');
    expect(completed.percent).toBe(100);
    expect(completed.finalReport).toBe('Verified compatibility report.');
    expect(completed.checkpoints.map((checkpoint) => checkpoint.title)).toEqual(
      expect.arrayContaining(['Verification checkpoint', 'Final report'])
    );
  });

  it('supports pause, resume and cancellation as explicit persistent states', () => {
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_pause', 'run a long job');
    const job = createAiAutonomousJob(
      run,
      session,
      createFluxoraAiTaskPlanningBundle('run a long job', run.operationId)
    );

    const paused = pauseAiAutonomousJob(job, new Date('2026-06-30T09:15:00Z'));
    const resumed = resumeAiAutonomousJob(paused, new Date('2026-06-30T09:16:00Z'));
    const cancelled = cancelAiAutonomousJob(resumed, new Date('2026-06-30T09:17:00Z'));

    expect(paused).toMatchObject({
      state: 'paused',
      pauseRequested: true
    });
    expect(resumed).toMatchObject({
      state: 'queued',
      pauseRequested: false
    });
    expect(cancelled).toMatchObject({
      state: 'cancelled',
      cancellationRequested: true
    });
    expect(cancelled.checkpoints.map((checkpoint) => checkpoint.title)).toEqual(
      expect.arrayContaining(['Job paused', 'Job resumed', 'Job cancelled'])
    );
  });

  it('allows blocked state only for user/login/captcha/missing-file/permission/budget reasons', () => {
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_blocked', 'run a long job');
    const job = createAiAutonomousJob(
      run,
      session,
      createFluxoraAiTaskPlanningBundle('run a long job', run.operationId)
    );

    const blocked = blockAiAutonomousJob(
      job,
      'captcha',
      'Nexus captcha requires user action.',
      new Date('2026-06-30T09:20:00Z')
    );

    expect(blocked).toMatchObject({
      state: 'blocked',
      blockedReason: 'captcha',
      blockedMessage: 'Nexus captcha requires user action.'
    });
    expect(() =>
      blockAiAutonomousJob(
        job,
        'network' as FluxoraAiAutonomousJobBlockedReason,
        'Unexpected reason',
        new Date('2026-06-30T09:20:01Z')
      )
    ).toThrow('Unsupported autonomous job blocked reason');
  });

  it('watchdog marks stale heartbeats without inventing a blocked reason', () => {
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_watchdog', 'run a long job');
    const job = heartbeatAiAutonomousJob(
      createAiAutonomousJob(
        run,
        session,
        createFluxoraAiTaskPlanningBundle('run a long job', run.operationId),
        { now: new Date('2026-06-30T09:25:00Z') }
      ),
      new Date('2026-06-30T09:25:01Z')
    );

    const fresh = watchdogAiAutonomousJob(job, new Date('2026-06-30T09:25:10Z'));
    const stale = watchdogAiAutonomousJob(job, new Date('2026-06-30T09:26:00Z'));

    expect(fresh.heartbeat.missed).toBe(false);
    expect(fresh.watchdog.missedHeartbeats).toBe(0);
    expect(stale.heartbeat.missed).toBe(true);
    expect(stale.watchdog.missedHeartbeats).toBe(1);
    expect(stale.state).toBe('queued');
    expect(stale.blockedReason).toBeUndefined();
  });

  it('keeps an empty persistent queue stable for scopes without jobs', () => {
    const queue = createAiAutonomousJobQueue('build-empty', new Date('2026-06-30T09:30:00Z'));

    expect(queue).toEqual({
      schema: 'fluxora.ai.autonomous-job-queue.v1',
      scopeKey: 'build-empty',
      updatedAt: '2026-06-30T09:30:00.000Z',
      jobs: []
    });
  });
});
