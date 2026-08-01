import { useEffect, useMemo, useReducer } from 'react';

import { Icon } from '../../renderer/design-system/icons';
import {
  Button,
  Checkbox,
  Input,
  ProgressBar
} from '../../renderer/design-system/primitives';
import { LegalDocumentsPanel } from '../../renderer/features/legal/LegalDocumentsPanel';
import type {
  InstallerLanguage,
  NativeFailure,
  SetupFluxoraWindow
} from '../contracts';
import { createInstallerOperationId } from '../contracts';
import { failureMessage, setupModeLabel, translate } from '../i18n';
import { InstallerTitlebar } from '../components/InstallerTitlebar';
import { InstallerProgressPanel } from '../components/InstallerProgressPanel';
import { LanguageStep } from './LanguageStep';
import { SetupStepNavigation } from './SetupStepNavigation';
import {
  canContinueLegal,
  canStartInstall,
  initialSetupFlowState,
  setupFlowReducer
} from './setup-flow';

const setupApi = () =>
  (window as unknown as SetupFluxoraWindow).fluxora.setup;

const formatBytes = (bytes: number, language: InstallerLanguage): string =>
  new Intl.NumberFormat(language, {
    maximumFractionDigits: 1,
    style: 'unit',
    unit: bytes >= 1024 ** 3 ? 'gigabyte' : 'megabyte',
    unitDisplay: 'short'
  }).format(bytes / (bytes >= 1024 ** 3 ? 1024 ** 3 : 1024 ** 2));

