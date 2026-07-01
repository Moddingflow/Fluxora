import {
  ChevronLeft,
  ChevronRight,
  CircleStop,
  MessageSquare,
  Mic,
  Plus,
  Send,
  X
} from 'lucide-react';
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from 'react';
import { useRef } from 'react';

import closeTabIcon from '../../../../../Icons/circle-x.svg';
import geminiIcon from '../../../../../Icons/gemini.svg';
import type {
  FluxoraAiModelAgentResult,
  FluxoraAiSubagentDescriptor,
  FluxoraAiTaskPlanStep,
  FluxoraAiTaskStepStatus
} from '../../../shared/fluxora-api';
import {
  AI_CHAT_PANEL_COLLAPSED_WIDTH,
  AI_CHAT_PANEL_MAX_WIDTH,
  AI_CHAT_PANEL_MIN_WIDTH,
  aiStatusLabels,
  aiStatusOrder,
  type AiChatState,
  type AiMessage,
  type AiSubagentChatMetadata,
  type AiSubagentChatStatus
} from './ai-chat-state';
import { formatAiCost, type AiProviderDiagnostic } from './ai-chat-settings';
import { safeAiSourceUrl, sanitizeAiChatText } from './ai-chat-security';

export interface AiChatPanelProps {
  hostReady?: boolean;
  providerDiagnostic?: AiProviderDiagnostic | null;
  state: AiChatState;
  onCancel: () => void;
  onClose: () => void;
  onCloseChat: (chatId: string) => void;
  onCreateChat: () => void;
  onDraftChange: (value: string) => void;
  onOpenSubagentChat: (subagent: AiSubagentChatMetadata) => void;
  onOpenSource?: (url: string) => void;
  onResize: (width: number) => void;
  onSend: () => void;
  onSelectChat: (chatId: string) => void;
  onToggleCollapse: () => void;
}

const messageTime = (createdAt: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(createdAt));

const compactPlanSteps = (steps: FluxoraAiTaskPlanStep[]): FluxoraAiTaskPlanStep[] =>
  steps.slice(0, 5);

const aiCostLabel = (cost: NonNullable<AiChatState['messages'][number]['costEstimate']>) => {
  const actualCost = cost.actualInternalCost ?? cost.actualCost;
  const value = actualCost ?? cost.displayCost ?? cost.internalCost;
  const prefix = actualCost === null || actualCost === undefined ? 'Est' : 'Actual';

  return `${prefix} ${formatAiCost(value, cost.currency)}`;
};

const aiSubagentStatusLabels: Record<AiSubagentChatStatus, string> = {
  queued: 'Queued',
  thinking: 'Thinking',
  'needs-approval': 'Needs approval',
  done: 'Done',
  blocked: 'Blocked'
};

