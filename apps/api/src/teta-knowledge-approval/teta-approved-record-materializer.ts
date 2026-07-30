import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type {
  ApprovedKnowledgeRecordV1,
  DecisionEventV1,
  MaterializedViewV1,
  ReviewPackV1,
  ReviewTaskStatus,
  ReviewTaskV1,
} from './teta-approval.types';
import { buildApprovedRecordsFromDecision } from './teta-approved-record-builder';
import { applySupersession } from './teta-record-supersession.service';
import { applyRevocation } from './teta-record-revocation.service';

export type MaterializeInput = {
  events: DecisionEventV1[];
  packsById: Record<string, ReviewPackV1>;
  reviewTasks?: ReviewTaskV1[];
};

export function materializeFromLedger(input: MaterializeInput): MaterializedViewV1 {
  const recordsByLogical = new Map<string, ApprovedKnowledgeRecordV1>();
  const taskStates = new Map<string, ReviewTaskStatus>();
  for (const t of input.reviewTasks ?? []) taskStates.set(t.reviewTaskId, t.status);

  for (const event of input.events) {
    const pack = input.packsById[event.reviewPackId];
    if (!pack) continue;

    if (event.decisionKind === 'defer') {
      taskStates.set(pack.reviewTaskId, 'deferred');
      continue;
    }
    if (event.decisionKind === 'request_more_evidence') {
      taskStates.set(pack.reviewTaskId, 'requires_more_evidence');
      continue;
    }
    if (event.decisionKind === 'reject' || event.decisionKind === 'close_gap_as_no_evidence') {
      taskStates.set(pack.reviewTaskId, 'rejected');
      continue;
    }

    if (event.decisionKind === 'revoke') {
      const targetId = String(event.approvedRecordActions?.[0]?.['approvedRecordLogicalId'] ?? '');
      for (const [logicalId, rec] of recordsByLogical) {
        if (!targetId || logicalId === targetId) {
          recordsByLogical.set(logicalId, applyRevocation(rec, event));
        }
      }
      taskStates.set(pack.reviewTaskId, 'decided');
      continue;
    }

    if (event.decisionKind === 'supersede') {
      const created = buildApprovedRecordsFromDecision(event, pack);
      for (const neu of created) {
        const prev = recordsByLogical.get(neu.approvedRecordLogicalId);
        if (prev) {
          const { previous, next } = applySupersession(prev, neu, event);
          recordsByLogical.set(previous.approvedRecordLogicalId, previous);
          recordsByLogical.set(next.approvedRecordLogicalId, next);
        } else {
          recordsByLogical.set(neu.approvedRecordLogicalId, neu);
        }
      }
      taskStates.set(pack.reviewTaskId, 'decided');
      continue;
    }

    const created = buildApprovedRecordsFromDecision(event, pack);
    for (const rec of created) {
      recordsByLogical.set(rec.approvedRecordLogicalId, rec);
    }
    if (created.length) taskStates.set(pack.reviewTaskId, 'decided');
  }

  const approvedRecords = [...recordsByLogical.values()].sort((a, b) =>
    a.approvedRecordRevisionId.localeCompare(b.approvedRecordRevisionId),
  );
  const reviewTaskStates = [...taskStates.entries()]
    .map(([reviewTaskId, status]) => ({ reviewTaskId, status }))
    .sort((a, b) => a.reviewTaskId.localeCompare(b.reviewTaskId));

  const viewHashSha256 = sha256(
    stableStringify({
      approvedRecords: approvedRecords.map((r) => r.approvedRecordRevisionId),
      reviewTaskStates,
    }),
  );

  return {
    approvedRecords,
    reviewTaskStates,
    approvedQuestionCoverage: [],
    viewHashSha256,
  };
}

export function materializedViewsEqual(a: MaterializedViewV1, b: MaterializedViewV1): boolean {
  return a.viewHashSha256 === b.viewHashSha256;
}
