import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');

describe('install completion UI contract', () => {
  it('updates the archive immediately and silently reconciles Downloads without a global refresh', () => {
    const completion = app.match(
      /if \(operation\.state === 'completed'\) \{[\s\S]*?\} else if \(operation\.state === 'needsReview'\)/
    )?.[0] ?? '';

    expect(completion).toContain("buildStatus: 'Installed'");
    expect(completion).toContain('loadDownloadsWorkspace(selectedProject');
    expect(completion).toContain('showBusy: false');
    expect(completion).toContain('showLoading: false');
    expect(completion).toContain('resetScroll: false');
    expect(completion).toContain('suppressError: true');
    expect(completion).not.toContain('refreshCurrentViewRef.current');
  });
});
