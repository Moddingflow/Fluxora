import { describe, expect, it, vi } from 'vitest';

import {
  acknowledgeRendererReady,
  appUpdateToolbarView,
  createAppUpdateCoordinator,
  rendererReadyWorstCaseBudgetMs
} from '../src/renderer/features/update/app-update-coordinator';
import type { FluxoraApi, FluxoraUpdateStatus } from '../src/shared/fluxora-api';

const status = (state: FluxoraUpdateStatus['state']): FluxoraUpdateStatus => ({
  state,
  currentVersion: '2.3.0'
});

describe('app update coordinator', () => {
  it('retries renderer health acknowledgment until the main renderer succeeds', async () => {
    const rendererReady = vi.fn()
      .mockRejectedValueOnce(new Error('bridge cold'))
      .mockRejectedValueOnce(new Error('ack file busy'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn(async () => undefined);

    await expect(acknowledgeRendererReady(
      { rendererReady },
      { delaysMs: [0, 10, 20], sleep }
    )).resolves.toBe(true);

    expect(rendererReady).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it('stops renderer health retries when the mounting window is disposed', async () => {
    let cancelled = false;
    const rendererReady = vi.fn().mockRejectedValue(new Error('not ready'));
    const sleep = vi.fn(async () => { cancelled = true; });

    await expect(acknowledgeRendererReady(
      { rendererReady },
      { delaysMs: [0, 10, 20], sleep, isCancelled: () => cancelled }
    )).resolves.toBe(false);

    expect(rendererReady).toHaveBeenCalledOnce();
  });

  it('keeps the complete renderer-ready retry budget below updater probation', () => {
    expect(rendererReadyWorstCaseBudgetMs).toBeLessThan(30_000);
  });

  it('does not start another renderer-ready attempt after the absolute deadline', async () => {
    let nowMs = 0;
    const rendererReady = vi.fn(async () => {
      nowMs += 2_000;
      throw new Error('bridge timeout');
    });
    const sleep = vi.fn(async (delayMs: number) => {
      nowMs += delayMs;
    });

    await expect(acknowledgeRendererReady(
      { rendererReady },
      {
        delaysMs: [0, 500, 1_000],
        deadlineMs: 2_400,
        now: () => nowMs,
        sleep
      }
    )).resolves.toBe(false);

    expect(rendererReady).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('keeps startup checking, up-to-date and automatic failure states silent', () => {
    const activate = vi.fn();

    expect(appUpdateToolbarView(status('checking'), false, activate)).toEqual({ state: 'hidden' });
    expect(appUpdateToolbarView(status('upToDate'), false, activate)).toEqual({ state: 'hidden' });
    expect(
      appUpdateToolbarView(
        {
          ...status('error'),
          error: { code: 'network', message: 'offline', retryable: true }
        },
        false,
        activate
      )
    ).toEqual({ state: 'hidden' });
  });

  it('projects only availability into the toolbar and hands progress to the updater window', () => {
    const activate = vi.fn();

    expect(
      appUpdateToolbarView(
        { ...status('available'), availableVersion: '2.4.0' },
        false,
        activate
      )
    ).toEqual({ state: 'available', version: '2.4.0', onActivate: activate });
    expect(
      appUpdateToolbarView(
        {
          ...status('downloading'),
          availableVersion: '2.4.0',
          downloadedBytes: 25,
          totalBytes: 100
        },
        true,
        activate
      )
    ).toEqual({ state: 'hidden' });
    expect(
      appUpdateToolbarView(
        {
          ...status('waitingForOperations'),
          availableVersion: '2.4.0',
          progressPercent: 100
        },
        true,
        activate
      )
    ).toEqual({ state: 'hidden' });
  });

  it('keeps a user-triggered retryable failure on the same inline control', () => {
    const activate = vi.fn();

    expect(
      appUpdateToolbarView(
        {
          ...status('error'),
          availableVersion: '2.4.0',
          error: {
            code: 'downloadFailed',
            message: 'Соединение прервано',
            retryable: true
          }
        },
        true,
        activate
      )
    ).toEqual({
      state: 'error',
      version: '2.4.0',
      errorMessage: 'Соединение прервано',
      retryable: true,
      onActivate: activate
    });
  });

  it('projects a terminal failure without a retry action and bounds its accessible cause', () => {
    const activate = vi.fn();
    const longCause = `  Подпись\nнедействительна ${'x'.repeat(600)}  `;

    const view = appUpdateToolbarView(
      {
        ...status('error'),
        availableVersion: '2.4.0',
        error: { code: 'signature', message: longCause, retryable: false }
      },
      true,
      activate
    );

    expect(view.state).toBe('error');
    if (view.state !== 'error') throw new Error('expected error view');
    expect(view.retryable).toBe(false);
    expect(view).not.toHaveProperty('onActivate');
    expect(view.errorMessage).not.toContain('\n');
    expect(view.errorMessage.length).toBeLessThanOrEqual(240);
  });

  it('subscribes first and bootstraps the native startup-check state without a duplicate check', async () => {
    const calls: string[] = [];
    const available: FluxoraUpdateStatus = {
      state: 'available',
      currentVersion: '2.3.0',
      availableVersion: '2.4.0'
    };
    const api: FluxoraApi['updates'] = {
      getStatus: vi.fn(async () => {
        calls.push('getStatus');
        return available;
      }),
      rendererReady: vi.fn(async () => undefined),
      check: vi.fn(async (request) => {
        calls.push(`check:${request?.operationId}`);
        return available;
      }),
      openInstaller: vi.fn(async () => available),
      downloadAndInstall: vi.fn(async () => available),
      installerWindowReady: vi.fn(async () => available),
      dismissInstaller: vi.fn(async () => undefined),
      cancel: vi.fn(async () => ({ accepted: true, state: 'downloading' as const, operationId: 'op_cancel' })),
      onStatus: vi.fn(() => {
        calls.push('subscribe');
        return () => calls.push('unsubscribe');
      })
    };
    const received: FluxoraUpdateStatus[] = [];
    const coordinator = createAppUpdateCoordinator({
      api,
      createOperationId: (kind) => `op_${kind}`,
      onStatus: (next) => received.push(next)
    });

    await coordinator.start();

    expect(calls).toEqual(['subscribe', 'getStatus']);
    expect(api.check).not.toHaveBeenCalled();
    expect(received.at(-1)).toEqual(available);
    coordinator.stop();
    expect(calls.at(-1)).toBe('unsubscribe');
  });

  it('runs one explicit manual check with a correlated operation id and user feedback', async () => {
    const upToDate = status('upToDate');
    const available: FluxoraUpdateStatus = {
      ...status('available'),
      availableVersion: '2.4.0'
    };
    const onStatus = vi.fn();
    const api: FluxoraApi['updates'] = {
      getStatus: vi.fn(async () => upToDate),
      rendererReady: vi.fn(async () => undefined),
      check: vi.fn(async () => available),
      openInstaller: vi.fn(async () => available),
      downloadAndInstall: vi.fn(async () => available),
      installerWindowReady: vi.fn(async () => available),
      dismissInstaller: vi.fn(async () => undefined),
      cancel: vi.fn(async () => ({ accepted: true, state: 'checking' as const, operationId: 'op_cancel' })),
      onStatus: vi.fn(() => () => undefined)
    };
    const coordinator = createAppUpdateCoordinator({
      api,
      createOperationId: (kind) => `op_${kind}`,
      onStatus
    });
    await coordinator.start();

    await expect(coordinator.check(true)).resolves.toEqual(available);

    expect(api.check).toHaveBeenCalledOnce();
    expect(api.check).toHaveBeenCalledWith({ operationId: 'op_app_update_manual_check' });
    expect(onStatus).toHaveBeenLastCalledWith(available, true);
    expect(coordinator.getStatus()).toEqual(available);
  });

  it('deduplicates overlapping automatic checks', async () => {
    let finishCheck: ((next: FluxoraUpdateStatus) => void) | undefined;
    const upToDate = status('upToDate');
    const api: FluxoraApi['updates'] = {
      getStatus: vi.fn(async () => upToDate),
      rendererReady: vi.fn(async () => undefined),
      check: vi.fn(() => new Promise<FluxoraUpdateStatus>((resolve) => { finishCheck = resolve; })),
      openInstaller: vi.fn(async () => upToDate),
      downloadAndInstall: vi.fn(async () => upToDate),
      installerWindowReady: vi.fn(async () => upToDate),
      dismissInstaller: vi.fn(async () => undefined),
      cancel: vi.fn(async () => ({ accepted: true, state: 'checking' as const, operationId: 'op_cancel' })),
      onStatus: vi.fn(() => () => undefined)
    };
    const coordinator = createAppUpdateCoordinator({
      api,
      createOperationId: (kind) => `op_${kind}`,
      onStatus: vi.fn()
    });
    await coordinator.start();

    const first = coordinator.check(false);
    const second = coordinator.check(false);
    expect(api.check).toHaveBeenCalledOnce();
    finishCheck?.(upToDate);
    await Promise.all([first, second]);
  });

  it('deduplicates repeated activation and preserves one operation id', async () => {
    let finishOpen: ((status: FluxoraUpdateStatus) => void) | undefined;
    const available: FluxoraUpdateStatus = {
      state: 'available',
      currentVersion: '2.3.0',
      availableVersion: '2.4.0'
    };
    const api: FluxoraApi['updates'] = {
      getStatus: vi.fn(async () => available),
      rendererReady: vi.fn(async () => undefined),
      check: vi.fn(async () => available),
      openInstaller: vi.fn(
        () => new Promise<FluxoraUpdateStatus>((resolve) => {
          finishOpen = resolve;
        })
      ),
      downloadAndInstall: vi.fn(async () => available),
      installerWindowReady: vi.fn(async () => available),
      dismissInstaller: vi.fn(async () => undefined),
      cancel: vi.fn(async () => ({ accepted: true, state: 'downloading' as const, operationId: 'op_cancel' })),
      onStatus: vi.fn(() => () => undefined)
    };
    const coordinator = createAppUpdateCoordinator({
      api,
      createOperationId: (kind) => `op_${kind}`,
      onStatus: vi.fn()
    });
    await coordinator.start();

    const first = coordinator.activate();
    const second = coordinator.activate();

    expect(api.openInstaller).toHaveBeenCalledTimes(1);
    expect(api.openInstaller).toHaveBeenCalledWith({
      operationId: 'op_app_update_download_install'
    });
    expect(api.downloadAndInstall).not.toHaveBeenCalled();
    finishOpen?.(available);
    await Promise.all([first, second]);
  });

  it('deduplicates typed cancellation and refuses it after updater launch is committed', async () => {
    const available: FluxoraUpdateStatus = {
      state: 'available',
      currentVersion: '2.3.0',
      availableVersion: '2.4.0'
    };
    let emitStatus: ((next: FluxoraUpdateStatus) => void) | undefined;
    let finishCancel: (() => void) | undefined;
    const cancel = vi.fn(() => new Promise<{
      accepted: boolean;
      state: FluxoraUpdateStatus['state'];
      operationId: string;
    }>((resolve) => {
      finishCancel = () => resolve({
        accepted: true,
        state: 'downloading',
        operationId: 'op_app_update_cancel'
      });
    }));
    const api: FluxoraApi['updates'] = {
      getStatus: vi.fn(async () => available),
      rendererReady: vi.fn(async () => undefined),
      check: vi.fn(async () => available),
      openInstaller: vi.fn(async () => available),
      downloadAndInstall: vi.fn(async () => available),
      installerWindowReady: vi.fn(async () => available),
      dismissInstaller: vi.fn(async () => undefined),
      cancel,
      onStatus: vi.fn((listener) => {
        emitStatus = listener;
        return () => undefined;
      })
    };
    const coordinator = createAppUpdateCoordinator({
      api,
      createOperationId: (kind) => `op_${kind}`,
      onStatus: vi.fn()
    });
    await coordinator.start();
    emitStatus?.({ ...available, state: 'downloading' });

    const first = coordinator.cancel();
    const second = coordinator.cancel();
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith({ operationId: 'op_app_update_cancel' });
    finishCancel?.();
    await Promise.all([first, second]);

    emitStatus?.({ ...available, state: 'launchingUpdater' });
    await coordinator.cancel();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('keeps handoff-only states out of the titlebar', () => {
    const activate = vi.fn();

    expect(appUpdateToolbarView(
      { ...status('readyToInstall'), availableVersion: '2.4.0' },
      true,
      activate
    )).toEqual({ state: 'hidden' });
    expect(appUpdateToolbarView(
      { ...status('launchingUpdater'), availableVersion: '2.4.0' },
      true,
      activate
    )).toEqual({ state: 'hidden' });
  });

  it('turns a failed user download into one explicit retry path', async () => {
    const available: FluxoraUpdateStatus = {
      state: 'available',
      currentVersion: '2.3.0',
      availableVersion: '2.4.0'
    };
    const onStatus = vi.fn();
    const api: FluxoraApi['updates'] = {
      getStatus: vi.fn(async () => available),
      rendererReady: vi.fn(async () => undefined),
      check: vi.fn(async () => available),
      openInstaller: vi.fn()
        .mockRejectedValueOnce(new Error('Соединение прервано'))
        .mockResolvedValueOnce({ ...available, state: 'launchingUpdater' }),
      downloadAndInstall: vi.fn(async () => available),
      installerWindowReady: vi.fn(async () => available),
      dismissInstaller: vi.fn(async () => undefined),
      cancel: vi.fn(async () => ({ accepted: true, state: 'downloading' as const, operationId: 'op_cancel' })),
      onStatus: vi.fn(() => () => undefined)
    };
    const coordinator = createAppUpdateCoordinator({
      api,
      createOperationId: (kind) => `op_${kind}`,
      onStatus
    });
    await coordinator.start();

    await coordinator.activate();
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: 'error',
        error: expect.objectContaining({ message: 'Соединение прервано', retryable: true })
      }),
      true
    );

    await coordinator.activate();
    expect(api.openInstaller).toHaveBeenCalledTimes(2);
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'launchingUpdater' }),
      true
    );
  });
});
