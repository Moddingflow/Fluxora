import type {
  FluxoraExistingModInstallMode,
  FluxoraInstallConflictSnapshot,
  FluxoraInstallConflictSnapshotState,
  FluxoraInstalledModSummary,
  FluxoraModOrderItem
} from '../../../shared/fluxora-api';
import type { InstallModOrderPlacement } from '../../install-workspace-state';
import { targetIndexForOrderDrop } from '../../order-list-state';

export type PendingInstallDropPlacement = InstallModOrderPlacement['placement'];

export interface PendingInstallDraft {
  operationId: string;
  modName: string;
  mode: FluxoraExistingModInstallMode;
  targetModUuid?: string;
  targetIndex: number;
}

export interface PendingInstallPlacement {
  targetOrderId: string;
  placement: PendingInstallDropPlacement;
}

export interface PendingInstallSessionState {
  operationId: string;
  mode: FluxoraExistingModInstallMode;
  pendingOrderId: string;
  rowOrderId: string;
  targetModUuid: string;
  desiredTargetIndex: number;
  originalTargetIndex: number;
  revision: number;
  state: FluxoraInstallConflictSnapshotState;
  hasUserRebased: boolean;
  baselineItems: readonly FluxoraModOrderItem[];
}

export interface PendingInstallWorkspaceState {
  items: FluxoraModOrderItem[];
  session: PendingInstallSessionState;
}

export interface PendingInstallSnapshotResult extends PendingInstallWorkspaceState {
  accepted: boolean;
}

export interface CompletedPendingInstallState {
  items: FluxoraModOrderItem[];
  orderId: string;
}

const normalizedIdentity = (value: string | null | undefined): string =>
  (value ?? '').trim().toLocaleLowerCase();

const clampedTargetIndex = (targetIndex: number, itemCount: number): number => {
  if (!Number.isFinite(targetIndex) || targetIndex < 0) {
    return itemCount;
  }
  return Math.min(Math.trunc(targetIndex), itemCount);
};

const renumber = (items: readonly FluxoraModOrderItem[]): FluxoraModOrderItem[] =>
  items.map((item, order) => ({ ...item, order }));

const moveToIndex = (
  items: readonly FluxoraModOrderItem[],
  orderId: string,
  targetIndex: number
): FluxoraModOrderItem[] => {
  const sourceIndex = items.findIndex((item) => item.orderId === orderId);
  if (sourceIndex < 0) {
    return renumber(items);
  }

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(clampedTargetIndex(targetIndex, next.length), 0, moved);
  return renumber(next);
};

const emptyPendingOrderItem = (
  operationId: string,
  name: string,
  order: number
): FluxoraModOrderItem => {
  const pendingOrderId = `pending-install:${operationId}`;
  return {
    id: pendingOrderId,
    orderId: pendingOrderId,
    kind: 'mod',
    order,
    isSeparator: false,
    isMod: true,
    modUuid: '',
    separatorTitle: '',
    name,
    version: 'Installing',
    latestVersion: '',
    latestFileId: '',
    updateCheckState: '',
    lastCheckedAt: '',
    updateStatus: '',
    conflictStatus: '',
    fileCount: 0,
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
    overwrittenByModIds: []
  };
};

const targetItemForDraft = (
  items: readonly FluxoraModOrderItem[],
  draft: PendingInstallDraft
): FluxoraModOrderItem | undefined => {
  const targetUuid = normalizedIdentity(draft.targetModUuid);
  return targetUuid
    ? items.find(
        (item) => item.isMod && normalizedIdentity(item.modUuid) === targetUuid
      )
    : undefined;
};

