import { describe, expect, it } from 'vitest';

import {
  compressAiCaseState,
  createAiDiagnosisJudge,
  createAiExternalInvestigation,
  createAiLocalInspection,
  createAiModResearchEvidenceCard,
  createAiNexusInvestigation,
  validateAiModResearchPipelineDto,
  type FluxoraAiModResearchFinding,
  type FluxoraAiModResearchHypothesis
} from '../src/shared/ai-mod-research-pipeline';

const operationId = 'op_case_state_compressor';
const generatedAt = new Date('2026-07-02T12:00:00Z');

const missingMasterFinding: FluxoraAiModResearchFinding = {
  id: 'finding-missing-master',
  claim: 'Weather Patch.esp has missing master WeatherCore.esm.',
  relevantMods: ['Weather Patch'],
  affectedVersions: [],
  evidenceIds: ['local:plugins.loadOrder'],
  confidence: 0.96,
  deterministic: true
};

const weakHypothesis: FluxoraAiModResearchHypothesis = {
  id: 'hypothesis-load-order-only',
  claim: 'The issue may be only a load-order problem.',
  relevantMods: ['Weather Patch'],
  affectedVersions: [],
  evidenceIds: ['forum:single-user-load-order'],
  confidence: 0.31,
  falsifiableBy: 'Compare against local missing-master evidence and official metadata.'
};

