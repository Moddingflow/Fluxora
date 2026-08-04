import { describe, expect, it } from 'vitest';

import type {
  FluxoraModOrderItem,
  FluxoraModUpdateCheckResult
} from '../src/shared/fluxora-api';
import {
  modUpdateFreshnessView,
  modUpdateTransientMessage,
  rememberModUpdateResult
} from '../src/renderer/services/mod-update-status';

const result = (
  state: FluxoraModUpdateCheckResult['state'],
  reason: FluxoraModUpdateCheckResult['reason']
): FluxoraModUpdateCheckResult => ({
  state,
  reason,
  nextEligibleAt: '',
  quota: {
    hourlyLimit: -1,
    hourlyRemaining: -1,
    hourlyResetAt: '',
    dailyLimit: -1,
    dailyRemaining: -1,
    dailyResetAt: '',
    capturedAt: ''
  },
  counters: {
    apiRequests: 0,
    cacheHits: 0,
    checked: 0,
    updates: 0,
    ambiguous: 0,
    failed: 1
  },
  mods: []
});

const item = (updateCheckState: string): FluxoraModOrderItem => ({
  id: 'C:\\Builds\\A\\mods\\TDM',
  name: 'True Directional Movement',
  version: '2.2.6',
  latestVersion: '2.2.6',
  latestFileId: '100',
  updateCheckState,
  lastCheckedAt: '',
  updateStatus: '',
  conflictStatus: '',
  fileCount: 1,
  conflictingFileCount: 0,
  overwrittenFileCount: 0,
  overwritingFileCount: 0,
  isEnabled: true,
  canCheckUpdates: true,
  hasUpdate: false,
  sourceIsNexus: true,
  sourceIsModdingFlow: false,
  isLocal: false,
  isTranslation: false,
  isPatch: false,
  overwritesModIds: [],
  overwrittenByModIds: [],
  orderId: 'mod_tdm',
  kind: 'mod',
  order: 0,
  isSeparator: false,
  isMod: true,
  modUuid: 'uuid-tdm',
  separatorTitle: ''
});

describe('mod update status', () => {
  it('keeps the last partial reason separately for every build', () => {
    const partial = result('partial', 'authenticationUnavailable');
    const completed = result('completed', 'none');
    let byProject = rememberModUpdateResult({}, 'C:\\Builds\\A', partial);
    byProject = rememberModUpdateResult(byProject, 'C:\\Builds\\B', completed);

    expect(byProject['c:\\builds\\a']).toBe(partial);
    expect(byProject['c:\\builds\\b']).toBe(completed);
  });

  it('keeps baseline and recheck freshness internal instead of showing persistent warnings', () => {
    const partial = result('partial', 'authenticationUnavailable');

    expect(modUpdateFreshnessView(item('completed'), partial)).toMatchObject({
      label: null,
      tone: 'confirmed'
    });
    expect(modUpdateFreshnessView(item('baseline_pending'), partial)).toMatchObject({
      label: null,
      tone: 'confirmed'
    });
    expect(modUpdateFreshnessView(item('recheck_required'), partial)).toMatchObject({
      label: null,
      tone: 'confirmed'
    });
  });

  it('treats older rows without a freshness field as unknown instead of crashing the table', () => {
    const legacyItem = { ...item(''), updateCheckState: undefined } as unknown as FluxoraModOrderItem;

    expect(modUpdateFreshnessView(legacyItem)).toMatchObject({
      label: null,
      tone: 'confirmed'
    });
  });

  it('keeps a short manual-only partial message without a persistent warning model', () => {
    expect(modUpdateTransientMessage(result('partial', 'authenticationUnavailable'), 'ru-RU'))
      .toContain('авторизация Nexus');
    expect(modUpdateTransientMessage(result('partial', 'metadataUnavailable'), 'ru-RU'))
      .toContain('метаданные файлов недоступны');
    expect(modUpdateTransientMessage(result('completed', 'none'))).toBeNull();
  });
});
