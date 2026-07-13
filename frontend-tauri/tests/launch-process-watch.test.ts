import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('launch process watch wiring', () => {
  it('keeps executable launch splash open until the launched process exits', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const shared = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const processPlatform = readText(
      'frontend-tauri',
      'src-tauri',
      'src',
      'process_platform.rs'
    );
    const launchFlow = app.slice(
      app.indexOf('const launchExecutable = async () =>'),
      app.indexOf('const requestGrassCacheGeneration = () =>')
    );

    expect(shared).toContain('processesWatchLaunchReady');
    expect(shared).toContain('processesWaitForExit');
    expect(facade).toContain('fluxora_wait_for_launch_ready');
    expect(facade).toContain('fluxora_wait_for_process_exit');
    expect(launchFlow).toContain('window.fluxora.processes.waitForLaunchReady');
    expect(launchFlow).toContain('watchLaunchProcessSession');
    expect(launchFlow).toContain('Процесс запускается');
    expect(launchFlow).toContain('Процесс запущен');
    expect(launchFlow).toContain('Закройте процесс, чтобы продолжить работу в Mod Manager.');
    expect(processPlatform).toContain('WaitForSingleObject(handle, INFINITE)');
    expect(processPlatform).toContain('find_processes_using_module');
    expect(rustShell).toContain('Native process exit signal unavailable; using fallback polling');
    expect(rustShell).toContain('Tracked process exited but a VFS holder remains');
    expect(launchFlow).toMatch(
      /ready\.state !== 'running'[\s\S]*setLaunchSplash\(\(current\) => \(current\?\.operationId === operationId \? null : current\)\);[\s\S]*void loadModsWorkspace\(selectedProject, \{\s*resetScroll: false,\s*showBusy: false,\s*showLoading: false\s*\}\);/
    );
    expect(launchFlow).toMatch(
      /await watchLaunchProcessSession\([\s\S]*setLaunchSplash\(\(current\) =>[\s\S]*current\?\.operationId === operationId \? null : current[\s\S]*void loadModsWorkspace\(selectedProject, \{\s*resetScroll: false,\s*showBusy: false,\s*showLoading: false\s*\}\);/
    );
  });
});
