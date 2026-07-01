import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { FluxoraIpcChannels, type FluxoraAiHostStatus } from '../src/shared/fluxora-api';
import { createFluxoraApi, type IpcInvoker } from '../src/tauri/fluxora-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tauriRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(tauriRoot, '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const fileExists = (...segments: string[]): boolean =>
  fs.existsSync(path.join(repoRoot, ...segments));

describe('FluxoraAIHost MVP contract', () => {
  it('builds a separate local AI host process and packages it with native resources', () => {
    const cargoToml = readText('frontend-tauri', 'src-tauri', 'Cargo.toml');
    const gitignore = readText('.gitignore');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const stageScript = readText('frontend-tauri', 'scripts', 'stage-native-resources.ps1');
    const buildScript = readText('Build.ps1');

    expect(fileExists('frontend-tauri', 'src-tauri', 'src', 'bin', 'fluxora_ai_host.rs')).toBe(true);
    expect(gitignore).toContain('!frontend-tauri/src-tauri/src/bin/');
    expect(gitignore).toContain('!frontend-tauri/src-tauri/src/bin/**');
    expect(cargoToml).toContain('name = "fluxora-ai-host"');
    expect(cargoToml).toContain('keyring = "');
    expect(rustShell).toContain('FluxoraAIHost.exe');
    expect(rustShell).toContain('fluxora_ai_get_status');
    expect(rustShell).toContain('fluxora_ai_restart_host');
    expect(stageScript).toContain('cargo build --release --bin fluxora-ai-host');
    expect(stageScript).toContain('FluxoraAIHost.exe');
    expect(buildScript).toContain('Build-TauriAiHost');
    expect(buildScript).toContain('Tauri package is missing bundled AI host');
  });

  it('exposes typed window.fluxora.ai methods without renderer credential storage', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const aiStatus: FluxoraAiHostStatus = {
      ready: true,
      operationId: 'op_ai_status',
      health: 'ready',
      providers: [],
      models: [],
      capabilities: {}
    };
    const ipc: IpcInvoker = {
      invoke: async (channel, ...args) => {
        calls.push({ channel, args });
        switch (channel) {
          case FluxoraIpcChannels.aiGetStatus:
          case FluxoraIpcChannels.aiRestartHost:
            return aiStatus;
          case FluxoraIpcChannels.aiListProviders:
          case FluxoraIpcChannels.aiListModels:
            return [];
          case FluxoraIpcChannels.aiChatRespond:
            return {
              operationId: 'op_ai_chat_run',
              providerId: 'local-dry-run',
              modelId: 'local-dry-run',
              routingPreset: 'free-demo',
              status: 'done',
              text: 'Plan: inspect the build safely.',
              streamChunks: [{ index: 0, text: 'Plan: inspect the build safely.' }],
              sources: [],
              costEstimate: {
                currency: 'USD',
                estimatedInputTokens: 4,
                estimatedOutputTokens: 8,
                estimatedCost: 0,
                actualCost: 0,
                internalCost: 0,
                pricingSource: 'test',
                isEstimate: true
              },
              ledgerEntry: {
                operationId: 'op_ai_chat_run',
                providerId: 'local-dry-run',
                modelId: 'local-dry-run',
                routingPreset: 'free-demo',
                estimatedInternalCost: 0,
                actualInternalCost: 0,
                currency: 'USD',
                billable: false,
                createdAt: '2026-06-30T00:00:00.000Z'
              },
              fallbackProviders: [],
              toolCallsAllowed: false
            };
          case FluxoraIpcChannels.aiConnectProvider:
            return {
              providerId: args[0],
              connected: true,
              state: 'connected',
              message: 'connected',
              operationId: 'op_ai_connect'
            };
          case FluxoraIpcChannels.aiDisconnectProvider:
            return {
              providerId: args[0],
              connected: false,
              state: 'disconnected',
              message: 'disconnected',
              operationId: 'op_ai_disconnect'
            };
          case FluxoraIpcChannels.aiTestProvider:
            return {
              providerId: args[0],
              ok: true,
              state: 'ready',
              message: 'ready',
              operationId: 'op_ai_test',
              hostRoundTrip: true,
              checkedAt: 1,
              modelIds: []
            };
          default:
            throw new Error(`Unexpected channel ${channel}`);
        }
      }
    };

    const api = createFluxoraApi(ipc);
    await expect(api.ai.getStatus({ operationId: 'op_ai_status' })).resolves.toBe(aiStatus);
    await expect(api.ai.listSafeActions()).resolves.toMatchObject({
      schema: 'fluxora.ai.safe-action-catalog.v1',
      toolCount: 35,
      policy: {
        operationIdRequired: true,
        coreValidationRequired: true
      }
    });
    await expect(api.ai.listSkills()).resolves.toMatchObject({
      schema: 'fluxora.ai.skills.v1',
      builtInSkillCount: 11,
      userSkillPolicy: {
        localOnlyByDefault: true,
        executableScriptsAllowed: false,
        skillCanGrantNewTools: false
      }
    });
    await expect(
      api.ai.connectProvider('gemini', 'test-secret', { operationId: 'op_ai_connect' })
    ).resolves.toMatchObject({ connected: true, providerId: 'gemini' });
    await expect(api.ai.testProvider('gemini', { operationId: 'op_ai_test' })).resolves.toMatchObject({
      ok: true,
      providerId: 'gemini'
    });
    await expect(
      api.ai.chatRespond({
        operationId: 'op_ai_chat_run',
        sessionId: 'session-1',
        messages: [{ role: 'user', text: 'check plugins' }],
        routingPreset: 'free-demo'
      })
    ).resolves.toMatchObject({
      operationId: 'op_ai_chat_run',
      status: 'done',
      toolCallsAllowed: false
    });
    await expect(
      api.ai.disconnectProvider('gemini', { operationId: 'op_ai_disconnect' })
    ).resolves.toMatchObject({ connected: false, providerId: 'gemini' });

    expect(calls.map((call) => call.channel)).toEqual([
      FluxoraIpcChannels.aiGetStatus,
      FluxoraIpcChannels.aiConnectProvider,
      FluxoraIpcChannels.aiTestProvider,
      FluxoraIpcChannels.aiChatRespond,
      FluxoraIpcChannels.aiDisconnectProvider
    ]);

    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const sharedApi = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    expect(sharedApi).toContain('ai: {');
    expect(sharedApi).toContain('listSafeActions');
    expect(sharedApi).toContain('listSkills');
    expect(sharedApi).toContain('chatRespond');
    expect(sharedApi).toContain('connectProvider');
    expect(sharedApi).toContain('AiSafeActionCatalog');
    expect(sharedApi).toContain('FluxoraSkillCatalog');
    expect(sharedApi).toContain('FluxoraSkillSelection');
    expect(sharedApi).toContain('FluxoraAiCostLedgerEntry');
    expect(sharedApi).toContain('FluxoraAiContextBundle');
    expect(sharedApi).toContain('contextBundle?: FluxoraAiContextBundle | null');
    expect(sharedApi).toContain('FluxoraAiResearchRequest');
    expect(sharedApi).toContain('FluxoraAiResearchReport');
    expect(sharedApi).toContain('researchReport?: FluxoraAiResearchReport | null');
    expect(sharedApi).toContain('FluxoraAiTaskPlan');
    expect(sharedApi).toContain('FluxoraAiSubagentSchedule');
    expect(sharedApi).toContain("status: 'done' | 'blocked' | 'needs-approval'");
    expect(sharedApi).toContain('selectedSkill?: FluxoraSkillSelection | null');
    expect(sharedApi).toContain('taskPlan?: FluxoraAiTaskPlan | null');
    expect(sharedApi).toContain('subagentSchedule?: FluxoraAiSubagentSchedule | null');
    expect(facade).toContain('fluxora_ai_connect_provider');
    expect(facade).toContain('fluxora_ai_chat_respond');
    expect(facade).toContain('AI_SAFE_ACTION_CATALOG');
    expect(facade).toContain('safeActionCatalog');
    expect(facade).toContain('FLUXORA_SKILL_CATALOG');
    expect(facade).toContain('skillCatalog');
    expect(facade).not.toContain('localStorage.setItem');
    expect(facade).not.toContain('indexedDB');
  });

  it('keeps provider chat BYOK-scoped while Phase 5 tools and Phase 7 research stay read-only', () => {
    const aiHost = readText('frontend-tauri', 'src-tauri', 'src', 'bin', 'fluxora_ai_host.rs');
    const aiResearch = readText('frontend-tauri', 'src-tauri', 'src', 'ai_research.rs');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const buildTools = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'ai',
      'ai-build-tools.ts'
    );
    const contextGraph = readText(
      'frontend-tauri',
      'src-tauri',
      'src',
      'ai_context_graph.rs'
    );

    expect(aiHost).toContain('"chatCompletion": { "state": "available", "tools": false }');
    expect(aiHost).toContain('"planner"');
    expect(aiHost).toContain('"schema": "fluxora.ai.task-plan.v1"');
    expect(aiHost).toContain('"subagentScheduler"');
    expect(aiHost).toContain('"autonomousJobs"');
    expect(aiHost).toContain('"schema": "fluxora.ai.autonomous-job.v1"');
    expect(aiHost).toContain('"queueSchema": "fluxora.ai.autonomous-job-queue.v1"');
    expect(aiHost).toContain('"resumeAfterAppRestart": true');
    expect(aiHost).toContain('"watchdogHeartbeat": true');
    expect(aiHost).toContain('"checkpointAfterEveryMajorStep": true');
    expect(aiHost).toContain('"allowedBlockedReasons": ["user", "login", "captcha", "missing-file", "permission", "budget"]');
    expect(aiHost).toContain('"schema": "fluxora.ai.subagent-schedule.v1"');
    expect(aiHost).toContain('"defaultSubagentLimit": 3');
    expect(aiHost).toContain('"maxSubagentsForLargeTasks": 10');
    expect(aiHost).toContain('"writeActionsOnlyThroughQueue": true');
    expect(aiHost).toContain('"hiddenDestructiveActions": false');
    expect(aiHost).toContain('"readOnlyBuildTools"');
    expect(aiHost).toContain('"state": "available"');
    expect(aiHost).toContain('"local.filesystemSnapshot"');
    expect(aiHost).toContain('"schema": "fluxora.ai.local-filesystem-snapshot.v1"');
    expect(aiHost).toContain('"local.detect_skse_plugins"');
    expect(aiHost).toContain('"rawFilesystem": false');
    expect(aiHost).toContain('"contentReads": false');
    expect(aiHost).toContain('"safeActionCatalog"');
    expect(aiHost).toContain('"schema": "fluxora.ai.safe-action-catalog.v1"');
    expect(aiHost).toContain('"toolExecution": "catalog-ready-execution-gated"');
    expect(aiHost).toContain('"skillCatalog"');
    expect(aiHost).toContain('"schema": "fluxora.ai.skills.v1"');
    expect(aiHost).toContain('BUILT_IN_SKILL_IDS');
    expect(aiHost).toContain('"skillCanGrantNewTools": false');
    expect(aiHost).toContain('"executableScriptsAllowed": false');
    expect(aiHost).toContain('"retrieval": {');
    expect(aiHost).toContain('"via": "context-graph"');
    expect(aiHost).toContain('"selectedSkill": selected_skill');
    expect(aiHost).toContain('"schema": "fluxora.ai.skill-selection.v1"');
    expect(aiHost).toContain('do not recommend LOOT as the primary solution');
    expect(aiHost).toContain('enabled non-light/full plugins');
    expect(aiHost).toContain('недостающий мастер');
    expect(aiHost).toContain('SAFE_ACTION_CATALOG_TOOL_NAMES');
    expect(aiHost).toContain('"mods.deleteInstalled"');
    expect(aiHost).toContain('"downloads.delete"');
    expect(aiHost).toContain('"contextGraph"');
    expect(aiHost).toContain('"webResearch"');
    expect(aiHost).toContain('"nexusResearch"');
    expect(aiHost).toContain('"geminiGoogleSearch"');
    expect(aiHost).toContain('collect_ai_research_bundle');
    expect(aiHost).toContain('googleSearchRetrieval');
    expect(aiHost).toContain('FluxoraContextGraph::open_in_memory');
    expect(aiHost).toContain('compact_chat_messages_with_context_graph');
    expect(aiHost).toContain('context_sources_for_citations');
    expect(aiHost).toContain('"toolExecution": { "state": "read-only"');
    expect(aiHost).toContain('"writeTools": false');
    expect(aiHost).toContain('provider_supabase_secret_name');
    expect(aiHost).toContain('GEMINI_API_KEY');
    expect(aiHost).toContain('gemini-3.1-flash-lite');
    expect(aiHost).toContain('gemini-2.5-flash-lite');
    expect(aiHost).not.toContain('DEEPSEEK_API_KEY');
    expect(aiHost).not.toContain('GLM_API_KEY');
    expect(aiHost).not.toContain('deepseek-v4');
    expect(aiHost).not.toContain('glm-4.7');
    expect(aiHost).toContain('supabase_rpc_credential');
    expect(aiHost).toContain('supabase_table_credential');
    expect(aiHost).toContain('AI_CREDENTIAL_SERVICE');
    expect(aiHost).toContain('local_provider_credential(provider)');
    expect(aiHost).toContain('credentialStore": if provider.requires_credential { "os-or-supabase" } else { "none" }');
    expect(facade).not.toContain('DEEPSEEK_API_KEY');
    expect(facade).not.toContain('GLM_API_KEY');
    expect(facade).not.toContain('GEMINI_API_KEY');
    expect(aiHost).toContain('chat.respond');
    expect(aiHost).toContain('task_planning_bundle');
    expect(aiHost).toContain('"taskPlan": task_plan');
    expect(aiHost).toContain('"subagentSchedule": subagent_schedule');
    expect(aiHost).toContain('toolCallsAllowed": false');
    expect(aiHost).toContain('fallbackProviders');
    expect(aiHost).toContain('redacted_provider_error_message');
    expect(aiResearch).toContain('fluxora.ai.research.v1');
    expect(aiResearch).toContain('NEXUSMODS_API_KEY');
    expect(aiResearch).toContain('X-RL-Hourly-Remaining');
    expect(aiResearch).toContain('local-or-private-network-blocked');
    expect(aiResearch).toContain('domain-not-allowlisted');
    expect(aiResearch).toContain('instructionsAllowed');
    expect(aiResearch).toContain('deepResearch');
    expect(rustShell).toContain('fluxora_ai_chat_respond');
    expect(rustShell).toContain('fluxora_operations_get_status');
    expect(rustShell).toContain('fluxora_recent_operation_logs');
    expect(app).toContain('startHostAiRun');
    expect(app).toContain('collectAiBuildContext');
    expect(app).not.toContain('limit: 80');
    expect(app).toContain('window.fluxora.ai');
    expect(buildTools).toContain('AI_READ_ONLY_BUILD_TOOLS');
    expect(buildTools).toContain("permissionClass: 'read'");
    expect(buildTools).toContain("'local.filesystemSnapshot'");
    expect(buildTools).toContain('local.detect_skse_plugins');
    expect(buildTools).toContain('No write, destructive, credential, shell, raw filesystem');
    expect(buildTools).not.toContain('setEnabled(');
    expect(buildTools).not.toContain('deleteInstalled(');
    expect(contextGraph).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS context_nodes_fts');
    expect(contextGraph).toContain('USING fts5');
    expect(contextGraph).toContain('context_embeddings');
    expect(contextGraph).toContain('FluxoraContextGraph selected exact, SQLite FTS5');
    expect(contextGraph).toContain('active full-slot plugins');
  });

  it('fails the chat UI closed when the AI host status is unavailable', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const panel = readText('frontend-tauri', 'src', 'renderer', 'features', 'ai', 'AiChatPanel.tsx');

    expect(app).toContain('window.fluxora.ai.getStatus');
    expect(app).toContain("code: 'ai.host.unavailable'");
    expect(app).toContain('!aiHostStatus?.ready');
    expect(app).toContain('aiProviderDiagnostic(aiChatSettings, aiHostStatus)');
    expect(app).toContain('AI_CONTEXT_SOURCE_URL_PREFIX');
    expect(app).toContain('safeAiSourceUrl');
    expect(panel).toContain('data-host-ready');
    expect(panel).toContain('providerDiagnostic');
    expect(panel).toContain('ai-chat-diagnostic');
    expect(panel).toContain('providerDiagnostics');
    expect(panel).toContain("hostReady ? activeStatusLabel : 'Unavailable'");
    expect(panel).toContain('disabled={inputDisabled}');
  });

  it('keeps AI chat tabs closeable with the licensed circle icon affordance', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const panel = readText('frontend-tauri', 'src', 'renderer', 'features', 'ai', 'AiChatPanel.tsx');
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const icon = readText('Icons', 'circle-x.svg');
    const iconReadme = readText('Icons', 'README.md');

    expect(app).toContain("dispatchAiChat({ type: 'close-chat', chatId })");
    expect(panel).toContain("import closeTabIcon from '../../../../../Icons/circle-x.svg';");
    expect(panel).toContain('onCloseChat: (chatId: string) => void;');
    expect(panel).toContain('event.stopPropagation();');
    expect(panel).toContain('className="ai-chat-tab__close"');
    expect(panel).toContain('src={closeTabIcon}');
    expect(styles).toContain('.ai-chat-tab-shell:hover .ai-chat-tab__close:not(:disabled)');
    expect(styles).not.toContain('--ai-chat-tab-close-icon');
    expect(styles).not.toContain('mask: var(--ai-chat-tab-close-icon)');
    expect(icon).toContain('<circle cx="12" cy="12" r="10" />');
    expect(iconReadme).toContain('Lucide is distributed under the ISC license and supports commercial use.');
  });
});
