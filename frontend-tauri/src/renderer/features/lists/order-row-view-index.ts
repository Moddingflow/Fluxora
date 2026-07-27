import type {
  FluxoraModOrderItem,
  FluxoraModUpdateCheckResult,
  FluxoraPluginOrderItem
} from '../../../shared/fluxora-api';
import {
  isModOverwriteItem,
  modConflictMarkerStates,
  modConflictMarkerStatesForHighlight,
  modTableStatusView,
  type ModConflictHighlight,
  type ModConflictMarkerState,
  type ModTableStatusView
} from '../../mod-workspace-state';
import {
  pluginMissingMasterSummary,
  sortedPluginMissingMasters,
  type PluginMissingMasterContext,
  type PluginMissingMasterSummary
} from '../../plugin-workspace-state';
import {
  modUpdateFreshnessView,
  type ModUpdateFreshnessView
} from '../../services/mod-update-status';

const normalizeModReference = (value: string | null | undefined): string =>
  value?.trim().toLocaleLowerCase() ?? '';

const itemMatchesReferenceSet = (
  item: FluxoraModOrderItem,
  references: ReadonlySet<string>
): boolean =>
  [item.id, item.orderId, item.modUuid].some((value) =>
    references.has(normalizeModReference(value))
  );

const sameStringArray = (
  left: readonly string[] | null | undefined,
  right: readonly string[] | null | undefined
): boolean => {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
};

export const modOrderItemPresentationKey = (
  item: FluxoraModOrderItem
): string => [
  item.orderId,
  item.id,
  item.kind,
  item.isSeparator ? '1' : '0',
  item.isMod ? '1' : '0',
  item.modUuid,
  item.separatorTitle,
  item.name,
  item.version,
  item.latestVersion,
  item.latestFileId,
  item.updateCheckState,
  item.lastCheckedAt,
  item.updateStatus,
  item.conflictStatus,
  item.fileCount,
  item.conflictingFileCount,
  item.overwrittenFileCount,
  item.overwritingFileCount,
  item.isEnabled ? '1' : '0',
  item.canCheckUpdates ? '1' : '0',
  item.hasUpdate ? '1' : '0',
  item.sourceIsNexus ? '1' : '0',
  item.sourceIsModdingFlow ? '1' : '0',
  item.sourceProvider ?? '',
  item.sourceGameDomain ?? '',
  item.sourceModId ?? '',
  item.sourceFileId ?? '',
  item.sourceUrl ?? '',
  item.isLocal ? '1' : '0',
  item.isTranslation ? '1' : '0',
  item.isPatch ? '1' : '0',
  item.overwritesModIds?.join('\u001e') ?? '',
  item.overwrittenByModIds?.join('\u001e') ?? ''
].join('\u001f');

export const pluginOrderItemPresentationKey = (
  item: FluxoraPluginOrderItem
): string => [
  item.orderId,
  item.id,
  item.kind,
  item.order,
  item.isSeparator ? '1' : '0',
  item.isPlugin ? '1' : '0',
  item.name,
  item.separatorTitle,
  item.extension,
  item.sourceMod,
  item.isEnabled ? '1' : '0',
  item.isMaster ? '1' : '0',
  item.isLight ? '1' : '0',
  item.hasLightFlag ? '1' : '0',
  item.isLocked ? '1' : '0',
  item.lockReason,
  item.masterFiles?.join('\u001e') ?? '',
  item.missingMasters?.join('\u001e') ?? ''
].join('\u001f');

