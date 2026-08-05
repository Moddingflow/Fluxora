import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';

const distRoot = path.resolve(__dirname, '..', 'dist');
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const requestPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const targetPath = path.resolve(distRoot, `.${decodeURIComponent(requestPath)}`);
    if (!targetPath.startsWith(distRoot) || !existsSync(targetPath) || statSync(targetPath).isDirectory()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(targetPath)] ?? 'application/octet-stream'
    });
    createReadStream(targetPath).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const installMockProductRuntime = async (page: Page) => {
  await page.addInitScript(() => {
    type StubWindow = Window & {
      __fluxoraAiHostCalls?: string[];
      __resolveFluxoraAiChatRespond?: () => void;
      __resolveFluxoraVoicePrepare?: () => void;
      __emitFluxoraVoiceSamples?: (sampleCount?: number) => void;
      __fluxoraVoiceCaptureStarts?: number;
      __fluxoraVoiceLifecycle?: string[];
      __fluxoraVoiceTrackStops?: number;
      __fluxoraVoiceOperationIds?: string[];
      __fluxoraVoiceContextHints?: unknown;
      __fluxoraChatOperationIds?: string[];
    };
    const stubWindow = window as StubWindow;
    let installedApi: Record<string, any> | undefined;

    class FakeVoiceAudioNode {
      connect() { return this; }
      disconnect() { /* test fixture */ }
    }
    class FakeVoiceWorkletNode extends FakeVoiceAudioNode {
      port = {
        close: () => undefined,
        onmessage: null as ((event: MessageEvent<Float32Array>) => void) | null
      };
      constructor() {
        super();
        stubWindow.__emitFluxoraVoiceSamples = (sampleCount = 4_000) => {
          const samples = new Float32Array(sampleCount);
          samples.fill(0.25);
          this.port.onmessage?.({ data: samples } as MessageEvent<Float32Array>);
        };
      }
    }
    class FakeVoiceAudioContext {
      audioWorklet = { addModule: async () => undefined };
      destination = {};
      sampleRate = 16_000;
      close = async () => undefined;
      createGain = () => Object.assign(new FakeVoiceAudioNode(), { gain: { value: 1 } });
      createMediaStreamSource = () => new FakeVoiceAudioNode();
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          stubWindow.__fluxoraVoiceCaptureStarts = (stubWindow.__fluxoraVoiceCaptureStarts ?? 0) + 1;
          (stubWindow.__fluxoraVoiceLifecycle ??= []).push('capture');
          if (window.localStorage.getItem('fluxora.e2e.voice-denied') === 'yes') {
            throw new DOMException('Microphone permission denied', 'NotAllowedError');
          }
          return {
            getTracks: () => [{
              stop: () => {
                stubWindow.__fluxoraVoiceTrackStops = (stubWindow.__fluxoraVoiceTrackStops ?? 0) + 1;
              }
            }]
          };
        }
      }
    });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeVoiceAudioContext });
    Object.defineProperty(window, 'AudioWorkletNode', { configurable: true, value: FakeVoiceWorkletNode });

    const patchApi = (api: Record<string, any>) => {
      const calls: string[] = [];
      const listeners = new Set<(event: Record<string, unknown>) => void>();
      const rollbackStorageKey = 'fluxora.e2e.rollback-states';
      const readRollbackStates = () => JSON.parse(
        window.localStorage.getItem(rollbackStorageKey) || '[]'
      ) as Array<{ chatId: string; runId: string; state: string; reason?: string }>;
      const writeRollbackStates = (
        states: Array<{ chatId: string; runId: string; state: string; reason?: string }>
      ) => window.localStorage.setItem(rollbackStorageKey, JSON.stringify(states));
      const project = {
        id: 'e2e-ai-build',
        name: 'E2E AI Build',
        templateId: 'skyrimse',
        configPath: 'D:\\Fluxora\\Configs\\e2e-ai-build.json',
        projectDirectory: 'D:\\Fluxora\\Builds\\E2E AI Build',
        gamePath: 'D:\\Games\\Skyrim Special Edition',
        installRootDirectory: 'D:\\Fluxora\\Builds',
        defaultProfileName: 'Default',
        paths: {
          gameDirectory: 'D:\\Fluxora\\Builds\\E2E AI Build\\stock game',
          modsDirectory: 'D:\\Fluxora\\Builds\\E2E AI Build\\mods',
          downloadsDirectory: 'D:\\Fluxora\\Builds\\E2E AI Build\\downloads',
          profilesDirectory: 'D:\\Fluxora\\Builds\\E2E AI Build\\profiles',
          overwriteDirectory: 'D:\\Fluxora\\Builds\\E2E AI Build\\overwrite'
        }
      };
      const operationIdOf = (request: unknown, fallback: string) =>
        request && typeof request === 'object' && typeof (request as any).operationId === 'string'
          ? (request as any).operationId
          : fallback;
      const contextUsage = (request: Record<string, unknown>) => ({
        schema: 'fluxora.ai.context-usage.v1',
        operationId: operationIdOf(request, 'ai_context_estimate'),
        providerId: 'gemini',
        modelId: 'gemini-3.1-flash-lite',
        contextWindowTokens: 1_048_576,
        modelOutputTokenLimit: 65_536,
        currentContextTokens: 12_345,
        currentContextPercent: 1.18,
        precision: 'exact',
        level: 'normal',
        mode: 'full',
        includedSections: ['system', 'safety', 'skill', 'history', 'tools'],
        autoCompressionApplied: false,
        actionRequired: false,
        countedAt: new Date().toISOString()
      });
      const chatResponse = (request: Record<string, unknown>) => {
        const messages = Array.isArray(request.messages) ? request.messages : [];
        const prompt = String((messages.at(-1) as any)?.text ?? '');
        const operationId = operationIdOf(request, 'ai_chat_run');
        const isFileAction = prompt.includes('[file-change]') ||
          prompt === 'Можешь в Community Shaders сделать так, чтобы Menu.ToggleKey был PageDown?';
        const isBlockedAction = prompt.includes('[blocked-action]');
        const isNeedsInput = prompt.includes('[needs-input]');
        const fileChangeSet = isFileAction ? {
          schema: 'fluxora.ai.file-change-set.v1',
          operationId,
          runId: String(request.runId ?? 'run-e2e-file'),
          chatId: String((request.fileWorkspace as any)?.chatId ?? 'chat-e2e-file'),
          rollbackState: 'available',
          files: [{
            fileRef: 'opaque-e2e-file',
            scope: 'build',
            ownerMod: 'Fluxora AI Overrides',
            relativePath: 'Fluxora AI Overrides/SKSE/Plugins/CommunityShaders/SettingsUser.json',
            status: 'applied',
            hunks: [{ oldStart: 7, oldLines: 1, newStart: 7, newLines: 1, lines: ['-35', '+34'] }],
            addedLines: 1,
            removedLines: 1,
            validation: 'validated-in-memory',
            verification: 'json-pointer-matched-after-reread',
            beforeVersion: 'before-e2e',
            afterVersion: 'after-e2e',
            rollbackState: 'available'
          }]
        } : undefined;
        if (fileChangeSet) {
          const states = readRollbackStates().filter((state) => state.runId !== fileChangeSet.runId);
          states.push({ chatId: fileChangeSet.chatId, runId: fileChangeSet.runId, state: 'available' });
          writeRollbackStates(states);
        }
        const text = isNeedsInput
          ? 'Профиль Default уже существует. Создать профиль с именем Default 2?'
          : isBlockedAction
            ? 'Не удалось изменить файл: нативная проверка отклонила stale revision.'
            : 'Готово: Gemini завершил проверенный запуск.';
        const taskKind = isFileAction || isBlockedAction || isNeedsInput ? 'action' : 'answer';
        return {
          operationId,
          providerId: 'gemini',
          modelId: 'gemini-3.1-flash-lite',
          status: isNeedsInput ? 'needs-input' : 'done',
          text,
          streamChunks: [{ index: 0, text }],
          sources: prompt.includes('[source]') || isFileAction ? [{
            id: 'source-1',
            title: 'Gemini grounding source',
            url: 'https://example.com/source',
            publisher: 'Example',
            snippet: 'Grounded result'
          }] : [],
          contextUsage: contextUsage(request),
          toolCallsAllowed: true,
          execution: {
            goalId: operationId,
            kind: taskKind,
            domain: taskKind === 'action' ? 'files' : 'general',
            phase: 'report',
            state: isNeedsInput ? 'needs-input' : isBlockedAction ? 'blocked' : 'completed',
            verifiedEffects: fileChangeSet ? [{
              tool: 'local.files.commit',
              operationId,
              verification: 'native-postcondition'
            }] : [],
            pendingQuestion: isNeedsInput ? text : null,
            terminalReason: isNeedsInput ? 'conflict' : isBlockedAction ? 'stale-revision' : null
          },
          fileChangeSet,
          fileToolDiagnostics: {
            schema: 'fluxora.ai.file-tool-diagnostics.v2',
            taskKind,
            providerRouting: taskKind === 'action' ? 'local-required' : 'local-auto',
            outcome: isBlockedAction || isNeedsInput ? 'blocked' : 'done',
            validationRetries: 0,
            duplicateCalls: 0,
            stagedChanges: fileChangeSet ? 1 : 0,
            verifiedMutations: fileChangeSet ? 1 : 0,
            terminalReason: isNeedsInput ? 'conflict' : isBlockedAction ? 'stale-revision' : null,
            toolCalls: fileChangeSet ? 6 : 0,
            toolRounds: fileChangeSet ? 4 : 0,
            metadataBytes: 0,
            contentBytes: 0,
            searches: fileChangeSet ? 2 : 0,
            emptyResults: 0,
            candidateCount: fileChangeSet ? 1 : 0,
            providerBytes: 0,
            redactionApplied: true,
            mutations: fileChangeSet ? 1 : 0,
            truncatedResponses: 0,
            blockedReason: isNeedsInput ? 'conflict' : isBlockedAction ? 'stale-revision' : null,
            nativeSessionPreopened: true,
            newEvidenceCount: fileChangeSet ? 6 : 0,
            stagnantResultCount: 0,
            phaseTransitions: fileChangeSet
              ? ['discover->inspect', 'inspect->stage', 'stage->verify', 'verify->report']
              : []
          }
        };
      };

      api.bridge.getStatus = async (request?: Record<string, unknown>) => ({
        ready: true,
        operationId: operationIdOf(request, 'bridge_status'),
        health: 'ready',
        language: 'en-us',
        theme: 'dark',
        capabilities: {
          platform: 'win32',
          arch: 'x64',
          core: { available: true, libraryName: 'FluxoraCore.dll' },
          features: {
            projects: { state: 'available' }, mods: { state: 'available' },
            plugins: { state: 'available' }, profiles: { state: 'available' },
            downloads: { state: 'available' }, executables: { state: 'available' }
          }
        },
        logs: { uiLogPath: '', mainBridgeLogPath: '' }
      });
      api.projects.list = async () => ({
        projects: [project],
        buildConfigsDirectory: 'D:\\Fluxora\\Configs',
        defaultInstallRootDirectory: 'D:\\Fluxora\\Builds',
        operationId: 'op_projects_list'
      });
      api.projects.openConfig = async () => project;
      api.profiles.list = async () => ['Default'];
      api.mods.getWorkspace = async () => ({ installedMods: [], modOrder: [] });
      api.mods.getPersistedWorkspace = async () => ({ installedMods: [], modOrder: [] });
      api.mods.getOrder = async () => [];
      api.mods.listInstalled = async () => [];
      api.plugins.list = async () => [];
      api.plugins.listPersisted = async () => [];
      api.downloads.list = async () => [];
      api.executables.list = async () => [];
      api.installs.restore = async () => [];
      api.buildContent.watch = async (_request: unknown, operation?: Record<string, unknown>) => ({
        accepted: true,
        operationId: operationIdOf(operation, 'build_content_watch')
      });
      api.buildContent.stopWatching = async (operation?: Record<string, unknown>) => ({
        accepted: true,
        operationId: operationIdOf(operation, 'build_content_watch_stop')
      });
      api.ai.getStatus = async (request?: Record<string, unknown>) => ({
        ...(window.localStorage.getItem('fluxora.e2e.ai-account-required') === 'yes' ? {
          quota: {
            schema: 'fluxora.ai.quota.v1', availability: 'connectionRequired', available: false,
            eligibility: false, reason: 'ai_oauth_invalid', periodStart: null, resetAt: null,
            rollover: false, limit: 0, used: 0, reserved: 0, remaining: 0,
            remainingInputTokenEquivalent: 0,
            search: { limit: 0, used: 0, reserved: 0, remaining: 0 },
            model: 'gemini-3.1-flash-lite', priceVersion: null
          }
        } : {}),
        ready: window.localStorage.getItem('fluxora.e2e.ai-diagnostic') !== 'yes',
        operationId: operationIdOf(request, 'ai_status'),
        health: window.localStorage.getItem('fluxora.e2e.ai-diagnostic') === 'yes' ? 'unavailable' : 'ready',
        protocolVersion: '1.0',
        hostVersion: 'e2e-single-agent',
        processId: 1,
        providers: [{
          id: 'gemini', displayName: 'Google Gemini', kind: 'hosted', requiresCredential: true,
          credentialStore: 'os-or-supabase', credentialState: 'connected', connected: true,
          defaultModelId: 'gemini-3.1-flash-lite', supportedRunModes: ['sequential'],
          networkAdapters: 'available', dataDisclosure: 'Gemini test fixture'
        }],
        models: [{
          id: 'gemini-3.1-flash-lite', providerId: 'gemini', displayName: 'Gemini 3.1 Flash-Lite',
          contextWindowTokens: 1_048_576, inputTokenLimit: 1_048_576, outputTokenLimit: 65_536,
          limitSource: 'provider-metadata', supportsTools: true, supportsWeb: true,
          supportsStreaming: true, supportsBackground: false
        }],
        ...(window.localStorage.getItem('fluxora.e2e.ai-account-required') !== 'yes' ? { quota: {
          schema: 'fluxora.ai.quota.v1', availability: 'available', available: true,
          eligibility: true, reason: 'available', periodStart: '2030-01-01T00:00:00.000Z',
          resetAt: '2030-02-01T00:00:00.000Z', rollover: false, limit: 1_996_000,
          used: 420_000, reserved: 0, remaining: 1_576_000,
          remainingInputTokenEquivalent: 3_152_000,
          search: { limit: 24, used: 3, reserved: 0, remaining: 21 },
          model: 'gemini-3.1-flash-lite', priceVersion: 'e2e-v3'
        } } : {}),
        capabilities: { singleAgent: { state: 'available' } },
        ...(window.localStorage.getItem('fluxora.e2e.ai-diagnostic') === 'yes' ? {
          error: {
            code: 'ai.gateway.failed', category: 'gateway', stage: 'gateway', retryable: true,
            userMessage: 'The managed Gemini gateway is temporarily unavailable.',
            debugId: 'e2e-diagnostic'
          }
        } : {})
      });
      api.ai.estimateContext = async (request: Record<string, unknown>) => {
        calls.push('ai.estimateContext');
        return contextUsage(request);
      };
      api.ai.onRunEvent = (callback: (event: Record<string, unknown>) => void) => {
        calls.push('ai.onRunEvent');
        listeners.add(callback);
        return () => listeners.delete(callback);
      };
      api.ai.chatRespond = (request: Record<string, unknown>) => {
        calls.push('ai.chatRespond');
        const runId = String(request.runId ?? 'run-e2e');
        const prompt = String(((request.messages as Array<{ text?: string }> | undefined)?.at(-1))?.text ?? '');
        const operationId = operationIdOf(request, 'ai_chat_run');
        (stubWindow.__fluxoraChatOperationIds ??= []).push(operationId);
        const event = (seq: number, type: string, stage: string, message: string, level = 'info') => ({
          schema: 'fluxora.ai.intermediate-event.v1', eventId: `e2e-${runId}-${seq}`,
          runId, operationId, seq, createdAt: new Date().toISOString(), type, level,
          visibility: 'user', stage, message,
          payload: { kind: 'provider', data: { providerId: 'gemini' } }
        });
        listeners.forEach((listener) => listener({
          ...event(1, 'progress', 'gemini', 'Gemini is checking the selected build.')
        }));
        if (prompt.includes('[blocked-action]')) {
          listeners.forEach((listener) => listener(event(2, 'tool-started', 'files', 'Reading the current native revision.')));
          listeners.forEach((listener) => listener(event(3, 'tool-blocked', 'files', 'Native revision is stale.', 'warning')));
          listeners.forEach((listener) => listener(event(4, 'recovery-started', 'files', 'Rereading the current revision.')));
        } else if (prompt.includes('[needs-input]')) {
          listeners.forEach((listener) => listener(event(2, 'tool-started', 'profiles', 'Checking the native profile list.')));
          listeners.forEach((listener) => listener(event(3, 'tool-blocked', 'profiles', 'Profile name conflicts with an existing profile.', 'warning')));
        } else if (prompt.includes('[file-change]') || prompt.includes('Community Shaders')) {
          listeners.forEach((listener) => listener(event(2, 'tool-started', 'files', 'Applying the staged native file change.')));
          listeners.forEach((listener) => listener(event(3, 'verification-completed', 'files', 'Native reread verified the file change.')));
        }
        return new Promise((resolve) => {
          stubWindow.__resolveFluxoraAiChatRespond = () => {
            stubWindow.__resolveFluxoraAiChatRespond = undefined;
            resolve(chatResponse(request));
          };
        });
      };
      api.ai.cancelRun = async (operationId: string) => {
        calls.push('ai.cancelRun');
        return { operationId, status: 'accepted', accepted: true };
      };
      api.ai.prepareVoice = async (request: Record<string, unknown>) => {
        calls.push('ai.prepareVoice');
        (stubWindow.__fluxoraVoiceLifecycle ??= []).push('prepare');
        if (window.localStorage.getItem('fluxora.e2e.voice-prepare-hang') === 'yes') {
          await new Promise<void>((resolve) => {
            stubWindow.__resolveFluxoraVoicePrepare = resolve;
          });
        }
        return {
          operationId: operationIdOf(request, 'ai_voice_prepare'),
          ready: true,
          warmed: true,
          health: 'ready',
          modelVersion: 'small-q5_1',
          glossaryVersion: '1.0.0'
        };
      };
      api.ai.armMicrophoneCapture = async () => {
        calls.push('ai.armMicrophoneCapture');
        (stubWindow.__fluxoraVoiceLifecycle ??= []).push('arm');
      };
      api.ai.resetMicrophonePermission = async () => {
        calls.push('ai.resetMicrophonePermission');
      };
      api.ai.transcribeVoice = async (_pcm: Uint8Array, request: Record<string, unknown>) => {
        calls.push('ai.transcribeVoice');
        stubWindow.__fluxoraVoiceContextHints = request.contextHints;
        const operationId = operationIdOf(request, 'ai_voice_transcribe');
        (stubWindow.__fluxoraVoiceOperationIds ??= []).push(operationId);
        if (window.localStorage.getItem('fluxora.e2e.voice-hang') === 'yes') {
          return new Promise(() => undefined);
        }
        if (window.localStorage.getItem('fluxora.e2e.voice-timeout') === 'yes') {
          throw { code: 'speech.host.timeout', message: 'invalid args: C:\\private\\speech-model.bin', retryable: true };
        }
        if (window.localStorage.getItem('fluxora.e2e.voice-no-speech') === 'yes') {
          return {
            operationId,
            transcript: '',
            noSpeech: true,
            detectedLanguage: null,
            backend: 'cpu'
          };
        }
        return {
          operationId,
          transcript: window.localStorage.getItem('fluxora.e2e.voice-transcript') || 'проверь голосовой ввод',
          noSpeech: false,
          detectedLanguage: 'ru',
          backend: 'vulkan'
        };
      };
      api.ai.cancelVoiceTranscription = async (operationId: string) => {
        calls.push('ai.cancelVoiceTranscription');
        if (window.localStorage.getItem('fluxora.e2e.voice-hang') === 'yes') {
          return new Promise(() => undefined);
        }
        return { operationId, accepted: true };
      };
      api.ai.openMicrophonePrivacySettings = async () => {
        calls.push('ai.openMicrophonePrivacySettings');
      };
      api.ai.rollbackFile = async () => {
        calls.push('ai.rollbackFile');
        return {
          operationId: 'rollback-file', runId: 'legacy-file-run', state: 'rolled-back',
          mode: 'exact', preservedNewerChanges: false,
          files: [{ fileRef: 'opaque-e2e-file', rollbackState: 'rolled-back' }]
        };
      };
      api.ai.rollbackRun = async (chatId: string, runId: string, request?: Record<string, unknown>) => {
        calls.push('ai.rollbackRun');
        const states = readRollbackStates();
        const selectedIndex = states.findIndex((state) => state.chatId === chatId && state.runId === runId);
        if (window.localStorage.getItem('fluxora.e2e.rollback-conflict') === runId) {
          if (selectedIndex >= 0) {
            states[selectedIndex] = {
              ...states[selectedIndex],
              state: 'conflict',
              reason: 'overlapping-edit'
            };
          }
          writeRollbackStates(states);
          return {
            operationId: operationIdOf(request, 'rollback-run'), runId, state: 'conflict',
            reason: 'overlapping-edit', mode: 'inverse-merge', preservedNewerChanges: false,
            files: [{ fileRef: 'opaque-e2e-file', rollbackState: 'conflict' }]
          };
        }
        const preservedNewerChanges = states.slice(selectedIndex + 1).some((state) => state.state === 'available');
        if (selectedIndex >= 0) states[selectedIndex] = { ...states[selectedIndex], state: 'rolled-back' };
        writeRollbackStates(states);
        return {
          operationId: operationIdOf(request, 'rollback-run'), runId, state: 'rolled-back',
          mode: preservedNewerChanges ? 'inverse-merge' : 'exact', preservedNewerChanges,
          files: [{ fileRef: 'opaque-e2e-file', rollbackState: 'rolled-back' }]
        };
      };
      api.ai.getFileRollbackStates = async (chatId: string) => {
        calls.push('ai.getFileRollbackStates');
        return readRollbackStates()
          .filter((state) => state.chatId === chatId)
          .map(({ runId, state, reason }) => ({ runId, state, ...(reason ? { reason } : {}) }));
      };
      api.ai.resetFileRollbackCheckpoints = async () => {
        calls.push('ai.resetFileRollbackCheckpoints');
        window.localStorage.removeItem(rollbackStorageKey);
      };
      api.connections.connect = async (providerId: string, request?: Record<string, unknown>) => {
        calls.push(`connections.connect:${providerId}`);
        window.localStorage.removeItem('fluxora.e2e.ai-account-required');
        return {
          providerId,
          label: 'ModdingFlow',
          state: 'ready',
          accountName: '',
          hasStoredSession: true,
          retryable: false,
          requiresUserAction: false,
          message: 'Connected.',
          checkedAtUtc: new Date().toISOString(),
          operationId: operationIdOf(request, 'connection_connect')
        };
      };
      api.links.openExternal = async (url: string) => {
        calls.push(`links.openExternal:${url}`);
        return { ok: true };
      };
      api.shell.showItemInFolder = async (path: string) => {
        calls.push(`shell.showItemInFolder:${path}`);
        return { ok: true };
      };
      api.windowControls.openAiTextEditor = async () => calls.push('windowControls.openAiTextEditor');
      api.windowControls.openTextEditor = async () => calls.push('windowControls.openTextEditor');
      stubWindow.__fluxoraAiHostCalls = calls;
      return api;
    };

    Object.defineProperty(window, 'fluxora', {
      configurable: true,
      get: () => installedApi,
      set: (api: Record<string, any>) => {
        installedApi = patchApi(api);
        Object.defineProperty(window, 'fluxora', {
          configurable: true,
          enumerable: true,
          writable: false,
          value: installedApi
        });
      }
    });
  });
};

