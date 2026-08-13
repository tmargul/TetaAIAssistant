/**
 * Candidate-scoped Stage 2 source enrichment.
 * Reuses Stage2 extractViewLineage / parseSimpleJoinOn and optional Oracle metadata provider.
 * Does not modify Stage2 corpus architecture. No global Oracle scan.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { OracleMetadataSourceProvider } from '../teta-oracle-source-index-stage2/teta-stage2-oracle-metadata-provider';
import { decryptSecret } from '../oracle/oracle-crypto';
import Database from 'better-sqlite3';
import type {
  EvidenceClaim,
  EvidenceObject,
  EvidenceRelation,
  SchemaEvidenceGraph,
} from '../teta-schema-role-resolution/teta-schema-role-resolution.types';
import {
  alignViewProjectionsWithSurface,
  extractViewLineage,
  extractViewProjectionLineage,
  parseCreateViewExplicitColumnList,
  preprocessSqlForStaticExtraction,
  sha256,
  stage2ObjectId,
  type ViewExposedColumnMetadata,
  type ViewProjectionFact,
} from '../teta-oracle-source-index-stage2/teta-stage2-parse';
import type { AceTraversalResult } from './teta-stage4-ace-traverse';
import type { OracleCandidate } from './teta-stage4-oracle-expand';
import {
  expandOracleLineage,
  recoverJoinsViaSharedBaseLineage,
  type LineageExpandResult,
  type LineageHop,
} from './teta-stage4-oracle-lineage';
import {
  classifySharedBaseTransfer,
  exposedViewColumnForBaseColumn,
  type RelationConfidence,
  type SharedBaseTransferAuditRow,
} from './teta-stage4-view-projection';

export type SourceEnrichmentMetrics = {
  candidateScopedSourceEnrichmentsRequested: number;
  candidateScopedSourceEnrichmentsSucceeded: number;
  candidateScopedSourceEnrichmentsFailed: number;
  viewSourcesFetched: number;
  plsqlSourcesFetched: number;
  aliasesResolved: number;
  aliasesUnresolved: number;
  relationFactsRecovered: number;
  exactColumnPairsRecovered: number;
  exactColumnPairsAccepted: number;
  exactColumnPairsRejected: number;
  temporalFactsRecovered: number;
  lookupFactsRecovered: number;
  exactColumnPairsUsed: number;
  unresolvedJoinPairsRejected: number;
  oracleLineageObjectsReached: number;
  indirectApplicationOracleCandidates: number;
  sourceObjectsFetched: number;
  oracleRelationNodesVisited: number;
  maxOracleRelationDepthReached: number;
  viewProjectionFactsRecovered: number;
  directProjectionFacts: number;
  aliasedProjectionFacts: number;
  expressionProjectionFacts: number;
  unresolvedProjectionFacts: number;
  projectionSourcesParsed: number;
  sharedBaseTransfersConsidered: number;
  sharedBaseTransfersExact: number;
  sharedBaseTransfersDowngraded: number;
  sharedBaseTransfersRejected: number;
  exactPairsBefore: number;
  exactPairsAfter: number;
  pairsDowngraded: number;
  sharedBaseOnlyPromotedToExact: number;
  viewColumnMetadataObjectsLoaded: number;
  viewColumnMetadataColumnsLoaded: number;
  projectionOrdinalAlignmentsAttempted: number;
  projectionOrdinalAlignmentsExact: number;
  projectionOrdinalAlignmentsRejected: number;
  projectionCountMismatches: number;
  projectionAliasMetadataConflicts: number;
  exposedViewColumnFactsRecovered: number;
};

export type CandidateEnrichmentFailureRow = {
  hypothesisId: string;
  candidateOracleObject: string;
  canonicalObjectId: string;
  objectType: string;
  applicationPath: string[];
  ACEEndpoint: string;
  sourceAvailable: boolean;
  sourceAcquisitionType: string | null;
  sourceObjectResolved: boolean;
  sourceHashAvailable: boolean;
  Stage2EdgesAvailable: {
    JOINS: number;
    READS_FROM: number;
    REFERENCES: number;
    WRITES_TO: number;
  };
  sourceFetchAttempted: boolean;
  sourceFetchSucceeded: boolean;
  parserInvoked: boolean;
  parserStatus: string | null;
  joinFactsFound: number;
  columnPairsFound: number;
  wherePredicatesFound: number;
  temporalPredicatesFound: number;
  lookupFactsFound: number;
  failureReason: string;
};

const TEMPORAL_PREDICATE = /\b(SYSDATE|CURRENT_DATE|TRUNC\s*\(\s*SYSDATE)\b/i;

function stage2IdToObjectRef(id: string): string | null {
  const m = /^oracle-object:([^:]+):(?:VIEW|TABLE|UNKNOWN):([^:]+)$/i.exec(id);
  if (m) return `${m[1]!.toUpperCase()}.${m[2]!.toUpperCase()}`;
  return null;
}

function emptyMetrics(): SourceEnrichmentMetrics {
  return {
    candidateScopedSourceEnrichmentsRequested: 0,
    candidateScopedSourceEnrichmentsSucceeded: 0,
    candidateScopedSourceEnrichmentsFailed: 0,
    viewSourcesFetched: 0,
    plsqlSourcesFetched: 0,
    aliasesResolved: 0,
    aliasesUnresolved: 0,
    relationFactsRecovered: 0,
    exactColumnPairsRecovered: 0,
    exactColumnPairsAccepted: 0,
    exactColumnPairsRejected: 0,
    temporalFactsRecovered: 0,
    lookupFactsRecovered: 0,
    exactColumnPairsUsed: 0,
    unresolvedJoinPairsRejected: 0,
    oracleLineageObjectsReached: 0,
    indirectApplicationOracleCandidates: 0,
    sourceObjectsFetched: 0,
    oracleRelationNodesVisited: 0,
    maxOracleRelationDepthReached: 0,
    viewProjectionFactsRecovered: 0,
    directProjectionFacts: 0,
    aliasedProjectionFacts: 0,
    expressionProjectionFacts: 0,
    unresolvedProjectionFacts: 0,
    projectionSourcesParsed: 0,
    sharedBaseTransfersConsidered: 0,
    sharedBaseTransfersExact: 0,
    sharedBaseTransfersDowngraded: 0,
    sharedBaseTransfersRejected: 0,
    exactPairsBefore: 0,
    exactPairsAfter: 0,
    pairsDowngraded: 0,
    sharedBaseOnlyPromotedToExact: 0,
    viewColumnMetadataObjectsLoaded: 0,
    viewColumnMetadataColumnsLoaded: 0,
    projectionOrdinalAlignmentsAttempted: 0,
    projectionOrdinalAlignmentsExact: 0,
    projectionOrdinalAlignmentsRejected: 0,
    projectionCountMismatches: 0,
    projectionAliasMetadataConflicts: 0,
    exposedViewColumnFactsRecovered: 0,
  };
}

function ensureObject(
  objects: EvidenceObject[],
  objectRef: string,
  extra?: Partial<EvidenceObject>,
): EvidenceObject {
  let o = objects.find((x) => x.objectRef === objectRef);
  if (!o) {
    const [owner, objectName] = objectRef.split('.') as [string, string];
    o = {
      objectRef,
      owner: owner ?? 'UNKNOWN',
      objectType: extra?.objectType ?? 'TABLE',
      objectName: objectName ?? objectRef,
      columns: [],
      tags: [],
    };
    objects.push(o);
  }
  if (extra?.tags?.length) {
    o.tags = [...new Set([...(o.tags ?? []), ...extra.tags])];
  }
  if (extra?.objectType) o.objectType = extra.objectType;
  return o;
}

function ensureColumn(
  obj: EvidenceObject,
  column: string,
  flags?: { isPk?: boolean; isFk?: boolean; references?: string },
): void {
  if (!obj.columns) obj.columns = [];
  let col = obj.columns.find((c) => c.name === column);
  if (!col) {
    col = { name: column };
    obj.columns.push(col);
  }
  if (flags?.isPk) col.isPk = true;
  if (flags?.isFk) col.isFk = true;
  if (flags?.references) col.references = flags.references;
}

/** Deterministic alias → object map from Stage2 READS_FROM/JOIN attributes + view lineage. */
export function resolveAliasMap(input: {
  viewOwner: string;
  viewObjectName: string;
  hops: LineageHop[];
  lineageReads?: Array<{
    alias: string | null;
    qualified: { owner: string | null; objectName: string; wasQualified: boolean };
  }>;
  lineageJoins?: Array<{
    alias: string | null;
    qualified: { owner: string | null; objectName: string; wasQualified: boolean };
  }>;
}): { resolved: Map<string, string>; unresolved: string[] } {
  const resolved = new Map<string, string>();
  const viewRef = `${input.viewOwner}.${input.viewObjectName}`;
  resolved.set(input.viewObjectName.toUpperCase(), viewRef);

  const add = (alias: string | null | undefined, owner: string, objectName: string) => {
    if (!alias) return;
    const a = alias.toUpperCase();
    if (a === 'WHERE' || a === 'SELECT' || a === 'FROM') return;
    resolved.set(a, `${owner}.${objectName}`);
  };

  for (const h of input.hops) {
    const toRef = stage2IdToObjectRef(h.toId);
    if (!toRef) continue;
    const [owner, objectName] = toRef.split('.') as [string, string];
    add(h.alias, owner, objectName);
    add(objectName, owner, objectName);
  }
  for (const r of input.lineageReads ?? []) {
    const owner =
      r.qualified.wasQualified && r.qualified.owner ? r.qualified.owner : input.viewOwner;
    add(r.alias, owner, r.qualified.objectName);
    add(r.qualified.objectName, owner, r.qualified.objectName);
  }
  for (const j of input.lineageJoins ?? []) {
    const owner =
      j.qualified.wasQualified && j.qualified.owner ? j.qualified.owner : input.viewOwner;
    add(j.alias, owner, j.qualified.objectName);
    add(j.qualified.objectName, owner, j.qualified.objectName);
  }
  return { resolved, unresolved: [] };
}

