import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X
} from 'lucide-react';
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from 'react';
import { useRef } from 'react';

import aiArrowUpIcon from '../../../../../Icons/ai-arrow-up.svg';
import aiCircleStopIcon from '../../../../../Icons/ai-circle-stop.svg';
import aiMicIcon from '../../../../../Icons/ai-mic.svg';
import aiPlusIcon from '../../../../../Icons/ai-plus.svg';
import closeTabIcon from '../../../../../Icons/circle-x.svg';
import geminiIcon from '../../../../../Icons/gemini.svg';
import type { FluxoraAiCitation, FluxoraAiContextUsage } from '../../../shared/fluxora-api';
import {
  AI_CHAT_PANEL_COLLAPSED_WIDTH,
  AI_CHAT_PANEL_MAX_WIDTH,
  AI_CHAT_PANEL_MIN_WIDTH,
  approximateAiContextUsageForDraft,
  aiStatusLabels,
  type AiChatState,
  type AiContextEstimateState,
  type AiMessage
} from './ai-chat-state';
import { type AiProviderDiagnostic } from './ai-chat-settings';
import { AI_CONTEXT_SOURCE_URL_PREFIX, safeAiSourceUrl, sanitizeAiChatText } from './ai-chat-security';

export interface AiChatPanelProps {
  hostReady?: boolean;
  providerDiagnostic?: AiProviderDiagnostic | null;
  state: AiChatState;
  onCancel: () => void;
  onClose: () => void;
  onCloseChat: (chatId: string) => void;
  onCreateChat: () => void;
  onDraftChange: (value: string) => void;
  onOpenSource?: (url: string) => void;
  onResize: (width: number) => void;
  onSend: () => void;
  onSelectChat: (chatId: string) => void;
  onToggleCollapse: () => void;
}

type AiChatInputIconStyle = CSSProperties & { '--ai-chat-input-icon': string };

function AiChatInputIcon({ source }: { source: string }) {
  return (
    <span
      aria-hidden="true"
      className="ai-chat-input__icon"
      style={{ '--ai-chat-input-icon': `url("${source}")` } as AiChatInputIconStyle}
    />
  );
}

type AiContextRingStyle = CSSProperties & { '--ai-context-percent': string };

const contextNumberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const contextPercentFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0
});

function AiContextUsageRing({
  estimateState,
  usage
}: {
  estimateState: AiContextEstimateState;
  usage: FluxoraAiContextUsage | null;
}) {
  const percent = usage ? Math.min(100, Math.max(0, usage.currentContextPercent)) : 0;
  const tooltipLines = usage
    ? [
        'Current request',
        `${contextNumberFormat.format(usage.currentContextTokens)} / ${contextNumberFormat.format(
          usage.contextWindowTokens
        )} tokens`,
        `≈ ${contextPercentFormat.format(percent)}% used`,
        `${usage.mode} · ${usage.precision}`
      ]
    : [
        'Current request',
        estimateState === 'error' ? 'Context estimate unavailable' : 'Counting context...'
      ];
  const tooltipText = tooltipLines.join('\n');

  return (
    <span
      aria-label={`Контекст ИИ. ${tooltipLines.join('. ')}`}
      className="ai-context-ring"
      data-level={usage?.level ?? undefined}
      data-mode={usage?.mode ?? undefined}
      data-percent={usage ? percent.toFixed(1) : undefined}
      data-precision={usage?.precision ?? undefined}
      data-state={estimateState}
      role="img"
      style={{ '--ai-context-percent': `${percent}%` } as AiContextRingStyle}
      tabIndex={0}
      title={tooltipText}
    >
      <span className="ai-context-ring__track" aria-hidden="true" />
      <span className="ai-context-ring__dot" aria-hidden="true" />
      <span className="ai-context-ring__tooltip" role="tooltip">
        {tooltipLines.map((line, index) => (
          <span key={line} data-secondary={index >= 3 ? 'true' : undefined}>
            {line}
          </span>
        ))}
      </span>
    </span>
  );
}

const messageTime = (createdAt: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(createdAt));

const evidenceCardsForMessage = (message: AiMessage) =>
  message.researchReport?.nexusInvestigation?.evidenceCards ?? [];

const citationToAiSource = (
  citation: ReturnType<typeof evidenceCardsForMessage>[number]['citations'][number],
  index: number
): FluxoraAiCitation => ({
  id: citation.sourceId || `evidence-citation-${index}`,
  title: citation.title,
  url: citation.url ?? '',
  kind: 'evidence-citation',
  provider: 'fluxora-evidence-card',
  trust: 'untrusted-external-content'
});

const isInternalAiContextSource = (source: FluxoraAiCitation) =>
  source.trust === 'local-context' ||
  source.kind === 'structured-evidence-id' ||
  source.url.trim().startsWith(AI_CONTEXT_SOURCE_URL_PREFIX);

