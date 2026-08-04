import type {
  FluxoraModOrderItem,
  FluxoraModUpdateCheckReason,
  FluxoraModUpdateCheckResult
} from '../../shared/fluxora-api';
import { translateForLanguage, type TranslationKey } from '../../localization';

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

const reasonText = (reason: FluxoraModUpdateCheckReason, language: string): string => {
  let key: TranslationKey;
  switch (reason) {
    case 'authenticationUnavailable':
      key = 'modUpdate.reason.authenticationUnavailable';
      break;
    case 'quotaReserve':
      key = 'modUpdate.reason.quotaReserve';
      break;
    case 'rateLimited':
      key = 'modUpdate.reason.rateLimited';
      break;
    case 'offlineBackoff':
    case 'networkError':
      key = 'modUpdate.reason.network';
      break;
    case 'ambiguousMetadata':
      key = 'modUpdate.reason.ambiguousMetadata';
      break;
    case 'metadataUnavailable':
      key = 'modUpdate.reason.metadataUnavailable';
      break;
    case 'cancelled':
      key = 'modUpdate.reason.cancelled';
      break;
    case 'dailyTtl':
      key = 'modUpdate.reason.dailyTtl';
      break;
    case 'noEligibleMods':
      key = 'modUpdate.reason.noEligibleMods';
      break;
    case 'none':
      key = 'modUpdate.reason.none';
      break;
  }
  return translateForLanguage(language, key);
};

export const modUpdateFreshnessView = (
  item: FluxoraModOrderItem,
  _lastResult?: FluxoraModUpdateCheckResult,
  language = 'en-US'
): ModUpdateFreshnessView => {
  const state = (item.updateCheckState ?? '').trim().toLocaleLowerCase('en-US');
  if (state === 'baseline_pending' || state === 'recheck_required') {
    return {
      label: null,
      title: translateForLanguage(language, 'modUpdate.freshness.lastKnown'),
      tone: 'confirmed'
    };
  }
  return {
    label: null,
    title: state === 'completed'
      ? translateForLanguage(language, 'modUpdate.freshness.confirmed')
      : '',
    tone: 'confirmed'
  };
};

export const modUpdateTransientMessage = (
  result: FluxoraModUpdateCheckResult | undefined,
  language = 'en-US'
): string | null => {
  if (result?.state !== 'partial') {
    return null;
  }
  return translateForLanguage(language, 'modUpdate.partial', {
    reason: reasonText(result.reason, language)
  });
};
