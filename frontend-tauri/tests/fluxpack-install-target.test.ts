import { describe, expect, it } from 'vitest';

import {
  findFluxPackNameConflict,
  resolveFluxPackInstallTarget
} from '../src/renderer/features/fluxpack/fluxpack-install-target';

describe('FluxPack install target', () => {
  it('updates the selected build in place without asking for another root', () => {
    expect(
      resolveFluxPackInstallTarget(
        {
          configPath: 'C:\\Fluxora\\Builds\\Foundation.json',
          installRootDirectory: 'E:\\Fluxora Builds'
        },
        'D:\\Fallback Builds'
      )
    ).toEqual({
      existingConfigPath: 'C:\\Fluxora\\Builds\\Foundation.json',
      installRootDirectory: 'E:\\Fluxora Builds',
      requiresRootSelection: false
    });
  });

  it('uses the catalog install root for a new build without a redundant folder prompt', () => {
    expect(resolveFluxPackInstallTarget(null, 'D:\\Fluxora Builds')).toEqual({
      existingConfigPath: undefined,
      installRootDirectory: 'D:\\Fluxora Builds',
      requiresRootSelection: false
    });
  });

  it('finds the same-name build case-insensitively and prefers the selected duplicate', () => {
    const projects = [
      {
        id: 'foundation-old',
        name: 'Foundation Edition',
        configPath: 'C:\\Fluxora\\Foundation-old.json',
        installRootDirectory: 'D:\\Fluxora Builds'
      },
      {
        id: 'foundation-selected',
        name: ' foundation edition ',
        configPath: 'C:\\Fluxora\\Foundation-selected.json',
        installRootDirectory: 'E:\\Fluxora Builds'
      }
    ];

    expect(findFluxPackNameConflict(projects, 'FOUNDATION EDITION', 'foundation-selected')).toEqual(
      projects[1]
    );
    expect(findFluxPackNameConflict(projects, 'Another build', 'foundation-selected')).toBeNull();
  });
});
