import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAiChatThread,
  createAiMessage,
  createAiStreamEvent,
  syncAiSessionToActiveChat
} from '../src/renderer/features/ai/ai-chat-state';
import { aiAutonomousJobQueueStorageKey } from '../src/renderer/features/ai/ai-autonomous-jobs';
import {
  aiSessionScopeKey,
  aiSessionStorageKey,
  aiResponseDiagnosticMessages,
  createAiHostChatRequest,
  createAiPromptFingerprint,
  createAiResearchRequestForPrompt,
  createAiRunForPrompt,
  createAiRuntimeLogEntries,
  createAiSessionForScope,
  createAiSupportBundleSnapshot,
  loadAiSession,
  redactAiTextForLog,
  saveAiSession,
  startHostAiRun,
  startLocalAiRun
} from '../src/renderer/features/ai/ai-chat-runtime';
import {
  compressAiCaseState,
  createAiDiagnosisJudge,
  createAiLocalInspection,
  createAiModResearchEvidenceCard,
  createAiNexusInvestigation,
  type FluxoraAiModResearchFinding
} from '../src/shared/ai-mod-research-pipeline';
import { createFluxoraAiTaskPlanningBundle } from '../src/shared/ai-task-planner';
import type {
  FluxoraAiIntermediateEvent,
  FluxoraApi
} from '../src/shared/fluxora-api';

const createMemoryStorage = () => {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values
  };
};

