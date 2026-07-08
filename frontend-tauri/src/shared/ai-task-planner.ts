import type {
  FluxoraSkillSelection,
  FluxoraAiSubagentDescriptor,
  FluxoraAiSubagentSchedule,
  FluxoraAiTaskPlan,
  FluxoraAiTaskPlanStep,
  FluxoraAiTaskPermissionClass,
  FluxoraAiProposedMutation
} from './fluxora-api';
import type { AiSafeActionToolName } from './ai-safe-action-catalog';
import { selectFluxoraSkillForPrompt } from './ai-skills';

export interface FluxoraAiTaskPlanningBundle {
  selectedSkill: FluxoraSkillSelection;
  subagentSchedule: FluxoraAiSubagentSchedule;
  taskPlan: FluxoraAiTaskPlan;
}

type TaskKind =
  | 'requirement-audit'
  | 'compatibility-check'
  | 'build-preparation'
  | 'destructive-change'
  | 'general';

const DEFAULT_SUBAGENT_LIMIT = 3;
const MAX_SUBAGENTS_FOR_LARGE_TASKS = 5;

const normalizePrompt = (prompt: string): string => prompt.trim().replace(/\s+/g, ' ');

const includesAny = (value: string, needles: string[]): boolean =>
  needles.some((needle) => value.includes(needle));

const looksLarge = (prompt: string): boolean =>
  /\b(?:1[0-9]|[2-9][0-9])\b/.test(prompt) ||
  includesAny(prompt, ['large', 'big task', 'long-running', 'много', 'больш', 'долг']);

const REQUIREMENT_INTENT_SIGNALS = [
  'requirement',
  'requirements',
  'required mods',
  'dependency',
  'dependencies',
  'требован',
  'зависим',
  'вимог',
  'залежност',
  'wymag',
  'zależ',
  'anforder',
  'abhäng',
  'requisito',
  'dependencia',
  'exigence',
  'dépend',
  'dependência',
  'gereksin',
  'bağıml',
  'المتطلبات',
  'تبعيات',
  'आवश्यक',
  'निर्भर',
  '要求',
  '依赖',
  '要件',
  '依存',
  '요구',
  '종속'
] as const;

const classifyTask = (prompt: string): TaskKind => {
  const lower = normalizePrompt(prompt).toLowerCase();

  if (includesAny(lower, ['delete', 'remove', 'удали', 'удалить', 'снести'])) {
    return 'destructive-change';
  }

  if (
    includesAny(lower, [
      'basic build',
      'prepare build',
      'setup build',
      'подготовь базовую сборку',
      'создай базовую сборку',
      'собери базовую сборку'
    ])
  ) {
    return 'build-preparation';
  }

  if (includesAny(lower, [...REQUIREMENT_INTENT_SIGNALS])) {
    return 'requirement-audit';
  }

  if (
    includesAny(lower, [
      'compat',
      'compatibility',
      'nexus',
      '20 mods',
      '20 мод',
      'совместим'
    ])
  ) {
    return 'compatibility-check';
  }

  return 'general';
};

const createStep = (
  id: string,
  title: string,
  agentId: string,
  permissionClass: FluxoraAiTaskPermissionClass,
  summary: string,
  options: Partial<Pick<FluxoraAiTaskPlanStep, 'canRunInParallel' | 'dependsOn' | 'requiresApproval' | 'status' | 'toolName'>> = {}
): FluxoraAiTaskPlanStep => ({
  id,
  title,
  agentId,
  permissionClass,
  status: options.status ?? 'pending',
  requiresApproval: options.requiresApproval ?? false,
  canRunInParallel: options.canRunInParallel ?? true,
  summary,
  ...(options.dependsOn ? { dependsOn: options.dependsOn } : {}),
  ...(options.toolName ? { toolName: options.toolName } : {})
});

const createMutation = (
  id: string,
  title: string,
  summary: string,
  permissionClass: 'write' | 'destructive',
  rollbackNote: string,
  toolName?: AiSafeActionToolName,
  targetSummary?: string
): FluxoraAiProposedMutation => ({
  id,
  title,
  permissionClass,
  requiresApproval: true,
  approvalMode: permissionClass === 'destructive' ? 'step-by-step' : 'plan',
  queued: true,
  executorQueueId: 'ai-write-executor',
  hidden: false,
  summary,
  rollbackNote,
  ...(targetSummary ? { targetSummary } : {}),
  ...(toolName ? { toolName } : {})
});

