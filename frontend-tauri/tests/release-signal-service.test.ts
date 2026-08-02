import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appUpdateToolbarView } from '../src/renderer/features/update/app-update-coordinator';
import {
  createFluxoraReleaseSignalService,
  type FluxoraReleaseSignalHandlers,
  type FluxoraReleaseSignalSource
} from '../src/renderer/features/update/release-signal-service';
import type { FluxoraReleaseAnnouncement } from '../src/renderer/features/update/release-signal-contract';
import type { FluxoraUpdateStatus } from '../src/shared/fluxora-api';

const announcement = (version: string, releaseId: number) => ({
  channel: 'stable',
  github_release_id: releaseId,
  published_at: `2026-08-02T12:34:${String(releaseId % 60).padStart(2, '0')}Z`,
  tag_name: `v${version}`,
  version
});

const updateStatus = (
  state: FluxoraUpdateStatus['state'],
  currentVersion = '1.0.0',
  availableVersion?: string
): FluxoraUpdateStatus => ({ state, currentVersion, availableVersion });

class FakeReleaseSignalSource implements FluxoraReleaseSignalSource {
  handlers: FluxoraReleaseSignalHandlers | null = null;
  readonly calls: string[] = [];
  readonly snapshots: Array<unknown | Promise<unknown>> = [];
  readonly unsubscribe = vi.fn();

  subscribe(handlers: FluxoraReleaseSignalHandlers) {
    this.calls.push('subscribe');
    this.handlers = handlers;
    return this.unsubscribe;
  }

  async getLatest() {
    this.calls.push('snapshot');
    return await (this.snapshots.shift() ?? null);
  }

  subscribed() {
    this.handlers?.onSubscribed();
  }

  emit(value: unknown) {
    this.handlers?.onAnnouncement(value);
  }
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('Fluxora release signal service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes before its snapshot and snapshots after every SUBSCRIBED reconnect', async () => {
    const source = new FakeReleaseSignalSource();
    source.snapshots.push(announcement('1.0.0', 1), announcement('1.1.0', 2));
    const checkSignedManifest = vi.fn(async () => updateStatus('upToDate'));
    const service = createFluxoraReleaseSignalService({
      checkSignedManifest,
      getNativeStatus: () => updateStatus('upToDate'),
      source
    });

    service.start();
    source.subscribed();
    await flushAsyncWork();
    source.subscribed();
    await flushAsyncWork();

    expect(source.calls).toEqual(['subscribe', 'snapshot', 'snapshot']);
    expect(checkSignedManifest).toHaveBeenCalledOnce();
  });

  it('closes the subscribe/snapshot race by keeping a newer event over an older snapshot', async () => {
    const source = new FakeReleaseSignalSource();
    let resolveSnapshot: ((value: unknown) => void) | undefined;
    source.snapshots.push(new Promise((resolve) => { resolveSnapshot = resolve; }));
    const checkedAnnouncements: string[] = [];
    const service = createFluxoraReleaseSignalService({
      checkSignedManifest: vi.fn(async (release) => {
        checkedAnnouncements.push(release.version);
        return updateStatus('upToDate');
      }),
      getNativeStatus: () => updateStatus('upToDate'),
      source
    });

    service.start();
    source.subscribed();
    source.emit(announcement('3.0.0', 30));
    await flushAsyncWork();
    resolveSnapshot?.(announcement('2.0.0', 20));
    await flushAsyncWork();

    expect(checkedAnnouncements).toEqual(['3.0.0']);
  });

  it('validates, deduplicates, and ignores older or already-installed announcements', async () => {
    const source = new FakeReleaseSignalSource();
    const checkSignedManifest = vi.fn(async (_release: FluxoraReleaseAnnouncement) =>
      updateStatus('upToDate', '2.0.0'));
    const service = createFluxoraReleaseSignalService({
      checkSignedManifest,
      getNativeStatus: () => updateStatus('upToDate', '2.0.0'),
      source
    });

    service.start();
    source.emit({ ...announcement('9.0.0', 90), tag_name: 'v-attacker' });
    source.emit(announcement('1.9.0', 19));
    source.emit(announcement('2.0.0', 20));
    source.emit(announcement('2.1.0', 21));
    source.emit(announcement('2.1.0', 21));
    source.emit(announcement('2.0.5', 205));
    await flushAsyncWork();

    expect(checkSignedManifest).toHaveBeenCalledOnce();
    expect(checkSignedManifest.mock.calls[0]?.[0].version).toBe('2.1.0');
  });

