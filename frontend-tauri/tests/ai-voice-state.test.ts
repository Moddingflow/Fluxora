import { describe, expect, it } from 'vitest';

import {
  appendVoiceTranscript,
  createInitialVoiceState,
  voiceStateReducer
} from '../src/renderer/features/ai/ai-voice-state';
import {
  startVoiceCapture,
  type VoiceAudioContext,
  type VoiceAudioNode,
  type VoiceCaptureDependencies,
  type VoiceWorkletNode
} from '../src/renderer/features/ai/ai-voice-capture';
import {
  voiceErrorFromUnknown
} from '../src/renderer/features/ai/use-ai-voice-input';

describe('AI voice input state', () => {
  it('keeps consent separate from native preparation and returns Deny to idle', () => {
    const requested = voiceStateReducer(createInitialVoiceState('chat-1'), {
      type: 'permission-requested',
      operationId: 'voice-consent-1'
    });
    expect(requested.phase).toBe('requesting-permission');

    const granted = voiceStateReducer(requested, { type: 'permission-granted' });
    expect(granted.phase).toBe('preparing');
    expect(granted.operationId).toBe('voice-consent-1');

    expect(voiceStateReducer(requested, { type: 'reset' })).toEqual(
      createInitialVoiceState('chat-1')
    );
  });

  it('keeps draft text and the recording operation id across Stop and Send completion', () => {
    const operationId = 'ai-voice-operation-1';
    let state = voiceStateReducer(createInitialVoiceState('chat-1'), {
      type: 'permission-requested',
      operationId
    });
    state = voiceStateReducer(state, { type: 'recording-started' });
    state = voiceStateReducer(state, { type: 'transcription-started', completionMode: 'send' });

    expect(state.phase).toBe('transcribing');
    expect(state.operationId).toBe(operationId);
    expect(state.completionMode).toBe('send');
    expect(appendVoiceTranscript('Existing draft  ', '  Fluxora and MO2  ')).toBe(
      'Existing draft Fluxora and MO2'
    );
  });

  it('returns to idle and changes ownership when another AI tab becomes active', () => {
    const recording = voiceStateReducer(
      voiceStateReducer(createInitialVoiceState('chat-1'), {
        type: 'permission-requested',
        operationId: 'voice-chat-1'
      }),
      { type: 'recording-started' }
    );

    const next = voiceStateReducer(recording, { type: 'owner-changed', chatId: 'chat-2' });

    expect(next).toEqual(createInitialVoiceState('chat-2'));
  });
});

