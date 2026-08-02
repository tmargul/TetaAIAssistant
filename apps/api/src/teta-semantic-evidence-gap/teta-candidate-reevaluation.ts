import {
  buildCandidateFingerprintPayload,
  computeCandidateEvaluationFingerprint,
  computeCandidateFingerprint,
  discoverCandidates,
  evaluateAgainstPolicy,
  loadCandidateEvaluationPolicy,
  semanticClassesFromEvidence,
  type TetaCandidateEvidenceItem,
  type TetaGenericSemanticBindingCandidate,
} from '../teta-generic-semantic-candidate';
import type {
  IdentityFacetEvidenceAssessment,
  SemanticApplicabilityEvidence,
  SemanticGrainEvidence,
  TetaHumanDomainEvidenceObservation,
  TetaSemanticEvidenceObservation,
  TetaSemanticGapResolutionResult,
} from './teta-gap.types';
import { sha256, stableStringify } from './teta-gap.types';

/** Narrow run slice — avoids circular import with pipeline. */
export type ReevaluationGapRunSlice = {
  observations: TetaSemanticEvidenceObservation[];
  humanDomainObservations: TetaHumanDomainEvidenceObservation[];
  gapsAfter: TetaSemanticGapResolutionResult[];
  grainAssessment: SemanticGrainEvidence;
  scopeAssessment: SemanticApplicabilityEvidence;
  identityFacetAssessment?: IdentityFacetEvidenceAssessment;
};

export interface CandidateReevaluationResult {
  requestId: string;
  candidateId: string;
  oldCandidateFingerprint: string;
  newCandidateFingerprint: string;
  evaluationPolicyId: string;
  evaluationPolicyVersion: string;
  evaluationPolicyHash: string;
  candidateEvaluationFingerprint: string;
  evaluatorExecuted: true;
  resultStatus: string;
  evidenceAssessment: string;
  approvalReadiness: string;
  blockingRulesPassed: string[];
  blockingRulesFailed: string[];
  nonBlockingWarnings: string[];
  genericActivationEligible: false;
  planningEligible: false;
  approvalForbidden: true;
  evaluationTraceFinalAssessment: string;
  rulesApplied: string[];
}

function targetIdFromCandidateId(candidateId: string): 'P1' | 'P2' {
  if (candidateId.includes(':P1:')) return 'P1';
  if (candidateId.includes(':P2:')) return 'P2';
  throw new Error(`unsupported_reevaluation_candidate:${candidateId}`);
}

function mapGrainStatus(
  grain: SemanticGrainEvidence,
): TetaGenericSemanticBindingCandidate['resultGrainAssessment']['status'] {
  if (grain.status === 'sufficient_for_candidate_reevaluation' || grain.status === 'resolved') {
    return 'proven';
  }
  if (grain.status === 'partial') return 'partial';
  if (grain.status === 'unresolved') return 'unresolved';
  return 'unproven';
}

function mapScopeAssessment(
  scope: SemanticApplicabilityEvidence,
): TetaGenericSemanticBindingCandidate['scopeAssessment'] {
  const assessment =
    scope.assessment === 'supported_bounded_confirmed' || scope.assessment === 'proven_exact'
      ? 'proven'
      : scope.assessment === 'partial'
        ? 'partial'
        : scope.assessment === 'conflicting'
          ? 'conflicting'
          : 'unproven';
  const supportingEvidenceRefs =
    scope.scopeDerivation === 'inherited_from_dependency'
      ? [...(scope.scopeEvidenceRefs ?? []), `inherited:${scope.scopeDependencyCandidateId}`]
      : [...(scope.featureFamilies ?? []), ...(scope.businessAreas ?? [])];
  return {
    homeScope: scope.homeScope,
    proposedScope: scope.proposedScope,
    isScopeExpansion: scope.homeScope !== scope.proposedScope,
    supportingEvidenceRefs,
    competingScopeEvidence: scope.scopeConflicts,
    assessment,
  };
}

