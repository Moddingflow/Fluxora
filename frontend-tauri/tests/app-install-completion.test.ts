import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');

describe('install completion UI contract', () => {
  it('updates the archive immediately and applies the terminal workspace delta without a full reload', () => {
    const operationProgress =
      app.match(/onOperationProgress: \(operation\) => \{[\s\S]*?pluginOrderSaveSequenceRef/)?.[0] ??
      '';
    const completion = app.match(
      /if \(operation\.state === 'completed'\) \{[\s\S]*?\} else if \(operation\.state === 'needsReview'\)/
    )?.[0] ?? '';

    expect(operationProgress).toContain('if (operation.workspaceDelta)');
    expect(operationProgress).toContain('applyIncomingWorkspaceDeltaRef.current(');
    expect(operationProgress).toContain('operation.operationId');
    expect(completion).toContain("buildStatus: 'Installed'");
    expect(completion).not.toContain('loadDownloadsWorkspace(');
    expect(operationProgress).not.toContain('loadModsWorkspace(');
    expect(operationProgress).not.toContain('loadPluginsWorkspace(');
    expect(completion).not.toContain('refreshCurrentViewRef.current');
  });
});
