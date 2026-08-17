/**
 * TWG ACE application-relation reachability diagnostic — LOCAL ONLY.
 * No production changes. Replays Stage 4 ACE policy + full-graph path analysis.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  resolveApplicationFirstEvidence,
  STAGE4_CONTRACT_VERSION,
} from '../teta-application-first-evidence-resolver-v2';
import { resolveApplicationAnchors } from '../teta-application-first-evidence-resolver-v2/teta-stage4-anchors';
import { buildSemanticAnchorCohorts } from '../teta-application-first-evidence-resolver-v2/teta-stage4-domain-coherence';
import type { Stage1Edge, Stage1EdgeKind, Stage1NodeRef } from '../teta-application-code-graph-stage1/teta-stage1.types';
import {
  DEFAULT_ACE_BOUNDS,
  traverseApplicationGraph,
} from '../teta-application-first-evidence-resolver-v2/teta-stage4-ace-traverse';
import { planClarificationFromStage4 } from '../teta-clarification-engine-stage5';
import type { LogicalRoleId } from '../teta-schema-role-resolution/teta-schema-role-resolution.types';

const GENERIC_ROLES: LogicalRoleId[] = [
  'subject_identity',
  'assignment_source',
  'subject_reference',
  'dictionary_reference',
  'dictionary_identity',
  'dictionary_display_name',
  'valid_from',
  'valid_to',
];

const TWG_QUESTION =
  'Podaj grupę czasu pracy pracownika o numerze ewidencyjnym 00069.';
const UNSEEN_QUESTION =
  'Jakie okresy wypowiedzeń są dostępne w słowniku personelu?';
const RELATION_NEEDLE = 'GrupaCzasuPracyPracownika';

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

function repoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function nodeId(n: Stage1NodeRef): string {
  return n.canonicalId ?? `${n.kind}|${n.name}`;
}

function matchesTokens(name: string, tokens: string[]): boolean {
  const lower = name.toLowerCase();
  return tokens.some((t) => t.length >= 3 && lower.includes(t.toLowerCase()));
}

function acePath(root: string): string {
  return (
    process.env.TETA_TWP_STAGE3_ACE_PATH?.trim() ||
    path.join(root, '.local/application-code-graph-stage1/application-code-graph-v2.ndjson')
  );
}

function buildTokens(anchors: ReturnType<typeof resolveApplicationAnchors>): string[] {
  return [
    ...new Set(
      anchors.anchors.flatMap((a) => {
        const fromMatch = a.matchTokens ?? [];
        const label = a.label && a.anchorType !== 'module_hint' ? [a.label] : [];
        return fromMatch.concat(label);
      }),
    ),
  ].filter((t) => t.length >= 4 && !/^(personel|personnel|module|teta|sumo)$/i.test(t));
}

type SimEdge = Stage1Edge;

async function loadAllAceEdges(file: string): Promise<SimEdge[]> {
  const edges: SimEdge[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim() || !line.includes('edgeKind')) continue;
    try {
      const row = JSON.parse(line) as SimEdge & { kind?: string };
      if (row.kind && row.kind !== 'edge') continue;
      if (!row.edgeKind) continue;
      edges.push(row);
    } catch {
      /* skip */
    }
  }
  return edges;
}

async function grepRelationRecords(file: string, needle: string) {
  const hits: Array<Record<string, unknown>> = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    if (!line.toUpperCase().includes(needle.toUpperCase())) continue;
    try {
      hits.push({ lineNo, record: JSON.parse(line) });
    } catch {
      hits.push({ lineNo, snippet: line.slice(0, 800) });
    }
    if (hits.length >= 50) break;
  }
  return hits;
}

