import { describe, expect, it } from 'vitest';

import {
  emptyExecutablesWorkspaceState,
  emptyProfilesWorkspaceState,
  executableTitle,
  executablesCapabilityView,
  executablesWorkspaceReducer,
  filterExecutables,
  filterProfileNames,
  isDefaultProfileName,
  profilesCapabilityView,
  profilesWorkspaceReducer,
  projectDefaultProfileName,
  selectedExecutable,
  selectedProfileName
} from '../src/renderer/profiles-executables-workspace-state';
import type {
  FluxoraExecutable,
  FluxoraProject,
  NativeBridgeStatus
} from '../src/shared/fluxora-api';

const project: FluxoraProject = {
  id: 'build',
  name: 'Build',
  templateId: 'skyrimse',
  uiTemplateId: 'skyrimse',
  gameName: 'Skyrim Special Edition',
  gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
  installRootDirectory: 'C:\\Builds',
  projectDirectory: 'C:\\Builds\\Skyrim',
  configPath: 'C:\\Builds\\Skyrim.json',
  template: {
    id: 'skyrimse',
    displayName: 'Skyrim',
    gameName: 'Skyrim Special Edition',
    summary: '',
    uiTemplateId: 'skyrimse',
    defaultProfile: 'Default'
  }
};

const readyBridge: NativeBridgeStatus = {
  ready: true,
  operationId: 'op_test',
  capabilities: {
    platform: 'win32',
    arch: 'x64',
    core: {
      available: true,
      libraryName: 'FluxoraCore.dll'
    },
    features: {
      profiles: {
        state: 'available'
      },
      executables: {
        state: 'available'
      },
      executableLaunch: {
        state: 'available'
      }
    }
  },
  logs: {
    uiLogPath: '',
    mainBridgeLogPath: ''
  }
};

const executable = (
  id: string,
  displayName: string,
  executablePath: string,
  extra: Partial<FluxoraExecutable> = {}
): FluxoraExecutable => ({
  id,
  displayName,
  executablePath,
  arguments: '',
  workingDirectory: '',
  iconPath: '',
  ...extra
});

const executables = [
  executable('skyrimse', 'Skyrim Special Edition', 'C:\\Games\\Skyrim\\SkyrimSE.exe'),
  executable('skse', 'SKSE', 'C:\\Games\\Skyrim\\skse64_loader.exe', {
    arguments: '-forcesteamloader',
    workingDirectory: 'C:\\Games\\Skyrim'
  })
];

describe('profiles and executables workspace state', () => {
  it('keeps default profile first-class and protects it by name', () => {
    expect(projectDefaultProfileName(project)).toBe('Default');
    expect(isDefaultProfileName('default', 'Default')).toBe(true);
    expect(filterProfileNames(['Default', 'Testing', 'Speedrun'], 'test')).toEqual(['Testing']);
    expect(selectedProfileName(['Default', 'Testing'], 'Missing', 'Default')).toBe('Default');

    const loaded = profilesWorkspaceReducer(
      { ...emptyProfilesWorkspaceState(), selectedName: 'Testing' },
      { type: 'items-loaded', items: ['Default', 'Testing'], defaultProfileName: 'Default' }
    );
    expect(loaded.selectedName).toBe('Testing');
  });

  it('filters and selects executable rows by user-facing fields', () => {
    expect(filterExecutables(executables, 'skse')).toEqual([executables[1]]);
    expect(filterExecutables(executables, 'forcesteamloader')).toEqual([executables[1]]);
    expect(executableTitle(executables[0])).toBe('Skyrim Special Edition');

    const loaded = executablesWorkspaceReducer(
      { ...emptyExecutablesWorkspaceState(), selectedId: 'skse' },
      { type: 'items-loaded', items: executables }
    );
    expect(loaded.selectedId).toBe('skse');
    expect(selectedExecutable(executables, 'missing')?.id).toBe('skyrimse');
  });

  it('keeps committed profile and executable rows visible during silent refreshes', () => {
    const loadedProfiles = profilesWorkspaceReducer(emptyProfilesWorkspaceState(), {
      type: 'items-loaded',
      items: ['Default', 'Testing'],
      defaultProfileName: 'Default'
    });
    const refreshingProfiles = profilesWorkspaceReducer(loadedProfiles, {
      type: 'load-started',
      silent: true
    });
    const failedProfiles = profilesWorkspaceReducer(refreshingProfiles, {
      type: 'load-failed',
      message: 'Bridge timed out',
      silent: true
    });

    const loadedExecutables = executablesWorkspaceReducer(emptyExecutablesWorkspaceState(), {
      type: 'items-loaded',
      items: executables
    });
    const refreshingExecutables = executablesWorkspaceReducer(loadedExecutables, {
      type: 'load-started',
      silent: true
    });
    const failedExecutables = executablesWorkspaceReducer(refreshingExecutables, {
      type: 'load-failed',
      message: 'Bridge timed out',
      silent: true
    });

    expect(failedProfiles.items).toEqual(['Default', 'Testing']);
    expect(failedProfiles.loadState).toBe('ready');
    expect(failedExecutables.items).toEqual(executables);
    expect(failedExecutables.loadState).toBe('ready');
  });

  it('describes bridge capabilities separately for management and launch', () => {
    expect(profilesCapabilityView(project, readyBridge).bridgeAvailable).toBe(true);
    const executableCapabilities = executablesCapabilityView(project, readyBridge);
    expect(executableCapabilities.bridgeAvailable).toBe(true);
    expect(executableCapabilities.launchAvailable).toBe(true);

    const nonLaunchBridge: NativeBridgeStatus = {
      ...readyBridge,
      capabilities: {
        ...readyBridge.capabilities!,
        features: {
          ...readyBridge.capabilities!.features,
          executableLaunch: {
            state: 'unsupported'
          }
        }
      }
    };
    expect(executablesCapabilityView(project, nonLaunchBridge).launchReason).toContain('Windows');
    expect(executablesCapabilityView(project, nonLaunchBridge, 'ru-RU').launchReason).toBe(
      'Сейчас внутренний модуль может запускать исполняемые файлы только в Windows.'
    );
  });
});
