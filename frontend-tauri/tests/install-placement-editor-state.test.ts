import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  advancePlacementHistory,
  buildInstallPlacementRows,
  createPlacementDirectory,
  deleteEmptyPlacementDirectory,
  emptyPlacementEdits,
  emptyPlacementHistory,
  movePlacementSelection,
  placementAssessmentMessage,
  redoPlacementHistory,
  renamePlacementDirectory,
  setPlacementSelectionIncluded,
  undoPlacementHistory
} from '../src/renderer/features/install/install-placement-editor-state';
import { InstallPlacementEditor } from '../src/renderer/features/install/InstallPlacementEditor';
import type { FluxoraContentLayoutPreview } from '../src/shared/fluxora-api';

const preview = (): FluxoraContentLayoutPreview => ({
  gameId: 'skyrimse',
  gameDisplayName: 'Skyrim Special Edition',
  rootFileWrapperDirectory: 'root',
  canInstall: true,
  summary: {
    supported: true,
    hasWarnings: false,
    hasBlockers: false,
    totalEntries: 3,
    plannedEntries: 3,
    gameDataEntries: 2,
    gameRootEntries: 0,
    pluginEntries: 1,
    archiveEntries: 0,
    scriptExtenderEntries: 0,
    unknownEntries: 0,
    unsafeEntries: 0
  },
  entries: [
    {
      sourcePath: 'Data/Meshes/Armor/a.nif',
      target: 'data',
      contentArea: 'data',
      targetRelativePath: 'Meshes/Armor/a.nif',
      classification: 'gameData',
      explanation: '',
      manualOverrideAllowed: true,
      safeManualTargets: ['data', 'gameRoot'],
      included: true
    },
    {
      sourcePath: 'Data/Meshes/Armor/b.nif',
      target: 'data',
      contentArea: 'data',
      targetRelativePath: 'Meshes/Armor/b.nif',
      classification: 'gameData',
      explanation: '',
      manualOverrideAllowed: true,
      safeManualTargets: ['data', 'gameRoot'],
      included: true
    },
    {
      sourcePath: 'Data/Locked.esp',
      target: 'data',
      contentArea: 'data',
      targetRelativePath: 'Locked.esp',
      classification: 'plugin',
      explanation: '',
      manualOverrideAllowed: false,
      safeManualTargets: ['data'],
      included: true
    }
  ],
  validationFindings: [],
  explanationSummary: '',
  explanationDetails: [],
  assessment: { status: 'ready', reasonCodes: ['skyrimse.layout.ready'] }
});

const nestedFolderPreview = (): FluxoraContentLayoutPreview => {
  const result = preview();
  const template = result.entries[0]!;
  result.entries = [
    {
      ...template,
      sourcePath: 'Data/SKSE/Plugins/Backup/2026/a.dll',
      targetRelativePath: 'SKSE/Plugins/Backup/2026/a.dll'
    },
    {
      ...template,
      sourcePath: 'Data/SKSE/Plugins/keep.dll',
      targetRelativePath: 'SKSE/Plugins/keep.dll'
    },
    {
      ...template,
      sourcePath: 'Data/Scripts/keep.pex',
      targetRelativePath: 'Scripts/keep.pex'
    }
  ];
  return result;
};

