import { ProgressBar } from '../../renderer/design-system/primitives';
import type { InstallerLanguage } from '../contracts';

import './installer-progress-panel.css';

const formatBytes = (bytes: number, language: InstallerLanguage): string => {
  if (bytes <= 0) {
    return '0 MB';
  }
  const unit = bytes >= 1024 ** 3 ? 'gigabyte' : 'megabyte';
  const divisor = unit === 'gigabyte' ? 1024 ** 3 : 1024 ** 2;
  return new Intl.NumberFormat(language, {
    maximumFractionDigits: 1,
    style: 'unit',
    unit,
    unitDisplay: 'short'
  }).format(bytes / divisor);
};

export interface InstallerProgressPanelProps {
  busy: boolean;
  currentVersion?: string;
  downloadedBytes?: number;
  language: InstallerLanguage;
  phase: string;
  percent?: number;
  status: string;
  targetVersion?: string;
  title: string;
  totalBytes?: number;
}

export function InstallerProgressPanel({
  busy,
  currentVersion,
  downloadedBytes = 0,
  language,
  phase,
  percent,
  status,
  targetVersion,
  title,
  totalBytes = 0
}: InstallerProgressPanelProps) {
  const determinate = typeof percent === 'number' && totalBytes > 0;
  const valueLabel = determinate ? `${Math.round(percent)}%` : undefined;

  return (
    <section aria-busy={busy} className="installer-progress-panel">
      <header className="installer-progress-panel__heading">
        <h1>{title}</h1>
        {currentVersion && targetVersion ? (
          <p className="installer-progress-panel__versions">
            <span>{currentVersion}</span>
            <span aria-hidden="true">→</span>
            <span>{targetVersion}</span>
          </p>
        ) : null}
      </header>
      <div aria-live="polite" className="installer-progress-panel__status" role="status">
        <strong>{status}</strong>
        {determinate ? (
          <span>
            {valueLabel}
            {' · '}
            {formatBytes(downloadedBytes, language)} / {formatBytes(totalBytes, language)}
          </span>
        ) : null}
      </div>
      <ProgressBar
        aria-label={status}
        indeterminate={!determinate}
        value={percent ?? 0}
        valueLabel={valueLabel}
      />
      <p className="installer-progress-panel__phase">{phase}</p>
    </section>
  );
}
