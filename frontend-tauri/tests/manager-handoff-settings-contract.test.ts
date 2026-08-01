import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { managerHandoffSettingsCopy } from '../src/renderer/features/settings/manager-handoff-settings-copy';
import { createTauriFluxoraApi } from '../src/tauri/fluxora-api';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn() })
}));

let originalWindowDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} }
  });
  invokeMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

describe('manager handoff Windows settings contract', () => {
  it('routes the renderer action through one focused native command', async () => {
    await createTauriFluxoraApi().managerHandoff.openDefaultAppSettings();

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith(
      'fluxora_open_manager_default_app_settings'
    );
  });

  it('opens the per-user Fluxora Default Apps page without mutating an association', () => {
    const rustSource = readFileSync(
      new URL('../src-tauri/src/lib.rs', import.meta.url),
      'utf8'
    );

    expect(rustSource).toContain(
      'ms-settings:defaultapps?registeredAppUser=Fluxora'
    );
    expect(rustSource).toContain(
      'fn fluxora_open_manager_default_app_settings()'
    );
    expect(rustSource).not.toMatch(
      /fluxora_open_manager_default_app_settings[\s\S]{0,800}SetAppAsDefault/
    );
  });

  it('keeps the user-facing action complete in every supported desktop language', () => {
    const english = managerHandoffSettingsCopy('en-us');
    const russian = managerHandoffSettingsCopy('ru-ru');
    const german = managerHandoffSettingsCopy('de-de');

    for (const localized of [english, russian, german]) {
      expect(localized.title).not.toBe('');
      expect(localized.detail).toContain('moddingflow');
      expect(localized.action).not.toBe('');
      expect(localized.opening).not.toBe('');
      expect(localized.error).not.toBe('');
      expect(localized.ariaLabel).toContain('moddingflow');
    }
    expect(new Set([
      english.action,
      russian.action,
      german.action
    ])).toHaveLength(3);
  });
});
