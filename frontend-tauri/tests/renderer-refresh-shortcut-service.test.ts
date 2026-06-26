import { describe, expect, it, vi } from 'vitest';

import {
  handleRendererRefreshShortcut,
  installRendererRefreshShortcut,
  isRendererRefreshShortcut,
  type RendererRefreshKeyEvent,
  type RendererRefreshShortcutTarget
} from '../src/renderer/services/renderer-refresh-shortcut-service';

const keyEvent = (key: string, repeat = false): RendererRefreshKeyEvent => ({
  key,
  repeat,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn()
});

describe('renderer refresh shortcut service', () => {
  it('recognizes F5 as the in-app refresh shortcut', () => {
    expect(isRendererRefreshShortcut({ key: 'F5' })).toBe(true);
    expect(isRendererRefreshShortcut({ key: 'Escape' })).toBe(false);
  });

  it('prevents native webview reload and runs refresh once for F5', () => {
    const event = keyEvent('F5');
    const refresh = vi.fn();

    expect(handleRendererRefreshShortcut(event, refresh)).toBe(true);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('still blocks repeated F5 reloads without starting duplicate refreshes', () => {
    const event = keyEvent('F5', true);
    const refresh = vi.fn();

    expect(handleRendererRefreshShortcut(event, refresh)).toBe(true);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('installs the shortcut listener in capture phase and cleans it up', () => {
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as RendererRefreshShortcutTarget;
    const refresh = vi.fn();

    const cleanup = installRendererRefreshShortcut(target, refresh);

    expect(target.addEventListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
      true
    );

    const listener = vi.mocked(target.addEventListener).mock.calls[0]?.[1] as
      | ((event: KeyboardEvent) => void)
      | undefined;
    expect(listener).toBeTypeOf('function');

    listener?.(keyEvent('F5') as KeyboardEvent);
    expect(refresh).toHaveBeenCalledTimes(1);

    cleanup();

    expect(target.removeEventListener).toHaveBeenCalledWith('keydown', listener, true);
  });
});
