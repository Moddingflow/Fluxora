import { describe, expect, it, vi } from 'vitest';

import {
  createSetupFacade,
  createUpdaterFacade,
  nativeFailureFromUnknown,
  type InstallerIpc
} from '../src/installer/tauri-installer-api';

class FakeIpc implements InstallerIpc {
  readonly calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  readonly responses = new Map<string, unknown>();
  readonly listeners = new Map<string, (event: { payload: unknown }) => void>();

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    this.calls.push({ command, args });
    const response = this.responses.get(command);
    if (response instanceof Error) {
      throw response;
    }
    return response as T;
  }

  async listen<T>(
    event: string,
    listener: (event: { payload: T }) => void
  ): Promise<() => void> {
    this.listeners.set(event, listener as (event: { payload: unknown }) => void);
    return () => this.listeners.delete(event);
  }

  emit(event: string, payload: unknown) {
    this.listeners.get(event)?.({ payload });
  }
}

describe('installer typed facade', () => {
  it('exposes only the allowlisted Setup surface and validates trusted paths', async () => {
    const ipc = new FakeIpc();
    ipc.responses.set('fluxora_setup_get_bootstrap_state', {
      schemaVersion: 1,
      language: 'ru',
      defaultInstallDirectory: 'C:\\Users\\Owner\\AppData\\Local\\Programs\\Fluxora',
      mode: 'repair',
      installedVersion: '2.4.0',
      requiredBytes: 100,
      freeBytes: 1_000,
      isOwnedInstall: true,
      payloadBytes: 90,
      webview2Version: '140.0.0.0',
      nativeAvailable: true
    });
    const facade = createSetupFacade(ipc);

    expect(Object.keys(facade).sort()).toEqual([
      'cancelInstall',
      'cancelPostInstallUpdate',
      'getBootstrapState',
      'launchApp',
      'minimizeWindow',
      'onCloseBlocked',
      'onPostInstallUpdateProgress',
      'onProgress',
      'openInstalledFolder',
      'pickInstallFolder',
      'requestClose',
      'revealLogs',
      'startInstall',
      'startPostInstallUpdate',
      'validateInstallPath'
    ]);
    await expect(facade.getBootstrapState()).resolves.toMatchObject({
      language: 'ru',
      mode: 'repair',
      isOwnedInstall: true
    });

    ipc.responses.set('fluxora_setup_get_bootstrap_state', {
      schemaVersion: 1,
      language: 'en',
      defaultInstallDirectory: 'https://attacker.invalid/Fluxora',
      mode: 'install',
      requiredBytes: 1,
      freeBytes: 2,
      isOwnedInstall: false,
      payloadBytes: 1,
      nativeAvailable: true
    });
    await expect(facade.getBootstrapState()).rejects.toMatchObject({
      code: 'setup.invalidBootstrapPath'
    });
  });

  it('normalizes Setup progress and closes cancellation at commit', async () => {
    const ipc = new FakeIpc();
    const listener = vi.fn();
    await createSetupFacade(ipc).onProgress(listener);

    ipc.emit('fluxora:setup-progress', {
      operationId: 'setup-operation',
      phase: 'committing',
      copiedBytes: 50,
      totalBytes: 100,
      percent: 50,
      statusKey: 'attacker.status',
      currentItem: 'C:\\private\\source.flxpkg',
      canCancel: true
    });
    expect(listener).toHaveBeenCalledWith({
      operationId: 'setup-operation',
      phase: 'committing',
      copiedBytes: 50,
      totalBytes: 100,
      percent: 50,
      statusKey: 'setup.progress.committing',
      currentItem: undefined,
      canCancel: false
    });
  });

  it('pins post-install update commands to the root operation and strips unsafe progress', async () => {
    const ipc = new FakeIpc();
    ipc.responses.set('fluxora_setup_start_post_install_update', {
      schemaVersion: 1,
      operationId: 'setup-operation',
      outcome: 'updater-launched'
    });
    const facade = createSetupFacade(ipc);
    await expect(facade.startPostInstallUpdate('setup-operation')).resolves.toMatchObject({
      outcome: 'updater-launched'
    });
    expect(ipc.calls.at(-1)).toEqual({
      command: 'fluxora_setup_start_post_install_update',
      args: { request: { operationId: 'setup-operation' } }
    });

    const listener = vi.fn();
    await facade.onPostInstallUpdateProgress(listener);
    ipc.emit('fluxora:setup-post-install-update-progress', {
      schemaVersion: 1,
      operationId: 'setup-operation',
      state: 'downloading',
      phase: 'attacker-controlled',
      currentVersion: '2.4.0',
      targetVersion: '2.5.0',
      downloadedBytes: 150,
      totalBytes: 100,
      percent: 150,
      canCancel: true,
      releaseUrl: 'https://attacker.invalid',
      cachePath: 'C:\\private\\update.package'
    });
    expect(listener).toHaveBeenCalledWith({
      schemaVersion: 1,
      operationId: 'setup-operation',
      state: 'downloading',
      phase: 'downloading',
      currentVersion: '2.4.0',
      targetVersion: '2.5.0',
      downloadedBytes: 100,
      totalBytes: 100,
      percent: 100,
      canCancel: true
    });
  });

  it('treats an empty native installed version as absent for a clean install', async () => {
    const ipc = new FakeIpc();
    ipc.responses.set('fluxora_setup_get_bootstrap_state', {
      schemaVersion: 1,
      language: 'en',
      defaultInstallDirectory: 'C:\\Users\\Owner\\AppData\\Local\\Programs\\Fluxora',
      mode: 'install',
      installedVersion: '',
      requiredBytes: 100,
      freeBytes: 1_000,
      isOwnedInstall: false,
      payloadBytes: 90,
      nativeAvailable: true
    });

    await expect(createSetupFacade(ipc).getBootstrapState()).resolves.toMatchObject({
      mode: 'install',
      installedVersion: undefined
    });
  });

  it('normalizes updater phases/status keys and drops malformed events', async () => {
    const ipc = new FakeIpc();
    const listener = vi.fn();
    await createUpdaterFacade(ipc).onProgress(listener);

    ipc.emit('fluxora:updater-progress', {
      schemaVersion: 1,
      operationId: 'update-operation',
      phase: 'launch-arbitrary-command',
      copiedBytes: 50,
      totalBytes: 100,
      percent: 140,
      statusKey: 'attacker.status',
      currentItem: '..\\private\\token.txt',
      canCancel: true
    });
    expect(listener).toHaveBeenCalledWith({
      schemaVersion: 1,
      operationId: 'update-operation',
      phase: 'working',
      copiedBytes: 50,
      totalBytes: 100,
      percent: 100,
      statusKey: 'updater.status.working',
      currentItem: undefined,
      canCancel: false
    });

    ipc.emit('fluxora:updater-progress', {
      schemaVersion: 99,
      operationId: 'update-operation',
      phase: 'installing',
      statusKey: 'updater.status.installing'
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('pins updater results to the validated request identity and version', async () => {
    const ipc = new FakeIpc();
    ipc.responses.set('fluxora_updater_get_request_summary', {
      schemaVersion: 1,
      operationId: 'update-operation',
      currentVersion: '2.4.0',
      targetVersion: '2.5.0',
      assetKind: 'delta'
    });
    ipc.responses.set('fluxora_updater_start_update', {
      schemaVersion: 1,
      operationId: 'other-operation',
      outcome: 'succeeded',
      targetVersion: '9.9.9'
    });
    ipc.responses.set('fluxora_updater_renderer_ready', { completed: true });
    const facade = createUpdaterFacade(ipc);
    await facade.getRequestSummary();
    await expect(facade.rendererReady()).resolves.toEqual({
      completed: true,
      reasonKey: undefined
    });
    expect(ipc.calls.at(-1)).toEqual({
      command: 'fluxora_updater_renderer_ready',
      args: undefined
    });
    await expect(facade.startUpdate()).rejects.toMatchObject({
      code: 'updater.resultMismatch'
    });
  });

  it('never forwards native technical detail to renderer failures', () => {
    expect(nativeFailureFromUnknown({
      code: 'setup.failed',
      messageKey: 'setup.error.generic',
      retryable: false,
      technicalDetail: 'C:\\private\\stacktrace.txt'
    })).toEqual({
      code: 'setup.failed',
      messageKey: 'setup.error.generic',
      retryable: false,
      actionKey: undefined
    });
  });
});
