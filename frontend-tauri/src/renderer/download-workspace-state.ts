import type {
  FluxoraDownloadEntry,
  FluxoraProject,
  NativeBridgeStatus
} from '../shared/fluxora-api';
import {
  emptyOrderSelectionState,
  pruneOrderSelection,
  selectAllOrderItems,
  selectOrderItem,
  selectOrderItemRange,
  toggleOrderItemSelection,
  type OrderSelectionState
} from './order-selection-state';

export type DownloadWorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface DownloadWorkspaceState {
  items: FluxoraDownloadEntry[];
  selectedId: string | null;
  selectedIds: ReadonlySet<string>;
  selectionAnchorId: string | null;
  rangeExcludedIds: ReadonlySet<string>;
  rangeBaseIds: ReadonlySet<string>;
  searchText: string;
  loadState: DownloadWorkspaceLoadState;
  errorMessage: string | null;
}

export type DownloadWorkspaceAction =
  | { type: 'load-started'; silent?: boolean }
  | { type: 'load-failed'; message: string; silent?: boolean }
  | { type: 'items-loaded'; items: FluxoraDownloadEntry[] }
  | { type: 'items-upserted'; items: FluxoraDownloadEntry[] }
  | { type: 'search-changed'; searchText: string }
  | { type: 'selected'; id: string | null }
  | { type: 'selection-toggled'; id: string; orderedIds: readonly string[] }
  | {
      type: 'selection-range-selected';
      id: string;
      orderedIds: readonly string[];
      additive: boolean;
    }
  | { type: 'all-selected'; orderedIds: readonly string[] };

export interface DownloadCapabilityView {
  bridgeAvailable: boolean;
  nxmRegistrationState: string;
  reason: string;
}

export interface DownloadStatusView {
  text: string;
  tone: 'downloading' | 'installed' | 'ready' | 'paused' | 'error' | 'waiting' | 'deleted';
  progressValue: number;
  showProgress: boolean;
}

export const emptyDownloadWorkspaceState = (): DownloadWorkspaceState => ({
  items: [],
  ...downloadSelectionFromOrderSelection(emptyOrderSelectionState()),
  searchText: '',
  loadState: 'idle',
  errorMessage: null
});

const downloadSelectionFromOrderSelection = (
  selection: OrderSelectionState
): Pick<
  DownloadWorkspaceState,
  'selectedId' | 'selectedIds' | 'selectionAnchorId' | 'rangeExcludedIds' | 'rangeBaseIds'
> => ({
  selectedId: selection.selectedOrderId,
  selectedIds: selection.selectedOrderIds,
  selectionAnchorId: selection.selectionAnchorOrderId,
  rangeExcludedIds: selection.rangeExcludedOrderIds,
  rangeBaseIds: selection.rangeBaseOrderIds
});

const orderSelectionFromDownloadState = (state: DownloadWorkspaceState): OrderSelectionState => ({
  selectedOrderId: state.selectedId,
  selectedOrderIds: state.selectedIds,
  selectionAnchorOrderId: state.selectionAnchorId,
  rangeExcludedOrderIds: state.rangeExcludedIds,
  rangeBaseOrderIds: state.rangeBaseIds
});

const archiveExtensionPattern =
  /\.(?:7z|zip|rar|ba2|bsa|fomod|omod|tar\.gz|tar\.bz2|tar\.xz|tgz|gz|bz2|xz)$/i;

const hasTextualName = (value: string): boolean => /[^\d\s._-]/.test(value);

const trimTrailingSeparators = (value: string): string =>
  value.replace(/[\s._-]+$/g, '').trim();

const stripArchiveExtension = (value: string): string =>
  value.replace(archiveExtensionPattern, '').trim();

const nexusCdnSuffixPattern =
  /^(.+?)[\s._-]+\d{4,9}[\s._-]+\d+[\s._-]+\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}(?:[-:]\d{2})?Z[\s._-]+[a-z0-9]{6,}$/i;