const SUPPORT_MAP: Record<string, TetaCandidateEvidenceItem['supports'][number]> = {
  concept: 'concept',
  relation: 'relation',
  value: 'value',
  grain: 'grain',
  temporal: 'temporal',
  display: 'display',
  identity: 'identity',
  datatype: 'datatype',
  applicability: 'applicability',
  scope: 'applicability',
  path: 'relation',
  dependency: 'relation',
};

function mapSupports(supports: string[]): TetaCandidateEvidenceItem['supports'] {
  const out: TetaCandidateEvidenceItem['supports'] = [];
  for (const s of supports) {
    const m = SUPPORT_MAP[s];
    if (m && !out.includes(m)) out.push(m);
  }
  return out.length ? out : ['concept'];
}

function observationToEvidenceItem(
  o: TetaSemanticEvidenceObservation,
  graphSourceHash: string,
): TetaCandidateEvidenceItem {
  const family: TetaCandidateEvidenceItem['family'] =
    o.factKind === 'cardinality_fact'
      ? 'oracle_metadata_ddl'
      : o.collectorType === 'help_semantic_label_collector'
        ? 'help_semantic_mapping'
        : o.collectorType === 'gateway_lineage_collector'
          ? 'dataset_gateway_join'
          : 'application_form_control';
  return {
    evidenceId: o.observationId,
    family,
    originObservationId: o.observationId,
    lineageKey: o.lineageKey,
    strength: o.strength as TetaCandidateEvidenceItem['strength'],
    supports: mapSupports(o.supports),
    sourceStage: 'stage3k2b2a_gap_resolution',
    graphSourceHash,
  };
}

function humanToEvidenceItem(
  h: TetaHumanDomainEvidenceObservation,
  graphSourceHash: string,
): TetaCandidateEvidenceItem {
  return {
    evidenceId: h.observationId,
    family: 'help_semantic_mapping',
    originObservationId: h.observationId,
    lineageKey: `human:${h.businessRuleKey}`,
    strength: 'supported_by_single_authoritative_mapping',
    supports: ['concept'],
    sourceStage: 'stage3k2b2a_human_domain',
    graphSourceHash,
  };
}

function knownGapsFromRun(run: ReevaluationGapRunSlice): string[] {
  const gaps: string[] = [];
  for (const g of run.gapsAfter) {
    if (g.blockingStillOpen) {
      gaps.push(`open:${g.gapId}`);
    }
  }
  if (
    run.grainAssessment.status !== 'sufficient_for_candidate_reevaluation' &&
    run.grainAssessment.status !== 'resolved'
  ) {
    if (!gaps.some((x) => x.includes('grain'))) {
      gaps.push('employee_grain_not_fully_proven');
    }
  }
  return gaps;
}

/**
 * Invokes the production Stage 3K.2B1 offline evaluator (`evaluateAgainstPolicy`)
 * on a candidate enriched with gap-resolution + human evidence. Does not approve.
 */
