import type {
  FluxoraModFileTreeEntry,
  FluxoraModOrderItem
} from '../shared/fluxora-api';
import {
  isOrderItemHiddenByCollapsedSeparator,
  orderItemNestedUnderSeparator,
  parentSeparatorForOrderItem,
  pruneCollapsedSeparators,
  reorderOrderItems,
  separatorChildCount,
  targetIndexForOrderDrop,
  targetIndexForOrderMove,
  visibleOrderItems,
  type OrderDropPlacement
} from './order-list-state';
import {
  emptyOrderSelectionState,
  pruneOrderSelection,
  selectAllOrderItems,
  selectOrderItem,
  selectOrderItemRange,
  toggleOrderItemSelection
} from './order-selection-state';

export type ModWorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface ModWorkspaceState {
  items: FluxoraModOrderItem[];
  selectedOrderId: string | null;
  selectedOrderIds: ReadonlySet<string>;
  selectionAnchorOrderId: string | null;
  rangeExcludedOrderIds: ReadonlySet<string>;
  rangeBaseOrderIds: ReadonlySet<string>;
  collapsedSeparatorOrderIds: ReadonlySet<string>;
  searchText: string;
  loadState: ModWorkspaceLoadState;
  errorMessage: string | null;
}

export type ModWorkspaceAction =
  | { type: 'load-started' }
  | { type: 'load-failed'; message: string }
  | { type: 'items-loaded'; items: FluxoraModOrderItem[] }
  | { type: 'items-reordered'; orderId: string; targetIndex: number }
  | { type: 'item-enabled-set'; orderId: string; isEnabled: boolean }
  | { type: 'all-items-enabled-set'; isEnabled: boolean }
  | { type: 'separator-collapse-toggled'; orderId: string }
  | { type: 'all-separators-collapse-set'; isCollapsed: boolean }
  | { type: 'search-changed'; searchText: string }
  | { type: 'selected'; orderId: string | null }
  | { type: 'selection-toggled'; orderId: string; orderedOrderIds: readonly string[] }
  | {
      type: 'selection-range-selected';
      orderId: string;
      orderedOrderIds: readonly string[];
      additive: boolean;
    }
  | { type: 'all-selected'; orderedOrderIds: readonly string[] };

export const emptyModWorkspaceState = (): ModWorkspaceState => ({
  items: [],
  ...emptyOrderSelectionState(),
  collapsedSeparatorOrderIds: new Set<string>(),
  searchText: '',
  loadState: 'idle',
  errorMessage: null
});

export const overwriteOrderItemId = '__fluxora_overwrite__';

export const isModOverwriteItem = (item: FluxoraModOrderItem | null | undefined): boolean =>
  item?.isOverwrite === true || item?.kind === 'overwrite';

export const overwriteFolderLabel = (
  projectName: string,
  language: string | undefined
): string => {
  const buildName = projectName.trim() || 'Build';
  const normalizedLanguage = language?.toLocaleLowerCase() ?? '';

  if (normalizedLanguage.startsWith('ru')) {
    return `${buildName} · Папка выхода файлов`;
  }

  if (normalizedLanguage.startsWith('de')) {
    return `${buildName} · Ausgabedateien`;
  }

  return `${buildName} · Output files folder`;
};

export const createOverwriteOrderItem = (
  projectName: string,
  overwriteDirectory: string,
  language?: string
): FluxoraModOrderItem => ({
  id: overwriteDirectory,
  orderId: overwriteOrderItemId,
  kind: 'overwrite',
  order: Number.MAX_SAFE_INTEGER,
  isSeparator: false,
  isMod: false,
  isOverwrite: true,
  modUuid: '',
  separatorTitle: '',
  name: overwriteFolderLabel(projectName, language),
  version: '',
  latestVersion: '',
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
});

export const modItemTitle = (item: FluxoraModOrderItem): string =>
  isModOverwriteItem(item)
    ? item.name || 'Overwrite'
    : item.isSeparator
      ? item.separatorTitle || 'Separator'
      : item.name || item.id;

export const removeModOrderItems = (
  items: readonly FluxoraModOrderItem[],
  orderIds: ReadonlySet<string>
): FluxoraModOrderItem[] => items.filter((item) => !orderIds.has(item.orderId));

export type ModOverwriteState = 'none' | 'overwrites' | 'overwritten' | 'mixed' | 'fully-overwritten';
export type ModConflictMarkerState = 'overwrites' | 'overwritten' | 'fully-overwritten';
export type ModConflictHighlight = 'none' | 'overwrites' | 'overwritten' | 'mixed';

