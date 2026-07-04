import type {
  FluxoraAiCitation,
  FluxoraAiContextBundle,
  FluxoraAiContextUsage,
  FluxoraAiCostEstimate,
  FluxoraAiCostLedgerEntry,
  FluxoraAiCaseState,
  FluxoraAiDiagnosisJudge,
  FluxoraAiIntermediateEvent,
  FluxoraAiResearchReport,
  FluxoraAiRoutingPreset,
  FluxoraAiMultiModelOrchestration,
  FluxoraAiModResearchRoute,
  FluxoraAiTaskPermissionClass,
  FluxoraAiTokenUsage,
  FluxoraAiSubagentSchedule,
  FluxoraAiTaskPlan,
  FluxoraSkillSelection
} from '../../../shared/fluxora-api';

export type AiAgentStatus = 'idle' | 'thinking' | 'needs-approval' | 'running' | 'done' | 'blocked';
export type AiSubagentChatStatus = 'queued' | 'thinking' | 'needs-approval' | 'done' | 'blocked';

export type AiMessageRole = 'user' | 'assistant';

export type AiRunState = 'queued' | 'streaming' | 'completed' | 'cancelled' | 'recovered';
export type AiContextEstimateState = 'idle' | 'counting' | 'ready' | 'error';

export type AiStreamEventType =
  | 'run-created'
  | 'status'
  | 'assistant-delta'
  | 'run-finished'
  | 'run-cancelled'
  | 'run-recovered';

export interface AiMessage {
  id: string;
  role: AiMessageRole;
  text: string;
  createdAt: string;
  runId?: string;
  agentStatus?: AiAgentStatus;
  costEstimate?: FluxoraAiCostEstimate;
  isStreaming?: boolean;
  modelId?: string;
  providerId?: string;
  routingPreset?: FluxoraAiRoutingPreset;
  sources?: FluxoraAiCitation[];
  contextBundle?: FluxoraAiContextBundle | null;
  contextUsage?: FluxoraAiContextUsage | null;
  tokenUsage?: FluxoraAiTokenUsage | null;
  researchReport?: FluxoraAiResearchReport | null;
  modResearchRoute?: FluxoraAiModResearchRoute | null;
  diagnosisJudge?: FluxoraAiDiagnosisJudge | null;
  caseState?: FluxoraAiCaseState | null;
  taskPlan?: FluxoraAiTaskPlan | null;
  subagentSchedule?: FluxoraAiSubagentSchedule | null;
  orchestration?: FluxoraAiMultiModelOrchestration | null;
  selectedSkill?: FluxoraSkillSelection | null;
  providerDiagnostics?: string[];
}

export interface AiFakeRunPlan {
  finalStatus: AiAgentStatus;
  reply: string;
}

export interface AiStreamEvent {
  id: string;
  runId: string;
  operationId: string;
  type: AiStreamEventType;
  createdAt: string;
  status?: AiAgentStatus;
  textDelta?: string;
}

export interface AiRun {
  id: string;
  sessionId: string;
  operationId: string;
  state: AiRunState;
  status: AiAgentStatus;
  createdAt: string;
  updatedAt: string;
  promptDigest: string;
  promptLength: number;
  eventIds: string[];
  fallbackProviders?: string[];
  modelId?: string;
  providerId?: string;
  routingPreset?: FluxoraAiRoutingPreset;
  cancellationRequested?: boolean;
  toolsAllowed?: false;
}

export interface AiSubagentChatMetadata {
  id: string;
  operationId: string;
  parentChatId: string;
  parentRunId?: string;
  agentId: string;
  label: string;
  role: string;
  status: AiSubagentChatStatus;
  summary: string;
  detailText?: string;
  permissionClass?: FluxoraAiTaskPermissionClass;
  providerId?: string;
  modelId?: string;
}

export interface AiChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  subagent?: AiSubagentChatMetadata | null;
  contextEstimateState: AiContextEstimateState;
  contextUsage?: FluxoraAiContextUsage | null;
  costLedger: FluxoraAiCostLedgerEntry[];
  intermediateEvents: FluxoraAiIntermediateEvent[];
  messages: AiMessage[];
  runs: AiRun[];
  streamEvents: AiStreamEvent[];
}

