import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test, type Locator, type Page } from '@playwright/test';

const distRoot = path.resolve(__dirname, '..', 'dist');
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  for (const entry of ['setup/setup.html', 'updater/updater.html']) {
    if (!existsSync(path.join(distRoot, entry))) {
      throw new Error(`Missing installer renderer build: dist/${entry}`);
    }
  }
  server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const targetPath = path.resolve(
      distRoot,
      `.${decodeURIComponent(requestUrl.pathname)}`
    );
    if (
      !targetPath.startsWith(distRoot)
      || !existsSync(targetPath)
      || statSync(targetPath).isDirectory()
    ) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(targetPath)] ?? 'application/octet-stream'
    });
    createReadStream(targetPath).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

type SetupLanguage = 'en' | 'de' | 'ru';

const setupCopy = {
  en: {
    languageTitle: 'Choose your language',
    languageName: 'English',
    terms: 'I accept the Terms of Use',
    privacy: 'I confirm that I have read the Privacy Policy',
    continue: 'Continue',
    install: 'Install',
    success: 'Fluxora is ready',
    updateTitle: 'Updating Fluxora',
    upToDate: 'The latest version is installed.',
    commitLocked: 'The commit has started. Setup must remain open until recovery is safe.'
  },
  de: {
    languageTitle: 'Sprache auswählen',
    languageName: 'Deutsch',
    terms: 'Ich akzeptiere die Nutzungsbedingungen',
    privacy: 'Ich bestätige, dass ich die Datenschutzerklärung gelesen habe',
    continue: 'Weiter',
    install: 'Installieren',
    success: 'Fluxora ist bereit',
    updateTitle: 'Fluxora wird aktualisiert',
    upToDate: 'Die neueste Version ist installiert.',
    commitLocked: 'Die Übernahme hat begonnen. Das Installationsprogramm muss geöffnet bleiben, bis eine sichere Wiederherstellung gewährleistet ist.'
  },
  ru: {
    languageTitle: 'Выберите язык',
    languageName: 'Русский',
    terms: 'Я принимаю Условия использования',
    privacy: 'Я подтверждаю, что прочитал(а) Политику конфиденциальности',
    continue: 'Продолжить',
    install: 'Установить',
    success: 'Fluxora готова',
    updateTitle: 'Обновление Fluxora',
    upToDate: 'Установлена последняя версия.',
    commitLocked: 'Началось применение изменений. Не закрывайте установщик, пока безопасное восстановление не будет гарантировано.'
  }
} as const;

