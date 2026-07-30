import type { CorrelationStageManifestV1 } from '../teta-knowledge-correlation/teta-correlation.types';
import { loadReviewPriorityPolicy, type ReviewPriorityPolicyV1 } from './teta-approval-policy';
import { materializeReviewTask } from './teta-review-priority';
import type { ReviewPriority, ReviewTaskV1 } from './teta-approval.types';
import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';

const PRIORITY_RANK: Record<ReviewPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export type ReviewQueueResult = {
  tasks: ReviewTaskV1[];
  stats: {
    reviewTasksRead: number;
    reviewTasksQueued: number;
    reviewTasksNotQueued: number;
    criticalPriorityTasks: number;
    highPriorityTasks: number;
    normalPriorityTasks: number;
    lowPriorityTasks: number;
    reviewTasksWithoutPriorityReason: number;
    duplicateReviewTaskIds: number;
    reviewTaskOrderDeterministic: boolean;
    reviewQueueFingerprintSha256: string;
  };
};

export function sortReviewQueue(tasks: ReviewTaskV1[]): ReviewTaskV1[] {
  return [...tasks].sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    const reason = a.priorityReasons.join('|').localeCompare(b.priorityReasons.join('|'));
    if (reason !== 0) return reason;
    return a.reviewTaskId.localeCompare(b.reviewTaskId);
  });
}

export function buildReviewQueue(
  manifest: CorrelationStageManifestV1,
  repoRoot?: string,
  priorityPolicy?: ReviewPriorityPolicyV1,
): ReviewQueueResult {
  const policy = priorityPolicy ?? loadReviewPriorityPolicy(repoRoot);
  const materialized = manifest.reviewTasks.map((t) => materializeReviewTask(t, manifest, policy));
  const sorted = sortReviewQueue(materialized);
  const sortedAgain = sortReviewQueue(materialized);
  const orderDeterministic = sorted.every((t, i) => t.reviewTaskId === sortedAgain[i]?.reviewTaskId);

  const ids = sorted.map((t) => t.reviewTaskId);
  const duplicateReviewTaskIds = ids.length - new Set(ids).size;
  const reviewTasksWithoutPriorityReason = sorted.filter((t) => t.priorityReasons.length === 0).length;

  const count = (p: ReviewPriority) => sorted.filter((t) => t.priority === p).length;

  return {
    tasks: sorted,
    stats: {
      reviewTasksRead: manifest.reviewTasks.length,
      reviewTasksQueued: sorted.length,
      reviewTasksNotQueued: Math.max(0, manifest.reviewTasks.length - sorted.length),
      criticalPriorityTasks: count('critical'),
      highPriorityTasks: count('high'),
      normalPriorityTasks: count('normal'),
      lowPriorityTasks: count('low'),
      reviewTasksWithoutPriorityReason,
      duplicateReviewTaskIds,
      reviewTaskOrderDeterministic: orderDeterministic,
      reviewQueueFingerprintSha256: sha256(
        stableStringify(sorted.map((t) => ({ id: t.reviewTaskId, priority: t.priority, reasons: t.priorityReasons }))),
      ),
    },
  };
}
