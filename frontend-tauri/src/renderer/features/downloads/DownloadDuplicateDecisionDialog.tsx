import { AlertTriangle, X } from 'lucide-react';
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

  return (
    <div className="download-duplicate-backdrop" role="presentation">
      <section
        aria-describedby="download-duplicate-summary"
        aria-labelledby="download-duplicate-title"
        aria-modal="true"
        className="download-duplicate-dialog"
        role="dialog"
      >
        <header className="download-duplicate-dialog__header">
          <div>
            <strong id="download-duplicate-title">Обновление архива Nexus</strong>
            <span>{decision.direction === 'upgrade' ? 'Найдена новая версия' : 'Нужно подтвердить версию'}</span>
          </div>
          <button
            aria-label="Отменить загрузку"
            className="icon-button"
            disabled={isResolving}
            title="Отменить загрузку"
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
          {errorMessage ? <p className="download-duplicate-dialog__error" role="alert">{errorMessage}</p> : null}
        </div>

        <footer className="download-duplicate-dialog__actions">
          <button
            className="primary-button"
            disabled={isResolving}
            ref={replaceButtonRef}
            type="button"
            onClick={() => onResolve('replace')}
          >
            {isResolving ? 'Применяем…' : 'Заменить'}
          </button>
          <button
            className="secondary-button"
            disabled={isResolving}
            type="button"
            onClick={() => onResolve('keepBoth')}
          >
            Сохранить оба
          </button>
          <button
            className="ghost-button"
            disabled={isResolving}
            type="button"
            onClick={() => onResolve('cancel')}
          >
            Отмена
          </button>
        </footer>
      </section>
    </div>
  );
}
