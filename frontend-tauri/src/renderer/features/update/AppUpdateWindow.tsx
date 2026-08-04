import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';

import { normalizeAppLocale } from '../../../localization';
import {
  appLanguageReducer,
  initialAppLanguageState
} from '../../../localization/app-language-state';
import { LocalizationProvider, useLocalization } from '../../../localization/react';
import type { FluxoraUpdateStatus } from '../../../shared/fluxora-api';
import { InstallerTitlebar } from '../../../installer/components/InstallerTitlebar';
import { UpdateStageProgressPanel } from '../../../installer/components/UpdateStageProgressPanel';
import { installerLanguageFromLocale } from '../../../installer/i18n';
import { Icon } from '../../design-system/icons';
import { Button } from '../../design-system/primitives';
import { createRendererOperationId } from '../../services/renderer-operation-service';
import {
  createDownloadSpeedSampler,
  projectAppUpdateProgress
} from './app-update-progress';

import './app-update-window.css';
import '../../../installer/components/installer-tokens.css';

const initialStatus: FluxoraUpdateStatus = {
  state: 'idle',
  currentVersion: ''
};

const isBusy = (status: FluxoraUpdateStatus): boolean =>
  status.state !== 'error' && status.state !== 'available';

const operationIdFromLocation = (): string => {
  const candidate = new URLSearchParams(window.location.search).get('operationId')?.trim() ?? '';
  return /^[A-Za-z0-9._-]{1,128}$/.test(candidate)
    ? candidate
    : createRendererOperationId('app_update_download_install');
};

