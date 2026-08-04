import { describe, expect, it, vi } from 'vitest';

import {
  createInstallProgressStore,
  installProgressLabel,
  shouldAcceptInstallOperation
} from '../src/renderer/features/mods/install-progress-store';
import type { FluxoraInstallOperation } from '../src/shared/fluxora-api';

const operation = (
  operationId: string,
  state: FluxoraInstallOperation['state'],
  progressPercent = 0
): FluxoraInstallOperation => ({
  operationId,
  sourceKind: 'archive',
  sourcePath: 'C:\\Downloads\\mod.7z',
  archiveFingerprint: 'fingerprint',
  profileName: 'Default',
  existingModMode: 0,
  targetModUuid: '',
  targetFolder: '',
  selectedOptionIds: [],
  manualDecisions: [],
  placementOverridesJson: '{}',
  resume: {},
  beforeOrderId: '',
  afterOrderId: '',
  enqueueSequence: 1,
  state,
  stage: state,
  progressPercent,
  indeterminate: false,
  errorCode: '',
  errorMessage: '',
  result: null
});

describe('install progress store', () => {
  it('notifies only subscribers for the changed operation key', () => {
    const store = createInstallProgressStore();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    store.subscribe('first', firstListener);
    store.subscribe('second', secondListener);
    const untouchedSnapshot = store.getSnapshot('second');

    store.setOperation(operation('first', 'extracting', 25));

    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();
    expect(store.getSnapshot('second')).toBe(untouchedSnapshot);
    expect(store.getSnapshot('first')).toMatchObject({
      label: 'Extracting',
      progressPercent: 25,
      state: 'extracting'
    });
  });

  it('keeps an immutable cached snapshot and suppresses equivalent updates', () => {
    const store = createInstallProgressStore();
    const listener = vi.fn();
    store.subscribe('install', listener);
    store.setOperation(operation('install', 'buildingStaging', 45));
    const snapshot = store.getSnapshot('install');

    store.setOperation({
      ...operation('install', 'buildingStaging', 45),
      sourcePath: 'C:\\Other\\same-render-state.7z'
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(store.getSnapshot('install')).toBe(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('does not let a late queued submit response overwrite newer progress', () => {
    const store = createInstallProgressStore();
    const listener = vi.fn();
    const extracting = operation('install', 'extracting', 10);
    const queued = operation('install', 'queued', 0);
    store.subscribe('install', listener);

    store.setOperation(extracting);
    store.setOperation(queued);

    expect(shouldAcceptInstallOperation(extracting, queued)).toBe(false);
    expect(store.getSnapshot('install')).toMatchObject({
      label: 'Extracting',
      progressPercent: 10,
      state: 'extracting'
    });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('keeps terminal review state internal and clears one key without disturbing others', () => {
    const store = createInstallProgressStore();
    store.setOperation(operation('first', 'needsReview', 100));
    store.setOperation(operation('second', 'queued'));
    const secondSnapshot = store.getSnapshot('second');
    const listener = vi.fn();
    store.subscribe('first', listener);

    store.delete('first');

    expect(listener).toHaveBeenCalledOnce();
    expect(store.getSnapshot('first').operation).toBeNull();
    expect(store.getSnapshot('second')).toBe(secondSnapshot);
    expect(installProgressLabel(operation('first', 'needsReview'))).toBe('');
    expect(installProgressLabel(operation('first', 'extracting'), 'ru-RU')).toBe('Распаковка');
  });
});
