import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY,
  DEFAULT_AI_WEB_QUERY_PLAN_BUDGET,
  createAiCaseState,
  createAiLocalInspection,
  createAiModResearchEvidenceCard,
  createAiNexusInvestigation,
  createAiWebQueryPlan,
  planAiNonNexusWebQueries,
  validateAiModResearchPipelineDto,
  type FluxoraAiLocalInspection,
  type FluxoraAiModResearchFinding,
  type FluxoraAiModResearchSearchBudget
} from '../src/shared/ai-mod-research-pipeline';

const generatedAt = new Date('2026-07-02T12:00:00Z');
const operationId = 'op_web_query_plan';

const searchBudget: FluxoraAiModResearchSearchBudget = {
  localInspectionFiles: 8,
  nexusApiRequests: 4,
  publicWebQueries: 3,
  externalFetches: 8,
  evidenceCards: 12,
  timeoutMs: 30_000
};

const localFinding: FluxoraAiModResearchFinding = {
  id: 'finding-missing-master',
  claim: 'Lux Patch.esp is disabled because Lux.esp is missing locally.',
  relevantMods: ['Lux Patch', 'Lux'],
  affectedVersions: [],
  evidenceIds: ['local:plugins'],
  confidence: 0.96,
  deterministic: true
};

const evidenceCard = () =>
  createAiModResearchEvidenceCard({
    operationId,
    generatedAt,
    sourceId: 'local:plugins',
    sourceType: 'local-metadata',
    sourceTier: 'local-authoritative',
    claim: localFinding.claim,
    relevantMods: localFinding.relevantMods,
    affectedVersions: [],
    evidenceStrength: 'direct',
    confidence: 0.96,
    contradictionRisk: 'low'
  });

const localInspection = (overrides: Partial<FluxoraAiLocalInspection> = {}) =>
  createAiLocalInspection({
    operationId,
    generatedAt,
    needMoreLocalData: false,
    missingFields: [],
    deterministicFindings: [],
    hypotheses: [],
    suspect_mods: [
      {
        id: 'suspect-compass-navigation-overhaul',
        label: 'Compass Navigation Overhaul',
        reason: 'Crash log names this DLL and needs compatibility verification.',
        relevantMods: ['Compass Navigation Overhaul'],
        confidence: 0.72
      }
    ],
    evidenceCards: [evidenceCard()],
    ...overrides
  });

const nexusInvestigation = () =>
  createAiNexusInvestigation({
    operationId,
    generatedAt,
    targetNexusIds: ['skyrimspecialedition:12345'],
    api: {
      state: 'available',
      unavailableReason: 'none',
      lastHttpStatus: 200,
      retryAfterSeconds: null
    },
    quota: {
      hourlyRemaining: 20,
      dailyRemaining: 200,
      resetAt: null,
      source: 'headers'
    },
    ordinaryError: null,
    deterministicFindings: [],
    hypotheses: [],
    evidenceCards: []
  });

