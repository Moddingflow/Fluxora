export const AI_MOD_RESEARCH_ROUTE_SCHEMA = 'fluxora.ai.mod-research-route.v1';
export const AI_LOCAL_INSPECTION_SCHEMA = 'fluxora.ai.local-inspection.v1';
export const AI_EVIDENCE_CARD_SCHEMA = 'fluxora.ai.evidence-card.v1';
export const AI_NEXUS_INVESTIGATION_SCHEMA = 'fluxora.ai.nexus-investigation.v1';
export const AI_WEB_QUERY_PLAN_SCHEMA = 'fluxora.ai.web-query-plan.v1';
export const AI_EXTERNAL_INVESTIGATION_SCHEMA = 'fluxora.ai.external-investigation.v1';
export const AI_DIAGNOSIS_JUDGE_SCHEMA = 'fluxora.ai.diagnosis-judge.v1';
export const AI_CASE_STATE_SCHEMA = 'fluxora.ai.case-state.v1';

export const AI_MOD_RESEARCH_PIPELINE_SCHEMA_IDS = [
  AI_MOD_RESEARCH_ROUTE_SCHEMA,
  AI_LOCAL_INSPECTION_SCHEMA,
  AI_EVIDENCE_CARD_SCHEMA,
  AI_NEXUS_INVESTIGATION_SCHEMA,
  AI_WEB_QUERY_PLAN_SCHEMA,
  AI_EXTERNAL_INVESTIGATION_SCHEMA,
  AI_DIAGNOSIS_JUDGE_SCHEMA,
  AI_CASE_STATE_SCHEMA
] as const;

export type FluxoraAiModResearchPipelineSchema =
  (typeof AI_MOD_RESEARCH_PIPELINE_SCHEMA_IDS)[number];

export type FluxoraAiModResearchRouteDecision =
  | 'local-only'
  | 'nexus'
  | 'non-nexus-web'
  | 'insufficient-data'
  | 'blocked';

export type FluxoraAiModResearchSourceType =
  | 'local-file'
  | 'local-metadata'
  | 'local-log'
  | 'nexus-api'
  | 'nexus-page'
  | 'public-web'
  | 'forum'
  | 'user-input';

export type FluxoraAiModResearchSourceTier =
  | 'local-authoritative'
  | 'nexus-api'
  | 'official'
  | 'maintainer'
  | 'community'
  | 'unknown';

export type FluxoraAiModResearchEvidenceStrength =
  | 'direct'
  | 'indirect'
  | 'weak'
  | 'contradicted';

export type FluxoraAiModResearchRiskLevel = 'low' | 'medium' | 'high';

export type FluxoraAiModResearchNexusApiState =
  | 'not-requested'
  | 'available'
  | 'quota-exhausted'
  | 'unavailable'
  | 'unauthenticated'
  | 'disabled';

export type FluxoraAiModResearchNexusUnavailableReason =
  | 'none'
  | 'missing-credential'
  | 'invalid-credential'
  | 'rate-limited'
  | 'service-unavailable'
  | 'transport-unavailable'
  | 'disabled-by-policy';

export type FluxoraAiModResearchDiscardReason =
  | 'duplicate'
  | 'off-topic'
  | 'stale'
  | 'low-trust'
  | 'prompt-injection-risk'
  | 'blocked-by-policy'
  | 'contradicted-by-stronger-source';

export interface FluxoraAiModResearchEnvelope<
  TSchema extends FluxoraAiModResearchPipelineSchema
> {
  schema: TSchema;
  generatedAt: string;
  operationId: string;
}

export interface FluxoraAiModResearchSearchBudget {
  localInspectionFiles: number;
  nexusApiRequests: number;
  publicWebQueries: number;
  externalFetches: number;
  evidenceCards: number;
  timeoutMs: number;
}

export interface FluxoraAiModResearchSuspect {
  id: string;
  label: string;
  reason: string;
  relevantMods: string[];
  confidence: number;
}

export interface FluxoraAiModResearchFinding {
  id: string;
  claim: string;
  relevantMods: string[];
  affectedVersions: string[];
  evidenceIds: string[];
  confidence: number;
  deterministic: true;
}

export interface FluxoraAiModResearchHypothesis {
  id: string;
  claim: string;
  relevantMods: string[];
  affectedVersions: string[];
  evidenceIds: string[];
  confidence: number;
  falsifiableBy: string;
}

export interface FluxoraAiModResearchEvidenceCitation {
  sourceId: string;
  url: string | null;
  title: string;
  locator: string;
}

export interface FluxoraAiModResearchEvidenceCard
  extends FluxoraAiModResearchEnvelope<typeof AI_EVIDENCE_CARD_SCHEMA> {
  sourceId: string;
  sourceIds: string[];
  sourceType: FluxoraAiModResearchSourceType;
  sourceTier: FluxoraAiModResearchSourceTier;
  citations: FluxoraAiModResearchEvidenceCitation[];
  claim: string;
  relevantMods: string[];
  affectedVersions: string[];
  evidenceStrength: FluxoraAiModResearchEvidenceStrength;
  corroborationCount: number;
  confidence: number;
  contradictionRisk: FluxoraAiModResearchRiskLevel;
  instructionsAllowed: false;
  rawContentRetained: false;
}

export interface FluxoraAiModResearchRoute
  extends FluxoraAiModResearchEnvelope<typeof AI_MOD_RESEARCH_ROUTE_SCHEMA> {
  route: FluxoraAiModResearchRouteDecision;
  needMoreLocalData: boolean;
  missingFields: string[];
  suspects: FluxoraAiModResearchSuspect[];
  searchBudget: FluxoraAiModResearchSearchBudget;
}

export interface FluxoraAiLocalInspection
  extends FluxoraAiModResearchEnvelope<typeof AI_LOCAL_INSPECTION_SCHEMA> {
  needMoreLocalData: boolean;
  missingFields: string[];
  deterministicFindings: FluxoraAiModResearchFinding[];
  hypotheses: FluxoraAiModResearchHypothesis[];
  suspect_mods: FluxoraAiModResearchSuspect[];
  evidenceCards: FluxoraAiModResearchEvidenceCard[];
}

export interface FluxoraAiModResearchNexusQuotaState {
  hourlyRemaining: number | null;
  dailyRemaining: number | null;
  resetAt: string | null;
  source: 'headers' | 'cache' | 'not-provided';
}

export interface FluxoraAiModResearchNexusApiStatus {
  state: FluxoraAiModResearchNexusApiState;
  unavailableReason: FluxoraAiModResearchNexusUnavailableReason;
  lastHttpStatus: number | null;
  retryAfterSeconds: number | null;
}

export interface FluxoraAiModResearchOrdinaryError {
  code: string;
  message: string;
  retryable: boolean;
  category: 'validation' | 'network' | 'provider' | 'internal';
}

export interface FluxoraAiNexusInvestigation
  extends FluxoraAiModResearchEnvelope<typeof AI_NEXUS_INVESTIGATION_SCHEMA> {
  targetNexusIds: string[];
  api: FluxoraAiModResearchNexusApiStatus;
  quota: FluxoraAiModResearchNexusQuotaState;
  ordinaryError: FluxoraAiModResearchOrdinaryError | null;
  deterministicFindings: FluxoraAiModResearchFinding[];
  hypotheses: FluxoraAiModResearchHypothesis[];
  evidenceCards: FluxoraAiModResearchEvidenceCard[];
}

export type FluxoraAiWebSourcePolicyTierId = 'A' | 'B' | 'C' | 'D';

export type FluxoraAiWebSourcePolicyStrength =
  | 'authoritative'
  | 'strong'
  | 'corroborating'
  | 'weak';

export type FluxoraAiPreferredNonNexusSourceFamily =
  | 'github'
  | 'maintainer-docs'
  | 'script-extender-docs'
  | 'official-changelog'
  | 'specialized-modding-kb'
  | 'specialized-modding-forum';

export type FluxoraAiWebQueryStopReason =
  | 'unsupported-claims'
  | 'open-questions'
  | 'supported-by-prior-evidence'
  | 'required-prior-stages-missing'
  | 'policy-blocked'
  | 'no-named-suspects'
  | 'no-high-signal-query';

export interface FluxoraAiWebSourcePolicyTier {
  tier: FluxoraAiWebSourcePolicyTierId;
  label: string;
  description: string;
  examples: string[];
  claimStrength: FluxoraAiWebSourcePolicyStrength;
  corroborationRequired: boolean;
  highConfidenceAllowed: boolean;
}

export interface FluxoraAiPreferredNonNexusDomain {
  domain: string;
  tier: Exclude<FluxoraAiWebSourcePolicyTierId, 'A'>;
  sourceFamily: FluxoraAiPreferredNonNexusSourceFamily;
  reason: string;
}

export interface FluxoraAiNonNexusWebSourcePolicy {
  sourcePolicyTiers: FluxoraAiWebSourcePolicyTier[];
  preferredNonNexusDomains: FluxoraAiPreferredNonNexusDomain[];
  deniedDomains: string[];
  negativeTerms: string[];
  discardHints: string[];
}

export interface FluxoraAiWebQueryPlanBudget {
  maxQueries: number;
  maxPages: number;
  stopWhenSupportedClaimFound: boolean;
}

export interface FluxoraAiModResearchWebQuery {
  id: string;
  query: string;
  reason: string;
  required: boolean;
  namedSuspectIds: string[];
  namedSuspects: string[];
  exactTokens: string[];
  game: string | null;
  gameVersion: string | null;
  compatibilityKeywords: string[];
  preferredDomains: string[];
  expectedSourceTiers: Exclude<FluxoraAiWebSourcePolicyTierId, 'A'>[];
  negativeTerms: string[];
  discardHints: string[];
  dedupeKey: string;
}

export interface FluxoraAiModResearchDiscardedSource {
  sourceId: string;
  url: string | null;
  title: string;
  discardReason: FluxoraAiModResearchDiscardReason;
  reasonDetails: string;
}

export interface FluxoraAiWebQueryPlan
  extends FluxoraAiModResearchEnvelope<typeof AI_WEB_QUERY_PLAN_SCHEMA> {
  route: Extract<
    FluxoraAiModResearchRouteDecision,
    'non-nexus-web' | 'insufficient-data' | 'blocked'
  >;
  searchBudget: FluxoraAiModResearchSearchBudget;
  budget: FluxoraAiWebQueryPlanBudget;
  sourcePolicyTiers: FluxoraAiWebSourcePolicyTier[];
  preferredNonNexusDomains: FluxoraAiPreferredNonNexusDomain[];
  deniedDomains: string[];
  negativeTerms: string[];
  discardHints: string[];
  stopReason: FluxoraAiWebQueryStopReason;
  queries: FluxoraAiModResearchWebQuery[];
  discardedSources: FluxoraAiModResearchDiscardedSource[];
}

export interface FluxoraAiNonNexusWebQueryPlannerInput {
  operationId: string;
  generatedAt?: string | Date;
  localInspection?: FluxoraAiLocalInspection | null;
  nexusInvestigation?: FluxoraAiNexusInvestigation | null;
  caseState?: FluxoraAiCaseState | null;
  unsupportedClaims?: string[];
  openQuestions?: string[];
  exactTokens?: string[];
  game?: string | null;
  gameVersion?: string | null;
  compatibilityKeywords?: string[];
  sourcePolicy?: Partial<FluxoraAiNonNexusWebSourcePolicy>;
  budget?: Partial<FluxoraAiWebQueryPlanBudget>;
  searchBudget?: Partial<FluxoraAiModResearchSearchBudget>;
  nonNexusWebAllowed?: boolean;
}

export interface FluxoraAiExternalRetrievedClaim {
  claim: string;
  affectedMods?: string[];
  affectedVersions?: string[];
  evidenceStrength?: FluxoraAiModResearchEvidenceStrength;
}

export interface FluxoraAiExternalSourceSnapshot {
  sourceId: string;
  queryId: string;
  url: string;
  finalUrl?: string | null;
  title?: string;
  text?: string;
  claims?: FluxoraAiExternalRetrievedClaim[];
  sourceKind?: Extract<FluxoraAiModResearchSourceType, 'public-web' | 'forum'>;
  byteLength?: number;
  elapsedMs?: number;
  redirects?: string[];
  robotsAllowed?: boolean;
  termsAllowed?: boolean;
  backoffActive?: boolean;
  timedOut?: boolean;
  sizeLimitExceeded?: boolean;
  capturedAt?: string | Date;
  fingerprint?: string;
}

export interface FluxoraAiExternalInvestigationBuildInput {
  operationId: string;
  generatedAt?: string | Date;
  queryPlan: FluxoraAiWebQueryPlan;
  retrievedSourceSnapshots: FluxoraAiExternalSourceSnapshot[];
}

export interface FluxoraAiExternalInvestigationConflict {
  claimGroupId: string;
  subject: string;
  sourceIds: string[];
  opposingSourceIds: string[];
  contradictionRisk: FluxoraAiModResearchRiskLevel;
  summary: string;
}

export interface FluxoraAiExternalInvestigation
  extends FluxoraAiModResearchEnvelope<typeof AI_EXTERNAL_INVESTIGATION_SCHEMA> {
  searchBudget: FluxoraAiModResearchSearchBudget;
  deterministicFindings: FluxoraAiModResearchFinding[];
  hypotheses: FluxoraAiModResearchHypothesis[];
  evidenceCards: FluxoraAiModResearchEvidenceCard[];
  discardedSources: FluxoraAiModResearchDiscardedSource[];
  conflicts: FluxoraAiExternalInvestigationConflict[];
}

export type FluxoraAiDiagnosisJudgeStatus = 'ranked' | 'insufficient';

export interface FluxoraAiDiagnosisJudgeCheck {
  id: string;
  claim: string;
  relevantMods: string[];
  affectedVersions?: string[];
  evidenceIds: string[];
  confidence: number;
  sourceTier: FluxoraAiModResearchSourceTier;
  evidenceStrength: FluxoraAiModResearchEvidenceStrength;
  contradictionRisk?: FluxoraAiModResearchRiskLevel;
  expectedSymptoms?: string[];
  fastestValidationTest?: string;
  recommendedFix?: string;
  fixOrder?: string[];
  why?: string[];
  whyNot?: string[];
}

export interface FluxoraAiDiagnosisJudgeBuildInput {
  operationId: string;
  generatedAt?: string | Date;
  route?: FluxoraAiModResearchRoute | FluxoraAiModResearchRouteDecision | null;
  localInspection?: FluxoraAiLocalInspection | null;
  nexusInvestigation?: FluxoraAiNexusInvestigation | null;
  externalInvestigation?: FluxoraAiExternalInvestigation | null;
  loot?: FluxoraAiDiagnosisJudgeCheck[];
  checks?: FluxoraAiDiagnosisJudgeCheck[];
}

export interface FluxoraAiModResearchRankedCause {
  id: string;
  rank: number;
  cause: string;
  confidence: number;
  supportingEvidenceIds: string[];
  opposingEvidenceIds: string[];
  affectedMods: string[];
  expectedSymptoms: string[];
  fastestValidationTest: string;
  recommendedFix: string;
  why: string[];
  whyNot: string[];
  fixOrder: string[];
}

export interface FluxoraAiDiagnosisJudge
  extends FluxoraAiModResearchEnvelope<typeof AI_DIAGNOSIS_JUDGE_SCHEMA> {
  status: FluxoraAiDiagnosisJudgeStatus;
  confidence: number;
  rankedCauses: FluxoraAiModResearchRankedCause[];
  insufficientReasons: string[];
  deterministicFindings: FluxoraAiModResearchFinding[];
  hypotheses: FluxoraAiModResearchHypothesis[];
}

export interface FluxoraAiModResearchDiscardedHypothesis {
  hypothesisId: string;
  claim: string;
  discardReason: string;
  evidenceIds: string[];
}

export type FluxoraAiCaseStateMilestone =
  | 'local-inspection-complete'
  | 'nexus-pass-complete'
  | 'external-pass-complete'
  | 'diagnosis-complete'
  | 'final-answer-complete';

export type FluxoraAiNextRecommendedStage =
  | 'run-nexus-pass'
  | 'run-external-pass'
  | 'run-diagnosis'
  | 'write-final-answer'
  | 'complete'
  | 'blocked';

export interface FluxoraAiCaseQuotaState {
  nexusApiState: FluxoraAiModResearchNexusApiState;
  unavailableReason: FluxoraAiModResearchNexusUnavailableReason;
  lastHttpStatus: number | null;
  retryAfterSeconds: number | null;
  quota: FluxoraAiModResearchNexusQuotaState | null;
  limitation: string | null;
}

export interface FluxoraAiCaseState
  extends FluxoraAiModResearchEnvelope<typeof AI_CASE_STATE_SCHEMA> {
  caseState: FluxoraAiCaseStateMilestone;
  tokenSafeSummary: string;
  resolvedFacts: string[];
  openQuestions: string[];
  discardedHypotheses: FluxoraAiModResearchDiscardedHypothesis[];
  sourceIds: string[];
  quotaState: FluxoraAiCaseQuotaState;
  nextRecommendedStage: FluxoraAiNextRecommendedStage;
}

export interface FluxoraAiCaseStateCompressorInput {
  operationId: string;
  generatedAt?: string | Date;
  caseState: FluxoraAiCaseStateMilestone;
  previousCaseState?: FluxoraAiCaseState | null;
  localInspection?: FluxoraAiLocalInspection | null;
  nexusInvestigation?: FluxoraAiNexusInvestigation | null;
  externalInvestigation?: FluxoraAiExternalInvestigation | null;
  diagnosis?: FluxoraAiDiagnosisJudge | null;
  finalAnswer?: string | null;
}

export type FluxoraAiModResearchPipelineDto =
  | FluxoraAiModResearchRoute
  | FluxoraAiLocalInspection
  | FluxoraAiModResearchEvidenceCard
  | FluxoraAiNexusInvestigation
  | FluxoraAiWebQueryPlan
  | FluxoraAiExternalInvestigation
  | FluxoraAiDiagnosisJudge
  | FluxoraAiCaseState;

export interface FluxoraAiModResearchSchemaDefinition {
  schema: FluxoraAiModResearchPipelineSchema;
  type: 'object';
  additionalProperties: false;
  required: readonly string[];
}

const commonRequired = ['schema', 'generatedAt', 'operationId'] as const;

const strictSchema = (
  schema: FluxoraAiModResearchPipelineSchema,
  required: readonly string[]
): FluxoraAiModResearchSchemaDefinition => ({
  schema,
  type: 'object',
  additionalProperties: false,
  required: [...commonRequired, ...required]
});

