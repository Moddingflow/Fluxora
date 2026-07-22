import { describe, expect, it } from 'vitest';

import type { FluxoraAiFileChange, FluxoraProject } from '../src/shared/fluxora-api';
import { resolveAiManagedFileLocation } from '../src/renderer/features/ai/ai-managed-file-location';

const project = {
  id: 'build-1',
  name: 'Build',
  templateId: 'skyrimse',
  uiTemplateId: 'skyrimse',
  gameName: 'Skyrim Special Edition',
  gamePath: 'D:\\Games\\Skyrim Special Edition',
  installRootDirectory: 'D:\\Fluxora\\Builds',
  projectDirectory: 'D:\\Fluxora\\Builds\\Build',
  configPath: 'D:\\Fluxora\\Configs\\build.json',
  paths: { modsDirectory: 'D:\\Fluxora\\Builds\\Build\\mods' }
} satisfies FluxoraProject;

const change = (relativePath: string): FluxoraAiFileChange => ({
  fileRef: 'opaque-file',
  scope: 'build',
  ownerMod: 'Fluxora AI Overrides',
  relativePath,
  status: 'applied',
  hunks: [],
  addedLines: 1,
  removedLines: 1,
  validation: 'validated-in-memory',
  verification: 'reread-verified',
  beforeVersion: 'before',
  afterVersion: 'after',
  rollbackState: 'available'
});

describe('managed AI file location', () => {
  it('resolves only contained paths owned by the reported managed mod', () => {
    expect(resolveAiManagedFileLocation(
      project,
      change('Fluxora AI Overrides/MCM/Config/settings.ini')
    )).toEqual({
      absolutePath: 'D:\\Fluxora\\Builds\\Build\\mods\\Fluxora AI Overrides\\MCM\\Config\\settings.ini',
      modPath: 'D:\\Fluxora\\Builds\\Build\\mods\\Fluxora AI Overrides',
      relativePath: 'MCM/Config/settings.ini'
    });

    expect(resolveAiManagedFileLocation(
      project,
      change('Fluxora AI Overrides/../settings.ini')
    )).toBeNull();
    expect(resolveAiManagedFileLocation(
      project,
      change('Fluxora AI Overrides/C:/Windows/settings.ini')
    )).toBeNull();
    expect(resolveAiManagedFileLocation(
      project,
      change('Different Mod/settings.ini')
    )).toBeNull();
  });
});
