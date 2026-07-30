import type { ApprovedKnowledgeRecordV1, DecisionEventV1 } from './teta-approval.types';

export function applySupersession(
  previous: ApprovedKnowledgeRecordV1,
  next: ApprovedKnowledgeRecordV1,
  event: DecisionEventV1,
): { previous: ApprovedKnowledgeRecordV1; next: ApprovedKnowledgeRecordV1 } {
  return {
    previous: {
      ...previous,
      status: 'superseded',
      supersession: {
        supersedesRevisionId: previous.supersession.supersedesRevisionId,
        supersededByRevisionId: next.approvedRecordRevisionId,
      },
      decisionEventRefs: [...new Set([...previous.decisionEventRefs, event.decisionEventId])].sort(),
    },
    next: {
      ...next,
      status: 'active',
      supersession: {
        supersedesRevisionId: previous.approvedRecordRevisionId,
        supersededByRevisionId: null,
      },
      decisionEventRefs: [...new Set([...next.decisionEventRefs, event.decisionEventId])].sort(),
    },
  };
}