export const AI_MOD_RESEARCH_PIPELINE_SCHEMAS = {
  [AI_MOD_RESEARCH_ROUTE_SCHEMA]: strictSchema(AI_MOD_RESEARCH_ROUTE_SCHEMA, [
    'route',
    'needMoreLocalData',
    'missingFields',
    'suspects',
    'searchBudget'
  ]),
  [AI_LOCAL_INSPECTION_SCHEMA]: strictSchema(AI_LOCAL_INSPECTION_SCHEMA, [
    'needMoreLocalData',
    'missingFields',
    'deterministicFindings',
    'hypotheses',
    'suspect_mods',
    'evidenceCards'
  ]),
  [AI_EVIDENCE_CARD_SCHEMA]: strictSchema(AI_EVIDENCE_CARD_SCHEMA, [
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
  ]),
  [AI_NEXUS_INVESTIGATION_SCHEMA]: strictSchema(AI_NEXUS_INVESTIGATION_SCHEMA, [
    'targetNexusIds',
    'api',
    'quota',
    'ordinaryError',
    'deterministicFindings',
    'hypotheses',
    'evidenceCards'
  ]),
  [AI_WEB_QUERY_PLAN_SCHEMA]: strictSchema(AI_WEB_QUERY_PLAN_SCHEMA, [
    'route',
    'searchBudget',
    'budget',
    'sourcePolicyTiers',
    'preferredNonNexusDomains',
    'deniedDomains',
    'negativeTerms',
    'discardHints',
    'stopReason',
    'queries',
    'discardedSources'
  ]),
  [AI_EXTERNAL_INVESTIGATION_SCHEMA]: strictSchema(AI_EXTERNAL_INVESTIGATION_SCHEMA, [
    'searchBudget',
    'deterministicFindings',
    'hypotheses',
    'evidenceCards',
    'discardedSources',
    'conflicts'
  ]),
  [AI_DIAGNOSIS_JUDGE_SCHEMA]: strictSchema(AI_DIAGNOSIS_JUDGE_SCHEMA, [
    'status',
    'confidence',
    'rankedCauses',
    'insufficientReasons',
    'deterministicFindings',
    'hypotheses'
  ]),
  [AI_CASE_STATE_SCHEMA]: strictSchema(AI_CASE_STATE_SCHEMA, [
    'caseState',
    'tokenSafeSummary',
    'resolvedFacts',
    'openQuestions',
    'discardedHypotheses',
    'sourceIds',
    'quotaState',
    'nextRecommendedStage'
  ])
} satisfies Record<FluxoraAiModResearchPipelineSchema, FluxoraAiModResearchSchemaDefinition>;

export const DEFAULT_AI_WEB_QUERY_PLAN_BUDGET: FluxoraAiWebQueryPlanBudget = {
  maxQueries: 3,
  maxPages: 8,
  stopWhenSupportedClaimFound: true
};

export const DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY: FluxoraAiNonNexusWebSourcePolicy = {
  sourcePolicyTiers: [
    {
      tier: 'A',
      label: 'Tier A: local deterministic Fluxora evidence',
      description:
        'Local Fluxora/core evidence that deterministically supports or resolves the claim before web access.',
      examples: ['local plugin list', 'Fluxora operation log', 'core-backed conflict evidence'],
      claimStrength: 'authoritative',
      corroborationRequired: false,
      highConfidenceAllowed: true
    },
    {
      tier: 'B',
      label: 'Tier B: official or maintainer sources',
      description:
        'Official/maintainer sources including GitHub releases/issues, author docs, script extender docs, changelogs, and Nexus API evidence.',
      examples: ['GitHub releases', 'maintainer issue tracker', 'SKSE docs', 'official changelog', 'Nexus API evidence'],
      claimStrength: 'strong',
      corroborationRequired: false,
      highConfidenceAllowed: true
    },
    {
      tier: 'C',
      label: 'Tier C: specialized modding knowledge bases',
      description:
        'Specialized modding KBs, forums, and wikis where access is allowed and the claim can be checked against context.',
      examples: ['STEP wiki/forum', 'UESP Creation Kit wiki', 'AFK Mods forum'],
      claimStrength: 'corroborating',
      corroborationRequired: true,
      highConfidenceAllowed: false
    },
    {
      tier: 'D',
      label: 'Tier D: anecdotal community threads',
      description:
        'Anecdotal comments, generic threads, and weak community reports that can suggest leads but need corroboration.',
      examples: ['uncorroborated forum comment', 'single user report', 'search snippet only'],
      claimStrength: 'weak',
      corroborationRequired: true,
      highConfidenceAllowed: false
    }
  ],
  preferredNonNexusDomains: [
    {
      domain: 'github.com',
      tier: 'B',
      sourceFamily: 'github',
      reason: 'Maintainer releases, issues, pull requests and changelogs are high-signal compatibility evidence.'
    },
    {
      domain: 'skse.silverlock.org',
      tier: 'B',
      sourceFamily: 'script-extender-docs',
      reason: 'Official SKSE release and runtime compatibility notes.'
    },
    {
      domain: 'loot.github.io',
      tier: 'B',
      sourceFamily: 'maintainer-docs',
      reason: 'Official LOOT documentation and metadata entry point.'
    },
    {
      domain: 'stepmodifications.org',
      tier: 'C',
      sourceFamily: 'specialized-modding-kb',
      reason: 'Specialized modding knowledge base and forum where access is public.'
    },
    {
      domain: 'ck.uesp.net',
      tier: 'C',
      sourceFamily: 'specialized-modding-kb',
      reason: 'Creation Kit wiki pages are useful for engine and plugin behavior context.'
    },
    {
      domain: 'afkmods.com',
      tier: 'C',
      sourceFamily: 'specialized-modding-forum',
      reason: 'Specialized maintainer/community forum; anecdotal claims still require corroboration.'
    }
  ],
  deniedDomains: [
    'nexusmods.com',
    'www.nexusmods.com',
    'modsfire.com',
    'modland.net',
    'moddbdownload.com',
    'skyrim-mods.example'
  ],
  negativeTerms: [
    'best mods',
    'top mods',
    'must have mods',
    'crash fix',
    'fix all crashes',
    'download free',
    'cracked',
    'repack'
  ],
  discardHints: [
    'generic SEO crash-fix page',
    'generic best-mods listicle',
    'mirror or scrape site',
    'pirate/repack page',
    'requires authentication or cookies',
    'wrong game or runtime version',
    'search-snippet-only claim'
  ]
};

export interface FluxoraAiModResearchValidationResult {
  ok: boolean;
  errors: string[];
}

type BuilderInput<T extends FluxoraAiModResearchEnvelope<FluxoraAiModResearchPipelineSchema>> =
  Omit<T, 'schema' | 'generatedAt' | 'operationId'> & {
    operationId: string;
    generatedAt?: string | Date;
  };

export type FluxoraAiModResearchEvidenceCardInput = Omit<
  BuilderInput<FluxoraAiModResearchEvidenceCard>,
  'instructionsAllowed' | 'rawContentRetained' | 'sourceIds' | 'citations' | 'corroborationCount'
> & {
  sourceIds?: string[];
  citations?: FluxoraAiModResearchEvidenceCitation[];
  corroborationCount?: number;
  instructionsAllowed?: false;
  rawContentRetained?: false;
};

const generatedAtString = (value: string | Date | undefined): string =>
  value instanceof Date ? value.toISOString() : value ?? new Date().toISOString();

const envelope = <TSchema extends FluxoraAiModResearchPipelineSchema>(
  schema: TSchema,
  input: { operationId: string; generatedAt?: string | Date }
): FluxoraAiModResearchEnvelope<TSchema> => ({
  schema,
  generatedAt: generatedAtString(input.generatedAt),
  operationId: input.operationId
});

export const createAiModResearchEvidenceCard = (
  input: FluxoraAiModResearchEvidenceCardInput
): FluxoraAiModResearchEvidenceCard => {
  const {
    operationId,
    generatedAt,
    sourceIds: inputSourceIds,
    citations: inputCitations,
    corroborationCount,
    ...payload
  } = input;
  const sourceIds = [payload.sourceId, ...(inputSourceIds ?? [])].reduce<string[]>((acc, sourceId) => {
    const trimmed = sourceId.trim();
    if (trimmed && !acc.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      acc.push(trimmed);
    }
    return acc;
  }, []);
  const citations =
    inputCitations && inputCitations.length > 0
      ? inputCitations
      : sourceIds.map((sourceId) => ({
          sourceId,
          url: null,
          title: sourceId,
          locator: 'source snapshot'
        }));
  return {
    ...envelope(AI_EVIDENCE_CARD_SCHEMA, { operationId, generatedAt }),
    ...payload,
    sourceIds,
    citations,
    corroborationCount: Math.max(0, Math.trunc(corroborationCount ?? Math.max(1, sourceIds.length))),
    instructionsAllowed: false,
    rawContentRetained: false
  };
};

export const createAiModResearchRoute = (
  input: BuilderInput<FluxoraAiModResearchRoute>
): FluxoraAiModResearchRoute => {
  const { operationId, generatedAt, ...payload } = input;
  return {
    ...envelope(AI_MOD_RESEARCH_ROUTE_SCHEMA, { operationId, generatedAt }),
    ...payload
  };
};

export const createAiLocalInspection = (
  input: BuilderInput<FluxoraAiLocalInspection>
): FluxoraAiLocalInspection => {
  const { operationId, generatedAt, ...payload } = input;
  return {
    ...envelope(AI_LOCAL_INSPECTION_SCHEMA, { operationId, generatedAt }),
    ...payload
  };
};

export interface FluxoraAiLocalInspectionBuildInput {
  buildSnapshot?: unknown;
  contextBundle?: unknown;
  generatedAt?: string | Date;
  operationId: string;
}

interface LocalInspectionTool {
  output?: unknown;
  page?: {
    items?: unknown[];
  };
  toolName: string;
}

const MAX_LOCAL_INSPECTION_SUSPECT_MODS = 12;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const optionalRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const arrayValue = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const stringValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const numberValue = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const booleanValue = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const fieldString = (record: unknown, key: string): string =>
  stringValue(optionalRecord(record)?.[key]);

const fieldNumber = (record: unknown, key: string): number =>
  numberValue(optionalRecord(record)?.[key]);

const fieldArray = (record: unknown, key: string): unknown[] =>
  arrayValue(optionalRecord(record)?.[key]);

const stringArray = (value: unknown): string[] =>
  arrayValue(value).map(stringValue).filter(Boolean);

const sourceSlug = (value: string): string => {
  let slug = '';
  for (const character of value) {
    if (/[a-z0-9]/i.test(character)) {
      slug += character.toLowerCase();
    } else if (!slug.endsWith('-')) {
      slug += '-';
    }
  }
  return slug.replace(/^-+|-+$/g, '');
};

const boundedId = (prefix: string, parts: string[]): string => {
  const slug = sourceSlug(parts.filter(Boolean).join(' ')).slice(0, 96);
  return slug ? `${prefix}-${slug}` : `${prefix}-unknown`;
};

const buildTools = (snapshot: unknown, toolName: string): LocalInspectionTool[] => {
  const tools = arrayValue(optionalRecord(snapshot)?.tools);
  return tools
    .map(optionalRecord)
    .filter((tool): tool is Record<string, unknown> => Boolean(tool))
    .filter((tool) => tool.toolName === toolName)
    .map((tool) => ({
      output: tool.output,
      page: optionalRecord(tool.page) as LocalInspectionTool['page'],
      toolName
    }));
};

const toolSourceId = (toolName: string, operationId: string): string =>
  `source:${sourceSlug(toolName)}:${sourceSlug(operationId)}`;

const sourceIdsForTool = (
  toolName: string,
  operationId: string,
  contextBundle: unknown
): string[] => {
  const sourceIds = new Set<string>([toolSourceId(toolName, operationId)]);
  const slug = sourceSlug(toolName);
  for (const source of arrayValue(optionalRecord(contextBundle)?.sources)) {
    const sourceRecord = optionalRecord(source);
    const id = stringValue(sourceRecord?.id);
    const kind = stringValue(sourceRecord?.kind);
    if (id && (kind === toolName || id.includes(`source:${slug}:`))) {
      sourceIds.add(id);
    }
  }
  return [...sourceIds];
};

const allToolItems = (tools: LocalInspectionTool[]): Record<string, unknown>[] =>
  tools.flatMap((tool) =>
    arrayValue(tool.page?.items)
      .map(optionalRecord)
      .filter((item): item is Record<string, unknown> => Boolean(item))
  );

const outputRecords = (tools: LocalInspectionTool[]): Record<string, unknown>[] =>
  tools
    .map((tool) => optionalRecord(tool.output))
    .filter((output): output is Record<string, unknown> => Boolean(output));

const sourceTypeForTool = (toolName: string): FluxoraAiModResearchSourceType => {
  if (toolName === 'operations.recentLogs') {
    return 'local-log';
  }
  if (toolName === 'local.filesystemSnapshot' || toolName === 'local.read_text_file') {
    return 'local-file';
  }
  return 'local-metadata';
};

const createLocalEvidenceCard = (
  operationId: string,
  generatedAt: string | Date | undefined,
  toolName: string,
  sourceId: string,
  claim: string,
  relevantMods: string[],
  confidence: number,
  evidenceStrength: FluxoraAiModResearchEvidenceStrength = 'direct',
  contradictionRisk: FluxoraAiModResearchRiskLevel = 'low'
): FluxoraAiModResearchEvidenceCard =>
  createAiModResearchEvidenceCard({
    operationId,
    generatedAt,
    sourceId,
    sourceType: sourceTypeForTool(toolName),
    sourceTier: 'local-authoritative',
    claim,
    relevantMods,
    affectedVersions: [],
    evidenceStrength,
    confidence,
    contradictionRisk
  });

const pushUniqueById = <TItem extends { id: string }>(items: TItem[], item: TItem): void => {
  if (!items.some((existing) => existing.id === item.id)) {
    items.push(item);
  }
};

const pushUniqueEvidenceCard = (
  cards: FluxoraAiModResearchEvidenceCard[],
  card: FluxoraAiModResearchEvidenceCard
): void => {
  if (!cards.some((existing) => existing.sourceId === card.sourceId && existing.claim === card.claim)) {
    cards.push(card);
  }
};

const pushSuspect = (
  suspects: FluxoraAiModResearchSuspect[],
  label: string,
  reason: string,
  relevantMods: string[],
  confidence: number
): void => {
  const trimmed = label.trim();
  if (!trimmed || suspects.length >= MAX_LOCAL_INSPECTION_SUSPECT_MODS) {
    return;
  }
  pushUniqueById(suspects, {
    id: boundedId('suspect', [trimmed, reason]),
    label: trimmed,
    reason,
    relevantMods: relevantMods.length > 0 ? relevantMods : [trimmed],
    confidence
  });
};

const pushFinding = (
  findings: FluxoraAiModResearchFinding[],
  evidenceCards: FluxoraAiModResearchEvidenceCard[],
  suspects: FluxoraAiModResearchSuspect[],
  input: {
    affectedVersions?: string[];
    claim: string;
    confidence: number;
    id: string;
    relevantMods: string[];
    sourceIds: string[];
    suspectReason?: string;
    toolName: string;
  },
  generatedAt: string | Date | undefined,
  operationId: string
): void => {
  const evidenceIds = [...new Set(input.sourceIds.filter(Boolean))];
  pushUniqueById(findings, {
    id: input.id,
    claim: input.claim,
    relevantMods: input.relevantMods,
    affectedVersions: input.affectedVersions ?? [],
    evidenceIds,
    confidence: input.confidence,
    deterministic: true
  });
  for (const sourceId of evidenceIds) {
    pushUniqueEvidenceCard(
      evidenceCards,
      createLocalEvidenceCard(
        operationId,
        generatedAt,
        input.toolName,
        sourceId,
        input.claim,
        input.relevantMods,
        input.confidence
      )
    );
  }
  for (const mod of input.relevantMods) {
    pushSuspect(suspects, mod, input.suspectReason ?? input.claim, input.relevantMods, input.confidence);
  }
};

const pushHypothesis = (
  hypotheses: FluxoraAiModResearchHypothesis[],
  evidenceCards: FluxoraAiModResearchEvidenceCard[],
  suspects: FluxoraAiModResearchSuspect[],
  input: {
    affectedVersions?: string[];
    claim: string;
    confidence: number;
    falsifiableBy: string;
    id: string;
    relevantMods: string[];
    sourceIds: string[];
    suspectReason?: string;
    toolName: string;
  },
  generatedAt: string | Date | undefined,
  operationId: string
): void => {
  const evidenceIds = [...new Set(input.sourceIds.filter(Boolean))];
  pushUniqueById(hypotheses, {
    id: input.id,
    claim: input.claim,
    relevantMods: input.relevantMods,
    affectedVersions: input.affectedVersions ?? [],
    evidenceIds,
    confidence: input.confidence,
    falsifiableBy: input.falsifiableBy
  });
  for (const sourceId of evidenceIds) {
    pushUniqueEvidenceCard(
      evidenceCards,
      createLocalEvidenceCard(
        operationId,
        generatedAt,
        input.toolName,
        sourceId,
        input.claim,
        input.relevantMods,
        input.confidence,
        'indirect',
        'medium'
      )
    );
  }
  for (const mod of input.relevantMods) {
    pushSuspect(suspects, mod, input.suspectReason ?? input.claim, input.relevantMods, input.confidence);
  }
};

const pluginName = (record: unknown): string =>
  fieldString(record, 'plugin') || fieldString(record, 'pluginName') || fieldString(record, 'name');

const pluginSourceMod = (record: unknown): string =>
  fieldString(record, 'source_mod') || fieldString(record, 'sourceMod');

const pluginMissingMasters = (record: unknown): string[] =>
  stringArray(optionalRecord(record)?.missing ?? optionalRecord(record)?.missingMasters);

const collectMissingMasterRecords = (
  buildSnapshot: unknown
): Array<{ missingMasters: string[]; plugin: string; sourceMod: string; toolName: string }> => {
  const records: Array<{ missingMasters: string[]; plugin: string; sourceMod: string; toolName: string }> = [];
  for (const item of allToolItems(buildTools(buildSnapshot, 'plugins.loadOrder'))) {
    const missingMasters = pluginMissingMasters(item);
    if (missingMasters.length > 0) {
      records.push({
        missingMasters,
        plugin: pluginName(item),
        sourceMod: pluginSourceMod(item),
        toolName: 'plugins.loadOrder'
      });
    }
  }
  for (const output of outputRecords(buildTools(buildSnapshot, 'local.check_plugins'))) {
    for (const item of fieldArray(output, 'missing_masters').map(optionalRecord).filter(Boolean)) {
      const missingMasters = pluginMissingMasters(item);
      if (missingMasters.length > 0) {
        records.push({
          missingMasters,
          plugin: pluginName(item),
          sourceMod: pluginSourceMod(item),
          toolName: 'local.check_plugins'
        });
      }
    }
  }
  for (const output of outputRecords(buildTools(buildSnapshot, 'build.summary'))) {
    const plugins = optionalRecord(output.plugins);
    for (const item of fieldArray(plugins, 'missingMasterDetails').map(optionalRecord).filter(Boolean)) {
      const missingMasters = pluginMissingMasters(item);
      if (missingMasters.length > 0) {
        records.push({
          missingMasters,
          plugin: pluginName(item),
          sourceMod: pluginSourceMod(item),
          toolName: 'build.summary'
        });
      }
    }
  }
  return records;
};

const collectConflictPairs = (
  buildSnapshot: unknown
): Array<{ fileSamples: string[]; modNames: string[]; toolName: string }> => {
  const pairs: Array<{ fileSamples: string[]; modNames: string[]; toolName: string }> = [];
  for (const output of outputRecords(buildTools(buildSnapshot, 'build.summary'))) {
    const conflictEvidence = optionalRecord(output.conflictEvidence);
    for (const pair of fieldArray(conflictEvidence, 'pairs')
      .map(optionalRecord)
      .filter((item): item is Record<string, unknown> => Boolean(item))) {
      const modNames = stringArray(pair.modNames);
      if (modNames.length < 2) {
        continue;
      }
      pairs.push({
        fileSamples: fieldArray(pair, 'fileSamples')
          .map((sample) => fieldString(sample, 'relativePath'))
          .filter(Boolean)
          .slice(0, 4),
        modNames,
        toolName: 'build.summary'
      });
    }
  }
  for (const output of outputRecords(buildTools(buildSnapshot, 'local.filesystemSnapshot'))) {
    const localTools = optionalRecord(output.localTools);
    const fileConflicts = optionalRecord(localTools?.['local.check_file_conflicts']);
    for (const item of fieldArray(fileConflicts, 'conflictFiles')
      .map(optionalRecord)
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))) {
      const owners = stringArray(item.conflictOwners);
      if (owners.length < 2) {
        continue;
      }
      pairs.push({
        fileSamples: [fieldString(item, 'relativePath')].filter(Boolean),
        modNames: owners,
        toolName: 'local.filesystemSnapshot'
      });
    }
  }
  return pairs;
};

