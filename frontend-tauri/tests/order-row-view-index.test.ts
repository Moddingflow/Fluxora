import { describe, expect, it } from 'vitest';

import {
  buildModRowViewIndex,
  buildPluginRowViewIndex,
  modOrderItemPresentationKey,
  pluginOrderItemPresentationKey
} from '../src/renderer/features/lists/order-row-view-index';
import type {
  FluxoraModOrderItem,
  FluxoraModUpdateCheckResult,
  FluxoraPluginOrderItem
} from '../src/shared/fluxora-api';

const modItem = (
  orderId: string,
  name: string,
  order: number,
  extra: Partial<FluxoraModOrderItem> = {}
): FluxoraModOrderItem => ({
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
  fileCount: 12,
  conflictingFileCount: 0,
  overwrittenFileCount: 0,
  overwritingFileCount: 0,
  isEnabled: true,
  canCheckUpdates: true,
  hasUpdate: false,
  sourceIsNexus: true,
  sourceIsModdingFlow: false,
  isLocal: false,
  isTranslation: false,
  isPatch: false,
  overwritesModIds: [],
  overwrittenByModIds: [],
  ...extra
});

const modSeparator = (
  orderId: string,
  title: string,
  order: number
): FluxoraModOrderItem =>
  modItem(orderId, title, order, {
    id: orderId,
    kind: 'separator',
    isSeparator: true,
    isMod: false,
    modUuid: '',
    separatorTitle: title,
    fileCount: 0,
    canCheckUpdates: false,
    sourceIsNexus: false
  });

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
  hasLightFlag: false,
  isLocked: false,
  lockReason: '',
  masterFiles: [],
  missingMasters: [],
  ...extra
});

const pluginSeparator = (
  orderId: string,
  title: string,
  order: number
): FluxoraPluginOrderItem =>
  pluginItem(orderId, title, order, {
    id: orderId,
    kind: 'separator',
    isSeparator: true,
    isPlugin: false,
    name: '',
    separatorTitle: title,
    extension: '',
    sourceMod: ''
  });

const updateResult = (
  folderName: string,
  updateCheckState: string
): FluxoraModUpdateCheckResult => ({
  state: 'completed',
  reason: 'none',
  nextEligibleAt: '',
  quota: {
    dailyLimit: 0,
    dailyRemaining: 0,
    hourlyLimit: 0,
    hourlyRemaining: 0,
    dailyResetAt: '',
    hourlyResetAt: '',
    capturedAt: ''
  },
  counters: {
    apiRequests: 1,
    checked: 1,
    cacheHits: 0,
    updates: 0,
    ambiguous: 0,
    failed: 0
  },
  mods: [{
    folderName,
    latestVersion: '2.0.0',
    latestFileId: '2',
    updateCheckState,
    hasUpdate: true
  }]
});

