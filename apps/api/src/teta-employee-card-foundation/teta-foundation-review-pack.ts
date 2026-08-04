import fs from 'fs';
import path from 'path';
import type {
  CandidateReevaluationTrace,
  CompositeIdentityEvidenceAssessment,
  EmployeeCardNumberEvidenceAssessment,
  EmployeeFoundationDependencyStatus,
  EmployeeFoundationStalenessVector,
  SemanticRelationAttributionEvidence,
  TetaEmployeeFoundationSourceGapRequest,
  TetaEmployeeMasterSourceCandidate,
} from './teta-foundation.types';

export function writeFoundationReviewPacks(
  repoRoot: string,
  input: {
    policyHash: string;
    policyVersion: string;
    rulesApplied: string[];
    p1: TetaEmployeeMasterSourceCandidate;
    participant: SemanticRelationAttributionEvidence;
    p6: EmployeeCardNumberEvidenceAssessment;
    sameRecord: { status: string; evidence: string | null };
    p7: CompositeIdentityEvidenceAssessment;
    p2Dependencies: EmployeeFoundationDependencyStatus;
    p2Reevaluation: {
      evaluatorExecuted: boolean;
      evidenceAssessment: string | null;
      approvalForbidden: true;
      genericActivationEligible: false;
      planningEligible: false;
    } | null;
    reevaluations: CandidateReevaluationTrace[];
    sourceGapRequests: TetaEmployeeFoundationSourceGapRequest[];
    staleness: EmployeeFoundationStalenessVector;
    contractVersion: string;
  },
): { paths: string[]; packs: unknown[] } {
  const dir = path.join(repoRoot, '.local', 'stage3k2b2b1', 'review-packs-v2');
  fs.mkdirSync(dir, { recursive: true });

  const common = {
    packVersion: 'v2',
    contractVersion: input.contractVersion,
    foundationPolicyVersion: input.policyVersion,
    foundationPolicyHash: input.policyHash,
    rulesApplied: input.rulesApplied,
    approvalForbidden: true as const,
    genericActivationEligible: false as const,
    planningEligible: false as const,
    staleness: input.staleness,
  };

  const packs = [
    {
      ...common,
      packId: 'pack-v2:cand:P1:employee',
      candidateId: 'cand:P1:employee',
      employeeMasterSource: input.p1,
      grainOutcome: input.p1.outcome,
      semanticSourceVsAccess: {
        semanticMasterSourceRef: input.p1.semanticMasterSourceRef,
        applicationAnchorRefs: input.p1.applicationAnchorRefs,
        applicationDataSurfaceRefs: input.p1.applicationDataSurfaceRefs,
        applicationDataSurfaceStatus: input.p1.applicationDataSurfaceStatus,
        applicationAccessSurfaceRefs: input.p1.applicationAccessSurfaceRefs,
        runtimeAccessEligibility: input.p1.runtimeAccessEligibility,
        runtimeExecutionAccessObjectRef: input.p1.runtimeExecutionAccessObjectRef,
        authorizationDomainStatus: input.p1.authorizationDomainStatus,
      },
      keyPreservation: input.p1.keyPreservationAssessment,
      participantRelation: input.participant,
      sourceGapRequests: input.sourceGapRequests.filter((r) => r.candidateIds.includes('cand:P1:employee')),
      reevaluation: input.reevaluations.find((r) => r.candidateId === 'cand:P1:employee') ?? null,
    },
    {
      ...common,
      packId: 'pack-v2:cand:P2:employee_identity.employee_number',
      candidateId: 'cand:P2:employee_identity.employee_number',
      dependencyStatuses: input.p2Dependencies,
      reevaluation:
        input.reevaluations.find((r) => r.candidateId === 'cand:P2:employee_identity.employee_number') ??
        input.p2Reevaluation,
      note: 'scope_independent_of_p1_grain',
    },
    {
      ...common,
      packId: 'pack-v2:cand:P6:employee_card_number',
      candidateId: 'cand:P6:employee_card_number',
      cardNumberEvidence: input.p6,
      p6Status: {
        discoveryStatus: input.p6.discoveryStatus,
        usageEligibility: input.p6.usageEligibility,
        candidateCreated: input.p6.candidateCreated,
        technicalPathEvidence: input.p6.technicalPathEvidence,
      },
      blockingGaps: input.p6.unresolvedRisks,
      negativeDistinctions: input.p6.negativeDistinctionEvidence,
      sameRecord: input.sameRecord,
      sourceGapRequests: input.sourceGapRequests.filter((r) => r.candidateIds.includes('cand:P6:employee_card_number')),
      reevaluation: input.reevaluations.find((r) => r.candidateId === 'cand:P6:employee_card_number') ?? null,
    },
    {
      ...common,
      packId: 'pack-v2:cand:P7:employee_card_identity',
      candidateId: 'cand:P7:employee_card_identity',
      compositeIdentity: input.p7,
      compositeIdentityStatus: input.p7.assessmentStatus,
      businessUniqueness: input.p7.businessUniquenessRuleStatus,
      technicalEnforcement: input.p7.technicalUniquenessEnforcementStatus,
      exactOneSemantics: input.p7.exactOneSemantics,
      runtimeCardinalityGuardRequirement: input.p7.runtimeCardinalityGuardRequirement,
      sameRecordEvidenceStatus: input.p7.sameRecordEvidenceStatus,
      sameRecord: input.sameRecord,
      sourceGapRequests: input.sourceGapRequests.filter((r) => r.gapKind === 'same_record_identity_evidence'),
      reevaluation: input.reevaluations.find((r) => r.candidateId === 'cand:P7:employee_card_identity') ?? null,
    },
  ];

  const paths = ['pack-P1.json', 'pack-P2.json', 'pack-P6.json', 'pack-P7.json'].map(
    (name, i) => {
      const fp = path.join(dir, name);
      fs.writeFileSync(fp, JSON.stringify(packs[i], null, 2), 'utf8');
      return fp;
    },
  );
  return { paths, packs };
}
