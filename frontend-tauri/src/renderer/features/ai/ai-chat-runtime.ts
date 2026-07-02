import {
  activeAiChatThread,
  createAiChatThread,
  createAiMessage,
  createAiRun,
  createAiSession,
  createAiStreamEvent,
  createFakeAiRunPlan,
  createAiChatTitleFromPrompt,
  syncAiSessionToActiveChat,
  type AiAgentStatus,
  type AiChatThread,
  type AiRun,
  type AiSession,
  type AiStreamEvent
} from './ai-chat-state';
import type {
  FluxoraAiCaseState,
  FluxoraAiChatResponse,
  FluxoraAiCitation,
  FluxoraAiCostLedgerEntry,
  FluxoraAiDiagnosisJudge,
  FluxoraAiResearchRequest,
  FluxoraAiRoutingPreset,
  FluxoraApi
} from '../../../shared/fluxora-api';
import { createFluxoraAiTaskPlanningBundle } from '../../../shared/ai-task-planner';
import { compressAiCaseState } from '../../../shared/ai-mod-research-pipeline';
import { LOCAL_DRY_RUN_MODEL_ID, LOCAL_DRY_RUN_PROVIDER_ID } from './ai-chat-settings';
import {
  serializeAiBuildContextSnapshot,
  type AiBuildContextSnapshot
} from './ai-build-tools';
import {
  attachAiAutonomousJobPlan,
  blockAiAutonomousJob,
  cancelAiAutonomousJob,
  checkpointAiAutonomousJob,
  completeAiAutonomousJob,
  createAiAutonomousJob,
  heartbeatAiAutonomousJob,
  persistAiAutonomousJob,
  recordAiAutonomousProgress,
  startAiAutonomousJob,
  type AiAutonomousJobStorage
} from './ai-autonomous-jobs';

export interface AiSessionScope {
  buildLabel?: string | null;
  configPath?: string | null;
  projectDirectory?: string | null;
  projectId?: string | null;
}

export interface AiPromptFingerprint {
  digest: string;
  length: number;
}

export type AiRuntimeLogChannel = 'tauri-ui' | 'tauri-bridge' | 'ai-host' | 'operations';

export interface AiRuntimeLogEntry {
  category: string;
  channel: AiRuntimeLogChannel;
  level: 'info' | 'warning' | 'error';
  message: string;
  operationId?: string;
}

export interface AiSupportBundleSnapshot {
  generatedAt: string;
  sessions: Array<{
    buildLabel: string;
    chatCount: number;
    chats: Array<{
      costLedgerCount: number;
      id: string;
      messageCount: number;
      messages: Array<{
        createdAt: string;
        id: string;
        role: string;
        runId?: string;
        text?: string;
        textRedacted: boolean;
      }>;
      runCount: number;
      streamEventCount: number;
      title: string;
    }>;
    id: string;
    messageCount: number;
    costLedgerCount: number;
    messages: Array<{
      createdAt: string;
      id: string;
      role: string;
      runId?: string;
      text?: string;
      textRedacted: boolean;
    }>;
    runCount: number;
    runs: Array<{
      createdAt: string;
      id: string;
      operationId: string;
      promptDigest: string;
      promptLength: number;
      state: string;
      status: AiAgentStatus;
      updatedAt: string;
    }>;
    scopeKey: string;
    streamEventCount: number;
  }>;
}

export interface AiLocalRunCallbacks {
  onEvent: (event: AiStreamEvent) => void;
  onFinish: (
    message: ReturnType<typeof createAiMessage>,
    event: AiStreamEvent,
    status: AiAgentStatus,
    ledgerEntry?: FluxoraAiCostLedgerEntry,
    response?: FluxoraAiChatResponse
  ) => void;
  onLog?: (entry: AiRuntimeLogEntry) => void;
}

export interface AiLocalRunHandle {
  cancel: () => void;
  dispose: () => void;
}

export interface AiHostRunSettings {
  buildContextSnapshot?: AiBuildContextSnapshot;
  jobStorage?: AiAutonomousJobStorage;
  modelId: string;
  modelSupportsBackground?: boolean;
  providerId?: string;
  routingPreset: FluxoraAiRoutingPreset;
}

interface AiSessionStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const AI_SESSION_STORAGE_PREFIX = 'fluxora.ai.chat.session.v1';

const normalizeScopePart = (value: string | null | undefined) => value?.trim() || '';

const stableHash = (value: string): string => {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36).padStart(7, '0');
};

export const createAiPromptFingerprint = (prompt: string): AiPromptFingerprint => ({
  digest: stableHash(prompt),
  length: prompt.length
});

export const aiSessionScopeKey = (scope: AiSessionScope): string => {
  const identity =
    normalizeScopePart(scope.projectId) ||
    normalizeScopePart(scope.configPath) ||
    normalizeScopePart(scope.projectDirectory) ||
    'global';

  return `build-${stableHash(identity)}`;
};

