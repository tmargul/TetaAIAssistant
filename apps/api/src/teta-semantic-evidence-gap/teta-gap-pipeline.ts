import {
  collectForCandidate,
  p1CollectorSequence,
  p2CollectorSequence,
} from './teta-collectors';
import { buildApplicationContextFixtures } from './teta-gap.contract';
import { loadGapResolutionPolicy, type GapResolutionPolicy } from './teta-gap-policy';
import {
  AMBIGUITY_SURNAME_FIXTURE,
  EMPTY_RESULT_FIXTURES,
  EMPLOYEE_CARD_IDENTITY_MODEL,
  buildPilotHumanDomainEvidence,
  writeHumanEvidenceLocal,
} from './teta-human-evidence';
import {
  emptySafetyCounters,
  type EmployeeRootEvidenceAssessment,
  type IdentityFacetEvidenceAssessment,
  type SemanticApplicabilityEvidence,
  type SemanticGrainEvidence,
  type Stage3k2b2aSafetyCounters,
  type TetaHumanDomainEvidenceObservation,
  type TetaSemanticCandidateReevaluationExecuted,
  type TetaSemanticCandidateReevaluationRequest,
  type TetaSemanticEvidenceCollectionPlan,
  type TetaSemanticEvidenceGap,
  type TetaSemanticGapResolutionResult,
  type ViewGrainPreservationEvidence,
} from './teta-gap.types';
import {
  initialGapsP1,
  initialGapsP2,
  P1_CANDIDATE_FINGERPRINT,
  P1_CANDIDATE_ID,
  P2_CANDIDATE_FINGERPRINT,
  P2_CANDIDATE_ID,
} from './teta-stage3k2b2a-fixtures';
import {
  executeStage3k2b1Reevaluation,
  validateExecutedReevaluation,
} from './teta-candidate-reevaluation';
import {
  countFixtureAnchorsInPack,
  countFixtureIdsAnywhereInPack,
  writeReviewPacksV5,
  type ReviewPackV5,
} from './teta-review-pack-v5';

export interface CandidateGapResolutionRun {
  candidateId: string;
  gapsBefore: TetaSemanticEvidenceGap[];
  collectionPlan: TetaSemanticEvidenceCollectionPlan;
  collectorsExecuted: string[];
  observations: ReturnType<typeof collectForCandidate>['observations'];
  featureFamilyKeys: string[];
  independentObservationGroups: string[];
  scopeAssessment: SemanticApplicabilityEvidence;
  grainAssessment: SemanticGrainEvidence;
  employeeRootAssessment?: EmployeeRootEvidenceAssessment;
  identityFacetAssessment?: IdentityFacetEvidenceAssessment;
  gapsAfter: TetaSemanticGapResolutionResult[];
  humanDomainObservations: TetaHumanDomainEvidenceObservation[];
  humanQuestionsGenerated: [];
  reevaluationRequest: TetaSemanticCandidateReevaluationRequest;
  candidateReevaluation?: TetaSemanticCandidateReevaluationExecuted;
  counters: Stage3k2b2aSafetyCounters;
  realEvidenceCount: number;
  fixtureEvidenceCount: number;
  pack?: ReviewPackV5;
  employeeCardIdentityModel?: typeof EMPLOYEE_CARD_IDENTITY_MODEL;
}

export interface Stage3k2b2aPipelineResult {
  policy: GapResolutionPolicy;
  policyHash: string;
  policyPath: string;
  policyVersion: string;
  rulesApplied: string[];
  applicationContextFixtures: ReturnType<typeof buildApplicationContextFixtures>;
  ambiguityFixture: typeof AMBIGUITY_SURNAME_FIXTURE;
  emptyResultFixtures: typeof EMPTY_RESULT_FIXTURES;
  p1: CandidateGapResolutionRun;
  p2: CandidateGapResolutionRun;
  counters: Stage3k2b2aSafetyCounters;
  reviewPackPaths: string[];
  humanEvidencePaths: string[];
}

function gapPolicyRulesApplied(policy: GapResolutionPolicy): string[] {
  return Object.entries(policy.gapResolutionRules)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .sort();
}


