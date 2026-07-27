import type {
  FluxoraInstalledMod,
  FluxoraInstalledModSummary,
  FluxoraModOrderItem,
  FluxoraPluginOrderItem,
  FluxoraRevisionedOrderDelta,
  FluxoraWorkspaceDelta
} from '../../shared/fluxora-api';

export interface WorkspaceDeltaState {
  projectDirectory: string;
  profileName: string;
  revision: string;
  sequence: number;
  mods: FluxoraModOrderItem[];
  installedMods: FluxoraInstalledMod[];
  plugins: FluxoraPluginOrderItem[];
}

export type WorkspaceDeltaApplyStatus =
  | 'applied'
  | 'ignored'
  | 'full-resync-required';

export interface WorkspaceDeltaApplyResult {
  status: WorkspaceDeltaApplyStatus;
  state: WorkspaceDeltaState;
  reason:
    | 'applied'
    | 'duplicate'
    | 'native-history-unavailable'
    | 'scope-mismatch'
    | 'operation-mismatch'
    | 'base-revision-mismatch'
    | 'revision-mismatch'
    | 'sequence-gap'
    | 'invalid-placement';
}

interface ApplyWorkspaceDeltaOptions {
  expectedOperationId?: string;
}

const normalizedKey = (value: string): string =>
  value.trim().toLowerCase();

const applyOrderDelta = <T extends { orderId: string }>(
  current: readonly T[],
  delta: FluxoraRevisionedOrderDelta<T>
): T[] | null => {
  if (
    delta.upserts.length === 0 &&
    delta.removedOrderIds.length === 0 &&
    delta.placements.length === 0
  ) {
    return current as T[];
  }
  if (current.length === 0 && delta.removedOrderIds.length === 0) {
    // A baseline/full snapshot is serialized in authoritative native order.
    // Avoid replaying thousands of redundant placements one-by-one.
    return [...delta.upserts];
  }
  const removed = new Set(delta.removedOrderIds.map(normalizedKey));
  const upsertByOrderId = new Map(
    delta.upserts.map((item) => [normalizedKey(item.orderId), item])
  );
  const next: T[] = [];
  const nextKeys: string[] = [];
  const present = new Set<string>();

  current.forEach((item) => {
    const key = normalizedKey(item.orderId);
    if (removed.has(key)) {
      return;
    }
    const replacement = upsertByOrderId.get(key);
    next.push(replacement ?? item);
    nextKeys.push(key);
    present.add(key);
  });
  delta.upserts.forEach((item) => {
    const key = normalizedKey(item.orderId);
    if (!removed.has(key) && !present.has(key)) {
      next.push(item);
      nextKeys.push(key);
      present.add(key);
    }
  });

  for (const placement of delta.placements) {
    const orderId = normalizedKey(placement.orderId);
    const sourceIndex = nextKeys.indexOf(orderId);
    if (sourceIndex < 0) {
      return null;
    }
    const [item] = next.splice(sourceIndex, 1);
    nextKeys.splice(sourceIndex, 1);
    if (!item) {
      return null;
    }

    let targetIndex = next.length;
    if (placement.beforeOrderId) {
      targetIndex = nextKeys.indexOf(normalizedKey(placement.beforeOrderId));
      if (targetIndex < 0) {
        return null;
      }
    } else if (placement.afterOrderId) {
      const afterIndex = nextKeys.indexOf(normalizedKey(placement.afterOrderId));
      if (afterIndex < 0) {
        return null;
      }
      targetIndex = afterIndex + 1;
    }
    next.splice(targetIndex, 0, item);
    nextKeys.splice(targetIndex, 0, orderId);
  }

  return next;
};