export const beginPendingInstall = (
  items: readonly FluxoraModOrderItem[],
  draft: PendingInstallDraft
): PendingInstallWorkspaceState => {
  const operationId = draft.operationId.trim();
  const modName = draft.modName.trim();
  if (!operationId || !modName) {
    throw new Error('A pending install requires an operation id and mod name.');
  }

  const pendingOrderId = `pending-install:${operationId}`;
  const target = targetItemForDraft(items, draft);
  if (draft.mode !== 0 && !target) {
    throw new Error('Replace and Merge require the matched mod row.');
  }

  const originalTargetIndex = target
    ? items.findIndex((item) => item.orderId === target.orderId)
    : -1;
  const desiredTargetIndex = target
    ? originalTargetIndex
    : clampedTargetIndex(draft.targetIndex, items.length);
  let nextItems: FluxoraModOrderItem[];
  let rowOrderId: string;

  if (target) {
    rowOrderId = target.orderId;
    nextItems = renumber(items);
  } else {
    rowOrderId = pendingOrderId;
    nextItems = [...items];
    nextItems.splice(
      desiredTargetIndex,
      0,
      emptyPendingOrderItem(operationId, modName, desiredTargetIndex)
    );
    nextItems = renumber(nextItems);
  }

  return {
    items: nextItems,
    session: {
      operationId,
      mode: draft.mode,
      pendingOrderId,
      rowOrderId,
      targetModUuid: draft.targetModUuid?.trim() ?? '',
      desiredTargetIndex,
      originalTargetIndex,
      revision: 0,
      state: 'preparing',
      hasUserRebased: false,
      baselineItems: items.map((item) => ({ ...item }))
    }
  };
};

export const pendingInstallTargetIndexForPlacement = (
  items: readonly FluxoraModOrderItem[],
  draft: Omit<PendingInstallDraft, 'targetIndex'>,
  placement: PendingInstallPlacement | null
): number => {
  const target = targetItemForDraft(items, { ...draft, targetIndex: -1 });
  const sourceOrderId = target?.orderId ?? `pending-install:${draft.operationId}`;
  const provisionalItems = target
    ? [...items]
    : [...items, emptyPendingOrderItem(draft.operationId, draft.modName, items.length)];
  if (!placement || placement.targetOrderId === sourceOrderId) {
    return target
      ? items.findIndex((item) => item.orderId === target.orderId)
      : items.length;
  }

  const isInsideSeparator =
    placement.placement === 'inside' &&
    items.some(
      (item) => item.orderId === placement.targetOrderId && item.isSeparator
    );
  const orderDropPlacement = placement.placement === 'before' ? 'before' : 'after';

  return targetIndexForOrderDrop(
    provisionalItems,
    sourceOrderId,
    placement.targetOrderId,
    orderDropPlacement,
    {
      separatorMoveMode: 'single',
      treatAfterSeparatorTargetAsBlock: isInsideSeparator
    }
  ) ?? (target
    ? items.findIndex((item) => item.orderId === target.orderId)
    : items.length);
};

const conflictStatus = (conflictingFileCount: number): string =>
  conflictingFileCount > 0
    ? `${conflictingFileCount} conflicting ${conflictingFileCount === 1 ? 'file' : 'files'}`
    : '';

const itemMatchesPatch = (
  item: FluxoraModOrderItem,
  patch: FluxoraInstallConflictSnapshot['rows'][number]
): boolean =>
  item.orderId === patch.orderId ||
  (Boolean(patch.modUuid) && normalizedIdentity(item.modUuid) === normalizedIdentity(patch.modUuid));

