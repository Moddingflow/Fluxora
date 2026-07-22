import { useCallback, useEffect, useReducer, useRef } from 'react';

import {
  AI_VOICE_MIN_SAMPLES,
  AI_VOICE_SAMPLE_RATE_HZ,
  startVoiceCapture,
  type VoiceCaptureSession
} from './ai-voice-capture';
import {
  appendVoiceTranscript,
  createInitialVoiceState,
  type AiVoiceCompletionMode,
  type AiVoiceError,
  type AiVoiceState,
  voiceStateReducer
} from './ai-voice-state';
import { aiVoiceErrorMessage } from './ai-voice-copy';
import {
  aiMicrophonePermissionChangedEvent,
  allowAiMicrophone,
  hasAiMicrophonePermission
} from './ai-microphone-permission';
import { transcribeVoiceWithWatchdog } from './ai-voice-transcription';

export interface UseAiVoiceInputOptions {
  draft: string;
  language: string;
  ownerChatId: string;
  onDraftChange: (value: string) => void;
  onSend: (prompt: string, operationId: string) => boolean | Promise<boolean>;
}

export interface AiVoiceInputController {
  allowPermission: () => Promise<void>;
  cancel: () => Promise<void>;
  denyPermission: () => Promise<void>;
  openMicrophoneSettings: () => Promise<void>;
  start: () => Promise<void>;
  state: AiVoiceState;
  stop: (completionMode: AiVoiceCompletionMode) => Promise<void>;
}

interface TypedVoiceError {
  code?: string;
  debugMessage?: string;
  message?: string;
  operationId?: string;
  stage?: string;
  userMessage?: string;
}

interface VoicePreparationOutcome {
  error?: unknown;
  ok: boolean;
}

interface ActiveVoicePreparation {
  operationId: string;
  pending: boolean;
  result: Promise<VoicePreparationOutcome>;
}

const typedVoiceError = (error: unknown): TypedVoiceError | null => {
  if (typeof error === 'string') {
    try {
      return JSON.parse(error) as TypedVoiceError;
    } catch {
      return { message: error };
    }
  }
  return error && typeof error === 'object'
    ? error as TypedVoiceError
    : null;
};

const voiceErrorStage = (code: string): string => {
  if (code.startsWith('speech.permission.')) return 'permission';
  if (code.startsWith('speech.microphone.') || code.startsWith('speech.audio.')) return 'capture';
  if (/^speech\.(?:model|vad|resources)\./.test(code) || code === 'speech.host.missing') return 'prepare';
  if (code.startsWith('speech.request.') || code.startsWith('speech.protocol.')) return 'protocol';
  return 'transcription';
};

export const voiceErrorFromUnknown = (
  error: unknown,
  language = 'en-us',
  operationId = 'voice-unknown'
): AiVoiceError => {
  const candidate = typedVoiceError(error);
  const name = error instanceof Error ? error.name : '';
  const code = name === 'NotAllowedError' || name === 'SecurityError'
    ? 'speech.permission.denied'
    : name === 'NotFoundError' || name === 'OverconstrainedError'
      ? 'speech.microphone.missing'
      : name === 'NotReadableError' || name === 'AbortError'
        ? 'speech.microphone.busy'
        : candidate?.code ?? 'speech.host.failed';
  const debugMessage = candidate?.debugMessage
    ?? candidate?.message
    ?? (error instanceof Error ? error.message : undefined);
  return {
    code,
    userMessage: aiVoiceErrorMessage(code, language),
    stage: candidate?.stage?.trim() || voiceErrorStage(code),
    operationId: candidate?.operationId?.trim() || operationId,
    ...(debugMessage?.trim() ? { debugMessage: debugMessage.trim() } : {}),
    canOpenMicrophoneSettings: code === 'speech.permission.denied',
    canRetry: ![
      'speech.model.hash-mismatch',
      'speech.model.corrupt',
      'speech.vad.hash-mismatch',
      'speech.host.missing',
      'speech.resources.missing'
    ].includes(code)
  };
};

const createVoiceOperationId = (): string => {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `ai_voice_${suffix}`;
};

