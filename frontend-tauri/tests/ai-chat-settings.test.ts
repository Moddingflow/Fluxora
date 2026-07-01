import { describe, expect, it } from 'vitest';

import {
  aiProviderDiagnostic,
  normalizeAiChatSettings
} from '../src/renderer/features/ai/ai-chat-settings';
import type { FluxoraAiHostStatus } from '../src/shared/fluxora-api';

const aiStatus = (geminiConnected: boolean): FluxoraAiHostStatus => ({
  ready: true,
  operationId: 'op_ai_status',
  health: 'ready',
  providers: [
    {
      id: 'gemini',
      displayName: 'Google Gemini',
      kind: 'byok',
      requiresCredential: true,
      credentialStore: 'os',
      credentialState: geminiConnected ? 'connected' : 'disconnected',
      connected: geminiConnected,
      defaultModelId: 'gemini-3.1-flash-lite',
      supportedRunModes: ['economy', 'planner', 'web', 'byok'],
      networkAdapters: 'available',
      dataDisclosure: 'Chat prompts are sent to this BYOK provider only after a credential is connected.'
    },
    {
      id: 'local-dry-run',
      displayName: 'Local dry run',
      kind: 'local',
      requiresCredential: false,
      credentialStore: 'none',
      credentialState: 'notRequired',
      connected: true,
      defaultModelId: 'local-dry-run',
      supportedRunModes: ['offline', 'free-demo'],
      networkAdapters: 'disabled',
      dataDisclosure: 'Local dry-run provider does not call external services.'
    }
  ],
  models: [
    {
      id: 'gemini-3.1-flash-lite',
      providerId: 'gemini',
      displayName: 'Gemini 3.1 Flash-Lite',
      contextWindowTokens: 1_000_000,
      supportsTools: false,
      supportsWeb: true,
      supportsStreaming: true,
      supportsBackground: false,
      priceMetadata: {
        currency: 'USD',
        inputPerMillionTokens: 0.25,
        outputPerMillionTokens: 1.5,
        cacheReadPerMillionTokens: 0.025,
        cacheWritePerMillionTokens: 0.25,
        source: 'test',
        isEstimated: true,
        remoteConfigurable: true
      }
    },
    {
      id: 'gemini-2.5-flash-lite',
      providerId: 'gemini',
      displayName: 'Gemini 2.5 Flash-Lite (web/orchestration)',
      contextWindowTokens: 1_000_000,
      supportsTools: false,
      supportsWeb: true,
      supportsStreaming: true,
      supportsBackground: false,
      priceMetadata: {
        currency: 'USD',
        inputPerMillionTokens: 0.1,
        outputPerMillionTokens: 0.4,
        cacheReadPerMillionTokens: 0.01,
        cacheWritePerMillionTokens: 0.1,
        source: 'test',
        isEstimated: true,
        remoteConfigurable: true
      }
    },
    {
      id: 'local-dry-run',
      providerId: 'local-dry-run',
      displayName: 'Local dry run',
      contextWindowTokens: 8192,
      supportsTools: false,
      supportsWeb: false,
      supportsStreaming: false,
      supportsBackground: false,
      priceMetadata: {
        currency: 'USD',
        inputPerMillionTokens: 0,
        outputPerMillionTokens: 0,
        cacheReadPerMillionTokens: 0,
        cacheWritePerMillionTokens: 0,
        source: 'test',
        isEstimated: true,
        remoteConfigurable: true
      }
    }
  ],
  capabilities: {}
});

describe('AI chat settings', () => {
  it('promotes the connected BYOK model over the saved local dry-run fallback', () => {
    expect(
      normalizeAiChatSettings(
        {
          modelId: 'local-dry-run',
          routingPreset: 'free-demo'
        },
        aiStatus(true)
      )
    ).toMatchObject({
      modelId: 'gemini-3.1-flash-lite',
      routingPreset: 'byok'
    });
  });

  it('keeps the local dry-run fallback when no remote provider is connected', () => {
    expect(
      normalizeAiChatSettings(
        {
          modelId: 'gemini-3.1-flash-lite',
          routingPreset: 'byok'
        },
        aiStatus(false)
      )
    ).toMatchObject({
      modelId: 'local-dry-run',
      routingPreset: 'free-demo'
    });
  });

  it('explains why the selected local dry run only returns a template', () => {
    const diagnostic = aiProviderDiagnostic(
      {
        modelId: 'local-dry-run',
        routingPreset: 'free-demo'
      },
      aiStatus(false)
    );

    expect(diagnostic).toMatchObject({
      level: 'warning',
      title: 'Local dry run selected'
    });
    expect(diagnostic?.message).toContain('Google Gemini');
    expect(diagnostic?.message).toContain('real replies');
  });

  it('surfaces AI host startup errors as configuration diagnostics', () => {
    const diagnostic = aiProviderDiagnostic(
      {
        modelId: 'local-dry-run',
        routingPreset: 'free-demo'
      },
      {
        ...aiStatus(false),
        ready: false,
        health: 'unavailable',
        providers: [],
        models: [],
        error: {
          code: 'ai.host.unavailable',
          message: 'FluxoraAIHost was not found.',
          category: 'transport',
          retryable: true,
          capabilityId: null,
          details: {
            reason: 'Build the Tauri ai host target or set FLUXORA_AI_HOST_PATH.'
          }
        }
      }
    );

    expect(diagnostic).toMatchObject({
      detail: 'Build the Tauri ai host target or set FLUXORA_AI_HOST_PATH.',
      level: 'error',
      message: 'FluxoraAIHost was not found.',
      title: 'AI host unavailable'
    });
  });
});