const formatDownloadSpeed = (bytesPerSecond: number | undefined, locale: string): string | null => {
  if (bytesPerSecond === undefined || bytesPerSecond <= 0) {
    return null;
  }
  const megabytesPerSecond = bytesPerSecond / 1_000_000;
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  }).format(megabytesPerSecond)} MB/s`;
};

export interface AppUpdateWindowViewProps {
  downloadSpeed?: number;
  notice?: string | null;
  onDismiss: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  status: FluxoraUpdateStatus;
}

export function AppUpdateWindowView({
  downloadSpeed,
  notice,
  onDismiss,
  onRetry,
  status
}: AppUpdateWindowViewProps) {
  const { locale, t } = useLocalization();
  const progress = projectAppUpdateProgress(status);
  const speed = formatDownloadSpeed(downloadSpeed, locale);
  const statusText = status.state === 'downloading'
    ? t('update.window.status.downloading')
    : status.state === 'waitingForOperations'
      ? t('update.window.status.waiting')
      : status.state === 'readyToInstall'
        ? t('update.window.status.preparingInstall')
        : status.state === 'launchingUpdater'
          ? t('update.window.status.launchingInstaller')
          : t('update.window.status.preparing');

  if (status.state === 'error') {
    return (
      <main className="app-update-window__content app-update-window__content--error">
        <Icon aria-hidden="true" className="app-update-window__error-icon" name="alert-triangle" size={24} />
        <div className="app-update-window__error-copy" role="alert">
          <h1>{t('update.window.errorTitle')}</h1>
          <p>{t('update.window.errorDescription')}</p>
        </div>
        <div className="app-update-window__actions">
          {status.error?.retryable !== false ? (
            <Button onClick={() => void onRetry()} size="sm">
              {t('update.window.retry')}
            </Button>
          ) : null}
          <Button onClick={() => void onDismiss()} size="sm" variant="secondary">
            {t('update.window.returnToApp')}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="app-update-window__content">
      <UpdateStageProgressPanel
        currentVersion={status.currentVersion || undefined}
        downloadLabel={t('update.window.stage.download')}
        downloadMeta={speed ?? (
          progress.downloadPercent >= 100
            ? t('update.window.stage.complete')
            : t('update.window.speedPreparing')
        )}
        downloadPercent={progress.downloadPercent}
        installLabel={t('update.window.stage.install')}
        installMeta={t('update.window.stage.pending')}
        installPercent={progress.installPercent}
        status={statusText}
        targetVersion={status.availableVersion}
        title={t('update.window.heading')}
      />
      {notice ? <p className="app-update-window__notice" role="status">{notice}</p> : null}
    </main>
  );
}

function AppUpdateWindowContent() {
  const { locale, t } = useLocalization();
  const [status, setStatus] = useState<FluxoraUpdateStatus>(initialStatus);
  const [downloadSpeed, setDownloadSpeed] = useState<number>();
  const [notice, setNotice] = useState<string | null>(null);
  const speedSampler = useMemo(createDownloadSpeedSampler, []);
  const activeOperationId = useRef(operationIdFromLocation());

  const acceptStatus = useCallback((next: FluxoraUpdateStatus) => {
    setStatus(next);
    if (next.state === 'downloading') {
      setDownloadSpeed(speedSampler.sample(next.downloadedBytes ?? 0, Date.now()));
    } else {
      speedSampler.reset();
      setDownloadSpeed(undefined);
    }
  }, [speedSampler]);

  const runUpdate = useCallback(async (operationId: string) => {
    setNotice(null);
    try {
      acceptStatus(await window.fluxora.updates.downloadAndInstall({ operationId }));
    } catch {
      setStatus((current) => ({
        ...current,
        state: 'error',
        operationId,
        error: {
          code: 'updateWindowWorkflowFailed',
          message: t('update.window.errorDescription'),
          retryable: true
        }
      }));
    }
  }, [acceptStatus, t]);

  useEffect(() => {
    let active = true;
    const stopStatus = window.fluxora.updates.onStatus((next) => {
      if (active) {
        acceptStatus(next);
      }
    });

    void (async () => {
      try {
        const current = await window.fluxora.updates.getStatus();
        if (!active) return;
        acceptStatus(current);
        await window.fluxora.updates.installerWindowReady();
        if (!active) return;
        await runUpdate(activeOperationId.current);
      } catch {
        if (active) {
          acceptStatus({
            ...initialStatus,
            state: 'error',
            operationId: activeOperationId.current,
            error: {
              code: 'updateWindowBootstrapFailed',
              message: t('update.window.errorDescription'),
              retryable: true
            }
          });
        }
      }
    })();

    return () => {
      active = false;
      stopStatus();
    };
  }, [acceptStatus, runUpdate, t]);

  const retry = async () => {
    activeOperationId.current = createRendererOperationId('app_update_retry');
    await runUpdate(activeOperationId.current);
  };

  const dismiss = async () => {
    await window.fluxora.updates.dismissInstaller();
  };

  const requestClose = async () => {
    if (isBusy(status)) {
      setNotice(t('updater.closeBlocked'));
      return { completed: false, reasonKey: 'updater.closeBlocked' };
    }
    await dismiss();
    return { completed: true };
  };

  return (
    <div className="app-update-window">
      <InstallerTitlebar
        language={installerLanguageFromLocale(locale)}
        onClose={requestClose}
        onCloseBlocked={() => setNotice(t('updater.closeBlocked'))}
        onMinimize={async () => {
          await window.fluxora.windowControls.minimize();
          return { completed: true };
        }}
        title={t('update.window.title')}
      />
      <AppUpdateWindowView
        downloadSpeed={downloadSpeed}
        notice={notice}
        onDismiss={dismiss}
        onRetry={retry}
        status={status}
      />
    </div>
  );
}

export function AppUpdateWindow() {
  const [appLanguage, dispatchAppLanguage] = useReducer(
    appLanguageReducer,
    initialAppLanguageState
  );

  useEffect(() => {
    let active = true;
    const unsubscribeLanguage = window.fluxora.settings.onLanguageChanged((result) => {
      if (active) {
        dispatchAppLanguage({ type: 'language-confirmed', language: result.language });
      }
    });

    void window.fluxora.settings.getTheme().then((result) => {
      if (active) document.documentElement.dataset.theme = result.theme;
    }).catch(() => undefined);
    void window.fluxora.app.getInfo().then((result) => {
      if (active) document.documentElement.dataset.platform = result.platform;
    }).catch(() => undefined);
    void window.fluxora.settings.getLanguage().then((result) => {
      if (active) dispatchAppLanguage({ type: 'native-loaded', language: result.language });
    }).catch(() => {
      if (active) dispatchAppLanguage({ type: 'native-load-failed' });
    });

    return () => {
      active = false;
      unsubscribeLanguage();
    };
  }, []);

  useLayoutEffect(() => {
    if (appLanguage.ready) {
      document.documentElement.lang = normalizeAppLocale(appLanguage.language);
    }
  }, [appLanguage.language, appLanguage.ready]);

  if (!appLanguage.ready) {
    return <main className="desktop-shell" aria-busy="true" />;
  }

  return (
    <LocalizationProvider language={appLanguage.language}>
      <AppUpdateWindowContent />
    </LocalizationProvider>
  );
}