const looksLikeNexusNumericSuffix = (tokens: string[]): boolean => {
  if (tokens.length < 3) {
    return false;
  }

  const firstToken = tokens[0] ?? '';
  const lastToken = tokens[tokens.length - 1] ?? '';
  return /^\d{4,8}$/.test(firstToken) && /^\d{9,}$/.test(lastToken);
};

export const downloadDisplayName = (rawName: string): string => {
  const stem = stripArchiveExtension(rawName.trim());
  if (!stem) {
    return '';
  }

  const cdnSuffixMatch = stem.match(nexusCdnSuffixPattern);
  const cdnCandidate = trimTrailingSeparators(cdnSuffixMatch?.[1] ?? '');
  if (cdnCandidate && hasTextualName(cdnCandidate)) {
    return cdnCandidate;
  }

  const parts = stem.split('-');
  for (let start = parts.length - 3; start >= 1; start -= 1) {
    const tokens = parts.slice(start).map((part) => part.trim());
    if (tokens.some((token) => !/^\d+$/.test(token))) {
      continue;
    }

    if (!looksLikeNexusNumericSuffix(tokens)) {
      continue;
    }

    const candidate = trimTrailingSeparators(parts.slice(0, start).join('-'));
    if (candidate && hasTextualName(candidate)) {
      return candidate;
    }
  }

  return trimTrailingSeparators(stem);
};

export const downloadTitle = (entry: FluxoraDownloadEntry): string =>
  downloadDisplayName(entry.fileName || entry.name || entry.id) || 'Download';

export const downloadRawTitle = (entry: FluxoraDownloadEntry): string =>
  entry.fileName || entry.name || entry.localPath || entry.id || 'Download';

export const selectedDownloadEntry = (
  items: FluxoraDownloadEntry[],
  selectedId: string | null
): FluxoraDownloadEntry | null =>
  items.find((entry) => entry.id === selectedId || entry.localPath === selectedId) ??
  items.find((entry) => entry.canInstall) ??
  items[0] ??
  null;

export const hasActiveDownload = (items: FluxoraDownloadEntry[]): boolean =>
  items.some(
    (entry) => entry.transferState === 'downloading' || entry.transferState === 'indexing'
  );

export const filterDownloadEntries = (
  items: FluxoraDownloadEntry[],
  searchText: string
): FluxoraDownloadEntry[] => {
  const terms = searchText
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return items;
  }

  return items.filter((entry) => {
    const searchable = [
      entry.id,
      entry.name,
      entry.fileName,
      entry.localPath,
      entry.source,
      entry.archiveId ?? '',
      entry.buildStatus ?? '',
      entry.transferState,
      entry.transferMessage,
      entry.sizeText,
      entry.progressText,
      entry.downloadSpeedText
    ]
      .join(' ')
      .toLocaleLowerCase();

    return terms.every((term) => searchable.includes(term));
  });
};

export const downloadStatusText = (entry: FluxoraDownloadEntry | null): string => {
  if (!entry) {
    return 'No download selected';
  }

  switch (entry.transferState) {
    case 'downloading':
      return entry.downloadSpeedText || entry.progressText || entry.transferMessage || 'Downloading';
    case 'queued':
      return entry.transferMessage || 'Queued';
    case 'paused':
      return entry.transferMessage || 'Paused';
    case 'canceled':
      return entry.transferMessage || 'Canceled';
    case 'indexing':
      return 'Indexing';
    case 'failed':
      return entry.transferMessage || 'Failed';
    case 'idle':
    default:
      break;
  }
  return entry.buildStatus ?? 'Waiting';
};

export const downloadProgressValue = (entry: FluxoraDownloadEntry): number => {
  if (!entry.hasKnownProgress || !Number.isFinite(entry.progressPercent)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(entry.progressPercent)));
};