export const aiSessionBuildLabel = (scope: AiSessionScope): string =>
  normalizeScopePart(scope.buildLabel) || 'No build selected';

export const aiSessionStorageKey = (scopeKey: string): string =>
  `${AI_SESSION_STORAGE_PREFIX}.${scopeKey}`;

export const createAiSessionForScope = (scope: AiSessionScope, now = new Date()): AiSession =>
  createAiSession(aiSessionScopeKey(scope), aiSessionBuildLabel(scope), now);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isPersistedAiSession = (value: unknown): value is AiSession => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.scopeKey === 'string' &&
    typeof value.buildLabel === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.messages) &&
    Array.isArray(value.runs) &&
    Array.isArray(value.streamEvents)
  );
};

const isPersistedAiChatThread = (value: unknown): value is AiChatThread => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.messages) &&
    Array.isArray(value.runs) &&
    Array.isArray(value.streamEvents)
  );
};

const normalizePersistedAiChatThread = (chat: AiChatThread): AiChatThread => ({
  ...chat,
  costLedger: Array.isArray(chat.costLedger) ? chat.costLedger : []
});

const normalizePersistedAiSession = (session: AiSession): AiSession => {
  const rawSession = session as AiSession & { activeChatId?: unknown; chats?: unknown };
  const rootCostLedger = Array.isArray(session.costLedger) ? session.costLedger : [];
  const persistedChats = Array.isArray(rawSession.chats)
    ? rawSession.chats.filter(isPersistedAiChatThread).map(normalizePersistedAiChatThread)
    : [];
  const legacyChat =
    persistedChats.length > 0
      ? null
      : {
          ...createAiChatThread(session.scopeKey, new Date(session.createdAt)),
          id: `ai-chat-${session.scopeKey}-legacy`,
          title: session.messages.find((message) => message.role === 'user')
            ? createAiChatTitleFromPrompt(
                session.messages.find((message) => message.role === 'user')?.text ?? ''
              )
            : 'New chat',
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          costLedger: rootCostLedger,
          messages: session.messages,
          runs: session.runs,
          streamEvents: session.streamEvents
        };
  const chats = legacyChat ? [legacyChat] : persistedChats;
  const activeChatId =
    typeof rawSession.activeChatId === 'string' && chats.some((chat) => chat.id === rawSession.activeChatId)
      ? rawSession.activeChatId
      : chats[0]?.id ?? `ai-chat-${session.scopeKey}-legacy`;

  return syncAiSessionToActiveChat({
    ...session,
    activeChatId,
    chats,
    costLedger: rootCostLedger
  });
};

const recoverAiChatAfterRestart = (chat: AiChatThread, now: Date): AiChatThread => {
  const activeRuns = chat.runs.filter((run) => run.state === 'queued' || run.state === 'streaming');
  if (activeRuns.length === 0) {
    return chat;
  }

  return activeRuns.reduce((nextChat, run) => {
    const event = createAiStreamEvent(run, 'run-recovered', {
      now,
      status: 'blocked'
    });
    const message = createAiMessage(
      'assistant',
      'Local AI run was interrupted during refresh. Start it again when you are ready.',
      now,
      run.id
    );

    return {
      ...nextChat,
      updatedAt: message.createdAt,
      messages: [...nextChat.messages, message],
      runs: nextChat.runs.map((candidate) =>
        candidate.id === run.id
          ? {
              ...candidate,
              eventIds: [...candidate.eventIds, event.id],
              state: 'recovered',
              status: 'blocked',
              updatedAt: event.createdAt
          }
          : candidate
      ),
      streamEvents: [...nextChat.streamEvents, event]
    };
  }, chat);
};

export const recoverAiSessionAfterRestart = (session: AiSession, now = new Date()): AiSession => {
  const normalizedSession = syncAiSessionToActiveChat(session);
  const chats = normalizedSession.chats.map((chat) => recoverAiChatAfterRestart(chat, now));

  return syncAiSessionToActiveChat({
    ...normalizedSession,
    chats
  });
};

export const loadAiSession = (
  storage: AiSessionStorage | undefined,
  scope: AiSessionScope,
  now = new Date()
): AiSession => {
  if (!storage) {
    return createAiSessionForScope(scope, now);
  }

  const scopeKey = aiSessionScopeKey(scope);
  const stored = storage.getItem(aiSessionStorageKey(scopeKey));
  if (!stored) {
    return createAiSession(aiSessionScopeKey(scope), aiSessionBuildLabel(scope), now);
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (isPersistedAiSession(parsed)) {
      return recoverAiSessionAfterRestart(
        normalizePersistedAiSession({
          ...parsed,
          buildLabel: aiSessionBuildLabel(scope)
        }),
        now
      );
    }
  } catch {
    return createAiSessionForScope(scope, now);
  }

  return createAiSessionForScope(scope, now);
};

