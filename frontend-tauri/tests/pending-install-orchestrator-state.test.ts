import { describe, expect, it } from 'vitest';

import {
  applyPendingInstallConflictSnapshot,
  beginPendingInstall,
  completePendingInstall,
  installedModPathAfterPendingInstallCancellation,
  mergePendingInstallIntoAuthoritativeItems,
  pendingInstallConflictMarkerReady,
  pendingInstallTargetIndexForPlacement,
  rollbackPendingInstall
} from '../src/renderer/features/mods/pending-install-orchestrator-state';
import type {
  FluxoraInstallConflictSnapshot,
  FluxoraInstalledModSummary,
  FluxoraModOrderItem
} from '../src/shared/fluxora-api';

const mod = (
  orderId: string,
  modUuid: string,
  name: string,
  order: number,
  extra: Partial<FluxoraModOrderItem> = {}
): FluxoraModOrderItem => ({
  id: `C:\\Build\\mods\\${name}`,
  orderId,
  kind: 'mod',
  order,
  isSeparator: false,
  isMod: true,
  modUuid,
  separatorTitle: '',
  name,
  version: '1.0.0',
  latestVersion: '',
  latestFileId: '',
  updateCheckState: '',
  lastCheckedAt: '',
  updateStatus: '',
  conflictStatus: '',
  fileCount: 3,
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
  overwrittenByModIds: [],
  ...extra
});

const baseItems = [
  mod('order-a', 'uuid-a', 'A', 0),
  mod('order-b', 'uuid-b', 'B', 1)
];

const separator = (orderId: string, title: string, order: number): FluxoraModOrderItem =>
  mod(orderId, '', title, order, {
    id: orderId,
    kind: 'separator',
    isSeparator: true,
    isMod: false,
    separatorTitle: title
  });

const installedSummary = (
  operationId: string,
  orderId: string,
  name = 'Incoming'
): FluxoraInstalledModSummary => ({
  id: `C:\\Build\\mods\\${name}`,
  name,
  version: '2.0.0',
  isEnabled: true,
  latestVersion: '',
  latestFileId: '',
  updateCheckState: 'baseline_pending',
  sourceIsNexus: false,
  sourceIsModdingFlow: false,
  isLocal: true,
  isTranslation: false,
  isPatch: false,
  modUuid: `uuid-${operationId}`,
  orderId,
  fileCount: 2,
  conflictingFileCount: 0,
  overwrittenFileCount: 0,
  overwritingFileCount: 0,
  overwritesModIds: [],
  overwrittenByModIds: [],
  operationId
});

const snapshot = (
  revision: number,
  rows: FluxoraInstallConflictSnapshot['rows']
): FluxoraInstallConflictSnapshot => ({
  operationId: 'install-op',
  revision,
  state: 'ready',
  pendingOrderId: 'pending-install:install-op',
  orderId: '',
  targetIndex: 1,
  rows
});

