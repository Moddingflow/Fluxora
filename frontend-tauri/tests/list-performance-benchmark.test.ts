import { describe, expect, it } from 'vitest';

import {
  createListPerformanceAccumulator
} from '../src/renderer/performance/list-performance-benchmark';

describe('list performance benchmark aggregation', () => {
  it('attributes root-surface and keyed row commits to each concurrent update', () => {
    const run = createListPerformanceAccumulator('run-update-isolation', 0);

    run.beginUpdate('download-progress');
    run.recordRowCommit('mods', 'mod-42');
    run.beginUpdate('terminal-install-delta');
    run.recordSurfaceRender('mods');
    run.recordRowCommit('mods', 'mod-42');
    run.recordRowCommit('mods', 'mod-42');
    run.recordRowCommit('plugins', 'plugin-7');

    const aggregate = run.complete(100);

    expect(aggregate.updates).toEqual([
      {
        label: 'download-progress',
        surfaceRenders: { mods: 0, plugins: 0 },
        rowCommits: {
          mods: { total: 1, distinctRows: 1, maximumPerRow: 1 },
          plugins: { total: 0, distinctRows: 0, maximumPerRow: 0 }
        }
      },
      {
        label: 'terminal-install-delta',
        surfaceRenders: { mods: 1, plugins: 0 },
        rowCommits: {
          mods: { total: 2, distinctRows: 1, maximumPerRow: 2 },
          plugins: { total: 1, distinctRows: 1, maximumPerRow: 1 }
        }
      }
    ]);
  });

  it('emits one cadence-relative aggregate with renderer and bridge evidence', () => {
    const run = createListPerformanceAccumulator('run-144hz', 100);
    const frameInterval = 1000 / 144;
    for (let frame = 0; frame < 40; frame += 1) {
      run.recordFrame(100 + frame * frameInterval);
    }
    run.recordFrame(100 + 40 * frameInterval + 42);

    run.recordScrollEvent('mods', 200);
    run.recordScrollFrame('mods', 207);
    run.recordCommit('mods', 2.4);
    run.recordRenderedRows('mods', 43);
    run.recordCommit('plugins', 1.1);
    run.recordRenderedRows('plugins', 39);
    run.recordStage('workspace-delta-apply', 3.25);
    run.recordStage('workspace-delta-apply', 2.75);
    run.recordLongTask(90, 80, ['Fixture setup']);
    run.recordLongTask(210, 54, ['Layout']);
    run.recordBridgeCall('mods.getWorkspace');
    run.recordBridgeCall('plugins.list');
    run.recordBridgeCall('downloads.list');
    run.recordBridgeCall('workspace.getDelta');
    run.recordBridgeCall('downloads.getDelta');

    const aggregate = run.complete(500, {
      projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition',
      profileName: 'Foundation Edition'
    });

    expect(aggregate.runId).toBe('run-144hz');
    expect(aggregate.frameCadence.medianIntervalMs).toBeCloseTo(frameInterval, 4);
    expect(aggregate.frameCadence.gapsAtLeastThreeFrames).toBe(1);
    expect(aggregate.surfaces.mods).toMatchObject({
      commitCount: 1,
      maximumRenderedRows: 43,
      p99RenderDurationMs: 2.4,
      p99ScrollToFrameLatencyMs: 7
    });
    expect(aggregate.surfaces.plugins).toMatchObject({
      commitCount: 1,
      maximumRenderedRows: 39
    });
    expect(aggregate.bridgeCalls).toEqual({
      fullSnapshots: {
        mods: 1,
        plugins: 1,
        downloads: 1
      },
      deltas: {
        workspace: 1,
        downloads: 1
      }
    });
    expect(aggregate.longTasks).toEqual({
      count: 1,
      maximumDurationMs: 54,
      totalDurationMs: 54,
      attribution: ['Layout']
    });
    expect(aggregate.stages).toEqual({
      'workspace-delta-apply': {
        count: 2,
        maximumDurationMs: 3.25,
        totalDurationMs: 6
      }
    });
    expect(run.complete(700)).toBe(aggregate);
  });
});
