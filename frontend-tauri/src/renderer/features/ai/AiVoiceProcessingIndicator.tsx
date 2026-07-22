import { LoaderCircle, X } from 'lucide-react';

import { aiVoiceCancelLabel, aiVoiceProcessingStatus } from './ai-voice-copy';

export interface AiVoiceProcessingIndicatorProps {
  language: string;
  onCancel: () => void;
}

export function AiVoiceProcessingIndicator({
  language,
  onCancel
}: AiVoiceProcessingIndicatorProps) {
  return (
    <div className="ai-voice-processing">
      <LoaderCircle
        className="ai-voice-processing__spinner"
        size={22}
        strokeWidth={2}
        aria-hidden="true"
      />
      <span className="sr-only" role="status" aria-live="polite">
        {aiVoiceProcessingStatus(language)}
      </span>
      <button
        className="ai-voice-action ai-voice-action--stop"
        type="button"
        aria-label={aiVoiceCancelLabel(language)}
        onClick={onCancel}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
