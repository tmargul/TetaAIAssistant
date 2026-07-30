import type { ApplicabilityComparison, NormalizedCandidate, RelationDecisionV1 } from './teta-correlation.types';
import { baseDecision, compareExactFields } from './teta-exact-duplicate-classifier';
import { stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';

export function classifyEnrichment(
  left: NormalizedCandidate,
  right: NormalizedCandidate,
  applicability: ApplicabilityComparison,
): RelationDecisionV1 | null {
  if (!applicability.compatible) return null;
  if (left.occurrence.candidateKind !== right.occurrence.candidateKind) return null;
  if (left.normalizedSubject !== right.normalizedSubject) return null;

  const lp = left.occurrence.structuredPayload ?? {};
  const rp = right.occurrence.structuredPayload ?? {};
  const leftKeys = Object.keys(lp).sort();
  const rightKeys = Object.keys(rp).sort();
  const onlyRight = rightKeys.filter((k) => !(k in lp));
  const onlyLeft = leftKeys.filter((k) => !(k in rp));
  const sharedConflict = leftKeys.filter((k) => k in rp && stableStringify(lp[k]) !== stableStringify(rp[k]));

  if (sharedConflict.length) return null;
  if (!onlyRight.length && !onlyLeft.length) return null;

  // One side strictly adds fields without changing meaning
  const baseIsLeft = onlyRight.length > 0 && onlyLeft.length === 0;
  const baseIsRight = onlyLeft.length > 0 && onlyRight.length === 0;
  if (!baseIsLeft && !baseIsRight) {
    return baseDecision(left, right, {
      relationKind: 'requires_review',
      confidence: 'unresolved',
      decisionBasis: ['bidirectional_payload_diff', 'enrichment_uncertain'],
      applicabilityComparison: applicability,
      fieldComparisons: compareExactFields(left, right),
      warnings: ['enrichment_direction_unclear'],
    });
  }

  return baseDecision(left, right, {
    relationKind: 'enrich_existing',
    confidence: 'supported',
    decisionBasis: [
      'same_subject',
      'applicability_compatible',
      'added_fields_without_contradiction',
      baseIsLeft ? 'right_enriches_left' : 'left_enriches_right',
      ...(baseIsLeft ? onlyRight : onlyLeft).map((f) => `added:${f}`),
    ],
    applicabilityComparison: applicability,
    fieldComparisons: compareExactFields(left, right),
    warnings: [],
  });
}
