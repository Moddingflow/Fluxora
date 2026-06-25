import { describe, expect, it } from 'vitest';

import {
  emptyPluginWorkspaceState,
  filterPluginOrderItems,
  pluginCapabilityView,
  pluginHexIndex,
  pluginStatusText,
  pluginTypeLabel,
  pluginWorkspaceReducer,
  selectedPluginOrderItem,
  targetIndexForPluginMove
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
        state: 'available'
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
  });

  it('describes unsupported plugin capabilities without calling the bridge domain path', () => {
    const supported = pluginCapabilityView(
      project({ supportsPlugins: true, supportsLoadOrder: true }),
      readyBridge
    );
    expect(supported.projectSupported).toBe(true);
    expect(supported.loadOrderSupported).toBe(true);

    const unsupported = pluginCapabilityView(
      project({ supportsPlugins: false, supportsLoadOrder: false }),
      readyBridge
    );
    expect(unsupported.projectSupported).toBe(false);
    expect(unsupported.reason).toContain('does not support plugins');
  });
});
