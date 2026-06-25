import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

import { cx } from './utils';

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  height?: number;
  indeterminate?: boolean;
  label?: ReactNode;
  value?: number;
  valueLabel?: ReactNode;
}

const clampProgress = (value: number | undefined) =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value ?? 0 : 0));

export function ProgressBar({
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  className,
  height = 8,
  indeterminate = false,
  label,
  style,
  value = 0,
  valueLabel,
  ...rest
}: ProgressBarProps) {
  const progress = clampProgress(value);
  const mergedStyle: CSSProperties & Record<'--flx-progress-height' | '--flx-progress-value', string> = {
    '--flx-progress-height': `${height}px`,
    '--flx-progress-value': `${progress}%`,
    ...style
  };

  return (
    <div className={cx('flx-progress', className)} style={mergedStyle} {...rest}>
      {label || valueLabel ? (
        <div className="flx-progress__meta">
          {label ? <span>{label}</span> : <span />}
          {valueLabel ? <strong>{valueLabel}</strong> : null}
        </div>
      ) : null}
      <div
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={indeterminate ? undefined : progress}
        className="flx-progress__track"
        data-indeterminate={indeterminate || undefined}
        role="progressbar"
      >
        <span className="flx-progress__bar" />
      </div>
    </div>
  );
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  action?: ReactNode;
  compact?: boolean;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
  tone?: 'neutral' | 'error' | 'loading';
}

export function EmptyState({
  action,
  className,
  compact = false,
  description,
  icon,
  title,
  tone = 'neutral',
  ...rest
}: EmptyStateProps) {
  return (
    <div
      className={cx('flx-empty-state', className)}
      data-compact={compact || undefined}
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      {...rest}
    >
      {icon ? <span className="flx-empty-state__icon">{icon}</span> : null}
      <strong>{title}</strong>
      {description ? <span className="flx-empty-state__description">{description}</span> : null}
      {action ? <span className="flx-empty-state__action">{action}</span> : null}
    </div>
  );
}

export interface FacetSpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: number;
  stroke?: number;
}

export function FacetSpinner({
  className,
  size = 56,
  stroke = 4,
  style,
  ...rest
}: FacetSpinnerProps) {
  const center = size / 2;
  const radius = center - stroke;
  const circumference = 2 * Math.PI * radius;
  const mergedStyle: CSSProperties & Record<'--flx-spinner-size', string> = {
    '--flx-spinner-size': `${size}px`,
    ...style
  };

  return (
    <span
      aria-hidden="true"
      className={cx('flx-facet-spinner', className)}
      style={mergedStyle}
      {...rest}
    >
      <svg height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
        <circle
          className="flx-facet-spinner__track"
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          strokeWidth={stroke}
        />
        <circle
          className="flx-facet-spinner__arc"
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          strokeDasharray={`${circumference * 0.3} ${circumference}`}
          strokeWidth={stroke}
        />
      </svg>
    </span>
  );
}

export interface LoadingSplashProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  appName?: string;
  buildName?: string;
  detail?: ReactNode;
  indeterminate?: boolean;
  open?: boolean;
  progress?: number;
  state?: 'starting' | 'running';
  subtitle?: ReactNode;
  title?: ReactNode;
}

export function LoadingSplash({
  appName,
  buildName,
  className,
  detail,
  indeterminate = false,
  open = true,
  progress = 0,
  state = 'starting',
  subtitle,
  title,
  ...rest
}: LoadingSplashProps) {
  if (!open) {
    return null;
  }

  const isStarting = state === 'starting';
  const progressValue = clampProgress(progress);
  const resolvedTitle = title ?? (isStarting ? 'Launching build' : 'Build is running');
  const resolvedSubtitle =
    subtitle ??
    (isStarting
      ? buildName
        ? `Preparing ${buildName}.`
        : 'The native core is preparing the build.'
      : appName
        ? `Close ${appName} to return to Fluxora.`
        : 'Close the launched app to return to Fluxora.');

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cx('flx-loading-splash', className)}
      role="status"
      {...rest}
    >
      <div className="flx-loading-splash__panel">
        <FacetSpinner />
        <div className="flx-loading-splash__copy">
          <strong>{resolvedTitle}</strong>
          {resolvedSubtitle ? <span>{resolvedSubtitle}</span> : null}
        </div>
        {isStarting ? (
          <ProgressBar
            indeterminate={indeterminate}
            label={detail ?? 'Preparing build'}
            value={progressValue}
            valueLabel={indeterminate ? 'Working' : `${Math.round(progressValue)}%`}
          />
        ) : (
          <span className="flx-loading-splash__lock">Screen locked</span>
        )}
      </div>
    </div>
  );
}
