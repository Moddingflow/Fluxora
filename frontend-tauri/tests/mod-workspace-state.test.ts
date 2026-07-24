import { describe, expect, it } from 'vitest';

import {
  appendOverwriteOrderItem,
  createOverwriteOrderItem,
  emptyModWorkspaceState,
  filterModOrderItems,
  formatFileSize,
  hasConflict,
  isModNestedUnderSeparator,
  isModOverwriteItem,
  modConflictMarkerStates,
  modConflictMarkerStatesForHighlight,
  modItemConflictHighlight,
  modLatestVersionDiffers,
  modLatestVersionText,
  modOrderItemMovePlan,
  modOrderItemMatchesLookup,
  modPriorityByOrderId,
  optimisticModInstallState,
  modStatusText,
  modOverwriteView,
  modRowConflictHighlight,
  removeModOrderItems,
  reorderModOrderItemSelection,
  reorderModOrderItems,
  modSeparatorConflictMarkerStates,
  modSeparatorChildCount,
  modTableStatusView,
  modVersionText,
  modWorkspaceReducer,
  selectedModOrderItem,
  targetIndexForDrop,
  targetIndexForMove,
  visibleModOrderItems
} from '../src/renderer/mod-workspace-state';
import type {
  FluxoraInstalledModSummary,
  FluxoraModFileTreeEntry,
  FluxoraModOrderItem
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

const separatorItem = (
  orderId: string,
  title: string,
  order: number
): FluxoraModOrderItem =>
  modItem(orderId, title, order, {
    id: orderId,
    kind: 'separator',
    isSeparator: true,
    isMod: false,
    separatorTitle: title,
    name: title,
    fileCount: 0,
    canCheckUpdates: false,
    sourceIsNexus: false
  });

const items: FluxoraModOrderItem[] = [
  separatorItem('sep_visuals', 'Visuals', 0),
  modItem('mod_skyui', 'SkyUI', 1, { hasUpdate: true, updateStatus: 'Update available' }),
  modItem('mod_smoothcam', 'SmoothCam', 2, { isEnabled: false })
];

describe('mod workspace state', () => {
  it('keeps a committed snapshot usable when background reconciliation fails', () => {
    const ready = modWorkspaceReducer(emptyModWorkspaceState(), {
      type: 'items-loaded',
      items
    });
    const failed = modWorkspaceReducer(ready, {
      type: 'load-failed',
      message: 'Exact reconciliation failed',
      silent: true
    });

    expect(failed.items).toEqual(items);
    expect(failed.loadState).toBe('ready');
    expect(failed.errorMessage).toBe('Exact reconciliation failed');
  });

  it('filters mod order rows by mod, separator and status terms', () => {
    expect(filterModOrderItems(items, 'skyui')).toEqual([items[1]]);
    expect(filterModOrderItems(items, 'visuals')).toEqual([items[0]]);
    expect(filterModOrderItems(items, 'update available')).toEqual([items[1]]);
    expect(filterModOrderItems(items, '')).toEqual(items);
  });

  it('clears a non-matching search while revealing and selecting the installed mod', () => {
    const groupedItems = [
      ...items,
      separatorItem('sep_audio', 'Audio', 3),
      modItem('mod_music', 'Music - HQ', 4)
    ];
    const state = {
      ...emptyModWorkspaceState(),
      items: groupedItems,
      selectedOrderId: 'mod_music',
      selectedOrderIds: new Set(['mod_skyui', 'mod_music']),
      selectionAnchorOrderId: 'mod_music',
      collapsedSeparatorOrderIds: new Set(['sep_visuals', 'sep_audio']),
      searchText: 'unrelated search',
      loadState: 'ready' as const
    };

    const revealed = modWorkspaceReducer(state, {
      type: 'item-reveal-requested',
      orderId: 'mod_skyui'
    });

    expect(revealed.searchText).toBe('');
    expect([...revealed.collapsedSeparatorOrderIds]).toEqual(['sep_audio']);
    expect(revealed.selectedOrderId).toBe('mod_skyui');
    expect([...revealed.selectedOrderIds]).toEqual(['mod_skyui']);
    expect(revealed.selectionAnchorOrderId).toBe('mod_skyui');
  });

  it('keeps search when the installed mod already matches the visible results', () => {
    const state = {
      ...emptyModWorkspaceState(),
      items,
      collapsedSeparatorOrderIds: new Set(['sep_visuals']),
      searchText: 'skyui',
      loadState: 'ready' as const
    };

    const revealed = modWorkspaceReducer(state, {
      type: 'item-reveal-requested',
      orderId: 'mod_skyui'
    });

    expect(revealed.searchText).toBe('skyui');
    expect(
      visibleModOrderItems(
        revealed.items,
        revealed.searchText,
        revealed.collapsedSeparatorOrderIds
      ).map((item) => item.orderId)
    ).toEqual(['mod_skyui']);
    expect(revealed.selectedOrderId).toBe('mod_skyui');
  });

  it('assigns one-based priorities to mods without counting separators or overwrite rows', () => {
    const overwrite = createOverwriteOrderItem(
      'Skyrim Graphics',
      'C:\\Builds\\Skyrim\\overwrite',
      'en-us'
    );
    const priorities = modPriorityByOrderId([...items, overwrite]);

    expect([...priorities]).toEqual([
      ['mod_skyui', 1],
      ['mod_smoothcam', 2]
    ]);
    expect(priorities.has('sep_visuals')).toBe(false);
    expect(priorities.has(overwrite.orderId)).toBe(false);
  });

  it('appends localized overwrite output folder row after visible mods only', () => {
    const overwrite = createOverwriteOrderItem(
      'Skyrim Graphics',
      'C:\\Builds\\Skyrim\\overwrite',
      'ru-ru'
    );

    expect(overwrite.name).toBe('Skyrim Graphics · Папка выхода файлов');
    expect(overwrite.id).toBe('C:\\Builds\\Skyrim\\overwrite');
    expect(overwrite.isMod).toBe(false);
    expect(overwrite.isSeparator).toBe(false);
    expect(isModOverwriteItem(overwrite)).toBe(true);
    expect(appendOverwriteOrderItem(items, overwrite, '').map((item) => item.orderId)).toEqual([
      'sep_visuals',
      'mod_skyui',
      'mod_smoothcam',
      overwrite.orderId
    ]);
    const englishOverwrite = createOverwriteOrderItem(
      'Skyrim Graphics',
      'C:\\Builds\\Skyrim\\overwrite',
      'en-us'
    );
    expect(appendOverwriteOrderItem([items[1]], englishOverwrite, 'output').map((item) => item.orderId)).toEqual([
      'mod_skyui',
      englishOverwrite.orderId
    ]);
    expect(appendOverwriteOrderItem([items[1]], overwrite, 'skyui')).toEqual([items[1]]);
  });

  it('keeps selection stable after reload and falls back to the first mod', () => {
    const loaded = modWorkspaceReducer(
      { ...emptyModWorkspaceState(), selectedOrderId: 'mod_smoothcam' },
      { type: 'items-loaded', items }
    );

    expect(loaded.selectedOrderId).toBe('mod_smoothcam');
    expect([...loaded.selectedOrderIds]).toEqual(['mod_smoothcam']);
    expect(selectedModOrderItem(items, 'missing')?.orderId).toBe('mod_skyui');
  });

  it('removes deleted mods and separators from the order before the silent refresh finishes', () => {
    const withoutDeletedRows = removeModOrderItems(
      items,
      new Set(['sep_visuals', 'mod_smoothcam'])
    );

    expect(withoutDeletedRows.map((item) => item.orderId)).toEqual(['mod_skyui']);
  });

  it('matches mod detail lookup values across path separators, ids and names', () => {
    const skyui = modItem('mod_skyui', 'SkyUI', 1, {
      id: 'C:\\Builds\\Skyrim\\mods\\SkyUI',
      modUuid: 'uuid-skyui'
    });

    expect(modOrderItemMatchesLookup(skyui, 'c:/builds/skyrim/mods/skyui')).toBe(true);
    expect(modOrderItemMatchesLookup(skyui, 'MOD_SKYUI')).toBe(true);
    expect(modOrderItemMatchesLookup(skyui, 'uuid-skyui')).toBe(true);
    expect(modOrderItemMatchesLookup(skyui, 'SkyUI')).toBe(true);
    expect(modOrderItemMatchesLookup(skyui, 'SmoothCam')).toBe(false);
  });

  it('keeps existing rows available while a refresh load is running', () => {
    const loaded = modWorkspaceReducer(
      { ...emptyModWorkspaceState(), selectedOrderId: 'mod_skyui' },
      { type: 'items-loaded', items }
    );
    const loading = modWorkspaceReducer(loaded, { type: 'load-started' });

    expect(loading.loadState).toBe('loading');
    expect(loading.items.map((item) => item.orderId)).toEqual([
      'sep_visuals',
      'mod_skyui',
      'mod_smoothcam'
    ]);
    expect(loading.selectedOrderId).toBe('mod_skyui');
  });

  it('tracks ctrl, shift and select-all selection across visible mod rows', () => {
    const orderIds = items.map((item) => item.orderId);
    let state = modWorkspaceReducer(
      { ...emptyModWorkspaceState(), items, loadState: 'ready' },
      { type: 'selected', orderId: 'sep_visuals' }
    );

    state = modWorkspaceReducer(state, {
      type: 'selection-range-selected',
      orderId: 'mod_smoothcam',
      orderedOrderIds: orderIds,
      additive: false
    });
    expect(orderIds.filter((orderId) => state.selectedOrderIds.has(orderId))).toEqual([
      'sep_visuals',
      'mod_skyui',
      'mod_smoothcam'
    ]);

    state = modWorkspaceReducer(state, {
      type: 'selection-toggled',
      orderId: 'mod_skyui',
      orderedOrderIds: orderIds
    });
    state = modWorkspaceReducer(state, {
      type: 'selection-range-selected',
      orderId: 'mod_smoothcam',
      orderedOrderIds: orderIds,
      additive: false
    });
    expect(orderIds.filter((orderId) => state.selectedOrderIds.has(orderId))).toEqual([
      'sep_visuals',
      'mod_smoothcam'
    ]);

    state = modWorkspaceReducer(state, {
      type: 'all-selected',
      orderedOrderIds: orderIds
    });
    expect(orderIds.filter((orderId) => state.selectedOrderIds.has(orderId))).toEqual(orderIds);
  });

  it('calculates move target indexes without mutating order rows', () => {
    expect(targetIndexForMove(items, 'mod_skyui', -1)).toBe(0);
    expect(targetIndexForMove(items, 'mod_skyui', 1)).toBe(2);
    expect(targetIndexForMove(items, 'sep_visuals', -1)).toBeNull();
    expect(targetIndexForDrop(items, 'mod_skyui', 'mod_smoothcam')).toBe(2);
    expect(targetIndexForDrop(items, 'mod_smoothcam', 'mod_skyui', 'before')).toBe(1);
    expect(targetIndexForDrop(items, 'mod_skyui', 'mod_smoothcam', 'before')).toBeNull();
    expect(targetIndexForDrop(items, 'mod_skyui', 'mod_skyui')).toBeNull();
  });

  it('optimistically reorders mod rows and renumbers order values', () => {
    const reordered = reorderModOrderItems(items, 'mod_skyui', 2);

    expect(reordered?.map((item) => item.orderId)).toEqual([
      'sep_visuals',
      'mod_smoothcam',
      'mod_skyui'
    ]);
    expect(reordered?.map((item) => item.order)).toEqual([0, 1, 2]);
    expect(items.map((item) => item.orderId)).toEqual([
      'sep_visuals',
      'mod_skyui',
      'mod_smoothcam'
    ]);
  });

  it('moves every selected mod row as one ordered drag group', () => {
    const reordered = reorderModOrderItemSelection(
      items,
      'mod_skyui',
      new Set(['mod_skyui', 'mod_smoothcam']),
      'sep_visuals',
      'before'
    );

    expect(reordered?.map((item) => item.orderId)).toEqual([
      'mod_skyui',
      'mod_smoothcam',
      'sep_visuals'
    ]);
    expect(reordered?.map((item) => item.order)).toEqual([0, 1, 2]);
    expect(
      reordered &&
        modOrderItemMovePlan(items, reordered, new Set(['mod_skyui', 'mod_smoothcam']))
    ).toEqual([
      { orderId: 'mod_skyui', targetIndex: 0 },
      { orderId: 'mod_smoothcam', targetIndex: 1 }
    ]);
  });

  it('moves multiple selected separators together without changing their relative order', () => {
    const groupedItems = [
      separatorItem('sep_core', 'Core', 0),
      modItem('mod_core', 'Core mod', 1),
      separatorItem('sep_visuals', 'Visuals', 2),
      modItem('mod_visuals', 'Visual mod', 3),
      separatorItem('sep_audio', 'Audio', 4),
      modItem('mod_audio', 'Audio mod', 5),
      separatorItem('sep_late', 'Late', 6)
    ];
    const reordered = reorderModOrderItemSelection(
      groupedItems,
      'sep_visuals',
      new Set(['sep_core', 'sep_visuals', 'sep_audio']),
      'sep_late',
      'after'
    );

    expect(reordered?.map((item) => item.orderId)).toEqual([
      'mod_core',
      'mod_visuals',
      'mod_audio',
      'sep_late',
      'sep_core',
      'sep_visuals',
      'sep_audio'
    ]);
    expect(
      reordered &&
        modOrderItemMovePlan(
          groupedItems,
          reordered,
          new Set(['sep_core', 'sep_visuals', 'sep_audio'])
        )
    ).toEqual([
      { orderId: 'sep_audio', targetIndex: 6 },
      { orderId: 'sep_visuals', targetIndex: 5 },
      { orderId: 'sep_core', targetIndex: 4 }
    ]);
  });

  it('calculates separator block drop indexes for precise row slots', () => {
    const groupedItems = [
      ...items,
      separatorItem('sep_audio', 'Audio', 3),
      modItem('mod_music', 'Music - HQ', 4)
    ];

    expect(targetIndexForDrop(groupedItems, 'sep_visuals', 'mod_music', 'after')).toBeNull();
    expect(targetIndexForDrop(groupedItems, 'sep_visuals', 'mod_smoothcam', 'before')).toBeNull();
    expect(targetIndexForDrop(groupedItems, 'sep_visuals', 'sep_audio', 'before')).toBe(2);
    expect(targetIndexForDrop(groupedItems, 'sep_visuals', 'sep_audio', 'after')).toBe(4);
    expect(targetIndexForDrop(groupedItems, 'sep_audio', 'sep_visuals', 'before')).toBe(0);
  });

  it('optimistically moves separators without moving their child mods', () => {
    const groupedItems = [
      ...items,
      separatorItem('sep_audio', 'Audio', 3),
      modItem('mod_music', 'Music - HQ', 4)
    ];
    const targetIndex = targetIndexForDrop(groupedItems, 'sep_visuals', 'sep_audio', 'after');
    const reordered = targetIndex === null
      ? null
      : reorderModOrderItems(groupedItems, 'sep_visuals', targetIndex);

    expect(reordered?.map((item) => item.orderId)).toEqual([
      'mod_skyui',
      'mod_smoothcam',
      'sep_audio',
      'mod_music',
      'sep_visuals'
    ]);
    expect(reordered?.map((item) => item.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('hides collapsed separator children without removing them from reorder blocks', () => {
    const groupedItems = [
      ...items,
      separatorItem('sep_audio', 'Audio', 3),
      modItem('mod_music', 'Music - HQ', 4)
    ];
    const collapsed = new Set(['sep_visuals']);

    expect(visibleModOrderItems(groupedItems, '', collapsed).map((item) => item.orderId)).toEqual([
      'sep_visuals',
      'sep_audio',
      'mod_music'
    ]);
    expect(visibleModOrderItems(groupedItems, 'skyui', collapsed).map((item) => item.orderId)).toEqual([
      'mod_skyui'
    ]);
    expect(targetIndexForDrop(groupedItems, 'mod_music', 'sep_visuals', 'after', collapsed)).toBe(3);
    expect(targetIndexForMove(groupedItems, 'sep_visuals', 1, collapsed)).toBe(4);

    const reordered = reorderModOrderItems(groupedItems, 'sep_visuals', 4);
    expect(reordered?.map((item) => item.orderId)).toEqual([
      'mod_skyui',
      'mod_smoothcam',
      'sep_audio',
      'mod_music',
      'sep_visuals'
    ]);
  });

  it('applies optimistic reorder actions and restores authoritative order on reload', () => {
    const moved = modWorkspaceReducer(
      { ...emptyModWorkspaceState(), items, selectedOrderId: 'mod_skyui', loadState: 'ready' },
      { type: 'items-reordered', orderId: 'mod_skyui', targetIndex: 2 }
    );

    expect(moved.items.map((item) => item.orderId)).toEqual([
      'sep_visuals',
      'mod_smoothcam',
      'mod_skyui'
    ]);
    expect(moved.selectedOrderId).toBe('mod_skyui');

    const restored = modWorkspaceReducer(moved, { type: 'items-loaded', items });
    expect(restored.items.map((item) => item.orderId)).toEqual([
      'sep_visuals',
      'mod_skyui',
      'mod_smoothcam'
    ]);
    expect(restored.selectedOrderId).toBe('mod_skyui');
  });

  it('shows a completed install immediately at its drag and drop position', () => {
    const installed: FluxoraInstalledModSummary = {
      id: 'C:\\Builds\\Skyrim\\mods\\Cabbage CS Preset',
      name: 'Cabbage CS Preset',
      version: '1.4.0',
      isEnabled: true,
      latestVersion: '1.4.0',
      latestFileId: '770345',
      updateCheckState: 'baseline_pending',
      sourceIsNexus: true,
      sourceIsModdingFlow: false,
      sourceProvider: 'nexus',
      sourceGameDomain: 'skyrimspecialedition',
      sourceModId: '182366',
      sourceFileId: '770345',
      sourceUrl: 'nxm://skyrimspecialedition/mods/182366/files/770345',
      isLocal: false,
      isTranslation: false,
      isPatch: false,
      modUuid: 'uuid-cabbage',
      orderId: '',
      fileCount: 12,
      conflictingFileCount: 0,
      overwrittenFileCount: 0,
      overwritingFileCount: 0,
      overwritesModIds: [],
      overwrittenByModIds: [],
      operationId: 'op_install_cabbage'
    };

    const optimistic = optimisticModInstallState(
      items.filter((item) => item.isMod),
      items,
      installed,
      {
        targetOrderId: 'mod_smoothcam',
        placement: 'before'
      }
    );

    expect(optimistic.items.map((item) => item.orderId)).toEqual([
      'sep_visuals',
      'mod_skyui',
      'pending-install:op_install_cabbage',
      'mod_smoothcam'
    ]);
    expect(optimistic.installedMods.at(-1)).toMatchObject({
      id: installed.id,
      name: installed.name,
      version: installed.version,
      latestVersion: '1.4.0',
      isEnabled: true,
      canCheckUpdates: true,
      sourceIsNexus: true,
      sourceProvider: 'nexus',
      sourceGameDomain: 'skyrimspecialedition',
      sourceModId: '182366',
      sourceFileId: '770345',
      sourceUrl: 'nxm://skyrimspecialedition/mods/182366/files/770345',
      isLocal: false
    });
    expect(optimistic.items.at(-2)).toMatchObject({
      latestVersion: '1.4.0',
      canCheckUpdates: true,
      sourceIsNexus: true,
      isLocal: false
    });
    expect(optimistic.installedOrderId).toBe('pending-install:op_install_cabbage');
  });

  it('keeps a mod at the user-selected priority when its installation completes later', () => {
    const installed: FluxoraInstalledModSummary = {
      id: 'C:\\Builds\\Skyrim\\mods\\Cabbage CS Preset',
      name: 'Cabbage CS Preset',
      version: '1.4.0',
      isEnabled: true,
      latestVersion: '1.4.0',
      latestFileId: '770345',
      updateCheckState: 'baseline_pending',
      sourceIsNexus: true,
      sourceIsModdingFlow: false,
      sourceProvider: 'nexus',
      sourceGameDomain: 'skyrimspecialedition',
      sourceModId: '182366',
      sourceFileId: '770345',
      sourceUrl: 'nxm://skyrimspecialedition/mods/182366/files/770345',
      isLocal: false,
      isTranslation: false,
      isPatch: false,
      modUuid: 'uuid-cabbage',
      orderId: 'mod_cabbage',
      fileCount: 12,
      conflictingFileCount: 0,
      overwrittenFileCount: 0,
      overwritingFileCount: 0,
      overwritesModIds: [],
      overwrittenByModIds: [],
      operationId: 'op_install_cabbage'
    };
    const installing = {
      ...modItem('mod_cabbage', installed.name, 1),
      id: installed.id,
      version: 'Installing'
    };
    const userReorderedItems = [items[0], installing, items[1], items[2]].map(
      (item, index) => ({ ...item, order: index })
    );
    const state = {
      ...emptyModWorkspaceState(),
      items: userReorderedItems,
      loadState: 'ready' as const
    };

    const completed = modWorkspaceReducer(state, {
      type: 'install-completed',
      installed,
      placement: {
        targetOrderId: 'mod_smoothcam',
        placement: 'after'
      }
    });

    expect(completed.items.map((item) => item.orderId)).toEqual([
      'sep_visuals',
      'mod_cabbage',
      'mod_skyui',
      'mod_smoothcam'
    ]);
    expect(completed.items[1]).toMatchObject({
      orderId: 'mod_cabbage',
      version: '1.4.0',
      sourceFileId: '770345'
    });
    expect(completed.selectedOrderId).toBe('mod_cabbage');
  });

  it('applies optimistic enabled state without changing the current row context', () => {
    const loaded = modWorkspaceReducer(
      { ...emptyModWorkspaceState(), selectedOrderId: 'mod_smoothcam' },
      { type: 'items-loaded', items }
    );
    const collapsed = modWorkspaceReducer(loaded, {
      type: 'separator-collapse-toggled',
      orderId: 'sep_visuals'
    });
    const enabled = modWorkspaceReducer(collapsed, {
      type: 'item-enabled-set',
      orderId: 'mod_smoothcam',
      isEnabled: true
    });

    expect(enabled.items.map((item) => item.orderId)).toEqual(items.map((item) => item.orderId));
    expect(enabled.items.find((item) => item.orderId === 'mod_smoothcam')?.isEnabled).toBe(true);
    expect(enabled.selectedOrderId).toBe('sep_visuals');
    expect(enabled.collapsedSeparatorOrderIds.has('sep_visuals')).toBe(true);
  });

  it('applies optimistic bulk enabled state only to mod rows', () => {
    const overwrite = createOverwriteOrderItem(
      'Skyrim Graphics',
      'C:\\Builds\\Skyrim\\overwrite',
      'en-us'
    );
    const disabled = modWorkspaceReducer(
      {
        ...emptyModWorkspaceState(),
        items: [...items, overwrite],
        selectedOrderId: 'mod_skyui',
        loadState: 'ready'
      },
      { type: 'all-items-enabled-set', isEnabled: false }
    );

    expect(disabled.items.filter((item) => item.isMod).every((item) => !item.isEnabled)).toBe(true);
    expect(disabled.items.find((item) => item.isSeparator)?.isEnabled).toBe(true);
    expect(disabled.items.find((item) => isModOverwriteItem(item))?.isEnabled).toBe(true);
    expect(disabled.selectedOrderId).toBe('mod_skyui');
  });

  it('stores collapsed separator state in the reducer while preserving full order', () => {
    const loaded = modWorkspaceReducer(
      { ...emptyModWorkspaceState(), selectedOrderId: 'mod_skyui' },
      { type: 'items-loaded', items }
    );
    const collapsed = modWorkspaceReducer(loaded, {
      type: 'separator-collapse-toggled',
      orderId: 'sep_visuals'
    });

    expect(collapsed.collapsedSeparatorOrderIds.has('sep_visuals')).toBe(true);
    expect(collapsed.selectedOrderId).toBe('sep_visuals');
    expect(collapsed.items.map((item) => item.orderId)).toEqual([
      'sep_visuals',
      'mod_skyui',
      'mod_smoothcam'
    ]);
    expect(visibleModOrderItems(collapsed.items, '', collapsed.collapsedSeparatorOrderIds)).toEqual([
      items[0]
    ]);
  });

  it('restores persisted collapsed separators when a build workspace loads', () => {
    const loaded = modWorkspaceReducer(emptyModWorkspaceState(), {
      type: 'items-loaded',
      items,
      collapsedSeparatorOrderIds: new Set(['sep_visuals', 'missing-separator'])
    });

    expect([...loaded.collapsedSeparatorOrderIds]).toEqual(['sep_visuals']);
    expect(visibleModOrderItems(loaded.items, '', loaded.collapsedSeparatorOrderIds)).toEqual([
      items[0]
    ]);
  });

  it('collapses and expands every separator without changing selection', () => {
    const groupedItems = [
      ...items,
      separatorItem('sep_audio', 'Audio', 3),
      modItem('mod_audio', 'Audio Fixes', 4)
    ];
    const loaded = modWorkspaceReducer(
      { ...emptyModWorkspaceState(), selectedOrderId: 'mod_skyui' },
      { type: 'items-loaded', items: groupedItems }
    );

    const collapsed = modWorkspaceReducer(loaded, {
      type: 'all-separators-collapse-set',
      isCollapsed: true
    });

    expect([...collapsed.collapsedSeparatorOrderIds].sort()).toEqual(['sep_audio', 'sep_visuals']);
    expect(collapsed.selectedOrderId).toBe('mod_skyui');

    const expanded = modWorkspaceReducer(collapsed, {
      type: 'all-separators-collapse-set',
      isCollapsed: false
    });

    expect(expanded.collapsedSeparatorOrderIds.size).toBe(0);
    expect(expanded.selectedOrderId).toBe('mod_skyui');
  });

  it('marks mods as nested when they belong to a separator group', () => {
    expect(isModNestedUnderSeparator(items, 'sep_visuals')).toBe(false);
    expect(isModNestedUnderSeparator(items, 'mod_skyui')).toBe(true);
    expect(isModNestedUnderSeparator([items[1], items[2]], 'mod_skyui')).toBe(false);
  });

  it('formats mod and file tree status for dense UI rows', () => {
    expect(modStatusText(items[1])).toBe('Update available');
    expect(modStatusText(items[2])).toBe('Disabled');
    expect(formatFileSize(1536)).toBe('1.5 KB');

    const conflictedFile: FluxoraModFileTreeEntry = {
      name: 'skeleton.nif',
      relativePath: 'meshes\\skeleton.nif',
      isDirectory: false,
      hasChildren: false,
      size: 4096,
      conflictState: 'overwritten',
      conflictOwners: ['XPMSSE']
    };

    expect(hasConflict(conflictedFile)).toBe(true);
  });

  it('summarizes overwrite states for compact mod rows', () => {
    expect(modOverwriteView(modItem('mod_clean', 'Clean Mod', 4)).state).toBe('none');
    expect(
      modOverwriteView(
        modItem('mod_overwrites', 'Overwrites', 5, {
          overwritingFileCount: 4
        })
      ).state
    ).toBe('overwrites');
    expect(
      modOverwriteView(
        modItem('mod_mixed', 'Mixed', 6, {
          overwrittenFileCount: 3,
          overwritingFileCount: 2
        })
      ).state
    ).toBe('mixed');
    expect(
      modOverwriteView(
        modItem('mod_lost', 'Lost', 7, {
          fileCount: 4,
          overwrittenFileCount: 4
        })
      ).state
    ).toBe('fully-overwritten');
    expect(
      modOverwriteView(
        modItem('mod_clean_text', 'Clean Text', 8, {
          conflictStatus: 'Конфликтов нет'
        })
      ).state
    ).toBe('none');
  });

  it('derives MO2-style selected conflict highlights from backend mod relations', () => {
    const base = modItem('mod_base', 'Base Textures', 4, {
      overwrittenFileCount: 1,
      overwrittenByModIds: ['C:\\Builds\\Skyrim\\mods\\Patch Textures']
    });
    const patch = modItem('mod_patch', 'Patch Textures', 5, {
      overwritingFileCount: 1,
      overwritesModIds: ['C:\\Builds\\Skyrim\\mods\\Base Textures']
    });

    expect(modItemConflictHighlight(base, patch)).toBe('overwrites');
    expect(modItemConflictHighlight(patch, base)).toBe('overwritten');
    expect(modConflictMarkerStates(base)).toEqual(['overwritten']);
    expect(modConflictMarkerStates(patch)).toEqual(['overwrites']);
    expect(modConflictMarkerStatesForHighlight('none')).toEqual([]);
    expect(modConflictMarkerStatesForHighlight('overwrites')).toEqual(['overwrites']);
    expect(modConflictMarkerStatesForHighlight('overwritten')).toEqual(['overwritten']);
    expect(modConflictMarkerStatesForHighlight('mixed')).toEqual([
      'overwrites',
      'overwritten'
    ]);
  });

  it('aggregates overwrite, overwritten and fully overwritten markers on separators', () => {
    const groupedItems = [
      separatorItem('sep_conflicts', 'Conflicts', 4),
      modItem('mod_winner', 'Winner', 5, {
        overwritingFileCount: 2
      }),
      modItem('mod_middle', 'Middle', 6, {
        overwrittenFileCount: 1,
        overwritingFileCount: 1
      }),
      modItem('mod_lost', 'Lost', 7, {
        fileCount: 3,
        overwrittenFileCount: 3
      })
    ];

    expect(modSeparatorConflictMarkerStates(groupedItems, 'sep_conflicts')).toEqual([
      'overwrites',
      'overwritten',
      'fully-overwritten'
    ]);
    const selected = modItem('mod_selected', 'Selected', 8, {
      overwritesModIds: [groupedItems[1].id],
      overwrittenByModIds: [groupedItems[3].id]
    });
    expect(modRowConflictHighlight(groupedItems, groupedItems[0], null)).toBe('none');
    expect(modRowConflictHighlight(groupedItems, groupedItems[0], selected)).toBe('overwritten');
    expect(
      modRowConflictHighlight(
        groupedItems,
        groupedItems[0],
        modItem('mod_selected_loser', 'Selected Loser', 9, {
          overwrittenByModIds: [groupedItems[1].id]
        })
      )
    ).toBe('overwrites');
  });

  it('formats table columns and separator group counts for the redesigned mods pane', () => {
    expect(modSeparatorChildCount(items, 'sep_visuals')).toBe(2);
    expect(modVersionText(items[1])).toBe('1.0.0');
    expect(modLatestVersionText(items[1])).toBe('available');
    expect(modTableStatusView(items[1])).toMatchObject({
      label: 'No overwrite',
      overwrite: { state: 'none' },
      tone: 'ready'
    });
    expect(modTableStatusView(items[2])).toMatchObject({
      label: 'Disabled',
      overwrite: { state: 'none' },
      tone: 'disabled'
    });
    expect(modTableStatusView(modItem('mod_never_checked', 'Never Checked', 8, {
      updateStatus: 'Не проверялся'
    }))).toMatchObject({
      label: 'No overwrite',
      overwrite: { state: 'none' },
      tone: 'ready'
    });
    expect(modTableStatusView(modItem('mod_local', 'Local Mod', 9, {
      canCheckUpdates: false,
      sourceIsNexus: false
    }))).toMatchObject({
      label: 'No overwrite',
      overwrite: { state: 'none' },
      tone: 'local'
    });
  });

  it('marks Latest as different only when both displayed versions are present and unequal', () => {
    expect(modLatestVersionDiffers(modItem('mod_outdated', 'Outdated', 8, {
      version: '1.1.2.0',
      latestVersion: '1.2',
      hasUpdate: false
    }))).toBe(true);
    expect(modLatestVersionDiffers(modItem('mod_current', 'Current', 9, {
      version: '1.2',
      latestVersion: ' 1.2 '
    }))).toBe(false);
    expect(modLatestVersionDiffers(modItem('mod_not_checked', 'Not Checked', 10, {
      version: '1.2',
      latestVersion: '',
      hasUpdate: true
    }))).toBe(false);
  });
});
