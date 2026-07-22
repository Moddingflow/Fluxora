import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('BodySlide managed launch contract', () => {
  it('keeps optional DTO fields backward compatible and routes finalization to background', () => {
    const shared = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const bridge = readText('backend', 'src', 'BridgeHost', 'FluxoraBridgeHost.cpp');

    expect(shared).toContain("managedToolKind?: 'bodySlide'");
    expect(shared).toContain('managedSessionId?: string');
    expect(shared).toContain('outputMod?: FluxoraManagedOutputMod');
    expect(shared).toContain('configurationStatus?:');
    expect(shared).toContain('warnings?: string[]');
    expect(facade).toContain("'executables.completeManagedLaunch'");
    expect(facade).toContain("requestWithOperationId(args[2], 'executables_complete_managed_launch')");
    expect(rustShell).toContain(
      '("executables.completeManagedLaunch", BridgeLane::Background)'
    );
    expect(bridge).toContain('BODYSLIDE_SESSION_ACTIVE');
    expect(bridge).toContain('payloadCompleteManagedExecutableLaunch');
  });

  it('shows the managed label/output and finalizes in a finally block', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const launchFlow = app.slice(
      app.indexOf('const launchExecutable = async () =>'),
      app.indexOf('const requestGrassCacheGeneration = () =>')
    );

    expect(app).toContain('BodySlide · VFS');
    expect(app).toContain('- BodySlide Output');
    expect(launchFlow).toMatch(
      /finally \{[\s\S]*completeManagedLaunch\([\s\S]*managedSessionId,[\s\S]*managedOutcome/
    );
    expect(launchFlow).toContain("managedOutcome = 'completed'");
    expect(launchFlow).toContain("managedOutcome = managedSessionId ? 'watcher-error' : 'failed'");
  });
});
