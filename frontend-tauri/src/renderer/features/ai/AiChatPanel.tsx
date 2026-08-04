import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderOpen,
  Plus,
  RotateCcw,
  Send,
  Square,
  X
} from '../../design-system/icons/lucide-compat';

import type {
  FluxoraAiCitation,
  FluxoraAiExecution,
  FluxoraAiFileChange,
  FluxoraAiFileChangeSet,
  FluxoraAiQuotaSnapshot
} from '../../../shared/fluxora-api';
import aiMicIcon from '../../../../../icons/ai-mic.svg';
import type { AiProviderDiagnostic } from './ai-chat-settings';
import type { AiChatState } from './ai-chat-state';
import { formatVoiceDuration } from './ai-voice-state';
import { buildVoiceContextHints } from './ai-voice-context';
import { useAiVoiceInput } from './use-ai-voice-input';
import { AiMicrophonePermissionDialog } from './AiMicrophonePermissionDialog';
import { AiFileDiffPreviewDialog } from './AiFileDiffPreviewDialog';
import { AiAccountGate } from './AiAccountGate';
import { AiQuotaIndicator } from './AiQuotaIndicator';
import { AiVoiceProcessingIndicator } from './AiVoiceProcessingIndicator';
import { useLocalization } from '../../../localization/react';

export interface AiChatPanelProps {
  hostReady: boolean;
  language?: string;
  providerDiagnostic?: AiProviderDiagnostic | null;
  quota?: FluxoraAiQuotaSnapshot | null;
  showCheckedSites?: boolean;
  showDeveloperDiagnostics?: boolean;
  state: AiChatState;
  voiceContextTerms?: readonly string[];
  onCancel: () => void;
  onClose: () => void;
  onCloseChat: (chatId: string) => void;
  onConnectAccount: () => void | Promise<void>;
  onCreateAccount: () => void | Promise<void>;
  onCreateChat: () => void;
  onDraftChange: (value: string) => void;
  onOpenSource: (url: string) => void;
  onOpenFileChange: (change: FluxoraAiFileChange, firstChangedLine: number, changeSet: FluxoraAiFileChangeSet) => void;
  onRevealFileChange?: (change: FluxoraAiFileChange, changeSet: FluxoraAiFileChangeSet) => void;
  onRollbackFileRun: (changeSet: FluxoraAiFileChangeSet) => void | Promise<void>;
  onUndoCapability: (compensationToken: string) => void;
  onSend: () => void;
  onSelectChat: (chatId: string) => void;
  onToggleCollapse: () => void;
  onVoiceSend?: (prompt: string, operationId: string) => boolean | Promise<boolean>;
}

const rejectVoiceSend = () => false;

const ContextUsage = ({ state }: { state: AiChatState }) => {
  const { t, locale } = useLocalization();
  const tokenNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const chat = state.chats.find((candidate) => candidate.id === state.activeChatId);
  const usage = chat?.contextUsage;
  if (!usage) {
    return <span className="ai-context-usage" data-state={chat?.contextEstimateState}>{t('ai.context.none')}</span>;
  }
  return (
    <span
      className="ai-context-usage"
      data-level={usage.level}
      title={t('ai.context.tooltip', {
        limit: tokenNumber.format(usage.modelOutputTokenLimit ?? 0),
        precision: usage.precision
      })}
    >
      {t('ai.context.usage', {
        current: tokenNumber.format(usage.currentContextTokens),
        total: tokenNumber.format(usage.contextWindowTokens)
      })}
    </span>
  );
};

const SourceList = ({ sources, onOpen }: {
  sources: FluxoraAiCitation[];
  onOpen: (url: string) => void;
}) => {
  const { t } = useLocalization();
  return sources.length ? (
  <div className="ai-chat-message__sources" aria-label={t('ai.sources')}>
    {sources.map((source) => (
      <button className="ai-chat-source" key={`${source.id}:${source.url}`} type="button" onClick={() => onOpen(source.url)}>
        <ExternalLink size={12} aria-hidden="true" />
        <span>{source.title}</span>
      </button>
    ))}
  </div>
) : null;
};

