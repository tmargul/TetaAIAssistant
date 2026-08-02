import fs from 'fs';
import path from 'path';
import { assertStrictZeros, buildApplicationContextFixtures } from './teta-gap.contract';
import { runStage3k2b2aPipeline } from './teta-gap-pipeline';
import { loadGapResolutionPolicy } from './teta-gap-policy';
import type { Stage3k2b2aSafetyCounters } from './teta-gap.types';

export type Stage3k2b2aFinalStatus =
  'accepted_offline_bounded_gap_resolution_and_reevaluation';

export interface Stage3k2b2aAuditV5 {
  stage3k2b2Status: 'started_bounded_gap_resolution';
  stage3k2b2aStatus: Stage3k2b2aFinalStatus;
  stage3k2b2bStatus: 'not_started';
  nextStage: 'stage3k2b2b_employee_card_foundation_gap_closure_design';
  previousHumanReviewVerdict: 'PATCH_BEFORE_COMMIT';
  humanReviewVerdict: 'PASS_WITH_FINALIZATION';
  humanReviewStatus: 'accepted';
  acceptedInfrastructure: 'bounded_semantic_evidence_gap_resolution_and_reevaluation';
  realCandidateApprovalStatus: 'no_candidates_approved';
  realCandidateDecisions: {
    P1: 'request_more_evidence';
    P2: 'request_more_evidence';
  };
  accepted: true;
  committed: boolean;
  policyPath: string;
  policyVersion: string;
  policyHash: string;
  rulesApplied: string[];
  p1RealEvidenceCount: number;
  p1FixtureEvidenceCount: number;
  p2RealEvidenceCount: number;
  p2FixtureEvidenceCount: number;
  p1HumanRules: string[];
  trainingParticipantClassification: unknown;
  technicalEmployeeDependency: unknown;
  dependencyEvidenceKind: unknown;
  p1ScopeResult: string;
  p1GrainResult: string;
  p1GrainKeyPreservation: string | null;
  p1GrainPolicyTrace: string[];
  p1Reevaluation: unknown;
  p2ScopeDerivation: unknown;
  p2Reevaluation: unknown;
  p2EmployeeNumberResult: string;
  compositeIdentityResult: string;
  leadingZeroResult: string;
  reemploymentRule: string;
  p2ExactOneGuaranteed: boolean;
  p2DependencyReevaluation: boolean;
  p2DependencyActivation: boolean;
  ambiguityFixture: unknown;
  emptyResultFixtures: unknown;
  humanQuestionsGenerated: unknown[];
  reviewPackPaths: string[];
  applicationContextFixturesSeparated: true;
  counters: Stage3k2b2aSafetyCounters;
  strictErrors: string[];
}