describe('AI non-Nexus web query planner', () => {
  it('does not generate queries for an already-supported local finding', () => {
    const inspection = localInspection({
      deterministicFindings: [localFinding],
      suspect_mods: [],
      evidenceCards: [evidenceCard()]
    });
    const caseState = createAiCaseState({
      operationId,
      generatedAt,
      caseState: 'local-inspection-complete',
      tokenSafeSummary: 'Local plugin evidence fully explains the issue.',
      resolvedFacts: [localFinding.claim],
      openQuestions: [],
      discardedHypotheses: [],
      sourceIds: ['local:plugins.txt'],
      quotaState: {
        nexusApiState: 'not-requested',
        unavailableReason: 'none',
        lastHttpStatus: null,
        retryAfterSeconds: null,
        quota: null,
        limitation: null
      },
      nextRecommendedStage: 'run-nexus-pass'
    });

    const plan = planAiNonNexusWebQueries({
      operationId,
      generatedAt,
      localInspection: inspection,
      nexusInvestigation: nexusInvestigation(),
      caseState,
      game: 'Skyrim Special Edition',
      gameVersion: '1.6.1170'
    });

    expect(plan.schema).toBe('fluxora.ai.web-query-plan.v1');
    expect(plan.route).toBe('blocked');
    expect(plan.stopReason).toBe('supported-by-prior-evidence');
    expect(plan.budget).toEqual(DEFAULT_AI_WEB_QUERY_PLAN_BUDGET);
    expect(plan.queries).toEqual([]);
    expect(validateAiModResearchPipelineDto(plan)).toEqual({ ok: true, errors: [] });
  });

  it('caps unsupported-claim planning at three high-signal queries', () => {
    const plan = planAiNonNexusWebQueries({
      operationId,
      generatedAt,
      localInspection: localInspection(),
      nexusInvestigation: nexusInvestigation(),
      game: 'Skyrim Special Edition',
      gameVersion: '1.6.1170',
      exactTokens: ['EXCEPTION_ACCESS_VIOLATION', 'CompassNavigationOverhaul.dll'],
      compatibilityKeywords: ['SKSE', 'Address Library'],
      unsupportedClaims: [
        'CompassNavigationOverhaul.dll appears in an EXCEPTION_ACCESS_VIOLATION crash.',
        'Compass Navigation Overhaul may need a Skyrim Special Edition 1.6.1170 compatibility update.',
        'The crash may be tied to SKSE or Address Library compatibility.',
        'The installed file may be stale for the current runtime.'
      ]
    });

    expect(plan.route).toBe('non-nexus-web');
    expect(plan.budget.maxQueries).toBe(3);
    expect(plan.budget.maxPages).toBe(8);
    expect(plan.budget.stopWhenSupportedClaimFound).toBe(true);
    expect(plan.searchBudget.publicWebQueries).toBe(3);
    expect(plan.searchBudget.externalFetches).toBe(8);
    expect(plan.queries).toHaveLength(3);
    expect(plan.queries.every((query) => query.namedSuspects.length > 0)).toBe(true);
    expect(validateAiModResearchPipelineDto(plan)).toEqual({ ok: true, errors: [] });
  });

  it('includes named suspects and exact crash, game, version, or compatibility terms when available', () => {
    const plan = planAiNonNexusWebQueries({
      operationId,
      generatedAt,
      localInspection: localInspection(),
      nexusInvestigation: nexusInvestigation(),
      game: 'Skyrim Special Edition',
      gameVersion: '1.6.1170',
      exactTokens: ['EXCEPTION_ACCESS_VIOLATION', 'CompassNavigationOverhaul.dll'],
      compatibilityKeywords: ['SKSE', 'Address Library'],
      unsupportedClaims: [
        'CompassNavigationOverhaul.dll appears in an EXCEPTION_ACCESS_VIOLATION crash.'
      ]
    });
    const query = plan.queries[0];

    expect(query.query).toContain('Compass Navigation Overhaul');
    expect(query.query).toContain('CompassNavigationOverhaul.dll');
    expect(query.query).toContain('EXCEPTION_ACCESS_VIOLATION');
    expect(query.query).toContain('Skyrim Special Edition');
    expect(query.query).toContain('1.6.1170');
    expect(query.query).toContain('SKSE');
    expect(query.preferredDomains).toEqual(
      DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.preferredNonNexusDomains.map(
        (domain) => domain.domain
      )
    );
    expect(plan.sourcePolicyTiers.map((tier) => tier.tier)).toEqual(['A', 'B', 'C', 'D']);
    expect(plan.preferredNonNexusDomains.every((domain) => !domain.domain.includes('nexusmods'))).toBe(
      true
    );
    expect(plan.negativeTerms).toEqual(expect.arrayContaining(['best mods', 'crash fix']));
    expect(plan.discardHints).toEqual(expect.arrayContaining(['generic SEO crash-fix page']));
  });

  it('rejects generic SEO-style crash queries without exact suspect or error anchors', () => {
    const invalidPlan = createAiWebQueryPlan({
      operationId,
      generatedAt,
      route: 'non-nexus-web',
      searchBudget,
      budget: DEFAULT_AI_WEB_QUERY_PLAN_BUDGET,
      sourcePolicyTiers: DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.sourcePolicyTiers,
      preferredNonNexusDomains:
        DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.preferredNonNexusDomains,
      deniedDomains: DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.deniedDomains,
      negativeTerms: DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.negativeTerms,
      discardHints: DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.discardHints,
      stopReason: 'unsupported-claims',
      queries: [
        {
          id: 'query-generic-crash-fix',
          query: 'best mods skyrim crash fix',
          reason: 'Generic search seed that should never reach external research.',
          required: true,
          namedSuspectIds: [],
          namedSuspects: [],
          exactTokens: [],
          game: 'Skyrim Special Edition',
          gameVersion: null,
          compatibilityKeywords: [],
          preferredDomains: ['github.com'],
          expectedSourceTiers: ['D'],
          negativeTerms: [],
          discardHints: [],
          dedupeKey: 'generic-crash-fix'
        }
      ],
      discardedSources: []
    });

    expect(validateAiModResearchPipelineDto(invalidPlan)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        'dto.queries[0].query is too generic for the non-Nexus planner.'
      ])
    });
  });
});
