import { describe, expect, it } from 'vitest';

import { createPluginSeparatorForSelection } from '../src/renderer/features/plugins/plugin-separator-service';
import type { FluxoraPluginOrderItem } from '../src/shared/fluxora-api';

const plugin = (
  orderId: string,
  name: string,
  order: number,
  extra: Partial<FluxoraPluginOrderItem> = {}
): FluxoraPluginOrderItem => ({
  id: name,
  orderId,
  kind: 'plugin',
  order,
  isSeparator: false,
  isPlugin: true,
  name,
  separatorTitle: '',
  extension: name.split('.').at(-1)?.toUpperCase() ?? '',
  sourceMod: 'Fixture',
  isEnabled: true,
  isMaster: false,
  isLight: false,
  hasLightFlag: false,
  isLocked: false,
  lockReason: '',
  masterFiles: [],
  missingMasters: [],
  ...extra
});

const separator = (
  orderId: string,
  title: string,
  order: number
): FluxoraPluginOrderItem =>
  plugin(orderId, title, order, {
    id: orderId,
    kind: 'separator',
    isSeparator: true,
    isPlugin: false,
    name: '',
    separatorTitle: title,
    extension: '',
    sourceMod: ''
  });

const reindex = (items: FluxoraPluginOrderItem[]): FluxoraPluginOrderItem[] =>
  items.map((item, order) => ({ ...item, order }));

describe('plugin separator service', () => {
  it('creates a separator and persists selected plugins from different groups beneath it', async () => {
    let items = [
      plugin('plugin_skyrim', 'Skyrim.esm', 0, { isLocked: true }),
      separator('sep_ui', 'Interface', 1),
      plugin('plugin_skyui', 'SkyUI.esp', 2),
      separator('sep_late', 'Late patches', 3),
      plugin('plugin_patch', 'Patch.esp', 4)
    ];
    const calls: Array<{ method: string; orderId?: string; targetIndex?: number }> = [];

    const result = await createPluginSeparatorForSelection({
      api: {
        createSeparator: async (_title, targetIndex) => {
          calls.push({ method: 'create', targetIndex });
          items = reindex([
            ...items.slice(0, targetIndex),
            separator('sep_new', 'Official content', targetIndex),
            ...items.slice(targetIndex)
          ]);
          return items;
        },
        deleteSeparator: async (orderId) => {
          calls.push({ method: 'delete', orderId });
          items = reindex(items.filter((item) => item.orderId !== orderId));
          return items;
        },
        move: async (orderId, targetIndex) => {
          calls.push({ method: 'move', orderId, targetIndex });
          const sourceIndex = items.findIndex((item) => item.orderId === orderId);
          const [moving] = items.splice(sourceIndex, 1);
          items.splice(targetIndex, 0, moving!);
          items = reindex(items);
          return items;
        }
      },
      contextOrderId: 'plugin_skyrim',
      items,
      selectedOrderIds: new Set([
        'plugin_skyrim',
        'plugin_skyui',
        'plugin_patch'
      ]),
      title: 'Official content'
    });

    expect(result.separatorOrderId).toBe('sep_new');
    expect(result.items.map((item) => item.orderId)).toEqual([
      'sep_new',
      'plugin_skyrim',
      'plugin_skyui',
      'plugin_patch',
      'sep_ui',
      'sep_late'
    ]);
    expect(calls).toEqual([
      { method: 'create', targetIndex: 0 },
      { method: 'move', orderId: 'plugin_skyui', targetIndex: 2 },
      { method: 'move', orderId: 'plugin_patch', targetIndex: 3 }
    ]);
  });

  it('removes the new separator and restores the prior order when a selected move fails', async () => {
    const originalItems = [
      plugin('plugin_skyrim', 'Skyrim.esm', 0, { isLocked: true }),
      separator('sep_ui', 'Interface', 1),
      plugin('plugin_skyui', 'SkyUI.esp', 2),
      separator('sep_late', 'Late patches', 3),
      plugin('plugin_patch', 'Patch.esp', 4)
    ];
    let items = structuredClone(originalItems);
    let shouldFailPatchMove = true;
    const calls: Array<{ method: string; orderId?: string; targetIndex?: number }> = [];

    await expect(
      createPluginSeparatorForSelection({
        api: {
          createSeparator: async (_title, targetIndex) => {
            calls.push({ method: 'create', targetIndex });
            items = reindex([
              ...items.slice(0, targetIndex),
              separator('sep_new', 'Official content', targetIndex),
              ...items.slice(targetIndex)
            ]);
            return items;
          },
          deleteSeparator: async (orderId) => {
            calls.push({ method: 'delete', orderId });
            items = reindex(items.filter((item) => item.orderId !== orderId));
            return items;
          },
          move: async (orderId, targetIndex) => {
            calls.push({ method: 'move', orderId, targetIndex });
            if (orderId === 'plugin_patch' && shouldFailPatchMove) {
              shouldFailPatchMove = false;
              throw new Error('Injected move failure');
            }
            const sourceIndex = items.findIndex((item) => item.orderId === orderId);
            const [moving] = items.splice(sourceIndex, 1);
            items.splice(targetIndex, 0, moving!);
            items = reindex(items);
            return items;
          }
        },
        contextOrderId: 'plugin_skyrim',
        items: originalItems,
        selectedOrderIds: new Set([
          'plugin_skyrim',
          'plugin_skyui',
          'plugin_patch'
        ]),
        title: 'Official content'
      })
    ).rejects.toThrow('Injected move failure');

    expect(items.map((item) => item.orderId)).toEqual(
      originalItems.map((item) => item.orderId)
    );
    expect(calls).toEqual([
      { method: 'create', targetIndex: 0 },
      { method: 'move', orderId: 'plugin_skyui', targetIndex: 2 },
      { method: 'move', orderId: 'plugin_patch', targetIndex: 3 },
      { method: 'delete', orderId: 'sep_new' },
      { method: 'move', orderId: 'plugin_skyui', targetIndex: 2 }
    ]);
  });
});
