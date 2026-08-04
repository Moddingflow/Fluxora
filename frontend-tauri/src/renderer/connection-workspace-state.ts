import type {
  FluxoraExternalConnectionSnapshot,
  FluxoraExternalConnectionState,
  FluxoraExternalConnectionStatus
} from '../shared/fluxora-api';
import { translateForLanguage } from '../localization';

export const connectionSnapshotStorageKey = 'fluxora.settings.connectionSnapshot.v1';
const legacyNexusStatusStorageKey = 'fluxora.settings.nexusStatus';

const emptySnapshot = (): FluxoraExternalConnectionSnapshot => ({
  providers: [],
  requestedAtUtc: '',
  completedAtUtc: '',
  durationMs: 0,
  timedOut: false,
  operationId: 'renderer_cached_connections'
});

const connectionStates = new Set<FluxoraExternalConnectionState>([
  'notConfigured',
  'notLinked',
  'connecting',
  'restoring',
  'ready',
  'temporarilyUnavailable',
  'reauthRequired'
]);

const normalizeStatus = (value: unknown): FluxoraExternalConnectionStatus | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.providerId !== 'string' ||
    typeof record.label !== 'string' ||
    typeof record.state !== 'string' ||
    !connectionStates.has(record.state as FluxoraExternalConnectionState)
  ) {
    return null;
  }
  return {
    providerId: record.providerId,
    label: record.label,
    state: record.state as FluxoraExternalConnectionState,
    accountName: record.providerId.toLowerCase() === 'moddingflow'
      ? ''
      : typeof record.accountName === 'string' ? record.accountName : '',
    hasStoredSession: record.hasStoredSession === true,
    retryable: record.retryable === true,
    requiresUserAction: record.requiresUserAction === true,
    message: typeof record.message === 'string' ? record.message : '',
    checkedAtUtc: typeof record.checkedAtUtc === 'string' ? record.checkedAtUtc : '',
    operationId: typeof record.operationId === 'string' ? record.operationId : ''
  };
};

const normalizeSnapshot = (value: unknown): FluxoraExternalConnectionSnapshot | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.providers)) {
    return null;
  }
  const providers = record.providers.map(normalizeStatus);
  if (providers.some((provider) => provider === null)) {
    return null;
  }
  return {
    providers: providers as FluxoraExternalConnectionStatus[],
    requestedAtUtc: typeof record.requestedAtUtc === 'string' ? record.requestedAtUtc : '',
    completedAtUtc: typeof record.completedAtUtc === 'string' ? record.completedAtUtc : '',
    durationMs: typeof record.durationMs === 'number' ? record.durationMs : 0,
    timedOut: record.timedOut === true,
    operationId: typeof record.operationId === 'string'
      ? record.operationId
      : 'renderer_cached_connections'
  };
};

const migrateLegacyNexusStatus = (value: unknown): FluxoraExternalConnectionSnapshot | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.isConfigured !== 'boolean') {
    return null;
  }
  const linked = record.lastKnownLinked === true || record.isLinked === true;
  const requiresReauth = record.requiresReauth === true;
  const accountName =
    (typeof record.displayName === 'string' ? record.displayName : '') ||
    (typeof record.userId === 'string' ? record.userId : '');
  const state: FluxoraExternalConnectionState = !record.isConfigured
    ? 'notConfigured'
    : requiresReauth
      ? 'reauthRequired'
      : linked
        ? 'restoring'
        : 'notLinked';
  const operationId = typeof record.operationId === 'string'
    ? record.operationId
    : 'renderer_migrated_nexus_status';
  return {
    ...emptySnapshot(),
    providers: [
      {
        providerId: 'nexus',
        label: translateForLanguage('en-US', 'settings.nexus.providerLabel'),
        state,
        accountName,
        hasStoredSession: linked,
        retryable: state === 'restoring',
        requiresUserAction: state === 'reauthRequired',
        message: state === 'restoring'
          ? translateForLanguage('en-US', 'settings.nexus.restoringMessage')
          : '',
        checkedAtUtc: '',
        operationId
      }
    ],
    operationId
  };
};

