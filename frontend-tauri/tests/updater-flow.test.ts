import { describe, expect, it } from 'vitest';

import type {
  UpdateProgress,
  UpdateRequestSummary
} from '../src/installer/contracts';
import {
  initialUpdaterFlowState,
  updaterFlowReducer
} from '../src/installer/updater/updater-flow';

const summary: UpdateRequestSummary = {
  schemaVersion: 1,
  operationId: 'update-operation',
  currentVersion: '2.4.0',
  targetVersion: '2.5.0',
  assetKind: 'delta',
  presentation: 'compact',
  language: 'en'
};

const progress = (percent: number): UpdateProgress => ({
  schemaVersion: 1,
  operationId: summary.operationId,
  phase: 'installing',
  copiedBytes: percent,
  totalBytes: 100,
  percent,
  statusKey: 'updater.status.installing',
  currentItem: 'bin/Fluxora.exe',
  canCancel: false
});

describe('Updater flow', () => {
  it('moves from validated summary to a monotonic progress state', () => {
    const running = updaterFlowReducer(initialUpdaterFlowState, {
      type: 'summary',
      summary
    });
    const advanced = updaterFlowReducer(running, {
      type: 'progress',
      progress: progress(80)
    });
    const delayed = updaterFlowReducer(advanced, {
      type: 'progress',
      progress: progress(60)
    });
    expect(delayed.state).toBe('running');
    expect(delayed.progress?.percent).toBe(80);
    expect(delayed.progress?.currentItem).toBe('bin/Fluxora.exe');
  });

  it('drops progress from a different operation', () => {
    const running = updaterFlowReducer(initialUpdaterFlowState, {
      type: 'summary',
      summary
    });
    const next = updaterFlowReducer(running, {
      type: 'progress',
      progress: { ...progress(20), operationId: 'foreign-operation' }
    });
    expect(next).toBe(running);
  });

  it.each(['succeeded', 'rolled-back', 'failed'] as const)(
    'represents the %s terminal outcome',
    (outcome) => {
      const result = updaterFlowReducer(initialUpdaterFlowState, {
        type: 'result',
        result: {
          schemaVersion: 1,
          operationId: summary.operationId,
          outcome,
          targetVersion: summary.targetVersion
        }
      });
      expect(result.state).toBe('result');
      expect(result.result?.outcome).toBe(outcome);
    }
  );
});
