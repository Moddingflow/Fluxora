import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync
} from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ICON_FILENAMES } from '../src/renderer/design-system/icons';

interface ProvenanceGroup {
  files: string[];
  licenseFile: string;
  hashes: Record<string, string>;
}

interface ProvenanceRegistry {
  verified: ProvenanceGroup[];
  projectOwned: ProvenanceGroup[];
  quarantined: string[];
}

const iconsDirectory = fileURLToPath(new URL('../../Icons/', import.meta.url));
const iconSourcePath = fileURLToPath(
  new URL('../src/renderer/design-system/icons/Icon.tsx', import.meta.url)
);
const rendererSourceDirectory = fileURLToPath(new URL('../src/', import.meta.url));
const legacyRendererIconDirectory = fileURLToPath(
  new URL('../src/renderer/assets/icons/', import.meta.url)
);
const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
const lockfilePath = fileURLToPath(new URL('../pnpm-lock.yaml', import.meta.url));
const iconReadmePath = fileURLToPath(
  new URL('../../Icons/README.md', import.meta.url)
);
const installerTitlebarPath = fileURLToPath(
  new URL('../src/installer/components/InstallerTitlebar.tsx', import.meta.url)
);

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return productionSourceFiles(path);
    }
    return statSync(path).isFile() && /\.(?:ts|tsx|js|jsx)$/u.test(entry.name)
      ? [path]
      : [];
  });
}

describe('root icon import contract', () => {
  it('maps every design-system icon to a verified, licensed, hash-pinned root asset', () => {
    const provenance = JSON.parse(
      readFileSync(`${iconsDirectory}/provenance.json`, 'utf8')
    ) as ProvenanceRegistry;
    const metadataByFile = new Map(
      [...provenance.verified, ...provenance.projectOwned].flatMap((group) =>
        group.files.map((file) => [file, group] as const)
      )
    );
    const iconReadme = readFileSync(iconReadmePath, 'utf8');

    for (const filename of new Set(Object.values(ICON_FILENAMES))) {
      const iconPath = `${iconsDirectory}/${filename}`;
      const metadata = metadataByFile.get(filename);
      expect(existsSync(iconPath), `${filename} must exist in the root Icons directory`).toBe(true);
      expect(
        provenance.quarantined,
        `${filename} must not be imported while quarantined`
      ).not.toContain(filename);
      expect(metadata, `${filename} must have verified provenance`).toBeDefined();
      expect(
        existsSync(`${iconsDirectory}/${metadata?.licenseFile}`),
        `${filename} must reference an available license file`
      ).toBe(true);
      expect(
        iconReadme,
        `${filename} must document its upstream or project-owned source and actual use`
      ).toContain(`\`${filename}\``);
      expect(createHash('sha256').update(readFileSync(iconPath)).digest('hex')).toBe(
        metadata?.hashes[filename]
      );
    }
  });

  it('contains no renderer-owned SVG geometry or inline SVG markup', () => {
    const source = readFileSync(iconSourcePath, 'utf8');
    expect(source).not.toContain('STROKE_PATHS');
    expect(source).not.toMatch(/<svg\b/iu);
    expect(source).not.toMatch(/<path\b/iu);
    expect(source).not.toMatch(/\sd=(["'])M/iu);
  });

  it('rejects production lucide-react imports and dependency reintroduction', () => {
    for (const sourcePath of productionSourceFiles(rendererSourceDirectory)) {
      expect(readFileSync(sourcePath, 'utf8'), sourcePath).not.toMatch(
        /(?:from\s+|require\()\s*['"]lucide-react['"]/u
      );
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies ?? {}).not.toHaveProperty('lucide-react');
    expect(packageJson.optionalDependencies ?? {}).not.toHaveProperty(
      'lucide-react'
    );
    expect(readFileSync(lockfilePath, 'utf8')).not.toContain('lucide-react');
    expect(
      existsSync(legacyRendererIconDirectory),
      'renderer-owned duplicate icon directory must not be reintroduced'
    ).toBe(false);
  });

  it('renders the project-owned titlebar mark through the currentColor mask primitive', () => {
    const source = readFileSync(installerTitlebarPath, 'utf8');
    expect(source).toContain('name="fluxora-mark"');
    expect(source).not.toMatch(/<img[^>]+Fluxora/iu);
  });
});
