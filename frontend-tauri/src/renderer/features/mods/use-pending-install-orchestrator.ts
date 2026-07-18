import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  FluxoraInstallConflictSnapshot,
  FluxoraInstalledModSummary,
  FluxoraInstallOperation,
  FluxoraModOrderItem,
  FluxoraOperationProgress
} from '../../../shared/fluxora-api';
import {
  applyPendingInstallConflictSnapshot,
  beginPendingInstall,
  completePendingInstall,
  markPendingInstallRebased,
  mergePendingInstallIntoAuthoritativeItems,
  pendingInstallConflictMarkerReady,
  pendingInstallTargetIndex,
  rollbackPendingInstall,
  type CompletedPendingInstallState,
  type PendingInstallDraft,
  type PendingInstallSessionState
} from './pending-install-orchestrator-state';

interface PendingInstallOrchestratorOptions {
  items: FluxoraModOrderItem[];
  onItemsChanged: (items: FluxoraModOrderItem[]) => void;
  onWorkspaceRevision: () => void;
  onRebaseError?: (error: unknown, operationId: string) => void;
  onOperationProgress?: (operation: FluxoraInstallOperation) => void;
}

interface BeginPendingInstallRequest extends PendingInstallDraft {
  projectDirectory: string;
}

export interface PendingInstallOrchestrator {
  session: PendingInstallSessionState | null;
  sessions: ReadonlyMap<string, PendingInstallSessionState>;
  begin: (request: BeginPendingInstallRequest) => PendingInstallSessionState;
  complete: (installed: FluxoraInstalledModSummary) => CompletedPendingInstallState;
  rollback: (operationId: string) => boolean;
  rebase: (
    projectDirectory: string,
    items: FluxoraModOrderItem[],
    userInitiated: boolean
  ) => Promise<FluxoraInstallConflictSnapshot | null>;
  flushRebase: () => Promise<FluxoraInstallConflictSnapshot | null>;
  mergeAuthoritativeItems: (items: FluxoraModOrderItem[]) => FluxoraModOrderItem[];
  isActiveOrderItem: (item: FluxoraModOrderItem) => boolean;
  conflictMarkerReady: (item: FluxoraModOrderItem) => boolean;
}

const activeItemMatches = (
  session: PendingInstallSessionState,
  item: FluxoraModOrderItem
): boolean =>
  item.orderId === session.rowOrderId ||
  item.orderId === session.pendingOrderId ||
  Boolean(session.targetModUuid && item.modUuid === session.targetModUuid);

const stableOrderAnchors = (
  session: PendingInstallSessionState,
  items: readonly FluxoraModOrderItem[]
) => {
  const rowIndex = items.findIndex((item) => item.orderId === session.rowOrderId);
  const insertionIndex = rowIndex >= 0 ? rowIndex : session.desiredTargetIndex;
  const isStable = (item: FluxoraModOrderItem): boolean =>
    item.orderId !== session.rowOrderId && !item.orderId.startsWith('pending-install:');
  const before = items.slice(0, Math.max(0, insertionIndex)).reverse().find(isStable);
  const after = items.slice(Math.max(0, insertionIndex + (rowIndex >= 0 ? 1 : 0))).find(isStable);
  return {
    beforeOrderId: before?.orderId,
    afterOrderId: after?.orderId,
    fallbackTargetIndex: session.desiredTargetIndex
  };
};

const installStateLabel = (operation: FluxoraInstallOperation): string => {
  switch (operation.state) {
    case 'queued': return 'В очереди';
    case 'validating': return 'Проверка';
    case 'extracting': return 'Распаковка';
    case 'configuringFomod': return 'Настройка FOMOD';
    case 'buildingStaging': return 'Подготовка файлов';
    case 'projectingConflicts': return 'Проверка конфликтов';
    case 'waitingTarget': return 'Ожидание другого обновления';
    case 'committing': return 'Применение';
    case 'finalizing': return 'Применение';
    case 'recovering': return 'Восстановление';
    case 'needsReview': return 'Требуется проверка';
    case 'failed': return 'Ошибка установки';
    case 'completed': return operation.result?.version || 'Установлен';
  }
};

const installedSummaryFromOperation = (
  operation: FluxoraInstallOperation
): FluxoraInstalledModSummary | null => {
  const result = operation.result;
  if (!result) {
    return null;
  }
  return {
    ...result,
    latestVersion: '',
    latestFileId: '',
    updateCheckState: '',
    sourceIsNexus: false,
    sourceIsModdingFlow: false,
    isLocal: true,
    isTranslation: false,
    isPatch: false,
    overwritesModIds: [],
    overwrittenByModIds: [],
    operationId: operation.operationId
  };
};