const requirementAuditReadSteps = (): FluxoraAiTaskPlanStep[] => [
  createStep(
    'read-build-state',
    'Collect current build context',
    'build-state',
    'read',
    'Read installed mods, local Nexus target metadata, plugins, profiles, downloads, path status and recent operations before external research.',
    { toolName: 'build.context.read' }
  ),
  createStep(
    'inspect-installed-requirement-targets',
    'Inspect installed Nexus targets',
    'local-inspector',
    'read',
    'Identify installed Nexus gameDomain/modId/fileId values that can prove whether requirement mods are already present.',
    { dependsOn: ['read-build-state'], toolName: 'local.inspect' }
  ),
  createStep(
    'read-nexus-requirements',
    'Collect Nexus requirement evidence',
    'nexus-requirements',
    'external-network',
    'Use official Nexus API/cache requirement and file-version dependency evidence for the requested target or full build.',
    { dependsOn: ['inspect-installed-requirement-targets'], toolName: 'nexus.research' }
  ),
  createStep(
    'judge-requirement-coverage',
    'Judge requirement coverage',
    'requirement-judge',
    'plan',
    'Compare Nexus requirement facts with installed Nexus targets and preserve unknown, blocked or partial coverage states.',
    { dependsOn: ['inspect-installed-requirement-targets', 'read-nexus-requirements'] }
  ),
  createStep(
    'prepare-requirement-report',
    'Prepare requirements report',
    'report',
    'plan',
    'Answer only whether requirements are installed, missing, unknown or not fully checked, with coverage counts and source ids.',
    { dependsOn: ['judge-requirement-coverage'], canRunInParallel: false }
  )
];

const compatibilityReadSteps = (): FluxoraAiTaskPlanStep[] => [
  createStep(
    'read-build-state',
    'Collect current build context',
    'build-state',
    'read',
    'Read installed mods, plugins, downloads, profiles, operations, path status and recent logs before external research.',
    { toolName: 'build.context.read' }
  ),
  createStep(
    'inspect-local-evidence',
    'Inspect local compatibility evidence',
    'local-inspector',
    'read',
    'Check missing masters, failed operations, disabled dependencies, selected build state, bridge/path config, failed downloads/installs and concrete file-conflict evidence.',
    { dependsOn: ['read-build-state'], toolName: 'local.inspect' }
  ),
  createStep(
    'read-nexus-sources',
    'Investigate Nexus/API sources only if local evidence is insufficient',
    'nexus-research',
    'external-network',
    'Use Nexus API/cache after the AI host route decides external verification is needed.',
    { dependsOn: ['inspect-local-evidence'], toolName: 'nexus.research' }
  ),
  createStep(
    'read-web-sources',
    'Collect non-Nexus web sources only if still needed',
    'web-research',
    'external-network',
    'Use allowlisted non-Nexus web/search only after local and Nexus/API evidence cannot answer the question under policy.',
    { dependsOn: ['read-nexus-sources'], toolName: 'web.research' }
  ),
  createStep(
    'judge-compatibility',
    'Judge local and external evidence',
    'compatibility-judge',
    'plan',
    'Compare local findings, Nexus/API facts and any approved web evidence without mutating the build.',
    { dependsOn: ['inspect-local-evidence', 'read-nexus-sources', 'read-web-sources'] }
  ),
  createStep(
    'prepare-report',
    'Prepare cited compatibility report',
    'report',
    'plan',
    'Summarize findings, cite sources and separate confirmed facts from assumptions.',
    { dependsOn: ['judge-compatibility'], canRunInParallel: false }
  )
];

const buildPreparationReadSteps = (): FluxoraAiTaskPlanStep[] => [
  createStep(
    'read-build-templates',
    'Read project and template state',
    'build-state',
    'read',
    'Collect available templates, selected project state and profile/download summaries.',
    { toolName: 'build.context.read' }
  ),
  createStep(
    'draft-build-actions',
    'Draft basic build actions',
    'action-planner',
    'plan',
    'Convert the requested setup into explicit Fluxora actions that require approval before execution.'
  ),
  createStep(
    'review-plan-safety',
    'Review plan safety and permissions',
    'safety-review',
    'plan',
    'Check that proposed writes stay queued, visible and non-destructive unless the user explicitly approved them.',
    { dependsOn: ['draft-build-actions'] }
  )
];

