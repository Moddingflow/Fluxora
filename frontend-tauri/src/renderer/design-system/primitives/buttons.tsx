import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx } from './utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm' | 'xs';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  fullWidth?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export function Button({
  children,
  className,
  fullWidth = false,
  iconLeft,
  iconRight,
  size = 'md',
  type = 'button',
  variant = 'primary',
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx('flx-button', className)}
      data-full-width={fullWidth || undefined}
      data-size={size}
      data-variant={variant}
      type={type}
      {...rest}
    >
      {iconLeft ? <span className="flx-button__icon">{iconLeft}</span> : null}
      {children != null ? <span className="flx-button__label">{children}</span> : null}
      {iconRight ? <span className="flx-button__icon">{iconRight}</span> : null}
    </button>
  );
}

export type IconButtonVariant = 'bare' | 'boxed' | 'danger';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> {
  label: string;
  size?: 'md' | 'sm';
  title?: string | null;
  variant?: IconButtonVariant;
}

export function IconButton({
  children,
  className,
  label,
  size = 'md',
  title,
  type = 'button',
  variant = 'bare',
  ...rest
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={cx('flx-icon-button', className)}
      data-size={size}
      data-variant={variant}
      title={title === null ? undefined : title ?? label}
      type={type}
      {...rest}
    >
      {children}
    </button>
  );
}
