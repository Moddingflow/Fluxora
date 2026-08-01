import { describe, expect, it } from 'vitest';

import type {
  InstallPathValidation,
  InstallProgress,
  InstallResult,
  SetupPostInstallUpdateProgress,
  SetupBootstrapState
} from '../src/installer/contracts';
import {
  canContinueLegal,
  canStartInstall,
  initialSetupFlowState,
  setupFlowReducer
} from '../src/installer/setup/setup-flow';

const bootstrap: SetupBootstrapState = {
  schemaVersion: 1,
  language: 'de',
  defaultInstallDirectory: 'C:\\Users\\Owner\\AppData\\Local\\Programs\\Fluxora',
  mode: 'repair',
  installedVersion: '2.4.0',
  requiredBytes: 800,
  freeBytes: 8_000,
  isOwnedInstall: true,
  payloadBytes: 700,
  webview2Version: '140.0.0.0',
  nativeAvailable: true
};

const validation: InstallPathValidation = {
  schemaVersion: 1,
  status: 'valid',
  code: 'setup.path.valid',
  messageKey: 'setup.location.valid',
  normalizedInstallDirectory: bootstrap.defaultInstallDirectory,
  requiredBytes: bootstrap.requiredBytes,
  freeBytes: bootstrap.freeBytes,
  mode: 'repair'
};

const progress = (
  phase: string,
  percent: number,
  canCancel: boolean
): InstallProgress => ({
  operationId: 'setup-operation',
  phase,
  copiedBytes: percent,
  totalBytes: 100,
  percent,
  statusKey: `setup.progress.${phase}`,
  canCancel
});

const installResult: InstallResult = {
  schemaVersion: 1,
  operationId: 'setup-operation',
  outcome: 'succeeded',
  installDirectory: bootstrap.defaultInstallDirectory,
  applicationPath: `${bootstrap.defaultInstallDirectory}\\Fluxora.exe`,
  installedVersion: '2.4.0',
  createdDesktopShortcut: true
};

const updateProgress = (
  state: SetupPostInstallUpdateProgress['state'],
  percent?: number
): SetupPostInstallUpdateProgress => ({
  schemaVersion: 1,
  operationId: installResult.operationId,
  state,
  phase: state,
  currentVersion: installResult.installedVersion,
  targetVersion: state === 'checking' || state === 'up-to-date' ? undefined : '2.5.0',
  downloadedBytes: percent ?? 0,
  totalBytes: percent === undefined ? 0 : 100,
  percent,
  canCancel: state === 'checking' || state === 'downloading'
});

