import { expect, test, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('opens the secure Fluxora Electron shell', async () => {
  const electronApp = await electron.launch({
    args: [path.join(process.cwd(), '.vite', 'build', 'main.js')],
    cwd: process.cwd()
  });

  try {
    const page = await electronApp.firstWindow();

    await expect(page.getByText('Library', { exact: true })).toBeVisible();
    const buildLibrary = page.getByLabel('Build library');
    await expect(buildLibrary).toBeVisible();
    await expect(buildLibrary.getByRole('heading', { name: 'Build library' })).toBeVisible();
    await expect(buildLibrary.getByRole('button', { name: 'New build', exact: true })).toBeVisible();
    await expect(buildLibrary.getByRole('button', { name: 'Open' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open settings', exact: true })).toBeVisible();

    const apiGroups = await page.evaluate(() => Object.keys(window.fluxora).sort());
    expect(apiGroups).toEqual([
      'app',
      'archives',
      'bridge',
      'buildPaths',
      'dialogs',
      'downloads',
      'executables',
      'fluxPack',
      'links',
      'mods',
      'nexus',
      'nxm',
      'operations',
      'plugins',
      'profiles',
      'projects',
      'security',
      'settings',
      'shell',
      'templates',
      'transfer',
      'ui',
      'windowControls'
    ]);

    const rendererNodeAccess = await page.evaluate(() => ({
      processType: typeof (window as typeof window & { process?: unknown }).process,
      requireType: typeof (window as typeof window & { require?: unknown }).require
    }));

    expect(rendererNodeAccess).toEqual({
      processType: 'undefined',
      requireType: 'undefined'
    });
  } finally {
    await electronApp.close();
  }
});

test('passes Phase 13 visual, accessibility and performance smoke gates', async ({}, testInfo) => {
  const electronApp = await electron.launch({
    args: [path.join(process.cwd(), '.vite', 'build', 'main.js')],
    cwd: process.cwd()
  });

  try {
    const page = await electronApp.firstWindow();
    const browserWindow = await electronApp.browserWindow(page);
    const sizes = [
      { name: '1280x720', width: 1280, height: 720 },
      { name: '1440x900', width: 1440, height: 900 },
      { name: '1920x1080', width: 1920, height: 1080 },
      { name: '2560x1080', width: 2560, height: 1080 }
    ];

    await expect(page.getByText('Library', { exact: true })).toBeVisible();

    const systemChecks = await page.evaluate(() => {
      const unnamedIconButtons = Array.from(document.querySelectorAll('button')).filter(
        (button) =>
          button.textContent?.trim().length === 0 &&
          !button.getAttribute('aria-label') &&
          !button.getAttribute('title')
      );
      const hasReducedMotionRule = Array.from(document.styleSheets).some((sheet) => {
        try {
          return Array.from(sheet.cssRules).some((rule) =>
            rule.cssText.includes('prefers-reduced-motion')
          );
        } catch {
          return false;
        }
      });

      return {
        unnamedIconButtonCount: unnamedIconButtons.length,
        focusVisibleSupported: CSS.supports('selector(:focus-visible)'),
        hasReducedMotionRule,
        nodeProcessType: typeof (window as typeof window & { process?: unknown }).process,
        nodeRequireType: typeof (window as typeof window & { require?: unknown }).require
      };
    });

    expect(systemChecks).toEqual({
      unnamedIconButtonCount: 0,
      focusVisibleSupported: true,
      hasReducedMotionRule: true,
      nodeProcessType: 'undefined',
      nodeRequireType: 'undefined'
    });

    const searchInput = page.getByLabel('Search builds');
    const inputStartedAt = Date.now();
    await searchInput.fill('phase13');
    await expect(searchInput).toHaveValue('phase13');
    expect(Date.now() - inputStartedAt).toBeLessThan(1000);

    for (const size of sizes) {
      await browserWindow.evaluate(
        (window, nextSize) => window.setSize(nextSize.width, nextSize.height),
        size
      );
      await page.setViewportSize({ width: size.width, height: size.height });
      await expect(page.getByText('Library', { exact: true })).toBeVisible();

      const viewportState = await page.evaluate(() => ({
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        verticalOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
        visibleShell: Boolean(document.querySelector('.desktop-shell')),
        visibleTopbar: Boolean(document.querySelector('.topbar')),
        visibleSidebar: Boolean(document.querySelector('.sidebar'))
      }));

      expect(viewportState).toEqual({
        horizontalOverflow: false,
        verticalOverflow: false,
        visibleShell: true,
        visibleTopbar: false,
        visibleSidebar: false
      });

      await page.screenshot({
        path: testInfo.outputPath(`phase13-home-${size.name}.png`),
        fullPage: false
      });
    }

    const settingsWindowPromise = electronApp.waitForEvent('window');
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    const settingsPage = await settingsWindowPromise;
    await settingsPage.waitForLoadState('domcontentloaded');
    await expect(settingsPage.getByRole('heading', { name: 'Nexus Mods', exact: true })).toBeVisible();
    await settingsPage.screenshot({
      path: testInfo.outputPath('phase13-settings-1440x900.png'),
      fullPage: false
    });
    await settingsPage.close();
  } finally {
    await electronApp.close();
  }
});

test('loads mods, plugins and downloads workspaces with search and row actions', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxora-electron-mods-'));
  const gameRoot = path.join(tempRoot, 'Skyrim Special Edition');
  const installRoot = path.join(tempRoot, 'Builds');
  const gamePath = path.join(gameRoot, 'SkyrimSE.exe');
  const projectName = `Electron Mods ${Date.now()}`;
  let configPath: string | null = null;
  let installedFluxPackConfigPath: string | null = null;

  await fs.mkdir(path.join(gameRoot, 'Data'), { recursive: true });
  await fs.writeFile(gamePath, 'MZ');
  await fs.writeFile(path.join(gameRoot, 'Data', 'Skyrim.esm'), 'TES4');
  await fs.mkdir(installRoot, { recursive: true });

  const electronApp = await electron.launch({
    args: [path.join(process.cwd(), '.vite', 'build', 'main.js')],
    cwd: process.cwd()
  });

  try {
    const page = await electronApp.firstWindow();
    const status = await page.evaluate(() =>
      window.fluxora.bridge.getStatus({ operationId: 'op_e2e_mods_status' })
    );
    test.skip(!status.ready, 'Native bridge host is unavailable for mods workspace e2e.');

    const created = await page.evaluate(
      async ({ projectName: name, gamePath: executablePath, installRootDirectory }) =>
        window.fluxora.projects.create(
          {
            projectName: name,
            templateId: 'skyrimse',
            gamePath: executablePath,
            installRootDirectory
          },
          { operationId: 'op_e2e_mods_project_create' }
        ),
      { projectName, gamePath, installRootDirectory: installRoot }
    );
    configPath = created.configPath;

    const archivePath = path.join(tempRoot, 'SkyUI Download.7z');
    await fs.writeFile(archivePath, 'archive');
    await page.evaluate(
      async ({ projectDirectory, sourcePath }) =>
        window.fluxora.downloads.importFile(projectDirectory, sourcePath, {
          operationId: 'op_e2e_downloads_import'
        }),
      { projectDirectory: created.projectDirectory, sourcePath: archivePath }
    );

    const createdMod = await page.evaluate(
      async (projectDirectory) =>
        window.fluxora.mods.createEmpty(projectDirectory, 'SkyUI Test', {
          operationId: 'op_e2e_mods_create_empty'
        }),
      created.projectDirectory
    );

    await fs.mkdir(path.join(createdMod.id, 'textures', 'armor'), { recursive: true });
    await fs.writeFile(path.join(createdMod.id, 'textures', 'armor', 'iron.dds'), 'dds');
    await fs.mkdir(path.join(createdMod.id, 'Data'), { recursive: true });
    await fs.writeFile(path.join(createdMod.id, 'Data', 'SkyUI_Test.esp'), 'TES4');

    await page.evaluate(
      async (projectDirectory) =>
        window.fluxora.mods.createSeparator(projectDirectory, 'Default', 'Visuals', 0, {
          operationId: 'op_e2e_mods_separator'
        }),
      created.projectDirectory
    );

    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByTitle('Refresh builds').click();
    const createdBuildRow = page.getByRole('option', { name: new RegExp(projectName) });
    await expect(createdBuildRow).toBeVisible();
    await createdBuildRow.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByLabel('Selected build')).toBeVisible();

    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
    const modOrder = page.getByLabel('Mod order');
    await expect(modOrder.getByText('Visuals', { exact: true })).toBeVisible();
    await expect(modOrder.getByText('SkyUI Test', { exact: true })).toBeVisible();

    await page.getByLabel('Search mods').fill('skyui');
    await expect(modOrder.getByText('SkyUI Test', { exact: true })).toBeVisible();
    await expect(modOrder.getByText('Visuals', { exact: true })).not.toBeVisible();

    await page.getByTitle('Disable mod').first().click();
    await expect
      .poll(() =>
        page.evaluate(
          async (projectDirectory) => {
            const order = await window.fluxora.mods.getOrder(projectDirectory, 'Default', {
              operationId: 'op_e2e_mods_verify_disabled'
            });
            return order.find((item) => item.name === 'SkyUI Test')?.isEnabled ?? null;
          },
          created.projectDirectory
        )
      )
      .toBe(false);

    await page.evaluate(
      async ({ projectDirectory, modPath }) =>
        window.fluxora.mods.setEnabled(projectDirectory, modPath, true, {
          operationId: 'op_e2e_mods_reenable_for_plugins'
        }),
      { projectDirectory: created.projectDirectory, modPath: createdMod.id }
    );

    await page.evaluate(
      async (projectDirectory) =>
        window.fluxora.plugins.createSeparator(
          projectDirectory,
          'skyrimse',
          'Default',
          'Late patches',
          1,
          { operationId: 'op_e2e_plugins_separator' }
        ),
      created.projectDirectory
    );

    await page.getByTitle('Refresh plugins').click();
    const pluginOrder = page.getByLabel('Plugin load order');
    await expect(pluginOrder.getByText('Late patches', { exact: true })).toBeVisible();
    await expect(pluginOrder.getByText('SkyUI_Test.esp', { exact: true })).toBeVisible();

    await page.getByLabel('Search plugins').fill('skyui');
    await expect(pluginOrder.getByText('SkyUI_Test.esp', { exact: true })).toBeVisible();
    await expect(pluginOrder.getByText('Late patches', { exact: true })).not.toBeVisible();

    await pluginOrder
      .locator('.plugin-row')
      .filter({ hasText: 'SkyUI_Test.esp' })
      .click({ button: 'right' });
    await page
      .getByRole('menu', { name: /SkyUI_Test.esp actions/ })
      .getByRole('menuitem', { name: 'Disable' })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async (projectDirectory) => {
            const plugins = await window.fluxora.plugins.list(
              projectDirectory,
              'skyrimse',
              'Default',
              { operationId: 'op_e2e_plugins_verify_disabled' }
            );
            return plugins.find((item) => item.name === 'SkyUI_Test.esp')?.isEnabled ?? null;
          },
          created.projectDirectory
        )
      )
      .toBe(false);

    await page.getByRole('tab', { name: /Downloads/ }).click();
    const downloadsTable = page.getByRole('table', { name: 'Downloads' });
    await expect(downloadsTable.getByText('SkyUI Download', { exact: true })).toBeVisible();
    await expect(downloadsTable.getByText('Ready to install', { exact: true })).toBeVisible();

    await downloadsTable
      .locator('.download-row')
      .filter({ hasText: 'SkyUI Download' })
      .click({ button: 'right' });
    await expect(
      page
        .getByRole('menu', { name: /SkyUI Download actions/ })
        .getByRole('menuitem', { name: 'Install' })
    ).toBeVisible();

    await page.getByLabel('Search downloads').fill('not-present');
    await expect(page.getByText('No matching downloads')).toBeVisible();

    const profileSelect = page.getByLabel('Profile');
    await expect(profileSelect).toBeVisible();
    await expect(profileSelect).toHaveValue('Default');

    await page.evaluate(
      async ({ configPath: buildConfigPath, executablePath }) =>
        window.fluxora.executables.save(
          buildConfigPath,
          [
            {
              id: 'fake-tool',
              displayName: 'Fake Tool',
              executablePath,
              arguments: '-test',
              workingDirectory: '',
              iconPath: ''
            }
          ],
          { operationId: 'op_e2e_executables_seed' }
        ),
      { configPath, executablePath: gamePath }
    );

    await page.getByTitle('Refresh build workspace').click();
    const executableSelect = page.getByLabel('Executable');
    await expect(executableSelect).toContainText('Fake Tool');
    await executableSelect.selectOption('fake-tool');

    const launchAvailable = await page.evaluate(async () => {
      const status = await window.fluxora.bridge.getStatus({
        operationId: 'op_e2e_executables_launch_capability'
      });
      return status.capabilities?.features.executableLaunch?.state === 'available';
    });
    if (launchAvailable) {
      await page.getByRole('button', { name: 'Launch', exact: true }).click();
      await expect(page.getByText(/Launched|Failed to launch executable/)).toBeVisible({
        timeout: 10000
      });
    } else {
      await expect(page.getByRole('button', { name: 'Launch', exact: true })).toBeDisabled();
    }

    const workspace = page.getByLabel('Selected build');
    await expect(workspace.getByRole('heading', { name: projectName }).first()).toBeVisible();
    await workspace.getByRole('button', { name: 'Paths', exact: true }).click();
    await expect(page.getByLabel('Build path settings')).toBeVisible();
    const updatedDownloadsDirectory = path.join(created.projectDirectory, 'custom-downloads');
    await page.getByLabel('Downloads directory').fill(updatedDownloadsDirectory);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Build paths saved.')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          async (buildConfigPath) => {
            const paths = await window.fluxora.buildPaths.get(buildConfigPath, {
              operationId: 'op_e2e_build_paths_verify'
            });
            return paths.downloadsDirectory;
          },
          created.configPath
        )
      )
      .toBe(updatedDownloadsDirectory);

    const fluxPackPath = path.join(tempRoot, `${projectName}.fluxpack`);
    const fluxPackInstallRoot = path.join(tempRoot, 'FluxPackInstalled');
    await fs.mkdir(fluxPackInstallRoot, { recursive: true });
    const fluxPack = await page.evaluate(
      async ({ buildConfigPath, outputPath, installRootDirectory }) => {
        const exported = await window.fluxora.fluxPack.export(
          {
            configPath: buildConfigPath,
            outputPath,
            includeGeneratedAssets: false
          },
          { operationId: 'op_e2e_fluxpack_export' }
        );
        const inspected = await window.fluxora.fluxPack.inspect(outputPath, {
          operationId: 'op_e2e_fluxpack_inspect'
        });
        const progressEvents: unknown[] = [];
        const unsubscribe = window.fluxora.operations.onProgress((progress) => {
          if (progress.operationId === 'op_e2e_fluxpack_install') {
            progressEvents.push(progress);
          }
        });
        try {
          const installed = await window.fluxora.fluxPack.install(
            {
              fluxPackPath: outputPath,
              installRootDirectory
            },
            { operationId: 'op_e2e_fluxpack_install' }
          );
          return { exported, inspected, installed, progressEventCount: progressEvents.length };
        } finally {
          unsubscribe();
        }
      },
      { buildConfigPath: configPath, outputPath: fluxPackPath, installRootDirectory: fluxPackInstallRoot }
    );
    installedFluxPackConfigPath = fluxPack.installed.configPath;
    expect(fluxPack.exported.buildName).toBeTruthy();
    expect(fluxPack.inspected.buildName).toBe(fluxPack.exported.buildName);
    expect(fluxPack.installed.projectDirectory).toBeTruthy();
    expect(fluxPack.progressEventCount).toBeGreaterThan(0);

    const settingsWindowPromise = electronApp.waitForEvent('window');
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    const settingsPage = await settingsWindowPromise;
    await settingsPage.waitForLoadState('domcontentloaded');
    await expect(settingsPage.getByLabel('Nexus Mods settings')).toBeVisible();
    await settingsPage.getByRole('button', { name: /Language/ }).click();
    await expect(settingsPage.getByLabel('Language settings')).toBeVisible();
    await expect(settingsPage.getByRole('combobox', { name: 'Language' })).toBeVisible();
    await settingsPage.getByRole('button', { name: /Кастомизация/ }).click();
    await expect(settingsPage.getByLabel('Customization settings')).toBeVisible();
    await expect(settingsPage.getByRole('combobox', { name: 'Theme' })).toBeVisible();
    await settingsPage.getByRole('button', { name: /Перенос/ }).click();
    await expect(settingsPage.getByLabel('Mod Organizer transfer settings')).toBeVisible();
    const settingsClosed = settingsPage.waitForEvent('close');
    await settingsPage.getByRole('button', { name: /Перенести/ }).click();
    await settingsClosed;
    await expect(page.getByLabel('Перенос сборки')).toBeVisible();
    await expect(page.getByText('Выберите папку Mod Organizer 2')).toBeVisible();
  } finally {
    if (installedFluxPackConfigPath) {
      try {
        const [page] = electronApp.windows();
        await page?.evaluate((pathToConfig) =>
          window.fluxora.projects.delete(pathToConfig, {
            operationId: 'op_e2e_fluxpack_project_delete'
          }),
        installedFluxPackConfigPath);
      } catch {
        // Best-effort cleanup; the temp folder below is still removed.
      }
    }

    if (configPath) {
      try {
        const [page] = electronApp.windows();
        await page?.evaluate((pathToConfig) =>
          window.fluxora.projects.delete(pathToConfig, {
            operationId: 'op_e2e_mods_project_delete'
          }),
        configPath);
      } catch {
        // Best-effort cleanup; the temp folder below is still removed.
      }
    }

    await electronApp.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
