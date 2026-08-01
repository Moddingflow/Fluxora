import { invoke } from '@tauri-apps/api/core';
import { listen, type Event } from '@tauri-apps/api/event';

import type {
  CancelResult,
  InstallOptions,
  InstallPathValidation,
  InstallProgress,
  InstallResult,
  InstallerEventListener,
  InstallerLanguage,
  NativeFailure,
  SetupBootstrapState,
  SetupFacade,
  SetupMode,
  SetupPostInstallUpdateProgress,
  SetupPostInstallUpdateResult,
  UpdateProgress,
  UpdateRequestSummary,
  UpdateResult,
  UpdaterFacade,
  WindowActionResult
} from './contracts';

const setupProgressEvent = 'fluxora:setup-progress';
const setupCloseBlockedEvent = 'fluxora:setup-close-blocked';
const setupPostInstallUpdateProgressEvent = 'fluxora:setup-post-install-update-progress';
const updaterProgressEvent = 'fluxora:updater-progress';
const updaterCloseBlockedEvent = 'fluxora:updater-close-blocked';

export interface InstallerIpc {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, listener: (event: { payload: T }) => void): Promise<() => void>;
}

const tauriIpc: InstallerIpc = {
  invoke: (command, args) => invoke(command, args),
  listen: (event, listener) =>
    listen(event, (value: Event<unknown>) =>
      listener({ payload: value.payload as never }))
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const boolean = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;

const optionalText = (value: unknown): string | undefined => {
  const resolved = text(value).trim();
  return resolved ? resolved : undefined;
};

const semver = (value: unknown, code: string): string => {
  const resolved = text(value).trim();
  if (
    resolved.length > 128
    || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(resolved)
  ) {
    throw nativeFailure(code, 'installer.error.invalidNativeResponse');
  }
  return resolved;
};

const optionalSemver = (value: unknown, code: string): string | undefined => {
  const resolved = optionalText(value);
  return resolved === undefined ? undefined : semver(resolved, code);
};

const absoluteWindowsPath = (value: unknown, code: string): string => {
  const resolved = text(value).trim();
  const normalized = resolved.replace(/\//gu, '\\');
  if (
    !resolved
    || resolved.length > 32_767
    || /[\u0000-\u001f\u007f]/u.test(resolved)
    || !/^(?:[A-Za-z]:\\|\\\\\?\\[A-Za-z]:\\)/u.test(normalized)
    || normalized.split('\\').some((component) => component === '..')
  ) {
    throw nativeFailure(code, 'installer.error.invalidNativeResponse');
  }
  return resolved;
};

const optionalRelativeItem = (value: unknown): string | undefined => {
  const resolved = optionalText(value);
  if (
    !resolved
    || resolved.length > 1_024
    || /[\u0000-\u001f\u007f]/u.test(resolved)
    || /^[\\/]/u.test(resolved)
    || resolved.includes(':')
    || resolved.split(/[\\/]/u).some((component) => component === '..')
  ) {
    return undefined;
  }
  return resolved;
};

const language = (value: unknown): InstallerLanguage =>
  value === 'de' || value === 'ru' ? value : 'en';

const setupMode = (value: unknown): SetupMode =>
  value === 'repair' || value === 'update' ? value : 'install';

const operationId = (value: unknown): string => {
  const resolved = text(value).trim();
  if (!resolved || resolved.length > 128 || /[\u0000-\u001f\u007f]/u.test(resolved)) {
    throw nativeFailure('installer.invalidOperationId', 'installer.error.invalidOperationId');
  }
  return resolved;
};

const schemaVersion = (value: unknown): 1 => {
  if (value !== 1) {
    throw nativeFailure('installer.unsupportedSchema', 'installer.error.unsupportedSchema');
  }
  return 1;
};

export const nativeFailure = (
  code: string,
  messageKey: string,
  retryable = false,
  actionKey?: string
): NativeFailure => ({ code, messageKey, retryable, actionKey });

export const nativeFailureFromUnknown = (value: unknown): NativeFailure => {
  if (isRecord(value)) {
    const code = text(value.code).slice(0, 128);
    const messageKey = text(value.messageKey ?? value.message_key).slice(0, 160);
    if (code && messageKey) {
      return nativeFailure(
        code,
        messageKey,
        boolean(value.retryable),
        optionalText(value.actionKey ?? value.action_key)
      );
    }
  }
  return nativeFailure('installer.nativeCallFailed', 'installer.error.nativeCallFailed', true);
};

const invokeSafe = async <T>(
  ipc: InstallerIpc,
  command: string,
  args?: Record<string, unknown>
): Promise<T> => {
  try {
    return await ipc.invoke<T>(command, args);
  } catch (error) {
    throw nativeFailureFromUnknown(error);
  }
};

const sanitizeBootstrap = (value: unknown): SetupBootstrapState => {
  if (!isRecord(value)) {
    throw nativeFailure('setup.invalidBootstrap', 'setup.error.invalidNativeResponse');
  }
  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    language: language(value.language),
    defaultInstallDirectory: absoluteWindowsPath(
      value.defaultInstallDirectory,
      'setup.invalidBootstrapPath'
    ),
    mode: setupMode(value.mode),
    installedVersion: optionalSemver(
      value.installedVersion,
      'setup.invalidInstalledVersion'
    ),
    requiredBytes: Math.max(0, finiteNumber(value.requiredBytes)),
    freeBytes: Math.max(0, finiteNumber(value.freeBytes)),
    isOwnedInstall: boolean(value.isOwnedInstall),
    payloadBytes: Math.max(0, finiteNumber(value.payloadBytes)),
    webview2Version: optionalText(value.webview2Version),
    nativeAvailable: boolean(value.nativeAvailable)
  };
};

const sanitizeValidation = (value: unknown): InstallPathValidation => {
  if (!isRecord(value)) {
    throw nativeFailure('setup.invalidValidation', 'setup.error.invalidNativeResponse');
  }
  const status = value.status;
  if (
    status !== 'valid'
    && status !== 'insufficient-space'
    && status !== 'foreign-install'
    && status !== 'invalid-path'
  ) {
    throw nativeFailure('setup.invalidPathStatus', 'setup.error.invalidNativeResponse');
  }
  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    status,
    code: text(value.code).slice(0, 128),
    messageKey: text(value.messageKey).slice(0, 160),
    normalizedInstallDirectory: optionalText(value.normalizedInstallDirectory)
      ? absoluteWindowsPath(
          value.normalizedInstallDirectory,
          'setup.invalidValidationPath'
        )
      : '',
    requiredBytes: Math.max(0, finiteNumber(value.requiredBytes)),
    freeBytes: Math.max(0, finiteNumber(value.freeBytes)),
    mode: setupMode(value.mode)
  };
};

