import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AiChatPanel } from '../src/renderer/features/ai/AiChatPanel';
import { createAiMessage, createAiSession, initialAiChatState } from '../src/renderer/features/ai/ai-chat-state';

describe('single-agent panel', () => {
  it('uses named body grid areas with the input as the final track', () => {
    const styles = fs.readFileSync(
      new URL('../src/renderer/styles.css', import.meta.url),
      'utf8'
    );

    expect(styles).toContain('grid-template-areas:');
    expect(styles).toContain('"tabs"');
    expect(styles).toContain('"context"');
    expect(styles).toContain('"quota"');
    expect(styles).toContain('"diagnostic"');
    expect(styles).toContain('"messages"');
    expect(styles).toContain('"input"');
    expect(styles).toContain('.ai-chat-input {\n  grid-area: input;');
    expect(styles).toContain('--ai-chat-panel-width: 616px;');
    expect(styles).toContain('--ai-chat-panel-collapsed-width: 56px;');
    expect(styles).toContain('padding: 12px 16px 16px;');
    expect(styles).toContain('border-top: 0;');
    expect(styles).not.toContain('.ai-chat-panel__resize');
  });

  it('shows agent limits as an accessible usage rail and clearly separates BYOK', () => {
    const session = createAiSession('build:alpha', 'Alpha');
    const chat = session.chats[0];
    const state = { ...initialAiChatState, activeChatId: chat.id, chats: [chat], messages: [], session };
    const noop = () => undefined;
    const common = {
      hostReady: true,
      state,
      onCancel: noop,
      onClose: noop,
      onCloseChat: noop,
      onConnectAccount: noop,
      onCreateAccount: noop,
      onCreateChat: noop,
      onDraftChange: noop,
      onOpenSource: noop,
      onOpenFileChange: noop,
      onRollbackFileRun: noop,
      onUndoCapability: noop,
      onSend: noop,
      onSelectChat: noop,
      onToggleCollapse: noop
    };
    const managed = renderToStaticMarkup(createElement(AiChatPanel, {
      ...common,
      language: 'en-US',
      quota: {
        schema: 'fluxora.ai.quota.v1',
        availability: 'available',
        available: true,
        eligibility: true,
        reason: 'eligible',
        periodStart: '2026-07-01T00:00:00.000Z',
        resetAt: '2026-08-01T00:00:00.000Z',
        rollover: false,
        limit: 1_000_000,
        used: 250_000,
        reserved: 0,
        remaining: 750_000,
        remainingInputTokenEquivalent: 100_000,
        search: { limit: 24, used: 6, reserved: 0, remaining: 18 },
        model: 'gemini-3.1-flash-lite',
        priceVersion: '2026-07'
      }
    }));
    expect(managed).toContain('Agent limit');
    expect(managed).toContain('75% remaining');
    expect(managed).toContain('role="progressbar"');
    expect(managed).toContain('aria-label="Agent limit, 75% remaining"');
    expect(managed).toContain('aria-valuenow="75"');
    expect(managed).toContain('Search <strong>18 / 24</strong>');
    expect(managed).toContain('dateTime="2026-08-01T00:00:00.000Z"');

    const byok = renderToStaticMarkup(createElement(AiChatPanel, {
      ...common,
      language: 'de-DE',
      quota: {
        schema: 'fluxora.ai.quota.v1',
        availability: 'byok',
        available: true,
        eligibility: true,
        reason: 'byok_user_paid',
        periodStart: null,
        resetAt: null,
        rollover: false,
        limit: 0,
        used: 0,
        reserved: 0,
        remaining: 0,
        remainingInputTokenEquivalent: 0,
        search: { limit: 0, used: 0, reserved: 0, remaining: 0 },
        model: 'gemini-3.1-flash-lite',
        priceVersion: null
      }
    }));
    expect(byok).toContain('Eigener Schlüssel');
    expect(byok).toContain('Fluxora-Kontingent bleibt unberührt.');
  });

  it('replaces the agent workspace with a ModdingFlow sign-in gate when the gateway requires OAuth', () => {
    const session = createAiSession('build:alpha', 'Alpha');
    const chat = session.chats[0];
    const state = { ...initialAiChatState, activeChatId: chat.id, chats: [chat], messages: [], session };
    const noop = () => undefined;
    const html = renderToStaticMarkup(createElement(AiChatPanel, {
      hostReady: true,
      language: 'ru-RU',
      quota: {
        schema: 'fluxora.ai.quota.v1',
        availability: 'connectionRequired',
        available: false,
        eligibility: false,
        reason: 'ai_oauth_invalid',
        periodStart: null,
        resetAt: null,
        rollover: false,
        limit: 0,
        used: 0,
        reserved: 0,
        remaining: 0,
        remainingInputTokenEquivalent: 0,
        search: { limit: 0, used: 0, reserved: 0, remaining: 0 },
        model: 'gemini-3.1-flash-lite',
        priceVersion: null
      },
      state,
      onCancel: noop,
      onClose: noop,
      onCloseChat: noop,
      onConnectAccount: noop,
      onCreateAccount: noop,
      onCreateChat: noop,
      onDraftChange: noop,
      onOpenSource: noop,
      onOpenFileChange: noop,
      onRollbackFileRun: noop,
      onUndoCapability: noop,
      onSend: noop,
      onSelectChat: noop,
      onToggleCollapse: noop
    }));

    expect(html).toContain('Войдите в ModdingFlow');
    expect(html).toContain('Аккаунт нужен, чтобы безопасно подтвердить Premium');
    expect(html).toContain('>Войти<');
    expect(html).toContain('Нет аккаунта?');
    expect(html).toContain('>Создать аккаунт<');
    expect(html).toContain('<img');
    expect(html).not.toContain('Message Fluxora AI');
    expect(html).not.toContain('Agent usage limits');
  });

  it('shows exact context usage, sources and undo without model/routing/subagent UI', () => {
    const session = createAiSession('build:alpha', 'Alpha');
    const chat = session.chats[0];
    chat.contextUsage = {
      schema: 'fluxora.ai.context-usage.v2',
      operationId: 'operation-1',
      providerId: 'gemini',
      modelId: 'gemini-3.1-flash-lite',
      contextWindowTokens: 1_048_576,
      modelInputTokenLimit: 1_048_576,
      modelOutputTokenLimit: 65_536,
      currentContextTokens: 2_107,
      currentContextPercent: 0.2,
      precision: 'exact',
      level: 'normal',
      mode: 'full',
      includedSections: ['messages'],
      autoCompressionApplied: false,
      actionRequired: false,
      countedAt: new Date().toISOString()
    };
    chat.messages.push(createAiMessage('assistant', 'Verified answer', new Date(), 'run-1', {
      error: {
        code: 'ai.provider.invalid-tool-request',
        category: 'validation',
        stage: 'tool-schema',
        retryable: false,
        userMessage: 'Gemini rejected the Fluxora file-tool declaration.',
        debugId: 'ai-debug-1'
      },
      sources: [{ id: 'source-1', title: 'Google result', url: 'https://example.com' }],
      execution: {
        goalId: 'goal-1',
        kind: 'action',
        mode: 'repair',
        origin: 'explicit',
        requestedOutcome: 'Apply and verify the requested Fluxora change.',
        domain: 'mods',
        phase: 'report',
        state: 'completed',
        verifiedEffects: [{
          tool: 'local.mods.set_enabled',
          operationId: 'operation-1',
          verification: 'native-postcondition',
          compensationToken: 'undo-mod-1'
        }]
      },
      fileChangeSet: {
        schema: 'fluxora.ai.file-change-set.v1',
        operationId: 'operation-1',
        runId: 'run-1',
        chatId: chat.id,
        rollbackState: 'available',
        files: [{
          fileRef: 'file-1', scope: 'build', relativePath: 'SKSE/Plugins/test.ini', status: 'applied',
          hunks: [], addedLines: 1, removedLines: 1, validation: 'valid', verification: 'reread verified',
          beforeVersion: 'a', afterVersion: 'b', rollbackState: 'available'
        }]
      }
    }));
    const state = { ...initialAiChatState, activeChatId: chat.id, chats: [chat], messages: chat.messages, session };
    const noop = () => undefined;
    const html = renderToStaticMarkup(createElement(AiChatPanel, {
      hostReady: true,
      state,
      onCancel: noop,
      onClose: noop,
      onCloseChat: noop,
      onConnectAccount: noop,
      onCreateAccount: noop,
      onCreateChat: noop,
      onDraftChange: noop,
      onOpenSource: noop,
      onOpenFileChange: noop,
      onRollbackFileRun: noop,
      onUndoCapability: noop,
      onSend: noop,
      onSelectChat: noop,
      onToggleCollapse: noop
    }));

    expect(html).toContain('Использовано контекста:');
    expect(html).toContain('1 048 576');
    expect(html).toContain('Google result');
    expect(html).toContain('Undo');
    expect(html).toContain('mods.set_enabled');
    expect(html).toContain('Native postcondition verified');
    expect(html).toContain('ai-file-change__added');
    expect(html).toContain('ai-file-change__removed');
    expect(html).not.toContain('Undo run');
    expect(html).not.toContain('>You<');
    expect(html).not.toContain('>Gemini<');
    expect(html).not.toContain('<time');
    expect(html).not.toContain('ai.provider.invalid-tool-request');
    expect(html).not.toContain('tool-schema');
    expect(html).not.toContain('ai-debug-1');
    expect(html).not.toMatch(/Routing preset|Subagent|Model selector/);
    expect(html).toContain('aria-label="Start voice input"');
    expect(html).toContain('data:image/svg+xml');

    const developerHtml = renderToStaticMarkup(createElement(AiChatPanel, {
      hostReady: true,
      showDeveloperDiagnostics: true,
      state,
      onCancel: noop,
      onClose: noop,
      onCloseChat: noop,
      onConnectAccount: noop,
      onCreateAccount: noop,
      onCreateChat: noop,
      onDraftChange: noop,
      onOpenSource: noop,
      onOpenFileChange: noop,
      onRollbackFileRun: noop,
      onUndoCapability: noop,
      onSend: noop,
      onSelectChat: noop,
      onToggleCollapse: noop
    }));
    expect(developerHtml).toContain('ai.provider.invalid-tool-request');
    expect(developerHtml).toContain('tool-schema');
    expect(developerHtml).toContain('ai-debug-1');
  });

  it('shows needs-input as waiting and keeps the ordinary chat field available', () => {
    const session = createAiSession('build:alpha', 'Alpha');
    const chat = session.chats[0];
    chat.activeGoal = {
      goalId: 'goal-waiting',
      mode: 'repair',
      origin: 'implicit',
      requestedOutcome: 'Reduce the loud music.',
      pendingQuestion: 'Combat or ambient track?'
    };
    chat.messages.push(createAiMessage('assistant', 'Combat or ambient track?', new Date(), 'run-waiting', {
      agentStatus: 'needs-input',
      execution: {
        goalId: 'goal-waiting',
        kind: 'action',
        mode: 'repair',
        origin: 'implicit',
        requestedOutcome: 'Reduce the loud music.',
        domain: 'files',
        phase: 'inspect',
        state: 'needs-input',
        verifiedEffects: [],
        pendingQuestion: 'Combat or ambient track?'
      }
    }));
    const state = {
      ...initialAiChatState,
      activeChatId: chat.id,
      chats: [chat],
      draft: 'the first one',
      messages: chat.messages,
      session
    };
    const noop = () => undefined;
    const html = renderToStaticMarkup(createElement(AiChatPanel, {
      hostReady: true,
      state,
      onCancel: noop,
      onClose: noop,
      onCloseChat: noop,
      onConnectAccount: noop,
      onCreateAccount: noop,
      onCreateChat: noop,
      onDraftChange: noop,
      onOpenSource: noop,
      onOpenFileChange: noop,
      onRollbackFileRun: noop,
      onUndoCapability: noop,
      onSend: noop,
      onSelectChat: noop,
      onToggleCollapse: noop
    }));

    expect(html).toContain('data-status="needs-input"');
    expect(html).toContain('Waiting for your answer');
    expect(html).toContain('>the first one</textarea>');
    expect(html).not.toContain('aria-label="Message Fluxora AI" disabled=""');
  });

  it('renders one run-level Undo and no per-file rollback control', () => {
    const session = createAiSession('build:alpha', 'Alpha');
    const chat = session.chats[0];
    chat.messages.push(createAiMessage('assistant', 'Applied two files', new Date(), 'run-files', {
      fileChangeSet: {
        schema: 'fluxora.ai.file-change-set.v1',
        operationId: 'operation-files',
        runId: 'run-files',
        chatId: chat.id,
        rollbackState: 'available',
        files: ['first.ini', 'second.ini'].map((relativePath, index) => ({
          fileRef: `file-${index}`,
          scope: 'build' as const,
          relativePath,
          status: 'applied' as const,
          hunks: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-old', '+new'] }],
          addedLines: index + 1,
          removedLines: 1,
          validation: 'valid' as const,
          verification: 'reread verified',
          beforeVersion: 'before',
          afterVersion: 'after',
          rollbackState: 'available' as const
        }))
      }
    }));
    const state = {
      ...initialAiChatState,
      activeChatId: chat.id,
      chats: [chat],
      messages: chat.messages,
      session
    };
    const noop = () => undefined;
    const html = renderToStaticMarkup(createElement(AiChatPanel, {
      hostReady: true,
      state,
      onCancel: noop,
      onClose: noop,
      onCloseChat: noop,
      onConnectAccount: noop,
      onCreateAccount: noop,
      onCreateChat: noop,
      onDraftChange: noop,
      onOpenSource: noop,
      onOpenFileChange: noop,
      onRollbackFileRun: noop,
      onUndoCapability: noop,
      onSend: noop,
      onSelectChat: noop,
      onToggleCollapse: noop
    }));

    expect(html.match(/Undo<\/button>/g)).toHaveLength(1);
    expect(html.match(/class="ai-file-change"/g)).toHaveLength(2);
    expect(html).not.toContain('Undo run');
    expect(html).not.toContain('onRollbackFile');
  });
});
