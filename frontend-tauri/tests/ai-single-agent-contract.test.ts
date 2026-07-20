import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FluxoraIpcChannels } from '../src/shared/fluxora-api';
import { createFluxoraApi, type IpcInvoker } from '../src/tauri/fluxora-api';

const root = resolve(__dirname, '..');
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), 'utf8');

describe('single-agent product contract', () => {
  it('exposes exactly one provider/model and no orchestration-era renderer DTOs', () => {
    const contract = read('src/shared/fluxora-api.ts');
    expect(contract).toContain("FLUXORA_AI_PROVIDER_ID = 'gemini'");
    expect(contract).toContain("FLUXORA_AI_MODEL_ID = 'gemini-3.1-flash-lite'");
    expect(contract).not.toMatch(/RoutingPreset|Subagent|AutonomousJob|startTask|TaskTrace|CostLedger/);
    expect(contract).not.toContain('local-dry-run');
  });

  it('uses one bounded coordinator with action-wide typed capabilities and read-only answers', () => {
    const host = read('src-tauri/src/bin/fluxora_ai_host.rs');
    const toolContract = read('src-tauri/src/bin/fluxora_ai_host/tool_contract.rs');
    const coordinator = read('src-tauri/src/ai_execution_coordinator.rs');
    expect(host).toContain('"googleSearch"');
    expect(host).toContain('"functionDeclarations"');
    expect(host).toContain('tool_declarations_for_task_kind');
    expect(host).not.toContain('declarations_for_execution_phase');
    expect(host).toContain('fluxora.ai.tool-session.v3');
    expect(host).toContain('action-without-verified-effect');
    expect(host).toContain('ProviderToolMode::LocalAny');
    expect(host).toContain('ProviderToolMode::LocalAuto');
    expect(host).toContain('ProviderToolMode::None');
    expect(coordinator).toContain('fluxora.ai.tool-outcome.v1');
    expect(coordinator).toContain('MAX_RECOVERY_ATTEMPTS_PER_CAUSE: u8 = 2');
    expect(coordinator).toContain('MAX_CONSECUTIVE_NO_EVIDENCE: u8 = 3');
    expect(coordinator).toContain('postconditionVerified');
    expect(coordinator).toContain('semantic-result:');
    expect(coordinator).not.toContain('name.contains(".set_")');
    expect(toolContract).toContain('pub enum ToolOperation');
    expect(toolContract).toContain('pub enum ToolDomain');
    expect(toolContract).toContain('pub enum ToolRisk');
    expect(toolContract).toContain('pub enum ToolVerification');
    expect(toolContract).toContain('pub enum ToolCompensation');
    expect(toolContract).toContain('task_kind == TaskKind::Action || contract.risk == ToolRisk::ReadOnly');
    expect(toolContract).toContain('local.text.stage_patch');
    expect(toolContract).toContain('local.text.stage_create');
    expect(toolContract).toContain('local.json.stage_set_pointer');
    expect(toolContract).toContain('local.ini.stage_set_key');
    expect(toolContract).toContain('local.files.commit');
    expect(toolContract).toContain('local.mods.set_enabled');
    expect(toolContract).toContain('local.plugins.move');
    expect(toolContract).toContain('local.downloads.resume');
    expect(toolContract).toContain('local.installs.submit_download');
    expect(toolContract).toContain('local.settings.set_language');
    expect(toolContract).toContain('LocalRequired');
    expect(toolContract).toContain('WebSearch');
    expect(host).toContain('MAX_AI_TOOL_ROUNDS: u8 = 64');
    expect(host).toContain('MAX_AI_TOOL_CALLS: usize = 128');
    expect(host).toContain('MAX_AI_REQUEST_SECONDS: u64 = 10 * 60');
    expect(host).toContain('newEvidenceCount');
    expect(host).toContain('stagnantResultCount');
    expect(host).toContain('phaseTransitions');
    const shell = read('src-tauri/src/lib.rs');
    expect(shell.indexOf('"buildFiles.beginChat"')).toBeLessThan(shell.indexOf('"chat.beginToolRun"'));
    expect(shell).toContain('nativeSessionPreopened');
    expect(host).not.toMatch(/orchestrat|subagent|local-dry-run/i);
  });

  it('keeps AI out of the global titlebar and inside the selected build header', () => {
    const titlebar = read('src/renderer/components/chrome/AppTitlebar.tsx');
    const buildHeader = read('src/renderer/features/build/BuildDetailHeader.tsx');
    expect(titlebar).not.toMatch(/Toggle AI|onToggleAi|geminiIcon/);
    expect(buildHeader).toContain('Open Fluxora AI for this build');
  });

  it('does not expose shell or arbitrary URL-fetch tools to Gemini', () => {
    const host = read('src-tauri/src/bin/fluxora_ai_host.rs');
    const toolContract = read('src-tauri/src/bin/fluxora_ai_host/tool_contract.rs');
    expect(host).not.toMatch(/functionDeclarations[\s\S]{0,1200}(shell|powershell|cmd\.exe|fetch_url)/i);
    expect(toolContract).not.toMatch(/shell|powershell|cmd\.exe|fetch_url/i);
    expect(host).toContain('There is no shell, command execution, direct URL fetch');
  });

  it('cancels one operation without terminating the shared AI host', () => {
    const shell = read('src-tauri/src/lib.rs');
    const cancelCommand = shell.slice(
      shell.indexOf('async fn fluxora_ai_cancel_run'),
      shell.indexOf('async fn execute_ai_chat_request')
    );
    expect(cancelCommand).toContain('cancelled_operations');
    expect(cancelCommand).not.toContain('terminate_process');
    expect(shell).toContain('active_operations: Mutex<HashSet<String>>');
    const estimateCommand = shell.slice(
      shell.indexOf('async fn fluxora_ai_estimate_context'),
      shell.indexOf('fn remove_private_nexus_credential')
    );
    const chatCommand = shell.slice(
      shell.indexOf('async fn execute_ai_chat_request'),
      shell.indexOf('async fn fluxora_ai_chat_respond')
    );
    expect(estimateCommand).not.toContain('register_ai_operation');
    expect(chatCommand).toContain('register_ai_operation(&app, &operation_id).await');
    expect(chatCommand).toContain('finish_ai_operation(&app, &operation_id).await');
  });

  it('exposes verified native compensation instead of decorative Undo tokens', () => {
    const shell = read('src-tauri/src/lib.rs');
    const contract = read('src/shared/fluxora-api.ts');
    const facade = read('src/tauri/fluxora-api.ts');
    expect(shell).toContain('async fn fluxora_ai_undo_capability');
    expect(shell).toContain('verify_ai_compensation');
    expect(shell).toContain('AiCompensationState');
    expect(shell).not.toContain('restore_install_');
    expect(contract).toContain("aiUndoCapability: 'fluxora:ai:undo-capability'");
    expect(contract).toContain("rollbackState?: 'available' | 'rolling-back' | 'rolled-back' | 'blocked'");
    expect(facade).toContain("invoke<FluxoraAiCapabilityUndoResult>('fluxora_ai_undo_capability'");
  });

  it('passes the opaque compensation token and renderer operation id through the typed facade', async () => {
    const invocations: Array<{ channel: string; args: unknown[] }> = [];
    const ipc: IpcInvoker = {
      invoke: async (channel, ...args) => {
        invocations.push({ channel, args });
        return {
          state: 'rolled-back',
          compensationToken: 'undo-token',
          operationId: 'undo-operation',
          postconditionVerified: true
        };
      }
    };

    const result = await createFluxoraApi(ipc).ai.undoCapability(
      'undo-token',
      { operationId: 'undo-operation' }
    );

    expect(result.postconditionVerified).toBe(true);
    expect(invocations).toEqual([{
      channel: FluxoraIpcChannels.aiUndoCapability,
      args: ['undo-token', { operationId: 'undo-operation' }]
    }]);
  });

  it('uses the current publishable-key contract with a legacy environment alias only', () => {
    const host = read('src-tauri/src/bin/fluxora_ai_host.rs');
    expect(host).toContain('DEFAULT_SUPABASE_PUBLISHABLE_KEY');
    expect(host).toContain('FLUXORA_AI_SUPABASE_PUBLISHABLE_KEY');
    expect(host).toContain('FLUXORA_AI_SUPABASE_ANON_KEY');
  });
});
