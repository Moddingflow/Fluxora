import type {
  FluxoraAiChatError,
  FluxoraAiCitation,
  FluxoraAiContextUsage,
  FluxoraAiFileChangeSet,
  FluxoraAiFileRollbackState,
  FluxoraAiFileToolDiagnostics,
  FluxoraAiIntermediateEvent,
  FluxoraAiExecution,
  FluxoraAiGoalContext,
  FluxoraAiTokenUsage
} from '../../../shared/fluxora-api';

export type AiAgentStatus =
  | 'thinking'
  | 'searching'
  | 'reading'
  | 'writing'
  | 'verifying'
  | 'needs-input'
  | 'completed'
  | 'blocked'
  | 'stopped';
export type AiMessageRole = 'user' | 'assistant';
export type AiRunState = 'queued' | 'streaming' | 'completed' | 'cancelled' | 'recovered';
export type AiContextEstimateState = 'idle' | 'counting' | 'ready' | 'error';
export type AiStreamEventType =
  | 'run-created'
  | 'run-started'
  | 'run-finished'
  | 'run-cancelled';

export interface AiMessage {
  id: string;
  role: AiMessageRole;
  text: string;
  createdAt: string;
  runId: string;
  agentStatus?: AiAgentStatus;
  sources?: FluxoraAiCitation[];
  contextUsage?: FluxoraAiContextUsage | null;
  tokenUsage?: FluxoraAiTokenUsage | null;
  fileChangeSet?: FluxoraAiFileChangeSet | null;
  fileToolDiagnostics?: FluxoraAiFileToolDiagnostics | null;
  execution?: FluxoraAiExecution | null;
  error?: FluxoraAiChatError | null;
  conversationSummary?: string | null;
  providerHistoryStartIndex?: number;
}

export interface AiRun {
  id: string;
  operationId: string;
  sessionId: string;
  state: AiRunState;
  status: AiAgentStatus;
  createdAt: string;
  updatedAt: string;
  promptDigest: string;
  promptLength: number;
  eventIds: string[];
}

export interface AiStreamEvent {
  id: string;
  runId: string;
  operationId: string;
  type: AiStreamEventType;
  createdAt: string;
  status: AiAgentStatus;
}

export interface AiChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AiMessage[];
  runs: AiRun[];
  contextEstimateState: AiContextEstimateState;
  contextUsage: FluxoraAiContextUsage | null;
  conversationSummary: string | null;
  providerHistoryStartIndex: number;
  intermediateEvents: FluxoraAiIntermediateEvent[];
  activeGoal: FluxoraAiGoalContext | null;
}

export interface AiSession {
  schema: 'fluxora.ai.single-agent-session.v1';
  id: string;
  scopeKey: string;
  buildLabel: string;
  activeChatId: string;
  chats: AiChatThread[];
  createdAt: string;
  updatedAt: string;
}

export interface AiChatState {
  activeChatId: string;
  activeRunId: string | null;
  chats: AiChatThread[];
  draft: string;
  intermediateEvents: FluxoraAiIntermediateEvent[];
  isCollapsed: boolean;
  isOpen: boolean;
  isRunning: boolean;
  messages: AiMessage[];
  runs: AiRun[];
  session: AiSession;
}

export type AiChatAction =
  | { type: 'toggle-open' }
  | { type: 'close' }
  | { type: 'toggle-collapse' }
  | { type: 'set-draft'; value: string }
  | { type: 'create-chat'; now?: Date }
  | { type: 'select-chat'; chatId: string }
  | { type: 'close-chat'; chatId: string; now?: Date }
  | { type: 'restore-session'; session: AiSession }
  | { type: 'submit-user-message'; message: AiMessage; run: AiRun; event: AiStreamEvent }
  | {
      type: 'set-context-estimate';
      runId: string;
      estimateState: AiContextEstimateState;
      contextUsage?: FluxoraAiContextUsage | null;
    }
  | { type: 'apply-stream-event'; event: AiStreamEvent }
  | { type: 'apply-run-event'; event: FluxoraAiIntermediateEvent }
  | {
      type: 'append-assistant-message';
      message: AiMessage;
      event: AiStreamEvent;
      status: AiAgentStatus;
    }
  | { type: 'cancel-run'; message: AiMessage; event: AiStreamEvent }
  | { type: 'update-file-change-set'; changeSet: FluxoraAiFileChangeSet }
  | {
      type: 'restore-file-rollback-states';
      chatId: string;
      states: FluxoraAiFileRollbackState[];
    }
  | {
      type: 'update-capability-rollback';
      compensationToken: string;
      rollbackState: 'available' | 'rolling-back' | 'rolled-back' | 'blocked';
    };

