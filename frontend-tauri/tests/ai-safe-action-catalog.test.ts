import { describe, expect, it } from 'vitest';

import {
  AI_SAFE_ACTION_CATALOG,
  AI_SAFE_ACTION_CATALOG_SCHEMA,
  AI_SAFE_ACTION_TOOL_NAMES,
  type AiSafeActionToolName
} from '../src/shared/ai-safe-action-catalog';
import { createFluxoraApi, type IpcInvoker } from '../src/tauri/fluxora-api';

const phase9Tools: readonly AiSafeActionToolName[] = [
  'projects.create',
  'projects.rename',
  'projects.openConfig',
  'buildPaths.get',
  'buildPaths.save',
  'mods.listInstalled',
  'mods.setEnabled',
  'mods.setAllEnabled',
  'mods.moveOrderItem',
  'mods.createEmpty',
  'mods.createSeparator',
  'mods.deleteSeparator',
  'mods.deleteInstalled',
  'plugins.list',
  'plugins.move',
  'plugins.setEnabled',
  'profiles.list',
  'profiles.create',
  'profiles.clone',
  'profiles.rename',
  'downloads.list',
  'downloads.importFile',
  'downloads.install',
  'downloads.delete',
  'archives.install',
  'downloads.analyzeContentLayout',
  'downloads.analyzeFomod',
  'downloads.installFomod',
  'nexus.getAuthStatus',
  'nexus.connect',
  'nexus.disconnect',
  'nxm.captureLinks',
  'nxm.importInboundDownloads',
  'operations.getStatus',
  'operations.cancel'
];

const uiSurfaceMethods = new Set([
  'projects.create',
  'projects.rename',
  'projects.openConfig',
  'buildPaths.get',
  'buildPaths.save',
  'mods.listInstalled',
  'mods.setEnabled',
  'mods.setAllEnabled',
  'mods.moveOrderItem',
  'mods.createEmpty',
  'mods.createSeparator',
  'mods.deleteSeparator',
  'mods.deleteInstalled',
  'plugins.list',
  'plugins.move',
  'plugins.setEnabled',
  'profiles.list',
  'profiles.create',
  'profiles.clone',
  'profiles.rename',
  'downloads.list',
  'downloads.importFile',
  'downloads.install',
  'downloads.delete',
  'archives.install',
  'downloads.analyzeContentLayout',
  'downloads.analyzeFomod',
  'downloads.installFomod',
  'nexus.getAuthStatus',
  'nexus.connect',
  'nexus.disconnect',
  'nxm.captureLinks',
  'nxm.importInboundDownloads',
  'operations.getStatus',
  'operations.cancel'
]);