async function installSetupMock(
  page: Page,
  language: SetupLanguage,
  outcome: 'success' | 'failure' = 'success',
  postScenario: 'no-update' | 'update-found' | 'network-error' | 'launch-failure' | 'manual-downgrade' = 'no-update'
) {
  await page.addInitScript(({ language: setupLanguage, outcome: setupOutcome, postScenario: scenario }) => {
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: setupLanguage === 'de'
        ? 'de-DE'
        : setupLanguage === 'ru'
          ? 'ru-RU'
          : 'en-US'
    });
    let progressListener:
      | ((progress: Record<string, unknown>) => void)
      | undefined;
    let closeListener:
      | ((notice: { reasonKey: string }) => void)
      | undefined;
    let postUpdateListener:
      | ((progress: Record<string, unknown>) => void)
      | undefined;
    let postUpdateCommitted = false;
    const installDirectory =
      'C:\\Users\\Owner\\AppData\\Local\\Programs\\Fluxora';
    (window as any).__setupCalls = [];
    (window as any).fluxora = Object.freeze({
      setup: Object.freeze({
        getBootstrapState: async () => ({
          schemaVersion: 1,
          language: setupLanguage,
          defaultInstallDirectory: installDirectory,
          mode: scenario === 'manual-downgrade' ? 'downgrade' : 'repair',
          installedVersion: '2.4.0',
          requiredBytes: 250_000_000,
          freeBytes: 8_000_000_000,
          isOwnedInstall: true,
          payloadBytes: 220_000_000,
          webview2Version: '140.0.0.0',
          nativeAvailable: true
        }),
        pickInstallFolder: async () => installDirectory,
        validateInstallPath: async () => ({
          schemaVersion: 1,
          status: 'valid',
          code: 'setup.path.valid',
          messageKey: 'setup.location.valid',
          normalizedInstallDirectory: installDirectory,
          requiredBytes: 250_000_000,
          freeBytes: 8_000_000_000,
          mode: scenario === 'manual-downgrade' ? 'downgrade' : 'repair'
        }),
        startInstall: async (options: Record<string, unknown>) => {
          (window as any).__setupCalls.push({ method: 'startInstall', options });
          const operationId = String(options.operationId);
          setTimeout(() => progressListener?.({
            operationId,
            phase: 'copying',
            copiedBytes: 40,
            totalBytes: 100,
            percent: 40,
            statusKey: 'setup.progress.copying',
            currentItem: 'bin/Fluxora.exe',
            canCancel: true
          }), 10);
          setTimeout(() => progressListener?.({
            operationId,
            phase: 'committing',
            copiedBytes: 90,
            totalBytes: 100,
            percent: 90,
            statusKey: 'setup.progress.committing',
            currentItem: 'bin/Fluxora.exe',
            canCancel: false
          }), 60);
          await new Promise((resolve) => setTimeout(resolve, 140));
          if (setupOutcome === 'failure') {
            throw {
              code: 'setup.atomicCommitFailed',
              messageKey: 'setup.error.generic',
              retryable: true
            };
          }
          return {
            schemaVersion: 1,
            operationId,
            outcome: 'succeeded',
            installDirectory,
            applicationPath: `${installDirectory}\\Fluxora.exe`,
            installedVersion: '2.5.0',
            createdDesktopShortcut: Boolean(options.createDesktopShortcut)
          };
        },
        cancelInstall: async () => ({ accepted: true }),
        startPostInstallUpdate: async (operationId: string) => {
          (window as any).__setupCalls.push({ method: 'startPostInstallUpdate', operationId });
          const emit = (
            state: string,
            extras: Record<string, unknown> = {}
          ) => postUpdateListener?.({
            schemaVersion: 1,
            operationId,
            state,
            phase: state,
            currentVersion: '2.5.0',
            downloadedBytes: 0,
            totalBytes: 0,
            canCancel: !['up-to-date', 'handoff-committed', 'launching-bundled', 'launch-error'].includes(state),
            ...extras
          });
          if (scenario === 'manual-downgrade') {
            emit('launching-bundled', { canCancel: false });
            (window as any).__setupCalls.push({ method: 'bundledLaunch', operationId });
            return {
              schemaVersion: 1,
              operationId,
              outcome: 'bundled-launched'
            };
          }
          setTimeout(() => emit('checking'), 5);
          if (scenario === 'update-found') {
            setTimeout(() => emit('update-available', {
              targetVersion: '2.6.0',
              totalBytes: 200
            }), 20);
            setTimeout(() => emit('downloading', {
              targetVersion: '2.6.0',
              downloadedBytes: 100,
              totalBytes: 200,
              percent: 50
            }), 40);
            setTimeout(() => {
              postUpdateCommitted = true;
              emit('handoff-committed', {
                targetVersion: '2.6.0',
                downloadedBytes: 200,
                totalBytes: 200,
                percent: 100,
                canCancel: false
              });
              (window as any).__setupCalls.push({ method: 'updaterHandoff', operationId });
            }, 250);
            return new Promise(() => undefined);
          }
          if (scenario === 'network-error') {
            setTimeout(() => emit('error', { canCancel: false }), 20);
            setTimeout(() => {
              emit('launching-bundled', { canCancel: false });
              (window as any).__setupCalls.push({ method: 'bundledLaunch', operationId });
            }, 40);
            return new Promise(() => undefined);
          }
          if (scenario === 'launch-failure') {
            await new Promise((resolve) => setTimeout(resolve, 30));
            emit('launch-error', { canCancel: false });
            return {
              schemaVersion: 1,
              operationId,
              outcome: 'launch-failed',
              error: {
                code: 'setup-bundled-launch-failed',
                messageKey: 'setup.update.launchError',
                retryable: true
              }
            };
          }
          setTimeout(() => {
            emit('up-to-date', { canCancel: false });
            (window as any).__setupCalls.push({ method: 'bundledLaunch', operationId });
          }, 250);
          return new Promise(() => undefined);
        },
        cancelPostInstallUpdate: async (operationId: string) => {
          if (postUpdateCommitted) {
            return { accepted: false, reasonKey: 'setup.update.cancel.handoffCommitted' };
          }
          postUpdateListener?.({
            schemaVersion: 1,
            operationId,
            state: 'cancelled',
            phase: 'cancelled',
            currentVersion: '2.5.0',
            downloadedBytes: 0,
            totalBytes: 0,
            canCancel: false
          });
          (window as any).__setupCalls.push({ method: 'cancelPostInstallUpdate', operationId });
          return { accepted: true };
        },
        launchApp: async () => ({ completed: true }),
        openInstalledFolder: async () => ({ completed: true }),
        revealLogs: async () => ({ completed: true }),
        minimizeWindow: async () => ({ completed: true }),
        requestClose: async () => {
          if (postUpdateCommitted) {
            closeListener?.({ reasonKey: 'setup.closeBlockedAfterCommit' });
            return { completed: false, reasonKey: 'setup.closeBlockedAfterCommit' };
          }
          return { completed: true };
        },
        onProgress: async (
          listener: (progress: Record<string, unknown>) => void
        ) => {
          progressListener = listener;
          return () => {
            progressListener = undefined;
          };
        },
        onPostInstallUpdateProgress: async (
          listener: (progress: Record<string, unknown>) => void
        ) => {
          postUpdateListener = listener;
          return () => {
            postUpdateListener = undefined;
          };
        },
        onCloseBlocked: async (
          listener: (notice: { reasonKey: string }) => void
        ) => {
          closeListener = listener;
          return () => {
            closeListener = undefined;
          };
        }
      })
    });
  }, { language, outcome, postScenario });
}