export const DEFAULT_AI_CHAT_TITLE = '';

const nowIso = (now = new Date()) => now.toISOString();
const compactId = (value: string) => value.replace(/[^a-z0-9_-]/gi, '-').slice(0, 48) || 'build';

export function createAiChatTitleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 48) : DEFAULT_AI_CHAT_TITLE;
}

export function createAiChatThread(scopeKey: string, now = new Date()): AiChatThread {
  const createdAt = nowIso(now);
  return {
    id: `ai-chat-${compactId(scopeKey)}-${createdAt.replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 8)}`,
    title: DEFAULT_AI_CHAT_TITLE,
    createdAt,
    updatedAt: createdAt,
    messages: [],
    runs: [],
    contextEstimateState: 'idle',
    contextUsage: null,
    conversationSummary: null,
    providerHistoryStartIndex: 0,
    intermediateEvents: [],
    activeGoal: null
  };
}

export function createAiSession(
  scopeKey = 'no-build',
  buildLabel = '',
  now = new Date()
): AiSession {
  const chat = createAiChatThread(scopeKey, now);
  const createdAt = nowIso(now);
  return {
    schema: 'fluxora.ai.single-agent-session.v1',
    id: `ai-session-${compactId(scopeKey)}`,
    scopeKey,
    buildLabel,
    activeChatId: chat.id,
    chats: [chat],
    createdAt,
    updatedAt: createdAt
  };
}

const initialSession = createAiSession();
export const initialAiChatState: AiChatState = {
  activeChatId: initialSession.activeChatId,
  activeRunId: null,
  chats: initialSession.chats,
  draft: '',
  intermediateEvents: [],
  isCollapsed: false,
  isOpen: false,
  isRunning: false,
  messages: [],
  runs: [],
  session: initialSession
};

