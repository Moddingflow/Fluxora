import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { InstallerLanguage } from '../src/installer/contracts';
import { LegalDocumentsPanel } from '../src/renderer/features/legal/LegalDocumentsPanel';
import {
  legalDocumentKinds,
  legalManifest,
  offlineLegalDocument
} from '../src/renderer/features/legal/legal-documents';

const legalDirectory = fileURLToPath(new URL('../../legal/desktop/', import.meta.url));

describe('offline legal document panel', () => {
  it('uses one manifest-backed source with exact on-disk SHA-256 hashes', () => {
    expect(legalManifest.schemaVersion).toBe(1);
    expect(legalManifest.fallbackLanguage).toBe('en');
    expect(legalManifest.documents).toHaveLength(12);

    for (const entry of legalManifest.documents) {
      const bytes = readFileSync(`${legalDirectory}/${entry.path}`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      expect(offlineLegalDocument(entry.language, entry.kind).content).toBe(
        bytes.toString('utf8')
      );
    }
  });

  it.each([
    ['en', 'Legal Notice', 'Legal documents', 'Legal document tabs'],
    ['de', 'Rechtliche Informationen', 'Rechtliche Dokumente', 'Registerkarten für rechtliche Dokumente'],
    ['ru', 'Правовая информация', 'Юридические документы', 'Вкладки юридических документов']
  ] as const)(
    'renders all four %s tabs with localized accessible labels',
    (language, legalNoticeTitle, panelLabel, tabLabel) => {
      const html = renderToStaticMarkup(createElement(LegalDocumentsPanel, {
        language,
        selected: 'legal-notice',
        onSelect: vi.fn()
      }));
      expect(html).toContain(`aria-label="${panelLabel}"`);
      expect(html).toContain(`aria-label="${tabLabel}"`);
      expect(html.match(/role="tab"/gu)).toHaveLength(4);
      expect(html).toContain(legalNoticeTitle);
      expect(html).toContain('role="tabpanel"');
      expect(html).not.toMatch(/\bImpressum\b/iu);
    }
  );

  it('never exposes the forbidden legacy title in any user-visible document', () => {
    for (const language of ['en', 'de', 'ru'] satisfies InstallerLanguage[]) {
      for (const kind of legalDocumentKinds) {
        const document = offlineLegalDocument(language, kind);
        expect(document.title).not.toMatch(/\bImpressum\b/iu);
        expect(document.content).not.toMatch(/\bImpressum\b/iu);
      }
    }
  });

  it.each([
    ['en', /Selecting Install.+automatically.+signed stable/is, /signed full package.+downgrade.+delta/is],
    ['de', /Mit Installieren.+automatisch.+signierte stabile/is, /signierte Vollpaket.+Downgrade.+Delta/is],
    ['ru', /Нажатие «Установить».+автоматически.+подписанную stable/is, /подписанный full package.+downgrade.+delta/is]
  ] as const)('discloses the one-click post-Setup update contract in %s', (language, privacy, terms) => {
    expect(offlineLegalDocument(language, 'privacy').content).toMatch(privacy);
    expect(offlineLegalDocument(language, 'privacy').content).toContain('%APPDATA%\\Fluxora\\updates');
    expect(offlineLegalDocument(language, 'terms').content).toMatch(terms);
  });
});
