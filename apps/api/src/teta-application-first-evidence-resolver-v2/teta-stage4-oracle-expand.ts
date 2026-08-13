/**
 * OracleEvidenceExpander — bounded Stage 2 canonical index facts for ACE-reached endpoints.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { stage2ObjectId } from '../teta-oracle-source-index-stage2/teta-stage2-parse';
import type { Stage2EdgeKind, Stage2ObjectType } from '../teta-oracle-source-index-stage2/teta-stage2.types';
import type { AceTraversalResult } from './teta-stage4-ace-traverse';

export type Stage2JoinDetail = {
  fromId: string;
  toId: string;
  onClause: string | null;
  parsedPairs: Array<{
    leftAlias: string;
    leftColumn: string;
    rightAlias: string;
    rightColumn: string;
  }>;
  provenance: string[];
};

export type OracleCandidate = {
  oracleCanonicalId: string;
  owner: string;
  objectName: string;
  objectType: Stage2ObjectType | 'UNKNOWN';
  reachedFromApplicationNode: string;
  acePath: string[];
  aceEdgeKind: string;
  aceEdgeKinds: string[];
  candidateRoleHypotheses: string[];
  supportingEvidence: string[];
  negativeEvidence: string[];
  stage2Facts: {
    readsFrom: string[];
    writesTo: string[];
    calls: string[];
    joinsTo: string[];
    joinDetails: Stage2JoinDetail[];
    references: string[];
  };
};

export type OracleExpandResult = {
  oracleEndpointsReached: number;
  oracleCandidatesConsidered: number;
  stage2EvidenceItemsLoaded: number;
  candidates: OracleCandidate[];
  discoveryOrigin: 'application_first' | 'application_degraded' | 'oracle_structural_fallback';
  stage2EvidenceTypesConsumed: string[];
};

export type OracleExpandBounds = {
  maxOracleCandidates: number;
  maxEvidenceItems: number;
};

export const DEFAULT_ORACLE_BOUNDS: OracleExpandBounds = {
  maxOracleCandidates: 40,
  maxEvidenceItems: 2000,
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

function defaultInventoryPath(repoRoot: string): string {
  return (
    process.env.TETA_TWP_STAGE3_INVENTORY_PATH?.trim() ||
    path.join(
      repoRoot,
      '.local',
      'oracle-source-index-stage2',
      'oracle-live',
      'oracle-object-inventory-v1.ndjson',
    )
  );
}

export function parseOracleEndpointName(name: string): {
  owner: string;
  objectName: string;
} | null {
  const m = /^([A-Z0-9_$#]+)\.([A-Z0-9_$#]+)$/i.exec(name.trim());
  if (m) return { owner: m[1]!.toUpperCase(), objectName: m[2]!.toUpperCase() };
  if (/^[A-Z0-9_$#]+$/i.test(name.trim())) {
    return { owner: 'TETA_ADMIN', objectName: name.trim().toUpperCase() };
  }
  return null;
}

/**
 * Path-position role hypotheses only — never object-name prefixes.
 * Application path tokens such as Dic..., lookup, slownik mark a dictionary surface.
 */
function pathLooksLikeDictionarySurface(acePath: string[]): boolean {
  const blob = acePath.join('|').toLowerCase();
  return /(?:^|[.|_])(dic|lookup|slownik|dictionary|slowniki)(?:[.|_]|$)/i.test(blob) ||
    /dic[a-z]+|lookup[a-z]+|slownik/i.test(blob);
}

function oracleEndpointScore(ep: AceTraversalResult['oracleEndpoints'][number]): number {
  let s = 0;
  if (ep.edgeKind === 'GATEWAY_READS_FROM_ORACLE_OBJECT') s += 20;
  if (ep.edgeKind === 'LOOKUP_USES_OBJECT' || ep.edgeKind === 'GATEWAY_JOINS_ORACLE_OBJECT') s += 15;
  if (ep.acePath.some((p) => /personel/i.test(p))) s += 30;
  if (ep.acePath.some((p) => /production|produkcj|warehouse|gma|logist/i.test(p))) s -= 25;
  return s;
}

