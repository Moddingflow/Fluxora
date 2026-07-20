import { useMemo } from 'react';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Plus,
  RotateCcw,
  Send,
  Square,
  X
} from 'lucide-react';

import type {
  FluxoraAiCitation,
  FluxoraAiExecution,
  FluxoraAiFileChange,
  FluxoraAiFileChangeSet
} from '../../../shared/fluxora-api';
import type { AiProviderDiagnostic } from './ai-chat-settings';
import type { AiChatState } from './ai-chat-state';

export interface AiChatPanelProps {
  hostReady: boolean;
  providerDiagnostic?: AiProviderDiagnostic | null;
  showCheckedSites?: boolean;
  showDeveloperDiagnostics?: boolean;
  state: AiChatState;
  onCancel: () => void;
  onClose: () => void;
  onCloseChat: (chatId: string) => void;
  onCreateChat: () => void;
  onDraftChange: (value: string) => void;
  onOpenSource: (url: string) => void;
  onOpenFileChange: (change: FluxoraAiFileChange, firstChangedLine: number, changeSet: FluxoraAiFileChangeSet) => void;
  onOpenFileChangeMod: (change: FluxoraAiFileChange) => void;
  onRollbackFileChange: (changeSet: FluxoraAiFileChangeSet, change: FluxoraAiFileChange) => void;
  onRollbackFileRun: (changeSet: FluxoraAiFileChangeSet) => void;
  onUndoCapability: (compensationToken: string) => void;
  onResize: (width: number) => void;
  onSend: () => void;
  onSelectChat: (chatId: string) => void;
  onToggleCollapse: () => void;
}

const tokenNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const messageTime = (createdAt: string) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(createdAt));

const ContextUsage = ({ state }: { state: AiChatState }) => {
  const chat = state.chats.find((candidate) => candidate.id === state.activeChatId);
  const usage = chat?.contextUsage;
  if (!usage) {
    return <span className="ai-context-usage" data-state={chat?.contextEstimateState}>Контекст: —</span>;
  }
  return (
    <span
      className="ai-context-usage"
      data-level={usage.level}
      title={`Output limit: ${tokenNumber.format(usage.modelOutputTokenLimit ?? 0)} tokens · ${usage.precision}`}
    >
      Использовано контекста: {tokenNumber.format(usage.currentContextTokens)} /{' '}
      {tokenNumber.format(usage.contextWindowTokens)} токенов
    </span>
  );
};

const SourceList = ({ sources, onOpen }: {
  sources: FluxoraAiCitation[];
  onOpen: (url: string) => void;
}) => sources.length ? (
  <div className="ai-chat-message__sources" aria-label="Sources">
    {sources.map((source) => (
      <button className="ai-chat-source" key={`${source.id}:${source.url}`} type="button" onClick={() => onOpen(source.url)}>
        <ExternalLink size={12} aria-hidden="true" />
        <span>{source.title}</span>
      </button>
    ))}
  </div>
) : null;

const FileChanges = ({
  changeSet,
  onOpen,
  onOpenMod,
  onRollbackFile,
  onRollbackRun
}: {
  changeSet: FluxoraAiFileChangeSet;
  onOpen: (change: FluxoraAiFileChange, firstChangedLine: number, changeSet: FluxoraAiFileChangeSet) => void;
  onOpenMod: (change: FluxoraAiFileChange) => void;
  onRollbackFile: (changeSet: FluxoraAiFileChangeSet, change: FluxoraAiFileChange) => void;
  onRollbackRun: (changeSet: FluxoraAiFileChangeSet) => void;
}) => (
  <div className="ai-file-change-set" aria-label="Applied file changes">
    <header>
      <strong>Managed override</strong>
      <button
        type="button"
        disabled={changeSet.rollbackState !== 'available'}
        onClick={() => onRollbackRun(changeSet)}
      >
        <RotateCcw size={12} aria-hidden="true" /> Undo run
      </button>
    </header>
    {changeSet.files.map((change) => (
      <div className="ai-file-change" key={change.fileRef}>
        <button type="button" onClick={() => onOpen(change, change.hunks[0]?.newStart ?? 1, changeSet)}>
          <FileText size={13} aria-hidden="true" />
          <span>{change.relativePath}</span>
        </button>
        {change.ownerMod ? (
          <button type="button" onClick={() => onOpenMod(change)}>{change.ownerMod}</button>
        ) : null}
        <small>+{change.addedLines} −{change.removedLines} · {change.verification}</small>
        <button
          type="button"
          disabled={change.rollbackState !== 'available'}
          onClick={() => onRollbackFile(changeSet, change)}
        >
          <RotateCcw size={12} aria-hidden="true" /> Undo
        </button>
      </div>
    ))}
  </div>
);

