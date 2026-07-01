import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';

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

  await page.getByLabel('Message Fluxora AI').fill(
    'cancel this run before the preview stream finishes because the user changed their mind'
  );
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(
    page.locator('.ai-chat-message[data-role="user"]').getByText('cancel this run', { exact: false })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel AI run' }).click();
  await expect(page.getByText('AI run cancelled.')).toBeVisible();

  await page.getByRole('button', { name: 'Collapse AI chat' }).click();
  await expect(page.getByRole('button', { name: 'Expand AI chat' })).toBeVisible();
  await expect(page.getByLabel('Message Fluxora AI')).toBeHidden();

  await page.getByRole('button', { name: 'Expand AI chat' }).click();
  await expect(page.getByLabel('Message Fluxora AI')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Open AI chat' }).click();
  await expect(page.getByRole('tab', { name: 'check plugins' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'fresh chat request' })).toBeVisible();
  await expect(page.getByText('AI run cancelled.')).toBeVisible();

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
