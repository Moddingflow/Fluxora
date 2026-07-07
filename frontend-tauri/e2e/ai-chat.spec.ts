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

const serveDist = async () => {
  server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const requestPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const targetPath = path.resolve(distRoot, `.${decodeURIComponent(requestPath)}`);

    if (!targetPath.startsWith(distRoot) || !existsSync(targetPath) || statSync(targetPath).isDirectory()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(targetPath)] ?? 'application/octet-stream'
    });
    createReadStream(targetPath).pipe(response);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
};

test.beforeAll(async () => {
  await serveDist();
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

const installMockAiHost = async (page: Page) => {
  await page.evaluate(() => {
    type AiHostStubWindow = Window & {
      __fluxoraAiHostCalls?: string[];
      __resolveFluxoraAiChatRespond?: () => void;
    };

    const stubWindow = window as unknown as AiHostStubWindow;
    const fluxora = (window as unknown as { fluxora: { ai: Record<string, unknown> } }).fluxora;
    const baseAi = fluxora.ai;
    const calls: string[] = [];
    const runListeners = new Set<(event: Record<string, unknown>) => void>();

    const operationIdOf = (request: unknown, fallback: string): string => {
      if (request && typeof request === 'object' && 'operationId' in request) {
        const operationId = (request as { operationId?: unknown }).operationId;
        if (typeof operationId === 'string' && operationId.trim()) {
          return operationId;
        }
      }

      return fallback;
    };

    const contextUsageFor = (request: Record<string, unknown>) => {
      const operationId = operationIdOf(request, 'ai_context_estimate');

      return {
        schema: 'fluxora.ai.context-usage.v1',
        operationId,
        providerId: 'mock-provider',
        modelId: 'mock-model',
        contextWindowTokens: 8192,
        currentContextTokens: 12,
        currentContextPercent: 0.15,
        precision: 'estimated',
        level: 'normal',
        mode: 'full',
        includedSections: ['e2e-mock'],
        autoCompressionApplied: false,
        actionRequired: false,
        countedAt: new Date().toISOString()
      };
    };

    const emitRunEvent = (request: Record<string, unknown>, message: string) => {
      const runId = typeof request.runId === 'string' ? request.runId : 'run-e2e';
      const operationId = operationIdOf(request, 'ai_chat_run');
      const event = {
        schema: 'fluxora.ai.intermediate-event.v1',
        eventId: `e2e-${Date.now()}`,
        runId,
        operationId,
        seq: 20,
        createdAt: new Date().toISOString(),
        type: 'progress',
        level: 'info',
        visibility: 'user',
        stage: 'mock-host',
        message,
        percent: 35,
        payload: {
          kind: 'e2e-ai-host',
          data: {
            prompt: 'Привет'
          }
        }
      };

      runListeners.forEach((listener) => listener(event));
    };

    const createChatResponse = (request: Record<string, unknown>) => {
      const operationId = operationIdOf(request, 'ai_chat_run');
      const text = 'Привет! Mock AI host answered.';

      return {
        operationId,
        providerId: 'mock-provider',
        modelId: 'mock-model',
        routingPreset: 'free-demo',
        status: 'done',
        text,
        streamChunks: [{ index: 0, text }],
        sources: [],
        fallbackProviders: [],
        contextUsage: contextUsageFor(request)
      };
    };

    stubWindow.__fluxoraAiHostCalls = calls;
    fluxora.ai = {
      ...baseAi,
      cancelRun: async (operationId: string) => {
        calls.push('ai.cancelRun');
        return {
          operationId,
          status: 'accepted',
          accepted: true
        };
      },
      chatRespond: (request: Record<string, unknown>) => {
        calls.push('ai.chatRespond');
        emitRunEvent(request, 'Mock AI host accepted Привет.');

        return new Promise((resolve) => {
          stubWindow.__resolveFluxoraAiChatRespond = () => {
            stubWindow.__resolveFluxoraAiChatRespond = undefined;
            resolve(createChatResponse(request));
          };
        });
      },
      estimateContext: async (request: Record<string, unknown>) => {
        calls.push('ai.estimateContext');
        return contextUsageFor(request);
      },
      getStatus: async (request?: Record<string, unknown>) => {
        calls.push('ai.getStatus');
        const operationId = operationIdOf(request, 'ai_status');

        return {
          ready: true,
          operationId,
          health: 'ready',
          protocolVersion: '1.0',
          hostVersion: 'e2e-mock',
          processId: 0,
          providers: [
            {
              id: 'mock-provider',
              displayName: 'Mock provider',
              kind: 'hosted',
              requiresCredential: false,
              credentialStore: 'none',
              credentialState: 'notRequired',
              connected: true,
              defaultModelId: 'mock-model',
              supportedRunModes: ['offline'],
              networkAdapters: 'disabled',
              dataDisclosure: 'Playwright e2e host stub'
            }
          ],
          models: [
            {
              id: 'mock-model',
              providerId: 'mock-provider',
              displayName: 'Mock model',
              contextWindowTokens: 8192,
              supportsTools: false,
              supportsWeb: false,
              supportsStreaming: true,
              supportsBackground: false,
              priceMetadata: {
                currency: 'USD',
                inputPerMillionTokens: null,
                outputPerMillionTokens: null,
                cacheReadPerMillionTokens: null,
                cacheWritePerMillionTokens: null,
                source: 'e2e-mock',
                isEstimated: true,
                remoteConfigurable: false
              }
            }
          ],
          capabilities: {}
        };
      },
      onRunEvent: (callback: (event: Record<string, unknown>) => void) => {
        calls.push('ai.onRunEvent');
        runListeners.add(callback);
        return () => {
          runListeners.delete(callback);
        };
      }
    };
  });
};

test('submits a host-backed AI chat prompt and leaves the waiting progress state', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => localStorage.clear());
  await installMockAiHost(page);

  await page.getByRole('button', { name: 'Open AI chat' }).click();
  await expect(page.getByLabel('Fluxora AI chat')).toBeVisible();
  await expect(page.getByLabel('Message Fluxora AI')).toBeEnabled();

  await page.getByLabel('Message Fluxora AI').fill('Привет');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.locator('.ai-chat-message[data-role="user"]').getByText('Привет')).toBeVisible();
  const progress = page.locator('.ai-chat-progress');
  await expect(progress).toContainText('Mock AI host accepted Привет.');
  await expect(page.getByText(/Waiting for AI host progress/)).toHaveCount(0);

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __fluxoraAiHostCalls?: string[] }).__fluxoraAiHostCalls ?? []
      )
    )
    .toEqual(expect.arrayContaining(['ai.getStatus', 'ai.onRunEvent', 'ai.estimateContext', 'ai.chatRespond']));

  await page.evaluate(() => {
    (window as typeof window & { __resolveFluxoraAiChatRespond?: () => void })
      .__resolveFluxoraAiChatRespond?.();
  });

  await expect(
    page.locator('.ai-chat-message[data-role="assistant"]').getByText('Привет! Mock AI host answered.')
  ).toBeVisible();
  await expect(progress).toHaveCount(0);
  await expect(page.getByText(/Waiting for AI host progress/)).toHaveCount(0);
});

