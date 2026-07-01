import type {
  FluxoraPluginOrderItem,
  FluxoraProject,
  NativeBridgeStatus
} from '../shared/fluxora-api';
import {
  isOrderItemHiddenByCollapsedSeparator,
  orderItemNestedUnderSeparator,
  orderMoveBlockEnd,
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

export type PluginWorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface PluginWorkspaceState {
  items: FluxoraPluginOrderItem[];
  selectedOrderId: string | null;
  selectedOrderIds: ReadonlySet<string>;
  selectionAnchorOrderId: string | null;
  rangeExcludedOrderIds: ReadonlySet<string>;
  rangeBaseOrderIds: ReadonlySet<string>;
  collapsedSeparatorOrderIds: ReadonlySet<string>;
  searchText: string;
  loadState: PluginWorkspaceLoadState;
  errorMessage: string | null;
}

export type PluginWorkspaceAction =
  | { type: 'load-started' }
  | { type: 'load-failed'; message: string }
  | { type: 'items-loaded'; items: FluxoraPluginOrderItem[] }
  | { type: 'items-reordered'; orderId: string; targetIndex: number }
  | { type: 'item-enabled-set'; orderId: string; isEnabled: boolean }
  | { type: 'unlocked-items-enabled-set'; isEnabled: boolean }
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

export interface PendingPluginEnabledState {
  isEnabled: boolean;
}

export interface PluginCapabilityView {
  bridgeAvailable: boolean;
  projectSupported: boolean;
  loadOrderSupported: boolean;
  bulkToggleSupported: boolean;
  nativeBulkToggleSupported: boolean;
  reason: string;
}

export const emptyPluginWorkspaceState = (): PluginWorkspaceState => ({
  items: [],
  ...emptyOrderSelectionState(),
  collapsedSeparatorOrderIds: new Set<string>(),
  searchText: '',
  loadState: 'idle',
  errorMessage: null
});

export const pluginItemTitle = (item: FluxoraPluginOrderItem): string =>
  item.isSeparator ? item.separatorTitle || 'Separator' : item.name || item.id;

export const pluginSourceLabel = (item: FluxoraPluginOrderItem | null): string => {
  if (!item) {
    return 'No plugin selected';
  }

  if (item.isSeparator) {
    return 'Separator';
  }

  return item.sourceMod.trim() || 'game data';
};

const missingMasterNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

export interface PluginMissingMasterSummary {
  totalCount: number;
  visibleMasters: string[];
  hiddenCount: number;
}

export interface PluginMissingMasterContext {
  enabledPluginNameKeys?: ReadonlySet<string>;
  disabledSourceModNameKeys?: ReadonlySet<string>;
}

const emptyStringSet: ReadonlySet<string> = new Set<string>();

const normalizedProjectSignal = (value: string | null | undefined): string =>
  value?.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '') ?? '';

export const isSkyrimMissingMasterStatusProject = (project: FluxoraProject | null): boolean => {
  const signals = [
    project?.templateId,
    project?.uiTemplateId,
    project?.gameName,
    project?.template?.id,
    project?.template?.uiTemplateId,
    project?.template?.gameName
  ].map(normalizedProjectSignal);

  return signals.some((signal) =>
    signal.includes('skyrimse') ||
    signal.includes('skyrimspecialedition') ||
    signal.includes('skyrimae') ||
    signal.includes('skyrimanniversaryedition')
  );
};

export const pluginSourceModKey = (value: string | null | undefined): string =>
  value?.trim().toLocaleLowerCase() ?? '';

const pluginNameKey = pluginSourceModKey;

const isPluginSourceModDisabled = (
  item: FluxoraPluginOrderItem,
  disabledSourceModNameKeys: ReadonlySet<string>
): boolean => {
  const key = pluginSourceModKey(item.sourceMod);
  return key.length > 0 && disabledSourceModNameKeys.has(key);
};

