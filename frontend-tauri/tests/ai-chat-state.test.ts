import { describe, expect, it } from 'vitest';

import {
  AI_CHAT_PANEL_MAX_WIDTH,
  AI_CHAT_PANEL_MIN_WIDTH,
  approximateAiContextUsageForDraft,
  aiChatReducer,
  createAiMessage,
  createAiRun,
  createAiChatTitleFromPrompt,
  createAiStreamEvent,
  createFakeAiRunPlan,
  initialAiChatState
} from '../src/renderer/features/ai/ai-chat-state';
import type {
  FluxoraAiContextUsage,
  FluxoraAiIntermediateEvent
} from '../src/shared/fluxora-api';

const createContextUsage = (
  overrides: Partial<FluxoraAiContextUsage> = {}
): FluxoraAiContextUsage => ({
  schema: 'fluxora.ai.context-usage.v1',
  operationId: 'op_ai_chat_run',
  providerId: 'gemini',
  modelId: 'gemini-3.1-flash-lite',
  contextWindowTokens: 1000,
  currentContextTokens: 125,
  currentContextPercent: 12.5,
  precision: 'exact',
  level: 'normal',
  mode: 'full',
  includedSections: ['system-instructions', 'chat-history'],
  autoCompressionApplied: false,
  actionRequired: false,
  countedAt: '2026-07-03T10:00:00.000Z',
  ...overrides
});

const createIntermediateEvent = (
  overrides: Partial<FluxoraAiIntermediateEvent> = {}
): FluxoraAiIntermediateEvent => ({
  schema: 'fluxora.ai.intermediate-event.v1',
  eventId: 'event-1',
  runId: 'run-intermediate',
  operationId: 'op_ai_intermediate',
  seq: 1,
  createdAt: '2026-07-03T10:00:00.100Z',
  type: 'progress',
  level: 'info',
  visibility: 'user',
  stage: 'prompt-preparation',
  message: 'Preparing prompt and build context.',
  percent: 5,
  ...overrides
});

