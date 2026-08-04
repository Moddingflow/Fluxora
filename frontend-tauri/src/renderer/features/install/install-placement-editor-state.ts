import type {
  FluxoraContentLayoutPreview,
  FluxoraContentLayoutPreviewEntry,
  FluxoraPlacementDirectory,
  FluxoraPlacementEditsV2,
  FluxoraPlacementOverride,
  FluxoraPlacementTarget
} from '../../../shared/fluxora-api';
import { translateForLanguage } from '../../../localization';

export type PlacementRowKind = 'system-root' | 'directory' | 'file' | 'attention-root';

export interface InstallPlacementRow {
  key: string;
  parentKey: string | null;
  kind: PlacementRowKind;
  name: string;
  depth: number;
  target: FluxoraPlacementTarget | 'blocked';
  targetRelativePath: string;
  sourcePath: string;
  sourcePaths: string[];
  explicitDirectory: boolean;
  system: boolean;
  blocked: boolean;
  included: boolean;
  partiallyIncluded: boolean;
  problemCount: number;
}

export interface PlacementEditResult {
  accepted: boolean;
  edits: FluxoraPlacementEditsV2;
  reason: string;
  focusKey?: string;
  selectionKeys?: string[];
}

interface MutableNode extends InstallPlacementRow {
  children: MutableNode[];
}

const reservedNames = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

export const emptyPlacementEdits = (): FluxoraPlacementEditsV2 => ({
  schemaVersion: 2,
  files: [],
  directories: [],
  excludedSourcePaths: []
});

export const clonePlacementEdits = (edits: FluxoraPlacementEditsV2): FluxoraPlacementEditsV2 => ({
  schemaVersion: 2,
  files: edits.files.map((file) => ({ ...file })),
  directories: edits.directories.map((directory) => ({ ...directory })),
  excludedSourcePaths: [...edits.excludedSourcePaths]
});

const normalizePath = (value: string): string =>
  value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');

const pathKey = (value: string): string => normalizePath(value).toLocaleLowerCase();

const joinPath = (...parts: string[]): string =>
  parts.map(normalizePath).filter(Boolean).join('/');

const pathName = (value: string): string => normalizePath(value).split('/').filter(Boolean).at(-1) ?? '';

const parentPath = (value: string): string => {
  const parts = normalizePath(value).split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
};