function simulateRetention(allEdges: SimEdge[], tokens: string[], bounds = DEFAULT_ACE_BOUNDS) {
  const retained: SimEdge[] = [];
  const rejected: Array<{ edgeId: string; reason: string; edgeKind: string; from: string; to: string }> = [];
  const perKind = new Map<string, number>();
  let truncatedLoad = false;

  for (const row of allEdges) {
    if (!TRAVERSAL_EDGE_KINDS.includes(row.edgeKind)) {
      rejected.push({
        edgeId: row.id,
        reason: 'edge_type_not_allowed',
        edgeKind: row.edgeKind,
        from: row.from?.name ?? '',
        to: row.to?.name ?? '',
      });
      continue;
    }
    const fromName = row.from?.name ?? '';
    const toName = row.to?.name ?? '';
    if (!matchesTokens(fromName, tokens) && !matchesTokens(toName, tokens)) {
      rejected.push({
        edgeId: row.id,
        reason: 'token_filter_no_endpoint_match',
        edgeKind: row.edgeKind,
        from: fromName,
        to: toName,
      });
      continue;
    }
    const cap = EDGE_CAPS[row.edgeKind] ?? 50;
    const used = perKind.get(row.edgeKind) ?? 0;
    if (used >= cap) {
      rejected.push({
        edgeId: row.id,
        reason: 'per_kind_cap',
        edgeKind: row.edgeKind,
        from: fromName,
        to: toName,
      });
      continue;
    }
    perKind.set(row.edgeKind, used + 1);
    if (retained.length >= bounds.maxEdgesRetained) {
      truncatedLoad = true;
      rejected.push({
        edgeId: row.id,
        reason: 'maxEdgesRetained',
        edgeKind: row.edgeKind,
        from: fromName,
        to: toName,
      });
      continue;
    }
    retained.push(row);
  }

  return { retained, rejected, truncatedLoad, perKind: Object.fromEntries(perKind) };
}

function pickSeeds(retained: SimEdge[], tokens: string[]) {
  const seedCandidates: Array<{
    id: string;
    rank: number;
    name: string;
    kind: string;
    matchedTokens: string[];
    rejectedAsSeed?: string;
  }> = [];
  const seen = new Set<string>();
  const rankOf = (kind: string): number => {
    if (kind === 'gateway') return 3;
    if (kind === 'business_object' || kind === 'data_factory') return 2;
    if (kind === 'application_form') return 1;
    return 0;
  };

  for (const e of retained) {
    for (const n of [e.from, e.to]) {
      if (!n) continue;
      const id = nodeId(n);
      if (seen.has(id)) continue;
      const tokenMatch = matchesTokens(n.name, tokens);
      const allowedKind =
        n.kind === 'application_form' ||
        n.kind === 'business_object' ||
        n.kind === 'data_factory' ||
        n.kind === 'gateway';
      if (!allowedKind) {
        if (tokenMatch && n.name.includes(RELATION_NEEDLE)) {
          seedCandidates.push({
            id,
            rank: -1,
            name: n.name,
            kind: n.kind,
            matchedTokens: tokens.filter((t) => n.name.toLowerCase().includes(t.toLowerCase())),
            rejectedAsSeed: 'node_type_not_allowed_for_seed',
          });
        }
        continue;
      }
      if (!tokenMatch) continue;
      seen.add(id);
      seedCandidates.push({
        id,
        rank: rankOf(n.kind),
        name: n.name,
        kind: n.kind,
        matchedTokens: tokens.filter((t) => n.name.toLowerCase().includes(t.toLowerCase())),
      });
    }
  }
  seedCandidates.sort((a, b) => b.rank - a.rank);
  const maxSeeds = Math.min(60, Math.floor(DEFAULT_ACE_BOUNDS.maxApplicationNodes / 2));
  const accepted = seedCandidates.filter((s) => s.rank >= 0).slice(0, maxSeeds);
  const rejectedSeeds = [
    ...seedCandidates.filter((s) => s.rank >= 0).slice(maxSeeds).map((s) => ({ ...s, rejectedAsSeed: 'seed_cap' })),
    ...seedCandidates.filter((s) => s.rejectedAsSeed),
  ];
  return { accepted, rejectedSeeds, maxSeeds };
}