export interface AiSession {
  id: string;
  scopeKey: string;
  buildLabel: string;
  createdAt: string;
  updatedAt: string;
  activeChatId: string;
  chats: AiChatThread[];
  costLedger: FluxoraAiCostLedgerEntry[];
  intermediateEvents: FluxoraAiIntermediateEvent[];
  messages: AiMessage[];
  runs: AiRun[];
  streamEvents: AiStreamEvent[];
}

export interface AiChatState {
  activeRunId: string | null;
  activeChatId: string;
  chats: AiChatThread[];
  draft: string;
  isCollapsed: boolean;
  isOpen: boolean;
  isRunning: boolean;
  messages: AiMessage[];
  session: AiSession;
  status: AiAgentStatus;
  intermediateEvents: FluxoraAiIntermediateEvent[];
  streamEvents: AiStreamEvent[];
  width: number;
}

export type AiChatAction =
  | { type: 'toggle-open' }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'toggle-collapse' }
  | { type: 'set-collapsed'; value: boolean }
  | { type: 'set-draft'; value: string }
  | { type: 'set-status'; status: AiAgentStatus; isRunning?: boolean }
  | { type: 'set-width'; width: number }
  | { type: 'create-chat'; now?: Date }
  | { type: 'close-chat'; chatId: string; now?: Date }
  | { type: 'select-chat'; chatId: string }
  | { type: 'open-subagent-chat'; subagent: AiSubagentChatMetadata; now?: Date }
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
      status?: AiAgentStatus;
      ledgerEntry?: FluxoraAiCostLedgerEntry;
    }
  | { type: 'cancel-run'; message: AiMessage; event: AiStreamEvent };

export const AI_CHAT_PANEL_MIN_WIDTH = 320;
export const AI_CHAT_PANEL_MAX_WIDTH = 560;
export const AI_CHAT_PANEL_DEFAULT_WIDTH = 380;
export const AI_CHAT_PANEL_COLLAPSED_WIDTH = 56;
export const DEFAULT_AI_CHAT_TITLE = 'New chat';

export const aiStatusLabels: Record<AiAgentStatus, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  'needs-approval': 'Needs approval',
  running: 'Running',
  done: 'Done',
  blocked: 'Blocked'
};

export const aiStatusOrder: AiAgentStatus[] = [
  'idle',
  'thinking',
  'needs-approval',
  'running',
  'done',
  'blocked'
];

export const aiContextUsageLevelForPercent = (
  percent: number
): FluxoraAiContextUsage['level'] => {
  if (percent >= 97) {
    return 'almost-full';
  }
  if (percent >= 92) {
    return 'critical';
  }
  if (percent >= 80) {
    return 'warning';
  }
  if (percent >= 60) {
    return 'moderate';
  }
  return 'normal';
};

export const aiContextUsageModeForPercent = (
  percent: number
): FluxoraAiContextUsage['mode'] => {
  if (percent >= 95) {
    return 'strict';
  }
  if (percent >= 85) {
    return 'compressed';
  }
  if (percent >= 70) {
    return 'smart';
  }
  return 'full';
};

const clampAiContextPercent = (tokens: number, contextWindowTokens: number): number => {
  if (contextWindowTokens <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (tokens / contextWindowTokens) * 100));
};

export const approximateAiContextUsageForDraft = (
  contextUsage: FluxoraAiContextUsage | null | undefined,
  draft: string
): FluxoraAiContextUsage | null => {
  if (!contextUsage) {
    return null;
  }

  const draftTokens = Math.ceil(Math.max(0, draft.length) / 4);
  if (draftTokens <= 0) {
    return contextUsage;
  }

  const currentContextTokens = Math.min(
    contextUsage.contextWindowTokens,
    Math.max(0, contextUsage.currentContextTokens + draftTokens)
  );
  const currentContextPercent = clampAiContextPercent(
    currentContextTokens,
    contextUsage.contextWindowTokens
  );
  const includedSections = contextUsage.includedSections.includes('draft-approximation')
    ? contextUsage.includedSections
    : [...contextUsage.includedSections, 'draft-approximation'];

  return {
    ...contextUsage,
    currentContextTokens,
    currentContextPercent,
    precision: 'estimated',
    level: aiContextUsageLevelForPercent(currentContextPercent),
    mode: aiContextUsageModeForPercent(currentContextPercent),
    includedSections,
    actionRequired: currentContextPercent >= 97
  };
};

