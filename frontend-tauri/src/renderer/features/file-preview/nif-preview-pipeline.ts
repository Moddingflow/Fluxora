export interface NifPreviewGenerationRef {
  current: number;
}

const previewPathKey = (value: string): string =>
  value.trim().replace(/\\/g, '/').toLowerCase();

export const deduplicateNifPreviewPaths = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const key = previewPathKey(trimmed);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(trimmed);
  });
  return result;
};

export const nextNifPreviewGeneration = (generation: NifPreviewGenerationRef): number => {
  generation.current += 1;
  return generation.current;
};

export const isCurrentNifPreviewGeneration = (
  generation: NifPreviewGenerationRef,
  candidate: number
): boolean => generation.current === candidate;

export const mapNifPreviewWithConcurrency = async <T,>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> => {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await task(items[index]);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    worker
  ));
};
