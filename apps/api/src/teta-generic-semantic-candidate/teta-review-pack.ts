import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import type {
  HumanReviewPack,
  HumanReviewPackV2,
  RecommendedDecision,
  TetaGenericSemanticBindingCandidate,
} from './teta-generic-semantic-candidate.types';
import { sanitizeEvidenceItems } from './teta-candidate-assessments';

function recommend(c: TetaGenericSemanticBindingCandidate): RecommendedDecision {
  if (c.evidenceAssessment === 'conflicting') return 'conflict_requires_resolution';
  if (
    c.evidenceAssessment === 'needs_more_evidence' ||
    c.evidenceAssessment === 'stale' ||
    c.evidenceAssessment === 'invalid' ||
    c.evidenceAssessment === 'ambiguous'
  ) {
    return 'more_evidence_required';
  }
  return 'review_possible';
}

const LABELS: Record<string, string> = {
  P1: 'Employee (HR master)',
  P2: 'Employee number (identity facet)',
  P3: 'Current position (assignment)',
  P4: 'Position name (display)',
};

/** Legacy v1 pack — kept for compatibility; do not overwrite when writing v2. */
export function buildHumanReviewPack(
  candidate: TetaGenericSemanticBindingCandidate,
): HumanReviewPack {
  return {
    packId: `pack:${candidate.coverageTargetId}`,
    candidateId: candidate.candidateId,
    businessLabel: LABELS[candidate.coverageTargetId] ?? candidate.roleKey,
    businessMeaning: candidate.semanticMeaning,
    proposedScope: candidate.applicability.proposedGenericScope,
    riskClass: candidate.riskClass,
    evidenceSummary: {
      independentFamilies: candidate.independentEvidenceFamilies,
      evidenceStrengths: [candidate.evidenceStrength],
      priorApprovalRefs: candidate.priorApprovalRefs,
      temporalEvidence: Boolean(
        candidate.temporalPolicy?.temporalRoleKey ||
          candidate.underlyingEvidenceRefs.some((e) => e.supports.includes('temporal')),
      ),
      displayEvidence: Boolean(
        candidate.displaySemantics?.lookupProven ||
          candidate.underlyingEvidenceRefs.some((e) => e.supports.includes('display')),
      ),
      grainEvidence: Boolean(candidate.resultGrainAssessment),
    },
    knownGaps: candidate.knownGaps,
    ambiguities: candidate.ambiguities,
    conflicts: candidate.conflicts,
    staleness: candidate.evidenceAssessment === 'stale' ? ['graphSourceHash_mismatch'] : [],
    recommendedDecision: recommend(candidate),
    availableHumanDecisions: [
      'approve_generic_reuse',
      'approve_with_scope',
      'request_more_evidence',
      'reject',
      'defer',
    ],
    decisionStatus: 'PENDING_HUMAN_DECISION',
    automaticApproveRecommendation: false,
    candidateFingerprint: candidate.candidateFingerprint,
    candidateEvaluationFingerprint: candidate.candidateEvaluationFingerprint,
  };
}

export function buildHumanReviewPackV2(
  candidate: TetaGenericSemanticBindingCandidate,
): HumanReviewPackV2 {
  const evidenceItems = sanitizeEvidenceItems(
    candidate.underlyingEvidenceRefs,
    candidate.priorApprovalRefs,
    candidate.applicability.currentHomeSubject,
  );

  return {
    packVersion: 'v2',
    packId: `pack:${candidate.coverageTargetId}`,
    candidateId: candidate.candidateId,
    businessLabel: LABELS[candidate.coverageTargetId] ?? candidate.roleKey,
    businessMeaning: candidate.semanticMeaning,
    proposedScope: candidate.applicability.proposedGenericScope,
    riskClass: candidate.riskClass,
    reviewPackStatus: candidate.reviewPackStatus,
    evidenceAssessment: candidate.evidenceAssessment,
    approvalReadiness: candidate.approvalReadiness,
    evidenceItems,
    lineageAssessment: candidate.lineageAssessment,
    evaluationTrace: candidate.evaluationTrace,
    scopeAssessment: candidate.scopeAssessment,
    resultGrainAssessment: candidate.resultGrainAssessment,
    requiredBindingDependencies: candidate.requiredBindingDependencies,
    priorApprovalRefs: candidate.priorApprovalRefs,
    knownGaps: candidate.knownGaps,
    ambiguities: candidate.ambiguities,
    conflicts: candidate.conflicts,
    staleness: candidate.evidenceAssessment === 'stale' ? ['graphSourceHash_mismatch'] : [],
    recommendedDecision: recommend(candidate),
    availableHumanDecisions: [
      'approve_generic_reuse',
      'approve_with_scope',
      'request_more_evidence',
      'reject',
      'defer',
    ],
    decisionStatus: 'PENDING_HUMAN_DECISION',
    automaticApproveRecommendation: false,
    candidateFingerprint: candidate.candidateFingerprint,
    candidateEvaluationFingerprint: candidate.candidateEvaluationFingerprint,
    evaluationPolicyId: candidate.evaluationPolicyId,
    evaluationPolicyVersion: candidate.candidateEvaluationPolicyVersion,
    evaluationPolicyHash: candidate.evaluationPolicyHash,
    genericReuseActivationBlocked: candidate.genericReuseActivationBlocked,
    genericReuseActivationBlockReasons: candidate.genericReuseActivationBlockReasons,
    identitySemantics: candidate.identitySemantics,
    displaySemantics: candidate.displaySemantics,
    competingEmployeeSourceScanStatus: candidate.competingEmployeeSourceScanStatus,
  };
}

