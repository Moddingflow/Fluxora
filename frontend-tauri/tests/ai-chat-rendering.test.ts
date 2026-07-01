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
    expect(links.map((link) => link.agentId)).toContain('web-research');
    expect(links.every((link) => link.status === 'done')).toBe(true);
    expect(plannedMarkup).toContain('ai-chat-subagents');
    expect(plannedMarkup).toContain('Collect Nexus and web compatibility sources');
    expect(plannedMarkup).toContain('Open Collect Nexus and web compatibility sources subagent chat');
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
