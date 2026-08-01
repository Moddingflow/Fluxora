import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');

describe('install completion UI contract', () => {
  it('settles the projection, terminal delta and archive after order mutations settle', () => {
    const operationProgress =
      app.match(
        /onOperationProgress: \(operation, finalizePendingProjection\) => \{[\s\S]*?pluginOrderSaveSequenceRef/
      )?.[0] ??
      '';
    const completion = operationProgress.match(
      /if \(operation\.state === 'completed'\) \{[\s\S]*?\} else if \(operation\.state === 'needsReview'\)/
    )?.[0] ?? '';

    expect(operationProgress).toContain('const workspaceDelta = operation.workspaceDelta');
    expect(operationProgress).toContain('workspaceOrderMutationGate');
    expect(operationProgress).toContain('.readStable(async () => workspaceDelta)');
    expect(operationProgress).toContain('finalizePendingProjection?.()');
    expect(operationProgress).toContain('applyIncomingWorkspaceDeltaRef.current(');
    expect(operationProgress.indexOf('finalizePendingProjection?.()')).toBeLessThan(
      operationProgress.indexOf('applyIncomingWorkspaceDeltaRef.current(')
    );
    expect(operationProgress.indexOf('applyIncomingWorkspaceDeltaRef.current(')).toBeLessThan(
      operationProgress.lastIndexOf('settleOperation();')
    );
    expect(operationProgress).toContain('operation.operationId');
    expect(operationProgress).toContain('true');
    expect(completion).toContain("buildStatus: 'Installed'");
    expect(completion).not.toContain('loadDownloadsWorkspace(');
    expect(operationProgress).not.toContain('loadModsWorkspace(');
    expect(operationProgress).not.toContain('loadPluginsWorkspace(');
    expect(completion).not.toContain('refreshCurrentViewRef.current');
  });

  it('keeps the previous layout visible and rejects stale placement validation responses', () => {
    const revalidation = app.match(
      /const updateInstallPlacementEdits = \(placementEdits:[\s\S]*?\n  };/
    )?.[0] ?? '';

    expect(revalidation).toContain('const generation = ++installPlacementValidationGenerationRef.current');
    expect(revalidation).toContain('placementValidationPending: true');
    expect(revalidation).not.toContain('layoutPreview: null');
    expect(revalidation.match(/installPlacementValidationGenerationRef\.current !== generation/g)).toHaveLength(2);
    expect(revalidation).toContain('layoutPreview,');
    expect(revalidation).toContain('placementValidationPending: false');
  });
});
