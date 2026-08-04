import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

import type { TranslationKey } from '../../../localization';
import { useLocalization } from '../../../localization/react';
import { cx } from './utils';

export type CardVariant = 'panel' | 'raised' | 'soft' | 'inset' | 'hero';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  border?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  variant?: CardVariant;
}

export function Card({
  border = true,
  className,
  padding = 'md',
  variant = 'panel',
  ...rest
}: CardProps) {
  return (
    <div
      className={cx('flx-card', className)}
      data-border={border || undefined}
      data-padding={padding}
      data-variant={variant}
      {...rest}
    />
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'error' | 'on' | 'off';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  icon?: ReactNode;
  tone?: BadgeTone;
}

export function Badge({ children, className, icon, tone = 'neutral', ...rest }: BadgeProps) {
  return (
    <span className={cx('flx-badge', className)} data-tone={tone} {...rest}>
      {icon ? <span className="flx-badge__icon">{icon}</span> : null}
      {children}
    </span>
  );
}

export type StatusDotState =
  | 'none'
  | 'overwrites'
  | 'overwritten'
  | 'mixed'
  | 'fully-overwritten';

const STATUS_LABEL_KEYS: Record<StatusDotState, TranslationKey> = {
  none: 'status.overwrite.none',
  overwritten: 'status.overwrite.overwritten',
  overwrites: 'status.overwrite.overwrites',
  mixed: 'status.overwrite.mixed',
  'fully-overwritten': 'status.overwrite.fully'
};

const STATUS_ICON_URLS: Record<StatusDotState, string | null> = {
  none: null,
  overwritten: new URL('../../../../../Icons/conflict-overwritten-minus.svg', import.meta.url).href,
  overwrites: new URL('../../../../../Icons/conflict-overwrites-plus.svg', import.meta.url).href,
  mixed: new URL('../../../../../Icons/conflict-overwrites-plus.svg', import.meta.url).href,
  'fully-overwritten': new URL('../../../../../Icons/conflict-fully-overwritten-dot.svg', import.meta.url).href
};

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  label?: string;
  size?: number;
  state?: StatusDotState;
}

export function StatusDot({
  className,
  label,
  size = 22,
  state = 'overwrites',
  style,
  title,
  ...rest
}: StatusDotProps) {
  const { t } = useLocalization();
  const accessibleLabel = label ?? t(STATUS_LABEL_KEYS[state]);
  const iconUrl = STATUS_ICON_URLS[state];
  const mergedStyle: CSSProperties & {
    '--flx-status-icon'?: string;
    '--flx-status-size': string;
  } = {
    '--flx-status-size': `${size}px`,
    ...(iconUrl ? { '--flx-status-icon': `url("${iconUrl}")` } : {}),
    ...style
  };

  return (
    <span
      aria-label={accessibleLabel}
      className={cx('flx-status-dot', className)}
      data-state={state}
      role="img"
      style={mergedStyle}
      title={title ?? accessibleLabel}
      {...rest}
    >
      {iconUrl ? <span className="flx-status-dot__icon" aria-hidden="true" /> : null}
    </span>
  );
}

export interface SectionLabelProps extends HTMLAttributes<HTMLDivElement> {}

export function SectionLabel({ className, ...rest }: SectionLabelProps) {
  return <div className={cx('flx-section-label', className)} {...rest} />;
}