export const enabledPluginNameKeys = (
  items: readonly FluxoraPluginOrderItem[],
  disabledSourceModNameKeys: ReadonlySet<string> = emptyStringSet
): Set<string> => {
  const keys = new Set<string>();

  items.forEach((item) => {
    if (
      item.isPlugin &&
      item.isEnabled &&
      !isPluginSourceModDisabled(item, disabledSourceModNameKeys)
    ) {
      const key = pluginNameKey(item.name);
      if (key) {
        keys.add(key);
      }
    }
  });

  return keys;
};

const missingMasterCandidates = (
  item: FluxoraPluginOrderItem,
  hasAvailabilityContext: boolean
): readonly string[] =>
  hasAvailabilityContext && item.masterFiles && item.masterFiles.length > 0
    ? item.masterFiles
    : item.missingMasters;

const missingMasterSummaryFromMasters = (
  masters: readonly string[],
  limit: number
): PluginMissingMasterSummary => {
  const safeLimit = Math.max(0, limit);
  const sortedMasters = [...masters].sort((left, right) =>
    missingMasterNameCollator.compare(left, right)
  );

  return {
    totalCount: sortedMasters.length,
    visibleMasters: sortedMasters.slice(0, safeLimit),
    hiddenCount: Math.max(0, sortedMasters.length - safeLimit)
  };
};

export const sortedPluginMissingMasters = (
  item: FluxoraPluginOrderItem | null,
  context: PluginMissingMasterContext = {}
): string[] => {
  if (!item?.isPlugin || !item.isEnabled) {
    return [];
  }

  const disabledSourceModNameKeys = context.disabledSourceModNameKeys ?? emptyStringSet;
  if (isPluginSourceModDisabled(item, disabledSourceModNameKeys)) {
    return [];
  }

  const hasAvailabilityContext = context.enabledPluginNameKeys !== undefined;
  const uniqueByName = new Map<string, string>();
  missingMasterCandidates(item, hasAvailabilityContext).forEach((master) => {
    const trimmed = master.trim();
    if (!trimmed) {
      return;
    }

    const key = trimmed.toLocaleLowerCase();
    if (context.enabledPluginNameKeys?.has(key)) {
      return;
    }

    if (!uniqueByName.has(key)) {
      uniqueByName.set(key, trimmed);
    }
  });

  return [...uniqueByName.values()].sort((left, right) =>
    missingMasterNameCollator.compare(left, right)
  );
};

export const pluginMissingMasterSummary = (
  item: FluxoraPluginOrderItem | null,
  limit = 20,
  context: PluginMissingMasterContext = {}
): PluginMissingMasterSummary => {
  const masters = sortedPluginMissingMasters(item, context);
  return missingMasterSummaryFromMasters(masters, limit);
};

export const pluginHexIndex = (item: FluxoraPluginOrderItem): string =>
  item.isSeparator ? '--' : Math.max(0, item.order).toString(16).toUpperCase().padStart(2, '0');

export const selectedPluginOrderItem = (
  items: FluxoraPluginOrderItem[],
  selectedOrderId: string | null,
  collapsedSeparatorOrderIds: ReadonlySet<string> = new Set<string>()
): FluxoraPluginOrderItem | null => {
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
  return visibleItems.find((item) => item.isPlugin) ?? visibleItems[0] ?? null;
};

export const filterPluginOrderItems = (
  items: FluxoraPluginOrderItem[],
  searchText: string
): FluxoraPluginOrderItem[] => {
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
    item.extension,
    item.sourceMod,
    item.lockReason,
    item.masterFiles?.join(' ') ?? '',
    item.missingMasters.join(' ')
  ]
      .join(' ')
      .toLocaleLowerCase();

    return terms.every((term) => searchable.includes(term));
  });
};

