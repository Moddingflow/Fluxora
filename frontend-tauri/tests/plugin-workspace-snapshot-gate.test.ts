import { describe, expect, it, vi } from 'vitest';

import { createPluginWorkspaceSnapshotGate } from '../src/renderer/services/plugin-workspace-snapshot-gate';

describe('plugin workspace snapshot gate', () => {
  it('waits for an active reorder transaction before reading a plugin snapshot', async () => {
    let releaseSave!: () => void;
    const save = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const readSnapshot = vi.fn(async () => ['pgpatcher.esp', 'pg_1.esp']);
    const gate = createPluginWorkspaceSnapshotGate();

    const queuedSave = gate.enqueue(async () => save);
    const snapshot = gate.readStable(readSnapshot);

    await Promise.resolve();
    expect(readSnapshot).not.toHaveBeenCalled();

    releaseSave();

    await queuedSave;
    await expect(snapshot).resolves.toEqual(['pgpatcher.esp', 'pg_1.esp']);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it('discards a snapshot that races a newly started reorder transaction', async () => {
    let releaseFirstRead!: (rows: string[]) => void;
    const firstRead = new Promise<string[]>((resolve) => {
      releaseFirstRead = resolve;
    });
    let releaseSave!: () => void;
    const save = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const readSnapshot = vi
      .fn<() => Promise<string[]>>()
      .mockImplementationOnce(async () => firstRead)
      .mockResolvedValueOnce(['base.esm', 'pgpatcher.esp', 'pg_1.esp']);
    const gate = createPluginWorkspaceSnapshotGate();

    const snapshot = gate.readStable(readSnapshot);
    await Promise.resolve();
    expect(readSnapshot).toHaveBeenCalledTimes(1);

    const queuedSave = gate.enqueue(async () => save);
    releaseFirstRead(['base.esm', 'pg_1.esp', 'pgpatcher.esp']);
    await Promise.resolve();
    expect(readSnapshot).toHaveBeenCalledTimes(1);

    releaseSave();

    await queuedSave;
    await expect(snapshot).resolves.toEqual(['base.esm', 'pgpatcher.esp', 'pg_1.esp']);
    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });

  it('finishes one reorder transaction before starting the next', async () => {
    let releaseFirstSave!: () => void;
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const calls: string[] = [];
    const gate = createPluginWorkspaceSnapshotGate();

    const first = gate.enqueue(async () => {
      calls.push('first:start');
      await firstSaveGate;
      calls.push('first:end');
    });
    const second = gate.enqueue(async () => {
      calls.push('second:start');
      calls.push('second:end');
    });

    await Promise.resolve();
    expect(calls).toEqual(['first:start']);

    releaseFirstSave();
    await Promise.all([first, second]);

    expect(calls).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('cancels dependent queued work after a failed transaction and accepts later work', async () => {
    const calls: string[] = [];
    const gate = createPluginWorkspaceSnapshotGate();

    const failed = gate.enqueue(async () => {
      calls.push('failed:start');
      throw new Error('native move failed');
    });
    const dependent = gate.enqueue(async () => {
      calls.push('dependent:start');
    });

    await expect(failed).rejects.toThrow('native move failed');
    await expect(dependent).rejects.toThrow('native move failed');
    expect(calls).toEqual(['failed:start']);

    await gate.enqueue(async () => {
      calls.push('recovered:start');
    });
    expect(calls).toEqual(['failed:start', 'recovered:start']);
  });
});
