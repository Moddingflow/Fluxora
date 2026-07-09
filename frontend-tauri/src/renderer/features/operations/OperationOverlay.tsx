import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { FacetSpinner, LoadingSplash, ProgressBar } from '../../design-system';
import type { FluxoraProject } from '../../../shared/fluxora-api';

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

export const OperationOverlay = ({
  cancellationSupported,
  onCancel,
  onClose,
  overlay
}: OperationOverlayProps) => {
  if (!overlay) {
    return null;
  }

  const isIndeterminate = overlay.isRunning && overlay.percent === null;
  const percent = Math.max(0, Math.min(100, overlay.percent ?? 0));
  const tone = operationOverlayTone(overlay);
  const progressLabel = isIndeterminate ? 'Waiting for progress' : `${percent}%`;
  const stepText =
    overlay.errorText || overlay.resultText || overlay.statusText || 'Preparing operation';
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
        detail="Удаление файла из загрузок"
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
        <div className="operation-splash__topline">
          <span>Operation</span>
          {showCancel ? (
            <button
              className="operation-splash__action operation-splash__action--cancel"
              disabled={cancelDisabled}
              onClick={onCancel}
              type="button"
            >
              Отменить
            </button>
          ) : showClose ? (
            <button className="operation-splash__action" onClick={onClose} type="button">
              Закрыть
            </button>
          ) : null}
        </div>

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
          <ProgressBar
            aria-label={`${overlay.title} progress`}
            className={`operation-progress__bar${isIndeterminate ? '' : ' operation-progress__bar--percent'}`}
            indeterminate={isIndeterminate}
            value={percent}
            valueLabel={progressLabel}
          />
          <div className="operation-splash__step">
            <span>Current step</span>
            <strong>{stepText}</strong>
          </div>
        </div>
      </div>
    </div>
  );
};
