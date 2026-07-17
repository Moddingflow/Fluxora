import { describe, expect, it } from 'vitest';

import {
  applyPendingInstallConflictSnapshot,
  beginPendingInstall,
  completePendingInstall,
  pendingInstallConflictMarkerReady,
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
