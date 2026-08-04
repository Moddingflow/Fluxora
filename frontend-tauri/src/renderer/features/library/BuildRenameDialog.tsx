import { useEffect, useRef, type FormEvent } from 'react';

import { translateForLanguage } from '../../../localization';
import { Button, Icon, IconButton } from '../../design-system';

export const BUILD_RENAME_NAME_MAX_LENGTH = 255;

export interface BuildRenameDialogState {
  currentName: string;
  gameName: string;
  isSubmitting: boolean;
  name: string;
  validationMessage: string | null;
}

export interface BuildRenameDialogProps {
  language?: string | null;
  state: BuildRenameDialogState | null;
  onCancel: () => void;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
}

export interface BuildRenameDialogCopy {
  closeLabel: string;
  inputLabel: string;
  renameLabel: string;
  renamingLabel: string;
  requiredMessage: string;
  title: string;
  unchangedMessage: string;
}

export const buildRenameDialogCopy = (
  language: string | null | undefined
): BuildRenameDialogCopy => ({
  closeLabel: translateForLanguage(language, 'buildRename.close'),
  inputLabel: translateForLanguage(language, 'buildRename.input'),
  renameLabel: translateForLanguage(language, 'buildRename.rename'),
  renamingLabel: translateForLanguage(language, 'buildRename.renaming'),
  requiredMessage: translateForLanguage(language, 'buildRename.required'),
  title: translateForLanguage(language, 'buildRename.title'),
  unchangedMessage: translateForLanguage(language, 'buildRename.unchanged')
});

export function BuildRenameDialog({
  language,
  onCancel,
  onNameChange,
  onSubmit,
  state
}: BuildRenameDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
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
  }, [state?.currentName]);

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

  const copy = buildRenameDialogCopy(language);
  const validationId = state.validationMessage
    ? 'build-rename-dialog-validation'
    : undefined;
  const normalizedName = state.name.trim();
  const isSubmitDisabled =
    state.isSubmitting ||
    !normalizedName ||
    normalizedName === state.currentName;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSubmitDisabled) {
      onSubmit();
    }
  };

  return (
    <div
      className="build-rename-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !state.isSubmitting) {
          onCancel();
        }
      }}
    >
      <section
        ref={dialogRef}
        aria-busy={state.isSubmitting || undefined}
        aria-describedby={validationId}
        aria-labelledby="build-rename-dialog-title"
        aria-modal="true"
        className="build-rename-dialog"
        role="dialog"
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
        <header className="build-rename-dialog__header">
          <h2 className="build-rename-dialog__title" id="build-rename-dialog-title">
            {copy.title}
          </h2>
          <IconButton
            disabled={state.isSubmitting}
            label={copy.closeLabel}
            size="sm"
            onClick={onCancel}
          >
            <Icon name="window-close" size={15} strokeWidth={2} />
          </IconButton>
        </header>

        <form className="build-rename-dialog__form" onSubmit={handleSubmit}>
          <label className="build-rename-dialog__field">
            <span>{copy.inputLabel}</span>
            <span
              className="flx-input"
              data-full-width="true"
              data-invalid={state.validationMessage ? 'true' : undefined}
            >
              <input
                ref={inputRef}
                aria-describedby={validationId}
                aria-invalid={state.validationMessage ? true : undefined}
                autoComplete="off"
                className="flx-input__control"
                disabled={state.isSubmitting}
                maxLength={BUILD_RENAME_NAME_MAX_LENGTH}
                spellCheck={false}
                value={state.name}
                onChange={(event) => onNameChange(event.currentTarget.value)}
              />
            </span>
          </label>

          {state.validationMessage ? (
            <span
              className="build-rename-dialog__validation"
              id="build-rename-dialog-validation"
              role="alert"
            >
              {state.validationMessage}
            </span>
          ) : null}

          <footer className="build-rename-dialog__actions">
            <Button disabled={isSubmitDisabled} size="sm" type="submit">
              {state.isSubmitting ? copy.renamingLabel : copy.renameLabel}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
