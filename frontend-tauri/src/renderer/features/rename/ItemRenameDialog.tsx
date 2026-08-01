import {
  AlertTriangle,
  Pencil,
  X
} from '../../design-system/icons/lucide-compat';
import { useEffect, useRef, type FormEvent } from 'react';

import { INSTALL_MOD_NAME_MAX_LENGTH } from '../../install-workspace-state';

export type ItemRenameKind = 'mod' | 'download';

export interface ItemRenameDialogState {
  currentName: string;
  isSubmitting: boolean;
  kind: ItemRenameKind;
  maxNameLength: number;
  name: string;
  validationMessage: string | null;
}

export interface ItemRenameDialogProps {
  language?: string | null;
  state: ItemRenameDialogState | null;
  onCancel: () => void;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
}

export interface ItemRenameDialogCopy {
  closeLabel: string;
  copyPathLabel: string;
  inputLabel: string;
  menuRenameLabel: string;
  renameLabel: string;
  renamingLabel: string;
  title: string;
  unchangedMessage: string;
}

const copyByLanguage: Record<'de' | 'en' | 'ru', Record<ItemRenameKind, ItemRenameDialogCopy>> = {
  en: {
    mod: {
      closeLabel: 'Close mod rename',
      copyPathLabel: 'Copy as path',
      inputLabel: 'New mod name',
      menuRenameLabel: 'Rename',
      renameLabel: 'Rename',
      renamingLabel: 'Renaming…',
      title: 'Rename mod',
      unchangedMessage: 'Enter a different mod name.'
    },
    download: {
      closeLabel: 'Close file rename',
      copyPathLabel: 'Copy as path',
      inputLabel: 'New file name',
      menuRenameLabel: 'Rename',
      renameLabel: 'Rename',
      renamingLabel: 'Renaming…',
      title: 'Rename file',
      unchangedMessage: 'Enter a different file name.'
    }
  },
  de: {
    mod: {
      closeLabel: 'Mod-Umbenennung schließen',
      copyPathLabel: 'Als Pfad kopieren',
      inputLabel: 'Neuer Mod-Name',
      menuRenameLabel: 'Umbenennen',
      renameLabel: 'Umbenennen',
      renamingLabel: 'Wird umbenannt…',
      title: 'Mod umbenennen',
      unchangedMessage: 'Gib einen anderen Mod-Namen ein.'
    },
    download: {
      closeLabel: 'Datei-Umbenennung schließen',
      copyPathLabel: 'Als Pfad kopieren',
      inputLabel: 'Neuer Dateiname',
      menuRenameLabel: 'Umbenennen',
      renameLabel: 'Umbenennen',
      renamingLabel: 'Wird umbenannt…',
      title: 'Datei umbenennen',
      unchangedMessage: 'Gib einen anderen Dateinamen ein.'
    }
  },
  ru: {
    mod: {
      closeLabel: 'Закрыть переименование мода',
      copyPathLabel: 'Копировать как путь',
      inputLabel: 'Новое название мода',
      menuRenameLabel: 'Переименовать',
      renameLabel: 'Переименовать',
      renamingLabel: 'Переименование…',
      title: 'Переименовать мод',
      unchangedMessage: 'Введите другое название мода.'
    },
    download: {
      closeLabel: 'Закрыть переименование файла',
      copyPathLabel: 'Копировать как путь',
      inputLabel: 'Новое имя файла',
      menuRenameLabel: 'Переименовать',
      renameLabel: 'Переименовать',
      renamingLabel: 'Переименование…',
      title: 'Переименовать файл',
      unchangedMessage: 'Введите другое имя файла.'
    }
  }
};

export const itemRenameDialogCopy = (
  language: string | null | undefined,
  kind: ItemRenameKind
): ItemRenameDialogCopy => {
  const normalized = language?.trim().toLocaleLowerCase() ?? '';
  if (normalized.startsWith('ru')) {
    return copyByLanguage.ru[kind];
  }
  if (normalized.startsWith('de')) {
    return copyByLanguage.de[kind];
  }
  return copyByLanguage.en[kind];
};

