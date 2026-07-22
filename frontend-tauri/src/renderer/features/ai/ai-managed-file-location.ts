import type { FluxoraAiFileChange, FluxoraProject } from '../../../shared/fluxora-api';

export interface AiManagedFileLocation {
  absolutePath: string;
  modPath: string;
  relativePath: string;
}

const safePathSegments = (value: string): string[] | null => {
  const segments = value.replaceAll('\\', '/').split('/').filter(Boolean);
  if (
    segments.length < 2 ||
    segments.some((segment) =>
      segment === '.' ||
      segment === '..' ||
      segment.includes('\0') ||
      /[<>:"|?*]/u.test(segment)
    )
  ) {
    return null;
  }
  return segments;
};

const joinNativePath = (root: string, segments: readonly string[]): string => {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const normalizedRoot = root.replace(/[\\/]+$/u, '');
  return [normalizedRoot, ...segments].join(separator);
};

export const resolveAiManagedFileLocation = (
  project: FluxoraProject,
  change: FluxoraAiFileChange
): AiManagedFileLocation | null => {
  if (change.scope !== 'build') return null;
  const modsDirectory = project.paths?.modsDirectory?.trim() ?? '';
  const segments = safePathSegments(change.relativePath);
  const ownerMod = change.ownerMod?.trim() ?? '';
  if (!modsDirectory || !segments || !ownerMod || segments[0] !== ownerMod) return null;

  return {
    absolutePath: joinNativePath(modsDirectory, segments),
    modPath: joinNativePath(modsDirectory, [ownerMod]),
    relativePath: segments.slice(1).join('/')
  };
};