export function SetupApp() {
  const [state, dispatch] = useReducer(setupFlowReducer, initialSetupFlowState);
  const api = useMemo(setupApi, []);

  useEffect(() => {
    let disposed = false;
    void api.getBootstrapState()
      .then((bootstrap) => {
        if (!disposed) {
          document.documentElement.lang = bootstrap.language;
          dispatch({ type: 'bootstrap-ready', state: bootstrap });
        }
      })
      .catch((failure: NativeFailure) => {
        if (!disposed) {
          dispatch({ type: 'bootstrap-failed', failure });
        }
      });
    return () => {
      disposed = true;
    };
  }, [api]);

  useEffect(() => {
    let disposed = false;
    let stopProgress: (() => void) | undefined;
    let stopPostInstallProgress: (() => void) | undefined;
    let stopClose: (() => void) | undefined;
    void api.onProgress((progress) => dispatch({ type: 'progress', progress }))
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          stopProgress = stop;
        }
      });
    void api.onCloseBlocked(({ reasonKey }) => dispatch({ type: 'notice', key: reasonKey }))
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          stopClose = stop;
        }
      });
    void api.onPostInstallUpdateProgress((progress) =>
      dispatch({ type: 'post-update-progress', progress }))
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          stopPostInstallProgress = stop;
        }
      });
    return () => {
      disposed = true;
      stopProgress?.();
      stopPostInstallProgress?.();
      stopClose?.();
    };
  }, [api]);

  useEffect(() => {
    if (state.step !== 'location' || !state.installDirectory.trim()) {
      return undefined;
    }
    let active = true;
    dispatch({ type: 'validation-started' });
    const timer = window.setTimeout(() => {
      const operationId = createInstallerOperationId('setup_validate');
      void api.validateInstallPath(state.installDirectory, operationId)
        .then((validation) => {
          if (active) {
            dispatch({ type: 'validation-ready', validation });
          }
        })
        .catch((failure: NativeFailure) => {
          if (active) {
            dispatch({ type: 'validation-failed', failure });
          }
        });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, state.installDirectory, state.step]);

  const changeLanguage = (language: InstallerLanguage) => {
    document.documentElement.lang = language;
    dispatch({ type: 'language', language });
  };

  const browse = async () => {
    const path = await api.pickInstallFolder(state.installDirectory, state.language);
    if (path) {
      dispatch({ type: 'path', path });
    }
  };

  const startInstall = async () => {
    if (!canStartInstall(state)) {
      return;
    }
    const operationId = createInstallerOperationId('setup');
    dispatch({ type: 'install-started', operationId });
    try {
      const result = await api.startInstall({
        operationId,
        installDirectory: state.installDirectory,
        createDesktopShortcut: state.createDesktopShortcut,
        language: state.language,
        termsAccepted: state.termsAccepted,
        privacyAcknowledged: state.privacyAcknowledged
      });
      dispatch({ type: 'install-finished', result });
      if (result.outcome === 'succeeded') {
        try {
          const postInstallResult = await api.startPostInstallUpdate(result.operationId);
          dispatch({ type: 'post-update-finished', result: postInstallResult });
        } catch (failure) {
          dispatch({ type: 'post-update-failed', failure: failure as NativeFailure });
        }
      }
    } catch (failure) {
      const nativeFailure = failure as NativeFailure;
      dispatch(
        nativeFailure.code === 'setup.cancelled'
          ? { type: 'install-cancelled' }
          : { type: 'install-failed', failure: nativeFailure }
      );
    }
  };

  const cancelInstall = async () => {
    if (!state.operationId) {
      return;
    }
    const result = await api.cancelInstall(state.operationId);
    if (result.accepted) {
      dispatch({ type: 'cancelling' });
    } else if (result.reasonKey) {
      dispatch({ type: 'notice', key: result.reasonKey });
    }
  };

  const cancelPostInstallUpdate = async () => {
    if (!state.operationId) {
      return;
    }
    const result = await api.cancelPostInstallUpdate(state.operationId);
    if (result.accepted) {
      dispatch({ type: 'cancelling' });
    } else if (result.reasonKey) {
      dispatch({ type: 'notice', key: result.reasonKey });
    }
  };

  const actionOperationId = state.operationId ?? createInstallerOperationId('setup');
  const validationLabel = state.validationBusy
    ? translate(state.language, 'setup.location.checking')
    : state.validation
      ? translate(
          state.language,
          state.validation.messageKey || `setup.location.${state.validation.status}`
        )
      : state.failure
        ? failureMessage(state.language, state.failure)
        : '';
  const progress = state.progress;
  const progressLabel = progress
    ? translate(state.language, progress.statusKey) === progress.statusKey
      ? translate(state.language, `setup.progress.${progress.phase}`)
      : translate(state.language, progress.statusKey)
    : translate(state.language, 'setup.progress.preparing');
  const postInstallProgress = state.postInstallProgress;
  const postInstallStatusKey = postInstallProgress
    ? ({
        checking: 'setup.update.checking',
        'up-to-date': 'setup.update.upToDate',
        'update-available': 'setup.update.available',
        downloading: 'setup.update.downloading',
        verifying: 'setup.update.verifying',
        'preparing-handoff': 'setup.update.preparingHandoff',
        'handoff-committed': 'setup.update.handoffCommitted',
        'launching-bundled': 'setup.update.launchingBundled',
        cancelled: 'setup.update.cancelled',
        error: 'setup.update.error',
        'launch-error': 'setup.update.launchError'
      } as const)[postInstallProgress.state]
    : 'setup.update.checking';
  const postInstallStatus = state.cancelling
    ? translate(state.language, 'setup.installation.cancelling')
    : translate(state.language, postInstallStatusKey);
  const phaseKey = postInstallProgress
    ? `setup.update.phase.${postInstallProgress.phase}`
    : 'setup.update.phase.checking';
  const translatedPhase = translate(state.language, phaseKey);
  const postInstallPhase = translatedPhase === phaseKey
    ? translate(state.language, 'setup.update.detail')
    : translatedPhase;

  const languageStep = (
    <LanguageStep language={state.language} onSelect={changeLanguage} />
  );

  const legalStep = (
    <div className="setup-step setup-step--legal">
      <div className="setup-step__heading">
        <h1>{translate(state.language, 'setup.legal.title')}</h1>
        <p>{translate(state.language, 'setup.legal.detail')}</p>
      </div>
      <div className="setup-legal-viewer">
        <LegalDocumentsPanel
          compact
          language={state.language}
          onSelect={(document) => dispatch({ type: 'legal-document', document })}
          selected={state.legalDocument}
        />
      </div>
      <div className="setup-legal-checks">
        <Checkbox
          checked={state.termsAccepted}
          label={translate(state.language, 'setup.legal.acceptTerms')}
          onCheckedChange={(accepted) => dispatch({ type: 'terms', accepted })}
        />
        <Checkbox
          checked={state.privacyAcknowledged}
          label={translate(state.language, 'setup.legal.ackPrivacy')}
          onCheckedChange={(acknowledged) => dispatch({ type: 'privacy', acknowledged })}
        />
      </div>
    </div>
  );

  const locationStep = (
    <div className="setup-step setup-step--location">
      <div className="setup-step__heading">
        <h1>{translate(state.language, 'setup.location.title')}</h1>
        <p>{translate(state.language, 'setup.location.detail')}</p>
      </div>
      <div className="setup-mode-line">
        <strong>{setupModeLabel(state.language, state.validation?.mode ?? state.bootstrap?.mode ?? 'install')}</strong>
        {state.bootstrap?.installedVersion ? <span>{state.bootstrap.installedVersion}</span> : null}
      </div>
      <label className="setup-field">
        <span>{translate(state.language, 'setup.location.path')}</span>
        <span className="setup-path-control">
          <Input
            aria-describedby="setup-location-status"
            autoComplete="off"
            value={state.installDirectory}
            onChange={(event) => dispatch({ type: 'path', path: event.currentTarget.value })}
          />
          <Button onClick={() => void browse()} variant="secondary">
            {translate(state.language, 'setup.location.browse')}
          </Button>
        </span>
      </label>
      <div
        aria-live="polite"
        className="setup-location-status"
        data-status={state.validation?.status ?? (state.validationBusy ? 'checking' : 'idle')}
        id="setup-location-status"
        role={
          state.failure || state.validation && state.validation.status !== 'valid'
            ? 'alert'
            : 'status'
        }
      >
        <span>{validationLabel}</span>
        {state.validation ? (
          <span className="setup-disk-space">
            {translate(state.language, 'setup.location.required')}: {formatBytes(state.validation.requiredBytes, state.language)}
            {' · '}
            {translate(state.language, 'setup.location.available')}: {formatBytes(state.validation.freeBytes, state.language)}
          </span>
        ) : null}
      </div>
      <Checkbox
        checked={state.createDesktopShortcut}
        label={translate(state.language, 'setup.location.shortcut')}
        onCheckedChange={(enabled) => dispatch({ type: 'shortcut', enabled })}
      />
      {state.noticeKey ? (
        <p className="setup-location-notice" role="status">
          {translate(state.language, state.noticeKey)}
        </p>
      ) : null}
    </div>
  );

  const installationStep = (
    <div aria-busy="true" className="setup-step setup-step--installation">
      <div className="setup-step__heading">
        <h1>{translate(state.language, 'setup.installation.title')}</h1>
        <p>{translate(state.language, 'setup.installation.detail')}</p>
      </div>
      <div aria-live="polite" className="setup-progress-copy" role="status">
        <strong>{state.cancelling ? translate(state.language, 'setup.installation.cancelling') : progressLabel}</strong>
        {progress?.currentItem ? <code title={progress.currentItem}>{progress.currentItem}</code> : null}
      </div>
      <ProgressBar
        aria-label={progressLabel}
        indeterminate={!progress || progress.totalBytes === 0}
        value={progress?.percent ?? 0}
        valueLabel={progress ? `${Math.round(progress.percent)}%` : undefined}
      />
      {state.noticeKey ? (
        <p className="setup-commit-notice" role="status">
          <Icon name="alert-triangle" size={15} />
          {translate(state.language, state.noticeKey)}
        </p>
      ) : null}
    </div>
  );

  const updateStep = (
    <div className="setup-step setup-step--update">
      <InstallerProgressPanel
        busy={postInstallProgress?.state !== 'launch-error'}
        currentVersion={postInstallProgress?.currentVersion ?? state.result?.installedVersion}
        downloadedBytes={postInstallProgress?.downloadedBytes}
        language={state.language}
        phase={postInstallPhase}
        percent={postInstallProgress?.state === 'downloading'
          ? postInstallProgress.percent
          : undefined}
        status={postInstallStatus}
        targetVersion={postInstallProgress?.targetVersion}
        title={translate(state.language, 'setup.update.title')}
        totalBytes={postInstallProgress?.totalBytes}
      />
      {state.noticeKey ? (
        <p className="setup-commit-notice" role="status">
          <Icon name="alert-triangle" size={15} />
          {translate(state.language, state.noticeKey)}
        </p>
      ) : null}
    </div>
  );

  const launchFailure = state.postInstallResult?.outcome === 'launch-failed';
  const resultStep = (
    <div
      aria-live="polite"
      className="setup-step setup-step--result"
      role={state.failure ? 'alert' : 'status'}
    >
      {state.result?.outcome === 'succeeded' && !launchFailure ? (
        <>
          <Icon className="setup-result-icon" data-tone="success" name="circle-check" size={30} />
          <h1>{translate(state.language, 'setup.result.success')}</h1>
          <p>{translate(state.language, 'setup.result.successDetail')}</p>
        </>
      ) : (
        <>
          <Icon className="setup-result-icon" data-tone="error" name="circle-x" size={30} />
          <h1>{translate(
            state.language,
            launchFailure ? 'setup.update.launchError' : 'setup.result.error'
          )}</h1>
          <p>{state.failure ? failureMessage(state.language, state.failure) : translate(state.language, 'setup.result.errorDetail')}</p>
          {state.failure ? (
            <p className="setup-error-code">
              <span>{translate(state.language, 'setup.error.code')}</span>
              <code>{state.failure.code}</code>
            </p>
          ) : null}
          <div className="setup-result-actions">
            {launchFailure ? (
              <Button
                iconLeft={<Icon name="play" size={15} />}
                onClick={() => void api.launchApp(actionOperationId)}
              >
                {translate(state.language, 'setup.action.launch')}
              </Button>
            ) : state.bootstrap ? (
              <Button onClick={() => dispatch({ type: 'retry' })}>
                {translate(state.language, 'setup.action.retry')}
              </Button>
            ) : null}
            <Button
              iconLeft={<Icon name="file-text" size={15} />}
              onClick={() => void api.revealLogs(actionOperationId)}
              variant="secondary"
            >
              {translate(state.language, 'setup.action.openLogs')}
            </Button>
          </div>
        </>
      )}
    </div>
  );

  const activeStep = state.bootstrapBusy
    ? <main aria-busy="true" className="setup-loading">{translate(state.language, 'setup.loading')}</main>
    : state.step === 'language'
      ? languageStep
      : state.step === 'legal'
        ? legalStep
        : state.step === 'location'
          ? locationStep
          : state.step === 'installation'
            ? installationStep
            : state.step === 'update'
              ? updateStep
              : resultStep;

  return (
    <div className="setup-shell">
      <InstallerTitlebar
        onClose={() => api.requestClose()}
        onCloseBlocked={(key) => dispatch({ type: 'notice', key })}
        onMinimize={() => api.minimizeWindow()}
        title={translate(state.language, 'setup.title')}
      />
      <aside className="setup-rail">
        <div className="setup-rail__identity" aria-hidden="true">
          <Icon name="fluxora-mark" size={28} />
          <span>Fluxora</span>
        </div>
        <SetupStepNavigation
          currentStep={state.step}
          furthestStep={state.furthestStep}
          language={state.language}
          navigationLocked={
            state.bootstrapBusy
            || state.step === 'installation'
            || state.step === 'update'
            || state.step === 'result'
          }
          onNavigate={(step) => dispatch({ type: 'step', step })}
        />
        <p className="setup-rail__meta">Windows · x64</p>
      </aside>
      <section className="setup-stage">
        <main className="setup-content">{activeStep}</main>
        {!state.bootstrapBusy ? (
          <footer className="setup-actions">
            {state.step === 'language' ? (
              <Button onClick={() => dispatch({ type: 'step', step: 'legal' })}>
                {translate(state.language, 'setup.action.next')}
              </Button>
            ) : null}
            {state.step === 'legal' ? (
              <>
                <Button onClick={() => dispatch({ type: 'step', step: 'language' })} variant="ghost">
                  {translate(state.language, 'setup.action.back')}
                </Button>
                <Button
                  disabled={!canContinueLegal(state)}
                  onClick={() => dispatch({ type: 'step', step: 'location' })}
                >
                  {translate(state.language, 'setup.action.next')}
                </Button>
              </>
            ) : null}
            {state.step === 'location' ? (
              <>
                <Button onClick={() => dispatch({ type: 'step', step: 'legal' })} variant="ghost">
                  {translate(state.language, 'setup.action.back')}
                </Button>
                <Button disabled={!canStartInstall(state)} onClick={() => void startInstall()}>
                  {translate(state.language, 'setup.action.install')}
                </Button>
              </>
            ) : null}
            {state.step === 'installation' && (!progress || progress.canCancel) ? (
              <Button
                disabled={state.cancelling}
                onClick={() => void cancelInstall()}
                variant="secondary"
              >
                {translate(state.language, 'setup.installation.cancel')}
              </Button>
            ) : null}
            {state.step === 'update' && postInstallProgress?.canCancel ? (
              <Button
                disabled={state.cancelling}
                onClick={() => void cancelPostInstallUpdate()}
                variant="secondary"
              >
                {translate(state.language, 'setup.update.cancel')}
              </Button>
            ) : null}
            {state.step === 'result' ? (
              <Button onClick={() => void api.requestClose()} variant="ghost">
                {translate(state.language, 'setup.action.close')}
              </Button>
            ) : null}
          </footer>
        ) : null}
      </section>
    </div>
  );
}
