import type {
  FluxoraExecutable,
  FluxoraExecutableInspection
} from '../../../shared/fluxora-api';

export type ExecutableDraftNameOrigin = 'auto' | 'user';
export type ExecutableDraftWorkingDirectoryOrigin = 'auto' | 'user';
export type ExecutableDropPlacement = 'before' | 'after';

export interface ExecutableDraftEntry extends FluxoraExecutable {
  autoWorkingDirectory: string;
  nameOrigin: ExecutableDraftNameOrigin;
  workingDirectoryOrigin: ExecutableDraftWorkingDirectoryOrigin;
}

export interface ExecutableDraftValidationIssue {
  field: 'displayName' | 'executablePath';
  id: string;
}

const comparablePath = (value: string): string =>
  value.trim().replaceAll('/', '\\').toLocaleLowerCase();

export const executableDirectory = (executablePath: string): string => {
  const path = executablePath.trim();
  const separatorIndex = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  if (separatorIndex < 0) {
    return '';
  }
  if (separatorIndex === 2 && path[1] === ':') {
    return path.slice(0, separatorIndex + 1);
  }
  return path.slice(0, separatorIndex);
};

export const createExecutableDraft = (
  executables: readonly FluxoraExecutable[]
): ExecutableDraftEntry[] =>
  executables.map((entry) => ({
    ...entry,
    autoWorkingDirectory: '',
    nameOrigin: 'user',
    workingDirectoryOrigin: 'user'
  }));

export const createNewExecutableDraft = (id: string): ExecutableDraftEntry => ({
  id,
  displayName: '',
  executablePath: '',
  arguments: '',
  workingDirectory: '',
  iconPath: '',
  autoWorkingDirectory: '',
  nameOrigin: 'auto',
  workingDirectoryOrigin: 'auto'
});

export const setExecutableDraftName = (
  entry: ExecutableDraftEntry,
  displayName: string
): ExecutableDraftEntry => ({
  ...entry,
  displayName,
  nameOrigin: 'user'
});

export const setExecutableDraftArguments = (
  entry: ExecutableDraftEntry,
  args: string
): ExecutableDraftEntry => ({ ...entry, arguments: args });

export const setExecutableDraftWorkingDirectory = (
  entry: ExecutableDraftEntry,
  workingDirectory: string
): ExecutableDraftEntry => ({
  ...entry,
  workingDirectory,
  workingDirectoryOrigin: 'user'
});

export const setExecutableDraftPath = (
  entry: ExecutableDraftEntry,
  executablePath: string
): ExecutableDraftEntry => {
  const nextAutoWorkingDirectory = executableDirectory(executablePath);
  const previousAutoWorkingDirectory = entry.autoWorkingDirectory;
  const shouldUpdateWorkingDirectory =
    !entry.workingDirectory.trim() ||
    entry.workingDirectoryOrigin === 'auto' ||
    (Boolean(previousAutoWorkingDirectory) &&
      comparablePath(entry.workingDirectory) === comparablePath(previousAutoWorkingDirectory));

  return {
    ...entry,
    executablePath,
    iconPath: '',
    autoWorkingDirectory: nextAutoWorkingDirectory,
    workingDirectory: shouldUpdateWorkingDirectory
      ? nextAutoWorkingDirectory
      : entry.workingDirectory,
    workingDirectoryOrigin: shouldUpdateWorkingDirectory
      ? 'auto'
      : entry.workingDirectoryOrigin
  };
};

export const applyExecutableInspection = (
  entry: ExecutableDraftEntry,
  inspection: FluxoraExecutableInspection,
  forceAutoName = false
): ExecutableDraftEntry => {
  if (comparablePath(entry.executablePath) !== comparablePath(inspection.executablePath)) {
    return entry;
  }

  return {
    ...entry,
    displayName:
      forceAutoName || entry.nameOrigin === 'auto'
        ? inspection.suggestedDisplayName
        : entry.displayName,
    iconPath: inspection.iconPath,
    nameOrigin: forceAutoName ? 'auto' : entry.nameOrigin
  };
};

export const persistedExecutableFromDraft = (
  entry: ExecutableDraftEntry
): FluxoraExecutable => {
  const {
    autoWorkingDirectory: _autoWorkingDirectory,
    nameOrigin: _nameOrigin,
    workingDirectoryOrigin: _workingDirectoryOrigin,
    ...persisted
  } = entry;
  return persisted;
};

export const persistedExecutablesFromDraft = (
  entries: readonly ExecutableDraftEntry[]
): FluxoraExecutable[] => entries.map(persistedExecutableFromDraft);

export const executableDraftIsDirty = (
  draft: readonly ExecutableDraftEntry[],
  saved: readonly FluxoraExecutable[]
): boolean =>
  JSON.stringify(persistedExecutablesFromDraft(draft)) !== JSON.stringify(saved);

export const moveExecutableDraft = <T extends { id: string }>(
  items: readonly T[],
  sourceId: string,
  targetId: string,
  placement: ExecutableDropPlacement
): T[] => {
  const sourceIndex = items.findIndex((entry) => entry.id === sourceId);
  const targetIndex = items.findIndex((entry) => entry.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return items as T[];
  }

  const next = [...items];
  const [moving] = next.splice(sourceIndex, 1);
  const targetIndexAfterRemoval = next.findIndex((entry) => entry.id === targetId);
  const insertionIndex = targetIndexAfterRemoval + (placement === 'after' ? 1 : 0);
  next.splice(insertionIndex, 0, moving);

  return next.every((entry, index) => entry === items[index]) ? (items as T[]) : next;
};

export const moveExecutableDraftByOffset = <T extends { id: string }>(
  items: readonly T[],
  sourceId: string,
  offset: -1 | 1
): T[] => {
  const sourceIndex = items.findIndex((entry) => entry.id === sourceId);
  const target = items[sourceIndex + offset];
  if (sourceIndex < 0 || !target) {
    return items as T[];
  }
  return moveExecutableDraft(
    items,
    sourceId,
    target.id,
    offset < 0 ? 'before' : 'after'
  );
};

export const validateExecutableDraft = (
  entries: readonly ExecutableDraftEntry[]
): ExecutableDraftValidationIssue[] =>
  entries.flatMap((entry) => {
    const issues: ExecutableDraftValidationIssue[] = [];
    if (!entry.displayName.trim()) {
      issues.push({ field: 'displayName', id: entry.id });
    }
    if (!entry.executablePath.trim() || !/\.exe$/iu.test(entry.executablePath.trim())) {
      issues.push({ field: 'executablePath', id: entry.id });
    }
    return issues;
  });