const FileChanges = ({
  changeSet,
  onContextMenu,
  onOpen,
  onRollbackRun
}: {
  changeSet: FluxoraAiFileChangeSet;
  onContextMenu: (
    change: FluxoraAiFileChange,
    changeSet: FluxoraAiFileChangeSet,
    position: { left: number; top: number }
  ) => void;
  onOpen: (change: FluxoraAiFileChange, firstChangedLine: number, changeSet: FluxoraAiFileChangeSet) => void;
  onRollbackRun: (changeSet: FluxoraAiFileChangeSet) => void | Promise<void>;
}) => {
  const { t } = useLocalization();
  const [undoing, setUndoing] = useState(false);
  const rollbackLabel = undoing
    ? t('ai.rollback.undoing')
    : changeSet.rollbackState === 'rolled-back'
      ? t('ai.rollback.undone')
      : changeSet.rollbackState === 'conflict'
        ? t('ai.rollback.review')
        : changeSet.rollbackState === 'unavailable'
          ? t('ai.rollback.unavailable')
          : t('ai.rollback.undo');

  const undo = async () => {
    if (undoing || changeSet.rollbackState !== 'available') return;
    setUndoing(true);
    try {
      await onRollbackRun(changeSet);
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div
      className="ai-file-change-set"
      aria-label={t('ai.fileChanges.applied')}
      data-run-id={changeSet.runId}
      data-rollback-state={undoing ? 'undoing' : changeSet.rollbackState}
      data-rollback-reason={changeSet.rollbackReason}
    >
      <header>
        <strong>{t('ai.fileChanges.override')}</strong>
        <button
          type="button"
          disabled={undoing || changeSet.rollbackState !== 'available'}
          onClick={() => void undo()}
        >
          <RotateCcw size={12} aria-hidden="true" /> {rollbackLabel}
        </button>
      </header>
      <div className="ai-file-change-set__files">
        {changeSet.files.map((change) => (
          <button
            className="ai-file-change"
            type="button"
            key={change.fileRef}
            onClick={() => onOpen(change, change.hunks[0]?.newStart ?? 1, changeSet)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onContextMenu(change, changeSet, { left: event.clientX, top: event.clientY });
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              onContextMenu(change, changeSet, { left: bounds.left + 12, top: bounds.bottom + 4 });
            }}
          >
            <FileText size={13} aria-hidden="true" />
            <span className="ai-file-change__path">{change.relativePath}</span>
            <span className="ai-file-change__stats" aria-label={t('ai.fileChanges.stats', {
              added: change.addedLines,
              removed: change.removedLines
            })}>
              <span className="ai-file-change__added">+{change.addedLines}</span>
              <span className="ai-file-change__removed">−{change.removedLines}</span>
            </span>
          </button>
        ))}
      </div>
      {changeSet.rollbackState === 'rolled-back' && changeSet.preservedNewerChanges ? (
        <small className="ai-file-change-set__confirmation" role="status">
          {t('ai.fileChanges.preserved')}
        </small>
      ) : null}
    </div>
  );
};

const CapabilityEffects = ({
  execution,
  onUndo
}: {
  execution: FluxoraAiExecution;
  onUndo: (compensationToken: string) => void;
}) => {
  const { t } = useLocalization();
  const effects = execution.verifiedEffects.filter((effect) => effect.compensationToken);
  if (!effects.length) return null;
  return (
    <div className="ai-file-change-set" aria-label={t('ai.effects.verified')}>
      <header><strong>{t('ai.effects.verified')}</strong></header>
      {effects.map((effect) => {
        const rollbackState = effect.rollbackState ?? 'available';
        return (
          <div className="ai-file-change" key={`${effect.operationId}:${effect.compensationToken}`}>
            <span>{effect.tool.replace(/^local\./, '')}</span>
            <small>{rollbackState === 'rolled-back'
              ? t('ai.effects.rolledBack')
              : t('ai.effects.postcondition')}</small>
            <button
              type="button"
              disabled={rollbackState !== 'available' && rollbackState !== 'blocked'}
              onClick={() => effect.compensationToken && onUndo(effect.compensationToken)}
            >
              <RotateCcw size={12} aria-hidden="true" />
              {rollbackState === 'rolling-back'
                ? t('ai.rollback.undoing')
                : rollbackState === 'rolled-back'
                  ? t('ai.rollback.undone')
                  : t('ai.rollback.undo')}
            </button>
          </div>
        );
      })}
    </div>
  );
};

