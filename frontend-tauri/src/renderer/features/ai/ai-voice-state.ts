export type AiVoicePhase =
  | 'idle'
  | 'requesting-permission'
  | 'preparing'
  | 'recording'
  | 'transcribing'
  | 'error';

export type AiVoiceCompletionMode = 'draft' | 'send';

export interface AiVoiceError {
  code: string;
  userMessage: string;
  stage: string;
  operationId: string;
  debugMessage?: string;
  canOpenMicrophoneSettings?: boolean;
  canRetry?: boolean;
}

export interface AiVoiceState {
  completionMode: AiVoiceCompletionMode | null;
  elapsedMs: number;
  error: AiVoiceError | null;
  levels: number[];
  operationId: string | null;
  ownerChatId: string;
  phase: AiVoicePhase;
}

export type AiVoiceAction =
  | { type: 'permission-requested'; operationId: string }
  | { type: 'permission-granted' }
  | { type: 'recording-started' }
  | { type: 'waveform-updated'; levels: number[] }
  | { type: 'elapsed-updated'; elapsedMs: number }
  | { type: 'transcription-started'; completionMode: AiVoiceCompletionMode }
  | { type: 'failed'; error: AiVoiceError }
  | { type: 'reset' }
  | { type: 'owner-changed'; chatId: string };

export const AI_VOICE_WAVEFORM_BAR_COUNT = 32;

const emptyLevels = (): number[] => Array.from(
  { length: AI_VOICE_WAVEFORM_BAR_COUNT },
  () => 0
);

export const createInitialVoiceState = (ownerChatId: string): AiVoiceState => ({
  completionMode: null,
  elapsedMs: 0,
  error: null,
  levels: emptyLevels(),
  operationId: null,
  ownerChatId,
  phase: 'idle'
});

export const appendVoiceTranscript = (draft: string, transcript: string): string => {
  const normalizedDraft = draft.trimEnd();
  const normalizedTranscript = transcript.trim();
  if (!normalizedDraft) return normalizedTranscript;
  if (!normalizedTranscript) return normalizedDraft;
  return `${normalizedDraft} ${normalizedTranscript}`;
};

export function voiceStateReducer(state: AiVoiceState, action: AiVoiceAction): AiVoiceState {
  switch (action.type) {
    case 'permission-requested':
      return {
        ...createInitialVoiceState(state.ownerChatId),
        operationId: action.operationId,
        phase: 'requesting-permission'
      };
    case 'permission-granted':
      return { ...state, error: null, phase: 'preparing' };
    case 'recording-started':
      return { ...state, error: null, phase: 'recording' };
    case 'waveform-updated':
      return {
        ...state,
        levels: action.levels.slice(0, AI_VOICE_WAVEFORM_BAR_COUNT)
      };
    case 'elapsed-updated':
      return { ...state, elapsedMs: Math.max(0, action.elapsedMs) };
    case 'transcription-started':
      return { ...state, completionMode: action.completionMode, phase: 'transcribing' };
    case 'failed':
      return { ...state, completionMode: null, error: action.error, phase: 'error' };
    case 'reset':
      return createInitialVoiceState(state.ownerChatId);
    case 'owner-changed':
      return action.chatId === state.ownerChatId ? state : createInitialVoiceState(action.chatId);
  }
}

export const formatVoiceDuration = (elapsedMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
