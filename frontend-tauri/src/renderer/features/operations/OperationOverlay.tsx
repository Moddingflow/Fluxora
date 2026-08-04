import {
  AlertTriangle,
  CheckCircle2
} from '../../design-system/icons/lucide-compat';
import type { CSSProperties } from 'react';

import { FacetSpinner, LoadingSplash, ProgressBar } from '../../design-system';
import type {
  FluxoraFluxPackProviderProgress,
  FluxoraProject
} from '../../../shared/fluxora-api';
import { useLocalization } from '../../../localization/react';

export type OperationOverlayKind =
  | 'build-create'
  | 'build-delete'
  | 'download-delete'
  | 'fluxpack-export'
  | 'fluxpack-install'
  | 'grass-cache';

export interface OperationOverlayState {
  operationId: string;
  kind: OperationOverlayKind;
  title: string;
  statusText: string;
  currentItem: string;
  percent: number | null;
  isRunning: boolean;
  canClose: boolean;
  cancelRequested: boolean;
  createdProject: FluxoraProject | null;
  resultText: string | null;
  errorText: string | null;
  providers?: FluxoraFluxPackProviderProgress[];
}

type OperationOverlayTone = 'running' | 'complete' | 'error';

const operationOverlayTone = (overlay: OperationOverlayState): OperationOverlayTone => {
  if (overlay.errorText) {
    return 'error';
  }

  if (!overlay.isRunning && overlay.resultText) {
    return 'complete';
  }

  return 'running';
};

interface OperationOverlayProps {
  cancellationSupported: boolean;
  onCancel: () => void;
  onClose: () => void;
  overlay: OperationOverlayState | null;
}

interface FluxPackSourceProgressProps {
  label: string;
  percent: number;
  providers: FluxoraFluxPackProviderProgress[];
}

const providerDataId = (providerId: string): string =>
  providerId.trim().toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'unknown';

const futureProviderColors = ['#54a6d8', '#9b7ee3', '#49b58b', '#d66b87', '#c6a54a'];

const providerProgressColor = (providerId: string): string => {
  const normalizedId = providerDataId(providerId);
  if (normalizedId === 'nexus') {
    return '#d98f2b';
  }
  if (normalizedId === 'local') {
    return 'var(--accent)';
  }

  const hash = [...normalizedId].reduce(
    (current, character) => (current * 31 + character.charCodeAt(0)) >>> 0,
    0
  );
  return futureProviderColors[hash % futureProviderColors.length] ?? '#8ca0b8';
};

type ProviderProgressStyle = CSSProperties & { '--source-progress-color': string };

const providerProgressStyle = (
  provider: FluxoraFluxPackProviderProgress,
  includeWeight: boolean
): ProviderProgressStyle => ({
  '--source-progress-color': providerProgressColor(provider.providerId),
  ...(includeWeight ? { flexGrow: Math.max(1, provider.totalCount) } : {})
});

const FluxPackSourceProgress = ({
  label,
  percent,
  providers
}: FluxPackSourceProgressProps) => {
  const { t } = useLocalization();
  return (
    <div className="fluxpack-source-progress">
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className="fluxpack-source-progress__sectors"
      role="progressbar"
    >
      {providers.map((provider) => (
        <span
          aria-label={`${provider.displayName}: ${provider.progressPercent}%`}
          className="fluxpack-source-progress__segment"
          data-provider={providerDataId(provider.providerId)}
          key={provider.providerId}
          style={providerProgressStyle(provider, true)}
          title={`${provider.displayName}: ${provider.completedCount} / ${provider.totalCount}`}
        >
          <span style={{ width: `${Math.max(0, Math.min(100, provider.progressPercent))}%` }} />
        </span>
      ))}
    </div>
    <strong className="fluxpack-source-progress__percent">{percent}%</strong>
    <div className="fluxpack-source-progress__legend" aria-label={t('operation.sources')}>
      {providers.map((provider) => (
        <span
          data-provider={providerDataId(provider.providerId)}
          key={provider.providerId}
          style={providerProgressStyle(provider, false)}
        >
          <i aria-hidden="true" />
          {provider.displayName}
          <strong>{provider.completedCount} / {provider.totalCount}</strong>
        </span>
      ))}
    </div>
    </div>
  );
};

