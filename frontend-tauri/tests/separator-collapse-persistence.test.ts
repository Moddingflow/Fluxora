import { describe, expect, it } from 'vitest';

import {
  loadCollapsedSeparatorOrderIds,
  saveCollapsedSeparatorOrderIds
} from '../src/renderer/separator-collapse-persistence';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
};

describe('separator collapse persistence', () => {
  it('keeps collapsed separators independent for each build and workspace', () => {
    const storage = createStorage();

    saveCollapsedSeparatorOrderIds(storage, 'skyrim-main', 'mods', new Set(['mod-separator']));
    saveCollapsedSeparatorOrderIds(storage, 'skyrim-main', 'plugins', new Set(['plugin-separator']));
    saveCollapsedSeparatorOrderIds(storage, 'fallout-main', 'mods', new Set(['fallout-separator']));

    expect([...loadCollapsedSeparatorOrderIds(storage, 'skyrim-main', 'mods')]).toEqual([
      'mod-separator'
    ]);
    expect([...loadCollapsedSeparatorOrderIds(storage, 'skyrim-main', 'plugins')]).toEqual([
      'plugin-separator'
    ]);
    expect([...loadCollapsedSeparatorOrderIds(storage, 'fallout-main', 'mods')]).toEqual([
      'fallout-separator'
    ]);
    expect([...loadCollapsedSeparatorOrderIds(storage, 'fallout-main', 'plugins')]).toEqual([]);
  });

  it('removes the saved value when every separator is expanded', () => {
    const storage = createStorage();

    saveCollapsedSeparatorOrderIds(storage, 'skyrim-main', 'mods', new Set(['mod-separator']));
    saveCollapsedSeparatorOrderIds(storage, 'skyrim-main', 'mods', new Set());

    expect([...loadCollapsedSeparatorOrderIds(storage, 'skyrim-main', 'mods')]).toEqual([]);
  });

  it('falls back to expanded separators when storage is malformed or unavailable', () => {
    const malformedStorage = createStorage();
    malformedStorage.setItem(
      'fluxora.ui.separator-collapse.v1:mods:skyrim-main',
      '{not-json'
    );
    const unavailableStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    };

    expect([...loadCollapsedSeparatorOrderIds(malformedStorage, 'skyrim-main', 'mods')]).toEqual(
      []
    );
    expect([...loadCollapsedSeparatorOrderIds(unavailableStorage, 'skyrim-main', 'mods')]).toEqual(
      []
    );
    expect(() =>
      saveCollapsedSeparatorOrderIds(
        unavailableStorage,
        'skyrim-main',
        'mods',
        new Set(['mod-separator'])
      )
    ).not.toThrow();
  });
});
