import { useEffect, useRef } from 'react';
import { Mic, X } from 'lucide-react';

import { aiMicrophonePermissionCopy } from './ai-voice-copy';

interface AiMicrophonePermissionDialogProps {
  language: string;
  onAllow: () => void;
  onDeny: () => void;
}

export function AiMicrophonePermissionDialog({
  language,
  onAllow,
  onDeny
}: AiMicrophonePermissionDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const allowRef = useRef<HTMLButtonElement | null>(null);
  const copy = aiMicrophonePermissionCopy(language);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    allowRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDeny();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDeny]);

  return (
    <div
      className="ai-microphone-permission-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDeny();
      }}
    >
      <section
        aria-describedby="ai-microphone-permission-description"
        aria-labelledby="ai-microphone-permission-title"
        aria-modal="true"
        className="ai-microphone-permission-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <span className="ai-microphone-permission-dialog__icon" aria-hidden="true">
            <Mic size={18} />
          </span>
          <strong id="ai-microphone-permission-title">{copy.title}</strong>
          <button
            aria-label={copy.close}
            className="ai-microphone-permission-dialog__close"
            onClick={onDeny}
            type="button"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        <p id="ai-microphone-permission-description">{copy.body}</p>
        <footer>
          <button className="secondary-button" onClick={onDeny} type="button">
            {copy.deny}
          </button>
          <button className="primary-button" onClick={onAllow} ref={allowRef} type="button">
            {copy.allow}
          </button>
        </footer>
      </section>
    </div>
  );
}