const sanitizeInstallProgress = (value: unknown): InstallProgress => {
  if (!isRecord(value)) {
    throw nativeFailure('setup.invalidProgress', 'setup.error.invalidNativeResponse');
  }
  const statusByPhase = {
    preparing: 'setup.progress.preparing',
    validating: 'setup.progress.validating',
    copying: 'setup.progress.copying',
    staging: 'setup.progress.staging',
    finalizing: 'setup.progress.finalizing',
    committing: 'setup.progress.committing',
    'rolling-back': 'setup.progress.rolling-back',
    completed: 'setup.progress.completed',
    working: 'setup.progress.working'
  } as const;
  const untrustedPhase = text(value.phase, 'working');
  const phase = Object.prototype.hasOwnProperty.call(statusByPhase, untrustedPhase)
    ? untrustedPhase as keyof typeof statusByPhase
    : 'working';
  const commitStarted = phase === 'finalizing'
    || phase === 'committing'
    || phase === 'rolling-back'
    || phase === 'completed';
  return {
    operationId: operationId(value.operationId),
    phase,
    copiedBytes: Math.max(0, finiteNumber(value.copiedBytes)),
    totalBytes: Math.max(0, finiteNumber(value.totalBytes)),
    percent: Math.min(100, Math.max(0, finiteNumber(value.percent))),
    statusKey: statusByPhase[phase],
    currentItem: optionalRelativeItem(value.currentItem),
    canCancel: !commitStarted && boolean(value.canCancel)
  };
};

