# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: library-home.spec.ts >> uses the redesigned right pane tabs for plugins, data and downloads
- Location: e2e\library-home.spec.ts:1630:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByLabel('Right pane').locator('.plugin-type-badge').filter({ hasText: 'master' }).first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByLabel('Right pane').locator('.plugin-type-badge').filter({ hasText: 'master' }).first()

```

```yaml
- main:
  - text: Fluxora
  - navigation "Window shortcuts":
    - button "Home"
    - button "Refresh"
    - button "Open settings"
    - button "Open AI chat"
  - button "Minimize"
  - button "Maximize"
  - button "Close"
  - region "Selected build":
    - region "Build header":
      - button "Back"
      - heading "Skyrim graphics overhaul" [level=2]
      - text: Skyrim Special Edition
      - button "Build settings"
      - text: Profile
      - combobox "Profile":
        - strong: Default
      - text: Executable
      - combobox "Executable":
        - strong: SKSE
      - button "Launch"
    - region "Mod Organizer style workspace":
      - region "Mods":
        - heading "Моды" [level=3]
        - text: 2 of 2 enabled · 3 visible
        - textbox "Search mods"
        - button "Действия со сборкой"
        - table "Mod order":
          - row "Название Версия Latest Статус":
            - columnheader "Название"
            - columnheader "Версия"
            - columnheader "Latest"
            - columnheader "Статус"
          - rowgroup:
            - row "Core fixes separator" [expanded]:
              - cell "Collapse Core fixes Core fixes 2 mods":
                - button "Collapse Core fixes" [expanded]
                - strong: Core fixes
                - text: 2 mods
              - cell
            - row "Unofficial Patch mod Перезаписывает" [selected]:
              - cell "Disable Unofficial Patch Unofficial Patch Nexus Mods":
                - checkbox "Disable Unofficial Patch" [checked]
                - strong: Unofficial Patch
                - text: Nexus Mods
              - cell "4.3.8"
              - cell "4.3.8"
              - cell "Overwrites 4 files from earlier mods":
                - img "Overwrites 4 files from earlier mods"
            - row "SkyUI mod Перезаписывает · Перезаписывается":
              - cell "Disable SkyUI SkyUI Nexus Mods":
                - checkbox "Disable SkyUI" [checked]
                - strong: SkyUI
                - text: Nexus Mods
              - cell "5.2.0"
              - cell "5.3.1"
              - cell "Overwrites 1 files and is overwritten on 2 files":
                - img "Overwrites 1 files and is overwritten on 2 files"
            - row "Skyrim graphics overhaul · Output files folder overwrite folder":
              - cell "Skyrim graphics overhaul · Output files folder D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\overwrite Overwrite output folder":
                - strong: Skyrim graphics overhaul · Output files folder
                - text: D:\Fluxora\Builds\Skyrim graphics overhaul\overwrite
                - img "Overwrite output folder"
      - region "Right pane":
        - heading "Плагины" [level=3]
        - tablist "Right pane tabs":
          - tab "Плагины" [selected]
          - tab "Данные 42":
            - text: Данные
            - strong: "42"
          - tab "Загрузки 3":
            - text: Загрузки
            - strong: "3"
        - tabpanel "Плагины":
          - textbox "Search plugins"
          - button "Skyrim plugin slot information":
            - tooltip "Кол-во плагинов (включенных) 2 Кол-во лёгких плагинов 0 / 4096 Кол-во тяжёлых плагинов 2 / 256":
              - text: Кол-во плагинов (включенных)
              - strong: "2"
              - text: Кол-во лёгких плагинов
              - strong: 0 / 4096
              - text: Кол-во тяжёлых плагинов
              - strong: 2 / 256
          - table "Plugin load order":
            - row "Order Plugin Статус":
              - columnheader "Order"
              - columnheader "Plugin"
              - columnheader "Статус"
            - row "Skyrim.esm plugin" [selected]:
              - cell "00"
              - cell "Disable Skyrim.esm Skyrim.esm Skyrim Special Edition":
                - checkbox "Disable Skyrim.esm" [checked] [disabled]
                - strong: Skyrim.esm
                - text: Skyrim Special Edition
              - cell
            - row "Late patches separator" [expanded]:
              - cell "Collapse Late patches":
                - button "Collapse Late patches" [expanded]
              - cell "Late patches 1 plugin":
                - strong: Late patches
                - text: 1 plugin
              - cell
            - row "SkyUI.esp plugin missing masters":
              - cell "02"
              - cell "Disable SkyUI.esp SkyUI.esp SkyUI":
                - checkbox "Disable SkyUI.esp" [checked]
                - strong: SkyUI.esp
                - text: SkyUI
              - 'cell "Отсутствуют мастер-файлы у SkyUI.esp: Aardvark.esm, Update.esm, Zed.esm"':
                - 'button "Отсутствуют мастер-файлы у SkyUI.esp: Aardvark.esm, Update.esm, Zed.esm"'
