/**
 * Stage 3 — Targeted Write-Path Analyzer main algorithm.
 *
 * Target-driven: given one (owner, objectName) target table/view, walks
 * outward only from the Stage2 WRITES_TO edges that touch it, then a
 * bounded reverse CALLS traversal toward DAC/DAE/DEF/application packages.
 * Never loads the full Stage2 corpus, never uses ground-truth chain names
 * as extraction seeds, never infers a column↔param mapping from name
 * similarity alone.
 */
import {
  detectDynamicBoundaries,
  extractDirectCalls,
  extractDmlTargets,
  extractProgramSqlReads,
  normalizeOracleName,
  preprocessSqlForStaticExtraction,
  splitQualifiedName,
  stage2ObjectId,
} from '../teta-oracle-source-index-stage2/teta-stage2-parse';
import type { Stage2ObjectType } from '../teta-oracle-source-index-stage2/teta-stage2.types';
import { resolveEndpoint } from '../teta-oracle-source-index-stage2/teta-stage2-resolve';
import {
  buildParameterMapping,
  buildRecordFieldChainMap,
  parseDeleteSelectors,
  parseInsertColumnMappings,
  parseRecordFieldAssignments,
  parseUpdateSetMappings,
  parseWhereSelectors,
  type RecordFieldChainMap,
} from './teta-stage3-dml-map';
import {
  defaultStage3Paths,
  defaultStage3InventoryPath,
  loadStage1DacEdges,
  loadStage2InventoryIndexFromObjects,
  ownerFromWriterId,
  packageNameFromWriterId,
  parseProgramUnitId,
  streamFindCallEdgesToTargets,
  streamLoadWritesToIndex,
  writerIdKind,
  type Stage3CallEdgeRaw,
  type Stage3DacEdge,
  type Stage3WriteEdge,
  type Stage3WriterIdKind,
} from './teta-stage3-load';
import {
  detectProgramUnitResolution,
  resolveProgramUnitSignature,
  type Stage3ProgramUnitSignature,
  type Stage3SignatureIndex,
  type Stage3SignatureSource,
} from './teta-stage3-signatures';
import { STAGE3_GAP_MATRIX } from './teta-stage3-gap-matrix';
import {
  emptyStage3Audit,
  emptyStage3Metrics,
  STAGE3_CONTRACT_VERSION,
  STAGE3_SOURCE_STAGE,
  type Stage3Caller,
  type Stage3Confidence,
  type Stage3DmlOperation,
  type Stage3GatewayReference,
  type Stage3LookupCheck,
  type Stage3ObjectType,
  type Stage3PackageFamily,
  type Stage3PathStatus,
  type Stage3Provenance,
  type Stage3RuntimeBoundary,
  type Stage3SideEffectCall,
  type Stage3ValidationCall,
  type Stage3WriterCandidate,
  type Stage3WritePath,
  type Stage3WritePathAnalysisResult,
} from './teta-stage3.types';

const HOOK_NAME_PATTERN = /before|after|przed|po_|hook/i;
const VALIDATION_NAME_PATTERN = /validate|assert|istnieje|check|sprawdz/i;

export function classifyPackageFamily(packageName: string | null): Stage3PackageFamily {
  if (!packageName) return 'OTHER';
  const m = /_(DAC|DAE|DEF|AGD|AGL)$/i.exec(packageName);
  if (!m) return 'OTHER';
  return m[1]!.toUpperCase() as Stage3PackageFamily;
}

function fmtProv(
  sourceKind: Stage3Provenance['sourceKind'],
  sourcePath: string,
  extractionMechanism: string,
  confidenceClass: Stage3Confidence,
  opts: { rawValue?: string | null; normalizedValue?: string | null; evidenceRefs?: string[]; sourceMember?: string | null } = {},
): Stage3Provenance {
  return {
    sourceKind,
    sourcePath,
    sourceMember: opts.sourceMember ?? null,
    extractionMechanism,
    rawValue: opts.rawValue ?? null,
    normalizedValue: opts.normalizedValue ?? null,
    confidenceClass,
    evidenceRefs: opts.evidenceRefs ?? [],
  };
}

export type Stage3Fixtures = {
  /** Bypasses edgesPath streaming for WRITES_TO discovery — tests only. */
  writeEdges?: Stage3WriteEdge[];
  /** Bypasses edgesPath streaming for reverse CALLS traversal — tests only. */
  callEdges?: Stage3CallEdgeRaw[];
  /** Bypasses acePath streaming for Stage1 DAC lookups — tests only. */
  dacEdges?: Stage3DacEdge[];
  /** writerId or packageName → PL/SQL source text (fixture source provider). */
  sources?: Map<string, string>;
  /** Exact PROGRAM_UNIT id -> parameter-name set from signatures (ALL_ARGUMENTS / fixtures). */
  parameterNamesByProgramUnit?: Map<string, Set<string>>;
  /** Full signature index (preferred over parameterNamesByProgramUnit). */
  signatureIndex?: Stage3SignatureIndex;
};