export const downloadStatusView = (entry: FluxoraDownloadEntry): DownloadStatusView => {
  const progressValue = downloadProgressValue(entry);
  if (entry.transferState === 'downloading') {
    const progressText = entry.progressText || (entry.hasKnownProgress ? `${progressValue}%` : 'Downloading');
    const text = entry.downloadSpeedText ? `${progressText} · ${entry.downloadSpeedText}` : progressText;
    return {
      text,
      tone: 'downloading',
      progressValue,
      showProgress: true
    };
  }

  const text = downloadStatusText(entry);
  const tone: DownloadStatusView['tone'] =
    entry.buildStatus === 'Installed'
      ? 'installed'
      : entry.buildStatus === 'Ready'
        ? 'ready'
        : entry.buildStatus === 'Deleted'
          ? 'deleted'
          : entry.transferState === 'paused' || entry.transferState === 'canceled'
            ? 'paused'
            : entry.transferState === 'failed'
              ? 'error'
              : 'waiting';

  return {
    text,
    tone,
    progressValue,
    showProgress: false
  };
};

export const downloadCapabilityView = (
  project: FluxoraProject | null,
  bridgeStatus: NativeBridgeStatus | null
): DownloadCapabilityView => {
  const downloadsFeature = bridgeStatus?.capabilities?.features.downloads?.state;
  const bridgeAvailable =
    bridgeStatus?.ready === true &&
    (downloadsFeature === 'available' || downloadsFeature === 'limited');
  const nxmRegistrationState =
    bridgeStatus?.capabilities?.features.nxmProtocolRegistration?.state ?? 'unknown';

  if (!project) {
    return {
      bridgeAvailable,
      nxmRegistrationState,
      reason: 'Open a build before using downloads.'
    };
  }

  if (!bridgeStatus?.ready) {
    return {
      bridgeAvailable: false,
      nxmRegistrationState,
      reason: 'Native bridge is not ready.'
    };
  }

  if (!bridgeAvailable) {
    return {
      bridgeAvailable: false,
      nxmRegistrationState,
      reason: 'This Fluxora bridge build does not expose download methods.'
    };
  }

  return {
    bridgeAvailable,
    nxmRegistrationState,
    reason: ''
  };
};

export const downloadWorkspaceReducer = (
  state: DownloadWorkspaceState,
  action: DownloadWorkspaceAction
): DownloadWorkspaceState => {
  switch (action.type) {
    case 'load-started':
      return {
        ...state,
        loadState: action.silent ? state.loadState : 'loading',
        errorMessage: null
      };
    case 'load-failed':
      return {
        ...state,
        loadState: action.silent ? state.loadState : 'error',
        errorMessage: action.message
      };
    case 'items-loaded': {
      const selected = selectedDownloadEntry(action.items, state.selectedId);
      const orderedIds = action.items.map((entry) => entry.id);
      const selection = pruneOrderSelection(
        orderSelectionFromDownloadState(state),
        orderedIds,
        selected?.id ?? null
      );
      return {
        ...state,
        items: action.items,
        ...downloadSelectionFromOrderSelection(selection),
        loadState: 'ready',
        errorMessage: null
      };
    }
    case 'items-upserted': {
      const incomingIds = new Set(action.items.map((entry) => entry.id));
      return downloadWorkspaceReducer(state, {
        type: 'items-loaded',
        items: [...action.items, ...state.items.filter((entry) => !incomingIds.has(entry.id))]
      });
    }
    case 'search-changed':
      return {
        ...state,
        searchText: action.searchText
      };
    case 'selected':
      return {
        ...state,
        ...downloadSelectionFromOrderSelection(
          selectOrderItem(orderSelectionFromDownloadState(state), action.id)
        )
      };
    case 'selection-toggled':
      return {
        ...state,
        ...downloadSelectionFromOrderSelection(
          toggleOrderItemSelection(
            orderSelectionFromDownloadState(state),
            action.id,
            action.orderedIds
          )
        )
      };
    case 'selection-range-selected':
      return {
        ...state,
        ...downloadSelectionFromOrderSelection(
          selectOrderItemRange(
            orderSelectionFromDownloadState(state),
            action.id,
            action.orderedIds,
            { additive: action.additive }
          )
        )
      };
    case 'all-selected':
      return {
        ...state,
        ...downloadSelectionFromOrderSelection(
          selectAllOrderItems(orderSelectionFromDownloadState(state), action.orderedIds)
        )
      };
    default:
      return state;
  }
};
