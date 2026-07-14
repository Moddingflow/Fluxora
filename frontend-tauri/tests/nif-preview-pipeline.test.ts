import { describe, expect, it } from 'vitest';

import {
  deduplicateNifPreviewPaths,
  isCurrentNifPreviewGeneration,
  mapNifPreviewWithConcurrency,
  nextNifPreviewGeneration
} from '../src/renderer/features/file-preview/nif-preview-pipeline';

describe('NIF preview progressive pipeline', () => {
  it('deduplicates one texture batch case-insensitively while preserving request order', () => {
    expect(deduplicateNifPreviewPaths([
      'textures/armor/cuirass.dds',
      'TEXTURES\\ARMOR\\CUIRASS.DDS',
      ' textures/armor/gauntlets.dds ',
      ''
    ])).toEqual([
      'textures/armor/cuirass.dds',
      'textures/armor/gauntlets.dds'
    ]);
  });

  it('never starts more than three raw texture reads concurrently', async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const run = mapNifPreviewWithConcurrency([0, 1, 2, 3, 4, 5], 3, async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    });

    await Promise.resolve();
    expect(active).toBe(3);
    releases.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(3);
    while (releases.length) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    await run;

    expect(maximum).toBe(3);
  });

  it('invalidates stale parse and texture replies when the preview generation changes', () => {
    const generation = { current: 0 };
    const first = nextNifPreviewGeneration(generation);
    expect(isCurrentNifPreviewGeneration(generation, first)).toBe(true);

    const replacement = nextNifPreviewGeneration(generation);

    expect(isCurrentNifPreviewGeneration(generation, first)).toBe(false);
    expect(isCurrentNifPreviewGeneration(generation, replacement)).toBe(true);
  });
});