describe('AI safe action catalog', () => {
  it('covers the exact Phase 9 safe action surface', () => {
    expect(AI_SAFE_ACTION_CATALOG.schema).toBe(AI_SAFE_ACTION_CATALOG_SCHEMA);
    expect(AI_SAFE_ACTION_TOOL_NAMES).toEqual(phase9Tools);
    expect(AI_SAFE_ACTION_CATALOG.tools.map((tool) => tool.name)).toEqual(phase9Tools);
    expect(AI_SAFE_ACTION_CATALOG.toolCount).toBe(phase9Tools.length);
  });

  it('attaches required policy metadata to every tool', () => {
    for (const tool of AI_SAFE_ACTION_CATALOG.tools) {
      expect(tool.jsonSchema.type).toBe('object');
      expect(tool.jsonSchema.additionalProperties).toBe(false);
      expect(tool.jsonSchema.required).toContain('operationId');
      expect(tool.jsonSchema.properties.operationId.description).toContain('operationId');
      expect(tool.permissionClass).toMatch(/^(read|write|destructive|external-network|credential)$/);
      expect(tool.dryRunSupport).toMatch(/^(not-applicable|planned|supported)$/);
      expect(tool.preconditions.length).toBeGreaterThan(0);
      expect(tool.postconditions.length).toBeGreaterThan(0);
      expect(tool.auditLog.category).toBe('AI.Tool');
      expect(tool.auditLog.requiredFields).toEqual(
        expect.arrayContaining(['toolName', 'permissionClass', 'operationId', 'phase', 'result'])
      );
      expect(tool.operationId.required).toBe(true);
      expect(tool.operationId.propagation).toEqual(
        expect.arrayContaining(['renderer-facade', 'tauri-shell', 'bridge-host', 'cpp-core'])
      );
      expect(tool.rollbackNote.length).toBeGreaterThan(20);
      expect(tool.confirmationText.length).toBeGreaterThan(10);
      expect(tool.execution.coreValidation).toBe('required');
      expect(tool.execution.bypassesCoreValidation).toBe(false);
    }
  });

  it('requires approval for all non-read actions and step-by-step approval for destructive actions', () => {
    const destructive = AI_SAFE_ACTION_CATALOG.tools.filter(
      (tool) => tool.permissionClass === 'destructive'
    );
    expect(destructive.map((tool) => tool.name)).toEqual([
      'mods.setAllEnabled',
      'mods.deleteInstalled',
      'downloads.delete'
    ]);

    for (const tool of AI_SAFE_ACTION_CATALOG.tools) {
      if (tool.permissionClass === 'read') {
        expect(tool.approval.required).toBe(false);
        expect(tool.execution.executorQueue).toBe('not-required');
        expect(tool.execution.state).toBe('available');
      } else {
        expect(tool.approval.required).toBe(true);
        expect(tool.execution.executorQueue).toBe('ai-write-executor');
        expect(tool.execution.state).toBe('approval-gated');
      }

      if (tool.permissionClass === 'destructive') {
        expect(tool.approval.mode).toBe('step-by-step');
        expect(tool.riskTags.length).toBeGreaterThan(0);
      }
    }
  });

  it('maps only to existing UI facade/core-backed surfaces', () => {
    for (const tool of AI_SAFE_ACTION_CATALOG.tools) {
      expect(uiSurfaceMethods.has(tool.facadeMethod)).toBe(true);
      expect(tool.bridgeMethod).toBe(tool.name);
      expect(tool.facadeMethod).not.toMatch(/^(dialogs|shell|textFiles|links|processes)\./);
      expect(tool.bridgeMethod).not.toMatch(/^(dialogs|shell|textFiles|links|processes)\./);
    }

    expect(AI_SAFE_ACTION_CATALOG.policy).toMatchObject({
      operationIdRequired: true,
      destructiveActionsRequireApproval: true,
      writeActionsOnlyThroughExecutorQueue: true,
      hiddenDestructiveActions: false,
      coreValidationRequired: true,
      rendererFilesystemAccess: false,
      modelTextCanApproveActions: false
    });
  });

  it('documents plugin missing-master metadata on the read-only plugin command', () => {
    const pluginsList = AI_SAFE_ACTION_CATALOG.tools.find((tool) => tool.name === 'plugins.list');

    expect(pluginsList?.permissionClass).toBe('read');
    expect(pluginsList?.resultFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '[].missingMasters',
          description: expect.stringContaining('missing master filenames')
        }),
        expect.objectContaining({
          path: '[].masterFiles',
          description: expect.stringContaining('Declared master filenames')
        }),
        expect.objectContaining({
          path: '[].name'
        }),
        expect.objectContaining({
          path: '[].sourceMod'
        })
      ])
    );
  });

  it('exposes the catalog through window.fluxora.ai without IPC execution', async () => {
    const calls: string[] = [];
    const ipc: IpcInvoker = {
      invoke: async (channel) => {
        calls.push(channel);
        throw new Error(`Unexpected IPC channel ${channel}`);
      }
    };

    const api = createFluxoraApi(ipc);
    await expect(api.ai.listSafeActions()).resolves.toBe(AI_SAFE_ACTION_CATALOG);
    expect(calls).toEqual([]);
  });
});
