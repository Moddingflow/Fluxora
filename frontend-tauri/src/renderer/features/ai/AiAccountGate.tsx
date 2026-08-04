import { useState } from 'react';

import { translateForLanguage } from '../../../localization';
import { moddingFlowIcon } from '../../design-system/assets';

interface AiAccountGateProps {
  language: string;
  onConnect: () => void | Promise<void>;
  onCreateAccount: () => void | Promise<void>;
}
type BusyAction = 'connect' | 'create' | null;

export function AiAccountGate({ language, onConnect, onCreateAccount }: AiAccountGateProps) {
  const copy = {
    body: translateForLanguage(language, 'ai.account.body'),
    connect: translateForLanguage(language, 'ai.account.connect'),
    connecting: translateForLanguage(language, 'ai.account.connecting'),
    create: translateForLanguage(language, 'ai.account.create'),
    creating: translateForLanguage(language, 'ai.account.creating'),
    error: translateForLanguage(language, 'ai.account.error'),
    noAccount: translateForLanguage(language, 'ai.account.noAccount'),
    title: translateForLanguage(language, 'ai.account.title')
  };
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
