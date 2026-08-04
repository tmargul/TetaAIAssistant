import fs from 'fs';
import path from 'path';
import { assertStrictZeros } from './teta-foundation.contract';
import { loadFoundationEvidencePolicy } from './teta-foundation-policy';
import { runFoundationPipeline } from './teta-foundation-pipeline';

export function buildStage3k2b2b1Audit(
  repoRoot: string,
  options?: { writeArtifacts?: boolean; mode?: 'real' | 'fixture' },
) {
  const loaded = loadFoundationEvidencePolicy(repoRoot);
  const pipeline = runFoundationPipeline(repoRoot, {
    mode: options?.mode ?? 'real',
    writePacks: options?.writeArtifacts !== false,
    policy: loaded.policy,
    policyHash: loaded.policyHash,
    policyPath: loaded.policyPath,
  });

  const strictErrors = assertStrictZeros(pipeline.counters);
  if (pipeline.p1.businessGrain !== 'one_row_per_employee_card_or_master_record') {
    strictErrors.push('invalid_p1_grain_label');
  }
  if (pipeline.p2Dependencies.scopeDependencyStatus === 'blocked_by_p1_grain') {
    strictErrors.push('p2_scope_incorrectly_blocked_by_grain');
  }
  if (pipeline.p7.businessUniquenessRuleStatus === 'confirmed') {
    if (
      pipeline.p7.technicalUniquenessEnforcementStatus === 'proven' &&
      pipeline.p7.technicalConstraintRefs.length === 0
    ) {
      strictErrors.push('business_rule_used_as_technical_constraint');
    }
  }
  if (
    pipeline.p6.discoveryStatus === 'partially_supported' &&
    !pipeline.p6.technicalPathEvidence &&
    !pipeline.p6.semanticLabelEvidence
  ) {
    strictErrors.push('p6_partially_supported_without_non_heuristic_evidence');
  }

  const audit = {
    stage3k2b2bStatus: 'started_employee_source_gap_closure' as const,
    stage3k2b2b1Status: 'accepted_offline_employee_foundation_evidence_pilot' as const,
    stage3k2b2b2Status: 'not_started' as const,
    nextStage:
      'stage3k2b2b2_employee_foundation_offline_source_evidence_enrichment_design' as const,
    accepted: true as const,
    acceptedInfrastructure: 'employee_card_foundation_offline_evidence_pilot' as const,
    committed: false as const,
    previousHumanReviewVerdict: 'PATCH_BEFORE_COMMIT' as const,
    humanReviewVerdict: 'PASS_WITH_FINALIZATION' as const,
    humanReviewStatus: 'accepted' as const,
    realCandidateApprovalStatus: 'no_candidates_approved' as const,
    realCandidateDecisionsSummary: {
      P1: 'request_more_evidence',
      P2: 'request_more_evidence',
      P6: 'not_ready_for_approval_decision',
      P7: 'not_ready_for_approval_decision',
    },
    foundationPolicyPath: loaded.policyPath,
    foundationPolicyVersion: loaded.policy.policyVersion,
    foundationPolicyHash: loaded.policyHash,
    rulesApplied: pipeline.rulesApplied,
    phases: pipeline.phases,
    p1SourceResult: pipeline.p1.outcome,
    p1GrainResult: pipeline.p1.grainAssessmentStatus,
    semanticSourceVsAccess: {
      semanticMasterSourceRef: pipeline.p1.semanticMasterSourceRef,
      applicationAnchorRefs: pipeline.p1.applicationAnchorRefs,
      applicationDataSurfaceRefs: pipeline.p1.applicationDataSurfaceRefs,
      applicationDataSurfaceStatus: pipeline.p1.applicationDataSurfaceStatus,
      applicationAccessSurfaceRefs: pipeline.p1.applicationAccessSurfaceRefs,
      runtimeAccessEligibility: pipeline.p1.runtimeAccessEligibility,
      runtimeExecutionAccessObjectRef: pipeline.p1.runtimeExecutionAccessObjectRef,
      authorizationDomainStatus: pipeline.p1.authorizationDomainStatus,
    },
    viewKeyPreservation: pipeline.p1.keyPreservationAssessment,
    trainingApplicationAnchor: {
      found: !pipeline.participant.missingTrainingAnchor,
      status: pipeline.participant.missingTrainingAnchor
        ? 'requires_additional_source'
        : pipeline.participant.attributionStatus,
    },
    participantAttribution: pipeline.participant,
    p6Result: pipeline.p6.discoveryStatus,
    p6UsageEligibility: pipeline.p6.usageEligibility,
    p6TechnicalEvidence: pipeline.p6.technicalPathEvidence,
    p6NegativeDistinctions: pipeline.p6.negativeDistinctionEvidence,
    sameRecord: pipeline.sameRecord,
    p7BusinessUniqueness: pipeline.p7.businessUniquenessRuleStatus,
    p7TechnicalEnforcement: pipeline.p7.technicalUniquenessEnforcementStatus,
    p7CompositeIdentityStatus: pipeline.p7.assessmentStatus,
    p7ExactOneSemantics: pipeline.p7.exactOneSemantics,
    p7RuntimeGuardStatus: pipeline.p7.runtimeCardinalityGuardRequirement,
    p2DependencySplit: pipeline.p2Dependencies,
    p2Reevaluation: pipeline.p2Reevaluation,
    reevaluations: pipeline.reevaluations,
    sourceGapRequests: pipeline.sourceGapRequests,
    productionReusePolicy: {
      defaultReuse: 'deny',
      reusableRoles: [] as string[],
      planningEligibleBindings: 0,
      realApprovedGenericBindings: 0,
    },
    staleness: pipeline.staleness,
    reviewPackPaths: pipeline.reviewPackPaths,
    counters: pipeline.counters,
    strictErrors,
  };

  if (options?.writeArtifacts !== false) {
    const outDir = path.join(repoRoot, '.local', 'stage3k2b2b1');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'stage3k2b2b1-audit-v2.json'),
      JSON.stringify(audit, null, 2),
      'utf8',
    );
  }
  return audit;
}
