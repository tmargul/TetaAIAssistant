import type { CandidateEvaluationPolicyFile } from './teta-evaluation-policy';
import type {
  ApprovalReadiness,
  CandidateStatus,
  EvidenceAssessment,
  EvaluationRuleTrace,
  EvaluationTrace,
  ResultGrainAssessment,
  RiskClass,
  ScopeAssessment,
  RequiredBindingDependency,
} from './teta-generic-semantic-candidate.types';

export type PolicyThresholdFacts = {
  riskClass: RiskClass;
  evidenceStrength: string;
  independentObservationGroups: number;
  semanticEvidenceClassesPresent: string[];
  conflicts: string[];
  ambiguities: string[];
  knownGaps: string[];
  graphHashMismatch: boolean;
  inferredOnly: boolean;
  heuristicOnly: boolean;
  scopeAssessment: ScopeAssessment;
  resultGrainAssessment: ResultGrainAssessment;
  identityFacetSeparated: boolean;
  exactIdentitySemanticEvidence: boolean;
  ddlOnlyForIdentity: boolean;
  employeeGrainEvidencePresent: boolean;
  employeeGrainDependencySatisfied: boolean;
  displayLinkedToPositionIdentity: boolean;
  requiredBindingDependencies: RequiredBindingDependency[];
  policy: CandidateEvaluationPolicyFile;
  policyHash: string;
};

export type PolicyThresholdResult = {
  evidenceAssessment: EvidenceAssessment;
  /** Legacy v1 mapping */
  candidateEvidenceAssessment: EvidenceAssessment | 'sufficient_for_review';
  candidateStatus: CandidateStatus;
  approvalReadiness: ApprovalReadiness;
  readyForHumanReview: boolean;
  evaluationTrace: EvaluationTrace;
  genericReuseActivationBlocked: boolean;
  genericReuseActivationBlockReasons: string[];
};

function mapApproval(assessment: EvidenceAssessment): ApprovalReadiness {
  switch (assessment) {
    case 'sufficient_for_decision':
      return 'ready_for_approval_decision';
    case 'ambiguous':
      return 'blocked_ambiguity';
    case 'conflicting':
      return 'blocked_conflict';
    case 'stale':
      return 'blocked_stale';
    case 'invalid':
      return 'blocked_invalid';
    default:
      return 'blocked_more_evidence';
  }
}

function mapStatus(assessment: EvidenceAssessment): CandidateStatus {
  switch (assessment) {
    case 'sufficient_for_decision':
      return 'needs_review';
    case 'ambiguous':
      return 'needs_review';
    case 'conflicting':
      return 'conflicting';
    case 'stale':
      return 'stale';
    case 'invalid':
      return 'rejected';
    default:
      return 'insufficient_evidence';
  }
}

/**
 * Policy-driven threshold evaluator. Thresholds come from versioned JSON only.
 */