export const visiblePluginOrderItems = (
  items: FluxoraPluginOrderItem[],
  searchText: string,
  collapsedSeparatorOrderIds: ReadonlySet<string>
): FluxoraPluginOrderItem[] => {
  const filtered = filterPluginOrderItems(items, searchText);
  return searchText.trim().length > 0
    ? filtered
    : visibleOrderItems(filtered, collapsedSeparatorOrderIds);
};

export const pluginSeparatorChildCount = (
  items: FluxoraPluginOrderItem[],
  separatorOrderId: string
): number => separatorChildCount(items, separatorOrderId);

export const pluginSeparatorMissingMasterSummary = (
  items: readonly FluxoraPluginOrderItem[],
  separatorOrderId: string,
  limit = 20,
  context: PluginMissingMasterContext = {}
): PluginMissingMasterSummary => {
  const separatorIndex = items.findIndex((item) => item.orderId === separatorOrderId);
  if (separatorIndex < 0 || !items[separatorIndex]?.isSeparator) {
    return missingMasterSummaryFromMasters([], limit);
  }

  const uniqueByName = new Map<string, string>();
  for (let index = separatorIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.isSeparator) {
      break;
    }

    sortedPluginMissingMasters(item, context).forEach((master) => {
      const key = master.toLocaleLowerCase();
      if (!uniqueByName.has(key)) {
        uniqueByName.set(key, master);
      }
    });
  }

  return missingMasterSummaryFromMasters([...uniqueByName.values()], limit);
};

export const isPluginNestedUnderSeparator = (
  items: FluxoraPluginOrderItem[],
  orderId: string
): boolean => orderItemNestedUnderSeparator(items, orderId);

export const targetIndexForPluginMove = (
  items: FluxoraPluginOrderItem[],
  orderId: string,
  direction: -1 | 1,
  collapsedSeparatorOrderIds: ReadonlySet<string> = new Set<string>()
): number | null => {
  if (!canDragPluginOrderItem(items, orderId)) {
    return null;
  }

  const sourceIndex = items.findIndex((item) => item.orderId === orderId);
  const source = items[sourceIndex];
  const blockEnd = pluginOrderMoveEnd(items, sourceIndex);
  const targetIndex = targetIndexForOrderMove(items, orderId, direction, {
    collapsedSeparatorOrderIds,
    separatorDropTargets: source?.isSeparator === true ? 'separators' : 'all',
    separatorMoveMode: 'single',
    treatAfterSeparatorTargetAsBlock: source?.isSeparator === true
  });
  if (targetIndex === null) {
    return null;
  }

  const minTargetIndex = pluginOrderMinimumTargetIndex(items, sourceIndex, blockEnd);
  return targetIndex >= minTargetIndex ? targetIndex : null;
};

export const canDragPluginOrderItem = (
  items: FluxoraPluginOrderItem[],
  orderId: string
): boolean => {
  const sourceIndex = items.findIndex((item) => item.orderId === orderId);
  const source = items[sourceIndex];
  if (!source || source.isLocked) {
    return false;
  }

  return true;
};

export const targetIndexForPluginDrop = (
  items: FluxoraPluginOrderItem[],
  sourceOrderId: string,
  targetOrderId: string,
  placement: OrderDropPlacement = 'after',
  collapsedSeparatorOrderIds: ReadonlySet<string> = new Set<string>()
): number | null => {
  const sourceIndex = items.findIndex((item) => item.orderId === sourceOrderId);
  if (sourceIndex < 0) {
    return null;
  }

  const source = items[sourceIndex];
  if (!source || !canDragPluginOrderItem(items, sourceOrderId)) {
    return null;
  }

  const blockEnd = pluginOrderMoveEnd(items, sourceIndex);
  const requestedTargetIndex = targetIndexForOrderDrop(
    items,
    sourceOrderId,
    targetOrderId,
    placement,
    {
      collapsedSeparatorOrderIds,
      separatorDropTargets: source.isSeparator ? 'separators' : 'all',
      separatorMoveMode: 'single',
      treatAfterSeparatorTargetAsBlock: source.isSeparator
    }
  );
  if (requestedTargetIndex === null) {
    return null;
  }

  const minTargetIndex = pluginOrderMinimumTargetIndex(items, sourceIndex, blockEnd);

  return requestedTargetIndex >= minTargetIndex ? requestedTargetIndex : null;
};

