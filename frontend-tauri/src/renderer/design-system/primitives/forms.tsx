import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes
} from 'react';

import { cx } from './utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
  fullWidth?: boolean;
  invalid?: boolean;
  leadingIcon?: ReactNode;
}

export function Input({
  className,
  containerClassName,
  fullWidth = true,
  invalid = false,
  leadingIcon,
  type = 'text',
  ...rest
}: InputProps) {
  return (
    <span
      className={cx('flx-input', containerClassName)}
      data-full-width={fullWidth || undefined}
      data-invalid={invalid || undefined}
    >
      {leadingIcon ? <span className="flx-input__icon">{leadingIcon}</span> : null}
      <input className={cx('flx-input__control', className)} type={type} {...rest} />
    </span>
  );
}

export type SelectOption = string | {
  disabled?: boolean;
  label: string;
  value: string;
};

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  onValueChange?: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
}

const normalizeOption = (option: SelectOption) =>
  typeof option === 'string' ? { label: option, value: option } : option;

export function Select({
  className,
  fullWidth = true,
  leadingIcon,
  onChange,
  onValueChange,
  options,
  placeholder,
  ...rest
}: SelectProps) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange?.(event);
    onValueChange?.(event.currentTarget.value);
  };

  return (
    <span className="flx-select" data-full-width={fullWidth || undefined}>
      {leadingIcon ? <span className="flx-select__icon">{leadingIcon}</span> : null}
      <select className={cx('flx-select__control', className)} onChange={handleChange} {...rest}>
        {placeholder ? (
          <option disabled value="">
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => {
          const normalized = normalizeOption(option);

          return (
            <option disabled={normalized.disabled} key={normalized.value} value={normalized.value}>
              {normalized.label}
            </option>
          );
        })}
      </select>
      <span aria-hidden="true" className="flx-select__chevron" />
    </span>
  );
}

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role'> {
  checked?: boolean;
  label?: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
}

export function Switch({
  checked = false,
  className,
  disabled = false,
  label,
  onClick,
  onCheckedChange,
  type = 'button',
  ...rest
}: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      className={cx('flx-switch', className)}
      data-checked={checked || undefined}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) {
          onCheckedChange?.(!checked);
        }
      }}
      role="switch"
      type={type}
      {...rest}
    >
      <span aria-hidden="true" className="flx-switch__track">
        <span className="flx-switch__thumb" />
      </span>
      {label ? <span className="flx-switch__label">{label}</span> : null}
    </button>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
}

export function Checkbox({
  checked,
  className,
  label,
  onChange,
  onCheckedChange,
  ...rest
}: CheckboxProps) {
  return (
    <label className={cx('flx-checkbox', className)}>
      <input
        checked={checked}
        className="flx-checkbox__native"
        onChange={(event) => {
          onChange?.(event);
          onCheckedChange?.(event.currentTarget.checked);
        }}
        type="checkbox"
        {...rest}
      />
      <span aria-hidden="true" className="flx-checkbox__box" />
      {label ? <span className="flx-checkbox__label">{label}</span> : null}
    </label>
  );
}