const failedStatus = (value: string): boolean => {
  const normalized = value.toLowerCase();
  return normalized.includes('failed') || normalized.includes('error');
};

const collectFailedOperations = (
  buildSnapshot: unknown
): Array<{ claim: string; relevantMods: string[]; toolName: string }> => {
  const failures: Array<{ claim: string; relevantMods: string[]; toolName: string }> = [];
  for (const item of allToolItems(buildTools(buildSnapshot, 'downloads.list'))) {
    const status = fieldString(item, 'status');
    if (!failedStatus(status)) {
      continue;
    }
    const label = fieldString(item, 'name') || fieldString(item, 'fileName') || fieldString(item, 'id');
    failures.push({
      claim: `Download/install queue item ${label} failed locally with status: ${status}.`,
      relevantMods: [label].filter(Boolean),
      toolName: 'downloads.list'
    });
  }
  for (const output of outputRecords(buildTools(buildSnapshot, 'operations.status'))) {
    for (const group of ['active', 'recent']) {
      for (const operation of fieldArray(output, group).map(optionalRecord).filter(Boolean)) {
        const state = fieldString(operation, 'state');
        if (!failedStatus(state)) {
          continue;
        }
        const item = fieldString(operation, 'currentItem') || fieldString(operation, 'phase') || fieldString(operation, 'operationId');
        failures.push({
          claim: `Fluxora operation ${item} failed locally with state: ${state}.`,
          relevantMods: [item].filter(Boolean),
          toolName: 'operations.status'
        });
      }
    }
  }
  for (const item of allToolItems(buildTools(buildSnapshot, 'operations.recentLogs'))) {
    const level = fieldString(item, 'level');
    const line = fieldString(item, 'line');
    if (level !== 'error' && !failedStatus(line)) {
      continue;
    }
    failures.push({
      claim: `Fluxora operation log reported a local failure: ${line.slice(0, 180)}.`,
      relevantMods: [],
      toolName: 'operations.recentLogs'
    });
  }
  return failures;
};

const collectAggregateOverwriteHypotheses = (
  buildSnapshot: unknown
): Array<{ claim: string; confidence: number; relevantMods: string[]; sourceTool: string }> => {
  const hypotheses: Array<{ claim: string; confidence: number; relevantMods: string[]; sourceTool: string }> = [];
  for (const item of [
    ...allToolItems(buildTools(buildSnapshot, 'mods.installed')),
    ...allToolItems(buildTools(buildSnapshot, 'mods.order'))
  ]) {
    const overwrite = optionalRecord(item.overwrite);
    const counts = optionalRecord(overwrite?.counts);
    const conflicting = fieldNumber(counts, 'conflicting');
    const overwritten = fieldNumber(counts, 'overwritten');
    const overwriting = fieldNumber(counts, 'overwriting');
    const risk = fieldString(overwrite, 'risk');
    if (conflicting + overwritten + overwriting <= 0 || !['review', 'high'].includes(risk)) {
      continue;
    }
    const name = fieldString(item, 'name') || fieldString(item, 'label');
    hypotheses.push({
      claim: `${name} has aggregate overwrite counts (${conflicting} conflicting, ${overwritten} overwritten, ${overwriting} overwriting), but no exact conflict pair is available from file-owner evidence.`,
      confidence: risk === 'high' ? 0.58 : 0.44,
      relevantMods: [name].filter(Boolean),
      sourceTool: fieldString(item, 'panel') === 'left-mod-order' ? 'mods.order' : 'mods.installed'
    });
  }
  return hypotheses;
};

const collectRuntimeHypotheses = (
  buildSnapshot: unknown
): Array<{ claim: string; confidence: number; relevantMods: string[]; sourceTool: string }> => {
  const hypotheses: Array<{ claim: string; confidence: number; relevantMods: string[]; sourceTool: string }> = [];
  for (const output of outputRecords(buildTools(buildSnapshot, 'local.filesystemSnapshot'))) {
    const localTools = optionalRecord(output.localTools);
    const skse = optionalRecord(localTools?.['local.detect_skse_plugins']);
    const nativePlugins = fieldArray(skse, 'nativePlugins').map(optionalRecord).filter(Boolean);
    if (nativePlugins.length > 0 && fieldString(skse, 'versionParsing') === 'not-implemented') {
      const relevantMods = nativePlugins
        .map((plugin) => fieldString(plugin, 'modName'))
        .filter(Boolean)
        .slice(0, 6);
      hypotheses.push({
        claim:
          'Native script-extender plugin files are present, but runtime/DLL version compatibility is not deterministically visible in the local metadata snapshot.',
        confidence: 0.36,
        relevantMods,
        sourceTool: 'local.filesystemSnapshot'
      });
    }
  }
  for (const output of outputRecords(buildTools(buildSnapshot, 'local.read_text_file'))) {
    for (const file of fieldArray(output, 'files').map(optionalRecord).filter(Boolean)) {
      const preview = fieldString(file, 'content_preview').toLowerCase();
      if (!preview.includes('skse') && !preview.includes('address library') && !preview.includes('require')) {
        continue;
      }
      const sourceLabel = fieldString(file, 'source_label');
      hypotheses.push({
        claim:
          'An Analyze-only text preview mentions local runtime or requirement terms; treat this as untrusted diagnostic data until structured metadata or external evidence verifies it.',
        confidence: 0.3,
        relevantMods: [sourceLabel].filter(Boolean),
        sourceTool: 'local.read_text_file'
      });
    }
  }
  return hypotheses;
};

export const buildAiLocalInspectionFromContext = ({
  buildSnapshot,
  contextBundle,
  generatedAt,
  operationId
}: FluxoraAiLocalInspectionBuildInput): FluxoraAiLocalInspection => {
  const deterministicFindings: FluxoraAiModResearchFinding[] = [];
  const hypotheses: FluxoraAiModResearchHypothesis[] = [];
  const suspectMods: FluxoraAiModResearchSuspect[] = [];
  const evidenceCards: FluxoraAiModResearchEvidenceCard[] = [];
  const missingFields = new Set<string>();

  if (!buildSnapshot) {
    missingFields.add('fluxora.ai.build-context.v1');
  }

  for (const record of collectMissingMasterRecords(buildSnapshot)) {
    const sourceMod = record.sourceMod || 'Unknown source mod';
    const plugin = record.plugin || 'unknown plugin';
    const missing = record.missingMasters.join(', ');
    pushFinding(
      deterministicFindings,
      evidenceCards,
      suspectMods,
      {
        id: boundedId('finding-missing-master', [plugin, missing]),
        claim: `Plugin ${plugin} from ${sourceMod} is missing masters: ${missing}.`,
        confidence: 0.96,
        relevantMods: [sourceMod].filter(Boolean),
        sourceIds: sourceIdsForTool(record.toolName, operationId, contextBundle),
        suspectReason: 'missing-master',
        toolName: record.toolName
      },
      generatedAt,
      operationId
    );
  }

  for (const conflict of collectConflictPairs(buildSnapshot)) {
    const sampleText = conflict.fileSamples.length > 0
      ? ` Sample files: ${conflict.fileSamples.join(', ')}.`
      : '';
    pushFinding(
      deterministicFindings,
      evidenceCards,
      suspectMods,
      {
        id: boundedId('finding-file-conflict', conflict.modNames),
        claim: `Concrete file-owner conflict evidence exists between ${conflict.modNames.join(' and ')}.${sampleText}`,
        confidence: 0.82,
        relevantMods: conflict.modNames,
        sourceIds: sourceIdsForTool(conflict.toolName, operationId, contextBundle),
        suspectReason: 'concrete-file-owner-conflict',
        toolName: conflict.toolName
      },
      generatedAt,
      operationId
    );
  }

  for (const failure of collectFailedOperations(buildSnapshot)) {
    pushFinding(
      deterministicFindings,
      evidenceCards,
      suspectMods,
      {
        id: boundedId('finding-failed-operation', [failure.claim]),
        claim: failure.claim,
        confidence: 0.9,
        relevantMods: failure.relevantMods,
        sourceIds: sourceIdsForTool(failure.toolName, operationId, contextBundle),
        suspectReason: 'failed-download-install-or-operation',
        toolName: failure.toolName
      },
      generatedAt,
      operationId
    );
  }

  for (const aggregate of collectAggregateOverwriteHypotheses(buildSnapshot)) {
    pushHypothesis(
      hypotheses,
      evidenceCards,
      suspectMods,
      {
        id: boundedId('hypothesis-aggregate-overwrite', aggregate.relevantMods),
        claim: aggregate.claim,
        confidence: aggregate.confidence,
        falsifiableBy:
          'Collect bounded conflictEvidence or mods.fileTree conflictOwners for the affected mod before naming an exact mod-to-mod conflict.',
        relevantMods: aggregate.relevantMods,
        sourceIds: sourceIdsForTool(aggregate.sourceTool, operationId, contextBundle),
        suspectReason: 'aggregate-overwrite-counts-only',
        toolName: aggregate.sourceTool
      },
      generatedAt,
      operationId
    );
  }

  for (const runtime of collectRuntimeHypotheses(buildSnapshot)) {
    missingFields.add('runtime.script-extender-version');
    pushHypothesis(
      hypotheses,
      evidenceCards,
      suspectMods,
      {
        id: boundedId('hypothesis-runtime-version', runtime.relevantMods),
        claim: runtime.claim,
        confidence: runtime.confidence,
        falsifiableBy:
          'Expose structured runtime/script-extender version metadata through a future core-backed read-only check or verify official compatibility metadata.',
        relevantMods: runtime.relevantMods,
        sourceIds: sourceIdsForTool(runtime.sourceTool, operationId, contextBundle),
        suspectReason: 'runtime-script-extender-version-unverified',
        toolName: runtime.sourceTool
      },
      generatedAt,
      operationId
    );
  }

  return createAiLocalInspection({
    operationId,
    generatedAt,
    needMoreLocalData: missingFields.size > 0,
    missingFields: [...missingFields],
    deterministicFindings,
    hypotheses,
    suspect_mods: suspectMods.slice(0, MAX_LOCAL_INSPECTION_SUSPECT_MODS),
    evidenceCards
  });
};

export const createAiNexusInvestigation = (
  input: BuilderInput<FluxoraAiNexusInvestigation>
): FluxoraAiNexusInvestigation => {
  const { operationId, generatedAt, ...payload } = input;
  return {
    ...envelope(AI_NEXUS_INVESTIGATION_SCHEMA, { operationId, generatedAt }),
    ...payload
  };
};

export const createAiWebQueryPlan = (
  input: BuilderInput<FluxoraAiWebQueryPlan>
): FluxoraAiWebQueryPlan => {
  const { operationId, generatedAt, ...payload } = input;
  return {
    ...envelope(AI_WEB_QUERY_PLAN_SCHEMA, { operationId, generatedAt }),
    ...payload
  };
};

const mergeWebQueryBudget = (
  budget: Partial<FluxoraAiWebQueryPlanBudget> | undefined
): FluxoraAiWebQueryPlanBudget => ({
  maxQueries: Math.max(
    0,
    Math.min(3, Math.trunc(budget?.maxQueries ?? DEFAULT_AI_WEB_QUERY_PLAN_BUDGET.maxQueries))
  ),
  maxPages: Math.max(
    0,
    Math.min(8, Math.trunc(budget?.maxPages ?? DEFAULT_AI_WEB_QUERY_PLAN_BUDGET.maxPages))
  ),
  stopWhenSupportedClaimFound:
    budget?.stopWhenSupportedClaimFound ??
    DEFAULT_AI_WEB_QUERY_PLAN_BUDGET.stopWhenSupportedClaimFound
});

const mergeNonNexusSourcePolicy = (
  policy: Partial<FluxoraAiNonNexusWebSourcePolicy> | undefined
): FluxoraAiNonNexusWebSourcePolicy => ({
  sourcePolicyTiers:
    policy?.sourcePolicyTiers ?? DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.sourcePolicyTiers,
  preferredNonNexusDomains:
    policy?.preferredNonNexusDomains ??
    DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.preferredNonNexusDomains,
  deniedDomains: policy?.deniedDomains ?? DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.deniedDomains,
  negativeTerms: policy?.negativeTerms ?? DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.negativeTerms,
  discardHints: policy?.discardHints ?? DEFAULT_AI_NON_NEXUS_WEB_SOURCE_POLICY.discardHints
});

const buildWebSearchBudget = (
  budget: FluxoraAiWebQueryPlanBudget,
  searchBudget: Partial<FluxoraAiModResearchSearchBudget> | undefined
): FluxoraAiModResearchSearchBudget => ({
  localInspectionFiles: Math.trunc(searchBudget?.localInspectionFiles ?? 0),
  nexusApiRequests: Math.trunc(searchBudget?.nexusApiRequests ?? 0),
  publicWebQueries: budget.maxQueries,
  externalFetches: budget.maxPages,
  evidenceCards: Math.trunc(searchBudget?.evidenceCards ?? Math.max(6, budget.maxPages)),
  timeoutMs: Math.trunc(searchBudget?.timeoutMs ?? 30_000)
});

const webPlan = (
  input: FluxoraAiNonNexusWebQueryPlannerInput,
  route: FluxoraAiWebQueryPlan['route'],
  stopReason: FluxoraAiWebQueryStopReason,
  queries: FluxoraAiModResearchWebQuery[]
): FluxoraAiWebQueryPlan => {
  const budget = mergeWebQueryBudget(input.budget);
  const policy = mergeNonNexusSourcePolicy(input.sourcePolicy);
  return createAiWebQueryPlan({
    operationId: input.operationId,
    generatedAt: input.generatedAt,
    route,
    searchBudget: buildWebSearchBudget(budget, input.searchBudget),
    budget,
    sourcePolicyTiers: policy.sourcePolicyTiers,
    preferredNonNexusDomains: policy.preferredNonNexusDomains,
    deniedDomains: policy.deniedDomains,
    negativeTerms: policy.negativeTerms,
    discardHints: policy.discardHints,
    stopReason,
    queries,
    discardedSources: []
  });
};

const normalizedClaimText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const claimSupportedByPriorEvidence = (claim: string, supportedClaims: string[]): boolean => {
  const normalizedClaim = normalizedClaimText(claim);
  if (!normalizedClaim) {
    return true;
  }
  return supportedClaims.some((supported) => {
    const normalizedSupported = normalizedClaimText(supported);
    return (
      normalizedSupported.length > 0 &&
      (normalizedClaim.includes(normalizedSupported) ||
        normalizedSupported.includes(normalizedClaim))
    );
  });
};

