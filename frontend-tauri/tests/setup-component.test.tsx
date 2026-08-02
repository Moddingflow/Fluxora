import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SetupApp } from '../src/installer/setup/SetupApp';
import { LanguageStep } from '../src/installer/setup/LanguageStep';
import { SetupStepNavigation } from '../src/installer/setup/SetupStepNavigation';
import { InstallerProgressPanel } from '../src/installer/components/InstallerProgressPanel';
import { installerLanguageFromLocale, translate } from '../src/installer/i18n';

const setupSource = fileURLToPath(
  new URL('../src/installer/setup/SetupApp.tsx', import.meta.url)
);
const titlebarSource = fileURLToPath(
  new URL('../src/installer/components/InstallerTitlebar.tsx', import.meta.url)
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Setup component contract', () => {
  it('presents every supported language as an accessible single-selection list', () => {
    const html = renderToStaticMarkup(createElement(LanguageStep, {
      language: 'de',
      onSelect: vi.fn()
    }));

    expect(html).toContain('role="listbox"');
    expect(html.match(/role="option"/gu)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/gu)).toHaveLength(1);
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain('aria-checked=');
    expect(html).not.toContain('setup-language-option__status');
    expect(html.match(/<img\b/gu)).toHaveLength(3);
    expect(html.match(/data:image\/svg\+xml/gu)).toHaveLength(3);
    expect(html).toContain('English');
    expect(html).toContain('Deutsch');
    expect(html).toContain('Русский');
  });

  it('renders an accessible isolated loading shell before native bootstrap completes', () => {
    vi.stubGlobal('window', {
      fluxora: {
        setup: {
          getBootstrapState: vi.fn(),
          onProgress: vi.fn(),
          onCloseBlocked: vi.fn(),
          minimizeWindow: vi.fn(),
          requestClose: vi.fn()
        }
      }
    });
    const html = renderToStaticMarkup(createElement(SetupApp));

    expect(html).toContain('Fluxora Setup');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Preparing Setup');
    expect(html).toContain('aria-label="Installation steps"');
    expect(html).not.toContain('aria-label="Language"');
    expect(html).toContain('aria-label="Minimize"');
    expect(html).toContain('aria-label="Close"');
  });

  it('renders only completed steps as navigation buttons', () => {
    const html = renderToStaticMarkup(createElement(SetupStepNavigation, {
      currentStep: 'language',
      furthestStep: 'location',
      language: 'en',
      navigationLocked: false,
      onNavigate: vi.fn()
    }));

    expect(html).toContain('aria-current="step"');
    expect(html).toContain('aria-label="Legal"');
    expect(html).not.toContain('aria-label="Location"');
    expect(html.match(/<button\b/gu)).toHaveLength(1);

    const lockedHtml = renderToStaticMarkup(createElement(SetupStepNavigation, {
      currentStep: 'location',
      furthestStep: 'location',
      language: 'en',
      navigationLocked: true,
      onNavigate: vi.fn()
    }));
    expect(lockedHtml).not.toContain('<button');
  });

  it.each([
    ['en-US', 'en', 'I accept the Terms of Use', 'I confirm that I have read the Privacy Policy'],
    ['de-DE', 'de', 'Ich akzeptiere die Nutzungsbedingungen', 'Ich bestätige, dass ich die Datenschutzerklärung gelesen habe'],
    ['ru-RU', 'ru', 'Я принимаю Условия использования', 'Я подтверждаю, что прочитал(а) Политику конфиденциальности']
  ] as const)(
    'has separate Terms and Privacy copy for %s',
    (locale, language, terms, privacy) => {
      expect(installerLanguageFromLocale(locale)).toBe(language);
      expect(translate(language, 'setup.legal.acceptTerms')).toBe(terms);
      expect(translate(language, 'setup.legal.ackPrivacy')).toBe(privacy);
      expect(translate(language, 'setup.validation.notWritable')).not.toBe('setup.validation.notWritable');
      expect(privacy.toLowerCase()).not.toContain('consent');
      expect(privacy.toLowerCase()).not.toContain('соглас');
      expect(privacy.toLowerCase()).not.toContain('einwill');
    }
  );

  it.each([
    ['en', 'Roll back existing installation'],
    ['de', 'Vorhandene Installation zurücksetzen'],
    ['ru', 'Откат существующей установки']
  ] as const)('labels a detected manual downgrade in %s', (language, label) => {
    expect(translate(language, 'setup.mode.downgrade')).toBe(label);
  });

  it.each([
    ['en', 'Updating Fluxora', 'Downloading the signed full update…'],
    ['de', 'Fluxora wird aktualisiert', 'Signiertes Vollupdate wird heruntergeladen…'],
    ['ru', 'Обновление Fluxora', 'Загрузка подписанного полного обновления…']
  ] as const)('renders localized accessible update progress in %s', (language, title, status) => {
    const html = renderToStaticMarkup(createElement(InstallerProgressPanel, {
      busy: true,
      currentVersion: '2.4.0',
      downloadedBytes: 50,
      language,
      phase: translate(language, 'setup.update.phase.downloading'),
      percent: 50,
      status: translate(language, 'setup.update.downloading'),
      targetVersion: '2.5.0',
      title,
      totalBytes: 100
    }));

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('2.4.0');
    expect(html).toContain('2.5.0');
    expect(html).toContain(title);
    expect(html).toContain(status);
    expect(html).not.toContain('role="alert"');
  });

  it('keeps installer-specific colors behind the semantic token layer', () => {
    const installerRoot = fileURLToPath(new URL('../src/installer/', import.meta.url));
    const cssPaths = [
      `${installerRoot}/setup/setup.css`,
      `${installerRoot}/updater/updater.css`,
      `${installerRoot}/components/installer-progress-panel.css`,
      `${installerRoot}/components/installer-titlebar.css`
    ];
    for (const cssPath of cssPaths) {
      const css = readFileSync(cssPath, 'utf8');
      expect(css, cssPath).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
      expect(css, cssPath).toMatch(/var\(--installer-/u);
    }
    const tokens = readFileSync(`${installerRoot}/components/installer-tokens.css`, 'utf8');
    expect(tokens).toContain(':root[data-theme="default"]');
    for (const role of [
      'background', 'surface', 'text', 'muted', 'border', 'accent',
      'success', 'error', 'focus', 'progress'
    ]) {
      expect(tokens).toContain(`--installer-${role}`);
    }
  });

  it('keeps titlebar chrome free of inline SVG geometry', () => {
    const sources = `${readFileSync(setupSource, 'utf8')}\n${readFileSync(titlebarSource, 'utf8')}`;
    expect(sources).not.toMatch(/<svg\b/iu);
    expect(sources).not.toMatch(/<path\b/iu);
  });
});