async function reachLocation(
  page: Page,
  language: SetupLanguage,
  legalScreenshotPath?: string
) {
  const copy = setupCopy[language];
  await expect(page.getByRole('heading', { name: copy.languageTitle })).toBeVisible();
  const languageOption = page.getByRole('option', { name: copy.languageName });
  await expect(languageOption).toHaveAttribute('aria-selected', 'true');
  await languageOption.click();
  await page.getByRole('button', { name: copy.continue }).click();
  if (legalScreenshotPath) {
    await page.screenshot({ animations: 'disabled', path: legalScreenshotPath });
  }

  const continueButton = page.getByRole('button', { name: copy.continue });
  await expect(continueButton).toBeDisabled();
  const terms = page.getByLabel(copy.terms);
  await terms.focus();
  await terms.press('Space');
  await expect(terms).toBeChecked();
  await expect(continueButton).toBeDisabled();
  const privacy = page.getByLabel(copy.privacy);
  await privacy.focus();
  await privacy.press('Space');
  await expect(privacy).toBeChecked();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByRole('button', { name: copy.install })).toBeEnabled();
}

async function tabTo(
  page: Page,
  target: Locator,
  maximumTabs = 32
): Promise<void> {
  for (let index = 0; index < maximumTabs; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
  }
  throw new Error(`Target was not reachable within ${maximumTabs} Tab presses.`);
}