const archiveSuffixes = [
  '.tar.bz2',
  '.tar.zst',
  '.tar.gz',
  '.tar.xz',
  '.7z.001',
  '.fomod',
  '.omod',
  '.tbz2',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.tgz',
  '.tbz',
  '.txz',
  '.bz2',
  '.zst',
  '.cab',
  '.iso',
  '.wim',
  '.arj',
  '.lzh',
  '.lha',
  '.ba2',
  '.gz',
  '.xz'
] as const;

export const downloadRenameBaseName = (fileName: string): string => {
  const normalized = fileName.trim();
  const suffix = downloadArchiveSuffix(normalized);
  if (!suffix || normalized.length <= suffix.length) {
    return normalized;
  }
  return normalized.slice(0, -suffix.length);
};

export const downloadArchiveSuffix = (fileName: string): string => {
  const lowerName = fileName.trim().toLocaleLowerCase();
  return archiveSuffixes.find((candidate) => lowerName.endsWith(candidate)) ?? '';
};

export function ItemRenameDialog({
  language,
  onCancel,
  onNameChange,
  onSubmit,
  state
}: ItemRenameDialogProps) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state) {
      return undefined;
    }

    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();

    return () => {
      if (previouslyFocusedElement?.isConnected) {
        previouslyFocusedElement.focus({ preventScroll: true });
      }
    };
  }, [state?.currentName, state?.kind]);

  useEffect(() => {
    if (state && !state.isSubmitting && state.validationMessage) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [state?.isSubmitting, state?.validationMessage]);

  useEffect(() => {
    if (!state) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !state.isSubmitting) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, state?.isSubmitting]);

  if (!state) {
    return null;
  }

  const copy = itemRenameDialogCopy(language, state.kind);
  const validationId = state.validationMessage ? 'item-rename-dialog-validation' : undefined;
  const normalizedName = state.name.trim();
  const isSubmitDisabled =
    state.isSubmitting || !normalizedName || normalizedName === state.currentName;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSubmitDisabled) {
      onSubmit();
    }
  };

  return (
    <div
      className="install-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !state.isSubmitting) {
          onCancel();
        }
      }}
    >
      <section className="install-modal-layout" data-phase="options">
        <form
          ref={dialogRef}
          aria-busy={state.isSubmitting || undefined}
          aria-describedby={validationId}
          aria-labelledby="item-rename-dialog-title"
          aria-modal="true"
          className="install-dialog item-rename-dialog"
          data-phase="options"
          role="dialog"
          onSubmit={handleSubmit}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') {
              return;
            }
            const focusableElements = [
              ...(dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled)'
              ) ?? [])
            ];
            const firstElement = focusableElements[0];
            const lastElement = focusableElements.at(-1);
            if (event.shiftKey && document.activeElement === firstElement) {
              event.preventDefault();
              lastElement?.focus();
            } else if (!event.shiftKey && document.activeElement === lastElement) {
              event.preventDefault();
              firstElement?.focus();
            }
          }}
        >
          <header className="install-dialog-header">
            <div className="install-dialog-title" id="item-rename-dialog-title">
              <Pencil size={17} aria-hidden="true" />
              <strong>{copy.title}</strong>
            </div>
            <button
              aria-label={copy.closeLabel}
              className="icon-button"
              disabled={state.isSubmitting}
              title={copy.closeLabel}
              type="button"
              onClick={onCancel}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="install-dialog-body">
            <div className="install-simple">
              <label className="field install-name-field">
                <span>{copy.inputLabel}</span>
                <input
                  ref={inputRef}
                  aria-describedby={validationId}
                  aria-invalid={state.validationMessage ? true : undefined}
                  autoComplete="off"
                  disabled={state.isSubmitting}
                  maxLength={state.maxNameLength || INSTALL_MOD_NAME_MAX_LENGTH}
                  spellCheck={false}
                  value={state.name}
                  onChange={(event) => onNameChange(event.currentTarget.value)}
                />
              </label>
              {state.validationMessage ? (
                <div className="install-validation" id={validationId} role="alert">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>{state.validationMessage}</span>
                </div>
              ) : null}
            </div>
          </div>

          <footer className="install-dialog-actions">
            <span />
            <div className="install-dialog-action-group">
              <button className="primary-button" disabled={isSubmitDisabled} type="submit">
                {state.isSubmitting ? copy.renamingLabel : copy.renameLabel}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