export function buildStage3k2b2aAudit(
  repoRoot: string,
  options?: { writeArtifacts?: boolean; mode?: 'real' | 'fixture'; committed?: boolean },
): Stage3k2b2aAuditV5 {
  const pipeline = runStage3k2b2aPipeline(repoRoot, {
    writePacks: options?.writeArtifacts !== false,
    mode: options?.mode ?? 'real',
  });
  const loaded = loadGapResolutionPolicy(repoRoot);
  void buildApplicationContextFixtures();

  const tp = pipeline.p1.employeeRootAssessment?.personRootScan?.find(
    (p) => p.roleKey === 'training_participant',
  );

  const counters = pipeline.counters;
  const strictErrors = assertStrictZeros(counters);

  if (pipeline.p1.fixtureEvidenceCount > 0 && (options?.mode ?? 'real') === 'real') {
    strictErrors.push('real_p1_contains_fixture_evidence');
  }
  if (pipeline.p2.fixtureEvidenceCount > 0 && (options?.mode ?? 'real') === 'real') {
    strictErrors.push('real_p2_contains_fixture_evidence');
  }

  const grainGap = pipeline.p1.gapsAfter.find((g) => g.gapId === 'gap:P1:grain');
  if (
    grainGap?.status === 'resolved_pending_re_evaluation' &&
    pipeline.p1.grainAssessment.status !== 'sufficient_for_candidate_reevaluation' &&
    pipeline.p1.grainAssessment.status !== 'resolved'
  ) {
    strictErrors.push('grain_resolution_inconsistent');
  }

  if (tp?.personRootClassification === 'independent_person_root') {
    strictErrors.push('training_participant_marked_independent');
  }
  if (tp?.distinctFromEmployeeMaster === true) {
    strictErrors.push('training_participant_marked_distinct_competing');
  }
  if (
    tp?.employeeDependencyEvidenceStatus === 'confirmed' &&
    (tp.dependencyEvidenceKind === 'inferred_name_only' ||
      tp.dependencyEvidenceKind === 'unresolved')
  ) {
    strictErrors.push('confirmed_dependency_without_typed_kind');
  }

  for (const run of [pipeline.p1, pipeline.p2]) {
    const r = run.candidateReevaluation;
    if (!r?.evaluatorExecuted) strictErrors.push(`reeval_not_executed:${run.candidateId}`);
    if (r?.genericActivationEligible !== false) {
      strictErrors.push(`activation_eligible:${run.candidateId}`);
    }
    if (r?.planningEligible !== false) {
      strictErrors.push(`planning_eligible:${run.candidateId}`);
    }
    if (r?.approvalForbidden !== true) {
      strictErrors.push(`approval_not_forbidden:${run.candidateId}`);
    }
  }

  const audit: Stage3k2b2aAuditV5 = {
    stage3k2b2Status: 'started_bounded_gap_resolution',
    stage3k2b2aStatus: 'accepted_offline_bounded_gap_resolution_and_reevaluation',
    stage3k2b2bStatus: 'not_started',
    nextStage: 'stage3k2b2b_employee_card_foundation_gap_closure_design',
    previousHumanReviewVerdict: 'PATCH_BEFORE_COMMIT',
    humanReviewVerdict: 'PASS_WITH_FINALIZATION',
    humanReviewStatus: 'accepted',
    acceptedInfrastructure: 'bounded_semantic_evidence_gap_resolution_and_reevaluation',
    realCandidateApprovalStatus: 'no_candidates_approved',
    realCandidateDecisions: {
      P1: 'request_more_evidence',
      P2: 'request_more_evidence',
    },
    accepted: true,
    committed: options?.committed ?? false,
    policyPath: loaded.policyPath,
    policyVersion: loaded.policy.policyVersion,
    policyHash: loaded.policyHash,
    rulesApplied: pipeline.rulesApplied,
    p1RealEvidenceCount: pipeline.p1.realEvidenceCount,
    p1FixtureEvidenceCount: pipeline.p1.fixtureEvidenceCount,
    p2RealEvidenceCount: pipeline.p2.realEvidenceCount,
    p2FixtureEvidenceCount: pipeline.p2.fixtureEvidenceCount,
    p1HumanRules: pipeline.p1.humanDomainObservations.map((h) => h.businessRuleKey),
    trainingParticipantClassification: tp ?? null,
    technicalEmployeeDependency: tp?.employeeDependencyEvidenceStatus ?? null,
    dependencyEvidenceKind: tp?.dependencyEvidenceKind ?? null,
    p1ScopeResult: pipeline.p1.scopeAssessment.assessment,
    p1GrainResult: pipeline.p1.grainAssessment.status,
    p1GrainKeyPreservation:
      pipeline.p1.grainAssessment.viewGrainPreservation?.keyPreservationStatus ?? null,
    p1GrainPolicyTrace: pipeline.p1.grainAssessment.policyTrace ?? [],
    p1Reevaluation: pipeline.p1.candidateReevaluation ?? null,
    p2ScopeDerivation: {
      derivation: pipeline.p2.scopeAssessment.scopeDerivation,
      dependencyCandidateId: pipeline.p2.scopeAssessment.scopeDependencyCandidateId,
      assessment: pipeline.p2.scopeAssessment.assessment,
      inheritedBusinessAreas: pipeline.p2.scopeAssessment.inheritedBusinessAreas,
      inheritedFeatureFamilies: pipeline.p2.scopeAssessment.inheritedFeatureFamilies,
    },
    p2Reevaluation: pipeline.p2.candidateReevaluation ?? null,
    p2EmployeeNumberResult:
      pipeline.p2.identityFacetAssessment?.semanticLabelEvidence ?? '',
    compositeIdentityResult:
      pipeline.p2.identityFacetAssessment?.uniquenessEvidence ?? '',
    leadingZeroResult:
      pipeline.p2.identityFacetAssessment?.formatPreservationEvidence ?? '',
    reemploymentRule: 'may_same_or_different_number_no_same_person_inference',
    p2ExactOneGuaranteed:
      pipeline.p2.identityFacetAssessment?.exactOneGuaranteed ?? true,
    p2DependencyReevaluation:
      pipeline.p2.identityFacetAssessment?.sourceDependencyForReevaluation ?? false,
    p2DependencyActivation:
      pipeline.p2.identityFacetAssessment?.sourceDependencyForGenericActivation ?? true,
    ambiguityFixture: pipeline.ambiguityFixture,
    emptyResultFixtures: pipeline.emptyResultFixtures,
    humanQuestionsGenerated: [],
    reviewPackPaths: pipeline.reviewPackPaths,
    applicationContextFixturesSeparated: true,
    counters,
    strictErrors,
  };

  if (options?.writeArtifacts !== false) {
    const outDir = path.join(repoRoot, '.local', 'stage3k2b2a');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'stage3k2b2a-audit-v5.json'),
      JSON.stringify(audit, null, 2),
      'utf8',
    );
  }

  return audit;
}

/** @deprecated use buildStage3k2b2aAudit — kept for older script imports */
export const buildStage3k2b2aAuditV4 = buildStage3k2b2aAudit;
export const buildStage3k2b2aAuditV5 = buildStage3k2b2aAudit;
