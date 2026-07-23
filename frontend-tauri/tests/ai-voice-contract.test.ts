import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  FluxoraIpcChannels,
  type FluxoraVoiceTranscriptionRequest
} from '../src/shared/fluxora-api';
import { createFluxoraApi, createTauriFluxoraApi } from '../src/tauri/fluxora-api';

const tauriInvoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (value: string) => value,
  invoke: tauriInvoke
}));

describe('AI voice facade contract', () => {
  it('forwards PCM as the original Uint8Array and keeps metadata separate', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const api = createFluxoraApi({
      invoke: async (channel: string, ...args: unknown[]) => {
        calls.push({ channel, args });
        return {
          backend: 'vulkan',
          detectedLanguage: 'ru',
          transcript: 'Fluxora',
          modelVersion: 'small-q5_1',
          glossaryVersion: '1',
          durationMs: 250,
          processingTimeMs: 10,
          noSpeech: false,
          operationId: 'voice-operation'
        };
      }
    } as never);
    const pcm = new Uint8Array(new Float32Array([0.1, -0.2]).buffer);
    const metadata: FluxoraVoiceTranscriptionRequest = {
      channelCount: 1,
      completionMode: 'send',
      durationMs: 250,
      language: 'auto',
      operationId: 'voice-operation',
      sampleRateHz: 16_000
    };

    await api.ai.transcribeVoice(pcm, metadata);

    expect(calls).toEqual([{
      channel: FluxoraIpcChannels.aiTranscribeVoice,
      args: [pcm, metadata]
    }]);
    expect(calls[0].args[0]).toBe(pcm);
  });

  it('exposes preparation, native permission, cancellation and privacy actions', async () => {
    const channels: string[] = [];
    const api = createFluxoraApi({
      invoke: async (channel: string) => {
        channels.push(channel);
        return {};
      }
    } as never);

    await api.ai.prepareVoice({ operationId: 'prepare-1' });
    await api.ai.armMicrophoneCapture({ operationId: 'arm-1' });
    await api.ai.resetMicrophonePermission({ operationId: 'reset-1' });
    await api.ai.cancelVoiceTranscription('voice-1');
    await api.ai.openMicrophonePrivacySettings();

    expect(channels).toEqual([
      FluxoraIpcChannels.aiPrepareVoice,
      FluxoraIpcChannels.aiArmMicrophoneCapture,
      FluxoraIpcChannels.aiResetMicrophonePermission,
      FluxoraIpcChannels.aiCancelVoiceTranscription,
      FluxoraIpcChannels.aiOpenMicrophonePrivacySettings
    ]);
  });

  it('sends the complete final JSON and raw body to Tauri invoke', async () => {
    tauriInvoke.mockResolvedValue({});
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} }
    });
    try {
      const api = createTauriFluxoraApi();
      const pcm = new Uint8Array(new Float32Array([0.1, -0.2]).buffer);
      const metadata: FluxoraVoiceTranscriptionRequest = {
        channelCount: 1,
        completionMode: 'draft',
        contextHints: ['No Grass In Objects', 'Use-grass-cache'],
        durationMs: 250,
        language: 'auto',
        operationId: 'transcribe-1',
        sampleRateHz: 16_000
      };

      await api.ai.prepareVoice({ operationId: 'prepare-1' });
      await api.ai.armMicrophoneCapture({ operationId: 'arm-1' });
      await api.ai.transcribeVoice(pcm, metadata);
      await api.ai.resetMicrophonePermission({ operationId: 'reset-1' });

      expect(tauriInvoke.mock.calls).toEqual([
        ['fluxora_ai_prepare_voice', { request: { operationId: 'prepare-1' } }],
        ['fluxora_ai_arm_microphone_capture', { request: { operationId: 'arm-1' } }],
        [
          'fluxora_ai_transcribe_voice',
          pcm,
          {
            headers: {
              'x-fluxora-channel-count': '1',
              'x-fluxora-completion-mode': 'draft',
              'x-fluxora-context-hints': '%5B%22No%20Grass%20In%20Objects%22%2C%22Use-grass-cache%22%5D',
              'x-fluxora-duration-ms': '250',
              'x-fluxora-language': 'auto',
              'x-fluxora-operation-id': 'transcribe-1',
              'x-fluxora-sample-rate-hz': '16000'
            }
          }
        ],
        ['fluxora_ai_reset_microphone_permission', { request: { operationId: 'reset-1' } }]
      ]);
    } finally {
      Reflect.deleteProperty(globalThis, 'window');
      tauriInvoke.mockReset();
    }
  });

  it('allows the Tauri custom IPC origin so voice PCM stays raw', () => {
    const tauriConfig = JSON.parse(readFileSync(
      new URL('../src-tauri/tauri.conf.json', import.meta.url),
      'utf8'
    )) as {
      app: {
        security: {
          csp: string;
          devCsp: string;
        };
      };
    };

    for (const csp of [tauriConfig.app.security.csp, tauriConfig.app.security.devCsp]) {
      const connectSource = csp
        .split(';')
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith('connect-src '));

      expect(connectSource).toContain('ipc:');
      expect(connectSource).toContain('http://ipc.localhost');
    }
  });

  it('pins offline installer assets and never defines a runtime model download', () => {
    const manifest = JSON.parse(readFileSync(
      new URL('../speech/manifest.v1.json', import.meta.url),
      'utf8'
    ));
    const stageScript = readFileSync(
      new URL('../scripts/stage-speech-resources.ps1', import.meta.url),
      'utf8'
    );
    const tauriConfig = readFileSync(
      new URL('../src-tauri/tauri.conf.json', import.meta.url),
      'utf8'
    );

    expect(manifest.model).toMatchObject({
      version: 'small-q5_1',
      fileName: 'ggml-small-q5_1.bin',
      revision: '98aa99a0a9db05ae2342309f5096248665f7cba3',
      sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
      sizeBytes: 190_085_487
    });
    expect(manifest.vad).toMatchObject({
      revision: '9ffd54a1e1ee413ddf265af9913beaf518d1639b',
      sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987'
    });
    expect(stageScript).toContain('build\\model-cache\\speech');
    expect(stageScript).toContain('System.Security.Cryptography.SHA256');
    expect(tauriConfig).toContain('resources/speech/');
  });

  it('bootstraps the pinned LunarG SDK as a hash-checked copy-only build tool', () => {
    const bootstrap = readFileSync(
      new URL('../scripts/ensure-vulkan-sdk.ps1', import.meta.url),
      'utf8'
    );

    expect(bootstrap).toContain("$sdkVersion = '1.4.341.1'");
    expect(bootstrap).toContain('bcf2d75aa9556889ab974858666e20b3655b6055a0db704ccb47279ff33b5bfe');
    expect(bootstrap).toContain("'build\\tool-cache'");
    expect(bootstrap).toContain("'vulkan-sdk'");
    expect(bootstrap).toContain("'copy_only=1'");
    expect(bootstrap).toContain('$env:VULKAN_SDK = $sdkRoot');
  });

  it('starts the local speech host without creating a Windows console window', () => {
    const speechShell = readFileSync(
      new URL('../src-tauri/src/speech.rs', import.meta.url),
      'utf8'
    );

    expect(speechShell).toContain('command.creation_flags(crate::CREATE_NO_WINDOW);');
  });

  it('uses Whisper auto-language without detect-only mode or translation', () => {
    const speechHost = readFileSync(
      new URL('../src-tauri/src/bin/fluxora_speech_host.rs', import.meta.url),
      'utf8'
    );

    expect(speechHost).toContain('const WHISPER_TRANSLATE: bool = false;');
    expect(speechHost).toContain('params.set_language(language);');
    expect(speechHost).toContain('params.set_translate(WHISPER_TRANSLATE);');
    expect(speechHost).not.toContain('set_detect_language');
    expect(speechHost).toContain('state.full_lang_id_from_state()');
  });

  it('shares one absolute deadline across Vulkan fallback and CPU restart', () => {
    const speechShell = readFileSync(
      new URL('../src-tauri/src/speech.rs', import.meta.url),
      'utf8'
    );

    expect(speechShell).toContain('let absolute_deadline = Instant::now() + deadline;');
    expect(speechShell.match(/absolute_deadline,/g)?.length).toBeGreaterThanOrEqual(2);
    expect(speechShell).toContain(
      'backend == VoiceBackend::Vulkan && !cancelled && failure_is_fallback_eligible'
    );
  });

  it('builds and package-checks separate Vulkan and CPU speech hosts', () => {
    const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
    const stageNative = readFileSync(
      new URL('../scripts/stage-native-resources.ps1', import.meta.url),
      'utf8'
    );
    const rootBuild = readFileSync(new URL('../../Build.ps1', import.meta.url), 'utf8');

    expect(cargo).toContain('speech-vulkan = ["whisper-rs/vulkan"]');
    expect(cargo).not.toContain('speech-cpu');
    expect(cargo).toContain('name = "fluxora_speech_host_vulkan"');
    expect(stageNative).toContain('ensure-vulkan-sdk.ps1');
    expect(stageNative).toContain('FluxoraSpeechHostVulkan.exe');
    expect(stageNative).toContain('build\\vk');
    expect(stageNative).toContain('build\\cpu');
    expect(stageNative).toContain("CMAKE_CXX_FLAGS_RELEASE = '/O2 /Ob2 /DNDEBUG /utf-8'");
    expect(stageNative).toContain("--features speech-vulkan --bin fluxora_speech_host_vulkan");
    expect(rootBuild).toContain('FluxoraSpeechHost.exe');
    expect(rootBuild).toContain('FluxoraSpeechHostVulkan.exe');
    expect(rootBuild).toContain('package is missing bundled Vulkan speech host');
  });
});