export function executeStage3k2b1Reevaluation(input: {
  repoRoot: string;
  requestId: string;
  candidateId: string;
  oldCandidateFingerprint: string;
  run: ReevaluationGapRunSlice;
  gapPolicyRulesApplied: string[];
}): CandidateReevaluationResult {
  const targetId = targetIdFromCandidateId(input.candidateId);
  const discovery = discoverCandidates({
    repoRoot: input.repoRoot,
    targetIds: [targetId],
  });
  const base = discovery.candidates[0];
  if (!base) {
    throw new Error(`reevaluation_missing_base_candidate:${input.candidateId}`);
  }

  const loadedPolicy = loadCandidateEvaluationPolicy(input.repoRoot);
  const policy = loadedPolicy.policy;
  const policyHash = loadedPolicy.policyHash;

  const newObsEvidence = input.run.observations.map((o) =>
    observationToEvidenceItem(o, base.graphSourceHash),
  );
  const humanEvidence = input.run.humanDomainObservations.map((h) =>
    humanToEvidenceItem(h, base.graphSourceHash),
  );

  const underlyingEvidenceRefs = [
    ...base.underlyingEvidenceRefs,
    ...newObsEvidence,
    ...humanEvidence,
  ];

  const knownGaps = knownGapsFromRun(input.run);
  const resultGrainAssessment = {
    proposedGrain: base.resultGrain,
    uniquenessEvidence: input.run.grainAssessment.uniquenessEvidence,
    cardinalityEvidence: [input.run.grainAssessment.relationCardinality],
    multiRowRisk: input.run.grainAssessment.duplicateRowRisk,
    status: mapGrainStatus(input.run.grainAssessment),
  };
  const scopeAssessment = mapScopeAssessment(input.run.scopeAssessment);

  const requiredBindingDependencies = base.requiredBindingDependencies.map((d) => {
    if (targetId === 'P2' && d.roleKey.includes('employee')) {
      const ready = !input.run.gapsAfter.some((g) => g.blockingStillOpen);
      return {
        ...d,
        status: ready ? ('satisfied' as const) : ('pending' as const),
      };
    }
    return d;
  });

  const semanticClasses = semanticClassesFromEvidence(underlyingEvidenceRefs);
  const ddlOnlyForIdentity =
    base.riskClass === 'identity_sensitive' &&
    !base.identitySemantics?.exactSemanticLabelEvidence &&
    underlyingEvidenceRefs.every((e) => e.family === 'oracle_metadata_ddl');

  const threshold = evaluateAgainstPolicy({
    riskClass: base.riskClass,
    evidenceStrength: base.evidenceStrength,
    independentObservationGroups:
      base.lineageAssessment.independentObservationGroups +
      new Set([...newObsEvidence, ...humanEvidence].map((e) => e.lineageKey)).size,
    semanticEvidenceClassesPresent: semanticClasses,
    conflicts: base.conflicts,
    ambiguities: base.ambiguities,
    knownGaps,
    graphHashMismatch: false,
    inferredOnly: false,
    heuristicOnly: false,
    scopeAssessment,
    resultGrainAssessment,
    identityFacetSeparated: base.identitySemantics?.facet === 'employee_number',
    exactIdentitySemanticEvidence: Boolean(
      base.identitySemantics?.exactSemanticLabelEvidence ||
        input.run.identityFacetAssessment?.semanticLabelEvidence,
    ),
    ddlOnlyForIdentity,
    employeeGrainEvidencePresent:
      targetId === 'P1' ? resultGrainAssessment.status !== 'unproven' : true,
    employeeGrainDependencySatisfied: requiredBindingDependencies
      .filter((d) => d.requiredFor === 'semantic_validity')
      .every((d) => d.status === 'satisfied'),
    displayLinkedToPositionIdentity: Boolean(base.displaySemantics?.lookupProven),
    requiredBindingDependencies,
    policy,
    policyHash,
  });

  const withAssessment: TetaGenericSemanticBindingCandidate = {
    ...base,
    underlyingEvidenceRefs,
    knownGaps,
    scopeAssessment,
    resultGrainAssessment,
    requiredBindingDependencies,
    candidateEvidenceAssessment: threshold.candidateEvidenceAssessment,
    evidenceAssessment: threshold.evidenceAssessment,
    candidateStatus: threshold.candidateStatus,
    readyForHumanReview: threshold.readyForHumanReview,
    approvalReadiness: threshold.approvalReadiness,
    evaluationTrace: threshold.evaluationTrace,
    evaluationPolicyId: policy.policyId,
    evaluationPolicyHash: policyHash,
    genericReuseActivationBlocked: true,
    genericReuseActivationBlockReasons: [
      ...threshold.genericReuseActivationBlockReasons,
      'stage3k2b2a_approval_forbidden',
    ],
    candidateEvaluationPolicyVersion: policy.policyVersion,
    // fingerprints filled below
    candidateFingerprint: base.candidateFingerprint,
    candidateEvaluationFingerprint: base.candidateEvaluationFingerprint,
  };

  // Include gap/human observation ids in fingerprint substance via evidence + gaps
  const fpPayload = buildCandidateFingerprintPayload({
    ...withAssessment,
    dependencyVector: {
      ...withAssessment.dependencyVector,
      // encode gap-resolution human+obs into vector via stable extra hash channel
      stage3k2b1ContractVersion: `${withAssessment.dependencyVector.stage3k2b1ContractVersion}+gap:${sha256(
        stableStringify({
          obs: input.run.observations.map((o) => o.observationId).sort(),
          human: input.run.humanDomainObservations.map((h) => h.observationId).sort(),
          grain: input.run.grainAssessment.status,
          scope: input.run.scopeAssessment.assessment,
          scopeDerivation: input.run.scopeAssessment.scopeDerivation ?? null,
        }),
      ).slice(0, 16)}`,
    },
  });
  const newCandidateFingerprint = computeCandidateFingerprint(fpPayload);
  const candidateEvaluationFingerprint = computeCandidateEvaluationFingerprint({
    candidateFingerprint: newCandidateFingerprint,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    policyContentHash: policyHash,
  });

  const rules = threshold.evaluationTrace.rulesEvaluated ?? [];
  const blockingRulesPassed = rules.filter((r) => r.blocking && r.passed).map((r) => r.ruleId);
  const blockingRulesFailed = rules.filter((r) => r.blocking && !r.passed).map((r) => r.ruleId);
  const nonBlockingWarnings = rules.filter((r) => !r.blocking && !r.passed).map((r) => r.ruleId);

  return {
    requestId: input.requestId,
    candidateId: input.candidateId,
    oldCandidateFingerprint: input.oldCandidateFingerprint,
    newCandidateFingerprint,
    evaluationPolicyId: policy.policyId,
    evaluationPolicyVersion: policy.policyVersion,
    evaluationPolicyHash: policyHash,
    candidateEvaluationFingerprint,
    evaluatorExecuted: true,
    resultStatus: threshold.candidateStatus,
    evidenceAssessment: threshold.evidenceAssessment,
    approvalReadiness: threshold.approvalReadiness,
    blockingRulesPassed,
    blockingRulesFailed,
    nonBlockingWarnings,
    genericActivationEligible: false,
    planningEligible: false,
    approvalForbidden: true,
    evaluationTraceFinalAssessment: threshold.evaluationTrace.finalAssessment,
    rulesApplied: input.gapPolicyRulesApplied,
  };
}

