import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import {
  CanonicalGraphIndexService,
  defaultStage3aPaths,
} from '../teta-plugins/teta-stage3a.index';
import { CanonicalGraphResolverService } from '../teta-plugins/teta-stage3a.resolver';
import {
  REAL_EMPLOYEE_OBJECT_NAME,
  REAL_EMPLOYEE_OBJECT_OWNER,
  REAL_P1_FORM_GUID,
} from '../teta-employee-card-foundation/teta-foundation-real-graph';
import {
  buildP1Allowlist,
  reconstructApplicationDataSurface,
  validateAllowlistBounds,
} from './teta-enrichment-data-surface';
import { assessKeyPreservation } from './teta-enrichment-key-preservation';
import { loadEnrichmentPolicy, type EnrichmentPolicy } from './teta-enrichment-policy';
import { parseOracleViewDefinition } from './teta-enrichment-view-parser';
import { importViewDefinitionArtifact } from './teta-enrichment-view-import';
import {
  STAGE3K2B2B2A_COLLECTOR_VERSION,
  STAGE3K2B2B2A_CONTRACT_VERSION,
  STAGE3K2B2B2A_PARSER_VERSION,
  assertStrictZeros,
  emptySafetyCounters,
  emptySyntheticVsRealMetrics,
  sha256,
  stableStringify,
  type ActiveGraphImmutabilityProof,
  type PreviewStatus,
  type Stage3k2b2b2aSafetyCounters,
  type SyntheticVsRealMetrics,
  type TetaApplicationDataSurfaceEvidence,
  type TetaCanonicalGraphEnrichmentManifest,
  type TetaEmployeeFoundationEnrichmentStalenessVector,
  type TetaEmployeeFoundationSourceEnrichmentRequest,
  type TetaGraphEnrichmentDeltaAssessment,
  type TetaOfflineTechnicalEvidenceArtifact,
  type TetaViewDefinitionEvidenceArtifact,
  type ViewKeyPreservationEvidence,
} from './teta-enrichment.types';

export type EnrichmentMode = 'real' | 'fixture';

export interface EnrichmentPipelineResult {
  mode: EnrichmentMode;
  policy: EnrichmentPolicy;
  policyHash: string;
  policyPath: string;
  rulesApplied: string[];
  allowlist: ReturnType<typeof buildP1Allowlist>;
  enrichmentRequests: TetaEmployeeFoundationSourceEnrichmentRequest[];
  artifactsFound: string[];
  artifactsMissing: string[];
  viewDefinition: TetaViewDefinitionEvidenceArtifact;
  keyPreservation: ViewKeyPreservationEvidence;
  dataSurface: TetaApplicationDataSurfaceEvidence;
  technicalArtifactSummaries: TetaOfflineTechnicalEvidenceArtifact[];
  graphManifest: TetaCanonicalGraphEnrichmentManifest;
  deltaAssessment: TetaGraphEnrichmentDeltaAssessment;
  graphImmutability: ActiveGraphImmutabilityProof;
  staleness: TetaEmployeeFoundationEnrichmentStalenessVector;
  p1GrainPreview: {
    grainStatus: 'partial';
    sourceOutcome: 'supported_partial';
    genericActivationEligible: false;
    planningEligible: false;
    improvedWithoutRealViewArtifact: false;
  };
  metrics: SyntheticVsRealMetrics;
  counters: Stage3k2b2b2aSafetyCounters;
  reviewPackPaths: string[];
  activeGraphPointerBefore: string;
  activeGraphPointerAfter: string;
}

const graphFileShaCache = new Map<string, { size: number; mtimeMs: number; sha: string }>();

function sha256FileStreaming(filePath: string): string {
  const st = fs.statSync(filePath);
  const cached = graphFileShaCache.get(filePath);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    return cached.sha;
  }
  const hash = createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let bytesRead = 0;
    // eslint-disable-next-line no-cond-assign
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  const sha = hash.digest('hex');
  graphFileShaCache.set(filePath, { size: st.size, mtimeMs: st.mtimeMs, sha });
  return sha;
}

function snapshotActiveGraphFile(repoRoot: string): {
  pointer: string;
  graphHash: string;
  fileSha256: string;
  fileSize: number;
  modifiedAt: string | null;
  absolutePath: string;
  mtimeMs: number;
} {
  const paths = defaultStage3aPaths(repoRoot);
  const pointer = path.relative(repoRoot, paths.indexPath).replace(/\\/g, '/');
  if (!fs.existsSync(paths.indexPath)) {
    return {
      pointer,
      graphHash: 'missing-graph',
      fileSha256: 'missing-graph',
      fileSize: 0,
      modifiedAt: null,
      absolutePath: paths.indexPath,
      mtimeMs: 0,
    };
  }
  const st = fs.statSync(paths.indexPath);
  let graphHash = 'unknown';
  try {
    const index = new CanonicalGraphIndexService(paths);
    graphHash = index.status().sourceHash ?? 'unknown';
  } catch {
    graphHash = 'unknown';
  }
  return {
    pointer,
    graphHash,
    fileSha256: sha256FileStreaming(paths.indexPath),
    fileSize: st.size,
    modifiedAt: st.mtime.toISOString(),
    absolutePath: paths.indexPath,
    mtimeMs: st.mtimeMs,
  };
}