const isSameOrDescendant = (candidate: string, parent: string): boolean => {
  const candidateKey = pathKey(candidate);
  const parentKey = pathKey(parent);
  return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}/`);
};

export const validatePlacementFolderName = (value: string): string => {
  if (!value || value.trim() !== value) {
    return 'folder.name.empty';
  }
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(value) || /[. ]$/.test(value)) {
    return 'folder.name.invalid';
  }
  const device = value.split('.')[0]?.toLocaleUpperCase() ?? '';
  return reservedNames.has(device) ? 'folder.name.reserved' : '';
};

const targetKey = (target: string, path: string): string => `${target}|${pathKey(path)}`;

const effectiveAssignment = (
  entry: FluxoraContentLayoutPreviewEntry,
  files: Map<string, FluxoraPlacementOverride>
): { target: string; targetRelativePath: string } => {
  const override = files.get(entry.sourcePath.toLocaleLowerCase());
  return {
    target: override?.target ?? entry.target,
    targetRelativePath: normalizePath(override?.targetRelativePath ?? entry.targetRelativePath)
  };
};

const mutableNode = (
  key: string,
  parentKey: string | null,
  kind: PlacementRowKind,
  name: string,
  depth: number,
  target: FluxoraPlacementTarget | 'blocked',
  targetRelativePath: string,
  options: Partial<InstallPlacementRow> = {}
): MutableNode => ({
  key,
  parentKey,
  kind,
  name,
  depth,
  target,
  targetRelativePath,
  sourcePath: '',
  sourcePaths: [],
  explicitDirectory: false,
  system: false,
  blocked: target === 'blocked',
  included: true,
  partiallyIncluded: false,
  problemCount: 0,
  ...options,
  children: []
});

export const buildInstallPlacementRows = (
  preview: FluxoraContentLayoutPreview,
  edits: FluxoraPlacementEditsV2,
  collapsed: ReadonlySet<string> = new Set(),
  language?: string | null
): InstallPlacementRow[] => {
  const files = new Map(edits.files.map((file) => [file.sourcePath.toLocaleLowerCase(), file]));
  const excludedSourcePaths = new Set(
    edits.excludedSourcePaths.map((sourcePath) => sourcePath.toLocaleLowerCase())
  );
  const gameRoot = mutableNode(
    'root:gameRoot',
    null,
    'system-root',
    preview.gameDisplayName.trim() || translateForLanguage(language, 'placement.gameRoot'),
    0,
    'gameRoot',
    '',
    { system: true }
  );
  const dataRoot = mutableNode(
    'root:data',
    gameRoot.key,
    'system-root',
    'Data',
    1,
    'data',
    '',
    { system: true }
  );
  gameRoot.children.push(dataRoot);
  const roots = [gameRoot];
  const blockedEntries = preview.entries.filter((entry) => entry.target === 'blocked');
  if (blockedEntries.length > 0) {
    roots.push(mutableNode(
      'root:attention',
      null,
      'attention-root',
      translateForLanguage(language, 'placement.attention'),
      0,
      'blocked',
      '',
      {
        system: true,
        blocked: true,
        problemCount: blockedEntries.length
      }
    ));
  }

  const nodeByKey = new Map<string, MutableNode>([
    [gameRoot.key, gameRoot],
    [dataRoot.key, dataRoot],
    ...roots.slice(1).map((root): [string, MutableNode] => [root.key, root])
  ]);
  const rootForTarget = (target: string): MutableNode =>
    nodeByKey.get(target === 'gameRoot' ? 'root:gameRoot' : target === 'blocked' ? 'root:attention' : 'root:data') ?? roots[0];

  const ensureDirectory = (
    target: FluxoraPlacementTarget | 'blocked',
    path: string,
    explicitDirectory: boolean
  ): MutableNode => {
    const normalized = normalizePath(path);
    let parent = rootForTarget(target);
    let built = '';
    for (const part of normalized.split('/').filter(Boolean)) {
      built = joinPath(built, part);
      const key = `dir:${target}:${pathKey(built)}`;
      let node = nodeByKey.get(key);
      if (!node) {
        node = mutableNode(key, parent.key, 'directory', part, parent.depth + 1, target, built);
        nodeByKey.set(key, node);
        parent.children.push(node);
      }
      node.explicitDirectory ||= explicitDirectory && pathKey(built) === pathKey(normalized);
      parent = node;
    }
    return parent;
  };

  for (const directory of edits.directories) {
    ensureDirectory(directory.target, directory.targetRelativePath, true);
  }

  for (const entry of preview.entries) {
    const assignment = effectiveAssignment(entry, files);
    const target: FluxoraPlacementTarget | 'blocked' =
      assignment.target === 'gameRoot' ? 'gameRoot' : assignment.target === 'blocked' ? 'blocked' : 'data';
    const normalizedPath = normalizePath(
      assignment.targetRelativePath || entry.sourcePath
    );
    const parent = ensureDirectory(target, parentPath(normalizedPath), false);
    const sourcePath = entry.sourcePath;
    parent.children.push(mutableNode(
      `file:${sourcePath.toLocaleLowerCase()}`,
      parent.key,
      'file',
      pathName(normalizedPath) || pathName(sourcePath),
      parent.depth + 1,
      target,
      normalizedPath,
      {
        sourcePath,
        sourcePaths: [sourcePath],
        blocked: target === 'blocked',
        problemCount: target === 'blocked' ? 1 : 0
      }
    ));
  }

  const collectSources = (node: MutableNode): string[] => {
    const sources = node.kind === 'file'
      ? node.sourcePaths
      : node.children.flatMap(collectSources);
    node.sourcePaths = [...new Set(sources)];
    if (node.sourcePaths.length > 0) {
      const includedCount = node.sourcePaths.reduce(
        (count, sourcePath) => count + (excludedSourcePaths.has(sourcePath.toLocaleLowerCase()) ? 0 : 1),
        0
      );
      node.included = includedCount === node.sourcePaths.length;
      node.partiallyIncluded = includedCount > 0 && includedCount < node.sourcePaths.length;
    }
    node.problemCount = node.children.reduce((count, child) => count + child.problemCount, node.problemCount);
    return node.sourcePaths;
  };
  roots.forEach(collectSources);

  const rows: InstallPlacementRow[] = [];
  const visit = (node: MutableNode): void => {
    rows.push(node);
    if (collapsed.has(node.key)) {
      return;
    }
    [...node.children]
      .sort((left, right) => {
        if (left.kind === 'system-root' && right.kind !== 'system-root') return -1;
        if (right.kind === 'system-root' && left.kind !== 'system-root') return 1;
        if (left.kind === 'directory' && right.kind !== 'directory') return -1;
        if (right.kind === 'directory' && left.kind !== 'directory') return 1;
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      })
      .forEach(visit);
  };
  roots.forEach(visit);
  return rows;
};

const assignmentMap = (edits: FluxoraPlacementEditsV2): Map<string, FluxoraPlacementOverride> =>
  new Map(edits.files.map((file) => [file.sourcePath.toLocaleLowerCase(), { ...file }]));

const validateResolvedLayout = (
  preview: FluxoraContentLayoutPreview,
  edits: FluxoraPlacementEditsV2
): string => {
  const files = assignmentMap(edits);
  const excludedSourcePaths = new Set(
    edits.excludedSourcePaths.map((sourcePath) => sourcePath.toLocaleLowerCase())
  );
  const occupied = new Set<string>();
  for (const entry of preview.entries) {
    if (excludedSourcePaths.has(entry.sourcePath.toLocaleLowerCase())) continue;
    const assignment = effectiveAssignment(entry, files);
    if (assignment.target !== 'data' && assignment.target !== 'gameRoot' && assignment.target !== 'blocked') {
      return 'drop.target.unsupported';
    }
    if (assignment.target === 'blocked') continue;
    const parts = normalizePath(assignment.targetRelativePath).split('/').filter(Boolean);
    if (parts.length === 0 || parts.some((part) => validatePlacementFolderName(part))) {
      return 'drop.path.invalid';
    }
    const key = targetKey(assignment.target, assignment.targetRelativePath);
    if (occupied.has(key)) return 'drop.collision';
    occupied.add(key);
  }
  for (const directory of edits.directories) {
    const parts = normalizePath(directory.targetRelativePath).split('/').filter(Boolean);
    if (parts.length === 0 || parts.some((part) => validatePlacementFolderName(part))) {
      return 'drop.path.invalid';
    }
    const key = targetKey(directory.target, directory.targetRelativePath);
    if (occupied.has(key)) return 'drop.collision';
    occupied.add(key);
  }
  return '';
};

const failed = (edits: FluxoraPlacementEditsV2, reason: string): PlacementEditResult => ({
  accepted: false,
  edits,
  reason
});

const fileEntry = (
  preview: FluxoraContentLayoutPreview,
  sourcePath: string
): FluxoraContentLayoutPreviewEntry | undefined =>
  preview.entries.find((entry) => entry.sourcePath.toLocaleLowerCase() === sourcePath.toLocaleLowerCase());

const canPlaceEntry = (entry: FluxoraContentLayoutPreviewEntry, target: FluxoraPlacementTarget): boolean =>
  entry.manualOverrideAllowed && entry.safeManualTargets.some((candidate) => candidate.toLocaleLowerCase() === target.toLocaleLowerCase());

export const movePlacementSelection = (
  preview: FluxoraContentLayoutPreview,
  edits: FluxoraPlacementEditsV2,
  selectedKeys: ReadonlySet<string>,
  destinationKey: string
): PlacementEditResult => {
  const allRows = buildInstallPlacementRows(preview, edits);
  const byKey = new Map(allRows.map((row) => [row.key, row]));
  const destination = byKey.get(destinationKey);
  if (!destination || (destination.kind !== 'directory' && destination.kind !== 'system-root') || destination.blocked) {
    return failed(edits, 'drop.target.invalid');
  }
  const target = destination.target as FluxoraPlacementTarget;
  const selectedRows = [...selectedKeys].map((key) => byKey.get(key)).filter((row): row is InstallPlacementRow => Boolean(row));
  if (selectedRows.length === 0 || selectedRows.some((row) => row.system || row.blocked)) {
    return failed(edits, 'drop.selection.invalid');
  }
  const selectedRowKeys = new Set(selectedRows.map((row) => row.key));
  const moveRoots = selectedRows.filter((row) => {
    let parentKey = row.parentKey;
    while (parentKey) {
      if (selectedRowKeys.has(parentKey)) return false;
      parentKey = byKey.get(parentKey)?.parentKey ?? null;
    }
    return true;
  });
  const actionableMoveRoots = moveRoots.filter((row) => row.parentKey !== destination.key);
  if (actionableMoveRoots.length === 0) {
    return failed(edits, 'drop.same-parent');
  }
  for (const row of actionableMoveRoots) {
    if (row.kind !== 'file' && row.target === destination.target &&
        isSameOrDescendant(destination.targetRelativePath, row.targetRelativePath)) {
      return failed(edits, 'drop.self');
    }
  }

  const next = clonePlacementEdits(edits);
  const files = assignmentMap(next);
  const selectedSourcePaths = new Set(actionableMoveRoots.flatMap((row) => row.sourcePaths).map((path) => path.toLocaleLowerCase()));
  for (const sourcePathKey of selectedSourcePaths) {
    const entry = preview.entries.find((candidate) => candidate.sourcePath.toLocaleLowerCase() === sourcePathKey);
    if (!entry || !canPlaceEntry(entry, target)) {
      return failed(edits, 'drop.group.not-allowed');
    }
  }

  for (const row of actionableMoveRoots) {
    if (row.kind === 'file') {
      const entry = fileEntry(preview, row.sourcePath);
      if (!entry) return failed(edits, 'drop.source.missing');
      files.set(entry.sourcePath.toLocaleLowerCase(), {
        sourcePath: entry.sourcePath,
        target,
        targetRelativePath: joinPath(destination.targetRelativePath, row.name)
      });
      continue;
    }

    const movedBase = joinPath(destination.targetRelativePath, row.name);
    for (const sourcePath of row.sourcePaths) {
      const entry = fileEntry(preview, sourcePath);
      if (!entry) return failed(edits, 'drop.source.missing');
      const current = effectiveAssignment(entry, files);
      const suffix = normalizePath(current.targetRelativePath).slice(normalizePath(row.targetRelativePath).length).replace(/^\//, '');
      files.set(entry.sourcePath.toLocaleLowerCase(), {
        sourcePath: entry.sourcePath,
        target,
        targetRelativePath: joinPath(movedBase, suffix)
      });
    }
    next.directories = next.directories.map((directory) => {
      if (directory.target !== row.target || !isSameOrDescendant(directory.targetRelativePath, row.targetRelativePath)) {
        return directory;
      }
      const suffix = normalizePath(directory.targetRelativePath).slice(normalizePath(row.targetRelativePath).length).replace(/^\//, '');
      return { target, targetRelativePath: joinPath(movedBase, suffix) };
    });
  }
  next.files = [...files.values()];
  const validation = validateResolvedLayout(preview, next);
  if (validation) return failed(edits, validation);
  const selectionKeys = moveRoots.map((row) => {
    if (row.parentKey === destination.key || row.kind === 'file') return row.key;
    return `dir:${target}:${pathKey(joinPath(destination.targetRelativePath, row.name))}`;
  });
  return {
    accepted: true,
    edits: next,
    reason: '',
    focusKey: selectionKeys[0],
    selectionKeys
  };
};

export const setPlacementSelectionIncluded = (
  preview: FluxoraContentLayoutPreview,
  edits: FluxoraPlacementEditsV2,
  rowKey: string,
  included: boolean
): PlacementEditResult => {
  const row = buildInstallPlacementRows(preview, edits).find((candidate) => candidate.key === rowKey);
  if (!row || row.sourcePaths.length === 0) {
    return failed(edits, 'include.selection.empty');
  }

  const next = clonePlacementEdits(edits);
  const excluded = new Map(
    next.excludedSourcePaths.map((sourcePath) => [sourcePath.toLocaleLowerCase(), sourcePath])
  );
  for (const sourcePath of row.sourcePaths) {
    const key = sourcePath.toLocaleLowerCase();
    if (included) {
      excluded.delete(key);
    } else {
      excluded.set(key, sourcePath);
    }
  }
  next.excludedSourcePaths = [...excluded.values()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base' })
  );
  return { accepted: true, edits: next, reason: '', focusKey: row.key };
};

export const createPlacementDirectory = (
  preview: FluxoraContentLayoutPreview,
  edits: FluxoraPlacementEditsV2,
  parentKey: string,
  name: string
): PlacementEditResult => {
  const parent = buildInstallPlacementRows(preview, edits).find((row) => row.key === parentKey);
  if (!parent || parent.blocked || (parent.kind !== 'directory' && parent.kind !== 'system-root')) {
    return failed(edits, 'folder.parent.invalid');
  }
  const nameError = validatePlacementFolderName(name);
  if (nameError) return failed(edits, nameError);
  const directory: FluxoraPlacementDirectory = {
    target: parent.target as FluxoraPlacementTarget,
    targetRelativePath: joinPath(parent.targetRelativePath, name)
  };
  const next = clonePlacementEdits(edits);
  next.directories.push(directory);
  const validation = validateResolvedLayout(preview, next);
  return validation
    ? failed(edits, validation)
    : {
        accepted: true,
        edits: next,
        reason: '',
        focusKey: `dir:${directory.target}:${pathKey(directory.targetRelativePath)}`
      };
};

export const renamePlacementDirectory = (
  preview: FluxoraContentLayoutPreview,
  edits: FluxoraPlacementEditsV2,
  directoryKey: string,
  name: string
): PlacementEditResult => {
  const row = buildInstallPlacementRows(preview, edits).find((candidate) => candidate.key === directoryKey);
  if (!row || row.kind !== 'directory' || row.system) return failed(edits, 'folder.rename.invalid');
  const nameError = validatePlacementFolderName(name);
  if (nameError) return failed(edits, nameError);
  const next = clonePlacementEdits(edits);
  const renamedBase = joinPath(parentPath(row.targetRelativePath), name);
  const files = assignmentMap(next);
  for (const sourcePath of row.sourcePaths) {
    const entry = fileEntry(preview, sourcePath);
    if (!entry || !canPlaceEntry(entry, row.target as FluxoraPlacementTarget)) {
      return failed(edits, 'drop.group.not-allowed');
    }
    const current = effectiveAssignment(entry, files);
    const suffix = normalizePath(current.targetRelativePath).slice(normalizePath(row.targetRelativePath).length).replace(/^\//, '');
    files.set(entry.sourcePath.toLocaleLowerCase(), {
      sourcePath: entry.sourcePath,
      target: row.target,
      targetRelativePath: joinPath(renamedBase, suffix)
    });
  }
  next.files = [...files.values()];
  next.directories = next.directories.map((directory) => {
    if (directory.target !== row.target || !isSameOrDescendant(directory.targetRelativePath, row.targetRelativePath)) {
      return directory;
    }
    const suffix = normalizePath(directory.targetRelativePath).slice(normalizePath(row.targetRelativePath).length).replace(/^\//, '');
    return { ...directory, targetRelativePath: joinPath(renamedBase, suffix) };
  });
  const validation = validateResolvedLayout(preview, next);
  return validation
    ? failed(edits, validation)
    : {
        accepted: true,
        edits: next,
        reason: '',
        focusKey: `dir:${row.target}:${pathKey(renamedBase)}`
      };
};

export const deleteEmptyPlacementDirectory = (
  preview: FluxoraContentLayoutPreview,
  edits: FluxoraPlacementEditsV2,
  directoryKey: string
): PlacementEditResult => {
  const row = buildInstallPlacementRows(preview, edits).find((candidate) => candidate.key === directoryKey);
  if (!row || row.kind !== 'directory' || !row.explicitDirectory || row.sourcePaths.length > 0) {
    return failed(edits, 'folder.delete.not-empty');
  }
  const hasExplicitChild = edits.directories.some((directory) =>
    directory.target === row.target &&
    pathKey(directory.targetRelativePath) !== pathKey(row.targetRelativePath) &&
    isSameOrDescendant(directory.targetRelativePath, row.targetRelativePath)
  );
  if (hasExplicitChild) return failed(edits, 'folder.delete.not-empty');
  const next = clonePlacementEdits(edits);
  next.directories = next.directories.filter((directory) =>
    directory.target !== row.target || pathKey(directory.targetRelativePath) !== pathKey(row.targetRelativePath)
  );
  return { accepted: true, edits: next, reason: '' };
};

export const placementEditsEqual = (
  left: FluxoraPlacementEditsV2,
  right: FluxoraPlacementEditsV2
): boolean => JSON.stringify(left) === JSON.stringify(right);

export interface PlacementHistoryState {
  past: FluxoraPlacementEditsV2[];
  future: FluxoraPlacementEditsV2[];
}

export const emptyPlacementHistory = (): PlacementHistoryState => ({ past: [], future: [] });

export const advancePlacementHistory = (
  history: PlacementHistoryState,
  current: FluxoraPlacementEditsV2
): PlacementHistoryState => ({
  past: [...history.past, clonePlacementEdits(current)],
  future: []
});

export const undoPlacementHistory = (
  history: PlacementHistoryState,
  current: FluxoraPlacementEditsV2
): { history: PlacementHistoryState; edits: FluxoraPlacementEditsV2 | null } => {
  const edits = history.past.at(-1);
  return edits
    ? {
        history: {
          past: history.past.slice(0, -1),
          future: [clonePlacementEdits(current), ...history.future]
        },
        edits: clonePlacementEdits(edits)
      }
    : { history, edits: null };
};

export const redoPlacementHistory = (
  history: PlacementHistoryState,
  current: FluxoraPlacementEditsV2
): { history: PlacementHistoryState; edits: FluxoraPlacementEditsV2 | null } => {
  const edits = history.future[0];
  return edits
    ? {
        history: {
          past: [...history.past, clonePlacementEdits(current)],
          future: history.future.slice(1)
        },
        edits: clonePlacementEdits(edits)
      }
    : { history, edits: null };
};

export const placementAssessmentMessage = (
  preview: FluxoraContentLayoutPreview,
  language: string
): string | null => {
  if (!preview.assessment) return null;
  return translateForLanguage(
    language,
    preview.assessment.status === 'ready'
      ? 'placement.assessment.ready'
      : 'placement.assessment.blocked'
  );
};
