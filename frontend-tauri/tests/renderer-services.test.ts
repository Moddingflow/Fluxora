import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bridgeStatusCode,
  cleanupCreatedProject,
  createProjectFromDraft,
  loadProjectCatalog,
  replaceRenamedProject,
  upsertProject
} from '../src/renderer/services/project-catalog-service';
import { defaultModNameFromPath, shortPath } from '../src/renderer/services/path-display-service';
import {
  createRendererOperationId,
  errorMessage
} from '../src/renderer/services/renderer-operation-service';
import type {
  FluxoraApi,
  FluxoraGameTemplate,
  FluxoraProject,
  FluxoraProjectCatalog,
  OperationRequest
} from '../src/shared/fluxora-api';

type RendererTestGlobal = typeof globalThis & {
  window?: Window;
};

let originalFluxoraDescriptor: PropertyDescriptor | undefined;

const ensureWindow = (): Window => {
  const testGlobal = globalThis as RendererTestGlobal;
  if (!testGlobal.window) {
    Object.defineProperty(testGlobal, 'window', {
      configurable: true,
      value: testGlobal
    });
  }

  return testGlobal.window;
};

const setFluxoraApi = (api: Partial<FluxoraApi>) => {
  Object.defineProperty(ensureWindow(), 'fluxora', {
    configurable: true,
    value: api as FluxoraApi
  });
};

const restoreFluxoraApi = () => {
  const testWindow = ensureWindow();

  if (originalFluxoraDescriptor) {
    Object.defineProperty(testWindow, 'fluxora', originalFluxoraDescriptor);
    return;
  }

  Reflect.deleteProperty(testWindow, 'fluxora');
};

const project = (overrides: Partial<FluxoraProject> = {}): FluxoraProject => ({
  id: 'skyrim-main',
  name: 'Skyrim Main',
  templateId: 'skyrim-special-edition',
  uiTemplateId: 'skyrim',
  gameName: 'Skyrim Special Edition',
  gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
  installRootDirectory: 'C:\\Fluxora Projects',
  projectDirectory: 'C:\\Fluxora Projects\\Skyrim Main',
  configPath: 'C:\\Fluxora\\Builds\\Skyrim.json',
  ...overrides
});

const template: FluxoraGameTemplate = {
  id: 'skyrim-special-edition',
  displayName: 'Skyrim Special Edition',
  gameName: 'Skyrim Special Edition',
  summary: 'Bethesda RPG',
  uiTemplateId: 'skyrim'
};

beforeEach(() => {
  originalFluxoraDescriptor = Object.getOwnPropertyDescriptor(ensureWindow(), 'fluxora');
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreFluxoraApi();
});

describe('renderer operation services', () => {
  it('creates scoped renderer operation ids and normalizes errors', () => {
    expect(createRendererOperationId('projects_list')).toContain('_projects_list_');
    expect(errorMessage(new Error('Bridge failed'))).toBe('Bridge failed');
    expect(errorMessage('Native bridge rejected the build path')).toBe(
      'Native bridge rejected the build path'
    );
    expect(errorMessage({ detail: 'Install root is not writable' })).toBe(
      'Install root is not writable'
    );
    expect(errorMessage('Core failed\n    at native_bridge.cpp:42\nstderr: raw stack')).toBe(
      'Core failed'
    );
    expect(errorMessage('')).toBe('Operation failed.');
  });

  it('formats display paths and archive names without filesystem access', () => {
    expect(shortPath('C:\\Games\\Skyrim\\SkyrimSE.exe')).toBe('Skyrim\\SkyrimSE.exe');
    expect(shortPath('')).toBe('not set');
    expect(defaultModNameFromPath('C:\\Downloads\\Visual Pack.7z')).toBe('Visual Pack');
  });
});