const sameModOrderItemPresentation = (
  left: FluxoraModOrderItem,
  right: FluxoraModOrderItem
): boolean =>
  left.orderId === right.orderId &&
  left.id === right.id &&
  left.kind === right.kind &&
  left.isSeparator === right.isSeparator &&
  left.isMod === right.isMod &&
  left.modUuid === right.modUuid &&
  left.separatorTitle === right.separatorTitle &&
  left.name === right.name &&
  left.version === right.version &&
  left.latestVersion === right.latestVersion &&
  left.latestFileId === right.latestFileId &&
  left.updateCheckState === right.updateCheckState &&
  left.lastCheckedAt === right.lastCheckedAt &&
  left.updateStatus === right.updateStatus &&
  left.conflictStatus === right.conflictStatus &&
  left.fileCount === right.fileCount &&
  left.conflictingFileCount === right.conflictingFileCount &&
  left.overwrittenFileCount === right.overwrittenFileCount &&
  left.overwritingFileCount === right.overwritingFileCount &&
  left.isEnabled === right.isEnabled &&
  left.canCheckUpdates === right.canCheckUpdates &&
  left.hasUpdate === right.hasUpdate &&
  left.sourceIsNexus === right.sourceIsNexus &&
  left.sourceIsModdingFlow === right.sourceIsModdingFlow &&
  (left.sourceProvider ?? '') === (right.sourceProvider ?? '') &&
  (left.sourceGameDomain ?? '') === (right.sourceGameDomain ?? '') &&
  (left.sourceModId ?? '') === (right.sourceModId ?? '') &&
  (left.sourceFileId ?? '') === (right.sourceFileId ?? '') &&
  (left.sourceUrl ?? '') === (right.sourceUrl ?? '') &&
  left.isLocal === right.isLocal &&
  left.isTranslation === right.isTranslation &&
  left.isPatch === right.isPatch &&
  sameStringArray(left.overwritesModIds, right.overwritesModIds) &&
  sameStringArray(left.overwrittenByModIds, right.overwrittenByModIds);

const samePluginOrderItemPresentation = (
  left: FluxoraPluginOrderItem,
  right: FluxoraPluginOrderItem
): boolean =>
  left.orderId === right.orderId &&
  left.id === right.id &&
  left.kind === right.kind &&
  left.order === right.order &&
  left.isSeparator === right.isSeparator &&
  left.isPlugin === right.isPlugin &&
  left.name === right.name &&
  left.separatorTitle === right.separatorTitle &&
  left.extension === right.extension &&
  left.sourceMod === right.sourceMod &&
  left.isEnabled === right.isEnabled &&
  left.isMaster === right.isMaster &&
  left.isLight === right.isLight &&
  left.hasLightFlag === right.hasLightFlag &&
  left.isLocked === right.isLocked &&
  left.lockReason === right.lockReason &&
  sameStringArray(left.masterFiles ?? [], right.masterFiles ?? []) &&
  sameStringArray(left.missingMasters ?? [], right.missingMasters ?? []);

export const modRowViewPresentationKey = (
  view: Omit<ModRowView, 'item' | 'index'>
): string => [
  view.parentSeparatorOrderId ?? '',
  view.isNested ? '1' : '0',
  view.isCollapsed ? '1' : '0',
  view.separatorChildCount,
  view.priority ?? '',
  view.conflictHighlight,
  view.visibleConflictHighlight,
  view.conflictMarkerStates.join(','),
  view.visibleConflictMarkerStates.join(','),
  view.updateCheckState,
  view.status.label,
  view.status.tone,
  view.status.overwrite.label,
  view.status.overwrite.state,
  view.status.overwrite.title,
  view.updateFreshness.label ?? '',
  view.updateFreshness.tone,
  view.updateFreshness.title
].join('\u001f');

export const pluginRowViewPresentationKey = (
  view: Omit<PluginRowView, 'item' | 'index'>
): string => [
  view.parentSeparatorOrderId ?? '',
  view.isNested ? '1' : '0',
  view.isCollapsed ? '1' : '0',
  view.separatorChildCount,
  view.missingMasterSummary.totalCount,
  view.missingMasterSummary.hiddenCount,
  view.missingMasterSummary.visibleMasters.join('\u001e')
].join('\u001f');

export interface ModRowView {
  item: FluxoraModOrderItem;
  index: number;
  parentSeparatorOrderId: string | null;
  isNested: boolean;
  isCollapsed: boolean;
  separatorChildCount: number;
  priority: number | null;
  conflictHighlight: ModConflictHighlight;
  visibleConflictHighlight: ModConflictHighlight;
  conflictMarkerStates: ModConflictMarkerState[];
  visibleConflictMarkerStates: ModConflictMarkerState[];
  updateCheckState: string;
  status: ModTableStatusView;
  updateFreshness: ModUpdateFreshnessView;
}

