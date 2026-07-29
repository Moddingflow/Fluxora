import { useCallback, useSyncExternalStore } from 'react';

import type {
  FluxoraInstallOperation,
  FluxoraInstallOperationState
} from '../../../shared/fluxora-api';

export interface InstallProgressSnapshot {
  operation: FluxoraInstallOperation | null;
  state: FluxoraInstallOperationState | null;
  stage: FluxoraInstallOperationState | null;
  label: string;
  progressPercent: number;
  indeterminate: boolean;
  errorCode: string;
  errorMessage: string;
}

export interface InstallProgressStore {
  setOperation: (operation: FluxoraInstallOperation) => void;
  delete: (operationId: string) => void;
  subscribe: (operationId: string, listener: () => void) => () => void;
  getSnapshot: (operationId: string) => InstallProgressSnapshot;
}

const emptySnapshot: InstallProgressSnapshot = Object.freeze({
  operation: null,
  state: null,
  stage: null,
  label: '',
  progressPercent: 0,
  indeterminate: false,
  errorCode: '',
  errorMessage: ''
});

export const installProgressLabel = (operation: FluxoraInstallOperation): string => {
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
    case 'cancelled': return 'Отменено';
    case 'needsReview': return '';
    case 'failed': return 'Ошибка установки';
    case 'completed': return operation.result?.version || 'Установлен';
  }
};

export const shouldAcceptInstallOperation = (
  current: FluxoraInstallOperation | null | undefined,
  next: FluxoraInstallOperation
): boolean =>
  !current ||
  current.operationId !== next.operationId ||
  next.state !== 'queued' ||
  current.state === 'queued';

const sameRenderedProgress = (
  current: InstallProgressSnapshot,
  operation: FluxoraInstallOperation
): boolean =>
  current.state === operation.state &&
  current.stage === operation.stage &&
  current.progressPercent === operation.progressPercent &&
  current.indeterminate === operation.indeterminate &&
  current.errorCode === operation.errorCode &&
  current.errorMessage === operation.errorMessage &&
  current.label === installProgressLabel(operation);

const snapshotFromOperation = (
  operation: FluxoraInstallOperation
): InstallProgressSnapshot => Object.freeze({
  operation,
  state: operation.state,
  stage: operation.stage,
  label: installProgressLabel(operation),
  progressPercent: operation.progressPercent,
  indeterminate: operation.indeterminate,
  errorCode: operation.errorCode,
  errorMessage: operation.errorMessage
});

export const createInstallProgressStore = (): InstallProgressStore => {
  const snapshots = new Map<string, InstallProgressSnapshot>();
  const listenersByOperationId = new Map<string, Set<() => void>>();

  const notify = (operationId: string) => {
    listenersByOperationId.get(operationId)?.forEach((listener) => listener());
  };

  return {
    setOperation(operation) {
      const current = snapshots.get(operation.operationId);
      if (!shouldAcceptInstallOperation(current?.operation, operation)) {
        return;
      }
      if (current && sameRenderedProgress(current, operation)) {
        return;
      }
      snapshots.set(operation.operationId, snapshotFromOperation(operation));
      notify(operation.operationId);
    },
    delete(operationId) {
      if (!snapshots.delete(operationId)) {
        return;
      }
      notify(operationId);
    },
    subscribe(operationId, listener) {
      const listeners = listenersByOperationId.get(operationId) ?? new Set();
      listeners.add(listener);
      listenersByOperationId.set(operationId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          listenersByOperationId.delete(operationId);
        }
      };
    },
    getSnapshot(operationId) {
      return snapshots.get(operationId) ?? emptySnapshot;
    }
  };
};

export const useInstallProgress = (
  store: InstallProgressStore,
  operationId: string | null
): InstallProgressSnapshot => {
  const subscribe = useCallback(
    (listener: () => void) =>
      operationId ? store.subscribe(operationId, listener) : () => undefined,
    [operationId, store]
  );
  const getSnapshot = useCallback(
    () => operationId ? store.getSnapshot(operationId) : emptySnapshot,
    [operationId, store]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