export function useAiVoiceInput({
  draft,
  language,
  ownerChatId,
  onDraftChange,
  onSend
}: UseAiVoiceInputOptions): AiVoiceInputController {
  const [state, dispatch] = useReducer(
    voiceStateReducer,
    ownerChatId,
    createInitialVoiceState
  );
  const stateRef = useRef(state);
  const draftRef = useRef(draft);
  const captureRef = useRef<VoiceCaptureSession | null>(null);
  const preparationRef = useRef<ActiveVoicePreparation | null>(null);
  const generationRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  stateRef.current = state;
  draftRef.current = draft;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const disposeActive = useCallback(async (reset: boolean) => {
    generationRef.current += 1;
    clearTimer();
    const phase = stateRef.current.phase;
    const operationId = stateRef.current.operationId;
    const capture = captureRef.current;
    const preparation = preparationRef.current;
    captureRef.current = null;
    preparationRef.current = null;
    if (capture) await capture.cancel();
    if ((phase === 'transcribing' || preparation?.pending) && operationId) {
      void window.fluxora.ai.cancelVoiceTranscription(operationId).catch(() => undefined);
    }
    if (reset) dispatch({ type: 'reset' });
  }, [clearTimer]);

  const fail = useCallback(async (
    error: AiVoiceError,
    generation: number
  ) => {
    if (generation !== generationRef.current) return;
    await disposeActive(false);
    dispatch({ type: 'failed', error });
  }, [disposeActive]);

  const beginCapture = useCallback(async (operationId: string, generation: number) => {
    dispatch({ type: 'permission-granted' });
    const preparation: ActiveVoicePreparation = {
      operationId,
      pending: true,
      result: Promise.resolve({ ok: false })
    };
    preparation.result = window.fluxora.ai.prepareVoice({ operationId })
      .then<VoicePreparationOutcome>(() => ({ ok: true }))
      .catch<VoicePreparationOutcome>((error) => ({ error, ok: false }))
      .finally(() => {
        preparation.pending = false;
      });
    preparationRef.current = preparation;
    try {
      await window.fluxora.ai.armMicrophoneCapture({ operationId });
      if (generation !== generationRef.current) return;
      const capture = await startVoiceCapture({
        onLimit: () => {
          void fail(
            voiceErrorFromUnknown({ code: 'speech.audio.too-long' }, language, operationId),
            generation
          );
        },
        onWaveform: (levels) => {
          if (generation === generationRef.current) {
            dispatch({ type: 'waveform-updated', levels });
          }
        }
      });
      if (generation !== generationRef.current) {
        await capture.cancel();
        return;
      }
      captureRef.current = capture;
      startedAtRef.current = performance.now();
      dispatch({ type: 'recording-started' });
      timerRef.current = window.setInterval(() => {
        if (generation === generationRef.current) {
          dispatch({ type: 'elapsed-updated', elapsedMs: performance.now() - startedAtRef.current });
        }
      }, 100);
    } catch (error) {
      await fail(voiceErrorFromUnknown(error, language, operationId), generation);
    }
  }, [fail, language]);

  const start = useCallback(async () => {
    if (!['idle', 'error'].includes(stateRef.current.phase)) return;
    const operationId = createVoiceOperationId();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    dispatch({ type: 'permission-requested', operationId });
    if (hasAiMicrophonePermission(window.localStorage)) {
      await beginCapture(operationId, generation);
    }
  }, [beginCapture]);

  const allowPermission = useCallback(async () => {
    const current = stateRef.current;
    if (current.phase !== 'requesting-permission' || !current.operationId) return;
    allowAiMicrophone(window.localStorage);
    window.dispatchEvent(new Event(aiMicrophonePermissionChangedEvent));
    await beginCapture(current.operationId, generationRef.current);
  }, [beginCapture]);

  const denyPermission = useCallback(async () => {
    if (stateRef.current.phase !== 'requesting-permission') return;
    await disposeActive(true);
  }, [disposeActive]);

  const stop = useCallback(async (completionMode: AiVoiceCompletionMode) => {
    if (stateRef.current.phase !== 'recording' || !stateRef.current.operationId) return;
    const generation = generationRef.current;
    const operationId = stateRef.current.operationId;
    const capture = captureRef.current;
    captureRef.current = null;
    clearTimer();
    if (!capture) return;
    dispatch({ type: 'transcription-started', completionMode });
    let pcm: Float32Array;
    try {
      pcm = await capture.stop();
    } catch (error) {
      await fail(voiceErrorFromUnknown(error, language, operationId), generation);
      return;
    }
    if (generation !== generationRef.current) {
      pcm.fill(0);
      return;
    }
    if (pcm.length < AI_VOICE_MIN_SAMPLES) {
      pcm.fill(0);
      await fail(
        voiceErrorFromUnknown({ code: 'speech.audio.too-short' }, language, operationId),
        generation
      );
      return;
    }
    try {
      const preparation = preparationRef.current?.operationId === operationId
        ? preparationRef.current
        : null;
      const preparationOutcome = preparation
        ? await preparation.result
        : await window.fluxora.ai.prepareVoice({ operationId })
          .then<VoicePreparationOutcome>(() => ({ ok: true }))
          .catch<VoicePreparationOutcome>((error) => ({ error, ok: false }));
      if (preparationRef.current === preparation) preparationRef.current = null;
      if (generation !== generationRef.current) return;
      if (!preparationOutcome.ok) throw preparationOutcome.error;
      const durationMs = Math.floor(pcm.length * 1_000 / AI_VOICE_SAMPLE_RATE_HZ);
      const result = await transcribeVoiceWithWatchdog(
        window.fluxora.ai,
        new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength),
        {
          channelCount: 1,
          completionMode,
          durationMs,
          language: 'auto',
          operationId,
          sampleRateHz: 16_000
        }
      );
      if (generation !== generationRef.current) return;
      if (result.noSpeech || !result.transcript.trim()) {
        await fail(
          voiceErrorFromUnknown({ code: 'speech.no-speech' }, language, operationId),
          generation
        );
        return;
      }
      const prompt = appendVoiceTranscript(draftRef.current, result.transcript);
      if (completionMode === 'draft') {
        onDraftChange(prompt);
      } else if (!await onSend(prompt, operationId)) {
        onDraftChange(prompt);
      }
      if (generation === generationRef.current) dispatch({ type: 'reset' });
    } catch (error) {
      if (generation === generationRef.current) {
        const normalized = voiceErrorFromUnknown(error, language, operationId);
        if (normalized.code !== 'speech.cancelled') await fail(normalized, generation);
      }
    } finally {
      pcm.fill(0);
    }
  }, [clearTimer, fail, language, onDraftChange, onSend]);

  const cancel = useCallback(() => disposeActive(true), [disposeActive]);

  useEffect(() => {
    void disposeActive(false);
    dispatch({ type: 'owner-changed', chatId: ownerChatId });
  }, [disposeActive, ownerChatId]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape'
        && !['idle', 'error', 'requesting-permission'].includes(stateRef.current.phase)
      ) {
        event.preventDefault();
        void disposeActive(true);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [disposeActive]);

  useEffect(() => () => {
    void disposeActive(false);
  }, [disposeActive]);

  return {
    allowPermission,
    cancel,
    denyPermission,
    openMicrophoneSettings: () => window.fluxora.ai.openMicrophonePrivacySettings(),
    start,
    state,
    stop
  };
}
