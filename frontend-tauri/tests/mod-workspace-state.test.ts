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
  modLatestVersionText,
  modStatusText,
  modOverwriteView,
  reorderModOrderItems,
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
  it('filters mod order rows by mod, separator and status terms', () => {
    expect(filterModOrderItems(items, 'skyui')).toEqual([items[1]]);
    expect(filterModOrderItems(items, 'visuals')).toEqual([items[0]]);
    expect(filterModOrderItems(items, 'update available')).toEqual([items[1]]);
    expect(filterModOrderItems(items, '')).toEqual(items);
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
  });

  it('formats table columns and separator group counts for the redesigned mods pane', () => {
    expect(modSeparatorChildCount(items, 'sep_visuals')).toBe(2);
    expect(modVersionText(items[1])).toBe('1.0.0');
    expect(modLatestVersionText(items[1])).toBe('available');
    expect(modTableStatusView(items[1])).toEqual({
      label: 'Update available',
      tone: 'update'
    });
    expect(modTableStatusView(items[2])).toEqual({
      label: 'Disabled',
      tone: 'disabled'
    });
    expect(modTableStatusView(modItem('mod_local', 'Local Mod', 8, {
      canCheckUpdates: false,
      sourceIsNexus: false
    }))).toEqual({
      label: 'Local',
      tone: 'local'
    });
  });
});
