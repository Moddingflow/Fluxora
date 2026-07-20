import type {
  FluxoraAiChatError,
  FluxoraAiChatRequest,
  FluxoraAiChatResponse,
  FluxoraAiContextUsage,
  FluxoraAiFileWorkspaceEnvelope,
  FluxoraAiIntermediateEvent,
  FluxoraApi
} from '../../../shared/fluxora-api';
import {
  activeAiChatThread,
  createAiMessage,
  createAiRun,
  createAiSession,
  createAiStreamEvent,
  type AiAgentStatus,
  type AiMessage,
  type AiRun,
  type AiSession,
  type AiStreamEvent
} from './ai-chat-state';
import { FLUXORA_AI_MODEL_ID, FLUXORA_AI_PROVIDER_ID, type AiChatSettings } from './ai-chat-settings';

export const AI_RUN_CANCELLED_TEXT = 'Остановлено';
const AI_SESSION_STORAGE_KEY = 'fluxora.ai.single-agent.sessions.v1';
const AI_MIGRATION_MARKER_KEY = 'fluxora.ai.single-agent-migration.v1';

export interface AiSessionScope {
  projectId?: string | null;
  projectDirectory?: string | null;
  projectName?: string | null;
}

interface AiSessionStorage {
  readonly length?: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key?(index: number): string | null;
}

export interface AiRuntimeLogEntry {
  category: string;
  channel: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  operationId: string;
}

export interface AiLocalRunHandle {
  cancel: () => void;
  dispose: () => void;
}

export interface AiHostRunSettings extends AiChatSettings {
  fileWorkspace?: FluxoraAiFileWorkspaceEnvelope;
  preparedRequest?: FluxoraAiChatRequest;
}

export interface AiHostRunCallbacks {
  onEvent: (event: AiStreamEvent) => void;
  onRunEvent: (event: FluxoraAiIntermediateEvent) => void;
  onFinish: (message: AiMessage, event: AiStreamEvent, status: AiAgentStatus) => void;
  onLog?: (entry: AiRuntimeLogEntry) => void;
}

type AiHostApi = Pick<FluxoraApi['ai'], 'chatRespond' | 'onRunEvent'>;

export const aiSessionScopeKey = (scope: AiSessionScope): string => {
  const projectId = scope.projectId?.trim();
  if (projectId) return `build:${projectId}`;
  const directory = scope.projectDirectory?.trim().toLowerCase();
  return directory ? `directory:${directory}` : 'no-build';
};

export const aiSessionBuildLabel = (scope: AiSessionScope): string =>
  scope.projectName?.trim() || 'Selected build';

