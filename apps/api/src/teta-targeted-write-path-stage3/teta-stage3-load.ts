/**
 * Target-driven streaming loaders for Stage 3.
 *
 * Never buffers the full Stage2 edges NDJSON (~807k lines) or the Stage1
 * ACE NDJSON as an in-memory array. Every loader here streams line-by-line
 * (readline) and only *retains* the small, target-scoped slice the analyzer
 * actually needs (WRITES_TO edges for one table, CALLS edges touching a
 * bounded set of writer packages, GATEWAY_HAS_DAC edges for those packages).
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import type { Stage3Confidence, Stage3Provenance } from './teta-stage3.types';

export type Stage3WriteEdge = {
  fromId: string;
  toId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE' | 'unknown';
  confidenceClass: Stage3Confidence;
  provenance: Stage3Provenance[];
};

export type Stage3CallEdgeRaw = {
  fromId: string;
  toId: string;
  confidenceClass: Stage3Confidence;
  provenance: Stage3Provenance[];
};

export type Stage3DacEdge = {
  gatewayName: string;
  dacPackageOwner: string;
  dacPackageName: string;
  provenance: Stage3Provenance;
};

export type Stage3WriterIdKind = 'PROGRAM_UNIT' | 'PACKAGE_BODY' | 'STANDALONE_OBJECT';

/** Resolve the package-scoped "unit of source" name for a Stage2 writer id. */
export function packageNameFromWriterId(id: string): string | null {
  if (id.startsWith('oracle-program-unit:')) {
    const parts = id.split(':');
    const pkg = parts[2] ?? null;
    return pkg && pkg !== '-' ? pkg : null;
  }
  if (id.startsWith('oracle-package-body:')) {
    const parts = id.split(':');
    return parts[2] ?? null;
  }
  if (id.startsWith('oracle-object:')) {
    const parts = id.split(':');
    // oracle-object:OWNER:TYPE:NAME — standalone function/procedure is its own unit.
    return parts[3] ?? null;
  }
  return null;
}

export function writerIdKind(id: string): Stage3WriterIdKind {
  if (id.startsWith('oracle-program-unit:')) return 'PROGRAM_UNIT';
  if (id.startsWith('oracle-package-body:')) return 'PACKAGE_BODY';
  return 'STANDALONE_OBJECT';
}

export function ownerFromWriterId(id: string): string | null {
  const parts = id.split(':');
  return parts[1] ?? null;
}

function mapStage2ConfidenceClass(raw: unknown): Stage3Confidence {
  switch (raw) {
    case 'exact_from_source':
      return 'exact_static';
    case 'strong_static_inference':
      return 'strong_static';
    case 'runtime_only':
      return 'runtime_only';
    default:
      return 'unresolved';
  }
}

function toStage3Provenance(
  sourcePath: string,
  extractionMechanism: string,
  rawValue: unknown,
  confidenceClass: Stage3Confidence,
  evidenceRefs: string[],
  sourceMember?: string | null,
): Stage3Provenance {
  return {
    sourceKind: 'stage2_edges_ndjson',
    sourcePath,
    sourceMember: sourceMember ?? null,
    extractionMechanism,
    rawValue: rawValue == null ? null : String(rawValue),
    normalizedValue: null,
    confidenceClass,
    evidenceRefs,
  };
}

async function forEachNdjsonLine(
  filePath: string,
  onLine: (row: Record<string, unknown>, rawLine: string) => void,
): Promise<number> {
  let lines = 0;
  if (!fs.existsSync(filePath)) return lines;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    lines += 1;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    onLine(row, line);
  }
  return lines;
}

/**
 * Streams the Stage2 oracle-source-edges NDJSON exactly once and builds a
 * WRITES_TO index keyed by target table/view id. When `targetIds` is
 * provided, only those keys are retained (target-driven — the analyzer
 * never needs the other ~4700 write targets for a single-target run).
 */
export async function streamLoadWritesToIndex(
  edgesPath: string,
  opts: { targetIds?: Set<string> } = {},
): Promise<{ index: Map<string, Stage3WriteEdge[]>; edgesScanned: number; linesScanned: number }> {
  const index = new Map<string, Stage3WriteEdge[]>();
  let edgesScanned = 0;
  const linesScanned = await forEachNdjsonLine(edgesPath, (row) => {
    if (row.edgeKind !== 'WRITES_TO') return;
    edgesScanned += 1;
    const toId = String(row.toId ?? '');
    if (opts.targetIds && !opts.targetIds.has(toId)) return;
    const fromId = String(row.fromId ?? '');
    const attrs = (row.attributes ?? {}) as Record<string, unknown>;
    const operation = ((attrs.operation as string) ?? 'unknown').toUpperCase() as
      | 'INSERT'
      | 'UPDATE'
      | 'DELETE'
      | 'MERGE'
      | 'UNKNOWN';
    const confidenceClass = mapStage2ConfidenceClass(row.confidenceClass);
    const rawProvenance = Array.isArray(row.provenance) ? row.provenance : [];
    const provenance: Stage3Provenance[] = rawProvenance.map((p) => {
      const pr = p as Record<string, unknown>;
      return toStage3Provenance(
        String(pr.sourcePath ?? edgesPath),
        String(pr.extractionMechanism ?? 'WRITES_TO'),
        pr.rawValue,
        mapStage2ConfidenceClass(pr.confidenceClass),
        Array.isArray(pr.evidenceRefs) ? (pr.evidenceRefs as string[]) : [],
      );
    });
    const edge: Stage3WriteEdge = {
      fromId,
      toId,
      operation: operation === 'UNKNOWN' ? 'unknown' : operation,
      confidenceClass,
      provenance: provenance.length
        ? provenance
        : [toStage3Provenance(edgesPath, 'WRITES_TO', null, confidenceClass, [])],
    };
    const list = index.get(toId);
    if (list) list.push(edge);
    else index.set(toId, [edge]);
  });
  return { index, edgesScanned, linesScanned };
}