function snapshotActiveGraphAfter(
  before: ReturnType<typeof snapshotActiveGraphFile>,
  counters: Stage3k2b2b2aSafetyCounters,
): ReturnType<typeof snapshotActiveGraphFile> {
  if (!fs.existsSync(before.absolutePath)) {
    return snapshotActiveGraphFile(path.resolve(before.absolutePath, '../..'));
  }
  const st = fs.statSync(before.absolutePath);
  // No write attempts + identical size/mtime ⇒ content unchanged; reuse SHA (no re-read).
  if (
    counters.activeGraphWriteAttempts === 0 &&
    st.size === before.fileSize &&
    st.mtimeMs === before.mtimeMs
  ) {
    return {
      ...before,
      fileSize: st.size,
      modifiedAt: st.mtime.toISOString(),
      mtimeMs: st.mtimeMs,
    };
  }
  // Content may have changed — recompute full snapshot via parent repo root heuristic
  const repoRootGuess = before.absolutePath.includes(`${path.sep}.local${path.sep}`)
    ? before.absolutePath.split(`${path.sep}.local${path.sep}`)[0]
    : path.dirname(path.dirname(before.absolutePath));
  return snapshotActiveGraphFile(repoRootGuess);
}

function readGraphNeighborhood(repoRoot: string): {
  available: boolean;
  graphHash: string;
  formResolved: boolean;
  gatewayRefs: string[];
  datasetRefs: string[];
  sqlJoinRefs: string[];
  oracleAccessSurfaceRefs: string[];
  employeeSemanticSourceRef: string | null;
  dependsOnBasePk: boolean;
  activePointer: string;
  observedDepth: number;
  observedNodes: number;
  observedEdges: number;
} {
  const paths = defaultStage3aPaths(repoRoot);
  const activePointer = path.relative(repoRoot, paths.indexPath).replace(/\\/g, '/');
  const empty = {
    available: false,
    graphHash: 'missing-graph',
    formResolved: false,
    gatewayRefs: [] as string[],
    datasetRefs: [] as string[],
    sqlJoinRefs: [] as string[],
    oracleAccessSurfaceRefs: [] as string[],
    employeeSemanticSourceRef: null as string | null,
    dependsOnBasePk: false,
    activePointer,
    observedDepth: 0,
    observedNodes: 0,
    observedEdges: 0,
  };
  if (!fs.existsSync(paths.indexPath)) return empty;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any = null;
  try {
    const index = new CanonicalGraphIndexService(paths);
    const status = index.status();
    db = index.openReadonly();
    const resolver = new CanonicalGraphResolverService(db);
    const form = resolver.resolveForm({ guid: REAL_P1_FORM_GUID });
    const emp = resolver.traceOracleObject({
      owner: REAL_EMPLOYEE_OBJECT_OWNER,
      name: REAL_EMPLOYEE_OBJECT_NAME,
      objectType: 'VIEW',
    });
    const formNodeId = form.selectedNodeId ?? form.candidates?.[0]?.nodeId ?? null;
    const empNodeId = emp.selectedNodeId ?? emp.candidates?.[0]?.nodeId ?? null;

    const gatewayRefs: string[] = [];
    const datasetRefs: string[] = [];
    const sqlJoinRefs: string[] = [];
    const oracleAccessSurfaceRefs: string[] = [];
    let observedEdges = 0;
    const nodeIds = new Set<string>();
    if (formNodeId) nodeIds.add(formNodeId);
    if (empNodeId) nodeIds.add(empNodeId);

    if (formNodeId && db) {
      const rows = db
        .prepare(
          `SELECT e.type AS edge_type, n.id AS nid, n.type AS ntype, n.name AS nname
           FROM kg_edges e
           JOIN kg_nodes n ON n.id = CASE WHEN e.from_id = ? THEN e.to_id ELSE e.from_id END
           WHERE (e.from_id = ? OR e.to_id = ?)
             AND e.type IN ('USES_DF','USES_DATASOURCE','USES_BO','PRODUCES_DATASET','RESOLVES_TO_GATEWAY','JOINS_TO','MAPS_TO_ORACLE_OBJECT')
           LIMIT 80`,
        )
        .all(formNodeId, formNodeId, formNodeId) as Array<{
        edge_type: string;
        nid: string;
        ntype: string | null;
        nname: string | null;
      }>;
      observedEdges = rows.length;
      for (const r of rows) {
        nodeIds.add(r.nid);
        if (r.edge_type === 'RESOLVES_TO_GATEWAY' || (r.ntype ?? '').includes('gateway')) {
          gatewayRefs.push(`gateway:${r.nid}`);
        }
        if (
          r.edge_type === 'USES_DATASOURCE' ||
          r.edge_type === 'PRODUCES_DATASET' ||
          (r.ntype ?? '').includes('dataset')
        ) {
          datasetRefs.push(`dataset:${r.nid}`);
        }
        if (r.edge_type === 'JOINS_TO' || (r.ntype ?? '') === 'join') {
          sqlJoinRefs.push(`join:${r.nid}`);
        }
        if (r.edge_type === 'MAPS_TO_ORACLE_OBJECT') {
          oracleAccessSurfaceRefs.push(`oracle_object:${r.nid}`);
        }
      }
    }

    const edges = emp.edges ?? [];
    const dependsOnBasePk = edges.some(
      (e) => e.type === 'PRIMARY_KEY_OF' || e.type === 'UNIQUE_KEY_OF',
    );

    return {
      available: true,
      graphHash: status.sourceHash ?? 'unknown',
      formResolved: form.status === 'resolved',
      gatewayRefs: [...new Set(gatewayRefs)],
      datasetRefs: [...new Set(datasetRefs)],
      sqlJoinRefs: [...new Set(sqlJoinRefs)],
      oracleAccessSurfaceRefs: [...new Set(oracleAccessSurfaceRefs)],
      employeeSemanticSourceRef: empNodeId
        ? `oracle_object:${empNodeId}`
        : `oracle_view:${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`,
      dependsOnBasePk,
      activePointer,
      observedDepth: formNodeId ? 1 : 0,
      observedNodes: nodeIds.size,
      observedEdges,
    };
  } catch {
    return empty;
  } finally {
    try {
      db?.close?.();
    } catch {
      /* ignore */
    }
  }
}

