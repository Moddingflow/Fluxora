import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AI_VOICE_TRANSCRIPTION_WATCHDOG_MIN_MS,
  transcribeVoiceWithWatchdog
} from '../src/renderer/features/ai/ai-voice-transcription';

describe('AI voice transcription watchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels native inference and rejects when the host never settles', async () => {
    vi.useFakeTimers();
    const cancelVoiceTranscription = vi.fn(() => new Promise<void>(() => undefined));
    const result = transcribeVoiceWithWatchdog(
      {
        cancelVoiceTranscription,
        transcribeVoice: () => new Promise(() => undefined)
      },
      new Uint8Array(16_000),
      {
        channelCount: 1,
        completionMode: 'draft',
        durationMs: 1_000,
        language: 'ru',
        operationId: 'voice-watchdog-1',
        sampleRateHz: 16_000
      }
    );
    const rejection = expect(result).rejects.toMatchObject({
      code: 'speech.host.timeout',
      operationId: 'voice-watchdog-1',
      stage: 'transcribe'
    });

    await vi.advanceTimersByTimeAsync(AI_VOICE_TRANSCRIPTION_WATCHDOG_MIN_MS);

    await rejection;
    expect(cancelVoiceTranscription).toHaveBeenCalledExactlyOnceWith('voice-watchdog-1');
  });

  it('clears the watchdog after a successful transcription', async () => {
    vi.useFakeTimers();
    const cancelVoiceTranscription = vi.fn(async () => undefined);
    const result = await transcribeVoiceWithWatchdog(
      {
        cancelVoiceTranscription,
        transcribeVoice: async () => ({
          backend: 'vulkan',
          detectedLanguage: 'ru',
          durationMs: 1_000,
          glossaryVersion: '1.0.0',
          modelVersion: 'small-q5_1',
          noSpeech: false,
          operationId: 'voice-watchdog-2',
          processingTimeMs: 500,
          transcript: 'раз раз тест тест'
        })
      },
      new Uint8Array(16_000),
      {
        channelCount: 1,
        completionMode: 'draft',
        durationMs: 1_000,
        language: 'ru',
        operationId: 'voice-watchdog-2',
        sampleRateHz: 16_000
      }
    );

    expect(result.transcript).toBe('раз раз тест тест');
    expect(vi.getTimerCount()).toBe(0);
    expect(cancelVoiceTranscription).not.toHaveBeenCalled();
  });
});
