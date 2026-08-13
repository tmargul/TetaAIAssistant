/**
 * Bounded Oracle lineage expansion — derived Stage4 state only.
 * Permitted hops: VIEW READS_FROM, exact JOINS_TO, exact application/lookup relations.
 * No REFERENCES/CALLS as semantic hops. No global dependency scan.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { stage2ObjectId } from '../teta-oracle-source-index-stage2/teta-stage2-parse';
import type { Stage2EdgeKind } from '../teta-oracle-source-index-stage2/teta-stage2.types';
import type { AceTraversalResult } from './teta-stage4-ace-traverse';
import type { OracleCandidate } from './teta-stage4-oracle-expand';

export type OracleLineageBounds = {
  maxOracleRelationDepth: number;
  maxOracleRelationObjects: number;
};

export const DEFAULT_ORACLE_LINEAGE_BOUNDS: OracleLineageBounds = {
  maxOracleRelationDepth: 1,
  maxOracleRelationObjects: 40,
};

export type LineageHop = {
  fromId: string;
  toId: string;
  edgeKind: 'READS_FROM' | 'JOINS_TO';
  alias: string | null;
  onClause: string | null;
  parsedPairs: Array<{
    leftAlias: string;
    leftColumn: string;
    rightAlias: string;
    rightColumn: string;
  }>;
  provenance: string[];
};

export type LineageObject = {
  oracleCanonicalId: string;
  owner: string;
  objectName: string;
  objectType: string;
  applicationReachability: 'direct_ace' | 'indirect_via_oracle_lineage';
  pathFromApplication: string[];
  hops: LineageHop[];
  depth: number;
};

export type LineageExpandResult = {
  oracleLineageObjectsReached: number;
  indirectApplicationOracleCandidates: number;
  maxOracleRelationDepthReached: number;
  oracleRelationNodesVisited: number;
  hops: LineageHop[];
  objects: LineageObject[];
  truncated: boolean;
  truncationReason: string | null;
};

function defaultEdgesPath(repoRoot: string): string {
  return (
    process.env.TETA_TWP_STAGE3_EDGES_PATH?.trim() ||
    path.join(
      repoRoot,
      '.local',
      'oracle-source-index-stage2',
      'oracle-live',
      'oracle-source-edges-v1.ndjson',
    )
  );
}

function parseObjectId(id: string): { owner: string; objectType: string; objectName: string } | null {
  const m = /^oracle-object:([^:]+):([^:]+):([^:]+)$/i.exec(id);
  if (!m) return null;
  return { owner: m[1]!.toUpperCase(), objectType: m[2]!.toUpperCase(), objectName: m[3]!.toUpperCase() };
}

function candidateIds(c: OracleCandidate): string[] {
  return [
    c.oracleCanonicalId,
    stage2ObjectId(c.owner, 'VIEW', c.objectName),
    stage2ObjectId(c.owner, 'TABLE', c.objectName),
  ];
}

/**
 * Expand ACE-reached Oracle candidates by one structural hop using Stage2 edges.
 */
