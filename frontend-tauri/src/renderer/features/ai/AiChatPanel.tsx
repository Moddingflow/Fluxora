import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
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
import type {
  FluxoraAiCitation,
  FluxoraAiContextUsage,
  FluxoraAiModelAgentResult,
  FluxoraAiResearchSnapshot
} from '../../../shared/fluxora-api';
import {
  AI_CHAT_PANEL_COLLAPSED_WIDTH,
  AI_CHAT_PANEL_MAX_WIDTH,
  AI_CHAT_PANEL_MIN_WIDTH,
  approximateAiContextUsageForDraft,
  aiStatusLabels,
  type AiSubagentChatMetadata,
  type AiSubagentChatStatus,
  type AiContextEstimateState,
  type AiChatState,
  type AiMessage
} from './ai-chat-state';
import { type AiProviderDiagnostic } from './ai-chat-settings';
import { AI_CONTEXT_SOURCE_URL_PREFIX, safeAiSourceUrl, sanitizeAiChatText } from './ai-chat-security';

export interface AiChatPanelProps {
  hostReady?: boolean;
  providerDiagnostic?: AiProviderDiagnostic | null;
  showCheckedSites?: boolean;
  showDeveloperDiagnostics?: boolean;
  state: AiChatState;
  onCancel: () => void;
  onClose: () => void;
  onCloseChat: (chatId: string) => void;
  onCreateChat: () => void;
  onDraftChange: (value: string) => void;
  onOpenSubagentChat?: (subagent: AiSubagentChatMetadata) => void;
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
const AI_VISIBLE_RUN_EVENT_LIMIT = 5;
export const AI_CHAT_RENDER_TEXT_LIMIT = 32_000;
const AI_CHAT_RENDER_BLOCK_LIMIT = 220;
const AI_CHECKED_SITE_LIMIT = 24;

const activeRunEvents = (
  activeRunId: string | null,
  events: AiChatState['intermediateEvents']
): AiChatState['intermediateEvents'] =>
  activeRunId
    ? events
        .filter((event) => event.runId === activeRunId && event.visibility === 'user')
        .sort((left, right) => left.seq - right.seq || left.createdAt.localeCompare(right.createdAt))
    : [];

export const aiVisibleRunEventsForRun = (
  state: Pick<AiChatState, 'activeRunId' | 'isRunning' | 'intermediateEvents'>,
  limit = AI_VISIBLE_RUN_EVENT_LIMIT
): AiChatState['intermediateEvents'] => {
  if (!state.isRunning) {
    return [];
  }

  return activeRunEvents(state.activeRunId, state.intermediateEvents).slice(-Math.max(1, limit));
};

const eventStageLabel = (stage: string): string =>
  stage
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Progress';

function AiContextUsageRing({
  estimateState,
  usage
}: {
  estimateState: AiContextEstimateState;
  usage: FluxoraAiContextUsage | null;
}) {
  const percent = usage
    ? Math.min(100, Math.max(0, usage.currentBudgetPercent ?? usage.currentContextPercent))
    : 0;
  const safeInputBudgetTokens = usage?.safeInputBudgetTokens ?? usage?.contextWindowTokens ?? 0;
  const modelInputLimit = usage?.modelInputTokenLimit ?? usage?.contextWindowTokens ?? 0;
  const modelOutputLimit = usage?.modelOutputTokenLimit ?? 0;
  const tooltipLines = usage
    ? [
        'Current request',
        `${contextNumberFormat.format(usage.currentContextTokens)} / ${contextNumberFormat.format(
          safeInputBudgetTokens
        )} budget tokens`,
        `≈ ${contextPercentFormat.format(percent)}% used`,
        `Model: ${contextNumberFormat.format(modelInputLimit)} input${
          modelOutputLimit > 0 ? ` / ${contextNumberFormat.format(modelOutputLimit)} output` : ''
        }`,
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

const snapshotToAiSource = (snapshot: FluxoraAiResearchSnapshot): FluxoraAiCitation => ({
  id: snapshot.id,
  title: snapshot.title,
  url: snapshot.url,
  capturedAt: snapshot.capturedAt,
  kind: snapshot.kind,
  provider: 'fluxora-research-snapshot',
  trust: snapshot.trust
});

const blockedResearchSnapshotIdsForMessage = (message: AiMessage): Set<string> =>
  new Set(
    (message.researchReport?.snapshots ?? [])
      .filter((snapshot) => snapshot.status !== 'captured')
      .map((snapshot) => snapshot.id)
  );

const capturedResearchSnapshotsForMessage = (message: AiMessage): FluxoraAiResearchSnapshot[] =>
  (message.researchReport?.snapshots ?? []).filter((snapshot) => snapshot.status === 'captured');

const researchReportSourcesForMessage = (
  message: AiMessage,
  blockedSnapshotIds = blockedResearchSnapshotIdsForMessage(message)
): FluxoraAiCitation[] => {
  if (blockedSnapshotIds.size === 0) {
    return message.researchReport?.sources ?? [];
  }

  return (message.researchReport?.sources ?? []).filter((source) => !blockedSnapshotIds.has(source.id));
};

const isInternalAiContextSource = (source: FluxoraAiCitation) =>
  source.trust === 'local-context' ||
  source.kind === 'structured-evidence-id' ||
  source.url.trim().startsWith(AI_CONTEXT_SOURCE_URL_PREFIX);

interface AiCheckedSite {
  domain: string;
  key: string;
  url: string;
}

const checkedSiteForSource = (source: FluxoraAiCitation): AiCheckedSite | null => {
  if (isInternalAiContextSource(source)) {
    return null;
  }

  const originalUrl = source.url;
  const trimmedUrl = originalUrl.trim();
  if (!trimmedUrl || trimmedUrl.length !== originalUrl.length) {
    return null;
  }

  const sourceUrl = safeAiSourceUrl(originalUrl);
  if (!sourceUrl || !sourceUrl.startsWith('https://')) {
    return null;
  }

  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== 'https:' || !parsed.hostname) {
      return null;
    }

    const domain = parsed.hostname.toLowerCase();
    return {
      domain,
      key: domain,
      url: originalUrl
    };
  } catch {
    return null;
  }
};

const checkedSitesForMessage = (message: AiMessage): AiCheckedSite[] => {
  const blockedSnapshotIds = blockedResearchSnapshotIdsForMessage(message);
  const seen = new Set<string>();
  const sites: AiCheckedSite[] = [];

  const addSource = (source: FluxoraAiCitation): boolean => {
    if (sites.length >= AI_CHECKED_SITE_LIMIT) {
      return false;
    }

    const site = checkedSiteForSource(source);
    if (!site || seen.has(site.key)) {
      return true;
    }

    seen.add(site.key);
    sites.push(site);
    return sites.length < AI_CHECKED_SITE_LIMIT;
  };

  for (const source of message.sources ?? []) {
    if (!addSource(source)) {
      return sites;
    }
  }

  for (const source of researchReportSourcesForMessage(message, blockedSnapshotIds)) {
    if (!addSource(source)) {
      return sites;
    }
  }

  for (const card of evidenceCardsForMessage(message)) {
    for (let index = 0; index < card.citations.length; index += 1) {
      const source = citationToAiSource(card.citations[index]!, index);
      if (blockedSnapshotIds.has(source.id)) {
        continue;
      }
      if (!addSource(source)) {
        return sites;
      }
    }
  }

  for (const snapshot of capturedResearchSnapshotsForMessage(message)) {
    if (!addSource(snapshotToAiSource(snapshot))) {
      return sites;
    }
  }

  return sites;
};

const aiSubagentStatusFromHostStatus = (status: string): AiSubagentChatStatus => {
  const normalized = status.trim().toLowerCase();
  if (normalized.includes('approval')) {
    return 'needs-approval';
  }
  if (normalized.includes('complete') || normalized === 'done' || normalized === 'succeeded') {
    return 'done';
  }
  if (
    normalized.includes('temporary') ||
    normalized.includes('retryable') ||
    normalized.includes('unavailable')
  ) {
    return 'temporary';
  }
  if (normalized.includes('blocked') || normalized.includes('failed') || normalized.includes('error')) {
    return 'blocked';
  }
  if (normalized.includes('running') || normalized.includes('thinking') || normalized.includes('dispatch')) {
    return 'thinking';
  }
  return 'queued';
};

const aiSubagentStatusLabel = (status: AiSubagentChatStatus): string => {
  switch (status) {
    case 'thinking':
      return 'Thinking';
    case 'needs-approval':
      return 'Needs approval';
    case 'done':
      return 'Done';
    case 'blocked':
      return 'Blocked';
    case 'temporary':
      return 'Temporary';
    case 'queued':
    default:
      return 'Queued';
  }
};

const aiSubagentMetadataForResult = (
  message: AiMessage,
  result: FluxoraAiModelAgentResult,
  index: number
): AiSubagentChatMetadata => {
  const status = aiSubagentStatusFromHostStatus(result.status);
  const label = result.label.trim() || result.agentId.trim() || `Subagent ${index + 1}`;
  const errorText = result.error?.message?.trim();
  const text = result.text.trim();

  return {
    id: `${message.orchestration?.operationId ?? message.runId ?? message.id}:${result.agentId}:${index}`,
    operationId: message.orchestration?.operationId ?? message.runId ?? message.id,
    parentChatId: message.id,
    parentRunId: message.runId,
    agentId: result.agentId,
    label,
    role: 'worker',
    status,
    summary: text || errorText || aiSubagentStatusLabel(status),
    detailText: text || errorText || undefined,
    providerId: result.providerId,
    modelId: result.modelId
  };
};

const aiSubagentRowsForMessage = (message: AiMessage): AiSubagentChatMetadata[] => {
  const hostSubagents = message.orchestration?.subagents ?? [];
  if (hostSubagents.length === 0) {
    return [];
  }

  return hostSubagents.map((subagent, index) => aiSubagentMetadataForResult(message, subagent, index));
};

const aiDeveloperDiagnosticsForMessage = (message: AiMessage): string[] => {
  const diagnostics: string[] = [];
  const orchestrationSubagents = message.orchestration?.subagents ?? [];
  const decision = message.orchestrationDecision;
  const completed =
    decision?.completedSubagentCount ??
    message.orchestration?.completedSubagentCount ??
    orchestrationSubagents.filter((subagent) => subagent.status === 'completed').length;
  const attempted =
    decision?.attemptedSubagentCount ?? message.orchestration?.attemptedSubagentCount ?? orchestrationSubagents.length;
  const blocked =
    decision?.blockedSubagentCount ??
    message.orchestration?.blockedSubagentCount ??
    orchestrationSubagents.filter((subagent) => subagent.status === 'blocked').length;
  const retryable =
    decision?.retryableSubagentCount ??
    message.orchestration?.retryableSubagentCount ??
    orchestrationSubagents.filter((subagent) => subagent.status === 'temporary' || subagent.retryable).length;

  if (attempted > 0 || orchestrationSubagents.length > 0) {
    if (
      completed > 0 &&
      decision?.terminalStage === 'chef-final' &&
      (decision.completed === false || decision.contextContinuationApplied)
    ) {
      diagnostics.push(
        `Subagents: ${completed} completed, final synthesis ${
          decision.completed === false ? 'blocked/continued' : 'continued'
        }`
      );
    } else {
      const blockedText = blocked > 0 ? `, ${blocked} blocked` : '';
      const retryableText = retryable > 0 ? `, ${retryable} temporary` : '';
      diagnostics.push(
        `Subagents: attempted, ${completed} completed${blockedText}${retryableText}, reason: ${
          decision?.reason ?? message.orchestration?.status ?? 'completed'
        }`
      );
    }
  } else if (decision && decision.attempted === false) {
    diagnostics.push(`Subagents: not used, reason: ${decision.reason}`);
  }

  const compressionApplied =
    message.contextUsage?.autoCompressionApplied ||
    message.orchestrationDecision?.contextCompressionApplied;
  if (compressionApplied) {
    const usage = message.contextUsage;
    const percent = usage ? `${contextPercentFormat.format(usage.currentContextPercent)}%` : 'estimated';
    const precision = usage?.precision ?? 'estimated';
    const level = usage?.compressionLevel ?? message.orchestrationDecision?.compressionLevel;
    diagnostics.push(
      `Context: compressed, ${percent} ${precision}${level ? `, level ${level}` : ''}`
    );
  }
  if (decision?.contextContinuationApplied || message.orchestration?.contextContinuationApplied) {
    diagnostics.push(
      `Context: continuation package applied${
        decision?.terminalStage ? `, stage ${decision.terminalStage}` : ''
      }`
    );
  }

  diagnostics.push(...(message.providerDiagnostics ?? []));
  return [...new Set(diagnostics)];
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

const aiTextLooksRussian = (value: string): boolean => /[А-Яа-яЁё]/.test(value);

const clipAiMessageTextForRender = (
  value: string
): { omittedCharacters: number; text: string; wasTruncated: boolean } => {
  if (value.length <= AI_CHAT_RENDER_TEXT_LIMIT) {
    return {
      omittedCharacters: 0,
      text: value,
      wasTruncated: false
    };
  }

  return {
    omittedCharacters: value.length - AI_CHAT_RENDER_TEXT_LIMIT,
    text: value.slice(0, AI_CHAT_RENDER_TEXT_LIMIT).trimEnd(),
    wasTruncated: true
  };
};

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

const parseAiMessageTextBlocks = (
  text: string
): { blocks: AiMessageTextBlock[]; omittedCharacters: number; wasTruncated: boolean } => {
  const clipped = clipAiMessageTextForRender(text);
  const lines = normalizeAiMessageText(clipped.text).split('\n');
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

  const parsedBlocks =
    blocks.length > 0
      ? blocks
      : [
          {
            key: 0,
            kind: 'paragraph' as const,
            text: ''
          }
        ];
  const limitedBlocks = parsedBlocks.slice(0, AI_CHAT_RENDER_BLOCK_LIMIT);

  return {
    blocks: limitedBlocks,
    omittedCharacters: clipped.omittedCharacters,
    wasTruncated:
      clipped.wasTruncated || parsedBlocks.length > AI_CHAT_RENDER_BLOCK_LIMIT
  };
};

export const renderAiChatMessageContent = (text: string): ReactNode => {
  const { blocks, omittedCharacters, wasTruncated } = parseAiMessageTextBlocks(text);
  const truncationText = aiTextLooksRussian(text)
    ? `Ответ очень большой, поэтому чат показывает начало и сохраняет интерфейс отзывчивым.${
        omittedCharacters > 0 ? ` Скрыто символов: ${contextNumberFormat.format(omittedCharacters)}.` : ''
      }`
    : `This answer is very large, so the chat is showing the beginning to keep the app responsive.${
        omittedCharacters > 0 ? ` Hidden characters: ${contextNumberFormat.format(omittedCharacters)}.` : ''
      }`;

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
      {wasTruncated ? (
        <p className="ai-chat-message__truncation" data-truncated="true">
          {truncationText}
        </p>
      ) : null}
    </div>
  );
};

export function AiChatPanel({
  hostReady = true,
  providerDiagnostic = null,
  showCheckedSites = false,
  showDeveloperDiagnostics = false,
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
  const visibleRunEvents = aiVisibleRunEventsForRun(state);
  const latestRunEvent = visibleRunEvents.at(-1) ?? null;
  const currentRunStatus = latestRunEvent
    ? sanitizeAiChatText(latestRunEvent.message)
    : 'Waiting for AI host progress.';

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
            const checkedSites =
              showCheckedSites && message.role === 'assistant' ? checkedSitesForMessage(message) : [];
            const subagents = message.role === 'assistant' ? aiSubagentRowsForMessage(message) : [];
            const developerDiagnostics =
              showDeveloperDiagnostics && message.role === 'assistant'
                ? aiDeveloperDiagnosticsForMessage(message)
                : [];

            return (
              <article className="ai-chat-message" data-role={message.role} key={message.id}>
                <div className="ai-chat-message__meta">
                  <span>
                    {message.role === 'assistant' ? 'AI' : 'You'}
                  </span>
                  <time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>
                </div>
                {renderAiChatMessageContent(message.text)}
                {developerDiagnostics.length ? (
                  <div className="ai-chat-message__diagnostics" aria-label="AI developer diagnostics" role="note">
                    {developerDiagnostics.map((diagnostic) => (
                      <span key={diagnostic}>{sanitizeAiChatText(diagnostic)}</span>
                    ))}
                  </div>
                ) : null}
                {checkedSites.length ? (
                  <div className="ai-chat-message__sources" aria-label="Проверено">
                    <span className="ai-chat-message__sources-label">Проверено:</span>
                    {checkedSites.map((site) => {
                      return (
                        <button
                          key={site.key}
                          aria-label={`Открыть ${site.domain}`}
                          className="ai-chat-source"
                          title={site.domain}
                          type="button"
                          onClick={() => {
                            onOpenSource?.(site.url);
                          }}
                        >
                          {site.domain}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {subagents.length ? (
                  <div className="ai-chat-subagents" aria-label="Subagents">
                    <span className="ai-chat-subagents__label">Subagents</span>
                    <div className="ai-chat-subagents__list">
                      {subagents.map((subagent) => {
                        const statusLabel = aiSubagentStatusLabel(subagent.status);
                        const detail = [subagent.providerId, subagent.modelId].filter(Boolean).join(' · ');
                        const safeLabel = sanitizeAiChatText(subagent.label);
                        return (
                          <div
                            className="ai-chat-subagent"
                            data-status={subagent.status}
                            key={subagent.id}
                          >
                            <span className="ai-chat-subagent__status" aria-hidden="true" />
                            <span className="ai-chat-subagent__main">
                              <strong>{safeLabel}</strong>
                              <small>{detail || sanitizeAiChatText(subagent.role)}</small>
                            </span>
                            <span className="ai-chat-subagent__state">{statusLabel}</span>
                            <button
                              aria-label={`Open ${safeLabel} chat`}
                              className="ai-chat-subagent__open"
                              disabled={!onOpenSubagentChat}
                              title={`Open ${safeLabel} chat`}
                              type="button"
                              onClick={() => onOpenSubagentChat?.(subagent)}
                            >
                              <MessageSquare size={13} aria-hidden="true" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}

          {state.isRunning ? (
            <div
              className="ai-chat-progress"
              role="status"
              aria-label={`AI ${activeStatusLabel}. ${currentRunStatus}`}
            >
              <div className="ai-chat-progress__headline">
                <span className="ai-chat-progress__label">Работаю</span>
                <span className="ai-chat-progress__current">{currentRunStatus}</span>
                {latestRunEvent?.percent !== undefined ? (
                  <span className="ai-chat-progress__percent">
                    {Math.max(0, Math.min(100, Math.round(latestRunEvent.percent)))}%
                  </span>
                ) : null}
                <span className="ai-chat-progress__dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
              {visibleRunEvents.length > 0 ? (
                <details className="ai-chat-progress__details">
                  <summary>Live steps</summary>
                  <ol className="ai-chat-progress__steps">
                    {visibleRunEvents.map((event) => (
                      <li
                        className="ai-chat-progress__step"
                        data-level={event.level}
                        key={event.eventId}
                      >
                        <span className="ai-chat-progress__step-stage">
                          {eventStageLabel(event.stage)}
                        </span>
                        <span className="ai-chat-progress__step-message">
                          {sanitizeAiChatText(event.message)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
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
                  aria-label={state.isRunning ? 'Stop AI run' : 'Send message'}
                  className="ai-chat-send-button"
                  data-running={state.isRunning ? 'true' : undefined}
                  disabled={state.isRunning ? false : !canSend}
                  title={state.isRunning ? 'Stop AI run' : 'Send message'}
                  type={state.isRunning ? 'button' : 'submit'}
                  onClick={state.isRunning ? onCancel : undefined}
                >
                  <AiChatInputIcon source={state.isRunning ? aiCircleStopIcon : aiArrowUpIcon} />
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </aside>
  );
}