describe('project catalog service', () => {
  it('labels bridge status without leaking status details into App', () => {
    expect(bridgeStatusCode(null)).toBe('checking');
    expect(bridgeStatusCode({ ready: true } as never)).toBe('ready');
    expect(bridgeStatusCode({ ready: false } as never)).toBe('error');
  });

  it('upserts projects by stable project identity', () => {
    const existing = project();
    const updated = project({ name: 'Skyrim Renamed' });
    const added = project({
      id: 'fallout-main',
      name: 'Fallout Main',
      configPath: 'C:\\Fluxora\\Builds\\Fallout.json',
      projectDirectory: 'C:\\Fluxora Projects\\Fallout Main'
    });

    expect(upsertProject([existing], updated)).toEqual([updated]);
    expect(upsertProject([existing], added)).toEqual([added, existing]);
  });

  it('replaces a renamed project when every path-backed identity changes', () => {
    const existing = project({
      id: 'C:\\Fluxora\\Builds\\Skyrim Dragonist.json',
      name: 'Skyrim Dragonist',
      configPath: 'C:\\Fluxora\\Builds\\Skyrim Dragonist.json',
      projectDirectory: 'E:\\Fluxora Builds\\Skyrim Dragonist'
    });
    const renamed = project({
      id: 'C:\\Fluxora\\Builds\\Dragonist.json',
      name: 'Dragonist',
      configPath: 'C:\\Fluxora\\Builds\\Dragonist.json',
      projectDirectory: 'E:\\Fluxora Builds\\Dragonist'
    });
    const unrelated = project({
      id: 'foundation-edition',
      name: 'Foundation Edition',
      configPath: 'C:\\Fluxora\\Builds\\Foundation Edition.json',
      projectDirectory: 'E:\\Fluxora Builds\\Foundation Edition'
    });

    expect(replaceRenamedProject([existing, unrelated], existing, renamed)).toEqual([
      renamed,
      unrelated
    ]);
  });

  it('loads catalog and templates through one renderer operation', async () => {
    const catalog: FluxoraProjectCatalog = {
      projects: [project()],
      buildConfigsDirectory: 'C:\\Fluxora\\Builds',
      defaultInstallRootDirectory: 'C:\\Fluxora Projects',
      operationId: 'op_native'
    };
    const operationIds: string[] = [];

    setFluxoraApi({
      projects: {
        list: vi.fn(async (request?: OperationRequest) => {
          operationIds.push(request?.operationId ?? '');
          return catalog;
        })
      } as unknown as FluxoraApi['projects'],
      templates: {
        list: vi.fn(async (request?: OperationRequest) => {
          operationIds.push(request?.operationId ?? '');
          return [template];
        })
      } as unknown as FluxoraApi['templates'],
      gameInstalls: {
        discover: vi.fn(async (request?: OperationRequest) => {
          operationIds.push(request?.operationId ?? '');
          return {
            installs: [{
              templateId: template.id,
              resolution: 'found' as const,
              primaryExecutablePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
              providerId: 'steam' as const
            }],
            operationId: request?.operationId ?? ''
          };
        })
      }
    });

    const result = await loadProjectCatalog();

    expect(result.catalog).toBe(catalog);
    expect(result.templates).toEqual([template]);
    expect(result.gameInstalls.installs[0]?.primaryExecutablePath).toBe(
      'C:\\Games\\Skyrim\\SkyrimSE.exe'
    );
    expect(operationIds).toHaveLength(3);
    expect(operationIds[0]).toBe(operationIds[1]);
    expect(operationIds[1]).toBe(operationIds[2]);
    expect(operationIds[0]).toContain('_projects_list_');
  });

  it('fails soft when install discovery is unavailable', async () => {
    setFluxoraApi({
      projects: {
        list: vi.fn(async () => ({
          projects: [],
          buildConfigsDirectory: 'C:\\Fluxora\\Builds',
          defaultInstallRootDirectory: 'C:\\Fluxora Projects',
          operationId: 'op_native'
        }))
      } as unknown as FluxoraApi['projects'],
      templates: {
        list: vi.fn(async () => [template])
      } as unknown as FluxoraApi['templates'],
      gameInstalls: {
        discover: vi.fn(async () => Promise.reject(new Error('provider unavailable')))
      }
    });

    const result = await loadProjectCatalog();

    expect(result.gameInstalls.installs).toEqual([{
      templateId: template.id,
      resolution: 'notFound'
    }]);
  });

  it('does not complete the library bootstrap before discovery is ready', async () => {
    let resolveDiscovery!: (value: {
      installs: [];
      operationId: string;
    }) => void;
    const discovery = new Promise<{ installs: []; operationId: string }>((resolve) => {
      resolveDiscovery = resolve;
    });
    setFluxoraApi({
      projects: {
        list: vi.fn(async () => ({
          projects: [],
          buildConfigsDirectory: 'C:\\Fluxora\\Builds',
          defaultInstallRootDirectory: 'C:\\Fluxora Projects',
          operationId: 'op_native'
        }))
      } as unknown as FluxoraApi['projects'],
      templates: {
        list: vi.fn(async () => [template])
      } as unknown as FluxoraApi['templates'],
      gameInstalls: {
        discover: vi.fn(async () => discovery)
      }
    });
    let completed = false;
    const bootstrap = loadProjectCatalog().then((result) => {
      completed = true;
      return result;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(completed).toBe(false);

    resolveDiscovery({ installs: [], operationId: 'op_discovery' });
    await bootstrap;
    expect(completed).toBe(true);
  });

  it('creates projects from trimmed renderer draft fields', async () => {
    const create = vi.fn(async () => project({ name: 'Nordic Build' }));

    setFluxoraApi({
      projects: {
        create
      } as unknown as FluxoraApi['projects']
    });

    const result = await createProjectFromDraft(
      {
        projectName: '  Nordic Build  ',
        templateId: 'skyrim-special-edition',
        gamePath: '  C:\\Games\\Skyrim\\SkyrimSE.exe  ',
        installRootDirectory: '  C:\\Fluxora Projects  '
      },
      'op_manual_create'
    );

    expect(result.project.name).toBe('Nordic Build');
    expect(create).toHaveBeenCalledWith(
      {
        projectName: 'Nordic Build',
        templateId: 'skyrim-special-edition',
        gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
        installRootDirectory: 'C:\\Fluxora Projects'
      },
      { operationId: 'op_manual_create' }
    );
  });

  it('generates create operation ids and forwards trimmed draft DTOs', async () => {
    const create = vi.fn(async () => project({ name: 'Nordic Build' }));

    setFluxoraApi({
      projects: {
        create
      } as unknown as FluxoraApi['projects']
    });

    const result = await createProjectFromDraft({
      projectName: '  Nordic Build  ',
      templateId: 'skyrim-special-edition',
      gamePath: '  C:\\Games\\Skyrim\\SkyrimSE.exe  ',
      installRootDirectory: '  C:\\Fluxora Projects  '
    });

    expect(result.operationId).toContain('_projects_create_');
    expect(create).toHaveBeenCalledWith(
      {
        projectName: 'Nordic Build',
        templateId: 'skyrim-special-edition',
        gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
        installRootDirectory: 'C:\\Fluxora Projects'
      },
      { operationId: result.operationId }
    );
  });

  it('cleans up a cancelled created project through the typed project delete API', async () => {
    const created = project({
      name: 'Cancelled Build',
      configPath: 'C:\\Fluxora\\Builds\\Cancelled.json'
    });
    const remove = vi.fn(async () => ({
      accepted: true,
      configPath: created.configPath,
      operationId: 'op_cancel_cleanup'
    }));

    setFluxoraApi({
      projects: {
        delete: remove
      } as unknown as FluxoraApi['projects']
    });

    const result = await cleanupCreatedProject(created, 'op_cancel_cleanup');

    expect(result.result.accepted).toBe(true);
    expect(remove).toHaveBeenCalledWith(created.configPath, {
      operationId: 'op_cancel_cleanup'
    });
  });

  it('generates cancel cleanup operation ids when omitted', async () => {
    const created = project({
      name: 'Cancelled Build',
      configPath: 'C:\\Fluxora\\Builds\\Cancelled.json'
    });
    const remove = vi.fn(async () => ({
      accepted: true,
      configPath: created.configPath,
      operationId: 'op_native_cleanup'
    }));

    setFluxoraApi({
      projects: {
        delete: remove
      } as unknown as FluxoraApi['projects']
    });

    const result = await cleanupCreatedProject(created);

    expect(result.result.accepted).toBe(true);
    expect(result.operationId).toContain('_projects_create_cancel_cleanup_');
    expect(remove).toHaveBeenCalledWith(created.configPath, {
      operationId: result.operationId
    });
  });
});