export interface ModRowViewIndex {
  rows: ModRowView[];
  byOrderId: ReadonlyMap<string, ModRowView>;
  selectedItemPresentationKey?: string;
}

export interface BuildModRowViewIndexOptions {
  selectedItem: FluxoraModOrderItem | null;
  collapsedSeparatorOrderIds: ReadonlySet<string>;
  updateResult?: FluxoraModUpdateCheckResult;
  conflictMarkerReadyByOrderId?: ReadonlyMap<string, boolean>;
}

interface ModRowDraft {
  item: FluxoraModOrderItem;
  index: number;
  parentSeparatorOrderId: string | null;
  isNested: boolean;
  isCollapsed: boolean;
  separatorChildCount: number;
  priority: number | null;
  conflictHighlight: ModConflictHighlight;
  conflictMarkerStates: ModConflictMarkerState[];
  updateCheckState: string;
}

const tryBuildFlatModRowViewIndex = (
  items: readonly FluxoraModOrderItem[],
  options: BuildModRowViewIndexOptions,
  previous?: ModRowViewIndex
): ModRowViewIndex | undefined => {
  const selectedItemPresentationKey = options.selectedItem
    ? modOrderItemPresentationKey(options.selectedItem)
    : '';
  if (
    !previous ||
    previous.rows.length !== items.length ||
    previous.selectedItemPresentationKey !== selectedItemPresentationKey ||
    options.collapsedSeparatorOrderIds.size > 0 ||
    options.updateResult !== undefined ||
    (options.conflictMarkerReadyByOrderId?.size ?? 0) > 0
  ) {
    return undefined;
  }

  const rows: ModRowView[] = [];
  const byOrderId = new Map<string, ModRowView>();
  const selected = options.selectedItem;
  const selectedOverwrites = new Set(
    (selected?.overwritesModIds ?? []).map(normalizeModReference).filter(Boolean)
  );
  const selectedOverwrittenBy = new Set(
    (selected?.overwrittenByModIds ?? []).map(normalizeModReference).filter(Boolean)
  );
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const previousView = previous.rows[index];
    if (
      !item?.isMod ||
      item.isSeparator ||
      !previousView?.item.isMod ||
      previousView.item.isSeparator
    ) {
      return undefined;
    }

    if (
      previousView.item === item ||
      sameModOrderItemPresentation(previousView.item, item)
    ) {
      rows.push(previousView);
      byOrderId.set(item.orderId, previousView);
      continue;
    }

    let conflictHighlight: ModConflictHighlight = 'none';
    if (
      selected?.isMod &&
      item.orderId !== selected.orderId &&
      !isModOverwriteItem(item) &&
      !isModOverwriteItem(selected)
    ) {
      const selectedOverwritesItem = itemMatchesReferenceSet(item, selectedOverwrites);
      const itemOverwritesSelected = itemMatchesReferenceSet(item, selectedOverwrittenBy);
      conflictHighlight = selectedOverwritesItem && itemOverwritesSelected
        ? 'mixed'
        : selectedOverwritesItem
          ? 'overwrites'
          : itemOverwritesSelected
            ? 'overwritten'
            : 'none';
    }
    const conflictMarkerStates = modConflictMarkerStates(item);
    const row: ModRowView = {
      item,
      index,
      parentSeparatorOrderId: null,
      isNested: false,
      isCollapsed: false,
      separatorChildCount: 0,
      priority: index + 1,
      conflictHighlight,
      visibleConflictHighlight: conflictHighlight,
      conflictMarkerStates,
      visibleConflictMarkerStates: conflictMarkerStates,
      updateCheckState: item.updateCheckState,
      status: modTableStatusView(item),
      updateFreshness: modUpdateFreshnessView(item, undefined)
    };
    rows.push(row);
    byOrderId.set(item.orderId, row);
  }

  return { rows, byOrderId, selectedItemPresentationKey };
};