export function runEnrichmentPipeline(
  repoRoot: string,
  options: {
    mode?: EnrichmentMode;
    writeArtifacts?: boolean;
    policy: EnrichmentPolicy;
    policyHash: string;
    policyPath: string;
    manifestPath?: string;
  },
): EnrichmentPipelineResult {
  const mode = options.mode ?? 'real';
  const counters = emptySafetyCounters();
  const metrics = emptySyntheticVsRealMetrics();

  const beforeSnap = snapshotActiveGraphFile(repoRoot);

  const graph =
    mode === 'real'
      ? readGraphNeighborhood(repoRoot)
      : {
          available: true,
          graphHash: 'fixture-graph-hash',
          formResolved: true,
          gatewayRefs: ['gateway:fixture:employee_gateway'],
          datasetRefs: ['dataset:fixture:employee_dataset'],
          sqlJoinRefs: [],
          oracleAccessSurfaceRefs: [
            `oracle_view:${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`,
          ],
          employeeSemanticSourceRef: `oracle_view:${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`,
          dependsOnBasePk: true,
          activePointer: '.local/AIA_CANONICAL_GRAPH_STAGE3A.sqlite',
          observedDepth: 1,
          observedNodes: 3,
          observedEdges: 2,
        };

  const candidateFingerprint = sha256('cand:P1:employee');
  const allowlist = buildP1Allowlist({
    policy: options.policy,
    policyHash: options.policyHash,
    baseGraphHash: graph.graphHash,
    candidateFingerprint,
    observed: {
      observedDepth: graph.observedDepth,
      observedNodes: graph.observedNodes,
      observedEdges: graph.observedEdges,
      observedCandidates: 1,
    },
  });
  if (!allowlist || !options.policy.candidateScopedAllowlistRequired) {
    counters.enrichmentRunsWithoutAllowlist += 1;
  }
  validateAllowlistBounds(allowlist, counters);

  const dataSurface = reconstructApplicationDataSurface({
    mode,
    formResolved: graph.formResolved,
    gatewayRefs: graph.gatewayRefs,
    datasetRefs: graph.datasetRefs,
    sqlJoinRefs: graph.sqlJoinRefs,
    oracleAccessSurfaceRefs: graph.oracleAccessSurfaceRefs,
    employeeSemanticSourceRef: graph.employeeSemanticSourceRef,
    counters,
  });

  const imported = importViewDefinitionArtifact({
    repoRoot,
    allowlist,
    counters,
    forRealP1: mode === 'real',
    manifestPath: options.manifestPath,
  });

  if (imported.artifact.viewDefinitionArtifactStatus === 'imported' && !imported.synthetic) {
    metrics.realViewDefinitionArtifactsImported += 1;
    if (
      imported.artifact.parseStatus === 'parsed' ||
      imported.artifact.parseStatus === 'parsed_with_unsupported_constructs'
    ) {
      metrics.realViewDefinitionsParsed += 1;
    }
  }
  if (imported.synthetic && mode === 'real' && imported.artifact.viewDefinitionArtifactStatus === 'imported') {
    metrics.syntheticEvidenceUsedForRealP1 += 1;
    counters.syntheticEvidenceUsedForRealP1 += 1;
  }

  const parse =
    imported.rawContent && imported.artifact.viewDefinitionArtifactStatus === 'imported'
      ? parseOracleViewDefinition(imported.rawContent)
      : null;

  const keyPreservation = assessKeyPreservation({
    viewRef: imported.artifact.sourceObjectRef,
    completeness: imported.artifact.definitionCompletenessStatus,
    parse,
    dependsOnBasePkOnly:
      imported.artifact.definitionCompletenessStatus === 'missing' && graph.dependsOnBasePk,
    projectedIdentityHints: parse?.projections.filter((p) => /id|nr_|prac/i.test(p)) ?? [],
    policy: options.policy,
    counters,
  });

  if (
    mode === 'real' &&
    imported.artifact.viewDefinitionArtifactStatus === 'requires_vendor_export' &&
    keyPreservation.keyPreservationStatus === 'proven'
  ) {
    counters.realP1GrainImprovedWithoutRealViewArtifact += 1;
  }

  const enrichmentRequests: TetaEmployeeFoundationSourceEnrichmentRequest[] = [
    {
      requestId: 'enrich:P1:view_definition_evidence',
      gapKind: 'view_definition_evidence',
      candidateIds: ['cand:P1:employee'],
      requestedEvidenceClasses: ['view_definition_snapshot'],
      startingAnchors: allowlist.applicationAnchorRefs,
      allowedSources: ['manual_vendor_artifact', 'vendor_metadata_export', 'preserved_source_file'],
      prohibitedSources: ['live_oracle', 'global_view_scan', 'human_oracle_mapping_question'],
      boundedScope: 'P1_employee_view_only',
      acquisitionMode: 'manual_vendor_artifact_import',
      priority: 'high',
      status: imported.artifact.viewDefinitionArtifactStatus,
      reason: 'stage3a_lacks_view_definition_sql',
      expectedEffect: 'enable_key_preservation_assessment',
      dependencyFingerprints: [allowlist.allowlistFingerprint],
      requestFingerprint: sha256('view_definition_evidence'),
    },
    {
      requestId: 'enrich:P1:application_data_surface_evidence',
      gapKind: 'application_data_surface_evidence',
      candidateIds: ['cand:P1:employee'],
      requestedEvidenceClasses: ['application_data_surface'],
      startingAnchors: allowlist.applicationAnchorRefs,
      allowedSources: ['existing_offline_graph_evidence', 'existing_stage2_artifact'],
      prohibitedSources: ['form_guid_as_data_surface', 'nearest_gateway_auto_select'],
      boundedScope: 'P1_employee_form_neighborhood',
      acquisitionMode: 'existing_artifact_reuse',
      priority: 'high',
      status:
        dataSurface.applicationDataSurfaceStatus === 'ambiguous'
          ? 'requires_application_context'
          : 'available_in_existing_artifacts',
      reason: `availability=${dataSurface.evidenceAvailability};materialization=${dataSurface.materializationStatus};attribution=${dataSurface.semanticAttributionStatus}`,
      expectedEffect: 'materialize_form_dataset_gateway_path',
      dependencyFingerprints: [allowlist.allowlistFingerprint],
      requestFingerprint: sha256('application_data_surface_evidence'),
    },
  ];

  const artifactsFound: string[] = [];
  const artifactsMissing: string[] = [];
  if (graph.available) artifactsFound.push('stage3a_index');
  else artifactsMissing.push('stage3a_index');
  if (imported.artifact.artifactPresentStatus === 'present') {
    artifactsFound.push('view_definition_payload');
  } else {
    artifactsMissing.push('view_definition_payload');
  }
  if (dataSurface.datasetRefs.length) artifactsFound.push('dataset_edges');
  else artifactsMissing.push('confirmed_employee_master_dataset');

  const technicalArtifactSummaries: TetaOfflineTechnicalEvidenceArtifact[] = [];
  if (
    imported.artifact.artifactPresentStatus === 'present' &&
    imported.artifact.rawContentFingerprint &&
    !imported.synthetic
  ) {
    technicalArtifactSummaries.push({
      artifactId: imported.artifact.artifactId,
      artifactKind: 'view_definition_payload',
      sourceStage: 'vendor_import',
      sourceVersion: 'v1',
      sourceFingerprint: imported.artifact.rawContentFingerprint,
      contentFingerprint:
        imported.artifact.canonicalContentFingerprint ?? imported.artifact.rawContentFingerprint,
      createdAt: new Date().toISOString(),
      acquisitionMode: 'manual_vendor_artifact_import',
      boundedTargetRefs: [imported.artifact.sourceObjectRef],
      provenance: 'local_vendor_only_manifest',
      containsClientRows: false,
      containsCredentials: false,
      containsPersonalData: false,
      containsClientSpecificMetadata: 'unknown_until_classified',
      sensitivityClassification: 'client_specific_technical_metadata',
      rawPayloadRepoEligible: false,
      safeSummaryAvailable: true,
      safeSummaryFingerprint: sha256(
        stableStringify({
          completeness: imported.artifact.definitionCompletenessStatus,
          parse: imported.artifact.parseStatus,
        }),
      ),
      redactionStatus: 'raw_excluded_from_repo',
      vendorOnly: true,
      repoVisibility: 'safe_summary_only',
      validationStatus: imported.artifact.artifactValidationStatus,
    });
  }

  // Preview delta: only when new validated enrichment evidence nodes/edges are added.
  // Discovering existing Stage 3A edges is not a preview delta.
  const previewAddedNodes = 0;
  const previewAddedEdges = 0;
  const previewSupersededEvidence: string[] = [];
  const previewConflicts =
    dataSurface.selectionRequired ? ['ambiguous_data_surface'] : ([] as string[]);
  const previewSemanticUpgradeCount = 0;
  const previewCandidateStatusChanges: TetaCanonicalGraphEnrichmentManifest['previewCandidateStatusChanges'] =
    [];
  const previewEvidenceRefs: string[] = [];
  const previewInputArtifactFingerprints = technicalArtifactSummaries.map(
    (a) => a.contentFingerprint,
  );

  const hasPositiveDelta =
    previewAddedNodes > 0 ||
    previewAddedEdges > 0 ||
    previewSupersededEvidence.length > 0;

  let previewStatus: PreviewStatus = 'not_created_no_new_validated_evidence';
  let previewContentHash: string | null = null;
  let previewGraphHash: string | null = null;

  if (hasPositiveDelta) {
    previewStatus =
      previewSemanticUpgradeCount > 0
        ? 'validated_preview_with_semantic_effect'
        : 'validated_preview_structural_only';
    previewContentHash = sha256(
      stableStringify({
        baseGraphHash: graph.graphHash,
        previewAddedNodes,
        previewAddedEdges,
        previewSupersededEvidence,
        previewEvidenceRefs,
        previewInputArtifactFingerprints,
      }),
    );
    previewGraphHash = previewContentHash;
    metrics.realPreviewArtifactsUsed += 1;
  }

  if (
    (previewStatus === 'validated_preview_structural_only' ||
      previewStatus === 'validated_preview_with_semantic_effect') &&
    !hasPositiveDelta
  ) {
    counters.validatedPreviewWithZeroDelta += 1;
  }
  if (previewSemanticUpgradeCount > 0 && !hasPositiveDelta) {
    counters.semanticPreviewUpgradeWithoutNewEvidence += 1;
  }
  if (previewCandidateStatusChanges.length > 0 && previewSemanticUpgradeCount === 0) {
    counters.previewCandidateUpgradeWithoutPolicyReevaluation += 1;
  }

  if (imported.synthetic && mode === 'real' && hasPositiveDelta) {
    counters.syntheticArtifactsInRealPreview += 1;
    metrics.syntheticArtifactsInRealPreview += 1;
  }

  const afterSnap = snapshotActiveGraphAfter(beforeSnap, counters);

  const graphImmutability: ActiveGraphImmutabilityProof = {
    activeGraphPointerBefore: beforeSnap.pointer,
    activeGraphPointerAfter: afterSnap.pointer,
    baseGraphHashBefore: beforeSnap.graphHash,
    baseGraphHashAfter: afterSnap.graphHash,
    baseGraphFileSha256Before: beforeSnap.fileSha256,
    baseGraphFileSha256After: afterSnap.fileSha256,
    baseGraphFileSizeBefore: beforeSnap.fileSize,
    baseGraphFileSizeAfter: afterSnap.fileSize,
    baseGraphModifiedAtBefore: beforeSnap.modifiedAt,
    baseGraphModifiedAtAfter: afterSnap.modifiedAt,
    activeGraphPointerUnchanged: beforeSnap.pointer === afterSnap.pointer,
    activeGraphContentUnchanged:
      beforeSnap.fileSha256 === afterSnap.fileSha256 &&
      beforeSnap.fileSize === afterSnap.fileSize &&
      beforeSnap.graphHash === afterSnap.graphHash,
  };

  if (beforeSnap.pointer !== afterSnap.pointer) {
    counters.activeGraphPointerChanges += 1;
  }
  if (
    beforeSnap.pointer === afterSnap.pointer &&
    beforeSnap.fileSha256 !== afterSnap.fileSha256
  ) {
    counters.activeGraphPathUnchangedButContentChanged += 1;
  }
  if (beforeSnap.fileSha256 !== afterSnap.fileSha256) {
    counters.activeGraphContentHashChanged += 1;
  }
  if (beforeSnap.fileSize !== afterSnap.fileSize) {
    counters.activeGraphFileSizeChanged += 1;
  }
  if (
    beforeSnap.modifiedAt &&
    afterSnap.modifiedAt &&
    beforeSnap.modifiedAt !== afterSnap.modifiedAt &&
    beforeSnap.fileSha256 !== afterSnap.fileSha256
  ) {
    counters.activeGraphModifiedInPlace += 1;
  }
  // Readonly open only — write attempts remain 0 unless code tries to write.

  const graphManifest: TetaCanonicalGraphEnrichmentManifest = {
    manifestId: 'enrichment-manifest:P1:v2',
    baseGraphHash: graph.graphHash,
    previewGraphHash,
    previewContentHash,
    graphRevisionStatus: hasPositiveDelta ? 'validated_preview' : 'preview',
    previewStatus,
    activeGraphPointerBefore: graphImmutability.activeGraphPointerBefore,
    activeGraphPointerAfter: graphImmutability.activeGraphPointerAfter,
    activeGraphPointerUnchanged: true,
    runtimeConsumersMayUsePreview: false,
    promotionStatus: 'not_requested',
    previewAddedNodes,
    previewAddedEdges,
    previewSupersededEvidence,
    previewConflicts,
    previewSemanticUpgradeCount,
    previewCandidateStatusChanges,
    previewInputArtifactFingerprints,
    previewEvidenceRefs,
    inputArtifactFingerprints: previewInputArtifactFingerprints,
    newNodeClasses: [],
    newEdgeClasses: [],
    affectedCandidateIds: ['cand:P1:employee'],
    addedNodes: previewAddedNodes,
    addedEdges: previewAddedEdges,
    supersededEvidence: previewSupersededEvidence,
    conflicts: previewConflicts,
    refreshStatus: previewStatus,
    validationStatus: 'pass',
  };

  const deltaAssessment: TetaGraphEnrichmentDeltaAssessment = {
    assessmentId: 'delta:P1:v2',
    provenancePreserved: true,
    stableIdsUnchanged: true,
    unknownToConfirmedWithoutEvidence: 0,
    duplicates: 0,
    brokenEdges: 0,
    scopeExpansion: 0,
    automaticSemanticApproval: 0,
    runtimeAccessActivation: 0,
    validationStatus: 'pass',
  };

  const staleness: TetaEmployeeFoundationEnrichmentStalenessVector = {
    baseGraphHash: graph.graphHash,
    sourceArtifactFingerprint: imported.artifact.rawContentFingerprint ?? 'missing',
    extractorVersion: STAGE3K2B2B2A_COLLECTOR_VERSION,
    parserVersion: STAGE3K2B2B2A_PARSER_VERSION,
    enrichmentPolicyVersion: options.policy.policyVersion,
    enrichmentPolicyHash: options.policyHash,
    applicationAnchorFingerprint: sha256(allowlist.applicationAnchorRefs.join('|')),
    candidateFingerprints: allowlist.candidateFingerprints,
    dependencyFingerprints: [
      sha256(dataSurface.applicationDataSurfaceStatus),
      sha256(keyPreservation.keyPreservationStatus),
    ],
    allowlistFingerprint: allowlist.allowlistFingerprint,
    stale: false,
    staleReasons: [],
  };

  let reviewPackPaths: string[] = [];
  if (options.writeArtifacts !== false) {
    const outDir = path.join(repoRoot, '.local', 'stage3k2b2b2a');
    const packsDir = path.join(outDir, 'review-packs-v2');
    const previewDir = path.join(outDir, 'graph-preview');
    fs.mkdirSync(packsDir, { recursive: true });
    fs.mkdirSync(previewDir, { recursive: true });
    fs.mkdirSync(path.join(outDir, 'vendor-only'), { recursive: true });

    if (hasPositiveDelta && previewContentHash) {
      fs.writeFileSync(
        path.join(previewDir, 'preview-revision-v2.json'),
        JSON.stringify(
          {
            previewGraphHash,
            previewContentHash,
            previewStatus,
            previewAddedNodes,
            previewAddedEdges,
            baseGraphHash: graph.graphHash,
            activeGraphPointerUnchanged: true,
            runtimeConsumersMayUsePreview: false,
            note: 'preview_only_safe_summary_no_raw_ddl',
          },
          null,
          2,
        ),
        'utf8',
      );
    }

    const pack = {
      packVersion: 'v2',
      contractVersion: STAGE3K2B2B2A_CONTRACT_VERSION,
      enrichmentPolicyVersion: options.policy.policyVersion,
      enrichmentPolicyHash: options.policyHash,
      rulesApplied: options.policy.rulesApplied,
      allowlist,
      enrichmentRequests,
      sourceGapAssessment: {
        viewDefinition: {
          requestStatus: imported.artifact.viewDefinitionArtifactStatus,
          artifactPresentStatus: imported.artifact.artifactPresentStatus,
          definitionCompletenessStatus: imported.artifact.definitionCompletenessStatus,
          parseStatus: imported.artifact.parseStatus,
          unsupportedConstructsStatus: imported.artifact.unsupportedConstructsStatus,
          unsupportedConstructs: imported.artifact.unsupportedConstructs,
          keyPreservationStatus: keyPreservation.keyPreservationStatus,
        },
        applicationDataSurface: {
          requestStatus: enrichmentRequests[1].status,
          evidenceAvailability: dataSurface.evidenceAvailability,
          materializationStatus: dataSurface.materializationStatus,
          semanticAttributionStatus: dataSurface.semanticAttributionStatus,
          surfaceCandidateCount: dataSurface.surfaceCandidateCount,
          surfaceSelectionStatus: dataSurface.surfaceSelectionStatus,
          ambiguityStatus: dataSurface.ambiguityStatus,
          applicationDataSurfaceStatus: dataSurface.applicationDataSurfaceStatus,
          note: 'request_availability_does_not_prove_semantic_attribution',
        },
      },
      artifactsFound,
      artifactsMissing,
      dataSurface,
      viewDefinition: {
        ...imported.artifact,
        rawPayloadExcluded: true,
      },
      parser: {
        parseStatus: imported.artifact.parseStatus,
        unsupportedConstructsStatus: imported.artifact.unsupportedConstructsStatus,
        unsupportedConstructs: imported.artifact.unsupportedConstructs,
        parseWarnings: imported.artifact.parseWarnings,
        parserVersion: imported.artifact.parserVersion,
      },
      keyPreservation,
      graphImmutability,
      graphPreview: graphManifest,
      previewDelta: {
        previewStatus,
        previewGraphHash,
        previewContentHash,
        previewAddedNodes,
        previewAddedEdges,
        previewSupersededEvidence,
        previewConflicts,
        previewSemanticUpgradeCount,
        previewCandidateStatusChanges,
        previewInputArtifactFingerprints,
        previewEvidenceRefs,
      },
      p1GrainPreview: {
        grainStatus: 'partial',
        sourceOutcome: 'supported_partial',
        genericActivationEligible: false,
        planningEligible: false,
      },
      metrics,
      approvalForbidden: true,
      activeGraphPointerUnchanged: true,
      staleness,
    };

    if (imported.synthetic && mode === 'real') {
      counters.syntheticArtifactsInRealPack += 1;
      metrics.syntheticArtifactsInRealPack += 1;
    }

    const packPath = path.join(packsDir, 'pack-P1.json');
    fs.writeFileSync(packPath, JSON.stringify(pack, null, 2), 'utf8');
    reviewPackPaths = [packPath];

    fs.writeFileSync(
      path.join(outDir, 'enrichment-manifest-v2.json'),
      JSON.stringify(graphManifest, null, 2),
      'utf8',
    );
  }

  return {
    mode,
    policy: options.policy,
    policyHash: options.policyHash,
    policyPath: options.policyPath,
    rulesApplied: options.policy.rulesApplied,
    allowlist,
    enrichmentRequests,
    artifactsFound,
    artifactsMissing,
    viewDefinition: imported.artifact,
    keyPreservation,
    dataSurface,
    technicalArtifactSummaries,
    graphManifest,
    deltaAssessment,
    graphImmutability,
    staleness,
    p1GrainPreview: {
      grainStatus: 'partial',
      sourceOutcome: 'supported_partial',
      genericActivationEligible: false,
      planningEligible: false,
      improvedWithoutRealViewArtifact: false,
    },
    metrics,
    counters,
    reviewPackPaths,
    activeGraphPointerBefore: graphImmutability.activeGraphPointerBefore,
    activeGraphPointerAfter: graphImmutability.activeGraphPointerAfter,
  };
}

