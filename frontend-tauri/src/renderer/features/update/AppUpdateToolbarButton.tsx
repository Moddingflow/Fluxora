import type { CSSProperties } from 'react';

import updateIcon from '../../../../../Icons/hard-drive-download.svg';
import type { AppUpdateToolbarViewState } from './app-update-state';

export interface AppUpdateToolbarButtonProps {
  update: AppUpdateToolbarViewState;
}

export function AppUpdateToolbarButton({ update }: AppUpdateToolbarButtonProps) {
  if (update.state === 'hidden') {
    return null;
  }

  const progressPercent = 'progressPercent' in update
    ? Math.max(0, Math.min(100, Math.round(update.progressPercent)))
    : undefined;
  const isBusy = update.state === 'downloading'
    || update.state === 'waitingForOperations'
    || update.state === 'readyToInstall'
    || update.state === 'launchingUpdater';
  const cancellable = update.state === 'downloading'
    || update.state === 'waitingForOperations'
    || update.state === 'readyToInstall';
  const disabled = update.state === 'launchingUpdater';
  const label = (() => {
    switch (update.state) {
      case 'available':
        return `Скачать и установить обновление Fluxora ${update.version}`;
      case 'downloading':
        return `Загрузка обновления Fluxora ${update.version}: ${progressPercent}%. Отменить`;
      case 'waitingForOperations':
        return `Обновление Fluxora ${update.version} ожидает завершения операций. Отменить`;
      case 'readyToInstall':
        return `Обновление Fluxora ${update.version} готово к установке. Отменить`;
      case 'launchingUpdater':
        return `Запускается установка обновления Fluxora ${update.version}`;
      case 'error':
        return update.retryable
          ? `Не удалось установить обновление Fluxora ${update.version}. ${update.errorMessage}. Повторить`
          : `Не удалось установить обновление Fluxora ${update.version}. ${update.errorMessage}. Повтор недоступен`;
    }
  })();
  const tooltip = label;
  const icon = (
    <span
      aria-hidden="true"
      className="titlebar__update-icon"
      style={{
        maskImage: `url("${updateIcon}")`,
        WebkitMaskImage: `url("${updateIcon}")`
      } as CSSProperties}
    />
  );

  if (update.state === 'error' && !update.retryable) {
    return (
      <div
        aria-label={label}
        className="titlebar__shortcut titlebar__shortcut--update"
        data-update-control
        data-update-state={update.state}
        role="alert"
        tabIndex={0}
        title={tooltip}
      >
        {icon}
        <span className="titlebar__update-live">{label}</span>
      </div>
    );
  }

  return (
    <button
      aria-busy={isBusy || undefined}
      aria-invalid={update.state === 'error' || undefined}
      aria-label={label}
      className="titlebar__shortcut titlebar__shortcut--update"
      data-update-control
      data-update-progress={progressPercent}
      data-update-state={update.state}
      disabled={disabled}
      title={tooltip}
      type="button"
      onClick={() => {
        if (cancellable) void update.onCancel();
        else if ('onActivate' in update) void update.onActivate();
      }}
    >
      {icon}
      {update.state === 'downloading' ? (
        <span aria-hidden="true" className="titlebar__update-progress">
          <span style={{ width: `${progressPercent}%` }} />
        </span>
      ) : null}
      {update.state !== 'available' ? (
        <span
          aria-live={update.state === 'error' ? 'assertive' : 'polite'}
          className="titlebar__update-live"
          role={update.state === 'error' ? 'alert' : 'status'}
        >
          {label}
        </span>
      ) : null}
    </button>
  );
}
