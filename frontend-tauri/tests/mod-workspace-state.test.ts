import { describe, expect, it } from 'vitest';

import {
  emptyModWorkspaceState,
  filterModOrderItems,
  formatFileSize,
  hasConflict,
  isModNestedUnderSeparator,
  modStatusText,
  modOverwriteView,
  modWorkspaceReducer,
  selectedModOrderItem,
  targetIndexForDrop,
  targetIndexForMove
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

  it('keeps selection stable after reload and falls back to the first mod', () => {
    const loaded = modWorkspaceReducer(
      { ...emptyModWorkspaceState(), selectedOrderId: 'mod_smoothcam' },
      { type: 'items-loaded', items }
    );

    expect(loaded.selectedOrderId).toBe('mod_smoothcam');
    expect(selectedModOrderItem(items, 'missing')?.orderId).toBe('mod_skyui');
  });

  it('calculates move target indexes without mutating order rows', () => {
    expect(targetIndexForMove(items, 'mod_skyui', -1)).toBe(0);
    expect(targetIndexForMove(items, 'mod_skyui', 1)).toBe(2);
    expect(targetIndexForMove(items, 'sep_visuals', -1)).toBeNull();
    expect(targetIndexForDrop(items, 'mod_skyui', 'mod_smoothcam')).toBe(2);
    expect(targetIndexForDrop(items, 'mod_skyui', 'mod_skyui')).toBeNull();
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
});