const aiSourcesForMessage = (message: AiMessage): FluxoraAiCitation[] => {
  const sources = [
    ...(message.sources ?? []),
    ...(message.researchReport?.sources ?? []),
    ...evidenceCardsForMessage(message).flatMap((card) => card.citations.map(citationToAiSource))
  ];
  const seen = new Set<string>();

  return sources.filter((source) => {
    if (isInternalAiContextSource(source)) {
      return false;
    }
    const key = [source.id, source.url, source.title].join('|').toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
  onOpenSource,
  onResize,
  onSend,
  onSelectChat,
  onToggleCollapse
}: AiChatPanelProps) {
  const resizeStartRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const inputDisabled = !hostReady || providerDiagnostic?.level === 'error';
  const inputPlaceholder =
    providerDiagnostic?.level === 'error'
      ? providerDiagnostic.title
      : hostReady
        ? 'Message'
        : 'AI unavailable';
  const canSend = !inputDisabled && state.draft.trim().length > 0 && !state.isRunning;
  const activeStatusLabel = aiStatusLabels[state.status];
  const activeChat = state.chats.find((chat) => chat.id === state.activeChatId) ?? state.chats[0];
  const visibleMessages = state.messages.filter((message) => !message.isStreaming);
  const contextEstimateState = activeChat?.contextEstimateState ?? 'idle';
  const activeContextUsage = approximateAiContextUsageForDraft(activeChat?.contextUsage ?? null, state.draft);
  const showContextRing = Boolean(
    activeChat &&
      (activeContextUsage || contextEstimateState === 'counting' || contextEstimateState === 'error') &&
      (activeChat.messages.length > 0 || state.activeRunId || contextEstimateState === 'counting')
  );

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
          <strong>AI</strong>
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

        <div
          aria-label="AI messages"
          aria-labelledby={activeChat ? `ai-chat-tab-${activeChat.id}` : undefined}
          aria-live="polite"
          className="ai-chat-messages"
          id="ai-chat-messages"
          role="tabpanel"
        >
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

          {visibleMessages.length === 0 && !state.isRunning ? (
            <div className="ai-chat-empty">
              <img src={geminiIcon} alt="" />
              <strong>No messages</strong>
            </div>
          ) : null}

          {visibleMessages.map((message) => {
            const messageSources = aiSourcesForMessage(message);

            return (
              <article className="ai-chat-message" data-role={message.role} key={message.id}>
                <div className="ai-chat-message__meta">
                  <span>
                    {message.role === 'assistant' ? 'AI' : 'You'}
                  </span>
                  <time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>
                </div>
                {renderAiChatMessageContent(message.text)}
                {message.providerDiagnostics?.length ? (
                  <div className="ai-chat-message__diagnostics" aria-label="AI provider diagnostics" role="note">
                    {message.providerDiagnostics.map((diagnostic) => (
                      <span key={diagnostic}>{sanitizeAiChatText(diagnostic)}</span>
                    ))}
                  </div>
                ) : null}
                {messageSources.length ? (
                  <div className="ai-chat-message__sources" aria-label="AI sources">
                    {messageSources.map((source) => {
                      const sourceUrl = safeAiSourceUrl(source.url);
                      const sourceLabel = sanitizeAiChatText(source.title || (sourceUrl ? source.url : source.id));
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
              </article>
            );
          })}

          {state.isRunning ? (
            <div className="ai-chat-progress" role="status" aria-label={`AI ${activeStatusLabel}. Думаю`}>
              <span className="ai-chat-progress__label">Думаю</span>
              <span className="ai-chat-progress__dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          ) : null}
        </div>

        <form className="ai-chat-input" onSubmit={handleSubmit}>
          <div
            className="ai-chat-input__surface"
            data-disabled={inputDisabled ? 'true' : undefined}
            data-running={state.isRunning ? 'true' : undefined}
          >
            <label className="sr-only" htmlFor="ai-chat-message">
              Message Fluxora AI
            </label>
            <textarea
              id="ai-chat-message"
              aria-label="Message Fluxora AI"
              disabled={inputDisabled}
              placeholder={inputPlaceholder}
              rows={3}
              value={state.draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            <div className="ai-chat-input__toolbar">
              <div className="ai-chat-input__leading-actions">
                <button
                  aria-label="Attach context unavailable"
                  className="ai-chat-input__tool-button"
                  disabled
                  title="Attach context unavailable"
                  type="button"
                >
                  <AiChatInputIcon source={aiPlusIcon} />
                </button>
              </div>
              <div className="ai-chat-input__trailing-actions">
                {state.isRunning ? (
                  <button
                    aria-label="Cancel AI run"
                    className="ai-chat-input__tool-button ai-chat-input__tool-button--danger"
                    title="Cancel AI run"
                    type="button"
                    onClick={onCancel}
                  >
                    <AiChatInputIcon source={aiCircleStopIcon} />
                  </button>
                ) : null}
                {showContextRing ? (
                  <AiContextUsageRing
                    estimateState={contextEstimateState}
                    usage={activeContextUsage}
                  />
                ) : null}
                <button
                  aria-label="Voice input unavailable"
                  className="ai-chat-input__tool-button"
                  disabled
                  title="Voice input unavailable"
                  type="button"
                >
                  <AiChatInputIcon source={aiMicIcon} />
                </button>
                <button
                  aria-label="Send message"
                  className="ai-chat-send-button"
                  disabled={!canSend}
                  title="Send message"
                  type="submit"
                >
                  <AiChatInputIcon source={aiArrowUpIcon} />
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </aside>
  );
}