describe('install placement editor state', () => {
  it('renders the selected game as the single root with Data nested below it', () => {
    const open = buildInstallPlacementRows(preview(), emptyPlacementEdits());
    expect(open.slice(0, 3).map((row) => row.key)).toEqual([
      'root:gameRoot',
      'root:data',
      'dir:data:meshes'
    ]);
    expect(open[0]).toMatchObject({
      name: 'Skyrim Special Edition',
      parentKey: null,
      depth: 0
    });
    expect(open[1]).toMatchObject({ parentKey: 'root:gameRoot', depth: 1 });

    const collapsed = buildInstallPlacementRows(
      preview(),
      emptyPlacementEdits(),
      new Set(['root:gameRoot'])
    );
    expect(collapsed.map((row) => row.key)).toEqual(['root:gameRoot']);
  });

  it('moves a complete folder subtree atomically and blocks self drops', () => {
    const sourceKey = 'dir:data:meshes/armor';
    const moved = movePlacementSelection(
      preview(),
      emptyPlacementEdits(),
      new Set([sourceKey]),
      'root:gameRoot'
    );
    expect(moved.accepted).toBe(true);
    expect(moved.edits.files).toHaveLength(2);
    expect(moved.edits.files.every((file) => file.target === 'gameRoot')).toBe(true);
    expect(moved.edits.files.map((file) => file.targetRelativePath).sort()).toEqual([
      'Armor/a.nif',
      'Armor/b.nif'
    ]);

    const selfDrop = movePlacementSelection(
      preview(),
      emptyPlacementEdits(),
      new Set(['dir:data:meshes']),
      sourceKey
    );
    expect(selfDrop).toMatchObject({ accepted: false, reason: 'drop.self' });
    expect(selfDrop.edits).toEqual(emptyPlacementEdits());
  });

  it('moves a selected folder subtree only once when a descendant is also selected', () => {
    const moved = movePlacementSelection(
      preview(),
      emptyPlacementEdits(),
      new Set([
        'dir:data:meshes/armor',
        'file:data/meshes/armor/a.nif'
      ]),
      'root:gameRoot'
    );

    expect(moved.accepted).toBe(true);
    expect(moved.selectionKeys).toEqual(['dir:gameRoot:armor']);
    expect(moved.edits.files.map((file) => file.targetRelativePath).sort()).toEqual([
      'Armor/a.nif',
      'Armor/b.nif'
    ]);
  });

  it('moves only the requested nested folder and preserves every sibling branch', () => {
    const moved = movePlacementSelection(
      nestedFolderPreview(),
      emptyPlacementEdits(),
      new Set(['dir:data:skse/plugins/backup']),
      'dir:data:skse'
    );

    expect(moved.accepted).toBe(true);
    expect(moved.edits.files).toEqual([{
      sourcePath: 'Data/SKSE/Plugins/Backup/2026/a.dll',
      target: 'data',
      targetRelativePath: 'SKSE/Backup/2026/a.dll'
    }]);
    const rows = buildInstallPlacementRows(nestedFolderPreview(), moved.edits);
    expect(rows.find((row) => row.key === 'file:data/skse/plugins/backup/2026/a.dll')?.parentKey)
      .toBe('dir:data:skse/backup/2026');
    expect(rows.find((row) => row.key === 'file:data/skse/plugins/keep.dll')?.parentKey)
      .toBe('dir:data:skse/plugins');
    expect(rows.find((row) => row.key === 'file:data/scripts/keep.pex')?.parentKey)
      .toBe('dir:data:scripts');
  });

  it('round-trips a folder through the game root and back into Data', () => {
    const movedToRoot = movePlacementSelection(
      nestedFolderPreview(),
      emptyPlacementEdits(),
      new Set(['dir:data:skse']),
      'root:gameRoot'
    );
    expect(movedToRoot.accepted).toBe(true);

    const movedBackToData = movePlacementSelection(
      nestedFolderPreview(),
      movedToRoot.edits,
      new Set(['dir:gameRoot:skse']),
      'root:data'
    );
    expect(movedBackToData.accepted).toBe(true);
    expect(movedBackToData.edits.files).toHaveLength(2);
    expect(movedBackToData.edits.files.every((file) => file.target === 'data')).toBe(true);
    expect(movedBackToData.edits.files.some((file) => file.sourcePath === 'Data/Scripts/keep.pex')).toBe(false);
    expect(buildInstallPlacementRows(nestedFolderPreview(), movedBackToData.edits)
      .some((row) => row.key === 'dir:data:skse')).toBe(true);
  });

  it('moves a file between sibling folders inside the same placement target', () => {
    const moved = movePlacementSelection(
      nestedFolderPreview(),
      emptyPlacementEdits(),
      new Set(['file:data/skse/plugins/keep.dll']),
      'dir:data:skse/plugins/backup'
    );

    expect(moved).toMatchObject({ accepted: true });
    expect(moved.edits.files).toEqual([{
      sourcePath: 'Data/SKSE/Plugins/keep.dll',
      target: 'data',
      targetRelativePath: 'SKSE/Plugins/Backup/keep.dll'
    }]);
  });

  it('rejects a group move without partially applying allowed members', () => {
    const result = movePlacementSelection(
      preview(),
      emptyPlacementEdits(),
      new Set(['file:data/meshes/armor/a.nif', 'file:data/locked.esp']),
      'root:gameRoot'
    );

    expect(result).toMatchObject({ accepted: false, reason: 'drop.group.not-allowed' });
    expect(result.edits.files).toEqual([]);
  });

  it('rejects moving a file or folder into its current parent', () => {
    const fileResult = movePlacementSelection(
      preview(),
      emptyPlacementEdits(),
      new Set(['file:data/meshes/armor/a.nif']),
      'dir:data:meshes/armor'
    );
    expect(fileResult).toMatchObject({ accepted: false, reason: 'drop.same-parent' });

    const folderResult = movePlacementSelection(
      preview(),
      emptyPlacementEdits(),
      new Set(['dir:data:meshes/armor']),
      'dir:data:meshes'
    );
    expect(folderResult).toMatchObject({ accepted: false, reason: 'drop.same-parent' });
  });

  it('returns movable group members to Data without blocking on members already there', () => {
    const edits = emptyPlacementEdits();
    edits.files = [{
      sourcePath: 'Data/Meshes/Armor/a.nif',
      target: 'gameRoot',
      targetRelativePath: 'a.nif'
    }];

    const result = movePlacementSelection(
      preview(),
      edits,
      new Set([
        'file:data/meshes/armor/a.nif',
        'file:data/locked.esp'
      ]),
      'root:data'
    );

    expect(result.accepted).toBe(true);
    expect(result.edits.files).toEqual([{
      sourcePath: 'Data/Meshes/Armor/a.nif',
      target: 'data',
      targetRelativePath: 'a.nif'
    }]);
  });

  it('disables a complete folder subtree and reports a mixed parent after one file is restored', () => {
    const disabled = setPlacementSelectionIncluded(
      preview(),
      emptyPlacementEdits(),
      'dir:data:meshes/armor',
      false
    );
    expect(disabled.accepted).toBe(true);
    expect(disabled.edits.excludedSourcePaths).toEqual([
      'Data/Meshes/Armor/a.nif',
      'Data/Meshes/Armor/b.nif'
    ]);

    const restored = setPlacementSelectionIncluded(
      preview(),
      disabled.edits,
      'file:data/meshes/armor/a.nif',
      true
    );
    expect(restored.accepted).toBe(true);
    expect(restored.edits.excludedSourcePaths).toEqual(['Data/Meshes/Armor/b.nif']);
    expect(
      buildInstallPlacementRows(preview(), restored.edits)
        .find((row) => row.key === 'dir:data:meshes/armor')
    ).toMatchObject({ included: false, partiallyIncluded: true });
  });

  it('disables every archive entry when the game-root checkbox is cleared', () => {
    const disabled = setPlacementSelectionIncluded(
      preview(),
      emptyPlacementEdits(),
      'root:gameRoot',
      false
    );

    expect(disabled.accepted).toBe(true);
    expect(disabled.edits.excludedSourcePaths).toHaveLength(3);
    expect(disabled.edits.excludedSourcePaths).toEqual(expect.arrayContaining([
      'Data/Meshes/Armor/a.nif',
      'Data/Meshes/Armor/b.nif',
      'Data/Locked.esp'
    ]));
    expect(
      buildInstallPlacementRows(preview(), disabled.edits)
        .filter((row) => row.sourcePaths.length > 0)
        .every((row) => !row.included && !row.partiallyIncluded)
    ).toBe(true);
  });

  it('creates, renames, and deletes a real empty directory', () => {
    const created = createPlacementDirectory(
      preview(),
      emptyPlacementEdits(),
      'root:data',
      'Generated'
    );
    expect(created.accepted).toBe(true);
    expect(created.edits.directories).toEqual([{ target: 'data', targetRelativePath: 'Generated' }]);

    const renamed = renamePlacementDirectory(
      preview(),
      created.edits,
      'dir:data:generated',
      'Output'
    );
    expect(renamed.accepted).toBe(true);
    expect(renamed.edits.directories).toEqual([{ target: 'data', targetRelativePath: 'Output' }]);

    const deleted = deleteEmptyPlacementDirectory(
      preview(),
      renamed.edits,
      'dir:data:output'
    );
    expect(deleted.accepted).toBe(true);
    expect(deleted.edits.directories).toEqual([]);
  });

  it('renames every file in a subtree as one edit', () => {
    const result = renamePlacementDirectory(
      preview(),
      emptyPlacementEdits(),
      'dir:data:meshes/armor',
      'Equipment'
    );

    expect(result.accepted).toBe(true);
    expect(result.edits.files.map((file) => file.targetRelativePath).sort()).toEqual([
      'Meshes/Equipment/a.nif',
      'Meshes/Equipment/b.nif'
    ]);
  });

  it('records one history entry per completed operation and supports undo, redo, and reset', () => {
    const original = emptyPlacementEdits();
    const created = createPlacementDirectory(preview(), original, 'root:data', 'Generated');
    expect(created.accepted).toBe(true);
    const history = advancePlacementHistory(emptyPlacementHistory(), original);

    const undone = undoPlacementHistory(history, created.edits);
    expect(undone.edits).toEqual(original);
    expect(undone.history.future).toEqual([created.edits]);

    const redone = redoPlacementHistory(undone.history, original);
    expect(redone.edits).toEqual(created.edits);
    const resetHistory = advancePlacementHistory(redone.history, created.edits);
    const reset = emptyPlacementEdits();
    const undoReset = undoPlacementHistory(resetHistory, reset);
    expect(undoReset.edits).toEqual(created.edits);
  });

  it('localizes archive assessment as a binary compatible or incompatible result', () => {
    expect(placementAssessmentMessage(preview(), 'ru')).toBe(
      'Архив подходит под структуру игры'
    );
    const warning = preview();
    warning.assessment = { status: 'warning', reasonCodes: ['skyrimse.layout.warning'] };
    warning.validationFindings = [{
      severity: 'warning', path: '', classification: 'unknown', message: 'Warning', blocksInstall: false
    }];
    expect(placementAssessmentMessage(warning, 'de')).toBe(
      'Das Archiv entspricht nicht der Spielstruktur'
    );
    const blocked = preview();
    blocked.assessment = { status: 'blocked', reasonCodes: ['skyrimse.layout.blocked'] };
    blocked.validationFindings = [{
      severity: 'blocker',
      path: 'Data/Data/Test.esp',
      classification: 'plugin',
      message: 'Placement retains a redundant Data directory. Move its contents directly into Data.',
      blocksInstall: true
    }];
    expect(placementAssessmentMessage(blocked, 'en')).toBe(
      'The archive does not match the game structure'
    );
  });

  it('keeps a ten-thousand-entry tree DOM bounded to visible rows plus overscan', () => {
    const large = preview();
    large.entries = Array.from({ length: 10_000 }, (_, index) => ({
      sourcePath: `Data/Meshes/Generated/${index}.nif`,
      target: 'data',
      contentArea: 'data',
      targetRelativePath: `Meshes/Generated/${index}.nif`,
      classification: 'gameData',
      explanation: '',
      manualOverrideAllowed: true,
      safeManualTargets: ['data', 'gameRoot'],
      included: true
    }));
    large.summary = { ...large.summary, totalEntries: 10_000, plannedEntries: 10_000 };
    const markup = renderToStaticMarkup(createElement(InstallPlacementEditor, {
      preview: large,
      edits: emptyPlacementEdits(),
      language: 'en',
      validationPending: false,
      onEditsChange: vi.fn()
    }));

    expect(markup.match(/role="treeitem"/g)?.length ?? 0).toBeLessThanOrEqual(31);
    expect(markup).not.toContain('Apply');
    expect(markup).not.toContain('.zip');
  });

  it('renders inclusion checkboxes, the game name, and explicit drag feedback styles', () => {
    const markup = renderToStaticMarkup(createElement(InstallPlacementEditor, {
      preview: preview(),
      edits: emptyPlacementEdits(),
      language: 'en',
      validationPending: false,
      onEditsChange: vi.fn()
    }));
    const styles = readFileSync(
      new URL('../src/renderer/styles.css', import.meta.url),
      'utf8'
    );

    expect(markup).toContain('Skyrim Special Edition');
    expect(markup.match(/type="checkbox"/g)?.length ?? 0).toBeGreaterThan(1);
    expect(styles).toMatch(/\.install-placement-row\[data-draggable="true"\][^{]*\{[^}]*cursor:\s*grab;/s);
    expect(styles).toMatch(/\.install-placement-row\[data-drag-source="true"\][^{]*\{[^}]*opacity:\s*0\.58;[^}]*transform:\s*scale\(0\.985\);/s);
    expect(styles).toMatch(/data-drop-allowed="false"[^}]*cursor:\s*not-allowed/s);
  });
});
