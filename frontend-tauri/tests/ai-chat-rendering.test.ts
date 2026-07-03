import { renderToStaticMarkup } from 'react-dom/server';
import React, { type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import {
  AiChatPanel,
  renderAiChatMessageContent
} from '../src/renderer/features/ai/AiChatPanel';
import { AI_CONTEXT_SOURCE_URL_PREFIX } from '../src/renderer/features/ai/ai-chat-security';
import {
  createAiMessage,
  initialAiChatState,
  type AiChatState,
  type AiMessage
} from '../src/renderer/features/ai/ai-chat-state';
import { createFluxoraAiTaskPlanningBundle } from '../src/shared/ai-task-planner';
import type {
  FluxoraAiCaseState,
  FluxoraAiCitation,
  FluxoraAiContextUsage,
  FluxoraAiResearchReport
} from '../src/shared/fluxora-api';

const noop = () => undefined;

const hiddenCostEstimate: NonNullable<AiMessage['costEstimate']> = {
  currency: 'USD',
  actualInternalCost: 0.004,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  displayCost: 0.004,
  estimatedInputTokens: 1600,
  estimatedOutputTokens: 400,
  estimatedCost: 0.004,
  actualCost: null,
  hardCost: 0.004,
  internalCost: 0.004,
  promptCache: {
    key: 'test-cache-key',
    status: 'disabled',
    rawPromptStored: false
  },
  pricingSource: 'test',
  riskBuffer: 0,
  isEstimate: false,
  usageBreakdown: {
    inputTokens: 1600,
    outputTokens: 400,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearchCalls: 0,
    fetchUrlCalls: 0,
    sandboxMinutes: 0,
    providerRiskBuffer: 0
  }
};

const createContextUsage = (
  overrides: Partial<FluxoraAiContextUsage> = {}
): FluxoraAiContextUsage => ({
  schema: 'fluxora.ai.context-usage.v1',
  operationId: 'op_ai_chat_run',
  providerId: 'gemini',
  modelId: 'gemini-3.1-flash-lite',
  contextWindowTokens: 1000,
  currentContextTokens: 120,
  currentContextPercent: 12,
  precision: 'exact',
  level: 'normal',
  mode: 'full',
  includedSections: ['system-instructions', 'chat-history'],
  autoCompressionApplied: false,
  actionRequired: false,
  countedAt: '2026-07-03T10:00:00.000Z',
  ...overrides
});

const stateWithMessages = (
  messages: AiMessage[],
  chatOverrides: Partial<AiChatState['chats'][number]> = {}
): AiChatState => {
  const baseChat = initialAiChatState.chats[0]!;
  const chat = {
    ...baseChat,
    ...chatOverrides,
    messages,
    updatedAt: messages.at(-1)?.createdAt ?? baseChat.updatedAt
  };

  return {
    ...initialAiChatState,
    activeChatId: chat.id,
    chats: [chat],
    isOpen: true,
    messages,
    session: {
      ...initialAiChatState.session,
      activeChatId: chat.id,
      chats: [chat],
      messages,
      updatedAt: chat.updatedAt
    }
  };
};

const renderPanel = (state: AiChatState) =>
  renderToStaticMarkup(
    React.createElement(AiChatPanel, {
      state,
      onCancel: noop,
      onClose: noop,
      onCloseChat: noop,
      onCreateChat: noop,
      onDraftChange: noop,
      onResize: noop,
      onSend: noop,
      onSelectChat: noop,
      onToggleCollapse: noop
    })
  );

const researchGeneratedAt = '2026-07-01T08:00:00.000Z';

const nexusQuota = {
  hourlyRemaining: 42,
  dailyRemaining: 900,
  resetAt: '2026-07-01T09:00:00.000Z',
  source: 'headers' as const
};

const nexusApiAvailable = {
  state: 'available' as const,
  unavailableReason: 'none' as const,
  lastHttpStatus: 200,
  retryAfterSeconds: null
};

const nexusCitation: FluxoraAiCitation = {
  id: 'nexus-api:weather-patch',
  title: 'Weather Patch Nexus files',
  url: 'https://www.nexusmods.com/skyrimspecialedition/mods/42',
  kind: 'nexus-api',
  provider: 'nexus-api'
};

const createResearchReport = (): FluxoraAiResearchReport => ({
  schema: 'fluxora.ai.research.v1',
  generatedAt: researchGeneratedAt,
  operationId: 'op_ai_research',
  permissionClass: 'external-network',
  mode: 'nexus-api-first',
  policy: {},
  targets: [{ modName: 'Weather Patch' }],
  apiAvailability: nexusApiAvailable,
  apiQuotaState: nexusQuota,
  nexusInvestigation: {
    schema: 'fluxora.ai.nexus-investigation.v1',
    generatedAt: researchGeneratedAt,
    operationId: 'op_ai_research',
    targetNexusIds: ['42'],
    api: nexusApiAvailable,
    quota: nexusQuota,
    ordinaryError: null,
    deterministicFindings: [],
    hypotheses: [],
    evidenceCards: [
      {
        schema: 'fluxora.ai.evidence-card.v1',
        generatedAt: researchGeneratedAt,
        operationId: 'op_ai_research',
        sourceId: nexusCitation.id,
        sourceIds: [nexusCitation.id],
        sourceType: 'nexus-api',
        sourceTier: 'nexus-api',
        citations: [
          {
            sourceId: nexusCitation.id,
            url: nexusCitation.url,
            title: nexusCitation.title,
            locator: 'files'
          }
        ],
        claim: 'Weather Patch declares WeatherCore.esm compatibility metadata.',
        relevantMods: ['Weather Patch'],
        affectedVersions: ['1.2.0'],
        evidenceStrength: 'direct',
        corroborationCount: 1,
        confidence: 0.9,
        contradictionRisk: 'low',
        instructionsAllowed: false,
        rawContentRetained: false
      }
    ]
  },
  nextBestNonNexusQueries: [],
  snapshots: [
    {
      id: 'snapshot-nexus-weather-patch',
      kind: 'nexus-api',
      title: 'Weather Patch files',
      url: nexusCitation.url,
      capturedAt: researchGeneratedAt,
      status: 'captured',
      trust: 'untrusted-external-content',
      instructionsAllowed: false
    }
  ],
  sources: [nexusCitation],
  issues: []
});

const createCaseState = (overrides: Partial<FluxoraAiCaseState> = {}): FluxoraAiCaseState => ({
  schema: 'fluxora.ai.case-state.v1',
  generatedAt: researchGeneratedAt,
  operationId: 'op_ai_research',
  caseState: 'diagnosis-complete',
  tokenSafeSummary: 'Case milestone: diagnosis-complete. Evidence ids: nexus-api:weather-patch, web:maintainer-release.',
  resolvedFacts: ['Confirmed: Weather Patch metadata was found.'],
  openQuestions: [],
  discardedHypotheses: [],
  sourceIds: ['nexus-api:weather-patch', 'web:maintainer-release'],
  quotaState: {
    nexusApiState: 'available',
    unavailableReason: 'none',
    lastHttpStatus: 200,
    retryAfterSeconds: null,
    quota: nexusQuota,
    limitation: null
  },
  nextRecommendedStage: 'write-final-answer',
  ...overrides
});

describe('AI chat message rendering', () => {
  it('renders provider markdown as readable safe text blocks', () => {
    const html = renderToStaticMarkup(
      renderAiChatMessageContent(
        [
          '### Оценка',
          '',
          '**1.5 / 10**',
          '',
          '---',
          '',
          '1. **USSEP** - базовые исправления.',
          '2. **SkyUI** - интерфейс.',
          '',
          '- SSE Engine Fixes',
          '- Address Library',
          '',
          '<script>alert(1)</script>'
        ].join('\n')
      ) as ReactElement
    );

    expect(html).toContain('ai-chat-message__content');
    expect(html).toContain('<h3>Оценка</h3>');
    expect(html).toContain('<strong>1.5 / 10</strong>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<hr/>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('renders the composer as one Codex-like input surface with icon-only actions', () => {
    const markup = renderPanel({
      ...initialAiChatState,
      draft: 'Check this load order',
      isOpen: true
    });

    expect(markup).toContain('ai-chat-input__surface');
    expect(markup).toContain('ai-chat-input__toolbar');
    expect(markup).toContain('ai-chat-input__tool-button');
    expect(markup).toContain('aria-label="Send message"');
    expect(markup).toContain('--ai-chat-input-icon');
    expect(markup).not.toContain('ai-context-ring');
    expect(markup).not.toContain('<span>Send</span>');
  });

  it('renders the AI context ring before the microphone with compact request usage details', () => {
    const message = createAiMessage(
      'user',
      'Check current context usage.',
      new Date('2026-07-03T10:00:00Z'),
      'run-context'
    );
    const markup = renderPanel(
      stateWithMessages([message], {
        contextEstimateState: 'ready',
        contextUsage: createContextUsage({
          contextWindowTokens: 100,
          currentContextTokens: 12,
          currentContextPercent: 12
        })
      })
    );
    const ringIndex = markup.indexOf('ai-context-ring');
    const micIndex = markup.indexOf('Voice input unavailable');

    expect(ringIndex).toBeGreaterThanOrEqual(0);
    expect(ringIndex).toBeLessThan(micIndex);
    expect(markup).toContain('Контекст ИИ');
    expect(markup).toContain('Current request');
    expect(markup).toContain('12 / 100 tokens');
    expect(markup).toContain('≈ 12% used');
    expect(markup).toContain('full · exact');
    expect(markup).toContain('data-level="normal"');
    expect(markup).toContain('data-mode="full"');
    expect(markup).toContain('data-precision="exact"');
    expect(markup).toContain('data-percent="12.0"');
  });

  it('shows thinking state instead of rendering partial streaming markdown', () => {
    const userMessage = createAiMessage(
      'user',
      'Собери ответ в Markdown.',
      new Date('2026-07-03T09:05:00Z'),
      'run-thinking'
    );
    const streamingMessage = createAiMessage(
      'assistant',
      '### Полуответ\n\n- Это еще поток',
      new Date('2026-07-03T09:05:01Z'),
      'run-thinking',
      { isStreaming: true }
    );
    const markup = renderPanel({
      ...stateWithMessages([userMessage, streamingMessage]),
      isRunning: true,
      status: 'thinking'
    });

    expect(markup).toContain('ai-chat-progress');
    expect(markup).toContain('Думаю');
    expect(markup).not.toContain('Полуответ');
    expect(markup).not.toContain('Это еще поток');
  });

  it('hides internal status, skill and subagent planning chrome from the chat surface', () => {
    const plainMessage = createAiMessage(
      'assistant',
      'Plain answer.',
      new Date('2026-06-30T10:00:00Z'),
      'run-plain',
      { agentStatus: 'done' }
    );
    const plainMarkup = renderPanel(stateWithMessages([plainMessage]));
    const sourceOnlyMessage = createAiMessage(
      'assistant',
      'Plain answer with a regular citation.',
      new Date('2026-06-30T10:01:00Z'),
      'run-source-only',
      {
        agentStatus: 'done',
        sources: [
          {
            id: 'docs-source',
            title: 'Fluxora docs',
            url: 'https://example.test/fluxora'
          }
        ]
      }
    );
    const sourceOnlyMarkup = renderPanel(stateWithMessages([sourceOnlyMessage]));
    const hiddenMetadataMessage = createAiMessage(
      'assistant',
      'Plain answer with hidden metadata.',
      new Date('2026-06-30T10:02:00Z'),
      'run-hidden-metadata',
      {
        agentStatus: 'done',
        costEstimate: hiddenCostEstimate,
        tokenUsage: {
          inputTokens: 1600,
          outputTokens: 400,
          totalTokens: 2000,
          contextTokensBeforeRequest: 1600,
          source: 'gemini-usage-metadata'
        },
        sources: [
          {
            id: 'build.summary',
            title: 'Why: build.summary context',
            url: `${AI_CONTEXT_SOURCE_URL_PREFIX}build.summary`,
            kind: 'context-source',
            provider: 'fluxora-local-context',
            trust: 'local-context'
          },
          {
            id: 'docs-source',
            title: 'Fluxora docs',
            url: 'https://example.test/fluxora'
          }
        ]
      }
    );
    const hiddenMetadataMarkup = renderPanel(stateWithMessages([hiddenMetadataMessage]));

    const planningBundle = createFluxoraAiTaskPlanningBundle(
      'Проверь совместимость этих 20 модов с Nexus dependencies',
      'op_ai_subagents',
      new Date('2026-06-30T10:05:00Z')
    );
    const plannedMessage = createAiMessage(
      'assistant',
      'Compatibility check complete.',
      new Date('2026-06-30T10:05:01Z'),
      'run-subagents',
      {
        agentStatus: 'done',
        modelId: 'gemini-3.1-flash-lite',
        providerId: 'gemini',
        selectedSkill: planningBundle.selectedSkill,
        taskPlan: planningBundle.taskPlan,
        subagentSchedule: planningBundle.subagentSchedule
      }
    );
    const plannedMarkup = renderPanel({
      ...stateWithMessages([plannedMessage]),
      status: 'done'
    });
    const selectedSkillName = planningBundle.selectedSkill.selectedSkill?.displayName;

    expect(plannedMarkup).not.toContain('ai-chat-status-list');
    expect(plainMarkup).not.toContain('ai-chat-subagents');
    expect(plainMarkup).not.toContain('ai-chat-research');
    expect(sourceOnlyMarkup).not.toContain('ai-chat-research');
    expect(sourceOnlyMarkup).toContain('Fluxora docs');
    expect(hiddenMetadataMarkup).toContain('Fluxora docs');
    expect(hiddenMetadataMarkup).not.toContain('Why: build.summary context');
    expect(hiddenMetadataMarkup).not.toContain('ai-chat-message__cost');
    expect(hiddenMetadataMarkup).not.toContain('Actual USD');
    expect(hiddenMetadataMarkup).not.toContain('gemini-usage-metadata');
    expect(hiddenMetadataMarkup).not.toContain('totalTokens');
    expect(hiddenMetadataMarkup).not.toContain('contextTokensBeforeRequest');
    expect(plannedMarkup).toContain('Compatibility check complete.');
    expect(plannedMarkup).not.toContain('Skill');
    expect(plannedMarkup).not.toContain('gemini-3.1-flash-lite');
    if (!selectedSkillName) {
      throw new Error('Expected the planning bundle to select a skill.');
    }
    expect(plannedMarkup).not.toContain(selectedSkillName);
    expect(plannedMarkup).not.toContain('ai-chat-subagents');
    expect(plannedMarkup).not.toContain('Subagents');
    expect(plannedMarkup).not.toContain('Collect current build context');
    expect(plannedMarkup).not.toContain('Inspect local compatibility evidence');
    expect(plannedMarkup).not.toContain('ai-chat-plan');
    expect(plannedMarkup).not.toContain(planningBundle.taskPlan.goal);
    expect(plannedMarkup).not.toContain('Queue ');
  });

  it('renders research sources without internal research stages or counts', () => {
    const message = createAiMessage(
      'assistant',
      'Structured answer with cited evidence.',
      new Date('2026-07-01T08:00:01Z'),
      'run-research',
      {
        agentStatus: 'done',
        researchReport: createResearchReport(),
        caseState: createCaseState(),
        sources: [
          {
            id: 'web:maintainer-release',
            title: 'Maintainer release notes',
            url: 'https://github.com/example/weather-patch/releases',
            kind: 'public-web',
            provider: 'github'
          }
        ]
      }
    );
    const markup = renderPanel(stateWithMessages([message]));

    expect(markup).toContain('Maintainer release notes');
    expect(markup).toContain('Weather Patch Nexus files');
    expect(markup).not.toContain('ai-chat-research');
    expect(markup).not.toContain('Local');
    expect(markup).not.toContain('Judge');
    expect(markup).not.toContain('Sources 2');
    expect(markup).not.toContain('Evidence 2');
    expect(markup).not.toContain('Nexus quota 42 hourly / 900 daily');
    expect(markup).not.toContain('ai-chat-subagents');
  });

  it('does not render quota limitations as a separate internal research panel', () => {
    const message = createAiMessage(
      'assistant',
      'Nexus pass was limited.',
      new Date('2026-07-01T08:05:01Z'),
      'run-quota',
      {
        agentStatus: 'blocked',
        caseState: createCaseState({
          caseState: 'nexus-pass-complete',
          sourceIds: [],
          quotaState: {
            nexusApiState: 'quota-exhausted',
            unavailableReason: 'rate-limited',
            lastHttpStatus: 429,
            retryAfterSeconds: 60,
            quota: {
              hourlyRemaining: 0,
              dailyRemaining: 15,
              resetAt: '2026-07-01T09:00:00.000Z',
              source: 'headers'
            },
            limitation:
              'Nexus API quota is exhausted or rate-limited; this research limitation leaves Nexus evidence incomplete for this pass.'
          },
          nextRecommendedStage: 'run-external-pass'
        })
      }
    );
    const markup = renderPanel(stateWithMessages([message]));

    expect(markup).toContain('Nexus pass was limited.');
    expect(markup).not.toContain('ai-chat-research');
    expect(markup).not.toContain('Limited');
    expect(markup).not.toContain('Nexus quota 0 hourly / 15 daily');
    expect(markup).not.toContain('research limitation leaves Nexus evidence incomplete');
  });

  it('keeps source URLs behind safe source validation', () => {
    const message = createAiMessage(
      'assistant',
      'Sources checked.',
      new Date('2026-07-01T08:10:01Z'),
      'run-safe-source',
      {
        agentStatus: 'done',
        caseState: createCaseState({
          sourceIds: ['safe-source', 'unsafe-source']
        }),
        sources: [
          {
            id: 'safe-source',
            title: 'Safe maintainer page',
            url: 'https://example.test/maintainer'
          },
          {
            id: 'unsafe-source',
            title: 'Unsafe source',
            url: 'javascript:alert(1)'
          }
        ]
      }
    );
    const markup = renderPanel(stateWithMessages([message]));

    expect(markup).toContain('Safe maintainer page');
    expect(markup).toContain('Unsafe source');
    expect(markup).toContain('Blocked unsafe source URL');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('javascript:alert');
  });

  it('keeps multi-model orchestration metadata out of rendered assistant messages', () => {
    const planningBundle = createFluxoraAiTaskPlanningBundle(
      'check 20 mods',
      'op_ai_orchestrated',
      new Date('2026-06-30T10:10:00Z')
    );
    const message = createAiMessage(
      'assistant',
      'Chef synthesis.',
      new Date('2026-06-30T10:10:01Z'),
      'run-orchestrated',
      {
        agentStatus: 'done',
        taskPlan: planningBundle.taskPlan,
        subagentSchedule: planningBundle.subagentSchedule,
        orchestration: {
          schema: 'fluxora.ai.multi-model-orchestration.v1',
          generatedAt: '2026-06-30T10:10:00Z',
          operationId: 'op_ai_orchestrated',
          mode: 'chef-first',
          strategy: 'chef-dispatch-then-parallel-subagents-then-chef-synthesis',
          chef: {
            agentId: 'chef-orchestrator',
            label: 'Chef orchestrator',
            providerId: 'gemini',
            modelId: 'gemini-3.1-flash-lite',
            status: 'final-completed',
            durationMs: 120,
            finalDurationMs: 80,
            dispatchPlan: 'Ask workers to verify dependencies and conflicts.'
          },
          subagents: [
            {
              agentId: 'compat-worker',
              durationMs: 60,
              label: 'Compatibility worker',
              modelId: 'gemini-2.5-flash-lite',
              providerId: 'gemini',
              status: 'completed',
              text: 'No confirmed blocker in supplied context.'
            }
          ],
          completedSubagentCount: 1,
          policy: {
            finalAnswerByChef: true,
            subagentOutputTrustedAsInstructions: false,
            requiresGroundedFacts: true,
            mutationsAllowed: false,
            askUserOnlyIfBlocked: true
          }
        }
      }
    );
    const markup = renderPanel(stateWithMessages([message]));

    expect(markup).toContain('Chef synthesis.');
    expect(markup).not.toContain('ai-chat-subagents');
    expect(markup).not.toContain('ai-chat-plan');
    expect(markup).not.toContain('chef-orchestrator');
    expect(markup).not.toContain('Compatibility worker');
    expect(markup).not.toContain('gemini-2.5-flash-lite');
    expect(markup).not.toContain('chef-dispatch-then-parallel-subagents');
  });
});
