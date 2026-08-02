import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('application update Settings removal', () => {
  it('keeps update state out of SettingsWorkspace and its developer section', () => {
    const settings = source('src/renderer/features/settings/SettingsWorkspace.tsx');

    expect(settings).not.toContain('AppUpdateSettingsControl');
    expect(settings).not.toContain('AppUpdateSettingsViewState');
    expect(settings).not.toContain('appUpdate');
    expect(settings).not.toContain('Обновления Fluxora');
    expect(settings).not.toContain('Проверить обновления');
  });

  it('returns only the native-derived toolbar projection from useAppUpdate', () => {
    const hook = source('src/renderer/features/update/use-app-update.ts');
    const app = source('src/renderer/App.tsx');

    expect(hook).not.toContain('AppUpdateSettingsViewState');
    expect(hook).not.toContain('appUpdateSettingsView');
    expect(hook).not.toMatch(/settings\s*:/u);
    expect(app).not.toContain('appUpdate={appUpdate.settings}');
    expect(app).toContain('update={appUpdate.toolbar}');
  });

  it('removes the obsolete manual update component source', () => {
    expect(() => source('src/renderer/features/update/AppUpdateSettingsControl.tsx'))
      .toThrow();
  });
});
