import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { Icon } from '../../design-system';

export interface ExecutableIdentityProps {
  className?: string;
  displayName: string;
  iconPath: string;
  secondaryText?: string;
  size?: 20 | 24;
}

export function ExecutableIdentity({
  className = '',
  displayName,
  iconPath,
  secondaryText,
  size = 20
}: ExecutableIdentityProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const iconUrl = useMemo(() => {
    if (!iconPath.trim()) {
      return '';
    }
    if (typeof window === 'undefined' || !window.fluxora) {
      return iconPath;
    }
    return window.fluxora.executables.toIconUrl(iconPath);
  }, [iconPath]);

  useEffect(() => {
    setImageFailed(false);
  }, [iconUrl]);

  const style = {
    '--executable-identity-size': `${size}px`
  } as CSSProperties;

  return (
    <span
      className={`executable-identity${className ? ` ${className}` : ''}`}
      style={style}
    >
      <span className="executable-identity__icon" aria-hidden="true">
        {iconUrl && !imageFailed ? (
          <img alt="" draggable="false" onError={() => setImageFailed(true)} src={iconUrl} />
        ) : (
          <Icon name="app-window" size={size} />
        )}
      </span>
      <span className="executable-identity__copy">
        <strong>{displayName}</strong>
        {secondaryText ? <span title={secondaryText}>{secondaryText}</span> : null}
      </span>
    </span>
  );
}