export function createAiMessage(
  role: AiMessageRole,
  text: string,
  now = new Date(),
  runId = '',
  metadata: Partial<Omit<AiMessage, 'id' | 'role' | 'text' | 'createdAt' | 'runId'>> = {}
): AiMessage {
  const createdAt = nowIso(now);
  return {
    id: `ai-message-${createdAt.replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    createdAt,
    runId,
    ...metadata
  };
}

export function createAiRun(
  sessionId: string,
  operationId: string,
  promptDigest: string,
  promptLength: number,
  now = new Date()
): AiRun {
  const createdAt = nowIso(now);
  return {
    id: `ai-run-${createdAt.replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 8)}`,
    operationId,
    sessionId,
    state: 'queued',
    status: 'thinking',
    createdAt,
    updatedAt: createdAt,
    promptDigest,
    promptLength,
    eventIds: []
  };
}

export function createAiStreamEvent(
  run: Pick<AiRun, 'id' | 'operationId'>,
  type: AiStreamEventType,
  options: { status?: AiAgentStatus } = {},
  now = new Date()
): AiStreamEvent {
  return {
    id: `ai-event-${run.id}-${type}-${Date.now()}`,
    runId: run.id,
    operationId: run.operationId,
    type,
    createdAt: nowIso(now),
    status: options.status ?? (type === 'run-finished' ? 'completed' : 'thinking')
  };
}

export const activeAiChatThread = (session: AiSession): AiChatThread =>
  session.chats.find((chat) => chat.id === session.activeChatId) ?? session.chats[0];

export const syncAiSessionToActiveChat = (session: AiSession): AiSession => session;

const statusFromIntermediateEvent = (event: FluxoraAiIntermediateEvent): AiAgentStatus => {
  if (event.level === 'error' || event.type === 'error') return 'blocked';
  if (event.stage.includes('verification')) return 'verifying';
  if (event.stage.includes('write') || event.stage.includes('prepare') || event.stage.includes('commit')) return 'writing';
  if (event.stage.includes('read')) return 'reading';
  if (event.stage.includes('search') || event.stage.includes('tool')) return 'searching';
  return 'thinking';
};

const updateChatById = (
  session: AiSession,
  chatId: string,
  update: (chat: AiChatThread) => AiChatThread,
  now = new Date()
): AiSession => ({
  ...session,
  updatedAt: nowIso(now),
  chats: session.chats.map((chat) => (chat.id === chatId ? update(chat) : chat))
});

const chatIdForRun = (session: AiSession, runId: string): string | null =>
  session.chats.find((chat) => chat.runs.some((run) => run.id === runId))?.id ?? null;

const stateFromSession = (state: AiChatState, session: AiSession): AiChatState => {
  const chat = activeAiChatThread(session);
  const activeRun = [...chat.runs].reverse().find((run) => run.state === 'queued' || run.state === 'streaming');
  return {
    ...state,
    activeChatId: chat.id,
    activeRunId: activeRun?.id ?? null,
    chats: session.chats,
    isRunning: Boolean(activeRun),
    messages: chat.messages,
    runs: chat.runs,
    intermediateEvents: chat.intermediateEvents ?? [],
    session
  };
};

export function aiChatReducer(state: AiChatState, action: AiChatAction): AiChatState {
  switch (action.type) {
    case 'toggle-open': return { ...state, isOpen: !state.isOpen, isCollapsed: false };
    case 'close': return { ...state, isOpen: false };
    case 'toggle-collapse': return { ...state, isCollapsed: !state.isCollapsed };
    case 'set-draft': return { ...state, draft: action.value };
    case 'restore-session': return stateFromSession({ ...state, draft: '', intermediateEvents: [] }, action.session);
    case 'create-chat': {
      const chat = createAiChatThread(state.session.scopeKey, action.now);
      return stateFromSession(state, {
        ...state.session,
        activeChatId: chat.id,
        chats: [...state.session.chats, chat],
        updatedAt: nowIso(action.now)
      });
    }
    case 'select-chat': {
      if (!state.session.chats.some((chat) => chat.id === action.chatId)) return state;
      return stateFromSession({ ...state, draft: '', intermediateEvents: [] }, {
        ...state.session,
        activeChatId: action.chatId,
        updatedAt: nowIso()
      });
    }
    case 'close-chat': {
      const remaining = state.session.chats.filter((chat) => chat.id !== action.chatId);
      const chats = remaining.length ? remaining : [createAiChatThread(state.session.scopeKey, action.now)];
      const activeChatId = state.session.activeChatId === action.chatId
        ? chats[chats.length - 1].id
        : state.session.activeChatId;
      return stateFromSession({ ...state, draft: '', intermediateEvents: [] }, {
        ...state.session,
        activeChatId,
        chats,
        updatedAt: nowIso(action.now)
      });
    }
    case 'submit-user-message': {
      const session = updateChatById(state.session, action.run.sessionId, (chat) => ({
        ...chat,
        title: chat.title === DEFAULT_AI_CHAT_TITLE ? createAiChatTitleFromPrompt(action.message.text) : chat.title,
        updatedAt: action.message.createdAt,
        messages: [...chat.messages, action.message],
        runs: [...chat.runs, { ...action.run, state: 'streaming', eventIds: [action.event.id] }]
      }));
      return stateFromSession({ ...state, draft: '', activeRunId: action.run.id, isRunning: true }, session);
    }
    case 'set-context-estimate': {
      const chatId = chatIdForRun(state.session, action.runId);
      if (!chatId) return state;
      const session = updateChatById(state.session, chatId, (chat) => ({
        ...chat,
        contextEstimateState: action.estimateState,
        contextUsage: action.contextUsage === undefined ? chat.contextUsage : action.contextUsage
      }));
      return stateFromSession(state, session);
    }
    case 'apply-stream-event': {
      const chatId = chatIdForRun(state.session, action.event.runId);
      if (!chatId) return state;
      const session = updateChatById(state.session, chatId, (chat) => ({
        ...chat,
        runs: chat.runs.map((run) => run.id === action.event.runId ? {
          ...run,
          status: action.event.status,
          updatedAt: action.event.createdAt,
          eventIds: run.eventIds.includes(action.event.id) ? run.eventIds : [...run.eventIds, action.event.id]
        } : run)
      }));
      return stateFromSession(state, session);
    }
    case 'apply-run-event': {
      const chat = state.session.chats.find((candidate) =>
        candidate.runs.some((run) => run.operationId === action.event.operationId)
      );
      if (!chat || chat.intermediateEvents?.some((event) => event.eventId === action.event.eventId)) return state;
      const status = statusFromIntermediateEvent(action.event);
      const session = updateChatById(state.session, chat.id, (thread) => ({
        ...thread,
        intermediateEvents: [...(thread.intermediateEvents ?? []), action.event].slice(-160),
        runs: thread.runs.map((run) => run.operationId === action.event.operationId
          ? { ...run, status, updatedAt: action.event.createdAt }
          : run)
      }));
      return stateFromSession(state, session);
    }
    case 'append-assistant-message': {
      const chatId = chatIdForRun(state.session, action.event.runId);
      if (!chatId) return state;
      const session = updateChatById(state.session, chatId, (chat) => ({
        ...chat,
        updatedAt: action.message.createdAt,
        messages: [...chat.messages, action.message],
        contextEstimateState: action.message.contextUsage ? 'ready' : chat.contextEstimateState,
        contextUsage: action.message.contextUsage ?? chat.contextUsage,
        conversationSummary: action.message.conversationSummary ?? chat.conversationSummary,
        providerHistoryStartIndex: action.message.providerHistoryStartIndex ?? chat.providerHistoryStartIndex,
        activeGoal: action.status === 'needs-input'
          && action.message.execution?.state === 'needs-input'
          && action.message.execution.mode === 'repair'
          ? {
              goalId: action.message.execution.goalId,
              mode: action.message.execution.mode,
              origin: action.message.execution.origin === 'continuation'
                ? (chat.activeGoal?.origin ?? 'implicit')
                : action.message.execution.origin,
              requestedOutcome: action.message.execution.requestedOutcome,
              pendingQuestion: action.message.execution.pendingQuestion ?? action.message.text
            }
          : null,
        runs: chat.runs.map((run) => run.id === action.event.runId ? {
          ...run,
          state: 'completed',
          status: action.status,
          updatedAt: action.event.createdAt,
          eventIds: [...run.eventIds, action.event.id]
        } : run)
      }));
      return stateFromSession(state, session);
    }
    case 'cancel-run': {
      const chatId = chatIdForRun(state.session, action.event.runId);
      if (!chatId) return state;
      const session = updateChatById(state.session, chatId, (chat) => ({
        ...chat,
        activeGoal: null,
        messages: [...chat.messages, action.message],
        runs: chat.runs.map((run) => run.id === action.event.runId ? {
          ...run,
          state: 'cancelled',
          status: 'stopped',
          updatedAt: action.event.createdAt,
          eventIds: [...run.eventIds, action.event.id]
        } : run)
      }));
      return stateFromSession(state, session);
    }
    case 'update-file-change-set': {
      const session = {
        ...state.session,
        chats: state.session.chats.map((chat) => ({
          ...chat,
          messages: chat.messages.map((message) =>
            message.fileChangeSet?.runId === action.changeSet.runId
              ? { ...message, fileChangeSet: action.changeSet }
              : message
          )
        }))
      };
      return stateFromSession(state, session);
    }
    case 'restore-file-rollback-states': {
      const byRunId = new Map(action.states.map((rollbackState) => [rollbackState.runId, rollbackState]));
      const session = {
        ...state.session,
        chats: state.session.chats.map((chat) => chat.id !== action.chatId ? chat : ({
          ...chat,
          messages: chat.messages.map((message) => {
            const changeSet = message.fileChangeSet;
            const rollbackState = changeSet ? byRunId.get(changeSet.runId) : undefined;
            if (!changeSet) return message;
            const restoredState = rollbackState?.state ?? 'unavailable';
            const restoredReason = rollbackState?.reason ?? 'checkpoint-corrupt';
            return {
              ...message,
              fileChangeSet: {
                ...changeSet,
                rollbackState: restoredState,
                rollbackReason: restoredReason,
                files: changeSet.files.map((file) => ({
                  ...file,
                  rollbackState: restoredState
                }))
              }
            };
          })
        }))
      };
      return stateFromSession(state, session);
    }
    case 'update-capability-rollback': {
      const session = {
        ...state.session,
        chats: state.session.chats.map((chat) => ({
          ...chat,
          messages: chat.messages.map((message) => ({
            ...message,
            execution: message.execution ? {
              ...message.execution,
              verifiedEffects: message.execution.verifiedEffects.map((effect) =>
                effect.compensationToken === action.compensationToken
                  ? { ...effect, rollbackState: action.rollbackState }
                  : effect
              )
            } : message.execution
          }))
        }))
      };
      return stateFromSession(state, session);
    }
    default: return state;
  }
}
