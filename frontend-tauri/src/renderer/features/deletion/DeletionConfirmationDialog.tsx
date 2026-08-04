import { X } from '../../design-system/icons/lucide-compat';
import { useEffect, useRef, type CSSProperties } from 'react';

import trashIcon from '../../../../../Icons/trash.svg';
import { translateForLanguage, type TranslationKey } from '../../../localization';
import { useLocalization } from '../../../localization/react';

export type DeletionConfirmationKind = 'mod' | 'separator' | 'build' | 'download';

export interface DeletionConfirmationDialogProps {
  description?: string;
  kind: DeletionConfirmationKind;
  language?: string | null;
  itemName: string;
  itemCount?: number;
  onCancel: () => void;
  onConfirm: () => void;
}

type DeletionConfirmationIconStyle = CSSProperties & { '--delete-confirmation-icon': string };

export const deletionSubjectLabel = (
  kind: DeletionConfirmationKind,
  itemName: string,
  itemCount: number | undefined,
  language: string | null | undefined
): string => {
  if (!itemCount || itemCount <= 1) {
    return itemName;
  }

  return translateForLanguage(
    language,
    `deletion.subject.${kind}` as TranslationKey,
    { count: itemCount }
  );
};

export function DeletionConfirmationDialog({
  description,
  itemCount,
  kind,
  language,
  itemName,
  onCancel,
  onConfirm
}: DeletionConfirmationDialogProps) {
  const { locale } = useLocalization();
  const activeLanguage = language ?? locale;
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const title = translateForLanguage(
    activeLanguage,
    `deletion.title.${kind}` as TranslationKey,
    { count: itemCount ?? 1 }
  );
  const subject = deletionSubjectLabel(kind, itemName, itemCount, activeLanguage);

  useEffect(() => {
    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmButtonRef.current?.focus({ preventScroll: true });

    return () => {
      if (previouslyFocusedElement?.isConnected) {
        previouslyFocusedElement.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="delete-confirmation-backdrop" role="presentation">
      <section
        aria-describedby={
          description
            ? 'delete-confirmation-name delete-confirmation-description'
            : 'delete-confirmation-name'
        }
        aria-labelledby="delete-confirmation-title"
        aria-modal="true"
        className="delete-confirmation-dialog"
        role="dialog"
      >
        <header className="delete-confirmation-dialog__header">
          <div className="delete-confirmation-dialog__title">
            <span
              aria-hidden="true"
              className="delete-confirmation-dialog__icon"
              style={
                { '--delete-confirmation-icon': `url("${trashIcon}")` } as DeletionConfirmationIconStyle
              }
            />
            <strong id="delete-confirmation-title">{title}</strong>
          </div>
          <button
            aria-label={translateForLanguage(activeLanguage, 'deletion.close')}
            className="icon-button"
            title={translateForLanguage(activeLanguage, 'deletion.close')}
            type="button"
            onClick={onCancel}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="delete-confirmation-dialog__body">
          <strong id="delete-confirmation-name">{subject}</strong>
          {description ? <p id="delete-confirmation-description">{description}</p> : null}
        </div>

        <footer className="delete-confirmation-dialog__actions">
          <button
            className="danger-button"
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
          >
            {translateForLanguage(activeLanguage, 'deletion.confirm')}
          </button>
        </footer>
      </section>
    </div>
  );
}
