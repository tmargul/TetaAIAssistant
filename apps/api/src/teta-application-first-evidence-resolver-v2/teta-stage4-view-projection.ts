import type { EvidenceRelation } from '../teta-schema-role-resolution/teta-schema-role-resolution.types';
import type { ViewProjectionFact } from '../teta-oracle-source-index-stage2/teta-stage2-parse';

export type RelationConfidence = 'exact_static' | 'strong_static' | 'unresolved';

export function relationConfidenceFromProvenance(provenance: string[]): RelationConfidence {
  if (provenance.includes('confidence:exact_static')) return 'exact_static';
  if (provenance.includes('confidence:strong_static')) return 'strong_static';
  return 'unresolved';
}

export function isExactStaticRelation(rel: EvidenceRelation): boolean {
  return (
    rel.fromColumn !== 'UNKNOWN' &&
    rel.toColumn !== 'UNKNOWN' &&
    relationConfidenceFromProvenance(rel.provenance) === 'exact_static'
  );
}

const DIRECT_PROJECTION_KINDS = new Set([
  'direct_column',
  'aliased_direct_column',
  'qualified_direct_column',
]);

/** Find VIEW exposed columns that project from a specific base object.column. */
export function findExposedViewColumnsForBaseColumn(
  projections: ViewProjectionFact[],
  baseObjectRef: string,
  baseColumn: string,
): ViewProjectionFact[] {
  const baseUpper = baseObjectRef.toUpperCase();
  const baseName = baseUpper.split('.').pop()!;
  const colUpper = baseColumn.toUpperCase();
  return projections.filter((p) => {
    if (!p.sourceColumn || p.sourceColumn.toUpperCase() !== colUpper) return false;
    if (!DIRECT_PROJECTION_KINDS.has(p.projectionKind)) return false;
    if (!p.sourceObject) return false;
    const so = p.sourceObject.toUpperCase();
    return so === baseUpper || so.endsWith(`.${baseName}`);
  });
}

/** Resolve externally visible assignment column for a base-table column. */
export function exposedViewColumnForBaseColumn(
  projections: ViewProjectionFact[],
  baseObjectRef: string,
  baseColumn: string,
): string | null {
  const hits = findExposedViewColumnsForBaseColumn(projections, baseObjectRef, baseColumn);
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!.viewColumn;
  const renamed = hits.find(
    (h) => h.viewColumn.toUpperCase() !== baseColumn.toUpperCase(),
  );
  return renamed?.viewColumn ?? hits[0]!.viewColumn;
}

export type ColumnLineageHop = {
  fromObject: string;
  fromColumn: string;
  toObject: string;
  toColumn: string;
  relationType: string;
  source: string;
  sourceHash: string | null;
  confidence: RelationConfidence;
  provenance: string[];
};