const openSelectedBuildAi = async (page: Page) => {
  await expect(page.getByRole('button', { name: 'Open Fluxora AI', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open E2E AI Build' }).click();
  await expect(page.getByLabel('Selected build', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Fluxora AI', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Fluxora AI' })).toBeVisible();
};

const resolvePendingAiResponse = async (page: Page) => {
  await expect.poll(() => page.evaluate(() => typeof (window as any).__resolveFluxoraAiChatRespond))
    .toBe('function');
  await page.evaluate(() => (window as any).__resolveFluxoraAiChatRespond());
};

const startVoiceAndAllowIfNeeded = async (page: Page) => {
  await page.getByRole('button', { name: 'Start voice input' }).click();
  const dialog = page.getByRole('dialog', { name: 'Allow microphone access' });
  if (await dialog.isVisible()) {
    await dialog.getByRole('button', { name: 'Allow', exact: true }).click();
  }
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('fluxora.e2e.storage-initialized') !== 'yes') {
      window.localStorage.clear();
      window.sessionStorage.setItem('fluxora.e2e.storage-initialized', 'yes');
    }
  });
  await installMockProductRuntime(page);
});

test('requires ModdingFlow OAuth before exposing the managed agent workspace', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('fluxora.e2e.ai-account-required', 'yes');
  });
  await page.goto(baseUrl);
  await openSelectedBuildAi(page);

  await expect(page.getByRole('heading', { name: 'Sign in to ModdingFlow' })).toBeVisible();
  await expect(page.getByLabel('Message Fluxora AI')).toHaveCount(0);

  await page.getByRole('button', { name: 'Create account' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .toContain('links.openExternal:https://moddingflow.com/register/');

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .toContain('connections.connect:moddingflow');
  await expect(page.getByText('Ask about this build')).toBeVisible();
});