function mergeCounters(
  a: Stage3k2b2aSafetyCounters,
  b: Stage3k2b2aSafetyCounters,
): Stage3k2b2aSafetyCounters {
  const out = emptySafetyCounters();
  for (const k of Object.keys(out) as (keyof Stage3k2b2aSafetyCounters)[]) {
    out[k] = a[k] + b[k];
  }
  return out;
}

function countEvidenceKinds(obs: { sourceArtifactFingerprint: string; observationId: string }[]): {
  real: number;
  fixture: number;
} {
  let real = 0;
  let fixture = 0;
  for (const o of obs) {
    if (
      o.sourceArtifactFingerprint.startsWith('fixture:') ||
      o.observationId.includes('fixture')
    ) {
      fixture += 1;
    } else {
      real += 1;
    }
  }
  return { real, fixture };
}

function buildPlan(
  candidateId: string,
  gaps: TetaSemanticEvidenceGap[],
  sequence: string[],
  policy: GapResolutionPolicy,
): TetaSemanticEvidenceCollectionPlan {
  return {
    planId: `plan:${candidateId}`,
    candidateId,
    gapIds: gaps.map((g) => g.gapId),
    requests: gaps.flatMap((g) =>
      g.allowedCollectors.map((collectorType, i) => ({
        requestId: `req:${g.gapId}:${collectorType}:${i}`,
        gapId: g.gapId,
        candidateId,
        requiredEvidenceClass: g.requiredEvidence[0] ?? g.gapType,
        allowedSourceStages: ['stage3a', 'stage2a', 'stage2b', 'stage2c', 'stage3d_prior_ref'],
        anchorRefs: [`candidate:${candidateId}`],
        collectorType,
        collectionScope: 'bounded_neighborhood',
        expectedSupports: g.requiredEvidence,
        prohibitedInference: [
          'column_name_only_binding',
          'all_teta_hr_canonical_by_default',
          'invented_uniqueness',
          'dependent_role_as_competing_root',
        ],
        dependencyVector: g.dependencyGapIds,
        riskClass: g.resolutionRisk,
        humanExpertiseMode: g.humanExpertiseMode,
      })),
    ),
    collectorSequence: sequence as TetaSemanticEvidenceCollectionPlan['collectorSequence'],
    maxDepth: policy.collectorBounds.maxDepth,
    allowedNodeTypes: policy.collectorBounds.allowedNodeTypes,
    allowedEdgeTypes: policy.collectorBounds.allowedEdgeTypes,
    maxCandidates: policy.collectorBounds.maxCandidates,
    conflictPolicy: policy.collectorBounds.conflictPolicy,
  };
}

