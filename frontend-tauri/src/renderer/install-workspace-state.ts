import type {
  FluxoraContentLayoutPreview,
  FluxoraContentLayoutPreviewEntry,
  FluxoraFomodDependency,
  FluxoraFomodFileDependencyState,
  FluxoraFomodGroup,
  FluxoraFomodInstaller,
  FluxoraFomodManualDecision,
  FluxoraFomodOption,
  FluxoraPlacementOverride
} from '../shared/fluxora-api';

export type InstallSourceKind = 'download' | 'archive';

export interface InstallSource {
  kind: InstallSourceKind;
  sourcePath: string;
  displayName: string;
  fileName: string;
}

export interface InstallModOrderPlacement {
  targetOrderId: string;
  placement: 'before' | 'after';
}

export type PlacementOverrideMap = Record<
  string,
  {
    target: string;
    targetRelativePath: string;
  }
>;

export interface ArchivePlacementRow {
  key: string;
  name: string;
  depth: number;
  isDirectory: boolean;
  sourcePath: string;
  target: string;
  targetRelativePath: string;
  displayPath: string;
  entry: FluxoraContentLayoutPreviewEntry | null;
  canAcceptDrops: boolean;
}

export interface EvaluatedFomodOption {
  option: FluxoraFomodOption;
  effectiveType: string;
  isSelected: boolean;
  isUsable: boolean;
  isAutoLocked: boolean;
  canToggle: boolean;
  wasPreviouslySelected: boolean;
}

export interface EvaluatedFomodGroup {
  group: FluxoraFomodGroup;
  options: EvaluatedFomodOption[];
  isSelectionValid: boolean;
  validationMessage: string;
}

export interface EvaluatedFomodStep {
  stepIndex: number;
  visibleNumber: number;
  stepName: string;
  groups: EvaluatedFomodGroup[];
  isSelectionValid: boolean;
  validationMessage: string;
}

export interface EvaluatedFomodWizard {
  visibleSteps: EvaluatedFomodStep[];
  selectedOptionIds: string[];
}

const reservedDeviceNames = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
]);

export const INSTALL_MOD_NAME_MAX_LENGTH = 255;

export const normalizeInstallModName = (value: string): string =>
  value.trim().replace(/^[.\s]+|[.\s]+$/g, '');

