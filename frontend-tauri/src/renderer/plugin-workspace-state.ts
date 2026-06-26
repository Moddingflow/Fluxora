import type {
  FluxoraPluginOrderItem,
  FluxoraProject,
  NativeBridgeStatus
} from '../shared/fluxora-api';

export type PluginWorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface PluginWorkspaceState {
  items: FluxoraPluginOrderItem[];
  selectedOrderId: string | null;
  searchText: string;
  loadState: PluginWorkspaceLoadState;
  errorMessage: string | null;
}

export type PluginWorkspaceAction =
  | { type: 'load-started' }
  | { type: 'load-failed'; message: string }
  | { type: 'items-loaded'; items: FluxoraPluginOrderItem[] }
  | { type: 'search-changed'; searchText: string }
  | { type: 'selected'; orderId: string | null };

export interface PluginCapabilityView {
  bridgeAvailable: boolean;
  projectSupported: boolean;
  loadOrderSupported: boolean;
  reason: string;
}

export const emptyPluginWorkspaceState = (): PluginWorkspaceState => ({
  items: [],
  selectedOrderId: null,
  searchText: '',
  loadState: 'idle',
  errorMessage: null
});

export const pluginItemTitle = (item: FluxoraPluginOrderItem): string =>
  item.isSeparator ? item.separatorTitle || 'Separator' : item.name || item.id;

export const pluginHexIndex = (item: FluxoraPluginOrderItem): string =>
  item.isSeparator ? '--' : Math.max(0, item.order).toString(16).toUpperCase().padStart(2, '0');

export const selectedPluginOrderItem = (
  items: FluxoraPluginOrderItem[],
  selectedOrderId: string | null
): FluxoraPluginOrderItem | null =>
  items.find((item) => item.orderId === selectedOrderId) ??
  items.find((item) => item.isPlugin) ??
  items[0] ??
  null;

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

export const targetIndexForPluginMove = (
  items: FluxoraPluginOrderItem[],
  orderId: string,
  direction: -1 | 1
): number | null => {
  const index = items.findIndex((item) => item.orderId === orderId);
  if (index < 0) {
    return null;
  }

  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= items.length) {
    return null;
  }

  return targetIndex;
};

export const canDragPluginOrderItem = (
  items: FluxoraPluginOrderItem[],
  orderId: string
): boolean => {
  const sourceIndex = items.findIndex((item) => item.orderId === orderId);
  if (sourceIndex < 0 || items[sourceIndex].isLocked) {
    return false;
  }

  const blockEnd = pluginOrderMoveBlockEnd(items, sourceIndex);
  return !pluginOrderBlockContainsLockedPlugin(items, sourceIndex, blockEnd);
};

export const targetIndexForPluginDrop = (
  items: FluxoraPluginOrderItem[],
  sourceOrderId: string,
  targetOrderId: string,
  placement: 'before' | 'after' = 'after'
): number | null => {
  const sourceIndex = items.findIndex((item) => item.orderId === sourceOrderId);
  const targetIndex = items.findIndex((item) => item.orderId === targetOrderId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return null;
  }

  const source = items[sourceIndex];
  if (!source || !canDragPluginOrderItem(items, sourceOrderId)) {
    return null;
  }

  const blockEnd = pluginOrderMoveBlockEnd(items, sourceIndex);
  const slotIndex = targetIndex + (placement === 'after' ? 1 : 0);

  if (slotIndex >= sourceIndex && slotIndex <= blockEnd) {
    return null;
  }

  const requestedTargetIndex = slotIndex > sourceIndex ? slotIndex - 1 : slotIndex;
  const minTargetIndex = pluginOrderMinimumTargetIndex(items, sourceIndex, blockEnd);

  return requestedTargetIndex >= minTargetIndex ? requestedTargetIndex : null;
};

const pluginOrderMoveBlockEnd = (
  items: FluxoraPluginOrderItem[],
  sourceIndex: number
): number => {
  const source = items[sourceIndex];
  if (!source?.isSeparator) {
    return sourceIndex + 1;
  }

  const nextSeparatorIndex = items.findIndex(
    (item, index) => index > sourceIndex && item.isSeparator
  );
  return nextSeparatorIndex >= 0 ? nextSeparatorIndex : items.length;
};

const pluginOrderBlockContainsLockedPlugin = (
  items: FluxoraPluginOrderItem[],
  sourceIndex: number,
  blockEnd: number
): boolean => {
  for (let index = sourceIndex; index < blockEnd; index += 1) {
    const item = items[index];
    if (item?.isPlugin && item.isLocked) {
      return true;
    }
  }

  return false;
};

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
  const bridgeFeature = bridgeStatus?.capabilities?.features.plugins?.state;
  const bridgeAvailable =
    bridgeStatus?.ready === true &&
    (bridgeFeature === 'available' || bridgeFeature === 'limited');
  const flags = project?.gameCapabilities ?? project?.template?.gameCapabilities ?? {};
  const templateHasPluginRules = (project?.template?.pluginExtensions?.length ?? 0) > 0;
  const projectSupported = Boolean(flags.supportsPlugins || templateHasPluginRules);
  const loadOrderSupported = Boolean(flags.supportsLoadOrder ?? projectSupported);

  if (!project) {
    return {
      bridgeAvailable,
      projectSupported: false,
      loadOrderSupported: false,
      reason: 'Open a build before using plugins.'
    };
  }

  if (!bridgeStatus?.ready) {
    return {
      bridgeAvailable: false,
      projectSupported,
      loadOrderSupported,
      reason: 'Native bridge is not ready.'
    };
  }

  if (!bridgeAvailable) {
    return {
      bridgeAvailable: false,
      projectSupported,
      loadOrderSupported,
      reason: 'This Fluxora bridge build does not expose plugin workspace methods.'
    };
  }

  if (!projectSupported) {
    return {
      bridgeAvailable,
      projectSupported: false,
      loadOrderSupported: false,
      reason: 'This build game does not support plugins or load order management.'
    };
  }

  if (!loadOrderSupported) {
    return {
      bridgeAvailable,
      projectSupported,
      loadOrderSupported: false,
      reason: 'This build can show plugins, but load order editing is disabled by game capabilities.'
    };
  }

  return {
    bridgeAvailable,
    projectSupported,
    loadOrderSupported,
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
      const selected = selectedPluginOrderItem(action.items, state.selectedOrderId);
      return {
        ...state,
        items: action.items,
        selectedOrderId: selected?.orderId ?? null,
        loadState: 'ready',
        errorMessage: null
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
