export type InstallerLanguage = 'en' | 'de' | 'ru';
export type SetupMode = 'install' | 'repair' | 'update' | 'downgrade';
export type SetupStep =
  | 'language'
  | 'legal'
  | 'location'
  | 'installation'
  | 'update'
  | 'result';
export type InstallPathStatus =
  | 'valid'
  | 'insufficient-space'
  | 'foreign-install'
  | 'invalid-path';

export interface NativeFailure {
  code: string;
  messageKey: string;
  retryable: boolean;
  actionKey?: string;
}

export interface SetupBootstrapState {
  schemaVersion: 1;
  language: InstallerLanguage;
  defaultInstallDirectory: string;
  mode: SetupMode;
  installedVersion?: string;
  requiredBytes: number;
  freeBytes: number;
  isOwnedInstall: boolean;
  payloadBytes: number;
  webview2Version?: string;
  nativeAvailable: boolean;
}

export interface InstallPathValidation {
  schemaVersion: 1;
  status: InstallPathStatus;
  code: string;
  messageKey: string;
  normalizedInstallDirectory: string;
  requiredBytes: number;
  freeBytes: number;
  mode: SetupMode;
}

export interface InstallOptions {
  operationId: string;
  installDirectory: string;
  createDesktopShortcut: boolean;
  language: InstallerLanguage;
  termsAccepted: boolean;
  privacyAcknowledged: boolean;
}

export interface InstallProgress {
  operationId: string;
  phase: string;
  copiedBytes: number;
  totalBytes: number;
  percent: number;
  statusKey: string;
  currentItem?: string;
  canCancel: boolean;
}

export interface InstallResult {
  schemaVersion: 1;
  operationId: string;
  outcome: 'succeeded' | 'cancelled';
  installDirectory: string;
  applicationPath: string;
  installedVersion: string;
  createdDesktopShortcut: boolean;
}

export type SetupPostInstallUpdateState =
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'verifying'
  | 'preparing-handoff'
  | 'handoff-committed'
  | 'launching-bundled'
  | 'cancelled'
  | 'error'
  | 'launch-error';

export interface SetupPostInstallUpdateProgress {
  schemaVersion: 1;
  operationId: string;
  state: SetupPostInstallUpdateState;
  phase: string;
  currentVersion: string;
  targetVersion?: string;
  downloadedBytes: number;
  totalBytes: number;
  percent?: number;
  canCancel: boolean;
}

export interface SetupPostInstallUpdateResult {
  schemaVersion: 1;
  operationId: string;
  outcome: 'bundled-launched' | 'updater-launched' | 'cancelled' | 'launch-failed';
  error?: NativeFailure;
}

export interface CancelResult {
  accepted: boolean;
  reasonKey?: string;
}

export interface WindowActionResult {
  completed: boolean;
  reasonKey?: string;
}

export interface UpdateRequestSummary {
  schemaVersion: 1;
  operationId: string;
  currentVersion: string;
  targetVersion: string;
  assetKind: 'full' | 'delta';
  presentation: 'compact' | 'setup-handoff';
  language: InstallerLanguage;
}

export interface UpdateProgress {
  schemaVersion: 1;
  operationId: string;
  phase: string;
  copiedBytes: number;
  totalBytes: number;
  percent: number;
  statusKey: string;
  currentItem?: string;
  canCancel: false;
}

export interface UpdateResult {
  schemaVersion: 1;
  operationId: string;
  outcome: 'succeeded' | 'rolled-back' | 'failed';
  targetVersion: string;
  error?: NativeFailure;
}

export type InstallerUnlisten = () => void;
export type InstallerEventListener<T> = (payload: T) => void;

export interface SetupFacade {
  getBootstrapState(): Promise<SetupBootstrapState>;
  pickInstallFolder(
    initialDirectory?: string,
    language?: InstallerLanguage
  ): Promise<string | null>;
  validateInstallPath(
    installDirectory: string,
    operationId: string
  ): Promise<InstallPathValidation>;
  startInstall(options: InstallOptions): Promise<InstallResult>;
  cancelInstall(operationId: string): Promise<CancelResult>;
  startPostInstallUpdate(operationId: string): Promise<SetupPostInstallUpdateResult>;
  cancelPostInstallUpdate(operationId: string): Promise<CancelResult>;
  launchApp(operationId: string): Promise<WindowActionResult>;
  openInstalledFolder(operationId: string): Promise<WindowActionResult>;
  revealLogs(operationId: string): Promise<WindowActionResult>;
  minimizeWindow(): Promise<WindowActionResult>;
  requestClose(): Promise<WindowActionResult>;
  onProgress(listener: InstallerEventListener<InstallProgress>): Promise<InstallerUnlisten>;
  onPostInstallUpdateProgress(
    listener: InstallerEventListener<SetupPostInstallUpdateProgress>
  ): Promise<InstallerUnlisten>;
  onCloseBlocked(
    listener: InstallerEventListener<{ reasonKey: string }>
  ): Promise<InstallerUnlisten>;
}

export interface UpdaterFacade {
  getRequestSummary(): Promise<UpdateRequestSummary>;
  rendererReady(): Promise<WindowActionResult>;
  startUpdate(): Promise<UpdateResult>;
  minimizeWindow(): Promise<WindowActionResult>;
  requestClose(): Promise<WindowActionResult>;
  onProgress(listener: InstallerEventListener<UpdateProgress>): Promise<InstallerUnlisten>;
  onCloseBlocked(
    listener: InstallerEventListener<{ reasonKey: string }>
  ): Promise<InstallerUnlisten>;
}

export interface SetupFluxoraWindow {
  fluxora: {
    setup: SetupFacade;
  };
}

export interface UpdaterFluxoraWindow {
  fluxora: {
    updater: UpdaterFacade;
  };
}

export function createInstallerOperationId(prefix: 'setup' | 'setup_validate'): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`.slice(0, 128);
}
