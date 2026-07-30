import type { CorrelationStageManifestV1 } from '../teta-knowledge-correlation/teta-correlation.types';
import type { ReviewPriorityPolicyV1 } from './teta-approval-policy';
import type { DecisionKind, ReviewPriority, ReviewTaskV1 } from './teta-approval.types';
import { TETA_REVIEW_TASK_CONTRACT_VERSION } from './teta-approval.types';
import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';

export type PriorityScoreResult = {
  score: number;
  priority: ReviewPriority;
  reasons: string[];
};

function bandForScore(score: number, bands: ReviewPriorityPolicyV1['priorityBands']): ReviewPriority {
  if (score >= bands.critical) return 'critical';
  if (score >= bands.high) return 'high';
  if (score >= bands.normal) return 'normal';
  return 'low';
}

export function scoreReviewPriority(
  task: CorrelationStageManifestV1['reviewTasks'][number],
  manifest: CorrelationStageManifestV1,
  policy: ReviewPriorityPolicyV1,
): PriorityScoreResult {
  const reasons: string[] = [];
  let score = policy.priorityScores.normal_review ?? 100;

  const hasConflict =
    task.reviewKind === 'resolve_conflict' ||
    task.reasonCodes.some((r) => r.includes('conflict')) ||
    task.proposedRecordRefs.some((id) => {
      const rec = manifest.proposedRecords.find((r) => r.proposedRecordId === id);
      return rec?.status === 'proposed_with_conflict' || (rec?.conflictRefs?.length ?? 0) > 0;
    });
  if (hasConflict) {
    score = Math.max(score, policy.priorityScores.unresolved_conflict ?? 1000);
    reasons.push('unresolved_conflict');
  }

  if ((task.questionRefs?.length ?? 0) > 0 || task.reasonCodes.some((r) => r.startsWith('golden:'))) {
    score = Math.max(score, policy.priorityScores.golden_question_relevant ?? 800);
    reasons.push('golden_question_relevant');
  }

  const requiresReviewBeforeMerge = task.proposedRecordRefs.some((id) => {
    const rec = manifest.proposedRecords.find((r) => r.proposedRecordId === id);
    return rec?.mergeStatus === 'requires_review_before_merge';
  });
  if (requiresReviewBeforeMerge || task.reasonCodes.includes('cluster:no_auto_merge')) {
    score = Math.max(score, policy.priorityScores.requires_review_before_merge ?? 600);
    reasons.push('requires_review_before_merge');
  }

  const mergeCandidate = task.proposedRecordRefs.some((id) => {
    const rec = manifest.proposedRecords.find((r) => r.proposedRecordId === id);
    return rec?.mergeStatus === 'exact_collapsed' || rec?.mergeStatus === 'semantically_grouped';
  });
  if (mergeCandidate) {
    score = Math.max(score, policy.priorityScores.exact_or_semantic_merge_candidate ?? 400);
    reasons.push('exact_or_semantic_merge_candidate');
  }

  if (
    task.reviewKind === 'select_product_scope' ||
    task.reviewKind === 'select_version_scope' ||
    task.reviewKind === 'confirm_applicability' ||
    task.reasonCodes.some((r) => r.includes('applicability') || r.includes('scope') || r.includes('client'))
  ) {
    score = Math.max(score, policy.priorityScores.product_version_client_scope ?? 300);
    reasons.push('product_version_client_scope');
  }

  if (task.reviewKind === 'verify_currentness' || task.reasonCodes.some((r) => r.includes('currentness'))) {
    score = Math.max(score, policy.priorityScores.currentness_verification ?? 200);
    reasons.push('currentness_verification');
  }

  if (!reasons.length) reasons.push('normal_review');

  return {
    score,
    priority: bandForScore(score, policy.priorityBands),
    reasons: [...new Set(reasons)].sort(),
  };
}

function defaultAllowedKinds(task: CorrelationStageManifestV1['reviewTasks'][number]): DecisionKind[] {
  switch (task.reviewKind) {
    case 'resolve_conflict':
      return ['defer', 'request_more_evidence', 'reject', 'approve_as_variants'];
    case 'insufficient_evidence':
      return ['request_more_evidence', 'defer', 'close_gap_as_no_evidence', 'reject'];
    case 'verify_currentness':
      return ['approve_with_scope', 'defer', 'request_more_evidence', 'reject'];
    case 'select_product_scope':
    case 'select_version_scope':
    case 'confirm_applicability':
      return ['approve_with_scope', 'approve_as_variants', 'defer', 'reject'];
    case 'confirm_equivalence':
      return ['approve_merged_record', 'approve_as_variants', 'defer', 'reject', 'request_more_evidence'];
    default:
      return ['approve', 'approve_with_scope', 'defer', 'reject', 'request_more_evidence'];
  }
}

export function materializeReviewTask(
  source: CorrelationStageManifestV1['reviewTasks'][number],
  manifest: CorrelationStageManifestV1,
  policy: ReviewPriorityPolicyV1,
): ReviewTaskV1 {
  const scored = scoreReviewPriority(source, manifest, policy);
  const evidenceRefs = [
    ...new Set(
      source.candidateOccurrenceRefs.flatMap((occId) => {
        // evidence refs are carried by proposed records when available
        return manifest.proposedRecords
          .filter((r) => r.candidateOccurrenceRefs.includes(occId))
          .flatMap((r) => r.evidenceRefs);
      }),
    ),
  ].sort();

  const relationDecisionRefs = manifest.relationDecisions
    .filter(
      (d) =>
        source.candidateOccurrenceRefs.includes(d.leftOccurrenceId) ||
        source.candidateOccurrenceRefs.includes(d.rightOccurrenceId),
    )
    .map((d) => d.relationDecisionId)
    .sort();

  const clusterRefs = manifest.clusters
    .filter((c) => c.candidateOccurrenceRefs.some((id) => source.candidateOccurrenceRefs.includes(id)))
    .map((c) => c.clusterId)
    .sort();

  const identityPayload = {
    sourceReviewTaskId: source.reviewTaskId,
    reviewKind: source.reviewKind,
    proposedRecordRefs: [...source.proposedRecordRefs].sort(),
    candidateOccurrenceRefs: [...source.candidateOccurrenceRefs].sort(),
    questionRefs: [...(source.questionRefs ?? [])].sort(),
    reasonCodes: [...source.reasonCodes].sort(),
    correlationRunId: manifest.run.correlationRunId,
  };

  return {
    contractVersion: TETA_REVIEW_TASK_CONTRACT_VERSION,
    reviewTaskId: `review:sha256:${sha256(stableStringify(identityPayload))}`,
    sourceReviewTaskId: source.reviewTaskId,
    reviewKind: source.reviewKind,
    status: 'pending',
    priority: scored.priority,
    priorityReasons: scored.reasons,
    proposedRecordRefs: [...source.proposedRecordRefs].sort(),
    candidateOccurrenceRefs: [...source.candidateOccurrenceRefs].sort(),
    relationDecisionRefs,
    clusterRefs,
    questionRefs: [...(source.questionRefs ?? [])].sort(),
    evidenceRefs,
    allowedDecisionKinds: defaultAllowedKinds(source),
    createdFromCorrelationRunId: manifest.run.correlationRunId,
    warnings: [],
  };
}
