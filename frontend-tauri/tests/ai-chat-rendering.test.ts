import { renderToStaticMarkup } from 'react-dom/server';
import React, { type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import {
  AiChatPanel,
  aiSubagentLinksForMessage,
  renderAiChatMessageContent
} from '../src/renderer/features/ai/AiChatPanel';
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
  FluxoraAiResearchReport
} from '../src/shared/fluxora-api';

const noop = () => undefined;

const stateWithMessages = (messages: AiMessage[]): AiChatState => {
  const baseChat = initialAiChatState.chats[0]!;
  const chat = {
    ...baseChat,
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
      onOpenSubagentChat: noop,
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

  it('renders subagent controls only when an assistant message has subagent DTOs', () => {
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
        taskPlan: planningBundle.taskPlan,
        subagentSchedule: planningBundle.subagentSchedule
      }
    );
    const links = aiSubagentLinksForMessage(plannedMessage, initialAiChatState.activeChatId);
    const plannedMarkup = renderPanel(stateWithMessages([plannedMessage]));

    expect(plainMarkup).not.toContain('ai-chat-subagents');
    expect(plainMarkup).not.toContain('ai-chat-research');
    expect(sourceOnlyMarkup).not.toContain('ai-chat-research');
    expect(sourceOnlyMarkup).toContain('Fluxora docs');
    expect(links.map((link) => link.agentId)).toContain('web-research');
    expect(links.map((link) => link.agentId).slice(0, 2)).toEqual([
      'build-state',
      'local-inspector'
    ]);
    expect(links.every((link) => link.status === 'done')).toBe(true);
    expect(plannedMarkup).toContain('ai-chat-subagents');
    expect(plannedMarkup).toContain('Collect current build context');
    expect(plannedMarkup).toContain('Inspect local compatibility evidence');
    expect(plannedMarkup).toContain('Open Collect current build context subagent chat');
  });

  it('renders research stages, counts and sources only when research DTOs exist', () => {
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

    expect(markup).toContain('ai-chat-research');
    expect(markup).toContain('Local');
    expect(markup).toContain('Nexus');
    expect(markup).toContain('Web');
    expect(markup).toContain('Judge');
    expect(markup).toContain('Sources 2');
    expect(markup).toContain('Evidence 2');
    expect(markup).toContain('Nexus quota 42 hourly / 900 daily');
    expect(markup).toContain('Maintainer release notes');
    expect(markup).toContain('Weather Patch Nexus files');
    expect(markup).not.toContain('ai-chat-subagents');
  });

  it('shows Nexus quota exhaustion as a research limitation', () => {
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

    expect(markup).toContain('ai-chat-research');
    expect(markup).toContain('Nexus');
    expect(markup).toContain('Limited');
    expect(markup).toContain('Nexus quota 0 hourly / 15 daily');
    expect(markup).toContain('Nexus API quota is exhausted or rate-limited');
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

  it('prefers real multi-model orchestration subagents over scheduled placeholders', () => {
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
    const links = aiSubagentLinksForMessage(message, initialAiChatState.activeChatId);

    expect(links.map((link) => link.agentId)).toEqual(['chef-orchestrator', 'compat-worker']);
    expect(links.map((link) => link.status)).toEqual(['done', 'done']);
    expect(links[1]?.detailText).toBe('No confirmed blocker in supplied context.');
  });
});
