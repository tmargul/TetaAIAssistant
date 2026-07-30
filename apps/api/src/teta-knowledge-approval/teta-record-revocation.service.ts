import type { ApprovedKnowledgeRecordV1, DecisionEventV1 } from './teta-approval.types';

export function applyRevocation(record: ApprovedKnowledgeRecordV1, event: DecisionEventV1): ApprovedKnowledgeRecordV1 {
  return {
    ...record,
    status: 'revoked',
    decisionEventRefs: [...new Set([...record.decisionEventRefs, event.decisionEventId])].sort(),
    warnings: [...record.warnings, 'revoked_by_decision_event'],
  };
}
