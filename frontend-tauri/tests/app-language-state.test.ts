import { describe, expect, it } from 'vitest';

import {
  appLanguageReducer,
  initialAppLanguageState
} from '../src/localization/app-language-state';

describe('application language state', () => {
  it('keeps product copy hidden until the persisted native language is loaded', () => {
    expect(initialAppLanguageState).toEqual({
      language: null,
      ready: false,
      rollbackLanguage: null
    });

    expect(
      appLanguageReducer(initialAppLanguageState, {
        type: 'native-loaded',
        language: 'ru-ru'
      })
    ).toEqual({
      language: 'ru-ru',
      ready: true,
      rollbackLanguage: null
    });
  });

  it('applies a requested language immediately and restores the prior language if saving fails', () => {
    const english = appLanguageReducer(initialAppLanguageState, {
      type: 'native-loaded',
      language: 'en-us'
    });
    const requested = appLanguageReducer(english, {
      type: 'save-requested',
      language: 'ru-ru'
    });

    expect(requested).toEqual({
      language: 'ru-ru',
      ready: true,
      rollbackLanguage: 'en-us'
    });
    expect(appLanguageReducer(requested, { type: 'save-failed' })).toEqual(english);
  });

  it('accepts a confirmed language change broadcast by another window', () => {
    const english = appLanguageReducer(initialAppLanguageState, {
      type: 'native-loaded',
      language: 'en-us'
    });

    expect(
      appLanguageReducer(english, {
        type: 'language-confirmed',
        language: 'de-de'
      })
    ).toEqual({
      language: 'de-de',
      ready: true,
      rollbackLanguage: null
    });
  });

  it('releases the startup gate with the safe fallback when native startup fails', () => {
    expect(
      appLanguageReducer(initialAppLanguageState, { type: 'native-load-failed' })
    ).toEqual({
      language: 'en-us',
      ready: true,
      rollbackLanguage: null
    });
  });
});