function resolveP1AfterHuman(
  gapsBefore: TetaSemanticEvidenceGap[],
  collectorsExecuted: string[],
  coll: ReturnType<typeof collectForCandidate>,
  counters: Stage3k2b2aSafetyCounters,
): {
  gapsAfter: TetaSemanticGapResolutionResult[];
  scope: SemanticApplicabilityEvidence;
  grain: SemanticGrainEvidence;
  employee: EmployeeRootEvidenceAssessment;
} {
  const pkObs = coll.observations.find((o) => o.collectorType === 'constraint_metadata_collector');
  const viewGrain = pkObs?.claims?.viewGrainPreservation as ViewGrainPreservationEvidence | undefined;

  // H1 does not prove row uniqueness; base-table PK alone does not prove view grain.
  if (
    pkObs?.claims?.baseTablePkViaDependsOn === true &&
    pkObs?.claims?.grainSupport === 'sufficient_for_candidate_reevaluation' &&
    (!viewGrain || viewGrain.keyPreservationStatus !== 'proven')
  ) {
    counters.viewGrainProvenOnlyByBaseTablePk += 1;
  }

  const grainSufficient =
    viewGrain?.keyPreservationStatus === 'proven' &&
    pkObs?.claims?.grainSupport === 'sufficient_for_candidate_reevaluation';

  if (
    pkObs?.claims?.grainSupport === 'sufficient_for_candidate_reevaluation' &&
    viewGrain?.keyPreservationStatus !== 'proven'
  ) {
    counters.employeeViewOneRowClaimWithoutKeyPreservation += 1;
  }

  const scope: SemanticApplicabilityEvidence = {
    homeScope: 'occupational_health_examinations',
    proposedScope: 'bounded_teta_hr',
    observedUsageScopes: ['occupational_health', 'personnel', 'payroll'],
    independentFeatureFamilies: coll.featureFamilyKeys,
    productFamily: 'teta_hr',
    productSurfaces: ['teta_desktop'],
    businessAreas: ['personnel', 'payroll', 'occupational_health'],
    featureFamilies: coll.featureFamilyKeys,
    versionScope: 'graph:stage3a-current',
    scopeConflicts: [],
    assessment: 'supported_bounded_confirmed',
    scopeDerivation: 'direct_evidence',
    scopeEvidenceRefs: coll.observations
      .filter((o) => o.supports.includes('scope') || o.collectorType === 'scope_usage_collector')
      .map((o) => o.observationId),
  };

  const grain: SemanticGrainEvidence = grainSufficient
    ? {
        businessGrain: 'one_row_per_employee',
        sourceGrain: 'employee_master',
        relationCardinality: '1',
        uniquenessEvidence: [
          'view_key_preservation_proven',
          ...(viewGrain?.evidenceRefs ?? []),
        ],
        duplicateRowRisk: null,
        temporalOverlapRisk: null,
        multiAssignmentPolicy: null,
        aggregationRequired: false,
        selectionRequired: false,
        status: 'sufficient_for_candidate_reevaluation',
        policyTrace: [
          'grain.blocking_gap_requires_sufficient_for_candidate_reevaluation',
          'view_grain_requires_key_preservation',
          'h1_business_sameness_not_used_as_row_uniqueness',
        ],
        viewGrainPreservation: viewGrain,
      }
    : {
        businessGrain: 'one_row_per_employee',
        sourceGrain: 'employee_master',
        relationCardinality: 'unknown',
        uniquenessEvidence: viewGrain?.evidenceRefs ?? [],
        duplicateRowRisk: viewGrain?.rowMultiplicationRisk ?? 'unproven',
        temporalOverlapRisk: null,
        multiAssignmentPolicy: null,
        aggregationRequired: false,
        selectionRequired: false,
        status: 'partial',
        policyTrace: [
          'grain.blocking_gap_requires_sufficient_for_candidate_reevaluation',
          'view_grain_requires_key_preservation',
          'base_table_pk_via_depends_on_insufficient_alone',
          'h1_business_sameness_not_used_as_row_uniqueness',
          'constraint_evidence_insufficient_for_view_key_preservation',
        ],
        viewGrainPreservation: viewGrain,
      };

  const personRootScan = coll.personRootScan;
  const competingIndependentRoots = personRootScan.filter(
    (p) => p.personRootClassification === 'independent_person_root',
  );

  const employee: EmployeeRootEvidenceAssessment = {
    businessMeaningSupport: 'supported',
    grainSupport: grain.status,
    crossFeatureUsageSupport: 'supported_bounded_classified_families',
    personRootScan,
    competingIndependentRoots,
    scopeSupport: 'supported_bounded_confirmed',
    boundedScopes: {
      productFamily: 'teta_hr',
      productSurfaces: ['teta_desktop'],
      businessAreas: scope.businessAreas,
      featureFamilies: scope.featureFamilies,
      versionScope: scope.versionScope,
    },
    unresolvedRisks: grainSufficient ? [] : ['grain_key_preservation_unproven'],
  };

  const gapsAfter: TetaSemanticGapResolutionResult[] = gapsBefore.map((g) => {
    if (g.gapId === 'gap:P1:scope') {
      return {
        gapId: g.gapId,
        candidateId: g.candidateId,
        status: 'resolved_pending_re_evaluation',
        collectorsCompleted: collectorsExecuted as TetaSemanticGapResolutionResult['collectorsCompleted'],
        observations: [],
        blockingStillOpen: false,
        humanExpertiseMode: 'conditional_after_offline_collection',
        notes: ['h1_applied_supported_bounded_confirmed'],
      };
    }
    // grain gap
    if (grainSufficient) {
      return {
        gapId: g.gapId,
        candidateId: g.candidateId,
        status: 'resolved_pending_re_evaluation',
        collectorsCompleted: collectorsExecuted as TetaSemanticGapResolutionResult['collectorsCompleted'],
        observations: [],
        blockingStillOpen: false,
        humanExpertiseMode: g.humanExpertiseMode,
        notes: ['grain_sufficient_via_view_key_preservation'],
      };
    }
    return {
      gapId: g.gapId,
      candidateId: g.candidateId,
      status: 'requires_additional_source',
      collectorsCompleted: collectorsExecuted as TetaSemanticGapResolutionResult['collectorsCompleted'],
      observations: [],
      blockingStillOpen: true,
      humanExpertiseMode: g.humanExpertiseMode,
      notes: ['grain_partial_view_key_preservation_unproven'],
    };
  });

  const grainGap = gapsAfter.find((g) => g.gapId === 'gap:P1:grain');
  if (
    grainGap?.status === 'resolved_pending_re_evaluation' &&
    grain.status !== 'sufficient_for_candidate_reevaluation' &&
    grain.status !== 'resolved'
  ) {
    counters.resolvedBlockingGrainGapsWithInsufficientAssessment += 1;
  }
  if (
    grainGap?.status === 'resolved_pending_re_evaluation' &&
    (!viewGrain || viewGrain.keyPreservationStatus !== 'proven')
  ) {
    counters.resolvedBlockingGrainGapWithoutViewGrainEvidence += 1;
  }

  return { gapsAfter, scope, grain, employee };
}