test('opens, collapses, cancels and restores the local AI chat shell', async ({ page }) => {
  await page.goto(baseUrl);
  await page.evaluate(() => localStorage.clear());

  await page.getByRole('button', { name: 'Open AI chat' }).click();
  await expect(page.getByLabel('Fluxora AI chat')).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize AI chat' })).toBeVisible();
  await expect(page.getByText('No messages')).toBeVisible();

  await page.getByLabel('Message Fluxora AI').fill('check plugins');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(
    page.locator('.ai-chat-message[data-role="user"]').getByText('check plugins')
  ).toBeVisible();
  await expect(page.getByText('Plan: review "check plugins"', { exact: false })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'check plugins' })).toBeVisible();

  await page.getByRole('button', { name: 'New AI chat' }).click();
  await expect(page.getByText('No messages')).toBeVisible();
  await expect(page.getByText('Plan: review "check plugins"', { exact: false })).toHaveCount(0);

  await page.getByLabel('Message Fluxora AI').fill('fresh chat request');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('tab', { name: 'fresh chat request' })).toBeVisible();
  await expect(page.getByText('Plan: review "fresh chat request"', { exact: false })).toBeVisible();

  await page.getByRole('tab', { name: 'check plugins' }).click();
  await expect(page.getByText('Plan: review "check plugins"', { exact: false })).toBeVisible();
  await expect(page.getByText('Plan: review "fresh chat request"', { exact: false })).toHaveCount(0);

  await page.getByRole('tab', { name: 'fresh chat request' }).click();
  await expect(page.getByText('Plan: review "fresh chat request"', { exact: false })).toBeVisible();

  await installMockAiHost(page);
  await page.getByLabel('Message Fluxora AI').fill(
    'cancel this run before the preview stream finishes because the user changed their mind'
  );
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(
    page.locator('.ai-chat-message[data-role="user"]').getByText('cancel this run', { exact: false })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Stop AI run' }).click();
  await expect(page.getByText('Остановлено')).toBeVisible();

  await page.getByRole('button', { name: 'Collapse AI chat' }).click();
  await expect(page.getByRole('button', { name: 'Expand AI chat' })).toBeVisible();
  await expect(page.getByLabel('Message Fluxora AI')).toBeHidden();

  await page.getByRole('button', { name: 'Expand AI chat' }).click();
  await expect(page.getByLabel('Message Fluxora AI')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Open AI chat' }).click();
  await expect(page.getByRole('tab', { name: 'check plugins' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'fresh chat request' })).toBeVisible();
  await expect(page.getByText('Остановлено')).toBeVisible();

  const freshChatTab = page.getByRole('tab', { name: 'fresh chat request' });
  const closeFreshChat = page.getByRole('button', { name: 'Close fresh chat request' });
  const closeFreshChatIcon = closeFreshChat.locator('img.ai-chat-tab__close-icon');
  await expect(closeFreshChat).toHaveCSS('opacity', '0');
  await expect(closeFreshChatIcon).toHaveAttribute('src', /(data:image\/svg\+xml|\.svg)/);
  await expect(closeFreshChatIcon).toHaveJSProperty('complete', true);
  await freshChatTab.hover();
  await expect(closeFreshChat).toHaveCSS('opacity', '1');
  await closeFreshChat.click();

  await expect(page.getByRole('tab', { name: 'fresh chat request' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'check plugins' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByText('Plan: review "check plugins"', { exact: false })).toBeVisible();
});
