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

export type PluginWorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface PluginWorkspaceState {
  items: FluxoraPluginOrderItem[];
  selectedOrderId: string | null;
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
  | { type: 'search-changed'; searchText: string }
  | { type: 'selected'; orderId: string | null };

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
  selectedOrderId: null,
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

  if (item.missingMasters.length > 0) {
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
      return {
        ...state,
        items: action.items,
        selectedOrderId: selected?.orderId ?? null,
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
      return {
        ...state,
        items,
        selectedOrderId: selected?.orderId ?? null,
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
        collapsedSeparatorOrderIds,
        selectedOrderId: action.orderId
      };
    }
    case 'search-changed':
      return {
        ...state,
        searchText: action.searchText
      };
    case 'selected':
      return {
        ...state,
        selectedOrderId: action.orderId
      };
    default:
      return state;
  }
};
