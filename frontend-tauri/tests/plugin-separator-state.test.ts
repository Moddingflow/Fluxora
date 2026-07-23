import { describe, expect, it } from 'vitest';

import {
  findCreatedPluginSeparatorOrderId,
  planPluginSeparatorCreation,
  reorderSelectedPluginsIntoSeparator
} from '../src/renderer/features/plugins/plugin-separator-state';
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

describe('plugin separator creation state', () => {
  it('plans the new separator before the first selected plugin and ignores selected separators', () => {
    const items = [
      plugin('plugin_skyrim', 'Skyrim.esm', 0, { isLocked: true }),
      separator('sep_ui', 'Interface', 1),
      plugin('plugin_skyui', 'SkyUI.esp', 2),
      separator('sep_late', 'Late patches', 3),
      plugin('plugin_patch', 'Patch.esp', 4)
    ];

    expect(
      planPluginSeparatorCreation(
        items,
        new Set(['sep_ui', 'plugin_skyui', 'plugin_patch']),
        'plugin_skyui'
      )
    ).toEqual({
      selectedPluginOrderIds: ['plugin_skyui', 'plugin_patch'],
      targetIndex: 2
    });
  });

  it('moves selected plugins from other groups under the new separator while preserving locked rows', () => {
    const createdItems = [
      separator('sep_official', 'Official content', 0),
      plugin('plugin_skyrim', 'Skyrim.esm', 1, { isLocked: true }),
      plugin('plugin_update', 'Update.esm', 2, { isLocked: true }),
      separator('sep_ui', 'Interface', 3),
      plugin('plugin_skyui', 'SkyUI.esp', 4),
      separator('sep_late', 'Late patches', 5),
      plugin('plugin_patch', 'Patch.esp', 6)
    ];

    const reordered = reorderSelectedPluginsIntoSeparator(
      createdItems,
      'sep_official',
      new Set(['plugin_skyrim', 'plugin_skyui', 'plugin_patch'])
    );

    expect(reordered?.map((item) => item.orderId)).toEqual([
      'sep_official',
      'plugin_skyrim',
      'plugin_update',
      'plugin_skyui',
      'plugin_patch',
      'sep_ui',
      'sep_late'
    ]);
    expect(reordered?.map((item) => item.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('identifies the separator added by the native create response', () => {
    const before = [
      plugin('plugin_skyrim', 'Skyrim.esm', 0),
      separator('sep_late', 'Late patches', 1)
    ];
    const after = [
      separator('sep_new', 'Official content', 0),
      plugin('plugin_skyrim', 'Skyrim.esm', 1),
      separator('sep_late', 'Late patches', 2)
    ];

    expect(findCreatedPluginSeparatorOrderId(before, after)).toBe('sep_new');
    expect(findCreatedPluginSeparatorOrderId(before, before)).toBeNull();
  });
});
