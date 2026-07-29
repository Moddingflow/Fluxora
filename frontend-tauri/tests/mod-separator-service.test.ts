import { describe, expect, it, vi } from 'vitest';

import { createModSeparatorAtEnd } from '../src/renderer/features/mods/mod-separator-service';
import type { FluxoraModOrderItem } from '../src/shared/fluxora-api';

const mod = (orderId: string, name: string, order: number): FluxoraModOrderItem => ({
  id: `C:\\Builds\\Skyrim\\mods\\${name}`,
  orderId,
  kind: 'mod',
  order,
  isSeparator: false,
  isMod: true,
  modUuid: orderId,
  separatorTitle: '',
  name,
  version: '1.0.0',
  latestVersion: '',
  latestFileId: '',
  updateCheckState: '',
  lastCheckedAt: '',
  updateStatus: '',
  conflictStatus: '',
  fileCount: 1,
  conflictingFileCount: 0,
  overwrittenFileCount: 0,
  overwritingFileCount: 0,
  isEnabled: true,
  canCheckUpdates: false,
  hasUpdate: false,
  sourceIsNexus: false,
  sourceIsModdingFlow: false,
  isLocal: true,
  isTranslation: false,
  isPatch: false,
  overwritesModIds: [],
  overwrittenByModIds: []
});

const separator = (orderId: string, title: string, order: number): FluxoraModOrderItem => ({
  ...mod(orderId, title, order),
  id: orderId,
  kind: 'separator',
  isSeparator: true,
  isMod: false,
  modUuid: '',
  separatorTitle: title,
  version: '',
  fileCount: 0
});

describe('mod separator service', () => {
  it('uses the native append target and returns the new empty separator at the end', async () => {
    const before = [
      separator('sep_existing', 'Existing Group', 0),
      mod('mod_first', 'First Mod', 1),
      mod('mod_last', 'Last Mod', 2)
    ];
    const after = [...before, separator('sep_new', 'New Empty Group', 3)];
    const createSeparator = vi.fn(async () => after);

    const result = await createModSeparatorAtEnd({
      createSeparator,
      items: before,
      title: 'New Empty Group'
    });

    expect(createSeparator).toHaveBeenCalledWith('New Empty Group', -1);
    expect(result).toEqual({
      items: after,
      separatorOrderId: 'sep_new'
    });
  });

  it('rejects a native response that did not append the created separator', async () => {
    const before = [mod('mod_last', 'Last Mod', 0)];
    const after = [
      separator('sep_new', 'New Empty Group', 0),
      mod('mod_last', 'Last Mod', 1)
    ];

    await expect(
      createModSeparatorAtEnd({
        createSeparator: async () => after,
        items: before,
        title: 'New Empty Group'
      })
    ).rejects.toThrow('at the end');
  });
});
