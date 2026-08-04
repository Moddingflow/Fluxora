import type { FluxoraOperationProgress } from '../../../shared/fluxora-api';
import { translateForLanguage } from '../../../localization';
import { useLocalization } from '../../../localization/react';
import { LoadingSplash } from '../../design-system';

export interface ModUpdateCheckSplashState {
  operationId: string;
  progress: number | null;
  statusText: string;
  currentItem: string;
  language: string;
}

export const createModUpdateCheckSplashState = (
  operationId: string,
  language = 'en-US'
): ModUpdateCheckSplashState => ({
  operationId,
  progress: null,
  statusText: translateForLanguage(language, 'modUpdate.preparing'),
  currentItem: '',
  language
});

export const applyModUpdateCheckProgress = (
  current: ModUpdateCheckSplashState,
  progress: FluxoraOperationProgress
): ModUpdateCheckSplashState => {
  if (progress.operationId !== current.operationId) {
    return current;
  }

  const nextProgress = Number.isFinite(progress.overallPercent)
    ? Math.max(0, Math.min(100, progress.overallPercent))
    : current.progress;
  const completed = Number.isFinite(progress.completed)
    ? Math.max(0, Math.trunc(progress.completed ?? 0))
    : null;
  const total = Number.isFinite(progress.total)
    ? Math.max(0, Math.trunc(progress.total ?? 0))
    : null;
  const countText =
    completed !== null && total !== null && total > 0
      ? translateForLanguage(current.language, 'modUpdate.checked', {
          completed: Math.min(completed, total),
          total
        })
      : '';

  return {
    ...current,
    progress: nextProgress,
    statusText:
      countText ||
      progress.currentStep ||
      progress.statusMessage ||
      current.statusText,
    currentItem: progress.currentItem || current.currentItem
  };
};

export const ModUpdateCheckSplash = ({
  state
}: {
  state: ModUpdateCheckSplashState | null;
}) => {
  const { t } = useLocalization();
  if (!state) {
    return null;
  }

  const detail = state.currentItem
    ? `${state.statusText} · ${state.currentItem}`
    : state.statusText;

  return (
    <LoadingSplash
      aria-label={t('modUpdate.aria')}
      className="mod-update-check-splash"
      detail={detail}
      indeterminate={state.progress === null}
      messageIntervalMs={0}
      messages={[t('modUpdate.title')]}
      open
      progress={state.progress ?? 0}
      subtitle={detail}
      title={t('modUpdate.title')}
    />
  );
};
