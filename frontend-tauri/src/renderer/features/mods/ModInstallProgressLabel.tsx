import { memo } from 'react';

import {
  installProgressLabel,
  useInstallProgress,
  type InstallProgressStore
} from './install-progress-store';
import { recordListPerformanceRowCommit } from '../../performance/list-performance-benchmark';
import { useLocalization } from '../../../localization/react';

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
  const { locale } = useLocalization();
  const progress = useInstallProgress(progressStore, operationId);

  if (progress.state === 'needsReview') {
    return null;
  }

  const label = progress.operation
    ? installProgressLabel(progress.operation, locale) || fallbackLabel
    : fallbackLabel;
  return <span className="mod-install-pending-label">{label}</span>;
});

ModInstallProgressLabel.displayName = 'ModInstallProgressLabel';
