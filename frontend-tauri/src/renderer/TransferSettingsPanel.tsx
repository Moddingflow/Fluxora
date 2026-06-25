import { ArrowRight, UploadCloud } from 'lucide-react';

import { ProgressBar } from './design-system';
import { modOrganizerIcon } from './design-system/assets';
import {
  transferSettingsProgressPercent,
  transferSettingsSummary
} from './settings-workspace-state';
import type {
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportProgress,
  FluxoraProject
} from '../shared/fluxora-api';

export type TransferMode = 'create' | 'replace';
export type TransferStepId = 'source' | 'destination' | 'review';

interface TransferSettingsPanelProps {
  bridgeReady: boolean;
  transferAvailable: boolean;
  busyLabel: string | null;
  isRunning: boolean;
  cancellationSupported: boolean;
  cancelRequested: boolean;
  analysis: FluxoraModOrganizerImportAnalysis | null;
  progress: FluxoraModOrganizerImportProgress | null;
  error: string | null;
  result: FluxoraProject | null;
  onOpenTransfer: () => void;
  onCancel: () => void;
}

export const TransferSettingsPanel = ({
  bridgeReady,
  transferAvailable,
  busyLabel,
  isRunning,
  cancellationSupported,
  cancelRequested,
  analysis,
  progress,
  error,
  result,
  onOpenTransfer,
  onCancel
}: TransferSettingsPanelProps) => {
  const disabled = isRunning || Boolean(busyLabel) || !bridgeReady || !transferAvailable;
  const percent = transferSettingsProgressPercent(progress, result);
  const summary = transferSettingsSummary(progress, result, error);
  const hasProgress = percent !== null || isRunning || Boolean(result);
  const sourceLabel = analysis?.sourceDirectory || 'Choose the MO2 instance in the transfer flow';
  const targetLabel = analysis?.targetProjectDirectory || 'Fluxora will verify the target path first';

  return (
    <div className="settings-panel transfer-entry-panel" aria-label="Mod Organizer transfer settings">
      <div className="settings-card settings-card--transfer">
        <div className="settings-card__header">
          <div className="settings-service-main">
            <span className="settings-service-icon settings-service-icon--mo2">
              <img src={modOrganizerIcon} alt="" />
            </span>
            <span className="settings-service-copy">
              <strong>Build transfer</strong>
              <span>Mod Organizer 2</span>
            </span>
          </div>
          <span className="status-pill" data-status={isRunning ? 'checking' : error ? 'error' : 'ready'}>
            {isRunning ? 'Running' : error ? 'Needs attention' : 'Ready'}
          </span>
        </div>

        <p className="settings-card__copy">
          Transfer mods, profiles, load order, and metadata from an existing MO2 build. The source
          MO2 folder stays where it is.
        </p>

        <dl className="settings-facts settings-facts--transfer">
          <div>
            <dt>Source</dt>
            <dd title={sourceLabel}>{sourceLabel}</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd title={targetLabel}>{targetLabel}</dd>
          </div>
        </dl>

        {hasProgress ? (
          <div className="transfer-entry-progress" role="status">
            <div>
              <span>{result ? 'Completed' : isRunning ? 'Operation progress' : 'Last transfer'}</span>
              <strong>{percent ?? 0}%</strong>
            </div>
            <ProgressBar
              aria-label="MO2 transfer progress"
              indeterminate={isRunning && percent === null}
              value={percent ?? 0}
            />
            <small>{summary}</small>
          </div>
        ) : (
          <div className="settings-note" data-status="ready">
            <strong>Native core check</strong>
            <span>The native core verifies the MO2 structure before import starts.</span>
          </div>
        )}

        <div className="settings-actions settings-actions--footer">
          {isRunning ? (
            <button
              className="danger-button"
              type="button"
              disabled={!cancellationSupported || cancelRequested}
              aria-busy={cancelRequested}
              onClick={onCancel}
            >
              {cancelRequested ? 'Cancelling and cleaning' : 'Cancel and clean'}
            </button>
          ) : (
            <button
              className="primary-button transfer-entry-button"
              type="button"
              disabled={disabled}
              onClick={onOpenTransfer}
            >
              <UploadCloud size={16} aria-hidden="true" />
              Start transfer
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
