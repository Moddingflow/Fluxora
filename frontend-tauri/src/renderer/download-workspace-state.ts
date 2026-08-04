import type {
  FluxoraDownloadEntry,
  FluxoraOrderPlacement,
  FluxoraProject,
  NativeBridgeStatus
} from '../shared/fluxora-api';
import { translateForLanguage } from '../localization';
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
  | {
      type: 'delta-applied';
      upserts: FluxoraDownloadEntry[];
      removedIds: string[];
      placements?: FluxoraOrderPlacement[];
    }
  | { type: 'item-removed'; id: string }
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

export const downloadTitle = (
  entry: FluxoraDownloadEntry,
  language?: string | null
): string =>
  entry.hasResolvedFileName
    ? downloadDisplayName(entry.fileName || entry.name || entry.id) || translateForLanguage(language, 'app.ui.download')
    : translateForLanguage(language, 'app.ui.downloadResolvingName');

export const downloadRawTitle = (
  entry: FluxoraDownloadEntry,
  language?: string | null
): string =>
  entry.hasResolvedFileName
    ? entry.fileName || entry.name || entry.localPath || entry.id || translateForLanguage(language, 'app.ui.download')
    : translateForLanguage(language, 'app.ui.downloadResolvingName');

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
    (entry) =>
      !entry.hasResolvedFileName ||
      entry.transferState === 'queued' ||
      entry.transferState === 'downloading' ||
      entry.transferState === 'indexing'
  );

export const queuedDownloadDuplicateDecisions = (
  items: FluxoraDownloadEntry[]
): FluxoraDownloadEntry[] =>
  items.filter(
    (entry) =>
      entry.transferState === 'awaiting-decision' && entry.duplicateDecision !== null
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
      entry.downloadSpeedText,
      entry.duplicateDecision?.incomingFile.version ?? '',
      ...(entry.duplicateDecision?.existingFiles.flatMap((file) => [file.fileName, file.version]) ?? [])
    ]
      .join(' ')
      .toLocaleLowerCase();

    return terms.every((term) => searchable.includes(term));
  });
};

export const downloadStatusText = (
  entry: FluxoraDownloadEntry | null,
  language = 'en-US'
): string => {
  if (!entry) {
    return translateForLanguage(language, 'download.status.noneSelected');
  }

  switch (entry.transferState) {
    case 'downloading':
      return entry.downloadSpeedText || entry.progressText || entry.transferMessage || translateForLanguage(language, 'download.status.downloading');
    case 'queued':
      return entry.transferMessage || translateForLanguage(language, 'download.status.queued');
    case 'awaiting-decision':
      return translateForLanguage(language, 'download.status.needsDecision');
    case 'paused':
      return entry.transferMessage || translateForLanguage(language, 'download.status.paused');
    case 'canceled':
      return entry.transferMessage || translateForLanguage(language, 'download.status.cancelled');
    case 'indexing':
      return translateForLanguage(language, 'download.status.indexing');
    case 'failed':
      return entry.transferMessage || translateForLanguage(language, 'download.status.failed');
    case 'idle':
    default:
      break;
  }
  switch (entry.buildStatus) {
    case 'Ready': return translateForLanguage(language, 'download.status.ready');
    case 'Installing': return translateForLanguage(language, 'download.status.installing');
    case 'Installed': return translateForLanguage(language, 'download.status.installed');
    case 'Deleted': return translateForLanguage(language, 'download.status.deleted');
    case 'Failed': return translateForLanguage(language, 'download.status.failed');
    default: return translateForLanguage(language, 'download.status.waiting');
  }
};

export const downloadProgressValue = (entry: FluxoraDownloadEntry): number => {
  if (!entry.hasKnownProgress || !Number.isFinite(entry.progressPercent)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(entry.progressPercent)));
};

export const downloadStatusView = (
  entry: FluxoraDownloadEntry,
  language = 'en-US'
): DownloadStatusView => {
  const progressValue = downloadProgressValue(entry);
  if (entry.transferState === 'downloading') {
    const progressText = entry.progressText || (entry.hasKnownProgress
      ? `${progressValue}%`
      : translateForLanguage(language, 'download.status.downloading'));
    const text = entry.downloadSpeedText ? `${progressText} · ${entry.downloadSpeedText}` : progressText;
    return {
      text,
      tone: 'downloading',
      progressValue,
      showProgress: true
    };
  }

  const text = downloadStatusText(entry, language);
  const tone: DownloadStatusView['tone'] =
    entry.buildStatus === 'Installed'
      ? 'installed'
      : entry.buildStatus === 'Failed'
        ? 'error'
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
  bridgeStatus: NativeBridgeStatus | null,
  language?: string | null
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
      reason: translateForLanguage(language, 'capability.openBuildDownloads')
    };
  }

  if (!bridgeStatus?.ready) {
    return {
      bridgeAvailable: false,
      nxmRegistrationState,
      reason: translateForLanguage(language, 'capability.bridgeNotReady')
    };
  }

  if (!bridgeAvailable) {
    return {
      bridgeAvailable: false,
      nxmRegistrationState,
      reason: translateForLanguage(language, 'capability.downloadMethodsUnavailable')
    };
  }

  return {
    bridgeAvailable,
    nxmRegistrationState,
    reason: ''
  };
};

const applyDownloadPlacements = (
  items: FluxoraDownloadEntry[],
  placements: readonly FluxoraOrderPlacement[]
): FluxoraDownloadEntry[] => {
  if (placements.length === 0) {
    return items;
  }

  const next = [...items];
  const ids = next.map((entry) => entry.id);
  for (const placement of placements) {
    const sourceIndex = ids.indexOf(placement.orderId);
    if (sourceIndex < 0) {
      continue;
    }
    const [entry] = next.splice(sourceIndex, 1);
    ids.splice(sourceIndex, 1);
    if (!entry) {
      continue;
    }

    let targetIndex = next.length;
    if (placement.beforeOrderId) {
      const beforeIndex = ids.indexOf(placement.beforeOrderId);
      if (beforeIndex < 0) {
        next.splice(sourceIndex, 0, entry);
        ids.splice(sourceIndex, 0, placement.orderId);
        continue;
      }
      targetIndex = beforeIndex;
    } else if (placement.afterOrderId) {
      const afterIndex = ids.indexOf(placement.afterOrderId);
      if (afterIndex < 0) {
        next.splice(sourceIndex, 0, entry);
        ids.splice(sourceIndex, 0, placement.orderId);
        continue;
      }
      targetIndex = afterIndex + 1;
    }
    next.splice(targetIndex, 0, entry);
    ids.splice(targetIndex, 0, placement.orderId);
  }
  return next;
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
    case 'delta-applied': {
      const removedIds = new Set(action.removedIds);
      const upserts = new Map(action.upserts.map((entry) => [entry.id, entry]));
      const present = new Set<string>();
      const items = state.items.flatMap((entry) => {
        if (removedIds.has(entry.id)) {
          return [];
        }
        present.add(entry.id);
        return [upserts.get(entry.id) ?? entry];
      });
      for (const entry of action.upserts) {
        if (!removedIds.has(entry.id) && !present.has(entry.id)) {
          items.push(entry);
        }
      }
      return downloadWorkspaceReducer(state, {
        type: 'items-loaded',
        items: applyDownloadPlacements(items, action.placements ?? [])
      });
    }
    case 'item-removed':
      return downloadWorkspaceReducer(state, {
        type: 'items-loaded',
        items: state.items.filter((entry) => entry.id !== action.id)
      });
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
