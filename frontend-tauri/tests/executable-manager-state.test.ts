import { describe, expect, it } from 'vitest';

import type {
  FluxoraExecutable,
  FluxoraExecutableInspection
} from '../src/shared/fluxora-api';
import {
  applyExecutableInspection,
  createExecutableDraft,
  createNewExecutableDraft,
  executableDraftIsDirty,
  moveExecutableDraft,
  setExecutableDraftName,
  setExecutableDraftPath,
  setExecutableDraftWorkingDirectory
} from '../src/renderer/features/executables/executable-manager-state';

const saved: FluxoraExecutable = {
  id: 'game',
  displayName: 'My Game',
  executablePath: 'C:\\Games\\Game\\game.exe',
  arguments: '--profile private',
  workingDirectory: 'C:\\Games\\Game',
  iconPath: '',
  managedToolKind: 'texGen'
};

const inspection = (
  executablePath: string,
  suggestedDisplayName: string
): FluxoraExecutableInspection => ({
  executablePath,
  suggestedDisplayName,
  displayNameSource: 'file-name',
  iconPath: 'C:\\Cache\\icon.png',
  operationId: 'inspect-1'
});

describe('executable manager draft state', () => {
  it('treats persisted names and working directories as user owned', () => {
    const [entry] = createExecutableDraft([saved]);
    const changedPath = setExecutableDraftPath(entry, 'D:\\Elsewhere\\next.exe');
    const inspected = applyExecutableInspection(
      changedPath,
      inspection('D:\\Elsewhere\\next.exe', 'Next')
    );

    expect(inspected.displayName).toBe('My Game');
    expect(inspected.workingDirectory).toBe('C:\\Games\\Game');
    expect(inspected.iconPath).toBe('C:\\Cache\\icon.png');
  });

  it('auto-fills new names and directories without overwriting manual ownership', () => {
    const entry = createNewExecutableDraft('new-1');
    const firstPath = setExecutableDraftPath(entry, 'C:\\Apps\\Tool\\tool.exe');
    const firstInspection = applyExecutableInspection(
      firstPath,
      inspection(firstPath.executablePath, 'Tool')
    );

    expect(firstInspection.displayName).toBe('Tool');
    expect(firstInspection.workingDirectory).toBe('C:\\Apps\\Tool');

    const manual = setExecutableDraftWorkingDirectory(
      setExecutableDraftName(firstInspection, 'My Tool'),
      'D:\\Workspace'
    );
    const nextPath = setExecutableDraftPath(manual, 'C:\\Apps\\Other\\other.exe');
    const nextInspection = applyExecutableInspection(
      nextPath,
      inspection(nextPath.executablePath, 'Other')
    );

    expect(nextInspection.displayName).toBe('My Tool');
    expect(nextInspection.workingDirectory).toBe('D:\\Workspace');
  });

  it('ignores stale inspect responses after a faster path change', () => {
    const entry = setExecutableDraftPath(
      createNewExecutableDraft('new-1'),
      'C:\\Apps\\new.exe'
    );
    const stale = applyExecutableInspection(
      entry,
      inspection('C:\\Apps\\old.exe', 'Old')
    );

    expect(stale).toBe(entry);
  });

  it('reorders immutably while retaining object identity and detects dirty state', () => {
    const items = createExecutableDraft([
      saved,
      { ...saved, id: 'second', displayName: 'Second' },
      { ...saved, id: 'third', displayName: 'Third' }
    ]);
    const reordered = moveExecutableDraft(items, 'game', 'third', 'after');

    expect(reordered.map((entry) => entry.id)).toEqual(['second', 'third', 'game']);
    expect(reordered[2]).toBe(items[0]);
    expect(executableDraftIsDirty(items, items.map(({ nameOrigin: _n, workingDirectoryOrigin: _w, autoWorkingDirectory: _a, ...entry }) => entry))).toBe(false);
    expect(executableDraftIsDirty(reordered, [saved, { ...saved, id: 'second', displayName: 'Second' }, { ...saved, id: 'third', displayName: 'Third' }])).toBe(true);
  });
});
