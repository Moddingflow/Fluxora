import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  installTabFocusNavigation,
  TAB_FOCUS_NAVIGATION_VALUE
} from '../src/renderer/services/focus-modality-service';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

type TestDocument = Document & {
  documentElement: HTMLElement & {
    dataset: Record<string, string | undefined>;
  };
};

const createTestDocument = (): TestDocument => {
  const target = new EventTarget() as TestDocument;

  Object.defineProperty(target, 'documentElement', {
    value: {
      dataset: {}
    }
  });

  return target;
};

const keyboardEvent = (key: string): KeyboardEvent => {
  const event = new Event('keydown') as KeyboardEvent;

  Object.defineProperty(event, 'key', {
    value: key
  });

  return event;
};

describe('focus modality service', () => {
  it('enables visible focus rings only after Tab navigation', () => {
    const targetDocument = createTestDocument();
    const uninstall = installTabFocusNavigation(targetDocument);

    targetDocument.dispatchEvent(keyboardEvent('Shift'));
    expect(targetDocument.documentElement.dataset.focusNavigation).toBeUndefined();

    targetDocument.dispatchEvent(keyboardEvent('Tab'));
    expect(targetDocument.documentElement.dataset.focusNavigation).toBe(TAB_FOCUS_NAVIGATION_VALUE);

    targetDocument.dispatchEvent(new Event('pointerdown'));
    expect(targetDocument.documentElement.dataset.focusNavigation).toBeUndefined();

    uninstall();
    targetDocument.dispatchEvent(keyboardEvent('Tab'));
    expect(targetDocument.documentElement.dataset.focusNavigation).toBeUndefined();
  });

  it('wires the Tab-only modality gate into the renderer styles', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const main = readText('frontend-tauri', 'src', 'renderer', 'main.tsx');

    expect(main).toContain("import { installTabFocusNavigation } from './services/focus-modality-service';");
    expect(main).toContain('installTabFocusNavigation();');
    expect(styles).toContain(':root:not([data-focus-navigation="tab"]) :focus-visible');
    expect(styles).toContain(
      ':root:not([data-focus-navigation="tab"]) .mod-enable-checkbox input:focus-visible + span'
    );
    expect(styles).toContain('outline: none !important;');
  });
});