const installedModFromSummary = (
  summary: FluxoraInstalledModSummary,
  current: FluxoraInstalledMod | undefined
): FluxoraInstalledMod => ({
  ...(current ?? {
    id: summary.id,
    name: summary.name,
    version: summary.version,
    latestVersion: summary.latestVersion,
    latestFileId: summary.latestFileId,
    updateCheckState: summary.updateCheckState,
    lastCheckedAt: '',
    updateStatus: '',
    conflictStatus: '',
    fileCount: summary.fileCount,
    conflictingFileCount: summary.conflictingFileCount,
    overwrittenFileCount: summary.overwrittenFileCount,
    overwritingFileCount: summary.overwritingFileCount,
    isEnabled: summary.isEnabled,
    canCheckUpdates: summary.sourceIsNexus || summary.sourceIsModdingFlow,
    hasUpdate: false,
    sourceIsNexus: summary.sourceIsNexus,
    sourceIsModdingFlow: summary.sourceIsModdingFlow,
    isLocal: summary.isLocal,
    isTranslation: summary.isTranslation,
    isPatch: summary.isPatch,
    overwritesModIds: summary.overwritesModIds,
    overwrittenByModIds: summary.overwrittenByModIds
  }),
  ...summary
});

const applyInstalledModDelta = (
  current: readonly FluxoraInstalledMod[],
  upserts: readonly FluxoraInstalledModSummary[],
  removedIds: readonly string[]
): FluxoraInstalledMod[] => {
  if (upserts.length === 0 && removedIds.length === 0) {
    return current as FluxoraInstalledMod[];
  }
  const removed = new Set(removedIds.map(normalizedKey));
  const upsertById = new Map(upserts.map((item) => [normalizedKey(item.id), item]));
  const present = new Set<string>();
  const next: FluxoraInstalledMod[] = [];

  current.forEach((item) => {
    const key = normalizedKey(item.id);
    if (removed.has(key)) {
      return;
    }
    const upsert = upsertById.get(key);
    next.push(upsert ? installedModFromSummary(upsert, item) : item);
    present.add(key);
  });
  upserts.forEach((upsert) => {
    const key = normalizedKey(upsert.id);
    if (!removed.has(key) && !present.has(key)) {
      next.push(installedModFromSummary(upsert, undefined));
    }
  });
  return next;
};

const requiresFullResync = (
  state: WorkspaceDeltaState,
  reason: WorkspaceDeltaApplyResult['reason']
): WorkspaceDeltaApplyResult => ({
  status: 'full-resync-required',
  state,
  reason
});

export const applyWorkspaceDelta = (
  state: WorkspaceDeltaState,
  delta: FluxoraWorkspaceDelta,
  options: ApplyWorkspaceDeltaOptions = {}
): WorkspaceDeltaApplyResult => {
  if (delta.fullResyncRequired) {
    return requiresFullResync(state, 'native-history-unavailable');
  }
  if (
    delta.sequence === state.sequence &&
    delta.mods.revision === state.revision &&
    delta.plugins.revision === state.revision
  ) {
    return { status: 'ignored', state, reason: 'duplicate' };
  }
  if (
    normalizedKey(delta.projectDirectory) !== normalizedKey(state.projectDirectory) ||
    normalizedKey(delta.profileName) !== normalizedKey(state.profileName)
  ) {
    return requiresFullResync(state, 'scope-mismatch');
  }
  if (
    options.expectedOperationId &&
    delta.operationId !== options.expectedOperationId
  ) {
    return requiresFullResync(state, 'operation-mismatch');
  }
  if (
    delta.mods.baseRevision !== state.revision ||
    delta.plugins.baseRevision !== state.revision
  ) {
    return requiresFullResync(state, 'base-revision-mismatch');
  }
  if (
    !delta.mods.revision ||
    delta.mods.revision !== delta.plugins.revision
  ) {
    return requiresFullResync(state, 'revision-mismatch');
  }
  if (delta.sequence !== state.sequence + 1) {
    return requiresFullResync(state, 'sequence-gap');
  }

  const mods = applyOrderDelta(state.mods, delta.mods);
  const plugins = applyOrderDelta(state.plugins, delta.plugins);
  if (!mods || !plugins) {
    return requiresFullResync(state, 'invalid-placement');
  }

  return {
    status: 'applied',
    state: {
      ...state,
      revision: delta.mods.revision,
      sequence: delta.sequence,
      mods,
      installedMods: applyInstalledModDelta(
        state.installedMods,
        delta.installedModUpserts,
        delta.removedInstalledModIds
      ),
      plugins
    },
    reason: 'applied'
  };
};