/**
 * Streams the Stage2 edges NDJSON once and returns only CALLS edges whose
 * `toId` package matches one of `targetPackageNames` (i.e. calls *into* the
 * writer packages currently under analysis). Callers must run this once per
 * BFS depth level with the newly-discovered frontier package names.
 */
export async function streamFindCallEdgesToPackages(
  edgesPath: string,
  targetPackageNames: Set<string>,
): Promise<{ edges: Stage3CallEdgeRaw[]; edgesScanned: number }> {
  const edges: Stage3CallEdgeRaw[] = [];
  let edgesScanned = 0;
  if (targetPackageNames.size === 0) return { edges, edgesScanned };
  await forEachNdjsonLine(edgesPath, (row) => {
    if (row.edgeKind !== 'CALLS') return;
    const toId = String(row.toId ?? '');
    const pkg = packageNameFromWriterId(toId);
    if (!pkg || !targetPackageNames.has(pkg)) return;
    edgesScanned += 1;
    const fromId = String(row.fromId ?? '');
    const confidenceClass = mapStage2ConfidenceClass(row.confidenceClass);
    const rawProvenance = Array.isArray(row.provenance) ? row.provenance : [];
    const provenance: Stage3Provenance[] = rawProvenance.map((p) => {
      const pr = p as Record<string, unknown>;
      return toStage3Provenance(
        String(pr.sourcePath ?? edgesPath),
        String(pr.extractionMechanism ?? 'CALLS'),
        pr.rawValue,
        mapStage2ConfidenceClass(pr.confidenceClass),
        Array.isArray(pr.evidenceRefs) ? (pr.evidenceRefs as string[]) : [],
      );
    });
    edges.push({
      fromId,
      toId,
      confidenceClass,
      provenance: provenance.length
        ? provenance
        : [toStage3Provenance(edgesPath, 'CALLS', null, confidenceClass, [])],
    });
  });
  return { edges, edgesScanned };
}

/**
 * Streams the Stage1 ACE NDJSON once and returns GATEWAY_HAS_DAC_PACKAGE_REFERENCE
 * edges whose DAC package name matches one of `writerPackageNames`.
 */
export async function loadStage1DacEdges(
  acePath: string,
  writerPackageNames: Set<string>,
): Promise<{ edges: Stage3DacEdge[]; edgesScanned: number }> {
  const edges: Stage3DacEdge[] = [];
  let edgesScanned = 0;
  if (writerPackageNames.size === 0) return { edges, edgesScanned };
  const wanted = new Set([...writerPackageNames].map((n) => n.toUpperCase()));
  await forEachNdjsonLine(acePath, (row) => {
    if (row.edgeKind !== 'GATEWAY_HAS_DAC_PACKAGE_REFERENCE') return;
    const from = (row.from ?? {}) as Record<string, unknown>;
    const to = (row.to ?? {}) as Record<string, unknown>;
    const toName = String(to.name ?? '');
    const dot = toName.indexOf('.');
    if (dot < 0) return;
    const owner = toName.slice(0, dot).toUpperCase();
    const pkgName = toName.slice(dot + 1).toUpperCase();
    if (!wanted.has(pkgName)) return;
    edgesScanned += 1;
    const rawProvenance = Array.isArray(row.provenance) ? row.provenance : [];
    const pr = (rawProvenance[0] ?? {}) as Record<string, unknown>;
    edges.push({
      gatewayName: String(from.name ?? ''),
      dacPackageOwner: owner,
      dacPackageName: pkgName,
      provenance: toStage3Provenance(
        String(pr.sourceFile ?? acePath),
        String(pr.extractionMechanism ?? 'GATEWAY_HAS_DAC_PACKAGE_REFERENCE'),
        pr.rawValue,
        mapStage2ConfidenceClass(row.confidenceClass),
        Array.isArray(pr.evidenceRefs) ? (pr.evidenceRefs as string[]) : [],
      ),
    });
  });
  return { edges, edgesScanned };
}

export function defaultStage3Paths(repoRoot: string): { edgesPath: string; acePath: string } {
  return {
    edgesPath:
      process.env.TETA_TWP_STAGE3_EDGES_PATH?.trim() ||
      path.join(
        repoRoot,
        '.local',
        'oracle-source-index-stage2',
        'oracle-live',
        'oracle-source-edges-v1.ndjson',
      ),
    acePath:
      process.env.TETA_TWP_STAGE3_ACE_PATH?.trim() ||
      path.join(
        repoRoot,
        '.local',
        'application-code-graph-stage1',
        'application-code-graph-v2.ndjson',
      ),
  };
}
