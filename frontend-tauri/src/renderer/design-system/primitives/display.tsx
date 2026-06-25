import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

import { Icon } from '../icons';
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

const STATUS_LABELS: Record<StatusDotState, string> = {
  none: 'No overwrite conflicts',
  overwritten: 'Overwritten by others',
  overwrites: 'Overwrites other mods',
  mixed: 'Mixed overwrite conflicts',
  'fully-overwritten': 'Fully overwritten'
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
  const accessibleLabel = label ?? STATUS_LABELS[state];
  const mergedStyle: CSSProperties & Record<'--flx-status-size', string> = {
    '--flx-status-size': `${size}px`,
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
      <Icon
        name={
          state === 'overwrites'
            ? 'conflict-plus'
            : state === 'overwritten'
              ? 'conflict-minus'
              : 'conflict-dot'
        }
        size={Math.round(size * 0.58)}
        strokeWidth={2.2}
      />
    </span>
  );
}

export interface SectionLabelProps extends HTMLAttributes<HTMLDivElement> {}

export function SectionLabel({ className, ...rest }: SectionLabelProps) {
  return <div className={cx('flx-section-label', className)} {...rest} />;
}
