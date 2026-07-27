import { memo } from 'react';

import type { FluxoraInstallOperation } from '../../../shared/fluxora-api';
import {
  useInstallProgress,
  type InstallProgressStore
} from './install-progress-store';
import { recordListPerformanceRowCommit } from '../../performance/list-performance-benchmark';

interface ModInstallProgressLabelProps {
  fallbackLabel: string;
  operationId: string;
  orderId: string;
  progressStore: InstallProgressStore;
  onNeedsReview: (operation: FluxoraInstallOperation) => void;
}

export const ModInstallProgressLabel = memo(({
  fallbackLabel,
  operationId,
  orderId,
  progressStore,
  onNeedsReview
}: ModInstallProgressLabelProps) => {
  recordListPerformanceRowCommit('mods', orderId);
  const progress = useInstallProgress(progressStore, operationId);
  const label = progress.label || fallbackLabel;

  if (progress.state === 'needsReview' && progress.operation) {
    return (
      <button
        className="mod-install-pending-label mod-install-pending-label--action"
        type="button"
        title="Повторно проверить установщик"
        onClick={(event) => {
          event.stopPropagation();
          onNeedsReview(progress.operation!);
        }}
      >
        {label}
      </button>
    );
  }

  return <span className="mod-install-pending-label">{label}</span>;
});

ModInstallProgressLabel.displayName = 'ModInstallProgressLabel';