for (const language of ['en', 'de', 'ru'] as const) {
  test(`Setup completes the ${language.toUpperCase()} legal/location/install flow`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 640 });
    await installSetupMock(page, language);
    await page.goto(`${baseUrl}/setup/setup.html`);

    await expect(page.locator('html')).toHaveAttribute('lang', language);
    const railBox = await page.locator('.setup-rail').boundingBox();
    const contentBox = await page.locator('.setup-content').boundingBox();
    expect(railBox).not.toBeNull();
    expect(contentBox).not.toBeNull();
    expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(contentBox!.x);
    const stepBoxes = await page.locator('.setup-steps > li').evaluateAll((steps) =>
      steps.map((step) => {
        const box = step.getBoundingClientRect();
        return { left: box.left, right: box.right };
      })
    );
    expect(stepBoxes).toHaveLength(6);
    expect(stepBoxes.every((box) => box.right <= contentBox!.x)).toBe(true);
    await expect(page.locator('.installer-titlebar select')).toHaveCount(0);
    if (language === 'en') {
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('setup-language-900x640.png')
      });
      await page.setViewportSize({ width: 760, height: 560 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
        )
      ).toBe(true);
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('setup-language-760x560.png')
      });
      await page.setViewportSize({ width: 900, height: 640 });
    }
    await reachLocation(
      page,
      language,
      language === 'en' ? testInfo.outputPath('setup-legal-900x640.png') : undefined
    );
    if (language === 'en') {
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('setup-location-900x640.png')
      });
    }
    await expect(page.getByText(/repair|repar|восстанов/iu)).toBeVisible();
    await page.getByRole('button', { name: setupCopy[language].install }).click();
    await expect(page.getByText('bin/Fluxora.exe')).toBeVisible();
    await expect(page.getByText(setupCopy[language].commitLocked)).toBeVisible();
    if (language === 'en') {
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('setup-installation-900x640.png')
      });
    }
    await expect(
      page.getByRole('button', {
        name: /Cancel|Abbrechen|Отменить/u
      })
    ).toHaveCount(0);
    await expect(page.getByRole('heading', {
      name: setupCopy[language].updateTitle
    })).toBeVisible();
    await expect(page.getByText(setupCopy[language].upToDate)).toBeVisible();
    const options = await page.evaluate(() => (window as any).__setupCalls[0].options);
    expect(options).toMatchObject({
      createDesktopShortcut: true,
      language,
      termsAccepted: true,
      privacyAcknowledged: true
    });

    if (language === 'en') {
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('setup-update-900x640.png')
      });
      await page.setViewportSize({ width: 760, height: 560 });
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('setup-update-760x560.png')
      });
    }
  });
}

test('Setup applies a newly selected language before legal review', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await installSetupMock(page, 'en');
  await page.goto(`${baseUrl}/setup/setup.html`);

  await page.getByRole('option', { name: setupCopy.ru.languageName }).click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { name: setupCopy.ru.languageTitle })).toBeVisible();
  await expect(page.locator('.setup-steps > li').first()).toContainText('Язык');
  await page.getByRole('button', { name: setupCopy.ru.continue }).click();
  await expect(page.getByLabel(setupCopy.ru.terms)).toBeVisible();
});

test('Setup presents an owned downgrade and launches it without updater handoff', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await installSetupMock(page, 'ru', 'success', 'manual-downgrade');
  await page.goto(`${baseUrl}/setup/setup.html`);
  await reachLocation(page, 'ru');

  await expect(page.getByText('Откат существующей установки')).toBeVisible();
  await page.getByRole('button', { name: setupCopy.ru.install }).click();
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__setupCalls.some((call: any) => call.method === 'bundledLaunch')
  )).toBe(true);
  expect(await page.evaluate(() =>
    (window as any).__setupCalls.some((call: any) => call.method === 'updaterHandoff')
  )).toBe(false);
});

test('Setup exposes a stable native error code without a stack trace', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await installSetupMock(page, 'en', 'failure');
  await page.goto(`${baseUrl}/setup/setup.html`);
  await reachLocation(page, 'en');
  await page.getByRole('button', { name: 'Install' }).click();
  await expect(page.getByRole('alert')).toContainText('setup.atomicCommitFailed');
  await expect(page.locator('body')).not.toContainText('stacktrace');
});