export interface ModOverwriteView {
  state: ModOverwriteState;
  label: string;
  title: string;
}

const safeCount = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

const conflictStatusLooksRelevant = (status: string): boolean => {
  const normalized = status.trim().toLocaleLowerCase();
  return Boolean(normalized) && ![
    'none',
    'ok',
    'clean',
    'normal',
    'конфликтов нет',
    'файлов нет',
    'файлы не просканированы'
  ].includes(normalized);
};

export const modOverwriteView = (item: FluxoraModOrderItem): ModOverwriteView => {
  if (isModOverwriteItem(item)) {
    return {
      state: 'none',
      label: '',
      title: 'Generated game and tool files are written here after mods'
    };
  }

  if (!item.isMod) {
    return {
      state: 'none',
      label: '',
      title: 'Separator'
    };
  }

  const overwritten = safeCount(item.overwrittenFileCount);
  const overwriting = safeCount(item.overwritingFileCount);
  const conflicting = safeCount(item.conflictingFileCount);
  const fileCount = safeCount(item.fileCount);

  if (overwritten > 0 && fileCount > 0 && overwritten >= fileCount && overwriting === 0) {
    return {
      state: 'fully-overwritten',
      label: 'Fully overwritten',
      title: `All ${fileCount} mod files are overwritten by later mods`
    };
  }

  if (overwritten > 0 && overwriting > 0) {
    return {
      state: 'mixed',
      label: 'Mixed overwrite',
      title: `Overwrites ${overwriting} files and is overwritten on ${overwritten} files`
    };
  }

  if (overwriting > 0) {
    return {
      state: 'overwrites',
      label: 'Overwrites',
      title: `Overwrites ${overwriting} files from earlier mods`
    };
  }

  if (overwritten > 0) {
    return {
      state: 'overwritten',
      label: 'Overwritten',
      title: `Overwritten on ${overwritten} files by later mods`
    };
  }

  if (conflicting > 0 || conflictStatusLooksRelevant(item.conflictStatus)) {
    return {
      state: 'mixed',
      label: 'Conflict',
      title: item.conflictStatus || `${conflicting} conflicting files`
    };
  }

  return {
    state: 'none',
    label: 'No overwrite',
    title: 'No file overwrite conflicts'
  };
};

const conflictMarkerStateOrder: ModConflictMarkerState[] = [
  'overwrites',
  'overwritten',
  'fully-overwritten'
];

const normalizedModReference = (value: string): string => value.trim().toLocaleLowerCase();

const itemMatchesModReference = (
  item: FluxoraModOrderItem,
  reference: string
): boolean => {
  const normalized = normalizedModReference(reference);
  if (!normalized) {
    return false;
  }

  return [item.id, item.orderId, item.modUuid]
    .map(normalizedModReference)
    .includes(normalized);
};

const uniqueOrderedConflictStates = (
  states: Iterable<ModConflictMarkerState>
): ModConflictMarkerState[] => {
  const set = new Set(states);
  return conflictMarkerStateOrder.filter((state) => set.has(state));
};

const appendOverwriteStateMarkers = (
  markers: Set<ModConflictMarkerState>,
  state: ModOverwriteState
) => {
  if (state === 'overwrites' || state === 'mixed') {
    markers.add('overwrites');
  }

  if (state === 'overwritten' || state === 'mixed') {
    markers.add('overwritten');
  }

  if (state === 'fully-overwritten') {
    markers.add('fully-overwritten');
  }
};

const modSeparatorChildren = (
  items: FluxoraModOrderItem[],
  separatorOrderId: string
): FluxoraModOrderItem[] => {
  const separatorIndex = items.findIndex((item) => item.orderId === separatorOrderId);
  if (separatorIndex < 0 || !items[separatorIndex]?.isSeparator) {
    return [];
  }

  const children: FluxoraModOrderItem[] = [];
  for (let index = separatorIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.isSeparator) {
      break;
    }

    if (item.isMod) {
      children.push(item);
    }
  }

  return children;
};

export const modConflictMarkerStates = (
  item: FluxoraModOrderItem
): ModConflictMarkerState[] => {
  if (!item.isMod || isModOverwriteItem(item)) {
    return [];
  }

  const markers = new Set<ModConflictMarkerState>();
  appendOverwriteStateMarkers(markers, modOverwriteView(item).state);
  return uniqueOrderedConflictStates(markers);
};

