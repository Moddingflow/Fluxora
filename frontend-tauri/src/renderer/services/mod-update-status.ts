import type {
  FluxoraModOrderItem,
  FluxoraModUpdateCheckReason,
  FluxoraModUpdateCheckResult
} from '../../shared/fluxora-api';

export type ModUpdateResultsByProject = Record<string, FluxoraModUpdateCheckResult>;

export interface ModUpdateFreshnessView {
  label: string | null;
  title: string;
  tone: 'confirmed' | 'warning';
}

export const modUpdateProjectKey = (projectDirectory: string): string =>
  projectDirectory.trim().replaceAll('/', '\\').toLocaleLowerCase('en-US');

export const rememberModUpdateResult = (
  current: ModUpdateResultsByProject,
  projectDirectory: string,
  result: FluxoraModUpdateCheckResult
): ModUpdateResultsByProject => ({
  ...current,
  [modUpdateProjectKey(projectDirectory)]: result
});

const reasonText = (reason: FluxoraModUpdateCheckReason): string => {
  switch (reason) {
    case 'authenticationUnavailable':
      return 'недоступна авторизация Nexus';
    case 'quotaReserve':
      return 'достигнут резерв API-квоты';
    case 'rateLimited':
      return 'Nexus временно ограничил частоту запросов';
    case 'offlineBackoff':
    case 'networkError':
      return 'сеть или Nexus временно недоступны';
    case 'ambiguousMetadata':
      return 'метаданные файлов неоднозначны';
    case 'metadataUnavailable':
      return 'метаданные файлов недоступны';
    case 'cancelled':
      return 'проверка отменена';
    case 'dailyTtl':
      return 'повторная автоматическая проверка ещё не требуется';
    case 'noEligibleMods':
      return 'нет модов с полной Nexus identity';
    case 'none':
      return 'часть модов не удалось проверить';
  }
};

const partialReasonSuffix = (result?: FluxoraModUpdateCheckResult): string =>
  result?.state === 'partial' ? ` Последний partial-результат: ${reasonText(result.reason)}.` : '';

export const modUpdateFreshnessView = (
  item: FluxoraModOrderItem,
  lastResult?: FluxoraModUpdateCheckResult
): ModUpdateFreshnessView => {
  const state = (item.updateCheckState ?? '').trim().toLocaleLowerCase('en-US');
  if (state === 'baseline_pending') {
    return {
      label: 'Не проверено',
      title: `Показана импортированная версия; Nexus ещё не подтвердил её.${partialReasonSuffix(lastResult)}`,
      tone: 'warning'
    };
  }
  if (state === 'recheck_required') {
    return {
      label: 'Требуется проверка',
      title: `Сохранено последнее известное значение, но его нужно проверить повторно.${partialReasonSuffix(lastResult)}`,
      tone: 'warning'
    };
  }
  return {
    label: null,
    title: state === 'completed' ? 'Версия подтверждена последней успешной проверкой.' : '',
    tone: 'confirmed'
  };
};

export const modUpdateTransientMessage = (
  result: FluxoraModUpdateCheckResult | undefined
): string | null => {
  if (result?.state !== 'partial') {
    return null;
  }
  return `Проверка обновлений завершена частично: ${reasonText(result.reason)}. Последние успешно известные версии сохранены.`;
};