const uniqueNonEmpty = (values: readonly (string | null | undefined)[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
};

const webQuerySignalPattern =
  /\b(?:EXCEPTION_[A-Z0-9_]+|0x[0-9a-fA-F]+|[A-Za-z0-9][A-Za-z0-9_.-]+\.(?:esp|esm|esl|dll|exe)|SKSE(?:64)?|Address Library)\b/g;

const collectExactWebTokens = (...texts: readonly string[]): string[] =>
  uniqueNonEmpty(
    texts.flatMap((text) => {
      const matches = text.match(webQuerySignalPattern);
      return matches ? [...matches] : [];
    })
  );

const compatibilityKeywordsFromText = (text: string): string[] => {
  const lower = text.toLowerCase();
  const keywords = [
    ['SKSE', 'skse'],
    ['Address Library', 'address library'],
    ['runtime', 'runtime'],
    ['compatibility', 'compatib'],
    ['dependency', 'dependenc'],
    ['changelog', 'changelog'],
    ['release notes', 'release']
  ] as const;
  return keywords
    .filter(([, needle]) => lower.includes(needle))
    .map(([keyword]) => keyword);
};

const collectSuspects = (
  localInspection: FluxoraAiLocalInspection,
  nexusInvestigation: FluxoraAiNexusInvestigation
): FluxoraAiModResearchSuspect[] => {
  const suspects: FluxoraAiModResearchSuspect[] = [];
  for (const suspect of localInspection.suspect_mods) {
    pushUniqueById(suspects, suspect);
  }
  for (const hypothesis of [...localInspection.hypotheses, ...nexusInvestigation.hypotheses]) {
    for (const mod of hypothesis.relevantMods) {
      pushSuspect(
        suspects,
        mod,
        hypothesis.claim,
        hypothesis.relevantMods.length > 0 ? hypothesis.relevantMods : [mod],
        hypothesis.confidence
      );
    }
  }
  return suspects;
};

const suspectsForClaim = (
  claim: string,
  suspects: readonly FluxoraAiModResearchSuspect[]
): FluxoraAiModResearchSuspect[] => {
  const lower = claim.toLowerCase();
  const matching = suspects.filter(
    (suspect) =>
      lower.includes(suspect.label.toLowerCase()) ||
      suspect.relevantMods.some((mod) => lower.includes(mod.toLowerCase()))
  );
  return (matching.length > 0 ? matching : suspects.slice(0, 1)).slice(0, 3);
};

const buildHighSignalWebQuery = (
  input: FluxoraAiNonNexusWebQueryPlannerInput,
  policy: FluxoraAiNonNexusWebSourcePolicy,
  claim: string,
  suspects: readonly FluxoraAiModResearchSuspect[],
  index: number
): FluxoraAiModResearchWebQuery | null => {
  const selectedSuspects = suspectsForClaim(claim, suspects);
  if (selectedSuspects.length === 0) {
    return null;
  }

  const namedSuspects = uniqueNonEmpty(selectedSuspects.map((suspect) => suspect.label));
  const exactTokens = uniqueNonEmpty([
    ...(input.exactTokens ?? []),
    ...collectExactWebTokens(claim, ...namedSuspects)
  ]).slice(0, 4);
  const compatibilityKeywords = uniqueNonEmpty([
    ...(input.compatibilityKeywords ?? []),
    ...compatibilityKeywordsFromText(claim),
    'compatibility'
  ]).slice(0, 5);
  const game = input.game?.trim() || null;
  const gameVersion = input.gameVersion?.trim() || null;
  const preferredDomains = policy.preferredNonNexusDomains.map((domain) => domain.domain);
  const queryParts = uniqueNonEmpty([
    ...namedSuspects,
    ...exactTokens,
    game,
    gameVersion,
    ...compatibilityKeywords,
    'maintainer docs',
    'GitHub release issue'
  ]);
  const query = queryParts.join(' ');

  if (!namedSuspects.some((suspect) => query.toLowerCase().includes(suspect.toLowerCase()))) {
    return null;
  }

  const highSignalTerms = uniqueNonEmpty([
    ...exactTokens,
    game,
    gameVersion,
    ...compatibilityKeywords
  ]);
  if (
    highSignalTerms.length === 0 ||
    !highSignalTerms.some((term) => query.toLowerCase().includes(term.toLowerCase()))
  ) {
    return null;
  }

  return {
    id: boundedId('query', [String(index + 1), ...namedSuspects, claim]),
    query,
    reason: `Unsupported claim or open question after local and Nexus stages: ${claim}`,
    required: true,
    namedSuspectIds: selectedSuspects.map((suspect) => suspect.id),
    namedSuspects,
    exactTokens,
    game,
    gameVersion,
    compatibilityKeywords,
    preferredDomains,
    expectedSourceTiers: ['B', 'C'],
    negativeTerms: policy.negativeTerms,
    discardHints: policy.discardHints,
    dedupeKey: boundedId('dedupe', [...namedSuspects, ...exactTokens, game ?? '', gameVersion ?? ''])
  };
};

export const planAiNonNexusWebQueries = (
  input: FluxoraAiNonNexusWebQueryPlannerInput
): FluxoraAiWebQueryPlan => {
  if (!input.localInspection || !input.nexusInvestigation) {
    return webPlan(input, 'blocked', 'required-prior-stages-missing', []);
  }
  if (input.nonNexusWebAllowed === false) {
    return webPlan(input, 'blocked', 'policy-blocked', []);
  }

  const budget = mergeWebQueryBudget(input.budget);
  const policy = mergeNonNexusSourcePolicy(input.sourcePolicy);
  const supportedClaims = [
    ...input.localInspection.deterministicFindings.map((finding) => finding.claim),
    ...input.nexusInvestigation.deterministicFindings.map((finding) => finding.claim),
    ...(input.caseState?.resolvedFacts ?? [])
  ];
  const unsupportedClaims = uniqueNonEmpty([
    ...(input.unsupportedClaims ?? []),
    ...input.localInspection.hypotheses.map((hypothesis) => hypothesis.claim),
    ...input.nexusInvestigation.hypotheses.map((hypothesis) => hypothesis.claim)
  ]).filter(
    (claim) =>
      !budget.stopWhenSupportedClaimFound ||
      !claimSupportedByPriorEvidence(claim, supportedClaims)
  );
  const openQuestions = uniqueNonEmpty([
    ...(input.openQuestions ?? []),
    ...(input.caseState?.openQuestions ?? [])
  ]).filter(
    (question) =>
      !budget.stopWhenSupportedClaimFound ||
      !claimSupportedByPriorEvidence(question, supportedClaims)
  );
  const neededResearch = [...unsupportedClaims, ...openQuestions];

  if (neededResearch.length === 0) {
    return webPlan(input, 'blocked', 'supported-by-prior-evidence', []);
  }

  const suspects = collectSuspects(input.localInspection, input.nexusInvestigation);
  if (suspects.length === 0) {
    return webPlan(input, 'insufficient-data', 'no-named-suspects', []);
  }

  const queries = neededResearch
    .map((claim, index) => buildHighSignalWebQuery(input, policy, claim, suspects, index))
    .filter((query): query is FluxoraAiModResearchWebQuery => Boolean(query))
    .slice(0, budget.maxQueries);

  return webPlan(
    input,
    queries.length > 0 ? 'non-nexus-web' : 'insufficient-data',
    openQuestions.length > 0 && unsupportedClaims.length === 0
      ? 'open-questions'
      : queries.length > 0
        ? 'unsupported-claims'
        : 'no-high-signal-query',
    queries
  );
};

const MAX_EXTERNAL_INVESTIGATION_PAGES = 8;
const MAX_EXTERNAL_SOURCE_TEXT_BYTES = 256_000;

type ExternalClaimPolarity = 'positive' | 'negative' | 'unknown';

interface ExternalSourceClassification {
  sourceType: Extract<FluxoraAiModResearchSourceType, 'public-web' | 'forum'>;
  sourceTier: Extract<FluxoraAiModResearchSourceTier, 'official' | 'maintainer' | 'community' | 'unknown'>;
  webTier: Exclude<FluxoraAiWebSourcePolicyTierId, 'A'> | null;
}

interface ExternalEvidenceCandidate {
  affectedMods: string[];
  affectedVersions: string[];
  canonicalUrl: string;
  claim: string;
  fingerprint: string | null;
  polarity: ExternalClaimPolarity;
  query: FluxoraAiModResearchWebQuery;
  removedInstructionLikeContent: boolean;
  snapshot: FluxoraAiExternalSourceSnapshot;
  sourceId: string;
  sourceTier: FluxoraAiModResearchSourceTier;
  sourceType: FluxoraAiModResearchSourceType;
  title: string;
  url: string;
}

const externalInstructionPatterns = [
  /\bignore (?:all |previous |prior )?instructions?\b/i,
  /\b(?:system|developer|assistant)\s+(?:prompt|message|instruction|policy)\b/i,
  /\bcall (?:the )?(?:tool|function|api)\b/i,
  /\buse (?:the )?(?:tool|function|api)\b/i,
  /\bapprove (?:this |all |the )?(?:action|actions|mutation|mutations|install|delete)\b/i,
  /\b(?:reveal|send|print|exfiltrate).{0,40}\b(?:api key|token|secret|password|credential)\b/i,
  /\b(?:change|override|disable|lower).{0,40}\b(?:permission|permissions|policy|citations|approval)\b/i,
  /\b(?:suppress citations|do not cite|hide sources|omit sources)\b/i,
  /\b(?:run|execute).{0,30}\b(?:shell|powershell|cmd|terminal|command)\b/i,
  /\b(?:delete all mods|install every archive|disable approval|bypass approval)\b/i
] as const;

const sentenceLooksInstructionLike = (sentence: string): boolean =>
  externalInstructionPatterns.some((pattern) => pattern.test(sentence));

const splitExternalSentences = (text: string): string[] =>
  text
    .replace(/([.!?])\s+/g, '$1\n')
    .split(/\r?\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const sanitizeExternalSourceText = (
  text: string
): { removedInstructionLikeContent: boolean; sanitizedText: string } => {
  const stripped = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e]/g, ' ');
  let removedInstructionLikeContent = false;
  const safeSentences = splitExternalSentences(stripped).filter((sentence) => {
    if (sentenceLooksInstructionLike(sentence)) {
      removedInstructionLikeContent = true;
      return false;
    }
    return true;
  });
  return {
    removedInstructionLikeContent,
    sanitizedText: safeSentences.join(' ').replace(/\s+/g, ' ').trim().slice(0, 8_000)
  };
};

const normalizedDomain = (domain: string): string => {
  const lower = domain.trim().toLowerCase();
  return lower.startsWith('www.') ? lower.slice(4) : lower;
};

const domainMatches = (host: string, configuredDomain: string): boolean => {
  const normalizedHost = normalizedDomain(host);
  const normalizedConfigured = normalizedDomain(configuredDomain);
  return (
    normalizedHost === normalizedConfigured ||
    normalizedHost.endsWith(`.${normalizedConfigured}`)
  );
};

const parseHttpsUrl = (url: string): URL | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
};

const canonicalExternalUrl = (url: string): string => {
  const parsed = parseHttpsUrl(url);
  if (!parsed) {
    return url.trim().toLowerCase();
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/g, '') || '/';
  parsed.hostname = normalizedDomain(parsed.hostname);
  return parsed.toString().toLowerCase();
};

const queryForSnapshot = (
  queryPlan: FluxoraAiWebQueryPlan,
  snapshot: FluxoraAiExternalSourceSnapshot
): FluxoraAiModResearchWebQuery | null =>
  queryPlan.queries.find((query) => query.id === snapshot.queryId) ?? null;

const allowedDomainsForPlan = (queryPlan: FluxoraAiWebQueryPlan): string[] =>
  uniqueNonEmpty([
    ...queryPlan.preferredNonNexusDomains.map((domain) => domain.domain),
    ...queryPlan.queries.flatMap((query) => query.preferredDomains)
  ]);

const urlAllowedByQueryPlan = (
  url: string,
  queryPlan: FluxoraAiWebQueryPlan,
  query: FluxoraAiModResearchWebQuery
): string | null => {
  const parsed = parseHttpsUrl(url);
  if (!parsed) {
    return 'URL must use HTTPS and a valid absolute URL.';
  }
  if (parsed.username || parsed.password) {
    return 'URL must not contain credentials.';
  }

  const deniedDomains = uniqueNonEmpty([...queryPlan.deniedDomains, 'nexusmods.com']);
  if (deniedDomains.some((domain) => domainMatches(parsed.hostname, domain))) {
    return `Domain ${parsed.hostname} is denied by the external research policy.`;
  }

  const allowedDomains = uniqueNonEmpty([
    ...allowedDomainsForPlan(queryPlan),
    ...query.preferredDomains
  ]);
  if (!allowedDomains.some((domain) => domainMatches(parsed.hostname, domain))) {
    return `Domain ${parsed.hostname} was not admitted by the query plan.`;
  }

  return null;
};

const validateExternalSnapshotPolicy = (
  snapshot: FluxoraAiExternalSourceSnapshot,
  queryPlan: FluxoraAiWebQueryPlan,
  query: FluxoraAiModResearchWebQuery
): string | null => {
  if (queryPlan.route !== 'non-nexus-web') {
    return `Query plan route ${queryPlan.route} does not allow external web investigation.`;
  }

  for (const url of [snapshot.url, ...(snapshot.redirects ?? []), snapshot.finalUrl ?? snapshot.url]) {
    const policyError = urlAllowedByQueryPlan(url, queryPlan, query);
    if (policyError) {
      return policyError;
    }
  }

  const byteLength = Math.max(numberValue(snapshot.byteLength), snapshot.text?.length ?? 0);
  if (snapshot.sizeLimitExceeded || byteLength > MAX_EXTERNAL_SOURCE_TEXT_BYTES) {
    return `Retrieved page exceeded the ${MAX_EXTERNAL_SOURCE_TEXT_BYTES} byte source snapshot limit.`;
  }

  const timeoutMs = Math.max(0, queryPlan.searchBudget.timeoutMs);
  if (snapshot.timedOut || (timeoutMs > 0 && numberValue(snapshot.elapsedMs) > timeoutMs)) {
    return `Retrieved page exceeded the ${timeoutMs}ms timeout budget.`;
  }

  if (snapshot.robotsAllowed !== true) {
    return 'Robots policy did not allow this page snapshot.';
  }
  if (snapshot.termsAllowed !== true) {
    return 'Terms policy did not allow this page snapshot.';
  }
  if (snapshot.backoffActive !== false) {
    return 'Backoff policy is active for this source.';
  }

  return null;
};

const discardedExternalSource = (
  snapshot: FluxoraAiExternalSourceSnapshot,
  discardReason: FluxoraAiModResearchDiscardReason,
  reasonDetails: string
): FluxoraAiModResearchDiscardedSource => ({
  sourceId: snapshot.sourceId,
  url: snapshot.finalUrl ?? snapshot.url ?? null,
  title: snapshot.title?.trim() || snapshot.sourceId,
  discardReason,
  reasonDetails
});

const classifyExternalSource = (
  snapshot: FluxoraAiExternalSourceSnapshot,
  queryPlan: FluxoraAiWebQueryPlan
): ExternalSourceClassification => {
  const parsed = parseHttpsUrl(snapshot.finalUrl ?? snapshot.url);
  const host = parsed?.hostname ?? '';
  const path = parsed?.pathname.toLowerCase() ?? '';
  const preferred = queryPlan.preferredNonNexusDomains.find((domain) =>
    domainMatches(host, domain.domain)
  );
  const forumLike =
    snapshot.sourceKind === 'forum' ||
    preferred?.sourceFamily === 'specialized-modding-forum' ||
    /\b(?:forum|forums|topic|thread|discussion)\b/.test(path);

  if (forumLike) {
    return { sourceType: 'forum', sourceTier: 'community', webTier: preferred?.tier ?? 'D' };
  }
  if (!preferred) {
    return {
      sourceType: snapshot.sourceKind === 'forum' ? 'forum' : 'public-web',
      sourceTier: 'unknown',
      webTier: null
    };
  }
  if (preferred.tier === 'B') {
    const sourceTier =
      preferred.sourceFamily === 'github' || preferred.sourceFamily === 'maintainer-docs'
        ? 'maintainer'
        : 'official';
    return { sourceType: 'public-web', sourceTier, webTier: preferred.tier };
  }
  return {
    sourceType: snapshot.sourceKind === 'forum' ? 'forum' : 'public-web',
    sourceTier: 'community',
    webTier: preferred.tier
  };
};

const externalVersionPattern =
  /\b(?:v(?:ersion)?\s*)?\d+\.\d+(?:\.\d+){0,2}\b/gi;

const extractVersionsFromText = (text: string): string[] =>
  uniqueNonEmpty(
    [...text.matchAll(externalVersionPattern)].map((match) =>
      match[0].replace(/^v(?:ersion)?\s*/i, '')
    )
  ).slice(0, 8);

const externalClaimPolarity = (claim: string): ExternalClaimPolarity => {
  if (
    /\b(?:not compatible|incompatible|unsupported|does not support|do not support|breaks|broken|crashes|crash|fails)\b/i.test(
      claim
    )
  ) {
    return 'negative';
  }
  if (/\b(?:supports?|compatible|works|requires?|fixed|adds support)\b/i.test(claim)) {
    return 'positive';
  }
  return 'unknown';
};

const scoreExternalSentence = (
  sentence: string,
  query: FluxoraAiModResearchWebQuery
): number => {
  const lower = sentence.toLowerCase();
  let score = 0;
  for (const suspect of query.namedSuspects) {
    if (lower.includes(suspect.toLowerCase())) {
      score += 4;
    }
  }
  for (const token of query.exactTokens) {
    if (lower.includes(token.toLowerCase())) {
      score += 3;
    }
  }
  for (const term of [query.game, query.gameVersion, ...query.compatibilityKeywords]) {
    if (term && lower.includes(term.toLowerCase())) {
      score += 1;
    }
  }
  if (externalClaimPolarity(sentence) !== 'unknown') {
    score += 2;
  }
  return score;
};

const textMatchesQuery = (
  text: string,
  query: FluxoraAiModResearchWebQuery
): boolean => {
  const lower = text.toLowerCase();
  return [...query.namedSuspects, ...query.exactTokens].some((term) =>
    lower.includes(term.toLowerCase())
  );
};

