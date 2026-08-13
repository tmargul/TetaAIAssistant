/**
 * ApplicationGraphTraverser — bounded Stage 1 ACE walk from semantic anchors.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import type { Stage1Edge, Stage1EdgeKind, Stage1NodeRef } from '../teta-application-code-graph-stage1/teta-stage1.types';
import type { SemanticApplicationAnchor } from './teta-stage4-anchors';

export type AceTraversalBounds = {
  maxApplicationTraversalDepth: number;
  maxApplicationNodes: number;
  maxEdgesRetained: number;
};

export const DEFAULT_ACE_BOUNDS: AceTraversalBounds = {
  maxApplicationTraversalDepth: 6,
  maxApplicationNodes: 600,
  maxEdgesRetained: 8000,
};

const TRAVERSAL_EDGE_KINDS: Stage1EdgeKind[] = [
  'FORM_HAS_CONTROL',
  'CONTROL_BINDS_DATASET',
  'CONTROL_BINDS_COLUMN',
  'FORM_USES_BUSINESS_OBJECT',
  'FORM_USES_DATA_FACTORY',
  'BUSINESS_OBJECT_USES_GATEWAY',
  'GATEWAY_BINDS_DATASET',
  'GATEWAY_READS_FROM_ORACLE_OBJECT',
  'GATEWAY_HAS_DAC_PACKAGE_REFERENCE',
  'GATEWAY_JOINS_ORACLE_OBJECT',
  'GATEWAY_PROJECTS_COLUMN',
  'LOOKUP_USES_OBJECT',
  'APPLICATION_RELATION',
  'APPLICATION_JOIN',
  'INHERITS_CONFIGURATION',
];

export type AceVisitedNode = {
  canonicalId: string;
  nodeType: Stage1NodeRef['kind'];
  name: string;
  sourceStage: 'ACE-S1';
  depth: number;
  reachedFromEdgeKind?: Stage1EdgeKind;
  provenance: string[];
};

export type AceTraversedEdge = {
  edgeId: string;
  edgeKind: Stage1EdgeKind;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  fromKind: Stage1NodeRef['kind'] | null;
  toKind: Stage1NodeRef['kind'] | null;
  confidence: string;
  provenance: string[];
  attributes?: Record<string, unknown>;
};

export type AceTraversalResult = {
  anchorsExpanded: number;
  aceNodesVisited: number;
  aceEdgesAvailable: number;
  aceEdgesTraversed: number;
  maxDepthReached: number;
  truncated: boolean;
  truncationReason: string | null;
  nodes: AceVisitedNode[];
  edges: AceTraversedEdge[];
  oracleEndpoints: Array<{
    name: string;
    canonicalId: string;
    reachedFromApplicationNode: string;
    acePath: string[];
    edgeKind: Stage1EdgeKind;
    edgeKinds: Stage1EdgeKind[];
  }>;
  dacPackages: Array<{ gatewayName: string; packageRef: string }>;
  edgesByKind: Record<string, number>;
  seedNodeIds: string[];
};

function nodeId(n: Stage1NodeRef): string {
  return n.canonicalId ?? `${n.kind}|${n.name}`;
}

function defaultAcePath(repoRoot: string): string {
  return (
    process.env.TETA_TWP_STAGE3_ACE_PATH?.trim() ||
    path.join(
      repoRoot,
      '.local',
      'application-code-graph-stage1',
      'application-code-graph-v2.ndjson',
    )
  );
}

function edgePriority(kind: Stage1EdgeKind): number {
  switch (kind) {
    case 'GATEWAY_READS_FROM_ORACLE_OBJECT':
      return 90;
    case 'LOOKUP_USES_OBJECT':
      return 85;
    case 'GATEWAY_JOINS_ORACLE_OBJECT':
      return 80;
    case 'APPLICATION_JOIN':
    case 'APPLICATION_RELATION':
      return 75;
    case 'BUSINESS_OBJECT_USES_GATEWAY':
    case 'FORM_USES_BUSINESS_OBJECT':
    case 'GATEWAY_HAS_DAC_PACKAGE_REFERENCE':
      return 60;
    case 'GATEWAY_BINDS_DATASET':
    case 'CONTROL_BINDS_DATASET':
      return 40;
    case 'GATEWAY_PROJECTS_COLUMN':
      return 10;
    default:
      return 20;
  }
}

function matchesTokens(name: string, tokens: string[]): boolean {
  const lower = name.toLowerCase();
  return tokens.some((t) => t.length >= 3 && lower.includes(t.toLowerCase()));
}

/**
 * Stream ACE once: retain edges whose endpoints match anchor tokens OR
 * are adjacent (1-hop) to seed forms/controls later expanded in BFS.
 * First pass collects seed-matching edges + all edges of technical kinds
 * that share a node name with seeds (bounded retain).
 */