function provenanceValue(provenance: string[], prefix: string): string | null {
  const hit = provenance.find((p) => p.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

/**
 * Expand a composed VIEW→related relation into intermediate hops.
 * Does not emit a fake direct physical FK for the composed pair.
 */
export function columnLineageHopsFromRelation(rel: EvidenceRelation | null): ColumnLineageHop[] {
  if (!rel) return [];
  const hops: ColumnLineageHop[] = [];
  const source =
    provenanceValue(rel.provenance, 'sourceView:') ??
    provenanceValue(rel.provenance, 'oracle://') ??
    rel.relationType;
  const sourceHash = provenanceValue(rel.provenance, 'sourceHash:');
  const confidence = relationConfidenceFromProvenance(rel.provenance);
  const projectionLine = rel.provenance.find((p) => p.startsWith('projection:'));
  const joinLine = rel.provenance.find((p) => p.startsWith('sharedBaseJoin:'));
  const projMatch = projectionLine
    ? /^projection:(.+)\.([^.]+)<-(.+)\.([^.]+)$/.exec(projectionLine)
    : null;
  const joinMatch = joinLine
    ? /^sharedBaseJoin:(.+)\.([^.]+)->(.+)\.([^.]+)$/.exec(joinLine)
    : null;

  if (projMatch) {
    hops.push({
      fromObject: projMatch[1]!.toUpperCase(),
      fromColumn: projMatch[2]!.toUpperCase(),
      toObject: projMatch[3]!.toUpperCase(),
      toColumn: projMatch[4]!.toUpperCase(),
      relationType: 'view_projection',
      source: source ?? 'view_projection',
      sourceHash,
      confidence,
      provenance: [projectionLine!, ...rel.provenance.filter((p) => p.startsWith('projectionKind:'))],
    });
  }
  if (joinMatch) {
    hops.push({
      fromObject: joinMatch[1]!.toUpperCase(),
      fromColumn: joinMatch[2]!.toUpperCase(),
      toObject: joinMatch[3]!.toUpperCase(),
      toColumn: joinMatch[4]!.toUpperCase(),
      relationType: 'shared_base_join',
      source: source ?? 'shared_base_join',
      sourceHash,
      confidence,
      provenance: [joinLine!, ...rel.provenance.filter((p) => p.startsWith('evidenceView:') || p.startsWith('pair:'))],
    });
  }
  if (hops.length === 0) {
    hops.push({
      fromObject: rel.fromObject,
      fromColumn: rel.fromColumn,
      toObject: rel.toObject,
      toColumn: rel.toColumn,
      relationType: rel.relationType,
      source: source ?? rel.relationType,
      sourceHash,
      confidence,
      provenance: rel.provenance.slice(0, 8),
    });
  }
  return hops;
}

export type SharedBaseTransferAuditRow = {
  targetView: string;
  targetExposedColumn: string | null;
  targetProjectionExpression: string | null;
  sharedBaseObject: string;
  sharedBaseColumn: string;
  siblingView: string | null;
  siblingExposedColumn: string | null;
  siblingProjectionExpression: string | null;
  joinTargetObject: string;
  joinTargetColumn: string;
  proofChain: string[];
  confidence: RelationConfidence;
  classification: 'direct_exact' | 'projection_exact' | 'shared_base_only' | 'unresolved';
  classificationReason: string;
};

export function classifySharedBaseTransfer(input: {
  targetView: string;
  baseObjectRef: string;
  baseColumn: string;
  joinTargetObject: string;
  joinTargetColumn: string;
  projections: ViewProjectionFact[];
  siblingView?: string | null;
  siblingPair?: string | null;
  provenance: string[];
}): SharedBaseTransferAuditRow {
  const exposed = findExposedViewColumnsForBaseColumn(
    input.projections,
    input.baseObjectRef,
    input.baseColumn,
  );
  const targetExposed = exposed[0] ?? null;
  let classification: SharedBaseTransferAuditRow['classification'] = 'shared_base_only';
  let classificationReason =
    'Shared-base sibling JOIN without proven TARGET_VIEW exposed column projection lineage';
  let confidence: RelationConfidence = 'strong_static';

  if (targetExposed) {
    classification = 'projection_exact';
    classificationReason =
      `TARGET_VIEW.${targetExposed.viewColumn} projects from ${targetExposed.sourceObject}.${targetExposed.sourceColumn} and sibling JOIN proves base relation`;
    confidence = 'exact_static';
  }

  return {
    targetView: input.targetView,
    targetExposedColumn: targetExposed?.viewColumn ?? null,
    targetProjectionExpression: targetExposed?.projectionExpression ?? null,
    sharedBaseObject: input.baseObjectRef,
    sharedBaseColumn: input.baseColumn,
    siblingView: input.siblingView ?? null,
    siblingExposedColumn: input.siblingPair ?? null,
    siblingProjectionExpression: null,
    joinTargetObject: input.joinTargetObject,
    joinTargetColumn: input.joinTargetColumn,
    proofChain: input.provenance,
    confidence,
    classification,
    classificationReason,
  };
}
