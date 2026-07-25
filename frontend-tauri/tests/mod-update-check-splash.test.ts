import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { FluxoraOperationProgress } from '../src/shared/fluxora-api';
import {
  ModUpdateCheckSplash,
  applyModUpdateCheckProgress,
  createModUpdateCheckSplashState
} from '../src/renderer/features/mods/ModUpdateCheckSplash';

const progress = (
  operationId: string,
  overallPercent: number,
  currentItem: string
): FluxoraOperationProgress => ({
  operationId,
  phase: 'metadata',
  currentStep: '',
  currentItem,
  overallPercent,
  copyPercent: 0,
  databasePercent: 0,
  copiedBytes: 0,
  totalBytes: 0,
  statusMessage: '',
  completed: 2,
  total: 5
});

describe('mod update check splash', () => {
  it('renders real operation progress as a full loading splash', () => {
    const started = createModUpdateCheckSplashState('op_mod_updates');
    const updated = applyModUpdateCheckProgress(
      started,
      progress('op_mod_updates', 40, 'Readable Progress Mod')
    );
    const markup = renderToStaticMarkup(
      React.createElement(ModUpdateCheckSplash, { state: updated })
    );

    expect(markup).toContain('flx-loading-splash');
    expect(markup).toContain('Проверяем обновления модов');
    expect(markup).toContain('Проверено 2 из 5');
    expect(markup).toContain('Readable Progress Mod');
    expect(markup).toContain('aria-valuenow="40"');
    expect(markup).toContain('40%');
  });

  it('ignores progress from another operation', () => {
    const started = createModUpdateCheckSplashState('op_mod_updates');

    expect(
      applyModUpdateCheckProgress(started, progress('op_other', 80, 'Other Mod'))
    ).toBe(started);
  });
});