describe('pending install orchestrator state', () => {
  it('places a new mod after the last child when dropped inside a separator', () => {
    const items = [
      mod('separator-core', '', 'Core', 0, {
        id: 'separator-core',
        kind: 'separator',
        isSeparator: true,
        isMod: false,
        separatorTitle: 'Core'
      }),
      mod('order-a', 'uuid-a', 'A', 1),
      mod('order-b', 'uuid-b', 'B', 2),
      mod('separator-late', '', 'Late', 3, {
        id: 'separator-late',
        kind: 'separator',
        isSeparator: true,
        isMod: false,
        separatorTitle: 'Late'
      })
    ];

    expect(
      pendingInstallTargetIndexForPlacement(
        items,
        {
          operationId: 'install-op',
          modName: 'Incoming',
          mode: 0
        },
        { targetOrderId: 'separator-core', placement: 'inside' }
      )
    ).toBe(3);
  });

  it('creates a movable pending row before the install promise resolves without a conflict marker', () => {
    const started = beginPendingInstall(baseItems, {
      operationId: 'install-op',
      modName: 'Incoming',
      mode: 0,
      targetIndex: 1
    });

    expect(started.items.map((item) => item.orderId)).toEqual([
      'order-a',
      'pending-install:install-op',
      'order-b'
    ]);
    expect(started.items[1]).toMatchObject({
      name: 'Incoming',
      version: 'Installing',
      fileCount: 0,
      conflictingFileCount: 0,
      overwrittenFileCount: 0,
      overwritingFileCount: 0,
      conflictStatus: ''
    });
    expect(pendingInstallConflictMarkerReady(started.session, started.items[1])).toBe(false);
  });

  it('reconstructs one pending row at the same position after a workspace refresh loses it', () => {
    const started = beginPendingInstall(baseItems, {
      operationId: 'install-op',
      modName: 'Incoming optional file',
      mode: 0,
      targetIndex: 1
    });

    const restored = mergePendingInstallIntoAuthoritativeItems(
      started.session,
      baseItems,
      baseItems
    );
    const restoredAgain = mergePendingInstallIntoAuthoritativeItems(
      started.session,
      restored,
      restored
    );

    expect(restored.map((item) => item.orderId)).toEqual([
      'order-a',
      'pending-install:install-op',
      'order-b'
    ]);
    expect(restored[1]).toMatchObject({
      name: 'Incoming optional file',
      version: 'Installing'
    });
    expect(restoredAgain.map((item) => item.orderId)).toEqual(
      restored.map((item) => item.orderId)
    );
  });

  it('deletes only a real target after cancelling a pending install', () => {
    const newInstall = beginPendingInstall(baseItems, {
      operationId: 'cancel-new',
      modName: 'Incoming',
      mode: 0,
      targetIndex: 1
    });
    const replaceInstall = beginPendingInstall(baseItems, {
      operationId: 'cancel-replace',
      modName: 'B replacement',
      mode: 1,
      targetModUuid: 'uuid-b',
      targetIndex: 1
    });

    expect(installedModPathAfterPendingInstallCancellation(
      newInstall.session,
      newInstall.items[1]!.id,
      null
    )).toBeNull();
    expect(installedModPathAfterPendingInstallCancellation(
      newInstall.session,
      newInstall.items[1]!.id,
      { id: 'C:\\Build\\mods\\Incoming' }
    )).toBe('C:\\Build\\mods\\Incoming');
    expect(installedModPathAfterPendingInstallCancellation(
      replaceInstall.session,
      baseItems[1]!.id,
      null
    )).toBe(baseItems[1]!.id);
  });

  it('reconstructs a moved pending row inside the same separator after an authoritative refresh', () => {
    const items = [
      separator('separator-core', 'Core', 0),
      mod('order-a', 'uuid-a', 'A', 1),
      mod('order-b', 'uuid-b', 'B', 2),
      separator('separator-late', 'Late', 3),
      mod('order-c', 'uuid-c', 'C', 4)
    ];
    const started = beginPendingInstall(items, {
      operationId: 'inside-core',
      modName: 'Core optional file',
      mode: 0,
      targetIndex: 3
    });

    const restored = mergePendingInstallIntoAuthoritativeItems(
      started.session,
      items,
      items
    );

    expect(restored.map((item) => item.orderId)).toEqual([
      'separator-core',
      'order-a',
      'order-b',
      'pending-install:inside-core',
      'separator-late',
      'order-c'
    ]);
  });

  it('clamps a missing pending row to the end when the authoritative list shrinks', () => {
    const started = beginPendingInstall(baseItems, {
      operationId: 'shrinking-workspace',
      modName: 'Incoming',
      mode: 0,
      targetIndex: 2
    });

    const restored = mergePendingInstallIntoAuthoritativeItems(
      started.session,
      [],
      [baseItems[0]]
    );

    expect(restored.map((item) => item.orderId)).toEqual([
      'order-a',
      'pending-install:shrinking-workspace'
    ]);
  });

  it('does not duplicate a pending row already returned by the authoritative workspace', () => {
    const started = beginPendingInstall(baseItems, {
      operationId: 'authoritative-pending',
      modName: 'Incoming',
      mode: 0,
      targetIndex: 1
    });

    const restored = mergePendingInstallIntoAuthoritativeItems(
      started.session,
      baseItems,
      started.items
    );

    expect(restored.filter((item) => item.orderId === started.session.pendingOrderId)).toHaveLength(1);
    expect(restored.map((item) => item.orderId)).toEqual(started.items.map((item) => item.orderId));
  });

  it('restores two independently lost pending rows without changing their requested positions', () => {
    const first = beginPendingInstall(baseItems, {
      operationId: 'first-install',
      modName: 'First optional file',
      mode: 0,
      targetIndex: 1
    });
    const second = beginPendingInstall(first.items, {
      operationId: 'second-install',
      modName: 'Second optional file',
      mode: 0,
      targetIndex: 3
    });

    const firstRestored = mergePendingInstallIntoAuthoritativeItems(
      first.session,
      baseItems,
      baseItems
    );
    const bothRestored = mergePendingInstallIntoAuthoritativeItems(
      second.session,
      firstRestored,
      firstRestored
    );

    expect(bothRestored.map((item) => item.orderId)).toEqual([
      'order-a',
      'pending-install:first-install',
      'order-b',
      'pending-install:second-install'
    ]);
  });

  it('completes at the requested position even if the pending row vanished before final progress', () => {
    const started = beginPendingInstall(baseItems, {
      operationId: 'complete-after-refresh',
      modName: 'Incoming',
      mode: 0,
      targetIndex: 1
    });

    const completed = completePendingInstall(
      started.session,
      baseItems,
      installedSummary('complete-after-refresh', 'order-incoming')
    );

    expect(completed.items.map((item) => item.orderId)).toEqual([
      'order-a',
      'order-incoming',
      'order-b'
    ]);
  });

  it('rolls back a reconstructed pending row to the exact pre-install order', () => {
    const started = beginPendingInstall(baseItems, {
      operationId: 'rollback-after-refresh',
      modName: 'Incoming',
      mode: 0,
      targetIndex: 1
    });
    const restored = mergePendingInstallIntoAuthoritativeItems(
      started.session,
      baseItems,
      baseItems
    );

    const rolledBack = rollbackPendingInstall(started.session, restored);

    expect(rolledBack).toEqual(baseItems);
  });

  it('applies exact two-sided row patches and ignores stale revisions', () => {
    const started = beginPendingInstall(baseItems, {
      operationId: 'install-op',
      modName: 'Incoming',
      mode: 0,
      targetIndex: 1
    });
    const ready = applyPendingInstallConflictSnapshot(
      started.session,
      started.items,
      snapshot(2, [
        {
          orderId: 'order-a',
          modUuid: 'uuid-a',
          fileCount: 3,
          conflictingFileCount: 1,
          overwrittenFileCount: 1,
          overwritingFileCount: 0,
          overwritesModIds: [],
          overwrittenByModIds: ['pending-install:install-op']
        },
        {
          orderId: 'pending-install:install-op',
          modUuid: '',
          fileCount: 2,
          conflictingFileCount: 1,
          overwrittenFileCount: 0,
          overwritingFileCount: 1,
          overwritesModIds: ['uuid-a'],
          overwrittenByModIds: []
        }
      ])
    );

    expect(ready.accepted).toBe(true);
    expect(ready.items[0]).toMatchObject({
      conflictingFileCount: 1,
      overwrittenFileCount: 1,
      overwrittenByModIds: ['pending-install:install-op']
    });
    expect(ready.items[1]).toMatchObject({
      fileCount: 2,
      conflictingFileCount: 1,
      overwritingFileCount: 1,
      overwritesModIds: ['uuid-a']
    });
    expect(pendingInstallConflictMarkerReady(ready.session, ready.items[1])).toBe(true);

    const stale = applyPendingInstallConflictSnapshot(
      ready.session,
      ready.items,
      snapshot(1, [])
    );
    expect(stale.accepted).toBe(false);
    expect(stale.session).toBe(ready.session);
    expect(stale.items).toBe(ready.items);
  });

  it('reuses the existing row for Replace and restores exact pre-install conflicts on failure', () => {
    const conflictedItems = baseItems.map((item) =>
      item.orderId === 'order-b'
        ? {
            ...item,
            conflictStatus: '1 conflicting file',
            conflictingFileCount: 1,
            overwritingFileCount: 1,
            overwritesModIds: ['uuid-a']
          }
        : item
    );
    const started = beginPendingInstall(conflictedItems, {
      operationId: 'install-op',
      modName: 'B replacement',
      mode: 1,
      targetModUuid: 'uuid-b',
      targetIndex: 1
    });

    expect(started.items).toHaveLength(2);
    expect(started.session.rowOrderId).toBe('order-b');
    expect(pendingInstallConflictMarkerReady(started.session, started.items[1])).toBe(false);

    const projected = applyPendingInstallConflictSnapshot(
      started.session,
      started.items,
      snapshot(3, [{
        orderId: 'order-b',
        modUuid: 'uuid-b',
        fileCount: 5,
        conflictingFileCount: 0,
        overwrittenFileCount: 0,
        overwritingFileCount: 0,
        overwritesModIds: [],
        overwrittenByModIds: []
      }])
    );
    const rolledBack = rollbackPendingInstall(projected.session, projected.items);

    expect(rolledBack).toHaveLength(2);
    expect(rolledBack[1]).toMatchObject({
      orderId: 'order-b',
      name: 'B',
      fileCount: 3,
      conflictingFileCount: 1,
      overwritingFileCount: 1,
      overwritesModIds: ['uuid-a']
    });
  });

  it('never moves an existing Replace or Merge row when the requested insertion index differs', () => {
    for (const mode of [1, 2] as const) {
      const started = beginPendingInstall(baseItems, {
        operationId: `install-op-${mode}`,
        modName: 'B update',
        mode,
        targetModUuid: 'uuid-b',
        targetIndex: 0
      });

      expect(started.items.map((item) => item.orderId)).toEqual(['order-a', 'order-b']);
      expect(started.session.rowOrderId).toBe('order-b');
      expect(started.session.desiredTargetIndex).toBe(1);
    }
  });

  it('restores a temporarily missing Replace or Merge target at its original position', () => {
    for (const mode of [1, 2] as const) {
      const started = beginPendingInstall(baseItems, {
        operationId: `install-op-${mode}`,
        modName: 'B optional file',
        mode,
        targetModUuid: 'uuid-b',
        targetIndex: 0
      });
      const incompleteWorkspace = [baseItems[0]];

      const restored = mergePendingInstallIntoAuthoritativeItems(
        started.session,
        incompleteWorkspace,
        incompleteWorkspace
      );

      expect(restored.map((item) => item.orderId)).toEqual(['order-a', 'order-b']);
      expect(restored[1]).toMatchObject({
        modUuid: 'uuid-b',
        name: 'B'
      });

      const restoredAgain = mergePendingInstallIntoAuthoritativeItems(
        started.session,
        restored,
        restored
      );
      expect(restoredAgain.filter((item) => item.modUuid === 'uuid-b')).toHaveLength(1);
    }
  });

  it('completes Replace and Merge in the matched row even after a refresh omitted it', () => {
    for (const mode of [1, 2] as const) {
      const operationId = `complete-existing-${mode}`;
      const started = beginPendingInstall(baseItems, {
        operationId,
        modName: 'B optional file',
        mode,
        targetModUuid: 'uuid-b',
        targetIndex: 0
      });

      const completed = completePendingInstall(
        started.session,
        [baseItems[0]],
        {
          ...installedSummary(operationId, 'order-b', 'B optional file'),
          modUuid: 'uuid-b'
        }
      );

      expect(completed.items.map((item) => item.orderId)).toEqual(['order-a', 'order-b']);
      expect(completed.items[1]).toMatchObject({
        modUuid: 'uuid-b',
        name: 'B optional file',
        version: '2.0.0'
      });
    }
  });

  it('rolls back through legacy separator rows that omit conflict relation arrays', () => {
    const separator = {
      ...mod('separator-core', '', 'Core', 0),
      id: 'separator-core',
      kind: 'separator',
      isSeparator: true,
      isMod: false,
      separatorTitle: 'Core'
    } as FluxoraModOrderItem;
    delete (separator as Partial<FluxoraModOrderItem>).overwritesModIds;
    delete (separator as Partial<FluxoraModOrderItem>).overwrittenByModIds;
    const started = beginPendingInstall([separator, mod('order-a', 'uuid-a', 'A', 1)], {
      operationId: 'install-op',
      modName: 'Incoming',
      mode: 0,
      targetIndex: 2
    });

    const rolledBack = rollbackPendingInstall(started.session, started.items);

    expect(rolledBack.map((item) => item.orderId)).toEqual(['separator-core', 'order-a']);
    expect(rolledBack[0].overwritesModIds).toEqual([]);
    expect(rolledBack[0].overwrittenByModIds).toEqual([]);
  });

  it('swaps the temporary order id for the permanent id without inserting a second row', () => {
    const started = beginPendingInstall(baseItems, {
      operationId: 'install-op',
      modName: 'Incoming',
      mode: 0,
      targetIndex: 1
    });
    const installed: FluxoraInstalledModSummary = {
      id: 'C:\\Build\\mods\\Incoming',
      name: 'Incoming',
      version: '2.0.0',
      isEnabled: true,
      latestVersion: '',
      latestFileId: '',
      updateCheckState: 'baseline_pending',
      sourceIsNexus: false,
      sourceIsModdingFlow: false,
      isLocal: true,
      isTranslation: false,
      isPatch: false,
      modUuid: 'uuid-incoming',
      orderId: 'order-incoming',
      fileCount: 2,
      conflictingFileCount: 1,
      overwrittenFileCount: 0,
      overwritingFileCount: 1,
      overwritesModIds: ['uuid-a'],
      overwrittenByModIds: [],
      operationId: 'install-op'
    };

    const completed = completePendingInstall(started.session, started.items, installed);

    expect(completed.orderId).toBe('order-incoming');
    expect(completed.items).toHaveLength(3);
    expect(completed.items.map((item) => item.orderId)).toEqual([
      'order-a',
      'order-incoming',
      'order-b'
    ]);
    expect(completed.items[1]).toMatchObject({
      modUuid: 'uuid-incoming',
      version: '2.0.0',
      fileCount: 2,
      overwritingFileCount: 1
    });
  });
});