test('Setup rail navigates between completed steps without unlocking the current frontier', async ({
  page
}) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await installSetupMock(page, 'en');
  await page.goto(`${baseUrl}/setup/setup.html`);
  await reachLocation(page, 'en');

  const languageStep = page.getByRole('button', { name: 'Language', exact: true });
  const legalStep = page.getByRole('button', { name: 'Legal', exact: true });
  const locationStep = page.getByRole('button', { name: 'Location', exact: true });

  await expect(languageStep).toBeVisible();
  await expect(legalStep).toBeVisible();
  await expect(locationStep).toHaveCount(0);

  await languageStep.click();
  await expect(page.getByRole('heading', { name: setupCopy.en.languageTitle })).toBeVisible();
  await expect(legalStep).toBeVisible();
  await expect(locationStep).toHaveCount(0);

  await legalStep.click();
  await expect(page.getByLabel(setupCopy.en.terms)).toBeVisible();
  await expect(locationStep).toHaveCount(0);
});

test('Setup completes a bounded keyboard-only legal and install flow', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await installSetupMock(page, 'en');
  await page.goto(`${baseUrl}/setup/setup.html`);

  const languageOption = page.getByRole('option', { name: setupCopy.en.languageName });
  await tabTo(page, languageOption);
  await page.keyboard.press('Enter');
  const languageContinue = page.getByRole('button', { name: setupCopy.en.continue });
  await tabTo(page, languageContinue);
  await page.keyboard.press('Enter');

  const terms = page.getByLabel(setupCopy.en.terms);
  await tabTo(page, terms);
  await page.keyboard.press('Space');
  await expect(terms).toBeChecked();

  const privacy = page.getByLabel(setupCopy.en.privacy);
  await tabTo(page, privacy);
  await page.keyboard.press('Space');
  await expect(privacy).toBeChecked();

  const continueButton = page.getByRole('button', { name: setupCopy.en.continue });
  await tabTo(page, continueButton);
  await page.keyboard.press('Enter');

  const installButton = page.getByRole('button', { name: setupCopy.en.install });
  await expect(installButton).toBeEnabled();
  await tabTo(page, installButton);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: setupCopy.en.updateTitle })).toBeVisible();
});

test('Setup shows determinate full download and blocks close after setup handoff commit', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await installSetupMock(page, 'en', 'success', 'update-found');
  await page.goto(`${baseUrl}/setup/setup.html`);
  await reachLocation(page, 'en');
  await page.getByRole('button', { name: 'Install' }).click();

  await expect(page.getByText('2.5.0')).toBeVisible();
  await expect(page.getByText('2.6.0')).toBeVisible();
  await expect(page.locator('.installer-progress-panel__status')).toContainText('50%');
  await expect(page.locator('.installer-progress-panel__status')).toContainText('0 MB / 0 MB');
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__setupCalls.some((call: any) => call.method === 'updaterHandoff')
  )).toBe(true);
  await expect(page.getByRole('button', { name: 'Cancel update' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText(/cannot close after the commit boundary/iu)).toBeVisible();
});

test('Setup falls back to the bundled installation after update discovery failure', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 560 });
  await installSetupMock(page, 'en', 'success', 'network-error');
  await page.goto(`${baseUrl}/setup/setup.html`);
  await reachLocation(page, 'en');
  await page.getByRole('button', { name: 'Install' }).click();

  await expect(page.getByText('Starting the installed version…')).toBeVisible();
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__setupCalls.some((call: any) => call.method === 'bundledLaunch')
  )).toBe(true);
  await expect(page.getByRole('button', { name: /Skip/iu })).toHaveCount(0);
});

test('Setup exposes the existing launch fallback only after automatic launch failure', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await installSetupMock(page, 'en', 'success', 'launch-failure');
  await page.goto(`${baseUrl}/setup/setup.html`);
  await reachLocation(page, 'en');
  await page.getByRole('button', { name: 'Install' }).click();

  await expect(page.getByRole('alert')).toContainText('setup-bundled-launch-failed');
  await expect(page.getByRole('button', { name: 'Launch Fluxora' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open logs' })).toBeVisible();
});

test('Setup cancellation wins safely before post-install handoff', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await installSetupMock(page, 'en');
  await page.goto(`${baseUrl}/setup/setup.html`);
  await reachLocation(page, 'en');
  await page.getByRole('button', { name: 'Install' }).click();

  const cancel = page.getByRole('button', { name: 'Cancel update' });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__setupCalls.some((call: any) => call.method === 'cancelPostInstallUpdate')
  )).toBe(true);
  await expect(page.getByRole('button', { name: 'Cancel update' })).toHaveCount(0);
});

