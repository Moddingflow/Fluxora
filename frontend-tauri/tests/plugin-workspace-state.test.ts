import { describe, expect, it } from 'vitest';

import {
  canDragPluginOrderItem,
  emptyPluginWorkspaceState,
  filterPluginOrderItems,
  isPluginNestedUnderSeparator,
  mergePendingPluginEnabledStates,
  pluginCapabilityView,
  pluginHexIndex,
  pluginSeparatorChildCount,
  pluginSourceLabel,
  pluginStatusText,
  pluginTypeLabel,
  pluginWorkspaceReducer,
  reorderPluginOrderItems,
  selectedPluginOrderItem,
  targetIndexForPluginDrop,
  targetIndexForPluginMove,
  visiblePluginOrderItems
} from '../src/renderer/plugin-workspace-state';
import type {
  FluxoraPluginOrderItem,
  FluxoraProject,
  NativeBridgeStatus
} from '../src/shared/fluxora-api';

const pluginItem = (
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
  sourceMod: 'SkyUI',
  isEnabled: true,
  isMaster: false,
  isLight: false,
  isLocked: false,
  lockReason: '',
  missingMasters: [],
  ...extra
});

const separatorItem = (
  orderId: string,
  title: string,
  order: number
): FluxoraPluginOrderItem =>
  pluginItem(orderId, title, order, {
    id: orderId,
    kind: 'separator',
    isSeparator: true,
    isPlugin: false,
    separatorTitle: title,
    name: '',
    extension: '',
    sourceMod: '',
    isEnabled: true
  });

const items: FluxoraPluginOrderItem[] = [
  pluginItem('plugin_skyrim', 'Skyrim.esm', 0, {
    sourceMod: 'Skyrim Special Edition',
    isMaster: true,
    isLocked: true,
    lockReason: 'Base game plugin'
  }),
  separatorItem('sep_patches', 'Late patches', 1),
  pluginItem('plugin_skyui', 'SkyUI.esp', 2, {
    missingMasters: ['Update.esm']
  }),
  pluginItem('plugin_light', 'TinyPatch.esl', 3, {
    isLight: true,
    isEnabled: false,
    sourceMod: 'Tiny Patch'
  })
];

const readyBridge: NativeBridgeStatus = {
  ready: true,
  operationId: 'op_test',
  capabilities: {
    platform: 'win32',
    arch: 'x64',
    core: {
      available: true,
      libraryName: 'FluxoraCore.dll'
    },
    features: {
      plugins: {
        state: 'available',
        supports: [
          'list',
          'move',
          'createSeparator',
          'deleteSeparator',
          'setEnabled',
          'setAllEnabled'
        ]
      }
    }
  },
  logs: {
    uiLogPath: '',
    mainBridgeLogPath: ''
  }
};

const project = (capabilities: FluxoraProject['gameCapabilities']): FluxoraProject => ({
  id: 'build',
  name: 'Build',
  templateId: 'skyrimse',
  uiTemplateId: 'skyrimse',
  gameName: 'Skyrim Special Edition',
  gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
  installRootDirectory: 'C:\\Builds',
  projectDirectory: 'C:\\Builds\\Skyrim',
  configPath: 'C:\\Builds\\Skyrim.json',
  gameCapabilities: capabilities
});

