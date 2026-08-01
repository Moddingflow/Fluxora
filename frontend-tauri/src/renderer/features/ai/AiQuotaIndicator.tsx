import type {
  FluxoraAiQuotaAvailability,
  FluxoraAiQuotaSnapshot
} from '../../../shared/fluxora-api';

interface AiQuotaIndicatorProps {
  language: string;
  quota?: FluxoraAiQuotaSnapshot | null;
}

const copyByLocale = {
  'de-DE': {
    agentLimit: 'Agent-Limit',
    byokDetail: 'Fluxora-Kontingent bleibt unberührt.',
    byokTitle: 'Eigener Schlüssel',
    remaining: 'verbleibend',
    resets: 'Neu ab',
    search: 'Search',
    section: 'Nutzungslimits des Agenten',
    states: {
      available: 'Nutzungsdaten werden geladen.',
      connectionRequired: 'Fluxora-Konto verbinden, um das Kontingent zu sehen.',
      disabled: 'Managed AI ist deaktiviert.',
      premiumRequired: 'Premium ist für Managed AI erforderlich.',
      quotaExhausted: 'Agent-Limit aufgebraucht',
      rateLimited: 'Kurzzeitig begrenzt',
      searchQuotaExhausted: 'Search-Limit aufgebraucht',
      temporaryServerError: 'Limits sind vorübergehend nicht verfügbar.'
    }
  },
  'en-US': {
    agentLimit: 'Agent limit',
    byokDetail: 'Fluxora quota is not used.',
    byokTitle: 'Personal key',
    remaining: 'remaining',
    resets: 'Resets',
    search: 'Search',
    section: 'Agent usage limits',
    states: {
      available: 'Usage data is loading.',
      connectionRequired: 'Connect your Fluxora account to view the allowance.',
      disabled: 'Managed AI is disabled.',
      premiumRequired: 'Premium is required for Managed AI.',
      quotaExhausted: 'Agent limit exhausted',
      rateLimited: 'Temporarily rate limited',
      searchQuotaExhausted: 'Search limit exhausted',
      temporaryServerError: 'Limits are temporarily unavailable.'
    }
  },
  'ru-RU': {
    agentLimit: 'Лимит агента',
    byokDetail: 'Квота Fluxora не расходуется.',
    byokTitle: 'Личный ключ',
    remaining: 'осталось',
    resets: 'Обновится',
    search: 'Поиск',
    section: 'Лимиты использования агента',
    states: {
      available: 'Данные об использовании загружаются.',
      connectionRequired: 'Подключите аккаунт Fluxora, чтобы увидеть квоту.',
      disabled: 'Managed AI отключён.',
      premiumRequired: 'Для Managed AI требуется Premium.',
      quotaExhausted: 'Лимит агента исчерпан',
      rateLimited: 'Временное ограничение запросов',
      searchQuotaExhausted: 'Лимит поиска исчерпан',
      temporaryServerError: 'Лимиты временно недоступны.'
    }
  }
} as const;

type QuotaLocale = keyof typeof copyByLocale;
type QuantitativeAvailability = Extract<
  FluxoraAiQuotaAvailability,
  'available' | 'quotaExhausted' | 'rateLimited' | 'searchQuotaExhausted'
>;
const localeForLanguage = (language: string): QuotaLocale => {
  const normalized = language.toLowerCase();
  if (normalized.startsWith('ru')) return 'ru-RU';
  if (normalized.startsWith('de')) return 'de-DE';
  return 'en-US';
};

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

const resetTime = (locale: QuotaLocale, value: string | null) => {
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

  const locale = localeForLanguage(language);
  const copy = copyByLocale[locale];
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
          <span>{copy.states[quota.availability]}</span>
        </span>
        {formattedReset ? (
          <time dateTime={quota.resetAt ?? undefined}>{copy.resets} {formattedReset}</time>
        ) : null}
      </section>
    );
  }

  const remainingPercent = clampPercent(quota.remaining / quota.limit * 100);
  const progressLabel = `${copy.agentLimit}, ${remainingPercent}% ${copy.remaining}`;
  const stateMessage = quota.availability === 'available'
    ? null
    : copy.states[quota.availability];

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