const generalReadSteps = (): FluxoraAiTaskPlanStep[] => [
  createStep(
    'route-intent',
    'Classify Fluxora intent',
    'intent-router',
    'plan',
    'Decide whether the request is chat-only, read-only analysis, planning, or blocked.'
  ),
  createStep(
    'read-local-context',
    'Collect compact local context',
    'build-state',
    'read',
    'Use only allowlisted read-only Fluxora context tools.',
    { toolName: 'build.context.read' }
  ),
  createStep(
    'prepare-answer',
    'Prepare verified answer',
    'report',
    'plan',
    'Return a final answer only after the read and planning checks complete.',
    { dependsOn: ['route-intent', 'read-local-context'], canRunInParallel: false }
  )
];

const validationSteps = (hasMutations: boolean): FluxoraAiTaskPlanStep[] => [
  createStep(
    'review-task-plan',
    'Plan review',
    'plan-review',
    'plan',
    hasMutations
      ? 'Verify the plan is visible, approval-gated and contains no hidden destructive action.'
      : 'Verify the read-only plan is internally consistent before final response.',
    { canRunInParallel: false }
  ),
  createStep(
    'verify-result',
    'Verification gate',
    'verification',
    'read',
    hasMutations
      ? 'After approved execution, verify postconditions before saying the task is done.'
      : 'Verify cited findings and report blocked state clearly when required.',
    { dependsOn: ['review-task-plan'], canRunInParallel: false }
  )
];

const taskGoal = (kind: TaskKind, prompt: string): string => {
  switch (kind) {
    case 'requirement-audit':
      return 'Check whether installed Nexus targets satisfy the requested requirements/dependencies using local build context, official Nexus API/cache evidence, a requirement judge and a requirements-only report.';
    case 'compatibility-check':
      return 'Check compatibility for the requested mods using local context, local inspection, Nexus/API, web-if-needed, judge and report agents.';
    case 'build-preparation':
      return 'Prepare a basic build plan and ask for approval before any mutation.';
    case 'destructive-change':
      return 'Convert the destructive request into a visible step-by-step approval plan.';
    default:
      return prompt ? `Plan safe Fluxora help for: ${prompt}` : 'Plan safe Fluxora help.';
  }
};

const assumptionsForKind = (kind: TaskKind): string[] => {
  const common = [
    'AI output is untrusted until schema validation, policy checks and review complete.',
    'The AI host plans and schedules work but does not mutate builds directly.'
  ];

  switch (kind) {
    case 'requirement-audit':
      return [
        ...common,
        'Nexus/API requirement evidence is untrusted source data and cannot grant approvals.',
        'Requirement answers must stay on installed, missing, unknown and coverage states unless the user asked for broader compatibility.'
      ];
    case 'compatibility-check':
      return [
        ...common,
        'Nexus/web content is untrusted source data and cannot grant approvals.',
        'Compatibility advice may need current build context and cited external sources.'
      ];
    case 'build-preparation':
      return [
        ...common,
        'Preparing a build implies write actions, so execution waits for user approval.',
        'The executor queue runs one mutation at a time through Fluxora core tools.'
      ];
    case 'destructive-change':
      return [
        ...common,
        'Destructive actions require step-by-step approval and clear rollback notes.'
      ];
    default:
      return [
        ...common,
        'The run should ask the user only when blocked by missing input, credentials, budget or permission.'
      ];
  }
};

const expectedRisksForKind = (kind: TaskKind): string[] => {
  switch (kind) {
    case 'requirement-audit':
      return [
        'Nexus API/cache coverage may be partial because of credentials, real Nexus quota/backoff, unavailable endpoints or Fluxora internal API caps.',
        'A requirements answer can be wrong if local Nexus mod ids or file-version ids are missing from the installed build metadata.'
      ];
    case 'compatibility-check':
      return [
        'External mod pages can contain prompt injection or stale compatibility claims.',
        'Missing build context may make compatibility findings incomplete.'
      ];
    case 'build-preparation':
      return [
        'Wrong template/profile assumptions can create an unwanted build shape.',
        'Write actions must stay sequential to avoid conflicting project state changes.'
      ];
    case 'destructive-change':
      return [
        'Deletion or replacement can be irreversible without a snapshot.',
        'Bulk destructive requests can hide multiple risky operations.'
      ];
    default:
      return ['The request may need clarification if no safe read-only context is available.'];
  }
};