export const applyPendingInstallConflictSnapshot = (
  session: PendingInstallSessionState,
  items: readonly FluxoraModOrderItem[],
  snapshot: FluxoraInstallConflictSnapshot
): PendingInstallSnapshotResult => {
  if (
    snapshot.operationId !== session.operationId ||
    !Number.isFinite(snapshot.revision) ||
    snapshot.revision <= session.revision
  ) {
    return { session, items: items as FluxoraModOrderItem[], accepted: false };
  }

  let rowOrderId = session.rowOrderId;
  let nextItems = items.map((item) => {
    const patch = snapshot.rows.find((candidate) => itemMatchesPatch(item, candidate));
    if (!patch) {
      return item;
    }

    return {
      ...item,
      modUuid: patch.modUuid || item.modUuid,
      fileCount: patch.fileCount,
      conflictingFileCount: patch.conflictingFileCount,
      overwrittenFileCount: patch.overwrittenFileCount,
      overwritingFileCount: patch.overwritingFileCount,
      overwritesModIds: [...patch.overwritesModIds],
      overwrittenByModIds: [...patch.overwrittenByModIds],
      conflictStatus: conflictStatus(patch.conflictingFileCount)
    };
  });

  if (snapshot.orderId && snapshot.orderId !== rowOrderId) {
    nextItems = nextItems.map((item) =>
      item.orderId === rowOrderId
        ? { ...item, orderId: snapshot.orderId }
        : item
    );
    rowOrderId = snapshot.orderId;
  }

  return {
    accepted: true,
    items: renumber(nextItems),
    session: {
      ...session,
      rowOrderId,
      desiredTargetIndex: session.hasUserRebased
        ? session.desiredTargetIndex
        : snapshot.targetIndex,
      revision: snapshot.revision,
      state: snapshot.state
    }
  };
};

const installSummaryItem = (
  current: FluxoraModOrderItem,
  installed: FluxoraInstalledModSummary,
  orderId: string
): FluxoraModOrderItem => {
  const canCheckUpdates =
    installed.sourceIsNexus &&
    Boolean(installed.sourceGameDomain?.trim()) &&
    Boolean(installed.sourceModId?.trim()) &&
    Boolean(installed.sourceFileId?.trim());
  const hasUpdate =
    canCheckUpdates &&
    Boolean(installed.latestFileId.trim()) &&
    installed.latestFileId !== installed.sourceFileId;

  return {
    ...current,
    id: installed.id,
    orderId,
    kind: 'mod',
    isSeparator: false,
    isMod: true,
    modUuid: installed.modUuid,
    separatorTitle: '',
    name: installed.name,
    version: installed.version,
    latestVersion: installed.latestVersion,
    latestFileId: installed.latestFileId,
    updateCheckState: installed.updateCheckState,
    updateStatus: '',
    conflictStatus: conflictStatus(installed.conflictingFileCount),
    fileCount: installed.fileCount,
    conflictingFileCount: installed.conflictingFileCount,
    overwrittenFileCount: installed.overwrittenFileCount,
    overwritingFileCount: installed.overwritingFileCount,
    isEnabled: installed.isEnabled,
    canCheckUpdates,
    hasUpdate,
    sourceIsNexus: installed.sourceIsNexus,
    sourceIsModdingFlow: installed.sourceIsModdingFlow,
    sourceProvider: installed.sourceProvider,
    sourceGameDomain: installed.sourceGameDomain,
    sourceModId: installed.sourceModId,
    sourceFileId: installed.sourceFileId,
    sourceUrl: installed.sourceUrl,
    isLocal: installed.isLocal,
    isTranslation: installed.isTranslation,
    isPatch: installed.isPatch,
    overwritesModIds: [...installed.overwritesModIds],
    overwrittenByModIds: [...installed.overwrittenByModIds]
  };
};

export const completePendingInstall = (
  session: PendingInstallSessionState,
  items: readonly FluxoraModOrderItem[],
  installed: FluxoraInstalledModSummary
): CompletedPendingInstallState => {
  if (installed.operationId !== session.operationId) {
    throw new Error('The completed install does not match the pending session.');
  }

  const orderId = installed.orderId.trim() || session.rowOrderId;
  const rowIndex = items.findIndex(
    (item) =>
      item.orderId === session.rowOrderId ||
      item.orderId === session.pendingOrderId ||
      (Boolean(session.targetModUuid) &&
        normalizedIdentity(item.modUuid) === normalizedIdentity(session.targetModUuid))
  );
  const next = [...items];
  if (rowIndex >= 0) {
    next[rowIndex] = installSummaryItem(next[rowIndex], installed, orderId);
  } else {
    next.splice(
      clampedTargetIndex(session.desiredTargetIndex, next.length),
      0,
      installSummaryItem(
        emptyPendingOrderItem(session.operationId, installed.name, session.desiredTargetIndex),
        installed,
        orderId
      )
    );
  }

  return { items: renumber(next), orderId };
};