export const reorderPluginOrderItems = (
  items: FluxoraPluginOrderItem[],
  orderId: string,
  targetIndex: number
): FluxoraPluginOrderItem[] | null => {
  const sourceIndex = items.findIndex((item) => item.orderId === orderId);
  if (sourceIndex < 0 || !canDragPluginOrderItem(items, orderId)) {
    return null;
  }

  const blockEnd = pluginOrderMoveEnd(items, sourceIndex);
  const minTargetIndex = pluginOrderMinimumTargetIndex(items, sourceIndex, blockEnd);
  if (targetIndex < minTargetIndex) {
    return null;
  }

  return reorderOrderItems(items, orderId, targetIndex, { separatorMoveMode: 'single' });
};

export const mergePendingPluginEnabledStates = (
  items: FluxoraPluginOrderItem[],
  pendingByOrderId: ReadonlyMap<string, PendingPluginEnabledState>
): FluxoraPluginOrderItem[] => {
  if (pendingByOrderId.size === 0) {
    return items;
  }

  let changed = false;
  const merged = items.map((item) => {
    const pending = item.isPlugin ? pendingByOrderId.get(item.orderId) : undefined;
    if (!pending || item.isEnabled === pending.isEnabled) {
      return item;
    }

    changed = true;
    return {
      ...item,
      isEnabled: pending.isEnabled
    };
  });

  return changed ? merged : items;
};

const pluginOrderMoveBlockEnd = (
  items: FluxoraPluginOrderItem[],
  sourceIndex: number
): number => orderMoveBlockEnd(items, sourceIndex);

const pluginOrderMoveEnd = (
  items: FluxoraPluginOrderItem[],
  sourceIndex: number
): number =>
  items[sourceIndex]?.isSeparator ? sourceIndex + 1 : pluginOrderMoveBlockEnd(items, sourceIndex);

const pluginOrderBlockContainsPlugin = (
  items: FluxoraPluginOrderItem[],
  sourceIndex: number,
  blockEnd: number
): boolean => {
  for (let index = sourceIndex; index < blockEnd; index += 1) {
    if (items[index]?.isPlugin) {
      return true;
    }
  }

  return false;
};

const pluginOrderFirstUnlockedTargetIndex = (
  items: FluxoraPluginOrderItem[]
): number => {
  let lastLockedPluginIndex = -1;
  items.forEach((item, index) => {
    if (item.isPlugin && item.isLocked) {
      lastLockedPluginIndex = index;
    }
  });

  return lastLockedPluginIndex + 1;
};

const pluginOrderMinimumTargetIndex = (
  items: FluxoraPluginOrderItem[],
  sourceIndex: number,
  blockEnd: number
): number => {
  const source = items[sourceIndex];
  if (!source?.isSeparator) {
    return Math.min(pluginOrderFirstUnlockedTargetIndex(items), Math.max(0, items.length - 1));
  }

  if (!pluginOrderBlockContainsPlugin(items, sourceIndex, blockEnd)) {
    return 0;
  }

  return Math.min(pluginOrderFirstUnlockedTargetIndex(items), Math.max(0, items.length - 1));
};

export const pluginStatusText = (item: FluxoraPluginOrderItem | null): string => {
  if (!item) {
    return 'No plugin selected';
  }

  if (item.isSeparator) {
    return 'Separator row';
  }

  if (item.isLocked) {
    return 'Locked';
  }

  if (sortedPluginMissingMasters(item).length > 0) {
    return 'Missing masters';
  }

  return item.isEnabled ? 'Enabled' : 'Disabled';
};