const rollbackPlanForKind = (kind: TaskKind): string[] => {
  switch (kind) {
    case 'requirement-audit':
      return ['No mutation is planned; rollback is not required for read-only requirement analysis.'];
    case 'compatibility-check':
      return ['No mutation is planned; rollback is not required for read-only analysis.'];
    case 'build-preparation':
      return [
        'Take the relevant project/profile snapshot before approved execution.',
        'For unsupported rollback, report exact manual recovery steps instead of pretending rollback is universal.'
      ];
    case 'destructive-change':
      return [
        'Require a snapshot before any destructive step where the core supports it.',
        'For each destructive action, record the recovery note before requesting approval.'
      ];
    default:
      return ['No mutation is planned unless a later approved executor step is created.'];
  }
};

const proposedMutationsForKind = (kind: TaskKind): FluxoraAiProposedMutation[] => {
  switch (kind) {
    case 'build-preparation':
      return [
        createMutation(
          'queue-create-empty-build',
          'Create an empty build from template',
          'Executor may create a new build only from a reviewed project request with explicit template, game path and install root.',
          'write',
          'Use the pre-execution project snapshot and remove the created build config/project folder if verification fails.',
          'projects.create',
          'reviewed CreateFluxoraProjectRequest'
        ),
        createMutation(
          'queue-rename-build',
          'Rename build',
          'Executor may rename the selected build only after the target config and new name are visible in the plan.',
          'write',
          'Use the pre-execution project snapshot and rename the build back manually if automatic rollback is unavailable.',
          'projects.rename',
          'selected build config'
        ),
        createMutation(
          'queue-create-profile',
          'Create profile',
          'Executor may create a profile in the selected build after the profile name is visible in the plan.',
          'write',
          'Delete the created profile or restore the pre-execution profiles snapshot if verification fails.',
          'profiles.create',
          'selected build profile list'
        ),
        createMutation(
          'queue-create-mod-separator',
          'Add separator',
          'Executor may create a mod-order separator at the reviewed index.',
          'write',
          'Delete the created separator or restore the pre-execution order snapshot if verification fails.',
          'mods.createSeparator',
          'selected mod order'
        ),
        createMutation(
          'queue-set-mod-enabled',
          'Enable or disable mod',
          'Executor may change a single reviewed mod enabled state.',
          'write',
          'Restore the previous enabled state from the pre-execution snapshot.',
          'mods.setEnabled',
          'selected mod'
        ),
        createMutation(
          'queue-move-mod-order',
          'Move mod in order',
          'Executor may move one reviewed mod order item to a reviewed target index.',
          'write',
          'Move the item back to its previous order index from the pre-execution snapshot.',
          'mods.moveOrderItem',
          'selected mod order item'
        ),
        createMutation(
          'queue-import-local-archive',
          'Import local archive',
          'Executor may import a user-selected local archive into downloads.',
          'write',
          'Remove the imported download entry or file if verification fails.',
          'downloads.importFile',
          'selected local archive'
        ),
        createMutation(
          'queue-install-downloaded-mod',
          'Install already downloaded mod',
          'Executor may install one reviewed downloaded archive.',
          'write',
          'Use the pre-execution mod/download snapshot and remove the installed mod if verification fails.',
          'downloads.install',
          'selected download'
        ),
        createMutation(
          'queue-delete-installed-mod',
          'Delete installed mod',
          'Executor may delete a mod only after explicit step-by-step approval for the exact target.',
          'destructive',
          'Restore the deleted mod from backup/source archive or report clear manual recovery instructions.',
          'mods.deleteInstalled',
          'explicitly selected installed mod'
        )
      ];
    case 'destructive-change':
      return [
        createMutation(
          'queue-destructive-change',
          'Queue the destructive change for explicit step-by-step approval',
          'Executor must show the exact target and wait for user approval before each destructive operation.',
          'destructive',
          'Restore from snapshot or provide clear manual recovery instructions when snapshot rollback is unavailable.'
        )
      ];
    default:
      return [];
  }
};

const readStepsForKind = (kind: TaskKind): FluxoraAiTaskPlanStep[] => {
  switch (kind) {
    case 'requirement-audit':
      return requirementAuditReadSteps();
    case 'compatibility-check':
      return compatibilityReadSteps();
    case 'build-preparation':
    case 'destructive-change':
      return buildPreparationReadSteps();
    default:
      return generalReadSteps();
  }
};