test('Setup preserves layout and focus at 200% scale with reduced motion and forced colors', async ({
  browser
}, testInfo) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    forcedColors: 'active',
    reducedMotion: 'reduce',
    viewport: { width: 900, height: 640 }
  });
  try {
    const page = await context.newPage();
    await installSetupMock(page, 'en');
    await page.goto(`${baseUrl}/setup/setup.html`);

    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
    expect(
      await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
    ).toBe(true);
    expect(
      await page.evaluate(() => matchMedia('(forced-colors: active)').matches)
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    ).toBe(true);

    const languageOption = page.getByRole('option', { name: setupCopy.en.languageName });
    await tabTo(page, languageOption);
    await expect(languageOption).toBeFocused();
    const focusIndicator = await languageOption.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        boxShadow: style.boxShadow,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth
      };
    });
    expect(
      focusIndicator.outlineStyle !== 'none'
      || focusIndicator.outlineWidth !== '0px'
      || focusIndicator.boxShadow !== 'none'
    ).toBe(true);

    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('setup-forced-colors-900x640-2x.png')
    });
  } finally {
    await context.close();
  }
});

async function installUpdaterMock(
  page: Page,
  outcome: 'succeeded' | 'rolled-back' | 'failed'
) {
  await page.addInitScript(({ terminalOutcome }) => {
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: 'en-US'
    });
    let progressListener:
      | ((progress: Record<string, unknown>) => void)
      | undefined;
    const operationId = 'update-operation';
    (window as any).fluxora = Object.freeze({
      updater: Object.freeze({
        getRequestSummary: async () => ({
          schemaVersion: 1,
          operationId,
          currentVersion: '2.4.0',
          targetVersion: '2.5.0',
          assetKind: 'delta',
          presentation: 'compact',
          language: 'en'
        }),
        rendererReady: async () => ({ completed: true }),
        startUpdate: async () => {
          setTimeout(() => progressListener?.({
            schemaVersion: 1,
            operationId,
            phase: 'installing',
            copiedBytes: 70,
            totalBytes: 100,
            percent: 70,
            statusKey: 'updater.status.installing',
            currentItem: 'bin/Fluxora.exe',
            canCancel: false
          }), 10);
          await new Promise((resolve) => setTimeout(resolve, 300));
          if (terminalOutcome === 'failed') {
            throw {
              code: 'updater.signatureInvalid',
              messageKey: 'updater.error.generic',
              retryable: false
            };
          }
          return {
            schemaVersion: 1,
            operationId,
            outcome: terminalOutcome,
            targetVersion: '2.5.0'
          };
        },
        minimizeWindow: async () => ({ completed: true }),
        requestClose: async () => ({ completed: true }),
        onProgress: async (
          listener: (progress: Record<string, unknown>) => void
        ) => {
          progressListener = listener;
          return () => {
            progressListener = undefined;
          };
        },
        onCloseBlocked: async () => () => undefined
      })
    });
  }, { terminalOutcome: outcome });
}

for (const outcome of ['succeeded', 'rolled-back', 'failed'] as const) {
  test(`Updater renders ${outcome} terminal state`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 620, height: 360 });
    await installUpdaterMock(page, outcome);
    await page.goto(`${baseUrl}/updater/updater.html`);
    await expect(page.getByText('Updating 2.4.0 to 2.5.0')).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(2);
    await expect(page.getByText('bin/Fluxora.exe')).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('updater-progress-620x360.png')
    });

    if (outcome === 'succeeded') {
      await expect(page.getByText('Fluxora was updated successfully.')).toBeVisible();
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('updater-success-620x360.png')
      });
    } else if (outcome === 'rolled-back') {
      await expect(page.getByText('The previous version was restored safely.')).toBeVisible();
    } else {
      await expect(page.getByRole('alert')).toContainText('The update request could not be completed.');
      await expect(page.getByRole('alert')).not.toContainText('updater.signatureInvalid');
    }
  });
}