const compactAiChatTimestamp = (now: Date) => now.toISOString().replace(/[-:.TZ]/g, '');

const createAiChatId = (scopeKey: string, now: Date): string =>
  `ai-chat-${scopeKey}-${compactAiChatTimestamp(now)}-${Math.random().toString(36).slice(2, 8)}`;

const compactAiChatIdPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 96) ||
  'subagent';

const createAiSubagentChatId = (scopeKey: string, subagent: AiSubagentChatMetadata): string =>
  `ai-subagent-${compactAiChatIdPart(scopeKey)}-${compactAiChatIdPart(subagent.id)}`;

export function createAiChatTitleFromPrompt(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return DEFAULT_AI_CHAT_TITLE;
  }

  return normalized.length > 36 ? `${normalized.slice(0, 33).trimEnd()}...` : normalized;
}

const isDefaultAiChatTitle = (title: string): boolean =>
  title.trim().length === 0 || title === DEFAULT_AI_CHAT_TITLE;

const latestContextUsageForMessages = (
  messages: AiMessage[]
): FluxoraAiContextUsage | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const contextUsage = messages[index]?.contextUsage;
    if (contextUsage) {
      return contextUsage;
    }
  }
  return null;
};

export function createAiChatThread(
  scopeKey = 'global',
  now = new Date(),
  title = DEFAULT_AI_CHAT_TITLE
): AiChatThread {
  const createdAt = now.toISOString();

  return {
    id: createAiChatId(scopeKey, now),
    title,
    createdAt,
    updatedAt: createdAt,
    contextEstimateState: 'idle',
    contextUsage: null,
    costLedger: [],
    intermediateEvents: [],
    messages: [],
    runs: [],
    streamEvents: []
  };
}

const aiAgentStatusFromSubagentStatus = (status: AiSubagentChatStatus): AiAgentStatus => {
  switch (status) {
    case 'thinking':
      return 'thinking';
    case 'needs-approval':
      return 'needs-approval';
    case 'done':
      return 'done';
    case 'blocked':
      return 'blocked';
    case 'queued':
    default:
      return 'idle';
  }
};

const createAiSubagentChatTitle = (subagent: AiSubagentChatMetadata): string => {
  const label = subagent.label.trim() || subagent.agentId.trim() || 'Subagent';
  return label.length > 34 ? `${label.slice(0, 31).trimEnd()}...` : label;
};

const createAiSubagentChatText = (subagent: AiSubagentChatMetadata): string => {
  const detail = subagent.detailText?.trim();
  if (detail) {
    return detail;
  }

  return subagent.summary.trim() || 'No subagent output was returned.';
};

const createAiSubagentChatThread = (
  scopeKey: string,
  subagent: AiSubagentChatMetadata,
  now: Date
): AiChatThread => {
  const createdAt = now.toISOString();
  const message = createAiMessage(
    'assistant',
    createAiSubagentChatText(subagent),
    now,
    subagent.parentRunId,
    {
      agentStatus: aiAgentStatusFromSubagentStatus(subagent.status),
      modelId: subagent.modelId,
      providerId: subagent.providerId
    }
  );

  return {
    id: createAiSubagentChatId(scopeKey, subagent),
    title: createAiSubagentChatTitle(subagent),
    createdAt,
    updatedAt: createdAt,
    subagent,
    contextEstimateState: 'idle',
    contextUsage: message.contextUsage ?? null,
    costLedger: [],
    intermediateEvents: [],
    messages: [message],
    runs: [],
    streamEvents: []
  };
};