export const pluginTypeLabel = (item: FluxoraPluginOrderItem | null): string => {
  if (!item) {
    return 'none';
  }

  if (item.isSeparator) {
    return 'separator';
  }

  if (item.isMaster) {
    return 'master';
  }

  if (item.isLight) {
    return 'light';
  }

  return item.extension || 'plugin';
};

export const pluginCapabilityView = (
  project: FluxoraProject | null,
  bridgeStatus: NativeBridgeStatus | null
): PluginCapabilityView => {
  const bridgeFeature = bridgeStatus?.capabilities?.features.plugins;
  const bridgeFeatureState = bridgeFeature?.state;
  const pluginMethodNames = (method: string): string[] => [method, `plugins.${method}`];
  const supportsPluginMethod = (method: string): boolean =>
    !bridgeFeature?.supports ||
    pluginMethodNames(method).some((candidate) => bridgeFeature.supports?.includes(candidate));
  const bridgeAvailable =
    bridgeStatus?.ready === true &&
    (bridgeFeatureState === 'available' || bridgeFeatureState === 'limited') &&
    supportsPluginMethod('list') &&
    supportsPluginMethod('setEnabled');
  const nativeBulkToggleSupported = bridgeAvailable && supportsPluginMethod('setAllEnabled');
  const bulkToggleSupported = bridgeAvailable;
  const flags = project?.gameCapabilities ?? project?.template?.gameCapabilities ?? {};
  const templateHasPluginRules = (project?.template?.pluginExtensions?.length ?? 0) > 0;
  const projectSupported = Boolean(flags.supportsPlugins || templateHasPluginRules);
  const loadOrderSupported = Boolean(flags.supportsLoadOrder ?? projectSupported);

  if (!project) {
    return {
      bridgeAvailable,
      projectSupported: false,
      loadOrderSupported: false,
      bulkToggleSupported,
      nativeBulkToggleSupported,
      reason: 'Open a build before using plugins.'
    };
  }

  if (!bridgeStatus?.ready) {
    return {
      bridgeAvailable: false,
      projectSupported,
      loadOrderSupported,
      bulkToggleSupported: false,
      nativeBulkToggleSupported: false,
      reason: 'Native bridge is not ready.'
    };
  }

  if (!bridgeAvailable) {
    return {
      bridgeAvailable: false,
      projectSupported,
      loadOrderSupported,
      bulkToggleSupported: false,
      nativeBulkToggleSupported: false,
      reason: 'This Fluxora bridge build does not expose plugin workspace methods.'
    };
  }

  if (!projectSupported) {
    return {
      bridgeAvailable,
      projectSupported: false,
      loadOrderSupported: false,
      bulkToggleSupported,
      nativeBulkToggleSupported,
      reason: 'This build game does not support plugins or load order management.'
    };
  }

  if (!loadOrderSupported) {
    return {
      bridgeAvailable,
      projectSupported,
      loadOrderSupported: false,
      bulkToggleSupported,
      nativeBulkToggleSupported,
      reason: 'This build can show plugins, but load order editing is disabled by game capabilities.'
    };
  }

  return {
    bridgeAvailable,
    projectSupported,
    loadOrderSupported,
    bulkToggleSupported,
    nativeBulkToggleSupported,
    reason: ''
  };
};

export const pluginWorkspaceReducer = (
  state: PluginWorkspaceState,
  action: PluginWorkspaceAction
): PluginWorkspaceState => {
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
      const selected = selectedPluginOrderItem(
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
      const items = reorderPluginOrderItems(state.items, action.orderId, action.targetIndex);
      if (!items) {
        return state;
      }

      const selected = selectedPluginOrderItem(
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
        item.isPlugin && item.orderId === action.orderId
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
    case 'unlocked-items-enabled-set':
      return {
        ...state,
        items: state.items.map((item) =>
          item.isPlugin && !item.isLocked ? { ...item, isEnabled: action.isEnabled } : item
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
