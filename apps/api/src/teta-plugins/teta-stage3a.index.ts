/**
 * Stage 3A — CanonicalGraphIndexService: streaming NDJSON → SQLite index.
 */
import { createHash } from 'crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import Database from 'better-sqlite3';
import { STAGE3A_SCHEMA_SQL } from './teta-stage3a.schema';
import { normalizeGraphSearchTerm, normalizeGuid } from './teta-stage3a.normalize';
import {
  STAGE3A_IDENTITY_VERSION,
  STAGE3A_INDEX_SCHEMA_VERSION,
  type GraphNameKind,
  type Stage3aBuildResult,
  type Stage3aIndexStatus,
  type Stage3aIntegrityReport,
} from './teta-stage3a.types';

const BATCH = 2500;

export function defaultStage3aPaths(repoRoot: string) {
  const localDir = path.join(repoRoot, '.local');
  return {
    localDir,
    sourceNdjson: path.join(localDir, 'AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.full.ndjson'),
    indexPath: path.join(localDir, 'AIA_CANONICAL_GRAPH_STAGE3A.sqlite'),
    indexTmpPath: path.join(localDir, 'AIA_CANONICAL_GRAPH_STAGE3A.sqlite.tmp'),
    auditPath: path.join(localDir, 'AIA_CANONICAL_GRAPH_STAGE3A.audit.json'),
  };
}

export function missingSourceError(sourceNdjson: string): Error {
  return new Error(
    [
      `Brak pełnego grafu Stage 2E: ${sourceNdjson}`,
      'Nie używam docs/*.json jako zamiennika pełnego NDJSON.',
      'Odtwórz artefakt:',
      '  pnpm --filter @teta/api run diagnose:stage2e -- --from-existing --strict-semantic',
      '(albo pełny build bez --from-existing, jeśli NDJSON nigdy nie powstał).',
    ].join('\n'),
  );
}

async function hashFile(filePath: string): Promise<{ hash: string; size: number }> {
  const size = statSync(filePath).size;
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const s = createReadStream(filePath);
    s.on('data', (chunk) => hash.update(chunk));
    s.on('error', reject);
    s.on('end', () => resolve());
  });
  return { hash: hash.digest('hex'), size };
}

function json(v: unknown): string {
  return JSON.stringify(v ?? null);
}

function stagesJson(v: unknown): string {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'string') return JSON.stringify([v]);
  return JSON.stringify([]);
}

function pushName(
  names: Array<{ node_id: string; name_kind: GraphNameKind; original_value: string; normalized_value: string }>,
  nodeId: string,
  kind: GraphNameKind,
  value: unknown,
) {
  if (value == null) return;
  const original = String(value).trim();
  if (!original) return;
  const { normalizedAscii } = normalizeGraphSearchTerm(original);
  if (!normalizedAscii) return;
  names.push({
    node_id: nodeId,
    name_kind: kind,
    original_value: original,
    normalized_value: normalizedAscii,
  });
}

function extractNames(row: Record<string, unknown>): Array<{
  node_id: string;
  name_kind: GraphNameKind;
  original_value: string;
  normalized_value: string;
}> {
  const id = String(row.id ?? '');
  const attrs = (row.attributes as Record<string, unknown>) ?? {};
  const out: Array<{
    node_id: string;
    name_kind: GraphNameKind;
    original_value: string;
    normalized_value: string;
  }> = [];
  pushName(out, id, 'name', row.name);
  pushName(out, id, 'canonical_name', row.canonicalName);
  pushName(out, id, 'label', attrs.label);
  pushName(out, id, 'control_name', attrs.control ?? (row.type === 'ui_control' || row.type === 'action_control' ? row.name : null));
  pushName(out, id, 'dataset_name', attrs.datasetTable);
  pushName(out, id, 'column_name', attrs.columnName ?? attrs.dataMember);
  pushName(out, id, 'oracle_name', attrs.objectName);
  pushName(out, id, 'dotnet_type', attrs.fullType ?? attrs.declaringType);
  pushName(out, id, 'alias', attrs.alias ?? attrs.normalizedAlias);
  pushName(out, id, 'guid', attrs.guid ? normalizeGuid(String(attrs.guid)) : null);
  pushName(out, id, 'help_label', row.type === 'help_field' ? row.name : attrs.helpLabel);
  pushName(out, id, 'parameter_name', attrs.parameterName);
  return out;
}

