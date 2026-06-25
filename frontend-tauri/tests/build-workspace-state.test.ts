import { describe, expect, it } from 'vitest';

import {
  buildActionAvailability,
  buildHeaderCapabilityView,
  buildPathSaveRequest,
  buildPrimaryExecutableList,
  directoryFromExecutablePath,
  emptyBuildPathDraft,
  validateBuildPathDraft
} from '../src/renderer/build-workspace-state';
import type { FluxoraExecutable, FluxoraProject, NativeBridgeStatus } from '../src/shared/fluxora-api';

const project: FluxoraProject = {
  id: 'C:\\Builds\\Skyrim.json',
  name: 'Skyrim Main',
  templateId: 'skyrimse',
  uiTemplateId: 'skyrim',
  gameName: 'Skyrim Special Edition',
  gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
  installRootDirectory: 'C:\\Fluxora Projects',
  projectDirectory: 'C:\\Fluxora Projects\\Skyrim Main',
  configPath: 'C:\\Builds\\Skyrim.json',
  paths: {
    gameDirectory: 'C:\\Games\\Skyrim',
    modsDirectory: 'C:\\Fluxora Projects\\Skyrim Main\\mods',
    profilesDirectory: 'C:\\Fluxora Projects\\Skyrim Main\\profiles',
    downloadsDirectory: 'C:\\Fluxora Projects\\Skyrim Main\\downloads',
    overwriteDirectory: 'C:\\Fluxora Projects\\Skyrim Main\\overwrite'
  }
};

const readyBridge: NativeBridgeStatus = {
  ready: true,
  operationId: 'op_bridge',
  capabilities: {
    platform: 'win32',
    arch: 'x64',
    core: {
      available: true,
      libraryName: 'FluxoraCore.dll'
    },
    features: {}
  },
  logs: {
    uiLogPath: '',
    mainBridgeLogPath: ''
  }
};

describe('build workspace state', () => {
  it('creates a draft from project path defaults', () => {
    expect(emptyBuildPathDraft(project)).toMatchObject({
      projectDirectory: project.projectDirectory,
      gameExecutablePath: project.gamePath,
      gameDirectory: project.paths?.gameDirectory,
      downloadsDirectory: project.paths?.downloadsDirectory
    });
  });

  it('validates required paths and Windows executable shape', () => {
    const draft = emptyBuildPathDraft(project);
    expect(validateBuildPathDraft(draft, 'win32')).toBeNull();
    expect(validateBuildPathDraft({ ...draft, gameExecutablePath: 'SkyrimSE.bin' }, 'win32')).toBe(
      'Game executable must point to an .exe file on Windows.'
    );
    expect(validateBuildPathDraft({ ...draft, modsDirectory: '' }, 'win32')).toBe(
      'Mods directory is required.'
    );
  });

  it('derives game directory and save DTO without mutating the draft', () => {
    const executablePath = 'C:\\Games\\Skyrim\\SkyrimSE.exe';
    const draft = {
      ...emptyBuildPathDraft(project),
      gameExecutablePath: executablePath,
      gameDirectory: directoryFromExecutablePath(executablePath)
    };

    expect(draft.gameDirectory).toBe('C:\\Games\\Skyrim');
    expect(buildPathSaveRequest(draft)).toEqual({
      gameDirectory: 'C:\\Games\\Skyrim',
      modsDirectory: project.paths?.modsDirectory,
      profilesDirectory: project.paths?.profilesDirectory,
      downloadsDirectory: project.paths?.downloadsDirectory,
      overwriteDirectory: project.paths?.overwriteDirectory
    });
  });

  it('updates the primary executable entry for core persistence', () => {
    const executables: FluxoraExecutable[] = [
      {
        id: 'game',
        displayName: 'Skyrim',
        executablePath: 'Old.exe',
        arguments: '',
        workingDirectory: '',
        iconPath: '',
        executableDisplayMetadata: { role: 'primary', isPrimary: true }
      }
    ];

    const updated = buildPrimaryExecutableList(executables, {
      ...emptyBuildPathDraft(project),
      gameExecutablePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
      gameDirectory: 'C:\\Games\\Skyrim'
    });

    expect(updated[0]).toMatchObject({
      id: 'game',
      executablePath: 'SkyrimSE.exe',
      workingDirectory: '',
      iconPath: ''
    });
    expect(executables[0].executablePath).toBe('Old.exe');
  });

  it('keeps build header actions capability-driven without requiring every bridge to report method keys', () => {
    expect(buildActionAvailability(null, ['fluxPack'], 'FluxPack export')).toEqual({
      available: false,
      reason: 'Native bridge is not ready.'
    });

    expect(buildHeaderCapabilityView(readyBridge)).toMatchObject({
      packageAvailable: true,
      refreshAvailable: true,
      settingsAvailable: true
    });

    const unsupportedFluxPack: NativeBridgeStatus = {
      ...readyBridge,
      capabilities: {
        ...readyBridge.capabilities!,
        features: {
          fluxPackExport: {
            state: 'unsupported',
            reason: 'FluxPack export is disabled for this smoke bridge.'
          }
        }
      }
    };

    expect(buildHeaderCapabilityView(unsupportedFluxPack)).toMatchObject({
      packageAvailable: false,
      packageReason: 'FluxPack export is disabled for this smoke bridge.'
    });
  });
});
