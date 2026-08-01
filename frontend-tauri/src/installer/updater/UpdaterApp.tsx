import { useEffect, useMemo, useReducer } from 'react';

import { Icon } from '../../renderer/design-system/icons';
import { Button } from '../../renderer/design-system/primitives';
import type {
  NativeFailure,
  UpdaterFluxoraWindow
} from '../contracts';
import {
  failureMessage,
  installerLanguageFromLocale,
  translate
} from '../i18n';
import { InstallerTitlebar } from '../components/InstallerTitlebar';
import { InstallerProgressPanel } from '../components/InstallerProgressPanel';
import {
  initialUpdaterFlowState,
  updaterFlowReducer
} from './updater-flow';

const updaterApi = () =>
  (window as unknown as UpdaterFluxoraWindow).fluxora.updater;

export function UpdaterApp() {
  const [state, dispatch] = useReducer(updaterFlowReducer, {
    ...initialUpdaterFlowState,
    language: installerLanguageFromLocale(navigator.language)
  });
  const api = useMemo(updaterApi, []);

  useEffect(() => {
    document.documentElement.lang = state.language;
  }, [state.language]);

  useEffect(() => {
    let disposed = false;
    let stopProgress: (() => void) | undefined;
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
    void (async () => {
      try {
        const summary = await api.getRequestSummary();
        if (disposed) {
          return;
        }
        dispatch({ type: 'summary', summary });
        const ready = await api.rendererReady();
        if (!ready.completed) {
          throw {
            code: 'updater.windowShowFailed',
            messageKey: ready.reasonKey ?? 'updater.error.windowActionFailed',
            retryable: true
          } satisfies NativeFailure;
        }
        const result = await api.startUpdate();
        if (!disposed) {
          dispatch({ type: 'result', result });
        }
      } catch (failure) {
        if (!disposed) {
          dispatch({ type: 'failure', failure: failure as NativeFailure });
        }
      }
    })();
    return () => {
      disposed = true;
      stopProgress?.();
      stopClose?.();
    };
  }, [api]);

  const summary = state.summary;
  const progress = state.progress;
  const statusKey = progress?.statusKey ?? 'updater.progress.preparing';
  const translatedStatus = translate(state.language, statusKey);
  const status = translatedStatus === statusKey && progress
    ? translate(state.language, `updater.progress.${progress.phase}`)
    : translatedStatus;
  const resultText = state.result
    ? translate(state.language, `updater.result.${state.result.outcome}`)
    : state.failure
      ? failureMessage(state.language, state.failure)
      : null;
  const resultFailure = state.failure ?? state.result?.error ?? null;
  const showErrorIcon = Boolean(
    state.failure || state.result && state.result.outcome !== 'succeeded'
  );
  const setupHandoff = summary?.presentation === 'setup-handoff';
  const progressTitle = summary
    ? setupHandoff
      ? translate(state.language, 'setup.update.title')
      : translate(state.language, 'updater.version', {
          current: summary.currentVersion,
          target: summary.targetVersion
        })
    : translate(state.language, 'updater.loading');
  const phase = summary
    ? translate(state.language, `updater.asset.${summary.assetKind}`)
    : translate(state.language, 'updater.progress.preparing');

  return (
    <div className="updater-shell" data-presentation={summary?.presentation ?? 'compact'}>
      <InstallerTitlebar
        onClose={() => api.requestClose()}
        onCloseBlocked={(key) => dispatch({ type: 'notice', key })}
        onMinimize={() => api.minimizeWindow()}
        title={translate(state.language, 'updater.title')}
      />
      <main className="updater-content">
        <div className="updater-heading">
          {state.result?.outcome === 'succeeded' ? (
            <Icon
              className="updater-state-icon updater-state-icon--success"
              name="circle-check"
              size={23}
            />
          ) : showErrorIcon ? (
            <Icon
              className="updater-state-icon updater-state-icon--error"
              name="alert-triangle"
              size={23}
            />
          ) : null}
        </div>
        {state.state === 'result' ? (
          <div
            aria-live="polite"
            className="updater-result"
            role={resultFailure || state.result?.outcome === 'failed' ? 'alert' : 'status'}
          >
            <strong>{resultText}</strong>
            {resultFailure ? <code>{resultFailure.code}</code> : null}
          </div>
        ) : (
          <InstallerProgressPanel
            busy
            currentVersion={summary?.currentVersion}
            downloadedBytes={progress?.copiedBytes}
            language={state.language}
            phase={progress?.currentItem ?? phase}
            percent={progress && progress.totalBytes > 0 ? progress.percent : undefined}
            status={status}
            targetVersion={summary?.targetVersion}
            title={progressTitle}
            totalBytes={progress?.totalBytes}
          />
        )}
        {state.noticeKey ? (
          <p className="updater-notice" role="status">
            {translate(state.language, state.noticeKey)}
          </p>
        ) : null}
      </main>
      {state.state === 'result' ? (
        <footer className="updater-actions">
          <Button onClick={() => void api.requestClose()} size="sm" variant="secondary">
            {translate(state.language, 'setup.action.close')}
          </Button>
        </footer>
      ) : null}
    </div>
  );
}
