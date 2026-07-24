/**
 * Stage 3C — thin graph client over Stage 3A (no NDJSON, no ranking duplication).
 */
import type {
  GraphEdgeView,
  GraphNodeView,
  GraphResolverResult,
} from '../teta-plugins/teta-stage3a.types';
import type { CanonicalGraphResolverService } from '../teta-plugins/teta-stage3a.resolver';

export type Stage3cGraphClient = {
  getNodeById(id: string): GraphNodeView | null;
  resolveNode(input: {
    id?: string;
    name?: string;
    domain?: string;
    nodeType?: string;
    owner?: string;
    objectType?: string;
  }): GraphResolverResult;
  resolveForm(input: { guid?: string; fullTypeName?: string; nameFragment?: string }): GraphResolverResult;
  traceOracleObject(input: {
    owner?: string;
    objectType?: string;
    name?: string;
    nodeId?: string;
  }): GraphResolverResult;
  getEvidenceSubgraph(input: {
    startNodeIds: string[];
    allowedEdgeTypes?: string[];
    direction?: 'out' | 'in' | 'both';
    maxDepth?: number;
    maxNodes?: number;
  }): GraphResolverResult;
};

export function wrapStage3aResolver(resolver: CanonicalGraphResolverService): Stage3cGraphClient {
  return {
    getNodeById: (id) => resolver.getNodeById(id),
    resolveNode: (input) => resolver.resolveNode(input),
    resolveForm: (input) => resolver.resolveForm(input),
    traceOracleObject: (input) => resolver.traceOracleObject(input),
    getEvidenceSubgraph: (input) => resolver.getEvidenceSubgraph(input),
  };
}

export function emptyGraphResult(
  status: GraphResolverResult['status'] = 'unresolved',
): GraphResolverResult {
  return {
    status,
    query: {},
    selectedNodeId: null,
    candidates: [],
    nodes: [],
    edges: [],
    paths: [],
    conflicts: [],
    warnings: [],
    provenance: [],
    audit: {},
    truncated: false,
    continuation: null,
  };
}

export function isOracleObjectNode(n: GraphNodeView | null | undefined): n is GraphNodeView {
  return !!n && (n.type === 'oracle_object' || n.domain === 'oracle') && !!n.objectType;
}

export function ownerOf(n: GraphNodeView): string {
  return String(n.owner ?? n.attributes?.owner ?? 'UNKNOWN').toUpperCase();
}

export function objectTypeOf(n: GraphNodeView): string {
  return String(n.objectType ?? n.attributes?.objectType ?? '').toUpperCase();
}

export function objectNameOf(n: GraphNodeView): string {
  return String(n.canonicalName ?? n.name ?? n.attributes?.objectName ?? '');
}

