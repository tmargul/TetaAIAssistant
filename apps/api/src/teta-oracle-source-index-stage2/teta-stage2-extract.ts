/**
 * Stage 2 extraction over normalized sources (filesystem or oracle_metadata).
 * No Copilot. No business SQL. No Stage 3 write-path semantics.
 */

import path from 'path';
import {
  STAGE2_CONTRACT_VERSION,
  STAGE2_SOURCE_STAGE,
  emptyStage2Audit,
  emptyStage2Metrics,
  type Stage2Edge,
  type Stage2ExtractionResult,
  type Stage2NormalizedSource,
  type Stage2ObjectType,
  type Stage2Provenance,
  type Stage2RuntimeBoundary,
  type Stage2SourceObject,
} from './teta-stage2.types';
import {
  type QualifiedName,
  detectDynamicBoundaries,
  extractDirectCalls,
  extractDmlTargets,
  extractPackageUnitDecls,
  extractProgramSqlReads,
  extractTriggerMeta,
  extractViewLineage,
  makeEdge,
  normalizeOracleName,
  parseTriggerEventsFromMetadataString,
  sha256,
  stage2ObjectId,
  stage2ProgramUnitId,
} from './teta-stage2-parse';
import { type ResolvedEndpoint, buildInventoryIndex, resolveEndpoint } from './teta-stage2-resolve';
import { FilesystemOracleSourceProvider } from './teta-stage2-filesystem-provider';
import type {
  OracleSourceArgument,
  OracleSourceDependency,
} from './teta-stage2-provider';
import { mapOracleObjectType } from './teta-stage2-oracle-metadata-provider';
import { UNWRAP_SEARCH_REPORT } from './teta-stage2-unwrap';

function baseProv(
  src: Stage2NormalizedSource,
  mechanism: string,
  raw?: string,
  extras?: Partial<Stage2Provenance>,
): Stage2Provenance {
  return {
    confidenceClass: extras?.confidenceClass ?? 'exact_from_source',
    sourceKind:
      src.sourceOrigin === 'oracle_metadata'
        ? 'oracle_metadata'
        : src.sourceOrigin === 'synthetic_fixture'
          ? 'synthetic_fixture'
          : 'oracle_source_file',
    sourcePath: src.sourcePath,
    sourceExtension: (src.metadata?.sourceExtension as string) ?? null,
    extractionMechanism: mechanism,
    rawValue: raw ?? null,
    evidenceRefs: [`${src.sourceOrigin}:${src.sourcePath}`],
    originalSourceOrigin: src.sourceOrigin,
    originalRepresentation: src.sourceRepresentation,
    originalSourceHash: src.sourceHash,
    transformation:
      src.parserInputRepresentation === 'unwrapped_plaintext' ? 'oracle_plsql_unwrap' : null,
    unwrapToolVersion: src.unwrap?.toolVersion ?? null,
    normalizedSourceHash:
      src.parserInputRepresentation === 'unwrapped_plaintext'
        ? src.unwrap?.unwrappedSourceHash ?? sha256(src.parserInputText)
        : src.sourceHash,
    parserInputRepresentation: src.parserInputRepresentation,
    ...extras,
  };
}

export type ExtractOpts = {
  provider?: string;
  dependencies?: OracleSourceDependency[];
  arguments?: OracleSourceArgument[];
  argumentScan?: {
    argumentRowsAvailable: number;
    argumentRowsRead: number;
    argumentRowsPersisted: number;
    argumentScanComplete: boolean;
  };
  capabilities?: Record<string, unknown> | null;
  owners?: { discovered: string[]; indexed: string[]; excluded: string[] } | null;
  oracleCounters?: {
    oracleMetadataConnectionsOpened?: number;
    oracleMetadataSelectStatementsExecuted?: number;
  };
  knownStaticGaps?: string[];
  /** owner|objectName → Stage2ObjectType (ALL_OBJECTS-derived). Empty/absent ⇒ legacy TABLE-guess fallback. */
  inventoryIndex?: Map<string, Stage2ObjectType>;
  /** owner|synonym_name → { owner, objectName } (ALL_SYNONYMS-derived). */
  synonyms?: Map<string, { owner: string; objectName: string }>;
};

/**
 * Graph integrity — an edge endpoint is valid only if it is present in the
 * materialized object set, the (Stage2 has none today) base canonical graph,
 * or the runtime-boundary node set. Edge endpoints that resolve to none of
 * these are dangling/broken. Exported standalone so integrity rules are
 * unit-testable without running the full extractor.
 */
export function computeGraphIntegrity(
  edges: Stage2Edge[],
  materializedNodeIds: Set<string>,
  baseCanonicalNodeIds: Set<string> = new Set(),
  runtimeBoundaryNodeIds: Set<string> = new Set(),
): { danglingEdgesPersisted: number; brokenEndpointsAgainstUnionGraph: number } {
  const isKnown = (nodeId: string) =>
    materializedNodeIds.has(nodeId) ||
    baseCanonicalNodeIds.has(nodeId) ||
    runtimeBoundaryNodeIds.has(nodeId);
  const brokenEndpoints = new Set<string>();
  let danglingEdges = 0;
  for (const e of edges) {
    const fromOk = isKnown(e.fromId);
    const toOk = isKnown(e.toId);
    if (!fromOk) brokenEndpoints.add(e.fromId);
    if (!toOk) brokenEndpoints.add(e.toId);
    if (!fromOk || !toOk) danglingEdges += 1;
  }
  return { danglingEdgesPersisted: danglingEdges, brokenEndpointsAgainstUnionGraph: brokenEndpoints.size };
}

type ProgramUnitGroup = {
  id: string;
  owner: string;
  packageName: string | null;
  objectName: string;
  overload: number;
  subprogramId: number | null;
  kind: 'FUNCTION' | 'PROCEDURE';
  args: OracleSourceArgument[];
};

