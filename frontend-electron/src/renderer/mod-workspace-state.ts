import type {
  FluxoraModFileTreeEntry,
  FluxoraModOrderItem
} from '../shared/fluxora-api';

export type ModWorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface ModWorkspaceState {
  items: FluxoraModOrderItem[];
  selectedOrderId: string | null;
  searchText: string;
  loadState: ModWorkspaceLoadState;
  errorMessage: string | null;
}

export type ModWorkspaceAction =
  | { type: 'load-started' }
  | { type: 'load-failed'; message: string }
  | { type: 'items-loaded'; items: FluxoraModOrderItem[] }
  | { type: 'search-changed'; searchText: string }
  | { type: 'selected'; orderId: string | null };

export const emptyModWorkspaceState = (): ModWorkspaceState => ({
  items: [],
  selectedOrderId: null,
  searchText: '',
  loadState: 'idle',
  errorMessage: null
});

export const modItemTitle = (item: FluxoraModOrderItem): string =>
  item.isSeparator ? item.separatorTitle || 'Separator' : item.name || item.id;

export type ModOverwriteState = 'none' | 'overwrites' | 'overwritten' | 'mixed' | 'fully-overwritten';

export interface ModOverwriteView {
  state: ModOverwriteState;
  label: string;
  title: string;
}

const safeCount = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

export const modOverwriteView = (item: FluxoraModOrderItem): ModOverwriteView => {
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

  if (conflicting > 0 || item.conflictStatus.trim().length > 0) {
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

export const isModNestedUnderSeparator = (
  items: FluxoraModOrderItem[],
  orderId: string
): boolean => {
  const index = items.findIndex((item) => item.orderId === orderId);
  if (index <= 0 || !items[index]?.isMod) {
    return false;
  }

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (items[cursor].isSeparator) {
      return true;
    }
  }

  return false;
};

export const selectedModOrderItem = (
  items: FluxoraModOrderItem[],
  selectedOrderId: string | null
): FluxoraModOrderItem | null =>
  items.find((item) => item.orderId === selectedOrderId) ??
  items.find((item) => item.isMod) ??
  items[0] ??
  null;

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

export const targetIndexForMove = (
  items: FluxoraModOrderItem[],
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

export const targetIndexForDrop = (
  items: FluxoraModOrderItem[],
  sourceOrderId: string,
  targetOrderId: string
): number | null => {
  const sourceIndex = items.findIndex((item) => item.orderId === sourceOrderId);
  const targetIndex = items.findIndex((item) => item.orderId === targetOrderId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return null;
  }

  return targetIndex;
};

export const modStatusText = (item: FluxoraModOrderItem | null): string => {
  if (!item) {
    return 'No mod selected';
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
      const selected = selectedModOrderItem(action.items, state.selectedOrderId);
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