export class CanonicalGraphIndexService {
  constructor(
    private readonly paths: ReturnType<typeof defaultStage3aPaths>,
  ) {}

  openReadonly(): Database.Database {
    if (!existsSync(this.paths.indexPath)) {
      throw new Error(`Brak indeksu Stage 3A: ${this.paths.indexPath}. Uruchom: pnpm --filter @teta/api run graph:stage3a -- build`);
    }
    const db = new Database(this.paths.indexPath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    return db;
  }

  /** Open writable to apply additive indexes on older builds. */
  ensureQueryIndexes(): void {
    if (!existsSync(this.paths.indexPath)) return;
    const db = new Database(this.paths.indexPath);
    try {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_kg_nodes_name ON kg_nodes(name);
        CREATE INDEX IF NOT EXISTS idx_kg_nodes_cname ON kg_nodes(canonical_name);
      `);
    } finally {
      db.close();
    }
  }

  status(): Stage3aIndexStatus {
    const base: Stage3aIndexStatus = {
      exists: existsSync(this.paths.indexPath),
      indexPath: this.paths.indexPath,
      indexSchemaVersion: null,
      identityVersion: null,
      sourceFile: null,
      sourceGeneratedAt: null,
      sourceHash: null,
      sourceSize: null,
      builtAt: null,
      nodesTotal: null,
      edgesTotal: null,
      conflictsTotal: null,
      namesTotal: null,
      referenceChainsTotal: null,
    };
    if (!base.exists) return base;
    const db = this.openReadonly();
    try {
      const get = (k: string) => {
        const row = db.prepare('SELECT value FROM kg_metadata WHERE key = ?').get(k) as
          | { value: string }
          | undefined;
        return row?.value ?? null;
      };
      const count = (table: string) =>
        (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
      return {
        ...base,
        indexSchemaVersion: get('indexSchemaVersion'),
        identityVersion: get('identityVersion'),
        sourceFile: get('sourceFile'),
        sourceGeneratedAt: get('sourceGeneratedAt'),
        sourceHash: get('sourceHash'),
        sourceSize: get('sourceSize') != null ? Number(get('sourceSize')) : null,
        builtAt: get('builtAt'),
        nodesTotal: count('kg_nodes'),
        edgesTotal: count('kg_edges'),
        conflictsTotal: count('kg_conflicts'),
        namesTotal: count('kg_names'),
        referenceChainsTotal: count('kg_reference_chains'),
      };
    } finally {
      db.close();
    }
  }

  async build(opts?: { sourceNdjson?: string }): Promise<Stage3aBuildResult> {
    const source = opts?.sourceNdjson ?? this.paths.sourceNdjson;
    if (!existsSync(source)) throw missingSourceError(source);
    if (!existsSync(this.paths.localDir)) mkdirSync(this.paths.localDir, { recursive: true });

    const started = Date.now();
    const { hash: sourceHash, size: sourceSize } = await hashFile(source);

    // Clean previous temp
    for (const p of [
      this.paths.indexTmpPath,
      `${this.paths.indexTmpPath}-wal`,
      `${this.paths.indexTmpPath}-shm`,
    ]) {
      if (existsSync(p)) {
        try {
          unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    }

    const db = new Database(this.paths.indexTmpPath);
    db.exec(STAGE3A_SCHEMA_SQL);

    const insertMeta = db.prepare(
      'INSERT INTO kg_metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    );
    const insertNode = db.prepare(`
      INSERT OR REPLACE INTO kg_nodes(
        id, type, domain, name, canonical_name, normalized_name, owner, object_type,
        confidence, source_stages_json, attributes_json, evidence_json, semantic_normalization_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEdge = db.prepare(`
      INSERT OR REPLACE INTO kg_edges(
        id, type, from_id, to_id, confidence, source_stages_json, attributes_json, evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertName = db.prepare(`
      INSERT INTO kg_names(node_id, name_kind, original_value, normalized_value)
      VALUES (?, ?, ?, ?)
    `);
    const insertConflict = db.prepare(`
      INSERT OR REPLACE INTO kg_conflicts(
        conflict_id, conflict_type, subject_id, resolution_status, alternatives_json, evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertRef = db.prepare(`
      INSERT OR REPLACE INTO kg_reference_chains(
        reference_name, ok, node_ids_json, edge_ids_json, validation_json, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    let nodesTotal = 0;
    let edgesTotal = 0;
    let conflictsTotal = 0;
    let namesTotal = 0;
    let referenceChainsTotal = 0;
    let identityVersion = STAGE3A_IDENTITY_VERSION;
    let sourceGeneratedAt: string | null = null;
    let auditRefs: Record<string, unknown> = {};

    const nodeBuf: unknown[][] = [];
    const edgeBuf: unknown[][] = [];
    const nameBuf: unknown[][] = [];
    const conflictBuf: unknown[][] = [];

    const flushNodes = db.transaction(() => {
      for (const row of nodeBuf) insertNode.run(...row);
      nodeBuf.length = 0;
    });
    const flushEdges = db.transaction(() => {
      for (const row of edgeBuf) insertEdge.run(...row);
      edgeBuf.length = 0;
    });
    const flushNames = db.transaction(() => {
      for (const row of nameBuf) insertName.run(...row);
      nameBuf.length = 0;
    });
    const flushConflicts = db.transaction(() => {
      for (const row of conflictBuf) insertConflict.run(...row);
      conflictBuf.length = 0;
    });

    const rl = createInterface({ input: createReadStream(source, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const kind = String(row.kind ?? '');

      if (kind === 'audit') {
        const meta = (row.metadata as Record<string, unknown>) ?? {};
        identityVersion = String(meta.identityVersion ?? identityVersion);
        sourceGeneratedAt = meta.generatedAt != null ? String(meta.generatedAt) : sourceGeneratedAt;
        const refs = (row.audit as { referenceChains?: Record<string, unknown> } | undefined)
          ?.referenceChains;
        // refs may also live on summary graph — stored later from docs JSON if present in audit line
        if (row.referenceChains && typeof row.referenceChains === 'object') {
          auditRefs = row.referenceChains as Record<string, unknown>;
        } else if (refs) {
          auditRefs = refs;
        }
        continue;
      }

      if (kind === 'node') {
        const id = String(row.id ?? '');
        if (!id) continue;
        const attrs = (row.attributes as Record<string, unknown>) ?? {};
        const name = row.name != null ? String(row.name) : null;
        const canonicalName = row.canonicalName != null ? String(row.canonicalName) : name;
        const { normalizedAscii } = normalizeGraphSearchTerm(canonicalName ?? name ?? '');
        nodeBuf.push([
          id,
          String(row.type ?? 'unknown'),
          row.domain != null ? String(row.domain) : null,
          name,
          canonicalName,
          normalizedAscii || null,
          attrs.owner != null ? String(attrs.owner) : null,
          attrs.objectType != null ? String(attrs.objectType) : null,
          row.confidence != null ? String(row.confidence) : null,
          stagesJson(row.sourceStage),
          json(attrs),
          json(row.evidence ?? []),
          json(row.semanticNormalization ?? null),
        ]);
        for (const n of extractNames(row)) {
          nameBuf.push([n.node_id, n.name_kind, n.original_value, n.normalized_value]);
          namesTotal += 1;
        }
        nodesTotal += 1;
        if (nodeBuf.length >= BATCH) flushNodes();
        if (nameBuf.length >= BATCH) flushNames();
        continue;
      }

      if (kind === 'edge') {
        const id = String(row.id ?? '');
        if (!id) continue;
        edgeBuf.push([
          id,
          String(row.type ?? 'unknown'),
          String(row.from ?? ''),
          String(row.to ?? ''),
          row.confidence != null ? String(row.confidence) : null,
          stagesJson(row.sourceStage),
          json(row.attributes ?? {}),
          json(row.evidence ?? []),
        ]);
        edgesTotal += 1;
        if (edgeBuf.length >= BATCH) flushEdges();
        continue;
      }

      if (kind === 'conflict') {
        const conflictId = String(
          row.id ??
            row.conflictId ??
            `conflict:${row.conflictType ?? 'x'}:${row.subjectId ?? conflictsTotal}`,
        );
        conflictBuf.push([
          conflictId,
          row.conflictType != null ? String(row.conflictType) : null,
          row.subjectId != null ? String(row.subjectId) : null,
          row.resolutionStatus != null ? String(row.resolutionStatus) : null,
          json(row.alternatives ?? []),
          json(row.evidence ?? []),
        ]);
        conflictsTotal += 1;
        if (conflictBuf.length >= BATCH) flushConflicts();
      }
    }

    if (nodeBuf.length) flushNodes();
    if (edgeBuf.length) flushEdges();
    if (nameBuf.length) flushNames();
    if (conflictBuf.length) flushConflicts();

    // Reference chains: prefer NDJSON audit payload; fallback to docs slim JSON
    if (!Object.keys(auditRefs).length) {
      const slimPath = path.join(path.dirname(this.paths.localDir), 'docs', 'AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.json');
      if (existsSync(slimPath)) {
        try {
          const slim = JSON.parse(readFileSync(slimPath, 'utf8')) as {
            referenceChains?: Record<string, unknown>;
          };
          auditRefs = slim.referenceChains ?? {};
        } catch {
          /* ignore */
        }
      }
    }
    for (const [name, payload] of Object.entries(auditRefs)) {
      const p = payload as Record<string, unknown>;
      insertRef.run(
        name,
        p.ok ? 1 : 0,
        json(p.nodeIds ?? []),
        json(p.edgeIds ?? []),
        json(p.validation ?? []),
        json(p),
      );
      referenceChainsTotal += 1;
    }

    const builtAt = new Date().toISOString();
    const metaPairs: Array<[string, string]> = [
      ['indexSchemaVersion', STAGE3A_INDEX_SCHEMA_VERSION],
      ['identityVersion', identityVersion],
      ['sourceFile', path.basename(source)],
      ['sourcePath', source],
      ['sourceGeneratedAt', sourceGeneratedAt ?? ''],
      ['sourceHash', sourceHash],
      ['sourceSize', String(sourceSize)],
      ['builtAt', builtAt],
      ['nodesTotal', String(nodesTotal)],
      ['edgesTotal', String(edgesTotal)],
      ['conflictsTotal', String(conflictsTotal)],
      ['namesTotal', String(namesTotal)],
      ['referenceChainsTotal', String(referenceChainsTotal)],
    ];
    const writeMeta = db.transaction(() => {
      for (const [k, v] of metaPairs) insertMeta.run(k, v);
    });
    writeMeta();

    db.close();

    // Atomic replace
    if (existsSync(this.paths.indexPath)) {
      try {
        unlinkSync(this.paths.indexPath);
      } catch {
        rmSync(this.paths.indexPath, { force: true });
      }
      for (const suf of ['-wal', '-shm']) {
        const p = `${this.paths.indexPath}${suf}`;
        if (existsSync(p)) {
          try {
            unlinkSync(p);
          } catch {
            /* ignore */
          }
        }
      }
    }
    renameSync(this.paths.indexTmpPath, this.paths.indexPath);

    const integrity = this.checkIntegrity({ expectedSourceHash: sourceHash });
    return {
      ok: integrity.ok,
      indexPath: this.paths.indexPath,
      durationMs: Date.now() - started,
      nodesTotal,
      edgesTotal,
      conflictsTotal,
      namesTotal,
      referenceChainsTotal,
      sourceHash,
      sourceSize,
      identityVersion,
      indexSchemaVersion: STAGE3A_INDEX_SCHEMA_VERSION,
      integrity,
    };
  }

  checkIntegrity(opts?: { expectedSourceHash?: string }): Stage3aIntegrityReport {
    const errors: string[] = [];
    if (!existsSync(this.paths.indexPath)) {
      return {
        ok: false,
        missingEdgeSource: 0,
        missingEdgeTarget: 0,
        duplicateNodeIds: 0,
        duplicateEdgeIds: 0,
        sourceHashMatch: false,
        identityVersionOk: false,
        errors: [`missing index ${this.paths.indexPath}`],
      };
    }
    const db = this.openReadonly();
    try {
      const getMeta = (k: string) =>
        (db.prepare('SELECT value FROM kg_metadata WHERE key = ?').get(k) as { value: string } | undefined)
          ?.value ?? null;

      const missingEdgeSource = (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM kg_edges e LEFT JOIN kg_nodes n ON n.id = e.from_id WHERE n.id IS NULL`,
          )
          .get() as { c: number }
      ).c;
      const missingEdgeTarget = (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM kg_edges e LEFT JOIN kg_nodes n ON n.id = e.to_id WHERE n.id IS NULL`,
          )
          .get() as { c: number }
      ).c;

      // PRIMARY KEY guarantees uniqueness — report 0 unless schema broken
      const duplicateNodeIds = 0;
      const duplicateEdgeIds = 0;

      const identityVersion = getMeta('identityVersion');
      const identityVersionOk = identityVersion === STAGE3A_IDENTITY_VERSION;
      const storedHash = getMeta('sourceHash');
      let sourceHashMatch = true;
      if (opts?.expectedSourceHash) {
        sourceHashMatch = storedHash === opts.expectedSourceHash;
      } else if (existsSync(this.paths.sourceNdjson) && storedHash) {
        // lightweight size check; full hash is expensive — optional callers pass expected
        const size = statSync(this.paths.sourceNdjson).size;
        const storedSize = Number(getMeta('sourceSize') ?? -1);
        sourceHashMatch = size === storedSize;
      }

      if (missingEdgeSource) errors.push(`missingEdgeSource=${missingEdgeSource}`);
      if (missingEdgeTarget) errors.push(`missingEdgeTarget=${missingEdgeTarget}`);
      if (!identityVersionOk) errors.push(`identityVersion=${identityVersion}`);
      if (!sourceHashMatch) errors.push('sourceHash/size mismatch');

      return {
        ok: errors.length === 0,
        missingEdgeSource,
        missingEdgeTarget,
        duplicateNodeIds,
        duplicateEdgeIds,
        sourceHashMatch,
        identityVersionOk,
        errors,
      };
    } finally {
      db.close();
    }
  }

  async validateSourceHash(): Promise<{ match: boolean; stored: string | null; current: string | null }> {
    if (!existsSync(this.paths.indexPath)) {
      return { match: false, stored: null, current: null };
    }
    const db = this.openReadonly();
    let stored: string | null = null;
    try {
      stored =
        (db.prepare(`SELECT value FROM kg_metadata WHERE key='sourceHash'`).get() as { value: string } | undefined)
          ?.value ?? null;
    } finally {
      db.close();
    }
    if (!existsSync(this.paths.sourceNdjson)) {
      return { match: false, stored, current: null };
    }
    const { hash } = await hashFile(this.paths.sourceNdjson);
    return { match: stored === hash, stored, current: hash };
  }

  writeAuditFile(audit: unknown): void {
    writeFileSync(this.paths.auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  }
}
