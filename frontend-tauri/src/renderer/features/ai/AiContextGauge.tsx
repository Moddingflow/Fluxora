import type { FluxoraAiContextUsage } from '../../../shared/fluxora-api';
import { useLocalization } from '../../../localization/react';

export interface AiContextGaugeProps {
  estimateState?: 'idle' | 'counting' | 'ready' | 'error';
  usage?: FluxoraAiContextUsage | null;
}

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The filled share of the model input window, drawn as one ring next to the
 * send button. The exact numbers stay in the accessible label so the control
 * itself never competes with the message the user is writing.
 */
export function AiContextGauge({ estimateState, usage }: AiContextGaugeProps) {
  const { t, locale } = useLocalization();
  if (!usage) {
    return null;
  }

  const tokenNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const percent = Math.min(100, Math.max(0, usage.currentContextPercent));
  const label = t('ai.context.gauge', {
    current: tokenNumber.format(usage.currentContextTokens),
    percent: new Intl.NumberFormat(locale, { maximumFractionDigits: percent < 10 ? 1 : 0 })
      .format(percent),
    total: tokenNumber.format(usage.contextWindowTokens)
  });
  const detail = t('ai.context.tooltip', {
    limit: tokenNumber.format(usage.modelOutputTokenLimit ?? 0),
    precision: usage.precision
  });

  return (
    <span
      aria-label={label}
      className="ai-context-usage"
      data-level={usage.level}
      data-state={estimateState}
      role="img"
      title={`${label}\n${detail}`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
        <circle className="ai-context-usage__track" cx="10" cy="10" r={RADIUS} />
        <circle
          className="ai-context-usage__fill"
          cx="10"
          cy="10"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
        />
      </svg>
    </span>
  );
}