export function extractTemporalPredicatesFromSql(sql: string): Array<{
  leftExpression: string;
  operator: string;
  rightExpression: string;
  nullSemantics: string | null;
}> {
  const text = preprocessSqlForStaticExtraction(sql);
  const where = /\bWHERE\b([\s\S]*?)(?:\bGROUP\b|\bORDER\b|\bUNION\b|$)/i.exec(text);
  if (!where) return [];
  const clause = where[1] ?? '';
  const out: Array<{
    leftExpression: string;
    operator: string;
    rightExpression: string;
    nullSemantics: string | null;
  }> = [];
  const temporalCols = new Set<string>();
  const re =
    /([A-Z][A-Z0-9_$#.]*)\s*(>=|<=|<>|!=|>|<|=)\s*((?:TRUNC\s*\(\s*)?(?:SYSDATE|CURRENT_DATE)(?:\s*\))?|[A-Z][A-Z0-9_$#.]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clause))) {
    if (!TEMPORAL_PREDICATE.test(m[0]!) && !TEMPORAL_PREDICATE.test(m[3]!)) continue;
    const left = m[1]!.toUpperCase();
    temporalCols.add(left.includes('.') ? left.split('.').pop()! : left);
    out.push({
      leftExpression: left,
      operator: m[2]!,
      rightExpression: m[3]!.toUpperCase().replace(/\s+/g, ''),
      nullSemantics: null,
    });
  }
  // Open-ended validity: same column that participates in a SYSDATE compare may also be IS NULL.
  // Do not infer temporal meaning from column names alone.
  const nullEnded = /([A-Z][A-Z0-9_$#.]*)\s+IS\s+NULL/gi;
  while ((m = nullEnded.exec(clause))) {
    const left = m[1]!.toUpperCase();
    const bare = left.includes('.') ? left.split('.').pop()! : left;
    if (!temporalCols.has(bare) && !temporalCols.has(left)) continue;
    out.push({
      leftExpression: left,
      operator: 'IS',
      rightExpression: 'NULL',
      nullSemantics: 'open_ended_validity',
    });
  }
  return out;
}

function addRelation(
  relations: EvidenceRelation[],
  relSeen: Set<string>,
  rel: EvidenceRelation,
  metrics: SourceEnrichmentMetrics,
  confidence: RelationConfidence = 'exact_static',
): boolean {
  const key = `${rel.fromObject}|${rel.fromColumn}|${rel.toObject}|${rel.toColumn}|${rel.relationType}`;
  if (relSeen.has(key)) return false;
  relSeen.add(key);
  const provenance = [
    ...rel.provenance.filter((p) => !p.startsWith('confidence:')),
    `confidence:${confidence}`,
  ];
  relations.push({ ...rel, provenance });
  metrics.relationFactsRecovered += 1;
  if (
    confidence === 'exact_static' &&
    rel.fromColumn !== 'UNKNOWN' &&
    rel.toColumn !== 'UNKNOWN'
  ) {
    metrics.exactColumnPairsAccepted += 1;
    metrics.exactColumnPairsUsed += 1;
    metrics.exactPairsAfter += 1;
  } else if (confidence === 'strong_static') {
    metrics.pairsDowngraded += 1;
  } else if (confidence === 'unresolved') {
    metrics.exactColumnPairsRejected += 1;
  }
  return true;
}

function recordProjectionFacts(input: {
  assignmentRef: string;
  projections: ViewProjectionFact[];
  claims: EvidenceClaim[];
  metrics: SourceEnrichmentMetrics;
  sourceHash: string;
}): void {
  input.metrics.projectionSourcesParsed += 1;
  for (const p of input.projections) {
    input.metrics.viewProjectionFactsRecovered += 1;
    switch (p.projectionKind) {
      case 'direct_column':
      case 'qualified_direct_column':
        input.metrics.directProjectionFacts += 1;
        break;
      case 'aliased_direct_column':
        input.metrics.aliasedProjectionFacts += 1;
        break;
      case 'expression':
      case 'function_expression':
        input.metrics.expressionProjectionFacts += 1;
        break;
      default:
        input.metrics.unresolvedProjectionFacts += 1;
        break;
    }
    if (p.sourceObject && p.sourceColumn) {
      input.claims.push({
        family: 'oracle_structural',
        claimType: 'view_projection_lineage',
        object: input.assignmentRef,
        column: p.viewColumn,
        weight: 3,
        provenance: [
          'candidateScopedSourceEnrichment',
          `sourceView:${input.assignmentRef}`,
          `sourceHash:${input.sourceHash}`,
          `projects_from:${p.sourceObject}.${p.sourceColumn}`,
          `projectionKind:${p.projectionKind}`,
          `projectionExpression:${p.projectionExpression}`,
          ...(p.projectionConfidence ? [`confidence:${p.projectionConfidence}`] : []),
          ...(p.exposedColumnSource ? [`exposedColumnSource:${p.exposedColumnSource}`] : []),
        ],
      });
    }
  }
}

function pairsFromHop(
  hop: LineageHop,
  aliasMap: Map<string, string>,
  metrics: SourceEnrichmentMetrics,
): Array<{
  fromObject: string;
  fromColumn: string;
  toObject: string;
  toColumn: string;
  rejection?: string;
}> {
  const out: Array<{
    fromObject: string;
    fromColumn: string;
    toObject: string;
    toColumn: string;
    rejection?: string;
  }> = [];
  if (!hop.parsedPairs.length) {
    if (hop.onClause) {
      metrics.exactColumnPairsRejected += 1;
      metrics.unresolvedJoinPairsRejected += 1;
    }
    return out;
  }
  for (const pair of hop.parsedPairs) {
    metrics.exactColumnPairsRecovered += 1;
    const leftObj = aliasMap.get(pair.leftAlias.toUpperCase());
    const rightObj = aliasMap.get(pair.rightAlias.toUpperCase());
    if (!leftObj || !rightObj) {
      metrics.aliasesUnresolved += 1;
      metrics.exactColumnPairsRejected += 1;
      out.push({
        fromObject: leftObj ?? 'UNRESOLVED',
        fromColumn: pair.leftColumn.toUpperCase(),
        toObject: rightObj ?? 'UNRESOLVED',
        toColumn: pair.rightColumn.toUpperCase(),
        rejection: `alias_unresolved:${!leftObj ? pair.leftAlias : pair.rightAlias}`,
      });
      continue;
    }
    metrics.aliasesResolved += 2;
    out.push({
      fromObject: leftObj,
      fromColumn: pair.leftColumn.toUpperCase(),
      toObject: rightObj,
      toColumn: pair.rightColumn.toUpperCase(),
    });
  }
  return out;
}

function promoteAssignmentExactJoin(input: {
  assignmentRef: string;
  viewProjections: ViewProjectionFact[];
  sourceObject: string;
  sourceColumn: string;
  toObject: string;
  toColumn: string;
  relationType: string;
  provenance: string[];
  relations: EvidenceRelation[];
  relSeen: Set<string>;
  metrics: SourceEnrichmentMetrics;
  objects: EvidenceObject[];
  claims: EvidenceClaim[];
  dictRefs: Set<string>;
  subjectRefs: Set<string>;
}): boolean {
  const exposed =
    input.sourceObject.toUpperCase() === input.assignmentRef.toUpperCase()
      ? input.sourceColumn.toUpperCase()
      : exposedViewColumnForBaseColumn(
          input.viewProjections,
          input.sourceObject,
          input.sourceColumn,
        );
  if (!exposed) {
    input.metrics.exactColumnPairsRejected += 1;
    return false;
  }
  const prov = [
    ...input.provenance.filter((p) => !p.startsWith('confidence:')),
    `projectionExpose:${input.assignmentRef}.${exposed}<-${input.sourceObject}.${input.sourceColumn}`,
  ];
  const ok = addRelation(
    input.relations,
    input.relSeen,
    {
      fromObject: input.assignmentRef,
      fromColumn: exposed.toUpperCase(),
      toObject: input.toObject,
      toColumn: input.toColumn.toUpperCase(),
      relationType: input.relationType,
      family: 'oracle_structural',
      provenance: prov,
    },
    input.metrics,
    'exact_static',
  );
  if (ok) {
    tagJoinEndpoints(
      input.objects,
      input.claims,
      input.assignmentRef,
      input.assignmentRef,
      exposed.toUpperCase(),
      input.toObject,
      input.toColumn.toUpperCase(),
      input.dictRefs,
      input.subjectRefs,
      prov,
    );
  }
  return ok;
}

function tagJoinEndpoints(
  objects: EvidenceObject[],
  claims: EvidenceClaim[],
  assignmentRef: string,
  leftObj: string,
  leftCol: string,
  rightObj: string,
  rightCol: string,
  dictRefs: Set<string>,
  subjectRefs: Set<string>,
  provenance: string[],
): void {
  const left = ensureObject(objects, leftObj);
  const right = ensureObject(objects, rightObj);
  const assign = ensureObject(objects, assignmentRef, { tags: ['assignment_candidate'] });

  const leftIsDict = dictRefs.has(leftObj) || left.tags?.includes('dictionary_candidate');
  const rightIsDict = dictRefs.has(rightObj) || right.tags?.includes('dictionary_candidate');
  const leftIsSubj = subjectRefs.has(leftObj) || left.tags?.includes('subject');
  const rightIsSubj = subjectRefs.has(rightObj) || right.tags?.includes('subject');

  if (rightIsDict || leftIsDict) {
    const dictObj = rightIsDict ? right : left;
    const dictRef = rightIsDict ? rightObj : leftObj;
    const fromCol = rightIsDict ? leftCol : rightCol;
    const toCol = rightIsDict ? rightCol : leftCol;
    dictObj.tags = [...new Set([...(dictObj.tags ?? []), 'dictionary_candidate'])];
    ensureColumn(assign, fromCol, { isFk: true, references: dictRef });
    ensureColumn(dictObj, toCol, { isPk: true });
    claims.push({
      family: 'oracle_structural',
      claimType: 'dictionary_reference_relation',
      object: assignmentRef,
      column: fromCol,
      roleHint: 'dictionary_reference',
      weight: 3,
      provenance: [...provenance, `column:${fromCol}`, `dict:${dictRef}`],
    });
    claims.push({
      family: 'oracle_structural',
      claimType: 'dictionary_identity_via_join',
      object: dictRef,
      column: toCol,
      roleHint: 'dictionary_identity',
      weight: 3,
      provenance: [...provenance, `via_assignment:${assignmentRef}`],
    });
  }

  if (rightIsSubj || leftIsSubj) {
    const subjObj = rightIsSubj ? right : left;
    const subjRef = rightIsSubj ? rightObj : leftObj;
    const fromCol = rightIsSubj ? leftCol : rightCol;
    const toCol = rightIsSubj ? rightCol : leftCol;
    subjObj.tags = [...new Set([...(subjObj.tags ?? []), 'subject'])];
    ensureColumn(assign, fromCol, { isFk: true, references: subjRef });
    ensureColumn(subjObj, toCol, { isPk: true });
    claims.push({
      family: 'oracle_structural',
      claimType: 'subject_reference_relation',
      object: assignmentRef,
      column: fromCol,
      roleHint: 'subject_reference',
      weight: 3,
      provenance: [...provenance, `column:${fromCol}`, `subject:${subjRef}`],
    });
  }
}

async function tryFetchViewSources(input: {
  repoRoot: string;
  objects: Array<{ owner: string; objectName: string }>;
  maxFetches: number;
}): Promise<{
  sources: Map<string, { text: string; hash: string; method: string }>;
  viewColumnMetadata: Map<string, ViewExposedColumnMetadata[]>;
  attempted: number;
  succeeded: number;
  metadataSelects: number;
  fetchBoundaryReason: string | null;
}> {
  const sources = new Map<string, { text: string; hash: string; method: string }>();
  const viewColumnMetadata = new Map<string, ViewExposedColumnMetadata[]>();
  const mode = process.env.TETA_ORACLE_MODE?.trim().toLowerCase();
  if (mode !== 'real') {
    return {
      sources,
      viewColumnMetadata,
      attempted: 0,
      succeeded: 0,
      metadataSelects: 0,
      fetchBoundaryReason: 'TETA_ORACLE_MODE_not_real',
    };
  }
  const seen = new Set<string>();
  const targets: Array<{ owner: string; objectName: string }> = [];
  for (const t of input.objects) {
    const k = `${t.owner}.${t.objectName}`;
    if (seen.has(k)) continue;
    seen.add(k);
    targets.push(t);
    if (targets.length >= input.maxFetches) break;
  }
  if (targets.length === 0) {
    return {
      sources,
      viewColumnMetadata,
      attempted: 0,
      succeeded: 0,
      metadataSelects: 0,
      fetchBoundaryReason: 'no_fetch_targets',
    };
  }

  try {
    const dbPath = path.join(input.repoRoot, 'apps/api/data/teta.sqlite');
    if (!fs.existsSync(dbPath)) {
      return {
        sources,
        viewColumnMetadata,
        attempted: 0,
        succeeded: 0,
        metadataSelects: 0,
        fetchBoundaryReason: 'sqlite_profile_missing',
      };
    }
    const secret = process.env.JWT_SECRET?.trim();
    if (!secret || secret === 'change-me-in-production') {
      return {
        sources,
        viewColumnMetadata,
        attempted: 0,
        succeeded: 0,
        metadataSelects: 0,
        fetchBoundaryReason: 'JWT_SECRET_missing',
      };
    }
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .prepare(
          `SELECT mode, host, port, identifier_type, identifier, tns_alias, username, password_encrypted
           FROM oracle_connection WHERE id = 1`,
        )
        .get() as
        | {
            mode: string;
            host: string | null;
            port: number | null;
            identifier_type: string | null;
            identifier: string | null;
            tns_alias: string | null;
            username: string;
            password_encrypted: string;
          }
        | undefined;
      if (!row) {
        return {
          sources,
          viewColumnMetadata,
          attempted: 0,
          succeeded: 0,
          metadataSelects: 0,
          fetchBoundaryReason: 'oracle_connection_row_missing',
        };
      }
      const password = decryptSecret(row.password_encrypted, secret);
      let connectString: string;
      if (row.mode === 'tns') connectString = row.tns_alias?.trim() || '';
      else if (row.identifier_type === 'serviceName') {
        connectString = `${row.host}:${row.port ?? 1521}/${row.identifier}`;
      } else {
        connectString = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${row.host})(PORT=${row.port ?? 1521}))(CONNECT_DATA=(SID=${row.identifier})))`;
      }
      const allow = targets.map((t) => t.objectName.toUpperCase());
      const provider = new OracleMetadataSourceProvider(
        { user: row.username, password, connectString },
        {
          ownerFilter: [...new Set(targets.map((t) => t.owner))],
          objectNameAllowlist: allow,
          maxSourceObjects: allow.length,
          fetchArguments: false,
          fetchDependencies: false,
        },
      );
      await provider.open();
      try {
        await provider.listCapabilities();
        await provider.loadInventory();
        const colMeta = await provider.loadViewColumnMetadata(targets);
        for (const [key, cols] of colMeta) {
          viewColumnMetadata.set(key, cols);
        }
        let attempted = 0;
        let succeeded = 0;
        for await (const src of provider.iterateSources()) {
          attempted += 1;
          if (src.objectType !== 'VIEW') continue;
          const text = src.parserInputText || src.sourceText;
          if (!text?.trim()) continue;
          const key = `${src.owner}.${src.objectName}`;
          sources.set(key, {
            text,
            hash: src.sourceHash || sha256(text),
            method: src.sourceAcquisitionMethod ?? 'oracle_metadata',
          });
          succeeded += 1;
        }
        return {
          sources,
          viewColumnMetadata,
          attempted,
          succeeded,
          metadataSelects: provider.counters.oracleMetadataSelectStatementsExecuted,
          fetchBoundaryReason: succeeded === 0 ? 'view_sources_empty_after_fetch' : null,
        };
      } finally {
        await provider.close();
      }
    } finally {
      db.close();
    }
  } catch (e) {
    return {
      sources,
      viewColumnMetadata,
      attempted: targets.length,
      succeeded: 0,
      metadataSelects: 0,
      fetchBoundaryReason: `fetch_error:${String(e).slice(0, 200)}`,
    };
  }
}

function collectDictAndSubjectRefs(
  graph: SchemaEvidenceGraph,
  candidates: OracleCandidate[],
  ace?: AceTraversalResult,
): { dictRefs: Set<string>; subjectRefs: Set<string> } {
  const dictRefs = new Set<string>();
  const subjectRefs = new Set<string>();
  for (const o of graph.objects) {
    if (o.tags?.includes('dictionary_candidate')) dictRefs.add(o.objectRef);
    if (o.tags?.includes('subject')) subjectRefs.add(o.objectRef);
  }
  for (const c of candidates) {
    const ref = `${c.owner}.${c.objectName}`;
    if (c.candidateRoleHypotheses.includes('dictionary_identity')) dictRefs.add(ref);
  }
  if (ace) {
    for (const ep of ace.oracleEndpoints) {
      const name = ep.name.replace(/^oracle_object\|/i, '');
      const m = /^([A-Z0-9_$#]+)\.([A-Z0-9_$#]+)$/i.exec(name.trim());
      if (!m) continue;
      const ref = `${m[1]!.toUpperCase()}.${m[2]!.toUpperCase()}`;
      const kinds = ep.edgeKinds ?? [ep.edgeKind];
      // Dictionary surfaces reached via ACE lookup/join — no physical name hardcoding.
      if (
        kinds.includes('LOOKUP_USES_OBJECT') ||
        kinds.includes('GATEWAY_JOINS_ORACLE_OBJECT')
      ) {
        dictRefs.add(ref);
      }
    }
    for (const e of ace.edges) {
      if (e.edgeKind === 'LOOKUP_USES_OBJECT' || e.edgeKind === 'GATEWAY_JOINS_ORACLE_OBJECT') {
        const name = e.toName?.replace(/^oracle_object\|/i, '') ?? '';
        const m = /^([A-Z0-9_$#]+)\.([A-Z0-9_$#]+)$/i.exec(name.trim());
        if (m) dictRefs.add(`${m[1]!.toUpperCase()}.${m[2]!.toUpperCase()}`);
      }
    }
  }
  return { dictRefs, subjectRefs };
}

/**
 * Collect APPLICATION_JOIN Oracle endpoints from ACE that may be truncated out of
 * OracleEvidenceExpander's top-N GATEWAY_READS ranking. Not a global scan.
 */
export function collectAceApplicationJoinCandidates(
  ace: AceTraversalResult,
  existing: OracleCandidate[],
  maxExtra = 16,
): OracleCandidate[] {
  const have = new Set(existing.map((c) => `${c.owner}.${c.objectName}`));
  const out: OracleCandidate[] = [];
  const byName = new Map<string, { owner: string; objectName: string; path: string[]; from: string }>();
  for (const e of ace.edges) {
    if (e.edgeKind !== 'APPLICATION_JOIN') continue;
    const name = e.toName?.replace(/^oracle_object\|/i, '') ?? '';
    const m = /^([A-Z0-9_$#]+)\.([A-Z0-9_$#]+)$/i.exec(name.trim());
    if (!m) continue;
    const owner = m[1]!.toUpperCase();
    const objectName = m[2]!.toUpperCase();
    const ref = `${owner}.${objectName}`;
    if (have.has(ref)) continue;
    const path = [e.fromName, e.toName].filter(Boolean);
    byName.set(ref, {
      owner,
      objectName,
      path: path.length ? path : [e.fromName, e.toName],
      from: e.fromName,
    });
  }
  for (const ep of ace.oracleEndpoints) {
    const kinds = ep.edgeKinds ?? [ep.edgeKind];
    if (!kinds.includes('APPLICATION_JOIN')) continue;
    const name = ep.name.replace(/^oracle_object\|/i, '');
    const m = /^([A-Z0-9_$#]+)\.([A-Z0-9_$#]+)$/i.exec(name.trim());
    if (!m) continue;
    const owner = m[1]!.toUpperCase();
    const objectName = m[2]!.toUpperCase();
    const ref = `${owner}.${objectName}`;
    if (have.has(ref)) continue;
    byName.set(ref, {
      owner,
      objectName,
      path: ep.acePath,
      from: ep.reachedFromApplicationNode,
    });
  }
  for (const [ref, info] of byName) {
    if (out.length >= maxExtra) break;
    have.add(ref);
    out.push({
      oracleCanonicalId: stage2ObjectId(info.owner, 'VIEW', info.objectName),
      owner: info.owner,
      objectName: info.objectName,
      objectType: 'VIEW',
      reachedFromApplicationNode: info.from,
      acePath: info.path,
      aceEdgeKind: 'APPLICATION_JOIN',
      aceEdgeKinds: ['APPLICATION_JOIN'],
      candidateRoleHypotheses: ['assignment_source'],
      supportingEvidence: [
        'ace:APPLICATION_JOIN',
        'ace_edge:APPLICATION_JOIN',
        `reached_from:${info.from}`,
        ...info.path.slice(0, 6).map((p) => `ace_path:${p}`),
        'applicationReachability:direct_ace_join',
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

export async function enrichGraphForCandidates(input: {
  repoRoot: string;
  graph: SchemaEvidenceGraph;
  candidates: OracleCandidate[];
  ace?: AceTraversalResult;
  maxCandidates?: number;
  maxCandidateSourceFetches?: number;
  subjectRole?: string | null;
}): Promise<{
  graph: SchemaEvidenceGraph;
  metrics: SourceEnrichmentMetrics;
  failureRows: CandidateEnrichmentFailureRow[];
  lineage: LineageExpandResult;
  indirectCandidates: OracleCandidate[];
  fetchBoundaryReason: string | null;
  projectionFacts: ViewProjectionFact[];
  sharedBaseAuditRows: SharedBaseTransferAuditRow[];
}> {
  const metrics = emptyMetrics();
  const relations = [...input.graph.relations];
  const claims = [...input.graph.claims];
  const objects = [...input.graph.objects];
  const projectionFacts: ViewProjectionFact[] = [];
  const sharedBaseAuditRows: SharedBaseTransferAuditRow[] = [];
  const relSeen = new Set(
    relations.map(
      (r) => `${r.fromObject}|${r.fromColumn}|${r.toObject}|${r.toColumn}|${r.relationType}`,
    ),
  );
  const failureRows: CandidateEnrichmentFailureRow[] = [];
  const { dictRefs, subjectRefs } = collectDictAndSubjectRefs(
    input.graph,
    input.candidates,
    input.ace,
  );

  // Map physical bases → ACE dictionary / subject views (VIEW READS_FROM TABLE).
  const dictBaseToView = new Map<string, string>();
  const subjectBaseToView = new Map<string, string>();
  const subjectTokens = (input.subjectRole
    ? [input.subjectRole, 'employee', 'pracownik', 'pracownicy']
    : []
  )
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 4);
  const subjectViewRefs = new Set<string>();
  for (const c of input.candidates) {
    const ref = `${c.owner}.${c.objectName}`;
    const blob = `${c.objectName}|${c.acePath.join('|')}`.toLowerCase();
    if (subjectTokens.some((t) => blob.includes(t))) subjectViewRefs.add(ref);
  }
  for (const o of input.graph.objects) {
    if (o.tags?.includes('subject')) subjectViewRefs.add(o.objectRef);
  }
  {
    const edgesPath =
      process.env.TETA_TWP_STAGE3_EDGES_PATH?.trim() ||
      path.join(
        input.repoRoot,
        '.local',
        'oracle-source-index-stage2',
        'oracle-live',
        'oracle-source-edges-v1.ndjson',
      );
    const viewIds = new Set<string>();
    for (const ref of [...dictRefs, ...subjectViewRefs]) {
      const [owner, name] = ref.split('.') as [string, string];
      if (!owner || !name) continue;
      viewIds.add(stage2ObjectId(owner, 'VIEW', name));
      viewIds.add(stage2ObjectId(owner, 'TABLE', name));
    }
    if (fs.existsSync(edgesPath) && viewIds.size > 0) {
      const rl = readline.createInterface({
        input: fs.createReadStream(edgesPath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
      for await (const line of rl) {
        if (!line.includes('READS_FROM')) continue;
        let row: { edgeKind?: string; fromId?: string; toId?: string };
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        if (row.edgeKind !== 'READS_FROM' || !row.fromId || !row.toId) continue;
        if (!viewIds.has(row.fromId)) continue;
        const fromRef = stage2IdToObjectRef(row.fromId);
        const toRef = stage2IdToObjectRef(row.toId);
        if (!fromRef || !toRef) continue;
        if (dictRefs.has(fromRef) && !subjectViewRefs.has(fromRef)) {
          dictBaseToView.set(toRef, fromRef);
        }
        if (subjectViewRefs.has(fromRef)) subjectBaseToView.set(toRef, fromRef);
      }
    }
  }

  const ranked = input.candidates
    .filter((c) => c.candidateRoleHypotheses.includes('assignment_source'))
    .sort((a, b) => {
      const score = (c: OracleCandidate) =>
        (c.supportingEvidence.some((s) => s.includes('seed:token_matched_application_join'))
          ? 40
          : 0) +
        (c.acePath.some((p) => /personel/i.test(p)) ? 30 : 0) +
        (c.aceEdgeKinds?.includes('APPLICATION_JOIN') ? 20 : 0) +
        (c.aceEdgeKind === 'GATEWAY_READS_FROM_ORACLE_OBJECT' ? 10 : 0) -
        (c.acePath.some((p) => /production|produkcj|warehouse|gma|logist/i.test(p)) ? 40 : 0);
      return score(b) - score(a);
    });
  const assignmentCandidates = ranked.slice(0, input.maxCandidates ?? 24);
  for (const c of ranked) {
    if (!c.supportingEvidence.some((s) => s.includes('seed:token_matched_application_join'))) {
      continue;
    }
    if (
      assignmentCandidates.some(
        (x) => x.owner === c.owner && x.objectName === c.objectName,
      )
    ) {
      continue;
    }
    assignmentCandidates.push(c);
  }

  const emptyAce: AceTraversalResult = {
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

  const lineage = await expandOracleLineage({
    repoRoot: input.repoRoot,
    ace: input.ace ?? emptyAce,
    candidates: assignmentCandidates,
  });
  metrics.oracleLineageObjectsReached = lineage.oracleLineageObjectsReached;
  metrics.indirectApplicationOracleCandidates = lineage.indirectApplicationOracleCandidates;
  metrics.oracleRelationNodesVisited = lineage.oracleRelationNodesVisited;
  metrics.maxOracleRelationDepthReached = lineage.maxOracleRelationDepthReached;

  const hopsByFrom = new Map<string, LineageHop[]>();
  for (const h of lineage.hops) {
    const list = hopsByFrom.get(h.fromId) ?? [];
    list.push(h);
    hopsByFrom.set(h.fromId, list);
  }

  const fetchTargets: Array<{ owner: string; objectName: string }> = [];
  for (const c of assignmentCandidates) {
    if (c.objectType === 'VIEW' || c.objectType === 'UNKNOWN' || !c.objectType) {
      fetchTargets.push({ owner: c.owner, objectName: c.objectName });
    }
  }
  for (const o of lineage.objects) {
    if (o.objectType === 'VIEW') fetchTargets.push({ owner: o.owner, objectName: o.objectName });
  }

  const fetched = await tryFetchViewSources({
    repoRoot: input.repoRoot,
    objects: fetchTargets,
    maxFetches: input.maxCandidateSourceFetches ?? 16,
  });
  metrics.sourceObjectsFetched = fetched.succeeded;
  metrics.viewSourcesFetched = fetched.succeeded;
  metrics.viewColumnMetadataObjectsLoaded = fetched.viewColumnMetadata.size;
  metrics.viewColumnMetadataColumnsLoaded = [...fetched.viewColumnMetadata.values()].reduce(
    (n, cols) => n + cols.length,
    0,
  );

  const indirectCandidates: OracleCandidate[] = [];

  for (const cand of assignmentCandidates) {
    metrics.candidateScopedSourceEnrichmentsRequested += 1;
    const assignmentRef = `${cand.owner}.${cand.objectName}`;
    ensureObject(objects, assignmentRef, {
      objectType: cand.objectType === 'TABLE' ? 'TABLE' : 'VIEW',
      tags: ['assignment_candidate'],
    });
    const ids = [
      cand.oracleCanonicalId,
      stage2ObjectId(cand.owner, 'VIEW', cand.objectName),
      stage2ObjectId(cand.owner, 'TABLE', cand.objectName),
    ];
    const hops = ids.flatMap((id) => hopsByFrom.get(id) ?? []);
    const reads = hops.filter((h) => h.edgeKind === 'READS_FROM');
    const joins = hops.filter((h) => h.edgeKind === 'JOINS_TO');

    const source = fetched.sources.get(assignmentRef);
    let parserInvoked = false;
    let parserStatus: string | null = null;
    let joinFactsFound = joins.length;
    let columnPairsFound = joins.reduce((n, h) => n + h.parsedPairs.length, 0);
    let wherePredicatesFound = 0;
    let temporalPredicatesFound = 0;
    let recovered = 0;
    let viewProjections: ViewProjectionFact[] = [];

    const { resolved: aliasMap } = resolveAliasMap({
      viewOwner: cand.owner,
      viewObjectName: cand.objectName,
      hops,
    });

    for (const h of reads) {
      const toRef = stage2IdToObjectRef(h.toId);
      if (!toRef) continue;
      if (
        addRelation(
          relations,
          relSeen,
          {
            fromObject: assignmentRef,
            fromColumn: 'UNKNOWN',
            toObject: toRef,
            toColumn: 'UNKNOWN',
            relationType: 'view_lineage_reads_from',
            family: 'oracle_structural',
            provenance: [
              'candidateScopedSourceEnrichment',
              'applicationReachability:direct_ace',
              ...h.provenance,
            ],
          },
          metrics,
          'unresolved',
        )
      ) {
        recovered += 1;
      }
      ensureObject(objects, toRef, { tags: ['lineage_source'] });
    }

    for (const h of joins) {
      for (const pair of pairsFromHop(h, aliasMap, metrics)) {
        if (pair.rejection) continue;
        addRelation(
          relations,
          relSeen,
          {
            fromObject: pair.fromObject,
            fromColumn: pair.fromColumn,
            toObject: pair.toObject,
            toColumn: pair.toColumn,
            relationType: 'stage2_join_enriched',
            family: 'oracle_structural',
            provenance: [
              'candidateScopedSourceEnrichment',
              ...h.provenance,
              h.onClause ? `onClause:${h.onClause}` : 'onClause:absent',
            ],
          },
          metrics,
          'exact_static',
        );
      }
    }

    if (source) {
      parserInvoked = true;
      try {
        const lineageParsed = extractViewLineage(source.text);
        parserStatus = lineageParsed.unresolvedConstructs.length
          ? `partial:${lineageParsed.unresolvedConstructs.join(',')}`
          : 'ok';
        const aliasFromSource = resolveAliasMap({
          viewOwner: cand.owner,
          viewObjectName: cand.objectName,
          hops,
          lineageReads: lineageParsed.reads,
          lineageJoins: lineageParsed.joins,
        });
        for (const [a, ref] of aliasFromSource.resolved) {
          if (!aliasMap.has(a)) {
            aliasMap.set(a, ref);
            metrics.aliasesResolved += 1;
          }
        }

        const projectionParsed = extractViewProjectionLineage(
          source.text,
          cand.owner,
          cand.objectName,
          aliasFromSource.resolved,
        );
        const exposedColumns = fetched.viewColumnMetadata.get(assignmentRef) ?? [];
        const ddlColumns = parseCreateViewExplicitColumnList(source.text);
        const aligned = alignViewProjectionsWithSurface({
          viewOwner: cand.owner,
          viewName: cand.objectName,
          projections: projectionParsed.projections,
          exposedColumns,
          declaredColumnsFromDdl: ddlColumns,
          unresolvedConstructs: projectionParsed.unresolvedConstructs,
        });
        viewProjections = aligned.projections;
        metrics.projectionOrdinalAlignmentsAttempted += aligned.metrics.projectionOrdinalAlignmentsAttempted;
        metrics.projectionOrdinalAlignmentsExact += aligned.metrics.projectionOrdinalAlignmentsExact;
        metrics.projectionOrdinalAlignmentsRejected += aligned.metrics.projectionOrdinalAlignmentsRejected;
        metrics.projectionCountMismatches += aligned.metrics.projectionCountMismatches;
        metrics.projectionAliasMetadataConflicts += aligned.metrics.projectionAliasMetadataConflicts;
        metrics.exposedViewColumnFactsRecovered += aligned.metrics.exposedViewColumnFactsRecovered;
        projectionFacts.push(...viewProjections);
        recordProjectionFacts({
          assignmentRef,
          projections: viewProjections,
          claims,
          metrics,
          sourceHash: source.hash,
        });

        // Promote Stage2 hop joins onto assignment VIEW using projection lineage.
        for (const h of joins) {
          for (const pair of pairsFromHop(h, aliasMap, metrics)) {
            if (pair.rejection) continue;
            if (
              promoteAssignmentExactJoin({
                assignmentRef,
                viewProjections,
                sourceObject: pair.fromObject,
                sourceColumn: pair.fromColumn,
                toObject: pair.toObject,
                toColumn: pair.toColumn,
                relationType: 'view_projected_join_enriched',
                provenance: [
                  'candidateScopedSourceEnrichment',
                  'applicationReachability:indirect_via_oracle_lineage',
                  `sourceView:${assignmentRef}`,
                  ...h.provenance,
                ],
                relations,
                relSeen,
                metrics,
                objects,
                claims,
                dictRefs,
                subjectRefs,
              })
            ) {
              recovered += 1;
            }
          }
        }

        // Primary FROM object(s) — lineage sources of the view.
        const primaryReads = new Set<string>();
        for (const r of lineageParsed.reads) {
          const owner =
            r.qualified.wasQualified && r.qualified.owner ? r.qualified.owner : cand.owner;
          const toRef = `${owner}.${r.qualified.objectName}`;
          primaryReads.add(toRef);
          if (
            addRelation(
              relations,
              relSeen,
              {
                fromObject: assignmentRef,
                fromColumn: 'UNKNOWN',
                toObject: toRef,
                toColumn: 'UNKNOWN',
                relationType: 'view_lineage_reads_from',
                family: 'oracle_structural',
                provenance: [
                  'candidateScopedSourceEnrichment',
                  `sourceView:${assignmentRef}`,
                  `sourceHash:${source.hash}`,
                  `sourceAcquisition:${source.method}`,
                  r.alias ? `alias:${r.alias}` : 'alias:none',
                ],
              },
              metrics,
              'unresolved',
            )
          ) {
            recovered += 1;
          }
          ensureObject(objects, toRef, {
            objectType: 'TABLE',
            tags: ['lineage_source'],
          });
          if (!indirectCandidates.some((c) => `${c.owner}.${c.objectName}` === toRef)) {
            indirectCandidates.push({
              oracleCanonicalId: stage2ObjectId(owner, 'TABLE', r.qualified.objectName),
              owner,
              objectName: r.qualified.objectName,
              objectType: 'TABLE',
              reachedFromApplicationNode: assignmentRef,
              acePath: [...cand.acePath, `lineage:${toRef}`],
              aceEdgeKind: 'APPLICATION_JOIN',
              aceEdgeKinds: ['APPLICATION_JOIN'],
              candidateRoleHypotheses: [],
              supportingEvidence: [
                'applicationReachability:indirect_via_oracle_lineage',
                `via_view:${assignmentRef}`,
                `sourceHash:${source.hash}`,
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
            metrics.indirectApplicationOracleCandidates += 1;
            metrics.oracleLineageObjectsReached += 1;
          }
        }

        joinFactsFound += lineageParsed.joins.length;
        for (const j of lineageParsed.joins) {
          columnPairsFound += j.parsedPairs.length;
          const owner =
            j.qualified.wasQualified && j.qualified.owner ? j.qualified.owner : cand.owner;
          const joinTargetRef = `${owner}.${j.qualified.objectName}`;
          if (j.conditionStatus === 'unresolved' || j.parsedPairs.length === 0) {
            metrics.unresolvedJoinPairsRejected += 1;
            metrics.exactColumnPairsRejected += 1;
            continue;
          }
          for (const pair of j.parsedPairs) {
            metrics.exactColumnPairsRecovered += 1;
            const leftObj = aliasMap.get(pair.leftAlias.toUpperCase());
            const rightObj = aliasMap.get(pair.rightAlias.toUpperCase());
            if (!leftObj || !rightObj) {
              metrics.aliasesUnresolved += 1;
              metrics.exactColumnPairsRejected += 1;
              continue;
            }
            metrics.aliasesResolved += 2;
            const prov = [
              'candidateScopedSourceEnrichment',
              `sourceView:${assignmentRef}`,
              `sourceHash:${source.hash}`,
              `sourceAcquisition:${source.method}`,
              `joinType:${j.joinType ?? 'JOIN'}`,
              j.onClause ? `onClause:${j.onClause}` : 'onClause:absent',
              'extractionMechanism:extractViewLineage',
            ];
            if (
              addRelation(
                relations,
                relSeen,
                {
                  fromObject: leftObj,
                  fromColumn: pair.leftColumn.toUpperCase(),
                  toObject: rightObj,
                  toColumn: pair.rightColumn.toUpperCase(),
                  relationType: 'view_source_join_enriched',
                  family: 'oracle_structural',
                  provenance: prov,
                },
              metrics,
              'exact_static',
            )
          ) {
            recovered += 1;
          }

          const leftIsPrimary = primaryReads.has(leftObj);
          const rightIsPrimary = primaryReads.has(rightObj);
          const baseSideObj = leftIsPrimary ? leftObj : rightIsPrimary ? rightObj : leftObj;
          const baseSideCol = (
            leftIsPrimary ? pair.leftColumn : rightIsPrimary ? pair.rightColumn : pair.leftColumn
          ).toUpperCase();
          const projectedToObj = leftIsPrimary
            ? rightObj
            : rightIsPrimary
              ? leftObj
              : rightObj;
          const projectedToCol = (
            leftIsPrimary ? pair.rightColumn : rightIsPrimary ? pair.leftColumn : pair.rightColumn
          ).toUpperCase();

          if (
            promoteAssignmentExactJoin({
              assignmentRef,
              viewProjections,
              sourceObject: baseSideObj,
              sourceColumn: baseSideCol,
              toObject: projectedToObj,
              toColumn: projectedToCol,
              relationType: 'view_projected_join_enriched',
              provenance: [
                ...prov.filter((p) => !p.startsWith('confidence:')),
                'applicationReachability:indirect_via_oracle_lineage',
                `projectedFrom:${baseSideObj}`,
              ],
              relations,
              relSeen,
              metrics,
              objects,
              claims,
              dictRefs,
              subjectRefs,
            })
          ) {
            recovered += 1;
          }

          if (dictRefs.has(joinTargetRef) || dictRefs.has(projectedToObj)) {
            dictRefs.add(projectedToObj);
          }

          if (!indirectCandidates.some((c) => `${c.owner}.${c.objectName}` === joinTargetRef)) {
              indirectCandidates.push({
                oracleCanonicalId: stage2ObjectId(owner, 'TABLE', j.qualified.objectName),
                owner,
                objectName: j.qualified.objectName,
                objectType: 'TABLE',
                reachedFromApplicationNode: assignmentRef,
                acePath: [...cand.acePath, `join:${joinTargetRef}`],
                aceEdgeKind: 'APPLICATION_JOIN',
                aceEdgeKinds: ['APPLICATION_JOIN'],
                candidateRoleHypotheses: dictRefs.has(joinTargetRef)
                  ? ['dictionary_identity']
                  : [],
                supportingEvidence: [
                  'applicationReachability:indirect_via_oracle_lineage',
                  `via_view_join:${assignmentRef}`,
                  `sourceHash:${source.hash}`,
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
              metrics.indirectApplicationOracleCandidates += 1;
            }
          }
        }

        const temporals = extractTemporalPredicatesFromSql(source.text);
        wherePredicatesFound = temporals.length;
        temporalPredicatesFound = temporals.length;
        for (const t of temporals) {
          metrics.temporalFactsRecovered += 1;
          const col = t.leftExpression.includes('.')
            ? t.leftExpression.split('.').pop()!
            : t.leftExpression;
          claims.push({
            family: 'oracle_structural',
            claimType: 'temporal_predicate',
            object: assignmentRef,
            column: col,
            roleHint: t.operator === 'IS' ? 'valid_to' : undefined,
            weight: 3,
            provenance: [
              'candidateScopedSourceEnrichment',
              `sourceView:${assignmentRef}`,
              `sourceHash:${source.hash}`,
              `predicate:${t.leftExpression}${t.operator}${t.rightExpression}`,
              t.nullSemantics ? `nullSemantics:${t.nullSemantics}` : 'nullSemantics:none',
            ],
            notes: `op:${t.operator};right:${t.rightExpression}`,
          });
          recovered += 1;
        }

        // Shared-base JOIN transfer: other Stage2 views that READS_FROM the same base
        // provide exact JOIN pairs applicable to this application-reached view.
        const shared = await recoverJoinsViaSharedBaseLineage({
          repoRoot: input.repoRoot,
          baseObjectRefs: [...primaryReads],
          maxViews: 8,
          maxJoins: 16,
        });
        for (const s of shared) {
          metrics.sharedBaseTransfersConsidered += 1;
          metrics.exactColumnPairsRecovered += 1;
          metrics.exactPairsBefore += 1;

          let toRef = s.toRef;
          const viaDict = dictBaseToView.get(s.toRef);
          const viaSubject = subjectBaseToView.get(s.toRef);
          if (viaSubject) {
            toRef = viaSubject;
            subjectRefs.add(viaSubject);
          } else if (viaDict) {
            toRef = viaDict;
            dictRefs.add(viaDict);
          } else {
            const dictCand = input.candidates.find(
              (c) =>
                c.candidateRoleHypotheses.includes('dictionary_identity') &&
                c.stage2Facts.readsFrom.some((r) => stage2IdToObjectRef(r) === s.toRef),
            );
            if (dictCand) {
              toRef = `${dictCand.owner}.${dictCand.objectName}`;
              dictRefs.add(toRef);
            }
          }

          const siblingPair =
            s.provenance.find((p) => p.startsWith('pair:'))?.replace('pair:', '') ?? null;
          const audit = classifySharedBaseTransfer({
            targetView: assignmentRef,
            baseObjectRef: s.baseRef,
            baseColumn: s.fromColumn,
            joinTargetObject: toRef,
            joinTargetColumn: s.toColumn,
            projections: viewProjections,
            siblingView: s.evidenceViewId,
            siblingPair,
            provenance: [
              'candidateScopedSourceEnrichment',
              `sourceView:${assignmentRef}`,
              `sourceHash:${source.hash}`,
              'applicationReachability:indirect_via_oracle_lineage',
              ...s.provenance,
            ],
          });
          sharedBaseAuditRows.push(audit);

          if (audit.classification !== 'projection_exact' || !audit.targetExposedColumn) {
            metrics.sharedBaseTransfersRejected += 1;
            metrics.sharedBaseTransfersDowngraded += 1;
            metrics.exactColumnPairsRejected += 1;
            continue;
          }

          metrics.sharedBaseTransfersExact += 1;
          const prov = [
            'candidateScopedSourceEnrichment',
            `sourceView:${assignmentRef}`,
            `sourceHash:${source.hash}`,
            'applicationReachability:indirect_via_oracle_lineage',
            `projection:${assignmentRef}.${audit.targetExposedColumn}<-${s.baseRef}.${s.fromColumn}`,
            `sharedBaseJoin:${s.baseRef}.${s.fromColumn}->${toRef}.${s.toColumn}`,
            ...s.provenance,
          ];
          if (
            addRelation(
              relations,
              relSeen,
              {
                fromObject: assignmentRef,
                fromColumn: audit.targetExposedColumn,
                toObject: toRef,
                toColumn: s.toColumn,
                relationType: 'shared_base_join_enriched',
                family: 'oracle_structural',
                provenance: prov,
              },
              metrics,
              'exact_static',
            )
          ) {
            recovered += 1;
            tagJoinEndpoints(
              objects,
              claims,
              assignmentRef,
              assignmentRef,
              audit.targetExposedColumn,
              toRef,
              s.toColumn,
              dictRefs,
              subjectRefs,
              prov,
            );
          }
        }
      } catch (e) {
        parserStatus = `error:${String(e).slice(0, 80)}`;
      }
    }

    const failureReason =
      recovered > 0
        ? 'none'
        : !hops.length && !source
          ? fetched.fetchBoundaryReason
            ? `no_stage2_joins_or_reads_and_source_unavailable:${fetched.fetchBoundaryReason}`
            : 'no_stage2_joins_or_reads_and_source_unavailable'
          : hops.length && !joins.some((j) => j.parsedPairs.length) && !source
            ? 'reads_from_present_but_no_exact_join_pairs_and_source_unavailable'
            : source && parserStatus?.startsWith('error')
              ? `parser_failed:${parserStatus}`
              : source && recovered === 0
                ? 'source_parsed_but_no_binding_relations'
                : 'enrichment_produced_no_new_binding_relations';

    if (recovered > 0) metrics.candidateScopedSourceEnrichmentsSucceeded += 1;
    else metrics.candidateScopedSourceEnrichmentsFailed += 1;

    failureRows.push({
      hypothesisId: `hyp:${assignmentRef.replace(/\./g, '_')}`,
      candidateOracleObject: assignmentRef,
      canonicalObjectId: cand.oracleCanonicalId,
      objectType: String(cand.objectType),
      applicationPath: cand.acePath,
      ACEEndpoint: cand.reachedFromApplicationNode,
      sourceAvailable: Boolean(source),
      sourceAcquisitionType: source?.method ?? null,
      sourceObjectResolved: Boolean(source),
      sourceHashAvailable: Boolean(source?.hash),
      Stage2EdgesAvailable: {
        JOINS: joins.length,
        READS_FROM: reads.length,
        REFERENCES: cand.stage2Facts.references.length,
        WRITES_TO: cand.stage2Facts.writesTo.length,
      },
      sourceFetchAttempted: fetched.attempted > 0 || Boolean(fetched.fetchBoundaryReason),
      sourceFetchSucceeded: Boolean(source),
      parserInvoked,
      parserStatus,
      joinFactsFound,
      columnPairsFound,
      wherePredicatesFound,
      temporalPredicatesFound,
      lookupFactsFound: 0,
      failureReason,
    });
  }

  for (const o of lineage.objects) {
    if (o.applicationReachability !== 'indirect_via_oracle_lineage') continue;
    if (indirectCandidates.some((c) => c.oracleCanonicalId === o.oracleCanonicalId)) continue;
    indirectCandidates.push({
      oracleCanonicalId: o.oracleCanonicalId,
      owner: o.owner,
      objectName: o.objectName,
      objectType: o.objectType === 'TABLE' ? 'TABLE' : 'VIEW',
      reachedFromApplicationNode: o.pathFromApplication[0] ?? 'lineage',
      acePath: o.pathFromApplication,
      aceEdgeKind: 'APPLICATION_JOIN',
      aceEdgeKinds: ['APPLICATION_JOIN'],
      candidateRoleHypotheses: dictRefs.has(`${o.owner}.${o.objectName}`)
        ? ['dictionary_identity']
        : [],
      supportingEvidence: [
        'applicationReachability:indirect_via_oracle_lineage',
        ...o.hops.flatMap((h) => h.provenance.slice(0, 2)),
      ],
      negativeEvidence: [],
      stage2Facts: {
        readsFrom: o.hops.filter((h) => h.edgeKind === 'READS_FROM').map((h) => h.toId),
        writesTo: [],
        calls: [],
        joinsTo: o.hops
          .filter((h) => h.edgeKind === 'JOINS_TO')
          .map((h) => `${h.fromId}->${h.toId}`),
        joinDetails: o.hops
          .filter((h) => h.edgeKind === 'JOINS_TO')
          .map((h) => ({
            fromId: h.fromId,
            toId: h.toId,
            onClause: h.onClause,
            parsedPairs: h.parsedPairs,
            provenance: h.provenance,
          })),
        references: [],
      },
    });
  }

  return {
    graph: { ...input.graph, objects, relations, claims },
    metrics,
    failureRows,
    lineage,
    indirectCandidates,
    fetchBoundaryReason: fetched.fetchBoundaryReason,
    projectionFacts,
    sharedBaseAuditRows,
  };
}