const createLegacyAiChatThread = (session: AiSession): AiChatThread => {
  const firstUserMessage = session.messages.find((message) => message.role === 'user');

  return {
    id: `ai-chat-${session.scopeKey}-legacy`,
    title: firstUserMessage ? createAiChatTitleFromPrompt(firstUserMessage.text) : DEFAULT_AI_CHAT_TITLE,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    contextEstimateState: 'idle',
    contextUsage: latestContextUsageForMessages(session.messages ?? []),
    costLedger: session.costLedger ?? [],
    intermediateEvents: session.intermediateEvents ?? [],
    messages: session.messages ?? [],
    runs: session.runs ?? [],
    streamEvents: session.streamEvents ?? []
  };
};

export const activeAiChatThread = (session: AiSession): AiChatThread => {
  const chats = session.chats.length > 0 ? session.chats : [createLegacyAiChatThread(session)];
  return chats.find((chat) => chat.id === session.activeChatId) ?? chats[0];
};

export const syncAiSessionToActiveChat = (session: AiSession): AiSession => {
  const rootHasChatPayload =
    (session.messages?.length ?? 0) > 0 ||
    (session.runs?.length ?? 0) > 0 ||
    (session.streamEvents?.length ?? 0) > 0 ||
    (session.intermediateEvents?.length ?? 0) > 0 ||
    (session.costLedger?.length ?? 0) > 0;
  let chats = session.chats.length > 0 ? session.chats : [createLegacyAiChatThread(session)];
  const initialActiveChat = chats.find((chat) => chat.id === session.activeChatId) ?? chats[0];

  if (
    rootHasChatPayload &&
    initialActiveChat &&
    initialActiveChat.messages.length === 0 &&
    initialActiveChat.runs.length === 0 &&
    initialActiveChat.streamEvents.length === 0 &&
    (initialActiveChat.intermediateEvents?.length ?? 0) === 0
  ) {
    const firstUserMessage = session.messages.find((message) => message.role === 'user');
    const hydratedChat = {
      ...initialActiveChat,
      title:
        isDefaultAiChatTitle(initialActiveChat.title) && firstUserMessage
          ? createAiChatTitleFromPrompt(firstUserMessage.text)
          : initialActiveChat.title,
      updatedAt: session.updatedAt,
      costLedger: session.costLedger ?? [],
      intermediateEvents: session.intermediateEvents ?? [],
      messages: session.messages ?? [],
      runs: session.runs ?? [],
      streamEvents: session.streamEvents ?? []
    };
    chats = chats.map((chat) => (chat.id === hydratedChat.id ? hydratedChat : chat));
  }

  const activeChat = chats.find((chat) => chat.id === session.activeChatId) ?? chats[0];

  return {
    ...session,
    activeChatId: activeChat.id,
    updatedAt: activeChat.updatedAt,
    costLedger: activeChat.costLedger ?? [],
    intermediateEvents: activeChat.intermediateEvents ?? [],
    messages: activeChat.messages ?? [],
    runs: activeChat.runs ?? [],
    streamEvents: activeChat.streamEvents ?? [],
    chats
  };
};

export function createAiSession(
  scopeKey = 'global',
  buildLabel = 'No build selected',
  now = new Date()
): AiSession {
  const createdAt = now.toISOString();
  const chat = createAiChatThread(scopeKey, now);

  return {
    id: `ai-session-${scopeKey}`,
    scopeKey,
    buildLabel,
    createdAt,
    updatedAt: createdAt,
    activeChatId: chat.id,
    chats: [chat],
    costLedger: chat.costLedger,
    intermediateEvents: chat.intermediateEvents,
    messages: chat.messages,
    runs: chat.runs,
    streamEvents: chat.streamEvents
  };
}

const initialAiSession = createAiSession();

export const initialAiChatState: AiChatState = {
  activeRunId: null,
  activeChatId: initialAiSession.activeChatId,
  chats: initialAiSession.chats,
  draft: '',
  isCollapsed: false,
  isOpen: false,
  isRunning: false,
  intermediateEvents: [],
  messages: [],
  session: initialAiSession,
  status: 'idle',
  streamEvents: [],
  width: AI_CHAT_PANEL_DEFAULT_WIDTH
};

