import type {
  InstallPathValidation,
  InstallProgress,
  InstallResult,
  InstallerLanguage,
  NativeFailure,
  SetupPostInstallUpdateProgress,
  SetupPostInstallUpdateResult,
  SetupBootstrapState,
  SetupStep
} from '../contracts';

export type LegalDocumentKind =
  | 'privacy'
  | 'terms'
  | 'third-party-notices'
  | 'legal-notice';

export const setupStepOrder = [
  'language',
  'legal',
  'location',
  'installation',
  'update',
  'result'
] as const satisfies readonly SetupStep[];

type EditableSetupStep = (typeof setupStepOrder)[0 | 1 | 2];

const editableStepLimit = setupStepOrder.indexOf('location');

const stepIndex = (step: SetupStep): number => setupStepOrder.indexOf(step);

const furthestEditableStep = (
  current: EditableSetupStep,
  candidate: SetupStep
): EditableSetupStep => {
  const candidateIndex = stepIndex(candidate);
  return candidateIndex <= editableStepLimit && candidateIndex > stepIndex(current)
    ? candidate as EditableSetupStep
    : current;
};

export interface SetupFlowState {
  step: SetupStep;
  furthestStep: EditableSetupStep;
  language: InstallerLanguage;
  bootstrap: SetupBootstrapState | null;
  bootstrapBusy: boolean;
  legalDocument: LegalDocumentKind;
  termsAccepted: boolean;
  privacyAcknowledged: boolean;
  installDirectory: string;
  createDesktopShortcut: boolean;
  validation: InstallPathValidation | null;
  validationBusy: boolean;
  operationId: string | null;
  progress: InstallProgress | null;
  cancelling: boolean;
  result: InstallResult | null;
  postInstallProgress: SetupPostInstallUpdateProgress | null;
  postInstallResult: SetupPostInstallUpdateResult | null;
  failure: NativeFailure | null;
  noticeKey: string | null;
}

export const initialSetupFlowState: SetupFlowState = {
  step: 'language',
  furthestStep: 'language',
  language: 'en',
  bootstrap: null,
  bootstrapBusy: true,
  legalDocument: 'privacy',
  termsAccepted: false,
  privacyAcknowledged: false,
  installDirectory: '',
  createDesktopShortcut: true,
  validation: null,
  validationBusy: false,
  operationId: null,
  progress: null,
  cancelling: false,
  result: null,
  postInstallProgress: null,
  postInstallResult: null,
  failure: null,
  noticeKey: null
};

export type SetupFlowAction =
  | { type: 'bootstrap-ready'; state: SetupBootstrapState }
  | { type: 'bootstrap-failed'; failure: NativeFailure }
  | { type: 'language'; language: InstallerLanguage }
  | { type: 'legal-document'; document: LegalDocumentKind }
  | { type: 'terms'; accepted: boolean }
  | { type: 'privacy'; acknowledged: boolean }
  | { type: 'step'; step: SetupStep }
  | { type: 'path'; path: string }
  | { type: 'shortcut'; enabled: boolean }
  | { type: 'validation-started' }
  | { type: 'validation-ready'; validation: InstallPathValidation }
  | { type: 'validation-failed'; failure: NativeFailure }
  | { type: 'install-started'; operationId: string }
  | { type: 'progress'; progress: InstallProgress }
  | { type: 'cancelling' }
  | { type: 'install-finished'; result: InstallResult }
  | { type: 'install-cancelled' }
  | { type: 'install-failed'; failure: NativeFailure }
  | { type: 'post-update-progress'; progress: SetupPostInstallUpdateProgress }
  | { type: 'post-update-finished'; result: SetupPostInstallUpdateResult }
  | { type: 'post-update-failed'; failure: NativeFailure }
  | { type: 'notice'; key: string | null }
  | { type: 'retry' };

