import type { CSSProperties } from 'react';

import updateIcon from '../../../../../Icons/hard-drive-download.svg';
import { useLocalization } from '../../../localization/react';
import type { AppUpdateToolbarViewState } from './app-update-state';

export interface AppUpdateToolbarButtonProps {
  update: AppUpdateToolbarViewState;
}

export function AppUpdateToolbarButton({ update }: AppUpdateToolbarButtonProps) {
  const { t } = useLocalization();
  if (update.state === 'hidden') {
    return null;
  }

  const label = (() => {
    switch (update.state) {
      case 'available':
        return t('update.available', { version: update.version });
      case 'error':
        return update.retryable
          ? t('update.errorRetry', { version: update.version, error: update.errorMessage })
          : t('update.errorNoRetry', { version: update.version, error: update.errorMessage });
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
      aria-invalid={update.state === 'error' || undefined}
      aria-label={label}
      className="titlebar__shortcut titlebar__shortcut--update"
      data-update-control
      data-update-state={update.state}
      title={tooltip}
      type="button"
      onClick={() => {
        if ('onActivate' in update) void update.onActivate();
      }}
    >
      {icon}
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