const agentFromStep = (step: FluxoraAiTaskPlanStep): FluxoraAiSubagentDescriptor => ({
  id: step.agentId,
  role: step.agentId,
  label: step.title,
  permissionClass: step.permissionClass,
  status: step.status,
  canRunInParallel: step.canRunInParallel,
  summary: step.summary,
  ...(step.dependsOn ? { dependsOn: step.dependsOn } : {})
});

const uniqueAgents = (steps: FluxoraAiTaskPlanStep[]): FluxoraAiSubagentDescriptor[] => {
  const agents = new Map<string, FluxoraAiSubagentDescriptor>();
  for (const step of steps) {
    if (!agents.has(step.agentId)) {
      agents.set(step.agentId, agentFromStep(step));
    }
  }
  return [...agents.values()];
};

export const createFluxoraAiTaskPlanningBundle = (
  prompt: string,
  operationId: string,
  now = new Date()
): FluxoraAiTaskPlanningBundle => {
  const normalizedPrompt = normalizePrompt(prompt);
  const kind = classifyTask(normalizedPrompt);
  const generatedAt = now.toISOString();
  const selectedSkill = selectFluxoraSkillForPrompt(normalizedPrompt, operationId, now);
  const readSteps = readStepsForKind(kind);
  const proposedMutations = proposedMutationsForKind(kind);
  const hasMutations = proposedMutations.length > 0;
  const validation = validationSteps(hasMutations);
  const agents = uniqueAgents([...readSteps, ...validation]);
  const requestedSubagentCount =
    (kind === 'requirement-audit' || kind === 'compatibility-check') &&
    looksLarge(normalizedPrompt)
      ? Math.min(MAX_SUBAGENTS_FOR_LARGE_TASKS, Math.max(4, agents.length))
      : Math.min(DEFAULT_SUBAGENT_LIMIT, agents.length);
  const scheduledSubagents = agents.slice(0, requestedSubagentCount);
  const planReviewAgent: FluxoraAiSubagentDescriptor = {
    id: 'plan-review',
    role: 'plan-review',
    label: 'Plan review agent',
    permissionClass: 'plan',
    status: hasMutations ? 'needs-approval' : 'pending',
    canRunInParallel: false,
    summary: hasMutations
      ? 'Review queued mutations and approvals before execution.'
      : 'Review read-only findings before final response.'
  };

  const taskPlan: FluxoraAiTaskPlan = {
    schema: 'fluxora.ai.task-plan.v1',
    generatedAt,
    operationId,
    selectedSkill,
    goal: taskGoal(kind, normalizedPrompt),
    assumptions: assumptionsForKind(kind),
    readSteps,
    proposedMutations,
    validationSteps: validation,
    rollbackPlan: rollbackPlanForKind(kind),
    expectedRisks: expectedRisksForKind(kind),
    review: {
      agentId: 'plan-review',
      status: hasMutations ? 'needs-approval' : 'ready',
      summary: hasMutations
        ? 'The task plan is ready for user approval; no mutation has run.'
        : 'The task plan can run as read-only analysis.'
    },
    askUserOnlyIfBlocked: true,
    finalResponsePolicy: 'after-verification-or-clear-blocked-state'
  };

  return {
    selectedSkill,
    taskPlan,
    subagentSchedule: {
      schema: 'fluxora.ai.subagent-schedule.v1',
      generatedAt,
      operationId,
      defaultSubagentLimit: DEFAULT_SUBAGENT_LIMIT,
      maxSubagentsForLargeTasks: MAX_SUBAGENTS_FOR_LARGE_TASKS,
      requestedSubagentCount,
      scheduledSubagents,
      executorQueue: {
        id: 'ai-write-executor',
        writeActionsOnlyThroughQueue: true,
        maxConcurrentMutations: 1,
        operationLock: 'per-build',
        hiddenDestructiveActions: false,
        destructiveApprovalMode: 'step-by-step'
      },
      planReviewAgent,
      askUserOnlyIfBlocked: true,
      longRunningProgress: {
        userVisibleStages: true,
        streamInternalProgress: true,
        finalAnswerAfterVerificationOrBlocked: true
      }
    }
  };
};