describe('plugin workspace state', () => {
  it('filters plugin order rows by plugin, separator and source terms', () => {
    expect(filterPluginOrderItems(items, 'skyui')).toEqual([items[2]]);
    expect(filterPluginOrderItems(items, 'late')).toEqual([items[1]]);
    expect(filterPluginOrderItems(items, 'base game')).toEqual([items[0]]);
    expect(filterPluginOrderItems(items, '')).toEqual(items);
  });

  it('keeps selection stable and calculates move targets', () => {
    const loaded = pluginWorkspaceReducer(
      { ...emptyPluginWorkspaceState(), selectedOrderId: 'plugin_light' },
      { type: 'items-loaded', items }
    );

    expect(loaded.selectedOrderId).toBe('plugin_light');
    expect(selectedPluginOrderItem(items, 'missing')?.orderId).toBe('plugin_skyrim');
    expect(targetIndexForPluginMove(items, 'plugin_skyui', -1)).toBe(1);
    expect(targetIndexForPluginMove(items, 'plugin_skyui', 1)).toBe(3);
    expect(targetIndexForPluginMove(items, 'plugin_skyrim', -1)).toBeNull();
    expect(canDragPluginOrderItem(items, 'plugin_skyrim')).toBe(false);
    expect(canDragPluginOrderItem(items, 'plugin_skyui')).toBe(true);
    expect(targetIndexForPluginDrop(items, 'plugin_skyui', 'plugin_skyrim', 'before')).toBeNull();
    expect(targetIndexForPluginDrop(items, 'plugin_skyui', 'plugin_skyrim', 'after')).toBe(1);
    expect(targetIndexForPluginDrop(items, 'plugin_light', 'plugin_skyui', 'before')).toBe(2);
    expect(targetIndexForPluginDrop(items, 'plugin_skyui', 'plugin_light', 'before')).toBeNull();
  });

  it('blocks dragging separators that include locked plugins', () => {
    const lockedGroup = [
      separatorItem('sep_base', 'Base game', 0),
      pluginItem('plugin_skyrim', 'Skyrim.esm', 1, {
        sourceMod: 'Skyrim Special Edition',
        isMaster: true,
        isLocked: true,
        lockReason: 'Base game plugin'
      }),
      separatorItem('sep_patches', 'Late patches', 2),
      pluginItem('plugin_skyui', 'SkyUI.esp', 3)
    ];

    expect(canDragPluginOrderItem(lockedGroup, 'sep_base')).toBe(false);
    expect(targetIndexForPluginDrop(lockedGroup, 'sep_base', 'plugin_skyui', 'after')).toBeNull();
  });

  it('hides collapsed plugin separator children but moves the separator as a block', () => {
    const groupedItems = [
      items[0],
      separatorItem('sep_ui', 'Interface', 1),
      pluginItem('plugin_skyui', 'SkyUI.esp', 2),
      pluginItem('plugin_light', 'TinyPatch.esl', 3, { isLight: true }),
      separatorItem('sep_late', 'Late patches', 4),
      pluginItem('plugin_patch', 'Patch.esp', 5)
    ];
    const collapsed = new Set(['sep_ui']);

    expect(visiblePluginOrderItems(groupedItems, '', collapsed).map((item) => item.orderId)).toEqual([
      'plugin_skyrim',
      'sep_ui',
      'sep_late',
      'plugin_patch'
    ]);
    expect(visiblePluginOrderItems(groupedItems, 'SkyUI.esp', collapsed).map((item) => item.orderId)).toEqual([
      'plugin_skyui'
    ]);
    expect(targetIndexForPluginDrop(groupedItems, 'plugin_patch', 'sep_ui', 'after', collapsed)).toBe(4);
    expect(targetIndexForPluginDrop(groupedItems, 'sep_ui', 'sep_late', 'after')).toBe(5);
    expect(targetIndexForPluginMove(groupedItems, 'sep_ui', 1, collapsed)).toBe(5);

    const reordered = reorderPluginOrderItems(groupedItems, 'sep_ui', 5);
    expect(reordered?.map((item) => item.orderId)).toEqual([
      'plugin_skyrim',
      'sep_late',
      'plugin_patch',
      'sep_ui',
      'plugin_skyui',
      'plugin_light'
    ]);
    expect(pluginSeparatorChildCount(groupedItems, 'sep_ui')).toBe(2);
    expect(isPluginNestedUnderSeparator(groupedItems, 'plugin_skyui')).toBe(true);
  });

  it('stores collapsed plugin separator state in the reducer', () => {
    const loaded = pluginWorkspaceReducer(
      { ...emptyPluginWorkspaceState(), selectedOrderId: 'plugin_skyui' },
      { type: 'items-loaded', items }
    );
    const collapsed = pluginWorkspaceReducer(loaded, {
      type: 'separator-collapse-toggled',
      orderId: 'sep_patches'
    });

    expect(collapsed.collapsedSeparatorOrderIds.has('sep_patches')).toBe(true);
    expect(collapsed.selectedOrderId).toBe('sep_patches');
    expect(visiblePluginOrderItems(collapsed.items, '', collapsed.collapsedSeparatorOrderIds).map((item) => item.orderId)).toEqual([
      'plugin_skyrim',
      'sep_patches'
    ]);

    const moved = pluginWorkspaceReducer(collapsed, {
      type: 'items-reordered',
      orderId: 'sep_patches',
      targetIndex: 1
    });
    expect(moved.items.map((item) => item.orderId)).toEqual(items.map((item) => item.orderId));
    expect(moved.collapsedSeparatorOrderIds.has('sep_patches')).toBe(true);
  });

  it('applies optimistic plugin enabled state without changing selection or collapsed separators', () => {
    const loaded = pluginWorkspaceReducer(
      { ...emptyPluginWorkspaceState(), selectedOrderId: 'plugin_light' },
      { type: 'items-loaded', items }
    );
    const collapsed = pluginWorkspaceReducer(loaded, {
      type: 'separator-collapse-toggled',
      orderId: 'sep_patches'
    });
    const enabled = pluginWorkspaceReducer(collapsed, {
      type: 'item-enabled-set',
      orderId: 'plugin_light',
      isEnabled: true
    });

    expect(enabled.items.map((item) => item.orderId)).toEqual(items.map((item) => item.orderId));
    expect(enabled.items.find((item) => item.orderId === 'plugin_light')?.isEnabled).toBe(true);
    expect(enabled.selectedOrderId).toBe('sep_patches');
    expect(enabled.collapsedSeparatorOrderIds.has('sep_patches')).toBe(true);
  });

  it('applies bulk plugin enable state only to unlocked plugins', () => {
    const loaded = pluginWorkspaceReducer(
      { ...emptyPluginWorkspaceState(), selectedOrderId: 'plugin_light' },
      { type: 'items-loaded', items }
    );

    const disabled = pluginWorkspaceReducer(loaded, {
      type: 'unlocked-items-enabled-set',
      isEnabled: false
    });

    expect(disabled.items.find((item) => item.orderId === 'plugin_skyrim')?.isEnabled).toBe(true);
    expect(disabled.items.find((item) => item.orderId === 'sep_patches')?.isEnabled).toBe(true);
    expect(disabled.items.find((item) => item.orderId === 'plugin_skyui')?.isEnabled).toBe(false);
    expect(disabled.items.find((item) => item.orderId === 'plugin_light')?.isEnabled).toBe(false);
    expect(disabled.selectedOrderId).toBe('plugin_light');
  });

  it('keeps pending plugin enabled states over stale confirmed snapshots', () => {
    const staleSnapshot = items.map((item) =>
      item.orderId === 'plugin_light' || item.orderId === 'plugin_skyui'
        ? { ...item, isEnabled: false }
        : item
    );

    const merged = mergePendingPluginEnabledStates(
      staleSnapshot,
      new Map([
        ['plugin_light', { isEnabled: true }]
      ])
    );

    expect(merged.find((item) => item.orderId === 'plugin_light')?.isEnabled).toBe(true);
    expect(merged.find((item) => item.orderId === 'plugin_skyui')?.isEnabled).toBe(false);
    expect(merged.find((item) => item.orderId === 'sep_patches')?.isEnabled).toBe(true);
  });

  it('formats plugin status and type for dense rows', () => {
    expect(pluginHexIndex(items[0])).toBe('00');
    expect(pluginHexIndex(items[1])).toBe('--');
    expect(pluginHexIndex(items[3])).toBe('03');
    expect(pluginStatusText(items[0])).toBe('Locked');
    expect(pluginStatusText(items[2])).toBe('Missing masters');
    expect(pluginStatusText(items[3])).toBe('Disabled');
    expect(pluginTypeLabel(items[0])).toBe('master');
    expect(pluginTypeLabel(items[3])).toBe('light');
    expect(pluginSourceLabel(items[2])).toBe('SkyUI');
    expect(
      pluginSourceLabel(pluginItem('plugin_game_data', 'Loose.esp', 4, { sourceMod: '' }))
    ).toBe('game data');
  });

  it('describes unsupported plugin capabilities without calling the bridge domain path', () => {
    const supported = pluginCapabilityView(
      project({ supportsPlugins: true, supportsLoadOrder: true }),
      readyBridge
    );
    expect(supported.projectSupported).toBe(true);
    expect(supported.loadOrderSupported).toBe(true);
    expect(supported.bulkToggleSupported).toBe(true);
    expect(supported.nativeBulkToggleSupported).toBe(true);

    const unsupported = pluginCapabilityView(
      project({ supportsPlugins: false, supportsLoadOrder: false }),
      readyBridge
    );
    expect(unsupported.projectSupported).toBe(false);
    expect(unsupported.reason).toContain('does not support plugins');
  });

  it('keeps plugin bulk toggles available through single-plugin fallback when an older bridge lacks native bulk support', () => {
    const bridgeWithoutBulkToggle: NativeBridgeStatus = {
      ...readyBridge,
      capabilities: {
        ...readyBridge.capabilities!,
        features: {
          ...readyBridge.capabilities!.features,
          plugins: {
            state: 'available',
            supports: ['list', 'setEnabled']
          }
        }
      }
    };

    const capabilities = pluginCapabilityView(
      project({ supportsPlugins: true, supportsLoadOrder: true }),
      bridgeWithoutBulkToggle
    );

    expect(capabilities.bridgeAvailable).toBe(true);
    expect(capabilities.projectSupported).toBe(true);
    expect(capabilities.bulkToggleSupported).toBe(true);
    expect(capabilities.nativeBulkToggleSupported).toBe(false);
  });

  it('accepts domain-qualified plugin capability method names', () => {
    const bridgeWithDomainQualifiedMethods: NativeBridgeStatus = {
      ...readyBridge,
      capabilities: {
        ...readyBridge.capabilities!,
        features: {
          ...readyBridge.capabilities!.features,
          plugins: {
            state: 'available',
            supports: [
              'plugins.list',
              'plugins.move',
              'plugins.createSeparator',
              'plugins.deleteSeparator',
              'plugins.setEnabled',
              'plugins.setAllEnabled'
            ]
          }
        }
      }
    };

    const capabilities = pluginCapabilityView(
      project({ supportsPlugins: true, supportsLoadOrder: true }),
      bridgeWithDomainQualifiedMethods
    );

    expect(capabilities.bridgeAvailable).toBe(true);
    expect(capabilities.bulkToggleSupported).toBe(true);
    expect(capabilities.nativeBulkToggleSupported).toBe(true);
  });
});
