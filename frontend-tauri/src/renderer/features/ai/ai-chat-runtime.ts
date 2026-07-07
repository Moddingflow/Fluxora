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
  type AiMessage,
  type AiRun,
  type AiSession,
  type AiStreamEvent
} from './ai-chat-state';
import type {
  FluxoraAiCaseState,
  FluxoraAiChatRequest,
  FluxoraAiChatResponse,
  FluxoraAiCitation,
  FluxoraAiCostLedgerEntry,
  FluxoraAiDiagnosisJudge,
  FluxoraAiIntermediateEvent,
  FluxoraAiIntermediateEventPayloadValue,
  FluxoraAiMultiModelOrchestration,
  FluxoraAiResearchReport,
  FluxoraAiResearchSnapshot,
  FluxoraAiResearchRequest,
  FluxoraAiRoutingPreset,
  FluxoraApi
} from '../../../shared/fluxora-api';
import { createFluxoraAiTaskPlanningBundle } from '../../../shared/ai-task-planner';
import {
  compressAiCaseState,
  type FluxoraAiModResearchEvidenceCard
} from '../../../shared/ai-mod-research-pipeline';
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
  recordAiAutonomousIntermediateEvent,
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
      intermediateEventCount: number;
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
    intermediateEventCount: number;
  }>;
}

export interface AiLocalRunCallbacks {
  onEvent: (event: AiStreamEvent) => void;
  onRunEvent?: (event: FluxoraAiIntermediateEvent) => void;
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
  preparedRequest?: FluxoraAiChatRequest;
  providerId?: string;
  routingPreset: FluxoraAiRoutingPreset;
}

interface AiSessionStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const AI_SESSION_STORAGE_PREFIX = 'fluxora.ai.chat.session.v1';
const AI_HOST_CHAT_RESPONSE_MAX_ATTEMPTS = 2;
const AI_RUN_CANCELLED_TEXT = 'Остановлено';
const AI_SESSION_STORED_MESSAGE_TEXT_LIMIT = 120_000;
const AI_SESSION_STORED_SMALL_TEXT_LIMIT = 4_000;
const AI_SESSION_STORED_SOURCE_LIMIT = 80;
const AI_SESSION_STORED_SNAPSHOT_LIMIT = 32;
const AI_SESSION_STORED_TARGET_LIMIT = 24;
const AI_SESSION_STORED_EVENT_LIMIT = 160;
const AI_SESSION_STORED_STREAM_EVENT_LIMIT = 120;
const AI_SESSION_STORED_RUN_LIMIT = 24;
const AI_SESSION_STORED_LEDGER_LIMIT = 40;
const AI_STREAM_CHUNK_LIMIT = 32;
const AI_STREAM_CHUNK_TEXT_LIMIT = 2_000;

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

const truncateAiRuntimeText = (value: string, limit: number): string =>
  value.length > limit
    ? `${value.slice(0, limit).trimEnd()}\n\n[Truncated to keep Fluxora responsive.]`
    : value;

const compactAiRuntimeArray = <T>(values: T[] | undefined, limit: number): T[] =>
  Array.isArray(values) ? values.slice(0, Math.max(0, limit)) : [];

