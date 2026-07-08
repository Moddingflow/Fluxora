# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: library-home.spec.ts >> runs build header package, check and launch actions through the facade
- Location: e2e\library-home.spec.ts:1287:5

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator: getByLabel('Build header').getByRole('button', { name: 'Package' })
Expected: enabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeEnabled" with timeout 5000ms
  - waiting for getByLabel('Build header').getByRole('button', { name: 'Package' })

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
  1195 |       rowDropTargetCount: pane.querySelectorAll(
  1196 |         '.mod-list-row[data-drop-target="true"], .plugin-row[data-drop-target="true"]'
  1197 |       ).length
  1198 |     };
  1199 |   });
  1200 | 
  1201 | const expectNoDocumentHorizontalOverflow = async (page: Page) => {
  1202 |   const overflow = await page.evaluate(() => ({
  1203 |     bodyClientWidth: document.body.clientWidth,
  1204 |     bodyScrollWidth: document.body.scrollWidth,
  1205 |     documentClientWidth: document.documentElement.clientWidth,
  1206 |     documentScrollWidth: document.documentElement.scrollWidth
  1207 |   }));
  1208 | 
  1209 |   expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.documentClientWidth + 2);
  1210 |   expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.bodyClientWidth + 2);
  1211 | };
  1212 | 
  1213 | const elementFocusIndicator = async (locator: Locator) =>
  1214 |   locator.evaluate((element) => {
  1215 |     const style = getComputedStyle(element as HTMLElement);
  1216 | 
  1217 |     return {
  1218 |       hasIndicator:
  1219 |         (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') ||
  1220 |         style.boxShadow !== 'none',
  1221 |       outlineStyle: style.outlineStyle,
  1222 |       outlineWidth: style.outlineWidth,
  1223 |       boxShadow: style.boxShadow
  1224 |     };
  1225 |   });
  1226 | 
  1227 | const capturePhase13Screenshot = async (
  1228 |   page: Page,
  1229 |   testInfo: { outputPath(path: string): string },
  1230 |   surface: string,
  1231 |   size: (typeof visualReviewSizes)[number]
  1232 | ) => {
  1233 |   await expectNoDocumentHorizontalOverflow(page);
  1234 |   await page.screenshot({
  1235 |     fullPage: true,
  1236 |     path: testInfo.outputPath(`phase13-${surface}-${size.width}x${size.height}.png`)
  1237 |   });
  1238 | };
  1239 | 
  1240 | test('selects, opens and creates builds from the redesigned library home', async ({ page }) => {
  1241 |   await page.goto(baseUrl);
  1242 | 
  1243 |   await expect(page.getByLabel('Build library sidebar')).toBeVisible();
  1244 |   await expect(page.getByText('2 builds')).toBeVisible();
  1245 |   await expect(page.getByText('Choose a build')).toBeVisible();
  1246 | 
  1247 |   await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  1248 |   await expect(page.getByRole('heading', { name: 'Skyrim graphics overhaul' })).toBeVisible();
  1249 | 
  1250 |   await page.getByRole('button', { name: 'Open', exact: true }).click();
  1251 |   await expect
  1252 |     .poll(() =>
  1253 |       page.evaluate(() =>
  1254 |         (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
  1255 |           ?.map((call) => call.method)
  1256 |       )
  1257 |     )
  1258 |     .toContain('projects.openConfig');
  1259 | 
  1260 |   await page.getByLabel('Home').click();
  1261 |   await page.getByRole('button', { name: 'New build' }).first().click();
  1262 |   await page.getByPlaceholder('My Skyrim build').fill('  Playwright build  ');
  1263 |   await page.getByRole('button', { name: 'Next' }).click();
  1264 |   await page.getByRole('button', { name: 'Next' }).click();
  1265 |   await page.getByPlaceholder('Path to game executable').fill('C:\\Games\\Skyrim\\SkyrimSE.exe');
  1266 |   await page.getByRole('button', { name: 'Next' }).click();
  1267 |   await page.getByPlaceholder('Folder for Fluxora builds').fill('D:\\Fluxora\\Builds');
  1268 |   await page.getByRole('button', { name: 'Create' }).click();
  1269 | 
  1270 |   await expect
  1271 |     .poll(() => latestCallPayload(page, 'projects.create'))
  1272 |     .toMatchObject({
  1273 |       operation: {
  1274 |         operationId: expect.stringContaining('projects_create')
  1275 |       },
  1276 |       request: {
  1277 |         gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
  1278 |         installRootDirectory: 'D:\\Fluxora\\Builds',
  1279 |         projectName: 'Playwright build',
  1280 |         templateId: 'skyrim-special-edition'
  1281 |       }
  1282 |     });
  1283 |   await expect(page.getByRole('heading', { name: 'Playwright build' })).toBeVisible();
  1284 |   await expect(page.getByRole('dialog')).toHaveCount(0);
  1285 | });
  1286 | 
  1287 | test('runs build header package, check and launch actions through the facade', async ({ page }) => {
  1288 |   await page.goto(baseUrl);
  1289 | 
  1290 |   await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  1291 |   await page.getByRole('button', { name: 'Open', exact: true }).click();
  1292 | 
  1293 |   const buildHeader = page.getByLabel('Build header');
  1294 |   await expect(buildHeader).toBeVisible();
> 1295 |   await expect(buildHeader.getByRole('button', { name: 'Package' })).toBeEnabled();
       |                                                                      ^ Error: expect(locator).toBeEnabled() failed
  1296 |   await expect(buildHeader.getByRole('button', { name: 'Check' })).toBeEnabled();
  1297 |   await expect(buildHeader.getByRole('button', { name: 'Launch' })).toBeEnabled();
  1298 | 
  1299 |   await buildHeader.getByRole('button', { name: 'Check' }).click();
  1300 |   await expect
  1301 |     .poll(() =>
  1302 |       page.evaluate(() =>
  1303 |         (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
  1304 |           ?.map((call) => call.method)
  1305 |       )
  1306 |     )
  1307 |     .toContain('mods.checkUpdates');
  1308 | 
  1309 |   await buildHeader.getByRole('button', { name: 'Launch' }).click();
  1310 |   await expect(page.getByText('Launching SKSE')).toBeVisible();
  1311 |   await expect
  1312 |     .poll(() =>
  1313 |       page.evaluate(() =>
  1314 |         (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
  1315 |           ?.map((call) => call.method)
  1316 |       )
  1317 |     )
  1318 |     .toContain('executables.launch');
  1319 |   await expect(page.getByText('Launching SKSE')).toBeHidden();
  1320 | 
  1321 |   await buildHeader.getByRole('button', { name: 'Package' }).click();
  1322 |   await expect(page.getByRole('status', { name: 'Packaging FluxPack' })).toBeVisible();
  1323 |   await expect(
  1324 |     page.getByRole('progressbar', { name: 'Packaging FluxPack progress' })
  1325 |   ).toBeVisible();
  1326 |   await expect
  1327 |     .poll(() =>
  1328 |       page.evaluate(() =>
  1329 |         (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
  1330 |           ?.map((call) => call.method)
  1331 |       )
  1332 |     )
  1333 |     .toContain('fluxPack.export');
  1334 | });
  1335 | 
  1336 | test('packages the build from the mods search-row three-dot menu', async ({ page }) => {
  1337 |   await openSkyrimBuild(page);
  1338 | 
  1339 |   const modsPane = page.getByRole('region', { name: 'Mods', exact: true });
  1340 |   const trigger = modsPane.getByRole('button', { name: 'Действия со сборкой' });
  1341 |   await expect(trigger).toBeVisible();
  1342 |   await trigger.click();
  1343 | 
  1344 |   const menu = page.getByRole('menu', { name: 'Действия со сборкой' });
  1345 |   await expect(menu).toBeVisible();
  1346 |   await expect(menu.getByRole('menuitem', { name: 'Установить' })).toBeEnabled();
  1347 |   const packageItem = menu.getByRole('menuitem', { name: 'Упаковать' });
  1348 |   await expect(packageItem).toBeEnabled();
  1349 |   await packageItem.click();
  1350 | 
  1351 |   await expect(page.getByRole('status', { name: 'Packaging FluxPack' })).toBeVisible();
  1352 |   await expect(
  1353 |     page.getByRole('progressbar', { name: 'Packaging FluxPack progress' })
  1354 |   ).toBeVisible();
  1355 |   await expect.poll(() => callMethods(page)).toContain('dialogs.saveFluxPack');
  1356 |   await expect.poll(() => callMethods(page)).toContain('fluxPack.export');
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
```