describe('order row view indexes', () => {
  it('keeps presentation keys stable across semantically identical native clones', () => {
    const mod = modItem('mod-clone', 'Clone', 4);
    const plugin = pluginItem('plugin-clone', 'Clone.esp', 4);

    expect(modOrderItemPresentationKey({ ...mod }))
      .toBe(modOrderItemPresentationKey(mod));
    expect(pluginOrderItemPresentationKey({ ...plugin }))
      .toBe(pluginOrderItemPresentationKey(plugin));
    expect(modOrderItemPresentationKey({ ...mod, version: '2.0.0' }))
      .not.toBe(modOrderItemPresentationKey(mod));
    expect(pluginOrderItemPresentationKey({ ...plugin, isEnabled: false }))
      .not.toBe(pluginOrderItemPresentationKey(plugin));
  });

  it('treats omitted legacy mod conflict references as empty arrays', () => {
    const legacy = {
      ...modItem('legacy-mod', 'Legacy mod', 0)
    } as Partial<FluxoraModOrderItem>;
    delete legacy.overwritesModIds;
    delete legacy.overwrittenByModIds;
    const legacyItem = legacy as FluxoraModOrderItem;

    expect(modOrderItemPresentationKey(legacyItem))
      .toBe(modOrderItemPresentationKey({
        ...legacyItem,
        overwritesModIds: [],
        overwrittenByModIds: []
      }));

    const first = buildModRowViewIndex([legacyItem], {
      selectedItem: legacyItem,
      collapsedSeparatorOrderIds: new Set()
    });
    const second = buildModRowViewIndex(
      [{ ...legacyItem }],
      {
        selectedItem: { ...legacyItem },
        collapsedSeparatorOrderIds: new Set()
      },
      first
    );

    expect(second.byOrderId.get('legacy-mod')).toBe(first.byOrderId.get('legacy-mod'));
  });

  it('builds mod nesting, priorities, separator counts, conflicts, and update lookup once', () => {
    const selected = modItem('selected', 'Selected', 0, {
      overwritesModIds: ['CHILD-A'],
      overwrittenByModIds: ['child-b']
    });
    const separator = modSeparator('separator', 'Visuals', 1);
    const childA = modItem('child-a', 'Child A', 2, {
      overwrittenFileCount: 2
    });
    const childB = modItem('child-b', 'Child B', 3, {
      overwritingFileCount: 3
    });
    const outside = modItem('outside', 'Outside', 4);
    const items = [selected, outside, separator, childA, childB];

    const index = buildModRowViewIndex(items, {
      selectedItem: selected,
      collapsedSeparatorOrderIds: new Set(['separator']),
      updateResult: updateResult(' child a ', 'baseline_pending')
    });

    expect(index.rows).toHaveLength(items.length);
    expect(index.byOrderId.get('child-a')).toMatchObject({
      isNested: true,
      parentSeparatorOrderId: 'separator',
      priority: 3,
      conflictHighlight: 'overwrites',
      updateCheckState: 'baseline_pending'
    });
    expect(index.byOrderId.get('outside')).toMatchObject({
      isNested: false,
      parentSeparatorOrderId: null,
      priority: 2
    });
    expect(index.byOrderId.get('separator')).toMatchObject({
      separatorChildCount: 2,
      conflictHighlight: 'overwritten',
      visibleConflictHighlight: 'overwritten',
      visibleConflictMarkerStates: ['overwritten']
    });
  });

  it('aggregates plugin missing masters for collapsed separators and keeps expanded summaries empty', () => {
    const separator = pluginSeparator('separator', 'Patches', 0);
    const first = pluginItem('first', 'First.esp', 1, {
      masterFiles: ['Required.esm', 'Shared.esm']
    });
    const second = pluginItem('second', 'Second.esp', 2, {
      masterFiles: ['shared.esm', 'Other.esm']
    });
    const items = [separator, first, second];
    const missingMasterContext = {
      enabledPluginNameKeys: new Set<string>(),
      disabledSourceModNameKeys: new Set<string>()
    };

    const collapsed = buildPluginRowViewIndex(items, {
      collapsedSeparatorOrderIds: new Set(['separator']),
      missingMasterContext,
      missingMasterLimit: 2
    });
    const expanded = buildPluginRowViewIndex(items, {
      collapsedSeparatorOrderIds: new Set(),
      missingMasterContext,
      missingMasterLimit: 2
    });

    expect(collapsed.byOrderId.get('separator')).toMatchObject({
      separatorChildCount: 2,
      missingMasterSummary: {
        totalCount: 3,
        hiddenCount: 1
      }
    });
    expect(collapsed.byOrderId.get('separator')?.missingMasterSummary.visibleMasters)
      .toEqual(['Other.esm', 'Required.esm']);
    expect(expanded.byOrderId.get('separator')?.missingMasterSummary.totalCount).toBe(0);
    expect(collapsed.byOrderId.get('first')).toMatchObject({
      isNested: true,
      parentSeparatorOrderId: 'separator'
    });
  });

  it('preserves view identity for unchanged rows after one item changes', () => {
    const items = Array.from({ length: 5_000 }, (_, index) =>
      modItem(`mod-${index}`, `Mod ${index}`, index)
    );
    const first = buildModRowViewIndex(items, {
      selectedItem: null,
      collapsedSeparatorOrderIds: new Set()
    });
    const nextItems = items.slice();
    nextItems[2_500] = {
      ...nextItems[2_500]!,
      version: '2.0.0'
    };
    const second = buildModRowViewIndex(
      nextItems,
      {
        selectedItem: null,
        collapsedSeparatorOrderIds: new Set()
      },
      first
    );

    expect(second.byOrderId.get('mod-0')).toBe(first.byOrderId.get('mod-0'));
    expect(second.byOrderId.get('mod-2499')).toBe(first.byOrderId.get('mod-2499'));
    expect(second.byOrderId.get('mod-2500')).not.toBe(first.byOrderId.get('mod-2500'));
    expect(second.byOrderId.get('mod-2501')).toBe(first.byOrderId.get('mod-2501'));
    expect(second.byOrderId.get('mod-4999')).toBe(first.byOrderId.get('mod-4999'));
  });

  it('invalidates localized row derivations when the language changes', () => {
    const item = modItem('localized-mod', 'Localized mod', 0);
    const english = buildModRowViewIndex([item], {
      language: 'en-US',
      selectedItem: null,
      collapsedSeparatorOrderIds: new Set()
    });
    const russian = buildModRowViewIndex(
      [{ ...item }],
      {
        language: 'ru-RU',
        selectedItem: null,
        collapsedSeparatorOrderIds: new Set()
      },
      english
    );

    expect(english.byOrderId.get('localized-mod')?.status.label).toBe('No overwrite');
    expect(russian.byOrderId.get('localized-mod')?.status.label).toBe('Нет перезаписи');
    expect(russian.byOrderId.get('localized-mod')).not.toBe(
      english.byOrderId.get('localized-mod')
    );
  });

  it('reuses flat 5k view entries across native clones and derives only changed rows', () => {
    const mods = Array.from({ length: 5_000 }, (_, index) =>
      modItem(`mod-${index}`, `Mod ${index}`, index)
    );
    const plugins = Array.from({ length: 5_000 }, (_, index) =>
      pluginItem(`plugin-${index}`, `Plugin${index}.esp`, index)
    );
    const firstMods = buildModRowViewIndex(mods, {
      selectedItem: mods[10]!,
      collapsedSeparatorOrderIds: new Set()
    });
    const firstPlugins = buildPluginRowViewIndex(plugins, {
      collapsedSeparatorOrderIds: new Set()
    });
    const nextMods = mods.map((item) => ({ ...item }));
    const nextPlugins = plugins.map((item) => ({ ...item }));
    nextMods[2_500] = { ...nextMods[2_500]!, version: '2.0.0' };
    nextPlugins[2_500] = { ...nextPlugins[2_500]!, isEnabled: false };

    const secondMods = buildModRowViewIndex(
      nextMods,
      {
        selectedItem: nextMods[10]!,
        collapsedSeparatorOrderIds: new Set()
      },
      firstMods
    );
    const secondPlugins = buildPluginRowViewIndex(
      nextPlugins,
      {
        collapsedSeparatorOrderIds: new Set()
      },
      firstPlugins
    );

    expect(secondMods.byOrderId.get('mod-0')).toBe(firstMods.byOrderId.get('mod-0'));
    expect(secondMods.byOrderId.get('mod-2500')).not.toBe(firstMods.byOrderId.get('mod-2500'));
    expect(secondMods.byOrderId.get('mod-4999')).toBe(firstMods.byOrderId.get('mod-4999'));
    expect(secondPlugins.byOrderId.get('plugin-0')).toBe(firstPlugins.byOrderId.get('plugin-0'));
    expect(secondPlugins.byOrderId.get('plugin-2500'))
      .not.toBe(firstPlugins.byOrderId.get('plugin-2500'));
    expect(secondPlugins.byOrderId.get('plugin-4999'))
      .toBe(firstPlugins.byOrderId.get('plugin-4999'));

    const terminalMods = nextMods.map((item) => ({ ...item }));
    terminalMods[2_500] = modItem(
      'mod-installed',
      'Installed replacement',
      2_500
    );
    const terminalIndex = buildModRowViewIndex(
      terminalMods,
      {
        selectedItem: terminalMods[10]!,
        collapsedSeparatorOrderIds: new Set()
      },
      secondMods
    );

    expect(terminalIndex.byOrderId.get('mod-0')).toBe(secondMods.byOrderId.get('mod-0'));
    expect(terminalIndex.byOrderId.get('mod-installed')).toMatchObject({
      priority: 2_501
    });
    expect(terminalIndex.byOrderId.get('mod-2500')).toBeUndefined();
    expect(terminalIndex.byOrderId.get('mod-2501'))
      .toBe(secondMods.byOrderId.get('mod-2501'));
    expect(terminalIndex.byOrderId.get('mod-4999'))
      .toBe(secondMods.byOrderId.get('mod-4999'));
  });
});
