import type { ApplicabilityComparison, NormalizedCandidate, RelationDecisionV1, RelationKind } from './teta-correlation.types';
import { baseDecision, compareExactFields } from './teta-exact-duplicate-classifier';
import { hasUnknownApplicability } from './teta-applicability-partitioner';

function sorted(values: string[] | undefined): string[] {
  return [...(values ?? [])].map((v) => v.toLowerCase()).sort();
}

function sameSubjectish(left: NormalizedCandidate, right: NormalizedCandidate): boolean {
  return (
    left.normalizedSubject === right.normalizedSubject ||
    left.occurrence.candidateSignatureSha256 === right.occurrence.candidateSignatureSha256 ||
    (left.normalizedSubject.length > 3 &&
      right.normalizedSubject.length > 3 &&
      (left.normalizedSubject.includes(right.normalizedSubject) || right.normalizedSubject.includes(left.normalizedSubject)))
  );
}

export function classifyVariant(
  left: NormalizedCandidate,
  right: NormalizedCandidate,
  applicability: ApplicabilityComparison,
): RelationDecisionV1 | null {
  if (left.occurrence.candidateKind !== right.occurrence.candidateKind) return null;
  if (!sameSubjectish(left, right)) return null;

  if (hasUnknownApplicability(left.occurrence.applicability) || hasUnknownApplicability(right.occurrence.applicability)) {
    if (!applicability.compatible) {
      return baseDecision(left, right, {
        relationKind: 'requires_review',
        confidence: 'unresolved',
        decisionBasis: ['unknown_applicability', 'no_auto_merge'],
        applicabilityComparison: applicability,
        fieldComparisons: compareExactFields(left, right),
        warnings: ['unknown_applicability_requires_review'],
      });
    }
  }

  const lf = sorted(left.occurrence.applicability.productFamilyIds);
  const rf = sorted(right.occurrence.applicability.productFamilyIds);
  const ls = sorted(left.occurrence.applicability.productSurfaceIds);
  const rs = sorted(right.occurrence.applicability.productSurfaceIds);
  const lv = sorted(left.occurrence.applicability.productVersionHints);
  const rv = sorted(right.occurrence.applicability.productVersionHints);
  const lt = sorted(left.occurrence.applicability.documentDateHints);
  const rt = sorted(right.occurrence.applicability.documentDateHints);
  const leftScope = left.occurrence.applicability.scopeStatus;
  const rightScope = right.occurrence.applicability.scopeStatus;

  let kind: RelationKind | null = null;
  const basis: string[] = ['same_subject_family'];

  if (lf.join() !== rf.join() && lf.length && rf.length) {
    kind = 'product_variant';
    basis.push('distinct_product_families');
  } else if (ls.join() !== rs.join() && (ls.length || rs.length)) {
    kind = 'product_surface_variant';
    basis.push('distinct_product_surfaces');
    if ([...ls, ...rs].includes('teta_me')) basis.push('teta_me_is_product_surface');
  } else if (lv.join() !== rv.join() && (lv.length || rv.length)) {
    kind = 'version_variant';
    basis.push('distinct_versions');
  } else if (lt.join() !== rt.join() && (lt.length || rt.length)) {
    kind = 'temporal_variant';
    basis.push('distinct_temporal_context');
  } else if (
    (leftScope === 'client_specific_candidate') !== (rightScope === 'client_specific_candidate') ||
    (leftScope === 'client_specific_candidate' && rightScope === 'client_specific_candidate' && left.occurrence.logicalSourceId !== right.occurrence.logicalSourceId)
  ) {
    kind = 'client_variant';
    basis.push('client_specific_scope');
  } else if (
    left.occurrence.applicability.currentnessStatus === 'not_verified' ||
    right.occurrence.applicability.currentnessStatus === 'not_verified' ||
    String(left.occurrence.structuredPayload?.regulatory ?? '') !== String(right.occurrence.structuredPayload?.regulatory ?? '')
  ) {
    const leftReg = left.occurrence.structuredPayload?.regulatory;
    const rightReg = right.occurrence.structuredPayload?.regulatory;
    if (leftReg != null || rightReg != null || left.occurrence.candidateKind === 'temporal_rule') {
      if (String(leftReg ?? '') !== String(rightReg ?? '') || lt.join() !== rt.join()) {
        kind = 'regulatory_variant';
        basis.push('regulatory_or_currentness_diff');
      }
    }
  }

  // configuration / process / scenario from payload
  if (!kind) {
    const lcfg = left.occurrence.structuredPayload?.configurationValue ?? left.occurrence.structuredPayload?.value;
    const rcfg = right.occurrence.structuredPayload?.configurationValue ?? right.occurrence.structuredPayload?.value;
    if (lcfg != null && rcfg != null && String(lcfg) !== String(rcfg) && left.normalizedSubject === right.normalizedSubject) {
      kind = 'configuration_variant';
      basis.push('configuration_value_diff');
    }
  }
  if (!kind) {
    const lp = String(left.occurrence.structuredPayload?.processVariant ?? left.occurrence.structuredPayload?.path ?? '');
    const rp = String(right.occurrence.structuredPayload?.processVariant ?? right.occurrence.structuredPayload?.path ?? '');
    if (lp && rp && lp !== rp) {
      kind = 'process_variant';
      basis.push('process_path_diff');
    }
  }
  if (!kind) {
    const lsce = String(left.occurrence.structuredPayload?.scenario ?? '');
    const rsce = String(right.occurrence.structuredPayload?.scenario ?? '');
    if (lsce && rsce && lsce !== rsce) {
      kind = 'scenario_variant';
      basis.push('scenario_diff');
    }
  }

  if (!kind) return null;

  return baseDecision(left, right, {
    relationKind: kind,
    confidence: 'supported',
    decisionBasis: basis,
    applicabilityComparison: applicability,
    fieldComparisons: compareExactFields(left, right),
    warnings: kind === 'product_variant' ? ['do_not_merge_product_families'] : [],
  });
}
