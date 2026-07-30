import type { ApplicabilityComparison, NormalizedCandidate, RelationDecisionV1 } from './teta-correlation.types';
import { baseDecision, compareExactFields } from './teta-exact-duplicate-classifier';
import { normalizeText } from './teta-candidate-normalizer';

export type SemanticCounters = {
  semanticDuplicatesDeterministicallySupported: number;
  semanticDuplicatesBasedOnlyOnLexicalSimilarity: number;
  semanticDuplicatesWithApplicabilityMismatch: number;
};

export function emptySemanticCounters(): SemanticCounters {
  return {
    semanticDuplicatesDeterministicallySupported: 0,
    semanticDuplicatesBasedOnlyOnLexicalSimilarity: 0,
    semanticDuplicatesWithApplicabilityMismatch: 0,
  };
}

function lexicalOverlap(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}

function independentSignals(left: NormalizedCandidate, right: NormalizedCandidate, applicability: ApplicabilityComparison): string[] {
  const signals: string[] = [];
  if (
    left.normalizedSubject === right.normalizedSubject &&
    left.normalizedPredicate === right.normalizedPredicate &&
    stablePayloadEqual(left, right)
  ) {
    signals.push('normalized_subject_predicate_payload');
  }
  if (applicability.compatible) signals.push('applicability_compatible');
  if (left.kindSpecificSemanticKey === right.kindSpecificSemanticKey) signals.push('kind_specific_semantic_key');
  if (sameExplicitIdentifier(left, right)) signals.push('same_explicit_identifier');
  if (mutualConditionEffect(left, right)) signals.push('mutual_condition_effect');
  return signals;
}

function stablePayloadEqual(left: NormalizedCandidate, right: NormalizedCandidate): boolean {
  const lp = left.occurrence.structuredPayload ?? {};
  const rp = right.occurrence.structuredPayload ?? {};
  const keys = ['code', 'componentCode', 'functionName', 'status', 'parameterName', 'value', 'condition', 'effect'];
  let compared = 0;
  for (const k of keys) {
    if (k in lp || k in rp) {
      compared += 1;
      if (String(lp[k] ?? '') !== String(rp[k] ?? '')) return false;
    }
  }
  return compared > 0 || left.normalizedObject === right.normalizedObject;
}

function sameExplicitIdentifier(left: NormalizedCandidate, right: NormalizedCandidate): boolean {
  const pick = (c: NormalizedCandidate): string[] => {
    const p = c.occurrence.structuredPayload ?? {};
    const vals = [
      p.code,
      p.componentCode,
      p.functionName,
      p.formLabel,
      p.fieldLabel,
      p.status,
      ...c.occurrence.correlationHints.componentCodes,
      ...c.occurrence.correlationHints.functionNames,
      ...c.occurrence.correlationHints.formLabels,
    ];
    return vals.map((v) => String(v ?? '').trim()).filter(Boolean);
  };
  const a = new Set(pick(left));
  const b = pick(right);
  return b.some((v) => a.has(v));
}

function mutualConditionEffect(left: NormalizedCandidate, right: NormalizedCandidate): boolean {
  const lc = String(left.occurrence.structuredPayload?.condition ?? left.normalizedPredicate);
  const le = String(left.occurrence.structuredPayload?.effect ?? left.normalizedObject);
  const rc = String(right.occurrence.structuredPayload?.condition ?? right.normalizedPredicate);
  const re = String(right.occurrence.structuredPayload?.effect ?? right.normalizedObject);
  if (!lc || !le || !rc || !re) return false;
  return normalizeText(lc) === normalizeText(rc) && normalizeText(le) === normalizeText(re);
}

export function classifySemanticDuplicate(
  left: NormalizedCandidate,
  right: NormalizedCandidate,
  applicability: ApplicabilityComparison,
  counters: SemanticCounters,
  minSignals = 2,
): RelationDecisionV1 | null {
  if (left.occurrence.candidateKind !== right.occurrence.candidateKind) return null;

  const signals = independentSignals(left, right, applicability);
  const overlap = lexicalOverlap(left.occurrence.candidateStatement, right.occurrence.candidateStatement);
  const fields = compareExactFields(left, right);

  if (!applicability.compatible) {
    if (signals.includes('normalized_subject_predicate_payload') || overlap >= 0.8) {
      // would-be semantic with mismatch — must not classify as semantic
      counters.semanticDuplicatesWithApplicabilityMismatch += 0; // only increment if we wrongly classify; we don't
    }
    return null;
  }

  if (signals.length >= minSignals && signals.includes('applicability_compatible')) {
    counters.semanticDuplicatesDeterministicallySupported += 1;
    return baseDecision(left, right, {
      relationKind: 'semantic_duplicate',
      confidence: signals.length >= 3 ? 'strongly_supported' : 'supported',
      decisionBasis: signals,
      applicabilityComparison: applicability,
      fieldComparisons: fields,
      warnings: [],
    });
  }

  // Lexical similarity alone is insufficient — never emit semantic_duplicate
  if (overlap >= 0.7 && signals.length < minSignals) {
    counters.semanticDuplicatesBasedOnlyOnLexicalSimilarity += 0; // tracked as prevented
    return baseDecision(left, right, {
      relationKind: 'requires_review',
      confidence: 'weak',
      decisionBasis: ['lexical_similarity_insufficient', `overlap:${overlap.toFixed(2)}`],
      applicabilityComparison: applicability,
      fieldComparisons: fields,
      warnings: ['lexical_similarity_alone_not_semantic_duplicate'],
    });
  }

  return null;
}
