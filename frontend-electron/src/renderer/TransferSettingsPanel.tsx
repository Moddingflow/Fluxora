import { ArrowRight, UploadCloud } from 'lucide-react';

import modOrganizerIcon from './assets/images/mod-organizer-2.png';

export type TransferMode = 'create' | 'replace';
export type TransferStepId = 'source' | 'destination' | 'review';

interface TransferSettingsPanelProps {
  bridgeReady: boolean;
  transferAvailable: boolean;
  busyLabel: string | null;
  isRunning: boolean;
  onOpenTransfer: () => void;
}

export const TransferSettingsPanel = ({
  bridgeReady,
  transferAvailable,
  busyLabel,
  isRunning,
  onOpenTransfer
}: TransferSettingsPanelProps) => {
  const disabled = isRunning || Boolean(busyLabel) || !bridgeReady || !transferAvailable;

  return (
    <div className="settings-panel transfer-entry-panel" aria-label="Mod Organizer transfer settings">
      <div className="transfer-entry-card">
        <div className="settings-service-main">
          <span className="settings-service-icon settings-service-icon--mo2">
            <img src={modOrganizerIcon} alt="" />
          </span>
          <span className="settings-service-copy">
            <strong>Mod Organizer</strong>
            <span>Перенос копией без изменения оригинальной сборки</span>
          </span>
        </div>
        <button
          className="primary-button transfer-entry-button"
          type="button"
          disabled={disabled}
          onClick={onOpenTransfer}
        >
          <UploadCloud size={16} aria-hidden="true" />
          Перенести
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
