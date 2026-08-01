import {
  Check,
  ChevronDown,
  Globe2
} from '../../design-system/icons/lucide-compat';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent
} from 'react';
import { createPortal } from 'react-dom';

import flagGermany from '../../../../../Icons/flag-germany.svg';
import flagRussia from '../../../../../Icons/flag-russia.svg';
import flagUnitedKingdom from '../../../../../Icons/flag-united-kingdom.svg';
import {
  languageOptions,
  type LanguageOption
} from '../../settings-workspace-state';

const languageFlagAssets: Record<string, string> = {
  de: flagGermany,
  gb: flagUnitedKingdom,
  ru: flagRussia
};

interface LanguageSelectProps {
  disabled: boolean;
  onChange: (language: string) => void;
  value: string;
}

interface LanguageMenuPosition {
  height: number;
  left: number;
  top: number;
  width: number;
}

const languageMenuViewportHeight = 330;
const languageMenuMinimumHeight = 132;
const languageMenuBorderHeight = 2;
const languageMenuVerticalPadding = 12;
const languageMenuOptionHeight = 42;
const languageMenuOptionGap = 4;
const languageMenuContentHeight =
  languageMenuBorderHeight +
  languageMenuVerticalPadding +
  languageOptions.length * languageMenuOptionHeight +
  Math.max(0, languageOptions.length - 1) * languageMenuOptionGap;

const optionText = (language: LanguageOption) =>
  `${language.nativeLabel} - ${language.label}`;

export function LanguageSelect({ disabled, onChange, value }: LanguageSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const selectedLanguage =
    languageOptions.find((language) => language.code === value) ?? languageOptions[0];
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedCode, setHighlightedCode] = useState(selectedLanguage.code);
  const highlightedLanguage =
    languageOptions.find((language) => language.code === highlightedCode) ?? selectedLanguage;
  const selectedIndex = Math.max(
    0,
    languageOptions.findIndex((language) => language.code === selectedLanguage.code)
  );
  const highlightedOptionId = `${listboxId}-${highlightedLanguage.code}`;
  const [menuPosition, setMenuPosition] = useState<LanguageMenuPosition | null>(null);

  const updateMenuPosition = useCallback(() => {
    const buttonRect = buttonRef.current?.getBoundingClientRect();
    if (!buttonRect) {
      return;
    }

    const viewportPadding = 8;
    const menuGap = 8;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const belowSpace = viewportHeight - buttonRect.bottom - menuGap - viewportPadding;
    const aboveSpace = buttonRect.top - menuGap - viewportPadding;
    const preferredHeight = Math.min(
      languageMenuViewportHeight,
      Math.max(languageMenuMinimumHeight, languageMenuContentHeight)
    );
    const openAbove =
      belowSpace < preferredHeight && aboveSpace > belowSpace;
    const availableHeight = openAbove ? aboveSpace : belowSpace;
    const height = Math.min(
      preferredHeight,
      Math.max(languageMenuMinimumHeight, availableHeight)
    );
    const width = Math.max(220, buttonRect.width);
    const left = Math.max(
      viewportPadding,
      Math.min(buttonRect.left, viewportWidth - width - viewportPadding)
    );
    const preferredTop = openAbove
      ? buttonRect.top - menuGap - height
      : buttonRect.bottom + menuGap;
    const top = Math.max(
      viewportPadding,
      Math.min(preferredTop, viewportHeight - height - viewportPadding)
    );

    setMenuPosition({ height, left, top, width });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setHighlightedCode(selectedLanguage.code);
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
  }, [isOpen, selectedLanguage.code]);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  useLayoutEffect(() => {
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
    if (disabled) {
      return;
    }

    setHighlightedCode(selectedLanguage.code);
    updateMenuPosition();
    window.requestAnimationFrame(() => setIsOpen(true));
  };

  const closeList = () => {
    setIsOpen(false);
  };

  const chooseLanguage = (language: LanguageOption) => {
    if (disabled) {
      return;
    }

    if (language.code !== selectedLanguage.code) {
      onChange(language.code);
    }

    closeList();
    buttonRef.current?.focus();
  };

  const moveHighlight = (offset: number) => {
    const currentIndex = languageOptions.findIndex(
      (language) => language.code === highlightedCode
    );
    const startIndex = currentIndex >= 0 && isOpen ? currentIndex : selectedIndex;
    const nextIndex =
      (startIndex + offset + languageOptions.length) % languageOptions.length;

    setHighlightedCode(languageOptions[nextIndex].code);
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
        setHighlightedCode(languageOptions[0].code);
        updateMenuPosition();
        window.requestAnimationFrame(() => setIsOpen(true));
        break;
      case 'End':
        event.preventDefault();
        setHighlightedCode(languageOptions[languageOptions.length - 1].code);
        updateMenuPosition();
        window.requestAnimationFrame(() => setIsOpen(true));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (isOpen) {
          chooseLanguage(highlightedLanguage);
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

  return (
    <div
      className="settings-service-row settings-service-row--connection settings-language-row"
      data-open={isOpen ? 'true' : 'false'}
      ref={rootRef}
    >
      <span className="settings-service-icon settings-service-icon--language">
        <Globe2 size={22} aria-hidden="true" />
      </span>
      <div className="language-select">
        <button
          aria-activedescendant={isOpen ? highlightedOptionId : undefined}
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label="Language"
          className="language-select__button"
          data-open={isOpen ? 'true' : 'false'}
          disabled={disabled}
          onClick={() => (isOpen ? closeList() : openList())}
          onKeyDown={handleKeyDown}
          ref={buttonRef}
          role="combobox"
          type="button"
        >
          <img
            alt=""
            aria-hidden="true"
            className="language-select__flag"
            src={languageFlagAssets[selectedLanguage.countryCode]}
          />
          <span className="language-select__value">
            <strong>{optionText(selectedLanguage)}</strong>
          </span>
          <ChevronDown className="language-select__chevron" size={17} aria-hidden="true" />
        </button>

        {menuPosition && typeof document !== 'undefined'
          ? createPortal(
              <div
                aria-hidden={!isOpen}
                className="language-select__menu"
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
                {languageOptions.map((language) => {
                  const isSelected = language.code === selectedLanguage.code;
                  const isHighlighted = language.code === highlightedCode;

                  return (
                    <button
                      aria-selected={isSelected}
                      className="language-select__option"
                      data-highlighted={isHighlighted ? 'true' : 'false'}
                      data-selected={isSelected ? 'true' : 'false'}
                      id={`${listboxId}-${language.code}`}
                      key={language.code}
                      onClick={() => chooseLanguage(language)}
                      onMouseEnter={() => setHighlightedCode(language.code)}
                      role="option"
                      tabIndex={-1}
                      type="button"
                    >
                      <img
                        alt=""
                        aria-hidden="true"
                        className="language-select__flag"
                        src={languageFlagAssets[language.countryCode]}
                      />
                      <span className="language-select__option-copy">
                        <strong>{optionText(language)}</strong>
                      </span>
                      <Check size={15} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>,
            document.body
          )
          : null}
      </div>
    </div>
  );
}