export function writeReviewPackArtifacts(
  packs: HumanReviewPack[],
  candidates: TetaGenericSemanticBindingCandidate[],
  repoRoot: string,
): { reviewPackDir: string; evidenceDir: string; packPaths: string[] } {
  const reviewPackDir = path.join(repoRoot, '.local', 'stage3k2b1', 'review-packs');
  const evidenceDir = path.join(repoRoot, '.local', 'stage3k2b1', 'evidence');
  mkdirSync(reviewPackDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  const packPaths: string[] = [];
  for (const pack of packs) {
    const p = path.join(reviewPackDir, `${pack.packId.replace(':', '-')}.json`);
    writeFileSync(p, JSON.stringify(pack, null, 2), 'utf8');
    packPaths.push(p);
  }
  for (const c of candidates) {
    const p = path.join(evidenceDir, `${c.coverageTargetId}-evidence.json`);
    writeFileSync(
      p,
      JSON.stringify(
        {
          candidateId: c.candidateId,
          priorApprovalRefs: c.priorApprovalRefs,
          underlyingEvidenceRefs: c.underlyingEvidenceRefs,
          independentEvidenceFamilies: c.independentEvidenceFamilies,
          knownGaps: c.knownGaps,
          scopeAssessment: c.scopeAssessment,
          resultGrainAssessment: c.resultGrainAssessment,
          requiredBindingDependencies: c.requiredBindingDependencies,
          evaluationTrace: c.evaluationTrace,
          fingerprints: {
            candidateFingerprint: c.candidateFingerprint,
            candidateEvaluationFingerprint: c.candidateEvaluationFingerprint,
          },
        },
        null,
        2,
      ),
      'utf8',
    );
  }
  return { reviewPackDir, evidenceDir, packPaths };
}

export function writeReviewPackV2Artifacts(
  packs: HumanReviewPackV2[],
  candidates: TetaGenericSemanticBindingCandidate[],
  repoRoot: string,
): { reviewPackDir: string; evidenceDir: string; packPaths: string[] } {
  const reviewPackDir = path.join(repoRoot, '.local', 'stage3k2b1', 'review-packs-v2');
  const evidenceDir = path.join(repoRoot, '.local', 'stage3k2b1', 'evidence');
  mkdirSync(reviewPackDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  const packPaths: string[] = [];
  for (const pack of packs) {
    const p = path.join(reviewPackDir, `${pack.packId.replace(':', '-')}.json`);
    writeFileSync(p, JSON.stringify(pack, null, 2), 'utf8');
    packPaths.push(p);
  }
  for (const c of candidates) {
    const p = path.join(evidenceDir, `${c.coverageTargetId}-evidence-v2.json`);
    writeFileSync(
      p,
      JSON.stringify(
        {
          candidateId: c.candidateId,
          priorApprovalRefs: c.priorApprovalRefs,
          underlyingEvidenceRefs: c.underlyingEvidenceRefs,
          independentEvidenceFamilies: c.independentEvidenceFamilies,
          knownGaps: c.knownGaps,
          scopeAssessment: c.scopeAssessment,
          resultGrainAssessment: c.resultGrainAssessment,
          requiredBindingDependencies: c.requiredBindingDependencies,
          evaluationTrace: c.evaluationTrace,
          lineageAssessment: c.lineageAssessment,
          fingerprints: {
            candidateFingerprint: c.candidateFingerprint,
            candidateEvaluationFingerprint: c.candidateEvaluationFingerprint,
          },
        },
        null,
        2,
      ),
      'utf8',
    );
  }
  return { reviewPackDir, evidenceDir, packPaths };
}