export const saveAiSession = (storage: AiSessionStorage | undefined, session: AiSession): void => {
  if (!storage) {
    return;
  }

  storage.setItem(aiSessionStorageKey(session.scopeKey), JSON.stringify(session));
};

export const redactAiTextForLog = (value: string): string =>
  value
    .replace(/\b(?:sk|pk|api|key)-[A-Za-z0-9_-]{12,}\b/g, '[redacted-secret]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [redacted-secret]')
    .replace(/\b(api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted-secret]')
    .replace(/\s+/g, ' ')
    .trim();

export const createAiRuntimeLogEntries = (
  eventName: string,
  run: Pick<AiRun, 'id' | 'operationId' | 'promptDigest' | 'promptLength' | 'sessionId' | 'status'>,
  level: AiRuntimeLogEntry['level'] = 'info'
): AiRuntimeLogEntry[] => {
  const safeEventName = redactAiTextForLog(eventName);
  const message =
    `event=${safeEventName} session=${run.sessionId} run=${run.id} status=${run.status} ` +
    `promptLength=${run.promptLength} promptDigest=${run.promptDigest}`;

  return [
    {
      category: 'AI.UI',
      channel: 'tauri-ui',
      level,
      message,
      operationId: run.operationId
    },
    {
      category: 'AI.Bridge',
      channel: 'tauri-bridge',
      level,
      message: `${message} bridge=not-used-local-runtime`,
      operationId: run.operationId
    },
    {
      category: 'AI.Host',
      channel: 'ai-host',
      level,
      message: `${message} host=fake-local`,
      operationId: run.operationId
    },
    {
      category: 'AI.Operation',
      channel: 'operations',
      level,
      message,
      operationId: run.operationId
    }
  ];
};

const promptNeedsExternalResearch = (prompt: string): boolean => {
  const normalized = prompt.trim().toLowerCase();
  return (
    normalized.includes('nexusmods.com') ||
    normalized.includes('nxm://') ||
    (normalized.includes('nexus') &&
      (normalized.includes('compat') ||
        normalized.includes('research') ||
        normalized.includes('check') ||
        normalized.includes('dependencies') ||
        normalized.includes('\u0441\u043e\u0432\u043c\u0435\u0441\u0442') ||
        normalized.includes('\u043f\u0440\u043e\u0432\u0435\u0440\u044c')))
  );
};

export const createAiResearchRequestForPrompt = (
  prompt: string,
  _routingPreset: FluxoraAiRoutingPreset
): FluxoraAiResearchRequest | undefined => {
  if (!promptNeedsExternalResearch(prompt)) {
    return undefined;
  }

  return {
    enabled: true,
    mode: 'nexus-api-first',
    allowAuthenticatedPages: false,
    allowBrowserSandbox: false,
    allowGeminiGoogleSearch: true,
    allowPublicWebFetch: false,
    deepResearchApproved: false
  };
};

export const createAiSupportBundleSnapshot = (
  sessions: AiSession[],
  options: { includeRawPrompts?: boolean; now?: Date } = {}
): AiSupportBundleSnapshot => {
  const serializeMessages = (messages: AiSession['messages']) =>
    messages.map((message) => ({
      createdAt: message.createdAt,
      id: message.id,
      role: message.role,
      runId: message.runId,
      text: options.includeRawPrompts ? message.text : undefined,
      textRedacted: !options.includeRawPrompts
    }));

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    sessions: sessions.map((rawSession) => {
      const session = syncAiSessionToActiveChat(rawSession);
      return {
        buildLabel: session.buildLabel,
        chatCount: session.chats.length,
        chats: session.chats.map((chat) => ({
          costLedgerCount: chat.costLedger?.length ?? 0,
          id: chat.id,
          messageCount: chat.messages.length,
          messages: serializeMessages(chat.messages),
          runCount: chat.runs.length,
          streamEventCount: chat.streamEvents.length,
          title: chat.title
        })),
        id: session.id,
        messageCount: session.messages.length,
        messages: serializeMessages(session.messages),
        runCount: session.runs.length,
        costLedgerCount: session.costLedger?.length ?? 0,
        runs: session.runs.map((run) => ({
          createdAt: run.createdAt,
          id: run.id,
          operationId: run.operationId,
          promptDigest: run.promptDigest,
          promptLength: run.promptLength,
          state: run.state,
          status: run.status,
          updatedAt: run.updatedAt
        })),
        scopeKey: session.scopeKey,
        streamEventCount: session.streamEvents.length
      };
    })
  };
};