const compactAiCitationForStorage = (source: FluxoraAiCitation): FluxoraAiCitation => ({
  id: truncateAiRuntimeText(source.id, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
  title: truncateAiRuntimeText(source.title, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
  url: truncateAiRuntimeText(source.url, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
  capturedAt: source.capturedAt,
  kind: source.kind,
  provider: source.provider,
  snippet: source.snippet
    ? truncateAiRuntimeText(source.snippet, AI_SESSION_STORED_SMALL_TEXT_LIMIT)
    : undefined,
  trust: source.trust
});

const compactAiCitationsForStorage = (
  sources: FluxoraAiCitation[] | undefined,
  limit = AI_SESSION_STORED_SOURCE_LIMIT
): FluxoraAiCitation[] => compactAiRuntimeArray(sources, limit).map(compactAiCitationForStorage);

const compactAiUnknownRecordForStorage = (record: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(record)
      .slice(0, 12)
      .map(([key, value]) => {
        if (typeof value === 'string') {
          return [key, truncateAiRuntimeText(value, AI_SESSION_STORED_SMALL_TEXT_LIMIT)];
        }
        if (
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          value === null
        ) {
          return [key, value];
        }
        if (Array.isArray(value)) {
          return [
            key,
            value.slice(0, 24).map((item) =>
              typeof item === 'string'
                ? truncateAiRuntimeText(item, AI_SESSION_STORED_SMALL_TEXT_LIMIT)
                : typeof item === 'number' || typeof item === 'boolean' || item === null
                  ? item
                  : '[object]'
            )
          ];
        }
        return [key, '[object]'];
      })
  );

const compactAiResearchSnapshotForStorage = (
  snapshot: FluxoraAiResearchSnapshot
): FluxoraAiResearchSnapshot => {
  const compact: FluxoraAiResearchSnapshot = {
    id: truncateAiRuntimeText(snapshot.id, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
    kind: truncateAiRuntimeText(snapshot.kind, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
    title: truncateAiRuntimeText(snapshot.title, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
    url: truncateAiRuntimeText(snapshot.url, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
    capturedAt: snapshot.capturedAt,
    status: snapshot.status,
    trust: snapshot.trust,
    instructionsAllowed: false
  };

  if (snapshot.summary) {
    compact.summary = truncateAiRuntimeText(snapshot.summary, AI_SESSION_STORED_SMALL_TEXT_LIMIT);
  }
  if (snapshot.reason) {
    compact.reason = truncateAiRuntimeText(snapshot.reason, AI_SESSION_STORED_SMALL_TEXT_LIMIT);
  }
  if (snapshot.httpStatus !== undefined) {
    compact.httpStatus = snapshot.httpStatus;
  }

  return compact;
};

const compactAiEvidenceCardForStorage = (
  card: FluxoraAiModResearchEvidenceCard
): FluxoraAiModResearchEvidenceCard => ({
  ...card,
  sourceId: truncateAiRuntimeText(card.sourceId, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
  sourceIds: compactAiRuntimeArray(card.sourceIds, 16).map((sourceId) =>
    truncateAiRuntimeText(sourceId, AI_SESSION_STORED_SMALL_TEXT_LIMIT)
  ),
  citations: compactAiRuntimeArray(card.citations, 8).map((citation) => ({
    sourceId: truncateAiRuntimeText(citation.sourceId, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
    url: citation.url
      ? truncateAiRuntimeText(citation.url, AI_SESSION_STORED_SMALL_TEXT_LIMIT)
      : null,
    title: truncateAiRuntimeText(citation.title, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
    locator: truncateAiRuntimeText(citation.locator, AI_SESSION_STORED_SMALL_TEXT_LIMIT)
  })),
  claim: truncateAiRuntimeText(card.claim, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
  relevantMods: compactAiRuntimeArray(card.relevantMods, 16).map((modName) =>
    truncateAiRuntimeText(modName, AI_SESSION_STORED_SMALL_TEXT_LIMIT)
  ),
  affectedVersions: compactAiRuntimeArray(card.affectedVersions, 16).map((version) =>
    truncateAiRuntimeText(version, AI_SESSION_STORED_SMALL_TEXT_LIMIT)
  )
});

const compactAiResearchReportForStorage = (
  report: FluxoraAiResearchReport | null | undefined
): FluxoraAiResearchReport | null => {
  if (!report) {
    return null;
  }

  const compact: FluxoraAiResearchReport = {
    schema: report.schema,
    generatedAt: report.generatedAt,
    operationId: report.operationId,
    permissionClass: report.permissionClass,
    mode: report.mode,
    policy: {
      rendererCompacted: true,
      originalTargetCount: report.targets.length,
      originalSnapshotCount: report.snapshots.length,
      originalSourceCount: report.sources.length
    },
    targets: compactAiRuntimeArray(report.targets, AI_SESSION_STORED_TARGET_LIMIT).map(
      compactAiUnknownRecordForStorage
    ),
    snapshots: compactAiRuntimeArray(report.snapshots, AI_SESSION_STORED_SNAPSHOT_LIMIT).map(
      compactAiResearchSnapshotForStorage
    ),
    sources: compactAiCitationsForStorage(report.sources),
    issues: compactAiRuntimeArray(report.issues, 12).map(compactAiUnknownRecordForStorage)
  };

  if (report.apiAvailability) {
    compact.apiAvailability = report.apiAvailability;
  }
  if (report.apiQuotaState) {
    compact.apiQuotaState = report.apiQuotaState;
  }
  if (report.nextBestNonNexusQueries) {
    compact.nextBestNonNexusQueries = compactAiRuntimeArray(report.nextBestNonNexusQueries, 12).map(
      (query) => truncateAiRuntimeText(query, AI_SESSION_STORED_SMALL_TEXT_LIMIT)
    );
  }
  if (report.nexusInvestigation) {
    compact.nexusInvestigation = {
      ...report.nexusInvestigation,
      targetNexusIds: compactAiRuntimeArray(report.nexusInvestigation.targetNexusIds, 64),
      deterministicFindings: [],
      hypotheses: [],
      evidenceCards: compactAiRuntimeArray(report.nexusInvestigation.evidenceCards, 24).map(
        compactAiEvidenceCardForStorage
      )
    };
  }
  if (report.webQueryPlan) {
    compact.webQueryPlan = {
      ...report.webQueryPlan,
      queries: compactAiRuntimeArray(report.webQueryPlan.queries, 12),
      discardedSources: []
    };
  }

  return compact;
};

const compactAiOrchestrationForStorage = (
  orchestration: FluxoraAiMultiModelOrchestration | null | undefined
): FluxoraAiMultiModelOrchestration | null => {
  if (!orchestration) {
    return null;
  }

  return {
    ...orchestration,
    strategy: truncateAiRuntimeText(orchestration.strategy, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
    chef: {
      ...orchestration.chef,
      dispatchPlan: truncateAiRuntimeText(
        orchestration.chef.dispatchPlan,
        AI_SESSION_STORED_SMALL_TEXT_LIMIT
      )
    },
    subagents: compactAiRuntimeArray(orchestration.subagents, 24).map((subagent) => ({
      ...subagent,
      text: truncateAiRuntimeText(subagent.text, AI_SESSION_STORED_SMALL_TEXT_LIMIT),
      error: subagent.error
        ? {
            ...subagent.error,
            message: truncateAiRuntimeText(subagent.error.message, AI_SESSION_STORED_SMALL_TEXT_LIMIT)
          }
        : subagent.error
    }))
  };
};

const compactAiIntermediatePayloadValue = (
  value: FluxoraAiIntermediateEventPayloadValue
): FluxoraAiIntermediateEventPayloadValue => {
  if (typeof value === 'string') {
    return truncateAiRuntimeText(value, AI_SESSION_STORED_SMALL_TEXT_LIMIT);
  }
  if (!Array.isArray(value)) {
    return value;
  }
  if (value.every((item): item is string => typeof item === 'string')) {
    return value
      .slice(0, 24)
      .map((item) => truncateAiRuntimeText(item, AI_SESSION_STORED_SMALL_TEXT_LIMIT));
  }
  if (value.every((item): item is number => typeof item === 'number')) {
    return value.slice(0, 24);
  }
  if (value.every((item): item is boolean => typeof item === 'boolean')) {
    return value.slice(0, 24);
  }
  return [];
};

const compactAiIntermediateEventForStorage = (
  event: FluxoraAiIntermediateEvent
): FluxoraAiIntermediateEvent => {
  const compact: FluxoraAiIntermediateEvent = {
    ...event,
    stage: truncateAiRuntimeText(event.stage, 160),
    message: truncateAiRuntimeText(event.message, AI_SESSION_STORED_SMALL_TEXT_LIMIT)
  };

  if (event.payload) {
    const dataEntries = Object.entries(event.payload.data ?? {})
      .slice(0, 12)
      .map(([key, value]) => {
        const compactValue = compactAiIntermediatePayloadValue(value);
        return [truncateAiRuntimeText(key, 160), compactValue] as const;
      });
    compact.payload = {
      kind: truncateAiRuntimeText(event.payload.kind, 160),
      data: Object.fromEntries(dataEntries)
    };
  }

  return compact;
};

const compactAiStreamEventForStorage = (event: AiStreamEvent): AiStreamEvent => ({
  ...event,
  textDelta: event.textDelta
    ? truncateAiRuntimeText(event.textDelta, AI_STREAM_CHUNK_TEXT_LIMIT)
    : event.textDelta
});

const compactAiRunForStorage = (run: AiRun): AiRun => ({
  ...run,
  eventIds: compactAiRuntimeArray(run.eventIds, AI_SESSION_STORED_EVENT_LIMIT)
});

const compactAiMessageForStorage = (message: AiMessage): AiMessage => ({
  ...message,
  text: truncateAiRuntimeText(message.text, AI_SESSION_STORED_MESSAGE_TEXT_LIMIT),
  providerDiagnostics: message.providerDiagnostics
    ? compactAiRuntimeArray(message.providerDiagnostics, 8).map((diagnostic) =>
        truncateAiRuntimeText(diagnostic, AI_SESSION_STORED_SMALL_TEXT_LIMIT)
      )
    : undefined,
  sources: compactAiCitationsForStorage(message.sources),
  contextBundle: null,
  researchReport: compactAiResearchReportForStorage(message.researchReport),
  diagnosisJudge: null,
  orchestration: compactAiOrchestrationForStorage(message.orchestration)
});

const compactAiChatThreadForStorage = (chat: AiChatThread): AiChatThread => ({
  ...chat,
  costLedger: compactAiRuntimeArray(chat.costLedger, AI_SESSION_STORED_LEDGER_LIMIT),
  intermediateEvents: chat.intermediateEvents
    .slice(-AI_SESSION_STORED_EVENT_LIMIT)
    .map(compactAiIntermediateEventForStorage),
  messages: chat.messages.map(compactAiMessageForStorage),
  runs: chat.runs.slice(-AI_SESSION_STORED_RUN_LIMIT).map(compactAiRunForStorage),
  streamEvents: chat.streamEvents
    .slice(-AI_SESSION_STORED_STREAM_EVENT_LIMIT)
    .map(compactAiStreamEventForStorage)
});

export const compactAiSessionForStorage = (session: AiSession): AiSession => {
  const normalizedSession = syncAiSessionToActiveChat(session);
  const chats = normalizedSession.chats.map(compactAiChatThreadForStorage);
  const activeChat =
    chats.find((chat) => chat.id === normalizedSession.activeChatId) ?? chats[0] ?? createAiChatThread();

  return {
    ...normalizedSession,
    activeChatId: activeChat.id,
    chats,
    costLedger: activeChat.costLedger,
    intermediateEvents: activeChat.intermediateEvents,
    messages: activeChat.messages,
    runs: activeChat.runs,
    streamEvents: activeChat.streamEvents
  };
};

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
  contextEstimateState:
    chat.contextEstimateState === 'counting' ||
    chat.contextEstimateState === 'ready' ||
    chat.contextEstimateState === 'error'
      ? chat.contextEstimateState
      : 'idle',
  contextUsage: chat.contextUsage ?? null,
  costLedger: Array.isArray(chat.costLedger) ? chat.costLedger : [],
  intermediateEvents: Array.isArray(chat.intermediateEvents) ? chat.intermediateEvents : []
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
          intermediateEvents: Array.isArray(session.intermediateEvents) ? session.intermediateEvents : [],
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
    costLedger: rootCostLedger,
    intermediateEvents: Array.isArray(session.intermediateEvents) ? session.intermediateEvents : []
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

  try {
    const compactSession = compactAiSessionForStorage(session);
    storage.setItem(aiSessionStorageKey(compactSession.scopeKey), JSON.stringify(compactSession));
  } catch {
    // A huge AI result must never take down the renderer just because history persistence failed.
  }
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

const createAiRuntimeIntermediateEvent = (
  run: AiRun,
  sequence: number,
  stage: string,
  message: string,
  level: FluxoraAiIntermediateEvent['level'] = 'info',
  percent?: number
): FluxoraAiIntermediateEvent => {
  const createdAt = new Date().toISOString();
  return {
    schema: 'fluxora.ai.intermediate-event.v1',
    eventId: `runtime-${run.id}-${sequence}-${createdAt.replace(/[-:.TZ]/g, '')}`,
    runId: run.id,
    operationId: run.operationId,
    seq: 900_000 + sequence,
    createdAt,
    type: 'progress',
    level,
    visibility: 'user',
    stage,
    message,
    percent,
    payload: {
      kind: 'runtime-watchdog',
      data: {
        attempt: sequence
      }
    }
  };
};

export const createAiResearchRequestForPrompt = (
  _prompt: string,
  _routingPreset: FluxoraAiRoutingPreset
): FluxoraAiResearchRequest | undefined => {
  // The renderer never decides research policy from prompt keywords: the host
  // routes every prompt through the multilingual canonical intent route and
  // recomputes scope/budgets itself. The renderer only signals that research
  // and provider-side Gemini Google Search grounding are permitted.
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
          intermediateEventCount: chat.intermediateEvents?.length ?? 0,
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
        intermediateEventCount: session.intermediateEvents?.length ?? 0,
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

  if (reason === 'contextLimit') {
    return `${providerLabel} context limit was reached after compression`;
  }

  if (reason === 'temporaryProvider') {
    return `${providerLabel} is temporarily unavailable`;
  }

  if (reason === 'searchToolSchemaRejected') {
    return `${providerLabel} rejected the Google Search tool schema`;
  }

  if (reason === 'emptyResponse') {
    return `${providerLabel} returned an empty response`;
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

const responseStatusToAgentStatus = (
  response: FluxoraAiChatResponse,
  hasVisibleAnswer = true
): AiAgentStatus =>
  response.status === 'needs-approval'
    ? 'needs-approval'
    : response.status === 'blocked' ||
        response.error ||
        (responseUsedLocalDryRun(response) && responseHasProviderFallback(response)) ||
        !hasVisibleAnswer
      ? 'blocked'
      : 'done';

const isRetryableAiHostResponse = (response: FluxoraAiChatResponse): boolean =>
  response.error?.retryable === true && response.error.category === 'transport';

const streamChunksFromResponse = (response: FluxoraAiChatResponse): string[] => {
  const chunks = response.streamChunks
    .slice()
    .sort((left, right) => left.index - right.index)
    .map((chunk) => chunk.text)
    .filter(Boolean);

  return chunks.length > 0 ? chunks : response.text.trim() ? [response.text] : [];
};

const compactAiStreamChunks = (chunks: string[]): string[] => {
  if (chunks.length <= AI_STREAM_CHUNK_LIMIT) {
    return chunks.map((chunk) => truncateAiRuntimeText(chunk, AI_STREAM_CHUNK_TEXT_LIMIT));
  }

  return [
    ...chunks
      .slice(0, AI_STREAM_CHUNK_LIMIT)
      .map((chunk) => truncateAiRuntimeText(chunk, AI_STREAM_CHUNK_TEXT_LIMIT)),
    `[${chunks.length - AI_STREAM_CHUNK_LIMIT} additional stream chunks suppressed to keep Fluxora responsive.]`
  ];
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
  if (quota.unavailableReason === 'invalid-credential') {
    return 'Учетные данные Nexus API были отклонены. Переподключи Nexus Mods или обнови API key/token перед повторной проверкой.';
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
): string[] =>
  compactAiStreamChunks(finalText === response.text ? streamChunksFromResponse(response) : [finalText]);

const emptyHostResponseText = (response: FluxoraAiChatResponse, prompt: string): string => {
  const russian = userPrefersRussian(prompt);
  const safeError = response.error?.message ? redactAiTextForLog(response.error.message) : '';
  const diagnostic = aiResponseDiagnosticMessages(response)[0];

  if (diagnostic) {
    return diagnostic;
  }

  if (response.status === 'needs-approval') {
    return russian
      ? 'ИИ-хост запросил подтверждение, но не вернул видимый план. Проверь Settings > AI и попробуй снова.'
      : 'AI host requested approval but did not return a visible plan. Check Settings > AI and try again.';
  }

  if (response.status === 'blocked' || safeError) {
    return russian
      ? `ИИ-хост не смог подготовить ответ${safeError ? `: ${safeError}` : ''}. Проверь Settings > AI и попробуй снова.`
      : `AI host could not prepare a reply${safeError ? `: ${safeError}` : ''}. Check Settings > AI and try again.`;
  }

  return russian
    ? 'ИИ-хост завершил запрос без видимого ответа. Попробуй еще раз или проверь Settings > AI.'
    : 'AI host finished without a visible reply. Try again or check Settings > AI.';
};

const visibleFinalTextFromResponse = (
  response: FluxoraAiChatResponse,
  prompt: string,
  candidate: string | null | undefined
): string => {
  const text = candidate?.trim() ?? '';
  return text || emptyHostResponseText(response, prompt);
};

const nexusInvestigationHasCompletedEvidence = (
  nexusInvestigation: FluxoraAiChatResponse['nexusInvestigation'] | null
): boolean => {
  if (!nexusInvestigation) {
    return false;
  }

  if (nexusInvestigation.evidenceCards.length > 0) {
    return true;
  }

  return nexusInvestigation.api.state === 'available' || nexusInvestigation.api.state === 'quota-exhausted';
};

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
      : nexusInvestigationHasCompletedEvidence(nexusInvestigation)
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

export const createAiHostChatRequest = (
  run: AiRun,
  session: AiSession,
  prompt: string,
  settings: AiHostRunSettings
): FluxoraAiChatRequest => {
  const requestSession = syncAiSessionToActiveChat(session);
  const buildContextMessages = settings.buildContextSnapshot
    ? [
        {
          role: 'system' as const,
          text: serializeAiBuildContextSnapshot(settings.buildContextSnapshot),
          createdAt: settings.buildContextSnapshot.generatedAt
        }
      ]
    : [];

  return {
    operationId: run.operationId,
    runId: run.id,
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
  };
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
  const planningBundle = createFluxoraAiTaskPlanningBundle(prompt, run.operationId);
  let autonomousJob = settings.jobStorage
    ? createAiAutonomousJob(run, session, planningBundle, {
        modelId: settings.modelId,
        modelSupportsBackground: settings.modelSupportsBackground,
        providerId: settings.providerId
      })
    : null;
  let runtimeEventSequence = 0;

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

  const emitRunEvent = (event: FluxoraAiIntermediateEvent): void => {
    callbacks.onRunEvent?.(event);
    if (autonomousJob) {
      persistAutonomousJob(recordAiAutonomousIntermediateEvent(autonomousJob, event));
    }
  };

  const emitRuntimeRunEvent = (
    stage: string,
    message: string,
    level: FluxoraAiIntermediateEvent['level'] = 'info',
    percent?: number
  ): void => {
    runtimeEventSequence += 1;
    emitRunEvent(createAiRuntimeIntermediateEvent(run, runtimeEventSequence, stage, message, level, percent));
  };

  const disposeRunEvent = aiApi.onRunEvent((event) => {
    if (event.runId !== run.id || event.operationId !== run.operationId) {
      return;
    }

    emitRunEvent(event);
  });

  const dispose = () => {
    disposeRunEvent();
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
    const event = createAiStreamEvent(run, 'run-cancelled', { status: 'stopped' });
    emitLog('run-cancelled', 'warning');
    if (autonomousJob) {
      persistAutonomousJob(cancelAiAutonomousJob(autonomousJob));
    }
    callbacks.onFinish(
      createAiMessage('assistant', AI_RUN_CANCELLED_TEXT, new Date(), run.id, {
        agentStatus: 'stopped'
      }),
      event,
      'stopped'
    );
  };

  persistAutonomousJob(autonomousJob);
  emitLog('run-created');
  callbacks.onEvent(createAiStreamEvent(run, 'status', { status: 'running' }));
  emitRuntimeRunEvent('prompt-preparation', 'AI host is preparing the run.', 'info', 5);
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

  const chatRequest = settings.preparedRequest ?? createAiHostChatRequest(run, session, prompt, settings);

  const requestHostResponse = async (): Promise<FluxoraAiChatResponse> => {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= AI_HOST_CHAT_RESPONSE_MAX_ATTEMPTS; attempt += 1) {
      if (cancelled || finished) {
        throw new Error('AI run stopped.');
      }

      try {
        const response = await aiApi.chatRespond(chatRequest);
        if (
          !isRetryableAiHostResponse(response) ||
          attempt >= AI_HOST_CHAT_RESPONSE_MAX_ATTEMPTS ||
          cancelled ||
          finished
        ) {
          return response;
        }

        emitRuntimeRunEvent(
          'host-retry',
          'AI host did not return a usable response. Retrying once.',
          'warning',
          12
        );
        emitLog('run-retry-ai-host', 'warning');
      } catch (error) {
        lastError = error;
        if (attempt >= AI_HOST_CHAT_RESPONSE_MAX_ATTEMPTS || cancelled || finished) {
          throw error;
        }

        emitRuntimeRunEvent(
          'host-retry',
          'AI host request failed before a reply. Retrying once.',
          'warning',
          12
        );
        emitLog('run-retry-ai-host', 'warning');
      }
    }

    throw lastError instanceof Error ? lastError : new Error('AI host request failed.');
  };

  void requestHostResponse()
    .then(
      (response) => {
        if (cancelled || finished) {
          return;
        }

        const compactCaseState = compactCaseStateFromResponse(response);
        const structuredResponse = compactCaseState ? { ...response, caseState: compactCaseState } : response;
        const rawFinalText = structuredFinalAnswerFromResponse(structuredResponse, prompt) ?? response.text;
        const hostReturnedVisibleAnswer =
          rawFinalText.trim().length > 0 || streamChunksFromResponse(response).length > 0;
        const status = responseStatusToAgentStatus(response, hostReturnedVisibleAnswer);
        const finalText = visibleFinalTextFromResponse(response, prompt, rawFinalText);
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
              sources: compactAiCitationsForStorage(finalSources),
              contextBundle: null,
              contextUsage: response.contextUsage ?? null,
              intentRoute: response.intentRoute ?? response.modResearchRoute?.intentRoute ?? null,
              tokenUsage: response.tokenUsage ?? null,
              researchReport: compactAiResearchReportForStorage(response.researchReport),
              modResearchRoute: response.modResearchRoute ?? null,
              diagnosisJudge: null,
              caseState: finalCaseState,
              taskPlan: response.taskPlan ?? null,
              subagentSchedule: response.subagentSchedule ?? null,
              orchestration: compactAiOrchestrationForStorage(response.orchestration),
              orchestrationDecision: response.orchestrationDecision ?? null,
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
      const event = createAiStreamEvent(run, 'run-cancelled', { status: 'stopped' });
      createAiRuntimeLogEntries('run-cancelled', run, 'warning').forEach((entry) =>
        callbacks.onLog?.(entry)
      );
      callbacks.onFinish(
        createAiMessage('assistant', AI_RUN_CANCELLED_TEXT, new Date(), run.id, {
          agentStatus: 'stopped'
        }),
        event,
        'stopped'
      );
    },
    dispose
  };
};
