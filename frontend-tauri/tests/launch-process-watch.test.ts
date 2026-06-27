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

    expect(shared).toContain('processesWatchLaunchReady');
    expect(shared).toContain('processesWaitForExit');
    expect(facade).toContain('fluxora_wait_for_launch_ready');
    expect(facade).toContain('fluxora_wait_for_process_exit');
    expect(app).toContain('window.fluxora.processes.waitForLaunchReady');
    expect(app).toContain('window.fluxora.processes.waitForExit');
    expect(app).toContain('Процесс запускается');
    expect(app).toContain('Процесс запущен');
    expect(app).toContain('Закройте процесс, чтобы продолжить работу в Mod Manager.');
  });
});