export function AiChatPanel({
  hostReady,
  language = 'en-us',
  providerDiagnostic,
  quota,
  showDeveloperDiagnostics = false,
  state,
  voiceContextTerms = [],
  onCancel,
  onClose,
  onCloseChat,
  onConnectAccount,
  onCreateAccount,
  onCreateChat,
  onDraftChange,
  onOpenSource,
  onOpenFileChange,
  onRevealFileChange = () => undefined,
  onRollbackFileRun,
  onUndoCapability,
  onSend,
  onSelectChat,
  onToggleCollapse,
  onVoiceSend = rejectVoiceSend
}: AiChatPanelProps) {
  const { t } = useLocalization();
  const [previewedFile, setPreviewedFile] = useState<{
    change: FluxoraAiFileChange;
    changeSet: FluxoraAiFileChangeSet;
  } | null>(null);
  const [fileContextMenu, setFileContextMenu] = useState<{
    change: FluxoraAiFileChange;
    changeSet: FluxoraAiFileChangeSet;
    left: number;
    top: number;
  } | null>(null);
  useEffect(() => {
    if (!fileContextMenu) return;
    const closeMenu = () => setFileContextMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.ai-file-change-menu')) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [fileContextMenu]);
  const activeEvents = useMemo(
    () => state.intermediateEvents.filter((event) =>
      !state.activeRunId || event.runId === state.activeRunId || event.operationId === state.runs.find((run) => run.id === state.activeRunId)?.operationId
    ).slice(-6),
    [state.activeRunId, state.intermediateEvents, state.runs]
  );
  const voiceContextHints = useMemo(() => buildVoiceContextHints({
    buildTerms: voiceContextTerms,
    draft: state.draft,
    recentMessages: state.messages.map((message) => message.text)
  }), [state.draft, state.messages, voiceContextTerms]);
  const voice = useAiVoiceInput({
    contextHints: voiceContextHints,
    draft: state.draft,
    language,
    ownerChatId: state.activeChatId,
    onDraftChange,
    onSend: onVoiceSend
  });

  if (state.isCollapsed) {
    return (
      <aside className="ai-chat-panel ai-chat-panel--collapsed" aria-label={t('ai.name')}>
        <button type="button" aria-label={t('ai.expand')} onClick={() => { void voice.cancel(); onToggleCollapse(); }}>
          <Bot size={18} aria-hidden="true" />
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
      </aside>
    );
  }

  const canSend = Boolean(state.draft.trim()) && hostReady && !providerDiagnostic && !state.isRunning;
  const voiceCaptureActive = ['preparing', 'recording', 'transcribing'].includes(voice.state.phase);
  const accountRequired = quota?.availability === 'connectionRequired';
  return (
    <aside className="ai-chat-panel" aria-label={t('ai.name')}>
      {previewedFile ? (
        <AiFileDiffPreviewDialog
          change={previewedFile.change}
          onClose={() => setPreviewedFile(null)}
          onOpenEditor={() => {
            onOpenFileChange(
              previewedFile.change,
              previewedFile.change.hunks[0]?.newStart ?? 1,
              previewedFile.changeSet
            );
            setPreviewedFile(null);
          }}
          onShowInFolder={() => onRevealFileChange(previewedFile.change, previewedFile.changeSet)}
        />
      ) : null}
      {fileContextMenu ? createPortal(
        <div
          className="mod-row-menu mod-row-menu--context ai-file-change-menu"
          role="menu"
          aria-label={t('ai.file.namedActions', { name: fileContextMenu.change.relativePath })}
          style={{
            left: Math.min(fileContextMenu.left, Math.max(8, window.innerWidth - 244)),
            top: Math.min(fileContextMenu.top, Math.max(8, window.innerHeight - 50))
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onRevealFileChange(fileContextMenu.change, fileContextMenu.changeSet);
              setFileContextMenu(null);
            }}
          >
            <FolderOpen size={14} aria-hidden="true" />
            <span>{t('ai.file.showInFolder')}</span>
          </button>
        </div>,
        document.body
      ) : null}
      {voice.state.phase === 'requesting-permission' ? (
        <AiMicrophonePermissionDialog
          language={language}
          onAllow={() => void voice.allowPermission()}
          onDeny={() => void voice.denyPermission()}
        />
      ) : null}
      <header className="ai-chat-panel__header">
        <span className="ai-chat-panel__identity"><Bot className="ai-chat-panel__icon" size={17} aria-hidden="true" /><strong>{t('ai.name')}</strong></span>
        <div className="ai-chat-panel__controls">
          <button className="ai-chat-panel__icon-button" type="button" aria-label={t('ai.collapse')} onClick={() => { void voice.cancel(); onToggleCollapse(); }}><ChevronRight size={15} /></button>
          <button className="ai-chat-panel__icon-button" type="button" aria-label={t('ai.close')} onClick={() => { void voice.cancel(); onClose(); }}><X size={15} /></button>
        </div>
      </header>

      <div className={`ai-chat-panel__body${accountRequired ? ' ai-chat-panel__body--account-gate' : ''}`}>
        {accountRequired ? (
          <AiAccountGate
            language={language}
            onConnect={onConnectAccount}
            onCreateAccount={onCreateAccount}
          />
        ) : (
          <>
        <div className="ai-chat-tabs" role="tablist" aria-label={t('ai.chats')}>
          <div className="ai-chat-tabs__list">
            {state.chats.map((chat) => {
              const chatTitle = chat.title || t('ai.chat.newShort');
              return (
              <span className="ai-chat-tab-shell" key={chat.id} data-active={chat.id === state.activeChatId ? 'true' : undefined}>
                <button
                  className="ai-chat-tab"
                  type="button"
                  role="tab"
                  aria-selected={chat.id === state.activeChatId}
                  title={chatTitle}
                  onClick={() => onSelectChat(chat.id)}
                >
                  <span className="ai-chat-tab__title">{chatTitle}</span>
                </button>
                <button className="ai-chat-tab__close" type="button" aria-label={t('ai.chat.closeNamed', { name: chatTitle })} onClick={() => onCloseChat(chat.id)}><X size={11} /></button>
              </span>
              );
            })}
          </div>
          <button className="ai-chat-tabs__new" type="button" aria-label={t('ai.chat.new')} title={t('ai.chat.newShort')} onClick={onCreateChat}><Plus size={14} /></button>
        </div>

        <ContextUsage state={state} />
        <AiQuotaIndicator language={language} quota={quota} />

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
              <strong>{t('ai.empty.title')}</strong>
              <span>{t('ai.empty.detail')}</span>
            </div>
          ) : state.messages.map((message) => (
            <article className="ai-chat-message" data-role={message.role} data-status={message.agentStatus} key={message.id}>
              <div className="ai-chat-message__content"><p>{message.text}</p></div>
              {message.agentStatus === 'needs-input' ? (
                <small className="ai-chat-message__waiting" role="status">{t('ai.waitingAnswer')}</small>
              ) : null}
              <SourceList sources={message.sources ?? []} onOpen={onOpenSource} />
              {message.fileChangeSet ? (
                <FileChanges
                  changeSet={message.fileChangeSet}
                  onContextMenu={(change, changeSet, position) => {
                    setFileContextMenu({ change, changeSet, ...position });
                  }}
                  onOpen={(change, _firstChangedLine, changeSet) => {
                    setPreviewedFile({ change, changeSet });
                  }}
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
            <details className="ai-run-event-details"><summary>{t('ai.toolEvents')}</summary>{activeEvents.map((event) => (
              <code key={`detail-${event.eventId}`}>{event.stage}: {event.message}</code>
            ))}</details>
          ) : null}
        </div>

        <footer className="ai-chat-input">
          <div
            className="ai-chat-input__surface"
            data-disabled={state.isRunning ? 'true' : undefined}
            data-voice-active={voiceCaptureActive ? 'true' : undefined}
          >
            {voiceCaptureActive ? (
              voice.state.phase === 'transcribing' ? (
                <AiVoiceProcessingIndicator
                  language={language}
                  onCancel={() => { void voice.cancel(); }}
                />
              ) : (
              <div className="ai-voice-recorder" role="status" aria-live="polite">
                <div className="ai-voice-recorder__status">
                  <strong>{formatVoiceDuration(voice.state.elapsedMs)}</strong>
                  <span>{voice.state.phase === 'recording'
                    ? t('ai.voice.listening')
                    : t('ai.voice.starting')}</span>
                </div>
                <div className="ai-voice-waveform" aria-label={t('ai.voice.level')}>
                  {voice.state.levels.map((level, index) => (
                    <span
                      key={index}
                      style={{ '--ai-voice-level': Math.max(0.08, level) } as React.CSSProperties}
                    />
                  ))}
                </div>
                <div className="ai-voice-recorder__actions">
                  <button
                    className="ai-voice-action ai-voice-action--stop"
                    type="button"
                    aria-label={t('ai.voice.stopDraft')}
                    onClick={() => void voice.stop('draft')}
                  >
                    <Square size={13} aria-hidden="true" />
                  </button>
                  <button
                    className="ai-voice-action ai-voice-action--send"
                    type="button"
                    aria-label={t('ai.voice.stopSend')}
                    disabled={voice.state.phase !== 'recording'}
                    onClick={() => void voice.stop('send')}
                  >
                    <Send size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
              )
            ) : (
              <>
                <textarea
                  aria-label={t('ai.message.label')}
                  placeholder={t('ai.message.placeholder')}
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
                {voice.state.error ? (
                  <div className="ai-voice-error" role="alert">
                    <span>{voice.state.error.userMessage}</span>
                    <div className="ai-voice-error__actions">
                      {voice.state.error.canOpenMicrophoneSettings ? (
                        <button type="button" onClick={() => void voice.openMicrophoneSettings()}>
                          {t('ai.voice.openSettings')}
                        </button>
                      ) : null}
                      {voice.state.error.canRetry ? (
                        <button type="button" onClick={() => void voice.start()}>
                          {t('ai.voice.retry')}
                        </button>
                      ) : null}
                    </div>
                    {showDeveloperDiagnostics ? (
                      <details className="ai-voice-error__debug">
                        <summary>{t('ai.developerDetails')}</summary>
                        <code>
                          {voice.state.error.code} · {voice.state.error.stage} ·{' '}
                          {voice.state.error.operationId}
                          {voice.state.error.debugMessage
                            ? ` · ${voice.state.error.debugMessage}`
                            : ''}
                        </code>
                      </details>
                    ) : null}
                  </div>
                ) : null}
                <div className="ai-chat-input__toolbar">
                  <button
                    className="ai-chat-input__tool-button ai-chat-input__mic-button"
                    type="button"
                    aria-label={t('ai.voice.start')}
                    title={t('ai.voice.title')}
                    disabled={state.isRunning}
                    onClick={() => void voice.start()}
                  >
                    <img src={aiMicIcon} alt="" aria-hidden="true" />
                  </button>
                  {state.isRunning ? (
                    <button className="ai-chat-input__tool-button ai-chat-input__tool-button--danger" type="button" aria-label={t('ai.run.stop')} onClick={onCancel}><Square size={14} /></button>
                  ) : (
                    <button className="ai-chat-send-button" type="button" aria-label={t('ai.message.send')} disabled={!canSend} onClick={onSend}><Send size={15} /></button>
                  )}
                </div>
              </>
            )}
          </div>
        </footer>
          </>
        )}
      </div>
    </aside>
  );
}