export function collectOracleObjectCandidates(
  client: Stage3cGraphClient,
  searchTerms: string[],
): GraphNodeView[] {
  const byId = new Map<string, GraphNodeView>();
  for (const term of searchTerms) {
    const r = client.resolveNode({ name: term, nodeType: 'oracle_object' });
    for (const n of r.nodes) {
      if (n.type === 'oracle_object') byId.set(n.id, n);
    }
    for (const c of r.candidates) {
      const n = client.getNodeById(c.nodeId);
      if (n?.type === 'oracle_object') byId.set(n.id, n);
    }
    // Also allow name search without nodeType filter (views may be typed differently)
    const r2 = client.resolveNode({ name: term });
    for (const n of r2.nodes) {
      if (n.type === 'oracle_object') byId.set(n.id, n);
    }
    for (const c of r2.candidates) {
      const n = client.getNodeById(c.nodeId);
      if (n?.type === 'oracle_object') byId.set(n.id, n);
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function nodesReachableFromForms(
  client: Stage3cGraphClient,
  formNameFragments: string[],
): { formIds: string[]; oracleObjectIds: string[]; edgeIds: string[]; pathNodeIds: string[] } {
  const formIds: string[] = [];
  const oracleObjectIds = new Set<string>();
  const edgeIds = new Set<string>();
  const pathNodeIds = new Set<string>();

  for (const frag of formNameFragments) {
    const fr = client.resolveForm({ nameFragment: frag });
    for (const c of fr.candidates) {
      formIds.push(c.nodeId);
      pathNodeIds.add(c.nodeId);
    }
    if (fr.selectedNodeId) {
      formIds.push(fr.selectedNodeId);
      pathNodeIds.add(fr.selectedNodeId);
    }
  }

  const starts = [...new Set(formIds)].sort();
  if (!starts.length) {
    return { formIds: [], oracleObjectIds: [], edgeIds: [], pathNodeIds: [] };
  }

  const sub = client.getEvidenceSubgraph({
    startNodeIds: starts,
    allowedEdgeTypes: [
      'USES_DATASOURCE',
      'USES_BO',
      'USES_DF',
      'RESOLVES_TO_GATEWAY',
      'PRODUCES_DATASET',
      'READS_FROM',
      'MAPS_TO_ORACLE_OBJECT',
      'RESOLVES_SYNONYM_TO',
      'HAS_COLUMN',
      'JOINS_TO',
      'BINDS_TARGET',
      'BINDS_LOOKUP',
      'MAPS_TO_DATASET_COLUMN',
      'MAPS_TO_ORACLE_COLUMN',
      'RESOLVES_TO_ORACLE_COLUMN',
      'HAS_DATASET_COLUMN',
    ],
    direction: 'both',
    maxDepth: 8,
    maxNodes: 800,
  });

  for (const n of sub.nodes) {
    pathNodeIds.add(n.id);
    if (n.type === 'oracle_object') oracleObjectIds.add(n.id);
  }
  for (const e of sub.edges) edgeIds.add(e.id);

  return {
    formIds: starts,
    oracleObjectIds: [...oracleObjectIds].sort(),
    edgeIds: [...edgeIds].sort(),
    pathNodeIds: [...pathNodeIds].sort(),
  };
}

export function columnsOfOracleObject(
  client: Stage3cGraphClient,
  objectNodeId: string,
): { columns: GraphNodeView[]; edgeIds: string[] } {
  const traced = client.traceOracleObject({ nodeId: objectNodeId });
  const columns = traced.nodes
    .filter((n) => n.type === 'oracle_column')
    .sort((a, b) => a.id.localeCompare(b.id));
  const edgeIds = traced.edges
    .filter((e) => e.type === 'HAS_COLUMN')
    .map((e) => e.id)
    .sort();
  return { columns, edgeIds };
}

export function findJoinEvidenceBetweenObjects(
  client: Stage3cGraphClient,
  leftObjectId: string,
  rightObjectId: string,
): {
  predicates: Array<{
    leftOracleColumnNodeId: string;
    rightOracleColumnNodeId: string;
    edgeId: string;
    evidenceType: 'foreign_key' | 'reconstructed_sql_join' | 'confirmed_gateway_join' | 'canonical_graph_path';
  }>;
  pathNodeIds: string[];
  edgeIds: string[];
} {
  const sub = client.getEvidenceSubgraph({
    startNodeIds: [leftObjectId, rightObjectId],
    allowedEdgeTypes: [
      'FOREIGN_KEY_TO',
      'REFERENCES',
      'JOINS_TO',
      'HAS_COLUMN',
      'MAPS_TO_ORACLE_OBJECT',
      'MAPS_TO_ORACLE_COLUMN',
      'RESOLVES_TO_ORACLE_COLUMN',
      'READS_FROM',
    ],
    direction: 'both',
    maxDepth: 4,
    maxNodes: 400,
  });

  const leftCols = new Set(
    sub.nodes
      .filter((n) => n.type === 'oracle_column' && n.id.includes(objectNameFromId(leftObjectId)))
      .map((n) => n.id),
  );
  // Prefer columns belonging to objects via HAS_COLUMN edges
  const colsByObject = new Map<string, Set<string>>();
  for (const e of sub.edges) {
    if (e.type !== 'HAS_COLUMN') continue;
    if (!colsByObject.has(e.from)) colsByObject.set(e.from, new Set());
    colsByObject.get(e.from)!.add(e.to);
  }
  const leftSet = colsByObject.get(leftObjectId) ?? leftCols;
  const rightSet = colsByObject.get(rightObjectId) ?? new Set<string>();

  const predicates: Array<{
    leftOracleColumnNodeId: string;
    rightOracleColumnNodeId: string;
    edgeId: string;
    evidenceType: 'foreign_key' | 'reconstructed_sql_join' | 'confirmed_gateway_join' | 'canonical_graph_path';
  }> = [];

  for (const e of sub.edges) {
    if (e.type === 'FOREIGN_KEY_TO' || e.type === 'REFERENCES') {
      const a = e.from;
      const b = e.to;
      const aLeft = leftSet.has(a);
      const bRight = rightSet.has(b);
      const aRight = rightSet.has(a);
      const bLeft = leftSet.has(b);
      if (aLeft && bRight) {
        predicates.push({
          leftOracleColumnNodeId: a,
          rightOracleColumnNodeId: b,
          edgeId: e.id,
          evidenceType: 'foreign_key',
        });
      } else if (aRight && bLeft) {
        predicates.push({
          leftOracleColumnNodeId: b,
          rightOracleColumnNodeId: a,
          edgeId: e.id,
          evidenceType: 'foreign_key',
        });
      }
    }
  }

  // Reconstructed SqlJoin nodes linking both objects
  for (const e of sub.edges) {
    if (e.type !== 'JOINS_TO') continue;
    const joinNode = sub.nodes.find((n) => n.id === e.to || n.id === e.from);
    if (!joinNode) continue;
    const attrs = joinNode.attributes ?? {};
    const leftCol = String(attrs.leftColumnNodeId ?? attrs.leftOracleColumnNodeId ?? '');
    const rightCol = String(attrs.rightColumnNodeId ?? attrs.rightOracleColumnNodeId ?? '');
    if (leftCol && rightCol && leftSet.has(leftCol) && rightSet.has(rightCol)) {
      predicates.push({
        leftOracleColumnNodeId: leftCol,
        rightOracleColumnNodeId: rightCol,
        edgeId: e.id,
        evidenceType: 'reconstructed_sql_join',
      });
    }
  }

  // Explicit predicate edges stored on join attributes between the two objects
  for (const e of sub.edges) {
    const attrs = e.attributes ?? {};
    const lp = String(attrs.leftOracleColumnNodeId ?? attrs.leftColumnId ?? '');
    const rp = String(attrs.rightOracleColumnNodeId ?? attrs.rightColumnId ?? '');
    if (lp && rp && leftSet.has(lp) && rightSet.has(rp)) {
      predicates.push({
        leftOracleColumnNodeId: lp,
        rightOracleColumnNodeId: rp,
        edgeId: e.id,
        evidenceType:
          e.type === 'FOREIGN_KEY_TO'
            ? 'foreign_key'
            : e.type === 'JOINS_TO'
              ? 'reconstructed_sql_join'
              : 'canonical_graph_path',
      });
    }
  }

  // Deduplicate predicates
  const seen = new Set<string>();
  const uniq = predicates.filter((p) => {
    const k = `${p.leftOracleColumnNodeId}|${p.rightOracleColumnNodeId}|${p.evidenceType}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    predicates: uniq.sort((a, b) =>
      `${a.leftOracleColumnNodeId}:${a.rightOracleColumnNodeId}`.localeCompare(
        `${b.leftOracleColumnNodeId}:${b.rightOracleColumnNodeId}`,
      ),
    ),
    pathNodeIds: sub.nodes.map((n) => n.id).sort(),
    edgeIds: sub.edges.map((e) => e.id).sort(),
  };
}

function objectNameFromId(id: string): string {
  // oracle-object:OWNER:TYPE:NAME
  const parts = id.split(':');
  return parts[parts.length - 1] ?? id;
}

export type FixtureGraph = {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
};

/** Deterministic in-memory Stage 3A client for unit tests. */
export function createFixtureGraphClient(graph: FixtureGraph): Stage3cGraphClient {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = [...graph.edges].sort((a, b) => a.id.localeCompare(b.id));

  const getNodeById = (id: string) => nodes.get(id) ?? null;

  const edgesFrom = (id: string, type?: string) =>
    edges.filter((e) => e.from === id && (!type || e.type === type));
  const edgesTo = (id: string, type?: string) =>
    edges.filter((e) => e.to === id && (!type || e.type === type));

  const matchName = (n: GraphNodeView, name: string) => {
    const q = name.toLowerCase();
    const fields = [
      n.id,
      n.name,
      n.canonicalName,
      String(n.attributes?.objectName ?? ''),
      String(n.attributes?.columnName ?? ''),
      String(n.attributes?.label ?? ''),
      String(n.attributes?.displayLabel ?? ''),
      ...(Array.isArray(n.attributes?.searchTerms) ? (n.attributes!.searchTerms as string[]) : []),
      ...(Array.isArray(n.attributes?.labelHints) ? (n.attributes!.labelHints as string[]) : []),
      ...(Array.isArray(n.attributes?.semanticTags) ? (n.attributes!.semanticTags as string[]) : []),
    ]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    return fields.some((f) => f === q || f.includes(q));
  };

  return {
    getNodeById,
    resolveNode(input) {
      if (input.id) {
        const n = getNodeById(input.id);
        if (!n) return emptyGraphResult('unresolved');
        return {
          ...emptyGraphResult('resolved'),
          selectedNodeId: n.id,
          candidates: [
            {
              nodeId: n.id,
              scoreRank: 1,
              matchKind: 'exact_id',
              confidence: n.confidence,
              domain: n.domain,
              type: n.type,
              canonicalName: n.canonicalName,
              name: n.name,
            },
          ],
          nodes: [n],
        };
      }
      let list = [...nodes.values()];
      if (input.nodeType) list = list.filter((n) => n.type === input.nodeType);
      if (input.domain) list = list.filter((n) => n.domain === input.domain);
      if (input.owner) list = list.filter((n) => ownerOf(n) === input.owner!.toUpperCase());
      if (input.objectType) list = list.filter((n) => objectTypeOf(n) === input.objectType!.toUpperCase());
      if (input.name) list = list.filter((n) => matchName(n, input.name!));
      list = list.sort((a, b) => a.id.localeCompare(b.id));
      if (!list.length) return emptyGraphResult('unresolved');
      if (list.length === 1) {
        return {
          ...emptyGraphResult('resolved'),
          selectedNodeId: list[0]!.id,
          candidates: list.map((n) => ({
            nodeId: n.id,
            scoreRank: 1,
            matchKind: 'fixture',
            confidence: n.confidence,
            domain: n.domain,
            type: n.type,
            canonicalName: n.canonicalName,
            name: n.name,
          })),
          nodes: list,
        };
      }
      return {
        ...emptyGraphResult('ambiguous'),
        selectedNodeId: null,
        candidates: list.map((n, i) => ({
          nodeId: n.id,
          scoreRank: 10 + i,
          matchKind: 'fixture',
          confidence: n.confidence,
          domain: n.domain,
          type: n.type,
          canonicalName: n.canonicalName,
          name: n.name,
        })),
        nodes: list,
      };
    },
    resolveForm(input) {
      let list = [...nodes.values()].filter((n) => n.type === 'application_form');
      if (input.nameFragment) {
        const q = input.nameFragment.toLowerCase();
        list = list.filter(
          (n) =>
            String(n.name ?? '').toLowerCase().includes(q) ||
            String(n.canonicalName ?? '').toLowerCase().includes(q) ||
            String(n.id).toLowerCase().includes(q),
        );
      }
      list = list.sort((a, b) => a.id.localeCompare(b.id));
      if (!list.length) return emptyGraphResult('unresolved');
      return {
        ...emptyGraphResult(list.length === 1 ? 'resolved' : 'ambiguous'),
        selectedNodeId: list.length === 1 ? list[0]!.id : null,
        candidates: list.map((n, i) => ({
          nodeId: n.id,
          scoreRank: 5 + i,
          matchKind: 'fixture_form',
          confidence: n.confidence,
          domain: n.domain,
          type: n.type,
          canonicalName: n.canonicalName,
          name: n.name,
        })),
        nodes: list,
      };
    },
    traceOracleObject(input) {
      const id =
        input.nodeId ??
        [...nodes.values()].find(
          (n) =>
            n.type === 'oracle_object' &&
            (!input.name || objectNameOf(n) === input.name) &&
            (!input.owner || ownerOf(n) === input.owner.toUpperCase()) &&
            (!input.objectType || objectTypeOf(n) === input.objectType.toUpperCase()),
        )?.id;
      if (!id) return emptyGraphResult('unresolved');
      const obj = getNodeById(id);
      if (!obj) return emptyGraphResult('unresolved');
      const colEdges = edgesFrom(id, 'HAS_COLUMN');
      const cols = colEdges.map((e) => getNodeById(e.to)).filter((n): n is GraphNodeView => !!n);
      const extraEdges = [
        ...colEdges,
        ...edgesFrom(id),
        ...edgesTo(id),
      ].filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i);
      return {
        ...emptyGraphResult('resolved'),
        selectedNodeId: id,
        candidates: [
          {
            nodeId: id,
            scoreRank: 1,
            matchKind: 'oracle_object',
            confidence: obj.confidence,
            domain: obj.domain,
            type: obj.type,
            canonicalName: obj.canonicalName,
            name: obj.name,
          },
        ],
        nodes: [obj, ...cols].sort((a, b) => a.id.localeCompare(b.id)),
        edges: extraEdges.sort((a, b) => a.id.localeCompare(b.id)),
      };
    },
    getEvidenceSubgraph(input) {
      const allowed = input.allowedEdgeTypes ? new Set(input.allowedEdgeTypes) : null;
      const maxDepth = input.maxDepth ?? 6;
      const maxNodes = input.maxNodes ?? 500;
      const direction = input.direction ?? 'both';
      const visited = new Set<string>();
      const nodeIds: string[] = [];
      const edgeIds: string[] = [];
      const queue: Array<{ id: string; depth: number }> = input.startNodeIds.map((id) => ({
        id,
        depth: 0,
      }));
      while (queue.length) {
        const cur = queue.shift()!;
        if (visited.has(cur.id)) continue;
        visited.add(cur.id);
        nodeIds.push(cur.id);
        if (nodeIds.length >= maxNodes) break;
        if (cur.depth >= maxDepth) continue;
        const es = [
          ...(direction === 'out' || direction === 'both' ? edgesFrom(cur.id) : []),
          ...(direction === 'in' || direction === 'both' ? edgesTo(cur.id) : []),
        ];
        for (const e of es) {
          if (allowed && !allowed.has(e.type)) continue;
          edgeIds.push(e.id);
          const next = e.from === cur.id ? e.to : e.from;
          if (!visited.has(next)) queue.push({ id: next, depth: cur.depth + 1 });
        }
      }
      const ns = nodeIds.map(getNodeById).filter((n): n is GraphNodeView => !!n);
      const es = [...new Set(edgeIds)]
        .map((id) => edges.find((e) => e.id === id)!)
        .filter(Boolean)
        .sort((a, b) => a.id.localeCompare(b.id));
      return {
        ...emptyGraphResult('resolved'),
        selectedNodeId: input.startNodeIds[0] ?? null,
        nodes: ns.sort((a, b) => a.id.localeCompare(b.id)),
        edges: es,
        candidates: input.startNodeIds
          .map(getNodeById)
          .filter((n): n is GraphNodeView => !!n)
          .map((n) => ({
            nodeId: n.id,
            scoreRank: 1,
            matchKind: 'subgraph_start',
            confidence: n.confidence,
            domain: n.domain,
            type: n.type,
            canonicalName: n.canonicalName,
            name: n.name,
          })),
      };
    },
  };
}
