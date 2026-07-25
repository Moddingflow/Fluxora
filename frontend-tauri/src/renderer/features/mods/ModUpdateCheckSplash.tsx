import type { FluxoraOperationProgress } from '../../../shared/fluxora-api';
import { LoadingSplash } from '../../design-system';

export interface ModUpdateCheckSplashState {
  operationId: string;
  progress: number | null;
  statusText: string;
  currentItem: string;
}

export const createModUpdateCheckSplashState = (
  operationId: string
): ModUpdateCheckSplashState => ({
  operationId,
  progress: null,
  statusText: 'Подготавливаем проверку',
  currentItem: ''
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
      ? `Проверено ${Math.min(completed, total)} из ${total}`
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
  if (!state) {
    return null;
  }

  const detail = state.currentItem
    ? `${state.statusText} · ${state.currentItem}`
    : state.statusText;

  return (
    <LoadingSplash
      aria-label="Проверка обновлений модов"
      className="mod-update-check-splash"
      detail={detail}
      indeterminate={state.progress === null}
      messageIntervalMs={0}
      messages={['Проверяем обновления модов']}
      open
      progress={state.progress ?? 0}
      subtitle={detail}
      title="Проверяем обновления модов"
    />
  );
};
