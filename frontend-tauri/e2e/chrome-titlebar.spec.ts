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

test('shows redesigned titlebar chrome without Node exposure', async ({ page }) => {
  await page.goto(baseUrl);

  const titlebar = page.getByLabel('Fluxora window chrome');
  await expect(titlebar).toBeVisible();
  await expect(titlebar).toHaveCSS('height', '32px');
  await expect(titlebar.getByText('Fluxora', { exact: true })).toBeVisible();

  await expect(page.getByLabel('Home')).toBeVisible();
  await expect(page.getByLabel('Refresh')).toBeVisible();
  await expect(page.getByLabel('Open settings')).toBeVisible();
  await expect(page.getByLabel('Minimize')).toBeVisible();
  await expect(page.getByLabel('Maximize')).toBeVisible();
  await expect(page.getByLabel('Close')).toBeVisible();

  const nodeExposure = await page.evaluate(() => ({
    childProcess: typeof (window as typeof window & { child_process?: unknown }).child_process,
    process: typeof (window as typeof window & { process?: unknown }).process,
    require: typeof (window as typeof window & { require?: unknown }).require
  }));

  expect(nodeExposure).toEqual({
    childProcess: 'undefined',
    process: 'undefined',
    require: 'undefined'
  });
});