```

# Test source

```ts
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
  1558 |     .toMatchObject({
  1559 |       orderId: 'mod_ussep',
  1560 |       targetIndex: 2
  1561 |     });
  1562 | });
  1563 | 
  1564 | test('keeps downloads rows visible during delayed refresh', async ({ page }) => {
  1565 |   await page.goto(baseUrl);
  1566 | 
  1567 |   await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  1568 |   await page.getByRole('button', { name: 'Open', exact: true }).click();
  1569 | 
  1570 |   const rightPane = page.getByLabel('Right pane');
  1571 |   await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  1572 |   await expect(rightPane.getByRole('row', { name: /SkyUI/ })).toBeVisible();
  1573 | 
  1574 |   await page.evaluate(() => {
  1575 |     (window as typeof window & { __fluxoraDownloadsListDelayMs?: number }).__fluxoraDownloadsListDelayMs =
  1576 |       900;
  1577 |   });
  1578 |   await rightPane.getByRole('button', { name: 'Refresh downloads' }).click();
  1579 |   const skeletonTable = rightPane.locator('.download-table--skeleton');
  1580 |   await expect(skeletonTable).toHaveCount(0);
  1581 |   await expect(rightPane.getByText('Loading downloads', { exact: true })).toHaveCount(0);
  1582 |   await expect(rightPane.getByRole('row', { name: /SkyUI/ })).toBeVisible();
  1583 | });
  1584 | 
  1585 | test('does not flash a stale downloads drop cue when returning to the downloads tab', async ({ page }) => {
  1586 |   await openSkyrimBuild(page);
  1587 | 
  1588 |   const rightPane = page.getByLabel('Right pane');
  1589 |   await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  1590 | 
  1591 |   const dropSurface = rightPane.locator('.download-drop-surface');
  1592 |   const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  1593 |   await dropSurface.dispatchEvent('dragenter', { dataTransfer });
  1594 |   await dataTransfer.dispose();
  1595 |   await expect(dropSurface).toHaveAttribute('data-drop-state', 'hover');
  1596 | 
  1597 |   await rightPane.getByRole('tab', { name: /Данные/ }).click();
  1598 |   await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  1599 | 
  1600 |   expect(await rightPaneTransientSnapshot(page)).toMatchObject({
  1601 |     downloadDropCueCount: 0,
  1602 |     downloadDropState: 'idle'
  1603 |   });
  1604 | });
  1605 | 
  1606 | test('clears plugin row drop indicators before switching right pane tabs', async ({ page }) => {
  1607 |   await openSkyrimBuild(page);
  1608 | 
  1609 |   const rightPane = page.getByLabel('Right pane');
  1610 |   const source = page.getByRole('row', { name: /SkyUI\.esp plugin/ });
  1611 |   const target = page.getByRole('row', { name: /Skyrim\.esm plugin/ });
  1612 | 
  1613 |   await moveRowDragToSlot(page, source, target, 'after');
  1614 |   await rightPane.getByRole('tab', { name: /Загрузки/ }).evaluate((element) => {
  1615 |     (element as HTMLElement).click();
  1616 |   });
  1617 |   await rightPane.getByRole('tab', { name: /Плагины/ }).evaluate((element) => {
  1618 |     (element as HTMLElement).click();
  1619 |   });
  1620 | 
  1621 |   const snapshot = await rightPaneTransientSnapshot(page);
  1622 |   await page.mouse.up();
  1623 | 
  1624 |   expect(snapshot).toMatchObject({
  1625 |     pluginLoadingCount: 0,
  1626 |     rowDropTargetCount: 0
  1627 |   });
  1628 | });
  1629 | 
  1630 | test('uses the redesigned right pane tabs for plugins, data and downloads', async ({ page }) => {
  1631 |   await page.goto(baseUrl);
  1632 | 
  1633 |   await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  1634 |   await page.getByRole('button', { name: 'Open', exact: true }).click();
  1635 | 
  1636 |   const rightPane = page.getByLabel('Right pane');
  1637 |   await expect(rightPane.getByRole('tab', { name: /Плагины/ })).toBeVisible();
  1638 |   await expect(rightPane.getByRole('tab', { name: /Данные/ })).toBeVisible();
  1639 |   await expect(rightPane.getByRole('tab', { name: /Загрузки/ })).toBeVisible();
  1640 |   await expect(rightPane.getByRole('tab', { name: /Сборка/ })).toHaveCount(0);
  1641 | 
  1642 |   const pluginsTable = page.getByRole('table', { name: 'Plugin load order' });
  1643 |   await expect(pluginsTable).toBeVisible();
  1644 |   await expect(pluginsTable.getByRole('columnheader', { name: 'State' })).toHaveCount(0);
  1645 |   await expect(pluginsTable.getByRole('columnheader', { name: 'Статус' })).toBeVisible();
  1646 |   await expect(page.getByRole('row', { name: /Skyrim.esm/ })).toBeVisible();
  1647 |   await expect(rightPane.getByText('00')).toBeVisible();
> 1648 |   await expect(rightPane.locator('.plugin-type-badge', { hasText: 'master' }).first()).toBeVisible();
       |                                                                                        ^ Error: expect(locator).toBeVisible() failed
  1649 | 
  1650 |   const pluginSeparatorRow = page.getByRole('row', { name: /Late patches separator/ });
  1651 |   await pluginSeparatorRow.focus();
  1652 |   await page.keyboard.press('Shift+F10');
  1653 |   await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
  1654 |   await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
  1655 |   await expect(page.getByRole('menuitem', { name: 'Свернуть все' })).toBeVisible();
  1656 |   await expect(page.getByRole('menuitem', { name: 'Развернуть все' })).toBeVisible();
  1657 |   await expect(page.getByRole('menuitem', { name: 'Delete separator' })).toBeVisible();
  1658 |   await page.keyboard.press('Escape');
  1659 | 
  1660 |   await page.getByRole('button', { name: 'Collapse Late patches' }).click();
  1661 |   await expect(pluginSeparatorRow).toHaveAttribute('data-collapsed', 'true');
  1662 |   await expect(pluginSeparatorRow).toHaveAttribute('data-missing-masters', 'true');
  1663 |   const separatorWarning = pluginSeparatorRow.getByRole('button', {
  1664 |     name: /Отсутствуют мастер-файлы/
  1665 |   });
  1666 |   await expect(separatorWarning).toBeVisible();
  1667 |   await separatorWarning.hover();
  1668 |   await expect(page.getByRole('tooltip')).toContainText('Aardvark.esm');
  1669 |   await page.getByRole('button', { name: 'Expand Late patches' }).click();
  1670 |   await expect(pluginSeparatorRow).toHaveAttribute('data-missing-masters', 'false');
  1671 | 
  1672 |   const pluginRow = page.getByRole('row', { name: /SkyUI\.esp/ });
  1673 |   const warning = pluginRow.getByRole('button', { name: /Отсутствуют мастер-файлы/ });
  1674 |   await expect(warning).toBeVisible();
  1675 |   await warning.hover();
  1676 |   const tooltip = page.getByRole('tooltip');
  1677 |   await expect(tooltip).toContainText('Отсутствующие мастер-файлы');
  1678 |   await expect(tooltip.locator('li').first()).toHaveText('Aardvark.esm');
  1679 |   await expect(tooltip).toContainText('Update.esm');
  1680 |   await expect(tooltip).toContainText('Zed.esm');
  1681 |   await pluginRow.focus();
  1682 |   await page.keyboard.press('Shift+F10');
  1683 |   await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
  1684 |   await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
  1685 |   const shellCallsBeforePluginReveal = await page.evaluate(() => {
  1686 |     const calls = (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls ?? [];
  1687 |     return {
  1688 |       openPath: calls.filter((call) => call.method === 'shell.openPath').length,
  1689 |       showItemInFolder: calls.filter((call) => call.method === 'shell.showItemInFolder').length
  1690 |     };
  1691 |   });
  1692 |   await page.getByRole('menuitem', { name: 'Открыть в проводнике' }).click();
  1693 |   await expect
  1694 |     .poll(() => latestCallPayload(page, 'shell.showItemInFolder'))
  1695 |     .toMatchObject({
  1696 |       path: 'D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\SkyUI\\Data\\SkyUI.esp'
  1697 |     });
  1698 |   await expect
  1699 |     .poll(() =>
  1700 |       page.evaluate(() =>
  1701 |         (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
  1702 |           ?.filter((call) => call.method === 'shell.showItemInFolder').length
  1703 |       )
  1704 |     )
  1705 |     .toBe(shellCallsBeforePluginReveal.showItemInFolder + 1);
  1706 |   await expect
  1707 |     .poll(() =>
  1708 |       page.evaluate(() =>
  1709 |         (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
  1710 |           ?.filter((call) => call.method === 'shell.openPath').length
  1711 |       )
  1712 |     )
  1713 |     .toBe(shellCallsBeforePluginReveal.openPath);
  1714 | 
  1715 |   await page.getByRole('row', { name: /Unofficial Patch mod/ }).click();
  1716 |   await rightPane.getByRole('tab', { name: /Данные/ }).click();
  1717 |   await expect(rightPane.getByText('Build folders')).toBeVisible();
  1718 |   await expect(rightPane.getByText('Selected mod data')).toBeVisible();
  1719 |   await expect(rightPane.getByText('scripts')).toBeVisible();
  1720 | 
  1721 |   await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  1722 |   const downloadsTable = rightPane.getByRole('table', { name: 'Downloads' });
  1723 |   await expect(downloadsTable).toBeVisible();
  1724 |   await expect(rightPane.getByRole('row', { name: /SkyUI/ })).toBeVisible();
  1725 |   await expect(downloadsTable.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);
  1726 |   await expect(rightPane.getByText('Selected download')).toHaveCount(0);
  1727 |   await expect(downloadsTable.getByText('Aetherius - A Race Overhaul', { exact: true })).toBeVisible();
  1728 |   await expect(downloadsTable.getByText(/26686-2-14-1-1719514447/)).toHaveCount(0);
  1729 |   await rightPane.getByRole('button', { name: 'Import' }).click();
  1730 |   await rightPane.getByRole('button', { name: 'NXM' }).click();
  1731 |   await expect
  1732 |     .poll(() =>
  1733 |       page.evaluate(() =>
  1734 |         (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
  1735 |           ?.map((call) => call.method)
  1736 |       )
  1737 |     )
  1738 |     .toEqual(expect.arrayContaining(['downloads.importFile', 'nxm.importInboundDownloads']));
  1739 | });
  1740 | 
  1741 | test('drags plugin rows without selecting text', async ({ page }) => {
  1742 |   await openSkyrimBuild(page);
  1743 | 
  1744 |   const source = page.getByRole('row', { name: /SkyUI\.esp plugin/ });
  1745 |   const target = page.getByRole('row', { name: /Skyrim\.esm plugin/ });
  1746 | 
  1747 |   await dragRowToSlot(page, source, target, 'after');
  1748 |   await expect(page.getByText('Moving plugin', { exact: true })).toHaveCount(0);
```