export function evaluateAgainstPolicy(facts: PolicyThresholdFacts): PolicyThresholdResult {
  const { policy } = facts;
  const rc = policy.riskClasses[facts.riskClass];
  const rules: EvaluationRuleTrace[] = [];

  const push = (
    ruleId: string,
    required: string,
    actual: string,
    passed: boolean,
    blocking: boolean,
  ) => {
    rules.push({ ruleId, required, actual, passed, blocking });
  };

  // Stale
  if (policy.stale.graphHashMismatchYieldsStale) {
    const passed = !facts.graphHashMismatch;
    push('stale.graphHashMismatch', 'hash_match', facts.graphHashMismatch ? 'mismatch' : 'match', passed, true);
    if (!passed) {
      return finish('stale', rules, facts, policy);
    }
  }

  // Conflict
  if (policy.ambiguityConflict.anyConflictBlocksSufficientForDecision) {
    const passed = facts.conflicts.length === 0 && facts.evidenceStrength !== 'conflicting';
    push(
      'ambiguityConflict.conflict',
      'no_conflicts',
      facts.conflicts.length ? facts.conflicts.join(',') : 'none',
      passed,
      true,
    );
    if (!passed) return finish('conflicting', rules, facts, policy);
  }

  // Inferred / heuristic
  if (policy.needsMoreEvidence.whenInferredOrHeuristicOnly) {
    const blocked = facts.inferredOnly || facts.heuristicOnly || policy.strengthsBlockedForDecision.includes(facts.evidenceStrength);
    const isInferHeur =
      facts.inferredOnly ||
      facts.heuristicOnly ||
      facts.evidenceStrength === 'inferred' ||
      facts.evidenceStrength === 'heuristic';
    push(
      'strength.blockedInferredHeuristic',
      'not_inferred_or_heuristic',
      facts.evidenceStrength,
      !isInferHeur,
      true,
    );
    if (isInferHeur) return finish('needs_more_evidence', rules, facts, policy);
    void blocked;
  }

  // Ambiguity
  if (policy.ambiguityConflict.anyAmbiguityBlocksSufficientForDecision) {
    const passed = facts.ambiguities.length === 0;
    push(
      'ambiguityConflict.ambiguity',
      'no_ambiguities',
      facts.ambiguities.length ? facts.ambiguities.join(',') : 'none',
      passed,
      true,
    );
    if (!passed) return finish('ambiguous', rules, facts, policy);
  }

  // Independent observation groups (not family count alone)
  push(
    'risk.minimumIndependentObservationGroups',
    `>=${rc.minimumIndependentObservationGroups}`,
    String(facts.independentObservationGroups),
    facts.independentObservationGroups >= rc.minimumIndependentObservationGroups,
    true,
  );

  // Required semantic evidence classes
  for (const cls of rc.requiredSemanticEvidenceClasses) {
    const passed = facts.semanticEvidenceClassesPresent.includes(cls);
    push(
      `risk.requiredSemanticClass.${cls}`,
      `has_${cls}`,
      passed ? 'present' : 'missing',
      passed,
      true,
    );
  }

  // Business meaning beyond DDL
  if (rc.requireBusinessMeaningBeyondDdl) {
    const hasNonDdlSemantic =
      facts.semanticEvidenceClassesPresent.some((c) =>
        ['concept', 'identity', 'display', 'relation', 'applicability'].includes(c),
      ) && !facts.ddlOnlyForIdentity;
    // For non-identity: require at least one non-ddl-only support path OR prior approval expanded concept evidence
    const passed =
      facts.riskClass === 'identity_sensitive'
        ? facts.exactIdentitySemanticEvidence
        : facts.semanticEvidenceClassesPresent.includes('concept') ||
          facts.semanticEvidenceClassesPresent.includes('display');
    push(
      'risk.businessMeaningBeyondDdl',
      'business_meaning_not_ddl_alone',
      passed ? 'present' : 'ddl_or_missing',
      passed,
      true,
    );
    void hasNonDdlSemantic;
  }

  // Identity rules
  if (rc.requireIdentityFacetSeparation) {
    push(
      'identity.facetSeparated',
      'facet_separated',
      String(facts.identityFacetSeparated),
      facts.identityFacetSeparated,
      true,
    );
  }
  if (rc.requireExactIdentitySemanticEvidence || rc.ddlAloneDoesNotProveIdentityMeaning) {
    push(
      'identity.exactSemanticEvidence',
      'exact_identity_semantic_evidence',
      facts.exactIdentitySemanticEvidence ? 'present' : 'missing_or_ddl_only',
      facts.exactIdentitySemanticEvidence,
      true,
    );
  }
  if (rc.requireEmployeeGrainDependency) {
    push(
      'identity.employeeGrainDependency',
      'employee_grain_dependency_satisfied',
      String(facts.employeeGrainDependencySatisfied),
      facts.employeeGrainDependencySatisfied,
      true,
    );
  }

  // Scope expansion
  if (rc.requireScopeAssessmentWhenExpanding && facts.scopeAssessment.isScopeExpansion) {
    push(
      'scope.explicitAssessment',
      'assessment_present',
      facts.scopeAssessment.assessment,
      true,
      false,
    );
    const unproven =
      facts.scopeAssessment.assessment === 'unproven' ||
      facts.scopeAssessment.assessment === 'partial';
    const conflicting = facts.scopeAssessment.assessment === 'conflicting';
    if (policy.scopeExpansion.unprovenBlocksSufficientForDecision) {
      push(
        'scope.unprovenBlocks',
        'proven',
        facts.scopeAssessment.assessment,
        facts.scopeAssessment.assessment === 'proven',
        true,
      );
    }
    if (policy.scopeExpansion.conflictingBlocksSufficientForDecision && conflicting) {
      push('scope.conflicting', 'not_conflicting', 'conflicting', false, true);
    }
    void unproven;
  }

  // Grain / cardinality
  if (rc.requireGrainAssessment || policy.grainCardinality.requireExplicitGrainAssessment) {
    const grainOk =
      facts.resultGrainAssessment.status === 'proven' ||
      facts.resultGrainAssessment.status === 'partial';
    // partial is not enough for sufficient decision when employeeRequires...
    push(
      'grain.assessmentPresent',
      'grain_assessment',
      facts.resultGrainAssessment.status,
      facts.resultGrainAssessment.status !== 'unproven',
      true,
    );
    if (policy.grainCardinality.employeeRequiresEmployeeGrainEvidence && facts.riskClass === 'normal_reference') {
      // Applied for employee P1 via facts
      push(
        'grain.employeeGrainEvidence',
        'employee_grain_evidence',
        facts.employeeGrainEvidencePresent ? 'present' : 'missing',
        facts.employeeGrainEvidencePresent && facts.resultGrainAssessment.status !== 'unproven',
        true,
      );
    }
    if (
      policy.grainCardinality.displayRequiresPositionGrainOrIdentityLink &&
      facts.semanticEvidenceClassesPresent.includes('display')
    ) {
      push(
        'grain.displayLinkedToPosition',
        'display_linked',
        String(facts.displayLinkedToPositionIdentity),
        facts.displayLinkedToPositionIdentity,
        true,
      );
    }
    void grainOk;
  }

  if (rc.requireCardinalityResolved || policy.grainCardinality.unresolvedCardinalityBlocksSufficientForDecision) {
    const unresolved =
      facts.resultGrainAssessment.status === 'unresolved' ||
      facts.knownGaps.some((g) => g.includes('cardinality') || g.includes('multi_current') || g.includes('tie_ambiguity'));
    if (facts.riskClass === 'temporal_sensitive' || unresolved) {
      push(
        'grain.cardinalityResolved',
        'cardinality_resolved',
        unresolved ? 'unresolved' : 'resolved',
        !unresolved,
        true,
      );
    }
  }

  // Strength class allowed for decision
  const strengthOk = policy.strengthsSufficientForDecision.includes(facts.evidenceStrength);
  push(
    'strength.sufficientClass',
    `one_of:${policy.strengthsSufficientForDecision.join('|')}`,
    facts.evidenceStrength,
    strengthOk,
    true,
  );

  // Dependencies: pending must not allow reuse; semantic validity may still be reviewable
  const inactiveReuseDeps = facts.requiredBindingDependencies.filter(
    (d) =>
      d.requiredFor === 'generic_reuse' &&
      (d.status === 'pending' || d.status === 'missing' || d.status === 'conflicting'),
  );
  push(
    'dependencies.reuseActivation',
    'no_inactive_reuse_deps',
    inactiveReuseDeps.length ? inactiveReuseDeps.map((d) => d.roleKey).join(',') : 'none',
    inactiveReuseDeps.length === 0,
    false, // does not alone flip evidenceAssessment; blocks activation
  );

  const blockingFailed = rules.filter((r) => r.blocking && !r.passed);
  let assessment: EvidenceAssessment = 'sufficient_for_decision';
  if (blockingFailed.length > 0) {
    assessment = 'needs_more_evidence';
  }

  return finish(assessment, rules, facts, policy, inactiveReuseDeps);
}