/** Groups ALL_ARGUMENTS rows into distinct program units (owner/package/name/subprogram/overload). */
function groupArgumentsIntoProgramUnits(args: OracleSourceArgument[]): {
  groups: ProgramUnitGroup[];
  byName: Map<string, ProgramUnitGroup[]>;
} {
  const map = new Map<string, ProgramUnitGroup>();
  for (const a of args) {
    const owner = normalizeOracleName(a.owner);
    const packageName = a.packageName ? normalizeOracleName(a.packageName) : null;
    const objectName = normalizeOracleName(a.objectName);
    const overload = a.overload ?? 0;
    const subprogramId = a.subprogramId ?? null;
    const key = `${owner}|${packageName ?? '-'}|${objectName}|${subprogramId ?? 0}|${overload}`;
    let group = map.get(key);
    if (!group) {
      group = {
        id: stage2ProgramUnitId(owner, packageName, objectName, overload, subprogramId),
        owner,
        packageName,
        objectName,
        overload,
        subprogramId,
        kind: 'PROCEDURE',
        args: [],
      };
      map.set(key, group);
    }
    group.args.push(a);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.args.sort(
      (x, y) => (x.position ?? 0) - (y.position ?? 0) || (x.sequence ?? 0) - (y.sequence ?? 0),
    );
    g.kind = g.args.some((a) => (a.position ?? -1) === 0) ? 'FUNCTION' : 'PROCEDURE';
  }
  const byName = new Map<string, ProgramUnitGroup[]>();
  for (const g of groups) {
    const nameKey = `${g.owner}|${g.packageName ?? '-'}|${g.objectName}`;
    const list = byName.get(nameKey) ?? [];
    list.push(g);
    byName.set(nameKey, list);
  }
  return { groups, byName };
}

type AttributionSegment = {
  fromId: string;
  text: string;
  programUnitResolution: 'resolved' | 'unresolved' | 'not_attempted';
};

/**
 * Segments a PACKAGE_BODY into per-PROCEDURE/FUNCTION regions so READS/WRITES/CALLS
 * can be attributed to the specific program unit instead of the whole body. Only
 * attributes to a resolved program unit when the declared name is unambiguous
 * (appears exactly once in the body) and a matching ALL_ARGUMENTS-derived unit
 * exists; otherwise falls back to PACKAGE_BODY-level attribution, flagged
 * unresolved. Non-PACKAGE_BODY object types are always a single "not_attempted"
 * segment (their own id already is the program unit).
 */
function computeAttributionSegments(
  src: Stage2NormalizedSource,
  ownId: string,
  text: string,
  programUnitsByName: Map<string, ProgramUnitGroup[]>,
): AttributionSegment[] {
  if (src.objectType !== 'PACKAGE_BODY') {
    return [{ fromId: ownId, text, programUnitResolution: 'not_attempted' }];
  }
  const decls = extractPackageUnitDecls(text);
  if (!decls.length) {
    return [{ fromId: ownId, text, programUnitResolution: 'unresolved' }];
  }
  const nameCounts = new Map<string, number>();
  for (const d of decls) nameCounts.set(d.name, (nameCounts.get(d.name) ?? 0) + 1);
  const sorted = [...decls].sort((a, b) => a.startOffset - b.startOffset);
  const segments: AttributionSegment[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const d = sorted[i]!;
    const start = d.startOffset;
    const end = i + 1 < sorted.length ? sorted[i + 1]!.startOffset : text.length;
    const segText = text.slice(start, end);
    const safe = (nameCounts.get(d.name) ?? 0) === 1;
    const nameKey = `${normalizeOracleName(src.owner)}|${normalizeOracleName(src.objectName)}|${d.name}`;
    const candidates = safe ? programUnitsByName.get(nameKey) : undefined;
    if (candidates?.length) {
      const chosen = [...candidates].sort((a, b) => a.overload - b.overload)[0]!;
      segments.push({ fromId: chosen.id, text: segText, programUnitResolution: 'resolved' });
    } else {
      segments.push({ fromId: ownId, text: segText, programUnitResolution: 'unresolved' });
    }
  }
  return segments;
}