const selectExternalClaim = (
  snapshot: FluxoraAiExternalSourceSnapshot,
  query: FluxoraAiModResearchWebQuery,
  sanitizedText: string
): FluxoraAiExternalRetrievedClaim | null => {
  for (const claim of snapshot.claims ?? []) {
    const sanitizedClaim = sanitizeExternalSourceText(claim.claim).sanitizedText;
    if (sanitizedClaim && textMatchesQuery(`${sanitizedClaim} ${snapshot.title ?? ''}`, query)) {
      return { ...claim, claim: sanitizedClaim };
    }
  }

  const ranked = splitExternalSentences(sanitizedText)
    .map((sentence) => ({
      sentence,
      score: scoreExternalSentence(sentence, query)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  const best = ranked[0]?.sentence;
  return best ? { claim: best } : null;
};

const affectedModsForClaim = (
  claim: FluxoraAiExternalRetrievedClaim,
  query: FluxoraAiModResearchWebQuery,
  title: string,
  sanitizedText: string
): string[] => {
  const haystack = `${claim.claim} ${title} ${sanitizedText}`.toLowerCase();
  const queryMods = query.namedSuspects.filter((mod) => haystack.includes(mod.toLowerCase()));
  return uniqueNonEmpty([...(claim.affectedMods ?? []), ...queryMods, ...query.namedSuspects]).slice(
    0,
    8
  );
};

const seoHeavyExternalSource = (
  title: string,
  sanitizedText: string,
  queryPlan: FluxoraAiWebQueryPlan,
  query: FluxoraAiModResearchWebQuery
): boolean => {
  const lower = `${title} ${sanitizedText}`.toLowerCase();
  const terms = uniqueNonEmpty([...queryPlan.negativeTerms, ...query.negativeTerms]);
  const negativeMatches = terms.filter((term) => lower.includes(term.toLowerCase()));
  const seoPhraseMatches = ['top 10', 'ultimate guide', 'best skyrim mods', 'download free'].filter(
    (phrase) => lower.includes(phrase)
  );
  return negativeMatches.length + seoPhraseMatches.length >= 2;
};

const subjectKeyForExternalClaim = (candidate: Pick<ExternalEvidenceCandidate, 'affectedMods'>): string =>
  sourceSlug(candidate.affectedMods[0] ?? 'unknown-subject');

const buildExternalCandidate = (
  snapshot: FluxoraAiExternalSourceSnapshot,
  queryPlan: FluxoraAiWebQueryPlan,
  query: FluxoraAiModResearchWebQuery,
  sanitizedText: string,
  removedInstructionLikeContent: boolean
): ExternalEvidenceCandidate | FluxoraAiModResearchDiscardedSource => {
  const title = snapshot.title?.trim() || snapshot.sourceId;
  if (!textMatchesQuery(`${title} ${sanitizedText}`, query)) {
    return discardedExternalSource(
      snapshot,
      'off-topic',
      'The sanitized page did not contain the query plan suspect or exact token anchors.'
    );
  }
  if (seoHeavyExternalSource(title, sanitizedText, queryPlan, query)) {
    return discardedExternalSource(
      snapshot,
      'low-trust',
      'SEO-heavy or generic result matched the query discard hints instead of source evidence.'
    );
  }

  const claim = selectExternalClaim(snapshot, query, sanitizedText);
  if (!claim) {
    return discardedExternalSource(
      snapshot,
      removedInstructionLikeContent ? 'prompt-injection-risk' : 'off-topic',
      removedInstructionLikeContent
        ? 'Instruction-like page content was removed and no policy-safe claim remained.'
        : 'No relevant claim could be extracted from the sanitized page snapshot.'
    );
  }

  const classification = classifyExternalSource(snapshot, queryPlan);
  const affectedMods = affectedModsForClaim(claim, query, title, sanitizedText);
  return {
    affectedMods,
    affectedVersions: uniqueNonEmpty([
      ...(claim.affectedVersions ?? []),
      ...extractVersionsFromText(claim.claim)
    ]).slice(0, 8),
    canonicalUrl: canonicalExternalUrl(snapshot.finalUrl ?? snapshot.url),
    claim: claim.claim,
    fingerprint: snapshot.fingerprint?.trim() || null,
    polarity: externalClaimPolarity(claim.claim),
    query,
    removedInstructionLikeContent,
    snapshot,
    sourceId: snapshot.sourceId,
    sourceTier: classification.sourceTier,
    sourceType: classification.sourceType,
    title,
    url: snapshot.finalUrl ?? snapshot.url
  };
};

const sourceTierRank = (sourceTier: FluxoraAiModResearchSourceTier): number => {
  switch (sourceTier) {
    case 'official':
      return 4;
    case 'maintainer':
      return 3;
    case 'community':
      return 2;
    case 'unknown':
      return 1;
    default:
      return 0;
  }
};

const externalBaseConfidence = (
  candidate: ExternalEvidenceCandidate,
  corroborationCount: number
): number => {
  if (candidate.sourceTier === 'official') {
    return 0.88;
  }
  if (candidate.sourceTier === 'maintainer') {
    return 0.84;
  }
  if (candidate.sourceType === 'forum' && corroborationCount <= 1) {
    return 0.42;
  }
  if (candidate.sourceTier === 'community') {
    return Math.min(0.57, 0.42 + Math.max(0, corroborationCount - 1) * 0.15);
  }
  return 0.32;
};

const externalEvidenceStrength = (
  candidate: ExternalEvidenceCandidate,
  corroborationCount: number
): FluxoraAiModResearchEvidenceStrength => {
  if (candidate.sourceType === 'forum' && corroborationCount <= 1) {
    return 'weak';
  }
  if (candidate.sourceTier === 'official' || candidate.sourceTier === 'maintainer') {
    return candidate.polarity === 'unknown' ? 'indirect' : 'direct';
  }
  if (candidate.sourceTier === 'community' && corroborationCount > 1) {
    return 'indirect';
  }
  return 'weak';
};

const buildExternalConflicts = (
  candidates: ExternalEvidenceCandidate[]
): FluxoraAiExternalInvestigationConflict[] => {
  const bySubject = new Map<string, ExternalEvidenceCandidate[]>();
  for (const candidate of candidates) {
    const key = subjectKeyForExternalClaim(candidate);
    bySubject.set(key, [...(bySubject.get(key) ?? []), candidate]);
  }

  const conflicts: FluxoraAiExternalInvestigationConflict[] = [];
  for (const [subjectKey, subjectCandidates] of bySubject.entries()) {
    const positive = subjectCandidates.filter((candidate) => candidate.polarity === 'positive');
    const negative = subjectCandidates.filter((candidate) => candidate.polarity === 'negative');
    if (positive.length === 0 || negative.length === 0) {
      continue;
    }

    const strongestRank = Math.max(
      ...subjectCandidates.map((candidate) => sourceTierRank(candidate.sourceTier))
    );
    conflicts.push({
      claimGroupId: boundedId('external-conflict', [subjectKey]),
      subject: subjectCandidates[0]?.affectedMods[0] ?? subjectKey,
      sourceIds: positive.map((candidate) => candidate.sourceId),
      opposingSourceIds: negative.map((candidate) => candidate.sourceId),
      contradictionRisk: strongestRank >= 3 ? 'high' : 'medium',
      summary: `External sources disagree about ${subjectCandidates[0]?.affectedMods[0] ?? subjectKey}.`
    });
  }
  return conflicts;
};

const sourceIdsInConflicts = (
  conflicts: readonly FluxoraAiExternalInvestigationConflict[]
): Map<string, FluxoraAiModResearchRiskLevel> => {
  const riskBySource = new Map<string, FluxoraAiModResearchRiskLevel>();
  for (const conflict of conflicts) {
    for (const sourceId of [...conflict.sourceIds, ...conflict.opposingSourceIds]) {
      riskBySource.set(sourceId, conflict.contradictionRisk);
    }
  }
  return riskBySource;
};

const strongerOpposingSourceExists = (
  candidate: ExternalEvidenceCandidate,
  candidates: readonly ExternalEvidenceCandidate[]
): boolean => {
  if (candidate.polarity === 'unknown') {
    return false;
  }
  return candidates.some(
    (other) =>
      subjectKeyForExternalClaim(other) === subjectKeyForExternalClaim(candidate) &&
      other.polarity !== 'unknown' &&
      other.polarity !== candidate.polarity &&
      sourceTierRank(other.sourceTier) > sourceTierRank(candidate.sourceTier)
  );
};

const createExternalEvidenceCards = (
  input: FluxoraAiExternalInvestigationBuildInput,
  candidates: ExternalEvidenceCandidate[],
  conflicts: FluxoraAiExternalInvestigationConflict[]
): FluxoraAiModResearchEvidenceCard[] => {
  const samePolarityCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${subjectKeyForExternalClaim(candidate)}:${candidate.polarity}`;
    samePolarityCounts.set(key, (samePolarityCounts.get(key) ?? 0) + 1);
  }

  const conflictRiskBySource = sourceIdsInConflicts(conflicts);
  return candidates.map((candidate) => {
    const corroborationCount =
      samePolarityCounts.get(`${subjectKeyForExternalClaim(candidate)}:${candidate.polarity}`) ?? 1;
    const contradictionRisk = conflictRiskBySource.get(candidate.sourceId) ?? 'low';
    const weakerThanOpposition = strongerOpposingSourceExists(candidate, candidates);
    let confidence = externalBaseConfidence(candidate, corroborationCount);
    let evidenceStrength = externalEvidenceStrength(candidate, corroborationCount);

    if (contradictionRisk !== 'low') {
      confidence = Math.max(0.1, confidence - 0.15);
    }
    if (weakerThanOpposition) {
      evidenceStrength = 'contradicted';
      confidence = Math.min(confidence, 0.3);
    }

    return createAiModResearchEvidenceCard({
      operationId: input.operationId,
      generatedAt: input.generatedAt,
      sourceId: candidate.sourceId,
      sourceIds: [candidate.sourceId],
      sourceType: candidate.sourceType,
      sourceTier: candidate.sourceTier,
      citations: [
        {
          sourceId: candidate.sourceId,
          url: candidate.url,
          title: candidate.title,
          locator: candidate.removedInstructionLikeContent
            ? 'sanitized retrieved source snapshot'
            : 'retrieved source snapshot'
        }
      ],
      claim: candidate.claim,
      relevantMods: candidate.affectedMods,
      affectedVersions: candidate.affectedVersions,
      evidenceStrength,
      corroborationCount,
      confidence,
      contradictionRisk
    });
  });
};

const externalFindingsFromCards = (
  cards: readonly FluxoraAiModResearchEvidenceCard[]
): FluxoraAiModResearchFinding[] =>
  cards
    .filter(
      (card) =>
        (card.sourceTier === 'official' || card.sourceTier === 'maintainer') &&
        card.evidenceStrength === 'direct' &&
        card.contradictionRisk === 'low' &&
        card.confidence >= 0.75
    )
    .map((card) => ({
      id: boundedId('finding-external', [card.sourceId, card.claim]),
      claim: card.claim,
      relevantMods: card.relevantMods,
      affectedVersions: card.affectedVersions,
      evidenceIds: card.sourceIds,
      confidence: card.confidence,
      deterministic: true
    }));

const externalHypothesesFromCards = (
  cards: readonly FluxoraAiModResearchEvidenceCard[],
  findings: readonly FluxoraAiModResearchFinding[]
): FluxoraAiModResearchHypothesis[] => {
  const findingClaims = new Set(findings.map((finding) => finding.claim));
  return cards
    .filter((card) => !findingClaims.has(card.claim))
    .map((card) => ({
      id: boundedId('hypothesis-external', [card.sourceId, card.claim]),
      claim: card.claim,
      relevantMods: card.relevantMods,
      affectedVersions: card.affectedVersions,
      evidenceIds: card.sourceIds,
      confidence: card.confidence,
      falsifiableBy: 'Compare this external evidence card against local installed versions and official maintainer metadata.'
    }));
};

export const investigateAiExternalSources = (
  input: FluxoraAiExternalInvestigationBuildInput
): FluxoraAiExternalInvestigation => {
  const maxPages = Math.max(
    0,
    Math.min(
      MAX_EXTERNAL_INVESTIGATION_PAGES,
      Math.trunc(input.queryPlan.budget.maxPages),
      Math.trunc(input.queryPlan.searchBudget.externalFetches)
    )
  );
  const discardedSources: FluxoraAiModResearchDiscardedSource[] = [
    ...input.queryPlan.discardedSources
  ];
  const candidates: ExternalEvidenceCandidate[] = [];
  const seenUrls = new Set<string>();
  const seenFingerprints = new Set<string>();

  for (const [index, snapshot] of input.retrievedSourceSnapshots.entries()) {
    if (index >= maxPages) {
      discardedSources.push(
        discardedExternalSource(
          snapshot,
          'blocked-by-policy',
          `External investigation is capped at ${MAX_EXTERNAL_INVESTIGATION_PAGES} pages per case.`
        )
      );
      continue;
    }

    const query = queryForSnapshot(input.queryPlan, snapshot);
    if (!query) {
      discardedSources.push(
        discardedExternalSource(
          snapshot,
          'blocked-by-policy',
          'Retrieved source snapshot did not match a query id admitted by the query plan.'
        )
      );
      continue;
    }

    const policyError = validateExternalSnapshotPolicy(snapshot, input.queryPlan, query);
    if (policyError) {
      discardedSources.push(discardedExternalSource(snapshot, 'blocked-by-policy', policyError));
      continue;
    }

    const canonicalUrl = canonicalExternalUrl(snapshot.finalUrl ?? snapshot.url);
    const fingerprint = snapshot.fingerprint?.trim() || null;
    if (seenUrls.has(canonicalUrl) || (fingerprint && seenFingerprints.has(fingerprint))) {
      discardedSources.push(
        discardedExternalSource(
          snapshot,
          'duplicate',
          'Duplicate retrieved page URL or source fingerprint was already compacted into an evidence card.'
        )
      );
      continue;
    }

    const { removedInstructionLikeContent, sanitizedText } = sanitizeExternalSourceText(
      snapshot.text ?? ''
    );
    const candidateOrDiscard = buildExternalCandidate(
      snapshot,
      input.queryPlan,
      query,
      sanitizedText,
      removedInstructionLikeContent
    );
    if ('discardReason' in candidateOrDiscard) {
      discardedSources.push(candidateOrDiscard);
      continue;
    }

    seenUrls.add(canonicalUrl);
    if (fingerprint) {
      seenFingerprints.add(fingerprint);
    }
    candidates.push(candidateOrDiscard);
  }

  const conflicts = buildExternalConflicts(candidates);
  const evidenceCards = createExternalEvidenceCards(input, candidates, conflicts);
  const deterministicFindings = externalFindingsFromCards(evidenceCards);
  const hypotheses = externalHypothesesFromCards(evidenceCards, deterministicFindings);

  return createAiExternalInvestigation({
    operationId: input.operationId,
    generatedAt: input.generatedAt,
    searchBudget: {
      ...input.queryPlan.searchBudget,
      externalFetches: maxPages,
      evidenceCards: evidenceCards.length
    },
    deterministicFindings,
    hypotheses,
    evidenceCards,
    discardedSources,
    conflicts
  });
};

type DiagnosisCandidateStage = 'local' | 'nexus' | 'external' | 'loot' | 'check';
type DiagnosisCandidateKind = 'deterministic-finding' | 'hypothesis' | 'check';

interface DiagnosisCandidate {
  affectedVersions: string[];
  baseConfidence: number;
  cause: string;
  fastestValidationTest?: string;
  fixOrder?: string[];
  id: string;
  kind: DiagnosisCandidateKind;
  recommendedFix?: string;
  relevantMods: string[];
  sourceStage: DiagnosisCandidateStage;
  supportingEvidenceIds: string[];
  why: string[];
  whyNot: string[];
}

const MAX_DIAGNOSIS_RANKED_CAUSES = 6;
const DIAGNOSIS_MIN_CONFIDENCE = 0.55;

const clampConfidence = (value: number): number =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const evidenceCardsBySourceId = (
  cards: readonly FluxoraAiModResearchEvidenceCard[]
): Map<string, FluxoraAiModResearchEvidenceCard[]> => {
  const bySourceId = new Map<string, FluxoraAiModResearchEvidenceCard[]>();
  for (const card of cards) {
    for (const sourceId of uniqueNonEmpty([card.sourceId, ...card.sourceIds])) {
      bySourceId.set(sourceId, [...(bySourceId.get(sourceId) ?? []), card]);
    }
  }
  return bySourceId;
};

const cardsForEvidenceIds = (
  evidenceIds: readonly string[],
  bySourceId: Map<string, FluxoraAiModResearchEvidenceCard[]>
): FluxoraAiModResearchEvidenceCard[] => {
  const cards: FluxoraAiModResearchEvidenceCard[] = [];
  for (const evidenceId of evidenceIds) {
    for (const card of bySourceId.get(evidenceId) ?? []) {
      if (!cards.some((existing) => existing.sourceId === card.sourceId && existing.claim === card.claim)) {
        cards.push(card);
      }
    }
  }
  return cards;
};

const strongestEvidenceStage = (
  stage: DiagnosisCandidateStage,
  kind: DiagnosisCandidateKind,
  cards: readonly FluxoraAiModResearchEvidenceCard[]
): number => {
  if (stage === 'local' && kind === 'deterministic-finding') {
    return 600;
  }
  if (stage === 'nexus' && kind === 'deterministic-finding') {
    return 450;
  }
  if (stage === 'local') {
    return 400;
  }
  if (stage === 'external' && kind === 'deterministic-finding') {
    return 350;
  }
  if (stage === 'loot') {
    return 340;
  }
  if (stage === 'check') {
    return 320;
  }
  if (stage === 'nexus') {
    return 300;
  }
  const bestTier = Math.max(
    0,
    ...cards.map((card) => {
      switch (card.sourceTier) {
        case 'official':
          return 280;
        case 'maintainer':
          return 260;
        case 'community':
          return 120;
        case 'unknown':
          return 80;
        default:
          return 0;
      }
    })
  );
  return bestTier || 100;
};

const cardEvidenceQuality = (card: FluxoraAiModResearchEvidenceCard): number => {
  const tierScore = (() => {
    switch (card.sourceTier) {
      case 'local-authoritative':
        return 0.42;
      case 'nexus-api':
        return 0.34;
      case 'official':
        return 0.32;
      case 'maintainer':
        return 0.3;
      case 'community':
        return 0.12;
      default:
        return 0.04;
    }
  })();
  const strengthScore = (() => {
    switch (card.evidenceStrength) {
      case 'direct':
        return 0.28;
      case 'indirect':
        return 0.18;
      case 'weak':
        return 0.04;
      case 'contradicted':
        return -0.22;
      default:
        return 0;
    }
  })();
  const corroborationScore = Math.min(0.12, Math.max(0, card.corroborationCount - 1) * 0.04);
  return clampConfidence(tierScore + strengthScore + corroborationScore + card.confidence * 0.25);
};

const candidateHasSupportedEvidence = (
  candidate: DiagnosisCandidate,
  cards: readonly FluxoraAiModResearchEvidenceCard[]
): boolean => {
  if (candidate.supportingEvidenceIds.length === 0) {
    return false;
  }
  if (candidate.sourceStage === 'local' && candidate.kind === 'deterministic-finding') {
    return true;
  }
  const bestQuality = Math.max(0, ...cards.map(cardEvidenceQuality));
  if (candidate.kind === 'deterministic-finding' && candidate.baseConfidence >= 0.7) {
    return bestQuality >= 0.46;
  }
  return bestQuality >= 0.56 && candidate.baseConfidence >= DIAGNOSIS_MIN_CONFIDENCE;
};

const riskPenalty = (risk: FluxoraAiModResearchRiskLevel): number => {
  switch (risk) {
    case 'high':
      return 0.24;
    case 'medium':
      return 0.14;
    default:
      return 0;
  }
};

const evidenceCardPenalty = (cards: readonly FluxoraAiModResearchEvidenceCard[]): number =>
  cards.reduce((total, card) => {
    const contradictedPenalty = card.evidenceStrength === 'contradicted' ? 0.3 : 0;
    return Math.max(total, riskPenalty(card.contradictionRisk), contradictedPenalty);
  }, 0);

const conflictOppositionForEvidence = (
  evidenceIds: readonly string[],
  conflicts: readonly FluxoraAiExternalInvestigationConflict[]
): { opposingEvidenceIds: string[]; penalty: number; summaries: string[] } => {
  const evidenceIdSet = new Set(evidenceIds);
  const opposingEvidenceIds: string[] = [];
  const summaries: string[] = [];
  let penalty = 0;

  for (const conflict of conflicts) {
    const supportsPositive = conflict.sourceIds.some((sourceId) => evidenceIdSet.has(sourceId));
    const supportsNegative = conflict.opposingSourceIds.some((sourceId) => evidenceIdSet.has(sourceId));
    if (!supportsPositive && !supportsNegative) {
      continue;
    }

    const opposing = supportsPositive ? conflict.opposingSourceIds : conflict.sourceIds;
    opposingEvidenceIds.push(...opposing);
    summaries.push(conflict.summary);
    penalty = Math.max(penalty, riskPenalty(conflict.contradictionRisk));
  }

  return {
    opposingEvidenceIds: uniqueNonEmpty(opposingEvidenceIds),
    penalty,
    summaries: uniqueNonEmpty(summaries)
  };
};

const claimSuggestsMissingMaster = (claim: string): boolean =>
  /\bmissing masters?\b/i.test(claim);

const claimSuggestsCompatibility = (claim: string): boolean =>
  /\b(?:compatible|compatibility|supports?|runtime|skse|address library|version)\b/i.test(claim);

const claimSuggestsConflict = (claim: string): boolean =>
  /\b(?:conflict|overwrite|owner|winning file|load order)\b/i.test(claim);

const claimSuggestsFailedOperation = (claim: string): boolean =>
  /\b(?:failed|failure|error|download|install|operation)\b/i.test(claim);

const expectedSymptomsForCause = (cause: string): string[] => {
  if (claimSuggestsMissingMaster(cause)) {
    return [
      'Plugin dependency check reports missing masters',
      'Game or plugin load can fail before the affected plugin initializes',
      'LOOT or local checks continue flagging the missing dependency'
    ];
  }
  if (claimSuggestsCompatibility(cause)) {
    return [
      'Runtime-dependent mod can fail when the installed game or script-extender version differs',
      'Crash or disabled plugin is reproducible with the affected mod enabled'
    ];
  }
  if (claimSuggestsConflict(cause)) {
    return [
      'Files or plugins from affected mods override each other',
      'Behavior changes when the conflict winner or load order changes'
    ];
  }
  if (claimSuggestsFailedOperation(cause)) {
    return [
      'Install, download or deployment step fails before the mod reaches a usable state',
      'Operation log contains the same failure marker'
    ];
  }
  return ['Issue is reproducible when the affected mod set is enabled'];
};

const fastestValidationForCause = (candidate: DiagnosisCandidate): string => {
  if (candidate.fastestValidationTest?.trim()) {
    return candidate.fastestValidationTest.trim();
  }
  if (claimSuggestsMissingMaster(candidate.cause)) {
    return 'Check the local plugin dependency list for the named missing master and confirm the master file exists in the active build.';
  }
  if (claimSuggestsCompatibility(candidate.cause)) {
    return 'Compare the installed mod version and runtime against Nexus API or maintainer compatibility metadata.';
  }
  if (claimSuggestsConflict(candidate.cause)) {
    return 'Open the local conflict or file-owner report for the affected mods and confirm the winning file owner.';
  }
  if (claimSuggestsFailedOperation(candidate.cause)) {
    return 'Replay the failed operation in analyze mode and inspect the matching operation log entry.';
  }
  return 'Re-run the smallest read-only local check that produced the supporting evidence id.';
};

const recommendedFixForCause = (candidate: DiagnosisCandidate): string => {
  if (candidate.recommendedFix?.trim()) {
    return candidate.recommendedFix.trim();
  }
  if (claimSuggestsMissingMaster(candidate.cause)) {
    return 'Install or enable the missing master dependency before changing load order.';
  }
  if (claimSuggestsCompatibility(candidate.cause)) {
    return 'Install the mod or dependency version that matches the detected runtime.';
  }
  if (claimSuggestsConflict(candidate.cause)) {
    return 'Resolve the file or plugin conflict by choosing the intended winner, then re-run the local check.';
  }
  if (claimSuggestsFailedOperation(candidate.cause)) {
    return 'Fix the failed operation cause reported by local logs, then retry the operation.';
  }
  return 'Collect stronger local or maintainer evidence before applying a fix.';
};

const fixOrderForCause = (candidate: DiagnosisCandidate): string[] => {
  if (candidate.fixOrder && candidate.fixOrder.length > 0) {
    return uniqueNonEmpty(candidate.fixOrder);
  }
  if (claimSuggestsMissingMaster(candidate.cause)) {
    return [
      'Install or enable the missing master dependency',
      'Re-run the local plugin dependency check',
      'Run LOOT or local checks again after the dependency exists'
    ];
  }
  if (claimSuggestsCompatibility(candidate.cause)) {
    return [
      'Confirm installed mod version and runtime',
      'Update or pin the compatible mod/dependency version',
      'Re-run the launcher/runtime smoke check'
    ];
  }
  if (claimSuggestsConflict(candidate.cause)) {
    return [
      'Review the local conflict-owner evidence',
      'Set the intended mod priority or compatibility patch',
      'Re-run conflict and launch smoke checks'
    ];
  }
  if (claimSuggestsFailedOperation(candidate.cause)) {
    return [
      'Inspect the operation log evidence',
      'Fix the reported operation prerequisite',
      'Retry the operation with the same inputs'
    ];
  }
  return ['Validate the supported cause', 'Apply the smallest matching fix', 'Re-run the validation check'];
};

const sourceLabelForCandidate = (candidate: DiagnosisCandidate): string => {
  if (candidate.sourceStage === 'local' && candidate.kind === 'deterministic-finding') {
    return 'local deterministic evidence';
  }
  if (candidate.sourceStage === 'nexus') {
    return 'Nexus evidence';
  }
  if (candidate.sourceStage === 'external') {
    return 'non-Nexus web evidence';
  }
  if (candidate.sourceStage === 'loot') {
    return 'LOOT evidence';
  }
  return 'diagnostic check evidence';
};

const itemCandidate = (
  stage: DiagnosisCandidateStage,
  kind: DiagnosisCandidateKind,
  item: FluxoraAiModResearchFinding | FluxoraAiModResearchHypothesis
): DiagnosisCandidate => ({
  affectedVersions: [...item.affectedVersions],
  baseConfidence: clampConfidence(item.confidence),
  cause: item.claim,
  id: boundedId('cause', [stage, item.id, item.claim]),
  kind,
  relevantMods: uniqueNonEmpty(item.relevantMods),
  sourceStage: stage,
  supportingEvidenceIds: uniqueNonEmpty(item.evidenceIds),
  why: [`${stage}:${kind}:${item.id}`],
  whyNot: []
});

const checkCandidate = (
  stage: Extract<DiagnosisCandidateStage, 'loot' | 'check'>,
  check: FluxoraAiDiagnosisJudgeCheck
): DiagnosisCandidate => ({
  affectedVersions: [...(check.affectedVersions ?? [])],
  baseConfidence: clampConfidence(check.confidence),
  cause: check.claim,
  fastestValidationTest: check.fastestValidationTest,
  fixOrder: check.fixOrder,
  id: boundedId('cause', [stage, check.id, check.claim]),
  kind: 'check',
  recommendedFix: check.recommendedFix,
  relevantMods: uniqueNonEmpty(check.relevantMods),
  sourceStage: stage,
  supportingEvidenceIds: uniqueNonEmpty(check.evidenceIds),
  why: check.why ?? [`${stage}:check:${check.id}`],
  whyNot: check.whyNot ?? []
});

const checkEvidenceCards = (
  checks: readonly FluxoraAiDiagnosisJudgeCheck[] | undefined,
  operationId: string,
  generatedAt: string | Date | undefined
): FluxoraAiModResearchEvidenceCard[] =>
  (checks ?? []).flatMap((check) =>
    uniqueNonEmpty(check.evidenceIds).map((evidenceId) =>
      createAiModResearchEvidenceCard({
        operationId,
        generatedAt,
        sourceId: evidenceId,
        sourceIds: [evidenceId],
        sourceType: check.sourceTier === 'local-authoritative' ? 'local-metadata' : 'public-web',
        sourceTier: check.sourceTier,
        claim: check.claim,
        relevantMods: uniqueNonEmpty(check.relevantMods),
        affectedVersions: [...(check.affectedVersions ?? [])],
        evidenceStrength: check.evidenceStrength,
        confidence: clampConfidence(check.confidence),
        contradictionRisk: check.contradictionRisk ?? 'low'
      })
    )
  );

const collectDiagnosisCandidates = (
  input: FluxoraAiDiagnosisJudgeBuildInput
): DiagnosisCandidate[] => {
  const candidates: DiagnosisCandidate[] = [];
  for (const finding of input.localInspection?.deterministicFindings ?? []) {
    candidates.push(itemCandidate('local', 'deterministic-finding', finding));
  }
  for (const finding of input.nexusInvestigation?.deterministicFindings ?? []) {
    candidates.push(itemCandidate('nexus', 'deterministic-finding', finding));
  }
  for (const finding of input.externalInvestigation?.deterministicFindings ?? []) {
    candidates.push(itemCandidate('external', 'deterministic-finding', finding));
  }
  for (const hypothesis of input.localInspection?.hypotheses ?? []) {
    candidates.push(itemCandidate('local', 'hypothesis', hypothesis));
  }
  for (const hypothesis of input.nexusInvestigation?.hypotheses ?? []) {
    candidates.push(itemCandidate('nexus', 'hypothesis', hypothesis));
  }
  for (const hypothesis of input.externalInvestigation?.hypotheses ?? []) {
    candidates.push(itemCandidate('external', 'hypothesis', hypothesis));
  }
  for (const check of input.loot ?? []) {
    candidates.push(checkCandidate('loot', check));
  }
  for (const check of input.checks ?? []) {
    candidates.push(checkCandidate('check', check));
  }
  return candidates;
};

const collectDiagnosisEvidenceCards = (
  input: FluxoraAiDiagnosisJudgeBuildInput
): FluxoraAiModResearchEvidenceCard[] => [
  ...(input.localInspection?.evidenceCards ?? []),
  ...(input.nexusInvestigation?.evidenceCards ?? []),
  ...(input.externalInvestigation?.evidenceCards ?? []),
  ...checkEvidenceCards(input.loot, input.operationId, input.generatedAt),
  ...checkEvidenceCards(input.checks, input.operationId, input.generatedAt)
];

const relatedWeakEvidenceNotes = (
  candidate: DiagnosisCandidate,
  rejectedCandidates: readonly DiagnosisCandidate[]
): string[] => {
  const candidateMods = new Set(candidate.relevantMods.map((mod) => mod.toLowerCase()));
  if (candidateMods.size === 0) {
    return [];
  }
  return rejectedCandidates
    .filter((rejected) =>
      rejected.relevantMods.some((mod) => candidateMods.has(mod.toLowerCase()))
    )
    .flatMap((rejected) =>
      rejected.supportingEvidenceIds.map(
        (evidenceId) =>
          `Rejected weaker evidence ${evidenceId} because it does not meet the judge threshold.`
      )
    );
};

const nexusCompatibilityDoesNotOverrideLocalMissing = (
  candidate: DiagnosisCandidate,
  allCandidates: readonly DiagnosisCandidate[]
): string[] => {
  if (candidate.sourceStage !== 'local' || !claimSuggestsMissingMaster(candidate.cause)) {
    return [];
  }
  const candidateMods = new Set(candidate.relevantMods.map((mod) => mod.toLowerCase()));
  const nexusCompatibilityIds = allCandidates
    .filter(
      (other) =>
        other.sourceStage === 'nexus' &&
        claimSuggestsCompatibility(other.cause) &&
        other.relevantMods.some((mod) => candidateMods.has(mod.toLowerCase()))
    )
    .flatMap((other) => other.supportingEvidenceIds);
  if (nexusCompatibilityIds.length === 0) {
    return [];
  }
  return [
    `Nexus compatibility evidence does not prove the missing master file exists locally. Related evidence: ${uniqueNonEmpty(nexusCompatibilityIds).join(', ')}.`
  ];
};

export const judgeAiDiagnosis = (
  input: FluxoraAiDiagnosisJudgeBuildInput
): FluxoraAiDiagnosisJudge => {
  const allEvidenceCards = collectDiagnosisEvidenceCards(input);
  const cardsBySourceId = evidenceCardsBySourceId(allEvidenceCards);
  const allCandidates = collectDiagnosisCandidates(input);
  const externalConflicts = input.externalInvestigation?.conflicts ?? [];
  const rejectedCandidates: DiagnosisCandidate[] = [];

  const ranked = allCandidates
    .map((candidate) => {
      const supportCards = cardsForEvidenceIds(candidate.supportingEvidenceIds, cardsBySourceId);
      const conflict = conflictOppositionForEvidence(
        candidate.supportingEvidenceIds,
        externalConflicts
      );
      const cardPenalty = evidenceCardPenalty(supportCards);
      const confidence = clampConfidence(
        candidate.baseConfidence - Math.max(cardPenalty, conflict.penalty)
      );
      const supported = candidateHasSupportedEvidence(candidate, supportCards) && confidence >= DIAGNOSIS_MIN_CONFIDENCE;
      if (!supported) {
        rejectedCandidates.push(candidate);
        return null;
      }
      const stageScore = strongestEvidenceStage(candidate.sourceStage, candidate.kind, supportCards);
      const supportingEvidenceIds = uniqueNonEmpty(candidate.supportingEvidenceIds);
      const opposingEvidenceIds = uniqueNonEmpty(conflict.opposingEvidenceIds);
      const why = uniqueNonEmpty([
        ...candidate.why,
        `${sourceLabelForCandidate(candidate)} supports this root-cause candidate.`,
        ...supportCards.map(
          (card) =>
            `${card.sourceId} is ${card.sourceTier}/${card.evidenceStrength} evidence with confidence ${card.confidence.toFixed(2)}.`
        )
      ]);
      const whyNot = uniqueNonEmpty([
        ...candidate.whyNot,
        ...conflict.summaries.map(
          (summary) => `Confidence lowered because source conflict exists: ${summary}`
        )
      ]);

      return {
        candidate,
        score: stageScore + confidence,
        cause: {
          id: candidate.id,
          cause: candidate.cause,
          confidence,
          supportingEvidenceIds,
          opposingEvidenceIds,
          affectedMods: uniqueNonEmpty(candidate.relevantMods).slice(0, 8),
          expectedSymptoms: expectedSymptomsForCause(candidate.cause),
          fastestValidationTest: fastestValidationForCause(candidate),
          recommendedFix: recommendedFixForCause(candidate),
          why,
          whyNot,
          fixOrder: fixOrderForCause(candidate)
        } satisfies Omit<FluxoraAiModResearchRankedCause, 'rank'>
      };
    })
    .filter(
      (
        entry
      ): entry is {
        candidate: DiagnosisCandidate;
        score: number;
        cause: Omit<FluxoraAiModResearchRankedCause, 'rank'>;
      } => Boolean(entry)
    )
    .sort((left, right) => right.score - left.score || right.cause.confidence - left.cause.confidence)
    .slice(0, MAX_DIAGNOSIS_RANKED_CAUSES)
    .map((entry, index) => ({
      ...entry.cause,
      rank: index + 1,
      whyNot: uniqueNonEmpty([
        ...entry.cause.whyNot,
        ...relatedWeakEvidenceNotes(entry.candidate, rejectedCandidates),
        ...nexusCompatibilityDoesNotOverrideLocalMissing(entry.candidate, allCandidates)
      ])
    }));

  const routeValue = typeof input.route === 'string' ? input.route : input.route?.route;
  const missingFields =
    typeof input.route === 'string'
      ? []
      : uniqueNonEmpty([...(input.route?.missingFields ?? []), ...(input.localInspection?.missingFields ?? [])]);
  const insufficientReasons =
    ranked.length > 0
      ? []
      : uniqueNonEmpty([
          'No supported root-cause evidence met the diagnosis judge threshold.',
          missingFields.length > 0
            ? `More local evidence is required before ranking: ${missingFields.join(', ')}.`
            : undefined,
          routeValue === 'blocked' ? 'The research route is blocked by policy or missing prior stages.' : undefined
        ]);
  const confidence = ranked.length > 0 ? ranked[0].confidence : 0;

  return createAiDiagnosisJudge({
    operationId: input.operationId,
    generatedAt: input.generatedAt,
    status: ranked.length > 0 ? 'ranked' : 'insufficient',
    confidence,
    rankedCauses: ranked,
    insufficientReasons,
    deterministicFindings: [
      ...(input.localInspection?.deterministicFindings ?? []),
      ...(input.nexusInvestigation?.deterministicFindings ?? []),
      ...(input.externalInvestigation?.deterministicFindings ?? [])
    ],
    hypotheses: [
      ...(input.localInspection?.hypotheses ?? []),
      ...(input.nexusInvestigation?.hypotheses ?? []),
      ...(input.externalInvestigation?.hypotheses ?? [])
    ]
  });
};

export const createAiExternalInvestigation = (
  input: BuilderInput<FluxoraAiExternalInvestigation>
): FluxoraAiExternalInvestigation => {
  const { operationId, generatedAt, ...payload } = input;
  return {
    ...envelope(AI_EXTERNAL_INVESTIGATION_SCHEMA, { operationId, generatedAt }),
    ...payload
  };
};

export const createAiDiagnosisJudge = (
  input: BuilderInput<FluxoraAiDiagnosisJudge>
): FluxoraAiDiagnosisJudge => {
  const { operationId, generatedAt, ...payload } = input;
  return {
    ...envelope(AI_DIAGNOSIS_JUDGE_SCHEMA, { operationId, generatedAt }),
    ...payload
  };
};

export const createAiCaseState = (
  input: BuilderInput<FluxoraAiCaseState>
): FluxoraAiCaseState => {
  const { operationId, generatedAt, ...payload } = input;
  return {
    ...envelope(AI_CASE_STATE_SCHEMA, { operationId, generatedAt }),
    ...payload
  };
};

const MAX_CASE_STATE_FACTS = 12;
const MAX_CASE_STATE_OPEN_QUESTIONS = 10;
const MAX_CASE_STATE_DISCARDED_HYPOTHESES = 10;
const MAX_CASE_STATE_SOURCE_IDS = 32;
const MAX_CASE_STATE_TEXT_LENGTH = 260;
const MAX_CASE_STATE_SUMMARY_LENGTH = 900;

const cleanCaseStateText = (value: string, maxLength = MAX_CASE_STATE_TEXT_LENGTH): string =>
  value
    .replace(/\b(?:sk|pk|api|key)-[A-Za-z0-9_-]{12,}\b/g, '[redacted-secret]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [redacted-secret]')
    .replace(/\b(api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted-secret]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();

const caseStateFactFromFinding = (finding: FluxoraAiModResearchFinding): string => {
  const evidence = uniqueNonEmpty(finding.evidenceIds).slice(0, 4).join(', ');
  const suffix = evidence ? ` Evidence: ${evidence}.` : '';
  return cleanCaseStateText(`Confirmed: ${finding.claim}.${suffix}`);
};

const caseStateQuestionFromHypothesis = (hypothesis: FluxoraAiModResearchHypothesis): string =>
  cleanCaseStateText(`Probable but unconfirmed: ${hypothesis.claim}. Verify by: ${hypothesis.falsifiableBy}`);

const caseStateSourcesFromEvidenceCards = (
  cards: readonly FluxoraAiModResearchEvidenceCard[]
): string[] =>
  cards.flatMap((card) => uniqueNonEmpty([card.sourceId, ...card.sourceIds]));

const caseStateSourcesFromFindings = (
  items: ReadonlyArray<FluxoraAiModResearchFinding | FluxoraAiModResearchHypothesis>
): string[] => items.flatMap((item) => item.evidenceIds);

const caseStateSourcesFromDiagnosis = (
  diagnosis: FluxoraAiDiagnosisJudge | null | undefined
): string[] =>
  (diagnosis?.rankedCauses ?? []).flatMap((cause) => [
    ...cause.supportingEvidenceIds,
    ...cause.opposingEvidenceIds
  ]);

const collectCaseStateSourceIds = (
  input: FluxoraAiCaseStateCompressorInput
): string[] => {
  const sourceIds = [
    ...(input.previousCaseState?.sourceIds ?? []),
    ...caseStateSourcesFromFindings(input.localInspection?.deterministicFindings ?? []),
    ...caseStateSourcesFromFindings(input.localInspection?.hypotheses ?? []),
    ...caseStateSourcesFromEvidenceCards(input.localInspection?.evidenceCards ?? []),
    ...caseStateSourcesFromFindings(input.nexusInvestigation?.deterministicFindings ?? []),
    ...caseStateSourcesFromFindings(input.nexusInvestigation?.hypotheses ?? []),
    ...caseStateSourcesFromEvidenceCards(input.nexusInvestigation?.evidenceCards ?? []),
    ...caseStateSourcesFromFindings(input.externalInvestigation?.deterministicFindings ?? []),
    ...caseStateSourcesFromFindings(input.externalInvestigation?.hypotheses ?? []),
    ...caseStateSourcesFromEvidenceCards(input.externalInvestigation?.evidenceCards ?? []),
    ...caseStateSourcesFromDiagnosis(input.diagnosis)
  ];
  return uniqueNonEmpty(sourceIds).slice(0, MAX_CASE_STATE_SOURCE_IDS);
};

const defaultCaseQuotaState = (): FluxoraAiCaseQuotaState => ({
  nexusApiState: 'not-requested',
  unavailableReason: 'none',
  lastHttpStatus: null,
  retryAfterSeconds: null,
  quota: null,
  limitation: null
});

const quotaLimitationText = (
  api: FluxoraAiModResearchNexusApiStatus
): string | null => {
  if (api.state === 'quota-exhausted') {
    return 'Nexus API quota is exhausted or rate-limited; this research limitation leaves Nexus evidence incomplete for this pass.';
  }
  if (api.unavailableReason === 'invalid-credential') {
    return 'Nexus API credentials were rejected; reconnect Nexus or update the configured API key/token before retrying.';
  }
  if (api.state === 'unauthenticated' || api.unavailableReason === 'missing-credential') {
    return 'Nexus API credentials are unavailable; Nexus evidence may be incomplete.';
  }
  if (api.state === 'unavailable') {
    return 'Nexus API is unavailable for this pass; Nexus evidence may be incomplete.';
  }
  if (api.state === 'disabled') {
    return 'Nexus API research is disabled by policy for this pass.';
  }
  return null;
};

const caseQuotaStateFromNexus = (
  nexusInvestigation: FluxoraAiNexusInvestigation | null | undefined
): FluxoraAiCaseQuotaState => {
  if (!nexusInvestigation) {
    return defaultCaseQuotaState();
  }
  return {
    nexusApiState: nexusInvestigation.api.state,
    unavailableReason: nexusInvestigation.api.unavailableReason,
    lastHttpStatus: nexusInvestigation.api.lastHttpStatus,
    retryAfterSeconds: nexusInvestigation.api.retryAfterSeconds,
    quota: nexusInvestigation.quota,
    limitation: quotaLimitationText(nexusInvestigation.api)
  };
};

const collectCaseStateResolvedFacts = (
  input: FluxoraAiCaseStateCompressorInput
): string[] => {
  const facts = [
    ...(input.previousCaseState?.resolvedFacts ?? []),
    ...(input.localInspection?.deterministicFindings ?? []).map(caseStateFactFromFinding),
    ...(input.nexusInvestigation?.deterministicFindings ?? []).map(caseStateFactFromFinding),
    ...(input.externalInvestigation?.deterministicFindings ?? []).map(caseStateFactFromFinding)
  ];
  return uniqueNonEmpty(facts).slice(0, MAX_CASE_STATE_FACTS);
};

const collectCaseStateOpenQuestions = (
  input: FluxoraAiCaseStateCompressorInput,
  quotaState: FluxoraAiCaseQuotaState
): string[] => {
  const questions = [
    ...(input.previousCaseState?.openQuestions ?? []),
    ...(input.localInspection?.missingFields ?? []).map((field) =>
      cleanCaseStateText(`Missing local field: ${field}.`)
    ),
    ...(input.localInspection?.hypotheses ?? []).map(caseStateQuestionFromHypothesis),
    ...(input.nexusInvestigation?.hypotheses ?? []).map(caseStateQuestionFromHypothesis),
    ...(input.externalInvestigation?.hypotheses ?? []).map(caseStateQuestionFromHypothesis),
    ...(input.diagnosis?.insufficientReasons ?? []).map((reason) =>
      cleanCaseStateText(`Diagnosis limitation: ${reason}`)
    ),
    quotaState.limitation ?? undefined
  ];
  return uniqueNonEmpty(questions).slice(0, MAX_CASE_STATE_OPEN_QUESTIONS);
};

const collectCaseStateDiscardedHypotheses = (
  input: FluxoraAiCaseStateCompressorInput
): FluxoraAiModResearchDiscardedHypothesis[] => {
  const usedEvidenceIds = new Set(caseStateSourcesFromDiagnosis(input.diagnosis));
  const fromPrevious = input.previousCaseState?.discardedHypotheses ?? [];
  const candidates = [
    ...(input.localInspection?.hypotheses ?? []),
    ...(input.nexusInvestigation?.hypotheses ?? []),
    ...(input.externalInvestigation?.hypotheses ?? [])
  ];
  const discarded = [
    ...fromPrevious,
    ...candidates
      .filter((hypothesis) =>
        hypothesis.evidenceIds.length > 0
          ? !hypothesis.evidenceIds.some((evidenceId) => usedEvidenceIds.has(evidenceId))
          : input.diagnosis?.status === 'ranked'
      )
      .map((hypothesis) => ({
        hypothesisId: hypothesis.id,
        claim: cleanCaseStateText(hypothesis.claim),
        discardReason:
          input.diagnosis?.status === 'ranked'
            ? 'Not selected by the structured diagnosis judge for this milestone.'
            : 'Kept as an open question until structured diagnosis ranks it.',
        evidenceIds: uniqueNonEmpty(hypothesis.evidenceIds)
      }))
  ];
  const seen = new Set<string>();
  return discarded
    .filter((item) => {
      const key = `${item.hypothesisId}:${item.claim}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CASE_STATE_DISCARDED_HYPOTHESES);
};

const nextRecommendedStageForCase = (
  input: FluxoraAiCaseStateCompressorInput,
  quotaState: FluxoraAiCaseQuotaState
): FluxoraAiNextRecommendedStage => {
  if (input.caseState === 'final-answer-complete') {
    return 'complete';
  }
  if (input.caseState === 'diagnosis-complete') {
    return input.diagnosis?.status === 'insufficient' ? 'blocked' : 'write-final-answer';
  }
  if (input.caseState === 'external-pass-complete') {
    return 'run-diagnosis';
  }
  if (input.caseState === 'nexus-pass-complete') {
    return quotaState.nexusApiState === 'quota-exhausted' ? 'run-external-pass' : 'run-external-pass';
  }
  return 'run-nexus-pass';
};

const buildCaseStateSummary = (
  input: FluxoraAiCaseStateCompressorInput,
  resolvedFacts: readonly string[],
  openQuestions: readonly string[],
  sourceIds: readonly string[],
  quotaState: FluxoraAiCaseQuotaState
): string => {
  const topCause = input.diagnosis?.rankedCauses[0];
  const parts = [
    `Case milestone: ${input.caseState}.`,
    resolvedFacts[0] ? `Top confirmed fact: ${resolvedFacts[0]}` : undefined,
    topCause ? `Top probable cause: ${cleanCaseStateText(topCause.cause)}.` : undefined,
    quotaState.limitation ? `Limitation: ${quotaState.limitation}` : undefined,
    openQuestions[0] ? `Open question: ${openQuestions[0]}` : undefined,
    sourceIds.length > 0 ? `Evidence ids: ${sourceIds.slice(0, 8).join(', ')}.` : undefined,
    input.caseState === 'final-answer-complete' && input.finalAnswer
      ? `Final answer completed without claiming unperformed mutations.`
      : undefined
  ];
  return cleanCaseStateText(uniqueNonEmpty(parts).join(' '), MAX_CASE_STATE_SUMMARY_LENGTH);
};

export const compressAiCaseState = (
  input: FluxoraAiCaseStateCompressorInput
): FluxoraAiCaseState => {
  const quotaState = caseQuotaStateFromNexus(input.nexusInvestigation);
  const resolvedFacts = collectCaseStateResolvedFacts(input);
  const openQuestions = collectCaseStateOpenQuestions(input, quotaState);
  const discardedHypotheses = collectCaseStateDiscardedHypotheses(input);
  const sourceIds = collectCaseStateSourceIds(input);
  const nextRecommendedStage = nextRecommendedStageForCase(input, quotaState);
  return createAiCaseState({
    operationId: input.operationId,
    generatedAt: input.generatedAt,
    caseState: input.caseState,
    tokenSafeSummary: buildCaseStateSummary(
      input,
      resolvedFacts,
      openQuestions,
      sourceIds,
      quotaState
    ),
    resolvedFacts,
    openQuestions,
    discardedHypotheses,
    sourceIds,
    quotaState,
    nextRecommendedStage
  });
};

const ROUTES: readonly FluxoraAiModResearchRouteDecision[] = [
  'local-only',
  'nexus',
  'non-nexus-web',
  'insufficient-data',
  'blocked'
];

const WEB_PLAN_ROUTES: readonly FluxoraAiWebQueryPlan['route'][] = [
  'non-nexus-web',
  'insufficient-data',
  'blocked'
];

const CASE_STATE_MILESTONES: readonly FluxoraAiCaseStateMilestone[] = [
  'local-inspection-complete',
  'nexus-pass-complete',
  'external-pass-complete',
  'diagnosis-complete',
  'final-answer-complete'
];

const NEXT_RECOMMENDED_STAGES: readonly FluxoraAiNextRecommendedStage[] = [
  'run-nexus-pass',
  'run-external-pass',
  'run-diagnosis',
  'write-final-answer',
  'complete',
  'blocked'
];

const SOURCE_TYPES: readonly FluxoraAiModResearchSourceType[] = [
  'local-file',
  'local-metadata',
  'local-log',
  'nexus-api',
  'nexus-page',
  'public-web',
  'forum',
  'user-input'
];

const SOURCE_TIERS: readonly FluxoraAiModResearchSourceTier[] = [
  'local-authoritative',
  'nexus-api',
  'official',
  'maintainer',
  'community',
  'unknown'
];

const WEB_SOURCE_POLICY_TIERS: readonly FluxoraAiWebSourcePolicyTierId[] = [
  'A',
  'B',
  'C',
  'D'
];

const WEB_QUERY_SOURCE_TIERS: readonly Exclude<FluxoraAiWebSourcePolicyTierId, 'A'>[] = [
  'B',
  'C',
  'D'
];

const WEB_SOURCE_POLICY_STRENGTHS: readonly FluxoraAiWebSourcePolicyStrength[] = [
  'authoritative',
  'strong',
  'corroborating',
  'weak'
];

const PREFERRED_NON_NEXUS_SOURCE_FAMILIES: readonly FluxoraAiPreferredNonNexusSourceFamily[] = [
  'github',
  'maintainer-docs',
  'script-extender-docs',
  'official-changelog',
  'specialized-modding-kb',
  'specialized-modding-forum'
];

const WEB_QUERY_STOP_REASONS: readonly FluxoraAiWebQueryStopReason[] = [
  'unsupported-claims',
  'open-questions',
  'supported-by-prior-evidence',
  'required-prior-stages-missing',
  'policy-blocked',
  'no-named-suspects',
  'no-high-signal-query'
];

const EVIDENCE_STRENGTHS: readonly FluxoraAiModResearchEvidenceStrength[] = [
  'direct',
  'indirect',
  'weak',
  'contradicted'
];

const RISK_LEVELS: readonly FluxoraAiModResearchRiskLevel[] = ['low', 'medium', 'high'];

const DIAGNOSIS_JUDGE_STATUSES: readonly FluxoraAiDiagnosisJudgeStatus[] = [
  'ranked',
  'insufficient'
];

const NEXUS_API_STATES: readonly FluxoraAiModResearchNexusApiState[] = [
  'not-requested',
  'available',
  'quota-exhausted',
  'unavailable',
  'unauthenticated',
  'disabled'
];

const NEXUS_UNAVAILABLE_REASONS: readonly FluxoraAiModResearchNexusUnavailableReason[] = [
  'none',
  'missing-credential',
  'invalid-credential',
  'rate-limited',
  'service-unavailable',
  'transport-unavailable',
  'disabled-by-policy'
];

const QUOTA_SOURCES: readonly FluxoraAiModResearchNexusQuotaState['source'][] = [
  'headers',
  'cache',
  'not-provided'
];

const ORDINARY_ERROR_CATEGORIES: readonly FluxoraAiModResearchOrdinaryError['category'][] = [
  'validation',
  'network',
  'provider',
  'internal'
];

const DISCARD_REASONS: readonly FluxoraAiModResearchDiscardReason[] = [
  'duplicate',
  'off-topic',
  'stale',
  'low-trust',
  'prompt-injection-risk',
  'blocked-by-policy',
  'contradicted-by-stronger-source'
];

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const addStrictPropertyErrors = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[]
): void => {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      errors.push(`${path}.${key} is not allowed by the DTO schema.`);
    }
  }
};

