import { describe, expect, it } from 'vitest';

import { createFluxoraAiTaskPlanningBundle } from '../src/shared/ai-task-planner';

describe('AI task planner and subagent scheduler', () => {
  it('splits a 20-mod compatibility check into web, build, analysis and report agents', () => {
    const { subagentSchedule, taskPlan } = createFluxoraAiTaskPlanningBundle(
      'Проверь совместимость этих 20 модов с Nexus dependencies',
      'op_ai_plan_compat',
      new Date('2026-06-30T08:00:00Z')
    );

    expect(taskPlan.schema).toBe('fluxora.ai.task-plan.v1');
    expect(taskPlan.goal).toContain('web/build/analysis/report agents');
    expect(taskPlan.selectedSkill?.selectedSkillId).toBe('nexus-compatibility-check');
    expect(taskPlan.selectedSkill?.selectedSkill?.displayName).toBe('Nexus compatibility check');
    expect(taskPlan.proposedMutations).toEqual([]);
    expect(taskPlan.readSteps.map((step) => step.agentId)).toEqual([
      'web-research',
      'build-state',
      'compatibility-analysis',
      'report'
    ]);
    expect(subagentSchedule.schema).toBe('fluxora.ai.subagent-schedule.v1');
    expect(subagentSchedule.defaultSubagentLimit).toBe(3);
    expect(subagentSchedule.maxSubagentsForLargeTasks).toBe(10);
    expect(subagentSchedule.requestedSubagentCount).toBe(6);
    expect(subagentSchedule.scheduledSubagents.map((agent) => agent.id)).toEqual(
      expect.arrayContaining([
        'web-research',
        'build-state',
        'compatibility-analysis',
        'report'
      ])
    );
  });

  it('returns a basic build plan with queued approvals before any mutation', () => {
    const { subagentSchedule, taskPlan } = createFluxoraAiTaskPlanningBundle(
      'Подготовь базовую сборку Skyrim',
      'op_ai_plan_build',
      new Date('2026-06-30T08:05:00Z')
    );

    expect(taskPlan.review.status).toBe('needs-approval');
    expect(taskPlan.selectedSkill?.selectedSkillId).toBe('skyrim-basic-build-setup');
    expect(taskPlan.selectedSkill?.policy.skillCanGrantNewTools).toBe(false);
    expect(taskPlan.proposedMutations.map((mutation) => mutation.toolName)).toEqual([
      'projects.create',
      'projects.rename',
      'profiles.create',
      'mods.createSeparator',
      'mods.setEnabled',
      'mods.moveOrderItem',
      'downloads.importFile',
      'downloads.install',
      'mods.deleteInstalled'
    ]);
    expect(taskPlan.proposedMutations.every((mutation) => mutation.requiresApproval)).toBe(true);
    expect(taskPlan.proposedMutations.every((mutation) => mutation.queued)).toBe(true);
    expect(taskPlan.proposedMutations.every((mutation) => mutation.executorQueueId === 'ai-write-executor')).toBe(true);
    expect(taskPlan.proposedMutations.every((mutation) => mutation.hidden === false)).toBe(true);
    expect(taskPlan.proposedMutations.find((mutation) => mutation.toolName === 'mods.deleteInstalled')).toMatchObject({
      approvalMode: 'step-by-step',
      permissionClass: 'destructive'
    });
    expect(subagentSchedule.planReviewAgent.status).toBe('needs-approval');
    expect(subagentSchedule.executorQueue.writeActionsOnlyThroughQueue).toBe(true);
    expect(subagentSchedule.executorQueue.maxConcurrentMutations).toBe(1);
    expect(subagentSchedule.executorQueue.hiddenDestructiveActions).toBe(false);
  });

  it('keeps destructive work visible and sequential instead of parallel hidden mutations', () => {
    const { subagentSchedule, taskPlan } = createFluxoraAiTaskPlanningBundle(
      'Удалить старые моды из сборки',
      'op_ai_plan_delete',
      new Date('2026-06-30T08:10:00Z')
    );

    expect(taskPlan.proposedMutations[0]).toMatchObject({
      permissionClass: 'destructive',
      approvalMode: 'step-by-step',
      requiresApproval: true,
      queued: true,
      hidden: false
    });
    expect(subagentSchedule.executorQueue.hiddenDestructiveActions).toBe(false);
    expect(subagentSchedule.executorQueue.destructiveApprovalMode).toBe('step-by-step');
    expect(subagentSchedule.askUserOnlyIfBlocked).toBe(true);
    expect(subagentSchedule.longRunningProgress.finalAnswerAfterVerificationOrBlocked).toBe(true);
  });
});