const providerFallbackLabel = (fallback: string): string => {
  const [providerId, reason = 'fallback'] = fallback.split(':');
  const providerLabel =
    providerId === 'gemini'
      ? 'Google Gemini'
      : providerId;

  if (reason === 'missingCredential') {
    return `${providerLabel} key is missing`;
  }

  if (reason.startsWith('status')) {
    return `${providerLabel} returned HTTP ${reason.slice('status'.length) || 'error'}`;
  }

  if (reason === 'balance') {
    return `${providerLabel} balance or quota is unavailable`;
  }

  if (reason === 'credentialRejected') {
    return `${providerLabel} key was rejected`;
  }

  if (reason.startsWith('simulatedStatus')) {
    return `${providerLabel} simulated HTTP ${reason.slice('simulatedStatus'.length) || 'error'}`;
  }

  if (providerId === 'contextGraph') {
    return 'Local context graph was unavailable';
  }

  return `${providerLabel}: ${reason}`;
};

const isProviderFallback = (fallback: string): boolean =>
  fallback.includes(':') && !fallback.startsWith('contextGraph:');

const responseUsedLocalDryRun = (response: FluxoraAiChatResponse): boolean =>
  response.providerId === LOCAL_DRY_RUN_PROVIDER_ID || response.modelId === LOCAL_DRY_RUN_MODEL_ID;

const responseHasProviderFallback = (response: FluxoraAiChatResponse): boolean =>
  response.fallbackProviders.some(isProviderFallback);

export const aiResponseDiagnosticMessages = (response: FluxoraAiChatResponse): string[] => {
  const diagnostics: string[] = [];

  if (responseUsedLocalDryRun(response)) {
    if (responseHasProviderFallback(response)) {
      diagnostics.push(
        `Fluxora fell back to Local dry run: ${response.fallbackProviders
          .filter(isProviderFallback)
          .map(providerFallbackLabel)
          .join('; ')}.`
      );
    } else {
      diagnostics.push(
        'Local dry run generated this template. Connect a provider key and select that model in Settings > AI for real replies.'
      );
    }
  }

  if (response.error?.message) {
    diagnostics.push('AI provider response was unavailable. Check Settings > AI or retry later.');
  }

  return [...new Set(diagnostics)];
};

const responseStatusToAgentStatus = (response: FluxoraAiChatResponse): AiAgentStatus =>
  response.status === 'needs-approval'
    ? 'needs-approval'
    : response.status === 'blocked' ||
        response.error ||
        (responseUsedLocalDryRun(response) && responseHasProviderFallback(response))
      ? 'blocked'
      : 'done';

const streamChunksFromResponse = (response: FluxoraAiChatResponse): string[] => {
  const chunks = response.streamChunks
    .slice()
    .sort((left, right) => left.index - right.index)
    .map((chunk) => chunk.text)
    .filter(Boolean);

  return chunks.length > 0 ? chunks : [response.text];
};

const uniqueAiRuntimeStrings = (values: Array<string | null | undefined>): string[] =>
  values.reduce<string[]>((items, value) => {
    const trimmed = value?.trim();
    if (trimmed && !items.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      items.push(trimmed);
    }
    return items;
  }, []);

const userPrefersRussian = (prompt: string): boolean => /[А-Яа-яЁё]/.test(prompt);

const confidenceLabel = (confidence: number, russian: boolean): string => {
  if (confidence >= 0.82) {
    return russian ? 'высокая' : 'high';
  }
  if (confidence >= 0.62) {
    return russian ? 'средняя' : 'medium';
  }
  if (confidence > 0) {
    return russian ? 'низкая' : 'low';
  }
  return russian ? 'недостаточно данных' : 'insufficient evidence';
};

const localizedQuotaLimitation = (caseState: FluxoraAiCaseState, russian: boolean): string | null => {
  const quota = caseState.quotaState;
  if (!quota.limitation) {
    return null;
  }
  if (!russian) {
    return quota.limitation;
  }
  if (quota.nexusApiState === 'quota-exhausted') {
    return 'Лимит Nexus API исчерпан или сработал rate limit; это ограничение исследования, а не обычная ошибка.';
  }
  if (quota.nexusApiState === 'unauthenticated' || quota.unavailableReason === 'missing-credential') {
    return 'У Fluxora нет доступных учетных данных Nexus API, поэтому Nexus-доказательства могут быть неполными.';
  }
  if (quota.nexusApiState === 'unavailable') {
    return 'Nexus API сейчас недоступен, поэтому Nexus-доказательства могут быть неполными.';
  }
  return 'Nexus API был ограничен для этого прохода; учитывай это как ограничение исследования.';
};

const evidenceIdsForStructuredFinal = (
  diagnosis: FluxoraAiDiagnosisJudge,
  caseState: FluxoraAiCaseState
): string[] => {
  const topCause = diagnosis.rankedCauses[0];
  return uniqueAiRuntimeStrings([
    ...(topCause?.supportingEvidenceIds ?? []),
    ...(topCause?.opposingEvidenceIds ?? []),
    ...caseState.sourceIds
  ]).slice(0, 12);
};

