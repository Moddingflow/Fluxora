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

test('keeps secondary window titles responsive with only the custom close control', async ({
  page
}) => {
  const modName =
    'Security Overhaul SKSE - Extra Locks - 11 New Locks - Complete Edition With Compatibility Patch';

  await page.setViewportSize({ width: 520, height: 700 });
  await page.goto(`${baseUrl}/?window=mod-details&name=${encodeURIComponent(modName)}`);

  const titlebar = page.getByLabel('Fluxora settings window chrome');
  const title = titlebar.locator('.titlebar__brand-name');
  const closeButton = titlebar.getByLabel('Close');

  await expect(title).toHaveText(modName);
  await expect(title).toHaveAttribute('title', modName);
  await expect(title).toHaveCSS('overflow', 'hidden');
  await expect(title).toHaveCSS('text-overflow', 'ellipsis');
  await expect(title).toHaveCSS('white-space', 'nowrap');
  await expect(titlebar.getByLabel('Minimize')).toHaveCount(0);
  await expect(titlebar.getByLabel('Maximize')).toHaveCount(0);
  await expect(closeButton.locator('.titlebar__custom-close-icon')).toBeVisible();

  const narrowTitleWidth = await title.evaluate((element) => element.clientWidth);
  expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

  await closeButton.hover();
  expect(await closeButton.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    'rgb(196, 43, 28)'
  );

  await page.setViewportSize({ width: 1200, height: 700 });
  await expect.poll(() => title.evaluate((element) => element.clientWidth)).toBeGreaterThan(narrowTitleWidth);
  expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('renders preloaded mod files and conflicts without loading placeholders', async ({ page }) => {
  const bootstrapKey = 'playwright-ready-mod-details';
  const modPath = 'D:\\Fluxora\\Builds\\Foundation Edition\\mods\\Sprint Fix';
  await page.addInitScript(
    ({ key, path }) => {
      (window as typeof window & { __FLUXORA_MOD_DETAILS_BOOTSTRAP__?: unknown })
        .__FLUXORA_MOD_DETAILS_BOOTSTRAP__ = {
        key,
        projectId: 'foundation-edition',
        projectName: 'Foundation Edition',
        projectDirectory: 'D:\\Fluxora\\Builds\\Foundation Edition',
        configPath: 'D:\\Fluxora\\Configs\\foundation-edition.json',
        profileName: 'Default',
        modPath: path,
        item: {
          id: path,
          orderId: 'mod_sprint_fix',
          kind: 'mod',
          order: 1,
          isSeparator: false,
          isMod: true,
          modUuid: 'sprint-fix',
          separatorTitle: '',
          name: 'Sprint Fix',
          version: '1.0',
          latestVersion: '1.0',
          lastCheckedAt: '',
          updateStatus: '',
          conflictStatus: '',
          fileCount: 2,
          conflictingFileCount: 1,
          overwrittenFileCount: 0,
          overwritingFileCount: 1,
          isEnabled: true,
          canCheckUpdates: false,
          hasUpdate: false,
          sourceIsNexus: false,
          sourceIsModdingFlow: false,
          isLocal: true,
          isTranslation: false,
          isPatch: false,
          overwritesModIds: [],
          overwrittenByModIds: []
        },
        rootFileTree: [],
        content: {
          modPath: path,
          directories: [
            {
              relativePath: '',
              entries: [
                {
                  name: 'SKSE',
                  relativePath: 'SKSE',
                  isDirectory: true,
                  hasChildren: true,
                  size: 0,
                  conflictState: '',
                  conflictOwners: []
                }
              ]
            },
            {
              relativePath: 'SKSE',
              entries: [
                {
                  name: 'SprintFix.dll',
                  relativePath: 'SKSE/SprintFix.dll',
                  isDirectory: false,
                  hasChildren: false,
                  size: 128,
                  conflictState: 'overwrites',
                  conflictOwners: ['Sprint Fix', 'Old Sprint Fix']
                }
              ]
            }
          ],
          conflictTree: {
            modPath: path,
            totalOverwrites: 1,
            totalOverwritten: 0,
            limit: 1,
            nextCursor: null,
            overwrites: [
              {
                name: 'SprintFix.dll',
                relativePath: 'SKSE/SprintFix.dll',
                isDirectory: false,
                hasChildren: false,
                size: 128,
                conflictState: 'overwrites',
                conflictOwners: ['Sprint Fix', 'Old Sprint Fix']
              }
            ],
            overwritten: []
          }
        },
        createdAt: Date.now()
      };
    },
    { key: bootstrapKey, path: modPath }
  );

  await page.goto(
    `${baseUrl}/?window=mod-details&project=foundation-edition&mod=${encodeURIComponent(modPath)}&name=Sprint%20Fix&profile=Default&bootstrap=${bootstrapKey}`
  );

  const tree = page.getByRole('tree', { name: 'Mod file tree' });
  await expect(tree).toBeVisible();
  await expect(page.getByText('Loading tree', { exact: true })).toHaveCount(0);
  await tree.getByTitle('Open SKSE').click();
  await expect(tree.getByText('SprintFix.dll', { exact: true })).toBeVisible();
  await expect(tree.getByText('Loading', { exact: true })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Конфликты' }).click();
  await expect(page.getByText('Scanning files', { exact: true })).toHaveCount(0);
  await expect(page.getByText('SKSE/SprintFix.dll', { exact: true })).toBeVisible();
  await expect(page.getByText('Sprint Fix · Old Sprint Fix', { exact: true })).toBeVisible();
});
