import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('managed executable launch contract', () => {
  it('keeps optional DTO fields backward compatible and finalizes on the launch host', () => {
    const shared = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const bridge = readText('backend', 'src', 'BridgeHost', 'FluxoraBridgeHost.cpp');

    expect(shared).toContain("managedToolKind?: 'bodySlide' | 'texGen' | 'dynDoLod'");
    expect(shared).toContain('managedSessionId?: string');
    expect(shared).toContain('outputMod?: FluxoraManagedOutputMod');
    expect(shared).toContain('configurationStatus?:');
    expect(shared).toContain('warnings?: string[]');
    expect(facade).toContain("'executables.completeManagedLaunch'");
    expect(facade).toContain("requestWithOperationId(args[2], 'executables_complete_managed_launch')");
    expect(rustShell).toContain(
      '("executables.completeManagedLaunch", BridgeLane::Main)'
    );
    expect(bridge).toContain('BODYSLIDE_SESSION_ACTIVE');
    expect(bridge).toContain('LOD_GENERATOR_SESSION_ACTIVE');
    expect(bridge).toContain('payloadCompleteManagedExecutableLaunch');
  });

  it('shows the managed label/output and finalizes in a finally block', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const display = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'executables',
      'managed-executable-display.ts'
    );
    const launchFlow = app.slice(
      app.indexOf('const launchExecutable = async () =>'),
      app.indexOf('const requestGrassCacheGeneration = () =>')
    );

    expect(display).toContain('BodySlide · VFS');
    expect(display).toContain('- BodySlide Output');
    expect(display).toContain('TexGen · VFS');
    expect(display).toContain('TexGen Output');
    expect(display).toContain('DynDOLOD · VFS');
    expect(display).toContain('DynDOLOD Output');
    expect(app).toContain('managedExecutableDisplay(');
    expect(launchFlow).toMatch(
      /finally \{[\s\S]*completeManagedLaunch\([\s\S]*managedSessionId,[\s\S]*managedOutcome/
    );
    expect(launchFlow).toContain("managedOutcome = 'completed'");
    expect(launchFlow).toContain("managedOutcome = managedSessionId ? 'watcher-error' : 'failed'");
  });
});
