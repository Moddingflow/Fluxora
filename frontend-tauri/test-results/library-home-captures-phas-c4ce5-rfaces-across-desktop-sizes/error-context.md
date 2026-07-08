# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: library-home.spec.ts >> captures phase 13 visual acceptance surfaces across desktop sizes
- Location: e2e\library-home.spec.ts:2035:5

# Error details

```
Test timeout of 180000ms exceeded.
```

```
Error: locator.click: Test timeout of 180000ms exceeded.
Call log:
  - waiting for getByLabel('Build header').getByRole('button', { name: 'Package' })

```

# Test source

```ts
  1984 |   await page.getByRole('option', { name: /Русский - Russian/ }).click();
  1985 |   await expect
  1986 |     .poll(() =>
  1987 |       page.evaluate(() =>
  1988 |         (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
  1989 |           ?.map((call) => call.method)
  1990 |       )
  1991 |     )
  1992 |     .toContain('settings.setLanguage');
  1993 |   await expect(page.getByText(/settings\.json - language=/)).toHaveCount(0);
  1994 | 
  1995 |   await page.getByRole('button', { name: /Для разработчиков/ }).click();
  1996 |   await expect(page.locator('.settings-panel--developer')).toBeVisible();
  1997 |   const developerSwitch = page.getByRole('switch', { name: 'Режим разработчика' });
  1998 |   await expect(developerSwitch).toHaveAttribute('aria-checked', 'false');
  1999 |   await developerSwitch.click();
  2000 |   await expect(developerSwitch).toHaveAttribute('aria-checked', 'true');
  2001 |   await expect(page.getByText('Дата последней сборки')).toBeVisible();
  2002 |   await expect(page.getByText('Tauri 2 / React / TypeScript')).toBeVisible();
  2003 |   await expect(page.getByText('Rust shell / C++ core')).toBeVisible();
  2004 |   await expect(page.getByText('0.0.0-test')).toBeVisible();
  2005 |   await page.getByRole('button', { name: 'Открыть оригинальный репозиторий Fluxora на GitHub' }).click();
  2006 |   await expect
  2007 |     .poll(() =>
  2008 |       page.evaluate(() =>
  2009 |         (window as typeof window & { __fluxoraCalls?: Array<{ method: string; payload?: unknown }> }).__fluxoraCalls
  2010 |           ?.find((call) => call.method === 'links.openExternal')
  2011 |       )
  2012 |     )
  2013 |     .toEqual({
  2014 |       method: 'links.openExternal',
  2015 |       payload: { url: 'https://github.com/WhistleSkyrim/Fluxora' }
  2016 |     });
  2017 | 
  2018 |   await page.getByRole('button', { name: /Transfer/ }).click();
  2019 |   await expect(page.getByText('Mod Organizer 2', { exact: true })).toBeVisible();
  2020 |   const transferButton = page.getByRole('button', {
  2021 |     name: 'Перенести сборку из Mod Organizer 2'
  2022 |   });
  2023 |   await expect(transferButton).toBeEnabled();
  2024 |   await transferButton.click();
  2025 |   await expect
  2026 |     .poll(() =>
  2027 |       page.evaluate(() =>
  2028 |         (window as typeof window & { __fluxoraCalls?: Array<{ method: string }> }).__fluxoraCalls
  2029 |           ?.map((call) => call.method)
  2030 |       )
  2031 |     )
  2032 |     .toEqual(expect.arrayContaining(['transfer.openMo2InMain', 'window.close']));
  2033 | });
  2034 | 
  2035 | test('captures phase 13 visual acceptance surfaces across desktop sizes', async ({ page }, testInfo) => {
  2036 |   test.setTimeout(180_000);
  2037 | 
  2038 |   for (const size of visualReviewSizes) {
  2039 |     await page.setViewportSize(size);
  2040 | 
  2041 |     await page.goto(baseUrl);
  2042 |     await expect(page.getByLabel('Build library sidebar')).toBeVisible();
  2043 |     await expect(page.getByText('2 builds')).toBeVisible();
  2044 |     await capturePhase13Screenshot(page, testInfo, 'home-library', size);
  2045 | 
  2046 |     await openSkyrimBuild(page);
  2047 |     const workbench = page.locator('.build-workbench');
  2048 |     await expect(page.getByRole('table', { name: 'Mod order' })).toBeVisible();
  2049 |     await expect(workbench).toBeVisible();
  2050 | 
  2051 |     const workbenchOverflow = await workbench.evaluate((element) => ({
  2052 |       clientWidth: element.clientWidth,
  2053 |       scrollWidth: element.scrollWidth
  2054 |     }));
  2055 |     expect(workbenchOverflow.scrollWidth).toBeLessThanOrEqual(workbenchOverflow.clientWidth + 2);
  2056 | 
  2057 |     await capturePhase13Screenshot(page, testInfo, 'build-mods', size);
  2058 | 
  2059 |     const rightPane = page.getByLabel('Right pane');
  2060 |     await expect(page.getByRole('table', { name: 'Plugin load order' })).toBeVisible();
  2061 |     await expect(rightPane.getByRole('tab', { name: /Плагины/ })).toHaveAttribute('aria-selected', 'true');
  2062 |     await capturePhase13Screenshot(page, testInfo, 'plugins-right-pane', size);
  2063 | 
  2064 |     await rightPane.getByRole('tab', { name: /Загрузки/ }).click();
  2065 |     await rightPane.getByRole('row', { name: /SkyUI/ }).dblclick();
  2066 |     const simpleDialog = page.getByRole('dialog', { name: /SkyUI/ });
  2067 |     await expect(simpleDialog).toBeVisible();
  2068 |     await expect(simpleDialog.getByRole('button', { name: 'Подробнее' })).toBeVisible();
  2069 |     await expect(simpleDialog.getByRole('button', { name: 'Установить', exact: true })).toBeVisible();
  2070 |     await capturePhase13Screenshot(page, testInfo, 'install-dialog', size);
  2071 | 
  2072 |     await simpleDialog.getByRole('button', { name: 'Закрыть окно установки' }).click();
  2073 |     await rightPane.getByRole('button', { name: 'Archive' }).click();
  2074 |     const fomodDialog = page.getByRole('dialog', { name: /Natural Vision Of Tamriel/ });
  2075 |     await expect(fomodDialog.getByText('Natural Vision Of Tamriel').first()).toBeVisible();
  2076 |     await expect(fomodDialog.getByRole('button', { name: /Preset/ })).toBeVisible();
  2077 |     await capturePhase13Screenshot(page, testInfo, 'fomod-wizard', size);
  2078 | 
  2079 |     await page.keyboard.press('Escape');
  2080 |     await openSkyrimBuild(page);
  2081 |     await page.evaluate(() => {
  2082 |       (window as typeof window & { __fluxoraOperationDelayMs?: number }).__fluxoraOperationDelayMs = 900;
  2083 |     });
> 2084 |     await page.getByLabel('Build header').getByRole('button', { name: 'Package' }).click();
       |                                                                                    ^ Error: locator.click: Test timeout of 180000ms exceeded.
  2085 |     await expect(page.getByRole('status', { name: 'Packaging FluxPack' })).toBeVisible();
  2086 |     await expect(page.getByRole('progressbar', { name: 'Packaging FluxPack progress' })).toBeVisible();
  2087 |     await capturePhase13Screenshot(page, testInfo, 'operation-overlay', size);
  2088 | 
  2089 |     await page.goto(`${baseUrl}/?window=settings`);
  2090 |     await expect(page.locator('.titlebar__brand-name')).toHaveText('Settings');
  2091 |     await expect(page.locator('.titlebar__mark--settings')).toBeVisible();
  2092 |     await expect(page.getByText('Nexus Mods', { exact: true })).toBeVisible();
  2093 |     await capturePhase13Screenshot(page, testInfo, 'settings', size);
  2094 |   }
  2095 | 
  2096 |   await page.setViewportSize({ width: 1440, height: 900 });
  2097 |   await page.emulateMedia({ reducedMotion: 'reduce' });
  2098 |   await page.goto(baseUrl);
  2099 |   await page.keyboard.press('Tab');
  2100 | 
  2101 |   const focusIndicator = await page.evaluate(() => {
  2102 |     const active = document.activeElement as HTMLElement | null;
  2103 |     if (!active) {
  2104 |       return { hasIndicator: false };
  2105 |     }
  2106 | 
  2107 |     const style = getComputedStyle(active);
  2108 | 
  2109 |     return {
  2110 |       hasIndicator:
  2111 |         (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') ||
  2112 |         style.boxShadow !== 'none',
  2113 |       label: active.getAttribute('aria-label') ?? active.textContent?.trim() ?? ''
  2114 |     };
  2115 |   });
  2116 | 
  2117 |   expect(focusIndicator.hasIndicator).toBe(true);
  2118 |   await expect(page.getByLabel('Home')).toBeVisible();
  2119 |   await expect(page.getByLabel('Open settings')).toBeVisible();
  2120 |   await expect(page.getByLabel('Minimize')).toBeVisible();
  2121 |   await expect(page.getByLabel('Maximize')).toBeVisible();
  2122 |   await expect(page.getByLabel('Close')).toBeVisible();
  2123 |   await expectNoDocumentHorizontalOverflow(page);
  2124 | });
  2125 | 
  2126 | test('captures mods pane visual review sizes', async ({ page }, testInfo) => {
  2127 |   for (const size of visualReviewSizes) {
  2128 |     await page.setViewportSize(size);
  2129 |     await page.goto(baseUrl);
  2130 |     await page.getByRole('option', { name: /Skyrim graphics overhaul/ }).click();
  2131 |     await page.getByRole('button', { name: 'Open', exact: true }).click();
  2132 | 
  2133 |     const workbench = page.locator('.build-workbench');
  2134 |     await expect(page.getByRole('table', { name: 'Mod order' })).toBeVisible();
  2135 |     await expect(workbench).toBeVisible();
  2136 | 
  2137 |     const overflow = await workbench.evaluate((element) => ({
  2138 |       clientWidth: element.clientWidth,
  2139 |       scrollWidth: element.scrollWidth
  2140 |     }));
  2141 |     expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
  2142 | 
  2143 |     await page.screenshot({
  2144 |       fullPage: true,
  2145 |       path: testInfo.outputPath(`mods-pane-${size.width}x${size.height}.png`)
  2146 |     });
  2147 |   }
  2148 | });
  2149 | 
  2150 | test('file preview window renders a nonblank nif canvas and source mod label', async ({ page }) => {
  2151 |   const project = encodeURIComponent('D:\\Fluxora\\Configs\\skyrim-main.json');
  2152 |   const mod = encodeURIComponent('D:\\Fluxora\\Builds\\Skyrim graphics overhaul\\mods\\Selected Model');
  2153 |   const relativePath = encodeURIComponent('meshes/armor/cuirass.nif');
  2154 | 
  2155 |   await page.setViewportSize({ width: 1344, height: 912 });
  2156 |   await page.goto(
  2157 |     `${baseUrl}/?window=file-preview&project=${project}&mod=${mod}&path=${relativePath}&name=cuirass.nif&profile=Default&kind=nif`
  2158 |   );
  2159 | 
  2160 |   await expect(page.getByRole('heading', { name: '.nif Preview' })).toBeVisible();
  2161 |   await expect(page.getByTestId('file-preview-source-mod')).toContainText('Selected Model');
  2162 |   await expect(page.getByText('meshes/armor/cuirass.nif')).toBeVisible();
  2163 |   await expect(page.getByRole('button', { name: 'Previous mod variant' })).toBeEnabled();
  2164 |   await expect(page.getByRole('button', { name: 'Next mod variant' })).toBeDisabled();
  2165 |   await expect(page.getByTestId('file-preview-canvas')).toBeVisible();
  2166 | 
  2167 |   await page.waitForFunction(() => {
  2168 |     const canvas = document.querySelector('[data-testid="file-preview-canvas"]') as HTMLCanvasElement | null;
  2169 |     if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
  2170 |       return false;
  2171 |     }
  2172 |     const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  2173 |     if (!gl) {
  2174 |       return false;
  2175 |     }
  2176 |     const pixels = new Uint8Array(4);
  2177 |     gl.readPixels(
  2178 |       Math.floor(canvas.width / 2),
  2179 |       Math.floor(canvas.height / 2),
  2180 |       1,
  2181 |       1,
  2182 |       gl.RGBA,
  2183 |       gl.UNSIGNED_BYTE,
  2184 |       pixels
```