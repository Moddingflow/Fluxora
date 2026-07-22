import { AI_VOICE_WAVEFORM_BAR_COUNT } from './ai-voice-state';

export const AI_VOICE_SAMPLE_RATE_HZ = 16_000;
export const AI_VOICE_MAX_DURATION_MS = 5 * 60 * 1_000;
export const AI_VOICE_MAX_SAMPLES = AI_VOICE_SAMPLE_RATE_HZ * 5 * 60;
export const AI_VOICE_MIN_SAMPLES = 4_000;

const WAVEFORM_FRAME_INTERVAL_MS = 1_000 / 30;
const WORKLET_MODULE_URL = '/audio/fluxora-voice-worklet.js';
const WORKLET_PROCESSOR_NAME = 'fluxora-voice-capture';

export interface VoiceMediaTrack {
  stop(): void;
}

export interface VoiceMediaStream {
  getTracks(): VoiceMediaTrack[];
}

export interface VoiceAudioNode {
  connect(destination: unknown): unknown;
  disconnect(): void;
}

export interface VoiceGainNode extends VoiceAudioNode {
  gain: { value: number };
}

export interface VoiceWorkletNode extends VoiceAudioNode {
  port: {
    close(): void;
    onmessage: ((event: MessageEvent<Float32Array>) => void) | null;
  };
}

export interface VoiceAudioContext {
  audioWorklet: { addModule(url: string): Promise<void> };
  close(): Promise<void>;
  createGain(): VoiceGainNode;
  createMediaStreamSource(stream: VoiceMediaStream): VoiceAudioNode;
  destination: unknown;
  sampleRate: number;
}

export interface VoiceCaptureDependencies {
  cancelFrame(handle: number): void;
  createAudioContext(): VoiceAudioContext;
  createWorkletNode(context: VoiceAudioContext): VoiceWorkletNode;
  getUserMedia(constraints: MediaStreamConstraints): Promise<VoiceMediaStream>;
  now(): number;
  requestFrame(callback: FrameRequestCallback): number;
}

export interface VoiceCaptureSession {
  cancel(): Promise<void>;
  sampleCount(): number;
  stop(): Promise<Float32Array>;
}

export interface StartVoiceCaptureOptions {
  dependencies?: VoiceCaptureDependencies;
  maxSamples?: number;
  onLimit: () => void;
  onWaveform: (levels: number[]) => void;
}

const defaultDependencies = (): VoiceCaptureDependencies => ({
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  createAudioContext: () => new AudioContext({ sampleRate: AI_VOICE_SAMPLE_RATE_HZ }) as unknown as VoiceAudioContext,
  createWorkletNode: (context) => new AudioWorkletNode(
    context as unknown as BaseAudioContext,
    WORKLET_PROCESSOR_NAME,
    { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }
  ) as unknown as VoiceWorkletNode,
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints) as unknown as Promise<VoiceMediaStream>,
  now: () => performance.now(),
  requestFrame: (callback) => window.requestAnimationFrame(callback)
});

const waveformLevels = (samples: Float32Array): number[] => {
  if (!samples.length) {
    return Array.from({ length: AI_VOICE_WAVEFORM_BAR_COUNT }, () => 0);
  }
  return Array.from({ length: AI_VOICE_WAVEFORM_BAR_COUNT }, (_, index) => {
    const start = Math.floor(index * samples.length / AI_VOICE_WAVEFORM_BAR_COUNT);
    const end = Math.max(start + 1, Math.floor((index + 1) * samples.length / AI_VOICE_WAVEFORM_BAR_COUNT));
    let energy = 0;
    for (let sampleIndex = start; sampleIndex < Math.min(end, samples.length); sampleIndex += 1) {
      const sample = samples[sampleIndex] ?? 0;
      energy += sample * sample;
    }
    const count = Math.max(1, Math.min(end, samples.length) - start);
    return Math.min(1, Math.sqrt(energy / count) * 4);
  });
};

export async function startVoiceCapture({
  dependencies = defaultDependencies(),
  maxSamples = AI_VOICE_MAX_SAMPLES,
  onLimit,
  onWaveform
}: StartVoiceCaptureOptions): Promise<VoiceCaptureSession> {
  const stream = await dependencies.getUserMedia({
    audio: {
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: AI_VOICE_SAMPLE_RATE_HZ
    },
    video: false
  });

  let context: VoiceAudioContext | null = null;
  let source: VoiceAudioNode | null = null;
  let worklet: VoiceWorkletNode | null = null;
  let silentGain: VoiceGainNode | null = null;
  let frameHandle: number | null = null;
  let finished = false;
  let limitReported = false;
  let totalSamples = 0;
  let lastWaveformAt = Number.NEGATIVE_INFINITY;
  const chunks: Float32Array[] = [];

  const cleanup = async (): Promise<void> => {
    if (finished) return;
    finished = true;
    if (frameHandle !== null) {
      dependencies.cancelFrame(frameHandle);
      frameHandle = null;
    }
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.port.close();
    }
    for (const node of [source, worklet, silentGain]) {
      try { node?.disconnect(); } catch { /* already disconnected */ }
    }
    stream.getTracks().forEach((track) => track.stop());
    if (context) {
      try { await context.close(); } catch { /* already closed */ }
    }
  };

  try {
    context = dependencies.createAudioContext();
    if (context.sampleRate !== AI_VOICE_SAMPLE_RATE_HZ) {
      throw new Error(`voice.capture.sample-rate:${context.sampleRate}`);
    }
    await context.audioWorklet.addModule(WORKLET_MODULE_URL);
    source = context.createMediaStreamSource(stream);
    worklet = dependencies.createWorkletNode(context);
    silentGain = context.createGain();
    silentGain.gain.value = 0;
    source.connect(worklet);
    worklet.connect(silentGain);
    silentGain.connect(context.destination);

    worklet.port.onmessage = (event) => {
      if (finished || !(event.data instanceof Float32Array) || !event.data.length) return;
      const remaining = Math.max(0, maxSamples - totalSamples);
      const accepted = event.data.slice(0, remaining);
      if (accepted.length) {
        chunks.push(accepted);
        totalSamples += accepted.length;
      }
      const now = dependencies.now();
      if (accepted.length && frameHandle === null && now - lastWaveformAt >= WAVEFORM_FRAME_INTERVAL_MS) {
        lastWaveformAt = now;
        frameHandle = dependencies.requestFrame(() => {
          frameHandle = null;
          if (!finished) onWaveform(waveformLevels(accepted));
        });
      }
      if (totalSamples >= maxSamples && !limitReported) {
        limitReported = true;
        onLimit();
      }
    };
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    cancel: async () => {
      chunks.length = 0;
      totalSamples = 0;
      await cleanup();
    },
    sampleCount: () => totalSamples,
    stop: async () => {
      const pcm = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }
      chunks.length = 0;
      await cleanup();
      return pcm;
    }
  };
}
