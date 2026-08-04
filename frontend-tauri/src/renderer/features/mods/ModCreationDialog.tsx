import { X } from '../../design-system/icons/lucide-compat';
import { useEffect, useRef, type CSSProperties, type FormEvent } from 'react';

import layersIcon from '../../../../../Icons/layers.svg';
import packagePlusIcon from '../../../../../Icons/package-plus.svg';
import type { TranslationKey } from '../../../localization';
import { useLocalization } from '../../../localization/react';
import { Button } from '../../design-system';

export type ModCreationDialogKind = 'separator' | 'empty-mod';

export const MOD_CREATION_NAME_MAX_LENGTH = 255;

export interface ModCreationDialogState {
  kind: ModCreationDialogKind;
  name: string;
  validationMessage: string | null;
}

export interface ModCreationDialogProps {
  state: ModCreationDialogState | null;
  onCancel: () => void;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
}

type ModCreationIconStyle = CSSProperties & { '--mod-create-icon': string };

const dialogIconByKind: Record<ModCreationDialogKind, string> = {
  separator: layersIcon,
  'empty-mod': packagePlusIcon
};

export function ModCreationDialog({
  onCancel,
  onNameChange,
  onSubmit,
  state
}: ModCreationDialogProps) {
  const { t } = useLocalization();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [state?.kind]);

  useEffect(() => {
    if (!state) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, state]);

  if (!state) {
    return null;
  }

  const copy = (field: 'close' | 'input' | 'title') =>
    t(`modCreation.${state.kind}.${field}` as TranslationKey);
  const validationId = state.validationMessage ? 'mod-create-dialog-validation' : undefined;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div
      className="mod-create-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        aria-describedby={validationId}
        aria-labelledby="mod-create-dialog-title"
        aria-modal="true"
        className="mod-create-dialog"
        role="dialog"
      >
        <header className="mod-create-dialog__header">
          <div className="mod-create-dialog__title">
            <span
              aria-hidden="true"
              className="mod-create-dialog__icon"
              style={{
                '--mod-create-icon': `url("${dialogIconByKind[state.kind]}")`
              } as ModCreationIconStyle}
            />
            <strong id="mod-create-dialog-title">{copy('title')}</strong>
          </div>
          <button
            aria-label={copy('close')}
            className="icon-button"
            title={copy('close')}
            type="button"
            onClick={onCancel}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form className="mod-create-dialog__form" onSubmit={handleSubmit}>
          <label className="mod-create-dialog__field">
            <span>{copy('input')}</span>
            <span
              className="flx-input"
              data-full-width="true"
              data-invalid={state.validationMessage ? 'true' : undefined}
            >
              <input
                ref={inputRef}
                aria-describedby={validationId}
                className="flx-input__control"
                maxLength={MOD_CREATION_NAME_MAX_LENGTH}
                value={state.name}
                onChange={(event) => onNameChange(event.currentTarget.value)}
              />
            </span>
          </label>
          {state.validationMessage ? (
            <span
              className="mod-create-dialog__validation"
              id="mod-create-dialog-validation"
              role="alert"
            >
              {state.validationMessage}
            </span>
          ) : null}
          <footer className="mod-create-dialog__actions">
            <Button disabled={!state.name.trim()} size="sm" type="submit">
              {t('common.ok')}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