export const modSeparatorConflictMarkerStates = (
  items: FluxoraModOrderItem[],
  separatorOrderId: string
): ModConflictMarkerState[] => {
  const markers = new Set<ModConflictMarkerState>();
  modSeparatorChildren(items, separatorOrderId).forEach((item) => {
    modConflictMarkerStates(item).forEach((state) => markers.add(state));
  });

  return uniqueOrderedConflictStates(markers);
};

export const modItemConflictHighlight = (
  item: FluxoraModOrderItem,
  selected: FluxoraModOrderItem | null
): ModConflictHighlight => {
  if (
    !item.isMod ||
    !selected?.isMod ||
    item.orderId === selected.orderId ||
    isModOverwriteItem(item) ||
    isModOverwriteItem(selected)
  ) {
    return 'none';
  }

  const selectedOverwritesItem = (selected.overwritesModIds ?? []).some((modId) =>
    itemMatchesModReference(item, modId)
  );
  const itemOverwritesSelected = (selected.overwrittenByModIds ?? []).some((modId) =>
    itemMatchesModReference(item, modId)
  );

  if (selectedOverwritesItem && itemOverwritesSelected) {
    return 'mixed';
  }

  if (selectedOverwritesItem) {
    return 'overwrites';
  }

  if (itemOverwritesSelected) {
    return 'overwritten';
  }

  return 'none';
};

export const modRowConflictHighlight = (
  items: FluxoraModOrderItem[],
  item: FluxoraModOrderItem,
  selected: FluxoraModOrderItem | null
): ModConflictHighlight => {
  if (!item.isSeparator) {
    return modItemConflictHighlight(item, selected);
  }

  if (!selected?.isMod || isModOverwriteItem(selected)) {
    return 'none';
  }

  let selectedOverwritesSeparatorChild = false;
  let separatorChildOverwritesSelected = false;
  modSeparatorChildren(items, item.orderId).forEach((child) => {
    selectedOverwritesSeparatorChild =
      selectedOverwritesSeparatorChild ||
      (selected.overwritesModIds ?? []).some((modId) => itemMatchesModReference(child, modId));
    separatorChildOverwritesSelected =
      separatorChildOverwritesSelected ||
      (selected.overwrittenByModIds ?? []).some((modId) => itemMatchesModReference(child, modId));
  });

  if (selectedOverwritesSeparatorChild) {
    return 'overwritten';
  }

  if (separatorChildOverwritesSelected) {
    return 'overwrites';
  }

  return 'none';
};

export const modConflictMarkerStatesForHighlight = (
  highlight: ModConflictHighlight
): ModConflictMarkerState[] => {
  if (highlight === 'mixed') {
    return ['overwrites', 'overwritten'];
  }

  if (highlight === 'overwrites' || highlight === 'overwritten') {
    return [highlight];
  }

  return [];
};

export const modVersionText = (item: FluxoraModOrderItem): string => {
  if (!item.isMod) {
    return '';
  }

  return item.version.trim() || 'local';
};

export const modLatestVersionText = (item: FluxoraModOrderItem): string => {
  if (!item.isMod) {
    return '';
  }

  if (item.latestVersion.trim()) {
    return item.latestVersion;
  }

  if (item.hasUpdate) {
    return 'available';
  }

  return item.canCheckUpdates ? 'not checked' : 'local';
};

export type ModTableStatusTone = 'disabled' | 'update' | 'conflict' | 'local' | 'ready';

export interface ModTableStatusView {
  label: string;
  overwrite: ModOverwriteView;
  tone: ModTableStatusTone;
}

export const modTableStatusView = (item: FluxoraModOrderItem): ModTableStatusView => {
  if (isModOverwriteItem(item)) {
    return {
      label: 'Output folder',
      overwrite: modOverwriteView(item),
      tone: 'local'
    };
  }

  if (!item.isMod) {
    return {
      label: 'Separator',
      overwrite: modOverwriteView(item),
      tone: 'local'
    };
  }

  const overwrite = modOverwriteView(item);
  if (!item.isEnabled) {
    return {
      label: 'Disabled',
      overwrite: {
        ...overwrite,
        state: 'none',
        title: 'Disabled mods do not participate in overwrite resolution'
      },
      tone: 'disabled'
    };
  }

  if (overwrite.state !== 'none') {
    return {
      label: overwrite.label,
      overwrite,
      tone: 'conflict'
    };
  }

  return {
    label: 'No overwrite',
    overwrite,
    tone: item.canCheckUpdates ? 'ready' : 'local'
  };
};

export const modSeparatorChildCount = (
  items: FluxoraModOrderItem[],
  separatorOrderId: string
): number => separatorChildCount(items, separatorOrderId);

