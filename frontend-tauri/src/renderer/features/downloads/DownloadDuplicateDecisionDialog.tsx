import { AlertTriangle, X } from '../../design-system/icons/lucide-compat';
import { useEffect, useRef } from 'react';

import type {
  FluxoraDownloadDuplicateChoice,
  FluxoraDownloadEntry
} from '../../../shared/fluxora-api';

export interface DownloadDuplicateDecisionDialogProps {
  entry: FluxoraDownloadEntry | null;
  isResolving: boolean;
  errorMessage: string | null;
  onResolve: (choice: FluxoraDownloadDuplicateChoice) => void;
}

const directionText = (entry: FluxoraDownloadEntry): string => {
  switch (entry.duplicateDecision?.direction) {
    case 'same-file':
      return 'Точно такой же архив уже есть в Downloads. При замене Fluxora сразу уберёт старый архив из списка и скачает новый на его место.';
    case 'downgrade':
      return 'Вы скачиваете более старую версию. Установленный мод не изменится.';
    case 'mixed':
      return 'В Downloads одновременно есть более старые и более новые версии этой цепочки.';
    case 'upgrade':
    default:
      return 'В Downloads уже есть более ранняя версия этого файла Nexus.';
  }
};

const fileLabel = (fileName: string, version: string): string =>
  version.trim() ? `${fileName || 'Файл Nexus'} — ${version}` : fileName || 'Файл Nexus';

export function DownloadDuplicateDecisionDialog({
  entry,
  errorMessage,
  isResolving,
  onResolve
}: DownloadDuplicateDecisionDialogProps) {
  const replaceButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!entry) {
      return;
    }
    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    replaceButtonRef.current?.focus({ preventScroll: true });
    return () => {
      if (previouslyFocusedElement?.isConnected) {
        previouslyFocusedElement.focus({ preventScroll: true });
      }
    };
  }, [entry?.id]);

  useEffect(() => {
    if (!entry || isResolving) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onResolve('cancel');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [entry, isResolving, onResolve]);

  const decision = entry?.duplicateDecision;
  if (!entry || !decision) {
    return null;
  }
  const isSameFile = decision.direction === 'same-file';
  const cancelLabel = isSameFile ? 'Закрыть' : 'Отменить загрузку';
  const dialogTitleId = isSameFile ? 'download-duplicate-title' : 'download-duplicate-status';
  const sameFileArchiveName =
    decision.incomingFile.fileName.trim() || entry.fileName.trim() || 'Файл Nexus';

  return (
    <div className="download-duplicate-backdrop" role="presentation">
      <section
        aria-describedby="download-duplicate-summary"
        aria-labelledby={dialogTitleId}
        aria-modal="true"
        className="download-duplicate-dialog"
        role="dialog"
      >
        <header className="download-duplicate-dialog__header">
          {isSameFile ? (
            <strong className="download-duplicate-dialog__title" id="download-duplicate-title">
              Повторная установка мода
            </strong>
          ) : (
            <div className="download-duplicate-dialog__status" id="download-duplicate-status">
              <span aria-hidden="true" className="download-duplicate-dialog__status-dot" />
              <strong>
                {decision.direction === 'upgrade'
                  ? 'Найдена новая версия'
                  : 'Нужно подтвердить версию'}
              </strong>
            </div>
          )}
          <button
            aria-label={cancelLabel}
            className="flx-icon-button download-duplicate-dialog__close"
            data-size="md"
            data-variant="bare"
            disabled={isResolving}
            title={cancelLabel}
            type="button"
            onClick={() => onResolve('cancel')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="download-duplicate-dialog__body">
          <p id="download-duplicate-summary" className="download-duplicate-dialog__warning">
            {decision.direction !== 'upgrade' ? <AlertTriangle size={16} aria-hidden="true" /> : null}
            <span>{directionText(entry)}</span>
          </p>
          {isSameFile ? (
            <p className="download-duplicate-dialog__archive-name">{sameFileArchiveName}</p>
          ) : (
            <dl className="download-duplicate-dialog__files">
              <div>
                <dt>Входящий файл</dt>
                <dd>{fileLabel(decision.incomingFile.fileName, decision.incomingFile.version)}</dd>
              </div>
              <div>
                <dt>В Downloads</dt>
                <dd>
                  <ul>
                    {decision.existingFiles.map((file) => (
                      <li key={file.id}>{fileLabel(file.fileName, file.version)}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          )}
          {errorMessage ? <p className="download-duplicate-dialog__error" role="alert">{errorMessage}</p> : null}
        </div>

        <footer className="download-duplicate-dialog__actions">
          <button
            className="flx-button download-duplicate-dialog__action"
            data-size="md"
            data-variant="primary"
            disabled={isResolving}
            ref={replaceButtonRef}
            type="button"
            onClick={() => onResolve('replace')}
          >
            {isResolving ? (isSameFile ? 'Заменяем…' : 'Применяем…') : 'Заменить'}
          </button>
          {!isSameFile ? (
            <button
              className="flx-button download-duplicate-dialog__action"
              data-size="md"
              data-variant="secondary"
              disabled={isResolving}
              type="button"
              onClick={() => onResolve('keepBoth')}
            >
              Сохранить оба
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