export const validateInstallModName = (value: string): string => {
  const name = normalizeInstallModName(value);
  if (!name) {
    return 'Enter a mod name.';
  }

  if (name.length > INSTALL_MOD_NAME_MAX_LENGTH) {
    return `The name must be ${INSTALL_MOD_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) {
    return 'The name contains characters that cannot be used in a folder name.';
  }

  const deviceName = name.split('.')[0]?.toLocaleUpperCase() ?? '';
  if (reservedDeviceNames.has(deviceName)) {
    return 'This name is reserved by Windows. Choose another name.';
  }

  return '';
};

export const fileNameFromPath = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

export const defaultInstallModName = (path: string, fallback: string): string => {
  const fileName = fileNameFromPath(path || fallback);
  return fileName.replace(/\.(zip|7z|rar|fomod|omod|ba2|bsa)$/i, '').trim() || fileName || fallback;
};

const normalizePath = (path: string): string => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

const joinRelativePath = (folder: string, child: string): string => {
  const normalizedFolder = normalizePath(folder);
  const normalizedChild = normalizePath(child);
  return normalizedFolder ? `${normalizedFolder}/${normalizedChild}` : normalizedChild;
};

const displayNameForTarget = (target: string): string => {
  switch (target) {
    case 'data':
      return 'Data';
    case 'gameRoot':
      return 'Game root';
    case 'profile':
      return 'Profile';
    case 'overwrite':
      return 'Overwrite';
    case 'blocked':
      return 'Blocked';
    default:
      return target || 'Archive';
  }
};

const displayPathForEntry = (
  entry: FluxoraContentLayoutPreviewEntry,
  override?: PlacementOverrideMap[string]
): string => {
  const target = override?.target ?? entry.target;
  const targetRelativePath = normalizePath(override?.targetRelativePath ?? entry.targetRelativePath);
  const sourcePath = normalizePath(entry.sourcePath);

  switch (target) {
    case 'data':
      return targetRelativePath ? `Data/${targetRelativePath}` : 'Data';
    case 'gameRoot':
      return targetRelativePath || sourcePath;
    case 'profile':
      return targetRelativePath ? `Profile/${targetRelativePath}` : 'Profile';
    case 'overwrite':
      return targetRelativePath ? `Overwrite/${targetRelativePath}` : 'Overwrite';
    case 'blocked':
      return sourcePath ? `Blocked/${sourcePath}` : 'Blocked';
    default:
      return targetRelativePath ? `${displayNameForTarget(target)}/${targetRelativePath}` : sourcePath;
  }
};

const folderRelativePathForDisplay = (
  target: string,
  parts: string[],
  directoryIndex: number
): string => {
  const firstRelativePart = ['data', 'profile', 'overwrite', 'blocked'].includes(target) ? 1 : 0;
  if (directoryIndex < firstRelativePart) {
    return '';
  }

  return parts.slice(firstRelativePart, directoryIndex + 1).join('/');
};

interface PlacementNode {
  key: string;
  name: string;
  depth: number;
  isDirectory: boolean;
  sourcePath: string;
  target: string;
  targetRelativePath: string;
  displayPath: string;
  entry: FluxoraContentLayoutPreviewEntry | null;
  children: PlacementNode[];
}

export const buildArchivePlacementRows = (
  preview: FluxoraContentLayoutPreview,
  overrides: PlacementOverrideMap = {}
): ArchivePlacementRow[] => {
  const root: PlacementNode = {
    key: 'root',
    name: 'archive',
    depth: -1,
    isDirectory: true,
    sourcePath: '',
    target: '',
    targetRelativePath: '',
    displayPath: '',
    entry: null,
    children: []
  };
  const directories = new Map<string, PlacementNode>([['|', root]]);

  const sortedEntries = [...preview.entries].sort((left, right) =>
    left.sourcePath.localeCompare(right.sourcePath, undefined, { sensitivity: 'base' })
  );

  for (const entry of sortedEntries) {
    const override = overrides[entry.sourcePath];
    const target = override?.target ?? entry.target;
    const displayPath = displayPathForEntry(entry, override);
    const parts = displayPath.split('/').filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let parent = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const targetRelativePath = folderRelativePathForDisplay(target, parts, index);
      const directoryKey = `${target}|${normalizePath(targetRelativePath)}`;
      let directory = directories.get(directoryKey);
      if (!directory) {
        directory = {
          key: `dir:${directoryKey || parts[index]}`,
          name: parts[index],
          depth: index,
          isDirectory: true,
          sourcePath: '',
          target,
          targetRelativePath,
          displayPath: parts.slice(0, index + 1).join('/'),
          entry: null,
          children: []
        };
        directories.set(directoryKey, directory);
        parent.children.push(directory);
      }

      parent = directory;
    }

    const fileName = parts.at(-1) ?? fileNameFromPath(entry.sourcePath);
    parent.children.push({
      key: `file:${entry.sourcePath}`,
      name: fileName,
      depth: Math.max(0, parts.length - 1),
      isDirectory: false,
      sourcePath: entry.sourcePath,
      target,
      targetRelativePath: normalizePath(override?.targetRelativePath ?? entry.targetRelativePath),
      displayPath,
      entry,
      children: []
    });
  }

  const rows: ArchivePlacementRow[] = [];
  const visit = (node: PlacementNode): void => {
    const children = [...node.children].sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? -1 : 1;
      }

      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });

    for (const child of children) {
      rows.push({
        key: child.key,
        name: child.name,
        depth: child.depth,
        isDirectory: child.isDirectory,
        sourcePath: child.sourcePath,
        target: child.target,
        targetRelativePath: child.targetRelativePath,
        displayPath: child.displayPath,
        entry: child.entry,
        canAcceptDrops: child.isDirectory && child.target !== '' && child.target !== 'blocked'
      });
      visit(child);
    }
  };

  visit(root);
  return rows;
};

export const createPlacementOverrideForDrop = (
  entry: FluxoraContentLayoutPreviewEntry,
  folder: ArchivePlacementRow
): FluxoraPlacementOverride | null => {
  if (
    !folder.isDirectory ||
    !folder.canAcceptDrops ||
    !entry.manualOverrideAllowed ||
    !entry.safeManualTargets.some((target) => target.toLocaleLowerCase() === folder.target.toLocaleLowerCase())
  ) {
    return null;
  }

  return {
    sourcePath: entry.sourcePath,
    target: folder.target,
    targetRelativePath: joinRelativePath(folder.targetRelativePath, fileNameFromPath(entry.sourcePath))
  };
};

export const createPlacementOverrides = (
  preview: FluxoraContentLayoutPreview,
  overrides: PlacementOverrideMap
): FluxoraPlacementOverride[] =>
  preview.entries
    .map((entry) => {
      const override = overrides[entry.sourcePath];
      if (!override || !entry.manualOverrideAllowed) {
        return null;
      }

      const originalPath = normalizePath(entry.targetRelativePath);
      const nextPath = normalizePath(override.targetRelativePath);
      if (
        entry.target.toLocaleLowerCase() === override.target.toLocaleLowerCase() &&
        originalPath.toLocaleLowerCase() === nextPath.toLocaleLowerCase()
      ) {
        return null;
      }

      return {
        sourcePath: entry.sourcePath,
        target: override.target,
        targetRelativePath: nextPath
      };
    })
    .filter((override): override is FluxoraPlacementOverride => override !== null);

export const buildPlacementSummaryText = (
  preview: FluxoraContentLayoutPreview,
  overrideCount: number
): string => {
  const summary = preview.explanationSummary || 'Fluxora built an archive placement plan.';
  const changed = overrideCount > 0 ? ` Manual changes: ${overrideCount}.` : '';
  return `${summary} Files: ${preview.summary.totalEntries}, planned: ${preview.summary.plannedEntries}.${changed}`;
};

export const buildPlacementPreviewLines = (
  preview: FluxoraContentLayoutPreview,
  overrideCount: number
): string[] => {
  const lines: string[] = [];
  if (overrideCount > 0) {
    lines.push(`Manual placement changes: ${overrideCount}`);
  }

  for (const finding of preview.validationFindings.filter((item) => item.blocksInstall)) {
    lines.push(`${finding.path || 'Blocker'}: ${finding.message}`);
  }

  for (const finding of preview.validationFindings.filter((item) => !item.blocksInstall)) {
    lines.push(`${finding.path || 'Warning'}: ${finding.message}`);
  }

  for (const entry of preview.entries.slice(0, 8)) {
    const target =
      entry.target === 'blocked'
        ? 'blocked'
        : `${displayNameForTarget(entry.target)}/${entry.targetRelativePath}`.replace(/\/$/, '');
    lines.push(`${entry.sourcePath} -> ${target}: ${entry.explanation}`);
  }

  if (preview.entries.length > 8) {
    lines.push(`More files: ${preview.entries.length - 8}`);
  }

  return lines;
};

export const installSourceLabel = (source: InstallSource): string => {
  const label = source.fileName || fileNameFromPath(source.sourcePath) || source.displayName;
  return source.kind === 'download' ? `Download · ${label}` : `Archive · ${label}`;
};

export const installDestinationPreview = (
  modsDirectory: string | undefined,
  modName: string
): string => {
  const name = normalizeInstallModName(modName) || 'new mod';
  const root = modsDirectory?.trim().replace(/[\\/]+$/g, '');
  return root ? `${root}\\${name}` : `mods\\${name}`;
};

export const installCategoryLabel = (
  preview: FluxoraContentLayoutPreview,
  isFomod: boolean
): string => {
  const state = preview.summary.hasBlockers
    ? 'blocked'
    : preview.summary.hasWarnings
      ? 'needs review'
      : 'ready';
  const game = preview.gameDisplayName || preview.gameId || 'content layout';
  return [game, isFomod ? 'FOMOD' : 'simple archive', state].join(' · ');
};

const normalizeDependencyFile = (file: string): string => file.trim().replace(/\//g, '\\').replace(/^\\+/, '');

const isDependencySatisfied = (
  dependency: FluxoraFomodDependency | null | undefined,
  flags: ReadonlyMap<string, string>,
  fileDependencyStates: ReadonlyMap<string, FluxoraFomodFileDependencyState>
): boolean => {
  if (!dependency?.kind) {
    return true;
  }

  if (dependency.kind.toLocaleLowerCase() === 'flag') {
    return flags.get(dependency.flag) === dependency.value;
  }

  if (dependency.kind.toLocaleLowerCase() === 'file') {
    const fileState = fileDependencyStates.get(normalizeDependencyFile(dependency.file));
    const expectedState = dependency.state.toLocaleLowerCase();
    if (fileState?.state) {
      return fileState.state.toLocaleLowerCase() === expectedState;
    }
    const exists = fileState?.exists === true;
    return expectedState === 'missing' ? !exists : exists;
  }

  if (dependency.kind.toLocaleLowerCase() === 'composite') {
    if (dependency.children.length === 0) {
      return true;
    }

    return dependency.operator.toLocaleLowerCase() === 'or'
      ? dependency.children.some((child) => isDependencySatisfied(child, flags, fileDependencyStates))
      : dependency.children.every((child) => isDependencySatisfied(child, flags, fileDependencyStates));
  }

  return true;
};

const looksLikeAcknowledgement = (text: string): boolean => {
  const normalized = text.split(/\s+/).filter(Boolean).join(' ');
  const english =
    normalized.toLocaleLowerCase().includes('read') &&
    (normalized.toLocaleLowerCase().includes('understand') ||
      normalized.toLocaleLowerCase().includes('understood'));
  const russian =
    normalized.toLocaleLowerCase().includes('прочитал') &&
    (normalized.toLocaleLowerCase().includes('понял') ||
      normalized.toLocaleLowerCase().includes('понимаю'));
  return english || russian;
};

const effectiveOptionType = (
  option: FluxoraFomodOption,
  flags: ReadonlyMap<string, string>,
  fileDependencyStates: ReadonlyMap<string, FluxoraFomodFileDependencyState>
): string => {
  for (const pattern of option.typePatterns) {
    if (isDependencySatisfied(pattern.dependencies, flags, fileDependencyStates)) {
      return pattern.type || 'Optional';
    }
  }

  return option.defaultType || option.type || 'Optional';
};

const isGroupType = (group: FluxoraFomodGroup, type: string): boolean =>
  group.type.toLocaleLowerCase() === type.toLocaleLowerCase();

export const evaluateFomodWizard = (
  installer: FluxoraFomodInstaller,
  selectedOptionIds: string[]
): EvaluatedFomodWizard => {
  const selected = new Set(selectedOptionIds.filter(Boolean));
  const previous = new Set(installer.previousSelectedOptionIds.filter(Boolean));
  const fileDependencyStates = new Map(
    installer.fileDependencies
      .filter((dependency) => dependency.file.trim())
      .map((dependency) => [normalizeDependencyFile(dependency.file), dependency] as const)
  );
  const flags = new Map<string, string>();
  const visibleSteps: EvaluatedFomodStep[] = [];
  const recalculatedSelected: string[] = [];
  const addedSelected = new Set<string>();

  for (let stepIndex = 0; stepIndex < installer.steps.length; stepIndex++) {
    const step = installer.steps[stepIndex];
    if (!isDependencySatisfied(step.visible, flags, fileDependencyStates)) {
      continue;
    }

    const groups: EvaluatedFomodGroup[] = step.groups.map((group) => {
      const options = group.options.map((option) => {
        const effectiveType = effectiveOptionType(option, flags, fileDependencyStates);
        const isUsable = effectiveType.toLocaleLowerCase() !== 'notusable';
        const isRequired = effectiveType.toLocaleLowerCase() === 'required';
        const isAutoLocked =
          !looksLikeAcknowledgement(option.name) && (isRequired || isGroupType(group, 'SelectAll'));
        const isSelected = isUsable && (selected.has(option.id) || isAutoLocked);
        return {
          option,
          effectiveType,
          isSelected,
          isUsable,
          isAutoLocked,
          canToggle: isUsable && !isAutoLocked,
          wasPreviouslySelected: previous.has(option.id)
        };
      });

      const selectedCount = options.filter((option) => option.isSelected && option.isUsable).length;
      const exactlyOne = isGroupType(group, 'SelectExactlyOne');
      const atLeastOne = isGroupType(group, 'SelectAtLeastOne');
      const atMostOne = isGroupType(group, 'SelectAtMostOne');
      const isSelectionValid =
        (exactlyOne ? selectedCount === 1 : true) &&
        (atLeastOne ? selectedCount >= 1 : true) &&
        (atMostOne ? selectedCount <= 1 : true);
      const validationMessage = isSelectionValid
        ? ''
        : exactlyOne
          ? `Choose one option in "${group.name || 'Options'}".`
          : atLeastOne
            ? `Choose at least one option in "${group.name || 'Options'}".`
            : `Choose no more than one option in "${group.name || 'Options'}".`;

      return {
        group,
        options,
        isSelectionValid,
        validationMessage
      };
    });

    for (const group of groups) {
      for (const option of group.options.filter((item) => item.isSelected && item.isUsable)) {
        for (const flag of option.option.flags) {
          if (flag.name.trim()) {
            flags.set(flag.name, flag.value);
          }
        }

        if (option.option.id && !addedSelected.has(option.option.id)) {
          addedSelected.add(option.option.id);
          recalculatedSelected.push(option.option.id);
        }
      }
    }

    const acknowledgementMissing = groups.some((group) =>
      group.options.some(
        (option) =>
          looksLikeAcknowledgement(option.option.name) && option.isUsable && !option.isSelected
      )
    );
    const groupMessage = groups.find((group) => !group.isSelectionValid)?.validationMessage ?? '';
    visibleSteps.push({
      stepIndex,
      visibleNumber: visibleSteps.length + 1,
      stepName: step.name || 'Step',
      groups,
      isSelectionValid: groups.every((group) => group.isSelectionValid) && !acknowledgementMissing,
      validationMessage:
        groupMessage ||
        (acknowledgementMissing ? 'Confirm that you have read and understood this step.' : '')
    });
  }

  return {
    visibleSteps,
    selectedOptionIds: recalculatedSelected
  };
};

export const coerceFomodSelection = (
  installer: FluxoraFomodInstaller,
  selectedOptionIds: string[]
): string[] => {
  let next = [...selectedOptionIds];

  for (let pass = 0; pass < 4; pass++) {
    const evaluation = evaluateFomodWizard(installer, next);
    const nextSet = new Set(evaluation.selectedOptionIds);

    for (const step of evaluation.visibleSteps) {
      for (const group of step.groups) {
        const selectedUsable = group.options.filter((option) => option.isSelected && option.isUsable);
        const needsOne =
          isGroupType(group.group, 'SelectExactlyOne') || isGroupType(group.group, 'SelectAtLeastOne');
        if (needsOne && selectedUsable.length === 0 && !installer.autoSelection) {
          const recommended = group.options.filter(
            (option) =>
              option.isUsable &&
              option.effectiveType.toLocaleLowerCase() === 'recommended' &&
              !looksLikeAcknowledgement(option.option.name)
          );
          if (isGroupType(group.group, 'SelectAtLeastOne')) {
            for (const option of recommended) {
              nextSet.add(option.option.id);
            }
          } else if (recommended.length === 1) {
            nextSet.add(recommended[0].option.id);
          }
        }

        if (
          (isGroupType(group.group, 'SelectExactlyOne') || isGroupType(group.group, 'SelectAtMostOne')) &&
          selectedUsable.length > 1
        ) {
          for (const option of selectedUsable.slice(1)) {
            nextSet.delete(option.option.id);
          }
        }
      }
    }

    const candidate = [...nextSet];
    if (candidate.join('\n') === next.join('\n')) {
      return candidate;
    }

    next = candidate;
  }

  return evaluateFomodWizard(installer, next).selectedOptionIds;
};

export const initialFomodSelection = (installer: FluxoraFomodInstaller): string[] =>
  coerceFomodSelection(
    installer,
    installer.autoSelection?.initialSelectedOptionIds ??
      (installer.hasPreviousSelection ? installer.previousSelectedOptionIds : [])
  );

export const previousFomodSelection = (installer: FluxoraFomodInstaller): string[] =>
  coerceFomodSelection(installer, installer.previousSelectedOptionIds);

export const toggleFomodOption = (
  installer: FluxoraFomodInstaller,
  selectedOptionIds: string[],
  optionId: string,
  selected: boolean
): string[] => {
  const evaluation = evaluateFomodWizard(installer, selectedOptionIds);
  const optionGroup = evaluation.visibleSteps
    .flatMap((step) => step.groups)
    .find((group) => group.options.some((option) => option.option.id === optionId));
  const option = optionGroup?.options.find((item) => item.option.id === optionId);
  if (!optionGroup || !option?.canToggle) {
    return coerceFomodSelection(installer, selectedOptionIds);
  }

  const next = new Set(selectedOptionIds);
  if (selected) {
    if (
      isGroupType(optionGroup.group, 'SelectExactlyOne') ||
      isGroupType(optionGroup.group, 'SelectAtMostOne')
    ) {
      for (const other of optionGroup.options) {
        next.delete(other.option.id);
      }
    }

    next.add(optionId);
  } else {
    next.delete(optionId);
  }

  return coerceFomodSelection(installer, [...next]);
};

const fomodGroupForOption = (
  installer: FluxoraFomodInstaller,
  optionId: string
): FluxoraFomodGroup | null => {
  for (const step of installer.steps) {
    for (const group of step.groups) {
      if (group.options.some((option) => option.id === optionId)) {
        return group;
      }
    }
  }
  return null;
};

export const sanitizeFomodManualDecisions = (
  installer: FluxoraFomodInstaller,
  decisions: FluxoraFomodManualDecision[]
): FluxoraFomodManualDecision[] => {
  const validOptionIds = new Set(
    installer.steps.flatMap((step) =>
      step.groups.flatMap((group) => group.options.map((option) => option.id))
    )
  );
  const byOptionId = new Map<string, boolean>();
  for (const decision of decisions) {
    if (decision.optionId && validOptionIds.has(decision.optionId)) {
      byOptionId.set(decision.optionId, decision.selected);
    }
  }
  return [...byOptionId].map(([optionId, selected]) => ({ optionId, selected }));
};

export const updateFomodManualDecisions = (
  installer: FluxoraFomodInstaller,
  current: FluxoraFomodManualDecision[],
  selectedOptionIds: string[],
  changedOptionId: string
): FluxoraFomodManualDecision[] => {
  const group = fomodGroupForOption(installer, changedOptionId);
  if (!group) {
    return sanitizeFomodManualDecisions(installer, current);
  }

  const selected = new Set(selectedOptionIds);
  const affectedOptionIds =
    isGroupType(group, 'SelectExactlyOne') || isGroupType(group, 'SelectAtMostOne')
      ? new Set(group.options.map((option) => option.id))
      : new Set([changedOptionId]);
  const next = current.filter((decision) => !affectedOptionIds.has(decision.optionId));
  for (const optionId of affectedOptionIds) {
    next.push({ optionId, selected: selected.has(optionId) });
  }
  return sanitizeFomodManualDecisions(installer, next);
};

export const currentFomodStepValidation = (
  evaluation: EvaluatedFomodWizard,
  visibleStepIndex: number
): string => evaluation.visibleSteps[visibleStepIndex]?.validationMessage ?? '';

export const findExistingInstalledModName = (
  installedModNames: string[],
  modName: string
): string | null => {
  const normalized = normalizeInstallModName(modName).toLocaleLowerCase();
  return installedModNames.find((name) => name.toLocaleLowerCase() === normalized) ?? null;
};