export function validateExecutedReevaluation(
  r:
    | Pick<
        CandidateReevaluationResult,
        | 'evaluatorExecuted'
        | 'newCandidateFingerprint'
        | 'candidateEvaluationFingerprint'
        | 'evaluationPolicyId'
        | 'evaluationPolicyVersion'
        | 'evaluationPolicyHash'
        | 'evidenceAssessment'
        | 'approvalReadiness'
      >
    | { evaluationTraceFinalAssessment?: string }
    | undefined,
  wasEligible: boolean,
): Partial<Record<string, number>> {
  const delta: Record<string, number> = {};
  if (wasEligible && (!r || !('evaluatorExecuted' in r) || !r.evaluatorExecuted)) {
    delta.candidateReevaluationEligibleButNotExecuted = 1;
  }
  if (r && 'evaluatorExecuted' in r && r.evaluatorExecuted) {
    if (!r.newCandidateFingerprint) delta.executedReevaluationsMissingCandidateFingerprint = 1;
    if (!r.candidateEvaluationFingerprint) {
      delta.executedReevaluationsMissingEvaluationFingerprint = 1;
    }
    if (!r.evaluationPolicyId || !r.evaluationPolicyVersion || !r.evaluationPolicyHash) {
      delta.executedReevaluationsMissingPolicyTrace = 1;
    }
    const finalOk =
      Boolean(r.evidenceAssessment) &&
      Boolean(r.approvalReadiness) &&
      ('evaluationTraceFinalAssessment' in r
        ? Boolean(r.evaluationTraceFinalAssessment)
        : true);
    if (!finalOk) {
      delta.executedReevaluationsMissingFinalAssessment = 1;
    }
  }
  return delta;
}
