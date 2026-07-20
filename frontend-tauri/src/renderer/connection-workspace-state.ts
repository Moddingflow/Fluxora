import type {
  FluxoraExternalConnectionSnapshot,
  FluxoraExternalConnectionState,
  FluxoraExternalConnectionStatus
} from '../shared/fluxora-api';

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
    accountName: typeof record.accountName === 'string' ? record.accountName : '',
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
        label: 'Nexus Mods',
        state,
        accountName,
        hasStoredSession: linked,
        retryable: state === 'restoring',
        requiresUserAction: state === 'reauthRequired',
        message: state === 'restoring' ? 'Restoring saved Nexus Mods session.' : '',
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
    storage?.setItem(connectionSnapshotStorageKey, JSON.stringify(snapshot));
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
  status: FluxoraExternalConnectionStatus | null | undefined
): string => {
  if (!status) {
    return 'Status pending';
  }
  switch (status.state) {
    case 'ready':
      return status.accountName ? `Connected - ${status.accountName}` : 'Connected';
    case 'restoring':
    case 'temporarilyUnavailable':
      return 'Reconnecting';
    case 'reauthRequired':
      return status.accountName ? `Sign in again - ${status.accountName}` : 'Sign in again';
    case 'notConfigured':
      return 'Provider is not configured';
    case 'notLinked':
    default:
      return 'Not connected';
  }
};

export const connectionActionLabel = (
  status: FluxoraExternalConnectionStatus | null | undefined
): string => {
  if (status?.state === 'ready') {
    return `Disconnect ${status.label}`;
  }
  if (status?.state === 'reauthRequired') {
    return 'Sign in again';
  }
  if (status?.state === 'restoring' || status?.state === 'temporarilyUnavailable') {
    return 'Reconnecting';
  }
  return `Connect ${status?.label ?? 'provider'}`;
};

export const connectionCanToggle = (
  status: FluxoraExternalConnectionStatus | null | undefined,
  providerAvailable: boolean
): boolean =>
  Boolean(
    providerAvailable &&
    status &&
    (status.state === 'ready' || status.state === 'notLinked' || status.state === 'reauthRequired')
  );
