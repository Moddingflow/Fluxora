import { modOrganizerIcon } from './design-system/assets';
import { useLocalization } from '../localization/react';

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
  const { t } = useLocalization();
  const disabled = isRunning || Boolean(busyLabel) || !bridgeReady || !transferAvailable;
  const disabledReason = !bridgeReady
    ? t('transfer.disabled.bridge')
    : !transferAvailable
      ? t('transfer.disabled.unavailable')
      : isRunning
        ? t('transfer.disabled.running')
        : busyLabel ?? t('transfer.disabled.open');

  return (
    <div className="settings-panel settings-panel--transfer" aria-label={t('transfer.settings.aria')}>
      <div className="settings-connections-list">
        <div
          className="settings-service-row settings-service-row--connection settings-service-row--transfer"
          data-status={disabled ? 'checking' : 'ready'}
        >
          <div className="settings-service-main" aria-label={t('transfer.mo2')}>
            <span className="settings-service-icon settings-service-icon--mo2" aria-hidden="true">
              <img src={modOrganizerIcon} alt="" draggable={false} />
            </span>
            <span className="settings-service-copy">
              <strong>{t('transfer.mo2')}</strong>
            </span>
          </div>
          <button
            className="primary-button settings-transfer-button"
            type="button"
            aria-busy={isRunning || Boolean(busyLabel)}
            aria-label={t('transfer.open')}
            disabled={disabled}
            title={disabled ? disabledReason : t('transfer.open')}
            onClick={onOpenTransfer}
          >
            {t('transfer.action')}
          </button>
        </div>
      </div>
    </div>
  );
};
