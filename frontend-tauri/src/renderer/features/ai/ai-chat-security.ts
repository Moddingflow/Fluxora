export const AI_CONTEXT_SOURCE_URL_PREFIX = 'fluxora://ai/context-source/';

export const AI_SAFE_EXTERNAL_LINK_REL = 'noopener noreferrer';

export const AI_CHAT_MARKDOWN_POLICY = {
  rawHtml: 'disabled',
  renderer: 'react-text',
  externalLinks: 'validated-button-open',
  targetBlankRel: AI_SAFE_EXTERNAL_LINK_REL
} as const;

const BIDI_CONTROL_CHARACTERS = /[\u202a-\u202e\u2066-\u2069]/g;

export const sanitizeAiChatText = (value: string): string =>
  value.replace(/\0/g, '').replace(BIDI_CONTROL_CHARACTERS, '');

export const isAiContextSourceUrl = (url: string): boolean =>
  url.trim().startsWith(AI_CONTEXT_SOURCE_URL_PREFIX);

export const safeAiExternalUrl = (url: string): string | null => {
  const trimmed = url.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
};

export const safeAiSourceUrl = (url: string): string | null => {
  const trimmed = url.trim();
  if (isAiContextSourceUrl(trimmed)) {
    return trimmed;
  }

  return safeAiExternalUrl(trimmed);
};
