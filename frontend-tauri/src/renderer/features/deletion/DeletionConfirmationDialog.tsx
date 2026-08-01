import { X } from '../../design-system/icons/lucide-compat';
import { useEffect, useRef, type CSSProperties } from 'react';

import trashIcon from '../../../../../Icons/trash.svg';

export type DeletionConfirmationKind = 'mod' | 'separator' | 'build' | 'download';

export interface DeletionConfirmationDialogProps {
  description?: string;
  kind: DeletionConfirmationKind;
  itemName: string;
  itemCount?: number;
  onCancel: () => void;
  onConfirm: () => void;
}

type DeletionConfirmationIconStyle = CSSProperties & { '--delete-confirmation-icon': string };

const titleByKind: Record<DeletionConfirmationKind, string> = {
  mod: 'Удаление мода',
  separator: 'Удаление разделителя',
  build: 'Удаление сборки',
  download: 'Удаление файла'
};

const pluralTitleByKind: Record<DeletionConfirmationKind, string> = {
  mod: 'Удаление модов',
  separator: 'Удаление разделителей',
  build: 'Удаление сборок',
  download: 'Удаление файлов'
};

const subjectFormsByKind: Record<DeletionConfirmationKind, readonly [string, string, string]> = {
  mod: ['мод', 'мода', 'модов'],
  separator: ['разделитель', 'разделителя', 'разделителей'],
  build: ['сборка', 'сборки', 'сборок'],
  download: ['файл', 'файла', 'файлов']
};

const russianPluralForm = (
  count: number,
  forms: readonly [string, string, string]
): string => {
  const absolute = Math.abs(count);
  const mod10 = absolute % 10;
  const mod100 = absolute % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return forms[0];
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return forms[1];
  }

  return forms[2];
};

export const deletionSubjectLabel = (
  kind: DeletionConfirmationKind,
  itemName: string,
  itemCount: number | undefined
): string => {
  if (!itemCount || itemCount <= 1) {
    return itemName;
  }

  return `${itemCount} ${russianPluralForm(itemCount, subjectFormsByKind[kind])}`;
};

export function DeletionConfirmationDialog({
  description,
  itemCount,
  kind,
  itemName,
  onCancel,
  onConfirm
}: DeletionConfirmationDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const hasMultipleItems = Boolean(itemCount && itemCount > 1);
  const title = hasMultipleItems ? pluralTitleByKind[kind] : titleByKind[kind];
  const subject = deletionSubjectLabel(kind, itemName, itemCount);

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
            aria-label="Закрыть окно удаления"
            className="icon-button"
            title="Закрыть окно удаления"
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
            Удалить
          </button>
        </footer>
      </section>
    </div>
  );
}