export const buildModRowViewIndex = (
  items: readonly FluxoraModOrderItem[],
  options: BuildModRowViewIndexOptions,
  previous?: ModRowViewIndex
): ModRowViewIndex => {
  const flatIndex = tryBuildFlatModRowViewIndex(items, options, previous);
  if (flatIndex) {
    return flatIndex;
  }

  const selected = options.selectedItem;
  const selectedItemPresentationKey = selected
    ? modOrderItemPresentationKey(selected)
    : '';
  const selectedOverwrites = new Set(
    (selected?.overwritesModIds ?? []).map(normalizeModReference).filter(Boolean)
  );
  const selectedOverwrittenBy = new Set(
    (selected?.overwrittenByModIds ?? []).map(normalizeModReference).filter(Boolean)
  );
  const updateByFolderName = new Map(
    (options.updateResult?.mods ?? []).map((mod) => [
      normalizeModReference(mod.folderName),
      mod
    ])
  );
  const drafts: ModRowDraft[] = [];
  const separatorDraftByOrderId = new Map<string, ModRowDraft>();
  const separatorSelectedOverwritesChild = new Set<string>();
  const separatorChildOverwritesSelected = new Set<string>();
  let activeSeparatorOrderId: string | null = null;
  let priority = 0;

  items.forEach((item, index) => {
    if (item.isSeparator) {
      activeSeparatorOrderId = item.orderId;
    }

    const parentSeparatorOrderId = item.isSeparator ? null : activeSeparatorOrderId;
    const isNested = parentSeparatorOrderId !== null;
    if (item.isMod) {
      priority += 1;
    }

    let conflictHighlight: ModConflictHighlight = 'none';
    if (
      item.isMod &&
      selected?.isMod &&
      item.orderId !== selected.orderId &&
      !isModOverwriteItem(item) &&
      !isModOverwriteItem(selected)
    ) {
      const selectedOverwritesItem = itemMatchesReferenceSet(item, selectedOverwrites);
      const itemOverwritesSelected = itemMatchesReferenceSet(item, selectedOverwrittenBy);
      conflictHighlight = selectedOverwritesItem && itemOverwritesSelected
        ? 'mixed'
        : selectedOverwritesItem
          ? 'overwrites'
          : itemOverwritesSelected
            ? 'overwritten'
            : 'none';

      if (parentSeparatorOrderId) {
        if (selectedOverwritesItem) {
          separatorSelectedOverwritesChild.add(parentSeparatorOrderId);
        }
        if (itemOverwritesSelected) {
          separatorChildOverwritesSelected.add(parentSeparatorOrderId);
        }
      }
    }

    const appliedUpdate = updateByFolderName.get(normalizeModReference(item.name));
    const draft: ModRowDraft = {
      item,
      index,
      parentSeparatorOrderId,
      isNested,
      isCollapsed:
        item.isSeparator && options.collapsedSeparatorOrderIds.has(item.orderId),
      separatorChildCount: 0,
      priority: item.isMod ? priority : null,
      conflictHighlight,
      conflictMarkerStates: item.isSeparator ? [] : modConflictMarkerStates(item),
      updateCheckState: appliedUpdate?.updateCheckState ?? item.updateCheckState
    };
    drafts.push(draft);

    if (item.isSeparator) {
      separatorDraftByOrderId.set(item.orderId, draft);
    } else if (activeSeparatorOrderId) {
      const separatorDraft = separatorDraftByOrderId.get(activeSeparatorOrderId);
      if (separatorDraft) {
        separatorDraft.separatorChildCount += 1;
      }
    }
  });

  separatorDraftByOrderId.forEach((draft, orderId) => {
    draft.conflictHighlight = separatorSelectedOverwritesChild.has(orderId)
      ? 'overwritten'
      : separatorChildOverwritesSelected.has(orderId)
        ? 'overwrites'
        : 'none';
    draft.conflictMarkerStates = modConflictMarkerStatesForHighlight(
      draft.conflictHighlight
    );
  });

  const rows = drafts.map((draft): ModRowView => {
    const conflictMarkerReady =
      options.conflictMarkerReadyByOrderId?.get(draft.item.orderId) ?? true;
    const visibleConflictHighlight = conflictMarkerReady
      ? draft.item.isSeparator
        ? draft.isCollapsed
          ? draft.conflictHighlight
          : 'none'
        : draft.conflictHighlight
      : 'none';
    const visibleConflictMarkerStates = conflictMarkerReady
      ? draft.item.isSeparator
        ? draft.isCollapsed
          ? draft.conflictMarkerStates
          : []
        : draft.conflictMarkerStates
      : [];
    const updateItem =
      draft.updateCheckState === draft.item.updateCheckState
        ? draft.item
        : { ...draft.item, updateCheckState: draft.updateCheckState };
    const derived = {
      parentSeparatorOrderId: draft.parentSeparatorOrderId,
      isNested: draft.isNested,
      isCollapsed: draft.isCollapsed,
      separatorChildCount: draft.separatorChildCount,
      priority: draft.priority,
      conflictHighlight: draft.conflictHighlight,
      visibleConflictHighlight,
      conflictMarkerStates: draft.conflictMarkerStates,
      visibleConflictMarkerStates,
      updateCheckState: draft.updateCheckState,
      status: modTableStatusView(draft.item),
      updateFreshness: modUpdateFreshnessView(updateItem, options.updateResult)
    };
    const previousView = previous?.byOrderId.get(draft.item.orderId);
    if (
      previousView?.item === draft.item &&
      modRowViewPresentationKey(previousView) === modRowViewPresentationKey(derived)
    ) {
      return previousView;
    }

    return {
      item: draft.item,
      index: draft.index,
      ...derived
    };
  });

  return {
    rows,
    byOrderId: new Map(rows.map((row) => [row.item.orderId, row])),
    selectedItemPresentationKey
  };
};