const evidenceReferenceText = (evidenceIds: readonly string[], russian: boolean): string =>
  evidenceIds.length > 0
    ? `${russian ? 'Доказательства' : 'Evidence'}: ${evidenceIds.map((id) => `[${id}]`).join(', ')}.`
    : '';

const stripFactPrefix = (fact: string): string =>
  fact.replace(/^Confirmed:\s*/i, '').replace(/^Probable but unconfirmed:\s*/i, '').trim();

const structuredNextStepLabel = (
  nextStage: FluxoraAiCaseState['nextRecommendedStage'],
  russian: boolean
): string => {
  const labels: Record<FluxoraAiCaseState['nextRecommendedStage'], string> = russian
    ? {
        'run-nexus-pass': 'сначала завершить Nexus-проверку',
        'run-external-pass': 'собрать разрешенные внешние источники',
        'run-diagnosis': 'запустить structured diagnosis',
        'write-final-answer': 'сформировать финальный ответ по ranked diagnosis',
        complete: 'дело уже доведено до финального ответа',
        blocked: 'нужно больше подтвержденных данных'
      }
    : {
        'run-nexus-pass': 'finish the Nexus pass first',
        'run-external-pass': 'collect allowed external sources',
        'run-diagnosis': 'run structured diagnosis',
        'write-final-answer': 'write the final answer from ranked diagnosis',
        complete: 'the final answer stage is complete',
        blocked: 'more confirmed evidence is needed'
      };
  return labels[nextStage];
};

export const structuredFinalAnswerFromResponse = (
  response: FluxoraAiChatResponse,
  prompt: string
): string | null => {
  const diagnosis = response.diagnosisJudge;
  const caseState = response.caseState;
  if (!diagnosis || !caseState) {
    return null;
  }

  const russian = userPrefersRussian(prompt);
  const topCause = diagnosis.rankedCauses[0];
  const evidenceIds = evidenceIdsForStructuredFinal(diagnosis, caseState);
  const evidenceText = evidenceReferenceText(evidenceIds, russian);
  const facts = caseState.resolvedFacts.map(stripFactPrefix).slice(0, 3);
  const limitation = localizedQuotaLimitation(caseState, russian);
  const openQuestion = caseState.openQuestions.find((question) => question !== caseState.quotaState.limitation);

  if (!topCause) {
    return russian
      ? [
          `1. Наиболее вероятная причина: пока не подтверждена structured diagnosis.`,
          facts.length > 0 ? `Подтверждено: ${facts.join(' ')}` : undefined,
          evidenceText,
          `2. Что сделать сейчас: ${structuredNextStepLabel(caseState.nextRecommendedStage, true)}.`,
          openQuestion ? `3. Если это не поможет: закрыть открытый вопрос: ${openQuestion}` : `3. Если это не поможет: собрать более сильное локальное или maintainer-доказательство.`,
          `4. Уверенность: 0% (${confidenceLabel(0, true)}).${limitation ? ` Ограничение: ${limitation}` : ''}`
        ]
          .filter(Boolean)
          .join('\n')
      : [
          `1. Most likely cause: not confirmed by structured diagnosis yet.`,
          facts.length > 0 ? `Confirmed: ${facts.join(' ')}` : undefined,
          evidenceText,
          `2. What to do now: ${structuredNextStepLabel(caseState.nextRecommendedStage, false)}.`,
          openQuestion ? `3. If that does not fix it: close the open question: ${openQuestion}` : `3. If that does not fix it: collect stronger local or maintainer evidence.`,
          `4. Confidence: 0% (${confidenceLabel(0, false)}).${limitation ? ` Limitation: ${limitation}` : ''}`
        ]
          .filter(Boolean)
          .join('\n');
  }

  const confidencePercent = Math.round(topCause.confidence * 100);
  const fixOrder = topCause.fixOrder.slice(1).join(russian ? ' Затем ' : ' Then ');
  return russian
    ? [
        `1. Наиболее вероятная причина: вероятно, ${topCause.cause} ${evidenceText}`,
        facts.length > 0 ? `Подтверждено: ${facts.join(' ')}` : undefined,
        `2. Что сделать сейчас: ${topCause.recommendedFix} Затем проверь: ${topCause.fastestValidationTest}`,
        `3. Если это не поможет: ${fixOrder || openQuestion || 'собери более сильное локальное или maintainer-доказательство и повтори diagnosis.'}`,
        `4. Уверенность: ${confidencePercent}% (${confidenceLabel(topCause.confidence, true)}).${limitation ? ` Ограничение: ${limitation}` : ''}`
      ]
        .filter(Boolean)
        .join('\n')
    : [
        `1. Most likely cause: probably ${topCause.cause} ${evidenceText}`,
        facts.length > 0 ? `Confirmed: ${facts.join(' ')}` : undefined,
        `2. What to do now: ${topCause.recommendedFix} Then verify: ${topCause.fastestValidationTest}`,
        `3. If that does not fix it: ${fixOrder || openQuestion || 'collect stronger local or maintainer evidence and run diagnosis again.'}`,
        `4. Confidence: ${confidencePercent}% (${confidenceLabel(topCause.confidence, false)}).${limitation ? ` Limitation: ${limitation}` : ''}`
      ]
        .filter(Boolean)
        .join('\n');
};