test('keeps AI out of Home and runs one persisted Gemini chat inside the selected build', async ({ page }) => {
  await page.goto(baseUrl);
  await openSelectedBuildAi(page);

  const quota = page.getByRole('region', { name: 'Agent usage limits' });
  await expect(quota.getByRole('progressbar', { name: 'Agent limit, 79% remaining' })).toHaveAttribute(
    'aria-valuenow',
    '79'
  );
  await expect(quota).toContainText('Search 21 / 24');

  const messageInput = page.getByLabel('Message Fluxora AI');
  await messageInput.fill('Проверь Community Shaders');
  await expect
    .poll(() =>
      page.locator('.ai-chat-input__surface').evaluate((surface) => {
        const style = getComputedStyle(surface);
        return style.boxShadow.includes(
          `${style.borderTopColor} 0px 0px 0px 3px`
        );
      })
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.ai-chat-input__toolbar .ai-context-usage')).toHaveAttribute(
    'aria-label',
    /12.345.*1.048.576/
  );
  await expect(page.locator('.ai-chat-message[data-role="user"]')).toContainText('Проверь Community Shaders');
  await expect(page.locator('.ai-run-events')).toContainText('Gemini is checking the selected build.');
  await resolvePendingAiResponse(page);
  await expect(page.locator('.ai-chat-message[data-role="assistant"]')).toContainText('Gemini завершил');
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .toEqual(expect.arrayContaining(['ai.onRunEvent', 'ai.estimateContext', 'ai.chatRespond']));

  await page.getByRole('button', { name: 'New AI chat' }).click();
  await expect(page.getByText('Ask about this build')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const sessions = JSON.parse(window.localStorage.getItem('fluxora.ai.single-agent.sessions.v1') || '{}');
    return sessions['build:e2e-ai-build']?.chats?.length ?? 0;
  })).toBe(2);
  await page.reload();
  await openSelectedBuildAi(page);
  await expect(
    page.getByRole('tablist', { name: 'Build AI chats' }).getByRole('tab')
  ).toHaveCount(2);
});

