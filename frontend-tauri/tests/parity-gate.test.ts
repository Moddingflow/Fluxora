import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tauriRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(tauriRoot, '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const fileExists = (...segments: string[]): boolean =>
  fs.existsSync(path.join(repoRoot, ...segments));

const oldFrontendPath = ['frontend-elec', 'tron'].join('');

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

describe('Tauri parity gate', () => {
  it('documents the active Tauri migration and runtime architecture', () => {
    const readme = readText('docs', 'tauri-migration', 'README.md');
    const architecture = readText('docs', 'tauri-migration', 'architecture.md');

    for (const expected of [
      'frontend-tauri',
      'Tauri',
      'C++ core',
      'FluxoraBridgeHost',
      'window.fluxora'
    ]) {
      expect(readme + architecture).toContain(expected);
    }
  });

  it('keeps repository instructions pointed at the Tauri UI', () => {
    for (const file of ['AGENTS.md', '.agents/PROJECT_RULES.md', 'README.md']) {
      const text = readText(file);
      expect(text).toContain('frontend-tauri');
      expect(text).toContain('Tauri');
      expect(text).not.toContain(oldFrontendPath);
    }
  });

  it('keeps the Tauri scaffold and bridge facade present', () => {
    for (const requiredPath of [
      ['frontend-tauri', 'src-tauri', 'Cargo.toml'],
      ['frontend-tauri', 'src-tauri', 'tauri.conf.json'],
      ['frontend-tauri', 'src-tauri', 'capabilities', 'main.json'],
      ['frontend-tauri', 'src-tauri', 'src', 'lib.rs'],
      ['frontend-tauri', 'src-tauri', 'src', 'main.rs'],
      ['frontend-tauri', 'src', 'tauri', 'fluxora-api.ts'],
      ['frontend-tauri', 'src', 'tauri', 'register-fluxora-api.ts'],
      ['frontend-tauri', 'src', 'shared', 'fluxora-api.ts'],
      ['frontend-tauri', 'src', 'shared', 'window.d.ts']
    ]) {
      expect(fileExists(...requiredPath), requiredPath.join('/')).toBe(true);
    }

    expect(readText('frontend-tauri', 'src', 'renderer', 'main.tsx')).toContain(
      "import '../tauri/register-fluxora-api'"
    );
    expect(readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts')).toContain(
      'createTauriFluxoraApi'
    );
  });

  it('keeps renderer behavior coverage anchors', () => {
    const requiredTests = [
      'project-catalog-state.test.ts',
      'mod-workspace-state.test.ts',
      'plugin-workspace-state.test.ts',
      'download-workspace-state.test.ts',
      'install-workspace-state.test.ts',
      'profiles-executables-workspace-state.test.ts',
      'settings-workspace-state.test.ts',
      'build-workspace-state.test.ts',
      'ui-performance.test.ts',
      'renderer-services.test.ts',
      'transfer-mo2-page.test.ts',
      'mo2-transfer-request.test.ts'
    ];

    for (const testFile of requiredTests) {
      expect(fileExists('frontend-tauri', 'tests', testFile), testFile).toBe(true);
    }

    expect(readText('frontend-tauri', 'tests', 'project-catalog-state.test.ts')).toContain(
      'isProjectDraftStepComplete'
    );
    expect(readText('frontend-tauri', 'tests', 'install-workspace-state.test.ts')).toContain(
      'evaluateFomodWizard'
    );
    expect(readText('frontend-tauri', 'tests', 'settings-workspace-state.test.ts')).toContain('MO2');
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

  it('keeps renderer code isolated from Node and raw native APIs', () => {
    const rendererFiles = collectFiles(path.join('frontend-tauri', 'src', 'renderer'));
    const forbiddenRendererPattern =
      /\b(child_process|require\s*\(|from\s+['"]node:|process\.|sendSync|readFileSync|writeFileSync|appendFileSync|execSync|spawnSync)\b/;

    const rendererHits = rendererFiles.flatMap((file) => {
      const text = readText(file);
      return forbiddenRendererPattern.test(text) ? [file] : [];
    });

    expect(rendererHits).toEqual([]);
  });

  it('routes native shell affordances through the Rust Tauri shell', () => {
    const packageJson = JSON.parse(readText('frontend-tauri', 'package.json')) as {
      dependencies?: Record<string, string>;
    };
    const capabilities = readText('frontend-tauri', 'src-tauri', 'capabilities', 'main.json');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const rustMain = readText('frontend-tauri', 'src-tauri', 'src', 'main.rs');

    expect(packageJson.dependencies).not.toHaveProperty('@tauri-apps/plugin-dialog');
    expect(packageJson.dependencies).not.toHaveProperty('@tauri-apps/plugin-opener');
    expect(capabilities).not.toContain('dialog:default');
    expect(capabilities).not.toContain('opener:default');
    expect(facade).not.toContain('@tauri-apps/plugin-dialog');
    expect(facade).not.toContain('@tauri-apps/plugin-opener');

    for (const command of [
      'fluxora_dialog_pick_file',
      'fluxora_dialog_pick_folder',
      'fluxora_dialog_save_file',
      'fluxora_open_external',
      'fluxora_shell_open_path',
      'fluxora_shell_show_item_in_folder',
      'fluxora_window_close',
      'fluxora_window_minimize',
      'fluxora_window_toggle_maximize'
    ]) {
      expect(facade + rustShell).toContain(command);
    }

    expect(rustShell).toContain('CREATE_NO_WINDOW');
    expect(rustMain).toContain('windows_subsystem = "windows"');
  });

  it('routes Tauri and native logs next to the app executable', () => {
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const sharedApi = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const logger = readText('backend', 'src', 'Services', 'Logger.cpp');

    expect(rustShell).toContain('executable_log_dir');
    expect(rustShell).toContain('std::env::current_exe');
    expect(rustShell).toContain('Fluxora Tauri shell started');
    expect(rustShell).toContain('FLUXORA_LOG_DIR');
    expect(rustShell).toContain('FLUXORA_OPERATION_CANCEL_DIR');
    expect(rustShell).toContain('operation_cancel_marker_path');
    expect(rustShell).toContain('nativeLogDirectory');
    expect(sharedApi).toContain('nativeLogDirectory');
    expect(logger).toContain('configuredLogDirectory');
    expect(logger).toContain('FLUXORA_LOG_DIR');
  });

  it('prefers packaged native bridge resources before build fallbacks', () => {
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');

    expect(rustShell).toContain('push_packaged_native_candidate');
    expect(rustShell).toContain('.join("resources").join("native").join(executable)');
    expect(rustShell).toContain('hostPath=');
    expect(
      rustShell.indexOf('push_packaged_native_candidate(&mut candidates, &current_dir, executable)')
    ).toBeLessThan(
      rustShell.indexOf('for configuration in ["Release", "RelWithDebInfo", "Debug", "MinSizeRel"]')
    );
  });

  it('keeps Windows packages VFS-enabled for MO2-style launches', () => {
    const buildScript = readText('Build.ps1');
    const stageScript = readText('frontend-tauri', 'scripts', 'stage-native-resources.ps1');
    const launchApi = readText('backend', 'src', 'FluxoraCoreApi.cpp');
    const vfsService = readText('backend', 'src', 'Services', 'VirtualFileSystemService.cpp');

    expect(buildScript).toContain('-DFLUXORA_ENABLE_VFS=ON');
    expect(buildScript).toContain('Windows Fluxora builds require the VFS hook');
    expect(buildScript).toContain("resources\\native\\FluxoraVfs.dll");
    expect(stageScript).toContain("$requiredArtifacts += 'FluxoraVfs.dll'");
    expect(stageScript).toContain('FLUXORA_ENABLE_VFS:BOOL=OFF');
    expect(launchApi).toContain('missing VFS support is a build error');
    expect(vfsService).toContain('virtual file system support is not compiled into this Fluxora build');
    expect(vfsService).not.toContain('Fluxora was built without VFS support for this platform');
  });

  it('keeps MO2 transfer handoff in the Rust shell and closes Settings on launch', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');

    expect(app).toContain('await window.fluxora.transfer.openMo2InMain();');
    expect(app).toContain('await window.fluxora.windowControls.close();');
    expect(app).toContain('transferRunningOperationIdRef.current = operationId;');
    expect(facade).toContain('fluxora_transfer_open_mo2_in_main');
    expect(facade).toContain('fluxora_transfer_start_mo2_in_main');
    expect(facade).toContain('transferImportTimeoutMs');
    expect(facade).not.toContain('await emit(FluxoraIpcChannels.transferMo2');
    expect(rustShell).toContain('emit_to(MAIN_WINDOW_LABEL, TRANSFER_MO2_OPEN_EVENT');
    expect(rustShell).toContain('emit_to(MAIN_WINDOW_LABEL, TRANSFER_MO2_HANDOFF_EVENT');
  });

  it('exposes dedicated parity commands', () => {
    const packageJson = JSON.parse(readText('frontend-tauri', 'package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['test:parity']).toBe('vitest run tests/parity-gate.test.ts');
    expect(packageJson.scripts?.['parity:gate']).toBe(
      'npm run typecheck && npm test && npm run test:e2e'
    );
    expect(fileExists('scripts', 'Invoke-FluxoraParityGate.ps1')).toBe(true);
  });
});