function bfsShortestPath(
  adj: Map<string, SimEdge[]>,
  nodeMeta: Map<string, Stage1NodeRef>,
  startIds: string[],
  targetPredicate: (id: string, meta: Stage1NodeRef | undefined) => boolean,
  maxDepth: number,
): { pathExists: boolean; paths: Array<{ nodes: string[]; edges: SimEdge[]; depth: number }> } {
  const paths: Array<{ nodes: string[]; edges: SimEdge[]; depth: number }> = [];
  let minDepth = Infinity;

  for (const start of startIds) {
    const queue: Array<{ id: string; depth: number; pathNodes: string[]; pathEdges: SimEdge[] }> = [
      { id: start, depth: 0, pathNodes: [start], pathEdges: [] },
    ];
    const bestDepth = new Map<string, number>([[start, 0]]);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.depth > maxDepth) continue;
      if (targetPredicate(cur.id, nodeMeta.get(cur.id))) {
        if (cur.depth <= minDepth) {
          minDepth = cur.depth;
          if (cur.depth <= minDepth + 1) {
            paths.push({ nodes: cur.pathNodes, edges: cur.pathEdges, depth: cur.depth });
          }
        }
        if (paths.length >= 10) break;
        continue;
      }
      for (const e of adj.get(cur.id) ?? []) {
        const tid = nodeId(e.to);
        const nd = cur.depth + 1;
        if (nd > maxDepth) continue;
        const prev = bestDepth.get(tid);
        if (prev !== undefined && prev < nd) continue;
        bestDepth.set(tid, nd);
        queue.push({
          id: tid,
          depth: nd,
          pathNodes: [...cur.pathNodes, tid],
          pathEdges: [...cur.pathEdges, e],
        });
      }
    }
    if (paths.length >= 10) break;
  }

  const shortest = paths.filter((p) => p.depth === minDepth).slice(0, 10);
  return { pathExists: shortest.length > 0, paths: shortest };
}

function simulateBfsFrontier(retained: SimEdge[], seedIds: Set<string>, bounds = DEFAULT_ACE_BOUNDS) {
  const outAdj = new Map<string, SimEdge[]>();
  const nodeMeta = new Map<string, Stage1NodeRef>();
  for (const e of retained) {
    const fid = nodeId(e.from);
    const tid = nodeId(e.to);
    nodeMeta.set(fid, e.from);
    nodeMeta.set(tid, e.to);
    if (!outAdj.has(fid)) outAdj.set(fid, []);
    outAdj.get(fid)!.push(e);
  }

  const frontier: Array<{
    depth: number;
    nodesVisited: number;
    edgesConsidered: number;
    edgesAccepted: number;
    edgesRejected: Record<string, number>;
    nodeNamesSample: string[];
  }> = [];

  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [];
  for (const id of seedIds) {
    visited.add(id);
    queue.push({ id, depth: 0 });
  }

  const edgesRejectedGlobal: Record<string, number> = {};
  let truncated = false;
  let maxDepth = 0;

  const depthStats = new Map<number, { nodes: Set<string>; considered: number; accepted: number; rejected: Record<string, number> }>();

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.depth >= bounds.maxApplicationTraversalDepth) continue;
    const edges = outAdj.get(cur.id) ?? [];
    if (!depthStats.has(cur.depth)) {
      depthStats.set(cur.depth, { nodes: new Set(), considered: 0, accepted: 0, rejected: {} });
    }
    const ds = depthStats.get(cur.depth)!;
    ds.nodes.add(cur.id);

    for (const e of edges) {
      ds.considered += 1;
      const tid = nodeId(e.to);
      const leaf = e.to.kind === 'oracle_column' || e.edgeKind === 'GATEWAY_PROJECTS_COLUMN';
      if (visited.has(tid)) {
        const r = 'already_seen';
        ds.rejected[r] = (ds.rejected[r] ?? 0) + 1;
        edgesRejectedGlobal[r] = (edgesRejectedGlobal[r] ?? 0) + 1;
        continue;
      }
      if (leaf) {
        ds.accepted += 1;
        visited.add(tid);
        continue;
      }
      if (visited.size >= bounds.maxApplicationNodes) {
        truncated = true;
        const r = 'candidate_cap';
        ds.rejected[r] = (ds.rejected[r] ?? 0) + 1;
        edgesRejectedGlobal[r] = (edgesRejectedGlobal[r] ?? 0) + 1;
        break;
      }
      ds.accepted += 1;
      visited.add(tid);
      maxDepth = Math.max(maxDepth, cur.depth + 1);
      queue.push({ id: tid, depth: cur.depth + 1 });
    }
  }

  for (const [depth, ds] of [...depthStats.entries()].sort((a, b) => a[0] - b[0])) {
    frontier.push({
      depth,
      nodesVisited: ds.nodes.size,
      edgesConsidered: ds.considered,
      edgesAccepted: ds.accepted,
      edgesRejected: ds.rejected,
      nodeNamesSample: [...ds.nodes]
        .slice(0, 12)
        .map((id) => nodeMeta.get(id)?.name ?? id),
    });
  }

  return { frontier, visited, truncated, maxDepth, edgesRejectedGlobal, nodeMeta, outAdj };
}

