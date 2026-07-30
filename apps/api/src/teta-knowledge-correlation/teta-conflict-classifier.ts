import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type {
  ApplicabilityComparison,
  ConflictRecordV1,
  ConflictType,
  NormalizedCandidate,
  RelationDecisionV1,
} from './teta-correlation.types';
import { baseDecision, compareExactFields } from './teta-exact-duplicate-classifier';

export type ConflictCounters = {
  conflictsDetected: number;
  conflictsAutoResolved: number;
  conflictingEvidenceDiscarded: number;
};

export function emptyConflictCounters(): ConflictCounters {
  return {
    conflictsDetected: 0,
    conflictsAutoResolved: 0,
    conflictingEvidenceDiscarded: 0,
  };
}

function conflictType(left: NormalizedCandidate, right: NormalizedCandidate): ConflictType {
  const lp = left.occurrence.structuredPayload ?? {};
  const rp = right.occurrence.structuredPayload ?? {};
  if ('value' in lp && 'value' in rp && String(lp.value) !== String(rp.value)) return 'mutually_exclusive_value';
  if (left.occurrence.candidateKind === 'status' || ('status' in lp && 'status' in rp && String(lp.status) !== String(rp.status))) {
    return 'inconsistent_status';
  }
  if (left.occurrence.candidateKind.includes('rule')) return 'contradictory_rule';
  if (left.occurrence.candidateKind === 'process_step' || left.occurrence.candidateKind === 'procedure') {
    return 'incompatible_process_step';
  }
  return 'contradictory_rule';
}

export function classifyConflict(
  left: NormalizedCandidate,
  right: NormalizedCandidate,
  applicability: ApplicabilityComparison,
  counters: ConflictCounters,
): { decision: RelationDecisionV1; conflict: ConflictRecordV1 } | null {
  if (!applicability.compatible && !applicability.partitionMatch) return null;
  if (!applicability.compatible) return null;
  if (left.normalizedSubject !== right.normalizedSubject) return null;

  const lp = left.occurrence.structuredPayload ?? {};
  const rp = right.occurrence.structuredPayload ?? {};
  const leftVal = lp.value ?? lp.effect ?? lp.requiredValue ?? left.normalizedObject;
  const rightVal = rp.value ?? rp.effect ?? rp.requiredValue ?? right.normalizedObject;
  const leftCond = String(lp.condition ?? left.normalizedPredicate);
  const rightCond = String(rp.condition ?? right.normalizedPredicate);

  const contradictory =
    leftCond === rightCond &&
    leftVal != null &&
    rightVal != null &&
    String(leftVal) !== String(rightVal) &&
    String(leftVal).length > 0 &&
    String(rightVal).length > 0;

  if (!contradictory) return null;

  counters.conflictsDetected += 1;
  // never auto-resolve
  counters.conflictsAutoResolved += 0;
  counters.conflictingEvidenceDiscarded += 0;

  const ctype = conflictType(left, right);
  const conflictId = `conflict:sha256:${sha256(
    stableStringify({
      subject: left.normalizedSubject,
      partition: applicability.leftPartitionKey,
      left: left.occurrence.candidateOccurrenceId,
      right: right.occurrence.candidateOccurrenceId,
      type: ctype,
    }),
  )}`;

  const decision = baseDecision(left, right, {
    relationKind: 'conflict',
    confidence: 'deterministic',
    decisionBasis: ['same_subject', 'applicability_compatible', 'contradictory_values', 'no_auto_resolve'],
    applicabilityComparison: applicability,
    fieldComparisons: compareExactFields(left, right),
    warnings: ['conflict_requires_review'],
  });

  const conflict: ConflictRecordV1 = {
    conflictId,
    subjectKey: left.normalizedSubject,
    applicability: left.occurrence.applicability,
    variants: [String(leftVal), String(rightVal)],
    conflictType: ctype,
    resolutionStatus: 'requires_review',
    leftOccurrenceId: decision.leftOccurrenceId,
    rightOccurrenceId: decision.rightOccurrenceId,
    evidenceRefs: decision.evidenceRefs,
    warnings: ['resolution_deferred_to_stage3j2e'],
  };

  return { decision, conflict };
}
