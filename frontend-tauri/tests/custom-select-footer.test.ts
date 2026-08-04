import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const source = fs.readFileSync(
  path.join(
    repoRoot,
    'frontend-tauri',
    'src',
    'renderer',
    'design-system',
    'primitives',
    'custom-select.tsx'
  ),
  'utf8'
);

describe('CustomSelect footer action contract', () => {
  it('keeps footer action outside the listbox option model', () => {
    expect(source).toContain('export interface CustomSelectFooterAction');
    expect(source).toContain('className="flx-custom-select__listbox"');
    expect(source).toContain('role="listbox"');
    expect(source).toContain('className="flx-custom-select__footer"');
    expect(source).toContain('className="flx-custom-select__footer-action"');
    expect(source).not.toMatch(/flx-custom-select__footer-action[^>]+role="option"/s);
  });

  it('moves Tab focus to the footer and restores trigger focus on Escape', () => {
    expect(source).toContain('footerActionRef.current?.focus()');
    expect(source).toContain("case 'Escape':");
    expect(source).toContain('buttonRef.current?.focus()');
    expect(source).toContain('activateFooterAction');
  });

  it('can open an action-only popup when there are no options', () => {
    expect(source).toContain('options.length === 0 && !footerAction');
  });
});