export async function traverseApplicationGraph(input: {
  repoRoot: string;
  anchors: SemanticApplicationAnchor[];
  bounds?: Partial<AceTraversalBounds>;
  acePath?: string;
}): Promise<AceTraversalResult> {
  const bounds: AceTraversalBounds = { ...DEFAULT_ACE_BOUNDS, ...input.bounds };
  const acePath = input.acePath ?? defaultAcePath(input.repoRoot);
  const tokens = [
    ...new Set(
      input.anchors.flatMap((a) => {
        // Prefer explicit lexicon/PA match tokens; skip broad module hints like "Personel"
        const fromMatch = a.matchTokens ?? [];
        const label = a.label && a.anchorType !== 'module_hint' ? [a.label] : [];
        return fromMatch.concat(label);
      }),
    ),
  ].filter((t) => t.length >= 4 && !/^(personel|personnel|module|teta|sumo)$/i.test(t));

  const empty: AceTraversalResult = {
    anchorsExpanded: 0,
    aceNodesVisited: 0,
    aceEdgesAvailable: 0,
    aceEdgesTraversed: 0,
    maxDepthReached: 0,
    truncated: false,
    truncationReason: null,
    nodes: [],
    edges: [],
    oracleEndpoints: [],
    dacPackages: [],
    edgesByKind: {},
    seedNodeIds: [],
  };
  if (!fs.existsSync(acePath) || tokens.length === 0) {
    return {
      ...empty,
      truncated: !fs.existsSync(acePath),
      truncationReason: !fs.existsSync(acePath) ? 'ace_graph_missing' : 'no_semantic_tokens',
    };
  }

  const EDGE_CAPS: Partial<Record<Stage1EdgeKind, number>> = {
    GATEWAY_READS_FROM_ORACLE_OBJECT: 800,
    GATEWAY_JOINS_ORACLE_OBJECT: 400,
    GATEWAY_HAS_DAC_PACKAGE_REFERENCE: 400,
    BUSINESS_OBJECT_USES_GATEWAY: 800,
    FORM_USES_BUSINESS_OBJECT: 400,
    FORM_USES_DATA_FACTORY: 200,
    GATEWAY_BINDS_DATASET: 400,
    LOOKUP_USES_OBJECT: 300,
    APPLICATION_JOIN: 600,
    CONTROL_BINDS_DATASET: 150,
    APPLICATION_RELATION: 200,
    GATEWAY_PROJECTS_COLUMN: 80,
    CONTROL_BINDS_COLUMN: 50,
    FORM_HAS_CONTROL: 50,
    INHERITS_CONFIGURATION: 50,
  };

  const retained: Stage1Edge[] = [];
  const perKind = new Map<string, number>();
  let scanned = 0;
  let truncatedLoad = false;
  const rl = readline.createInterface({
    input: fs.createReadStream(acePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim() || !line.includes('edgeKind')) continue;
    let row: Stage1Edge & { kind?: string };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.kind && row.kind !== 'edge') continue;
    if (!row.edgeKind || !TRAVERSAL_EDGE_KINDS.includes(row.edgeKind)) continue;
    scanned += 1;
    const fromName = row.from?.name ?? '';
    const toName = row.to?.name ?? '';
    if (!matchesTokens(fromName, tokens) && !matchesTokens(toName, tokens)) continue;
    const cap = EDGE_CAPS[row.edgeKind] ?? 50;
    const used = perKind.get(row.edgeKind) ?? 0;
    if (used >= cap) continue;
    perKind.set(row.edgeKind, used + 1);
    retained.push(row);
    if (retained.length >= bounds.maxEdgesRetained) {
      truncatedLoad = true;
      break;
    }
  }

  // Seed nodes: forms / BOs / gateways / data factories matching tokens only.
  // Rank and cap seeds so BFS can expand toward Oracle endpoints.
  const seedCandidates: Array<{ id: string; rank: number; name: string }> = [];
  const seenSeed = new Set<string>();
  const rankOf = (kind: string): number => {
    if (kind === 'gateway') return 3;
    if (kind === 'business_object' || kind === 'data_factory') return 2;
    if (kind === 'application_form') return 1;
    return 0;
  };
  for (const e of retained) {
    for (const n of [e.from, e.to]) {
      if (!n) continue;
      if (
        !(
          n.kind === 'application_form' ||
          n.kind === 'business_object' ||
          n.kind === 'data_factory' ||
          n.kind === 'gateway'
        )
      ) {
        continue;
      }
      if (!matchesTokens(n.name, tokens)) continue;
      const id = nodeId(n);
      if (seenSeed.has(id)) continue;
      seenSeed.add(id);
      seedCandidates.push({ id, rank: rankOf(n.kind), name: n.name });
    }
  }
  seedCandidates.sort((a, b) => b.rank - a.rank);
  const maxSeeds = Math.min(60, Math.floor(bounds.maxApplicationNodes / 2));
  const seedIds = new Set(seedCandidates.slice(0, maxSeeds).map((s) => s.id));

  // Adjacency
  const outAdj = new Map<string, Stage1Edge[]>();
  const nodeMeta = new Map<string, Stage1NodeRef>();
  for (const e of retained) {
    const fid = nodeId(e.from);
    const tid = nodeId(e.to);
    nodeMeta.set(fid, e.from);
    nodeMeta.set(tid, e.to);
    if (!outAdj.has(fid)) outAdj.set(fid, []);
    outAdj.get(fid)!.push(e);
  }

  const visited = new Map<string, AceVisitedNode>();
  const traversed: AceTraversedEdge[] = [];
  const edgesByKind: Record<string, number> = {};
  let maxDepth = 0;
  let truncated = truncatedLoad;
  let truncationReason: string | null = truncatedLoad ? 'maxEdgesRetained' : null;

  type Q = { id: string; depth: number; path: string[] };
  const queue: Q[] = [];
  for (const id of seedIds) {
    const meta = nodeMeta.get(id);
    if (!meta) continue;
    visited.set(id, {
      canonicalId: id,
      nodeType: meta.kind,
      name: meta.name,
      sourceStage: 'ACE-S1',
      depth: 0,
      provenance: [`seed_token_match:${meta.name}`],
    });
    queue.push({ id, depth: 0, path: [id] });
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.depth >= bounds.maxApplicationTraversalDepth) continue;
    const edges = [...(outAdj.get(cur.id) ?? [])].sort((a, b) => edgePriority(b.edgeKind) - edgePriority(a.edgeKind));
    for (const e of edges) {
      const tid = nodeId(e.to);
      edgesByKind[e.edgeKind] = (edgesByKind[e.edgeKind] ?? 0) + 1;
      traversed.push({
        edgeId: e.id,
        edgeKind: e.edgeKind,
        fromId: cur.id,
        toId: tid,
        fromName: e.from?.name ?? '',
        toName: e.to?.name ?? '',
        fromKind: e.from?.kind ?? null,
        toKind: e.to?.kind ?? null,
        confidence: e.confidenceClass,
        provenance: (e.provenance ?? []).map(
          (p) => `${p.sourceKind}:${p.sourceFile}:${p.extractionMechanism}`,
        ),
        attributes: e.attributes,
      });
      const leaf =
        e.to.kind === 'oracle_column' || e.edgeKind === 'GATEWAY_PROJECTS_COLUMN';
      if (visited.has(tid)) continue;
      if (leaf) {
        if (visited.size < bounds.maxApplicationNodes) {
          visited.set(tid, {
            canonicalId: tid,
            nodeType: e.to.kind,
            name: e.to.name,
            sourceStage: 'ACE-S1',
            depth: cur.depth + 1,
            reachedFromEdgeKind: e.edgeKind,
            provenance: [`via:${e.edgeKind}`, `from:${cur.id}`],
          });
        }
        continue;
      }
      if (visited.size >= bounds.maxApplicationNodes) {
        truncated = true;
        truncationReason = 'maxApplicationNodes';
        break;
      }
      const meta = e.to;
      const depth = cur.depth + 1;
      maxDepth = Math.max(maxDepth, depth);
      visited.set(tid, {
        canonicalId: tid,
        nodeType: meta.kind,
        name: meta.name,
        sourceStage: 'ACE-S1',
        depth,
        reachedFromEdgeKind: e.edgeKind,
        provenance: [`via:${e.edgeKind}`, `from:${cur.id}`],
      });
      queue.push({ id: tid, depth, path: [...cur.path, tid] });
    }
    if (truncationReason === 'maxApplicationNodes') break;
  }

  const parentEdge = new Map<string, AceTraversedEdge>();
  for (const e of traversed) {
    if (!parentEdge.has(e.toId)) parentEdge.set(e.toId, e);
  }
  function pathTo(id: string): string[] {
    const pathIds: string[] = [id];
    let cur = id;
    for (let i = 0; i < 12; i++) {
      const pe = parentEdge.get(cur);
      if (!pe) break;
      pathIds.unshift(pe.fromId);
      cur = pe.fromId;
    }
    return pathIds;
  }

  const oracleEndpoints: AceTraversalResult['oracleEndpoints'] = [];
  const dacPackages: AceTraversalResult['dacPackages'] = [];
  const pushOracle = (e: AceTraversedEdge, name: string, canonicalId: string) => {
    oracleEndpoints.push({
      name,
      canonicalId,
      reachedFromApplicationNode: e.fromId,
      acePath: pathTo(e.toId),
      edgeKind: e.edgeKind,
      edgeKinds: [e.edgeKind],
    });
  };
  for (const e of traversed) {
    if (e.edgeKind === 'GATEWAY_READS_FROM_ORACLE_OBJECT' || e.edgeKind === 'GATEWAY_JOINS_ORACLE_OBJECT') {
      const to = nodeMeta.get(e.toId);
      if (to) pushOracle(e, to.name, e.toId);
    }
    if (e.edgeKind === 'LOOKUP_USES_OBJECT') {
      const to = nodeMeta.get(e.toId);
      if (to && (to.kind === 'oracle_object' || /\./.test(to.name) || /^[A-Z][A-Z0-9_$#]+$/i.test(to.name))) {
        pushOracle(e, to.name, e.toId);
      }
    }
    if (e.edgeKind === 'APPLICATION_JOIN') {
      const to = nodeMeta.get(e.toId);
      if (to && (to.kind === 'oracle_object' || /\./.test(to.name))) {
        pushOracle(e, to.name, e.toId);
      }
    }
    if (e.edgeKind === 'GATEWAY_HAS_DAC_PACKAGE_REFERENCE') {
      const to = nodeMeta.get(e.toId);
      const from = nodeMeta.get(e.fromId);
      if (to && from) {
        dacPackages.push({ gatewayName: from.name, packageRef: to.name });
      }
    }
  }

  // Merge duplicate names; keep highest-rank primary edgeKind and union edgeKinds.
  const edgeRank = (k: Stage1EdgeKind): number => {
    if (k === 'GATEWAY_READS_FROM_ORACLE_OBJECT') return 4;
    if (k === 'LOOKUP_USES_OBJECT') return 3;
    if (k === 'GATEWAY_JOINS_ORACLE_OBJECT') return 2;
    return 1;
  };
  const mergedOra = new Map<string, AceTraversalResult['oracleEndpoints'][number]>();
  for (const o of oracleEndpoints) {
    const k = o.name.toUpperCase();
    const prev = mergedOra.get(k);
    if (!prev) {
      mergedOra.set(k, { ...o, edgeKinds: [...o.edgeKinds] });
      continue;
    }
    prev.edgeKinds = [...new Set([...prev.edgeKinds, ...o.edgeKinds])];
    if (edgeRank(o.edgeKind) > edgeRank(prev.edgeKind)) {
      prev.edgeKind = o.edgeKind;
      prev.reachedFromApplicationNode = o.reachedFromApplicationNode;
      prev.acePath = o.acePath;
      prev.canonicalId = o.canonicalId;
    }
  }
  const uniqueOra = [...mergedOra.values()];

  return {
    anchorsExpanded: seedIds.size,
    aceNodesVisited: visited.size,
    aceEdgesAvailable: scanned,
    aceEdgesTraversed: traversed.length,
    maxDepthReached: maxDepth,
    truncated,
    truncationReason,
    nodes: [...visited.values()],
    edges: traversed,
    oracleEndpoints: uniqueOra,
    dacPackages,
    edgesByKind,
    seedNodeIds: [...seedIds],
  };
}