export const sourcesForStructuredFinalAnswer = (
  response: FluxoraAiChatResponse
): FluxoraAiCitation[] => {
  if (!response.diagnosisJudge || !response.caseState) {
    return response.sources;
  }
  const sources = [...response.sources];
  const sourceIds = new Set(sources.map((source) => source.id));
  for (const evidenceId of evidenceIdsForStructuredFinal(response.diagnosisJudge, response.caseState)) {
    if (!sourceIds.has(evidenceId)) {
      sourceIds.add(evidenceId);
      sources.push({
        id: evidenceId,
        title: evidenceId,
        url: '',
        kind: 'structured-evidence-id',
        provider: 'fluxora-case-state',
        trust: 'local-context'
      });
    }
  }
  return sources;
};

const streamChunksForFinalText = (
  response: FluxoraAiChatResponse,
  finalText: string
): string[] => (finalText === response.text ? streamChunksFromResponse(response) : [finalText]);

const compactCaseStateFromResponse = (
  response: FluxoraAiChatResponse
): FluxoraAiCaseState | null => {
  if (response.caseState) {
    return response.caseState;
  }
  const nexusInvestigation = response.nexusInvestigation ?? response.researchReport?.nexusInvestigation ?? null;
  const externalInvestigation = response.externalInvestigation ?? null;
  const caseState = response.diagnosisJudge
    ? 'diagnosis-complete'
    : externalInvestigation
      ? 'external-pass-complete'
      : nexusInvestigation
        ? 'nexus-pass-complete'
        : response.localInspection
          ? 'local-inspection-complete'
          : null;
  if (!caseState) {
    return null;
  }
  return compressAiCaseState({
    operationId: response.operationId,
    caseState,
    localInspection: response.localInspection ?? null,
    nexusInvestigation,
    externalInvestigation,
    diagnosis: response.diagnosisJudge ?? null
  });
};

const finalCaseStateFromResponse = (
  response: FluxoraAiChatResponse,
  compactCaseState: FluxoraAiCaseState | null,
  finalText: string
): FluxoraAiCaseState | null => {
  if (!response.diagnosisJudge || !compactCaseState) {
    return compactCaseState;
  }
  return compressAiCaseState({
    operationId: response.operationId,
    caseState: 'final-answer-complete',
    previousCaseState: compactCaseState,
    localInspection: response.localInspection ?? null,
    nexusInvestigation: response.nexusInvestigation ?? response.researchReport?.nexusInvestigation ?? null,
    externalInvestigation: response.externalInvestigation ?? null,
    diagnosis: response.diagnosisJudge,
    finalAnswer: finalText
  });
};

