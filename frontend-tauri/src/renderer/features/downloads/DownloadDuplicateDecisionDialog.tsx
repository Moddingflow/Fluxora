import { AlertTriangle, X } from '../../design-system/icons/lucide-compat';
import { useEffect, useRef } from 'react';

import type {
  FluxoraDownloadDuplicateChoice,
  FluxoraDownloadEntry
} from '../../../shared/fluxora-api';
import { useLocalization } from '../../../localization/react';

export interface DownloadDuplicateDecisionDialogProps {
  entry: FluxoraDownloadEntry | null;
  isResolving: boolean;
  errorMessage: string | null;
  onResolve: (choice: FluxoraDownloadDuplicateChoice) => void;
}

const directionText = (
  entry: FluxoraDownloadEntry,
  t: ReturnType<typeof useLocalization>['t']
): string => {
  switch (entry.duplicateDecision?.direction) {
    case 'same-file':
      return t('downloadDuplicate.direction.same-file');
    case 'downgrade':
      return t('downloadDuplicate.direction.downgrade');
    case 'mixed':
      return t('downloadDuplicate.direction.mixed');
    case 'upgrade':
    default:
      return t('downloadDuplicate.direction.upgrade');
  }
};

const fileLabel = (fileName: string, version: string, fallback: string): string =>
  version.trim() ? `${fileName || fallback} — ${version}` : fileName || fallback;

export function DownloadDuplicateDecisionDialog({
  entry,
  errorMessage,
  isResolving,
  onResolve
}: DownloadDuplicateDecisionDialogProps) {
  const { t } = useLocalization();
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
  const cancelLabel = isSameFile ? t('downloadDuplicate.close') : t('downloadDuplicate.cancel');
  const dialogTitleId = isSameFile ? 'download-duplicate-title' : 'download-duplicate-status';
  const sameFileArchiveName =
    decision.incomingFile.fileName.trim() || entry.fileName.trim() || t('downloadDuplicate.nexusFile');

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
              {t('downloadDuplicate.reinstall')}
            </strong>
          ) : (
            <div className="download-duplicate-dialog__status" id="download-duplicate-status">
              <span aria-hidden="true" className="download-duplicate-dialog__status-dot" />
              <strong>
                {decision.direction === 'upgrade'
                  ? t('downloadDuplicate.newVersion')
                  : t('downloadDuplicate.confirmVersion')}
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
            <span>{directionText(entry, t)}</span>
          </p>
          {isSameFile ? (
            <p className="download-duplicate-dialog__archive-name">{sameFileArchiveName}</p>
          ) : (
            <dl className="download-duplicate-dialog__files">
              <div>
                <dt>{t('downloadDuplicate.incoming')}</dt>
                <dd>{fileLabel(
                  decision.incomingFile.fileName,
                  decision.incomingFile.version,
                  t('downloadDuplicate.nexusFile')
                )}</dd>
              </div>
              <div>
                <dt>{t('downloadDuplicate.existing')}</dt>
                <dd>
                  <ul>
                    {decision.existingFiles.map((file) => (
                      <li key={file.id}>{fileLabel(
                        file.fileName,
                        file.version,
                        t('downloadDuplicate.nexusFile')
                      )}</li>
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
            {isResolving
              ? (isSameFile ? t('downloadDuplicate.replacing') : t('downloadDuplicate.applying'))
              : t('downloadDuplicate.replace')}
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
              {t('downloadDuplicate.keepBoth')}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
