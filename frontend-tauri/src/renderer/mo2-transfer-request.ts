import type {
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportRequest
} from '../shared/fluxora-api';

const transferBuildsFolderName = 'Fluxora Builds';

const trimTrailingSeparators = (value: string): string =>
  value.trim().replace(/[\\/]+$/, '');

const pathLeaf = (rawPath: string): string => {
  const trimmed = trimTrailingSeparators(rawPath);
  if (!trimmed) {
    return '';
  }

  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? trimmed;
};

const comparePath = (rawPath: string): string =>
  trimTrailingSeparators(rawPath).replace(/\//g, '\\').toLowerCase();

const pathStartsInside = (candidate: string, root: string): boolean => {
  const normalizedCandidate = comparePath(candidate);
  const normalizedRoot = comparePath(root);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}\\`)
  );
};

export const normalizeMo2TransferDestinationRoot = (rootPath: string): string => {
  const root = trimTrailingSeparators(rootPath);
  if (!root) {
    return '';
  }

  return pathLeaf(root).toLowerCase() === transferBuildsFolderName.toLowerCase()
    ? root
    : `${root}\\${transferBuildsFolderName}`;
};

export const normalizeMo2TransferTargetProjectDirectory = (
  targetProjectDirectory: string | undefined,
  destinationRootDirectory: string,
  fallbackBuildName: string
): string => {
  const root = normalizeMo2TransferDestinationRoot(destinationRootDirectory);
  const target = trimTrailingSeparators(targetProjectDirectory ?? '');
  if (!root) {
    return target;
  }

  if (target && pathStartsInside(target, root)) {
    return target;
  }

  const folderName = pathLeaf(target) || fallbackBuildName.trim();
  return folderName ? `${root}\\${folderName}` : root;
};

export const normalizeMo2TransferAnalysis = (
  analysis: FluxoraModOrganizerImportAnalysis,
  requestedDestinationRootDirectory: string
): FluxoraModOrganizerImportAnalysis => {
  const destinationRootDirectory = normalizeMo2TransferDestinationRoot(
    analysis.destinationRootDirectory || requestedDestinationRootDirectory
  );

  return {
    ...analysis,
    destinationRootDirectory,
    targetProjectDirectory: normalizeMo2TransferTargetProjectDirectory(
      analysis.targetProjectDirectory,
      destinationRootDirectory,
      analysis.projectName
    )
  };
};

export const createMo2TransferImportRequest = (
  sourceDirectory: string,
  destinationRootDirectory: string
): FluxoraModOrganizerImportRequest => ({
  sourceDirectory,
  destinationRootDirectory: normalizeMo2TransferDestinationRoot(destinationRootDirectory),
  replaceExisting: false
});