export const clampAiChatPanelWidth = (width: number) =>
  Math.min(AI_CHAT_PANEL_MAX_WIDTH, Math.max(AI_CHAT_PANEL_MIN_WIDTH, Math.round(width)));

export function createAiMessage(
  role: AiMessageRole,
  text: string,
  now = new Date(),
  runId?: string,
  metadata: Partial<Omit<AiMessage, 'id' | 'role' | 'text' | 'createdAt' | 'runId'>> = {}
): AiMessage {
  return {
    id: `${role}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    createdAt: now.toISOString(),
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
  const createdAt = now.toISOString();

  return {
    id: `run-${createdAt.replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    operationId,
    state: 'queued',
    status: 'thinking',
    createdAt,
    updatedAt: createdAt,
    promptDigest,
    promptLength,
    eventIds: [],
    toolsAllowed: false
  };
}

export function createAiStreamEvent(
  run: Pick<AiRun, 'id' | 'operationId'>,
  type: AiStreamEventType,
  options: { status?: AiAgentStatus; textDelta?: string; now?: Date } = {}
): AiStreamEvent {
  const createdAt = (options.now ?? new Date()).toISOString();

  return {
    id: `evt-${createdAt.replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 8)}`,
    runId: run.id,
    operationId: run.operationId,
    type,
    createdAt,
    status: options.status,
    textDelta: options.textDelta
  };
}

export function createFakeAiRunPlan(prompt: string): AiFakeRunPlan {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, ' ');
  const lowerPrompt = normalizedPrompt.toLowerCase();

  if (lowerPrompt.includes('approval')) {
    return {
      finalStatus: 'needs-approval',
      reply: 'Plan first: review the request, identify the approval point, then ask you to confirm. Chat-only mode cannot approve or run the action itself.'
    };
  }

  if (lowerPrompt.includes('blocked')) {
    return {
      finalStatus: 'blocked',
      reply: 'Plan first: collect the missing input, then retry the analysis. Chat-only mode did not change the build.'
    };
  }

  const subject = normalizedPrompt.length > 72 ? `${normalizedPrompt.slice(0, 69)}...` : normalizedPrompt;

  return {
    finalStatus: 'done',
    reply: subject
      ? `Plan first: review "${subject}", then suggest safe Fluxora steps. Chat-only mode cannot run tools or change the build.`
      : 'Plan first: describe the Fluxora question, then I can suggest safe next steps without running tools.'
  };
}

const touchChat = (chat: AiChatThread, updatedAt: string): AiChatThread => ({
  ...chat,
  updatedAt
});

const appendChatEvent = (chat: AiChatThread, event: AiStreamEvent): AiChatThread => ({
  ...touchChat(chat, event.createdAt),
  streamEvents: [...chat.streamEvents, event],
  runs: chat.runs.map((run) =>
    run.id === event.runId
      ? {
          ...run,
          eventIds: [...run.eventIds, event.id],
          status: event.status ?? run.status,
          state:
            event.type === 'status'
              ? 'streaming'
              : event.type === 'run-finished'
                ? 'completed'
                : event.type === 'run-cancelled'
                  ? 'cancelled'
                  : event.type === 'run-recovered'
                    ? 'recovered'
                    : run.state,
          updatedAt: event.createdAt,
          cancellationRequested: event.type === 'run-cancelled' ? true : run.cancellationRequested
        }
      : run
  )
});

const intermediateEventStatus = (event: FluxoraAiIntermediateEvent): AiAgentStatus =>
  event.level === 'error' || event.type === 'error' ? 'blocked' : 'running';

const intermediateEventSortKey = (event: FluxoraAiIntermediateEvent): string =>
  `${String(event.seq).padStart(12, '0')}|${event.createdAt}|${event.eventId}`;

