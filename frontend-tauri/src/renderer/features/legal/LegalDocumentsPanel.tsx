import { Fragment } from 'react';

import type { InstallerLanguage } from '../../../installer/contracts';
import type { LegalDocumentKind } from '../../../installer/setup/setup-flow';
import {
  legalDocumentKinds,
  legalManifest,
  offlineLegalDocument
} from './legal-documents';
import './legal-documents.css';

export interface LegalDocumentsPanelProps {
  language: InstallerLanguage;
  selected: LegalDocumentKind;
  onSelect: (kind: LegalDocumentKind) => void;
  compact?: boolean;
}

const readableMarkdownLine = (line: string): string =>
  line.replace(/\[([^\]]+)\]\(([^)]+)\)/gu, '$1 ($2)').replace(/\s{2}$/u, '');

function LegalLineText({ line }: { line: string }) {
  const segments = line.split(/<br\s*\/?>/giu);
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={`${index}-${segment}`}>
          {index > 0 ? <br /> : null}
          {segment}
        </Fragment>
      ))}
    </>
  );
}

function LegalMarkdown({ content }: { content: string }) {
  return (
    <>
      {content.split(/\r?\n/u).map((rawLine, index) => {
        const line = readableMarkdownLine(rawLine);
        if (!line.trim()) {
          return <span aria-hidden="true" className="legal-document__space" key={index} />;
        }
        const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
        if (heading) {
          const level = heading[1].length;
          const Heading = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4';
          return <Heading key={index}>{heading[2]}</Heading>;
        }
        if (/^[-*]\s+/u.test(line)) {
          return (
            <p className="legal-document__list-item" key={index}>
              <LegalLineText line={line.replace(/^[-*]\s+/u, '')} />
            </p>
          );
        }
        return <p key={index}><LegalLineText line={line} /></p>;
      })}
    </>
  );
}

export function LegalDocumentsPanel({
  compact = false,
  language,
  onSelect,
  selected
}: LegalDocumentsPanelProps) {
  const legalDocument = offlineLegalDocument(language, selected);
  const accessibilityLabels = {
    en: {
      panel: 'Legal documents',
      tabs: 'Legal document tabs'
    },
    de: {
      panel: 'Rechtliche Dokumente',
      tabs: 'Registerkarten für rechtliche Dokumente'
    },
    ru: {
      panel: 'Юридические документы',
      tabs: 'Вкладки юридических документов'
    }
  }[language];

  return (
    <section
      aria-label={accessibilityLabels.panel}
      className="legal-documents"
      data-compact={compact || undefined}
    >
      <div aria-label={accessibilityLabels.tabs} className="legal-documents__tabs" role="tablist">
        {legalDocumentKinds.map((kind) => {
          const item = offlineLegalDocument(language, kind);
          const active = kind === selected;
          const selectFromKeyboard = (direction: -1 | 1 | 'first' | 'last') => {
            const currentIndex = legalDocumentKinds.indexOf(kind);
            const nextIndex = direction === 'first'
              ? 0
              : direction === 'last'
                ? legalDocumentKinds.length - 1
                : (currentIndex + direction + legalDocumentKinds.length)
                  % legalDocumentKinds.length;
            const nextKind = legalDocumentKinds[nextIndex];
            onSelect(nextKind);
            document.getElementById(`legal-tab-${nextKind}`)?.focus();
          };
          return (
            <button
              aria-controls={`legal-document-${kind}`}
              aria-selected={active}
              className="legal-documents__tab"
              id={`legal-tab-${kind}`}
              key={kind}
              onClick={() => onSelect(kind)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  selectFromKeyboard(-1);
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  selectFromKeyboard(1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  selectFromKeyboard('first');
                } else if (event.key === 'End') {
                  event.preventDefault();
                  selectFromKeyboard('last');
                }
              }}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              {item.title}
            </button>
          );
        })}
      </div>
      <article
        aria-labelledby={`legal-tab-${selected}`}
        className="legal-document"
        id={`legal-document-${selected}`}
        role="tabpanel"
        tabIndex={0}
      >
        <LegalMarkdown content={legalDocument.content} />
      </article>
      <small className="legal-documents__effective-date">
        {legalManifest.effectiveDate}
      </small>
    </section>
  );
}