export function extractFromNormalizedSourcesSync(
  sources: Stage2NormalizedSource[],
  opts: ExtractOpts = {},
): Stage2ExtractionResult {
  const metrics = emptyStage2Metrics();
  const audit = emptyStage2Audit();
  audit.runtimeCopilotDependencies = 0;
  audit.remoteUnwrapCalls = 0;

  const objects: Stage2SourceObject[] = [];
  const edges: Stage2Edge[] = [];
  const edgeById = new Map<string, Stage2Edge>();
  const runtimeBoundaries: Stage2RuntimeBoundary[] = [];

  // Integrity node sets (see architect notes): an edge endpoint is only valid
  // if it lands in one of these — addEdge itself never materializes anything.
  const materializedNodeIds = new Set<string>();
  const baseCanonicalNodeIds = new Set<string>(); // Stage2 has no separate base/Stage1 graph to union against.
  const referencedEndpointIds = new Set<string>();
  const runtimeBoundaryNodeIds = new Set<string>();
  const resolvedEndpointIds = new Set<string>();
  const unresolvedEndpointIds = new Set<string>();

  const inventoryIndex = opts.inventoryIndex ?? new Map<string, Stage2ObjectType>();
  const synonyms = opts.synonyms;

  const materializeObject = (obj: Stage2SourceObject) => {
    if (materializedNodeIds.has(obj.id)) return;
    materializedNodeIds.add(obj.id);
    objects.push(obj);
  };

  /** Materializes a stub for any referenced endpoint id not already backed by a real source object. */
  const ensureMaterialized = (
    id: string,
    owner: string,
    objectName: string,
    objectType: Stage2ObjectType,
    method: string,
  ) => {
    if (materializedNodeIds.has(id)) return;
    materializeObject({
      id,
      owner,
      objectName,
      objectType,
      sourcePath: `referenced://${owner}/${objectType}/${objectName}`,
      moduleDir: null,
      sourceExtension: '.REF',
      sourceHash: '',
      sourceSize: 0,
      parseStatus: 'skipped',
      sourceOrigin: 'oracle_metadata',
      sourceStatus: 'inaccessible',
      sourceRepresentation: 'inaccessible',
      sourceComplete: false,
      sourceAcquisitionMethod: method,
    });
  };

  const ensureEndpointMaterialized = (resolved: ResolvedEndpoint) => {
    const objectType: Stage2ObjectType =
      resolved.objectType === 'unresolved_object' ? 'other_source_object' : resolved.objectType;
    ensureMaterialized(
      resolved.id,
      resolved.owner,
      resolved.objectName,
      objectType,
      resolved.confidence === 'unresolved'
        ? 'referenced_endpoint_unresolved_stub'
        : 'referenced_endpoint_stub',
    );
  };

  const trackResolution = (resolved: ResolvedEndpoint) => {
    if (resolved.confidence === 'unresolved') unresolvedEndpointIds.add(resolved.id);
    else resolvedEndpointIds.add(resolved.id);
  };

  const resolveAndMaterialize = (
    sourceOwner: string,
    qualified: QualifiedName,
    prefer: 'read' | 'dml',
  ): ResolvedEndpoint => {
    const resolved = resolveEndpoint({ sourceOwner, qualified, inventory: inventoryIndex, synonyms, prefer });
    ensureEndpointMaterialized(resolved);
    trackResolution(resolved);
    return resolved;
  };

  const edgeConfidence = (resolved: ResolvedEndpoint) =>
    resolved.confidence === 'unresolved' ? ('unresolved' as const) : resolved.confidence;

  const addEdge = (e: Stage2Edge, viaUnwrap = false) => {
    metrics.rawEdgesProduced += 1;
    referencedEndpointIds.add(e.fromId);
    referencedEndpointIds.add(e.toId);
    const existing = edgeById.get(e.id);
    if (existing) {
      metrics.duplicateEdgesRemoved += 1;
      const seen = new Set(
        existing.provenance.map(
          (p) => `${p.sourcePath}|${p.extractionMechanism}|${p.rawValue ?? ''}`,
        ),
      );
      for (const p of e.provenance) {
        const k = `${p.sourcePath}|${p.extractionMechanism}|${p.rawValue ?? ''}`;
        if (!seen.has(k)) existing.provenance.push(p);
      }
      return;
    }
    edgeById.set(e.id, e);
    edges.push(e);
    metrics.uniqueEdgesPersisted += 1;
    if (e.confidenceClass === 'exact_from_source') metrics.exactFromSourceEdges += 1;
    else if (e.confidenceClass === 'strong_static_inference')
      metrics.strongStaticInferenceEdges += 1;
    else if (e.confidenceClass === 'runtime_only') metrics.runtimeOnlyEdges += 1;
    else metrics.unresolvedEdges += 1;

    if (viaUnwrap) {
      if (e.edgeKind === 'READS_FROM') metrics.readsRecoveredViaUnwrap += 1;
      if (e.edgeKind === 'WRITES_TO') metrics.writesRecoveredViaUnwrap += 1;
      if (e.edgeKind === 'CALLS') metrics.callsRecoveredViaUnwrap += 1;
    }
  };

  if (opts.oracleCounters) {
    metrics.oracleMetadataConnectionsOpened =
      opts.oracleCounters.oracleMetadataConnectionsOpened ?? 0;
    metrics.oracleMetadataSelectStatementsExecuted =
      opts.oracleCounters.oracleMetadataSelectStatementsExecuted ?? 0;
    audit.oracleMetadataConnectionsOpened = metrics.oracleMetadataConnectionsOpened;
    audit.oracleMetadataSelectStatementsExecuted =
      metrics.oracleMetadataSelectStatementsExecuted;
    audit.oracleConnectionsOpened = metrics.oracleMetadataConnectionsOpened;
  }

  if (opts.owners) {
    metrics.ownersDiscovered = opts.owners.discovered.length;
    metrics.ownersIndexed = opts.owners.indexed.length;
    metrics.ownersExcluded = opts.owners.excluded.length;
  }

  if (!sources.length) {
    return {
      contractVersion: STAGE2_CONTRACT_VERSION,
      sourceStage: STAGE2_SOURCE_STAGE,
      identityVersion: 'teta-aia-canonical-id-v1',
      implementationStatus: 'blocked_source_contract_problem',
      objects,
      edges,
      runtimeBoundaries,
      metrics,
      audit,
      provider: opts.provider ?? null,
      capabilities: opts.capabilities ?? null,
      owners: opts.owners ?? null,
      blockedReason:
        'No normalized source objects. Provide filesystem corpus or oracle_metadata provider.',
    };
  }

  const specs = new Map<string, string>();
  const bodies = new Map<string, string>();

  // Program units (ALL_ARGUMENTS-derived) are materialized up front so direct-call
  // resolution and body segmentation can target them while iterating sources.
  const { groups: programUnitGroups, byName: programUnitsByName } = groupArgumentsIntoProgramUnits(
    opts.arguments ?? [],
  );
  for (const g of programUnitGroups) {
    materializeObject({
      id: g.id,
      owner: g.owner,
      objectName: g.objectName,
      objectType: 'PROGRAM_UNIT',
      sourcePath: `oracle://${g.owner}/${g.packageName ? `PACKAGE:${g.packageName}/` : ''}PROGRAM_UNIT/${g.objectName}`,
      moduleDir: g.packageName,
      sourceExtension: '.ARG',
      sourceHash: '',
      sourceSize: 0,
      parseStatus: 'ok',
      sourceOrigin: 'oracle_metadata',
      sourceStatus: 'available_plaintext',
      sourceRepresentation: 'plaintext',
      sourceComplete: true,
      sourceAcquisitionMethod: 'ALL_ARGUMENTS',
      attributes: {
        kind: g.kind,
        packageName: g.packageName,
        overload: g.overload,
        subprogramId: g.subprogramId,
        arguments: g.args.map((a) => ({
          position: a.position,
          sequence: a.sequence,
          argumentName: a.argumentName,
          inOut: a.inOut,
          dataType: a.dataType,
          typeOwner: a.typeOwner,
          typeName: a.typeName,
        })),
      },
    });
    metrics.programUnitsIndexed += 1;
    metrics.signaturesIndexed += 1;
  }

  for (const src of sources) {
    metrics.sourceFilesScanned += 1;
    const ext =
      (src.metadata?.sourceExtension as string) ||
      (src.sourceOrigin === 'oracle_metadata'
        ? `.${src.objectType}`
        : path.extname(src.sourcePath).toUpperCase()) ||
      '.SRC';
    metrics.extensionsDiscovered[ext] = (metrics.extensionsDiscovered[ext] ?? 0) + 1;

    const id = stage2ObjectId(src.owner, src.objectType, src.objectName);
    const viaUnwrap = src.parserInputRepresentation === 'unwrapped_plaintext';

    if (src.sourceRepresentation === 'plaintext' || src.sourceStatus === 'available_plaintext') {
      metrics.plaintextPlsqlObjects += 1;
    }
    if (src.sourceRepresentation === 'oracle_wrapped' || src.sourceStatus === 'wrapped') {
      metrics.wrappedPlsqlObjects += 1;
      metrics.wrappedObjectsTotal += 1;
      if (src.objectType === 'PACKAGE_BODY') metrics.wrappedPackageBodies += 1;
      else if (src.objectType === 'PACKAGE') metrics.wrappedPackagesOrSpecs += 1;
      else if (src.objectType === 'FUNCTION') metrics.wrappedFunctions += 1;
      else if (src.objectType === 'PROCEDURE') metrics.wrappedProcedures += 1;
      else if (src.objectType === 'TYPE') metrics.wrappedTypes += 1;
      else if (src.objectType === 'TYPE_BODY') metrics.wrappedTypeBodies += 1;
    }
    if (src.sourceStatus === 'partial') metrics.partialSourceObjects += 1;
    if (src.sourceStatus === 'inaccessible') metrics.inaccessibleSourceObjects += 1;
    if (src.sourceStatus === 'empty') metrics.emptySourceObjects += 1;

    if (src.unwrap && src.sourceRepresentation === 'oracle_wrapped') {
      metrics.unwrapAttempted += 1;
      if (src.unwrap.status === 'unwrapped') metrics.unwrapSucceeded += 1;
      else if (src.unwrap.status === 'unwrap_failed') metrics.unwrapFailed += 1;
      else if (src.unwrap.status === 'unsupported_wrap_format') {
        metrics.unwrapUnsupported += 1;
        metrics.unsupportedWrapFormat += 1;
      } else if (src.unwrap.status === 'unwrap_unavailable') {
        metrics.unwrapUnavailable += 1;
      }
    }

    let parseStatus: Stage2SourceObject['parseStatus'] = 'ok';
    if (src.parserInputRepresentation === 'none') {
      parseStatus = src.sourceStatus === 'wrapped' ? 'skipped' : 'failed';
      if (src.sourceStatus === 'wrapped') {
        metrics.wrappedBodiesRemainingUnresolved += 1;
        const rbId = `runtime:${id}:oracle_wrapped_source`;
        runtimeBoundaryNodeIds.add(rbId);
        runtimeBoundaries.push({
          id: rbId,
          boundaryType:
            src.unwrap?.status === 'unwrap_unavailable'
              ? 'unwrap_unavailable'
              : 'oracle_wrapped_source',
          sourcePath: src.sourcePath,
          symbol: `${src.owner}.${src.objectName}`,
          missingRuntimeValue: 'unwrapped_plaintext',
          evidenceRefs: [src.sourcePath, ...(src.unwrap?.diagnostics ?? [])],
          confidenceClass: 'unresolved',
        });
        addEdge(
          makeEdge({
            edgeKind: 'HAS_RUNTIME_BOUNDARY',
            fromId: id,
            toId: rbId,
            confidenceClass: 'unresolved',
            provenance: [baseProv(src, 'wrapped_source_boundary')],
          }),
        );
      }
    }

    const obj: Stage2SourceObject = {
      id,
      owner: src.owner,
      objectName: src.objectName,
      objectType: src.objectType,
      sourcePath: src.sourcePath,
      moduleDir: path.dirname(src.sourcePath),
      sourceExtension: ext,
      sourceHash: src.sourceHash,
      sourceSize: src.sourceLength,
      parseStatus,
      sourceOrigin: src.sourceOrigin,
      sourceStatus: src.sourceStatus,
      sourceRepresentation: src.sourceRepresentation,
      sourceComplete: src.sourceComplete,
      sourceAcquisitionMethod: src.sourceAcquisitionMethod ?? null,
    };
    materializeObject(obj);
    metrics.objectsIndexed += 1;

    if (src.objectType === 'VIEW') metrics.viewsIndexed += 1;
    else if (src.objectType === 'PACKAGE') {
      metrics.packageSpecsIndexed += 1;
      specs.set(`${src.owner}.${src.objectName}`, id);
    } else if (src.objectType === 'PACKAGE_BODY') {
      metrics.packageBodiesIndexed += 1;
      bodies.set(`${src.owner}.${src.objectName}`, id);
    } else if (src.objectType === 'TRIGGER') metrics.triggersIndexed += 1;
    else if (src.objectType === 'FUNCTION') metrics.functionsIndexed += 1;
    else if (src.objectType === 'PROCEDURE') metrics.proceduresIndexed += 1;
    else if (src.objectType === 'TYPE' || src.objectType === 'TYPE_BODY') metrics.typesIndexed += 1;

    const text = src.parserInputText;
    if (!text) continue;

    if (viaUnwrap && src.objectType === 'PACKAGE_BODY') {
      metrics.unwrappedPackageBodiesParsed += 1;
    }

    for (const b of detectDynamicBoundaries(text)) {
      metrics.dynamicSqlBoundaries += 1;
      const rbId = `runtime:${id}:${b.boundaryType}`;
      runtimeBoundaryNodeIds.add(rbId);
      runtimeBoundaries.push({
        id: rbId,
        boundaryType: b.boundaryType,
        sourcePath: src.sourcePath,
        symbol: b.symbol,
        missingRuntimeValue: 'runtime_sql_or_object_name',
        evidenceRefs: [src.sourcePath, b.symbol],
        confidenceClass: 'runtime_only',
      });
      addEdge(
        makeEdge({
          edgeKind: 'HAS_RUNTIME_BOUNDARY',
          fromId: id,
          toId: rbId,
          confidenceClass: 'runtime_only',
          provenance: [
            baseProv(src, b.boundaryType, b.symbol, { confidenceClass: 'runtime_only' }),
          ],
        }),
        viaUnwrap,
      );
    }

    if (
      src.objectType === 'VIEW' ||
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FORCE\s+)?VIEW\b/i.test(text)
    ) {
      const lineage = extractViewLineage(text);
      for (const r of lineage.reads) {
        const resolved = resolveAndMaterialize(src.owner, r.qualified, 'read');
        const confidenceClass = edgeConfidence(resolved);
        addEdge(
          makeEdge({
            edgeKind: 'READS_FROM',
            fromId: id,
            toId: resolved.id,
            confidenceClass,
            provenance: [baseProv(src, 'view_FROM', r.raw, { confidenceClass })],
            attributes: { alias: r.alias, resolvedObjectType: resolved.objectType },
          }),
          viaUnwrap,
        );
        metrics.viewReadEdges += 1;
        metrics.selectOperations += 1;
      }
      for (const j of lineage.joins) {
        const resolved = resolveAndMaterialize(src.owner, j.qualified, 'read');
        const conf =
          j.conditionStatus === 'unresolved' ? 'unresolved' : edgeConfidence(resolved);
        addEdge(
          makeEdge({
            edgeKind: 'JOINS_TO',
            fromId: id,
            toId: resolved.id,
            confidenceClass: conf,
            provenance: [baseProv(src, 'view_JOIN', j.raw, { confidenceClass: conf })],
            attributes: {
              alias: j.alias,
              joinType: j.joinType,
              onClause: j.onClause,
              parsedPairs: j.parsedPairs,
              conditionStatus: j.conditionStatus,
              resolvedObjectType: resolved.objectType,
            },
          }),
          viaUnwrap,
        );
        metrics.viewJoinEdges += 1;
        addEdge(
          makeEdge({
            edgeKind: 'READS_FROM',
            fromId: id,
            toId: resolved.id,
            confidenceClass: edgeConfidence(resolved),
            provenance: [baseProv(src, 'view_JOIN_as_read', j.raw)],
            attributes: { alias: j.alias, via: 'JOIN', resolvedObjectType: resolved.objectType },
          }),
          viaUnwrap,
        );
        metrics.viewReadEdges += 1;
      }
      if (lineage.unresolvedConstructs.includes('CTE')) obj.parseStatus = 'partial';
    }

    if (
      src.objectType === 'PACKAGE' ||
      src.objectType === 'PACKAGE_BODY' ||
      src.objectType === 'PROCEDURE' ||
      src.objectType === 'FUNCTION' ||
      src.objectType === 'TRIGGER' ||
      src.objectType === 'TYPE_BODY'
    ) {
      const segments = computeAttributionSegments(src, id, text, programUnitsByName);

      for (const seg of segments) {
        for (const d of extractDmlTargets(seg.text)) {
          const resolved = resolveAndMaterialize(src.owner, d.qualified, 'dml');
          const confidenceClass = edgeConfidence(resolved);
          if (d.operation === 'SELECT') {
            addEdge(
              makeEdge({
                edgeKind: 'READS_FROM',
                fromId: seg.fromId,
                toId: resolved.id,
                confidenceClass,
                provenance: [baseProv(src, 'SELECT_FROM', d.raw, { confidenceClass })],
                attributes: {
                  programUnitResolution: seg.programUnitResolution,
                  resolvedObjectType: resolved.objectType,
                },
              }),
              viaUnwrap,
            );
            metrics.programReadEdges += 1;
            metrics.selectOperations += 1;
          } else {
            addEdge(
              makeEdge({
                edgeKind: 'WRITES_TO',
                fromId: seg.fromId,
                toId: resolved.id,
                confidenceClass,
                provenance: [baseProv(src, d.operation, d.raw, { confidenceClass })],
                attributes: {
                  operation: d.operation,
                  programUnitResolution: seg.programUnitResolution,
                  resolvedObjectType: resolved.objectType,
                },
              }),
              viaUnwrap,
            );
            metrics.programWriteEdges += 1;
            if (d.operation === 'INSERT') metrics.insertOperations += 1;
            if (d.operation === 'UPDATE') metrics.updateOperations += 1;
            if (d.operation === 'DELETE') metrics.deleteOperations += 1;
            if (d.operation === 'MERGE') metrics.mergeOperations += 1;
          }
        }

        // PL/SQL SELECT ... FROM / JOIN reads (cursor SQL, inline queries, etc.)
        for (const r of extractProgramSqlReads(seg.text)) {
          const resolved = resolveAndMaterialize(src.owner, r.qualified, 'read');
          const confidenceClass = edgeConfidence(resolved);
          addEdge(
            makeEdge({
              edgeKind: 'READS_FROM',
              fromId: seg.fromId,
              toId: resolved.id,
              confidenceClass,
              provenance: [baseProv(src, `program_${r.via}`, r.raw, { confidenceClass })],
              attributes: {
                via: r.via,
                programUnitResolution: seg.programUnitResolution,
                resolvedObjectType: resolved.objectType,
              },
            }),
            viaUnwrap,
          );
          metrics.programReadEdges += 1;
          metrics.selectOperations += 1;
        }

        for (const c of extractDirectCalls(seg.text)) {
          const pkgResolved = resolveAndMaterialize(src.owner, c.packageQualified, 'read');
          let toId = pkgResolved.id;
          let confidenceClass = edgeConfidence(pkgResolved);
          let resolvedTargetProgramUnit: string | null = null;
          if (pkgResolved.confidence !== 'unresolved') {
            const nameKey = `${pkgResolved.owner}|${pkgResolved.objectName}|${c.member}`;
            const candidates = programUnitsByName.get(nameKey);
            if (candidates?.length) {
              const chosen = [...candidates].sort((a, b) => a.overload - b.overload)[0]!;
              toId = chosen.id;
              resolvedTargetProgramUnit = chosen.id;
              confidenceClass = 'exact_from_source';
            }
          }
          addEdge(
            makeEdge({
              edgeKind: 'CALLS',
              fromId: seg.fromId,
              toId,
              confidenceClass,
              provenance: [baseProv(src, 'direct_call', c.raw, { confidenceClass })],
              attributes: {
                member: c.member,
                programUnitResolution: seg.programUnitResolution,
                resolvedTargetProgramUnit,
              },
            }),
            viaUnwrap,
          );
          metrics.programCallEdges += 1;
        }
      }
    }

    if (src.objectType === 'TRIGGER') {
      const meta = extractTriggerMeta(text);
      const metaTableOwner = src.metadata?.tableOwner as string | undefined;
      const metaTableName = src.metadata?.tableName as string | undefined;
      const qualifiedTarget: QualifiedName | null =
        metaTableOwner && metaTableName
          ? { owner: metaTableOwner, objectName: metaTableName, wasQualified: true }
          : meta.target;
      if (qualifiedTarget) {
        const resolved = resolveAndMaterialize(src.owner, qualifiedTarget, 'read');
        const confidenceClass = edgeConfidence(resolved);
        const triggeringEventStr = src.metadata?.triggeringEvent as string | undefined;
        const events = triggeringEventStr
          ? parseTriggerEventsFromMetadataString(triggeringEventStr)
          : meta.events;
        addEdge(
          makeEdge({
            edgeKind: 'ATTACHED_TO',
            fromId: id,
            toId: resolved.id,
            confidenceClass,
            provenance: [
              baseProv(src, 'CREATE_TRIGGER_ON', qualifiedTarget.objectName, { confidenceClass }),
            ],
            attributes: {
              events,
              eventSource: triggeringEventStr ? 'ALL_TRIGGERS.TRIGGERING_EVENT' : 'parsed_from_body',
              timing: meta.timing ?? (src.metadata?.triggerType as string | undefined) ?? null,
              triggerName: meta.triggerName ?? src.objectName,
              triggeringEvent: triggeringEventStr ?? null,
            },
          }),
          viaUnwrap,
        );
        metrics.triggerTargetEdges += 1;
      }
    }
    // Architect §13: drop heavy buffers after parse; keep VIEW/AKT_DANE text for CLI acceptance.
    src.sourceLines = null;
    if (src.sourceRepresentation === 'oracle_wrapped') {
      src.sourceText = '';
    }
    if (src.objectType !== 'VIEW' && src.objectName !== 'AKT_DANE') {
      src.parserInputText = '';
      src.sourceText = '';
    }
  }

  for (const [key, specId] of specs) {
    const bodyId = bodies.get(key);
    if (bodyId) {
      metrics.specBodyPairs += 1;
      addEdge(
        makeEdge({
          edgeKind: 'SPEC_BODY_OF',
          fromId: bodyId,
          toId: specId,
          confidenceClass: 'strong_static_inference',
          provenance: [
            {
              confidenceClass: 'strong_static_inference',
              sourceKind: 'oracle_metadata',
              sourcePath: 'spec_body_match',
              extractionMechanism: 'package_name_match',
              rawValue: key,
              evidenceRefs: [specId, bodyId],
            },
          ],
        }),
      );
    } else metrics.specWithoutBody += 1;
  }
  for (const [key] of bodies) {
    if (!specs.has(key)) metrics.bodyWithoutSpec += 1;
  }

  // Link package SPEC/BODY containers to their program units (best-effort — simple
  // REFERENCES edges; Stage 2 does not attempt CONTAINS-vs-REFERENCES semantics).
  for (const g of programUnitGroups) {
    if (!g.packageName) continue;
    const key = `${g.owner}.${g.packageName}`;
    const containerId = bodies.get(key) ?? specs.get(key);
    if (!containerId) continue;
    addEdge(
      makeEdge({
        edgeKind: 'REFERENCES',
        fromId: containerId,
        toId: g.id,
        confidenceClass: 'strong_static_inference',
        provenance: [
          {
            confidenceClass: 'strong_static_inference',
            sourceKind: 'oracle_metadata',
            sourcePath: `ALL_ARGUMENTS:${g.owner}.${g.packageName}`,
            extractionMechanism: 'ALL_ARGUMENTS_program_unit_link',
            rawValue: g.objectName,
            evidenceRefs: [containerId, g.id],
          },
        ],
      }),
    );
    metrics.programReferenceEdges += 1;
  }

  for (const dep of opts.dependencies ?? []) {
    const fromType = mapOracleObjectType(dep.type);
    const toType = mapOracleObjectType(dep.referencedType);
    const fromId = stage2ObjectId(dep.owner, fromType, dep.name);
    const toId = stage2ObjectId(dep.referencedOwner, toType, dep.referencedName);
    ensureMaterialized(fromId, dep.owner, dep.name, fromType, 'ALL_DEPENDENCIES_stub');
    ensureMaterialized(toId, dep.referencedOwner, dep.referencedName, toType, 'ALL_DEPENDENCIES_stub');
    addEdge(
      makeEdge({
        edgeKind: 'REFERENCES',
        fromId,
        toId,
        confidenceClass: 'exact_from_source',
        provenance: [
          {
            confidenceClass: 'exact_from_source',
            sourceKind: 'oracle_metadata',
            sourcePath: `ALL_DEPENDENCIES:${dep.owner}.${dep.name}`,
            extractionMechanism: 'ALL_DEPENDENCIES',
            rawValue: `${dep.referencedOwner}.${dep.referencedName}`,
            evidenceRefs: [
              `ALL_DEPENDENCIES:${dep.owner}.${dep.name}->${dep.referencedOwner}.${dep.referencedName}`,
            ],
          },
        ],
        attributes: {
          dependencyType: dep.dependencyType,
          referencedType: dep.referencedType,
        },
      }),
    );
    metrics.dependencyEdges += 1;
    metrics.programReferenceEdges += 1;
  }

  metrics.argumentSignaturesIndexed = (opts.arguments ?? []).length;
  metrics.argumentRowsBuffered = (opts.arguments ?? []).length;
  metrics.peakSourceObjectsBuffered = sources.length;
  if (opts.argumentScan) {
    metrics.argumentRowsAvailable = opts.argumentScan.argumentRowsAvailable;
    metrics.argumentRowsRead = opts.argumentScan.argumentRowsRead;
    metrics.argumentRowsPersisted = opts.argumentScan.argumentRowsPersisted;
    metrics.argumentScanComplete = opts.argumentScan.argumentScanComplete;
  } else {
    metrics.argumentRowsAvailable = metrics.argumentSignaturesIndexed;
    metrics.argumentRowsRead = metrics.argumentSignaturesIndexed;
    metrics.argumentRowsPersisted = metrics.argumentSignaturesIndexed;
    metrics.argumentScanComplete = true;
  }
  metrics.persistedDuplicateEdges = 0;

  const integrity = computeGraphIntegrity(
    edges,
    materializedNodeIds,
    baseCanonicalNodeIds,
    runtimeBoundaryNodeIds,
  );
  metrics.danglingEdgesPersisted = integrity.danglingEdgesPersisted;
  metrics.brokenEndpointsAgainstUnionGraph = integrity.brokenEndpointsAgainstUnionGraph;
  metrics.materializedNodes = materializedNodeIds.size;
  metrics.baseGraphNodes = baseCanonicalNodeIds.size;
  metrics.referencedEndpoints = referencedEndpointIds.size;
  metrics.resolvedEndpoints = resolvedEndpointIds.size;
  metrics.unresolvedEndpoints = unresolvedEndpointIds.size;
  metrics.runtimeBoundaryEndpoints = runtimeBoundaryNodeIds.size;

  const gaps = [
    ...(opts.knownStaticGaps ?? []),
    !UNWRAP_SEARCH_REPORT.existingUnwrapToolFound
      ? 'existingUnwrapToolFound=false — wrapped PL/SQL bodies remain unresolved until an approved unwrap tool is provided'
      : null,
  ].filter(Boolean) as string[];

  return {
    contractVersion: STAGE2_CONTRACT_VERSION,
    sourceStage: STAGE2_SOURCE_STAGE,
    identityVersion: 'teta-aia-canonical-id-v1',
    implementationStatus: gaps.length
      ? 'implemented_with_known_static_gaps_awaiting_review'
      : 'implemented_awaiting_review',
    objects,
    edges: [...edgeById.values()],
    runtimeBoundaries,
    metrics,
    audit,
    provider: opts.provider ?? null,
    capabilities: opts.capabilities ?? null,
    owners: opts.owners ?? null,
    blockedReason: gaps.length ? gaps.join('; ') : null,
  };
}

