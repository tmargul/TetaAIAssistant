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
  extractPackageUnitDecls,
  extractProgramSqlReads,
  normalizeOracleName,
  preprocessSqlForStaticExtraction,
  stage2ObjectId,
} from '../teta-oracle-source-index-stage2/teta-stage2-parse';
import type { Stage2ObjectType } from '../teta-oracle-source-index-stage2/teta-stage2.types';
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
  loadStage1DacEdges,
  ownerFromWriterId,
  packageNameFromWriterId,
  streamFindCallEdgesToPackages,
  streamLoadWritesToIndex,
  writerIdKind,
  type Stage3CallEdgeRaw,
  type Stage3DacEdge,
  type Stage3WriteEdge,
  type Stage3WriterIdKind,
} from './teta-stage3-load';
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
  if (!raw.wasQualified) return true; // unqualified — resolves against the writer's own owner, never invented
  const effectiveOwner = normalizeOracleName(targetOwner);
  const rawOwner = normalizeOracleName(raw.owner ?? '');
  return rawOwner === effectiveOwner || rawOwner === normalizeOracleName(writerOwner ?? '');
}

type ProgramUnitSegment = { name: string; start: number; end: number };

function segmentProgramUnits(source: string): ProgramUnitSegment[] {
  const decls = extractPackageUnitDecls(source).sort((a, b) => a.startOffset - b.startOffset);
  return decls.map((d, i) => ({
    name: d.name,
    start: d.startOffset,
    end: i + 1 < decls.length ? decls[i + 1]!.startOffset : source.length,
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
  const member = programUnitMemberName(programUnitId);
  if (!member) return source;
  const segments = segmentProgramUnits(source);
  if (segments.length === 0) return source;
  const hit = segments.find((s) => normalizeOracleName(s.name) === member);
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
}): Stage3DmlOperation[] {
  const { source, sourcePath, programUnitId, targetOwner, targetObjectName, writerOwner } = input;
  const targetId = stage2ObjectId(targetOwner, 'TABLE', targetObjectName);
  // Record assignments may live in helpers earlier in the package; keep the
  // full-package chain map, but parse DML only inside the writer unit body.
  const recordAssignments = parseRecordFieldAssignments(source);
  const recordFieldMap: RecordFieldChainMap = buildRecordFieldChainMap(recordAssignments);
  const dmlSource = sourceSliceForProgramUnit(source, programUnitId);
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
  sourcePath: string;
  programUnitId: string;
}): { validations: Stage3ValidationCall[]; lookups: Stage3LookupCheck[] } {
  const { source, sourcePath, programUnitId } = input;
  const validations: Stage3ValidationCall[] = [];
  const lookups: Stage3LookupCheck[] = [];
  const segments = segmentProgramUnits(source);

  // Validation *calls* can be issued from any member (e.g. an INSERT_ROW procedure
  // calling a SPRAWDZ_ISTNIENIE helper) — scan the whole source for the call site.
  // Qualified calls (PKG.MEMBER(...)) reuse Stage2's extractDirectCalls; unqualified
  // sibling-procedure calls (common inside one PACKAGE BODY) are matched separately.
  const seenValidationCalls = new Set<string>();
  for (const call of extractDirectCalls(source)) {
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
  for (const bare of findBareValidationCalls(preprocessSqlForStaticExtraction(source))) {
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

  // Lookups are only promoted to VALIDATES_AGAINST when they occur *inside* the
  // body of a member whose own name matches the validation pattern (deterministic
  // scoping — never guessed from the call site).
  const validationSegments = segments.filter((seg) => VALIDATION_NAME_PATTERN.test(seg.name));
  for (const seg of validationSegments) {
    const regionText = source.slice(seg.start, seg.end);
    for (const read of extractProgramSqlReads(regionText)) {
      lookups.push({
        targetObjectRaw: read.raw,
        targetObjectId: read.qualified.objectName
          ? stage2ObjectId(read.qualified.owner ?? '', 'TABLE', read.qualified.objectName)
          : null,
        viaClause: read.via,
        programUnitId,
        edgeKind: 'VALIDATES_AGAINST',
        provenance: fmtProv('stage2_edges_ndjson', sourcePath, `${read.via}_in_validation_context`, 'strong_static', {
          sourceMember: seg.name,
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
    const cacheKey = packageName ?? fromId;
    if (sourceCache.has(cacheKey)) return sourceCache.get(cacheKey) ?? null;
    let text: string | null = null;
    if (sourceProvider === 'fixture' && input.fixtures?.sources) {
      text = input.fixtures.sources.get(fromId) ?? (packageName ? input.fixtures.sources.get(packageName) ?? null : null);
    } else if (sourceProvider === 'oracle_metadata' && input.fetchSource) {
      text = await input.fetchSource(fromId, packageName, idKind);
      if (text != null) metrics.sourceObjectsLoaded += 1;
    }
    sourceCache.set(cacheKey, text);
    if (sourceProvider === 'fixture' && text != null) metrics.sourceObjectsLoaded += 1;
    return text;
  };

  const paths: Stage3WritePath[] = [];

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
      dmlOperations = buildDmlOperationsFromSource({
        source: usableSource,
        sourcePath: `writer:${candidate.fromId}`,
        programUnitId: candidate.fromId,
        targetOwner,
        targetObjectName,
        writerOwner,
      });
      const vl = buildValidationsAndLookups({
        source: usableSource,
        sourcePath: `writer:${candidate.fromId}`,
        programUnitId: candidate.fromId,
      });
      validations = vl.validations;
      lookups = vl.lookups;
      runtimeBoundaries = buildRuntimeBoundaries(usableSource, `writer:${candidate.fromId}`, candidate.fromId);
    }

    metrics.dmlOperationsExtracted += dmlOperations.length;
    metrics.parameterMappingsExtracted += dmlOperations.reduce((n, op) => n + op.parameterMappings.length, 0);
    metrics.rowSelectorsExtracted += dmlOperations.reduce((n, op) => n + op.rowSelectors.length, 0);
    metrics.validationsFound += validations.length;
    metrics.lookupsFound += lookups.length;
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
      gatewayReferences: [],
      runtimeBoundaries,
      confidence: 'unresolved',
      truncated: false,
      sourceStatus,
    };
    path.confidence = derivePathConfidence(path);
    paths.push(path);
  }

  // --- e. Bounded reverse CALLS traversal per unique writer package. ---
  const dacTargetPackages = new Set<string>();
  const pathsByPackage = new Map<string, Stage3WritePath[]>();
  for (const p of paths) {
    const list = pathsByPackage.get(p.writerPackageId);
    if (list) list.push(p);
    else pathsByPackage.set(p.writerPackageId, [p]);
  }

  for (const [pkgId, pkgPaths] of pathsByPackage) {
    const visited = new Set<string>([pkgId]);
    let frontier = new Set<string>([pkgId]);
    let depth = 0;
    const callersFound: Stage3Caller[] = [];
    const sideEffects: Stage3SideEffectCall[] = [];
    let truncatedHere = false;

    while (depth < maxDepth && frontier.size > 0) {
      depth += 1;
      let callEdges: Stage3CallEdgeRaw[];
      if (input.fixtures?.callEdges) {
        callEdges = input.fixtures.callEdges.filter((e) => {
          const toPkg = packageNameFromWriterId(e.toId);
          return toPkg != null && frontier.has(toPkg);
        });
      } else {
        const res = await streamFindCallEdgesToPackages(effectiveEdgesPath, frontier);
        metrics.edgesFilePassCount += 1;
        metrics.edgesScanned += res.edgesScanned;
        callEdges = res.edges;
      }

      const nextFrontier = new Set<string>();
      for (const edge of callEdges) {
        const callerPkg = packageNameFromWriterId(edge.fromId) ?? edge.fromId;
        if (visited.has(callerPkg)) {
          metrics.cyclesDetected += 1;
          continue;
        }
        visited.add(callerPkg);
        nextFrontier.add(callerPkg);
        const callerFamily = classifyPackageFamily(callerPkg);
        const caller: Stage3Caller = {
          callerId: edge.fromId,
          callerPackageName: callerPkg,
          packageFamily: callerFamily,
          depth,
          provenance: edge.provenance[0] ?? fmtProv('stage2_edges_ndjson', effectiveEdgesPath, 'CALLS', 'unresolved'),
        };
        callersFound.push(caller);
        metrics.callersDiscovered += 1;
        if (callerFamily === 'DAE' && HOOK_NAME_PATTERN.test(callerPkg)) {
          sideEffects.push({
            calleeId: pkgId,
            calleeRaw: edge.toId,
            callerPackageFamily: callerFamily,
            hookType: /before|przed/i.test(callerPkg) ? 'before' : /after|po_/i.test(callerPkg) ? 'after' : 'unknown',
            matchedPattern: HOOK_NAME_PATTERN.source,
            provenance: caller.provenance,
          });
          metrics.sideEffectCallsFound += 1;
        }
        dacTargetPackages.add(callerPkg);
      }
      frontier = nextFrontier;
      if (depth === maxDepth && frontier.size > 0) truncatedHere = true;
    }
    metrics.maxDepthReached = Math.max(metrics.maxDepthReached, depth);
    dacTargetPackages.add(pkgId);

    for (const p of pkgPaths) {
      p.callers = callersFound;
      p.sideEffectCalls = sideEffects;
      p.truncated = truncatedHere;
      if (truncatedHere) {
        p.truncationReason = `maxDepth=${maxDepth} reached with remaining unexplored callers`;
        analysisTruncated = true;
      }
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
