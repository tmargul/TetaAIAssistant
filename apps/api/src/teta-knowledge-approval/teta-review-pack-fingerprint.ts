import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type { ReviewPackV1, ReviewTaskV1, StaleGuard } from './teta-approval.types';

export function hashStringSet(values: string[]): string {
  return sha256(stableStringify([...values].sort()));
}

export function buildStaleGuard(input: {
  proposedRecordRevisionIds: string[];
  evidenceRefs: string[];
  relationDecisionIds: string[];
  reviewTask: ReviewTaskV1;
}): StaleGuard {
  return {
    proposedRecordRevisionSetSha256: hashStringSet(input.proposedRecordRevisionIds),
    evidenceSetSha256: hashStringSet(input.evidenceRefs),
    correlationDecisionSetSha256: hashStringSet(input.relationDecisionIds),
    reviewTaskFingerprintSha256: sha256(
      stableStringify({
        reviewTaskId: input.reviewTask.reviewTaskId,
        sourceReviewTaskId: input.reviewTask.sourceReviewTaskId,
        reviewKind: input.reviewTask.reviewKind,
        proposedRecordRefs: input.reviewTask.proposedRecordRefs,
        candidateOccurrenceRefs: input.reviewTask.candidateOccurrenceRefs,
        questionRefs: input.reviewTask.questionRefs,
        priority: input.reviewTask.priority,
        priorityReasons: input.reviewTask.priorityReasons,
      }),
    ),
  };
}

export function staleGuardsEqual(a: StaleGuard, b: StaleGuard): boolean {
  return (
    a.proposedRecordRevisionSetSha256 === b.proposedRecordRevisionSetSha256 &&
    a.evidenceSetSha256 === b.evidenceSetSha256 &&
    a.correlationDecisionSetSha256 === b.correlationDecisionSetSha256 &&
    a.reviewTaskFingerprintSha256 === b.reviewTaskFingerprintSha256
  );
}

export function fingerprintReviewPack(pack: Omit<ReviewPackV1, 'reviewPackId' | 'reviewPackRevisionId'>): {
  reviewPackId: string;
  reviewPackRevisionId: string;
} {
  const identity = {
    reviewTaskId: pack.reviewTaskId,
    correlationRunId: pack.correlationRunId,
    packKind: pack.packKind,
    proposedRecordRefs: pack.proposedRecordRefs,
    candidateOccurrenceRefs: pack.candidateOccurrenceRefs,
    questionRefs: pack.questionRefs,
    staleGuard: pack.staleGuard,
    pilotCaseId: pack.pilotCaseId ?? null,
  };
  const revision = {
    ...identity,
    allowedDecisionKinds: pack.allowedDecisionKinds,
    evidenceIds: pack.evidence.map((e) => e.evidenceEntryId),
    blockingIssues: pack.blockingIssues,
    missingInformation: pack.missingInformation,
  };
  return {
    reviewPackId: `review-pack:sha256:${sha256(stableStringify(identity))}`,
    reviewPackRevisionId: `review-pack-revision:sha256:${sha256(stableStringify(revision))}`,
  };
}

export function computeExcerptSha256(excerpt: string | null): string | null {
  if (excerpt == null) return null;
  return sha256(excerpt);
}
