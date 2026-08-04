import { ProgressBar } from '../../renderer/design-system/primitives';

import './update-stage-progress-panel.css';

export interface UpdateStageProgressPanelProps {
  currentVersion?: string;
  downloadLabel: string;
  downloadMeta: string;
  downloadPercent: number;
  installLabel: string;
  installMeta: string;
  installPercent: number;
  status: string;
  targetVersion?: string;
  title: string;
}

const boundedPercent = (value: number): number =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

export function UpdateStageProgressPanel({
  currentVersion,
  downloadLabel,
  downloadMeta,
  downloadPercent,
  installLabel,
  installMeta,
  installPercent,
  status,
  targetVersion,
  title
}: UpdateStageProgressPanelProps) {
  const download = boundedPercent(downloadPercent);
  const install = boundedPercent(installPercent);

  return (
    <section aria-label={title} className="update-stage-progress">
      <header className="update-stage-progress__heading">
        <div>
          <h1>{title}</h1>
          <p aria-live="polite" role="status">{status}</p>
        </div>
        {currentVersion && targetVersion ? (
          <p className="update-stage-progress__versions">
            <span>{currentVersion}</span>
            <span aria-hidden="true">→</span>
            <span>{targetVersion}</span>
          </p>
        ) : null}
      </header>
      <div className="update-stage-progress__stages">
        <div className="update-stage-progress__stage" data-stage-state={download >= 100 ? 'complete' : 'active'}>
          <div className="update-stage-progress__label">
            <strong>{downloadLabel}</strong>
            <span>{downloadMeta}</span>
            <output>{Math.round(download)}%</output>
          </div>
          <ProgressBar
            aria-label={downloadLabel}
            value={download}
          />
        </div>
        <div className="update-stage-progress__stage" data-stage-state={install > 0 ? 'active' : 'pending'}>
          <div className="update-stage-progress__label">
            <strong>{installLabel}</strong>
            <span>{installMeta}</span>
            <output>{Math.round(install)}%</output>
          </div>
          <ProgressBar
            aria-label={installLabel}
            value={install}
          />
        </div>
      </div>
    </section>
  );
}
