import { useEffect, useMemo, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';

import { cx } from './utils';

export type SkeletonProps = HTMLAttributes<HTMLSpanElement>;

export function Skeleton({
  'aria-hidden': ariaHidden = true,
  className,
  ...rest
}: SkeletonProps) {
  return (
    <span
      aria-hidden={ariaHidden}
      className={cx('flx-skeleton', className)}
      {...rest}
    />
  );
}

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
  stroke = 6,
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

export interface LoadingSplashProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onCancel' | 'title'> {
  appName?: string;
  buildName?: string;
  cancelLabel?: ReactNode;
  cancelTitle?: string;
  detail?: ReactNode;
  indeterminate?: boolean;
  messageIntervalMs?: number;
  messages?: ReadonlyArray<ReactNode>;
  onCancel?: () => void;
  open?: boolean;
  progress?: number;
  state?: 'starting' | 'running';
  subtitle?: ReactNode;
  title?: ReactNode;
}

export function LoadingSplash({
  appName,
  buildName,
  cancelLabel = 'Cancel',
  cancelTitle,
  className,
  detail,
  indeterminate = false,
  messageIntervalMs = 5000,
  messages,
  onCancel,
  open = true,
  progress = 0,
  state = 'starting',
  subtitle,
  title,
  ...rest
}: LoadingSplashProps) {
  const isStarting = state === 'starting';
  const progressValue = clampProgress(progress);
  const resolvedTitle = title ?? (isStarting ? 'Launching build' : 'Build is running');
  const resolvedSubtitle =
    subtitle ??
    (isStarting
      ? (detail ??
        (buildName
          ? `Preparing ${buildName}.`
          : 'The native core is preparing the build.'))
      : appName
        ? `Close ${appName} to return to Fluxora.`
        : 'Close the launched app to return to Fluxora.');
  const messageItems = useMemo(() => {
    const source = messages?.length ? messages : [resolvedTitle];
    return source.filter(Boolean);
  }, [messages, resolvedTitle]);
  const [messageIndex, setMessageIndex] = useState(0);
  const activeMessage = messageItems[messageIndex % Math.max(1, messageItems.length)] ?? resolvedTitle;
  const percentLabel = indeterminate ? '...' : `${Math.round(progressValue)}%`;

  useEffect(() => {
    setMessageIndex(0);
  }, [open, messageItems.length]);

  useEffect(() => {
    if (!open || messageItems.length < 2 || messageIntervalMs <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % messageItems.length);
    }, messageIntervalMs);

    return () => window.clearInterval(timer);
  }, [messageIntervalMs, messageItems.length, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cx('flx-loading-splash', className)}
      role="status"
      {...rest}
    >
      {onCancel ? (
        <button
          className="flx-loading-splash__cancel"
          title={cancelTitle ?? (typeof cancelLabel === 'string' ? cancelLabel : undefined)}
          type="button"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
      ) : null}
      <div className="flx-loading-splash__panel">
        <FacetSpinner />
        <div className="flx-loading-splash__copy">
          <strong key={messageIndex} className="flx-loading-splash__message">
            {activeMessage}
          </strong>
          {resolvedSubtitle ? <span>{resolvedSubtitle}</span> : null}
        </div>
        {isStarting ? (
          <div className="flx-loading-splash__progress">
            <ProgressBar
              aria-label={typeof detail === 'string' ? detail : 'Loading progress'}
              indeterminate={indeterminate}
              value={progressValue}
            />
            <strong className="flx-loading-splash__percent">{percentLabel}</strong>
          </div>
        ) : null}
      </div>
    </div>
  );
}
