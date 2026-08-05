import type {
  FluxoraAiQuotaAvailability,
  FluxoraAiQuotaSnapshot,
  FluxoraAiQuotaTier
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
  onOpenBilling?: () => void;
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

// The rail fills as the monthly allowance is consumed, so a nearly full bar
// always reads as "almost out" regardless of plan size.
const quotaLevel = (
  availability: QuantitativeAvailability,
  usedPercent: number
) => {
  if (availability === 'quotaExhausted' || usedPercent >= 90) return 'critical';
  if (availability !== 'available' || usedPercent >= 75) return 'warning';
  return 'healthy';
};

const planKey = (tier: FluxoraAiQuotaTier): TranslationKey => {
  if (tier === 'free') return 'ai.quota.plan.free';
  if (tier === 'premium') return 'ai.quota.plan.premium';
  return 'ai.quota.agentLimit';
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

export function AiQuotaIndicator({ language, quota, onOpenBilling }: AiQuotaIndicatorProps) {
  if (!quota) return null;

  const locale = normalizeAppLocale(language);
  const copy = {
    agentLimit: translateForLanguage(language, 'ai.quota.agentLimit'),
    byokDetail: translateForLanguage(language, 'ai.quota.byokDetail'),
    byokTitle: translateForLanguage(language, 'ai.quota.byokTitle'),
    resets: translateForLanguage(language, 'ai.quota.resets'),
    search: translateForLanguage(language, 'ai.quota.search'),
    section: translateForLanguage(language, 'ai.quota.section'),
    upgrade: translateForLanguage(language, 'ai.quota.upgrade'),
    used: translateForLanguage(language, 'ai.quota.used')
  };
  const stateCopy = (availability: FluxoraAiQuotaAvailability) => translateForLanguage(
    language,
    `ai.quota.state.${availability}` as TranslationKey
  );
  const formattedReset = resetTime(locale, quota.resetAt);
  const planLabel = translateForLanguage(language, planKey(quota.tier));

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

  // Reserved cost belongs to requests already in flight, so it counts as spent
  // until the run settles. Otherwise the rail would jump backwards mid-run.
  const usedPercent = clampPercent((quota.used + quota.reserved) / quota.limit * 100);
  const progressLabel = translateForLanguage(language, 'ai.quota.progress', {
    percent: usedPercent,
    plan: planLabel,
    used: copy.used
  });
  const stateMessage = quota.availability === 'available'
    ? null
    : stateCopy(quota.availability);

  return (
    <section
      aria-label={copy.section}
      className="ai-quota-usage"
      data-level={quotaLevel(quota.availability, usedPercent)}
      data-state={quota.availability}
      data-tier={quota.tier}
    >
      <span className="ai-quota-usage__primary">
        <span className="ai-quota-usage__heading">
          <span>{planLabel}</span>
          <strong>{usedPercent}% {copy.used}</strong>
        </span>
        <span
          aria-label={progressLabel}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={usedPercent}
          className="ai-quota-usage__track"
          role="progressbar"
        >
          <span
            aria-hidden="true"
            className="ai-quota-usage__track-fill"
            style={{ transform: `scaleX(${usedPercent / 100})` }}
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
        {quota.tier === 'free' && onOpenBilling ? (
          <button
            className="ai-quota-usage__upgrade"
            onClick={onOpenBilling}
            type="button"
          >
            {copy.upgrade}
          </button>
        ) : null}
      </span>
    </section>
  );
}
