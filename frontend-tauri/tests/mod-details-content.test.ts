import { describe, expect, it, vi } from 'vitest';
import type { FluxoraModDetailsContent } from '../src/shared/fluxora-api';
import {
  createModDetailsContentCache,
  modDetailsContentFileTree
} from '../src/renderer/features/mods/mod-details-content';

const content = (): FluxoraModDetailsContent => ({
  modPath: 'D:\\Build\\mods\\Sprint Fix',
  directories: [
    {
      relativePath: '',
      entries: [
        {
          name: 'SKSE',
          relativePath: 'SKSE',
          isDirectory: true,
          hasChildren: true,
          size: 0,
          conflictState: '',
          conflictOwners: []
        }
      ]
    },
    {
      relativePath: 'SKSE',
      entries: [
        {
          name: 'SprintFix.dll',
          relativePath: 'SKSE/SprintFix.dll',
          isDirectory: false,
          hasChildren: false,
          size: 128,
          conflictState: 'overwrites',
          conflictOwners: ['Sprint Fix', 'Old Sprint Fix']
        }
      ]
    }
  ],
  conflictTree: {
    modPath: 'D:\\Build\\mods\\Sprint Fix',
    totalOverwrites: 1,
    totalOverwritten: 0,
    limit: 1,
    nextCursor: null,
    overwrites: [],
    overwritten: []
  }
});

describe('mod details content', () => {
  it('materializes every directory before the properties window renders', () => {
    const tree = modDetailsContentFileTree(content());

    expect(tree['']).toHaveLength(1);
    expect(tree.SKSE?.[0]?.relativePath).toBe('SKSE/SprintFix.dll');
  });

  it('deduplicates an in-flight preload and retries after failures', async () => {
    const cache = createModDetailsContentCache();
    const loader = vi.fn(async () => content());

    const first = cache.load('project\nmod', loader);
    const second = cache.load('project\nmod', loader);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual(content());
    expect(loader).toHaveBeenCalledTimes(1);

    cache.clear();
    const retryLoader = vi
      .fn<() => Promise<FluxoraModDetailsContent>>()
      .mockRejectedValueOnce(new Error('temporary bridge failure'))
      .mockResolvedValueOnce(content());
    await expect(cache.load('project\nmod', retryLoader)).rejects.toThrow('temporary bridge failure');
    await expect(cache.load('project\nmod', retryLoader)).resolves.toEqual(content());
    expect(retryLoader).toHaveBeenCalledTimes(2);
  });

  it('keeps the preloaded snapshots bounded', async () => {
    const cache = createModDetailsContentCache(2);
    const loaders = [
      vi.fn(async () => content()),
      vi.fn(async () => content()),
      vi.fn(async () => content())
    ];

    await cache.load('first', loaders[0]);
    await cache.load('second', loaders[1]);
    await cache.load('third', loaders[2]);
    await cache.load('first', loaders[0]);

    expect(loaders[0]).toHaveBeenCalledTimes(2);
    expect(loaders[1]).toHaveBeenCalledTimes(1);
    expect(loaders[2]).toHaveBeenCalledTimes(1);
  });
});