function hypothesizeRolesFromEdgeKinds(edgeKinds: string[], acePath: string[]): string[] {
  const roles: string[] = [];
  const dictSurface = pathLooksLikeDictionarySurface(acePath);
  for (const aceEdgeKind of edgeKinds) {
    if (aceEdgeKind === 'GATEWAY_READS_FROM_ORACLE_OBJECT') {
      if (dictSurface) roles.push('dictionary_identity', 'dictionary_display_name');
      else roles.push('assignment_source');
    }
    if (aceEdgeKind === 'LOOKUP_USES_OBJECT') {
      roles.push('dictionary_identity', 'dictionary_display_name');
    }
    if (aceEdgeKind === 'GATEWAY_JOINS_ORACLE_OBJECT') {
      roles.push('dictionary_identity');
    }
    if (aceEdgeKind === 'APPLICATION_JOIN') {
      // Path-position only: non-dictionary surfaces joined from application datasets
      // are assignment/source candidates; dictionary surfaces stay dictionary roles.
      if (dictSurface) roles.push('dictionary_identity');
      else roles.push('assignment_source');
    }
  }
  return [...new Set(roles)];
}

/**
 * Expand Stage 2 evidence for Oracle endpoints reached via ACE.
 * Does NOT scan full corpus — streams edges filtered by target/from id sets.
 */