describe('AI case-state compressor', () => {
  it('drops raw snippets but keeps source ids and resolved facts', () => {
    const localInspection = createAiLocalInspection({
      operationId,
      generatedAt,
      needMoreLocalData: false,
      missingFields: [],
      deterministicFindings: [missingMasterFinding],
      hypotheses: [weakHypothesis],
      suspect_mods: [],
      evidenceCards: [
        createAiModResearchEvidenceCard({
          operationId,
          generatedAt,
          sourceId: 'local:plugins.loadOrder',
          sourceType: 'local-metadata',
          sourceTier: 'local-authoritative',
          claim: missingMasterFinding.claim,
          relevantMods: ['Weather Patch'],
          affectedVersions: [],
          evidenceStrength: 'direct',
          confidence: 0.96,
          contradictionRisk: 'low'
        })
      ]
    });
    (localInspection as unknown as { rawPageSnippet: string }).rawPageSnippet =
      'PRIVATE_RAW_PAGE_SNIPPET with full user file contents and token=secret-value';

    const caseState = compressAiCaseState({
      operationId,
      generatedAt,
      caseState: 'local-inspection-complete',
      localInspection
    });

    expect(validateAiModResearchPipelineDto(caseState)).toEqual({ ok: true, errors: [] });
    expect(caseState.sourceIds).toEqual(['local:plugins.loadOrder', 'forum:single-user-load-order']);
    expect(caseState.resolvedFacts.join(' ')).toContain(
      'Weather Patch.esp has missing master WeatherCore.esm.'
    );
    expect(JSON.stringify(caseState)).not.toContain('PRIVATE_RAW_PAGE_SNIPPET');
    expect(JSON.stringify(caseState)).not.toContain('secret-value');
  });

  it('records Nexus quota exhaustion as a limitation instead of a generic failure', () => {
    const nexusInvestigation = createAiNexusInvestigation({
      operationId,
      generatedAt,
      targetNexusIds: ['skyrim:1234'],
      api: {
        state: 'quota-exhausted',
        unavailableReason: 'rate-limited',
        lastHttpStatus: 429,
        retryAfterSeconds: 300
      },
      quota: {
        hourlyRemaining: 0,
        dailyRemaining: 0,
        resetAt: '2026-07-02T13:00:00Z',
        source: 'headers'
      },
      ordinaryError: null,
      deterministicFindings: [],
      hypotheses: [weakHypothesis],
      evidenceCards: []
    });

    const caseState = compressAiCaseState({
      operationId,
      generatedAt,
      caseState: 'nexus-pass-complete',
      nexusInvestigation
    });

    expect(caseState.quotaState).toMatchObject({
      nexusApiState: 'quota-exhausted',
      unavailableReason: 'rate-limited',
      retryAfterSeconds: 300,
      limitation:
        'Nexus API quota is exhausted or rate-limited; this research limitation leaves Nexus evidence incomplete for this pass.'
    });
    expect(caseState.openQuestions.join(' ')).toContain('research limitation');
    expect(caseState.openQuestions.join(' ').toLowerCase()).not.toContain('generic failure');
    expect(caseState.nextRecommendedStage).toBe('run-external-pass');
  });

  it('compresses every major research milestone in order', () => {
    const localInspection = createAiLocalInspection({
      operationId,
      generatedAt,
      needMoreLocalData: false,
      missingFields: [],
      deterministicFindings: [missingMasterFinding],
      hypotheses: [weakHypothesis],
      suspect_mods: [],
      evidenceCards: []
    });
    const nexusInvestigation = createAiNexusInvestigation({
      operationId,
      generatedAt,
      targetNexusIds: ['skyrim:1234'],
      api: {
        state: 'available',
        unavailableReason: 'none',
        lastHttpStatus: 200,
        retryAfterSeconds: null
      },
      quota: {
        hourlyRemaining: 10,
        dailyRemaining: 100,
        resetAt: null,
        source: 'headers'
      },
      ordinaryError: null,
      deterministicFindings: [],
      hypotheses: [],
      evidenceCards: []
    });
    const externalInvestigation = createAiExternalInvestigation({
      operationId,
      generatedAt,
      searchBudget: {
        localInspectionFiles: 0,
        nexusApiRequests: 0,
        publicWebQueries: 1,
        externalFetches: 1,
        evidenceCards: 1,
        timeoutMs: 30_000
      },
      deterministicFindings: [],
      hypotheses: [],
      evidenceCards: [],
      discardedSources: [],
      conflicts: []
    });
    const diagnosis = createAiDiagnosisJudge({
      operationId,
      generatedAt,
      status: 'ranked',
      confidence: 0.93,
      rankedCauses: [
        {
          id: 'cause-missing-master',
          rank: 1,
          cause: 'Weather Patch.esp is missing WeatherCore.esm.',
          confidence: 0.93,
          supportingEvidenceIds: ['local:plugins.loadOrder'],
          opposingEvidenceIds: [],
          affectedMods: ['Weather Patch'],
          expectedSymptoms: ['Plugin dependency check reports missing masters'],
          fastestValidationTest: 'Re-run the local plugin dependency check.',
          recommendedFix: 'Install or enable WeatherCore.esm.',
          why: ['Local deterministic evidence supports this root-cause candidate.'],
          whyNot: [],
          fixOrder: ['Install WeatherCore.esm', 'Re-run local checks']
        }
      ],
      insufficientReasons: [],
      deterministicFindings: [missingMasterFinding],
      hypotheses: [weakHypothesis]
    });

    const localState = compressAiCaseState({
      operationId,
      generatedAt,
      caseState: 'local-inspection-complete',
      localInspection
    });
    const nexusState = compressAiCaseState({
      operationId,
      generatedAt,
      caseState: 'nexus-pass-complete',
      previousCaseState: localState,
      localInspection,
      nexusInvestigation
    });
    const externalState = compressAiCaseState({
      operationId,
      generatedAt,
      caseState: 'external-pass-complete',
      previousCaseState: nexusState,
      localInspection,
      nexusInvestigation,
      externalInvestigation
    });
    const diagnosisState = compressAiCaseState({
      operationId,
      generatedAt,
      caseState: 'diagnosis-complete',
      previousCaseState: externalState,
      localInspection,
      nexusInvestigation,
      externalInvestigation,
      diagnosis
    });
    const finalState = compressAiCaseState({
      operationId,
      generatedAt,
      caseState: 'final-answer-complete',
      previousCaseState: diagnosisState,
      localInspection,
      nexusInvestigation,
      externalInvestigation,
      diagnosis,
      finalAnswer: 'Most likely cause: WeatherCore.esm is missing.'
    });

    expect([
      localState.caseState,
      nexusState.caseState,
      externalState.caseState,
      diagnosisState.caseState,
      finalState.caseState
    ]).toEqual([
      'local-inspection-complete',
      'nexus-pass-complete',
      'external-pass-complete',
      'diagnosis-complete',
      'final-answer-complete'
    ]);
    expect([
      localState.nextRecommendedStage,
      nexusState.nextRecommendedStage,
      externalState.nextRecommendedStage,
      diagnosisState.nextRecommendedStage,
      finalState.nextRecommendedStage
    ]).toEqual([
      'run-nexus-pass',
      'run-external-pass',
      'run-diagnosis',
      'write-final-answer',
      'complete'
    ]);
  });
});
