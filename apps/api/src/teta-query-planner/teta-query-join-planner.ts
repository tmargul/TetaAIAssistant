/**
 * Stage 3C — join planner (typed predicates with graph evidence; no cartesian joins).
 */
import type { RequiredJoinSpec } from './teta-report-template.types';
import type { QueryJoin, QuerySource } from './teta-query-plan.types';
import {
  findJoinEvidenceBetweenObjects,
  type Stage3cGraphClient,
} from './teta-query-graph-client';

export function planJoins(input: {
  client: Stage3cGraphClient;
  joinSpecs: RequiredJoinSpec[];
  sources: QuerySource[];
}): { joins: QueryJoin[]; cartesianJoins: number; unprovenJoinPredicates: number } {
  const joins: QueryJoin[] = [];
  let cartesianJoins = 0;
  let unprovenJoinPredicates = 0;

  const sortedSpecs = [...input.joinSpecs].sort((a, b) => {
    const la = `${a.leftSourceRole}:${a.rightSourceRole}`;
    const lb = `${b.leftSourceRole}:${b.rightSourceRole}`;
    return la.localeCompare(lb);
  });

  for (const spec of sortedSpecs) {
    const left = input.sources.find((s) => s.sourceRole === spec.leftSourceRole);
    const right = input.sources.find((s) => s.sourceRole === spec.rightSourceRole);
    const joinId = `join:${spec.leftSourceRole}:${spec.rightSourceRole}`;

    if (
      !left ||
      !right ||
      left.status !== 'resolved' ||
      right.status !== 'resolved' ||
      !left.accessObject ||
      !right.accessObject
    ) {
      joins.push({
        joinId,
        leftSourceRole: spec.leftSourceRole,
        rightSourceRole: spec.rightSourceRole,
        joinType: spec.joinType,
        predicates: [],
        evidenceType: null,
        provenanceEdgeIds: [],
        pathNodeIds: [],
        status: 'missing',
        required: spec.required,
        enrichment: !!spec.enrichment,
      });
      continue;
    }

    // Prefer logical objects for FK/join evidence (synonym access layers often lack HAS_COLUMN).
    const leftObjectId = left.logicalObject?.nodeId ?? left.accessObject.nodeId;
    const rightObjectId = right.logicalObject?.nodeId ?? right.accessObject.nodeId;

    const evidence = findJoinEvidenceBetweenObjects(
      input.client,
      leftObjectId,
      rightObjectId,
    );

    if (!evidence.predicates.length) {
      unprovenJoinPredicates += 1;
      joins.push({
        joinId,
        leftSourceRole: spec.leftSourceRole,
        rightSourceRole: spec.rightSourceRole,
        joinType: spec.joinType,
        predicates: [],
        evidenceType: null,
        provenanceEdgeIds: evidence.edgeIds,
        pathNodeIds: evidence.pathNodeIds,
        status: 'unproven',
        required: spec.required,
        enrichment: !!spec.enrichment,
      });
      // Explicitly do NOT create a cartesian join
      continue;
    }

    const preds = evidence.predicates.map((p) => ({
      leftOracleColumnNodeId: p.leftOracleColumnNodeId,
      operator: 'equals' as const,
      rightOracleColumnNodeId: p.rightOracleColumnNodeId,
    }));

    if (!preds.length) {
      cartesianJoins += 1;
      unprovenJoinPredicates += 1;
    }

    joins.push({
      joinId,
      leftSourceRole: spec.leftSourceRole,
      rightSourceRole: spec.rightSourceRole,
      joinType: spec.joinType,
      predicates: preds,
      evidenceType: evidence.predicates[0]!.evidenceType,
      provenanceEdgeIds: evidence.predicates.map((p) => p.edgeId).sort(),
      pathNodeIds: evidence.pathNodeIds,
      status: 'resolved',
      required: spec.required,
      enrichment: !!spec.enrichment,
    });
  }

  joins.sort((a, b) => {
    const ka = `${a.leftSourceRole}:${a.rightSourceRole}:${a.joinId}`;
    const kb = `${b.leftSourceRole}:${b.rightSourceRole}:${b.joinId}`;
    return ka.localeCompare(kb);
  });

  return { joins, cartesianJoins, unprovenJoinPredicates };
}

/** Union-find connectivity over resolved sources using joins with ≥1 predicate. */
export function sourcesAreConnected(
  sources: QuerySource[],
  joins: QueryJoin[],
): { connected: boolean; disconnectedSourceGraphs: number } {
  const resolved = sources.filter((s) => s.status === 'resolved').map((s) => s.sourceRole);
  if (resolved.length <= 1) return { connected: true, disconnectedSourceGraphs: 0 };

  const parent = new Map<string, string>();
  for (const r of resolved) parent.set(r, r);
  const find = (x: string): string => {
    const p = parent.get(x)!;
    if (p !== x) {
      const r = find(p);
      parent.set(x, r);
      return r;
    }
    return x;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const j of joins) {
    if (j.status !== 'resolved' || j.predicates.length === 0) continue;
    if (!parent.has(j.leftSourceRole) || !parent.has(j.rightSourceRole)) continue;
    union(j.leftSourceRole, j.rightSourceRole);
  }

  const roots = new Set(resolved.map((r) => find(r)));
  const disconnected = roots.size > 1 ? roots.size : 0;
  return { connected: roots.size === 1, disconnectedSourceGraphs: disconnected };
}