export async function expandOracleEvidence(input: {
  repoRoot: string;
  ace: AceTraversalResult;
  bounds?: Partial<OracleExpandBounds>;
}): Promise<OracleExpandResult> {
  const bounds = { ...DEFAULT_ORACLE_BOUNDS, ...input.bounds };
  const endpoints = [...input.ace.oracleEndpoints]
    .sort((a, b) => oracleEndpointScore(b) - oracleEndpointScore(a))
    .slice(0, bounds.maxOracleCandidates);
  if (endpoints.length === 0) {
    return {
      oracleEndpointsReached: 0,
      oracleCandidatesConsidered: 0,
      stage2EvidenceItemsLoaded: 0,
      candidates: [],
      discoveryOrigin: input.ace.aceNodesVisited > 0 ? 'application_degraded' : 'oracle_structural_fallback',
      stage2EvidenceTypesConsumed: [],
    };
  }

  const inventoryPath = defaultInventoryPath(input.repoRoot);
  const typeByKey = new Map<string, Stage2ObjectType>();
  if (fs.existsSync(inventoryPath)) {
    const rl = readline.createInterface({
      input: fs.createReadStream(inventoryPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let row: { owner?: string; objectName?: string; object_name?: string; objectType?: string; object_type?: string };
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const owner = String(row.owner ?? '').toUpperCase();
      const objectName = String(row.objectName ?? row.object_name ?? '').toUpperCase();
      const objectType = String(row.objectType ?? row.object_type ?? 'VIEW').toUpperCase() as Stage2ObjectType;
      if (!owner || !objectName) continue;
      typeByKey.set(`${owner}|${objectName}`, objectType);
    }
  }

  const candidates: OracleCandidate[] = [];
  const idSet = new Set<string>();
  for (const ep of endpoints) {
    const parsed = parseOracleEndpointName(ep.name);
    if (!parsed) continue;
    const objectType = typeByKey.get(`${parsed.owner}|${parsed.objectName}`) ?? 'VIEW';
    const oid = stage2ObjectId(parsed.owner, objectType, parsed.objectName);
    // Also try TABLE id variant for edge matching
    idSet.add(oid);
    idSet.add(stage2ObjectId(parsed.owner, 'TABLE', parsed.objectName));
    idSet.add(stage2ObjectId(parsed.owner, 'VIEW', parsed.objectName));
    const edgeKinds = ep.edgeKinds ?? [ep.edgeKind];
    candidates.push({
      oracleCanonicalId: oid,
      owner: parsed.owner,
      objectName: parsed.objectName,
      objectType,
      reachedFromApplicationNode: ep.reachedFromApplicationNode,
      acePath: ep.acePath,
      aceEdgeKind: ep.edgeKind,
      aceEdgeKinds: edgeKinds,
      candidateRoleHypotheses: hypothesizeRolesFromEdgeKinds(edgeKinds, ep.acePath),
      supportingEvidence: [
        `ace:${ep.edgeKind}`,
        ...edgeKinds.map((k) => `ace_edge:${k}`),
        `reached_from:${ep.reachedFromApplicationNode}`,
        ...ep.acePath.slice(0, 6).map((p) => `ace_path:${p}`),
      ],
      negativeEvidence: [],
      stage2Facts: { readsFrom: [], writesTo: [], calls: [], joinsTo: [], joinDetails: [], references: [] },
    });
  }

  const edgesPath = defaultEdgesPath(input.repoRoot);
  let stage2EvidenceItemsLoaded = 0;
  const typesConsumed = new Set<string>(['object_identity']);
  if (typeByKey.size > 0) typesConsumed.add('inventory_object_type');

  if (fs.existsSync(edgesPath) && idSet.size > 0) {
    // Precompute bare object-name needles for cheap line filter before JSON.parse
    const nameNeedles = [
      ...new Set(candidates.map((c) => c.objectName.toUpperCase())),
    ];
    const rl = readline.createInterface({
      input: fs.createReadStream(edgesPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (stage2EvidenceItemsLoaded >= bounds.maxEvidenceItems) break;
      const upper = line.toUpperCase();
      if (!nameNeedles.some((n) => upper.includes(n))) continue;
      if (!line.includes('edgeKind') && !line.includes('"kind"')) continue;
      let row: {
        edgeKind?: Stage2EdgeKind;
        kind?: string;
        fromId?: string;
        toId?: string;
        attributes?: {
          onClause?: string;
          parsedPairs?: Array<{
            leftAlias: string;
            leftColumn: string;
            rightAlias: string;
            rightColumn: string;
          }>;
        };
      };
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const edgeKind = row.edgeKind ?? (row.kind as Stage2EdgeKind | undefined);
      if (!edgeKind) continue;
      if (
        edgeKind !== 'READS_FROM' &&
        edgeKind !== 'WRITES_TO' &&
        edgeKind !== 'CALLS' &&
        edgeKind !== 'JOINS_TO' &&
        edgeKind !== 'REFERENCES'
      ) {
        continue;
      }
      const fromId = row.fromId ?? '';
      const toId = row.toId ?? '';
      if (!idSet.has(fromId) && !idSet.has(toId)) continue;
      stage2EvidenceItemsLoaded += 1;
      typesConsumed.add(edgeKind);
      for (const c of candidates) {
        const ids = [
          c.oracleCanonicalId,
          stage2ObjectId(c.owner, 'TABLE', c.objectName),
          stage2ObjectId(c.owner, 'VIEW', c.objectName),
        ];
        if (edgeKind === 'READS_FROM' && ids.includes(fromId)) {
          c.stage2Facts.readsFrom.push(toId);
          c.supportingEvidence.push(`stage2:READS_FROM:${toId}`);
        }
        if (edgeKind === 'WRITES_TO' && ids.includes(toId)) {
          c.stage2Facts.writesTo.push(fromId);
          c.supportingEvidence.push(`stage2:WRITES_TO_from:${fromId}`);
        }
        if (edgeKind === 'CALLS' && (ids.includes(fromId) || ids.includes(toId))) {
          c.stage2Facts.calls.push(`${fromId}->${toId}`);
        }
        if (edgeKind === 'JOINS_TO' && (ids.includes(fromId) || ids.includes(toId))) {
          c.stage2Facts.joinsTo.push(`${fromId}->${toId}`);
          c.supportingEvidence.push(`stage2:JOINS_TO:${fromId}->${toId}`);
          const pairs = row.attributes?.parsedPairs ?? [];
          c.stage2Facts.joinDetails.push({
            fromId,
            toId,
            onClause: row.attributes?.onClause ?? null,
            parsedPairs: pairs,
            provenance: [
              `stage2:JOINS_TO:${fromId}->${toId}`,
              row.attributes?.onClause ? `onClause:${row.attributes.onClause}` : 'onClause:absent',
            ],
          });
        }
        if (edgeKind === 'REFERENCES' && (ids.includes(fromId) || ids.includes(toId))) {
          c.stage2Facts.references.push(`${fromId}->${toId}`);
        }
      }
    }
  }

  // Negative: candidates without ACE reachability (should not happen here)
  for (const c of candidates) {
    if (!c.reachedFromApplicationNode) {
      c.negativeEvidence.push('no_application_reachability');
    }
  }

  return {
    oracleEndpointsReached: endpoints.length,
    oracleCandidatesConsidered: candidates.length,
    stage2EvidenceItemsLoaded,
    candidates,
    discoveryOrigin: 'application_first',
    stage2EvidenceTypesConsumed: [...typesConsumed],
  };
}