const sanitizeInstallResult = (value: unknown): InstallResult => {
  if (!isRecord(value)) {
    throw nativeFailure('setup.invalidResult', 'setup.error.invalidNativeResponse');
  }
  const outcome = value.outcome;
  if (outcome !== 'succeeded' && outcome !== 'cancelled') {
    throw nativeFailure('setup.invalidOutcome', 'setup.error.invalidNativeResponse');
  }
  const installDirectory = absoluteWindowsPath(
    value.installDirectory,
    'setup.invalidInstallResultPath'
  );
  const applicationPath = absoluteWindowsPath(
    value.applicationPath,
    'setup.invalidApplicationPath'
  );
  const normalizedDirectory = installDirectory.replace(/\//gu, '\\').replace(/\\+$/u, '');
  const normalizedApplication = applicationPath.replace(/\//gu, '\\');
  if (
    !normalizedApplication.toLowerCase().startsWith(`${normalizedDirectory.toLowerCase()}\\`)
    || normalizedApplication.split('\\').at(-1)?.toLowerCase() !== 'fluxora.exe'
  ) {
    throw nativeFailure('setup.invalidApplicationPath', 'installer.error.invalidNativeResponse');
  }
  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    operationId: operationId(value.operationId),
    outcome,
    installDirectory,
    applicationPath,
    installedVersion: semver(value.installedVersion, 'setup.invalidInstalledVersion'),
    createdDesktopShortcut: boolean(value.createdDesktopShortcut)
  };
};

const sanitizePostInstallUpdateProgress = (
  value: unknown
): SetupPostInstallUpdateProgress => {
  if (!isRecord(value)) {
    throw nativeFailure('setup.update.invalidProgress', 'setup.update.error.invalidNativeResponse');
  }
  const phaseByState = {
    checking: 'checking',
    'up-to-date': 'up-to-date',
    'update-available': 'update-available',
    downloading: 'downloading',
    verifying: 'verifying',
    'preparing-handoff': 'preparing-handoff',
    'handoff-committed': 'handoff-committed',
    'launching-bundled': 'launching-bundled',
    cancelled: 'cancelled',
    error: 'error',
    'launch-error': 'launch-error'
  } as const;
  const untrustedState = text(value.state);
  if (!Object.prototype.hasOwnProperty.call(phaseByState, untrustedState)) {
    throw nativeFailure('setup.update.invalidState', 'setup.update.error.invalidNativeResponse');
  }
  const state = untrustedState as keyof typeof phaseByState;
  const totalBytes = Math.max(0, finiteNumber(value.totalBytes));
  const downloadedBytes = Math.min(
    totalBytes || Number.MAX_SAFE_INTEGER,
    Math.max(0, finiteNumber(value.downloadedBytes))
  );
  const cancellableState = state === 'checking'
    || state === 'update-available'
    || state === 'downloading'
    || state === 'verifying'
    || state === 'preparing-handoff';
  const rawPercent = value.percent;
  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    operationId: operationId(value.operationId),
    state,
    phase: phaseByState[state],
    currentVersion: semver(value.currentVersion, 'setup.update.invalidCurrentVersion'),
    targetVersion: optionalSemver(value.targetVersion, 'setup.update.invalidTargetVersion'),
    downloadedBytes,
    totalBytes,
    percent: typeof rawPercent === 'number' && Number.isFinite(rawPercent)
      ? Math.min(100, Math.max(0, rawPercent))
      : undefined,
    canCancel: cancellableState && boolean(value.canCancel)
  };
};

const sanitizePostInstallUpdateResult = (value: unknown): SetupPostInstallUpdateResult => {
  if (!isRecord(value)) {
    throw nativeFailure('setup.update.invalidResult', 'setup.update.error.invalidNativeResponse');
  }
  const outcome = value.outcome;
  if (
    outcome !== 'bundled-launched'
    && outcome !== 'updater-launched'
    && outcome !== 'cancelled'
    && outcome !== 'launch-failed'
  ) {
    throw nativeFailure('setup.update.invalidOutcome', 'setup.update.error.invalidNativeResponse');
  }
  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    operationId: operationId(value.operationId),
    outcome,
    error: value.error === undefined ? undefined : nativeFailureFromUnknown(value.error)
  };
};

const sanitizeWindowAction = (value: unknown): WindowActionResult => {
  if (!isRecord(value)) {
    return { completed: false, reasonKey: 'installer.windowActionFailed' };
  }
  return {
    completed: boolean(value.completed),
    reasonKey: optionalText(value.reasonKey)
  };
};

const sanitizeUpdateSummary = (value: unknown): UpdateRequestSummary => {
  if (!isRecord(value)) {
    throw nativeFailure('updater.invalidSummary', 'updater.error.invalidNativeResponse');
  }
  const assetKind = value.assetKind;
  if (assetKind !== 'full' && assetKind !== 'delta') {
    throw nativeFailure('updater.invalidAssetKind', 'updater.error.invalidNativeResponse');
  }
  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    operationId: operationId(value.operationId),
    currentVersion: semver(value.currentVersion, 'updater.invalidCurrentVersion'),
    targetVersion: semver(value.targetVersion, 'updater.invalidTargetVersion'),
    assetKind,
    presentation: value.presentation === 'setup-handoff' ? 'setup-handoff' : 'compact',
    language: language(value.language)
  };
};

