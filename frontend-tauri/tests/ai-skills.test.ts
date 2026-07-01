import { describe, expect, it } from 'vitest';

import {
  FLUXORA_BUILT_IN_SKILL_IDS,
  FLUXORA_SKILL_CATALOG,
  FLUXORA_SKILL_CATALOG_SCHEMA,
  createFluxoraSkillContextNodes,
  selectFluxoraSkillForPrompt,
  validateFluxoraSkillCatalog
} from '../src/shared/ai-skills';
import { AI_SAFE_ACTION_CATALOG } from '../src/shared/ai-safe-action-catalog';
import { createFluxoraApi, type IpcInvoker } from '../src/tauri/fluxora-api';

describe('Fluxora AI skills catalog', () => {
  it('defines the Phase 14 FluxoraSkill format and all built-in skills', () => {
    expect(FLUXORA_SKILL_CATALOG.schema).toBe(FLUXORA_SKILL_CATALOG_SCHEMA);
    expect(FLUXORA_SKILL_CATALOG.builtInSkillCount).toBe(12);
    expect(FLUXORA_SKILL_CATALOG.skills.map((skill) => skill.id)).toEqual(
      FLUXORA_BUILT_IN_SKILL_IDS
    );

    for (const skill of FLUXORA_SKILL_CATALOG.skills) {
      expect(['skill.md', 'SKILL.MD']).toContain(skill.skillMarkdown.fileName);
      expect(skill.skillMarkdown.sourcePath).toBeTruthy();
      expect(skill.skillMarkdown.noExecutableScripts).toBe(true);
      expect(skill.manifest.fileName).toBe('manifest.json');
      if (skill.id !== 'general-concise-response') {
        expect(skill.manifest.allowedTools.length).toBeGreaterThan(0);
      }
      expect(skill.manifest.gameScopes.length).toBeGreaterThan(0);
      expect(skill.manifest.activation.triggers.length).toBeGreaterThan(0);
      expect(skill.manifest.requiredProviderCapabilities.length).toBeGreaterThan(0);
      expect(skill.manifest.examplePrompts.length).toBeGreaterThan(0);
      expect(skill.manifest.validationChecklist.length).toBeGreaterThan(0);
      expect(skill.manifest.securityNotes.length).toBeGreaterThan(0);
      expect(skill.retrieval.nodeKind).toBe('Skill');
      expect(skill.retrieval.contextNodeId).toBe(`skill:${skill.id}`);
    }
  });

  it('keeps skill permissions bounded by the safe action catalog', () => {
    const safeToolNames = new Set(AI_SAFE_ACTION_CATALOG.tools.map((tool) => tool.name));

    expect(validateFluxoraSkillCatalog()).toEqual([]);
    for (const skill of FLUXORA_SKILL_CATALOG.skills) {
      for (const tool of skill.manifest.allowedTools) {
        expect(safeToolNames.has(tool)).toBe(true);
      }
    }

    expect(FLUXORA_SKILL_CATALOG.policy).toMatchObject({
      skillCanGrantNewTools: false,
      allowedToolsMustExistInSafeCatalog: true,
      visibleSkillSelectionRequired: true,
      retrievalViaContextGraph: true
    });
    expect(FLUXORA_SKILL_CATALOG.userSkillPolicy).toMatchObject({
      localOnlyByDefault: true,
      executableScriptsAllowed: false,
      importExportWithSignature: 'later',
      skillCanGrantNewTools: false
    });
  });

  it('selects skills through context-graph-style prompt retrieval', () => {
    const compatibility = selectFluxoraSkillForPrompt(
      'Проверь Nexus compatibility and dependencies for these mods',
      'op_skill_compat',
      new Date('2026-06-30T09:00:00Z')
    );
    const fomod = selectFluxoraSkillForPrompt(
      'Help me choose FOMOD installer options',
      'op_skill_fomod',
      new Date('2026-06-30T09:01:00Z')
    );
    const optimization = selectFluxoraSkillForPrompt(
      'Optimize Skyrim draw calls, script lag, texture size and VRAM',
      'op_skill_optimization',
      new Date('2026-06-30T09:02:00Z')
    );
    const stability = selectFluxoraSkillForPrompt(
      'Skyrim AE CTD on loading an old save; check crash log Possible Relevant Objects and ReSaver',
      'op_skill_stability',
      new Date('2026-06-30T09:02:15Z')
    );
    const analyze = selectFluxoraSkillForPrompt(
      'Проанализируй сборку, она крашит. Нужно посмотреть README.txt и loadorder.txt',
      'op_skill_analyze',
      new Date('2026-06-30T09:02:20Z')
    );
    const missingMasters = selectFluxoraSkillForPrompt(
      'В сборке Skyrim один недостающий мастер-файл, найди какой плагин его требует',
      'op_skill_missing_masters',
      new Date('2026-06-30T09:02:30Z')
    );
    const skyrimReview = selectFluxoraSkillForPrompt(
      'Оцени сборку на Скайрим: 395 плагинов и возможный лимит',
      'op_skill_skyrim_review',
      new Date('2026-06-30T09:02:45Z')
    );
    const unknown = selectFluxoraSkillForPrompt(
      'hello',
      'op_skill_general',
      new Date('2026-06-30T09:03:00Z')
    );

    expect(compatibility.selectedSkillId).toBe('nexus-compatibility-check');
    expect(compatibility.selectedSkill?.displayName).toBe('Nexus compatibility check');
    expect(compatibility.retrieval.via).toBe('context-graph');
    expect(compatibility.retrieval.nodeKind).toBe('Skill');
    expect(fomod.selectedSkillId).toBe('fomod-install-assistant');
    expect(optimization.selectedSkillId).toBe('skyrimse-build-optimization');
    expect(optimization.candidateSkillIds).toContain('general-concise-response');
    expect(stability.selectedSkillId).toBe('skyrimse-stability-diagnosis');
    expect(stability.candidateSkillIds).toContain('skyrimse-default-rules');
    expect(analyze.selectedSkillId).toBe('general-analyze');
    expect(analyze.selectedSkill?.displayName).toBe('Analyze');
    expect(analyze.selectedSkill?.allowedTools).toContain('local.read_text_file');
    expect(analyze.candidateSkillIds).toContain('general-concise-response');
    expect(missingMasters.selectedSkillId).toBe('missing-masters-diagnosis');
    expect(missingMasters.candidateSkillIds).toEqual(
      expect.arrayContaining(['general-concise-response', 'skyrimse-default-rules'])
    );
    expect(skyrimReview.selectedSkillId).toBe('skyrimse-default-rules');
    expect(unknown.selectedSkillId).toBe('general-concise-response');
    expect(unknown.policy.skillCanGrantNewTools).toBe(false);
  });

  it('projects built-in skills as Skill context graph nodes', () => {
    const nodes = createFluxoraSkillContextNodes();

    expect(nodes).toHaveLength(FLUXORA_BUILT_IN_SKILL_IDS.length);
    expect(nodes.map((node) => node.kind)).toEqual(
      Array(FLUXORA_BUILT_IN_SKILL_IDS.length).fill('Skill')
    );
    expect(nodes.find((node) => node.id === 'skill:missing-masters-diagnosis')).toMatchObject({
      label: 'Missing masters diagnosis'
    });
  });

  it('exposes skills through window.fluxora.ai without IPC execution', async () => {
    const calls: string[] = [];
    const ipc: IpcInvoker = {
      invoke: async (channel) => {
        calls.push(channel);
        throw new Error(`Unexpected IPC channel ${channel}`);
      }
    };

    const api = createFluxoraApi(ipc);
    await expect(api.ai.listSkills()).resolves.toBe(FLUXORA_SKILL_CATALOG);
    expect(calls).toEqual([]);
  });
});