describe('AI voice PCM capture', () => {
  const createHarness = () => {
    let now = 0;
    let streamConstraints: MediaStreamConstraints | undefined;
    let trackStops = 0;
    let contextCloses = 0;
    let disconnects = 0;
    let limitCalls = 0;
    const frames: FrameRequestCallback[] = [];
    const port: VoiceWorkletNode['port'] = {
      close: () => undefined,
      onmessage: null
    };
    const node = (): VoiceAudioNode => ({
      connect: () => undefined,
      disconnect: () => { disconnects += 1; }
    });
    const context: VoiceAudioContext = {
      audioWorklet: { addModule: async () => undefined },
      close: async () => { contextCloses += 1; },
      createGain: () => ({ ...node(), gain: { value: 1 } }),
      createMediaStreamSource: () => node(),
      destination: node(),
      sampleRate: 16_000
    };
    const worklet: VoiceWorkletNode = { ...node(), port };
    const dependencies: VoiceCaptureDependencies = {
      cancelFrame: () => undefined,
      createAudioContext: () => context,
      createWorkletNode: () => worklet,
      getUserMedia: async (constraints) => {
        streamConstraints = constraints;
        return { getTracks: () => [{ stop: () => { trackStops += 1; } }] };
      },
      now: () => now,
      requestFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      }
    };
    return {
      dependencies,
      emit(samples: number[]) {
        port.onmessage?.({ data: Float32Array.from(samples) } as MessageEvent<Float32Array>);
      },
      flushFrame() {
        frames.shift()?.(now);
      },
      setNow(value: number) { now = value; },
      stats: () => ({ contextCloses, disconnects, limitCalls, streamConstraints, trackStops }),
      onLimit: () => { limitCalls += 1; }
    };
  };

  it('bounds PCM, throttles its 32-bar waveform and releases every media resource', async () => {
    const harness = createHarness();
    const waveforms: number[][] = [];
    const capture = await startVoiceCapture({
      dependencies: harness.dependencies,
      maxSamples: 6,
      onLimit: harness.onLimit,
      onWaveform: (levels) => waveforms.push(levels)
    });

    harness.emit([0.1, -0.2, 0.3]);
    harness.flushFrame();
    harness.setNow(10);
    harness.emit([0.2, 0.2]);
    harness.setNow(40);
    harness.emit([0.5, 0.5, 0.5]);
    harness.flushFrame();

    const pcm = await capture.stop();

    expect(Array.from(pcm)).toHaveLength(6);
    [0.1, -0.2, 0.3, 0.2, 0.2, 0.5].forEach((sample, index) => {
      expect(pcm[index]).toBeCloseTo(sample, 6);
    });
    expect(waveforms).toHaveLength(2);
    expect(waveforms.every((levels) => levels.length === 32)).toBe(true);
    expect(harness.stats().limitCalls).toBe(1);
    expect(harness.stats().trackStops).toBe(1);
    expect(harness.stats().contextCloses).toBe(1);
    expect(harness.stats().disconnects).toBeGreaterThanOrEqual(3);
    expect(harness.stats().streamConstraints).toEqual({
      audio: {
        autoGainControl: true,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16_000
      },
      video: false
    });
  });
});

describe('AI voice errors and language', () => {
  it('keeps permission and device failures distinct', () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const missing = Object.assign(new Error('missing'), { name: 'NotFoundError' });
    const busy = Object.assign(new Error('busy'), { name: 'NotReadableError' });

    expect(voiceErrorFromUnknown(denied, 'en-us', 'voice-1')).toMatchObject({
      code: 'speech.permission.denied',
      canOpenMicrophoneSettings: true,
      operationId: 'voice-1',
      stage: 'permission',
      userMessage: 'Windows blocked microphone access. Open Windows microphone settings and try again.'
    });
    expect(voiceErrorFromUnknown(missing, 'en-us', 'voice-1').code).toBe('speech.microphone.missing');
    expect(voiceErrorFromUnknown(busy, 'en-us', 'voice-1').code).toBe('speech.microphone.busy');
  });

  it('keeps audio, model, timeout, crash and cancellation failures typed', () => {
    for (const code of [
      'speech.audio.too-short',
      'speech.audio.too-long',
      'speech.model.hash-mismatch',
      'speech.vad.hash-mismatch',
      'speech.host.timeout',
      'speech.host.repeated-crash',
      'speech.cancelled'
    ]) {
      expect(voiceErrorFromUnknown({ code }, 'en-us', 'voice-2').code).toBe(code);
      expect(voiceErrorFromUnknown({ code }, 'en-us', 'voice-2').userMessage).not.toBe(
        'Voice input failed. Try recording again.'
      );
    }
  });

  it('redacts raw protocol errors in normal mode and localizes safe actions', () => {
    const raw = voiceErrorFromUnknown({
      code: 'invalid args',
      message: 'missing field language',
      stage: 'protocol',
      operationId: 'voice-3'
    }, 'ru-ru', 'fallback-operation');

    expect(raw).toMatchObject({
      code: 'invalid args',
      debugMessage: 'missing field language',
      operationId: 'voice-3',
      stage: 'protocol',
      userMessage: 'Не удалось запустить голосовой ввод. Попробуйте записать ещё раз.'
    });
    expect(raw.userMessage).not.toContain('missing field');

    const german = voiceErrorFromUnknown(
      Object.assign(new Error('missing'), { name: 'NotFoundError' }),
      'de-de',
      'voice-4'
    );
    expect(german.userMessage).toBe(
      'Kein Mikrofon wurde gefunden. Prüfen Sie die Verbindung und versuchen Sie es erneut.'
    );
  });
});
