import { modOrganizerIcon } from './design-system/assets';

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
  const disabledReason = !bridgeReady
    ? 'Native bridge is not ready'
    : !transferAvailable
      ? 'MO2 transfer is unavailable'
      : isRunning
        ? 'MO2 transfer is already running'
        : busyLabel ?? 'Open transfer flow';

  return (
    <div className="settings-panel settings-panel--transfer" aria-label="Mod Organizer transfer settings">
      <div className="settings-connections-list">
        <div
          className="settings-service-row settings-service-row--connection settings-service-row--transfer"
          data-status={disabled ? 'checking' : 'ready'}
        >
          <div className="settings-service-main" aria-label="Mod Organizer 2">
            <span className="settings-service-icon settings-service-icon--mo2" aria-hidden="true">
              <img src={modOrganizerIcon} alt="" draggable={false} />
            </span>
            <span className="settings-service-copy">
              <strong>Mod Organizer 2</strong>
            </span>
          </div>
          <button
            className="primary-button settings-transfer-button"
            type="button"
            aria-busy={isRunning || Boolean(busyLabel)}
            aria-label="Перенести сборку из Mod Organizer 2"
            disabled={disabled}
            title={disabled ? disabledReason : 'Перенести сборку из Mod Organizer 2'}
            onClick={onOpenTransfer}
          >
            Перенести
          </button>
        </div>
      </div>
    </div>
  );
};
