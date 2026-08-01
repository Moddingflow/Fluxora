import manifestJson from '@fluxora-legal/manifest.json';
import enPrivacy from '@fluxora-legal/en/privacy.md?raw';
import enTerms from '@fluxora-legal/en/terms.md?raw';
import enNotices from '@fluxora-legal/en/third-party-notices.md?raw';
import enLegalNotice from '@fluxora-legal/en/legal-notice.md?raw';
import dePrivacy from '@fluxora-legal/de/privacy.md?raw';
import deTerms from '@fluxora-legal/de/terms.md?raw';
import deNotices from '@fluxora-legal/de/third-party-notices.md?raw';
import deLegalNotice from '@fluxora-legal/de/legal-notice.md?raw';
import ruPrivacy from '@fluxora-legal/ru/privacy.md?raw';
import ruTerms from '@fluxora-legal/ru/terms.md?raw';
import ruNotices from '@fluxora-legal/ru/third-party-notices.md?raw';
import ruLegalNotice from '@fluxora-legal/ru/legal-notice.md?raw';

import type { InstallerLanguage } from '../../../installer/contracts';
import type { LegalDocumentKind } from '../../../installer/setup/setup-flow';

export interface LegalManifestEntry {
  language: InstallerLanguage;
  kind: LegalDocumentKind;
  path: string;
  sha256: string;
  title: string;
}

export interface LegalManifest {
  schemaVersion: 1;
  effectiveDate: string;
  fallbackLanguage: 'en';
  documents: LegalManifestEntry[];
}

export interface OfflineLegalDocument extends LegalManifestEntry {
  content: string;
}

export const legalDocumentKinds: readonly LegalDocumentKind[] = [
  'privacy',
  'terms',
  'third-party-notices',
  'legal-notice'
];

const sources: Record<InstallerLanguage, Record<LegalDocumentKind, string>> = {
  en: {
    privacy: enPrivacy,
    terms: enTerms,
    'third-party-notices': enNotices,
    'legal-notice': enLegalNotice
  },
  de: {
    privacy: dePrivacy,
    terms: deTerms,
    'third-party-notices': deNotices,
    'legal-notice': deLegalNotice
  },
  ru: {
    privacy: ruPrivacy,
    terms: ruTerms,
    'third-party-notices': ruNotices,
    'legal-notice': ruLegalNotice
  }
};

export const legalManifest = manifestJson as LegalManifest;

export function offlineLegalDocument(
  language: InstallerLanguage,
  kind: LegalDocumentKind
): OfflineLegalDocument {
  const entry = legalManifest.documents.find(
    (document) => document.language === language && document.kind === kind
  ) ?? legalManifest.documents.find(
    (document) => document.language === legalManifest.fallbackLanguage && document.kind === kind
  );
  if (!entry) {
    throw new Error(`Missing offline legal document manifest entry: ${language}/${kind}`);
  }
  return {
    ...entry,
    content: sources[entry.language][kind]
  };
}

export function legalLanguageFromAppLanguage(language: string | null | undefined): InstallerLanguage {
  const normalized = language?.toLowerCase() ?? '';
  if (normalized.startsWith('de')) {
    return 'de';
  }
  if (normalized.startsWith('ru')) {
    return 'ru';
  }
  return 'en';
}
