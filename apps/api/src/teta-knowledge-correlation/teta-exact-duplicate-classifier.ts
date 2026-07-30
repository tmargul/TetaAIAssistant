import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type { ApplicabilityComparison, FieldComparison, NormalizedCandidate, RelationDecisionV1 } from './teta-correlation.types';
import { TETA_CANDIDATE_RELATION_CONTRACT_VERSION } from './teta-correlation.types';
import { normalizeForExactCompare } from './teta-candidate-normalizer';

export function buildRelationDecisionId(leftId: string, rightId: string, kind: string, basis: string[]): string {
  const [a, b] = leftId < rightId ? [leftId, rightId] : [rightId, leftId];
  return `relation:sha256:${sha256(stableStringify({ a, b, kind, basis: [...basis].sort() }))}`;
}

export function baseDecision(
  left: NormalizedCandidate,
  right: NormalizedCandidate,
  partial: Omit<RelationDecisionV1, 'contractVersion' | 'relationDecisionId' | 'leftOccurrenceId' | 'rightOccurrenceId' | 'evidenceRefs'> & {
    evidenceRefs?: string[];
  },
): RelationDecisionV1 {
  const leftId = left.occurrence.candidateOccurrenceId;
  const rightId = right.occurrence.candidateOccurrenceId;
  const evidenceRefs = partial.evidenceRefs ?? [
    ...left.occurrence.evidence.map((e) => e.sectionId),
    ...right.occurrence.evidence.map((e) => e.sectionId),
  ];
  return {
    contractVersion: TETA_CANDIDATE_RELATION_CONTRACT_VERSION,
    relationDecisionId: buildRelationDecisionId(leftId, rightId, partial.relationKind, partial.decisionBasis),
    leftOccurrenceId: leftId < rightId ? leftId : rightId,
    rightOccurrenceId: leftId < rightId ? rightId : leftId,
    relationKind: partial.relationKind,
    confidence: partial.confidence,
    decisionBasis: [...partial.decisionBasis].sort(),
    applicabilityComparison: partial.applicabilityComparison,
    fieldComparisons: partial.fieldComparisons,
    evidenceRefs: [...evidenceRefs].sort(),
    warnings: [...(partial.warnings ?? [])].sort(),
  };
}

export function compareExactFields(left: NormalizedCandidate, right: NormalizedCandidate): FieldComparison[] {
  const fields: FieldComparison[] = [
    {
      field: 'candidateKind',
      left: left.occurrence.candidateKind,
      right: right.occurrence.candidateKind,
      equal: left.occurrence.candidateKind === right.occurrence.candidateKind,
    },
    {
      field: 'normalizedSubject',
      left: left.normalizedSubject,
      right: right.normalizedSubject,
      equal: left.normalizedSubject === right.normalizedSubject,
    },
    {
      field: 'normalizedPredicate',
      left: left.normalizedPredicate,
      right: right.normalizedPredicate,
      equal: left.normalizedPredicate === right.normalizedPredicate,
    },
    {
      field: 'normalizedObject',
      left: left.normalizedObject,
      right: right.normalizedObject,
      equal: left.normalizedObject === right.normalizedObject,
    },
    {
      field: 'statementNormalized',
      left: normalizeForExactCompare(left.occurrence.candidateStatement),
      right: normalizeForExactCompare(right.occurrence.candidateStatement),
      equal:
        normalizeForExactCompare(left.occurrence.candidateStatement) ===
        normalizeForExactCompare(right.occurrence.candidateStatement),
    },
    {
      field: 'signature',
      left: left.occurrence.candidateSignatureSha256,
      right: right.occurrence.candidateSignatureSha256,
      equal: left.occurrence.candidateSignatureSha256 === right.occurrence.candidateSignatureSha256,
    },
    {
      field: 'structuredPayload',
      left: left.occurrence.structuredPayload,
      right: right.occurrence.structuredPayload,
      equal: stableStringify(left.occurrence.structuredPayload ?? {}) === stableStringify(right.occurrence.structuredPayload ?? {}),
    },
  ];
  return fields;
}

export function classifyExactDuplicate(
  left: NormalizedCandidate,
  right: NormalizedCandidate,
  applicability: ApplicabilityComparison,
): RelationDecisionV1 | null {
  if (left.occurrence.candidateKind !== right.occurrence.candidateKind) return null;
  if (!applicability.compatible) return null;

  const fields = compareExactFields(left, right);
  const semanticEqual =
    fields.find((f) => f.field === 'normalizedSubject')!.equal &&
    fields.find((f) => f.field === 'normalizedPredicate')!.equal &&
    fields.find((f) => f.field === 'normalizedObject')!.equal &&
    fields.find((f) => f.field === 'statementNormalized')!.equal &&
    fields.find((f) => f.field === 'structuredPayload')!.equal;

  const signatureEqual = fields.find((f) => f.field === 'signature')!.equal;
  if (!semanticEqual && !signatureEqual) return null;
  if (signatureEqual && !applicability.compatible) return null;
  if (!semanticEqual) return null;

  return baseDecision(left, right, {
    relationKind: 'exact_duplicate',
    confidence: 'deterministic',
    decisionBasis: ['same_kind', 'normalized_fields_equal', 'applicability_compatible', signatureEqual ? 'signature_equal' : 'statement_normalized_equal'],
    applicabilityComparison: applicability,
    fieldComparisons: fields,
    warnings: [],
  });
}