export const isModNestedUnderSeparator = (
  items: FluxoraModOrderItem[],
  orderId: string
): boolean => orderItemNestedUnderSeparator(items, orderId);

export const selectedModOrderItem = (
  items: FluxoraModOrderItem[],
  selectedOrderId: string | null,
  collapsedSeparatorOrderIds: ReadonlySet<string> = new Set<string>()
): FluxoraModOrderItem | null => {
  const selected = items.find((item) => item.orderId === selectedOrderId) ?? null;
  if (selected && !isOrderItemHiddenByCollapsedSeparator(items, selected.orderId, collapsedSeparatorOrderIds)) {
    return selected;
  }

  const parentSeparator = selected
    ? parentSeparatorForOrderItem(items, selected.orderId)
    : null;
  if (parentSeparator && collapsedSeparatorOrderIds.has(parentSeparator.orderId)) {
    return parentSeparator;
  }

  const visibleItems = visibleOrderItems(items, collapsedSeparatorOrderIds);
  return visibleItems.find((item) => item.isMod) ?? visibleItems[0] ?? null;
};

const normalizeModLookupValue = (value: string | null | undefined): string =>
  (value ?? '')
    .trim()
    .replace(/\//g, '\\')
    .replace(/\\+/g, '\\')
    .toLocaleLowerCase();

export const modOrderItemMatchesLookup = (
  item: FluxoraModOrderItem,
  lookup: string | null | undefined
): boolean => {
  const normalizedLookup = normalizeModLookupValue(lookup);
  if (!normalizedLookup) {
    return false;
  }

  return [item.id, item.orderId, item.modUuid, item.name]
    .map(normalizeModLookupValue)
    .some((candidate) => candidate === normalizedLookup);
};

export const filterModOrderItems = (
  items: FluxoraModOrderItem[],
  searchText: string
): FluxoraModOrderItem[] => {
  const terms = searchText
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return items;
  }

  return items.filter((item) => {
    const searchable = [
      item.id,
      item.orderId,
      item.kind,
      item.name,
      item.separatorTitle,
      item.version,
      item.latestVersion,
      item.updateStatus,
      item.conflictStatus
    ]
      .join(' ')
      .toLocaleLowerCase();

    return terms.every((term) => searchable.includes(term));
  });
};

export const appendOverwriteOrderItem = (
  items: FluxoraModOrderItem[],
  overwriteItem: FluxoraModOrderItem | null,
  searchText: string
): FluxoraModOrderItem[] => {
  if (!overwriteItem) {
    return items;
  }

  if (searchText.trim().length > 0 && filterModOrderItems([overwriteItem], searchText).length === 0) {
    return items;
  }

  return [...items, overwriteItem];
};

export const visibleModOrderItems = (
  items: FluxoraModOrderItem[],
  searchText: string,
  collapsedSeparatorOrderIds: ReadonlySet<string>
): FluxoraModOrderItem[] => {
  const filtered = filterModOrderItems(items, searchText);
  return searchText.trim().length > 0
    ? filtered
    : visibleOrderItems(filtered, collapsedSeparatorOrderIds);
};

export const targetIndexForMove = (
  items: FluxoraModOrderItem[],
  orderId: string,
  direction: -1 | 1,
  collapsedSeparatorOrderIds: ReadonlySet<string> = new Set<string>()
): number | null =>
  targetIndexForOrderMove(items, orderId, direction, {
    collapsedSeparatorOrderIds,
    separatorDropTargets: 'separators',
    separatorMoveMode: 'single'
  });

export const targetIndexForDrop = (
  items: FluxoraModOrderItem[],
  sourceOrderId: string,
  targetOrderId: string,
  placement: OrderDropPlacement = 'after',
  collapsedSeparatorOrderIds: ReadonlySet<string> = new Set<string>()
): number | null => {
  const source = items.find((item) => item.orderId === sourceOrderId);
  return targetIndexForOrderDrop(items, sourceOrderId, targetOrderId, placement, {
    collapsedSeparatorOrderIds,
    separatorDropTargets: source?.isSeparator === true ? 'separators' : 'all',
    separatorMoveMode: 'single',
    treatAfterSeparatorTargetAsBlock: source?.isSeparator === true
  });
};

export const reorderModOrderItems = (
  items: FluxoraModOrderItem[],
  orderId: string,
  targetIndex: number
): FluxoraModOrderItem[] | null =>
  reorderOrderItems(items, orderId, targetIndex, { separatorMoveMode: 'single' });

