import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('ModdingFlow release version wiring', () => {
  it('uses the Tauri package version across renderer, native core, and installer builds', () => {
    const tauriConfig = JSON.parse(read('../src-tauri/tauri.conf.json')) as { version: string };
    const setupConfig = JSON.parse(read('../src-tauri/setup/tauri.conf.json')) as { version: string };
    const updaterConfig = JSON.parse(read('../src-tauri/updater/tauri.conf.json')) as { version: string };
    const packageJson = JSON.parse(read('../package.json')) as { version: string };
    const cargoSource = read('../src-tauri/Cargo.toml');
    const cargoVersion = cargoSource.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    const buildSource = read('../../Build.ps1');
    const backendCmake = read('../../backend/CMakeLists.txt');
    const bridgeSource = read('../../backend/src/BridgeHost/FluxoraBridgeHost.cpp');
    const transportSource = read('../../backend/src/Services/ModdingFlowHttpTransport.cpp');
    const shellSource = read('../src-tauri/src/lib.rs');
    const settingsSource = read('../src/renderer/features/settings/SettingsWorkspace.tsx');

    expect(tauriConfig.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.version).toBe(tauriConfig.version);
    expect(cargoVersion).toBe(tauriConfig.version);
    expect(setupConfig.version).toBe('../../package.json');
    expect(updaterConfig.version).toBe('../../package.json');
    expect(buildSource).toContain('$FluxoraProductVersion');
    expect(buildSource).toContain("[Alias('ProductionVersion')]");
    expect(buildSource).toContain('Set-FluxoraProductVersion -ProjectRoot $ProjectRoot -Version $Version');
    expect(buildSource).toContain('-DFLUXORA_PRODUCT_VERSION=$FluxoraProductVersion');
    expect(buildSource).not.toMatch(/\bdotnet\b/iu);
    expect(buildSource).not.toContain('-p:Version=');
    expect(backendCmake).toContain('FLUXORA_PRODUCT_VERSION');
    expect(bridgeSource).toContain('FLUXORA_PRODUCT_VERSION');
    expect(shellSource).toContain('env!("CARGO_PKG_VERSION")');
    expect(settingsSource).toContain('<dt>Версия Fluxora</dt>');
    expect(settingsSource).toContain("appInfo?.version ?? 'pending'");
    expect(transportSource).not.toContain('Fluxora/1.0 ModdingFlow');
  });

  it('compiles the ModdingFlow account provider into the standard Windows product build', () => {
    const buildSource = read('../../Build.ps1');

    expect(buildSource).toContain('-DFLUXORA_ENABLE_MODDINGFLOW_AUTH_PROVIDER=ON');
  });
});
