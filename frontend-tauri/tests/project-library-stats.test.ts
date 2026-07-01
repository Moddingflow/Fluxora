import { describe, expect, it } from 'vitest';

import { buildProjectLibraryStats } from '../src/renderer/features/library/projectLibraryStats';
import type { FluxoraProject } from '../src/shared/fluxora-api';

const project = {
  id: 'stats-build',
  name: 'Stats build',
  templateId: 'skyrim-special-edition',
  uiTemplateId: 'skyrim',
  gameName: 'Skyrim Special Edition',
  gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
  installRootDirectory: 'D:\\Fluxora\\Builds',
  projectDirectory: 'D:\\Fluxora\\Builds\\Stats build',
  configPath: 'D:\\Fluxora\\Configs\\stats-build.json',
  projectFingerprint: {
    activePluginCount: 9,
    lastOpened: 'manual-check',
    modCount: '12',
    pluginCount: 10,
    sizeBytes: 1536
  },
  gameHealthSummary: {
    disabledMods: 2
  },
  contentLayoutSummary: {
    downloadsCount: 3
  }
} as unknown as FluxoraProject;

describe('project library stats', () => {
  it('builds compact library metrics from bridge summary records', () => {
    expect(buildProjectLibraryStats(project)).toEqual({
      disabledMods: '2',
      downloads: '3',
      lastLaunch: 'manual-check',
      mods: '12',
      size: '1.5 KB'
    });
  });

  it('lets runtime workspace counts override stale project metrics', () => {
    expect(
      buildProjectLibraryStats(project, {
        disabledModCount: 1,
        downloadsCount: 4,
        modCount: 15
      })
    ).toMatchObject({
      disabledMods: '1',
      downloads: '4',
      mods: '15'
    });
  });
});