export interface PluginRowView {
  item: FluxoraPluginOrderItem;
  index: number;
  parentSeparatorOrderId: string | null;
  isNested: boolean;
  isCollapsed: boolean;
  separatorChildCount: number;
  missingMasterSummary: PluginMissingMasterSummary;
}

export interface PluginRowViewIndex {
  rows: PluginRowView[];
  byOrderId: ReadonlyMap<string, PluginRowView>;
}

export interface BuildPluginRowViewIndexOptions {
  collapsedSeparatorOrderIds: ReadonlySet<string>;
  missingMasterContext?: PluginMissingMasterContext;
  missingMasterLimit?: number;
}

interface PluginRowDraft {
  item: FluxoraPluginOrderItem;
  index: number;
  parentSeparatorOrderId: string | null;
  isNested: boolean;
  isCollapsed: boolean;
  separatorChildCount: number;
  missingMasterSummary: PluginMissingMasterSummary;
  separatorMissingMasters: Map<string, string>;
}

const emptyMissingMasterSummary = (): PluginMissingMasterSummary => ({
  totalCount: 0,
  visibleMasters: [],
  hiddenCount: 0
});

const tryBuildFlatPluginRowViewIndex = (
  items: readonly FluxoraPluginOrderItem[],
  options: BuildPluginRowViewIndexOptions,
  previous?: PluginRowViewIndex
): PluginRowViewIndex | undefined => {
  if (
    !previous ||
    previous.rows.length !== items.length ||
    options.collapsedSeparatorOrderIds.size > 0
  ) {
    return undefined;
  }

  const rows: PluginRowView[] = [];
  const byOrderId = new Map<string, PluginRowView>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const previousView = previous.rows[index];
    if (
      !item?.isPlugin ||
      item.isSeparator ||
      (item.masterFiles?.length ?? 0) > 0 ||
      (item.missingMasters?.length ?? 0) > 0 ||
      !previousView?.item.isPlugin ||
      previousView.item.isSeparator ||
      (previousView.item.masterFiles?.length ?? 0) > 0 ||
      (previousView.item.missingMasters?.length ?? 0) > 0
    ) {
      return undefined;
    }

    if (
      previousView.item === item ||
      samePluginOrderItemPresentation(previousView.item, item)
    ) {
      rows.push(previousView);
      byOrderId.set(item.orderId, previousView);
      continue;
    }

    const row: PluginRowView = {
      item,
      index,
      parentSeparatorOrderId: null,
      isNested: false,
      isCollapsed: false,
      separatorChildCount: 0,
      missingMasterSummary: emptyMissingMasterSummary()
    };
    rows.push(row);
    byOrderId.set(item.orderId, row);
  }

  return { rows, byOrderId };
};