export async function extractFromNormalizedSources(
  sources: Stage2NormalizedSource[] | AsyncIterable<Stage2NormalizedSource> | Iterable<Stage2NormalizedSource>,
  opts: ExtractOpts = {},
): Promise<Stage2ExtractionResult> {
  if (Array.isArray(sources)) return extractFromNormalizedSourcesSync(sources, opts);
  const list: Stage2NormalizedSource[] = [];
  if (typeof (sources as AsyncIterable<Stage2NormalizedSource>)[Symbol.asyncIterator] === 'function') {
    for await (const s of sources as AsyncIterable<Stage2NormalizedSource>) list.push(s);
  } else {
    for (const s of sources as Iterable<Stage2NormalizedSource>) list.push(s);
  }
  return extractFromNormalizedSourcesSync(list, opts);
}

/** Filesystem / fixture entry used by unit tests. */
export function extractOracleSourceIndexStage2(input: {
  sourceRoot?: string | null;
  files?: Array<{ sourcePath: string; content: string; owner?: string }>;
  defaultOwner?: string;
  inventory?: Array<{ owner: string; objectName: string; objectType: Stage2ObjectType }>;
  synonyms?: Array<{ owner: string; synonymName: string; tableOwner: string; tableName: string }>;
}): Stage2ExtractionResult {
  const provider = new FilesystemOracleSourceProvider({
    sourceRoot: input.sourceRoot,
    files: input.files,
    defaultOwner: input.defaultOwner,
  });
  const inventoryIndex = input.inventory ? buildInventoryIndex(input.inventory) : undefined;
  const synonyms = input.synonyms
    ? new Map(
        input.synonyms.map((s) => [
          `${normalizeOracleName(s.owner)}|${normalizeOracleName(s.synonymName)}`,
          { owner: s.tableOwner, objectName: s.tableName },
        ]),
      )
    : undefined;
  return extractFromNormalizedSourcesSync([...provider.iterateSources()], {
    provider: 'filesystem',
    inventoryIndex,
    synonyms,
  });
}