export async function expandOracleLineage(input: {
  repoRoot: string;
  ace: AceTraversalResult;
  candidates: OracleCandidate[];
  bounds?: Partial<OracleLineageBounds>;
}): Promise<LineageExpandResult> {
  const bounds = { ...DEFAULT_ORACLE_LINEAGE_BOUNDS, ...input.bounds };
  const edgesPath = defaultEdgesPath(input.repoRoot);
  const seedIds = new Set<string>();
  const seedByBare = new Map<string, OracleCandidate>();
  for (const c of input.candidates) {
    for (const id of candidateIds(c)) seedIds.add(id);
    seedByBare.set(`${c.owner}.${c.objectName}`, c);
  }

  // Also seed APPLICATION_JOIN oracle endpoints from ACE (may lack GATEWAY_READS).
  for (const e of input.ace.edges) {
    if (e.edgeKind !== 'APPLICATION_JOIN' && e.edgeKind !== 'GATEWAY_JOINS_ORACLE_OBJECT') continue;
    const name = e.toName?.replace(/^oracle_object\|/i, '') ?? '';
    const m = /^([A-Z0-9_$#]+)\.([A-Z0-9_$#]+)$/i.exec(name.trim());
    if (!m) continue;
    const owner = m[1]!.toUpperCase();
    const objectName = m[2]!.toUpperCase();
    seedIds.add(stage2ObjectId(owner, 'VIEW', objectName));
    seedIds.add(stage2ObjectId(owner, 'TABLE', objectName));
  }

  const hops: LineageHop[] = [];
  const objects = new Map<string, LineageObject>();
  let truncated = false;
  let truncationReason: string | null = null;
  let nodesVisited = 0;
  let maxDepth = 0;

  if (!fs.existsSync(edgesPath) || seedIds.size === 0) {
    return {
      oracleLineageObjectsReached: 0,
      indirectApplicationOracleCandidates: 0,
      maxOracleRelationDepthReached: 0,
      oracleRelationNodesVisited: 0,
      hops: [],
      objects: [],
      truncated: !fs.existsSync(edgesPath),
      truncationReason: !fs.existsSync(edgesPath) ? 'stage2_edges_missing' : 'no_seed_ids',
    };
  }

  const nameNeedles = [
    ...new Set(
      [...seedIds]
        .map((id) => parseObjectId(id)?.objectName)
        .filter((n): n is string => Boolean(n)),
    ),
  ];

  const rl = readline.createInterface({
    input: fs.createReadStream(edgesPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (objects.size >= bounds.maxOracleRelationObjects) {
      truncated = true;
      truncationReason = 'maxOracleRelationObjects';
      break;
    }
    const upper = line.toUpperCase();
    if (!nameNeedles.some((n) => upper.includes(n))) continue;
    if (!line.includes('READS_FROM') && !line.includes('JOINS_TO')) continue;
    let row: {
      edgeKind?: Stage2EdgeKind;
      fromId?: string;
      toId?: string;
      attributes?: {
        alias?: string | null;
        onClause?: string | null;
        parsedPairs?: Array<{
          leftAlias: string;
          leftColumn: string;
          rightAlias: string;
          rightColumn: string;
        }>;
      };
      provenance?: Array<{ extractionMechanism?: string; sourcePath?: string; normalizedSourceHash?: string }>;
    };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const edgeKind = row.edgeKind;
    if (edgeKind !== 'READS_FROM' && edgeKind !== 'JOINS_TO') continue;
    const fromId = row.fromId ?? '';
    const toId = row.toId ?? '';
    if (!seedIds.has(fromId)) continue;
    // JOINS_TO without exact pairs are retained as unresolved hops only when depth allows inspection
    if (edgeKind === 'JOINS_TO') {
      const pairs = row.attributes?.parsedPairs ?? [];
      if (pairs.length === 0 && !row.attributes?.onClause) {
        // still record unresolved for diagnostics via hop with empty pairs
      }
    }
    nodesVisited += 1;
    const hop: LineageHop = {
      fromId,
      toId,
      edgeKind,
      alias: row.attributes?.alias ?? null,
      onClause: row.attributes?.onClause ?? null,
      parsedPairs: row.attributes?.parsedPairs ?? [],
      provenance: [
        `stage2:${edgeKind}:${fromId}->${toId}`,
        row.provenance?.[0]?.sourcePath ?? 'stage2_edges',
        row.provenance?.[0]?.normalizedSourceHash
          ? `sourceHash:${row.provenance[0].normalizedSourceHash}`
          : 'sourceHash:unknown',
        row.provenance?.[0]?.extractionMechanism
          ? `extraction:${row.provenance[0].extractionMechanism}`
          : 'extraction:stage2_edge',
      ],
    };
    hops.push(hop);

    const parsed = parseObjectId(toId);
    if (!parsed) continue;
    if (parsed.objectType !== 'VIEW' && parsed.objectType !== 'TABLE') continue;
    maxDepth = Math.max(maxDepth, 1);
    if (maxDepth > bounds.maxOracleRelationDepth) continue;

    const key = `${parsed.owner}.${parsed.objectName}`;
    if (seedByBare.has(key)) {
      // already ACE-direct
      if (!objects.has(toId)) {
        const seed = seedByBare.get(key)!;
        objects.set(toId, {
          oracleCanonicalId: toId,
          owner: parsed.owner,
          objectName: parsed.objectName,
          objectType: parsed.objectType,
          applicationReachability: 'direct_ace',
          pathFromApplication: seed.acePath,
          hops: [hop],
          depth: 0,
        });
      }
      continue;
    }
    if (objects.has(toId)) {
      objects.get(toId)!.hops.push(hop);
      continue;
    }
    const fromParsed = parseObjectId(fromId);
    const parent = fromParsed
      ? seedByBare.get(`${fromParsed.owner}.${fromParsed.objectName}`)
      : undefined;
    objects.set(toId, {
      oracleCanonicalId: toId,
      owner: parsed.owner,
      objectName: parsed.objectName,
      objectType: parsed.objectType,
      applicationReachability: 'indirect_via_oracle_lineage',
      pathFromApplication: [
        ...(parent?.acePath ?? [`oracle_object|${fromParsed?.owner}.${fromParsed?.objectName}`]),
        `lineage:${edgeKind}`,
        `oracle_object|${parsed.owner}.${parsed.objectName}`,
      ],
      hops: [hop],
      depth: 1,
    });
  }

  const list = [...objects.values()];
  return {
    oracleLineageObjectsReached: list.length,
    indirectApplicationOracleCandidates: list.filter(
      (o) => o.applicationReachability === 'indirect_via_oracle_lineage',
    ).length,
    maxOracleRelationDepthReached: maxDepth,
    oracleRelationNodesVisited: nodesVisited,
    hops,
    objects: list,
    truncated,
    truncationReason,
  };
}

/**
 * Collect APPLICATION_JOIN Oracle endpoints whose object name matches semantic
 * tokens (same filter ACE uses when retaining edges), even if BFS never visited
 * the parent dataset. Still application-token-bounded — not a global Oracle scan.
 */
export async function collectTokenMatchedApplicationJoinCandidates(input: {
  repoRoot: string;
  tokens: string[];
  existing: OracleCandidate[];
  maxExtra?: number;
}): Promise<OracleCandidate[]> {
  const acePath =
    process.env.TETA_ACE_GRAPH_PATH?.trim() ||
    path.join(
      input.repoRoot,
      '.local',
      'application-code-graph-stage1',
      'application-code-graph-v2.ndjson',
    );
  const tokens = input.tokens
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !/^(personel|personnel|module|teta|sumo)$/i.test(t));
  if (!fs.existsSync(acePath) || tokens.length === 0) return [];
  const have = new Set(input.existing.map((c) => `${c.owner}.${c.objectName}`));
  const out: OracleCandidate[] = [];
  const maxExtra = input.maxExtra ?? 12;
  const rl = readline.createInterface({
    input: fs.createReadStream(acePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (out.length >= maxExtra) break;
    if (!line.includes('APPLICATION_JOIN')) continue;
    const upper = line.toUpperCase();
    if (!tokens.some((t) => upper.includes(t.toUpperCase()))) continue;
    let row: {
      edgeKind?: string;
      from?: { name?: string };
      to?: { name?: string; kind?: string };
    };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.edgeKind !== 'APPLICATION_JOIN') continue;
    const toName = row.to?.name?.replace(/^oracle_object\|/i, '') ?? '';
    const m = /^([A-Z0-9_$#]+)\.([A-Z0-9_$#]+)$/i.exec(toName.trim());
    if (!m) continue;
    // Token must match the Oracle endpoint name (application concept → physical surface).
    const objectName = m[2]!.toUpperCase();
    if (!tokens.some((t) => objectName.includes(t.toUpperCase()))) continue;
    const owner = m[1]!.toUpperCase();
    const ref = `${owner}.${objectName}`;
    if (have.has(ref)) continue;
    have.add(ref);
    out.push({
      oracleCanonicalId: stage2ObjectId(owner, 'VIEW', objectName),
      owner,
      objectName,
      objectType: 'VIEW',
      reachedFromApplicationNode: row.from?.name ?? 'application_join_token_match',
      acePath: [row.from?.name ?? 'dataset', `oracle_object|${ref}`],
      aceEdgeKind: 'APPLICATION_JOIN',
      aceEdgeKinds: ['APPLICATION_JOIN'],
      candidateRoleHypotheses: ['assignment_source'],
      supportingEvidence: [
        'ace:APPLICATION_JOIN',
        'ace_edge:APPLICATION_JOIN',
        'applicationReachability:direct_ace_join',
        'seed:token_matched_application_join',
        `reached_from:${row.from?.name ?? 'unknown'}`,
      ],
      negativeEvidence: [],
      stage2Facts: {
        readsFrom: [],
        writesTo: [],
        calls: [],
        joinsTo: [],
        joinDetails: [],
        references: [],
      },
    });
  }
  return out;
}

/**
 * When an application-reached view reads base B, recover exact JOINS_TO pairs from
 * other Stage2 views that also READS_FROM B (shared-base structural evidence).
 */
export async function recoverJoinsViaSharedBaseLineage(input: {
  repoRoot: string;
  baseObjectRefs: string[];
  maxViews?: number;
  maxJoins?: number;
}): Promise<
  Array<{
    evidenceViewId: string;
    baseRef: string;
    toRef: string;
    fromColumn: string;
    toColumn: string;
    onClause: string | null;
    provenance: string[];
  }>
> {
  const edgesPath = defaultEdgesPath(input.repoRoot);
  if (!fs.existsSync(edgesPath) || input.baseObjectRefs.length === 0) return [];
  const baseIds = new Set<string>();
  const baseBare = new Set<string>();
  for (const ref of input.baseObjectRefs) {
    const [owner, name] = ref.split('.') as [string, string];
    if (!owner || !name) continue;
    baseBare.add(name.toUpperCase());
    baseIds.add(stage2ObjectId(owner, 'TABLE', name));
    baseIds.add(stage2ObjectId(owner, 'VIEW', name));
  }
  const readsByView = new Map<string, Set<string>>();
  const joinRows: Array<{
    fromId: string;
    toId: string;
    pairs: Array<{
      leftAlias: string;
      leftColumn: string;
      rightAlias: string;
      rightColumn: string;
    }>;
    onClause: string | null;
    provenance: string[];
  }> = [];

  // Pass 1: find views that READS_FROM our bases (name-needle filtered).
  {
    const rl = readline.createInterface({
      input: fs.createReadStream(edgesPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.includes('READS_FROM')) continue;
      const upper = line.toUpperCase();
      if (![...baseBare].some((n) => upper.includes(n))) continue;
      let row: { edgeKind?: string; fromId?: string; toId?: string };
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.edgeKind === 'READS_FROM' && row.fromId && row.toId && baseIds.has(row.toId)) {
        // Only sibling VIEW definitions — not program-unit READS_FROM.
        if (!/^oracle-object:[^:]+:VIEW:/i.test(row.fromId)) continue;
        const set = readsByView.get(row.fromId) ?? new Set();
        set.add(row.toId);
        readsByView.set(row.fromId, set);
      }
    }
  }

  // Prefer evidence views that also have JOINS_TO (stable structural neighbors).
  const preferred = [...readsByView.keys()].filter((id) => /DATA_SYNC|LSTN|_VW$/i.test(id));
  const orderedViews = [
    ...preferred,
    ...[...readsByView.keys()].filter((id) => !preferred.includes(id)),
  ].slice(0, input.maxViews ?? 12);

  const viewNeedles = orderedViews
    .map((id) => {
      const m = /:([^:]+)$/.exec(id);
      return m?.[1]?.toUpperCase() ?? null;
    })
    .filter((n): n is string => Boolean(n));

  if (process.env.TETA_DEBUG_SHARED_JOINS === '1') {
    // eslint-disable-next-line no-console
    console.error('[shared-joins]', {
      edgesPath,
      baseIds: [...baseIds],
      readsByView: readsByView.size,
      orderedViews: orderedViews.slice(0, 5),
      viewNeedles,
    });
  }

  // Pass 2: JOINS_TO from those evidence views (needle = view object names).
  if (viewNeedles.length) {
    const rl = readline.createInterface({
      input: fs.createReadStream(edgesPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.includes('JOINS_TO')) continue;
      const upper = line.toUpperCase();
      if (!viewNeedles.some((n) => upper.includes(n))) continue;
      let row: {
        edgeKind?: string;
        fromId?: string;
        toId?: string;
        attributes?: {
          onClause?: string | null;
          parsedPairs?: Array<{
            leftAlias: string;
            leftColumn: string;
            rightAlias: string;
            rightColumn: string;
          }>;
        };
        provenance?: Array<{ sourcePath?: string; normalizedSourceHash?: string }>;
      };
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.edgeKind !== 'JOINS_TO' || !row.fromId || !row.toId) continue;
      if (!readsByView.has(row.fromId)) continue;
      const pairs = row.attributes?.parsedPairs ?? [];
      if (!pairs.length) continue;
      joinRows.push({
        fromId: row.fromId,
        toId: row.toId,
        pairs,
        onClause: row.attributes?.onClause ?? null,
        provenance: [
          `stage2:JOINS_TO:${row.fromId}->${row.toId}`,
          row.provenance?.[0]?.sourcePath ?? 'stage2_edges',
          row.provenance?.[0]?.normalizedSourceHash
            ? `sourceHash:${row.provenance[0].normalizedSourceHash}`
            : 'sourceHash:unknown',
          'extraction:shared_base_lineage_join',
        ],
      });
    }
  }

  const out: Array<{
    evidenceViewId: string;
    baseRef: string;
    toRef: string;
    fromColumn: string;
    toColumn: string;
    onClause: string | null;
    provenance: string[];
  }> = [];
  const maxJoins = input.maxJoins ?? 40;
  for (const j of joinRows) {
    const bases = readsByView.get(j.fromId);
    if (!bases) continue;
    const toRef = stage2IdToObjectRef(j.toId);
    if (!toRef) continue;
    for (const baseId of bases) {
      const baseRef = stage2IdToObjectRef(baseId);
      if (!baseRef) continue;
      for (const pair of j.pairs) {
        out.push({
          evidenceViewId: j.fromId,
          baseRef,
          toRef,
          fromColumn: pair.leftColumn.toUpperCase(),
          toColumn: pair.rightColumn.toUpperCase(),
          onClause: j.onClause,
          provenance: [
            ...j.provenance,
            `sharedBase:${baseRef}`,
            `evidenceView:${j.fromId}`,
            `pair:${pair.leftAlias}.${pair.leftColumn}=${pair.rightAlias}.${pair.rightColumn}`,
          ],
        });
        if (out.length >= maxJoins) return out;
      }
    }
  }
  return out;
}

function stage2IdToObjectRef(id: string): string | null {
  const m = /^oracle-object:([^:]+):(?:VIEW|TABLE|UNKNOWN):([^:]+)$/i.exec(id);
  if (m) return `${m[1]!.toUpperCase()}.${m[2]!.toUpperCase()}`;
  return null;
}