const appendIntermediateEvent = (
  chat: AiChatThread,
  event: FluxoraAiIntermediateEvent
): AiChatThread => {
  if (chat.intermediateEvents.some((candidate) => candidate.eventId === event.eventId)) {
    return chat;
  }

  const intermediateEvents = [...chat.intermediateEvents, event].sort((left, right) =>
    intermediateEventSortKey(left).localeCompare(intermediateEventSortKey(right))
  );

  return {
    ...touchChat(chat, event.createdAt),
    intermediateEvents,
    runs: chat.runs.map((run) => {
      if (run.id !== event.runId) {
        return run;
      }

      const terminal =
        run.state === 'completed' || run.state === 'cancelled' || run.state === 'recovered';
      return {
        ...run,
        eventIds: run.eventIds.includes(event.eventId)
          ? run.eventIds
          : [...run.eventIds, event.eventId],
        status: terminal ? run.status : intermediateEventStatus(event),
        state: terminal ? run.state : 'streaming',
        updatedAt: event.createdAt
      };
    })
  };
};

const updateSessionChat = (
  session: AiSession,
  chatId: string,
  update: (chat: AiChatThread) => AiChatThread
): AiSession => {
  const normalizedSession = syncAiSessionToActiveChat(session);
  const chats = normalizedSession.chats.map((chat) => (chat.id === chatId ? update(chat) : chat));

  return syncAiSessionToActiveChat({
    ...normalizedSession,
    chats
  });
};

const updateActiveSessionChat = (
  session: AiSession,
  update: (chat: AiChatThread) => AiChatThread
): AiSession => updateSessionChat(session, syncAiSessionToActiveChat(session).activeChatId, update);

const updateSessionChatByRun = (
  session: AiSession,
  runId: string,
  update: (chat: AiChatThread) => AiChatThread
): AiSession => {
  const normalizedSession = syncAiSessionToActiveChat(session);
  const targetChat =
    normalizedSession.chats.find((chat) => chat.runs.some((run) => run.id === runId)) ??
    activeAiChatThread(normalizedSession);

  return updateSessionChat(normalizedSession, targetChat.id, update);
};

const activeRunForChat = (chat: AiChatThread): AiRun | undefined =>
  chat.runs.find((run) => run.state === 'queued' || run.state === 'streaming');

const applySessionToState = (state: AiChatState, session: AiSession): AiChatState => {
  const normalizedSession = syncAiSessionToActiveChat(session);
  const activeChat = activeAiChatThread(normalizedSession);
  const activeRun = activeRunForChat(activeChat);

  return {
    ...state,
    activeChatId: activeChat.id,
    activeRunId: activeRun?.id ?? null,
    chats: normalizedSession.chats,
    isRunning: Boolean(activeRun),
    intermediateEvents: activeChat.intermediateEvents,
    messages: activeChat.messages,
    session: normalizedSession,
    status: activeRun?.status ?? activeChat.runs.at(-1)?.status ?? 'idle',
    streamEvents: activeChat.streamEvents
  };
};

const finalizeAssistantMessage = (messages: AiMessage[], message: AiMessage): AiMessage[] => {
  const existingIndex = messages.findIndex(
    (candidate) =>
      candidate.runId === message.runId &&
      candidate.role === 'assistant' &&
      candidate.isStreaming
  );
  if (existingIndex < 0) {
    return [...messages, message];
  }

  return messages.map((candidate, index) =>
    index === existingIndex
      ? {
          ...message,
          id: candidate.id,
          isStreaming: false
        }
      : candidate
  );
};