export const startHostAiRun = (
  run: AiRun,
  session: AiSession,
  prompt: string,
  aiApi: FluxoraApi['ai'],
  settings: AiHostRunSettings,
  callbacks: AiLocalRunCallbacks
): AiLocalRunHandle => {
  const timers: Array<ReturnType<typeof globalThis.setTimeout>> = [];
  let cancelled = false;
  let finished = false;
  const requestSession = syncAiSessionToActiveChat(session);
  const planningBundle = createFluxoraAiTaskPlanningBundle(prompt, run.operationId);
  let autonomousJob = settings.jobStorage
    ? createAiAutonomousJob(run, session, planningBundle, {
        modelId: settings.modelId,
        modelSupportsBackground: settings.modelSupportsBackground,
        providerId: settings.providerId
      })
    : null;

  const emitLog = (eventName: string, level: AiRuntimeLogEntry['level'] = 'info') => {
    createAiRuntimeLogEntries(eventName, run, level).forEach((entry) => callbacks.onLog?.(entry));
  };

  const persistAutonomousJob = (
    update: typeof autonomousJob,
    now = new Date()
  ): void => {
    if (!update || !settings.jobStorage) {
      return;
    }

    autonomousJob = update;
    persistAiAutonomousJob(settings.jobStorage, update, now);
  };

  const dispose = () => {
    timers.forEach((timer) => globalThis.clearTimeout(timer));
    timers.length = 0;
  };

  const finishCancelled = () => {
    if (finished) {
      return;
    }

    cancelled = true;
    finished = true;
    dispose();
    const event = createAiStreamEvent(run, 'run-cancelled', { status: 'idle' });
    emitLog('run-cancelled', 'warning');
    if (autonomousJob) {
      persistAutonomousJob(cancelAiAutonomousJob(autonomousJob));
    }
    callbacks.onFinish(
      createAiMessage('assistant', 'AI run cancelled.', new Date(), run.id),
      event,
      'idle'
    );
  };

  persistAutonomousJob(autonomousJob);
  emitLog('run-created');
  callbacks.onEvent(createAiStreamEvent(run, 'status', { status: 'running' }));
  if (autonomousJob) {
    const startedAt = new Date();
    persistAutonomousJob(
      checkpointAiAutonomousJob(
        heartbeatAiAutonomousJob(startAiAutonomousJob(autonomousJob, startedAt), startedAt),
        'Background run started',
        'The run is active in the persistent autonomous job queue.',
        startedAt
      ),
      startedAt
    );
  }

  const buildContextMessages = settings.buildContextSnapshot
    ? [
        {
          role: 'system' as const,
          text: serializeAiBuildContextSnapshot(settings.buildContextSnapshot),
          createdAt: settings.buildContextSnapshot.generatedAt
        }
      ]
    : [];

  void aiApi
    .chatRespond({
      operationId: run.operationId,
      sessionId: run.sessionId,
      messages: [
        ...buildContextMessages,
        ...requestSession.messages.map((message) => ({
          role: message.role,
          text: message.text,
          createdAt: message.createdAt
        })),
        {
          role: 'user',
          text: prompt,
          createdAt: new Date().toISOString()
        }
      ],
      modelId: settings.modelId,
      providerId: settings.providerId,
      research: createAiResearchRequestForPrompt(prompt, settings.routingPreset),
      routingPreset: settings.routingPreset,
      stream: true
    })
    .then(
      (response) => {
        if (cancelled || finished) {
          return;
        }

        const status = responseStatusToAgentStatus(response);
        const compactCaseState = compactCaseStateFromResponse(response);
        const structuredResponse = compactCaseState ? { ...response, caseState: compactCaseState } : response;
        const finalText = structuredFinalAnswerFromResponse(structuredResponse, prompt) ?? response.text;
        const finalCaseState = finalCaseStateFromResponse(response, compactCaseState, finalText);
        const finalResponse = finalCaseState ? { ...response, caseState: finalCaseState } : response;
        const finalSources = sourcesForStructuredFinalAnswer(finalResponse);
        const chunks = streamChunksForFinalText(response, finalText);
        if (autonomousJob) {
          const responseAt = new Date();
          const withResponse = checkpointAiAutonomousJob(
            recordAiAutonomousProgress(
              attachAiAutonomousJobPlan(
                autonomousJob,
                response.taskPlan,
                response.subagentSchedule,
                responseAt
              ),
              'provider-response',
              'AI host returned response metadata and stream chunks.',
              55,
              responseAt
            ),
            'Provider response',
            'Provider response was captured before streaming the final answer.',
            responseAt
          );
          persistAutonomousJob(heartbeatAiAutonomousJob(withResponse, responseAt), responseAt);
        }
        chunks.forEach((chunk, index) => {
          timers.push(
            globalThis.setTimeout(() => {
              if (cancelled || finished) {
                return;
              }

              if (autonomousJob) {
                const chunkAt = new Date();
                const chunkPercent = 60 + Math.round(((index + 1) / chunks.length) * 25);
                persistAutonomousJob(
                  heartbeatAiAutonomousJob(
                    recordAiAutonomousProgress(
                      autonomousJob,
                      'streaming',
                      'Streaming internal provider progress to the chat surface.',
                      chunkPercent,
                      chunkAt
                    ),
                    chunkAt
                  ),
                  chunkAt
                );
              }
              callbacks.onEvent(
                createAiStreamEvent(run, 'assistant-delta', {
                  status: 'running',
                  textDelta: chunk
                })
              );
            }, index * 35)
          );
        });

        timers.push(
          globalThis.setTimeout(() => {
            if (cancelled || finished) {
              return;
            }

            finished = true;
            const event = createAiStreamEvent(run, 'run-finished', { status });
            const providerDiagnostics = aiResponseDiagnosticMessages(response);
            const message = createAiMessage('assistant', finalText, new Date(), run.id, {
              agentStatus: status,
              costEstimate: response.costEstimate,
              modelId: response.modelId,
              providerId: response.providerId,
              providerDiagnostics: providerDiagnostics.length > 0 ? providerDiagnostics : undefined,
              routingPreset: response.routingPreset,
              sources: finalSources,
              contextBundle: response.contextBundle ?? null,
              researchReport: response.researchReport ?? null,
              modResearchRoute: response.modResearchRoute ?? null,
              diagnosisJudge: response.diagnosisJudge ?? null,
              caseState: finalCaseState,
              taskPlan: response.taskPlan ?? null,
              subagentSchedule: response.subagentSchedule ?? null,
              orchestration: response.orchestration ?? null,
              selectedSkill: response.selectedSkill ?? response.taskPlan?.selectedSkill ?? null
            });
            callbacks.onFinish(message, event, status, response.ledgerEntry, response);
            if (autonomousJob) {
              const finishedAt = new Date();
              const verified = checkpointAiAutonomousJob(
                recordAiAutonomousProgress(
                  autonomousJob,
                  'verification',
                  'Verification or terminal-state policy completed.',
                  95,
                  finishedAt
                ),
                'Verification gate',
                'The final response policy was evaluated before storing the terminal job state.',
                finishedAt
              );
              const terminal =
                status === 'needs-approval'
                  ? blockAiAutonomousJob(
                      verified,
                      'user',
                      'User approval is required before queued mutations can continue.',
                      finishedAt
                    )
                  : status === 'blocked'
                    ? blockAiAutonomousJob(
                        verified,
                        'permission',
                        'The AI host reported a blocked terminal state.',
                        finishedAt
                      )
                    : completeAiAutonomousJob(verified, finalText, finishedAt);
              persistAutonomousJob(terminal, finishedAt);
            }
            emitLog(status === 'blocked' ? 'run-blocked' : 'run-finished', status === 'blocked' ? 'warning' : 'info');
          }, chunks.length * 35 + 25)
        );
      },
      (error) => {
        if (cancelled || finished) {
          return;
        }

        finished = true;
        const event = createAiStreamEvent(run, 'run-finished', { status: 'blocked' });
        const messageText =
          error instanceof Error && error.message
            ? `AI host blocked the response: ${redactAiTextForLog(error.message)}`
            : 'AI host blocked the response.';
        if (autonomousJob) {
          const blockedAt = new Date();
          persistAutonomousJob(
            blockAiAutonomousJob(
              recordAiAutonomousProgress(
                autonomousJob,
                'blocked',
                messageText,
                autonomousJob.percent,
                blockedAt
              ),
              'permission',
              messageText,
              blockedAt
            ),
            blockedAt
          );
        }
        callbacks.onFinish(createAiMessage('assistant', messageText, new Date(), run.id), event, 'blocked');
        emitLog('run-blocked', 'error');
      }
    );

  return {
    cancel: finishCancelled,
    dispose
  };
};

