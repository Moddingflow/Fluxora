import { describe, expect, it } from 'vitest';

import {
  AI_CASE_STATE_SCHEMA,
  AI_DIAGNOSIS_JUDGE_SCHEMA,
  AI_EVIDENCE_CARD_SCHEMA,
  AI_EXTERNAL_INVESTIGATION_SCHEMA,
  AI_LOCAL_INSPECTION_SCHEMA,
  AI_MOD_RESEARCH_PIPELINE_SCHEMA_IDS,
  AI_MOD_RESEARCH_PIPELINE_SCHEMAS,
  AI_MOD_RESEARCH_ROUTE_SCHEMA,
  AI_NEXUS_INVESTIGATION_SCHEMA,
  AI_WEB_QUERY_PLAN_SCHEMA,
  DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY,
  DEFAULT_AI_WEB_QUERY_PLAN_BUDGET,
  compressAiCaseState,
  createAiCaseState,
  createAiDiagnosisJudge,
  createAiExternalInvestigation,
  createAiLocalInspection,
  createAiModResearchEvidenceCard,
  createAiModResearchRoute,
  createAiNexusInvestigation,
  createAiWebQueryPlan,
  validateAiModResearchEvidenceCard,
  validateAiModResearchPipelineDto,
  type FluxoraAiModResearchEvidenceCard,
  type FluxoraAiModResearchFinding,
  type FluxoraAiModResearchHypothesis,
  type FluxoraAiModResearchSearchBudget
} from '../src/shared/ai-mod-research-pipeline';

const generatedAt = new Date('2026-07-02T10:00:00Z');
const operationId = 'op_mod_research_contract';

const searchBudget: FluxoraAiModResearchSearchBudget = {
  localInspectionFiles: 8,
  nexusApiRequests: 4,
  publicWebQueries: 2,
  externalFetches: 3,
  evidenceCards: 10,
  timeoutMs: 30_000
};

const evidenceCard = (): FluxoraAiModResearchEvidenceCard =>
  createAiModResearchEvidenceCard({
    operationId,
    generatedAt,
    sourceId: 'local:plugins.txt',
    sourceType: 'local-file',
    sourceTier: 'local-authoritative',
    claim: 'The build contains ExamplePatch.esp.',
    relevantMods: ['Example Patch'],
    affectedVersions: ['1.0.0'],
    evidenceStrength: 'direct',
    confidence: 0.92,
    contradictionRisk: 'low'
  });

const finding: FluxoraAiModResearchFinding = {
  id: 'finding-plugin-present',
  claim: 'ExamplePatch.esp is installed locally.',
  relevantMods: ['Example Patch'],
  affectedVersions: ['1.0.0'],
  evidenceIds: ['local:plugins.txt'],
  confidence: 0.9,
  deterministic: true
};

const hypothesis: FluxoraAiModResearchHypothesis = {
  id: 'hypothesis-version-conflict',
  claim: 'The patch may be built for an older dependency.',
  relevantMods: ['Example Patch', 'Example Dependency'],
  affectedVersions: ['1.x'],
  evidenceIds: ['local:plugins.txt'],
  confidence: 0.55,
  falsifiableBy: 'Read Nexus file metadata for both mods.'
};