const CapabilityEffects = ({
  execution,
  onUndo
}: {
  execution: FluxoraAiExecution;
  onUndo: (compensationToken: string) => void;
}) => {
  const effects = execution.verifiedEffects.filter((effect) => effect.compensationToken);
  if (!effects.length) return null;
  return (
    <div className="ai-file-change-set" aria-label="Verified Fluxora changes">
      <header><strong>Verified Fluxora changes</strong></header>
      {effects.map((effect) => {
        const rollbackState = effect.rollbackState ?? 'available';
        return (
          <div className="ai-file-change" key={`${effect.operationId}:${effect.compensationToken}`}>
            <span>{effect.tool.replace(/^local\./, '')}</span>
            <small>{rollbackState === 'rolled-back' ? 'Rolled back and verified' : 'Native postcondition verified'}</small>
            <button
              type="button"
              disabled={rollbackState !== 'available' && rollbackState !== 'blocked'}
              onClick={() => effect.compensationToken && onUndo(effect.compensationToken)}
            >
              <RotateCcw size={12} aria-hidden="true" />
              {rollbackState === 'rolling-back' ? 'Undoing…' : rollbackState === 'rolled-back' ? 'Undone' : 'Undo'}
            </button>
          </div>
        );
      })}
    </div>
  );
};

