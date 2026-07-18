import { describe, expect, it } from 'vitest';

import { downloadInstallDropPlacementFromPointer } from '../src/renderer/features/mods/download-install-drop-state';

describe('download install drop state', () => {
  it('uses the separator body for an inside drop while preserving edge insertion slots', () => {
    const separatorRect = { top: 100, height: 40 };

    expect(downloadInstallDropPlacementFromPointer(separatorRect, 120, true)).toBe('inside');
    expect(downloadInstallDropPlacementFromPointer(separatorRect, 104, true)).toBe('before');
    expect(downloadInstallDropPlacementFromPointer(separatorRect, 136, true)).toBe('after');
    expect(downloadInstallDropPlacementFromPointer(separatorRect, 120, false)).toBe('after');
  });
});
