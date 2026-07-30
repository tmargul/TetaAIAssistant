import type { CorrelationStageManifestV1 } from '../teta-knowledge-correlation/teta-correlation.types';
import { loadApprovedQuestionPolicy } from './teta-approval-policy';
import type {
  ApprovedCoverageStatus,
  ApprovedKnowledgeRecordV1,
  ApprovedQuestionCoverageV1,
  ReviewPackV1,
} from './teta-approval.types';
import { TETA_APPROVED_QUESTION_COVERAGE_CONTRACT_VERSION } from './teta-approval.types';

export function evaluateApprovedQuestionCoverage(input: {
  correlationManifest: CorrelationStageManifestV1;
  reviewPacks: ReviewPackV1[];
  approvedRecords: ApprovedKnowledgeRecordV1[];
  repoRoot?: string;
}): { coverage: ApprovedQuestionCoverageV1[]; stats: Record<string, number> } {
  const policy = loadApprovedQuestionPolicy(input.repoRoot);
  const coverage: ApprovedQuestionCoverageV1[] = [];

  for (const q of input.correlationManifest.questionCoverage) {
    const relatedPacks = input.reviewPacks.filter((p) => p.questionRefs.includes(q.questionId));
    const approvedRefs = input.approvedRecords
      .filter((r) => relatedPacks.some((p) => p.proposedRecordRefs.some((id) => r.sourceProposedRecordRefs.includes(id))))
      .map((r) => r.approvedRecordRevisionId)
      .sort();

    let approvedCoverageStatus: ApprovedCoverageStatus = 'unsupported';
    const pilotDefault = relatedPacks
      .map((p) => (p.pilotCaseId ? policy.pilotCaseApprovedCoverageDefaults[p.pilotCaseId] : null))
      .find(Boolean);

    if (approvedRefs.length > 0) {
      approvedCoverageStatus = approvedRefs.length >= 1 && q.coverageStatus === 'supported' ? 'approved_supported' : 'approved_partial';
    } else if (pilotDefault) {
      approvedCoverageStatus = pilotDefault as ApprovedCoverageStatus;
    } else if (relatedPacks.some((p) => p.packKind === 'evidence_gap')) {
      approvedCoverageStatus = 'requires_more_evidence';
    } else if (relatedPacks.length) {
      approvedCoverageStatus = 'pending_human_review';
    } else if (q.coverageStatus === 'unsupported') {
      approvedCoverageStatus = 'unsupported';
    } else {
      approvedCoverageStatus = 'pending_human_review';
    }

    // Real iteration: no approved_supported without records
    if (approvedCoverageStatus === 'approved_supported' && approvedRefs.length === 0) {
      approvedCoverageStatus = 'pending_human_review';
    }

    coverage.push({
      contractVersion: TETA_APPROVED_QUESTION_COVERAGE_CONTRACT_VERSION,
      questionId: q.questionId,
      candidateCoverageStatus: q.coverageStatus,
      approvedCoverageStatus,
      approvedRecordRefs: approvedRefs,
      pendingReviewPackRefs: relatedPacks.map((p) => p.reviewPackId).sort(),
      evidenceGapRefs: relatedPacks.filter((p) => p.packKind === 'evidence_gap').map((p) => p.reviewPackId).sort(),
      warnings: [],
    });
  }

  const stats = {
    questionsEvaluatedForApprovedCoverage: coverage.length,
    questionsApprovedSupported: coverage.filter((c) => c.approvedCoverageStatus === 'approved_supported').length,
    questionsApprovedPartial: coverage.filter((c) => c.approvedCoverageStatus === 'approved_partial').length,
    questionsPendingHumanReview: coverage.filter((c) => c.approvedCoverageStatus === 'pending_human_review').length,
    questionsRequiringMoreEvidence: coverage.filter((c) => c.approvedCoverageStatus === 'requires_more_evidence').length,
    questionsUnsupported: coverage.filter((c) => c.approvedCoverageStatus === 'unsupported').length,
    questionsIncorrectlyMarkedApprovedWithoutRecord: coverage.filter(
      (c) =>
        (c.approvedCoverageStatus === 'approved_supported' || c.approvedCoverageStatus === 'approved_partial') &&
        c.approvedRecordRefs.length === 0,
    ).length,
  };

  return { coverage: coverage.sort((a, b) => a.questionId.localeCompare(b.questionId)), stats };
}
