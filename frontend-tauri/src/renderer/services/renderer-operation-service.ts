import { translateForLanguage } from '../../localization';

export const createRendererOperationId = (scope: string): string => {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `op_${new Date().toISOString().replace(/[-:.TZ]/g, '')}_${scope}_${random}`;
};

const fallbackErrorMessage = (language?: string | null): string =>
  translateForLanguage(
    language ?? (typeof document === 'undefined' ? undefined : document.documentElement.lang),
    'common.operationFailed'
  );

const cleanErrorText = (value: unknown, language?: string | null): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/(?:\n|\r).*(?:\bat\s+|stack|stderr|stdout|traceback|exception)/i.test(trimmed)) {
    return trimmed.split(/\r?\n/)[0]?.trim() || fallbackErrorMessage(language);
  }

  return trimmed;
};

export const errorMessage = (error: unknown, language?: string | null): string => {
  if (error instanceof Error) {
    return cleanErrorText(error.message, language) ?? fallbackErrorMessage(language);
  }

  const directMessage = cleanErrorText(error, language);
  if (directMessage) {
    return directMessage;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return (
      cleanErrorText(record.message, language) ??
      cleanErrorText(record.error, language) ??
      cleanErrorText(record.detail, language) ??
      cleanErrorText(record.reason, language) ??
      fallbackErrorMessage(language)
    );
  }

  return fallbackErrorMessage(language);
};
