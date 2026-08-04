import { X } from '../../design-system/icons/lucide-compat';
import { useEffect, useRef, type CSSProperties, type FormEvent } from 'react';

import layersIcon from '../../../../../Icons/layers.svg';
import { translateForLanguage } from '../../../localization';
import { Button } from '../../design-system';

export const PLUGIN_SEPARATOR_NAME_MAX_LENGTH = 255;

export interface PluginSeparatorDialogState {
  name: string;
  validationMessage: string | null;
}

export interface PluginSeparatorDialogProps {
  language?: string | null;
  state: PluginSeparatorDialogState | null;
  onCancel: () => void;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
}

export interface PluginSeparatorCopy {
  cancelLabel: string;
  closeLabel: string;
  createLabel: string;
  creatingLabel: string;
  inputLabel: string;
  menuLabel: string;
  requiredMessage: string;
  title: string;
}

export const pluginSeparatorCopy = (
  language: string | null | undefined
): PluginSeparatorCopy => ({
  cancelLabel: translateForLanguage(language, 'pluginSeparator.cancel'),
  closeLabel: translateForLanguage(language, 'pluginSeparator.close'),
  createLabel: translateForLanguage(language, 'pluginSeparator.create'),
  creatingLabel: translateForLanguage(language, 'pluginSeparator.creating'),
  inputLabel: translateForLanguage(language, 'pluginSeparator.input'),
  menuLabel: translateForLanguage(language, 'pluginSeparator.menu'),
  requiredMessage: translateForLanguage(language, 'pluginSeparator.required'),
  title: translateForLanguage(language, 'pluginSeparator.title')
});

type PluginSeparatorIconStyle = CSSProperties & {
  '--mod-create-icon': string;
};

export function PluginSeparatorDialog({
  language,
  onCancel,
  onNameChange,
  onSubmit,
  state
}: PluginSeparatorDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [state]);

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

  const copy = pluginSeparatorCopy(language);
  const validationId = state.validationMessage
    ? 'plugin-separator-dialog-validation'
    : undefined;

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
        aria-labelledby="plugin-separator-dialog-title"
        aria-modal="true"
        className="mod-create-dialog"
        role="dialog"
      >
        <header className="mod-create-dialog__header">
          <div className="mod-create-dialog__title">
            <span
              aria-hidden="true"
              className="mod-create-dialog__icon"
              style={
                {
                  '--mod-create-icon': `url("${layersIcon}")`
                } as PluginSeparatorIconStyle
              }
            />
            <strong id="plugin-separator-dialog-title">{copy.title}</strong>
          </div>
          <button
            aria-label={copy.closeLabel}
            className="icon-button"
            title={copy.closeLabel}
            type="button"
            onClick={onCancel}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form className="mod-create-dialog__form" onSubmit={handleSubmit}>
          <label className="mod-create-dialog__field">
            <span>{copy.inputLabel}</span>
            <span
              className="flx-input"
              data-full-width="true"
              data-invalid={state.validationMessage ? 'true' : undefined}
            >
              <input
                ref={inputRef}
                aria-describedby={validationId}
                className="flx-input__control"
                maxLength={PLUGIN_SEPARATOR_NAME_MAX_LENGTH}
                value={state.name}
                onChange={(event) => onNameChange(event.currentTarget.value)}
              />
            </span>
          </label>
          {state.validationMessage ? (
            <span
              className="mod-create-dialog__validation"
              id="plugin-separator-dialog-validation"
              role="alert"
            >
              {state.validationMessage}
            </span>
          ) : null}
          <footer className="mod-create-dialog__actions">
            <Button size="sm" type="button" variant="secondary" onClick={onCancel}>
              {copy.cancelLabel}
            </Button>
            <Button disabled={!state.name.trim()} size="sm" type="submit">
              {copy.createLabel}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
