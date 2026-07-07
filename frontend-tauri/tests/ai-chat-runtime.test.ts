import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  aiChatReducer,
  createAiChatThread,
  createAiMessage,
  createAiStreamEvent,
  initialAiChatState,
  syncAiSessionToActiveChat,
  type AiMessage
} from '../src/renderer/features/ai/ai-chat-state';
import { aiAutonomousJobQueueStorageKey } from '../src/renderer/features/ai/ai-autonomous-jobs';
import {
  aiSessionScopeKey,
  aiSessionStorageKey,
  aiResponseDiagnosticMessages,
  compactAiSessionForStorage,
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
  FluxoraAiResearchReport,
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

  it('compacts oversized research metadata before persisting chat history', () => {
    const storage = createMemoryStorage();
    const scope = { buildLabel: 'Large Skyrim Build', projectId: 'large-skyrim-build' };
    const session = createAiSessionForScope(scope, new Date('2026-07-07T09:00:00Z'));
    const chat = session.chats[0]!;
    const sources = Array.from({ length: 160 }, (_, index) => ({
      id: `nexus-source-${index}`,
      title: `Nexus source ${index}`,
      url: `https://www.nexusmods.com/skyrimspecialedition/mods/${index}`,
      snippet: 'source raw text '.repeat(500)
    }));
    const researchReport: FluxoraAiResearchReport = {
      schema: 'fluxora.ai.research.v1',
      generatedAt: '2026-07-07T09:00:00.000Z',
      operationId: 'op_ai_large_requirements',
      permissionClass: 'external-network',
      mode: 'nexus-api-first',
      policy: {
        rawPromptEcho: 'should-not-persist'.repeat(1000)
      },
      targets: Array.from({ length: 600 }, (_, index) => ({
        id: `target-${index}`,
        rawApiPayload: 'target raw text '.repeat(500)
      })),
      snapshots: Array.from({ length: 96 }, (_, index) => ({
        id: `snapshot-${index}`,
        kind: 'nexus-api',
        title: `Nexus snapshot ${index}`,
        url: `https://api.nexusmods.com/v1/games/skyrimspecialedition/mods/${index}`,
        capturedAt: '2026-07-07T09:00:00.000Z',
        status: 'captured' as const,
        summary: 'snapshot raw text '.repeat(500),
        trust: 'untrusted-external-content' as const,
        instructionsAllowed: false as const,
        cache: {
          rawBody: 'cache raw text '.repeat(500)
        }
      })),
      sources,
      issues: Array.from({ length: 80 }, (_, index) => ({
        id: `issue-${index}`,
        rawDetails: 'issue raw text '.repeat(500)
      }))
    };
    const message = createAiMessage(
      'assistant',
      `Начало отчета.\n${'тяжелый ответ '.repeat(12_000)}\nКонец отчета.`,
      new Date('2026-07-07T09:00:01Z'),
      'run-large-requirements',
      {
        researchReport,
        sources
      }
    );
    const sessionWithHeavyMessage = syncAiSessionToActiveChat({
      ...session,
      activeChatId: chat.id,
      chats: [
        {
          ...chat,
          messages: [message],
          updatedAt: message.createdAt
        }
      ],
      messages: [message]
    });

    const compactSession = compactAiSessionForStorage(sessionWithHeavyMessage);
    saveAiSession(storage, sessionWithHeavyMessage);
    const storageKey = aiSessionStorageKey(aiSessionScopeKey(scope));
    const persisted = JSON.parse(storage.values.get(storageKey) ?? '{}') as typeof compactSession;
    const persistedMessage = persisted.messages[0];
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      }
    };

    expect(compactSession.messages[0]?.text).toContain('[Truncated to keep Fluxora responsive.]');
    expect(persistedMessage?.researchReport?.targets).toHaveLength(24);
    expect(persistedMessage?.researchReport?.snapshots).toHaveLength(32);
    expect(persistedMessage?.researchReport?.sources).toHaveLength(80);
    expect(persistedMessage?.sources).toHaveLength(80);
    expect(JSON.stringify(persisted)).not.toContain('should-not-persist');
    expect(JSON.stringify(persisted)).not.toContain('cache raw text');
    expect(() => saveAiSession(throwingStorage, sessionWithHeavyMessage)).not.toThrow();
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
      auditScope: 'full-build-requirements',
      maxNexusTargets: 1000,
      maxNexusInitialTargets: 1000,
      maxNexusApiRequests: 2500
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
    expect(messages).toEqual(['Остановлено']);
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
          countedAt: '2026-06-30T00:00:00.000Z',
          trace: {
            schema: 'fluxora.ai.context-usage-trace.v1',
            policyDecisionsUseIntentRouter: true,
            routingSchemas: ['fluxora.ai.intent-route.v1', 'fluxora.ai.mod-research-route.v1']
          }
        },
        intentRoute: {
          schema: 'fluxora.ai.intent-route.v1',
          promptLanguage: 'en',
          replyLanguage: 'en',
          confidence: 0.94,
          signals: [
            {
              kind: 'semantic-requirement',
              value: 'requirements/dependencies',
              confidence: 0.88,
              source: 'multilingual-examples'
            }
          ],
          canonicalIntent: 'requirement-audit',
          scope: 'full-build-requirements',
          explicitTargets: [],
          nexusApiRequested: true,
          publicWebRequested: false,
          requiresExternalNetwork: true,
          clarificationRequired: false
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
          expect(message.contextUsage?.trace?.policyDecisionsUseIntentRouter).toBe(true);
          expect(message.intentRoute?.canonicalIntent).toBe('requirement-audit');
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

  it('retries a retryable AI host transport fallback once before finishing', async () => {
    vi.useFakeTimers();
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_chat_retry', 'check plugins');
    const stages: string[] = [];
    const statuses: string[] = [];
    const messages: string[] = [];
    const retryableResponse = {
      operationId: run.operationId,
      providerId: 'local-dry-run',
      modelId: 'local-dry-run',
      routingPreset: 'free-demo',
      status: 'blocked',
      text: 'AI host is unavailable.',
      streamChunks: [{ index: 0, text: 'AI host is unavailable.' }],
      sources: [],
      costEstimate: null,
      ledgerEntry: undefined,
      fallbackProviders: [],
      taskPlan: null,
      subagentSchedule: null,
      selectedSkill: null,
      toolCallsAllowed: false,
      error: {
        code: 'ai.host.unavailable',
        message: 'AI host is unavailable.',
        category: 'transport',
        retryable: true,
        capabilityId: null,
        details: {}
      }
    };
    const successfulResponse = {
      operationId: run.operationId,
      providerId: 'gemini',
      modelId: 'gemini-3.1-flash-lite',
      routingPreset: 'byok',
      status: 'done',
      text: 'Recovered answer.',
      streamChunks: [{ index: 0, text: 'Recovered answer.' }],
      sources: [],
      costEstimate: null,
      ledgerEntry: undefined,
      fallbackProviders: [],
      taskPlan: null,
      subagentSchedule: null,
      selectedSkill: null,
      toolCallsAllowed: false
    };
    const aiApi = {
      onRunEvent: vi.fn(() => () => undefined),
      chatRespond: vi.fn()
        .mockResolvedValueOnce(retryableResponse)
        .mockResolvedValueOnce(successfulResponse)
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
        onRunEvent: (event) => stages.push(event.stage),
        onFinish: (message, _event, status) => {
          statuses.push(status);
          messages.push(message.text);
        }
      }
    );

    await vi.runAllTimersAsync();

    expect(aiApi.chatRespond).toHaveBeenCalledTimes(2);
    expect(stages).toEqual(['prompt-preparation', 'host-retry']);
    expect(statuses).toEqual(['done']);
    expect(messages).toEqual(['Recovered answer.']);
  });

  it('finishes with a fallback assistant error message when the host returns no assistant text', async () => {
    vi.useFakeTimers();
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(session, 'op_ai_chat_empty_final', 'check plugins');
    const events: string[] = [];
    const messages: string[] = [];
    const diagnostics: string[] = [];
    const statuses: string[] = [];
    const aiApi = {
      onRunEvent: vi.fn(() => () => undefined),
      chatRespond: vi.fn(async () => ({
        operationId: run.operationId,
        providerId: 'gemini',
        modelId: 'gemini-3.1-flash-lite',
        routingPreset: 'byok',
        status: 'blocked',
        text: '',
        streamChunks: [],
        sources: [],
        costEstimate: null,
        ledgerEntry: undefined,
        fallbackProviders: [],
        taskPlan: null,
        subagentSchedule: null,
        selectedSkill: null,
        toolCallsAllowed: false,
        error: {
          code: 'ai.host.empty_final',
          message: 'AI host completed without an assistant message.',
          category: 'provider',
          retryable: false,
          capabilityId: null,
          details: {}
        }
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
        onEvent: (event) => events.push(event.type),
        onFinish: (message, event, status) => {
          events.push(event.type);
          statuses.push(status);
          messages.push(message.text);
          diagnostics.push(...(message.providerDiagnostics ?? []));
        }
      }
    );

    await vi.runAllTimersAsync();

    expect(aiApi.chatRespond).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toBe('run-finished');
    expect(statuses).toEqual(['blocked']);
    expect(messages).toEqual([
      'AI provider response was unavailable. Check Settings > AI or retry later.'
    ]);
    expect(diagnostics).toEqual([
      'AI provider response was unavailable. Check Settings > AI or retry later.'
    ]);
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
    expect(forwarded.map((event) => event.stage)).toEqual([
      'prompt-preparation',
      'provider-attempt'
    ]);
    expect(canonicalProgress).toHaveLength(2);
    expect(canonicalProgress[1]).toMatchObject({
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

  it('does not mark auth-blocked Nexus investigations as completed Nexus passes', async () => {
    vi.useFakeTimers();
    const session = createAiSessionForScope({ projectId: 'skyrim-main' });
    const run = createAiRunForPrompt(
      session,
      'op_ai_nexus_auth_blocked',
      'Проверь требования модов через Nexus API'
    );
    const generatedAt = new Date('2026-07-06T09:00:00Z');
    const localInspection = createAiLocalInspection({
      operationId: 'op_ai_nexus_auth_blocked',
      generatedAt,
      needMoreLocalData: false,
      missingFields: [],
      deterministicFindings: [],
      hypotheses: [],
      suspect_mods: [],
      evidenceCards: []
    });
    const nexusInvestigation = createAiNexusInvestigation({
      operationId: 'op_ai_nexus_auth_blocked',
      generatedAt,
      targetNexusIds: ['skyrimspecialedition:48'],
      api: {
        state: 'unauthenticated',
        unavailableReason: 'missing-credential',
        lastHttpStatus: 401,
        retryAfterSeconds: null
      },
      quota: {
        hourlyRemaining: null,
        dailyRemaining: null,
        resetAt: null,
        source: 'not-provided'
      },
      ordinaryError: null,
      deterministicFindings: [],
      hypotheses: [],
      evidenceCards: []
    });
    const aiApi = {
      onRunEvent: vi.fn(() => () => undefined),
      chatRespond: vi.fn(async () => ({
        operationId: 'op_ai_nexus_auth_blocked',
        providerId: 'gemini',
        modelId: 'gemini-3.1-flash-lite',
        routingPreset: 'byok',
        status: 'blocked',
        text: 'Nexus API auth is unavailable.',
        streamChunks: [{ index: 0, text: 'Nexus API auth is unavailable.' }],
        sources: [],
        costEstimate: null,
        ledgerEntry: undefined,
        fallbackProviders: [],
        localInspection,
        nexusInvestigation,
        taskPlan: null,
        subagentSchedule: null,
        selectedSkill: null,
        toolCallsAllowed: false
      }))
    } as unknown as FluxoraApi['ai'];
    const caseStates: string[] = [];

    startHostAiRun(
      run,
      session,
      'Проверь требования модов через Nexus API',
      aiApi,
      {
        modelId: 'gemini-3.1-flash-lite',
        routingPreset: 'byok',
        providerId: 'gemini'
      },
      {
        onEvent: () => undefined,
        onFinish: (message) => {
          caseStates.push(message.caseState?.caseState ?? '');
        }
      }
    );

    await vi.runAllTimersAsync();

    expect(caseStates).toEqual(['local-inspection-complete']);
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
        fallbackProviders: ['gemini:contextLimit'],
        taskPlan: null,
        subagentSchedule: null,
        selectedSkill: null,
        toolCallsAllowed: false
      } as never)
    ).toEqual([
      'Fluxora fell back to Local dry run: Google Gemini context limit was reached after compression.'
    ]);

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
        fallbackProviders: ['gemini:temporaryProvider'],
        taskPlan: null,
        subagentSchedule: null,
        selectedSkill: null,
        toolCallsAllowed: false
      } as never)
    ).toEqual(['Fluxora fell back to Local dry run: Google Gemini is temporarily unavailable.']);
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

  it('blocks progress-only host runs that finish without a visible answer', async () => {
    vi.useFakeTimers();
    const prompt = 'Привет';
    const session = createAiSessionForScope(
      { buildLabel: 'Skyrim Main', projectId: 'skyrim-main' },
      new Date('2026-07-06T09:00:00Z')
    );
    let state = aiChatReducer(initialAiChatState, { type: 'restore-session', session });
    const run = createAiRunForPrompt(
      state.session,
      'op_ai_empty_host_output',
      prompt,
      new Date('2026-07-06T09:00:01Z')
    );
    state = aiChatReducer(
      { ...state, draft: prompt },
      {
        type: 'submit-user-message',
        message: createAiMessage('user', prompt, new Date('2026-07-06T09:00:01Z'), run.id),
        run,
        event: createAiStreamEvent(run, 'run-created', {
          now: new Date('2026-07-06T09:00:01Z'),
          status: 'thinking'
        })
      }
    );

    let runEventListener: ((event: FluxoraAiIntermediateEvent) => void) | null = null;
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
            eventId: 'event-progress-only',
            runId: run.id,
            operationId: run.operationId,
            seq: 2,
            createdAt: '2026-07-06T09:00:02.000Z',
            stage: 'provider-attempt',
            message: 'Waiting for AI host progress.',
            percent: 85
          })
        );

        return {
          operationId: run.operationId,
          providerId: 'gemini',
          modelId: 'gemini-3.1-flash-lite',
          routingPreset: 'byok',
          status: 'done',
          text: '',
          streamChunks: [],
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
      state.session,
      prompt,
      aiApi,
      {
        modelId: 'gemini-3.1-flash-lite',
        providerId: 'gemini',
        routingPreset: 'byok'
      },
      {
        onEvent: (event) => {
          state = aiChatReducer(state, { type: 'apply-stream-event', event });
        },
        onRunEvent: (event) => {
          state = aiChatReducer(state, { type: 'apply-run-event', event });
        },
        onFinish: (message, event, status) => {
          state = aiChatReducer(state, {
            type: 'append-assistant-message',
            message,
            event,
            status
          });
        }
      }
    );

    await vi.runAllTimersAsync();

    const assistantMessages = state.messages.filter((message) => message.role === 'assistant');
    expect(state.intermediateEvents.map((event) => event.stage)).toContain('provider-attempt');
    expect(state.streamEvents.some((event) => event.type === 'run-finished')).toBe(true);
    expect(state.isRunning).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.status).toBe('blocked');
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.agentStatus).toBe('blocked');
    expect(assistantMessages[0]?.text.trim()).not.toBe('');
  });

  it('preserves partial blocked orchestration metadata from host responses', async () => {
    vi.useFakeTimers();
    const prompt = 'Проверь все моды на наличие всех требований';
    const session = createAiSessionForScope(
      { buildLabel: 'Large Skyrim Build', projectId: 'large-skyrim-build' },
      new Date('2026-07-07T09:00:00Z')
    );
    const run = createAiRunForPrompt(
      session,
      'op_ai_partial_orchestration',
      prompt,
      new Date('2026-07-07T09:00:01Z')
    );
    let finishedMessage: AiMessage | null = null;
    let finishedStatus: string | null = null;
    const aiApi = {
      onRunEvent: vi.fn(() => () => undefined),
      chatRespond: vi.fn(async () => ({
        operationId: run.operationId,
        providerId: 'gemini',
        modelId: 'gemini-3.1-flash-lite',
        routingPreset: 'byok',
        status: 'blocked',
        text: 'Fluxora preserved one worker result, but final synthesis hit the context limit.',
        streamChunks: [],
        sources: [],
        costEstimate: null,
        ledgerEntry: undefined,
        fallbackProviders: ['gemini:contextLimit'],
        contextUsage: {
          schema: 'fluxora.ai.context-usage.v1',
          operationId: run.operationId,
          providerId: 'gemini',
          modelId: 'gemini-3.1-flash-lite',
          contextWindowTokens: 1_000,
          currentContextTokens: 900,
          currentContextPercent: 90,
          precision: 'exact',
          level: 'high',
          mode: 'strict',
          includedSections: ['system-instructions', 'context-continuation'],
          autoCompressionApplied: true,
          compressionLevel: 4,
          actionRequired: false,
          countedAt: '2026-07-07T09:00:02.000Z'
        },
        orchestration: {
          schema: 'fluxora.ai.multi-model-orchestration.v1',
          generatedAt: '2026-07-07T09:00:02.000Z',
          operationId: run.operationId,
          mode: 'chef-first',
          strategy: 'chef-dispatch-then-parallel-subagents-then-chef-synthesis',
          status: 'partial',
          terminalStage: 'chef-final',
          contextContinuationApplied: true,
          chef: {
            agentId: 'chef-orchestrator',
            label: 'Chef orchestrator',
            providerId: 'gemini',
            modelId: 'gemini-3.1-flash-lite',
            status: 'final-blocked',
            durationMs: 12,
            finalDurationMs: 18,
            dispatchPlan: 'Dispatch requirement checks.'
          },
          subagents: [
            {
              agentId: 'dependency-auditor',
              durationMs: 35,
              error: null,
              label: 'Missing master dependency auditor',
              modelId: 'gemini-2.5-flash-lite',
              providerId: 'gemini',
              status: 'completed',
              text: 'Worker summary retained.'
            }
          ],
          attemptedSubagentCount: 1,
          completedSubagentCount: 1,
          blockedSubagentCount: 0,
          policy: {
            finalAnswerByChef: true,
            subagentOutputTrustedAsInstructions: false,
            requiresGroundedFacts: true,
            mutationsAllowed: false,
            askUserOnlyIfBlocked: true
          }
        },
        orchestrationDecision: {
          schema: 'fluxora.ai.orchestration-decision.v1',
          generatedAt: '2026-07-07T09:00:02.000Z',
          operationId: run.operationId,
          reason: 'partial-worker-evidence',
          attempted: true,
          completed: false,
          attemptedSubagentCount: 1,
          completedSubagentCount: 1,
          blockedSubagentCount: 0,
          terminalStage: 'chef-final',
          contextContinuationApplied: true
        },
        taskPlan: null,
        subagentSchedule: null,
        selectedSkill: null,
        toolCallsAllowed: false,
        error: {
          code: 'ai.provider.fallback',
          message: 'final synthesis hit context limit',
          category: 'transport',
          retryable: false,
          capabilityId: null
        }
      }))
    } as unknown as FluxoraApi['ai'];

    startHostAiRun(
      run,
      session,
      prompt,
      aiApi,
      {
        modelId: 'gemini-3.1-flash-lite',
        providerId: 'gemini',
        routingPreset: 'byok'
      },
      {
        onEvent: () => undefined,
        onRunEvent: () => undefined,
        onFinish: (message, _event, status) => {
          finishedMessage = message;
          finishedStatus = status;
        }
      }
    );

    await vi.runAllTimersAsync();

    expect(finishedStatus).toBe('blocked');
    expect(finishedMessage).not.toBeNull();
    const message = finishedMessage as unknown as AiMessage;
    expect(message.orchestration?.status).toBe('partial');
    expect(message.orchestration?.subagents[0]?.text).toBe('Worker summary retained.');
    expect(message.orchestrationDecision?.reason).toBe('partial-worker-evidence');
    expect(message.orchestrationDecision?.contextContinuationApplied).toBe(true);
    expect(message.contextUsage?.compressionLevel).toBe(4);
    expect(message.providerDiagnostics).toEqual([
      'AI provider response was unavailable. Check Settings > AI or retry later.'
    ]);
  });
});
