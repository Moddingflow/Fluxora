import { describe, expect, it } from 'vitest';

import {
  applyWorkspaceDelta,
  type WorkspaceDeltaState
} from '../src/renderer/services/workspace-delta-state';
import type {
  FluxoraInstalledMod,
  FluxoraInstalledModSummary,
  FluxoraModOrderItem,
  FluxoraPluginOrderItem,
  FluxoraWorkspaceDelta
} from '../src/shared/fluxora-api';

const mod = (orderId: string, version = '1'): FluxoraModOrderItem =>
  ({ id: orderId, orderId, modUuid: orderId, version } as FluxoraModOrderItem);
const plugin = (orderId: string, isEnabled = true): FluxoraPluginOrderItem =>
  ({ id: orderId, orderId, isEnabled } as FluxoraPluginOrderItem);
const installed = (id: string, version = '1'): FluxoraInstalledMod =>
  ({
    id,
    name: id,
    version,
    latestVersion: '',
    latestFileId: '',
    updateCheckState: '',
    lastCheckedAt: '',
    updateStatus: '',
    conflictStatus: '',
    fileCount: 0,
    conflictingFileCount: 0,
    overwrittenFileCount: 0,
    overwritingFileCount: 0,
    isEnabled: true,
    canCheckUpdates: false,
    hasUpdate: false,
    sourceIsNexus: false,
    sourceIsModdingFlow: false,
    isLocal: true,
    isTranslation: false,
    isPatch: false,
    overwritesModIds: [],
    overwrittenByModIds: []
  });
const installedSummary = (id: string, version: string): FluxoraInstalledModSummary =>
  ({
    ...installed(id, version),
    modUuid: id,
    orderId: id,
    operationId: 'install-1',
    fileCount: 0,
    conflictingFileCount: 0,
    overwrittenFileCount: 0,
    overwritingFileCount: 0,
    overwritesModIds: [],
    overwrittenByModIds: []
  });

const initialState = (): WorkspaceDeltaState => {
  const modA = mod('a');
  const modB = mod('b');
  const modC = mod('c');
  const pluginA = plugin('p-a');
  const pluginB = plugin('p-b');
  return {
    projectDirectory: 'C:\\Build',
    profileName: 'Default',
    revision: 'rev-1',
    sequence: 1,
    mods: [modA, modB, modC],
    installedMods: [installed('a'), installed('b'), installed('c')],
    plugins: [pluginA, pluginB]
  };
};

const delta = (
  overrides: Partial<FluxoraWorkspaceDelta> = {}
): FluxoraWorkspaceDelta => ({
  projectDirectory: 'C:\\Build',
  profileName: 'Default',
  operationId: 'install-1',
  sequence: 2,
  mods: {
    baseRevision: 'rev-1',
    revision: 'rev-2',
    upserts: [mod('b', '2'), mod('d')],
    removedOrderIds: ['c'],
    placements: [
      { orderId: 'd', afterOrderId: 'a' },
      { orderId: 'b', afterOrderId: 'd' }
    ]
  },
  installedModUpserts: [installedSummary('b', '2'), installedSummary('d', '1')],
  removedInstalledModIds: ['c'],
  plugins: {
    baseRevision: 'rev-1',
    revision: 'rev-2',
    upserts: [plugin('p-b', false), plugin('p-c')],
    removedOrderIds: ['p-a'],
    placements: [{ orderId: 'p-c', beforeOrderId: 'p-b' }]
  },
  fullResyncRequired: false,
  ...overrides
});

describe('workspace delta state', () => {
  it('applies removals, upserts, and placements while retaining unchanged identity', () => {
    const state = initialState();
    const unchangedMod = state.mods[0];
    const result = applyWorkspaceDelta(state, delta(), {
      expectedOperationId: 'install-1'
    });

    expect(result.status).toBe('applied');
    expect(result.state.mods.map((item) => item.orderId)).toEqual(['a', 'd', 'b']);
    expect(result.state.plugins.map((item) => item.orderId)).toEqual(['p-c', 'p-b']);
    expect(result.state.installedMods.map((item) => `${item.id}:${item.version}`))
      .toEqual(['a:1', 'b:2', 'd:1']);
    expect(result.state.mods[0]).toBe(unchangedMod);
    expect(result.state.revision).toBe('rev-2');
    expect(result.state.sequence).toBe(2);
  });

  it.each([
    ['stale base', delta({
      mods: { ...delta().mods, baseRevision: 'old' }
    })],
    ['revision disagreement', delta({
      plugins: { ...delta().plugins, revision: 'other-revision' }
    })],
    ['sequence gap', delta({ sequence: 4 })],
    ['wrong operation', delta({ operationId: 'other-operation' })],
    ['wrong scope', delta({ profileName: 'Other' })]
  ])('rejects %s and requests exactly one full resync', (_name, incoming) => {
    const result = applyWorkspaceDelta(initialState(), incoming, {
      expectedOperationId: 'install-1'
    });

    expect(result.status).toBe('full-resync-required');
    expect(result.state).toEqual(initialState());
  });

  it('propagates native full-resync-required without mutating the current snapshot', () => {
    const state = initialState();
    const result = applyWorkspaceDelta(state, delta({ fullResyncRequired: true }));

    expect(result.status).toBe('full-resync-required');
    expect(result.state).toBe(state);
    expect(result.reason).toBe('native-history-unavailable');
  });

  it('deduplicates an already-applied sequence and revision', () => {
    const state = { ...initialState(), revision: 'rev-2', sequence: 2 };
    const result = applyWorkspaceDelta(state, delta());

    expect(result.status).toBe('ignored');
    expect(result.state).toBe(state);
    expect(result.reason).toBe('duplicate');
  });
});
