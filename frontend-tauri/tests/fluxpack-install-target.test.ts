import { describe, expect, it } from 'vitest';

import { resolveFluxPackInstallTarget } from '../src/renderer/features/fluxpack/fluxpack-install-target';

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

  it('keeps new installation available when no build is selected', () => {
    expect(resolveFluxPackInstallTarget(null, 'D:\\Fluxora Builds')).toEqual({
      existingConfigPath: undefined,
      installRootDirectory: 'D:\\Fluxora Builds',
      requiresRootSelection: true
    });
  });
});
