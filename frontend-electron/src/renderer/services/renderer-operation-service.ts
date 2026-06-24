export const createRendererOperationId = (scope: string): string => {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `op_${new Date().toISOString().replace(/[-:.TZ]/g, '')}_${scope}_${random}`;
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Operation failed.';
