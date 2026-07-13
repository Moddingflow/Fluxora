import { describe, expect, it } from 'vitest';

import {
  processDisplayLabel,
  watchLaunchProcessSession
} from '../src/renderer/features/executables/launch-process-session';
import type { FluxoraProcessWatchResult } from '../src/shared/fluxora-api';

describe('launch process session', () => {
  it('formats a readable application and executable label', () => {
    expect(processDisplayLabel('Skyrim Special Edition', 'SkyrimSE.exe')).toBe(
      'Skyrim Special Edition (SkyrimSE.exe)'
    );
  });

  it('reports the next process that still holds the VFS session', async () => {
    const presentations: string[] = [];
    const waitedProcessIds: number[] = [];
    const transitions: FluxoraProcessWatchResult[] = [
      {
        operationId: 'op_launch',
        processId: 222,
        processName: 'CrashLogger.exe',
        state: 'running',
        trackedKind: 'vfsHolder'
      },
      {
        operationId: 'op_launch',
        processId: 222,
        processName: 'CrashLogger.exe',
        state: 'exited',
        trackedKind: 'vfsHolder'
      }
    ];

    const result = await watchLaunchProcessSession({
      activeProcess: {
        operationId: 'op_launch',
        processId: 111,
        processName: 'SkyrimSE.exe',
        state: 'running',
        trackedKind: 'expectedChildProcess'
      },
      knownProcesses: [
        {
          displayName: 'Skyrim Special Edition',
          executableName: 'SkyrimSE.exe',
          processId: 111
        }
      ],
      onActiveProcess: (process) => presentations.push(process.label),
      operationId: 'op_launch',
      waitForExit: async (processId) => {
        waitedProcessIds.push(processId);
        const transition = transitions.shift();
        if (!transition) {
          throw new Error('Missing process transition');
        }
        return transition;
      }
    });

    expect(waitedProcessIds).toEqual([111, 222]);
    expect(presentations).toEqual([
      'Skyrim Special Edition (SkyrimSE.exe)',
      'CrashLogger (CrashLogger.exe)'
    ]);
    expect(result.state).toBe('exited');
  });
});
