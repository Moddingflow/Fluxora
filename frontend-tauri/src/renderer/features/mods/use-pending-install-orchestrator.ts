import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  FluxoraInstallConflictSnapshot,
  FluxoraInstalledModSummary,
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
}

interface BeginPendingInstallRequest extends PendingInstallDraft {
  projectDirectory: string;
}

export interface PendingInstallOrchestrator {
  session: PendingInstallSessionState | null;
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
  session: PendingInstallSessionState | null,
  item: FluxoraModOrderItem
): boolean =>
  Boolean(
    session &&
      (item.orderId === session.rowOrderId ||
        item.orderId === session.pendingOrderId ||
        (session.targetModUuid && item.modUuid === session.targetModUuid))
  );

export const usePendingInstallOrchestrator = (
  options: PendingInstallOrchestratorOptions
): PendingInstallOrchestrator => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const itemsRef = useRef(options.items);
  itemsRef.current = options.items;
  const sessionRef = useRef<PendingInstallSessionState | null>(null);
  const projectDirectoryRef = useRef('');
  const rebaseInFlightRef = useRef<Promise<FluxoraInstallConflictSnapshot | null> | null>(null);
  const [session, setSession] = useState<PendingInstallSessionState | null>(null);

  const publish = useCallback((
    nextSession: PendingInstallSessionState,
    nextItems: FluxoraModOrderItem[]
  ) => {
    sessionRef.current = nextSession;
    itemsRef.current = nextItems;
    setSession(nextSession);
    optionsRef.current.onWorkspaceRevision();
    optionsRef.current.onItemsChanged(nextItems);
  }, []);

  const applySnapshot = useCallback((snapshot: FluxoraInstallConflictSnapshot): boolean => {
    const current = sessionRef.current;
    if (!current) {
      return false;
    }

    const applied = applyPendingInstallConflictSnapshot(current, itemsRef.current, snapshot);
    if (!applied.accepted) {
      return false;
    }
    publish(applied.session, applied.items);
    return true;
  }, [publish]);

  const flushRebase = useCallback(async (): Promise<FluxoraInstallConflictSnapshot | null> => {
    if (rebaseInFlightRef.current) {
      return rebaseInFlightRef.current;
    }

    const current = sessionRef.current;
    const projectDirectory = projectDirectoryRef.current;
    if (!current || !projectDirectory) {
      return null;
    }

    const requestedTargetIndex = current.desiredTargetIndex;
    const request = window.fluxora.mods.rebasePendingInstall(
      projectDirectory,
      current.operationId,
      requestedTargetIndex
    );
    const inFlight = request.then((snapshot) => {
      applySnapshot(snapshot);
      return snapshot;
    }).catch((error: unknown) => {
      const active = sessionRef.current;
      if (active?.operationId === current.operationId && active.state === 'preparing') {
        return null;
      }
      throw error;
    }).finally(() => {
      rebaseInFlightRef.current = null;
    });
    rebaseInFlightRef.current = inFlight;
    const snapshot = await inFlight;

    const latest = sessionRef.current;
    if (
      latest?.operationId === current.operationId &&
      latest.desiredTargetIndex !== requestedTargetIndex
    ) {
      return flushRebase();
    }
    return snapshot;
  }, [applySnapshot]);

  const begin = useCallback((request: BeginPendingInstallRequest) => {
    if (sessionRef.current) {
      throw new Error('Another install is already pending in the mod workspace.');
    }
    const started = beginPendingInstall(itemsRef.current, request);
    projectDirectoryRef.current = request.projectDirectory;
    publish(started.session, started.items);
    return started.session;
  }, [publish]);

  const rollback = useCallback((operationId: string): boolean => {
    const current = sessionRef.current;
    if (!current || current.operationId !== operationId) {
      return false;
    }

    const restored = rollbackPendingInstall(current, itemsRef.current);
    sessionRef.current = null;
    projectDirectoryRef.current = '';
    itemsRef.current = restored;
    setSession(null);
    optionsRef.current.onWorkspaceRevision();
    optionsRef.current.onItemsChanged(restored);
    return true;
  }, []);

  const complete = useCallback((installed: FluxoraInstalledModSummary) => {
    const current = sessionRef.current;
    if (!current) {
      throw new Error('The install completed without an active pending row.');
    }
    const completed = completePendingInstall(current, itemsRef.current, installed);
    sessionRef.current = null;
    projectDirectoryRef.current = '';
    itemsRef.current = completed.items;
    setSession(null);
    optionsRef.current.onWorkspaceRevision();
    optionsRef.current.onItemsChanged(completed.items);
    return completed;
  }, []);

  const rebase = useCallback(async (
    projectDirectory: string,
    nextItems: FluxoraModOrderItem[],
    userInitiated: boolean
  ): Promise<FluxoraInstallConflictSnapshot | null> => {
    const current = sessionRef.current;
    if (!current) {
      return null;
    }
    itemsRef.current = nextItems;
    projectDirectoryRef.current = projectDirectory;
    const targetIndex = pendingInstallTargetIndex(current, nextItems);
    const nextSession = markPendingInstallRebased(current, targetIndex, userInitiated);
    sessionRef.current = nextSession;
    setSession(nextSession);
    return flushRebase();
  }, [flushRebase]);

  const mergeAuthoritativeItems = useCallback((authoritativeItems: FluxoraModOrderItem[]) => {
    const merged = mergePendingInstallIntoAuthoritativeItems(
      sessionRef.current,
      itemsRef.current,
      authoritativeItems
    );
    itemsRef.current = merged;
    return merged;
  }, []);

  const isActiveOrderItem = useCallback(
    (item: FluxoraModOrderItem) => activeItemMatches(sessionRef.current, item),
    []
  );

  const conflictMarkerReady = useCallback(
    (item: FluxoraModOrderItem) => pendingInstallConflictMarkerReady(sessionRef.current, item),
    []
  );

  useEffect(() => window.fluxora.operations.onProgress((progress: FluxoraOperationProgress) => {
    const snapshot = progress.installConflictSnapshot;
    if (!snapshot || !applySnapshot(snapshot)) {
      return;
    }

    const current = sessionRef.current;
    if (
      current &&
      current.state !== 'failed' &&
      current.desiredTargetIndex !== snapshot.targetIndex
    ) {
      void flushRebase().catch((error) =>
        optionsRef.current.onRebaseError?.(error, current.operationId)
      );
    }
  }), [applySnapshot, flushRebase]);

  return {
    session,
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