export function aiChatReducer(state: AiChatState, action: AiChatAction): AiChatState {
  switch (action.type) {
    case 'toggle-open': {
      return {
        ...state,
        isCollapsed: state.isOpen ? state.isCollapsed : false,
        isOpen: !state.isOpen
      };
    }
    case 'open': {
      return {
        ...state,
        isCollapsed: false,
        isOpen: true
      };
    }
    case 'close': {
      return {
        ...state,
        isCollapsed: false,
        isOpen: false
      };
    }
    case 'toggle-collapse': {
      return {
        ...state,
        isCollapsed: !state.isCollapsed,
        isOpen: true
      };
    }
    case 'set-collapsed': {
      return {
        ...state,
        isCollapsed: action.value,
        isOpen: true
      };
    }
    case 'set-draft': {
      return {
        ...state,
        draft: action.value
      };
    }
    case 'set-status': {
      return {
        ...state,
        isRunning: action.isRunning ?? state.isRunning,
        status: action.status
      };
    }
    case 'set-width': {
      return {
        ...state,
        width: clampAiChatPanelWidth(action.width)
      };
    }
    case 'create-chat': {
      if (state.isRunning) {
        return state;
      }

      const normalizedSession = syncAiSessionToActiveChat(state.session);
      const chat = createAiChatThread(normalizedSession.scopeKey, action.now ?? new Date());
      return applySessionToState(
        {
          ...state,
          draft: '',
          isCollapsed: false,
          isOpen: true
        },
        {
          ...normalizedSession,
          activeChatId: chat.id,
          costLedger: chat.costLedger,
          intermediateEvents: chat.intermediateEvents,
          messages: chat.messages,
          runs: chat.runs,
          streamEvents: chat.streamEvents,
          chats: [...normalizedSession.chats, chat]
        }
      );
    }
    case 'close-chat': {
      if (state.isRunning) {
        return state;
      }

      const normalizedSession = syncAiSessionToActiveChat(state.session);
      const targetIndex = normalizedSession.chats.findIndex((chat) => chat.id === action.chatId);
      if (targetIndex < 0) {
        return state;
      }

      const remainingChats = normalizedSession.chats.filter((chat) => chat.id !== action.chatId);
      const wasActiveChat = normalizedSession.activeChatId === action.chatId;

      if (remainingChats.length === 0) {
        const chat = createAiChatThread(normalizedSession.scopeKey, action.now ?? new Date());
        return applySessionToState(
          {
            ...state,
            draft: '',
            isCollapsed: false,
            isOpen: true
          },
          {
            ...normalizedSession,
            activeChatId: chat.id,
            costLedger: chat.costLedger,
            intermediateEvents: chat.intermediateEvents,
            messages: chat.messages,
            runs: chat.runs,
            streamEvents: chat.streamEvents,
            chats: [chat]
          }
        );
      }

      const activeChat = wasActiveChat
        ? remainingChats[Math.max(0, targetIndex - 1)] ?? remainingChats[0]
        : remainingChats.find((chat) => chat.id === normalizedSession.activeChatId) ?? remainingChats[0];

      return applySessionToState(
        {
          ...state,
          draft: wasActiveChat ? '' : state.draft
        },
        {
          ...normalizedSession,
          activeChatId: activeChat.id,
          costLedger: activeChat.costLedger,
          intermediateEvents: activeChat.intermediateEvents,
          messages: activeChat.messages,
          runs: activeChat.runs,
          streamEvents: activeChat.streamEvents,
          chats: remainingChats
        }
      );
    }
    case 'select-chat': {
      if (state.isRunning) {
        return state;
      }

      const normalizedSession = syncAiSessionToActiveChat(state.session);
      if (!normalizedSession.chats.some((chat) => chat.id === action.chatId)) {
        return state;
      }

      const selectedChat =
        normalizedSession.chats.find((chat) => chat.id === action.chatId) ??
        activeAiChatThread(normalizedSession);

      return applySessionToState(
        {
          ...state,
          draft: ''
        },
        {
          ...normalizedSession,
          activeChatId: selectedChat.id,
          costLedger: selectedChat.costLedger,
          intermediateEvents: selectedChat.intermediateEvents,
          messages: selectedChat.messages,
          runs: selectedChat.runs,
          streamEvents: selectedChat.streamEvents
        }
      );
    }
    case 'open-subagent-chat': {
      if (state.isRunning) {
        return state;
      }

      const normalizedSession = syncAiSessionToActiveChat(state.session);
      const subagentChatId = createAiSubagentChatId(normalizedSession.scopeKey, action.subagent);
      const existingChat = normalizedSession.chats.find(
        (chat) => chat.id === subagentChatId || chat.subagent?.id === action.subagent.id
      );

      if (existingChat) {
        return applySessionToState(
          {
            ...state,
            draft: ''
          },
          {
            ...normalizedSession,
            activeChatId: existingChat.id,
            costLedger: existingChat.costLedger,
            intermediateEvents: existingChat.intermediateEvents,
            messages: existingChat.messages,
            runs: existingChat.runs,
            streamEvents: existingChat.streamEvents
          }
        );
      }

      const chat = createAiSubagentChatThread(
        normalizedSession.scopeKey,
        action.subagent,
        action.now ?? new Date()
      );

      return applySessionToState(
        {
          ...state,
          draft: '',
          isCollapsed: false,
          isOpen: true
        },
        {
          ...normalizedSession,
          activeChatId: chat.id,
          costLedger: chat.costLedger,
          intermediateEvents: chat.intermediateEvents,
          messages: chat.messages,
          runs: chat.runs,
          streamEvents: chat.streamEvents,
          chats: [...normalizedSession.chats, chat]
        }
      );
    }
    case 'restore-session': {
      return applySessionToState(state, syncAiSessionToActiveChat(action.session));
    }
    case 'submit-user-message': {
      const session = updateActiveSessionChat(state.session, (chat) => ({
        ...touchChat(chat, action.event.createdAt),
        title:
          isDefaultAiChatTitle(chat.title) && chat.messages.length === 0
            ? createAiChatTitleFromPrompt(action.message.text)
            : chat.title,
        contextEstimateState: 'idle',
        messages: [...chat.messages, action.message],
        runs: [...chat.runs, { ...action.run, eventIds: [action.event.id] }],
        streamEvents: [...chat.streamEvents, action.event]
      }));

      return applySessionToState(
        {
          ...state,
          draft: '',
          isCollapsed: false,
          isOpen: true
        },
        session
      );
    }
    case 'set-context-estimate': {
      const session = updateSessionChatByRun(state.session, action.runId, (chat) => ({
        ...chat,
        contextEstimateState: action.estimateState,
        contextUsage:
          action.contextUsage === undefined ? chat.contextUsage ?? null : action.contextUsage
      }));

      return applySessionToState(state, session);
    }
    case 'apply-stream-event': {
      const session = updateSessionChatByRun(state.session, action.event.runId, (chat) => {
        return appendChatEvent(chat, action.event);
      });

      return applySessionToState(state, session);
    }
    case 'apply-run-event': {
      const session = updateSessionChatByRun(state.session, action.event.runId, (chat) => {
        return appendIntermediateEvent(chat, action.event);
      });

      return applySessionToState(state, session);
    }
    case 'append-assistant-message': {
      const session = updateSessionChatByRun(state.session, action.event.runId, (chat) => {
        const chatWithEvent = appendChatEvent(chat, action.event);
        const messages = finalizeAssistantMessage(chatWithEvent.messages, action.message);

        return {
          ...touchChat(chatWithEvent, action.message.createdAt),
          contextEstimateState: action.message.contextUsage ? 'ready' : chatWithEvent.contextEstimateState,
          contextUsage: action.message.contextUsage ?? chatWithEvent.contextUsage ?? null,
          costLedger: action.ledgerEntry
            ? [...(chatWithEvent.costLedger ?? []), action.ledgerEntry]
            : chatWithEvent.costLedger ?? [],
          messages
        };
      });

      return {
        ...applySessionToState(state, session),
        status: action.status ?? applySessionToState(state, session).status
      };
    }
    case 'cancel-run': {
      const session = updateSessionChatByRun(state.session, action.event.runId, (chat) => {
        const chatWithEvent = appendChatEvent(chat, action.event);

        return {
          ...touchChat(chatWithEvent, action.message.createdAt),
          contextEstimateState: 'idle',
          messages: [...chatWithEvent.messages, action.message]
        };
      });

      return {
        ...applySessionToState(state, session),
        status: 'idle'
      };
    }
    default: {
      return state;
    }
  }
}