export const usePendingInstallOrchestrator = (
  options: PendingInstallOrchestratorOptions
): PendingInstallOrchestrator => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const itemsRef = useRef(options.items);
  itemsRef.current = options.items;
  const projectedItemsRef = useRef(options.items);
  const sessionsRef = useRef(new Map<string, PendingInstallSessionState>());
  const projectDirectoriesRef = useRef(new Map<string, string>());
  const rebaseInFlightRef = useRef(
    new Map<string, Promise<FluxoraInstallConflictSnapshot | null>>()
  );
  const [sessions, setSessions] = useState<ReadonlyMap<string, PendingInstallSessionState>>(
    () => new Map()
  );

  const publishSessions = useCallback(() => {
    setSessions(new Map(sessionsRef.current));
  }, []);

  const publish = useCallback((
    operationId: string,
    nextSession: PendingInstallSessionState,
    nextItems: FluxoraModOrderItem[]
  ) => {
    sessionsRef.current.set(operationId, nextSession);
    itemsRef.current = nextItems;
    projectedItemsRef.current = nextItems;
    publishSessions();
    optionsRef.current.onWorkspaceRevision();
    optionsRef.current.onItemsChanged(nextItems);
  }, [publishSessions]);

  const applySnapshot = useCallback((snapshot: FluxoraInstallConflictSnapshot): boolean => {
    const current = sessionsRef.current.get(snapshot.operationId);
    if (!current) {
      return false;
    }
    const applied = applyPendingInstallConflictSnapshot(current, itemsRef.current, snapshot);
    if (!applied.accepted) {
      return false;
    }
    publish(snapshot.operationId, applied.session, applied.items);
    return true;
  }, [publish]);

  const flushOperationRebase = useCallback(async (
    operationId: string
  ): Promise<FluxoraInstallConflictSnapshot | null> => {
    const existing = rebaseInFlightRef.current.get(operationId);
    if (existing) {
      return existing;
    }
    const current = sessionsRef.current.get(operationId);
    const projectDirectory = projectDirectoriesRef.current.get(operationId) ?? '';
    if (!current || !projectDirectory) {
      return null;
    }

    const requestedTargetIndex = current.desiredTargetIndex;
    const inFlight = window.fluxora.mods.rebasePendingInstall(
      projectDirectory,
      operationId,
      stableOrderAnchors(current, itemsRef.current)
    ).then((snapshot) => {
      applySnapshot(snapshot);
      return snapshot;
    }).catch((error: unknown) => {
      const active = sessionsRef.current.get(operationId);
      if (active?.state === 'preparing') {
        return null;
      }
      throw error;
    }).finally(() => {
      rebaseInFlightRef.current.delete(operationId);
    });
    rebaseInFlightRef.current.set(operationId, inFlight);
    const snapshot = await inFlight;
    const latest = sessionsRef.current.get(operationId);
    if (latest && latest.desiredTargetIndex !== requestedTargetIndex) {
      return flushOperationRebase(operationId);
    }
    return snapshot;
  }, [applySnapshot]);

  const flushRebase = useCallback(async () => {
    let latest: FluxoraInstallConflictSnapshot | null = null;
    for (const operationId of sessionsRef.current.keys()) {
      latest = (await flushOperationRebase(operationId)) ?? latest;
    }
    return latest;
  }, [flushOperationRebase]);

  const begin = useCallback((request: BeginPendingInstallRequest) => {
    const existing = sessionsRef.current.get(request.operationId);
    if (existing) {
      return existing;
    }
    const started = beginPendingInstall(itemsRef.current, request);
    projectDirectoriesRef.current.set(request.operationId, request.projectDirectory);
    publish(request.operationId, started.session, started.items);
    return started.session;
  }, [publish]);

  const rollback = useCallback((operationId: string): boolean => {
    const current = sessionsRef.current.get(operationId);
    if (!current) {
      return false;
    }
    const restored = rollbackPendingInstall(current, itemsRef.current);
    sessionsRef.current.delete(operationId);
    projectDirectoriesRef.current.delete(operationId);
    itemsRef.current = restored;
    projectedItemsRef.current = restored;
    publishSessions();
    optionsRef.current.onWorkspaceRevision();
    optionsRef.current.onItemsChanged(restored);
    return true;
  }, [publishSessions]);

  const complete = useCallback((installed: FluxoraInstalledModSummary) => {
    const current = sessionsRef.current.get(installed.operationId);
    if (!current) {
      throw new Error('The install completed without its pending row.');
    }
    const completed = completePendingInstall(current, itemsRef.current, installed);
    sessionsRef.current.delete(installed.operationId);
    projectDirectoriesRef.current.delete(installed.operationId);
    itemsRef.current = completed.items;
    projectedItemsRef.current = completed.items;
    publishSessions();
    optionsRef.current.onWorkspaceRevision();
    optionsRef.current.onItemsChanged(completed.items);
    return completed;
  }, [publishSessions]);

  const rebase = useCallback(async (
    projectDirectory: string,
    nextItems: FluxoraModOrderItem[],
    userInitiated: boolean
  ): Promise<FluxoraInstallConflictSnapshot | null> => {
    itemsRef.current = nextItems;
    projectedItemsRef.current = nextItems;
    for (const [operationId, current] of sessionsRef.current) {
      projectDirectoriesRef.current.set(operationId, projectDirectory);
      const targetIndex = pendingInstallTargetIndex(current, nextItems);
      sessionsRef.current.set(
        operationId,
        markPendingInstallRebased(current, targetIndex, userInitiated)
      );
    }
    publishSessions();
    return flushRebase();
  }, [flushRebase, publishSessions]);

  const mergeAuthoritativeItems = useCallback((authoritativeItems: FluxoraModOrderItem[]) => {
    let merged = authoritativeItems;
    for (const session of sessionsRef.current.values()) {
      merged = mergePendingInstallIntoAuthoritativeItems(
        session,
        projectedItemsRef.current,
        merged
      );
    }
    itemsRef.current = merged;
    projectedItemsRef.current = merged;
    return merged;
  }, []);

  const isActiveOrderItem = useCallback(
    (item: FluxoraModOrderItem) =>
      [...sessionsRef.current.values()].some((session) => activeItemMatches(session, item)),
    []
  );

  const conflictMarkerReady = useCallback((item: FluxoraModOrderItem) => {
    const session = [...sessionsRef.current.values()].find((candidate) =>
      activeItemMatches(candidate, item)
    );
    return session ? pendingInstallConflictMarkerReady(session, item) : true;
  }, []);

  useEffect(() => {
    const activeSessions = [...sessions.values()];
    if (
      activeSessions.length === 0 ||
      activeSessions.every((session) =>
        options.items.some((item) => activeItemMatches(session, item))
      )
    ) {
      return;
    }

    let merged = options.items;
    for (const session of activeSessions) {
      merged = mergePendingInstallIntoAuthoritativeItems(
        session,
        projectedItemsRef.current,
        merged
      );
    }
    itemsRef.current = merged;
    projectedItemsRef.current = merged;
    void window.fluxora.ui.log({
      level: 'info',
      category: 'ModInstall',
      message: `Restored ${activeSessions.length} pending install projection(s) after workspace refresh.`
    });
    optionsRef.current.onItemsChanged(merged);
  }, [options.items, sessions]);

  useEffect(() => window.fluxora.operations.onProgress((progress: FluxoraOperationProgress) => {
    const snapshot = progress.installConflictSnapshot;
    if (!snapshot || !applySnapshot(snapshot)) {
      return;
    }
    const current = sessionsRef.current.get(snapshot.operationId);
    if (
      current &&
      current.state !== 'failed' &&
      current.desiredTargetIndex !== snapshot.targetIndex
    ) {
      void flushOperationRebase(snapshot.operationId).catch((error) =>
        optionsRef.current.onRebaseError?.(error, snapshot.operationId)
      );
    }
  }), [applySnapshot, flushOperationRebase]);

  useEffect(() => window.fluxora.installs.onProgress((operation) => {
    const session = sessionsRef.current.get(operation.operationId);
    if (session) {
      const nextItems = itemsRef.current.map((item) =>
        activeItemMatches(session, item)
          ? { ...item, version: installStateLabel(operation) }
          : item
      );
      itemsRef.current = nextItems;
      projectedItemsRef.current = nextItems;
      optionsRef.current.onItemsChanged(nextItems);
      if (operation.state === 'completed') {
        const installed = installedSummaryFromOperation(operation);
        if (installed) {
          complete(installed);
        }
      } else if (operation.state === 'failed') {
        rollback(operation.operationId);
      }
    }
    optionsRef.current.onOperationProgress?.(operation);
  }), [complete, rollback]);

  const latestSession = [...sessions.values()].at(-1) ?? null;
  return {
    session: latestSession,
    sessions,
    begin,
    complete,
    rollback,
    rebase,
    flushRebase,
    mergeAuthoritativeItems,
    isActiveOrderItem,
    conflictMarkerReady
  };
};