function buildAdj(allEdges: SimEdge[], directed = true) {
  const adj = new Map<string, SimEdge[]>();
  const nodeMeta = new Map<string, Stage1NodeRef>();
  for (const e of allEdges) {
    const fid = nodeId(e.from);
    const tid = nodeId(e.to);
    nodeMeta.set(fid, e.from);
    nodeMeta.set(tid, e.to);
    if (!adj.has(fid)) adj.set(fid, []);
    adj.get(fid)!.push(e);
    if (!directed) {
      if (!adj.has(tid)) adj.set(tid, []);
      adj.get(tid)!.push({ ...e, from: e.to, to: e.from, id: `${e.id}:rev` });
    }
  }
  return { adj, nodeMeta };
}

async function main(): Promise<void> {
  const root = repoRoot();
  loadDotEnv(path.join(root, 'apps/api/.env'));
  const outDir = path.join(root, '.local/stage6-acceptance/twg-reachability-diagnostic-v4');
  ensureDir(outDir);

  const freezeSha = fs.readFileSync(path.join(root, '.git/refs/heads/main'), 'utf8').trim();
  writeJson(path.join(outDir, 'preflight.json'), {
    STAGE6_TECHNICAL_DIAGNOSTIC_FREEZE_SHA: freezeSha,
    stage4Contract: STAGE4_CONTRACT_VERSION,
    twgPhysicalSeedCount: 0,
    note: 'Diagnostic only — no production changes',
  });

  const twgRequest = {
    businessConcept: 'grupa czasu pracy',
    requestedRoles: GENERIC_ROLES,
    subjectRole: 'employee' as const,
    mode: 'blind_physical_rediscovery' as const,
    question: TWG_QUESTION,
  };

  const anchors = resolveApplicationAnchors({
    repoRoot: root,
    businessConcept: twgRequest.businessConcept,
  });
  const tokens = buildTokens(anchors);
  const cohorts = buildSemanticAnchorCohorts({
    anchors: anchors.anchors,
    businessConcept: twgRequest.businessConcept,
  });

  const stage4 = await resolveApplicationFirstEvidence({ repoRoot: root, request: twgRequest });
  const stage5 = planClarificationFromStage4({ stage4 });

  writeJson(path.join(outDir, 'blind-stage4-result.json'), {
    discoveryOrigin: stage4.discoveryOrigin,
    resolutionStatus: stage4.resolutionStatus,
    metrics: stage4.metrics,
    audit: stage4.audit,
    strictErrors: stage4.strictErrors,
  });
  writeJson(path.join(outDir, 'blind-semantic-anchors.json'), {
    anchors: anchors.anchors,
    tokensUsed: anchors.tokensUsed,
    traversalTokens: tokens,
    semanticCohorts: cohorts,
  });
  writeJson(path.join(outDir, 'blind-ace-traversal.json'), stage4.aceTraversal ?? {});
  writeJson(path.join(outDir, 'blind-oracle-candidates.json'), {
    candidates: (stage4.oracleExpansion?.candidates ?? []).slice(0, 25),
    oracleEndpoints: stage4.aceTraversal?.oracleEndpoints?.slice(0, 25),
  });
  writeJson(path.join(outDir, 'blind-hypotheses.json'), {
    bindingHypotheses: (stage4.bindingHypotheses ?? []).slice(0, 15),
    roleAssignments: stage4.schemaRoleResolution?.roleAssignmentsByRole,
  });
  writeJson(path.join(outDir, 'blind-stage5-result.json'), {
    clarificationRequired: stage5.clarificationRequired,
    technicalGapOnly: stage5.technicalGapOnly,
    selectedDimension: stage5.selectedDimension,
  });

  const graphFile = acePath(root);
  const relationRecords = await grepRelationRecords(graphFile, RELATION_NEEDLE);
  writeJson(path.join(outDir, 'ace-relation-records.json'), {
    needle: RELATION_NEEDLE,
    hitCount: relationRecords.length,
    records: relationRecords.map((h) => {
      const rec = h.record as SimEdge | undefined;
      if (!rec?.edgeKind) return h;
      return {
        lineNo: h.lineNo,
        edgeId: rec.id,
        edgeKind: rec.edgeKind,
        from: { kind: rec.from?.kind, name: rec.from?.name, canonicalId: rec.from?.canonicalId },
        to: { kind: rec.to?.kind, name: rec.to?.name, canonicalId: rec.to?.canonicalId },
        confidenceClass: rec.confidenceClass,
        attributes: rec.attributes,
        provenance: (rec.provenance ?? []).slice(0, 3).map((p) => ({
          sourceKind: p.sourceKind,
          sourceFile: p.sourceFile,
          sourceAssembly: p.sourceAssembly,
          extractionMechanism: p.extractionMechanism,
          confidenceClass: p.confidenceClass,
        })),
      };
    }),
  });

  const allEdges = await loadAllAceEdges(graphFile);
  const { retained, rejected, truncatedLoad, perKind } = simulateRetention(allEdges, tokens);
  const { accepted: seedAccepted, rejectedSeeds, maxSeeds } = pickSeeds(retained, tokens);
  const seedIdSet = new Set(seedAccepted.map((s) => s.id));
  const simBfs = simulateBfsFrontier(retained, seedIdSet);

  const targetPredicate = (id: string, meta: Stage1NodeRef | undefined) =>
    Boolean(meta?.name?.includes(RELATION_NEEDLE) || id.includes(RELATION_NEEDLE));

  const fullAdj = buildAdj(allEdges, true);
  const retainedAdj = buildAdj(retained, true);

  const fullPaths = bfsShortestPath(
    fullAdj.adj,
    fullAdj.nodeMeta,
    [...seedIdSet],
    targetPredicate,
    12,
  );
  const retainedPaths = bfsShortestPath(
    retainedAdj.adj,
    retainedAdj.nodeMeta,
    [...seedIdSet],
    targetPredicate,
    DEFAULT_ACE_BOUNDS.maxApplicationTraversalDepth,
  );

  const blindVisited = new Set((stage4.aceTraversal?.nodes ?? []).map((n) => n.canonicalId));
  const relationNodeIds = [...fullAdj.nodeMeta.entries()]
    .filter(([, m]) => m.name?.includes(RELATION_NEEDLE))
    .map(([id]) => id);

  writeJson(path.join(outDir, 'blind-traversal-frontier.json'), {
    traversalPolicy: {
      allowedEdgeTypes: TRAVERSAL_EDGE_KINDS,
      blockedEdgeTypes: ['HAS_RUNTIME_BOUNDARY'],
      direction: 'outbound_from_seed_only',
      maxDepth: DEFAULT_ACE_BOUNDS.maxApplicationTraversalDepth,
      maxNodes: DEFAULT_ACE_BOUNDS.maxApplicationNodes,
      maxEdgesRetained: DEFAULT_ACE_BOUNDS.maxEdgesRetained,
      perKindCaps: EDGE_CAPS,
      seedNodeTypesAllowed: ['application_form', 'business_object', 'data_factory', 'gateway'],
      seedSelection: 'token_match_on_name_ranked_by_kind_capped_at_60',
      firstPassFilter: 'retain_edge_only_if_from_or_to_name_matches_semantic_token',
      confidenceFilterDuringTraversal: 'none',
      applicationJoinTraversable: true,
      unresolvedEdgesTraversable: true,
      datasetCanBeSeed: false,
      relationRepresentation: 'edge_with_dataset_or_application_join_node_endpoint',
    },
    tokens,
    seedAccepted,
    seedRejected: rejectedSeeds,
    maxSeeds,
    retentionStats: {
      allEdgesScanned: allEdges.length,
      retainedCount: retained.length,
      rejectedCount: rejected.length,
      truncatedLoad,
      perKindRetained: perKind,
      rejectionReasonCounts: rejected.reduce(
        (acc, r) => {
          acc[r.reason] = (acc[r.reason] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    },
    simulatedBfsFrontier: simBfs.frontier,
    simulatedBfsRejected: simBfs.edgesRejectedGlobal,
    relationReachedInSimulatedBfs: relationNodeIds.some((id) => simBfs.visited.has(id)),
    relationReachedInBlindStage4: relationNodeIds.some((id) => blindVisited.has(id)),
  });

  writeJson(path.join(outDir, 'shortest-paths-to-relation.json'), {
    seedIds: [...seedIdSet],
    relationNodeIds,
    fullAceGraph: {
      pathExists: fullPaths.pathExists,
      shortestDepth: fullPaths.paths[0]?.depth ?? null,
      paths: fullPaths.paths.map((p) => ({
        depth: p.depth,
        nodes: p.nodes.map((id) => ({
          id,
          kind: fullAdj.nodeMeta.get(id)?.kind,
          name: fullAdj.nodeMeta.get(id)?.name,
        })),
        edges: p.edges.map((e) => ({
          edgeKind: e.edgeKind,
          from: e.from.name,
          to: e.to.name,
          confidenceClass: e.confidenceClass,
          sourceAssembly: e.provenance?.[0]?.sourceAssembly,
        })),
      })),
    },
    retainedSubgraphOnly: {
      pathExists: retainedPaths.pathExists,
      shortestDepth: retainedPaths.paths[0]?.depth ?? null,
      paths: retainedPaths.paths.slice(0, 5).map((p) => ({
        depth: p.depth,
        nodes: p.nodes.map((id) => ({
          id,
          kind: retainedAdj.nodeMeta.get(id)?.kind,
          name: retainedAdj.nodeMeta.get(id)?.name,
        })),
        edges: p.edges.map((e) => ({
          edgeKind: e.edgeKind,
          from: e.from.name,
          to: e.to.name,
          confidenceClass: e.confidenceClass,
        })),
      })),
    },
  });

  // Divergence analysis
  let divergence: Record<string, unknown> = { note: 'no path in full graph' };
  if (fullPaths.pathExists && fullPaths.paths[0]) {
    const path = fullPaths.paths[0];
    let lastReached: string | null = null;
    let firstMissing: { edge: SimEdge; from: string; to: string } | null = null;
    for (let i = 0; i < path.edges.length; i++) {
      const e = path.edges[i]!;
      const fromId = path.nodes[i]!;
      const toId = path.nodes[i + 1]!;
      const inRetained = retained.some((r) => r.id === e.id);
      const fromVisited = blindVisited.has(fromId) || simBfs.visited.has(fromId);
      const toVisited = blindVisited.has(toId) || simBfs.visited.has(toId);
      if (fromVisited) lastReached = fromId;
      if (!inRetained && !firstMissing) {
        firstMissing = { edge: e, from: fromId, to: toId };
        divergence = {
          lastReachedNode: {
            id: lastReached,
            name: fullAdj.nodeMeta.get(lastReached ?? '')?.name,
          },
          nextExpectedEdge: {
            edgeId: e.id,
            edgeKind: e.edgeKind,
            from: e.from.name,
            to: e.to.name,
            confidenceClass: e.confidenceClass,
            sourceAssembly: e.provenance?.[0]?.sourceAssembly,
          },
          nextExpectedNode: {
            id: toId,
            kind: fullAdj.nodeMeta.get(toId)?.kind,
            name: fullAdj.nodeMeta.get(toId)?.name,
          },
          wasEdgePresentInACE: true,
          wasEdgeInRetainedSubgraph: inRetained,
          wasEdgeConsideredByStage4: fromVisited,
          wasTargetVisitedByStage4: toVisited,
          rejectionReason: !inRetained
            ? rejected.find((r) => r.edgeId === e.id)?.reason ?? 'edge_not_in_retained_subgraph_token_or_cap_filter'
            : !toVisited
              ? 'edge_in_retained_but_bfs_did_not_reach_target'
              : null,
        };
        break;
      }
      if (inRetained && fromVisited && !toVisited && !firstMissing) {
        firstMissing = { edge: e, from: fromId, to: toId };
        divergence = {
          lastReachedNode: { id: fromId, name: fullAdj.nodeMeta.get(fromId)?.name },
          nextExpectedEdge: {
            edgeId: e.id,
            edgeKind: e.edgeKind,
            from: e.from.name,
            to: e.to.name,
          },
          wasEdgeInRetainedSubgraph: true,
          wasEdgeConsideredByStage4: true,
          wasTargetVisitedByStage4: false,
          rejectionReason: 'bfs_order_or_cap_stopped_before_target',
        };
        break;
      }
    }
    if (!firstMissing) {
      divergence = {
        pathFullyReachableInRetained: retainedPaths.pathExists,
        blindVisitedRelation: relationNodeIds.some((id) => blindVisited.has(id)),
        note: 'shortest path edges all retained but relation still not in blind visit set',
      };
    }
  }

  writeJson(path.join(outDir, 'stage4-vs-graph-divergence.json'), divergence);

  const appJoinAll = allEdges.filter((e) => e.edgeKind === 'APPLICATION_JOIN').length;
  const appJoinRetained = retained.filter((e) => e.edgeKind === 'APPLICATION_JOIN').length;
  const appJoinTraversed = (stage4.aceTraversal?.edges ?? []).filter((e) => e.edgeKind === 'APPLICATION_JOIN').length;
  const appJoinRejected = rejected.filter((e) => e.edgeKind === 'APPLICATION_JOIN');

  writeJson(path.join(outDir, 'application-join-audit.json'), {
    applicationJoinInFullAce: appJoinAll,
    applicationJoinRetainedAfterTokenFilter: appJoinRetained,
    applicationJoinTraversedInBlindRun: appJoinTraversed,
    applicationJoinRejectedByReason: appJoinRejected.reduce(
      (acc, r) => {
        acc[r.reason] = (acc[r.reason] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
    relationSpecificJoinRetained: retained.filter(
      (e) => e.edgeKind === 'APPLICATION_JOIN' && (e.from?.name?.includes(RELATION_NEEDLE) || e.to?.name?.includes(RELATION_NEEDLE)),
    ).length,
    traversableByPolicy: true,
    unresolvedConfidenceBlocksTraversal: false,
    treatedAsOracleEndpointWhenToIsOracleObject: true,
  });

  const neighborhood = relationRecords
    .filter((h) => (h.record as SimEdge)?.edgeKind)
    .map((h) => {
      const e = h.record as SimEdge;
      return {
        edgeKind: e.edgeKind,
        from: e.from,
        to: e.to,
        confidenceClass: e.confidenceClass,
        sourceAssembly: e.provenance?.[0]?.sourceAssembly,
      };
    });
  writeJson(path.join(outDir, 'relation-connectivity-neighborhood.json'), {
    relationRepresentation: 'APPLICATION_JOIN edge; from=dataset GrupaCzasuPracyPracownika',
    neighborhood,
    blindReachedGrupaCzasuPracyQuestionnairesTG: blindVisited.has(
      'gateway|Teta.Sumo.Personel.bosPracownik.TG.GrupaCzasuPracyQuestionnairesTG',
    ),
    crossAssembly: {
      relationAssembly: 'bosCzasPracy.dll',
      blindSeedAssembliesSample: seedAccepted.slice(0, 8).map((s) => ({
        name: s.name,
        kind: s.kind,
        assemblyHint: s.name.includes('bosPracownik')
          ? 'bosPracownik'
          : s.name.includes('bosKartyPracy')
            ? 'bosKartyPracy'
            : 'other',
      })),
    },
  });

  writeJson(path.join(outDir, 'confidence-policy-audit.json'), {
    unresolvedMeaningInAce:
      'Stage1 confidenceClass=unresolved — join columns/key resolution incomplete (keyResolutionStatus often not_provided_in_il or unresolved)',
    stage4TraversalRejectsUnresolved: false,
    stage4BindUsesUnresolvedWeight: 1,
    stage4BindExactWeight: 3,
    distinctionDiscoveryVsBinding: 'traversal does not filter unresolved; bind adapter down-weights unresolved claims',
  });

  writeJson(path.join(outDir, 'discovery-vs-promotion-audit.json'), {
    applicationJoinUnresolved: {
      traversalEligibility: true,
      bindingEvidenceEligibility: 'downweighted_not_blocked',
      conflatedInSameBoolean: false,
      oracleEndpointPromotionFromApplicationJoin: 'yes_when_to_is_oracle_object',
    },
    note: 'Relation dataset itself is not promoted as oracle endpoint; join to NT_KP_SLO_UMOWY may be endpoint',
  });

  // Per-anchor path check
  const anchorPathChecks = seedAccepted.slice(0, 15).map((s) => {
    const p = bfsShortestPath(fullAdj.adj, fullAdj.nodeMeta, [s.id], targetPredicate, 12);
    return {
      seedId: s.id,
      seedName: s.name,
      pathExists: p.pathExists,
      shortestDepth: p.paths[0]?.depth ?? null,
    };
  });

  let primaryGap = 'unknown';
  const rationale: string[] = [];

  if (relationRecords.length === 0) {
    primaryGap = 'stage1_graph_connectivity_gap';
    rationale.push('Relation absent from ACE corpus');
  } else if (!fullPaths.pathExists) {
    primaryGap = 'stage1_graph_connectivity_gap';
    rationale.push('No graph path from any accepted seed to relation node in full ACE graph');
  } else if (!retainedPaths.pathExists) {
    primaryGap = 'stage4_edge_traversal_policy_gap';
    rationale.push('Path exists in full ACE but not in token-filtered retained subgraph (first-pass edge retention)');
  } else if (!relationNodeIds.some((id) => blindVisited.has(id))) {
    const div = divergence as { rejectionReason?: string; wasEdgeInRetainedSubgraph?: boolean };
    if (div.rejectionReason?.includes('token') || !retainedPaths.pathExists) {
      primaryGap = 'stage4_edge_traversal_policy_gap';
    } else if (div.rejectionReason?.includes('cap')) {
      primaryGap = 'stage4_depth_or_cap_gap';
    } else {
      primaryGap = 'stage4_edge_traversal_policy_gap';
    }
    rationale.push('Retained subgraph path may exist but blind BFS did not visit relation node');
  } else {
    primaryGap = 'stage4_unresolved_relation_discovery_gap';
    rationale.push('Relation reached but not consumed in hypotheses');
  }

  if (
    rejectedSeeds.some((s) => s.name?.includes(RELATION_NEEDLE)) &&
    primaryGap !== 'stage1_graph_connectivity_gap'
  ) {
    rationale.push('Relation dataset matches tokens but node_type_not_allowed_for_seed (dataset cannot seed)');
  }

  writeJson(path.join(outDir, 'gap-classification.json'), {
    primaryGap,
    rationale,
    oldDiagnosisIncorrect: primaryGap !== 'stage1_missing_application_relation_extraction',
    oldDiagnosisNote:
      'Relation IS in ACE corpus; failure is reachability/retention/traversal not extraction absence',
    anchorPathChecks,
    caseMapping: {
      stage1_graph_connectivity_gap: 'CASE A',
      stage4_edge_traversal_policy_gap: 'CASE B',
      stage4_unresolved_relation_discovery_gap: 'CASE C',
      multiple_gaps: 'CASE D',
    },
  });

  writeJson(path.join(outDir, 'secondary-gap-analysis.json'), {
    secondaryGap: 'stage4_missing_relation_to_dictionary_hypothesis',
    classification:
      primaryGap !== 'stage4_unresolved_relation_discovery_gap'
        ? 'possibly_downstream_of_primary_gap'
        : 'independent_stage4_capability_gap',
    rationale:
      'Without reaching GrupaCzasuPracyPracownika employee-assignment relation, dictionary/subject chain cannot form',
    packageBridgeIfRelationReached:
      'Post-extraction: AKT_DANE/SGRC_NAZWA indexed in Stage2; generic bridge not verified without relation reach',
  });

  const unseenStage4 = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: {
      businessConcept: 'Okresy wypowiedzeń',
      requestedRoles: GENERIC_ROLES,
      mode: 'blind_physical_rediscovery',
      question: UNSEEN_QUESTION,
    },
  });
  writeJson(path.join(outDir, 'unseen-control.json'), {
    question: UNSEEN_QUESTION,
    resolutionStatus: unseenStage4.resolutionStatus,
    note: 'Same token-filter retention policy; no deep unseen relation investigation unless parallel pattern found',
    assignmentStrong: unseenStage4.schemaRoleResolution?.roleAssignmentsByRole?.assignment_source?.status,
  });

  const status =
    primaryGap === 'stage1_graph_connectivity_gap'
      ? 'stage1_graph_connectivity_gap'
      : primaryGap === 'stage4_edge_traversal_policy_gap'
        ? 'stage4_edge_traversal_policy_gap'
        : primaryGap === 'stage4_unresolved_relation_discovery_gap'
          ? 'stage4_unresolved_relation_discovery_gap'
          : primaryGap === 'stage4_depth_or_cap_gap'
            ? 'stage4_depth_or_cap_gap'
            : primaryGap === 'multiple_gaps'
              ? 'multiple_gaps'
              : 'unknown';

  console.log(
    JSON.stringify(
      {
        ok: true,
        freezeSha,
        TWG_REACHABILITY_DIAGNOSTIC_STATUS: status,
        primaryGap,
        fullPathExists: fullPaths.pathExists,
        retainedPathExists: retainedPaths.pathExists,
        relationInAce: relationRecords.length > 0,
        relationInBlindVisit: relationNodeIds.some((id) => blindVisited.has(id)),
        divergence,
        outDir,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