export const OperationOverlay = ({
  cancellationSupported,
  onCancel,
  onClose,
  overlay
}: OperationOverlayProps) => {
  const { t } = useLocalization();
  if (!overlay) {
    return null;
  }

  const isIndeterminate =
    overlay.isRunning && overlay.percent === null && overlay.kind !== 'fluxpack-export';
  const percent = Math.max(0, Math.min(100, overlay.percent ?? 0));
  const tone = operationOverlayTone(overlay);
  const progressLabel = isIndeterminate ? t('operation.waiting') : `${percent}%`;
  const showProviderProgress =
    overlay.kind === 'fluxpack-install' && Boolean(overlay.providers?.length);
  const stepText =
    overlay.errorText || overlay.resultText || overlay.statusText || t('operation.preparing');
  const showCurrentItemDetail = !(overlay.kind === 'build-delete' && tone === 'running');
  const detailText = showCurrentItemDetail ? overlay.currentItem || overlay.title : null;
  const canCancelBuildCreate =
    overlay.kind === 'build-create' && (overlay.isRunning || overlay.createdProject !== null);
  const canCancelGrassCache = overlay.kind === 'grass-cache' && overlay.isRunning;
  const canCancelNativeOperation =
    overlay.isRunning && (cancellationSupported || canCancelGrassCache);
  const showCancel = canCancelBuildCreate || canCancelNativeOperation;
  const cancelDisabled = overlay.cancelRequested && overlay.isRunning;
  const showClose = overlay.canClose && !showCancel;

  const isDeletionSplash = tone === 'running' && overlay.kind === 'download-delete';

  if (isDeletionSplash) {
    return (
      <LoadingSplash
        aria-label={overlay.title}
        className={`operation-overlay operation-overlay--loading-splash operation-overlay--${overlay.kind}`}
        data-state={tone}
        detail={t('operation.deletingDownload')}
        messages={[overlay.title]}
        open
        progress={percent}
        subtitle=""
        title={overlay.title}
      />
    );
  }

  return (
    <div
      aria-label={overlay.title}
      className="operation-overlay"
      data-state={tone}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <div className="operation-overlay__panel">
        {showCancel || showClose ? (
          <div className="operation-splash__topline">
            {showCancel ? (
              <button
                className="operation-splash__action operation-splash__action--cancel"
                disabled={cancelDisabled}
                onClick={onCancel}
                type="button"
              >
                {t('operation.cancel')}
              </button>
            ) : showClose ? (
              <button className="operation-splash__action" onClick={onClose} type="button">
                {t('operation.close')}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="operation-splash__hero">
          <span className="operation-splash__spinner" aria-hidden="true">
            {tone === 'complete' ? (
              <CheckCircle2 size={30} />
            ) : tone === 'error' ? (
              <AlertTriangle size={30} />
            ) : (
              <FacetSpinner size={58} />
            )}
          </span>
          <div className="operation-splash__copy">
            <h2>{overlay.title}</h2>
            {detailText ? <p>{detailText}</p> : null}
          </div>
        </div>

        <div className="operation-progress">
          {showProviderProgress ? (
            <FluxPackSourceProgress
              label={t('operation.progress', { title: overlay.title })}
              percent={percent}
              providers={overlay.providers ?? []}
            />
          ) : (
            <ProgressBar
              aria-label={t('operation.progress', { title: overlay.title })}
              className={`operation-progress__bar${isIndeterminate ? '' : ' operation-progress__bar--percent'}`}
              indeterminate={isIndeterminate}
              value={percent}
              valueLabel={progressLabel}
            />
          )}
          <div className="operation-splash__step">
            <span>{t('operation.now')}</span>
            <strong>{stepText}</strong>
          </div>
        </div>
      </div>
    </div>
  );
};