const clearLegacyAiStateOnce = (storage: AiSessionStorage): void => {
  if (storage.getItem(AI_MIGRATION_MARKER_KEY) === 'done') return;

  const keys: string[] = [];
  for (let index = 0; index < (storage.length ?? 0); index += 1) {
    const key = storage.key?.(index);
    if (key?.startsWith('fluxora.ai.')) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
  storage.setItem(AI_MIGRATION_MARKER_KEY, 'done');
};

const parseStoredSessions = (storage: AiSessionStorage): Record<string, AiSession> => {
  try {
    const parsed = JSON.parse(storage.getItem(AI_SESSION_STORAGE_KEY) || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, AiSession>;
  } catch {
    return {};
  }
};

const isSingleAgentSession = (value: unknown): value is AiSession => {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<AiSession>;
  return session.schema === 'fluxora.ai.single-agent-session.v1'
    && typeof session.scopeKey === 'string'
    && typeof session.activeChatId === 'string'
    && Array.isArray(session.chats)
    && session.chats.length > 0;
};

const normalizeSingleAgentSession = (session: AiSession): AiSession => ({
  ...session,
  chats: session.chats.map((chat) => ({
    ...chat,
    intermediateEvents: Array.isArray(chat.intermediateEvents) ? chat.intermediateEvents : []
  }))
});

const recoverInterruptedRuns = (session: AiSession, now = new Date()): AiSession => {
  let changed = false;
  const recoveredAt = now.toISOString();
  const chats = session.chats.map((chat) => {
    const interrupted = chat.runs.filter((run) => run.state === 'queued' || run.state === 'streaming');
    if (!interrupted.length) return chat;
    changed = true;
    const interruptedIds = new Set(interrupted.map((run) => run.id));
    return {
      ...chat,
      updatedAt: recoveredAt,
      runs: chat.runs.map((run) => interruptedIds.has(run.id)
        ? { ...run, state: 'recovered' as const, status: 'stopped' as const, updatedAt: recoveredAt }
        : run),
      messages: [
        ...chat.messages,
        ...interrupted.map((run) => createAiMessage(
          'assistant',
          'Предыдущий запрос был остановлен при завершении Fluxora.',
          now,
          run.id,
          { agentStatus: 'stopped' }
        ))
      ]
    };
  });
  return changed ? { ...session, chats, updatedAt: recoveredAt } : session;
};

export const createAiSessionForScope = (scope: AiSessionScope, now = new Date()): AiSession =>
  createAiSession(aiSessionScopeKey(scope), aiSessionBuildLabel(scope), now);

export const loadAiSession = (
  storage: AiSessionStorage | undefined,
  scope: AiSessionScope,
  now = new Date()
): AiSession => {
  if (!storage) return createAiSessionForScope(scope, now);
  clearLegacyAiStateOnce(storage);
  const scopeKey = aiSessionScopeKey(scope);
  const stored = parseStoredSessions(storage)[scopeKey];
  return isSingleAgentSession(stored)
    ? recoverInterruptedRuns(normalizeSingleAgentSession(stored), now)
    : createAiSessionForScope(scope, now);
};

export const saveAiSession = (storage: AiSessionStorage | undefined, session: AiSession): void => {
  if (!storage || !isSingleAgentSession(session)) return;
  clearLegacyAiStateOnce(storage);
  const sessions = parseStoredSessions(storage);
  sessions[session.scopeKey] = session;
  storage.setItem(AI_SESSION_STORAGE_KEY, JSON.stringify(sessions));
};

export const createAiRuntimeLogEntries = (
  eventName: string,
  run: Pick<AiRun, 'operationId' | 'sessionId'>,
  level: AiRuntimeLogEntry['level'] = 'info'
): AiRuntimeLogEntry[] => [{
  category: 'ai-chat',
  channel: 'tauri-bridge',
  level,
  message: `event=${eventName} chatId=${run.sessionId} provider=${FLUXORA_AI_PROVIDER_ID} model=${FLUXORA_AI_MODEL_ID}`,
  operationId: run.operationId
}];

const promptFingerprint = (prompt: string): { digest: string; length: number } => {
  let hash = 2166136261;
  for (const character of prompt) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return { digest: (hash >>> 0).toString(16).padStart(8, '0'), length: prompt.length };
};

export const createAiRunForPrompt = (
  session: AiSession,
  operationId: string,
  prompt: string,
  now = new Date()
): AiRun => {
  const fingerprint = promptFingerprint(prompt);
  return createAiRun(session.activeChatId, operationId, fingerprint.digest, fingerprint.length, now);
};

export const createAiHostChatRequest = (
  run: AiRun,
  session: AiSession,
  prompt: string,
  settings: AiHostRunSettings
): FluxoraAiChatRequest => {
  const chat = activeAiChatThread(session);
  return {
    operationId: run.operationId,
    runId: run.id,
    sessionId: chat.id,
    providerId: FLUXORA_AI_PROVIDER_ID,
    modelId: FLUXORA_AI_MODEL_ID,
    messages: [
      ...chat.messages.map((message) => ({
        role: message.role,
        text: message.text,
        createdAt: message.createdAt
      })),
      { role: 'user' as const, text: prompt, createdAt: run.createdAt }
    ],
    conversationSummary: chat.conversationSummary,
    providerHistoryStartIndex: chat.providerHistoryStartIndex,
    fileWorkspace: settings.fileWorkspace,
    stream: true
  };
};

const typedErrorFromUnknown = (error: unknown): FluxoraAiChatError => {
  const fallback: FluxoraAiChatError = {
    code: 'ai.transport.unavailable',
    category: 'transport',
    stage: 'provider',
    retryable: true,
    userMessage: 'Gemini is unavailable. Try again in a moment.',
    debugId: `renderer-${Date.now()}`
  };
  if (typeof error === 'string') {
    try {
      const parsed = JSON.parse(error) as Partial<FluxoraAiChatError>;
      return parsed.code && parsed.userMessage ? { ...fallback, ...parsed } : fallback;
    } catch {
      return { ...fallback, debugId: `renderer-${Date.now()}` };
    }
  }
  if (error && typeof error === 'object') {
    const candidate = error as Partial<FluxoraAiChatError> & { message?: string };
    if (candidate.code && candidate.userMessage) return { ...fallback, ...candidate };
    if (candidate.message) return { ...fallback, userMessage: candidate.message };
  }
  return fallback;
};

export const aiAgentStatusFromResponse = (response: FluxoraAiChatResponse): AiAgentStatus => {
  if (response.status !== 'done') return 'blocked';
  if (response.execution) {
    if (response.execution.state !== 'completed') return 'blocked';
    if (response.execution.kind === 'answer') return 'completed';
    const hasVerifiedEffect = response.execution.verifiedEffects.length > 0;
    const hasRequiredFileEvidence = response.execution.domain !== 'files' || Boolean(response.fileChangeSet);
    return hasVerifiedEffect && hasRequiredFileEvidence ? 'completed' : 'blocked';
  }
  return response.fileToolDiagnostics?.taskKind !== 'action' || Boolean(response.fileChangeSet)
    ? 'completed'
    : 'blocked';
};

const messageFromResponse = (run: AiRun, response: FluxoraAiChatResponse): AiMessage =>
  createAiMessage('assistant', response.text, new Date(), run.id, {
    agentStatus: aiAgentStatusFromResponse(response),
    sources: response.sources,
    contextUsage: response.contextUsage ?? null,
    tokenUsage: response.tokenUsage ?? null,
    fileChangeSet: response.fileChangeSet ?? null,
    fileToolDiagnostics: response.fileToolDiagnostics ?? null,
    execution: response.execution ?? null,
    error: response.error ?? null,
    conversationSummary: response.conversationSummary ?? null,
    providerHistoryStartIndex: response.providerHistoryStartIndex ?? 0
  });

export const startHostAiRun = (
  run: AiRun,
  session: AiSession,
  prompt: string,
  api: AiHostApi,
  settings: AiHostRunSettings,
  callbacks: AiHostRunCallbacks
): AiLocalRunHandle => {
  let cancelled = false;
  const unsubscribe = api.onRunEvent((event) => {
    if (!cancelled && event.operationId === run.operationId) callbacks.onRunEvent(event);
  });
  const emitLog = (name: string, level: AiRuntimeLogEntry['level'] = 'info') => {
    createAiRuntimeLogEntries(name, run, level).forEach((entry) => callbacks.onLog?.(entry));
  };

  callbacks.onEvent(createAiStreamEvent(run, 'run-started', { status: 'thinking' }));
  emitLog('run-started');
  const request = settings.preparedRequest ?? createAiHostChatRequest(run, session, prompt, settings);
  void api.chatRespond(request).then(
    (response) => {
      if (cancelled) return;
      const status = aiAgentStatusFromResponse(response);
      const event = createAiStreamEvent(run, 'run-finished', { status });
      callbacks.onFinish(messageFromResponse(run, response), event, status);
      emitLog(`run-${response.status}`, response.status === 'done' ? 'info' : 'warning');
      unsubscribe();
    },
    (error) => {
      if (cancelled) return;
      const typedError = typedErrorFromUnknown(error);
      const event = createAiStreamEvent(run, 'run-finished', { status: 'blocked' });
      callbacks.onFinish(createAiMessage(
        'assistant',
        typedError.userMessage,
        new Date(),
        run.id,
        { agentStatus: 'blocked', error: typedError }
      ), event, 'blocked');
      emitLog(`run-failed code=${typedError.code} stage=${typedError.stage} debugId=${typedError.debugId}`, 'error');
      unsubscribe();
    }
  );

  return {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      unsubscribe();
      callbacks.onFinish(
        createAiMessage('assistant', AI_RUN_CANCELLED_TEXT, new Date(), run.id, { agentStatus: 'stopped' }),
        createAiStreamEvent(run, 'run-cancelled', { status: 'stopped' }),
        'stopped'
      );
      emitLog('run-cancelled', 'warning');
    },
    dispose: () => {
      cancelled = true;
      unsubscribe();
    }
  };
};

export const approximateAiContextUsage = (
  usage: FluxoraAiContextUsage | null,
  draft: string
): FluxoraAiContextUsage | null => {
  if (!usage || !draft.trim()) return usage;
  const currentContextTokens = usage.currentContextTokens + Math.ceil(draft.length / 4);
  return {
    ...usage,
    currentContextTokens,
    currentContextPercent: Math.min(100, currentContextTokens / Math.max(1, usage.contextWindowTokens) * 100),
    precision: 'estimated'
  };
};
