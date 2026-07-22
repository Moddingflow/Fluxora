import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AiVoiceProcessingIndicator } from '../src/renderer/features/ai/AiVoiceProcessingIndicator';

describe('AI voice processing indicator', () => {
  it.each([
    ['en-us', 'Transcribing locally', 'Cancel voice input'],
    ['ru-ru', 'Локальное распознавание речи', 'Отменить голосовой ввод'],
    ['de-de', 'Lokale Spracherkennung', 'Spracheingabe abbrechen']
  ])('keeps %s status screen-reader-only with a visible cancel action', (language, status, cancel) => {
    const html = renderToStaticMarkup(createElement(AiVoiceProcessingIndicator, {
      language,
      onCancel: vi.fn()
    }));

    expect(html).toContain('ai-voice-processing__spinner');
    expect(html).toContain(`class="sr-only" role="status"`);
    expect(html).toContain(status);
    expect(html).toContain(`aria-label="${cancel}"`);
    expect(html).not.toContain('Transcribing locally…');
    expect(html).not.toContain('ai-voice-waveform');
  });
});