export function AiChatPanel({
  hostReady,
  providerDiagnostic,
  showDeveloperDiagnostics = false,
  state,
  onCancel,
  onClose,
  onCloseChat,
  onCreateChat,
  onDraftChange,
  onOpenSource,
  onOpenFileChange,
  onOpenFileChangeMod,
  onRollbackFileChange,
  onRollbackFileRun,
  onUndoCapability,
  onResize,
  onSend,
  onSelectChat,
  onToggleCollapse
}: AiChatPanelProps) {
  const activeEvents = useMemo(
    () => state.intermediateEvents.filter((event) =>
      !state.activeRunId || event.runId === state.activeRunId || event.operationId === state.runs.find((run) => run.id === state.activeRunId)?.operationId
    ).slice(-6),
    [state.activeRunId, state.intermediateEvents, state.runs]
  );

  if (state.isCollapsed) {
    return (
      <aside className="ai-chat-panel ai-chat-panel--collapsed" aria-label="Fluxora AI">
        <button type="button" aria-label="Expand AI chat" onClick={onToggleCollapse}>
          <Bot size={18} aria-hidden="true" />
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
      </aside>
    );
  }

  const canSend = Boolean(state.draft.trim()) && hostReady && !providerDiagnostic && !state.isRunning;
  return (
    <aside className="ai-chat-panel" aria-label="Fluxora AI">
      <button
        type="button"
        className="ai-chat-panel__resize"
        role="separator"
        aria-label="Resize AI chat"
        aria-orientation="vertical"
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            onResize(Math.max(320, Math.min(720, window.innerWidth - event.clientX)));
          }
        }}
      />
      <header className="ai-chat-panel__header">
        <span className="ai-chat-panel__identity"><Bot className="ai-chat-panel__icon" size={17} aria-hidden="true" /><strong>Fluxora AI</strong></span>
        <div className="ai-chat-panel__controls">
          <button className="ai-chat-panel__icon-button" type="button" aria-label="Collapse AI chat" onClick={onToggleCollapse}><ChevronRight size={15} /></button>
          <button className="ai-chat-panel__icon-button" type="button" aria-label="Close AI chat" onClick={onClose}><X size={15} /></button>
        </div>
      </header>

      <div className="ai-chat-panel__body">
        <div className="ai-chat-tabs" role="tablist" aria-label="Build AI chats">
          <div className="ai-chat-tabs__list">
            {state.chats.map((chat) => (
              <span className="ai-chat-tab-shell" key={chat.id} data-active={chat.id === state.activeChatId ? 'true' : undefined}>
                <button
                  className="ai-chat-tab"
                  type="button"
                  role="tab"
                  aria-selected={chat.id === state.activeChatId}
                  title={chat.title}
                  onClick={() => onSelectChat(chat.id)}
                >
                  <span className="ai-chat-tab__title">{chat.title}</span>
                </button>
                <button className="ai-chat-tab__close" type="button" aria-label={`Close ${chat.title}`} onClick={() => onCloseChat(chat.id)}><X size={11} /></button>
              </span>
            ))}
          </div>
          <button className="ai-chat-tabs__new" type="button" aria-label="New AI chat" title="New chat" onClick={onCreateChat}><Plus size={14} /></button>
        </div>

        <ContextUsage state={state} />

        {providerDiagnostic ? (
          <div className="ai-chat-diagnostic" data-level={providerDiagnostic.level} role="alert">
            <strong>{providerDiagnostic.title}</strong>
            <span>{providerDiagnostic.message}</span>
            {providerDiagnostic.detail ? <small>{providerDiagnostic.detail}</small> : null}
          </div>
        ) : null}

        <div className="ai-chat-messages" aria-live="polite">
          {state.messages.length === 0 ? (
            <div className="ai-chat-empty">
              <Bot size={20} aria-hidden="true" />
              <strong>Ask about this build</strong>
              <span>Gemini can search the selected build and apply one verified managed config override.</span>
            </div>
          ) : state.messages.map((message) => (
            <article className="ai-chat-message" data-role={message.role} data-status={message.agentStatus} key={message.id}>
              <header className="ai-chat-message__meta"><strong>{message.role === 'user' ? 'You' : 'Gemini'}</strong><time>{messageTime(message.createdAt)}</time></header>
              <div className="ai-chat-message__content"><p>{message.text}</p></div>
              <SourceList sources={message.sources ?? []} onOpen={onOpenSource} />
              {message.fileChangeSet ? (
                <FileChanges
                  changeSet={message.fileChangeSet}
                  onOpen={onOpenFileChange}
                  onOpenMod={onOpenFileChangeMod}
                  onRollbackFile={onRollbackFileChange}
                  onRollbackRun={onRollbackFileRun}
                />
              ) : null}
              {message.execution ? (
                <CapabilityEffects execution={message.execution} onUndo={onUndoCapability} />
              ) : null}
              {showDeveloperDiagnostics && message.error ? (
                <small className="ai-message-error">
                  {message.error.code} · {message.error.stage} · {message.error.debugId}
                </small>
              ) : null}
            </article>
          ))}
          {state.isRunning && activeEvents.length ? (
            <div className="ai-run-events" role="status">
              {activeEvents.map((event) => <span key={event.eventId}>{event.message}</span>)}
            </div>
          ) : null}
          {showDeveloperDiagnostics && activeEvents.length ? (
            <details className="ai-run-event-details"><summary>Tool events</summary>{activeEvents.map((event) => (
              <code key={`detail-${event.eventId}`}>{event.stage}: {event.message}</code>
            ))}</details>
          ) : null}
        </div>

        <footer className="ai-chat-input">
          <div className="ai-chat-input__surface" data-disabled={state.isRunning ? 'true' : undefined}>
            <textarea
              aria-label="Message Fluxora AI"
              placeholder="Ask Gemini about this build…"
              value={state.draft}
              disabled={state.isRunning}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && canSend) {
                  event.preventDefault();
                  onSend();
                }
              }}
            />
            <div className="ai-chat-input__toolbar">
              <span />
              {state.isRunning ? (
                <button className="ai-chat-input__tool-button ai-chat-input__tool-button--danger" type="button" aria-label="Stop AI run" onClick={onCancel}><Square size={14} /></button>
              ) : (
                <button className="ai-chat-send-button" type="button" aria-label="Send message" disabled={!canSend} onClick={onSend}><Send size={15} /></button>
              )}
            </div>
          </div>
        </footer>
      </div>
    </aside>
  );
}
