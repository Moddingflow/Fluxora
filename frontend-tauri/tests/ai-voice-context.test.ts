import { describe, expect, it } from 'vitest';

import { buildVoiceContextHints } from '../src/renderer/features/ai/ai-voice-context';

describe('AI voice recognition context', () => {
  it('keeps active build names and English technical terms from a Russian chat', () => {
    const hints = buildVoiceContextHints({
      buildTerms: [
        'No Grass In Objects - Grass Control',
        'Community Shaders'
      ],
      draft: '',
      recentMessages: [
        "Параметр 'Use-grass-cache' установлен в GrassControl.ini. Генерация кэша включена."
      ]
    });

    expect(hints).toEqual(expect.arrayContaining([
      'No Grass In Objects - Grass Control',
      'No Grass In Objects',
      'Grass Control',
      'Community Shaders',
      'Use-grass-cache',
      'GrassControl.ini'
    ]));
    expect(hints.every((hint) => /[A-Za-z]/.test(hint))).toBe(true);
  });
});
