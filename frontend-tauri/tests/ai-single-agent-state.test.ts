import { describe, expect, it } from 'vitest';

import {
  aiChatReducer,
  createAiMessage,
  createAiSession,
  createAiStreamEvent,
  type AiChatState
} from '../src/renderer/features/ai/ai-chat-state';
import {
  aiAgentStatusFromResponse,
  createAiHostChatRequest,
  createAiRunForPrompt,
  loadAiSession,
  saveAiSession
} from '../src/renderer/features/ai/ai-chat-runtime';
import { defaultAiChatSettings } from '../src/renderer/features/ai/ai-chat-settings';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('single-agent chat persistence', () => {
  it('never presents an action response without a verified file change set as completed', () => {
    const base = {
      operationId: 'op-action',
      providerId: 'gemini' as const,
      modelId: 'gemini-3.1-flash-lite' as const,
      status: 'done' as const,
      text: 'You can edit it manually.',
      streamChunks: [],
      sources: [],
      toolCallsAllowed: true,
      fileToolDiagnostics: {
        schema: 'fluxora.ai.file-tool-diagnostics.v2' as const,
        taskKind: 'action' as const,
        providerRouting: 'local-required' as const,
        outcome: 'done' as const,
        validationRetries: 0,
        duplicateCalls: 0,
        stagedChanges: 0,
        verifiedMutations: 0,
        toolCalls: 0,
        toolRounds: 1,
        metadataBytes: 0,
        contentBytes: 0,
        searches: 0,
        emptyResults: 0,
        candidateCount: 0,
        providerBytes: 0,
        redactionApplied: false,
        mutations: 0,
        truncatedResponses: 0,
        nativeSessionPreopened: true,
        newEvidenceCount: 0,
        stagnantResultCount: 0,
        phaseTransitions: []
      }
    };

    expect(aiAgentStatusFromResponse(base)).toBe('blocked');
    expect(aiAgentStatusFromResponse({
      ...base,
      fileToolDiagnostics: { ...base.fileToolDiagnostics, taskKind: 'answer' }
    })).toBe('completed');
    expect(aiAgentStatusFromResponse({
      ...base,
      execution: {
        goalId: 'op-file-action',
        kind: 'action',
        domain: 'files',
        phase: 'report',
        state: 'completed',
        verifiedEffects: [{
          tool: 'local.files.commit',
          operationId: 'op-file-action',
          verification: 'native-postcondition'
        }]
      }
    })).toBe('blocked');
    expect(aiAgentStatusFromResponse({
      ...base,
      execution: {
        goalId: 'op-file-action',
        kind: 'action',
        domain: 'files',
        phase: 'report',
        state: 'completed',
        verifiedEffects: [{
          tool: 'local.files.commit',
          operationId: 'op-file-action',
          verification: 'native-postcondition'
        }]
      },
      fileChangeSet: {
        schema: 'fluxora.ai.file-change-set.v1',
        operationId: 'op-file-action',
        runId: 'run-file-action',
        chatId: 'chat-file-action',
        rollbackState: 'available',
        files: []
      }
    })).toBe('completed');
    expect(aiAgentStatusFromResponse({
      ...base,
      execution: {
        goalId: 'op-action',
        kind: 'action',
        domain: 'mods',
        phase: 'report',
        state: 'completed',
        verifiedEffects: [{
          tool: 'local.mods.set_enabled',
          operationId: 'op-action',
          verification: 'native-postcondition'
        }]
      }
    })).toBe('completed');
    expect(aiAgentStatusFromResponse({
      ...base,
      execution: {
        goalId: 'op-action',
        kind: 'action',
        domain: 'mods',
        phase: 'verify',
        state: 'blocked',
        verifiedEffects: [],
        terminalReason: 'native-postcondition-mismatch'
      }
    })).toBe('blocked');
  });

  it('removes all legacy AI state without touching unrelated application settings', () => {
    const storage = new MemoryStorage();
    storage.setItem('fluxora.ai.chat.settings.v1', '{}');
    storage.setItem('fluxora.ai.autonomous.jobs.v1', '{}');
    storage.setItem('fluxora.ai.prompt-cache.v1', '{}');
    storage.setItem('fluxora.theme', 'dark');

    const session = loadAiSession(storage, { projectId: 'alpha', projectName: 'Alpha' });

    expect(session.scopeKey).toBe('build:alpha');
    expect(storage.getItem('fluxora.ai.chat.settings.v1')).toBeNull();
    expect(storage.getItem('fluxora.ai.autonomous.jobs.v1')).toBeNull();
    expect(storage.getItem('fluxora.ai.prompt-cache.v1')).toBeNull();
    expect(storage.getItem('fluxora.theme')).toBe('dark');
  });

  it('persists unlimited independent tabs inside each build scope', () => {
    const storage = new MemoryStorage();
    let session = loadAiSession(storage, { projectId: 'alpha', projectName: 'Alpha' });
    const initialState = {
      activeChatId: session.activeChatId,
      activeRunId: null,
      chats: session.chats,
      draft: '',
      intermediateEvents: [],
      isCollapsed: false,
      isOpen: true,
      isRunning: false,
      messages: [],
      runs: [],
      session,
      width: 380
    };
    const withSecondTab = aiChatReducer(initialState, { type: 'create-chat' });
    session = withSecondTab.session;
    saveAiSession(storage, session);

    const restoredAlpha = loadAiSession(storage, { projectId: 'alpha', projectName: 'Alpha' });
    const beta = loadAiSession(storage, { projectId: 'beta', projectName: 'Beta' });
    expect(restoredAlpha.chats).toHaveLength(2);
    expect(new Set(restoredAlpha.chats.map((chat) => chat.id)).size).toBe(2);
    expect(beta.chats).toHaveLength(1);
    expect(beta.chats[0].messages).toEqual([]);
  });

  it('sends only the active tab history and its updated summary', () => {
    const session = createAiSession('build:alpha', 'Alpha');
    const active = session.chats[0];
    active.messages.push(createAiMessage('user', 'active history'));
    active.conversationSummary = 'structured active summary';
    active.providerHistoryStartIndex = 1;
    const other = createAiSession('build:alpha', 'Alpha').chats[0];
    other.messages.push(createAiMessage('user', 'must never leak'));
    session.chats.push(other);

    const run = createAiRunForPrompt(session, 'operation-1', 'current prompt');
    const request = createAiHostChatRequest(run, session, 'current prompt', defaultAiChatSettings);

    expect(request.messages.map((message) => message.text)).toEqual(['active history', 'current prompt']);
    expect(request.messages.some((message) => message.text.includes('must never leak'))).toBe(false);
    expect(request.conversationSummary).toBe('structured active summary');
    expect(request.providerHistoryStartIndex).toBe(1);
  });

  it('normalizes sessions saved before per-tab intermediate events were added', () => {
    const storage = new MemoryStorage();
    const session = createAiSession('build:alpha', 'Alpha');
    delete (session.chats[0] as Partial<(typeof session.chats)[number]>).intermediateEvents;
    storage.setItem('fluxora.ai.single-agent-migration.v1', 'done');
    storage.setItem('fluxora.ai.single-agent.sessions.v1', JSON.stringify({
      'build:alpha': session
    }));

    const restored = loadAiSession(storage, { projectId: 'alpha', projectName: 'Alpha' });

    expect(restored.chats[0].intermediateEvents).toEqual([]);
  });

  it('keeps background tab completion and events out of the active tab', () => {
    const session = createAiSession('build:alpha', 'Alpha');
    let state: AiChatState = {
      activeChatId: session.activeChatId,
      activeRunId: null,
      chats: session.chats,
      draft: '',
      intermediateEvents: [],
      isCollapsed: false,
      isOpen: true,
      isRunning: false,
      messages: [],
      runs: [],
      session,
      width: 380
    };
    const firstChatId = state.activeChatId;
    const firstRun = createAiRunForPrompt(state.session, 'operation-first', 'first prompt');
    state = aiChatReducer(state, {
      type: 'submit-user-message',
      message: createAiMessage('user', 'first prompt', new Date(), firstRun.id),
      run: firstRun,
      event: createAiStreamEvent(firstRun, 'run-started')
    });
    state = aiChatReducer(state, { type: 'create-chat' });
    const secondChatId = state.activeChatId;
    const secondRun = createAiRunForPrompt(state.session, 'operation-second', 'second prompt');
    state = aiChatReducer(state, {
      type: 'submit-user-message',
      message: createAiMessage('user', 'second prompt', new Date(), secondRun.id),
      run: secondRun,
      event: createAiStreamEvent(secondRun, 'run-started')
    });
    state = aiChatReducer(state, {
      type: 'apply-run-event',
      event: {
        schema: 'fluxora.ai.intermediate-event.v1',
        eventId: 'event-first-search',
        runId: firstRun.id,
        operationId: firstRun.operationId,
        seq: 1,
        createdAt: new Date().toISOString(),
        type: 'tool-started',
        level: 'info',
        visibility: 'user',
        stage: 'search',
        message: 'Searching first chat'
      }
    });
    state = aiChatReducer(state, {
      type: 'append-assistant-message',
      message: createAiMessage('assistant', 'first answer', new Date(), firstRun.id),
      event: createAiStreamEvent(firstRun, 'run-finished', { status: 'completed' }),
      status: 'completed'
    });

    const firstChat = state.session.chats.find((chat) => chat.id === firstChatId);
    const secondChat = state.session.chats.find((chat) => chat.id === secondChatId);
    expect(firstChat?.messages.map((message) => message.text)).toEqual(['first prompt', 'first answer']);
    expect(firstChat?.intermediateEvents.map((event) => event.eventId)).toEqual(['event-first-search']);
    expect(secondChat?.messages.map((message) => message.text)).toEqual(['second prompt']);
    expect(secondChat?.intermediateEvents).toEqual([]);
    expect(state.activeChatId).toBe(secondChatId);
    expect(state.activeRunId).toBe(secondRun.id);
    expect(state.isRunning).toBe(true);
    expect(state.messages.map((message) => message.text)).toEqual(['second prompt']);
  });

  it('tracks capability Undo state on the exact verified effect', () => {
    const session = createAiSession('build:alpha', 'Alpha');
    const chat = session.chats[0];
    chat.messages.push(createAiMessage('assistant', 'Applied', new Date(), 'run-undo', {
      execution: {
        goalId: 'goal-undo',
        kind: 'action',
        domain: 'mods',
        phase: 'report',
        state: 'completed',
        verifiedEffects: [{
          tool: 'local.mods.set_enabled',
          operationId: 'operation-undo',
          verification: 'native-postcondition',
          compensationToken: 'undo-token'
        }]
      }
    }));
    const state = aiChatReducer({
      activeChatId: chat.id,
      activeRunId: null,
      chats: [chat],
      draft: '',
      intermediateEvents: [],
      isCollapsed: false,
      isOpen: true,
      isRunning: false,
      messages: chat.messages,
      runs: [],
      session,
      width: 380
    }, {
      type: 'update-capability-rollback',
      compensationToken: 'undo-token',
      rollbackState: 'rolled-back'
    });

    expect(state.messages[0].execution?.verifiedEffects[0].rollbackState).toBe('rolled-back');
  });
});