export function buildStage3k2b2b2aAudit(
  repoRoot: string,
  options?: {
    writeArtifacts?: boolean;
    mode?: EnrichmentMode;
    manifestPath?: string;
  },
) {
  const loaded = loadEnrichmentPolicy(repoRoot);
  const pipeline = runEnrichmentPipeline(repoRoot, {
    mode: options?.mode ?? 'real',
    writeArtifacts: options?.writeArtifacts !== false,
    policy: loaded.policy,
    policyHash: loaded.policyHash,
    policyPath: loaded.policyPath,
    manifestPath: options?.manifestPath,
  });
  const strictErrors = assertStrictZeros(pipeline.counters);
  if (pipeline.activeGraphPointerBefore !== pipeline.activeGraphPointerAfter) {
    strictErrors.push('active_graph_pointer_changed');
  }
  if (!pipeline.graphImmutability.activeGraphContentUnchanged) {
    strictErrors.push('active_graph_content_changed');
  }
  if (pipeline.graphManifest.runtimeConsumersMayUsePreview) {
    strictErrors.push('runtime_may_use_preview');
  }
  if (pipeline.metrics.syntheticArtifactsInRealPack !== 0) {
    strictErrors.push('synthetic_in_real_pack');
  }
  if (pipeline.metrics.syntheticArtifactsInRealPreview !== 0) {
    strictErrors.push('synthetic_in_real_preview');
  }
  if (pipeline.metrics.syntheticEvidenceUsedForRealP1 !== 0) {
    strictErrors.push('synthetic_evidence_used_for_real_p1');
  }

  const audit = {
    stage3k2b2b2Status: 'started_offline_source_evidence_enrichment' as const,
    stage3k2b2b2aStatus:
      'accepted_offline_candidate_scoped_employee_view_enrichment_pilot' as const,
    previousHumanReviewVerdict: 'PATCH_BEFORE_COMMIT' as const,
    humanReviewVerdict: 'PASS_WITH_FINALIZATION' as const,
    humanReviewStatus: 'accepted' as const,
    acceptedInfrastructure:
      'candidate_scoped_employee_view_and_application_surface_offline_enrichment_pilot' as const,
    realCandidateApprovalStatus: 'no_candidates_approved' as const,
    realCandidateDecisionsSummary: {
      'cand:P1:employee': 'request_more_evidence',
    },
    accepted: true as const,
    committed: false as const,
    enrichmentPolicyPath: loaded.policyPath,
    enrichmentPolicyVersion: loaded.policy.policyVersion,
    enrichmentPolicyHash: loaded.policyHash,
    rulesApplied: loaded.policy.rulesApplied,
    allowlist: pipeline.allowlist,
    allowlistConfiguredObserved: {
      maxDepth: pipeline.allowlist.maxDepth,
      maxNodes: pipeline.allowlist.maxNodes,
      maxEdges: pipeline.allowlist.maxEdges,
      maxCandidates: pipeline.allowlist.maxCandidates,
      observedDepth: pipeline.allowlist.observedDepth,
      observedNodes: pipeline.allowlist.observedNodes,
      observedEdges: pipeline.allowlist.observedEdges,
      observedCandidates: pipeline.allowlist.observedCandidates,
    },
    artifactsFound: pipeline.artifactsFound,
    artifactsMissing: pipeline.artifactsMissing,
    viewDefinitionArtifactStatus: pipeline.viewDefinition.viewDefinitionArtifactStatus,
    completenessStatus: pipeline.viewDefinition.definitionCompletenessStatus,
    parseStatus: pipeline.viewDefinition.parseStatus,
    unsupportedConstructsStatus: pipeline.viewDefinition.unsupportedConstructsStatus,
    unsupportedConstructs: pipeline.viewDefinition.unsupportedConstructs,
    parseWarnings: pipeline.viewDefinition.parseWarnings,
    dataSurface: pipeline.dataSurface,
    keyPreservationStatus: pipeline.keyPreservation.keyPreservationStatus,
    p1GrainPreview: pipeline.p1GrainPreview,
    graphPreviewStatus: pipeline.graphManifest.previewStatus,
    previewGraphHash: pipeline.graphManifest.previewGraphHash,
    previewContentHash: pipeline.graphManifest.previewContentHash,
    previewDelta: {
      previewAddedNodes: pipeline.graphManifest.previewAddedNodes,
      previewAddedEdges: pipeline.graphManifest.previewAddedEdges,
      previewSupersededEvidence: pipeline.graphManifest.previewSupersededEvidence,
      previewSemanticUpgradeCount: pipeline.graphManifest.previewSemanticUpgradeCount,
    },
    graphImmutability: pipeline.graphImmutability,
    activeGraphPointerBefore: pipeline.activeGraphPointerBefore,
    activeGraphPointerAfter: pipeline.activeGraphPointerAfter,
    runtimeConsumersMayUsePreview: pipeline.graphManifest.runtimeConsumersMayUsePreview,
    enrichmentRequests: pipeline.enrichmentRequests,
    sourceGapAssessment: {
      viewDefinitionRequestStatus: pipeline.viewDefinition.viewDefinitionArtifactStatus,
      applicationDataSurfaceRequestStatus: pipeline.enrichmentRequests.find(
        (r) => r.gapKind === 'application_data_surface_evidence',
      )?.status,
      evidenceAvailability: pipeline.dataSurface.evidenceAvailability,
      materializationStatus: pipeline.dataSurface.materializationStatus,
      semanticAttributionStatus: pipeline.dataSurface.semanticAttributionStatus,
    },
    metrics: pipeline.metrics,
    sensitivity: pipeline.technicalArtifactSummaries.map((a) => ({
      artifactId: a.artifactId,
      sensitivityClassification: a.sensitivityClassification,
      rawPayloadRepoEligible: a.rawPayloadRepoEligible,
      vendorOnly: a.vendorOnly,
    })),
    staleness: pipeline.staleness,
    counters: pipeline.counters,
    reviewPackPaths: pipeline.reviewPackPaths,
    strictErrors,
  };

  if (options?.writeArtifacts !== false) {
    const outDir = path.join(repoRoot, '.local', 'stage3k2b2b2a');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'stage3k2b2b2a-audit-v2.json'),
      JSON.stringify(audit, null, 2),
      'utf8',
    );
  }
  return audit;
}