const restoreConflictProjection = (
  item: FluxoraModOrderItem,
  baseline: FluxoraModOrderItem
): FluxoraModOrderItem => ({
  ...item,
  conflictStatus: baseline.conflictStatus,
  fileCount: baseline.fileCount,
  conflictingFileCount: baseline.conflictingFileCount,
  overwrittenFileCount: baseline.overwrittenFileCount,
  overwritingFileCount: baseline.overwritingFileCount,
  overwritesModIds: [...(baseline.overwritesModIds ?? [])],
  overwrittenByModIds: [...(baseline.overwrittenByModIds ?? [])]
});

export const rollbackPendingInstall = (
  session: PendingInstallSessionState,
  items: readonly FluxoraModOrderItem[]
): FluxoraModOrderItem[] => {
  const baselineByOrderId = new Map(
    session.baselineItems.map((item) => [item.orderId, item] as const)
  );
  let restored = items
    .filter((item) => session.mode !== 0 || item.orderId !== session.rowOrderId)
    .map((item) => {
      const baseline = baselineByOrderId.get(item.orderId);
      return baseline ? restoreConflictProjection(item, baseline) : item;
    });

  if (
    session.mode !== 0 &&
    !session.hasUserRebased &&
    session.originalTargetIndex >= 0
  ) {
    restored = moveToIndex(restored, session.rowOrderId, session.originalTargetIndex);
  }
  return renumber(restored);
};

export const pendingInstallConflictMarkerReady = (
  session: PendingInstallSessionState | null,
  item: FluxoraModOrderItem
): boolean => {
  if (!session || item.orderId !== session.rowOrderId) {
    return true;
  }
  return session.revision > 0 && session.state !== 'preparing';
};

export const pendingInstallTargetIndex = (
  session: PendingInstallSessionState,
  items: readonly FluxoraModOrderItem[]
): number => {
  const index = items.findIndex(
    (item) =>
      item.orderId === session.rowOrderId ||
      item.orderId === session.pendingOrderId ||
      (Boolean(session.targetModUuid) &&
        normalizedIdentity(item.modUuid) === normalizedIdentity(session.targetModUuid))
  );
  return index >= 0 ? index : session.desiredTargetIndex;
};

export const markPendingInstallRebased = (
  session: PendingInstallSessionState,
  targetIndex: number,
  userInitiated: boolean
): PendingInstallSessionState => ({
  ...session,
  desiredTargetIndex: targetIndex,
  hasUserRebased: session.hasUserRebased || userInitiated
});

export const mergePendingInstallIntoAuthoritativeItems = (
  session: PendingInstallSessionState | null,
  currentItems: readonly FluxoraModOrderItem[],
  authoritativeItems: readonly FluxoraModOrderItem[]
): FluxoraModOrderItem[] => {
  if (!session) {
    return renumber(authoritativeItems);
  }

  const currentByIdentity = new Map<string, FluxoraModOrderItem>();
  for (const item of currentItems) {
    currentByIdentity.set(item.orderId, item);
    if (item.modUuid) {
      currentByIdentity.set(`uuid:${normalizedIdentity(item.modUuid)}`, item);
    }
  }

  let merged = authoritativeItems.map((item) => {
    const projected = currentByIdentity.get(item.orderId) ??
      (item.modUuid
        ? currentByIdentity.get(`uuid:${normalizedIdentity(item.modUuid)}`)
        : undefined);
    return projected && session.revision > 0
      ? restoreConflictProjection(item, projected)
      : item;
  });

  if (session.mode === 0) {
    const pending = currentItems.find(
      (item) => item.orderId === session.rowOrderId || item.orderId === session.pendingOrderId
    );
    const alreadyCommitted = authoritativeItems.some(
      (item) => item.orderId === session.rowOrderId && item.orderId !== session.pendingOrderId
    );
    if (pending && !alreadyCommitted) {
      merged.splice(
        clampedTargetIndex(session.desiredTargetIndex, merged.length),
        0,
        pending
      );
    }
  }

  return renumber(merged);
};
