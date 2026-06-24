import type {
  FluxoraDownloadEntry,
  FluxoraProject,
  NativeBridgeStatus
} from '../shared/fluxora-api';

export type DownloadWorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface DownloadWorkspaceState {
  items: FluxoraDownloadEntry[];
  selectedId: string | null;
  searchText: string;
  loadState: DownloadWorkspaceLoadState;
  errorMessage: string | null;
}

export type DownloadWorkspaceAction =
  | { type: 'load-started' }
  | { type: 'load-failed'; message: string }
  | { type: 'items-loaded'; items: FluxoraDownloadEntry[] }
  | { type: 'search-changed'; searchText: string }
  | { type: 'selected'; id: string | null };

export interface DownloadCapabilityView {
  bridgeAvailable: boolean;
  nxmRegistrationState: string;
  reason: string;
}

export const emptyDownloadWorkspaceState = (): DownloadWorkspaceState => ({
  items: [],
  selectedId: null,
  searchText: '',
  loadState: 'idle',
  errorMessage: null
});

export const downloadTitle = (entry: FluxoraDownloadEntry): string =>
  entry.name || entry.fileName || entry.id || 'Download';

export const selectedDownloadEntry = (
  items: FluxoraDownloadEntry[],
  selectedId: string | null
): FluxoraDownloadEntry | null =>
  items.find((entry) => entry.id === selectedId || entry.localPath === selectedId) ??
  items.find((entry) => entry.canInstall) ??
  items[0] ??
  null;

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
      entry.status,
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

  if (entry.isDownloading) {
    return entry.downloadSpeedText || entry.progressText || 'Downloading';
  }

  if (entry.canInstall) {
    return 'Ready to install';
  }

  if (entry.canResume) {
    return 'Paused';
  }

  return entry.status || 'Waiting';
};

export const downloadProgressValue = (entry: FluxoraDownloadEntry): number => {
  if (!entry.hasKnownProgress || !Number.isFinite(entry.progressPercent)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(entry.progressPercent)));
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
      const selected = selectedDownloadEntry(action.items, state.selectedId);
      return {
        ...state,
        items: action.items,
        selectedId: selected?.id ?? null,
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
        selectedId: action.id
      };
    default:
      return state;
  }
};