test('renders grounding sources, verified file changes and working Undo actions', async ({ page }) => {
  await page.goto(baseUrl);
  await openSelectedBuildAi(page);
  await page.getByLabel('Message Fluxora AI').fill('Можешь в Community Shaders сделать так, чтобы Menu.ToggleKey был PageDown?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.ai-run-events')).toContainText('Native reread verified the file change.');
  await resolvePendingAiResponse(page);

  const changeSet = page.locator('.ai-file-change-set');
  await expect(changeSet).toHaveCount(1);
  await expect(changeSet).toContainText('Fluxora AI Overrides/SKSE/Plugins/CommunityShaders/SettingsUser.json');
  await expect(changeSet).toContainText('+1');
  await expect(changeSet).toContainText('−1');
  const changedFile = changeSet.getByRole('button', { name: /Fluxora AI Overrides\/SKSE\/Plugins\/CommunityShaders\/SettingsUser.json/ });
  await changedFile.click();
  const diffPreview = page.getByRole('dialog', { name: 'Changes preview: SettingsUser.json' });
  await expect(diffPreview).toBeVisible();
  await expect(diffPreview.locator('[data-diff-kind="removed"]')).toContainText('35');
  await expect(diffPreview.locator('[data-diff-kind="added"]')).toContainText('34');
  await expect(diffPreview.getByRole('textbox')).toHaveCount(0);
  await diffPreview.getByRole('button', { name: 'Close changes preview' }).click();

  await changedFile.click({ button: 'right' });
  const changeMenu = page.getByRole('menu', { name: /Actions for .*SettingsUser.json/ });
  await expect(changeMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(changeMenu).toHaveCount(0);
  await changedFile.click({ button: 'right' });
  await changeMenu.getByRole('menuitem', { name: 'Show in folder' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .toContain('shell.showItemInFolder:D:\\Fluxora\\Builds\\E2E AI Build\\mods\\Fluxora AI Overrides\\SKSE\\Plugins\\CommunityShaders\\SettingsUser.json');

  await changedFile.click();
  await diffPreview.getByRole('button', { name: 'Open full editor' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .toContain('windowControls.openTextEditor');
  await page.getByRole('button', { name: 'Gemini grounding source' }).click();

  await page.getByLabel('Message Fluxora AI').fill('[file-change] verify run Undo');
  await page.getByRole('button', { name: 'Send message' }).click();
  await resolvePendingAiResponse(page);
  await expect(page.locator('.ai-file-change-set')).toHaveCount(2);
  const firstRun = page.locator('.ai-file-change-set').first();
  const secondRun = page.locator('.ai-file-change-set').last();
  await firstRun.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(firstRun.getByRole('button', { name: 'Undone', exact: true })).toBeDisabled();
  await expect(firstRun).toContainText('Newer non-overlapping changes were preserved.');
  await expect(secondRun.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();

  const secondRunId = await secondRun.getAttribute('data-run-id');
  await page.evaluate((runId) => {
    const states = JSON.parse(window.localStorage.getItem('fluxora.e2e.rollback-states') || '[]');
    const second = states.findLast((state: { state: string }) => state.state === 'available');
    window.localStorage.setItem('fluxora.e2e.rollback-conflict', runId || second?.runId || '');
    window.localStorage.setItem('fluxora.e2e.current-file-data', 'newer user data');
  }, secondRunId);
  await secondRun.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(secondRun.getByRole('button', { name: 'Needs review', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('fluxora.e2e.current-file-data')))
    .toBe('newer user data');

  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .toEqual(expect.arrayContaining([
      'links.openExternal:https://example.com/source',
      'ai.rollbackRun'
    ]));
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .not.toContain('windowControls.openAiTextEditor');
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .not.toContain('ai.rollbackFile');

  await page.reload();
  await openSelectedBuildAi(page);
  await expect(page.getByRole('button', { name: 'Undone', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Needs review', exact: true })).toHaveCount(1);
});

test('shows an uncommitted file action as blocked instead of successful advice', async ({ page }) => {
  await page.goto(baseUrl);
  await openSelectedBuildAi(page);
  await page.getByLabel('Message Fluxora AI').fill('[blocked-action] измени файл');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.ai-run-events')).toContainText('Native revision is stale.');
  await expect(page.locator('.ai-run-events')).toContainText('Rereading the current revision.');
  await expect(page.locator('.ai-run-events')).not.toContainText('completed');
  await resolvePendingAiResponse(page);

  const response = page.locator('.ai-chat-message[data-role="assistant"]').last();
  await expect(response).toHaveAttribute('data-status', 'blocked');
  await expect(response).toContainText('stale revision');
  await expect(response).not.toContainText('Готово');
  await expect(page.locator('.ai-file-change-set')).toHaveCount(0);
});

test('asks one exact question for a real native conflict', async ({ page }) => {
  await page.goto(baseUrl);
  await openSelectedBuildAi(page);
  await page.getByLabel('Message Fluxora AI').fill('[needs-input] создай профиль Default');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.ai-run-events')).toContainText('Profile name conflicts');
  await resolvePendingAiResponse(page);

  const response = page.locator('.ai-chat-message[data-role="assistant"]').last();
  await expect(response).toHaveAttribute('data-status', 'needs-input');
  await expect(response).toContainText('Профиль Default уже существует. Создать профиль с именем Default 2?');
  await expect(response).not.toContainText('Готово');
  expect(((await response.textContent()) ?? '').match(/\?/g)).toHaveLength(1);
});

test('removes legacy AI state without touching unrelated settings and supports cancellation', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('fluxora.ai.autonomous.jobs.v1', '{"legacy":true}');
    window.localStorage.setItem('fluxora.settings.keep', 'yes');
  });
  await page.goto(baseUrl);
  await openSelectedBuildAi(page);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('fluxora.ai.autonomous.jobs.v1'))).toBeNull();
  expect(await page.evaluate(() => window.localStorage.getItem('fluxora.settings.keep'))).toBe('yes');

  await page.getByLabel('Message Fluxora AI').fill('Останови этот запуск');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('button', { name: 'Stop AI run' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .toContain('ai.cancelRun');
  await page.getByRole('button', { name: 'Collapse AI chat' }).click();
  await expect(page.getByRole('button', { name: 'Expand AI chat' })).toBeVisible();
});

test('owns microphone consent, persists Allow and restores the prompt after Privacy reset', async ({ page }) => {
  await page.goto(baseUrl);
  await openSelectedBuildAi(page);

  await page.getByRole('button', { name: 'Start voice input' }).click();
  const dialog = page.getByRole('dialog', { name: 'Allow microphone access' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Allow', exact: true })).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .not.toEqual(expect.arrayContaining(['ai.prepareVoice', 'ai.armMicrophoneCapture']));
  expect(await page.evaluate(() => (window as any).__fluxoraVoiceCaptureStarts ?? 0)).toBe(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem('fluxora.settings.aiMicrophoneAllowed'))).toBeNull();

  await page.getByRole('button', { name: 'Start voice input' }).click();
  await page.getByRole('dialog', { name: 'Allow microphone access' })
    .getByRole('button', { name: 'Deny', exact: true })
    .click();
  expect(await page.evaluate(() => window.localStorage.getItem('fluxora.settings.aiMicrophoneAllowed'))).toBeNull();
  expect(await page.evaluate(() => (window as any).__fluxoraVoiceCaptureStarts ?? 0)).toBe(0);

  await page.getByRole('button', { name: 'Start voice input' }).click();
  await page.getByRole('dialog', { name: 'Allow microphone access' })
    .getByRole('button', { name: 'Allow', exact: true })
    .click();
  await expect(page.getByText('Listening locally')).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('fluxora.settings.aiMicrophoneAllowed'))).toBe('true');
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .toEqual(expect.arrayContaining(['ai.prepareVoice', 'ai.armMicrophoneCapture']));
  expect(await page.evaluate(() => (window as any).__fluxoraVoiceCaptureStarts ?? 0)).toBe(1);
  expect(await page.evaluate(() => (window as any).__fluxoraVoiceLifecycle ?? []))
    .toEqual(['prepare', 'arm', 'capture']);

  await page.keyboard.press('Escape');
  await page.reload();
  await openSelectedBuildAi(page);
  await page.getByRole('button', { name: 'Start voice input' }).click();
  await expect(page.getByRole('dialog', { name: 'Allow microphone access' })).toHaveCount(0);
  await expect(page.getByText('Listening locally')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto(`${baseUrl}/?window=settings`);
  await page.getByRole('button').filter({ hasText: 'Privacy' }).click();
  await expect(page.locator('.settings-panel--privacy')).toBeVisible();
  await page.getByRole('button', { name: 'Reset access' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .toContain('ai.resetMicrophonePermission');
  expect(await page.evaluate(() => window.localStorage.getItem('fluxora.settings.aiMicrophoneAllowed'))).toBeNull();

  await page.goto(baseUrl);
  await openSelectedBuildAi(page);
  await page.getByRole('button', { name: 'Start voice input' }).click();
  await expect(page.getByRole('dialog', { name: 'Allow microphone access' })).toBeVisible();
});

test('records locally, paints 32 levels and adds the transcript to the existing draft', async ({ page }) => {
  await page.goto(baseUrl);
  await openSelectedBuildAi(page);
  await page.getByLabel('Message Fluxora AI').fill('Сначала Use-grass-cache');

  await startVoiceAndAllowIfNeeded(page);
  await expect(page.getByText('Listening locally')).toBeVisible();
  await page.evaluate(() => (window as any).__emitFluxoraVoiceSamples?.(4_000));
  await expect(page.locator('.ai-voice-waveform > span')).toHaveCount(32);
  await page.getByRole('button', { name: 'Stop and add voice transcript' }).click();

  await expect(page.getByLabel('Message Fluxora AI')).toHaveValue(
    'Сначала Use-grass-cache проверь голосовой ввод'
  );
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraVoiceContextHints ?? []))
    .toContain('Use-grass-cache');
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraVoiceTrackStops ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .toEqual(expect.arrayContaining(['ai.prepareVoice', 'ai.transcribeVoice']));
});

test('records without waiting for model warmup and shows only cancellable busy UI after Stop', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => window.localStorage.setItem('fluxora.e2e.voice-prepare-hang', 'yes'));
  await page.evaluate(() => window.localStorage.setItem('fluxora.e2e.voice-hang', 'yes'));
  await openSelectedBuildAi(page);

  await startVoiceAndAllowIfNeeded(page);
  await expect(page.getByText('Listening locally')).toBeVisible();
  await page.evaluate(() => (window as any).__emitFluxoraVoiceSamples?.(4_000));
  await page.getByRole('button', { name: 'Stop and add voice transcript' }).click();
  await expect(page.locator('.ai-voice-processing__spinner')).toBeVisible();
  await expect(page.locator('.ai-voice-processing .sr-only')).toHaveText('Transcribing locally');
  await expect(page.getByText('Transcribing locally…')).toHaveCount(0);
  await expect(page.locator('.ai-voice-waveform')).toHaveCount(0);
  await expect(page.locator('.ai-voice-recorder__status strong')).toHaveCount(0);

  const cancel = page.getByRole('button', { name: 'Cancel voice input' });
  await expect(cancel).toBeEnabled();
  await cancel.click();

  await expect(page.getByLabel('Message Fluxora AI')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .toContain('ai.cancelVoiceTranscription');
});

test('sends one Gemini run with the same voice operation id', async ({ page }) => {
  await page.goto(baseUrl);
  await openSelectedBuildAi(page);
  await page.getByLabel('Message Fluxora AI').fill('Контекст');

  await startVoiceAndAllowIfNeeded(page);
  await expect(page.getByText('Listening locally')).toBeVisible();
  await page.evaluate(() => (window as any).__emitFluxoraVoiceSamples?.(4_000));
  await page.getByRole('button', { name: 'Stop, transcribe and send message' }).click();

  await expect(page.locator('.ai-chat-message[data-role="user"]')).toContainText('Контекст проверь голосовой ввод');
  await expect.poll(() => page.evaluate(() => ({
    chat: (window as any).__fluxoraChatOperationIds ?? [],
    voice: (window as any).__fluxoraVoiceOperationIds ?? []
  }))).toEqual(expect.objectContaining({
    chat: expect.arrayContaining([expect.any(String)]),
    voice: expect.arrayContaining([expect.any(String)])
  }));
  const operationIds = await page.evaluate(() => ({
    chat: (window as any).__fluxoraChatOperationIds,
    voice: (window as any).__fluxoraVoiceOperationIds
  }));
  expect(operationIds.chat).toEqual(operationIds.voice);
  expect(operationIds.chat).toHaveLength(1);
  await resolvePendingAiResponse(page);
});

test('reports permission and no-speech errors and always releases the microphone', async ({ page }) => {
  await page.goto(baseUrl);
  await openSelectedBuildAi(page);
  await page.evaluate(() => window.localStorage.setItem('fluxora.e2e.voice-denied', 'yes'));
  await startVoiceAndAllowIfNeeded(page);
  await expect(page.getByRole('alert')).toContainText('Windows blocked microphone access');
  await page.getByRole('button', { name: 'Open Windows settings' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraAiHostCalls ?? []))
    .toContain('ai.openMicrophonePrivacySettings');

  await page.evaluate(() => {
    window.localStorage.removeItem('fluxora.e2e.voice-denied');
    window.localStorage.setItem('fluxora.e2e.voice-no-speech', 'yes');
  });
  await startVoiceAndAllowIfNeeded(page);
  await expect(page.getByText('Listening locally')).toBeVisible();
  await page.evaluate(() => (window as any).__emitFluxoraVoiceSamples?.(4_000));
  await page.getByRole('button', { name: 'Stop and add voice transcript' }).click();
  await expect(page.getByRole('alert')).toContainText('No speech was detected');

  await page.evaluate(() => window.localStorage.removeItem('fluxora.e2e.voice-no-speech'));
  await startVoiceAndAllowIfNeeded(page);
  await expect(page.getByText('Listening locally')).toBeVisible();
  await page.getByRole('button', { name: 'Close AI chat' }).click();
  await expect(page.getByRole('complementary', { name: 'Fluxora AI' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__fluxoraVoiceTrackStops ?? 0)).toBe(2);
});

test('keeps a transcript as draft when Gemini is unavailable and reports speech timeout', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => window.localStorage.setItem('fluxora.e2e.ai-diagnostic', 'yes'));
  await page.reload();
  await openSelectedBuildAi(page);

  await page.getByLabel('Message Fluxora AI').fill('Не теряй');
  await startVoiceAndAllowIfNeeded(page);
  await expect(page.getByText('Listening locally')).toBeVisible();
  await page.evaluate(() => (window as any).__emitFluxoraVoiceSamples?.(4_000));
  await page.getByRole('button', { name: 'Stop, transcribe and send message' }).click();
  await expect(page.getByLabel('Message Fluxora AI')).toHaveValue('Не теряй проверь голосовой ввод');
  expect(await page.evaluate(() => ((window as any).__fluxoraAiHostCalls ?? [])
    .filter((call: string) => call === 'ai.chatRespond').length)).toBe(0);

  await page.evaluate(() => window.localStorage.setItem('fluxora.e2e.voice-timeout', 'yes'));
  await startVoiceAndAllowIfNeeded(page);
  await expect(page.getByText('Listening locally')).toBeVisible();
  await page.evaluate(() => (window as any).__emitFluxoraVoiceSamples?.(4_000));
  await page.getByRole('button', { name: 'Stop and add voice transcript' }).click();
  await expect(page.locator('.ai-voice-error')).toContainText('Local speech recognition timed out');
  await expect(page.locator('.ai-voice-error')).not.toContainText('invalid args');

  await page.evaluate(() => window.localStorage.setItem('fluxora.settings.developerMode', 'true'));
  await page.reload();
  await openSelectedBuildAi(page);
  await startVoiceAndAllowIfNeeded(page);
  await page.evaluate(() => (window as any).__emitFluxoraVoiceSamples?.(4_000));
  await page.getByRole('button', { name: 'Stop and add voice transcript' }).click();
  await page.getByText('Developer details').click();
  await expect(page.locator('.ai-voice-error__debug')).toContainText('invalid args: C:\\private\\speech-model.bin');
});

test('keeps the 616px panel and composer breathing room with and without diagnostics', async ({ page }) => {
  const cases = [
    { diagnostic: false, viewport: { width: 1100, height: 700 } },
    { diagnostic: true, viewport: { width: 1100, height: 700 } },
    { diagnostic: false, viewport: { width: 1440, height: 900 } },
    { diagnostic: true, viewport: { width: 1440, height: 900 } }
  ];

  for (const testCase of cases) {
    await page.setViewportSize(testCase.viewport);
    await page.goto(baseUrl);
    await page.evaluate((diagnostic) => {
      if (diagnostic) {
        window.localStorage.setItem('fluxora.e2e.ai-diagnostic', 'yes');
      } else {
        window.localStorage.removeItem('fluxora.e2e.ai-diagnostic');
      }
    }, testCase.diagnostic);
    await page.reload();
    await openSelectedBuildAi(page);

    await expect(page.locator('.ai-chat-diagnostic')).toHaveCount(testCase.diagnostic ? 1 : 0);
    const panelBox = await page.getByRole('complementary', { name: 'Fluxora AI' }).boundingBox();
    const inputBox = await page.locator('.ai-chat-input__surface').boundingBox();
    expect(panelBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(panelBox?.width).toBe(616);
    expect(
      (panelBox?.y ?? 0) + (panelBox?.height ?? 0) -
      ((inputBox?.y ?? 0) + (inputBox?.height ?? 0))
    ).toBeGreaterThanOrEqual(15);
    expect(
      (panelBox?.y ?? 0) + (panelBox?.height ?? 0) -
      ((inputBox?.y ?? 0) + (inputBox?.height ?? 0))
    ).toBeLessThanOrEqual(17);
  }
});
