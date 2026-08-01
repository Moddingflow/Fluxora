import type { KeyboardEvent } from 'react';

import flagGermany from '@fluxora-icons/flag-germany.svg';
import flagRussia from '@fluxora-icons/flag-russia.svg';
import flagUnitedKingdom from '@fluxora-icons/flag-united-kingdom.svg';
import type { InstallerLanguage } from '../contracts';
import { translate } from '../i18n';

interface LanguageOption {
  flagAsset: string;
  language: InstallerLanguage;
}

const languageOptions: readonly LanguageOption[] = [
  { flagAsset: flagUnitedKingdom, language: 'en' },
  { flagAsset: flagGermany, language: 'de' },
  { flagAsset: flagRussia, language: 'ru' }
];

export interface LanguageStepProps {
  language: InstallerLanguage;
  onSelect: (language: InstallerLanguage) => void;
}

export function LanguageStep({ language, onSelect }: LanguageStepProps) {
  const selectFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    const direction = ['ArrowRight', 'ArrowDown'].includes(event.key)
      ? 1
      : ['ArrowLeft', 'ArrowUp'].includes(event.key)
        ? -1
        : 0;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? languageOptions.length - 1
        : direction
          ? (currentIndex + direction + languageOptions.length) % languageOptions.length
          : currentIndex;

    if (nextIndex === currentIndex && direction === 0) {
      return;
    }

    event.preventDefault();
    const nextLanguage = languageOptions[nextIndex].language;
    onSelect(nextLanguage);
    document.getElementById(`setup-language-${nextLanguage}`)?.focus();
  };

  return (
    <section className="setup-step setup-step--language">
      <div className="setup-step__heading">
        <h1 id="setup-language-title">{translate(language, 'setup.language.title')}</h1>
        <p>{translate(language, 'setup.language.detail')}</p>
      </div>
      <div
        aria-labelledby="setup-language-title"
        className="setup-language-options"
        role="listbox"
      >
        {languageOptions.map((option, index) => {
          const selected = option.language === language;
          return (
            <button
              aria-selected={selected}
              className="setup-language-option"
              data-selected={selected || undefined}
              id={`setup-language-${option.language}`}
              key={option.language}
              onClick={() => onSelect(option.language)}
              onKeyDown={(event) => selectFromKeyboard(event, index)}
              role="option"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <img
                alt=""
                aria-hidden="true"
                className="setup-language-option__flag"
                src={option.flagAsset}
              />
              <span className="setup-language-option__name">
                {translate(option.language, `language.${option.language}`)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
