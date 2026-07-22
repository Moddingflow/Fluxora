import type {
  FluxoraApi,
  FluxoraVoiceTranscriptionRequest,
  FluxoraVoiceTranscriptionResult
} from '../../../shared/fluxora-api';

export const AI_VOICE_TRANSCRIPTION_WATCHDOG_MIN_MS = 20_000;
export const AI_VOICE_TRANSCRIPTION_WATCHDOG_MAX_MS = 305_000;

type VoiceTranscriptionApi = Pick<
  FluxoraApi['ai'],
  'cancelVoiceTranscription' | 'transcribeVoice'
>;

export const voiceTranscriptionWatchdogMs = (durationMs: number): number =>
  Math.min(
    AI_VOICE_TRANSCRIPTION_WATCHDOG_MAX_MS,
    Math.max(
      AI_VOICE_TRANSCRIPTION_WATCHDOG_MIN_MS,
      Math.max(0, durationMs) * 2 + 15_000
    )
  );

export async function transcribeVoiceWithWatchdog(
  api: VoiceTranscriptionApi,
  pcm: Uint8Array,
  metadata: FluxoraVoiceTranscriptionRequest
): Promise<FluxoraVoiceTranscriptionResult> {
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<never>((_resolve, reject) => {
    watchdog = setTimeout(() => {
      void api.cancelVoiceTranscription(metadata.operationId ?? 'voice-unknown')
        .catch(() => undefined);
      reject({
        code: 'speech.host.timeout',
        message: 'The renderer watchdog stopped an unresponsive local speech request.',
        operationId: metadata.operationId ?? 'voice-unknown',
        stage: 'transcribe'
      });
    }, voiceTranscriptionWatchdogMs(metadata.durationMs));
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => api.transcribeVoice(pcm, metadata)),
      timedOut
    ]);
  } finally {
    if (watchdog !== null) clearTimeout(watchdog);
  }
}