const createIntermediateEvent = (
  overrides: Partial<FluxoraAiIntermediateEvent> = {}
): FluxoraAiIntermediateEvent => ({
  schema: 'fluxora.ai.intermediate-event.v1',
  eventId: 'event-runtime-1',
  runId: 'run-runtime',
  operationId: 'op_ai_runtime',
  seq: 1,
  createdAt: '2026-07-03T10:00:00.000Z',
  type: 'progress',
  level: 'info',
  visibility: 'user',
  stage: 'provider-attempt',
  message: 'Provider attempt is running.',
  percent: 58,
  payload: {
    kind: 'provider-attempt',
    data: {
      providerId: 'gemini'
    }
  },
  ...overrides
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AI chat runtime', () => {
  it('persists chat history per build without exposing the project path in the storage key', () => {
    const storage = createMemoryStorage();
    const scope = {
      buildLabel: 'Skyrim Main',
      projectDirectory: 'C:\\Users\\Valerii\\Fluxora Builds\\Skyrim Main',
      projectId: 'skyrim-main'
    };
    const session = createAiSessionForScope(scope, new Date('2026-06-29T10:00:00Z'));
    const run = createAiRunForPrompt(
      session,
      'op_ai_chat_run',
      'check plugins',
      new Date('2026-06-29T10:00:01Z')
    );
    const nextSession = {
      ...session,
      messages: [
        createAiMessage('user', 'check plugins', new Date('2026-06-29T10:00:01Z'), run.id)
      ],
      runs: [{ ...run, state: 'completed' as const, status: 'done' as const }]
    };

    saveAiSession(storage, nextSession);
    const storageKey = aiSessionStorageKey(aiSessionScopeKey(scope));
    const restored = loadAiSession(storage, scope, new Date('2026-06-29T10:00:02Z'));

    expect(storageKey).not.toContain('Valerii');
    expect(storage.values.has(storageKey)).toBe(true);
    expect(restored.messages.map((message) => message.text)).toEqual(['check plugins']);
    expect(restored.buildLabel).toBe('Skyrim Main');
  });

  it('recovers unfinished local runs after refresh instead of pretending the timer survived', () => {
    const storage = createMemoryStorage();
    const scope = { buildLabel: 'Foundation Edition', projectId: 'foundation' };
    const session = createAiSessionForScope(scope, new Date('2026-06-29T10:00:00Z'));
    const run = createAiRunForPrompt(
      session,
      'op_ai_chat_run',
      'blocked by refresh',
      new Date('2026-06-29T10:00:01Z')
    );
    const runningSession = {
      ...session,
      runs: [{ ...run, state: 'streaming' as const, status: 'running' as const }],
      streamEvents: [
        createAiStreamEvent(run, 'status', {
          now: new Date('2026-06-29T10:00:02Z'),
          status: 'running'
        })
      ]
    };

    saveAiSession(storage, runningSession);
    const restored = loadAiSession(storage, scope, new Date('2026-06-29T10:01:00Z'));

    expect(restored.runs[0]?.state).toBe('recovered');
    expect(restored.runs[0]?.status).toBe('blocked');
    expect(restored.streamEvents.at(-1)?.type).toBe('run-recovered');
    expect(restored.messages.at(-1)?.text).toContain('interrupted during refresh');
  });

  it('creates redacted log records and support snapshots without raw prompts by default', () => {
    const session = createAiSessionForScope(
      { buildLabel: 'Skyrim Main', projectId: 'skyrim-main' },
      new Date('2026-06-29T10:00:00Z')
    );
    const prompt = 'my provider token=super-secret-value should never enter logs';
    const run = createAiRunForPrompt(
      session,
      'op_ai_chat_run',
      prompt,
      new Date('2026-06-29T10:00:01Z')
    );
    const sessionWithPrompt = {
      ...session,
      intermediateEvents: [
        createIntermediateEvent({
          eventId: 'event-secret-count-only',
          runId: run.id,
          operationId: run.operationId,
          message: 'Provider attempt is running.',
          payload: {
            kind: 'provider-attempt',
            data: {
              note: 'token=super-secret-value'
            }
          }
        })
      ],
      messages: [createAiMessage('user', prompt, new Date('2026-06-29T10:00:01Z'), run.id)],
      runs: [run]
    };
    const logs = createAiRuntimeLogEntries('run-created token=super-secret-value', run);
    const supportSnapshot = createAiSupportBundleSnapshot([sessionWithPrompt], {
      now: new Date('2026-06-29T10:00:02Z')
    });
    const optedInSnapshot = createAiSupportBundleSnapshot([sessionWithPrompt], {
      includeRawPrompts: true,
      now: new Date('2026-06-29T10:00:02Z')
    });

    expect(logs.map((entry) => entry.channel)).toEqual([
      'tauri-ui',
      'tauri-bridge',
      'ai-host',
      'operations'
    ]);
    expect(JSON.stringify(logs)).not.toContain('super-secret-value');
    expect(JSON.stringify(supportSnapshot)).not.toContain(prompt);
    expect(JSON.stringify(supportSnapshot)).not.toContain('event-secret-count-only');
    expect(JSON.stringify(supportSnapshot)).not.toContain('super-secret-value');
    expect(supportSnapshot.sessions[0]?.intermediateEventCount).toBe(1);
    expect(supportSnapshot.sessions[0]?.messages[0]?.textRedacted).toBe(true);
    expect(optedInSnapshot.sessions[0]?.messages[0]?.text).toBe(prompt);
    expect(redactAiTextForLog('Bearer abcdefghijklmnopqrstuvwxyz')).toBe(
      'Bearer [redacted-secret]'
    );
    expect(createAiPromptFingerprint(prompt).length).toBe(prompt.length);
  });

  it('enables constrained Nexus research policy only for Nexus prompts', () => {
    expect(createAiResearchRequestForPrompt('check plugins', 'free-demo')).toBeUndefined();

    const request = createAiResearchRequestForPrompt(
      'Check compatibility for https://www.nexusmods.com/skyrimspecialedition/mods/123',
      'byok'
    );

    expect(request).toEqual({
      enabled: true,
      mode: 'nexus-api-first',
      allowAuthenticatedPages: false,
      allowBrowserSandbox: false,
      allowGeminiGoogleSearch: true,
      allowPublicWebFetch: false,
      deepResearchApproved: false
    });

    expect(
      createAiResearchRequestForPrompt('Проверь все моды на отсутствующие требования', 'byok')
    ).toEqual({
      enabled: true,
      mode: 'nexus-api-first',
      allowAuthenticatedPages: false,
      allowBrowserSandbox: false,
      allowGeminiGoogleSearch: true,
      allowPublicWebFetch: false,
      deepResearchApproved: false,
      auditScope: 'batch-requirements',
      maxNexusTargets: 128,
      maxNexusInitialTargets: 128,
      maxNexusApiRequests: 256
    });

    expect(createAiResearchRequestForPrompt('Посмотри Nexus Mods через API', 'byok')).toEqual({
      enabled: true,
      mode: 'nexus-api-first',
      allowAuthenticatedPages: false,
      allowBrowserSandbox: false,
      allowGeminiGoogleSearch: true,
      allowPublicWebFetch: false,
      deepResearchApproved: false
    });
  });

  it('can cancel the local fake run before the placeholder stream finishes', () => {
    vi.useFakeTimers();
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_chat_run', 'check plugins');
    const events: string[] = [];
    const messages: string[] = [];

    const handle = startLocalAiRun(run, 'check plugins', {
      onEvent: (event) => events.push(event.type),
      onFinish: (message, event) => {
        events.push(event.type);
        messages.push(message.text);
      }
    });

    handle.cancel();
    vi.runAllTimers();

    expect(events).toEqual(['run-cancelled']);
    expect(messages).toEqual(['Local AI run cancelled.']);
  });

  it('returns queued plan approvals for local basic build preparation runs', async () => {
    vi.useFakeTimers();
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_chat_run', 'prepare basic build for Skyrim');
    const statuses: string[] = [];
    const goals: string[] = [];
    const queueLimits: number[] = [];

    startLocalAiRun(run, 'prepare basic build for Skyrim', {
      onEvent: (event) => statuses.push(event.status ?? event.type),
      onFinish: (message, event, status) => {
        statuses.push(event.status ?? status);
        goals.push(message.taskPlan?.goal ?? '');
        queueLimits.push(message.subagentSchedule?.executorQueue.maxConcurrentMutations ?? 0);
        expect(message.selectedSkill?.selectedSkillId).toBe('skyrim-basic-build-setup');
        expect(message.selectedSkill?.selectedSkill?.displayName).toBe('Skyrim basic build setup');
      }
    });

    await vi.runAllTimersAsync();

    expect(statuses).toEqual(['running', 'needs-approval']);
    expect(goals[0]).toContain('approval before any mutation');
    expect(queueLimits).toEqual([1]);
  });

  it('streams host-backed chat responses with citations and cost ledger metadata', async () => {
    vi.useFakeTimers();
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_chat_run', 'check plugins');
    const storage = createMemoryStorage();
    const events: string[] = [];
    const messages: string[] = [];
    const ledgerEntries: string[] = [];
    const planningBundle = createFluxoraAiTaskPlanningBundle(
      'check plugins',
      'op_ai_chat_run',
      new Date('2026-06-30T00:00:00.000Z')
    );
    const aiApi = {
      onRunEvent: vi.fn(() => () => undefined),
      chatRespond: vi.fn(async () => ({
        operationId: 'op_ai_chat_run',
        providerId: 'local-dry-run',
        modelId: 'local-dry-run',
        routingPreset: 'free-demo',
        status: 'done',
        text: 'Plan: inspect plugins safely.',
        streamChunks: [
          { index: 0, text: 'Plan: inspect ' },
          { index: 1, text: 'plugins safely.' }
        ],
        sources: [
          {
            id: 'source-1',
            title: 'Fluxora docs',
            url: 'https://example.test/fluxora'
          }
        ],
        costEstimate: {
          currency: 'USD',
          estimatedInputTokens: 3,
          estimatedOutputTokens: 7,
          estimatedCost: 0,
          actualCost: 0,
          internalCost: 0,
          pricingSource: 'test',
          isEstimate: true
        },
        ledgerEntry: {
          operationId: 'op_ai_chat_run',
          providerId: 'local-dry-run',
          modelId: 'local-dry-run',
          routingPreset: 'free-demo',
          estimatedInternalCost: 0,
          actualInternalCost: 0,
          currency: 'USD',
          billable: false,
          createdAt: '2026-06-30T00:00:00.000Z'
        },
        contextUsage: {
          schema: 'fluxora.ai.context-usage.v1',
          operationId: 'op_ai_chat_run',
          providerId: 'local-dry-run',
          modelId: 'local-dry-run',
          contextWindowTokens: 8192,
          currentContextTokens: 42,
          currentContextPercent: 0.5126953125,
          precision: 'estimated',
          level: 'normal',
          mode: 'full',
          includedSections: ['chat-history'],
          autoCompressionApplied: false,
          actionRequired: false,
          countedAt: '2026-06-30T00:00:00.000Z'
        },
        tokenUsage: {
          inputTokens: 42,
          outputTokens: 7,
          totalTokens: 49,
          contextTokensBeforeRequest: 42,
          source: 'chars-per-token-estimate'
        },
        fallbackProviders: [],
        taskPlan: planningBundle.taskPlan,
        subagentSchedule: planningBundle.subagentSchedule,
        selectedSkill: planningBundle.selectedSkill,
        toolCallsAllowed: false
      }))
    } as unknown as FluxoraApi['ai'];

    startHostAiRun(
      run,
      session,
      'check plugins',
      aiApi,
      {
        jobStorage: storage,
        modelId: 'local-dry-run',
        modelSupportsBackground: true,
        routingPreset: 'free-demo',
        providerId: 'local-dry-run'
      },
      {
        onEvent: (event) => events.push(event.type),
        onFinish: (message, event, _status, ledgerEntry) => {
          events.push(event.type);
          messages.push(message.text);
          ledgerEntries.push(ledgerEntry?.operationId ?? '');
          expect(message.sources?.[0]?.title).toBe('Fluxora docs');
          expect(message.costEstimate?.currency).toBe('USD');
          expect(message.providerDiagnostics?.[0]).toContain('Local dry run generated this template');
          expect(message.taskPlan?.schema).toBe('fluxora.ai.task-plan.v1');
          expect(message.subagentSchedule?.schema).toBe('fluxora.ai.subagent-schedule.v1');
          expect(message.selectedSkill?.schema).toBe('fluxora.ai.skill-selection.v1');
          expect(message.contextUsage?.currentContextTokens).toBe(42);
          expect(message.tokenUsage?.totalTokens).toBe(49);
        }
      }
    );

    await vi.runAllTimersAsync();

    expect(events).toEqual(['status', 'assistant-delta', 'assistant-delta', 'run-finished']);
    expect(messages).toEqual(['Plan: inspect plugins safely.']);
    expect(ledgerEntries).toEqual(['op_ai_chat_run']);
    const persistedQueue = JSON.parse(
      storage.values.get(aiAutonomousJobQueueStorageKey(session.scopeKey)) ?? '{}'
    ) as {
      jobs?: Array<{
        backgroundMode: string;
        checkpoints: Array<{ title: string }>;
        operationId: string;
        percent: number;
        state: string;
      }>;
      schema?: string;
    };
    expect(persistedQueue.schema).toBe('fluxora.ai.autonomous-job-queue.v1');
    expect(persistedQueue.jobs?.[0]).toMatchObject({
      backgroundMode: 'provider-background',
      operationId: 'op_ai_chat_run',
      percent: 100,
      state: 'completed'
    });
    expect(persistedQueue.jobs?.[0]?.checkpoints.map((checkpoint) => checkpoint.title)).toEqual(
      expect.arrayContaining(['Background run started', 'Provider response', 'Final report'])
    );
    expect(aiApi.chatRespond).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'op_ai_chat_run',
        runId: run.id,
        modelId: 'local-dry-run',
        providerId: 'local-dry-run',
        routingPreset: 'free-demo',
        stream: true
      })
    );
  });

  it('forwards matching host intermediate events and persists them for autonomous runs', async () => {
    vi.useFakeTimers();
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_stream_events', 'check plugins');
    const storage = createMemoryStorage();
    const forwarded: FluxoraAiIntermediateEvent[] = [];
    let runEventListener: ((event: FluxoraAiIntermediateEvent) => void) | null = null;
    const matchingEvent = createIntermediateEvent({
      eventId: 'event-provider-started',
      runId: run.id,
      operationId: run.operationId,
      seq: 2,
      stage: 'provider-attempt',
      message: 'Provider attempt started.',
      percent: 58
    });
    const aiApi = {
      onRunEvent: vi.fn((callback: (event: FluxoraAiIntermediateEvent) => void) => {
        runEventListener = callback;
        return () => {
          runEventListener = null;
        };
      }),
      chatRespond: vi.fn(async () => {
        runEventListener?.(
          createIntermediateEvent({
            eventId: 'event-other-run',
            runId: 'run-other',
            operationId: run.operationId,
            seq: 1
          })
        );
        runEventListener?.(matchingEvent);
        return {
          operationId: run.operationId,
          providerId: 'local-dry-run',
          modelId: 'local-dry-run',
          routingPreset: 'free-demo',
          status: 'done',
          text: 'Scoped answer.',
          streamChunks: [{ index: 0, text: 'Scoped answer.' }],
          sources: [],
          costEstimate: null,
          ledgerEntry: undefined,
          fallbackProviders: [],
          taskPlan: null,
          subagentSchedule: null,
          selectedSkill: null,
          toolCallsAllowed: false
        };
      })
    } as unknown as FluxoraApi['ai'];

    startHostAiRun(
      run,
      session,
      'check plugins',
      aiApi,
      {
        jobStorage: storage,
        modelId: 'local-dry-run',
        routingPreset: 'free-demo',
        providerId: 'local-dry-run'
      },
      {
        onEvent: () => undefined,
        onFinish: () => undefined,
        onRunEvent: (event) => forwarded.push(event)
      }
    );

    await vi.runAllTimersAsync();

    const persistedQueue = JSON.parse(
      storage.values.get(aiAutonomousJobQueueStorageKey(session.scopeKey)) ?? '{}'
    ) as { jobs?: Array<{ progressEvents?: Array<{ canonicalEvent?: FluxoraAiIntermediateEvent; internal: boolean; stage: string }> }> };
    const canonicalProgress = persistedQueue.jobs?.[0]?.progressEvents?.filter(
      (event) => event.canonicalEvent
    ) ?? [];

    expect(aiApi.onRunEvent).toHaveBeenCalledTimes(1);
    expect(forwarded.map((event) => event.eventId)).toEqual(['event-provider-started']);
    expect(canonicalProgress).toHaveLength(1);
    expect(canonicalProgress[0]).toMatchObject({
      internal: false,
      stage: 'provider-attempt',
      canonicalEvent: {
        eventId: 'event-provider-started',
        runId: run.id,
        operationId: run.operationId
      }
    });
  });

  it('marks provider fallbacks as blocked diagnostics instead of silent template success', async () => {
    vi.useFakeTimers();
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_chat_run', 'check plugins');
    const statuses: string[] = [];
    const diagnostics: string[] = [];
    const aiApi = {
      onRunEvent: vi.fn(() => () => undefined),
      chatRespond: vi.fn(async () => ({
        operationId: 'op_ai_chat_run',
        providerId: 'local-dry-run',
        modelId: 'local-dry-run',
        routingPreset: 'byok',
        status: 'done',
        text: 'Plan: inspect plugins safely.',
        streamChunks: [{ index: 0, text: 'Plan: inspect plugins safely.' }],
        sources: [],
        costEstimate: null,
        ledgerEntry: undefined,
        fallbackProviders: ['gemini:missingCredential'],
        taskPlan: null,
        subagentSchedule: null,
        selectedSkill: null,
        toolCallsAllowed: false
      }))
    } as unknown as FluxoraApi['ai'];

    startHostAiRun(
      run,
      session,
      'check plugins',
      aiApi,
      {
        modelId: 'gemini-3.1-flash-lite',
        routingPreset: 'byok',
        providerId: 'gemini'
      },
      {
        onEvent: () => undefined,
        onFinish: (message, _event, status) => {
          statuses.push(status);
          diagnostics.push(...(message.providerDiagnostics ?? []));
        }
      }
    );

    await vi.runAllTimersAsync();

    expect(statuses).toEqual(['blocked']);
    expect(diagnostics[0]).toContain('Google Gemini key is missing');
  });

  it('uses structured diagnosis and compact case state for the final user answer', async () => {
    vi.useFakeTimers();
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const prompt = 'Проверь почему Weather Patch не запускается';
    const run = createAiRunForPrompt(session, 'op_ai_structured_final', prompt);
    const finding: FluxoraAiModResearchFinding = {
      id: 'finding-missing-master',
      claim: 'Weather Patch.esp has missing master WeatherCore.esm.',
      relevantMods: ['Weather Patch'],
      affectedVersions: [],
      evidenceIds: ['local:plugins.loadOrder'],
      confidence: 0.96,
      deterministic: true
    };
    const localInspection = createAiLocalInspection({
      operationId: 'op_ai_structured_final',
      generatedAt: new Date('2026-07-02T12:00:00Z'),
      needMoreLocalData: false,
      missingFields: [],
      deterministicFindings: [finding],
      hypotheses: [],
      suspect_mods: [],
      evidenceCards: [
        createAiModResearchEvidenceCard({
          operationId: 'op_ai_structured_final',
          generatedAt: new Date('2026-07-02T12:00:00Z'),
          sourceId: 'local:plugins.loadOrder',
          sourceType: 'local-metadata',
          sourceTier: 'local-authoritative',
          claim: finding.claim,
          relevantMods: ['Weather Patch'],
          affectedVersions: [],
          evidenceStrength: 'direct',
          confidence: 0.96,
          contradictionRisk: 'low'
        })
      ]
    });
    const nexusInvestigation = createAiNexusInvestigation({
      operationId: 'op_ai_structured_final',
      generatedAt: new Date('2026-07-02T12:00:00Z'),
      targetNexusIds: ['skyrim:1234'],
      api: {
        state: 'quota-exhausted',
        unavailableReason: 'rate-limited',
        lastHttpStatus: 429,
        retryAfterSeconds: 120
      },
      quota: {
        hourlyRemaining: 0,
        dailyRemaining: 0,
        resetAt: '2026-07-02T13:00:00Z',
        source: 'headers'
      },
      ordinaryError: null,
      deterministicFindings: [],
      hypotheses: [],
      evidenceCards: []
    });
    const diagnosisJudge = createAiDiagnosisJudge({
      operationId: 'op_ai_structured_final',
      generatedAt: new Date('2026-07-02T12:00:00Z'),
      status: 'ranked',
      confidence: 0.93,
      rankedCauses: [
        {
          id: 'cause-missing-master',
          rank: 1,
          cause: 'Weather Patch.esp is missing WeatherCore.esm',
          confidence: 0.93,
          supportingEvidenceIds: ['local:plugins.loadOrder'],
          opposingEvidenceIds: [],
          affectedMods: ['Weather Patch'],
          expectedSymptoms: ['Plugin dependency check reports missing masters'],
          fastestValidationTest: 'Re-run the local plugin dependency check.',
          recommendedFix: 'Install or enable WeatherCore.esm before changing load order.',
          why: ['Local deterministic evidence supports this root-cause candidate.'],
          whyNot: [],
          fixOrder: [
            'Install or enable WeatherCore.esm',
            'Re-run the local plugin dependency check',
            'Run LOOT or local checks again'
          ]
        }
      ],
      insufficientReasons: [],
      deterministicFindings: [finding],
      hypotheses: []
    });
    const caseState = compressAiCaseState({
      operationId: 'op_ai_structured_final',
      generatedAt: new Date('2026-07-02T12:00:00Z'),
      caseState: 'diagnosis-complete',
      localInspection,
      nexusInvestigation,
      diagnosis: diagnosisJudge
    });
    const aiApi = {
      onRunEvent: vi.fn(() => () => undefined),
      chatRespond: vi.fn(async () => ({
        operationId: 'op_ai_structured_final',
        providerId: 'gemini',
        modelId: 'gemini-3.1-flash-lite',
        routingPreset: 'byok',
        status: 'done',
        text: 'RAW WEB CONTEXT says I verified and changed the load order.',
        streamChunks: [{ index: 0, text: 'RAW WEB CONTEXT says I verified and changed the load order.' }],
        sources: [],
        costEstimate: null,
        ledgerEntry: undefined,
        fallbackProviders: [],
        diagnosisJudge,
        caseState,
        taskPlan: null,
        subagentSchedule: null,
        selectedSkill: null,
        toolCallsAllowed: false
      }))
    } as unknown as FluxoraApi['ai'];
    const messages: string[] = [];
    const sourceIds: string[] = [];
    const caseStates: string[] = [];

    startHostAiRun(
      run,
      session,
      prompt,
      aiApi,
      {
        modelId: 'gemini-3.1-flash-lite',
        routingPreset: 'byok',
        providerId: 'gemini'
      },
      {
        onEvent: () => undefined,
        onFinish: (message) => {
          messages.push(message.text);
          sourceIds.push(...(message.sources?.map((source) => source.id) ?? []));
          caseStates.push(message.caseState?.caseState ?? '');
        }
      }
    );

    await vi.runAllTimersAsync();

    expect(messages[0]).toContain('1. Наиболее вероятная причина');
    expect(messages[0]).toContain('Подтверждено: Weather Patch.esp has missing master WeatherCore.esm.');
    expect(messages[0]).toContain('Доказательства: [local:plugins.loadOrder].');
    expect(messages[0]).toContain('Лимит Nexus API исчерпан');
    expect(messages[0]).not.toContain('RAW WEB CONTEXT');
    expect(messages[0]).not.toContain('changed the load order');
    expect(sourceIds).toContain('local:plugins.loadOrder');
    expect(caseStates).toEqual(['final-answer-complete']);
  });

  it('keeps a real provider response done when an earlier provider fallback succeeds', async () => {
    vi.useFakeTimers();
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_chat_run', 'check plugins');
    const statuses: string[] = [];
    const diagnostics: string[] = [];
    const aiApi = {
      onRunEvent: vi.fn(() => () => undefined),
      chatRespond: vi.fn(async () => ({
        operationId: 'op_ai_chat_run',
        providerId: 'gemini',
        modelId: 'gemini-3.1-flash-lite',
        routingPreset: 'byok',
        status: 'done',
        text: 'The plugin list is safe to inspect.',
        streamChunks: [{ index: 0, text: 'The plugin list is safe to inspect.' }],
        sources: [],
        costEstimate: null,
        ledgerEntry: undefined,
        fallbackProviders: ['gemini:balance'],
        taskPlan: null,
        subagentSchedule: null,
        selectedSkill: null,
        toolCallsAllowed: false
      }))
    } as unknown as FluxoraApi['ai'];

    startHostAiRun(
      run,
      session,
      'check plugins',
      aiApi,
      {
        modelId: 'gemini-2.5-flash-lite',
        routingPreset: 'byok',
        providerId: 'gemini'
      },
      {
        onEvent: () => undefined,
        onFinish: (message, _event, status) => {
          statuses.push(status);
          diagnostics.push(...(message.providerDiagnostics ?? []));
        }
      }
    );

    await vi.runAllTimersAsync();

    expect(statuses).toEqual(['done']);
    expect(diagnostics).toEqual([]);
  });

  it('formats provider fallback and generic error diagnostics without raw provider payloads', () => {
    const diagnostics = aiResponseDiagnosticMessages({
      operationId: 'op_ai_chat_run',
      providerId: 'local-dry-run',
      modelId: 'local-dry-run',
      routingPreset: 'byok',
      status: 'done',
      text: 'Local fallback.',
      streamChunks: [],
      sources: [],
      costEstimate: null,
      ledgerEntry: undefined,
      fallbackProviders: ['gemini:missingCredential'],
      taskPlan: null,
      subagentSchedule: null,
      selectedSkill: null,
      toolCallsAllowed: false,
      error: {
        code: 'ai.provider.fallback',
        message: 'api_key=secret-value failed',
        category: 'transport',
        retryable: true,
        capabilityId: null,
        details: {}
      }
    } as never);

    expect(diagnostics).toEqual([
      'Fluxora fell back to Local dry run: Google Gemini key is missing.',
      'AI provider response was unavailable. Check Settings > AI or retry later.'
    ]);
    expect(diagnostics.join(' ')).not.toContain('secret-value');
    expect(diagnostics.join(' ')).not.toContain('api_key');

    expect(
      aiResponseDiagnosticMessages({
        operationId: 'op_ai_chat_run',
        providerId: 'local-dry-run',
        modelId: 'local-dry-run',
        routingPreset: 'byok',
        status: 'done',
        text: 'Local fallback.',
        streamChunks: [],
        sources: [],
        costEstimate: null,
        ledgerEntry: undefined,
        fallbackProviders: ['gemini:balance'],
        taskPlan: null,
        subagentSchedule: null,
        selectedSkill: null,
        toolCallsAllowed: false
      } as never)
    ).toEqual([
      'Fluxora fell back to Local dry run: Google Gemini balance or quota is unavailable.'
    ]);
  });

  it('keeps host-backed requests scoped to the active chat tab', async () => {
    vi.useFakeTimers();
    const baseSession = createAiSessionForScope({
      buildLabel: 'Skyrim Main',
      projectId: 'skyrim-main'
    });
    const oldChat = {
      ...createAiChatThread(baseSession.scopeKey, new Date('2026-06-30T00:00:00Z'), 'Old chat'),
      messages: [
        createAiMessage(
          'user',
          'old context that must not leak',
          new Date('2026-06-30T00:00:01Z')
        )
      ]
    };
    const activeChat = createAiChatThread(
      baseSession.scopeKey,
      new Date('2026-06-30T00:01:00Z'),
      'Fresh chat'
    );
    const session = syncAiSessionToActiveChat({
      ...baseSession,
      activeChatId: activeChat.id,
      chats: [oldChat, activeChat]
    });
    const run = createAiRunForPrompt(session, 'op_ai_chat_run', 'new isolated question');
    const aiApi = {
      onRunEvent: vi.fn(() => () => undefined),
      chatRespond: vi.fn(async () => ({
        operationId: 'op_ai_chat_run',
        providerId: 'local-dry-run',
        modelId: 'local-dry-run',
        routingPreset: 'free-demo',
        status: 'done',
        text: 'Scoped answer.',
        streamChunks: [{ index: 0, text: 'Scoped answer.' }],
        sources: [],
        costEstimate: null,
        ledgerEntry: undefined,
        fallbackProviders: [],
        taskPlan: null,
        subagentSchedule: null,
        selectedSkill: null,
        toolCallsAllowed: false
      }))
    } as unknown as FluxoraApi['ai'];

    startHostAiRun(
      run,
      session,
      'new isolated question',
      aiApi,
      {
        modelId: 'local-dry-run',
        routingPreset: 'free-demo',
        providerId: 'local-dry-run'
      },
      {
        onEvent: () => undefined,
        onFinish: () => undefined
      }
    );

    await vi.runAllTimersAsync();

    const request = vi.mocked(aiApi.chatRespond).mock.calls[0]?.[0];
    expect(run.sessionId).toBe(activeChat.id);
    expect(request?.sessionId).toBe(activeChat.id);
    expect(request?.messages.map((message) => message.text)).toEqual(['new isolated question']);
    expect(JSON.stringify(request)).not.toContain('old context that must not leak');
  });

  it('reuses a prepared host request for context estimate and chat response shapes', async () => {
    vi.useFakeTimers();
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_chat_run', 'check plugins');
    const buildContextSnapshot = {
      generatedAt: '2026-07-03T10:00:00.000Z',
      issues: [],
      operationId: 'op_build_context',
      permissionClass: 'read' as const,
      projectName: 'Skyrim Main',
      tools: []
    };
    const request = createAiHostChatRequest(run, session, 'check plugins', {
      buildContextSnapshot,
      modelId: 'gemini-3.1-flash-lite',
      providerId: 'gemini',
      routingPreset: 'byok'
    });
    const aiApi = {
      onRunEvent: vi.fn(() => () => undefined),
      chatRespond: vi.fn(async () => ({
        operationId: 'op_ai_chat_run',
        providerId: 'gemini',
        modelId: 'gemini-3.1-flash-lite',
        routingPreset: 'byok',
        status: 'done',
        text: 'Scoped answer.',
        streamChunks: [{ index: 0, text: 'Scoped answer.' }],
        sources: [],
        costEstimate: null,
        ledgerEntry: undefined,
        fallbackProviders: [],
        taskPlan: null,
        subagentSchedule: null,
        selectedSkill: null,
        toolCallsAllowed: false
      }))
    } as unknown as FluxoraApi['ai'];

    startHostAiRun(
      run,
      session,
      'check plugins',
      aiApi,
      {
        buildContextSnapshot,
        modelId: 'gemini-3.1-flash-lite',
        preparedRequest: request,
        providerId: 'gemini',
        routingPreset: 'byok'
      },
      {
        onEvent: () => undefined,
        onFinish: () => undefined
      }
    );

    await vi.runAllTimersAsync();

    expect(request.messages[0]?.role).toBe('system');
    expect(request.messages[0]?.text).toContain('fluxora.ai.build-context.v1');
    expect(request.messages.at(-1)).toMatchObject({
      role: 'user',
      text: 'check plugins'
    });
    expect(request.research).toBeUndefined();
    expect(aiApi.chatRespond).toHaveBeenCalledWith(request);
  });
});