export const loadCachedConnectionSnapshot = (
  storage: Pick<Storage, 'getItem'> | null | undefined
): FluxoraExternalConnectionSnapshot => {
  try {
    const current = storage?.getItem(connectionSnapshotStorageKey);
    if (current) {
      return normalizeSnapshot(JSON.parse(current)) ?? emptySnapshot();
    }
    const legacy = storage?.getItem(legacyNexusStatusStorageKey);
    return legacy
      ? migrateLegacyNexusStatus(JSON.parse(legacy)) ?? emptySnapshot()
      : emptySnapshot();
  } catch {
    return emptySnapshot();
  }
};

export const saveCachedConnectionSnapshot = (
  storage: Pick<Storage, 'setItem'> | null | undefined,
  snapshot: FluxoraExternalConnectionSnapshot
): void => {
  try {
    const safeSnapshot = normalizeSnapshot(snapshot) ?? emptySnapshot();
    storage?.setItem(connectionSnapshotStorageKey, JSON.stringify(safeSnapshot));
  } catch {
    // Local storage can be unavailable in restricted preview contexts.
  }
};

export const providerFromSnapshot = (
  snapshot: FluxoraExternalConnectionSnapshot,
  providerId: string
): FluxoraExternalConnectionStatus | null =>
  snapshot.providers.find((provider) => provider.providerId === providerId) ?? null;

export const mergeConnectionStatus = (
  snapshot: FluxoraExternalConnectionSnapshot,
  status: FluxoraExternalConnectionStatus
): FluxoraExternalConnectionSnapshot => {
  const existingIndex = snapshot.providers.findIndex(
    (provider) => provider.providerId === status.providerId
  );
  const providers = [...snapshot.providers];
  if (existingIndex >= 0) {
    providers[existingIndex] = status;
  } else {
    providers.push(status);
  }
  return {
    ...snapshot,
    providers,
    completedAtUtc: status.checkedAtUtc || snapshot.completedAtUtc,
    timedOut: false,
    operationId: status.operationId || snapshot.operationId
  };
};

export const connectionIsReady = (
  status: FluxoraExternalConnectionStatus | null | undefined
): boolean => status?.state === 'ready';

export const connectionSummary = (
  status: FluxoraExternalConnectionStatus | null | undefined,
  language: string | null | undefined = 'en-US'
): string => {
  if (!status) {
    return translateForLanguage(language, 'settings.connection.pending');
  }
  switch (status.state) {
    case 'ready':
      return status.accountName
        ? translateForLanguage(language, 'settings.connection.connectedAccount', {
            account: status.accountName
          })
        : translateForLanguage(language, 'settings.connection.connected');
    case 'connecting':
      return translateForLanguage(language, 'settings.connection.connecting');
    case 'restoring':
    case 'temporarilyUnavailable':
      return translateForLanguage(language, 'settings.connection.reconnecting');
    case 'reauthRequired':
      return status.accountName
        ? translateForLanguage(language, 'settings.connection.reconnectAccount', {
            account: status.accountName
          })
        : translateForLanguage(language, 'settings.connection.reconnect');
    case 'notConfigured':
      return status.message || translateForLanguage(language, 'settings.connection.notConfigured');
    case 'notLinked':
    default:
      return translateForLanguage(language, 'settings.connection.notConnected');
  }
};

export const connectionActionLabel = (
  status: FluxoraExternalConnectionStatus | null | undefined,
  language: string | null | undefined = 'en-US'
): string => {
  if (status?.state === 'ready') {
    return translateForLanguage(language, 'settings.connection.action.disconnect');
  }
  if (status?.state === 'connecting') {
    return translateForLanguage(language, 'settings.connection.action.cancel');
  }
  if (status?.state === 'reauthRequired') {
    return translateForLanguage(language, 'settings.connection.action.reconnect');
  }
  if (status?.state === 'restoring' || status?.state === 'temporarilyUnavailable') {
    return translateForLanguage(language, 'settings.connection.action.reconnecting');
  }
  return translateForLanguage(language, 'settings.connection.action.connect');
};

export const connectionCanToggle = (
  status: FluxoraExternalConnectionStatus | null | undefined,
  providerAvailable: boolean
): boolean =>
  Boolean(
    providerAvailable &&
    status &&
    (
      status.state === 'ready'
      || status.state === 'notLinked'
      || status.state === 'connecting'
      || status.state === 'reauthRequired'
    )
  );
