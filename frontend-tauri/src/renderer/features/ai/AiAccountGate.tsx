import { useState } from 'react';

import { moddingFlowIcon } from '../../design-system/assets';

interface AiAccountGateProps {
  language: string;
  onConnect: () => void | Promise<void>;
  onCreateAccount: () => void | Promise<void>;
}
const copyByLocale = {
  de: {
    body: 'Dein Konto bestätigt Premium sicher und ordnet jede Agentennutzung dem richtigen Limit zu.',
    connect: 'Anmelden',
    connecting: 'Anmeldung läuft…',
    create: 'Konto erstellen',
    creating: 'Wird geöffnet…',
    error: 'ModdingFlow konnte nicht geöffnet werden. Versuche es erneut.',
    noAccount: 'Noch kein Konto?',
    title: 'Bei ModdingFlow anmelden'
  },
  en: {
    body: 'Your account securely confirms Premium and applies the correct limits to every agent run.',
    connect: 'Sign in',
    connecting: 'Signing in…',
    create: 'Create account',
    creating: 'Opening…',
    error: 'ModdingFlow could not be opened. Try again.',
    noAccount: 'No account?',
    title: 'Sign in to ModdingFlow'
  },
  ru: {
    body: 'Аккаунт нужен, чтобы безопасно подтвердить Premium и применить ваши лимиты к каждому запуску агента.',
    connect: 'Войти',
    connecting: 'Входим…',
    create: 'Создать аккаунт',
    creating: 'Открываем…',
    error: 'Не удалось открыть ModdingFlow. Попробуйте ещё раз.',
    noAccount: 'Нет аккаунта?',
    title: 'Войдите в ModdingFlow'
  }
} as const;

type AccountGateLocale = keyof typeof copyByLocale;
type BusyAction = 'connect' | 'create' | null;

const localeForLanguage = (language: string): AccountGateLocale => {
  const normalized = language.trim().toLowerCase();
  if (normalized.startsWith('de')) return 'de';
  if (normalized.startsWith('ru')) return 'ru';
  return 'en';
};

export function AiAccountGate({ language, onConnect, onCreateAccount }: AiAccountGateProps) {
  const copy = copyByLocale[localeForLanguage(language)];
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: Exclude<BusyAction, null>, callback: () => void | Promise<void>) => {
    if (busyAction) return;
    setBusyAction(action);
    setError(null);
    try {
      await callback();
    } catch {
      setError(copy.error);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="ai-account-gate" aria-labelledby="ai-account-gate-title">
      <div className="ai-account-gate__identity" aria-hidden="true">
        <img src={moddingFlowIcon} alt="" />
      </div>
      <div className="ai-account-gate__copy">
        <h2 id="ai-account-gate-title">{copy.title}</h2>
        <p>{copy.body}</p>
      </div>
      <button
        className="primary-button ai-account-gate__primary"
        type="button"
        disabled={busyAction !== null}
        onClick={() => void run('connect', onConnect)}
      >
        {busyAction === 'connect' ? copy.connecting : copy.connect}
      </button>
      <p className="ai-account-gate__register">
        <span>{copy.noAccount}</span>
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => void run('create', onCreateAccount)}
        >
          {busyAction === 'create' ? copy.creating : copy.create}
        </button>
      </p>
      {error ? <p className="ai-account-gate__error" role="alert">{error}</p> : null}
    </section>
  );
}
