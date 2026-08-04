import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const read = (...segments: string[]) => fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('shared pointer reorder interaction', () => {
  it('owns capture, threshold, hit testing, edge scroll and cancellation centrally', () => {
    const hook = read('frontend-tauri', 'src', 'renderer', 'hooks', 'usePointerReorderSession.ts');
    expect(hook).toContain('threshold = 5');
    expect(hook).toContain('setPointerCapture(event.pointerId)');
    expect(hook).toMatch(/document\s*\.elementFromPoint\(event\.clientX, event\.clientY\)/s);
    expect(hook).toContain("event.key === 'Escape'");
    expect(hook).toContain('event.currentTarget.releasePointerCapture(event.pointerId)');
    expect(hook).toContain("input, button, textarea, select, [contenteditable=\"true\"]");
    expect(hook).toContain('scrollBy({ top: -edgeScrollStep, behavior:');
  });

  it('keeps InstallPlacementEditor on the shared interaction without changing its 5px contract', () => {
    const editor = read('frontend-tauri', 'src', 'renderer', 'features', 'install', 'InstallPlacementEditor.tsx');
    expect(editor).toContain('usePointerReorderSession');
    expect(editor).toContain('threshold: 5');
    expect(editor).not.toContain('interface PointerSession');
    expect(editor).not.toContain('document.elementFromPoint');
  });
});
