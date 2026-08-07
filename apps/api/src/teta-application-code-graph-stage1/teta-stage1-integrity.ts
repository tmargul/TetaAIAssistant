import { createHash } from 'crypto';
import type {
  Stage1ConfidenceClass,
  Stage1Edge,
  Stage1EdgeKind,
  Stage1NodeRef,
  Stage1Provenance,
} from './teta-stage1.types';

export type DuplicateSourceCategory =
  | 'multi_control_same_relation'
  | 'stage2a_and_stage2b_independent'
  | 'declared_inherited_effective'
  | 'stage2b_and_stage2d_join'
  | 'repeated_type_member_scan'
  | 'form_bo_double_emit'
  | 'same_fact_multiple_evidence'
  | 'other';

export type BrokenEndpointClassification =
  | 'endpoint_exists_in_base_canonical_graph'
  | 'endpoint_should_be_materialized_by_ACE'
  | 'runtime_boundary_should_replace_missing_endpoint'
  | 'unresolved_external_reference'
  | 'invalid_edge_bug';

export type BrokenEndpointCase = {
  edgeId: string;
  edgeType: string;
  fromId: string;
  toId: string;
  sourceProvenance: Stage1Provenance[];
  classification: BrokenEndpointClassification;
  reason: string;
  resolution: string;
};

/** Canonical edge identity — excludes provenance/rawValue. */
export function stage1CanonicalEdgeId(
  edgeKind: Stage1EdgeKind,
  from: Stage1NodeRef,
  to: Stage1NodeRef,
): string {
  const payload = [edgeKind, from.kind, from.name, to.kind, to.name].join('|');
  const h = createHash('sha256').update(payload).digest('hex').slice(0, 16);
  return `ace-s1-edge:${edgeKind}:${h}`;
}

export function nodeKey(n: Stage1NodeRef): string {
  return `${n.kind}|${n.name}`;
}

export function provenanceFingerprint(p: Stage1Provenance): string {
  return [
    p.sourceKind,
    p.sourceFile,
    p.sourceType ?? '',
    p.sourceMember ?? '',
    p.sourceLineStart ?? '',
    p.extractionMechanism,
    p.rawValue ?? '',
    ...(p.evidenceRefs ?? []),
  ].join('¦');
}

export function mergeProvenance(
  existing: Stage1Provenance[],
  incoming: Stage1Provenance[],
): Stage1Provenance[] {
  const seen = new Set(existing.map(provenanceFingerprint));
  const out = [...existing];
  for (const p of incoming) {
    const fp = provenanceFingerprint(p);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(p);
  }
  return out;
}

export function classifyDuplicateSource(
  existing: Stage1Edge,
  incoming: Stage1Edge,
): DuplicateSourceCategory {
  const a = existing.provenance.map((p) => p.sourceKind);
  const b = incoming.provenance.map((p) => p.sourceKind);
  const kinds = new Set([...a, ...b]);
  if (kinds.has('stage2a_ndjson') && kinds.has('stage2b_ndjson')) {
    return 'stage2a_and_stage2b_independent';
  }
  if (kinds.has('stage2b_ndjson') && kinds.has('stage2d_ndjson')) {
    return 'stage2b_and_stage2d_join';
  }
  const mechs = [...existing.provenance, ...incoming.provenance].map(
    (p) => p.extractionMechanism,
  );
  if (
    mechs.some((m) => /inherited|declared|effective/i.test(m)) ||
    (existing.attributes?.configurationScope &&
      incoming.attributes?.configurationScope &&
      existing.attributes.configurationScope !== incoming.attributes.configurationScope)
  ) {
    return 'declared_inherited_effective';
  }
  if (
    existing.edgeKind === 'CONTROL_BINDS_DATASET' ||
    existing.edgeKind === 'FORM_HAS_CONTROL' ||
    mechs.some((m) => /control/i.test(m))
  ) {
    if (a.every((k) => k === 'stage2a_ndjson') && b.every((k) => k === 'stage2a_ndjson')) {
      return 'multi_control_same_relation';
    }
  }
  if (
    mechs.some((m) => m === 'BusinessObjectReference') &&
    existing.edgeKind === 'FORM_USES_BUSINESS_OBJECT'
  ) {
    return 'form_bo_double_emit';
  }
  if (a.length && b.length && a[0] === b[0]) {
    return 'repeated_type_member_scan';
  }
  if (existing.provenance.length || incoming.provenance.length) {
    return 'same_fact_multiple_evidence';
  }
  return 'other';
}

export function preferConfidence(
  a: Stage1ConfidenceClass,
  b: Stage1ConfidenceClass,
): Stage1ConfidenceClass {
  const rank: Record<Stage1ConfidenceClass, number> = {
    exact_from_source: 4,
    strong_static_inference: 3,
    unresolved: 2,
    runtime_only: 1,
  };
  return rank[a] >= rank[b] ? a : b;
}

export function emptyDuplicateCategoryCounts(): Record<DuplicateSourceCategory, number> {
  return {
    multi_control_same_relation: 0,
    stage2a_and_stage2b_independent: 0,
    declared_inherited_effective: 0,
    stage2b_and_stage2d_join: 0,
    repeated_type_member_scan: 0,
    form_bo_double_emit: 0,
    same_fact_multiple_evidence: 0,
    other: 0,
  };
}

export function emptyBrokenClassificationCounts(): Record<
  BrokenEndpointClassification,
  number
> {
  return {
    endpoint_exists_in_base_canonical_graph: 0,
    endpoint_should_be_materialized_by_ACE: 0,
    runtime_boundary_should_replace_missing_endpoint: 0,
    unresolved_external_reference: 0,
    invalid_edge_bug: 0,
  };
}
