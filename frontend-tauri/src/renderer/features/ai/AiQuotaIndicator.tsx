import type {
  FluxoraAiQuotaAvailability,
  FluxoraAiQuotaSnapshot
} from '../../../shared/fluxora-api';
import {
  normalizeAppLocale,
  translateForLanguage,
  type AppLocale,
  type TranslationKey
} from '../../../localization';

interface AiQuotaIndicatorProps {
  language: string;
  quota?: FluxoraAiQuotaSnapshot | null;
}

type QuantitativeAvailability = Extract<
  FluxoraAiQuotaAvailability,
  'available' | 'quotaExhausted' | 'rateLimited' | 'searchQuotaExhausted'
>;

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

const isQuantitativeAvailability = (
  availability: FluxoraAiQuotaAvailability
): availability is QuantitativeAvailability => (
  availability === 'available'
  || availability === 'quotaExhausted'
  || availability === 'rateLimited'
  || availability === 'searchQuotaExhausted'
);

const quotaLevel = (
  availability: QuantitativeAvailability,
  remainingPercent: number
) => {
  if (availability === 'quotaExhausted' || remainingPercent <= 10) return 'critical';
  if (availability !== 'available' || remainingPercent <= 25) return 'warning';
  return 'healthy';
};

const resetTime = (locale: AppLocale, value: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short'
  }).format(parsed);
};

export function AiQuotaIndicator({ language, quota }: AiQuotaIndicatorProps) {
  if (!quota) return null;

  const locale = normalizeAppLocale(language);
  const copy = {
    agentLimit: translateForLanguage(language, 'ai.quota.agentLimit'),
    byokDetail: translateForLanguage(language, 'ai.quota.byokDetail'),
    byokTitle: translateForLanguage(language, 'ai.quota.byokTitle'),
    remaining: translateForLanguage(language, 'ai.quota.remaining'),
    resets: translateForLanguage(language, 'ai.quota.resets'),
    search: translateForLanguage(language, 'ai.quota.search'),
    section: translateForLanguage(language, 'ai.quota.section')
  };
  const stateCopy = (availability: FluxoraAiQuotaAvailability) => translateForLanguage(
    language,
    `ai.quota.state.${availability}` as TranslationKey
  );
  const formattedReset = resetTime(locale, quota.resetAt);

  if (quota.availability === 'byok') {
    return (
      <section
        aria-label={copy.section}
        className="ai-quota-usage ai-quota-usage--status"
        data-state="byok"
        role="status"
      >
        <span aria-hidden="true" className="ai-quota-usage__status-dot" />
        <span className="ai-quota-usage__status-copy">
          <strong>{copy.byokTitle}</strong>
          <span>{copy.byokDetail}</span>
        </span>
      </section>
    );
  }

  if (!isQuantitativeAvailability(quota.availability) || quota.limit <= 0) {
    return (
      <section
        aria-label={copy.section}
        className="ai-quota-usage ai-quota-usage--status"
        data-state={quota.availability}
        role="status"
      >
        <span aria-hidden="true" className="ai-quota-usage__status-dot" />
        <span className="ai-quota-usage__status-copy">
          <strong>{copy.agentLimit}</strong>
          <span>{stateCopy(quota.availability)}</span>
        </span>
        {formattedReset ? (
          <time dateTime={quota.resetAt ?? undefined}>{copy.resets} {formattedReset}</time>
        ) : null}
      </section>
    );
  }

  const remainingPercent = clampPercent(quota.remaining / quota.limit * 100);
  const progressLabel = translateForLanguage(language, 'ai.quota.progress', {
    limit: copy.agentLimit,
    percent: remainingPercent,
    remaining: copy.remaining
  });
  const stateMessage = quota.availability === 'available'
    ? null
    : stateCopy(quota.availability);

  return (
    <section
      aria-label={copy.section}
      className="ai-quota-usage"
      data-level={quotaLevel(quota.availability, remainingPercent)}
      data-state={quota.availability}
    >
      <span className="ai-quota-usage__primary">
        <span className="ai-quota-usage__heading">
          <span>{copy.agentLimit}</span>
          <strong>{remainingPercent}% {copy.remaining}</strong>
        </span>
        <span
          aria-label={progressLabel}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={remainingPercent}
          className="ai-quota-usage__track"
          role="progressbar"
        >
          <span
            aria-hidden="true"
            className="ai-quota-usage__track-fill"
            style={{ transform: `scaleX(${remainingPercent / 100})` }}
          />
        </span>
      </span>

      <span className="ai-quota-usage__meta">
        {stateMessage ? <span data-warning="true">{stateMessage}</span> : null}
        {quota.search.limit > 0 ? (
          <span>{copy.search} <strong>{quota.search.remaining} / {quota.search.limit}</strong></span>
        ) : null}
        {formattedReset ? (
          <time dateTime={quota.resetAt ?? undefined}>{copy.resets} {formattedReset}</time>
        ) : null}
      </span>
    </section>
  );
}
