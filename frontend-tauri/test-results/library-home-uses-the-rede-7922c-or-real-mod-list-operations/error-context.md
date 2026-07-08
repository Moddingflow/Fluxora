# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: library-home.spec.ts >> uses the redesigned mods pane for real mod list operations
- Location: e2e\library-home.spec.ts:1438:5

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  getByRole('row', { name: /Core fixes separator/ })
Expected: "mixed"
Received: "none"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for getByRole('row', { name: /Core fixes separator/ })
    14 × locator resolved to <div role="row" tabindex="0" draggable="false" data-selected="true" aria-selected="true" data-separator="true" data-collapsed="true" data-dragging="false" aria-expanded="false" data-overwrite="false" data-menu-open="false" data-reorder-kind="mod" data-conflict-status="" data-order-id="sep_core" data-drop-target="false" data-in-separator="false" data-reorder-disabled="false" data-conflict-highlight="none" aria-label="Core fixes separator" class="mod-list-row mod-list-row--separator">…</div>
       - unexpected value "none"

```

```yaml
- row "Core fixes separator" [selected]:
  - cell "Expand Core fixes Core fixes 2 mods"
  - cell
```

# Test source

```ts
  1357 | 
  1358 |   const exportPayload = (await latestCallPayload(page, 'fluxPack.export')) as {
  1359 |     request?: { configPath?: string; outputPath?: string };
  1360 |   } | null;
  1361 |   expect(exportPayload?.request?.outputPath).toBe('D:\\Fluxora\\Exports\\skyrim.fluxpack');
  1362 |   expect(exportPayload?.request?.configPath).toBe('D:\\Fluxora\\Configs\\skyrim-main.json');
  1363 | 
  1364 |   await menu.waitFor({ state: 'detached' });
  1365 | });
  1366 | 
  1367 | test('installs a packaged FluxPack from the mods search-row three-dot menu', async ({ page }) => {
  1368 |   await openSkyrimBuild(page);
  1369 | 
  1370 |   await page.evaluate(() => {
  1371 |     const facade = (window as any).fluxora;
  1372 |     const calls = (window as any).__fluxoraCalls as Array<{ method: string; payload?: unknown }>;
  1373 | 
  1374 |     facade.dialogs.pickFluxPack = async (initialDirectory: any) => {
  1375 |       calls.push({ method: 'dialogs.pickFluxPack', payload: { initialDirectory } });
  1376 |       return { canceled: false, path: 'D:\\Fluxora\\Exports\\skyrim.fluxpack' };
  1377 |     };
  1378 |     facade.dialogs.pickFolder = async (title: any, initialDirectory: any) => {
  1379 |       calls.push({ method: 'dialogs.pickFolder', payload: { initialDirectory, title } });
  1380 |       return { canceled: false, path: 'D:\\Fluxora\\Builds' };
  1381 |     };
  1382 |     facade.fluxPack.install = async (request: any, operation: any) => {
  1383 |       calls.push({ method: 'fluxPack.install', payload: { operation, request } });
  1384 |       await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 120)));
  1385 |       return {
  1386 |         appliedConfigCount: 1,
  1387 |         appliedProfileOrderItemCount: 12,
  1388 |         buildName: 'Skyrim graphics overhaul',
  1389 |         configPath: 'D:\\Fluxora\\Configs\\skyrim-main.json',
  1390 |         failedSourceCount: 0,
  1391 |         hasWarnings: false,
  1392 |         installedSourceCount: 4,
  1393 |         operationId: operation?.operationId ?? 'op_fluxpack_install',
  1394 |         pendingSourceCount: 0,
  1395 |         projectDirectory: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul',
  1396 |         summary: {
  1397 |           buildName: 'Skyrim graphics overhaul',
  1398 |           customConfigCount: 1,
  1399 |           customPatchCount: 0,
  1400 |           formatVersion: 1,
  1401 |           generatedAssetCount: 2,
  1402 |           generatedAssetsIncluded: true,
  1403 |           installPlanAvailable: true,
  1404 |           installStepCount: 3,
  1405 |           manifestBytes: 2048,
  1406 |           outputPath: 'D:\\Fluxora\\Exports\\skyrim.fluxpack',
  1407 |           sourceArchiveCount: 4
  1408 |         },
  1409 |         totalSourceCount: 4
  1410 |       };
  1411 |     };
  1412 |   });
  1413 | 
  1414 |   const modsPane = page.getByRole('region', { name: 'Mods', exact: true });
  1415 |   await modsPane.getByRole('button', { name: 'Действия со сборкой' }).click();
  1416 | 
  1417 |   const menu = page.getByRole('menu', { name: 'Действия со сборкой' });
  1418 |   await expect(menu).toBeVisible();
  1419 |   const installItem = menu.getByRole('menuitem', { name: 'Установить' });
  1420 |   await expect(installItem).toBeEnabled();
  1421 |   await installItem.click();
  1422 | 
  1423 |   await expect(page.getByRole('status', { name: 'Installing FluxPack' })).toBeVisible();
  1424 |   await expect.poll(() => callMethods(page)).toContain('dialogs.pickFluxPack');
  1425 |   await expect.poll(() => callMethods(page)).toContain('dialogs.pickFolder');
  1426 |   await expect.poll(() => callMethods(page)).toContain('fluxPack.install');
  1427 | 
  1428 |   const installPayload = (await latestCallPayload(page, 'fluxPack.install')) as {
  1429 |     request?: { fluxPackPath?: string; installRootDirectory?: string };
  1430 |   } | null;
  1431 |   expect(installPayload?.request?.fluxPackPath).toBe('D:\\Fluxora\\Exports\\skyrim.fluxpack');
  1432 |   expect(installPayload?.request?.installRootDirectory).toBe('D:\\Fluxora\\Builds');
  1433 | 
  1434 |   await expect.poll(() => callMethods(page)).toContain('projects.openConfig');
  1435 |   await menu.waitFor({ state: 'detached' });
  1436 | });
  1437 | 
  1438 | test('uses the redesigned mods pane for real mod list operations', async ({ page }) => {
  1439 |   await page.goto(baseUrl);
  1440 | 
  1441 |   await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  1442 |   await page.getByRole('button', { name: 'Open', exact: true }).click();
  1443 | 
  1444 |   const modOrderTable = page.getByRole('table', { name: 'Mod order' });
  1445 |   await expect(modOrderTable).toBeVisible();
  1446 |   await expect(modOrderTable.getByRole('columnheader', { name: 'Название' })).toBeVisible();
  1447 |   await expect(modOrderTable.getByRole('columnheader', { name: 'Версия' })).toBeVisible();
  1448 |   await expect(modOrderTable.getByRole('columnheader', { name: 'Latest' })).toBeVisible();
  1449 |   await expect(modOrderTable.getByRole('columnheader', { name: 'Статус' })).toBeVisible();
  1450 |   const separatorRow = page.getByRole('row', { name: /Core fixes separator/ });
  1451 |   await expect(separatorRow).toBeVisible();
  1452 |   await expect(separatorRow).toHaveAttribute('data-conflict-highlight', 'none');
  1453 |   await expect(separatorRow).toHaveAttribute('data-conflict-status', '');
  1454 |   await expect(separatorRow.locator('.mod-separator-status .flx-status-dot')).toHaveCount(0);
  1455 |   await page.getByRole('button', { name: 'Collapse Core fixes' }).click();
  1456 |   await expect(separatorRow).toHaveAttribute('data-collapsed', 'true');
> 1457 |   await expect(separatorRow).toHaveAttribute('data-conflict-highlight', 'mixed');
       |                              ^ Error: expect(locator).toHaveAttribute(expected) failed
  1458 |   await expect(separatorRow).toHaveAttribute('data-conflict-status', 'overwrites overwritten');
  1459 |   await expect(separatorRow.locator('.mod-separator-cell .flx-status-dot')).toHaveCount(0);
  1460 |   await expect(separatorRow.locator('.mod-separator-status .flx-status-dot')).toHaveCount(2);
  1461 |   await expect
  1462 |     .poll(() => separatorRow.evaluate((row) => window.getComputedStyle(row, '::before').content))
  1463 |     .toBe('none');
  1464 |   await expect(separatorRow.getByRole('img', { name: 'Перезаписывает', exact: true })).toBeVisible();
  1465 |   await expect(separatorRow.getByRole('img', { name: 'Перезаписывается', exact: true })).toBeVisible();
  1466 |   await page.getByRole('button', { name: 'Expand Core fixes' }).click();
  1467 |   await expect(separatorRow).toHaveAttribute('data-conflict-highlight', 'none');
  1468 |   await expect(separatorRow).toHaveAttribute('data-conflict-status', '');
  1469 |   await expect(separatorRow.locator('.mod-separator-status .flx-status-dot')).toHaveCount(0);
  1470 |   await expect(page.getByRole('row', { name: /Unofficial Patch mod/ })).toBeVisible();
  1471 |   await expect(page.getByRole('img', { name: /Overwrites 4 files/ })).toBeVisible();
  1472 |   const overwriteRow = page.getByRole('row', {
  1473 |     name: /Skyrim graphics overhaul .* Output files folder overwrite folder/
  1474 |   });
  1475 |   await expect(overwriteRow).toBeVisible();
  1476 | 
  1477 |   await page.getByLabel('Disable Unofficial Patch').click({ force: true });
  1478 |   await expect
  1479 |     .poll(() =>
  1480 |       page.evaluate(() =>
  1481 |         (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
  1482 |           ?.map((call) => call.method)
  1483 |       )
  1484 |     )
  1485 |     .toContain('mods.setEnabled');
  1486 | 
  1487 |   const modRow = page.getByRole('row', { name: /Unofficial Patch mod/ });
  1488 |   await modRow.focus();
  1489 |   await page.keyboard.press('Shift+F10');
  1490 |   await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
  1491 |   await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
  1492 |   await page.getByRole('menuitem', { name: 'Open folder' }).click();
  1493 |   await expect
  1494 |     .poll(() => latestCallPayload(page, 'shell.openPath'))
  1495 |     .toMatchObject({
  1496 |       path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Unofficial Patch'
  1497 |     });
  1498 | 
  1499 |   await separatorRow.focus();
  1500 |   await page.keyboard.press('Shift+F10');
  1501 |   await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
  1502 |   await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
  1503 |   await expect(page.getByRole('menuitem', { name: 'Свернуть все' })).toBeVisible();
  1504 |   await expect(page.getByRole('menuitem', { name: 'Развернуть все' })).toBeVisible();
  1505 |   await expect(page.getByRole('menuitem', { name: 'Delete separator' })).toBeVisible();
  1506 |   await page.keyboard.press('Escape');
  1507 | 
  1508 |   await overwriteRow.focus();
  1509 |   await page.keyboard.press('Shift+F10');
  1510 |   await page.getByRole('menuitem', { name: 'Очистить папку перезаписи' }).click();
  1511 |   await expect
  1512 |     .poll(() =>
  1513 |       page.evaluate(() =>
  1514 |         (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
  1515 |           ?.map((call) => call.method)
  1516 |       )
  1517 |     )
  1518 |     .toContain('mods.clearOverwrite');
  1519 |   await expect(page.getByLabel('Очистка override')).toBeHidden();
  1520 | 
  1521 |   await overwriteRow.click();
  1522 |   await page.keyboard.press('Shift+F10');
  1523 |   await page.getByRole('menuitem', { name: 'Открыть в проводнике' }).click();
  1524 |   await expect
  1525 |     .poll(() => latestCallPayload(page, 'shell.openPath'))
  1526 |     .toMatchObject({
  1527 |       path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\overwrite'
  1528 |     });
  1529 | });
  1530 | 
  1531 | test('does not show row focus rings when Shift is pressed without Tab navigation', async ({ page }) => {
  1532 |   await openSkyrimBuild(page);
  1533 | 
  1534 |   const modRow = page.getByRole('row', { name: /Unofficial Patch mod/ });
  1535 |   await modRow.click();
  1536 |   await expect(modRow).toBeFocused();
  1537 | 
  1538 |   await page.keyboard.press('Shift');
  1539 | 
  1540 |   await expect
  1541 |     .poll(() => page.evaluate(() => document.documentElement.dataset.focusNavigation))
  1542 |     .toBeUndefined();
  1543 |   await expect.poll(async () => (await elementFocusIndicator(modRow)).hasIndicator).toBe(false);
  1544 | });
  1545 | 
  1546 | test('drags mod order rows with pointer placement feedback', async ({ page }) => {
  1547 |   await openSkyrimBuild(page);
  1548 | 
  1549 |   const source = page.getByRole('row', { name: /Unofficial Patch mod/ });
  1550 |   const target = page.getByRole('row', { name: /SkyUI mod/ });
  1551 | 
  1552 |   await dragRowToSlot(page, source, target, 'after');
  1553 |   await expect(page.getByText('Moving mod', { exact: true })).toHaveCount(0);
  1554 |   await expect(page.getByText('Loading mods', { exact: true })).toHaveCount(0);
  1555 | 
  1556 |   await expect
  1557 |     .poll(() => latestCallPayload(page, 'mods.moveOrderItem'))
```