import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  FilePenLine,
  FileText,
  FolderOpen,
  X
} from '../../design-system/icons/lucide-compat';

import type { FluxoraAiFileChange } from '../../../shared/fluxora-api';

type DiffRowKind = 'added' | 'context' | 'removed';

interface DiffRow {
  key: string;
  kind: DiffRowKind;
  marker: '+' | ' ' | '-';
  newLine: number | null;
  oldLine: number | null;
  text: string;
}

const fileNameFromPath = (path: string): string =>
  path.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? 'file';

const diffRows = (change: FluxoraAiFileChange): DiffRow[][] =>
  change.hunks.map((hunk, hunkIndex) => {
    let oldLine = Math.max(1, hunk.oldStart);
    let newLine = Math.max(1, hunk.newStart);
    return hunk.lines.map((line, lineIndex) => {
      const marker = line.startsWith('+') ? '+' : line.startsWith('-') ? '-' : ' ';
      const row: DiffRow = {
        key: `${hunkIndex}:${lineIndex}`,
        kind: marker === '+' ? 'added' : marker === '-' ? 'removed' : 'context',
        marker,
        oldLine: marker === '+' ? null : oldLine,
        newLine: marker === '-' ? null : newLine,
        text: marker === ' ' ? line.replace(/^ /u, '') : line.slice(1)
      };
      if (marker !== '+') oldLine += 1;
      if (marker !== '-') newLine += 1;
      return row;
    });
  });

export function AiFileDiffPreviewDialog({
  change,
  onClose,
  onOpenEditor,
  onShowInFolder
}: {
  change: FluxoraAiFileChange;
  onClose: () => void;
  onOpenEditor: () => void;
  onShowInFolder: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const fileName = fileNameFromPath(change.relativePath);
  const hunks = useMemo(() => diffRows(change), [change]);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="ai-file-diff-preview__backdrop"
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="ai-file-diff-preview"
        role="dialog"
        aria-modal="true"
        aria-label={`Changes preview: ${fileName}`}
        tabIndex={-1}
      >
        <header className="ai-file-diff-preview__header">
          <div className="ai-file-diff-preview__title">
            <FileText size={16} aria-hidden="true" />
            <div>
              <strong>{fileName}</strong>
              <span>{change.relativePath}</span>
            </div>
          </div>
          <button type="button" aria-label="Close changes preview" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="ai-file-diff-preview__summary">
          <span>Read-only changes preview</span>
          <span className="ai-file-change__added">+{change.addedLines}</span>
          <span className="ai-file-change__removed">−{change.removedLines}</span>
        </div>

        <div className="ai-file-diff-preview__body" role="region" aria-label="Changed lines">
          {change.hunks.map((hunk, hunkIndex) => (
            <section className="ai-file-diff-preview__hunk" key={`${hunk.oldStart}:${hunk.newStart}:${hunkIndex}`}>
              <div className="ai-file-diff-preview__hunk-header">
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </div>
              {hunks[hunkIndex].map((row) => (
                <div className="ai-file-diff-preview__row" data-diff-kind={row.kind} key={row.key}>
                  <span>{row.oldLine ?? ''}</span>
                  <span>{row.newLine ?? ''}</span>
                  <code><i aria-hidden="true">{row.marker}</i>{row.text || ' '}</code>
                </div>
              ))}
            </section>
          ))}
        </div>
        <footer className="ai-file-diff-preview__actions">
          <button type="button" onClick={onShowInFolder}>
            <FolderOpen size={14} aria-hidden="true" />
            Открыть в проводнике
          </button>
          <button type="button" onClick={onOpenEditor}>
            <FilePenLine size={14} aria-hidden="true" />
            Open full editor
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