const sanitizeUpdateProgress = (value: unknown): UpdateProgress => {
  if (!isRecord(value)) {
    throw nativeFailure('updater.invalidProgress', 'updater.error.invalidNativeResponse');
  }
  const statusByPhase = {
    recovering: 'updater.status.recovering',
    'waiting-for-parent': 'updater.status.waitingForParent',
    verifying: 'updater.status.verifying',
    installing: 'updater.status.installing',
    launching: 'updater.status.launching',
    'health-check': 'updater.status.healthCheck',
    finalizing: 'updater.status.finalizing',
    'rolling-back': 'updater.status.rollingBack',
    'rolled-back': 'updater.status.rolledBack',
    completed: 'updater.status.completed',
    working: 'updater.status.working'
  } as const;
  const untrustedPhase = text(value.phase, 'working');
  const phase = Object.prototype.hasOwnProperty.call(statusByPhase, untrustedPhase)
    ? untrustedPhase as keyof typeof statusByPhase
    : 'working';
  const expectedStatusKey = statusByPhase[phase];
  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    operationId: operationId(value.operationId),
    phase,
    copiedBytes: Math.max(0, finiteNumber(value.copiedBytes)),
    totalBytes: Math.max(0, finiteNumber(value.totalBytes)),
    percent: Math.min(100, Math.max(0, finiteNumber(value.percent))),
    statusKey: expectedStatusKey,
    currentItem: optionalRelativeItem(value.currentItem),
    canCancel: false
  };
};

const sanitizeUpdateResult = (value: unknown): UpdateResult => {
  if (!isRecord(value)) {
    throw nativeFailure('updater.invalidResult', 'updater.error.invalidNativeResponse');
  }
  const outcome = value.outcome;
  if (outcome !== 'succeeded' && outcome !== 'rolled-back' && outcome !== 'failed') {
    throw nativeFailure('updater.invalidOutcome', 'updater.error.invalidNativeResponse');
  }
  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    operationId: operationId(value.operationId),
    outcome,
    targetVersion: semver(value.targetVersion, 'updater.invalidTargetVersion'),
    error: value.error === undefined ? undefined : nativeFailureFromUnknown(value.error)
  };
};

const closeNotice = (value: unknown): { reasonKey: string } => ({
  reasonKey: isRecord(value)
    ? text(value.reasonKey, 'installer.closeBlocked')
    : 'installer.closeBlocked'
});

const listenSanitized = async <T>(
  ipc: InstallerIpc,
  event: string,
  listener: InstallerEventListener<T>,
  sanitizer: (value: unknown) => T
): Promise<() => void> =>
  ipc.listen<unknown>(event, ({ payload }) => {
    try {
      listener(sanitizer(payload));
    } catch {
      // Invalid native events are dropped at the facade boundary.
    }
  });