const compactSubagentSummary = (value: string): string => {
  const normalized = sanitizeAiChatText(value).replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117).trimEnd()}...` : normalized;
};

const taskStepStatusToSubagentStatus = (
  status: FluxoraAiTaskStepStatus,
  message: AiMessage,
  agentId: string
): AiSubagentChatStatus => {
  if (status === 'completed') {
    return 'done';
  }
  if (status === 'running') {
    return 'thinking';
  }
  if (status === 'needs-approval') {
    return 'needs-approval';
  }
  if (status === 'blocked') {
    return 'blocked';
  }
  if (message.isStreaming || message.agentStatus === 'thinking' || message.agentStatus === 'running') {
    return 'thinking';
  }
  if (agentId === 'plan-review' && message.agentStatus === 'needs-approval') {
    return 'needs-approval';
  }
  if (message.agentStatus === 'blocked') {
    return 'blocked';
  }

  return message.text.trim().length > 0 ? 'done' : 'queued';
};

const orchestrationStatusToSubagentStatus = (status: string): AiSubagentChatStatus => {
  if (status === 'completed' || status === 'final-completed') {
    return 'done';
  }
  if (status === 'blocked') {
    return 'blocked';
  }
  return 'thinking';
};

const scheduleDescriptorToSubagent = (
  descriptor: FluxoraAiSubagentDescriptor,
  message: AiMessage,
  parentChatId: string
): AiSubagentChatMetadata => ({
  id: `${message.runId ?? message.id}:${descriptor.id}`,
  operationId: message.taskPlan?.operationId ?? message.subagentSchedule?.operationId ?? message.id,
  parentChatId,
  parentRunId: message.runId,
  agentId: descriptor.id,
  label: descriptor.label,
  role: descriptor.role,
  status: taskStepStatusToSubagentStatus(descriptor.status, message, descriptor.id),
  summary: descriptor.summary,
  detailText: descriptor.summary,
  permissionClass: descriptor.permissionClass
});

const modelAgentResultToSubagent = (
  agent: FluxoraAiModelAgentResult,
  message: AiMessage,
  parentChatId: string,
  operationId: string
): AiSubagentChatMetadata => ({
  id: `${operationId}:${agent.agentId}`,
  operationId,
  parentChatId,
  parentRunId: message.runId,
  agentId: agent.agentId,
  label: agent.label,
  role: 'model-subagent',
  status: orchestrationStatusToSubagentStatus(agent.status),
  summary: agent.error?.message ? sanitizeAiChatText(agent.error.message) : compactSubagentSummary(agent.text),
  detailText: agent.error?.message ? sanitizeAiChatText(agent.error.message) : agent.text,
  providerId: agent.providerId,
  modelId: agent.modelId
});

const uniqueSubagents = (subagents: AiSubagentChatMetadata[]): AiSubagentChatMetadata[] => {
  const seen = new Set<string>();
  return subagents.filter((subagent) => {
    if (seen.has(subagent.id)) {
      return false;
    }
    seen.add(subagent.id);
    return true;
  });
};

export const aiSubagentLinksForMessage = (
  message: AiMessage,
  parentChatId: string
): AiSubagentChatMetadata[] => {
  if (message.role !== 'assistant') {
    return [];
  }

  if (message.orchestration) {
    const operationId = message.orchestration.operationId;
    return uniqueSubagents([
      {
        id: `${operationId}:${message.orchestration.chef.agentId}`,
        operationId,
        parentChatId,
        parentRunId: message.runId,
        agentId: message.orchestration.chef.agentId,
        label: message.orchestration.chef.label,
        role: 'chef',
        status: orchestrationStatusToSubagentStatus(message.orchestration.chef.status),
        summary: message.orchestration.strategy,
        detailText: message.orchestration.chef.dispatchPlan,
        permissionClass: 'plan',
        providerId: message.orchestration.chef.providerId,
        modelId: message.orchestration.chef.modelId
      },
      ...message.orchestration.subagents.map((agent) =>
        modelAgentResultToSubagent(agent, message, parentChatId, operationId)
      )
    ]);
  }

  if (!message.subagentSchedule?.scheduledSubagents?.length) {
    return [];
  }

  return uniqueSubagents([
    ...message.subagentSchedule.scheduledSubagents.map((descriptor) =>
      scheduleDescriptorToSubagent(descriptor, message, parentChatId)
    ),
    scheduleDescriptorToSubagent(message.subagentSchedule.planReviewAgent, message, parentChatId)
  ]);
};

type AiMessageTextBlock =
  | { key: number; kind: 'heading'; level: 3 | 4; text: string }
  | { key: number; kind: 'list'; items: string[]; ordered: boolean }
  | { key: number; kind: 'paragraph'; text: string }
  | { key: number; kind: 'rule' };

const orderedListLine = /^(\d+)\.\s+(.+)$/;
const unorderedListLine = /^[-*]\s+(.+)$/;
const headingLine = /^(#{1,6})\s+(.+)$/;
const ruleLine = /^-{3,}$/;

const normalizeAiMessageText = (value: string): string =>
  sanitizeAiChatText(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\\[ \t]*\n/g, '\n')
    .trim();

const renderInlineAiText = (text: string, keyPrefix: string): ReactNode[] => {
  const parts: ReactNode[] = [];
  const boldPattern = /\*\*([^*\n]+)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null = boldPattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index));
    }
    parts.push(<strong key={`${keyPrefix}-bold-${match.index}`}>{match[1]}</strong>);
    cursor = match.index + match[0].length;
    match = boldPattern.exec(text);
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.length > 0 ? parts : [text];
};

const parseAiMessageTextBlocks = (text: string): AiMessageTextBlock[] => {
  const lines = normalizeAiMessageText(text).split('\n');
  const blocks: AiMessageTextBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    blocks.push({
      key: blocks.length,
      kind: 'paragraph',
      text: paragraphLines.join('\n')
    });
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }
    blocks.push({
      key: blocks.length,
      kind: 'list',
      items: listItems,
      ordered: listOrdered
    });
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(headingLine);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        key: blocks.length,
        kind: 'heading',
        level: heading[1].length <= 3 ? 3 : 4,
        text: heading[2].trim()
      });
      continue;
    }

    if (ruleLine.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ key: blocks.length, kind: 'rule' });
      continue;
    }

    const ordered = line.match(orderedListLine);
    const unordered = line.match(unorderedListLine);
    if (ordered || unordered) {
      flushParagraph();
      const nextOrdered = Boolean(ordered);
      if (listItems.length > 0 && listOrdered !== nextOrdered) {
        flushList();
      }
      listOrdered = nextOrdered;
      listItems.push((ordered?.[2] ?? unordered?.[1] ?? line).trim());
      continue;
    }

    flushList();
    paragraphLines.push(rawLine.trimEnd());
  }

  flushParagraph();
  flushList();

  return blocks.length > 0
    ? blocks
    : [
        {
          key: 0,
          kind: 'paragraph',
          text: ''
        }
      ];
};

export const renderAiChatMessageContent = (text: string): ReactNode => {
  const blocks = parseAiMessageTextBlocks(text);

  return (
    <div className="ai-chat-message__content">
      {blocks.map((block) => {
        if (block.kind === 'heading') {
          const Heading = block.level === 3 ? 'h3' : 'h4';
          return (
            <Heading key={block.key}>
              {renderInlineAiText(block.text, `heading-${block.key}`)}
            </Heading>
          );
        }

        if (block.kind === 'rule') {
          return <hr key={block.key} />;
        }

        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List key={block.key}>
              {block.items.map((item, index) => (
                <li key={`${block.key}-${index}`}>
                  <span>{renderInlineAiText(item, `list-${block.key}-${index}`)}</span>
                </li>
              ))}
            </List>
          );
        }

        return (
          <p key={block.key}>
            {renderInlineAiText(block.text, `paragraph-${block.key}`)}
          </p>
        );
      })}
    </div>
  );
};

export function AiChatPanel({
  hostReady = true,
  providerDiagnostic = null,
  state,
  onCancel,
  onClose,
  onCloseChat,
  onCreateChat,
  onDraftChange,
  onOpenSubagentChat,
  onOpenSource,
  onResize,
  onSend,
  onSelectChat,
  onToggleCollapse
}: AiChatPanelProps) {
  const resizeStartRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const inputDisabled = !hostReady || providerDiagnostic?.level === 'error';
  const canSend = !inputDisabled && state.draft.trim().length > 0 && !state.isRunning;
  const activeStatusLabel = aiStatusLabels[state.status];
  const activeChat = state.chats.find((chat) => chat.id === state.activeChatId) ?? state.chats[0];

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSend) {
      onSend();
    }
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (state.isCollapsed) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: state.width
    };
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = resizeStartRef.current;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }

    onResize(start.startWidth + start.startX - event.clientX);
  };

  const handleResizePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = resizeStartRef.current;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }

    resizeStartRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onResize(state.width + 24);
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onResize(state.width - 24);
    }
  };

  return (
    <aside
      aria-label="Fluxora AI chat"
      className="ai-chat-panel"
      data-collapsed={state.isCollapsed ? 'true' : undefined}
      data-host-ready={hostReady ? 'true' : 'false'}
    >
      <button
        aria-label="Resize AI chat"
        aria-orientation="vertical"
        aria-valuemax={AI_CHAT_PANEL_MAX_WIDTH}
        aria-valuemin={AI_CHAT_PANEL_MIN_WIDTH}
        aria-valuenow={state.isCollapsed ? AI_CHAT_PANEL_COLLAPSED_WIDTH : state.width}
        className="ai-chat-panel__resize"
        disabled={state.isCollapsed}
        role="separator"
        type="button"
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
      />

      <header className="ai-chat-panel__header">
        <div className="ai-chat-panel__identity">
          <img className="ai-chat-panel__icon" src={geminiIcon} alt="" />
          <div>
            <strong>AI</strong>
            <span>{providerDiagnostic?.level === 'error' ? 'Blocked' : hostReady ? activeStatusLabel : 'Unavailable'}</span>
          </div>
        </div>
        <div className="ai-chat-panel__controls">
          <button
            aria-label={state.isCollapsed ? 'Expand AI chat' : 'Collapse AI chat'}
            className="ai-chat-panel__icon-button"
            title={state.isCollapsed ? 'Expand AI chat' : 'Collapse AI chat'}
            type="button"
            onClick={onToggleCollapse}
          >
            {state.isCollapsed ? <ChevronLeft size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          </button>
          <button
            aria-label="Close AI chat"
            className="ai-chat-panel__icon-button"
            title="Close AI chat"
            type="button"
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="ai-chat-panel__body">
        <div className="ai-chat-tabs" role="tablist" aria-label="AI chats">
          <div className="ai-chat-tabs__list">
            {state.chats.map((chat) => {
              const isActive = chat.id === state.activeChatId;
              return (
                <div
                  className="ai-chat-tab-shell"
                  data-active={isActive ? 'true' : undefined}
                  data-disabled={state.isRunning && !isActive ? 'true' : undefined}
                  data-kind={chat.subagent ? 'subagent' : 'main'}
                  key={chat.id}
                >
                  <button
                    aria-controls="ai-chat-messages"
                    aria-selected={isActive}
                    className="ai-chat-tab"
                    data-active={isActive ? 'true' : undefined}
                    disabled={state.isRunning && !isActive}
                    id={`ai-chat-tab-${chat.id}`}
                    role="tab"
                    title={chat.title}
                    type="button"
                    onClick={() => {
                      if (!isActive) {
                        onSelectChat(chat.id);
                      }
                    }}
                  >
                    <span className="ai-chat-tab__title">{chat.title}</span>
                  </button>
                  <button
                    aria-label={`Close ${chat.title}`}
                    className="ai-chat-tab__close"
                    disabled={state.isRunning}
                    title={`Close ${chat.title}`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseChat(chat.id);
                    }}
                  >
                    <img
                      alt=""
                      aria-hidden="true"
                      className="ai-chat-tab__close-icon"
                      src={closeTabIcon}
                    />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            aria-label="New AI chat"
            className="ai-chat-tabs__new"
            disabled={state.isRunning}
            title="New AI chat"
            type="button"
            onClick={onCreateChat}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="ai-chat-status-stack">
          <div className="ai-chat-status-list" aria-label="AI statuses">
            {aiStatusOrder.map((status) => (
              <span
                className="ai-chat-status-list__item"
                data-active={state.status === status ? 'true' : undefined}
                key={status}
              >
                {aiStatusLabels[status]}
              </span>
            ))}
          </div>
          {providerDiagnostic ? (
            <div
              className="ai-chat-diagnostic"
              data-level={providerDiagnostic.level}
              role={providerDiagnostic.level === 'error' ? 'alert' : 'status'}
            >
              <strong>{providerDiagnostic.title}</strong>
              <span>{providerDiagnostic.message}</span>
              {providerDiagnostic.detail ? <small>{providerDiagnostic.detail}</small> : null}
            </div>
          ) : null}
        </div>

        <div
          aria-label="AI messages"
          aria-labelledby={activeChat ? `ai-chat-tab-${activeChat.id}` : undefined}
          aria-live="polite"
          className="ai-chat-messages"
          id="ai-chat-messages"
          role="tabpanel"
        >
          {state.messages.length === 0 && !state.isRunning ? (
            <div className="ai-chat-empty">
              <img src={geminiIcon} alt="" />
              <strong>No messages</strong>
            </div>
          ) : null}

          {state.messages.map((message) => {
            const messageSubagents = aiSubagentLinksForMessage(
              message,
              activeChat?.id ?? state.activeChatId
            );
            const completedSubagentCount = messageSubagents.filter(
              (subagent) => subagent.status === 'done'
            ).length;

            return (
              <article className="ai-chat-message" data-role={message.role} key={message.id}>
                <div className="ai-chat-message__meta">
                  <span>
                    {message.role === 'assistant'
                      ? ['AI', message.providerId, message.modelId].filter(Boolean).join(' · ')
                      : 'You'}
                  </span>
                  <time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>
                </div>
                {renderAiChatMessageContent(message.text)}
                {message.selectedSkill?.selectedSkill ? (
                  <div className="ai-chat-skill" aria-label="AI skill used">
                    <span>Skill</span>
                    <strong>{message.selectedSkill.selectedSkill.displayName}</strong>
                  </div>
                ) : null}
                {messageSubagents.length > 0 ? (
                  <section className="ai-chat-subagents" aria-label="AI subagents used">
                    <div className="ai-chat-subagents__header">
                      <strong>Subagents</strong>
                      <span>
                        {completedSubagentCount}/{messageSubagents.length}
                      </span>
                    </div>
                    <div className="ai-chat-subagents__list">
                      {messageSubagents.map((subagent) => (
                        <button
                          aria-label={`Open ${subagent.label} subagent chat`}
                          className="ai-chat-subagent"
                          data-status={subagent.status}
                          key={subagent.id}
                          title={`Open ${subagent.label}`}
                          type="button"
                          onClick={() => onOpenSubagentChat(subagent)}
                        >
                          <span className="ai-chat-subagent__dot" aria-hidden="true" />
                          <span className="ai-chat-subagent__body">
                            <strong>{subagent.label}</strong>
                            <small>
                              {[
                                subagent.providerId && subagent.modelId
                                  ? `${subagent.providerId}/${subagent.modelId}`
                                  : subagent.role,
                                subagent.permissionClass
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </small>
                          </span>
                          <span className="ai-chat-subagent__state">
                            {aiSubagentStatusLabels[subagent.status]}
                          </span>
                          <MessageSquare size={13} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
                {message.taskPlan && message.subagentSchedule ? (
                  <section className="ai-chat-plan" aria-label="AI task plan">
                    <div className="ai-chat-plan__header">
                      <strong>{message.taskPlan.goal}</strong>
                      <span>
                        {message.subagentSchedule.requestedSubagentCount}/
                        {message.subagentSchedule.maxSubagentsForLargeTasks}
                      </span>
                    </div>
                    <ol className="ai-chat-plan__steps">
                      {compactPlanSteps([
                        ...message.taskPlan.readSteps,
                        ...message.taskPlan.validationSteps
                      ]).map((step) => (
                        <li key={step.id}>
                          <span>{step.title}</span>
                          <small>{step.permissionClass}</small>
                        </li>
                      ))}
                    </ol>
                    <div className="ai-chat-plan__footer">
                      <span>
                        Queue {message.subagentSchedule.executorQueue.maxConcurrentMutations}
                      </span>
                      <span>{message.taskPlan.review.status}</span>
                    </div>
                  </section>
                ) : null}
                {message.providerDiagnostics?.length ? (
                  <div className="ai-chat-message__diagnostics" aria-label="AI provider diagnostics" role="note">
                    {message.providerDiagnostics.map((diagnostic) => (
                      <span key={diagnostic}>{sanitizeAiChatText(diagnostic)}</span>
                    ))}
                  </div>
                ) : null}
                {message.sources?.length ? (
                  <div className="ai-chat-message__sources" aria-label="AI sources">
                    {message.sources.map((source) => {
                      const sourceUrl = safeAiSourceUrl(source.url);
                      const sourceLabel = sanitizeAiChatText(source.title || source.url);
                      return (
                        <button
                          key={source.id}
                          className="ai-chat-source"
                          disabled={!sourceUrl}
                          title={sourceUrl ?? 'Blocked unsafe source URL'}
                          type="button"
                          onClick={() => {
                            if (sourceUrl) {
                              onOpenSource?.(sourceUrl);
                            }
                          }}
                        >
                          {sourceLabel}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {message.costEstimate ? (
                  <span className="ai-chat-message__cost">
                    {aiCostLabel(message.costEstimate)}
                  </span>
                ) : null}
              </article>
            );
          })}

          {state.isRunning ? (
            <div className="ai-chat-progress" role="status" aria-label={`AI ${activeStatusLabel}`}>
              <div className="ai-chat-progress__avatar" />
              <div className="ai-chat-progress__lines">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}
        </div>

        <form className="ai-chat-input" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="ai-chat-message">
            Message Fluxora AI
          </label>
          <textarea
            id="ai-chat-message"
            aria-label="Message Fluxora AI"
            disabled={inputDisabled}
            placeholder={providerDiagnostic?.level === 'error' ? providerDiagnostic.title : 'Message'}
            rows={3}
            value={state.draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <div className="ai-chat-input__actions">
            {state.isRunning ? (
              <button
                aria-label="Cancel AI run"
                className="ai-chat-panel__icon-button"
                title="Cancel AI run"
                type="button"
                onClick={onCancel}
              >
                <CircleStop size={15} aria-hidden="true" />
              </button>
            ) : null}
            <button
              aria-label="Voice input placeholder"
              className="ai-chat-panel__icon-button"
              disabled
              title="Voice input placeholder"
              type="button"
            >
              <Mic size={15} aria-hidden="true" />
            </button>
            <button
              aria-label="Send message"
              className="ai-chat-send-button"
              disabled={!canSend}
              type="submit"
            >
              <Send size={15} aria-hidden="true" />
              <span>Send</span>
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