export const modStatusText = (item: FluxoraModOrderItem | null): string => {
  if (!item) {
    return 'No mod selected';
  }

  if (isModOverwriteItem(item)) {
    return 'Overwrite folder';
  }

  if (item.isSeparator) {
    return 'Separator row';
  }

  if (item.conflictStatus) {
    return item.conflictStatus;
  }

  if (item.updateStatus) {
    return item.updateStatus;
  }

  return item.isEnabled ? 'Enabled' : 'Disabled';
};

export const formatFileSize = (size: number): string => {
  if (!Number.isFinite(size) || size <= 0) {
    return '';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const kilobytes = size / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 10 ? 0 : 1)} KB`;
  }

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
};

export const hasConflict = (entry: FluxoraModFileTreeEntry): boolean =>
  entry.conflictState.trim().length > 0 && entry.conflictState !== 'none';

export const modWorkspaceReducer = (
  state: ModWorkspaceState,
  action: ModWorkspaceAction
): ModWorkspaceState => {
  switch (action.type) {
    case 'load-started':
      return {
        ...state,
        loadState: 'loading',
        errorMessage: null
      };
    case 'load-failed':
      return {
        ...state,
        loadState: 'error',
        errorMessage: action.message
      };
    case 'items-loaded': {
      const collapsedSeparatorOrderIds = pruneCollapsedSeparators(
        action.items,
        state.collapsedSeparatorOrderIds
      );
      const selected = selectedModOrderItem(
        action.items,
        state.selectedOrderId,
        collapsedSeparatorOrderIds
      );
      const selection = pruneOrderSelection(
        state,
        action.items.map((item) => item.orderId),
        selected?.orderId ?? null
      );
      return {
        ...state,
        ...selection,
        items: action.items,
        collapsedSeparatorOrderIds,
        loadState: 'ready',
        errorMessage: null
      };
    }
    case 'items-reordered': {
      const items = reorderModOrderItems(state.items, action.orderId, action.targetIndex);
      if (!items) {
        return state;
      }

      const selected = selectedModOrderItem(
        items,
        state.selectedOrderId,
        state.collapsedSeparatorOrderIds
      );
      const selection = pruneOrderSelection(
        state,
        items.map((item) => item.orderId),
        selected?.orderId ?? null
      );
      return {
        ...state,
        ...selection,
        items,
        loadState: 'ready',
        errorMessage: null
      };
    }
    case 'item-enabled-set': {
      const items = state.items.map((item) =>
        item.isMod && item.orderId === action.orderId
          ? { ...item, isEnabled: action.isEnabled }
          : item
      );
      return {
        ...state,
        items,
        loadState: 'ready',
        errorMessage: null
      };
    }
    case 'all-items-enabled-set':
      return {
        ...state,
        items: state.items.map((item) =>
          item.isMod ? { ...item, isEnabled: action.isEnabled } : item
        ),
        loadState: 'ready',
        errorMessage: null
      };
    case 'separator-collapse-toggled': {
      const separator = state.items.find((item) => item.orderId === action.orderId);
      if (!separator?.isSeparator) {
        return state;
      }

      const collapsedSeparatorOrderIds = new Set(state.collapsedSeparatorOrderIds);
      if (collapsedSeparatorOrderIds.has(action.orderId)) {
        collapsedSeparatorOrderIds.delete(action.orderId);
      } else {
        collapsedSeparatorOrderIds.add(action.orderId);
      }

      return {
        ...state,
        ...selectOrderItem(state, action.orderId),
        collapsedSeparatorOrderIds
      };
    }
    case 'all-separators-collapse-set':
      return {
        ...state,
        collapsedSeparatorOrderIds: action.isCollapsed
          ? new Set(state.items.filter((item) => item.isSeparator).map((item) => item.orderId))
          : new Set<string>()
      };
    case 'search-changed':
      return {
        ...state,
        searchText: action.searchText
      };
    case 'selected':
      return {
        ...state,
        ...selectOrderItem(state, action.orderId)
      };
    case 'selection-toggled':
      return {
        ...state,
        ...toggleOrderItemSelection(state, action.orderId, action.orderedOrderIds)
      };
    case 'selection-range-selected':
      return {
        ...state,
        ...selectOrderItemRange(state, action.orderId, action.orderedOrderIds, {
          additive: action.additive
        })
      };
    case 'all-selected':
      return {
        ...state,
        ...selectAllOrderItems(state, action.orderedOrderIds)
      };
    default:
      return state;
  }
};