export const createAiRunForPrompt = (
  session: AiSession,
  operationId: string,
  prompt: string,
  now = new Date()
): AiRun => {
  const activeChat = activeAiChatThread(syncAiSessionToActiveChat(session));
  const fingerprint = createAiPromptFingerprint(prompt);
  return createAiRun(activeChat.id, operationId, fingerprint.digest, fingerprint.length, now);
};

export const startLocalAiRun = (
  run: AiRun,
  prompt: string,
  callbacks: AiLocalRunCallbacks
): AiLocalRunHandle => {
  const timers: Array<ReturnType<typeof globalThis.setTimeout>> = [];
  let finished = false;
  const plan = createFakeAiRunPlan(prompt);
  const planningBundle = createFluxoraAiTaskPlanningBundle(prompt, run.operationId);
  const finalStatus: AiAgentStatus =
    planningBundle.taskPlan.proposedMutations.length > 0 ? 'needs-approval' : plan.finalStatus;

  const emitLog = (eventName: string, level: AiRuntimeLogEntry['level'] = 'info') => {
    createAiRuntimeLogEntries(eventName, run, level).forEach((entry) => callbacks.onLog?.(entry));
  };

  emitLog('run-created');

  timers.push(
    globalThis.setTimeout(() => {
      if (finished) {
        return;
      }
      callbacks.onEvent(createAiStreamEvent(run, 'status', { status: 'running' }));
      emitLog('run-running');
    }, 320)
  );

  timers.push(
    globalThis.setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      const event = createAiStreamEvent(run, 'run-finished', { status: finalStatus });
      callbacks.onFinish(
        createAiMessage('assistant', plan.reply, new Date(), run.id, {
          agentStatus: finalStatus,
          taskPlan: planningBundle.taskPlan,
          subagentSchedule: planningBundle.subagentSchedule,
          selectedSkill: planningBundle.selectedSkill
        }),
        event,
        finalStatus
      );
      emitLog('run-finished');
    }, 900)
  );

  const dispose = () => {
    timers.forEach((timer) => globalThis.clearTimeout(timer));
    timers.length = 0;
  };

  return {
    cancel: () => {
      if (finished) {
        return;
      }

      finished = true;
      dispose();
      const event = createAiStreamEvent(run, 'run-cancelled', { status: 'idle' });
      createAiRuntimeLogEntries('run-cancelled', run, 'warning').forEach((entry) =>
        callbacks.onLog?.(entry)
      );
      callbacks.onFinish(
        createAiMessage('assistant', 'Local AI run cancelled.', new Date(), run.id),
        event,
        'idle'
      );
    },
    dispose
  };
};