export function comparePayrollViewLineage(result: Stage2ExtractionResult): {
  payrollViewLineageAcceptanceStatus: string;
  extractedReads: string[];
  mismatches: string[];
  matches: string[];
  payrollViewSourceAcquisitionMethod?: string | null;
  payrollViewSourceComplete?: boolean | null;
} {
  const viewObj = result.objects.find(
    (o) => o.objectName === 'NT_KP_PLC_SKLADNIKI_OBL' && o.objectType === 'VIEW',
  );
  const viewId =
    viewObj?.id ??
    stage2ObjectId(viewObj?.owner ?? 'TETA_ADMIN', 'VIEW', 'NT_KP_PLC_SKLADNIKI_OBL');
  const expectedBase = 'L_SKL_OBL';
  const reads = result.edges
    .filter((e) => e.edgeKind === 'READS_FROM' && e.fromId === viewId)
    .map((e) => e.toId);
  const hasBase = reads.some(
    (r) => r.includes(`:${expectedBase}`) || r.endsWith(`:${expectedBase}`),
  );
  const matches: string[] = [];
  const mismatches: string[] = [];
  if (viewObj) matches.push('view_indexed');
  else mismatches.push('view_indexed');
  if (hasBase) matches.push('base_L_SKL_OBL');
  else mismatches.push('base_L_SKL_OBL');
  return {
    payrollViewLineageAcceptanceStatus:
      mismatches.length === 0
        ? 'passed'
        : result.implementationStatus === 'blocked_source_contract_problem'
          ? 'blocked_missing_view_source'
          : 'failed',
    extractedReads: reads,
    mismatches,
    matches,
    payrollViewSourceAcquisitionMethod: viewObj?.sourceAcquisitionMethod ?? null,
    payrollViewSourceComplete: viewObj?.sourceComplete ?? null,
  };
}

