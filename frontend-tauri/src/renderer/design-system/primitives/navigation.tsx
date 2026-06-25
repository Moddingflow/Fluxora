import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

import { cx } from './utils';

export interface TabItem {
  count?: number;
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  value: string;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  ariaLabel?: string;
  onValueChange?: (value: string) => void;
  tabs: readonly TabItem[];
  value?: string;
}

export function Tabs({
  ariaLabel = 'Sections',
  className,
  onValueChange,
  tabs,
  value,
  ...rest
}: TabsProps) {
  return (
    <div aria-label={ariaLabel} className={cx('flx-tabs', className)} role="tablist" {...rest}>
      {tabs.map((tab) => {
        const active = tab.value === value;

        return (
          <button
            aria-selected={active}
            className="flx-tabs__tab"
            data-active={active || undefined}
            disabled={tab.disabled}
            key={tab.value}
            onClick={() => onValueChange?.(tab.value)}
            role="tab"
            type="button"
          >
            {tab.icon ? <span className="flx-tabs__icon">{tab.icon}</span> : null}
            <span className="flx-tabs__label">{tab.label}</span>
            {tab.count != null ? <span className="flx-tabs__count">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface NavItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  hint?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
}

export function NavItem({
  active = false,
  className,
  hint,
  icon,
  label,
  type = 'button',
  ...rest
}: NavItemProps) {
  return (
    <button
      className={cx('flx-nav-item', className)}
      data-active={active || undefined}
      type={type}
      {...rest}
    >
      <span aria-hidden="true" className="flx-nav-item__rail" />
      {icon ? <span className="flx-nav-item__icon">{icon}</span> : null}
      <span className="flx-nav-item__copy">
        <span className="flx-nav-item__label">{label}</span>
        {hint ? <span className="flx-nav-item__hint">{hint}</span> : null}
      </span>
    </button>
  );
}