describe('Setup flow', () => {
  it('starts with language as a dedicated first step and preserves it after bootstrap', () => {
    expect(initialSetupFlowState.step).toBe('language');

    const bootstrapped = setupFlowReducer(initialSetupFlowState, {
      type: 'bootstrap-ready',
      state: bootstrap
    });

    expect(bootstrapped.step).toBe('language');
    expect(bootstrapped.language).toBe('de');
  });

  it('keeps completed setup steps navigable after returning to an earlier step', () => {
    const bootstrapped = setupFlowReducer(initialSetupFlowState, {
      type: 'bootstrap-ready',
      state: bootstrap
    });
    const legal = setupFlowReducer(bootstrapped, { type: 'step', step: 'legal' });
    const location = setupFlowReducer(legal, { type: 'step', step: 'location' });
    const returned = setupFlowReducer(location, { type: 'step', step: 'language' });

    expect(returned.furthestStep).toBe('location');
  });

  it('defaults to per-user friendly options and requires two distinct legal actions', () => {
    expect(initialSetupFlowState.createDesktopShortcut).toBe(true);
    expect(canContinueLegal(initialSetupFlowState)).toBe(false);

    const termsOnly = setupFlowReducer(initialSetupFlowState, {
      type: 'terms',
      accepted: true
    });
    expect(canContinueLegal(termsOnly)).toBe(false);
    expect(canContinueLegal(setupFlowReducer(termsOnly, {
      type: 'privacy',
      acknowledged: true
    }))).toBe(true);
  });

  it('preserves native owned-install repair mode and gates install on validation', () => {
    const bootstrapped = setupFlowReducer(initialSetupFlowState, {
      type: 'bootstrap-ready',
      state: bootstrap
    });
    expect(bootstrapped.language).toBe('de');
    expect(bootstrapped.installDirectory).toBe(bootstrap.defaultInstallDirectory);
    expect(bootstrapped.bootstrap?.mode).toBe('repair');
    expect(canStartInstall(bootstrapped)).toBe(false);

    const ready = setupFlowReducer(bootstrapped, {
      type: 'validation-ready',
      validation
    });
    expect(canStartInstall(ready)).toBe(true);
  });

  it('ignores foreign operation progress and locks cancellation at commit', () => {
    const started = setupFlowReducer(initialSetupFlowState, {
      type: 'install-started',
      operationId: 'setup-operation'
    });
    const foreign = setupFlowReducer(started, {
      type: 'progress',
      progress: { ...progress('copying', 20, true), operationId: 'another-operation' }
    });
    expect(foreign).toBe(started);

    const copied = setupFlowReducer(started, {
      type: 'progress',
      progress: progress('copying', 80, true)
    });
    const committed = setupFlowReducer(copied, {
      type: 'progress',
      progress: progress('committing', 75, false)
    });
    expect(committed.progress?.percent).toBe(80);
    expect(committed.progress?.canCancel).toBe(false);
    expect(committed.noticeKey).toBe('setup.installation.commitLocked');
  });

  it('moves native failures to an actionable result and retries from location', () => {
    const failed = setupFlowReducer(
      { ...initialSetupFlowState, bootstrap, bootstrapBusy: false },
      {
        type: 'install-failed',
        failure: {
          code: 'setup.diskWriteFailed',
          messageKey: 'setup.error.generic',
          retryable: true
        }
      }
    );
    expect(failed.step).toBe('result');
    expect(failed.failure?.code).toBe('setup.diskWriteFailed');

    const retried = setupFlowReducer(failed, { type: 'retry' });
    expect(retried.step).toBe('location');
    expect(retried.failure).toBeNull();
  });

  it('returns an accepted pre-commit cancellation to the location step', () => {
    const cancelled = setupFlowReducer(
      {
        ...initialSetupFlowState,
        step: 'installation',
        operationId: 'setup-operation',
        cancelling: true
      },
      { type: 'install-cancelled' }
    );
    expect(cancelled.step).toBe('location');
    expect(cancelled.operationId).toBeNull();
    expect(cancelled.noticeKey).toBe('setup.installation.cancelled');
    expect(cancelled.cancelling).toBe(false);
  });

  it.each([
    ['up-to-date', 'bundled-launched'],
    ['handoff-committed', 'updater-launched'],
    ['cancelled', 'cancelled']
  ] as const)('keeps %s as a post-install update outcome without requiring a second step', (
    progressState,
    outcome
  ) => {
    const installed = setupFlowReducer(
      { ...initialSetupFlowState, operationId: installResult.operationId },
      { type: 'install-finished', result: installResult }
    );
    expect(installed.step).toBe('update');
    const progressed = setupFlowReducer(installed, {
      type: 'post-update-progress',
      progress: updateProgress(progressState)
    });
    const finished = setupFlowReducer(progressed, {
      type: 'post-update-finished',
      result: {
        schemaVersion: 1,
        operationId: installResult.operationId,
        outcome
      }
    });
    expect(finished.step).toBe('update');
    expect(finished.postInstallResult?.outcome).toBe(outcome);
  });

  it('ignores foreign post-install progress and keeps download progress monotonic', () => {
    const installed = setupFlowReducer(
      { ...initialSetupFlowState, operationId: installResult.operationId },
      { type: 'install-finished', result: installResult }
    );
    const foreign = setupFlowReducer(installed, {
      type: 'post-update-progress',
      progress: { ...updateProgress('downloading', 20), operationId: 'foreign-operation' }
    });
    expect(foreign).toBe(installed);

    const advanced = setupFlowReducer(installed, {
      type: 'post-update-progress',
      progress: updateProgress('downloading', 80)
    });
    const delayed = setupFlowReducer(advanced, {
      type: 'post-update-progress',
      progress: updateProgress('downloading', 55)
    });
    expect(delayed.postInstallProgress?.percent).toBe(80);
    expect(delayed.postInstallProgress?.downloadedBytes).toBe(80);
  });

  it('shows the fallback launch path only for a confirmed automatic launch failure', () => {
    const installed = setupFlowReducer(
      { ...initialSetupFlowState, operationId: installResult.operationId },
      { type: 'install-finished', result: installResult }
    );
    const updateError = setupFlowReducer(installed, {
      type: 'post-update-finished',
      result: {
        schemaVersion: 1,
        operationId: installResult.operationId,
        outcome: 'bundled-launched',
        error: {
          code: 'setup.update.offline',
          messageKey: 'setup.update.error',
          retryable: true
        }
      }
    });
    expect(updateError.step).toBe('update');

    const launchFailed = setupFlowReducer(installed, {
      type: 'post-update-finished',
      result: {
        schemaVersion: 1,
        operationId: installResult.operationId,
        outcome: 'launch-failed',
        error: {
          code: 'setup.launchFailed',
          messageKey: 'setup.error.launchFailed',
          retryable: true
        }
      }
    });
    expect(launchFailed.step).toBe('result');
    expect(launchFailed.postInstallResult?.outcome).toBe('launch-failed');
  });
});