describe('AI chat shell state', () => {
  it('opens, collapses and clamps the resizable panel width', () => {
    const opened = aiChatReducer(initialAiChatState, { type: 'open' });
    const collapsed = aiChatReducer(opened, { type: 'toggle-collapse' });
    const tooWide = aiChatReducer(collapsed, { type: 'set-width', width: 9999 });
    const tooNarrow = aiChatReducer(tooWide, { type: 'set-width', width: 1 });

    expect(opened.isOpen).toBe(true);
    expect(opened.isCollapsed).toBe(false);
    expect(collapsed.isOpen).toBe(true);
    expect(collapsed.isCollapsed).toBe(true);
    expect(tooWide.width).toBe(AI_CHAT_PANEL_MAX_WIDTH);
    expect(tooNarrow.width).toBe(AI_CHAT_PANEL_MIN_WIDTH);
  });

  it('submits a fake local run without provider or bridge access', () => {
    const run = createAiRun(
      initialAiChatState.session.id,
      'op_ai_chat_run',
      'prompt-digest',
      'check plugins'.length,
      new Date('2026-06-29T09:00:00Z')
    );
    const userMessage = createAiMessage(
      'user',
      'check plugins',
      new Date('2026-06-29T09:00:00Z'),
      run.id
    );
    const assistantMessage = createAiMessage(
      'assistant',
      createFakeAiRunPlan(userMessage.text).reply,
      new Date('2026-06-29T09:00:01Z'),
      run.id
    );
    const createdEvent = createAiStreamEvent(run, 'run-created', {
      now: new Date('2026-06-29T09:00:00Z'),
      status: 'thinking'
    });

    const submitted = aiChatReducer(
      { ...initialAiChatState, draft: userMessage.text },
      { type: 'submit-user-message', message: userMessage, run, event: createdEvent }
    );
    const running = aiChatReducer(submitted, {
      type: 'apply-stream-event',
      event: createAiStreamEvent(run, 'status', {
        now: new Date('2026-06-29T09:00:00.320Z'),
        status: 'running'
      })
    });
    const finished = aiChatReducer(running, {
      type: 'append-assistant-message',
      message: assistantMessage,
      event: createAiStreamEvent(run, 'run-finished', {
        now: new Date('2026-06-29T09:00:01Z'),
        status: 'done'
      }),
      status: 'done'
    });

    expect(submitted.draft).toBe('');
    expect(submitted.activeRunId).toBe(run.id);
    expect(submitted.isOpen).toBe(true);
    expect(submitted.status).toBe('thinking');
    expect(submitted.session.runs[0]?.operationId).toBe('op_ai_chat_run');
    expect(running.status).toBe('running');
    expect(finished.status).toBe('done');
    expect(finished.activeRunId).toBeNull();
    expect(finished.isRunning).toBe(false);
    expect(finished.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(finished.session.streamEvents.map((event) => event.type)).toEqual([
      'run-created',
      'status',
      'run-finished'
    ]);
    expect(createFakeAiRunPlan('needs approval before delete').finalStatus).toBe('needs-approval');
    expect(createFakeAiRunPlan('blocked by missing login').finalStatus).toBe('blocked');
  });

  it('marks cancelled AI runs as stopped instead of idle', () => {
    const run = createAiRun(
      initialAiChatState.session.id,
      'op_ai_chat_cancel',
      'prompt-digest',
      'stop me'.length,
      new Date('2026-07-03T09:00:00Z')
    );
    const submitted = aiChatReducer(initialAiChatState, {
      type: 'submit-user-message',
      message: createAiMessage('user', 'stop me', new Date('2026-07-03T09:00:00Z'), run.id),
      run,
      event: createAiStreamEvent(run, 'run-created', {
        now: new Date('2026-07-03T09:00:00Z'),
        status: 'thinking'
      })
    });
    const stopped = aiChatReducer(submitted, {
      type: 'cancel-run',
      message: createAiMessage('assistant', 'Остановлено', new Date('2026-07-03T09:00:01Z'), run.id, {
        agentStatus: 'stopped'
      }),
      event: createAiStreamEvent(run, 'run-cancelled', {
        now: new Date('2026-07-03T09:00:01Z'),
        status: 'stopped'
      })
    });

    expect(stopped.status).toBe('stopped');
    expect(stopped.activeRunId).toBeNull();
    expect(stopped.isRunning).toBe(false);
    expect(stopped.messages.at(-1)?.text).toBe('Остановлено');
    expect(stopped.session.runs[0]).toMatchObject({
      cancellationRequested: true,
      state: 'cancelled',
      status: 'stopped'
    });
  });

  it('keeps only recent intermediate events for long AI runs', () => {
    const run = createAiRun(
      initialAiChatState.session.id,
      'op_ai_long_requirements',
      'prompt-digest',
      'Проверь требования всех модов'.length,
      new Date('2026-07-07T09:00:00Z')
    );
    let state = aiChatReducer(initialAiChatState, {
      type: 'submit-user-message',
      message: createAiMessage(
        'user',
        'Проверь требования всех модов',
        new Date('2026-07-07T09:00:00Z'),
        run.id
      ),
      run,
      event: createAiStreamEvent(run, 'run-created', {
        now: new Date('2026-07-07T09:00:00Z'),
        status: 'thinking'
      })
    });

    for (let index = 0; index < 220; index += 1) {
      state = aiChatReducer(state, {
        type: 'apply-run-event',
        event: createIntermediateEvent({
          eventId: `event-long-${index}`,
          runId: run.id,
          operationId: run.operationId,
          seq: index,
          createdAt: new Date(Date.parse('2026-07-07T09:00:00Z') + index * 1000).toISOString(),
          stage: 'nexus-requirement-audit',
          message: `Checked mod ${index}.`
        })
      });
    }

    expect(state.intermediateEvents).toHaveLength(160);
    expect(state.intermediateEvents[0]?.eventId).toBe('event-long-60');
    expect(state.intermediateEvents.at(-1)?.eventId).toBe('event-long-219');
    expect(state.session.chats[0]?.intermediateEvents).toHaveLength(160);
  });

  it('keeps streamed assistant deltas out of visible messages until the final answer', () => {
    const run = createAiRun(
      initialAiChatState.session.id,
      'op_ai_chat_run',
      'prompt-digest',
      'format final answer'.length,
      new Date('2026-07-03T09:00:00Z')
    );
    const userMessage = createAiMessage(
      'user',
      'format final answer',
      new Date('2026-07-03T09:00:00Z'),
      run.id
    );
    const submitted = aiChatReducer(
      { ...initialAiChatState, draft: userMessage.text },
      {
        type: 'submit-user-message',
        message: userMessage,
        run,
        event: createAiStreamEvent(run, 'run-created', {
          now: new Date('2026-07-03T09:00:00Z'),
          status: 'thinking'
        })
      }
    );
    const streaming = aiChatReducer(submitted, {
      type: 'apply-stream-event',
      event: createAiStreamEvent(run, 'assistant-delta', {
        now: new Date('2026-07-03T09:00:00.120Z'),
        status: 'running',
        textDelta: '### Partial\n\n- Still streaming'
      })
    });
    const finished = aiChatReducer(streaming, {
      type: 'append-assistant-message',
      message: createAiMessage(
        'assistant',
        '### Итог\n\n- Готово',
        new Date('2026-07-03T09:00:01Z'),
        run.id
      ),
      event: createAiStreamEvent(run, 'run-finished', {
        now: new Date('2026-07-03T09:00:01Z'),
        status: 'done'
      }),
      status: 'done'
    });

    expect(streaming.messages.map((message) => message.role)).toEqual(['user']);
    expect(streaming.session.streamEvents.map((event) => event.type)).toEqual([
      'run-created',
      'assistant-delta'
    ]);
    expect(finished.messages.map((message) => message.text)).toEqual([
      'format final answer',
      '### Итог\n\n- Готово'
    ]);
    expect(finished.messages[1]?.isStreaming).not.toBe(true);
  });

  it('stores canonical intermediate events by run with ordering and dedupe', () => {
    const run = createAiRun(
      initialAiChatState.session.id,
      'op_ai_intermediate',
      'prompt-digest',
      'check plugins'.length,
      new Date('2026-07-03T10:00:00Z')
    );
    const userMessage = createAiMessage(
      'user',
      'check plugins',
      new Date('2026-07-03T10:00:00Z'),
      run.id
    );
    const submitted = aiChatReducer(
      { ...initialAiChatState, draft: userMessage.text },
      {
        type: 'submit-user-message',
        message: userMessage,
        run,
        event: createAiStreamEvent(run, 'run-created', {
          now: new Date('2026-07-03T10:00:00Z'),
          status: 'thinking'
        })
      }
    );
    const laterEvent = createIntermediateEvent({
      eventId: 'event-2',
      runId: run.id,
      operationId: run.operationId,
      seq: 2,
      createdAt: '2026-07-03T10:00:00.300Z',
      stage: 'provider-attempt',
      message: 'Provider attempt started.',
      percent: 58
    });
    const earlierEvent = createIntermediateEvent({
      eventId: 'event-1',
      runId: run.id,
      operationId: run.operationId,
      seq: 1,
      createdAt: '2026-07-03T10:00:00.200Z',
      stage: 'local-inspection',
      message: 'Local inspection finished.',
      percent: 24
    });

    const withLater = aiChatReducer(submitted, { type: 'apply-run-event', event: laterEvent });
    const withEarlier = aiChatReducer(withLater, { type: 'apply-run-event', event: earlierEvent });
    const withDuplicate = aiChatReducer(withEarlier, { type: 'apply-run-event', event: laterEvent });
    const blocked = aiChatReducer(withDuplicate, {
      type: 'apply-run-event',
      event: createIntermediateEvent({
        eventId: 'event-error',
        runId: run.id,
        operationId: run.operationId,
        seq: 3,
        createdAt: '2026-07-03T10:00:00.400Z',
        type: 'error',
        level: 'error',
        stage: 'provider-attempt',
        message: 'Provider attempt failed.'
      })
    });

    expect(withDuplicate.intermediateEvents.map((event) => event.eventId)).toEqual([
      'event-1',
      'event-2'
    ]);
    expect(withDuplicate.status).toBe('running');
    expect(withDuplicate.session.runs[0]?.eventIds).toEqual(
      expect.arrayContaining(['event-1', 'event-2'])
    );
    expect(blocked.status).toBe('blocked');
    expect(blocked.session.runs[0]?.eventIds).toEqual(
      expect.arrayContaining(['event-error'])
    );
  });

  it('creates isolated chat tabs and names a new chat from its first prompt', () => {
    const firstChatId = initialAiChatState.activeChatId;
    const withNewChat = aiChatReducer(initialAiChatState, {
      type: 'create-chat',
      now: new Date('2026-06-29T09:05:00Z')
    });
    const run = createAiRun(
      withNewChat.session.chats.find((chat) => chat.id === withNewChat.activeChatId)?.id ?? '',
      'op_ai_chat_run',
      'prompt-digest',
      'compare load order'.length,
      new Date('2026-06-29T09:05:01Z')
    );
    const userMessage = createAiMessage(
      'user',
      'compare load order before launch',
      new Date('2026-06-29T09:05:01Z'),
      run.id
    );
    const submitted = aiChatReducer(withNewChat, {
      type: 'submit-user-message',
      message: userMessage,
      run,
      event: createAiStreamEvent(run, 'run-created', {
        now: new Date('2026-06-29T09:05:01Z'),
        status: 'thinking'
      })
    });
    const finished = aiChatReducer(submitted, {
      type: 'append-assistant-message',
      message: createAiMessage(
        'assistant',
        'Review the active chat only.',
        new Date('2026-06-29T09:05:02Z'),
        run.id
      ),
      event: createAiStreamEvent(run, 'run-finished', {
        now: new Date('2026-06-29T09:05:02Z'),
        status: 'done'
      }),
      status: 'done'
    });
    const firstChatAgain = aiChatReducer(finished, {
      type: 'select-chat',
      chatId: firstChatId
    });

    expect(withNewChat.chats).toHaveLength(2);
    expect(withNewChat.activeChatId).not.toBe(firstChatId);
    expect(withNewChat.messages).toEqual([]);
    expect(submitted.session.chats.find((chat) => chat.id === submitted.activeChatId)?.title).toBe(
      'compare load order before launch'
    );
    expect(finished.session.chats.find((chat) => chat.id === firstChatId)?.messages).toEqual([]);
    expect(firstChatAgain.activeChatId).toBe(firstChatId);
    expect(firstChatAgain.messages).toEqual([]);
    expect(createAiChatTitleFromPrompt('  a very long request that should become a compact title for tabs  ')).toBe(
      'a very long request that should b...'
    );
  });

  it('closes chat tabs while keeping the active session valid', () => {
    const firstChatId = initialAiChatState.activeChatId;
    const withSecondChat = aiChatReducer(initialAiChatState, {
      type: 'create-chat',
      now: new Date('2026-06-29T09:10:00Z')
    });
    const secondChatId = withSecondChat.activeChatId;
    const withThirdChat = aiChatReducer(withSecondChat, {
      type: 'create-chat',
      now: new Date('2026-06-29T09:11:00Z')
    });
    const thirdChatId = withThirdChat.activeChatId;

    const closedActive = aiChatReducer(
      { ...withThirdChat, draft: 'discard active draft' },
      { type: 'close-chat', chatId: thirdChatId }
    );
    const closedInactive = aiChatReducer(
      { ...closedActive, draft: 'keep selected draft' },
      { type: 'close-chat', chatId: firstChatId }
    );
    const replacedLastChat = aiChatReducer(closedInactive, {
      type: 'close-chat',
      chatId: secondChatId,
      now: new Date('2026-06-29T09:12:00Z')
    });
    const runningState = aiChatReducer(
      { ...withSecondChat, isRunning: true },
      { type: 'close-chat', chatId: firstChatId }
    );

    expect(closedActive.chats.map((chat) => chat.id)).toEqual([firstChatId, secondChatId]);
    expect(closedActive.activeChatId).toBe(secondChatId);
    expect(closedActive.draft).toBe('');
    expect(closedInactive.chats.map((chat) => chat.id)).toEqual([secondChatId]);
    expect(closedInactive.activeChatId).toBe(secondChatId);
    expect(closedInactive.draft).toBe('keep selected draft');
    expect(replacedLastChat.chats).toHaveLength(1);
    expect(replacedLastChat.activeChatId).not.toBe(secondChatId);
    expect(replacedLastChat.messages).toEqual([]);
    expect(replacedLastChat.chats[0]?.title).toBe('New chat');
    expect(runningState.chats.map((chat) => chat.id)).toEqual(
      withSecondChat.chats.map((chat) => chat.id)
    );
  });

  it('opens a subagent result as a dedicated chat tab without duplicating it', () => {
    const parentChatId = initialAiChatState.activeChatId;
    const subagent = {
      id: 'op_ai_chat_run:web-research',
      operationId: 'op_ai_chat_run',
      parentChatId,
      parentRunId: 'run-ai-chat',
      agentId: 'web-research',
      label: 'Web research',
      role: 'external-network',
      status: 'done' as const,
      summary: 'Collected cited Nexus compatibility sources.',
      detailText: 'Collected cited Nexus compatibility sources.',
      permissionClass: 'external-network' as const,
      providerId: 'gemini',
      modelId: 'gemini-flash'
    };

    const opened = aiChatReducer(initialAiChatState, {
      type: 'open-subagent-chat',
      subagent,
      now: new Date('2026-06-30T09:00:00Z')
    });
    const reopened = aiChatReducer(opened, {
      type: 'open-subagent-chat',
      subagent,
      now: new Date('2026-06-30T09:01:00Z')
    });
    const subagentChat = opened.chats.find((chat) => chat.subagent?.id === subagent.id);

    expect(opened.activeChatId).not.toBe(parentChatId);
    expect(opened.chats).toHaveLength(initialAiChatState.chats.length + 1);
    expect(subagentChat?.title).toBe('Web research');
    expect(subagentChat?.messages[0]?.text).toBe('Collected cited Nexus compatibility sources.');
    expect(subagentChat?.messages[0]?.providerId).toBe('gemini');
    expect(reopened.chats).toHaveLength(opened.chats.length);
    expect(reopened.activeChatId).toBe(opened.activeChatId);
  });

  it('stores context estimates on the run chat without leaking to other tabs', () => {
    const firstChatId = initialAiChatState.activeChatId;
    const withSecondChat = aiChatReducer(initialAiChatState, {
      type: 'create-chat',
      now: new Date('2026-07-03T10:00:00Z')
    });
    const secondChatId = withSecondChat.activeChatId;
    const run = createAiRun(
      secondChatId,
      'op_ai_chat_run',
      'prompt-digest',
      'check context'.length,
      new Date('2026-07-03T10:00:01Z')
    );
    const submitted = aiChatReducer(withSecondChat, {
      type: 'submit-user-message',
      message: createAiMessage('user', 'check context', new Date('2026-07-03T10:00:01Z'), run.id),
      run,
      event: createAiStreamEvent(run, 'run-created', {
        now: new Date('2026-07-03T10:00:01Z'),
        status: 'thinking'
      })
    });
    const counting = aiChatReducer(submitted, {
      type: 'set-context-estimate',
      runId: run.id,
      estimateState: 'counting'
    });
    const usage = createContextUsage({ operationId: run.operationId });
    const ready = aiChatReducer(counting, {
      type: 'set-context-estimate',
      runId: run.id,
      estimateState: 'ready',
      contextUsage: usage
    });

    expect(ready.chats.find((chat) => chat.id === firstChatId)?.contextUsage).toBeNull();
    expect(ready.chats.find((chat) => chat.id === secondChatId)?.contextUsage).toEqual(usage);
    expect(ready.chats.find((chat) => chat.id === secondChatId)?.contextEstimateState).toBe('ready');
  });

  it('approximates draft context from the last host estimate and preserves chat switching', () => {
    const run = createAiRun(
      initialAiChatState.activeChatId,
      'op_ai_chat_run',
      'prompt-digest',
      'finished context'.length,
      new Date('2026-07-03T10:05:00Z')
    );
    const usage = createContextUsage({
      contextWindowTokens: 1000,
      safeInputBudgetTokens: 650,
      currentContextTokens: 600,
      currentContextPercent: 60,
      currentBudgetPercent: 92.3,
      level: 'critical'
    });
    const submitted = aiChatReducer(initialAiChatState, {
      type: 'submit-user-message',
      message: createAiMessage('user', 'finished context', new Date('2026-07-03T10:05:00Z'), run.id),
      run,
      event: createAiStreamEvent(run, 'run-created', {
        now: new Date('2026-07-03T10:05:00Z'),
        status: 'thinking'
      })
    });
    const finished = aiChatReducer(submitted, {
      type: 'append-assistant-message',
      message: createAiMessage(
        'assistant',
        'Done.',
        new Date('2026-07-03T10:05:01Z'),
        run.id,
        { contextUsage: usage }
      ),
      event: createAiStreamEvent(run, 'run-finished', {
        now: new Date('2026-07-03T10:05:01Z'),
        status: 'done'
      }),
      status: 'done'
    });
    const withNewChat = aiChatReducer(finished, {
      type: 'create-chat',
      now: new Date('2026-07-03T10:06:00Z')
    });
    const switchedBack = aiChatReducer(withNewChat, {
      type: 'select-chat',
      chatId: finished.activeChatId
    });
    const approximated = approximateAiContextUsageForDraft(usage, '12345678');

    expect(withNewChat.activeChatId).not.toBe(finished.activeChatId);
    expect(withNewChat.chats.find((chat) => chat.id === withNewChat.activeChatId)?.contextUsage).toBeNull();
    expect(switchedBack.chats.find((chat) => chat.id === finished.activeChatId)?.contextUsage).toEqual(usage);
    expect(approximated?.currentContextTokens).toBe(602);
    expect(approximated?.currentContextPercent).toBeCloseTo(60.2, 3);
    expect(approximated?.currentBudgetPercent).toBeCloseTo(92.615, 3);
    expect(approximated?.level).toBe('critical');
    expect(approximated?.precision).toBe('estimated');
    expect(approximated?.includedSections).toContain('draft-approximation');
  });
});
