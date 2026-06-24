import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const electronRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(electronRoot, '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const fileExists = (...segments: string[]): boolean =>
  fs.existsSync(path.join(repoRoot, ...segments));

const collectFiles = (directory: string): string[] => {
  const absoluteDirectory = path.join(repoRoot, directory);
  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relativePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(relativePath);
    }

    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [relativePath] : [];
  });
};

describe('Phase 16 parity gate', () => {
  it('documents the completed parity gate and Phase 17 WPF removal evidence', () => {
    const doc = readText('docs', 'electron-migration', 'parity-gate.md');

    for (const requiredSection of [
      '## Gate commands',
      '## Unit coverage matrix',
      '## E2E coverage matrix',
      '## Backend gate',
      '## Visual and performance gate',
      '## Manual acceptance gate',
      '## Release smoke gate',
      '## Final migration Definition of Done'
    ]) {
      expect(doc).toContain(requiredSection);
    }

    for (const requiredScenario of [
      'Startup',
      'Create/open project',
      'Mod list operations',
      'Plugin operations',
      'Downloads/install',
      'FOMOD',
      'Profiles',
      'Executables',
      'Settings',
      'MO2 transfer',
      'FluxPack'
    ]) {
      expect(doc).toContain(requiredScenario);
    }

    expect(doc).toContain('Phase 17 deprecation and removal');
    expect(doc).toContain('WPF baseline capture is no longer a blocking input');
  });

  it('documents the final migration Definition of Done and remaining release evidence', () => {
    const finalDod = readText('docs', 'electron-migration', 'final-definition-of-done.md');

    for (const requiredSection of [
      '# Fluxora Electron migration final Definition of Done',
      '## Completion Matrix',
      '## Scenario Evidence',
      '## Gate Commands',
      '## Remaining Release Evidence'
    ]) {
      expect(finalDod).toContain(requiredSection);
    }

    for (const requiredEvidence of [
      'Electron UI replaces WPF',
      'C++ core owns business logic',
      'Electron is a UI/bridge client',
      'Windows/Linux/macOS support is architecture-ready',
      'Real archive install e2e fixture',
      'Clean-machine Windows installer smoke',
      'Final owner/legal review'
    ]) {
      expect(finalDod).toContain(requiredEvidence);
    }

    const readme = readText('docs', 'electron-migration', 'README.md');
    expect(readme).toContain('final-definition-of-done.md');
    expect(readme).toContain('Not public-release accepted yet');
  });

  it('keeps the repository free of active legacy WPF frontend entrypoints', () => {
    expect(fileExists('frontend')).toBe(false);
    expect(fileExists('frontend.Tests')).toBe(false);
    expect(readText('Build.ps1')).not.toContain('LegacyWpf');
    expect(readText('Build.ps1')).not.toContain('FluxoraModding.exe');
    expect(readText('installer', 'Fluxora.Installer', 'Fluxora.Installer.csproj')).not.toContain(
      '..\\..\\frontend'
    );
    expect(readText('backend', 'src', 'Installer', 'FluxoraInstallerApi.cpp')).not.toContain(
      'FluxoraModding.exe'
    );
  });

  it('keeps unit coverage anchors for renderer, preload, bridge and wizard parity', () => {
    const requiredTests = [
      ['frontend-electron', 'tests', 'project-catalog-state.test.ts'],
      ['frontend-electron', 'tests', 'mod-workspace-state.test.ts'],
      ['frontend-electron', 'tests', 'plugin-workspace-state.test.ts'],
      ['frontend-electron', 'tests', 'download-workspace-state.test.ts'],
      ['frontend-electron', 'tests', 'install-workspace-state.test.ts'],
      ['frontend-electron', 'tests', 'profiles-executables-workspace-state.test.ts'],
      ['frontend-electron', 'tests', 'settings-workspace-state.test.ts'],
      ['frontend-electron', 'tests', 'build-workspace-state.test.ts'],
      ['frontend-electron', 'tests', 'preload-api.test.ts'],
      ['frontend-electron', 'tests', 'bridge-protocol-client.test.ts'],
      ['frontend-electron', 'tests', 'ui-performance.test.ts']
    ];

    for (const testPath of requiredTests) {
      expect(fileExists(...testPath), testPath.join('/')).toBe(true);
    }

    expect(readText('frontend-electron', 'tests', 'project-catalog-state.test.ts')).toContain(
      'isProjectDraftStepComplete'
    );
    expect(readText('frontend-electron', 'tests', 'install-workspace-state.test.ts')).toContain(
      'evaluateFomodWizard'
    );
    expect(readText('frontend-electron', 'tests', 'install-workspace-state.test.ts')).toContain(
      'validateInstallModName'
    );
    expect(readText('frontend-electron', 'tests', 'settings-workspace-state.test.ts')).toContain(
      'MO2'
    );
    expect(readText('frontend-electron', 'tests', 'preload-api.test.ts')).toContain(
      'FluxoraIpcChannels'
    );
    expect(readText('frontend-electron', 'tests', 'bridge-protocol-client.test.ts')).toContain(
      'operations.progress'
    );
  });

  it('keeps the Playwright smoke anchored to the major migrated workflows', () => {
    const smoke = readText('frontend-electron', 'e2e', 'electron-smoke.spec.ts');

    for (const expectedWorkflow of [
      'opens the secure Fluxora Electron shell',
      'passes Phase 13 visual, accessibility and performance smoke gates',
      'loads mods, plugins and downloads workspaces with search and row actions',
      'window.fluxora.projects.create',
      'Search mods',
      'Search plugins',
      'Ready to install',
      'Profile',
      'Executable',
      'Launch',
      'Build path settings',
      'window.fluxora.fluxPack.export',
      'Mod Organizer transfer'
    ]) {
      expect(smoke).toContain(expectedWorkflow);
    }
  });

  it('keeps backend parity coverage anchors visible', () => {
    for (const backendTest of [
      'ProjectServiceTests.cpp',
      'BuildPathSettingsServiceTests.cpp',
      'DownloadServiceTests.cpp',
      'ContentLayoutServiceTests.cpp',
      'FomodInstallerServiceTests.cpp',
      'PluginServiceTests.cpp',
      'ModOrganizerImportServiceTests.cpp',
      'FluxPackServiceTests.cpp',
      'ExecutableServiceTests.cpp',
      'PathSafetyServiceTests.cpp'
    ]) {
      expect(fileExists('backend', 'tests', backendTest), backendTest).toBe(true);
    }
  });

  it('keeps Electron renderer isolated from Node and sync IPC', () => {
    const rendererFiles = collectFiles(path.join('frontend-electron', 'src', 'renderer'));
    const forbiddenRendererPattern =
      /\b(ipcRenderer|child_process|require\s*\(|from\s+['"]electron['"]|from\s+['"]node:|process\.)/;

    const rendererHits = rendererFiles.flatMap((file) => {
      const text = readText(file);
      return forbiddenRendererPattern.test(text) ? [file] : [];
    });

    expect(rendererHits).toEqual([]);

    const electronSourceFiles = collectFiles(path.join('frontend-electron', 'src'));
    const forbiddenSyncPattern =
      /\b(sendSync|readFileSync|writeFileSync|appendFileSync|execSync|spawnSync)\b/;
    const syncHits = electronSourceFiles.flatMap((file) => {
      const text = readText(file);
      return forbiddenSyncPattern.test(text) ? [file] : [];
    });

    expect(syncHits).toEqual([]);

    expect(readText('frontend-electron', 'src', 'preload', 'fluxora-api.ts')).not.toContain(
      'ipcRenderer'
    );
    expect(readText('frontend-electron', 'src', 'preload', 'index.ts')).not.toContain('sendSync');
  });

  it('exposes dedicated parity commands', () => {
    const packageJson = JSON.parse(
      readText('frontend-electron', 'package.json')
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['test:parity']).toBe(
      'vitest run tests/parity-gate.test.ts'
    );
    expect(packageJson.scripts?.['parity:gate']).toBe(
      'npm run typecheck && npm test && npm run test:e2e'
    );
    expect(fileExists('scripts', 'Invoke-FluxoraParityGate.ps1')).toBe(true);
  });
});
