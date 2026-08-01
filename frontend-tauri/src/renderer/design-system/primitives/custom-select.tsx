import { Check, ChevronDown } from '../icons/lucide-compat';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';

import { cx } from './utils';

export interface CustomSelectOption {
  disabled?: boolean;
  label: ReactNode;
  searchText?: string;
  value: string;
}

export interface CustomSelectProps {
  ariaLabel: string;
  className?: string;
  density?: 'regular' | 'compact';
  disabled?: boolean;
  emptyLabel?: ReactNode;
  menuMaxHeight?: number;
  onValueChange?: (value: string) => void;
  options: readonly CustomSelectOption[];
  value: string;
}

interface CustomSelectMenuPosition {
  height: number;
  left: number;
  top: number;
  width: number;
}

const menuViewportPadding = 8;
const menuGap = 8;
const menuBorderHeight = 2;
const menuVerticalPadding = 12;
const menuOptionGap = 4;
const menuMinimumHeight = 96;
const regularMenuOptionHeight = 42;
const compactMenuOptionHeight = 32;
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

const optionLabelText = (label: ReactNode): string =>
  typeof label === 'string' || typeof label === 'number' ? String(label) : '';

export function CustomSelect({
  ariaLabel,
  className,
  density = 'regular',
  disabled = false,
  emptyLabel = 'No options',
  menuMaxHeight = 330,
  onValueChange,
  options,
  value
}: CustomSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const enabledOptions = options.filter((option) => !option.disabled);
  const selectedOption =
    options.find((option) => option.value === value) ?? enabledOptions[0] ?? options[0] ?? null;
  const selectedValue = selectedOption?.value ?? '';
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedValue, setHighlightedValue] = useState(selectedValue);
  const highlightedOption =
    options.find((option) => option.value === highlightedValue) ?? selectedOption;
  const highlightedOptionId =
    highlightedOption ? `${listboxId}-${highlightedOption.value}` : undefined;
  const [menuPosition, setMenuPosition] = useState<CustomSelectMenuPosition | null>(null);

  const updateMenuPosition = useCallback(() => {
    const buttonRect = buttonRef.current?.getBoundingClientRect();
    if (!buttonRect) {
      return;
    }

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const belowSpace = viewportHeight - buttonRect.bottom - menuGap - menuViewportPadding;
    const aboveSpace = buttonRect.top - menuGap - menuViewportPadding;
    const optionHeight =
      density === 'compact' ? compactMenuOptionHeight : regularMenuOptionHeight;
    const contentHeight =
      menuBorderHeight +
      menuVerticalPadding +
      Math.max(1, options.length) * optionHeight +
      Math.max(0, options.length - 1) * menuOptionGap;
    const preferredHeight = Math.min(
      menuMaxHeight,
      Math.max(Math.min(menuMinimumHeight, contentHeight), contentHeight)
    );
    const openAbove = belowSpace < preferredHeight && aboveSpace > belowSpace;
    const availableHeight = openAbove ? aboveSpace : belowSpace;
    const height = Math.min(
      preferredHeight,
      Math.max(Math.min(menuMinimumHeight, preferredHeight), availableHeight)
    );
    const width = Math.max(density === 'compact' ? 150 : 220, buttonRect.width);
    const left = Math.max(
      menuViewportPadding,
      Math.min(buttonRect.left, viewportWidth - width - menuViewportPadding)
    );
    const preferredTop = openAbove
      ? buttonRect.top - menuGap - height
      : buttonRect.bottom + menuGap;
    const top = Math.max(
      menuViewportPadding,
      Math.min(preferredTop, viewportHeight - height - menuViewportPadding)
    );

    setMenuPosition({ height, left, top, width });
  }, [density, menuMaxHeight, options.length]);

  useEffect(() => {
    if (!isOpen) {
      setHighlightedValue(selectedValue);
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        rootRef.current &&
        menuRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target) &&
        !menuRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, selectedValue]);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  useIsomorphicLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const openList = () => {
    if (disabled || options.length === 0) {
      return;
    }

    setHighlightedValue(selectedValue);
    updateMenuPosition();
    window.requestAnimationFrame(() => setIsOpen(true));
  };

  const closeList = () => {
    setIsOpen(false);
  };

  const chooseOption = (option: CustomSelectOption | null) => {
    if (disabled || !option || option.disabled) {
      return;
    }

    if (option.value !== selectedValue) {
      onValueChange?.(option.value);
    }

    closeList();
    buttonRef.current?.focus();
  };

  const moveHighlight = (offset: number) => {
    if (enabledOptions.length === 0) {
      return;
    }

    const currentIndex = enabledOptions.findIndex(
      (option) => option.value === highlightedValue
    );
    const selectedIndex = Math.max(
      0,
      enabledOptions.findIndex((option) => option.value === selectedValue)
    );
    const startIndex = currentIndex >= 0 && isOpen ? currentIndex : selectedIndex;
    const nextIndex =
      (startIndex + offset + enabledOptions.length) % enabledOptions.length;

    setHighlightedValue(enabledOptions[nextIndex].value);
    updateMenuPosition();
    window.requestAnimationFrame(() => setIsOpen(true));
  };

  const setEdgeHighlight = (edge: 'first' | 'last') => {
    if (enabledOptions.length === 0) {
      return;
    }

    const option =
      edge === 'first' ? enabledOptions[0] : enabledOptions[enabledOptions.length - 1];
    setHighlightedValue(option.value);
    updateMenuPosition();
    window.requestAnimationFrame(() => setIsOpen(true));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveHighlight(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveHighlight(-1);
        break;
      case 'Home':
        event.preventDefault();
        setEdgeHighlight('first');
        break;
      case 'End':
        event.preventDefault();
        setEdgeHighlight('last');
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (isOpen) {
          chooseOption(highlightedOption);
        } else {
          openList();
        }
        break;
      case 'Escape':
        if (isOpen) {
          event.preventDefault();
          closeList();
        }
        break;
      case 'Tab':
        closeList();
        break;
      default:
        break;
    }
  };

  const selectedLabel = selectedOption?.label ?? emptyLabel;
  const selectedTitle = optionLabelText(selectedLabel);

  return (
    <div
      className={cx('flx-custom-select', className)}
      data-density={density}
      data-open={isOpen ? 'true' : 'false'}
      ref={rootRef}
    >
      <button
        aria-activedescendant={isOpen ? highlightedOptionId : undefined}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="flx-custom-select__button"
        data-open={isOpen ? 'true' : 'false'}
        disabled={disabled}
        onClick={() => (isOpen ? closeList() : openList())}
        onKeyDown={handleKeyDown}
        ref={buttonRef}
        role="combobox"
        title={selectedTitle || undefined}
        type="button"
      >
        <span className="flx-custom-select__value">
          <strong>{selectedLabel}</strong>
        </span>
        <ChevronDown className="flx-custom-select__chevron" size={17} aria-hidden="true" />
      </button>

      {menuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              aria-hidden={!isOpen}
              className="flx-custom-select__menu"
              data-density={density}
              data-open={isOpen ? 'true' : 'false'}
              id={listboxId}
              ref={menuRef}
              role="listbox"
              style={{
                height: menuPosition.height,
                left: menuPosition.left,
                top: menuPosition.top,
                width: menuPosition.width
              }}
            >
              {options.length === 0 ? (
                <button
                  className="flx-custom-select__option"
                  data-disabled="true"
                  disabled
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  <span className="flx-custom-select__option-copy">
                    <strong>{emptyLabel}</strong>
                  </span>
                  <Check size={15} aria-hidden="true" />
                </button>
              ) : (
                options.map((option) => {
                  const isSelected = option.value === selectedValue;
                  const isHighlighted = option.value === highlightedValue;
                  const text =
                    option.searchText ?? optionLabelText(option.label) ?? option.value;

                  return (
                    <button
                      aria-selected={isSelected}
                      className="flx-custom-select__option"
                      data-disabled={option.disabled ? 'true' : 'false'}
                      data-highlighted={isHighlighted ? 'true' : 'false'}
                      data-selected={isSelected ? 'true' : 'false'}
                      disabled={option.disabled}
                      id={`${listboxId}-${option.value}`}
                      key={option.value}
                      onClick={() => chooseOption(option)}
                      onMouseEnter={() => {
                        if (!option.disabled) {
                          setHighlightedValue(option.value);
                        }
                      }}
                      role="option"
                      tabIndex={-1}
                      title={text || undefined}
                      type="button"
                    >
                      <span className="flx-custom-select__option-copy">
                        <strong>{option.label}</strong>
                      </span>
                      <Check size={15} aria-hidden="true" />
                    </button>
                  );
                })
              )}
            </div>,
          document.body
        )
        : null}
    </div>
  );
}
