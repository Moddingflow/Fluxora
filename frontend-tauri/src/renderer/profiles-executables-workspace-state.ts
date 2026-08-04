import type {
  FluxoraExecutable,
  FluxoraProject,
  NativeBridgeStatus
} from '../shared/fluxora-api';
import { translateForLanguage } from '../localization';

export type ProfilesWorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';
export type ExecutablesWorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface ProfilesWorkspaceState {
  items: string[];
  selectedName: string | null;
  searchText: string;
  loadState: ProfilesWorkspaceLoadState;
  errorMessage: string | null;
}

export interface ExecutablesWorkspaceState {
  items: FluxoraExecutable[];
  selectedId: string | null;
  searchText: string;
  loadState: ExecutablesWorkspaceLoadState;
  errorMessage: string | null;
}

export type ProfilesWorkspaceAction =
  | { type: 'load-started'; silent?: boolean }
  | { type: 'load-failed'; message: string; silent?: boolean }
  | { type: 'items-loaded'; items: string[]; defaultProfileName: string }
  | { type: 'search-changed'; searchText: string }
  | { type: 'selected'; name: string | null };

export type ExecutablesWorkspaceAction =
  | { type: 'load-started'; silent?: boolean }
  | { type: 'load-failed'; message: string; silent?: boolean }
  | { type: 'items-loaded'; items: FluxoraExecutable[] }
  | { type: 'search-changed'; searchText: string }
  | { type: 'selected'; id: string | null };

export interface ProfilesCapabilityView {
  bridgeAvailable: boolean;
  reason: string;
}

export interface ExecutablesCapabilityView {
  bridgeAvailable: boolean;
  launchAvailable: boolean;
  launchReason: string;
  reason: string;
}

export const emptyProfilesWorkspaceState = (): ProfilesWorkspaceState => ({
  items: [],
  selectedName: null,
  searchText: '',
  loadState: 'idle',
  errorMessage: null
});

export const emptyExecutablesWorkspaceState = (): ExecutablesWorkspaceState => ({
  items: [],
  selectedId: null,
  searchText: '',
  loadState: 'idle',
  errorMessage: null
});

export const projectDefaultProfileName = (project: FluxoraProject | null): string =>
  project?.template?.defaultProfile || 'Default';

export const isDefaultProfileName = (
  profileName: string | null | undefined,
  defaultProfileName: string
): boolean =>
  Boolean(profileName) &&
  profileName!.trim().toLocaleLowerCase() === defaultProfileName.trim().toLocaleLowerCase();

export const selectedProfileName = (
  items: string[],
  selectedName: string | null,
  defaultProfileName: string
): string => {
  const selected = items.find((item) => item === selectedName);
  if (selected) {
    return selected;
  }

  return (
    items.find((item) => isDefaultProfileName(item, defaultProfileName)) ??
    items[0] ??
    defaultProfileName
  );
};

export const filterProfileNames = (items: string[], searchText: string): string[] => {
  const terms = searchText
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return items;
  }

  return items.filter((name) => {
    const searchable = name.toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
};

export const executableTitle = (
  entry: FluxoraExecutable | null,
  language = 'en-US'
): string => {
  if (!entry) {
    return translateForLanguage(language, 'executable.noneSelected');
  }

  return entry.displayName || entry.id || entry.executablePath || translateForLanguage(language, 'executable.fallback');
};

export const selectedExecutable = (
  items: FluxoraExecutable[],
  selectedId: string | null
): FluxoraExecutable | null =>
  items.find((entry) => entry.id === selectedId) ?? items[0] ?? null;

export const filterExecutables = (
  items: FluxoraExecutable[],
  searchText: string
): FluxoraExecutable[] => {
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
      entry.displayName,
      entry.executablePath,
      entry.arguments,
      entry.workingDirectory
    ]
      .join(' ')
      .toLocaleLowerCase();

    return terms.every((term) => searchable.includes(term));
  });
};

export const profilesCapabilityView = (
  project: FluxoraProject | null,
  bridgeStatus: NativeBridgeStatus | null,
  language?: string | null
): ProfilesCapabilityView => {
  const featureState = bridgeStatus?.capabilities?.features.profiles?.state;
  const bridgeAvailable =
    bridgeStatus?.ready === true && (featureState === 'available' || featureState === 'limited');

  if (!project) {
    return {
      bridgeAvailable,
      reason: translateForLanguage(language, 'capability.openBuildProfiles')
    };
  }

  if (!bridgeStatus?.ready) {
    return {
      bridgeAvailable: false,
      reason: translateForLanguage(language, 'capability.bridgeNotReady')
    };
  }

  if (!bridgeAvailable) {
    return {
      bridgeAvailable: false,
      reason: translateForLanguage(language, 'capability.profileMethodsUnavailable')
    };
  }

  return {
    bridgeAvailable,
    reason: ''
  };
};

export const executablesCapabilityView = (
  project: FluxoraProject | null,
  bridgeStatus: NativeBridgeStatus | null,
  language?: string | null
): ExecutablesCapabilityView => {
  const managementState = bridgeStatus?.capabilities?.features.executables?.state;
  const launchState = bridgeStatus?.capabilities?.features.executableLaunch?.state;
  const bridgeAvailable =
    bridgeStatus?.ready === true &&
    (managementState === 'available' || managementState === 'limited');
  const launchAvailable = launchState === 'available' || launchState === 'limited';

  if (!project) {
    return {
      bridgeAvailable,
      launchAvailable: false,
      launchReason: translateForLanguage(language, 'capability.openBuildLaunch'),
      reason: translateForLanguage(language, 'capability.openBuildExecutables')
    };
  }

  if (!bridgeStatus?.ready) {
    return {
      bridgeAvailable: false,
      launchAvailable: false,
      launchReason: translateForLanguage(language, 'capability.bridgeNotReady'),
      reason: translateForLanguage(language, 'capability.bridgeNotReady')
    };
  }

  if (!bridgeAvailable) {
    return {
      bridgeAvailable: false,
      launchAvailable: false,
      launchReason: translateForLanguage(language, 'capability.launchUnavailable'),
      reason: translateForLanguage(language, 'capability.executableMethodsUnavailable')
    };
  }

  return {
    bridgeAvailable,
    launchAvailable,
    launchReason: launchAvailable
      ? ''
      : translateForLanguage(language, 'capability.launchWindowsOnly'),
    reason: ''
  };
};

export const profilesWorkspaceReducer = (
  state: ProfilesWorkspaceState,
  action: ProfilesWorkspaceAction
): ProfilesWorkspaceState => {
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
      const selected = selectedProfileName(
        action.items,
        state.selectedName,
        action.defaultProfileName
      );
      return {
        ...state,
        items: action.items,
        selectedName: selected,
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
        selectedName: action.name
      };
    default:
      return state;
  }
};

export const executablesWorkspaceReducer = (
  state: ExecutablesWorkspaceState,
  action: ExecutablesWorkspaceAction
): ExecutablesWorkspaceState => {
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
      const selected = selectedExecutable(action.items, state.selectedId);
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
