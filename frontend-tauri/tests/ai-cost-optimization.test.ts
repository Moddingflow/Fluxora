import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createTauriFluxoraApi } from '../src/tauri/fluxora-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('AI cost optimization and unit economics contract', () => {
  it('returns transparent per-run cost, preflight, routing and margin metadata through the typed facade', async () => {
    const api = createTauriFluxoraApi();
    const response = await api.ai.chatRespond({
      operationId: 'op_ai_cost_contract',
      runId: 'run-ai-cost-contract',
      sessionId: 'session-cost',
      messages: [{ role: 'user', text: 'check this build cheaply' }],
      routingPreset: 'paid-economy'
    });

    expect(response.costEstimate.promptCache.rawPromptStored).toBe(false);
    expect(response.costEstimate.displayCost).toBe(response.costEstimate.hardCost);
    expect(response.costPreflight).toMatchObject({
      schema: 'fluxora.ai.cost-preflight.v1',
      decision: 'allowed',
      runSize: 'ordinary'
    });
    expect(response.costPreflight.wallet).toMatchObject({
      tier: 'paid',
      currency: 'AI credits',
      byokChargesFluxoraBudget: false
    });
    expect(response.routingDecision).toMatchObject({
      schema: 'fluxora.ai.routing-decision.v1',
      cheapClassifierFirst: true,
      premiumRequiresByok: true,
      webModelOnlyWhenNeeded: true
    });
    expect(response.costPipeline).toMatchObject({
      schema: 'fluxora.ai.cost-pipeline.v1',
      retrieveThroughContextGraph: true,
      nexusApiCacheFirst: true,
      deduplicateWebSources: true,
      stopConditionsForLowValueLoops: true
    });
    expect(response.ledgerEntry).toMatchObject({
      costPreflightDecision: 'allowed',
      chargesFluxoraBudget: false,
      pricingVersion: 'browser-preview'
    });
    expect(response.marginTelemetry).toMatchObject({
      metricName: 'gross_margin_after_ai_cost',
      localEstimateOnly: true
    });
  });

  it('keeps Phase 15 enforcement in FluxoraAIHost instead of renderer business logic', () => {
    const sharedApi = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const host = readText('frontend-tauri', 'src-tauri', 'src', 'bin', 'fluxora_ai_host.rs');
    const research = readText('frontend-tauri', 'src-tauri', 'src', 'ai_research.rs');
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const panel = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'ai',
      'AiChatPanel.tsx'
    );

    expect(sharedApi).toContain('FluxoraAiCostPreflight');
    expect(sharedApi).toContain('FluxoraAiRoutingDecision');
    expect(sharedApi).toContain('FluxoraAiMarginTelemetry');
    expect(sharedApi).toContain('gross_margin_after_ai_cost');
    expect(sharedApi).toContain('orchestrationInternalCost?: number');
    expect(sharedApi).toContain('actualInternalCost: number | null');

    expect(host).toContain('SAFE_PROMPT_MAX_MONTHLY_PERCENT');
    expect(host).toContain('FREE_DEMO_WALLET_CREDITS');
    expect(host).toContain('PAID_MONTHLY_WALLET_CREDITS');
    expect(host).toContain('cost_preflight_payload');
    expect(host).toContain('observe_prompt_cache');
    expect(host).toContain('candidate_models(params, research_bundle.as_ref())');
    expect(host).toContain('reply_cost_summary');
    expect(host).toContain('additional_cost');
    expect(host).toContain('"orchestrationInternalCost"');
    expect(host).toContain('"cheapClassifierFirst": true');
    expect(host).toContain('"premiumRequiresByok": true');
    expect(host).toContain('"webModelOnlyWhenNeeded": true');
    expect(host).toContain('"costPreflight": cost_preflight');
    expect(host).toContain('"routingDecision": routing_decision');
    expect(host).toContain('"marginTelemetry": margin_telemetry_payload');

    expect(research).toContain('NEXUS_METADATA_CACHE_TTL_MS');
    expect(research).toContain('cached_nexus_api_snapshot');
    expect(research).toContain('"storesRateLimitHeaders": true');
    expect(research).toContain('fluxora.ai.nexus-investigation.v1');
    expect(research).toContain('apiQuotaState');
    expect(research).toContain('"publicPageFallback": "disabled"');
    expect(research).toContain('webQueryPlan');
    expect(research).toContain('MAX_NON_NEXUS_WEB_QUERIES');
    expect(research).toContain('nextBestNonNexusQueries');

    expect(app).not.toContain('FREE_DEMO_WALLET_CREDITS');
    expect(app).not.toContain('PAID_MONTHLY_WALLET_CREDITS');
    expect(panel).not.toContain('FREE_DEMO_WALLET_CREDITS');
    expect(panel).not.toContain('PAID_MONTHLY_WALLET_CREDITS');
    expect(panel).not.toContain('aiCostLabel');
    expect(panel).not.toContain('actualInternalCost');
  });
});