const requireRecord = (
  value: unknown,
  path: string,
  errors: string[]
): Record<string, unknown> | undefined => {
  if (!isPlainRecord(value)) {
    errors.push(`${path} must be an object.`);
    return undefined;
  }
  return value;
};

const requireString = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[]
): void => {
  if (typeof record[key] !== 'string' || record[key] === '') {
    errors.push(`${path}.${key} must be a non-empty string.`);
  }
};

const requireBoolean = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[]
): void => {
  if (typeof record[key] !== 'boolean') {
    errors.push(`${path}.${key} must be a boolean.`);
  }
};

const requireNumber = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
  options: { nullable?: boolean; integer?: boolean; min?: number; max?: number } = {}
): void => {
  const value = record[key];
  if (value === null && options.nullable) {
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path}.${key} must be a finite number${options.nullable ? ' or null' : ''}.`);
    return;
  }
  if (options.integer && !Number.isInteger(value)) {
    errors.push(`${path}.${key} must be an integer.`);
  }
  if (options.min !== undefined && value < options.min) {
    errors.push(`${path}.${key} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    errors.push(`${path}.${key} must be at most ${options.max}.`);
  }
};

const requireStringOrNull = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[]
): void => {
  if (record[key] !== null && typeof record[key] !== 'string') {
    errors.push(`${path}.${key} must be a string or null.`);
  }
};