export const buildPluginRowViewIndex = (
  items: readonly FluxoraPluginOrderItem[],
  options: BuildPluginRowViewIndexOptions,
  previous?: PluginRowViewIndex
): PluginRowViewIndex => {
  const flatIndex = tryBuildFlatPluginRowViewIndex(items, options, previous);
  if (flatIndex) {
    return flatIndex;
  }

  const context = options.missingMasterContext ?? {};
  const limit = Math.max(0, options.missingMasterLimit ?? 20);
  const drafts: PluginRowDraft[] = [];
  const separatorDraftByOrderId = new Map<string, PluginRowDraft>();
  let activeSeparatorOrderId: string | null = null;

  items.forEach((item, index) => {
    if (item.isSeparator) {
      activeSeparatorOrderId = item.orderId;
    }
    const parentSeparatorOrderId = item.isSeparator ? null : activeSeparatorOrderId;
    const draft: PluginRowDraft = {
      item,
      index,
      parentSeparatorOrderId,
      isNested: parentSeparatorOrderId !== null,
      isCollapsed:
        item.isSeparator && options.collapsedSeparatorOrderIds.has(item.orderId),
      separatorChildCount: 0,
      missingMasterSummary: item.isSeparator
        ? emptyMissingMasterSummary()
        : pluginMissingMasterSummary(item, limit, context),
      separatorMissingMasters: new Map()
    };
    drafts.push(draft);

    if (item.isSeparator) {
      separatorDraftByOrderId.set(item.orderId, draft);
      return;
    }
    if (!activeSeparatorOrderId) {
      return;
    }

    const separatorDraft = separatorDraftByOrderId.get(activeSeparatorOrderId);
    if (!separatorDraft) {
      return;
    }
    separatorDraft.separatorChildCount += 1;
    sortedPluginMissingMasters(item, context).forEach((master) => {
      const key = master.toLocaleLowerCase();
      if (!separatorDraft.separatorMissingMasters.has(key)) {
        separatorDraft.separatorMissingMasters.set(key, master);
      }
    });
  });

  separatorDraftByOrderId.forEach((draft) => {
    if (!draft.isCollapsed) {
      return;
    }
    const sorted = [...draft.separatorMissingMasters.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
    );
    draft.missingMasterSummary = {
      totalCount: sorted.length,
      visibleMasters: sorted.slice(0, limit),
      hiddenCount: Math.max(0, sorted.length - limit)
    };
  });

  const rows = drafts.map((draft): PluginRowView => {
    const derived = {
      parentSeparatorOrderId: draft.parentSeparatorOrderId,
      isNested: draft.isNested,
      isCollapsed: draft.isCollapsed,
      separatorChildCount: draft.separatorChildCount,
      missingMasterSummary: draft.missingMasterSummary
    };
    const previousView = previous?.byOrderId.get(draft.item.orderId);
    if (
      previousView?.item === draft.item &&
      pluginRowViewPresentationKey(previousView) === pluginRowViewPresentationKey(derived) &&
      sameStringArray(
        previousView.missingMasterSummary.visibleMasters,
        derived.missingMasterSummary.visibleMasters
      )
    ) {
      return previousView;
    }

    return {
      item: draft.item,
      index: draft.index,
      ...derived
    };
  });

  return {
    rows,
    byOrderId: new Map(rows.map((row) => [row.item.orderId, row]))
  };
};
