/**
 * Stage 3C — column resolution by business role (no name guessing without role evidence).
 */
import type { GraphNodeView } from '../teta-plugins/teta-stage3a.types';
import type { ProjectionRoleResolution } from './teta-report-template.types';
import type { QueryColumnRef, QuerySource, QueryUnresolvedSelection } from './teta-query-plan.types';
import {
  columnsOfOracleObject,
  objectNameOf,
  ownerOf,
  type Stage3cGraphClient,
} from './teta-query-graph-client';

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function columnMatchesHints(col: GraphNodeView, hints: string[]): boolean {
  const fields = [
    col.name,
    col.canonicalName,
    String(col.attributes?.columnName ?? ''),
    String(col.attributes?.label ?? ''),
    String(col.attributes?.displayLabel ?? ''),
    String(col.attributes?.comment ?? ''),
    String(col.attributes?.businessRole ?? ''),
    ...(Array.isArray(col.attributes?.labelHints) ? (col.attributes!.labelHints as string[]) : []),
  ]
    .filter(Boolean)
    .map((x) => norm(String(x)));
  return hints.some((h) => {
    const nh = norm(h);
    return fields.some((f) => f === nh || f.includes(nh) || nh.includes(f));
  });
}

function isLikelyIdColumn(col: GraphNodeView): boolean {
  const name = String(col.attributes?.columnName ?? col.name ?? '').toUpperCase();
  return name === 'ID' || /_ID$/.test(name);
}

function isLikelyTextDisplay(col: GraphNodeView): boolean {
  const name = String(col.attributes?.columnName ?? col.name ?? '').toUpperCase();
  if (isLikelyIdColumn(col)) return false;
  return (
    name === 'NAZWA' ||
    name.includes('NAZWA') ||
    name === 'OPIS' ||
    String(col.attributes?.preferDisplayText) === 'true' ||
    String(col.attributes?.displayMember) === 'true'
  );
}

export function resolveColumns(input: {
  client: Stage3cGraphClient;
  projections: ProjectionRoleResolution[];
  projectionOrder: string[];
  sources: QuerySource[];
}): { projections: QueryColumnRef[]; unresolvedSelections: QueryUnresolvedSelection[] } {
  const unresolvedSelections: QueryUnresolvedSelection[] = [];
  const out: QueryColumnRef[] = [];

  for (const role of input.projectionOrder) {
    const spec = input.projections.find((p) => p.businessRole === role);
    const source = input.sources.find((s) => s.sourceRole === spec?.sourceRole);
    if (!spec || !source || source.status !== 'resolved' || !source.accessObject) {
      out.push({
        businessRole: role,
        status: 'missing',
        sourceRole: spec?.sourceRole ?? 'unknown',
        datasetColumnNodeId: null,
        oracleColumnNodeId: null,
        owner: null,
        objectName: null,
        columnName: null,
        displayLabel: spec?.displayLabel ?? null,
        provenanceNodeIds: [],
        provenanceEdgeIds: [],
        pathNodeIds: [],
      });
      continue;
    }

    const objectId = source.logicalObject?.nodeId ?? source.accessObject.nodeId;
    const { columns, edgeIds } = columnsOfOracleObject(input.client, objectId);
    let matched = columns.filter((c) => columnMatchesHints(c, spec.labelHints));

    // Prefer explicit businessRole attribute match
    const byRole = columns.filter(
      (c) => String(c.attributes?.businessRole ?? '') === spec.businessRole,
    );
    if (byRole.length) matched = byRole;

    if (spec.preferDisplayText) {
      const display = matched.filter(isLikelyTextDisplay);
      if (display.length) matched = display;
      else {
        // Reject pure ID if preferDisplayText and we only have IDs among matches
        const nonId = matched.filter((c) => !isLikelyIdColumn(c));
        if (nonId.length) matched = nonId;
      }
    }

    matched = matched.sort((a, b) => a.id.localeCompare(b.id));

    if (!matched.length) {
      out.push({
        businessRole: role,
        status: 'missing',
        sourceRole: spec.sourceRole,
        datasetColumnNodeId: null,
        oracleColumnNodeId: null,
        owner: source.accessObject.owner,
        objectName: source.accessObject.objectName,
        columnName: null,
        displayLabel: spec.displayLabel,
        provenanceNodeIds: [objectId],
        provenanceEdgeIds: edgeIds,
        pathNodeIds: [objectId],
      });
      continue;
    }

    if (matched.length > 1) {
      unresolvedSelections.push({
        subject: `projection:${role}`,
        reason: 'equal_column_candidates_require_selection',
        candidateNodeIds: matched.map((m) => m.id),
        blocksPlanning: true,
      });
      out.push({
        businessRole: role,
        status: 'ambiguous',
        sourceRole: spec.sourceRole,
        datasetColumnNodeId: null,
        oracleColumnNodeId: null,
        owner: source.accessObject.owner,
        objectName: source.accessObject.objectName,
        columnName: null,
        displayLabel: spec.displayLabel,
        provenanceNodeIds: matched.map((m) => m.id),
        provenanceEdgeIds: edgeIds,
        pathNodeIds: [objectId, ...matched.map((m) => m.id)],
        candidateNodeIds: matched.map((m) => m.id),
      });
      continue;
    }

    const col = matched[0]!;
    // Find dataset column via MAPS if present in subgraph
    const sub = input.client.getEvidenceSubgraph({
      startNodeIds: [col.id],
      allowedEdgeTypes: ['MAPS_TO_ORACLE_COLUMN', 'RESOLVES_TO_ORACLE_COLUMN', 'HAS_DATASET_COLUMN'],
      direction: 'both',
      maxDepth: 2,
      maxNodes: 50,
    });
    const datasetCol =
      sub.nodes.find((n) => n.type === 'dataset_column')?.id ??
      (typeof col.attributes?.datasetColumnNodeId === 'string'
        ? col.attributes.datasetColumnNodeId
        : null);

    out.push({
      businessRole: role,
      status: 'resolved',
      sourceRole: spec.sourceRole,
      datasetColumnNodeId: datasetCol,
      oracleColumnNodeId: col.id,
      owner: ownerOf(col) || source.accessObject.owner,
      objectName: String(col.attributes?.objectName ?? objectNameOf(input.client.getNodeById(objectId)!)),
      columnName: String(col.attributes?.columnName ?? col.name ?? ''),
      displayLabel: spec.displayLabel,
      provenanceNodeIds: [objectId, col.id, ...(datasetCol ? [datasetCol] : [])].sort(),
      provenanceEdgeIds: [...edgeIds, ...sub.edges.map((e) => e.id)].sort(),
      pathNodeIds: [objectId, col.id].sort(),
    });
  }

  return { projections: out, unresolvedSelections };
}