const requireEnum = <T extends string>(
  record: Record<string, unknown>,
  key: string,
  values: readonly T[],
  path: string,
  errors: string[]
): void => {
  if (typeof record[key] !== 'string' || !values.includes(record[key] as T)) {
    errors.push(`${path}.${key} must be one of: ${values.join(', ')}.`);
  }
};

const requireStringArray = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[]
): void => {
  const value = record[key];
  if (!Array.isArray(value)) {
    errors.push(`${path}.${key} must be an array.`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string') {
      errors.push(`${path}.${key}[${index}] must be a string.`);
    }
  }
};

const requireNonEmptyStringArray = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[]
): void => {
  requireStringArray(record, key, path, errors);
  if (Array.isArray(record[key]) && record[key].length === 0) {
    errors.push(`${path}.${key} must contain at least one string.`);
  }
};

const requireEnumArray = <T extends string>(
  record: Record<string, unknown>,
  key: string,
  values: readonly T[],
  path: string,
  errors: string[]
): void => {
  const value = record[key];
  if (!Array.isArray(value)) {
    errors.push(`${path}.${key} must be an array.`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || !values.includes(item as T)) {
      errors.push(`${path}.${key}[${index}] must be one of: ${values.join(', ')}.`);
    }
  }
};

const validateEnvelope = (
  record: Record<string, unknown>,
  expectedSchema: FluxoraAiModResearchPipelineSchema,
  path: string,
  errors: string[]
): void => {
  if (record.schema !== expectedSchema) {
    errors.push(`${path}.schema must be ${expectedSchema}.`);
  }
  requireString(record, 'generatedAt', path, errors);
  requireString(record, 'operationId', path, errors);
};

const validateArrayOfRecords = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
  validateItem: (item: Record<string, unknown>, itemPath: string, errors: string[]) => void
): void => {
  const value = record[key];
  if (!Array.isArray(value)) {
    errors.push(`${path}.${key} must be an array.`);
    return;
  }
  for (const [index, item] of value.entries()) {
    const itemRecord = requireRecord(item, `${path}.${key}[${index}]`, errors);
    if (itemRecord) {
      validateItem(itemRecord, `${path}.${key}[${index}]`, errors);
    }
  }
};

const validateSearchBudget = (
  value: unknown,
  path: string,
  errors: string[]
): void => {
  const record = requireRecord(value, path, errors);
  if (!record) {
    return;
  }
  addStrictPropertyErrors(
    record,
    [
      'localInspectionFiles',
      'nexusApiRequests',
      'publicWebQueries',
      'externalFetches',
      'evidenceCards',
      'timeoutMs'
    ],
    path,
    errors
  );
  for (const key of [
    'localInspectionFiles',
    'nexusApiRequests',
    'publicWebQueries',
    'externalFetches',
    'evidenceCards',
    'timeoutMs'
  ]) {
    requireNumber(record, key, path, errors, { integer: true, min: 0 });
  }
};

const validateWebQueryPlanBudget = (
  value: unknown,
  path: string,
  errors: string[]
): void => {
  const record = requireRecord(value, path, errors);
  if (!record) {
    return;
  }
  addStrictPropertyErrors(
    record,
    ['maxQueries', 'maxPages', 'stopWhenSupportedClaimFound'],
    path,
    errors
  );
  requireNumber(record, 'maxQueries', path, errors, { integer: true, min: 0, max: 3 });
  requireNumber(record, 'maxPages', path, errors, { integer: true, min: 0, max: 8 });
  requireBoolean(record, 'stopWhenSupportedClaimFound', path, errors);
};

