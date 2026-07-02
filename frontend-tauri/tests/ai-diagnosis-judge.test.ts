import { describe, expect, it } from 'vitest';

import {
  createAiExternalInvestigation,
  createAiLocalInspection,
  createAiModResearchEvidenceCard,
  createAiModResearchRoute,
  createAiNexusInvestigation,
  judgeAiDiagnosis,
  validateAiModResearchPipelineDto,
  type FluxoraAiExternalInvestigation,
  type FluxoraAiLocalInspection,
  type FluxoraAiModResearchEvidenceCard,
  type FluxoraAiModResearchFinding,
  type FluxoraAiModResearchHypothesis,
  type FluxoraAiModResearchSearchBudget,
  type FluxoraAiNexusInvestigation
} from '../src/shared/ai-mod-research-pipeline';

const generatedAt = new Date('2026-07-02T12:00:00Z');
const operationId = 'op_diagnosis_judge';

const searchBudget: FluxoraAiModResearchSearchBudget = {
  localInspectionFiles: 4,
  nexusApiRequests: 2,
  publicWebQueries: 2,
  externalFetches: 2,
  evidenceCards: 6,
  timeoutMs: 20_000
};

const card = (
  input: Pick<
    FluxoraAiModResearchEvidenceCard,
    | 'sourceId'
    | 'sourceType'
    | 'sourceTier'
    | 'claim'
    | 'relevantMods'
    | 'affectedVersions'
    | 'evidenceStrength'
    | 'confidence'
    | 'contradictionRisk'
  > & { sourceIds?: string[] }
): FluxoraAiModResearchEvidenceCard =>
  createAiModResearchEvidenceCard({
    operationId,
    generatedAt,
    ...input
  });

const finding = (
  input: Omit<FluxoraAiModResearchFinding, 'deterministic'>
): FluxoraAiModResearchFinding => ({
  ...input,
  deterministic: true
});

const hypothesis = (input: FluxoraAiModResearchHypothesis): FluxoraAiModResearchHypothesis => input;

const emptyLocalInspection = (): FluxoraAiLocalInspection =>
  createAiLocalInspection({
    operationId,
    generatedAt,
    needMoreLocalData: false,
    missingFields: [],
    deterministicFindings: [],
    hypotheses: [],
    suspect_mods: [],
    evidenceCards: []
  });

const emptyNexusInvestigation = (): FluxoraAiNexusInvestigation =>
  createAiNexusInvestigation({
    operationId,
    generatedAt,
    targetNexusIds: [],
    api: {
      state: 'not-requested',
      unavailableReason: 'none',
      lastHttpStatus: null,
      retryAfterSeconds: null
    },
    quota: {
      hourlyRemaining: null,
      dailyRemaining: null,
      resetAt: null,
      source: 'not-provided'
    },
    ordinaryError: null,
    deterministicFindings: [],
    hypotheses: [],
    evidenceCards: []
  });

const emptyExternalInvestigation = (): FluxoraAiExternalInvestigation =>
  createAiExternalInvestigation({
    operationId,
    generatedAt,
    searchBudget,
    deterministicFindings: [],
    hypotheses: [],
    evidenceCards: [],
    discardedSources: [],
    conflicts: []
  });

const route = () =>
  createAiModResearchRoute({
    operationId,
    generatedAt,
    route: 'non-nexus-web',
    needMoreLocalData: false,
    missingFields: [],
    suspects: [],
    searchBudget
  });

const missingMastersLocal = (): FluxoraAiLocalInspection => {
  const missingMasterFinding = finding({
    id: 'finding-missing-master-weather-patch',
    claim: 'Plugin WeatherPatch.esp from Weather Patch is missing masters: SkyUI_SE.esp.',
    relevantMods: ['Weather Patch'],
    affectedVersions: ['1.0.0'],
    evidenceIds: ['local:plugins.loadOrder'],
    confidence: 0.96
  });
  return createAiLocalInspection({
    operationId,
    generatedAt,
    needMoreLocalData: false,
    missingFields: [],
    deterministicFindings: [missingMasterFinding],
    hypotheses: [],
    suspect_mods: [
      {
        id: 'suspect-weather-patch',
        label: 'Weather Patch',
        reason: 'Missing master from local load order.',
        relevantMods: ['Weather Patch'],
        confidence: 0.96
      }
    ],
    evidenceCards: [
      card({
        sourceId: 'local:plugins.loadOrder',
        sourceType: 'local-metadata',
        sourceTier: 'local-authoritative',
        claim: missingMasterFinding.claim,
        relevantMods: ['Weather Patch'],
        affectedVersions: ['1.0.0'],
        evidenceStrength: 'direct',
        confidence: 0.96,
        contradictionRisk: 'low'
      })
    ]
  });
};