export function scanStage2ExtractorForHardcoding(src: string): {
  hardcodedPayrollLineageMappings: number;
  hardcodedTwgMappings: number;
  hardcodedCurrentPositionMappings: number;
} {
  const seed = src.split('comparePayrollViewLineage')[0] ?? src;
  return {
    hardcodedPayrollLineageMappings: (seed.match(/L_SKL_OBL/g) ?? []).length,
    hardcodedTwgMappings: (seed.match(/L_GR_CZ_PRACY/g) ?? []).length,
    hardcodedCurrentPositionMappings: (seed.match(/NT_KP_KDR_STANOWISKA/g) ?? []).length,
  };
}

export function buildDerivedLookupIndex(result: Stage2ExtractionResult): Array<{
  objectId: string;
  viewsReading: string[];
  packagesReading: string[];
  packagesWriting: string[];
  programReaders: string[];
  triggersAttached: string[];
  directCallers: string[];
  directCallees: string[];
  objectsRead: string[];
  objectsWritten: string[];
  routinesCalled: string[];
  directSourceObjects: string[];
}> {
  const typeById = new Map<string, Stage2ObjectType>();
  for (const o of result.objects) typeById.set(o.id, o.objectType);

  const byId = new Map<
    string,
    {
      objectId: string;
      viewsReading: Set<string>;
      packagesReading: Set<string>;
      packagesWriting: Set<string>;
      programReaders: Set<string>;
      triggersAttached: Set<string>;
      directCallers: Set<string>;
      directCallees: Set<string>;
      objectsRead: Set<string>;
      objectsWritten: Set<string>;
      routinesCalled: Set<string>;
      directSourceObjects: Set<string>;
    }
  >();

  const ensure = (id: string) => {
    let row = byId.get(id);
    if (!row) {
      row = {
        objectId: id,
        viewsReading: new Set(),
        packagesReading: new Set(),
        packagesWriting: new Set(),
        programReaders: new Set(),
        triggersAttached: new Set(),
        directCallers: new Set(),
        directCallees: new Set(),
        objectsRead: new Set(),
        objectsWritten: new Set(),
        routinesCalled: new Set(),
        directSourceObjects: new Set(),
      };
      byId.set(id, row);
    }
    return row;
  };

  const PACKAGE_TYPES = new Set<Stage2ObjectType>(['PACKAGE', 'PACKAGE_BODY']);
  const PROGRAM_TYPES = new Set<Stage2ObjectType>([
    'PROGRAM_UNIT',
    'PROCEDURE',
    'FUNCTION',
    'TRIGGER',
    'TYPE_BODY',
  ]);

  for (const o of result.objects) ensure(o.id);
  for (const e of result.edges) {
    const from = ensure(e.fromId);
    const to = ensure(e.toId);
    const fromType = typeById.get(e.fromId);
    if (e.edgeKind === 'READS_FROM') {
      from.objectsRead.add(e.toId);
      from.directSourceObjects.add(e.toId);
      // Classify by the reader's own object type — a reader is either a VIEW,
      // a package/body, or a standalone program unit, never dual-filled.
      if (fromType === 'VIEW') to.viewsReading.add(e.fromId);
      else if (fromType && PACKAGE_TYPES.has(fromType)) to.packagesReading.add(e.fromId);
      else if (fromType && PROGRAM_TYPES.has(fromType)) to.programReaders.add(e.fromId);
    } else if (e.edgeKind === 'WRITES_TO') {
      from.objectsWritten.add(e.toId);
      to.packagesWriting.add(e.fromId);
    } else if (e.edgeKind === 'CALLS') {
      from.routinesCalled.add(e.toId);
      from.directCallees.add(e.toId);
      to.directCallers.add(e.fromId);
    } else if (e.edgeKind === 'ATTACHED_TO') {
      to.triggersAttached.add(e.fromId);
    } else if (e.edgeKind === 'JOINS_TO') {
      from.directSourceObjects.add(e.toId);
      from.objectsRead.add(e.toId);
    }
  }

  return [...byId.values()]
    .map((r) => ({
      objectId: r.objectId,
      viewsReading: [...r.viewsReading].sort(),
      packagesReading: [...r.packagesReading].sort(),
      packagesWriting: [...r.packagesWriting].sort(),
      programReaders: [...r.programReaders].sort(),
      triggersAttached: [...r.triggersAttached].sort(),
      directCallers: [...r.directCallers].sort(),
      directCallees: [...r.directCallees].sort(),
      objectsRead: [...r.objectsRead].sort(),
      objectsWritten: [...r.objectsWritten].sort(),
      routinesCalled: [...r.routinesCalled].sort(),
      directSourceObjects: [...r.directSourceObjects].sort(),
    }))
    .sort((a, b) => a.objectId.localeCompare(b.objectId));
}

export { stage2ObjectId, normalizeOracleName, sha256 };
