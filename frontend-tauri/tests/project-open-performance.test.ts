import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  createProjectOpenTiming,
  formatProjectOpenBackgroundPerformanceMessage,
  formatProjectOpenPerformanceMessage
} from '../src/renderer/services/project-open-performance';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('project open performance timing', () => {
  it('reports the native project, workspace data, render, and total phases', () => {
    const samples = [100, 145, 675, 700];
    const timing = createProjectOpenTiming('op-open', () => samples.shift() ?? 0);

    timing.markProjectConfigLoaded();
    timing.markWorkspaceDataLoaded();

    expect(timing.complete('project-1')).toEqual({
      operationId: 'op-open',
      projectId: 'project-1',
      openConfigMs: 45,
      workspaceDataMs: 530,
      renderCommitMs: 25,
      totalMs: 600
    });
  });

  it('keeps first phase marks when duplicate callbacks arrive', () => {
    const samples = [10, 20, 30, 80, 100, 120];
    const timing = createProjectOpenTiming('op-open', () => samples.shift() ?? 0);

    timing.markProjectConfigLoaded();
    timing.markProjectConfigLoaded();
    timing.markWorkspaceDataLoaded();
    timing.markWorkspaceDataLoaded();

    expect(timing.complete('project-1')).toMatchObject({
      openConfigMs: 10,
      workspaceDataMs: 10,
      renderCommitMs: 50,
      totalMs: 70
    });
  });

  it('formats a machine-readable performance log message', () => {
    expect(
      formatProjectOpenPerformanceMessage({
        operationId: 'op-open',
        projectId: 'project-1',
        openConfigMs: 45.25,
        workspaceDataMs: 530.5,
        renderCommitMs: 25.75,
        totalMs: 601.5
      })
    ).toBe(
      'project_open_completed projectId=project-1 openConfigMs=45.25 workspaceDataMs=530.50 renderCommitMs=25.75 totalMs=601.50'
    );
  });

  it('reports non-critical T4 completion after the interactive frame', () => {
    const samples = [100, 145, 675, 700, 735];
    const timing = createProjectOpenTiming('op-open', () => samples.shift() ?? 0);
    timing.markProjectConfigLoaded();
    timing.markWorkspaceDataLoaded();
    timing.complete('project-1');

    const background = timing.completeBackground('project-1');
    expect(background).toEqual({
      operationId: 'op-open',
      projectId: 'project-1',
      backgroundAfterInteractiveMs: 35,
      totalToBackgroundMs: 635
    });
    expect(formatProjectOpenBackgroundPerformanceMessage(background)).toBe(
      'project_open_background_completed projectId=project-1 backgroundAfterInteractiveMs=35.00 totalToBackgroundMs=635.00'
    );
  });

  it('records T0 through the post-commit renderer frame in the project open flow', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'App.tsx'), 'utf8');

    expect(app).toContain('createProjectOpenTiming(operationId)');
    expect(app).toContain('openTiming.markProjectConfigLoaded()');
    expect(app).toContain('openTiming.markWorkspaceDataLoaded()');
    expect(app).toContain('pendingProjectOpenTimingRef.current = {');
    expect(app).toContain("category: 'Performance'");
    expect(app).toContain('formatProjectOpenPerformanceMessage(sample)');
    expect(app).toContain('formatProjectOpenBackgroundPerformanceMessage(backgroundSample)');
    expect(app).toContain('window.requestAnimationFrame');
  });

  it('correlates the renderer launch click with native and external-ready timing', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'App.tsx'), 'utf8');

    expect(app).toContain('const launchStartedAtMs = performance.now()');
    expect(app).toContain('launch_renderer_process_created clickToProcessCreatedMs=');
    expect(app).toContain('launch_renderer_external_ready clickToReadyMs=');
    expect(app).toContain('operationId');
  });
});