export function setupFlowReducer(
  state: SetupFlowState,
  action: SetupFlowAction
): SetupFlowState {
  switch (action.type) {
    case 'bootstrap-ready':
      return {
        ...state,
        bootstrap: action.state,
        bootstrapBusy: false,
        language: action.state.language,
        installDirectory: action.state.defaultInstallDirectory,
        failure: null
      };
    case 'bootstrap-failed':
      return {
        ...state,
        bootstrapBusy: false,
        step: 'result',
        failure: action.failure
      };
    case 'language':
      return { ...state, language: action.language };
    case 'legal-document':
      return { ...state, legalDocument: action.document };
    case 'terms':
      return { ...state, termsAccepted: action.accepted };
    case 'privacy':
      return { ...state, privacyAcknowledged: action.acknowledged };
    case 'step':
      return {
        ...state,
        step: action.step,
        furthestStep: furthestEditableStep(state.furthestStep, action.step),
        noticeKey: null
      };
    case 'path':
      return {
        ...state,
        installDirectory: action.path,
        validation: null,
        failure: null
      };
    case 'shortcut':
      return { ...state, createDesktopShortcut: action.enabled };
    case 'validation-started':
      return { ...state, validationBusy: true, validation: null };
    case 'validation-ready':
      return {
        ...state,
        validationBusy: false,
        validation: action.validation,
        installDirectory: action.validation.normalizedInstallDirectory || state.installDirectory,
        failure: null
      };
    case 'validation-failed':
      return {
        ...state,
        validationBusy: false,
        validation: null,
        failure: action.failure
      };
    case 'install-started':
      return {
        ...state,
        step: 'installation',
        operationId: action.operationId,
        progress: null,
        failure: null,
        result: null,
        postInstallProgress: null,
        postInstallResult: null,
        cancelling: false,
        noticeKey: null
      };
    case 'progress':
      if (state.operationId !== action.progress.operationId) {
        return state;
      }
      return {
        ...state,
        progress: state.progress
          ? {
              ...action.progress,
              percent: Math.max(state.progress.percent, action.progress.percent)
            }
          : action.progress,
        noticeKey: action.progress.canCancel ? state.noticeKey : 'setup.installation.commitLocked'
      };
    case 'cancelling':
      return { ...state, cancelling: true };
    case 'install-finished':
      return {
        ...state,
        step: action.result.outcome === 'succeeded' ? 'update' : 'location',
        result: action.result,
        postInstallProgress: action.result.outcome === 'succeeded'
          ? {
              schemaVersion: 1,
              operationId: action.result.operationId,
              state: 'checking',
              phase: 'checking',
              currentVersion: action.result.installedVersion,
              downloadedBytes: 0,
              totalBytes: 0,
              canCancel: true
            }
          : null,
        postInstallResult: null,
        failure: null,
        cancelling: false
      };
    case 'install-cancelled':
      return {
        ...state,
        step: 'location',
        operationId: null,
        progress: null,
        result: null,
        failure: null,
        cancelling: false,
        noticeKey: 'setup.installation.cancelled'
      };
    case 'install-failed':
      return {
        ...state,
        step: 'result',
        result: null,
        failure: action.failure,
        cancelling: false
      };
    case 'post-update-progress': {
      if (state.operationId !== action.progress.operationId) {
        return state;
      }
      const sameDownloadStage = state.postInstallProgress?.state === 'downloading'
        && action.progress.state === 'downloading';
      return {
        ...state,
        step: 'update',
        postInstallProgress: sameDownloadStage
          ? {
              ...action.progress,
              downloadedBytes: Math.max(
                state.postInstallProgress?.downloadedBytes ?? 0,
                action.progress.downloadedBytes
              ),
              percent: Math.max(
                state.postInstallProgress?.percent ?? 0,
                action.progress.percent ?? 0
              )
            }
          : action.progress,
        cancelling: action.progress.state === 'cancelled' ? false : state.cancelling,
        noticeKey: action.progress.state === 'handoff-committed'
          ? 'setup.update.commitLocked'
          : state.noticeKey
      };
    }
    case 'post-update-finished':
      if (state.operationId !== action.result.operationId) {
        return state;
      }
      return {
        ...state,
        step: action.result.outcome === 'launch-failed' ? 'result' : 'update',
        postInstallResult: action.result,
        failure: action.result.error ?? null,
        cancelling: false
      };
    case 'post-update-failed':
      return {
        ...state,
        step: 'result',
        postInstallResult: state.operationId
          ? {
              schemaVersion: 1,
              operationId: state.operationId,
              outcome: 'launch-failed',
              error: action.failure
            }
          : null,
        failure: action.failure,
        cancelling: false
      };
    case 'notice':
      return { ...state, noticeKey: action.key };
    case 'retry':
      return {
        ...state,
        step: 'location',
        operationId: null,
        progress: null,
        result: null,
        postInstallProgress: null,
        postInstallResult: null,
        failure: null,
        cancelling: false,
        noticeKey: null
      };
  }
}

export const canContinueLegal = (state: SetupFlowState): boolean =>
  state.termsAccepted && state.privacyAcknowledged;

export const canStartInstall = (state: SetupFlowState): boolean =>
  !state.validationBusy && state.validation?.status === 'valid';
