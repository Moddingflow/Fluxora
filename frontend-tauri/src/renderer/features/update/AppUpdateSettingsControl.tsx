import { RefreshCw } from '../../design-system/icons/lucide-compat';
import type { AppUpdateSettingsViewState } from './app-update-state';

export interface AppUpdateSettingsControlProps {
  update: AppUpdateSettingsViewState;
}

export function AppUpdateSettingsControl({ update }: AppUpdateSettingsControlProps) {
  const checking = update.state === 'checking';
  const busy = update.state === 'busy';
  const summary = (() => {
    switch (update.state) {
      case 'checking':
        return 'Проверка обновлений…';
      case 'upToDate':
        return `Установлена последняя версия ${update.currentVersion}`;
      case 'available':
        return `Доступна версия ${update.availableVersion ?? 'новее установленной'}`;
      case 'busy':
        return `Обновление ${update.availableVersion ?? ''} выполняется`.trim();
      case 'error':
        return update.errorMessage ?? 'Не удалось проверить обновления';
      case 'idle':
      default:
        return `Установлена версия ${update.currentVersion || '—'}`;
    }
  })();
  const actionLabel = update.state === 'error' ? 'Повторить проверку' : 'Проверить обновления';

  return (
    <div
      className="settings-service-row settings-service-row--connection settings-service-row--app-update"
      data-status={update.state}
    >
      <div className="settings-service-main">
        <span className="settings-service-icon" aria-hidden="true">
          <RefreshCw size={20} />
        </span>
        <span className="settings-service-copy">
          <strong>Обновления Fluxora</strong>
          <span aria-live={update.state === 'error' ? 'assertive' : 'polite'}>{summary}</span>
        </span>
      </div>
      <button
        className="secondary-button"
        disabled={checking || busy}
        type="button"
        onClick={() => void update.onCheck()}
      >
        {checking ? 'Проверка…' : actionLabel}
      </button>
    </div>
  );
}
