import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  OperationOverlay,
  type OperationOverlayState
} from '../src/renderer/features/operations/OperationOverlay';

const overlay = (patch: Partial<OperationOverlayState> = {}): OperationOverlayState => ({
  operationId: 'op_test',
  kind: 'fluxpack-install',
  title: 'Installing FluxPack',
  statusText: 'Copying files',
  currentItem: 'Skyrim graphics overhaul',
  percent: 44,
  isRunning: true,
  canClose: false,
  cancelRequested: false,
  createdProject: null,
  resultText: null,
  errorText: null,
  ...patch
});

describe('operation overlays', () => {
  it('renders running operations through redesign feedback primitives', () => {
    const markup = renderToStaticMarkup(
      <OperationOverlay
        cancellationSupported
        onCancel={() => undefined}
        onClose={() => undefined}
        overlay={overlay()}
      />
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('flx-facet-spinner');
    expect(markup).toContain('flx-progress');
    expect(markup).toContain('aria-valuenow="44"');
    expect(markup).toContain('Отменить');
  });

  it('uses indeterminate progress only when the native API has no percent yet', () => {
    const markup = renderToStaticMarkup(
      <OperationOverlay
        cancellationSupported={false}
        onCancel={() => undefined}
        onClose={() => undefined}
        overlay={overlay({ kind: 'fluxpack-export', percent: null })}
      />
    );

    expect(markup).toContain('data-indeterminate="true"');
    expect(markup).toContain('Waiting for progress');
  });

  it('renders user-safe error states as alerts', () => {
    const markup = renderToStaticMarkup(
      <OperationOverlay
        cancellationSupported={false}
        onCancel={() => undefined}
        onClose={() => undefined}
        overlay={overlay({ errorText: 'Install root is not writable.', isRunning: false })}
      />
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Install root is not writable.');
  });
});
