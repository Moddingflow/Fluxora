import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  aiMicrophonePermissionStorageKey,
  allowAiMicrophone,
  hasAiMicrophonePermission,
  resetAiMicrophonePermission
} from '../src/renderer/features/ai/ai-microphone-permission';
import { AiMicrophonePermissionDialog } from '../src/renderer/features/ai/AiMicrophonePermissionDialog';

const createStorage = () => {
  const values = new Map<string, string>();
  const writes: Array<{ key: string; value: string }> = [];
  const removals: string[] = [];
  return {
    removals,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        removals.push(key);
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        writes.push({ key, value });
        values.set(key, value);
      }
    },
    values,
    writes
  };
};

describe('AI microphone permission persistence', () => {
  it('stores Allow locally and reads it until reset', () => {
    const harness = createStorage();

    expect(hasAiMicrophonePermission(harness.storage)).toBe(false);
    allowAiMicrophone(harness.storage);

    expect(harness.writes).toEqual([{
      key: aiMicrophonePermissionStorageKey,
      value: 'true'
    }]);
    expect(hasAiMicrophonePermission(harness.storage)).toBe(true);

    resetAiMicrophonePermission(harness.storage);
    expect(harness.removals).toEqual([aiMicrophonePermissionStorageKey]);
    expect(hasAiMicrophonePermission(harness.storage)).toBe(false);
  });

  it('does not need a persisted Deny value', () => {
    const harness = createStorage();

    expect(hasAiMicrophonePermission(harness.storage)).toBe(false);
    expect(harness.writes).toEqual([]);
    expect(harness.values.size).toBe(0);
  });

  it('fails closed when local storage is unavailable', () => {
    const unavailable = {
      getItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); }
    };

    expect(hasAiMicrophonePermission(unavailable)).toBe(false);
    expect(() => allowAiMicrophone(unavailable)).not.toThrow();
    expect(() => resetAiMicrophonePermission(unavailable)).not.toThrow();
  });
});

describe('AI microphone permission dialog', () => {
  const renderDialog = (language: string): string => renderToStaticMarkup(
    React.createElement(AiMicrophonePermissionDialog, {
      language,
      onAllow: () => undefined,
      onDeny: () => undefined
    })
  );

  it('uses the Fluxora modal contract with explicit Allow and Deny actions', () => {
    const html = renderDialog('en-us');

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Allow microphone access');
    expect(html).toContain('Allow');
    expect(html).toContain('Deny');
    expect(html).toContain('aria-label="Close microphone permission dialog"');
  });

  it('selects compact dialog copy from the renderer language only', () => {
    expect(renderDialog('ru-ru')).toContain('Разрешить доступ к микрофону');
    expect(renderDialog('ru-ru')).toContain('Отклонить');
    expect(renderDialog('de-de')).toContain('Mikrofonzugriff erlauben');
    expect(renderDialog('de-de')).toContain('Ablehnen');
  });
});