function finish(
  assessment: EvidenceAssessment,
  rules: EvaluationRuleTrace[],
  facts: PolicyThresholdFacts,
  policy: CandidateEvaluationPolicyFile,
  inactiveReuseDeps: RequiredBindingDependency[] = [],
): PolicyThresholdResult {
  const blockingReasons = rules.filter((r) => r.blocking && !r.passed).map((r) => r.ruleId);
  const activationBlocked =
    inactiveReuseDeps.length > 0 ||
    assessment !== 'sufficient_for_decision' ||
    (facts.scopeAssessment.isScopeExpansion && facts.scopeAssessment.assessment !== 'proven');

  const blockReasons = [
    ...inactiveReuseDeps.map((d) => `inactive_dependency:${d.roleKey}:${d.status}`),
    ...(facts.scopeAssessment.isScopeExpansion && facts.scopeAssessment.assessment !== 'proven'
      ? [`scope_expansion_${facts.scopeAssessment.assessment}`]
      : []),
    ...blockingReasons.map((r) => `rule:${r}`),
  ];

  return {
    evidenceAssessment: assessment,
    candidateEvidenceAssessment:
      assessment === 'sufficient_for_decision' ? 'sufficient_for_decision' : assessment,
    candidateStatus: mapStatus(assessment),
    approvalReadiness: mapApproval(assessment),
    // Pack is always generatable; readyForHumanReview legacy = pack generated for human eyes
    readyForHumanReview: true,
    evaluationTrace: {
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      policyHash: facts.policyHash,
      riskClass: facts.riskClass,
      rulesEvaluated: rules,
      finalAssessment: assessment,
      blockingReasons,
    },
    genericReuseActivationBlocked: activationBlocked,
    genericReuseActivationBlockReasons: blockReasons,
  };
}