describe('AI mod research pipeline schemas', () => {
  it('exports strict v1 schema constants for every staged DTO', () => {
    expect(AI_MOD_RESEARCH_PIPELINE_SCHEMA_IDS).toEqual([
      'fluxora.ai.mod-research-route.v1',
      'fluxora.ai.local-inspection.v1',
      'fluxora.ai.evidence-card.v1',
      'fluxora.ai.nexus-investigation.v1',
      'fluxora.ai.web-query-plan.v1',
      'fluxora.ai.external-investigation.v1',
      'fluxora.ai.diagnosis-judge.v1',
      'fluxora.ai.case-state.v1'
    ]);

    for (const schemaId of AI_MOD_RESEARCH_PIPELINE_SCHEMA_IDS) {
      const schema = AI_MOD_RESEARCH_PIPELINE_SCHEMAS[schemaId];
      expect(schema.schema).toBe(schemaId);
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(
        expect.arrayContaining(['schema', 'generatedAt', 'operationId'])
      );
    }

    expect(AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_MOD_RESEARCH_ROUTE_SCHEMA].required).toEqual(
      expect.arrayContaining(['route', 'needMoreLocalData', 'missingFields', 'suspects', 'searchBudget'])
    );
    expect(AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_EVIDENCE_CARD_SCHEMA].required).toEqual(
      expect.arrayContaining([
        'sourceId',
        'sourceIds',
        'sourceType',
        'sourceTier',
        'citations',
        'claim',
        'relevantMods',
        'affectedVersions',
        'evidenceStrength',
        'corroborationCount',
        'confidence',
        'contradictionRisk',
        'instructionsAllowed',
        'rawContentRetained'
      ])
    );
    expect(AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_NEXUS_INVESTIGATION_SCHEMA].required).toEqual(
      expect.arrayContaining(['api', 'quota', 'ordinaryError'])
    );
    expect(AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_EXTERNAL_INVESTIGATION_SCHEMA].required).toEqual(
      expect.arrayContaining(['discardedSources', 'conflicts'])
    );
    expect(AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_DIAGNOSIS_JUDGE_SCHEMA].required).toEqual(
      expect.arrayContaining([
        'status',
        'confidence',
        'rankedCauses',
        'insufficientReasons',
        'deterministicFindings',
        'hypotheses'
      ])
    );
    expect(AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_CASE_STATE_SCHEMA].required).toEqual(
      expect.arrayContaining([
        'caseState',
        'tokenSafeSummary',
        'resolvedFacts',
        'openQuestions',
        'discardedHypotheses',
        'sourceIds',
        'quotaState',
        'nextRecommendedStage'
      ])
    );
    expect(AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_LOCAL_INSPECTION_SCHEMA].required).toEqual(
      expect.arrayContaining(['deterministicFindings', 'hypotheses', 'evidenceCards'])
    );
    expect(AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_WEB_QUERY_PLAN_SCHEMA].required).toEqual(
      expect.arrayContaining([
        'searchBudget',
        'budget',
        'sourcePolicyTiers',
        'preferredNonNexusDomains',
        'negativeTerms',
        'discardHints',
        'discardedSources'
      ])
    );
  });

  it('builds DTOs with exact schema ids and validates the staged pipeline shape', () => {
    const card = evidenceCard();
    const route = createAiModResearchRoute({
      operationId,
      generatedAt,
      route: 'nexus',
      needMoreLocalData: false,
      missingFields: [],
      suspects: [
        {
          id: 'suspect-example-patch',
          label: 'Example Patch',
          reason: 'Installed plugin depends on metadata not present locally.',
          relevantMods: ['Example Patch'],
          confidence: 0.7
        }
      ],
      searchBudget
    });
    const localInspection = createAiLocalInspection({
      operationId,
      generatedAt,
      needMoreLocalData: false,
      missingFields: [],
      deterministicFindings: [finding],
      hypotheses: [hypothesis],
      suspect_mods: [
        {
          id: 'suspect-example-patch',
          label: 'Example Patch',
          reason: 'Local evidence references Example Patch.',
          relevantMods: ['Example Patch'],
          confidence: 0.7
        }
      ],
      evidenceCards: [card]
    });
    const webPlan = createAiWebQueryPlan({
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
          id: 'query-example-patch',
          query: 'Example Patch Example Dependency Skyrim Special Edition 1.6.1170 compatibility maintainer docs',
          reason: 'Nexus metadata did not provide a direct compatibility claim.',
          required: true,
          namedSuspectIds: ['suspect-example-patch'],
          namedSuspects: ['Example Patch'],
          exactTokens: [],
          game: 'Skyrim Special Edition',
          gameVersion: '1.6.1170',
          compatibilityKeywords: ['compatibility'],
          preferredDomains:
            DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.preferredNonNexusDomains.map(
              (domain) => domain.domain
            ),
          expectedSourceTiers: ['B', 'C'],
          negativeTerms: DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.negativeTerms,
          discardHints: DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.discardHints,
          dedupeKey: 'example-patch-compatibility'
        }
      ],
      discardedSources: [
        {
          sourceId: 'web:duplicate',
          url: 'https://example.invalid/duplicate',
          title: 'Duplicate result',
          discardReason: 'duplicate',
          reasonDetails: 'Same claim and source as a stronger card.'
        }
      ]
    });
    const externalInvestigation = createAiExternalInvestigation({
      operationId,
      generatedAt,
      searchBudget,
      deterministicFindings: [finding],
      hypotheses: [hypothesis],
      evidenceCards: [card],
      discardedSources: webPlan.discardedSources,
      conflicts: []
    });
    const diagnosis = createAiDiagnosisJudge({
      operationId,
      generatedAt,
      status: 'ranked',
      confidence: 0.72,
      rankedCauses: [
        {
          id: 'cause-version-conflict',
          rank: 1,
          cause: 'Example Patch may target an older dependency version.',
          confidence: 0.72,
          supportingEvidenceIds: [card.sourceId],
          opposingEvidenceIds: [],
          affectedMods: ['Example Patch', 'Example Dependency'],
          expectedSymptoms: ['Runtime-dependent patch can fail when the dependency version differs.'],
          fastestValidationTest: 'Compare installed plugin version with Nexus latest file metadata.',
          recommendedFix: 'Update Example Patch or install the matching dependency version.',
          why: ['Nexus and local evidence support a version-compatibility root cause.'],
          whyNot: [],
          fixOrder: [
            'Confirm installed dependency version',
            'Install the matching patch or dependency version',
            'Re-run the compatibility check'
          ]
        }
      ],
      insufficientReasons: [],
      deterministicFindings: [finding],
      hypotheses: [hypothesis]
    });
    const caseState = createAiCaseState({
      operationId,
      generatedAt,
      caseState: 'diagnosis-complete',
      tokenSafeSummary: 'Local inspection found ExamplePatch.esp and one unresolved compatibility hypothesis.',
      resolvedFacts: ['ExamplePatch.esp is present.'],
      openQuestions: ['Which dependency version is required by the patch?'],
      discardedHypotheses: [
        {
          hypothesisId: 'hypothesis-load-order-only',
          claim: 'This is only a load-order issue.',
          discardReason: 'No local plugin conflict supports a load-order-only explanation.',
          evidenceIds: [card.sourceId]
        }
      ],
      sourceIds: [card.sourceId],
      quotaState: {
        nexusApiState: 'available',
        unavailableReason: 'none',
        lastHttpStatus: 200,
        retryAfterSeconds: null,
        quota: {
          hourlyRemaining: 20,
          dailyRemaining: 200,
          resetAt: null,
          source: 'headers'
        },
        limitation: null
      },
      nextRecommendedStage: 'write-final-answer'
    });

    for (const dto of [card, route, localInspection, webPlan, externalInvestigation, diagnosis, caseState]) {
      expect(validateAiModResearchPipelineDto(dto)).toEqual({ ok: true, errors: [] });
    }

    expect(route.schema).toBe(AI_MOD_RESEARCH_ROUTE_SCHEMA);
    expect(localInspection.schema).toBe(AI_LOCAL_INSPECTION_SCHEMA);
    expect(webPlan.schema).toBe(AI_WEB_QUERY_PLAN_SCHEMA);
    expect(externalInvestigation.schema).toBe(AI_EXTERNAL_INVESTIGATION_SCHEMA);
    expect(diagnosis.schema).toBe(AI_DIAGNOSIS_JUDGE_SCHEMA);
    expect(caseState.schema).toBe(AI_CASE_STATE_SCHEMA);
    expect(card.instructionsAllowed).toBe(false);
    expect(card.rawContentRetained).toBe(false);
    expect(card.sourceIds).toEqual(['local:plugins.txt']);
    expect(card.citations).toEqual([
      {
        sourceId: 'local:plugins.txt',
        url: null,
        title: 'local:plugins.txt',
        locator: 'source snapshot'
      }
    ]);
    expect(card.corroborationCount).toBe(1);
  });

  it('compresses structured milestones into token-safe case state', () => {
    const card = evidenceCard();
    const localInspection = createAiLocalInspection({
      operationId,
      generatedAt,
      needMoreLocalData: false,
      missingFields: [],
      deterministicFindings: [finding],
      hypotheses: [hypothesis],
      suspect_mods: [],
      evidenceCards: [card]
    });
    const diagnosis = createAiDiagnosisJudge({
      operationId,
      generatedAt,
      status: 'ranked',
      confidence: 0.72,
      rankedCauses: [
        {
          id: 'cause-version-conflict',
          rank: 1,
          cause: 'Example Patch may target an older dependency version.',
          confidence: 0.72,
          supportingEvidenceIds: [card.sourceId],
          opposingEvidenceIds: [],
          affectedMods: ['Example Patch', 'Example Dependency'],
          expectedSymptoms: ['Runtime-dependent patch can fail when the dependency version differs.'],
          fastestValidationTest: 'Compare installed plugin version with Nexus latest file metadata.',
          recommendedFix: 'Update Example Patch or install the matching dependency version.',
          why: ['Structured diagnosis ranked this above weaker alternatives.'],
          whyNot: [],
          fixOrder: ['Confirm versions', 'Install matching version', 'Re-run compatibility check']
        }
      ],
      insufficientReasons: [],
      deterministicFindings: [finding],
      hypotheses: [hypothesis]
    });

    const caseState = compressAiCaseState({
      operationId,
      generatedAt,
      caseState: 'diagnosis-complete',
      localInspection,
      diagnosis
    });

    expect(caseState.schema).toBe(AI_CASE_STATE_SCHEMA);
    expect(caseState.caseState).toBe('diagnosis-complete');
    expect(caseState.resolvedFacts[0]).toContain('Confirmed: ExamplePatch.esp is installed locally.');
    expect(caseState.sourceIds).toEqual(['local:plugins.txt']);
    expect(caseState.nextRecommendedStage).toBe('write-final-answer');
    expect(validateAiModResearchPipelineDto(caseState)).toEqual({ ok: true, errors: [] });
  });

  it('does not accept evidence cards that allow source instructions', () => {
    const unsafeCard = {
      ...evidenceCard(),
      instructionsAllowed: true
    };

    expect(validateAiModResearchEvidenceCard(unsafeCard)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['dto.instructionsAllowed must be false.'])
    });
    expect(validateAiModResearchPipelineDto(unsafeCard).ok).toBe(false);
  });

  it('serializes Nexus quota and unavailable API state separately from ordinary errors', () => {
    const nexus = createAiNexusInvestigation({
      operationId,
      generatedAt,
      targetNexusIds: ['skyrim:1234'],
      api: {
        state: 'unavailable',
        unavailableReason: 'service-unavailable',
        lastHttpStatus: 503,
        retryAfterSeconds: 120
      },
      quota: {
        hourlyRemaining: 0,
        dailyRemaining: 312,
        resetAt: '2026-07-02T11:00:00Z',
        source: 'headers'
      },
      ordinaryError: {
        code: 'mod-metadata-missing',
        message: 'The Nexus response did not include the expected mod metadata.',
        retryable: false,
        category: 'provider'
      },
      deterministicFindings: [finding],
      hypotheses: [hypothesis],
      evidenceCards: [evidenceCard()]
    });

    const serialized = JSON.parse(JSON.stringify(nexus)) as typeof nexus;

    expect(serialized.schema).toBe(AI_NEXUS_INVESTIGATION_SCHEMA);
    expect(serialized.api).toEqual({
      state: 'unavailable',
      unavailableReason: 'service-unavailable',
      lastHttpStatus: 503,
      retryAfterSeconds: 120
    });
    expect(serialized.quota).toEqual({
      hourlyRemaining: 0,
      dailyRemaining: 312,
      resetAt: '2026-07-02T11:00:00Z',
      source: 'headers'
    });
    expect(serialized.ordinaryError).toMatchObject({
      code: 'mod-metadata-missing',
      category: 'provider'
    });
    expect(serialized.api).not.toHaveProperty('message');
    expect(validateAiModResearchPipelineDto(serialized)).toEqual({ ok: true, errors: [] });
  });

  it('requires web discarded sources to carry discardReason', () => {
    const invalidWebPlan = createAiWebQueryPlan({
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
      queries: [],
      discardedSources: [
        {
          sourceId: 'web:missing-reason',
          url: null,
          title: 'Missing reason',
          discardReason: 'off-topic',
          reasonDetails: 'Seed value for mutation.'
        }
      ]
    });

    delete (invalidWebPlan.discardedSources[0] as Partial<{ discardReason: string }>).discardReason;

    expect(validateAiModResearchPipelineDto(invalidWebPlan)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        'dto.discardedSources[0].discardReason must be one of: duplicate, off-topic, stale, low-trust, prompt-injection-risk, blocked-by-policy, contradicted-by-stronger-source.'
      ])
    });
  });
});