const weakForumAnecdote = (): FluxoraAiExternalInvestigation => {
  const anecdote = card({
    sourceId: 'forum:single-user-load-order',
    sourceType: 'forum',
    sourceTier: 'community',
    claim: 'A forum user says Weather Patch sometimes crashes because load order is bad.',
    relevantMods: ['Weather Patch'],
    affectedVersions: [],
    evidenceStrength: 'weak',
    confidence: 0.34,
    contradictionRisk: 'low'
  });
  return createAiExternalInvestigation({
    operationId,
    generatedAt,
    searchBudget,
    deterministicFindings: [],
    hypotheses: [
      hypothesis({
        id: 'hypothesis-forum-load-order',
        claim: anecdote.claim,
        relevantMods: ['Weather Patch'],
        affectedVersions: [],
        evidenceIds: ['forum:single-user-load-order'],
        confidence: 0.34,
        falsifiableBy: 'Check local load order and LOOT metadata.'
      })
    ],
    evidenceCards: [anecdote],
    discardedSources: [],
    conflicts: []
  });
};

describe('AI diagnosis judge', () => {
  it('ranks missing-masters local evidence above a weak forum anecdote', () => {
    const diagnosis = judgeAiDiagnosis({
      operationId,
      generatedAt,
      route: route(),
      localInspection: missingMastersLocal(),
      nexusInvestigation: emptyNexusInvestigation(),
      externalInvestigation: weakForumAnecdote()
    });

    expect(validateAiModResearchPipelineDto(diagnosis)).toEqual({ ok: true, errors: [] });
    expect(diagnosis.status).toBe('ranked');
    expect(diagnosis.rankedCauses).toHaveLength(1);
    expect(diagnosis.rankedCauses[0]).toMatchObject({
      rank: 1,
      supportingEvidenceIds: ['local:plugins.loadOrder'],
      opposingEvidenceIds: [],
      affectedMods: ['Weather Patch']
    });
    expect(diagnosis.rankedCauses[0].cause).toContain('missing masters');
    expect(diagnosis.rankedCauses[0].confidence).toBeGreaterThan(0.9);
    expect(diagnosis.rankedCauses[0].whyNot.join(' ')).toContain('forum:single-user-load-order');
  });

  it('uses Nexus API compatibility evidence as confirmation without overriding local missing files', () => {
    const nexusCompatibility = finding({
      id: 'finding-nexus-weather-patch-compatible',
      claim: 'Nexus API metadata confirms Weather Patch 1.0.0 supports Skyrim runtime 1.6.1170.',
      relevantMods: ['Weather Patch'],
      affectedVersions: ['1.0.0', '1.6.1170'],
      evidenceIds: ['nexus-api:weather-patch-files'],
      confidence: 0.86
    });
    const nexusInvestigation = createAiNexusInvestigation({
      ...emptyNexusInvestigation(),
      api: {
        state: 'available',
        unavailableReason: 'none',
        lastHttpStatus: 200,
        retryAfterSeconds: null
      },
      targetNexusIds: ['skyrim:weather-patch'],
      deterministicFindings: [nexusCompatibility],
      evidenceCards: [
        card({
          sourceId: 'nexus-api:weather-patch-files',
          sourceType: 'nexus-api',
          sourceTier: 'nexus-api',
          claim: nexusCompatibility.claim,
          relevantMods: ['Weather Patch'],
          affectedVersions: ['1.0.0', '1.6.1170'],
          evidenceStrength: 'direct',
          confidence: 0.86,
          contradictionRisk: 'low'
        })
      ]
    });

    const diagnosis = judgeAiDiagnosis({
      operationId,
      generatedAt,
      route: route(),
      localInspection: missingMastersLocal(),
      nexusInvestigation,
      externalInvestigation: emptyExternalInvestigation()
    });

    expect(diagnosis.status).toBe('ranked');
    expect(diagnosis.rankedCauses[0].supportingEvidenceIds).toEqual(['local:plugins.loadOrder']);
    expect(diagnosis.rankedCauses[0].cause).toContain('missing masters');
    expect(diagnosis.rankedCauses[0].whyNot.join(' ')).toContain(
      'Nexus compatibility evidence does not prove the missing master file exists locally.'
    );
  });

  it('lowers confidence and records opposing evidence when sources contradict', () => {
    const officialCard = card({
      sourceId: 'web:official-release-notes',
      sourceType: 'public-web',
      sourceTier: 'official',
      claim: 'Official release notes say Combat Patch supports Skyrim runtime 1.6.1170.',
      relevantMods: ['Combat Patch'],
      affectedVersions: ['1.6.1170'],
      evidenceStrength: 'direct',
      confidence: 0.88,
      contradictionRisk: 'high'
    });
    const forumCard = card({
      sourceId: 'forum:combat-patch-broken',
      sourceType: 'forum',
      sourceTier: 'community',
      claim: 'A forum report says Combat Patch crashes on Skyrim runtime 1.6.1170.',
      relevantMods: ['Combat Patch'],
      affectedVersions: ['1.6.1170'],
      evidenceStrength: 'weak',
      confidence: 0.36,
      contradictionRisk: 'high'
    });
    const externalInvestigation = createAiExternalInvestigation({
      operationId,
      generatedAt,
      searchBudget,
      deterministicFindings: [
        finding({
          id: 'finding-official-combat-patch-compatible',
          claim: officialCard.claim,
          relevantMods: ['Combat Patch'],
          affectedVersions: ['1.6.1170'],
          evidenceIds: ['web:official-release-notes'],
          confidence: 0.88
        })
      ],
      hypotheses: [],
      evidenceCards: [officialCard, forumCard],
      discardedSources: [],
      conflicts: [
        {
          claimGroupId: 'external-conflict-combat-patch',
          subject: 'Combat Patch',
          sourceIds: ['web:official-release-notes'],
          opposingSourceIds: ['forum:combat-patch-broken'],
          contradictionRisk: 'high',
          summary: 'External sources disagree about Combat Patch runtime support.'
        }
      ]
    });

    const diagnosis = judgeAiDiagnosis({
      operationId,
      generatedAt,
      route: route(),
      localInspection: emptyLocalInspection(),
      nexusInvestigation: emptyNexusInvestigation(),
      externalInvestigation
    });

    expect(diagnosis.status).toBe('ranked');
    expect(diagnosis.rankedCauses[0]).toMatchObject({
      supportingEvidenceIds: ['web:official-release-notes'],
      opposingEvidenceIds: ['forum:combat-patch-broken']
    });
    expect(diagnosis.rankedCauses[0].confidence).toBeLessThan(0.88);
    expect(diagnosis.rankedCauses[0].whyNot.join(' ')).toContain('source conflict');
  });

  it('returns insufficient instead of inventing a cause for unsupported weak evidence', () => {
    const diagnosis = judgeAiDiagnosis({
      operationId,
      generatedAt,
      route: route(),
      localInspection: emptyLocalInspection(),
      nexusInvestigation: emptyNexusInvestigation(),
      externalInvestigation: weakForumAnecdote()
    });

    expect(validateAiModResearchPipelineDto(diagnosis)).toEqual({ ok: true, errors: [] });
    expect(diagnosis.status).toBe('insufficient');
    expect(diagnosis.confidence).toBe(0);
    expect(diagnosis.rankedCauses).toEqual([]);
    expect(diagnosis.insufficientReasons).toEqual(
      expect.arrayContaining(['No supported root-cause evidence met the diagnosis judge threshold.'])
    );
  });
});
