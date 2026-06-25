export const createRendererOperationId = (scope: string): string => {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `op_${new Date().toISOString().replace(/[-:.TZ]/g, '')}_${scope}_${random}`;
};

const fallbackErrorMessage = 'Operation failed.';

const cleanErrorText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return cleanErrorText(error.message) ?? fallbackErrorMessage;
  }

  const directMessage = cleanErrorText(error);
  if (directMessage) {
    return directMessage;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return (
      cleanErrorText(record.message) ??
      cleanErrorText(record.error) ??
      cleanErrorText(record.detail) ??
      cleanErrorText(record.reason) ??
      fallbackErrorMessage
    );
  }

  return fallbackErrorMessage;
};