export type AnalyzeWritePathInput = {
  targetOwner: string;
  targetObjectName: string;
  targetObjectType?: Stage3ObjectType;
  maxDepth?: number;
  maxProgramsPerAnalysis?: number;
  edgesPath?: string;
  acePath?: string;
  sourceProvider?: 'fixture' | 'oracle_metadata' | 'none';
  fixtures?: Stage3Fixtures;
  /** Used only when sourceProvider === 'oracle_metadata' (CLI live targeted fetch). */
  fetchSource?: (
    writerId: string,
    packageName: string | null,
    idKind: Stage3WriterIdKind,
  ) => Promise<string | null>;
};

function matchesTarget(
  raw: { owner: string | null; objectName: string; wasQualified: boolean },
  targetOwner: string,
  targetObjectName: string,
  writerOwner: string | null,
): boolean {
  if (normalizeOracleName(raw.objectName) !== normalizeOracleName(targetObjectName)) return false;
  // Unqualified object resolves in source owner context; never cross-owner by name alone.
  if (!raw.wasQualified) {
    return normalizeOracleName(writerOwner ?? '') === normalizeOracleName(targetOwner);
  }
  const effectiveOwner = normalizeOracleName(targetOwner);
  const rawOwner = normalizeOracleName(raw.owner ?? '');
  return rawOwner === effectiveOwner || rawOwner === normalizeOracleName(writerOwner ?? '');
}

type ProgramUnitSegment = { name: string; start: number; end: number };