  it('checks immediately and at 2, 5, 15, 30, and 60 seconds while unconfirmed', async () => {
    const source = new FakeReleaseSignalSource();
    const checkSignedManifest = vi.fn(async (_release: FluxoraReleaseAnnouncement) =>
      updateStatus('upToDate', '1.0.0'));
    const service = createFluxoraReleaseSignalService({
      checkSignedManifest,
      getNativeStatus: () => updateStatus('upToDate', '1.0.0'),
      source
    });

    service.start();
    source.emit(announcement('2.0.0', 2));
    await flushAsyncWork();
    expect(checkSignedManifest).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(checkSignedManifest).toHaveBeenCalledTimes(1);

    for (const [elapsed, expectedCalls] of [
      [2_000, 2],
      [5_000, 3],
      [15_000, 4],
      [30_000, 5],
      [60_000, 6]
    ] as const) {
      await vi.advanceTimersToNextTimerAsync();
      await flushAsyncWork();
      expect(Date.now()).toBe(new Date('2026-08-02T12:00:00Z').getTime() + elapsed);
      expect(checkSignedManifest).toHaveBeenCalledTimes(expectedCalls);
    }

    await vi.runAllTimersAsync();
    expect(checkSignedManifest).toHaveBeenCalledTimes(6);
  });

  it.each([
    ['signed manifest confirms the announcement', updateStatus('available', '1.0.0', '2.0.0')],
    ['native version catches up', updateStatus('upToDate', '2.0.0')],
    ['download begins', updateStatus('downloading', '1.0.0', '2.0.0')],
    ['installer drain begins', updateStatus('waitingForOperations', '1.0.0', '2.0.0')]
  ])('stops the retry burst when %s', async (_name, result) => {
    const source = new FakeReleaseSignalSource();
    let current = updateStatus('upToDate', '1.0.0');
    const checkSignedManifest = vi.fn(async (_release: FluxoraReleaseAnnouncement) => {
      current = result;
      return result;
    });
    const service = createFluxoraReleaseSignalService({
      checkSignedManifest,
      getNativeStatus: () => current,
      source
    });

    service.start();
    source.emit(announcement('2.0.0', 2));
    await flushAsyncWork();
    await vi.runAllTimersAsync();

    expect(checkSignedManifest).toHaveBeenCalledOnce();
  });

  it('cancels an older burst for a newer announcement and cancels everything on stop', async () => {
    const source = new FakeReleaseSignalSource();
    const checked: string[] = [];
    const service = createFluxoraReleaseSignalService({
      checkSignedManifest: vi.fn(async (release) => {
        checked.push(release.version);
        return updateStatus('upToDate', '1.0.0');
      }),
      getNativeStatus: () => updateStatus('upToDate', '1.0.0'),
      source
    });

    service.start();
    source.emit(announcement('2.0.0', 2));
    await flushAsyncWork();
    source.emit(announcement('3.0.0', 3));
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(2_000);
    service.stop();
    await vi.runAllTimersAsync();

    expect(checked).toEqual(['2.0.0', '3.0.0', '3.0.0']);
    expect(source.unsubscribe).toHaveBeenCalledOnce();
  });

  it('never exposes the untrusted payload as toolbar state before native verification', async () => {
    const source = new FakeReleaseSignalSource();
    let nativeStatus = updateStatus('upToDate', '1.0.0');
    let resolveCheck: ((status: FluxoraUpdateStatus) => void) | undefined;
    const service = createFluxoraReleaseSignalService({
      checkSignedManifest: vi.fn((_release: FluxoraReleaseAnnouncement) =>
        new Promise<FluxoraUpdateStatus>((resolve) => { resolveCheck = resolve; })),
      getNativeStatus: () => nativeStatus,
      source
    });

    service.start();
    source.emit(announcement('99.0.0', 99));
    await flushAsyncWork();

    expect(appUpdateToolbarView(nativeStatus, false, vi.fn())).toEqual({ state: 'hidden' });

    nativeStatus = updateStatus('available', '1.0.0', '2.0.0');
    resolveCheck?.(nativeStatus);
    await flushAsyncWork();
    expect(appUpdateToolbarView(nativeStatus, false, vi.fn())).toMatchObject({
      state: 'available',
      version: '2.0.0'
    });
  });
});