export const createSetupFacade = (ipc: InstallerIpc = tauriIpc): SetupFacade =>
  Object.freeze({
    getBootstrapState: async () =>
      sanitizeBootstrap(await invokeSafe(ipc, 'fluxora_setup_get_bootstrap_state')),
    pickInstallFolder: async (initialDirectory?: string, pickerLanguage: InstallerLanguage = 'en') => {
      const value = await invokeSafe<unknown>(ipc, 'fluxora_setup_pick_install_folder', {
        request: { initialDirectory, language: pickerLanguage }
      });
      return isRecord(value) ? optionalText(value.path) ?? null : null;
    },
    validateInstallPath: async (installDirectory: string, requestOperationId: string) =>
      sanitizeValidation(
        await invokeSafe(ipc, 'fluxora_setup_validate_install_path', {
          request: {
            operationId: operationId(requestOperationId),
            installDirectory
          }
        })
      ),
    startInstall: async (options: InstallOptions) => {
      const requestOperationId = operationId(options.operationId);
      const result = sanitizeInstallResult(
        await invokeSafe(ipc, 'fluxora_setup_start_install', {
          options: {
            ...options,
            operationId: requestOperationId
          }
        })
      );
      if (result.operationId !== requestOperationId) {
        throw nativeFailure(
          'setup.installOperationMismatch',
          'setup.error.invalidNativeResponse'
        );
      }
      return result;
    },
    cancelInstall: async (requestOperationId: string) => {
      const value = await invokeSafe<unknown>(ipc, 'fluxora_setup_cancel_install', {
        request: { operationId: operationId(requestOperationId) }
      });
      return isRecord(value)
        ? {
            accepted: boolean(value.accepted),
            reasonKey: optionalText(value.reasonKey)
          } satisfies CancelResult
        : { accepted: false, reasonKey: 'setup.cancel.failed' };
    },
    startPostInstallUpdate: async (requestOperationId: string) => {
      const trustedOperationId = operationId(requestOperationId);
      const result = sanitizePostInstallUpdateResult(
        await invokeSafe(ipc, 'fluxora_setup_start_post_install_update', {
          request: { operationId: trustedOperationId }
        })
      );
      if (result.operationId !== trustedOperationId) {
        throw nativeFailure(
          'setup.updateOperationMismatch',
          'setup.update.error.invalidNativeResponse'
        );
      }
      return result;
    },
    cancelPostInstallUpdate: async (requestOperationId: string) => {
      const value = await invokeSafe<unknown>(ipc, 'fluxora_setup_cancel_post_install_update', {
        request: { operationId: operationId(requestOperationId) }
      });
      return isRecord(value)
        ? {
            accepted: boolean(value.accepted),
            reasonKey: optionalText(value.reasonKey)
          } satisfies CancelResult
        : { accepted: false, reasonKey: 'setup.update.cancelFailed' };
    },
    launchApp: async (requestOperationId: string) =>
      sanitizeWindowAction(
        await invokeSafe(ipc, 'fluxora_setup_launch_app', {
          request: { operationId: operationId(requestOperationId) }
        })
      ),
    openInstalledFolder: async (requestOperationId: string) =>
      sanitizeWindowAction(
        await invokeSafe(ipc, 'fluxora_setup_open_installed_folder', {
          request: { operationId: operationId(requestOperationId) }
        })
      ),
    revealLogs: async (requestOperationId: string) =>
      sanitizeWindowAction(
        await invokeSafe(ipc, 'fluxora_setup_reveal_logs', {
          request: { operationId: operationId(requestOperationId) }
        })
      ),
    minimizeWindow: async () =>
      sanitizeWindowAction(await invokeSafe(ipc, 'fluxora_setup_minimize_window')),
    requestClose: async () =>
      sanitizeWindowAction(await invokeSafe(ipc, 'fluxora_setup_request_close')),
    onProgress: (listener: InstallerEventListener<InstallProgress>) =>
      listenSanitized(ipc, setupProgressEvent, listener, sanitizeInstallProgress),
    onPostInstallUpdateProgress: (
      listener: InstallerEventListener<SetupPostInstallUpdateProgress>
    ) => listenSanitized(
      ipc,
      setupPostInstallUpdateProgressEvent,
      listener,
      sanitizePostInstallUpdateProgress
    ),
    onCloseBlocked: (listener: InstallerEventListener<{ reasonKey: string }>) =>
      listenSanitized(ipc, setupCloseBlockedEvent, listener, closeNotice)
  });

export const createUpdaterFacade = (ipc: InstallerIpc = tauriIpc): UpdaterFacade => {
  let trustedSummary: UpdateRequestSummary | null = null;
  return Object.freeze({
    getRequestSummary: async () => {
      const summary = sanitizeUpdateSummary(
        await invokeSafe(ipc, 'fluxora_updater_get_request_summary')
      );
      trustedSummary = summary;
      return summary;
    },
    rendererReady: async () =>
      sanitizeWindowAction(await invokeSafe(ipc, 'fluxora_updater_renderer_ready')),
    startUpdate: async () => {
      const result = sanitizeUpdateResult(
        await invokeSafe(ipc, 'fluxora_updater_start_update')
      );
      if (
        trustedSummary
        && (
          result.operationId !== trustedSummary.operationId
          || result.targetVersion !== trustedSummary.targetVersion
        )
      ) {
        throw nativeFailure(
          'updater.resultMismatch',
          'updater.error.invalidNativeResponse'
        );
      }
      return result;
    },
    minimizeWindow: async () =>
      sanitizeWindowAction(await invokeSafe(ipc, 'fluxora_updater_minimize_window')),
    requestClose: async () =>
      sanitizeWindowAction(await invokeSafe(ipc, 'fluxora_updater_request_close')),
    onProgress: (listener: InstallerEventListener<UpdateProgress>) =>
      listenSanitized(ipc, updaterProgressEvent, listener, sanitizeUpdateProgress),
    onCloseBlocked: (listener: InstallerEventListener<{ reasonKey: string }>) =>
      listenSanitized(ipc, updaterCloseBlockedEvent, listener, closeNotice)
  });
};