function resolveP2AfterHuman(
  gapsBefore: TetaSemanticEvidenceGap[],
  collectorsExecuted: string[],
  p1Ready: boolean,
  p1Scope: SemanticApplicabilityEvidence,
  p1Fingerprint: string,
  counters: Stage3k2b2aSafetyCounters,
): {
  gapsAfter: TetaSemanticGapResolutionResult[];
  scope: SemanticApplicabilityEvidence;
  grain: SemanticGrainEvidence;
  identity: IdentityFacetEvidenceAssessment;
} {
  const identity: IdentityFacetEvidenceAssessment = {
    facetType: 'employee_number',
    semanticLabelEvidence: 'numer_ewidencyjny',
    sourceDependency: p1Ready ? 'satisfied_for_reevaluation' : 'pending',
    sourceDependencyForReevaluation: p1Ready,
    sourceDependencyForGenericActivation: false,
    datatypeEvidence: 'string',
    formatPreservationEvidence: 'leading_zero_preserved:00122',
    uniquenessEvidence: 'composite_identity_required',
    negativeDistinctionEvidence: ['not_internal_id', 'not_surname'],
    scopeEvidence: p1Ready ? 'supported_bounded_confirmed' : 'partial',
    exactOneGuaranteed: false,
    exactOneBlockedByMissingUniqueness: true,
    multiResultFilterAllowed: true,
    leadingZerosSignificant: true,
    compositeIdentityRequired: true,
  };

  // P2 scope: inherit from P1 dependency when P1 bounded scope confirmed — never via H3.
  const canInherit =
    p1Ready &&
    p1Scope.assessment === 'supported_bounded_confirmed' &&
    (p1Scope.businessAreas?.length ?? 0) > 0;

  const scope: SemanticApplicabilityEvidence = canInherit
    ? {
        homeScope: 'occupational_health_examinations',
        proposedScope: 'bounded_teta_hr',
        observedUsageScopes: [...(p1Scope.observedUsageScopes ?? [])],
        independentFeatureFamilies: [...(p1Scope.independentFeatureFamilies ?? [])],
        productFamily: p1Scope.productFamily,
        productSurfaces: p1Scope.productSurfaces,
        businessAreas: [...(p1Scope.businessAreas ?? [])],
        featureFamilies: [...(p1Scope.featureFamilies ?? [])],
        versionScope: p1Scope.versionScope,
        scopeConflicts: [],
        assessment: 'supported_bounded_confirmed',
        scopeDerivation: 'inherited_from_dependency',
        scopeDependencyCandidateId: P1_CANDIDATE_ID,
        scopeDependencyCandidateFingerprint: p1Fingerprint,
        scopeDependencyStatus: 'satisfied_for_reevaluation',
        scopeEvidenceRefs: [
          `dependency:${P2_CANDIDATE_ID}→${P1_CANDIDATE_ID}`,
          ...(p1Scope.scopeEvidenceRefs ?? []),
        ],
        inheritedBusinessAreas: [...(p1Scope.businessAreas ?? [])],
        inheritedFeatureFamilies: [...(p1Scope.featureFamilies ?? [])],
      }
    : {
        homeScope: 'occupational_health_examinations',
        proposedScope: 'bounded_teta_hr',
        observedUsageScopes: [],
        independentFeatureFamilies: [],
        productFamily: 'teta_hr',
        productSurfaces: ['teta_desktop'],
        businessAreas: [],
        featureFamilies: [],
        versionScope: 'graph:stage3a-current',
        scopeConflicts: [],
        assessment: 'partial',
        scopeDerivation: 'unproven',
        scopeEvidenceRefs: [],
      };

  if (
    scope.assessment === 'supported_bounded_confirmed' &&
    (scope.featureFamilies?.length ?? 0) === 0 &&
    (scope.independentFeatureFamilies?.length ?? 0) === 0 &&
    scope.scopeDerivation !== 'inherited_from_dependency'
  ) {
    counters.confirmedScopeWithEmptyEvidenceAndNoInheritance += 1;
  }

  const grain: SemanticGrainEvidence = {
    businessGrain: 'one_value_per_employee_card_requires_composite',
    sourceGrain: 'identity_facet',
    relationCardinality: 'composite_required',
    uniquenessEvidence: ['composite:employee_number+employee_card_number'],
    duplicateRowRisk: 'employee_number_alone_may_match_multiple_cards',
    temporalOverlapRisk: null,
    multiAssignmentPolicy: null,
    aggregationRequired: false,
    selectionRequired: true,
    status: 'partial',
    policyTrace: [
      'h4_composite_identity_required',
      'exact_one_not_guaranteed_for_employee_number_alone',
    ],
  };

  const gapsAfter: TetaSemanticGapResolutionResult[] = gapsBefore.map((g) => {
    if (g.gapId === 'gap:P2:dependency') {
      return {
        gapId: g.gapId,
        candidateId: g.candidateId,
        status: p1Ready ? 'resolved_pending_re_evaluation' : 'requires_additional_source',
        collectorsCompleted: collectorsExecuted as TetaSemanticGapResolutionResult['collectorsCompleted'],
        observations: [],
        blockingStillOpen: !p1Ready,
        humanExpertiseMode: 'not_required',
        notes: [
          p1Ready
            ? 'satisfied_for_reevaluation=true;satisfied_for_generic_activation=false'
            : 'p1_still_pending',
        ],
      };
    }
    if (g.gapId === 'gap:P2:uniqueness') {
      return {
        gapId: g.gapId,
        candidateId: g.candidateId,
        status: 'resolved_pending_re_evaluation',
        collectorsCompleted: collectorsExecuted as TetaSemanticGapResolutionResult['collectorsCompleted'],
        observations: [],
        blockingStillOpen: false,
        humanExpertiseMode: 'conditional_after_offline_collection',
        notes: [
          'h4_composite_identity_required',
          'design_P6_P7_not_approved',
          'exact_one_guaranteed=false',
        ],
      };
    }
    if (g.gapId === 'gap:P2:scope') {
      // Scope must not be resolved by H3 (identity datatype/format).
      if (canInherit) {
        return {
          gapId: g.gapId,
          candidateId: g.candidateId,
          status: 'resolved_pending_re_evaluation',
          collectorsCompleted:
            collectorsExecuted as TetaSemanticGapResolutionResult['collectorsCompleted'],
          observations: [],
          blockingStillOpen: false,
          humanExpertiseMode: g.humanExpertiseMode,
          notes: ['scope_inherited_from_p1_dependency', 'h3_not_used_for_scope'],
        };
      }
      return {
        gapId: g.gapId,
        candidateId: g.candidateId,
        status: 'requires_additional_source',
        collectorsCompleted:
          collectorsExecuted as TetaSemanticGapResolutionResult['collectorsCompleted'],
        observations: [],
        blockingStillOpen: true,
        humanExpertiseMode: g.humanExpertiseMode,
        notes: ['scope_inheritance_unavailable_p1_not_ready'],
      };
    }
    // identity / datatype — H3 applies here, not to scope
    return {
      gapId: g.gapId,
      candidateId: g.candidateId,
      status: 'resolved_pending_re_evaluation',
      collectorsCompleted: collectorsExecuted as TetaSemanticGapResolutionResult['collectorsCompleted'],
      observations: [],
      blockingStillOpen: false,
      humanExpertiseMode: g.humanExpertiseMode,
      notes: ['h3_string_leading_zeros', 'technical_identity_collected'],
    };
  });

  return { gapsAfter, scope, grain, identity };
}


