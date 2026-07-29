import { memo } from 'react';

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
}

export const ModInstallProgressLabel = memo(({
  fallbackLabel,
  operationId,
  orderId,
  progressStore
}: ModInstallProgressLabelProps) => {
  recordListPerformanceRowCommit('mods', orderId);
  const progress = useInstallProgress(progressStore, operationId);

  if (progress.state === 'needsReview') {
    return null;
  }

  const label = progress.label || fallbackLabel;
  return <span className="mod-install-pending-label">{label}</span>;
});

ModInstallProgressLabel.displayName = 'ModInstallProgressLabel';