function segmentProgramUnits(source: string): ProgramUnitSegment[] {
  // Conservative top-level package-body segmentation:
  // - only PROCEDURE/FUNCTION headers whose lexical depth is 0
  // - nested local routines are ignored as top-level members
  const text = preprocessSqlForStaticExtraction(source);
  const re = /\b(PROCEDURE|FUNCTION)\s+([A-Za-z_][\w$#]*)\b/gi;
  const tokens = /\b(BEGIN|END)\b/gi;
  const depthEvents: Array<{ pos: number; kind: 'BEGIN' | 'END' }> = [];
  let tm: RegExpExecArray | null;
  while ((tm = tokens.exec(text))) {
    depthEvents.push({ pos: tm.index, kind: tm[1]!.toUpperCase() as 'BEGIN' | 'END' });
  }
  let depthPtr = 0;
  let depth = 0;
  const members: Array<{ name: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    while (depthPtr < depthEvents.length && depthEvents[depthPtr]!.pos < m.index) {
      depth += depthEvents[depthPtr]!.kind === 'BEGIN' ? 1 : -1;
      if (depth < 0) depth = 0;
      depthPtr += 1;
    }
    if (depth !== 0) continue;
    const tail = text.slice(m.index, Math.min(text.length, m.index + 400));
    if (!/\bIS\b|\bAS\b/i.test(tail)) continue;
    members.push({ name: normalizeOracleName(m[2]!), start: m.index });
  }
  members.sort((a, b) => a.start - b.start);
  return members.map((d, i) => ({
    name: d.name,
    start: d.start,
    end: i + 1 < members.length ? members[i + 1]!.start : source.length,
  }));
}

function programUnitMemberName(fromId: string): string | null {
  // oracle-program-unit:OWNER:PKG:NAME:oN:sM
  const m = /^oracle-program-unit:[^:]+:[^:]+:([^:]+):/.exec(fromId);
  return m ? normalizeOracleName(m[1]!) : null;
}

/**
 * Restrict DML parsing to the writer program-unit body so sibling procedures
 * in the same PACKAGE BODY are not attributed to every candidate.
 */
function sourceSliceForProgramUnit(source: string, programUnitId: string): string {
  const parsed = parseProgramUnitId(programUnitId);
  const member = parsed?.memberName ?? programUnitMemberName(programUnitId);
  if (!member) return source;
  const segments = segmentProgramUnits(source);
  if (segments.length === 0) return source;
  const sameName = segments.filter((s) => normalizeOracleName(s.name) === member);
  // Conservative for overloads: if multiple same-name top-level members exist,
  // keep whole source and let confidence degrade instead of choosing first.
  if (sameName.length !== 1) return source;
  const hit = sameName[0];
  if (!hit) return source;
  return source.slice(hit.start, hit.end);
}

function buildDmlOperationsFromSource(input: {
  source: string;
  sourcePath: string;
  programUnitId: string;
  targetOwner: string;
  targetObjectName: string;
  writerOwner: string | null;
  writerPackageName: string | null;
  parameterNames?: Set<string>;
  signature?: Stage3ProgramUnitSignature | null;
  signatureSource?: Stage3SignatureSource | null;
  programUnitResolution?: 'resolved' | 'unresolved';
}): Stage3DmlOperation[] {
  const {
    source,
    sourcePath,
    programUnitId,
    targetOwner,
    targetObjectName,
    writerOwner,
    writerPackageName,
    parameterNames,
    signature,
    signatureSource,
    programUnitResolution,
  } = input;
  const mappingCtx = {
    parameterNames,
    programUnitId,
    signature,
    signatureSource,
    programUnitResolution,
  };
  const targetId = stage2ObjectId(targetOwner, 'TABLE', targetObjectName);
  const dmlSource = sourceSliceForProgramUnit(source, programUnitId);
  // Scope record assignments to the same routine body only (no sibling leakage).
  const localSymbols = new Set<string>();
  const localDeclRe = /\b([A-Za-z_][\w$#]*)\s+(?:NUMBER|VARCHAR2|DATE|TIMESTAMP|BOOLEAN|INTEGER|PLS_INTEGER|BINARY_INTEGER)\b/gi;
  let decl: RegExpExecArray | null;
  while ((decl = localDeclRe.exec(preprocessSqlForStaticExtraction(dmlSource)))) {
    localSymbols.add(normalizeOracleName(decl[1]!));
  }
  const recordAssignments = parseRecordFieldAssignments(dmlSource, {
    parameterNames,
    localSymbols,
    packageName: writerPackageName,
  });
  const recordFieldMap: RecordFieldChainMap = buildRecordFieldChainMap(recordAssignments);
  const ops: Stage3DmlOperation[] = [];

  const inserts = parseInsertColumnMappings(dmlSource);
  for (const ins of inserts) {
    if (!matchesTarget(ins.targetQualified, targetOwner, targetObjectName, writerOwner)) continue;
    const pairCount = Math.min(ins.columns.length, ins.valueExprs.length);
    const parameterMappings = [];
    for (let i = 0; i < pairCount; i += 1) {
      parameterMappings.push(
        buildParameterMapping({
          targetColumn: ins.columns[i]!,
          sourceExpression: ins.valueExprs[i]!,
          role: 'VALUE_SOURCE',
          positional: true,
          recordFieldMap,
          localSymbols,
          packageName: writerPackageName,
          ...mappingCtx,
          provenance: fmtProv('stage2_edges_ndjson', sourcePath, 'INSERT_positional', 'exact_static', {
            sourceMember: programUnitId,
            rawValue: `${ins.columns[i]} <- ${ins.valueExprs[i]}`,
            evidenceRefs: [ins.rawStatementExcerpt],
          }),
        }),
      );
    }
    ops.push({
      operation: 'INSERT',
      targetObjectId: targetId,
      targetObjectRaw: ins.targetRaw,
      programUnitId,
      statementIndex: ins.matchIndex,
      rawStatementExcerpt: ins.rawStatementExcerpt,
      parameterMappings,
      rowSelectors: [],
      provenance: fmtProv('stage2_edges_ndjson', sourcePath, 'INSERT_INTO', 'exact_static', {
        sourceMember: programUnitId,
      }),
    });
  }

  const updates = parseUpdateSetMappings(dmlSource);
  for (const upd of updates) {
    if (!matchesTarget(upd.targetQualified, targetOwner, targetObjectName, writerOwner)) continue;
    const parameterMappings = upd.setMappings.map((s) =>
      buildParameterMapping({
        targetColumn: s.column,
        sourceExpression: s.expr,
        role: 'VALUE_SOURCE',
        positional: false,
        recordFieldMap,
        localSymbols,
        packageName: writerPackageName,
        ...mappingCtx,
        provenance: fmtProv('stage2_edges_ndjson', sourcePath, 'UPDATE_SET_explicit', 'exact_static', {
          sourceMember: programUnitId,
          rawValue: `${s.column} = ${s.expr}`,
        }),
      }),
    );
    const rowSelectors = parseWhereSelectors(upd.whereClause ?? '').map((sel) =>
      buildParameterMapping({
        targetColumn: sel.column ?? 'UNRESOLVED_SELECTOR',
        sourceExpression: sel.expr,
        role: 'ROW_SELECTOR',
        positional: false,
        recordFieldMap,
        localSymbols,
        packageName: writerPackageName,
        ...mappingCtx,
        provenance: fmtProv('stage2_edges_ndjson', sourcePath, 'UPDATE_WHERE_selector', 'exact_static', {
          sourceMember: programUnitId,
          rawValue: sel.raw,
        }),
      }),
    );
    ops.push({
      operation: 'UPDATE',
      targetObjectId: targetId,
      targetObjectRaw: upd.targetRaw,
      programUnitId,
      statementIndex: upd.matchIndex,
      rawStatementExcerpt: upd.rawStatementExcerpt,
      parameterMappings,
      rowSelectors,
      provenance: fmtProv('stage2_edges_ndjson', sourcePath, 'UPDATE_SET', 'exact_static', {
        sourceMember: programUnitId,
      }),
    });
  }

  const deletes = parseDeleteSelectors(dmlSource);
  for (const del of deletes) {
    if (!matchesTarget(del.targetQualified, targetOwner, targetObjectName, writerOwner)) continue;
    const rowSelectors = parseWhereSelectors(del.whereClause ?? '').map((sel) =>
      buildParameterMapping({
        targetColumn: sel.column ?? 'UNRESOLVED_SELECTOR',
        sourceExpression: sel.expr,
        role: 'ROW_SELECTOR',
        positional: false,
        recordFieldMap,
        localSymbols,
        packageName: writerPackageName,
        ...mappingCtx,
        provenance: fmtProv('stage2_edges_ndjson', sourcePath, 'DELETE_WHERE_selector', 'exact_static', {
          sourceMember: programUnitId,
          rawValue: sel.raw,
        }),
      }),
    );
    ops.push({
      operation: 'DELETE',
      targetObjectId: targetId,
      targetObjectRaw: del.targetRaw,
      programUnitId,
      statementIndex: del.matchIndex,
      rawStatementExcerpt: del.rawStatementExcerpt,
      parameterMappings: [],
      rowSelectors,
      provenance: fmtProv('stage2_edges_ndjson', sourcePath, 'DELETE_FROM', 'exact_static', {
        sourceMember: programUnitId,
      }),
    });
  }

  // MERGE — reuse Stage2's generic detector; deep positional parsing deferred (gap matrix).
  for (const dml of extractDmlTargets(dmlSource)) {
    if (dml.operation !== 'MERGE') continue;
    if (!matchesTarget(dml.qualified, targetOwner, targetObjectName, writerOwner)) continue;
    ops.push({
      operation: 'MERGE',
      targetObjectId: targetId,
      targetObjectRaw: dml.raw,
      programUnitId,
      statementIndex: -1,
      rawStatementExcerpt: `MERGE INTO ${dml.raw} (deep positional parsing not yet implemented)`,
      parameterMappings: [],
      rowSelectors: [],
      provenance: fmtProv('stage2_edges_ndjson', sourcePath, 'MERGE_INTO_deferred', 'unresolved', {
        sourceMember: programUnitId,
      }),
    });
  }

  return ops;
}

/**
 * Sibling procedures inside the same PACKAGE BODY are called unqualified
 * (`SPRAWDZ_ISTNIENIE(p)`), so Stage2's extractDirectCalls (which requires a
 * `PKG.MEMBER(` qualifier) misses them. This supplements it for the
 * validation-name-pattern case only — never used for DML target/column
 * resolution, only for structural validation-call detection.
 */
function findBareValidationCalls(text: string): Array<{ raw: string; member: string }> {
  const out: Array<{ raw: string; member: string }> = [];
  const re = /(?<![.\w$#])([A-Za-z_][\w$#]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const member = normalizeOracleName(m[1]!);
    if (!VALIDATION_NAME_PATTERN.test(member)) continue;
    out.push({ raw: member, member });
  }
  return out;
}

function buildValidationsAndLookups(input: {
  source: string;
  scopedWriterSource: string;
  sourcePath: string;
  programUnitId: string;
  writerPackageName: string | null;
  sourceOwner: string;
  inventory: Map<string, Stage2ObjectType>;
  synonyms?: Map<string, { owner: string; objectName: string }>;
}): { validations: Stage3ValidationCall[]; lookups: Stage3LookupCheck[] } {
  const {
    source,
    scopedWriterSource,
    sourcePath,
    programUnitId,
    writerPackageName,
    sourceOwner,
    inventory,
    synonyms,
  } = input;
  const validations: Stage3ValidationCall[] = [];
  const lookups: Stage3LookupCheck[] = [];
  const segments = segmentProgramUnits(source);

  // Validation call attribution is scoped to the writer routine body only.
  const seenValidationCalls = new Set<string>();
  for (const call of extractDirectCalls(scopedWriterSource)) {
    if (!VALIDATION_NAME_PATTERN.test(call.member)) continue;
    const key = `${call.packageQualified.objectName}.${call.member}`;
    if (seenValidationCalls.has(key)) continue;
    seenValidationCalls.add(key);
    validations.push({
      calleeRaw: call.raw,
      calleePackage: call.packageQualified.wasQualified ? call.packageQualified.objectName : null,
      calleeMember: call.member,
      matchedPattern: VALIDATION_NAME_PATTERN.source,
      programUnitId,
      provenance: fmtProv('stage2_edges_ndjson', sourcePath, 'direct_call_validation_pattern', 'strong_static', {
        rawValue: call.raw,
      }),
    });
  }
  for (const bare of findBareValidationCalls(preprocessSqlForStaticExtraction(scopedWriterSource))) {
    const key = `-.${bare.member}`;
    if (seenValidationCalls.has(key)) continue;
    seenValidationCalls.add(key);
    validations.push({
      calleeRaw: bare.raw,
      calleePackage: null,
      calleeMember: bare.member,
      matchedPattern: VALIDATION_NAME_PATTERN.source,
      programUnitId,
      provenance: fmtProv('stage2_edges_ndjson', sourcePath, 'bare_call_validation_pattern', 'strong_static', {
        rawValue: bare.raw,
      }),
    });
  }

  // For each exact validation callee, inspect the callee routine body for
  // deterministic lookup evidence.
  for (const v of validations) {
    const isSamePackage = !v.calleePackage || normalizeOracleName(v.calleePackage) === normalizeOracleName(writerPackageName ?? '');
    if (!isSamePackage) continue;
    const seg = segments.find((s) => normalizeOracleName(s.name) === normalizeOracleName(v.calleeMember));
    if (!seg) continue;
    const regionText = source.slice(seg.start, seg.end);
    for (const read of extractProgramSqlReads(regionText)) {
      const resolved = resolveEndpoint({
        sourceOwner,
        qualified: splitQualifiedName(read.raw),
        inventory,
        synonyms,
        prefer: 'read',
      });
      lookups.push({
        targetObjectRaw: read.raw,
        targetObjectId: resolved.objectType === 'unresolved_object' ? null : resolved.id,
        viaClause: read.via,
        programUnitId,
        edgeKind: 'VALIDATES_AGAINST',
        provenance: fmtProv('stage2_edges_ndjson', sourcePath, `${read.via}_in_validation_routine`, 'strong_static', {
          sourceMember: v.calleeMember,
          rawValue: read.raw,
        }),
      });
    }
  }

  return { validations, lookups };
}

function buildRuntimeBoundaries(
  source: string,
  sourcePath: string,
  programUnitId: string,
): Stage3RuntimeBoundary[] {
  return detectDynamicBoundaries(source).map((b) => ({
    boundaryType: b.boundaryType,
    programUnitId,
    symbol: b.symbol,
    missingRuntimeValue: 'runtime SQL text not statically available',
    evidenceRefs: [`${sourcePath}#${programUnitId}`],
    confidenceClass: 'runtime_only' as const,
  }));
}

function inferParameterNamesFromScopedSource(scopedSource: string): Set<string> {
  const out = new Set<string>();
  const header = preprocessSqlForStaticExtraction(scopedSource).slice(0, 800);
  const p = /\(([\s\S]*?)\)/.exec(header);
  if (!p) return out;
  const parts = p[1]!.split(',');
  for (const part of parts) {
    const m = /^\s*([A-Za-z_][\w$#]*)\b/.exec(part.trim());
    if (m) out.add(normalizeOracleName(m[1]!));
  }
  return out;
}

function derivePathConfidence(path: {
  sourceStatus: 'available' | 'unavailable' | 'not_attempted';
  dmlOperations: Stage3DmlOperation[];
  runtimeBoundaries: Stage3RuntimeBoundary[];
}): Stage3Confidence {
  if (path.sourceStatus !== 'available') return 'unresolved';
  if (path.dmlOperations.length === 0) {
    return path.runtimeBoundaries.length > 0 ? 'runtime_only' : 'unresolved';
  }
  const allMappings = path.dmlOperations.flatMap((op) => [...op.parameterMappings, ...op.rowSelectors]);
  if (allMappings.length === 0) return 'strong_static';
  const hasUnresolved = allMappings.some((m) => m.classification === 'unresolved');
  const hasTransformed = allMappings.some(
    (m) => m.classification === 'transformed' || m.classification === 'sequence',
  );
  if (hasUnresolved) return 'strong_static';
  if (hasTransformed) return 'strong_static';
  return 'exact_static';
}

function deriveSinglePathStatus(path: Stage3WritePath): Stage3PathStatus {
  if (path.sourceStatus !== 'available') return 'source_unavailable';
  if (path.confidence === 'runtime_only') return 'runtime_boundary';
  if (path.confidence === 'exact_static') return 'exact_static_path';
  if (path.confidence === 'strong_static') return 'strong_static_path';
  return 'partial_exact_path';
}

function aggregatePathStatus(paths: Stage3WritePath[]): Stage3PathStatus {
  const distinctPkgs = new Set(paths.map((p) => p.writerPackageId));
  if (distinctPkgs.size > 1) return 'ambiguous_writers';
  const statuses = paths.map(deriveSinglePathStatus);
  if (statuses.every((s) => s === 'exact_static_path')) return 'exact_static_path';
  if (statuses.every((s) => s === 'exact_static_path' || s === 'strong_static_path')) {
    return 'strong_static_path';
  }
  if (statuses.every((s) => s === 'source_unavailable')) return 'source_unavailable';
  if (statuses.every((s) => s === 'runtime_boundary')) return 'runtime_boundary';
  return 'partial_exact_path';
}

export async function analyzeWritePath(
  input: AnalyzeWritePathInput,
): Promise<Stage3WritePathAnalysisResult> {
  const startedAt = Date.now();
  const metrics = emptyStage3Metrics();
  const audit = emptyStage3Audit();
  const maxDepth = input.maxDepth ?? 6;
  const maxProgramsPerAnalysis = input.maxProgramsPerAnalysis ?? 80;
  const targetObjectType: Stage3ObjectType = input.targetObjectType ?? 'TABLE';
  const targetOwner = normalizeOracleName(input.targetOwner);
  const targetObjectName = normalizeOracleName(input.targetObjectName);
  const targetId = stage2ObjectId(targetOwner, targetObjectType as Stage2ObjectType, targetObjectName);
  const sourceProvider = input.sourceProvider ?? 'none';
  const repoRoot = process.cwd();
  const { edgesPath, acePath } = defaultStage3Paths(repoRoot);
  const inventoryPath = defaultStage3InventoryPath(repoRoot);
  const effectiveEdgesPath = input.edgesPath ?? edgesPath;
  const effectiveAcePath = input.acePath ?? acePath;

  let analysisTruncated = false;

  // --- a/b. Writer discovery, scoped to targetId only. ---
  let writeEdges: Stage3WriteEdge[];
  if (input.fixtures?.writeEdges) {
    writeEdges = input.fixtures.writeEdges.filter((e) => e.toId === targetId);
  } else {
    const { index, edgesScanned, linesScanned } = await streamLoadWritesToIndex(effectiveEdgesPath, {
      targetIds: new Set([targetId]),
    });
    writeEdges = index.get(targetId) ?? [];
    metrics.edgesFilePassCount += 1;
    metrics.edgesScanned += edgesScanned;
    void linesScanned;
  }

  const byFromId = new Map<string, Stage3WriteEdge[]>();
  for (const e of writeEdges) {
    const list = byFromId.get(e.fromId);
    if (list) list.push(e);
    else byFromId.set(e.fromId, [e]);
  }

  const writerCandidates: Stage3WriterCandidate[] = [...byFromId.entries()].map(([fromId, edges]) => {
    const idKind = writerIdKind(fromId);
    const ops = new Set(edges.map((e) => e.operation));
    const bestConfidence = edges.some((e) => e.confidenceClass === 'exact_static')
      ? 'exact_static'
      : edges.some((e) => e.confidenceClass === 'strong_static')
        ? 'strong_static'
        : edges.some((e) => e.confidenceClass === 'runtime_only')
          ? 'runtime_only'
          : 'unresolved';
    return {
      fromId,
      packageName: packageNameFromWriterId(fromId),
      objectType:
        idKind === 'PROGRAM_UNIT'
          ? 'PROGRAM_UNIT'
          : idKind === 'PACKAGE_BODY'
            ? 'PACKAGE_BODY'
            : 'STANDALONE_OBJECT',
      operation: ops.size === 1 ? [...ops][0]! : 'unknown',
      confidenceClass: bestConfidence,
      provenance: edges.flatMap((e) => e.provenance),
    };
  });
  metrics.writersFound = writerCandidates.length;
  metrics.distinctWriterPackages = new Set(
    writerCandidates.map((w) => w.packageName ?? w.fromId),
  ).size;

  if (writerCandidates.length === 0) {
    metrics.analysisDurationMs = Date.now() - startedAt;
    return {
      contractVersion: STAGE3_CONTRACT_VERSION,
      sourceStage: STAGE3_SOURCE_STAGE,
      identityVersion: 'teta-aia-canonical-id-v1',
      targetObject: { id: targetId, owner: targetOwner, objectName: targetObjectName, objectType: targetObjectType },
      pathStatus: 'no_static_writer_found',
      writerCandidates: [],
      paths: [],
      metrics,
      audit,
      gapMatrix: STAGE3_GAP_MATRIX,
      analysisTruncated: false,
      provider: sourceProvider,
    };
  }

  // --- c/d. Per-writer source load + DML/validation/lookup extraction. ---
  // Prefer packages that already have Stage2 exact/strong WRITES_TO evidence
  // and Teta writer-family suffixes (_DEF/_AGD/_DAC…) over alphabetical truncation.
  const scoreCandidate = (c: Stage3WriterCandidate): number => {
    let score = 0;
    if (c.confidenceClass === 'exact_static') score += 100;
    else if (c.confidenceClass === 'strong_static') score += 60;
    else if (c.confidenceClass === 'runtime_only') score += 10;
    const fam = classifyPackageFamily(c.packageName);
    if (fam === 'DEF') score += 50;
    else if (fam === 'AGD') score += 45;
    else if (fam === 'DAC') score += 30;
    else if (fam === 'DAE') score += 20;
    else if (fam === 'AGL') score += 15;
    const op = String(c.operation ?? '').toUpperCase();
    if (op === 'INSERT' || op === 'UPDATE' || op === 'DELETE' || op === 'MERGE') score += 25;
    if (
      c.provenance.some((p) =>
        [...(p.evidenceRefs ?? []), p.sourcePath, p.extractionMechanism].some((x) =>
          /unwrap|unwrapped/i.test(String(x ?? '')),
        ),
      )
    ) {
      score += 15;
    }
    return score;
  };
  const boundedCandidates = [...writerCandidates].sort((a, b) => {
    const d = scoreCandidate(b) - scoreCandidate(a);
    if (d !== 0) return d;
    return a.fromId.localeCompare(b.fromId);
  });
  if (boundedCandidates.length > maxProgramsPerAnalysis) analysisTruncated = true;
  const candidatesToAnalyze = boundedCandidates.slice(0, maxProgramsPerAnalysis);

  const sourceCache = new Map<string, string | null>();
  const loadSource = async (fromId: string, packageName: string | null, idKind: Stage3WriterIdKind) => {
    const owner = ownerFromWriterId(fromId) ?? '-';
    const cacheKey = `${owner}:${idKind}:${packageName ?? fromId}`;
    if (sourceCache.has(cacheKey)) return sourceCache.get(cacheKey) ?? null;
    let text: string | null = null;
    const ownerPkgKey = packageName ? `${owner}:${packageName}` : null;
    if (sourceProvider === 'fixture' && input.fixtures?.sources) {
      text =
        input.fixtures.sources.get(fromId) ??
        (ownerPkgKey ? input.fixtures.sources.get(ownerPkgKey) ?? null : null) ??
        (packageName ? input.fixtures.sources.get(packageName) ?? null : null);
    } else if (sourceProvider === 'oracle_metadata' && input.fetchSource) {
      text = await input.fetchSource(fromId, packageName, idKind);
      if (text != null) metrics.sourceObjectsLoaded += 1;
    }
    sourceCache.set(cacheKey, text);
    if (sourceProvider === 'fixture' && text != null) metrics.sourceObjectsLoaded += 1;
    return text;
  };

  const paths: Stage3WritePath[] = [];
  const distinctValidationRoutines = new Set<string>();
  const inventoryIndex = await loadStage2InventoryIndexFromObjects(
    inventoryPath,
    new Set([targetOwner]),
  );
  const synonyms = new Map<string, { owner: string; objectName: string }>();

  for (const candidate of candidatesToAnalyze) {
    metrics.programUnitsVisited += 1;
    const packageName = candidate.packageName;
    const writerOwner = ownerFromWriterId(candidate.fromId);
    const packageFamily = classifyPackageFamily(packageName);

    const source = await loadSource(candidate.fromId, packageName, writerIdKind(candidate.fromId));
    const usableSource = source != null && source.trim().length > 0 ? source : null;
    const sourceStatus: 'available' | 'unavailable' | 'not_attempted' =
      usableSource != null ? 'available' : sourceProvider === 'none' ? 'not_attempted' : 'unavailable';

    let dmlOperations: Stage3DmlOperation[] = [];
    let validations: Stage3ValidationCall[] = [];
    let lookups: Stage3LookupCheck[] = [];
    let runtimeBoundaries: Stage3RuntimeBoundary[] = [];

    if (usableSource != null) {
      const scopedWriterSource = sourceSliceForProgramUnit(usableSource, candidate.fromId);
      const programUnitResolution = detectProgramUnitResolution(usableSource, candidate.fromId);
      const headerParamNames = inferParameterNamesFromScopedSource(scopedWriterSource);
      const sigResolved = resolveProgramUnitSignature({
        programUnitId: candidate.fromId,
        signatureIndex: input.fixtures?.signatureIndex ?? new Map(),
        headerParameterNames: headerParamNames,
        programUnitResolution,
      });
      const effectiveParamNames = sigResolved.parameterNames;
      if (
        sigResolved.signatureSource === 'oracle_all_arguments' ||
        sigResolved.signatureSource === 'stage2_index'
      ) {
        metrics.argumentSignaturesLoaded += 1;
      }
      dmlOperations = buildDmlOperationsFromSource({
        source: usableSource,
        sourcePath: `writer:${candidate.fromId}`,
        programUnitId: candidate.fromId,
        targetOwner,
        targetObjectName,
        writerOwner,
        writerPackageName: packageName,
        parameterNames: effectiveParamNames,
        signature: sigResolved.signature,
        signatureSource: sigResolved.signatureSource,
        programUnitResolution: sigResolved.programUnitResolution,
      });
      const vl = buildValidationsAndLookups({
        source: usableSource,
        scopedWriterSource,
        sourcePath: `writer:${candidate.fromId}`,
        programUnitId: candidate.fromId,
        writerPackageName: packageName,
        sourceOwner: writerOwner ?? targetOwner,
        inventory: inventoryIndex,
        synonyms,
      });
      validations = vl.validations;
      lookups = vl.lookups;
      runtimeBoundaries = buildRuntimeBoundaries(scopedWriterSource, `writer:${candidate.fromId}`, candidate.fromId);
      for (const v of validations) {
        distinctValidationRoutines.add(
          `${v.calleePackage ?? ownerFromWriterId(candidate.fromId) ?? '-'}:${v.calleeMember}`,
        );
      }
    }

    metrics.dmlOperationsExtracted += dmlOperations.length;
    metrics.parameterMappingsExtracted += dmlOperations.reduce((n, op) => n + op.parameterMappings.length, 0);
    metrics.rowSelectorsExtracted += dmlOperations.reduce((n, op) => n + op.rowSelectors.length, 0);
    metrics.validationsFound += validations.length;
    metrics.lookupsFound += lookups.length;
    metrics.validationCallSitesFound += validations.length;
    metrics.validationLookupsFound += lookups.length;
    metrics.runtimeBoundariesFound += runtimeBoundaries.length;

    const path: Stage3WritePath = {
      pathId: `twp-s3-path:${candidate.fromId}`,
      writerCandidateId: candidate.fromId,
      writerPackageId: packageName ?? candidate.fromId,
      programUnitId: candidate.fromId,
      packageFamily,
      dmlOperations,
      validations,
      lookups,
      sideEffectCalls: [],
      callers: [],
      callHops: [],
      gatewayReferences: [],
      runtimeBoundaries,
      confidence: 'unresolved',
      truncated: false,
      sourceStatus,
      programUnitResolution: usableSource != null ? detectProgramUnitResolution(usableSource, candidate.fromId) : undefined,
    };
    path.confidence = derivePathConfidence(path);
    paths.push(path);
  }
  metrics.distinctValidationRoutines = distinctValidationRoutines.size;

  // --- e. Bounded reverse CALLS traversal per writer routine (PROGRAM_UNIT first). ---
  const dacTargetPackages = new Set<string>();
  for (const p of paths) {
    const visited = new Set<string>([p.programUnitId]);
    let frontierRoutine = new Set<string>([p.programUnitId]);
    let frontierPackagesFallback = new Set<string>();
    if (!p.programUnitId.startsWith('oracle-program-unit:')) {
      frontierPackagesFallback = new Set<string>([p.writerPackageId]);
    }
    let depth = 0;
    const callersFound: Stage3Caller[] = [];
    const callHops: Stage3WritePath['callHops'] = [];
    const sideEffects: Stage3SideEffectCall[] = [];
    let truncatedHere = false;

    while (depth < maxDepth && (frontierRoutine.size > 0 || frontierPackagesFallback.size > 0)) {
      depth += 1;
      let callEdges: Stage3CallEdgeRaw[];
      if (input.fixtures?.callEdges) {
        callEdges = input.fixtures.callEdges
          .map((e) => ({
            ...e,
            toProgramUnitId: e.toId.startsWith('oracle-program-unit:') ? e.toId : null,
            fromProgramUnitId: e.fromId.startsWith('oracle-program-unit:') ? e.fromId : null,
            matchKind: frontierRoutine.has(e.toId)
              ? ('routine_exact' as const)
              : ('package_fallback' as const),
          }))
          .filter((e) => {
            if (frontierRoutine.has(e.toId)) return true;
            const toPkg = packageNameFromWriterId(e.toId);
            return toPkg != null && frontierPackagesFallback.has(toPkg);
          });
      } else {
        const res = await streamFindCallEdgesToTargets(
          effectiveEdgesPath,
          frontierRoutine,
          frontierPackagesFallback,
        );
        metrics.edgesFilePassCount += 1;
        metrics.edgesScanned += res.edgesScanned;
        callEdges = res.edges;
      }

      const nextRoutine = new Set<string>();
      const nextPackagesFallback = new Set<string>();
      for (const edge of callEdges) {
        const callerNode = edge.fromProgramUnitId ?? edge.fromId;
        if (visited.has(callerNode)) {
          metrics.cyclesDetected += 1;
          continue;
        }
        visited.add(callerNode);
        if (edge.fromProgramUnitId) nextRoutine.add(edge.fromProgramUnitId);
        const callerPkg = packageNameFromWriterId(edge.fromId) ?? edge.fromId;
        nextPackagesFallback.add(callerPkg);
        const callerFamily = classifyPackageFamily(callerPkg);
        const caller: Stage3Caller = {
          callerId: edge.fromId,
          callerPackageName: callerPkg,
          packageFamily: callerFamily,
          depth,
          callMatchKind: edge.matchKind ?? 'package_fallback',
          provenance: edge.provenance[0] ?? fmtProv('stage2_edges_ndjson', effectiveEdgesPath, 'CALLS', 'unresolved'),
        };
        callersFound.push(caller);
        callHops.push({
          depth,
          fromProgramUnitId: edge.fromProgramUnitId ?? edge.fromId,
          toProgramUnitId: edge.toProgramUnitId ?? edge.toId,
          matchKind: edge.matchKind ?? 'package_fallback',
          confidenceClass: edge.confidenceClass,
          provenance: caller.provenance,
        });
        metrics.callersDiscovered += 1;
        if (HOOK_NAME_PATTERN.test(edge.fromId)) {
          sideEffects.push({
            calleeId: p.programUnitId,
            calleeRaw: edge.toId,
            callerPackageFamily: callerFamily,
            hookType: 'unknown',
            matchedPattern: HOOK_NAME_PATTERN.source,
            provenance: caller.provenance,
          });
          metrics.sideEffectCallsFound += 1;
        }
        dacTargetPackages.add(callerPkg);
      }
      frontierRoutine = nextRoutine;
      frontierPackagesFallback = nextPackagesFallback;
      if (
        depth === maxDepth &&
        (frontierRoutine.size > 0 || frontierPackagesFallback.size > 0)
      ) {
        truncatedHere = true;
      }
    }
    metrics.maxDepthReached = Math.max(metrics.maxDepthReached, depth);
    dacTargetPackages.add(p.writerPackageId);

    p.callers = callersFound;
    p.callHops = callHops;
    p.sideEffectCalls = sideEffects;
    p.truncated = truncatedHere;
    if (truncatedHere) {
      p.truncationReason = `maxDepth=${maxDepth} reached with remaining unexplored callers`;
      analysisTruncated = true;
    }
  }

  // --- Stage1 DAC gateway attachment, scoped to all visited writer/caller packages. ---
  let dacEdges: Stage3DacEdge[];
  if (input.fixtures?.dacEdges) {
    dacEdges = input.fixtures.dacEdges.filter((e) => dacTargetPackages.has(e.dacPackageName));
  } else {
    const res = await loadStage1DacEdges(effectiveAcePath, dacTargetPackages);
    metrics.edgesFilePassCount += 1;
    metrics.edgesScanned += res.edgesScanned;
    dacEdges = res.edges;
  }
  metrics.gatewayReferencesMatched = dacEdges.length;

  const gatewaysByPackage = new Map<string, Stage3GatewayReference[]>();
  for (const d of dacEdges) {
    const ref: Stage3GatewayReference = {
      gatewayName: d.gatewayName,
      dacPackageObjectId: `oracle-package:${d.dacPackageOwner}:${d.dacPackageName}`,
      provenance: d.provenance,
    };
    const list = gatewaysByPackage.get(d.dacPackageName);
    if (list) list.push(ref);
    else gatewaysByPackage.set(d.dacPackageName, [ref]);
  }
  for (const p of paths) {
    const own = gatewaysByPackage.get(p.writerPackageId) ?? [];
    const fromCallers = p.callers.flatMap((c) => gatewaysByPackage.get(c.callerPackageName ?? '') ?? []);
    p.gatewayReferences = [...own, ...fromCallers];
  }

  metrics.analysisDurationMs = Date.now() - startedAt;

  const pathStatus = aggregatePathStatus(paths);

  return {
    contractVersion: STAGE3_CONTRACT_VERSION,
    sourceStage: STAGE3_SOURCE_STAGE,
    identityVersion: 'teta-aia-canonical-id-v1',
    targetObject: { id: targetId, owner: targetOwner, objectName: targetObjectName, objectType: targetObjectType },
    pathStatus,
    writerCandidates,
    paths,
    metrics,
    audit,
    gapMatrix: STAGE3_GAP_MATRIX,
    analysisTruncated,
    provider: sourceProvider,
  };
}