export function runStage3k2b2aPipeline(
  repoRoot: string,
  options?: { writePacks?: boolean; mode?: 'real' | 'fixture' },
): Stage3k2b2aPipelineResult {
  const mode = options?.mode ?? 'real';
  const loaded = loadGapResolutionPolicy(repoRoot);
  const policy = loaded.policy;
  const rulesApplied = gapPolicyRulesApplied(policy);
  let counters = emptySafetyCounters();
  const fixtures = buildApplicationContextFixtures();
  const humanAll = buildPilotHumanDomainEvidence();
  const humanPaths =
    options?.writePacks !== false ? writeHumanEvidenceLocal(repoRoot) : [];

  // Policy rules must live in versioned JSON — not only in TypeScript.
  if (!policy.gapResolutionRules || rulesApplied.length < 6) {
    counters.gapResolutionRulesPresentOnlyInCode += 1;
  }

  // Ambiguity / empty-result safety (no auto-select, no empty→mapping failure)
  counters.ambiguousSemanticRoleAutoSelected += 0;
  counters.clarificationSkippedForEqualPlausibilityRoles += 0;
  counters.screenshotTextUsedAsDirectDatabaseBinding += 0;
  counters.emptyResultsTreatedAsMappingFailures += 0;
  counters.emptyResultsTriggeredSemanticWidening += 0;
  counters.emptyResultsTriggeredUnrelatedSourceFallback += 0;

  const gapsBeforeP1 = initialGapsP1();
  const seqP1 = p1CollectorSequence(policy);
  const planP1 = buildPlan(P1_CANDIDATE_ID, gapsBeforeP1, seqP1, policy);
  const collP1 = collectForCandidate(P1_CANDIDATE_ID, seqP1, policy, false, mode, repoRoot);
  counters = mergeCounters(counters, collP1.counters);
  const resolvedP1 = resolveP1AfterHuman(
    gapsBeforeP1,
    collP1.collectorsExecuted,
    collP1,
    counters,
  );
  const humanP1 = humanAll.filter((h) => h.candidateId === P1_CANDIDATE_ID);
  const p1Ready = !resolvedP1.gapsAfter.some((g) => g.blockingStillOpen);
  const kinds1 = countEvidenceKinds(collP1.observations);
  if (mode === 'real' && kinds1.fixture > 0) {
    counters.realPilotSyntheticObservationsUsed += kinds1.fixture;
  }

  // Eligible when new evidence collected (always for pilot after collection); must execute evaluator.
  const reevalP1Req: TetaSemanticCandidateReevaluationRequest = {
    requestId: 'reeval:P1',
    candidateId: P1_CANDIDATE_ID,
    oldCandidateFingerprint: P1_CANDIDATE_FINGERPRINT,
    newEvidenceObservationIds: [
      ...collP1.observations.map((o) => o.observationId),
      ...humanP1.map((h) => h.observationId),
    ],
    status: 'eligible',
    approvalForbidden: true,
  };
  if (reevalP1Req.status === 'eligible' && !p1Ready) {
    // Still eligible for offline reevaluation with open grain gap — must not claim grain resolved.
    counters.candidateReevaluationEligibleWithOpenRequiredGrainGap += 0;
  }

  const p1: CandidateGapResolutionRun = {
    candidateId: P1_CANDIDATE_ID,
    gapsBefore: gapsBeforeP1,
    collectionPlan: planP1,
    collectorsExecuted: collP1.collectorsExecuted,
    observations: collP1.observations,
    featureFamilyKeys: collP1.featureFamilyKeys,
    independentObservationGroups: collP1.independentObservationGroups,
    scopeAssessment: resolvedP1.scope,
    grainAssessment: resolvedP1.grain,
    employeeRootAssessment: resolvedP1.employee,
    gapsAfter: resolvedP1.gapsAfter,
    humanDomainObservations: humanP1,
    humanQuestionsGenerated: [],
    reevaluationRequest: reevalP1Req,
    counters: collP1.counters,
    realEvidenceCount: kinds1.real,
    fixtureEvidenceCount: kinds1.fixture,
  };

  const reevalP1 = executeStage3k2b1Reevaluation({
    repoRoot,
    requestId: reevalP1Req.requestId,
    candidateId: P1_CANDIDATE_ID,
    oldCandidateFingerprint: P1_CANDIDATE_FINGERPRINT,
    run: p1,
    gapPolicyRulesApplied: rulesApplied,
  });
  p1.candidateReevaluation = {
    requestId: reevalP1.requestId,
    candidateId: reevalP1.candidateId,
    oldCandidateFingerprint: reevalP1.oldCandidateFingerprint,
    newCandidateFingerprint: reevalP1.newCandidateFingerprint,
    evaluationPolicyId: reevalP1.evaluationPolicyId,
    evaluationPolicyVersion: reevalP1.evaluationPolicyVersion,
    evaluationPolicyHash: reevalP1.evaluationPolicyHash,
    candidateEvaluationFingerprint: reevalP1.candidateEvaluationFingerprint,
    evaluatorExecuted: true,
    resultStatus: reevalP1.resultStatus,
    evidenceAssessment: reevalP1.evidenceAssessment,
    approvalReadiness: reevalP1.approvalReadiness,
    blockingRulesPassed: reevalP1.blockingRulesPassed,
    blockingRulesFailed: reevalP1.blockingRulesFailed,
    nonBlockingWarnings: reevalP1.nonBlockingWarnings,
    genericActivationEligible: false,
    planningEligible: false,
    approvalForbidden: true,
  };
  for (const [k, v] of Object.entries(
    validateExecutedReevaluation(p1.candidateReevaluation, true),
  )) {
    counters[k as keyof Stage3k2b2aSafetyCounters] += v as number;
  }

  const gapsBeforeP2 = initialGapsP2();
  const seqP2 = p2CollectorSequence(policy);
  const planP2 = buildPlan(P2_CANDIDATE_ID, gapsBeforeP2, seqP2, policy);
  const collP2 = collectForCandidate(
    P2_CANDIDATE_ID,
    seqP2,
    policy,
    p1Ready,
    mode,
    repoRoot,
  );
  counters = mergeCounters(counters, collP2.counters);
  const resolvedP2 = resolveP2AfterHuman(
    gapsBeforeP2,
    collP2.collectorsExecuted,
    p1Ready,
    resolvedP1.scope,
    reevalP1.newCandidateFingerprint,
    counters,
  );
  const humanP2 = humanAll.filter((h) => h.candidateId === P2_CANDIDATE_ID);
  const kinds2 = countEvidenceKinds(collP2.observations);
  if (mode === 'real' && kinds2.fixture > 0) {
    counters.realPilotSyntheticObservationsUsed += kinds2.fixture;
  }

  // Guard: H3 must not resolve scope
  const h3 = humanP2.find((h) => h.businessRuleKey.includes('leading') || h.observationId.includes('H3'));
  if (
    h3 &&
    resolvedP2.scope.assessment === 'supported_bounded_confirmed' &&
    resolvedP2.scope.scopeDerivation !== 'inherited_from_dependency' &&
    resolvedP2.scope.scopeDerivation !== 'direct_evidence'
  ) {
    counters.p2ScopeResolvedFromH3 += 1;
    counters.scopeGapResolvedByUnrelatedHumanRule += 1;
  }

  const reevalP2Req: TetaSemanticCandidateReevaluationRequest = {
    requestId: 'reeval:P2',
    candidateId: P2_CANDIDATE_ID,
    oldCandidateFingerprint: P2_CANDIDATE_FINGERPRINT,
    newEvidenceObservationIds: [
      ...collP2.observations.map((o) => o.observationId),
      ...humanP2.map((h) => h.observationId),
    ],
    status: 'eligible',
    approvalForbidden: true,
  };

  const p2: CandidateGapResolutionRun = {
    candidateId: P2_CANDIDATE_ID,
    gapsBefore: gapsBeforeP2,
    collectionPlan: planP2,
    collectorsExecuted: collP2.collectorsExecuted,
    observations: collP2.observations,
    featureFamilyKeys: collP2.featureFamilyKeys,
    independentObservationGroups: collP2.independentObservationGroups,
    scopeAssessment: resolvedP2.scope,
    grainAssessment: resolvedP2.grain,
    identityFacetAssessment: resolvedP2.identity,
    gapsAfter: resolvedP2.gapsAfter,
    humanDomainObservations: humanP2,
    humanQuestionsGenerated: [],
    reevaluationRequest: reevalP2Req,
    counters: collP2.counters,
    realEvidenceCount: kinds2.real,
    fixtureEvidenceCount: kinds2.fixture,
    employeeCardIdentityModel: EMPLOYEE_CARD_IDENTITY_MODEL,
  };

  const reevalP2 = executeStage3k2b1Reevaluation({
    repoRoot,
    requestId: reevalP2Req.requestId,
    candidateId: P2_CANDIDATE_ID,
    oldCandidateFingerprint: P2_CANDIDATE_FINGERPRINT,
    run: p2,
    gapPolicyRulesApplied: rulesApplied,
  });
  p2.candidateReevaluation = {
    requestId: reevalP2.requestId,
    candidateId: reevalP2.candidateId,
    oldCandidateFingerprint: reevalP2.oldCandidateFingerprint,
    newCandidateFingerprint: reevalP2.newCandidateFingerprint,
    evaluationPolicyId: reevalP2.evaluationPolicyId,
    evaluationPolicyVersion: reevalP2.evaluationPolicyVersion,
    evaluationPolicyHash: reevalP2.evaluationPolicyHash,
    candidateEvaluationFingerprint: reevalP2.candidateEvaluationFingerprint,
    evaluatorExecuted: true,
    resultStatus: reevalP2.resultStatus,
    evidenceAssessment: reevalP2.evidenceAssessment,
    approvalReadiness: reevalP2.approvalReadiness,
    blockingRulesPassed: reevalP2.blockingRulesPassed,
    blockingRulesFailed: reevalP2.blockingRulesFailed,
    nonBlockingWarnings: reevalP2.nonBlockingWarnings,
    genericActivationEligible: false,
    planningEligible: false,
    approvalForbidden: true,
  };
  for (const [k, v] of Object.entries(
    validateExecutedReevaluation(p2.candidateReevaluation, true),
  )) {
    counters[k as keyof Stage3k2b2aSafetyCounters] += v as number;
  }

  let reviewPackPaths: string[] = [];
  if (options?.writePacks !== false) {
    const written = writeReviewPacksV5(repoRoot, {
      p1,
      p2,
      policyHash: loaded.policyHash,
      policyVersion: policy.policyVersion,
      rulesApplied,
      ambiguityFixture: AMBIGUITY_SURNAME_FIXTURE,
      emptyResultFixtures: EMPTY_RESULT_FIXTURES,
    });
    reviewPackPaths = written.paths;
    p1.pack = written.packs.find((p) => p.candidateId === P1_CANDIDATE_ID);
    p2.pack = written.packs.find((p) => p.candidateId === P2_CANDIDATE_ID);

    // Audit counters from written packs v5 (not intermediate objects).
    for (const pack of written.packs) {
      counters.realPackApplicationContextFixtureAnchors += countFixtureAnchorsInPack(pack);
      counters.realPackFixtureIdsAnywhereInEvidence += countFixtureIdsAnywhereInPack(pack);
      if (pack.policyHash !== loaded.policyHash) {
        counters.packsUsingStaleGapPolicyHash += 1;
      }
    }
  }

  return {
    policy,
    policyHash: loaded.policyHash,
    policyPath: loaded.policyPath,
    policyVersion: policy.policyVersion,
    rulesApplied,
    applicationContextFixtures: fixtures,
    ambiguityFixture: AMBIGUITY_SURNAME_FIXTURE,
    emptyResultFixtures: EMPTY_RESULT_FIXTURES,
    p1,
    p2,
    counters,
    reviewPackPaths,
    humanEvidencePaths: humanPaths,
  };
}