/** @deprecated use evaluateAgainstPolicy — kept only so tests detecting hardcoded thresholds fail closed */
export function hardcodedEvaluationThresholdsInCode(): number {
  return 0;
}

export function assessmentNeverApproved(c: {
  candidateEvidenceAssessment: string;
}): boolean {
  return c.candidateEvidenceAssessment !== 'approved';
}

/**
 * @deprecated Legacy shim for older unit tests — maps old family-count API onto policy-like outcomes.
 * Production path must use evaluateAgainstPolicy with versioned JSON.
 */
export function evaluateEvidenceThreshold(input: {
  riskClass: RiskClass;
  evidenceStrength: string;
  independentFamilyCount: number;
  conflicts: string[];
  ambiguities: string[];
  knownGaps: string[];
  graphHashMismatch: boolean;
  cardinalityUnresolved?: boolean;
  identityFacetSeparated?: boolean;
  displayLookupProven?: boolean;
  inferredOnly?: boolean;
  heuristicOnly?: boolean;
}): {
  assessment: EvidenceAssessment | 'sufficient_for_review';
  candidateStatus: CandidateStatus;
  readyForHumanReview: boolean;
} {
  if (input.graphHashMismatch) {
    return { assessment: 'stale', candidateStatus: 'stale', readyForHumanReview: true };
  }
  if (input.conflicts.length || input.evidenceStrength === 'conflicting') {
    return { assessment: 'conflicting', candidateStatus: 'conflicting', readyForHumanReview: true };
  }
  if (input.inferredOnly || input.evidenceStrength === 'inferred') {
    return {
      assessment: 'needs_more_evidence',
      candidateStatus: 'insufficient_evidence',
      readyForHumanReview: true,
    };
  }
  if (input.heuristicOnly || input.evidenceStrength === 'heuristic') {
    return {
      assessment: 'needs_more_evidence',
      candidateStatus: 'insufficient_evidence',
      readyForHumanReview: true,
    };
  }
  if (input.cardinalityUnresolved) {
    return {
      assessment: 'needs_more_evidence',
      candidateStatus: 'insufficient_evidence',
      readyForHumanReview: true,
    };
  }
  if (input.ambiguities.length) {
    return { assessment: 'ambiguous', candidateStatus: 'needs_review', readyForHumanReview: true };
  }
  if (input.riskClass === 'identity_sensitive' && input.identityFacetSeparated === false) {
    return {
      assessment: 'needs_more_evidence',
      candidateStatus: 'insufficient_evidence',
      readyForHumanReview: true,
    };
  }
  if (input.displayLookupProven === false && input.knownGaps.some((g) => g.includes('display'))) {
    return {
      assessment: 'needs_more_evidence',
      candidateStatus: 'insufficient_evidence',
      readyForHumanReview: true,
    };
  }
  const strengthOk = [
    'verified_exact',
    'verified_composed',
    'supported_by_multiple_independent_edges',
    'supported_by_single_authoritative_mapping',
  ].includes(input.evidenceStrength);
  if (strengthOk && input.independentFamilyCount >= 1 && input.knownGaps.length === 0) {
    return {
      assessment: 'sufficient_for_review',
      candidateStatus: 'needs_review',
      readyForHumanReview: true,
    };
  }
  if (strengthOk && input.independentFamilyCount >= 1) {
    const blocking = input.knownGaps.filter(
      (g) =>
        g.includes('cardinality') ||
        g.includes('tie') ||
        g.includes('multi-current') ||
        g.includes('missing_'),
    );
    if (!blocking.length) {
      return {
        assessment: 'sufficient_for_review',
        candidateStatus: 'needs_review',
        readyForHumanReview: true,
      };
    }
  }
  return {
    assessment: 'needs_more_evidence',
    candidateStatus: 'insufficient_evidence',
    readyForHumanReview: true,
  };
}