const validateWebSourcePolicyTier = (
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void => {
  addStrictPropertyErrors(
    record,
    [
      'tier',
      'label',
      'description',
      'examples',
      'claimStrength',
      'corroborationRequired',
      'highConfidenceAllowed'
    ],
    path,
    errors
  );
  requireEnum(record, 'tier', WEB_SOURCE_POLICY_TIERS, path, errors);
  requireString(record, 'label', path, errors);
  requireString(record, 'description', path, errors);
  requireStringArray(record, 'examples', path, errors);
  requireEnum(record, 'claimStrength', WEB_SOURCE_POLICY_STRENGTHS, path, errors);
  requireBoolean(record, 'corroborationRequired', path, errors);
  requireBoolean(record, 'highConfidenceAllowed', path, errors);
};

const validatePreferredNonNexusDomain = (
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void => {
  addStrictPropertyErrors(record, ['domain', 'tier', 'sourceFamily', 'reason'], path, errors);
  requireString(record, 'domain', path, errors);
  requireEnum(record, 'tier', WEB_QUERY_SOURCE_TIERS, path, errors);
  requireEnum(record, 'sourceFamily', PREFERRED_NON_NEXUS_SOURCE_FAMILIES, path, errors);
  requireString(record, 'reason', path, errors);
  const domain = typeof record.domain === 'string' ? record.domain.toLowerCase() : '';
  if (domain.includes('nexusmods.com')) {
    errors.push(`${path}.domain must be a non-Nexus configured domain.`);
  }
};

const validateSuspect = (
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void => {
  addStrictPropertyErrors(record, ['id', 'label', 'reason', 'relevantMods', 'confidence'], path, errors);
  requireString(record, 'id', path, errors);
  requireString(record, 'label', path, errors);
  requireString(record, 'reason', path, errors);
  requireStringArray(record, 'relevantMods', path, errors);
  requireNumber(record, 'confidence', path, errors, { min: 0, max: 1 });
};

const validateFinding = (
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void => {
  addStrictPropertyErrors(
    record,
    ['id', 'claim', 'relevantMods', 'affectedVersions', 'evidenceIds', 'confidence', 'deterministic'],
    path,
    errors
  );
  requireString(record, 'id', path, errors);
  requireString(record, 'claim', path, errors);
  requireStringArray(record, 'relevantMods', path, errors);
  requireStringArray(record, 'affectedVersions', path, errors);
  requireStringArray(record, 'evidenceIds', path, errors);
  requireNumber(record, 'confidence', path, errors, { min: 0, max: 1 });
  if (record.deterministic !== true) {
    errors.push(`${path}.deterministic must be true.`);
  }
};

const validateHypothesis = (
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void => {
  addStrictPropertyErrors(
    record,
    ['id', 'claim', 'relevantMods', 'affectedVersions', 'evidenceIds', 'confidence', 'falsifiableBy'],
    path,
    errors
  );
  requireString(record, 'id', path, errors);
  requireString(record, 'claim', path, errors);
  requireStringArray(record, 'relevantMods', path, errors);
  requireStringArray(record, 'affectedVersions', path, errors);
  requireStringArray(record, 'evidenceIds', path, errors);
  requireNumber(record, 'confidence', path, errors, { min: 0, max: 1 });
  requireString(record, 'falsifiableBy', path, errors);
};

const validateEvidenceCitation = (
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void => {
  addStrictPropertyErrors(record, ['sourceId', 'url', 'title', 'locator'], path, errors);
  requireString(record, 'sourceId', path, errors);
  requireStringOrNull(record, 'url', path, errors);
  requireString(record, 'title', path, errors);
  requireString(record, 'locator', path, errors);
};

const validateEvidenceCardRecord = (
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void => {
  addStrictPropertyErrors(
    record,
    [
      'schema',
      'generatedAt',
      'operationId',
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
    ],
    path,
    errors
  );
  validateEnvelope(record, AI_EVIDENCE_CARD_SCHEMA, path, errors);
  requireString(record, 'sourceId', path, errors);
  requireStringArray(record, 'sourceIds', path, errors);
  requireEnum(record, 'sourceType', SOURCE_TYPES, path, errors);
  requireEnum(record, 'sourceTier', SOURCE_TIERS, path, errors);
  validateArrayOfRecords(record, 'citations', path, errors, validateEvidenceCitation);
  requireString(record, 'claim', path, errors);
  requireStringArray(record, 'relevantMods', path, errors);
  requireStringArray(record, 'affectedVersions', path, errors);
  requireEnum(record, 'evidenceStrength', EVIDENCE_STRENGTHS, path, errors);
  requireNumber(record, 'corroborationCount', path, errors, { integer: true, min: 0 });
  requireNumber(record, 'confidence', path, errors, { min: 0, max: 1 });
  requireEnum(record, 'contradictionRisk', RISK_LEVELS, path, errors);
  if (record.instructionsAllowed !== false) {
    errors.push(`${path}.instructionsAllowed must be false.`);
  }
  if (record.rawContentRetained !== false) {
    errors.push(`${path}.rawContentRetained must be false.`);
  }
};

const validateEvidenceCards = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[]
): void => validateArrayOfRecords(record, key, path, errors, validateEvidenceCardRecord);

const validateDiscardedSource = (
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void => {
  addStrictPropertyErrors(
    record,
    ['sourceId', 'url', 'title', 'discardReason', 'reasonDetails'],
    path,
    errors
  );
  requireString(record, 'sourceId', path, errors);
  requireStringOrNull(record, 'url', path, errors);
  requireString(record, 'title', path, errors);
  requireEnum(record, 'discardReason', DISCARD_REASONS, path, errors);
  requireString(record, 'reasonDetails', path, errors);
};

const validateDiscardedSources = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[]
): void => validateArrayOfRecords(record, key, path, errors, validateDiscardedSource);

const validateExternalInvestigationConflict = (
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void => {
  addStrictPropertyErrors(
    record,
    ['claimGroupId', 'subject', 'sourceIds', 'opposingSourceIds', 'contradictionRisk', 'summary'],
    path,
    errors
  );
  requireString(record, 'claimGroupId', path, errors);
  requireString(record, 'subject', path, errors);
  requireStringArray(record, 'sourceIds', path, errors);
  requireStringArray(record, 'opposingSourceIds', path, errors);
  requireEnum(record, 'contradictionRisk', RISK_LEVELS, path, errors);
  requireString(record, 'summary', path, errors);
};

const validateExternalInvestigationConflicts = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[]
): void =>
  validateArrayOfRecords(record, key, path, errors, validateExternalInvestigationConflict);

const validateFindings = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[]
): void => validateArrayOfRecords(record, key, path, errors, validateFinding);

const validateHypotheses = (
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[]
): void => validateArrayOfRecords(record, key, path, errors, validateHypothesis);

const validateNexusApi = (
  value: unknown,
  path: string,
  errors: string[]
): void => {
  const record = requireRecord(value, path, errors);
  if (!record) {
    return;
  }
  addStrictPropertyErrors(
    record,
    ['state', 'unavailableReason', 'lastHttpStatus', 'retryAfterSeconds'],
    path,
    errors
  );
  requireEnum(record, 'state', NEXUS_API_STATES, path, errors);
  requireEnum(record, 'unavailableReason', NEXUS_UNAVAILABLE_REASONS, path, errors);
  requireNumber(record, 'lastHttpStatus', path, errors, { nullable: true, integer: true, min: 100, max: 599 });
  requireNumber(record, 'retryAfterSeconds', path, errors, { nullable: true, integer: true, min: 0 });
};

const validateNexusQuota = (
  value: unknown,
  path: string,
  errors: string[]
): void => {
  const record = requireRecord(value, path, errors);
  if (!record) {
    return;
  }
  addStrictPropertyErrors(record, ['hourlyRemaining', 'dailyRemaining', 'resetAt', 'source'], path, errors);
  requireNumber(record, 'hourlyRemaining', path, errors, { nullable: true, integer: true, min: 0 });
  requireNumber(record, 'dailyRemaining', path, errors, { nullable: true, integer: true, min: 0 });
  requireStringOrNull(record, 'resetAt', path, errors);
  requireEnum(record, 'source', QUOTA_SOURCES, path, errors);
};

const validateCaseQuotaState = (
  value: unknown,
  path: string,
  errors: string[]
): void => {
  const record = requireRecord(value, path, errors);
  if (!record) {
    return;
  }
  addStrictPropertyErrors(
    record,
    ['nexusApiState', 'unavailableReason', 'lastHttpStatus', 'retryAfterSeconds', 'quota', 'limitation'],
    path,
    errors
  );
  requireEnum(record, 'nexusApiState', NEXUS_API_STATES, path, errors);
  requireEnum(record, 'unavailableReason', NEXUS_UNAVAILABLE_REASONS, path, errors);
  requireNumber(record, 'lastHttpStatus', path, errors, { nullable: true, integer: true, min: 100, max: 599 });
  requireNumber(record, 'retryAfterSeconds', path, errors, { nullable: true, integer: true, min: 0 });
  if (record.quota === null) {
    // No Nexus pass has run yet.
  } else {
    validateNexusQuota(record.quota, `${path}.quota`, errors);
  }
  requireStringOrNull(record, 'limitation', path, errors);
};

const validateOrdinaryError = (
  value: unknown,
  path: string,
  errors: string[]
): void => {
  if (value === null) {
    return;
  }
  const record = requireRecord(value, path, errors);
  if (!record) {
    return;
  }
  addStrictPropertyErrors(record, ['code', 'message', 'retryable', 'category'], path, errors);
  requireString(record, 'code', path, errors);
  requireString(record, 'message', path, errors);
  requireBoolean(record, 'retryable', path, errors);
  requireEnum(record, 'category', ORDINARY_ERROR_CATEGORIES, path, errors);
};

const queryContainsTerm = (query: string, term: string): boolean =>
  query.toLowerCase().includes(term.toLowerCase());

const genericWebQuery = (
  query: string,
  namedSuspects: readonly string[],
  exactTokens: readonly string[]
): boolean => {
  const lower = query.toLowerCase();
  const genericTerms = [
    'best mods',
    'top mods',
    'must have mods',
    'crash fix',
    'fix all crashes'
  ];
  return (
    genericTerms.some((term) => lower.includes(term)) &&
    (namedSuspects.length === 0 || exactTokens.length === 0)
  );
};

const validateWebQuery = (
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void => {
  addStrictPropertyErrors(
    record,
    [
      'id',
      'query',
      'reason',
      'required',
      'namedSuspectIds',
      'namedSuspects',
      'exactTokens',
      'game',
      'gameVersion',
      'compatibilityKeywords',
      'preferredDomains',
      'expectedSourceTiers',
      'negativeTerms',
      'discardHints',
      'dedupeKey'
    ],
    path,
    errors
  );
  requireString(record, 'id', path, errors);
  requireString(record, 'query', path, errors);
  requireString(record, 'reason', path, errors);
  requireBoolean(record, 'required', path, errors);
  requireStringArray(record, 'namedSuspectIds', path, errors);
  requireStringArray(record, 'namedSuspects', path, errors);
  requireStringArray(record, 'exactTokens', path, errors);
  requireStringOrNull(record, 'game', path, errors);
  requireStringOrNull(record, 'gameVersion', path, errors);
  requireStringArray(record, 'compatibilityKeywords', path, errors);
  requireStringArray(record, 'preferredDomains', path, errors);
  requireEnumArray(record, 'expectedSourceTiers', WEB_QUERY_SOURCE_TIERS, path, errors);
  requireStringArray(record, 'negativeTerms', path, errors);
  requireStringArray(record, 'discardHints', path, errors);
  requireString(record, 'dedupeKey', path, errors);

  const query = stringValue(record.query);
  const namedSuspects = stringArray(record.namedSuspects);
  const exactTokens = stringArray(record.exactTokens);
  const game = stringValue(record.game);
  const gameVersion = stringValue(record.gameVersion);
  const compatibilityKeywords = stringArray(record.compatibilityKeywords);
  const signalTerms = uniqueNonEmpty([
    ...exactTokens,
    game,
    gameVersion,
    ...compatibilityKeywords
  ]);

  if (genericWebQuery(query, namedSuspects, exactTokens)) {
    errors.push(`${path}.query is too generic for the non-Nexus planner.`);
  }
  if (namedSuspects.length === 0) {
    errors.push(`${path}.namedSuspects must include at least one named suspect.`);
  } else if (!namedSuspects.some((suspect) => queryContainsTerm(query, suspect))) {
    errors.push(`${path}.query must include at least one named suspect.`);
  }
  if (signalTerms.length === 0) {
    errors.push(
      `${path}.query must be tied to an exact error/crash token, game, version, or compatibility keyword.`
    );
  } else if (!signalTerms.some((term) => queryContainsTerm(query, term))) {
    errors.push(
      `${path}.query must include an exact error/crash token, game, version, or compatibility keyword.`
    );
  }
};

const validateRankedCause = (
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void => {
  addStrictPropertyErrors(
    record,
    [
      'id',
      'rank',
      'cause',
      'confidence',
      'supportingEvidenceIds',
      'opposingEvidenceIds',
      'affectedMods',
      'expectedSymptoms',
      'fastestValidationTest',
      'recommendedFix',
      'why',
      'whyNot',
      'fixOrder'
    ],
    path,
    errors
  );
  requireString(record, 'id', path, errors);
  requireNumber(record, 'rank', path, errors, { integer: true, min: 1 });
  requireString(record, 'cause', path, errors);
  requireNumber(record, 'confidence', path, errors, { min: 0, max: 1 });
  requireNonEmptyStringArray(record, 'supportingEvidenceIds', path, errors);
  requireStringArray(record, 'opposingEvidenceIds', path, errors);
  requireNonEmptyStringArray(record, 'affectedMods', path, errors);
  requireNonEmptyStringArray(record, 'expectedSymptoms', path, errors);
  requireString(record, 'fastestValidationTest', path, errors);
  requireString(record, 'recommendedFix', path, errors);
  requireNonEmptyStringArray(record, 'why', path, errors);
  requireStringArray(record, 'whyNot', path, errors);
  requireNonEmptyStringArray(record, 'fixOrder', path, errors);
};

const validateDiscardedHypothesis = (
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void => {
  addStrictPropertyErrors(record, ['hypothesisId', 'claim', 'discardReason', 'evidenceIds'], path, errors);
  requireString(record, 'hypothesisId', path, errors);
  requireString(record, 'claim', path, errors);
  requireString(record, 'discardReason', path, errors);
  requireStringArray(record, 'evidenceIds', path, errors);
};

const validateRoute = (record: Record<string, unknown>, errors: string[]): void => {
  addStrictPropertyErrors(record, AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_MOD_RESEARCH_ROUTE_SCHEMA].required, 'dto', errors);
  validateEnvelope(record, AI_MOD_RESEARCH_ROUTE_SCHEMA, 'dto', errors);
  requireEnum(record, 'route', ROUTES, 'dto', errors);
  requireBoolean(record, 'needMoreLocalData', 'dto', errors);
  requireStringArray(record, 'missingFields', 'dto', errors);
  validateArrayOfRecords(record, 'suspects', 'dto', errors, validateSuspect);
  validateSearchBudget(record.searchBudget, 'dto.searchBudget', errors);
};

const validateLocalInspection = (record: Record<string, unknown>, errors: string[]): void => {
  addStrictPropertyErrors(record, AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_LOCAL_INSPECTION_SCHEMA].required, 'dto', errors);
  validateEnvelope(record, AI_LOCAL_INSPECTION_SCHEMA, 'dto', errors);
  requireBoolean(record, 'needMoreLocalData', 'dto', errors);
  requireStringArray(record, 'missingFields', 'dto', errors);
  validateFindings(record, 'deterministicFindings', 'dto', errors);
  validateHypotheses(record, 'hypotheses', 'dto', errors);
  validateArrayOfRecords(record, 'suspect_mods', 'dto', errors, validateSuspect);
  validateEvidenceCards(record, 'evidenceCards', 'dto', errors);
};

const validateNexusInvestigation = (record: Record<string, unknown>, errors: string[]): void => {
  addStrictPropertyErrors(record, AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_NEXUS_INVESTIGATION_SCHEMA].required, 'dto', errors);
  validateEnvelope(record, AI_NEXUS_INVESTIGATION_SCHEMA, 'dto', errors);
  requireStringArray(record, 'targetNexusIds', 'dto', errors);
  validateNexusApi(record.api, 'dto.api', errors);
  validateNexusQuota(record.quota, 'dto.quota', errors);
  validateOrdinaryError(record.ordinaryError, 'dto.ordinaryError', errors);
  validateFindings(record, 'deterministicFindings', 'dto', errors);
  validateHypotheses(record, 'hypotheses', 'dto', errors);
  validateEvidenceCards(record, 'evidenceCards', 'dto', errors);
};

const validateWebQueryPlan = (record: Record<string, unknown>, errors: string[]): void => {
  addStrictPropertyErrors(record, AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_WEB_QUERY_PLAN_SCHEMA].required, 'dto', errors);
  validateEnvelope(record, AI_WEB_QUERY_PLAN_SCHEMA, 'dto', errors);
  requireEnum(record, 'route', WEB_PLAN_ROUTES, 'dto', errors);
  validateSearchBudget(record.searchBudget, 'dto.searchBudget', errors);
  validateWebQueryPlanBudget(record.budget, 'dto.budget', errors);
  validateArrayOfRecords(record, 'sourcePolicyTiers', 'dto', errors, validateWebSourcePolicyTier);
  validateArrayOfRecords(
    record,
    'preferredNonNexusDomains',
    'dto',
    errors,
    validatePreferredNonNexusDomain
  );
  requireStringArray(record, 'deniedDomains', 'dto', errors);
  requireStringArray(record, 'negativeTerms', 'dto', errors);
  requireStringArray(record, 'discardHints', 'dto', errors);
  requireEnum(record, 'stopReason', WEB_QUERY_STOP_REASONS, 'dto', errors);
  validateArrayOfRecords(record, 'queries', 'dto', errors, validateWebQuery);
  validateDiscardedSources(record, 'discardedSources', 'dto', errors);

  const budgetRecord = isPlainRecord(record.budget) ? record.budget : undefined;
  const maxQueries =
    typeof budgetRecord?.maxQueries === 'number' && Number.isFinite(budgetRecord.maxQueries)
      ? budgetRecord.maxQueries
      : 3;
  if (Array.isArray(record.queries) && record.queries.length > Math.min(3, maxQueries)) {
    errors.push('dto.queries must not exceed the web query budget or the hard cap of 3.');
  }

  const preferredDomains = new Set(
    arrayValue(record.preferredNonNexusDomains)
      .map(optionalRecord)
      .map((domain) => stringValue(domain?.domain).toLowerCase())
      .filter(Boolean)
  );
  const deniedDomains = new Set(stringArray(record.deniedDomains).map((domain) => domain.toLowerCase()));
  for (const [index, query] of arrayValue(record.queries).entries()) {
    const queryRecord = optionalRecord(query);
    if (!queryRecord) {
      continue;
    }
    for (const domain of stringArray(queryRecord.preferredDomains)) {
      const normalizedDomain = domain.toLowerCase();
      if (!preferredDomains.has(normalizedDomain)) {
        errors.push(`dto.queries[${index}].preferredDomains contains an unconfigured domain: ${domain}.`);
      }
      if (deniedDomains.has(normalizedDomain) || normalizedDomain.includes('nexusmods.com')) {
        errors.push(`dto.queries[${index}].preferredDomains contains a denied domain: ${domain}.`);
      }
    }
  }
};

const validateExternalInvestigation = (record: Record<string, unknown>, errors: string[]): void => {
  addStrictPropertyErrors(record, AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_EXTERNAL_INVESTIGATION_SCHEMA].required, 'dto', errors);
  validateEnvelope(record, AI_EXTERNAL_INVESTIGATION_SCHEMA, 'dto', errors);
  validateSearchBudget(record.searchBudget, 'dto.searchBudget', errors);
  validateFindings(record, 'deterministicFindings', 'dto', errors);
  validateHypotheses(record, 'hypotheses', 'dto', errors);
  validateEvidenceCards(record, 'evidenceCards', 'dto', errors);
  validateDiscardedSources(record, 'discardedSources', 'dto', errors);
  validateExternalInvestigationConflicts(record, 'conflicts', 'dto', errors);
};

const validateDiagnosisJudge = (record: Record<string, unknown>, errors: string[]): void => {
  addStrictPropertyErrors(record, AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_DIAGNOSIS_JUDGE_SCHEMA].required, 'dto', errors);
  validateEnvelope(record, AI_DIAGNOSIS_JUDGE_SCHEMA, 'dto', errors);
  requireEnum(record, 'status', DIAGNOSIS_JUDGE_STATUSES, 'dto', errors);
  requireNumber(record, 'confidence', 'dto', errors, { min: 0, max: 1 });
  validateArrayOfRecords(record, 'rankedCauses', 'dto', errors, validateRankedCause);
  requireStringArray(record, 'insufficientReasons', 'dto', errors);
  validateFindings(record, 'deterministicFindings', 'dto', errors);
  validateHypotheses(record, 'hypotheses', 'dto', errors);

  const status = stringValue(record.status);
  const rankedCauses = Array.isArray(record.rankedCauses) ? record.rankedCauses : [];
  const insufficientReasons = Array.isArray(record.insufficientReasons) ? record.insufficientReasons : [];
  if (rankedCauses.length > MAX_DIAGNOSIS_RANKED_CAUSES) {
    errors.push(`dto.rankedCauses must not exceed ${MAX_DIAGNOSIS_RANKED_CAUSES}.`);
  }
  if (status === 'ranked' && rankedCauses.length === 0) {
    errors.push('dto.rankedCauses must contain at least one cause when status is ranked.');
  }
  if (status === 'insufficient' && rankedCauses.length > 0) {
    errors.push('dto.rankedCauses must be empty when status is insufficient.');
  }
  if (status === 'insufficient' && insufficientReasons.length === 0) {
    errors.push('dto.insufficientReasons must explain why diagnosis evidence is insufficient.');
  }
  for (const [index, cause] of rankedCauses.entries()) {
    const causeRecord = optionalRecord(cause);
    if (causeRecord && causeRecord.rank !== index + 1) {
      errors.push(`dto.rankedCauses[${index}].rank must be ${index + 1}.`);
    }
  }
};

const validateCaseState = (record: Record<string, unknown>, errors: string[]): void => {
  addStrictPropertyErrors(record, AI_MOD_RESEARCH_PIPELINE_SCHEMAS[AI_CASE_STATE_SCHEMA].required, 'dto', errors);
  validateEnvelope(record, AI_CASE_STATE_SCHEMA, 'dto', errors);
  requireEnum(record, 'caseState', CASE_STATE_MILESTONES, 'dto', errors);
  requireString(record, 'tokenSafeSummary', 'dto', errors);
  requireStringArray(record, 'resolvedFacts', 'dto', errors);
  requireStringArray(record, 'openQuestions', 'dto', errors);
  validateArrayOfRecords(record, 'discardedHypotheses', 'dto', errors, validateDiscardedHypothesis);
  requireStringArray(record, 'sourceIds', 'dto', errors);
  validateCaseQuotaState(record.quotaState, 'dto.quotaState', errors);
  requireEnum(record, 'nextRecommendedStage', NEXT_RECOMMENDED_STAGES, 'dto', errors);
};

export const validateAiModResearchEvidenceCard = (
  value: unknown
): FluxoraAiModResearchValidationResult => {
  const errors: string[] = [];
  const record = requireRecord(value, 'dto', errors);
  if (record) {
    validateEvidenceCardRecord(record, 'dto', errors);
  }
  return { ok: errors.length === 0, errors };
};

export const validateAiModResearchPipelineDto = (
  value: unknown
): FluxoraAiModResearchValidationResult => {
  const errors: string[] = [];
  const record = requireRecord(value, 'dto', errors);
  if (!record) {
    return { ok: false, errors };
  }

  switch (record.schema) {
    case AI_MOD_RESEARCH_ROUTE_SCHEMA:
      validateRoute(record, errors);
      break;
    case AI_LOCAL_INSPECTION_SCHEMA:
      validateLocalInspection(record, errors);
      break;
    case AI_EVIDENCE_CARD_SCHEMA:
      validateEvidenceCardRecord(record, 'dto', errors);
      break;
    case AI_NEXUS_INVESTIGATION_SCHEMA:
      validateNexusInvestigation(record, errors);
      break;
    case AI_WEB_QUERY_PLAN_SCHEMA:
      validateWebQueryPlan(record, errors);
      break;
    case AI_EXTERNAL_INVESTIGATION_SCHEMA:
      validateExternalInvestigation(record, errors);
      break;
    case AI_DIAGNOSIS_JUDGE_SCHEMA:
      validateDiagnosisJudge(record, errors);
      break;
    case AI_CASE_STATE_SCHEMA:
      validateCaseState(record, errors);
      break;
    default:
      errors.push(`Unknown AI mod research schema: ${String(record.schema)}.`);
  }

  return { ok: errors.length === 0, errors };
};
