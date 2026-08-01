import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  createModdingFlowActivationCoordinator,
  createModdingFlowActivationStore
} from '../src/renderer/services/moddingflow-activation-coordinator';
import { FluxoraIpcChannels } from '../src/shared/fluxora-api';
import { createFluxoraApi, type IpcInvoker } from '../src/tauri/fluxora-api';

const ARTIFACT_ID = '01234567-89ab-4cde-8fab-0123456789ab';
const OTHER_ARTIFACT_ID = '11111111-2222-4333-8444-555555555555';

describe('ModdingFlow activation routing', () => {
  it('subscribes before consuming cold-start items and deduplicates consume/event overlap', async () => {
    const calls: string[] = [];
    let eventCallback: (activation: { v: 1; artifactId: string }) => void = () => {
      throw new Error('activation listener was not registered');
    };
    let resolvePending!: (value: Array<{ v: 1; artifactId: string }>) => void;
    const pending = new Promise<Array<{ v: 1; artifactId: string }>>((resolve) => {
      resolvePending = resolve;
    });
    const unsubscribe = vi.fn();
    const coordinator = createModdingFlowActivationCoordinator({
      onCaptured: (callback) => {
        calls.push('subscribe');
        eventCallback = callback;
        return unsubscribe;
      },
      consumePending: () => {
        calls.push('consume');
        return pending;
      }
    });

    const stop = coordinator.start();
    expect(calls).toEqual(['subscribe', 'consume']);
    eventCallback({ v: 1, artifactId: ARTIFACT_ID });
    resolvePending([
      { v: 1, artifactId: ARTIFACT_ID },
      { v: 1, artifactId: OTHER_ARTIFACT_ID }
    ]);
    await pending;
    await Promise.resolve();

    expect(coordinator.snapshot()).toEqual([
      { v: 1, artifactId: ARTIFACT_ID },
      { v: 1, artifactId: OTHER_ARTIFACT_ID }
    ]);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('allowlists consume and event DTOs to version plus canonical artifact UUID only', async () => {
    let nativeListener: (...args: unknown[]) => void = () => {
      throw new Error('native listener was not registered');
    };
    const ipc: IpcInvoker = {
      invoke: vi.fn().mockResolvedValue([{
        v: 1,
        artifactId: ARTIFACT_ID,
        activationId: 'private-id',
        timestamp: 123,
        signedUrl: 'https://example.invalid/private',
        token: 'private-token'
      }]),
      on: (_channel, listener) => {
        nativeListener = listener;
      },
      removeListener: vi.fn()
    };
    const api = createFluxoraApi(ipc);

    await expect(api.moddingFlowActivations.consumePending()).resolves.toEqual([
      { v: 1, artifactId: ARTIFACT_ID }
    ]);
    expect(ipc.invoke).toHaveBeenCalledWith(
      FluxoraIpcChannels.moddingFlowActivationConsumePending
    );

    const captured = vi.fn();
    api.moddingFlowActivations.onCaptured(captured);
    nativeListener(undefined, {
      v: 1,
      artifactId: OTHER_ARTIFACT_ID,
      callbackQuery: 'code=private',
      accessToken: 'private-token'
    });
    nativeListener(undefined, {
      v: 2,
      artifactId: OTHER_ARTIFACT_ID
    });
    for (const artifactId of [
      '00000000-0000-0000-0000-000000000000',
      '01234567-89ab-0cde-8fab-0123456789ab',
      '01234567-89ab-4cde-7fab-0123456789ab'
    ]) {
      nativeListener(undefined, { v: 1, artifactId });
    }
    expect(captured).toHaveBeenCalledOnce();
    expect(captured).toHaveBeenCalledWith({
      v: 1,
      artifactId: OTHER_ARTIFACT_ID
    });
  });

  it('retains a flag-on activation when the subscribing effect restarts mid-consume', async () => {
    let resolveFirstConsume!: (value: Array<{ v: 1; artifactId: string }>) => void;
    const firstConsume = new Promise<Array<{ v: 1; artifactId: string }>>((resolve) => {
      resolveFirstConsume = resolve;
    });
    let consumeCalls = 0;
    const api = {
      consumePending: () => {
        consumeCalls += 1;
        return consumeCalls === 1 ? firstConsume : Promise.resolve([]);
      },
      onCaptured: () => () => undefined
    };
    const store = createModdingFlowActivationStore();
    const observed: Array<Array<{ v: 1; artifactId: string }>> = [];
    const unsubscribeStore = store.subscribe((pending) => observed.push(pending));

    const stopFirstEffect = createModdingFlowActivationCoordinator(api, store).start();
    stopFirstEffect();
    const stopSecondEffect = createModdingFlowActivationCoordinator(api, store).start();
    resolveFirstConsume([{ v: 1, artifactId: ARTIFACT_ID }]);
    await firstConsume;
    await Promise.resolve();

    expect(store.snapshot()).toEqual([{ v: 1, artifactId: ARTIFACT_ID }]);
    expect(observed.at(-1)).toEqual([{ v: 1, artifactId: ARTIFACT_ID }]);
    stopSecondEffect();
    unsubscribeStore();
  });

  it('wires canonical and legacy schemes through one enabled lifecycle inbox', () => {
    const libSource = readFileSync(
      new URL('../src-tauri/src/lib.rs', import.meta.url),
      'utf8'
    );
    const runtimeSource = readFileSync(
      new URL('../src-tauri/src/moddingflow_activation_runtime.rs', import.meta.url),
      'utf8'
    );
    const cargoSource = readFileSync(
      new URL('../src-tauri/Cargo.toml', import.meta.url),
      'utf8'
    );
    const configSource = readFileSync(
      new URL('../src-tauri/tauri.conf.json', import.meta.url),
      'utf8'
    );
    const appSource = readFileSync(
      new URL('../src/renderer/App.tsx', import.meta.url),
      'utf8'
    );
    const hostSource = readFileSync(
      new URL(
        '../src/renderer/features/moddingflow/ModdingFlowActivationConfirmationHost.tsx',
        import.meta.url
      ),
      'utf8'
    );

    expect(runtimeSource).toContain(
      'MODDINGFLOW_ACTIVATION_FEATURE_ENABLED: bool = true'
    );
    expect(libSource).toContain('FluxoraActivationSource::SecondInstance');
    expect(libSource).toContain('FluxoraActivationSource::DeepLink');
    expect(libSource).toContain('FluxoraActivationSource::Startup');
    expect(libSource).toContain('handle_runtime_activation_args(');
    expect(libSource).toContain('app.deep_link().on_open_url');
    expect(libSource).toContain('app.deep_link().get_current()');
    expect(libSource).toContain('handle_nxm_activation_args(app.clone(), args.clone(), source_name);');
    expect(libSource).toContain(
      'if report.queued + report.duplicates + report.delivered == 0'
    );
    expect(libSource).toMatch(
      /if report\.queued \+ report\.duplicates \+ report\.delivered == 0[\s\S]{0,240}show_background_activation_window\(&window\)/
    );
    expect(runtimeSource).not.toContain('nxm.captureLinks');
    expect(runtimeSource).not.toMatch(/downloadService|startTransfer|signedUrl/i);
    expect(cargoSource).toContain('tauri-plugin-deep-link = "2"');
    expect(cargoSource).toMatch(
      /tauri-plugin-single-instance\s*=\s*\{[^}]*features\s*=\s*\["deep-link"\][^}]*\}/
    );
    expect(JSON.parse(configSource)).toMatchObject({
      plugins: {
        'deep-link': {
          desktop: {
            schemes: ['moddingflow', 'fluxora']
          }
        }
      }
    });
    expect(libSource).toContain('tauri_plugin_deep_link::init()');
    expect(libSource.indexOf('tauri_plugin_single_instance::init')).toBeLessThan(
      libSource.indexOf('tauri_plugin_deep_link::init()')
    );
    expect(libSource).not.toMatch(/register_all|register\(\s*["']fluxora/i);
    expect(appSource).toContain('ModdingFlowActivationConfirmationHost');
    expect(appSource).not.toContain('moddingFlowActivationStore');
    expect(appSource).not.toContain('createModdingFlowActivationCoordinator');
    expect(hostSource).toContain('moddingFlowActivationStore');
    expect(hostSource).toContain('createModdingFlowActivationCoordinator');
    expect(hostSource).toContain("activationCapabilityState !== 'available'");
  });
});
